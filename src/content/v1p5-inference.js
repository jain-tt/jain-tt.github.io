/* Volume 1, Part 5: Inference engineering (lessons 1, 3, 4, 5, 6; lesson 2 KV cache lives in v1p5-kv-cache.js) */

/* ===================================================================== 1.5.1 */
registerLesson({
  id:'v1-inference-anatomy', vol:1, part:5, num:1,
  title:'Anatomy of inference: loading, serving, prefill, decode, TTFT and TPOT', minutes:85,
  summary:'Serving a language model is a pipeline. Before the first request, the server must download the weights, load them onto the GPU, size its KV cache and warm up, which can take minutes and is mostly moving bytes. Then each request is tokenised, waits for a slot, goes through prefill, where the whole prompt is processed in parallel and the first token appears, and then through decode, where tokens come out one at a time. Prefill is limited by arithmetic and sets time to first token. Decode is limited by memory bandwidth and sets time per output token. Measuring these two separately is the foundation of every later lesson on batching, engines and benchmarking.',
  objectives:[
    'Trace a model from files on storage to a ready inference server, and estimate load time as size ÷ bandwidth.',
    'Explain why safetensors and memory-mapping are used for weights.',
    'Trace one request through tokenisation, queueing, prefill, decode, sampling, detokenisation and streaming.',
    'Define TTFT, TPOT, ITL and E2E latency precisely, and compute them from timestamps.',
    'Explain why prefill is compute-bound and decode memory-bound, and which metric each one drives.'
  ],
  prereqs:['v1-generation','v1-gpu-architecture','v1-gpu-memory'],
  next:['v1-kv-cache','v1-batching','v1-engines','v1-benchmarking'],
  tags:['inference','latency','metrics','vllm'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A restaurant kitchen. Before opening, the kitchen is stocked and the ovens heated (loading). When an order arrives it waits for a free cook (queue), the cook reads the whole order and preps everything at once (prefill), the first plate goes out (first token), then dishes leave one by one at a steady pace (decode). Customers judge you on two things: how long until the first plate, and how quickly the rest follow. Now the real mechanism.')}
<p><b>Inference</b> is running a trained model to produce outputs. For an LLM service it has two timescales:</p>
<ul>
<li><b>Server lifecycle</b> (seconds to minutes, once per replica): fetch weights, load them into GPU memory, allocate the KV cache, capture CUDA graphs, warm up, become ready.</li>
<li><b>Request lifecycle</b> (milliseconds to seconds, per request): tokenise, queue, ${term('prefill')}, ${term('decode')} token by token, detokenise, stream.</li>
</ul>
<p>And it has four latency metrics every platform engineer must be able to define exactly: ${term('TTFT')}, ${term('TPOT')}, ${term('ITL')} and ${term('E2E latency')}.</p>

<h2>2. Why do we need it?</h2>
<p>An LLM API “feels slow” for completely different reasons: the replica is still loading, requests are queueing, the prompt is huge, the batch is too big, the KV cache is full, or the network is buffering the stream. Each of these lives in a different stage and shows up in a different metric. Without the anatomy, every latency incident becomes “add more GPUs”. With it, you can point at the stage, read the right metric, and pick the right lever.</p>

<h2>3. How does it work internally?</h2>
<h3>Part A — from files to a ready server</h3>
<p>An open-weight model on Hugging Face (or in your registry) is a directory: <code>config.json</code> (architecture: layers, heads, hidden size), <code>tokenizer.json</code> and <code>tokenizer_config.json</code> (vocabulary and the <b>chat template</b>), <code>generation_config.json</code> (default sampling), and the weights, usually sharded as <code>model-00001-of-00004.safetensors</code> plus an index file mapping tensor names to shards.</p>
<p>${term('safetensors')} is a simple format: a JSON header with tensor names, dtypes, shapes and byte offsets, followed by raw tensor bytes. Two properties matter:</p>
<ul>
<li><b>Safe</b>: loading cannot execute code. The older PyTorch <code>.bin</code>/<code>.pt</code> files use Python pickle, which can run arbitrary code on load; Hugging Face documents pickle as “known to be insecure” and <code>from_pretrained()</code> prefers safetensors. Malicious pickled models have been found on public hubs (JFrog, 2024). Treat any pickle checkpoint as untrusted code (${L('v2-ai-threat-model','AI threat model')}).</li>
<li><b>Fast, zero-copy</b>: because offsets are known, the file can be <b>memory-mapped</b> (<code>mmap</code>): the OS maps the file into the process’s address space and pages bytes in on demand, so the loader copies each tensor straight to the GPU without first reading the whole file into a Python object.</li>
</ul>
${formula(`
load time ≈ download time + disk→GPU time + engine start-up

                     model size (bytes)
download time  =  ──────────────────────
                   effective bandwidth (bytes/s)

STEP 1  8B model in BF16: 8.03 × 10⁹ × 2 B = 16.06 GB
        10 Gb/s link = 1.25 GB/s        → 16.06 ÷ 1.25 ≈ 12.8 s

STEP 2  70B model in BF16: 70.6 × 10⁹ × 2 B = 141.2 GB
        at 1.25 GB/s                     → 141.2 ÷ 1.25  ≈ 113 s
        at 25 Gb/s = 3.125 GB/s          → 141.2 ÷ 3.125 ≈ 45 s

STEP 3  every new replica on a cold node pays this again,
        unless weights are cached on the node or in a shared volume

ANSWER  Load time is bytes ÷ the slowest pipe. Measure the effective bandwidth
        (object store throttling, single-stream limits) rather than the NIC rating.
`)}
<p>Then the engine starts: it loads weights into HBM, runs a profiling pass to measure peak activation memory, turns the rest of its memory budget into KV-cache blocks (${L('v1-kv-cache','KV cache')}), captures ${term('CUDA graph','CUDA graphs')} (${L('v1-cuda','CUDA')}), and only then should report ready.</p>
${anim('v1-inf-coldstart')}

<h3>Part B — one request, end to end</h3>
${fig('The request path inside an inference server', svgDiagram({w:900,h:330,
 zones:[{x:250,y:20,w:630,h:290,label:'Engine process (e.g. vLLM)'}],
 boxes:[
  {id:'c',x:20,y:60,w:200,h:56,label:'Client',sub:'POST /v1/chat/completions'},
  {id:'api',x:270,y:60,w:170,h:56,label:'API server',sub:'chat template, tokenize'},
  {id:'q',x:470,y:60,w:170,h:56,label:'Scheduler queue',sub:'waiting requests',cls:'warn'},
  {id:'b',x:670,y:60,w:190,h:56,label:'Running batch',sub:'admitted if KV fits',cls:'hl'},
  {id:'ex',x:670,y:200,w:190,h:56,label:'Model executor',sub:'prefill / decode kernels',cls:'v2'},
  {id:'s',x:470,y:200,w:170,h:56,label:'Sampler',sub:'logits → token id'},
  {id:'d',x:270,y:200,w:170,h:56,label:'Detokenizer',sub:'ids → text, stop rules'},
  {id:'sse',x:20,y:200,w:200,h:56,label:'SSE stream',sub:'data: {...} chunks'}
 ],
 arrows:[{from:'c',to:'api'},{from:'api',to:'q'},{from:'q',to:'b'},{from:'b',to:'ex'},{from:'ex',to:'s'},{from:'s',to:'d'},{from:'d',to:'sse'},{from:'s',to:'b',cls:'dash',label:'next step'}]
}), 'Every arrow is a place where latency can hide. The loop between sampler and running batch repeats once per output token.')}
<ol>
<li><b>API server</b>: validates the request, applies the model’s <b>chat template</b> (turns the messages array into one string with special tokens), tokenises it. A wrong template silently ruins quality; it is part of the model release.</li>
<li><b>Queue and admission</b>: the scheduler admits the request into the running batch only if it has a slot and enough free KV blocks for the prompt. Otherwise it waits (${L('v1-batching','batching and scheduling')}).</li>
<li><b>Prefill</b>: all prompt tokens go through every layer <b>in parallel</b>. Each layer computes keys and values for every prompt token and writes them to the KV cache. This is a large matrix–matrix multiply: <b>compute-bound</b> (intensity ≈ number of tokens; see the roofline in ${L('v1-gpu-architecture','GPU architecture')}). Its output includes the logits for the <b>first new token</b>.</li>
<li><b>Sampling</b>: logits → probabilities (temperature, top-p, top-k, penalties) → one token id (${L('v1-generation','generation and sampling')}).</li>
<li><b>Decode loop</b>: each iteration feeds the newest token back in, computes one new position per sequence, reads all weights and that sequence’s KV cache, appends one KV entry. This is a matrix–vector multiply per sequence: <b>memory-bound</b>, which is why many sequences are batched together.</li>
<li><b>Detokenise and stream</b>: token ids become text incrementally; stop sequences and max-token limits are checked; chunks go out as Server-Sent Events.</li>
</ol>

<h3>Part C — the four latency metrics</h3>
${table(['Metric','Definition','Driven mainly by','vLLM metric (as of v0.31)'],[
 ['<b>TTFT</b> — time to first token','Request arrival → first output token received','Queue wait + prefill (+ tokenisation, network)','<code>vllm:time_to_first_token_seconds</code>'],
 ['<b>TPOT</b> — time per output token','Average gap per token after the first, for one request: (E2E − TTFT) ÷ (output tokens − 1)','Decode step time (batch size, context length, bandwidth)','<code>vllm:request_time_per_output_token_seconds</code>'],
 ['<b>ITL</b> — inter-token latency','Each individual gap between consecutive streamed tokens (a distribution, not one number per request)','Decode steps plus any stall: other users’ prefills, preemption','<code>vllm:inter_token_latency_seconds</code>'],
 ['<b>E2E</b> — end-to-end latency','Request arrival → last token','All of the above × output length','<code>vllm:e2e_request_latency_seconds</code>']
])}
<p>Also exported: <code>vllm:request_queue_time_seconds</code>, <code>vllm:request_prefill_time_seconds</code>, <code>vllm:request_decode_time_seconds</code>, which split TTFT and E2E into their causes.</p>
${callout('warn','TPOT and ITL are not synonyms','TPOT is one average per request; ITL is every gap. A request with 99 gaps of 20 ms and one gap of 500 ms has TPOT ≈ 25 ms (fine) but a p99 ITL of 500 ms (a visible stutter). Old course material used “TPOT or inter-token latency” interchangeably; keep them separate, and alert on ITL percentiles for streaming UX.')}
${formula(`
            output tokens n,  arrival t₀,  token i received at tᵢ   (i = 1 … n)

TTFT  = t₁ − t₀
ITLᵢ  = tᵢ − tᵢ₋₁                for i = 2 … n
         tₙ − t₁
TPOT  = ─────────   = mean of the ITLs of that request
          n − 1
E2E   = tₙ − t₀  = TTFT + TPOT × (n − 1)
per-user decode speed ≈ 1 ÷ TPOT   (tokens/s)
`)}
${anim('v1-inf-timeline')}
<h3>Worked example: a 2,000-token prompt with a 200-token answer</h3>
${formula(`
Llama-3.1-8B shape on one H100, BF16, moderate load. All timings ILLUSTRATIVE; the
bounds come from the roofline lesson.

STEP 1  prefill FLOPs ≈ 2 × params × prompt tokens
                      = 2 × 8.03 × 10⁹ × 2,000 ≈ 3.21 × 10¹³ FLOP
        at 100 % of 989.5 dense TFLOPS: 32.5 ms      ← hard floor
        assume ≈ 50 % achieved:                ≈ 65 ms

STEP 2  TTFT = queue 50 ms + prefill 65 ms + tokenise/network ≈ 10 ms ≈ 125 ms

STEP 3  decode step floor at batch 32, ≈ 2,100 tokens of context each:
        bytes = weights 16.06 GB + KV 32 × 2,100 × 128 KiB (8.81 GB) ≈ 24.9 GB
        24.9 GB ÷ 3.35 TB/s ≈ 7.4 ms                 ← floor
        assume measured TPOT ≈ 15 ms

STEP 4  E2E = 125 + 15 × (200 − 1) = 125 + 2,985 ≈ 3,110 ms
        per-user speed ≈ 1 ÷ 0.015 ≈ 67 tokens/s
        aggregate output ≈ 32 ÷ 0.015 ≈ 2,130 tokens/s for this replica

ANSWER  For this request, decode is 96 % of E2E. Long answers are a decode problem;
        long prompts are a TTFT problem.
`)}
${callout('note','Little’s law, used correctly','For a <i>stable</i> system, average requests in the system L = arrival rate λ × average time in system W. At 10 req/s and W ≈ 3.1 s, about 31 requests are in the server on average — queued plus running. It does not tell you how many are on the GPU at once, and it does not hold when the queue is growing (overload). Use it to sanity-check concurrency settings, not to size GPUs on its own.')}

<h2>4. Where does it fit?</h2>
<p>This lesson is the spine of Part 5. The KV cache (${L('v1-kv-cache','next lesson')}) is the memory that prefill writes and decode reads. Batching (${L('v1-batching','continuous batching')}) decides which requests share each decode step. Quantisation and speculative decoding (${L('v1-quantization-speculative','next')}) change bytes per step and tokens per step. Engines (${L('v1-engines','engines')}) package all of it, and benchmarking (${L('v1-benchmarking','benchmarking')}) measures it. In the platform, the engine sits behind the AI gateway and router and is deployed on Kubernetes (${L('v1-k8s-serving','model serving on Kubernetes')}).</p>

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Model registry / storage</b> → load time and supply-chain security (safetensors, signed artefacts, pinned revisions).</li>
<li><b>Gateway</b> → adds its own latency and enforces max input/output tokens, which bound prefill and KV per request.</li>
<li><b>RAG</b> → retrieval happens <i>before</i> the request reaches the engine and adds to user-perceived TTFT; retrieved passages lengthen the prompt and therefore prefill (${L('v2-rag-fundamentals','RAG')}).</li>
<li><b>Kubernetes probes</b> → readiness must mean “weights loaded, KV allocated, warmed up”, not “process started”.</li>
<li><b>Observability</b> → engine histograms feed SLOs on TTFT and ITL (${L('v2-ai-observability','AI observability')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Concern','You decide / operate'],[
 ['Weight delivery','Where weights live (object store, registry, OCI image volume — Kubernetes image volumes are stable since v1.36), node-local caching, pinned revisions and checksums'],
 ['Startup and readiness','Startup probe long enough for load + graph capture; readiness on the engine’s health endpoint (vLLM <code>/health</code>); no traffic before warm-up'],
 ['Request limits','Max prompt tokens, max output tokens, timeouts, streaming enabled'],
 ['Latency SLOs','TTFT and ITL percentiles per route/tenant, from engine histograms and gateway timings'],
 ['Capacity signals','Queue length (<code>vllm:num_requests_waiting</code>), running requests, KV usage — not CPU']
])}
${code('bash',`# serve the model (single GPU) — labs/05-serving/serve_vllm.sh (planned) adds production flags
vllm serve Qwen/Qwen3-1.7B --port 8000 --max-model-len 8192

# stream one chat completion and watch tokens arrive
curl -N http://localhost:8000/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"Qwen/Qwen3-1.7B","stream":true,"messages":[{"role":"user","content":"Is my flight to Riyadh on time?"}]}'

# engine metrics for TTFT / ITL / queue
curl -s http://localhost:8000/metrics | grep -E "time_to_first_token|inter_token_latency|num_requests_waiting"`)}
${callout('devops','DevOps bridge','A model server’s readiness is like a JVM service that must warm its caches before taking traffic — but measured in minutes and gigabytes. Treat time-to-ready as a first-class SLO for autoscaling: if a replica takes 2 minutes to become ready, your autoscaler must act on leading signals (queue growth) at least 2 minutes before users feel it.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely stage','Evidence','Fix'],[
 ['Pod Running for minutes but not Ready','Loading: download, load, graph capture','Engine startup log timestamps; network throughput','Cache weights on node; longer startup probe; pre-pull images'],
 ['TTFT high, TPOT normal','Queue or prefill','<code>vllm:request_queue_time_seconds</code> vs <code>request_prefill_time_seconds</code>; prompt-length histogram','Queue: more replicas / admission limits. Prefill: shorter prompts, prefix caching, chunked prefill, FP8'],
 ['TPOT high, TTFT normal','Decode','Running requests high; long contexts; KV usage','Lower max-num-seqs, quantise, faster-memory GPU, more replicas'],
 ['Streams stutter (ITL spikes)','Other requests’ prefills or preemption','p99 ITL ≫ TPOT; long prompts arriving; preemption logs','Chunked prefill, token budget, KV headroom'],
 ['Fluent but wrong or odd-format output','Chat template / tokenizer mismatch, wrong generation config','Compare rendered prompt with model card; tokenizer revision','Pin model + tokenizer + template together'],
 ['Client sees whole answer at once, not streamed','Proxy buffering','TTFT at client ≈ E2E','Disable response buffering on ingress/gateway for SSE']
])}
<div class="dtree"><ul><li><span class="q">Users say “the assistant is slow”. Which stage?</span><ul>
<li><span class="a">slow to start answering?</span>TTFT → split into queue time and prefill time.</li>
<li><span class="a">starts fast, types slowly?</span>TPOT → decode: batch size, context length, GPU bandwidth.</li>
<li><span class="a">types, then freezes, then continues?</span>ITL spikes → chunked prefill, preemption.</li>
<li><span class="a">only after a deploy or scale-out?</span>Cold start → loading pipeline.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<p>Scale each stage against its own bottleneck: <b>loading</b> with caching and faster storage paths; <b>queueing</b> with more replicas and admission control; <b>prefill</b> with more FLOPs (FP8, tensor parallelism), prefix caching and shorter prompts; <b>decode</b> with batching, quantisation, KV-cache efficiency and bandwidth. At large scale, prefill and decode are split across different GPU pools (${L('v2-distributed-inference','disaggregated serving')}).</p>

<h2>9. How do we optimize its cost?</h2>
<p>Cost per token is GPU-hours ÷ tokens. Decode dominates GPU time for chat (96 % of E2E in the worked example), so the biggest levers are those that raise decode tokens per step: fuller batches, fewer bytes per weight and per KV entry. Prefill is cheap per token but scales with prompt length: RAG and agent prompts with tens of thousands of tokens shift cost towards prefill, where prefix caching (${L('v2-prefix-kv-cache','prefix caching')}) helps most. Cold starts cost both GPU time and SLO misses; a warm minimum is often cheaper than the misses it prevents.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Walk me through what happens when a user sends a prompt to a self-hosted LLM, and how you would measure latency.”','<p><i>Answer (≈60 s):</i> “The API server applies the chat template and tokenises the prompt, then the scheduler admits it into the running batch when there is a slot and KV memory. Prefill runs all prompt tokens through the model in parallel, writes their keys and values into the KV cache and produces the first token — that is compute-bound and, with queue time, makes up TTFT. Then decode generates one token per iteration, reading all weights and the sequence’s KV cache, which is memory-bound and sets TPOT. Tokens are detokenised and streamed over SSE. I measure TTFT, TPOT, the inter-token-latency distribution and end-to-end latency as percentiles from the engine’s histograms, and split TTFT into queue and prefill time, because a slow first token and slow typing have different causes and different fixes.”</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“The model processes the prompt and returns the answer; latency is about 3 seconds.”</p></div><div class="good"><h4>Strong answer</h4><p>Names each stage, which resource limits it, which metric it drives, and how to split TTFT into causes.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Weights on storage','load time','ready replica','autoscaling lag'])}
${chain(['Prompt tokens','prefill (compute)','TTFT'])}
${chain(['Output tokens','decode (memory bandwidth)','TPOT / ITL','cost per token'])}
<p>Next: ${L('v1-kv-cache','the KV cache and PagedAttention')}, the memory that connects prefill to decode. Then ${L('v1-batching','continuous batching')} and ${L('v1-benchmarking','benchmarking')}.</p></div>

<h3>Lab</h3>
<p>Without a GPU, run the planned mock server <code>labs/05-serving/mock_openai_server.py</code> (stdlib, streams tokens with configurable prefill and per-token delays) and point <code>labs/05-serving/bench_client.py</code> at it: it records arrival, first-token and per-token timestamps and computes TTFT, TPOT, ITL and E2E exactly as defined above. With a GPU, repeat against <code>labs/05-serving/serve_vllm.sh</code> and compare with the engine’s own histograms.</p>
`,
  quiz:[
    {q:'A request arrives at t = 0, its first token is received at 300 ms and its 101st (last) token at 2,300 ms. What are TTFT and TPOT?',options:['300 ms and 23 ms','300 ms and 20 ms','2,300 ms and 20 ms','300 ms and 22.8 ms'],answer:1,explain:'TTFT = 300 ms. TPOT = (2,300 − 300) ÷ (101 − 1) = 20 ms. 22.8 would divide E2E by all tokens, which mixes in TTFT.'},
    {q:'Users report a long pause before any text appears, but once it starts it streams smoothly. Where do you look first?',options:['Decode kernels','Queue time and prefill time (TTFT components)','Detokenizer','KV-cache dtype'],answer:1,explain:'TTFT is high and TPOT normal → queueing or prefill (long prompts). Decode is fine.'},
    {q:'Why is decode usually memory-bound?',options:['It runs on CPU','Each step reads all weights and the KV cache to produce one token per sequence, so FLOPs per byte are low','Sampling is slow','Tokenisation dominates'],answer:1,explain:'Intensity ≈ batch size, far below the H100 ridge point of ≈295 FLOP/B.'},
    {q:'Why do engines prefer safetensors over pickle-based .bin checkpoints?',options:['Smaller files','Loading cannot execute code, and the known offsets allow zero-copy memory-mapped loading','Better compression','Required by CUDA'],answer:1,explain:'Pickle can run arbitrary code at load; safetensors is a header plus raw bytes, which is both safer and faster to load.'},
    {q:'A 141 GB model is pulled at an effective 1.25 GB/s. Roughly how long does the download alone take?',options:['11 s','113 s','1,130 s','45 s'],answer:1,explain:'141.2 ÷ 1.25 ≈ 113 s. 45 s would need 3.125 GB/s (25 Gb/s).'},
    {q:'p99 ITL is 600 ms while mean TPOT is 22 ms. Most likely cause?',options:['Slow network for all tokens','Occasional stalls, e.g. long prefills of other requests in the same iterations or preemptions','Wrong chat template','The model is too small'],answer:1,explain:'Rare large gaps barely move the average but dominate the tail; chunked prefill and KV headroom address them.'}
  ],
  flashcards:[
    {front:'TTFT',back:'Arrival → first output token. ≈ queue + prefill (+ tokenisation, network).'},
    {front:'TPOT formula',back:'(E2E − TTFT) ÷ (output tokens − 1). One average per request.'},
    {front:'ITL vs TPOT',back:'ITL = every individual gap (a distribution, watch p99). TPOT = per-request mean of those gaps.'},
    {front:'E2E',back:'TTFT + TPOT × (n − 1).'},
    {front:'Prefill vs decode bottleneck',back:'Prefill: compute-bound (many tokens per weight read) → TTFT. Decode: memory-bound (one token per sequence per weight read) → TPOT.'},
    {front:'Download time',back:'size ÷ effective bandwidth. 16 GB at 1.25 GB/s ≈ 12.8 s; 141 GB ≈ 113 s.'},
    {front:'Why safetensors',back:'No code execution on load (pickle can execute code); header + raw bytes allow mmap zero-copy loading.'}
  ]
});
registerGlossary([
  {term:'Prefill',def:'The inference phase that processes all prompt tokens in parallel, writes their keys and values to the KV cache and produces the first output token; usually compute-bound.',lesson:'v1-inference-anatomy'},
  {term:'Decode',def:'The inference phase that generates one token per sequence per iteration, reading all weights and the sequence’s KV cache; usually memory-bandwidth-bound.',lesson:'v1-inference-anatomy'},
  {term:'TTFT',def:'Time to first token: from request arrival to the first output token; dominated by queue time and prefill.',lesson:'v1-inference-anatomy',aliases:['time to first token']},
  {term:'TPOT',def:'Time per output token: (E2E − TTFT) ÷ (output tokens − 1) for one request.',lesson:'v1-inference-anatomy',aliases:['time per output token']},
  {term:'ITL',def:'Inter-token latency: each gap between consecutive streamed tokens; reported as a distribution (p50/p99).',lesson:'v1-inference-anatomy',aliases:['inter-token latency']},
  {term:'E2E latency',def:'End-to-end latency from request arrival to the last token: TTFT + TPOT × (n − 1).',lesson:'v1-inference-anatomy',aliases:['end-to-end latency','E2E']}
]);

/* ===================================================================== 1.5.3 */
registerLesson({
  id:'v1-batching', vol:1, part:5, num:3,
  title:'Continuous batching, chunked prefill and request scheduling', minutes:85,
  summary:'Because decode reads every weight to produce one token per sequence, a GPU serving one user at a time wastes almost all of its arithmetic. Batching lets many sequences share each weight read. Static batching waits for the slowest member of a batch, so short answers sit as padding and new users queue. Continuous batching, introduced by the Orca paper, re-forms the batch at every forward pass so requests join and leave individually. Chunked prefill splits long prompts so they do not freeze everyone else’s stream. The scheduler decides who runs each iteration, under limits on sequences, tokens and KV memory, and preempts a request when memory runs out. These limits are where throughput and latency are traded.',
  objectives:[
    'Explain why batching raises decode throughput, using the roofline and a worked bytes-per-step calculation.',
    'Contrast static, dynamic (request-level) and continuous (iteration-level) batching, and compute the waste of static batching on a mixed workload.',
    'Explain chunked prefill and the token-budget trade-off between inter-token latency and time to first token.',
    'Describe admission, scheduling policies and preemption (recompute vs swap) and their symptoms.',
    'Tune max-num-seqs and max-num-batched-tokens against a latency SLO.'
  ],
  prereqs:['v1-inference-anatomy','v1-kv-cache'],
  next:['v1-quantization-speculative','v1-engines','v1-benchmarking','v2-hyperscale-serving'],
  tags:['inference','scheduling','batching','vllm','latency'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A shuttle bus between the airport and the city. Static batching: the bus leaves only when full and does not let anyone off until the last stop, so a passenger for the first stop rides the whole route and new passengers wait for the next bus. Continuous batching: a hop-on, hop-off bus that stops every block — passengers leave when they arrive and new ones fill the seat immediately. Now the real mechanism.')}
<p><b>Batching</b> means running several sequences through the model in the same forward pass. ${term('Continuous batching')} (also called iteration-level scheduling or in-flight batching) means the set of sequences in the batch can change at <b>every</b> iteration: finished sequences leave, waiting ones join. ${term('Chunked prefill')} splits a long prompt’s prefill across several iterations so that it can share each iteration with other users’ decode steps. The <b>scheduler</b> is the engine component that decides, each iteration, which sequences run and how many tokens each contributes.</p>

<h2>2. Why do we need it?</h2>
<p>From ${L('v1-gpu-architecture','the roofline lesson')}: a decode step for one sequence has arithmetic intensity ≈ 1 FLOP/byte, while an H100 needs ≈ 295 to be compute-bound. Almost all of the chip idles. Batching N sequences reuses each weight read N times:</p>
${formula(`
Llama-3.1-8B shape, BF16, one H100 (3.35 TB/s), each sequence has 2,048 tokens of context.
KV per token = 128 KiB = 131,072 B. Bandwidth floors (real numbers are higher).

batch N   bytes per step                          step floor   TPOT floor   tokens/s ceiling
  1       16.06 GB + 0.27 GB  = 16.33 GB           4.9 ms       4.9 ms        ≈ 205
 64       16.06 GB + 17.18 GB = 33.24 GB           9.9 ms       9.9 ms        ≈ 6,450
222       16.06 GB + 59.59 GB = 75.65 GB          22.6 ms      22.6 ms        ≈ 9,830
            ↑ weights (shared)  ↑ KV (one copy per sequence, never shared)

222 is the most that fits: the KV pool from the memory lesson (≈ 55.6 GiB ≈ 455,000 tokens)
÷ 2,048 tokens ≈ 222 sequences.

ANSWER  Batching multiplies throughput (≈ 48× from 1 to 222) but TPOT grows (4.9 → 22.6 ms)
        because KV reads grow with the batch. Throughput and per-user latency trade off.
`)}
<p>Every serving system must therefore batch. The question is <i>how</i> — and the naive answer wastes most of the benefit.</p>

<h2>3. How does it work internally?</h2>
<h3>Static and dynamic batching</h3>
<p><b>Static batching</b> collects B requests, runs prefill for all, then decodes in lock-step until every sequence has finished. Requests have very different output lengths, so sequences that finish early keep their slot as padding, and new arrivals wait for the whole batch. <b>Dynamic batching</b> (as in classic model servers such as Triton’s dynamic batcher) improves only the <i>forming</i> of batches — wait up to a short delay to collect requests — but a formed batch still runs to completion. That is fine for fixed-cost models (image classifiers, embeddings) and poor for generation.</p>
${formula(`
Static batch of 4, decode lengths A = 3, B = 8, C = 2, D = 5

slot-iterations reserved = 4 slots × (1 prefill + 8 decode) = 36
slot-iterations useful   = 4 prefills + (3 + 8 + 2 + 5)    = 22
utilisation              = 22 ÷ 36 ≈ 61 %
and every request arriving during those 9 iterations waits for the batch to finish.
`)}
<h3>Continuous batching (Orca)</h3>
<p>The Orca paper (Yu et al., OSDI 2022) introduced <b>iteration-level scheduling</b>: the scheduler runs one model iteration at a time and, between iterations, retires finished sequences and admits new ones. It also introduced <b>selective batching</b>: operations that do not depend on sequence position (the big matrix multiplies) are batched across all tokens of all sequences, while attention is computed per sequence. Modern engines combine this with PagedAttention (${L('v1-kv-cache','KV cache')}), so each sequence owns its own KV blocks and sequences of different lengths sit in one batch with no padding.</p>
${anim('v1-inf-static-vs-cont')}
${anim('v1-inf-continuous')}

<h3>What one scheduler iteration does</h3>
<ol>
<li>Retire sequences that produced an end token or hit their max tokens; free their KV blocks.</li>
<li>Give each <b>running</b> decode sequence one token slot, as long as it can get a KV block for its next token.</li>
<li>Spend the remaining <b>token budget</b> (vLLM: <code>--max-num-batched-tokens</code>) on <b>waiting</b> requests’ prefill, in policy order, while the number of sequences stays ≤ <code>--max-num-seqs</code> and free KV blocks suffice.</li>
<li>If a running sequence cannot get a block, <b>preempt</b> someone (below).</li>
<li>Launch one forward pass over this mixed batch of prefill chunks and decode tokens; sample; stream.</li>
</ol>

<h3>Chunked prefill</h3>
<p>A 6,000-token prompt prefilled in one iteration makes that iteration long (≈180 ms in our illustration), and every running user’s next token waits for it — a visible stutter (p99 ITL spike). Chunked prefill caps the tokens per iteration and splits the prompt: 2,048 + 2,048 + 1,904 tokens over three iterations, each also carrying everyone else’s decode tokens. The idea comes from SARATHI (arXiv 2308.16369) and Sarathi-Serve (OSDI 2024, arXiv 2403.02310). vLLM V1 enables chunked prefill by default whenever possible.</p>
${anim('v1-inf-chunked')}
${table(['Token budget per iteration','Effect on running users (ITL)','Effect on long prompts (TTFT)','Throughput'],[
 ['Small (e.g. 512–2,048)','Smooth, small spikes','Longer: more iterations per prompt','Lower prefill efficiency'],
 ['Large (e.g. 8,192–16,384+)','Larger spikes when long prompts arrive','Shorter','Higher; vLLM docs suggest &gt; 8,192 for throughput']
])}

<h3>Admission, scheduling policy and preemption</h3>
<ul>
<li><b>Admission</b>: a waiting request is admitted only if its prompt’s KV blocks fit. With prefix caching, blocks already cached for its prefix do not need to be computed or allocated again (${L('v2-prefix-kv-cache','prefix caching')}).</li>
<li><b>Policy</b>: first-come-first-served is the common default (SGLang’s <code>--schedule-policy</code> defaults to <code>fcfs</code>; it also offers <code>lpm</code>, longest-prefix-match, a cache-aware policy, and <code>priority</code>). Priority and fairness between <i>tenants</i> is usually enforced earlier, at the gateway, with per-tenant concurrency and token limits.</li>
<li><b>${term('Preemption')}</b>: during decode every running sequence needs new KV blocks. If the pool is exhausted, the scheduler evicts a running sequence (typically the most recently admitted), frees its blocks, and puts it back in the queue. In vLLM V1 the default preemption mode is <b>recompute</b>: the evicted sequence’s KV is rebuilt later by re-running prefill over its prompt plus the tokens it had already generated. The alternative, <b>swap</b>, copies blocks to CPU memory and back over PCIe. Either way, work is wasted and the victim sees a long ITL gap.</li>
</ul>
${table(['vLLM knob (as of v0.31)','Default (from vLLM source, Oct 2026)','Meaning'],[
 ['<code>--max-num-seqs</code>','1,024 on ≥70 GB non-A100 GPUs (H100/H200) and ≥160 GB GPUs (B200/B300); 256 on other GPUs','Max sequences in one iteration'],
 ['<code>--max-num-batched-tokens</code>','<code>vllm serve</code>: 8,192 on H100/H200-class, 16,384 on B200-class, 2,048 on other GPUs','Token budget per iteration (prefill chunks + decode tokens)'],
 ['<code>--max-model-len</code>','From model config; <code>auto</code>/-1 = largest that fits','Max prompt + output per sequence'],
 ['<code>--gpu-memory-utilization</code>','0.92','Sets the KV pool size indirectly']
])}
${callout('unverified','Defaults move','The defaults above were read from vLLM’s <code>arg_utils.py</code> on 2026-10-14 and depend on GPU memory size and entrypoint. Always print the effective config at startup and record it with every benchmark.')}

<h3>Worked example: a tuning session against an SLO</h3>
<p>Atlas chat traffic on one H100, SLO p95 TTFT ≤ 500 ms and p99 ITL ≤ 50 ms. An open-loop sweep at 6 req/s with three settings gives (ILLUSTRATIVE numbers, to show the reasoning):</p>
${table(['Setting','p95 TTFT','p99 ITL','Output tok/s','Meets SLO?','Reading'],[
 ['max-num-seqs 32, budget 2,048','1,900 ms','28 ms','2,100','No','Too few slots: requests queue → TTFT fails although each stream is smooth'],
 ['max-num-seqs 256, budget 16,384','310 ms','95 ms','3,900','No','Big prefills share iterations with decodes → ITL tail fails'],
 ['max-num-seqs 256, budget 4,096','380 ms','44 ms','3,600','Yes','Enough slots for arrivals; prefills chunked small enough for smooth streams']
])}
<p>The third setting gives up ≈ 8 % of peak throughput to meet both SLOs. That is the normal shape of the answer: <b>slots</b> (max-num-seqs, KV memory) fix TTFT queueing, the <b>token budget</b> fixes ITL spikes, and the best configuration is the one with the highest goodput that passes both — found by measurement (${L('v1-benchmarking','benchmarking')}), not by reading defaults.</p>
<h3>Fairness between tenants</h3>
<p>An engine’s FCFS queue knows nothing about tenants. If one internal team submits 2,000 long summarisation requests at once, every chat user behind them waits. Defences, from cheapest: per-tenant concurrency and token-rate limits at the gateway; separate engine pools for batch and interactive work; priority classes where the engine supports them; and admission deadlines (reject with 429 when the expected queue time already exceeds the SLO). Little’s law gives a quick sanity check for a stable pool: at λ = 6 req/s and an average E2E of 3 s, about 18 requests are in the system — so a max-num-seqs of 256 is not the constraint; KV memory or the token budget is.</p>

<h2>4. Where does it fit?</h2>
${fig('The scheduler sits between the queue, the KV pool and the GPU', svgDiagram({w:900,h:300,
 boxes:[
  {id:'q',x:20,y:110,w:170,h:60,label:'Waiting queue',sub:'policy: FCFS / priority',cls:'warn'},
  {id:'s',x:260,y:110,w:200,h:60,label:'Scheduler',sub:'every iteration',cls:'hl'},
  {id:'kv',x:260,y:220,w:200,h:56,label:'KV block manager',sub:'free blocks?'},
  {id:'lim',x:260,y:10,w:200,h:56,label:'Limits',sub:'max-num-seqs, token budget'},
  {id:'b',x:530,y:110,w:170,h:60,label:'Mixed batch',sub:'prefill chunks + decodes'},
  {id:'g',x:760,y:110,w:120,h:60,label:'GPU pass',sub:'one iteration',cls:'v2'}
 ],
 arrows:[{from:'q',to:'s',label:'admit?'},{from:'lim',to:'s'},{from:'kv',to:'s',both:true},{from:'s',to:'b'},{from:'b',to:'g'},{from:'s',to:'q',cls:'dash',label:'preempt'}]
}), 'Three constraints are checked every iteration: sequence count, token budget and free KV blocks. Preempted sequences go back to the queue.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>KV cache</b>: free blocks are the admission currency; KV pressure causes queueing and preemption (${L('v1-kv-cache','KV cache')}).</li>
<li><b>Gateway</b>: per-tenant limits and priorities protect the shared batch from one noisy tenant (${L('v2-ai-gateway','AI gateway')}).</li>
<li><b>Router</b>: cache-aware routing sends requests where their prefix blocks already live, reducing prefill work per batch (${L('v2-distributed-kv','cache-aware routing')}).</li>
<li><b>Autoscaling</b>: <code>vllm:num_requests_waiting</code> and KV usage are the right scale-out signals (${L('v1-k8s-autoscaling','autoscaling')}).</li>
<li><b>Disaggregation</b>: when prefill/decode interference cannot be tuned away, prefill and decode move to separate GPU pools (${L('v2-distributed-inference','distributed inference')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<p>You own the limits and the evidence:</p>
${table(['Goal','Lever','Watch'],[
 ['Protect TTFT for chat','Moderate token budget, enough replicas, per-tenant concurrency caps','<code>vllm:request_queue_time_seconds</code>, TTFT p95/p99'],
 ['Protect streaming smoothness','Chunked prefill with a token budget sized to your ITL SLO; keep KV headroom to avoid preemption','<code>vllm:inter_token_latency_seconds</code> p99'],
 ['Maximise throughput for offline batch','Large budget and max-num-seqs; separate pool from interactive traffic','Output tokens/s, GPU cost per 1M tokens'],
 ['Stop overload collapse','Admission control and queue-time deadlines at the gateway; reject early with 429 rather than time out late','Waiting requests, goodput']
])}
${callout('devops','DevOps bridge','The token budget is like a database connection pool size combined with a request-size limit: too small and you under-use the backend, too large and one huge query blocks everyone. Where the analogy breaks: here the “queries” share the same physical pass, so one large prompt literally lengthens every other user’s next step.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['TTFT rises with load, TPOT flat','Queueing: no free slots or KV blocks','Waiting &gt; 0; KV usage ≈ 100 % or running = max-num-seqs','Scale out; cap context/concurrency; FP8 KV'],
 ['TPOT rises with load','Batch too large for the SLO; long contexts','Running sequences high; per-step time growing','Lower max-num-seqs; split long-context traffic; more replicas'],
 ['p99 ITL spikes when long prompts arrive','Prefill sharing iterations with decode','ITL spikes correlate with prompt-length histogram','Smaller token budget; chunked prefill on; separate long-prompt pool; disaggregation'],
 ['Throughput falls under peak load, latency erratic','Preemption thrash (recompute)','Preemption counter / log messages rising','Lower max-num-seqs; more KV headroom; scale out'],
 ['Short requests starve behind long ones','FCFS with heavy-tail outputs; static batching','Per-request queue time vs output length','Continuous batching; output caps; priority classes; separate pools']
])}
${callout('unverified','Preemption metric name','A preemption counter is exposed in vLLM’s Prometheus endpoint in many versions, but it was not listed on the v0.31 metrics design page checked on 2026-10-14. Check <code>/metrics</code> on your version and the engine logs.')}

<h2>8. How do we scale it?</h2>
<ol>
<li>Tune one replica first: find max-num-seqs and token budget that hold your TTFT/ITL SLO at maximum goodput (${L('v1-benchmarking','benchmarking')}).</li>
<li>Add replicas behind a router; prefer cache-aware routing when prompts share prefixes.</li>
<li>Separate traffic classes (interactive vs batch, short vs very long context) into pools with different limits.</li>
<li>When prefill and decode still interfere at scale, disaggregate them (${L('v2-distributed-inference','next volume')}).</li>
</ol>

<h2>9. How do we optimize its cost?</h2>
<p>The worked table is the cost story: the same GPU-hour produced ≈205 tokens/s at batch 1 and up to ≈9,830 tokens/s at batch 222 (ceilings). Cost per million tokens falls almost proportionally — until TPOT breaks the SLO. The economic optimum is the largest batch that still meets the SLO, measured, not the largest batch that fits. Offline jobs (summarising a day of support tickets, evaluations) should run at maximum batch on separate or off-peak capacity, where TPOT does not matter.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How does continuous batching work in vLLM, and what would you tune?”','<p><i>Answer (≈60 s):</i> “Decode is memory-bound, so batching lets many sequences share each read of the weights. Static batching waits for the longest sequence, so short answers become padding and new users queue. vLLM schedules at the iteration level, as in the Orca paper: every forward pass, finished sequences leave and waiting ones join if there is a sequence slot, room in the per-iteration token budget and free KV blocks. Long prompts are split by chunked prefill so they share iterations with other users’ decode steps instead of freezing them. If KV blocks run out, the scheduler preempts a sequence and recomputes it later. I tune max-num-seqs and max-num-batched-tokens with an open-loop benchmark on real token distributions, and pick the setting with the highest goodput that still meets the TTFT and p99 inter-token-latency SLOs.”</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“vLLM batches requests together, so we set the batch size as high as possible.”</p></div><div class="good"><h4>Strong answer</h4><p>Explains iteration-level scheduling, the three constraints, chunked prefill, preemption, and tunes against an SLO with goodput.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Memory-bound decode','batching','weights read once per step','throughput ↑','TPOT ↑'])}
${chain(['Long prompt','chunked prefill','token budget','ITL vs TTFT trade-off'])}
${chain(['KV blocks exhausted','queue / preemption','TTFT ↑, wasted compute'])}
<p>Next: ${L('v1-quantization-speculative','quantization and speculative decoding')} — fewer bytes per step and more tokens per step. Later: ${L('v2-hyperscale-serving','queueing, admission control and autoscaling at scale')}.</p></div>

<h3>Lab</h3>
<p>Use the planned <code>labs/05-serving/bench_client.py</code> against a vLLM server twice: once with <code>--max-num-seqs 16</code>, once with <code>--max-num-seqs 256</code>, at the same open-loop request rate. Plot output tokens/s, TTFT p99 and ITL p99 for both. Then send a few 6,000-token prompts while short chats are streaming, with two different <code>--max-num-batched-tokens</code> values, and observe the ITL tail.</p>
`,
  quiz:[
    {q:'Static batch of 4 with decode lengths 3, 8, 2 and 5 (plus one prefill iteration each). What fraction of slot-iterations is useful?',options:['≈ 45 %','≈ 61 %','≈ 75 %','100 %'],answer:1,explain:'Reserved 4 × 9 = 36; useful 4 + 18 = 22; 22/36 ≈ 61 %.'},
    {q:'What does iteration-level scheduling (Orca) change compared with static batching?',options:['It uses larger batches','The batch membership can change at every forward pass, so finished sequences leave and new ones join immediately','It removes the KV cache','It runs prefill on CPU'],answer:1,explain:'That is the core idea; selective batching handles different sequence lengths.'},
    {q:'Long prompts arriving cause p99 ITL spikes for users already streaming. Which change targets this directly?',options:['Increase --max-num-batched-tokens','Chunked prefill with a smaller per-iteration token budget','Raise --gpu-memory-utilization','Disable prefix caching'],answer:1,explain:'A smaller budget splits big prefills into more, shorter iterations so running decodes keep flowing (at some cost to the long prompt’s TTFT).'},
    {q:'In vLLM V1, what happens by default to a preempted sequence?',options:['It is dropped with an error','Its KV is swapped to SSD','Its blocks are freed and its KV is recomputed later by re-running prefill','It moves to another GPU'],answer:2,explain:'Default preemption mode is recompute; swap to CPU memory is the alternative.'},
    {q:'Batch 64 vs batch 222 on the 8B example: what happens to TPOT and why?',options:['Falls, because more tokens are produced','Rises, because each step must read more KV bytes (one copy per sequence)','Unchanged, weights dominate','Rises, because weights are read 222 times'],answer:1,explain:'Weights are read once per step; KV is per sequence. Step bytes 33 → 76 GB, so TPOT floor 9.9 → 22.6 ms.'}
  ],
  flashcards:[
    {front:'Why batch decode?',back:'Decode intensity ≈ batch size. Batching reuses each weight read across N sequences → near-linear throughput gain while memory-bound.'},
    {front:'Static vs dynamic vs continuous batching',back:'Static: fixed batch runs to completion. Dynamic: forms batches with a wait window, still runs to completion. Continuous: batch re-formed every iteration (Orca).'},
    {front:'Three admission constraints per iteration',back:'max-num-seqs, token budget (max-num-batched-tokens), free KV blocks.'},
    {front:'Chunked prefill trade-off',back:'Smaller token budget → smoother ITL for running users, longer TTFT for long prompts. Larger → reverse.'},
    {front:'Preemption modes',back:'Recompute (default in vLLM V1): free blocks, re-prefill later. Swap: copy blocks to CPU and back. Both waste work and cause ITL gaps.'},
    {front:'Best batch size',back:'The largest batch whose measured TTFT/ITL still meet the SLO — not the largest that fits.'}
  ]
});
registerGlossary([
  {term:'Continuous batching',def:'Iteration-level scheduling (Orca, OSDI 2022): the engine re-forms the batch at every forward pass, adding waiting requests and removing finished ones.',lesson:'v1-batching',aliases:['iteration-level scheduling','in-flight batching']},
  {term:'Static batching',def:'Running a fixed batch until every member finishes; early finishers become padding and new requests wait.',lesson:'v1-batching'},
  {term:'Dynamic batching',def:'Forming batches from requests that arrive within a short wait window; each formed batch still runs to completion.',lesson:'v1-batching'},
  {term:'Chunked prefill',def:'Splitting a prompt’s prefill into chunks bounded by a per-iteration token budget so it can share iterations with other sequences’ decode steps (SARATHI).',lesson:'v1-batching'},
  {term:'Token budget',def:'Maximum tokens (prefill chunks plus decode tokens) processed in one engine iteration; vLLM --max-num-batched-tokens.',lesson:'v1-batching',aliases:['max-num-batched-tokens']},
  {term:'Selective batching',def:'Orca technique: batch position-independent operations (matmuls) across all tokens while computing attention per sequence.',lesson:'v1-batching'}
]);

/* ===================================================================== 1.5.4 */
registerLesson({
  id:'v1-quantization-speculative', vol:1, part:5, num:4,
  title:'Quantization and speculative decoding', minutes:90,
  summary:'Two families of techniques make decode cheaper. Quantization stores weights, and sometimes activations and the KV cache, in fewer bits: eight-bit floating point, eight-bit or four-bit integers, or NVIDIA’s four-bit floating point on Blackwell. Fewer bytes per weight means faster memory-bound decode and more room for users; low-precision activations also speed up compute-bound prefill, but only on hardware with matching Tensor Cores. Every quantized model must be re-evaluated on your own tasks and languages. Speculative decoding makes each expensive forward pass produce several tokens: a cheap draft guesses ahead and the real model verifies all guesses in one pass, keeping exactly its own output distribution. How much it helps depends on the acceptance rate, the draft’s cost and how busy the GPU already is.',
  objectives:[
    'Explain the number formats used for inference (BF16, FP8 E4M3/E5M2, INT8, INT4, NVFP4) and which GPUs accelerate them.',
    'Distinguish weight-only (W4A16, W8A16) from weight-and-activation (W8A8, FP8) quantization and KV-cache quantization, and predict which phase each speeds up.',
    'Compute memory footprints including group scales and unquantized embeddings, and the resulting KV capacity.',
    'Design a quality evaluation that would catch a harmful quantization.',
    'Explain speculative decoding (draft model, EAGLE, MTP, n-gram) and compute expected tokens per target pass and speed-up from acceptance rate and draft cost.'
  ],
  prereqs:['v1-inference-anatomy','v1-kv-cache','v1-batching'],
  next:['v1-engines','v1-benchmarking','v2-finops-optimization','v2-evaluation-monitoring'],
  tags:['inference','quantization','speculative-decoding','performance'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Quantization is like storing photos as high-quality JPEG instead of RAW: a quarter of the size, and for most uses nobody can tell — until you zoom into exactly the detail that matters. Speculative decoding is like a junior colleague drafting the next sentence of an email while you read: if the draft matches what you would have written, you approve several words at a glance; if not, you correct the first wrong word and continue. Now the real mechanisms.')}
<p>${term('Quantization')} maps high-precision numbers (BF16: 16 bits) to fewer bits (8 or 4) plus a small number of <b>scale</b> factors, so that <code>real value ≈ scale × quantized value</code>. ${term('Speculative decoding')} uses a cheap proposer to guess k future tokens and the full (target) model to verify them all in one forward pass, accepting a prefix of the guesses.</p>

<h2>2. Why do we need it?</h2>
<p>Decode is memory-bound: time per step ≈ bytes read ÷ bandwidth (${L('v1-gpu-architecture','roofline')}). Halving bytes per weight roughly halves the weight-reading part of every decode step and frees HBM for KV cache, which raises concurrency (${L('v1-kv-cache','KV capacity')}). And because each decode pass yields only one token per sequence, any way of getting several tokens per pass — without changing the output — cuts latency directly. Both techniques attack the same bottleneck from different sides: <b>fewer bytes per pass</b> and <b>more tokens per pass</b>.</p>

<h2>3. How does it work internally?</h2>
<h3>Part A — number formats</h3>
${table(['Format','Bits','Structure','Accelerated on (Tensor Cores)','Typical use'],[
 ['BF16','16','1 sign, 8 exponent, 7 mantissa','Ampere and newer','Default for weights and activations'],
 ['FP8 E4M3','8','1/4/3, max ≈ ±448','Hopper (H100/H200), Ada (L4, L40S), Blackwell','Weights, activations, KV cache'],
 ['FP8 E5M2','8','1/5/2, wider range, less precision','Same','Gradients, some KV caches'],
 ['INT8','8','integer + scale','Ampere and newer','W8A8 (SmoothQuant-style), W8A16'],
 ['INT4','4','integer + per-group scale (and zero point)','Mostly dequantized to BF16 in kernels (weight-only)','W4A16 with AWQ or GPTQ'],
 ['NVFP4','4 (+ scales)','E2M1 values, one FP8 E4M3 scale per 16 values, plus a per-tensor FP32 scale','Blackwell (TensorRT-LLM lists sm100/103/120; not Hopper/Ada/Ampere)','Weights, activations and KV on Blackwell']
])}
<p>A100 has no FP8 Tensor Cores: FP8 checkpoints may still load there through weight-only kernels, but without the compute speed-up. Check hardware support before planning a precision.</p>
<h3>Part B — what gets quantized</h3>
${table(['Scheme','Weights','Activations (matmul inputs)','Speeds up','Main risk'],[
 ['<b>Weight-only</b> W8A16 / W4A16 (AWQ, GPTQ)','8 or 4 bit','BF16 (weights dequantized on the fly)','Decode (fewer bytes); little or no prefill gain','Quality at 4-bit; dequant overhead at large batch'],
 ['<b>W8A8</b> INT8 (SmoothQuant) or <b>FP8</b>','8 bit','8 bit','Decode and prefill (FP8 doubles the dense Tensor Core roof on Hopper)','Activation outliers; needs calibration or per-token scales'],
 ['<b>W4A8 / NVFP4</b>','4 bit','8 or 4 bit','Both, on supporting hardware','Newest; validate carefully'],
 ['<b>KV-cache quantization</b> (FP8, NVFP4)','—','KV entries in 8/4 bit','Decode at long context; doubles KV capacity at FP8','Long-context and retrieval-style quality']
])}
<p><b>Granularity</b> matters as much as bit-width: one scale per tensor is cheap but coarse; per-channel or per-group (for example every 128 weights) scales track outliers better at a small storage cost. <b>AWQ</b> (activation-aware weight quantization, Lin et al., arXiv 2306.00978) protects the small set of weight channels that see large activations by rescaling them before quantizing. <b>GPTQ</b> (Frantar et al., arXiv 2210.17323) quantizes layer by layer and compensates each rounding error using approximate second-order information from a calibration set. <b>SmoothQuant</b> (Xiao et al., arXiv 2211.10438) moves activation outliers into the weights so both can be INT8. All three are <i>post-training</i>: no retraining, but they need representative calibration data.</p>

<h3>Part C — memory maths that includes the overheads</h3>
${formula(`
STEP 1  bits per weight with group scales (INT4, group size 128, FP16 scale)
        4 + 16 ÷ 128 = 4.125 bits      (+ 4-bit zero point: 4 + 20 ÷ 128 ≈ 4.16)
        NVFP4: 4 + 8 ÷ 16 = 4.5 bits per value (plus one FP32 per tensor)

STEP 2  embeddings and lm_head are often kept in BF16
        Llama-3.1-8B: vocab 128,256 × hidden 4,096 = 525.3 M params each, two of them
        ≈ 1.05 × 10⁹ params × 2 B ≈ 2.1 GB

STEP 3  Llama-3.1-8B shape (8.03 × 10⁹ params)
        BF16                 8.03 × 10⁹ × 2 B                         ≈ 16.1 GB
        FP8                  8.03 × 10⁹ × 1 B                         ≈  8.0 GB
        INT4 g128, naive     8.03 × 10⁹ × 4.125 ÷ 8                   ≈  4.1 GB
        INT4 g128, realistic (8.03 − 1.05) × 10⁹ × 4.125 ÷ 8 + 2.1 GB ≈  5.7 GB

STEP 4  Llama-3.1-70B shape (70.6 × 10⁹ params, embeddings ≈ 2.1 × 10⁹ params)
        BF16 141.2 GB   FP8 70.6 GB   INT4 realistic ≈ 68.5 × 10⁹ × 0.516 + 4.2 GB ≈ 39.5 GB

STEP 5  70B INT4 on ONE H100 (vLLM budget 0.92 × 80 GiB = 73.6 GiB)
        weights 39.5 GB = 36.8 GiB, overhead ≈ 3 GiB (illustrative)
        KV pool ≈ 73.6 − 36.8 − 3 ≈ 33.8 GiB ÷ 320 KiB ≈ 110,800 tokens ≈ 13 sequences of 8k
        with FP8 KV (160 KiB/token):                     ≈ 221,600 tokens ≈ 27 sequences of 8k

ANSWER  "4-bit = a quarter of the size" is a lower bound. Count scales and unquantized layers.
`)}
${formula(`
Decode floor at batch 1 (weights only), H100 3.35 TB/s, 8B shape
BF16 16.06 GB → 4.79 ms     FP8 8.03 GB → 2.40 ms     INT4 ≈ 5.7 GB → 1.70 ms
These are bandwidth floors. Real speed-ups are smaller and shrink at large batch, where KV
reads and (for weight-only schemes) dequantization work take a larger share of each step.
`)}

<h3>Part D — evaluating quality (the step people skip)</h3>
<ol>
<li><b>Decide pass/fail before measuring speed.</b> Example for Atlas: task accuracy on the travel-support eval set within 1 point of BF16; JSON/tool-call validity ≥ 99.5 %; no regression on Arabic and English subsets separately.</li>
<li><b>Use your tasks, not only public benchmarks.</b> Public suites (for example via EleutherAI’s lm-evaluation-harness) catch gross damage; your domain set catches the damage that matters to you.</li>
<li><b>Slice the results</b>: language, prompt length (KV quantization hurts long context first), structured output, refusal/safety behaviour.</li>
<li><b>Compare against the same serving stack</b> (engine, sampling parameters, chat template) — only the precision may change.</li>
<li><b>Canary in production</b> with online metrics and a rollback path (${L('v2-model-cicd','model CI/CD')}, ${L('v2-evaluation-monitoring','evaluation and monitoring')}).</li>
</ol>
${callout('warn','Perplexity is necessary, not sufficient','A small perplexity increase can hide a large drop on a narrow skill (arithmetic, a minority language, strict JSON). Calibration data in one language can also skew which channels AWQ/GPTQ protect. Evaluate per slice.')}

<h3>Part E — speculative decoding</h3>
<p>Each decode pass of the <b>target</b> model reads all its weights to produce one token per sequence. Speculative decoding (Leviathan et al., arXiv 2211.17192; Chen et al., arXiv 2302.01318) runs a cheap <b>proposer</b> for k tokens, then one target pass over those k positions. Accepted tokens are kept; at the first rejection, the target’s own corrected token is used. With the rejection-sampling rule (accept a drafted token with probability min(1, p_target ÷ p_draft), otherwise resample from the adjusted distribution), the output distribution equals the target’s exactly: it is a <b>lossless</b> speed-up.</p>
${table(['Proposer','How it guesses','Strengths','Watch out'],[
 ['Draft model','A smaller model of the same family (same tokenizer)','General purpose','Extra memory and compute; must share the vocabulary'],
 ['EAGLE / EAGLE-3','A light head that predicts next features from the target’s own hidden states (arXiv 2401.15077, 2503.01840)','High acceptance, small cost','Needs a head trained for that exact target model'],
 ['MTP','Multi-token-prediction modules trained with the model (e.g. DeepSeek-V3)','No separate model to manage','Only for models shipped with MTP'],
 ['n-gram / prompt lookup, suffix','Copies continuations that already appear in the prompt or earlier outputs','Free; excellent for RAG quoting, code edits, JSON','Low acceptance on open-ended text']
])}
${formula(`
Per-token acceptance rate α (assumed independent), k drafted tokens per round.

                                         1 − α^(k+1)
expected tokens per target pass  E  =  ─────────────
                                           1 − α

                        E
speed-up  ≈  ─────────────────        c = cost of one draft step ÷ cost of one target step
               1 + k × c

STEP 1  α = 0.8, k = 4:  E = (1 − 0.8⁵) ÷ 0.2 = (1 − 0.32768) ÷ 0.2 ≈ 3.36 tokens
STEP 2  c = 0.05 (EAGLE-like head):  3.36 ÷ 1.20 ≈ 2.80×
        c = 0.20 (bigger draft model): 3.36 ÷ 1.80 ≈ 1.87×
STEP 3  α = 0.6, k = 8, c = 0.20:  E ≈ 2.47 → 2.47 ÷ 2.6 ≈ 0.95×   ← SLOWER than no speculation

ANSWER  Gains need high α and cheap drafts. More draft tokens only help while α is high.
        The formula assumes verification costs one normal step — true when memory-bound
        (small batch), increasingly false at large batch where the target is compute-bound.
`)}
${table(['α','k','E (tokens/pass)','speed-up at c = 0.05','speed-up at c = 0.2'],[
 ['0.6','2','1.96','1.78','1.40'],['0.6','4','2.31','1.92','1.28'],['0.6','8','2.47','1.77','0.95'],
 ['0.8','2','2.44','2.22','1.74'],['0.8','4','3.36','2.80','1.87'],['0.8','8','4.33','3.09','1.66']
])}
${anim('v1-inf-specdec')}

<h2>4. Where does it fit?</h2>
${fig('Where each technique acts in the decode step', svgDiagram({w:900,h:300,
 boxes:[
  {id:'w',x:20,y:40,w:220,h:60,label:'Weights in HBM',sub:'BF16 → FP8 / INT4 / NVFP4',cls:'hl'},
  {id:'kv',x:20,y:180,w:220,h:60,label:'KV cache in HBM',sub:'BF16 → FP8 KV',cls:'hl'},
  {id:'k',x:330,y:110,w:220,h:60,label:'Matmul + attention kernels',sub:'FP8 Tensor Cores (W8A8)'},
  {id:'p',x:640,y:40,w:240,h:60,label:'Proposer',sub:'draft / EAGLE / MTP / n-gram',cls:'v2'},
  {id:'v',x:640,y:180,w:240,h:60,label:'Verify k+1 positions',sub:'accept prefix, correct first miss',cls:'v2'}
 ],
 arrows:[{from:'w',to:'k',label:'fewer bytes'},{from:'kv',to:'k',label:'fewer bytes'},{from:'p',to:'v',label:'k guesses'},{from:'v',to:'k',label:'one pass'}]
}), 'Quantization shrinks what each pass reads; speculation increases how many tokens each pass yields. They combine, but both must be re-measured together.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Model registry</b>: a quantized checkpoint is a new artefact with its own evaluation record and lineage to the BF16 parent (${L('v2-mlops-foundations','MLOps foundations')}).</li>
<li><b>Engines</b>: vLLM, SGLang and TensorRT-LLM each support specific formats and proposers; TensorRT-LLM consumes checkpoints produced with NVIDIA Model Optimizer (${L('v1-engines','engines')}).</li>
<li><b>Capacity planning</b>: precision changes weights, KV per token and therefore replicas (${L('v2-capacity-planning','capacity planning')}).</li>
<li><b>Benchmarking</b>: speculative decoding’s value depends on load level and traffic type — benchmark at the real request rate (${L('v1-benchmarking','benchmarking')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Engine option (verify on your version)','What it does'],[
 ['vLLM: serve a pre-quantized checkpoint (FP8, AWQ, GPTQ, NVFP4…)','Method is read from the checkpoint’s config; nothing else to set in most cases'],
 ['vLLM: <code>--kv-cache-dtype fp8</code> (also <code>fp8_e4m3</code>, <code>fp8_e5m2</code>, <code>nvfp4</code>; default <code>auto</code>)','Quantizes the KV cache'],
 ['vLLM: <code>--speculative-config</code> JSON, methods include <code>draft_model</code>, <code>ngram</code>, <code>suffix</code>, <code>mtp</code>, <code>eagle3</code>','Turns on speculative decoding, e.g. <code>{"method": "suffix", "num_speculative_tokens": 8}</code>'],
 ['SGLang: <code>--kv-cache-dtype</code>, <code>--speculative-algorithm EAGLE|EAGLE3|NEXTN|STANDALONE|NGRAM</code>','Equivalent controls'],
 ['TensorRT-LLM: FP8 / FP8 block / NVFP4 / W4A16 AWQ / GPTQ checkpoints from Model Optimizer; FP8 KV via KvCacheConfig','Precision chosen when producing the checkpoint']
])}
${code('bash',`# FP8 checkpoint + FP8 KV cache + suffix-based speculation (illustrative command; check --help)
vllm serve <your-org>/atlas-8b-instruct-fp8 --kv-cache-dtype fp8 --speculative-config '{"method": "suffix", "num_speculative_tokens": 8}'`)}
${callout('unverified','Producing quantized checkpoints','Common tools are NVIDIA Model Optimizer (documented by TensorRT-LLM), vLLM’s LLM Compressor project, and AutoAWQ/GPTQ-style libraries. Their CLIs change often; pin versions and keep the calibration dataset with the artefact. Also check whether your vLLM version supports on-the-fly FP8 quantization of a BF16 checkpoint (historically <code>--quantization fp8</code>) — convenient, but a pre-calibrated checkpoint is easier to evaluate and reproduce.')}
${callout('devops','DevOps bridge','Treat a quantized model like a recompiled binary with -O3: same source, different artefact, needs its own test run before promotion. The quantization recipe (method, group size, calibration set, tool version) is the build config and belongs in the release record next to the model revision.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Quantized model is slower than BF16','No fast kernel for this format on this GPU (e.g. FP8 compute on A100), dequant overhead at large batch','Nsight Systems kernel names; compare at batch 1 and batch 64','Pick a format the hardware accelerates; FP8 on Hopper+, NVFP4 on Blackwell'],
 ['Quality drop only in Arabic or on long documents','Calibration set unrepresentative; KV quantization at long context','Per-slice eval results','Calibrate with mixed-language data; keep KV in BF16; less aggressive scheme'],
 ['JSON / tool calls break more often','Small logit shifts break strict formats','Validity rate on structured-output tests','Structured outputs (constrained decoding), higher precision, re-evaluate'],
 ['Speculation enabled, TPOT unchanged or worse','Low acceptance rate or high batch','Acceptance counters in engine metrics/logs; load level','Use n-gram for RAG/code, EAGLE for chat; disable at high load; fewer draft tokens'],
 ['Engine fails to load quantized checkpoint','Format unsupported by engine version or GPU','Startup error mentioning quantization method','Upgrade/pin engine; choose supported format']
])}

<h2>8. How do we scale it?</h2>
<p>Quantization scales <b>capacity</b>: the same GPUs hold more users or a bigger model (the 70B model on one H100 in INT4 versus two or four in BF16). Speculative decoding scales <b>per-user speed</b>, most at low and medium load. Combined with batching, a common pattern is: FP8 weights + FP8 KV for capacity on Hopper; speculation for latency-sensitive, low-concurrency routes (agents, coding assistants); no speculation on high-throughput batch pools.</p>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Illustrative: a route needs a 70B-class model.

BF16, TP = 4  →  4 GPUs per replica,  ≈ 60 concurrent 8k sequences (memory lesson)
FP8,  TP = 2  →  2 GPUs per replica,  ≈ 30 concurrent 8k sequences
→ similar sequences per GPU (15 vs 15) but half the GPUs per replica: finer scaling steps,
  and faster prefill on Hopper FP8 Tensor Cores. Only worth it if the evaluation passes.
`)}
<p>The economic rule: quantization is the cheapest capacity you can buy, but its cost is paid in evaluation effort and risk. Speculative decoding buys latency, not throughput, at high load; price it per route.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Would you quantize our production model to 4-bit? How would you decide?”','<p><i>Answer (≈60 s):</i> “It depends on where we are bottlenecked and what the hardware accelerates. Decode is memory-bound, so 4-bit weight-only AWQ or GPTQ cuts bytes per step and frees memory for KV cache, but it does not speed up prefill and adds dequantization work at large batch. On H100s, FP8 for weights and activations is often the better first step because the Tensor Cores run FP8 natively, so both prefill and decode benefit, and the quality loss is usually small. Either way I would define pass criteria first — our task accuracy, JSON validity and per-language slices — run the quantized model through the same eval set and serving stack as BF16, benchmark TTFT, TPOT and goodput at our real request rate, and canary it with a rollback. And I would count the real footprint, including group scales and unquantized embeddings, when re-sizing replicas.”</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“4-bit is 4× smaller and 4× faster with almost no quality loss.”</p></div><div class="good"><h4>Strong answer</h4><p>Ties the format to the bottleneck and hardware, counts overheads, and gates on task-specific evaluation.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Fewer bits per weight','fewer bytes per decode step','lower TPOT','more KV room','more users per GPU'])}
${chain(['Draft guesses','one verification pass','tokens per pass > 1','lower TPOT at low load'])}
<p>Next: ${L('v1-engines','inference engines')} package these features; ${L('v1-benchmarking','benchmarking')} proves whether they help on your traffic.</p></div>
`,
  quiz:[
    {q:'Which scheme speeds up compute-bound prefill on an H100?',options:['W4A16 AWQ','FP8 weights and activations (W8A8 FP8)','FP8 KV cache only','INT4 GPTQ'],answer:1,explain:'Only schemes whose matmuls run in low precision on Tensor Cores raise the compute roof. Weight-only schemes dequantize to BF16 for the maths.'},
    {q:'An INT4 checkpoint with group size 128 and FP16 scales uses about how many bits per quantized weight?',options:['4.0','4.125','4.5','5.0'],answer:1,explain:'4 + 16/128 = 4.125. NVFP4 is 4.5 (FP8 scale per 16 values).'},
    {q:'α = 0.8, k = 4. Expected tokens per target pass?',options:['≈ 1.8','≈ 2.8','≈ 3.4','5'],answer:2,explain:'(1 − 0.8⁵) ÷ (1 − 0.8) = 0.67232 ÷ 0.2 ≈ 3.36. 5 is the maximum (k + 1), reached only when all drafts are accepted.'},
    {q:'Why does speculative decoding help less at high batch sizes?',options:['The draft model runs out of memory','The target becomes closer to compute-bound, so verifying k+1 positions per sequence is no longer almost free','Acceptance rate drops with batch size','It changes the output distribution'],answer:1,explain:'The free-verification assumption relies on decode being memory-bound.'},
    {q:'A quantized model passes perplexity checks but tool-call JSON validity drops from 99.7 % to 97 %. What is the right reading?',options:['Noise; ship it','A real regression on a narrow but critical skill; fails the gate unless fixed','Perplexity proves quality is fine','The tokenizer is broken'],answer:1,explain:'Aggregate metrics hide narrow failures. Gate on task-specific checks such as structured-output validity.'},
    {q:'Which statement about FP8 on A100 is correct?',options:['A100 has FP8 Tensor Cores','A100 lacks FP8 Tensor Cores, so FP8 compute speed-ups are not available there','FP8 is Blackwell-only','A100 runs NVFP4'],answer:1,explain:'FP8 Tensor Cores arrived with Hopper/Ada. NVFP4 is Blackwell.'}
  ],
  flashcards:[
    {front:'Weight-only vs W8A8',back:'Weight-only (W4A16/W8A16): smaller weights, decode faster, maths in BF16. W8A8/FP8: maths in 8-bit too, speeds prefill on supporting Tensor Cores.'},
    {front:'Realistic INT4 size of an 8B model',back:'≈ 5.7 GB: 4.125 bits/weight with group scales + embeddings/lm_head kept in BF16 (≈ 2.1 GB). Naive 4 GB is a lower bound.'},
    {front:'NVFP4',back:'4-bit E2M1 values + FP8 E4M3 scale per 16 values + FP32 per-tensor scale ≈ 4.5 bits. Blackwell only.'},
    {front:'AWQ vs GPTQ',back:'AWQ: protects salient channels found from activation magnitudes via scaling. GPTQ: layer-wise rounding with second-order error compensation. Both post-training, need calibration data.'},
    {front:'Expected tokens per speculative round',back:'E = (1 − α^(k+1)) ÷ (1 − α); speed-up ≈ E ÷ (1 + k·c).'},
    {front:'Is speculative decoding lossy?',back:'No, with rejection sampling the output distribution equals the target model’s.'},
    {front:'Best proposer for RAG / code edits',back:'n-gram / prompt-lookup or suffix methods: outputs often copy spans of the prompt, giving high acceptance at near-zero cost.'}
  ]
});
registerGlossary([
  {term:'Quantization',def:'Representing weights, activations or KV entries with fewer bits plus scale factors (e.g. FP8, INT8, INT4, NVFP4) to save memory and bandwidth.',lesson:'v1-quantization-speculative',aliases:['quantisation']},
  {term:'FP8',def:'8-bit floating point (E4M3 or E5M2) accelerated by Tensor Cores on Hopper, Ada and Blackwell GPUs.',lesson:'v1-quantization-speculative'},
  {term:'NVFP4',def:'NVIDIA 4-bit floating-point format: E2M1 values with an FP8 scale per 16-value block and a per-tensor FP32 scale; accelerated on Blackwell.',lesson:'v1-quantization-speculative'},
  {term:'AWQ',def:'Activation-aware Weight Quantization: post-training 4-bit weight quantization that protects channels with large activations by rescaling.',lesson:'v1-quantization-speculative'},
  {term:'GPTQ',def:'Post-training weight quantization that rounds layer by layer and compensates errors using approximate second-order information.',lesson:'v1-quantization-speculative'},
  {term:'W8A8',def:'Quantization of both weights and activations to 8 bits (INT8 or FP8) so matrix multiplies run in low precision.',lesson:'v1-quantization-speculative'},
  {term:'Weight-only quantization',def:'Quantizing only weights (e.g. W4A16); weights are dequantized for BF16 maths, which speeds memory-bound decode but not compute-bound prefill.',lesson:'v1-quantization-speculative'},
  {term:'KV-cache quantization',def:'Storing KV entries in FP8 or lower precision to roughly halve (or better) KV memory and bandwidth per token.',lesson:'v1-quantization-speculative'},
  {term:'Speculative decoding',def:'A proposer drafts k tokens and the target model verifies them in one pass, accepting a prefix; lossless with rejection sampling.',lesson:'v1-quantization-speculative'},
  {term:'Acceptance rate',def:'Probability that a drafted token is accepted by the target model; determines expected tokens per verification pass.',lesson:'v1-quantization-speculative'},
  {term:'EAGLE',def:'Speculative-decoding method that drafts with a lightweight head over the target model’s hidden features (EAGLE, EAGLE-3).',lesson:'v1-quantization-speculative'},
  {term:'MTP',def:'Multi-token prediction: extra prediction modules trained with a model (e.g. DeepSeek-V3) that can serve as speculative drafters.',lesson:'v1-quantization-speculative',aliases:['multi-token prediction']}
]);

/* ===================================================================== 1.5.5 */
registerLesson({
  id:'v1-engines', vol:1, part:5, num:5,
  title:'Inference engines: vLLM, SGLang, TensorRT-LLM, Triton and NVIDIA Dynamo', minutes:80,
  summary:'An inference engine is the program that actually runs a language model on GPUs: it owns the scheduler, the KV cache and the kernels. vLLM, SGLang and TensorRT-LLM are engines. Triton Inference Server, now called Dynamo-Triton, is a general model server that can host engines and other models. NVIDIA Dynamo and llm-d are not engines at all: they are distributed serving layers that sit around engines and add cache-aware routing, disaggregated prefill and decode, and SLA-driven scaling. Getting these roles right is the difference between a clean architecture and a stack of overlapping components. This lesson explains each one, what it is and is not, and how to choose.',
  objectives:[
    'Explain what an inference engine owns (API, scheduler, KV manager, executor, kernels) and what it does not (auth, tenancy, fleet routing).',
    'Describe vLLM, SGLang and TensorRT-LLM, including current architecture facts (as of Oct 2026).',
    'Place Triton (Dynamo-Triton), NVIDIA Dynamo, llm-d, KServe and Ray Serve LLM correctly relative to engines.',
    'Choose a serving stack with a decision table based on model support, hardware, scale and team skills.',
    'Identify failure modes caused by version, format and role confusion between components.'
  ],
  prereqs:['v1-inference-anatomy','v1-kv-cache','v1-batching','v1-quantization-speculative'],
  next:['v1-benchmarking','v1-k8s-serving','v2-distributed-inference','v2-ai-gateway'],
  tags:['inference','vllm','sglang','tensorrt-llm','dynamo','llm-d','architecture'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Databases again: PostgreSQL is the engine (query planner, buffer pool, storage). PgBouncer and a read-replica router decide which instance a query goes to. An API gateway authenticates clients. Kubernetes runs the pods. Nobody calls PgBouncer a database. In LLM serving, vLLM/SGLang/TensorRT-LLM are the “PostgreSQL”; Dynamo and llm-d are closer to the routers and operators around them. Now the specifics.')}
<p>An <b>${term('inference engine')}</b> loads a model onto GPUs and turns requests into tokens. It owns, inside one process group: an API server (usually OpenAI-compatible), the <b>scheduler</b> (continuous batching, ${L('v1-batching','previous lesson')}), the <b>KV-cache manager</b> (${L('v1-kv-cache','PagedAttention or a radix tree')}), the <b>model executor</b> (tensor/pipeline parallel workers) and the <b>kernels</b> (attention, GEMM, quantized formats, ${L('v1-quantization-speculative','speculative decoding')}).</p>
${table(['Component','What it IS','What it is NOT'],[
 ['<b>'+term('vLLM')+'</b>','Open-source engine and OpenAI-compatible server; PagedAttention, continuous batching, prefix caching, broad model and hardware support','Not a gateway: no tenant auth, quotas or audit (<code>--api-key</code> only protects the /v1-style prefixes)'],
 ['<b>'+term('SGLang')+'</b>','Open-source engine and server; RadixAttention (KV cache in a radix tree for automatic prefix reuse), strong structured-output and multi-call program support','Not only a frontend DSL any more; not a fleet router on its own (it ships a separate router)'],
 ['<b>'+term('TensorRT-LLM')+'</b>','NVIDIA’s engine/library for NVIDIA GPUs; optimised kernels, FP8/NVFP4, <code>trtllm-serve</code> OpenAI-compatible server; PyTorch-based runtime','No longer “compile an engine first”: the TensorRT engine-build backend was removed; not for non-NVIDIA hardware'],
 ['<b>'+term('Triton Inference Server')+'</b> (now NVIDIA Dynamo-Triton)','General multi-framework model server: hosts TensorRT, ONNX, PyTorch, Python and LLM backends (TensorRT-LLM, vLLM) with dynamic batching and ensembles','Not itself an LLM engine; its classic dynamic batcher is request-level, not iteration-level'],
 ['<b>'+term('NVIDIA Dynamo')+'</b>','Distributed serving framework AROUND engines (vLLM, SGLang, TensorRT-LLM): OpenAI frontend, KV-aware router, disaggregated prefill/decode, KV block manager, NIXL transfer, SLA planner, Kubernetes operator','Not an engine, does not replace vLLM/SGLang/TRT-LLM, not a replacement for Kubernetes or a gateway'],
 ['<b>'+term('llm-d')+'</b>','Kubernetes-native distributed inference stack (CNCF Sandbox): router (proxy + endpoint picker) over InferencePools of vLLM/SGLang servers, prefix-cache-aware routing, P/D disaggregation, tiered KV offload','Not an engine; not a general API gateway; opinionated “well-lit paths” rather than a product with a UI'],
 ['<b>KServe</b> <code>LLMInferenceService</code>','Kubernetes CRD to deploy LLMs; built on llm-d (uses Gateway API Inference Extension InferencePool/EPP)','Still an alpha API (v1alpha1/v1alpha2 in KServe v0.21)'],
 ['<b>Ray Serve LLM</b>','Python serving framework (<code>ray.serve.llm</code>) that runs vLLM (or SGLang) deployments with autoscaling, multi-model and P/D builders','Not an engine itself; adds a Ray cluster to operate']
])}
${callout('warn','Correction from the earlier course','The previous edition titled Dynamo “distributed inference coordination” in a way that read as if it replaced engines. Dynamo is an orchestration/serving framework <b>around</b> engines; the engine still executes the model. It also described TensorRT-LLM as needing an engine-build step; current TensorRT-LLM loads Hugging Face checkpoints directly with a PyTorch runtime.')}

<h2>2. Why do we need it?</h2>
<p>A naive server (load a model with Transformers, call <code>generate()</code> per request) has no continuous batching, wastes KV memory, and serves one request at a time per GPU. Engines exist because the techniques of Part 5 — paged KV cache, iteration-level scheduling, chunked prefill, fused kernels, quantized formats, CUDA graphs, speculative decoding — must be integrated in one tight loop to get the order-of-magnitude throughput gains. The layers around engines exist because, beyond a few replicas, <b>which replica</b> handles a request (cache locality, load) and <b>how many of which kind</b> run (prefill vs decode) start to dominate cost and latency.</p>

<h2>3. How does it work internally?</h2>
<h3>vLLM (latest v0.31.0, 5 Oct 2026)</h3>
<ul>
<li><b>Architecture</b>: the “V1” engine is the only engine since v0.11.0 (the old V0 classes were deleted). An API server process handles HTTP and tokenisation; an engine core runs the scheduler loop; GPU workers execute the model. Parallelism via <code>-tp</code>, <code>-pp</code>, <code>-dp</code> (all default 1).</li>
<li><b>Memory</b>: PagedAttention KV blocks; <code>--gpu-memory-utilization</code> default 0.92; prefix caching on by default for supported models; chunked prefill on by default where possible; default preemption mode recompute.</li>
<li><b>API</b>: <code>/v1/chat/completions</code>, <code>/v1/completions</code>, <code>/v1/responses</code>, <code>/v1/embeddings</code>, an Anthropic-compatible <code>/v1/messages</code>, <code>/v1/models</code>, <code>/health</code>, <code>/metrics</code>, <code>/tokenize</code> and more. Docker image <code>vllm/vllm-openai</code>, port 8000.</li>
<li><b>Features</b>: LoRA adapters (<code>--enable-lora</code>), structured outputs (xgrammar/guidance backends; the old <code>guided_*</code> request parameters were removed in v0.12), speculative decoding (<code>--speculative-config</code>), KV transfer connectors for disaggregation (NIXL, LMCache, Mooncake and others via <code>--kv-transfer-config</code>).</li>
</ul>
<h3>SGLang (latest v0.5.21, 2 Oct 2026)</h3>
<ul>
<li><b>Launch</b>: <code>python -m sglang.launch_server --model-path &lt;hf-id&gt; --tp 2</code>, default port 30000. Docs now at docs.sglang.io.</li>
<li><b>RadixAttention</b> (arXiv 2312.07104): the KV cache is kept as a radix tree keyed by token sequences, so any shared prefix — system prompts, few-shot examples, multi-turn history, agent loops — is reused automatically; eviction is LRU by default (<code>--radix-eviction-policy</code>).</li>
<li><b>Scheduling</b>: <code>--schedule-policy</code> default <code>fcfs</code>; <code>lpm</code> (longest prefix match) is the cache-aware option. Memory via <code>--mem-fraction-static</code> (auto-computed by default).</li>
<li><b>Scale-out</b>: data parallel, a separate router (<code>sglang_router</code>), and P/D disaggregation with Mooncake or NIXL transfer backends.</li>
</ul>
<h3>TensorRT-LLM (stable v1.2.1, Apr 2026; 1.3 release candidates since)</h3>
<ul>
<li>Since v1.0 the <b>PyTorch-based runtime is the default</b>; the old TensorRT engine backend has been <b>removed</b> (in the 1.3 line), so <code>trtllm-build</code> and per-model checkpoint conversion are legacy. Use <code>LLM(model="...")</code> in Python or <code>trtllm-serve &lt;hf_model&gt;</code>.</li>
<li>Strengths: NVIDIA-tuned kernels, FP8 (per-tensor, block, rowwise), NVFP4 on Blackwell, FP8/NVFP4 KV cache, W4A16/W4A8 AWQ and GPTQ, checkpoints from NVIDIA Model Optimizer.</li>
<li><code>trtllm-serve</code> exposes <code>/v1/chat/completions</code>, <code>/v1/completions</code>, <code>/v1/responses</code>, <code>/health</code>, <code>/metrics</code> (iteration stats need <code>enable_iter_perf_stats</code>).</li>
</ul>
<h3>Triton Inference Server → NVIDIA Dynamo-Triton (v2.73.0 = NGC 26.09)</h3>
<p>NVIDIA now calls it “NVIDIA Dynamo-Triton, formerly NVIDIA Triton Inference Server”, and describes Dynamo as its successor for LLM serving; Triton continues for multi-framework serving. Use it when one server must host many model types (vision, embeddings, rerankers, classic ML) alongside LLM backends, or when you already run it.</p>
<h3>NVIDIA Dynamo (latest v1.5.1, 7 Oct 2026)</h3>
<ul>
<li><b>Frontend</b>: OpenAI-compatible HTTP (port 8000) — <code>python -m dynamo.frontend --http-port 8000 --router-mode kv</code>.</li>
<li><b>Workers</b>: wrap a real engine — <code>python -m dynamo.vllm --model …</code>, <code>python -m dynamo.sglang --model-path …</code>, <code>python -m dynamo.trtllm --model-path …</code>; runtime containers per engine.</li>
<li><b>KV-aware router</b>: scores each worker by how many of the prompt’s KV blocks it already holds versus its prefill and decode load, and sends the request to the lowest cost.</li>
<li><b>Disaggregated serving</b>: separate prefill and decode workers; <b>NIXL</b> moves KV between them; <b>KVBM</b> manages KV blocks across GPU, CPU and storage tiers.</li>
<li><b>Planner</b>: adjusts prefill and decode replica counts to meet TTFT and ITL targets.</li>
<li><b>Kubernetes</b>: an operator reconciles <code>DynamoGraphDeployment</code> resources. Discovery can now be Kubernetes-native; etcd and NATS are no longer strictly required.</li>
</ul>
<h3>llm-d (latest v0.10.0, 29 Sep 2026) and the Gateway API Inference Extension</h3>
<p>llm-d puts an <b>llm-d Router</b> — an L7 proxy plus an <b>endpoint picker (EPP)</b> that scores pods on live metrics, KV-cache affinity and policies — in front of an <b>InferencePool</b> (an “LLM-optimised Service”) of vLLM or SGLang pods. The Gateway API Inference Extension (GAIE, v1.6.2) standardises InferencePool (<code>inference.networking.k8s.io/v1</code>); since GAIE v1.6.0 the full-featured EPP lives in llm-d. llm-d also documents prefix-cache-aware routing, P/D disaggregation, tiered KV offload and predicted-latency routing; autoscaling uses KEDA on router metrics.</p>
${anim('v1-inf-stack')}

<h2>4. Where does it fit?</h2>
${fig('Layers and who owns them', svgDiagram({w:900,h:340,
 zones:[{x:10,y:10,w:880,h:320,label:'Platform'}],
 boxes:[
  {id:'g',x:30,y:40,w:840,h:44,label:'AI gateway: auth, tenants, quotas, model routing, audit',sub:'platform team'},
  {id:'r',x:30,y:100,w:840,h:44,label:'Inference router / distributed serving: Dynamo · llm-d · Ray Serve LLM · KServe',sub:'platform / ML infra',cls:'hl'},
  {id:'e',x:30,y:160,w:840,h:44,label:'Engine: vLLM · SGLang · TensorRT-LLM   (optionally hosted by Dynamo-Triton)',sub:'ML infra',cls:'v2'},
  {id:'k',x:30,y:220,w:840,h:44,label:'Kubernetes + GPU Operator + device plugin / DRA',sub:'platform team'},
  {id:'h',x:30,y:280,w:840,h:40,label:'GPUs, NVLink, RDMA fabric',sub:'infra / cloud'}
 ],
 arrows:[{from:'g',to:'r'},{from:'r',to:'e'},{from:'e',to:'k'},{from:'k',to:'h'}]
}), 'Each layer can be swapped independently if the interfaces (OpenAI-compatible HTTP, engine metrics, Kubernetes resources) are respected. Most incidents of “the engine is broken” are at a different layer.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Upward</b>: OpenAI-compatible APIs let the gateway and applications switch engines without code changes — but sampling defaults, tool-call parsing and structured-output parameters differ; test them.</li>
<li><b>Sideways</b>: routers consume engine metrics (queue, KV usage, prefix-cache state) and KV events; disaggregation needs KV transfer (NIXL, Mooncake, LMCache).</li>
<li><b>Downward</b>: engines need matching drivers/CUDA, NCCL for TP, and GPU topology (${L('v1-multi-gpu-profiling','multi-GPU')}); on Kubernetes, see ${L('v1-k8s-serving','model serving on Kubernetes')}.</li>
<li><b>Release process</b>: the engine version is part of the model release record, because flags, defaults and supported formats change every few weeks (${L('v2-model-cicd','model CI/CD')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<h3>Decision table</h3>
${table(['Situation','Reasonable default','Why'],[
 ['First self-hosted LLM, one model, 1–8 GPUs, mixed open models','<b>vLLM</b> behind your gateway','Broadest model support, simple ops, large community, OpenAI-compatible'],
 ['Heavy prefix reuse: agents, multi-turn chat, few-shot, structured programs','<b>SGLang</b> (or vLLM with prefix caching) — benchmark both','RadixAttention and cache-aware scheduling'],
 ['NVIDIA-only fleet, need peak FP8/NVFP4 performance on supported models','<b>TensorRT-LLM</b> (directly or under Dynamo)','NVIDIA-tuned kernels and formats; check model support list'],
 ['Many model types (vision, embeddings, rerankers) plus LLMs in one server','<b>Dynamo-Triton</b> with LLM backends','Multi-framework hosting, ensembles'],
 ['Many replicas, long shared prompts, TTFT/ITL SLOs, want disaggregation','<b>NVIDIA Dynamo</b> or <b>llm-d</b> around your engine','KV-aware routing, P/D split, SLA planner / KEDA'],
 ['Kubernetes-native, Gateway API shop, prefer CNCF components','<b>llm-d</b> (or KServe LLMInferenceService on llm-d)','InferencePool + EPP on Gateway API'],
 ['Python-centric team already running Ray','<b>Ray Serve LLM</b> with vLLM','One framework for multi-model and batch pipelines']
])}
<h3>Upgrade runbook for an engine</h3>
<ol>
<li>Read the release notes for removed flags, changed defaults and renamed metrics (vLLM ships every two to three weeks; v0.29 → v0.31 spanned less than a month).</li>
<li>Build the new image; pin it by digest. Start it in staging with the <b>same</b> flags and print the effective configuration; diff it against production’s.</li>
<li>Run the regression benchmark (fixed dataset, fixed seed, open-loop sweep) and the quality eval set on the same build. Compare goodput at the SLO and task scores with the current release.</li>
<li>Check dashboards still work: metric names (for example <code>vllm:kv_cache_usage_perc</code> replaced an older GPU-cache metric) and label sets.</li>
<li>Canary a small share of traffic; watch TTFT, ITL p99, error rate and preemptions; keep the previous image warm for rollback.</li>
</ol>
<p>Whatever you choose, you own: pinned versions (engine image digest, model revision, tokenizer), the flag set and its rationale, metrics scraping and dashboards, upgrade testing (benchmarks + evals before promotion), and the security boundary (engines are not internet-facing).</p>
${callout('devops','DevOps bridge','Choosing between vLLM and SGLang is like choosing between NGINX and Envoy: both are excellent, the right answer depends on features you need and what your team can operate, and you settle disagreements with a benchmark of your own traffic. Choosing Dynamo or llm-d is like adopting a service mesh: worth it at scale, overhead at small scale.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Same model, different answers after switching engines','Different chat template, sampling defaults (generation_config), stop tokens or tokenizer revision','Render the prompt from both; compare request parameters','Pin template and sampling explicitly in requests; regression eval'],
 ['Engine upgrade breaks startup or flags','Flag renamed/removed, default changed (e.g. guided_* params removed in vLLM v0.12; TRT engine backend removed)','Startup error; release notes','Pin versions; upgrade in staging with benchmark + eval gates'],
 ['Router added, TTFT got worse','Routing on stale metrics, or disaggregation where KV transfer costs more than it saves','Per-hop latency; KV transfer time; cache-hit rate','Measure before/after; simpler aggregated serving for short prompts'],
 ['Dynamo/llm-d deployed but no cache-hit improvement','Prompts do not actually share prefixes (dynamic content at the start), or cache salt/tenancy splits them','Prefix-cache hit metrics (<code>vllm:prefix_cache_hits</code> / queries)','Put static content first in prompts; see Volume 2 caching'],
 ['Engine exposed publicly, abused','Engine treated as a gateway','No tenant auth or quotas in access logs','Put a real gateway in front; network policy; engine API key only as defence in depth']
])}

<h2>8. How do we scale it?</h2>
<ol>
<li><b>One engine, tuned</b> (${L('v1-batching','batching knobs')}, ${L('v1-quantization-speculative','precision')}).</li>
<li><b>N identical replicas</b> behind a load balancer; scale on queue length / KV usage (${L('v1-k8s-autoscaling','autoscaling')}).</li>
<li><b>Cache-aware routing</b> (Dynamo KV router, llm-d EPP, SGLang router) when prompts share prefixes.</li>
<li><b>Disaggregated prefill/decode</b> with separate scaling when prefill/decode interference and long prompts dominate (${L('v2-distributed-inference','distributed inference')}).</li>
<li><b>Multi-node models</b> (wide expert parallel, very large models) with Dynamo/llm-d multinode support and topology-aware scheduling.</li>
</ol>

<h2>9. How do we optimize its cost?</h2>
<p>Engine choice changes tokens per GPU-hour, but often less than configuration does: precision, batch limits, prefix caching and routing usually move cost more than swapping vLLM for SGLang. Run a bake-off only with your traffic and SLOs, and include operational cost: an engine that is 10 % faster but needs a specialist to upgrade may be more expensive. Adding Dynamo or llm-d pays when cache hits or P/D splitting save more GPU time than the extra components cost to run and debug.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“What is the difference between vLLM, TensorRT-LLM, Triton and NVIDIA Dynamo?”','<p><i>Answer (≈50 s):</i> “vLLM and TensorRT-LLM are inference engines: they run the model, with their own schedulers, KV-cache management and kernels. vLLM is the broad, open, easy-to-operate default; TensorRT-LLM is NVIDIA’s optimised engine, now with a PyTorch runtime and no separate engine-build step, strongest for FP8 and FP4 on NVIDIA GPUs. Triton — now Dynamo-Triton — is a general model server that can host engines and other model types. Dynamo is a layer around engines: an OpenAI frontend, a KV-aware router, disaggregated prefill and decode with NIXL KV transfer, and a planner that scales prefill and decode workers to TTFT and ITL targets. It runs vLLM, SGLang or TensorRT-LLM underneath; it does not replace them. llm-d plays a similar role in a Kubernetes-native, Gateway API way.”</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“Dynamo is NVIDIA’s new engine that replaces vLLM and Triton.”</p></div><div class="good"><h4>Strong answer</h4><p>Separates engine, model server and distributed-serving layer, with one concrete capability each.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Gateway','router (Dynamo / llm-d)','engine (vLLM / SGLang / TRT-LLM)','kernels','GPU'])}
<p>Next: ${L('v1-benchmarking','benchmarking and capstone stage 4')} — serve Atlas with vLLM and measure it. Then ${L('v1-k8s-serving','serving on Kubernetes')}, and in Volume 2 ${L('v2-distributed-inference','disaggregated inference')} and ${L('v2-distributed-kv','distributed KV caching')}.</p></div>
`,
  quiz:[
    {q:'Which of these is NOT an inference engine?',options:['vLLM','SGLang','TensorRT-LLM','NVIDIA Dynamo'],answer:3,explain:'Dynamo wraps engines (vLLM, SGLang, TensorRT-LLM) with routing, disaggregation and planning.'},
    {q:'What changed in TensorRT-LLM’s architecture?',options:['It now requires trtllm-build for every model','The PyTorch runtime became the default (v1.0) and the TensorRT engine-build backend was removed in the 1.3 line','It dropped FP8 support','It became a Kubernetes operator'],answer:1,explain:'You load Hugging Face checkpoints directly with LLM(...) or trtllm-serve.'},
    {q:'A team wants one server for an embedding model, a reranker, a vision model and an LLM. Which fits best?',options:['vLLM alone','NVIDIA Dynamo-Triton (Triton) with appropriate backends','llm-d','A KV-aware router'],answer:1,explain:'Triton is a multi-framework model server that can host LLM backends next to other model types.'},
    {q:'What does llm-d’s endpoint picker (EPP) do?',options:['Runs attention kernels','Scores model-server pods on live metrics and KV-cache affinity to choose where a request goes','Quantizes models','Issues OAuth tokens'],answer:1,explain:'It is the routing brain behind the InferencePool, consulted by the proxy via ext-proc.'},
    {q:'Which SGLang feature most directly helps multi-turn agents with repeated context?',options:['--schedule-policy fcfs','RadixAttention prefix reuse','--tp 2','NVFP4'],answer:1,explain:'The radix tree stores KV by token sequence so shared prefixes are reused automatically; lpm scheduling can exploit it further.'}
  ],
  flashcards:[
    {front:'Engine responsibilities',back:'API server, scheduler (continuous batching), KV-cache manager, model executor (TP/PP), kernels, sampling.'},
    {front:'vLLM key facts (Oct 2026)',back:'v0.31.0; V1 engine only (V0 removed in 0.11); gpu-memory-utilization default 0.92; prefix caching and chunked prefill on by default; port 8000; OpenAI + /v1/messages + /v1/responses.'},
    {front:'SGLang key facts',back:'v0.5.21; launch_server --model-path, port 30000; RadixAttention; schedule-policy default fcfs (lpm optional); router + P/D via Mooncake/NIXL.'},
    {front:'TensorRT-LLM now',back:'PyTorch runtime default since 1.0; TensorRT engine backend removed (1.3 line); trtllm-serve <hf_model>; FP8/NVFP4/AWQ/GPTQ via Model Optimizer.'},
    {front:'Dynamo in one line',back:'Distributed serving framework around engines: OpenAI frontend, KV-aware router, P/D disaggregation (NIXL), KVBM, SLA planner, K8s operator (DynamoGraphDeployment). v1.5.1.'},
    {front:'llm-d in one line',back:'CNCF Sandbox, K8s-native: router (proxy + EPP) over InferencePools of vLLM/SGLang; prefix-aware routing, P/D, tiered KV; KEDA autoscaling. v0.10.0.'},
    {front:'Triton today',back:'Renamed NVIDIA Dynamo-Triton; multi-framework model server (v2.73.0 = NGC 26.09) hosting TensorRT-LLM/vLLM backends among others.'}
  ]
});
registerGlossary([
  {term:'Inference engine',def:'Software that executes a model for serving: API, scheduler, KV-cache manager, executor and kernels (e.g. vLLM, SGLang, TensorRT-LLM).',lesson:'v1-engines'},
  {term:'vLLM',def:'Open-source LLM inference engine and OpenAI-compatible server built around PagedAttention and continuous batching.',lesson:'v1-engines'},
  {term:'SGLang',def:'Open-source LLM serving engine with RadixAttention (radix-tree KV reuse), structured generation and a separate router.',lesson:'v1-engines'},
  {term:'TensorRT-LLM',def:'NVIDIA’s LLM inference library/engine with optimised kernels and FP8/NVFP4 support, now with a PyTorch-based runtime and trtllm-serve.',lesson:'v1-engines',aliases:['TRT-LLM']},
  {term:'Triton Inference Server',def:'NVIDIA’s multi-framework model server, now named NVIDIA Dynamo-Triton; hosts backends such as TensorRT-LLM and vLLM alongside other model types.',lesson:'v1-engines',aliases:['Dynamo-Triton','Triton']},
  {term:'NVIDIA Dynamo',def:'Distributed inference serving framework around engines (vLLM, SGLang, TensorRT-LLM): frontend, KV-aware router, disaggregated prefill/decode with NIXL, KVBM and an SLA planner.',lesson:'v1-engines',aliases:['Dynamo']},
  {term:'llm-d',def:'Kubernetes-native distributed inference stack (CNCF Sandbox) with a router (proxy + endpoint picker) over InferencePools of vLLM/SGLang servers.',lesson:'v1-engines'},
  {term:'InferencePool',def:'Gateway API Inference Extension resource (inference.networking.k8s.io/v1) grouping model-server pods behind an endpoint picker.',lesson:'v1-engines'},
  {term:'Endpoint picker',def:'Service consulted by the gateway proxy (via ext-proc) that chooses a model-server pod using load and KV-cache state (GAIE / llm-d).',lesson:'v1-engines',aliases:['EPP']}
]);

/* ===================================================================== 1.5.6 */
registerLesson({
  id:'v1-benchmarking', vol:1, part:5, num:6,
  title:'Benchmarking inference correctly (capstone stage 4: serve with vLLM)', minutes:95,
  summary:'A benchmark is only useful if it answers a real question with a realistic workload. For inference that means realistic input and output lengths, an arrival process that behaves like users, a warm-up that is excluded, enough requests to trust the tail percentiles, and a result expressed as goodput: how many requests per second still meet the latency targets. Open-loop tests, where requests arrive on a schedule, reveal what happens past capacity; closed-loop tests with a fixed number of clients hide it. The lesson ends with stage four of the Atlas capstone: serving the fine-tuned model with vLLM behind an OpenAI-compatible API, including the LoRA adapter, and benchmarking it properly.',
  objectives:[
    'Design an inference benchmark: question, SLO, workload model, arrival process, warm-up, duration, metrics and environment record.',
    'Explain open-loop vs closed-loop load generation and coordinated omission.',
    'Compute and interpret percentiles and goodput at an SLO, and find the maximum sustainable load from a rate sweep.',
    'Run vllm bench serve with the right flags and read its output.',
    'Serve the Atlas model (base + LoRA adapter) with vLLM, call it through the OpenAI-compatible API, and benchmark it (capstone stage 4).'
  ],
  prereqs:['v1-inference-anatomy','v1-batching','v1-engines','v1-capstone-train'],
  next:['v1-k8s-serving','v1-k8s-autoscaling','v2-capacity-planning','v2-finops-unit-economics'],
  tags:['inference','benchmarking','slo','capstone','vllm','lora'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A load test of a web API, which you already know — with two twists. Each “request” has a size that varies by orders of magnitude (prompt and answer lengths), and the server’s capacity depends on that size mix. A benchmark with the wrong size mix is like load-testing a checkout API with only health-check calls. Now the real method.')}
<p><b>Inference benchmarking</b> measures latency (TTFT, TPOT, ITL, E2E — defined in ${L('v1-inference-anatomy','inference anatomy')}), throughput (requests/s, output tokens/s, total tokens/s) and ${term('goodput')} for one serving configuration under one workload, in a way someone else can reproduce. Its output is a decision: which configuration, how many replicas, what limits.</p>

<h2>2. Why do we need it?</h2>
<p>Published numbers are for someone else’s model, prompt lengths, GPU, engine version and SLO. Small changes — prompt length distribution, prefix sharing, output caps, request rate — move results by multiples. Engine defaults change every few weeks (${L('v1-engines','engines')}). The only number you can plan capacity and cost with is the one you measured on your workload. Every later capacity and cost calculation (${L('v2-capacity-planning','capacity planning')}, ${L('v2-finops-unit-economics','unit economics')}) takes “measured tokens/s per replica at the SLO” as an input.</p>

<h2>3. How does it work internally?</h2>
<h3>Step 1 — state the question and the SLO</h3>
<p>Example: “What is the maximum request rate one H100 running Atlas-8B in FP8 can serve with p95 TTFT ≤ 500 ms and p99 ITL ≤ 50 ms, for our support-chat traffic?” Without an SLO you cannot compute goodput, and without a question you cannot stop.</p>
<h3>Step 2 — model the workload</h3>
<ul>
<li><b>Token distributions</b>: histogram of input and output tokens from gateway logs (counts only, no content). Chat might be 300–2,000 input and 50–400 output; RAG 3,000–8,000 input; summarisation long in, short out. Benchmark each class separately and mixed.</li>
<li><b>Prefix structure</b>: how much of each prompt is a shared system prompt or document? Prefix caching makes shared prefixes nearly free; purely random prompts understate that, copied identical prompts overstate it.</li>
<li><b>Output length control</b>: synthetic tests often force the exact output length (ignore the end-of-sequence token) so runs are comparable. Real outputs end early; know which you measured.</li>
<li><b>Arrival process</b>: Poisson arrivals at rate λ are a reasonable baseline; real traffic is burstier (Ramadan evenings, flight-disruption spikes). Test bursts too.</li>
</ul>
<h3>Step 3 — choose the load model: open or closed loop</h3>
${table(['','Open loop (request-rate)','Closed loop (fixed concurrency)'],[
 ['How it sends','Requests arrive on a schedule regardless of responses','N clients; each sends the next request after the previous completes'],
 ['Models','Real users arriving independently','A batch job or a fixed worker pool'],
 ['Past capacity','Queue grows, latency explodes — visible','Clients slow down with the server; latency looks bounded'],
 ['Answers','“What load can we sustain at the SLO?”','“How fast is it at concurrency N?”'],
 ['Pitfall','Needs a long enough run to see queue growth','<b>Coordinated omission</b>: the slow periods suppress the requests that would have measured them']
])}
${anim('v1-inf-bench-knee')}
<h3>Step 4 — warm-up, duration, sample size</h3>
<ul>
<li><b>Warm-up</b>: exclude the first requests after start (lazy initialisation, autotuning, cold prefix cache). Decide whether you want a warm or cold prefix cache and state it.</li>
<li><b>Duration</b>: long enough for the queue to reach steady state at each rate — minutes, not seconds.</li>
<li><b>Sample size</b>: a percentile is only as good as the samples behind it.</li>
</ul>
${formula(`
samples beyond the p-th percentile  =  N × (1 − p)

N = 200   → p99 rests on 2 requests       ← noise
N = 1,000 → p99 rests on 10 requests      ← vllm bench serve default --num-prompts 1000
N = 5,000 → p99 rests on 50 requests      ← stable enough to compare configurations
ITL percentiles use every token gap, so they have far more samples than TTFT.
`)}
<h3>Step 5 — compute goodput and find the knee</h3>
${formula(`
                 requests that met ALL SLOs
goodput  =  ──────────────────────────────────          (DistServe, arXiv 2401.09670)
                     measurement duration

STEP 1  run: 1,000 requests at λ = 4 req/s, duration ≈ 250 s → throughput = 4.0 req/s
STEP 2  870 requests met TTFT ≤ 500 ms AND TPOT ≤ 50 ms
STEP 3  goodput = 870 ÷ 250 = 3.48 req/s     SLO attainment = 87 %
STEP 4  sweep λ = 1, 2, 4, 6, 8 … ; the operating point is the highest λ with
        attainment ≥ target (e.g. 99 % meet p99-style SLO), minus headroom for bursts

ANSWER  "Max throughput" is the wrong headline. "Max load at SLO" is the planning number.
`)}
<h3>Step 6 — turn it into money (illustrative)</h3>
${formula(`
Assume you MEASURED 2,400 output tokens/s per H100 replica at the SLO (illustrative input).
Price: p5.48xlarge on-demand, us-east-1 = $55.04/h for 8 × H100 (AWS feed, 12 Oct 2026)
       → $6.88 per GPU-hour

tokens per GPU-hour = 2,400 × 3,600 = 8,640,000
cost per 1M output tokens = 6.88 ÷ 8.64 ≈ $0.80   (GPU only, 100 % busy at the SLO)

At 40 % average utilisation over a day the same fleet costs ≈ $0.80 ÷ 0.40 ≈ $2.00 per 1M.
Idle capacity, input-token (prefill) cost, storage, networking and people are extra.
`)}
<h3>Step 7 — record the environment</h3>
<p>Engine version and image digest, all flags (print the effective config), model and tokenizer revision, precision, GPU type and count, driver/CUDA, power limit, client location and network path, dataset and its seed, warm/cold cache, date. A result without these cannot be reproduced or compared.</p>

<h3>The tool: <code>vllm bench serve</code></h3>
<p>vLLM ships a serving benchmark client. Documented options (as of v0.31): <code>--backend</code> (default <code>openai</code>), <code>--dataset-name</code> (default <code>random</code>), <code>--num-prompts</code> (default 1000), <code>--request-rate</code> (default <code>inf</code> = send everything at once), <code>--max-concurrency</code>, <code>--random-input-len</code> (1024), <code>--random-output-len</code> (128), <code>--percentile-metrics</code> (default <code>ttft,tpot,itl</code>; add <code>e2el</code>), <code>--metric-percentiles</code> (default 99), and <code>--goodput</code> with SLOs in milliseconds.</p>
${code('bash',`# open-loop sweep against a running server (one rate per run)
for RATE in 1 2 4 6 8; do
  vllm bench serve --model Qwen/Qwen3-1.7B --dataset-name random --random-input-len 1024 --random-output-len 256 --num-prompts 1000 --request-rate $RATE --percentile-metrics ttft,tpot,itl,e2el --metric-percentiles 50,90,99 --goodput ttft:500 tpot:50
done`)}
${callout('warn','Defaults that mislead','<code>--request-rate inf</code> fires all prompts at once: a throughput-saturation test, not a latency test. <code>--max-concurrency</code> turns an open-loop test partly closed-loop. The random dataset has no realistic prefix sharing. Use your own token-length distribution (a custom dataset) for decisions.')}
${callout('unverified','Connection and naming flags','How the client finds the server (host/port or a base URL) and how to pass a served-model name different from the tokenizer’s name vary by version. Check <code>vllm bench serve --help</code> on your pinned version.')}

<h2>4. Where does it fit?</h2>
${fig('Benchmarking in the delivery loop', svgDiagram({w:900,h:300,
 boxes:[
  {id:'logs',x:20,y:30,w:180,h:56,label:'Gateway logs',sub:'token-length histograms'},
  {id:'wl',x:20,y:150,w:180,h:56,label:'Workload model',sub:'distributions, arrivals'},
  {id:'cfg',x:250,y:90,w:180,h:56,label:'Candidate config',sub:'engine, flags, precision'},
  {id:'bench',x:480,y:90,w:180,h:56,label:'Benchmark run',sub:'rate sweep, warm-up',cls:'hl'},
  {id:'eval',x:480,y:210,w:180,h:56,label:'Quality eval',sub:'same model build'},
  {id:'dec',x:710,y:90,w:170,h:56,label:'Decision',sub:'max load at SLO',cls:'ok'},
  {id:'cap',x:710,y:210,w:170,h:56,label:'Capacity & cost',sub:'replicas, $/1M tok'}
 ],
 arrows:[{from:'logs',to:'wl'},{from:'wl',to:'bench'},{from:'cfg',to:'bench'},{from:'bench',to:'dec'},{from:'eval',to:'dec'},{from:'dec',to:'cap'}]
}), 'A performance result never ships alone: it is paired with a quality evaluation of the same build, then feeds capacity and cost planning.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Gateway</b> supplies the real token distributions and later enforces the limits you benchmarked (${L('v2-ai-gateway','AI gateway')}).</li>
<li><b>CI/CD</b>: a short benchmark and an eval run gate every engine or model upgrade (${L('v2-model-cicd','model CI/CD')}).</li>
<li><b>Autoscaling</b>: the queue length and KV usage at the knee become scale-out thresholds (${L('v1-k8s-autoscaling','autoscaling')}).</li>
<li><b>Observability</b>: production histograms should match benchmark predictions; divergence means the workload model is wrong (${L('v2-ai-observability','observability')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${checklist([
 {key:'v1b-q',text:'Written question and SLO (TTFT, ITL/TPOT percentiles) before any run'},
 {key:'v1b-wl',text:'Workload from real token histograms; prefix-sharing ratio stated; bursts tested'},
 {key:'v1b-ol',text:'Open-loop rate sweep for capacity; closed-loop only for fixed-concurrency questions'},
 {key:'v1b-warm',text:'Warm-up excluded; cache state (warm/cold) recorded'},
 {key:'v1b-n',text:'Enough requests for the percentiles you report (≥ 1,000; more for p99 comparisons)'},
 {key:'v1b-env',text:'Environment record: versions, digests, flags, GPU, driver, power limit, client location'},
 {key:'v1b-good',text:'Goodput at SLO and the knee reported, not just peak tokens/s'},
 {key:'v1b-qual',text:'Quality eval of the same build attached to the result'}
])}
${callout('devops','DevOps bridge','This is k6/Gatling discipline with token-shaped requests. The same rules apply: test from inside the same network as production clients, do not run the load generator on the GPU node, watch the client’s own CPU (a saturated client produces fake latency), and keep results in version control next to the config that produced them.')}

<h2>7. What happens when it fails?</h2>
${table(['Benchmark smell','What went wrong','Fix'],[
 ['Huge throughput, terrible latency','<code>--request-rate inf</code> or very high concurrency: you measured saturation','Rate sweep with Poisson arrivals'],
 ['Latency flat at every load','Closed-loop clients self-throttle (coordinated omission)','Open-loop test; compare offered vs achieved rate'],
 ['Results far better than production','Prompts too short, outputs too short, identical prompts hitting prefix cache','Use production token histograms; vary prefixes realistically'],
 ['Results vary run to run','Too few samples, no warm-up, noisy neighbours, thermal throttling','More requests, warm-up, dedicated node, record clocks/power'],
 ['TPOT good, users still complain','Measured TPOT (mean), not ITL tail; or proxy buffering','Report p99 ITL; measure at the client through the real gateway'],
 ['New engine version “faster” but quality dropped','Benchmark without eval; defaults changed (sampling, template)','Pair every benchmark with an eval run; pin request parameters']
])}

<h2>8. How do we scale it?</h2>
<p>From one replica’s operating point, scale linearly as a first approximation: replicas = peak load at SLO ÷ per-replica load at SLO, plus headroom and N+1 for failures. Then verify with a multi-replica test through the real router, because routing quality (cache hits, load balance) changes per-replica results. Size with <b>both</b> prefill and decode load and with KV limits — not just output tokens/s (${L('v2-capacity-planning','capacity planning')}).</p>

<h2>9. How do we optimize its cost?</h2>
<p>Benchmarks make cost optimisation testable: each candidate change (FP8, larger batch, speculative decoding, different engine, prefix caching) gets a goodput-at-SLO number and an eval result, and the cost per million tokens follows from the formula above. Keep a small regression benchmark in CI so cost regressions from upgrades are caught before they reach the bill.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How would you benchmark an LLM serving stack fairly?”','<p><i>Answer (≈60 s):</i> “I start from a question and an SLO, say p95 TTFT under 500 ms and p99 inter-token latency under 50 ms. I build the workload from real input and output token histograms and our prefix-sharing pattern. I run open-loop tests with Poisson arrivals at increasing request rates, because closed-loop clients slow down with the server and hide overload. I warm up first, use at least a thousand requests per point, and report p50, p90 and p99 for TTFT, TPOT and ITL, plus goodput — requests per second that met every SLO. The operating point is the highest rate that still meets the SLO, not the peak throughput. I record versions, flags, GPU and driver, and I pair every result with a quality eval of the same build. [In my lab I did this with vllm bench serve against a small model on one GPU.]”</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“Run a script with 32 concurrent users and report tokens per second.”</p></div><div class="good"><h4>Strong answer</h4><p>SLO first, real token distributions, open-loop sweep, warm-up, percentiles, goodput, environment record, quality pairing.</p></div></div>

<h2>Capstone stage 4 — serve Atlas with vLLM</h2>
<h3>What changes in the architecture</h3>
<p>In ${L('v1-capstone-train','stages 1–3')} you trained a tiny model, picked a small open-weight instruct model, and produced a <b>LoRA adapter</b> fine-tuned on synthetic travel-support tickets. Stage 4 turns that artefact into a <b>service</b>: an inference engine on a GPU, exposing an OpenAI-compatible API, with a measured operating point. Nothing about the model changes; what is new is the serving layer, its configuration and its evidence.</p>
${fig('Atlas after stage 4', svgDiagram({w:900,h:280,
 zones:[{x:250,y:20,w:630,h:240,label:'One GPU machine (lab)'}],
 boxes:[
  {id:'cli',x:20,y:110,w:200,h:60,label:'Client / bench',sub:'OpenAI SDK, vllm bench'},
  {id:'api',x:280,y:110,w:180,h:60,label:'vLLM API server',sub:':8000 /v1/chat/completions',cls:'hl'},
  {id:'base',x:520,y:50,w:170,h:56,label:'Base model',sub:'small instruct, BF16'},
  {id:'lora',x:520,y:170,w:170,h:56,label:'LoRA adapter',sub:'atlas-support',cls:'v2'},
  {id:'gpu',x:730,y:110,w:130,h:60,label:'GPU',sub:'KV cache, kernels',cls:'v2'}
 ],
 arrows:[{from:'cli',to:'api'},{from:'api',to:'base'},{from:'api',to:'lora'},{from:'base',to:'gpu'},{from:'lora',to:'gpu'}]
}), 'Requests naming model “atlas-support” run the base weights plus the adapter; requests naming the base model run without it. Stage 5 moves this onto Kubernetes.')}
<h3>Option A — serve base + adapter (multi-LoRA)</h3>
${code('bash',`# labs/05-serving/serve_vllm.sh (planned) — illustrative, check flags with: vllm serve --help
vllm serve Qwen/Qwen3-1.7B --port 8000 --max-model-len 8192 --enable-lora --lora-modules atlas-support=./artifacts/atlas-support-lora --max-lora-rank 16 --max-loras 4

curl -s http://localhost:8000/v1/models        # lists the base model and "atlas-support"`)}
<p>One base model in GPU memory can serve several adapters (for example one per business unit or language) — the adapters are small, and requests choose by <code>model</code> name. <code>--max-loras</code> (default 1) is how many adapters can be active in one batch; <code>--max-lora-rank</code> must be at least your adapter’s rank. Adapter compute adds some overhead per token; measure it.</p>
<h3>Option B — merge the adapter</h3>
<p>Merge LoRA weights into the base (the planned <code>labs/03-finetune/lora_sft.py</code> has a <code>merge</code> region) and serve the merged directory as an ordinary model. Simpler and slightly faster per token; loses the ability to share one base across adapters. Either way, record base revision + adapter revision + tokenizer + chat template as one release (${L('v2-model-cicd','model CI/CD')}).</p>
<h3>Call it like any OpenAI-compatible API</h3>
${code('python',`import time
from openai import OpenAI

client = OpenAI(base_url='http://localhost:8000/v1', api_key='local-lab')   # gateway adds real auth later
t0, first, chunks = time.perf_counter(), None, 0
stream = client.chat.completions.create(
    model='atlas-support', stream=True, max_tokens=200, temperature=0.2,
    messages=[{'role': 'system', 'content': 'You are Atlas, a travel-support assistant.'},
              {'role': 'user', 'content': 'My flight from Jeddah to Riyadh was cancelled. What are my options?'}])
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        chunks += 1
        first = first or time.perf_counter()
end = time.perf_counter()
print('TTFT ms', round((first - t0) * 1e3), ' TPOT ms', round((end - first) / max(chunks - 1, 1) * 1e3))`)}
<p>Streamed chunks usually carry one token each but not always; for exact token timing use the engine’s histograms or the planned <code>labs/05-serving/bench_client.py</code>, which also computes ITL percentiles and goodput. No GPU? Point the same client at <code>labs/05-serving/mock_openai_server.py</code> to practise the method.</p>
<h3>Benchmark it and write down the result</h3>
${table(['Field','Your value'],[
 ['Model / adapter / tokenizer revisions','…'],['Engine version + image digest + flags','…'],['GPU, driver, power limit','…'],
 ['Workload (input/output histograms, prefix sharing)','…'],['SLO','e.g. p95 TTFT ≤ 500 ms, p99 ITL ≤ 50 ms'],
 ['Rate sweep: λ → p95 TTFT, p99 ITL, goodput','…'],['Max load at SLO (req/s, output tok/s)','…'],['Quality eval (same build)','…']
])}
${callout('note','What is lab-validated and what is not','Validated in your lab: the serving commands, the API contract, the measurement method and one GPU’s operating point for a small model on synthetic tickets. <b>Not</b> validated: behaviour under real traffic mixes, multi-replica routing, autoscaling, failure recovery, security controls and cost at scale. Say exactly that in an interview. Stage 5 (' + L('v1-k8s-production','Kubernetes production readiness') + ') deploys this to a GPU node pool with Helm, probes and autoscaling.')}

<div class="connections"><h4>How this connects</h4>
${chain(['Token histograms','workload model','open-loop sweep','goodput at SLO','replicas','cost per 1M tokens'])}
${chain(['LoRA adapter (stage 3)','vLLM multi-LoRA (stage 4)','Kubernetes deployment (stage 5)'])}
<p>Next: Part 6 — ${L('v1-k8s-gpu-stack','the Kubernetes GPU stack')} and ${L('v1-k8s-serving','model serving on Kubernetes')}.</p></div>
`,
  quiz:[
    {q:'Why can a closed-loop benchmark understate latency under overload?',options:['It uses fewer GPUs','Clients wait for responses before sending more, so the offered load drops when the server slows (coordinated omission)','It ignores TTFT','It disables batching'],answer:1,explain:'Open-loop arrivals keep coming like real users, exposing queue growth.'},
    {q:'1,200 requests over 300 s; 1,020 met all SLOs. Goodput?',options:['4.0 req/s','3.4 req/s','85 req/s','1,020 req/s'],answer:1,explain:'1,020 ÷ 300 = 3.4 req/s. Throughput was 4.0 req/s; attainment 85 %.'},
    {q:'What does vllm bench serve do with the default --request-rate inf?',options:['Poisson arrivals at 1 req/s','Sends all prompts immediately — a saturation test','Closed loop with 1 client','Nothing until a rate is given'],answer:1,explain:'Set a finite rate for latency questions and sweep it.'},
    {q:'With 500 requests, how many requests define the p99 TTFT tail?',options:['≈ 1','≈ 5','≈ 50','≈ 99'],answer:1,explain:'500 × 0.01 = 5. Too few to compare configurations reliably.'},
    {q:'Which is the right planning number for one replica?',options:['Peak output tokens/s at --request-rate inf','Maximum request rate at which the SLO is still met (goodput knee), minus headroom','Average latency at low load','GPU utilisation %'],answer:1,explain:'Capacity is defined by the SLO, not by saturation throughput.'},
    {q:'You serve base + LoRA with vLLM. How does a client select the fine-tuned behaviour?',options:['A header X-LoRA','By setting model to the adapter name registered with --lora-modules (e.g. atlas-support)','A different port','It is automatic'],answer:1,explain:'Adapters are exposed as model names on the OpenAI-compatible API.'}
  ],
  flashcards:[
    {front:'Open vs closed loop',back:'Open: arrivals on a schedule (real users), reveals overload. Closed: fixed N clients, self-throttles, answers “speed at concurrency N”.'},
    {front:'Goodput',back:'Requests per second that met all SLOs. Plan with max load at SLO, not peak throughput.'},
    {front:'Samples behind a percentile',back:'N × (1 − p). 1,000 requests → 10 define p99.'},
    {front:'vllm bench serve key flags',back:'--dataset-name, --random-input-len/--random-output-len, --num-prompts, --request-rate, --max-concurrency, --percentile-metrics ttft,tpot,itl,e2el, --metric-percentiles, --goodput ttft:ms tpot:ms.'},
    {front:'Benchmark record',back:'Engine version/digest/flags, model+tokenizer revisions, precision, GPU/driver/power, workload & seed, cache state, client location, date.'},
    {front:'Multi-LoRA serving in vLLM',back:'--enable-lora --lora-modules name=path; clients select via model=name; --max-loras (default 1) active per batch; --max-lora-rank ≥ adapter rank.'},
    {front:'Cost per 1M output tokens',back:'GPU $/h ÷ (measured tok/s at SLO × 3,600 ÷ 10⁶); divide by average utilisation for fleet reality.'}
  ]
});
registerGlossary([
  {term:'Goodput',def:'Requests (or tokens) per second that meet all latency SLOs; the planning metric for serving capacity (DistServe).',lesson:'v1-benchmarking'},
  {term:'Open-loop load test',def:'Load generation where requests arrive on a schedule (e.g. Poisson) independent of responses, exposing queueing past capacity.',lesson:'v1-benchmarking',aliases:['open loop']},
  {term:'Closed-loop load test',def:'Load generation with a fixed number of clients that each wait for a response before sending again; self-throttles under overload.',lesson:'v1-benchmarking',aliases:['closed loop']},
  {term:'Coordinated omission',def:'Measurement bias where a slowed system also slows the load generator, so the worst latencies are never sampled.',lesson:'v1-benchmarking'},
  {term:'SLO attainment',def:'Fraction of requests meeting the latency targets during a benchmark or in production.',lesson:'v1-benchmarking'},
  {term:'Multi-LoRA serving',def:'Serving several LoRA adapters over one shared base model in GPU memory, selected per request by model name.',lesson:'v1-benchmarking'}
]);
