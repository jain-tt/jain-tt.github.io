// [START http]
// Remote transport: Streamable HTTP on one endpoint (/mcp) using only node:http.
import { createServer } from 'node:http';
import { bearerAuthChallengeResponse, createMcpHandler, verifyBearerToken, type AuthInfo } from '@modelcontextprotocol/server';
import { toNodeHandler, toWebRequest } from '@modelcontextprotocol/node';
import { buildServer } from './server.js';
import { hs256Verifier } from './auth.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_URL = process.env.ATLAS_PUBLIC_URL ?? `http://127.0.0.1:${PORT}/mcp`;
const ISSUER = process.env.ATLAS_OAUTH_ISSUER ?? 'https://idp.example.test';
const METADATA_URL = new URL('/.well-known/oauth-protected-resource/mcp', PUBLIC_URL);
const authOn = !!process.env.ATLAS_DEV_HS256_SECRET;
const verifier = authOn ? hs256Verifier(process.env.ATLAS_DEV_HS256_SECRET!, ISSUER, PUBLIC_URL) : undefined;

// Stateless handler: a fresh McpServer per request from the factory; serves 2026-07-28 and 2025 clients.
const mcp = createMcpHandler((ctx) => buildServer(ctx));
const nodeMcp = toNodeHandler(mcp);

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ok"}'); return; }
  if (path === '/.well-known/oauth-protected-resource/mcp') {            // RFC 9728 metadata
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ resource: PUBLIC_URL, authorization_servers: [ISSUER], scopes_supported: ['atlas.read', 'atlas.k8s.read'] }));
    return;
  }
  if (path !== '/mcp') { res.writeHead(404); res.end(); return; }
  let authInfo: AuthInfo | undefined;
  if (verifier) {
    try {
      authInfo = await verifyBearerToken(req.headers.authorization, {
        verifier, requiredScopes: ['atlas.read'], resourceMetadataUrl: METADATA_URL.href, expectedResource: new URL(PUBLIC_URL),
      });
    } catch (err) {                                                       // 401/403 + WWW-Authenticate
      const r = bearerAuthChallengeResponse(err, { requiredScopes: ['atlas.read'], resourceMetadataUrl: METADATA_URL.href });
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
    }
  }
  (req as unknown as { auth?: AuthInfo }).auth = authInfo;              // passed through to the factory
  await nodeMcp(req, res);
}).listen(PORT, '127.0.0.1', () => console.error(`atlas-ops-ts: http://127.0.0.1:${PORT}/mcp (auth ${authOn ? 'on' : 'off'})`));
void toWebRequest;
// [END http]
