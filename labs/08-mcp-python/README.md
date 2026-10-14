# Lab 08 — Atlas Ops MCP server (Python)

A read-only operations MCP server built with the official Python SDK (`mcp` 2.3.0, `MCPServer` API).
Tested on 2026-10-14 with Python 3.14 (requires ≥ 3.11): `pytest` → 10 passed (in-memory, stdio subprocess, HTTP + OAuth).

| Tool | What it returns | Backend |
|---|---|---|
| `get_current_time` | time in an IANA timezone | stdlib |
| `get_system_health` | reachability of Kubernetes / Prometheus / OpenCost | all |
| `get_kubernetes_pods` | pods, phase, restarts, requests | Kubernetes API (`get`, `list` pods only) |
| `get_pod_resource_usage` | CPU (5-min rate) and memory vs request | Prometheus or Mimir |
| `get_cloud_cost_summary` | namespace cost incl. GPU share | OpenCost |

Plus resources `atlas://runbooks/{name}`, `atlas://config` and the prompt `triage_namespace`.

## Layout
```
src/atlas_mcp/server.py    tools, schemas, resources, prompt, timeouts, error handling
src/atlas_mcp/backends.py  SampleBackend (local data) and LiveBackend (real HTTP APIs)
src/atlas_mcp/auth.py      JWT access-token verifier + OAuth resource-server settings
src/atlas_mcp/policy.py    per-tool scopes (RBAC) + namespace claims (ABAC)
src/atlas_mcp/metrics.py   Prometheus metrics middleware
src/atlas_mcp/app.py       Streamable HTTP app: /mcp /healthz /readyz /metrics
tests/test_server.py       in-memory, stdio and HTTP+auth tests
Dockerfile                 multi-stage, non-root, pinned deps (requirements.lock)
deploy/helm/atlas-mcp      Helm chart (Deployment, Service, HTTPRoute, HPA, PDB, NetworkPolicy, RBAC, ServiceMonitor)
deploy/k8s/rendered.yaml   the chart rendered to plain manifests
```

## Run locally
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest -q                                   # 10 tests
python -m atlas_mcp                         # stdio (what desktop clients launch)
python -m atlas_mcp --transport http        # Streamable HTTP on http://127.0.0.1:8000/mcp
npx @modelcontextprotocol/inspector         # then connect to the URL above (or: mcp dev src/atlas_mcp/server.py)
```

## Connect a client
Claude Code (local, stdio):
```bash
claude mcp add --transport stdio atlas-ops --env ATLAS_BACKEND=sample -- python -m atlas_mcp
```
Claude Code (remote):
```bash
claude mcp add --transport http atlas-ops https://mcp.example.com/mcp
```
Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{"mcpServers": {"atlas-ops": {"command": "/abs/path/.venv/bin/python", "args": ["-m", "atlas_mcp"], "env": {"ATLAS_BACKEND": "sample"}}}}
```
VS Code (`.vscode/mcp.json`):
```json
{"servers": {"atlas-ops": {"type": "http", "url": "https://mcp.example.com/mcp"}}}
```
Cursor (`~/.cursor/mcp.json`):
```json
{"mcpServers": {"atlas-ops": {"url": "https://mcp.example.com/mcp"}}}
```
Claude.ai: Customize → Connectors → Add custom connector → paste `https://mcp.example.com/mcp`
(the server must be reachable from the public internet; `mcp.example.com` is illustrative, not a real service).

## Deploy (to a disposable/lab cluster)
```bash
docker build -t ghcr.io/<you>/atlas-mcp:0.1.0 .
trivy image ghcr.io/<you>/atlas-mcp:0.1.0             # scan before push
cosign sign ghcr.io/<you>/atlas-mcp@sha256:<digest>     # sign the digest you deploy
helm upgrade --install atlas-mcp deploy/helm/atlas-mcp -n atlas-mcp --create-namespace \
  --set image.repository=ghcr.io/<you>/atlas-mcp --set image.digest=sha256:<digest>
```
In a GitOps-managed estate, commit the chart and values to the manifests repo and let Argo CD sync it instead.

Not tested here: the Docker build (no Docker daemon was running) and a live cluster install.
The chart passes `helm lint` and `helm template`.
