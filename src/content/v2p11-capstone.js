/* Volume 2, Part 11: Capstone stages 6–9 — Atlas from one model to a multi-tenant, multi-region platform */

registerLesson({
  id:'v2-capstone-platform', vol:2, part:11, num:1,
  title:'Capstone stages 6–9: RAG, MCP tools, hardening, and evolving to millions of users', minutes:100,
  summary:'This capstone finishes Atlas, the fictional enterprise AI assistant for a GCC travel company. Volume 1 ended with a fine-tuned model served by vLLM on Kubernetes. Here Atlas gains retrieval over policy documents with access control, tools through MCP servers and an agent that asks for approval before changing anything, then caching, observability, security and cost controls, and finally grows into a multi-tenant self-service platform running in more than one region for millions of users. At every stage you will see what changed, why, and which parts you can validate in a lab versus which are designs that have not been tested at scale.',
  objectives:[
    'Explain each Atlas stage (6–9): the architectural change, the reason, and the new failure modes it introduces.',
    'Integrate RAG with ACLs, MCP tools and an approval-gated agent into one request path with trace context and policy enforcement.',
    'Apply the hardening checklist: caching, SLOs and burn-rate alerts, threat-model controls, cost attribution.',
    'Evolve the design to a multi-tenant platform and a multi-region deployment sized from the Part 7 capacity model.',
    'Separate clearly what is lab-validated from what is design only, and present it honestly in an interview.'
  ],
  prereqs:['v1-k8s-production','v2-rag-production','v2-mcp-capstone','v2-agents','v2-ai-observability','v2-ai-threat-model','v2-finops-optimization','v2-multi-region'],
  next:['v2-landscape','v3-prove-platform','v3-prove-10m'],
  tags:['capstone','architecture','platform','multi-region'],
  html:`
<h2>1. What is it?</h2>
<p>Atlas is the course’s single, progressively built system (fictional company, fictional numbers). Stages 1–5 happened in Volume 1: a tiny transformer, an open-weight instruct model, a LoRA fine-tune on synthetic travel-support tickets, vLLM serving with benchmarks, and deployment to Kubernetes with Helm, probes, KEDA and GitOps (${L('v1-capstone-train','stages 1–3')}, ${L('v1-benchmarking','stage 4')}, ${L('v1-k8s-production','stage 5')}). This lesson covers stages 6–9:</p>
${table(['Stage','Adds','Driven by','Lessons used'],[
 ['6','RAG over travel-policy documents with hybrid search and ACLs','answers must cite current policy','RAG lessons'],
 ['7','MCP tools (booking lookup read-only, ops tools) + agent with approvals','users ask about their bookings; ops wants assisted triage','MCP lessons, agents'],
 ['8','Caching, observability, security, FinOps hardening','production readiness and cost','Parts 2, 8, 9, 10'],
 ['9','Multi-tenant self-service platform; multi-region; millions of users','other teams want assistants; residency; scale','Part 7, governance, FinOps']
])}
<p>Lessons used in stage 6: ${L('v2-rag-fundamentals','RAG fundamentals')} and ${L('v2-rag-production','production RAG')}; stage 7: ${L('v2-mcp-python','MCP in Python')}, ${L('v2-mcp-auth','MCP auth')}, ${L('v2-mcp-capstone','MCP optimizer capstone')}, ${L('v2-agents','agents')}; stage 8: ${L('v2-cache-ops','cache ops')}, ${L('v2-ai-observability','observability')}, ${L('v2-ai-threat-model','threat model')}, ${L('v2-finops-optimization','FinOps')}; stage 9: ${L('v2-capacity-planning','capacity')}, ${L('v2-multi-region','multi-region')}, ${L('v2-governance','governance')}.</p>
${anim('v2-atlas-evolve')}

<h2>2. Why do we need it?</h2>
<p>Individual lessons teach components. Interviews and real jobs test whether you can <b>compose</b> them: whether ACLs survive caching, whether the trace survives the tool call, whether the cost model includes retrieval, whether failover respects residency. The capstone forces those joins, and the honesty rule (lab-validated versus design) is what makes the result credible.</p>

<h2>3. How does it work internally?</h2>
<h3>Stage 6 — RAG over policy documents</h3>
<p><b>What changed.</b> A retrieval service sits between the gateway and the model: query embedding, BM25 + vector hybrid search, reciprocal-rank fusion, a reranker, ACL filtering by tenant and document permissions, prompt assembly with citations. An ingestion pipeline (change data capture from the document store, chunking, embedding, upsert, tombstones for deletions) keeps the index fresh.</p>
<p><b>Why.</b> Fine-tuning (stage 3) teaches tone and format, not weekly-changing fare rules. Retrieval brings current, citable text, and ACLs must be enforced <i>before</i> text enters the prompt, because nothing after that point can un-see it.</p>
<p><b>New failure modes.</b> Stale index, ACL leaks, irrelevant chunks, longer prompts (+1,200 tokens raised replicas 22 % in the ${L('v2-capacity-planning','sensitivity table')}).</p>
${formula(`
Stage 6 request:  user → gateway → embed (25 ms) → hybrid search + ACL (75 ms) → rerank (75 ms)
                  → prompt build (25 ms) → engine
Prompt grows:     500 system + 500 history + 200 user/retrieved  →  + 1,200 retrieved tokens
Capacity effect:  uncached prompt 720 → 1,440 tokens  →  goodput 12.4 → 10.2 req/s  (+22 % replicas)
Mitigation:       stable prefix first (system + policy preamble) to keep prefix-cache hits
`)}
<p><b>Lab-validated</b>: chunking, BM25, toy dense retrieval, RRF, ACL filtering and citation on a laptop (planned <code>labs/07-rag/rag_minimal.py</code>). <b>Design only</b>: production ingestion at scale, reranker serving capacity, freshness SLOs.</p>

<h3>Stage 7 — MCP tools and an agent with approvals</h3>
<p><b>What changed.</b> Two MCP servers: <i>booking-lookup</i> (read-only, user-scoped token, returns only the caller’s bookings) and <i>ops</i> (read-only Kubernetes and metrics tools for the platform team — the ${L('v2-mcp-capstone','MCP optimizer capstone')}). An agent runtime plans tool use, enforces step and token budgets, and asks for human approval for any write (for example adding a note to a booking). A policy engine sits between agent and tools.</p>
<p><b>Why.</b> "Where is my booking?" needs live data; documents cannot answer it. MCP gives one protocol for tools across hosts (be explicit about the spec era: the 2025-11-25 revision with initialize handshake and sessions is what most clients still use; the 2026-07-28 revision is stateless — ${L('v2-mcp-protocol','MCP protocol')}).</p>
<p><b>New failure modes.</b> Indirect prompt injection through emails and documents, confused deputies, agent loops, compounding step failure:</p>
${formula(`
End-to-end success of an agent with k independent steps, each succeeding with probability p:
   P(success) = pᵏ
   p = 0.95, k = 5  →  0.95⁵ = 0.774     (≈ 1 in 4.4 tasks fails somewhere)
   p = 0.99, k = 5  →  0.99⁵ = 0.951
   ↑ reliability work targets per-step success and fewer steps, not just a better model
`)}
<p><b>Lab-validated</b>: MCP servers in Python and TypeScript with tools, auth, tests and Helm (labs 08–10 in the README). <b>Design only</b>: approval UX at scale, dual-LLM separation for email content, policy engine in production.</p>

<h3>Stage 8 — Hardening: caching, observability, security, FinOps</h3>
${table(['Concern','What is added','Why','Validated?'],[
 ['Caching','prefix-cache-friendly templates; exact response cache for public FAQ keyed by tenant + ACL hash + model + template version; retrieval cache with freshness TTL','cost and TTFT','prefix caching measurable on one GPU; response cache design'],
 ['Observability','OTel traces gateway → retrieval → engine → MCP with GenAI attributes; DCGM + engine metrics; SLOs (availability 99.9 %, TTFT p95 ≤ 1 s, quality ≥ 97 % groundedness on samples); burn-rate alerts 14.4/6/1','operability','metrics and traces in a lab; SLO numbers are targets, not measured at scale'],
 ['Security','threat model (STRIDE + OWASP LLM 2025/2026 + Agentic 2026); safetensors-only signed models; policy engine; delegated tokens; red-team suite in CI','defensibility','unit-level tests in a lab; red-team coverage partial'],
 ['FinOps','per-request usage records (tenant, feature, model, in / cached-in / out tokens); cost per successful request; OpenCost GPU allocation; showback','accountability','calculations; not reconciled against a real bill']
])}
<p>A worked burn-rate example for Atlas: the availability SLO is 99.9 % over 30 days; a 14.4× burn means 1.44 % errors sustained for both 1 hour and 5 minutes, consuming 2 % of the monthly budget per hour, which pages on-call. Quality is ticketed weekly because 500 samples per day give only about ±1.5 points of precision.</p>

<h3>Stage 9a — From application to multi-tenant self-service platform</h3>
<p><b>What changed.</b> Other business units (hotels, flights, corporate travel, internal IT) want their own assistants. Instead of copying the stack, Atlas becomes a platform:</p>
<ul>
<li><b>Tenant onboarding API</b>: creates identity, quotas, isolation tier, index namespace, cost centre, audit stream, and default SLOs in one step.</li>
<li><b>Model catalog</b>: approved models (self-hosted and external APIs) with model cards, eval results, approved uses and prices.</li>
<li><b>Routing and quotas</b> at the gateway per tenant; priority classes; brownout tiers per tenant.</li>
<li><b>Paved road</b>: templates for RAG apps and agents with tracing, redaction and policy hooks on by default.</li>
<li><b>Chargeback</b>: usage records → GPU-seconds → OpenCost allocation → FOCUS dataset → showback, with idle headroom shown as a platform line.</li>
</ul>
<p><b>Why.</b> N teams running N copies multiply GPU fragmentation, security reviews and on-call. Pooling also helps queueing (M/M/c beats many M/M/1: ${L('v2-capacity-planning','queueing intuition')}).</p>
${fig('Atlas platform: control plane and data plane', svgDiagram({w:900,h:360,
 zones:[{x:20,y:20,w:860,h:110,label:'Control plane (self-service)'},{x:20,y:150,w:860,h:190,label:'Data plane (per region)'}],
 boxes:[
  {id:'onb',x:40,y:50,w:160,h:56,label:'Tenant onboarding',sub:'identity, quotas'},
  {id:'cat',x:220,y:50,w:150,h:56,label:'Model catalog',sub:'approved uses'},
  {id:'pol',x:390,y:50,w:150,h:56,label:'Policy store',sub:'RBAC + ABAC'},
  {id:'fin',x:560,y:50,w:140,h:56,label:'Chargeback',sub:'FOCUS'},
  {id:'obs',x:720,y:50,w:140,h:56,label:'SLOs, audit'},
  {id:'gw',x:40,y:200,w:150,h:56,label:'Gateway',sub:'route, shed',cls:'hl'},
  {id:'rag',x:220,y:200,w:150,h:56,label:'RAG',sub:'ACL-filtered'},
  {id:'ag',x:390,y:200,w:150,h:56,label:'Agent runtime',sub:'approvals'},
  {id:'tools',x:560,y:200,w:140,h:56,label:'MCP tools',sub:'via policy'},
  {id:'gpu',x:720,y:200,w:140,h:56,label:'GPU pools',sub:'vLLM / llm-d'},
  {id:'ext',x:720,y:280,w:140,h:50,label:'External APIs'}
 ],
 arrows:[{from:'gw',to:'rag'},{from:'rag',to:'ag'},{from:'ag',to:'tools'},{from:'tools',to:'gpu',cls:'dash'},{from:'pol',to:'tools',cls:'dash'},{from:'onb',to:'gw',cls:'dash'}]
}), 'The control plane configures tenants once; the data plane runs per region. Policy is evaluated in the data plane but defined centrally.')}
<p><b>Design only, not tested at scale.</b> Nothing in stage 9 has been run with real tenants; it is an architecture with arithmetic.</p>

<h3>Stage 9b — Millions of users, multi-region</h3>
<p>Apply the ${L('v2-capacity-planning','Part 7 capacity model')} to the platform’s consumer assistant (10 M DAU, illustrative):</p>
${formula(`
STEP 1  demand            80 M requests/day, 926 mean RPS, 3,000 design-peak RPS
STEP 2  per-replica       measured goodput 12.4 req/s (8B, H100) — RE-MEASURE after stage 6 prompts
                          with RAG prompts: 10.2 req/s → 296 replicas at peak (was 242)
STEP 3  failure reserve   ⌈296 × 1.1⌉ = 326 per serving region
STEP 4  region strategy   restricted Saudi personal-data traffic: in-Kingdom only
                          (as of Oct 2026 only GCP Dammam is a live in-Kingdom public cloud region)
                          → multi-zone in Dammam + brownout for region loss
                          unrestricted traffic: active-active across 2 regions with brownout tiers
STEP 5  routing mix       60 % of free-tier traffic to the 8B model, premium to a larger model via
                          blended-cost routing; batch summaries in the overnight trough
STEP 6  unit economics    track $/successful request per tenant; utilization target ≥ 35 % by
                          scaling the surplus with the day instead of holding 2 × peak 24/7
`)}
<p>The failover arithmetic, residency rule and brownout ladder are exactly those of ${L('v2-multi-region','the multi-region lesson')}: when a region fails, restricted features degrade instead of crossing borders, batch pauses, free tier moves to the small model, and premium stays on the large model.</p>
<p><b>Design only, not tested at scale.</b> The GPU counts are calculations from an illustrative goodput; they must be re-derived from a real load test with the stage 6–8 prompt shapes.</p>

<h2>4. Where does it fit?</h2>
<p>Atlas stage 9 is the reference architecture you should be able to draw from memory in a system-design interview: edge and gateway, retrieval with ACLs, agent and tools behind policy, GPU pools with inference-aware routing, observability and cost pipelines, a self-service control plane, and residency-aware multi-region routing (${L('v2-platform-architecture','platform architecture')}).</p>

<h2>5. How does it connect to other components?</h2>
${table(['Join','Must hold','Test'],[
 ['RAG ↔ cache','cached answers keyed by tenant + ACL hash + doc versions','cross-tenant cache leakage test'],
 ['Agent ↔ tools','user-scoped tokens; policy intersection','attempt another customer’s booking'],
 ['Gateway ↔ engine','trace context and tenant labels propagate','trace completeness ratio'],
 ['Usage ↔ chargeback','every request has a usage record','records ÷ requests = 1.0'],
 ['Promotion ↔ regions','model digest present in every region before promotion','parity check in CI'],
 ['Routing ↔ residency','restricted data never leaves allowed regions','failover game day with restricted test tenant']
])}

<h2>6. What does a DevOps / platform engineer manage?</h2>
${checklist([
 {key:'cp-1',text:'Stage 6: ingestion pipeline with freshness metric; ACL filter before ranking; RAG eval set.'},
 {key:'cp-2',text:'Stage 7: MCP servers with auth and tests; agent budgets; approval flow; policy engine decisions logged.'},
 {key:'cp-3',text:'Stage 8: SLO document; burn-rate alerts with runbooks; threat model; model intake; usage records.'},
 {key:'cp-4',text:'Stage 9: tenant onboarding automation; model catalog; chargeback; capacity model per region; brownout game day.'},
 {key:'cp-5',text:'Portfolio: a README listing what was run (with graphs) and what is design (with assumptions).'}
])}

<h2>7. What happens when it fails?</h2>
${table(['Stage','Failure','Evidence','Fix'],[
 ['6','Answer cites a deleted policy','Index freshness lag; missing tombstone','CDC deletes; freshness SLO; cache invalidation on doc version'],
 ['6','User sees another department’s document','ACL applied after rerank or cache key lacks ACL','Filter before ranking; key includes ACL hash'],
 ['7','Agent loops 30 tool calls','Missing step budget; tool error treated as retryable','Max steps and tokens; error classification'],
 ['7','Injected email triggers an egress attempt','Policy log shows blocked send_email','Keep block; add red-team regression; dual-LLM extraction'],
 ['8','Cost per request jumps after a template change','Prefix-cache hit rate fell','Stable prefix first; template review checklist'],
 ['8','Alerts on GPU util at every peak','Wrong signal','Alert on burn rate and queue time'],
 ['9','One tenant’s batch job slows everyone','Shared pool without priority classes','Priority classes; batch pool; quotas'],
 ['9','Failover pushed restricted traffic abroad','Router fell back to any healthy region','Policy-first routing; degraded mode']
])}

<h2>8. How do we scale it?</h2>
<p>Beyond stage 9: disaggregated prefill/decode and KV-aware routing for the largest pools (${L('v2-distributed-inference','distributed inference')}), distributed KV offload for long agent sessions (${L('v2-distributed-kv','distributed KV')}), cell-based deployment within regions to limit blast radius, and a third region (or a second in-Kingdom provider once available) to lower the failover multiplier from 2× to 1.5×.</p>

<h2>9. How do we optimize its cost?</h2>
<ul>
<li>Re-run the sensitivity table after every stage: RAG prompts (+22 %), longer agent outputs, caching gains.</li>
<li>Route by difficulty with quality guardrails; batch deferrable work; commit only to the measured floor.</li>
<li>Build-versus-buy per feature: frontier APIs for low-volume complex tasks, self-hosted small models for high-volume or residency-bound paths (${L('v2-finops-optimization','break-even')}).</li>
</ul>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Walk me through an AI platform you designed and tell me what you actually ran.”','<p><i>Answer template (≈90 s):</i> "Atlas is a travel-support assistant I built in stages. I fine-tuned a small open model with LoRA, served it with vLLM and benchmarked TTFT and TPOT [state your measured numbers], and deployed it on Kubernetes with Helm, probes and KEDA. I added RAG with hybrid search and ACL filtering — validated on a small corpus — and MCP servers for read-only booking lookup and ops tools, with tests and OAuth. For production I designed tracing with OpenTelemetry GenAI conventions, burn-rate SLO alerts, a threat model with a policy engine between the agent and tools, and per-tenant cost records. The 10-million-user, multi-region version is a design: I sized it from a measured per-replica goodput with N+1 and region-loss headroom, and planned residency-aware routing and a brownout ladder. I haven’t run it at that scale, and I can show exactly which assumptions would need validating first."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"I built a platform serving millions of users across regions with full security and AIOps." (unverifiable, invites a deep follow-up you cannot survive)</p></div><div class="good"><h4>Strong answer</h4><p>Names each stage, what changed and why, numbers you measured, and draws a clear line at what is design. Precise boundaries earn trust.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['stage 5 serving','stage 6 RAG','stage 7 MCP + agent','stage 8 hardening','stage 9 platform + multi-region'])}
<p>Next: ${L('v2-landscape','the technology landscape')}, then prove it: ${L('v3-prove-platform','build and deploy an AI platform')} and ${L('v3-prove-10m','design for 10 million users')}.</p></div>
`,
  quiz:[
    {q:'Why is RAG added in stage 6 instead of more fine-tuning?',options:['Fine-tuning is impossible on GPUs','Policies change weekly and answers must cite current text with ACLs enforced before prompting','RAG is always cheaper','Fine-tuning breaks vLLM'],answer:1,explain:'Fine-tuning teaches style/format; retrieval provides current, citable, permission-filtered knowledge.'},
    {q:'An agent has 5 steps each succeeding with probability 0.95. End-to-end success?',options:['95 %','90 %','77 %','50 %'],answer:2,explain:'0.95⁵ ≈ 0.774.'},
    {q:'What effect did stage 6 RAG prompts have in the capacity model?',options:['None','Goodput fell from 12.4 to 10.2 req/s, +22 % replicas','Halved the GPUs','Only affected decode'],answer:1,explain:'More uncached prompt tokens add prefill work; keep a stable prefix to recover cache hits.'},
    {q:'Which part of Atlas is lab-validated according to the lesson?',options:['10 M DAU multi-region operation','Multi-tenant chargeback at scale','MCP servers with tools, auth and tests, and single-GPU serving','Region failover game days'],answer:2,explain:'Stage 9 (multi-tenant, multi-region, millions of users) is design only.'},
    {q:'During a region loss, restricted Saudi personal-data features should…',options:['Fail over to any healthy region','Degrade (non-personal mode) or fail closed if no allowed region is healthy','Strip names and send abroad','Queue indefinitely'],answer:1,explain:'Policy-first routing: residency is never violated to preserve availability.'}
  ],
  flashcards:[
    {front:'Atlas stages 6–9',back:'6 RAG + ACLs · 7 MCP tools + approval-gated agent · 8 caching, observability, security, FinOps · 9 multi-tenant platform + multi-region for millions.'},
    {front:'Agent compounding failure',back:'P(success) = pᵏ; 0.95⁵ ≈ 0.77. Improve per-step reliability and reduce steps.'},
    {front:'Stage 9 control plane',back:'Tenant onboarding (identity, quotas, isolation tier, index, cost centre, audit), model catalog, policy store, chargeback, SLOs.'},
    {front:'Honesty rule for the capstone',back:'Say what you ran (with numbers) and what is design (with assumptions). Multi-region 10 M DAU is design only.'},
    {front:'Key joins to test',back:'RAG↔cache (ACL in key), agent↔tools (user-scoped), gateway↔engine (trace), usage↔chargeback, promotion↔regions, routing↔residency.'}
  ]
});

registerGlossary([
  {term:'Atlas',def:'The course’s fictional enterprise AI assistant for a GCC travel company, built progressively from a tiny model (stage 1) to a multi-region, multi-tenant platform (stage 9).',lesson:'v2-capstone-platform'},
  {term:'Paved road',def:'A supported, pre-configured way to build on a platform (templates with tracing, policy and redaction built in) that is easier to use than unsupported shortcuts.',lesson:'v2-capstone-platform',aliases:['golden path']},
  {term:'Tenant onboarding',def:'Automated creation of identity, quotas, isolation tier, data namespaces, cost centre, audit stream and default SLOs for a new platform tenant.',lesson:'v2-capstone-platform'}
]);
