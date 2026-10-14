// node --test test/  (after `npm run build`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildServer } from '../dist/server.js';

// [START test_inmemory]
async function connected() {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await buildServer().connect(serverT);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientT);
  return client;
}

test('lists read-only tools with schemas', async () => {
  const c = await connected();
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['get_current_time', 'get_kubernetes_pods']);
  for (const t of tools) { assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.inputSchema.type, 'object'); }
  await c.close();
});

test('structured result and validation error', async () => {
  const c = await connected();
  const r = await c.callTool({ name: 'get_kubernetes_pods', arguments: { namespace: 'payments', only_unhealthy: true } });
  assert.equal(r.isError ?? false, false);
  assert.equal(r.structuredContent.unhealthy, 2);
  const bad = await c.callTool({ name: 'get_kubernetes_pods', arguments: { namespace: '../kube-system' } });
  assert.equal(bad.isError, true);                       // schema rejects it before our handler runs
  const missing = await c.callTool({ name: 'get_kubernetes_pods', arguments: { namespace: 'nope' } });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /not found/);
  await c.close();
});
// [END test_inmemory]

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(claims, secret) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims);
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}

test('HTTP: 401 without token, scopes and namespaces enforced', async () => {
  const port = 3900 + Math.floor(Math.random() * 500);
  const url = `http://127.0.0.1:${port}/mcp`;
  const secret = 'test-secret-only-for-tests-0123456789abcdef';
  const proc = spawn(process.execPath, ['dist/http.js'], {
    env: { ...process.env, PORT: String(port), ATLAS_DEV_HS256_SECRET: secret, ATLAS_PUBLIC_URL: url }, stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const tok = (scopes, namespaces, aud = url) => jwt({ iss: 'https://idp.example.test', aud, sub: 'u1', azp: 'cli',
      scope: scopes.join(' '), namespaces, exp: Math.floor(Date.now() / 1000) + 300 }, secret);

    const noTok = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    assert.equal(noTok.status, 401);
    assert.match(noTok.headers.get('www-authenticate') ?? '', /resource_metadata/);

    const wrongAud = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok(['atlas.read'], ['payments'], 'https://other.example')}` }, body: '{}' });
    assert.equal(wrongAud.status, 401);

    async function call(t) {
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
      const r = await client.callTool({ name: 'get_kubernetes_pods', arguments: { namespace: 'payments' } });
      await client.close();
      return r;
    }
    const noScope = await call(tok(['atlas.read'], ['payments']));
    assert.equal(noScope.isError, true); assert.match(noScope.content[0].text, /lacks scope/);
    const otherNs = await call(tok(['atlas.read', 'atlas.k8s.read'], ['search']));
    assert.equal(otherNs.isError, true); assert.match(otherNs.content[0].text, /Access denied/);
    const ok = await call(tok(['atlas.read', 'atlas.k8s.read'], ['payments']));
    assert.equal(ok.structuredContent.count, 3);
  } finally { proc.kill(); }
});
