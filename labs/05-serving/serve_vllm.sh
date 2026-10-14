#!/usr/bin/env bash
# Serve a model with vLLM's OpenAI-compatible server. Requires an NVIDIA GPU and a pinned vLLM version
# (facts below checked against vLLM v0.31 docs, Oct 2026 — re-check `vllm serve --help` for yours).
set -euo pipefail
MODEL="${MODEL:-Qwen/Qwen3-1.7B}"          # any model your engine version supports; pin a revision in production
# [START serve]
vllm serve "$MODEL" \
  --served-model-name atlas-chat \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90 \
  --max-num-seqs 128 \
  --kv-cache-dtype auto \
  --port 8000 \
  --api-key "${VLLM_API_KEY:?set VLLM_API_KEY}"
# Prefix caching and chunked prefill are on by default in recent vLLM (V1 engine).
# Add --enable-lora --lora-modules atlas-support=/models/atlas-lora to serve the capstone adapter.
# Add --tensor-parallel-size 2 when the weights + KV do not fit one GPU.
# [END serve]
