"""Timing GPU work correctly, and a first torch.profiler trace. Runs on CPU too (then 'cuda' parts are skipped).

python profile_matmul.py
"""
import time

import torch

dev = "cuda" if torch.cuda.is_available() else "cpu"


# [START timing]
def timed(fn, warmup=3, iters=10):
    for _ in range(warmup):            # first calls include allocator, cuBLAS heuristics, JIT
        fn()
    if dev == "cuda":
        torch.cuda.synchronize()       # CUDA launches are async: without this you time the launch, not the work
    t = time.perf_counter()
    for _ in range(iters):
        fn()
    if dev == "cuda":
        torch.cuda.synchronize()
    return (time.perf_counter() - t) / iters


n = 2048
a, b = torch.randn(n, n, device=dev), torch.randn(n, n, device=dev)
s = timed(lambda: a @ b)
flops = 2 * n**3
print(f"{dev}: {n}x{n} matmul {s * 1e3:.2f} ms → {flops / s / 1e12:.2f} TFLOP/s achieved")
# [END timing]

# [START profiler]
from torch.profiler import ProfilerActivity, profile

acts = [ProfilerActivity.CPU] + ([ProfilerActivity.CUDA] if dev == "cuda" else [])
with profile(activities=acts, record_shapes=True) as prof:
    for _ in range(3):
        torch.relu(a @ b).sum()
print(prof.key_averages().table(sort_by="self_cpu_time_total", row_limit=6))
# prof.export_chrome_trace("trace.json")  → open in https://ui.perfetto.dev
# [END profiler]
