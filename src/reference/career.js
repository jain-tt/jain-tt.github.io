/* Career page and "Prove it" index page. */
(function(){
'use strict';
const lv=(n)=>['—','1 aware','2 working','3 independent','4 expert'][n];
const S=(tech,lesson,u,i,d,ds,e)=>['<b>'+tech+'</b><br><small>'+L(lesson,'lesson')+'</small>',lv(u),lv(i),lv(d),lv(ds),lv(e)];

registerPage('career',{title:'Career map: skills, roadmap and evidence',html:`
<p>This page turns the course into a career plan for the target roles: Senior AI Platform Engineer, AI Infrastructure Architect, MLOps/LLMOps lead, GPU infrastructure engineer, AIOps and AI FinOps leader. It starts from where you already are: twelve years of cloud, Kubernetes, IaC, CI/CD, observability and data platforms.</p>
${callout('warn','An honest note','No course, certificate or portfolio guarantees interviews or offers. Hiring depends on market timing, location, networks and luck as well as skill. What this plan can do is make your skills real, visible and explainable — so that when you get the conversation, you can prove depth. Never claim production experience you do not have; say "demonstrated in a lab" and explain exactly what you measured.')}

<h2>1. Skills matrix with target levels</h2>
<p>Five abilities per technology. Levels: <b>1 aware</b> (can describe it), <b>2 working</b> (has used it with guidance), <b>3 independent</b> (can do it alone and fix common faults), <b>4 expert</b> (can design, teach and defend trade-offs). Targets below are for a senior AI platform role; adjust for GPU-infra or FinOps-heavy roles.</p>
${table(['Technology','Understand','Implement','Debug','Design','Explain in interview'],[
S('Neural networks, loss, gradients','v1-neural-networks',3,2,2,1,3),
S('Transformer, attention, KV cache','v1-transformer',4,2,3,3,4),
S('Tokenization, embeddings','v1-tokenization-embeddings',3,2,2,2,3),
S('PyTorch training loop, checkpoints','v1-training-loop',3,3,3,2,3),
S('Fine-tuning: LoRA/QLoRA, SFT','v1-finetuning',3,3,2,3,3),
S('GPU architecture and memory accounting','v1-gpu-memory',4,3,4,3,4),
S('CUDA basics and profiling','v1-cuda',2,1,2,1,2),
S('Inference: prefill/decode, TTFT/TPOT','v1-inference-anatomy',4,3,4,4,4),
S('vLLM / SGLang / TensorRT-LLM','v1-engines',3,3,4,3,4),
S('Quantization and speculative decoding','v1-quantization-speculative',3,2,2,3,3),
S('Benchmarking (goodput at SLO)','v1-benchmarking',4,4,3,4,4),
S('K8s GPU stack: Operator, device plugin, DRA, MIG','v1-k8s-gpu-stack',4,4,4,4,4),
S('Model serving on K8s: llm-d, KServe, Dynamo','v1-k8s-serving',3,3,3,4,4),
S('Autoscaling GPU inference (KEDA, Karpenter)','v1-k8s-autoscaling',4,4,4,4,4),
S('AI gateway and routing','v2-ai-gateway',4,3,3,4,4),
S('Caching: prefix, semantic, response, KV offload','v2-cache-map',4,3,3,4,4),
S('Distributed training: NCCL, FSDP, ZeRO','v2-distributed-training',3,2,3,2,3),
S('Disaggregated / distributed inference','v2-distributed-inference',3,2,2,3,3),
S('MLOps: MLflow, registry, data versioning','v2-mlops-foundations',4,3,3,4,4),
S('Model CI/CD and evaluation gates','v2-model-cicd',4,4,3,4,4),
S('Evaluation and drift monitoring','v2-evaluation-monitoring',3,3,3,3,4),
S('RAG: hybrid search, reranking, ACLs, freshness','v2-rag-production',4,3,3,4,4),
S('MCP: protocol, servers, auth, deployment','v2-mcp-protocol',4,4,4,4,4),
S('Agents and A2A','v2-agents',3,3,3,3,4),
S('Capacity planning DAU → GPUs','v2-capacity-planning',4,3,3,4,4),
S('Multi-region, DR, data residency','v2-multi-region',4,3,3,4,4),
S('AI observability, OTel GenAI, SLOs','v2-ai-observability',4,4,4,4,4),
S('AIOps: anomaly detection, safe remediation','v2-aiops',3,3,3,3,4),
S('AI FinOps: unit economics, chargeback','v2-finops-unit-economics',4,3,3,4,4),
S('AI security: injection, supply chain, governance','v2-ai-threat-model',4,3,3,4,4)
])}
<p>Rate yourself honestly every month in the course dashboard notes. A level counts only when you have evidence (a lab, a measurement, a write-up).</p>

<h2>2. A 12-month roadmap from a DevOps background</h2>
<p>About 8–10 hours per week alongside a full-time job and the M.Tech. Each quarter ends with a portfolio artefact.</p>
${table(['Months','Focus','Course lessons','Leverages your DevOps strength','Exit evidence'],[
['1–2','Model internals you need for infrastructure: tensors, transformer, generation, memory maths','Vol 1 Parts 1–2, '+L('v1-gpu-memory','GPU memory'),'Reading configs and capacity sheets like any other system spec','Capstone stages 1–3 notebook; a memory/KV calculator you can explain line by line'],
['3–4','Inference engineering: serve, benchmark, tune','Vol 1 Part 5','Load testing, SLOs, Prometheus','vLLM benchmark report: TTFT/TPOT vs concurrency curve, goodput at a stated SLO, cost per 1 M tokens'],
['5–6','Kubernetes GPU platform and GitOps','Vol 1 Part 6','Helm, Argo CD, Karpenter, IAM — your home ground','Helm chart + GitOps deploy of the model with probes, KEDA scaling, dashboards, a written runbook'],
['7–8','Platform architecture, gateway, caching, RAG','Vol 2 Parts 1, 2, 5','Gateways, Redis, OpenSearch, data pipelines (Kafka/Airflow)','RAG service with hybrid search, ACL filtering, eval set and freshness alert'],
['9','MCP and agents','Vol 2 Part 6','API design, OAuth/IAM, least privilege','Production-style MCP server (Python or TS) with OAuth, per-tool authz, audit log, tests, Helm'],
['10','Observability, AIOps, reliability','Vol 2 Part 8','Prometheus/Mimir/Grafana, on-call','SLO dashboards + burn-rate alerts + three runbooks used in a game day'],
['11','Hyperscale, FinOps, security','Vol 2 Parts 7, 9, 10','Cost management, multi-region, security reviews','10 M-user design doc with capacity model, cost model, threat model'],
['12','Interview readiness','Vol 3','Incident leadership, stakeholder communication','Five "Prove it" demonstrations recorded or written; mock interview scores trending up']
])}

<h2>3. Durable fundamentals versus fast-changing frameworks</h2>
<div class="twocol"><div>
<h3>Durable (invest deeply)</h3>
<ul>
<li>Memory and bandwidth arithmetic: weights, KV cache, roofline, decode bound.</li>
<li>Prefill vs decode, batching, queueing theory, Little’s law, tail latency.</li>
<li>Distributed systems: consistency, failure domains, backpressure, idempotency.</li>
<li>Evaluation discipline: datasets, slices, judges calibrated to humans, confidence.</li>
<li>Security fundamentals: least privilege, trust boundaries, supply chain, OAuth.</li>
<li>Unit economics: cost per successful outcome, utilization, commitment trade-offs.</li>
<li>Observability: metrics, traces, SLOs, burn rates.</li>
</ul></div><div>
<h3>Fast-changing (learn just in time, verify versions)</h3>
<ul>
<li>Engine flags and defaults (vLLM ships about every two weeks).</li>
<li>Orchestration layers: Dynamo, llm-d, KServe LLMInferenceService (alpha APIs).</li>
<li>Agent frameworks (AutoGen to maintenance mode, Semantic Kernel folded into Microsoft Agent Framework within two years).</li>
<li>MCP spec revisions (2025-11-25 → 2026-07-28 removed sessions and the handshake).</li>
<li>OTel GenAI conventions (all still "Development"; names changed in 2026).</li>
<li>Model names, prices and provider APIs.</li>
</ul></div></div>
${callout('tip','Interview framing','When asked about a fast-moving tool, anchor on the durable mechanism first ("routing should be KV-aware because…"), then name the current tools and say you would verify versions. That shows judgement, not memorised release notes.')}

<h2>4. Portfolio evidence checklist</h2>
${checklist([
{key:'pf-bench',text:'Benchmark report: one model, one GPU type, TTFT/TPOT/goodput vs concurrency, with method and limits stated'},
{key:'pf-kv',text:'KV-cache and capacity calculator (labs/11-capacity) with a worked 10 M-user example'},
{key:'pf-helm',text:'Helm chart + GitOps repo deploying a model server with probes, autoscaling, NetworkPolicy and dashboards'},
{key:'pf-lora',text:'LoRA fine-tune with an evaluation comparison (base vs tuned) on a held-out split'},
{key:'pf-rag',text:'RAG service with hybrid retrieval, ACL filtering, eval metrics (recall@k, groundedness) and a freshness check'},
{key:'pf-mcp',text:'MCP server with OAuth, per-tool authorization, audit log, tests and deployment manifests'},
{key:'pf-obs',text:'SLO dashboard + multi-window burn-rate alerts + three runbooks'},
{key:'pf-design',text:'Architecture doc: multi-region, residency, cost model, threat model, degraded modes'},
{key:'pf-incident',text:'A written post-incident review from a lab failure you induced (OOM, KV exhaustion or MCP auth loop)'},
{key:'pf-talk',text:'One short talk or blog post explaining a mechanism (e.g. why decode is memory-bound)'}
])}
<p>Each artefact should state what was measured, on what hardware, what was NOT tested (scale, multi-region, real traffic) and what you would do next.</p>

<h2>5. How to use this page with the rest of the course</h2>
<p>Use ${L('v3-how-to-interview','How to interview as a DevOps-to-AI engineer')} to turn evidence into stories, and the <a href="#/prove">Prove it index</a> for the five final demonstrations.</p>
`});

registerPage('prove',{title:'Prove it: five final demonstrations',html:`
<p>The last part of Volume 3 asks you to <b>demonstrate</b>, not recite. Each "Prove it" lesson is a timed exercise with a scoring rubric. Do them after the question bank and mock interviews. Record yourself or write the answer, then score it honestly.</p>
${table(['#','Lesson','What it demonstrates','Built on','Evidence you produce'],[
['1',L('v3-prove-llm','Explain how an LLM works, end to end'),'You can walk from text to tokens, embeddings, attention, the KV cache, sampling and back, with numbers (bytes per token, FLOPs per token) and without hand-waving','Vol 1 Parts 1–2 and 5','A 10-minute whiteboard explanation with a KV-cache and memory calculation'],
['2',L('v3-prove-platform','Build and deploy an AI platform'),'You can take a model from weights to a monitored, autoscaled, GitOps-managed Kubernetes service and explain every decision','Vol 1 Part 6, Vol 2 Parts 1 and 8','Repository + benchmark + dashboard screenshots + a short design note'],
['3',L('v3-prove-10m','Design for 10 million users'),'You can size a system from DAU to GPUs using prefill AND decode, KV limits and SLO goodput, add headroom and failover, and price it','Vol 2 Parts 7 and 9','A capacity and cost model with stated assumptions and sensitivities'],
['4',L('v3-prove-mcp','Build a production-style MCP integration'),'You can build, secure (OAuth 2.1, per-tool authorization), deploy and threat-model an MCP server, and say which spec era it speaks','Vol 2 Part 6','Server code, tests, Helm chart and a threat model'],
['5',L('v3-prove-incident','Solve a real production incident'),'You can lead an investigation under pressure: hypotheses, evidence, mitigation, communication, post-incident review','Vol 2 Part 8, the runbooks','A timeline, the queries you ran and a blameless review']
])}
${callout('note','How they are scored','Each lesson has a rubric: correctness, quantitative reasoning, trade-offs, failure handling, and communication. A strong performance states assumptions, separates measured facts from estimates, and says what was lab-tested versus designed but untested at scale.')}
<h2>Suggested order</h2>
${chain(['Prove 1: LLM internals','Prove 2: platform','Prove 3: 10 M users','Prove 4: MCP','Prove 5: incident'])}
<p>Before you start, revisit the <a href="#/formulas">formula reference</a>, the <a href="#/runbooks">runbooks</a> and the <a href="#/career">career map</a> to check your self-ratings.</p>
`});
})();
