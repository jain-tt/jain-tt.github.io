"""Where workload and utilisation data come from.

FixtureSource: deterministic synthetic 30-day data (fixtures/cluster.json) — runs anywhere.
LiveSource:    read-only Kubernetes API + Mimir (Prometheus API) range queries.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Protocol

import httpx

from .analysis import Container, Series, Workload

HOUR = 3600
WINDOW_DAYS = 30


class Source(Protocol):
    async def namespaces(self) -> list[str]: ...
    async def workloads(self, namespace: str) -> list[Workload]: ...
    async def usage(self, namespace: str, workload: str, container: str, resource: str) -> Series: ...


# [START fixture]
class FixtureSource:
    def __init__(self, path: str | None = None) -> None:
        p = Path(path or Path(__file__).resolve().parents[2] / "fixtures" / "cluster.json")
        self.data = json.loads(p.read_text())

    async def namespaces(self) -> list[str]:
        return sorted(self.data["namespaces"])

    async def workloads(self, namespace: str) -> list[Workload]:
        if namespace not in self.data["namespaces"]:
            raise KeyError(namespace)
        out = []
        for w in self.data["namespaces"][namespace]:
            out.append(Workload(namespace=namespace, name=w["name"], kind=w["kind"], replicas=w["replicas"],
                                containers=[Container(**c) for c in w["containers"]], criticality=w.get("criticality", "standard"),
                                hpa=w.get("hpa"), oom_kills_30d=w.get("oom_kills_30d", 0), restarts_30d=w.get("restarts_30d", 0)))
        return out

    async def usage(self, namespace: str, workload: str, container: str, resource: str) -> Series:
        vals = self.data["usage"][f"{namespace}/{workload}/{container}/{resource}"]
        return Series(values=[None if v is None else float(v) for v in vals], expected_samples=WINDOW_DAYS * 24)
# [END fixture]


# [START live]
class LiveSource:
    """Read-only. Needs a ServiceAccount allowed to get/list deployments, statefulsets, hpa, pods, events."""

    def __init__(self) -> None:
        token_file = "/var/run/secrets/kubernetes.io/serviceaccount/token"
        headers = {"Authorization": f"Bearer {Path(token_file).read_text().strip()}"} if os.path.exists(token_file) else {}
        ca = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
        self.k8s = httpx.AsyncClient(base_url=os.environ.get("KUBE_API", "https://kubernetes.default.svc"),
                                     headers=headers, verify=ca if os.path.exists(ca) else True, timeout=10)
        mh = {"X-Scope-OrgID": os.environ["MIMIR_TENANT"]} if os.environ.get("MIMIR_TENANT") else {}
        self.mimir = httpx.AsyncClient(base_url=os.environ.get("MIMIR_URL", "http://mimir-query-frontend:8080/prometheus"),
                                       headers=mh, timeout=30)

    async def namespaces(self) -> list[str]:
        r = await self.k8s.get("/api/v1/namespaces"); r.raise_for_status()
        return sorted(i["metadata"]["name"] for i in r.json()["items"])

    async def workloads(self, namespace: str) -> list[Workload]:
        r = await self.k8s.get(f"/apis/apps/v1/namespaces/{namespace}/deployments"); r.raise_for_status()
        h = await self.k8s.get(f"/apis/autoscaling/v2/namespaces/{namespace}/horizontalpodautoscalers"); h.raise_for_status()
        hpas = {i["spec"]["scaleTargetRef"]["name"]: i for i in h.json()["items"]}
        out = []
        for d in r.json()["items"]:
            name = d["metadata"]["name"]
            cs = []
            for c in d["spec"]["template"]["spec"]["containers"]:
                res = c.get("resources", {})
                cs.append(Container(c["name"], _cpu(res.get("requests", {}).get("cpu")), _mem(res.get("requests", {}).get("memory")),
                                    _cpu(res.get("limits", {}).get("cpu")) or None, _mem(res.get("limits", {}).get("memory")) or None))
            hpa = None
            if name in hpas:
                spec = hpas[name]["spec"]
                cpu_m = next((m for m in spec.get("metrics", []) if m.get("resource", {}).get("name") == "cpu"), None)
                hpa = {"min": spec.get("minReplicas", 1), "max": spec["maxReplicas"],
                       "metric": "cpu" if cpu_m else "other",
                       "target_utilization": cpu_m["resource"]["target"].get("averageUtilization", 0) if cpu_m else None}
            out.append(Workload(namespace, name, "Deployment", d["status"].get("replicas", 0), cs,
                                d["metadata"].get("labels", {}).get("atlas.io/criticality", "standard"), hpa,
                                await self._oomkills(namespace, name)))
        return out

    async def _oomkills(self, namespace: str, workload: str) -> int:
        q = (f'sum(increase(kube_pod_container_status_last_terminated_reason{{namespace="{namespace}",'
             f'pod=~"{workload}-.*",reason="OOMKilled"}}[30d]))')
        r = await self.mimir.get("/api/v1/query", params={"query": q}); r.raise_for_status()
        res = r.json()["data"]["result"]
        return int(float(res[0]["value"][1])) if res else 0

    async def usage(self, namespace: str, workload: str, container: str, resource: str) -> Series:
        """Per-pod average usage, hourly, over 30 days (Mimir range query)."""
        sel = f'namespace="{namespace}",pod=~"{workload}-.*",container="{container}"'
        q = (f"avg(rate(container_cpu_usage_seconds_total{{{sel}}}[5m])) * 1000" if resource == "cpu"
             else f"avg(container_memory_working_set_bytes{{{sel}}}) / 1048576")
        import time
        end = int(time.time()); start = end - WINDOW_DAYS * 86400
        r = await self.mimir.get("/api/v1/query_range", params={"query": q, "start": start, "end": end, "step": HOUR})
        r.raise_for_status()
        res = r.json()["data"]["result"]
        vals = [float(v) for _, v in res[0]["values"]] if res else []
        return Series(values=vals, expected_samples=WINDOW_DAYS * 24)
# [END live]


def _cpu(v: str | None) -> int:
    if not v:
        return 0
    return int(v[:-1]) if v.endswith("m") else int(float(v) * 1000)


def _mem(v: str | None) -> int:
    if not v:
        return 0
    for u, f in {"Ki": 1 / 1024, "Mi": 1, "Gi": 1024}.items():
        if v.endswith(u):
            return int(float(v[:-2]) * f)
    return int(float(v) / 2**20)
