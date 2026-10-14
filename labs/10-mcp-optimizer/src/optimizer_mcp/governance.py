"""Change proposals, human approval and the audit trail.

The MCP server may only PROPOSE. It cannot approve and cannot apply:
  propose  (MCP tool, any authorised user)      -> status "pending"
  approve  (approve_cli.py, a DIFFERENT human)   -> status "approved"   (never exposed as an MCP tool)
  apply    (apply_cli.py, CI/GitOps identity)    -> writes the patch into the GitOps repo; Argo CD syncs it
  validate (MCP tool, read-only)                -> compares post-change usage with the new requests

Every step appends to a hash-chained JSONL audit log, so tampering with history is detectable.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path

STATE_DIR = Path(os.environ.get("OPTIMIZER_STATE_DIR", Path.home() / ".atlas-optimizer"))


# [START audit]
class AuditLog:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or STATE_DIR / "audit.jsonl"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _last_hash(self) -> str:
        if not self.path.exists() or self.path.stat().st_size == 0:
            return "0" * 64
        *_, last = self.path.read_text().strip().splitlines()
        return json.loads(last)["hash"]

    def append(self, actor: str, action: str, **details) -> dict:
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "actor": actor, "action": action,
               "details": details, "prev": self._last_hash()}
        rec["hash"] = hashlib.sha256(json.dumps(rec, sort_keys=True).encode()).hexdigest()
        with self.path.open("a") as f:
            f.write(json.dumps(rec, sort_keys=True) + "\n")
        return rec

    def verify(self) -> bool:
        prev = "0" * 64
        for line in self.path.read_text().strip().splitlines() if self.path.exists() else []:
            rec = json.loads(line)
            h = rec.pop("hash")
            if rec["prev"] != prev or hashlib.sha256(json.dumps(rec, sort_keys=True).encode()).hexdigest() != h:
                return False
            prev = h
        return True
# [END audit]


# [START plan]
def make_patch(namespace: str, workload: str, container: str, cpu_m: int, mem_mi: int, mem_limit_mi: int | None) -> dict:
    """Strategic-merge patch for the Deployment, exactly what would be committed to the GitOps repo."""
    resources = {"requests": {"cpu": f"{cpu_m}m", "memory": f"{mem_mi}Mi"}}
    if mem_limit_mi:
        resources["limits"] = {"memory": f"{mem_limit_mi}Mi"}
    return {"apiVersion": "apps/v1", "kind": "Deployment", "metadata": {"name": workload, "namespace": namespace},
            "spec": {"template": {"spec": {"containers": [{"name": container, "resources": resources}]}}}}


def plan_hash(patch: dict) -> str:
    return hashlib.sha256(json.dumps(patch, sort_keys=True).encode()).hexdigest()
# [END plan]


# [START store]
class ChangeStore:
    def __init__(self, path: Path | None = None) -> None:
        p = path or STATE_DIR / "changes.db"
        p.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(p)
        self.db.execute("""CREATE TABLE IF NOT EXISTS changes(
            id INTEGER PRIMARY KEY, hash TEXT UNIQUE, patch TEXT, evidence TEXT, requester TEXT,
            status TEXT, approver TEXT, created REAL, decided REAL, applied REAL)""")

    def propose(self, patch: dict, evidence: dict, requester: str) -> dict:
        h = plan_hash(patch)
        row = self.db.execute("SELECT id, status FROM changes WHERE hash=?", (h,)).fetchone()
        if row:                                         # idempotent: same plan -> same proposal
            return {"id": row[0], "hash": h, "status": row[1], "duplicate": True}
        cur = self.db.execute("INSERT INTO changes(hash,patch,evidence,requester,status,created) VALUES(?,?,?,?,?,?)",
                              (h, json.dumps(patch), json.dumps(evidence), requester, "pending", time.time()))
        self.db.commit()
        return {"id": cur.lastrowid, "hash": h, "status": "pending", "duplicate": False}

    def get(self, change_id: int) -> dict | None:
        r = self.db.execute("SELECT id,hash,patch,evidence,requester,status,approver,applied FROM changes WHERE id=?",
                            (change_id,)).fetchone()
        if not r:
            return None
        return {"id": r[0], "hash": r[1], "patch": json.loads(r[2]), "evidence": json.loads(r[3]), "requester": r[4],
                "status": r[5], "approver": r[6], "applied": r[7]}

    def decide(self, change_id: int, approver: str, approve: bool, expected_hash: str) -> dict:
        c = self.get(change_id)
        if not c or c["status"] != "pending":
            raise ValueError("change not found or not pending")
        if c["hash"] != expected_hash:
            raise ValueError("plan hash mismatch: the approver must approve exactly what was proposed")
        if approver == c["requester"]:
            raise ValueError("separation of duties: requester cannot approve their own change")
        status = "approved" if approve else "rejected"
        self.db.execute("UPDATE changes SET status=?, approver=?, decided=? WHERE id=?", (status, approver, time.time(), change_id))
        self.db.commit()
        return {**c, "status": status, "approver": approver}

    def mark_applied(self, change_id: int) -> None:
        self.db.execute("UPDATE changes SET status='applied', applied=? WHERE id=?", (time.time(), change_id))
        self.db.commit()
# [END store]
