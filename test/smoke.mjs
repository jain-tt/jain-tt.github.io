// Smoke test: load dist/index.html, visit every route and lesson, step every animation, exercise features.
// Usage: node test/smoke.mjs [--shots] [--only=lessonId]
import { launch } from './cdp.mjs';
import path from 'node:path';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PAGE = 'file://' + path.resolve(ROOT, (process.argv.find(a => a.startsWith('--page=')) || '--page=dist/index.html').slice(7));
const SHOTS = process.argv.includes('--shots');
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const outDir = path.join(ROOT, 'test/shots'); fs.mkdirSync(outDir, { recursive: true });
const b = await launch({ width: 1366, height: 900 });
const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); };
try {
  await b.goto(PAGE + '#/home');
  const info = await b.eval(`({lessons:APP.C.order.length, q:APP.C.questions.length, scenes:Anim.list().length, title:document.title})`);
  console.log('loaded', JSON.stringify(info));
  if (SHOTS) await b.shot(path.join(outDir, 'home.png'));
  const lessons = only ? [only] : await b.eval('APP.C.order');
  for (const id of lessons) {
    b.logs.length = 0;
    await b.eval(`location.hash='#/lesson/${id}'`); await b.sleep(250);
    // force-mount all animations (IntersectionObserver may not fire for offscreen)
    const r = await b.eval(`(async()=>{const nodes=[...document.querySelectorAll('[data-anim]')];for(const n of nodes){if(!n.dataset.mounted){n.dataset.mounted='1';Anim.mount(n,n.dataset.anim);}}
      let stepped=0,errs=[];for(const p of Anim.players){const n=p.scene.steps.length;for(let i=0;i<n;i++){try{p.goto(i,true);stepped++;}catch(e){errs.push(p.scene.id+':'+i+':'+e.message);}}p.goto(0,true);}
      // overflow check: any svg text outside viewBox?
      const h1=document.querySelector('h1')?.textContent;return {anims:nodes.length,stepped,errs,h1,len:document.querySelector('.lesson-body')?.innerText.length||0,
        quiz:document.querySelectorAll('.quiz').length, iq:document.querySelectorAll('.iq').length, diagrams:document.querySelectorAll('figure.diagram').length}})()`);
    r.errs.forEach(e => fail.push(`${id}: anim ${e}`));
    b.logs.forEach(l => fail.push(`${id}: ${l.type}: ${l.text}`));
    check(r.len > 500 || r.iq > 0, `${id}: thin content (${r.len})`);
    console.log(`${id.padEnd(28)} text=${String(r.len).padStart(6)} anims=${r.anims} steps=${r.stepped} diagrams=${r.diagrams} quiz=${r.quiz} iq=${r.iq}`);
    if (SHOTS) await b.shot(path.join(outDir, `${id}.png`), true);
  }
  if (!only) {
    for (const route of ['glossary', 'diagrams', 'animations', 'labs', 'formulas', 'tools', 'runbooks', 'career', 'prove', 'audit', 'flashcards?mode=all', 'quiz', 'dashboard', 'bookmarks', 'search?q=kv%20cache']) {
      b.logs.length = 0;
      await b.eval(`location.hash='#/${route}'`); await b.sleep(400);
      const len = await b.eval(`document.querySelector('#main').innerText.length`);
      b.logs.forEach(l => fail.push(`route ${route}: ${l.type}: ${l.text}`));
      check(len > (route === 'bookmarks' ? 100 : 200), `route ${route}: thin (${len})`);
      console.log(`route ${route.padEnd(22)} text=${len}`);
      if (SHOTS) await b.shot(path.join(outDir, `route-${route.replace(/[^a-z]/g, '_')}.png`));
    }
    // feature checks
    const lid = (await b.eval('APP.C.order'))[0];
    await b.eval(`location.hash='#/lesson/${lid}'`); await b.sleep(300);
    await b.eval(`document.getElementById('btn-done').click()`);
    const done = await b.eval(`JSON.parse(localStorage.getItem('aise-masterclass-v1')).progress['${lid}'].done`);
    check(done === true, 'progress persistence failed');
    await b.eval(`document.getElementById('btn-bm').click()`);
    check(await b.eval(`JSON.parse(localStorage.getItem('aise-masterclass-v1')).bookmarks.includes('${lid}')`), 'bookmark failed');
    await b.eval(`const t=document.getElementById('note');t.value='my note';t.dispatchEvent(new Event('input'))`); await b.sleep(800);
    check(await b.eval(`JSON.parse(localStorage.getItem('aise-masterclass-v1')).notes['${lid}']==='my note'`), 'notes failed');
    // quiz click
    const qOk = await b.eval(`(()=>{const o=document.querySelector('.quiz .opt');if(!o)return 'none';o.click();return document.querySelector('.quiz .explain.show')?'ok':'no-explain'})()`);
    check(qOk !== 'no-explain', 'quiz reveal failed');
    // search
    const sr = await b.eval(`(async()=>{const i=document.getElementById('search');i.value='attention';i.dispatchEvent(new Event('input'));await new Promise(r=>setTimeout(r,400));return document.querySelectorAll('#search-results .r').length})()`);
    check(sr > 0, 'search returned nothing');
    // theme toggle
    await b.eval(`document.getElementById('btn-theme').click()`);
    const th = await b.eval(`document.documentElement.getAttribute('data-theme')`);
    check(th === 'light' || th === 'dark', 'theme toggle failed: ' + th);
    // continue learning shows on home
    await b.eval(`location.hash='#/home'`); await b.sleep(300);
    check(await b.eval(`document.querySelector('.hero .btn.primary').textContent.includes('Continue')`), 'continue learning missing');
    // mobile layout: no horizontal overflow
    await b.resize(390, 844); await b.eval(`location.hash='#/lesson/${lid}'`); await b.sleep(400);
    const ov = await b.eval(`document.documentElement.scrollWidth - window.innerWidth`);
    check(ov <= 1, 'mobile horizontal overflow ' + ov + 'px');
    if (SHOTS) await b.shot(path.join(outDir, 'mobile-lesson.png'));
    await b.eval(`document.getElementById('sidebar-toggle').click()`); await b.sleep(300);
    if (SHOTS) await b.shot(path.join(outDir, 'mobile-sidebar.png'));
    b.logs.forEach(l => fail.push(`features: ${l.type}: ${l.text}`));
  }
} catch (e) { fail.push('FATAL ' + e.stack); }
await b.close();
console.log(fail.length ? `\nFAILURES (${fail.length}):\n` + fail.join('\n') : '\nALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
