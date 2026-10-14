"""Prometheus metrics for MCP traffic, recorded in SDK middleware.

The middleware sees EVERY inbound JSON-RPC message (tools/call, tools/list,
server/discover or initialize, ...). We label by method and tool name only —
never by user, token or arguments (high cardinality and a privacy risk).
"""
from __future__ import annotations

import time
from typing import Any

from prometheus_client import Counter, Histogram

# [START metrics]
MCP_REQUESTS = Counter("mcp_requests_total", "Inbound MCP requests", ["method", "outcome"])
TOOL_CALLS = Counter("mcp_tool_calls_total", "Tool invocations", ["tool", "outcome"])
TOOL_LATENCY = Histogram("mcp_tool_duration_seconds", "Tool execution latency", ["tool"],
                         buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10))
HTTP_RESPONSES = Counter("mcp_http_responses_total", "HTTP responses on the MCP endpoint", ["status"])


class MetricsMiddleware:
    """ServerMiddleware: (ctx, call_next) -> result."""

    async def __call__(self, ctx: Any, call_next: Any) -> Any:
        method = ctx.method
        tool = (ctx.params or {}).get("name", "unknown") if method == "tools/call" else None
        start = time.perf_counter()
        outcome = "ok"
        try:
            result = await call_next(ctx)
            if tool and _is_tool_error(result):
                outcome = "tool_error"          # isError=true: the tool ran and reported a failure
            return result
        except Exception:
            outcome = "protocol_error"          # JSON-RPC error: unknown tool, bad params, ...
            raise
        finally:
            if ctx.request_id is not None:
                MCP_REQUESTS.labels(method, outcome).inc()
            if tool:
                TOOL_CALLS.labels(tool, outcome).inc()
                TOOL_LATENCY.labels(tool).observe(time.perf_counter() - start)


def _is_tool_error(result: Any) -> bool:
    if isinstance(result, dict):
        return bool(result.get("isError"))
    return bool(getattr(result, "is_error", False) or getattr(result, "isError", False))
# [END metrics]
