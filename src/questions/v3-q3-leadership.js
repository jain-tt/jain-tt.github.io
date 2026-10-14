/* Volume 3 · Part 2 · Chapter 15 — Questions: technical leadership (question bank) */
registerLesson({
  id:'v3-ch-leadership', vol:3, part:2, num:15,
  title:'Questions: technical leadership', minutes:120,
  summary:'Eleven leadership questions for senior AI platform roles: your first ninety days, build versus buy, disagreeing with researchers, leading an AI incident, hiring, roadmaps, driving adoption, presenting cost to executives, admitting what you have not run in production, balancing speed with governance, and telling your own story. Behavioural answers are given as structures and fill-in templates in square brackets, because your answer must be built from your real experience, never invented.',
  objectives:[
    'Answer behavioural questions with a clear structure (situation, decision, action, measurable result, learning) using only true experience.',
    'Present a credible 30/60/90-day plan for leading an AI platform team.',
    'Make and explain build-versus-buy and roadmap decisions with explicit criteria and exit plans.',
    'Lead an AI production incident and explain model-specific incident aspects.',
    'State the limits of your experience honestly and turn them into a concrete evaluation plan.'
  ],
  prereqs:['v3-how-to-interview','v2-platform-architecture'],
  next:['v3-mock-interviews','v3-system-design'],
  tags:['interview','leadership','behavioural','strategy'],
  html:`
<p>Leadership rounds for AI platform roles check two things at once: can you lead engineers and influence peers, and do you understand AI systems well enough that your decisions are sound. The answers below give you structures and templates. You fill in the facts.</p>

<h2>What interviewers test in this chapter</h2>
<ul>
<li><b>Judgement under uncertainty.</b> AI tooling changes monthly. They want to see criteria, reversible bets, pilots with exit conditions, and decisions written down.</li>
<li><b>Measurement.</b> Strong leaders talk in SLOs, cost per successful request, adoption and lead time, not adjectives.</li>
<li><b>Collaboration across disciplines.</b> Researchers, data scientists, product, security, finance. Can you disagree with evidence and still keep trust?</li>
<li><b>Honesty about experience.</b> A DevOps leader moving into AI platform work will meet questions about things they have not operated. Saying so, precisely, and showing how you would close the gap is a strength. Bluffing is the fastest way to fail a senior loop.</li>
<li><b>Ownership.</b> Incidents, budgets and roadmaps: who decided, who was accountable, what changed afterwards.</li>
</ul>

<h2>The mental model: a structure for every behavioural answer</h2>
${fig('Structured behavioural answer (STAR + L)', svgDiagram({w:900,h:260,
  boxes:[
    {id:'s',x:20,y:100,w:140,h:60,label:'Situation',sub:'1–2 sentences'},
    {id:'t',x:190,y:100,w:140,h:60,label:'Task',sub:'your responsibility'},
    {id:'a',x:360,y:100,w:160,h:60,label:'Action',sub:'what YOU did, why',cls:'hl'},
    {id:'r',x:550,y:100,w:150,h:60,label:'Result',sub:'measured, honest'},
    {id:'l',x:730,y:100,w:150,h:60,label:'Learning',sub:'what changed',cls:'ok'}
  ],
  arrows:[{from:'s',to:'t'},{from:'t',to:'a'},{from:'a',to:'r'},{from:'r',to:'l'}],
  notes:[{x:20,y:210,text:'Spend ~60% of the time on Action. Use "I" for your decisions and "we" for team work. Numbers only if real.'}]
}), 'Most weak behavioural answers spend all their time on the situation and never say what the candidate personally decided.')}
<h3>How to use the bracketed templates</h3>
<p>Templates look like this: "[At &lt;company&gt;, I led &lt;n&gt; engineers running &lt;system&gt;; p95 latency was &lt;x&gt;]". Replace every bracket with a true fact from your career, or remove the sentence. If you have no AI production example, use your strongest DevOps or platform example and draw the bridge explicitly ("the same pattern applies to GPU inference because…"), then mention what you have demonstrated in a lab. Never convert a lab result into a production claim.</p>

<h2>Weak answer vs strong answer</h2>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"In my first 90 days I would migrate everything to Kubernetes and introduce a new serving framework."</p><p>Re-platforming before understanding the workloads, owners and risks is the most common leadership mistake.</p></div><div class="good"><h4>Strong answer</h4><p>"First 30 days I listen and inventory: workloads, owners, SLOs, spend, security gaps. By day 60 I have baselines and one narrow, visible improvement under way. By day 90 there is a roadmap agreed with stakeholders, built from those baselines, with a few measurable goals."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Yes, I have deep experience with vLLM at scale."</p><p>(When the truth is a lab.)</p></div><div class="good"><h4>Strong answer</h4><p>"I have run vLLM in a lab, measured TTFT and TPOT under load, and deployed it on Kubernetes with probes and autoscaling. I have not operated it at production scale. Here is what I would measure in the first two weeks and the risks I would watch."</p></div></div>

<h2>How to practise this chapter</h2>
<ul>
<li>Write 6–8 true stories from your career in STAR + L form: an incident, a disagreement, a cost saving, a migration, a hire, a failure. Each should be tellable in 2 minutes.</li>
<li>Map each story to several questions here; one good story answers three questions.</li>
<li>Practise the honesty template (Q9) until it sounds natural.</li>
<li>Pair this chapter with ${L('v3-how-to-interview','how to interview as a DevOps-to-AI engineer')} and ${L('v3-mock-interviews','the mock interviews')}.</li>
</ul>

<div class="connections"><h4>How this connects</h4>
${chain(['Inventory','Baselines','One visible win','Roadmap','Adoption','Executive reporting'])}
${chain(['Incident','Mitigation','Postmortem','Guardrail','Platform default'])}
<p>Leadership answers reuse the technical chapters: ${L('v3-ch-finops','FinOps')} for cost conversations, ${L('v3-ch-security','security and governance')} for risk tiers, ${L('v3-ch-aiops','AIOps and incidents')} for incident leadership.</p></div>
`,
  quiz:[
    {q:'Which first-30-days activity is most valuable for a new AI platform lead?',options:['Choose a new inference engine','Inventory workloads, owners, SLOs, spend and risks, and listen to stakeholders','Reorganise the team','Announce a migration to a new cloud'],answer:1,explain:'Decisions without baselines and context are guesses. Listening and inventory create the baselines the roadmap needs and build trust.'},
    {q:'In a STAR answer, where should most of the time go?',options:['Situation','Task','Action: what you decided and did, and why','Thanking the team'],answer:2,explain:'Interviewers assess your decisions. Keep situation and task short; explain your actions and reasoning; finish with measured results and learning.'},
    {q:'You are asked about a system you have only used in a lab. Best response?',options:['Claim production experience to stay competitive','Say you do not know it','State exactly what you have done (lab), what you have not (production scale), and how you would evaluate it quickly','Change the subject'],answer:2,explain:'Precise boundaries plus a concrete plan show seniority and integrity. Bluffing is usually exposed by follow-ups.'},
    {q:'During an AI incident, what comes before root-cause analysis?',options:['Writing the postmortem','Mitigation: restore service or safety (rollback, fallback model, disable a tool)','Hiring an expert','Retraining the model'],answer:1,explain:'Mitigate first, investigate after. Model and prompt rollbacks, fallbacks and kill switches exist for this.'}
  ],
  flashcards:[
    {front:'STAR + L',back:'Situation, Task, Action (most time), Result (measured, honest), Learning (what changed).'},
    {front:'30/60/90 for an AI platform lead',back:'30: listen, inventory, baselines. 60: one narrow visible win, quick risk fixes. 90: roadmap with measurable goals agreed with stakeholders.'},
    {front:'Honesty template',back:'"I have done X (lab/production). I have not done Y at scale. Here is how I would close the gap in two weeks, and the risks I would watch."'},
    {front:'Build vs buy criteria',back:'Differentiation, total cost incl. people, time to value, control/residency, vendor risk, team capability, reversibility. Pilot with exit criteria.'},
    {front:'AI incident specifics',back:'Quality and safety incidents (not just outages); rollbacks of prompts, models and retrieval indexes; kill switches for tools; evaluation before re-enable.'},
    {front:'Platform adoption metrics',back:'Share of AI traffic through the paved road, time to first deployment, number of teams onboarded, satisfaction, incidents avoided.'},
    {front:'Three business measures for executives',back:'Successful outcomes, response time/availability, cost per successful outcome.'}
  ]
});

registerQuestions([
{
  id:'v3lead-01', chapter:'v3-ch-leadership', difficulty:2,
  title:'What would you do in your first 90 days as an AI platform lead?',
  understand:`They test whether you build understanding and trust before changing things, and whether you can turn that into measurable direction quickly. Simple explanation: spend the first month learning the systems, people and numbers, the second month fixing something visible and urgent, and the third month agreeing a roadmap with clear goals.`,
  short:`I'd split it into three phases. In the first thirty days, I listen and inventory: one-to-ones with the team and with key customers of the platform, such as product teams, data science, security and finance; and a written inventory of AI workloads, models, owners, SLOs, GPU and API spend, security controls and incidents. In days thirty to sixty I establish baselines, like p95 latency, availability, cost per successful request and deployment lead time, close any urgent risk I found, for example an exposed endpoint or no rollback path, and pick one narrow, visible improvement the team can deliver, such as cutting idle GPU spend or adding a paved-road deployment for one model. By day ninety I present a roadmap agreed with stakeholders: a few measurable goals, what we will stop doing, and how we'll report progress. What I avoid is announcing a re-platform in week two.`,
  detailed:`
<h5>Days 1–30: listen and inventory</h5>
<ul>
<li>One-to-ones with every engineer: what works, what hurts, what they would change, career goals.</li>
<li>Stakeholder interviews: product teams using AI, data science/ML, security, privacy/legal, finance, SRE. Ask "what would make the platform indispensable to you?"</li>
<li>Inventory document: workloads, models and versions, serving stack, GPU pools, API providers, owners, SLOs (or their absence), spend by line, data classes, security controls, incident history, on-call.</li>
<li>Read the last six months of postmortems and the backlog.</li>
</ul>
<h5>Days 31–60: baselines, risk fixes, one win</h5>
${table(['Baseline','Why'],[
  ['p95 TTFT / TPOT and availability per model endpoint','Reliability starting point'],
  ['Cost per successful request; idle GPU-hours','FinOps starting point'],
  ['Lead time from model approval to production','Platform effectiveness'],
  ['Share of AI traffic through the gateway','Governance coverage'],
  ['Open high-severity security findings','Risk']
])}
<p>Fix urgent risks immediately (no rollback path, public endpoints, secrets in prompts). Choose one win that is visible, measurable and low-risk, delivered by the team, credited to the team.</p>
<h5>Days 61–90: roadmap and operating rhythm</h5>
<ul>
<li>Roadmap: 3–5 outcomes for the next two quarters with metrics (for example "70% of AI traffic via the gateway", "cost per successful request −20% with no SLO regression").</li>
<li>Explicit "stop doing" list.</li>
<li>Operating rhythm: weekly ops review, monthly cost review, quarterly roadmap review, incident and release review cadence.</li>
<li>Team: role clarity, skill gaps, hiring plan.</li>
</ul>
<h5>Template for the interview</h5>
<p>"[In my previous role at &lt;company&gt;, when I took over &lt;team/platform&gt;, I started by &lt;listening/inventory action&gt;. That showed &lt;finding&gt;. Our first win was &lt;win&gt;, which &lt;measured result&gt;.] For an AI platform I would follow the same pattern, adding AI-specific baselines such as cost per successful request and evaluation coverage."</p>
<p>(Audit note: the original course answered this for 30 days; 90 days is the more common framing for leads and lets you show roadmap thinking.)</p>`,
  diagram:fig('30 / 60 / 90', svgDiagram({w:900,h:260,
    boxes:[
      {id:'a',x:20,y:90,w:260,h:80,label:'Days 1–30',sub:'listen, inventory, trust'},
      {id:'b',x:320,y:90,w:260,h:80,label:'Days 31–60',sub:'baselines, risk fixes, 1 win',cls:'hl'},
      {id:'c',x:620,y:90,w:260,h:80,label:'Days 61–90',sub:'roadmap, metrics, rhythm',cls:'ok'}
    ],
    arrows:[{from:'a',to:'b'},{from:'b',to:'c'}]
  }), 'Understand before changing; deliver something small and real before announcing something big.'),
  followups:[
    {q:'What if you find a critical security risk in week one?',a:'Fix it immediately: listening does not mean ignoring urgent risk. Contain, inform stakeholders, and use it as an early example of how the team handles risk.'},
    {q:'How do you pick the first win?',a:'High visibility to platform users, measurable, deliverable in weeks, low risk, and owned by the team; for example removing idle GPU spend or a self-service deployment template for one model.'},
    {q:'How do you handle inherited technical debt the team loves?',a:'Understand why it exists, measure its cost, and decide jointly with the team; keep what works, schedule what does not, and never mock past decisions made with less information.'}
  ],
  tradeoffs:`
<p><b>Moving fast</b> shows energy but risks wrong changes and lost trust; <b>moving slowly</b> risks looking passive. The phased plan balances them: urgent risk fixes immediately, one quick win, bigger changes only after baselines.</p>
<p><b>Operational considerations:</b> keep the inventory as a living document; publish baselines on a dashboard so progress is visible.</p>`,
  failures:`
<ul>
<li><b>Re-platform announced in week two</b>; team morale and stakeholder trust drop when the reasons are not understood. Fix: baselines first.</li>
<li><b>Only talking to the team</b>, not platform customers; roadmap misses what users need. Fix: stakeholder interviews.</li>
<li><b>Roadmap without metrics</b>; progress cannot be shown. Fix: measurable outcomes.</li>
</ul>`,
  vocab:[
    {term:'Inventory',def:'Written map of systems, owners, SLOs, spend and risks.'},
    {term:'Baseline',def:'Measured starting point for metrics you intend to improve.'},
    {term:'Quick win',def:'Small, visible, measurable improvement delivered early.'},
    {term:'Operating rhythm',def:'Recurring reviews (ops, cost, roadmap, incidents) that run the team.'}
  ],
  mistakes:[
    'Promising a big re-platform before understanding workloads.',
    'No measurable baselines.',
    'Taking credit for the team\'s first win.',
    'Ignoring security or reliability risks while "listening".'
  ],
  related:['v3-how-to-interview','v2-platform-architecture']
},
{
  id:'v3lead-02', chapter:'v3-ch-leadership', difficulty:3,
  title:'How do you make a build vs buy decision for an AI capability?',
  understand:`They test structured decision-making: criteria beyond price, total cost of ownership, reversibility and an exit plan. Simple explanation: decide whether to build something yourself, buy a product or use a managed service by comparing how much it differentiates you, what it really costs to run, how fast you need it, how much control you need, and how easy it is to change your mind.`,
  short:`I start with whether the capability differentiates us. If it's commodity, like a vector database, an LLM gateway or observability, I lean to buy or adopt open source, and spend our engineers on what's unique to our business, like domain evaluation and travel-specific tools. Then I compare options on explicit criteria: total cost of ownership including the people to run it, time to value, control over data and residency, which matters a lot for personal data in Saudi Arabia, vendor and lock-in risk, integration with our identity and observability, and team capability. I score the shortlisted options, run a time-boxed pilot on our real workload with pass/fail criteria agreed in advance, and write a decision record that includes an exit plan, meaning how we'd leave if the vendor or the economics change. For AI specifically I keep interfaces standard, like an OpenAI-compatible API, MCP for tools and OpenTelemetry for traces, so the decision stays reversible.`,
  detailed:`
<h5>Decision criteria</h5>
${table(['Criterion','Questions'],[
  ['Differentiation','Does doing this better than competitors matter to customers?'],
  ['Total cost of ownership','Licences/usage + infrastructure + people + on-call + upgrades + exit cost'],
  ['Time to value','When do we need it? What does delay cost?'],
  ['Control and residency','Where is data processed? Can we meet PDPL and customer contracts?'],
  ['Vendor risk','Financial stability, roadmap fit, lock-in, pricing changes'],
  ['Integration','SSO, network, observability, policy engine, gateway'],
  ['Team capability','Can we run it well? Hiring market?'],
  ['Reversibility','Standard interfaces? Data export? Migration effort?']
])}
<h5>Weighted scoring (ILLUSTRATIVE)</h5>
${formula(`
Weights: differentiation 0.15, TCO 0.25, time 0.15, residency 0.20,
         vendor risk 0.10, reversibility 0.15         (sum = 1.00)

Option A (managed vector DB, global region): scores 2, 4, 5, 1, 3, 3
  0.15×2 + 0.25×4 + 0.15×5 + 0.20×1 + 0.10×3 + 0.15×3
  = 0.30 + 1.00 + 0.75 + 0.20 + 0.30 + 0.45 = 3.00
Option B (self-hosted open source, in-region):  scores 3, 3, 3, 5, 4, 4
  0.45 + 0.75 + 0.45 + 1.00 + 0.40 + 0.60 = 3.65
ANSWER  B ranks higher here because residency carries a 0.20 weight;
        a hard requirement should be a filter, not just a weight
`)}
<p>Scoring structures the conversation; it does not replace judgement. Hard constraints (residency, security) filter options before scoring.</p>
<h5>Pilot</h5>
<ul>
<li>Time-boxed (2–6 weeks), real workload or realistic replay, success criteria agreed beforehand (latency, recall, cost, operational effort).</li>
<li>Include failure tests (node loss, upgrade) and a cost model at expected scale.</li>
<li>Decision record (ADR): options, criteria, evidence, decision, owner, review date, exit plan.</li>
</ul>
<h5>Template</h5>
<p>"[At &lt;company&gt;, we had to choose between &lt;option A&gt; and &lt;option B&gt; for &lt;capability&gt;. I set criteria with &lt;stakeholders&gt;, ran a &lt;n&gt;-week pilot, and chose &lt;option&gt; because &lt;evidence&gt;. The exit plan was &lt;plan&gt;. In hindsight &lt;learning&gt;.]" If you have not made an AI-specific build/buy call, use an infrastructure one (CI/CD, observability, Kubernetes distribution) and bridge to AI.</p>`,
  diagram:fig('Build vs buy flow', svgDiagram({w:900,h:300,
    boxes:[
      {id:'d',x:20,y:120,w:150,h:56,label:'Differentiating?'},
      {id:'f',x:220,y:120,w:160,h:56,label:'Hard constraints',sub:'residency, security',cls:'warn'},
      {id:'s',x:430,y:120,w:150,h:56,label:'Score options',sub:'TCO, time, risk'},
      {id:'p',x:630,y:120,w:120,h:56,label:'Pilot',sub:'pass/fail',cls:'hl'},
      {id:'r',x:780,y:120,w:100,h:56,label:'ADR',sub:'+ exit plan',cls:'ok'}
    ],
    arrows:[{from:'d',to:'f'},{from:'f',to:'s'},{from:'s',to:'p'},{from:'p',to:'r'}]
  }), 'Constraints filter, criteria rank, the pilot proves, the decision record remembers.'),
  followups:[
    {q:'Engineers want to build; it is clearly commodity. How do you handle it?',a:'Acknowledge the learning value, show TCO including on-call and upgrades, and redirect the energy to differentiating work; possibly allow building a thin integration layer rather than the whole system.'},
    {q:'How do you calculate TCO for "build"?',a:'Engineer-months to build, ongoing maintenance share, on-call, infrastructure, security reviews, upgrades and opportunity cost of not building something else.'},
    {q:'What makes a decision reversible?',a:'Standard interfaces, data portability, avoiding proprietary extensions in core paths, and a tested migration path for critical data.'}
  ],
  tradeoffs:`
<p><b>Buy</b>: speed and less operations, but vendor risk and less control. <b>Build</b>: control and fit, but people cost and slower delivery. <b>Open source self-hosted</b>: control without licence cost, but you own operations and security patches.</p>
<p><b>Operational considerations:</b> revisit decisions on a schedule (AI vendors and prices change quickly); track exit cost as a risk.</p>`,
  failures:`
<ul>
<li><b>Vendor price increase</b> doubles cost and there is no exit plan. Fix: exit plan and standard interfaces from the start.</li>
<li><b>Built in-house, then the maintainer leaves</b>. Fix: bus factor in TCO; documentation; prefer common open source.</li>
<li><b>Pilot on toy data</b> passes; production fails. Fix: realistic workloads and failure tests in the pilot.</li>
</ul>`,
  vocab:[
    {term:'TCO',def:'Total cost of ownership including people, operations and exit costs.'},
    {term:'ADR',def:'Architecture decision record: context, options, decision, consequences.'},
    {term:'Exit plan',def:'Documented way to leave a vendor or technology if needed.'},
    {term:'Differentiation',def:'Capability that gives competitive advantage and justifies building.'}
  ],
  mistakes:[
    'Comparing licence price only.',
    'No pilot or pilot without pre-agreed criteria.',
    'Treating residency as a weight when it is a hard requirement.',
    'No exit plan for fast-moving AI vendors.'
  ],
  related:['v2-finops-optimization','v2-landscape']
},
{
  id:'v3lead-03', chapter:'v3-ch-leadership', difficulty:2,
  title:'Tell me about a disagreement with ML researchers or data scientists. How did you resolve it?',
  understand:`Behavioural question testing collaboration across disciplines: do you use evidence, respect expertise, and reach a decision without "infra says no"? Simple explanation: tell a true story where you and a researcher wanted different things, show how you found shared goals, tested options with data, and decided together.`,
  short:`I'd tell a true story using a clear structure. The situation is usually a tension like this: a research team wanted to ship a larger model or a long context window, and my concern was latency, GPU capacity or cost. What I try to show is that I started from the shared goal, the user outcome, and made the trade-off measurable instead of arguing positions. For example, we agreed a quality bar on their evaluation set and a latency and cost bar from the platform side, then tested options: quantization, a smaller distilled model, batching changes, or routing only hard requests to the large model. The data decided, and we wrote it down in a decision record. The result should be measured and honest, and the learning is usually about agreeing success criteria earlier. [Here I'd insert my real example: the people, the numbers and what I personally did.]`,
  detailed:`
<h5>Structure (STAR + L)</h5>
<ol>
<li><b>Situation</b> (15 s): who, what was being decided, why it mattered.</li>
<li><b>Task</b> (10 s): your responsibility (platform reliability, cost, delivery).</li>
<li><b>Action</b> (60–75 s): how you understood their goal, which shared criteria you proposed, which experiments you ran together, how the decision was made and recorded.</li>
<li><b>Result</b> (15 s): measured outcome and the relationship afterwards.</li>
<li><b>Learning</b> (10 s): what you now do earlier.</li>
</ol>
<h5>Fill-in template</h5>
<p>"[At &lt;company&gt;, the &lt;research/data science&gt; team wanted to &lt;deploy model X / increase context to N tokens / retrain weekly&gt;. My concern as &lt;role&gt; was &lt;p95 latency would exceed the SLO / GPU cost would rise by about &lt;n&gt;% / no rollback path&gt;. I set up a session with &lt;lead researcher&gt; to agree what success meant: &lt;quality metric and threshold&gt; from their side, &lt;latency/cost threshold&gt; from mine. We tested &lt;options: quantization, smaller model, routing, batching&gt; on &lt;dataset/traffic replay&gt;. The data showed &lt;finding&gt;. We chose &lt;decision&gt;, recorded in an ADR. Result: &lt;measured outcome&gt;. I learned to &lt;agree evaluation and SLO criteria at project start&gt;.]"</p>
<h5>If you have no ML-specific story</h5>
<p>Use a disagreement with developers or architects about a deployment risk, and bridge: "The same approach works with researchers: shared metric, experiments, written decision." Do not invent an ML story.</p>
<h5>Signals interviewers look for</h5>
<ul>
<li>You understood and stated the other side's goal fairly.</li>
<li>You turned opinions into measurable criteria.</li>
<li>You offered alternatives, not just objections.</li>
<li>You disagreed and committed, or escalated cleanly with data when needed.</li>
<li>The working relationship survived.</li>
</ul>
<h5>Technical options worth knowing for these stories</h5>
<p>Quantization (FP8/INT8/4-bit), distillation to a smaller model, speculative decoding, prefix caching, routing hard requests to the large model, context-length limits, batch or offline processing for non-interactive work, canary release with automated evaluation.</p>`,
  diagram:fig('From positions to evidence', svgDiagram({w:900,h:260,
    boxes:[
      {id:'r',x:20,y:40,w:180,h:56,label:'Research goal',sub:'quality'},
      {id:'p',x:20,y:160,w:180,h:56,label:'Platform goal',sub:'latency, cost, risk'},
      {id:'c',x:260,y:100,w:180,h:56,label:'Shared criteria',sub:'agreed thresholds',cls:'hl'},
      {id:'e',x:500,y:100,w:160,h:56,label:'Experiments',sub:'options tested'},
      {id:'d',x:720,y:100,w:160,h:56,label:'Decision record',cls:'ok'}
    ],
    arrows:[{from:'r',to:'c'},{from:'p',to:'c'},{from:'c',to:'e'},{from:'e',to:'d'}]
  }), 'The disagreement ends when both sides accept the same measurement.'),
  followups:[
    {q:'What if the data supported the researchers and not you?',a:'Then I would say so and support their decision, adjusting capacity or cost plans. Being wrong with data is fine; ignoring data is not.'},
    {q:'What if you could not agree even with data?',a:'Escalate together to the decision owner with a one-page summary of options, evidence and trade-offs, then commit to the decision.'},
    {q:'How do you prevent the same disagreement next time?',a:'Agree evaluation and SLO criteria at project start, include platform engineers in model design reviews, and publish platform constraints (latency budgets, GPU types) early.'}
  ],
  tradeoffs:`
<p><b>Holding the line on SLOs</b> protects users but can block valuable improvements; <b>giving way</b> keeps relationships but may create incidents. Evidence and shared criteria let you avoid both extremes.</p>
<p><b>Operational considerations:</b> joint review forums, shared evaluation dashboards, platform constraints documented in the model onboarding guide.</p>`,
  failures:`
<ul>
<li><b>Story where you were simply right and they were wrong</b>: signals poor collaboration. Fix: show their perspective and joint work.</li>
<li><b>Story with no measurable outcome</b>. Fix: include real numbers, or say honestly what was observed.</li>
<li><b>Invented details</b> exposed by follow-up questions. Fix: only true stories.</li>
</ul>`,
  vocab:[
    {term:'Disagree and commit',def:'Voicing disagreement, then fully supporting the decision once made.'},
    {term:'Shared success criteria',def:'Thresholds both sides agree define a good outcome.'},
    {term:'Decision record',def:'Written record of options, evidence and decision.'},
    {term:'Distillation',def:'Training a smaller model to imitate a larger one.'}
  ],
  mistakes:[
    'Framing researchers as the problem.',
    'Arguing opinions without data.',
    'No personal action ("we decided…" throughout).',
    'Fabricating an ML story.'
  ],
  related:['v3-how-to-interview','v1-quantization-speculative']
},
{
  id:'v3lead-04', chapter:'v3-ch-leadership', difficulty:3,
  title:'How do you lead an AI production incident?',
  understand:`They test incident command skills and whether you know what is different about AI incidents (quality and safety failures, prompt and model rollbacks, tool kill switches). Simple explanation: during an incident, someone must coordinate, communicate and get service back quickly; for AI systems, "broken" can also mean giving wrong or harmful answers, so you need ways to roll back models, prompts and data, and to switch off risky tools.`,
  short:`I run it like any serious incident, with a few AI-specific additions. Roles first: an incident commander who coordinates and doesn't debug, an operations lead, a communications lead, and a scribe. Mitigation before root cause: restore service or safety as fast as possible. For AI that toolkit includes rolling back a model, a prompt or a retrieval index version, switching to a fallback model, disabling an agent's write tools with a kill switch, tightening rate limits, or turning a feature off. Communication on a fixed cadence to stakeholders, with customer impact in plain words. AI incidents aren't only outages: a quality or safety incident, like wrong refund amounts or a data leak in answers, is handled with the same seriousness, plus privacy and legal involvement when personal data is involved. Afterwards a blameless postmortem with timeline, contributing factors and actions, which often become platform defaults, such as an evaluation gate or a new alert. [My example would go here.]`,
  detailed:`
<h5>Roles</h5>
${table(['Role','Does','Does not'],[
  ['Incident commander','Coordinates, decides priorities, sets cadence','Debug'],
  ['Ops / technical lead','Drives diagnosis and mitigation','Handle comms'],
  ['Comms lead','Updates stakeholders and status page on a schedule','Speculate on cause'],
  ['Scribe','Timeline, decisions, actions','—'],
  ['Subject experts','ML, data, security, privacy as needed','—']
])}
<h5>AI-specific incident types</h5>
${table(['Type','Example','Mitigation levers'],[
  ['Availability/latency','GPU pool exhausted; TTFT p95 10×','Admission control, fallback model/region, shed low-priority traffic'],
  ['Quality regression','New prompt version gives wrong policy answers','Roll back prompt/model/index version; route to previous version'],
  ['Safety/security','Prompt injection makes agent issue refunds; PII in answers','Kill switch for tools; disable feature; preserve logs; involve security/privacy'],
  ['Cost','Agent loop burns budget overnight','Budgets, rate limits, disable agent'],
  ['Dependency','Provider API outage','Failover to another provider/self-hosted model if validated']
])}
<h5>Timeline pattern</h5>
<ol>
<li>Detect (alert, user report), declare, assign IC.</li>
<li>Assess impact: users, tenants, data, money; severity.</li>
<li>Mitigate: the fastest safe lever. Prefer reversible actions.</li>
<li>Communicate every 30 minutes (or agreed cadence) even if nothing changed.</li>
<li>Verify recovery with metrics and, for quality incidents, with an evaluation run.</li>
<li>Postmortem within days: blameless, contributing factors, actions with owners.</li>
</ol>
<h5>Template</h5>
<p>"[At &lt;company&gt;, &lt;service&gt; had &lt;impact&gt;. I acted as &lt;incident commander/tech lead&gt;. We mitigated by &lt;action&gt; within &lt;time&gt;. Root cause was &lt;cause&gt;. Afterwards I drove &lt;actions&gt;, which &lt;measured effect&gt;.]" If your incidents are non-AI, tell the best one and add: "For AI systems I would add model/prompt rollback, evaluation-gated recovery and tool kill switches", which you have practised in the labs and lessons of this course.</p>`,
  diagram:fig('AI incident flow', svgDiagram({w:900,h:280,
    boxes:[
      {id:'d',x:20,y:110,w:120,h:56,label:'Detect',sub:'alert / report'},
      {id:'i',x:170,y:110,w:120,h:56,label:'Declare + IC'},
      {id:'m',x:320,y:110,w:180,h:56,label:'Mitigate',sub:'rollback, fallback, kill',cls:'hl'},
      {id:'v',x:530,y:110,w:150,h:56,label:'Verify',sub:'metrics + eval'},
      {id:'p',x:710,y:110,w:170,h:56,label:'Postmortem',sub:'actions → defaults',cls:'ok'},
      {id:'c',x:320,y:210,w:180,h:50,label:'Comms cadence'}
    ],
    arrows:[{from:'d',to:'i'},{from:'i',to:'m'},{from:'m',to:'v'},{from:'v',to:'p'},{from:'i',to:'c',cls:'dash'}]
  }), 'Quality incidents need evaluation, not just green dashboards, before you declare recovery.'),
  followups:[
    {q:'How do you know a quality incident is over?',a:'Run the regression evaluation set (plus the failing examples) against the mitigated system and check production quality signals; latency graphs alone cannot show it.'},
    {q:'What preparation makes AI incidents shorter?',a:'Versioned prompts, models and indexes with one-click rollback, validated fallback models, tool kill switches, runbooks, and game days that practise them.'},
    {q:'When do you involve legal or privacy?',a:'Immediately when personal data may have been exposed or regulated decisions affected; notification obligations can have deadlines.'}
  ],
  tradeoffs:`
<p><b>Fast mitigation</b> (disable feature) protects users but hurts the product; <b>targeted fixes</b> keep functionality but take longer. Decide by severity and reversibility. <b>Fallback models</b> keep service but may lower quality; only use validated ones.</p>
<p><b>Operational considerations:</b> severity definitions that include quality and safety, runbooks per AI service, game days, postmortem tracking until actions close.</p>`,
  failures:`
<ul>
<li><b>IC debugging</b>, nobody coordinating. Fix: role discipline.</li>
<li><b>Recovery declared on latency metrics</b> while answers were still wrong. Fix: evaluation-based verification.</li>
<li><b>Logs purged during incident</b>, losing evidence. Fix: preserve evidence for security incidents.</li>
</ul>`,
  vocab:[
    {term:'Incident commander',def:'Person coordinating the response, not debugging.'},
    {term:'Mitigation',def:'Action that reduces impact before root cause is fixed.'},
    {term:'Kill switch',def:'Mechanism to disable a feature or tool immediately.'},
    {term:'Blameless postmortem',def:'Review focused on systems and contributing factors rather than individuals.'}
  ],
  mistakes:[
    'Hunting root cause before mitigating.',
    'Treating wrong answers as "not an incident".',
    'No communication cadence.',
    'Postmortem actions with no owners or dates.'
  ],
  related:['v2-aiops','v2-model-cicd','v3-prove-incident']
},
{
  id:'v3lead-05', chapter:'v3-ch-leadership', difficulty:2,
  title:'How do you hire and grow an AI platform team?',
  understand:`They test whether you know which skills an AI platform team needs, how to assess them fairly, and how to develop existing engineers, especially DevOps and SRE engineers moving into AI. Simple explanation: decide what mix of skills the platform needs, hire for fundamentals and learning ability, test with realistic exercises, and give current engineers a structured path to learn the AI parts.`,
  short:`I start from the platform's responsibilities and build a skill matrix: infrastructure and Kubernetes, GPU and inference serving, ML systems and evaluation, data and retrieval, security and identity, observability and SRE, and developer experience. Few people are strong in all of them, so I hire for strong fundamentals in one or two plus curiosity across the rest, and make sure the team as a whole covers the matrix. Interviews use realistic exercises, such as debugging a slow inference service or designing a secure tool integration, with a written rubric, so we compare candidates on the same signals. For growth, I run a structured path for existing DevOps and SRE engineers: model and inference fundamentals, hands-on labs with vLLM and an MCP server, rotations with the ML team, and ownership of a real component with mentoring. I'm explicit about career levels so people see how AI platform skills are rewarded.`,
  detailed:`
<h5>Skill matrix (example)</h5>
${table(['Area','Core skills','Signal in interviews'],[
  ['Kubernetes and infra','Scheduling, networking, IaC, GitOps','Design and debug exercises'],
  ['GPU and inference','GPU memory, batching, KV cache, engines, benchmarking','Explain TTFT/TPOT trade-offs; size a deployment'],
  ['ML systems and evaluation','Model lifecycle, eval design, drift','Design an evaluation gate'],
  ['Data and retrieval','Pipelines, vector search, ACLs','RAG design with access control'],
  ['Security and identity','OAuth, policy engines, threat modelling','Secure an MCP server / agent'],
  ['Observability and SRE','SLOs, tracing, incident response','Incident scenario'],
  ['Developer experience','APIs, docs, golden paths','Product thinking about internal users']
])}
<h5>Hiring process</h5>
<ul>
<li>Role scorecards before sourcing: outcomes for the first year, must-have and nice-to-have skills.</li>
<li>Structured interviews with rubrics; at least one realistic hands-on exercise; a system design with AI-specific constraints; a behavioural interview.</li>
<li>Calibrate interviewers; debrief with evidence, not impressions.</li>
<li>Hire for learning ability: the tooling changes yearly.</li>
</ul>
<h5>Growing existing engineers (DevOps → AI platform)</h5>
${table(['Stage','Content','Output'],[
  ['Weeks 1–4','Model basics, inference anatomy, GPU memory, tokens and cost','Explain a request end to end'],
  ['Weeks 5–8','Labs: serve a model with vLLM, benchmark, deploy on K8s; build an MCP server','Working lab, written findings'],
  ['Weeks 9–12','Rotation with ML team; own a small production component with a mentor','Shipped change, runbook'],
  ['Ongoing','On-call for AI services, postmortems, reading group','Operational depth']
])}
<h5>Template</h5>
<p>"[At &lt;company&gt;, I built/grew a team of &lt;n&gt;. I introduced &lt;structured interviews / skill matrix / learning path&gt;. Result: &lt;time to hire, retention, promotions, capability delivered&gt;.]"</p>`,
  diagram:fig('Team coverage, not unicorns', svgDiagram({w:900,h:280,
    boxes:[
      {id:'a',x:20,y:40,w:200,h:50,label:'K8s + infra'},
      {id:'b',x:20,y:120,w:200,h:50,label:'GPU + inference',cls:'hl'},
      {id:'c',x:20,y:200,w:200,h:50,label:'ML systems + eval'},
      {id:'d',x:350,y:40,w:200,h:50,label:'Data + retrieval'},
      {id:'e',x:350,y:120,w:200,h:50,label:'Security + identity'},
      {id:'f',x:350,y:200,w:200,h:50,label:'SRE + observability'},
      {id:'t',x:680,y:110,w:200,h:70,label:'Team',sub:'covers the matrix',cls:'ok'}
    ],
    arrows:[{from:'a',to:'t'},{from:'b',to:'t'},{from:'c',to:'t'},{from:'d',to:'t'},{from:'e',to:'t'},{from:'f',to:'t'}]
  }), 'Hire T-shaped people so the team, not each individual, covers every area.'),
  followups:[
    {q:'Would you hire an ML researcher onto the platform team?',a:'Possibly one ML engineer with systems interest to bridge to research and own evaluation tooling; the platform team mostly needs systems engineers who understand ML workloads.'},
    {q:'How do you keep skills current?',a:'Time for learning, internal demos, rotating ownership of new technology evaluations, and postmortem-driven training.'},
    {q:'How do you assess AI knowledge without trivia?',a:'Scenario questions where knowledge shows in reasoning: why is TTFT rising while GPU utilisation is flat? How would you secure a tool that can change infrastructure?'}
  ],
  tradeoffs:`
<p><b>Hiring experienced AI infra engineers</b> is fast but expensive and competitive; <b>growing DevOps engineers</b> is slower but builds loyalty and keeps operational strength. Most teams need both.</p>
<p><b>Operational considerations:</b> interview rubrics versioned, hiring funnel metrics, learning budget, documented career ladder with AI platform competencies.</p>`,
  failures:`
<ul>
<li><b>Hiring only researchers</b> for a platform role; operations suffer. Fix: role scorecards.</li>
<li><b>Unstructured interviews</b> lead to inconsistent hires. Fix: rubrics and calibration.</li>
<li><b>Upskilling without real ownership</b>; skills fade. Fix: real components with mentoring.</li>
</ul>`,
  vocab:[
    {term:'Skill matrix',def:'Map of required skills against team members.'},
    {term:'Role scorecard',def:'Definition of outcomes and skills for a role before hiring.'},
    {term:'Structured interview',def:'Consistent questions and rubric for all candidates.'},
    {term:'T-shaped engineer',def:'Deep in one area, broad across others.'}
  ],
  mistakes:[
    'Looking for unicorns who know everything.',
    'Trivia-based interviews.',
    'No growth path for existing engineers.',
    'Ignoring operational skills in AI hiring.'
  ],
  related:['v3-how-to-interview']
},
{
  id:'v3lead-06', chapter:'v3-ch-leadership', difficulty:3,
  title:'How do you build an AI platform roadmap?',
  understand:`They test whether you can turn strategy and user needs into a sequenced, measurable plan that survives fast-changing technology. Simple explanation: decide what outcomes the platform must deliver for its users and the business, order the work so foundations come first and value arrives early, and keep the plan flexible with regular reviews.`,
  short:`I build it from outcomes, not technologies. Inputs are the business strategy, what platform users need, which I get from interviews and usage data, and the risks and baselines from the inventory. I express the roadmap as a few outcomes with metrics, for example, "any team can ship an approved model to production in a day", "eighty percent of AI traffic goes through the gateway with logging and quotas", or "cost per successful request down twenty percent without SLO regression". Then I sequence: foundations that unlock many teams first, such as the gateway, identity, observability and evaluation harness; then golden paths for the most common use cases like RAG assistants and tool integrations via MCP; then optimisation and advanced capabilities. I use a now, next, later format rather than fixed dates for the far horizon, because AI technology shifts quickly, and I review it quarterly with stakeholders. Each item has an owner, a metric and a reason.`,
  detailed:`
<h5>Inputs</h5>
<ul>
<li>Business goals (for example customer support automation, personalised search, internal productivity).</li>
<li>Platform user needs: interviews, support tickets, adoption data.</li>
<li>Baselines and risks from the inventory (security gaps, cost hot spots, reliability).</li>
<li>Constraints: budget, headcount, regulation (PDPL, EU AI Act if relevant), GPU availability.</li>
</ul>
<h5>Now / Next / Later (ILLUSTRATIVE for Atlas)</h5>
${table(['Horizon','Outcome','Metric'],[
  ['Now (this quarter)','AI gateway with SSO, quotas, logging for all model traffic','% traffic via gateway'],
  ['Now','Evaluation harness in CI for prompts and models','% releases with eval gate'],
  ['Next (1–2 quarters)','Golden path: RAG assistant template with ACL-aware retrieval','Time to first production RAG app'],
  ['Next','MCP registry + gateway with read-only tools by default','Approved servers; incidents'],
  ['Later','Self-hosted inference for high-volume tasks after break-even analysis','Cost per successful request'],
  ['Later','Agent platform with approvals and identity delegation','Agents in production with audit coverage']
])}
<h5>Prioritisation</h5>
${formula(`
Simple scoring per item (ILLUSTRATIVE): priority = (value × reach × confidence) ÷ effort

Gateway:    value 3, reach 10 teams, confidence 0.9, effort 4 → 3 × 10 × 0.9 ÷ 4 = 6.75
Agent plat: value 5, reach 2 teams,  confidence 0.5, effort 8 → 5 × 2 × 0.5 ÷ 8  = 0.63
→ foundations with wide reach first
`)}
<h5>Keeping it honest</h5>
<ul>
<li>Quarterly review with stakeholders: what shipped, metric movement, what changed in technology or priorities.</li>
<li>Explicit "not doing" list.</li>
<li>Capacity split: roadmap work, operations, and an allocation for keeping up with technology changes (spec upgrades such as MCP revisions, engine upgrades).</li>
</ul>
<h5>Template</h5>
<p>"[At &lt;company&gt;, I built a roadmap for &lt;platform&gt; using &lt;inputs&gt;. We sequenced &lt;foundation&gt; first because &lt;reason&gt;. Result: &lt;metric movement&gt;.]"</p>`,
  diagram:fig('Roadmap layers', svgDiagram({w:900,h:280,
    boxes:[
      {id:'f',x:20,y:200,w:860,h:50,label:'Foundations: gateway, identity, observability, evaluation',cls:'hl'},
      {id:'g',x:20,y:130,w:860,h:50,label:'Golden paths: RAG template, MCP tools, model deployment'},
      {id:'o',x:20,y:60,w:860,h:50,label:'Optimisation + advanced: self-hosting, agents, routing',cls:'ok'}
    ],
    arrows:[]
  }), 'Each layer depends on the one below; value appears at every layer.'),
  followups:[
    {q:'A VP asks for an agent platform now; foundations are missing. What do you do?',a:'Show the dependency (agents without identity, policy and audit are a risk), offer a scoped pilot on the foundations that exist, and accelerate the missing foundations; agree the trade-off explicitly.'},
    {q:'How do you handle technology churn in the roadmap?',a:'Express items as outcomes, keep standard interfaces, reserve capacity for upgrades, and review quarterly.'},
    {q:'How do you measure the roadmap\'s success?',a:'Outcome metrics per item (adoption, lead time, cost, incidents), plus platform user satisfaction.'}
  ],
  tradeoffs:`
<p><b>Foundations first</b> builds durable value but delays visible features; <b>features first</b> shows quick value but accumulates risk. Mix: one visible golden path alongside foundations. <b>Fixed dates</b> give predictability; <b>now/next/later</b> keeps flexibility.</p>
<p><b>Operational considerations:</b> roadmap published, linked to metrics dashboards, reviewed quarterly.</p>`,
  failures:`
<ul>
<li><b>Technology-driven roadmap</b> ("adopt X") with no user outcome. Fix: outcomes and metrics.</li>
<li><b>Roadmap ignores operations</b>; team overloaded. Fix: capacity split.</li>
<li><b>Stakeholders surprised</b> by changes. Fix: quarterly reviews and communication.</li>
</ul>`,
  vocab:[
    {term:'Now/Next/Later',def:'Roadmap format grouping work by horizon instead of fixed dates.'},
    {term:'Golden path',def:'Supported, opinionated way to build a common type of application on the platform.'},
    {term:'Outcome-based roadmap',def:'Roadmap expressed as measurable results rather than projects.'},
    {term:'Prioritisation score',def:'Simple formula such as value × reach × confidence ÷ effort.'}
  ],
  mistakes:[
    'Listing tools instead of outcomes.',
    'No metrics per item.',
    'Skipping foundations for flashy features.',
    'Never revisiting the roadmap.'
  ],
  related:['v2-platform-architecture','v2-capstone-platform']
},
{
  id:'v3lead-07', chapter:'v3-ch-leadership', difficulty:2,
  title:'How do you drive adoption of a platform that teams are not obliged to use?',
  understand:`They test platform-as-product thinking: how to make the paved road the easiest choice, measure adoption, and handle teams that prefer their own tools. Simple explanation: make the platform genuinely easier and safer than doing it yourself, help early teams succeed, publish the results, and remove friction, rather than forcing people.`,
  short:`I treat the platform as a product with internal customers. First, solve a real pain: for an AI platform that's usually getting an approved model into production safely, or wiring identity, logging and quotas for model APIs. Second, make the paved road the easiest path: templates, self-service, good docs, a working example in their language, and fast support. Third, start with one or two design-partner teams, make them successful, and publish their results, such as time to production dropping from weeks to days. Fourth, include the things teams would otherwise have to build and get approved, like security reviews, observability and cost dashboards, so using the platform also gets them through governance faster. I measure adoption: share of AI traffic through the gateway, teams onboarded, time to first deployment and satisfaction. Mandates are a last resort, for non-negotiables like security logging, and even then the platform should make compliance cheap.`,
  detailed:`
<h5>Adoption levers</h5>
${table(['Lever','Example for an AI platform'],[
  ['Solve top pain','Self-service model deployment; approved model catalog; gateway keys in minutes'],
  ['Lower effort','Templates (RAG assistant, MCP server), CLI, examples in Python and TypeScript'],
  ['Governance included','Using the platform satisfies security review, logging and data-residency controls'],
  ['Design partners','Two teams co-design and launch first; their engineers become advocates'],
  ['Visibility','Showcase results, internal demos, documentation of wins'],
  ['Support','Office hours, chat channel, response-time targets'],
  ['Migration help','Pairing sessions, migration scripts, temporary dual-running']
])}
<h5>Metrics</h5>
${formula(`
adoption share = AI requests via gateway ÷ all AI requests  (from egress/spend data)

ILLUSTRATIVE quarter:
start: 1.2 M of 4.0 M requests via gateway  → 1.2 ÷ 4.0 = 30%
end:   3.4 M of 4.5 M requests via gateway  → 3.4 ÷ 4.5 ≈ 76%
also track: teams onboarded, time to first production deploy, CSAT
`)}
<h5>Handling holdouts</h5>
<ul>
<li>Understand why: missing features, performance concerns, trust. Fix what is legitimate.</li>
<li>For non-negotiables (audit logging, secrets handling, residency), set a policy with a date and provide the platform as the cheap way to comply.</li>
<li>Never break a team's production to force migration.</li>
</ul>
<h5>Template</h5>
<p>"[At &lt;company&gt;, adoption of &lt;platform&gt; was &lt;x&gt;. I &lt;interviewed teams / built templates / partnered with team Y&gt;. Adoption rose to &lt;y&gt; in &lt;time&gt;, and &lt;outcome&gt;.]"</p>`,
  diagram:fig('Adoption flywheel', svgDiagram({w:900,h:280,
    boxes:[
      {id:'p',x:350,y:20,w:200,h:50,label:'Solve real pain',cls:'hl'},
      {id:'e',x:650,y:110,w:200,h:50,label:'Easy paved road'},
      {id:'d',x:350,y:200,w:200,h:50,label:'Design partners win'},
      {id:'v',x:50,y:110,w:200,h:50,label:'Visible results',cls:'ok'}
    ],
    arrows:[{from:'p',to:'e'},{from:'e',to:'d'},{from:'d',to:'v'},{from:'v',to:'p'}]
  }), 'Success stories bring the next teams; their feedback improves the platform.'),
  followups:[
    {q:'A strong team built its own LLM gateway. What do you do?',a:'Learn from it, compare capabilities, consider adopting parts of it, and offer a migration path where the central gateway adds clear value (governance, cost, support). Avoid a political fight.'},
    {q:'When would you mandate?',a:'For security, privacy and compliance non-negotiables, with a clear date and support, after the platform makes compliance cheap.'},
    {q:'How do you collect feedback?',a:'Regular surveys, office hours, support ticket analysis, and usage analytics; publish what you changed because of feedback.'}
  ],
  tradeoffs:`
<p><b>Voluntary adoption</b> builds goodwill and product quality but is slower; <b>mandates</b> are fast but create resentment and workarounds. <b>Feature breadth</b> attracts teams; <b>depth and reliability</b> keep them.</p>
<p><b>Operational considerations:</b> platform SLOs published, support rota, docs ownership, adoption dashboard.</p>`,
  failures:`
<ul>
<li><b>Platform slower than DIY</b>; teams bypass it. Fix: measure time to first deploy; remove friction.</li>
<li><b>Mandate without support</b>; outages during forced migration. Fix: migration help and dual running.</li>
<li><b>Adoption counted by teams, not traffic</b>; misleading. Fix: traffic share.</li>
</ul>`,
  vocab:[
    {term:'Paved road',def:'Supported default path that makes the right way the easy way.'},
    {term:'Platform as product',def:'Treating internal users as customers with needs, feedback and satisfaction metrics.'},
    {term:'Design partner',def:'Early user team that co-designs and validates the platform.'},
    {term:'Adoption share',def:'Fraction of relevant traffic or teams using the platform.'}
  ],
  mistakes:[
    'Relying on mandates.',
    'Building features nobody asked for.',
    'No adoption metrics.',
    'Ignoring why teams resist.'
  ],
  related:['v2-platform-architecture','v2-ai-gateway']
},
{
  id:'v3lead-08', chapter:'v3-ch-leadership', difficulty:2,
  title:'How do you present AI cost and value to executives?',
  understand:`They test whether you can translate technical cost into business language and lead to a decision. Simple explanation: tell executives what AI costs per useful result, what value it creates, how that is trending, what risks exist and what you need from them, in a few minutes and without jargon.`,
  short:`I keep to three business measures and one ask. The measures are successful outcomes, for example conversations resolved without an agent, the experience, meaning response time and availability, and cost per successful outcome with its trend. I show total spend against budget and explain changes with a simple bridge: how much came from growth, how much from efficiency work. Then value next to cost, because a cost-only view makes AI look like a cost centre. Then risks, such as an upcoming Ramadan peak, a vendor price change or a commitment decision, and finally the specific decision I need. I avoid infrastructure vocabulary like GPU utilisation or tokens unless asked, and I clearly mark which numbers are measured and which are estimates. [If I've done this before, I'd cite the forum and the decision that came out of it.]`,
  detailed:`
<h5>The executive narrative</h5>
${table(['Part','Content','Avoid'],[
  ['Outcome','What AI achieved (resolved chats, bookings assisted)','Model names, token counts'],
  ['Experience','Response time, availability, quality signal','p95 TPOT jargon'],
  ['Unit cost','Cost per successful outcome, trend','Cost per token as headline'],
  ['Spend','Actual vs budget, bridge','Raw cloud invoices'],
  ['Risks','Peaks, vendor/price risk, compliance','Long technical lists'],
  ['Decision','Specific ask with options and recommendation','Vague "need more budget"']
])}
<h5>Translate the architecture</h5>
<p>"Requests come in through a secure front door that checks who you are and limits usage; a decision layer picks the right AI model for the job, cheap for simple questions, powerful for hard ones; the model service produces the answer; and monitoring watches quality, uptime and spend." That is the gateway, router, inference and observability, in executive language.</p>
<h5>Worked framing (ILLUSTRATIVE)</h5>
${formula(`
Cost per resolved chat   = AI spend for support ÷ chats resolved by AI
                         = $48,000 ÷ 300,000      = $0.16
Previous quarter         = $54,000 ÷ 250,000      = $0.216
Change                   = (0.16 − 0.216) ÷ 0.216 ≈ −26%
Message: "We resolved 20% more chats for 11% less money;
          each resolved chat now costs 16 cents."
check: 300,000 ÷ 250,000 = 1.20 (+20%); 48,000 ÷ 54,000 ≈ 0.889 (−11%)
`)}
<h5>Template</h5>
<p>"[At &lt;company&gt;, I presented &lt;topic&gt; to &lt;audience&gt;. I framed it as &lt;outcome/cost/risk&gt; and asked for &lt;decision&gt;. The result was &lt;decision made&gt;.]"</p>`,
  diagram:fig('Executive story arc', svgDiagram({w:900,h:260,
    boxes:[
      {id:'o',x:20,y:100,w:150,h:56,label:'Outcomes'},
      {id:'x',x:200,y:100,w:150,h:56,label:'Experience'},
      {id:'u',x:380,y:100,w:150,h:56,label:'Unit cost',cls:'hl'},
      {id:'r',x:560,y:100,w:150,h:56,label:'Risks'},
      {id:'d',x:740,y:100,w:140,h:56,label:'Decision',cls:'ok'}
    ],
    arrows:[{from:'o',to:'x'},{from:'x',to:'u'},{from:'u',to:'r'},{from:'r',to:'d'}]
  }), 'Lead with value, explain cost per outcome, end with a clear ask.'),
  followups:[
    {q:'An executive asks "why not just use the cheapest model?"',a:'Explain with the outcome metric: the cheaper model resolves fewer chats, and unresolved chats cost human agent time; show cost per resolved chat for both options.'},
    {q:'How do you handle a question you cannot answer in the meeting?',a:'Say you will come back with the number by a specific time, and do so; never guess a figure.'},
    {q:'How long should it be?',a:'Five minutes and one page; details in an appendix.'}
  ],
  tradeoffs:`
<p><b>Simplicity</b> helps decisions but can hide nuance; keep an appendix. <b>Conservative estimates</b> build credibility; optimistic ones are remembered when missed.</p>
<p><b>Operational considerations:</b> automated metrics so the same numbers appear every month; definitions agreed with finance.</p>`,
  failures:`
<ul>
<li><b>Jargon-heavy presentation</b>; no decision made. Fix: business measures and a clear ask.</li>
<li><b>Numbers disagree with finance</b>. Fix: reconcile first.</li>
<li><b>Estimated savings presented as achieved</b>. Fix: label clearly.</li>
</ul>`,
  vocab:[
    {term:'Cost per outcome',def:'Spend divided by successful business outcomes.'},
    {term:'Spend bridge',def:'Explanation of spend change by driver.'},
    {term:'Executive ask',def:'The specific decision requested from leadership.'}
  ],
  mistakes:[
    'Presenting GPU utilisation and token counts to executives.',
    'Showing cost without value.',
    'No explicit decision request.',
    'Guessing numbers under pressure.'
  ],
  related:['v2-finops-unit-economics','v3-ch-finops']
},
{
  id:'v3lead-09', chapter:'v3-ch-leadership', difficulty:1,
  title:'You are asked about a technology you have not run in production. How do you answer honestly?',
  understand:`This tests integrity and how you handle the edge of your knowledge, which matters a lot for someone moving from DevOps into AI. Simple explanation: say clearly what you have done and what you have not, show what you know about how it works and fails, and describe how you would get up to speed safely.`,
  short:`I use a four-part answer. First, the boundary, stated precisely: for example, "I have deployed vLLM in a lab and benchmarked it, but I haven't operated it at production scale." Second, what I do know: the architecture, the failure modes and the metrics I'd watch, which shows I'm not starting from zero. Third, the bridge from experience I do have: "I've run latency-sensitive services on Kubernetes with autoscaling and SLOs; the new parts for me are GPU memory, KV cache behaviour and cold starts of large weights." Fourth, a concrete plan: a one- or two-week evaluation with realistic traffic, the measurements, pass and fail criteria, a rollback plan, and who I'd learn from. That answer is stronger than bluffing, because interviewers always follow up, and it shows exactly how I'd behave on the job when I meet something new.`,
  detailed:`
<h5>The four-part template</h5>
${table(['Part','Template sentence'],[
  ['Boundary','"I have [done X in a lab / used X in a project / read the docs of X], but I have not [run X at production scale / owned X on-call]."'],
  ['Knowledge','"I understand [how it works: …], and the failure modes I would expect are [ … ]; I would watch [metrics]."'],
  ['Bridge','"The closest thing I have run in production is [system], where I [did Y]. What transfers is [Z]; what is new is [W]."'],
  ['Plan','"In the first [1–2] weeks I would [benchmark with realistic traffic / run a canary / do a game day], with pass criteria [ … ] and rollback [ … ]."']
])}
<h5>Worked example (fill with your truth)</h5>
<p>Question: "Have you run NVIDIA Dynamo or disaggregated prefill/decode in production?"</p>
<p>"[No. I have studied it and run vLLM in a lab, including measuring TTFT and TPOT under load.] I understand Dynamo is an orchestration and serving layer around engines such as vLLM, SGLang and TensorRT-LLM, not a replacement for them, and that disaggregation separates prefill and decode onto different workers, so KV-cache transfer bandwidth and routing become the new bottlenecks. [In production I have run &lt;latency-sensitive service&gt; on Kubernetes with &lt;autoscaling/SLOs&gt;.] I would start with a two-week evaluation: replay our real token-length distribution, compare goodput at our TTFT/TPOT SLOs against our current setup, test worker failure, and only proceed if goodput per GPU improves by an agreed margin."</p>
<h5>Phrases to avoid and use</h5>
${table(['Avoid','Use instead'],[
  ['"Yes, I have deep experience with it" (when you do not)','"I have used it in a lab; not at production scale."'],
  ['"I don\'t know" (and stop)','"I haven\'t used it; here is how I reason about it and how I would find out."'],
  ['"We did …" for things you did not do','"The team did …; my part was …"']
])}
<h5>Why this works</h5>
<p>Senior interviewers probe with follow-ups until they find the edge of your knowledge. If you have drawn the edge yourself, accurately, the follow-ups confirm your honesty. If you have bluffed, they expose it, and the rest of your answers lose credibility.</p>`,
  diagram:fig('Honest answer structure', svgDiagram({w:900,h:260,
    boxes:[
      {id:'b',x:20,y:100,w:180,h:56,label:'Boundary',sub:'done vs not done',cls:'hl'},
      {id:'k',x:240,y:100,w:180,h:56,label:'What I know',sub:'mechanism, failures'},
      {id:'r',x:460,y:100,w:180,h:56,label:'Bridge',sub:'related experience'},
      {id:'p',x:680,y:100,w:200,h:56,label:'Plan',sub:'1–2 week evaluation',cls:'ok'}
    ],
    arrows:[{from:'b',to:'k'},{from:'k',to:'r'},{from:'r',to:'p'}]
  }), 'Draw your own boundary before the interviewer has to find it.'),
  followups:[
    {q:'What if the role requires production experience you lack?',a:'Acknowledge it, show the closest relevant experience and lab evidence, and describe how fast you learn new systems with a concrete past example; let the interviewer weigh it.'},
    {q:'How do you present lab work?',a:'As lab work: what you built, what you measured, what you learned, and what would differ in production (scale, multi-tenancy, on-call).'},
    {q:'How do you avoid sounding unsure throughout?',a:'Be precise once about the boundary, then speak confidently about what you know and your plan.'}
  ],
  tradeoffs:`
<p>Honesty may cost a point on "experience" but gains trust across the whole interview; bluffing risks failing the loop and, if hired, failing on the job. Precision matters: "lab" vs "production" vs "read about".</p>
<p><b>Operational considerations:</b> keep a personal list of what you have done in labs (with measurements) so you can cite it accurately.</p>`,
  failures:`
<ul>
<li><b>Bluff exposed</b> by a follow-up about a specific flag or failure mode. Fix: never bluff.</li>
<li><b>Over-apologising</b> sounds junior. Fix: state the boundary once, then move to knowledge and plan.</li>
<li><b>Vague plan</b> ("I would learn it"). Fix: concrete evaluation with criteria.</li>
</ul>`,
  vocab:[
    {term:'Knowledge boundary',def:'Precise statement of what you have and have not done.'},
    {term:'Bridge',def:'Connecting related experience to the new technology.'},
    {term:'Evaluation plan',def:'Time-boxed test with metrics, criteria and rollback.'}
  ],
  mistakes:[
    'Claiming production experience from a lab.',
    'Saying "I don\'t know" without reasoning further.',
    'Using "we" to imply personal work you did not do.',
    'Vague learning plans.'
  ],
  related:['v3-how-to-interview','v3-mock-interviews']
},
{
  id:'v3lead-10', chapter:'v3-ch-leadership', difficulty:3,
  title:'How do you balance speed of AI experimentation with safety and governance?',
  understand:`They test whether you can enable fast innovation without creating unmanaged risk: tiered controls, sandboxes, guardrails as defaults. Simple explanation: let teams experiment quickly in safe spaces with fake or low-risk data, and require more checks only as an AI feature gets closer to real customers, real data and real actions.`,
  short:`I make risk decide the process, and I make the safe path fast. Concretely, three lanes. A sandbox lane: any team can try models and tools within hours, with synthetic or approved low-risk data, spending caps and no production access. A pilot lane: limited internal users or a small share of traffic, with the platform defaults switched on, meaning the gateway, logging, evaluation and quotas, and a lightweight review. A production lane: full evaluation thresholds, security and privacy review scaled to risk, red-team testing for customer-facing or agentic features, human oversight for actions, and monitoring. Most controls are built into the platform, so teams get them for free by using it; that's what keeps speed high. I measure both sides: time from idea to pilot, and incidents or policy violations. If the light lanes are slow, people route around them, which is the real governance failure.`,
  detailed:`
<h5>Lanes</h5>
${table(['Lane','Allowed','Controls','Target time'],[
  ['Sandbox','Any approved model, synthetic/low-risk data, no prod access','Spend cap, gateway keys, no PII, auto-expiry','Hours'],
  ['Pilot','Internal users or ≤5% traffic, read-only tools','Eval baseline, logging, quotas, light review','Days'],
  ['Production','Customers, real data, actions','Risk-tiered review, red team, approvals for actions, monitoring, rollback','Weeks for high risk; days for low']
])}
<h5>Guardrails as defaults (the platform does the work)</h5>
<ul>
<li>Gateway: identity, quotas, logging policy, model catalog, routing.</li>
<li>Evaluation harness: teams add tests, CI runs them.</li>
<li>Policy engine and MCP registry: tools read-only by default; write tools require approval workflows.</li>
<li>Data: classified sources; residency routing automatic.</li>
</ul>
<h5>Measuring balance</h5>
${formula(`
Speed:  median days from idea to pilot; % of requests through sandbox in < 1 day
Safety: incidents per production AI system per quarter; policy violations;
        % high-risk systems with complete evidence

ILLUSTRATIVE target: idea → pilot ≤ 5 days; 100% of high-risk systems with evidence
`)}
<h5>Template</h5>
<p>"[At &lt;company&gt;, teams were &lt;blocked by reviews / experimenting without controls&gt;. I introduced &lt;lanes / platform defaults&gt;. Result: &lt;time to pilot, incidents&gt;.]"</p>`,
  diagram:fig('Three lanes', svgDiagram({w:900,h:260,
    boxes:[
      {id:'s',x:20,y:100,w:240,h:60,label:'Sandbox',sub:'hours, synthetic data',cls:'ok'},
      {id:'p',x:330,y:100,w:240,h:60,label:'Pilot',sub:'days, defaults on'},
      {id:'r',x:640,y:100,w:240,h:60,label:'Production',sub:'risk-tiered review',cls:'hl'}
    ],
    arrows:[{from:'s',to:'p',label:'promote'},{from:'p',to:'r',label:'promote'}]
  }), 'Controls increase with exposure to customers, real data and real actions.'),
  followups:[
    {q:'A team shipped an AI feature without review. What do you do?',a:'Assess risk immediately (data, actions, users), apply minimum controls or pause if high risk, then fix the process gap that made bypassing easier than following it.'},
    {q:'How do you stop sandbox experiments from becoming production by accident?',a:'Sandbox keys expire, have spend caps and no production network or data access; promotion requires the pilot lane.'},
    {q:'Who decides the risk tier?',a:'The system owner proposes using a short questionnaire; the platform/security team confirms; disputes go to the review board.'}
  ],
  tradeoffs:`
<p><b>More process</b> lowers risk but drives shadow AI; <b>less process</b> speeds teams but risks incidents. Platform defaults move the curve: you get speed and safety together.</p>
<p><b>Operational considerations:</b> lane definitions published, intake form, metrics for both speed and safety.</p>`,
  failures:`
<ul>
<li><b>Sandbox with production data</b> leaks PII. Fix: data controls in sandbox.</li>
<li><b>Review backlog</b> causes bypassing. Fix: tiering and SLAs.</li>
<li><b>Pilot never graduates</b>, runs unsupported in production. Fix: expiry and promotion criteria.</li>
</ul>`,
  vocab:[
    {term:'Sandbox lane',def:'Low-risk environment for fast experimentation with strict limits.'},
    {term:'Risk-tiered review',def:'Review depth proportional to potential harm.'},
    {term:'Guardrails as defaults',def:'Controls built into the platform so teams inherit them automatically.'},
    {term:'Shadow AI',def:'AI usage outside approved platforms and governance.'}
  ],
  mistakes:[
    'One heavy process for every experiment.',
    'No limits in sandboxes.',
    'Measuring only safety or only speed.',
    'Relying on policy documents instead of platform defaults.'
  ],
  related:['v2-governance','v3-ch-security']
},
{
  id:'v3lead-11', chapter:'v3-ch-leadership', difficulty:1,
  title:'Tell me about yourself for an AI Platform Engineer role.',
  understand:`Opening question that sets the tone: a 60–90 second story connecting your background to the role, honestly. Simple explanation: say who you are professionally, what you are strongest at, how you have moved into AI platform work, and why this role, without claiming experience you do not have.`,
  short:`I'd give a ninety-second arc with real facts in the brackets. [I've spent twelve-plus years in cloud and DevOps, most recently leading &lt;team&gt; at &lt;company&gt;, running &lt;Kubernetes, AWS/GCP, CI/CD, observability&gt; for &lt;scale/business&gt;.] My strength is turning complex workloads into reliable, secure, cost-controlled platforms. Over the last &lt;period&gt; I've extended that into AI infrastructure: [I'm completing an M.Tech in AI/ML, and in labs I've served open-weight models with vLLM, benchmarked TTFT and TPOT, deployed them on Kubernetes with autoscaling, and built MCP servers with authentication and approvals.] I'm clear about the boundary: my production depth is in platform engineering; my AI work so far is lab and study. That combination is why this role interests me: [one sentence about the company's AI platform challenge]. I'd love to talk about how I'd approach &lt;their problem&gt;.`,
  detailed:`
<h5>Structure (60–90 seconds)</h5>
<ol>
<li><b>Present</b> (15 s): current role, scope, scale.</li>
<li><b>Strength</b> (15 s): the one thing you are best at, with one proof point.</li>
<li><b>Transition</b> (25 s): how you have moved into AI: study, labs, any real AI work, stated precisely.</li>
<li><b>Boundary</b> (10 s): one sentence on what is lab vs production.</li>
<li><b>Why this role</b> (15 s): connect to their specific challenge.</li>
</ol>
<h5>Fill-in template</h5>
<p>"[I'm &lt;name&gt;, &lt;title&gt; at &lt;company&gt;, where I lead &lt;n&gt; engineers running &lt;platforms&gt; for &lt;scale&gt;.] [My strongest area is &lt;reliability / platform automation / cost&gt;; for example, &lt;one real, measured achievement&gt;.] [Over the past &lt;period&gt; I have been building AI infrastructure skills: &lt;degree/courses&gt;, and in my lab &lt;what you built and measured&gt;.] [In production, my AI exposure is &lt;honest description, e.g. supporting SageMaker/Bedrock workloads&gt;; I have not yet &lt;operated GPU inference at scale&gt;.] [I'm interested in this role because &lt;their problem&gt; is exactly where platform discipline and AI serving meet.]"</p>
<h5>Region-specific touch (only if true)</h5>
<p>Experience with GCC traffic patterns (Ramadan and holiday peaks), Arabic and English user bases, or data-residency requirements is relevant to many regional AI platform roles; mention it if it is part of your real experience.</p>
<h5>Checklist</h5>
${checklist([
  {key:'v3lead11-a',text:'Every bracket replaced with a true fact or removed'},
  {key:'v3lead11-b',text:'One measured achievement, real numbers only'},
  {key:'v3lead11-c',text:'Lab vs production stated once, clearly'},
  {key:'v3lead11-d',text:'Under 90 seconds aloud'},
  {key:'v3lead11-e',text:'Ends with a hook about their problem'}
])}`,
  diagram:fig('Ninety-second arc', svgDiagram({w:900,h:240,
    boxes:[
      {id:'a',x:20,y:90,w:150,h:56,label:'Present',sub:'role, scope'},
      {id:'b',x:190,y:90,w:150,h:56,label:'Strength',sub:'1 proof point'},
      {id:'c',x:360,y:90,w:170,h:56,label:'AI transition',sub:'study + labs',cls:'hl'},
      {id:'d',x:550,y:90,w:150,h:56,label:'Boundary',sub:'lab vs prod'},
      {id:'e',x:720,y:90,w:160,h:56,label:'Why this role',cls:'ok'}
    ],
    arrows:[{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'d'},{from:'d',to:'e'}]
  }), 'Honest, specific and pointed at the interviewer\'s problem.'),
  followups:[
    {q:'Give me one concrete project.',a:'Pick your best true STAR story: problem, your decisions, measured result, learning, in two minutes.'},
    {q:'Why move from DevOps to AI platform work?',a:'Explain the genuine motivation (AI workloads need platform discipline; you enjoy the new technical depth) and show evidence of commitment (study, labs).'},
    {q:'What would your current team say is your weakness?',a:'A true, non-fatal weakness with what you are doing about it.'}
  ],
  tradeoffs:`
<p><b>Breadth</b> shows range; <b>focus</b> is memorable. Lead with one strength. <b>Modesty</b> vs <b>confidence</b>: be confident about real strengths and precise about gaps.</p>
<p><b>Operational considerations:</b> tailor the last 15 seconds to each company; rehearse aloud and time it.</p>`,
  failures:`
<ul>
<li><b>Five-minute career history</b>. Fix: 90 seconds, present-first.</li>
<li><b>Implied AI production experience</b> that collapses in follow-ups. Fix: state the boundary.</li>
<li><b>Generic ending</b>. Fix: tie to their specific problem.</li>
</ul>`,
  vocab:[
    {term:'Elevator pitch',def:'Short, structured summary of your professional story.'},
    {term:'Proof point',def:'One specific, measured achievement that supports a claim.'},
    {term:'Hook',def:'Closing line that invites the conversation you want.'}
  ],
  mistakes:[
    'Reciting the CV chronologically.',
    'Claiming production AI experience from labs.',
    'Listing tools instead of outcomes.',
    'No connection to the company\'s needs.'
  ],
  related:['v3-how-to-interview','v3-mock-interviews']
}
]);

registerGlossary([
  {term:'STAR',def:'Behavioural answer structure: Situation, Task, Action, Result; this course adds Learning (STAR + L).',lesson:'v3-ch-leadership',aliases:['STAR + L']},
  {term:'Architecture decision record',def:'Short document recording a technical decision’s context, options, decision, consequences and review date.',lesson:'v3-ch-leadership',aliases:['ADR']},
  {term:'Incident commander',def:'Person who coordinates an incident response, sets priorities and communication cadence, and does not debug.',lesson:'v3-ch-leadership'},
  {term:'30/60/90-day plan',def:'Phased plan for a new leader: listen and inventory, baselines and a first win, then an agreed roadmap.',lesson:'v3-ch-leadership'}
]);
