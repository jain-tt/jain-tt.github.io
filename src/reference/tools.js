/* Reference library: tool comparison tables. Versions/status from the research sheets checked 2026-10-14
   ("as of Oct 2026"). Anything not confirmed there is flagged unverified. */
(function(){
'use strict';
const H=['Tool','Responsibility','Strengths','Limitations','Maturity (as of Oct 2026)','When to choose'];
function T(o){
  return {id:o.id,title:o.title,lesson:o.lesson,html:
    '<p>'+o.intro+'</p>'+table(o.head||H,o.rows)+(o.after||'')};
}
const B=(c,t)=>'<span class="badge '+c+'">'+t+'</span>';
const MAT=B('v1','mature'), GROW=B('v2','maturing'), EMER=B('x','emerging'), LEG=B('v3','legacy / maintenance');

registerTools([

T({id:'t-engines',title:'Inference engines',lesson:'v1-engines',
intro:'An inference engine owns ONE replica: it loads weights, schedules requests into batches, manages the KV cache and runs the kernels. Orchestration layers (next table) sit around engines; they do not replace them.',
rows:[
['<b>vLLM</b>','Single-replica LLM serving: continuous batching, PagedAttention, prefix caching (on by default), chunked prefill (on by default in V1), OpenAI- and Anthropic-compatible endpoints','Widest model coverage; rich Prometheus metrics (vllm:*); LoRA multi-adapter; structured outputs (xgrammar/guidance); KV connectors (NIXL, LMCache, Mooncake) for disaggregation','Fast release cadence (≈ every 2 weeks) breaks flags; defaults are hardware-dependent; V0 engine removed in v0.11','v0.31.0 (2026-10-05). '+MAT,'Default choice for open-weight GPU serving on Kubernetes; the base engine of llm-d, KServe LLMInferenceService and Ray Serve LLM'],
['<b>SGLang</b>','Single-replica serving with RadixAttention (radix-tree prefix reuse), structured programs, PD disaggregation','Strong prefix reuse for agent/multi-turn workloads; cache-aware scheduling option (--schedule-policy lpm, default is fcfs); router for PD','Smaller ecosystem than vLLM; docs moved to docs.sglang.io','v0.5.21 (2026-10-02). '+MAT,'Heavy shared-prefix traffic (agents, few-shot, RAG templates); teams willing to benchmark both'],
['<b>TensorRT-LLM</b>','NVIDIA-optimised engine; PyTorch backend is now the sole execution backend (engine-build path removed in the 1.3 line)','Best-in-class NVIDIA kernels, FP8/NVFP4 quantization via ModelOpt; trtllm-serve OpenAI endpoint; Dynamo backend','NVIDIA-only; stable line (1.2.1) lags release candidates (1.3.0rc29); config surface is large','Stable v1.2.1 (2026-04-20), 1.3 RCs. '+MAT,'NVIDIA-only fleets chasing maximum tokens/s per GPU, especially Blackwell FP4'],
['<b>llama.cpp</b>','C/C++ inference on CPU, Apple Silicon and GPUs with GGUF quantized files; llama-server exposes an OpenAI-compatible API','Runs anywhere, tiny dependencies, aggressive quantization; ideal for laptops and edge','Not designed for high-concurrency multi-tenant GPU serving; fewer production metrics','Very active open source; release tags change daily — '+B('x','pin a tag'),'Local development, edge/offline, CPU-only environments, prototypes'],
['<b>Hugging Face TGI</b>','Text Generation Inference server','Was an early production server with HF integration','README: "text-generation-inference is now in maintenance mode"; repository archived on 2026-03-21; HF recommends vLLM or SGLang',LEG,'Only to run existing deployments while migrating; do not start new projects on it'],
['<b>Triton (Dynamo-Triton)</b>','General multi-framework model server (ONNX, TensorRT, PyTorch, Python backends, ensembles)','Mature for classic ML/CV models; dynamic batching; renamed "NVIDIA Dynamo-Triton"','For LLMs NVIDIA positions Dynamo as the successor; not an LLM scheduler itself','v2.73.0 = NGC 26.09 (2026-09-30). '+MAT,'Non-LLM models (vision, embeddings, rankers) and mixed fleets already on Triton']
],
after:callout('note','How to choose','Benchmark the two leading candidates with YOUR prompt/output distribution and SLO (vllm bench serve --goodput). Engine choice is a measured decision, not a brand preference. See '+L('v1-benchmarking','benchmarking')+'.')}),

T({id:'t-orchestration',title:'Serving orchestration and routing around engines',lesson:'v1-k8s-serving',
intro:'These layers place, route, scale and disaggregate many engine replicas. They answer "which replica should take this request?" and "how many prefill vs decode workers do I need?"',
rows:[
['<b>NVIDIA Dynamo</b>','Distributed serving framework AROUND engines (vLLM, SGLang, TensorRT-LLM): OpenAI frontend, KV-aware router, Planner (scales prefill/decode to TTFT/ITL SLAs), KV Block Manager, NIXL transfer, K8s operator (DynamoGraphDeployment)','Backend-agnostic; disaggregated prefill/decode; SLA-driven planner; etcd/NATS now optional (Kubernetes-native discovery)','Many moving parts; NVIDIA-centric; fast-moving APIs','v1.5.1 (2026-10-07), 1.x GA line. '+GROW,'Large NVIDIA fleets where disaggregation and KV-aware routing pay off'],
['<b>llm-d</b>','Kubernetes-native distributed inference: llm-d Router (GAIE-conformant proxy + Endpoint Picker), prefix-cache-aware and predicted-latency routing, tiered KV offload, P/D disaggregation, KEDA autoscaling on EPP metrics','Built on Gateway API Inference Extension; vendor-neutral; "well-lit paths" reference designs','Pre-1.0; inherited the full EPP from GAIE in 2026, so APIs moved','v0.10.0 (2026-09-29), CNCF Sandbox. '+EMER,'K8s-first platforms wanting open, gateway-integrated LLM routing'],
['<b>KServe</b>','Model serving CRDs on Kubernetes; LLMInferenceService (llmisvc) builds on llm-d and InferencePool','Familiar InferenceService model for classic ML; one control plane for predictive and generative','LLMInferenceService CRD still v1alpha1/v1alpha2 in v0.21.0 (alpha API despite "production-ready" marketing)','v0.21.0 (2026-09-25). Core '+MAT+', llmisvc '+EMER,'Organisations already standardised on KServe; multi-framework model catalogues'],
['<b>Ray Serve LLM</b>','Python-native serving on Ray: LLMConfig + build_openai_app, autoscaling, PD disaggregation (build_pd_openai_app), prefix-cache-affinity router','Composes LLMs with Python business logic and other models; good for batch + online on one cluster','Ray cluster security is your job (CVE-2023-48022 / ShadowRay: never expose the dashboard/jobs API; token auth from Ray 2.52)','Ray 2.59.0 (2026-10-02). '+MAT,'Teams already on Ray/Anyscale; pipelines mixing LLM calls with custom Python'],
['<b>Gateway API Inference Extension (GAIE)</b>','InferencePool CRD (inference.networking.k8s.io/v1) + endpoint-picker protocol via ext-proc','Standard API any gateway can implement; model-aware endpoint selection','From v1.6 ships only a lightweight conformance EPP; full EPP features moved to llm-d','v1.6.2 (2026-09-17); InferencePool v1 GA. '+GROW,'The standard Kubernetes contract between your gateway and model-server pools'],
['<b>Plain Deployment + Service</b>','Kubernetes Deployment of vLLM behind a Service/Ingress','Simplest; easy to debug; works for 1–10 replicas','Round-robin ignores KV/prefix state and queue depth; no disaggregation',MAT,'Labs, single-model services, first production stage (capstone stage 5)']
]}),

T({id:'t-gateways',title:'AI gateways',lesson:'v2-ai-gateway',
intro:'An AI gateway is the policy point in front of model providers and self-hosted models: auth, per-tenant token quotas, routing/fallback, caching, logging, cost attribution. Do not confuse it with the endpoint picker that chooses a replica inside one pool.',
rows:[
['<b>Agent Router</b> (formerly Envoy AI Gateway)','Envoy Gateway extension: AIGatewayRoute, AIServiceBackend, BackendSecurityPolicy, MCPRoute, QuotaPolicy; token-based rate limits (llmRequestCosts: InputToken, CachedInputToken, OutputToken, TotalToken, CEL)','Kubernetes-native CRDs; token-cost rate limiting charged after the response; MCP routing; Envoy performance','Renamed and moved to the Agentic AI Foundation in 2026 (API group still aigateway.envoyproxy.io); AIGatewayRoute v1beta1','v1.2.0 (2026-10-07). '+GROW,'Kubernetes platforms already on Envoy Gateway; need per-tenant token quotas'],
['<b>LiteLLM</b> (proxy)','"Open Source AI Gateway for 100+ LLMs": one OpenAI-format API over many providers, keys, budgets, fallbacks, logging','Fastest way to unify providers; virtual keys and spend tracking; Python ecosystem','Some enterprise features under a commercial licence; Python proxy throughput must be load-tested; release version not verified here','Widely used; '+B('x','version unverified'),'Multi-provider access for internal teams; quick start before a platform gateway'],
['<b>Kong AI Gateway</b>','AI plugins on Kong Gateway (multi-provider proxy, prompt guards, semantic cache, rate limiting)','Reuses an existing Kong estate, plugins and ops knowledge','Plugin names/features vary by Kong version and tier',B('x','details unverified — check Kong docs for your version'),'Organisations that already run Kong for APIs'],
['<b>Cloud-managed</b> (Bedrock, Vertex AI, Azure AI Foundry endpoints)','Provider-side gateways with IAM, quotas, guardrails, logging','No infrastructure; native IAM and billing','Lock-in; cross-provider routing limited; residency depends on region availability (no AWS Saudi region open as of Oct 2026)',MAT,'Single-cloud shops; regulated workloads that need the provider’s compliance scope'],
['<b>Bedrock AgentCore Gateway</b>','Turns APIs/Lambda into MCP tools; Policy service intercepts tool calls (Cedar-compatible)','Managed MCP front door with identity and policy','AWS-specific; tool gateway, not an LLM traffic gateway','SDK bedrock-agentcore 1.24.1 (2026-10-07). '+GROW,'AWS agent platforms that need a governed tool layer'],
['<b>Build your own</b>','Thin proxy you write (e.g. FastAPI/Go) with OpenTelemetry','Total control','You own streaming, retries, quota accounting, security patches forever',B('x','—'),'Only when no product fits a hard requirement']
]}),

T({id:'t-vectordbs',title:'Vector databases and search engines',lesson:'v2-rag-fundamentals',
intro:'Retrieval stores for RAG. The real decision is usually "Postgres/OpenSearch I already run" versus "a dedicated vector engine", driven by scale, filtering, hybrid search and ops skills.',
rows:[
['<b>pgvector</b>','Vector types (vector, halfvec, sparsevec, bit) and HNSW/IVFFlat indexes inside PostgreSQL','Transactions, joins and row-level ACL filtering in the same DB; operators <->, <=>, <#>','HNSW build memory and vacuum behaviour need tuning; index dims ≤ 2,000 (vector) / 4,000 (halfvec)','v0.8.7 (2026-10-01). '+MAT,'Up to tens of millions of vectors when the team already runs Postgres (often RDS/Aurora)'],
['<b>OpenSearch / Elasticsearch</b>','Lexical + vector + hybrid search; RRF (rank_constant default 60)','Best-in-class BM25 and hybrid; mature ops; Elastic BBQ quantization','JVM cluster operations; licence differences between the two','OpenSearch 3.9.0, Elasticsearch 9.5.5. '+MAT,'Hybrid search where keyword precision matters (product codes, booking references, Arabic/English text)'],
['<b>Qdrant</b>','Dedicated vector engine (Rust), payload filtering, quantization','Fast filtered search; simple to operate','Another stateful system to run and back up','v1.19.2. '+MAT,'Dedicated vector workloads with heavy metadata filters'],
['<b>Weaviate</b>','Vector DB with modules (vectorizers, hybrid)','Batteries included; hybrid search','Module sprawl; memory sizing','v1.40.1. '+MAT,'Teams wanting integrated embedding + search'],
['<b>Milvus</b>','Distributed vector DB for very large scale','Billions of vectors, GPU indexes, disaggregated storage','Many components (object storage, message queue); now 3.x','3.0.3. '+MAT,'Very large corpora with a team to run it'],
['<b>Pinecone</b>','Managed serverless vector database','Zero ops; integrated embedding','SaaS lock-in; cloud/region fixed at index creation; residency constraints',MAT,'Speed to market, no in-house DB ops, residency allows it'],
['<b>Chroma / LanceDB</b>','Embedded/developer-first stores (LanceDB on the Lance columnar format)','Easiest local start; LanceDB good for multimodal data lakes','Fewer multi-tenant production features','Chroma 1.5.9; LanceDB v0.40.0. '+GROW,'Prototypes, notebooks, embedded apps, offline evaluation'],
['<b>Vespa</b>','Search + ranking platform with tensors','Advanced ranking expressions at scale','Steep learning curve','v8.763.x. '+MAT,'Large-scale ranking-heavy search']
]}),

T({id:'t-mlops',title:'MLOps: tracking, registry, pipelines, data versioning, features',lesson:'v2-mlops-foundations',
intro:'Each tool owns a different artefact: runs, models, prompts, pipelines, datasets or features. Most platforms combine several.',
rows:[
['<b>MLflow</b>','Experiment tracking, model registry (aliases; stages deprecated since 2.9.0), prompt registry, GenAI tracing (OpenTelemetry-compatible), genai.evaluate with LLM judges','Open source, self-hostable, broad integrations; covers classic ML and GenAI','Self-hosted server needs a DB + object store and auth in front; some judges Databricks-only','3.17.1 (2026-10-13). '+MAT,'Default open registry/tracking; GenAI tracing + evaluation in one place'],
['<b>Weights & Biases</b> (W&B; Weave)','Experiment tracking SaaS; Weave for LLM tracing/evals','Excellent UI and collaboration','SaaS-centric; Weave docs moved to CoreWeave, which names "Agent Lens" as Weave’s successor',GROW+' (Weave in transition)','Research-heavy teams; GPU training experiments'],
['<b>Kubeflow</b> (Pipelines, Trainer)','KFP: containerised ML pipelines on K8s (v2 API); Trainer: TrainJob CRD for distributed training','K8s-native; integrates with Kueue, JobSet','Operational weight; Trainer API is alpha (trainer.kubeflow.org/v1alpha1); platform now versioned 26.03','KFP 2.17.x, Trainer v2.3.0, distribution 26.03.1. '+GROW,'K8s-centric orgs that want pipelines and training jobs as CRDs'],
['<b>DVC</b>','Git-based versioning of data and models (pointers in Git, blobs in remote storage)','Simple, Git workflow; reproducible pipelines','Not a data lake tool; large teams outgrow it','3.67.1. '+MAT,'Small/medium datasets, individual or team reproducibility'],
['<b>lakeFS</b>','Git-like branches/commits over object storage (S3, GCS, Azure Blob)','Zero-copy branches of a data lake; atomic merges','BUSL-1.1 licence; another service to run','v1.88.0. '+MAT,'Versioning large data lakes used for training'],
['<b>Delta Lake</b>','ACID table format with time travel','Reproducible training snapshots by version; Spark ecosystem','Table format, not a full versioning workflow','4.4.1. '+MAT,'Lakehouse teams (Spark/EMR/Databricks)'],
['<b>Feast</b>','Feature store: offline store for training, online store for low-latency serving','Point-in-time correct joins; open source','Mostly relevant to classic ML features, less to LLM apps','v0.67.0 (2026-10-13). '+MAT,'Real-time ML features (fraud, ranking, pricing)']
]}),

T({id:'t-data-quality',title:'Data quality and drift',lesson:'v1-data-pipelines',
intro:'Catch bad data before it trains or answers. Licences differ and matter for redistribution.',
rows:[
['<b>Great Expectations (GX Core)</b>','Declarative expectations on datasets','Large library of checks; Apache-2.0','Verbose configuration','1.24.0. '+MAT,'Batch data validation in pipelines'],
['<b>Soda Core</b>','Data-contract verification engine (v4 contracts-first)','Contracts as code in pipelines','Elastic License 2.0 (not Apache); v3 "SodaCL" vocabulary is legacy','4.27.0. '+MAT,'Teams adopting data contracts'],
['<b>Evidently</b>','Data drift, model quality and LLM evaluation reports/monitors','Sensible drift defaults (ks/wasserstein/chisquare/jensenshannon; psi optional); LLM judges','Python library; you operate the monitoring service','0.7.23. '+MAT,'Drift monitoring for tabular and text inputs']
]}),

T({id:'t-eval',title:'Evaluation frameworks (offline and online)',lesson:'v2-evaluation-monitoring',
intro:'Evaluation tools run datasets through your system and score outputs with metrics, code checks or LLM judges. Choose by what you evaluate (RAG, agents, safety) and where results must live.',
rows:[
['<b>MLflow GenAI evaluate</b>','mlflow.genai.evaluate with scorers (Correctness, Guidelines, RetrievalGroundedness, ToolCallCorrectness…), make_judge','Ties evals to traces, runs and registered prompts','Some built-in judges only on Databricks-managed MLflow','3.17.x. '+MAT,'You already use MLflow'],
['<b>RAGAS</b>','RAG metrics: Faithfulness, AnswerRelevancy, ContextPrecision, ContextRecall…','Purpose-built RAG metrics','Legacy metric API deprecated in 0.4; release cadence slowed (v0.4.3, Jan 2026)',GROW,'RAG retrieval and grounding evaluation'],
['<b>DeepEval</b>','Pytest-style LLM tests: GEval, Faithfulness, TaskCompletion, ToolCorrectness…','CI-friendly; 50+ metrics incl. agent metrics','LLM-judge cost and variance','v4.2.4 (2026-09-22). '+GROW,'Unit-test style quality gates in CI'],
['<b>promptfoo</b>','Prompt/model eval matrices and red-teaming (CLI, YAML)','Fast A/B of prompts and models; red-team plugins; open source','Acquired by OpenAI (March 2026); OSS continues','0.124.1. '+GROW,'Prompt regression tests and red-team scans in CI'],
['<b>TruLens</b>','RAG triad: context relevance, groundedness, answer relevance','Clear conceptual model','Smaller ecosystem',GROW,'Teaching and quick RAG diagnostics'],
['<b>Phoenix / Langfuse / LangSmith evals</b>','Datasets + experiments attached to traces','Eval and observability in one UI','Tied to that platform’s data model',GROW,'When the observability platform is already chosen']
],
after:callout('warn','Judge discipline','LLM judges need calibration against human labels, a fixed judge model version, and confidence intervals. A judge change is a release, like a model change.')}),

T({id:'t-observability',title:'LLM observability and tracing',lesson:'v2-ai-observability',
intro:'Infrastructure metrics (DCGM, engine /metrics) tell you whether the system is healthy; LLM traces tell you why an answer was wrong or expensive. You need both.',
rows:[
['<b>Prometheus + DCGM exporter + engine metrics</b>','GPU (DCGM_FI_DEV_GPU_UTIL, FB_USED, PIPE_TENSOR_ACTIVE, XID_ERRORS) and engine metrics (vllm:time_to_first_token_seconds, vllm:kv_cache_usage_perc, …)','Standard SRE stack (Mimir/Grafana); alerting','No prompt/response content, no per-request reasoning view',MAT,'Always: the foundation layer'],
['<b>OpenTelemetry GenAI semantic conventions</b>','Standard span/metric names for model calls, agents, tools (gen_ai.provider.name, gen_ai.usage.input_tokens, gen_ai.server.time_to_first_token…)','Vendor-neutral; any backend','ALL GenAI conventions are "Development" status; moved to open-telemetry/semantic-conventions-genai; gen_ai.system deprecated; token-usage metric renamed',EMER,'Instrument once, export anywhere; teach both old and new names'],
['<b>Langfuse</b>','Tracing, prompt management, datasets, evaluations; OTLP endpoint /api/public/otel','MIT core, self-hostable (Docker/Helm); strong prompt management','Acquired by ClickHouse (Jan 2026); EE features need a key; OTLP over HTTP only (no gRPC)','Server v4.59.0. '+MAT,'Self-hosted LLM tracing with prompt versioning (data residency)'],
['<b>Arize Phoenix</b>','Tracing + evals built on OpenTelemetry/OpenInference','Free to self-host, no feature limits; good RAG views','Elastic License 2.0 (not OSI open source)','20.21.3. '+MAT,'Self-hosted debugging and eval of RAG/agents'],
['<b>LangSmith</b>','Tracing, evaluation, prompt engineering, deployment','Deep LangChain/LangGraph integration; OTel ingest','SaaS-first; self-hosting is an Enterprise add-on on Kubernetes',MAT,'LangGraph-heavy teams able to use SaaS'],
['<b>MLflow Tracing</b>','@mlflow.trace, autolog for OpenAI/LangChain…','Unified with registry and evals','UI less specialised than dedicated tools','3.17.x. '+MAT,'MLflow-centric platforms']
]}),

T({id:'t-agents',title:'Agent frameworks',lesson:'v2-agents',
intro:'Versions are PyPI releases fetched 2026-10-14. Framework churn is high; durable skills are the patterns (tool loops, state, checkpoints, approvals, evals), not the API names.',
rows:[
['<b>LangGraph</b>','Stateful graph orchestration; checkpointers; interrupt() for human approval','Explicit state machine; durable resume (needs checkpointer + thread_id)','Code before interrupt() re-runs on resume (keep side effects idempotent)','1.2.15, Production/Stable. '+MAT,'Controllable, auditable agent workflows'],
['<b>Microsoft Agent Framework</b>','.NET + Python (+ Go) agents and workflows; official successor to Semantic Kernel AND AutoGen','Enterprise support; multi-language','Migration from SK/AutoGen required','1.21.0 (1.0 GA Apr 2026). '+MAT,'Microsoft/.NET estates'],
['<b>AutoGen</b>','Multi-agent conversations','Historic influence','Maintenance mode, community managed; new users → MAF','0.7.5 (2025-09). '+LEG,'Do not start new projects'],
['<b>Semantic Kernel</b>','SDK for AI orchestration','Existing .NET adopters','README: "Semantic Kernel is now Microsoft Agent Framework"','1.45.0. '+LEG,'Maintain existing apps; plan migration'],
['<b>OpenAI Agents SDK</b>','Agents, handoffs, guardrails, tracing','Small API surface','Still 0.x; OpenAI-centric defaults','0.23.1. '+GROW,'Lightweight agents on OpenAI models'],
['<b>Google ADK</b>','Agent Development Kit','Gemini/Vertex integration; A2A support','Fast major-version churn (2.x)','2.12.0. '+GROW,'Google Cloud agent platforms'],
['<b>Claude Agent SDK</b>','Claude Code’s agent loop/tools as a library (Python, TS)','Proven coding/ops agent harness; MCP-native','Alpha classifier; Claude-centric','0.2.166. '+EMER,'Agents that operate on files, shells and MCP tools'],
['<b>PydanticAI</b>','Type-safe agents with Pydantic validation','Structured outputs and DI done well','Smaller multi-agent tooling','2.56.0, Production/Stable. '+MAT,'Python teams valuing types and validation'],
['<b>CrewAI</b>','Role-based multi-agent crews','Quick multi-agent prototypes','Less control over state/flows','1.15.28. '+GROW,'Prototyping role-play multi-agent ideas'],
['<b>LlamaIndex</b>','Data/RAG framework with agents','Rich connectors and indexes','Still 0.x','0.14.25. '+GROW,'Retrieval-heavy agents'],
['<b>Strands Agents</b>','AWS open-source model-driven agents','Minimal code; Bedrock integration','AWS-leaning','1.60.0. '+MAT,'AWS shops; pairs with AgentCore'],
['<b>Temporal</b> (durable execution)','Workflows that survive crashes; activities = LLM/tool calls','Retries, long-running state, exactly-resumed execution','Deterministic workflow code discipline; a cluster to run',MAT,'Long-running, must-not-lose-state agent processes'],
['<b>Amazon Bedrock AgentCore</b>','Managed runtime, memory, gateway, identity, policy, observability, evaluations','Managed security/identity primitives for any framework','AWS lock-in','SDK 1.24.1. '+GROW,'Run any framework with managed ops on AWS']
]}),

T({id:'t-guardrails',title:'Guardrails and red-teaming',lesson:'v2-ai-threat-model',
intro:'Guardrails filter at runtime; red-team tools attack before release. Neither makes prompt injection impossible; architecture (least privilege, approvals, CaMeL-style data/control separation) does the heavy lifting.',
rows:[
['<b>NeMo Guardrails</b>','Programmable rails (Colang) for input/output/dialog/tool flows','Flexible; open source','Adds latency; rails need testing like code','0.24.1. '+GROW,'Conversational apps needing topical and safety rails'],
['<b>Llama Guard 4</b> (12B)','Safety classifier for prompts and responses, 14 MLCommons hazard categories, text + image','Self-hostable; policy categories','A 12B model to serve (GPU cost); gated licence',GROW,'Self-hosted content-safety classification'],
['<b>Prompt Guard 2</b> (86M / 22M)','Prompt-injection / jailbreak classifier','Tiny, cheap, CPU-friendly','512-token context; classifiers are bypassable',GROW,'Cheap first-pass injection screening'],
['<b>garak</b>','LLM vulnerability scanner (NVIDIA)','Broad probe library','Findings need triage','0.17.0. '+GROW,'Pre-release scans of a model endpoint'],
['<b>PyRIT</b>','Risk-identification framework for red-team automation (Microsoft; repo now microsoft/PyRIT)','Multi-turn attack orchestration','Framework, not a turnkey scanner','1.1.0. '+GROW,'Structured red-team programmes'],
['<b>promptfoo red team</b>','Red-team plugins in the eval CLI','CI integration','Now part of OpenAI (OSS continues)','0.124.1. '+GROW,'Red-team regression in CI']
]}),

T({id:'t-gpu-k8s',title:'GPU scheduling and sharing on Kubernetes',lesson:'v1-k8s-gpu-stack',
intro:'How a pod gets a GPU (or a slice of one) and how a queue decides who runs. Kubernetes is v1.37 as of Oct 2026.',
rows:[
['<b>Device plugin</b> (nvidia.com/gpu)','Advertises whole GPUs as an extended resource','Simple, universal','Integer GPUs only; request = limit; no attributes for selection',MAT,'Default for whole-GPU inference/training pods'],
['<b>DRA</b> (resource.k8s.io/v1)','DeviceClass, ResourceClaim(Template), ResourceSlice: attribute-based device requests','GA in 1.34 (gate locked from 1.35); expressive selection, sharing, partitionable devices (beta)','NVIDIA DRA driver v0.5.1: GPU allocation not yet officially supported (ComputeDomains are)','Core '+MAT+', NVIDIA GPU driver '+EMER,'Multi-node NVLink (ComputeDomains) now; GPU allocation once the driver is supported'],
['<b>MIG</b>','Hardware partitions of A100/H100/H200/B200 (up to 7 instances, e.g. H100 1g.10gb ×7)','Memory and fault isolation; guaranteed QoS','Fixed profiles; reconfiguration drains the GPU; not on L4/L40S',MAT,'Many small models or tenants needing isolation'],
['<b>Time-slicing</b>','Oversubscribe one GPU to several pods by time-sharing','Works on any GPU; cheap for dev','NO memory or fault isolation; one OOM affects all',MAT,'Dev/test, notebooks, low-traffic models'],
['<b>MPS</b>','CUDA Multi-Process Service: concurrent kernels from several processes','Better utilisation than time-slicing for small kernels','Limited fault isolation; GPU Operator support details '+B('x','unverified here'),GROW,'Many small inference processes on one GPU'],
['<b>NVIDIA GPU Operator</b>','Driver, container toolkit, device plugin, GFD, DCGM exporter, MIG manager, validator','One install for the whole GPU stack','Upgrades touch drivers on live nodes','26.7.x. '+MAT,'Self-managed GPU nodes (EKS Auto Mode bundles drivers itself)'],
['<b>Kueue</b>','Job queueing and quota: ClusterQueue, LocalQueue, ResourceFlavor, Cohorts, Topology Aware Scheduling','Fair sharing and borrowing of scarce GPUs; integrates with Kubeflow Trainer, JobSet, DWS','Still 0.x (v1beta2 API)','v0.20.1. '+GROW,'Shared training/batch GPU clusters across teams'],
['<b>Volcano</b>','Batch scheduler (gang scheduling, queues)','Long history for HPC/AI batch','Replaces/extends the default scheduler; overlap with Kueue',GROW+' '+B('x','version unverified'),'Gang-scheduled jobs where Volcano is already in use'],
['<b>Karpenter / KEDA</b>','Node provisioning (NodePool, EC2NodeClass) / event-driven pod autoscaling (Prometheus scaler)','Right-size GPU nodes; scale on queue depth or KV usage','GPU capacity may not exist on demand; model load time slows scale-up','Karpenter v1.15.0, KEDA v2.21.0. '+MAT,'Elastic GPU inference pools']
]}),

T({id:'t-mcp',title:'MCP SDKs, clients and tooling',lesson:'v2-mcp-protocol',
intro:'Two spec eras coexist: 2026-07-28 (current, stateless: no initialize handshake, no Mcp-Session-Id) and 2025-11-25 (handshake + sessions, what most clients and tutorials use). Always state the era.',
rows:[
['<b>Python SDK</b> mcp','Official server/client; MCPServer (FastMCP renamed), decorators @mcp.tool/@mcp.resource/@mcp.prompt; stdio and Streamable HTTP; auth helpers','Serves 2025 and 2026 revisions from one app; Client mode="auto"','v2 removed old import paths (from mcp.server.fastmcp)','2.3.0 (2026-10-02). '+MAT,'Python MCP servers (labs/08-mcp-python)'],
['<b>fastmcp</b> (jlowin/Prefect)','Separate higher-level framework','Extra features (composition, proxies)','Not the official SDK; easy to confuse with the old FastMCP class','4.1.0. '+GROW,'When its extra features are needed'],
['<b>TypeScript SDK v2</b>','@modelcontextprotocol/server, /client, /node, /express…; registerTool with zod v4; createMcpHandler for 2026-07-28','Implements 2026-07-28; runs on Node, Bun, Deno','Breaking changes from v1 (variadic .tool() removed)','2.3.1. '+GROW,'New TS servers (labs/09-mcp-typescript)'],
['<b>TypeScript SDK v1</b>','@modelcontextprotocol/sdk','Most examples online','Implements 2025-11-25 only; 2026-07-28 not planned','1.32.1. '+LEG,'Existing servers; fixes for ≥ 6 months after v2'],
['<b>MCP Inspector</b>','Test UI/CLI/TUI for servers','Essential debugging tool','v1 &lt; 0.14.1 had RCE (CVE-2025-49596); bind to localhost','2.11.0. '+MAT,'Every server developer'],
['<b>Clients</b>: Claude Desktop, Claude Code, claude.ai connectors, VS Code, Cursor','Hosts that connect to servers (stdio config files; remote HTTP with OAuth)','Broad adoption','Config formats differ (mcpServers vs servers); remote OAuth support varies',MAT,'Choose by where users work'],
['<b>API-side MCP</b>: OpenAI Responses mcp tool; Anthropic MCP connector (beta)','Model provider calls your remote MCP server','No client code','Remote HTTPS only; Anthropic connector supports tool calls only; beta headers change',GROW,'Server-side agents calling public MCP servers'],
['<b>MCP Registry</b>','Official metadata registry (server.json, mcp-publisher)','Discovery standard','Still preview; breaking changes possible',EMER,'Publish public servers; mirror into a private catalogue']
]}),

T({id:'t-cloud-gpu',title:'Cloud GPU capacity options',lesson:'v2-finops-optimization',
intro:'Prices are AWS us-east-1 on-demand Linux from the pricing feed dated 2026-10-12 and Lambda list prices seen 2026-10-14. Prices move; re-check before quoting.',
head:['Option','What you get','Strengths','Limitations','Price / status (as of Oct 2026)','When to choose'],
rows:[
['<b>AWS p5.48xlarge</b>','8 × H100 80 GB, 3,200 Gbps EFA, NVSwitch','Standard training/inference node','Scarce on demand','$55.04/h (≈ $6.88/GPU-h)','Training, 70B-class serving'],
['<b>AWS p5en.48xlarge</b>','8 × H200 141 GB','More HBM per GPU → fewer GPUs per replica','Price premium','$63.296/h','Long-context or large-model serving'],
['<b>AWS p6-b200.48xlarge</b>','8 × B200 (≈ 179 GiB usable each)','FP4/FP8 throughput, HBM3e','Highest hourly cost; software must support Blackwell','$113.9328/h','Highest throughput per replica'],
['<b>AWS g6e / g6</b>','L40S 48 GB (44 GiB usable) / L4 24 GB (22 GiB usable)','Cheap per GPU; good for ≤ 13B models, embeddings','Low bandwidth (864 / 300 GB/s); no MIG','g6e.xlarge $1.861/h; g6.xlarge $0.8048/h','Small models, embeddings, rerankers, dev'],
['<b>EC2 Capacity Blocks</b>','Reserved future GPU capacity, 1–14 days or multiples of 7 up to 182','Guaranteed capacity for a window','No cancellation; instances terminate 30 min before the end','Market-set price at booking','Planned training runs, launch events'],
['<b>GKE DWS flex-start</b>','Queued provisioning of GPU nodes (max 7 days)','Get scarce GPUs without long reservations; Kueue integration','Wait time not guaranteed','Status VERIFIED 2026-10-09','Batch/training jobs that can wait'],
['<b>Lambda (GPU cloud)</b>','On-demand H100/B200','Simple pricing','Fewer managed services; region choice','H100 SXM $3.99–4.29/GPU-h; B200 $6.69–6.99/GPU-h','Cost-sensitive training/experiments'],
['<b>Managed APIs</b> (Anthropic, OpenAI, Gemini, Bedrock)','Per-token pricing, no GPUs','No capacity planning; frontier models','Data residency, per-token cost at scale','e.g. Claude Sonnet 5.5 $2/$10 per M in/out','Low/medium volume, frontier quality, fast start']
],
after:callout('warn','Saudi data residency','As of 2026-10-14: Google Cloud Dammam (me-central2) is live; Microsoft announced Azure "Saudi Arabia East" for November 2026; AWS has announced but not opened Saudi regions. Check the current status before designing a KSA-resident deployment.')}),

T({id:'t-aiops-finops',title:'AIOps and AI FinOps tools',lesson:'v2-aiops',
intro:'Tools that help operate and pay for the platform. Treat every LLM-driven remediation as read-only until proven safe.',
rows:[
['<b>K8sGPT</b>','Scans clusters and explains issues with an LLM','Quick triage summaries','Explanations can be wrong; keep it read-only','v0.4.40, CNCF Sandbox. '+GROW,'Assist on-call triage'],
['<b>HolmesGPT</b>','SRE agent investigating alerts with tools','Tool-using investigations','Agent permissions must be scoped','0.44.0, CNCF Sandbox. '+EMER,'Alert investigation with read-only tools'],
['<b>Keep</b>','Alert aggregation, dedupe, correlation, workflows','Open source AIOps platform','Acquired by Elastic','v0.54.3. '+GROW,'Alert noise reduction'],
['<b>OpenCost</b>','Kubernetes cost allocation incl. GPU (node_gpu_hourly_cost, container_gpu_allocation); ships an MCP server','CNCF, open; chargeback by namespace/label','Allocation ≠ utilization; GPU utilization-based cost UNVERIFIED','v1.121.3. '+MAT,'Per-team GPU chargeback'],
['<b>FOCUS spec</b>','Normalised billing data schema across cloud, SaaS, AI','Join provider bills with token costs','Spec, not a tool','v1.4 (2026-06). '+GROW,'FinOps data model for AI spend']
]})
]);
})();
