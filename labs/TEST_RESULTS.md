# Lab test results

Generated 2026-10-14T16:11Z on Darwin arm64; Python 3.14.6; node v22.23.1

| Lab | Command | Result |
|---|---|---|
| 01 PyTorch basics | `python tiny_mlp.py` | step 200  train loss 0.0202  val acc 0.991 |
| 02 tiny GPT (KV cache = full recompute) | `python -m pytest -q test_tiny_gpt.py` | 2 passed in 0.58s |
| 03 dataset split by customer | `python make_dataset.py --n 200 --out /tmp/atlas-ft-data` | train 166  val 34  customers in val: 14 |
| 03 LoRA SFT smoke (tiny model, CPU) | `bash -c python lora_sft.py --model hf-internal-testing/tiny-random-LlamaForCausalLM --steps 2 --data /tmp/atlas-ft-data --out /tmp/atlas-ft-out --trainer hf 2>&1 | grep -E '^trainable|^eval:' | tr '\n' ' '` | trainable params: 11,776 \|\| all params: 1,044,048 \|\| trainable%: 1.1279 eval: {'eval_loss': 10.37515640258789, 'eval_runtime': 0.0531, 'eval_samples_per_second': 639.817, 'eval_steps_per_second': 94.091, 'epoch': 0.19047619047619047}  |
| 04 GPU memory estimator | `python gpu_memory.py train --params-b 8 --gpus 8 --zero 3` | 2.00 B/param per GPU → 16.0 GB per GPU before activations |
| 04 timing + profiler (CPU) | `python -c import runpy; runpy.run_path('profile_matmul.py'); print('ok')` | ok |
| 05 mock server + bench client | `python -m pytest -q test_serving.py` | 1 passed in 0.52s |
| 06 Helm chart lint | `helm lint atlas-llm` | 1 chart(s) linted, 0 chart(s) failed |
| 07 RAG: ACL-before-rank, RRF | `python -m pytest -q test_rag.py` | 3 passed in 0.01s |
| 08 MCP server (Python) | `python -m pytest -q` | 10 passed in 1.88s |
| 08 Helm chart lint | `helm lint deploy/helm/atlas-mcp` | 1 chart(s) linted, 0 chart(s) failed |
| 09 MCP server (TypeScript) | `bash -c npm test --silent 2>&1 | grep -E '^# (pass|fail)' | tr '\n' ' '` | # pass 3 # fail 0  |
| 10 optimizer capstone | `python -m pytest -q` | 4 passed in 0.46s |
| 11 capacity / KV / cost / queue | `python -m pytest -q test_capacity.py` | 5 passed in 0.10s |
| 12 AIOps anomaly + burn rate | `python -m pytest -q test_anomaly.py` | 2 passed in 0.00s |

Not executed here (no NVIDIA GPU, CUDA toolkit, Docker daemon or Kubernetes cluster on the authoring machine):
`04-gpu/vector_add.cu`, `05-serving/serve_vllm.sh`, the Docker builds, QLoRA (needs bitsandbytes + CUDA),
the TRL `SFTTrainer` path (`--trainer trl` needs Triton, i.e. Linux), and any live-cluster install of the Helm charts.
