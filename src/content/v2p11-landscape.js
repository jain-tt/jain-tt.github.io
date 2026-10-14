/* Vol 2, Part 11, Lesson 2: the technology landscape — what the course includes, excludes and why. */
(function(){
'use strict';
const B=(c,t)=>'<span class="badge '+c+'">'+t+'</span>';
const CORE=B('v1','core'), IMP=B('v2','important'), AW=B('x','awareness'), EX=B('v3','excluded');
const MAT='mature', GROW='maturing', EMER='emerging', EXP='experimental';

registerLesson({
  id:'v2-landscape', vol:2, part:11, num:2,
  title:'The technology landscape: what this course includes, excludes and why', minutes:45,
  summary:'The AI infrastructure field changes every month, so a course has to choose. This lesson lists every candidate technology that was considered, gives each one a priority — core, important, awareness or excluded — and explains the reason, where it is taught, and how mature it is as of October 2026. It also gives you a repeatable method to evaluate the next new tool yourself, so the list stays useful after it goes out of date.',
  objectives:[
    'Explain the four priority levels and the criteria used to assign them.',
    'For any technology in the table, say why it has its priority and where in the course it is covered.',
    'Distinguish mature, maturing, emerging and experimental technology and adjust how much you rely on it.',
    'Apply the evaluation checklist to a new tool you meet at work or in an interview.',
    'Explain, in an interview, why you chose not to go deep on a fashionable technology.'
  ],
  prereqs:['v2-platform-architecture','v2-capstone-platform'],
  next:['v3-how-to-interview','v3-system-design'],
  tags:['landscape','strategy','career'],
  html:`
<h2>1. Why a landscape lesson exists</h2>
<p>A senior AI platform engineer is judged as much on what they choose <i>not</i> to build as on what they build. Every week brings a new engine flag, a new agent framework, a new protocol revision. If you chase all of them you master none. This lesson makes the course’s choices explicit, so you can see the reasoning, disagree with it where your job differs, and reuse the method.</p>
${callout('devops','DevOps bridge','You already do this with the CNCF landscape: nobody runs every project on it. You pick a small, boring core (Kubernetes, Prometheus, Argo CD), keep a watch list, and deliberately ignore the rest until a real requirement appears. The AI landscape deserves the same discipline — with one difference: it moves about ten times faster, so "watch list" items can become core within a year (MCP did) or fade just as fast (AutoGen went into maintenance mode).')}

<h2>2. The four priority levels</h2>
${table(['Priority','Meaning','What you should be able to do'],[
[CORE,'Directly operated by an AI platform engineer, or underpins most architecture decisions','Explain the mechanism, implement it in a lab, debug it, design with it, defend trade-offs in an interview'],
[IMP,'Shapes design decisions or comes up in senior interviews, but someone else often owns it day to day','Explain it precisely, know its failure modes and when to choose it, read its metrics'],
[AW,'Relevant to some roles or likely to matter soon; not yet a daily responsibility','Describe what it is, where it would fit, and what would make you adopt it'],
[EX,'Outside the target roles, or too immature/vendor-specific to teach responsibly','Know it exists and why the course skips it']
])}
<p>Maturity is labelled separately: <b>mature</b> (broadly adopted, stable APIs), <b>maturing</b> (1.x or GA but changing fast), <b>emerging</b> (pre-1.0, alpha APIs, or spec still in flux), <b>experimental</b> (research or preview only). A technology can be core and still emerging — MCP is the clearest example — and then the course teaches the durable concepts and dates the version-specific details.</p>

<h2>3. How each candidate was evaluated</h2>
${fig('Priority decision flow',svgDiagram({w:900,h:400,boxes:[
{id:'c',x:20,y:135,w:130,h:56,label:'Candidate',sub:'tool or practice'},
{id:'q1',x:190,y:30,w:200,h:62,label:'Platform team runs it',sub:'in production?',cls:'hl'},
{id:'q2',x:190,y:135,w:200,h:62,label:'Shapes architecture',sub:'or senior interviews?',cls:'hl'},
{id:'q3',x:190,y:240,w:200,h:62,label:'Likely to matter',sub:'within ~2 years?',cls:'hl'},
{id:'core',x:470,y:30,w:150,h:56,label:'Core',sub:'teach to depth',cls:'v1'},
{id:'imp',x:470,y:135,w:150,h:56,label:'Important',sub:'teach mechanism',cls:'v2'},
{id:'aw',x:470,y:240,w:150,h:56,label:'Awareness',sub:'one paragraph + table',cls:'x'},
{id:'ex',x:470,y:330,w:150,h:56,label:'Excluded',sub:'named, not taught',cls:'v3'},
{id:'mat',x:700,y:80,w:170,h:80,label:'Maturity check',sub:'date versions; flag alpha'}
],arrows:[
{from:'c',to:'q1'},{from:'q1',to:'core',label:'yes'},{from:'q1',to:'q2',label:'no'},
{from:'q2',to:'imp',label:'yes'},{from:'q2',to:'q3',label:'no'},
{from:'q3',to:'aw',label:'yes'},{from:'q3',to:'ex',label:'no',fromSide:'bottom',toSide:'left'},
{from:'core',to:'mat',cls:'dash'},{from:'imp',to:'mat',cls:'dash'}
]}),'The three questions are asked from the point of view of the target roles (AI platform, GPU infrastructure, MLOps/LLMOps, AIOps, AI FinOps). Maturity does not change priority; it changes how the course teaches: emerging core items are taught as concepts plus dated specifics.')}
<p>Four practical tests break ties:</p>
<ul>
<li><b>Ownership test.</b> Would a pager for this thing ring on the platform team? (Inference engines: yes. Video generation models: no.)</li>
<li><b>Transfer test.</b> Does learning it teach a mechanism that transfers (batching, caching, auth), or only a product UI?</li>
<li><b>Interview test.</b> Does it appear in senior AI infrastructure system-design or debugging rounds?</li>
<li><b>Half-life test.</b> Will the knowledge still be true in 18 months? Low half-life items are taught as patterns with dated facts.</li>
</ul>

<h2>4. The full evaluation table (as of Oct 2026)</h2>
${table(['Candidate','Priority','Why','Where covered','Maturity'],[
['OpenAI-compatible APIs',CORE,'The de facto interface between apps, gateways and engines (vLLM, SGLang, TensorRT-LLM, Dynamo all expose it); lets you swap backends',L('v1-ai-apps-tools','From model to application')+', '+L('v1-engines','Engines'),MAT],
['Structured output (JSON Schema, grammars)',CORE,'Tool calling and automation fail without parseable output; engines implement it with xgrammar/guidance backends',L('v1-ai-apps-tools','From model to application'),MAT],
['Multimodal serving (vision-language)',AW,'Same engines and memory maths, plus image-token budgets; growing in travel (document and ID images) but not the core of the target roles',L('v1-engines','Engines')+' (notes)',GROW],
['Speech and real-time voice',AW,'Different latency model (streaming audio, sub-second turn-taking); vLLM exposes transcription and realtime endpoints, but voice stacks are usually a separate team',L('v2-platform-architecture','Platform architecture')+' (extension point)',GROW],
['Video inference / generation',EX,'Very different compute profile and rarely owned by an AI platform team in enterprise travel; would dilute the GPU-serving core','—',EMER],
['Computer-use agents',AW,'Real and shipping (provider computer-use tools), but high-risk and niche for platform teams; security lessons apply',L('v2-agents','Agents'),EMER],
['Distillation',IMP,'Main route to cheaper models (teacher → student); affects cost and routing decisions',L('v1-finetuning','Fine-tuning'),MAT],
['Synthetic data',IMP,'Used for fine-tuning and eval sets (the capstone uses synthetic travel tickets); contamination and quality risks must be managed',L('v1-data-pipelines','Datasets')+', '+L('v1-capstone-train','Capstone 1–3'),GROW],
['Data quality and lineage',IMP,'Bad data is the most common silent failure; lineage is needed for audits and rollbacks',L('v1-data-pipelines','Datasets')+', '+L('v2-mlops-foundations','MLOps foundations'),MAT],
['Model evaluation frameworks',CORE,'Release gates depend on them; you must run and interpret them, and calibrate judges',L('v2-evaluation-monitoring','Evaluation and monitoring')+', '+L('v2-model-cicd','Model CI/CD'),GROW],
['Agent evaluation',IMP,'Trajectory and tool-call evaluation differ from single-answer evals; frameworks are young',L('v2-agents','Agents'),EMER],
['Guardrails',CORE,'Every production LLM path needs input/output/tool policy; latency and false-block costs are platform concerns',L('v2-ai-threat-model','AI threat modeling'),GROW],
['AI gateways',CORE,'The policy and routing choke point: auth, token quotas, fallbacks, caching, cost attribution',L('v2-ai-gateway','AI gateway'),GROW],
['AI service meshes',AW,'Mostly marketing for gateway + mesh features applied to model and agent traffic; the underlying mechanisms are taught under gateways and identity',L('v2-ai-gateway','AI gateway'),EMER],
['Model routers (cascades, classifiers)',IMP,'Large cost lever (blended cost formula); quality risk must be measured per route',L('v2-ai-gateway','AI gateway')+', '+L('v2-finops-optimization','FinOps optimization'),GROW],
['Inference observability (engine + GPU metrics)',CORE,'TTFT/TPOT/KV/queue/DCGM metrics are the on-call reality of the role',L('v1-k8s-autoscaling','Autoscaling and monitoring')+', '+L('v2-ai-observability','AI observability'),MAT],
['OpenTelemetry for AI (GenAI semantic conventions)',CORE,'Vendor-neutral traces for model, tool and agent calls; but all GenAI conventions are still "Development" and names changed in 2026, so teach old and new',L('v2-ai-observability','AI observability'),EMER],
['Gateway API and Inference Extension',CORE,'The Kubernetes-standard way to do model-aware routing (InferencePool v1, endpoint picker)',L('v1-k8s-serving','Model serving on Kubernetes'),GROW],
['KServe',IMP,'Widely deployed serving CRDs; LLMInferenceService builds on llm-d but is still an alpha API',L('v1-k8s-serving','Model serving on Kubernetes'),MAT+' (llmisvc '+EMER+')'],
['Ray Serve',IMP,'Common in Python-heavy ML orgs; security history (ShadowRay) is an important lesson',L('v1-k8s-serving','Model serving on Kubernetes')+', '+L('v2-ai-threat-model','AI threat modeling'),MAT],
['Kubeflow (Pipelines, Trainer)',IMP,'Kubernetes-native pipelines and training jobs; Trainer API is alpha',L('v2-mlops-foundations','MLOps foundations'),GROW],
['Serving operators (Dynamo operator, llm-d, KServe controllers)',IMP,'How large fleets are actually deployed; concepts (disaggregation, KV-aware routing) matter more than CRD names',L('v2-distributed-inference','Distributed inference')+', '+L('v1-engines','Engines'),EMER],
['MCP ecosystem (SDKs, clients, registry)',CORE,'The standard tool interface for agents; the course builds servers in Python and TypeScript and secures them; two spec eras coexist',L('v2-mcp-why','Why MCP')+' → '+L('v2-mcp-capstone','MCP capstone'),EMER],
['Agent registries and discovery',AW,'A2A Agent Cards and the MCP Registry exist, but enterprise registries are early; governance is the real problem',L('v2-a2a-multiagent','A2A and multi-agent'),EXP],
['AI workload identity',IMP,'Agents and model servers need their own identities and scoped tokens, not shared API keys',L('v2-governance','Identity and governance')+', '+L('v2-mcp-auth','MCP auth'),EMER],
['Model provenance and signing',IMP,'Know what you deploy: pinned revisions, safetensors, Sigstore model signing',L('v2-ai-threat-model','AI threat modeling'),GROW],
['Supply-chain security (models, packages, containers)',CORE,'Pickle backdoors, trust_remote_code and poisoned dependencies are concrete, documented risks',L('v2-ai-threat-model','AI threat modeling')+', '+L('v1-k8s-production','Production readiness'),MAT],
['Confidential computing for AI',AW,'GPU TEEs and attestation exist (GPU Operator ships a CC manager), but few enterprises need them yet; relevant for strict residency/regulated data',L('v2-governance','Governance'),EMER],
['Multi-tenancy',CORE,'Isolation of data, cache, quota and cost is the heart of an internal AI platform',L('v2-platform-architecture','Platform architecture')+', '+L('v2-cache-ops','Cache operations'),MAT],
['GPU marketplaces and provisioning (capacity blocks, flex-start, neoclouds)',IMP,'GPU availability and price drive architecture; you must reason about reserved vs on-demand vs queued capacity',L('v2-finops-optimization','FinOps optimization')+', '+L('v1-k8s-gpu-stack','K8s GPU stack'),GROW],
['Developer portals (golden paths for AI)',AW,'Useful packaging of the platform (templates for model, RAG, MCP services) but not AI-specific engineering',L('v2-platform-architecture','Platform architecture'),MAT],
['AI-assisted software engineering (coding agents)',AW,'Changes how platform teams work; its security model (tools, permissions, MCP) is covered, the productivity topic is not',L('v2-agents','Agents')+', '+L('v2-mcp-security','MCP security'),GROW],
['AI-native CI/CD (eval gates, prompt versioning)',CORE,'Releasing models, prompts and indexes safely is a platform responsibility',L('v2-model-cicd','Model CI/CD'),GROW],
['AI incident response',CORE,'Quality regressions, leaks, runaway agents and cost spikes are new incident classes; see the runbook library',L('v2-aiops','AIOps')+', '+L('v3-prove-incident','Prove it 5'),GROW],
['AI FinOps',CORE,'GPU spend is often the largest line item; unit economics drive build-vs-buy and routing',L('v2-finops-unit-economics','FinOps unit economics')+', '+L('v2-finops-optimization','FinOps optimization'),GROW],
['Training frontier models from scratch',EX,'Outside the target roles; the course teaches distributed training mechanisms needed to support fine-tuning and operate training clusters',L('v2-distributed-training','Distributed training')+' (mechanisms only)',MAT],
['Custom CUDA kernel development',EX,'Kernel authorship is a specialist role; the course teaches enough CUDA to read profiles and reason about memory',L('v1-cuda','CUDA programming')+' (reading level)',MAT]
])}
<p>Tool-by-tool comparisons with versions live in the <a href="#/tools">tool comparison library</a>; formulas behind the economics live in the <a href="#/formulas">formula reference</a>.</p>

<h2>5. What the exclusions are not</h2>
<p>"Excluded" does not mean "unimportant". Video generation is a large industry; frontier pretraining is where much of the compute goes. They are excluded because the people who do them are a different job family, and teaching them shallowly would cost depth where the target roles are measured. If your job moves toward one of them, the course’s fundamentals (memory maths, roofline, collectives, scheduling) are exactly the base you would build on.</p>
${callout('warn','Fast-moving facts in this lesson','Versions and statuses were checked on 2026-10-14. Several items changed status recently: Text Generation Inference was archived (maintenance mode), Envoy AI Gateway was renamed Agent Router, MCP published a stateless spec revision, OTel moved GenAI conventions to a separate repository, Semantic Kernel became Microsoft Agent Framework. Re-check before quoting any of them.')}

<h2>6. Evaluating the next new technology yourself</h2>
<p>Use this checklist when a vendor, colleague or interviewer brings a new tool:</p>
${checklist([
{key:'ls-problem',text:'Which bottleneck or risk does it address (prefill compute, decode bandwidth, KV capacity, routing, auth, cost, quality)? If you cannot name one, stop.'},
{key:'ls-layer',text:'Which layer does it replace or sit beside (engine, orchestration, gateway, data, agent, observability)? Does it overlap something you run?'},
{key:'ls-maturity',text:'Maturity: version (0.x?), API stability (alpha CRDs?), governance (foundation or single vendor), licence (OSI, BUSL, ELv2).'},
{key:'ls-ops',text:'Operations: metrics, failure modes, upgrade path, security history, who is paged.'},
{key:'ls-measure',text:'Evidence: a benchmark on YOUR workload shape and SLO, not a vendor chart.'},
{key:'ls-exit',text:'Exit cost: can you remove it in a quarter if it disappoints (open interfaces such as OpenAI-compatible APIs, OTel, Gateway API)?'}
])}
${callout('interview','Interview question: "Why didn’t you use [hot new framework]?"','"I evaluated it against the bottleneck we actually had. Our TTFT problem was queueing and prefix-cache misses, which we fixed with KV-aware routing on the Inference Extension and better admission control. The framework’s main feature, multi-agent orchestration, did not address that, its API was pre-1.0, and adopting it would have added a component to page on. I keep it on a watch list with an explicit adoption trigger: if we need cross-team agent delegation, I would run a two-week spike against our own workload."')}

<h2>7. Re-evaluation cadence</h2>
<p>Run this table again every quarter. Promote an item when it passes the ownership or interview test in your organisation; demote it when its maintainers do (maintenance mode, archived repository, licence change). Record the decision and the date, exactly as you would an architecture decision record.</p>

<div class="connections"><h4>How this connects</h4>
${chain(['Bottleneck you must fix','Mechanism (durable)','Tool choice (dated)','Benchmark on your workload','Adopt, watch or exclude'])}
<p>The fundamentals in Volumes 1 and 2 are the "mechanism" column; the <a href="#/tools">tool library</a> is the dated column; ${L('v3-system-design','system design')} and ${L('v3-how-to-interview','interview strategy')} are where you defend the choices.</p></div>
`,
  quiz:[
    {q:'MCP is rated "core" but its maturity is "emerging". What does that combination mean for how the course teaches it?',options:['It is taught only at awareness level until it reaches 1.0','Its durable concepts (primitives, transports, auth, threat model) are taught to depth, with version-specific details dated and both spec eras shown','It is excluded because emerging technology should never be core','Only the newest 2026-07-28 revision is taught, since old revisions are obsolete'],answer:1,explain:'Priority reflects how central it is to the role; maturity changes the teaching style. Teaching only the newest revision is tempting but wrong: most clients and tutorials still use 2025-11-25, so both eras are taught.'},
    {q:'Why is Hugging Face Text Generation Inference not recommended for a new deployment in October 2026?',options:['It never supported streaming','It is in maintenance mode and its repository was archived in March 2026; Hugging Face recommends vLLM or SGLang','It only runs on CPUs','It was renamed NVIDIA Dynamo'],answer:1,explain:'The README states maintenance mode and the repository is archived. Dynamo is NVIDIA’s orchestration framework around engines, not a rename of TGI.'},
    {q:'Which test most directly explains why custom CUDA kernel development is excluded?',options:['Half-life test: CUDA changes every month','Ownership test: kernel authorship belongs to a specialist role, not the AI platform team that operates serving','Interview test: CUDA never comes up in interviews','Exit-cost test: CUDA cannot be removed'],answer:1,explain:'Kernel writing is a different job family. The course still teaches CUDA to reading level because profiling and memory reasoning do appear in platform work and interviews.'},
    {q:'An interviewer asks why you did not adopt a fashionable agent framework. Which answer is strongest?',options:['"It is not mature, so we never use new tools."','"We had no time."','"I tied the decision to our measured bottleneck, noted its pre-1.0 API and operational cost, and set an explicit adoption trigger with a spike plan."','"Our cloud provider did not support it."'],answer:2,explain:'Strong answers connect a technology decision to a measured problem, risk and exit plan. A blanket "never new tools" rule shows rigidity, not judgement.'},
    {q:'OpenTelemetry GenAI conventions are rated core but emerging. What practical consequence follows?',options:['Do not instrument until they are stable','Instrument with them, but expect renamed attributes and metrics (e.g. gen_ai.system → gen_ai.provider.name) and support both old and new names in dashboards','Use only vendor-specific tracing','They are stable since semantic conventions v1.44.0'],answer:1,explain:'All GenAI conventions are still "Development" and moved repository in 2026. Waiting means no traces; ignoring the churn means broken dashboards. Plan for both names.'}
  ],
  flashcards:[
    {front:'Four priority levels in the landscape lesson',back:'Core (teach to depth), important (mechanism and trade-offs), awareness (what it is and when to adopt), excluded (named, not taught).'},
    {front:'Priority vs maturity',back:'Priority = how central to the target role. Maturity = how stable the technology is. Emerging core items are taught as durable concepts plus dated specifics.'},
    {front:'The four tie-break tests',back:'Ownership (would it page the platform team?), transfer (does it teach a reusable mechanism?), interview (does it appear in senior rounds?), half-life (still true in 18 months?).'},
    {front:'Three recent status changes to remember',back:'TGI archived/maintenance mode; Envoy AI Gateway renamed Agent Router; MCP 2026-07-28 stateless revision (no initialize handshake, no sessions).'},
    {front:'Exit-cost question for any new tool',back:'Can we remove it within a quarter? Prefer open interfaces: OpenAI-compatible APIs, OpenTelemetry, Gateway API / InferencePool.'},
    {front:'Why "AI service mesh" is awareness only',back:'Its useful parts are gateway policy and workload identity, which are taught directly; the label itself adds little mechanism.'}
  ]
});

registerGlossary([
  {term:'Technology radar',def:'A periodically reviewed list that places technologies into adopt / trial / assess / hold (here: core / important / awareness / excluded) with the reason and date.',lesson:'v2-landscape',aliases:['tech radar']},
  {term:'Adoption trigger',def:'A pre-agreed condition (a requirement, a maturity milestone, a measured benefit) that moves a watched technology into evaluation or use.',lesson:'v2-landscape',aliases:[]},
  {term:'Half-life of knowledge',def:'How long a fact stays true; engine flags have a half-life of months, memory-bandwidth arithmetic of decades.',lesson:'v2-landscape',aliases:[]}
]);
})();
