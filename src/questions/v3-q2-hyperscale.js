/* Volume 3, Part 2, Chapter 11 — Questions: hyperscale, capacity and multi-region */
(function(){
const D=(t,spec,cap)=>fig(t,svgDiagram(spec),cap);

/* ---------- animations ---------- */
Anim.register({
  id:'v3q-hyper-10m', title:'10 million daily users → GPUs (every input ILLUSTRATIVE)', w:960, h:440,
  elements:[
    {type:'node', id:'dau', x:20, y:40, w:140, h:56, label:'10 M DAU', sub:'× 6 req/day', icon:'user'},
    {type:'node', id:'rps', x:190, y:40, w:140, h:56, label:'Peak RPS', sub:'× 4 peak factor', icon:'chart'},
    {type:'node', id:'tok', x:360, y:40, w:160, h:56, label:'Tokens/s', sub:'prefill + decode', icon:'bolt'},
    {type:'node', id:'rep', x:550, y:40, w:150, h:56, label:'Replicas', sub:'measured goodput', icon:'server'},
    {type:'node', id:'gpu', x:730, y:40, w:200, h:56, label:'GPUs + regions', sub:'headroom, failover', icon:'gpu'},
    {type:'edge', id:'e1', from:'dau', to:'rps'},{type:'edge', id:'e2', from:'rps', to:'tok'},{type:'edge', id:'e3', from:'tok', to:'rep'},{type:'edge', id:'e4', from:'rep', to:'gpu'},
    {type:'counter', id:'c1', x:30, y:150, label:'Requests', value:'—'},
    {type:'counter', id:'c2', x:30, y:220, label:'Prefill tokens/s (after 40 % prefix-cache hits)', value:'—'},
    {type:'counter', id:'c3', x:30, y:290, label:'Decode tokens/s', value:'—'},
    {type:'counter', id:'c4', x:500, y:150, label:'Replicas (4 × H100, 70B BF16, TP = 4)', value:'—'},
    {type:'counter', id:'c5', x:500, y:220, label:'Concurrency check (Little’s law)', value:'—'},
    {type:'counter', id:'c6', x:500, y:290, label:'Fleet', value:'—'},
    {type:'label', id:'warn', x:30, y:380, text:'All per-replica numbers must come from YOUR load test at YOUR SLO.', hidden:true}
  ],
  steps:[
    {caption:'10 M daily active users × 6 requests each = 60 M requests/day. Divide by 86,400 s: <b>694 requests/s</b> on average. Users are not concurrent sessions.', hl:['dau'], packets:[{edge:'e1'}], set:{c1:{value:'60 M/day → 694.4 req/s mean'}}, dur:4800},
    {caption:'Evening and Ramadan-night peaks: assume peak = 4 × mean → <b>2,778 requests/s</b>. Ask for the real peak factor; it changes everything linearly.', hl:['rps'], set:{c1:{value:'peak 4 × 694.4 = 2,777.8 req/s'}}, dur:4500},
    {caption:'Each request: 2,000 input tokens (system prompt + RAG + history), 300 output. 40 % of input is a shared, prefix-cached system prompt. Uncached prefill: 2,777.8 × 1,200 = <b>3.33 M tok/s</b>. Decode: 2,777.8 × 300 = <b>0.83 M tok/s</b>.', hl:['tok'], packets:[{edge:'e2'}], set:{c2:{value:'3,333,333 tok/s'}, c3:{value:'833,333 tok/s'}}, dur:5500},
    {caption:'The old method divided output tokens only by a tok/s figure. But prefill is 4× more tokens here and shares the same GPUs. With an illustrative replica that can do 8,000 prefill tok/s OR 4,000 decode tok/s, the shared-time estimate is 3.33 M ÷ 8,000 + 0.83 M ÷ 4,000 = 416.7 + 208.3 = <b>625 replicas</b>.', hl:['rep'], packets:[{edge:'e3'}], set:{c4:{value:'shared-time estimate: 625'}}, dur:6000},
    {caption:'Better: benchmark the real mix and read <b>goodput</b> — requests/s per replica while TTFT p95 ≤ 1.5 s and TPOT p95 ≤ 50 ms. Assume measured 4.5 req/s → 2,777.8 ÷ 4.5 = <b>617 replicas</b>. The two methods agree within about 1 %.', set:{c4:{value:'goodput method: 617.3'}}, ok:['rep'], dur:5500},
    {caption:'Little’s law check: W ≈ 0.8 s TTFT + 300 × 0.04 s = 12.8 s. L = λW = 2,777.8 × 12.8 ≈ <b>35,600 sequences</b> in flight → ≈ 46 per replica. KV capacity per replica ≈ 190 sequences, so KV is not the binding limit here.', set:{c5:{value:'35,556 in flight ≈ 46 / replica (KV cap ≈ 190)'}}, dur:5800},
    {caption:'Headroom: run at 80 % of measured goodput for bursts and forecast error → 617.3 ÷ 0.8 = <b>772 replicas</b> at peak. Then region loss: 3 regions each sized for 50 % of peak (so 2 survivors carry 100 %) = 3 × 386 = <b>1,158 replicas = 4,632 H100</b>.', hl:['gpu'], packets:[{edge:'e4'}], set:{c6:{value:'1,158 replicas = 4,632 GPUs = 579 nodes'}}, dur:6000},
    {caption:'Cost at the verified p5.48xlarge on-demand price ($55.04/h, us-east-1, AWS feed 2026-10-12): 579 × 55.04 × 730 h ≈ <b>$23.3 M/month</b>, ≈ $0.013 per request. That number is the reason to route easy traffic to small models, raise cache hits and use commitments — before buying GPUs.', show:['warn'], set:{c6:{value:'≈ $23.3 M/month on-demand (illustrative)'}}, warn:['gpu'], dur:6500}
  ]
});

Anim.register({
  id:'v3q-hyper-shed', title:'Goodput collapse without admission control', w:960, h:420,
  elements:[
    {type:'chart', id:'ch', x:90, y:40, w:520, h:260, xmax:200, ymax:120, xlabel:'offered load (% of capacity)', ylabel:'goodput (% of capacity)', series:[{id:'ideal',label:'ideal',points:[[0,0],[100,100],[200,100]]},{id:'none',label:'no shedding',points:[[0,0]]},{id:'shed',label:'with shedding',points:[[0,0]]}]},
    {type:'counter', id:'s', x:660, y:60, label:'Offered load', value:'—'},
    {type:'counter', id:'g', x:660, y:140, label:'Goodput (met SLO)', value:'—'},
    {type:'counter', id:'w', x:660, y:220, label:'What is happening', value:'—'}
  ],
  steps:[
    {caption:'Goodput counts only requests that finish within the SLO (e.g. TTFT p95 ≤ 1.5 s). The ideal curve rises with load until capacity, then stays flat.', dur:4200},
    {caption:'Below capacity, with or without shedding, every request meets the SLO: goodput = offered load.', set:{ch:{none:[[0,0],[60,60],[90,88]],shed:[[0,0],[60,60],[90,88]]}, s:{value:'90 %'}, g:{value:'88 %'}, w:{value:'queue short'}}, dur:4200},
    {caption:'At 130 % offered load <b>without</b> admission control, the queue grows without bound. Every request waits longer, so most miss the TTFT SLO — even though the GPUs are 100 % busy. Clients time out and <b>retry</b>, adding even more load.', set:{ch:{none:[[0,0],[60,60],[90,88],[110,80],[130,45]]}, s:{value:'130 %'}, g:{value:'45 % (no shedding)'}, w:{value:'queue explodes, retries'}}, bad:['ch'], dur:5500},
    {caption:'At 180 % goodput falls towards zero: the system does lots of work, but on requests that will be abandoned. This is congestion collapse.', set:{ch:{none:[[0,0],[60,60],[90,88],[110,80],[130,45],[180,10]]}, s:{value:'180 %'}, g:{value:'10 %'}, w:{value:'busy, useless work'}}, dur:5000},
    {caption:'<b>With</b> admission control: the gateway admits work only up to measured capacity (token-aware), keeps a short bounded queue with deadlines, and returns 429 with Retry-After for the rest, lowest priority first.', set:{ch:{shed:[[0,0],[60,60],[90,88],[110,95],[130,95],[180,94]]}, w:{value:'admit ≤ capacity, 429 the rest'}}, ok:['ch'], dur:5500},
    {caption:'Goodput stays near capacity at any load. Rejected users get a fast, honest answer instead of a 30 s timeout, and premium or critical flows are protected by priority. Shedding is a feature, not a failure.', set:{g:{value:'≈ 94 % (with shedding)'}}, dur:5000}
  ]
});

Anim.register({
  id:'v3q-hyper-region', title:'Losing a region: what failover really requires', w:960, h:420,
  elements:[
    {type:'node', id:'gslb', x:380, y:20, w:200, h:56, label:'Global routing', sub:'latency + residency', icon:'globe'},
    {type:'zone', id:'z1', x:20, y:120, w:290, h:220, label:'Region A'},
    {type:'zone', id:'z2', x:335, y:120, w:290, h:220, label:'Region B'},
    {type:'zone', id:'z3', x:650, y:120, w:290, h:220, label:'Region C'},
    {type:'bar', id:'a', x:50, y:190, w:230, h:24, label:'GPU load A', value:0.5},
    {type:'bar', id:'b', x:365, y:190, w:230, h:24, label:'GPU load B', value:0.5},
    {type:'bar', id:'c', x:680, y:190, w:230, h:24, label:'GPU load C', value:0.5},
    {type:'node', id:'ra', x:60, y:250, w:210, h:60, label:'386 replicas', sub:'weights + index local'},
    {type:'node', id:'rb', x:375, y:250, w:210, h:60, label:'386 replicas', sub:'weights + index local'},
    {type:'node', id:'rc', x:690, y:250, w:210, h:60, label:'386 replicas', sub:'weights + index local'},
    {type:'edge', id:'ea', from:'gslb', to:'ra'},{type:'edge', id:'eb', from:'gslb', to:'rb'},{type:'edge', id:'ec', from:'gslb', to:'rc'},
    {type:'counter', id:'n', x:20, y:370, label:'Status', value:'normal: each region at 50 % of its capacity'}
  ],
  steps:[
    {caption:'Three active regions, each sized at 50 % of global peak (386 replicas). In normal operation each runs at about half its capacity — that idle half is the price of surviving a region loss.', packets:[{edge:'ea'},{edge:'eb'},{edge:'ec'}], dur:5000},
    {caption:'Region A fails (provider outage or a bad config push). Health checks fail; global routing removes A within its detection time (DNS TTL, health-check interval).', bad:['ra','a'], set:{a:{value:0,text:'down'}, n:{value:'A lost — detection + routing change'}}, dur:5000},
    {caption:'A’s traffic moves to B and C: each now runs at 100 % of capacity. This only works because the capacity <b>already existed and was warm</b>. DNS failover does not create GPUs; a cold start would take minutes and might find no capacity.', set:{b:{value:1,text:'100 %'}, c:{value:1,text:'100 %'}, n:{value:'B, C at 100 % — headroom used up'}}, warn:['rb','rc'], packets:[{edge:'eb',count:2},{edge:'ec',count:2}], dur:5800},
    {caption:'What did <b>not</b> move: prefix/KV caches (cold in B and C for A’s users, so TTFT rises briefly), in-flight streams (failed), and any data that must stay in A’s jurisdiction — those users get a degraded or explicit unavailable response, not a residency violation.', hl:['gslb'], set:{n:{value:'caches cold, residency-bound traffic must not move'}}, dur:6000},
    {caption:'With only two regions, each must be sized for 100 % of peak to survive one loss: 2 × 772 = 1,544 replicas, versus 3 × 386 = 1,158 with three regions. More regions = less idle failover capacity, but more operational surface.', set:{n:{value:'2 regions: 1,544 replicas · 3 regions: 1,158'}}, dur:6000},
    {caption:'Drill it: a game day that drains a region on purpose, measuring detection time, error spike, TTFT in survivors and time back to normal. Untested failover is a hope, not a plan.', ok:['rb','rc'], set:{n:{value:'measure RTO in a game day'}}, dur:5000}
  ]
});

Anim.register({
  id:'v3q-hyper-gateway', title:'A request through a production AI gateway', w:960, h:420,
  elements:[
    {type:'node', id:'cl', x:20, y:160, w:120, h:56, label:'Client app', sub:'tenant key', icon:'user'},
    {type:'node', id:'auth', x:170, y:60, w:140, h:56, label:'AuthN/Z', sub:'tenant, model allow', icon:'key'},
    {type:'node', id:'quota', x:340, y:60, w:150, h:56, label:'Token quota', sub:'per tenant/model', icon:'money'},
    {type:'node', id:'pol', x:520, y:60, w:140, h:56, label:'Policy', sub:'PII, guardrails', icon:'shield'},
    {type:'node', id:'route', x:690, y:60, w:150, h:56, label:'Router', sub:'model, region, cache', icon:'gear'},
    {type:'node', id:'self', x:690, y:200, w:150, h:56, label:'Self-hosted pool', sub:'vLLM / llm-d', icon:'gpu'},
    {type:'node', id:'prov', x:690, y:310, w:150, h:56, label:'Provider API', sub:'fallback', icon:'cloud'},
    {type:'node', id:'meter', x:360, y:250, w:180, h:56, label:'Metering + audit', sub:'tokens, cost, OTel', icon:'chart'},
    {type:'edge', id:'e1', from:'cl', to:'auth'},{type:'edge', id:'e2', from:'auth', to:'quota'},{type:'edge', id:'e3', from:'quota', to:'pol'},{type:'edge', id:'e4', from:'pol', to:'route'},
    {type:'edge', id:'e5', from:'route', to:'self'},{type:'edge', id:'e6', from:'route', to:'prov', cls:'dash'},{type:'edge', id:'e7', from:'self', to:'meter'},
    {type:'counter', id:'st', x:20, y:370, label:'Step', value:'—'}
  ],
  steps:[
    {caption:'The client sends an OpenAI-compatible request with a tenant API key. The gateway is the single place where identity, quotas, policy, routing and metering are enforced — the model never sees credentials.', hl:['cl'], packets:[{edge:'e1'}], set:{st:{value:'authenticate tenant'}}, dur:4500},
    {caption:'AuthN/Z resolves the tenant and checks which models it may use. A tenant without access to the 70B model is refused here, not by the model.', hl:['auth'], packets:[{edge:'e2'}], set:{st:{value:'model entitlement'}}, dur:4300},
    {caption:'Token quota: limits are in tokens, not requests, because one request can be 100 tokens or 100,000. In Agent Router (formerly Envoy AI Gateway) the cost is computed from usage and charged after the response completes — a stream is not cut, but later requests get 429.', hl:['quota'], packets:[{edge:'e3'}], set:{st:{value:'token budget check'}}, dur:5800},
    {caption:'Policy: PII redaction for prompts leaving the region, input guardrails, max tokens per request, data-residency tags that restrict which backends are allowed.', hl:['pol'], packets:[{edge:'e4'}], set:{st:{value:'policy + residency'}}, dur:4800},
    {caption:'Routing picks the backend: the self-hosted pool in-region (with prefix-cache-aware endpoint picking via the Gateway API Inference Extension), or a provider as fallback if policy allows. Retries have a budget so failures do not multiply load.', hl:['route'], packets:[{edge:'e5'},{edge:'e6',delay:500,cls:'c-purple'}], set:{st:{value:'route + bounded retry/fallback'}}, dur:5500},
    {caption:'Metering and audit: input, cached and output tokens per tenant and model, latency, cost, and an OTel trace. This feeds showback, quota enforcement and SLO dashboards.', hl:['meter'], packets:[{edge:'e7'}], ok:['meter'], set:{st:{value:'meter, trace, audit'}}, dur:5000},
    {caption:'The gateway is now on every request path, so it must not become the outage: multiple replicas per zone, stateless with a shared rate-limit store, explicit fail-open or fail-closed decisions per policy, and its own SLO.', hl:['auth','quota','pol','route'], set:{st:{value:'gateway must be HA'}}, dur:5000}
  ]
});

/* ---------- chapter lesson ---------- */
registerLesson({
  id:'v3-ch-hyperscale', vol:3, part:2, num:11,
  title:'Questions: hyperscale, capacity and multi-region', minutes:60,
  summary:'This chapter is the interview bank for the biggest design questions: serving ten million users, running inference in several regions, building the AI gateway, and keeping goodput high when demand exceeds supply. Interviewers want a quantitative argument with labelled assumptions, both prefill and decode in the sizing, SLO-based goodput instead of raw throughput, and explicit headroom for bursts and region loss.',
  objectives:[
    'Size an LLM service from users to GPUs with prefill, decode, Little’s law, goodput and headroom, stating every assumption.',
    'Design multi-region inference with residency, failover capacity and degraded modes.',
    'Design a production AI gateway: token quotas, routing, fallback, metering and its own availability.',
    'Apply admission control and load shedding to protect goodput, and explain why utilisation near 100 % destroys latency.',
    'Design a self-service enterprise AI platform and disaster recovery for AI components.'
  ],
  prereqs:['v2-capacity-planning','v2-hyperscale-serving','v2-multi-region'],
  next:['v3-ch-aiops','v3-ch-finops','v3-prove-10m'],
  tags:['interview','capacity','hyperscale','multi-region','gateway'],
  html:`
<h2>What interviewers are really testing</h2>
<p>“Design for ten million users” is the most common architect question in AI-infrastructure interviews. It is not a trivia test. The interviewer watches whether you <b>clarify</b>, <b>calculate with stated assumptions</b>, <b>separate the kinds of work</b> (prefill versus decode), <b>respect the SLO</b> (goodput, not peak tokens per second), <b>plan for failure</b> (bursts, zone and region loss) and <b>connect cost</b> to the design. The rest of the chapter extends the same thinking to multi-region operation, gateways, admission control, disaster recovery and platform design.</p>
<ol>
<li><b>Translate demand</b>: users → requests → tokens (input and output, p50 and p95).</li>
<li><b>Translate supply</b>: measured per-replica goodput at the SLO, with KV/concurrency as a check.</li>
<li><b>Add headroom</b>: burst, forecast error, N+1, region loss.</li>
<li><b>Protect the SLO</b>: admission control, priorities, degradation, fallbacks.</li>
<li><b>Price it and pull levers</b>: routing to small models, caching, quantisation, commitments.</li>
</ol>

${D('Mental model: the capacity chain', {w:900,h:250,
 boxes:[
  {id:'u',x:20,y:90,w:120,h:60,label:'Users',sub:'DAU, peak factor'},
  {id:'r',x:170,y:90,w:120,h:60,label:'Requests/s',sub:'mean, peak'},
  {id:'t',x:320,y:90,w:140,h:60,label:'Tokens/s',sub:'prefill + decode',cls:'hl'},
  {id:'g',x:490,y:90,w:140,h:60,label:'Replicas',sub:'goodput at SLO'},
  {id:'h',x:660,y:90,w:110,h:60,label:'Headroom',sub:'burst, N+1, region'},
  {id:'c',x:800,y:90,w:80,h:60,label:'$',cls:'v2'}
 ],
 arrows:[{from:'u',to:'r'},{from:'r',to:'t'},{from:'t',to:'g'},{from:'g',to:'h'},{from:'h',to:'c'}]
}, 'Every arrow has an assumption you must say out loud.')}

<h2>Weak versus strong answers</h2>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“10 M users, peak output 1.39 M tokens/s, a replica does 2,500 tokens/s, so 556 replicas.” (The old Volume 3 workshop method.)</p></div><div class="good"><h4>Strong answer</h4><p>“Output-only sizing ignores prefill, which here is four times as many tokens and shares the same GPUs. I size from measured goodput with the real input/output mix at the TTFT and TPOT SLO, check concurrency with Little’s law and KV capacity, then add burst headroom and region-loss capacity.”</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“For multi-region we use DNS failover.”</p></div><div class="good"><h4>Strong answer</h4><p>“DNS moves traffic, not GPUs. Each surviving region must already have warm capacity for the moved load; caches are cold after failover; and residency-bound users must not be moved at all — they get a degraded mode.”</p></div></div>

<h2>Must-know numbers and formulas</h2>
${formula(`
mean RPS     = DAU × requests per DAU ÷ 86,400
peak RPS     = mean RPS × peak factor
prefill tok/s = peak RPS × uncached input tokens
decode tok/s  = peak RPS × output tokens

Little's law (stable system):   L = λ × W
  W ≈ TTFT + output tokens × TPOT

queueing intuition (single server):  wait ÷ service time = ρ ÷ (1 − ρ)
  ρ = 0.5 → 1     ρ = 0.8 → 4     ρ = 0.9 → 9     ρ = 0.95 → 19

region headroom:  N active regions surviving 1 loss
  each region sized for  peak ÷ (N − 1)
  total = N ÷ (N − 1) × peak      2 regions → 2.0×   3 → 1.5×   4 → 1.33×
`)}
${table(['Fact (as of Oct 2026)','Value'],[
 ['p5.48xlarge','8 × H100 80 GB, 3,200 Gbps EFA; on-demand $55.04/h us-east-1 (AWS price feed 2026-10-12)'],
 ['Llama-3.1-70B KV per token (BF16)','2 × 80 × 8 × 128 × 2 B = 327,680 B = 320 KiB'],
 ['AWS Capacity Blocks','reserve 1–14 days or multiples of 7 up to 182 days, up to 8 weeks ahead, no cancellation'],
 ['Saudi region status','GCP Dammam me-central2 live; AWS Saudi region announced, NOT open; Azure Saudi Arabia East announced for Nov 2026'],
 ['Gateway API Inference Extension','v1.6.x: InferencePool (v1); full endpoint picker moved to llm-d'],
 ['Agent Router (formerly Envoy AI Gateway)','v1.2.0; CRDs AIGatewayRoute, AIServiceBackend, QuotaPolicy, MCPRoute …; token-based rate limiting']
])}

<h2>How to use this chapter</h2>
<p>Practise the 10-million-user question on a whiteboard until you can do it in 15 minutes with every assumption boxed. Then practise the follow-ups: interviewers will change one assumption (peak factor, context length, region count) and watch you recompute. Background: ${L('v2-capacity-planning','capacity planning')}, ${L('v2-hyperscale-serving','queueing and admission')}, ${L('v2-multi-region','multi-region')}, ${L('v2-ai-gateway','AI gateway')}.</p>
`,
  quiz:[
    {q:'10 M DAU, 6 requests/day each, peak factor 4. What is peak RPS?',options:['≈ 694','≈ 2,778','≈ 69,444','≈ 10,000,000'],answer:1,explain:'60 M ÷ 86,400 = 694.4 mean; × 4 = 2,777.8. 694 is the mean, not the peak; DAU is not concurrency.'},
    {q:'Why is dividing output tokens/s by a replica’s tok/s an incomplete sizing method?',options:['It ignores network costs','It ignores prefill work (often most of the tokens), the SLO, concurrency limits and headroom','It overestimates decode','It is fine for LLMs'],answer:1,explain:'Prefill and decode compete for the same GPUs; with long RAG prompts prefill dominates. Sizing must use goodput at the SLO with the real mix.'},
    {q:'λ = 100 req/s and each request spends on average 8 s in the system. What does Little’s law give?',options:['12.5 requests in flight','800 requests in flight on average','800 GPUs needed','8 requests per second per GPU'],answer:1,explain:'L = λW = 100 × 8 = 800 in flight, for a stable system. It does not say how many GPUs or how they are batched.'},
    {q:'You run 2 active regions and must survive losing one. Each region must be sized for what share of global peak?',options:['50 %','75 %','100 %','150 %'],answer:2,explain:'Peak ÷ (N − 1) = 100 % with N = 2. Three regions need 50 % each (150 % total); that is why more regions reduce idle failover capacity.'},
    {q:'Offered load is 140 % of capacity. Which behaviour maximises goodput?',options:['Queue everything until it is served','Admit up to capacity with bounded queues and deadlines, reject the rest quickly by priority','Increase client timeouts','Retry failed requests immediately'],answer:1,explain:'Unbounded queues make every request late (goodput collapse); immediate retries add load. Shedding keeps admitted requests within SLO.'}
  ],
  flashcards:[
    {front:'Users → RPS',back:'mean = DAU × req/DAU ÷ 86,400; peak = mean × peak factor. DAU ≠ concurrent users.'},
    {front:'Why size prefill and decode separately?',back:'Different tokens counts and different bottlenecks (compute vs bandwidth) on the same GPUs; RAG prompts make prefill dominant.'},
    {front:'Goodput',back:'Throughput counting only requests that meet the SLO (e.g. TTFT and TPOT targets).'},
    {front:'Little’s law',back:'L = λW for a stable system: average in-flight = arrival rate × time in system. Not a GPU count.'},
    {front:'Region failover capacity',back:'Each of N regions sized for peak ÷ (N − 1). 2 regions: 2×; 3 regions: 1.5× total.'},
    {front:'Admission control for LLMs',back:'Token-aware admission, bounded queues with deadlines, priorities, 429 + Retry-After, retry budgets.'},
    {front:'AI gateway duties',back:'AuthN/Z, token quotas, policy/PII, routing and fallback, retries with budgets, streaming, metering, audit, OTel.'},
    {front:'ρ/(1 − ρ)',back:'Queue wait in units of service time for a single server: 0.8 → 4, 0.9 → 9, 0.95 → 19. Do not run GPUs at 95 % if latency matters.'}
  ]
});

/* ---------- questions ---------- */
registerQuestions([
{
  id:'hyper-01', chapter:'v3-ch-hyperscale', difficulty:3,
  title:'How would you serve 10 million daily users?',
  understand:'The flagship capacity question. The interviewer wants clarifying questions, a quantitative chain with every assumption labelled, prefill AND decode, SLO goodput, concurrency, headroom for bursts and region loss, a cost figure, and the architecture and levers that follow from the numbers.',
  short:'I would first pin down what “users” means: daily actives, requests per user, the peak factor, and the input and output token distributions, plus the latency SLO and regions. Then I calculate: for example 10 million users at six requests a day is 694 requests per second on average and about 2,800 at a four-times peak. With 2,000 input tokens of which 40 percent is a cached system prompt, and 300 output tokens, that is about 3.3 million prefill and 0.8 million decode tokens per second. I do not divide by a tokens-per-second number from a model card; I load-test the real mix and measure goodput — requests per second per replica that still meet the time-to-first-token and per-token targets. Then I check concurrency with Little’s law and KV memory, add burst headroom, size for losing a region, put a price on it, and show which levers — small-model routing, caching, shorter contexts — bring the cost down.',
  detailed:`
<h4>1. Clarify (ask, then write assumptions in a box)</h4>
${table(['Question','Assumption used (ILLUSTRATIVE)'],[
 ['Users = DAU? concurrent?','10 M daily active users'],
 ['Requests per active user per day','6'],
 ['Peak-to-mean factor','4 (GCC evening / Ramadan nights; get real data)'],
 ['Input tokens (system + RAG + history)','mean 2,000 (p95 higher); 40 % is a shared system prompt (prefix-cache hit)'],
 ['Output tokens','mean 300'],
 ['SLO','TTFT p95 ≤ 1.5 s, TPOT p95 ≤ 50 ms'],
 ['Model','70B-class dense (Llama-3.1-70B shape), BF16, TP = 4 on H100'],
 ['Regions / residency','3 active regions; residency-bound tenants pinned']
])}
<h4>2. Demand</h4>
${formula(`
STEP 1  daily requests  = 10,000,000 × 6            = 60,000,000
STEP 2  mean RPS        = 60,000,000 ÷ 86,400        = 694.4
STEP 3  peak RPS        = 694.4 × 4                  = 2,777.8
STEP 4  uncached input  = 2,000 × (1 − 0.40)         = 1,200 tokens/request
STEP 5  prefill tok/s   = 2,777.8 × 1,200            = 3,333,333
STEP 6  decode tok/s    = 2,777.8 × 300              =   833,333
`)}
<h4>3. Supply per replica (must be measured)</h4>
${formula(`
replica = 4 × H100 80 GB (TP = 4)
weights = 70.6 × 10⁹ × 2 B ≈ 141 GB
usable  = 0.90 × 320 GB = 288 GB;  activations/graphs ≈ 12 GB (assume; measure)
KV budget ≈ 288 − 141 − 12 = 135 GB
KV per token = 320 KiB = 327,680 B
avg live tokens per sequence ≈ 2,000 + 300 ÷ 2 = 2,150
KV per sequence ≈ 2,150 × 327,680 B ≈ 0.70 GB
KV-bound concurrency ≈ 135 ÷ 0.70 ≈ 190 sequences per replica
`)}
<p>Load test (e.g. <code>vllm bench serve</code> with the real length distribution and <code>--goodput ttft:1500 tpot:50</code>) gives goodput. Assume it measures <b>4.5 req/s per replica</b> at SLO (ILLUSTRATIVE).</p>
<p>Sanity check by shared GPU time, with illustrative capacities of 8,000 prefill tok/s or 4,000 decode tok/s per replica: 3,333,333 ÷ 8,000 + 833,333 ÷ 4,000 = 416.7 + 208.3 = 625 replicas — consistent with 2,777.8 ÷ 4.5 = 617.3.</p>
<h4>4. Concurrency check (Little’s law)</h4>
${formula(`
W ≈ TTFT + output × TPOT = 0.8 + 300 × 0.04 = 12.8 s       (measured means)
L = λ × W = 2,777.8 × 12.8 ≈ 35,556 sequences in flight
per replica ≈ 35,556 ÷ 772 ≈ 46   ≪ 190 KV-bound  → KV not binding here
`)}
<p>(If contexts were 32k tokens, KV per sequence would be ≈ 10.7 GB and the KV bound ≈ 12 sequences — then KV, not compute, would set the replica count.)</p>
<h4>5. Headroom and regions</h4>
${formula(`
STEP 1  run at 80 % of measured goodput:   617.3 ÷ 0.8 = 771.6 → 772 replicas
STEP 2  3 regions, survive loss of one:     each = 772 ÷ 2 = 386
STEP 3  total = 3 × 386 = 1,158 replicas = 4,632 H100 = 579 p5.48xlarge
        (2 regions would need 2 × 772 = 1,544 replicas)
`)}
<h4>6. Cost (on-demand, illustrative)</h4>
${formula(`
579 nodes × $55.04/h × 730 h ≈ $23.3 M per month
monthly requests ≈ 60 M × 30.4 ≈ 1.83 × 10⁹
cost per request ≈ $0.0127
`)}
<h4>7. Levers (each must be re-measured)</h4>
${table(['Lever','Effect'],[
 ['Route simple intents (FAQ, status) to an 8B model','Large share of traffic at a fraction of GPU cost'],
 ['Raise prefix-cache hits; cache-aware routing','Cuts uncached prefill (the dominant work here)'],
 ['Trim RAG context (2,000 → 1,200 tokens)','Prefill and KV fall proportionally'],
 ['FP8 weights / KV (validated)','More KV, higher throughput per GPU'],
 ['Scale down off-peak (mean is ¼ of peak)','Pay for peak only when needed, if capacity can be released'],
 ['Reservations / committed use for the baseline','Lower unit price for always-on capacity'],
 ['Disaggregated prefill/decode','Tune each pool to its bottleneck (when scale justifies complexity)']
])}
<h4>8. Architecture</h4>
<p>Edge (WAF, auth) → regional AI gateway (tenant keys, token quotas, policy, routing, metering) → router with prefix-aware endpoint picking → model pools by size and context class (8B, 70B, long-context) → RAG services → observability (TTFT/TPOT, queue, KV, goodput, cost per successful request). Admission control and degraded modes at the gateway.</p>
<h4>9. Audit note</h4>
<p>The old Volume 3 workshop computed 60 M requests, 694.4 mean and 5,555.6 peak RPS (8×), then divided 1,388,889 output tok/s by 2,500 tok/s to get 556 replicas. The arithmetic is right but the method ignores prefill (3.9 M input tok/s in that example), the SLO and concurrency. This answer replaces it.</p>
<p>[If you have run a load test yourself, quote your measured goodput here: “In my lab, an 8B model on one L40S sustained X req/s at TTFT p95 ≤ Y.” If not, say clearly that the per-replica figures are assumptions you would measure first.]</p>`,
  diagram:anim('v3q-hyper-10m'),
  followups:[
    {q:'The interviewer changes the peak factor from 4 to 8. What changes?',a:'Peak RPS doubles to 5,555.6 and everything downstream scales linearly: ≈ 2,316 replicas for 3 regions. Then I would challenge whether 8× is real and whether some peak traffic can be deferred, shed or served by a smaller model.'},
    {q:'Context grows to 32k tokens for a document feature. What breaks first?',a:'Prefill per request rises 16× and KV per sequence ≈ 32,768 × 320 KiB ≈ 10.7 GB, so only ≈ 12 concurrent long sequences per replica. I would isolate a long-context pool with its own SLO and quota, and use prefix caching for shared documents.'},
    {q:'How confident are you in 4.5 req/s per replica?',a:'Not at all until measured. I would give a range (e.g. 3–6 req/s), show the replica range it implies (≈ 460–930 before headroom), and commit to a pilot benchmark with production length distributions before buying capacity.'},
    {q:'How would disaggregated prefill/decode change the plan?',a:'Separate pools: prefill sized on 3.33 M uncached tok/s at the TTFT SLO, decode sized on 0.83 M tok/s and concurrency at the TPOT SLO, plus KV transfer bandwidth between them. It helps when prefill interference hurts TPOT; it adds network and operational complexity.'},
    {q:'What would you present to the CFO?',a:'Cost per successful request today, the fleet cost range under stated assumptions, the three biggest levers with estimated savings, and the decision points (commit to reservations after a 4-week pilot).'}
  ],
  tradeoffs:`<ul><li>Higher utilisation targets save GPUs but shrink burst tolerance and raise tail latency (ρ/(1 − ρ)).</li><li>More regions reduce failover over-provisioning (2.0× → 1.5×) but add operational surface and residency complexity.</li><li>Big-model-for-everything is simplest; routing to small models saves the most money but needs a reliable classifier and quality evaluation per route.</li></ul>`,
  failures:`${table(['Scenario','What happens','Design response'],[
   ['Burst beyond 80 % headroom','Queue and TTFT rise','Admission control, priority shedding, fallback to small model'],
   ['Region loss','Survivors at 100 %','Pre-sized capacity, cold-cache TTFT spike accepted'],
   ['Prompt length creep (new RAG feature)','Goodput per replica falls silently','Track tokens per request; re-benchmark on change'],
   ['Capacity unavailable for scale-out','Pending pods','Reservations for baseline, multi-type NodePools']
  ])}`,
  vocab:[
   {term:'goodput',def:'Requests per second that meet the latency SLO; the right capacity unit.'},
   {term:'peak factor',def:'Ratio of peak-hour request rate to the daily mean.'},
   {term:'prefill / decode',def:'Processing the input prompt (compute-heavy) vs generating output tokens one by one (bandwidth-heavy).'},
   {term:'Little’s law',def:'L = λW: in a stable system, average items in system = arrival rate × average time in system.'},
   {term:'N+1 / region headroom',def:'Spare capacity so the loss of one unit (zone, region) still meets demand.'},
   {term:'cost per successful request',def:'Total cost divided by requests that met SLO and quality.'}
  ],
  mistakes:['Treating 10 M users as 10 M concurrent sessions.','Sizing from output tokens only.','Using a model-card tokens/s as capacity.','Forgetting region-loss capacity or burst headroom.','Giving a single number with no assumptions or range.'],
  related:['v2-capacity-planning','v2-hyperscale-serving','v2-multi-region','v3-prove-10m']
},
{
  id:'hyper-02', chapter:'v3-ch-hyperscale', difficulty:3,
  title:'How would you operate AI inference across multiple regions?',
  understand:'The interviewer wants routing logic (latency, residency, capacity), failover sizing, artifact and config consistency, what does not fail over (caches, residency-bound data), and how you test it.',
  short:'I run each region as a self-sufficient serving cell: its own gateway, model pools, retrieval index replica and observability, with model weights and configuration replicated from one signed source so every region runs the same release. Global routing sends users to the nearest allowed region, considering latency, data residency and current capacity. Residency comes first: if a Saudi tenant’s data must stay in-Kingdom, its requests are never moved, even in an outage — they get a degraded mode. Failover only works if survivors already have warm capacity, so I size regions for the loss of one. I keep releases region by region with canaries, watch per-region SLOs, and prove failover with game days that drain a region on purpose.',
  detailed:`
<h4>Cell architecture</h4>
${table(['Component','Per region','Global'],[
 ['Gateway + quotas','Yes (rate-limit store per region or global with care)','Tenant config replicated'],
 ['Model pools','Yes; same bundle versions','Release orchestration'],
 ['Weights / images','Regional registry mirror','Signed source of truth'],
 ['RAG index','Regional replica (or regional corpus if residency)','Ingestion fan-out'],
 ['Prefix/KV caches','Local only — never replicated','—'],
 ['Observability','Regional collection','Global SLO view'],
 ['Conversation state','Regional; residency-tagged','Only replicated where allowed']
])}
<h4>Routing policy order</h4>
<ol><li><b>Residency</b>: allowed regions for this tenant/data class.</li><li><b>Health</b>: exclude failing regions.</li><li><b>Capacity</b>: avoid regions with queue/KV saturation (shed rather than overflow into a disallowed region).</li><li><b>Latency</b>: nearest remaining.</li></ol>
<h4>Failover sizing</h4>
${formula(`
N active regions, survive 1 loss → each sized for peak ÷ (N − 1)
2 regions → each 100 % of peak (total 2.0×)
3 regions → each  50 % of peak (total 1.5×)
`)}
<p>GPU capacity is often asymmetric across regions (some regions have no H100s or limited quota), so “N equal regions” may not exist; then you plan region pairs or a degraded model in the smaller region.</p>
<h4>GCC residency facts (as of 14 Oct 2026)</h4>
<p>Saudi PDPL in force since 14 Sep 2023 (compliance expected from 14 Sep 2024), regulated by SDAIA, with transfer regulations. Google Cloud Dammam (me-central2) is live. AWS has announced Saudi regions but they were not open as of 14 Oct 2026. Microsoft announced Azure “Saudi Arabia East” for November 2026. So the in-Kingdom GPU option depends on provider and on GPU availability in that region — verify both.</p>
<h4>Version skew</h4>
<p>Roll out region by region (canary region first). Gateway must route a conversation to the same model version; cross-region failover may switch versions — acceptable only if both are approved.</p>
<h4>Testing</h4>
<p>Game days: drain a region via routing weights; measure detection time, error spike, survivor TTFT, cache warm-up, time to recover. Repeat quarterly.</p>`,
  diagram:anim('v3q-hyper-region'),
  followups:[
    {q:'Active-active or active-passive for GPUs?',a:'Active-passive wastes a whole warm GPU fleet (or relies on a cold start that may find no capacity). Active-active with N ≥ 3 uses failover capacity efficiently and keeps it proven by real traffic. Passive can make sense for a small DR footprint running a smaller model.'},
    {q:'A region loses capacity, not health — e.g. GPU nodes cannot scale. What do you do?',a:'Routing weights by capacity signals (queue depth, shed rate), overflow only to allowed regions, and degrade (smaller model, shorter context) for residency-bound traffic.'},
    {q:'How do you keep RAG indexes consistent across regions?',a:'Ingestion publishes events to each region’s indexer; each region reports its index version and freshness lag; routing can prefer regions within freshness SLO. For residency-bound corpora there is no cross-region copy.'},
    {q:'What breaks in a region failover that people forget?',a:'Prefix caches (TTFT spike), rate-limit counters, in-flight streams, sticky sessions, provider API keys scoped per region, and DNS TTLs in client libraries.'}
  ],
  tradeoffs:`<ul><li>More regions: lower failover overhead and latency, but more ops and residency combinations.</li><li>Global rate limits are fair but add cross-region latency; regional limits with periodic reconciliation are cheaper.</li><li>Moving traffic preserves availability but may breach residency — policy decides, not the load balancer.</li></ul>`,
  failures:`<ul><li>Failover sends KSA traffic abroad → routing ignored residency tags → residency check first in the policy chain.</li><li>Survivors overload after failover → regions sized for normal load only → size for peak ÷ (N − 1).</li><li>Different answers per region → version skew → release orchestration and version pinning per conversation.</li></ul>`,
  vocab:[
   {term:'cell architecture',def:'Independent, self-sufficient deployments (cells) that limit blast radius.'},
   {term:'active-active',def:'All regions serve traffic and absorb each other’s load on failure.'},
   {term:'data residency',def:'Requirement that certain data stays within a jurisdiction.'},
   {term:'game day',def:'Planned failure exercise to verify recovery behaviour and timings.'},
   {term:'version skew',def:'Different regions or replicas running different releases at the same time.'}
  ],
  mistakes:['“DNS failover” as the whole answer.','Assuming GPUs exist in every region you want.','Replicating caches across regions.','Never testing failover.'],
  related:['v2-multi-region','v2-governance','v2-hyperscale-serving']
},
{
  id:'hyper-03', chapter:'v3-ch-hyperscale', difficulty:3,
  title:'How would you implement a production AI gateway?',
  understand:'The interviewer checks that you know what belongs in the gateway (and what does not), token-aware quotas, routing and fallback with retry budgets, streaming, metering, security, and the gateway’s own availability.',
  short:'The gateway is the control point between every application and every model. It authenticates the calling app and tenant, checks model entitlements, enforces quotas in tokens rather than requests, applies policy such as PII redaction and residency rules, and routes to the right backend — a self-hosted pool, using prefix-aware endpoint picking, or an external provider — with bounded retries and policy-approved fallbacks. It streams responses, meters input, cached and output tokens per tenant for cost and quotas, and emits traces. I would build it on a proven proxy, for example Envoy with Agent Router — formerly Envoy AI Gateway — or an equivalent, rather than writing one, and run it as a highly available, stateless tier with its own SLO, because it is now on every request path.',
  detailed:`
<h4>Responsibilities</h4>
${table(['Function','Detail'],[
 ['AuthN/Z','App/tenant keys or OIDC; model allow-lists per tenant'],
 ['Quotas','Tokens per minute/day per tenant and model; concurrency caps; separate input/output budgets'],
 ['Policy','PII redaction, prompt/response guardrails, max tokens, residency tags'],
 ['Routing','Model aliases (“chat-default” → versioned backend), region, cost tier; A/B and canary weights'],
 ['Resilience','Timeouts, retry budget (e.g. ≤ 10 % extra), circuit breakers, fallback chain approved per task class'],
 ['Streaming','SSE pass-through, backpressure, client disconnect cancels backend generation'],
 ['Caching','Exact response cache for safe public content; provider prompt caching headers'],
 ['Metering','Input, cached, output tokens; latency; cost; per tenant'],
 ['Observability','OTel traces with gen_ai.* attributes (Development status)']
])}
<h4>Token-based rate limiting (verified behaviour, Agent Router v1.2)</h4>
<p>AIGatewayRoute <code>llmRequestCosts</code> declares how to compute cost (InputToken, CachedInputToken, OutputToken, TotalToken or a CEL expression); Envoy Gateway’s global rate limiting enforces it per header-selected client (e.g. tenant id). Cost is charged <b>after</b> the response completes: an in-progress stream is not cut off, later requests get 429. Design implication: allow some overshoot, and cap max_tokens per request so one request cannot blow the budget.</p>
<h4>Kubernetes building blocks (as of Oct 2026)</h4>
<ul><li>Gateway API v1.6.x (HTTPRoute, GRPCRoute … GA).</li><li>Gateway API Inference Extension: InferencePool as an “LLM-optimised Service” with an endpoint picker via ext-proc (full EPP now in llm-d).</li><li>Agent Router CRDs: AIGatewayRoute, AIServiceBackend, BackendSecurityPolicy, QuotaPolicy, MCPRoute.</li></ul>
<h4>Availability of the gateway itself</h4>
<p>Stateless replicas in every zone; rate-limit store HA; config via GitOps; fail-closed for auth and residency, fail-open (with alert) for non-critical enrichment like analytics; its own latency budget (single-digit ms overhead target); load tests including streaming connections.</p>`,
  diagram:anim('v3q-hyper-gateway'),
  followups:[
    {q:'Why limit tokens instead of requests?',a:'Cost and GPU load scale with tokens; a request can be 100 or 100,000 tokens. Request limits let one tenant consume most capacity with long prompts.'},
    {q:'How do you design fallbacks safely?',a:'Per task class: e.g. customer chat may fall back from 70B to an evaluated 8B; refund decisions may not fall back to an unvalidated model and must return “temporarily unavailable”. Fallbacks are tested in evaluation, not improvised.'},
    {q:'What happens when the client disconnects mid-stream?',a:'The gateway must propagate cancellation to the backend so the engine stops generating; otherwise GPUs keep producing tokens nobody reads, wasting capacity.'},
    {q:'Build vs buy?',a:'Buy/adopt the proxy layer (Envoy-based, LiteLLM-style, or a managed gateway); build the policy configuration, tenant onboarding and metering integration that are specific to us.'}
  ],
  tradeoffs:`<ul><li>A central gateway gives control and visibility but adds a hop and a critical dependency.</li><li>Global token counters are accurate but add latency; local counters with sync are faster but allow overshoot.</li><li>Fail-closed is safer; fail-open is more available — decide per policy.</li></ul>`,
  failures:`<ul><li>Retry storm during provider outage → no retry budget → budgets and circuit breakers.</li><li>One tenant exhausts shared pool → request-based limits → token quotas and concurrency caps.</li><li>Gateway outage takes down all AI features → single deployment → multi-zone, canaried config changes.</li></ul>`,
  vocab:[
   {term:'token quota',def:'Limit on tokens consumed per tenant/model per time window.'},
   {term:'retry budget',def:'Cap on retries as a fraction of requests, preventing retry storms.'},
   {term:'InferencePool',def:'Gateway API Inference Extension resource grouping model-server endpoints for smart endpoint picking.'},
   {term:'endpoint picker (EPP)',def:'ext-proc service that chooses a model-server pod using metrics such as queue and prefix-cache state.'},
   {term:'circuit breaker',def:'Stops sending to a failing backend for a period to let it recover.'}
  ],
  mistakes:['Rate-limiting only by requests.','Unlimited retries.','No cancellation propagation on disconnect.','Treating the gateway as non-critical infrastructure.'],
  related:['v2-ai-gateway','v2-platform-architecture','v2-finops-unit-economics']
},
{
  id:'hyper-04', chapter:'v3-ch-hyperscale', difficulty:2,
  title:'Explain admission control and load shedding for LLM serving.',
  understand:'The interviewer wants to know that you protect goodput under overload, understand why unbounded queues collapse, and can design token-aware, priority-based shedding.',
  short:'When demand exceeds capacity, something must wait or be refused. If everything waits in an unbounded queue, every request gets slow, most miss the SLO, clients retry, and goodput collapses even though the GPUs are busy. Admission control decides up front what the system can finish in time. For LLMs that has to be token-aware: a 30,000-token prompt costs far more than a 300-token one. I keep queues short with deadlines, admit by priority — paid tiers and critical flows first — and reject the rest quickly with 429 and Retry-After, with client retry budgets so rejections do not become a retry storm. Engines also have their own limits, like maximum running sequences, but the gateway is where policy and priority live.',
  detailed:`
<h4>Why queues collapse</h4>
${formula(`
single-server intuition:  waiting time ÷ service time = ρ ÷ (1 − ρ)
  ρ = 0.70 → 2.3     ρ = 0.90 → 9     ρ = 0.95 → 19    ρ ≥ 1 → unbounded
`)}
<p>An LLM replica is not a single server (it batches), but the shape is the same: near saturation, waiting dominates. Above saturation the queue grows without limit.</p>
<h4>Mechanisms</h4>
${table(['Layer','Mechanism'],[
 ['Client','Timeouts, retry budgets with jittered backoff, honour Retry-After'],
 ['Gateway','Token-aware admission (estimated input + max_tokens), per-tenant concurrency caps, priority classes, deadline-aware queue, 429 + Retry-After'],
 ['Router','Avoid saturated replicas (queue depth, KV usage)'],
 ['Engine','max-num-seqs, max-num-batched-tokens, max-model-len; scheduler queues; preemption'],
 ['Product','Degraded modes: shorter answers, smaller model, async (“we will email you”)']
])}
<h4>Token-aware cost estimate</h4>
${formula(`
admission cost ≈ input_tokens × w_prefill + max_tokens × w_decode
admit if  Σ cost of in-flight + new ≤ capacity budget (calibrated by load test)
`)}
<h4>Priorities (illustrative)</h4>
<ol><li>Safety-critical and booking flows.</li><li>Paying / enterprise tenants within quota.</li><li>Free tier and internal batch.</li></ol>
<p>Shed from the bottom first; batch traffic should never compete with interactive traffic in the same queue.</p>
<h4>Signals</h4>
<p><code>vllm:num_requests_waiting</code>, <code>vllm:request_queue_time_seconds</code>, KV usage, gateway 429 rate by tenant and priority, goodput.</p>`,
  diagram:anim('v3q-hyper-shed'),
  followups:[
    {q:'Is rejecting users ever acceptable?',a:'Yes — a fast 429 is better than a 30-second timeout that also wastes GPU work. The business decides priorities; engineering makes overload behaviour explicit instead of accidental.'},
    {q:'How do you set the admission threshold?',a:'From load tests: the in-flight token budget at which TTFT p95 hits the SLO, minus a margin. Re-derive after model or engine changes, and adapt dynamically from observed queue time.'},
    {q:'How does this interact with autoscaling?',a:'Shedding protects the SLO during the minutes autoscaling needs; shed rate is also a scale-out signal. Without shedding, autoscaling arrives after the damage.'},
    {q:'How would you avoid starving low-priority tenants forever?',a:'Weighted fair queuing with minimum shares, time-based aging, or reserved capacity for each class.'}
  ],
  tradeoffs:`<ul><li>Strict admission keeps SLOs but rejects more; loose admission serves more but risks collapse.</li><li>Estimating token cost before generation is approximate (max_tokens is an upper bound); tighter caps improve estimates but limit answers.</li></ul>`,
  failures:`<ul><li>Retry storm after brief overload → clients retry immediately → retry budgets, Retry-After.</li><li>Long-prompt tenant starves others → request-count limits → token-aware admission.</li><li>Engine preempting constantly → admitted too many sequences → lower max-num-seqs, gateway caps.</li></ul>`,
  vocab:[
   {term:'admission control',def:'Deciding whether to accept work based on available capacity and policy.'},
   {term:'load shedding',def:'Deliberately rejecting some requests under overload to protect the rest.'},
   {term:'congestion collapse',def:'State where throughput of useful work falls as offered load rises.'},
   {term:'Retry-After',def:'HTTP header telling clients when to retry.'},
   {term:'deadline-aware queue',def:'Queue that drops requests that can no longer meet their deadline.'}
  ],
  mistakes:['Infinite queues “so nobody is rejected”.','Request-count limits only.','Letting batch jobs share the interactive queue.','Retrying immediately on 429.'],
  related:['v2-hyperscale-serving','v2-ai-gateway','v1-batching']
},
{
  id:'hyper-05', chapter:'v3-ch-hyperscale', difficulty:1,
  title:'What is Little’s law and how do you use it for LLM serving?',
  understand:'The interviewer checks you can apply L = λW correctly, know its assumptions, and connect it to concurrency, KV capacity and queueing — without over-claiming.',
  short:'Little’s law says that in a stable system the average number of requests inside equals the arrival rate times the average time each spends inside: L equals lambda times W. For an LLM service, W is roughly time to first token plus output tokens times time per output token. So at 100 requests per second and an average 12 seconds per request, about 1,200 requests are in flight. That tells me how many concurrent sequences my fleet must hold, which I compare with KV-cache capacity per replica. It does not tell me how fast each GPU is, or how many GPUs I need by itself, and it only holds when the system is stable — if arrivals exceed capacity, the queue and W grow without bound.',
  detailed:`
<h4>Worked example</h4>
${formula(`
λ = 100 requests/s
W = TTFT + output × TPOT = 0.6 s + 400 × 0.03 s = 12.6 s
L = λ × W = 100 × 12.6 = 1,260 requests in the system on average

KV check (8B shape, 128 KiB/token, avg 3,000 live tokens):
  KV per sequence = 3,000 × 131,072 B ≈ 393 MB
  a replica with 48 GB KV budget holds ≈ 48 ÷ 0.393 ≈ 122 sequences
  replicas needed for concurrency ≥ 1,260 ÷ 122 ≈ 10.3 → 11 (before headroom)
`)}
<h4>What it does and does not say</h4>
<ul><li>✔ Average in-flight work for a given latency and arrival rate.</li><li>✔ Relationship: if W doubles (longer answers), L doubles.</li><li>✘ Not percentiles: p95 concurrency is higher.</li><li>✘ Not service capacity: whether 122 sequences per replica still meet TPOT must be measured.</li><li>✘ Only for stable systems (arrival rate below capacity over the window).</li></ul>
<h4>Using it backwards</h4>
<p>If a replica can hold 122 sequences at SLO and each lasts 12.6 s, its maximum stable throughput is ≈ 122 ÷ 12.6 ≈ 9.7 req/s — a cross-check for load-test results.</p>`,
  diagram:D('L = λ × W for an LLM service', {w:900,h:250,
   boxes:[
    {id:'in',x:20,y:90,w:170,h:60,label:'Arrivals λ',sub:'100 req/s'},
    {id:'sys',x:260,y:60,w:340,h:120,label:'In system: L = 1,260',sub:'queue + prefill + decode',cls:'hl'},
    {id:'out',x:680,y:90,w:200,h:60,label:'Departures',sub:'W = 12.6 s each'}
   ],
   arrows:[{from:'in',to:'sys'},{from:'sys',to:'out'}]
  }, 'Long answers raise W and therefore the concurrency you must hold in KV memory.'),
  followups:[
    {q:'Why does halving output length help capacity twice?',a:'It cuts decode work per request and also W, so L (concurrent sequences, KV) roughly halves — more headroom on both compute and memory.'},
    {q:'Why is Little’s law not enough to size GPUs?',a:'It gives concurrency, not per-replica speed at that concurrency. Batching changes TPOT with batch size, so you still need a load test to find goodput.'},
    {q:'What happens to L during overload?',a:'Arrivals exceed departures, the queue grows, W grows, L grows without bound — the law describes the unstable outcome but you must prevent it with admission control.'}
  ],
  tradeoffs:`<ul><li>Simple and assumption-light, but averages only; use percentiles and simulation for tails.</li></ul>`,
  failures:`<ul><li>Capacity plan based on mean W fails at p95 → plan with distribution, not mean.</li><li>Using Little’s law during an incident with growing queue → not stable → look at queue growth rate instead.</li></ul>`,
  vocab:[
   {term:'arrival rate (λ)',def:'Average requests per unit time entering the system.'},
   {term:'time in system (W)',def:'Average total time a request spends queued and being served.'},
   {term:'stable system',def:'Long-run arrival rate below service capacity, so the queue does not grow without bound.'},
   {term:'concurrency',def:'Number of requests in progress at a moment.'}
  ],
  mistakes:['Saying Little’s law gives the number of GPUs.','Using it in an unstable (overloaded) system.','Using mean W to plan tail behaviour.','Confusing DAU with L.'],
  related:['v2-capacity-planning','v2-hyperscale-serving','v1-kv-cache']
},
{
  id:'hyper-06', chapter:'v3-ch-hyperscale', difficulty:2,
  title:'Traffic suddenly rises 5× and new GPU pods take minutes to start. What do you do?',
  understand:'An incident-style capacity question. The interviewer wants immediate protection of the SLO, use of existing headroom, degradation options, and follow-up improvements — not “HPA will handle it”.',
  short:'In the first minutes autoscaling cannot help, because a new replica needs a node, an image, weights and warm-up. So I protect the service with what exists: admission control at the gateway to keep queues bounded, priority for critical and paying flows, and quick 429s for the rest. I use any warm buffer and shift eligible traffic to other allowed regions or to a smaller fallback model for simple intents, and I can temporarily cap context length or answer length. In parallel I trigger scale-out and capacity requests. Afterwards I ask why the burst was not forecast — a campaign, a holiday, a bot — and add scheduled pre-warming, bigger warm pools, or bot controls.',
  detailed:`
<h4>Timeline</h4>
${table(['Time','Action'],[
 ['0–2 min','Detect: queue depth, TTFT p95, shed rate. Confirm it is real demand, not a retry storm or bot.'],
 ['0–5 min','Protect: gateway admission caps at measured goodput; priorities; 429 + Retry-After; tighten max_tokens; route simple intents to small model'],
 ['0–10 min','Absorb: warm pool, other allowed regions, provider fallback if policy allows'],
 ['5–15 min','Add: scale-out completes for whatever capacity exists; watch Pending pods'],
 ['After','Root cause: campaign, holiday, bot; forecast + scheduled pre-scaling; capacity reservations']
])}
<h4>Numbers (illustrative)</h4>
${formula(`
normal peak 1,000 req/s, fleet goodput 1,250 req/s (80 % target)
burst 5,000 req/s
capacity shortfall = 5,000 − 1,250 = 3,750 req/s
50 % of traffic is simple intents: 2,500 req/s → small model on spare GPUs
  (assume the small-model pool can absorb it)
remaining big-model demand 2,500 vs capacity 1,250 → shed or defer ≈ 1,250 req/s
`)}
<h4>Retry storm check</h4>
<p>A 5× rise right after an error spike is often clients retrying. Look at unique users vs requests and retry headers; enforce retry budgets.</p>`,
  diagram:D('Burst response layers', {w:900,h:270,
   boxes:[
    {id:'b',x:20,y:100,w:140,h:60,label:'5× burst',cls:'bad'},
    {id:'a',x:200,y:20,w:200,h:56,label:'Admission + priority',sub:'seconds',cls:'hl'},
    {id:'d',x:200,y:100,w:200,h:56,label:'Degrade / fallback',sub:'small model, shorter'},
    {id:'w',x:200,y:180,w:200,h:56,label:'Warm pool + regions',sub:'minutes'},
    {id:'s',x:460,y:100,w:180,h:56,label:'Scale-out',sub:'5–10 min'},
    {id:'f',x:700,y:100,w:180,h:56,label:'Forecast + prewarm',sub:'next time',cls:'ok'}
   ],
   arrows:[{from:'b',to:'a'},{from:'b',to:'d'},{from:'b',to:'w'},{from:'a',to:'s',cls:'dash'},{from:'s',to:'f',cls:'dash'}]
  }, 'Seconds: admission. Minutes: warm capacity and degradation. Later: forecasting.'),
  followups:[
    {q:'Which requests can be deferred or rejected safely?',a:'Batch and internal jobs, free-tier chat, non-urgent summarisation; never safety-critical or in-progress booking flows. Decide this policy before the incident.'},
    {q:'What if the burst is a bot or abuse?',a:'Rate-limit by identity and behaviour, challenge suspicious clients at the edge, and block abusive keys; it is a security response, not capacity.'},
    {q:'How do you prevent this next Ramadan?',a:'Forecast from previous years, schedule scale-up hours ahead (cron triggers), reserve capacity for the period, run a load test at forecast peak, and agree degradation policy in advance.'}
  ],
  tradeoffs:`<ul><li>Larger warm pools cost money every day for rare bursts; quantify burst frequency and cost of shedding.</li><li>Fallback models keep users served but at lower quality; restrict to evaluated task classes.</li></ul>`,
  failures:`<ul><li>Scale-out finds no GPUs → Pending pods → reservations, multi-type pools.</li><li>Fallback model gives wrong refund answers → unevaluated fallback → per-task fallback policy.</li><li>Autoscaler thrash after burst → aggressive scale-in → longer stabilisation.</li></ul>`,
  vocab:[
   {term:'warm pool',def:'Ready capacity kept idle for bursts.'},
   {term:'degraded mode',def:'Reduced but safe service level used under overload or failure.'},
   {term:'retry storm',def:'Load amplification caused by clients retrying failed requests.'},
   {term:'scheduled scaling',def:'Scaling ahead of predictable demand based on time or forecast.'}
  ],
  mistakes:['“HPA will scale it.”','Letting queues grow unbounded.','Ignoring the possibility of retries or bots.','Improvising fallback models during the incident.'],
  related:['v2-hyperscale-serving','v1-k8s-autoscaling','v2-multi-region']
},
{
  id:'hyper-07', chapter:'v3-ch-hyperscale', difficulty:2,
  title:'How do you size GPU capacity when no benchmarks exist yet?',
  understand:'The interviewer wants honest estimation: memory fit first, an assumption-based range, then a fast benchmark plan with the right tool settings, and a sensitivity analysis.',
  short:'I give a range, not a number, and a plan to replace it with measurements. First I check fit: weights plus KV per sequence at the expected context, on candidate GPUs, which tells me tensor-parallel degree and the KV-bound concurrency. Then I estimate a throughput range from first principles or similar published setups, clearly labelled, and translate demand into replica ranges. The real step is a short benchmark: serve the model with production-like settings, replay a realistic distribution of input and output lengths, and measure goodput at the SLO — vLLM’s bench serve tool, for example, can report goodput against TTFT and TPOT targets. Finally I show which assumption moves the answer most, usually prompt length and peak factor.',
  detailed:`
<h4>1. Fit</h4>
${formula(`
weights (BF16) = params × 2 B           8B → 16 GB      70B → 141 GB
KV per token   = 2 × layers × kv_heads × head_dim × bytes
   8B shape: 128 KiB      70B shape: 320 KiB
KV per sequence at 4,096 tokens: 8B → 0.5 GiB      70B → 1.25 GiB
`)}
<h4>2. Range</h4>
<p>Express per-replica goodput as a range (e.g. 3–6 req/s for a given mix) and carry it through: replicas = peak RPS ÷ goodput → range of replicas and cost. Present both ends.</p>
<h4>3. Benchmark plan (1–2 days)</h4>
${code('bash',`vllm bench serve --model atlas-70b --dataset-name random
  --random-input-len 2000 --random-output-len 300
  --request-rate 4 --num-prompts 2000
  --percentile-metrics ttft,tpot,itl,e2el --metric-percentiles 50,95,99
  --goodput ttft:1500 tpot:50
# (one command; split here for reading)`)}
<p>(Defaults per docs: dataset random, 1,000 prompts, request rate inf, input 1,024 / output 128 — always override to your workload.) Better: replay real length distributions from logs instead of fixed lengths; sweep request rate to find where goodput stops rising.</p>
<h4>4. Sensitivity</h4>
${table(['Assumption','Change','Effect on replicas'],[
 ['Peak factor','4 → 6','+50 %'],
 ['Input tokens','2,000 → 4,000','prefill doubles; with prefill ≈ 2/3 of GPU time (10M example) replicas ≈ +67 %'],
 ['Output tokens','300 → 150','decode and W halve'],
 ['Prefix-cache hit','40 % → 70 %','uncached prefill −50 %']
])}
<p>Commit to buying only the baseline; keep the rest flexible until pilot traffic confirms.</p>`,
  diagram:D('From unknown to measured', {w:900,h:250,
   boxes:[
    {id:'f',x:20,y:90,w:160,h:60,label:'Fit check',sub:'weights + KV'},
    {id:'r',x:220,y:90,w:170,h:60,label:'Assumption range',sub:'labelled'},
    {id:'b',x:430,y:90,w:170,h:60,label:'Benchmark',sub:'goodput at SLO',cls:'hl'},
    {id:'s',x:640,y:90,w:120,h:60,label:'Sensitivity'},
    {id:'p',x:790,y:90,w:90,h:60,label:'Pilot',cls:'ok'}
   ],
   arrows:[{from:'f',to:'r'},{from:'r',to:'b'},{from:'b',to:'s'},{from:'s',to:'p'}]
  }, 'Replace each assumption with a measurement as early as possible.'),
  followups:[
    {q:'Why not use the tokens/s from a vendor blog?',a:'Different hardware, precision, batch settings, lengths and no SLO. It can seed a range but never a purchase decision.'},
    {q:'What load pattern should the benchmark use?',a:'Open-loop arrivals at a fixed request rate (Poisson), real length distributions, warm prefix cache matching production share, long enough to reach steady state.'},
    {q:'How do you account for future model changes?',a:'Re-run the benchmark as part of the release gate; capacity plans reference a model version.'}
  ],
  tradeoffs:`<ul><li>Fast estimates enable decisions but carry error; buying only the baseline limits the cost of being wrong.</li><li>Synthetic fixed-length benchmarks are reproducible but miss tail behaviour of real distributions.</li></ul>`,
  failures:`<ul><li>Benchmark with request rate inf → measures max throughput, not SLO goodput → sweep fixed rates.</li><li>Benchmark with short prompts → production prefill-bound → replay real lengths.</li><li>Cold cache in benchmark vs warm in prod (or vice versa) → mismatch → match cache conditions.</li></ul>`,
  vocab:[
   {term:'open-loop load',def:'Requests arrive on a schedule independent of responses, like real users.'},
   {term:'goodput target',def:'Latency thresholds that define a successful request in a benchmark.'},
   {term:'sensitivity analysis',def:'Showing how outputs change as each assumption varies.'},
   {term:'fit check',def:'Verifying weights and KV fit in GPU memory for the chosen parallelism.'}
  ],
  mistakes:['Single-point estimates.','Closed-loop benchmarks with few clients.','Default benchmark lengths.','Buying full capacity before a pilot.'],
  related:['v1-benchmarking','v2-capacity-planning','v1-kv-cache']
},
{
  id:'hyper-08', chapter:'v3-ch-hyperscale', difficulty:3,
  title:'How would you design disaster recovery for an AI platform?',
  understand:'The interviewer wants component-level RTO/RPO, knowledge of what is expensive to rebuild (indexes, fine-tunes, GPU capacity), and evidence through drills.',
  short:'I list every component and decide its recovery objectives separately, because they differ wildly. Model weights and images are easy — replicate signed artifacts to the DR region. Registries, prompts, configuration and evaluation sets are small but critical, so they are backed up and versioned in git or replicated databases. Vector indexes are large and expensive to rebuild — re-embedding millions of chunks takes hours and money — so I replicate them or keep snapshots plus the raw chunk text. Conversation state and user data follow residency rules. The hardest part is GPU capacity: a DR region without reserved GPUs may not get them during a regional event. Finally, recovery is proven with drills that measure the actual recovery time.',
  detailed:`
${table(['Component','Backup / replication','RPO (example)','RTO (example)'],[
 ['Model weights, images','Signed artifacts replicated to DR registry','0 (immutable)','minutes (pull)'],
 ['Model registry DB, prompts, configs','DB replication + git','≤ 5 min','≤ 30 min'],
 ['Eval sets and judge configs','Git/object storage versioned','0','≤ 1 h'],
 ['Vector index','Snapshots + raw chunks; or live replica','≤ 15 min (replica) / 24 h (snapshot)','≤ 1 h (replica) / hours (rebuild)'],
 ['Fine-tune checkpoints/adapters','Object storage cross-region replication','last checkpoint','hours'],
 ['Conversation state','Regional DB; replicate only where allowed','policy-dependent','policy-dependent'],
 ['GPU capacity','Reserved/committed capacity in DR region','—','depends on reservation']
])}
<h4>Rebuild cost of a lost index (illustrative)</h4>
${formula(`
10 M chunks × 400 tokens = 4 × 10⁹ tokens to re-embed
at an assumed 20,000 tok/s per GPU: 200,000 s ≈ 55.6 GPU-hours
on 8 GPUs ≈ 7 h — plus HNSW build time and evaluation
`)}
<p>That is why indexes deserve replicas or snapshots rather than “we can rebuild”.</p>
<h4>GPU capacity</h4>
<p>Regional events cause everyone to fail over at once; on-demand GPUs vanish. Options: active-active (capacity already used), reservations in DR region, smaller DR model on more available GPUs, provider API fallback where policy allows.</p>
<h4>Drills</h4>
<p>Quarterly: restore registry from backup, restore an index from snapshot, fail traffic to DR region; record actual RTO/RPO and fix gaps.</p>`,
  diagram:D('DR scope by component', {w:900,h:290,
   zones:[{x:20,y:20,w:400,h:250,label:'Primary region'},{x:480,y:20,w:400,h:250,label:'DR region'}],
   boxes:[
    {id:'w',x:40,y:60,w:170,h:44,label:'Weights/images'},
    {id:'r',x:230,y:60,w:170,h:44,label:'Registry + prompts'},
    {id:'i',x:40,y:130,w:170,h:44,label:'Vector index'},
    {id:'c',x:230,y:130,w:170,h:44,label:'Conversations'},
    {id:'g',x:40,y:200,w:360,h:50,label:'GPU fleet',cls:'hl'},
    {id:'w2',x:500,y:60,w:170,h:44,label:'Replica registry',cls:'ok'},
    {id:'i2',x:500,y:130,w:170,h:44,label:'Index replica',cls:'ok'},
    {id:'g2',x:500,y:200,w:360,h:50,label:'Reserved / active GPUs',cls:'warn'}
   ],
   arrows:[{from:'w',to:'w2',label:'replicate'},{from:'i',to:'i2',label:'snapshot / live'},{from:'g',to:'g2',cls:'dash',label:'capacity is not copied'}]
  }, 'Data can be replicated; GPU capacity must be reserved or already in use.'),
  followups:[
    {q:'Do you need DR for the KV/prefix cache?',a:'No. It is ephemeral performance state; after failover it warms up again. Plan for a temporary TTFT increase.'},
    {q:'What about residency-bound data in DR?',a:'DR must be within the allowed jurisdiction (e.g. a second in-Kingdom location if available); otherwise the DR plan for that data is a degraded mode, documented with the regulator’s requirements.'},
    {q:'What is the most commonly forgotten DR item?',a:'Configuration and secrets: gateway tenant config, quotas, provider API keys per region, and IAM roles — the platform restarts but nothing can authenticate.'}
  ],
  tradeoffs:`<ul><li>Live index replicas cost storage and write load but cut RTO from hours to minutes.</li><li>Reserved DR GPUs are expensive insurance; active-active turns insurance into used capacity.</li></ul>`,
  failures:`<ul><li>Restore works but index is a day old → snapshot-only RPO → replay ingestion events from Kafka retention.</li><li>DR region has weights but no GPUs → capacity not reserved → reservations or smaller DR model.</li><li>Backups never restored → untested → drills.</li></ul>`,
  vocab:[
   {term:'RPO',def:'Recovery point objective: maximum acceptable data loss measured in time.'},
   {term:'RTO',def:'Recovery time objective: maximum acceptable time to restore service.'},
   {term:'snapshot',def:'Point-in-time copy of a data store.'},
   {term:'DR drill',def:'Exercise that performs a real recovery to measure RTO/RPO.'}
  ],
  mistakes:['One RTO/RPO for “the platform”.','Assuming GPUs will be available in the DR region.','“We can rebuild the index” without computing the time.','Ignoring config and secrets.'],
  related:['v2-multi-region','v2-rag-production','v2-governance']
},
{
  id:'hyper-09', chapter:'v3-ch-hyperscale', difficulty:2,
  title:'How do you design multi-tenant isolation for a shared AI serving platform?',
  understand:'The interviewer checks layered isolation: identity, quotas and fairness, data and cache isolation, compute isolation tiers, observability and cost per tenant.',
  short:'I separate isolation into layers. Identity: every request carries a tenant identity issued by the gateway, never trusted from the prompt. Fairness: per-tenant token quotas, concurrency caps and priority classes, so one tenant cannot consume the shared pool. Data: retrieval filters and caches scoped by tenant, with the tenant and permission fingerprint in every cache key, and logs separated or access-controlled. Compute: shared pools for most tenants, dedicated pools or clusters for regulated or very large ones. And visibility: per-tenant SLOs, usage and cost so we can prove fairness and charge back. The model prompt is never a security boundary.',
  detailed:`
${table(['Layer','Shared tier','Premium / regulated tier'],[
 ['Identity','Gateway-issued tenant id','Same + customer-managed keys'],
 ['Quotas','Token quotas, concurrency caps','Reserved capacity'],
 ['Retrieval','Shared index with mandatory tenant filter','Dedicated index'],
 ['Caches','Keys include tenant + ACL fingerprint','Separate cache namespaces'],
 ['Compute','Shared model pools','Dedicated pools / cluster'],
 ['Logs/traces','Tenant-tagged, RBAC','Separate storage, retention per contract'],
 ['Fine-tunes/adapters','Per-tenant LoRA adapters loaded on shared base','Dedicated deployment']
])}
<h4>Cache leak example</h4>
<p>A semantic cache keyed only on the question text returns tenant A’s answer (built from A’s confidential document) to tenant B asking a similar question. Fix: cache key = tenant + ACL fingerprint + model/prompt/index versions + normalised query.</p>
<h4>Fairness measurement</h4>
<p>Per-tenant TTFT p95, 429 rate, share of capacity vs quota. Noisy-neighbour detection: one tenant’s token rate rising while others’ latency rises.</p>
<h4>Per-tenant LoRA</h4>
<p>Engines can serve many adapters on one base model (vLLM <code>--enable-lora</code>, <code>--max-loras</code> default 1 — raise deliberately), which isolates behaviour cheaply but shares compute and memory.</p>`,
  diagram:D('Isolation layers', {w:900,h:270,
   boxes:[
    {id:'id',x:20,y:100,w:140,h:60,label:'Tenant identity',sub:'from gateway',cls:'hl'},
    {id:'q',x:200,y:20,w:170,h:50,label:'Quotas + priority'},
    {id:'d',x:200,y:90,w:170,h:50,label:'Data + cache scope'},
    {id:'c',x:200,y:160,w:170,h:50,label:'Compute tier'},
    {id:'o',x:200,y:230,w:170,h:36,label:'Obs + cost'},
    {id:'sh',x:450,y:60,w:200,h:56,label:'Shared pools'},
    {id:'de',x:450,y:160,w:200,h:56,label:'Dedicated pools',cls:'ok'},
    {id:'rep',x:700,y:110,w:180,h:56,label:'Per-tenant SLO report'}
   ],
   arrows:[{from:'id',to:'q'},{from:'id',to:'d'},{from:'id',to:'c'},{from:'id',to:'o'},{from:'c',to:'sh'},{from:'c',to:'de'},{from:'o',to:'rep'}]
  }, 'Tenant identity flows from the gateway into every layer.'),
  followups:[
    {q:'Is MIG or a shared GPU a security boundary for regulated tenants?',a:'MIG gives hardware partitioning with memory and fault isolation, which is strong, but auditors may still require dedicated hardware or clusters. Document residual risk and follow the contract.'},
    {q:'How do you onboard a new tenant safely?',a:'Template: identity, default quotas, cache namespaces, retrieval filters, dashboards, cost tags — applied by GitOps, with an automated cross-tenant leak test.'},
    {q:'A big tenant wants guaranteed latency. How?',a:'Reserved capacity or a dedicated pool with its own SLO and price; shared pools can only offer best-effort fairness.'}
  ],
  tradeoffs:`<ul><li>Shared infrastructure is cheaper; dedicated is simpler to reason about and sell to regulated customers.</li><li>Strict per-tenant caches reduce hit rates; shared caches are only safe for public, tenant-independent content.</li></ul>`,
  failures:`<ul><li>Cross-tenant answer via cache → missing tenant in key → key design and tests.</li><li>Tenant id from request body trusted → spoofing → gateway-issued identity only.</li><li>One tenant’s batch job raises everyone’s TTFT → no concurrency caps → caps and priority.</li></ul>`,
  vocab:[
   {term:'tenant isolation',def:'Guarantees that one tenant cannot access or degrade another tenant’s data or service.'},
   {term:'noisy neighbour',def:'A tenant whose load degrades others on shared resources.'},
   {term:'ACL fingerprint',def:'Hash of effective permissions used in cache keys.'},
   {term:'LoRA adapter',def:'Small fine-tuned weight delta that can be loaded on a shared base model per tenant.'}
  ],
  mistakes:['Tenant id in the prompt as a boundary.','Cache keys without tenant.','Request-count quotas only.','No per-tenant observability.'],
  related:['v2-governance','v2-cache-ops','v2-ai-gateway']
},
{
  id:'hyper-10', chapter:'v3-ch-hyperscale', difficulty:1,
  title:'How do you implement graceful degradation when the main model or provider is unavailable?',
  understand:'The interviewer checks that fallbacks are policy-driven per task, quality-evaluated, explicit to users where needed, and do not silently violate safety or residency.',
  short:'I define degradation per task class before any incident. For each class I list approved fallbacks in order — for example the 70B model, then an evaluated 8B model, then a cached or templated answer, then an honest “temporarily unavailable, here is a human agent” — and the conditions to use them. A fallback must have passed the same evaluation for that task and must respect residency, so a Saudi-resident workflow never silently falls back to an out-of-region provider. Some tasks, like refund decisions, have no automatic fallback: they fail safely. The gateway implements this with health-based routing and circuit breakers, logs every fallback, and we measure quality of degraded responses separately.',
  detailed:`
${table(['Task class','Fallback chain','Never'],[
 ['General travel Q&A','70B → 8B (evaluated) → FAQ cache → human handoff','Unevaluated model'],
 ['Booking changes (tool use)','70B → queue for async completion → human agent','Small model executing writes'],
 ['Refund eligibility','70B → “temporarily unavailable” + agent','Any guess'],
 ['Internal summarisation','Provider A → provider B (same region) → defer batch','Cross-region if residency-bound']
])}
<h4>Mechanics</h4>
<ul><li>Health signals: error rate, timeouts, queue saturation per backend → circuit breaker opens.</li><li>Routing table per model alias and task class, versioned in git.</li><li>User experience: tell users when answers are limited (“simplified mode”).</li><li>Telemetry: fallback rate by class; judged quality of fallback responses.</li></ul>
<h4>Evaluation</h4>
<p>Each fallback model has scores on the task’s eval set; a fallback below the task’s quality floor is not allowed for that class.</p>`,
  diagram:D('Fallback chain per task', {w:900,h:240,
   boxes:[
    {id:'p',x:20,y:90,w:150,h:60,label:'Primary 70B',cls:'ok'},
    {id:'s',x:220,y:90,w:150,h:60,label:'Evaluated 8B'},
    {id:'c',x:420,y:90,w:150,h:60,label:'Cached / template'},
    {id:'h',x:620,y:90,w:150,h:60,label:'Human / unavailable',cls:'warn'},
    {id:'pol',x:820,y:90,w:60,h:60,label:'Policy'}
   ],
   arrows:[{from:'p',to:'s',label:'breaker open'},{from:'s',to:'c'},{from:'c',to:'h'}]
  }, 'Each step is approved per task class; some classes skip straight to “unavailable”.'),
  followups:[
    {q:'Is any answer better than none?',a:'No. A wrong refund decision or unsafe advice is worse than a clear “unavailable” with a path to a human.'},
    {q:'How do you test fallbacks?',a:'Chaos tests that open breakers in staging and production game days; verify routing, quality, and user messaging.'},
    {q:'How long can you run degraded?',a:'Until the error budget or business tolerance is consumed; track it like an incident with its own exit criteria.'}
  ],
  tradeoffs:`<ul><li>More fallbacks raise availability but multiply evaluation and maintenance work.</li><li>Silent fallback hides incidents from users and from you; explicit messaging is safer.</li></ul>`,
  failures:`<ul><li>Fallback provider in another region violates residency → policy check in routing.</li><li>Fallback model overwhelmed by full traffic → not sized → capacity plan for fallback share.</li><li>Breaker flaps → thresholds too tight → hysteresis.</li></ul>`,
  vocab:[
   {term:'graceful degradation',def:'Reducing service quality in controlled, safe ways instead of failing completely.'},
   {term:'quality floor',def:'Minimum evaluated quality a model must meet to serve a task class.'},
   {term:'circuit breaker',def:'Mechanism that stops routing to an unhealthy backend for a cool-down period.'}
  ],
  mistakes:['Silent fallback to any available model.','Fallbacks never evaluated.','Ignoring residency during fallback.','No user messaging.'],
  related:['v2-multi-region','v2-ai-gateway','v2-evaluation-monitoring']
},
{
  id:'hyper-11', chapter:'v3-ch-hyperscale', difficulty:3,
  title:'How would you design a self-service enterprise AI platform?',
  understand:'An architect and leadership question. The interviewer wants a product view of the platform: users and golden paths, the shared services, guardrails and governance, tenancy, cost, SLOs and the operating model.',
  short:'I design it as an internal product with paved roads. Product teams should get from idea to a governed AI feature without filing tickets. They pick a model from a catalogue of approved models with documented quality, cost and residency; get a gateway key with quotas; and start from templates — a RAG service, an agent with approved tools, a fine-tuning job, a batch pipeline — that come with tracing, evaluation and guardrails built in. Shared services underneath are the gateway, model serving pools, vector and ingestion services, evaluation-as-a-service, prompt registry, and observability with per-team cost. Governance is automated: risk tiering, data classification, red-team checks and approvals in the pipeline. The platform team owns the paved road and its SLOs; product teams own their prompts, data, evals and on-call.',
  detailed:`
<h4>Users and journeys</h4>
${table(['User','Journey'],[
 ['Product engineer','Create “RAG over my docs” from template in a day: repo, CI, eval set skeleton, gateway key, dashboard'],
 ['Data scientist','Fine-tune adapter via job template; registry; eval report; promotion request'],
 ['Security / risk','Risk-tier review automated from metadata; red-team results attached'],
 ['FinOps','Showback by team/model; budgets and alerts'],
 ['Platform SRE','SLOs for gateway, serving pools, ingestion; capacity planning']
])}
<h4>Platform components</h4>
<ul><li><b>Portal / catalogue</b> (Backstage-like): model catalogue (quality scores, cost per 1M tokens, context, residency), templates, docs.</li>
<li><b>AI gateway</b>: keys, token quotas, routing, metering.</li>
<li><b>Serving</b>: shared pools (vLLM/llm-d) + provider access through the same gateway.</li>
<li><b>Knowledge services</b>: ingestion connectors, hybrid index, ACL sync.</li>
<li><b>Eval-as-a-service</b>: datasets, judges, gates callable from CI.</li>
<li><b>Prompt and model registry</b>.</li>
<li><b>Guardrails</b>: PII, injection detection, output policies as shared components.</li>
<li><b>Observability</b>: OTel traces, dashboards, cost per successful request.</li>
<li><b>Agent/tool platform</b>: MCP servers registry with approved, scoped tools.</li></ul>
<h4>Governance as code</h4>
<p>Each use case registers metadata: data classes, user population, risk tier, tools with side effects. The pipeline enforces requirements per tier (e.g. high tier → human evaluation sample, red-team suite, approval).</p>
<h4>Success metrics</h4>
<p>Time from idea to production, number of teams on paved road, % traffic through gateway, SLO attainment, cost per successful request, incidents per release.</p>`,
  diagram:D('Self-service AI platform', {w:900,h:330,
   boxes:[
    {id:'portal',x:20,y:20,w:860,h:50,label:'Portal: model catalogue · templates · docs · onboarding',cls:'hl'},
    {id:'gw',x:20,y:100,w:200,h:56,label:'AI gateway',sub:'keys, quotas, routing'},
    {id:'serve',x:240,y:100,w:200,h:56,label:'Serving pools',sub:'self-hosted + providers'},
    {id:'know',x:460,y:100,w:200,h:56,label:'Knowledge services',sub:'ingest, index, ACL'},
    {id:'tools',x:680,y:100,w:200,h:56,label:'Tool / MCP registry'},
    {id:'eval',x:20,y:190,w:200,h:56,label:'Eval-as-a-service'},
    {id:'reg',x:240,y:190,w:200,h:56,label:'Model + prompt registry'},
    {id:'guard',x:460,y:190,w:200,h:56,label:'Guardrails'},
    {id:'obs',x:680,y:190,w:200,h:56,label:'Observability + cost'},
    {id:'gov',x:20,y:270,w:860,h:46,label:'Governance as code: risk tiers, data classes, approvals in CI/CD',cls:'v2'}
   ],
   arrows:[]
  }, 'Templates wire every new use case to the same shared services and controls.'),
  followups:[
    {q:'What would you build first?',a:'The gateway with keys, quotas and metering plus one excellent template (RAG) with tracing and eval built in. They create immediate visibility and a paved road; everything else follows demand.'},
    {q:'How do you stop teams going around the platform?',a:'Make the paved road faster than the alternative, provide provider access through the gateway (so there is no reason to use personal API keys), and enforce egress controls and procurement rules for direct provider access.'},
    {q:'How do you handle a team that needs something the platform does not support?',a:'Allow an exception path with explicit ownership and review; if several teams need it, it becomes a roadmap item.'},
    {q:'How would you report value to leadership?',a:'Adoption, lead time, reliability (SLOs), unit cost trends, and risk posture (share of use cases with evals and approvals).'}
  ],
  tradeoffs:`<ul><li>Strong standardisation speeds teams and governance but may lag new techniques; keep an experimental lane.</li><li>Central platform team vs federated contributions: central is consistent, federated scales knowledge.</li></ul>`,
  failures:`<ul><li>Low adoption → paved road slower than DIY → measure onboarding time, fix friction.</li><li>Shadow AI with personal API keys → no gateway path to providers → offer it, block egress.</li><li>Platform becomes a ticket queue → missing self-service automation.</li></ul>`,
  vocab:[
   {term:'paved road / golden path',def:'Supported, opinionated default way to build and run a service.'},
   {term:'model catalogue',def:'List of approved models with quality, cost, limits and residency information.'},
   {term:'eval-as-a-service',def:'Shared evaluation datasets, judges and gates callable from any pipeline.'},
   {term:'risk tiering',def:'Classifying AI use cases by potential harm to apply proportionate controls.'}
  ],
  mistakes:['Listing tools instead of user journeys.','Governance as manual review meetings only.','No cost visibility per team.','Building everything before the first team is served.'],
  related:['v2-platform-architecture','v2-capstone-platform','v2-governance','v2-ai-gateway']
},
{
  id:'hyper-12', chapter:'v3-ch-hyperscale', difficulty:2,
  title:'What is cache-aware (prefix-aware) routing and when does it pay off at fleet scale?',
  understand:'The interviewer checks understanding of why round-robin wastes prefix caches, how KV-aware routers score replicas, and the hot-spot risk.',
  short:'Each replica keeps a prefix cache of recent prompt KV blocks. Round-robin spreads requests sharing a long prefix — a system prompt, a document, a conversation — across replicas, so each one recomputes the same prefill. A cache-aware router sends a request to the replica that already holds the most of its prefix, balanced against how loaded that replica is. NVIDIA Dynamo’s router, for example, scores replicas by the prefill blocks still needed after cache overlap plus decode load, and llm-d’s endpoint picker does similar scoring through the Gateway API Inference Extension. It pays off when prompts share long prefixes and prefill dominates; the risk is hot spots, so load must always be part of the score.',
  detailed:`
<h4>Why it matters (illustrative)</h4>
${formula(`
system prompt + policy context = 3,000 tokens shared by most requests
round-robin over 40 replicas: each replica caches it eventually, but
conversation-specific prefixes (history) are spread → low hit rate
prefix-aware: follow-up turns land where history is cached
saved prefill per hit = cached tokens × prefill cost per token
`)}
<h4>Router scoring (Dynamo v1.5.1, verified formula)</h4>
${formula(`
cost = prefill_load_scale × adjusted_prefill_blocks
     + potential_decode_blocks + active_request_blocks
adjusted_prefill_blocks = max(0, active_prefill_blocks
                              + incoming_prompt_blocks − overlap_credit_blocks)
lowest cost wins (temperature > 0 samples instead of argmin)
`)}
<p>The overlap credit is the cache-hit benefit; active load terms prevent sending everything to one replica.</p>
<h4>Kubernetes</h4>
<p>Gateway API Inference Extension InferencePool + endpoint picker; llm-d (v0.10, CNCF Sandbox) provides prefix-cache-aware routing, KV indexing and predicted-latency routing; vLLM exposes <code>vllm:prefix_cache_hits</code> / <code>vllm:prefix_cache_queries</code> to measure hit ratio.</p>
<h4>When it pays</h4>
<ul><li>Long shared prefixes, multi-turn chats, agent loops re-sending context, RAG over popular documents.</li><li>Prefill-dominant workloads (see the 10M sizing: prefill was 4× decode tokens).</li><li>Fleet large enough that random hits are rare.</li></ul>
<p>It pays less for short prompts or unique contexts.</p>`,
  diagram:D('Round-robin vs prefix-aware', {w:900,h:280,
   boxes:[
    {id:'req',x:20,y:110,w:150,h:60,label:'Turn 5 of chat',sub:'history 6k tokens'},
    {id:'rr',x:230,y:40,w:170,h:56,label:'Round-robin',cls:'warn'},
    {id:'pa',x:230,y:180,w:170,h:56,label:'Prefix-aware router',cls:'hl'},
    {id:'r1',x:480,y:40,w:180,h:56,label:'Replica 7',sub:'cold: recompute 6k'},
    {id:'r2',x:480,y:180,w:180,h:56,label:'Replica 3',sub:'holds history blocks',cls:'ok'},
    {id:'m',x:720,y:110,w:160,h:60,label:'Hit ratio metric',sub:'prefix_cache_hits'}
   ],
   arrows:[{from:'req',to:'rr'},{from:'req',to:'pa'},{from:'rr',to:'r1'},{from:'pa',to:'r2'},{from:'r2',to:'m',cls:'dash'}]
  }, 'Routing decides whether cached prefill is reused or recomputed.'),
  followups:[
    {q:'What is the hot-spot risk and mitigation?',a:'Popular prefixes concentrate on few replicas, raising their queues. Include load terms in the score, cap per-replica load, and allow replication of hot prefixes on several replicas.'},
    {q:'How do you measure the benefit?',a:'Prefix hit ratio, uncached prefill tokens per request, TTFT p95 and goodput per replica before/after, at equal traffic.'},
    {q:'How does it interact with autoscaling?',a:'New replicas start with cold caches; routers should ramp them gradually, and scale-in removes cache state, so scale in slowly.'}
  ],
  tradeoffs:`<ul><li>Higher hit rates vs balanced load; the scoring weights set the balance.</li><li>Smart routers add a component and latency; justify by measured prefill savings.</li></ul>`,
  failures:`<ul><li>One replica overloaded → affinity without load term → include load.</li><li>Hit ratio low despite router → prompts vary early (timestamps at top of system prompt) → put dynamic content after static prefix.</li><li>Router outage → fallback to simple load balancing.</li></ul>`,
  vocab:[
   {term:'prefix cache',def:'Reuse of KV blocks for identical prompt prefixes across requests.'},
   {term:'KV-aware routing',def:'Choosing a replica based on cached KV overlap and load.'},
   {term:'endpoint picker',def:'Component selecting the backend pod per request using model-server state.'},
   {term:'hot spot',def:'A replica receiving disproportionate load because of routing affinity.'}
  ],
  mistakes:['Assuming the prefix cache is shared across replicas.','Putting timestamps or user ids at the start of prompts.','Affinity routing with no load term.','Ignoring cold caches on new replicas.'],
  related:['v2-distributed-kv','v2-prefix-kv-cache','v1-engines']
}
]);
})();
