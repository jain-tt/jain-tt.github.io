"""Per-tool authorization: the server decides, never the model.

Remote callers carry an access token. We map
  scope  -> which tool families they may use      (RBAC)
  claims -> which namespaces / tenant they may see (ABAC)
Local stdio callers have no token: the operator who launched the process is
trusted, and the process only holds read-only credentials.
"""
from __future__ import annotations

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver.exceptions import ToolError

# [START policy]
SCOPE_FOR = {"k8s:read": "atlas.k8s.read", "metrics:read": "atlas.metrics.read", "cost:read": "atlas.cost.read"}


def authorize(action: str, namespace: str) -> None:
    token = get_access_token()
    if token is None:          # stdio / local dev: no OAuth on this transport
        return
    needed = SCOPE_FOR[action]
    if needed not in token.scopes:
        raise ToolError(f"Access denied: token lacks scope '{needed}'.")
    allowed = (token.claims or {}).get("namespaces", [])
    if "*" not in allowed and namespace not in allowed:
        # Same message for "does not exist" and "not yours": no tenant enumeration.
        raise ToolError(f"Access denied or namespace '{namespace}' not found.")
# [END policy]
