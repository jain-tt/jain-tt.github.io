"""HTTP application for the remote transport (Streamable HTTP).

Routes:
  POST /mcp      MCP endpoint (the SDK app; also serves RFC 9728 metadata when auth is on)
  GET  /healthz  liveness: the process is up
  GET  /readyz   readiness: backends reachable (do not send traffic otherwise)
  GET  /metrics  Prometheus exposition
"""
from __future__ import annotations

import os

from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .metrics import HTTP_RESPONSES
from .server import BACKEND, mcp

# [START http_app]
@mcp.custom_route("/healthz", methods=["GET"])
async def healthz(_: Request) -> Response:
    return JSONResponse({"status": "ok"})


@mcp.custom_route("/readyz", methods=["GET"])
async def readyz(_: Request) -> Response:
    checks = await BACKEND.health()
    ready = all(v.startswith("ok") for v in checks.values())
    return JSONResponse({"ready": ready, "checks": checks}, status_code=200 if ready else 503)


@mcp.custom_route("/metrics", methods=["GET"])
async def metrics(_: Request) -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


class StatusCounter(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        resp = await call_next(request)
        if request.url.path.startswith("/mcp"):
            HTTP_RESPONSES.labels(str(resp.status_code)).inc()
        return resp


def http_app():
    """Build the ASGI app. Stateless + JSON responses makes every replica interchangeable
    behind a plain load balancer (no session affinity), which is what we want on Kubernetes."""
    app = mcp.streamable_http_app(
        stateless_http=True,                       # no per-connection session state on this replica
        json_response=True,                        # plain JSON responses (no SSE needed for our short tools)
        host=os.environ.get("ATLAS_HOST", "127.0.0.1"),  # DNS-rebinding protection derives allowed Host from this
    )

    app.add_middleware(StatusCounter)               # counts 401/403 from the auth layer too
    return app
# [END http_app]
