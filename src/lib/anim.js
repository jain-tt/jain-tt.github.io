/* ===== Declarative SVG animation engine =====
 * A scene = elements (nodes, edges, zones, bars, memory, timeline, tokens, grid, chart, counters, labels)
 * + ordered steps. Each step: caption, narration, transient state classes (hl/ok/bad/warn/busy/dim),
 * persistent show/hide, persistent `set` updates, and packets moving along edges.
 * Reduced motion: packets jump to end, transitions disabled.
 */
(function(){
const NS='http://www.w3.org/2000/svg';
const Anim={scenes:{},players:[],speed:1};
function el(tag,attrs,parent){const e=document.createElementNS(NS,tag);if(attrs)for(const k in attrs){if(attrs[k]!==undefined&&attrs[k]!==null)e.setAttribute(k,attrs[k]);}if(parent)parent.appendChild(e);return e;}
function txt(parent,x,y,s,cls,anchor){const t=el('text',{x,y,'text-anchor':anchor||'middle','dominant-baseline':'middle'},parent);if(cls)t.setAttribute('class',cls);t.textContent=s;return t;}
function multiline(parent,x,y,s,cls,anchor,lh){const lines=String(s).split('\n');const t=el('text',{x,y:y-(lines.length-1)*(lh||14)/2,'text-anchor':anchor||'middle','dominant-baseline':'middle'},parent);if(cls)t.setAttribute('class',cls);lines.forEach((l,i)=>{const ts=el('tspan',{x,dy:i?(lh||14):0},t);ts.textContent=l;});return t;}
const ICONS={
 user:'M8 1.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5',
 db:'M3 4c0-1.4 2.2-2.5 5-2.5s5 1.1 5 2.5v8c0 1.4-2.2 2.5-5 2.5S3 13.4 3 12V4zm0 0c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5M3 8c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5',
 gpu:'M2 4h12v8H2zM5 7h6v2H5zM4 1.5v2.5M8 1.5V4M12 1.5V4M4 12v2.5M8 12v2.5M12 12v2.5',
 queue:'M2 4h12M2 8h12M2 12h12',
 cloud:'M4.5 13a3 3 0 0 1-.4-6A4 4 0 0 1 12 6a3 3 0 0 1 .5 6z',
 lock:'M4 7V5a4 4 0 0 1 8 0v2M3 7h10v8H3z',
 doc:'M4 1.5h5l4 4v9H4zM9 1.5v4h4M6 9h5M6 12h5',
 llm:'M2 8a6 6 0 1 1 12 0 6 6 0 0 1-12 0zM8 2v12M2 8h12M4 4.5c2.5 2 5.5 2 8 0M4 11.5c2.5-2 5.5-2 8 0',
 server:'M2 2.5h12v4H2zM2 9.5h12v4H2zM4.5 4.5h.01M4.5 11.5h.01',
 k8s:'M8 1.5l6 3v6l-6 3-6-3v-6zM8 5v6M5 6.5l6 3M11 6.5l-6 3',
 agent:'M3 6h10v7H3zM6 9.5h.01M10 9.5h.01M8 2v4M5 13v1.5M11 13v1.5',
 gear:'M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
 cache:'M2 3h12v4H2zM2 9h12v4H2zM10 5h2M10 11h2',
 shield:'M8 1.5l6 2v4.5c0 3.5-2.6 6-6 7-3.4-1-6-3.5-6-7V3.5z',
 chart:'M2 14h12M4 11V7M8 11V4M12 11V9',
 key:'M10 2a4 4 0 1 0 0 8l1.5 0 1 1 1-1 1 1-1.5 2H10M6 6h.01',
 clock:'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zM8 5v3l2 2',
 money:'M2 4h12v8H2zM8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3M4 6v4M12 6v4',
 bolt:'M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z',
 globe:'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12',
 search:'M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM10.5 10.5 14 14',
 memory:'M2 5h12v6H2zM4 5V3M7 5V3M10 5V3M13 5V3M4 13v-2M7 13v-2M10 13v-2M13 13v-2',
 check:'M3 8.5l3 3 7-7',
 x:'M4 4l8 8M12 4l-8 8',
 warn:'M8 2 14.5 13.5h-13zM8 6.5v3.5M8 12v.01'
};
function icon(parent,name,x,y,size,color){if(!ICONS[name])return;const g=el('g',{transform:`translate(${x},${y}) scale(${(size||16)/16})`},parent);el('path',{d:ICONS[name],fill:'none',stroke:color||'currentColor','stroke-width':1.4,'stroke-linecap':'round','stroke-linejoin':'round'},g);return g;}

function center(n){return {x:n.x+n.w/2,y:n.y+n.h/2};}
function anchorPoint(n,side){const c=center(n);switch(side){case'left':return{x:n.x,y:c.y};case'right':return{x:n.x+n.w,y:c.y};case'top':return{x:c.x,y:n.y};case'bottom':return{x:c.x,y:n.y+n.h};default:return c;}}
function autoSides(a,b){const ca=center(a),cb=center(b);const dx=cb.x-ca.x,dy=cb.y-ca.y;if(Math.abs(dx)*1.0>=Math.abs(dy)){return dx>=0?['right','left']:['left','right'];}return dy>=0?['bottom','top']:['top','bottom'];}
function edgePath(a,b,e){let s1=e.fromSide,s2=e.toSide;if(!s1||!s2){const au=autoSides(a,b);s1=s1||au[0];s2=s2||au[1];}const p1=anchorPoint(a,s1),p2=anchorPoint(b,s2);if(e.straight)return `M${p1.x},${p1.y} L${p2.x},${p2.y}`;const horiz=(s1==='left'||s1==='right');const k=e.curve!==undefined?e.curve:0.5;if(horiz){const mx=p1.x+(p2.x-p1.x)*k;return `M${p1.x},${p1.y} C${mx},${p1.y} ${mx},${p2.y} ${p2.x},${p2.y}`;}const my=p1.y+(p2.y-p1.y)*k;return `M${p1.x},${p1.y} C${p1.x},${my} ${p2.x},${my} ${p2.x},${p2.y}`;}

function buildScene(scene,root){
 const W=scene.w||960,H=scene.h||420;const svg=el('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':scene.title||'animation'},root);
 const defs=el('defs',null,svg);
 const mk=el('marker',{id:'arr-'+scene.id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'},defs);el('path',{d:'M0,0 L10,5 L0,10 z',fill:'var(--an-node-line)'},mk);
 const mkh=el('marker',{id:'arrh-'+scene.id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'},defs);el('path',{d:'M0,0 L10,5 L0,10 z',fill:'var(--an-hl)'},mkh);
 if(scene.grid!==false){const g=el('g',{class:'bg'},svg);const pat=el('pattern',{id:'grid-'+scene.id,width:24,height:24,patternUnits:'userSpaceOnUse'},defs);el('path',{d:'M24 0H0V24',fill:'none',stroke:'var(--an-grid)','stroke-width':.6},pat);el('rect',{width:W,height:H,fill:`url(#grid-${scene.id})`},g);}
 const layers={zones:el('g',null,svg),edges:el('g',null,svg),nodes:el('g',null,svg),packets:el('g',null,svg)};
 const map={},elems=scene.elements||[];
 const nodesById={};elems.forEach(e=>{if(e.type==='node'||e.type==='bar'||e.type==='mem'||e.type==='zone'||e.type==='counter'||e.type==='tokens'||e.type==='grid'||e.type==='chart'||e.type==='timeline')nodesById[e.id]=e;});
 elems.forEach(e=>{
  if(e.type==='zone'){const g=el('g',{class:'sc-zone '+(e.cls||''),'data-id':e.id},layers.zones);el('rect',{x:e.x,y:e.y,width:e.w,height:e.h,rx:12},g);if(e.label)txt(g,e.x+10,e.y+12,e.label,null,'start');map[e.id]={g,e};}
  else if(e.type==='node'){const g=el('g',{class:'sc-node '+(e.cls||''),'data-id':e.id},layers.nodes);
    if(e.shape==='circle'){el('circle',{cx:e.x+e.w/2,cy:e.y+e.h/2,r:Math.min(e.w,e.h)/2},g);}
    else if(e.shape==='cyl'){const r=e.w/2,ry=Math.min(8,e.h/6);const d=`M${e.x},${e.y+ry} a${r},${ry} 0 0 0 ${e.w},0 v${e.h-2*ry} a${r},${ry} 0 0 1 -${e.w},0 z`;el('path',{d,class:'shape'},g);el('path',{d:`M${e.x},${e.y+ry} a${r},${ry} 0 0 1 ${e.w},0`,fill:'none',stroke:'var(--an-node-line)','stroke-width':1.2},g);}
    else{el('rect',{x:e.x,y:e.y,width:e.w,height:e.h,rx:e.rx!==undefined?e.rx:9},g);}
    const hasIcon=!!e.icon;const tx=e.x+e.w/2+(hasIcon&&e.w>70?8:0);
    if(e.sub){multiline(g,tx,e.y+e.h/2-7,e.label,'',null,13);const s=el('text',{x:tx,y:e.y+e.h/2+10,'text-anchor':'middle','dominant-baseline':'middle',class:'sub'},g);s.textContent=e.sub;}
    else multiline(g,tx,e.y+e.h/2,e.label||'', '',null,14);
    if(hasIcon)icon(g,e.icon,e.x+6,e.y+6,14,'var(--muted)');
    map[e.id]={g,e};}
  else if(e.type==='edge'){const a=nodesById[e.from],b=nodesById[e.to];if(!a||!b){console.warn('edge refs missing',e);return;}const g=el('g',{class:'sc-edge '+(e.cls||''),'data-id':e.id},layers.edges);const d=e.path||edgePath(a,b,e);const p=el('path',{d,'marker-end':e.arrow===false?null:`url(#arr-${scene.id})`},g);if(e.bidir)p.setAttribute('marker-start',`url(#arr-${scene.id})`);if(e.label){const len=p.getTotalLength?null:null;const mid=midpoint(p);const bg=el('rect',{x:mid.x-((e.label.length*5.6)/2)-4,y:mid.y-9+(e.labelDy||0),width:e.label.length*5.6+8,height:16,rx:4,fill:'var(--bg2)',stroke:'var(--line2)','stroke-width':.6},g);txt(g,mid.x,mid.y+(e.labelDy||0),e.label);}
    map[e.id]={g,e,path:p};}
  else if(e.type==='bar'){const g=el('g',{class:'sc-bar '+(e.cls||''),'data-id':e.id},layers.nodes);el('rect',{class:'track',x:e.x,y:e.y,width:e.w,height:e.h,rx:4},g);const f=el('rect',{class:'fill',x:e.x,y:e.orient==='v'?e.y+e.h:e.y,width:e.orient==='v'?e.w:0,height:e.orient==='v'?0:e.h,rx:4},g);if(e.label)txt(g,e.x+e.w/2,e.y-10,e.label);const vt=txt(g,e.x+e.w/2,e.y+e.h/2,'',null);vt.setAttribute('class','val');map[e.id]={g,e,fill:f,vt};setBar(map[e.id],e.value||0,e.text);}
  else if(e.type==='mem'){const g=el('g',{class:'sc-mem '+(e.cls||''),'data-id':e.id},layers.nodes);if(e.label)txt(g,e.x,e.y-10,e.label,null,'start');el('rect',{x:e.x,y:e.y,width:e.w,height:e.h,fill:'var(--bg3)',stroke:'var(--an-node-line)','stroke-width':1,rx:4},g);map[e.id]={g,e,segs:[]};setMem(map[e.id],e.segs||[]);}
  else if(e.type==='counter'){const g=el('g',{class:'sc-counter '+(e.cls||''),'data-id':e.id},layers.nodes);txt(g,e.x,e.y,e.label||'',null,e.anchor||'start');const v=txt(g,e.x,e.y+20,String(e.value!==undefined?e.value:''),'val',e.anchor||'start');map[e.id]={g,e,v};}
  else if(e.type==='label'){const g=el('g',{class:'sc-label '+(e.cls||''),'data-id':e.id},layers.nodes);multiline(g,e.x,e.y,e.text||'',null,e.anchor||'start',14);map[e.id]={g,e};}
  else if(e.type==='tokens'){const g=el('g',{class:'sc-tokens','data-id':e.id},layers.nodes);map[e.id]={g,e,items:[]};setTokens(map[e.id],e.items||[]);}
  else if(e.type==='timeline'){const g=el('g',{class:'sc-timeline '+(e.cls||''),'data-id':e.id},layers.nodes);const rows=e.rows||[],cols=e.cols||10;const rh=e.h/rows.length,cw=(e.w-e.labelW)/cols;rows.forEach((r,i)=>{txt(g,e.x+e.labelW-6,e.y+rh*i+rh/2,r.label,null,'end');for(let c=0;c<cols;c++)el('rect',{class:'slot',x:e.x+e.labelW+cw*c,y:e.y+rh*i+2,width:cw-1,height:rh-4,'data-r':r.id,'data-c':c},g);});if(e.xlabel)txt(g,e.x+e.labelW+(e.w-e.labelW)/2,e.y+e.h+14,e.xlabel,'',null);for(let c=0;c<cols;c++)if(e.ticks)txt(g,e.x+e.labelW+cw*c+cw/2,e.y-8,String(c+1),null);map[e.id]={g,e,rh,cw,cells:{}};}
  else if(e.type==='grid'){const g=el('g',{class:'sc-grid '+(e.cls||''),'data-id':e.id},layers.nodes);const cs=e.cell||26;map[e.id]={g,e,cs,cells:[]};(e.rowLabels||[]).forEach((l,i)=>txt(g,e.x-6,e.y+cs*i+cs/2,l,null,'end'));(e.colLabels||[]).forEach((l,j)=>txt(g,e.x+cs*j+cs/2,e.y-8,l,null));for(let i=0;i<e.rows;i++){map[e.id].cells[i]=[];for(let j=0;j<e.cols;j++){const r=el('rect',{class:'cell',x:e.x+cs*j,y:e.y+cs*i,width:cs,height:cs,fill:'var(--bg3)'},g);const t=e.showValues?txt(g,e.x+cs*j+cs/2,e.y+cs*i+cs/2,'',null):null;map[e.id].cells[i][j]={r,t};}}setGrid(map[e.id],e.values);}
  else if(e.type==='chart'){const g=el('g',{class:'sc-chart '+(e.cls||''),'data-id':e.id},layers.nodes);el('path',{class:'axis',d:`M${e.x},${e.y} V${e.y+e.h} H${e.x+e.w}`},g);if(e.xlabel)txt(g,e.x+e.w/2,e.y+e.h+16,e.xlabel);if(e.ylabel){const t=txt(g,e.x-14,e.y+e.h/2,e.ylabel);t.setAttribute('transform',`rotate(-90 ${e.x-14} ${e.y+e.h/2})`);}map[e.id]={g,e,series:{}};(e.series||[]).forEach(s=>{const p=el('path',{class:'line',d:''},g);if(s.color)p.style.stroke=s.color;map[e.id].series[s.id]={p,pts:[]};if(s.label)txt(g,e.x+e.w-4,e.y+10+(Object.keys(map[e.id].series).length-1)*14,s.label,null,'end').setAttribute('fill',s.color||'var(--accent)');setSeries(map[e.id],s.id,s.points||[]);});}
 });
 return {svg,map,W,H,layers,nodesById};
}
function midpoint(p){try{const L=p.getTotalLength();const m=p.getPointAtLength(L/2);return{x:m.x,y:m.y};}catch(_){const d=p.getAttribute('d').match(/-?[\d.]+/g).map(Number);return{x:(d[0]+d[d.length-2])/2,y:(d[1]+d[d.length-1])/2};}}
function setBar(m,v,text){const e=m.e;v=Math.max(0,Math.min(1,v));if(e.orient==='v'){m.fill.setAttribute('height',e.h*v);m.fill.setAttribute('y',e.y+e.h-e.h*v);}else m.fill.setAttribute('width',e.w*v);m.vt.textContent=text!==undefined?text:Math.round(v*100)+'%';m.g.classList.remove('ok','warn','bad');if(e.thresholds!==false){m.g.classList.add(v>0.9?'bad':v>0.7?'warn':'ok');}}
function setMem(m,segs){m.segs.forEach(s=>s.remove());m.segs=[];const e=m.e;let acc=0;segs.forEach(s=>{const w=e.w*s.frac;const r=el('rect',{class:'seg '+(s.cls||''),x:e.x+acc,y:e.y,width:Math.max(0,w),height:e.h},m.g);m.segs.push(r);if(s.label&&w>28){const t=txt(m.g,e.x+acc+w/2,e.y+e.h/2,s.label);m.segs.push(t);}acc+=w;});}
function setTokens(m,items){m.items.forEach(i=>i.remove());m.items=[];const e=m.e;let x=e.x;items.forEach(it=>{const s=typeof it==='string'?{t:it}:it;const w=Math.max(28,s.t.length*7.5+12);const g=el('g',{class:'sc-token '+(s.cls||'')},m.g);el('rect',{x,y:e.y,width:w,height:e.h||24,rx:5},g);txt(g,x+w/2,e.y+(e.h||24)/2,s.t);m.items.push(g);x+=w+4;});}
function setGrid(m,values){if(!values)return;const e=m.e;for(let i=0;i<e.rows;i++)for(let j=0;j<e.cols;j++){const v=values[i]&&values[i][j];const c=m.cells[i][j];if(v===null||v===undefined){c.r.setAttribute('fill','var(--bg3)');c.r.setAttribute('opacity',e.maskNull?0.25:1);if(c.t)c.t.textContent='';continue;}c.r.setAttribute('opacity',1);const a=Math.max(0,Math.min(1,v));c.r.setAttribute('fill',`color-mix(in srgb, var(--accent) ${Math.round(a*100)}%, var(--bg3))`);if(c.t){c.t.textContent=e.fmt?e.fmt(v):(Math.round(v*100)/100);c.t.setAttribute('fill',a>0.55?'#fff':'var(--an-node-ink)');}}}
function setSeries(m,id,pts){const s=m.series[id];if(!s)return;const e=m.e;const xmax=e.xmax||1,ymax=e.ymax||1;s.pts=pts;s.p.setAttribute('d',pts.map((p,i)=>(i?'L':'M')+(e.x+p[0]/xmax*e.w)+','+(e.y+e.h-p[1]/ymax*e.h)).join(' '));}
function setTimeline(m,cells){const e=m.e;cells.forEach(c=>{const key=c.row+':'+c.col;if(m.cells[key]){m.cells[key].forEach(x=>x.remove());delete m.cells[key];}if(!c.cls)return;const ri=e.rows.findIndex(r=>r.id===c.row);if(ri<0)return;const x=e.x+e.labelW+m.cw*c.col,y=e.y+m.rh*ri+2;const r=el('rect',{class:c.cls,x,y,width:m.cw*(c.span||1)-1,height:m.rh-4,rx:2},m.g);const arr=[r];if(c.text){arr.push(txt(m.g,x+m.cw*(c.span||1)/2,y+(m.rh-4)/2,c.text));}m.cells[key]=arr;});}

function animatePackets(built,scene,packets,speed,reduced){
 const layer=built.layers.packets;layer.innerHTML='';if(!packets||!packets.length)return;
 packets.forEach((pk,pi)=>{const em=built.map[pk.edge];if(!em||!em.path)return;const path=em.path;let L;try{L=path.getTotalLength();}catch(_){return;}const count=pk.count||1;for(let c=0;c<count;c++){const g=el('g',{class:'sc-packet '+(pk.cls||'')},layer);el('circle',{r:pk.r||7},g);if(pk.label){const t=txt(g,0,-13,pk.label);t.setAttribute('class','');}const dur=(pk.dur||1100)/speed;const delay=(pk.delay||0)/speed+c*(pk.gap||260)/speed+pi*40;const start=performance.now()+delay;const place=(f)=>{const p=path.getPointAtLength(pk.reverse?L*(1-f):L*f);g.setAttribute('transform',`translate(${p.x},${p.y})`);};if(reduced){place(1);continue;}place(0);g.style.opacity=0;const tick=(now)=>{const t=(now-start)/dur;if(t<0){requestAnimationFrame(tick);return;}g.style.opacity=1;if(t>=1){place(1);if(pk.fade!==false)g.style.opacity=.35;return;}place(t<.5?2*t*t:-1+(4-2*t)*t);requestAnimationFrame(tick);};requestAnimationFrame(tick);}});
}

const STATE_CLASSES=['hl','ok','bad','warn','busy','dim'];
function Player(scene,container){
 this.scene=scene;this.container=container;this.idx=-1;this.playing=false;this.timer=null;this.built=null;this.speed=Anim.speed||1;this.render();
}
Player.prototype.reduced=function(){return document.documentElement.classList.contains('reduced-motion');};
Player.prototype.render=function(){
 const s=this.scene,c=this.container;c.classList.add('anim');c.innerHTML='';
 const head=document.createElement('div');head.className='anim-head';head.innerHTML=`<span class="lbl">Animation</span><span class="t"></span>`;head.querySelector('.t').textContent=s.title||'';c.appendChild(head);
 const stage=document.createElement('div');stage.className='stage';c.appendChild(stage);
 this.built=buildScene(s,stage);
 const cap=document.createElement('div');cap.className='caption';c.appendChild(cap);this.cap=cap;
 const ctr=document.createElement('div');ctr.className='ctrls';ctr.innerHTML=`
  <button class="btn small" data-a="restart" title="Restart (Home)">⟲ Restart</button>
  <button class="btn small" data-a="prev" title="Previous step (←)">◀ Prev</button>
  <button class="btn small primary" data-a="play" title="Play / pause (space)">▶ Play</button>
  <button class="btn small" data-a="next" title="Next step (→)">Next ▶</button>
  <label style="font-size:.78rem;color:var(--muted);display:flex;align-items:center;gap:4px">Speed <select data-a="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
  <span class="step"></span><div class="prog"><i></i></div>`;c.appendChild(ctr);this.ctr=ctr;
 const narr=document.createElement('details');narr.className='narr';narr.innerHTML='<summary>Narration script (audio-friendly, all steps)</summary>';const ol=document.createElement('ol');(s.steps||[]).forEach(st=>{const li=document.createElement('li');li.textContent=st.narration||stripHtml(st.caption||'');ol.appendChild(li);});narr.appendChild(ol);c.appendChild(narr);
 ctr.addEventListener('click',(ev)=>{const b=ev.target.closest('button');if(!b)return;const a=b.dataset.a;if(a==='restart')this.goto(0,true);else if(a==='prev')this.step(-1);else if(a==='next')this.step(1);else if(a==='play')this.toggle();});
 ctr.querySelector('[data-a=speed]').addEventListener('change',(ev)=>{this.speed=parseFloat(ev.target.value);});
 c.tabIndex=0;c.addEventListener('keydown',(ev)=>{if(ev.key===' '){ev.preventDefault();this.toggle();}else if(ev.key==='ArrowRight'){ev.preventDefault();this.step(1);}else if(ev.key==='ArrowLeft'){ev.preventDefault();this.step(-1);}else if(ev.key==='Home'){this.goto(0,true);}});
 this.goto(0,true);
};
function stripHtml(h){const d=document.createElement('div');d.innerHTML=h;return d.textContent;}
Player.prototype.applyPersistent=function(upto){
 const m=this.built.map,steps=this.scene.steps||[];
 // reset persistent visibility to initial
 for(const id in m){const e=m[id].e;m[id].g.classList.toggle('hidden',!!e.hidden);}
 const sets={};for(let i=0;i<=upto;i++){const st=steps[i];if(!st)continue;(st.show||[]).forEach(id=>m[id]&&m[id].g.classList.remove('hidden'));(st.hide||[]).forEach(id=>m[id]&&m[id].g.classList.add('hidden'));if(st.set)for(const id in st.set){sets[id]=Object.assign(sets[id]||{},st.set[id]);}}
 for(const id in m){const x=m[id];if(x.e.type==='edge'){const a=m[x.e.from],b=m[x.e.to];if((a&&a.g.classList.contains('hidden'))||(b&&b.g.classList.contains('hidden')))x.g.classList.add('hidden');}}
 // reapply initial values then sets
 for(const id in m){const x=m[id],e=x.e;const v=sets[id];if(e.type==='bar')setBar(x,v&&v.value!==undefined?v.value:(e.value||0),v&&v.text!==undefined?v.text:e.text);
  else if(e.type==='mem')setMem(x,v&&v.segs?v.segs:(e.segs||[]));
  else if(e.type==='counter')x.v.textContent=String(v&&v.value!==undefined?v.value:(e.value!==undefined?e.value:''));
  else if(e.type==='tokens')setTokens(x,v&&v.items?v.items:(e.items||[]));
  else if(e.type==='grid')setGrid(x,v&&v.values?v.values:e.values);
  else if(e.type==='chart'){for(const sid in x.series){const base=(e.series.find(s=>s.id===sid)||{}).points||[];setSeries(x,sid,v&&v[sid]?v[sid]:base);}}
  else if(e.type==='timeline'){for(const k in x.cells){x.cells[k].forEach(q=>q.remove());}x.cells={};const all=[];for(let i=0;i<=upto;i++){const st=steps[i];if(st&&st.set&&st.set[id]&&st.set[id].cells)all.push(...st.set[id].cells);}setTimeline(x,all);}
  else if(e.type==='label'||e.type==='node'){if(v&&(v.text!==undefined||v.label!==undefined)){const t=x.g.querySelector('text');if(t){t.innerHTML='';const lines=String(v.text!==undefined?v.text:v.label).split('\n');lines.forEach((l,i)=>{const ts=el('tspan',{x:t.getAttribute('x'),dy:i?14:0},t);ts.textContent=l;});}}else{/* restore */const t=x.g.querySelector('text');if(t&&e.type==='label'){t.innerHTML='';String(e.text||'').split('\n').forEach((l,i)=>{const ts=el('tspan',{x:t.getAttribute('x'),dy:i?14:0},t);ts.textContent=l;});}else if(t&&e.type==='node'&&!e.sub){t.innerHTML='';String(e.label||'').split('\n').forEach((l,i)=>{const ts=el('tspan',{x:t.getAttribute('x'),dy:i?14:0},t);ts.textContent=l;});}}}
 }
};
Player.prototype.goto=function(i,fromUser){
 const steps=this.scene.steps||[];if(!steps.length)return;i=Math.max(0,Math.min(steps.length-1,i));const forward=i>this.idx;this.idx=i;const st=steps[i],m=this.built.map;
 this.applyPersistent(i);
 for(const id in m){STATE_CLASSES.forEach(c=>m[id].g.classList.remove(c));}
 STATE_CLASSES.forEach(c=>{(st[c]||[]).forEach(id=>{if(m[id])m[id].g.classList.add(c);});});
 if(st.cls)for(const id in st.cls){if(m[id])String(st.cls[id]).split(/\s+/).forEach(c=>c&&m[id].g.classList.add(c));}
 // edges highlighted get hl arrow marker
 for(const id in m){const x=m[id];if(x.path){x.path.setAttribute('marker-end',x.e.arrow===false?null:`url(#${x.g.classList.contains('hl')?'arrh':'arr'}-${this.scene.id})`);}}
 animatePackets(this.built,this.scene,st.packets,this.speed,this.reduced()||(!forward&&!fromUser));
 this.cap.innerHTML=`<b>Step ${i+1}/${steps.length}.</b> ${st.caption||''}`;
 this.ctr.querySelector('.step').textContent=`${i+1} / ${steps.length}`;this.ctr.querySelector('.prog i').style.width=((i+1)/steps.length*100)+'%';
 if(this.playing)this.schedule();
};
Player.prototype.step=function(d){this.pause();this.goto(this.idx+d,true);};
Player.prototype.schedule=function(){clearTimeout(this.timer);const st=this.scene.steps[this.idx];const dur=(st.dur||3000)/this.speed;this.timer=setTimeout(()=>{if(!this.playing)return;if(this.idx>=this.scene.steps.length-1){this.pause();return;}this.goto(this.idx+1);},dur);};
Player.prototype.play=function(){if(this.idx>=this.scene.steps.length-1)this.goto(0,true);this.playing=true;this.ctr.querySelector('[data-a=play]').textContent='❚❚ Pause';this.schedule();};
Player.prototype.pause=function(){this.playing=false;clearTimeout(this.timer);this.ctr.querySelector('[data-a=play]').textContent='▶ Play';};
Player.prototype.toggle=function(){this.playing?this.pause():this.play();};
Player.prototype.destroy=function(){this.pause();};

Anim.register=function(scene){if(!scene||!scene.id)throw new Error('scene needs id');Anim.scenes[scene.id]=scene;};
Anim.mount=function(container,id){if(container._player)return container._player;const scene=Anim.scenes[id];if(!scene){container.innerHTML=`<div class="callout warn"><b>Animation missing</b> id "${id}"</div>`;return null;}const p=new Player(scene,container);container._player=p;container.setAttribute('data-mounted','1');Anim.players.push(p);return p;};
// lazy mount all [data-anim] inside root
Anim.mountAll=function(root){root=root||document;const nodes=root.querySelectorAll('[data-anim]:not([data-mounted])');if(!nodes.length)return;const io=('IntersectionObserver' in window)?new IntersectionObserver(entries=>{entries.forEach(en=>{if(en.isIntersecting){const n=en.target;io.unobserve(n);n.setAttribute('data-mounted','1');Anim.mount(n,n.dataset.anim);}});},{rootMargin:'300px'}):null;nodes.forEach(n=>{n.style.minHeight='200px';if(io)io.observe(n);else{n.setAttribute('data-mounted','1');Anim.mount(n,n.dataset.anim);}});};
Anim.unmountAll=function(){Anim.players.forEach(p=>p.destroy());Anim.players=[];};
Anim.list=function(){return Object.values(Anim.scenes);};
// helper builders for writers
Anim.row=function(ids,labels,opts){opts=opts||{};const x0=opts.x||40,y=opts.y||100,w=opts.w||130,h=opts.h||56,gap=opts.gap||40;return ids.map((id,i)=>({type:'node',id,x:x0+i*(w+gap),y,w,h,label:labels[i],icon:opts.icons&&opts.icons[i],cls:opts.cls}));};
Anim.chainEdges=function(ids,opts){opts=opts||{};const out=[];for(let i=0;i<ids.length-1;i++)out.push({type:'edge',id:(opts.prefix||'e')+(i+1),from:ids[i],to:ids[i+1],label:opts.labels&&opts.labels[i]});return out;};
window.Anim=Anim;
})();
