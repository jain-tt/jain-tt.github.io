/* Practical lab index: every lab is real code under labs/, with its test status (labs/TEST_RESULTS.md, 2026-10-14). */
(function(){
const ok='<span class="badge" style="background:var(--ok);color:#fff">tested</span>';
const no='<span class="badge" style="background:var(--warn);color:#fff">not run here</span>';
registerLabs([
 {stage:'Volume 1 · Foundations',title:'Lab 01 — Tensors, autograd and a full training loop',env:['local'],minutes:45,lesson:'v1-tensors-pytorch',
  summary:'Shapes, dtypes, devices, one manual gradient step, then a complete train/eval loop with checkpointing. '+ok+' tiny_mlp reaches 0.991 validation accuracy.',
  html:code('bash',`python labs/01-pytorch-basics/tensors_autograd.py
python labs/01-pytorch-basics/tiny_mlp.py`)},
 {stage:'Volume 1 · Foundations',title:'Lab 02 — Capstone stage 1: a tiny GPT from scratch',env:['local'],minutes:90,lesson:'v1-capstone-train',
  summary:'Character-level decoder-only transformer: causal multi-head attention, RMSNorm, residuals, AdamW, a resumable checkpoint, and generation with a real KV cache. '+ok+' the test proves cached decoding equals full recomputation and that the causal mask hides future tokens.',
  html:code('bash',`python labs/02-tiny-transformer/tiny_gpt.py --steps 300
pytest -q labs/02-tiny-transformer/test_tiny_gpt.py`)},
 {stage:'Volume 1 · Training',title:'Lab 03 — Capstone stages 2–3: LoRA / QLoRA fine-tune',env:['gpu','local'],minutes:120,lesson:'v1-finetuning',
  summary:'Synthetic travel-support tickets split by customer, LoRA SFT with completion-only loss, adapter saved as safetensors, optional merge. '+ok+' CPU smoke test with a tiny model and the plain-Transformers path. '+no+' QLoRA (needs CUDA) and TRL SFTTrainer on macOS (needs Triton, i.e. Linux).',
  html:code('bash',`python labs/03-finetune/make_dataset.py --n 600 --out data
python labs/03-finetune/lora_sft.py --model Qwen/Qwen3-1.7B --steps 300 --bf16          # Linux GPU
python labs/03-finetune/lora_sft.py --model hf-internal-testing/tiny-random-LlamaForCausalLM --steps 5 --trainer hf   # any laptop`)},
 {stage:'Volume 1 · GPU',title:'Lab 04 — GPU memory, CUDA kernel, timing and profiling',env:['local','gpu'],minutes:90,lesson:'v1-gpu-memory',
  summary:'Training (ZeRO stages) and inference (weights + KV) memory estimator; first CUDA kernel with bounds check and event timing; correct synchronised timing and a torch.profiler trace. '+ok+' estimator and profiler on CPU. '+no+' vector_add.cu (needs nvcc).',
  html:code('bash',`python labs/04-gpu/gpu_memory.py train --params-b 8 --gpus 8 --zero 3
python labs/04-gpu/gpu_memory.py infer --params-b 70 --layers 80 --context 8192 --seqs 32 --tp 4
nvcc -O2 labs/04-gpu/vector_add.cu -o vector_add && ./vector_add
python labs/04-gpu/profile_matmul.py`)},
 {stage:'Volume 1 · Inference',title:'Lab 05 — Capstone stage 4: serve and benchmark',env:['local','gpu'],minutes:90,lesson:'v1-benchmarking',
  summary:'A stdlib OpenAI-compatible streaming mock server (prefill delay, inter-token delay, limited slots) and an open-loop load generator reporting TTFT/TPOT/E2E percentiles and goodput at an SLO. Point the same client at vLLM on a GPU. '+ok+' mock + client. '+no+' serve_vllm.sh.',
  html:code('bash',`python labs/05-serving/mock_openai_server.py --port 8000 --slots 2 &
python labs/05-serving/bench_client.py --url http://127.0.0.1:8000 --rate 3 --requests 40 --max-tokens 64
MODEL=Qwen/Qwen3-1.7B VLLM_API_KEY=dev labs/05-serving/serve_vllm.sh      # on a GPU box`)},
 {stage:'Volume 1 · Kubernetes',title:'Lab 06 — Capstone stage 5: vLLM on Kubernetes (Helm)',env:['cluster'],minutes:120,lesson:'v1-k8s-production',
  summary:'Deployment on GPU nodes with startup/readiness/liveness probes, preStop drain, /dev/shm, model cache PVC, PDB, NetworkPolicy, ServiceMonitor and a KEDA ScaledObject on vllm:num_requests_waiting. '+ok+' helm lint/template. '+no+' live cluster install.',
  html:code('bash',`helm lint labs/06-k8s/atlas-llm
helm template atlas labs/06-k8s/atlas-llm | less`)},
 {stage:'Volume 2 · RAG',title:'Lab 07 — Capstone stage 6: retrieval with ACLs',env:['local'],minutes:60,lesson:'v2-rag-production',
  summary:'Chunking with overlap, BM25, a toy dense retriever, reciprocal-rank fusion (k=60) and permission filtering BEFORE ranking, with citations. '+ok+' tests prove restricted documents never appear for public users.',
  html:code('bash',`python labs/07-rag/rag_minimal.py "how long do refunds take"
python labs/07-rag/rag_minimal.py "refund jobs fail" --groups staff`)},
 {stage:'Volume 2 · MCP',title:'Lab 08 — MCP server in Python (stdio + Streamable HTTP + OAuth)',env:['local','cluster'],minutes:180,lesson:'v2-mcp-python',
  summary:'Five read-only tools, resources, a prompt, input validation, timeouts, tool errors, Prometheus metrics, JWT verification, per-tool scopes and namespace claims, Dockerfile and Helm chart. '+ok+' 10 tests: in-memory, stdio subprocess, HTTP 401/audience/scope/namespace. '+no+' Docker build, cluster install.',
  html:code('bash',`cd labs/08-mcp-python && pip install -e ".[dev]" && pytest -q
python -m atlas_mcp --transport http
claude mcp add --transport http atlas-ops http://127.0.0.1:8000/mcp`)},
 {stage:'Volume 2 · MCP',title:'Lab 09 — MCP server in TypeScript (SDK v2)',env:['local'],minutes:120,lesson:'v2-mcp-typescript',
  summary:'registerTool with zod/v4 schemas, per-request factory, createMcpHandler on node:http, bearer auth with expected resource. '+ok+' 3 tests including HTTP auth checks.',
  html:code('bash',`cd labs/09-mcp-typescript && npm install && npm test`)},
 {stage:'Volume 2 · MCP',title:'Lab 10 — Capstone stage 7: infrastructure-optimisation MCP server',env:['local','cluster'],minutes:240,lesson:'v2-mcp-capstone',
  summary:'30-day Mimir analysis (p95/p99/max, spike days, coverage), HPA-aware and OOM-aware recommendations, server-computed patches, propose → approve (different human, plan hash) → GitOps apply → validate, hash-chained audit log. '+ok+' 4 tests on deterministic synthetic data. '+no+' live Kubernetes/Mimir.',
  html:code('bash',`cd labs/10-mcp-optimizer && python fixtures/generate.py && pytest -q
python -m optimizer_mcp.server`)},
 {stage:'Volume 2 · Scale & FinOps',title:'Lab 11 — Capacity, KV, cost and queueing calculators',env:['local'],minutes:60,lesson:'v2-capacity-planning',
  summary:'KV bytes from a config.json, users → RPS → tokens → replicas → GPUs with region-loss headroom, cost per million tokens and per successful request, and an M/M/c simulation that matches the Erlang C formula. '+ok+' 5 tests.',
  html:code('bash',`python labs/11-capacity/kv_cache.py --hf-config config.json --context 8192 --gpu-gb 80 --weights-gb 16
python labs/11-capacity/capacity.py --goodput-rps 12.4 --regions 2
python labs/11-capacity/queue_sim.py --servers 8`)},
 {stage:'Volume 2 · AIOps',title:'Lab 12 — Anomaly detection and burn-rate alerting',env:['local'],minutes:45,lesson:'v2-aiops',
  summary:'Rolling robust z-score (MAD), EWMA, and Google SRE Workbook multi-window burn-rate paging rules. '+ok+' 2 tests.',
  html:code('bash',`python labs/12-aiops/anomaly.py`)}
]);
})();
