# Authoring guide — AI Systems Engineering Masterclass

Read this whole file before writing anything. The app is ONE offline HTML file built by `node build.mjs`.
Validate with `node build.mjs --check` (must print zero `ERROR` lines). Never edit `dist/`.

## 0. The learner (write for this person)

- 12+ years Cloud/DevOps leader: AWS, GCP, EKS/GKE, Terraform, Helm, Argo CD, Jenkins, GitHub Actions, networking,
  IAM, Prometheus/Grafana/Mimir/Datadog, Kafka/Debezium, Spark/EMR/Airflow/Glue/Athena, SageMaker/Bedrock exposure.
- Pursuing an M.Tech in AI/ML. Strong in infrastructure, weaker in model internals, PyTorch internals, CUDA,
  distributed training, transformer maths, inference scheduling, the agent ecosystem.
- Goal: Senior AI Platform Engineer / AI Infrastructure Architect / MLOps-LLMOps / GPU infra / AIOps / AI FinOps leader.
- Works in Saudi Arabia / GCC travel tech (Almosafer/Tajawal). Regional examples (Arabic + English traffic,
  data residency, Ramadan/holiday traffic peaks) are welcome but never invent company facts.

## 1. Voice and teaching rules

- Simple English, short sentences, but technically exact. Never trade accuracy for simplicity.
- Analogies only to OPEN a concept; always follow with the real mechanism.
- Use DevOps bridges constantly ("this is like a Kubernetes readiness probe, except…") and say where the analogy breaks.
- Teach CONNECTIONS. End each lesson with a `connections` block that shows how this topic feeds others (use `chain([...])`).
- Never pad. No filler intros ("In today's fast-moving world…"). No marketing adjectives.
- No placeholders, no TODO, no "coming soon", no empty diagrams. The validator rejects TODO/PLACEHOLDER/lorem.

### The 10-step sequence (mandatory for every major topic inside a lesson)
Use these as `<h2>`/`<h3>` headings in this order (wording can adapt, order cannot):
1. What is it? (plain language)
2. Why do we need it? (the problem it solves)
3. How does it work internally? (the real mechanism, with numbers/shapes)
4. Where does it fit? (place in the full system; diagram)
5. How does it connect to other components? (inputs, outputs, dependencies, data flow)
6. What does a DevOps / platform engineer manage? (operational responsibility)
7. What happens when it fails? (failure modes, symptoms, evidence, fixes)
8. How do we scale it? (bottlenecks, scaling levers)
9. How do we optimize its cost? (economic trade-offs)
10. What might an interviewer ask? (one realistic Q + a 30–60 s answer in a `callout interview`)

A lesson that covers several topics may run the sequence once per topic, or once for the main topic with the
others folded into steps 3–5. Every lesson must contain all 10 steps at least once.

## 2. Accuracy rules (non-negotiable)

- Version-dependent facts (versions, flags, defaults, metric names, API names, prices, spec revisions) must come
  from the verified research files in `/private/tmp/claude-503/-Users-vaibhav-jain-tajawal-study/fbad074a-3ce5-469e-918b-1ca517c1f57b/scratchpad/research/`
  (read the ones relevant to your area FIRST: `mcp_a2a.md`, `inference_engines.md`, `k8s_hardware.md`,
  `sec_ops_agents.md`, `part3_mlops.md`, `part5_6_memory_rag.md`). Some may still be in progress; re-read before finishing.
- If a fact is not in those files and you are not certain, either (a) phrase it version-independently,
  or (b) wrap it in `callout('unverified','Verify before relying on this', '...')`. Never guess numbers.
- Never invent benchmark results, throughput, speed-ups, prices or capacity. Use clearly labelled
  ILLUSTRATIVE inputs ("assume a measured 2,400 output tok/s per replica at your SLO") and show the method.
- Mark the "as of" date for fast-moving facts: `(as of Oct 2026)`.
- Arithmetic must be correct. Recompute every worked number. Show units. Distinguish GB (10⁹) from GiB (2³⁰).
- Distinguish mature/broadly adopted vs. emerging/experimental technology explicitly (use `badge` or a sentence).
- Never claim the learner has production experience. Labs are "demonstrated in a lab", not production.

### Known corrections from the audit (apply them)
- MCP: the CURRENT spec revision is **2026-07-28** (stateless: no `initialize` handshake, no `Mcp-Session-Id`,
  `server/discover`, per-request `_meta` protocolVersion/clientCapabilities, `subscriptions/listen`, MRTR replaces
  server-initiated sampling/elicitation; Roots/Sampling/Logging deprecated; DCR deprecated in favour of CIMD).
  The previous revision **2025-11-25** has the handshake + sessions and is still what most clients/tutorials use.
  ALWAYS say which era you describe; teach both. Python SDK `mcp` 2.x: `from mcp.server import MCPServer`
  (FastMCP was renamed). TS SDK v2: `@modelcontextprotocol/server`, `registerTool`, zod v4.
- Volume 1 of the old course called Dynamo "distributed inference coordination" and implied it replaces engines:
  Dynamo is an orchestration/serving framework AROUND engines (vLLM, SGLang, TensorRT-LLM).
- KV-cache formula `2 × layers × kv_heads × head_dim × bytes` is per token; for GQA models kv_heads ≠ attention heads.
- "GPU utilization" (nvidia-smi / DCGM_FI_DEV_GPU_UTIL) = fraction of time ≥1 kernel was running, NOT SM efficiency.
- Little's law L = λW applies to stable systems; it does not say how many requests are on the GPU.
- Old cost example "$6/h and 90,000 tok/h → $66.67/M tok" is arithmetically right but 90k tok/h (25 tok/s) is an
  unrealistically low figure for a whole GPU fleet; label it as illustrative or use a better example.
- Old 10M DAU answer divided output-token demand by per-replica tok/s and ignored prefill; always size with
  both prefill and decode, concurrency/KV limits, and SLO-constrained goodput.

## 3. Maths formatting (the learner's terminal and eyes)

- No LaTeX, no `$$`, no `\frac`. Formulas go in `formula(...)` blocks: monospace, real Unicode sub/superscripts
  (w₁ x² 10⁻³ dₖ), real symbols (∂ Σ √ ≈ ≥ ≤ → σ η λ μ ε ⊙), fractions drawn with a bar:
```
     ∂L                              exp(zᵢ)
    ────  = 2(ŷ − y)·x        pᵢ = ───────────
     ∂w                             Σⱼ exp(zⱼ)
```
- One operation per line, `=` aligned, `STEP 1 / STEP 2 … ANSWER` for worked examples, ↑ annotations under terms.

## 4. File layout and APIs

Content files are plain JS executed in the browser. One file per area, e.g.
`src/content/v1p4-gpu.js`, `src/anims/v1p4-gpu.js`, `src/questions/v3-ch-gpu.js`.
Helpers (global): `code(lang,text)`, `term(t,label)`, `L(id,label)`, `callout(kind,title,html)`, `formula(text)`,
`chain([..])`, `anim(id)`, `fig(title,svg,caption)`, `table(head,rows)`, `svgDiagram(spec)`, `checklist(items)`.

### Lesson
```js
registerLesson({
  id:'v1-kv-cache', vol:1, part:5, num:2,            // MUST match the registry in section 7
  title:'KV cache and PagedAttention', minutes:75,     // honest study time (reading + animations, not labs)
  summary:'2–4 sentence audio-friendly summary in plain speech (no symbols, no code).',
  objectives:['…','…'],                                // 3–6 measurable outcomes
  prereqs:['v1-inference-anatomy'], next:['v1-batching','v2-prefix-kv-cache'],
  tags:['inference','memory'],
  html:`...lesson body HTML...`,
  quiz:[{q:'…',options:['…','…','…','…'],answer:2,explain:'why the right one is right AND why a tempting wrong one is wrong'}], // 4–6 per lesson
  flashcards:[{front:'…',back:'…'}]                    // 4–8 per lesson
});
registerGlossary([{term:'KV cache',def:'one or two sentences',lesson:'v1-kv-cache',aliases:['key-value cache']}]);
```
The `html` is a JS template literal. Inside it: write `\`` for a backtick and `\${` for a literal `${`.
Avoid backslashes in inline text; for code use `code('python', \`...\`)` only for SHORT snippets with no
backslashes, otherwise put the code in a real file under `labs/` and include it:
`code('python', \`@@include(labs/08-mcp-python/src/server.py#tools)@@\`)` — the build inlines the file region
between lines containing `[START tools]` and `[END tools]` (escaping is automatic). Prefer includes for any code
that the learner is meant to run; only lab files are tested.

Use `term('KV cache')` on the FIRST mention of important glossary terms in a lesson (the glossary entry must exist
somewhere; register terms you introduce).

Allowed HTML building blocks / classes:
- `callout(kind,…)` kinds: `note`, `tip`, `warn`, `danger`, `devops` (DevOps bridge), `interview`, `analogy`, `unverified`.
- `<div class="compare"><div class="bad"><h4>Weak answer</h4>…</div><div class="good"><h4>Strong answer</h4>…</div></div>`
- `<div class="connections"><h4>How this connects</h4>${chain([...])}…</div>`
- `<details class="reveal"><summary>Show worked solution</summary><div>…</div></details>`
- `<div class="twocol">…</div>`, `<dl class="kv">`, `<div class="dtree"><ul><li><span class="q">…</span><ul><li><span class="a">yes</span>…`
- tables via `table(head, rows)` or raw `<table>`.

### Static diagrams
Use `fig(title, svgDiagram({...}), caption)`. Boxes `{id,x,y,w,h,label,sub,cls}` with cls among
`hl ok bad warn v1 v2 v3 x`; arrows `{from,to,label,cls:'hl'|'dash',fromSide,toSide,both}`; zones
`{x,y,w,h,label,cls:'danger'|'ok'}` for trust/network boundaries; `notes:[{x,y,text}]`. viewBox default 900×360;
keep text short (boxes ≥ 7 px per character). Every diagram must teach something (flows, boundaries, ownership).

### Animations (educational, not decorative)
Register scenes in `src/anims/<area>.js` and mount with `anim('scene-id')` in lesson HTML.
```js
Anim.register({
  id:'v1-kv-growth', title:'KV cache grows token by token', w:960, h:420,
  elements:[
    {type:'zone', id:'gpu', x:20,y:20,w:920,h:380,label:'GPU HBM (80 GB)'},
    {type:'node', id:'sched', x:40,y:60,w:140,h:56,label:'Scheduler',sub:'vLLM',icon:'gear'},
    {type:'node', id:'w', x:260,y:60,w:140,h:56,label:'Weights'},
    {type:'edge', id:'e1', from:'sched', to:'w', label:'step'},       // auto-routed curve; fromSide/toSide optional
    {type:'bar', id:'kvbar', x:600,y:80,w:300,h:22,label:'KV used', value:0.1},  // value 0..1; colours by threshold
    {type:'mem', id:'hbm', x:40,y:300,w:880,h:40,label:'HBM layout',segs:[{frac:.4,cls:'w',label:'weights'},{frac:.6,cls:'free'}]},
    // mem seg classes: w (weights) kv act grad opt free frag
    {type:'tokens', id:'seq', x:40,y:180,h:26,items:['The','server','is',{t:'down',cls:'new'}]}, // cls: hl new
    {type:'counter', id:'c1', x:620,y:160,label:'TTFT', value:'—'},
    {type:'label', id:'l1', x:40,y:250,text:'free text\nsecond line', hidden:true},
    {type:'timeline', id:'tl', x:40,y:200,w:880,h:120,labelW:80,cols:12,ticks:true,rows:[{id:'A',label:'User A'},{id:'B',label:'User B'}]},
    {type:'grid', id:'att', x:600,y:60,rows:4,cols:4,cell:28,rowLabels:['The','server','is','down'],colLabels:['The','server','is','down'],values:[[1,null,null,null],…],maskNull:true,showValues:true},
    {type:'chart', id:'ch', x:80,y:60,w:360,h:200,xmax:100,ymax:10,xlabel:'load',ylabel:'p95',series:[{id:'s',label:'p95',points:[[0,1],[50,2]]}]}
  ],
  steps:[
    {caption:'HTML caption shown under the stage. Explain WHAT is happening and WHY.', narration:'plain spoken version (optional; defaults to caption text)',
     hl:['sched'], packets:[{edge:'e1',label:'req',count:1,cls:'c-blue'}], dur:3500},
    {caption:'…', ok:['w'], warn:[], bad:[], busy:[], dim:[], show:['l1'], hide:[],
     set:{kvbar:{value:0.45,text:'36 GB'}, hbm:{segs:[…]}, seq:{items:[…]}, c1:{value:'180 ms'},
          tl:{cells:[{row:'A',col:0,cls:'pre',text:'P'},{row:'B',col:1,cls:'dec'}]},   // timeline cell classes: pre dec wait idle
          att:{values:[[…]]}, ch:{s:[[0,1],[80,7]]}, l1:{text:'new text'}}}
  ]
});
```
Semantics: `hl/ok/bad/warn/busy/dim` are transient (this step only). `show/hide/set` are cumulative (replayed from
step 0, so Prev works). Packets animate along edges (`reverse:true` to go backwards; `cls` `c-ok c-bad c-blue c-purple`).
Every scene: 5–12 steps, each caption explains cause→effect with real numbers where possible.
Node icons available: user db gpu queue cloud lock doc llm server k8s agent gear cache shield chart key clock money bolt globe search memory check x warn.
Layout: keep inside w×h, leave ≥ 20 px between nodes, node width ≥ label length×7.5 px + 20.
Scene ids are global: prefix with your area (`v2-mcp-…`).

### Interview questions (Volume 3 only)
```js
registerQuestions([{
  id:'inf-01', chapter:'v3-ch-inference', difficulty:2,   // 1 core, 2 senior, 3 architect
  title:'How does vLLM batching work?',                   // A. the interviewer's question
  understand:'B. what the interviewer is assessing, in plain words',
  short:'C. natural 30–60 s spoken answer (no lists, no jargon dumps)',
  detailed:`D. HTML technical explanation (mechanics, numbers)`,
  diagram:`E. optional: fig(...)/svgDiagram or anim('id')`,
  followups:[{q:'F. harder follow-up',a:'concise strong answer'}],   // 3–5, increasing difficulty
  tradeoffs:`G. HTML: when one approach beats another`,
  failures:`H. HTML: behaviour under fault/overload`,
  vocab:[{term:'continuous batching',def:'I. precise meaning'}],     // 4–8
  mistakes:['J. plausible-but-wrong answers and why'],              // 3–5
  related:['v1-batching']                                           // lesson ids
}]);
```
Answers must sound like an experienced infrastructure engineer who understands AI, e.g. weak: "We can scale vLLM by
adding more GPUs." strong: "I'd first find whether the bottleneck is prefill compute, decode throughput, KV-cache
capacity or scheduler queueing, benchmark realistic input/output token distributions, measure TTFT and TPOT, and
pick the scaling strategy that holds the latency SLO at the lowest GPU cost."
Never put fabricated personal accomplishments in answers; where experience is needed, use a bracketed template
like "[In my lab I measured …]" or "[If you have run X in production, say so; if not, say: …]".

## 5. The capstone thread (one system, built progressively)

"**Atlas** — an enterprise AI assistant platform for a GCC travel company" (fictional). Stages:
1. Tiny PyTorch model (char-level transformer) — v1-capstone-train
2. Pre-trained open-weight model (a small instruct model, e.g. Qwen3-0.6B/1.7B class or Llama-3.2-1B class) — v1-capstone-train
3. LoRA fine-tune on synthetic travel-support tickets — v1-capstone-train
4. Serve with vLLM, benchmark TTFT/TPOT — v1-benchmarking
5. Deploy to Kubernetes (GPU node pool, Helm, probes, HPA/KEDA, GitOps) — v1-k8s-production
6. Add RAG over policy docs (hybrid search, ACLs) — v2-rag-production
7. Add MCP tools (booking lookup read-only, k8s/ops tools) + agent with approvals — v2-mcp-capstone / v2-agents
8. Caching, observability, security, FinOps — v2-cache-ops, v2-ai-observability, v2-ai-threat-model, v2-finops-optimization
9. Evolve to millions of users, multi-region, multi-tenant self-service platform — v2-capstone-platform
At each stage say what changed in the architecture and why, and what is lab-validated vs. a design that has NOT been
tested at scale.

## 6. Quality bar per lesson

- Length: substantive (typically 2,500–5,000 words of body for Vol 1/2 lessons). Depth over breadth.
- ≥ 1 animation for mechanism-heavy lessons, ≥ 1 static diagram for every lesson.
- ≥ 1 worked numeric example where numbers matter.
- A failure/troubleshooting section with concrete symptoms, metrics, commands.
- 4–6 quiz questions, 4–8 flashcards, glossary entries for new terms.
- Cross-links to prerequisite and advanced lessons with `L(id,label)`.

## 7. Lesson registry (ids are fixed)

| vol.part.num | id | title |
|---|---|---|
| 1.1.1 | v1-ai-landscape | What AI, ML, deep learning and generative AI really are |
| 1.1.2 | v1-neural-networks | Neural networks: parameters, loss, gradients and learning |
| 1.1.3 | v1-tensors-pytorch | Tensors and PyTorch: from Python to GPU kernels |
| 1.2.1 | v1-tokenization-embeddings | Tokenization and embeddings |
| 1.2.2 | v1-transformer | The transformer: attention, multi-head attention, positions and feed-forward layers |
| 1.2.3 | v1-generation | Context windows, generation, decoding, sampling and hallucination |
| 1.3.1 | v1-data-pipelines | Datasets: preparation, cleaning, splitting and evaluation |
| 1.3.2 | v1-training-loop | Training loops, optimizers, checkpoints, artifacts and reproducibility |
| 1.3.3 | v1-finetuning | Pretraining, continued pretraining, SFT, LoRA/QLoRA, preference optimization and distillation |
| 1.3.4 | v1-capstone-train | Capstone stages 1–3: tiny model → open-weight model → LoRA fine-tune |
| 1.4.1 | v1-gpu-architecture | GPU architecture: SMs, CUDA cores, Tensor Cores, HBM and bandwidth |
| 1.4.2 | v1-cuda | CUDA programming: kernels, threads, blocks, warps and memory hierarchy |
| 1.4.3 | v1-gpu-memory | GPU memory accounting and CUDA out-of-memory troubleshooting |
| 1.4.4 | v1-multi-gpu-profiling | PCIe, NVLink, multi-GPU communication and GPU profiling |
| 1.5.1 | v1-inference-anatomy | Anatomy of inference: loading, serving, prefill, decode, TTFT and TPOT |
| 1.5.2 | v1-kv-cache | KV cache and PagedAttention |
| 1.5.3 | v1-batching | Continuous batching, chunked prefill and request scheduling |
| 1.5.4 | v1-quantization-speculative | Quantization and speculative decoding |
| 1.5.5 | v1-engines | Inference engines: vLLM, SGLang, TensorRT-LLM, Triton and NVIDIA Dynamo |
| 1.5.6 | v1-benchmarking | Benchmarking inference correctly (capstone stage 4: serve with vLLM) |
| 1.6.1 | v1-k8s-gpu-stack | Kubernetes GPU stack: drivers, GPU Operator, device plugins, DRA, MIG and sharing |
| 1.6.2 | v1-k8s-serving | Model serving on Kubernetes: deployments, health checks, weight loading, KServe and llm-d |
| 1.6.3 | v1-k8s-autoscaling | Autoscaling and monitoring GPU inference |
| 1.6.4 | v1-k8s-production | Security, CI/CD, GitOps, rollback and production readiness (capstone stage 5) |
| 1.6.5 | v1-ai-apps-tools | From model to application: APIs, structured output, tool calling and a first look at MCP |
| 2.1.1 | v2-platform-architecture | The end-to-end enterprise AI platform: planes, boundaries and ownership |
| 2.1.2 | v2-ai-gateway | AI gateway, model routing and request orchestration |
| 2.2.1 | v2-cache-map | The AI caching map: ten caches, ten different problems |
| 2.2.2 | v2-response-semantic-cache | Exact response caching and semantic caching |
| 2.2.3 | v2-prefix-kv-cache | Prefix caching, KV reuse and provider prompt caching |
| 2.2.4 | v2-distributed-kv | Distributed KV cache, CPU/SSD offload and cache-aware routing |
| 2.2.5 | v2-rag-weight-cache | RAG retrieval caching, embedding caching and model-weight caching |
| 2.2.6 | v2-cache-ops | Cache invalidation, consistency, tenant isolation, security, metrics and cost |
| 2.3.1 | v2-parallelism | Parallelism strategies and Mixture-of-Experts |
| 2.3.2 | v2-distributed-training | Distributed training: NCCL, RDMA, InfiniBand, FSDP, DeepSpeed ZeRO and recovery |
| 2.3.3 | v2-distributed-inference | Distributed inference: disaggregated prefill/decode, distributed loading and GPU fleet scheduling |
| 2.4.1 | v2-mlops-foundations | MLOps foundations: data versioning, experiment tracking, feature stores, registries, MLflow |
| 2.4.2 | v2-model-cicd | Model CI/CD, promotion, continuous training, prompt versioning and rollback |
| 2.4.3 | v2-evaluation-monitoring | Evaluation frameworks, online/offline evaluation, monitoring and drift |
| 2.5.1 | v2-rag-fundamentals | RAG fundamentals: embeddings, vector databases, chunking, hybrid search, reranking |
| 2.5.2 | v2-rag-production | Production RAG: freshness, access control, evaluation, GraphRAG, agentic RAG, long context, cost |
| 2.6.1 | v2-mcp-why | Why MCP exists: APIs, protocols and MCP versus REST, GraphQL, gRPC and function calling |
| 2.6.2 | v2-mcp-protocol | Inside MCP: hosts, clients, servers, primitives, JSON-RPC, lifecycle and transports |
| 2.6.3 | v2-mcp-python | Build your first MCP server in Python, from scratch |
| 2.6.4 | v2-mcp-typescript | Build the MCP server in TypeScript |
| 2.6.5 | v2-mcp-local-remote | Local (stdio) versus remote (Streamable HTTP) MCP |
| 2.6.6 | v2-mcp-auth | Securing remote MCP: OAuth 2.1, tokens, per-tool authorization and tenant isolation |
| 2.6.7 | v2-mcp-deploy | Deploying a production MCP server: Docker, Kubernetes, Helm, onboarding, monitoring, reliability |
| 2.6.8 | v2-mcp-security | MCP threat modeling: tool poisoning, prompt injection, confused deputies and trust boundaries |
| 2.6.9 | v2-mcp-capstone | Capstone lab: the DevOps infrastructure-optimization MCP server |
| 2.6.10 | v2-agents | AI agents: architectures, frameworks, memory, human-in-the-loop, evaluation, cost and reliability |
| 2.6.11 | v2-a2a-multiagent | A2A and multi-agent systems |
| 2.7.1 | v2-capacity-planning | Capacity planning: users → requests → tokens → GPUs |
| 2.7.2 | v2-hyperscale-serving | Queueing, admission control, autoscaling signals, warm-up and cold starts |
| 2.7.3 | v2-multi-region | Multi-region, active-active, disaster recovery, data residency and degraded modes |
| 2.8.1 | v2-ai-observability | Observability for AI systems: metrics, traces, OpenTelemetry GenAI, SLOs |
| 2.8.2 | v2-aiops | AIOps: anomaly detection, alert correlation, RCA and safe automated remediation |
| 2.9.1 | v2-finops-unit-economics | AI FinOps: GPU cost models, cost per token, cost per successful request |
| 2.9.2 | v2-finops-optimization | AI FinOps optimization: capacity commitments, spot, routing, caching, chargeback, build vs buy |
| 2.10.1 | v2-ai-threat-model | AI threat modeling: prompt injection, poisoning, supply chain, data privacy |
| 2.10.2 | v2-governance | Identity, isolation, audit, governance, risk management and red teaming |
| 2.11.1 | v2-capstone-platform | Capstone stages 6–9: RAG, MCP tools, hardening, and evolving to millions of users |
| 2.11.2 | v2-landscape | The technology landscape: what this course includes, excludes and why |
| 3.1.1 | v3-how-to-interview | How to interview as a DevOps-to-AI engineer |
| 3.2.1 | v3-ch-foundations | Questions: ML foundations and LLM internals |
| 3.2.2 | v3-ch-training | Questions: data, training and fine-tuning |
| 3.2.3 | v3-ch-gpu | Questions: GPU, CUDA and performance |
| 3.2.4 | v3-ch-inference | Questions: inference engines and serving |
| 3.2.5 | v3-ch-caching | Questions: caching |
| 3.2.6 | v3-ch-k8s | Questions: Kubernetes and distributed systems |
| 3.2.7 | v3-ch-mlops | Questions: MLOps and LLMOps |
| 3.2.8 | v3-ch-rag | Questions: RAG and AI applications |
| 3.2.9 | v3-ch-mcp | Questions: MCP (25 senior questions) |
| 3.2.10 | v3-ch-agents | Questions: agents, A2A and agent security |
| 3.2.11 | v3-ch-hyperscale | Questions: hyperscale, capacity and multi-region |
| 3.2.12 | v3-ch-aiops | Questions: AIOps, reliability and incidents |
| 3.2.13 | v3-ch-finops | Questions: AI FinOps |
| 3.2.14 | v3-ch-security | Questions: AI security and governance |
| 3.2.15 | v3-ch-leadership | Questions: technical leadership |
| 3.3.1 | v3-whiteboard | Quantitative whiteboard exercises |
| 3.3.2 | v3-debugging | Production debugging drills |
| 3.3.3 | v3-system-design | System design challenges |
| 3.3.4 | v3-mock-interviews | Mock interview rounds with scoring |
| 3.4.1 | v3-prove-llm | Prove it 1: explain how an LLM works, end to end |
| 3.4.2 | v3-prove-platform | Prove it 2: build and deploy an AI platform |
| 3.4.3 | v3-prove-10m | Prove it 3: design for 10 million users |
| 3.4.4 | v3-prove-mcp | Prove it 4: build a production-style MCP integration |
| 3.4.5 | v3-prove-incident | Prove it 5: solve a real production incident |

## 8. Labs that exist (include from these; do not invent other lab paths)
See `labs/README.md` for the up-to-date list of files and `[START x]` regions.
