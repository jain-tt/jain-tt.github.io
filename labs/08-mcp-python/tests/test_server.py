"""Tests for the Atlas Ops MCP server.

Two levels:
1. In-memory: `Client(mcp)` connects to the server object directly — fast,
   no network, exercises the real protocol (discover/list/call/read/prompts).
2. HTTP: start the Streamable HTTP app with JWT auth on a real port and check
   401 handling, Protected Resource Metadata and per-tool scopes.
"""
from __future__ import annotations

import os
import socket
import threading
import time

import pytest

os.environ.setdefault("ATLAS_BACKEND", "sample")

from mcp import Client  # noqa: E402

from atlas_mcp.server import mcp  # noqa: E402

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


# [START test_list]
async def test_lists_five_read_only_tools():
    async with Client(mcp) as client:
        tools = (await client.list_tools()).tools
        names = {t.name for t in tools}
        assert names == {"get_current_time", "get_system_health", "get_kubernetes_pods",
                         "get_pod_resource_usage", "get_cloud_cost_summary"}
        for t in tools:
            assert t.annotations.read_only_hint is True       # advertised as read-only
            assert t.input_schema["type"] == "object"         # JSON Schema generated from type hints
            assert t.output_schema is not None                # structured output schema from return type
# [END test_list]


# [START test_call]
async def test_pods_structured_result():
    async with Client(mcp) as client:
        r = await client.call_tool("get_kubernetes_pods", {"namespace": "payments", "only_unhealthy": True})
        assert not r.is_error
        data = r.structured_content
        assert data["namespace"] == "payments"
        assert data["unhealthy"] == 2
        assert {p["name"] for p in data["pods"]} == {"payments-api-7c9f-fghij", "payments-worker-5d8b-klmno"}
        assert r.content and r.content[0].type == "text"      # text copy for older clients
# [END test_call]


# [START test_errors]
async def test_validation_rejects_bad_namespace():
    async with Client(mcp) as client:
        r = await client.call_tool("get_kubernetes_pods", {"namespace": "../kube-system"})
        assert r.is_error                                     # input validation -> tool execution error


async def test_backend_error_becomes_tool_error():
    async with Client(mcp) as client:
        r = await client.call_tool("get_kubernetes_pods", {"namespace": "does-not-exist"})
        assert r.is_error
        assert "not found" in r.content[0].text


async def test_unknown_timezone_is_tool_error():
    async with Client(mcp) as client:
        r = await client.call_tool("get_current_time", {"timezone": "Mars/Olympus"})
        assert r.is_error and "Unknown timezone" in r.content[0].text
# [END test_errors]


async def test_usage_and_cost():
    async with Client(mcp) as client:
        u = await client.call_tool("get_pod_resource_usage", {"namespace": "payments", "pod": "payments-api-7c9f-abcde"})
        assert u.structured_content["cpu_utilisation_of_request"] == 0.24   # 120m / 500m
        c = await client.call_tool("get_cloud_cost_summary", {"namespace": "search", "window": "30d"})
        assert c.structured_content["total_usd"] == 3890.0


async def test_timeout(monkeypatch):
    import atlas_mcp.server as srv

    async def slow(ns):
        import anyio
        await anyio.sleep(5)
    monkeypatch.setattr(srv, "BACKEND_TIMEOUT_S", 0.2)
    monkeypatch.setattr(srv.BACKEND, "list_pods", slow)
    async with Client(mcp) as client:
        r = await client.call_tool("get_kubernetes_pods", {"namespace": "payments"})
        assert r.is_error and "timed out" in r.content[0].text


async def test_resources_and_prompt():
    async with Client(mcp) as client:
        templates = (await client.list_resource_templates()).resource_templates
        assert any(t.uri_template == "atlas://runbooks/{name}" for t in templates)
        rb = await client.read_resource("atlas://runbooks/crashloop")
        assert "only_unhealthy" in rb.contents[0].text
        p = await client.get_prompt("triage_namespace", {"namespace": "payments"})
        assert "payments" in p.messages[0].content.text


# ---------------------------------------------------------------- HTTP + auth
def _free_port() -> int:
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


# [START test_http_auth]
def test_http_requires_token_and_enforces_scopes(tmp_path):
    """Run the real HTTP app in a subprocess with JWT auth (HS256 dev secret)."""
    import subprocess
    import sys

    import httpx
    import jwt

    port = _free_port()
    url = f"http://127.0.0.1:{port}/mcp"
    env = dict(os.environ, ATLAS_AUTH="jwt", ATLAS_PUBLIC_URL=url, ATLAS_OAUTH_ISSUER="https://idp.example.test",
               ATLAS_DEV_HS256_SECRET="test-secret-only-for-tests-0123456789abcdef", ATLAS_BACKEND="sample",
               PYTHONPATH=os.path.join(os.path.dirname(__file__), "..", "src"))
    proc = subprocess.Popen([sys.executable, "-m", "atlas_mcp", "--transport", "http", "--port", str(port)],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            try:
                if httpx.get(f"http://127.0.0.1:{port}/healthz").status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.1)

        def token(scopes, namespaces, aud=url):
            return jwt.encode({"iss": "https://idp.example.test", "aud": aud, "sub": "user-42", "azp": "atlas-cli",
                               "scope": " ".join(scopes), "namespaces": namespaces, "exp": int(time.time()) + 300},
                              env["ATLAS_DEV_HS256_SECRET"], algorithm="HS256")

        call = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": "get_kubernetes_pods", "arguments": {"namespace": "payments"}}}
        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json",
                   "MCP-Protocol-Version": "2025-11-25"}

        # 1. No token -> 401 with a pointer to Protected Resource Metadata (RFC 9728)
        r = httpx.post(url, json=call, headers=headers)
        assert r.status_code == 401
        assert "resource_metadata" in r.headers.get("www-authenticate", "")

        # 2. Token for a DIFFERENT audience -> 401 (no token passthrough / confused deputy)
        r = httpx.post(url, json=call, headers={**headers, "Authorization": "Bearer " + token(["atlas.read", "atlas.k8s.read"], ["payments"], aud="https://other.example")})
        assert r.status_code == 401

        # 3. The metadata document tells clients which authorization server to use
        meta = httpx.get(f"http://127.0.0.1:{port}/.well-known/oauth-protected-resource/mcp").json()
        assert meta["authorization_servers"][0].rstrip("/") == "https://idp.example.test"

        import anyio

        async def run(tok):
            async with _client(url, tok) as client:
                return await client.call_tool("get_kubernetes_pods", {"namespace": "payments"})

        # 4. Valid token but missing the k8s scope -> tool error, not data
        r4 = anyio.run(run, token(["atlas.read"], ["payments"]))
        assert r4.is_error and "lacks scope" in r4.content[0].text
        # 5. Valid scope but namespace not in the tenant's claim -> denied, no enumeration
        r5 = anyio.run(run, token(["atlas.read", "atlas.k8s.read"], ["search"]))
        assert r5.is_error and "Access denied" in r5.content[0].text
        # 6. Correct scope and namespace -> data
        r6 = anyio.run(run, token(["atlas.read", "atlas.k8s.read"], ["payments"]))
        assert not r6.is_error and r6.structured_content["count"] == 3
        # 7. Metrics were recorded
        m = httpx.get(f"http://127.0.0.1:{port}/metrics").text
        assert 'mcp_tool_calls_total{outcome="ok",tool="get_kubernetes_pods"}' in m
        assert 'mcp_http_responses_total{status="401"}' in m
    finally:
        proc.terminate()
        proc.wait(timeout=10)
# [END test_http_auth]


def _client(url: str, tok: str):
    """MCP client over Streamable HTTP that sends a bearer token on every request."""
    import httpx
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client
    return Client(streamable_http_client(url, http_client=httpx.AsyncClient(headers={"Authorization": f"Bearer {tok}"})))


# [START test_stdio]
async def test_stdio_subprocess():
    """The way Claude Desktop / Claude Code launch a local server: a child process over stdin/stdout."""
    import sys
    from mcp import Client, StdioServerParameters
    params = StdioServerParameters(command=sys.executable, args=["-m", "atlas_mcp", "--transport", "stdio"],
                                   env={**os.environ, "PYTHONPATH": os.path.join(os.path.dirname(__file__), "..", "src")})
    async with Client(params) as client:
        r = await client.call_tool("get_current_time", {"timezone": "Asia/Riyadh"})
        assert not r.is_error and r.structured_content["iso8601"].endswith("+03:00")
# [END test_stdio]
