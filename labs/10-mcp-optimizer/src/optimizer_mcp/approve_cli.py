"""Human approval — deliberately NOT an MCP tool, so no model can call it.

Usage: python -m optimizer_mcp.approve_cli <change_id> <plan_hash> [--reject]
In a real platform this is a ticket/PR approval (e.g. a required reviewer on the GitOps PR).
"""
# [START approve]
import getpass
import json
import sys

from .governance import AuditLog, ChangeStore


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    change_id, expected_hash = int(sys.argv[1]), sys.argv[2]
    store, audit = ChangeStore(), AuditLog()
    c = store.get(change_id)
    if not c:
        sys.exit("unknown change")
    print(json.dumps(c["patch"], indent=2))
    print("evidence:", json.dumps(c["evidence"]["analysis"]["recommendation"]["reasons"], indent=2))
    approver = f"local:{getpass.getuser()}"
    res = store.decide(change_id, approver, approve="--reject" not in sys.argv, expected_hash=expected_hash)
    audit.append(approver, res["status"], change_id=change_id, plan_hash=expected_hash)
    print(f"change {change_id} {res['status']} by {approver}")


if __name__ == "__main__":
    main()
# [END approve]
