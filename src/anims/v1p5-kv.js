/* Animations for the KV cache lesson (exemplar) */
Anim.register({
  id:'v1-kv-growth', title:'KV cache: why decode does not recompute the prompt', w:960, h:430,
  elements:[
    {type:'tokens', id:'seq', x:40, y:40, h:28, items:['The','GPU','node','is']},
    {type:'label', id:'seql', x:40, y:24, text:'Sequence so far (tokens the model has seen)'},
    {type:'node', id:'model', x:40, y:110, w:200, h:70, label:'Transformer layers', sub:'× 32 layers', icon:'llm'},
    {type:'node', id:'new', x:300, y:110, w:150, h:70, label:'New token only', sub:'computes q, k, v', icon:'bolt'},
    {type:'node', id:'kv', x:520, y:100, w:200, h:90, label:'KV cache', sub:'k, v of every past token', icon:'memory'},
    {type:'node', id:'out', x:780, y:110, w:150, h:70, label:'Next token', sub:'sampled', icon:'check'},
    {type:'edge', id:'e1', from:'model', to:'new'},
    {type:'edge', id:'e2', from:'new', to:'kv', label:'append k,v'},
    {type:'edge', id:'e3', from:'kv', to:'out', label:'attend'},
    {type:'mem', id:'hbm', x:40, y:290, w:880, h:44, label:'GPU HBM — 24 GB card (illustrative)', segs:[{frac:.67,cls:'w',label:'weights 16 GB (8B × 2 B)'},{frac:.03,cls:'kv',label:''},{frac:.30,cls:'free',label:'free'}]},
    {type:'counter', id:'kvsize', x:40, y:370, label:'KV for this sequence', value:'4 tokens × 128 KiB = 512 KiB'},
    {type:'counter', id:'work', x:520, y:370, label:'Attention work this step', value:'—'}
  ],
  steps:[
    {caption:'<b>Prefill.</b> The prompt "The GPU node is" enters. All 4 tokens are processed <i>in parallel</i> through all 32 layers. Each layer computes a key (k) and value (v) vector for every token.', hl:['model'], dur:3800},
    {caption:'Those k and v vectors are <b>stored</b> in the KV cache in GPU memory. For a Llama-3.1-8B-shaped model (32 layers, 8 KV heads, head size 128, BF16) that is 128 KiB per token.', hl:['kv'], packets:[{edge:'e2',label:'k,v ×4',cls:'c-purple'}], set:{hbm:{segs:[{frac:.67,cls:'w',label:'weights 16 GB'},{frac:.01,cls:'kv'},{frac:.32,cls:'free',label:'free'}]}}, dur:4200},
    {caption:'<b>Decode step 1.</b> The model samples "down". Only the <i>new</i> token goes through the layers. It produces its own q, k and v.', hl:['new'], set:{seq:{items:['The','GPU','node','is',{t:'down',cls:'new'}]}, work:{value:'1 query × 5 keys'}}, packets:[{edge:'e1',label:'"down"'}], dur:3800},
    {caption:'Its query attends over the <b>cached</b> keys and values of all earlier tokens. Nothing from the prompt is recomputed. Its own k,v are appended, so the cache grows by one token (+128 KiB).', hl:['kv'], ok:['kv'], packets:[{edge:'e2',label:'+1',cls:'c-purple'},{edge:'e3',label:'attend',delay:600,cls:'c-blue'}], set:{kvsize:{value:'5 tokens × 128 KiB = 640 KiB'}}, dur:4200},
    {caption:'<b>Decode step 2…n.</b> Same pattern every step: one token in, one token out, cache grows linearly. Work per step grows with sequence length (one query against n keys), but we never redo the O(n²) prefill.', hl:['new','kv','out'], set:{seq:{items:['The','GPU','node','is','down',{t:'.',cls:'new'}]}, kvsize:{value:'6 tokens × 128 KiB = 768 KiB'}, work:{value:'1 query × 6 keys'}}, packets:[{edge:'e1'},{edge:'e2',delay:400,cls:'c-purple'},{edge:'e3',delay:800,cls:'c-blue'}], dur:4200},
    {caption:'Scale it up: one 8,192-token conversation holds 8,192 × 128 KiB = <b>1 GiB</b> of KV. The weights did not change size. KV is per-request working memory.', set:{kvsize:{value:'8,192 tokens × 128 KiB = 1 GiB'}, hbm:{segs:[{frac:.67,cls:'w',label:'weights 16 GB'},{frac:.045,cls:'kv',label:''},{frac:.285,cls:'free',label:'free'}]}}, hl:['kvsize'], dur:4200},
    {caption:'Now 7 such conversations run concurrently: 7 GiB of KV. The card is nearly full. The <b>eighth</b> long request cannot be admitted, or the engine must preempt one. This is why concurrency × context length — not weight size — sets serving capacity.', set:{hbm:{segs:[{frac:.67,cls:'w',label:'weights 16 GB'},{frac:.31,cls:'kv',label:'KV 7 × 1 GiB'},{frac:.02,cls:'free'}]}, kvsize:{value:'7 sequences × 1 GiB = 7 GiB'}}, warn:['kv'], dur:5000},
    {caption:'A ninth request arrives. With no free KV memory, a naive server crashes with CUDA OOM. A good engine (vLLM, SGLang, TensorRT-LLM) instead <b>queues</b> it or <b>preempts</b> a running sequence, then recomputes it later. You see this as rising queue time (TTFT), not as a crash.', bad:['kv'], set:{work:{value:'queue / preempt'}}, dur:5000}
  ]
});

Anim.register({
  id:'v1-paged-attention', title:'PagedAttention: KV blocks like virtual-memory pages', w:960, h:440,
  elements:[
    {type:'label', id:'t1', x:40, y:30, text:'BEFORE: contiguous reservation per request (max length reserved up front)'},
    {type:'mem', id:'contig', x:40, y:44, w:880, h:40, segs:[{frac:.10,cls:'kv',label:'A used'},{frac:.23,cls:'frag',label:'A reserved, empty'},{frac:.05,cls:'kv',label:'B'},{frac:.28,cls:'frag',label:'B reserved, empty'},{frac:.34,cls:'free',label:'too small for C'}]},
    {type:'label', id:'t2', x:40, y:130, text:'AFTER: fixed-size blocks (e.g. 16 tokens) allocated on demand from a shared pool'},
    {type:'grid', id:'pool', x:40, y:150, rows:3, cols:16, cell:30, values:[[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]},
    {type:'node', id:'tableA', x:560, y:150, w:170, h:60, label:'Block table A', sub:'logical → physical'},
    {type:'node', id:'tableB', x:560, y:230, w:170, h:60, label:'Block table B', sub:'logical → physical'},
    {type:'node', id:'tableC', x:760, y:190, w:170, h:60, label:'Block table C', sub:'shares A’s prefix', hidden:true},
    {type:'counter', id:'waste', x:40, y:280, label:'Wasted KV memory', value:'contiguous: up to 51% in this picture'},
    {type:'label', id:'note', x:40, y:350, text:'', hidden:true}
  ],
  steps:[
    {caption:'<b>The old way.</b> Each request reserves KV memory for its <i>maximum</i> possible length. Most of it sits empty (red). Request C does not fit even though, in total, there is enough free memory. This is internal + external fragmentation.', hl:['contig'], dur:4500},
    {caption:'<b>PagedAttention</b> (vLLM, SOSP 2023) splits KV memory into fixed-size <b>blocks</b>. A per-request <b>block table</b> maps logical block 0,1,2… to any free physical block, like an OS page table.', hl:['pool','tableA','tableB'], dur:4500},
    {caption:'Request A has 40 tokens → 3 blocks (16+16+8). Blocks are allocated <i>only as tokens are produced</i>. They do not need to be adjacent.', set:{pool:{values:[[1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]}}, hl:['tableA'], dur:4000},
    {caption:'Request B gets its own blocks from the same pool. The only waste is the unfilled part of each request’s <i>last</i> block (under 16 tokens).', set:{pool:{values:[[1,0.55,0,1,0,0,0,0.55,0,0,0,0,0,0,0,0],[0,0,0.55,0,0,0,1,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]}, waste:{value:'paged: < 1 block per request'}}, hl:['tableB'], dur:4000},
    {caption:'Request C has the <b>same system-prompt prefix</b> as A. Its block table points at A’s physical blocks for that prefix (reference-counted, copy-on-write). This is the basis of <b>prefix caching</b>: shared prefix KV is stored once.', show:['tableC'], set:{pool:{values:[[1,0.55,0,1,0,0,0,0.55,0,0,0,0,0,0,0,0],[0,0,0.55,0,0,0,1,0,0,0.3,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]}}, ok:['tableC'], dur:4800},
    {caption:'When a request finishes, its blocks return to the free pool immediately and the scheduler can admit the next request. The engine’s capacity metric is now simply <b>free blocks</b> — which is exactly what vLLM exports as KV-cache usage.', set:{pool:{values:[[0,0,0,0,0,0,0,0.55,0,0,0,0,0,0,0,0],[0,0,0.55,0,0,0,0,0,0,0.3,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]}}, show:['note'], dim:['tableA'], dur:4500},
    {caption:'What paging does <b>not</b> do: it does not shrink each token’s KV (that is GQA, MLA or FP8 KV quantization), and it does not create memory. It removes waste so more requests fit in the same HBM.', set:{note:{text:'Paging removes fragmentation. Model architecture and KV dtype set bytes per token.'}}, dur:4500}
  ]
});
