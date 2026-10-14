"""Capstone tests: analysis rules, MCP tools end to end, approval workflow and audit chain."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True, scope="session")
def _env(tmp_path_factory):
    os.environ["OPTIMIZER_STATE_DIR"] = str(tmp_path_factory.mktemp("state"))
    subprocess.run([sys.executable, str(ROOT / "fixtures/generate.py")], check=True, capture_output=True)


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _client():
    from mcp import Client
    from optimizer_mcp.server import mcp
    return Client(mcp)


# [START test_rules]
@pytest.mark.anyio
async def test_scenarios_follow_the_rules():
    async with _client() as c:
        r = (await c.call_tool("recommend_namespace", {"namespace": "payments"})).structured_content
        by = {i["workload"]: i for i in r["items"]}
        assert by["api"]["status"] == "change" and by["api"]["saving_usd_month"] > 0           # steady over-provisioning
        assert any("p99" in s for s in by["batch"]["reasons"])                                    # spikes -> sized from p99
        assert any("OOMKill" in s for s in by["worker"]["reasons"])                               # memory not reduced

        s = (await c.call_tool("recommend_namespace", {"namespace": "search"})).structured_content
        sb = {i["workload"]: i for i in s["items"]}
        assert sb["indexer"]["status"] == "insufficient-data"                                     # missing metrics
        assert sb["frontend"]["hpa_note"]                                                         # HPA interaction explained

        g = (await c.call_tool("analyze_workload", {"namespace": "checkout", "workload": "gateway"})).structured_content
        rec = g["containers"][0]["recommendation"]
        assert rec["cpu_request_m"] >= 1000                                                       # 50 % step cap
        assert any("capped" in s for s in rec["reasons"])
# [END test_rules]


@pytest.mark.anyio
async def test_batch_is_not_sized_from_average():
    async with _client() as c:
        a = (await c.call_tool("analyze_workload", {"namespace": "payments", "workload": "batch"})).structured_content
        cont = a["containers"][0]
        assert cont["cpu_millicores"]["spike_days"] >= 7
        assert cont["recommendation"]["cpu_request_m"] >= cont["cpu_millicores"]["p99"]          # not avg (~180m)


# [START test_workflow]
@pytest.mark.anyio
async def test_propose_approve_apply_validate(tmp_path, monkeypatch):
    from optimizer_mcp import governance
    async with _client() as c:
        p = (await c.call_tool("propose_change", {"namespace": "payments", "workload": "api", "container": "app",
                                                  "justification": "p95 well below request for 30 days"})).structured_content
        assert p["status"] == "pending" and not p["duplicate"]
        again = (await c.call_tool("propose_change", {"namespace": "payments", "workload": "api", "container": "app",
                                                      "justification": "retry"})).structured_content
        assert again["duplicate"] and again["id"] == p["id"]                                     # idempotent proposals

        blocked = await c.call_tool("propose_change", {"namespace": "search", "workload": "indexer", "container": "app",
                                                        "justification": "x"})
        assert blocked.is_error                                                                  # insufficient data -> no proposal

        store = governance.ChangeStore()
        with pytest.raises(ValueError, match="separation of duties"):
            store.decide(p["id"], f"local:{os.environ.get('USER', 'unknown')}", True, p["hash"])
        with pytest.raises(ValueError, match="hash mismatch"):
            store.decide(p["id"], "local:alice", True, "0" * 64)
        store.decide(p["id"], "local:alice", True, p["hash"])
        governance.AuditLog().append("local:alice", "approved", change_id=p["id"], plan_hash=p["hash"])  # as approve_cli does

        env = {**os.environ, "PYTHONPATH": str(ROOT / "src")}
        out = subprocess.run([sys.executable, "-m", "optimizer_mcp.apply_cli", str(p["id"]), str(tmp_path)],
                             env=env, capture_output=True, text=True)
        assert out.returncode == 0, out.stderr
        written = json.loads((tmp_path / "overlays/payments/api-resources.patch.json").read_text())
        assert written["spec"]["template"]["spec"]["containers"][0]["resources"]["requests"]["cpu"].endswith("m")

        v = (await c.call_tool("validate_change", {"change_id": p["id"]})).structured_content
        assert v["verdict"] in {"healthy", "rollback-recommended"}
        assert governance.AuditLog().verify()                                                    # hash chain intact
        log = governance.AuditLog().path.read_text().splitlines()
        assert [json.loads(l)["action"] for l in log] == ["propose", "propose-duplicate", "approved", "applied", "validate"]
# [END test_workflow]


@pytest.mark.anyio
async def test_no_tool_can_approve_or_apply():
    async with _client() as c:
        names = {t.name for t in (await c.list_tools()).tools}
        assert not any(n.startswith(("approve", "apply", "patch", "delete", "scale")) for n in names)
