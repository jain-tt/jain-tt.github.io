/* Authoring helpers available to every content file. */
(function(g){
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  // code block from raw text (HTML-escaped automatically)
  g.code=function(lang,text){return `<pre data-lang="${esc(lang)}"><code>${esc(String(text).replace(/^\n/,'').replace(/\s+$/,''))}</code></pre>`;};
  // glossary term
  g.term=function(t,label){return `<span class="term" tabindex="0" data-term="${esc(t.toLowerCase())}">${esc(label||t)}</span>`;};
  // lesson link
  g.L=function(id,label){return `<a href="#/lesson/${id}">${label}</a>`;};
  // callout
  g.callout=function(kind,title,html){return `<div class="callout ${kind}"><strong>${title}</strong>${html}</div>`;};
  // formula block (monospace, Unicode maths)
  g.formula=function(text){return `<div class="formula">${esc(String(text).replace(/^\n/,'').replace(/\s+$/,''))}</div>`;};
  // chain of connected concepts
  g.chain=function(items){return `<div class="chain">${items.map(esc).map(s=>`<span>${s}</span>`).join('<i>→</i>')}</div>`;};
  // animation mount
  g.anim=function(id){return `<div data-anim="${id}"></div>`;};
  // diagram wrapper
  g.fig=function(title,svg,caption){return `<figure class="diagram" data-title="${esc(title)}"><div class="ttl">${esc(title)}</div>${svg}${caption?`<figcaption>${caption}</figcaption>`:''}</figure>`;};
  // simple table from rows
  g.table=function(head,rows,cls){return `<table class="${cls||''}"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;};
  // svg box-and-arrow diagram builder: boxes [{id,x,y,w,h,label,cls,sub}], arrows [{from,to,label,cls,fromSide,toSide}], zones [{x,y,w,h,label,cls}]
  g.svgDiagram=function(spec){const W=spec.w||900,H=spec.h||360;const B={};(spec.boxes||[]).forEach(b=>B[b.id]=b);
    const c=b=>({x:b.x+b.w/2,y:b.y+b.h/2});
    const side=(b,s)=>{const m=c(b);return s==='left'?{x:b.x,y:m.y}:s==='right'?{x:b.x+b.w,y:m.y}:s==='top'?{x:m.x,y:b.y}:{x:m.x,y:b.y+b.h};};
    const auto=(a,b)=>{const ca=c(a),cb=c(b),dx=cb.x-ca.x,dy=cb.y-ca.y;return Math.abs(dx)>=Math.abs(dy)?(dx>=0?['right','left']:['left','right']):(dy>=0?['bottom','top']:['top','bottom']);};
    const mid='m'+Math.random().toString(36).slice(2,8);
    let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.title||'diagram')}"><defs><marker id="${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--an-node-line)"/></marker><marker id="${mid}h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--an-hl)"/></marker></defs>`;
    (spec.zones||[]).forEach(z=>{s+=`<rect class="d-zone ${z.cls||''}" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="12"/><text class="d-zone-label" x="${z.x+10}" y="${z.y+15}">${esc(z.label||'')}</text>`;});
    (spec.arrows||[]).forEach(a=>{const A=B[a.from],Bb=B[a.to];if(!A||!Bb)return;const au=auto(A,Bb);const p1=side(A,a.fromSide||au[0]),p2=side(Bb,a.toSide||au[1]);const horiz=['left','right'].includes(a.fromSide||au[0]);const d=a.straight?`M${p1.x},${p1.y} L${p2.x},${p2.y}`:horiz?`M${p1.x},${p1.y} C${(p1.x+p2.x)/2},${p1.y} ${(p1.x+p2.x)/2},${p2.y} ${p2.x},${p2.y}`:`M${p1.x},${p1.y} C${p1.x},${(p1.y+p2.y)/2} ${p2.x},${(p1.y+p2.y)/2} ${p2.x},${p2.y}`;const hl=/hl/.test(a.cls||'');s+=`<path class="d-line ${a.cls||''}" d="${d}" marker-end="url(#${mid}${hl?'h':''})"${a.both?` marker-start="url(#${mid}${hl?'h':''})"`:''}/>`;if(a.label){const mx=(p1.x+p2.x)/2,my=(p1.y+p2.y)/2+(a.dy||0);const w=a.label.length*5.8+10;s+=`<rect x="${mx-w/2}" y="${my-9}" width="${w}" height="17" rx="4" fill="var(--bg2)" stroke="var(--line2)" stroke-width=".6"/><text class="d-text small" x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="middle">${esc(a.label)}</text>`;}});
    (spec.boxes||[]).forEach(b=>{const m=c(b);s+=`<rect class="d-box ${b.cls||''}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="9"/>`;const lines=String(b.label||'').split('\n');const off=b.sub?-7:0;lines.forEach((ln,i)=>{s+=`<text class="d-text ${i===0?'b':''}" x="${m.x}" y="${m.y+off+(i-(lines.length-1)/2)*15}" text-anchor="middle" dominant-baseline="middle">${esc(ln)}</text>`;});if(b.sub)s+=`<text class="d-text small muted" x="${m.x}" y="${m.y+off+lines.length*7.5+8}" text-anchor="middle" dominant-baseline="middle">${esc(b.sub)}</text>`;});
    (spec.notes||[]).forEach(n=>{s+=`<text class="d-text small ${n.cls||'muted'}" x="${n.x}" y="${n.y}" text-anchor="${n.anchor||'start'}">${esc(n.text)}</text>`;});
    return s+'</svg>';};
  // checklist with persisted state: items [{key,text}]
  g.checklist=function(items){return `<ul class="checklist">${items.map(i=>`<li><input type="checkbox" data-key="${esc(i.key)}" aria-label="done">${i.text}</li>`).join('')}</ul>`;};
})(window);
