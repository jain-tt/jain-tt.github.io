// Build: concatenates all sources into ONE standalone offline HTML file (dist/index.html).
// Usage: node build.mjs            -> dist/index.html
//        node build.mjs --check    -> validate content only
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const rdRaw = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
// @@include(labs/x/y.py)@@ or @@include(labs/x/y.py#name)@@ -> file text (or text between lines containing [START name] and [END name]),
// escaped for use INSIDE a JS template literal. Marker lines are always removed.
const includeErrors = [];
function includeText(spec) {
  const [file, region] = spec.split('#');
  const fp = path.join(ROOT, file);
  if (!fs.existsSync(fp)) { includeErrors.push('include missing: ' + spec); return 'MISSING ' + spec; }
  let lines = fs.readFileSync(fp, 'utf8').split('\n');
  if (region) {
    const a = lines.findIndex(l => l.includes('[START ' + region + ']'));
    const b = lines.findIndex(l => l.includes('[END ' + region + ']'));
    if (a < 0 || b < 0 || b < a) { includeErrors.push('include region missing: ' + spec); return 'MISSING ' + spec; }
    lines = lines.slice(a + 1, b);
    const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
    if (isFinite(ind)) lines = lines.map(l => l.slice(ind));
  }
  lines = lines.filter(l => !/\[(START|END) [\w-]+\]/.test(l));
  return lines.join('\n').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
const rd = p => {
  const t = rdRaw(p);
  return p.startsWith('src/') && !p.startsWith('src/lib/') ? t.replace(/@@include\(([^)]+)\)@@/g, (_, spec) => includeText(spec.trim())) : t;
};
const ls = d => fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.js')).sort().map(f => d + '/' + f) : [];

const css = rd('src/styles.css');
const files = [
  'src/lib/registry.js',
  'src/lib/anim.js',
  'src/lib/helpers.js',
  'src/curriculum.js',
  ...ls('src/anims'),
  ...ls('src/content'),
  ...ls('src/questions'),
  ...ls('src/reference'),
  'src/lib/app.js',
];

// ---------- validation in a sandbox ----------
function validate() {
  const errors = [], warns = [];
  const ctx = { console, window: {}, document: undefined, performance: { now: () => 0 } };
  ctx.window = ctx; ctx.self = ctx;
  const reg = { lessons: {}, questions: [], scenes: {}, glossary: [], formulas: [], tools: [], runbooks: [], labs: [], pages: {}, mocks: [], cur: null };
  ctx.Anim = { register: s => { if (reg.scenes[s.id]) errors.push('dup scene ' + s.id); reg.scenes[s.id] = s; }, row: () => [], chainEdges: () => [] };
  ctx.registerCurriculum = c => reg.cur = c;
  ctx.registerLesson = l => { if (reg.lessons[l.id]) errors.push('dup lesson ' + l.id); reg.lessons[l.id] = l; };
  ctx.registerQuestion = q => reg.questions.push(q);
  ctx.registerQuestions = a => a.forEach(q => reg.questions.push(q));
  ctx.registerGlossary = a => reg.glossary.push(...a);
  ctx.registerFormulas = a => reg.formulas.push(...a);
  ctx.registerTools = a => reg.tools.push(...a);
  ctx.registerRunbooks = a => reg.runbooks.push(...a);
  ctx.registerLabs = a => reg.labs.push(...a);
  ctx.registerPage = (id, p) => reg.pages[id] = p;
  ctx.registerMock = m => reg.mocks.push(m);
  vm.createContext(ctx);
  for (const f of files) {
    if (f.endsWith('anim.js') || f.endsWith('app.js') || f.endsWith('registry.js')) continue;
    try { vm.runInContext(rd(f), ctx, { filename: f }); }
    catch (e) { errors.push(`${f}: ${e.message}`); }
  }
  // lessons
  const L = reg.lessons;
  const volParts = {};
  (reg.cur?.volumes || []).forEach(v => v.parts.forEach(p => volParts[v.num + '.' + p.num] = 1));
  for (const id in L) {
    const l = L[id];
    if (!l.title) errors.push(`lesson ${id}: no title`);
    if (!volParts[l.vol + '.' + l.part]) errors.push(`lesson ${id}: vol/part ${l.vol}.${l.part} not in curriculum`);
    if (!l.html || l.html.length < 400) warns.push(`lesson ${id}: thin html (${(l.html || '').length})`);
    (l.prereqs || []).concat(l.next || []).forEach(x => { if (!L[x]) errors.push(`lesson ${id}: link to missing lesson ${x}`); });
    (l.quiz || []).forEach((q, i) => { if (!Array.isArray(q.options) || q.answer === undefined || q.answer < 0 || q.answer >= q.options.length) errors.push(`lesson ${id}: quiz ${i} invalid`); });
    const anims = (l.html || '').match(/data-anim="([^"]+)"/g) || [];
    anims.forEach(a => { const s = a.slice(11, -1); if (!reg.scenes[s]) errors.push(`lesson ${id}: missing animation ${s}`); });
    const links = (l.html || '').match(/#\/lesson\/([a-z0-9-]+)/g) || [];
    links.forEach(a => { const s = a.slice(9); if (!L[s]) errors.push(`lesson ${id}: broken link ${s}`); });
    if (/TODO|PLACEHOLDER|lorem ipsum/i.test(l.html || '')) errors.push(`lesson ${id}: placeholder text`);
  }
  // per-key uniqueness in ordering
  const keys = {};
  for (const id in L) { const k = `${L[id].vol}.${L[id].part}.${L[id].num}`; if (keys[k]) errors.push(`order clash ${k}: ${keys[k]} & ${id}`); keys[k] = id; }
  // questions
  const qids = {};
  reg.questions.forEach(q => {
    if (qids[q.id]) errors.push('dup question ' + q.id); qids[q.id] = 1;
    if (!L[q.chapter]) errors.push(`question ${q.id}: chapter ${q.chapter} missing`);
    ['title', 'understand', 'short', 'detailed'].forEach(k => { if (!q[k]) errors.push(`question ${q.id}: missing ${k}`); });
    if (!q.followups || q.followups.length < 2) warns.push(`question ${q.id}: <2 followups`);
    if (!q.mistakes || !q.mistakes.length) warns.push(`question ${q.id}: no mistakes`);
    if (!q.vocab || !q.vocab.length) warns.push(`question ${q.id}: no vocab`);
    if (!q.tradeoffs) warns.push(`question ${q.id}: no tradeoffs`);
    if (!q.failures) warns.push(`question ${q.id}: no failures`);
    (q.related || []).forEach(r => { if (!L[r]) errors.push(`question ${q.id}: related ${r} missing`); });
    const anims = (q.diagram || '').match(/data-anim="([^"]+)"/g) || [];
    anims.forEach(a => { const s = a.slice(11, -1); if (!reg.scenes[s]) errors.push(`question ${q.id}: missing animation ${s}`); });
  });
  // scenes
  for (const id in reg.scenes) {
    const s = reg.scenes[id];
    const ids = {};
    (s.elements || []).forEach(e => { if (ids[e.id]) errors.push(`scene ${id}: dup element ${e.id}`); ids[e.id] = e; });
    (s.elements || []).forEach(e => { if (e.type === 'edge' && (!ids[e.from] || !ids[e.to])) errors.push(`scene ${id}: edge ${e.id} refs missing ${e.from}->${e.to}`); });
    if (!s.steps || s.steps.length < 3) errors.push(`scene ${id}: fewer than 3 steps`);
    (s.steps || []).forEach((st, i) => {
      ['hl', 'ok', 'bad', 'warn', 'busy', 'dim', 'show', 'hide'].forEach(k => (st[k] || []).forEach(x => { if (!ids[x]) errors.push(`scene ${id} step ${i}: ${k} unknown ${x}`); }));
      (st.packets || []).forEach(p => { if (!ids[p.edge] || ids[p.edge].type !== 'edge') errors.push(`scene ${id} step ${i}: packet edge ${p.edge} not an edge`); });
      if (st.set) for (const k in st.set) if (!ids[k]) errors.push(`scene ${id} step ${i}: set unknown ${k}`);
      if (!st.caption) errors.push(`scene ${id} step ${i}: no caption`);
    });
  }
  // glossary links
  reg.glossary.forEach(g => { if (g.lesson && !L[g.lesson]) warns.push(`glossary ${g.term}: lesson ${g.lesson} missing`); });
  reg.labs.forEach(g => { if (g.lesson && !L[g.lesson]) errors.push(`lab ${g.title}: lesson ${g.lesson} missing`); });
  // unused scenes
  const used = new Set();
  Object.values(L).forEach(l => ((l.html || '').match(/data-anim="([^"]+)"/g) || []).forEach(a => used.add(a.slice(11, -1))));
  reg.questions.forEach(q => ((q.diagram || '').match(/data-anim="([^"]+)"/g) || []).forEach(a => used.add(a.slice(11, -1))));
  Object.values(reg.pages).forEach(p => ((p.html || '').match(/data-anim="([^"]+)"/g) || []).forEach(a => used.add(a.slice(11, -1))));
  for (const id in reg.scenes) if (!used.has(id)) warns.push(`scene ${id}: not used by any lesson (library only)`);
  const words = Object.values(L).reduce((a, l) => a + (l.html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).length, 0) + reg.questions.reduce((a, q) => a + [q.understand, q.short, q.detailed, q.tradeoffs, q.failures].join(' ').replace(/<[^>]+>/g, ' ').split(/\s+/).length, 0);
  return { errors, warns, stats: { lessons: Object.keys(L).length, questions: reg.questions.length, scenes: Object.keys(reg.scenes).length, glossary: reg.glossary.length, formulas: reg.formulas.length, tools: reg.tools.length, runbooks: reg.runbooks.length, labs: reg.labs.length, pages: Object.keys(reg.pages).length, words } };
}

const v = validate();
includeErrors.forEach(e => v.errors.push(e));
console.log('STATS', JSON.stringify(v.stats));
v.warns.forEach(w => console.log('WARN ', w));
v.errors.forEach(e => console.log('ERROR', e));
if (process.argv.includes('--check')) process.exit(v.errors.length ? 1 : 0);
if (v.errors.length && !process.argv.includes('--force')) { console.log(`\n${v.errors.length} errors — build aborted`); process.exit(1); }

const js = files.map(f => `/* ==== ${f} ==== */\n` + rd(f)).join('\n;\n').replace(/<\/script/gi, '<\\/script');
const shell = rd('src/shell.html');
const out = shell.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '--out=dist/index.html').slice(6);
fs.writeFileSync(path.resolve(ROOT, OUT), out);
console.log(`built ${OUT} ${(out.length / 1024 / 1024).toFixed(2)} MB`);
