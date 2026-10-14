/* Volume 2, Part 9: AI FinOps — unit economics and optimization */

registerLesson({
  id:'v2-finops-unit-economics', vol:2, part:9, num:1,
  title:'AI FinOps: GPU cost models, cost per token, cost per successful request', minutes:90,
  summary:'AI spending is dominated by accelerators and model APIs, and both are priced in ways that hide the real unit cost. This lesson builds the unit economics from the ground up: what a GPU-hour really buys, how to split its cost into input-token and output-token cost, why utilization matters more than the hourly price, how to compute cost per successful request including retries and failures, how training cost follows from six times parameters times tokens, and how power and data-centre limits set a floor under everything. All prices are list prices as of October 2026 and will change.',
  objectives:[
    'Compute cost per million input tokens and per million output tokens separately from a GPU-hour price and measured throughput.',
    'Show how fleet utilization changes unit cost, using the capacity plan from Part 7.',
    'Compute cost per successful request including errors, retries and quality failures.',
    'Estimate training compute and cost with 6 × N × tokens and an explicit MFU assumption.',
    'Compare self-hosted unit cost with published API prices, and state what the comparison does not capture.',
    'Account for power and infrastructure constraints in GPU planning.'
  ],
  prereqs:['v2-capacity-planning','v2-ai-observability'],
  next:['v2-finops-optimization','v2-capstone-platform'],
  tags:['finops','cost','gpu','economics'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A taxi company knows the price of a car per month. That says little about the price of a trip until you know how many hours the car carries passengers, how long each trip is, and how many trips are cancelled. GPUs are the cars; tokens are the kilometres. Now the real mechanism.')}
<p>${term('Unit economics')} for AI expresses spend per unit of useful work: per million input tokens, per million output tokens, per request, and best of all per <b>successful</b> request or task. AI FinOps is the practice of measuring these units, attributing them to teams and tenants, and improving them without breaking latency or quality (FinOps Foundation: "FinOps for AI"; see the next lesson for chargeback and FOCUS).</p>

<h2>2. Why do we need it?</h2>
<ul>
<li><b>Hourly prices mislead</b>: a cheaper GPU-hour that delivers half the goodput is more expensive per request.</li>
<li><b>Token prices mislead</b>: output tokens cost several times input tokens on APIs (for example $2 input / $10 output per million on mid-tier models), and on your own GPUs decode is the expensive phase.</li>
<li><b>Idle capacity is invisible in per-token API bills but dominant in self-hosting</b>: the Part 7 fleet averaged 14 % utilization.</li>
<li><b>Cheap wrong answers are expensive</b>: a failed or retried request still costs tokens; a low-quality answer costs a human follow-up.</li>
</ul>

<h2>3. How does it work internally?</h2>
<h3>3.1 GPU cost models</h3>
${table(['Pricing model','How you pay','Example list price (as of Oct 2026)','Fits'],[
 ['On-demand (hyperscaler)','per instance-hour, no commitment','AWS p5.48xlarge (8 × H100) $55.04/h in us-east-1 → $6.88 per GPU-hour; p6-b200.48xlarge (8 × B200) $113.93/h → $14.24 per GPU-hour (AWS price feed published 2026-10-12)','spiky, short, uncertain'],
 ['On-demand (GPU cloud / neocloud)','per GPU-hour','Lambda H100 SXM 80 GB $3.99 per GPU-hour (8-GPU), B200 $6.69 per GPU-hour (8-GPU), ex-tax','steady GPU work, fewer managed services'],
 ['Committed / reserved','discount for 1–3 year commitment','discount varies by provider and term (negotiate; not quoted here)','predictable baseline'],
 ['Capacity blocks','reserve GPU instances for a future window','AWS EC2 Capacity Blocks: 1–14 days or multiples of 7 up to 182 days, up to 8 weeks ahead, no cancellation, price fixed at reservation','training runs, launches'],
 ['Spot / preemptible','spare capacity, can be reclaimed','variable','batch, checkpointed training, overflow'],
 ['Owned (on-prem / colo)','capex + power + space + people','depreciation over 3–5 years','very high steady utilization, sovereignty']
])}
${callout('warn','Prices are list prices that change','Every price on this page was read from an official page on 2026-10-14 (or the AWS price feed dated 2026-10-12). Use them to practise the method; fetch current prices before any decision.')}

<h3>3.2 From GPU-hour to cost per token — input and output separately</h3>
<p>A replica spends time on prefill (input) and decode (output) at very different rates. Use the two-cost model from ${L('v2-capacity-planning','capacity planning')}: P = prefill tokens/s, D = decode tokens/s at the SLO.</p>
${formula(`
price per GPU-second  = $3.99 ÷ 3,600                       = $0.0011083

STEP 1  cost per M uncached input tokens  = 10⁶ ÷ P × price/s
                                          = 10⁶ ÷ 40,000 × 0.0011083 = 25 GPU-s × … = $0.028
STEP 2  cost per M output tokens          = 10⁶ ÷ D × price/s
                                          = 10⁶ ÷ 4,000 × 0.0011083  = 250 GPU-s × … = $0.277
                                            ↑ output is 10× input per token here
STEP 3  cost per request (720 uncached in, 250 out) at 100 % useful utilization
        = 0.0805 GPU-s × $0.0011083                                    = $0.0000892

STEP 4  divide by average useful utilization u (busy-with-goodput share of paid hours)
        u = 100 %  → in $0.028  out $0.277  request $0.000089
        u =  60 %  → in $0.046  out $0.462  request $0.000149
        u =  35 %  → in $0.079  out $0.792  request $0.000255
        u =  14 %  → in $0.198  out $1.979  request $0.000637   ← the Part 7 fleet
`)}
${anim('v2-fin-unitcost')}
<p>Cached input tokens (prefix-cache hits) cost almost no GPU time: they occupy KV memory but skip prefill. That is why providers price cached input at a fraction of normal input (Anthropic cache reads 0.1× base input on most models, 0.05× on Opus 5.5 and Sonnet 5.5).</p>

<h3>3.3 Cost per successful request</h3>
${formula(`
                                   total cost of all attempts (incl. retries, failures, judge calls)
cost per successful request  =  ───────────────────────────────────────────────────────────────────
                                       requests that succeeded AND passed quality checks

Illustrative month: 2,400 M requests, cost per attempt $0.000255 (u = 35 %)
   3 % fail and are retried once           → attempts = 2,400 M × 1.03          = 2,472 M
   6 % of answers fail the quality check   → successes = 2,400 M × 0.94         = 2,256 M
   online judge on 2 % of traffic at $0.0005 each = 48 M × $0.0005              = $24,000
   cost = 2,472 M × $0.000255 + $24,000 = $630,360 + $24,000                    = $654,360
   per successful request = $654,360 ÷ 2,256 M                                  = $0.000290
                                                        ↑ 14 % above the naive $0.000255
`)}
<p>Fully loaded cost adds retrieval (vector DB, rerankers), embeddings, observability, network egress, storage of artifacts and logs, and the platform team. Report both the GPU-only and the fully loaded figure and say which one you quote.</p>

<h3>3.4 Training economics: 6 × N × tokens</h3>
<p>A dense transformer needs about 2N FLOPs per token for the forward pass and about 4N for the backward pass, so training costs about <b>6 × N × D FLOPs</b> for N parameters and D training tokens (a standard approximation that ignores attention’s sequence-length term). Real hardware delivers a fraction of its peak: the ${term('MFU')} (model FLOPs utilization). MFU is an <b>assumption</b> until you measure it.</p>
${formula(`
H100 SXM dense BF16 peak ≈ 989.5 TFLOPS  (NVIDIA lists 1,979 "with sparsity"; dense is half)
assume MFU = 40 %  → effective 395.8 TFLOPS per GPU

EXAMPLE 1  continued pretraining of an 8B model on 20 B tokens
   FLOPs     = 6 × 8.03 × 10⁹ × 20 × 10⁹          = 9.64 × 10²⁰
   GPU-s     = 9.64 × 10²⁰ ÷ 3.958 × 10¹⁴         = 2.43 × 10⁶ s
   GPU-hours = 2.43 × 10⁶ ÷ 3,600                 ≈ 676
   cost      = 676 × $3.99                         ≈ $2,700   (64 GPUs → ≈ 10.6 hours)

EXAMPLE 2  pretraining a 70B model on 15 T tokens
   FLOPs     = 6 × 70.6 × 10⁹ × 15 × 10¹²         = 6.35 × 10²⁴
   GPU-hours = 6.35 × 10²⁴ ÷ 3.958 × 10¹⁴ ÷ 3,600 ≈ 4.46 M
   cost      ≈ 4.46 M × $3.99                      ≈ $17.8 M at list price, before failures,
                                                     restarts, evaluation and data work
   at MFU 30 % instead of 40 %: × 40/30            ≈ 5.95 M GPU-hours (+33 %)
`)}
<p>For LoRA fine-tuning the frozen base still runs forward and backward through activations, so compute per token remains a large fraction of full fine-tuning; the big savings are in optimizer memory and checkpoint size (${L('v1-finetuning','fine-tuning')}). Most enterprises fine-tune or use APIs rather than pretrain; Example 2 explains why.</p>

<h3>3.5 Inference economics versus API prices</h3>
${table(['Option (list prices, Oct 2026)','Input $/M','Output $/M','Cost per request (1,200 in / 250 out)'],[
 ['Self-hosted 8B on H100 at 35 % utilization (illustrative throughput)','≈ 0.079 (uncached)','≈ 0.79','≈ $0.000255 (720 uncached)'],
 ['gpt-6-luna (OpenAI small tier)','0.10','0.50','$0.000245'],
 ['Claude Haiku 5.5 (≤ 100K-token prompts)','0.10','0.50','$0.000245'],
 ['Gemini 2.5 Flash-Lite','0.10','0.40','$0.000220'],
 ['gpt-6.1-sol / Claude Sonnet 5.5 (mid tier)','2.00','10.00','$0.0049'],
 ['Claude Opus 5.5','4.00','20.00','$0.0098']
])}
<p>Two cautions. First, the models are <b>not equivalent</b>: compare cost at equal measured quality on your eval set, not per token. Second, API tokens differ by tokenizer (Anthropic notes Claude 4.7+ tokenizers produce about 30 % more tokens for the same text), so normalise per request or per task, not per token, when comparing providers.</p>

<h3>3.6 GPU utilization reality</h3>
<p>"Utilization" means four different things; FinOps cares about the last:</p>
<ol>
<li><b>Allocation</b>: GPUs assigned to pods ÷ GPUs paid for (idle nodes, fragmentation).</li>
<li><b>Kernel-time utilization</b>: <code>DCGM_FI_DEV_GPU_UTIL</code> (any kernel running) — near 100 % even when inefficient.</li>
<li><b>Hardware efficiency</b>: tensor pipe / DRAM activity, MFU.</li>
<li><b>Useful utilization</b>: share of paid GPU time spent producing goodput (SLO-meeting, successful work). This is the denominator of unit cost.</li>
</ol>

<h3>3.7 Power and infrastructure constraints</h3>
${formula(`
DGX B200 (8 GPUs) maximum system power ≈ 14.3 kW (NVIDIA)
   4 systems per rack → ≈ 57 kW per rack before networking
   energy for one system for a month at full load: 14.3 kW × 730 h = 10,439 kWh
   × PUE 1.3 × $0.10/kWh (illustrative tariff)    ≈ $1,357 per system per month
H100 SXM: up to 700 W per GPU (configurable)
`)}
<p>On-premises and colocation plans are often limited by rack power, cooling (high-density racks increasingly need liquid cooling) and grid connection lead times, not by GPU price. In the cloud the same constraint appears as regional GPU scarcity.</p>

<h2>4. Where does it fit?</h2>
${fig('Cost data flow for unit economics', svgDiagram({w:900,h:300,
 boxes:[
  {id:'bill',x:20,y:30,w:180,h:56,label:'Cloud / GPU bills',sub:'$/GPU-hour, API invoices'},
  {id:'tel',x:20,y:130,w:180,h:56,label:'Usage telemetry',sub:'tokens, GPU-seconds'},
  {id:'q',x:20,y:230,w:180,h:56,label:'Outcome signals',sub:'success, quality'},
  {id:'ue',x:320,y:130,w:220,h:56,label:'Unit-economics model',sub:'per token / request / success',cls:'hl'},
  {id:'dash',x:650,y:60,w:220,h:56,label:'Dashboards',sub:'by model, tenant, feature'},
  {id:'dec',x:650,y:200,w:220,h:56,label:'Decisions',sub:'routing, caching, commits'}
 ],
 arrows:[{from:'bill',to:'ue'},{from:'tel',to:'ue'},{from:'q',to:'ue'},{from:'ue',to:'dash'},{from:'ue',to:'dec'}]
}), 'Unit cost needs three joined inputs: what you paid, what was consumed, and what succeeded.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Capacity plan</b> (${L('v2-capacity-planning','capacity')}) gives P, D, replicas and utilization.</li>
<li><b>Observability</b> (${L('v2-ai-observability','observability')}) provides token counters and success/quality SLIs.</li>
<li><b>Caching</b> (${L('v2-cache-ops','cache operations')}) changes the uncached share of input.</li>
<li><b>Optimization</b> (${L('v2-finops-optimization','next lesson')}) acts on these numbers: commitments, spot, routing, batch, chargeback, build vs buy.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${checklist([
 {key:'fu-1',text:'Per-request usage records: tenant, feature, model, input / cached input / output tokens, status, latency.'},
 {key:'fu-2',text:'Measured P and D per model × GPU × engine version, refreshed on upgrades.'},
 {key:'fu-3',text:'Useful-utilization metric per pool (goodput-time ÷ paid time), not DCGM util.'},
 {key:'fu-4',text:'Monthly unit-cost report: per M input, per M output, per request, per successful request, GPU-only and fully loaded.'},
 {key:'fu-5',text:'Price book with dates and sources; alerts when provider prices change.'}
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['Cost doubled, traffic flat','Output length or context growth; prefix cache broken','Tokens per request trend; prefix hit rate','Cap output; fix template; re-run sensitivity'],
 ['Cost per request fine, cost per success bad','Retries and quality failures','Retry rate; judge fail rate','Fix the failing segment; retry budgets'],
 ['Self-hosting "cheaper" in a deck, dearer on the bill','Deck used 100 % utilization','Useful utilization 20–35 %','Use measured utilization; include headroom'],
 ['Training run 40 % over budget','MFU assumed 50 %, achieved 30 %; restarts','Step time, MFU, failed-step count','Measure MFU early; checkpoint strategy; capacity blocks'],
 ['Spend spikes from one tenant','Agent loop or unbounded context','Per-tenant token counters','Quotas, max steps, alerts on spend anomaly']
])}

<h2>8. How do we scale it?</h2>
<p>At scale, unit economics becomes a data product: usage records in a warehouse, joined with billing exports normalised to one schema (FOCUS), refreshed daily, with owners per model and tenant. Automate anomaly detection on spend with the same robust methods as ${L('v2-aiops','AIOps')}.</p>

<h2>9. How do we optimize its cost?</h2>
<p>The levers, in the order that usually pays most: raise useful utilization (scale with the day, backfill), cut tokens (output caps, prompt trimming, caching), choose the smallest model that meets the quality bar (routing), then negotiate price (commitments, capacity blocks) and finally hardware choice. Details in ${L('v2-finops-optimization','the next lesson')}.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How do you calculate the cost per token of a self-hosted model?”','<p><i>Answer (≈50 s):</i> "I don’t start from tokens per second on a spec sheet. I measure prefill and decode throughput separately at our SLO with our real length mix, so input and output tokens get separate costs — on an 8B model output was about ten times input per token. Then I divide by useful utilization, because we pay for every hour but only some hours produce goodput: the same GPU went from 28 cents per million output tokens at 100 % to almost two dollars at the 14 % our failover-sized fleet actually ran. Then I convert to cost per successful request, adding retries and quality failures, because that’s what the business buys. And I compare to API prices only at equal measured quality."</p>')}

<div class="connections"><h4>How this connects</h4>
${chain(['$/GPU-hour','÷ measured tokens/s (prefill, decode)','÷ useful utilization','$/M in, $/M out','÷ success rate','$/successful request'])}
<p>Next: ${L('v2-finops-optimization','FinOps optimization')}. Old-book note: the "$6/h and 90,000 tokens/h → $66.67/M" example is arithmetically right but 25 tokens/s is unrealistically low for a GPU; this lesson uses measured-style figures and separates input from output.</p></div>

<h3>Lab</h3>
<p>Planned lab <code>labs/11-capacity/cost.py</code> computes cost per million tokens and per successful request for reserved, on-demand and spot. The core of it:</p>
${code('python',`def unit_costs(gpu_hour, P, D, util, uncached_in=720, out=250, success=0.94, retry=0.03):
    per_s = gpu_hour / 3600
    in_m  = 1e6 / P * per_s / util
    out_m = 1e6 / D * per_s / util
    req   = (uncached_in / P + out / D) * per_s / util
    per_success = req * (1 + retry) / success
    return round(in_m, 3), round(out_m, 3), req, per_success

print(unit_costs(3.99, 40000, 4000, 0.35))   # (0.079, 0.792, 0.000255, 0.000279)`)}
`,
  quiz:[
    {q:'An H100 at $3.99/h decodes 4,000 output tokens/s at the SLO. Cost per million output tokens at 100 % useful utilization?',options:['$0.028','$0.28','$2.77','$3.99'],answer:1,explain:'10⁶ ÷ 4,000 = 250 s × $0.0011083/s ≈ $0.277.'},
    {q:'The same GPU is usefully busy 35 % of paid hours. Cost per million output tokens?',options:['$0.10','$0.28','$0.79','$2.77'],answer:2,explain:'$0.277 ÷ 0.35 ≈ $0.79. Utilization is the dominant variable.'},
    {q:'Training FLOPs for an 8B model on 20 B tokens (6ND)?',options:['9.6 × 10¹⁷','9.6 × 10²⁰','9.6 × 10²³','1.6 × 10²⁰'],answer:1,explain:'6 × 8 × 10⁹ × 20 × 10⁹ ≈ 9.6 × 10²⁰ FLOPs.'},
    {q:'Why is DCGM GPU utilization a poor denominator for unit cost?',options:['It is in MiB','It measures kernel-running time, not useful SLO-meeting work','It ignores power','It is not exported to Prometheus'],answer:1,explain:'Unit cost needs useful utilization: paid GPU time that produced goodput.'},
    {q:'Which is the best primary business metric?',options:['$/GPU-hour','$/M tokens','$/successful request (or task) at equal quality','Peak TFLOPS per dollar'],answer:2,explain:'It includes failures, retries and quality, which per-token metrics hide.'}
  ],
  flashcards:[
    {front:'Cost per M output tokens (self-hosted)',back:'10⁶ ÷ D (decode tok/s at SLO) × $/GPU-s ÷ useful utilization. Input: same with P (prefill tok/s), uncached tokens only.'},
    {front:'Training compute rule of thumb',back:'≈ 6 × N × D FLOPs (2N forward + 4N backward per token). GPU-hours = FLOPs ÷ (peak × MFU) ÷ 3,600.'},
    {front:'MFU',back:'Model FLOPs utilization: achieved model FLOPs/s ÷ hardware peak. An assumption until measured; 30–50 % is a common planning range to test.'},
    {front:'Four meanings of GPU utilization',back:'Allocation; kernel-time (DCGM GPU_UTIL); hardware efficiency (tensor/DRAM active, MFU); useful utilization (goodput time ÷ paid time).'},
    {front:'Cost per successful request',back:'Total cost of all attempts (incl. retries, failures, judges) ÷ requests that succeeded and passed quality checks.'},
    {front:'GPU list prices seen Oct 2026',back:'AWS p5.48xlarge $55.04/h (= $6.88/H100-h, us-east-1); Lambda H100 SXM $3.99/GPU-h, B200 $6.69/GPU-h (8x). Change often.'}
  ]
});

registerLesson({
  id:'v2-finops-optimization', vol:2, part:9, num:2,
  title:'AI FinOps optimization: capacity commitments, spot, routing, caching, chargeback, build vs buy', minutes:90,
  summary:'Once unit costs are measured, optimization is a sequence of controlled experiments. This lesson covers when to commit to reserved capacity and when to rent, where spot capacity is safe, how model routing changes the blended cost, why batch inference is cheaper, how much prompt caching actually saves, how to choose points on the performance-versus-cost frontier, how to attribute shared GPU cost to tenants with OpenCost and the FOCUS billing standard, and how to compute the break-even between buying an API and running your own models.',
  objectives:[
    'Compute the utilization break-even for reserved versus on-demand capacity.',
    'Decide where spot and capacity blocks are appropriate for training, batch and serving.',
    'Compute blended cost under model routing, including router cost and misroutes.',
    'Quantify prompt-caching savings and batch-API savings with current list multipliers.',
    'Design tenant showback and chargeback with OpenCost GPU allocation and FOCUS v1.4.',
    'Compute a build-versus-buy break-even using current API and GPU list prices and state its limits.'
  ],
  prereqs:['v2-finops-unit-economics','v2-ai-gateway','v2-cache-ops'],
  next:['v2-capstone-platform','v3-ch-finops'],
  tags:['finops','optimization','chargeback','routing','caching'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A logistics company lowers cost per parcel by leasing trucks for steady routes and renting for peaks, sending small parcels by van, consolidating overnight deliveries, and billing each customer for what they shipped. Now the real mechanism.')}
<p>AI FinOps optimization is a loop: <b>baseline → hypothesis → workload replay → compare cost, latency and quality → limited rollout → verify on the bill</b>. Every lever below trades something (risk, latency, quality, flexibility) for money; the job is to make those trades explicit.</p>

<h2>2. Why do we need it?</h2>
<p>The Part 7 plan held 534 GPUs at 14 % useful utilization; the API alternative for the same traffic on a small-tier model costs about $588,000 a month in list prices, while 534 H100s at $3.99 cost about $1.56 M. Neither number is "the" answer: optimization finds the mix (commitments, routing, caching, batch, region strategy) that meets the SLO and quality bar at the lowest cost.</p>
${formula(`
Monthly traffic: 80 M req/day × 30 = 2,400 M requests
   input  = 2,400 M × 1,200 = 2.88 T tokens      output = 2,400 M × 250 = 600 B tokens
API small tier ($0.10 / $0.50 per M):   2.88 M × $0.10 + 600,000 × $0.50 = $288,000 + $300,000 = $588,000
API mid tier   ($2 / $10 per M):        2.88 M × $2    + 600,000 × $10   = $5.76 M + $6.00 M    = $11.76 M
Self-hosted 534 H100 always on:         534 × $3.99 × 730 h                                   = $1,555,382
`)}

<h2>3. How does it work internally?</h2>
<h3>3.1 Reserved versus on-demand versus spot versus capacity blocks</h3>
${formula(`
Commitment break-even: with discount d, a committed GPU costs (1 − d) × on-demand for EVERY hour.
On-demand costs only the hours you actually run (fraction h of the month).
   commit is cheaper when  h > 1 − d
   d = 30 % → commit if you need it > 70 % of hours
   d = 40 % → > 60 %          d = 50 % → > 50 %
Strategy: commit to the diurnal FLOOR (needed ~100 % of hours), rent the peak.
`)}
${table(['Workload','Best capacity type','Why'],[
 ['Interactive serving floor','committed / reserved','needed every hour; discount applies fully'],
 ['Interactive daily peak','on-demand (or warm pool on committed)','a few hours a day; cold start must be planned'],
 ['Planned training run, launch event','capacity blocks','guaranteed accelerators for a fixed window (AWS: 1–182 days, up to 8 weeks ahead, no cancellation)'],
 ['Batch inference, evals, embeddings backfill','spot / preemptible','restartable, deadline in hours'],
 ['Checkpointed training','spot with frequent checkpoints, or blocks','preemption costs the work since last checkpoint'],
 ['Latency-critical serving','not spot (except surplus beyond SLO capacity)','reclaim causes cold start under load']
])}
<p>GCP has a related mechanism for GKE: Dynamic Workload Scheduler flex-start, which provisions GPU nodes when available for up to seven days; good for batch and training queues managed by Kueue (${L('v2-distributed-training','distributed training')}).</p>

<h3>3.2 Model selection and routing economics</h3>
${formula(`
blended cost per request
   C = f × C_small + (1 − f) × C_large + C_router + m × f × C_large
       ↑ share routed small                 ↑ router   ↑ misroutes re-run on the large model

Example: C_large = 1.00, C_small = 0.25, f = 0.60, C_router = 0.02, misroute rate m = 0.10
   C = 0.60 × 0.25 + 0.40 × 1.00 + 0.02 + 0.10 × 0.60 × 1.00
     = 0.15 + 0.40 + 0.02 + 0.06 = 0.63          → 37 % saving
   naive estimate without router and misroutes: 0.55 (45 % saving) — 8 points optimistic
   break-even misroute rate (C = 1.00): 0.15 + 0.40 + 0.02 + 0.60 m = 1 → m = 0.72
`)}
<p>Routing must be evaluated on quality per segment (language, task, tenant). A router that sends Arabic queries to a small model that is weak in Arabic saves money and loses customers. See ${L('v2-ai-gateway','AI gateway')} for routing mechanisms.</p>

<h3>3.3 Batch inference economics</h3>
<ul>
<li><b>APIs</b>: Anthropic’s Message Batches API is priced 50 % below standard for input and output (as of Oct 2026). Use it for anything that can wait (nightly summaries, evaluations, classification backfills).</li>
<li><b>Self-hosted</b>: batch work has no TTFT SLO, so it can run at the throughput-optimal batch size (higher D than the interactive SLO allows) in off-peak hours on capacity you already pay for. Its marginal GPU cost in the trough can be near zero.</li>
</ul>

<h3>3.4 Cache savings maths</h3>
${formula(`
Provider prompt caching (Anthropic multipliers on base input price, Oct 2026):
   5-minute cache write 1.25×   1-hour write 2×   cache read 0.1× (0.05× on Opus 5.5 / Sonnet 5.5)

A prefix written once and read n times within the TTL, base input price p:
   without cache: (n + 1) × p
   with 5-min:    1.25 p + 0.1 n p     → cheaper when 1.25 + 0.1 n < n + 1  → n > 0.28 → 1 reuse pays
   with 1-hour:   2 p    + 0.1 n p     → cheaper when n > 1.11              → 2 reuses pay

Example: 3,000-token shared system prompt, 1 M requests/day, Sonnet 5.5 ($2 per M input)
   uncached: 1,000,000 × 3,000 × $2 ÷ 10⁶            = $6,000 / day
   cached reads at 0.05×:                            = $300 / day (+ writes, once per TTL per shard)
   saving ≈ $5,700 / day ≈ $171,000 / month on the prefix alone
`)}
<p>Self-hosted equivalents: prefix-cache hits skip prefill (Part 7 sensitivity: hit rate 40 % → 80 % cut replicas 15 %), and exact or semantic response caches skip the model entirely but carry correctness and tenant-isolation risk (${L('v2-cache-ops','cache operations')}). OpenAI also caches prompts automatically on supported models, with discounts "up to 95 %" and model-specific rules.</p>

<h3>3.5 Performance versus cost: the Pareto frontier</h3>
<p>Plot each configuration (model × quantization × GPU × engine settings) by cost per successful request and by p95 latency (or quality score). Configurations not on the lower-left frontier are dominated: another option is both cheaper and better. Choose a point on the frontier that meets the SLO and quality bar; re-plot after every engine upgrade, because frontiers move.</p>
${table(['Config (illustrative)','$/1k successful req','p95 TTFT','Quality pass','On frontier?'],[
 ['70B BF16 TP4 H100','2.30','0.9 s','97 %','yes (highest quality)'],
 ['70B FP8 TP2 H100','1.30','0.8 s','96.5 %','yes'],
 ['70B BF16 TP2 H200','1.60','0.8 s','97 %','no if FP8 meets bar'],
 ['8B BF16 H100','0.29','0.6 s','91 %','yes (cheapest); fails a 95 % bar'],
 ['8B + routing to 70B FP8 for hard queries','0.75','0.7 s','96 %','yes']
])}

<h3>3.6 Tenant showback and chargeback</h3>
<ul>
<li>${term('Showback')}: show each team its cost; ${term('Chargeback')}: actually bill it. Start with showback until the numbers are trusted.</li>
<li><b>OpenCost</b> (CNCF project) allocates Kubernetes cost including GPUs: it exports <code>node_gpu_hourly_cost</code>, <code>node_gpu_count</code> and <code>container_gpu_allocation</code>, and computes GPU allocation cost = allocated GPUs × node GPU hourly cost. That attributes whole GPUs to pods; shared inference pools need a second step by usage.</li>
<li><b>Usage-based split for shared pools</b>: allocate the pool’s cost by GPU-seconds consumed, estimated per request from prefill and decode tokens with the measured cost model.</li>
<li><b>FOCUS</b> (FinOps Open Cost and Usage Specification) v1.4 (June 2026) normalises billing data across cloud, SaaS, AI and data-centre sources, so API invoices and GPU bills land in one schema.</li>
<li><b>Idle and headroom</b>: show them as a separate platform line; decide policy explicitly (spread pro-rata, or charge the platform).</li>
</ul>
${anim('v2-fin-attribution')}
${formula(`
Shared pool: 40 H100 × $3.99 × 730 h = $116,508 / month
   Tenant A used 52 % of GPU-seconds → $60,584
   Tenant B used 18 %                → $20,971
   idle / failover headroom 30 %     → $34,952  (platform line, or pro-rata: A 74.3 %, B 25.7 %)
   pro-rata: A = 60,584 + 0.743 × 34,952 ≈ $86,553   B = 20,971 + 0.257 × 34,952 ≈ $29,955
`)}

<h3>3.7 Build versus buy: break-even</h3>
${formula(`
Self-host monthly cost  = F + N × c_self      F = fixed (platform people, minimum HA fleet, tooling)
API monthly cost        = N × c_api           N = requests per month
break-even N*           = F ÷ (c_api − c_self)    (only exists if c_api > c_self)

Inputs (list prices Oct 2026; throughput and F illustrative):
   c_self = $0.000255 / request   (8B on H100 at $3.99, 35 % useful utilization)
   F      = $40,000 / month       (assumed: share of platform team + on-call + tooling)

vs a mid-tier API ($2 / $10 per M):  c_api = 1,200 × 2 ÷ 10⁶ + 250 × 10 ÷ 10⁶ = $0.0049
   N* = 40,000 ÷ (0.0049 − 0.000255) ≈ 8.6 M requests/month ≈ 3.3 req/s average
vs a small-tier API ($0.10 / $0.50): c_api = $0.000245 < c_self → no break-even at 35 % utilization
   (self-hosting only wins here with higher utilization, e.g. at 60 %: c_self = $0.000149)
`)}
<p>What the formula does not include: quality differences (an 8B model is not a mid-tier frontier model — compare at equal measured quality), data residency (an API without an in-Kingdom endpoint may be unusable for restricted data regardless of price), rate limits, lock-in, and the time-to-market of using an API. Many organisations end up hybrid: API for frontier capability and low-volume features, self-hosted small models for high-volume, residency-bound or latency-critical paths.</p>

<h2>4. Where does it fit?</h2>
${fig('Optimization levers by layer', svgDiagram({w:900,h:300,
 boxes:[
  {id:'req',x:20,y:120,w:150,h:56,label:'Request',sub:'tokens, model'},
  {id:'gw',x:210,y:120,w:160,h:56,label:'Gateway',sub:'routing, quotas',cls:'hl'},
  {id:'cache',x:410,y:30,w:160,h:56,label:'Caches',sub:'prefix, response'},
  {id:'pool',x:410,y:210,w:160,h:56,label:'GPU pools',sub:'interactive, batch'},
  {id:'cap',x:640,y:210,w:240,h:56,label:'Capacity mix',sub:'commit floor, rent peak, spot batch'},
  {id:'api',x:640,y:30,w:240,h:56,label:'External APIs',sub:'batch API, cached input'},
  {id:'fin',x:640,y:120,w:240,h:56,label:'Chargeback (FOCUS)',sub:'per tenant',cls:'hl'}
 ],
 arrows:[{from:'req',to:'gw'},{from:'gw',to:'cache'},{from:'gw',to:'pool'},{from:'gw',to:'api'},{from:'pool',to:'cap'},{from:'gw',to:'fin',cls:'dash',label:'usage'}]
}), 'Most levers live in the gateway (routing, quotas, caching) and in the capacity mix; chargeback closes the loop by making teams see their costs.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Capacity and multi-region</b> (${L('v2-capacity-planning','capacity')}, ${L('v2-multi-region','multi-region')}): region strategy and brownout decide how much headroom you pay for.</li>
<li><b>Gateway</b> (${L('v2-ai-gateway','gateway')}): routing, quotas and usage records.</li>
<li><b>Caching</b> (${L('v2-prefix-kv-cache','prefix and provider caching')}).</li>
<li><b>Evaluation</b> (${L('v2-evaluation-monitoring','evaluation')}): every optimization needs a quality guardrail.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${checklist([
 {key:'fo-1',text:'Commit to the measured diurnal floor; review commitments quarterly against utilization.'},
 {key:'fo-2',text:'Separate interactive and batch pools; batch on spot or in the trough.'},
 {key:'fo-3',text:'Routing experiments with per-segment quality guardrails and misroute tracking.'},
 {key:'fo-4',text:'Prompt templates designed for caching (stable prefix first, variable content last).'},
 {key:'fo-5',text:'OpenCost + usage-based allocation; FOCUS export; showback before chargeback.'},
 {key:'fo-6',text:'Build-vs-buy model with dated prices, refreshed when prices or quality change.'}
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['Routing launched, total cost rose','Router calls, misroutes, fallbacks, longer outputs from small model','Per-path cost and misroute rate','Include router + misroute in C; tune threshold'],
 ['Reserved GPUs idle at night','Committed to peak instead of floor','Utilization by hour','Commit to floor; backfill batch'],
 ['Cache write costs exceed savings','Prefix varies per request (timestamp at top) or TTL too short','Cache write vs read tokens','Move variable content to the end; check reuse count'],
 ['Spot batch never finishes','Reclaims without checkpoints','Restart count, lost work','Checkpoint more often; diversify instance types/regions'],
 ['Teams dispute chargeback','Idle hidden in rates; unclear method','Disagreement on shared costs','Publish method; show idle separately; showback period'],
 ['Savings on the dashboard, not on the bill','Measured tokens, not dollars; commitments unchanged','Bill vs model diff','Verify on the invoice; release unneeded commitments']
])}

<h2>8. How do we scale it?</h2>
<p>Make optimization continuous: weekly unit-cost review per model and tenant, automated spend-anomaly alerts, an experiment backlog with expected savings and owners, and a quarterly re-plot of the Pareto frontier after engine or model upgrades.</p>

<h2>9. How do we optimize its cost?</h2>
<p>Order of operations that usually works: (1) stop waste (idle GPUs, runaway agents, unbounded context); (2) cache shared prefixes; (3) cap and shorten outputs; (4) route easy traffic to smaller models with guardrails; (5) move deferrable work to batch; (6) commit to the floor; (7) revisit region strategy and brownout; (8) revisit build vs buy. Measure each step on the bill.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Reduce our $100k monthly AI serving spend by 25 % without violating SLOs.”','<p><i>Answer (≈60 s):</i> "First a baseline: cost per successful request by model, tenant and feature, plus utilization by hour and token distributions. Then the cheapest wins: find idle or over-committed GPUs, runaway agents and unbounded contexts. Next, caching — a shared 3,000-token system prompt read at 5 % of input price is a large saving with one reuse paying for a write. Then output caps and routing easy traffic to a smaller model, tracking misroutes and per-segment quality. Deferrable jobs go to batch, which is half price on some APIs and nearly free in our trough. Commitments cover only the floor. Each change ships as an experiment with SLO and quality guardrails, and I only count savings that appear on the invoice."</p>')}

<div class="connections"><h4>How this connects</h4>
${chain(['baseline unit cost','hypothesis','replay','quality + SLO guardrail','rollout','bill verified'])}
${chain(['usage records','GPU-seconds','OpenCost allocation','FOCUS','showback','chargeback'])}
<p>Next: the ${L('v2-capstone-platform','capstone')} applies chargeback and routing to the Atlas platform. Interview practice: ${L('v3-ch-finops','FinOps questions')}.</p></div>
`,
  quiz:[
    {q:'A 40 % commitment discount pays off when the GPU is needed more than what share of hours?',options:['40 %','50 %','60 %','100 %'],answer:2,explain:'Commit if h > 1 − d = 0.6. So commit to the floor, rent the peak.'},
    {q:'Blended routing: 60 % to a model at 25 % cost, router 0.02, 10 % of routed requests re-run on the large model. Blended cost?',options:['0.55','0.57','0.63','0.75'],answer:2,explain:'0.15 + 0.40 + 0.02 + 0.06 = 0.63, not the naive 0.55.'},
    {q:'With 5-minute cache writes at 1.25× and reads at 0.1×, how many reuses make caching a prefix cheaper?',options:['0 (always)','1','5','10'],answer:1,explain:'1.25 + 0.1n < n + 1 holds for n ≥ 1. With 1-hour writes (2×) you need 2 reuses.'},
    {q:'What does OpenCost’s GPU allocation cost represent?',options:['DCGM utilization × price','Allocated GPUs × node GPU hourly cost','Tokens × API price','Power draw × tariff'],answer:1,explain:'It attributes allocated GPUs to workloads; shared pools need a further usage-based split.'},
    {q:'Self-host cost per request $0.000255, small-tier API $0.000245. Break-even volume?',options:['8.6 M/month','Any volume above 1 M','None: the API is cheaper per request at this utilization','Exactly 2,400 M'],answer:2,explain:'c_api < c_self, so F ÷ (c_api − c_self) has no positive solution; raise utilization or compare at equal quality.'},
    {q:'Which workload should usually NOT run on spot capacity?',options:['Nightly batch summaries','Checkpointed fine-tuning','Latency-critical interactive serving floor','Embedding backfill'],answer:2,explain:'Reclaims cause cold starts under load; use spot only for surplus beyond SLO capacity there.'}
  ],
  flashcards:[
    {front:'Commitment break-even',back:'Commit when the share of hours you need the GPU h > 1 − discount d.'},
    {front:'Blended routing cost',back:'f·C_small + (1−f)·C_large + C_router + m·f·C_large (m = misroute re-run rate).'},
    {front:'Anthropic cache multipliers (Oct 2026)',back:'5-min write 1.25×, 1-h write 2×, read 0.1× base input (0.05× Opus 5.5/Sonnet 5.5). Batch API −50%.'},
    {front:'Build vs buy break-even',back:'N* = F ÷ (c_api − c_self). No break-even if c_self ≥ c_api. Compare at equal quality and residency.'},
    {front:'Showback vs chargeback',back:'Showback: visibility of cost per team. Chargeback: costs actually billed. Start with showback.'},
    {front:'FOCUS',back:'FinOps Open Cost and Usage Specification; v1.4 (June 2026) normalises billing across cloud, SaaS, AI and data centre.'},
    {front:'OpenCost GPU metrics',back:'node_gpu_hourly_cost, node_gpu_count, container_gpu_allocation; GPU cost = allocation × node GPU hourly cost.'}
  ]
});

registerGlossary([
  {term:'Unit economics',def:'Cost per unit of useful work — per million input tokens, per million output tokens, per request, per successful request or task.',lesson:'v2-finops-unit-economics'},
  {term:'MFU',def:'Model FLOPs utilization: achieved model FLOPs per second divided by the hardware’s peak; used to convert 6ND training FLOPs into GPU-hours.',lesson:'v2-finops-unit-economics',aliases:['model FLOPs utilization']},
  {term:'Useful utilization',def:'Share of paid accelerator time spent producing SLO-meeting, successful work; the denominator of real unit cost.',lesson:'v2-finops-unit-economics'},
  {term:'Cost per successful request',def:'Total cost of all attempts, including retries, failures and evaluation calls, divided by requests that succeeded and passed quality checks.',lesson:'v2-finops-unit-economics'},
  {term:'Capacity Blocks',def:'AWS EC2 reservations of GPU instances for a future fixed window (1–182 days), with price fixed at reservation and no cancellation.',lesson:'v2-finops-unit-economics',aliases:['capacity block']},
  {term:'Showback',def:'Reporting costs to the teams that caused them without billing them.',lesson:'v2-finops-optimization'},
  {term:'Chargeback',def:'Billing internal teams or tenants for the costs they caused, using an agreed allocation method.',lesson:'v2-finops-optimization'},
  {term:'FOCUS',def:'FinOps Open Cost and Usage Specification, a common schema for billing data across cloud, SaaS, AI and data-centre sources; v1.4 is current (June 2026).',lesson:'v2-finops-optimization'},
  {term:'OpenCost',def:'CNCF project that allocates Kubernetes costs, including GPUs (allocated GPUs × node GPU hourly cost), to namespaces and workloads.',lesson:'v2-finops-optimization'},
  {term:'Pareto frontier',def:'The set of configurations for which no other option is both cheaper and better on the chosen quality or latency metric.',lesson:'v2-finops-optimization'},
  {term:'Blended cost',def:'Average cost per request across routed models, including router overhead and misroutes that are re-run on a larger model.',lesson:'v2-finops-optimization'}
]);
