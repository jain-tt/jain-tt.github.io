/* Animations for Volume 1, Part 5 (inference engineering), except the KV-cache lesson */

/* ---------- Cold start: from pod scheduled to ready ---------- */
Anim.register({
  id:'v1-inf-coldstart', title:'Cold start of an 8B model server: where the minutes go (illustrative timings)', w:960, h:420,
  elements:[
    {type:'node', id:'pull', x:20, y:60, w:116, h:60, label:'Pull image', sub:'engine container'},
    {type:'node', id:'dl', x:154, y:60, w:116, h:60, label:'Download', sub:'16 GB weights'},
    {type:'node', id:'load', x:288, y:60, w:116, h:60, label:'Load to GPU', sub:'safetensors'},
    {type:'node', id:'prof', x:422, y:60, w:116, h:60, label:'Profile + KV', sub:'size KV pool'},
    {type:'node', id:'graphs', x:556, y:60, w:116, h:60, label:'CUDA graphs', sub:'capture sizes'},
    {type:'node', id:'warm', x:690, y:60, w:116, h:60, label:'Warm-up', sub:'first requests'},
    {type:'node', id:'ready', x:824, y:60, w:116, h:60, label:'Ready', sub:'probe passes', icon:'check'},
    {type:'edge', id:'c1', from:'pull', to:'dl'},
    {type:'edge', id:'c2', from:'dl', to:'load'},
    {type:'edge', id:'c3', from:'load', to:'prof'},
    {type:'edge', id:'c4', from:'prof', to:'graphs'},
    {type:'edge', id:'c5', from:'graphs', to:'warm'},
    {type:'edge', id:'c6', from:'warm', to:'ready'},
    {type:'mem', id:'hbm', x:20, y:200, w:920, h:44, label:'GPU HBM (80 GiB H100, vLLM budget 92 %)', segs:[{frac:1,cls:'free',label:'empty'}]},
    {type:'counter', id:'t', x:20, y:290, label:'Time since pod was scheduled', value:'0 s'},
    {type:'counter', id:'why', x:360, y:290, label:'What dominates this phase', value:'—'}
  ],
  steps:[
    {caption:'A new replica is scheduled on a GPU node. First the <b>container image</b> must be present. Inference images are several GB; on a cold node, pulling can take tens of seconds or more (assume 60 s here). Pre-pulled or cached images make this ≈0.', hl:['pull'], set:{t:{value:'≈ 60 s'}, why:{value:'image size ÷ registry bandwidth'}}, dur:4600},
    {caption:'<b>Download weights.</b> Time = size ÷ bandwidth. 16.06 GB over a 10 Gb/s path (1.25 GB/s) ≈ <b>12.8 s</b>. A 70B model (141 GB) at the same rate ≈ <b>113 s</b>. Local NVMe cache, a node-level model cache or an OCI image volume avoids repeating it.', hl:['dl'], packets:[{edge:'c1',label:'16 GB',cls:'c-purple'}], set:{t:{value:'≈ 73 s'}, why:{value:'16.06 GB ÷ 1.25 GB/s ≈ 12.8 s'}}, dur:5200},
    {caption:'<b>Load to GPU.</b> safetensors files are memory-mapped and copied tensor by tensor into HBM (no pickle, no full read into RAM first). Disk read speed and PCIe set the pace; assume ≈8 s here.', hl:['load'], packets:[{edge:'c2',label:'mmap',cls:'c-purple'}], set:{hbm:{segs:[{frac:.19,cls:'w',label:'weights 15 GiB'},{frac:.81,cls:'free',label:'free'}]}, t:{value:'≈ 81 s'}, why:{value:'disk → host → PCIe → HBM'}}, dur:4600},
    {caption:'<b>Profile and allocate KV.</b> The engine runs a dummy forward pass at its maximum batch to measure peak activation memory, then turns everything left inside its budget into <b>KV blocks</b>. The log line reporting KV capacity (tokens) is the most useful line in the startup log.', hl:['prof'], packets:[{edge:'c3'}], set:{hbm:{segs:[{frac:.19,cls:'w',label:'weights'},{frac:.03,cls:'act',label:''},{frac:.70,cls:'kv',label:'KV pool ≈ 56 GiB'},{frac:.08,cls:'free',label:'headroom'}]}, t:{value:'≈ 86 s'}, why:{value:'profiling run, block allocation'}}, dur:5200},
    {caption:'<b>Capture CUDA graphs</b> for a set of decode batch sizes so each decode step is one launch. This takes seconds and some memory. Disabling it (eager mode) starts faster but decodes slower.', hl:['graphs'], packets:[{edge:'c4'}], set:{t:{value:'≈ 101 s'}, why:{value:'one capture per batch size'}}, dur:4600},
    {caption:'<b>Warm-up.</b> First real requests may still pay for lazy initialisation and kernel autotuning. Send a few synthetic requests before taking traffic.', hl:['warm'], packets:[{edge:'c5'}], set:{t:{value:'≈ 103 s'}, why:{value:'lazy init, autotuning'}}, dur:4000},
    {caption:'<b>Ready.</b> Only now should the readiness probe pass (vLLM exposes <code>/health</code>). Total ≈ 100 s in this illustration, most of it moving bytes. An HPA that adds a replica at t = 0 gets capacity ≈ 2 minutes later — plus node provisioning if no GPU node was free.', ok:['ready'], packets:[{edge:'c6',cls:'c-ok'}], set:{t:{value:'≈ 103 s to serve'}, why:{value:'bytes: image + weights'}}, dur:5200},
    {caption:'Levers, biggest first: keep images and weights cached on nodes; use faster storage paths; keep a warm minimum of replicas; scale on queue/KV signals early. These are operations decisions, not model decisions — see the Kubernetes serving and autoscaling lessons.', hl:['pull','dl'], dur:5000}
  ]
});

/* ---------- Prefill vs decode timeline with TTFT/TPOT markers ---------- */
Anim.register({
  id:'v1-inf-timeline', title:'One request’s life: queue → prefill → first token → decode (TTFT, TPOT, ITL, E2E)', w:960, h:430,
  elements:[
    {type:'timeline', id:'tl', x:30, y:50, w:900, h:100, labelW:150, cols:16, ticks:true, xlabel:'time → (each column = 20 ms, illustrative)', rows:[{id:'r1',label:'R1: 1,000-token prompt'},{id:'r2',label:'R2: 4,000-token prompt'}]},
    {type:'label', id:'m1', x:392, y:186, text:'▲ R1 first token: TTFT = 100 ms', hidden:true},
    {type:'label', id:'m2', x:628, y:206, text:'▲ R2 first token: TTFT = 200 ms', hidden:true},
    {type:'tokens', id:'out', x:40, y:236, h:26, items:[]},
    {type:'counter', id:'ttft', x:40, y:300, label:'TTFT (R1)', value:'—'},
    {type:'counter', id:'tpot', x:270, y:300, label:'TPOT (R1)', value:'—'},
    {type:'counter', id:'itl', x:500, y:300, label:'ITL (each gap)', value:'—'},
    {type:'counter', id:'e2e', x:730, y:300, label:'E2E (R1)', value:'—'},
    {type:'label', id:'f', x:40, y:395, text:'', hidden:true}
  ],
  steps:[
    {caption:'R1 arrives. The engine’s scheduler has no free slot for 2 iterations, so it <b>waits in the queue</b> (40 ms). Queue time is invisible to the model but fully visible to the user.', set:{tl:{cells:[{row:'r1',col:0,cls:'wait',text:'queue',span:2}]}}, dur:4200},
    {caption:'<b>Prefill.</b> All 1,000 prompt tokens go through the model in one parallel pass (compute-bound, big matrix multiplies). Their keys and values are written to the KV cache. 60 ms here.', set:{tl:{cells:[{row:'r1',col:2,cls:'pre',text:'prefill 1,000 tok',span:3}]}}, dur:4400},
    {caption:'The prefill pass also produces the logits for the <b>first output token</b>. It streams to the client: <b>TTFT = queue + prefill (+ network) = 40 + 60 = 100 ms</b>.', show:['m1'], set:{out:{items:[{t:'Your',cls:'new'}]}, ttft:{value:'100 ms'}}, dur:4600},
    {caption:'<b>Decode.</b> Each iteration generates one more token for this sequence, reading all weights and its KV cache (memory-bound). Each gap between streamed tokens is an <b>ITL</b> sample; here 20 ms each.', set:{tl:{cells:[{row:'r1',col:5,cls:'dec',text:'t2'},{row:'r1',col:6,cls:'dec',text:'t3'},{row:'r1',col:7,cls:'dec',text:'t4'},{row:'r1',col:8,cls:'dec',text:'t5'},{row:'r1',col:9,cls:'dec',text:'t6'}]}, out:{items:['Your','flight','to','Riyadh','is',{t:'on',cls:'new'}]}, itl:{value:'20, 20, 20, 20, 20 ms'}}, dur:4800},
    {caption:'R1 finishes after 12 output tokens. <b>E2E = 320 ms</b>. <b>TPOT</b> = (E2E − TTFT) ÷ (output tokens − 1) = (320 − 100) ÷ 11 = <b>20 ms</b>, i.e. 50 tokens/s for this user.', set:{tl:{cells:[{row:'r1',col:10,cls:'dec',text:'t7'},{row:'r1',col:11,cls:'dec',text:'t8'},{row:'r1',col:12,cls:'dec',text:'t9'},{row:'r1',col:13,cls:'dec',text:'t10'},{row:'r1',col:14,cls:'dec',text:'t11'},{row:'r1',col:15,cls:'dec',text:'t12'}]}, out:{items:['Your','flight','to','Riyadh','is','on','time',',','gate','B','12',{t:'.',cls:'new'}]}, tpot:{value:'(320 − 100) ÷ 11 = 20 ms'}, e2e:{value:'320 ms'}}, ok:['e2e'], dur:5200},
    {caption:'R2 has a <b>4× longer prompt</b>. Same queue wait, but prefill takes 160 ms (more tokens; attention cost even grows faster than linearly with length). TTFT = 40 + 160 = <b>200 ms</b>. Long prompts hurt TTFT, not TPOT.', show:['m2'], set:{tl:{cells:[{row:'r2',col:0,cls:'wait',text:'queue',span:2},{row:'r2',col:2,cls:'pre',text:'prefill 4,000 tokens',span:8}]}}, dur:5000},
    {caption:'R2 then decodes at about the same TPOT (slightly slower per token because each step reads a longer KV cache). <b>TTFT is a prefill-and-queue metric; TPOT is a decode metric.</b> Diagnose them separately.', set:{tl:{cells:[{row:'r2',col:10,cls:'dec',text:'t2'},{row:'r2',col:11,cls:'dec',text:'t3'},{row:'r2',col:12,cls:'dec',text:'t4'},{row:'r2',col:13,cls:'dec',text:'t5'},{row:'r2',col:14,cls:'dec',text:'t6'},{row:'r2',col:15,cls:'dec',text:'t7'}]}}, dur:4600},
    {caption:'Caveat: we drew R1 and R2 as if each had the GPU alone. In one engine, R2’s 160 ms prefill would run in the same iterations as R1’s decode steps and R1 would see one <b>ITL spike</b>. Chunked prefill (next lesson) exists to cap that spike.', show:['f'], set:{f:{text:'E2E = TTFT + TPOT × (output tokens − 1)\nper-user speed ≈ 1 ÷ TPOT'}}, warn:['tl'], dur:5200}
  ]
});

/* ---------- Continuous batching: 4 users arriving at different times ---------- */
Anim.register({
  id:'v1-inf-continuous', title:'Continuous batching: four users arrive at different times (max 3 sequences per batch)', w:960, h:420,
  elements:[
    {type:'timeline', id:'tl', x:30, y:50, w:900, h:200, labelW:120, cols:14, ticks:true, xlabel:'engine iteration (one forward pass each)', rows:[{id:'A',label:'User A'},{id:'B',label:'User B'},{id:'C',label:'User C'},{id:'D',label:'User D'}]},
    {type:'counter', id:'bs', x:40, y:300, label:'Sequences in this iteration', value:'—'},
    {type:'counter', id:'ev', x:330, y:300, label:'Scheduler decision', value:'—'},
    {type:'label', id:'lg', x:40, y:390, text:'purple = prefill, blue = decode step, amber = waiting for a free slot / KV blocks'}
  ],
  steps:[
    {caption:'<b>Continuous batching</b> (Orca, OSDI 2022: “iteration-level scheduling”) re-forms the batch at <b>every forward pass</b>. Requests join as soon as there is room and leave the moment they finish. In this toy the engine runs at most 3 sequences at once.', dur:4400},
    {caption:'Iteration 1: A arrives and is prefilled alone. Iteration 2: A decodes its next token. The GPU is under-used but nobody is waiting.', set:{tl:{cells:[{row:'A',col:0,cls:'pre',text:'P'},{row:'A',col:1,cls:'dec'}]}, bs:{value:'1'}, ev:{value:'admit A'}}, dur:4200},
    {caption:'Iteration 3: B arrives. B’s <b>prefill joins the same iteration</b> as A’s decode step — a mixed batch. B does not wait for A to finish, and A does not pause.', set:{tl:{cells:[{row:'A',col:2,cls:'dec'},{row:'B',col:2,cls:'pre',text:'P'},{row:'A',col:3,cls:'dec'},{row:'B',col:3,cls:'dec'}]}, bs:{value:'2'}, ev:{value:'admit B into running batch'}}, ok:['bs'], dur:4600},
    {caption:'Iteration 4: C arrives and joins too. Now 3 sequences share each weight read from HBM, so the GPU produces ≈3× the tokens per iteration for roughly the same step time (decode is memory-bound).', set:{tl:{cells:[{row:'C',col:3,cls:'pre',text:'P'},{row:'A',col:4,cls:'dec'},{row:'B',col:4,cls:'dec'},{row:'C',col:4,cls:'dec'}]}, bs:{value:'3 (full)'}, ev:{value:'admit C'}}, dur:4600},
    {caption:'Iteration 6: D arrives but the batch is full (in a real engine: max-num-seqs reached or not enough free KV blocks). D <b>waits</b>. This wait is the queue time inside D’s TTFT.', set:{tl:{cells:[{row:'A',col:5,cls:'dec'},{row:'B',col:5,cls:'dec'},{row:'C',col:5,cls:'dec'},{row:'D',col:5,cls:'wait'},{row:'A',col:6,cls:'dec'},{row:'B',col:6,cls:'dec'},{row:'C',col:6,cls:'dec'},{row:'D',col:6,cls:'wait'}]}, bs:{value:'3'}, ev:{value:'D queued: no free slot'}}, warn:['ev'], dur:4800},
    {caption:'A emits its last token at iteration 7 and its KV blocks are freed <b>immediately</b>. In iteration 8 the scheduler admits D (prefill) alongside B and C. With static batching, D would have waited for the whole batch to finish.', set:{tl:{cells:[{row:'D',col:7,cls:'pre',text:'P'},{row:'B',col:7,cls:'dec'},{row:'C',col:7,cls:'dec'}]}, bs:{value:'3'}, ev:{value:'A done → admit D'}}, ok:['ev'], dur:4800},
    {caption:'C finishes at iteration 8; B at 10; D at 13. The batch shrinks as users finish — and would refill instantly if more requests were waiting.', set:{tl:{cells:[{row:'B',col:8,cls:'dec'},{row:'D',col:8,cls:'dec'},{row:'B',col:9,cls:'dec'},{row:'D',col:9,cls:'dec'},{row:'D',col:10,cls:'dec'},{row:'D',col:11,cls:'dec'},{row:'D',col:12,cls:'dec'}]}, bs:{value:'2 → 1'}, ev:{value:'retire finished sequences'}}, dur:4600},
    {caption:'Result: A, B and C started generating in the iteration they arrived; D waited 2 iterations. No request waited for another request to <b>finish</b>, only for <b>room</b>. Throughput comes from keeping the batch full; latency protection comes from limits on batch size and per-iteration token budget.', bs:{value:'—'}, set:{ev:{value:'room-limited, not batch-limited'}}, hl:['tl'], dur:5200}
  ]
});

/* ---------- Static vs continuous batching ---------- */
Anim.register({
  id:'v1-inf-static-vs-cont', title:'Static batching vs continuous batching with the same six requests', w:960, h:440,
  elements:[
    {type:'label', id:'t1', x:30, y:22, text:'STATIC: batch of 4 runs until its longest member finishes; E and F wait for the next batch'},
    {type:'timeline', id:'st', x:30, y:48, w:900, h:150, labelW:90, cols:14, ticks:true, rows:[{id:'A',label:'A (3 tok)'},{id:'B',label:'B (8 tok)'},{id:'C',label:'C (2 tok)'},{id:'D',label:'D (5 tok)'},{id:'E',label:'E (4 tok)'},{id:'F',label:'F (2 tok)'}]},
    {type:'label', id:'t2', x:30, y:222, text:'CONTINUOUS: max 4 running; a finished slot is refilled at the next iteration', hidden:true},
    {type:'timeline', id:'ct', x:30, y:236, w:900, h:150, labelW:90, cols:14, rows:[{id:'A',label:'A'},{id:'B',label:'B'},{id:'C',label:'C'},{id:'D',label:'D'},{id:'E',label:'E'},{id:'F',label:'F'}]},
    {type:'counter', id:'cs', x:30, y:400, label:'Static: all done after', value:'—'},
    {type:'counter', id:'cc', x:500, y:400, label:'Continuous: all done after', value:'—'}
  ],
  steps:[
    {caption:'Six requests: A–D arrive at iteration 1, E and F one iteration later. Their output lengths differ (3, 8, 2, 5, 4, 2 decode steps) — as real chat outputs do. The GPU fits 4 sequences at a time.', dur:4200},
    {caption:'<b>Static batch 1.</b> A–D are prefilled together and decode in lock-step. C finishes after 2 steps, A after 3, D after 5 — but their slots stay occupied as <b>padding</b> until B finishes at step 8. Useful slot-iterations: 22 of 36 (61 %).', set:{st:{cells:[
      {row:'A',col:0,cls:'pre',text:'P'},{row:'B',col:0,cls:'pre',text:'P'},{row:'C',col:0,cls:'pre',text:'P'},{row:'D',col:0,cls:'pre',text:'P'},
      {row:'A',col:1,cls:'dec',span:3},{row:'A',col:4,cls:'idle',text:'padding',span:5},
      {row:'B',col:1,cls:'dec',span:8},
      {row:'C',col:1,cls:'dec',span:2},{row:'C',col:3,cls:'idle',text:'padding',span:6},
      {row:'D',col:1,cls:'dec',span:5},{row:'D',col:6,cls:'idle',text:'padding',span:3}]}}, dur:5600},
    {caption:'E and F arrived at iteration 2 but cannot join a running static batch. They <b>wait 8 iterations</b> while three of the four slots are doing nothing useful.', set:{st:{cells:[{row:'E',col:1,cls:'wait',text:'waiting',span:8},{row:'F',col:1,cls:'wait',text:'waiting',span:8}]}}, bad:['st'], dur:4600},
    {caption:'<b>Static batch 2</b> runs E and F (F pads after 2 steps). Everything is done after <b>14 iterations</b>.', set:{st:{cells:[{row:'E',col:9,cls:'pre',text:'P'},{row:'F',col:9,cls:'pre',text:'P'},{row:'E',col:10,cls:'dec',span:4},{row:'F',col:10,cls:'dec',span:2},{row:'F',col:12,cls:'idle',text:'pad',span:2}]}, cs:{value:'14 iterations (E waited 8)'}}, dur:4600},
    {caption:'<b>Continuous batching</b>, same requests. A–D start together. C finishes after iteration 3; in iteration 4 its slot goes to <b>E</b>. A finishes after iteration 4; in iteration 5 its slot goes to <b>F</b>.', show:['t2'], set:{ct:{cells:[
      {row:'A',col:0,cls:'pre',text:'P'},{row:'B',col:0,cls:'pre',text:'P'},{row:'C',col:0,cls:'pre',text:'P'},{row:'D',col:0,cls:'pre',text:'P'},
      {row:'A',col:1,cls:'dec',span:3},{row:'B',col:1,cls:'dec',span:8},{row:'C',col:1,cls:'dec',span:2},{row:'D',col:1,cls:'dec',span:5},
      {row:'E',col:1,cls:'wait',span:2},{row:'E',col:3,cls:'pre',text:'P'},{row:'E',col:4,cls:'dec',span:4},
      {row:'F',col:1,cls:'wait',span:3},{row:'F',col:4,cls:'pre',text:'P'},{row:'F',col:5,cls:'dec',span:2}]}}, ok:['ct'], dur:5600},
    {caption:'Everything is done after <b>9 iterations instead of 14</b>, E waited 2 iterations instead of 8, and no slot carried padding. Same GPU, same model, same requests: the only change is <b>when</b> the scheduler is allowed to change the batch.', set:{cc:{value:'9 iterations (E waited 2)'}}, ok:['cc'], dur:5200},
    {caption:'Why engines can do this: PagedAttention gives each sequence its own KV blocks, so sequences of different lengths can sit in one batch without padding, and attention kernels handle ragged batches. Static batching still appears in offline batch jobs and in simple servers — know which one your stack uses.', dur:5000}
  ]
});

/* ---------- Chunked prefill ---------- */
Anim.register({
  id:'v1-inf-chunked', title:'Chunked prefill: a 6,000-token prompt without freezing everyone else', w:960, h:430,
  elements:[
    {type:'label', id:'t1', x:30, y:22, text:'WITHOUT chunking: the whole prompt is one huge iteration'},
    {type:'timeline', id:'nc', x:30, y:46, w:900, h:120, labelW:120, cols:15, ticks:true, rows:[{id:'A',label:'decode A'},{id:'B',label:'decode B'},{id:'C',label:'new prompt C'}]},
    {type:'label', id:'t2', x:30, y:198, text:'WITH chunked prefill (token budget 2,048 per iteration)', hidden:true},
    {type:'timeline', id:'ch', x:30, y:214, w:900, h:120, labelW:120, cols:15, rows:[{id:'A',label:'decode A'},{id:'B',label:'decode B'},{id:'C',label:'new prompt C'}]},
    {type:'counter', id:'g1', x:40, y:360, label:'Worst gap between A’s tokens', value:'—'},
    {type:'counter', id:'g2', x:400, y:360, label:'TTFT of C (after it arrives)', value:'—'},
    {type:'label', id:'unit', x:700, y:380, text:'1 column ≈ 20 ms (illustrative)'}
  ],
  steps:[
    {caption:'A and B are streaming answers, one token per ≈20 ms iteration. Then C arrives with a <b>6,000-token</b> prompt (a long policy document). Assume its prefill takes ≈180 ms on this GPU (illustrative).', set:{nc:{cells:[{row:'A',col:0,cls:'dec'},{row:'A',col:1,cls:'dec'},{row:'B',col:0,cls:'dec'},{row:'B',col:1,cls:'dec'}]}}, dur:4600},
    {caption:'<b>Without chunking</b>, C’s whole prefill is one iteration. A and B are in that same iteration but get only one token each at its end: their streams <b>freeze for ≈180 ms</b>.', set:{nc:{cells:[{row:'C',col:2,cls:'pre',text:'prefill 6,000 tokens ≈ 180 ms',span:9},{row:'A',col:2,cls:'wait',text:'stalled',span:9},{row:'B',col:2,cls:'wait',text:'stalled',span:9}]}}, bad:['nc'], dur:5000},
    {caption:'Streams resume. A’s worst inter-token gap was ≈ <b>200 ms</b> (10 columns) instead of 20 ms — the kind of p99 ITL spike users notice as stutter.', set:{nc:{cells:[{row:'A',col:11,cls:'dec',span:4},{row:'B',col:11,cls:'dec',span:4},{row:'C',col:11,cls:'dec',span:4}]}, g1:{value:'no chunking: ≈ 200 ms'}, g2:{value:'no chunking: ≈ 180 ms'}}, dur:4600},
    {caption:'<b>With chunked prefill</b> (SARATHI / Sarathi-Serve), each iteration has a token budget, e.g. 2,048 (vLLM: <code>--max-num-batched-tokens</code>). C’s prompt is split into 2,048 + 2,048 + 1,904 tokens. Decode tokens for A and B ride along in the same iterations.', show:['t2'], set:{ch:{cells:[{row:'A',col:0,cls:'dec'},{row:'A',col:1,cls:'dec'},{row:'B',col:0,cls:'dec'},{row:'B',col:1,cls:'dec'},{row:'C',col:2,cls:'pre',text:'chunk 1',span:3},{row:'A',col:2,cls:'dec',text:'tok',span:3},{row:'B',col:2,cls:'dec',text:'tok',span:3}]}}, dur:5400},
    {caption:'Chunks 2 and 3 follow. A and B now receive a token every ≈60 ms during C’s prefill instead of freezing for 180 ms.', set:{ch:{cells:[{row:'C',col:5,cls:'pre',text:'chunk 2',span:3},{row:'C',col:8,cls:'pre',text:'chunk 3',span:3},{row:'A',col:5,cls:'dec',text:'tok',span:3},{row:'A',col:8,cls:'dec',text:'tok',span:3},{row:'B',col:5,cls:'dec',text:'tok',span:3},{row:'B',col:8,cls:'dec',text:'tok',span:3}]}}, ok:['ch'], dur:4800},
    {caption:'C’s first token arrives at about the same time (in practice slightly later: chunks re-read earlier KV, and decodes share the iterations). Worst gap for A drops from ≈200 ms to ≈60 ms.', set:{ch:{cells:[{row:'A',col:11,cls:'dec',span:4},{row:'B',col:11,cls:'dec',span:4},{row:'C',col:11,cls:'dec',span:4}]}, g1:{value:'≈ 200 ms → ≈ 60 ms'}, g2:{value:'≈ 180 ms → ≈ 180 ms or a bit more'}}, ok:['g1'], dur:5200},
    {caption:'The knob is a trade-off: a <b>smaller</b> token budget smooths ITL for running users but stretches long-prompt TTFT and lowers prefill efficiency; a <b>larger</b> budget does the reverse. vLLM V1 enables chunked prefill by default whenever possible; its docs suggest values above 8,192 for throughput-oriented setups.', dur:5200}
  ]
});

/* ---------- Speculative decoding accept/reject ---------- */
Anim.register({
  id:'v1-inf-specdec', title:'Speculative decoding: draft proposes, target verifies in one pass', w:960, h:420,
  elements:[
    {type:'label', id:'cl', x:40, y:26, text:'Accepted text so far'},
    {type:'tokens', id:'ctx', x:40, y:38, h:28, items:['Your','flight','to','Riyadh']},
    {type:'node', id:'draft', x:40, y:96, w:220, h:56, label:'Draft (small model / head)', sub:'proposes k = 4 tokens', icon:'bolt'},
    {type:'node', id:'target', x:680, y:96, w:240, h:56, label:'Target model', sub:'1 forward pass, 5 positions', icon:'llm'},
    {type:'edge', id:'dt', from:'draft', to:'target', label:'4 proposals'},
    {type:'label', id:'dl', x:40, y:186, text:'Draft proposals'},
    {type:'tokens', id:'dr', x:40, y:198, h:28, items:[]},
    {type:'label', id:'vl', x:40, y:256, text:'Target verdict'},
    {type:'tokens', id:'ver', x:40, y:268, h:28, items:[]},
    {type:'counter', id:'acc', x:40, y:330, label:'Accepted drafts this round', value:'—'},
    {type:'counter', id:'out', x:330, y:330, label:'Tokens gained per target pass', value:'—'},
    {type:'counter', id:'exp', x:620, y:330, label:'Expected (α = 0.8, k = 4)', value:'—'}
  ],
  steps:[
    {caption:'Normal decode produces <b>one token per target forward pass</b>, and each pass is memory-bound (it reads all weights). A cheap <b>draft</b> — a small model, an EAGLE head, MTP heads, or n-gram lookup in the prompt — guesses the next k = 4 tokens.', set:{dr:{items:[{t:'is',cls:'hl'},{t:'delayed',cls:'hl'},{t:'by',cls:'hl'},{t:'two',cls:'hl'}]}}, hl:['draft'], dur:5000},
    {caption:'The <b>target</b> runs <b>one</b> forward pass over the context plus all 4 drafted tokens, like a tiny prefill. In a memory-bound regime that costs about the same as a normal one-token step, and yields the target’s own distribution at all 5 positions.', packets:[{edge:'dt',label:'is delayed by two',cls:'c-blue'}], hl:['target'], dur:5000},
    {caption:'Compare left to right. “is” ✓, “delayed” ✓, “by” ✓ — the target agrees (with rejection sampling, each is accepted with probability min(1, p_target ÷ p_draft)). “two” ✗ — the target strongly prefers “45”. Everything after the first rejection is discarded.', set:{ver:{items:[{t:'✓ is',cls:'new'},{t:'✓ delayed',cls:'new'},{t:'✓ by',cls:'new'},{t:'✗ two',cls:'hl'}]}, acc:{value:'3 of 4'}}, dur:5200},
    {caption:'At the rejected position the target samples its own correction, “45”. This round produced <b>4 tokens from one target pass</b> instead of 1. The output distribution is exactly the target’s: speculative decoding with proper rejection sampling is lossless.', set:{ctx:{items:['Your','flight','to','Riyadh',{t:'is',cls:'new'},{t:'delayed',cls:'new'},{t:'by',cls:'new'},{t:'45',cls:'new'}]}, out:{value:'4 (3 accepted + 1 correction)'}}, ok:['out'], dur:5000},
    {caption:'Good round: the draft proposes “minutes . Sorry for” and all 4 are accepted. The target’s pass also yields the <b>next</b> token for free (“the”): <b>5 tokens</b> from one pass — the maximum, k + 1.', set:{dr:{items:[{t:'minutes',cls:'hl'},{t:'.',cls:'hl'},{t:'Sorry',cls:'hl'},{t:'for',cls:'hl'}]}, ver:{items:[{t:'✓ minutes',cls:'new'},{t:'✓ .',cls:'new'},{t:'✓ Sorry',cls:'new'},{t:'✓ for',cls:'new'},{t:'+ the',cls:'new'}]}, ctx:{items:['Your','flight','to','Riyadh','is','delayed','by','45',{t:'minutes',cls:'new'},{t:'.',cls:'new'},{t:'Sorry',cls:'new'},{t:'for',cls:'new'},{t:'the',cls:'new'}]}, acc:{value:'4 of 4'}, out:{value:'5 (k + 1)'}}, ok:['out'], dur:5200},
    {caption:'Bad round: the very first draft token is rejected. The pass still yields 1 token (the target’s correction), so you never get <i>fewer</i> tokens than normal decode — but you paid for the draft work and a slightly bigger verification pass.', set:{dr:{items:[{t:'inconvenience',cls:'hl'},{t:'caused',cls:'hl'},{t:'by',cls:'hl'},{t:'weather',cls:'hl'}]}, ver:{items:[{t:'✗ inconvenience',cls:'hl'}]}, acc:{value:'0 of 4'}, out:{value:'1 (the correction)'}}, warn:['out'], dur:5000},
    {caption:'On average, with per-token acceptance rate α and k drafts: expected tokens per target pass = (1 − α^(k+1)) ÷ (1 − α). For α = 0.8, k = 4: (1 − 0.32768) ÷ 0.2 ≈ <b>3.36</b>. For α = 0.6: ≈ 2.31. Speed-up also divides by the draft’s cost.', set:{exp:{value:'≈ 3.36 tokens / pass'}}, hl:['exp'], dur:5200},
    {caption:'When it stops paying: at <b>high batch</b> the target is already closer to compute-bound, so verifying 5 positions per sequence costs real FLOPs; on <b>low-acceptance</b> traffic (creative writing, other languages than the draft was trained on) α falls. Measure acceptance rate and TPOT at your real load before enabling it.', warn:['target'], dur:5200}
  ]
});

/* ---------- Engine stack layering ---------- */
Anim.register({
  id:'v1-inf-stack', title:'The serving stack: gateway → router (Dynamo / llm-d) → engine → GPU', w:960, h:440,
  elements:[
    {type:'zone', id:'k8s', x:305, y:20, w:640, h:405, label:'Kubernetes (Dynamo operator, llm-d, or KServe manage these)'},
    {type:'node', id:'user', x:20, y:190, w:105, h:56, label:'Clients', icon:'user'},
    {type:'node', id:'gw', x:145, y:190, w:145, h:56, label:'AI gateway', sub:'auth · quotas', icon:'shield'},
    {type:'node', id:'router', x:320, y:190, w:180, h:56, label:'Inference router', sub:'Dynamo / llm-d EPP', icon:'gear'},
    {type:'node', id:'e1', x:540, y:60, w:180, h:56, label:'Prefill worker', sub:'vLLM engine'},
    {type:'node', id:'e2', x:540, y:190, w:180, h:56, label:'Decode worker', sub:'vLLM engine'},
    {type:'node', id:'e3', x:540, y:320, w:180, h:56, label:'Aggregated worker', sub:'SGLang or TRT-LLM'},
    {type:'node', id:'g1', x:760, y:60, w:170, h:56, label:'2 GPUs', sub:'TP = 2 on NVLink', icon:'gpu', cls:'v2'},
    {type:'node', id:'g2', x:760, y:190, w:170, h:56, label:'2 GPUs', sub:'TP = 2', icon:'gpu', cls:'v2'},
    {type:'node', id:'g3', x:760, y:320, w:170, h:56, label:'1 GPU', sub:'whole request', icon:'gpu', cls:'v2'},
    {type:'node', id:'plan', x:320, y:330, w:180, h:56, label:'Planner / autoscaler', sub:'scale to TTFT/ITL SLO', icon:'chart'},
    {type:'edge', id:'a1', from:'user', to:'gw'},
    {type:'edge', id:'a2', from:'gw', to:'router'},
    {type:'edge', id:'a3', from:'router', to:'e1'},
    {type:'edge', id:'a4', from:'router', to:'e2'},
    {type:'edge', id:'a5', from:'router', to:'e3'},
    {type:'edge', id:'kv', from:'e1', to:'e2', fromSide:'bottom', toSide:'top', label:'KV via NIXL'},
    {type:'edge', id:'b1', from:'e1', to:'g1'},
    {type:'edge', id:'b2', from:'e2', to:'g2'},
    {type:'edge', id:'b3', from:'e3', to:'g3'},
    {type:'edge', id:'p1', from:'plan', to:'e3', cls:'dash'}
  ],
  steps:[
    {caption:'Four layers with four different jobs. Most confusion about “inference engines” comes from mixing them up. Follow one chat request from left to right.', dur:4200},
    {caption:'<b>AI gateway</b>: authentication, tenant quotas, token rate limits, model-name routing, audit. It is not GPU-aware. Examples: Agent Router (formerly Envoy AI Gateway), Kong, a cloud API gateway. Covered in the AI gateway lesson.', hl:['gw'], packets:[{edge:'a1',label:'POST /v1/chat/completions'}], dur:5000},
    {caption:'<b>Inference router</b>: picks the best <i>replica</i> using model-server state — KV-cache overlap with the prompt, queue depth, load. NVIDIA Dynamo’s KV router and llm-d’s endpoint picker (via Gateway API Inference Extension) live here. A router <b>does not run kernels</b>; it is not an engine.', hl:['router'], packets:[{edge:'a2'},{edge:'a3',delay:500,cls:'c-purple'}], dur:5400},
    {caption:'<b>Engine</b>: vLLM, SGLang or TensorRT-LLM. Owns the scheduler (continuous batching), the KV-cache block manager, the model executor and the kernels. This is where TTFT and TPOT are actually produced.', hl:['e1','e2','e3'], dur:5000},
    {caption:'<b>Disaggregated serving</b> (optional): a prefill worker computes the prompt’s KV and ships it to a decode worker (Dynamo uses NIXL for this transfer). Prefill and decode pools can then be sized and scaled separately — at the cost of moving KV bytes over the network.', hl:['kv'], packets:[{edge:'kv',label:'KV blocks',cls:'c-purple'},{edge:'a4',delay:400}], dur:5400},
    {caption:'<b>GPUs</b>: the engine’s workers run CUDA kernels; with tensor parallelism, NCCL all-reduces between GPUs inside the NVLink domain. Kubernetes only sees <code>nvidia.com/gpu</code> counts.', hl:['g1','g2','g3'], packets:[{edge:'b1',cls:'c-ok'},{edge:'b2',cls:'c-ok'},{edge:'b3',cls:'c-ok'}], dur:4800},
    {caption:'<b>Planner / autoscaler</b>: Dynamo’s Planner adjusts prefill and decode replicas to meet TTFT and ITL targets; llm-d uses KEDA on router metrics. Scaling signals come from engines (queue, KV usage), not from CPU.', hl:['plan'], packets:[{edge:'p1',label:'scale'}], dur:4800},
    {caption:'Where does <b>Triton</b> fit? Triton Inference Server (now NVIDIA Dynamo-Triton) is a multi-framework model server: it can host a TensorRT-LLM or vLLM backend next to non-LLM models (vision, embeddings, classic ML). It is a server around engines, not the LLM engine itself.', hl:['e3'], dur:5000},
    {caption:'You do not need every layer on day one. Atlas stage 4 is one vLLM engine on one GPU with its OpenAI-compatible API. Add a gateway for tenants, a cache-aware router at several replicas, and disaggregation only when measurements show prefill/decode interference.', ok:['e3','g3'], dim:['e1','e2','g1','g2','router','plan'], dur:5200}
  ]
});

/* ---------- Benchmark: knee, SLO, goodput, open vs closed loop ---------- */
Anim.register({
  id:'v1-inf-bench-knee', title:'Load test: finding the knee and the goodput at an SLO (illustrative curves)', w:960, h:430,
  elements:[
    {type:'chart', id:'lat', x:80, y:40, w:360, h:250, xmax:10, ymax:4, xlabel:'offered load (requests/s, open loop)', ylabel:'p99 TTFT (s)',
      series:[{id:'slo', label:'SLO 0.5 s', color:'var(--warn)', points:[]},{id:'p99', label:'p99 TTFT', points:[]}]},
    {type:'chart', id:'thr', x:560, y:40, w:360, h:250, xmax:10, ymax:8, xlabel:'offered load (requests/s)', ylabel:'requests/s',
      series:[{id:'tp', label:'throughput (completed)', points:[]},{id:'gp', label:'goodput (met SLO)', color:'var(--ok)', points:[]}]},
    {type:'counter', id:'load', x:80, y:345, label:'Offered load', value:'—'},
    {type:'counter', id:'res', x:330, y:345, label:'Reading', value:'—'},
    {type:'label', id:'cl', x:80, y:410, text:'Closed loop (fixed N clients) never offers more than the server completes, so this cliff never appears in its results.', hidden:true}
  ],
  steps:[
    {caption:'Method: <b>open-loop</b> load — requests arrive on a schedule (e.g. Poisson at λ req/s) whether or not earlier ones finished, like real users. For each λ, measure TTFT/TPOT percentiles and count requests that met the SLO. The amber line is the SLO: p99 TTFT ≤ 0.5 s.', set:{lat:{slo:[[0,0.5],[10,0.5]]}}, dur:5000},
    {caption:'1–4 req/s: latency is flat, the server completes everything offered, and every request meets the SLO: throughput = goodput = offered load.', set:{lat:{p99:[[1,.25],[2,.27],[3,.3],[4,.35]]}, thr:{tp:[[0,0],[1,1],[2,2],[3,3],[4,4]], gp:[[0,0],[1,1],[2,2],[3,3],[4,4]]}, load:{value:'1 → 4 req/s'}, res:{value:'healthy, under-used'}}, ok:['res'], dur:4800},
    {caption:'5–6 req/s: the <b>knee</b>. Batches are fuller, queueing starts, p99 climbs to ≈0.8 s. Throughput still rises, but some requests now miss the SLO, so goodput falls behind throughput.', set:{lat:{p99:[[1,.25],[2,.27],[3,.3],[4,.35],[5,.45],[6,.8]]}, thr:{tp:[[0,0],[1,1],[2,2],[3,3],[4,4],[5,5],[6,6]], gp:[[0,0],[1,1],[2,2],[3,3],[4,4],[5,5],[6,5.7]]}, load:{value:'5 → 6 req/s'}, res:{value:'knee: p99 rises'}}, warn:['res'], dur:5000},
    {caption:'7–8 req/s: offered load exceeds capacity (≈6.8 req/s here). In open loop the queue grows <b>without bound</b>, p99 explodes, throughput plateaus, and <b>goodput collapses</b> — the server is busy serving requests that are already too late.', set:{lat:{p99:[[1,.25],[2,.27],[3,.3],[4,.35],[5,.45],[6,.8],[7,1.9],[7.5,3.6]]}, thr:{tp:[[0,0],[1,1],[2,2],[3,3],[4,4],[5,5],[6,6],[7,6.6],[8,6.8],[10,6.8]], gp:[[0,0],[1,1],[2,2],[3,3],[4,4],[5,5],[6,5.7],[7,4],[8,1.5],[10,.3]]}, load:{value:'7 → 10 req/s'}, res:{value:'overload: goodput collapses'}}, bad:['res'], dur:5400},
    {caption:'<b>Closed-loop caution.</b> A test with a fixed number of concurrent clients waits for each response before sending the next, so it self-throttles at the server’s capacity and reports bounded latency. Useful for “how fast at concurrency N”, misleading for “what happens when traffic exceeds capacity”.', show:['cl'], dur:5200},
    {caption:'The answer to “how much can one replica handle?” is the highest load where the SLO still holds — here ≈ 5.5 req/s — not the peak throughput of 6.8. Capacity planning then adds headroom on top. Every number here is illustrative: produce your own curve with your model, GPU and token distribution.', set:{res:{value:'max load at SLO ≈ 5.5 req/s'}}, ok:['res'], dur:5400}
  ]
});
