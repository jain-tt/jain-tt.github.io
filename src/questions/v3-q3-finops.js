/* Volume 3 · Part 2 · Chapter 13 — Questions: AI FinOps (question bank) */
registerLesson({
  id:'v3-ch-finops', vol:3, part:2, num:13,
  title:'Questions: AI FinOps', minutes:150,
  summary:'Ten senior interview questions on the economics of AI platforms: cutting GPU cost without breaking service levels, measuring cost per successful request instead of cost per token, deciding when self-hosting beats an API, using commitments, spot and capacity blocks, charging teams fairly, routing between cheap and expensive models, and proving what caching really saves. Every answer shows the arithmetic, labels prices with their date, and keeps quality in the same sentence as cost.',
  objectives:[
    'Compute cost per token, cost per successful request and cost per successful task from fleet and traffic data.',
    'Build a break-even model for self-hosting versus a managed API using dated list prices and measured throughput.',
    'Choose between on-demand, commitments, spot and capacity blocks using break-even utilisation.',
    'Quantify savings from prompt caching and model cascades, including when they lose money.',
    'Present AI cost to executives as unit economics with owners and guardrails.'
  ],
  prereqs:['v2-finops-unit-economics','v2-finops-optimization','v2-capacity-planning'],
  next:['v3-ch-leadership','v3-whiteboard','v3-prove-10m'],
  tags:['interview','finops','cost','gpu','capacity'],
  html:`
<p>FinOps rounds separate engineers who "made it cheaper" from engineers who can prove a saving, keep the service level, and explain the trade-off to a CFO. This chapter gives you the numbers and the language.</p>

<h2>What interviewers test in this chapter</h2>
<ul>
<li><b>The right denominator.</b> Cost per token is a supply-side number. The business pays for outcomes: a resolved ticket, a completed booking search, a correct answer. Strong candidates move to <b>cost per successful request</b> or <b>cost per successful task</b> without being asked.</li>
<li><b>Arithmetic under pressure.</b> Can you go from an hourly GPU price and a measured throughput to cost per million tokens, and from list API prices to a break-even volume, out loud, with units? Interviewers watch for unit slips (GB vs GiB, per hour vs per month, input vs output tokens).</li>
<li><b>Utilisation honesty.</b> A reserved GPU that sits idle at night is not cheap. Every commitment, self-hosting and capacity decision turns on <b>utilisation at the SLO</b>, not peak benchmark throughput.</li>
<li><b>Guardrails.</b> Savings that break latency, quality or availability are not savings. Expect "what would stop you?" follow-ups.</li>
<li><b>Currency of prices.</b> Prices change monthly. Quote them as "list price, as of Oct 2026" and show the method so the answer survives a price change.</li>
</ul>

<h2>The mental model</h2>
${fig('From spend to unit economics', svgDiagram({w:900,h:320,
  boxes:[
    {id:'b',x:20,y:40,w:170,h:56,label:'Bills',sub:'GPU, API, storage'},
    {id:'m',x:20,y:150,w:170,h:56,label:'Metering',sub:'tokens, GPU-seconds'},
    {id:'a',x:250,y:95,w:180,h:56,label:'Allocation',sub:'team, model, tenant',cls:'hl'},
    {id:'q',x:250,y:220,w:180,h:56,label:'Outcome signal',sub:'success / failure'},
    {id:'u',x:500,y:95,w:190,h:56,label:'Unit cost',sub:'per successful request',cls:'ok'},
    {id:'d',x:740,y:40,w:140,h:50,label:'Levers',sub:'routing, cache…'},
    {id:'g',x:740,y:160,w:140,h:50,label:'Guardrails',sub:'SLO + quality'}
  ],
  arrows:[{from:'b',to:'a'},{from:'m',to:'a'},{from:'a',to:'u'},{from:'q',to:'u'},{from:'u',to:'d'},{from:'d',to:'g',cls:'dash',label:'must hold'}]
}), 'Cost data only becomes useful when it is joined to an outcome. Every lever is accepted only if the guardrails hold.')}
<p>Three formulas carry most answers:</p>
${formula(`
cost per 1M tokens       = hourly fleet cost ÷ (tokens per hour ÷ 1,000,000)

cost per successful req  = total cost ÷ successful requests
                           ↑ includes retries, failures, idle capacity

break-even utilisation   = discounted price ÷ on-demand price
                           (for a commitment; below it, on-demand is cheaper)
`)}

<h2>Weak answer vs strong answer</h2>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"To cut cost by 30% I would move to spot instances and use a smaller model."</p><p>No baseline, no attribution, ignores SLO and quality, and spot on latency-critical serving is a reliability risk.</p></div><div class="good"><h4>Strong answer</h4><p>"First I baseline cost per successful request by model, team and request class, and find where the money goes: idle GPUs, poor batching, oversized models, cache misses. Then I stack levers that compound on the remaining cost, each released behind a canary with p95 latency and quality gates. A typical stack is idle reduction, engine tuning, routing easy traffic to a smaller model, and commitments only for the steady baseline."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Self-hosting is cheaper because GPUs cost $4 an hour and APIs charge per token."</p></div><div class="good"><h4>Strong answer</h4><p>"It depends on volume, utilisation and quality parity. Self-hosting is a fixed monthly cost; an API is variable. I compute the break-even volume using our measured throughput at SLO, include redundancy and team cost, and compare against an API model of the same quality. Below that volume, or with spiky traffic, the API usually wins."</p></div></div>

<h2>How to practise this chapter</h2>
<ul>
<li>Redo every worked example with your own numbers. Use ${L('v2-finops-unit-economics','the unit-economics lesson')} and <code>labs/11-capacity/cost.py</code>.</li>
<li>Practise saying the break-even formula aloud in 20 seconds.</li>
<li>Never present a measured number you have not measured. Use "[In my lab, with model X on GPU Y, I measured …]" or say "illustratively".</li>
</ul>
${callout('warn','Prices in this chapter','All prices are list prices seen on provider pages around Oct 2026 (AWS us-east-1 on-demand feed dated 2026-10-12; Lambda, Anthropic, OpenAI, Google pricing pages on 2026-10-14). Discounts, regions, taxes and negotiated rates differ. Throughput figures are ILLUSTRATIVE unless stated.')}

<div class="connections"><h4>How this connects</h4>
${chain(['Capacity plan','GPU hours','Utilisation at SLO','Cost per 1M tokens','Cost per successful request','Pricing and budgets'])}
${chain(['Caching','Routing','Batching','Commitments','Chargeback','Executive review'])}
<p>Background: ${L('v2-capacity-planning','capacity planning')}, ${L('v2-finops-optimization','FinOps optimization')}, ${L('v2-cache-ops','cache operations')}. Next: ${L('v3-ch-leadership','leadership questions')} and ${L('v3-prove-10m','designing for 10 million users')}.</p></div>
`,
  quiz:[
    {q:'A 3-year GPU commitment costs 35% less than on-demand (illustrative). Below what average utilisation of the committed GPUs does on-demand become cheaper per useful hour?',options:['35%','50%','65%','100%'],answer:2,explain:'Break-even utilisation = discounted price ÷ on-demand price = 0.65. If committed GPUs are busy less than 65% of the time, paying on-demand only for used hours would be cheaper. 35% is the discount, not the threshold.'},
    {q:'A 10,000-token prompt prefix is cached with a 5-minute write at 1.25× and reads at 0.1× of the base input price. From which request does caching start saving money, if reused within the TTL?',options:['The first request','The second request','The fifth request','Never'],answer:1,explain:'One request: 1.25 vs 1.0 (loses). Two requests: 1.25 + 0.1 = 1.35 vs 2.0 (wins). With a 1-hour write at 2×, it takes three requests.'},
    {q:'Which is the best headline unit metric for an AI support assistant?',options:['GPU utilisation from nvidia-smi','Cost per 1M output tokens','Cost per successfully resolved ticket','Total monthly GPU spend'],answer:2,explain:'It joins cost to the business outcome and includes retries, failures and idle capacity. Token cost and utilisation are useful diagnostics but can improve while outcomes get worse.'},
    {q:'Three independent levers save 12%, 10% and 8% of cost. What is the combined saving?',options:['30%','About 27%','About 33%','8%'],answer:1,explain:'Savings compound on the remaining cost: 1 − 0.88 × 0.90 × 0.92 = 1 − 0.729 ≈ 27%. Adding percentages overstates the result.'},
    {q:'Where do self-hosted prefix-cache hits save GPU work?',options:['Decode of output tokens','Prefill of the shared prefix','Network egress','Model loading'],answer:1,explain:'A prefix-cache hit reuses KV for the shared prompt prefix, skipping that prefill compute and cutting time to first token. Each output token still has to be decoded.'}
  ],
  flashcards:[
    {front:'Cost per 1M tokens from GPU price',back:'hourly cost ÷ (tokens per hour ÷ 10⁶). Use tokens served at the SLO, not peak benchmark throughput.'},
    {front:'Cost per successful request',back:'Total cost (including retries, failures, idle) ÷ requests that met the success criterion.'},
    {front:'Break-even utilisation for a commitment',back:'discounted price ÷ on-demand price. Below it, on-demand for used hours is cheaper.'},
    {front:'Self-host vs API break-even volume',back:'monthly fixed cost (GPUs incl. redundancy + people + platform) ÷ API cost per request of an equal-quality model.'},
    {front:'Combining savings',back:'Multiply remaining fractions: 1 − Π(1 − sᵢ). Do not add percentages.'},
    {front:'Prompt-cache break-even (5-min write 1.25×, read 0.1×)',back:'Saves from the 2nd request within TTL. 1-hour write at 2×: from the 3rd.'},
    {front:'What does DCGM GPU utilisation measure?',back:'Fraction of time at least one kernel was running. Not SM efficiency, not tokens. Pair it with tokens per GPU-hour and cost per request.'},
    {front:'EC2 Capacity Blocks key facts (Oct 2026)',back:'Reserve GPU instances up to 8 weeks ahead, 1–14 days or multiples of 7 up to 182 days, no cancellation, instances start terminating 30 min before the end.'}
  ]
});

registerQuestions([
{
  id:'v3fin-01', chapter:'v3-ch-finops', difficulty:3,
  title:'How would you reduce GPU infrastructure cost by 30%?',
  understand:`This is the signature FinOps question. The interviewer is checking whether you start from evidence, rank levers by value and risk, compute savings correctly, and protect latency and quality. Simple explanation: first find out exactly where the GPU money goes and what it buys, then apply a few changes that each remove waste, check each one against the service level, and add up the savings the right way (they multiply, they do not add).`,
  short:`I would not start with a lever, I would start with a baseline. For two to four weeks I'd attribute GPU spend by model, team and request class, and measure utilisation at the SLO, tokens per GPU-hour, idle GPU-hours and cost per successful request. That usually shows three kinds of waste: capacity that is idle, capacity that is busy but inefficient, and capacity that is doing work a cheaper model could do. Then I stack levers in that order: scale down idle and dev capacity and right-size GPU types; tune the engine with batching, quantization and prefix caching; route easy traffic to a smaller model; and only then commit to discounted capacity for the steady baseline, with spot for batch work. Each change ships behind a canary with p95 latency, quality and error-rate gates. And I compute savings as compounding: 12%, 10% and 8% give about 27%, not 30%, so I plan for a buffer.`,
  detailed:`
<h5>Step 1: baseline and attribution (weeks 1–3)</h5>
<ul>
<li>GPU spend by cluster, node pool, namespace and model (OpenCost exposes <code>node_gpu_hourly_cost</code> and <code>container_gpu_allocation</code>; cloud bills in FOCUS format make joins easier).</li>
<li>For each model: requests, input/output tokens, tokens per GPU-hour at SLO, p95 TTFT/TPOT, success rate, cost per successful request.</li>
<li>Idle analysis: GPU-hours with no requests (nights, weekends, dev clusters), allocated vs used GPUs, replicas above HPA need.</li>
</ul>
<h5>Step 2: levers ranked by value and risk</h5>
${table(['Lever','Typical waste it removes','Risk','Guardrail'],[
  ['Idle reduction','Dev/test GPUs running 24×7; overprovisioned min replicas','Cold starts','Scale-to-zero only off the critical path; warm pool for prod'],
  ['Right-size GPU class','Small models on large GPUs','Latency','Benchmark at SLO before moving'],
  ['Engine tuning','Low batch occupancy; no chunked prefill; no prefix cache','Tail latency','p95 TTFT/TPOT gates'],
  ['Quantization (e.g. FP8)','Memory-bound decode, fewer replicas needed','Quality','Eval suite on the quantized model'],
  ['Model routing','Large model answering simple requests','Quality','Escalation + evaluation by request class'],
  ['Context hygiene','Bloated prompts and RAG chunks','Answer quality','Retrieval eval'],
  ['Commitments','Paying on-demand for steady baseline','Lock-in, idle commitment','Commit only below the measured floor'],
  ['Spot / flex capacity','On-demand for batch and training','Interruptions','Checkpointing; never for latency-critical serving']
])}
<h5>Step 3: compute the plan correctly (ILLUSTRATIVE)</h5>
${formula(`
Baseline GPU spend                       = $200,000 / month

STEP 1  idle reduction 12%       remaining = 1 − 0.12        = 0.880
STEP 2  engine tuning 10%        remaining = 0.880 × 0.90    = 0.792
STEP 3  routing 8%               remaining = 0.792 × 0.92    = 0.72864
        saving so far           = 1 − 0.72864               ≈ 27.1%
STEP 4  commit baseline 6%       remaining = 0.72864 × 0.94  ≈ 0.68492
ANSWER  total saving ≈ 31.5%  →  ≈ $63,000 / month
        (adding 12 + 10 + 8 + 6 = 36% would have over-promised by ≈ $9,000)
`)}
<h5>Step 4: release and prove</h5>
<p>One lever at a time where possible, so attribution is clean. Canary 5–10% of traffic, compare p95 latency, error rate and quality metrics with the control, then expand. Report savings as change in <b>cost per successful request at constant volume</b>, because total spend also moves with traffic. Add spend-anomaly alerts so savings do not silently erode (for example someone scales a pool back up).</p>
<h5>What I would not do</h5>
<ul>
<li>Cut capacity reserved for failover or peak (Ramadan and holiday peaks in GCC travel are predictable; plan for them).</li>
<li>Reject or throttle users to hit a number.</li>
<li>Put latency-critical serving on spot.</li>
</ul>
<p>[If you have done this in production, give your real baseline, levers and measured result. If not: "I have modelled this in a lab with the capacity calculator; in production I would validate each lever with a canary."]</p>`,
  diagram:fig('Savings compound on what remains', svgDiagram({w:900,h:280,
    boxes:[
      {id:'b',x:20,y:110,w:140,h:56,label:'Baseline',sub:'$200k/mo'},
      {id:'i',x:190,y:110,w:140,h:56,label:'Idle −12%',sub:'$176k'},
      {id:'e',x:360,y:110,w:140,h:56,label:'Engine −10%',sub:'$158.4k'},
      {id:'r',x:530,y:110,w:140,h:56,label:'Routing −8%',sub:'$145.7k'},
      {id:'c',x:700,y:110,w:180,h:56,label:'Commit −6%',sub:'$137.0k (−31.5%)',cls:'ok'}
    ],
    arrows:[{from:'b',to:'i'},{from:'i',to:'e'},{from:'e',to:'r'},{from:'r',to:'c'}],
    notes:[{x:20,y:220,text:'Illustrative numbers. Each arrow ships behind latency and quality gates.'}]
  }), 'Each lever applies to the cost left after the previous one, so the order affects attribution but not the final product.'),
  followups:[
    {q:'Which lever do you pull first and why?',a:'Idle reduction: it has the highest saving per unit of risk because it removes capacity doing no work. Commitments come last because committing before optimising locks in waste.'},
    {q:'How do you prove the saving was real and not just lower traffic?',a:'Measure cost per successful request (or per 1M tokens at SLO) before and after at comparable traffic, with a control group for routing and engine changes, and attribute each lever separately where possible.'},
    {q:'Quantization saved 25% of GPUs but CSAT dropped. What now?',a:'Roll back or narrow the change to request classes where evaluation shows no quality loss, and find which tasks regressed. A saving that costs customers is a pricing decision for the business, not an engineering win.'},
    {q:'What if 70% of spend is a managed API, not GPUs?',a:'Then the levers change: prompt caching, model routing to cheaper tiers, batch APIs for offline work, output length limits and context hygiene. The method (baseline, attribute, stack, gate) is the same.'}
  ],
  tradeoffs:`
<p><b>Fast savings vs safe savings</b>: idle reduction and commitments are quick; routing and quantization need evaluation work. <b>Commitments vs flexibility</b>: lower unit cost against the risk of paying for idle capacity if models or traffic change (model generations change quickly). <b>Engineering time</b>: a 3% saving that costs two engineers a quarter may not pay back.</p>
<p><b>Operational considerations:</b> savings tracker with owner, expected saving, validated saving and date per lever; anomaly alerts on spend per pool; quarterly re-baseline because model and price changes shift the optimum.</p>`,
  failures:`
<ul>
<li><b>Scale-to-zero on a production pool</b>: first morning requests wait minutes for weights to load. Evidence: TTFT spikes after idle. Fix: minimum warm replicas on critical paths, predictive warm-up.</li>
<li><b>Routing saves cost, increases escalations</b> to human agents; total support cost rises. Fix: measure cost per resolved ticket including human time.</li>
<li><b>Commitment bought before a model migration</b>: the committed GPU type is no longer the right one. Fix: commit only the stable floor; prefer flexible commitment types where available.</li>
</ul>`,
  vocab:[
    {term:'Baseline',def:'Measured cost and performance before any change, the reference for proving savings.'},
    {term:'Compounding savings',def:'Combined saving = 1 − Π(1 − sᵢ); savings apply to remaining cost.'},
    {term:'Utilisation at SLO',def:'Useful work achieved while still meeting latency targets, not peak throughput.'},
    {term:'Scale-to-zero',def:'Removing all replicas when idle; saves cost but adds cold-start latency.'},
    {term:'Savings tracker',def:'Register of optimisation actions with owners, expected and validated savings.'}
  ],
  mistakes:[
    'Jumping to spot instances for latency-critical inference.',
    'Adding saving percentages instead of compounding them.',
    'Measuring success by total spend, which also moves with traffic.',
    'Buying commitments before removing waste.'
  ],
  related:['v2-finops-optimization','v2-finops-unit-economics','v1-k8s-autoscaling']
},
{
  id:'v3fin-02', chapter:'v3-ch-finops', difficulty:2,
  title:'What is the difference between cost per token and cost per successful request?',
  understand:`The interviewer wants to know whether you measure efficiency of the supply (tokens) or of the outcome (successful requests), and how retries, failures and idle capacity enter the number. Simple explanation: cost per token tells you how cheaply you produce text; cost per successful request tells you how much each useful answer really costs after counting everything that failed or was wasted.`,
  short:`Cost per token is a production metric: fleet cost divided by tokens served. It is great for comparing engines, GPUs or providers on the same workload. But it hides three things: failed or rejected responses that still consumed tokens, retries and multi-step calls per user request, and idle or reserved capacity that served nothing. Cost per successful request divides total cost, including all of that, by the requests that actually met the success criterion, such as a valid answer, a resolved ticket or a passed quality check. The two can move in opposite directions: switching to a cheaper model lowers cost per token, but if failures and retries rise, cost per successful request can go up. So I use cost per token to optimise the serving stack and cost per successful request, or per successful task for agents, as the headline business metric.`,
  detailed:`
<h5>Definitions</h5>
${formula(`
cost per 1M tokens       = attributable cost ÷ (tokens served ÷ 1,000,000)

cost per successful req  = (serving + retries + failures + idle + tools + eval)
                           ─────────────────────────────────────────────────
                                    number of successful requests
`)}
<h5>Worked example (ILLUSTRATIVE month)</h5>
${formula(`
Traffic: 1,000,000 user requests; 8% retried once after a timeout
         → model calls = 1,000,000 × 1.08 = 1,080,000
Tokens per call: 1,800 input + 350 output = 2,150
Total tokens = 1,080,000 × 2,150 = 2,322,000,000 = 2,322 M tokens
Monthly cost (GPU fleet incl. idle + gateway + eval) = $34,830

STEP 1  cost per 1M tokens   = $34,830 ÷ 2,322           = $15.00
STEP 2  success criterion: valid JSON + passed guardrail + not escalated
        successes            = 1,000,000 × 0.86          = 860,000
STEP 3  cost per success     = $34,830 ÷ 860,000         ≈ $0.0405
STEP 4  naive per request    = $34,830 ÷ 1,000,000       ≈ $0.0348
ANSWER  the real unit cost is ≈ 16% higher than the naive figure
`)}
<h5>Why they diverge: a model-swap example (ILLUSTRATIVE)</h5>
${table(['','Model A (large)','Model B (small)'],[
  ['Cost per 1M tokens','$15.00','$6.00'],
  ['Tokens per request (incl. retries)','2,150','2,600 (more retries, longer)'],
  ['Cost per request','$0.0323','$0.0156'],
  ['Success rate','86%','61%'],
  ['Cost per success','$0.0375','$0.0256'],
  ['Human handling of failures at $0.50 each','14% × $0.50 = $0.070','39% × $0.50 = $0.195'],
  ['Total per user request','$0.1023','$0.2106']
])}
<p>Model B is 60% cheaper per token and still cheaper per AI success, but once failures cost human time it is twice as expensive per user request. The metric you choose decides the answer.</p>
<h5>Instrumentation</h5>
<ul>
<li>Per call: model, input/output/cached tokens (OpenTelemetry GenAI attributes such as <code>gen_ai.usage.input_tokens</code>, <code>gen_ai.usage.output_tokens</code>; Development status), latency, retry flag, request id.</li>
<li>Per user request: success signal (schema valid, guardrail pass, user feedback, ticket resolved), joined by request id.</li>
<li>Per period: allocated fleet cost including idle, from OpenCost or the cloud bill.</li>
</ul>
<p>For agents use <b>cost per successful task</b>, since one task can involve dozens of model and tool calls.</p>`,
  diagram:fig('Two denominators', svgDiagram({w:900,h:280,
    boxes:[
      {id:'c',x:20,y:110,w:160,h:56,label:'Total cost',sub:'incl. idle, retries'},
      {id:'t',x:280,y:40,w:200,h:56,label:'÷ tokens served',sub:'supply efficiency'},
      {id:'s',x:280,y:180,w:200,h:56,label:'÷ successful requests',sub:'outcome efficiency',cls:'hl'},
      {id:'u1',x:580,y:40,w:290,h:56,label:'Cost per 1M tokens',sub:'compare engines, GPUs'},
      {id:'u2',x:580,y:180,w:290,h:56,label:'Cost per successful request',sub:'business decisions',cls:'ok'}
    ],
    arrows:[{from:'c',to:'t'},{from:'c',to:'s'},{from:'t',to:'u1'},{from:'s',to:'u2'}]
  }), 'Same numerator, different denominators, different decisions.'),
  followups:[
    {q:'How do you define "successful" for a chat assistant?',a:'Agree it with the product owner per use case: for example no error, schema-valid, passed guardrails, and no escalation or negative feedback within the session. Keep the definition versioned so trends stay comparable.'},
    {q:'Input and output tokens cost differently. Does that matter?',a:'Yes: APIs price output several times higher than input, and on GPUs prefill (input) and decode (output) stress different resources. Track them separately and blend only for reporting.'},
    {q:'How do you treat idle capacity kept for failover?',a:'Include it in the numerator, and also report it separately as the cost of resilience so the business sees what availability costs.'}
  ],
  tradeoffs:`
<p><b>Cost per token</b> is easy to compute and comparable across vendors; it ignores quality. <b>Cost per successful request</b> reflects value but needs a reliable success signal and joins across systems. <b>Cost per task/outcome</b> is best for agents and workflows but slower to compute and harder to attribute.</p>
<p><b>Operational considerations:</b> request ids propagated end to end; success signals logged with the request; cost data refreshed daily; dashboards that show both metrics side by side per model and route.</p>`,
  failures:`
<ul>
<li><b>Cheaper model, rising cost per success</b>: retries and escalations increased after a routing change. Evidence: retry rate and escalation rate up. Fix: roll back for affected request classes.</li>
<li><b>Success metric gamed</b>: "no error" counted as success while users abandon. Fix: include user-outcome signals.</li>
<li><b>Missing join keys</b>: costs cannot be tied to requests. Fix: mandatory request and tenant ids at the gateway.</li>
</ul>`,
  vocab:[
    {term:'Cost per 1M tokens',def:'Attributable cost divided by millions of tokens served.'},
    {term:'Cost per successful request',def:'Total cost divided by requests that met the success criterion.'},
    {term:'Success criterion',def:'Versioned definition of a good outcome for a use case.'},
    {term:'Retry amplification',def:'Extra model calls per user request caused by timeouts or validation failures.'},
    {term:'Cost of resilience',def:'Spend on idle capacity held for failover or peaks.'}
  ],
  mistakes:[
    'Treating input and output tokens as the same cost.',
    'Excluding retries and idle capacity from unit cost.',
    'Declaring a cheaper model a win on cost per token alone.',
    'Using total spend as an efficiency metric.'
  ],
  related:['v2-finops-unit-economics','v2-ai-observability']
},
{
  id:'v3fin-03', chapter:'v3-ch-finops', difficulty:3,
  title:'How do you decide between self-hosting a model and buying an API (build vs buy break-even)?',
  understand:`The interviewer wants a quantitative, honest break-even: fixed versus variable cost, utilisation, quality parity, and hidden costs like people and redundancy. Simple explanation: self-hosting costs roughly the same every month whether you use it or not; an API costs per request. Self-hosting wins only when you have enough steady volume to keep your GPUs busy with work of the same quality an API would give you.`,
  short:`I model it as fixed versus variable cost. Self-hosting is a monthly fixed cost: GPUs including redundancy for failover, plus the people, platform, evaluation and on-call to run it. An API is a variable cost per request at a given quality tier. The break-even volume is the fixed cost divided by the API cost per request for a model of equal quality on our workload. Using dated list prices, an 8-GPU p5.48xlarge on-demand in us-east-1 is about 55 dollars an hour, roughly 40 thousand a month, and I'd need at least two for availability. Against a mid-tier API at 2 dollars input and 10 dollars output per million tokens, with an illustrative 2,000-in, 400-out request at 0.8 cents, break-even lands around 13 million requests a month in my example. Against a small-tier API at a twentieth of that price, self-hosting rarely wins. Then the non-cost factors: data residency, customisation, latency control, and the team's ability to run GPUs.`,
  detailed:`
<h5>Inputs (list prices, as of Oct 2026; throughput ILLUSTRATIVE)</h5>
${table(['Item','Value','Source / note'],[
  ['p5.48xlarge on-demand, us-east-1','$55.04 / hour (8 × H100)','AWS pricing feed dated 2026-10-12'],
  ['Lambda H100 SXM on-demand','$3.99 / GPU-hour (8× config)','lambda.ai pricing, 2026-10-14, ex-tax'],
  ['Mid-tier API (e.g. Claude Sonnet 5.5, gpt-6.1-sol)','$2 input / $10 output per 1M tokens','Provider pricing pages, 2026-10-14'],
  ['Small-tier API (e.g. gpt-6-luna; Claude Haiku 5.5 for prompts up to 100K)','$0.10 input / $0.50 output per 1M tokens','Provider pricing pages, 2026-10-14'],
  ['Workload','2,000 input + 400 output tokens per request','Assumption'],
  ['Measured capacity of one node at SLO','40 requests/s','ILLUSTRATIVE: measure your own model, engine and token mix'],
  ['Platform people cost','$25,000 / month','ILLUSTRATIVE (share of engineers, on-call)']
])}
<h5>The arithmetic</h5>
${formula(`
STEP 1  one node per month   = $55.04 × 730 h            = $40,179
STEP 2  two nodes (N+1)      = 2 × $40,179               = $80,358
STEP 3  fixed monthly cost F = $80,358 + $25,000         = $105,358

STEP 4  API cost per request (mid tier)
        input  = 2,000 ÷ 1,000,000 × $2                  = $0.0040
        output =   400 ÷ 1,000,000 × $10                 = $0.0040
        total                                            = $0.0080

STEP 5  break-even volume    = F ÷ $0.0080
                             = 105,358 ÷ 0.0080          ≈ 13.2 M requests / month
                             ≈ 13.2 M ÷ (730 × 3,600 s)  ≈ 5.0 requests/s average

STEP 6  capacity check: one node at 40 req/s × 3,600 × 730 ≈ 105 M requests/month
        → break-even needs only ≈ 12.5% of one node's capacity, BUT
          peaks, not averages, size the fleet

STEP 7  against the small tier: API per request
        = 2,000 × $0.10/1M + 400 × $0.50/1M = $0.0002 + $0.0002 = $0.0004
        break-even = 105,358 ÷ 0.0004 ≈ 263 M requests/month
        → above one node's ≈ 105 M capacity: self-hosting never breaks even
ANSWER  the comparison only makes sense against an API of EQUAL QUALITY
`)}
<h5>Sensitivity: self-hosted cost per request vs volume (fixed F = $105,358)</h5>
${table(['Monthly requests','Self-host $/request','vs mid-tier API $0.008'],[
  ['5 M','$0.0211','API 2.6× cheaper'],
  ['13.2 M','$0.0080','break-even'],
  ['50 M','$0.0021','self-host 3.8× cheaper'],
  ['100 M','$0.0011','self-host 7.6× cheaper (near one node\'s capacity; add nodes)']
])}
<p>A cheaper GPU source changes F: 8 × $3.99 × 730 ≈ $23,302 per 8-GPU node per month at Lambda list price, which roughly halves the GPU part of F; availability, region and support terms differ.</p>
<h5>Hidden costs and non-cost factors</h5>
<ul>
<li>Redundancy and peak headroom; idle capacity at night unless traffic is flat.</li>
<li>Evaluation, model upgrades, security patching, on-call; GPU scarcity and lead times.</li>
<li><b>Quality parity</b>: an open-weight model must match the API model on your evaluation set, or the comparison is invalid.</li>
<li><b>For</b> self-hosting: data residency (for KSA workloads, where an API's processing location may not be acceptable), fine-tuning, latency control, no rate limits. <b>For</b> APIs: frontier quality, zero ops, elastic capacity, fast model upgrades.</li>
</ul>
<p>A hybrid is common: API for frontier-quality or spiky work, self-hosted small models for high-volume, well-defined tasks.</p>`,
  diagram:fig('Fixed vs variable cost', svgDiagram({w:900,h:300,
    boxes:[
      {id:'f',x:20,y:40,w:220,h:56,label:'Self-host',sub:'fixed ≈ $105k/mo (illus.)'},
      {id:'a',x:20,y:190,w:220,h:56,label:'Mid-tier API',sub:'$0.008 × volume'},
      {id:'x',x:340,y:110,w:200,h:60,label:'Break-even',sub:'≈ 13.2 M req/mo',cls:'hl'},
      {id:'l',x:640,y:40,w:240,h:56,label:'Below: API cheaper',sub:'spiky or low volume'},
      {id:'h',x:640,y:190,w:240,h:56,label:'Above: self-host cheaper',sub:'if quality matches',cls:'ok'}
    ],
    arrows:[{from:'f',to:'x'},{from:'a',to:'x'},{from:'x',to:'l'},{from:'x',to:'h'}]
  }), 'The break-even point moves with GPU price, measured throughput, people cost and which API tier is truly equivalent.'),
  followups:[
    {q:'Your traffic peaks at 5× average during Ramadan evenings. How does that change the model?',a:'Self-hosted capacity is sized for peak, so average utilisation drops and effective cost per request rises. Consider a hybrid: self-host the baseline and burst to an API, or schedule batch work into off-peak hours to raise utilisation.'},
    {q:'What throughput number do you use?',a:'Requests per second the deployment sustains while meeting p95 TTFT and TPOT targets on our real token-length distribution, measured with a load generator, not vendor peak tokens per second.'},
    {q:'What about reserved GPUs?',a:'They reduce F, which lowers break-even volume, but they raise the cost of being wrong if traffic or model choice changes. Commit only the stable floor.'},
    {q:'How does data residency affect it in Saudi Arabia?',a:'If personal data must be processed in-Kingdom and the API provider cannot guarantee that, the API option may be excluded for those workloads regardless of price, and the comparison becomes in-Kingdom self-hosting versus not offering the feature. Region availability changes; check current cloud regions.'}
  ],
  tradeoffs:`
<p><b>Self-host</b>: lower marginal cost at high steady volume, control, residency; high fixed cost, people, scarcity risk. <b>API</b>: elastic, best quality, no ops; per-token cost, rate limits, vendor terms and data processing location. <b>Hybrid</b>: best of both with routing complexity.</p>
<p><b>Operational considerations:</b> keep the model and inputs in a spreadsheet or <code>labs/11-capacity/cost.py</code> so you can rerun it monthly as prices change; record the date and source of every price; re-measure throughput after engine upgrades.</p>`,
  failures:`
<ul>
<li><b>Self-hosted for cost, then traffic halves</b>: fixed cost stays, cost per request doubles. Fix: scenario analysis before committing; avoid long commitments for new products.</li>
<li><b>Quality gap discovered after migration</b>: escalations rise. Fix: evaluation parity gate before switching.</li>
<li><b>API rate limits at peak</b> cause errors. Fix: provisioned throughput or fallback to another provider/model.</li>
</ul>`,
  vocab:[
    {term:'Break-even volume',def:'Monthly volume at which self-hosted fixed cost equals API variable cost.'},
    {term:'Fixed vs variable cost',def:'Costs that do not change with volume (reserved GPUs, team) vs costs per unit (API tokens).'},
    {term:'Quality parity',def:'Evidence that two options meet the same evaluation bar on your workload.'},
    {term:'N+1 redundancy',def:'One extra unit of capacity so a single failure does not breach SLO.'},
    {term:'Hybrid sourcing',def:'Combining self-hosted and API capacity, routed by request class or load.'}
  ],
  mistakes:[
    'Comparing GPU-hour price to per-token price without a throughput measurement.',
    'Comparing a self-hosted small model with a frontier API without checking quality.',
    'Forgetting redundancy, peak sizing and people cost.',
    'Quoting prices without dates.'
  ],
  related:['v2-finops-optimization','v2-capacity-planning','v1-benchmarking']
},
{
  id:'v3fin-04', chapter:'v3-ch-finops', difficulty:2,
  title:'When do you use on-demand, commitments, spot or capacity blocks for GPUs?',
  understand:`They want a purchasing strategy matched to workload shape, with the maths behind commitments and the reliability constraints of spot. Simple explanation: pay on-demand for unpredictable bursts, commit (reserve) only the capacity you are sure to use all the time, use spot for work that can be interrupted, and book short fixed-term blocks for planned events like a training run.`,
  short:`I match purchase type to workload shape. The steady floor of production inference, the capacity I'm confident runs around the clock, goes on commitments such as reserved instances or savings plans. The rule is break-even utilisation: a commitment only wins if I use it more than the ratio of committed price to on-demand price, so at an illustrative 30% discount I need above 70% utilisation. Variable demand above the floor runs on-demand. Interruptible work, like batch inference, evaluation runs or checkpointed training, goes to spot or preemptible capacity. And for planned, time-boxed needs, like a fine-tuning run or a known event, I use capacity reservations for a fixed window, for example EC2 Capacity Blocks for ML, which you can book up to eight weeks ahead for one to fourteen days or multiples of seven up to 182 days, with no cancellation. Latency-critical serving never depends on spot.`,
  detailed:`
<h5>Purchase options</h5>
${table(['Option','Best for','Watch out for'],[
  ['On-demand','Unpredictable bursts, new products','Highest unit price; capacity not guaranteed for scarce GPUs'],
  ['Commitments (reserved instances, savings plans, committed use)','Steady 24×7 floor','Pay whether used or not; term lock-in across fast GPU generations'],
  ['Spot / preemptible','Batch inference, evaluation, checkpointed training','Interruptions with short notice; capacity varies by region and type'],
  ['EC2 Capacity Blocks for ML','Planned training or events','Book up to 8 weeks ahead; 1–14 days or multiples of 7 up to 182 days; up to 64 instances per block (256 across blocks); no cancellation; price fixed at booking; instances begin terminating 30 min before end'],
  ['GKE flex-start (Dynamic Workload Scheduler)','Jobs that can wait for capacity','Nodes run for a maximum of 7 days; queued provisioning integrates with Kueue']
])}
<p>(Capacity Blocks and DWS facts from AWS and Google docs as of Oct 2026. Discount levels for commitments vary by provider, term and negotiation, so the examples below use a variable.)</p>
<h5>Break-even utilisation for a commitment</h5>
${formula(`
let on-demand price = P, commitment discount = d (ILLUSTRATIVE d = 30%)

effective cost per USED hour with commitment = P × (1 − d) ÷ u
                                                ↑ u = fraction of hours used
on-demand cost per used hour                 = P

commitment wins when  P × (1 − d) ÷ u  <  P
                      u  >  1 − d
                      u  >  0.70

Example: u = 0.60 → P × 0.70 ÷ 0.60 = 1.167 P   (17% MORE than on-demand)
         u = 0.90 → P × 0.70 ÷ 0.90 = 0.778 P   (22% less than on-demand)
`)}
<h5>Sizing the committed floor (ILLUSTRATIVE)</h5>
<p>Take hourly GPU demand over the last 8–12 weeks. Commit to roughly the level exceeded most of the time (for example the 10th–20th percentile of hourly demand), not the average. Above that, use on-demand and, for deferrable work, spot. For GCC travel, include predictable seasonal peaks (Ramadan evenings, Eid, summer holidays) in on-demand or short reservations rather than year-round commitments.</p>
<h5>Spot done right</h5>
<ul>
<li>Workloads: batch embedding, offline evaluation, synthetic data generation, training with frequent checkpoints.</li>
<li>Diversify instance types and zones; handle interruption notices (Karpenter interruption handling, node termination handlers); checkpoint to object storage.</li>
<li>For serving, spot may add surplus replicas above a reliable on-demand/committed floor, never be the floor.</li>
</ul>
<h5>Example blended plan (ILLUSTRATIVE)</h5>
${table(['Layer','GPUs','Purchase'],[
  ['24×7 inference floor','16','1-year commitment'],
  ['Daily peak above floor','0–12','On-demand with autoscaling'],
  ['Nightly batch evaluation','8 for 6 h','Spot'],
  ['Quarterly fine-tune','32 for 5 days','Capacity Block booked 6 weeks ahead']
])}`,
  diagram:fig('Layered GPU purchasing', svgDiagram({w:900,h:300,
    boxes:[
      {id:'c',x:20,y:200,w:860,h:50,label:'Committed floor: steady 24×7 inference',cls:'ok'},
      {id:'o',x:20,y:130,w:520,h:50,label:'On-demand: daily and seasonal peaks'},
      {id:'s',x:560,y:130,w:320,h:50,label:'Spot: batch, eval, training',cls:'warn'},
      {id:'b',x:20,y:50,w:400,h:56,label:'Capacity Block',sub:'planned fine-tune, fixed window',cls:'hl'},
      {id:'f',x:460,y:50,w:420,h:56,label:'Flex-start / queued',sub:'jobs that can wait for capacity'}
    ],
    arrows:[]
  }), 'Commit only the floor; everything above it stays flexible.'),
  followups:[
    {q:'Why not commit to all capacity for the biggest discount?',a:'Because utilisation below the break-even (1 − d) makes the commitment more expensive per used hour than on-demand, and GPU generations and model sizes change within a commitment term.'},
    {q:'Can you run latency-critical inference on spot?',a:'Only as surplus above a reliable floor, with fast drain and rescheduling. Interruptions at peak would breach the SLO; the cold start of a large model can take minutes.'},
    {q:'A Capacity Block ends mid-training. What happens?',a:'Instances begin terminating 30 minutes before the end, so the job must checkpoint before then and resume elsewhere; plan block length with margin and automate checkpoint-on-notice.'}
  ],
  tradeoffs:`
<p><b>Commitments</b>: lowest unit cost, highest lock-in. <b>On-demand</b>: flexible, expensive, capacity not guaranteed for scarce GPUs. <b>Spot</b>: cheap, interruptible. <b>Capacity Blocks</b>: guaranteed for a window, no cancellation, price set at booking.</p>
<p><b>Operational considerations:</b> monthly review of commitment utilisation; alerts when utilisation falls below break-even; Karpenter NodePools per purchase type with taints so only interruptible workloads land on spot; booking calendar for blocks.</p>`,
  failures:`
<ul>
<li><b>Commitment utilisation at 55%</b> after a model was quantized and needed half the GPUs. Fix: shift other workloads onto committed capacity; avoid new commitments until utilisation recovers.</li>
<li><b>Spot interruption wave</b> kills nightly evaluation; release delayed. Fix: diversify types/zones, checkpoint, fall back to on-demand for deadline-critical runs.</li>
<li><b>No capacity on-demand</b> during a regional shortage at peak. Fix: reservations for critical floor, multi-region or API fallback.</li>
</ul>`,
  vocab:[
    {term:'Break-even utilisation',def:'Usage fraction above which a commitment is cheaper per used hour: 1 − discount.'},
    {term:'Committed floor',def:'Capacity level that demand exceeds almost all the time; candidate for commitments.'},
    {term:'Spot / preemptible',def:'Discounted spare capacity that can be reclaimed with short notice.'},
    {term:'Capacity Block',def:'AWS reservation of GPU instances for a fixed future window, no cancellation.'},
    {term:'Flex-start',def:'GKE Dynamic Workload Scheduler mode that provisions capacity when available; nodes run up to 7 days.'}
  ],
  mistakes:[
    'Committing to average or peak demand instead of the floor.',
    'Inventing discount percentages instead of using a variable or a real quote.',
    'Putting latency-critical serving on spot.',
    'Forgetting that Capacity Blocks cannot be cancelled.'
  ],
  related:['v2-finops-optimization','v1-k8s-autoscaling','v2-distributed-training']
},
{
  id:'v3fin-05', chapter:'v3-ch-finops', difficulty:2,
  title:'How do you implement chargeback or showback for a shared GPU and LLM platform?',
  understand:`The interviewer checks whether you can make shared AI costs visible and fair: what to meter, how to split shared and idle costs, and how to avoid incentives that cause waste. Simple explanation: measure what each team uses (GPU time, tokens), add a fair share of the shared costs, show it to them (showback) or bill them (chargeback), and choose rules that reward efficient use.`,
  short:`I meter at two layers. For self-hosted GPUs, allocation per namespace and workload from Kubernetes, priced with tools like OpenCost, which exposes GPU hourly cost and container GPU allocation. For model usage, tokens per tenant, team and model metered at the AI gateway, including cached and output tokens, priced at either API list price or our internal cost per token. Shared costs, such as the gateway, observability, platform team and idle headroom, are allocated by an explicit rule, usually proportional to usage, with idle reserve shown as its own line. I normalise billing data in FOCUS format so cloud, API and SaaS costs join. I start with showback, so teams see their numbers for a quarter, then move to chargeback when the numbers are trusted. And I watch the incentives: charging only for GPU requests rewards overprovisioning by others, while charging for allocation encourages teams to right-size.`,
  detailed:`
<h5>What to meter</h5>
${table(['Cost source','Metering','Unit'],[
  ['Self-hosted GPU pools','OpenCost: node_gpu_hourly_cost, node_gpu_count, container_gpu_allocation (GPU allocation cost = allocation × node GPU hourly cost)','GPU-hours by namespace/label'],
  ['Managed model APIs','Provider usage export + gateway logs by tenant key','Input, cached input, output tokens by model'],
  ['Shared self-hosted model endpoints','Gateway token metering per tenant','Tokens × internal $/token'],
  ['Platform overhead','Cloud bill tags','$ per month'],
  ['Storage, vector DBs, egress','Cloud bill, FOCUS-normalised','$ per month']
])}
<p>FOCUS (FinOps Open Cost and Usage Specification), latest v1.4 released 2026-06-04, normalises billing across cloud, AI, SaaS and data centre so these sources can be joined.</p>
<h5>Pricing a shared model endpoint</h5>
${formula(`
Shared Llama-class endpoint (ILLUSTRATIVE month)
fleet cost incl. redundancy       = $60,000
tokens served                     = 4,000 M
internal rate                     = $60,000 ÷ 4,000 M  = $15 per 1M tokens

Team usage:  Support 2,400 M → $36,000   (60%)
             Search  1,200 M → $18,000   (30%)
             Ops       400 M → $6,000    (10%)
`)}
<h5>Shared and idle costs</h5>
${formula(`
Shared GPU pool $100,000/month; measured GPU-seconds:
Team A 50%, Team B 30%, idle 20%

Option 1 (proportional): idle spread by usage share
  A = $50,000 + $20,000 × 50/80 = $62,500
  B = $30,000 + $20,000 × 30/80 = $37,500
Option 2 (platform-owned idle): A $50,000, B $30,000, platform $20,000
  → makes idle visible and gives the platform team a reason to cut it
`)}
<h5>Incentive design</h5>
<ul>
<li>Charge on <b>allocation</b> (what you reserve) more than on usage, so teams that request 4 GPUs and use 1 pay for 4 and right-size.</li>
<li>Show <b>cost per successful request</b> per team so efficiency, not just size, is visible.</li>
<li>Give teams levers they control (model choice, prompt length, cache-friendly prompts) and the data to use them.</li>
<li>Budgets and quotas per tenant at the gateway; for example Agent Router (formerly Envoy AI Gateway) supports usage-based rate limits on InputToken, CachedInputToken, OutputToken, TotalToken or a CEL expression, charged after the response completes so later requests get 429.</li>
</ul>
<h5>Rollout</h5>
<p>Showback for one or two quarters, reconcile with finance until the totals match the bill within an agreed tolerance, publish the allocation rules, then chargeback. Separate showback from chargeback in conversations: one informs, the other moves budgets.</p>`,
  diagram:fig('Chargeback data flow', svgDiagram({w:900,h:300,
    boxes:[
      {id:'k',x:20,y:30,w:170,h:50,label:'Kubernetes',sub:'GPU allocation'},
      {id:'g',x:20,y:120,w:170,h:50,label:'AI gateway',sub:'tokens per tenant'},
      {id:'b',x:20,y:210,w:170,h:50,label:'Cloud + API bills',sub:'FOCUS export'},
      {id:'o',x:270,y:30,w:170,h:50,label:'OpenCost',sub:'$ per workload'},
      {id:'w',x:270,y:150,w:190,h:60,label:'Cost warehouse',sub:'join + allocation rules',cls:'hl'},
      {id:'s',x:540,y:90,w:160,h:50,label:'Showback',sub:'dashboards'},
      {id:'c',x:540,y:200,w:160,h:50,label:'Chargeback',sub:'finance'},
      {id:'u',x:740,y:140,w:140,h:56,label:'Unit cost',sub:'per success',cls:'ok'}
    ],
    arrows:[{from:'k',to:'o'},{from:'o',to:'w'},{from:'g',to:'w'},{from:'b',to:'w'},{from:'w',to:'s'},{from:'w',to:'c'},{from:'s',to:'u',cls:'dash'}]
  }), 'Metering from two layers, one set of written allocation rules, and showback before chargeback.'),
  followups:[
    {q:'How do you charge for a GPU shared by MIG slices or time-slicing?',a:'MIG slices are discrete devices with fixed fractions, so charge per slice-hour by its fraction of the GPU. Time-slicing has no isolation or reliable per-pod accounting, so charge by allocation (replicas granted) or measured usage from the engine, and state the approximation.'},
    {q:'A team disputes its bill. What do you show?',a:'The allocation rule, their raw usage (GPU-hours, tokens by model), the rate, and the reconciliation to the cloud bill. Disputes usually come from undocumented shared-cost rules.'},
    {q:'Should cached tokens be cheaper for the team?',a:'Yes, pass through the provider discount or internal saving, so teams have an incentive to write cache-friendly prompts.'}
  ],
  tradeoffs:`
<p><b>Showback</b> builds trust and awareness with no budget friction; <b>chargeback</b> drives behaviour but invites disputes. <b>Usage-based</b> allocation feels fair but hides reservation waste; <b>allocation-based</b> pushes right-sizing but penalises teams for platform minimums. <b>Simple rules</b> beat precise rules nobody understands.</p>
<p><b>Operational considerations:</b> mandatory labels (team, cost-centre, model, environment) enforced by admission policy; gateway API keys mapped to tenants; daily cost pipeline with data-quality checks; monthly reconciliation with finance.</p>`,
  failures:`
<ul>
<li><b>Unlabelled workloads</b>: 30% of GPU spend unallocated. Fix: admission control rejects pods without cost labels.</li>
<li><b>Shared key across teams</b> at the gateway: token usage cannot be split. Fix: per-team keys or tenant headers validated at the gateway.</li>
<li><b>Totals do not match the bill</b> because of discounts and credits. Fix: amortise commitments and credits explicitly in the warehouse.</li>
</ul>`,
  vocab:[
    {term:'Showback',def:'Reporting costs to teams without billing them.'},
    {term:'Chargeback',def:'Billing internal teams for their share of costs.'},
    {term:'FOCUS',def:'FinOps Open Cost and Usage Specification; v1.4 (2026-06-04) normalises billing data across providers.'},
    {term:'OpenCost',def:'CNCF project allocating Kubernetes costs, including GPU allocation cost.'},
    {term:'Allocation rule',def:'Written method for splitting shared and idle costs.'}
  ],
  mistakes:[
    'Charging only by pod requests without visibility of usage, or only by usage without visibility of reservations.',
    'Hiding idle capacity inside everyone\'s bill so nobody owns it.',
    'Going straight to chargeback before numbers reconcile.',
    'Metering tokens without tenant identity.'
  ],
  related:['v2-finops-optimization','v2-ai-gateway','v1-k8s-gpu-stack']
},
{
  id:'v3fin-06', chapter:'v3-ch-finops', difficulty:3,
  title:'What are the economics of model routing and cascades?',
  understand:`The interviewer wants the expected-cost formula and the quality catch: routing saves money only if the cheap model is good enough often enough and failures are caught. Simple explanation: send each request to the cheapest model that can handle it; for a cascade, try the cheap model first and escalate to the expensive one only when needed. Savings depend on the escalation rate and on how many bad cheap answers slip through.`,
  short:`There are two patterns. A router classifies each request up front and sends it to a small or large model. A cascade always tries the small model first and escalates to the large one when a check fails, such as low confidence, a failed schema or a verifier. The expected cost of a cascade is the small model's cost plus the escalation rate times the large model's cost. With dated list prices, a small tier at 10 cents input and 50 cents output per million tokens against a flagship at 10 and 50 dollars is a hundred-fold gap, so even with 20% escalation a cascade costs about a fifth of always using the large model. The catch is quality: escalation adds latency for escalated requests, and the dangerous case is the bad small-model answer that passes the check. So I measure, per request class, the escalation rate, the false-accept rate and the end-to-end success, and only route classes where evaluation says the small model is good enough.`,
  detailed:`
<h5>Prices used (list prices, as of Oct 2026, per 1M tokens)</h5>
<p>gpt-6-luna $0.10 input / $0.50 output (small tier); gpt-6-astra $10 / $50 (flagship). Workload: 2,000 input + 400 output tokens per request.</p>
${formula(`
STEP 1  small cost  c_s = 2,000 × $0.10/1M + 400 × $0.50/1M
                       = $0.0002 + $0.0002            = $0.0004
STEP 2  large cost  c_l = 2,000 × $10/1M + 400 × $50/1M
                       = $0.0200 + $0.0200            = $0.0400

Cascade (small always runs, escalate with rate e):
        E[cost] = c_s + e × c_l
STEP 3  e = 0.20 → 0.0004 + 0.20 × 0.0400            = $0.0084
STEP 4  saving vs always-large = 1 − 0.0084 ÷ 0.0400  = 79%

Break-even escalation rate (cascade = always large):
        c_s + e × c_l = c_l   →   e = 1 − c_s ÷ c_l = 1 − 0.01 = 0.99

Router (classifier cost c_r, fraction p sent to small, no retry):
        E[cost] = c_r + p × c_s + (1 − p) × c_l
STEP 5  c_r = $0.0001, p = 0.75 →
        0.0001 + 0.75 × 0.0004 + 0.25 × 0.0400        = $0.0104
ANSWER  both save ≈ 74–79% on paper; quality decides which is real
`)}
<h5>The quality side</h5>
${table(['Metric','Meaning','Why it matters'],[
  ['Escalation rate e','Share of requests sent on to the large model','Drives cost and latency'],
  ['False-accept rate','Bad small-model answers that passed the check','Silent quality loss; the real risk'],
  ['False-escalation rate','Good small answers escalated anyway','Wasted cost'],
  ['Latency of escalated requests','Small attempt + large attempt','p95 latency can rise even as average cost falls'],
  ['End-to-end success per class','Outcome after routing','The decision metric']
])}
<p>When the price gap is large (here 100×), the cascade almost always wins on cost, and the design question becomes purely quality and latency. When the gap is small (for example 2–3×), a cascade with high escalation can cost more than always using the large model, because you pay for both.</p>
<h5>Implementation notes</h5>
<ul>
<li>Escalation signals: schema validation, a verifier model or rules, retrieval coverage, model self-reported confidence (weak alone), task class.</li>
<li>Route by request class with per-class evaluation; keep regulated or high-risk classes on the validated model.</li>
<li>Implement in the AI gateway so applications do not hard-code models; log the route decision for cost attribution.</li>
<li>Re-evaluate on every model release; price and quality tiers change often.</li>
</ul>`,
  diagram:fig('Cascade with an escalation gate', svgDiagram({w:900,h:280,
    boxes:[
      {id:'r',x:20,y:110,w:120,h:56,label:'Request'},
      {id:'s',x:190,y:110,w:160,h:56,label:'Small model',sub:'$0.0004 (illus.)',cls:'ok'},
      {id:'v',x:400,y:110,w:160,h:56,label:'Check',sub:'schema, verifier',cls:'hl'},
      {id:'a',x:640,y:30,w:230,h:56,label:'Accept (1 − e)',sub:'watch false accepts'},
      {id:'l',x:640,y:190,w:230,h:56,label:'Large model (e)',sub:'$0.04 (illus.)',cls:'warn'}
    ],
    arrows:[{from:'r',to:'s'},{from:'s',to:'v'},{from:'v',to:'a',label:'pass'},{from:'v',to:'l',label:'fail'}]
  }), 'Cost is decided by the escalation rate; quality is decided by what slips through the check.'),
  followups:[
    {q:'When is a router better than a cascade?',a:'When escalated requests cannot afford the extra latency of trying the small model first, or when the small model is not much cheaper. A router pays a small classification cost and avoids double calls.'},
    {q:'How do you set the escalation threshold?',a:'Sweep it on a labelled evaluation set per request class and pick the point that meets the quality target at the lowest expected cost; then monitor false accepts online via sampling and user signals.'},
    {q:'Does prompt caching change routing economics?',a:'Yes: if the large model\'s long system prompt is cached, its effective input cost falls, narrowing the gap. Compute with effective, not list, prices.'}
  ],
  tradeoffs:`
<p><b>Cascade</b>: simple, high savings with large price gaps, adds latency on escalation. <b>Router</b>: one call per request, but a misrouted hard request gets a weak answer with no second chance. <b>Single large model</b>: simplest, best quality, highest cost.</p>
<p><b>Operational considerations:</b> per-class dashboards of route share, escalation rate, false-accept samples, cost per success and p95 latency; kill switch to route everything to the validated model during incidents.</p>`,
  failures:`
<ul>
<li><b>Verifier too lenient</b>: false accepts rise, complaints follow. Fix: tighten threshold, add task-specific checks, sample reviews.</li>
<li><b>Small model outage</b>: every request escalates, cost spikes. Fix: alerts on escalation rate and budget guard.</li>
<li><b>Provider price change</b> makes the routing table wrong. Fix: prices in config with dates; recompute monthly.</li>
</ul>`,
  vocab:[
    {term:'Model cascade',def:'Try a cheap model first; escalate to a stronger model when a check fails.'},
    {term:'Model router',def:'Classifier that sends each request to one model up front.'},
    {term:'Escalation rate',def:'Fraction of requests passed to the more expensive model.'},
    {term:'False accept',def:'A wrong cheap answer that passed the escalation check.'},
    {term:'Expected cost',def:'Probability-weighted average cost per request across routes.'}
  ],
  mistakes:[
    'Computing savings from prices only, without escalation and false-accept rates.',
    'Forgetting that cascades pay for both models on escalated requests.',
    'Routing regulated or high-risk tasks to unvalidated models.',
    'Hard-coding prices and models in applications instead of the gateway.'
  ],
  related:['v2-ai-gateway','v2-finops-optimization','v2-evaluation-monitoring']
},
{
  id:'v3fin-07', chapter:'v3-ch-finops', difficulty:2,
  title:'How much does caching actually save?',
  understand:`The interviewer wants you to quantify savings for each cache type and to know when caching costs more than it saves. Simple explanation: provider prompt caching makes repeated prompt prefixes cheaper after you pay a bit extra to write them; self-hosted prefix caching skips recomputing a shared prompt; response caching skips the whole model call. Each saves something different, and each has a break-even.`,
  short:`It depends which cache. Provider prompt caching charges a write premium and then a big discount on reads. At Anthropic, as of October 2026, a five-minute cache write costs 1.25 times the base input price, a one-hour write 2 times, and a read 0.1 times, or 0.05 times on Opus 5.5 and Sonnet 5.5. So a cached prefix pays for itself from the second request within the TTL with a five-minute write, and from the third with a one-hour write. OpenAI's newer models are similar: reads at 0.1 times and writes at 1.25 times. Savings apply only to the cached prefix, not to output tokens. Self-hosted prefix caching saves prefill compute and time to first token, not decode. Response or semantic caching skips the whole call, but carries freshness and correctness risk. I always quantify with hit rate, prefix share of input tokens, and the price multipliers, and I verify with the cache-read token counts in usage data.`,
  detailed:`
<h5>Provider prompt caching (list prices, as of Oct 2026)</h5>
${table(['Provider / model','Write','Read','Notes'],[
  ['Anthropic (most models)','5-min 1.25×, 1-hour 2× base input','0.1×','Min cacheable prefix 512–4,096 tokens by model; TTL refreshed on each read'],
  ['Anthropic Opus 5.5, Sonnet 5.5','as above','0.05×','Lower read multiplier'],
  ['OpenAI GPT-5.6+','1.25×','0.1× (0.05× on GPT-6.1 Sol)','Automatic plus explicit breakpoints; 30-minute TTL; min 1,024 tokens'],
  ['Self-hosted engine prefix cache','KV memory','free compute','Saves prefill FLOPs and TTFT; competes for KV capacity']
])}
<h5>Break-even number of uses (prefix reused n times within TTL)</h5>
${formula(`
cost relative to uncached = (write multiplier + (n − 1) × read multiplier) ÷ n

5-min write, read 0.1×:
  n = 1 :  1.25 ÷ 1                   = 1.25   (25% MORE)
  n = 2 :  (1.25 + 0.1) ÷ 2           = 0.675  (32.5% less)
  n = 10:  (1.25 + 0.9) ÷ 10          = 0.215  (78.5% less)
1-hour write, read 0.1×:
  n = 2 :  (2 + 0.1) ÷ 2              = 1.05   (still 5% more)
  n = 3 :  (2 + 0.2) ÷ 3              = 0.733  (27% less)
`)}
<h5>Whole-request saving (Claude Sonnet 5.5, $2/$10 per 1M; ILLUSTRATIVE traffic)</h5>
${formula(`
Request: 8,000-token stable prefix + 1,000 dynamic input + 500 output
Assume prefix written once per 5-min window and read 50 times in it

uncached cost per request
  input  = 9,000 × $2/1M                       = $0.0180
  output =   500 × $10/1M                      = $0.0050
  total                                        = $0.0230

cached (per request, amortised over 51 uses in the window)
  prefix = (1.25 + 50 × 0.05) × 8,000 × $2/1M ÷ 51
         = 3.75 × $0.016 ÷ 51                  ≈ $0.00118
  dynamic input = 1,000 × $2/1M                = $0.0020
  output                                       = $0.0050
  total                                        ≈ $0.00818
ANSWER  ≈ 64% saving per request; output tokens are untouched
`)}
<h5>Other caches</h5>
<ul>
<li><b>Self-hosted prefix/KV cache</b> (vLLM, SGLang): a hit skips prefill of the shared prefix: lower TTFT and more GPU capacity for decode. Value = avoided prefill tokens × prefill cost, not total tokens × hit rate.</li>
<li><b>Exact response cache</b>: saves the whole call; useful for repeated identical requests (FAQ, deterministic tools). Key must include model, prompt version, tenant, and parameters.</li>
<li><b>Semantic cache</b>: saves calls for similar requests; risk of wrong or stale answers and cross-tenant leakage. Use for low-risk content with conservative thresholds and evaluation.</li>
</ul>
<h5>Verify, don't assume</h5>
<p>Read usage fields: Anthropic returns <code>cache_creation_input_tokens</code> and <code>cache_read_input_tokens</code>; OpenAI reports cached tokens in input token details. Track cache-read share of input tokens per route. A timestamp or user name at the start of the prompt silently drops the hit rate to zero.</p>`,
  diagram:fig('What each cache saves', svgDiagram({w:900,h:280,
    boxes:[
      {id:'p',x:20,y:40,w:260,h:56,label:'Provider prompt cache',sub:'cheaper prefix input $'},
      {id:'k',x:20,y:130,w:260,h:56,label:'Engine prefix/KV cache',sub:'skip prefill compute'},
      {id:'r',x:20,y:220,w:260,h:50,label:'Response / semantic cache',sub:'skip whole call'},
      {id:'i',x:380,y:40,w:200,h:56,label:'Input tokens',sub:'prefix share only'},
      {id:'t',x:380,y:130,w:200,h:56,label:'TTFT + GPU time',sub:'prefill part'},
      {id:'o',x:380,y:220,w:200,h:50,label:'Input + output',sub:'freshness risk',cls:'warn'},
      {id:'n',x:660,y:130,w:220,h:56,label:'Not saved by 1–2',sub:'output decode',cls:'bad'}
    ],
    arrows:[{from:'p',to:'i'},{from:'k',to:'t'},{from:'r',to:'o'},{from:'t',to:'n',cls:'dash'}]
  }), 'Only response caches avoid output-token cost; prefix caches cut the input or prefill part.'),
  followups:[
    {q:'Why might enabling a 1-hour cache increase cost?',a:'Because the write costs 2× base input. If a prefix is used fewer than three times per hour, you pay more than without caching. Use the 5-minute TTL for bursty traffic and 1-hour only for prefixes reused steadily.'},
    {q:'Your cache-read tokens dropped to zero after a release. Likely cause?',a:'The prompt prefix changed per request (timestamp, user id, tool order, a new dynamic field at the top) or fell below the minimum cacheable length. Diff the rendered prompts.'},
    {q:'How do you estimate savings before enabling caching?',a:'From logs: prefix length, request rate per prefix, and inter-arrival times versus TTL to estimate n per window; apply the multipliers; then confirm with a canary using usage fields.'}
  ],
  tradeoffs:`
<p><b>Prompt caching</b>: low risk, large input savings for long stable prefixes; requires prompt discipline. <b>Engine prefix caching</b>: improves latency and capacity, consumes KV memory, benefits from cache-aware routing. <b>Semantic caching</b>: biggest potential savings, highest correctness and privacy risk.</p>
<p><b>Operational considerations:</b> dashboards of cache-read share, write volume, and effective $/request; alert on hit-rate drops after deploys; cache keys include tenant for response caches; TTLs aligned with data freshness.</p>`,
  failures:`
<ul>
<li><b>Hit rate collapse</b> after adding the date to the system prompt. Fix: move dynamic content after the cached prefix.</li>
<li><b>Semantic cache serves another tenant\'s answer</b>. Fix: tenant in the key; disable for personalised content.</li>
<li><b>Prefix cache thrashing</b> on self-hosted engines under KV pressure: hits fall at peak. Fix: cache-aware routing, more KV capacity, shorter contexts.</li>
</ul>`,
  vocab:[
    {term:'Prompt caching',def:'Provider feature that stores a prompt prefix and bills later reads at a discount.'},
    {term:'Cache write multiplier',def:'Premium over base input price for writing a prefix to cache (e.g. 1.25× for 5 minutes).'},
    {term:'Cache read multiplier',def:'Fraction of base input price charged for cached prefix tokens (e.g. 0.1×).'},
    {term:'Prefix cache (engine)',def:'Reuse of KV state for identical prompt prefixes inside a serving engine.'},
    {term:'Semantic cache',def:'Cache keyed by embedding similarity; returns stored answers for similar queries.'}
  ],
  mistakes:[
    'Multiplying total tokens by hit rate as the saving.',
    'Claiming prefix caching reduces output-token cost.',
    'Enabling 1-hour caching for rarely reused prefixes.',
    'Response caches keyed without tenant or prompt version.'
  ],
  related:['v2-prefix-kv-cache','v2-response-semantic-cache','v2-cache-ops']
},
{
  id:'v3fin-08', chapter:'v3-ch-finops', difficulty:2,
  title:'Which GPU utilisation metrics belong on a FinOps dashboard, and why?',
  understand:`The interviewer checks whether you know the classic trap: nvidia-smi "GPU utilisation" looks like efficiency but is not. Simple explanation: the standard GPU utilisation number only says how much of the time the GPU was doing anything at all; a GPU can show 100% while doing very little useful work. A FinOps dashboard needs metrics tied to output and money: tokens per GPU-hour at the SLO, cost per million tokens, idle GPU-hours, and allocation versus use.`,
  short:`I'd be careful with the headline GPU utilisation. The DCGM and nvidia-smi metric measures the fraction of time at least one kernel was running, so a small kernel keeping the GPU busy shows 100% while most of the chip idles. It's useful for finding GPUs that are completely idle, not for efficiency. On a FinOps dashboard I put four layers. Allocation: GPUs requested versus GPUs actually used by workloads, and idle GPU-hours, priced. Work: tokens per GPU-hour, split input and output, measured at the latency SLO. Unit cost: cost per million tokens and cost per successful request per model. And headroom: KV-cache usage and queueing, so we don't cut capacity that is protecting latency. If deeper efficiency is needed, I add profiling metrics such as SM activity, but the decisions are made on work and cost per unit.`,
  detailed:`
<h5>Why "GPU utilisation" misleads</h5>
<p><code>DCGM_FI_DEV_GPU_UTIL</code> (the same idea as nvidia-smi's "GPU-Util") is the fraction of the sample period during which at least one kernel was executing. It says nothing about how many SMs were busy, how close to peak FLOPs or memory bandwidth the kernels ran, or whether the work was useful. Decode-heavy LLM serving can show high utilisation while being memory-bandwidth bound with modest compute use.</p>
<h5>Dashboard layers</h5>
${table(['Layer','Metrics','Decision it supports'],[
  ['Allocation','GPUs allocated vs in use per namespace; idle GPU-hours × $/GPU-hour (OpenCost container_gpu_allocation, node_gpu_hourly_cost)','Reclaim idle, right-size requests'],
  ['Activity','DCGM GPU_UTIL (time-active); profiling metrics such as SM activity where enabled','Detect totally idle or stalled GPUs'],
  ['Work','Input and output tokens per GPU-hour, requests per GPU-hour, at p95 TTFT/TPOT targets','Engine tuning, GPU class choice'],
  ['Unit cost','$ per 1M tokens, $ per successful request, by model and route','Routing, build vs buy'],
  ['Headroom','KV-cache usage, queue length, time in queue, replicas vs HPA target','Do not cut capacity protecting SLO'],
  ['Commitments','Committed vs used hours; utilisation vs break-even (1 − d)','Commitment purchases']
])}
<h5>Worked example (ILLUSTRATIVE)</h5>
${formula(`
Pool: 32 GPUs at $4.00 per GPU-hour, month = 730 h
STEP 1  monthly pool cost        = 32 × $4.00 × 730          = $93,440
STEP 2  measured idle GPU-hours  = 7,000
        idle cost                = 7,000 × $4.00             = $28,000  (30%)
STEP 3  tokens served            = 6,500 M
        cost per 1M tokens       = $93,440 ÷ 6,500           ≈ $14.38
STEP 4  if idle removed (same tokens):
        ($93,440 − $28,000) ÷ 6,500                          ≈ $10.07
ANSWER  GPU_UTIL might have shown "70%"; the money view says
        $28k/month buys nothing and unit cost could fall ≈ 30%
`)}
<h5>Presentation</h5>
<ul>
<li>Lead with money and work (idle $, $/1M tokens, $/success), drill down to utilisation.</li>
<li>Show trends per model version and engine version so tuning shows up.</li>
<li>Annotate deploys and price changes.</li>
</ul>`,
  diagram:fig('From activity to money', svgDiagram({w:900,h:280,
    boxes:[
      {id:'u',x:20,y:110,w:170,h:56,label:'GPU_UTIL',sub:'time ≥1 kernel',cls:'warn'},
      {id:'s',x:230,y:110,w:170,h:56,label:'SM activity',sub:'how busy the chip'},
      {id:'t',x:440,y:110,w:170,h:56,label:'Tokens / GPU-h',sub:'at SLO',cls:'hl'},
      {id:'c',x:650,y:40,w:230,h:56,label:'$ per 1M tokens'},
      {id:'r',x:650,y:180,w:230,h:56,label:'$ per successful request',cls:'ok'}
    ],
    arrows:[{from:'u',to:'s',label:'deeper'},{from:'s',to:'t',label:'useful work'},{from:'t',to:'c'},{from:'t',to:'r'}]
  }), 'Utilisation is a diagnostic. Decisions are made on work per GPU-hour and cost per useful outcome.'),
  followups:[
    {q:'A GPU shows 100% utilisation but throughput is low. What do you check?',a:'Whether kernels are small or serialised (low SM activity), memory-bandwidth bound decode, CPU-side bottlenecks such as tokenisation, tiny batch sizes, or a stuck process spinning. Profile and compare tokens per GPU-hour with a benchmark.'},
    {q:'Why measure tokens per GPU-hour at the SLO?',a:'Because pushing batch size raises throughput but also latency. The useful number is the throughput you can sustain while meeting p95 TTFT and TPOT, which is what you can sell.'},
    {q:'How do you price idle for shared clusters?',a:'Idle GPU-hours × hourly GPU cost, attributed to the owner of the reservation or shown as a platform line, so someone is accountable for it.'}
  ],
  tradeoffs:`
<p><b>Simple metrics</b> (GPU_UTIL, idle hours) are available everywhere and catch gross waste; <b>profiling metrics</b> give real efficiency but may need extra configuration and have overhead; <b>business metrics</b> need request-level joins but drive the right decisions.</p>
<p><b>Operational considerations:</b> DCGM exporter on every GPU node, engine metrics scraped per replica, OpenCost or equivalent for prices, consistent labels (model, team, environment) across all three.</p>`,
  failures:`
<ul>
<li><b>Cutting replicas because utilisation looked low</b> at night, then latency SLO breached at morning ramp. Fix: include headroom metrics and scaling lead time.</li>
<li><b>High utilisation celebrated</b> while tokens per GPU-hour halved after an engine change. Fix: put work metrics next to activity metrics.</li>
<li><b>Allocated but unused GPUs</b> invisible because only node-level metrics were shown. Fix: allocation vs usage per workload.</li>
</ul>`,
  vocab:[
    {term:'DCGM_FI_DEV_GPU_UTIL',def:'Fraction of time at least one kernel ran on the GPU; not SM efficiency.'},
    {term:'SM activity',def:'Profiling measure of how much of the streaming multiprocessors were active.'},
    {term:'Tokens per GPU-hour',def:'Useful output (and input) tokens processed per GPU-hour, ideally at SLO.'},
    {term:'Idle GPU-hours',def:'Allocated or running GPU time with no useful work.'},
    {term:'Headroom',def:'Spare capacity that protects latency at peaks and failures.'}
  ],
  mistakes:[
    'Treating GPU_UTIL as efficiency or as a target to maximise.',
    'Cutting capacity using utilisation alone, ignoring queueing and KV usage.',
    'Showing node metrics but not per-workload allocation.',
    'Reporting throughput measured beyond the latency SLO.'
  ],
  related:['v1-k8s-autoscaling','v2-ai-observability','v1-multi-gpu-profiling']
},
{
  id:'v3fin-09', chapter:'v3-ch-finops', difficulty:2,
  title:'How do you forecast AI spend, including seasonal peaks like Ramadan?',
  understand:`They want a driver-based forecast rather than a trend line, with scenarios and capacity lead times. Simple explanation: forecast spend from the things that cause it (users, requests per user, tokens per request, price per token, GPU capacity needed at peak) and then plan capacity early enough for known peaks.`,
  short:`I build a driver-based model rather than extrapolating last month's bill. Spend equals active users times requests per user times tokens per request times price per token for API traffic, and for self-hosted traffic, GPUs needed at peak times the GPU-hour price times hours. Each driver gets its own forecast and owner: product owns user and adoption growth, engineering owns tokens per request and model mix, procurement owns prices. Then I add seasonality. For GCC travel, Ramadan evenings, Eid and summer holidays are predictable peaks, so I size peak capacity from last year's peak-to-average ratio and plan purchases with lead times, for example Capacity Blocks can be booked up to eight weeks ahead. I present three scenarios, low, expected and high, with the assumptions written down, and I track forecast versus actual monthly so the model gets better. Price drops and new model generations go in as explicit assumptions too.`,
  detailed:`
<h5>Driver tree</h5>
${formula(`
API spend / month = MAU × active share × requests per active user
                    × (input tokens × input price + output tokens × output price)
                    × (1 − cache saving) × (1 + retry rate)

Self-hosted spend = Σ pools ( GPUs needed at peak × $/GPU-hour × hours )
GPUs at peak      = peak requests/s ÷ measured requests/s per GPU at SLO
                    × (1 + headroom)
`)}
<h5>Worked example (ILLUSTRATIVE)</h5>
${formula(`
Assistant inside a travel app, expected scenario for next year:
MAU 2.0 M, 30% use the assistant, 6 requests per user per month
STEP 1  requests / month  = 2.0 M × 0.30 × 6          = 3.6 M
STEP 2  tokens / request  = 3,000 input + 500 output
        price (Sonnet 5.5 list, Oct 2026) $2 / $10 per 1M
        $ / request       = 3,000 × 2/1M + 500 × 10/1M
                          = $0.006 + $0.005           = $0.011
STEP 3  base spend        = 3.6 M × $0.011            = $39,600 / month
STEP 4  prompt caching saves 30% of input cost (measured in canary)
        input part        = 3.6 M × $0.006 × 0.70     = $15,120
        output part       = 3.6 M × $0.005            = $18,000
        expected          = $33,120 / month
STEP 5  Ramadan month: requests × 1.8 (last year's ratio, illustrative)
        Ramadan spend     ≈ $33,120 × 1.8             ≈ $59,616
`)}
${table(['Scenario','Adoption','Tokens/request','Monthly (normal)','Ramadan month'],[
  ['Low','20% (2.4 M req)','2,500 + 400','$18,000','$32,400'],
  ['Expected','30% (3.6 M req)','3,000 + 500','$33,120','$59,616'],
  ['High','45% (5.4 M req)','4,000 + 700','$68,040','$122,472']
])}
<p>All three rows use the same formula: requests × (input tokens × $2/1M × 0.70 + output tokens × $10/1M), with the 30% caching saving applied to input only and a Ramadan multiplier of 1.8. For example, high: 5.4 M × ($0.0056 + $0.0070) = 5.4 M × $0.0126 = $68,040.</p>
<h5>Seasonality and lead times</h5>
<ul>
<li>Use last year's daily and hourly curves; Ramadan shifts about 11 days earlier each Gregorian year, so align by the Hijri calendar, not by month.</li>
<li>Self-hosted capacity: book or reserve ahead (Capacity Blocks up to 8 weeks ahead, 1–14 days or multiples of 7); pre-warm replicas before the evening peak.</li>
<li>API capacity: check rate limits or provisioned throughput well before the peak.</li>
</ul>
<h5>Governance</h5>
<p>Monthly forecast vs actual by driver, so a miss is explained ("tokens per request rose 40% after the RAG change"), not just reported. Budget alerts at 50/80/100% of forecast per team.</p>`,
  diagram:fig('Driver-based forecast', svgDiagram({w:900,h:300,
    boxes:[
      {id:'u',x:20,y:30,w:160,h:50,label:'Users',sub:'product owns'},
      {id:'r',x:20,y:110,w:160,h:50,label:'Requests/user',sub:'product'},
      {id:'t',x:20,y:190,w:160,h:50,label:'Tokens/request',sub:'engineering'},
      {id:'p',x:240,y:190,w:160,h:50,label:'Prices',sub:'procurement'},
      {id:'s',x:240,y:70,w:160,h:56,label:'Seasonality',sub:'Ramadan, Eid'},
      {id:'f',x:480,y:110,w:180,h:60,label:'Forecast',sub:'low / expected / high',cls:'hl'},
      {id:'c',x:720,y:60,w:160,h:50,label:'Capacity plan',sub:'lead times'},
      {id:'b',x:720,y:170,w:160,h:50,label:'Budget alerts'}
    ],
    arrows:[{from:'u',to:'f'},{from:'r',to:'f'},{from:'t',to:'f'},{from:'p',to:'f'},{from:'s',to:'f'},{from:'f',to:'c'},{from:'f',to:'b'}]
  }), 'Each driver has an owner, so forecast misses can be explained and fixed.'),
  followups:[
    {q:'How do you forecast for a product with no history?',a:'Use scenarios with explicit assumptions, benchmarks from similar features, a pilot to measure tokens per request and adoption, and short commitments until real data arrives.'},
    {q:'Prices fall every few months. How do you include that?',a:'As an explicit assumption per scenario with a date, never baked in silently; re-forecast when price lists change and show the effect separately from usage growth.'},
    {q:'Why align Ramadan by Hijri calendar?',a:'Because Ramadan moves about 11 days earlier each Gregorian year; aligning by Gregorian month misplaces the peak and the capacity bookings.'}
  ],
  tradeoffs:`
<p><b>Driver models</b> explain variance and support decisions but need data from several owners; <b>trend extrapolation</b> is quick but fails at launches, price changes and seasonality. <b>Over-forecasting</b> wastes commitments; <b>under-forecasting</b> risks capacity shortfalls at peak.</p>
<p><b>Operational considerations:</b> forecast inputs in version control or a shared model; monthly review; peak readiness checklist before Ramadan and summer (capacity, quotas, warm pools, fallback models).</p>`,
  failures:`
<ul>
<li><b>Forecast blown by a prompt change</b> that doubled tokens per request. Fix: token budget checks in CI for prompt changes.</li>
<li><b>No GPUs available for peak</b> because booking happened too late. Fix: capacity calendar with lead times.</li>
<li><b>API rate limit at peak</b>. Fix: request limit increases or provisioned throughput ahead of peaks; fallback model.</li>
</ul>`,
  vocab:[
    {term:'Driver-based forecast',def:'Forecast built from causal drivers (users, requests, tokens, prices) rather than past totals.'},
    {term:'Peak-to-average ratio',def:'Peak load divided by average load; sizes capacity for peaks.'},
    {term:'Scenario planning',def:'Low, expected and high forecasts with explicit assumptions.'},
    {term:'Lead time',def:'Time needed to obtain capacity (reservation, procurement, quota).'},
    {term:'Forecast variance',def:'Difference between forecast and actual, explained by driver.'}
  ],
  mistakes:[
    'Extrapolating last month\'s bill linearly.',
    'Ignoring seasonality or aligning Ramadan by Gregorian month.',
    'Hiding price assumptions inside the numbers.',
    'Forecasting spend without the capacity plan and its lead times.'
  ],
  related:['v2-capacity-planning','v2-finops-unit-economics','v2-hyperscale-serving']
},
{
  id:'v3fin-10', chapter:'v3-ch-finops', difficulty:2,
  title:'How do you present AI cost and value to executives in a monthly review?',
  understand:`The interviewer wants to see that you can translate infrastructure cost into business terms and drive decisions, not just show a bill. Simple explanation: executives want to know what we spent, what we got for it, whether it is getting more efficient, what risks exist, and what decision is needed from them, on one page.`,
  short:`I'd keep it to one page with five parts. First, spend and trend versus budget and forecast, split into a few lines executives recognise: model APIs, GPU capacity, platform. Second, unit economics: cost per successful outcome for each major use case, such as cost per resolved support conversation, with the trend, because that shows efficiency independent of growth. Third, value: the business metric the AI moves, like containment rate or conversion, next to its cost, so we can talk about return, not just spend. Fourth, actions: savings delivered with validated numbers, savings in progress with owners and dates, and any quality or latency impact. Fifth, risks and decisions: upcoming peaks like Ramadan, commitment decisions, price changes, vendor concentration, and the one or two decisions I need from them. Everything else goes in an appendix. And I never present illustrative numbers as measured ones.`,
  detailed:`
<h5>One-page structure</h5>
${table(['Section','Content','Example wording (ILLUSTRATIVE figures)'],[
  ['1. Spend','Actual vs budget vs forecast; 3–4 lines','"AI spend $118k, 4% under forecast; APIs 55%, GPUs 35%, platform 10%."'],
  ['2. Unit economics','Cost per successful outcome per use case, 3-month trend','"Cost per resolved chat fell from $0.21 to $0.16 (−24%)."'],
  ['3. Value','Business metric next to cost','"Assistant resolved 410k chats without an agent; at our blended handling cost that is the main return."'],
  ['4. Actions','Validated savings, in-progress items with owner/date, quality impact','"Prompt caching: −$14k/month validated, no latency change. Routing pilot: owner X, decision by 15 Dec."'],
  ['5. Risks and decisions','Peaks, commitments, vendor/price risk, asks','"Decision needed: approve a 1-year commitment for the 16-GPU floor (break-even utilisation 70%, measured 88%)."']
])}
<h5>Language that works</h5>
<ul>
<li>Translate tokens into outcomes: "a support conversation costs 16 cents", not "we used 4.2 billion tokens".</li>
<li>Separate growth from efficiency: "spend rose 12% because usage rose 30%; unit cost fell 14%."</li>
<li>State confidence: "validated in a 4-week canary" vs "estimated".</li>
<li>Show what you will not do: "we did not reduce failover capacity."</li>
</ul>
<h5>Worked bridge (ILLUSTRATIVE)</h5>
${formula(`
Last month spend      $105,000
+ volume growth       +$31,500   (usage +30% at old unit cost)
− caching saving      −$14,000
− routing saving       −$6,500
+ new use case         +$2,000
This month spend      $118,000
check: 105,000 + 31,500 − 14,000 − 6,500 + 2,000 = 118,000 ✓
`)}
<p>A spend bridge like this answers the first executive question ("why did it go up?") in one glance.</p>
<h5>Cadence</h5>
<p>Monthly business review; weekly engineering cost stand-up during big changes; quarterly re-baseline of unit costs and commitments. Decisions recorded with owner and date.</p>`,
  diagram:fig('Monthly review on one page', svgDiagram({w:900,h:280,
    boxes:[
      {id:'s',x:20,y:110,w:150,h:56,label:'Spend',sub:'vs forecast'},
      {id:'u',x:200,y:110,w:150,h:56,label:'Unit cost',sub:'per success',cls:'hl'},
      {id:'v',x:380,y:110,w:150,h:56,label:'Value',sub:'business metric'},
      {id:'a',x:560,y:110,w:150,h:56,label:'Actions',sub:'owners, dates'},
      {id:'d',x:740,y:110,w:140,h:56,label:'Decisions',sub:'asks',cls:'ok'}
    ],
    arrows:[{from:'s',to:'u'},{from:'u',to:'v'},{from:'v',to:'a'},{from:'a',to:'d'}]
  }), 'From money to efficiency to value to action, ending with a decision.'),
  followups:[
    {q:'The CFO asks why AI spend grew 40% while revenue grew 5%. How do you answer?',a:'Show the bridge: how much was usage growth, which use cases grew, unit-cost trend, and the value metric per use case. Then propose actions for use cases with poor cost-to-value, such as routing or limiting scope.'},
    {q:'How do you show value when it is hard to measure?',a:'Use the closest operational metric (containment, time saved, conversion in an A/B test), be explicit about uncertainty, and avoid inflated estimates; credibility is worth more than a big number.'},
    {q:'What would you never put in the executive page?',a:'Raw GPU utilisation, token counts without unit costs, or unvalidated savings presented as delivered.'}
  ],
  tradeoffs:`
<p><b>Simplicity vs completeness</b>: one page with an appendix beats a 30-slide deck. <b>Unit metrics vs totals</b>: executives need both; totals for budget, units for efficiency. <b>Conservative vs optimistic</b> savings: conservative builds trust.</p>
<p><b>Operational considerations:</b> automated data pipeline so the page is produced in hours, not days; definitions published; same metrics every month so trends are meaningful.</p>`,
  failures:`
<ul>
<li><b>Numbers do not match finance</b>: credibility lost. Fix: reconcile with the bill before presenting.</li>
<li><b>Savings claimed twice</b> (caching and routing both counted the same reduction). Fix: compounding and attribution rules.</li>
<li><b>Only cost shown</b>: AI seen as a cost centre and cut. Fix: always pair cost with value.</li>
</ul>`,
  vocab:[
    {term:'Spend bridge',def:'Walk from last period\'s spend to this period\'s by driver.'},
    {term:'Unit economics',def:'Cost and value per unit of business outcome.'},
    {term:'Validated saving',def:'Saving measured after release against a baseline, not estimated.'},
    {term:'Cost-to-value',def:'Spend compared with the business outcome it produces.'}
  ],
  mistakes:[
    'Presenting token counts and GPU utilisation to executives.',
    'Mixing estimated and validated savings.',
    'Showing cost without value.',
    'No explicit decision or ask.'
  ],
  related:['v2-finops-unit-economics','v3-how-to-interview']
}
]);

registerGlossary([
  {term:'Cost per successful request',def:'Total AI cost (including retries, failures and idle capacity) divided by requests that met the success criterion; the headline unit metric for AI FinOps.',lesson:'v3-ch-finops',aliases:['cost per success']},
  {term:'Break-even utilisation',def:'For a capacity commitment: discounted price divided by on-demand price. Below this usage fraction, paying on-demand for used hours is cheaper.',lesson:'v3-ch-finops'},
  {term:'Model cascade',def:'Routing pattern that tries a cheaper model first and escalates to a stronger model when a check fails; expected cost = small cost + escalation rate × large cost.',lesson:'v3-ch-finops'},
  {term:'FOCUS',def:'FinOps Open Cost and Usage Specification; v1.4 (June 2026) normalises billing data across cloud, AI, SaaS and data centre.',lesson:'v3-ch-finops'},
  {term:'Driver-based forecast',def:'Spend forecast built from causal drivers such as users, requests per user, tokens per request and prices, with scenarios.',lesson:'v3-ch-finops'}
]);
