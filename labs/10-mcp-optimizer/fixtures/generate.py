"""Generate deterministic synthetic 30-day hourly usage for the lab (python fixtures/generate.py).

Scenarios (each teaches one rule of the analyzer):
  payments/api        over-provisioned, steady              -> safe CPU + memory reduction
  payments/batch      low average, daily 4× spikes          -> sized from p99, not average
  payments/worker     OOMKilled twice                       -> memory NOT reduced
  search/frontend     HPA on CPU at 70 %                    -> blocked / HPA note
  search/indexer      metrics missing for 8 days            -> insufficient data
  checkout/gateway    critical, over-provisioned            -> extra headroom, capped step
"""
import json
import math
import random
from pathlib import Path

random.seed(42)
H = 30 * 24


def series(base, noise, daily_amp=0.0, spikes=None, missing=None):
    out = []
    for h in range(H):
        v = base * (1 + daily_amp * math.sin(2 * math.pi * (h % 24) / 24)) + random.gauss(0, noise)
        if spikes and h % 24 == spikes[0]:
            v = base * spikes[1]
        if missing and missing[0] <= h < missing[1]:
            out.append(None)
            continue
        out.append(round(max(v, 1), 1))
    return out


ns = {
    "payments": [
        {"name": "api", "kind": "Deployment", "replicas": 4, "criticality": "standard",
         "containers": [{"name": "app", "cpu_request_m": 1000, "mem_request_mi": 2048, "cpu_limit_m": None, "mem_limit_mi": 2048}]},
        {"name": "batch", "kind": "Deployment", "replicas": 2,
         "containers": [{"name": "app", "cpu_request_m": 1500, "mem_request_mi": 1024, "cpu_limit_m": None, "mem_limit_mi": 1024}]},
        {"name": "worker", "kind": "Deployment", "replicas": 3, "oom_kills_30d": 2, "restarts_30d": 5,
         "containers": [{"name": "app", "cpu_request_m": 500, "mem_request_mi": 1024, "cpu_limit_m": None, "mem_limit_mi": 1024}]},
    ],
    "search": [
        {"name": "frontend", "kind": "Deployment", "replicas": 6, "hpa": {"min": 3, "max": 20, "metric": "cpu", "target_utilization": 70},
         "containers": [{"name": "app", "cpu_request_m": 1000, "mem_request_mi": 1024, "cpu_limit_m": None, "mem_limit_mi": 1536}]},
        {"name": "indexer", "kind": "Deployment", "replicas": 2,
         "containers": [{"name": "app", "cpu_request_m": 2000, "mem_request_mi": 4096, "cpu_limit_m": None, "mem_limit_mi": 4096}]},
    ],
    "checkout": [
        {"name": "gateway", "kind": "Deployment", "replicas": 3, "criticality": "critical",
         "containers": [{"name": "app", "cpu_request_m": 2000, "mem_request_mi": 2048, "cpu_limit_m": None, "mem_limit_mi": 2048}]},
    ],
}
usage = {
    "payments/api/app/cpu": series(220, 25, 0.3),
    "payments/api/app/memory": series(700, 20),
    "payments/batch/app/cpu": series(150, 15, 0, spikes=(2, 4.2)),
    "payments/batch/app/memory": series(400, 15),
    "payments/worker/app/cpu": series(120, 10),
    "payments/worker/app/memory": series(600, 60, 0.2),
    "search/frontend/app/cpu": series(560, 60, 0.25),
    "search/frontend/app/memory": series(500, 20),
    "search/indexer/app/cpu": series(400, 40, missing=(100, 292)),
    "search/indexer/app/memory": series(1500, 50, missing=(100, 292)),
    "checkout/gateway/app/cpu": series(300, 30, 0.3),
    "checkout/gateway/app/memory": series(600, 25),
}
Path(__file__).with_name("cluster.json").write_text(json.dumps({"namespaces": ns, "usage": usage}))
print("wrote fixtures/cluster.json")
