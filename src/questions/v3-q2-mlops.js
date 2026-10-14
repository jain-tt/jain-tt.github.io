/* Volume 3, Part 2, Chapter 7 — Questions: MLOps and LLMOps */
(function(){
const D=(t,spec,cap)=>fig(t,svgDiagram(spec),cap);

/* ---------- animations ---------- */
Anim.register({
  id:'v3q-mlops-canary', title:'Canary rollout of a new model version with automated analysis', w:960, h:420,
  elements:[
    {type:'node', id:'gw', x:30, y:150, w:160, h:60, label:'Gateway', sub:'weighted routing', icon:'globe'},
    {type:'node', id:'v1', x:330, y:60, w:220, h:60, label:'Stable: atlas v7', sub:'old weights loaded', icon:'llm', cls:'ok'},
    {type:'node', id:'v2', x:330, y:240, w:220, h:60, label:'Canary: atlas v8', sub:'new release bundle', icon:'llm'},
    {type:'node', id:'an', x:680, y:150, w:240, h:60, label:'AnalysisRun', sub:'TTFT, errors, judge score', icon:'chart'},
    {type:'edge', id:'e1', from:'gw', to:'v1', label:'stable %'},
    {type:'edge', id:'e2', from:'gw', to:'v2', label:'canary %'},
    {type:'edge', id:'e3', from:'v2', to:'an', label:'metrics'},
    {type:'bar', id:'w', x:30, y:350, w:420, h:22, label:'Canary traffic weight', value:0},
    {type:'counter', id:'res', x:520, y:340, label:'Analysis result', value:'—'}
  ],
  steps:[
    {caption:'The candidate v8 is deployed <b>next to</b> v7. It receives no user traffic yet. Its readiness check ran a real generation, and its prefix cache was warmed with the system prompt.', hl:['v2'], set:{w:{value:0,text:'0 %'}}, dur:4200},
    {caption:'<b>setWeight 5.</b> The gateway sends 5 % of eligible traffic to v8. At 200 requests/s that is 10 requests/s, ≈ 6,000 requests in 10 minutes — enough to compare error rate and latency, not yet enough for small quality differences.', set:{w:{value:0.05,text:'5 %'}}, packets:[{edge:'e1',count:3},{edge:'e2',cls:'c-purple'}], dur:5000},
    {caption:'<b>Analysis.</b> An AnalysisTemplate queries Prometheus for v8 vs v7: TTFT p95, TPOT p95, 5xx rate, and a sampled LLM-judge pass rate. Each has a pass condition. Result: pass.', hl:['an'], packets:[{edge:'e3',label:'p95, errors'}], set:{res:{value:'pass at 5 %'}}, ok:['an'], dur:5000},
    {caption:'<b>setWeight 25, pause, analysis.</b> More traffic, more statistical power. 25 % of 200 requests/s for 30 minutes ≈ 90,000 requests on the canary.', set:{w:{value:0.25,text:'25 %'}}, packets:[{edge:'e1',count:2},{edge:'e2',count:2,cls:'c-purple'}], dur:4500},
    {caption:'The judge pass rate for Arabic queries drops from 91 % to 84 % while latency is fine. The analysis condition fails. Without a quality metric this regression would have shipped.', bad:['an','v2'], set:{res:{value:'FAIL: quality, Arabic slice'}}, dur:5000},
    {caption:'<b>Abort.</b> The rollout sets canary weight back to 0. Because v7 was never scaled down, rollback is a routing change taking seconds, not a 6-minute reload of weights.', set:{w:{value:0,text:'0 % (aborted)'}}, ok:['v1'], dim:['v2'], packets:[{edge:'e1',count:4}], dur:5000},
    {caption:'The failed analysis, the bundle id and the slice that failed are attached to the release record. The Arabic slice is added to the offline eval gate so the next candidate is caught before any user sees it.', hl:['an'], dur:4500}
  ]
});

Anim.register({
  id:'v3q-mlops-drift', title:'Drift detection on an LLM service: input mix vs quality signals', w:960, h:420,
  elements:[
    {type:'chart', id:'ch', x:80, y:40, w:520, h:240, xmax:12, ymax:1, xlabel:'week', ylabel:'value', series:[{id:'psi',label:'PSI topic mix',points:[[0,0.02],[1,0.03],[2,0.02],[3,0.03]]},{id:'q',label:'judge pass rate',points:[[0,0.9],[1,0.91],[2,0.9],[3,0.9]]}]},
    {type:'counter', id:'psiv', x:660, y:60, label:'PSI vs reference', value:'0.03'},
    {type:'counter', id:'qv', x:660, y:140, label:'Judge pass rate (sampled)', value:'90 %'},
    {type:'counter', id:'act', x:660, y:220, label:'Action', value:'none'},
    {type:'label', id:'thr', x:80, y:330, text:'PSI threshold 0.1 (Evidently default for psi); quality alert if pass rate drops > 3 points'}
  ],
  steps:[
    {caption:'Reference window: the 4 weeks the current model was evaluated on. We track two different things: <b>input drift</b> (topic/language mix, as PSI over embedding clusters) and <b>quality</b> (judge pass rate on a daily sample).', dur:4500},
    {caption:'Week 6: a new flight-change policy launches. Questions about refunds jump. PSI rises to 0.08 — inputs are shifting, quality still 90 %. No page: drift alone is a signal to look, not an incident.', set:{ch:{psi:[[0,0.02],[1,0.03],[2,0.02],[3,0.03],[4,0.04],[5,0.06],[6,0.08]],q:[[0,0.9],[1,0.91],[2,0.9],[3,0.9],[4,0.9],[5,0.9],[6,0.9]]}, psiv:{value:'0.08'}}, dur:5000},
    {caption:'Week 8: PSI 0.15, above the 0.1 threshold. Quality on the <b>refund</b> slice is 78 % while the overall average is still 88 %. Averages hide slice failures; always segment.', set:{ch:{psi:[[0,0.02],[1,0.03],[2,0.02],[3,0.03],[4,0.04],[5,0.06],[6,0.08],[7,0.12],[8,0.15]],q:[[0,0.9],[1,0.91],[2,0.9],[3,0.9],[4,0.9],[5,0.9],[6,0.9],[7,0.89],[8,0.88]]}, psiv:{value:'0.15'}, qv:{value:'88 % (refunds 78 %)'}, act:{value:'investigate'}}, warn:['psiv'], dur:5200},
    {caption:'Investigation finds the cause is <b>stale knowledge</b>, not the model: the RAG index still holds the old refund policy. Fix = re-index and add a freshness check. Retraining the model would not have helped.', set:{act:{value:'re-index policy docs'}}, hl:['act'], dur:5000},
    {caption:'After re-indexing, refund-slice quality recovers to 90 %. PSI stays high because users really do ask about refunds more — so the <b>reference window is updated</b> after review, and the eval set gets new refund cases.', set:{ch:{psi:[[0,0.02],[1,0.03],[2,0.02],[3,0.03],[4,0.04],[5,0.06],[6,0.08],[7,0.12],[8,0.15],[9,0.15],[10,0.04]],q:[[0,0.9],[1,0.91],[2,0.9],[3,0.9],[4,0.9],[5,0.9],[6,0.9],[7,0.89],[8,0.88],[9,0.9],[10,0.9]]}, psiv:{value:'0.04 (new reference)'}, qv:{value:'90 %'}, act:{value:'update reference + eval set'}}, ok:['qv'], dur:5200}
  ]
});

Anim.register({
  id:'v3q-mlops-gates', title:'Evaluation gates in an LLM release pipeline', w:960, h:380,
  elements:[
    {type:'node', id:'pr', x:20, y:150, w:130, h:56, label:'Change', sub:'model/prompt/index', icon:'doc'},
    {type:'node', id:'g1', x:190, y:150, w:130, h:56, label:'Unit + schema', sub:'seconds'},
    {type:'node', id:'g2', x:360, y:150, w:140, h:56, label:'Offline eval', sub:'golden + slices'},
    {type:'node', id:'g3', x:540, y:150, w:130, h:56, label:'Safety + red team', sub:'attack set'},
    {type:'node', id:'g4', x:710, y:150, w:110, h:56, label:'Perf + cost', sub:'TTFT, $/req'},
    {type:'node', id:'reg', x:840, y:150, w:100, h:56, label:'Registry', sub:'@candidate'},
    {type:'edge', id:'e1', from:'pr', to:'g1'},{type:'edge', id:'e2', from:'g1', to:'g2'},{type:'edge', id:'e3', from:'g2', to:'g3'},{type:'edge', id:'e4', from:'g3', to:'g4'},{type:'edge', id:'e5', from:'g4', to:'reg'},
    {type:'counter', id:'c', x:20, y:290, label:'Gate result', value:'—'}
  ],
  steps:[
    {caption:'A pull request changes the system prompt. In LLM systems a prompt edit can change behaviour as much as new weights, so it goes through the same gates.', hl:['pr'], packets:[{edge:'e1'}], dur:4000},
    {caption:'Fast gates first: template renders, output parses against the JSON schema, tool definitions valid. Cheap checks fail fast.', ok:['g1'], packets:[{edge:'e2'}], set:{c:{value:'schema ok'}}, dur:4000},
    {caption:'Offline evaluation on the golden set (e.g. 600 cases) and per-slice: English, Arabic, refunds, bookings. Gate: no slice may drop more than its confidence interval allows versus the champion.', hl:['g2'], set:{c:{value:'overall 91.2 % vs 90.8 % — Arabic 88 % vs 89 % (within CI)'}}, packets:[{edge:'e3'}], ok:['g2'], dur:5200},
    {caption:'Safety gate: prompt-injection and jailbreak cases, PII leakage, refusal correctness. A single critical failure blocks regardless of averages.', ok:['g3'], packets:[{edge:'e4'}], set:{c:{value:'0 critical failures'}}, dur:4500},
    {caption:'Performance and cost gate: the new prompt adds 900 tokens. Prefill per request rises; TTFT p95 in the load test goes from 0.9 s to 1.3 s, and input cost +18 %. The gate threshold is +10 %. <b>Blocked.</b>', bad:['g4'], set:{c:{value:'BLOCKED: cost +18 % > 10 % budget'}}, dur:5200},
    {caption:'The author shortens the prompt and makes the static part cacheable (prefix caching). Re-run: TTFT p95 1.0 s, cost +4 %. The bundle is registered with alias <b>@candidate</b> and goes to canary.', ok:['g4','reg'], packets:[{edge:'e5'}], set:{c:{value:'pass → models:/atlas@candidate'}}, dur:5000}
  ]
});

/* ---------- chapter lesson ---------- */
registerLesson({
  id:'v3-ch-mlops', vol:3, part:2, num:7,
  title:'Questions: MLOps and LLMOps', minutes:50,
  summary:'This chapter is the interview bank for releasing and operating models safely. Interviewers want to see that you version the whole release, not just the weights; that you gate releases on quality, safety, latency and cost; that you can detect drift and tell it apart from stale data; and that rollback is fast because the old version is still loaded. Every answer connects a mechanism to a number and to an operational decision.',
  objectives:[
    'Describe a complete LLM release bundle and a registry workflow using MLflow aliases rather than deprecated stages.',
    'Design evaluation gates, including LLM-as-judge with calibration against humans, and size a canary statistically.',
    'Explain a zero-downtime model rollout with Argo Rollouts analysis and instant rollback.',
    'Detect and diagnose drift with PSI and segment-level quality signals, and choose the right response.',
    'Secure the model supply chain with safetensors, pinned revisions and signatures.'
  ],
  prereqs:['v2-mlops-foundations','v2-model-cicd','v2-evaluation-monitoring'],
  next:['v3-ch-rag','v3-ch-aiops','v3-system-design'],
  tags:['interview','mlops','llmops','evaluation','release'],
  html:`
<h2>What interviewers are really testing</h2>
<p>A DevOps engineer already knows CI/CD, canaries and rollback. The MLOps/LLMOps interview probes what is <b>different</b> about shipping models: the artifact is a set of things (weights, tokenizer, chat template, engine version, quantisation, prompt, retrieval config) that only work together; “tests pass” says little about answer quality; failures are often silent (a worse answer is still HTTP 200); and the world changes under a fixed model (drift, stale knowledge, provider updates). Expect questions on five themes:</p>
<ol>
<li><b>Versioning and registry</b> — what exactly is released, how lineage is kept, how promotion works.</li>
<li><b>Evaluation gates</b> — offline sets, slices, LLM-as-judge, thresholds with statistics.</li>
<li><b>Progressive delivery</b> — shadow, canary, A/B, rollback speed with heavy GPU replicas.</li>
<li><b>Monitoring and drift</b> — input, output and concept drift; quality signals; what triggers action.</li>
<li><b>Supply chain</b> — model files are executable inputs to a privileged runtime.</li>
</ol>

${D('Mental model: the LLM release loop', {w:900,h:300,
 boxes:[
  {id:'data',x:20,y:40,w:150,h:56,label:'Data + prompts',sub:'versioned'},
  {id:'train',x:200,y:40,w:150,h:56,label:'Train / tune',sub:'tracked runs'},
  {id:'eval',x:380,y:40,w:150,h:56,label:'Eval gates',sub:'quality, safety, cost',cls:'hl'},
  {id:'reg',x:560,y:40,w:150,h:56,label:'Registry',sub:'bundle + alias'},
  {id:'roll',x:740,y:40,w:140,h:56,label:'Canary',sub:'analysis'},
  {id:'prod',x:740,y:190,w:140,h:56,label:'Production',cls:'ok'},
  {id:'mon',x:470,y:190,w:200,h:56,label:'Monitoring',sub:'drift, judge, feedback'},
  {id:'fb',x:200,y:190,w:200,h:56,label:'New eval cases',sub:'from incidents'}
 ],
 arrows:[{from:'data',to:'train'},{from:'train',to:'eval'},{from:'eval',to:'reg'},{from:'reg',to:'roll'},{from:'roll',to:'prod'},{from:'prod',to:'mon'},{from:'mon',to:'fb'},{from:'fb',to:'eval',label:'regression set'}]
}, 'Every production surprise should become a new evaluation case. That loop is what makes an LLM platform get better over time.')}

<h2>Weak versus strong answers</h2>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“We version the model in MLflow and move it from Staging to Production.”</p></div><div class="good"><h4>Strong answer</h4><p>“The registry entry points to a release bundle: weight digest, tokenizer and chat template, engine image digest, quantisation, sampling defaults, prompt version and eval report. Promotion moves an alias such as <code>@champion</code>; MLflow stages are deprecated since 2.9. Rollback means moving the alias back and the gateway weight back — the previous replicas are still warm.”</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“We detect drift with a KS test and retrain automatically.”</p></div><div class="good"><h4>Strong answer</h4><p>“I monitor input mix and quality separately, by slice. Drift opens an investigation; often the fix is re-indexing stale documents or updating prompts, not retraining. Auto-retraining on drifted data can bake the problem in.”</p></div></div>

<h2>Must-know numbers and formulas</h2>
${formula(`
Population Stability Index (bins i, expected share eᵢ, actual share aᵢ)
  PSI = Σ (aᵢ − eᵢ) × ln(aᵢ / eᵢ)
  rule of thumb: < 0.1 small · 0.1–0.25 moderate · > 0.25 large

Canary sample size per arm (two proportions, 95 % confidence, 80 % power)
        (z₀.₉₇₅ + z₀.₈)² × [p₁(1 − p₁) + p₂(1 − p₂)]
  n = ───────────────────────────────────────────────
                       (p₁ − p₂)²
  detect 90 % → 87 % pass rate:
  n = 2.80² × (0.0900 + 0.1131) ÷ 0.03² = 7.84 × 0.2031 ÷ 0.0009 ≈ 1,770

Judge vs human agreement (Cohen's kappa)
        pₒ − pₑ          pₒ = observed agreement
  κ = ─────────          pₑ = agreement expected by chance
        1 − pₑ
`)}
${table(['Fact (as of Oct 2026)','Value'],[
 ['MLflow latest','3.17.1; stages deprecated since 2.9.0 (still in API) → use aliases <code>models:/Name@champion</code>'],
 ['MLflow GenAI','<code>mlflow.genai.evaluate</code>, scorers, <code>mlflow.genai.make_judge</code>, Prompt Registry <code>prompts:/name@alias</code>'],
 ['Evidently drift defaults','numeric: KS (≤1,000 rows) / Wasserstein 0.1 (&gt;1,000); categorical: chi-square / Jensen-Shannon 0.1; PSI threshold 0.1 (not default method)'],
 ['Argo Rollouts','v1.10.x; canary steps setWeight / pause / analysis; AnalysisTemplate'],
 ['Model signing','OpenSSF <code>model-signing</code> 1.1.1 (<code>model_signing sign / verify</code>); cosign v3 <code>sign-blob</code>']
])}

<h2>How to use this chapter</h2>
<p>Answer each question aloud before revealing it. Most MLOps interviews add “and what if the metric is wrong?” — practise the follow-ups. Background lessons: ${L('v2-mlops-foundations','MLOps foundations')}, ${L('v2-model-cicd','model CI/CD and prompt versioning')}, ${L('v2-evaluation-monitoring','evaluation and drift')}.</p>
`,
  quiz:[
    {q:'In MLflow 3.x, what is the recommended way to mark which model version production should load?',options:['transition_model_version_stage to "Production"','A registered model alias such as @champion','A git tag on the training repo','The latest version number'],answer:1,explain:'Stages are deprecated since MLflow 2.9.0 and slated for removal, though still in the API. Aliases are mutable named references (models:/Name@champion). “Latest version” is not a promotion decision.'},
    {q:'A canary must detect a drop in judge pass rate from 90 % to 87 % (95 % confidence, 80 % power). Roughly how many judged requests per arm?',options:['≈ 100','≈ 400','≈ 1,770','≈ 50,000'],answer:2,explain:'n = 7.84 × (0.09 + 0.1131) ÷ 0.0009 ≈ 1,770. A few hundred requests only detect large drops; 50,000 is far more than needed for a 3-point difference.'},
    {q:'PSI on the topic mix rises to 0.15 and quality on one slice falls. Best first action?',options:['Trigger automatic retraining','Investigate the slice: data, retrieval freshness, prompt, then decide','Raise the PSI threshold','Roll back to last month’s model'],answer:1,explain:'Drift is a signal to investigate. The cause may be stale RAG content or a new policy, which retraining does not fix. Raising thresholds hides the signal.'},
    {q:'Why keep the old model replicas running during a canary?',options:['To compare GPU temperature','So rollback is a routing change in seconds instead of a multi-minute weight reload','Because Kubernetes requires it','To double throughput permanently'],answer:1,explain:'GPU replicas take minutes to load weights and warm. Keeping the stable version warm makes abort instant. It costs extra GPUs during the rollout window.'},
    {q:'Which is the strongest supply-chain control for loading a third-party model?',options:['Loading pickle files from any repo with trust_remote_code=True','safetensors weights, a pinned revision hash, a verified signature or checksum, and no remote code unless reviewed','Scanning the README for malware','Using the most-downloaded model'],answer:1,explain:'Pickle can execute code on load; trust_remote_code runs repository code. Pin revisions, prefer safetensors and verify signatures. Popularity is not provenance.'}
  ],
  flashcards:[
    {front:'What is in an LLM release bundle?',back:'Weight digest, tokenizer + chat template, engine image digest, quantisation, engine flags (max length), sampling defaults, prompt version, retrieval config/index version, eval report, approvals.'},
    {front:'MLflow stages vs aliases',back:'Stages (Staging/Production) deprecated since 2.9.0, not yet removed. Use aliases: set_registered_model_alias, models:/Name@champion.'},
    {front:'Data drift vs concept drift',back:'Data drift: input distribution changes. Concept drift: the correct answer for the same input changes (new policy). LLM apps also see knowledge staleness and provider model updates.'},
    {front:'PSI formula',back:'Σ (aᵢ − eᵢ) ln(aᵢ/eᵢ) over bins; < 0.1 small, > 0.25 large.'},
    {front:'Shadow vs canary',back:'Shadow: copy traffic, users never see output — tests crashes/latency/offline quality. Canary: real users see a small share — tests real impact.'},
    {front:'LLM-as-judge biases',back:'Position, verbosity, self-preference, leniency; calibrate against human labels (kappa), use pairwise with order swaps, version the judge.'},
    {front:'Why version prompts as artifacts?',back:'A prompt edit changes behaviour and cost without a model change; it needs eval gates, rollback and lineage like weights.'},
    {front:'pickle risk',back:'Loading a pickle can run arbitrary code (GLOBAL/REDUCE opcodes). Prefer safetensors; pin revisions; avoid trust_remote_code unless reviewed.'}
  ]
});

/* ---------- questions ---------- */
registerQuestions([
{
  id:'mlops-01', chapter:'v3-ch-mlops', difficulty:3,
  title:'How would you deploy a new model version with zero-downtime goals?',
  understand:'The interviewer wants a real release design for heavy GPU replicas: what is versioned, how capacity is handled during the switch, how quality is checked on live traffic, and how fast rollback is. Honesty about “zero downtime” as a goal backed by an error budget is a plus.',
  short:'I treat zero downtime as a goal with an error budget, and design for it. The new version is an immutable release bundle — weights digest, tokenizer and chat template, engine image, quantisation, sampling defaults and prompt version — that already passed offline evaluation. I deploy it beside the current version, not over it, wait for readiness that runs a real generation, and warm the prefix cache. Then the gateway or Argo Rollouts shifts traffic in steps such as 5, 25, 50 and 100 percent, with automated analysis on latency, errors and a sampled quality score. The stable replicas stay loaded until the end, so abort is a routing change in seconds. The price is temporary extra GPUs, which I reserve before the rollout window, and long-lived streams drain before old pods stop.',
  detailed:`
<h4>1. What is being released</h4>
${table(['Component','Why it must be pinned'],[
 ['Weights (digest, safetensors)','The model itself'],
 ['Tokenizer + chat template','A template change alters every prompt the model sees'],
 ['Engine image digest + flags','vLLM version, max-model-len, KV dtype change behaviour and capacity'],
 ['Quantisation recipe','FP8 vs BF16 changes quality and memory'],
 ['Sampling defaults','temperature/top-p change outputs'],
 ['Prompt + retrieval config versions','Behaviour lives here too'],
 ['Eval report + approvals','Evidence for the promotion']
])}
<h4>2. Capacity during the switch</h4>
<p>Running v7 and v8 side by side needs extra GPUs. Options: reserve spare capacity for the window; or replace in small steps with <code>maxUnavailable: 1</code> at low traffic if headroom allows one replica less. If neither is possible, the rollout itself is a capacity risk and I say so.</p>
<h4>3. Readiness and warm-up</h4>
<p>Readiness = a real 1-token generation through the engine. Warm the prefix cache by sending the system prompt. Only then does the pod join the canary Service.</p>
<h4>4. Progressive traffic with analysis</h4>
${code('yaml',`strategy:
  canary:
    canaryService: atlas-canary
    stableService: atlas-stable
    steps:
    - setWeight: 5
    - pause: { duration: 10m }
    - analysis: { templates: [ { templateName: llm-slo-and-quality } ] }
    - setWeight: 25
    - pause: { duration: 30m }
    - analysis: { templates: [ { templateName: llm-slo-and-quality } ] }
    - setWeight: 50
    - pause: { duration: 30m }`)}
<p>The AnalysisTemplate compares canary vs stable: TTFT p95, TPOT p95, 5xx and timeout rate, refusal rate, cost per request, and a judge pass rate on sampled canary traffic. Size the sample: detecting a 3-point quality drop needs ≈1,770 judged requests per arm (see chapter formula).</p>
<h4>5. Rollback</h4>
<p>Abort sets weight to 0 — seconds. Registry alias stays on v7 until full promotion, then moves to v8; v7 replicas are scaled down only after a bake period (e.g. 24 h), and v7 weights stay in cache for a fast re-deploy.</p>
<h4>6. Sessions and streams</h4>
<p>Pin a conversation to one version (header or cookie) so a user does not switch model mid-dialogue. Before stopping old pods: remove from Service, wait for in-flight streams (grace period 60–120 s).</p>
<h4>7. What “zero downtime” really means</h4>
<p>Users see no errors attributable to the release, and the SLO error budget is not burned by it. I measure that: errors and latency during the rollout window versus baseline.</p>`,
  diagram:anim('v3q-mlops-canary'),
  followups:[
    {q:'What if v8 needs a different GPU count (TP=4 instead of TP=2)?',a:'It is a different deployment shape; capacity planning must cover both shapes during the overlap. Route by weight at the gateway level across two Deployments rather than a single Rollout, and verify KV capacity per replica in the load test.'},
    {q:'How do you canary a model when quality metrics arrive hours later (user feedback)?',a:'Use fast proxies during the rollout (judge score on samples, refusal rate, response length, escalation-to-human rate), hold at 25–50 % for a longer bake, and keep the old version ready for a day. Slow signals then confirm or trigger a later rollback.'},
    {q:'Two tenants have contractual model pinning. How does the rollout change?',a:'The gateway routes by tenant: pinned tenants stay on v7 until their acceptance; others follow the canary. That means running both versions for longer and tracking cost per version.'},
    {q:'The new version changes the output JSON schema slightly. What breaks and how do you prevent it?',a:'Downstream parsers and tools. Contract tests in the eval gate against the schema, versioned response formats, and constrained decoding with the schema. A schema change is a breaking API change and needs consumer coordination.'}
  ],
  tradeoffs:`<ul><li>Blue-green (full parallel fleet) gives instant cut-over and rollback but doubles GPUs for the window; canary needs less extra capacity but longer exposure.</li><li>Longer bakes catch slow quality regressions but delay improvements and cost overlap GPU-hours.</li><li>Automated analysis is fast and consistent but only as good as its metrics; add a human sign-off at 50 % for high-risk models.</li></ul>`,
  failures:`${table(['Symptom','Evidence','Fix'],[
   ['Canary pods Pending','No spare GPUs','Reserve capacity for the window or step with maxUnavailable'],
   ['Canary latency great, complaints later','No quality metric in analysis','Add sampled judge score and slice metrics'],
   ['Rollback takes 7 minutes','Old replicas were scaled down','Keep stable warm until promotion + bake'],
   ['Users see style change mid-conversation','No session affinity to version','Pin conversation to version']
  ])}`,
  vocab:[
   {term:'release bundle',def:'The immutable set of artifacts and configs that together define a model version in production.'},
   {term:'AnalysisTemplate',def:'Argo Rollouts resource defining metric queries and success conditions evaluated during a rollout.'},
   {term:'bake period',def:'Time a promoted version runs before the previous one is decommissioned.'},
   {term:'session affinity',def:'Routing all requests of a conversation to the same model version.'},
   {term:'error budget',def:'Allowed unreliability under the SLO; a release must not consume it unexpectedly.'}
  ],
  mistakes:['Rolling update in place, which reloads weights and leaves no warm rollback target.','Analysis on latency and errors only — a worse answer is still HTTP 200.','Versioning weights but not tokenizer/template/prompt.','Promising literal zero downtime without measuring it.'],
  related:['v2-model-cicd','v1-k8s-production','v1-k8s-serving']
},
{
  id:'mlops-02', chapter:'v3-ch-mlops', difficulty:2,
  title:'How would you detect model drift in a production LLM application?',
  understand:'This tests whether you know the kinds of drift, the statistics, and — most importantly — what to do when drift is detected. For LLM apps it also checks whether you know drift sources unique to them: knowledge staleness and silent provider model changes.',
  short:'I separate three questions: have the inputs changed, have the outputs changed, and has quality changed. For inputs I track the mix of topics, languages and lengths against a reference window — for text I cluster embeddings and compute a population stability index over cluster shares. For outputs I watch length, refusal rate, tool-call rate and format errors. For quality I run an LLM judge on a daily sample, plus user signals like thumbs-down and escalation to a human agent, all segmented by language, tenant and intent. Drift opens an investigation, not an automatic retrain: the cause is often stale retrieval content, a new product policy, or a provider updating its model behind the same name.',
  detailed:`
<h4>Kinds of drift</h4>
${table(['Kind','Example (Atlas travel assistant)','Signal'],[
 ['Data / input drift','More Arabic queries after a campaign; longer prompts','Topic/language/length distribution, PSI'],
 ['Concept drift','Refund rules change; the right answer changes for the same question','Quality on affected slice; human review'],
 ['Knowledge staleness','RAG index still has last year’s baggage policy','Freshness age of indexed docs; wrong-citation rate'],
 ['Output drift','Answers get longer, refusals rise','Length, refusal, format-error rates'],
 ['Upstream model change','Provider alias points to a new snapshot','Response model id field, sudden output shift']
])}
<h4>PSI worked example (topic mix, 4 clusters)</h4>
${formula(`
reference e = [0.40, 0.30, 0.20, 0.10]    this week a = [0.30, 0.30, 0.25, 0.15]

bin 1  (0.30 − 0.40) × ln(0.30/0.40) = −0.10 × −0.2877 = 0.0288
bin 2  (0.30 − 0.30) × ln(1)         =                  0.0000
bin 3  (0.25 − 0.20) × ln(1.25)      =  0.05 ×  0.2231 = 0.0112
bin 4  (0.15 − 0.10) × ln(1.50)      =  0.05 ×  0.4055 = 0.0203
                                                 PSI = 0.0602
ANSWER  0.06 < 0.1 → small shift; watch, do not page
`)}
<p>Evidently (0.7.x) defaults: numeric columns use KS (≤1,000 rows, p&lt;0.05) or normed Wasserstein (&gt;1,000 rows, threshold 0.1); categorical use chi-square or Jensen-Shannon (0.1); PSI is available with default threshold 0.1. For free text it offers text-content drift (a classifier tries to tell reference from current).</p>
<h4>Quality signals</h4>
<ul><li>Daily sample (e.g. 500 conversations) judged with a versioned rubric; report per slice with confidence intervals.</li>
<li>Implicit feedback: thumbs-down, rephrase-and-retry rate, handoff to human agent, conversation abandonment.</li>
<li>RAG-specific: faithfulness to retrieved context, citation correctness.</li></ul>
<h4>Response playbook</h4>
<ol><li>Is it real? Check sample size and instrumentation changes.</li><li>Which slice?</li><li>Cause: data/knowledge (re-index), prompt (fix template), policy change (update eval + prompt), model (fine-tune or switch), provider (pin snapshot).</li><li>After the fix, add cases to the eval set; update the reference window only after review.</li></ol>`,
  diagram:anim('v3q-mlops-drift'),
  followups:[
    {q:'Why not retrain automatically when drift is detected?',a:'Drift does not tell you the cause or that the model is wrong. Retraining on drifted data can encode errors, and labels may be missing. Automated retraining only makes sense with trusted fresh labels and gates — and still with evaluation before promotion.'},
    {q:'How do you detect drift in free text without labels?',a:'Embed inputs with a fixed embedding model, cluster on the reference period, and track cluster-share PSI and new-cluster emergence (distance to nearest centroid). Also track simple features: language, length, entity types.'},
    {q:'A provider silently updated the model. How would you notice and protect yourself?',a:'Log the response model id/version field, pin dated snapshots where offered, run a canary eval set daily against the provider and alert on score changes. Treat provider updates like your own releases.'},
    {q:'How do you set thresholds without endless false alarms?',a:'Backtest on historical weeks, choose thresholds that would have fired on past known incidents and rarely otherwise, alert on sustained changes (e.g. 2 consecutive days), and send drift to a ticket queue, quality drops to paging only above an SLO-linked threshold.'}
  ],
  tradeoffs:`<ul><li>Larger judged samples give tighter intervals but cost judge tokens; sample stratified by slice instead of uniformly.</li><li>Sensitive drift tests on big data flag tiny, harmless shifts (p-values shrink with n); distance metrics with thresholds are more practical at scale.</li><li>Updating the reference window adapts to the new normal but can hide slow degradation; keep a fixed long-term baseline too.</li></ul>`,
  failures:`<ul><li><b>Drift alert storm after logging change</b> → instrumentation, not users → version the telemetry pipeline, annotate changes.</li><li><b>Quality fell, no drift alert</b> → concept drift with same inputs → quality monitoring must exist independently of input drift.</li><li><b>Judge scores fell after judge model upgrade</b> → measurement drift → version and pin the judge, re-calibrate.</li></ul>`,
  vocab:[
   {term:'PSI',def:'Population Stability Index: Σ (a − e) ln(a/e) over bins; a symmetric measure of distribution shift.'},
   {term:'concept drift',def:'Change in the relationship between inputs and correct outputs.'},
   {term:'reference window',def:'The period whose distribution is treated as normal for comparison.'},
   {term:'Wasserstein distance',def:'Distance between distributions measuring how much mass must move; Evidently’s default for large numeric columns.'},
   {term:'knowledge staleness',def:'Answers wrong because retrieved or trained knowledge is out of date.'}
  ],
  mistakes:['Only monitoring input drift and calling it quality monitoring.','Looking at global averages, hiding a failing slice.','Auto-retraining on drift.','Ignoring that the judge itself can drift.'],
  related:['v2-evaluation-monitoring','v2-rag-production','v2-ai-observability']
},
{
  id:'mlops-03', chapter:'v3-ch-mlops', difficulty:1,
  title:'What is the role of a model registry like MLflow, and how do you use it for releases?',
  understand:'The interviewer checks you know what a registry stores, how it links to experiments and data, and current MLflow practice (aliases over stages). Bonus for linking it to deployment.',
  short:'The registry is the source of truth for “which model artifacts exist, where they came from, and which one is approved for which environment”. In MLflow, a training run logs parameters, metrics and artifacts to the tracking server — metadata in a database backend, large files in an artifact store such as S3. Registering the model creates a numbered version linked to that run, its signature and, via tags, the dataset version. Promotion is done with aliases like champion and challenger, because the old Staging and Production stages are deprecated since MLflow 2.9. Deployment tooling reads models:/name@champion and resolves it to an immutable version, so rollback is just moving the alias back.',
  detailed:`
<h4>MLflow components (MLflow 3.17.x as of Oct 2026)</h4>
${table(['Piece','What it stores'],[
 ['Tracking server — backend store','Run metadata: params, metrics, tags (SQL database, e.g. Postgres; default local sqlite:///mlflow.db)'],
 ['Tracking server — artifact store','Large files: weights, eval reports (e.g. s3://bucket via --artifacts-destination)'],
 ['Model Registry','Registered models, versions, aliases, tags, descriptions'],
 ['Prompt Registry (GenAI)','Versioned prompts with aliases: prompts:/name@production'],
 ['Tracing (GenAI)','OpenTelemetry-compatible traces of LLM apps']
])}
${code('python',`from mlflow import MlflowClient
c = MlflowClient()
mv = c.create_model_version(name="atlas-chat", source=run_uri, run_id=run_id,
                            tags={"dataset": "tickets@v12", "eval": "golden-v5:91.2"})
c.set_registered_model_alias("atlas-chat", "challenger", mv.version)
# after canary passes
c.set_registered_model_alias("atlas-chat", "champion", mv.version)`)}
<p>Deployments reference <code>models:/atlas-chat@champion</code>, but the CD system should resolve the alias at deploy time and record the concrete version and digest — so what runs is immutable and auditable.</p>
<h4>Lineage</h4>
<p>Link: git commit of training code → dataset version (DVC tag or lakeFS commit) → run id → model version → release bundle → deployment. When an incident happens you can answer “what data trained the thing users saw”.</p>
<h4>Stages vs aliases</h4>
<p><code>transition_model_version_stage</code> is deprecated since 2.9.0 and “will be removed in a future major release”; it still exists in 3.x. Aliases are more flexible: any number of named pointers (champion, challenger, tenant-x-pinned).</p>
<h4>For LLMs</h4>
<p>Many LLM teams do not retrain weights often; the registry still matters for fine-tuned adapters (LoRA), quantised variants, and the prompt registry. Large base weights may live in an object store or OCI registry with the MLflow version pointing to their digest.</p>`,
  diagram:D('Registry lineage', {w:900,h:280,
   boxes:[
    {id:'git',x:20,y:40,w:140,h:56,label:'Code commit'},
    {id:'data',x:20,y:170,w:140,h:56,label:'Dataset v12',sub:'DVC / lakeFS'},
    {id:'run',x:210,y:100,w:150,h:60,label:'MLflow run',sub:'params, metrics'},
    {id:'mv',x:410,y:100,w:150,h:60,label:'Model v8',sub:'signature, tags',cls:'hl'},
    {id:'al',x:610,y:40,w:140,h:56,label:'@champion'},
    {id:'al2',x:610,y:170,w:140,h:56,label:'@challenger'},
    {id:'dep',x:780,y:100,w:100,h:60,label:'Deploy',sub:'resolved'}
   ],
   arrows:[{from:'git',to:'run'},{from:'data',to:'run'},{from:'run',to:'mv'},{from:'mv',to:'al',cls:'dash'},{from:'mv',to:'al2'},{from:'al',to:'dep'}]
  }, 'Aliases are mutable pointers; versions are immutable; deployment records the resolved version.'),
  followups:[
    {q:'How do you run the tracking server in production?',a:'mlflow server with a managed Postgres backend store and an S3/GCS artifact destination, behind SSO, with backups of the database. Artifacts are proxied (--serve-artifacts) or accessed directly with scoped IAM.'},
    {q:'Where do prompts live?',a:'In the MLflow Prompt Registry (mlflow.genai.register_prompt / load_prompt with prompts:/name@alias) or in git with the same review process — but each production request should log which prompt version it used.'},
    {q:'How do you enforce that only evaluated models get @champion?',a:'Only the CD pipeline service account can set that alias, and it does so only when the version has an eval-report tag meeting thresholds and an approval record. Humans get read-only in production registries.'}
  ],
  tradeoffs:`<ul><li>MLflow is open and flexible; managed registries (SageMaker, Vertex) integrate with their serving but lock you in.</li><li>Storing huge base weights in MLflow artifacts is possible but often slower than OCI/object storage with digests referenced from MLflow.</li></ul>`,
  failures:`<ul><li>Alias moved manually in the UI → unreviewed promotion → restrict permissions, audit log.</li><li>Model version points to deleted artifact path → lifecycle rule removed it → retention policy aligned with registry.</li><li>“latest” used in deploy → unknown version in prod → always resolve and pin.</li></ul>`,
  vocab:[
   {term:'registered model alias',def:'Mutable named pointer (e.g. @champion) to a model version.'},
   {term:'model signature',def:'Declared input/output schema of a logged model (infer_signature).'},
   {term:'backend store',def:'MLflow database for run and registry metadata.'},
   {term:'artifact store',def:'Object storage for large run artifacts such as weights.'},
   {term:'lineage',def:'Traceable chain from code and data to a deployed model version.'}
  ],
  mistakes:['Saying MLflow 3 removed stages (they are deprecated, not removed).','Deploying “latest”.','Keeping the registry without dataset lineage.','Letting anyone move the champion alias.'],
  related:['v2-mlops-foundations','v2-model-cicd','v1-training-loop']
},
{
  id:'mlops-04', chapter:'v3-ch-mlops', difficulty:2,
  title:'What evaluation gates would you put in an LLM CI/CD pipeline?',
  understand:'The interviewer wants a layered gate design: fast deterministic checks, offline quality by slice with statistics, safety, performance and cost — and an understanding that any of model, prompt or retrieval changes must pass them.',
  short:'I order gates from cheap to expensive. First deterministic checks: templates render, outputs parse against the schema, tool definitions are valid. Then offline quality on a versioned golden set, reported per slice — English and Arabic, booking, refund, policy questions — and compared with the current champion using confidence intervals, so noise does not block or pass releases. Then a safety gate with injection, jailbreak and data-leak cases where any critical failure blocks. Finally a performance and cost gate from a short load test: time to first token, tokens per output and cost per request against budgets. The same gates run whether the change is new weights, a prompt edit or a retrieval change, and results are attached to the registry version.',
  detailed:`
<h4>Gate stack</h4>
${table(['Gate','Examples','Block rule'],[
 ['Deterministic','Prompt renders, JSON schema validity on 200 cases, tool schema lint','Any failure'],
 ['Regression set','Every past incident turned into a test case','Any previously fixed case fails'],
 ['Golden quality','600 curated Q/A with references, judged + exact checks','Overall and per-slice drop beyond CI'],
 ['RAG metrics','Faithfulness, context recall on the RAG set','Below threshold'],
 ['Safety','Prompt injection, jailbreak, PII leakage, harmful content','Any critical failure'],
 ['Performance','TTFT/TPOT p95 at target load','Exceeds SLO budget'],
 ['Cost','Input+output tokens per request, $/successful request','> +10 % without approval']
])}
<h4>Statistics: avoid noise-driven decisions</h4>
${formula(`
95 % confidence half-width for a pass rate p on n cases
                   ┌───────────────┐
  half-width ≈ 1.96 √ p(1 − p) / n

  p = 0.90, n = 600 → 1.96 × √(0.09/600) = 1.96 × 0.01225 ≈ 0.024
ANSWER  ±2.4 points: a 1-point drop on 600 cases is noise;
        a slice with n = 80 has ±6.6 points — needs more cases
`)}
<p>(n = 80: √(0.09/80) = 0.0335 × 1.96 ≈ 0.066.) Paired comparison — same cases for candidate and champion — reduces noise further.</p>
<h4>Gates as code</h4>
<p>Thresholds live in the repo (reviewed). With MLflow GenAI: <code>mlflow.genai.evaluate(data=..., scorers=[...], predict_fn=...)</code> with built-in scorers (e.g. <code>Correctness</code>, <code>Guidelines</code>, <code>RetrievalGroundedness</code>) and custom <code>@scorer</code> functions; results logged to the run and tagged on the model version.</p>
<h4>What triggers the gates</h4>
<p>Any change to: weights or adapter, tokenizer/template, engine version or flags, quantisation, prompt, retrieval (chunking, embedding model, reranker, top-k), tool definitions. That is the “everything is a model change” principle.</p>`,
  diagram:anim('v3q-mlops-gates'),
  followups:[
    {q:'Where does the golden set come from and how do you stop it going stale?',a:'Seed from real (anonymised) traffic sampled by slice, expert-written answers, plus adversarial cases; add every incident as a regression case; review quarterly and retire outdated policy cases. Version the set; compare candidates only on the same version.'},
    {q:'How do you avoid overfitting prompts to the golden set?',a:'Keep a held-out set that prompt authors cannot see, rotate fresh samples from production, and check online metrics in canary — offline gains that vanish online are a sign of overfitting.'},
    {q:'Gates take 2 hours and block developers. What do you do?',a:'Tier them: fast subset on every PR (minutes), full suite on merge to release branch, nightly full + load test. Cache champion results; run judge calls in parallel with rate limits.'},
    {q:'How do you gate a non-deterministic model?',a:'Use temperature 0 where possible for evaluation, run multiple samples for stochastic settings and score the pass rate, and judge against rubrics rather than exact strings.'}
  ],
  tradeoffs:`<ul><li>More cases mean tighter confidence intervals but more judge cost and time.</li><li>Strict per-slice gates protect minorities of traffic (e.g. Arabic) but block more releases; allow documented, approved exceptions.</li><li>Human review gives the best signal for high-risk changes but does not scale; use it on samples and disagreements.</li></ul>`,
  failures:`<ul><li><b>Release passed gates, users unhappy</b> → golden set not representative → refresh from production slices.</li><li><b>Gate flaps between runs</b> → sampling noise → paired eval, more cases, fixed seeds/temperature.</li><li><b>Prompt change bypassed CI</b> → prompts edited in a UI → registry permissions, deploy only via pipeline.</li></ul>`,
  vocab:[
   {term:'golden set',def:'Curated, versioned evaluation dataset with reference answers or rubrics.'},
   {term:'regression set',def:'Cases from past failures that must keep passing.'},
   {term:'slice',def:'A segment of traffic (language, intent, tenant) evaluated separately.'},
   {term:'paired evaluation',def:'Comparing candidate and champion on identical cases to reduce variance.'},
   {term:'scorer',def:'Function or judge that produces a metric for an evaluation case (MLflow GenAI term).'}
  ],
  mistakes:['Gating only on unit tests.','Reading 1-point differences on a few hundred cases as real.','Not gating prompt or retrieval changes.','No cost/latency gate, so a “better” prompt doubles spend.'],
  related:['v2-model-cicd','v2-evaluation-monitoring','v2-rag-production']
},
{
  id:'mlops-05', chapter:'v3-ch-mlops', difficulty:3,
  title:'How do you use LLM-as-judge reliably?',
  understand:'The interviewer checks whether you understand judge bias, calibration against humans, and how to make judge scores trustworthy enough to gate releases.',
  short:'An LLM judge is a measuring instrument, so I calibrate it before trusting it. I write a narrow rubric per criterion — groundedness, correctness against a reference, policy compliance — rather than one vague quality score. I label a few hundred examples with humans and measure agreement with Cohen’s kappa; if agreement is weak I fix the rubric or the judge model before using it as a gate. I counter known biases: for pairwise comparisons I swap the order and only count consistent verdicts, I control for answer length, and I avoid using the same model family to judge itself where possible. I pin and version the judge model and prompt, track its cost, and keep humans reviewing disagreements and high-risk slices.',
  detailed:`
<h4>Pointwise vs pairwise</h4>
${table(['Mode','Use','Risk'],[
 ['Pointwise rubric (pass/fail or 1–5)','Gates, monitoring trends','Scale drift, leniency'],
 ['Pairwise (A vs B)','Comparing candidate vs champion','Position bias — mitigate with order swap'],
 ['Reference-based','Correctness when a gold answer exists','Penalises valid paraphrases if rubric is strict']
])}
<h4>Known biases</h4>
<ul><li><b>Position</b>: prefers the first (or second) answer → run both orders.</li><li><b>Verbosity</b>: prefers longer answers → rubric explicitly penalises padding; report length alongside.</li><li><b>Self-preference</b>: favours outputs from its own family → use a different family or validate with humans.</li><li><b>Leniency</b>: passes plausible but wrong answers → give the reference and retrieved context.</li></ul>
<h4>Calibration with kappa</h4>
${formula(`
200 cases labelled by humans and by the judge
  observed agreement      pₒ = 170 / 200 = 0.85
  human pass rate 0.60, judge pass rate 0.65
  chance agreement        pₑ = 0.60 × 0.65 + 0.40 × 0.35 = 0.39 + 0.14 = 0.53

        pₒ − pₑ     0.85 − 0.53     0.32
  κ = ───────── = ───────────── = ────── ≈ 0.68
        1 − pₑ       1 − 0.53       0.47
ANSWER  substantial but not perfect agreement: OK for trend monitoring,
        add human review for gate decisions near the threshold
`)}
<p>Raw agreement (85 %) looks better than kappa (0.68) because both raters pass most answers anyway.</p>
<h4>Tooling (as of Oct 2026)</h4>
<p>MLflow GenAI provides built-in LLM-judge scorers (e.g. <code>Correctness</code>, <code>Guidelines</code>, <code>RetrievalGroundedness</code>) and <code>mlflow.genai.make_judge(name=..., instructions=..., model=...)</code> for custom judges. Evidently offers <code>LLMEval</code> templates and built-in judges (e.g. faithfulness, correctness). DeepEval’s <code>GEval</code> implements rubric-based judging.</p>
<h4>Operations</h4>
<p>Pin judge model snapshot and prompt version; log every verdict with rationale; budget cost (judge tokens ≈ input of question + context + answer + rubric); re-calibrate when the judge or rubric changes.</p>`,
  diagram:D('Judge calibration loop', {w:900,h:280,
   boxes:[
    {id:'s',x:20,y:110,w:150,h:56,label:'Sample',sub:'200 cases'},
    {id:'h',x:220,y:30,w:160,h:56,label:'Human labels',sub:'rubric'},
    {id:'j',x:220,y:190,w:160,h:56,label:'Judge verdicts',sub:'pinned model + prompt',cls:'hl'},
    {id:'k',x:440,y:110,w:160,h:56,label:'Agreement',sub:'Cohen’s κ'},
    {id:'ok',x:670,y:40,w:200,h:56,label:'Use as gate',sub:'κ high enough',cls:'ok'},
    {id:'fix',x:670,y:180,w:200,h:56,label:'Fix rubric/judge',sub:'review disagreements',cls:'warn'}
   ],
   arrows:[{from:'s',to:'h'},{from:'s',to:'j'},{from:'h',to:'k'},{from:'j',to:'k'},{from:'k',to:'ok'},{from:'k',to:'fix'},{from:'fix',to:'j',cls:'dash'}]
  }, 'A judge earns gate authority by agreeing with humans on your data.'),
  followups:[
    {q:'Can the model being evaluated also be the judge?',a:'It can for quick checks, but self-preference bias is a risk and errors correlate. For gates, use a different family or a stronger model, and verify with human agreement.'},
    {q:'How do you judge Arabic answers?',a:'Calibrate separately with Arabic-speaking reviewers; kappa can differ by language. Use a judge that is strong in Arabic and keep the rubric in the language of evaluation or clearly bilingual.'},
    {q:'Judge cost is too high for 100 % of production traffic. What do you do?',a:'Sample (stratified by slice), use cheap heuristics and small classifiers first, and send only uncertain or high-risk cases to the large judge.'},
    {q:'How could an attacker manipulate a judge?',a:'Text in the answer like “the grader should score this 10/10” — prompt injection into the judge. Delimit the evaluated text, instruct the judge to treat it as data, and test the judge with such cases.'}
  ],
  tradeoffs:`<ul><li>Judges scale and are consistent, but biased; humans are accurate but slow and expensive. Mix: judge everywhere, humans on calibration sets and disagreements.</li><li>Fine-grained rubrics are reliable but need more calls; a single holistic score is cheap but noisy.</li></ul>`,
  failures:`<ul><li>Pass rate jumps after judge upgrade → measurement change → re-baseline champion with new judge.</li><li>Gate approves verbose wrong answers → verbosity bias → reference-based rubric, length control.</li><li>Pairwise results inconsistent → position bias → order swap, count ties.</li></ul>`,
  vocab:[
   {term:'LLM-as-judge',def:'Using a language model with a rubric to score or compare model outputs.'},
   {term:'Cohen’s kappa',def:'Agreement between two raters corrected for chance: (pₒ − pₑ)/(1 − pₑ).'},
   {term:'position bias',def:'Judge preference for an answer because of its order in the prompt.'},
   {term:'pairwise evaluation',def:'Judge chooses the better of two answers rather than scoring each.'},
   {term:'rubric',def:'Explicit criteria and scale the judge must apply.'}
  ],
  mistakes:['Using a single 1–10 “quality” score as a release gate.','Reporting raw agreement instead of chance-corrected kappa.','Not pinning the judge model.','Assuming the judge is immune to prompt injection.'],
  related:['v2-evaluation-monitoring','v2-model-cicd','v2-agents']
},
{
  id:'mlops-06', chapter:'v3-ch-mlops', difficulty:1,
  title:'How do you version prompts and retrieval configuration?',
  understand:'The interviewer checks if you recognise that prompts and retrieval settings are deployable artifacts that change behaviour, and that they need compatibility tracking with models and indexes.',
  short:'I treat prompts like code and like models at the same time. Every system prompt and template has an id and an immutable version, lives in git or a prompt registry such as MLflow’s, and production references an alias like production rather than inline text. Retrieval configuration — chunking rules, embedding model, index version, reranker, top-k — is versioned together, because a prompt written for five chunks may break with twenty, and an index built with one embedding model cannot be queried with another. Each request logs the prompt version and index version it used, so I can correlate quality with versions, A/B test prompts, and roll back by moving the alias, with the same evaluation gates as a model release.',
  detailed:`
<h4>What to version</h4>
${table(['Artifact','Example id','Compatibility constraint'],[
 ['System prompt / template','atlas-system@v14','Model family chat template, tool schema'],
 ['Few-shot examples','refund-fewshot@v3','Prompt version'],
 ['Tool definitions','booking-tools@v6','Backend API versions'],
 ['Chunking config','chunk-512-overlap-64@v2','Index must be rebuilt when changed'],
 ['Embedding model','embed-model@2026-09','Index vectors only valid for this model'],
 ['Index version','policies-index@v41','Built from chunk config + embed model + corpus snapshot'],
 ['Reranker + top-k','rerank@v2, k=5','Prompt context budget']
])}
<h4>MLflow Prompt Registry</h4>
${code('python',`import mlflow
mlflow.genai.register_prompt(name="atlas-system", template=TEMPLATE,
                             commit_message="Add refund policy guidance")
p = mlflow.genai.load_prompt("prompts:/atlas-system@production")`)}
<h4>Compatibility manifest</h4>
<p>A release bundle lists exact versions: model v8 + prompt v14 + tools v6 + index v41 (built with embed model X and chunk config v2). Deploy tooling refuses combinations not evaluated together.</p>
<h4>Runtime logging</h4>
<p>Every trace carries prompt_version, index_version, model_version (e.g. as span attributes). Then a quality drop can be sliced by version within minutes.</p>
<h4>Rollback</h4>
<p>Prompt rollback = move alias; instant. Index rollback = keep the previous index alive and swap an alias (e.g. OpenSearch/Elasticsearch index alias), so rollback does not require re-embedding.</p>`,
  diagram:D('Versioned behaviour components', {w:900,h:280,
   boxes:[
    {id:'p',x:20,y:30,w:170,h:56,label:'Prompt v14',sub:'registry alias'},
    {id:'t',x:20,y:120,w:170,h:56,label:'Tools v6'},
    {id:'m',x:20,y:210,w:170,h:56,label:'Model v8'},
    {id:'c',x:260,y:30,w:180,h:56,label:'Chunk config v2'},
    {id:'e',x:260,y:120,w:180,h:56,label:'Embed model X'},
    {id:'i',x:500,y:75,w:170,h:60,label:'Index v41',sub:'built from both',cls:'hl'},
    {id:'b',x:720,y:120,w:160,h:70,label:'Release bundle',sub:'tested together',cls:'ok'}
   ],
   arrows:[{from:'c',to:'i'},{from:'e',to:'i'},{from:'p',to:'b'},{from:'t',to:'b'},{from:'m',to:'b'},{from:'i',to:'b'}]
  }, 'Behaviour comes from the combination; only evaluated combinations may deploy.'),
  followups:[
    {q:'Product managers want to edit prompts without engineers. How?',a:'Give them a registry UI that creates new versions in a non-production alias, with automated eval gates on save, and promotion through the same pipeline. Editing production directly is not allowed.'},
    {q:'How would you A/B test two prompt versions?',a:'Gateway assigns users to arms by stable hash, logs prompt version, and compares task success, judge score, cost and latency with enough sample size (≈1,770 per arm for a 3-point pass-rate difference).'},
    {q:'You changed the embedding model. What else changes?',a:'The whole index must be rebuilt; queries must use the same model; caches keyed on embeddings must be invalidated; and the eval must re-run, since retrieval quality and similarity thresholds change.'}
  ],
  tradeoffs:`<ul><li>Git gives review and history; a prompt registry gives non-engineer access and aliases. Many teams store in git and sync to a registry.</li><li>Fine-grained versions give precise rollback but more combinations to test; bundle versions limit combinations.</li></ul>`,
  failures:`<ul><li>Quality drop, no model change → hidden prompt edit → logs show prompt version changed.</li><li>Retrieval returns garbage after deploy → index built with different embedding model than query path → compatibility check in deploy.</li><li>Rollback of model leaves new prompt → incompatible template → roll back the bundle, not a piece.</li></ul>`,
  vocab:[
   {term:'prompt registry',def:'Versioned store of prompt templates with aliases (e.g. MLflow Prompt Registry).'},
   {term:'index alias',def:'Pointer name to a concrete search index, swapped atomically for rollouts and rollbacks.'},
   {term:'compatibility manifest',def:'Record of which artifact versions were evaluated together.'},
   {term:'chat template',def:'Model-specific format that turns messages into the token sequence the model was trained on.'}
  ],
  mistakes:['Prompts as string literals scattered in code.','Not logging prompt version per request.','Changing embedding model without re-indexing.','Rolling back one component of a bundle.'],
  related:['v2-model-cicd','v2-rag-production','v2-rag-fundamentals']
},
{
  id:'mlops-07', chapter:'v3-ch-mlops', difficulty:2,
  title:'What does CI/CD look like for an LLM-based system end to end?',
  understand:'A broad design question. The interviewer wants to see all the change types (code, container, model, prompt, data/index), the pipeline stages for each, and how they converge in progressive delivery and GitOps.',
  short:'There are several change streams, and each needs its own pipeline that converges on one release. Application code and containers go through the normal build, test, scan and sign. Model artifacts go through training or fine-tuning, evaluation, signing and registry registration. Prompts and tool definitions go through rendering checks and eval gates. Retrieval data goes through ingestion and index builds with retrieval evals. The release bundle pins all of them, is promoted through GitOps — for example Argo CD syncing manifests that reference digests and aliases — and progressively delivered with Argo Rollouts analysis on latency, errors, cost and quality. Rollback restores the previous compatible bundle, not just the container.',
  detailed:`
<h4>Change streams</h4>
${table(['Stream','Build','Tests / gates','Output'],[
 ['App code','Container build','Unit, integration, SAST, image scan, sign','Image digest'],
 ['Model / adapter','Fine-tune job (tracked run)','Offline eval, safety, perf, license, sign weights','Registry version'],
 ['Prompt / tools','Render + lint','Schema, golden eval, safety','Prompt version'],
 ['Retrieval data','Ingest, chunk, embed, index','Retrieval recall@k, freshness, ACL tests','Index version'],
 ['Infra','Terraform/Helm','Plan review, policy (OPA)','Applied state']
])}
<h4>Convergence</h4>
<ol><li>A bundle PR updates the GitOps repo: image digest, model version, prompt alias target, index alias, engine flags.</li>
<li>Integration eval runs the whole bundle (end-to-end conversations, tool calls).</li>
<li>Argo CD syncs to staging; load test checks TTFT/TPOT at target RPS and cost per request.</li>
<li>Production via Argo Rollouts canary with analysis; promotion moves registry aliases.</li></ol>
<h4>Continuous training (when it applies)</h4>
<p>For classic ML with fresh labels, scheduled retraining → evaluation → candidate alias is normal. For LLMs, retraining weights is rare; “continuous” work is usually prompt, retrieval and index updates — which still pass gates.</p>
<h4>Signing and provenance</h4>
<p>Container signed (cosign), model files signed (OpenSSF model-signing or cosign sign-blob), admission policy verifies signatures before pods start.</p>`,
  diagram:D('Four streams, one release', {w:900,h:320,
   boxes:[
    {id:'a',x:20,y:20,w:170,h:50,label:'Code → image'},
    {id:'b',x:20,y:95,w:170,h:50,label:'Fine-tune → model'},
    {id:'c',x:20,y:170,w:170,h:50,label:'Prompt → version'},
    {id:'d',x:20,y:245,w:170,h:50,label:'Docs → index'},
    {id:'g',x:260,y:130,w:170,h:60,label:'Gates per stream',cls:'hl'},
    {id:'bun',x:480,y:130,w:150,h:60,label:'Bundle PR',sub:'GitOps repo'},
    {id:'stg',x:660,y:60,w:120,h:56,label:'Staging',sub:'load + e2e'},
    {id:'can',x:660,y:200,w:120,h:56,label:'Canary',sub:'analysis'},
    {id:'prod',x:800,y:130,w:80,h:56,label:'Prod',cls:'ok'}
   ],
   arrows:[{from:'a',to:'g'},{from:'b',to:'g'},{from:'c',to:'g'},{from:'d',to:'g'},{from:'g',to:'bun'},{from:'bun',to:'stg'},{from:'stg',to:'can'},{from:'can',to:'prod'}]
  }, 'Each stream has its own gates; the bundle is what gets promoted and rolled back.'),
  followups:[
    {q:'Give one automated and one human gate.',a:'Automated: per-slice golden eval within confidence bounds and zero critical safety failures. Human: domain-expert review of 50 sampled answers for a high-risk change (e.g. refund policy), recorded as an approval on the registry version.'},
    {q:'How long can this pipeline take and how do you keep developers fast?',a:'PR-level fast subset in minutes; full eval nightly or on release branch; load tests in staging. Most changes are prompts, which skip the training stage entirely.'},
    {q:'How do you handle an urgent hotfix (e.g. remove a harmful behaviour)?',a:'A pre-approved fast path: a guardrail rule or prompt change with a reduced but mandatory safety and regression suite, deployed via the same GitOps path with a faster canary, and a follow-up full evaluation.'}
  ],
  tradeoffs:`<ul><li>One monolithic pipeline is simple but slow; separate streams are fast but need a compatibility manifest.</li><li>GitOps gives audit and rollback but adds latency to urgent changes; keep a governed fast path.</li></ul>`,
  failures:`<ul><li>Index rebuilt nightly outside the pipeline → untested behaviour change → index builds go through gates.</li><li>Staging load test passes, prod slow → different prompt-length distribution → replay production length histograms.</li><li>Unsigned model reaches prod → admission policy missing → enforce signature verification.</li></ul>`,
  vocab:[
   {term:'GitOps',def:'Desired state in git, reconciled into clusters by a controller such as Argo CD.'},
   {term:'progressive delivery',def:'Gradual exposure of a release with automated analysis and rollback.'},
   {term:'continuous training',def:'Automated retraining on new data, gated by evaluation before promotion.'},
   {term:'admission policy',def:'Cluster rule that rejects workloads not meeting conditions such as verified signatures.'}
  ],
  mistakes:['A green unit-test pipeline treated as model quality evidence.','Rolling back only the container.','Letting index updates bypass CI.','No load test with real token distributions.'],
  related:['v2-model-cicd','v1-k8s-production','v2-rag-production']
},
{
  id:'mlops-08', chapter:'v3-ch-mlops', difficulty:2,
  title:'Shadow testing, canary, A/B testing and blue-green: when do you use each for models?',
  understand:'The interviewer wants precise distinctions — what each reveals, its cost and privacy implications — and how they combine in a release.',
  short:'Shadow mirrors real requests to the candidate while users only see the old model’s answer; it reveals crashes, latency and offline quality on real inputs without user risk, but doubles inference cost for the mirrored share and cannot show how users react. A canary sends a small share of real users to the candidate to check real impact with automatic abort. An A/B test is an experiment to decide which version is better on a business metric, so it needs fixed allocation, enough sample and a pre-registered metric. Blue-green keeps a full parallel fleet and switches all at once, giving instant rollback at double capacity. For a major model change I often do shadow first, then canary, and A/B only when the question is “which is better” rather than “is it safe”.',
  detailed:`
${table(['Method','Users see candidate?','Reveals','Cost','Watch-outs'],[
 ['Shadow','No','Crashes, latency, output differences on real inputs','Extra inference for mirrored share','Privacy: mirrored prompts go to a new system; side effects must be disabled (no tool writes)'],
 ['Canary','Small %','Real impact, errors, quality on live traffic','Small overlap','Need enough sample; abort criteria'],
 ['A/B','Fixed split','Which version wins on outcome metrics','Overlap for experiment duration','Stats design, novelty effects, ethics of worse arm'],
 ['Blue-green','All at switch time','Instant cut-over and rollback','2× fleet for the window','GPU availability; warm-up of green before switch']
])}
<h4>Shadow for LLMs: special care</h4>
<ul><li>Tools: shadow calls must be read-only or stubbed — a shadow agent must not book flights.</li><li>Cost: mirroring 10 % of 200 req/s = 20 req/s of extra GPU load.</li><li>Comparison: outputs are not identical by nature; compare with a judge pairwise, or with task-level metrics (schema validity, tool chosen).</li></ul>
<h4>Statistics for A/B</h4>
<p>Pre-register the primary metric (e.g. task completion without human handoff), minimum detectable effect and sample size; run for full weekly cycles (GCC weekends differ: Friday–Saturday); avoid peeking without sequential-testing corrections.</p>
<h4>Combining</h4>
${formula(`
shadow (1–3 days, 10 % mirrored)  → safety, latency, crash check
canary (5 % → 25 % → 50 %)        → live impact with abort
A/B (optional, 50/50, 2 weeks)    → business decision between good options
`)}`,
  diagram:D('Four exposure patterns', {w:900,h:300,
   boxes:[
    {id:'u',x:20,y:120,w:120,h:56,label:'Users'},
    {id:'g',x:180,y:120,w:130,h:56,label:'Gateway',cls:'hl'},
    {id:'old',x:420,y:40,w:180,h:56,label:'Current model',sub:'answers users',cls:'ok'},
    {id:'sh',x:420,y:200,w:180,h:56,label:'Candidate',sub:'shadow / canary %'},
    {id:'cmp',x:690,y:120,w:180,h:56,label:'Compare',sub:'judge, latency, errors'}
   ],
   arrows:[{from:'u',to:'g'},{from:'g',to:'old',label:'100 % or 95 %'},{from:'g',to:'sh',cls:'dash',label:'mirror or 5 %'},{from:'old',to:'cmp',cls:'dash'},{from:'sh',to:'cmp',cls:'dash'}]
  }, 'Shadow: dashed copy, users never see it. Canary: a real share of users.'),
  followups:[
    {q:'Why can shadow testing miss problems a canary would catch?',a:'Users do not interact with shadow output, so multi-turn effects, user satisfaction and downstream actions are invisible; also shadow tool calls are stubbed, hiding integration failures.'},
    {q:'What privacy issue does shadowing create?',a:'User prompts flow to a new system (maybe a new vendor or region) and new logs. Check data processing agreements and residency (e.g. Saudi PDPL), and redact or limit to permitted traffic.'},
    {q:'When is blue-green justified for GPU models?',a:'When rollback must be instant at full scale and the window is short (e.g. a major engine upgrade), and you can secure a parallel fleet temporarily, e.g. via a reservation. Otherwise canary is cheaper.'}
  ],
  tradeoffs:`<ul><li>Shadow is safest for users but most expensive per insight and blind to user behaviour.</li><li>Canary balances risk and cost; A/B answers business questions but exposes users to a possibly worse arm for longer.</li><li>Blue-green maximises rollback speed at maximal capacity cost.</li></ul>`,
  failures:`<ul><li>Shadow agent executes real bookings → tools not stubbed → side-effect isolation is mandatory.</li><li>A/B stopped early on a lucky spike → peeking → pre-registered duration or sequential tests.</li><li>Blue-green switch with cold green → TTFT spike → warm green with replay traffic before switching.</li></ul>`,
  vocab:[
   {term:'shadow traffic',def:'Mirrored copies of requests sent to a candidate whose responses are not returned to users.'},
   {term:'canary',def:'Small share of real traffic routed to a candidate with automated abort.'},
   {term:'A/B test',def:'Controlled experiment comparing versions on pre-registered outcome metrics.'},
   {term:'blue-green',def:'Two full environments; traffic switches entirely from one to the other.'},
   {term:'minimum detectable effect',def:'Smallest difference an experiment is designed to detect with given power.'}
  ],
  mistakes:['Calling shadow and canary the same thing.','Shadowing agents with live tools.','Running A/B without sample size planning.','Ignoring weekly seasonality in experiment length.'],
  related:['v2-model-cicd','v2-evaluation-monitoring','v2-ai-gateway']
},
{
  id:'mlops-09', chapter:'v3-ch-mlops', difficulty:2,
  title:'How do you manage model supply-chain risk?',
  understand:'The interviewer tests whether you treat models as executable, privileged inputs and know concrete controls: formats, pinning, signing, scanning, licences, provenance.',
  short:'A model file runs inside a privileged GPU process with access to data and networks, so I treat it like a third-party binary. I only load weights in safetensors, because pickle-based formats can execute arbitrary code when loaded. I pin the exact repository revision by commit hash and avoid trust_remote_code unless the code has been reviewed and pinned too. Downloads go through an internal mirror or artifact registry with malware and pickle scanning, checksums and signatures — the OpenSSF model-signing tool or cosign sign-blob — and the deployment admission check verifies them. I record provenance — source, licence, dataset notes, who approved it — and scan the serving images and Python dependencies like any other software.',
  detailed:`
<h4>Threats</h4>
${table(['Threat','Example','Control'],[
 ['Code execution on load','Malicious pickle in a model repo (JFrog 2024 report of a reverse shell)','safetensors only; scanners; sandboxed conversion'],
 ['Remote code','trust_remote_code=True runs repo Python','Avoid; or review + pin revision hash'],
 ['Tampering','Weights swapped in storage','Digest pinning, signatures verified at deploy'],
 ['Poisoned/backdoored weights','Fine-tune with trigger behaviour','Provenance, eval incl. red-team, trusted sources'],
 ['Dependency compromise','Malicious package in serving image','SBOM, image scanning, pinned deps'],
 ['Licence violation','Non-commercial weights in production','Licence review in intake']
])}
<h4>Facts to cite</h4>
<ul><li>Hugging Face docs: loading pickle can lead to arbitrary code execution; the Hub scans pickles but “this is not 100 % foolproof”.</li>
<li>Transformers prefers safetensors when available; docs recommend pinning <code>revision</code> to a commit hash with remote code.</li>
<li>OpenSSF/Sigstore <code>model-signing</code> (1.1.1): <code>model_signing sign &lt;model_dir&gt;</code> / <code>model_signing verify</code>, producing a Sigstore bundle with an in-toto statement.</li>
<li>cosign (v3.1.x): <code>cosign sign-blob</code> / <code>verify-blob</code> for individual files.</li></ul>
<h4>Intake pipeline</h4>
<ol><li>Request model + licence review.</li><li>Download in an isolated job; convert to safetensors if needed in a sandbox; scan.</li><li>Evaluate (quality + safety + backdoor probes).</li><li>Sign, store in internal registry with digest.</li><li>Serving pulls only from the internal registry; admission verifies signature.</li></ol>`,
  diagram:D('Model intake pipeline', {w:900,h:260,
   boxes:[
    {id:'hub',x:20,y:100,w:130,h:56,label:'Public hub',cls:'warn'},
    {id:'iso',x:180,y:100,w:150,h:56,label:'Isolated fetch',sub:'pin revision'},
    {id:'scan',x:360,y:100,w:140,h:56,label:'Scan + convert',sub:'safetensors'},
    {id:'ev',x:530,y:100,w:120,h:56,label:'Eval + red team'},
    {id:'sign',x:680,y:30,w:200,h:56,label:'Sign + internal registry',cls:'hl'},
    {id:'srv',x:680,y:170,w:200,h:56,label:'Serving',sub:'admission verifies',cls:'ok'}
   ],
   arrows:[{from:'hub',to:'iso'},{from:'iso',to:'scan'},{from:'scan',to:'ev'},{from:'ev',to:'sign'},{from:'sign',to:'srv'}]
  }, 'Production never pulls directly from a public hub.'),
  followups:[
    {q:'Is safetensors enough?',a:'No. It removes code execution on load, but not poisoned weights, malicious tokenizer/code files, or compromised dependencies. It is one layer.'},
    {q:'A team needs a model that requires trust_remote_code. What do you do?',a:'Review the code, pin the revision commit hash, vendor the code into our repo, run it in a restricted environment, and re-review on every update. Prefer models supported natively by the engine.'},
    {q:'How would you detect a backdoored fine-tune?',a:'Hard in general. Use provenance (who trained it, on what data), behaviour tests with trigger-like inputs, comparison against the base model on diverse probes, and restrict the model’s tool permissions so a backdoor has limited impact.'}
  ],
  tradeoffs:`<ul><li>An internal mirror slows adoption of new models but gives control and audit.</li><li>Strict signature enforcement can block urgent fixes; keep a break-glass process with audit.</li></ul>`,
  failures:`<ul><li>Pod pulls model from internet at start → hub outage or tampering affects prod → internal registry only.</li><li>Signature verification disabled “temporarily” → never re-enabled → policy as code with expiry.</li><li>Licence discovered post-launch → intake skipped → registry requires licence field.</li></ul>`,
  vocab:[
   {term:'safetensors',def:'Tensor file format that stores only data (no code), safe and fast to load.'},
   {term:'trust_remote_code',def:'Transformers option that executes Python code from a model repository.'},
   {term:'model signing',def:'Cryptographic signature over model files proving origin and integrity (e.g. OpenSSF model-signing).'},
   {term:'provenance',def:'Recorded origin and history of an artifact: source, builder, inputs.'},
   {term:'SBOM',def:'Software bill of materials listing components and versions in an image.'}
  ],
  mistakes:['Downloading arbitrary checkpoints with trust_remote_code in production.','Assuming the Hub’s pickle scanning is complete protection.','Pinning by branch name instead of commit hash.','Ignoring licences.'],
  related:['v2-ai-threat-model','v2-governance','v2-model-cicd']
},
{
  id:'mlops-10', chapter:'v3-ch-mlops', difficulty:3,
  title:'A newly fine-tuned model has better benchmark scores but user complaints increase. What do you do?',
  understand:'This mixes incident handling with evaluation design. The interviewer wants you to protect users first, then diagnose the mismatch between offline evaluation and real usage, and fix the process.',
  short:'First I protect users: stop the rollout and, if complaints reflect real harm or the SLO is burning, roll back by shifting traffic to the previous version, which should still be warm. Then I find what differs between the benchmark and reality. I segment complaints by language, intent, prompt length and tenant, pull real conversations and have experts label them, and compare old and new models side by side on those cases. Common causes are a benchmark that does not represent our traffic, a fine-tune that over-fitted a style, a changed chat template, or degraded behaviour on long or Arabic prompts. The fix is both the model and the process: the failing cases join the regression set, and online signals get a stronger role in the canary.',
  detailed:`
<h4>Step 1 — Contain</h4>
<p>Pause the rollout. If complaints indicate harm (wrong refunds, unsafe content) or quality SLO burn, roll back via traffic weight. Communicate with support teams so they know the change.</p>
<h4>Step 2 — Quantify</h4>
${table(['Signal','Old model','New model'],[
 ['Benchmark score (offline)','78 %','83 %'],
 ['Thumbs-down rate','3.1 %','5.4 %'],
 ['Human handoff rate','8 %','11 %'],
 ['Avg answer length (tokens)','180','310']
])}
<p>(Illustrative numbers.) The length increase is already a clue: a fine-tune that learned verbosity can win a judge-scored benchmark (verbosity bias) and annoy users on mobile.</p>
<h4>Step 3 — Segment and diagnose</h4>
<ul><li>By slice: is it all traffic or Arabic, refunds, long conversations?</li>
<li>By version components: did the tokenizer/chat template change with the fine-tune?</li>
<li>By prompt length: did the fine-tune data use short contexts so long RAG contexts degrade?</li>
<li>Benchmark validity: does the benchmark resemble production intents? Is the judge biased?</li></ul>
<h4>Step 4 — Fix</h4>
<ul><li>Model: rebalance training data, add length control, re-tune.</li><li>Eval: add the complaint cases as a regression set; add a length/verbosity metric; calibrate the judge with humans.</li><li>Release: canary includes user-centric metrics (thumbs, handoff) and holds long enough to measure them.</li></ul>
<h4>Step 5 — Postmortem</h4>
<p>Blameless review: why did gates pass? Usually because the offline eval measured something different from what users value.</p>`,
  diagram:D('Offline vs online mismatch', {w:900,h:280,
   boxes:[
    {id:'b',x:20,y:40,w:200,h:56,label:'Benchmark ↑',sub:'judge-scored',cls:'ok'},
    {id:'u',x:20,y:180,w:200,h:56,label:'Complaints ↑',sub:'thumbs, handoff',cls:'bad'},
    {id:'r',x:290,y:110,w:150,h:56,label:'Roll back',sub:'traffic weight',cls:'warn'},
    {id:'s',x:500,y:110,w:160,h:56,label:'Segment + label',sub:'real conversations'},
    {id:'f',x:720,y:40,w:160,h:56,label:'Fix model'},
    {id:'e',x:720,y:180,w:160,h:56,label:'Fix eval',sub:'regression set',cls:'hl'}
   ],
   arrows:[{from:'b',to:'r'},{from:'u',to:'r'},{from:'r',to:'s'},{from:'s',to:'f'},{from:'s',to:'e'}]
  }, 'The disagreement itself is the bug report: the evaluation did not measure what users value.'),
  followups:[
    {q:'Management says the benchmark is industry standard, so keep the new model. Response?',a:'Show the user metrics and sampled conversations; explain that benchmarks measure general capability, not our task. Propose an A/B with the user outcome as primary metric. Decisions follow user impact.'},
    {q:'How could you have caught this before release?',a:'Golden set built from production traffic and slices, a verbosity metric, a canary that includes thumbs/handoff signals and runs long enough, and judge calibration against human preference.'},
    {q:'What if complaints are about a minority slice only (Arabic)?',a:'Route that slice to the old model (slice-based routing) while fixing, if the gateway can classify language reliably — and add a per-slice gate so a minority regression blocks future releases.'}
  ],
  tradeoffs:`<ul><li>Immediate rollback protects users but delays benefits for slices that improved; slice routing is a middle path with operational complexity.</li><li>User feedback is noisy and biased (unhappy users vote more); combine with expert labels.</li></ul>`,
  failures:`<ul><li>No way to roll back quickly → old version scaled down → keep warm during bake.</li><li>Cannot slice complaints → no version/language in logs → add trace attributes.</li><li>Fix ships and the problem returns → no regression case added.</li></ul>`,
  vocab:[
   {term:'offline/online gap',def:'Difference between evaluation results and real-world outcomes.'},
   {term:'verbosity bias',def:'Tendency of judges (and benchmarks) to reward longer answers.'},
   {term:'handoff rate',def:'Share of conversations escalated to a human agent; a strong task-failure proxy.'},
   {term:'blameless postmortem',def:'Review focused on system and process causes rather than individuals.'}
  ],
  mistakes:['Defending the benchmark instead of the users.','Retraining immediately without diagnosis.','Looking only at averages.','Fixing the model but not the evaluation.'],
  related:['v2-evaluation-monitoring','v1-finetuning','v2-model-cicd']
},
{
  id:'mlops-11', chapter:'v3-ch-mlops', difficulty:1,
  title:'What would you put on an LLMOps dashboard, and how do traces connect it to evaluation?',
  understand:'The interviewer checks if you can define user-centric, operational and economic metrics for an LLM service, and know how tracing ties a bad answer back to its cause.',
  short:'I organise the dashboard around three questions: are users getting good answers, is the service healthy, and what does it cost. Quality: judge pass rate on sampled traffic, thumbs-down and human handoff rates, refusal rate, all by slice and version. Health: request rate and success, time to first token and time per output token percentiles, queue depth, KV-cache usage and error rates per stage — gateway, retrieval, model, tools. Cost: input and output tokens, cache hit rates and cost per successful request. Underneath, every request is a trace — with MLflow Tracing, Langfuse or Phoenix over OpenTelemetry — carrying model, prompt and index versions, so a bad sampled answer opens straight into its retrieval results, prompt and timings, and can be saved as a new evaluation case.',
  detailed:`
<h4>Panels</h4>
${table(['Area','Metric','Source'],[
 ['Quality','Judge pass rate (sampled), thumbs-down, handoff, refusal, format errors — per slice/version','Eval jobs, app events'],
 ['Latency','TTFT p50/p95, TPOT p95, E2E p95','<code>vllm:time_to_first_token_seconds</code>, <code>vllm:inter_token_latency_seconds</code>, <code>vllm:e2e_request_latency_seconds</code>'],
 ['Saturation','Running/waiting requests, KV usage, queue time','<code>vllm:num_requests_running</code>, <code>vllm:num_requests_waiting</code>, <code>vllm:kv_cache_usage_perc</code>, <code>vllm:request_queue_time_seconds</code>'],
 ['Tokens','Prompt and generation tokens/s','<code>vllm:prompt_tokens_total</code>, <code>vllm:generation_tokens_total</code>'],
 ['Cache','Prefix cache hit ratio','<code>vllm:prefix_cache_hits</code> ÷ <code>vllm:prefix_cache_queries</code>'],
 ['Cost','$/1M tokens, $/successful request, by tenant','Gateway metering + GPU cost'],
 ['Dependencies','Retrieval latency/recall proxy, tool error rates','Traces']
])}
<h4>Cost per successful request</h4>
${formula(`
                         total serving cost in window
cost per success  =  ─────────────────────────────────────
                     requests that met SLO AND passed quality
illustrative: $1,200/day ÷ (500,000 × 0.93) = $1,200 ÷ 465,000 ≈ $0.0026
`)}
<h4>Tracing</h4>
<p>OpenTelemetry GenAI semantic conventions (still “Development” status, now maintained in a separate repo, as of Oct 2026) define spans like <code>chat {model}</code>, <code>execute_tool</code>, <code>retrieval</code> and attributes such as <code>gen_ai.request.model</code>, <code>gen_ai.usage.input_tokens</code>. Backends: MLflow Tracing (OTel-compatible), Langfuse (OTLP endpoint <code>/api/public/otel</code>), Arize Phoenix (OpenInference/OTel). Capture content only with explicit opt-in and redaction.</p>
<h4>The loop</h4>
<p>Sample → judge → low score opens the trace → engineer labels root cause → trace saved as eval case → next release gated on it.</p>`,
  diagram:D('From dashboard to trace to eval case', {w:900,h:270,
   boxes:[
    {id:'d',x:20,y:100,w:170,h:60,label:'Dashboard',sub:'quality, health, cost',cls:'hl'},
    {id:'s',x:240,y:100,w:150,h:60,label:'Low-score sample'},
    {id:'t',x:440,y:100,w:170,h:60,label:'Trace',sub:'prompt, chunks, timings'},
    {id:'c',x:660,y:30,w:200,h:56,label:'Root cause',sub:'retrieval / prompt / model'},
    {id:'e',x:660,y:170,w:200,h:56,label:'New eval case',cls:'ok'}
   ],
   arrows:[{from:'d',to:'s'},{from:'s',to:'t'},{from:'t',to:'c'},{from:'t',to:'e'}]
  }, 'Dashboards tell you that something is wrong; traces tell you why; eval cases stop it recurring.'),
  followups:[
    {q:'Why not just log every prompt and response?',a:'Privacy and cost: prompts contain personal data. Log metadata by default, capture content for a sampled, redacted, access-controlled subset with retention limits.'},
    {q:'Which single metric would you show an executive?',a:'Cost per successful request alongside success rate — it combines quality, reliability and efficiency.'},
    {q:'How do you alert on quality without paging on noise?',a:'Use a quality SLI (e.g. judged pass rate over daily samples) with burn-rate style alerting over longer windows, and ticket rather than page unless the drop is large and confirmed on a second window.'}
  ],
  tradeoffs:`<ul><li>High-cardinality labels (tenant, prompt version) make dashboards powerful but expensive in Prometheus/Mimir; put high-cardinality detail in traces.</li><li>Full content capture eases debugging but raises privacy risk.</li></ul>`,
  failures:`<ul><li>Average latency fine, users complain → percentiles and per-slice missing.</li><li>Cost spikes unexplained → no per-tenant token metering.</li><li>Traces lack versions → cannot correlate quality drop to a prompt change.</li></ul>`,
  vocab:[
   {term:'TTFT / TPOT',def:'Time to first token; time per output token after the first.'},
   {term:'cost per successful request',def:'Serving cost divided by requests that met SLO and quality criteria.'},
   {term:'OTel GenAI semconv',def:'OpenTelemetry semantic conventions for generative-AI spans and metrics (Development status).'},
   {term:'trace sampling',def:'Recording a subset of traces (or content) to control cost and privacy.'}
  ],
  mistakes:['One average latency chart.','Quality absent from the dashboard.','Logging raw prompts by default.','Counting all requests (including failed ones) in cost-per-request.'],
  related:['v2-ai-observability','v2-evaluation-monitoring','v2-finops-unit-economics']
}
]);
})();
