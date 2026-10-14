"""Atlas infrastructure-optimisation MCP server (course capstone lab).

Division of labour (the core architectural idea):
  * this SERVER gathers trusted data and computes evidence deterministically;
  * the AGENT (model in the host) interprets the evidence and explains it;
  * a HUMAN approves through a separate channel; a GitOps PIPELINE applies.
No tool here can change the cluster.
"""
from __future__ import annotations

import logging
import os
from typing import Annotated, Any

from pydantic import BaseModel, Field

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .analysis import Policy, Recommendation, recommend
from .governance import AuditLog, ChangeStore, make_patch
from .sources import FixtureSource, LiveSource, Source

log = logging.getLogger("optimizer_mcp")

# [START setup]
mcp = MCPServer(
    name="atlas-optimizer",
    title="Atlas resource optimiser (read-only + proposals)",
    version="0.1.0",
    instructions=("Analyse Kubernetes requests/limits against 30 days of usage. Tools never modify the cluster. "
                  "propose_change only records a proposal that a different human must approve outside this server. "
                  "Always report the evidence (p95, max, spikes, HPA, OOM) behind any recommendation."),
)
SOURCE: Source = LiveSource() if os.environ.get("OPTIMIZER_SOURCE") == "live" else FixtureSource()
POLICY = Policy()
STORE = ChangeStore()
AUDIT = AuditLog()
RO = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
PROPOSE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False)
NS = Annotated[str, Field(pattern=r"^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$")]
NAME = Annotated[str, Field(pattern=r"^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$")]


def _actor() -> str:
    """Who is calling: the token subject on HTTP, the OS user on stdio."""
    try:
        from mcp.server.auth.middleware.auth_context import get_access_token
        tok = get_access_token()
        if tok:
            return f"user:{tok.subject}"
    except Exception:
        pass
    return f"local:{os.environ.get('USER', 'unknown')}"
# [END setup]


class ContainerEvidence(BaseModel):
    container: str
    current: dict
    cpu_millicores: dict = Field(description="avg, p50, p95, p99, max, coverage, spike_days over 30 days")
    memory_mib: dict
    recommendation: dict


class WorkloadAnalysis(BaseModel):
    namespace: str
    workload: str
    replicas: int
    criticality: str
    hpa: dict | None
    oom_kills_30d: int
    containers: list[ContainerEvidence]
    monthly_saving_usd: float


async def _find(namespace: str, workload: str):
    try:
        ws = await SOURCE.workloads(namespace)
    except KeyError:
        raise ToolError(f"namespace '{namespace}' not found")
    w = next((x for x in ws if x.name == workload), None)
    if not w:
        raise ToolError(f"workload '{workload}' not found in '{namespace}'")
    return w


# [START tools_read]
@mcp.tool(annotations=RO)
async def list_namespaces() -> list[str]:
    """List namespaces that can be analysed."""
    return await SOURCE.namespaces()


@mcp.tool(annotations=RO)
async def list_workloads(namespace: NS) -> list[dict[str, Any]]:
    """Workloads in a namespace with replicas, HPA and per-container requests/limits."""
    try:
        ws = await SOURCE.workloads(namespace)
    except KeyError:
        raise ToolError(f"namespace '{namespace}' not found")
    return [{"name": w.name, "kind": w.kind, "replicas": w.replicas, "criticality": w.criticality, "hpa": w.hpa,
             "containers": [c.__dict__ for c in w.containers]} for w in ws]


@mcp.tool(annotations=RO)
async def analyze_workload(namespace: NS, workload: NAME) -> WorkloadAnalysis:
    """30-day CPU/memory statistics per container (avg, p95, p99, max, spikes, coverage) and a recommendation
    that accounts for peaks, repeated spikes, HPA behaviour, OOM history, criticality and missing data."""
    w = await _find(namespace, workload)
    items, total = [], 0.0
    for c in w.containers:
        cpu = await SOURCE.usage(namespace, workload, c.name, "cpu")
        mem = await SOURCE.usage(namespace, workload, c.name, "memory")
        rec, cs, ms = recommend(w, c, cpu, mem, POLICY)
        total += rec.monthly_saving_usd
        items.append(ContainerEvidence(
            container=c.name, current=c.__dict__,
            cpu_millicores={k: (round(v, 1) if isinstance(v, float) else v) for k, v in cs.__dict__.items()},
            memory_mib={k: (round(v, 1) if isinstance(v, float) else v) for k, v in ms.__dict__.items()},
            recommendation=rec.__dict__))
    return WorkloadAnalysis(namespace=namespace, workload=workload, replicas=w.replicas, criticality=w.criticality,
                            hpa=w.hpa, oom_kills_30d=w.oom_kills_30d, containers=items, monthly_saving_usd=round(total, 2))


@mcp.tool(annotations=RO)
async def recommend_namespace(namespace: NS) -> dict[str, Any]:
    """Analyse every workload in a namespace; return recommendations ranked by monthly saving."""
    try:
        ws = await SOURCE.workloads(namespace)
    except KeyError:
        raise ToolError(f"namespace '{namespace}' not found")
    rows = []
    for w in ws:
        a = await analyze_workload(namespace, w.name)
        for c in a.containers:
            r = c.recommendation
            rows.append({"workload": w.name, "container": c.container, "status": r["status"],
                         "saving_usd_month": r["monthly_saving_usd"], "reasons": r["reasons"], "hpa_note": r["hpa_note"]})
    rows.sort(key=lambda x: -x["saving_usd_month"])
    return {"namespace": namespace, "total_saving_usd_month": round(sum(r["saving_usd_month"] for r in rows), 2),
            "pricing_note": "illustrative unit prices from Policy; replace with your negotiated rates", "items": rows}
# [END tools_read]


# [START tools_propose]
@mcp.tool(annotations=PROPOSE)
async def propose_change(namespace: NS, workload: NAME, container: str, justification: str) -> dict[str, Any]:
    """Record a PROPOSED resource change for human approval. Does not modify anything.
    The patch is computed by the server from the analysis (the model cannot choose the numbers)."""
    a = await analyze_workload(namespace, workload)
    c = next((x for x in a.containers if x.container == container), None)
    if not c:
        raise ToolError(f"container '{container}' not found")
    r = c.recommendation
    if r["status"] != "change":
        raise ToolError(f"no change proposed: status is '{r['status']}' ({'; '.join(r['reasons'])})")
    patch = make_patch(namespace, workload, container, r["cpu_request_m"], r["mem_request_mi"], r["mem_limit_mi"])
    actor = _actor()
    res = STORE.propose(patch, {"analysis": c.model_dump(), "justification": justification[:500]}, actor)
    AUDIT.append(actor, "propose-duplicate" if res["duplicate"] else "propose", change_id=res["id"],
                 plan_hash=res["hash"], workload=f"{namespace}/{workload}")
    return {**res, "patch": patch, "next_step": f"A different person approves with: python -m optimizer_mcp.approve_cli {res['id']} {res['hash']}"}


@mcp.tool(annotations=RO)
async def get_change_status(change_id: int) -> dict[str, Any]:
    """Status of a proposal: pending, approved, rejected or applied."""
    c = STORE.get(change_id)
    if not c:
        raise ToolError(f"change {change_id} not found")
    return {k: c[k] for k in ("id", "hash", "status", "requester", "approver", "applied")}


@mcp.tool(annotations=RO)
async def validate_change(change_id: int) -> dict[str, Any]:
    """After an applied change has run for a while: compare recent usage with the new requests,
    and report OOMKills or HPA saturation that indicate the change should be rolled back."""
    c = STORE.get(change_id)
    if not c or c["status"] != "applied":
        raise ToolError("change not found or not applied yet")
    meta = c["patch"]["metadata"]
    cont = c["patch"]["spec"]["template"]["spec"]["containers"][0]
    w = await _find(meta["namespace"], meta["name"])
    cpu = await SOURCE.usage(meta["namespace"], meta["name"], cont["name"], "cpu")
    mem = await SOURCE.usage(meta["namespace"], meta["name"], cont["name"], "memory")
    recent_cpu = [v for v in cpu.values[-72:] if v is not None]            # last 3 days
    recent_mem = [v for v in mem.values[-72:] if v is not None]
    new_cpu = int(cont["resources"]["requests"]["cpu"].rstrip("m"))
    new_mem = int(cont["resources"]["requests"]["memory"].rstrip("Mi"))
    issues = []
    if w.oom_kills_30d:
        issues.append(f"{w.oom_kills_30d} OOMKill(s) recorded")
    if recent_mem and max(recent_mem) > 0.95 * new_mem:
        issues.append("memory peak above 95 % of the new request")
    if w.hpa and w.hpa.get("max") and w.replicas >= w.hpa["max"]:
        issues.append("HPA at max replicas")
    verdict = "healthy" if not issues else "rollback-recommended"
    AUDIT.append(_actor(), "validate", change_id=change_id, verdict=verdict, issues=issues)
    return {"change_id": change_id, "verdict": verdict, "issues": issues,
            "recent_cpu_p_max_m": max(recent_cpu) if recent_cpu else None, "new_cpu_request_m": new_cpu,
            "recent_mem_max_mi": max(recent_mem) if recent_mem else None, "new_mem_request_mi": new_mem}
# [END tools_propose]


def main() -> None:
    import sys
    mcp.run("streamable-http" if "--http" in sys.argv else "stdio")


if __name__ == "__main__":
    main()
