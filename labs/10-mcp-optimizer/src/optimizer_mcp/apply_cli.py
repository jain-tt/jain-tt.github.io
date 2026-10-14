"""Apply an APPROVED change the GitOps way: write the patch into the manifests repo.

Usage: python -m optimizer_mcp.apply_cli <change_id> <gitops_repo_dir>
Runs as the CI/GitOps identity, never as the MCP server. Argo CD (or Flux) then syncs the commit,
and rollback is a git revert. This script only writes files; committing/opening a PR is left to the pipeline.
"""
# [START apply]
import json
import sys
from pathlib import Path

from .governance import AuditLog, ChangeStore, plan_hash


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    change_id, repo = int(sys.argv[1]), Path(sys.argv[2])
    store, audit = ChangeStore(), AuditLog()
    c = store.get(change_id)
    if not c or c["status"] != "approved":
        sys.exit("refusing: change is not approved")
    if plan_hash(c["patch"]) != c["hash"]:
        sys.exit("refusing: stored patch does not match the approved hash")
    m = c["patch"]["metadata"]
    out = repo / "overlays" / m["namespace"] / f"{m['name']}-resources.patch.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(c["patch"], indent=2) + "\n")
    store.mark_applied(change_id)
    audit.append("pipeline:gitops", "applied", change_id=change_id, file=str(out))
    print(f"wrote {out}; commit it and let Argo CD sync")


if __name__ == "__main__":
    main()
# [END apply]
