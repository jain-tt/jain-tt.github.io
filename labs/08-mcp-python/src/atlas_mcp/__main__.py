"""Entry point:  python -m atlas_mcp [--transport stdio|http] [--port 8000]"""
from __future__ import annotations

import argparse
import os

# [START main]
def main() -> None:
    p = argparse.ArgumentParser(description="Atlas Ops MCP server")
    p.add_argument("--transport", choices=["stdio", "http"], default=os.environ.get("ATLAS_TRANSPORT", "stdio"))
    p.add_argument("--host", default=os.environ.get("ATLAS_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("ATLAS_PORT", "8000")))
    a = p.parse_args()
    from .app import mcp, http_app
    if a.transport == "stdio":
        mcp.run()                                   # newline-delimited JSON-RPC on stdin/stdout
    else:
        import uvicorn                               # Streamable HTTP on one endpoint: /mcp
        uvicorn.run(http_app(), host=a.host, port=a.port, log_level="info",
                    timeout_graceful_shutdown=25)    # drain in-flight requests on SIGTERM
# [END main]


if __name__ == "__main__":
    main()
