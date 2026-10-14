/* Volume 2, Part 1: Advanced AI architecture — platform planes and the AI gateway */
registerLesson({
  id:'v2-platform-architecture', vol:2, part:1, num:1,
  title:'The end-to-end enterprise AI platform: planes, boundaries and ownership', minutes:85,
  summary:'An enterprise AI platform is not one model behind one endpoint. It is a set of planes with different jobs: an application plane that owns the product, a gateway that enforces identity, quotas and routing, a model-serving plane that turns tokens into answers on GPUs, a knowledge plane that retrieves permitted context, a learning plane that trains and evaluates models, and a control plane that configures, observes and budgets everything. Separating these planes, and naming an owner for each, is what makes the system debuggable, scalable and safe. This lesson walks one request through all of them with a real latency budget.',
  objectives:[
    'Draw the complete enterprise AI platform and place every major component in the correct plane.',
    'Explain the difference between control plane and data plane, and why the data plane must survive a control-plane outage.',
    'Separate the application plane from the model-serving plane, and the knowledge plane from the learning plane, with clear contracts between them.',
    'Build a RACI-style ownership table for an AI platform and use it during an incident.',
    'Construct a TTFT and end-to-end latency budget for a RAG chat request and identify which plane owns each term.'
  ],
  prereqs:['v1-inference-anatomy','v1-k8s-serving','v1-ai-apps-tools'],
  next:['v2-ai-gateway','v2-cache-map','v2-rag-fundamentals','v2-ai-observability','v2-capstone-platform'],
  tags:['architecture','platform','ownership','latency'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Think of an international airport. Check-in identifies passengers and enforces baggage limits. Air traffic control decides which runway each aircraft uses. The aircraft do the expensive work. Catering and fuel are loaded from separate supply chains. The airport authority sets rules, schedules and budgets, but it does not fly planes. If the authority’s office loses power, aircraft already cleared keep flying. Now the real mechanism.')}
<p>An <b>enterprise AI platform</b> is the shared set of services that lets many product teams put models into production safely and cheaply. Its parts fall naturally into <b>planes</b>: groups of components with one job, one owner and one failure behaviour.</p>
${table(['Plane','Job','Typical components'],[
 ['<b>Application plane</b>','Owns the user experience and business logic','web/mobile apps, chat backends, agent orchestrators, prompt templates, tool code'],
 ['<b>Gateway (edge of the AI data plane)</b>','Single front door to every model','authn/z, tenant token quotas, rate limits, model routing, fallback, guardrail hooks, metering, audit — see '+L('v2-ai-gateway','the AI gateway lesson')],
 ['<b>Model-serving plane</b>','Turns tokens into tokens on accelerators','inference routers, vLLM/SGLang/TensorRT-LLM engines, KV caches, GPU node pools, external model APIs'],
 ['<b>Knowledge (retrieval) plane</b>','Supplies permitted, fresh context','ingestion, chunking, embedding service, vector + keyword indexes, rerankers, ACL sync, retrieval caches'],
 ['<b>Learning plane</b>','Produces and validates models','data pipelines, feature stores, training/fine-tuning jobs, evaluation harness, model registry'],
 ['<b>Control plane</b>','Configures, deploys, observes and budgets all planes','GitOps (Argo CD), policy service, model and prompt registries, quota definitions, observability, FinOps, secrets']
])}
<p>Two cross-cutting distinctions organise the table. <b>Control plane versus data plane</b>: the data plane touches every request; the control plane changes configuration. <b>Application versus model-serving</b>: the application decides <i>what</i> to ask; the serving plane decides <i>how</i> to compute it. Keeping those apart is what lets one GPU fleet serve fifty products.</p>

<h2>2. Why do we need it?</h2>
<p>Most organisations start with each team calling a model API directly from its own service. That works for one team. At ten teams it fails in predictable ways:</p>
<ul>
<li><b>No cost control.</b> Every team holds its own provider key. Nobody can say which product spent the money, or stop one runaway agent loop from consuming the monthly budget.</li>
<li><b>No consistent security.</b> PII masking, prompt-injection checks and data-residency rules are re-implemented (or forgotten) in every service.</li>
<li><b>No capacity sharing.</b> Self-hosted models get one GPU deployment per team, each 20 % utilised, because nobody can share safely.</li>
<li><b>No debuggability.</b> When an answer is wrong, nobody knows whether retrieval was stale, the prompt changed, the model was swapped, or the GPU queue timed out, because no shared trace crosses those boundaries.</li>
<li><b>No model agility.</b> Switching to a cheaper or better model requires code changes in every application.</li>
</ul>
<p>Platform planes solve these by putting each concern in exactly one place, with an owner and an SLO. It is the same move DevOps made when it stopped every team from running its own load balancer and CI server.</p>

<h2>3. How does it work internally?</h2>
<h3>The full picture</h3>
${fig('The enterprise AI platform: planes, data path and control path', svgDiagram({w:900,h:520,
 zones:[
  {x:10,y:10,w:880,h:84,label:'Application plane (product teams)'},
  {x:10,y:104,w:880,h:84,label:'AI gateway (data plane edge, platform team)'},
  {x:10,y:198,w:430,h:150,label:'Model-serving plane (AI platform / GPU team)'},
  {x:450,y:198,w:440,h:150,label:'Knowledge plane (data / search team)'},
  {x:10,y:358,w:430,h:72,label:'Learning plane (ML team)'},
  {x:450,y:358,w:440,h:72,label:'Control plane (platform, security, FinOps)',cls:'ok'},
  {x:10,y:440,w:880,h:72,label:'Shared foundations',cls:'danger'}
 ],
 boxes:[
  {id:'app',x:30,y:34,w:150,h:50,label:'Chat backend',sub:'Atlas assistant'},
  {id:'agent',x:200,y:34,w:150,h:50,label:'Agent runtime',sub:'tools, approvals'},
  {id:'tools',x:370,y:34,w:150,h:50,label:'MCP tool servers',sub:'bookings, ops'},
  {id:'pb',x:540,y:34,w:150,h:50,label:'Prompt builder',sub:'templates'},
  {id:'gw',x:30,y:128,w:200,h:50,label:'AI gateway',sub:'auth, quota, route',cls:'hl'},
  {id:'guard',x:250,y:128,w:170,h:50,label:'Guardrails',sub:'pre / post hooks'},
  {id:'meter',x:440,y:128,w:170,h:50,label:'Metering + audit',sub:'tokens, cost'},
  {id:'ext',x:630,y:128,w:240,h:50,label:'External model APIs',sub:'managed providers'},
  {id:'rt',x:30,y:224,w:180,h:50,label:'Inference router',sub:'KV / prefix aware'},
  {id:'eng',x:230,y:224,w:190,h:50,label:'Engines on GPUs',sub:'vLLM / SGLang'},
  {id:'kv',x:30,y:288,w:390,h:48,label:'KV cache tiers: HBM → CPU → SSD',cls:'v2'},
  {id:'ret',x:470,y:224,w:190,h:50,label:'Retrieval service',sub:'hybrid + rerank'},
  {id:'vdb',x:680,y:224,w:190,h:50,label:'Vector + keyword index',sub:'ACL metadata'},
  {id:'ing',x:470,y:288,w:400,h:48,label:'Ingestion: parse → chunk → embed → index',cls:'v2'},
  {id:'train',x:30,y:380,w:190,h:42,label:'Train / fine-tune / eval'},
  {id:'reg',x:240,y:380,w:180,h:42,label:'Model registry'},
  {id:'git',x:470,y:380,w:190,h:42,label:'GitOps + policy'},
  {id:'obs',x:680,y:380,w:190,h:42,label:'Observability + FinOps'},
  {id:'k8s',x:30,y:462,w:400,h:40,label:'Kubernetes, GPU node pools, networking, IAM'},
  {id:'data',x:470,y:462,w:400,h:40,label:'Object storage, data lake, secrets, KMS'}
 ],
 arrows:[
  {from:'app',to:'gw',fromSide:'bottom',toSide:'top',cls:'hl'},
  {from:'gw',to:'rt',fromSide:'bottom',toSide:'top',cls:'hl'},
  {from:'rt',to:'eng',cls:'hl'},
  {from:'pb',to:'ret',fromSide:'bottom',toSide:'top',cls:'dash'},
  {from:'gw',to:'ext',fromSide:'right',toSide:'left',cls:'dash'},
  {from:'reg',to:'eng',fromSide:'top',toSide:'bottom',cls:'dash',label:'weights'}
 ]
}), 'Solid highlighted arrows are the per-request data path. Dashed arrows are retrieved context, external calls and model artifacts. The control plane (green) changes how the data plane behaves but is not called on each request. The red band is shared infrastructure every plane depends on, so its failures are the widest.')}

<h3>Control plane versus data plane</h3>
<p>This split is familiar from Kubernetes (API server and controllers versus kubelet and kube-proxy) and from Envoy (xDS management server versus the proxy). It applies to AI platforms in the same way:</p>
${table(['','Data plane','Control plane'],[
 ['Touched per request?','Yes — every token passes through it','No — only when configuration changes'],
 ['Examples','gateway proxies, guardrail classifiers, routers, engines, retrieval service, caches','Argo CD, model and prompt registries, policy service, quota definitions, routing tables, eval gates, dashboards'],
 ['Latency budget','Milliseconds, part of TTFT','Seconds to minutes'],
 ['Availability target','Highest (it is the product)','Lower, if the data plane is statically stable'],
 ['Failure behaviour required','Keep serving with last known good config','Pause changes; never take the data plane down with it'],
 ['Scale driver','Requests and tokens per second','Number of tenants, models, deployments']
])}
<p><b>Static stability</b> is the key property: every data-plane component caches its configuration locally (routing tables, quota limits, prompt templates, guardrail models) and keeps working on the last known good version if the control plane is unreachable. A gateway that calls the policy service synchronously on every request has turned the control plane into data plane, and its outage becomes yours.</p>
${callout('devops','DevOps bridge','This is exactly why kube-proxy keeps forwarding traffic when the API server is down, and why Envoy keeps its last xDS snapshot. Where the analogy breaks: AI config also includes large artifacts (model weights, guardrail models, embedding models). "Last known good" must include those artifacts being present on local disk, not only small YAML.')}

<h3>Application plane versus model-serving plane</h3>
<p>The application plane owns <b>prompts, tools, conversation state and product logic</b>. The model-serving plane owns <b>compute</b>: which model, which replica, how many GPUs, which engine flags. The contract between them is narrow: an OpenAI-compatible API (chat completions or responses), a model alias such as <code>atlas-chat-default</code>, and declared limits (max input and output tokens, priority class). Because applications call an alias, the platform can move the alias from a 70B model to a fine-tuned 8B model, or from self-hosted to a provider, without touching application code — provided evaluation gates in the learning plane approve it.</p>

<h3>The knowledge plane</h3>
<p>Retrieval is a separate plane because its freshness, permissions and scaling differ from GPUs. Its core loop is offline (ingest, parse, chunk, embed, index, sync ACLs) and its online path is a search call with an identity attached. It needs its own SLOs: retrieval p95 latency, index freshness lag, and ACL sync lag. The deep dives are ${L('v2-rag-fundamentals','RAG fundamentals')} and ${L('v2-rag-production','production RAG')}.</p>

<h3>The learning plane</h3>
<p>Training, fine-tuning, distillation and evaluation run as batch workloads with bursty, large GPU needs and access to sensitive training data. Its output is a <b>versioned, signed artifact</b> in a registry, plus an evaluation report. It never serves traffic. Keeping it apart (often in a separate account or cluster) protects serving capacity from training jobs and limits who can read raw training data. See ${L('v2-mlops-foundations','MLOps foundations')} and ${L('v2-model-cicd','model CI/CD')}.</p>

<h3>The request journey and its latency budget</h3>
<p>The animation follows one RAG chat request through every plane. Read the numbers as an <b>illustrative budget</b>: the method is what matters.</p>
${anim('v2-arch-journey')}
${formula(`
Target: p95 TTFT ≤ 1,500 ms for a RAG chat request (illustrative budget)

STEP 1  Edge + WAF                                   20 ms
STEP 2  AI gateway (auth, quota, route)              15 ms
STEP 3  Input guardrail                              60 ms
STEP 4  Retrieval  = 25 (embed) + 60 (search) + 80 (rerank)
                   = 165 ms
STEP 5  Prompt build                                 10 ms
        ─────────────────────────────────────────────────
        Before the GPU                              270 ms

STEP 6  Queue for a replica (p95)                   150 ms
STEP 7  Prefill  = 6,000 tokens ÷ 12,000 tok/s     = 500 ms
                    ↑ measured prefill rate at load, not a spec sheet
STEP 8  First token back to client                   30 ms
        ─────────────────────────────────────────────────
        TTFT = 270 + 150 + 500 + 30                 = 950 ms   (550 ms headroom)

STEP 9  Decode = 300 output tokens × 25 ms TPOT    = 7,500 ms
        End-to-end ≈ 950 + 7,500                    = 8,450 ms

STEP 10 With a 2,000-token prefix-cache hit:
        Prefill = 4,000 ÷ 12,000                    = 333 ms
        TTFT    = 270 + 150 + 333 + 30              = 783 ms

ANSWER  The GPU owns about half of TTFT (650 of 950 ms) but almost all of
        end-to-end time. Retrieval and guardrails own 225 ms of TTFT and
        need their own SLOs and owners.
`)}
<p>Compare with the older course’s example (ingress 40 + retrieval 250 + queue 900 + prefill 400 + decode 2,200 + network 210 = 4,000 ms). That arithmetic is right, and its lesson — a faster GPU does not remove a 900 ms queue — still holds. What it missed: it added decode into a single "answer time", hiding the fact that users judge streaming chat mostly by TTFT, and that TTFT and decode have different owners and different fixes.</p>

<h2>4. Where does it fit?</h2>
<p>This lesson is the map for all of Volume 2. Every later part zooms into one plane:</p>
${table(['Plane','Deep-dive lessons'],[
 ['Gateway',L('v2-ai-gateway','AI gateway and routing')],
 ['Caching across planes',L('v2-cache-map','the caching map')+' → '+L('v2-cache-ops','cache operations')],
 ['Model-serving',L('v2-distributed-inference','distributed inference')+', '+L('v2-hyperscale-serving','hyperscale serving')+', '+L('v2-multi-region','multi-region')],
 ['Knowledge',L('v2-rag-fundamentals','RAG fundamentals')+', '+L('v2-rag-production','production RAG')],
 ['Application (agents, tools)',L('v2-mcp-why','MCP')+', '+L('v2-agents','agents')+', '+L('v2-a2a-multiagent','A2A')],
 ['Learning',L('v2-mlops-foundations','MLOps')+', '+L('v2-model-cicd','model CI/CD')+', '+L('v2-evaluation-monitoring','evaluation')],
 ['Control plane',L('v2-ai-observability','observability')+', '+L('v2-finops-unit-economics','FinOps')+', '+L('v2-governance','governance')]
])}

<h3>Deployment boundaries</h3>
<p>Planes are logical. Deployment boundaries are physical: accounts, clusters, VPCs and regions. A common, defensible layout:</p>
${fig('Deployment boundaries for one region', svgDiagram({w:900,h:300,
 zones:[
  {x:10,y:10,w:280,h:280,label:'Edge + platform account'},
  {x:300,y:10,w:290,h:280,label:'Serving account (GPU clusters)'},
  {x:600,y:10,w:290,h:135,label:'Data / knowledge account',cls:'danger'},
  {x:600,y:155,w:290,h:135,label:'Training account (isolated)',cls:'danger'}
 ],
 boxes:[
  {id:'cdn',x:30,y:40,w:240,h:46,label:'CDN, WAF, load balancer'},
  {id:'gw',x:30,y:110,w:240,h:46,label:'AI gateway cluster (CPU)',cls:'hl'},
  {id:'obs',x:30,y:180,w:240,h:46,label:'Observability, GitOps'},
  {id:'pool1',x:320,y:40,w:250,h:46,label:'Interactive GPU pool'},
  {id:'pool2',x:320,y:110,w:250,h:46,label:'Batch / embedding pool'},
  {id:'guard',x:320,y:180,w:250,h:46,label:'Guardrail models (small GPU)'},
  {id:'vdb',x:620,y:40,w:250,h:46,label:'Vector DB, document store'},
  {id:'ing',x:620,y:95,w:250,h:40,label:'Ingestion pipelines'},
  {id:'tr',x:620,y:185,w:250,h:46,label:'Training jobs, raw data'},
  {id:'reg',x:620,y:240,w:250,h:40,label:'Registry (signed models)'}
 ],
 arrows:[{from:'cdn',to:'gw',cls:'hl'},{from:'gw',to:'pool1',cls:'hl'},{from:'reg',to:'pool1',cls:'dash',label:'pull'},{from:'pool1',to:'vdb',cls:'dash'}]
}), 'Training data never crosses into serving; only signed artifacts do (dashed "pull"). Red zones hold the most sensitive data and get the strictest IAM. The gateway is CPU-only and scales independently of GPUs.')}
<p>Data residency sets the outer boundary. For Saudi personal data under the PDPL, the region choice matters: as of Oct 2026, Google Cloud’s Dammam region (<code>me-central2</code>) is live, the AWS Saudi Arabia region has been announced but is not yet open, and Microsoft has announced its Saudi Arabia East region for November 2026. Re-check before you design; ${L('v2-multi-region','the multi-region lesson')} covers degraded modes and residency in depth.</p>

<h2>5. How does it connect to other components?</h2>
<p>The planes connect through a small number of explicit contracts. Write them down; most incidents happen at an undocumented contract.</p>
${table(['From → to','Contract','What breaks if it is implicit'],[
 ['Application → gateway','OpenAI-compatible API, model alias, tenant identity (JWT), declared max tokens, priority class','Apps hard-code provider models; no quota attribution'],
 ['Gateway → serving','Routed request + trace context + tenant tags; usage returned in the response','Cost cannot be charged back; traces break at the GPU'],
 ['Application → knowledge','Search API with the end user’s identity, not a service account','A service account can read everything → permission leaks through RAG'],
 ['Learning → control plane','Signed model artifact + eval report + model card','Unevaluated models reach production'],
 ['Control plane → data plane','Versioned config snapshots pulled and cached locally','A control-plane outage becomes a data-plane outage'],
 ['All planes → observability','OpenTelemetry traces with GenAI attributes, token-usage metrics','No end-to-end latency budget, no unit cost']
])}
<p>For telemetry, the OpenTelemetry GenAI conventions moved in 2026 to a separate repository (<code>semantic-conventions-genai</code>) and the old <code>gen_ai.client.token.usage</code> histogram has been replaced by usage counters such as <code>gen_ai.client.inference.usage.input_tokens</code> and <code>…cache_read.input_tokens</code>. Many shipping instrumentations still emit the older name, so dashboards must handle both (details in ${L('v2-ai-observability','AI observability')}).</p>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<p>Ownership is the real architecture. A RACI table (Responsible, Accountable, Consulted, Informed) for a mid-size platform:</p>
${table(['Activity','Product / app team','AI platform team','Data / search team','ML team','Security','FinOps','SRE'],[
 ['Prompt templates and tools','<b>A/R</b>','C','I','C','C','I','I'],
 ['Gateway policies (quotas, routes)','C','<b>A/R</b>','I','C','C','C','I'],
 ['Inference SLO (TTFT, TPOT)','I','<b>A/R</b>','I','C','I','I','C'],
 ['GPU capacity and engine config','I','<b>A/R</b>','I','C','I','C','C'],
 ['Retrieval freshness and ACL sync','I','I','<b>A/R</b>','I','C','I','C'],
 ['Model selection and eval gates','C','C','I','<b>A/R</b>','C','C','I'],
 ['Guardrail policy content','C','R','I','C','<b>A</b>','I','I'],
 ['Unit-cost method and chargeback','C','R','C','I','I','<b>A</b>','I'],
 ['Incident command for AI outages','C','R','R','C','C','I','<b>A</b>'],
 ['"Wrong answer" investigations','<b>A</b>','R','R','R','C','I','I']
])}
<p>Note the last row. A wrong answer is owned by the product team (accountable for the user outcome) but needs responsible investigators in three planes, because the cause can be the prompt, stale retrieval, or the model. That row is where platforms without clear ownership lose days.</p>
${callout('devops','DevOps bridge','Treat each plane like a service with an SLO, a runbook and an on-call rotation, as you already do for databases and ingress. What is new: some failures are <i>quality</i> failures (a confident wrong answer with HTTP 200). Your alerting must include evaluation signals, not only error rates.')}
<p>What you directly operate as the platform engineer: the gateway cluster, the inference routers and GPU pools, the cache tiers, the observability pipeline, GitOps for all of it, and the quota and cost data that FinOps consumes.</p>

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Most likely plane','Evidence','First action'],[
 ['Wrong answers, GPUs at 35 % and healthy','Knowledge or application','Trace: retrieved chunk ids and doc versions, prompt template version','Check index freshness lag and recent prompt changes before touching GPUs'],
 ['TTFT p95 doubled, TPOT flat','Serving (queue) or retrieval','Span breakdown: queue time vs retrieval vs prefill','If queue: scale or shed; if retrieval: check reranker/vector DB latency'],
 ['All requests 401/403 after a deploy','Gateway or IdP','Gateway auth logs, JWKS fetch errors','Roll back gateway config; check cached JWKS'],
 ['Cannot deploy or change quotas; traffic fine','Control plane','Argo CD / policy service health','Expected under static stability; fix control plane, no user impact'],
 ['Traffic fails when policy service is down','Gateway design flaw','Synchronous call from gateway to policy service','Cache policy locally; treat as a design bug'],
 ['One tenant consumes all GPU capacity','Gateway','Per-tenant token rate vs quota','Enforce token quotas and priority classes'],
 ['Training job slows serving','Missing boundary','Shared node pool or shared network','Separate pools/accounts; priority classes']
])}
<div class="dtree"><ul><li><span class="q">A user reports a bad or slow answer — which plane?</span><ul>
<li><span class="a">slow</span>Open the trace. The largest span owns it: queue/prefill → serving; search/rerank → knowledge; guardrail → gateway hooks.</li>
<li><span class="a">wrong</span>Check retrieved documents and versions first, then the prompt template version, then the model version. Only then the model itself.</li>
<li><span class="a">refused</span>Check guardrail verdicts and quota decisions in the gateway audit record.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Each plane scales on its own signal.</b> Gateway: CPU and connections. Serving: queue depth, KV usage, TTFT (see ${L('v1-k8s-autoscaling','GPU autoscaling')}). Knowledge: query rate and index size. Learning: job queue. One HPA rule for "the AI service" is a smell.</li>
<li><b>Share the expensive plane.</b> One model-serving fleet for many products, separated by priority classes and tenant quotas, beats one fleet per product. Utilisation is the cost lever.</li>
<li><b>Cell-based scale-out.</b> At large scale, replicate the whole data plane per region or per cell (gateway + serving + knowledge replicas) with a thin global routing layer. A cell failure affects a fraction of tenants.</li>
<li><b>Keep the control plane off the hot path</b> so it can scale with tenants and deployments, not with requests.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>Platform structure creates three cost levers that individual teams cannot pull alone:</p>
${formula(`
Illustrative: 5 product teams, each with its own self-hosted 8B deployment

Per team: 2 GPUs for redundancy, average utilisation 20 %
Total:    5 × 2 = 10 GPUs, average useful work = 10 × 0.20 = 2 GPU-equivalents

Shared pool at a target 60 % average utilisation (with headroom):
GPUs needed ≈ 2 ÷ 0.60 ≈ 3.3 → 4 GPUs (round up, keep N+1)

Saving ≈ (10 − 4) ÷ 10 = 60 % of GPU hours
           ↑ only possible with tenant quotas, priority classes and a shared gateway
`)}
<ol>
<li><b>Consolidation</b> (above): shared pools, enforced by the gateway.</li>
<li><b>Routing</b>: send each task to the cheapest model that passes its evaluation (${L('v2-ai-gateway','model routing')}).</li>
<li><b>Caching</b>: the next six lessons show how to avoid recomputation at every layer, starting with ${L('v2-cache-map','the caching map')}.</li>
</ol>
<p>All three depend on <b>metering</b>: you cannot optimise what you cannot attribute to a tenant and a use case (${L('v2-finops-unit-economics','unit economics')}).</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Walk me through the architecture of an enterprise AI platform.”','<p><i>Answer (≈60 s):</i> "I split it into planes with separate owners. Applications own prompts, tools and product logic and call one AI gateway through an OpenAI-compatible API with model aliases. The gateway handles identity, token quotas per tenant, routing and fallback, guardrail hooks, metering and audit. Behind it, the model-serving plane runs routers and engines like vLLM on GPU pools, plus external providers. A knowledge plane handles ingestion, embeddings, hybrid search and ACLs, with its own freshness SLO. A learning plane trains and evaluates models and publishes signed artifacts to a registry. A control plane — GitOps, policy, registries, observability and FinOps — configures everything but is not on the request path, so the data plane keeps serving if it fails. Then I’d show a latency budget: for a RAG chat about half of TTFT is GPU prefill and queue, the rest is retrieval and guardrails, which is why each plane needs its own SLO."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"We deploy the model on Kubernetes with GPUs behind an API gateway and add a vector database for RAG."</p><p>Lists components, no planes, no ownership, no control/data split, no numbers.</p></div><div class="good"><h4>Strong answer</h4><p>Names planes and owners, explains static stability, gives the contracts between planes, and quantifies a latency budget showing which team owns which milliseconds.</p></div></div>

<h3>Capstone thread: Atlas</h3>
<p>Atlas so far (Volume 1) is a fine-tuned small model served by vLLM on a GPU node pool with Helm, probes and GitOps. In Volume 2 it becomes a platform: a gateway in front (next lesson), caches at four layers (Part 2), RAG over policy documents (stage 6), MCP tools and agents (stage 7), and finally multi-region, multi-tenant operation (${L('v2-capstone-platform','capstone')}). The diagrams in this lesson are a <b>design</b>; the lab-validated parts remain the single-region serving stack. Say exactly that in an interview.</p>

<div class="connections"><h4>How this connects</h4>
${chain(['Application plane','AI gateway','Model-serving plane','GPU + KV cache','tokens back'])}
${chain(['Knowledge plane','permitted context','prompt','prefill cost','TTFT'])}
${chain(['Learning plane','signed artifact','control plane','alias switch','no app change'])}
<p>Next: ${L('v2-ai-gateway','the AI gateway')} in detail. Then the caching masterclass starting at ${L('v2-cache-map','the caching map')}, which shows how each plane avoids repeated work.</p></div>
`,
  quiz:[
    {q:'The policy service that holds tenant quotas is down. A well-designed gateway should…',options:['Reject all requests until policy is reachable','Keep enforcing the last known good quota configuration from its local cache','Disable quotas and let everything through','Fail over to the learning plane'],answer:1,explain:'Static stability: the data plane keeps working with its last known good config. Rejecting everything turns a control-plane outage into a user outage; disabling quotas removes cost and fairness protection.'},
    {q:'In the latency budget, TTFT is 950 ms and end-to-end is 8,450 ms. Which change reduces TTFT but NOT decode time?',options:['Prefix caching of the system prompt','A faster TPOT from FP8 weights','Shorter answers','Speculative decoding'],answer:0,explain:'Prefix caching removes prefill work, which is part of TTFT. The other options mainly speed decode or shorten it.'},
    {q:'Who should be accountable for retrieval freshness and ACL synchronisation?',options:['The GPU team','The data / search team that owns the knowledge plane','The FinOps team','Every product team separately'],answer:1,explain:'The knowledge plane has its own owner and SLOs (freshness lag, ACL sync lag). Spreading it across product teams recreates the problem platforms exist to solve.'},
    {q:'Why should applications call a model alias rather than a specific provider model name?',options:['Aliases are cheaper per token','The platform can switch the backing model after evaluation without application code changes','Providers require it','It disables caching'],answer:1,explain:'The alias is the contract between application and serving planes. It enables routing, migration and fallback centrally.'},
    {q:'Users report wrong answers; GPUs are healthy at 35 % utilisation. The best first step is…',options:['Add GPUs','Inspect the trace for retrieved documents, their versions and the prompt template version','Restart the engine','Lower the temperature'],answer:1,explain:'Wrong answers with healthy GPUs usually come from stale or missing retrieval or a prompt change. Capacity changes do not fix quality.'}
  ],
  flashcards:[
    {front:'Six planes of an enterprise AI platform',back:'Application, gateway (data-plane edge), model-serving, knowledge/retrieval, learning, control.'},
    {front:'Control plane vs data plane',back:'Data plane touches every request (ms budget, highest availability). Control plane changes config (not on the hot path). Data plane must be statically stable.'},
    {front:'Static stability',back:'Data-plane components cache config and artifacts locally and keep serving on last known good when the control plane is down.'},
    {front:'Illustrative TTFT budget for RAG chat',back:'Edge 20 + gateway 15 + guardrail 60 + retrieval 165 + prompt 10 + queue 150 + prefill 500 + network 30 = 950 ms.'},
    {front:'Why TTFT and end-to-end are separate SLOs',back:'TTFT is dominated by queue + prefill + pre-GPU hops; end-to-end by decode (output tokens × TPOT). Different owners and levers.'},
    {front:'Biggest cost lever a platform creates',back:'Consolidating per-team GPU deployments into shared pools, made safe by tenant token quotas and priority classes.'}
  ]
});
registerGlossary([
  {term:'Control plane',def:'Components that configure, deploy, observe and budget a system but are not called on each request (GitOps, registries, policy, quota definitions).',lesson:'v2-platform-architecture'},
  {term:'Data plane',def:'Components on the per-request path (gateway proxies, guardrails, routers, inference engines, retrieval, caches).',lesson:'v2-platform-architecture'},
  {term:'Static stability',def:'A design property where the data plane keeps working on its last known good configuration when the control plane is unavailable.',lesson:'v2-platform-architecture'},
  {term:'Knowledge plane',def:'The part of an AI platform that ingests, indexes and retrieves permitted context for prompts, with its own freshness and ACL SLOs.',lesson:'v2-platform-architecture',aliases:['retrieval plane']},
  {term:'Learning plane',def:'Training, fine-tuning and evaluation infrastructure that produces signed, versioned model artifacts but never serves traffic.',lesson:'v2-platform-architecture'},
  {term:'Model alias',def:'A stable name applications call (e.g. atlas-chat-default) that the platform maps to a concrete model and route, enabling migration without code changes.',lesson:'v2-platform-architecture'},
  {term:'RACI',def:'Responsible, Accountable, Consulted, Informed: a table assigning ownership of each activity to teams.',lesson:'v2-platform-architecture'}
]);

registerLesson({
  id:'v2-ai-gateway', vol:2, part:1, num:2,
  title:'AI gateway, model routing and request orchestration', minutes:90,
  summary:'The AI gateway is the single front door between applications and every model, self-hosted or external. It authenticates callers, maps them to tenants, enforces quotas counted in tokens rather than requests, chooses a model by task, cost and latency, retries and falls back safely, runs guardrail checks, meters cost from the usage the model reports, and writes an audit record. Streaming changes the retry rules: once the first token reaches the user, a silent retry is no longer safe. This lesson explains each responsibility, compares the main products by what they actually do, and shows how routing and fallback work step by step.',
  objectives:[
    'List the responsibilities of an AI gateway and explain why each belongs there and not in applications.',
    'Design token-based tenant quotas and rate limits, including how input is estimated before a call and charged after it.',
    'Design a routing policy by task, cost, latency and fallback, and explain the difference between an AI gateway and an inference gateway (endpoint picker).',
    'Explain when retries are safe for streaming responses and how idempotency keys protect tool side effects.',
    'Meter cost correctly from provider usage fields, including cached input tokens.',
    'Compare LiteLLM, Envoy AI Gateway (now Agent Router), Kong AI Gateway and cloud gateways by responsibility.'
  ],
  prereqs:['v2-platform-architecture','v1-ai-apps-tools','v1-k8s-serving'],
  next:['v2-cache-map','v2-response-semantic-cache','v2-hyperscale-serving','v2-finops-optimization','v2-governance'],
  tags:['gateway','routing','quotas','finops','security'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A corporate travel desk: every employee books through it. It checks who you are, applies your department’s budget, picks the cheapest airline that meets the policy, rebooks you if a flight is cancelled before boarding (but cannot un-fly half a trip), and sends finance a receipt for every booking. Now the real mechanism.')}
<p>An ${term('AI gateway')} is a reverse proxy specialised for model traffic. Applications send requests in one format (almost always the OpenAI-compatible chat completions or responses API) to one endpoint. The gateway decides which model and which backend serve the request, enforces policy before and after the call, and records what happened.</p>
<p>It is different from your existing API gateway in three ways: it counts <b>tokens</b>, not requests; it understands <b>streaming</b> responses whose cost is known only at the end; and it can <b>change the backend model</b> per request based on task, cost, latency or failures.</p>

<h2>2. Why do we need it?</h2>
${table(['Without a gateway','With a gateway'],[
 ['Each team holds provider API keys in its own secrets','Provider keys live only in the gateway; teams get virtual keys or use workload identity'],
 ['Rate limits are per provider account, shared by everyone','Per-tenant token quotas and priorities; one runaway agent cannot starve others'],
 ['Model choice is hard-coded in each app','Model aliases routed centrally; migrations and A/B tests without code changes'],
 ['Provider outage = product outage','Fallback chains across providers and self-hosted pools'],
 ['Cost appears as one monthly invoice','Cost per tenant, per use case, per request, from metered usage'],
 ['Guardrails re-implemented per team','Pre- and post-call hooks applied uniformly'],
 ['No record of who sent what to which model','Audit log with identity, route, policy decisions and token counts']
])}

<h2>3. How does it work internally?</h2>
<p>Follow one request through the gateway’s pipeline. Each stage is a responsibility you can own, test and observe separately.</p>
${fig('The AI gateway request pipeline', svgDiagram({w:900,h:250,
 boxes:[
  {id:'a',x:10,y:30,w:120,h:56,label:'AuthN / AuthZ',sub:'JWT, virtual key'},
  {id:'b',x:150,y:30,w:120,h:56,label:'Quota check',sub:'estimated tokens'},
  {id:'c',x:290,y:30,w:120,h:56,label:'Pre-call hooks',sub:'PII, injection'},
  {id:'d',x:430,y:30,w:120,h:56,label:'Cache lookup',sub:'exact / semantic'},
  {id:'e',x:570,y:30,w:120,h:56,label:'Route',sub:'task, cost, latency',cls:'hl'},
  {id:'f',x:710,y:30,w:170,h:56,label:'Call backend',sub:'retry before 1st byte',cls:'hl'},
  {id:'g',x:710,y:150,w:170,h:56,label:'Stream + post hooks',sub:'output checks'},
  {id:'h',x:500,y:150,w:180,h:56,label:'Meter usage',sub:'in / cached / out'},
  {id:'i',x:290,y:150,w:180,h:56,label:'Charge quota',sub:'after completion'},
  {id:'j',x:80,y:150,w:180,h:56,label:'Audit + trace',sub:'OTel spans'}
 ],
 arrows:[{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'d'},{from:'d',to:'e'},{from:'e',to:'f'},{from:'f',to:'g',fromSide:'bottom',toSide:'top'},{from:'g',to:'h'},{from:'h',to:'i'},{from:'i',to:'j'}]
}), 'Top row runs before the model is called and adds latency to TTFT, so each stage needs a budget (the whole row is often 10–30 ms without guardrail models). Bottom row runs during and after streaming.')}

<h3>3.1 Authentication and authorisation</h3>
<p>The gateway turns a credential into a <b>principal</b> (who), a <b>tenant</b> (whose budget), and <b>entitlements</b> (which model aliases, which data classes, which regions). Common patterns:</p>
<ul>
<li><b>Virtual keys</b>: the gateway issues its own keys per team or app, each mapped to a tenant, budget and allowed models. Provider keys never leave the gateway.</li>
<li><b>OIDC/JWT</b> from your identity provider for user-facing traffic; the gateway validates signatures against cached JWKS (static stability again).</li>
<li><b>Workload identity / mTLS</b> for service-to-service calls inside the cluster.</li>
</ul>
<p>Authorisation is more than "may call the API": it includes <i>may this tenant send data classified as personal to an external provider</i>, and <i>may this tenant use the expensive model</i>.</p>

<h3>3.2 Tenant quotas in tokens and rate limiting</h3>
<p>GPU and provider cost scale with tokens, so limits must be in tokens. A request-per-second limit treats a 50-token classification and a 50,000-token document summary the same.</p>
${table(['Limit','Unit','Purpose'],[
 ['Tokens per minute (TPM)','input + output tokens','Fair share of capacity over short windows'],
 ['Requests per minute','requests','Protects against floods of tiny requests'],
 ['Concurrent streams','open streams','Protects KV-cache capacity on self-hosted pools'],
 ['Max tokens per request','input and output separately','Bounds worst-case latency and KV memory'],
 ['Budget','currency per day/month','Hard spend cap per tenant or use case']
])}
<p>The hard part: <b>output length is unknown when the request arrives</b>. Gateways handle this in two phases. Before the call, they estimate input tokens (tokenise or approximate) and reject if the tenant is already over quota. After the response completes, they charge the <b>actual</b> usage reported by the model. Envoy AI Gateway, for example, documents exactly this: token costs (input, cached input, output, total, or a CEL expression) are computed from the response and charged after the response completes, so a stream is never cut off mid-way; the <i>next</i> request receives HTTP 429 if the budget is exhausted.</p>
${formula(`
Worked example: tenant budget 2,000,000 TPM (illustrative)

Typical request: 3,000 input + 500 output = 3,500 tokens
Sustainable rate  = 2,000,000 ÷ 3,500 ≈ 571 requests/min ≈ 9.5 requests/s

Overshoot from post-charging:
  100 requests admitted in the same second, each estimated 3,000 input
  actual output turns out 2,000 tokens each instead of 500
  extra = 100 × (2,000 − 500) = 150,000 tokens  ≈ 7.5 % of the minute budget
  ↑ bounded by max_tokens per request × concurrent streams; set both
`)}

<h3>3.3 Model routing</h3>
<p>Routing chooses a backend per request. Policies stack in this order:</p>
<ol>
<li><b>Hard constraints</b>: data class and region (PII only to approved backends), tenant entitlements, context length (a 150k-token prompt only goes to models that accept it).</li>
<li><b>Task</b>: classification, extraction and short chat go to small models; complex reasoning or code to large ones. The task comes from the alias the app calls, an explicit header, or a <b>router model</b>.</li>
<li><b>Cost and latency</b>: among eligible backends, choose by price per token, measured latency, or current load.</li>
<li><b>Fallback</b>: an ordered list for errors, rate limits, timeouts or context-window overflow.</li>
</ol>
<p>${term('Model router','Model routers')} learn the task step. RouteLLM (Ong et al., arXiv 2406.18665) trains routers on preference data to send each query to a strong or a weak model, trading a small quality loss for lower cost. Amazon Bedrock’s Intelligent Prompt Routing does this as a managed service within one model family, predicting response quality per request. Treat any router as a model: evaluate it on your traffic, monitor its decisions, and keep a rule-based override.</p>
${callout('note','AI gateway versus inference gateway','Two layers are both called "gateway". The <b>AI gateway</b> chooses <i>which model or provider</i>. The <b>inference gateway</b> (Kubernetes Gateway API Inference Extension, latest v1.6.2; llm-d Router) chooses <i>which pod</i> of a self-hosted model pool, using an endpoint picker that scores replicas on queue depth, KV usage, prefix-cache affinity and LoRA availability. A request passes through both: AI gateway → "self-hosted pool A" → inference gateway → pod 7. Caching lessons return to the second one in '+L('v2-distributed-kv','cache-aware routing')+'.')}

<h3>3.4 Request orchestration: retries, timeouts, fallback</h3>
${anim('v2-gw-fallback')}
<p>The rules that matter, and why streaming changes them:</p>
${table(['Situation','Safe to retry automatically?','Why'],[
 ['Connection refused / 503 before response headers','Yes, with backoff','No output reached the client; the request had no visible effect'],
 ['429 with retry-after','Yes, honour retry-after, or fall back','Capacity signal, not a request error'],
 ['Timeout before first token','Usually yes, once; then fall back','But beware: the backend may still be computing (wasted cost)'],
 ['400 invalid request / context too long','No; fix or route to a larger-context model','Retrying an invalid request repeats the failure'],
 ['Content-policy refusal','Not to the same model; policy decides if another model may be tried','Retrying to bypass a safety refusal can violate policy'],
 ['Stream broken after tokens were sent','<b>No silent retry</b>','The client already showed text; a retry generates a different answer and duplicates output'],
 ['Tool call with side effects (book, refund)','Only with an idempotency key','A retry could book twice']
])}
<p><b>Streaming and idempotency.</b> Text generation is not idempotent: sampling the same prompt twice gives different text unless temperature is 0 and the backend is deterministic, which most batched GPU serving does not guarantee. So the gateway can retry transparently only until the first byte goes to the client. After that, it should terminate the stream with an explicit error event, and the application decides whether to show "regenerate". For <b>actions</b> (tool calls that change state), the application must pass an <b>idempotency key</b> to the tool backend, so a retried call is recognised and not executed twice. That rule belongs in the MCP/tool layer (${L('v2-agents','agents lesson')}).</p>
<p><b>Hedging</b> (sending the same request to two backends and taking the first to respond) cuts tail latency but doubles cost for hedged requests. Use it only for short, cheap requests with strict TTFT targets, and cap the hedged fraction.</p>

<h3>3.5 The unified OpenAI-compatible API</h3>
<p>The de facto contract is the OpenAI-compatible HTTP API: <code>/v1/chat/completions</code>, increasingly <code>/v1/responses</code>, plus <code>/v1/embeddings</code> and <code>/v1/models</code>. vLLM serves all of these (and an Anthropic-compatible <code>/v1/messages</code>); TensorRT-LLM’s <code>trtllm-serve</code> and NVIDIA Dynamo’s frontend also expose OpenAI-compatible endpoints. The gateway translates to provider-native APIs where needed.</p>
${callout('warn','"Compatible" is not "identical"','Parameter support differs: structured-output fields, tool-call formats, reasoning settings, usage fields for cached tokens, and error codes vary across providers and engines. A unified API hides differences only for the common subset. Keep a per-backend capability matrix and contract tests in CI for each route.')}

<h3>3.6 Guardrail hooks</h3>
<p>Hooks run at three points: <b>pre-call</b> (input checks: PII detection and masking, prompt-injection classifiers, topic restrictions), <b>during streaming</b> (incremental output checks on chunks, which may cut a stream), and <b>post-call</b> (full-output checks, citations, JSON validation). Each hook is a dependency on the critical path: give it a latency budget, a timeout, and a <b>fail-open or fail-closed</b> decision written in policy. For regulated data, fail closed.</p>

<h3>3.7 Cost metering</h3>
<p>Meter from the <b>usage block the backend returns</b>, never from your own estimate. Watch the field semantics, because they differ:</p>
${table(['Source','Fields','Trap'],[
 ['Anthropic Messages API','<code>input_tokens</code>, <code>cache_creation_input_tokens</code>, <code>cache_read_input_tokens</code>, <code>output_tokens</code>','Total input = the sum of the three input fields; <code>input_tokens</code> alone excludes cached tokens'],
 ['OpenAI Responses API','<code>usage.input_tokens</code>, <code>usage.input_tokens_details.cached_tokens</code> (and <code>cache_write_tokens</code>), <code>output_tokens</code>','Cached tokens are a subset of input tokens'],
 ['vLLM','<code>usage.prompt_tokens</code>, <code>completion_tokens</code>; engine counters <code>vllm:prompt_tokens_total</code>, <code>vllm:prefix_cache_hits</code>','Self-hosted cost is GPU-hours, not tokens; tokens are the allocation key']
])}
${formula(`
Worked example: one request on Claude Opus 5.5 (prices as of Oct 2026, per million tokens)
  base input $4.00   output $20.00   cache read 0.05 × $4 = $0.20

Request: 8,000 tokens read from cache, 2,000 uncached input, 600 output

STEP 1  cache read   8,000 × $0.20 ÷ 10⁶  = $0.0016
STEP 2  input        2,000 × $4.00 ÷ 10⁶  = $0.0080
STEP 3  output         600 × $20.00 ÷ 10⁶ = $0.0120
STEP 4  total                              = $0.0216

Same request with no caching:
        10,000 × $4.00 ÷ 10⁶ + $0.0120     = $0.0520

ANSWER  Metering that ignores cache fields overstates this request by 2.4×,
        and chargeback to the tenant is wrong by the same factor.
`)}
<p>For self-hosted models, the gateway meters tokens per tenant and FinOps converts GPU-hours into a cost per token (${L('v2-finops-unit-economics','unit economics')}). OpenTelemetry GenAI conventions now define usage counters including cache read and write tokens (<code>gen_ai.client.inference.usage.cache_read.input_tokens</code>); older instrumentations emit <code>gen_ai.client.token.usage</code>.</p>

<h3>3.8 Audit</h3>
<p>One structured record per request: request id and trace id, principal, tenant, model alias and concrete route, fallback reason, guardrail verdicts, token counts, cost, latency breakdown, and a hash (not the text) of the prompt unless policy allows storing content. This record answers security ("who sent customer data to which provider?"), FinOps ("which use case spent this?") and incident questions from the same data.</p>

<h3>3.9 Products, described by responsibility</h3>
${table(['Product','What it is','Strongest at','Check before relying on'],[
 ['LiteLLM (proxy)','Open-source Python proxy and SDK with an OpenAI-compatible API to many providers','Breadth of providers; virtual keys and budgets; router strategies (<code>simple-shuffle</code> default, <code>least-busy</code>, <code>latency-based-routing</code>, <code>usage-based-routing-v2</code>, <code>cost-based-routing</code>); fallbacks, <code>num_retries</code>, cooldowns (<code>allowed_fails</code> default 3, <code>cooldown_time</code> default 5 s); caching backends incl. <code>redis</code>, <code>redis-semantic</code>, <code>qdrant-semantic</code>, <code>s3</code>, <code>disk</code>','Throughput and HA of the Python proxy at your scale; which features are enterprise-licensed'],
 ['Envoy AI Gateway → <b>Agent Router</b>','Envoy-Gateway-based AI gateway; renamed Agent Router (Agentic AI Foundation project), same code and API group <code>aigateway.envoyproxy.io</code>, CLI <code>aigw</code>; latest v1.2.0 (Oct 2026)','Kubernetes-native CRDs (<code>AIGatewayRoute</code>, <code>AIServiceBackend</code>, <code>BackendSecurityPolicy</code>, <code>QuotaPolicy</code>, <code>MCPRoute</code>); token-based rate limits by input, cached input, output or CEL cost; Envoy performance','CRD versions (v1alpha1/v1beta1) and the rename in docs and charts'],
 ['Kong AI Gateway','AI plugins on Kong Gateway','Teams already on Kong: AI proxy plugins with multi-provider load balancing and fallback, AI rate limiting by tokens, semantic cache, prompt guard plugins','Which plugins are Enterprise-only; plugin names and options for your Kong version'],
 ['Azure API Management (AI gateway)','Policies in APIM','<code>llm-token-limit</code> (TPM or token quota per key, can pre-calculate prompt tokens), <code>llm-semantic-cache-lookup</code>/<code>-store</code> with a RediSearch-compatible cache, token metrics','Tier availability (some policies not on Consumption tier)'],
 ['Amazon Bedrock','Managed model access with gateway-like features','Cross-Region inference profiles (geographic or global) for throughput; Intelligent Prompt Routing within a model family','Residency: a global profile can process in any commercial region']
])}
${callout('unverified','Verify product details for your version','LiteLLM and Envoy AI Gateway / Agent Router facts above were checked against their documentation on 2026-10-14. Kong plugin details come from Kong hub listings and secondary sources (Kong’s individual plugin reference pages were not re-checked), and cloud gateway features change frequently. Google Cloud (Apigee, Vertex AI) offers comparable capabilities that were not verified for this lesson. Confirm names, tiers and defaults before designing around them.')}

<h2>4. Where does it fit?</h2>
<p>The gateway is the edge of the AI data plane (${L('v2-platform-architecture','platform architecture')}). Applications call it; it calls external providers directly and self-hosted pools through an inference gateway or router. It sits after your normal edge (CDN, WAF) and before any GPU.</p>
${fig('Two gateways in series', svgDiagram({w:900,h:230,
 zones:[{x:520,y:10,w:370,h:210,label:'Self-hosted pool (Kubernetes)'}],
 boxes:[
  {id:'app',x:10,y:90,w:120,h:56,label:'Application'},
  {id:'aigw',x:170,y:90,w:160,h:56,label:'AI gateway',sub:'which model?',cls:'hl'},
  {id:'prov',x:360,y:20,w:140,h:50,label:'Provider API'},
  {id:'igw',x:540,y:90,w:160,h:56,label:'Inference gateway',sub:'which pod? (EPP)',cls:'hl'},
  {id:'p1',x:740,y:40,w:130,h:44,label:'vLLM pod 1'},
  {id:'p2',x:740,y:100,w:130,h:44,label:'vLLM pod 2'},
  {id:'p3',x:740,y:160,w:130,h:44,label:'vLLM pod 3'}
 ],
 arrows:[{from:'app',to:'aigw',cls:'hl'},{from:'aigw',to:'prov'},{from:'aigw',to:'igw',cls:'hl'},{from:'igw',to:'p1'},{from:'igw',to:'p2'},{from:'igw',to:'p3'}]
}), 'The AI gateway decides policy, model and provider. The inference gateway decides placement inside one pool using live engine metrics and cache state.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Identity provider</b>: JWKS and group claims; cached locally.</li>
<li><b>Control plane</b>: routes, quotas, allowed models and guardrail policy as versioned config (GitOps).</li>
<li><b>Caches</b>: exact and semantic response caches usually live at the gateway (${L('v2-response-semantic-cache','next part')}). It also passes cache hints downstream: provider prompt-cache keys and a per-tenant <code>cache_salt</code> for vLLM prefix-cache isolation.</li>
<li><b>Guardrail services</b>: classifiers called by hooks, each with timeouts.</li>
<li><b>Observability</b>: OpenTelemetry spans per stage, token counters by tenant and model (keep user ids out of metric labels; put them in traces/logs).</li>
<li><b>FinOps</b>: usage events to the cost pipeline for chargeback (${L('v2-finops-optimization','FinOps optimisation')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Area','Your decisions'],[
 ['Deployment','Stateless gateway replicas behind a load balancer; HPA on CPU and concurrent connections; long-lived streaming connections need generous idle timeouts and connection draining on rollout'],
 ['Shared state','Quota counters in a fast shared store (Redis or a rate-limit service); decide behaviour when it is down (fail open with local limits, or fail closed)'],
 ['Config as code','Routes, fallbacks, budgets and allowed models in Git, promoted through environments, validated by contract tests'],
 ['Secrets','Provider keys in a secret manager, rotated, never in app namespaces'],
 ['SLOs','Gateway-added latency p99 (excluding backend), error rate by cause (auth, quota, backend, guardrail), fallback rate'],
 ['Capacity','Gateway is CPU-bound by TLS, JSON and tokenisation; streaming connections hold memory per stream']
])}
${callout('devops','DevOps bridge','Configure it like Envoy or NGINX in front of a microservice fleet: timeouts, retries with budgets, circuit breakers, outlier detection. The difference: a retry here can cost real money (tokens) and, after the first byte of a stream, can corrupt the user experience. Put a retry budget (for example at most 10 % extra requests) in config.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Sudden 429s for one tenant only','Token quota exhausted, often by an agent loop','Per-tenant token counter, request size distribution','Per-request max tokens, loop detection, alert at 80 % budget'],
 ['429s from provider for everyone','Shared provider rate limit','Provider error codes, fallback rate','Spread across deployments/regions, fallback, negotiate limits'],
 ['Costs double, request count flat','Longer prompts (history growth) or cache-hit rate collapse','Input tokens per request, cached-token ratio','Prompt layout fix, history summarisation, check cache keys'],
 ['Duplicate bookings','Retried tool call without idempotency','Tool backend logs with same intent twice','Idempotency keys; never auto-retry side-effecting calls'],
 ['Streams cut at 60 s','Load balancer idle timeout','LB logs, stream durations','Raise idle timeout for streaming routes; heartbeats'],
 ['Gateway p99 latency spikes','Synchronous guardrail or policy call','Span breakdown inside the gateway','Timeouts, caching, async post-hooks where policy allows'],
 ['Retry storm during provider outage','Retries multiply load','Requests per user request &gt; 2','Retry budgets, circuit breakers, jittered backoff']
])}

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Horizontally</b>: gateways are stateless except for quota counters; scale replicas on CPU and open streams.</li>
<li><b>Quota store</b>: shard counters by tenant; use local token buckets with periodic sync for very high rates, accepting small overshoot.</li>
<li><b>Per-region gateways</b> close to users and backends; global quotas aggregated asynchronously.</li>
<li><b>Keep guardrails scalable</b>: small classifier models on their own GPU or CPU pool, batched.</li>
<li><b>Streaming connections</b>: plan file descriptors and memory per connection; a 30-second stream at 500 requests/s means about 15,000 open streams per region (Little’s law on a stable system: L = λ × W = 500 × 30).</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>The gateway is cheap to run; its value is in the cost it controls.</p>
${formula(`
Illustrative routing saving, 10 million requests/month, 1,500 input + 300 output tokens each

All on a large model at $2.00 / $10.00 per M tokens:
  input  10⁷ × 1,500 × 2.00 ÷ 10⁶ = $30,000
  output 10⁷ ×   300 × 10.00 ÷ 10⁶ = $30,000
  total                             = $60,000

Route 60 % (classification, short FAQ) to a small model at $0.10 / $0.50:
  small: 6×10⁶ × (1,500 × 0.10 + 300 × 0.50) ÷ 10⁶ = 6 × (150 + 150) = $1,800
  large: 4×10⁶ × (1,500 × 2.00 + 300 × 10.00) ÷ 10⁶ = 4 × (3,000 + 3,000) = $24,000
  total                                              = $25,800

ANSWER  ≈ 57 % saving, valid only if the small model passes the evaluation
        for those task classes; measure quality per class before and after.
`)}
<p>Other levers owned at the gateway: provider prompt caching (stable prefixes, cache keys), response caching for public content, max-token limits, and moving non-interactive work to batch APIs (Anthropic and OpenAI price batch work lower; check current discounts).</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How would you design retries and fallback for a streaming LLM API?”','<p><i>Answer (≈50 s):</i> "I separate the stream into before and after the first byte. Before any token reaches the client, a retry is invisible, so the gateway retries on connection errors, 503s and 429s with backoff and a retry budget, and then falls back through an ordered list of eligible backends — eligible meaning same capability tier, allowed region and data class. After the first token, I never retry silently, because generation is not idempotent and the user already saw text; I end the stream with an explicit error and let the client offer regenerate. For tools with side effects, idempotency keys go to the tool backend. Circuit breakers stop paying timeouts on a failing backend, and token quotas are charged from actual usage after completion."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Add three retries with exponential backoff and a fallback model."</p><p>Ignores streaming, side effects, retry storms and eligibility of fallback targets.</p></div><div class="good"><h4>Strong answer</h4><p>Distinguishes pre- and post-first-byte, uses retry budgets and circuit breakers, checks data-class and region eligibility for fallback, and uses idempotency keys for actions.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Identity','tenant','token quota','route','backend','usage','cost per tenant'])}
${chain(['AI gateway','inference gateway (EPP)','replica with prefix cache','lower TTFT'])}
<p>Next: the caching masterclass. Start with ${L('v2-cache-map','the caching map')}, then ${L('v2-response-semantic-cache','response and semantic caches')}, which usually live in this gateway.</p></div>
`,
  quiz:[
    {q:'Why should tenant rate limits be expressed in tokens rather than requests?',options:['Tokens are easier to count than requests','Cost and GPU load scale with tokens; a request limit treats tiny and huge requests the same','Providers forbid request limits','Tokens are known before the call'],answer:1,explain:'GPU time and provider price scale with tokens. Output tokens are NOT known before the call, which is why gateways estimate input and charge actual usage afterwards.'},
    {q:'A stream from provider B breaks after 120 tokens were shown to the user. What should the gateway do?',options:['Retry the same request on provider B and splice the output','Retry on provider C silently','End the stream with an explicit error and let the client decide','Return HTTP 200 with what was received and no error'],answer:2,explain:'Generation is not idempotent, so a silent retry produces a different answer and duplicate text. Hiding the error is worse.'},
    {q:'Anthropic returns input_tokens=2,000, cache_read_input_tokens=8,000, cache_creation_input_tokens=0. Total input tokens processed is…',options:['2,000','8,000','10,000','6,000'],answer:2,explain:'For Anthropic the total input is the sum of the three input fields. Using input_tokens alone undercounts usage; pricing each field at its own rate is correct.'},
    {q:'What is the main difference between an AI gateway and the Gateway API Inference Extension endpoint picker?',options:['There is none','The AI gateway chooses model/provider and enforces tenant policy; the endpoint picker chooses a pod within a self-hosted pool using engine metrics and cache state','The endpoint picker meters cost','The AI gateway runs on GPUs'],answer:1,explain:'They are complementary layers in series.'},
    {q:'Which request is safe to retry automatically?',options:['A tool call that issues a refund, without an idempotency key','A 503 received before any response bytes','A 400 context-length error, unchanged','A content-policy refusal, to the same model'],answer:1,explain:'Nothing was delivered and the request had no effect. The others either repeat a failure, bypass policy, or risk duplicate side effects.'},
    {q:'Routing 60 % of traffic to a small model reduced cost from $60,000 to $25,800. What must be true for this to be a valid saving?',options:['The small model is open source','The small model passes evaluation for those task classes','The gateway uses Redis','Latency is identical'],answer:1,explain:'A cost saving that lowers quality below the bar is a regression. Measure quality per task class.'}
  ],
  flashcards:[
    {front:'Seven responsibilities of an AI gateway',back:'AuthN/Z, token quotas and rate limits, model routing, retries/fallback, guardrail hooks, cost metering, audit (plus optional response caching).'},
    {front:'When is a retry safe for a streaming response?',back:'Only before the first byte reaches the client. After that, end with an explicit error; generation is not idempotent.'},
    {front:'Two-phase token quota',back:'Estimate input tokens before the call to reject early; charge actual usage (input, cached, output) after completion.'},
    {front:'AI gateway vs inference gateway',back:'AI gateway: which model/provider, tenant policy. Inference gateway (GAIE EPP, llm-d Router): which pod in a pool, using queue, KV and prefix-cache state.'},
    {front:'Envoy AI Gateway in Oct 2026',back:'Renamed Agent Router (Agentic AI Foundation); same code, API group aigateway.envoyproxy.io, CLI aigw; token rate limits charged after response.'},
    {front:'Idempotency key',back:'A client-supplied unique id for a side-effecting operation so that a retried call is recognised and not executed twice.'},
    {front:'Metering trap with cached tokens',back:'Anthropic input_tokens excludes cache read/creation tokens; OpenAI cached_tokens is a subset of input_tokens. Read each provider’s semantics.'}
  ]
});
registerGlossary([
  {term:'AI gateway',def:'A reverse proxy for model traffic that authenticates callers, enforces token-based quotas, routes to models and providers, retries and falls back, runs guardrail hooks, meters cost and audits each request.',lesson:'v2-ai-gateway',aliases:['LLM gateway']},
  {term:'Model router',def:'A component, often a trained classifier, that chooses which model should answer a request based on predicted quality, cost or latency.',lesson:'v2-ai-gateway',aliases:['model routers']},
  {term:'Token quota',def:'A tenant limit expressed in tokens per time window or per budget period, charged from actual usage reported by the model.',lesson:'v2-ai-gateway',aliases:['TPM limit']},
  {term:'Idempotency key',def:'A unique identifier attached to a side-effecting request so that retries are detected and the action is performed at most once.',lesson:'v2-ai-gateway'},
  {term:'Fallback chain',def:'An ordered list of eligible backends a gateway tries when the primary fails, is rate limited, or cannot accept the request.',lesson:'v2-ai-gateway'},
  {term:'Circuit breaker',def:'A pattern that stops sending traffic to a failing backend for a cooldown period after repeated failures, instead of paying a timeout per request.',lesson:'v2-ai-gateway'},
  {term:'Request hedging',def:'Sending the same request to two backends and using the first response, trading extra cost for lower tail latency.',lesson:'v2-ai-gateway'}
]);
