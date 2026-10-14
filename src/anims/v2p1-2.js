/* Animations for Volume 2 Parts 1–2: platform architecture, AI gateway and the caching masterclass. */

/* ---------- 2.1.1 Request journey with a latency budget ---------- */
Anim.register({
  id:'v2-arch-journey', title:'One request through the platform planes, with a p95 TTFT budget of 1,500 ms', w:960, h:430,
  elements:[
    {type:'node', id:'user', x:30, y:60, w:120, h:60, label:'User app', sub:'web / mobile', icon:'user'},
    {type:'node', id:'edge', x:200, y:60, w:140, h:60, label:'Edge + WAF', sub:'TLS, bot rules', icon:'shield'},
    {type:'node', id:'gw', x:390, y:60, w:150, h:60, label:'AI gateway', sub:'auth, quota, route', icon:'key'},
    {type:'node', id:'guard', x:590, y:60, w:150, h:60, label:'Input guardrail', sub:'PII, injection', icon:'lock'},
    {type:'node', id:'cp', x:790, y:125, w:150, h:60, label:'Control plane', sub:'config, policy', icon:'gear'},
    {type:'node', id:'ret', x:590, y:190, w:150, h:60, label:'Retrieval', sub:'embed, search, rerank', icon:'search'},
    {type:'node', id:'prompt', x:390, y:190, w:150, h:60, label:'Prompt builder', sub:'template v12', icon:'doc'},
    {type:'node', id:'queue', x:200, y:190, w:140, h:60, label:'Router + queue', sub:'picks a replica', icon:'queue'},
    {type:'node', id:'eng', x:30, y:190, w:120, h:60, label:'GPU engine', sub:'prefill, decode', icon:'gpu'},
    {type:'edge', id:'e1', from:'user', to:'edge'},
    {type:'edge', id:'e2', from:'edge', to:'gw'},
    {type:'edge', id:'e3', from:'gw', to:'guard'},
    {type:'edge', id:'e4', from:'guard', to:'ret', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'e5', from:'ret', to:'prompt'},
    {type:'edge', id:'e6', from:'prompt', to:'queue'},
    {type:'edge', id:'e7', from:'queue', to:'eng'},
    {type:'edge', id:'e8', from:'eng', to:'user', fromSide:'top', toSide:'bottom', label:'stream'},
    {type:'counter', id:'cEl', x:40, y:300, label:'Elapsed before first token', value:'0 ms'},
    {type:'counter', id:'cTt', x:360, y:300, label:'TTFT (p95 target 1,500 ms)', value:'—'},
    {type:'counter', id:'cE2e', x:680, y:300, label:'End-to-end (300-token answer)', value:'—'},
    {type:'bar', id:'bud', x:40, y:380, w:880, h:22, label:'Share of the TTFT budget used', value:0, text:'0 / 1,500 ms'}
  ],
  steps:[
    {caption:'A traveller asks Atlas: <i>"Can I add a second bag to my Riyadh flight?"</i>. The product SLO is <b>p95 time-to-first-token ≤ 1,500 ms</b>. Every hop spends part of that budget. All numbers in this scene are an <b>illustrative budget</b>; you replace them with your own traces.', hl:['user'], dur:4200},
    {caption:'<b>Edge</b>: TLS termination, WAF and bot rules at the CDN or load balancer. Budget: <b>20 ms</b>. This is ordinary web infrastructure; nothing AI-specific yet.', hl:['edge'], packets:[{edge:'e1',label:'HTTPS'}], set:{cEl:{value:'20 ms'}, bud:{value:20/1500, text:'20 / 1,500 ms'}}, dur:3800},
    {caption:'<b>AI gateway</b> (data plane): validates the JWT, maps it to tenant <code>atlas-consumer</code>, checks the tenant’s <b>token</b> quota, picks a model route and starts a trace. Budget: <b>15 ms</b>. It reads its routing table from local memory, not from the control plane, on every request.', hl:['gw'], packets:[{edge:'e2'}], set:{cEl:{value:'35 ms'}, bud:{value:35/1500, text:'35 / 1,500 ms'}}, dur:4200},
    {caption:'<b>Input guardrail</b>: a small classifier checks for prompt injection and masks a passport number the user pasted. Budget: <b>60 ms</b>. Guardrails are on the critical path, so they need their own latency SLO.', hl:['guard'], packets:[{edge:'e3'}], set:{cEl:{value:'95 ms'}, bud:{value:95/1500, text:'95 / 1,500 ms'}}, dur:4000},
    {caption:'<b>Knowledge plane</b>: embed the query (25 ms), hybrid vector + keyword search with the user’s ACL filter (60 ms), rerank the top 50 to 8 chunks (80 ms). Budget: <b>165 ms</b>. Retrieval is owned by a different team from the GPUs, so it gets its own SLO.', hl:['ret'], packets:[{edge:'e4'}], set:{cEl:{value:'260 ms'}, bud:{value:260/1500, text:'260 / 1,500 ms'}}, dur:4400},
    {caption:'<b>Prompt builder</b>: system prompt and tool schemas (2,000 tokens, identical for every user) + 8 chunks (3,500 tokens) + the question and history (500 tokens) = <b>6,000 prompt tokens</b>. Budget: 10 ms.', hl:['prompt'], packets:[{edge:'e5',label:'8 chunks'}], set:{cEl:{value:'270 ms'}, bud:{value:270/1500, text:'270 / 1,500 ms'}}, dur:4200},
    {caption:'<b>Model-serving plane</b>: the router picks a vLLM replica; the request waits in its queue for free KV blocks. Budget at p95: <b>150 ms</b>. Queueing is usually the most variable term in the whole budget.', hl:['queue'], packets:[{edge:'e6',label:'6,000 tok'}], set:{cEl:{value:'420 ms'}, bud:{value:420/1500, text:'420 / 1,500 ms'}}, dur:4000},
    {caption:'<b>Prefill</b>: 6,000 tokens at an assumed, measured 12,000 prefill tokens/s on this replica under load = <b>500 ms</b>. The first token travels back (30 ms). <b>TTFT = 950 ms</b>, inside the 1,500 ms budget with 550 ms headroom.', hl:['eng'], busy:['eng'], packets:[{edge:'e7'},{edge:'e8',label:'token 1',delay:900,cls:'c-ok'}], set:{cEl:{value:'950 ms'}, cTt:{value:'950 ms'}, bud:{value:950/1500, text:'950 / 1,500 ms'}}, dur:4800},
    {caption:'<b>Decode</b>: 300 output tokens × 25 ms time per output token = 7,500 ms of streaming. End-to-end ≈ 950 + 7,500 = <b>8,450 ms</b>. The user sees text after 950 ms, so TTFT and end-to-end time are different SLOs with different owners and levers.', busy:['eng'], packets:[{edge:'e8',label:'tokens',count:4,cls:'c-ok'}], set:{cE2e:{value:'≈ 8,450 ms'}}, dur:4800},
    {caption:'Add <b>prefix caching</b>: the 2,000-token system prompt is already in this replica’s KV cache, so only 4,000 tokens are prefilled: 4,000 / 12,000 = 333 ms. TTFT falls from 950 to <b>783 ms</b>. Decode time does not change. Caching moves the budget; Part 2 shows how.', ok:['eng'], set:{cEl:{value:'783 ms'}, cTt:{value:'783 ms (prefix hit)'}, bud:{value:783/1500, text:'783 / 1,500 ms'}, cE2e:{value:'≈ 8,283 ms'}}, dur:4800},
    {caption:'<b>Control plane outage</b>: Argo CD, the policy service and the model registry go down. The data plane keeps serving with its <b>last known good</b> config (static stability). You cannot deploy or change quotas until it returns, but users notice nothing. Design for this explicitly.', bad:['cp'], ok:['gw','queue','eng'], dur:5000}
  ]
});

/* ---------- 2.1.2 Gateway routing, retries and fallback ---------- */
Anim.register({
  id:'v2-gw-fallback', title:'AI gateway: quota, routing, safe retry, fallback and metering', w:960, h:430,
  elements:[
    {type:'node', id:'cli', x:30, y:165, w:130, h:60, label:'Client app', sub:'tenant atlas', icon:'user'},
    {type:'node', id:'gw', x:220, y:150, w:170, h:90, label:'AI gateway', sub:'auth · quota · route', icon:'key'},
    {type:'node', id:'pa', x:470, y:40, w:190, h:60, label:'Pool A: vLLM', sub:'self-hosted, primary', icon:'gpu'},
    {type:'node', id:'pb', x:470, y:165, w:190, h:60, label:'Provider B', sub:'managed API, fallback', icon:'cloud'},
    {type:'node', id:'pc', x:470, y:290, w:190, h:60, label:'Small model C', sub:'degraded mode', icon:'llm'},
    {type:'node', id:'met', x:220, y:330, w:170, h:60, label:'Meter + audit', sub:'tokens, cost, trace', icon:'chart'},
    {type:'edge', id:'g0', from:'cli', to:'gw'},
    {type:'edge', id:'ga', from:'gw', to:'pa'},
    {type:'edge', id:'gb', from:'gw', to:'pb'},
    {type:'edge', id:'gc', from:'gw', to:'pc'},
    {type:'edge', id:'gm', from:'gw', to:'met', fromSide:'bottom', toSide:'top'},
    {type:'bar', id:'q', x:700, y:60, w:230, h:20, label:'Tenant tokens-per-minute used', value:0.6, text:'1.20M / 2.00M TPM'},
    {type:'counter', id:'route', x:700, y:120, label:'Route decision', value:'—'},
    {type:'counter', id:'tok', x:700, y:200, label:'Tokens streamed to client', value:'0'},
    {type:'counter', id:'cost', x:700, y:280, label:'Metered for this request', value:'—'},
    {type:'counter', id:'circ', x:700, y:360, label:'Circuit breaker, pool A', value:'closed'}
  ],
  steps:[
    {caption:'A chat request arrives with a JWT. The gateway authenticates it, resolves tenant <code>atlas</code> and task class <code>chat-general</code>, and <b>estimates</b> input tokens (≈ 3,000) before calling any model, so it can reject early if the quota is already exhausted.', hl:['gw'], packets:[{edge:'g0',label:'POST'}], dur:4500},
    {caption:'<b>Token quota</b>, not request count: 1.20M of 2.00M tokens-per-minute used; +3,500 estimated fits. A request-count limit would treat a 50-token and a 50,000-token request as equal, which is wrong for GPU cost.', hl:['q'], set:{q:{value:0.6, text:'1.20M / 2.00M TPM (+3.5k est.)'}}, dur:4200},
    {caption:'<b>Routing policy</b> for <code>chat-general</code>: cheapest model that meets the quality bar → self-hosted pool A. Allowed region list and data class (no PII to external providers unless masked) are checked here too.', hl:['pa'], packets:[{edge:'ga',label:'route A'}], set:{route:{value:'pool A (cost)'}}, dur:4200},
    {caption:'Pool A returns <b>503 before sending any token</b>. Nothing reached the client yet, so a retry is <b>safe</b>: there is no partial output to duplicate. The circuit breaker records one failure.', bad:['pa'], packets:[{edge:'ga',label:'503',reverse:true,cls:'c-bad'}], set:{circ:{value:'closed (1 failure)'}}, dur:4400},
    {caption:'<b>Fallback</b> to provider B, which is on this tenant’s allow-list and in an approved region. The gateway translates the request to B’s API if needed and starts streaming tokens back to the client.', ok:['pb'], packets:[{edge:'gb',label:'route B'},{edge:'g0',label:'tokens',reverse:true,count:3,delay:900,cls:'c-ok'}], set:{route:{value:'provider B (fallback)'}, tok:{value:'120'}}, dur:4600},
    {caption:'After 120 tokens, provider B’s connection resets. The client already displayed 120 tokens. A blind retry would generate a <b>different</b> answer and duplicate text. The gateway must end the stream with an explicit error (or a resumable marker) and let the client decide. <b>Retry is only automatic before the first byte.</b>', bad:['pb'], set:{tok:{value:'120 (stream broken)'}}, dur:5200},
    {caption:'More failures on pool A open its <b>circuit</b>: for a cooldown period new requests skip A entirely instead of paying a timeout each time. (LiteLLM, for example, has <code>allowed_fails</code> and <code>cooldown_time</code> settings for this.)', warn:['pa'], set:{circ:{value:'OPEN (cooldown)'}}, dur:4400},
    {caption:'Provider B now returns <b>429</b> for this tenant. The policy allows <b>degraded mode</b> for low-priority traffic: route to small model C with a shorter answer limit. Premium traffic still queues for A/B. Degradation is a product decision written down in advance, not an on-call improvisation.', ok:['pc'], packets:[{edge:'gc',label:'degraded'}], set:{route:{value:'small model C (degraded)'}}, dur:4800},
    {caption:'<b>Metering</b> uses the usage block returned by the model (input, cached input, output tokens), not the estimate. The tenant’s quota is charged <b>after</b> the response finishes, so a long stream is never cut mid-way; the next request sees the updated counter.', hl:['met'], packets:[{edge:'gm',label:'usage'}], set:{q:{value:0.62, text:'1.24M / 2.00M TPM'}, cost:{value:'3,100 in · 410 out'}}, dur:4600},
    {caption:'<b>Audit record</b>: request id, tenant, principal, model and route chosen, fallback reason, guardrail verdicts, token counts and cost. Raw prompt text is stored only if the data policy allows it. This record is what FinOps, security and incident reviews all read.', hl:['met'], ok:['gw'], dur:4400}
  ]
});

/* ---------- 2.2.1 Request through the cache layers ---------- */
Anim.register({
  id:'v2-cache-layers', title:'One request through every cache layer: hit or miss at each', w:960, h:430,
  elements:[
    {type:'node', id:'req', x:20, y:120, w:100, h:60, label:'Request', icon:'user'},
    {type:'node', id:'ex', x:140, y:120, w:130, h:60, label:'Exact cache', sub:'Redis', icon:'cache'},
    {type:'node', id:'sem', x:290, y:120, w:140, h:60, label:'Semantic cache', sub:'vector index', icon:'search'},
    {type:'node', id:'rag', x:450, y:120, w:140, h:60, label:'Retrieval cache', sub:'ids + scores', icon:'db'},
    {type:'node', id:'eng', x:610, y:120, w:150, h:60, label:'Engine (vLLM)', sub:'prefix KV blocks', icon:'gpu'},
    {type:'node', id:'out', x:780, y:120, w:150, h:60, label:'Response', sub:'streamed', icon:'check'},
    {type:'edge', id:'a1', from:'req', to:'ex'},
    {type:'edge', id:'a2', from:'ex', to:'sem'},
    {type:'edge', id:'a3', from:'sem', to:'rag'},
    {type:'edge', id:'a4', from:'rag', to:'eng'},
    {type:'edge', id:'a5', from:'eng', to:'out'},
    {type:'label', id:'qtxt', x:20, y:40, text:'Request A: "What is the economy baggage allowance to Riyadh?"  (tenant atlas, locale en)'},
    {type:'tokens', id:'pr', x:20, y:220, h:28, items:['system + tools 2,000','retrieved chunks 3,500','question 500']},
    {type:'label', id:'prl', x:20, y:206, text:'Prompt sent to the engine (6,000 tokens)'},
    {type:'counter', id:'lat', x:40, y:300, label:'Latency spent so far', value:'0 ms'},
    {type:'counter', id:'gpu', x:330, y:300, label:'Prompt tokens the GPU must prefill', value:'—'},
    {type:'counter', id:'res', x:640, y:300, label:'Layer result', value:'—'},
    {type:'label', id:'note', x:40, y:390, text:''}
  ],
  steps:[
    {caption:'Four caches sit on the path of one chat request, and two more (embedding and model weights) sit off to the side. Each answers a different question. Watch which ones hit for three different requests. Latencies are illustrative.', hl:['req'], dur:4200},
    {caption:'<b>Exact response cache</b>: key = hash(tenant, model, prompt-template version, locale, normalised text, generation params). First time this text is seen → <b>miss</b>. Cost: ~1 ms Redis round trip.', hl:['ex'], packets:[{edge:'a1'}], set:{lat:{value:'1 ms'}, res:{value:'exact: MISS'}}, dur:4200},
    {caption:'<b>Semantic cache</b>: embed the query (~20 ms) and search for a similar cached question. Best match scores 0.91, below the 0.95 threshold for this intent → <b>miss</b>. A miss here still cost ~25 ms. Low-hit semantic caches make latency <i>worse</i>.', hl:['sem'], packets:[{edge:'a2'}], set:{lat:{value:'26 ms'}, res:{value:'semantic: MISS (0.91)'}}, dur:4600},
    {caption:'<b>Retrieval cache</b>: key = (normalised query, index version, ACL-group hash). Another user in the same entitlement group asked this an hour ago → <b>hit</b>: chunk ids come back in 2 ms, skipping ~140 ms of search and rerank. Chunk text is re-read and ACL-checked.', ok:['rag'], packets:[{edge:'a3'}], set:{lat:{value:'28 ms'}, res:{value:'retrieval: HIT'}}, dur:4600},
    {caption:'<b>Engine prefix cache</b>: the 2,000-token system prompt + tools is already in this replica’s KV blocks (125 blocks of 16 tokens) → <b>partial hit</b>. Only 4,000 tokens are prefilled. This is a hit on <i>computation</i>, not on the answer.', ok:['eng'], packets:[{edge:'a4',label:'6,000 tok'}], set:{pr:{items:[{t:'system + tools 2,000  (cached KV)',cls:'hl'},{t:'retrieved chunks 3,500',cls:'new'},{t:'question 500',cls:'new'}]}, gpu:{value:'4,000 of 6,000'}, res:{value:'prefix: 2,000-token HIT'}}, dur:4800},
    {caption:'<b>Decode</b> writes this request’s own KV cache (per-request, private) and streams 300 tokens. That KV is working memory; only its full prefix blocks remain reusable after the request ends.', busy:['eng'], packets:[{edge:'a5',label:'tokens',count:3,cls:'c-ok'}], set:{lat:{value:'TTFT ≈ 600 ms'}}, dur:4400},
    {caption:'<b>Write-back</b>: policy classifies the answer as public FAQ (no personal data) → store it in the exact and semantic caches with a TTL and dependency tags <code>doc:baggage-policy@v7</code>, so a policy edit can invalidate it.', hl:['ex','sem'], set:{res:{value:'stored, tags doc@v7'}}, show:['note'], dur:4400},
    {caption:'Request B: <i>"economy baggage allowance for Riyadh?"</i>. Exact cache <b>misses</b> (different text) but semantic finds 0.97 ≥ 0.95, and tenant, locale and intent metadata match → <b>hit</b>. Answer returned in ~30 ms; the GPU is not touched at all.', ok:['sem','out'], packets:[{edge:'a1'},{edge:'a2',delay:300}], set:{lat:{value:'≈ 30 ms'}, gpu:{value:'0 (no model call)'}, res:{value:'semantic: HIT (0.97)'}, note:{text:'Request B paraphrase: answered from the semantic cache.'}}, dur:4800},
    {caption:'Request C: <i>"What is the baggage allowance on my booking ABC123?"</i>. It contains a personal booking reference, so policy <b>bypasses</b> both response caches. It still benefits from the retrieval cache and the prefix cache. Different caches, different safety rules.', warn:['ex','sem'], ok:['rag','eng'], set:{gpu:{value:'4,000 of 6,000'}, res:{value:'response caches BYPASSED'}, note:{text:'Request C personal: response caches bypassed; prefix + retrieval still help.'}}, dur:5000}
  ]
});

/* ---------- 2.2.2 Semantic cache false hit ---------- */
Anim.register({
  id:'v2-sem-false-hit', title:'Semantic cache false hit: similar is not the same', w:960, h:430,
  elements:[
    {type:'label', id:'l1', x:40, y:24, text:'Cached question (answer stored):'},
    {type:'tokens', id:'q1', x:40, y:36, h:26, items:['Can','I','cancel','my',{t:'flight',cls:'hl'},'booking','free','within','24h?']},
    {type:'label', id:'l2', x:40, y:84, text:'New question:'},
    {type:'tokens', id:'q2', x:40, y:96, h:26, items:['Can','I','cancel','my',{t:'hotel',cls:'new'},'booking','free','within','24h?']},
    {type:'node', id:'emb', x:40, y:170, w:160, h:60, label:'Embedding model', sub:'1,024 dims', icon:'bolt'},
    {type:'node', id:'idx', x:250, y:170, w:160, h:60, label:'Vector index', sub:'cached questions', icon:'db'},
    {type:'node', id:'gate', x:460, y:170, w:190, h:60, label:'Score ≥ threshold?', sub:'threshold 0.92', icon:'gear'},
    {type:'node', id:'ans', x:720, y:170, w:210, h:60, label:'Return cached answer', sub:'no model call', icon:'cache'},
    {type:'node', id:'meta', x:460, y:300, w:190, h:60, label:'Slot + metadata check', sub:'product, locale, tenant', icon:'shield'},
    {type:'node', id:'llm', x:720, y:300, w:210, h:60, label:'Call the model', sub:'miss path', icon:'llm'},
    {type:'edge', id:'s1', from:'emb', to:'idx'},
    {type:'edge', id:'s2', from:'idx', to:'gate'},
    {type:'edge', id:'s3', from:'gate', to:'ans'},
    {type:'edge', id:'s4', from:'gate', to:'meta', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'s5', from:'meta', to:'llm'},
    {type:'counter', id:'sim', x:40, y:290, label:'Cosine similarity', value:'—'},
    {type:'counter', id:'verdict', x:40, y:360, label:'Outcome', value:'—'}
  ],
  steps:[
    {caption:'The cache holds an answer to a <b>flight</b> cancellation question (a fictional Atlas policy: free cancellation within 24 hours for flights). A new user asks about a <b>hotel</b>. One word differs, and it is the word that decides the answer.', hl:['q1','q2'], dur:4400},
    {caption:'Both questions are embedded into 1,024-dimension vectors. Embeddings capture overall meaning: <i>cancel, booking, free, 24 hours</i> dominate. "flight" vs "hotel" moves the vector only a little.', hl:['emb'], packets:[{edge:'s1',label:'vector'}], dur:4200},
    {caption:'Nearest neighbour: the flight question, <b>cosine similarity 0.96</b> (illustrative but typical for one-word swaps in short sentences).', hl:['idx'], packets:[{edge:'s2'}], set:{sim:{value:'0.96'}}, dur:4000},
    {caption:'0.96 ≥ 0.92 → the naive cache <b>returns the flight answer</b> to a hotel question. The user is told hotel cancellation is free when the hotel’s rate is non-refundable. This is a <b>false hit</b>: fast, confident and wrong.', bad:['ans','gate'], packets:[{edge:'s3',label:'flight answer',cls:'c-bad'}], set:{verdict:{value:'FALSE HIT (wrong answer served)'}}, dur:5000},
    {caption:'Why a hit-rate dashboard hides this: the event is counted as a <b>hit</b> and a saving. Only labelled evaluation (pairs that look alike but need different answers) or user complaints reveal it.', warn:['gate'], dur:4400},
    {caption:'<b>Fix 1 — slot check</b>: extract key entities (product = hotel vs flight, route, fare class) and require them to match exactly. Similarity proposes a candidate; rules decide whether it is applicable.', ok:['meta'], packets:[{edge:'s4',label:'candidate'}], set:{verdict:{value:'product mismatch → reject'}}, dur:4600},
    {caption:'<b>Fix 2 — scope the index</b>: search only entries with the same tenant, locale, intent and policy version (metadata filters), and use per-intent thresholds tuned on your own labelled near-miss set. <b>Fix 3</b>: a cross-encoder or small judge model verifies the pair before serving.', hl:['meta','idx'], dur:4800},
    {caption:'The rejected candidate falls through to the <b>model</b>, which answers correctly using retrieved hotel policy. The new answer may be cached under its own slots. Cost of the check: a few ms. Cost of the false hit: a refund dispute.', ok:['llm'], packets:[{edge:'s5',label:'miss path'}], set:{verdict:{value:'correct answer, 1 model call'}}, dur:4600}
  ]
});

/* ---------- 2.2.3 Prefix cache block-hash match ---------- */
Anim.register({
  id:'v2-prefix-hash', title:'Automatic prefix caching: chained block hashes decide what is reused', w:960, h:430,
  elements:[
    {type:'label', id:'r1l', x:40, y:22, text:'Request 1 (tenant A): 100 prompt tokens = 6 full blocks of 16 + a 4-token tail'},
    {type:'tokens', id:'r1', x:40, y:34, h:28, items:['B0 sys','B1 sys','B2 tools','B3 tools','B4 user','B5 user','tail 4']},
    {type:'label', id:'r2l', x:40, y:92, text:'Request 2:'},
    {type:'tokens', id:'r2', x:40, y:104, h:28, items:['—']},
    {type:'node', id:'tbl', x:40, y:170, w:300, h:80, label:'Block hash table', sub:'hash → physical KV block', icon:'memory'},
    {type:'label', id:'fx', x:380, y:190, text:'hᵢ = H( hᵢ₋₁ , 16 token ids of block i , extras )\nextras: LoRA id, image hashes, cache_salt (block 0 only)\nOnly FULL blocks are hashed and cached'},
    {type:'counter', id:'hit', x:40, y:290, label:'Blocks reused for request 2', value:'—'},
    {type:'counter', id:'skip', x:360, y:290, label:'Prefill tokens skipped', value:'—'},
    {type:'counter', id:'met', x:680, y:290, label:'prefix_cache_hits / queries', value:'—'},
    {type:'label', id:'lesson', x:40, y:380, text:''}
  ],
  steps:[
    {caption:'vLLM splits each prompt into <b>blocks</b> of 16 tokens. Request 1 has 100 tokens: 6 full blocks plus a 4-token tail. Each full block gets a hash that includes the <b>previous block’s hash</b>, so a hash identifies the whole prefix up to that block, not just 16 tokens.', hl:['r1','fx'], dur:4800},
    {caption:'After prefill, the 6 full blocks are registered in the <b>hash table</b>. The tail is not (only full blocks are cached). When request 1 ends, the blocks stay in GPU memory as <b>evictable</b> cached blocks until space is needed.', ok:['tbl'], set:{r1:{items:[{t:'B0 h₀',cls:'hl'},{t:'B1 h₁',cls:'hl'},{t:'B2 h₂',cls:'hl'},{t:'B3 h₃',cls:'hl'},{t:'B4 h₄',cls:'hl'},{t:'B5 h₅',cls:'hl'},'tail 4']}}, dur:4600},
    {caption:'Request 2 (same tenant) has the same system prompt and tools (blocks 0–3) and a different question. The engine walks block by block: h₀ found, h₁ found, h₂ found, h₃ found, h₄ <b>not found</b> → stop.', hl:['tbl'], set:{r2:{items:[{t:'B0 h₀ ✓',cls:'hl'},{t:'B1 h₁ ✓',cls:'hl'},{t:'B2 h₂ ✓',cls:'hl'},{t:'B3 h₃ ✓',cls:'hl'},{t:'B4 h₄′ ✗',cls:'new'},{t:'B5 h₅′',cls:'new'},'tail 9']}, hit:{value:'4 blocks'}}, dur:4800},
    {caption:'Result: 4 × 16 = <b>64 tokens</b> of prefill skipped; the remaining 41 tokens are computed. The engine counts this in tokens: queries += 105, hits += 64. Hit rate for this request = 64 / 105 ≈ 61 %.', ok:['hit'], set:{skip:{value:'64 of 105'}, met:{value:'+64 / +105 tokens'}}, dur:4600},
    {caption:'Request 3 puts <b>today’s date</b> at the top of the system prompt. Block 0 changes, so h₀ changes, and because every later hash chains from h₀, <b>every</b> block misses. One volatile token at the start destroys the whole prefix.', bad:['r2'], set:{r2:{items:[{t:'B0 h₀″ ✗',cls:'new'},{t:'B1 ✗',cls:'new'},{t:'B2 ✗',cls:'new'},{t:'B3 ✗',cls:'new'},{t:'B4 ✗',cls:'new'},{t:'B5 ✗',cls:'new'},'tail']}, hit:{value:'0 blocks'}, skip:{value:'0'}, lesson:{text:'Rule: stable content first, volatile content (dates, user data) last.'}}, show:['lesson'], dur:5000},
    {caption:'Tenant B sends a prompt <b>identical</b> to request 1. Without isolation it would hit tenant A’s blocks, and its lower latency would reveal that someone else sent that prefix. With a per-tenant <code>cache_salt</code> mixed into block 0, its hashes differ → no cross-tenant reuse.', warn:['tbl'], set:{r2:{items:[{t:'B0 salt=B ✗',cls:'new'},{t:'B1 ✗',cls:'new'},{t:'B2 ✗',cls:'new'},{t:'B3 ✗',cls:'new'},{t:'B4 ✗',cls:'new'},{t:'B5 ✗',cls:'new'},'tail']}, lesson:{text:'cache_salt per tenant: sharing only among requests that agree on the salt.'}}, dur:5200},
    {caption:'<b>Eviction</b>: when a new request needs blocks and none are free, the engine evicts the least-recently-used cached block whose reference count is 0. Blocks in use by running requests are never evicted. Longest-prefix tail blocks go first, keeping the shared head alive longer.', hl:['tbl'], dur:4800},
    {caption:'What prefix caching does <b>not</b> do: it never skips decode, never shares an answer, and never reuses a block whose token ids differ by even one token. It is exact, computation-level reuse inside one engine instance.', ok:['fx'], set:{lesson:{text:'Prefix cache = exact reuse of prefill computation, per replica.'}}, dur:4600}
  ]
});

/* ---------- 2.2.4 Cache-aware routing ---------- */
Anim.register({
  id:'v2-cache-routing', title:'Cache-aware routing: prefix affinity versus least-loaded', w:960, h:430,
  elements:[
    {type:'node', id:'rq', x:30, y:60, w:180, h:60, label:'Request', sub:'8,192-token prompt', icon:'doc'},
    {type:'node', id:'rt', x:30, y:200, w:180, h:70, label:'KV-aware router', sub:'scores replicas', icon:'gear'},
    {type:'node', id:'ra', x:330, y:60, w:240, h:70, label:'Replica A', sub:'holds 6,144 tokens of this prefix', icon:'gpu'},
    {type:'node', id:'rb', x:330, y:290, w:240, h:70, label:'Replica B', sub:'cold for this prefix, lightly loaded', icon:'gpu'},
    {type:'edge', id:'r0', from:'rq', to:'rt'},
    {type:'edge', id:'ea', from:'rt', to:'ra'},
    {type:'edge', id:'eb', from:'rt', to:'rb'},
    {type:'bar', id:'qa', x:620, y:70, w:300, h:20, label:'Replica A queue wait', value:0.3, text:'300 ms', thresholds:false},
    {type:'counter', id:'ta', x:620, y:120, label:'Estimated TTFT on A', value:'—'},
    {type:'bar', id:'qb', x:620, y:300, w:300, h:20, label:'Replica B queue wait', value:0.04, text:'40 ms', thresholds:false},
    {type:'counter', id:'tb', x:620, y:350, label:'Estimated TTFT on B', value:'—'},
    {type:'label', id:'pol', x:30, y:400, text:''}
  ],
  steps:[
    {caption:'A request with an 8,192-token prompt arrives: a long shared policy document plus a question. Replica A already holds 6,144 tokens of that prefix in its KV cache. Replica B holds none but is nearly idle. Assume both prefill at a measured 16,000 tokens/s.', hl:['rq'], packets:[{edge:'r0'}], dur:4600},
    {caption:'<b>Round-robin or least-loaded</b> would pick B: shortest queue (40 ms). But B must prefill all 8,192 tokens: 8,192 / 16,000 = 512 ms. <b>TTFT on B ≈ 40 + 512 = 552 ms.</b>', hl:['rb'], set:{tb:{value:'40 + 512 = 552 ms'}}, dur:4600},
    {caption:'On A only 8,192 − 6,144 = 2,048 tokens need prefill: 2,048 / 16,000 = 128 ms. Queue is longer (300 ms). <b>TTFT on A ≈ 300 + 128 = 428 ms.</b> The cache saves more than the queue costs.', hl:['ra'], set:{ta:{value:'300 + 128 = 428 ms'}}, dur:4600},
    {caption:'The router picks <b>A</b>. It also saves 6,144 tokens of GPU prefill work fleet-wide, which raises capacity for everyone, not just this request’s TTFT.', ok:['ra'], packets:[{edge:'ea',label:'route A',cls:'c-ok'}], set:{pol:{text:'Decision: A (cache benefit 384 ms > extra queue 260 ms)'}}, show:['pol'], dur:4400},
    {caption:'Popularity creates a <b>hot spot</b>: every request for this document goes to A. A’s queue grows to 600 ms. Now A = 600 + 128 = 728 ms, B = 552 ms. Pure affinity (sticky routing) would keep sending to A and break the SLO.', warn:['ra'], set:{qa:{value:0.6, text:'600 ms'}, ta:{value:'600 + 128 = 728 ms'}}, dur:4800},
    {caption:'A load-aware score flips the decision to <b>B</b>. B pays one full prefill, and from now on <b>both</b> replicas hold the prefix: the popular prefix has been replicated by routing, not by configuration.', ok:['rb'], packets:[{edge:'eb',label:'route B',cls:'c-ok'}], set:{pol:{text:'Decision: B (A overloaded); prefix now warm on A and B'}, rb:{label:'Replica B'}}, dur:4800},
    {caption:'Real routers combine both terms. NVIDIA Dynamo (v1.5.1) scores each worker by <b>prefill blocks still to compute after cache-overlap credit, plus decode blocks</b>, and picks the lowest cost. llm-d’s endpoint picker and the SGLang router use prefix-match and load scorers in the same spirit.', hl:['rt'], dur:4800},
    {caption:'How the router knows what A holds: either <b>approximate</b> (it remembers where it sent earlier prefixes) or <b>exact</b> (engines publish block-stored / block-evicted events to an index). Approximate can be wrong after evictions; exact costs an event stream per replica.', hl:['rt','ra','rb'], dur:4800},
    {caption:'Measure it: fleet-wide prefix hit rate (tokens), per-replica queue time, and TTFT p95. Good cache-aware routing raises hit rate <i>and</i> keeps queue time balanced. If hit rate rises while p95 TTFT also rises, affinity is too strong.', ok:['ta','tb'], dur:4600}
  ]
});

/* ---------- 2.2.4 KV offload tiers ---------- */
Anim.register({
  id:'v2-kv-offload', title:'KV offload tiers: GPU HBM → CPU DRAM → local NVMe', w:960, h:430,
  elements:[
    {type:'mem', id:'hbm', x:40, y:50, w:880, h:36, label:'GPU HBM (per node, 8 × 80 GB) — fastest, smallest', segs:[{frac:.45,cls:'w',label:'weights (70B, TP=8)'},{frac:.35,cls:'kv',label:'active KV'},{frac:.20,cls:'act',label:'cached prefixes P1–P3'}]},
    {type:'mem', id:'dram', x:40, y:150, w:880, h:36, label:'CPU DRAM (e.g. 1,000 GiB set aside for KV) — larger, over PCIe', segs:[{frac:.25,cls:'kv',label:'P4–P9'},{frac:.75,cls:'free',label:'free'}]},
    {type:'mem', id:'ssd', x:40, y:250, w:880, h:36, label:'Local NVMe SSD (tens of TB) — largest, slowest', segs:[{frac:.10,cls:'kv',label:'P10+'},{frac:.90,cls:'free',label:'free'}]},
    {type:'edge', id:'up1', from:'hbm', to:'dram', label:'PCIe'},
    {type:'edge', id:'up2', from:'dram', to:'ssd', label:'NVMe'},
    {type:'counter', id:'ev', x:40, y:330, label:'Event', value:'—'},
    {type:'counter', id:'cost', x:400, y:330, label:'Time to get prefix KV back', value:'—'},
    {type:'counter', id:'alt', x:700, y:330, label:'Recompute instead', value:'≈ 370 ms'}
  ],
  steps:[
    {caption:'A 70B-shape model (320 KiB of KV per token in BF16) on one 8-GPU node with tensor parallelism 8. HBM holds weights, the KV of running requests, and <b>cached prefix blocks</b> P1–P3 that no running request uses (evictable).', hl:['hbm'], dur:4600},
    {caption:'A burst of new requests needs blocks. <b>Without offload</b>, LRU eviction simply frees P1’s blocks: that work is lost. If P1 comes back, an 8,192-token prefill must be redone: ≈ 2 × 70.6×10⁹ × 8,192 FLOPs ≈ 1.16×10¹⁵ FLOPs, ≈ 370 ms at an assumed 40 % of 8 × 989 TFLOPS.', warn:['hbm'], set:{ev:{value:'evict P1 (no offload)'}}, dur:5200},
    {caption:'<b>With an offload connector</b> (vLLM OffloadingConnector, LMCache, or Dynamo KVBM), evicted blocks are <b>copied</b> to CPU DRAM before their HBM is reused. The copy runs asynchronously so decode is not blocked.', hl:['dram'], packets:[{edge:'up1',label:'P1 blocks'}], set:{hbm:{segs:[{frac:.45,cls:'w',label:'weights'},{frac:.45,cls:'kv',label:'active KV (grew)'},{frac:.10,cls:'act',label:'P2–P3'}]}, dram:{segs:[{frac:.30,cls:'kv',label:'P1, P4–P9'},{frac:.70,cls:'free',label:'free'}]}, ev:{value:'P1 → CPU DRAM'}}, dur:5000},
    {caption:'When DRAM fills, the coldest prefixes spill to <b>local NVMe</b>. Each tier is an LRU cache in front of the next. Nothing here is durable storage: losing a tier only costs recomputation.', hl:['ssd'], packets:[{edge:'up2',label:'cold'}], set:{dram:{segs:[{frac:.92,cls:'kv',label:'P1, P4–P40'},{frac:.08,cls:'free'}]}, ssd:{segs:[{frac:.30,cls:'kv',label:'P41+'},{frac:.70,cls:'free',label:'free'}]}, ev:{value:'spill to NVMe'}}, dur:4800},
    {caption:'P1 returns. Its 8,192 tokens = 2.5 GiB of KV, but with TP=8 each GPU needs only its 320 MiB shard, loaded in parallel. At an assumed 25 GB/s effective per GPU: 335 MB / 25 GB/s ≈ <b>13 ms</b> versus ≈ 370 ms recompute.', ok:['dram'], packets:[{edge:'up1',label:'load P1',reverse:true,cls:'c-ok'}], set:{cost:{value:'≈ 13 ms from DRAM'}, ev:{value:'P1 hit in CPU tier'}}, dur:5000},
    {caption:'P50 is only on NVMe. Reading 2.5 GiB at an assumed 20 GB/s aggregate across the node’s drives ≈ <b>134 ms</b>. Slower than DRAM, still faster than recompute. These transfer rates are assumptions: measure your own.', ok:['ssd'], packets:[{edge:'up2',label:'load P50',reverse:true,cls:'c-ok'}], set:{cost:{value:'≈ 134 ms from NVMe'}, ev:{value:'P50 hit in SSD tier'}}, dur:5000},
    {caption:'A 256-token prefix: recompute is only ≈ 11 ms. Loading it saves a few milliseconds but still costs a lookup, PCIe bandwidth and tier capacity that long prefixes need more. <b>Offload pays most for long, frequently re-used prefixes</b>; set a minimum length and measure.', warn:['ssd'], set:{cost:{value:'small prefix: saves only ms'}, alt:{value:'≈ 11 ms (256 tok)'}}, dur:4800},
    {caption:'<b>Capacity</b>: 1,000 GiB DRAM ÷ 320 KiB per token ≈ 3.28 million tokens ≈ 400 prefixes of 8,192 tokens. HBM after weights held only a few dozen. Offload turns a per-GPU cache into a per-node cache.', hl:['dram'], set:{ev:{value:'1,000 GiB / 320 KiB ≈ 3.28 M tok'}, alt:{value:'≈ 370 ms (8k tok)'}}, dur:4800},
    {caption:'<b>Failure mode</b>: NVMe shared with model-weight loading or logs becomes contended; loads take 400 ms and TTFT p99 gets <i>worse</i> than recompute. Watch load latency per tier and let the connector fall back to recompute above a threshold.', bad:['ssd'], set:{cost:{value:'contended: 400 ms (worse!)'}, ev:{value:'tier latency SLO breached'}}, dur:5000}
  ]
});

/* ---------- 2.2.6 Invalidation on document and permission change ---------- */
Anim.register({
  id:'v2-cache-invalidation', title:'Invalidation: a policy document changes, then a permission is revoked', w:960, h:430,
  elements:[
    {type:'node', id:'cms', x:30, y:60, w:160, h:60, label:'Policy CMS', sub:'source of truth', icon:'doc'},
    {type:'node', id:'idp', x:30, y:280, w:160, h:60, label:'IdP / groups', sub:'entitlements', icon:'key'},
    {type:'node', id:'cdc', x:240, y:170, w:160, h:60, label:'CDC → Kafka', sub:'change events', icon:'queue'},
    {type:'node', id:'inv', x:450, y:170, w:170, h:60, label:'Invalidator', sub:'dependency index', icon:'gear'},
    {type:'node', id:'rc', x:690, y:20, w:240, h:56, label:'Retrieval cache', sub:'key has index + ACL ver', icon:'cache'},
    {type:'node', id:'resp', x:690, y:110, w:240, h:56, label:'Response + semantic', sub:'tagged doc ids', icon:'cache'},
    {type:'node', id:'embc', x:690, y:200, w:240, h:56, label:'Embedding cache', sub:'key = content hash', icon:'memory'},
    {type:'node', id:'vidx', x:690, y:290, w:240, h:56, label:'Vector index', sub:'chunks + ACL metadata', icon:'db'},
    {type:'edge', id:'c1', from:'cms', to:'cdc'},
    {type:'edge', id:'c2', from:'idp', to:'cdc'},
    {type:'edge', id:'c3', from:'cdc', to:'inv'},
    {type:'edge', id:'i1', from:'inv', to:'rc'},
    {type:'edge', id:'i2', from:'inv', to:'resp'},
    {type:'edge', id:'i3', from:'inv', to:'embc'},
    {type:'edge', id:'i4', from:'inv', to:'vidx'},
    {type:'counter', id:'evt', x:240, y:330, label:'Event', value:'—'},
    {type:'counter', id:'lag', x:450, y:330, label:'Stale window', value:'—'}
  ],
  steps:[
    {caption:'Steady state: the baggage policy is <code>doc:baggage@v7</code>. Derived state exists in four places: retrieval results, cached answers (exact and semantic), chunk embeddings and the vector index. Each cached answer carries the tags of the documents it was built from.', hl:['rc','resp','embc','vidx'], dur:4800},
    {caption:'An editor publishes <b>v8</b> (allowance changes from 23 kg to 30 kg). Change data capture emits an event to Kafka: doc id, new version, changed sections. A DevOps team already knows this pattern from Debezium pipelines.', hl:['cms','cdc'], packets:[{edge:'c1',label:'baggage v8'}], set:{evt:{value:'doc baggage v7 → v8'}}, dur:4800},
    {caption:'The invalidator looks up the <b>dependency index</b> (tag → cache keys) and deletes every response and semantic entry tagged <code>doc:baggage@v7</code>, plus retrieval entries that returned its chunks. TTL alone would have served "23 kg" for hours.', bad:['resp','rc'], packets:[{edge:'c3'},{edge:'i1',delay:500,cls:'c-bad',label:'purge'},{edge:'i2',delay:500,cls:'c-bad',label:'purge'}], set:{lag:{value:'event → purge: seconds'}}, dur:5000},
    {caption:'Embedding cache: keys are <b>content hashes</b> of chunks (plus embedding-model version). Only 3 of 40 chunks changed, so 37 hit and 3 are re-embedded. Nothing to purge: a changed chunk simply has a new key.', ok:['embc'], packets:[{edge:'i3',label:'3 new chunks'}], dur:4600},
    {caption:'The vector index upserts the 3 new chunk vectors and deletes the old ones. Until that finishes, retrieval keys include the <b>index version</b>, so no request mixes old and new results in one cached entry.', hl:['vidx'], packets:[{edge:'i4',label:'upsert'}], dur:4600},
    {caption:'Prefix KV caches and provider prompt caches need <b>no</b> invalidation: the new text produces different tokens, therefore different block hashes. Old blocks age out by LRU or TTL. Exact-match caches invalidate themselves; derived caches do not.', ok:['inv'], dur:4600},
    {caption:'Now a <b>permission change</b>: an agent is removed from group <code>finance-staff</code>. The IdP event bumps that user’s <b>ACL version</b>. Retrieval keys include an ACL-group hash, so the old entries are unreachable for this user immediately, and read-time authorization re-checks every chunk.', bad:['rc'], hl:['idp'], packets:[{edge:'c2',label:'group removed'},{edge:'c3',delay:500}], set:{evt:{value:'ACL change: user removed'}}, dur:5200},
    {caption:'<b>Race</b>: a request that started before the purge finishes after it and writes a v7 answer back into the cache. Fix: write-back is conditional on the document versions it read still being current (compare-and-set on a version or generation number).', warn:['resp'], set:{lag:{value:'race: stale re-insert'}}, dur:5000},
    {caption:'Measure invalidation as an SLO: event-to-purge lag p99, number of stale hits found by sampling audits, and purge failures. For permissions the target is "no access after revocation", which is enforced by read-time checks, not by purge speed.', ok:['inv','rc','resp'], set:{lag:{value:'SLO: p99 purge lag < 60 s'}}, dur:4600}
  ]
});
