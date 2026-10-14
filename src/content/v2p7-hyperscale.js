/* Volume 2, Part 7: Hyperscale — capacity planning, hyperscale serving, multi-region */

registerLesson({
  id:'v2-capacity-planning', vol:2, part:7, num:1,
  title:'Capacity planning: users → requests → tokens → GPUs', minutes:95,
  summary:'Capacity planning for AI turns a business number, such as ten million daily users, into a number of GPUs you can defend. You go from users to requests, to the busiest second, to input and output tokens, to how many requests are in flight at once, to memory for the KV cache, and finally to replicas sized from a measured load test that respects your latency targets. Then you add room for failures and for losing a whole region. Every step has an assumption, and every assumption must be written down and later replaced with a measurement.',
  objectives:[
    'Convert DAU into mean and peak requests per second and into input and output tokens per second, stating every assumption.',
    'Apply Little’s law correctly (stable systems only) to estimate in-flight requests and check KV-cache memory per replica.',
    'Size replicas from measured SLO goodput that includes both prefill and decode, then add N+1 and region-loss headroom.',
    'Size a 70B model: weights per tensor-parallel group, KV per sequence, and maximum concurrency on H100 and H200.',
    'Explain with queueing intuition why utilization near 100 % destroys latency, and how pooling changes that.',
    'Show how the GPU count moves when prompt length, output length, cache hit rate or model size change.'
  ],
  prereqs:['v1-kv-cache','v1-batching','v1-benchmarking','v1-k8s-autoscaling'],
  next:['v2-hyperscale-serving','v2-multi-region','v2-finops-unit-economics'],
  tags:['capacity','hyperscale','gpu','finops','queueing'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A stadium caterer does not plan food from the number of season-ticket holders. They plan from how many people arrive in the 20 minutes before kick-off, what each person orders, and how long each order takes at the counter. AI capacity planning is the same chain, except the "order" is measured in tokens and the "counter" is a GPU whose speed depends on how many orders it is serving at once.')}
<p>${term('Capacity planning')} for AI inference is the arithmetic chain that turns a product forecast into hardware:</p>
${chain(['DAU','requests/day','mean RPS','peak RPS','input + output tokens/s','in-flight requests','KV memory','replicas (measured goodput)','GPUs + headroom'])}
<p>The output is not a single number. It is a <b>model</b>: a short spreadsheet (or the planned script <code>labs/11-capacity/capacity.py</code>) where every input is labelled as an assumption or a measurement, so when the product team changes the prompt or the model you can recompute in minutes.</p>

<h2>2. Why do we need it?</h2>
<ul>
<li><b>GPUs are slow to obtain.</b> CPU pods scale in seconds. GPU nodes take minutes to provision and minutes more to load weights, and in a busy region the capacity may simply not exist. You must decide ahead of time how much to hold.</li>
<li><b>GPUs are expensive to hold idle.</b> One H100 at a published on-demand list price of $3.99/GPU-hour (Lambda, 8-GPU instances, Oct 2026) is about $2,913 per month. A plan that is 2× too big wastes millions per year at fleet scale; a plan that is 2× too small breaks the SLO at every peak.</li>
<li><b>AI load is not "requests per second".</b> A request with 8,000 prompt tokens and 1,000 output tokens costs maybe 20× a request with 300 and 50. Two products with identical RPS can need very different fleets.</li>
<li><b>Interviews test exactly this.</b> "Design for 10 million users" is the most common AI-infrastructure system-design question (${L('v3-prove-10m','Prove it 3')}). The strong answer is a method with explicit assumptions, not a memorised number.</li>
</ul>

<h2>3. How does it work internally?</h2>
<h3>3.1 The full chain with the formulas</h3>
${formula(`
requests/day      = DAU × requests per active user per day
mean RPS          = requests/day ÷ 86,400
peak RPS          = mean RPS × peak factor          (measure it: busiest hour, then burst within the hour)
input tokens/s    = peak RPS × mean input tokens per request
uncached prefill  = input tokens/s × (1 − prefix-cache hit rate)
output tokens/s   = peak RPS × mean output tokens per request

in-flight L       = λ × W                            (Little's law, stable system only)
                    ↑ arrival rate   ↑ mean time a request spends in the system

KV per sequence   = resident tokens × 2 × layers × kv_heads × head_dim × bytes

replicas          = peak RPS ÷ measured SLO goodput per replica
GPUs              = replicas × GPUs per replica × (1 + failure reserve) × region factor
`)}
<p>Three terms deserve precision:</p>
<ul>
<li>${term('Peak factor')}: the ratio of design peak to mean. It is a <i>measurement</i> from your traffic history (gateway logs, CDN logs), not a constant. Travel traffic in the GCC has strong daily and seasonal shape (evening peaks, Ramadan evenings, holiday booking windows), so measure per season.</li>
<li>${term('Goodput')}: the request rate a replica sustains <i>while meeting the SLO</i> (for example p95 TTFT ≤ 1 s and p95 TPOT ≤ 50 ms), with your real distribution of input and output lengths. It is lower than raw throughput, often much lower. See ${L('v1-benchmarking','benchmarking')}.</li>
<li>${term('Little’s law')}: L = λW, the long-run average number of items in a system equals the arrival rate times the average time each spends inside. It holds only when the system is <b>stable</b> (arrivals do not exceed capacity over time). It tells you how many requests are in flight, not how many are on the GPU at once, and nothing about the latency distribution.</li>
</ul>

<h3>3.2 Full worked example: 10 million DAU (all inputs illustrative)</h3>
<p>The fictional Atlas assistant (the course capstone) is planning for 10 million DAU. Every input below is labelled. In a real plan each one has an owner and a source.</p>
${table(['Input','Value','Type','Where the real value comes from'],[
 ['DAU','10,000,000','assumption (product forecast)','product analytics'],
 ['Requests per DAU per day','8','assumption','gateway logs of a pilot'],
 ['Share of daily traffic in busiest hour','9 %','assumption','gateway logs, per season'],
 ['Burst factor within the busiest hour','1.5×','assumption','p99 of 1-minute rates in that hour'],
 ['Mean input tokens / request','1,200 (system 500, history 500, user + retrieved 200)','assumption','tokenizer on logged prompts'],
 ['Mean output tokens / request','250','assumption','engine metrics'],
 ['Prefix-cache hit rate (share of input tokens)','40 %','assumption','<code>vllm:prefix_cache_hits</code> ÷ <code>vllm:prefix_cache_queries</code>'],
 ['SLO','p95 TTFT ≤ 1 s, p95 TPOT ≤ 50 ms (mean ≈ 40 ms)','decision','product + SRE'],
 ['Model','8B dense, GQA (Llama-3.1-8B shape), BF16','decision','model selection'],
 ['Goodput per H100 replica at that mix and SLO','12.4 req/s','<b>must be measured</b>','load test (see 3.3)']
])}
${formula(`
STEP 1  requests/day  = 10,000,000 × 8                      = 80,000,000
STEP 2  mean RPS      = 80,000,000 ÷ 86,400                 ≈ 926 req/s
STEP 3  peak-hour RPS = 80,000,000 × 0.09 ÷ 3,600           = 2,000 req/s
        design peak   = 2,000 × 1.5                         = 3,000 req/s
                                                              ↑ 3.24 × the mean
STEP 4  input tokens/s       = 3,000 × 1,200                = 3,600,000 tok/s
        uncached prefill     = 3,600,000 × (1 − 0.40)       = 2,160,000 tok/s
        output tokens/s      = 3,000 × 250                  =   750,000 tok/s

STEP 5  time in system  W = TTFT + output × TPOT
                          = 0.4 s + 250 × 0.040 s           = 10.4 s
        in-flight       L = λ × W = 3,000 × 10.4            = 31,200 requests

STEP 6  resident tokens per in-flight sequence ≈ 1,200 + 250 ÷ 2 = 1,325
        KV per token (8B shape) = 2 × 32 × 8 × 128 × 2 B   = 128 KiB
        KV per sequence         = 1,325 × 128 KiB           ≈ 0.16 GiB
        fleet KV                = 31,200 × 0.16 GiB         ≈ 5,046 GiB ≈ 4.9 TiB

STEP 7  replicas = 3,000 ÷ 12.4 (measured goodput)          = 241.9 → 242 H100
STEP 8  KV check per replica: in flight = 31,200 ÷ 242      ≈ 129 sequences
                              KV needed = 129 × 0.16 GiB    ≈ 21 GiB
                              KV budget = 0.92 × 80 GB − 16 GB weights − 4 GB activations
                                        = 53.6 GB           ≈ 49.9 GiB      → fits (latency-bound, not KV-bound)
STEP 9  failure reserve 10 %: ⌈242 × 1.10⌉                  = 267 replicas per serving region
STEP 10 survive one region loss, 2 active-active regions:  2 × 267 = 534 GPUs (67 nodes × 8)
        or 3 regions each carrying half the peak:           3 × 134 = 402 GPUs

ANSWER  ≈ 400–540 H100-class GPUs, depending on the region strategy.
        Average utilization of 534 GPUs at mean load: (926 ÷ 12.4) ÷ 534 = 74.5 ÷ 534 ≈ 14 %
                                                       ↑ this is the FinOps problem of Part 9
`)}
${anim('v2-cap-funnel')}
${callout('note','Why vLLM’s 0.92 in the KV budget','Recent vLLM releases default <code>--gpu-memory-utilization</code> to 0.92 (it was 0.9 in older releases). Activations and CUDA graph memory (4 GB here) are an assumption: read the real KV capacity from the engine’s startup log for your version.')}

<h3>3.3 Where 12.4 req/s comes from: measured goodput, prefill AND decode</h3>
<p>The one number you cannot calculate is per-replica goodput. You measure it with a load generator that replays your real length distribution (for example <code>vllm bench serve</code> with <code>--goodput ttft:1000 tpot:50</code>, or the planned lab <code>labs/05-serving/bench_client.py</code>), sweeping request rate until the SLO breaks. The highest rate that still meets it is the goodput.</p>
<p>To understand <i>why</i> the answer moves when the workload changes, use a simple two-cost model of one replica, calibrated from two measurements:</p>
${formula(`
replica-seconds per request   c = uncached prompt tokens ÷ P  +  output tokens ÷ D
                                  ↑ prefill capacity              ↑ decode capacity at the
                                    (tok/s, prefill only)           SLO's TPOT (tok/s)
goodput per replica           g = 1 ÷ c

Illustrative calibration for the 8B model on one H100 (MEASURE YOURS):
   P = 40,000 prefill tok/s      D = 4,000 decode tok/s at TPOT ≈ 40 ms

Baseline request: 720 uncached prompt tokens, 250 output tokens
   c = 720 ÷ 40,000 + 250 ÷ 4,000 = 0.018 + 0.0625 = 0.0805 s
   g = 1 ÷ 0.0805               ≈ 12.4 req/s
       ↑ 22 % of replica time is prefill, 78 % decode
`)}
<p>The old shortcut divides output tokens by a throughput figure: 750,000 ÷ 6,000 tok/s (a peak number at unlimited concurrency) = 125 GPUs. It is wrong three ways: it ignores prefill (22 % of the work here, far more for RAG prompts), it uses throughput at a batch size that violates the TPOT SLO, and it has no failure or region headroom. Against the 534 above it is off by more than 4×.</p>

<h3>3.4 Sensitivity: how the answer moves</h3>
<p>Recompute STEP 7 with the cost model, everything else fixed (3,000 req/s peak, before headroom):</p>
${table(['Change','Uncached prompt / output','c (s)','Goodput (req/s)','Replicas','vs baseline'],[
 ['Baseline','720 / 250','0.0805','12.4','242','—'],
 ['Prompts double (RAG adds 1,200 tokens)','1,440 / 250','0.0985','10.2','296','+22 %'],
 ['Outputs double (longer answers)','720 / 500','0.1430','7.0','429','+77 %'],
 ['Prefix-cache hit 40 % → 0 %','1,200 / 250','0.0925','10.8','278','+15 %'],
 ['Prefix-cache hit 40 % → 80 %','240 / 250','0.0685','14.6','206','−15 %'],
 ['70B model, TP=4 on H100 (P = 12,000, D = 1,500 per replica, illustrative)','720 / 250','0.2267','4.4','680 replicas = 2,720 GPUs','≈ 11× GPUs']
])}
<p>Lessons: output length is the most expensive dimension for chat (decode dominates); prompt length matters more for RAG and agents; caching shared prefixes is a cheap lever; model size is the biggest lever of all. The table is why product decisions such as "let the assistant be more verbose" are capacity decisions.</p>

<h3>3.5 Worked example: sizing a 70B model</h3>
<p>Shape: Llama-3.1-70B (80 layers, 64 attention heads, 8 KV heads, head_dim 128, 70.6 B parameters). See ${L('v1-kv-cache','the KV cache lesson')} for the per-token formula.</p>
${formula(`
STEP 1  weights, BF16   = 70.6 × 10⁹ × 2 B = 141.2 GB   → cannot fit one 80 GB GPU
STEP 2  tensor parallel TP = 4 on H100 80 GB
        weights per GPU = 141.2 ÷ 4               = 35.3 GB
        usable per GPU  = 0.92 × 80               = 73.6 GB
        KV per GPU      = 73.6 − 35.3 − 4 (act.)  = 34.3 GB
        KV per TP group = 4 × 34.3                = 137.2 GB ≈ 127.8 GiB
STEP 3  KV per token    = 2 × 80 × 8 × 128 × 2 B  = 320 KiB   (sharded: 2 KV heads per GPU)
        per sequence:   4,096 tokens  → 1.25 GiB
                        8,192 tokens  → 2.5 GiB
                       32,768 tokens  → 10 GiB
STEP 4  max concurrent sequences per TP-4 replica
                        4k: ⌊127.8 ÷ 1.25⌋ = 102
                        8k: ⌊127.8 ÷ 2.5 ⌋ =  51
                       32k: ⌊127.8 ÷ 10  ⌋ =  12
`)}
${table(['Configuration','Weights / GPU','KV pool per replica','Max seqs @4k','@8k','@32k'],[
 ['H100 ×4 (TP4), BF16 weights + BF16 KV','35.3 GB','127.8 GiB','102','51','12'],
 ['H100 ×2 (TP2), FP8 weights + FP8 KV (160 KiB/token)','35.3 GB','63.9 GiB','102','51','12'],
 ['H200 141 GB ×2 (TP2), BF16','70.6 GB','102.7 GiB','82','41','10'],
 ['H100 ×8 (TP8), BF16','17.65 GB','387.1 GiB','309','154','38']
])}
<p>Read the table as an architect: FP8 halves the GPUs per replica at the same concurrency (validate quality on your eval set first); H200 lets 70B BF16 fit on two GPUs; and at 32k context even a TP-8 replica holds only 38 sequences, so long-context traffic usually gets its own pool. Compare with the 8B model, which needed 129 in-flight sequences per GPU at the SLO: a 70B replica at 8k context is <b>KV-bound</b> long before it is compute-bound, so its goodput must be measured at your real length distribution.</p>
${callout('warn','KV ceiling ≠ goodput','The maximum number of sequences that fit in memory is an upper bound. The SLO usually binds first, because TPOT rises as the batch grows. Plan with measured goodput; use the KV ceiling only to detect configurations that cannot work at all.')}

<h3>3.6 Queueing intuition: utilization versus wait</h3>
<p>Why not run each replica at 100 % of its goodput? Because random arrivals queue. For the simplest model, one server with random (Poisson) arrivals and random service times (M/M/1), the mean wait in queue is ρ ÷ (1 − ρ) service times, where ρ is utilization:</p>
${formula(`
                 ρ
   W_queue  = ─────── × service time
               1 − ρ

   ρ = 0.50 → 1 ×      ρ = 0.80 → 4 ×      ρ = 0.90 → 9 ×
   ρ = 0.95 → 19 ×     ρ = 0.99 → 99 ×     ρ ≥ 1 → no steady state (queue grows forever)
`)}
<p>With c servers sharing one queue (M/M/c, the Erlang C formula) the curve moves right: at ρ = 0.9, 8 pooled servers give a mean wait of about 0.88 service times and 64 pooled servers about 0.05, against 9 for a single server. That is ${term('statistical multiplexing')}: big shared pools tolerate higher utilization than many small dedicated ones.</p>
${anim('v2-cap-queue')}
${table(['Utilization ρ','M/M/1 wait (× service)','M/M/8 P(wait)','M/M/8 wait (× service)','M/M/64 wait (× service)'],[
 ['0.50','1.0','0.06','0.015','≈ 0'],
 ['0.70','2.33','0.27','0.11','≈ 0'],
 ['0.80','4.0','0.46','0.29','0.004'],
 ['0.90','9.0','0.70','0.88','0.05'],
 ['0.95','19.0','0.84','2.11','0.18'],
 ['0.99','99.0','0.97','12.1','1.42']
])}
${callout('devops','DevOps bridge — and where it breaks','This is the same reason you never run a database connection pool or a Kafka consumer group at 100 %. Where the analogy breaks: an LLM replica is not a fixed-rate server. Continuous batching makes it serve more requests per second as load rises, while each request gets slower (TPOT grows with batch size). So the real "knee" is found by a rate sweep, not by Erlang C. The planned lab <code>labs/11-capacity/queue_sim.py</code> lets you see the curve; the benchmark finds your real knee.')}

<h2>4. Where does it fit?</h2>
${fig('Where capacity numbers come from and who uses them', svgDiagram({w:900,h:330,
 boxes:[
  {id:'prod',x:20,y:30,w:170,h:56,label:'Product forecast',sub:'DAU, features'},
  {id:'logs',x:20,y:130,w:170,h:56,label:'Gateway logs',sub:'RPS, token histograms'},
  {id:'bench',x:20,y:230,w:170,h:56,label:'Load tests',sub:'goodput at SLO'},
  {id:'model',x:300,y:130,w:200,h:56,label:'Capacity model',sub:'labelled assumptions',cls:'hl'},
  {id:'fin',x:620,y:30,w:250,h:56,label:'FinOps / procurement',sub:'reservations, budget'},
  {id:'k8s',x:620,y:130,w:250,h:56,label:'Cluster config',sub:'node pools, min replicas, quotas'},
  {id:'slo',x:620,y:230,w:250,h:56,label:'SRE',sub:'alerts when reality ≠ model'}
 ],
 arrows:[{from:'prod',to:'model'},{from:'logs',to:'model'},{from:'bench',to:'model'},{from:'model',to:'fin'},{from:'model',to:'k8s'},{from:'model',to:'slo'},{from:'slo',to:'logs',cls:'dash',label:'recalibrate',fromSide:'bottom',toSide:'bottom'}]
}), 'The capacity model is the hub. Inputs are forecasts, logs and benchmarks; outputs are purchase commitments, cluster settings and alert thresholds. Production telemetry continuously recalibrates it.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Gateway</b> (${L('v2-ai-gateway','AI gateway')}): source of truth for RPS, token histograms per tenant and model, and the place where quotas keep real load inside the plan.</li>
<li><b>Engine metrics</b>: <code>vllm:num_requests_running</code>, <code>vllm:num_requests_waiting</code>, <code>vllm:kv_cache_usage_perc</code>, <code>vllm:prompt_tokens_total</code>, <code>vllm:generation_tokens_total</code> validate per-replica assumptions in production.</li>
<li><b>Caching</b> (${L('v2-prefix-kv-cache','prefix caching')}): the hit rate is a direct input; a cache regression is a capacity incident.</li>
<li><b>Autoscaling</b> (${L('v2-hyperscale-serving','next lesson')}): the plan sets min/max replicas and the warm pool; the autoscaler moves within them.</li>
<li><b>Multi-region</b> (${L('v2-multi-region','multi-region')}): sets the region factor and the brownout plan.</li>
<li><b>FinOps</b> (${L('v2-finops-unit-economics','unit economics')}): turns GPUs into dollars and exposes the 14 % utilization problem.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${checklist([
 {key:'cap-1',text:'Own the capacity model as code (versioned, reviewed), with each input labelled assumption / measurement and an owner.'},
 {key:'cap-2',text:'Collect token histograms (p50/p95/p99 input and output) per model, tenant and feature from the gateway.'},
 {key:'cap-3',text:'Run goodput benchmarks for every model × GPU × engine-version combination before it serves production traffic.'},
 {key:'cap-4',text:'Set and enforce max context and max output tokens per product, because they are capacity limits.'},
 {key:'cap-5',text:'Reconcile monthly: predicted vs actual peak RPS, tokens, goodput, utilization; update the model.'},
 {key:'cap-6',text:'Keep GPU quota and reservations ahead of the forecast (quota requests take days; capacity blocks are reserved ahead).'}
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Planning error behind it','Evidence','Fix'],[
 ['p95 TTFT breaches every evening, fine at noon','Peak factor measured on a quiet season','Hourly RPS by weekday and season from gateway logs','Re-measure per season; add scheduled pre-scaling for known peaks'],
 ['GPUs at 95 % busy, throughput high, SLO broken','Planned at raw throughput, not SLO goodput','Rate sweep shows the knee below current load','Re-plan at goodput; add replicas or admission control'],
 ['Capacity fine for chat, collapses when RAG launches','Prompt length assumption stale','Input-token histogram jumped (p95 1,500 → 6,000)','Separate pool for long prompts; recompute; cache shared context'],
 ['KV usage 100 %, waiting requests > 0, TPOT normal','KV-bound configuration (long context × concurrency)','<code>vllm:kv_cache_usage_perc</code> ≈ 1 and <code>vllm:num_requests_waiting</code> &gt; 0','Lower max context, FP8 KV, more TP, or more replicas'],
 ['Plan was right, bill is 3× forecast','Region-loss headroom held 24/7 at full size','Utilization ≈ 15 % most hours','Autoscale the surplus, backfill batch work, or use 3 regions'],
 ['Cost per request doubled after a release','Output length or prefix-cache hit changed','Output-token p50 rose; prefix hit rate fell','Fix template change that broke the shared prefix; cap output']
])}
<div class="dtree"><ul><li><span class="q">The fleet misses the SLO — is it a planning problem?</span><ul>
<li><span class="a">yes</span>Peak RPS or token lengths above plan → update inputs, re-plan, enforce quotas.</li>
<li><span class="a">yes</span>Inputs as planned but goodput per replica lower than benchmarked → the benchmark mix was unrealistic or the engine version changed: re-benchmark.</li>
<li><span class="a">no</span>Inputs and goodput as planned → look for operational causes: unhealthy replicas, routing imbalance, cold caches (${L('v2-ai-observability','observability')}).</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<ol>
<li><b>Cut work per request</b>: shorter system prompts, prefix caching, output caps, retrieval instead of stuffing context.</li>
<li><b>Cut cost per unit of work</b>: smaller or distilled models for easy traffic (routing), FP8 weights and KV, speculative decoding where it helps decode.</li>
<li><b>Pool</b>: fewer, larger shared pools with cache-aware routing beat many dedicated pools (queueing table above).</li>
<li><b>Separate shapes</b>: long-context and batch traffic in their own pools so they do not set the SLO for short chat.</li>
<li><b>Disaggregate</b> prefill and decode at very large scale (${L('v2-distributed-inference','distributed inference')}), sizing each pool from its own tokens/s.</li>
</ol>

<h2>9. How do we optimize its cost?</h2>
<p>The plan above holds 534 GPUs for a mean demand of about 75. Levers, in order of usual payoff:</p>
<ul>
<li><b>Scale the surplus with the day</b>: a diurnal floor of, say, 150 GPUs with autoscaling to peak is cheaper than 534 always-on, at the price of cold-start risk (next lesson).</li>
<li><b>Choose the region strategy deliberately</b>: three regions at 50 % each (402) instead of two at 100 % (534) is 25 % fewer GPUs, if residency rules allow it.</li>
<li><b>Backfill</b>: run batch inference and evaluations in the off-peak surplus with preemptible priority.</li>
<li><b>Brownout instead of full headroom</b>: if the business accepts degraded modes during a region loss, each region can be smaller (${L('v2-multi-region','multi-region')}).</li>
<li><b>Re-run the sensitivity table quarterly</b>: a 20 % output-length reduction is a 15 % fleet reduction here.</li>
</ul>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How many GPUs do we need for 10 million daily users?”','<p><i>Answer (≈60 s):</i> "I can’t give a number without four inputs, so I’ll state assumptions and show the method. Say 8 requests per user per day: 80 million a day, about 926 per second on average. I measure the peak; if the busiest hour is 9 % of the day with a 1.5× burst, I design for 3,000 per second. With 1,200 input and 250 output tokens that’s 3.6 million input and 750 thousand output tokens per second. Then I load-test one replica with that exact length mix and find the highest rate that still meets p95 TTFT and TPOT. Say it’s 12.4 per second on one H100 for an 8B model: 242 replicas. I check KV memory per replica with Little’s law, add 10 % for failures and plan for losing a region: roughly 400 to 540 GPUs. Then I’d point out that this fleet sits around 14 % utilized on average, so the next conversation is autoscaling, backfill and brownout policy."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"10 million users at 25 tokens per second each… we need about 1,000 GPUs." Treats DAU as concurrency, ignores prefill, invents throughput, no headroom.</p></div><div class="good"><h4>Strong answer</h4><p>States assumptions, measures peak, converts to tokens, sizes from SLO goodput that includes prefill and decode, checks KV, adds N+1 and region loss, and names the utilization/cost consequence.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Token histograms','goodput benchmark','replicas','headroom policy','GPU bill'])}
${chain(['Prompt template change','prefix-cache hit rate','prefill load','replicas','cost per request'])}
<p>Next: ${L('v2-hyperscale-serving','hyperscale serving')} keeps real traffic inside this plan with admission control and autoscaling. ${L('v2-multi-region','Multi-region')} decides the region factor. ${L('v2-finops-unit-economics','FinOps')} prices it. Old-book note: the original Volume 3 workshop sized 10 M DAU from output tokens only; this lesson replaces that method.</p></div>

<h3>Lab</h3>
<p>Planned labs (see <code>labs/README.md</code>): <code>labs/11-capacity/capacity.py</code> implements the chain above with SLO goodput and headroom; <code>labs/11-capacity/kv_cache.py</code> computes KV per token, per sequence and concurrency from a model config; <code>labs/11-capacity/queue_sim.py</code> simulates utilization versus waiting time. A minimal version of the cost model you can run today:</p>
${code('python',`def replicas(peak_rps, in_tok, out_tok, hit, P, D, reserve=0.10, regions=2):
    c = in_tok * (1 - hit) / P + out_tok / D      # replica-seconds per request
    goodput = 1 / c                               # req/s per replica (calibrate by measuring!)
    base = -(-peak_rps // goodput)                # ceiling
    per_region = -(-base * (1 + reserve) // 1)
    return goodput, base, per_region * regions

print(replicas(3000, 1200, 250, 0.40, 40000, 4000))   # (12.42..., 242.0, 534.0)`)}
`,
  quiz:[
    {q:'10 M DAU × 8 requests/day. What is the mean request rate?',options:['≈ 93 req/s','≈ 926 req/s','≈ 9,259 req/s','≈ 80 M req/s'],answer:1,explain:'80,000,000 ÷ 86,400 ≈ 926. The design peak is a separate, measured multiple of this.'},
    {q:'A planner divides peak output tokens/s by a replica’s maximum output tokens/s. What is the main error?',options:['It double-counts input tokens','It ignores prefill work and uses throughput at a batch size that may violate the TPOT SLO','It uses Little’s law incorrectly','Nothing, this is the standard method'],answer:1,explain:'Output-only sizing ignores prefill (large for RAG/agents) and uses throughput instead of SLO goodput. Tempting wrong answer: Little’s law is not involved in that shortcut at all.'},
    {q:'Little’s law gives L = 3,000 × 10.4 = 31,200. What does 31,200 mean?',options:['Requests running on GPUs at once','Average requests in flight (queued or being served) in a stable system','Peak concurrent users','Maximum KV capacity'],answer:1,explain:'L counts everything inside the system boundary on average, including queued requests, and only for a stable system. It says nothing about GPU batch occupancy directly.'},
    {q:'Llama-3.1-70B on TP=4 H100 has ≈ 127.8 GiB of KV pool. How many 8,192-token sequences fit?',options:['12','51','102','400'],answer:1,explain:'8,192 × 320 KiB = 2.5 GiB per sequence; 127.8 ÷ 2.5 = 51.'},
    {q:'At ρ = 0.9, what is the M/M/1 mean queue wait in service times?',options:['0.9','1.9','9','90'],answer:2,explain:'ρ ÷ (1 − ρ) = 0.9 ÷ 0.1 = 9. Pooling 8 servers would cut it below 1.'},
    {q:'Which single change most increased replicas in the sensitivity table?',options:['Prefix hit 40 % → 0 %','Prompt length doubled','Output length doubled','Burst factor 1.5'],answer:2,explain:'Decode dominates replica time for chat (78 % at baseline), so doubling output raised replicas 77 %, more than doubling prompts (+22 %).'}
  ],
  flashcards:[
    {front:'DAU → mean RPS',back:'DAU × requests per user per day ÷ 86,400. 10 M × 8 ÷ 86,400 ≈ 926 req/s.'},
    {front:'Goodput',back:'Request (or token) rate a replica sustains while meeting the latency SLO for the real input/output length mix. Measured, never assumed.'},
    {front:'Little’s law and its condition',back:'L = λW: average items in system = arrival rate × average time in system. Only for stable systems (arrivals ≤ capacity long-run).'},
    {front:'Two-cost replica model',back:'c = uncached prompt tokens ÷ P + output tokens ÷ D; goodput = 1/c. P = prefill tok/s, D = decode tok/s at the SLO TPOT.'},
    {front:'70B KV per token (BF16, GQA 8 KV heads)',back:'2 × 80 × 8 × 128 × 2 = 320 KiB. 8k sequence = 2.5 GiB. TP4 H100 pool ≈ 128 GiB → 51 sequences.'},
    {front:'M/M/1 wait formula',back:'W_queue = ρ/(1−ρ) × service time. 0.8 → 4×, 0.9 → 9×, 0.99 → 99×.'},
    {front:'Region-loss headroom, 2 vs 3 regions',back:'2 regions each carrying 100 % of peak = 2 × N; 3 regions each 50 % = 1.5 × N. Here 534 vs 402 GPUs.'}
  ]
});

registerLesson({
  id:'v2-hyperscale-serving', vol:2, part:7, num:2,
  title:'Queueing, admission control, autoscaling signals, warm-up and cold starts', minutes:85,
  summary:'A capacity plan is a forecast; real traffic does not read forecasts. Hyperscale serving is the set of controls that keep a GPU fleet useful when demand jumps: admission control decides who gets served now, priority classes decide who waits or is turned away, backpressure tells clients to slow down, and autoscaling adds replicas, but only after a cold start of several minutes. Warm pools and model warm-up shorten that gap. Long-lived streaming connections and the gateway itself also need care at scale.',
  objectives:[
    'Design admission control with priority classes, queue deadlines and per-tenant token quotas.',
    'Explain load shedding and backpressure, and why retries without them cause collapse.',
    'Do cold-start arithmetic for node provisioning, image pull, weight download, load and warm-up.',
    'Choose autoscaling signals (queue time, waiting requests, KV usage) and explain why CPU and GPU utilization are poor signals.',
    'Identify horizontal scaling limits and design graceful handling of streaming connections.'
  ],
  prereqs:['v2-capacity-planning','v1-k8s-autoscaling','v2-ai-gateway'],
  next:['v2-multi-region','v2-ai-observability'],
  tags:['hyperscale','autoscaling','reliability','gateway'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A popular restaurant with a host at the door: the host knows how many tables are free, seats reservations first, tells walk-ins the wait, and turns people away politely when the wait would exceed an hour. Opening a second dining room (autoscaling) takes 15 minutes of setup. Now the real mechanism.')}
<p>Hyperscale serving is the control layer between "traffic arrives" and "GPU does work":</p>
<ul>
<li>${term('Admission control')}: decide, per request, to serve now, queue (with a deadline) or reject.</li>
<li><b>Priority classes</b>: an ordering of traffic (premium interactive &gt; standard interactive &gt; agent background &gt; batch) used when capacity is short.</li>
<li>${term('Load shedding')}: deliberately rejecting the lowest-value work so the rest meets its SLO.</li>
<li>${term('Backpressure')}: signalling upstream (HTTP 429 with <code>Retry-After</code>, queue-full errors, slowed consumption) so producers slow down instead of piling up work.</li>
<li><b>Autoscaling</b> on signals that reflect the real bottleneck, with a ${term('Warm pool')} and model warm-up to shorten the ${term('Cold start')}.</li>
</ul>

<h2>2. Why do we need it?</h2>
<p>From the ${L('v2-capacity-planning','queueing table')}: near 100 % utilization, wait grows without bound. Without admission control, a 50 % traffic spike does not make the service 50 % slower: it makes the queue grow every second, every request’s TTFT grows, clients hit timeouts and <b>retry</b>, retries add more load, and the service fails for everyone. This is ${term('congestive collapse')}: goodput falls to near zero while the GPUs stay 100 % busy computing answers nobody waits for.</p>
<p>GPU capacity also cannot follow traffic quickly. A CPU web pod is ready in seconds; a new GPU node plus weights plus warm-up is minutes. For those minutes, admission control is the only thing protecting the SLO.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 Admission control decision</h3>
${formula(`
For each request r with priority p, tenant t, estimated tokens (in, out):

  1. quota:     tenant_tokens_used(t, window) + est_tokens(r) ≤ quota(t)       else 429
  2. size:      in ≤ max_context(model)  and  out ≤ max_output(product)       else 400
  3. deadline:  est_queue_wait(p) + est_TTFT(r) ≤ deadline(p)                  else shed (429/503)
                ↑ from current queue depth per priority ÷ measured drain rate
  4. admit to the priority queue p; the engine-side scheduler takes work in priority order

est_queue_wait ≈ requests ahead in queue ÷ goodput of the pool
  example: 600 ahead, pool goodput 300 req/s → 2.0 s wait
           standard deadline 1.5 s → shed standard; premium has its own shorter queue → admit
`)}
<p>Enforcement happens in two places. The <b>gateway</b> enforces quotas, size limits and tenant priorities (Envoy-based AI gateways, for example, support token-based rate limits keyed on headers such as tenant id; see ${L('v2-ai-gateway','the gateway lesson')}). The <b>engine</b> limits its own running batch (<code>--max-num-seqs</code>, <code>--max-num-batched-tokens</code> in vLLM) and queues the rest; some engines also accept a request priority (SGLang lists a <code>priority</code> schedule policy). The gateway must not push more into an engine queue than can drain within the deadline.</p>

<h3>3.2 Priority classes and shedding order</h3>
${table(['Class','Examples','Deadline (illustrative)','When short of capacity'],[
 ['P0 premium interactive','paying users’ chat, booking changes','TTFT ≤ 1 s','served; last to be shed'],
 ['P1 standard interactive','free-tier chat','TTFT ≤ 2 s','moved to smaller model, then shed'],
 ['P2 background agents','itinerary monitoring, ops agents','minutes','paused, resumed later'],
 ['P3 batch','nightly summaries, evaluations, embeddings backfill','hours','first to be shed; runs in troughs']
])}
<p>Shedding is not failure, it is a <b>decision</b>: the business agrees in advance which work is cheapest to lose. Return a fast, honest error (429 with <code>Retry-After</code>, or a degraded response) rather than letting the request time out after 30 s of queueing.</p>

<h3>3.3 Backpressure and retries</h3>
<ul>
<li><b>Retry budget</b>: clients may retry at most, say, 10 % of requests over a window, with exponential backoff and jitter, and only idempotent operations.</li>
<li><b>Honour <code>Retry-After</code></b>; never retry immediately on 429/503.</li>
<li><b>Deadline propagation</b>: pass the client’s remaining deadline down (header or gRPC deadline) so the engine does not start prefill for a request whose client already gave up.</li>
<li><b>Cancel on disconnect</b>: when a streaming client disconnects, abort the generation to free KV blocks immediately.</li>
</ul>

<h3>3.4 Cold-start arithmetic</h3>
<p>All times below are <b>illustrative</b>; measure each phase in your environment (Kubernetes events, node and pod timestamps, engine logs).</p>
${formula(`
STEP 1  detect      scrape interval + autoscaler poll        15 s + 30 s     ≈ 0.75 min
STEP 2  node        cloud provisions a GPU node, boots,      ≈ 3–6 min (measure)
                    GPU driver/device plugin ready
STEP 3  image       10 GB serving image at 500 MB/s           10 ÷ 0.5        = 20 s
STEP 4  weights     8B BF16  = 16 GB  at 1 GB/s                               = 16 s
                    70B BF16 = 141 GB at 1 GB/s                               = 141 s ≈ 2.4 min
STEP 5  load + warm-up: copy to HBM, KV profiling, CUDA graph capture,
                    first real request                         ≈ 0.5–2 min (measure)

8B on a NEW node   ≈ 0.75 + 4 + 0.33 + 0.27 + 1   ≈ 6.4 min
70B on a NEW node  ≈ 0.75 + 4 + 0.33 + 2.4  + 2   ≈ 9.5 min
8B on a WARM node (node exists, image cached)    ≈ 0.75 + 0.27 + 1 ≈ 2 min
Warm pool (weights already in GPU, just add to routing) ≈ seconds to 1 min

Demand ramps 20 % per 5 min. Cold start 6.4 min → demand grows ≈ 26 % before new
capacity arrives, so the warm headroom must cover ≥ 26 % or admission control will shed.
`)}
<p>Levers: keep the image on the node (pre-pulled, or bake into the node image), stream weights from fast storage (local NVMe cache, a shared cache, Kubernetes OCI image volumes for weights, which are stable since Kubernetes v1.36), keep a minimum of idle GPU nodes, and keep a warm pool of fully loaded but unrouted replicas. Weight-download bandwidth is also a <b>herd</b> problem: 100 replicas × 141 GB = 14.1 TB pulled at once from one bucket.</p>
${anim('v2-hs-autoscale')}

<h3>3.5 Autoscaling signals</h3>
${table(['Signal','Good for','Problem'],[
 ['CPU utilization','nothing in the GPU path','the engine process is mostly idle on CPU while the GPU is saturated'],
 ['GPU utilization (DCGM_FI_DEV_GPU_UTIL)','detecting a dead/idle GPU','"percent of time ≥1 kernel was running": a decoding replica shows ≈100 % at batch 2 or batch 200'],
 ['<code>vllm:num_requests_waiting</code>','direct queue pressure; KEDA Prometheus scaler','lags if admission control already sheds; per-replica, so aggregate'],
 ['<code>vllm:request_queue_time_seconds</code> (histogram)','closest to user pain (TTFT component)','needs percentile over a window'],
 ['<code>vllm:kv_cache_usage_perc</code>','KV-bound pools (long context)','high value is normal and healthy for a busy replica; combine with waiting'],
 ['Gateway in-flight requests ÷ replicas','per-replica concurrency target','needs a measured target concurrency per replica'],
 ['Forecast / schedule','known peaks (evenings, Ramadan, campaigns)','needs calendar ownership']
])}
${code('yaml',`# KEDA ScaledObject (keda.sh/v1alpha1) scaling on queued requests per replica
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: {name: atlas-llm}
spec:
  scaleTargetRef: {name: atlas-llm}
  minReplicaCount: 24          # diurnal floor from the capacity plan
  maxReplicaCount: 120         # GPU quota, not wishful thinking
  triggers:
  - type: prometheus
    metadata:
      serverAddress: http://mimir-query.monitoring:8080/prometheus
      query: sum(vllm:num_requests_waiting{model_name="atlas-8b"})
      threshold: "8"           # target waiting requests per replica
      activationThreshold: "1"`)}
${callout('unverified','Defaults to verify for your versions','Kubernetes HPA syncs every 15 s by default and applies a 300 s scale-down stabilization window; KEDA polls triggers every 30 s by default. These are long-standing defaults, but check your Kubernetes and KEDA (v2.21 is current, Oct 2026) documentation and set them explicitly.')}

<h3>3.6 Streaming and long-lived connections</h3>
<ul>
<li>A streamed answer of 250 tokens at 40 ms is a 10 s connection; agent sessions can stay open for minutes. Connection count ≈ in-flight requests (31,200 in the capacity example), so gateways and load balancers are sized in <b>concurrent connections</b>, not just RPS.</li>
<li><b>Idle timeouts</b>: load balancers drop connections that send nothing for their idle timeout. A long prefill or a slow tool call can trip it; send SSE comments/heartbeats or raise the timeout.</li>
<li><b>Graceful shutdown</b>: on scale-down or rollout, stop routing new requests (readiness false), let in-flight streams finish, then exit. <code>terminationGracePeriodSeconds</code> must exceed your longest allowed generation (2,000 tokens × 50 ms = 100 s), plus a preStop delay for endpoint propagation.</li>
<li><b>Load balancing</b>: round-robin on connections is uneven when requests differ 20× in cost. Prefer least-outstanding-requests or engine-aware routing (InferencePool endpoint picker, llm-d router) that reads queue and KV metrics.</li>
</ul>

<h3>3.7 Horizontal scaling limits</h3>
${table(['Limit','Why it bites at scale','Mitigation'],[
 ['GPU quota and regional capacity','You cannot autoscale into GPUs the cloud does not have','Reservations/capacity blocks for the floor; multi-region; brownout'],
 ['Weight distribution bandwidth','N replicas × model size from one bucket','Node-local cache, peer distribution, image volumes, staggered rollouts'],
 ['Prefix-cache locality','More replicas with random routing → lower hit rate per replica','Prefix/KV-aware routing (llm-d, Dynamo, SGLang router)'],
 ['Gateway / LB connections','Long streams × high concurrency','Scale gateways on connections; tune keepalive'],
 ['Control plane','Thousands of pods, frequent endpoint changes','Fewer, larger replicas; avoid scale flapping'],
 ['Shared dependencies','Vector DB, Redis, auth service','Size them to the GPU fleet’s peak, not average']
])}

<h2>4. Where does it fit?</h2>
${fig('Control points from client to GPU', svgDiagram({w:900,h:300,
 boxes:[
  {id:'c',x:20,y:110,w:120,h:56,label:'Client',sub:'retry budget'},
  {id:'lb',x:170,y:110,w:130,h:56,label:'Load balancer',sub:'idle timeout'},
  {id:'gw',x:330,y:110,w:160,h:56,label:'AI gateway',sub:'quota, priority, shed',cls:'hl'},
  {id:'rt',x:520,y:110,w:150,h:56,label:'Inference router',sub:'queue/KV aware'},
  {id:'eng',x:700,y:40,w:180,h:56,label:'Engine replica',sub:'batch limit, queue'},
  {id:'as',x:700,y:190,w:180,h:56,label:'Autoscaler',sub:'KEDA / HPA',cls:'hl'}
 ],
 arrows:[{from:'c',to:'lb'},{from:'lb',to:'gw'},{from:'gw',to:'rt'},{from:'rt',to:'eng'},{from:'eng',to:'as',cls:'dash',label:'metrics',fromSide:'bottom',toSide:'top'},{from:'gw',to:'c',cls:'dash',label:'429 + Retry-After',fromSide:'bottom',toSide:'bottom'}]
}), 'Fast controls (gateway, router, engine) act in milliseconds; the autoscaler acts in minutes. Backpressure flows back to the client.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Capacity plan</b> (${L('v2-capacity-planning','previous lesson')}) sets min/max replicas, warm pool size and per-replica concurrency targets.</li>
<li><b>Gateway</b> (${L('v2-ai-gateway','AI gateway')}) implements quotas, priorities and shedding.</li>
<li><b>Kubernetes</b> (${L('v1-k8s-autoscaling','autoscaling')}, ${L('v1-k8s-serving','serving')}): KEDA/HPA, node autoscaling (Karpenter, cluster autoscaler), readiness probes that mean "model loaded and warmed".</li>
<li><b>Observability</b> (${L('v2-ai-observability','next part')}): shed rate, queue time and cold-start duration are first-class SLIs.</li>
<li><b>Multi-region</b> (${L('v2-multi-region','next lesson')}): a region loss is the largest "traffic spike" a region will ever see.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${checklist([
 {key:'hs-1',text:'Priority classes and shedding order, agreed with product and written down.'},
 {key:'hs-2',text:'Per-tenant token quotas and max input/output tokens at the gateway.'},
 {key:'hs-3',text:'Autoscaling on queue/waiting/KV metrics with explicit min, max, stabilization windows.'},
 {key:'hs-4',text:'Cold-start budget measured per phase; warm pool size derived from it.'},
 {key:'hs-5',text:'Readiness = weights loaded + warm-up request served; graceful termination longer than the longest stream.'},
 {key:'hs-6',text:'Client retry budgets and deadline propagation in SDKs used by internal teams.'},
 {key:'hs-7',text:'Load tests that include a spike and a retry storm, not only steady load.'}
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['Goodput falls to near zero while GPUs are 100 % busy','Congestive collapse: queue + timeouts + retries','Retry rate ↑, client timeouts ↑, queue time &gt; client timeout','Shed by deadline, cap retries, cancel abandoned requests'],
 ['Scale-out did nothing for 8 minutes','Cold start (node + weights) longer than assumed','Pod events: Pending → ContainerCreating → long image/weight pull','Warm pool, pre-pulled images, node-local weight cache'],
 ['Replicas flap up and down every few minutes','Signal too noisy; no stabilization','Replica count graph sawtooth','Longer window, scale-down stabilization, smoother metric'],
 ['New pods get traffic and time out','Readiness true before weights loaded / warmed','First requests on new pods have extreme TTFT','Readiness on model health + warm-up request'],
 ['Streams cut at exactly N seconds','LB idle timeout or termination grace too short','Disconnect timestamps cluster at a constant','Heartbeats, raise timeout, longer grace period'],
 ['One replica overloaded, others idle','Connection-level round robin with uneven requests','Per-pod waiting requests skewed','Least-outstanding or engine-aware routing'],
 ['Autoscaler maxed but still shedding','GPU quota or regional capacity exhausted','Pending pods, cloud capacity errors','Reserve the floor, cross-region overflow, brownout']
])}

<h2>8. How do we scale it?</h2>
<p>Scale the controls themselves: gateways horizontally on connections; per-tenant quota state in a shared, low-latency store; routing decisions local to each gateway using recent metrics. Above a few hundred replicas per model, move to an inference-aware router (Gateway API Inference Extension InferencePool with an endpoint picker, llm-d, NVIDIA Dynamo) and consider disaggregating prefill and decode so each scales on its own signal (${L('v2-distributed-inference','distributed inference')}).</p>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Cost of a warm pool vs cost of shedding (illustrative)
  warm pool 20 H100 × $3.99 × 730 h            = $58,254 / month
  shedding avoided: 3 spikes/week × 6 min × 15 % of 3,000 req/s
                  = 3 × 360 s × 450 req/s      = 486,000 requests/week
  if a premium request is worth $0.05 in retained revenue → $24,300/week ≈ $105,000/month
  → the warm pool pays for itself here; with $0.01/request it would not.
`)}
<ul>
<li>Shedding batch work is free if it runs later; design batch to be deferrable.</li>
<li>A warm pool can serve batch at lowest priority while it waits (preemptible backfill).</li>
<li>Scheduled scaling for known peaks avoids paying for an always-on reserve.</li>
</ul>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Traffic jumps 5× in two minutes and new GPU pods take eight minutes to be ready. What happens and what do you do?”','<p><i>Answer (≈50 s):</i> "For eight minutes the fleet can only do what it already has, so the question is who gets served. Admission control at the gateway sheds by priority and deadline: batch and background agents first, free tier moved to a smaller model, premium protected, and every rejection is a fast 429 with Retry-After so clients don’t pile on retries. The warm pool absorbs part of the spike within a minute. The autoscaler should already be scaling on queue time or waiting requests, not CPU. Afterward I’d look at the cold-start breakdown — node, image, weights, warm-up — and shorten the slowest phase, and add scheduled pre-scaling if the spike was a known campaign."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Set HPA on GPU utilization to 70 % and it will scale."</p><p>Wrong signal (GPU util is near 100 % at any batch), ignores cold start and retries.</p></div><div class="good"><h4>Strong answer</h4><p>Separates fast controls (admission, priority, backpressure) from slow ones (autoscaling), quantifies cold start, names the right metrics.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['spike','queue time ↑','admission sheds P3/P2','autoscaler requests nodes','cold start','capacity ready','shed stops'])}
${chain(['client timeout','retry','more load','longer queue','collapse'])}
<p>Next: ${L('v2-multi-region','multi-region')} — when a whole region disappears. Then ${L('v2-ai-observability','observability')} turns these controls into SLIs and alerts.</p></div>
`,
  quiz:[
    {q:'Why is GPU utilization (DCGM_FI_DEV_GPU_UTIL) a poor autoscaling signal for LLM decode?',options:['It is reported in MiB','It measures the fraction of time any kernel runs, so it reads near 100 % at both small and large batch sizes','It is only available on A100','It lags by an hour'],answer:1,explain:'It reports "≥1 kernel running" time, not how much work the SMs do. Queue time or waiting requests reflect user pain.'},
    {q:'A request’s estimated queue wait is 2.0 s and its priority class deadline is 1.5 s. Best action?',options:['Admit and hope','Shed it now with 429 and Retry-After (or degrade it)','Retry it internally three times','Increase max-num-seqs'],answer:1,explain:'Admitting work that will miss its deadline wastes GPU time and grows the queue. A fast, honest rejection preserves goodput for others.'},
    {q:'Cold start for a 70B replica on a new node is dominated by…',options:['DNS propagation','Node provisioning and weight download/load','Readiness probe period','Helm template rendering'],answer:1,explain:'Node provisioning is minutes; 141 GB of weights at 1 GB/s is 2.4 minutes; warm-up adds more.'},
    {q:'What causes congestive collapse in an LLM service?',options:['Too many replicas','Queueing beyond client timeouts, which causes retries that add more load','Prefix caching','Using SSE'],answer:1,explain:'Timed-out requests are retried while the abandoned ones may still be computed; work grows while goodput falls.'},
    {q:'A streaming answer can take up to 100 s. terminationGracePeriodSeconds is 30. What happens on scale-down?',options:['Nothing','Long streams are cut when pods are killed','Weights are corrupted','KEDA refuses to scale'],answer:1,explain:'The kubelet kills the container after the grace period, cutting in-flight streams. Grace must exceed the longest allowed generation plus preStop delay.'}
  ],
  flashcards:[
    {front:'Admission control',back:'Per-request decision to serve, queue with a deadline, degrade or reject, based on quota, size and estimated wait vs deadline.'},
    {front:'Load shedding vs backpressure',back:'Shedding: deliberately reject lowest-value work. Backpressure: signal producers to slow down (429 + Retry-After, deadlines).'},
    {front:'Good LLM autoscaling signals',back:'Queue time, waiting requests, KV usage with waiting, in-flight per replica, schedules. Not CPU; not raw GPU util.'},
    {front:'Cold-start phases',back:'Detect → node provision → image pull → weight download → load to HBM + CUDA graphs → warm-up request → readiness.'},
    {front:'Warm pool',back:'Replicas with weights already loaded but not (fully) routed, ready to absorb load in seconds; can backfill batch work.'},
    {front:'Streaming at scale',back:'Size by concurrent connections; heartbeats vs idle timeouts; graceful drain; cancel on disconnect to free KV.'}
  ]
});

registerLesson({
  id:'v2-multi-region', vol:2, part:7, num:3,
  title:'Multi-region, active-active, disaster recovery, data residency and degraded modes', minutes:85,
  summary:'Serving from more than one region protects users from a regional outage, lowers latency, and can be required by data-residency law. But a second region only helps if it is truly independent, holds the same model versions, has room to absorb the other region’s traffic, and knows what it is not allowed to serve. This lesson covers active-active and active-passive designs, global routing, recovery objectives for model artifacts and indexes, the fact that KV cache is lost in a failover, degraded modes, and the Saudi data-residency situation as of October 2026.',
  objectives:[
    'Compare active-active and active-passive designs for GPU inference, including cost and recovery time.',
    'Define RTO and RPO for model artifacts, vector indexes, conversation state and KV cache.',
    'Calculate the capacity shortfall after a region loss and design a brownout ladder that closes it.',
    'Design residency-aware routing for Saudi personal data, using the current status of in-Kingdom cloud regions.',
    'Identify hidden cross-region dependencies that break failure isolation.'
  ],
  prereqs:['v2-capacity-planning','v2-hyperscale-serving'],
  next:['v2-ai-observability','v2-capstone-platform'],
  tags:['multi-region','dr','residency','reliability'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','An airline with hubs in two cities. If one airport closes, flights reroute to the other — but only if the other has free gates, crews and fuel, and only for routes that are legally allowed to land there. Now the real mechanism.')}
<p>A multi-region AI platform runs serving stacks in two or more cloud regions:</p>
<ul>
<li>${term('Active-active')}: every region serves production traffic all the time. Failover = stop sending traffic to the failed region.</li>
<li><b>Active-passive</b>: a standby region holds replicated data and artifacts but little or no warm GPU capacity; failover means scaling it up.</li>
<li><b>Global routing</b>: DNS-based (latency, geo, weighted), anycast, or a global load balancer decides which region serves each request, subject to health and policy.</li>
<li>${term('Data residency')}: legal or contractual rules about where data may be stored or processed. For AI this covers prompts, retrieved documents, embeddings, logs, traces and caches.</li>
</ul>

<h2>2. Why do we need it?</h2>
<ul>
<li><b>Failure isolation</b>: whole regions (or a region’s GPU capacity) do become unavailable; so do region-scoped services such as a managed vector DB or a model API endpoint.</li>
<li><b>Latency</b>: TTFT includes network round trips; a user in Riyadh served from Europe pays extra tens of milliseconds per round trip, and agents make many round trips.</li>
<li><b>Residency and sovereignty</b>: Saudi Arabia’s Personal Data Protection Law (PDPL) and its transfer regulation govern when personal data may leave the Kingdom; enterprise customers add their own contractual rules.</li>
<li><b>GPU supply</b>: a single region may not have enough accelerators; spreading demand increases the pool you can draw from.</li>
</ul>

<h2>3. How does it work internally?</h2>
<h3>3.1 Active-active versus active-passive</h3>
${table(['','Active-active','Active-passive (warm)','Active-passive (cold)'],[
 ['Normal GPU cost','each region sized for its share + headroom','primary full; standby small floor','primary full; standby none'],
 ['RTO for inference','seconds–minutes (routing change)','minutes (scale standby) if GPUs available','tens of minutes–hours (provision + load)'],
 ['Risk','capacity shortfall in survivor','standby capacity may not exist during a regional event','same, worse'],
 ['Proves itself daily?','yes (both serve)','partly','no (failover is rarely exercised)'],
 ['Fit','interactive, user-facing','internal tools, cost-sensitive','batch, analytics']
])}
<p>GPU inference is stateless per request apart from the KV cache, which makes active-active natural: any region with the same model version can serve any request it is allowed to serve.</p>

<h3>3.2 What has to be in every region (regional parity)</h3>
${table(['Asset','State?','RPO (data you can lose)','RTO driver','Strategy'],[
 ['Model weights, tokenizer, chat template, LoRA adapters','immutable artifacts','0 for promoted versions if replicated <i>before</i> promotion','cold start (load time)','replicate on promotion; promote only when present in all regions; pin by digest'],
 ['Serving config (engine flags, routing, quotas)','config','0 (Git)','GitOps sync','same Git source, per-region overlays'],
 ['Vector / BM25 indexes','derived data','ingestion lag (minutes)','rebuild time if lost (hours)','replicate ingestion pipeline per region or snapshot; never only one copy'],
 ['Conversation history, agent state','user data','replication lag','DB failover','regional DB with residency-aware replication'],
 ['Response / semantic caches','derived, disposable','irrelevant','warm-up (hit rate drops)','do not replicate across residency boundaries; accept cold cache'],
 ['KV cache and prefix cache','ephemeral GPU memory','<b>always lost</b>','re-prefill on survivor','nothing to replicate; budget the extra prefill'],
 ['In-flight streams','connection','lost','client retry','clients retry idempotent requests; agents resume from checkpoints']
])}
${formula(`
Why vector index RPO/RTO matters: rebuilding from source
  50,000,000 chunks ÷ 2,000 chunks/s embedding throughput = 25,000 s ≈ 6.9 h
  → an index you cannot restore from a replica is a 7-hour outage for RAG features.

Why "KV is ephemeral" matters: extra load on the survivor
  prefix hit rate falls 40 % → 0 % until caches warm
  cost per request c = 0.0805 s → 0.0925 s  (+15 %, from the capacity cost model)
  → the survivor needs 15 % more capacity for the first minutes, exactly when it is shortest.
`)}

<h3>3.3 Worked failover capacity maths</h3>
<p>Two regions, active-active, each with 300 units of GPU capacity (one unit = one replica-equivalent), each carrying 240 units at peak (80 %). All numbers illustrative.</p>
${formula(`
STEP 1  total peak demand            = 240 + 240                = 480
STEP 2  Region A fails; naive load on B = 480 ÷ 300              = 160 %   shortfall 180 (37.5 %)
STEP 3  residency: half of A's traffic (120) uses Saudi personal data that
        must stay in-Kingdom → cannot move to B; degrade it to a non-personal
        mode (generic/FAQ answers, near-zero GPU)            B load = 240 + 120 = 360 (120 %)
STEP 4  brownout tier 1: pause batch + background agents (15 %)
        360 × 0.85                                           = 306 (102 %)
STEP 5  brownout tier 2: free tier (30 % of requests) → smaller model at 25 % of the cost
        saving = 0.30 × 306 × (1 − 0.25)                     = 68.9
        load   = 306 − 68.9                                  ≈ 237 (79 %)   ✓ within capacity
ANSWER  Region loss is survivable WITHOUT doubling the fleet, but only because product
        agreed in advance to tiers 1–2 and to a residency-safe degraded mode.

Alternative without brownout: each region must hold 480 + 10 % → 528 units,
76 % more GPUs (528 vs 300 per region) idle on every normal day.
`)}
${anim('v2-mr-failover')}

<h3>3.4 Degraded modes (the brownout ladder)</h3>
<ol>
<li>Pause deferrable work: batch summarisation, evaluations, embedding backfills, background agents.</li>
<li>Route lower tiers to a <b>smaller validated model</b> (the routing must have been tested against an eval set: do not silently send regulated tasks to an unvalidated model).</li>
<li>Shorten context and output: lower max output tokens, drop older history, fewer retrieved chunks.</li>
<li>Disable expensive features: multi-step agents, tool use, long-document analysis.</li>
<li>Read-only or cached answers for personal-data features that cannot fail over.</li>
<li>Honest unavailability for the rest, with status messaging.</li>
</ol>
<p>Each tier needs a feature flag, an owner, a measured saving and a test. A brownout that has never been exercised will not work during an incident.</p>

<h3>3.5 Data residency in the GCC (as of Oct 2026)</h3>
<ul>
<li><b>Law</b>: Saudi PDPL (Royal Decree M/19, amended by M/148), in force 14 Sep 2023 with a one-year grace period to 14 Sep 2024; regulator SDAIA. An Implementing Regulation, a Regulation on Personal Data Transfer outside the Kingdom and Standard Contractual Clauses are published on sdaia.gov.sa. Transfers are possible only under those conditions: decide with legal counsel, then encode the decision as routing and storage policy.</li>
<li><b>In-Kingdom public cloud regions, as of Oct 2026</b>: Google Cloud <b>Dammam (me-central2)</b> is live with 3 zones. <b>AWS</b> has announced Saudi regions but none is open yet (existing in-Kingdom presence: Outposts and a CloudFront edge in Jeddah). <b>Microsoft Azure “Saudi Arabia East”</b> has been announced for availability in November 2026 and is not yet generally available.</li>
<li><b>Consequence</b>: as of today, a single public cloud cannot give you two in-Kingdom regions. For residency-bound workloads, real redundancy means multi-zone within one region, plus either a second provider (when available), on-premises/colocated GPUs, or an agreed degraded mode. Region-level failover <i>out of</i> the Kingdom is only for data that is allowed to leave.</li>
</ul>
${callout('warn','Residency covers derived data','Embeddings, KV-cache offload files, semantic-cache entries, traces with prompt content, evaluation datasets and fine-tuning sets can all contain personal data. Classify them like the source. A "global" observability backend that stores prompt text can quietly break residency.')}

<h3>3.6 Global routing</h3>
${formula(`
route(request) =
  allowed  = regions where policy(data_class(request), tenant) permits processing
  healthy  = allowed ∩ regions passing health + capacity checks
  if healthy = ∅ → degraded mode for this data class (never silently violate policy)
  choose   = argmin over healthy of (latency estimate + load penalty), with tenant affinity
`)}
<p>Mechanisms: DNS latency/geo/weighted records with health checks (simple, TTL-bound failover), anycast or global L7 load balancers (fast failover), and an application-level router in the gateway that knows data classes. Data class must come from authenticated context (tenant, feature), never from text in the prompt.</p>

<h2>4. Where does it fit?</h2>
${fig('Two regions with residency-aware routing and isolated dependencies', svgDiagram({w:900,h:350,
 zones:[{x:250,y:20,w:300,h:310,label:'Region A (in-Kingdom)',cls:'ok'},{x:580,y:20,w:300,h:310,label:'Region B'}],
 boxes:[
  {id:'u',x:20,y:140,w:200,h:56,label:'Global routing',sub:'policy + health + latency',cls:'hl'},
  {id:'ga',x:270,y:50,w:120,h:50,label:'Gateway A'},
  {id:'ia',x:410,y:50,w:120,h:50,label:'GPU pool A'},
  {id:'va',x:270,y:150,w:120,h:50,label:'Index A'},
  {id:'da',x:410,y:150,w:120,h:50,label:'User data A'},
  {id:'oa',x:270,y:250,w:260,h:50,label:'Telemetry A (prompts redacted)'},
  {id:'gb',x:600,y:50,w:120,h:50,label:'Gateway B'},
  {id:'ib',x:740,y:50,w:120,h:50,label:'GPU pool B'},
  {id:'vb',x:600,y:150,w:120,h:50,label:'Index B'},
  {id:'db',x:740,y:150,w:120,h:50,label:'User data B'},
  {id:'ob',x:600,y:250,w:260,h:50,label:'Telemetry B'}
 ],
 arrows:[{from:'u',to:'ga'},{from:'u',to:'gb',label:'non-restricted only'},{from:'ga',to:'ia'},{from:'gb',to:'ib'}]
}), 'Each region has its own gateway, GPU pool, index, data store and telemetry. Routing to B is allowed only for data classes permitted to leave the Kingdom.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Capacity plan</b> (${L('v2-capacity-planning','capacity')}): the region factor (2 × 267 vs 3 × 134) is chosen here.</li>
<li><b>Admission control</b> (${L('v2-hyperscale-serving','hyperscale serving')}): brownout tiers are priority classes switched by flags.</li>
<li><b>Model CI/CD</b> (${L('v2-model-cicd','model CI/CD')}): promotion must wait for artifact replication to every serving region (regional parity).</li>
<li><b>RAG</b> (${L('v2-rag-production','production RAG')}): per-region ingestion and ACLs; an index is regional data.</li>
<li><b>Caching</b> (${L('v2-cache-ops','cache operations')}): caches are per region and per tenant; expect cold caches after failover.</li>
<li><b>Governance</b> (${L('v2-governance','governance')}): residency decisions are recorded, audited and tested.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${checklist([
 {key:'mr-1',text:'Data-class map: which data classes may be processed in which regions (signed off by legal/privacy).'},
 {key:'mr-2',text:'Regional parity check in CI: same model digests, tokenizer, template, engine version, config in every region before promotion.'},
 {key:'mr-3',text:'Dependency audit: no hidden single-region dependency (auth, secrets, registry, vector DB, feature flags, telemetry).'},
 {key:'mr-4',text:'Brownout ladder with flags, owners, measured savings, and quarterly game days.'},
 {key:'mr-5',text:'Region-loss load test: shift 100 % of a region’s traffic and measure shed rate and SLO.'},
 {key:'mr-6',text:'Fail-back runbook: gradual traffic return, cache warm-up, reversal of brownout tiers.'}
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['Region B fails when Region A fails','Hidden dependency on A (auth, secrets, registry, shared vector DB)','Errors in B reference endpoints in A','Regionalize dependency; test with A blocked'],
 ['Failover succeeded, answers differ','Model or prompt-template version skew between regions','Response metadata shows different model revision','Promote only after parity check; pin digests'],
 ['Survivor overloaded and down too','No shortfall plan; retries from A’s clients','Shed rate 0 then collapse','Brownout tiers; admission control; retry budgets'],
 ['Residency incident after failover','Router fell back to "any healthy region"','Requests with restricted data class served in B','Policy-first routing: empty allowed set → degraded mode'],
 ['RAG answers stale after failover','Index in B lags ingestion','Index freshness metric per region','Per-region ingestion with freshness SLO'],
 ['Fail-back caused a second incident','All traffic returned at once to cold caches and replicas','TTFT spike in A at fail-back','Weighted fail-back 10 → 50 → 100 %']
])}

<h2>8. How do we scale it?</h2>
<p>Move from two regions to N regions with smaller shares: with N active-active regions each sized to survive one loss, each holds 1/(N−1) of peak, so total capacity is N/(N−1) of peak: 2.0× for two regions, 1.5× for three, 1.33× for four. Cells (independent copies of the full stack within a region) limit blast radius further for deploys and noisy tenants.</p>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Total capacity to survive one region loss = N ÷ (N − 1) × peak
   N = 2 → 2.00 × peak      N = 3 → 1.50 × peak      N = 4 → 1.33 × peak
With brownout covering a fraction b of peak during failover:
   per-region capacity = (1 − b) × peak ÷ (N − 1)
   N = 2, b = 0.5 (example above: 480 → ≈ 237) → ≈ 0.5 × peak per region instead of 1.0 ×
`)}
<p>Active-passive with a small warm floor is cheapest but the standby GPUs may not exist at the moment you need them, because every customer of that cloud is failing over too. Price the risk, not just the GPUs.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Design failover for an AI assistant serving Saudi customers under data residency rules.”','<p><i>Answer (≈60 s):</i> "First I classify data: which requests carry Saudi personal data and must stay in-Kingdom, and which can be processed elsewhere. As of October 2026 only Google Cloud Dammam is a live in-Kingdom public cloud region — AWS’s Saudi regions are announced but not open and Azure Saudi Arabia East is promised for November — so for restricted data I rely on multi-zone redundancy in-Kingdom plus a defined degraded mode, not cross-border failover. Unrestricted traffic can run active-active across regions. Each region has its own gateway, GPU pool, index and telemetry, models are promoted only when replicated everywhere, and the router is policy-first: if no allowed region is healthy, that feature degrades rather than violating policy. I size the survivor with a brownout ladder agreed with product, and I test it with game days."</p>')}

<div class="connections"><h4>How this connects</h4>
${chain(['data classification','allowed regions','routing policy','failover','brownout','fail-back'])}
${chain(['region loss','cold prefix cache','+15 % prefill','survivor shortfall','admission control'])}
<p>Next: ${L('v2-ai-observability','observability')} measures all of this per region. The ${L('v2-capstone-platform','capstone')} applies it to Atlas.</p></div>
`,
  quiz:[
    {q:'Which asset has no meaningful RPO because it is always lost in a regional failover?',options:['Model weights','Vector index','KV cache / prefix cache in GPU memory','Conversation history'],answer:2,explain:'KV cache is ephemeral per-request GPU state. Weights are immutable artifacts (RPO 0 if replicated); indexes and history need replication.'},
    {q:'Two regions each run 240 units on 300 capacity. One fails. Without any brownout, what is the survivor’s load?',options:['80 %','120 %','160 %','200 %'],answer:2,explain:'480 ÷ 300 = 160 %. Active-active at 80 % is not failover-ready by itself.'},
    {q:'As of Oct 2026, which in-Kingdom public cloud region is live according to official sources?',options:['AWS me-west-1','Google Cloud Dammam (me-central2)','Azure Saudi Arabia East','All three'],answer:1,explain:'GCP Dammam is live. AWS Saudi regions are announced, not open; Azure Saudi Arabia East is announced for November 2026.'},
    {q:'With N active-active regions each sized to survive one region loss, total capacity is…',options:['N × peak','N ÷ (N − 1) × peak','(N − 1) × peak','peak ÷ N'],answer:1,explain:'Each region must hold peak ÷ (N − 1); N of them hold N ÷ (N − 1) × peak: 2× for 2, 1.5× for 3.'},
    {q:'No allowed region is healthy for a restricted data class. The router should…',options:['Send to any healthy region','Queue forever','Serve a degraded mode for that data class or fail closed','Strip the user id and send anywhere'],answer:2,explain:'Policy first: never silently violate residency. Removing an id does not anonymise prompts.'}
  ],
  flashcards:[
    {front:'Active-active vs active-passive (GPU inference)',back:'AA: all regions serve; failover is a routing change but survivor needs headroom. AP: cheaper; failover needs GPUs that may not be available.'},
    {front:'RTO / RPO',back:'RTO: time to restore service. RPO: how much data (time window) can be lost. Weights RPO 0 if replicated before promotion; KV always lost.'},
    {front:'Brownout ladder',back:'Pre-agreed degraded modes: pause batch → smaller model for low tiers → shorter context/output → disable agents → read-only/cached → unavailable.'},
    {front:'Saudi in-Kingdom regions (Oct 2026)',back:'GCP Dammam me-central2 live; AWS Saudi announced, not open; Azure Saudi Arabia East announced for Nov 2026.'},
    {front:'N-region failover capacity',back:'N/(N−1) × peak: 2 regions 2×, 3 regions 1.5×, 4 regions 1.33×.'},
    {front:'Regional parity',back:'Same model digest, tokenizer, template, adapters, engine version and config in every serving region before promotion.'}
  ]
});

registerGlossary([
  {term:'Capacity planning',def:'Turning a demand forecast into hardware: users → requests → peak RPS → tokens/s → concurrency → KV memory → replicas from measured goodput → GPUs with failure and region headroom.',lesson:'v2-capacity-planning'},
  {term:'Peak factor',def:'Ratio of the design peak request rate to the mean, measured from traffic history (busiest-hour share × within-hour burst).',lesson:'v2-capacity-planning',aliases:['burst factor']},
  {term:'Goodput',def:'The request or token rate a system sustains while meeting its latency SLO (and, more strictly, quality criteria) for a realistic workload mix.',lesson:'v2-capacity-planning',aliases:['SLO goodput']},
  {term:'Little’s law',def:'L = λW: in a stable system the average number of items inside equals arrival rate times average time spent inside.',lesson:'v2-capacity-planning',aliases:["little's law"]},
  {term:'Statistical multiplexing',def:'Sharing one pool of servers among many random demand streams so peaks average out; pooled systems tolerate higher utilization at the same wait.',lesson:'v2-capacity-planning',aliases:['pooling']},
  {term:'Admission control',def:'Per-request decision at the gateway or engine to serve, queue with a deadline, degrade or reject, based on quota, size and estimated wait.',lesson:'v2-hyperscale-serving'},
  {term:'Load shedding',def:'Deliberately rejecting or degrading the lowest-priority work during overload so the rest still meets its SLO.',lesson:'v2-hyperscale-serving'},
  {term:'Backpressure',def:'Signals that make upstream producers slow down (429 with Retry-After, deadlines, bounded queues) instead of piling work onto an overloaded service.',lesson:'v2-hyperscale-serving'},
  {term:'Congestive collapse',def:'Overload state where queueing causes timeouts and retries that add load, so useful throughput falls toward zero while servers stay busy.',lesson:'v2-hyperscale-serving'},
  {term:'Cold start',def:'Time from deciding to add a replica to it serving traffic: node provisioning, image pull, weight download, load to GPU, warm-up.',lesson:'v2-hyperscale-serving'},
  {term:'Warm pool',def:'Replicas (or nodes) kept ready with weights loaded so capacity can be added in seconds; often backfilled with low-priority work.',lesson:'v2-hyperscale-serving'},
  {term:'Active-active',def:'Multi-region design in which every region serves production traffic all the time; failover is a routing change.',lesson:'v2-multi-region'},
  {term:'Data residency',def:'Rules on where data (including prompts, embeddings, logs and caches) may be stored or processed.',lesson:'v2-multi-region',aliases:['data sovereignty']},
  {term:'RTO',def:'Recovery time objective: the maximum acceptable time to restore a service after a failure.',lesson:'v2-multi-region'},
  {term:'RPO',def:'Recovery point objective: the maximum acceptable window of data loss, measured in time.',lesson:'v2-multi-region'},
  {term:'Brownout',def:'A planned degraded mode (smaller model, shorter output, disabled features) used to fit demand into reduced capacity instead of failing completely.',lesson:'v2-multi-region',aliases:['degraded mode']},
  {term:'Regional parity',def:'Guarantee that every serving region has identical model artifacts, templates, engine versions and config before a version is promoted.',lesson:'v2-multi-region'}
]);
