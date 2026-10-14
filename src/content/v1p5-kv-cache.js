/* Exemplar lesson: KV cache and PagedAttention (Vol 1, Part 5, Lesson 2) */
registerLesson({
  id:'v1-kv-cache', vol:1, part:5, num:2,
  title:'KV cache and PagedAttention', minutes:80,
  summary:'When a language model writes an answer, it produces one token at a time. To avoid recomputing the whole prompt for every new token, the inference engine keeps the key and value vectors of every earlier token in GPU memory. That store is the KV cache. It grows with every token of every active conversation, so it, not the model weights, usually decides how many users one GPU can serve. PagedAttention manages that memory in small blocks, like operating-system pages, so almost nothing is wasted.',
  objectives:[
    'Explain what the KV cache stores, per layer and per token, and why decode would be quadratic without it.',
    'Calculate KV bytes per token and per sequence from a model config, including grouped-query attention.',
    'Explain how PagedAttention removes fragmentation and enables prefix sharing.',
    'Predict when KV capacity, not compute, limits concurrency, and choose the right lever (context limit, KV dtype, more GPUs, preemption).',
    'Read the engine metrics that reveal KV pressure and troubleshoot KV-related OOM and latency.'
  ],
  prereqs:['v1-transformer','v1-inference-anatomy','v1-gpu-memory'],
  next:['v1-batching','v2-prefix-kv-cache','v2-distributed-kv','v2-capacity-planning'],
  tags:['inference','gpu-memory','vllm','capacity'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Imagine a meeting minute-taker. Without notes, every time someone speaks they would have to replay the entire meeting recording from the start to understand the new sentence. With notes, they read their notes once and add one line. The KV cache is those notes. Now the real mechanism.')}
<p>A decoder-only transformer generates text one token at a time. At every layer, attention needs, for each earlier token, two vectors: a <b>key</b> (k) that describes what that token offers, and a <b>value</b> (v) that carries its content (see ${L('v1-transformer','the transformer lesson')}). These vectors depend only on the earlier tokens, which never change once written. So the engine computes them once and keeps them in GPU memory. That store is the ${term('KV cache')}.</p>
<p>It is <b>runtime working memory for one request</b>. It is not model knowledge, it is not persisted between requests by default, and it is not the same thing as a response cache in Redis. Volume 2 contrasts ten different caches in ${L('v2-cache-map','the caching map')}.</p>

<h2>2. Why do we need it?</h2>
<p>Without a KV cache, generating token number <i>n</i> would require re-running attention over all <i>n−1</i> earlier tokens through every layer, recomputing their k and v from scratch. Generating a 1,000-token answer would redo the prompt 1,000 times. Total attention work for the answer grows roughly with the <i>square</i> of its length.</p>
<p>With the cache, each decode step computes q, k and v only for the <b>one new token</b>, then lets that new query attend over the stored keys and values. Per-step work grows linearly with length, and nothing already computed is repeated. That is why every production inference engine — vLLM, SGLang, TensorRT-LLM, llama.cpp — keeps a KV cache. It is not an optional optimization.</p>
${formula(`
Without cache, total attention work for an answer of n tokens
     n
     Σ  (i tokens re-processed at step i)   ≈  n²/2   →  quadratic
    i=1

With cache, step i processes 1 new token that attends to i cached keys
     n
     Σ  i  query-key dot products            ≈  n²/2 dot products,
    i=1                                          but only n token passes
                                                 through the layers
                                                 ↑ the expensive part
`)}
<p>The dot products are cheap. The layer passes (the big matrix multiplications against the weights) are the expensive part, and the cache cuts those from about n²/2 to n.</p>

<h2>3. How does it work internally?</h2>
<h3>What exactly is stored</h3>
<p>For <b>every layer</b>, for <b>every KV head</b>, for <b>every token</b> in the sequence, the cache holds one key vector and one value vector of length <code>head_dim</code>. So the size per token is:</p>
${formula(`
KV bytes per token = 2 × layers × kv_heads × head_dim × bytes_per_element
                     ↑                                  ↑
                     one K and one V                    2 for BF16/FP16, 1 for FP8
`)}
<h3>Worked example: two real model shapes</h3>
<p>Model shapes come from each model's <code>config.json</code> (<code>num_hidden_layers</code>, <code>num_key_value_heads</code>, and <code>hidden_size / num_attention_heads</code> for head_dim).</p>
${table(['Model shape','layers','attention heads','KV heads','head_dim','KV per token (BF16)'],[
 ['Llama-3.1-8B','32','32','8','128','2 × 32 × 8 × 128 × 2 = 131,072 B = <b>128 KiB</b>'],
 ['Llama-3.1-70B','80','64','8','128','2 × 80 × 8 × 128 × 2 = 327,680 B = <b>320 KiB</b>']
])}
${formula(`
STEP 1  one 8,192-token conversation on the 70B shape
        8,192 tokens × 320 KiB = 2,621,440 KiB = 2.5 GiB

STEP 2  32 such conversations at the same time
        32 × 2.5 GiB = 80 GiB of KV
                       ↑ larger than the entire 80 GB HBM of one H100,
                         before a single byte of weights

STEP 3  weights of the 70B model in BF16
        70.6 × 10⁹ params × 2 B ≈ 141 GB ≈ 131 GiB  → needs ≥ 2 × 80 GB GPUs

ANSWER  On a 70B model, KV memory for long concurrent conversations is the same order
        of magnitude as the weights. Capacity planning must budget both.
`)}
${callout('note','Grouped-query attention (GQA) is why KV heads ≠ attention heads','Llama-3.1-70B has 64 query heads but only 8 KV heads: groups of 8 query heads share one K/V head. That cuts KV memory by 8× compared with standard multi-head attention, with small quality cost. Multi-query attention (MQA) goes to 1 KV head. DeepSeek-V2/V3 use Multi-head Latent Attention (MLA), which stores a compressed latent instead of full K and V. Always read <code>num_key_value_heads</code>, not <code>num_attention_heads</code>, when sizing KV.')}

${anim('v1-kv-growth')}

<h3>Prefill versus decode, seen through the cache</h3>
<ul>
<li><b>Prefill</b> processes all prompt tokens in parallel. It is compute-heavy (large matrix multiplies) and <i>writes</i> the prompt's k,v into the cache. Its duration dominates time-to-first-token (TTFT).</li>
<li><b>Decode</b> processes one new token per sequence per step. It reads all the weights and the whole cache for that sequence, does relatively little arithmetic per byte, and is therefore usually <b>memory-bandwidth-bound</b>. Its speed sets time per output token (TPOT). See ${L('v1-gpu-architecture','roofline intuition')}.</li>
</ul>

<h3>PagedAttention: managing the cache like virtual memory</h3>
<p>Early serving systems reserved one contiguous KV region per request sized for the <i>maximum</i> possible length. Most of that reservation stayed empty, and freed regions left gaps too small for new requests. The vLLM paper (Kwon et al., SOSP 2023, arXiv 2309.06180) reported that existing systems used only about 20–38 % of reserved KV memory for actual token state.</p>
<p>${term('PagedAttention')} splits KV memory into fixed-size <b>blocks</b> (vLLM's default is 16 tokens per block). Each request has a <b>block table</b> mapping its logical blocks to arbitrary physical blocks. Blocks are allocated only when tokens are produced, and freed the moment the request ends. Waste is limited to the unfilled tail of each request's last block. Because a physical block can be referenced by several block tables, identical prefixes can be <b>shared</b> — the basis of automatic prefix caching (${L('v2-prefix-kv-cache','Volume 2 deep dive')}).</p>
${anim('v1-paged-attention')}
<p>The attention kernel itself must be "paged-aware": it gathers keys and values from scattered blocks via the block table. That is why PagedAttention is both a memory manager <i>and</i> a kernel change, not just an allocator setting.</p>

<h2>4. Where does it fit?</h2>
${fig('Where the KV cache lives in a serving stack', svgDiagram({w:900,h:330,
 zones:[{x:330,y:20,w:550,h:290,label:'GPU worker (one engine instance)'}],
 boxes:[
  {id:'gw',x:20,y:60,w:130,h:56,label:'AI gateway',sub:'auth, quotas'},
  {id:'api',x:180,y:60,w:130,h:56,label:'Engine API',sub:'OpenAI-compatible'},
  {id:'sch',x:350,y:60,w:150,h:56,label:'Scheduler',sub:'admits requests',cls:'hl'},
  {id:'bm',x:530,y:60,w:160,h:56,label:'KV block manager',sub:'free / used blocks',cls:'hl'},
  {id:'ex',x:350,y:170,w:150,h:56,label:'Model executor',sub:'CUDA kernels'},
  {id:'hbm',x:530,y:170,w:330,h:110,label:'HBM',sub:'weights | KV blocks | activations',cls:'v2'},
  {id:'m',x:720,y:60,w:140,h:56,label:'/metrics',sub:'KV usage, queue'}
 ],
 arrows:[{from:'gw',to:'api'},{from:'api',to:'sch'},{from:'sch',to:'bm',label:'enough blocks?'},{from:'sch',to:'ex',label:'batch'},{from:'ex',to:'hbm',label:'read/write KV'},{from:'bm',to:'hbm',fromSide:'bottom',toSide:'top'},{from:'bm',to:'m',cls:'dash'}]
}), 'The scheduler asks the block manager whether a request fits before admitting it. KV usage is exported as a metric, so it can drive alerts and autoscaling.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Scheduler and batching.</b> Continuous batching (${L('v1-batching','next lesson')}) adds requests to the running batch only if free blocks exist. KV capacity is therefore the hard ceiling on concurrency.</li>
<li><b>Prefix caching.</b> Finished requests' blocks can be kept (evicted LRU when space is needed) and matched by hash to new requests sharing the same prefix, skipping their prefill.</li>
<li><b>Router.</b> Cache-aware routers (llm-d, NVIDIA Dynamo, SGLang router) send a request to the replica that already holds its prefix blocks (${L('v2-distributed-kv','distributed KV')}).</li>
<li><b>Disaggregated serving.</b> When prefill and decode run on different GPUs, the KV cache is <i>transferred</i> between them (NIXL, NCCL, RDMA). KV bytes per token now become network bytes (${L('v2-distributed-inference','distributed inference')}).</li>
<li><b>Autoscaling and capacity planning.</b> KV usage and queue length are better scale signals than CPU (${L('v1-k8s-autoscaling','autoscaling')}, ${L('v2-capacity-planning','capacity planning')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<p>You rarely touch the cache algorithm. You own its <b>budget, limits and telemetry</b>:</p>
${table(['Control (vLLM name)','What it does','Your decision'],[
 ['<code>--gpu-memory-utilization</code>','Fraction of GPU memory the engine may use (default 0.92 in vLLM v0.31). After loading weights and profiling activations, the remainder becomes KV blocks.','Higher = more KV; leave headroom if anything else shares the GPU.'],
 ['<code>--max-model-len</code>','Maximum prompt + output length accepted.','Lower it to what the product needs. A model card saying "128k" does not mean you should serve 128k.'],
 ['<code>--max-num-seqs</code>','Maximum sequences in the running batch.','Caps concurrency per replica; tune with load tests.'],
 ['<code>--kv-cache-dtype fp8</code>','Store KV in 8-bit floating point instead of 16-bit.','Roughly halves KV bytes; validate quality on your eval set.'],
 ['Gateway token limits','Per-tenant max input/output tokens and concurrent streams.','Protects KV capacity from one tenant.']
])}
${callout('devops','DevOps bridge','Think of KV blocks like a connection pool or ephemeral-storage quota, not like a pod memory limit. Kubernetes memory requests and limits do not see GPU memory at all. A pod can be "healthy" with plenty of node RAM while the engine has zero free KV blocks.')}
${callout('unverified','Check flag names and defaults against your version','Engine flags change between releases. The flags above are documented vLLM options; confirm defaults with <code>vllm serve --help</code> for your pinned version.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely KV cause','Evidence to collect','Fix'],[
 ['Engine fails at startup: not enough memory for KV cache / max_model_len too large','Weights + activation profile leave too few blocks to fit even one max-length sequence','Engine startup log lines about KV capacity; model size vs GPU memory','Lower <code>--max-model-len</code>, use FP8 KV, more tensor parallelism, or a bigger GPU'],
 ['TTFT climbs under load, TPOT stays flat','KV full → new requests queue','<code>vllm:num_requests_waiting</code> rising while <code>vllm:kv_cache_usage_perc</code> ≈ 1.0','Add replicas, cap context, cap per-tenant concurrency'],
 ['Throughput drops and latency becomes spiky at high load','Preemption: running sequences evicted then recomputed','Engine logs mention preemption; check your version\'s /metrics for a preemption counter','Lower <code>--max-num-seqs</code>, keep headroom, scale out'],
 ['CUDA OOM under load in a custom (non-paged) server','Unbounded KV growth','<code>nvidia-smi</code> memory at ceiling; OOM trace','Move to a paged engine or add admission control'],
 ['Works at 2k context, fails at 32k','Linear KV growth per sequence','Prompt-length histogram from gateway','Separate long-context pool or tighter limits']
])}
<div class="dtree"><ul><li><span class="q">Requests slow or failing — is KV the bottleneck?</span><ul>
<li><span class="a">check</span>KV-cache usage near 100 % <b>and</b> waiting requests &gt; 0 → KV-bound: scale out or cut context/concurrency.</li>
<li><span class="a">check</span>KV usage low but waiting &gt; 0 → scheduler or batch limits (max-num-seqs, max-num-batched-tokens) or prefill-bound.</li>
<li><span class="a">check</span>KV low, nothing waiting, TPOT high → decode bandwidth or kernel issue, not KV capacity.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<ol>
<li><b>Shrink bytes per token</b>: choose GQA/MLA models, FP8 KV cache.</li>
<li><b>Shrink tokens per request</b>: tighter max context, prompt compression, retrieval instead of stuffing, summarise old turns.</li>
<li><b>Share tokens</b>: prefix caching for common system prompts and documents.</li>
<li><b>Add memory</b>: more replicas (data parallel), tensor parallelism (KV is sharded across GPUs with the heads), GPUs with more HBM.</li>
<li><b>Tier the memory</b>: offload cold KV blocks to CPU RAM or SSD (LMCache, Dynamo KVBM) when re-use is likely, trading transfer time for recompute.</li>
</ol>

<h2>9. How do we optimize its cost?</h2>
<p>KV capacity directly sets <b>concurrent sequences per GPU</b>, which sets <b>cost per token</b>. A worked illustration on an 80 GB GPU serving the 8B shape:</p>
${formula(`
STEP 1  usable memory ≈ 0.90 × 80 GB = 72 GB          (we set 0.90; vLLM's default is 0.92)
STEP 2  weights        ≈ 16 GB    activations/graphs ≈ 4 GB (assume; measure yours)
STEP 3  KV budget      ≈ 72 − 16 − 4 = 52 GB ≈ 48.4 GiB
STEP 4  per sequence at 4,096 tokens: 4,096 × 128 KiB = 0.5 GiB
STEP 5  max concurrent 4k sequences ≈ 48.4 / 0.5 ≈ 96

With FP8 KV (64 KiB/token):          ≈ 193 sequences
With 16k context instead of 4k:      ≈ 24 sequences
                                       ↑ same GPU, same model, 4× fewer users
`)}
<p>These are capacity ceilings, not throughput promises. Real throughput at your latency SLO must be measured (${L('v1-benchmarking','benchmarking')}). The lesson is economic: context-length policy is a cost policy.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“What happens when GPU memory fills up during inference?”','<p><i>Answer (≈45 s):</i> "In a modern engine the weights are fixed, so what fills up is the KV cache — the stored keys and values for every active token. The scheduler stops admitting new requests when no KV blocks are free, so first you see queueing and rising TTFT, not a crash. If it is already over-committed it preempts running sequences and recomputes them later (the vLLM V1 engine preempts by recomputation), which shows up as throughput loss and latency spikes. I would confirm with the KV-usage and waiting-requests metrics, then decide between scaling out, capping context or per-tenant concurrency, FP8 KV, or prefix caching — depending on whether long prompts or many concurrent users are driving it."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"The GPU runs out of memory and the pod gets OOMKilled, so we increase the memory limit."</p><p>Wrong layer: Kubernetes memory limits are host RAM, and paged engines queue rather than crash.</p></div><div class="good"><h4>Strong answer</h4><p>Names the KV cache, explains admission → queueing → preemption, cites the metrics, and lists levers ranked by cost.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['GPU memory','KV cache','free blocks','concurrency','throughput','cost per token'])}
${chain(['Prompt length policy','KV bytes per request','admission control','TTFT under load'])}
<p>Next: ${L('v1-batching','continuous batching')} uses the free-block count every scheduling step. Later: ${L('v2-prefix-kv-cache','prefix caching')} and ${L('v2-distributed-kv','distributed KV')} reuse and move these blocks across the fleet.</p></div>

<h3>Lab</h3>
<p>Run the KV calculator from the capacity lab against a real model config, then compare with what your engine reports at startup.</p>
${code('bash',`python labs/11-capacity/kv_cache.py --layers 32 --kv-heads 8 --head-dim 128 --dtype-bytes 2 --context 8192 --sequences 16
python labs/11-capacity/kv_cache.py --hf-config path/to/config.json --context 4096 --gpu-gb 80 --weights-gb 16 --util 0.9`)}
`,
  quiz:[
    {q:'What does the KV cache store?',options:['The final generated answer for reuse by other users','Key and value vectors for every past token, per layer and KV head, for one sequence','The model weights in compressed form','Embeddings of retrieved documents'],answer:1,explain:'It stores per-token keys and values for each layer and KV head. A response cache stores answers; RAG stores document embeddings; weights are separate.'},
    {q:'A model has 64 attention heads and 8 KV heads. When sizing KV memory you multiply by…',options:['64','8','72','128'],answer:1,explain:'With grouped-query attention, only the KV heads are cached. Using attention heads would overestimate KV memory 8×.'},
    {q:'KV usage is at 100 % and waiting requests are rising. TPOT for running requests is normal. Most likely user-visible symptom?',options:['Garbled output','Rising time-to-first-token','Pod restarts with OOMKilled','Lower GPU temperature'],answer:1,explain:'New requests wait for free blocks, so TTFT rises. Running requests keep decoding normally. OOMKilled refers to host memory and does not apply here.'},
    {q:'Which change does NOT reduce KV memory per request?',options:['FP8 KV cache','Lower max context','PagedAttention block size of 16 instead of 32','Choosing a GQA model'],answer:2,explain:'Block size changes fragmentation slightly but not bytes per token. FP8 halves bytes, context caps tokens, GQA reduces heads.'},
    {q:'Why is decode usually memory-bandwidth bound?',options:['It processes many tokens per step','For one new token per sequence it must read the weights and that sequence’s KV, doing little math per byte read','Because PagedAttention is slow','Because of network latency'],answer:1,explain:'Arithmetic intensity is low in decode. Prefill processes many tokens at once and is usually compute-bound.'}
  ],
  flashcards:[
    {front:'KV bytes per token formula',back:'2 × layers × KV heads × head_dim × bytes per element (2 for BF16, 1 for FP8).'},
    {front:'KV per token for Llama-3.1-70B in BF16',back:'2 × 80 × 8 × 128 × 2 = 327,680 B = 320 KiB. 8k tokens ≈ 2.5 GiB per sequence.'},
    {front:'What problem does PagedAttention solve?',back:'Fragmentation from contiguous max-length reservations. Fixed-size blocks are allocated on demand via a per-request block table; blocks can be shared for common prefixes.'},
    {front:'First user-visible symptom of KV exhaustion in vLLM',back:'Queueing → rising TTFT (waiting requests > 0 with KV usage ≈ 100 %). Then preemptions if over-committed.'},
    {front:'Is a pod memory limit relevant to KV OOM?',back:'No. KV lives in GPU HBM, invisible to Kubernetes memory accounting.'},
    {front:'Why is context-length policy a cost policy?',back:'Max context × concurrency sets KV memory, which sets sequences per GPU, which sets GPU count and cost per token.'}
  ]
});
registerGlossary([
  {term:'KV cache',def:'Per-request GPU memory holding the key and value vectors of every processed token, per layer and KV head, so decode does not recompute earlier tokens.',lesson:'v1-kv-cache',aliases:['key-value cache']},
  {term:'PagedAttention',def:'KV-cache memory management (introduced by vLLM) that stores KV in fixed-size blocks mapped through per-request block tables, removing fragmentation and enabling prefix sharing.',lesson:'v1-kv-cache'},
  {term:'GQA',def:'Grouped-query attention: several query heads share one key/value head, reducing KV-cache size proportionally.',lesson:'v1-kv-cache',aliases:['grouped-query attention']},
  {term:'Preemption',def:'When an inference engine runs out of KV blocks it evicts a running sequence and later recomputes (or swaps back) its state.',lesson:'v1-kv-cache'}
]);
