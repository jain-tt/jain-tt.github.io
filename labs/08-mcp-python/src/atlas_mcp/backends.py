"""Data sources behind the MCP tools.

The MCP server never talks to Kubernetes, Prometheus or the cost API directly.
It talks to a `Backend`. That gives us two implementations with the same shape:

* `SampleBackend`  - deterministic local data, for learning and tests.
* `LiveBackend`    - real read-only HTTP calls to the Kubernetes API,
                     Prometheus (or Mimir) and OpenCost.

Swapping one for the other is how the lab "progressively replaces sample data
with real integrations" without changing a single tool definition.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

import httpx


class BackendError(Exception):
    """A dependency failed. The message is safe to show to the model."""


@dataclass(frozen=True)
class Pod:
    name: str
    namespace: str
    phase: str
    restarts: int
    node: str
    cpu_request_m: int
    memory_request_mi: int


@dataclass(frozen=True)
class PodUsage:
    pod: str
    cpu_m: float
    memory_mi: float


class Backend(Protocol):
    async def health(self) -> dict[str, str]: ...
    async def list_pods(self, namespace: str) -> list[Pod]: ...
    async def pod_usage(self, namespace: str, pod: str) -> PodUsage: ...
    async def cost_summary(self, namespace: str, window: str) -> dict[str, float]: ...


# [START sample]
class SampleBackend:
    """Fixed data so every learner sees the same answers."""

    _pods = {
        "payments": [
            Pod("payments-api-7c9f-abcde", "payments", "Running", 0, "ip-10-0-1-12", 500, 512),
            Pod("payments-api-7c9f-fghij", "payments", "Running", 4, "ip-10-0-1-13", 500, 512),
            Pod("payments-worker-5d8b-klmno", "payments", "CrashLoopBackOff", 17, "ip-10-0-2-21", 250, 256),
        ],
        "search": [
            Pod("search-vllm-0", "search", "Running", 0, "gpu-node-a", 8000, 65536),
        ],
    }
    _usage = {
        "payments-api-7c9f-abcde": PodUsage("payments-api-7c9f-abcde", 120.0, 300.0),
        "payments-api-7c9f-fghij": PodUsage("payments-api-7c9f-fghij", 135.0, 310.0),
        "payments-worker-5d8b-klmno": PodUsage("payments-worker-5d8b-klmno", 5.0, 250.0),
        "search-vllm-0": PodUsage("search-vllm-0", 2100.0, 41000.0),
    }

    async def health(self) -> dict[str, str]:
        return {"kubernetes": "ok (sample)", "prometheus": "ok (sample)", "opencost": "ok (sample)"}

    async def list_pods(self, namespace: str) -> list[Pod]:
        if namespace not in self._pods:
            raise BackendError(f"namespace '{namespace}' not found")
        return list(self._pods[namespace])

    async def pod_usage(self, namespace: str, pod: str) -> PodUsage:
        if pod not in self._usage or not pod.startswith(namespace.split("-")[0]):
            raise BackendError(f"no usage data for pod '{pod}' in '{namespace}'")
        return self._usage[pod]

    async def cost_summary(self, namespace: str, window: str) -> dict[str, float]:
        base = {"payments": 412.50, "search": 3890.00}.get(namespace)
        if base is None:
            raise BackendError(f"namespace '{namespace}' not found")
        days = {"1d": 1, "7d": 7, "30d": 30}[window]
        return {"total_usd": round(base * days / 30, 2), "gpu_usd": round(base * days / 30 * (0.85 if namespace == "search" else 0.0), 2)}
# [END sample]


# [START live]
class LiveBackend:
    """Read-only calls to real systems. Credentials come from the environment.

    KUBE_API      e.g. https://kubernetes.default.svc (in-cluster)
    KUBE_TOKEN_FILE  service-account token path (in-cluster default below)
    PROM_URL      Prometheus or Mimir query base, e.g. http://mimir/prometheus
    PROM_TENANT   optional Mimir tenant (sent as X-Scope-OrgID)
    OPENCOST_URL  e.g. http://opencost.opencost:9003
    """

    def __init__(self, timeout_s: float = 5.0) -> None:
        self.kube = os.environ.get("KUBE_API", "https://kubernetes.default.svc")
        token_file = os.environ.get("KUBE_TOKEN_FILE", "/var/run/secrets/kubernetes.io/serviceaccount/token")
        ca = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
        self._kube_headers = {}
        if os.path.exists(token_file):
            with open(token_file) as f:
                self._kube_headers["Authorization"] = f"Bearer {f.read().strip()}"
        self._kube = httpx.AsyncClient(base_url=self.kube, headers=self._kube_headers,
                                       verify=ca if os.path.exists(ca) else True, timeout=timeout_s)
        prom_headers = {"X-Scope-OrgID": os.environ["PROM_TENANT"]} if os.environ.get("PROM_TENANT") else {}
        self._prom = httpx.AsyncClient(base_url=os.environ.get("PROM_URL", "http://prometheus:9090"),
                                       headers=prom_headers, timeout=timeout_s)
        self._cost = httpx.AsyncClient(base_url=os.environ.get("OPENCOST_URL", "http://opencost.opencost:9003"),
                                       timeout=timeout_s)

    async def _get(self, client: httpx.AsyncClient, path: str, **params) -> dict:
        try:
            r = await client.get(path, params=params or None)
        except httpx.TimeoutException as e:
            raise BackendError(f"timeout calling {client.base_url}{path}") from e
        except httpx.HTTPError as e:
            raise BackendError(f"cannot reach {client.base_url}: {type(e).__name__}") from e
        if r.status_code in (401, 403):
            raise BackendError(f"{client.base_url} refused the server's credentials ({r.status_code})")
        if r.status_code == 404:
            raise BackendError(f"not found: {path}")
        if r.status_code >= 400:
            raise BackendError(f"{client.base_url}{path} returned {r.status_code}")
        return r.json()

    async def health(self) -> dict[str, str]:
        out = {}
        for name, client, path in (("kubernetes", self._kube, "/readyz"), ("prometheus", self._prom, "/-/ready"),
                                   ("opencost", self._cost, "/healthz")):
            try:
                r = await client.get(path)
                out[name] = "ok" if r.status_code < 400 else f"http {r.status_code}"
            except httpx.HTTPError as e:
                out[name] = f"unreachable ({type(e).__name__})"
        return out

    async def list_pods(self, namespace: str) -> list[Pod]:
        data = await self._get(self._kube, f"/api/v1/namespaces/{namespace}/pods")
        pods = []
        for item in data.get("items", []):
            spec, status = item["spec"], item.get("status", {})
            req = (spec["containers"][0].get("resources", {}).get("requests", {}))
            waiting = [c.get("state", {}).get("waiting", {}).get("reason") for c in status.get("containerStatuses", [])]
            phase = next((w for w in waiting if w), status.get("phase", "Unknown"))
            pods.append(Pod(item["metadata"]["name"], namespace, phase,
                            sum(c.get("restartCount", 0) for c in status.get("containerStatuses", [])),
                            spec.get("nodeName", ""), _cpu_m(req.get("cpu", "0")), _mem_mi(req.get("memory", "0"))))
        return pods

    async def pod_usage(self, namespace: str, pod: str) -> PodUsage:
        sel = f'namespace="{namespace}",pod="{pod}",container!=""'
        cpu = await self._get(self._prom, "/api/v1/query", query=f"sum(rate(container_cpu_usage_seconds_total{{{sel}}}[5m]))")
        mem = await self._get(self._prom, "/api/v1/query", query=f"sum(container_memory_working_set_bytes{{{sel}}})")
        try:
            cpu_cores = float(cpu["data"]["result"][0]["value"][1])
            mem_bytes = float(mem["data"]["result"][0]["value"][1])
        except (KeyError, IndexError) as e:
            raise BackendError(f"no metrics for pod '{pod}' (is it running and scraped?)") from e
        return PodUsage(pod, cpu_cores * 1000, mem_bytes / 2**20)

    async def cost_summary(self, namespace: str, window: str) -> dict[str, float]:
        data = await self._get(self._cost, "/allocation/compute", window=window, aggregate="namespace", accumulate="true")
        try:
            alloc = data["data"][0][namespace]
        except (KeyError, IndexError) as e:
            raise BackendError(f"no cost allocation for namespace '{namespace}'") from e
        return {"total_usd": round(alloc.get("totalCost", 0.0), 2), "gpu_usd": round(alloc.get("gpuCost", 0.0), 2)}
# [END live]


def _cpu_m(v: str) -> int:
    return int(v[:-1]) if v.endswith("m") else int(float(v) * 1000)


def _mem_mi(v: str) -> int:
    units = {"Ki": 1 / 1024, "Mi": 1, "Gi": 1024, "Ti": 1024 * 1024}
    for u, f in units.items():
        if v.endswith(u):
            return int(float(v[:-2]) * f)
    return int(float(v) / 2**20) if v else 0


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
