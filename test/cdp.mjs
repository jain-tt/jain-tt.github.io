// Minimal Chrome DevTools Protocol driver for headless testing (no npm deps; Node 22+).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export async function launch({ width = 1280, height = 900, port = 9300 + Math.floor(Math.random()*600) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find(t => t.type === 'page')) break; } catch { }
    await new Promise(r => setTimeout(r, 200));
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const listeners = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else listeners.forEach(l => l(m));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const logs = [];
  listeners.push(m => {
    if (m.method === 'Runtime.exceptionThrown') logs.push({ type: 'exception', text: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text });
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push({ type: m.params.type, text: m.params.args.map(a => a.value ?? a.description).join(' ') });
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push({ type: 'log', text: m.params.entry.text });
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  const api = {
    send, logs,
    async goto(url) { await send('Page.navigate', { url }); await new Promise(r => setTimeout(r, 900)); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; },
    async shot(file, full = false) { let clip; if (full) { const m = await send('Page.getLayoutMetrics'); clip = { x: 0, y: 0, width: m.cssContentSize.width, height: Math.min(m.cssContentSize.height, 12000), scale: 1 }; } const r = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: full }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    async resize(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }); },
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    async close() { try { ws.close(); } catch { } proc.kill('SIGKILL'); await new Promise(r => setTimeout(r, 300)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } }
  };
  return api;
}
