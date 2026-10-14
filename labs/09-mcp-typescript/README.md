# Lab 09 — Atlas Ops MCP server (TypeScript)

The Python lab's server rebuilt with the official TypeScript SDK v2
(`@modelcontextprotocol/server` 2.3.1, `@modelcontextprotocol/node` 2.1.1, `zod` 4). Tested 2026-10-14 on Node 22:
`npm test` → 3 tests pass (in-memory protocol, HTTP 401/audience/scope/namespace checks).

```
src/server.ts   buildServer() factory: tools (registerTool + zod schemas), resource, prompt, timeouts, per-tool authz
src/stdio.ts    serveStdio(() => buildServer())         — local transport
src/http.ts     createMcpHandler + toNodeHandler on node:http, bearer-token verification, RFC 9728 metadata
src/auth.ts     HS256 dev verifier (use a JWKS verifier such as `jose` in production)
test/           node:test suite
```

```bash
npm install && npm test
node dist/stdio.js                       # stdio
PORT=3000 node dist/http.js              # http://127.0.0.1:3000/mcp (no auth unless ATLAS_DEV_HS256_SECRET is set)
```
Key v2 differences from tutorials written for SDK v1: `registerTool` (the variadic `tool()` is gone),
`zod/v4` schemas wrapped in `z.object`, per-request server factories, and `createMcpHandler`
serving the 2026-07-28 revision and 2025 clients (stateless fallback) from one endpoint.
Not tested here: the Docker build (no Docker daemon available).
