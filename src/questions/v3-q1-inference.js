/* Vol 3, Part 2, Chapter 4 — Questions: inference engines and serving */
registerLesson({
  id:'v3-ch-inference', vol:3, part:2, num:4,
  title:'Questions: inference engines and serving', minutes:130,
  summary:'This chapter is the interview question bank for serving language models: how engines like vLLM batch requests, why prefill and decode behave differently, how to build a latency budget, how vLLM, TensorRT-LLM, SGLang and NVIDIA Dynamo relate, and how to troubleshoot throughput and time-to-first-token problems. It also covers speculative decoding, KV-cache capacity maths, disaggregated serving, fair benchmarking, parallelism choices and serving many fine-tuned adapters. Every answer is anchored in engine metrics and real model shapes.',
  objectives:[
    'Explain continuous batching, chunked prefill, KV admission and preemption as one scheduler loop.',
    'Build a TTFT and TPOT latency budget and a KV-capacity estimate from first principles.',
    'Position vLLM, SGLang, TensorRT-LLM and Dynamo correctly: engines versus orchestration.',
    'Troubleshoot degraded throughput and slow TTFT from metrics, in a fixed order.',
    'Decide when speculative decoding, disaggregated prefill/decode, tensor parallelism or multi-LoRA serving pays off.'
  ],
  prereqs:['v1-inference-anatomy','v1-kv-cache','v1-batching','v1-engines','v1-benchmarking'],
  next:['v3-ch-caching','v3-ch-k8s','v3-ch-hyperscale','v3-debugging'],
  tags:['interview','inference','vllm','serving','latency'],
  html:`
<h2>What interviewers test in this area</h2>
<p>Serving is where AI meets classic platform engineering, so this is often the longest part of an AI infrastructure interview. Interviewers test whether you see an inference engine as what it really is: a <b>scheduler</b> deciding, many times per second, which sequences get to run a forward pass, constrained by GPU memory for the KV cache and by a token budget per step. Candidates who say "we scale vLLM by adding GPUs" sound junior. Candidates who say "first I find whether the bottleneck is prefill compute, decode bandwidth, KV capacity or queueing, against TTFT and TPOT SLOs" sound senior.</p>
<p>Expect mechanism questions (batching, speculative decoding), quantitative questions (latency budget, KV capacity, speed-up), comparison questions (vLLM vs TensorRT-LLM vs Dynamo) and incident questions (throughput dropped, TTFT spiked). Every answer improves when you name the metric you would look at.</p>

<h2>The mental model: one scheduler loop</h2>
${fig('Every engine step: admit, batch, run, sample, free', svgDiagram({w:900,h:260,
  boxes:[
    {id:'q',x:20,y:100,w:130,h:60,label:'Waiting queue',sub:'num_requests_waiting',cls:'warn'},
    {id:'s',x:190,y:100,w:160,h:60,label:'Scheduler',sub:'token budget, KV blocks',cls:'hl'},
    {id:'b',x:390,y:100,w:160,h:60,label:'Batch',sub:'decodes + prefill chunks',cls:'v2'},
    {id:'g',x:590,y:100,w:130,h:60,label:'GPU forward',sub:'one step',cls:'v1'},
    {id:'o',x:760,y:100,w:120,h:60,label:'Sample',sub:'stream tokens',cls:'ok'},
    {id:'kv',x:390,y:200,w:160,h:50,label:'KV block pool',sub:'kv_cache_usage_perc',cls:'warn'}
  ],
  arrows:[{from:'q',to:'s'},{from:'s',to:'b'},{from:'b',to:'g'},{from:'g',to:'o'},{from:'s',to:'kv',both:true},{from:'o',to:'s',cls:'dash',label:'finished → free blocks',fromSide:'top',toSide:'top'}]
}), 'Most serving behaviour, good and bad, is explained by this loop.')}

<h2>Say it like a senior engineer</h2>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"vLLM batches requests to improve throughput."</p></div><div class="good"><h4>Strong answer</h4><p>"vLLM schedules at iteration level: each step it fills a token budget with one token per running decode plus chunks of waiting prefills, admits new requests only if KV blocks are free, and frees blocks the moment a sequence ends."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Latency is 5 seconds."</p></div><div class="good"><h4>Strong answer</h4><p>"TTFT p95 is 1.2 s, dominated by queue time, and TPOT p95 is 22 ms; for a 400-token answer that is about 10 s end to end, so the SLO is broken by decode speed, not by prefill."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Dynamo is faster than vLLM."</p></div><div class="good"><h4>Strong answer</h4><p>"They are different layers. vLLM, SGLang and TensorRT-LLM are engines; Dynamo is an orchestration framework around them that adds KV-aware routing, disaggregated prefill/decode and planning."</p></div></div>

<h2>Must-know numbers (with derivations)</h2>
${formula(`
E2E latency ≈ TTFT + (output_tokens − 1) × TPOT
  TTFT 0.8 s, TPOT 20 ms, 400 tokens → 0.8 + 399 × 0.020 ≈ 8.8 s

KV capacity, Llama-3.1-8B on one H100 (vLLM 0.92, 4 GB reserve illustrative)
  (73.6 − 16.1 − 4) GB / 131,072 B ≈ 408,000 tokens ≈ 49 sequences at 8k

Speculative decoding, acceptance α, k drafted tokens, draft cost ratio c
                1 − α^(k+1)                         E
  E[tokens] = ─────────────     speed-up ≈ ─────────────
                  1 − α                       k·c + 1
  α = 0.8, k = 4, c = 0.05 → E ≈ 3.36, speed-up ≈ 2.8× (ideal)

Decode lower bound, 8B BF16, H100: 16.1 GB / 3.35 TB/s ≈ 4.8 ms/token
`)}

<h2>Question map</h2>
<p>Twelve questions in four groups. <b>Mechanisms</b>: continuous batching in vLLM (Q1), prefill versus decode (Q2), speculative decoding (Q6). <b>Numbers</b>: the latency budget (Q3), KV capacity and concurrency (Q7). <b>Choices</b>: engines versus orchestration (Q4), disaggregated prefill/decode (Q8), tensor parallelism versus replicas (Q11), multi-LoRA serving (Q12). <b>Operations</b>: degraded throughput (Q5), fair benchmarking (Q9), slow TTFT (Q10). The operations questions are where your SRE background shows best: answer them as an incident commander would, symptom first, then evidence, then the smallest safe change.</p>
<p>A habit worth building: every time you name a problem, name the metric that proves it. "KV exhaustion" becomes "kv_cache_usage_perc near 1.0 with num_requests_waiting rising"; "slow prefill" becomes "request_prefill_time_seconds p95 up while queue time is flat". Interviewers remember candidates who speak in observable evidence.</p>
<h2>How to use this chapter</h2>
<p>Say each short answer aloud, then work the follow-ups. Background: ${L('v1-inference-anatomy','anatomy of inference')}, ${L('v1-batching','continuous batching')}, ${L('v1-engines','inference engines')} and ${L('v1-benchmarking','benchmarking')}. The labs <code>labs/05-serving/mock_openai_server.py</code> and <code>labs/05-serving/bench_client.py</code> let you measure TTFT and TPOT without a GPU, so you can say "[In my lab I measured…]" honestly.</p>
`,
  quiz:[
    {q:'In vLLM V1, a 12,000-token prompt arrives while 50 sequences are decoding. What happens by default?',options:['All decodes pause until the prefill finishes','The prompt is processed in chunks within each step\'s token budget, interleaved with decode tokens','The request is rejected','It is sent to the CPU'],answer:1,explain:'Chunked prefill is enabled by default in V1 whenever possible; the scheduler gives running decodes their token first and fills the rest of the budget with prefill chunks.'},
    {q:'KV usage is 100 % and waiting requests climb; TPOT for running requests is normal. Primary user symptom?',options:['Garbled output','Rising TTFT','Lower GPU temperature','HTTP 404'],answer:1,explain:'New requests wait for free blocks, so time to first token grows; running sequences continue normally.'},
    {q:'Which is an orchestration framework around engines rather than an engine?',options:['vLLM','SGLang','NVIDIA Dynamo','TensorRT-LLM'],answer:2,explain:'Dynamo (v1.5.x, Oct 2026) adds frontend, KV-aware router, planner, KV block manager and NIXL transfer around vLLM, SGLang or TensorRT-LLM workers.'},
    {q:'Speculative decoding with α = 0.8 and k = 4 yields how many tokens per target pass on average?',options:['0.8','2.0','3.36','5.0'],answer:2,explain:'(1 − 0.8⁵)/(1 − 0.8) = 0.672/0.2 = 3.36. 5 would require every draft token accepted every time.'},
    {q:'TTFT 0.5 s, TPOT 25 ms, 300 output tokens. Approximate E2E?',options:['0.8 s','7.5 s','8.0 s','15 s'],answer:2,explain:'0.5 + 299 × 0.025 ≈ 0.5 + 7.5 = 8.0 s.'}
  ],
  flashcards:[
    {front:'Continuous (iteration-level) batching',back:'Scheduler re-forms the batch every forward step: finished sequences leave, new ones join; from Orca (OSDI 2022), used by vLLM, SGLang, TensorRT-LLM.'},
    {front:'TTFT vs TPOT vs ITL',back:'TTFT: request arrival → first token (queue + prefill). TPOT: average time per output token after the first. ITL: gap between consecutive tokens (distribution).'},
    {front:'Engine vs orchestration',back:'Engines run the model (vLLM, SGLang, TensorRT-LLM). Dynamo / llm-d route, disaggregate, and scale across engines.'},
    {front:'Speculative decoding speed-up',back:'E = (1 − α^(k+1))/(1 − α) tokens per target pass; speed-up ≈ E/(k·c + 1). Falls at low acceptance or high batch.'},
    {front:'First metrics for throughput drop',back:'Input/output length mix, num_requests_running/waiting, kv_cache_usage_perc, preemptions, prefix hit rate, GPU clocks/Xid, deploy diff.'},
    {front:'Disaggregation pays when…',back:'Prefill interference breaks ITL SLOs at high load and KV transfer is cheap relative to prefill (fast links, long prompts). Not for small or lightly loaded fleets.'},
    {front:'Fair benchmark checklist',back:'Same model, precision, hardware, real length distributions, warm-up, controlled request rate, p50/p95/p99 TTFT and TPOT, goodput at SLO, errors.'},
    {front:'Multi-LoRA serving',back:'One base model in HBM, many adapters applied per request (vLLM --enable-lora, --max-loras default 1). Route tenants by adapter to keep batches homogeneous.'}
  ]
});

registerQuestions([
{
  id:'inf-01', chapter:'v3-ch-inference', difficulty:2,
  title:'How does vLLM batching work?',
  understand:'The interviewer wants the real mechanism: iteration-level (continuous) batching, a per-step token budget, KV-block admission, chunked prefill and preemption. The trap is describing static batching with a timeout, like a web request batcher.',
  short:'vLLM batches at the level of individual forward steps, not whole requests. Every step, the scheduler builds a batch within a token budget: each running sequence that is decoding gets one token, and the remaining budget goes to prompt tokens of waiting or partially processed requests, which is chunked prefill, on by default in V1. A new request is admitted only if there are free KV-cache blocks for it. When a sequence finishes, its blocks are freed immediately and another request can join on the very next step, so the GPU never waits for the slowest request in a batch. If running sequences need blocks that do not exist, the scheduler preempts one and recomputes it later. The knobs are max-num-batched-tokens, max-num-seqs and the memory fraction.',
  detailed:`
<h3>Static vs continuous batching</h3>
<p>Static batching waits for N requests, runs them together, and returns when the longest one finishes. Short answers wait for long ones, and new arrivals wait for the whole batch. Continuous (iteration-level) batching, introduced by Orca (OSDI 2022), re-forms the batch at every decode step, so sequences join and leave independently.</p>
<h3>One vLLM scheduler step (V1)</h3>
<ol><li><b>Running decodes first</b>: each running sequence gets 1 token in this step's budget (if it needs a new KV block and none is free → preemption).</li>
<li><b>Prefill chunks</b>: remaining budget (up to <code>--max-num-batched-tokens</code>) goes to prompt tokens of partially prefilled or waiting requests; a long prompt is split across several steps.</li>
<li><b>Admission</b>: a waiting request is admitted only if KV blocks for the tokens being scheduled are available and <code>--max-num-seqs</code> is not reached.</li>
<li><b>Forward pass</b> over the mixed batch; sample one token per decoding sequence; stream.</li>
<li><b>Free</b>: finished sequences release blocks immediately (with prefix caching on, blocks are kept as reusable cache until evicted).</li></ol>
${table(['Setting (vLLM v0.31, Oct 2026)','Default','Effect'],[
 ['--max-num-batched-tokens','hardware-dependent; serve on H100/H200: 8,192','token budget per step; higher → better throughput, worse ITL during prefills'],
 ['--max-num-seqs','1,024 on ≥70 GB non-A100 GPUs; 256 on smaller','cap on concurrent sequences'],
 ['--gpu-memory-utilization','0.92','HBM fraction for weights + activations + KV pool'],
 ['Chunked prefill','on by default in V1','prevents long prompts from stalling decodes'],
 ['Preemption mode','RECOMPUTE','evicted sequences re-run prefill later'],
 ['Prefix caching','on for supported models','reuses KV blocks of identical prefixes']
])}
${formula(`
Why batching helps decode (memory-bound)
  step time ≈ weight read time + Σ KV reads + small compute
  8B BF16 on H100: weight read ≈ 4.8 ms regardless of batch size
  batch 1  →  1 token / 4.8 ms   ≈   208 tok/s
  batch 64 → 64 tokens / (4.8 ms + KV reads + compute) → several thousand tok/s
`)}
<h3>Metrics</h3>
<p><code>vllm:num_requests_running</code>, <code>vllm:num_requests_waiting</code>, <code>vllm:kv_cache_usage_perc</code>, <code>vllm:time_to_first_token_seconds</code>, <code>vllm:inter_token_latency_seconds</code>, <code>vllm:request_queue_time_seconds</code>. (A preemption counter is not on the current design/metrics page; check your live <code>/metrics</code>.)</p>`,
  diagram:anim('v3q-inf-batching'),
  followups:[
    {q:'Why does raising max-num-batched-tokens improve throughput but hurt inter-token latency?',a:'Larger budgets let more prefill tokens ride along in each step, so the GPU is busier, but each step takes longer, and every decoding sequence waits for that step to finish before getting its next token.'},
    {q:'What decides which request gets preempted?',a:'Scheduling policy: under FCFS, the most recently admitted running request is preempted first so earlier requests keep progressing; with priority scheduling, the lowest priority.'},
    {q:'How does the scheduler interact with prefix caching?',a:'On admission it hashes the prompt\'s full blocks and reuses cached blocks, so only uncached tokens consume prefill budget and new blocks. A high hit rate effectively raises both throughput and admission capacity.'},
    {q:'Could you put a request batcher (like a Triton dynamic batcher) in front of vLLM?',a:'It adds latency without benefit: vLLM already batches at step level. Send requests concurrently and let the engine schedule; use the gateway for admission control and fairness instead.'}
  ],
  tradeoffs:`<ul><li><b>Bigger token budget</b>: throughput vs ITL.</li><li><b>Higher max-num-seqs</b>: more concurrency vs more preemption risk and longer steps.</li><li><b>Chunked prefill</b>: smooth ITL for others vs slightly longer TTFT for long prompts.</li></ul>`,
  failures:`<ul><li><b>TTFT climbs, TPOT fine</b> → KV full, queueing → context limits, FP8 KV, replicas.</li><li><b>ITL spikes when long prompts arrive</b> → budget too large or chunking off → tune budget.</li><li><b>Throughput collapses with preemption storms</b> → max-num-seqs too high for KV pool → lower it.</li></ul>`,
  vocab:[
    {term:'Continuous batching',def:'Iteration-level scheduling where the batch is re-formed every forward step.'},
    {term:'Token budget',def:'Maximum tokens processed in one step (max-num-batched-tokens).'},
    {term:'Chunked prefill',def:'Splitting prompt processing into budget-sized chunks interleaved with decodes.'},
    {term:'Admission control',def:'Admitting a request only when KV blocks and sequence slots are available.'},
    {term:'Preemption',def:'Evicting a running sequence\'s KV when memory runs out; recomputed later by default.'}
  ],
  mistakes:[
    'Describing timeout-based static batching.',
    'Saying vLLM crashes when KV fills (it queues and preempts).',
    'Ignoring the token budget and its latency trade-off.',
    'Citing old metric names like gpu_cache_usage_perc.'
  ],
  related:['v1-batching','v1-kv-cache','v1-engines']
},
{
  id:'inf-02', chapter:'v3-ch-inference', difficulty:1,
  title:'Explain prefill and decode, and TTFT versus TPOT, to a DevOps engineer.',
  understand:'Core concept. They want clear phases, which metric each drives, and which hardware limit each hits. A good DevOps bridge earns points.',
  short:'Think of a request in two phases. Prefill is like a bulk import: the whole prompt is processed in one parallel pass, which keeps the GPU\'s compute units busy and fills the KV cache. Its time, plus any queueing, is the time to first token. Decode is like a stream: the model produces one token per step, and each step reads all the weights from memory to do relatively little maths, so it is limited by memory bandwidth. The time between tokens is the time per output token, TPOT, or inter-token latency. Long prompts hurt TTFT; long answers multiply TPOT. They need different fixes, so I always report them separately, at p95, never just an average request latency.',
  detailed:`
${table(['','Prefill','Decode'],[
 ['Input','all prompt tokens at once','one new token per sequence per step'],
 ['Parallelism','across tokens (matrix-matrix)','across sequences only (batching)'],
 ['Bound','compute (Tensor Cores)','memory bandwidth (weights + KV reads)'],
 ['Metric','TTFT (with queue time)','TPOT / ITL'],
 ['Scales with','prompt length (n, plus n² attention)','output length × per-step time'],
 ['Fixes','prefix caching, shorter prompts, faster GPUs, chunking','batching, quantized weights/KV, more bandwidth, speculative decoding']
])}
${formula(`
TTFT = queue time + prefill time (+ tokenization, network)
E2E  ≈ TTFT + (output_tokens − 1) × TPOT

Example: TTFT 0.6 s, TPOT 18 ms, 250 output tokens
E2E ≈ 0.6 + 249 × 0.018 = 0.6 + 4.48 ≈ 5.1 s
`)}
<h3>DevOps bridge</h3>
<p>TTFT is like time-to-first-byte for a web request: users perceive responsiveness by it, and it includes queueing. TPOT is like streaming throughput: users perceive it as reading speed. Where the analogy breaks: both phases share the same GPU, and a big prefill can slow everyone's decode unless the engine chunks it.</p>
<h3>Measuring</h3>
<p>vLLM histograms: <code>vllm:time_to_first_token_seconds</code>, <code>vllm:inter_token_latency_seconds</code>, <code>vllm:request_time_per_output_token_seconds</code>, <code>vllm:request_prefill_time_seconds</code>, <code>vllm:request_decode_time_seconds</code>, <code>vllm:request_queue_time_seconds</code>. Client-side measurement (streaming) is the ground truth for users.</p>
<h3>What this means for capacity and autoscaling</h3><p>Because the phases stress different limits, two workloads with the same requests per second can need very different fleets. A RAG workload with 6,000-token prompts and 150-token answers is prefill-heavy: TTFT and compute dominate, and prefix caching or more FLOPS help. A chat workload with 300-token prompts and 800-token answers is decode-heavy: TPOT and memory bandwidth dominate, and batching, quantized weights or more bandwidth help. Autoscaling should therefore watch queue time and TTFT (prefill pressure) as well as running sequences and KV usage (decode pressure), not GPU utilization or request count alone.</p><h3>Streaming</h3><p>Streaming sends each token as it is produced (server-sent events in OpenAI-compatible APIs). It does not make generation faster, but it changes what the user waits for: the first token instead of the last. That is why TTFT is the headline latency metric for interactive products.</p>`,
  diagram:fig('Timeline of one streamed request', svgDiagram({w:900,h:200,
    boxes:[
      {id:'q',x:20,y:70,w:120,h:60,label:'Queue',sub:'waiting',cls:'warn'},
      {id:'p',x:150,y:70,w:200,h:60,label:'Prefill',sub:'compute-bound',cls:'hl'},
      {id:'t1',x:360,y:70,w:60,h:60,label:'t₁',cls:'ok'},
      {id:'t2',x:430,y:70,w:60,h:60,label:'t₂',cls:'ok'},
      {id:'t3',x:500,y:70,w:60,h:60,label:'t₃',cls:'ok'},
      {id:'tn',x:570,y:70,w:310,h:60,label:'… decode, one token per step',sub:'bandwidth-bound',cls:'v2'}
    ],
    notes:[{x:20,y:160,text:'TTFT = queue + prefill  →  first token t₁'},{x:360,y:160,text:'TPOT / ITL = gap between t₁, t₂, t₃ …'}]
  }), 'Two phases, two metrics, two different hardware limits.'),
  followups:[
    {q:'Why can TTFT be high when GPUs are idle?',a:'Time before the engine: gateway, retrieval, tool calls, tokenization; or a cold start loading weights. Trace spans before the engine.'},
    {q:'Which matters more for a chat UI vs a batch summarisation job?',a:'Chat: TTFT and steady ITL (perceived responsiveness). Batch: total throughput and cost per token; TTFT barely matters.'},
    {q:'Is ITL the same as TPOT?',a:'TPOT is an average per request (decode time ÷ output tokens − 1); ITL is the distribution of individual gaps, which exposes stalls (for example a prefill chunk) that averages hide.'}
  ],
  tradeoffs:`<ul><li><b>Prioritising prefill</b> lowers TTFT but stalls decodes; chunking balances the two.</li><li><b>Large batches</b> improve throughput, slightly raise TPOT.</li></ul>`,
  failures:`<ul><li><b>TTFT p99 spikes</b> → long prompts or queueing.</li><li><b>Stuttering stream</b> → ITL spikes from large prefill steps.</li><li><b>Slow overall answers</b> → TPOT too high for long outputs → output caps, faster decode.</li></ul>`,
  vocab:[
    {term:'TTFT',def:'Time to first token: arrival to first streamed token, including queueing and prefill.'},
    {term:'TPOT',def:'Time per output token after the first, averaged per request.'},
    {term:'ITL',def:'Inter-token latency: individual gaps between streamed tokens.'},
    {term:'Prefill',def:'Parallel processing of the prompt that fills the KV cache.'},
    {term:'Decode',def:'Sequential generation of one token per step.'}
  ],
  mistakes:[
    'Reporting only average end-to-end latency.',
    'Saying decode is compute-bound.',
    'Forgetting queue time inside TTFT.'
  ],
  related:['v1-inference-anatomy','v1-benchmarking','v2-ai-observability']
},
{
  id:'inf-03', chapter:'v3-ch-inference', difficulty:2,
  title:'Build a latency budget for an LLM feature: TTFT and TPOT targets.',
  understand:'A quantitative design question. They want you to decompose user-facing latency into components, assign budgets, derive the TPOT requirement from output length, and say what you would measure. Inputs must be labelled as assumptions or measurements.',
  short:'I start from the user requirement, say the first token within 1.5 seconds at p95 and a typical 400-token answer finished within 8 seconds. Then I budget TTFT across the path: gateway and auth, guardrails, retrieval and reranking, queueing, and prefill, which I estimate from prompt length divided by measured prefill throughput under load. Whatever is left is the queue budget, which drives replica count. For decode, E2E minus TTFT divided by output tokens gives the TPOT I need: here 6.5 seconds over 399 tokens, about 16 milliseconds per token at p95. Then I benchmark the engine at our real length distribution to see whether that TPOT holds at the target concurrency, and if not I trade off batch size, model size, quantization or output length.',
  detailed:`
${formula(`
Requirement (example): TTFT p95 ≤ 1.5 s ; E2E p95 ≤ 8.0 s for a 400-token answer

TTFT budget (ILLUSTRATIVE component measurements at p95)
  gateway + auth                    30 ms
  input guardrail                   50 ms
  retrieval (hybrid search)        150 ms
  rerank                           120 ms
  prefill: 3,000 tokens at a measured
           10,000 prompt tok/s per request under load  →  300 ms
  ─────────────────────────────────────────
  subtotal                         650 ms
  queue budget = 1,500 − 650     = 850 ms   (p95 queue time must stay below this)

Decode budget
              E2E − TTFT        8.0 − 1.5
  TPOT ≤ ───────────────── = ─────────── = 0.0163 s ≈ 16 ms/token (p95)
          output_tokens − 1      399
`)}
<h3>Checking feasibility</h3>
<p>Benchmark the candidate deployment at the target concurrency with the real input/output length distribution and read p95 TPOT. Physical floor: for an 8B BF16 model on one H100, weight reads alone take ≈ 4.8 ms per step; for 70B BF16 on TP=4, ≈ 10.5 ms. With batching overhead and KV reads, 16 ms p95 is plausible for 8B at moderate concurrency and tight for 70B; measure, do not assume.</p>
${table(['If the budget fails at…','Levers'],[
 ['Queue time','more replicas, admission control, priority classes, prefix caching (less prefill per request)'],
 ['Prefill','shorter prompts, prefix caching for static parts, faster GPU, disaggregated prefill at scale'],
 ['TPOT','smaller batch cap, FP8 weights/KV, more TP, speculative decoding, smaller model'],
 ['Output length','max_tokens policy, concise-answer prompting, structured output'],
 ['Retrieval/rerank','cache retrieval, cheaper reranker, parallelise with prompt assembly']
])}
<h3>Streaming changes perception, not physics</h3>
<p>With streaming, the user sees progress after TTFT, so a longer E2E may be acceptable if ITL is steady. Define SLOs for TTFT and ITL/TPOT separately, and goodput as the share of requests meeting both. <code>vllm bench serve --goodput ttft:1500 tpot:16</code> (ms) reports exactly that.</p>
<p>Interview framing: "I budget TTFT across the path, derive the TPOT requirement from answer length, then prove both with a goodput benchmark" — three steps, each with a number.</p>`,
  diagram:fig('Budget bar for one request (illustrative p95)', svgDiagram({w:900,h:200,
    boxes:[
      {id:'g',x:20,y:70,w:60,h:60,label:'GW',sub:'80',cls:'v1'},
      {id:'r',x:85,y:70,w:150,h:60,label:'RAG+rerank',sub:'270 ms',cls:'v2'},
      {id:'q',x:240,y:70,w:180,h:60,label:'Queue ≤ 850',cls:'warn'},
      {id:'p',x:425,y:70,w:110,h:60,label:'Prefill',sub:'300 ms',cls:'hl'},
      {id:'d',x:540,y:70,w:340,h:60,label:'Decode 399 × 16 ms ≈ 6.5 s',cls:'ok'}
    ],
    notes:[{x:20,y:160,text:'|←──────── TTFT ≤ 1.5 s ────────→|'},{x:540,y:160,text:'E2E ≤ 8.0 s'}]
  }), 'Decode dominates long answers; queueing dominates TTFT under load.'),
  followups:[
    {q:'Why budget at p95 rather than mean?',a:'Users experience tails, and latencies do not add linearly at percentiles; budgeting component p95s is conservative but simple. Validate with end-to-end p95 measured from the client.'},
    {q:'Arabic prompts are 40 % more tokens in our measurement. Effect?',a:'Prefill time and KV per request rise proportionally for those users; either budget per language or size for the heavier mix. The 40 % is whatever you measured, not a constant.'},
    {q:'How does the budget translate into replica count?',a:'Find, by benchmark, the maximum request rate per replica at which p95 TTFT ≤ 1.5 s and p95 TPOT ≤ 16 ms (goodput). Peak RPS ÷ that rate, plus N+1 and zone headroom, gives replicas.'}
  ],
  tradeoffs:`<ul><li><b>Tighter TPOT</b> means smaller batches → more GPUs.</li><li><b>Shorter answers</b> save latency and cost but may hurt helpfulness.</li><li><b>Retrieval depth</b> improves grounding but eats TTFT.</li></ul>`,
  failures:`<ul><li><b>SLO met in test, broken in production</b> → benchmark used synthetic short prompts → use real distributions.</li><li><b>Queue budget exhausted at peak</b> → autoscaling on wrong signal → scale on waiting requests/TTFT.</li></ul>`,
  vocab:[
    {term:'Latency budget',def:'Allocation of an end-to-end latency target across components.'},
    {term:'Goodput',def:'Rate of requests that meet all latency SLOs.'},
    {term:'p95',def:'95th percentile: 95 % of requests are at or below this value.'},
    {term:'Prefill throughput',def:'Prompt tokens processed per second, measured under realistic load.'},
    {term:'max_tokens',def:'Request parameter capping output length.'}
  ],
  mistakes:[
    'Budgeting with average latency.',
    'Ignoring that output length multiplies TPOT.',
    'Presenting illustrative prefill rates as benchmarks.',
    'Forgetting non-GPU components in TTFT.'
  ],
  related:['v1-inference-anatomy','v1-benchmarking','v2-capacity-planning','v2-hyperscale-serving']
},
{
  id:'inf-04', chapter:'v3-ch-inference', difficulty:2,
  title:'How do you compare TensorRT-LLM, vLLM, and Dynamo?',
  understand:'They test whether you place these at the right layer (engines vs orchestration) and can run a fair selection. Current facts matter: TensorRT-LLM\'s PyTorch backend is now the default and the classic engine-build path is legacy; Dynamo wraps engines.',
  short:'First, they are not three alternatives. vLLM and TensorRT-LLM are inference engines: they load the model and run batched forward passes with KV-cache management; SGLang is another engine in that group. NVIDIA Dynamo is an orchestration layer around engines: an OpenAI-compatible frontend, a KV-aware router, a planner that scales prefill and decode workers, a KV block manager and NIXL for KV transfer, with vLLM, SGLang or TensorRT-LLM as workers. Between the engines, vLLM is the broad, fast-moving open ecosystem; TensorRT-LLM is NVIDIA-optimised, now PyTorch-based by default without a separate engine build. I would shortlist by model and hardware support, then benchmark goodput per dollar on our traffic, and add Dynamo or llm-d only when multi-node routing or disaggregation is needed.',
  detailed:`
${table(['','vLLM','SGLang','TensorRT-LLM','NVIDIA Dynamo'],[
 ['Layer','engine','engine','engine','orchestration around engines'],
 ['Latest (as of Oct 2026)','v0.31.0','v0.5.21','v1.2.1 stable (1.3 pre-releases)','v1.5.1'],
 ['Strengths','broad model support, PagedAttention, prefix caching on by default, OpenAI API incl. /v1/responses','RadixAttention prefix tree, structured programs, cache-aware scheduling option (lpm)','NVIDIA-tuned kernels, FP8/NVFP4 paths via ModelOpt, trtllm-serve','KV-aware router, planner (SLA-driven P/D scaling), KVBM, NIXL, K8s operator (DynamoGraphDeployment)'],
 ['Hardware','NVIDIA, AMD and others','NVIDIA, AMD','NVIDIA only','NVIDIA-focused; backends as supported'],
 ['Ops notes','vllm serve, Prometheus /metrics','launch_server, port 30000 default','PyTorch backend default since 1.0; TensorRT engine backend removed in the 1.3 line; trtllm-build legacy','frontend port 8000; discovery via Kubernetes or etcd; NATS optional']
])}
<h3>History you should not repeat wrongly</h3>
<ul><li>"TensorRT-LLM requires building an engine per GPU and model" was true of the old path; now <code>LLM(model=...)</code> or <code>trtllm-serve &lt;hf_model&gt;</code> works without conversion.</li>
<li>"Dynamo replaces vLLM" is wrong: Dynamo runs vLLM, SGLang or TensorRT-LLM as workers. NVIDIA describes Dynamo as the successor to Triton Inference Server, which continues as Dynamo-Triton.</li></ul>
<h3>Selection method</h3>
<ol><li><b>Hard filters</b>: model architecture and quantization supported on your GPUs; features you need (LoRA, structured output, speculative decoding, multimodal).</li>
<li><b>Benchmark</b>: same model weights and precision, same GPUs, real input/output distributions, request-rate sweep; record p95 TTFT, TPOT, goodput, errors.</li>
<li><b>Operational fit</b>: upgrade cadence, metrics, Kubernetes integration, security posture of the image, team skills, vendor support.</li>
<li><b>Orchestration need</b>: single-node replicas behind a normal gateway are enough for many fleets; add Dynamo or llm-d (with the Gateway API Inference Extension) when prefix-aware routing, P/D disaggregation or multi-node models pay off.</li></ol>
<p>Avoid universal claims like "X is 2× faster": results depend on model, precision, hardware, version and workload, and engines leapfrog each other release by release.</p>
<p>Interview framing: open with "they are different layers", then give your selection method; that avoids a brand debate and shows you would decide with data.</p>`,
  diagram:fig('Layers: orchestration around engines', svgDiagram({w:900,h:270,
    zones:[{x:10,y:10,w:880,h:110,label:'Orchestration: Dynamo or llm-d'},{x:10,y:140,w:880,h:120,label:'Engines (workers)',cls:'ok'}],
    boxes:[
      {id:'f',x:30,y:45,w:160,h:56,label:'Frontend',sub:'OpenAI API',cls:'v1'},
      {id:'r',x:220,y:45,w:180,h:56,label:'KV-aware router',cls:'hl'},
      {id:'p',x:430,y:45,w:180,h:56,label:'Planner',sub:'P/D scaling',cls:'v2'},
      {id:'k',x:640,y:45,w:220,h:56,label:'KVBM + NIXL',sub:'KV tiers, transfer',cls:'v3'},
      {id:'v',x:60,y:180,w:220,h:56,label:'vLLM',cls:'ok'},
      {id:'s',x:340,y:180,w:220,h:56,label:'SGLang',cls:'ok'},
      {id:'t',x:620,y:180,w:220,h:56,label:'TensorRT-LLM',cls:'ok'}
    ],
    arrows:[{from:'r',to:'v'},{from:'r',to:'s'},{from:'r',to:'t'}]
  }), 'Choose the engine on benchmarks; choose orchestration on fleet-level needs.'),
  followups:[
    {q:'When would you not use Dynamo or llm-d at all?',a:'Small fleets of single-node replicas with modest prefix reuse: a standard gateway with least-loaded routing is simpler and enough. Orchestration earns its complexity at scale or with multi-node models.'},
    {q:'What is the KV-aware routing cost in Dynamo?',a:'In v1.5.1 docs: prefill_load_scale × adjusted prefill blocks (incoming minus cached overlap, plus active prefill) + potential decode blocks + active request blocks; lowest cost wins, optional softmax sampling via router temperature.'},
    {q:'How do you de-risk a switch from vLLM to TensorRT-LLM?',a:'Shadow or canary a slice of traffic on the same model weights, compare quality on an eval set (precision paths differ), latency and goodput, keep the same OpenAI-compatible API so the gateway can shift weights and roll back instantly.'},
    {q:'Where does llm-d fit relative to Dynamo?',a:'llm-d (CNCF Sandbox) is a Kubernetes-native distributed inference stack using Gateway API Inference Extension InferencePools and an endpoint picker for prefix-aware and predicted-latency routing, P/D disaggregation and tiered KV, with vLLM/SGLang as model servers. It overlaps with Dynamo in purpose; choose by ecosystem fit and evaluation.'}
  ],
  tradeoffs:`<ul><li><b>vLLM</b>: breadth and community velocity vs frequent breaking changes to track.</li><li><b>TensorRT-LLM</b>: NVIDIA-optimised paths vs NVIDIA-only and its own release cadence.</li><li><b>Dynamo/llm-d</b>: fleet efficiency vs more moving parts to operate.</li></ul>`,
  failures:`<ul><li><b>Upgrade breaks flags or metrics</b> → pin versions, test in staging, track release notes.</li><li><b>Router hotspots</b> → affinity without load terms → tune load weighting.</li><li><b>Quality drift after engine switch</b> → different kernels/precision → run evals before cutover.</li></ul>`,
  vocab:[
    {term:'Inference engine',def:'Software that executes the model with batching and KV management (vLLM, SGLang, TensorRT-LLM).'},
    {term:'Orchestration layer',def:'Routing, scaling and disaggregation across many engine workers (Dynamo, llm-d).'},
    {term:'NIXL',def:'NVIDIA Inference Xfer Library for moving KV/data across workers and memory tiers.'},
    {term:'KVBM',def:'Dynamo KV Block Manager for KV across memory tiers.'},
    {term:'InferencePool',def:'Gateway API Inference Extension resource representing a pool of model-server endpoints.'}
  ],
  mistakes:[
    'Treating Dynamo as a competing engine.',
    'Saying TensorRT-LLM always needs trtllm-build engine compilation.',
    'Choosing by vendor benchmark headlines instead of your workload.',
    'Quoting versions without a date.'
  ],
  related:['v1-engines','v2-distributed-inference','v1-k8s-serving','v1-benchmarking']
},
{
  id:'inf-05', chapter:'v3-ch-inference', difficulty:2,
  title:'How would you troubleshoot degraded token throughput?',
  understand:'An incident question. They want a systematic, metrics-first approach: first check whether the workload changed, then the engine\'s scheduler state, then the hardware, then recent deploys. Naming the exact metrics and the order is the senior signal.',
  short:'First I check whether the work changed, not the system: compare input and output token distributions and request mix before and after, because longer prompts or answers reduce tokens per second on the same hardware. Then the engine\'s view: running versus waiting requests, KV-cache usage and preemptions, prefix-cache hit rate, batch size, and prefill versus decode time. Then the deploy diff: engine version, flags like the token budget or max sequences, model or quantization changes, speculative-decoding acceptance. Then hardware: GPU clocks, power and temperature for throttling, Xid errors, NVLink errors, and CPU saturation in the engine process. I compare the bad replica with a healthy one and confirm the fix with the same benchmark.',
  detailed:`
<div class="dtree"><ul><li><span class="q">Did the workload change?</span><ul>
<li><span class="a">yes</span> Longer prompts (prompt_tokens_total rate vs requests), longer outputs, new tenant with huge contexts, more Arabic traffic → expected per-token cost changed; re-baseline or apply limits.</li>
<li><span class="a">no</span><ul><li><span class="q">Engine scheduler state?</span><ul>
<li><span class="a">KV ≈ 100 %, waiting > 0, preemptions</span> memory-bound admission → context caps, FP8 KV, more replicas, lower max-num-seqs.</li>
<li><span class="a">running low, waiting 0</span> not enough load reaching the engine → gateway/router problem, client concurrency, load balancer skew.</li>
<li><span class="a">prefix hit rate dropped</span> prompt template changed (timestamp at top?), routing changed → fix prefix stability, cache-aware routing.</li></ul></li>
<li><span class="q">Recent deploy?</span> engine version, flags, model revision, quantization, speculative config (acceptance rate fell?), LoRA count → roll back to confirm.</li>
<li><span class="q">Hardware?</span> clocks/power/temperature throttling, Xid 48/74/79/95, NVLink errors on TP replicas, PCIe downgraded link → drain node.</li>
<li><span class="q">Host?</span> engine process CPU at 100 %, CPU limits in the pod, slow tokenizer, noisy neighbour → raise CPU, fix limits.</li></ul></li></ul></li></ul></div>
${table(['Signal','Metric / source'],[
 ['Token throughput','rate(vllm:generation_tokens_total), rate(vllm:prompt_tokens_total)'],
 ['Queueing','vllm:num_requests_waiting, vllm:request_queue_time_seconds'],
 ['KV pressure','vllm:kv_cache_usage_perc'],
 ['Prefix reuse','rate(vllm:prefix_cache_hits) / rate(vllm:prefix_cache_queries)'],
 ['Latency split','vllm:request_prefill_time_seconds, vllm:request_decode_time_seconds, vllm:inter_token_latency_seconds'],
 ['GPU health','DCGM: clocks, power, temperature, XID_ERRORS, PIPE_TENSOR_ACTIVE, DRAM_ACTIVE'],
 ['Host','container CPU throttling (cgroup), engine process CPU']
])}
${formula(`
Normalise before comparing:
  tokens/s per GPU at equal (input, output) length distribution
  e.g. last week 2,400 out tok/s at mean 800-in/200-out
       today     1,700 out tok/s at mean 2,400-in/200-out
  → 3× longer prompts: prefill work up ≈ 3×; the "degradation" may be workload, not a fault.
  (numbers illustrative)
`)}
<h3>Writing it up</h3><p>Close the incident with a normalised comparison (tokens per second per GPU at the same token mix before and after), the root cause, the evidence that confirmed it, and the guard rail you added: an alert, a release gate or a capacity change. Throughput regressions that are really workload changes should lead to a capacity-planning update, not a code fix, and the postmortem should say so explicitly so nobody "fixes" a healthy system.</p>`,
  diagram:fig('Investigation order', svgDiagram({w:900,h:200,
    boxes:[
      {id:'w',x:20,y:70,w:150,h:60,label:'1 Workload',sub:'length mix',cls:'v1'},
      {id:'e',x:200,y:70,w:150,h:60,label:'2 Engine',sub:'KV, queue, hits',cls:'hl'},
      {id:'d',x:380,y:70,w:150,h:60,label:'3 Deploy diff',sub:'version, flags',cls:'v2'},
      {id:'h',x:560,y:70,w:150,h:60,label:'4 Hardware',sub:'clocks, Xid',cls:'warn'},
      {id:'c',x:740,y:70,w:140,h:60,label:'5 Host CPU',sub:'limits',cls:'v3'}
    ],
    arrows:[{from:'w',to:'e'},{from:'e',to:'d'},{from:'d',to:'h'},{from:'h',to:'c'}]
  }), 'Cheapest, most common causes first; compare a bad replica with a healthy one at each step.'),
  followups:[
    {q:'Only one replica is slow. What does that suggest?',a:'Something local: GPU throttling or hardware errors, a noisy neighbour on the node, a different image or flag on that pod, or router skew sending it the longest prompts. Compare its metrics with peers and drain it.'},
    {q:'Throughput fell right after enabling speculative decoding. Why?',a:'Low acceptance rate for this traffic, or high batch sizes where decode is already compute-bound so verification costs more than it saves. Check acceptance metrics and benchmark at production concurrency.'},
    {q:'How do you prevent this class of incident?',a:'Per-replica throughput SLO normalised by token mix, alerts on KV usage and waiting requests, prefix hit-rate alerts, canary deploys gated on a benchmark, and automatic cordon on hardware Xids.'}
  ],
  tradeoffs:`<ul><li><b>Rolling back first</b> restores service fast but may hide a workload change.</li><li><b>Adding replicas</b> masks the symptom and costs money.</li></ul>`,
  failures:`<ul><li><b>Prefix-cache regression</b> after a template change → hit rate collapse → stable prefixes.</li><li><b>CPU throttling</b> from new pod limits → low GPU util → remove CPU limits for engines.</li><li><b>Thermal throttling</b> in one rack → clocks drop → facilities/hardware ticket.</li></ul>`,
  vocab:[
    {term:'Token mix',def:'Distribution of input and output lengths; changes the cost of a request.'},
    {term:'Preemption storm',def:'Repeated KV evictions that waste compute and reduce throughput.'},
    {term:'Prefix hit rate',def:'Share of prompt tokens served from cached KV blocks.'},
    {term:'Throttling',def:'GPU lowering clocks due to power or temperature limits.'},
    {term:'CPU throttling',def:'cgroup CPU limit enforcement slowing a container.'}
  ],
  mistakes:[
    'Adding GPUs before checking whether the workload changed.',
    'Comparing raw tokens/s across different length mixes.',
    'Ignoring CPU limits on the engine pod.',
    'Not comparing the bad replica with a healthy one.'
  ],
  related:['v1-benchmarking','v2-ai-observability','v2-aiops','v3-debugging']
},
{
  id:'inf-06', chapter:'v3-ch-inference', difficulty:2,
  title:'How does speculative decoding work, and what speed-up should you expect?',
  understand:'They want the draft-then-verify mechanism, why it does not change the output distribution, the expected-tokens formula, and the conditions where it fails (low acceptance, high batch, compute-bound decode).',
  short:'Decode is memory-bound: each step reads all the weights to produce one token, leaving compute idle. Speculative decoding uses that idle compute. A cheap drafter, a small model, n-gram lookup, or extra heads like EAGLE or MTP, proposes k tokens; the big target model then checks all k in one forward pass, like a tiny prefill. Tokens are accepted left to right by a rejection-sampling rule that keeps the output distribution identical to the target model\'s, and at the first rejection the target supplies a corrected token. With acceptance rate alpha, expected tokens per target pass are one minus alpha to the k plus one, over one minus alpha: 3.36 for alpha 0.8 and k 4. After drafting cost, that is roughly 2.8 times ideal. It helps most at low batch; at high batch, decode becomes compute-bound and the gain shrinks or reverses.',
  detailed:`
<h3>Mechanism (Leviathan et al. arXiv 2211.17192; Chen et al. arXiv 2302.01318)</h3>
<ol><li>Drafter proposes tokens x₁…x_k with its probabilities q(·).</li>
<li>Target runs one forward pass over the prefix + k drafted tokens, producing p(·) at each position.</li>
<li>Accept x_i with probability min(1, p(x_i)/q(x_i)); on the first rejection, sample a replacement from the normalised residual max(0, p − q). If all k are accepted, the target pass also yields a bonus token.</li></ol>
<p>This preserves the target model's output distribution exactly (for sampling; for greedy, accept if the target's argmax matches).</p>
${formula(`
Expected tokens per target pass (i.i.d. acceptance α, k drafted)
             1 − α^(k+1)
  E      =  ─────────────
               1 − α

Cost of one cycle in target-pass units:  k·c + 1   (c = draft cost ratio)

                 E
  speed-up ≈ ─────────
               k·c + 1

α = 0.8, c = 0.05
  k = 2 : E = 2.44 , cost 1.10 → 2.22×
  k = 4 : E = 3.36 , cost 1.20 → 2.80×
  k = 6 : E = 3.95 , cost 1.30 → 3.04×
  k = 8 : E = 4.33 , cost 1.40 → 3.09×   ← diminishing returns
α = 0.5, k = 8 : E ≈ 2.00, cost 1.40 → 1.43×
`)}
<p>These are ideal numbers; they assume verifying k tokens costs about one decode step (true when memory-bound) and ignore scheduling overhead.</p>
<h3>Drafter options in vLLM (v0.31 docs)</h3>
<p><code>--speculative-config</code> JSON with methods including <code>draft_model</code>, <code>ngram</code>, <code>suffix</code>, <code>mtp</code>, <code>eagle3</code>, e.g. <code>{"method": "suffix", "num_speculative_tokens": 8}</code>. N-gram/suffix methods cost almost nothing and work well when outputs repeat the input (code edits, extraction, RAG quoting). EAGLE-style heads and MTP modules are trained to draft for a specific target.</p>
<h3>When it hurts</h3>
<ul><li><b>High batch / compute-bound decode</b>: verification of k extra tokens per sequence consumes real compute.</li><li><b>Low acceptance</b>: creative, high-temperature outputs.</li><li><b>Extra memory</b>: a draft model's weights and KV.</li></ul>`,
  diagram:anim('v3q-inf-spec'),
  followups:[
    {q:'Does speculative decoding change answer quality?',a:'With correct rejection sampling, no: outputs follow the target distribution. Implementation bugs or approximate acceptance schemes can; validate on an eval set.'},
    {q:'How would you pick k?',a:'Measure acceptance α on real traffic, compute speed-up for candidate k, and confirm by benchmark at production concurrency; returns diminish after a few tokens and verification cost rises with batch.'},
    {q:'Why might it help TTFT not at all?',a:'It accelerates decode only; TTFT is queueing and prefill.'},
    {q:'Your platform runs at batch 200 most of the day. Enable it?',a:'Probably not globally: at that batch decode is closer to compute-bound and gains shrink or reverse. Consider enabling only on latency-sensitive, low-concurrency pools, and benchmark.'}
  ],
  tradeoffs:`<ul><li><b>Lower TPOT</b> vs more compute per token and some memory.</li><li><b>Bigger k</b>: more tokens per pass at high α, more waste at low α.</li><li><b>Trained drafters</b> (EAGLE/MTP) higher α vs extra artefacts to manage per model.</li></ul>`,
  failures:`<ul><li><b>Throughput drops at peak</b> → compute-bound regime → disable at high load or per pool.</li><li><b>Acceptance falls after model upgrade</b> → drafter no longer matches target → retrain/replace drafter.</li><li><b>OOM</b> → draft model weights not budgeted.</li></ul>`,
  vocab:[
    {term:'Speculative decoding',def:'Draft several tokens cheaply, verify them in one target forward pass.'},
    {term:'Acceptance rate (α)',def:'Probability a drafted token is accepted by the target.'},
    {term:'Draft model',def:'Cheaper model or mechanism that proposes tokens.'},
    {term:'Rejection sampling',def:'Acceptance rule that preserves the target distribution.'},
    {term:'EAGLE / MTP',def:'Draft heads trained on the target\'s features / multi-token prediction modules.'}
  ],
  mistakes:[
    'Claiming a fixed speed-up regardless of acceptance and batch.',
    'Saying it reduces quality by design.',
    'Expecting TTFT improvements.',
    'Forgetting drafter memory.'
  ],
  related:['v1-quantization-speculative','v1-engines','v1-benchmarking']
},
{
  id:'inf-07', chapter:'v3-ch-inference', difficulty:1,
  title:'How many concurrent users can one GPU serve? Do the KV-cache maths.',
  understand:'A core quantitative question. They expect weights, engine memory fraction, KV per token from the config, a token budget, and concurrency at realistic lengths, plus the point that compute and latency SLOs can cap concurrency before memory does.',
  short:'Take Llama-3.1-8B on one 80 GB H100 with vLLM. The engine uses 92 percent, 73.6 GB. Weights are about 16 GB in BF16; reserve a few GB for activations, say 4. That leaves about 53.5 GB for KV. Each token costs two times 32 layers times 8 KV heads times 128 times 2 bytes, 128 KiB. So the pool holds about 408,000 tokens. If every conversation sat at 8,000 tokens, that is about 49 concurrent; at 4,000, about 99; with FP8 KV, double. Real conversations average much less than their maximum, so more fit, but I would size on the p95 of resident tokens and then confirm in a benchmark that TPOT still meets the SLO at that concurrency, because latency can become the limit before memory does.',
  detailed:`
${formula(`
STEP 1  usable HBM     = 0.92 × 80 GB                         = 73.6 GB
STEP 2  weights        = 8.03 × 10⁹ × 2 B                     ≈ 16.1 GB
STEP 3  reserve        = activations / workspace (illustrative) ≈ 4 GB
STEP 4  KV pool        = 73.6 − 16.1 − 4                      = 53.5 GB
STEP 5  KV per token   = 2 × 32 × 8 × 128 × 2 B               = 131,072 B
STEP 6  token budget   = 53.5 × 10⁹ / 131,072                 ≈ 408,000 tokens

Concurrency if every sequence holds L tokens
  L = 4,096  →  ≈  99         FP8 KV → ≈ 199
  L = 8,192  →  ≈  49         FP8 KV → ≈  99
  L = 32,768 →  ≈  12         FP8 KV → ≈  24
`)}
<h3>From tokens to users</h3>
<p>Concurrent sequences ≠ users. Use Little's law on the engine for a stable system: average in-flight requests = arrival rate × average time in system. Example: 20 requests/s, each in the engine 6 s → ≈ 120 in flight. If their average resident length is 2,500 tokens, that is ≈ 300,000 tokens: fits the 408,000 budget with ≈ 25 % headroom. Then check that at 120 concurrent the measured TPOT p95 still meets the SLO.</p>
${table(['Lever','Effect on concurrency'],[
 ['FP8 KV cache','2× tokens'],
 ['Lower max context','prevents a few long requests consuming the pool'],
 ['Prefix caching','shared prefixes stored once'],
 ['TP=2 on two GPUs','weights split → larger pool per replica, faster per token'],
 ['Smaller/quantized weights','more room for KV'],
 ['GQA models','fewer KV heads → fewer bytes per token']
])}
<h3>Saying it in the interview</h3><p>Walk the five numbers in order (usable memory, weights, reserve, KV per token, token budget), then convert to sequences at two context lengths, then say which constraint you would verify by benchmark (TPOT at that concurrency). That structure shows you can do it on a whiteboard without a calculator app and that you know memory is only one of the limits.</p>`,
  diagram:fig('One H100 for Llama-3.1-8B (illustrative reserve)', svgDiagram({w:900,h:180,
    boxes:[
      {id:'w',x:20,y:60,w:180,h:60,label:'Weights 16.1 GB',cls:'v1'},
      {id:'r',x:205,y:60,w:50,h:60,label:'4',sub:'act',cls:'warn'},
      {id:'k',x:260,y:60,w:540,h:60,label:'KV pool 53.5 GB ≈ 408k tokens',cls:'hl'},
      {id:'f',x:805,y:60,w:75,h:60,label:'6.4',sub:'unused',cls:'x'}
    ],
    notes:[{x:20,y:150,text:'Widths roughly proportional to GB of 80. KV, not weights, dominates the card.'}]
  }), 'On small models, the KV pool is most of the GPU.'),
  followups:[
    {q:'Why does vLLM\'s startup log show a different KV capacity from your estimate?',a:'It profiles real activation memory and may reserve CUDA graph memory; block size rounding and other buffers also differ. Use your estimate for planning, the log for truth.'},
    {q:'What caps concurrency before memory?',a:'max-num-seqs, compute (large batches push decode toward compute-bound) and the TPOT SLO. Benchmark goodput, not just fit.'},
    {q:'How does Little\'s law mislead here?',a:'It applies to stable systems in steady state and gives average in-flight requests, not how many are on the GPU versus waiting, and not peak bursts. Use percentiles and queue measurements too.'}
  ],
  tradeoffs:`<ul><li><b>Higher concurrency</b>: more throughput, higher TPOT per user.</li><li><b>FP8 KV</b>: 2× capacity vs small quality risk.</li><li><b>Context caps</b>: protect capacity vs limit some users.</li></ul>`,
  failures:`<ul><li><b>Queueing at 60 % average utilisation</b> → sized on average resident tokens, bursts exceed → size on p95/p99.</li><li><b>Preemptions</b> → long-tail contexts → caps or dedicated long-context pool.</li></ul>`,
  vocab:[
    {term:'KV per token',def:'2 × layers × KV heads × head_dim × bytes per element.'},
    {term:'Token budget (KV)',def:'Total tokens of KV the pool can hold.'},
    {term:'Resident tokens',def:'Prompt plus generated tokens currently held in KV for a sequence.'},
    {term:'Little\'s law',def:'L = λW for a stable system: average items in system = arrival rate × average time in system.'}
  ],
  mistakes:[
    'Using attention heads instead of KV heads.',
    'Assuming all sequences are at max length (or none are).',
    'Ignoring the engine memory fraction.',
    'Claiming Little\'s law tells you GPU concurrency at peak.'
  ],
  related:['v1-kv-cache','v2-capacity-planning','v1-gpu-memory']
},
{
  id:'inf-08', chapter:'v3-ch-inference', difficulty:3,
  title:'When is disaggregated prefill/decode worth it?',
  understand:'Architect-level. They want the motivation (prefill/decode interference, different hardware needs, independent scaling), the cost (KV transfer bandwidth and complexity), the numbers to decide, and current implementations.',
  short:'Prefill is compute-heavy and bursty; decode is bandwidth-heavy and steady. On the same GPU they interfere: a big prefill stretches the step and every decoding user sees a stall. Disaggregation runs them on separate worker pools: prefill workers compute the KV cache and transfer it to decode workers, which generate. You can then scale and tune each pool for its own SLO, TTFT on prefill and inter-token latency on decode. The price is moving the KV: for a 70B model, a 4,000-token prompt is about 1.3 GB of KV, so you need fast links like NVLink or RDMA, plus a router and more operational complexity. I would consider it only at high load where chunked prefill is not enough to hold the ITL SLO, and prove it with a goodput-per-GPU benchmark against a co-located baseline.',
  detailed:`
<h3>Why</h3>
<ul><li><b>Interference</b>: co-located, prefill chunks extend steps and raise ITL; chunked prefill reduces but does not remove this.</li>
<li><b>Different optima</b>: prefill wants compute (and maybe higher TP for long prompts), decode wants bandwidth and large batches.</li>
<li><b>Independent scaling</b>: prompt-heavy workloads (RAG, agents) need more prefill capacity than chat.</li></ul>
<p>Research: DistServe (arXiv 2401.09670) and Splitwise (arXiv 2311.18677) showed goodput gains by phase splitting.</p>
<h3>The cost: KV transfer</h3>
${formula(`
KV to move = prompt tokens × KV bytes per token
  Llama-3.1-70B, 4,000-token prompt: 4,000 × 327,680 B = 1.31 GB

Transfer time (ideal bandwidth)
  ≈ 400 GB/s class NVLink path      ≈ 3 ms
  ≈ 50 GB/s (400 Gb/s RDMA per GPU) ≈ 26 ms
  ≈ 3 GB/s (25 Gb/s TCP)            ≈ 437 ms   ← kills the benefit

Compare with prefill time of that prompt and with the TTFT budget.
`)}
<p>Transfer can be pipelined layer by layer to overlap with prefill compute; implementations use NIXL, Mooncake or similar transports with GPUDirect RDMA.</p>
<h3>Implementations (as of Oct 2026)</h3>
<ul><li><b>vLLM</b>: <code>--kv-transfer-config</code>, e.g. <code>{"kv_connector":"NixlConnector","kv_role":"kv_both"}</code>; connectors include NixlConnector, LMCacheConnectorV1, MooncakeConnector, OffloadingConnector.</li>
<li><b>SGLang</b>: <code>--disaggregation-mode prefill|decode</code> with Mooncake or NIXL transfer and a router in PD mode.</li>
<li><b>Dynamo</b>: prefill and decode workers with a <b>planner</b> that adjusts replica counts to meet TTFT and ITL SLAs.</li>
<li><b>llm-d</b>: P/D disaggregation as one of its "well-lit paths".</li></ul>
<h3>Decision checklist</h3>
${table(['Favours disaggregation','Favours co-location'],[
 ['High, steady load; strict ITL SLO','small fleet, spiky low load'],
 ['Long prompts, short outputs (RAG, agents)','short prompts, chat'],
 ['RDMA/NVLink between pools','TCP-only networking'],
 ['Team can run router + two pools','simplicity is a priority']
])}
<p>Operationally, disaggregation turns one deployment into two pools plus a router and a transfer fabric, each with its own autoscaling, health checks and failure modes. Budget for that complexity explicitly in the decision.</p>`,
  diagram:fig('Disaggregated serving', svgDiagram({w:900,h:240,
    boxes:[
      {id:'r',x:20,y:90,w:140,h:60,label:'Router',sub:'P/D aware',cls:'hl'},
      {id:'p',x:230,y:30,w:200,h:60,label:'Prefill pool',sub:'compute-bound, TTFT',cls:'v1'},
      {id:'d',x:530,y:90,w:200,h:60,label:'Decode pool',sub:'bandwidth, ITL',cls:'v2'},
      {id:'c',x:770,y:90,w:110,h:60,label:'Client',sub:'stream',cls:'ok'},
      {id:'pl',x:230,y:160,w:200,h:56,label:'Planner',sub:'scales each pool',cls:'warn'}
    ],
    arrows:[{from:'r',to:'p',label:'prompt'},{from:'p',to:'d',label:'KV via NIXL/RDMA'},{from:'d',to:'c'},{from:'pl',to:'p',cls:'dash'},{from:'pl',to:'d',cls:'dash'}]
  }), 'The KV transfer arrow is the cost; the independent pools are the benefit.'),
  followups:[
    {q:'Does disaggregation help TTFT?',a:'It can, by giving prefill dedicated capacity and avoiding decode contention, but transfer adds latency. Its main benefit is stable ITL and independent scaling; measure both.'},
    {q:'How do you size the two pools?',a:'From the token mix: prefill tokens/s demand vs measured prefill throughput per worker, and concurrent decode sequences vs per-worker capacity at the ITL SLO. Planners automate this from performance models; validate with traffic replay.'},
    {q:'What breaks when a decode worker dies?',a:'In-flight sequences lose their KV; the router must retry them (re-prefill) elsewhere. Clients see a stall or error; idempotent retries and streaming resumption policies matter.'}
  ],
  tradeoffs:`<ul><li><b>Goodput gains</b> at scale vs transfer cost and operational complexity.</li><li><b>Pool ratio</b> tuned for one workload mix can be wrong for another; needs a planner.</li></ul>`,
  failures:`<ul><li><b>TTFT worse after migration</b> → slow transfer path (TCP) → RDMA/NVLink.</li><li><b>Decode pool starved</b> → ratio wrong after traffic shift → autoscale pools separately.</li><li><b>Transfer backend mismatch</b> between versions → pin compatible versions.</li></ul>`,
  vocab:[
    {term:'Disaggregated serving',def:'Running prefill and decode on separate worker pools with KV transfer between them.'},
    {term:'KV transfer',def:'Moving computed KV blocks from a prefill worker to a decode worker.'},
    {term:'NIXL',def:'NVIDIA transfer library used for KV movement.'},
    {term:'Planner',def:'Component that scales prefill/decode workers to meet SLOs.'},
    {term:'Interference',def:'Prefill work slowing co-located decode steps.'}
  ],
  mistakes:[
    'Assuming disaggregation always wins.',
    'Ignoring KV size and link bandwidth.',
    'Running it over plain TCP between distant nodes.'
  ],
  related:['v2-distributed-inference','v1-batching','v2-hyperscale-serving']
},
{
  id:'inf-09', chapter:'v3-ch-inference', difficulty:2,
  title:'How do you benchmark an inference engine fairly?',
  understand:'They want methodology: controlled variables, realistic workloads, open-loop load, warm-up, percentiles and goodput, and cost normalisation. Bonus for knowing vllm bench serve options.',
  short:'I fix everything except the thing under test: same model weights and precision, same GPUs and driver, same engine flags where comparable. The workload must look like production: input and output length distributions sampled from real traffic, not a fixed 128-token prompt. I warm up, then sweep request rate in an open-loop pattern, recording p50, p95 and p99 TTFT and TPOT, errors, and goodput, the rate of requests that meet the SLOs. The headline is goodput per GPU or per dollar at our SLO, not peak tokens per second. I repeat runs to see variance, and I check quality too, because a faster configuration with lower precision must still pass the evaluation.',
  detailed:`
<h3>Variables to control</h3>
${table(['Category','Hold constant / record'],[
 ['Model','weights revision, tokenizer, chat template, precision/quantization'],
 ['Hardware','GPU model, count, interconnect, driver, clocks/power mode'],
 ['Engine','version, flags (token budget, max seqs, memory fraction, prefix caching, spec decode)'],
 ['Workload','input/output length distribution, prefix-sharing pattern, arrival process'],
 ['Client','same machine/network, streaming on, enough client capacity']
])}
<h3>vllm bench serve (docs, v0.31)</h3>
${code('bash',`vllm bench serve --backend openai --model <model> \\
  --dataset-name <your-dataset> --num-prompts 2000 \\
  --request-rate 8 --max-concurrency 256 \\
  --percentile-metrics ttft,tpot,itl,e2el --metric-percentiles 50,95,99 \\
  --goodput ttft:1500 tpot:30`)}
<p>Defaults to know: <code>--dataset-name random</code> with 1,024 input / 128 output tokens, <code>--request-rate inf</code> (all at once), <code>--num-prompts 1000</code>. Those defaults are useful smoke tests and terrible production proxies.</p>
<h3>Open vs closed loop</h3>
<p>Closed loop (fixed concurrency: each client waits for a response before sending the next) hides queueing because load drops when the server slows. Open loop (Poisson arrivals at a set rate) shows how latency explodes past capacity. Use both: concurrency sweeps for capacity, rate sweeps for SLO behaviour.</p>
${formula(`
Goodput per dollar
                 requests/s meeting TTFT and TPOT SLOs
  =  ──────────────────────────────────────────────────
                 GPU cost per second of the deployment
`)}
<p>The lab <code>labs/05-serving/bench_client.py</code> measures TTFT, TPOT, E2E and goodput against any OpenAI-compatible endpoint, including the mock server, so you can practise the method on a laptop.</p>
<h3>What a good benchmark report contains</h3><ul><li>Configuration block: model revision, precision, engine version and flags, GPU type and count, driver, date.</li><li>Workload block: dataset source, input/output length histograms, prefix-sharing ratio, arrival process.</li><li>Results: a table per request rate with p50/p95/p99 TTFT, TPOT and ITL, error rate, output tokens per second, and goodput at the SLO.</li><li>The knee: the highest rate meeting the SLO, and cost per million output tokens at that rate.</li><li>Quality: eval score for the configuration, so faster-but-worse options are visible.</li><li>Caveats: anything not representative (synthetic data, single run, cold node).</li></ul><p>Keep the raw results and the exact command so anyone can re-run it after an engine upgrade.</p>`,
  diagram:fig('Latency vs offered load: find the knee', svgDiagram({w:900,h:220,
    boxes:[
      {id:'a',x:20,y:80,w:200,h:60,label:'Low rate',sub:'flat latency',cls:'ok'},
      {id:'b',x:260,y:80,w:200,h:60,label:'Near capacity',sub:'p99 rises first',cls:'warn'},
      {id:'c',x:500,y:80,w:200,h:60,label:'Past capacity',sub:'queue grows unbounded',cls:'bad'},
      {id:'g',x:740,y:80,w:140,h:60,label:'Goodput',sub:'max rate in SLO',cls:'hl'}
    ],
    arrows:[{from:'a',to:'b'},{from:'b',to:'c'},{from:'b',to:'g',cls:'dash'}]
  }), 'Report the highest rate that still meets the SLO, not the throughput at saturation.'),
  followups:[
    {q:'Vendor claims 3× throughput. What do you ask?',a:'Which model, precision, GPUs, input/output lengths, concurrency, latency at that throughput, and whether quality was checked. Then reproduce on our workload.'},
    {q:'Why include prefix-sharing patterns in the dataset?',a:'Prefix caching can dominate performance for chat and RAG; a random-token dataset has no shared prefixes and underestimates real throughput, while a dataset with identical prompts overestimates it.'},
    {q:'How many runs?',a:'At least three per point, report variance; reboot or warm consistently; watch GPU clocks and thermals between runs.'}
  ],
  tradeoffs:`<ul><li><b>Synthetic data</b>: reproducible, shareable; <b>production samples</b>: realistic, need de-identification.</li><li><b>Short runs</b>: fast; <b>long runs</b>: catch thermal and memory effects.</li></ul>`,
  failures:`<ul><li><b>Client-bound benchmark</b> → load generator CPU saturated → distribute clients.</li><li><b>No warm-up</b> → first requests include compilation/graph capture.</li><li><b>Non-streaming client</b> → cannot measure TTFT.</li></ul>`,
  vocab:[
    {term:'Open-loop load',def:'Requests sent at a set arrival rate regardless of responses.'},
    {term:'Closed-loop load',def:'Fixed number of clients, each waiting for a response before sending again.'},
    {term:'Goodput',def:'Requests per second meeting all latency SLOs.'},
    {term:'Knee',def:'Load level where latency starts rising sharply.'},
    {term:'Warm-up',def:'Initial requests excluded from measurement.'}
  ],
  mistakes:[
    'Using default random 1,024/128 prompts as production proxy.',
    'Reporting only peak tokens/s.',
    'Comparing engines at different precisions without quality checks.',
    'Closed-loop only, hiding queueing.'
  ],
  related:['v1-benchmarking','v2-capacity-planning','v2-finops-unit-economics']
},
{
  id:'inf-10', chapter:'v3-ch-inference', difficulty:1,
  title:'What causes slow time to first token?',
  understand:'A core troubleshooting question. They want TTFT decomposed and causes matched to evidence: pre-engine latency, queueing, long prompts, prefill interference, cold starts and cache misses.',
  short:'Time to first token is everything before the first streamed token, so I break it down. Before the engine: gateway, auth, guardrails, retrieval, reranking, tool calls. In the engine: queue time while waiting for KV blocks or a batch slot, then prefill time, which grows with prompt length and gets worse if the prefix cache stops hitting. Cold starts are another cause: a new replica loading 16 or 140 GB of weights takes minutes, and requests routed to it early wait. I would trace slow requests, check the queue-time and prefill-time histograms, correlate with prompt-token counts, and look at prefix-cache hit rate. The fix depends on which slice dominates: capacity, prompt length, caching or retrieval, not a faster decode kernel.',
  detailed:`
${table(['Cause','Evidence','Fix'],[
 ['Pre-engine work','trace spans: gateway, RAG, rerank, tools','cache/parallelise retrieval, lighter guardrails'],
 ['Queueing','vllm:request_queue_time_seconds high; num_requests_waiting > 0; KV ≈ 100 %','replicas, admission control, context caps, FP8 KV'],
 ['Long prompts','TTFT correlates with prompt tokens; prefill time histogram','trim prompts, summarise history, prefix caching'],
 ['Prefix cache misses','prefix hit rate dropped','stable prompt prefixes, cache-aware routing'],
 ['Prefill behind other prefills','long prompts from other users in the same steps','chunked prefill tuning, separate long-context pool'],
 ['Cold start','new pods; weight loading; first requests slow','readiness after warm-up, pre-pulled images, faster weight loading, min replicas'],
 ['Tokenization / CPU','engine CPU saturated with huge prompts','more CPU, avoid CPU limits']
])}
${formula(`
TTFT ≈ pre-engine + queue + prefill
prefill ≈ uncached prompt tokens ÷ effective prefill rate under load
   3,000 tokens, 90 % prefix hit → 300 uncached tokens → ≈ 10× less prefill
`)}
<h3>Kubernetes specifics</h3>
<p>Readiness probes must only pass after the model is loaded and warmed (a test generation), otherwise the load balancer routes to a pod that answers slowly or fails. Autoscaling must start new replicas early because model load times are long; scale on queue depth and TTFT, not CPU.</p>
<h3>A worked triage</h3><p>Suppose p95 TTFT rose from 0.9 s to 2.6 s overnight. Step one: compare the TTFT histogram with the queue-time histogram; if queue time explains most of the increase, capacity or admission is the issue. Step two: plot TTFT against prompt tokens; if long prompts dominate the tail, a new tenant or prompt template likely added length. Step three: check prefix hit rate; a drop means prefill work per request rose. Step four: check pre-engine spans; a slow retrieval dependency shows up there and nowhere in engine metrics. Step five: check replica ages and readiness timing for cold starts after a deploy or scale-out. Each step either explains the increase or is ruled out in minutes with existing metrics.</p>`,
  diagram:fig('TTFT decomposition', svgDiagram({w:900,h:180,
    boxes:[
      {id:'a',x:20,y:60,w:190,h:60,label:'Pre-engine',sub:'gateway, RAG, tools',cls:'v1'},
      {id:'b',x:230,y:60,w:190,h:60,label:'Queue',sub:'KV / slots',cls:'warn'},
      {id:'c',x:440,y:60,w:190,h:60,label:'Prefill',sub:'uncached tokens',cls:'hl'},
      {id:'d',x:650,y:60,w:230,h:60,label:'First token streamed',cls:'ok'}
    ],
    arrows:[{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'d'}]
  }), 'Measure each slice; fix the biggest.'),
  followups:[
    {q:'TTFT is fine at p50 but awful at p99. Typical cause?',a:'A tail of very long prompts or bursts that queue; sometimes cold replicas. Break down p99 requests by prompt length and replica age.'},
    {q:'How do you make cold starts less painful?',a:'Keep warm minimum replicas, pre-pull images, load weights from fast local NVMe or a node cache, and gate readiness on a warm-up request.'},
    {q:'Can prefix caching make TTFT worse?',a:'Rarely directly; but cache-affinity routing without load awareness can concentrate traffic and increase queueing on hot replicas.'}
  ],
  tradeoffs:`<ul><li><b>More replicas</b> cut queueing but cost GPUs.</li><li><b>Prompt trimming</b> cuts prefill but may hurt quality.</li></ul>`,
  failures:`<ul><li><b>Retrieval regression</b> doubles TTFT → trace.</li><li><b>Prompt template change</b> kills prefix hits → monitor hit rate.</li><li><b>Readiness too early</b> → errors after scale-out.</li></ul>`,
  vocab:[
    {term:'Queue time',def:'Time a request waits in the engine before scheduling.'},
    {term:'Cold start',def:'Delay while a new replica loads weights and warms up.'},
    {term:'Readiness probe',def:'Kubernetes check gating traffic until the pod can serve.'},
    {term:'Prefix hit rate',def:'Share of prompt tokens served from cached KV.'}
  ],
  mistakes:[
    'Confusing TTFT with full response latency.',
    'Fixing decode speed for a TTFT problem.',
    'Ignoring time spent before the engine.'
  ],
  related:['v1-inference-anatomy','v1-k8s-serving','v1-k8s-autoscaling','v2-prefix-kv-cache']
},
{
  id:'inf-11', chapter:'v3-ch-inference', difficulty:3,
  title:'Two GPUs: one replica with TP=2, or two replicas with TP=1?',
  understand:'Architect-level trade-off. They want latency vs throughput reasoning, KV pool arithmetic, communication overhead, failure domains, and the decision driven by SLO and model size.',
  short:'If the model fits comfortably on one GPU, two independent replicas usually give more total throughput and better fault isolation: no inter-GPU communication, and losing one GPU halves capacity instead of taking the replica down. TP=2 halves the weight bytes each GPU reads per step, so per-token latency drops, nearly halving TPOT in the ideal memory-bound case minus all-reduce overhead, and it creates a bigger single KV pool, which helps long contexts. For Llama-3.1-8B on H100s, TP=2 gives one pool of about 123 GB versus two pools of about 53 GB each. So: strict TPOT SLO or long contexts, choose TP; throughput and resilience, choose replicas. And if the model does not fit on one GPU, TP is not optional.',
  detailed:`
${formula(`
Llama-3.1-8B BF16, H100 80 GB, vLLM 0.92, reserve 4 GB per GPU (illustrative)

Option A: two TP=1 replicas
  KV per replica = 73.6 − 16.1 − 4      = 53.5 GB   (≈ 408k tokens each)
  decode floor   = 16.1 GB / 3.35 TB/s  ≈ 4.8 ms/token

Option B: one TP=2 replica
  KV pool        = 147.2 − 16.1 − 8     = 123.1 GB  (≈ 939k tokens, one pool)
  decode floor   = 8.05 GB / 3.35 TB/s  ≈ 2.4 ms/token + 2 all-reduces × 32 layers
                                                        (NVLink: sub-millisecond)
`)}
<p>Option B's single pool is larger than A's two pools combined (123 GB vs 107 GB) because weights are stored once. That matters for very long contexts: a 600k-token sequence fits only in B.</p>
${table(['Criterion','Two replicas (TP=1)','One replica (TP=2)'],[
 ['Per-token latency','higher (≈ 4.8 ms floor)','lower (≈ 2.4 ms floor + comms)'],
 ['Total throughput','usually higher (no comms, two schedulers)','lower to similar'],
 ['Max context per sequence','limited by one GPU\'s pool','larger'],
 ['Failure domain','one GPU failure = half capacity','one GPU failure = replica down'],
 ['Rollouts','rolling, one at a time','all-or-nothing per replica'],
 ['Requirement','model fits one GPU','NVLink between the GPUs']
])}
<h3>Decision</h3>
<p>Benchmark both at the target request mix: if both meet the SLO, choose replicas (throughput, simplicity, resilience). Choose TP when the TPOT SLO cannot be met otherwise, when contexts need the bigger pool, or when the model needs it to fit. For 70B-class models, compare TP=4 × 2 replicas against TP=8 × 1 on an 8-GPU node with the same logic.</p>
<p>Interview framing: "If it fits on one GPU and both meet the SLO, I take replicas for throughput and blast radius; I take TP when the latency SLO or context length demands it." Then give the KV pool numbers to show you did the maths.</p>`,
  diagram:fig('Same two GPUs, two layouts', svgDiagram({w:900,h:220,
    zones:[{x:10,y:20,w:420,h:180,label:'Option A: 2 × TP=1'},{x:470,y:20,w:420,h:180,label:'Option B: 1 × TP=2'}],
    boxes:[
      {id:'a1',x:30,y:70,w:180,h:80,label:'Replica 1',sub:'full weights, KV 53.5 GB',cls:'v1'},
      {id:'a2',x:230,y:70,w:180,h:80,label:'Replica 2',sub:'full weights, KV 53.5 GB',cls:'v1'},
      {id:'b1',x:490,y:70,w:180,h:80,label:'Shard 1',sub:'½ weights + ½ KV heads',cls:'v2'},
      {id:'b2',x:690,y:70,w:180,h:80,label:'Shard 2',sub:'½ weights + ½ KV heads',cls:'v2'}
    ],
    arrows:[{from:'b1',to:'b2',both:true,label:'all-reduce ×64/step'}]
  }), 'Replicas multiply throughput and isolate failures; TP lowers latency and enlarges the KV pool.'),
  followups:[
    {q:'Can you mix: data parallel inside vLLM?',a:'vLLM has --data-parallel-size; data-parallel replicas inside one engine deployment are mainly used for MoE models with expert parallelism. For dense models, separate replicas behind a router are simpler.'},
    {q:'What about pipeline parallelism for serving?',a:'PP splits layers across GPUs with point-to-point transfers; it tolerates slower links (useful across nodes) but adds latency per token through the pipeline and bubbles at low batch.'},
    {q:'Your TP=2 replica\'s TPOT is not 2× better. Why?',a:'All-reduce overhead, KV reads not halved per sequence relative to compute, small-batch launch overhead, and attention not perfectly split. Measure with Nsight Systems to see NCCL time per step.'}
  ],
  tradeoffs:`<ul><li><b>TP</b>: latency and context size vs communication and blast radius.</li><li><b>Replicas</b>: throughput and resilience vs duplicated weights.</li></ul>`,
  failures:`<ul><li><b>TP across PCIe-only GPUs</b> → slow → prefer replicas on such nodes.</li><li><b>One GPU fails in TP replica</b> → whole replica down → enough replicas for N+1.</li></ul>`,
  vocab:[
    {term:'Tensor parallelism',def:'Splitting layer weights across GPUs with per-layer all-reduces.'},
    {term:'Replica',def:'An independent copy of the model serving traffic.'},
    {term:'Blast radius',def:'Capacity lost when one component fails.'},
    {term:'Pipeline parallelism',def:'Splitting layers into stages across GPUs.'}
  ],
  mistakes:[
    'Assuming TP always increases throughput.',
    'Ignoring that TP enlarges the per-replica KV pool.',
    'Forgetting failure-domain differences.'
  ],
  related:['v2-parallelism','v2-distributed-inference','v1-k8s-serving']
},
{
  id:'inf-12', chapter:'v3-ch-inference', difficulty:3,
  title:'We have 30 fine-tuned variants. How do you serve them: multi-LoRA or merged models?',
  understand:'Architect-level multi-tenant serving. They want memory arithmetic, batching implications, routing, rollout and isolation concerns, and when merged models still win.',
  short:'If the variants are LoRA adapters on the same base, I would serve them with multi-LoRA: one copy of the base model in GPU memory and adapters applied per request. Thirty merged copies of an 8B model would be 480 GB of weights; thirty adapters of tens of megabytes each are a couple of gigabytes on one base. vLLM supports this with enable-lora, and max-loras sets how many adapters can be active in a batch, default one, so I would raise it within memory. There is some per-token overhead and batches with many different adapters are less efficient, so I route requests for the same adapter to the same replicas, with LoRA-aware routing such as the inference gateway endpoint picker. Merged models still win for a very high-traffic variant with a strict latency SLO, or adapters on different bases.',
  detailed:`
${formula(`
Merged copies : 30 × 8.03 × 10⁹ × 2 B ≈ 482 GB of weights → ≥ 7 H100s just for weights
Multi-LoRA    : 1 base 16.1 GB + 30 adapters × ≈ 84 MB (r=16, all linear) ≈ 18.6 GB
`)}
<h3>How multi-LoRA serving works</h3>
<ul><li>The base model weights are shared; each request names an adapter (often as the model name in the OpenAI API).</li>
<li>Adapters are loaded into GPU (or CPU) slots; for each step the engine applies the right low-rank update per request, using batched LoRA kernels so mixed-adapter batches still run together.</li>
<li>vLLM flags (v0.31 docs): <code>--enable-lora</code>, <code>--max-loras</code> (default 1: adapters active in one batch); other limits such as maximum rank exist and should be checked against your adapters.</li>
<li>Cost: extra compute per adapted layer and some kernel inefficiency with many distinct adapters per batch.</li></ul>
<h3>Routing and operations</h3>
${table(['Concern','Approach'],[
 ['Adapter locality','route by adapter to a subset of replicas (LoRA-aware endpoint picker in Gateway API Inference Extension / llm-d considers LoRA availability)'],
 ['Hot tenants','dedicate replicas or merge their adapter into a dedicated deployment'],
 ['Rollout','version adapters in a registry; canary by routing a share of a tenant\'s traffic to adapter v2'],
 ['Isolation','adapters must be from trusted pipelines; validate base-model hash; scan artefacts'],
 ['Chargeback','meter tokens per adapter/tenant at the gateway'],
 ['Cache','prefix caching keys include the LoRA id, so prefixes are not shared across adapters']
])}
<h3>When merged wins</h3>
<p>A single variant with most of the traffic and a tight TPOT SLO; adapters trained on different base models or revisions; full fine-tunes (not LoRA) that cannot be represented as adapters.</p>
<p>Interview framing: give the memory arithmetic first (one base plus small adapters versus N full copies), then the operational plan: adapter registry, LoRA-aware routing, per-tenant metering, and the exception for hot variants.</p>`,
  diagram:fig('One base, many adapters', svgDiagram({w:900,h:220,
    boxes:[
      {id:'g',x:20,y:80,w:150,h:60,label:'Gateway',sub:'tenant → adapter',cls:'v1'},
      {id:'r',x:200,y:80,w:160,h:60,label:'LoRA-aware router',cls:'hl'},
      {id:'b',x:420,y:30,w:240,h:60,label:'Replica A: base + adapters 1–10',cls:'v2'},
      {id:'c',x:420,y:130,w:240,h:60,label:'Replica B: base + adapters 11–30',cls:'v2'},
      {id:'reg',x:720,y:80,w:160,h:60,label:'Adapter registry',sub:'versioned',cls:'warn'}
    ],
    arrows:[{from:'g',to:'r'},{from:'r',to:'b'},{from:'r',to:'c'},{from:'reg',to:'b',cls:'dash'},{from:'reg',to:'c',cls:'dash'}]
  }), 'Group adapters on replicas so batches stay homogeneous and adapters stay resident.'),
  followups:[
    {q:'Does prefix caching work across adapters?',a:'No: the LoRA id is part of the block hash (vLLM APC design), because the same tokens produce different KV under different adapters. Shared system prompts are cached per adapter.'},
    {q:'How do you roll back a bad adapter?',a:'Point the tenant\'s model alias back to the previous adapter version in the registry/gateway; the base stays untouched, so rollback is instant and isolated.'},
    {q:'A tenant uploads their own adapter. Risks?',a:'Untrusted artefacts (pickle-based formats can execute code; prefer safetensors), adapters trained to produce harmful output, and resource abuse via huge ranks. Validate format, base hash, rank limits and run safety evals before activation.'}
  ],
  tradeoffs:`<ul><li><b>Multi-LoRA</b>: huge memory savings and fast rollout vs per-token overhead and routing complexity.</li><li><b>Merged</b>: best latency per variant vs N× memory and slower rollout.</li></ul>`,
  failures:`<ul><li><b>Latency spikes when many adapters mix in one batch</b> → route by adapter.</li><li><b>Requests queue for adapter slots</b> → max-loras too low.</li><li><b>Adapter on wrong base revision</b> → quality collapse → hash check at load.</li></ul>`,
  vocab:[
    {term:'Multi-LoRA serving',def:'Serving many LoRA adapters on one shared base model.'},
    {term:'max-loras',def:'vLLM setting for adapters active in a batch (default 1).'},
    {term:'Adapter registry',def:'Versioned store of adapters with metadata (base hash, rank, owner).'},
    {term:'LoRA-aware routing',def:'Sending requests to replicas that already have the adapter loaded.'}
  ],
  mistakes:[
    'Merging every variant and multiplying GPU memory.',
    'Leaving max-loras at 1 for a multi-tenant deployment.',
    'Expecting prefix cache hits across adapters.',
    'Accepting tenant adapters without validation.'
  ],
  related:['v1-finetuning','v1-engines','v2-ai-gateway','v2-governance']
}
]);
