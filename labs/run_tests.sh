#!/usr/bin/env bash
# Runs every lab test that can run on a laptop and writes TEST_RESULTS.md.
# Usage: PY=/path/to/python ./run_tests.sh      (python env with: mcp[cli] pytest anyio httpx pyjwt uvicorn
#        prometheus-client torch transformers peft trl datasets accelerate) and node >= 20 for lab 09.
set -u
PY="${PY:-python3}"
cd "$(dirname "$0")"
out=TEST_RESULTS.md
{
  echo "# Lab test results"
  echo
  echo "Generated $(date -u +%Y-%m-%dT%H:%MZ) on $(uname -s) $(uname -m); $($PY --version 2>&1); node $(node --version 2>/dev/null)"
  echo
  echo "| Lab | Command | Result |"
  echo "|---|---|---|"
} > "$out"
run() {  # name, dir, command...
  local name="$1" dir="$2"; shift 2
  local res; res=$(cd "$dir" && "$@" 2>&1 | tail -1)
  echo "| $name | \`$*\` | ${res//|/\\|} |" >> "$out"
  echo "$name: $res"
}
run "01 PyTorch basics" 01-pytorch-basics $PY tiny_mlp.py
run "02 tiny GPT (KV cache = full recompute)" 02-tiny-transformer $PY -m pytest -q test_tiny_gpt.py
run "03 dataset split by customer" 03-finetune $PY make_dataset.py --n 200 --out /tmp/atlas-ft-data
run "03 LoRA SFT smoke (tiny model, CPU)" 03-finetune bash -c "$PY lora_sft.py --model hf-internal-testing/tiny-random-LlamaForCausalLM --steps 2 --data /tmp/atlas-ft-data --out /tmp/atlas-ft-out --trainer hf 2>&1 | grep -E '^trainable|^eval:' | tr '\\n' ' '"
run "04 GPU memory estimator" 04-gpu $PY gpu_memory.py train --params-b 8 --gpus 8 --zero 3
run "04 timing + profiler (CPU)" 04-gpu $PY -c "import runpy; runpy.run_path('profile_matmul.py'); print('ok')"
run "05 mock server + bench client" 05-serving $PY -m pytest -q test_serving.py
run "06 Helm chart lint" 06-k8s helm lint atlas-llm
run "07 RAG: ACL-before-rank, RRF" 07-rag $PY -m pytest -q test_rag.py
run "08 MCP server (Python)" 08-mcp-python $PY -m pytest -q
run "08 Helm chart lint" 08-mcp-python helm lint deploy/helm/atlas-mcp
run "09 MCP server (TypeScript)" 09-mcp-typescript bash -c "npm test --silent 2>&1 | grep -E '^# (pass|fail)' | tr '\\n' ' '"
run "10 optimizer capstone" 10-mcp-optimizer $PY -m pytest -q
run "11 capacity / KV / cost / queue" 11-capacity $PY -m pytest -q test_capacity.py
run "12 AIOps anomaly + burn rate" 12-aiops $PY -m pytest -q test_anomaly.py
cat >> "$out" <<'NOTE'

Not executed here (no NVIDIA GPU, CUDA toolkit, Docker daemon or Kubernetes cluster on the authoring machine):
`04-gpu/vector_add.cu`, `05-serving/serve_vllm.sh`, the Docker builds, QLoRA (needs bitsandbytes + CUDA),
the TRL `SFTTrainer` path (`--trainer trl` needs Triton, i.e. Linux), and any live-cluster install of the Helm charts.
NOTE
