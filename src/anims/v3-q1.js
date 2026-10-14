/* Animations for Vol 3 question-bank chapters 3.2.1–3.2.5 (v3-ch-foundations, training, gpu, inference, caching) */

/* ---- foundations ---- */
/* Animations for Vol 3 question chapter: ML foundations and LLM internals (v3-ch-foundations) */
Anim.register({
  id:'v3q-fnd-e2e', title:'An LLM request, end to end: text → tokens → layers → logits → next token', w:960, h:440,
  elements:[
    {type:'label', id:'tl', x:30, y:26, text:'Prompt text, split into tokens (illustrative split)'},
    {type:'tokens', id:'txt', x:30, y:38, h:28, items:['Is',' flight',' SV','123',' late','?']},
    {type:'node', id:'tok', x:20, y:120, w:130, h:60, label:'Tokenizer', sub:'text → IDs', icon:'doc'},
    {type:'node', id:'emb', x:180, y:120, w:140, h:60, label:'Embedding', sub:'ID → vector', icon:'memory'},
    {type:'node', id:'blk', x:350, y:120, w:170, h:60, label:'Decoder blocks', sub:'attention + MLP × 32', icon:'llm'},
    {type:'node', id:'head', x:550, y:120, w:130, h:60, label:'LM head', sub:'→ 128,256 logits', icon:'chart'},
    {type:'node', id:'samp', x:705, y:120, w:115, h:60, label:'Sampler', sub:'T, top-p', icon:'gear'},
    {type:'node', id:'detok', x:840, y:120, w:100, h:60, label:'Detokenize', sub:'stream', icon:'check'},
    {type:'edge', id:'e1', from:'tok', to:'emb'},
    {type:'edge', id:'e2', from:'emb', to:'blk'},
    {type:'edge', id:'e3', from:'blk', to:'head'},
    {type:'edge', id:'e4', from:'head', to:'samp'},
    {type:'edge', id:'e5', from:'samp', to:'detok'},
    {type:'label', id:'idl', x:30, y:222, text:'Token IDs (illustrative values)'},
    {type:'tokens', id:'ids', x:30, y:234, h:26, items:['…']},
    {type:'counter', id:'shape', x:30, y:300, label:'Tensor shape', value:'—'},
    {type:'counter', id:'phase', x:520, y:300, label:'Phase', value:'—'},
    {type:'bar', id:'kv', x:30, y:380, w:900, h:22, label:'KV cache for this request (Llama-3.1-8B shape: 128 KiB per token)', value:0, text:'0 tokens'}
  ],
  steps:[
    {caption:'<b>Text arrives.</b> The chat template has already wrapped the user message with special tokens. The tokenizer (byte-level BPE for Llama 3) splits the text into pieces from a fixed vocabulary and maps each piece to an integer ID. Six pieces here; a different model would split it differently.', hl:['tok'], set:{ids:{items:['3957','11213','13324','4513','3389','30']}, shape:{value:'[6] integer IDs'}, phase:{value:'tokenize (CPU)'}}, packets:[{edge:'e1',label:'IDs'}], dur:4500},
    {caption:'<b>Embedding lookup.</b> Each ID selects one row of a learned table of 128,256 rows × 4,096 columns (about 525 million parameters on its own). The prompt is now a matrix: 6 positions × 4,096 numbers.', hl:['emb'], set:{shape:{value:'[6, 4096] BF16 activations'}}, packets:[{edge:'e2',label:'[6,4096]'}], dur:4200},
    {caption:'<b>Prefill through 32 decoder blocks.</b> In every block, attention lets each position read from earlier positions (causal mask), then an MLP transforms each position. All 6 prompt positions are processed <i>in parallel</i>: big matrix multiplies, compute-bound. Each layer writes the keys and values of all 6 tokens into the KV cache.', hl:['blk'], busy:['blk'], set:{phase:{value:'prefill: all prompt tokens at once'}, kv:{value:0.06,text:'6 tokens × 128 KiB = 768 KiB'}}, packets:[{edge:'e3',label:'hidden'}], dur:5200},
    {caption:'<b>LM head.</b> The final hidden vector of the <i>last</i> position (4,096 numbers) is multiplied by a 4,096 × 128,256 matrix. Result: one raw score (logit) for every token in the vocabulary.', hl:['head'], set:{shape:{value:'[128256] logits (last position)'}}, packets:[{edge:'e4',label:'logits'}], dur:4200},
    {caption:'<b>Sampling.</b> Logits are divided by the temperature, turned into probabilities by softmax, filtered by top-k / top-p, and one token is drawn. Here it is " No". The time until this first token is <b>TTFT</b>: queueing + tokenization + prefill + one sampling step.', hl:['samp'], set:{txt:{items:['Is',' flight',' SV','123',' late','?',{t:' No',cls:'new'}]}, phase:{value:'first token → TTFT ends'}}, packets:[{edge:'e5',label:'" No"'}], dur:4800},
    {caption:'<b>Decode step.</b> Only the new token goes back through the 32 blocks. Its query attends over the cached keys and values; nothing earlier is recomputed. One token in, one token out, so the GPU mostly streams weights from memory: memory-bandwidth bound. The gap between tokens is <b>TPOT</b>.', hl:['blk','emb'], set:{phase:{value:'decode: 1 token per step'}, kv:{value:0.07,text:'7 tokens × 128 KiB = 896 KiB'}, shape:{value:'[1, 4096] per step'}}, packets:[{edge:'e2',label:'" No"'},{edge:'e3',delay:500},{edge:'e4',delay:900},{edge:'e5',delay:1300,label:'","'}], dur:5000},
    {caption:'<b>Repeat</b> until an end-of-sequence token, a stop string or <code>max_tokens</code>. Each token is detokenized and streamed to the client as it is produced. After 200 output tokens the KV for this one request is 206 × 128 KiB ≈ 25.8 MiB.', ok:['detok'], set:{txt:{items:['…',' late','?',' No',',',' it',' departs',' on',' time','.',{t:'<eos>',cls:'hl'}]}, kv:{value:0.22,text:'206 tokens × 128 KiB ≈ 25.8 MiB'}}, dur:4600},
    {caption:'<b>The serving view.</b> Weights are shared by every request; the KV cache is private per request and grows per token. So prefill compute sets TTFT, memory bandwidth sets TPOT, and free KV memory sets how many users fit at once. Those three facts drive almost every capacity and cost decision.', hl:['kv','blk'], set:{phase:{value:'compute → TTFT · bandwidth → TPOT · KV → concurrency'}}, dur:5200}
  ]
});

Anim.register({
  id:'v3q-fnd-attn', title:'Causal attention weights, multi-head patterns and GQA', w:960, h:420,
  elements:[
    {type:'grid', id:'att', x:130, y:80, rows:5, cols:5, cell:50, rowLabels:['The','flight','to','Riyadh','is'], colLabels:['The','flight','to','Riyadh','is'], showValues:true, maskNull:true,
      values:[[1.0,0.2,0.1,0.3,0.4],[0.5,1.2,0.1,0.9,0.3],[0.2,0.8,0.6,1.1,0.2],[0.1,0.9,1.0,1.4,0.5],[0.3,1.6,0.2,1.0,0.7]]},
    {type:'label', id:'axis', x:130, y:350, text:'rows = queries (the token doing the reading)\ncolumns = keys (the tokens being read)'},
    {type:'label', id:'eq', x:440, y:90, text:'score(i, j) = qᵢ · kⱼ / √dₖ'},
    {type:'label', id:'eq2', x:440, y:130, text:'', hidden:true},
    {type:'counter', id:'head', x:440, y:200, label:'Which head', value:'head 1 (raw scores, illustrative)'},
    {type:'counter', id:'kvh', x:440, y:270, label:'KV heads stored per layer', value:'—'},
    {type:'counter', id:'kvb', x:440, y:340, label:'KV bytes per token, Llama-3.1-70B shape, BF16', value:'—'}
  ],
  steps:[
    {caption:'<b>Raw scores.</b> Each token has a query vector q and a key vector k (learned projections of its hidden state). The score for row i, column j is the dot product qᵢ·kⱼ divided by √dₖ. High score = "this key is relevant to this query". Numbers are illustrative.', hl:['att','eq'], dur:4600},
    {caption:'<b>Causal mask.</b> A decoder may not look at the future, so every score above the diagonal is set to −∞ before softmax (shown greyed). "flight" can see "The" and itself, nothing after.', set:{att:{values:[[1.0,null,null,null,null],[0.5,1.2,null,null,null],[0.2,0.8,0.6,null,null],[0.1,0.9,1.0,1.4,null],[0.3,1.6,0.2,1.0,0.7]]}, eq2:{text:'masked: j > i  →  −∞'}}, show:['eq2'], hl:['att'], dur:4400},
    {caption:'<b>Softmax per row.</b> Each row becomes positive weights that sum to 1. Row "flight": e^0.5 = 1.65 and e^1.2 = 3.32, so weights 0.33 and 0.67. Row "is" puts 0.40 of its attention on "flight".', set:{att:{values:[[1,null,null,null,null],[0.33,0.67,null,null,null],[0.23,0.42,0.35,null,null],[0.11,0.24,0.26,0.39,null],[0.11,0.40,0.10,0.22,0.16]]}, eq2:{text:'weights = softmax(row), each row sums to 1'}}, hl:['att'], dur:4800},
    {caption:'<b>Mix the values.</b> The output for "is" is 0.11·v(The) + 0.40·v(flight) + 0.10·v(to) + 0.22·v(Riyadh) + 0.16·v(is). Attention is a learned, content-dependent weighted average: that is how context flows into each position.', set:{eq2:{text:'outputᵢ = Σⱼ weight(i, j) · vⱼ'}}, ok:['att'], dur:4600},
    {caption:'<b>Multi-head.</b> A second head in the same layer learns a different pattern, here a "previous token" head. Llama-3.1-70B runs 64 query heads of size 128 in every one of its 80 layers, then concatenates and projects them.', set:{att:{values:[[1,null,null,null,null],[0.9,0.1,null,null,null],[0.05,0.85,0.1,null,null],[0.03,0.07,0.8,0.1,null],[0.02,0.05,0.03,0.8,0.1]]}, head:{value:'head 2: attends to the previous token'}}, hl:['head'], dur:4600},
    {caption:'<b>What must be cached.</b> Future tokens will need every k and v again, so they go into the KV cache. With classic multi-head attention, all 64 heads keep their own k and v: 2 × 80 layers × 64 × 128 × 2 bytes = 2,621,440 B = 2.5 MiB per token.', set:{kvh:{value:'64 (multi-head attention)'}, kvb:{value:'2 × 80 × 64 × 128 × 2 = 2.5 MiB'}}, warn:['kvb'], dur:4800},
    {caption:'<b>Grouped-query attention.</b> Llama-3.1-70B shares each k/v head across 8 query heads: only 8 KV heads per layer. KV shrinks 8×: 2 × 80 × 8 × 128 × 2 = 327,680 B = 320 KiB per token. Same 64 query heads, 8× more users per GB of KV.', set:{kvh:{value:'8 (GQA, 64 query heads share them)'}, kvb:{value:'2 × 80 × 8 × 128 × 2 = 320 KiB'}}, ok:['kvb'], dur:5000}
  ]
});

/* ---- training ---- */
/* Animations for Vol 3 question chapter: data, training and fine-tuning */
Anim.register({
  id:'v3q-trn-recovery', title:'Distributed training: a node dies, the job recovers from a checkpoint', w:960, h:430,
  elements:[
    {type:'zone', id:'job', x:20, y:20, w:620, h:210, label:'Training job: 4 nodes × 8 GPUs (illustrative)'},
    {type:'node', id:'n0', x:40, y:50, w:130, h:60, label:'Node 0', sub:'ranks 0–7', icon:'gpu'},
    {type:'node', id:'n1', x:190, y:50, w:130, h:60, label:'Node 1', sub:'ranks 8–15', icon:'gpu'},
    {type:'node', id:'n2', x:340, y:50, w:130, h:60, label:'Node 2', sub:'ranks 16–23', icon:'gpu'},
    {type:'node', id:'n3', x:490, y:50, w:130, h:60, label:'Node 3', sub:'ranks 24–31', icon:'gpu'},
    {type:'node', id:'spare', x:340, y:150, w:130, h:60, label:'Spare node', sub:'warm standby', icon:'server', hidden:true},
    {type:'node', id:'agent', x:680, y:40, w:250, h:60, label:'Elastic agent', sub:'torchrun / job controller', icon:'gear'},
    {type:'node', id:'store', x:680, y:150, w:250, h:60, label:'Checkpoint store', sub:'sharded, async writes', icon:'db'},
    {type:'edge', id:'eck', from:'n3', to:'store', label:'shards'},
    {type:'edge', id:'eag', from:'agent', to:'n3', label:'health'},
    {type:'timeline', id:'tl', x:40, y:270, w:880, h:50, labelW:90, cols:16, ticks:true, rows:[{id:'job',label:'Job'}]},
    {type:'counter', id:'stepc', x:40, y:360, label:'Last durable checkpoint', value:'none yet'},
    {type:'counter', id:'lost', x:360, y:360, label:'Work lost if we fail now', value:'0 min'},
    {type:'counter', id:'ovh', x:680, y:360, label:'Checkpoint overhead', value:'—'}
  ],
  steps:[
    {caption:'<b>Steady state.</b> 32 GPUs run data-parallel (or FSDP) training. Every step ends in a <b>collective</b> (all-reduce or reduce-scatter) that needs <i>every</i> rank. One slow or dead rank stalls all 32.', hl:['n0','n1','n2','n3'], set:{tl:{cells:[{row:'job',col:0,cls:'dec',text:'T'},{row:'job',col:1,cls:'dec',text:'T'},{row:'job',col:2,cls:'dec',text:'T'}]}, lost:{value:'growing since job start'}}, dur:4200},
    {caption:'<b>Checkpoint.</b> Each rank writes only its own shard (model + optimizer + scheduler + RNG + data-loader position). With an <b>async</b> save, the GPUs pause only to copy state to host memory; the upload to storage overlaps with training.', busy:['store'], packets:[{edge:'eck',label:'shard',count:3,cls:'c-purple'}], set:{tl:{cells:[{row:'job',col:3,cls:'pre',text:'C'}]}, stepc:{value:'step 12,000'}, lost:{value:'0 min'}}, dur:4500},
    {caption:'Training continues. Lost-work exposure grows again until the next checkpoint. That exposure is the cost you trade against checkpoint frequency.', set:{tl:{cells:[{row:'job',col:4,cls:'dec',text:'T'},{row:'job',col:5,cls:'dec',text:'T'},{row:'job',col:6,cls:'dec',text:'T'}]}, lost:{value:'≈ 30 min of 32 GPUs'}}, dur:3800},
    {caption:'<b>Fault.</b> A GPU on Node 2 logs <b>Xid 79</b> ("fallen off the bus"). Its ranks stop. The other 24 ranks do not crash: they <i>wait</i> inside the next collective. GPU utilisation still shows busy kernels; loss stops updating.', bad:['n2'], warn:['n0','n1','n3'], set:{tl:{cells:[{row:'job',col:7,cls:'wait',text:'H'}]}}, dur:4800},
    {caption:'<b>Detection.</b> The NCCL watchdog / process-group timeout fires and the healthy ranks abort. The elastic agent sees the failed worker group. Without a sane timeout and health checks this hang can burn hours of 32 GPUs.', hl:['agent'], warn:['agent'], packets:[{edge:'eag',label:'fail',cls:'c-bad'}], set:{tl:{cells:[{row:'job',col:8,cls:'wait',text:'H'}]}}, dur:4500},
    {caption:'<b>Isolate.</b> Cordon and drain Node 2 (do not just restart onto the same bad GPU). Bring in a warm spare, or restart with fewer nodes if the job supports elastic world size.', show:['spare'], dim:['n2'], ok:['spare'], set:{tl:{cells:[{row:'job',col:9,cls:'idle',text:'R'}]}}, dur:4500},
    {caption:'<b>Restore.</b> All ranks load the step-12,000 shards, verify config and world-size compatibility, and fast-forward the data loader so batches are neither repeated nor skipped. The ≈30 minutes after step 12,000 are recomputed.', packets:[{edge:'eck',label:'load',reverse:true,count:3,cls:'c-blue'}], set:{tl:{cells:[{row:'job',col:10,cls:'pre',text:'L'}]}, lost:{value:'≈ 30 min recomputed'}}, dur:4800},
    {caption:'<b>Resume.</b> Overhead = checkpoint cost + lost work + restart time. Young’s rule of thumb picks the interval τ ≈ √(2·C·M): with C = 2 min blocking save and job MTBF M = 8 h (illustrative), τ ≈ 44 min and total overhead ≈ 9 %. Async saves (C ≈ 10 s) push it to ≈ 2.6 %.', ok:['n0','n1','n3','spare'], set:{tl:{cells:[{row:'job',col:11,cls:'dec',text:'T'},{row:'job',col:12,cls:'dec',text:'T'},{row:'job',col:13,cls:'dec',text:'T'},{row:'job',col:14,cls:'pre',text:'C'},{row:'job',col:15,cls:'dec',text:'T'}]}, ovh:{value:'≈ 9 % → ≈ 2.6 % async'}, stepc:{value:'step 13,000'}}, dur:5500}
  ]
});

/* ---- gpu ---- */
/* Animations for the Vol 3 GPU question chapter (v3-ch-gpu). Scene ids prefixed v3q-gpu-. */
Anim.register({
  id:'v3q-gpu-lowutil', title:'Low GPU utilization, high latency: where the time really goes', w:960, h:440,
  elements:[
    {type:'node', id:'user', x:20, y:40, w:120, h:56, label:'Client', icon:'user'},
    {type:'node', id:'gw', x:180, y:40, w:130, h:56, label:'Gateway', sub:'auth, rate limit', icon:'shield'},
    {type:'node', id:'rag', x:350, y:40, w:130, h:56, label:'Retrieval', sub:'vector DB', icon:'search'},
    {type:'node', id:'cpu', x:520, y:40, w:150, h:56, label:'Engine CPU', sub:'tokenize, schedule', icon:'server'},
    {type:'node', id:'gpu', x:720, y:40, w:200, h:56, label:'GPU kernels', sub:'prefill + decode', icon:'gpu'},
    {type:'edge', id:'e1', from:'user', to:'gw'},
    {type:'edge', id:'e2', from:'gw', to:'rag'},
    {type:'edge', id:'e3', from:'rag', to:'cpu'},
    {type:'edge', id:'e4', from:'cpu', to:'gpu'},
    {type:'timeline', id:'tl', x:20, y:150, w:900, h:120, labelW:110, cols:16, ticks:true, rows:[{id:'R',label:'Request path'},{id:'G',label:'GPU busy?'}]},
    {type:'counter', id:'util', x:20, y:310, label:'nvidia-smi utilization.gpu', value:'—'},
    {type:'counter', id:'lat', x:330, y:310, label:'End-to-end latency (illustrative)', value:'—'},
    {type:'counter', id:'sm', x:660, y:310, label:'SM / tensor activity (DCGM PROF)', value:'—'},
    {type:'label', id:'note', x:20, y:390, text:'', hidden:true}
  ],
  steps:[
    {caption:'A user complains: answers take <b>4 s</b>, yet the GPU dashboard shows <b>~25 %</b> utilization. A bigger GPU will not help until we know where the 4 s goes. Each column below is 250 ms (illustrative).', hl:['user'], packets:[{edge:'e1',label:'req'}], dur:4200},
    {caption:'<b>Gateway + retrieval</b>: auth, a vector search and a reranker call take ~1.5 s. The GPU is idle the whole time because the prompt does not exist yet.', set:{tl:{cells:[{row:'R',col:0,cls:'wait',text:'gw'},{row:'R',col:1,cls:'wait',text:'rag'},{row:'R',col:2,cls:'wait',text:'rag'},{row:'R',col:3,cls:'wait',text:'rag'},{row:'R',col:4,cls:'wait',text:'rag'},{row:'R',col:5,cls:'wait',text:'rag'},{row:'G',col:0,cls:'idle'},{row:'G',col:1,cls:'idle'},{row:'G',col:2,cls:'idle'},{row:'G',col:3,cls:'idle'},{row:'G',col:4,cls:'idle'},{row:'G',col:5,cls:'idle'}]}, lat:{value:'1.5 s before any GPU work'}}, hl:['gw','rag'], packets:[{edge:'e2',label:'query'},{edge:'e3',label:'chunks',delay:500}], dur:4800},
    {caption:'<b>Engine CPU</b>: tokenizing a 12k-token prompt, building the batch and launching hundreds of small kernels one by one. A single Python process can starve the GPU; this is launch overhead.', set:{tl:{cells:[{row:'R',col:6,cls:'wait',text:'tok'},{row:'R',col:7,cls:'wait',text:'sched'},{row:'G',col:6,cls:'idle'},{row:'G',col:7,cls:'dec',text:'tiny'}]}, lat:{value:'2.0 s'}}, hl:['cpu'], warn:['cpu'], dur:4600},
    {caption:'<b>Prefill</b> finally runs: dense matrix multiplies, compute-bound, very busy GPU for ~250 ms. This is the only stretch where Tensor Cores are near their peak.', set:{tl:{cells:[{row:'R',col:8,cls:'pre',text:'P'},{row:'G',col:8,cls:'pre',text:'busy'}]}, lat:{value:'2.25 s (first token)'}, sm:{value:'tensor pipe high during prefill'}}, ok:['gpu'], packets:[{edge:'e4',label:'batch'}], dur:4200},
    {caption:'<b>Decode</b> at batch size 1: each step reads all weights from HBM to produce one token. A kernel is <i>running</i> most of the time, but each SM does little math per byte. Gaps between steps are CPU sampling and detokenization.', set:{tl:{cells:[{row:'R',col:9,cls:'dec',text:'D'},{row:'R',col:10,cls:'dec',text:'D'},{row:'R',col:11,cls:'dec',text:'D'},{row:'R',col:12,cls:'dec',text:'D'},{row:'G',col:9,cls:'dec'},{row:'G',col:10,cls:'idle'},{row:'G',col:11,cls:'dec'},{row:'G',col:12,cls:'idle'}]}, sm:{value:'low: memory-bound, batch 1'}}, warn:['gpu'], dur:4800},
    {caption:'Streaming out over a slow client and a tool call round-trip add more idle GPU time. Total: <b>4 s</b> latency, GPU kernels active in only ~4 of 16 slots ≈ <b>25 %</b>. The latency is real; the GPU is not the bottleneck.', set:{tl:{cells:[{row:'R',col:13,cls:'wait',text:'tool'},{row:'R',col:14,cls:'wait',text:'tool'},{row:'R',col:15,cls:'dec',text:'D'},{row:'G',col:13,cls:'idle'},{row:'G',col:14,cls:'idle'},{row:'G',col:15,cls:'dec'}]}, util:{value:'≈ 25 %'}, lat:{value:'4.0 s'}}, hl:['util','lat'], dur:4800},
    {caption:'Now the opposite trap. Batch 64 concurrent decodes and nvidia-smi shows <b>100 %</b>. That metric only means "at least one kernel was running" during the sample. SM_ACTIVE and PIPE_TENSOR_ACTIVE can still be far below peak.', set:{util:{value:'100 % (≥1 kernel running)'}, sm:{value:'still well below peak'}}, bad:['util'], dur:4800},
    {caption:'The fix list follows the evidence: cache or parallelise retrieval, move tokenization off the hot path, use CUDA graphs to cut launch overhead, batch more decodes, and alert on TTFT and queue time, not on utilization.', show:['note'], set:{note:{text:'Measure per stage: gateway, retrieval, queue, prefill, decode, stream. Then tune the stage that owns the time.'}}, ok:['gw','rag','cpu','gpu'], dur:5000}
  ]
});

Anim.register({
  id:'v3q-gpu-memfull', title:'What happens when GPU memory fills up (inference engine)', w:960, h:430,
  elements:[
    {type:'mem', id:'hbm', x:40, y:50, w:880, h:44, label:'H100 80 GB HBM (Llama-3.1-8B BF16, illustrative)', segs:[{frac:1,cls:'free',label:'free 80 GB'}]},
    {type:'bar', id:'kv', x:40, y:150, w:400, h:24, label:'vllm:kv_cache_usage_perc', value:0},
    {type:'counter', id:'run', x:500, y:140, label:'num_requests_running', value:'0'},
    {type:'counter', id:'wait', x:720, y:140, label:'num_requests_waiting', value:'0'},
    {type:'node', id:'sched', x:40, y:230, w:180, h:60, label:'Scheduler', sub:'admit if blocks free', icon:'gear'},
    {type:'node', id:'pool', x:300, y:230, w:180, h:60, label:'KV block pool', sub:'fixed at startup', icon:'memory'},
    {type:'node', id:'q', x:560, y:230, w:160, h:60, label:'Wait queue', icon:'queue'},
    {type:'edge', id:'e1', from:'sched', to:'pool', label:'allocate'},
    {type:'edge', id:'e2', from:'sched', to:'q', label:'defer'},
    {type:'counter', id:'ttft', x:760, y:240, label:'TTFT p95', value:'—'},
    {type:'label', id:'note', x:40, y:350, text:'', hidden:true}
  ],
  steps:[
    {caption:'At startup the engine loads weights (16 GB for 8B in BF16), profiles activations, then <b>pre-allocates</b> KV blocks up to <code>--gpu-memory-utilization</code> (vLLM default 0.92 → 73.6 GB of 80 GB). nvidia-smi now shows ~92 % memory used with zero traffic. That is by design.', set:{hbm:{segs:[{frac:.2,cls:'w',label:'weights 16 GB'},{frac:.04,cls:'act',label:'act'},{frac:.68,cls:'free',label:'KV pool ≈ 54 GB (reserved)'},{frac:.08,cls:'free',label:'8 %'}]}}, hl:['hbm'], dur:5000},
    {caption:'Traffic arrives. Each running sequence takes KV blocks as it grows (128 KiB per token for this model). The scheduler admits requests while free blocks remain.', set:{kv:{value:.45,text:'45 %'}, run:{value:'40'}, hbm:{segs:[{frac:.2,cls:'w',label:'weights'},{frac:.04,cls:'act'},{frac:.31,cls:'kv',label:'KV in use'},{frac:.37,cls:'free',label:'free blocks'},{frac:.08,cls:'free'}]}, ttft:{value:'180 ms'}}, packets:[{edge:'e1',label:'blocks'}], dur:4400},
    {caption:'A burst of long-context prompts. KV usage climbs to <b>100 %</b>. Nothing crashes: the scheduler simply stops admitting. New requests wait.', set:{kv:{value:1,text:'100 %'}, run:{value:'96'}, wait:{value:'35'}, hbm:{segs:[{frac:.2,cls:'w',label:'weights'},{frac:.04,cls:'act'},{frac:.68,cls:'kv',label:'KV full'},{frac:.08,cls:'free'}]}, ttft:{value:'2.8 s'}}, warn:['pool','q'], packets:[{edge:'e2',label:'wait',count:3,cls:'c-bad'}], dur:4600},
    {caption:'Running sequences keep growing and need new blocks that do not exist. The engine <b>preempts</b> a sequence: frees its blocks and, by default in vLLM V1, later <b>recomputes</b> it from its tokens. Throughput drops because work is redone; TTFT and tail latency rise.', set:{run:{value:'88'}, wait:{value:'43'}}, bad:['pool'], dur:4800},
    {caption:'Contrast with a naive PyTorch server or a training job: there is no admission control. The next allocation fails with <b>torch.OutOfMemoryError: CUDA out of memory</b> and the process dies or the step is lost.', show:['note'], set:{note:{text:'Training / naive server: allocation fails → CUDA OOM exception. Paged engine: queueing + preemption.'}}, bad:['sched'], dur:4600},
    {caption:'And neither is a Kubernetes <b>OOMKilled</b>. That is host RAM against the container limit (e.g. CPU-side tokenizer, swap space, offload). GPU HBM is invisible to cgroups. A third failure, an Xid error, is a driver/hardware event and needs different triage.', set:{note:{text:'CUDA OOM = GPU HBM.  OOMKilled = host RAM cgroup.  Xid = driver / hardware event.'}}, hl:['note'], dur:5000},
    {caption:'Levers, cheapest first: cap max context and max_num_seqs, FP8 KV cache (halves bytes per token), enable prefix caching, route long prompts to a separate pool, then add replicas or tensor parallelism. Alert on waiting requests and KV usage, not on "memory 92 %".', set:{kv:{value:.7,text:'70 %'}, wait:{value:'0'}, ttft:{value:'210 ms'}}, ok:['sched','pool'], dur:5000}
  ]
});

Anim.register({
  id:'v3q-gpu-roofline', title:'Roofline: why decode is memory-bound and prefill is compute-bound (H100 BF16)', w:960, h:440,
  elements:[
    {type:'chart', id:'ch', x:90, y:40, w:520, h:300, xmax:600, ymax:1100, xlabel:'arithmetic intensity (FLOP per byte from HBM)', ylabel:'attainable TFLOPS', series:[{id:'roof',label:'roofline',points:[[0,0],[295,989.5],[600,989.5]]},{id:'pt',label:'workload',points:[[0,0],[0,0]]}]},
    {type:'counter', id:'ai', x:660, y:60, label:'Arithmetic intensity', value:'—'},
    {type:'counter', id:'perf', x:660, y:130, label:'Attainable', value:'—'},
    {type:'counter', id:'bound', x:660, y:200, label:'Bound by', value:'—'},
    {type:'label', id:'note', x:660, y:280, text:'Ridge = 989.5 TFLOPS ÷ 3.35 TB/s\n≈ 295 FLOP/byte'}
  ],
  steps:[
    {caption:'The roofline has two limits. Left: the slope is HBM bandwidth (3.35 TB/s on H100 SXM). Right: the flat roof is dense BF16 Tensor Core peak (989.5 TFLOPS; the 1,979 headline number assumes sparsity). They meet at the <b>ridge point ≈ 295 FLOP/byte</b>.', hl:['ch','note'], dur:5000},
    {caption:'<b>Decode, batch 1.</b> Each weight (2 bytes in BF16) is read once and used for one multiply-add (2 FLOPs). Intensity ≈ 1 FLOP/byte → attainable ≈ 3.35 TFLOPS, about 0.3 % of peak. The GPU is waiting on memory.', set:{ch:{pt:[[1,0],[1,3.35]]}, ai:{value:'≈ 1 FLOP/B'}, perf:{value:'≈ 3.4 TFLOPS'}, bound:{value:'memory bandwidth'}}, bad:['bound'], dur:4800},
    {caption:'<b>Decode, batch 64.</b> The same weight read now serves 64 sequences: intensity ≈ 64 FLOP/byte (minus KV reads, which are per sequence and do not amortise). Attainable ≈ 214 TFLOPS. Still memory-bound, but 64× more useful work per byte.', set:{ch:{pt:[[64,0],[64,214]]}, ai:{value:'≈ 64 FLOP/B'}, perf:{value:'≈ 214 TFLOPS'}, bound:{value:'memory (better)'}}, warn:['bound'], dur:4800},
    {caption:'<b>Decode, batch 256.</b> Intensity ≈ 256, near the ridge. In practice KV-cache reads, attention and sampling keep real decode below this line, and KV capacity usually caps the batch first.', set:{ch:{pt:[[256,0],[256,858]]}, ai:{value:'≈ 256 FLOP/B'}, perf:{value:'≈ 858 TFLOPS ceiling'}, bound:{value:'near ridge'}}, dur:4600},
    {caption:'<b>Prefill of a 2,000-token prompt.</b> All 2,000 tokens multiply against each weight read: intensity in the thousands, far right of the ridge. Now Tensor Core throughput is the limit, so prefill time scales with prompt tokens × parameters.', set:{ch:{pt:[[590,0],[590,989.5]]}, ai:{value:'≫ 295 FLOP/B'}, perf:{value:'≈ 989.5 TFLOPS roof'}, bound:{value:'compute'}}, ok:['bound'], dur:4800},
    {caption:'What follows: a faster-FLOPS GPU helps prefill; more <b>bandwidth</b> (H200 4.8 TB/s) or fewer bytes (FP8/INT4 weights, FP8 KV) helps decode; bigger batches raise intensity until KV memory or the latency SLO stops you.', set:{note:{text:'Prefill: buy FLOPS.\nDecode: buy bandwidth, shrink bytes,\nbatch more.'}}, hl:['note'], dur:5000}
  ]
});

/* ---- inference ---- */
/* Animations for Vol 3 chapter: inference engines and serving (v3-ch-inference) */
Anim.register({
  id:'v3q-inf-batching', title:'Continuous batching in vLLM: one scheduler decision per step', w:960, h:440,
  elements:[
    {type:'label', id:'ttl', x:40, y:28, text:'Each column is one engine step (one forward pass). P = prefill tokens, D = one decode token, W = waiting'},
    {type:'timeline', id:'tl', x:40, y:60, w:880, h:180, labelW:90, cols:12, ticks:true,
      rows:[{id:'A',label:'Req A'},{id:'B',label:'Req B'},{id:'C',label:'Req C'},{id:'D',label:'Req D'},{id:'E',label:'Req E'},{id:'F',label:'Req F'}]},
    {type:'bar', id:'kv', x:40, y:300, w:400, h:22, label:'KV blocks used (vllm:kv_cache_usage_perc)', value:0.05, text:'5 %'},
    {type:'counter', id:'budget', x:500, y:285, label:'Tokens scheduled this step (budget 8,192)', value:'—'},
    {type:'counter', id:'rw', x:500, y:345, label:'running / waiting', value:'0 / 0'},
    {type:'label', id:'note', x:40, y:395, text:'', hidden:true}
  ],
  steps:[
    {caption:'<b>Step 1.</b> Requests A (2,000-token prompt) and B (1,500-token prompt) arrive. The scheduler packs both prefills into one forward pass: 3,500 tokens, well under the per-step token budget (<code>--max-num-batched-tokens</code>).',
     set:{tl:{cells:[{row:'A',col:0,cls:'pre',text:'P'},{row:'B',col:0,cls:'pre',text:'P'}]}, kv:{value:0.15,text:'15 %'}, budget:{value:'3,500 = 2,000 + 1,500'}, rw:{value:'2 / 0'}}, dur:4200},
    {caption:'<b>Steps 2–3.</b> C arrives with a 12,000-token prompt. With <b>chunked prefill</b> (on by default in vLLM V1) the scheduler first gives every running decode its 1 token, then fills the remaining budget with a chunk of C’s prompt: 8,190 tokens now, 3,810 next step. A and B keep streaming instead of stalling behind C.',
     set:{tl:{cells:[{row:'A',col:1,cls:'dec',text:'D'},{row:'B',col:1,cls:'dec',text:'D'},{row:'C',col:1,cls:'pre',text:'P'},{row:'A',col:2,cls:'dec',text:'D'},{row:'B',col:2,cls:'dec',text:'D'},{row:'C',col:2,cls:'pre',text:'P'}]}, kv:{value:0.45,text:'45 %'}, budget:{value:'8,192 = 2 decode + 8,190 chunk'}, rw:{value:'3 / 0'}}, dur:5200},
    {caption:'<b>Steps 4–5.</b> Pure decode: three sequences, three tokens per step. Compute is tiny but every step still reads all the weights from HBM, so batching more decodes together is almost free. That is the whole point of batching decode.',
     set:{tl:{cells:[{row:'A',col:3,cls:'dec',text:'D'},{row:'B',col:3,cls:'dec',text:'D'},{row:'C',col:3,cls:'dec',text:'D'},{row:'A',col:4,cls:'dec',text:'D'},{row:'B',col:4,cls:'dec',text:'D'},{row:'C',col:4,cls:'dec',text:'D'}]}, kv:{value:0.47,text:'47 %'}, budget:{value:'3 tokens (memory-bound step)'}}, dur:4500},
    {caption:'<b>Step 6.</b> B emitted its end-of-sequence token in step 5. Its KV blocks returned to the free pool at once, and D (which just arrived) is admitted <b>in the very next step</b>. Static batching would have made D wait until the slowest member of the batch finished. This is iteration-level scheduling (Orca, OSDI ’22).',
     set:{tl:{cells:[{row:'A',col:5,cls:'dec',text:'D'},{row:'C',col:5,cls:'dec',text:'D'},{row:'D',col:5,cls:'pre',text:'P'}]}, kv:{value:0.5,text:'50 %'}, budget:{value:'2 decode + 1,800 prefill'}, rw:{value:'3 / 0'}}, ok:['tl'], dur:5000},
    {caption:'<b>Steps 7–8.</b> E and F arrive with long prompts. E fits; F does not, because admitting it needs free KV blocks for its whole prompt. F <b>waits</b>. Its time-to-first-token now includes queue time. GPU memory is the admission limit, not the GPU “being busy”.',
     set:{tl:{cells:[{row:'A',col:6,cls:'dec',text:'D'},{row:'C',col:6,cls:'dec',text:'D'},{row:'D',col:6,cls:'dec',text:'D'},{row:'E',col:6,cls:'pre',text:'P'},{row:'F',col:6,cls:'wait',text:'W'},{row:'A',col:7,cls:'dec',text:'D'},{row:'C',col:7,cls:'dec',text:'D'},{row:'D',col:7,cls:'dec',text:'D'},{row:'E',col:7,cls:'dec',text:'D'},{row:'F',col:7,cls:'wait',text:'W'}]}, kv:{value:0.96,text:'96 %'}, budget:{value:'4 decode (+ E prefill in step 7)'}, rw:{value:'4 / 1'}}, warn:['kv'], dur:5000},
    {caption:'<b>Step 9.</b> Running sequences keep growing and need new blocks; none are free. The scheduler <b>preempts</b> a running request (under FCFS, the most recently admitted: E), frees its blocks, and puts it back in the queue. The default mode in V1 is <b>RECOMPUTE</b>: E’s prefill will be redone later, which wastes GPU work.',
     set:{tl:{cells:[{row:'A',col:8,cls:'dec',text:'D'},{row:'C',col:8,cls:'dec',text:'D'},{row:'D',col:8,cls:'dec',text:'D'},{row:'E',col:8,cls:'wait',text:'W'},{row:'F',col:8,cls:'wait',text:'W'}]}, kv:{value:0.9,text:'90 %'}, budget:{value:'3 decode, E preempted'}, rw:{value:'3 / 2'}}, bad:['kv'], dur:5200},
    {caption:'<b>Steps 10–11.</b> A finishes in step 10. Its blocks are freed, so in step 11 the scheduler re-admits E (recomputing its prefill) and admits F, both inside the same token budget as the ongoing decodes.',
     set:{tl:{cells:[{row:'A',col:9,cls:'dec',text:'D'},{row:'C',col:9,cls:'dec',text:'D'},{row:'D',col:9,cls:'dec',text:'D'},{row:'E',col:9,cls:'wait',text:'W'},{row:'F',col:9,cls:'wait',text:'W'},{row:'C',col:10,cls:'dec',text:'D'},{row:'D',col:10,cls:'dec',text:'D'},{row:'E',col:10,cls:'pre',text:'P'},{row:'F',col:10,cls:'pre',text:'P'}]}, kv:{value:0.85,text:'85 %'}, budget:{value:'2 decode + E and F prefill'}, rw:{value:'4 / 0'}}, dur:5000},
    {caption:'<b>Step 12.</b> Back to steady decode. What to watch in production: <code>vllm:num_requests_running</code>, <code>vllm:num_requests_waiting</code>, <code>vllm:kv_cache_usage_perc</code> and the TTFT / inter-token-latency histograms. Waiting &gt; 0 with KV near 100 % means memory-bound admission, not a compute shortage.',
     show:['note'], set:{tl:{cells:[{row:'C',col:11,cls:'dec',text:'D'},{row:'D',col:11,cls:'dec',text:'D'},{row:'E',col:11,cls:'dec',text:'D'},{row:'F',col:11,cls:'dec',text:'D'}]}, budget:{value:'4 tokens'}, note:{text:'Continuous batching = admit and retire sequences every step, under two limits:\ntoken budget per step (compute) and free KV blocks (memory).'}}, dur:5200}
  ]
});

Anim.register({
  id:'v3q-inf-spec', title:'Speculative decoding: draft cheaply, verify in one target pass', w:960, h:420,
  elements:[
    {type:'node', id:'draft', x:40, y:70, w:220, h:64, label:'Draft proposer', sub:'small model, n-gram or EAGLE head', icon:'bolt'},
    {type:'node', id:'target', x:380, y:70, w:220, h:64, label:'Target model', sub:'e.g. 70B, the real one', icon:'llm'},
    {type:'node', id:'out', x:720, y:70, w:200, h:64, label:'Accepted output', sub:'same distribution as target', icon:'check'},
    {type:'edge', id:'e1', from:'draft', to:'target', label:'k = 4 guesses'},
    {type:'edge', id:'e2', from:'target', to:'out', label:'accept / fix'},
    {type:'label', id:'ctxl', x:40, y:190, text:'Context so far, then the drafted tokens:'},
    {type:'tokens', id:'seq', x:40, y:205, h:28, items:['The','flight','to','Riyadh']},
    {type:'counter', id:'acc', x:40, y:290, label:'Tokens gained this target pass', value:'—'},
    {type:'counter', id:'exp', x:380, y:290, label:'Expected tokens per target pass', value:'—'},
    {type:'counter', id:'spd', x:720, y:290, label:'Ideal speed-up', value:'—'},
    {type:'label', id:'warnl', x:40, y:370, text:'', hidden:true}
  ],
  steps:[
    {caption:'Normal decode costs one full <b>target-model</b> forward pass per output token, and each pass is memory-bound: it reads all the weights to produce one token. Speculative decoding attacks that sequential bottleneck.', hl:['target'], dur:4200},
    {caption:'A cheap <b>draft</b> proposes k = 4 next tokens: “is delayed by two”. Drafting costs a small fraction c of a target pass per token (here c = 0.05, illustrative).', hl:['draft'], packets:[{edge:'e1',label:'4 tokens',cls:'c-purple'}], set:{seq:{items:['The','flight','to','Riyadh',{t:'is',cls:'hl'},{t:'delayed',cls:'hl'},{t:'by',cls:'hl'},{t:'two',cls:'hl'}]}}, dur:4400},
    {caption:'The target scores all 4 drafted positions <b>in one forward pass</b> (like a tiny prefill). Reading the weights once and checking 4 tokens costs about the same as producing 1 token normally, because decode is bandwidth-bound.', hl:['target'], busy:['target'], dur:4400},
    {caption:'Rejection sampling: “is”, “delayed”, “by” are accepted; “two” is rejected and replaced by a token sampled from the corrected target distribution (“three”). Result: <b>4 tokens from one target pass</b>, and the output distribution is exactly the target’s.', ok:['out'], packets:[{edge:'e2',label:'3 + 1 fix',cls:'c-ok'}], set:{seq:{items:['The','flight','to','Riyadh',{t:'is',cls:'new'},{t:'delayed',cls:'new'},{t:'by',cls:'new'},{t:'three',cls:'new'}]}, acc:{value:'4 (3 accepted + 1 corrected)'}}, dur:5000},
    {caption:'On average, with per-token acceptance rate α = 0.8 and k = 4: E = (1 − α⁵) / (1 − α) = (1 − 0.328) / 0.2 ≈ <b>3.36 tokens per target pass</b>.', set:{exp:{value:'(1 − 0.8⁵) / 0.2 ≈ 3.36'}}, hl:['exp'], dur:4600},
    {caption:'Subtract the drafting cost: one cycle costs k·c + 1 = 4 × 0.05 + 1 = 1.2 target-pass equivalents. Ideal speed-up ≈ 3.36 / 1.2 ≈ <b>2.8×</b> lower time per output token.', set:{spd:{value:'3.36 / 1.2 ≈ 2.8×'}}, hl:['spd'], dur:4600},
    {caption:'When it fails: if α drops to 0.5 with k = 8, E ≈ 2.0 and cost = 1.4, so the gain is only ≈ 1.4×. At large batch sizes decode becomes compute-bound, so verifying extra tokens is no longer “free” and the gain can fall below 1×. Measure acceptance rate and TPOT at your real concurrency.', show:['warnl'], warn:['draft','target'], set:{warnl:{text:'Speculation trades spare compute for fewer sequential steps.\nIt pays when decode is memory-bound and drafts are usually right.'}}, dur:5600}
  ]
});

/* ---- caching ---- */
/* Animations for Vol 3 question chapter: caching (v3-ch-caching) */
Anim.register({
  id:'v3q-cch-ladder', title:'One request, five caches: what each one skips', w:960, h:440,
  elements:[
    {type:'node', id:'user', x:20, y:40, w:120, h:56, label:'Request', sub:'tenant T1', icon:'user'},
    {type:'node', id:'gw', x:180, y:40, w:160, h:56, label:'AI gateway', sub:'auth → scope', icon:'shield'},
    {type:'node', id:'exact', x:390, y:40, w:160, h:56, label:'Exact cache', sub:'hash(key)', icon:'cache'},
    {type:'node', id:'sem', x:600, y:40, w:170, h:56, label:'Semantic cache', sub:'embed + ANN', icon:'search'},
    {type:'node', id:'rag', x:390, y:180, w:160, h:56, label:'Retrieval cache', sub:'query → chunk ids', icon:'db'},
    {type:'node', id:'eng', x:600, y:180, w:170, h:56, label:'Prefix cache', sub:'KV blocks by hash', icon:'memory'},
    {type:'node', id:'gpu', x:810, y:180, w:130, h:56, label:'GPU', sub:'prefill + decode', icon:'gpu'},
    {type:'edge', id:'e1', from:'user', to:'gw'},
    {type:'edge', id:'e2', from:'gw', to:'exact', label:'key'},
    {type:'edge', id:'e3', from:'exact', to:'sem', label:'miss'},
    {type:'edge', id:'e4', from:'sem', to:'rag', label:'miss'},
    {type:'edge', id:'e5', from:'rag', to:'eng', label:'prompt'},
    {type:'edge', id:'e6', from:'eng', to:'gpu', label:'uncached'},
    {type:'counter', id:'skip', x:40, y:300, label:'What this layer skips', value:'—'},
    {type:'counter', id:'risk', x:480, y:300, label:'What can go wrong', value:'—'},
    {type:'label', id:'note', x:40, y:390, text:'', hidden:true}
  ],
  steps:[
    {caption:'A user from tenant T1 asks a question. The <b>gateway</b> authenticates first, so every cache below it can be scoped to a tenant and a permission set. A cache placed before authentication is a data-leak bug waiting to happen.', hl:['user','gw'], packets:[{edge:'e1',label:'req'}], dur:4000},
    {caption:'<b>Exact response cache.</b> Key = HMAC of (tenant, model + revision, prompt-template version, normalised input, generation params). A hit returns the stored answer and skips <i>everything</i> below: retrieval, prefill and decode.', hl:['exact'], packets:[{edge:'e2',label:'key'}], set:{skip:{value:'whole pipeline (retrieval + GPU)'}, risk:{value:'stale answer if key misses a dependency'}}, dur:4500},
    {caption:'Miss. <b>Semantic cache</b>: embed the question, search nearest earlier questions <i>inside the same tenant partition</i>. Similarity ≥ threshold returns an old answer. It saves the same work as an exact hit, but similar wording is not the same meaning: "cancel my booking" vs "can I cancel a booking".', hl:['sem'], packets:[{edge:'e3',label:'miss'}], set:{skip:{value:'whole pipeline, on a fuzzy match'}, risk:{value:'false hit = confidently wrong answer'}}, dur:5000},
    {caption:'Miss. <b>Retrieval cache</b>: the query (plus index version) maps to cached chunk ids, so the vector search is skipped. Permissions are still checked on the chunks at read time, because ACLs change faster than caches expire.', hl:['rag'], packets:[{edge:'e4',label:'miss',cls:'c-blue'}], set:{skip:{value:'embedding + vector search'}, risk:{value:'stale index version or revoked ACL'}}, dur:4500},
    {caption:'The prompt reaches the engine: 3,000-token system prompt and tool schemas, 400 tokens of retrieved text, 100 tokens of question. The <b>prefix cache</b> hashes 16-token blocks; the first 3,000 tokens match blocks already in HBM, so their KV is reused.', hl:['eng'], packets:[{edge:'e5',label:'3,500 tok',cls:'c-purple'}], set:{skip:{value:'prefill of 3,000 of 3,500 tokens (86 %)'}, risk:{value:'none for correctness: exact token match'}}, dur:5000},
    {caption:'The GPU prefills only the 500 uncached tokens, then decodes. During decode the <b>per-request KV cache</b> grows by one token per step. That KV cache is working memory, not an answer store: it stops reuse <i>within</i> this request, not across users.', hl:['gpu'], busy:['gpu'], packets:[{edge:'e6',label:'500 tok',cls:'c-ok'}], set:{skip:{value:'recomputing earlier tokens each step'}, risk:{value:'HBM pressure → queueing or preemption'}}, dur:5000},
    {caption:'An exact or semantic hit returns straight to the user. Faster than any GPU path — but only correct if the key captured every input that changes the answer.', ok:['exact','sem'], packets:[{edge:'e2',label:'hit',reverse:true,cls:'c-ok'},{edge:'e1',label:'answer',reverse:true,delay:500,cls:'c-ok'}], dur:4200},
    {caption:'<b>The interview point:</b> name the cache by what it reuses. Response caches skip the model; retrieval caches skip search; prefix caches skip prefill; the KV cache skips recomputation inside one request. Each needs its own key, scope, freshness rule and metric.', show:['note'], set:{note:{text:'Upper layers: bigger saving, bigger correctness risk.\nLower layers: smaller saving, correctness guaranteed by exact token match.'}}, hl:['exact','sem','rag','eng'], dur:5500}
  ]
});

Anim.register({
  id:'v3q-cch-route', title:'Cache-aware routing: affinity until load says otherwise', w:960, h:440,
  elements:[
    {type:'node', id:'req', x:20, y:150, w:140, h:56, label:'Request', sub:'prefix P 4,096 tok', icon:'user'},
    {type:'node', id:'router', x:210, y:150, w:170, h:56, label:'KV-aware router', sub:'block index', icon:'gear'},
    {type:'node', id:'w1', x:450, y:40, w:180, h:56, label:'Worker 1', sub:'holds 240/256 P blocks', icon:'gpu'},
    {type:'node', id:'w2', x:450, y:150, w:180, h:56, label:'Worker 2', sub:'cold for P', icon:'gpu'},
    {type:'node', id:'w3', x:450, y:260, w:180, h:56, label:'Worker 3', sub:'cold for P', icon:'gpu'},
    {type:'edge', id:'e0', from:'req', to:'router'},
    {type:'edge', id:'r1', from:'router', to:'w1'},
    {type:'edge', id:'r2', from:'router', to:'w2'},
    {type:'edge', id:'r3', from:'router', to:'w3'},
    {type:'bar', id:'b1', x:690, y:60, w:240, h:18, label:'W1 load', value:0.3},
    {type:'bar', id:'b2', x:690, y:170, w:240, h:18, label:'W2 load', value:0.2},
    {type:'bar', id:'b3', x:690, y:280, w:240, h:18, label:'W3 load', value:0.2},
    {type:'counter', id:'cost', x:40, y:350, label:'Router cost (blocks, illustrative)', value:'—'},
    {type:'counter', id:'ttft', x:520, y:350, label:'Effect', value:'—'}
  ],
  steps:[
    {caption:'A request arrives whose prompt starts with a shared 4,096-token prefix P (system prompt + tool schemas). With 16-token KV blocks that is 256 blocks. Round-robin would send it to any worker; two out of three times it would land on a worker that must prefill all 4,096 tokens.', hl:['req'], packets:[{edge:'e0',label:'P + question'}], dur:4500},
    {caption:'The router keeps an <b>index of which block hashes each worker holds</b>, fed by KV events from the engines. Worker 1 already holds 240 of the 256 blocks for P. Workers 2 and 3 hold none.', hl:['router','w1'], dur:4200},
    {caption:'Dynamo-style cost (v1.5.1 docs): cost = prefill_load_scale × max(0, active prefill + incoming − overlap) + decode blocks. W1: (20 + 256 − 240) + 300 = 336. W2: 256 + 200 = 456. W3: 256 + 180 = 436. Lowest cost wins → W1.', set:{cost:{value:'W1 336 · W2 456 · W3 436'}}, hl:['router'], dur:5200},
    {caption:'W1 prefills only the 16 missing blocks (256 tokens) instead of 4,096. TTFT for this request drops sharply and W1 spends its compute on decode instead of repeating work.', ok:['w1'], packets:[{edge:'r1',label:'route',cls:'c-ok'}], set:{b1:{value:0.45}, ttft:{value:'prefill 256 tok instead of 4,096'}}, dur:4500},
    {caption:'Popular prefixes create <b>hotspots</b>. A burst of P requests piles onto W1: its active prefill and decode blocks climb. Pure affinity ("sticky by prefix") would keep sending traffic there until its queue and TTFT explode.', warn:['w1'], set:{b1:{value:0.92}, cost:{value:'W1 (400+256−240)+900 = 1,316'}}, packets:[{edge:'r1',label:'P',count:3,cls:'c-purple'}], dur:4800},
    {caption:'Because load is in the same cost function, W2 now wins: 256 + 200 = 456 versus 1,316. The router accepts a cache miss to protect latency. W2 prefills P once and now holds a second copy of the hot prefix.', ok:['w2'], packets:[{edge:'r2',label:'route',cls:'c-blue'}], set:{b2:{value:0.45}, cost:{value:'W1 1,316 · W2 456 → W2'}, ttft:{value:'one miss, then 2 warm replicas'}}, dur:5000},
    {caption:'Failure mode: W1 restarts and loses its HBM. If the index is not updated from worker events, the router keeps scoring W1 as warm. That costs a <b>miss</b> (latency), never a wrong answer, because reuse only happens on an exact block-hash match on the worker itself.', bad:['w1'], set:{b1:{value:0.05}, ttft:{value:'stale index → misses, not wrong output'}}, dur:5000},
    {caption:'Summary: cache-aware routing = affinity × load × freshness of the index. Measure prefix hit rate per worker, TTFT p95, and load skew (max/mean). Implementations: Dynamo KV router, llm-d endpoint picker, SGLang router, Ray Serve PrefixCacheAffinityRouter.', hl:['router','w1','w2','w3'], dur:5000}
  ]
});
