/* Vol 3, Part 2, Chapter 2 — Questions: data, training and fine-tuning */
registerLesson({
  id:'v3-ch-training', vol:3, part:2, num:2,
  title:'Questions: data, training and fine-tuning', minutes:110,
  summary:'This chapter is the interview question bank for the path from data to a trained or adapted model. Interviewers want to hear you decide between prompting, retrieval and fine-tuning, size the memory for full fine-tuning versus LoRA and QLoRA, explain preference tuning, and keep a large distributed training job alive when nodes fail. Every answer here is built so you can say it in under a minute and then defend it with numbers.',
  objectives:[
    'Choose between prompting, RAG, fine-tuning and distillation from the failure you are trying to fix, and say why in one minute.',
    'Derive the 16 bytes per parameter of full mixed-precision fine-tuning and the parameter count of a LoRA adapter from a model config.',
    'Explain DDP, FSDP/ZeRO, tensor and pipeline parallelism by what each shards and what each communicates.',
    'Describe a recoverable distributed training job: checkpoint contents, failure detection, bad-node isolation and checkpoint-interval maths.',
    'Diagnose training that looks healthy on loss but produces a worse model, and training that spikes, produces NaNs or hangs.'
  ],
  prereqs:['v1-training-loop','v1-finetuning','v1-data-pipelines','v2-distributed-training'],
  next:['v3-ch-gpu','v3-ch-mlops','v3-whiteboard'],
  tags:['interview','training','fine-tuning','lora','distributed-training'],
  html:`
<h2>What interviewers test in this area</h2>
<p>For a platform or infrastructure role, nobody expects you to invent a new optimizer. They test four things. First, <b>judgement</b>: do you reach for fine-tuning when the real problem is missing or stale knowledge that retrieval would solve? Second, <b>quantities</b>: can you say how much GPU memory a full fine-tune of an 8B or 70B model needs, and why LoRA changes that number so much? Third, <b>distributed systems instincts</b>: a 256-GPU job is a distributed system where one sick GPU stalls everyone, so checkpointing, timeouts and node isolation are your home ground. Fourth, <b>quality discipline</b>: falling training loss is not a release criterion, and data lineage is what lets you explain a regression.</p>
<p>Your DevOps background is a real advantage here. Checkpoints are backups with a recovery-point objective. Elastic restart is a controller reconciling a desired world size. Data versioning is artifact immutability. Say those bridges out loud, then show you know where they break: a training checkpoint must also capture optimizer and data-loader state, and "restart the pod" onto the same faulty GPU just fails again.</p>

<h2>The mental model</h2>
${fig('From data to a promoted model: where each question lives', svgDiagram({w:900,h:300,
  boxes:[
    {id:'d',x:20,y:110,w:140,h:64,label:'Data',sub:'provenance, dedup, PII',cls:'v1'},
    {id:'c',x:200,y:110,w:150,h:64,label:'Choose method',sub:'prompt · RAG · FT · distil',cls:'hl'},
    {id:'t',x:390,y:110,w:150,h:64,label:'Train / adapt',sub:'full · LoRA · QLoRA · DPO',cls:'v2'},
    {id:'s',x:390,y:220,w:150,h:60,label:'Scale + survive',sub:'FSDP · ckpt · NCCL',cls:'warn'},
    {id:'e',x:580,y:110,w:140,h:64,label:'Evaluate',sub:'held-out, slices',cls:'v3'},
    {id:'p',x:760,y:110,w:120,h:64,label:'Promote',sub:'registry, canary',cls:'ok'}
  ],
  arrows:[{from:'d',to:'c'},{from:'c',to:'t'},{from:'t',to:'e'},{from:'e',to:'p'},{from:'t',to:'s',both:true,label:'memory, failures'},{from:'e',to:'d',cls:'dash',label:'regression → data',fromSide:'top',toSide:'top'}],
  notes:[{x:20,y:40,text:'Each box is a cluster of interview questions. The dashed loop is the senior signal: most quality bugs trace back to data.'}]
}), 'Questions 1, 8 and 11 sit on the left; 2–5 in the middle; 6, 7 and 10 in "scale and survive"; 9 is the evaluate-to-data loop.')}

<h2>Say it like a senior engineer</h2>
<div class="compare"><div class="bad"><h4>Weak</h4><p>"We'll fine-tune the model on our policies so it knows them."</p></div><div class="good"><h4>Strong</h4><p>"Policies change weekly and have access rules, so that is a retrieval problem. I'd fine-tune only for behaviour — tone, format, tool-call discipline — and prove each choice on a held-out evaluation set."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak</h4><p>"A 70B model is 140 GB, so two H100s are enough to fine-tune it."</p></div><div class="good"><h4>Strong</h4><p>"140 GB is just BF16 weights. Full fine-tuning with Adam is about 16 bytes per parameter before activations, so roughly 1.12 TB. That means sharding across 16–32 H100s, or LoRA/QLoRA, which keeps the base frozen and trains tens of millions of parameters."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak</h4><p>"If training crashes, we restart it."</p></div><div class="good"><h4>Strong</h4><p>"I checkpoint model, optimizer, scheduler, RNG and data-loader state as sharded async saves, detect hangs with a collective timeout, cordon the bad node, and resume from the last checkpoint. The interval comes from save cost versus failure rate."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak</h4><p>"Loss went down, so the new model is better."</p></div><div class="good"><h4>Strong</h4><p>"Training loss only says the model fits the training data. I gate on held-out task metrics per slice and language, regression suites on general capability, and a canary. A falling loss with worse answers usually means overfitting, forgetting, a chat-template mismatch or contaminated evaluation."</p></div></div>

<h2>Must-know numbers (derive them, do not memorise them)</h2>
${formula(`
STEP 1  Full mixed-precision fine-tuning with Adam, per parameter
        BF16 weights 2 + BF16 grads 2 + FP32 master 4 + Adam m 4 + Adam v 4
      = 16 bytes/param                      (activations are extra)

STEP 2  70B model
        16 B × 70 × 10⁹ = 1.12 × 10¹² B = 1.12 TB
        ÷ 16 GPUs (ZeRO-3 / FSDP) = 70 GB per GPU    → too tight on 80 GB H100
        ÷ 32 GPUs                  = 35 GB per GPU    → room for activations

STEP 3  LoRA parameters per adapted matrix
        r × (d_in + d_out)
        Llama-3.1-8B, r = 16, q k v o, 32 layers  → 13,631,488 params (≈ 0.17 %)
        all linear layers                        → 41,943,040 params
        on disk in BF16: 41,943,040 × 2 B ≈ 83.9 MB

STEP 4  Young's checkpoint interval
        τ ≈ √(2 · C · M)      C = save cost, M = mean time between job failures
        C = 2 min, M = 480 min (illustrative)  → τ ≈ √1,920 ≈ 44 min
`)}
<p>Also know: QLoRA stores the frozen base in 4-bit NF4 (about 0.5 byte per parameter plus small quantization constants) while compute and adapters stay in 16-bit; DDP communicates gradients with all-reduce, FSDP/ZeRO-3 adds parameter all-gathers and costs roughly 1.5× DDP's communication volume; DPO needs two models in memory (policy and frozen reference) while PPO-style RLHF typically needs four.</p>

<h2>How to use this chapter</h2>
<p>Read the question and the "understand" line, then say your answer aloud before revealing the model answer. Time yourself: 30–60 seconds. Then work through the follow-ups, which get harder the way a real interviewer escalates. Where an answer needs personal experience, it gives a bracketed template; fill it with something you actually did — a lab from ${L('v1-capstone-train','the capstone fine-tune')} counts, as long as you call it a lab. Revise the mechanics in ${L('v1-finetuning','the fine-tuning lesson')} and ${L('v2-distributed-training','distributed training')} if any number here surprises you.</p>
`,
  quiz:[
    {q:'A full mixed-precision fine-tune with Adam needs roughly how many bytes per parameter before activations?',options:['2','4','16','32'],answer:2,explain:'2 (BF16 weights) + 2 (grads) + 4 (FP32 master) + 4 + 4 (Adam moments) = 16. Answering 2 confuses training with inference weight storage.'},
    {q:'How many trainable parameters does a rank-8 LoRA add to one 4096 × 4096 projection?',options:['32,768','65,536','16,777,216','8'],answer:1,explain:'r × (d_in + d_out) = 8 × 8,192 = 65,536. 16.7M is the full matrix that LoRA leaves frozen.'},
    {q:'Your policy documents change every week and are visible only to some employees. Best primary approach?',options:['Full fine-tune weekly','LoRA fine-tune weekly','Retrieval with permission filtering at query time','Raise the temperature'],answer:2,explain:'Freshness and access control are retrieval properties. Weights cannot enforce per-user ACLs and go stale; fine-tuning suits behaviour, not changing facts.'},
    {q:'A 32-GPU job stops making progress, no process has exited, and GPU utilisation still shows activity. Most likely?',options:['The learning rate is too low','Ranks are blocked in a collective waiting for a failed or slow peer','The checkpoint is corrupt','The tokenizer changed'],answer:1,explain:'Collectives need every rank; a dead or stuck peer makes the others wait until a timeout fires. A low learning rate still updates the loss each step.'},
    {q:'Compared with DDP, FSDP / ZeRO-3 mainly trades…',options:['Less memory per GPU for more communication','More memory for less communication','Accuracy for speed','Nothing; it is strictly better'],answer:0,explain:'Sharding parameters, gradients and optimizer state cuts memory per GPU but adds parameter all-gathers, about 1.5× the communication volume of DDP.'}
  ],
  flashcards:[
    {front:'16 bytes per parameter — break it down',back:'BF16 weights 2 + BF16 gradients 2 + FP32 master weights 4 + Adam first moment 4 + Adam second moment 4. Activations are extra.'},
    {front:'LoRA parameter count for one matrix',back:'r × (d_in + d_out). Llama-3.1-8B, r=16 on q,k,v,o across 32 layers = 13.6M; all linear layers = 41.9M.'},
    {front:'QLoRA in one line',back:'Frozen base quantized to 4-bit NF4 (with double quantization of the scales), LoRA adapters trained in 16-bit, paged optimizers to survive memory spikes. Compute dequantizes to BF16.'},
    {front:'Fine-tune or RAG?',back:'Missing or changing facts, citations, per-user ACLs → RAG. Behaviour, format, style, tool-call discipline, latency of a smaller model → fine-tune. Often both.'},
    {front:'DPO vs PPO-RLHF memory',back:'DPO: policy + frozen reference (2 models). PPO RLHF: policy, reference, reward model, value model (about 4), plus online generation.'},
    {front:'Young’s checkpoint interval',back:'τ ≈ √(2·C·M). C = blocking save cost, M = mean time between job failures. Async saves shrink C and therefore τ and overhead.'},
    {front:'What must a training checkpoint contain?',back:'Model weights, optimizer state, LR scheduler, step counter, RNG states, data-loader/sampler position, config and code/data versions. Weights alone cannot resume faithfully.'},
    {front:'DDP vs FSDP communication',back:'DDP: all-reduce of gradients each step. FSDP/ZeRO-3: all-gather parameters (forward and backward) + reduce-scatter gradients, ≈1.5× DDP volume, but ≈1/N memory per GPU.'}
  ]
});

registerQuestions([
{
  id:'trn-01', chapter:'v3-ch-training', difficulty:1,
  title:'Fine-tune, RAG or prompting: how do you decide?',
  understand:'The interviewer wants to see that you diagnose the failure before choosing a technique. Do you know which problems are knowledge problems (retrieval), which are behaviour problems (fine-tuning), and which are just instruction problems (prompting)? Cost, freshness and access control should drive the decision, not fashion.',
  short:'I start from the failure. If the model does not know something, or the facts change and must be cited and permission-filtered, that is a retrieval problem and I use RAG, because weights cannot enforce who may see a document and they go stale. If the model knows enough but behaves wrongly, the wrong format, tone, tool-call discipline or a domain style, that is a behaviour problem and fine-tuning, usually LoRA, fixes it. And before either, I try a strong prompt with a few examples and measure it on an evaluation set, because it is the cheapest baseline. In practice the answer is often RAG for facts plus a small fine-tune for behaviour, chosen by evaluation results, not by preference.',
  detailed:`
<p>The decision is a diagnosis. Build a small evaluation set of real tasks first (50–200 examples with expected answers or rubrics), run the base model with a careful prompt, and <b>classify the failures</b>.</p>
${table(['Failure you observe','Category','First lever','Why'],[
 ['Wrong or missing facts about internal policies','Knowledge','RAG','Facts live in documents that change; retrieval brings current text and citations'],
 ['Answers leak documents a user may not see','Access control','RAG with ACL filter at query time','Weights cannot be permission-filtered per user'],
 ['Correct facts, wrong JSON shape or tone','Behaviour','Prompt + structured output → then SFT/LoRA','Format and style are learned patterns'],
 ['Calls tools in the wrong order, ignores escalation rules','Behaviour','Few-shot → SFT on traces','Procedural behaviour generalises well from examples'],
 ['Good quality but too slow or expensive','Efficiency','Distil or fine-tune a smaller model','A small tuned model can match a large one on a narrow task'],
 ['Domain vocabulary it has never seen (rare languages, codes)','Knowledge in the weights','Continued pretraining (rare)','Needs large unlabelled corpora; expensive']
])}
<h3>Cost and operational shape</h3>
<p><b>Prompting</b> costs tokens on every request (long system prompts raise prefill cost and TTFT, partly offset by ${L('v2-prefix-kv-cache','prefix caching')}) but needs no training pipeline. <b>RAG</b> adds an index, an embedding pipeline, freshness jobs and an ACL model, and adds retrieval latency (tens to hundreds of ms, measure it). <b>Fine-tuning</b> adds a training pipeline, an evaluation gate, a model registry, and a serving decision (merged weights or hot-swapped LoRA adapters). It also creates a <i>retraining obligation</i>: every base-model upgrade means re-running the fine-tune and its evaluation.</p>
${formula(`
Rough monthly cost comparison (structure, not prices)

Prompting   = requests × (extra prompt tokens × input price)
RAG         = index infra + embedding refresh + requests × (retrieved tokens × input price)
Fine-tune   = training runs × GPU-hours × rate + eval runs + serving overhead of the variant
                                                   ↑ recurs every base-model upgrade
`)}
<h3>A travel-domain example (fictional Atlas platform)</h3>
<p>Baggage and refund policies change monthly and differ by fare class and market: that is RAG with document versioning and citations. The agent must always produce a booking-reference lookup before discussing refunds and must answer in the customer's language (Arabic or English): that is behaviour, a good LoRA target. Live fares change minute to minute: neither; call a tool.</p>
<p>The senior signal is saying <b>"I would measure the baseline first"</b> and <b>"fine-tuning does not reliably teach facts"</b>: a model fine-tuned on a policy can still mix it with what it learned in pretraining, and you cannot cite or revoke it.</p>`,
  diagram:fig('Decision flow: classify the failure, then pick the lever', svgDiagram({w:900,h:300,
    boxes:[
      {id:'e',x:20,y:120,w:150,h:60,label:'Baseline eval',sub:'prompt + few-shot',cls:'hl'},
      {id:'k',x:250,y:30,w:180,h:60,label:'Knowledge gap?',sub:'missing / stale facts',cls:'v1'},
      {id:'b',x:250,y:120,w:180,h:60,label:'Behaviour gap?',sub:'format, tone, tools',cls:'v2'},
      {id:'c',x:250,y:210,w:180,h:60,label:'Cost / latency gap?',sub:'quality ok, too slow',cls:'v3'},
      {id:'r',x:520,y:30,w:160,h:60,label:'RAG',sub:'+ ACL + citations',cls:'ok'},
      {id:'f',x:520,y:120,w:160,h:60,label:'SFT / LoRA',sub:'on curated examples',cls:'ok'},
      {id:'d',x:520,y:210,w:160,h:60,label:'Distil / small FT',sub:'or quantize',cls:'ok'},
      {id:'g',x:740,y:120,w:140,h:60,label:'Eval gate',sub:'same test set',cls:'warn'}
    ],
    arrows:[{from:'e',to:'k'},{from:'e',to:'b'},{from:'e',to:'c'},{from:'k',to:'r'},{from:'b',to:'f'},{from:'c',to:'d'},{from:'r',to:'g'},{from:'f',to:'g'},{from:'d',to:'g'}]
  }), 'The same evaluation set judges every option, so the choice is evidence-based and reversible.'),
  followups:[
    {q:'Can you fine-tune the model on our policy documents instead of building RAG?',a:'You can, but you lose citations, freshness and per-user access control, and the model may blend tuned facts with pretraining knowledge. Every policy change means retraining and re-evaluating. I would only bake in stable, universally visible knowledge, and still keep RAG for anything that changes or is restricted.'},
    {q:'When would you combine RAG and fine-tuning?',a:'When retrieval supplies the facts but the model uses them badly: ignores retrieved context, does not cite, or breaks the output format. A small SFT on (question, retrieved context, ideal grounded answer) examples teaches the behaviour of using context. It is sometimes called retrieval-aware fine-tuning.'},
    {q:'How do you prove the fine-tune was worth it?',a:'Same held-out evaluation set as the baseline, sliced by task type and language, plus latency and cost per successful request. If the prompt baseline gets within noise of the tuned model, the fine-tune is not worth the retraining obligation.'},
    {q:'The business wants the model to "know" 5 million product records. Which approach?',a:'Neither prompting nor fine-tuning: that is structured data. Use a tool or SQL/API lookup (function calling or MCP) for exact records, RAG for unstructured descriptions. Fine-tuning would memorise poorly and go stale immediately.'}
  ],
  tradeoffs:`<ul><li><b>Prompting</b>: fastest to change and roll back; costs tokens per request; limited by context length and instruction-following.</li><li><b>RAG</b>: fresh, citable, permission-aware; adds retrieval latency, index operations and a new failure mode (bad retrieval → confident wrong answer).</li><li><b>Fine-tuning</b>: cheaper per request (shorter prompts), consistent behaviour; needs data curation, evaluation and retraining on every base upgrade; risk of catastrophic forgetting.</li><li><b>Distillation</b>: big cost and latency win for narrow tasks; quality ceiling set by the teacher and your data coverage.</li></ul>`,
  failures:`<ul><li><b>Fine-tuned on stale policy</b> → symptom: confident outdated answers after a policy change → evidence: answers match old document version → fix: move facts to RAG, retrain only behaviour.</li><li><b>RAG retrieves the wrong chunk</b> → symptom: plausible but wrong answers with citations → evidence: retrieval recall@k on an eval set is low → fix: chunking, hybrid search, reranking.</li><li><b>Prompt grows to 8k tokens of rules</b> → symptom: TTFT and cost rise, instructions conflict → fix: move stable behaviour into a fine-tune, keep the prompt short.</li></ul>`,
  vocab:[
    {term:'SFT',def:'Supervised fine-tuning: training on (input, desired output) pairs so the model imitates the target behaviour.'},
    {term:'RAG',def:'Retrieval-augmented generation: fetch relevant, authorised documents at request time and put them in the prompt.'},
    {term:'Continued pretraining',def:'Further next-token training on large unlabelled domain text to shift what the model knows; expensive and rarely needed for platform use cases.'},
    {term:'Catastrophic forgetting',def:'Loss of general capabilities after fine-tuning on a narrow dataset.'},
    {term:'Retraining obligation',def:'The recurring cost of re-running a fine-tune and its evaluation whenever the base model is upgraded.'}
  ],
  mistakes:[
    'Saying "fine-tune it on our documents" for facts that change weekly: weights go stale and cannot be permission-filtered.',
    'Skipping the prompt baseline: you cannot show the fine-tune helped without it.',
    'Treating RAG and fine-tuning as competitors; they solve different failure classes and often combine.',
    'Using a database-shaped problem (exact records) as a fine-tuning or RAG problem instead of a tool call.'
  ],
  related:['v1-finetuning','v2-rag-fundamentals','v2-rag-production','v1-ai-apps-tools']
},
{
  id:'trn-02', chapter:'v3-ch-training', difficulty:2,
  title:'Explain LoRA like an engineer — and how many parameters does it train?',
  understand:'They want the mechanism (frozen base, low-rank update), the arithmetic (parameter count from a model config), and the operational consequences (adapter size, memory saved, merge versus hot-swap at serving time). A hand-wavy "it trains fewer parameters" is the weak answer.',
  short:'LoRA freezes the pretrained weight matrix W and learns a low-rank update: two thin matrices A and B whose product has the same shape as W, so the layer computes W x plus B A x. Only A and B get gradients and optimizer state. For one matrix that is r times d-in plus d-out parameters. On Llama-3.1-8B with rank 16 on all linear layers that is about 42 million trainable parameters, roughly half a percent, and an 84 megabyte adapter in BF16. The base still has to be in memory, so LoRA saves the gradient and optimizer memory, not the weight memory. At serving time I can merge the adapter into the weights for zero overhead, or keep it separate and hot-swap many adapters on one base model.',
  detailed:`
<h3>The mechanism</h3>
<p>For a frozen weight W of shape d_out × d_in, LoRA adds ΔW = (α/r)·B·A, where A is r × d_in and B is d_out × r, with r much smaller than d (typically 8–64). B is initialised to zero, so training starts exactly at the base model. Only A and B are trained.</p>
${formula(`
h = W·x + (α / r) · B·(A·x)
    ↑ frozen    ↑ trainable, rank r

Trainable params per matrix = r × (d_in + d_out)
Full matrix                  = d_in × d_out
`)}
<h3>Worked count: Llama-3.1-8B (hidden 4096, 8 KV heads × 128 = 1024, MLP 14,336, 32 layers), r = 16</h3>
${formula(`
STEP 1  attention projections per layer
        q: 16 × (4096 + 4096)  = 131,072
        k: 16 × (4096 + 1024)  =  81,920
        v: 16 × (4096 + 1024)  =  81,920
        o: 16 × (4096 + 4096)  = 131,072
                         sum   = 425,984

STEP 2  MLP projections per layer
        gate: 16 × (4096 + 14,336) = 294,912
        up:   16 × (4096 + 14,336) = 294,912
        down: 16 × (14,336 + 4096) = 294,912
                             sum   = 884,736

STEP 3  32 layers
        q,k,v,o only  : 425,984 × 32   = 13,631,488   (≈ 0.17 % of 8B)
        all linear    : 1,310,720 × 32 = 41,943,040   (≈ 0.52 %)

ANSWER  adapter on disk (BF16) ≈ 41,943,040 × 2 B ≈ 83.9 MB
`)}
<h3>Where the memory saving comes from</h3>
${table(['Component','Full fine-tune 8B','LoRA (all-linear, r=16)'],[
 ['Base weights (BF16)','16 GB (trainable)','16 GB (frozen)'],
 ['Gradients','16 GB','≈ 84 MB'],
 ['FP32 master + Adam m, v (12 B/param)','96 GB','≈ 0.5 GB'],
 ['Total before activations','≈ 128 GB','≈ 16.6 GB'],
 ['Activations','batch × seq dependent','still needed (gradients flow through frozen layers)']
])}
<p>So LoRA turns an 8B fine-tune from a multi-GPU sharded job into a single-GPU job. Activations remain and often dominate at long sequence lengths; gradient checkpointing trades recompute for that memory.</p>
<h3>Serving consequences</h3>
<ul><li><b>Merge</b>: W' = W + (α/r)BA, export a normal checkpoint. Zero inference overhead, but one full model copy per fine-tune.</li>
<li><b>Hot-swap / multi-LoRA</b>: keep one base in HBM and apply per-request adapters. vLLM exposes this with <code>--enable-lora</code> (and <code>--max-loras</code>, default 1, for how many adapters are active in a batch, as of v0.31). Small per-token overhead, huge memory saving when you have dozens of tenants or tasks.</li></ul>
<p>Rank and target modules are hyperparameters: higher rank adds capacity and parameters linearly. Targeting only attention (q, v) was the original paper's default; many recipes now target all linear layers.</p>`,
  diagram:fig('LoRA: frozen W plus a trainable low-rank path', svgDiagram({w:900,h:280,
    boxes:[
      {id:'x',x:30,y:110,w:110,h:56,label:'x',sub:'d_in = 4096',cls:'v1'},
      {id:'w',x:250,y:40,w:200,h:60,label:'W (frozen)',sub:'4096 × 4096 = 16.8M',cls:'x'},
      {id:'a',x:220,y:180,w:130,h:56,label:'A',sub:'16 × 4096',cls:'hl'},
      {id:'b',x:400,y:180,w:130,h:56,label:'B',sub:'4096 × 16',cls:'hl'},
      {id:'s',x:600,y:110,w:110,h:56,label:'+',sub:'scale α/r',cls:'v2'},
      {id:'h',x:770,y:110,w:110,h:56,label:'h',sub:'d_out = 4096',cls:'ok'}
    ],
    arrows:[{from:'x',to:'w'},{from:'x',to:'a'},{from:'a',to:'b',label:'rank 16'},{from:'w',to:'s'},{from:'b',to:'s'},{from:'s',to:'h'}],
    notes:[{x:220,y:262,text:'Trainable: 16 × (4096 + 4096) = 131,072 params = 0.78 % of this matrix'}]
  }), 'Only A and B receive gradients and optimizer state; B starts at zero so step 0 equals the base model.'),
  followups:[
    {q:'Does LoRA make inference faster?',a:'No. Merged, it is exactly the base model cost. Unmerged, it adds a small extra matmul per adapted layer. Its win is training memory, adapter storage and multi-tenant serving density.'},
    {q:'How do you choose rank?',a:'Empirically: start at 8–16 on all linear layers, evaluate, and only raise rank if the eval plateaus below target. Parameters grow linearly with r, quality usually saturates early for style/format tasks.'},
    {q:'You serve 40 tenant-specific adapters. Merge or hot-swap?',a:'Hot-swap: 40 merged 8B copies would be 640 GB of weights; 40 adapters at ~84 MB each are ~3.4 GB on one base. Watch batch heterogeneity overhead and the max active adapters limit, and route tenants with the same adapter to the same replicas.'},
    {q:'Why does B start at zero and what is α for?',a:'Zero B makes ΔW = 0 at step 0, so training starts from the base behaviour. α/r scales the update so changing r does not require re-tuning the learning rate as much.'}
  ],
  tradeoffs:`<ul><li><b>Full fine-tune</b> has the most capacity (needed for big domain shifts) but costs 16 B/param plus activations and one full checkpoint per variant.</li><li><b>LoRA</b> gives most of the quality for behaviour/style tasks at a fraction of memory; may underfit large knowledge shifts.</li><li><b>Merged vs unmerged</b>: merged = simplest serving, no overhead; unmerged = many variants on one base, small overhead, more complex routing.</li></ul>`,
  failures:`<ul><li><b>Adapter loaded on the wrong base revision</b> → garbage or subtly degraded output → enforce base model hash in adapter metadata and check at load.</li><li><b>Merged in lower precision</b> (merge into a quantized base) → quality drop → merge in BF16, quantize after, re-evaluate.</li><li><b>Too many concurrent adapters</b> → throughput drop or queueing → raise the active-adapter limit within memory, or shard tenants across replica groups.</li></ul>`,
  vocab:[
    {term:'Low-rank update',def:'ΔW = B·A with inner dimension r much smaller than the matrix dimensions.'},
    {term:'Rank r',def:'The inner dimension of the adapter; sets trainable parameter count linearly.'},
    {term:'α (lora_alpha)',def:'Scaling factor; the update is multiplied by α/r.'},
    {term:'Target modules',def:'Which projections get adapters (q, k, v, o, gate, up, down).'},
    {term:'Adapter merge',def:'Folding ΔW into W to produce a standard checkpoint with no runtime overhead.'},
    {term:'Multi-LoRA serving',def:'One base model in GPU memory serving requests with different adapters in the same batch.'}
  ],
  mistakes:[
    'Saying LoRA reduces the memory for the base weights: it does not; QLoRA does that by quantizing the base.',
    'Claiming LoRA speeds up inference.',
    'Computing parameters as r × d_in × d_out or forgetting that k and v are smaller under GQA.',
    'Forgetting activations: a LoRA job can still OOM at long sequence lengths.'
  ],
  related:['v1-finetuning','v1-capstone-train','v1-engines','v1-gpu-memory']
},
{
  id:'trn-03', chapter:'v3-ch-training', difficulty:2,
  title:'How is QLoRA different from LoRA, and what does it cost you?',
  understand:'They are checking whether you know what is quantized and what is not, the memory maths, and the trade-offs (speed, kernel support, merge complications). The classic weak answer is "QLoRA trains in 4-bit".',
  short:'QLoRA is LoRA on top of a base model stored in 4-bit. The frozen base weights are quantized to NF4, a 4-bit format designed for normally distributed weights, and even the quantization scales are quantized again, which the paper calls double quantization. The LoRA adapters are still trained in 16-bit, and each layer dequantizes the weights to BF16 on the fly for the matmul. So you pay about half a byte per base parameter instead of two: an 8B base drops from 16 GB to around 4 to 5 GB, and a 70B base from 140 GB to roughly 35 to 40 GB, which fits one 80 GB GPU. The price is slower steps because of dequantization, some quality risk, and care when merging the adapter back.',
  detailed:`
<h3>What QLoRA changes (Dettmers et al., 2023, arXiv 2305.14314)</h3>
<ol><li><b>4-bit NormalFloat (NF4)</b> storage for the frozen base. Quantization bins are placed at quantiles of a normal distribution, which matches how pretrained weights are distributed.</li>
<li><b>Double quantization</b>: weights are quantized in blocks (64 values per block in the paper), each with a scale; those scales are themselves quantized to save more memory.</li>
<li><b>Paged optimizers</b>: optimizer state can page between GPU and CPU memory to survive memory spikes from long sequences.</li></ol>
<p>Compute does not happen in 4-bit. Each forward/backward dequantizes a block to BF16, multiplies, and discards it. Gradients flow through the frozen quantized base into the 16-bit LoRA adapters.</p>
${formula(`
Base weight memory, ≈ 0.5 B/param + quantization constants

8B   BF16  : 8 × 10⁹ × 2 B    = 16 GB
8B   NF4   : 8 × 10⁹ × 0.5 B  =  4 GB   (+ scales, a few % more)

70B  BF16  : 70 × 10⁹ × 2 B   = 140 GB  → needs ≥ 2 × 80 GB GPUs just for weights
70B  NF4   : 70 × 10⁹ × 0.5 B =  35 GB  → ≈ 37–40 GB with constants (illustrative)
                                          fits one 80 GB GPU with room for activations
`)}
<p>The paper reports fine-tuning a 65B model on a single 48 GB GPU, which is the headline that made the method popular. Adapter and optimizer memory are the same as LoRA (≈ 0.5 GB for an 8B all-linear rank-16 adapter).</p>
${table(['','LoRA','QLoRA'],[
 ['Base weights','BF16, frozen','NF4 4-bit, frozen'],
 ['Adapters','BF16','BF16'],
 ['Matmul precision','BF16','BF16 after dequantization'],
 ['Step speed','baseline','slower (dequantization overhead; measure)'],
 ['Quality','reference','usually close; validate on your eval set'],
 ['Merge','straightforward in BF16','merge into a BF16 copy of the base, then quantize for serving if needed']
])}
<h3>When to choose it</h3>
<p>Choose QLoRA when GPU memory is the binding constraint: a 70B adaptation on one or two GPUs, or an 8B model on a 24 GB card. Choose plain LoRA when you have the memory, because steps are faster and there is one less source of quality drift. Keep the tokenizer, chat template and base revision pinned; QLoRA does not change those concerns.</p>
${callout('unverified','Verify before relying on this','Exact step-time overhead and quality gap of QLoRA versus LoRA depend on the bitsandbytes/PEFT versions, GPU and model. Do not quote a percentage; measure it on your workload.')}`,
  diagram:fig('QLoRA forward pass: dequantize, multiply, discard', svgDiagram({w:900,h:240,
    boxes:[
      {id:'q',x:20,y:80,w:180,h:64,label:'Base W in NF4',sub:'0.5 B/param, frozen',cls:'x'},
      {id:'d',x:250,y:80,w:160,h:64,label:'Dequantize block',sub:'→ BF16 tile',cls:'warn'},
      {id:'m',x:460,y:80,w:150,h:64,label:'BF16 matmul',sub:'W·x',cls:'v2'},
      {id:'l',x:460,y:170,w:150,h:56,label:'LoRA B·A·x',sub:'BF16, trainable',cls:'hl'},
      {id:'o',x:680,y:110,w:180,h:64,label:'h = Wx + BAx',sub:'grads only to A, B',cls:'ok'}
    ],
    arrows:[{from:'q',to:'d'},{from:'d',to:'m'},{from:'m',to:'o'},{from:'l',to:'o'}]
  }), 'Storage is 4-bit; arithmetic is 16-bit. That is why QLoRA saves memory but not compute.'),
  followups:[
    {q:'Does QLoRA reduce activation memory?',a:'No. Activations are BF16 and scale with batch × sequence length × hidden size × layers. Use gradient checkpointing, smaller micro-batches or shorter sequences for that.'},
    {q:'Can you serve the QLoRA result in 4-bit?',a:'You can serve base-in-4-bit plus adapter, but the best practice is merging into a BF16 base and then applying a serving quantization (FP8, AWQ/GPTQ INT4) chosen for the serving engine, then re-running the eval, because NF4 is a training storage format and engine kernel support varies.'},
    {q:'Why NF4 instead of plain INT4?',a:'Pretrained weights are roughly normally distributed; NF4 places its 16 levels at normal quantiles so each level is used about equally, giving lower quantization error than uniform INT4 for the same bits.'}
  ],
  tradeoffs:`<ul><li><b>Memory vs speed</b>: QLoRA can cut base memory 4× but makes steps slower; when GPUs are available, LoRA finishes sooner.</li><li><b>Memory vs fidelity</b>: the gradient is computed through a quantized approximation of the base; usually fine, sometimes not — evaluate.</li><li><b>Simplicity</b>: QLoRA adds a dependency on quantization kernels and their GPU support.</li></ul>`,
  failures:`<ul><li><b>Merging the adapter into the 4-bit base</b> → quality regressions → merge into BF16.</li><li><b>Unsupported GPU/kernel combination</b> → import errors or very slow fallbacks → pin library versions in the training image and test in CI.</li><li><b>OOM despite QLoRA</b> → activations, not weights → gradient checkpointing, packing with shorter max length, smaller micro-batch.</li></ul>`,
  vocab:[
    {term:'NF4',def:'4-bit NormalFloat: a 4-bit data type with levels at normal-distribution quantiles, used to store frozen base weights in QLoRA.'},
    {term:'Double quantization',def:'Quantizing the per-block quantization scales themselves to save additional memory.'},
    {term:'Paged optimizer',def:'Optimizer state that can be paged between GPU and CPU memory to absorb spikes.'},
    {term:'Dequantization',def:'Converting stored low-bit weights back to a compute precision (BF16) just before the matmul.'},
    {term:'Gradient checkpointing',def:'Storing fewer activations and recomputing them in backward to save memory.'}
  ],
  mistakes:[
    'Saying QLoRA computes in 4-bit: storage is 4-bit, arithmetic is BF16.',
    'Assuming QLoRA is faster than LoRA: it is usually slower per step.',
    'Ignoring activations when claiming a 70B job "fits" on one GPU.',
    'Quoting an accuracy-loss percentage without having measured it.'
  ],
  related:['v1-finetuning','v1-quantization-speculative','v1-gpu-memory','v1-capstone-train']
},
{
  id:'trn-04', chapter:'v3-ch-training', difficulty:1,
  title:'How much GPU memory does a full fine-tune need?',
  understand:'A quantitative question. They want the 16 bytes per parameter derivation, awareness that activations are separate and can dominate, and a plan to fit a big model with sharding, checkpointing or offload. The trap is answering with inference memory (2 bytes per parameter).',
  short:'For mixed-precision training with Adam, each parameter costs about 16 bytes before activations: 2 for BF16 weights, 2 for BF16 gradients, 4 for an FP32 master copy and 4 each for Adam\'s two moment estimates. So an 8B model needs about 128 GB and a 70B model about 1.12 TB, plus activations, which grow with batch size, sequence length and depth. That never fits on one GPU, so I shard it with FSDP or ZeRO stage 3: 1.12 TB over 32 H100s is 35 GB each, leaving room for activations. Then I use gradient checkpointing to keep activations bounded, and if the full fine-tune is not essential, LoRA brings it to a single GPU.',
  detailed:`
${formula(`
STEP 1  Model states per parameter (mixed precision + Adam)
        BF16 weights        2 B
        BF16 gradients      2 B
        FP32 master weights 4 B
        Adam m (FP32)       4 B
        Adam v (FP32)       4 B
                          ─────
                           16 B

STEP 2  Totals
        8B   × 16 B = 128 GB
        70B  × 16 B = 1,120 GB = 1.12 TB

STEP 3  Shard with ZeRO-3 / FSDP over N GPUs (model states ÷ N)
        70B, N = 16 → 70 GB / GPU   → leaves ≈ 10 GB of an 80 GB H100: too tight
        70B, N = 32 → 35 GB / GPU   → ≈ 45 GB for activations, buffers, fragmentation
        8B,  N = 8  → 16 GB / GPU
`)}
<h3>Activations: the part people forget</h3>
<p>Backward needs intermediate results from the forward pass. Their size scales with micro-batch × sequence length × hidden size × layers (and attention implementation). At 8k+ sequence lengths they can exceed the model states. Levers:</p>
<ul><li><b>Gradient (activation) checkpointing</b>: keep only layer inputs, recompute the rest in backward. Costs roughly one extra forward pass of compute.</li>
<li><b>FlashAttention-style kernels</b>: avoid materialising the n × n attention matrix.</li>
<li><b>Smaller micro-batch + gradient accumulation</b>: same effective batch, less peak memory.</li>
<li><b>Sequence/context parallelism</b> for very long sequences.</li></ul>
<h3>What each sharding stage removes (ZeRO terminology)</h3>
${table(['Stage','Sharded across ranks','Per-GPU model-state memory (70B, N=32)'],[
 ['DDP (none)','nothing','1,120 GB → impossible'],
 ['ZeRO-1','optimizer states (12 B)','2+2 + 12/32 = 4.375 B/param → 306 GB'],
 ['ZeRO-2','+ gradients','2 + 14/32 = 2.4375 B/param → 171 GB'],
 ['ZeRO-3 / FSDP full shard','+ parameters','16/32 = 0.5 B/param → 35 GB']
])}
<p>ZeRO-3 is the only option that fits 70B, at the price of all-gathering parameters every forward and backward (≈1.5× DDP communication volume), which is why these jobs want NVLink inside the node and InfiniBand/EFA between nodes. CPU or NVMe offload (ZeRO-Offload/Infinity) can stretch further on fewer GPUs, trading step time for memory.</p>
<p>Compare inference of the same 70B in BF16: ≈ 140 GB of weights plus KV cache. Training is roughly 8× the weight memory before activations; there is no universal "4×" constant.</p>`,
  diagram:fig('Where 16 bytes per parameter go', svgDiagram({w:900,h:220,
    boxes:[
      {id:'w',x:20,y:70,w:110,h:70,label:'Weights',sub:'BF16 · 2 B',cls:'v1'},
      {id:'g',x:150,y:70,w:110,h:70,label:'Gradients',sub:'BF16 · 2 B',cls:'v2'},
      {id:'m',x:280,y:70,w:170,h:70,label:'FP32 master',sub:'4 B',cls:'warn'},
      {id:'a',x:470,y:70,w:170,h:70,label:'Adam m',sub:'4 B',cls:'warn'},
      {id:'v',x:660,y:70,w:170,h:70,label:'Adam v',sub:'4 B',cls:'warn'}
    ],
    notes:[{x:20,y:40,text:'Optimizer side = 12 of 16 bytes: this is what ZeRO-1 shards first and what LoRA almost eliminates.'},{x:20,y:180,text:'Activations are NOT in this bar: they scale with batch × sequence × hidden × layers.'}]
  }), 'Box widths are proportional to bytes per parameter.'),
  followups:[
    {q:'Why keep an FP32 master copy at all?',a:'Updates are tiny relative to weights; adding them in BF16 (8-bit mantissa) would round many to zero. Accumulating in FP32 preserves small updates; the BF16 copy is refreshed from it for compute.'},
    {q:'Could an 8-bit optimizer change the maths?',a:'Yes: 8-bit Adam states cut m and v from 8 B to about 2 B per parameter, so model states fall to roughly 10 B/param. Validate convergence; it is a quality trade.'},
    {q:'Your 70B job fits on 32 GPUs but is slow. What do you check?',a:'Communication share of step time (all-gather/reduce-scatter in the profiler), whether shards cross slow links, whether activation checkpointing is over-applied, MFU versus expectation, and data-loader stalls. Hybrid sharding (shard within node, replicate across nodes) often cuts inter-node traffic.'},
    {q:'How do you estimate activation memory without running it?',a:'You can approximate per layer as a constant × micro-batch × sequence × hidden × bytes, but constants depend on attention kernel and checkpointing policy. In practice: run a few steps at target shapes with torch.cuda.max_memory_allocated() and scale. Measurement beats formulas here.'}
  ],
  tradeoffs:`<ul><li><b>More GPUs (sharding)</b> fits anything but adds communication; efficiency falls if interconnect is weak.</li><li><b>Offload to CPU/NVMe</b> fits on fewer GPUs, makes steps much slower.</li><li><b>Activation checkpointing</b> saves memory for ~one extra forward of compute.</li><li><b>LoRA/QLoRA</b> removes most optimizer memory but limits how far the model can move.</li></ul>`,
  failures:`<ul><li><b>OOM at step 1</b> → model states don't fit → raise shard count or enable full sharding.</li><li><b>OOM after hours</b> → a long-sequence batch or fragmentation → cap max length, set PyTorch allocator expandable segments, log peak memory per step.</li><li><b>Fits but MFU very low</b> → communication-bound → check topology, hybrid sharding, larger micro-batch.</li></ul>`,
  vocab:[
    {term:'Mixed precision',def:'Compute in BF16/FP16 while keeping FP32 master weights for numerically stable updates.'},
    {term:'ZeRO stages',def:'DeepSpeed sharding levels: 1 = optimizer states, 2 = + gradients, 3 = + parameters.'},
    {term:'FSDP',def:'PyTorch Fully Sharded Data Parallel; full sharding is equivalent in spirit to ZeRO-3.'},
    {term:'Activation checkpointing',def:'Recomputing activations during backward instead of storing them.'},
    {term:'Gradient accumulation',def:'Summing gradients over several micro-batches before an optimizer step to reach a large effective batch.'},
    {term:'MFU',def:'Model FLOPs utilization: achieved model FLOPs per second divided by hardware peak.'}
  ],
  mistakes:[
    'Answering 2 bytes per parameter (inference weights) for a training question.',
    'Forgetting activations, then being surprised by OOM at long sequence length.',
    'Using sparsity-inflated TFLOPS figures when estimating step time.',
    'Quoting "training needs 4× inference memory" as a universal constant.'
  ],
  related:['v1-gpu-memory','v2-distributed-training','v2-parallelism','v1-training-loop']
},
{
  id:'trn-05', chapter:'v3-ch-training', difficulty:3,
  title:'DPO versus RLHF: what is the difference and which would you run?',
  understand:'They want to know whether you understand preference optimization as a pipeline and an infrastructure problem: what data it needs, how many models sit in memory, how stable it is, and when online RL is still worth it.',
  short:'Both start from a supervised fine-tuned model and use human or AI preference data, pairs of a better and a worse answer to the same prompt. Classic RLHF trains a separate reward model on those pairs, then optimizes the policy with an RL algorithm like PPO, generating fresh answers, scoring them, and keeping a KL penalty to a frozen reference model. That means four models in play and online generation, which is expensive and finicky. DPO skips the reward model and RL loop: it uses a closed-form loss directly on the preference pairs, with only the policy and a frozen reference. As a platform engineer I would start with DPO because it looks like ordinary supervised training, and move to online RL only if evaluation shows we need exploration beyond the collected pairs.',
  detailed:`
<h3>Common starting point</h3>
<p>Both methods start from an SFT model and a preference dataset of triples (prompt x, chosen y_w, rejected y_l). The goal is to raise the probability of chosen answers relative to rejected ones without drifting too far from the SFT model.</p>
<h3>RLHF with PPO (InstructGPT-style pipeline)</h3>
<ol><li>Train a <b>reward model</b> r(x, y) on preference pairs.</li>
<li>Loop: the <b>policy</b> generates answers online; the reward model scores them; a <b>value model</b> (critic) estimates baselines; PPO updates the policy with a KL penalty against a frozen <b>reference</b> model.</li></ol>
<p>Infrastructure shape: up to four large models (policy, reference, reward, value), interleaved generation (inference) and training phases, and sensitivity to hyperparameters and reward hacking (the policy exploits flaws in the reward model).</p>
<h3>DPO (Rafailov et al., 2023, arXiv 2305.18290)</h3>
<p>DPO shows the KL-constrained RLHF objective has a closed-form optimal policy, so you can optimize preferences directly with a classification-style loss:</p>
${formula(`
                         π_θ(y_w|x)            π_θ(y_l|x)
L_DPO = − log σ( β · [ log ─────────── − log ─────────── ] )
                         π_ref(y_w|x)          π_ref(y_l|x)

   β     = how strongly to stay near the reference
   π_ref = frozen SFT model (log-probs can be precomputed once)
`)}
${table(['','PPO-based RLHF','DPO'],[
 ['Models in memory','policy, reference, reward, value (≈4)','policy + reference (2; reference log-probs can be cached → ≈1)'],
 ['Data','preferences for reward model + prompts for online rollouts','offline preference pairs only'],
 ['Generation during training','yes (online)','no'],
 ['Stability / tuning','harder; reward hacking risk','close to SFT; fewer knobs'],
 ['Exploration beyond dataset','yes','no; limited to the pairs you have']
])}
<h3>Memory example (illustrative, 8B, full fine-tune)</h3>
${formula(`
Policy trained         : 16 B/param × 8 × 10⁹  = 128 GB (sharded)
Frozen reference BF16  :  2 B/param × 8 × 10⁹  =  16 GB
PPO adds reward + value: value is trained (≈ +128 GB), reward frozen (+16 GB)

DPO ≈ 144 GB of model states   vs   PPO ≈ 288 GB before activations and rollouts
`)}
<p>With LoRA, DPO gets even cheaper: the reference is simply the base with the adapter disabled, so one copy of weights serves both.</p>
<p>Newer online methods (for example group-relative policy optimization variants used for reasoning models) drop the value model and score groups of sampled answers, often with verifiable rewards such as unit tests or exact-match maths. Describe them as a family and do not quote results you have not measured.</p>`,
  diagram:fig('PPO-RLHF versus DPO: what runs during training', svgDiagram({w:900,h:300,
    zones:[{x:10,y:10,w:520,h:280,label:'PPO-based RLHF'},{x:550,y:10,w:340,h:280,label:'DPO',cls:'ok'}],
    boxes:[
      {id:'p',x:30,y:50,w:140,h:56,label:'Policy',sub:'trained',cls:'hl'},
      {id:'g',x:200,y:50,w:140,h:56,label:'Rollouts',sub:'online generation',cls:'warn'},
      {id:'r',x:370,y:50,w:140,h:56,label:'Reward model',sub:'frozen',cls:'v2'},
      {id:'v',x:200,y:170,w:140,h:56,label:'Value model',sub:'trained',cls:'v2'},
      {id:'ref',x:30,y:170,w:140,h:56,label:'Reference',sub:'frozen, KL',cls:'x'},
      {id:'dp',x:570,y:50,w:140,h:56,label:'Policy',sub:'trained',cls:'hl'},
      {id:'dr',x:730,y:50,w:140,h:56,label:'Reference',sub:'frozen',cls:'x'},
      {id:'dd',x:640,y:170,w:170,h:56,label:'Preference pairs',sub:'offline dataset',cls:'v1'}
    ],
    arrows:[{from:'p',to:'g'},{from:'g',to:'r',label:'score'},{from:'v',to:'p',label:'advantage'},{from:'ref',to:'p',label:'KL'},{from:'dd',to:'dp'},{from:'dd',to:'dr'}]
  }), 'DPO turns an RL system into something that looks like supervised training on pairs.'),
  followups:[
    {q:'Where do preference pairs come from?',a:'Human raters comparing two answers, AI feedback from a stronger judge model with a rubric, or implicit product signals (accepted vs edited answer). Each needs quality control: rater agreement, judge calibration on a human-labelled subset, and dedup against eval sets.'},
    {q:'What is reward hacking and does DPO avoid it?',a:'The policy finds outputs that score high on the reward model but are not actually better (verbosity, flattery). DPO has no separate reward model to exploit, but it can still overfit to dataset artefacts such as length bias in chosen answers; check length and style distributions.'},
    {q:'When is online RL worth the cost?',a:'When you have a cheap, reliable reward (unit tests, exact answers, tool success) and need the model to explore beyond existing data, as in reasoning or coding agents. For tone and policy adherence, offline DPO on good pairs is usually enough.'},
    {q:'How would you build the platform for PPO-style training?',a:'Separate generation (an inference engine such as vLLM for rollouts) from training (FSDP), sync weights between them each iteration, schedule as a gang on the same topology, checkpoint all trained models, and track reward, KL and eval metrics per iteration. Frameworks exist for this; I would evaluate one rather than build it.'}
  ],
  tradeoffs:`<ul><li><b>DPO</b>: simple, cheap, stable, offline; bounded by dataset coverage.</li><li><b>PPO/online RL</b>: can exceed the dataset, works with programmatic rewards; complex, expensive, needs inference + training co-scheduling.</li><li><b>β</b>: larger keeps close to reference (safer, less change); smaller allows more movement (risk of degenerate outputs).</li></ul>`,
  failures:`<ul><li><b>Chosen answers are systematically longer</b> → model becomes verbose → length-balanced pairs, monitor output length.</li><li><b>Reference mismatch</b> (different tokenizer or template from SFT) → unstable loss → pin and verify the reference checkpoint.</li><li><b>PPO divergence</b> → KL explodes, reward climbs, eval falls → stronger KL, lower LR, reward-model refresh.</li></ul>`,
  vocab:[
    {term:'Preference pair',def:'Two responses to the same prompt labelled chosen and rejected.'},
    {term:'Reward model',def:'A model trained to score responses so that chosen answers score higher.'},
    {term:'KL penalty',def:'A term that penalises the policy for drifting from the reference model distribution.'},
    {term:'PPO',def:'Proximal Policy Optimization: an RL algorithm with clipped policy updates, used in classic RLHF.'},
    {term:'DPO',def:'Direct Preference Optimization: a closed-form loss on preference pairs with a frozen reference, no reward model or RL loop.'},
    {term:'Reward hacking',def:'Policy exploiting reward-model flaws to score high without real improvement.'}
  ],
  mistakes:[
    'Saying DPO needs a reward model.',
    'Saying RLHF and DPO replace SFT; both normally start from an SFT model.',
    'Ignoring infrastructure: PPO needs online generation and several models, DPO does not.',
    'Quoting benchmark wins for one method without evidence.'
  ],
  related:['v1-finetuning','v2-evaluation-monitoring','v2-distributed-training']
},
{
  id:'trn-06', chapter:'v3-ch-training', difficulty:3,
  title:'A node dies in the middle of a 256-GPU training run. How does the job recover?',
  understand:'This is your home ground as an infrastructure engineer. They want failure detection, checkpoint contents, restart mechanics, bad-node isolation and the economics of checkpoint frequency, not just "we restart from a checkpoint".',
  short:'In a synchronous job, one dead GPU does not crash the others; they hang in the next collective until the NCCL or process-group timeout fires. So recovery is a pipeline: detect quickly with timeouts and health checks, abort the whole group, isolate the bad node by cordoning it and pulling evidence like Xid errors, replace it with a spare, then restart all ranks from the last complete checkpoint. That checkpoint must include model and optimizer shards, scheduler, RNG and data-loader position, or the resumed run is not the same run. I choose the interval from the save cost and failure rate, Young\'s rule, and make saves asynchronous and sharded so frequent checkpoints are cheap. I measure goodput, the share of GPU-hours that produced kept progress.',
  detailed:`
<h3>Why a failure looks like a hang</h3>
<p>Data-parallel and FSDP steps end in collectives (all-reduce, reduce-scatter, all-gather). Every rank must participate. If node 2's GPU falls off the bus (Xid 79) or its process deadlocks, the other ranks block. Without timeouts and watchdogs the job burns all 256 GPUs doing nothing.</p>
<h3>Recovery pipeline</h3>
<ol><li><b>Detect</b>: NCCL / process-group timeout, heartbeat from the launcher's agent, DCGM health and Xid alerts, and a "no step progress for N minutes" alert on the training-metrics stream.</li>
<li><b>Abort the group</b>: a torchrun-style elastic agent tears down and restarts the worker group (it can tolerate membership changes within configured min/max nodes).</li>
<li><b>Isolate</b>: cordon and drain the node, collect evidence (Xid, ECC, NVLink errors, dmesg), run diagnostics before readmitting. Restarting onto the same GPU just repeats the failure.</li>
<li><b>Replace</b>: hot spare nodes or a smaller world size if the job tolerates it (global batch and LR schedule must be handled deliberately).</li>
<li><b>Restore</b>: load the latest <i>complete</i> checkpoint (all shards plus a commit marker), verify config, world size and data version, fast-forward the data loader.</li></ol>
<h3>What a checkpoint must contain</h3>
<p>Model shards, optimizer state (Adam moments are 8 of the 16 bytes per parameter), LR scheduler, step and token counters, RNG states, data-sampler position, gradient-scaler state if FP16, and metadata (code commit, data version, config). Weights alone restart the optimizer cold and change the run.</p>
<h3>How often to checkpoint</h3>
${formula(`
Young's approximation       τ ≈ √(2 · C · M)
    C = time the job is blocked saving, M = mean time between job failures

Expected overhead ≈ C/τ  +  τ/(2M)  (+ restart time per failure)
                    ↑ saving   ↑ average lost work

Illustrative: C = 2 min, M = 480 min
    τ = √(2 × 2 × 480) = √1,920 ≈ 43.8 min
    overhead ≈ 2/43.8 + 43.8/960 ≈ 4.6 % + 4.6 % ≈ 9.1 %

Async sharded save, blocking part C = 0.2 min
    τ = √(2 × 0.2 × 480) = √192 ≈ 13.9 min
    overhead ≈ 0.2/13.9 + 13.9/960 ≈ 1.4 % + 1.4 % ≈ 2.9 %
`)}
<p>M shrinks as the job grows: if each node fails independently, a job on twice as many nodes fails roughly twice as often. That is why large runs invest in async, sharded, local-then-remote checkpoints (write to node-local NVMe, upload to object storage in the background) and fast restart paths.</p>
${fig('Recovery is a control loop, not a button', svgDiagram({w:900,h:200,
    boxes:[
      {id:'d',x:20,y:70,w:140,h:60,label:'Detect',sub:'timeouts, Xid, no-progress',cls:'warn'},
      {id:'a',x:190,y:70,w:130,h:60,label:'Abort group',sub:'elastic agent',cls:'v2'},
      {id:'i',x:350,y:70,w:140,h:60,label:'Isolate node',sub:'cordon + evidence',cls:'bad'},
      {id:'r',x:520,y:70,w:130,h:60,label:'Replace',sub:'hot spare',cls:'v1'},
      {id:'s',x:680,y:70,w:200,h:60,label:'Restore + resume',sub:'all shards + data position',cls:'ok'}
    ],
    arrows:[{from:'d',to:'a'},{from:'a',to:'i'},{from:'i',to:'r'},{from:'r',to:'s'}]
  }), 'Every arrow has a time cost; goodput is what remains after detection, restart and lost work.')}`,
  diagram:anim('v3q-trn-recovery'),
  followups:[
    {q:'How do you know a checkpoint is complete and not half-written?',a:'Write shards to a step directory, then write a commit marker (or manifest with checksums) last, atomically. On restore, pick the newest step with a valid marker. Never overwrite the previous good checkpoint in place.'},
    {q:'Silent data corruption: no crash, but loss diverges on one run. How would you catch a bad GPU?',a:'Watch for per-rank anomalies (one rank\'s gradient norm or loss off pattern), run periodic deterministic health kernels or replay a fixed batch and compare results across nodes, and track ECC/Xid. Isolate suspicious nodes and roll back to a checkpoint before the anomaly.'},
    {q:'Can you resume with fewer GPUs?',a:'With sharded checkpoint formats that support resharding (for example PyTorch distributed checkpoint), yes. You must decide whether to keep the global batch by increasing accumulation steps (preferred; keeps the LR schedule valid) or accept a changed batch.'},
    {q:'Your goodput is 70 %. Where is the other 30 %?',a:'Break it down from logs: checkpoint blocking time, lost work since last checkpoint, detection latency (timeouts too long), scheduling and image pull time on restart, data-loader warm-up, and straggler slowdowns. Then attack the biggest bucket: async saves, shorter detection, pre-pulled images, spares.'}
  ],
  tradeoffs:`<ul><li><b>Frequent checkpoints</b>: less lost work, more save overhead and storage cost.</li><li><b>Short NCCL timeouts</b>: faster detection, more false aborts during slow but healthy collectives (for example a long checkpoint on one rank).</li><li><b>Hot spares</b>: idle GPUs cost money but cut restart time from scheduling-bound to seconds.</li><li><b>Elastic shrink</b>: keeps running but complicates reproducibility.</li></ul>`,
  failures:`<ul><li><b>Job hangs for hours</b> → no timeout or watchdog → set process-group timeout and a no-progress alert.</li><li><b>Restart lands on the same bad node</b> → repeated failure loop → cordon automatically on Xid 79/48/95 etc.</li><li><b>Resumed loss curve jumps</b> → optimizer or data position not restored → include full state and verify with a resume test in CI.</li><li><b>Checkpoint storage throttled</b> → saves take far longer at scale → stagger or write locally then upload asynchronously.</li></ul>`,
  vocab:[
    {term:'Collective',def:'A communication operation (all-reduce, all-gather, reduce-scatter) in which every rank participates.'},
    {term:'NCCL timeout',def:'Time after which a blocked collective is declared failed so the job can abort instead of hanging.'},
    {term:'Elastic training',def:'A launcher that restarts worker groups and tolerates membership changes within limits.'},
    {term:'Goodput (training)',def:'Fraction of allocated GPU time that produced progress kept in the final model.'},
    {term:'Young\'s formula',def:'τ ≈ √(2·C·M): checkpoint interval that roughly minimises save cost plus expected lost work.'},
    {term:'Commit marker',def:'A file written last to declare a checkpoint complete and safe to restore.'}
  ],
  mistakes:[
    'Saying "the job crashes" when the real symptom is a hang in a collective.',
    'Checkpointing weights only and losing optimizer and data-loader state.',
    'Raising timeouts to "fix" hangs, which only delays detection.',
    'Restarting without isolating the faulty node.'
  ],
  related:['v2-distributed-training','v1-training-loop','v1-k8s-gpu-stack','v2-aiops']
},
{
  id:'trn-07', chapter:'v3-ch-training', difficulty:2,
  title:'Explain DDP, FSDP/ZeRO, tensor and pipeline parallelism by what they shard and communicate.',
  understand:'They want a crisp mental model: every parallelism strategy is a choice of what to split, and every split has a communication pattern with a bandwidth requirement. Being able to map that to topology (NVLink inside the node, InfiniBand/EFA across) is the senior signal.',
  short:'Data parallelism copies the whole model to every GPU, gives each a different slice of the batch, and all-reduces gradients every step: simplest, but every GPU must hold the full model and optimizer. FSDP or ZeRO-3 keeps data parallelism but shards parameters, gradients and optimizer state, all-gathering parameters just in time for each layer and reduce-scattering gradients, so memory per GPU drops roughly by the number of GPUs at about one and a half times the communication. Tensor parallelism splits individual matrix multiplications across GPUs and communicates inside every layer, so it needs NVLink and stays within a node. Pipeline parallelism splits layers into stages and passes activations between them, with idle bubbles that micro-batching reduces. Large jobs combine them, tensor inside the node, pipeline or FSDP across nodes.',
  detailed:`
${table(['Strategy','What is split','Communication','Frequency','Placement'],[
 ['DDP','batch only (model replicated)','all-reduce of gradients','once per step (overlapped with backward)','any; tolerates slower links'],
 ['FSDP / ZeRO-3','batch + params, grads, optimizer state','all-gather params (fwd and bwd) + reduce-scatter grads','per layer, per step','fast intra-node; hybrid sharding across nodes'],
 ['Tensor parallel (TP)','individual weight matrices (columns/rows)','all-reduce (or all-gather) of activations','twice per transformer layer, every forward and backward','inside one NVLink domain'],
 ['Pipeline parallel (PP)','layers into stages','point-to-point activations / grads between stages','per micro-batch','across nodes is fine'],
 ['Expert parallel (EP)','MoE experts across GPUs','all-to-all token routing','per MoE layer','high-bandwidth fabric'],
 ['Context / sequence parallel','sequence dimension','exchange of K/V blocks or activations','per attention layer','fast links']
])}
<h3>Communication volume intuition</h3>
${formula(`
DDP ring all-reduce of G bytes of gradients over N GPUs
    bytes sent per GPU ≈ 2 × (N − 1)/N × G  ≈ 2G

FSDP / ZeRO-3: all-gather (fwd) + all-gather (bwd) + reduce-scatter (grads)
    ≈ 3 × (N − 1)/N × P  ≈ 1.5 × DDP volume

Example: 8B model, BF16 gradients G = 16 GB
    DDP sends ≈ 32 GB per GPU per step
    at 900 GB/s NVLink (H100, theoretical) ≈ 36 ms; across 400 Gb/s ≈ 50 GB/s ≈ 0.64 s
                                                 ↑ why topology decides strategy
`)}
<h3>3D (and 4D) parallelism</h3>
<p>For very large models: TP within an 8-GPU NVLink node, PP across a few nodes, and data parallel / FSDP across the rest. MoE adds EP. The design rule is <b>put the chattiest dimension on the fastest link</b>.</p>
<p>In PyTorch today, FSDP2 (<code>torch.distributed.fsdp.fully_shard</code>, documented in 2.14) is the recommended FSDP API; the older <code>FullyShardedDataParallel</code> has no formal deprecation notice but the docs suggest migrating (as of Oct 2026). DeepSpeed ZeRO offers the same idea with stages 1–3 plus offload.</p>`,
  diagram:fig('Put the chattiest split on the fastest link', svgDiagram({w:900,h:300,
    zones:[{x:10,y:30,w:420,h:250,label:'Node A: 8 GPUs over NVLink'},{x:470,y:30,w:420,h:250,label:'Node B: 8 GPUs over NVLink'}],
    boxes:[
      {id:'tp',x:40,y:70,w:360,h:60,label:'Tensor parallel group (TP = 8)',sub:'all-reduce every layer',cls:'hl'},
      {id:'tp2',x:500,y:70,w:360,h:60,label:'Tensor parallel group (TP = 8)',sub:'all-reduce every layer',cls:'hl'},
      {id:'s1',x:40,y:180,w:360,h:60,label:'Pipeline stage 1 (layers 1–40)',cls:'v2'},
      {id:'s2',x:500,y:180,w:360,h:60,label:'Pipeline stage 2 (layers 41–80)',cls:'v2'}
    ],
    arrows:[{from:'s1',to:'s2',label:'activations over IB/EFA'}]
  }), 'TP stays inside the node; pipeline or data-parallel traffic crosses nodes, where bandwidth is an order of magnitude lower.'),
  followups:[
    {q:'Why not use tensor parallelism across nodes?',a:'TP communicates activations twice per layer in every forward and backward pass, on the critical path. Inter-node links are roughly an order of magnitude slower than NVLink, so step time becomes communication-bound.'},
    {q:'What is the pipeline bubble and how do you shrink it?',a:'Stages wait for each other at the start and end of a batch. With p stages and m micro-batches, idle fraction is about (p − 1)/(m + p − 1). More micro-batches or interleaved schedules shrink it.'},
    {q:'When would you pick plain DDP over FSDP?',a:'When model + optimizer fit comfortably in one GPU (small models, or LoRA). DDP has the least communication and simplest debugging.'},
    {q:'How does hybrid sharding help?',a:'Shard within a node (fast all-gathers on NVLink) and replicate across nodes (only gradient all-reduce crosses the slow links). Memory saving is limited to the node size, but inter-node traffic drops a lot.'}
  ],
  tradeoffs:`<ul><li><b>Memory vs communication</b>: every additional thing you shard saves memory and adds traffic.</li><li><b>TP</b> lowers per-GPU memory and latency per step but needs NVLink.</li><li><b>PP</b> tolerates slow links but adds bubbles and complex scheduling.</li><li><b>Debuggability</b>: DDP is easiest; 3D parallelism needs strong tooling.</li></ul>`,
  failures:`<ul><li><b>Collective hangs</b> → a rank diverged in control flow or died → timeouts, check all ranks reach the same collective.</li><li><b>Low MFU</b> → communication not overlapped or crossing slow links → profile, adjust group placement.</li><li><b>Topology-unaware scheduling</b> on Kubernetes → TP group split across nodes → gang scheduling with topology-aware placement (for example Kueue TAS).</li></ul>`,
  vocab:[
    {term:'All-reduce',def:'Every rank ends with the sum (or average) of all ranks\' tensors.'},
    {term:'All-gather',def:'Every rank ends with the concatenation of all ranks\' shards.'},
    {term:'Reduce-scatter',def:'Sum across ranks, then each rank keeps one shard of the result.'},
    {term:'Pipeline bubble',def:'Idle time in pipeline parallelism while stages fill and drain.'},
    {term:'Hybrid sharding',def:'Shard within a group (node), replicate across groups.'},
    {term:'3D parallelism',def:'Combining data, tensor and pipeline parallelism in one job.'}
  ],
  mistakes:[
    'Saying FSDP removes communication bottlenecks; it adds communication.',
    'Placing tensor parallelism across nodes.',
    'Confusing pipeline parallelism (layers) with tensor parallelism (inside a matmul).',
    'Ignoring that DDP requires the full optimizer state on every GPU.'
  ],
  related:['v2-parallelism','v2-distributed-training','v1-multi-gpu-profiling']
},
{
  id:'trn-08', chapter:'v3-ch-training', difficulty:1,
  title:'How do you design a reliable training data pipeline?',
  understand:'They test whether you treat data as a versioned, validated artifact with lineage, the same way you treat container images. Leakage, contamination, deduplication and PII are the keywords that show experience.',
  short:'I treat training data like a build artifact. Every source has provenance and a licence; ingestion validates schema and quality; I deduplicate exactly and near-duplicate, filter or redact personal data, and check language and length distributions. I split train, validation and test by an entity such as customer or conversation, not by row, so nothing leaks across splits, and I check that evaluation and public benchmark items are not in the training set. Each dataset snapshot is immutable and versioned, and its ID is recorded with the training run and the model in the registry, so any model can be traced back to the exact data that produced it.',
  detailed:`
<h3>Pipeline stages</h3>
<ol><li><b>Ingest with provenance</b>: source, owner, licence, collection date, consent basis. Reject sources without a basis to use them.</li>
<li><b>Validate</b>: schema (fields present, roles valid in chat data), encoding, language ID, length outliers, empty or truncated answers. Tools like Great Expectations or Soda can express these as tests.</li>
<li><b>Clean</b>: normalise whitespace and Unicode (Arabic text has multiple normalisation pitfalls such as different forms of the same letter — define a policy), strip HTML, fix templates.</li>
<li><b>Deduplicate</b>: exact hashes, then near-duplicate detection (for example MinHash). Duplicates over-weight some examples and cause memorisation.</li>
<li><b>PII and secrets</b>: detect and redact or drop (names, phone numbers, passport numbers, booking references, API keys). Keep a report.</li>
<li><b>Split without leakage</b>: group by customer/conversation/ticket thread, then split. Time-based split when you care about future performance.</li>
<li><b>Decontaminate</b>: remove items overlapping evaluation sets (n-gram overlap) so offline scores are honest.</li>
<li><b>Version and register</b>: immutable snapshot (DVC, lakeFS, Delta tables or content-addressed object storage), with a dataset card; record the version ID in the experiment tracker and model registry.</li></ol>
${formula(`
Leakage example (why split by entity)
    10,000 tickets from 2,000 customers, random row split 80/20
    → most test customers also appear in train
    → model memorises customer-specific phrasing, test score inflated
Split by customer: 1,600 customers train, 400 test → honest estimate
`)}
<p>The lab <code>labs/03-finetune/make_dataset.py</code> builds a synthetic travel-support dataset and splits by customer for exactly this reason.</p>
<h3>Data quality gates in CI</h3><p>Treat dataset builds like software builds: a pipeline that fails on schema violations, PII detector hits above a threshold, duplicate rate above a threshold, language mix outside expected bounds, or eval-set overlap. Publish a data report (counts by source, language, intent; filter drop rates) as a build artifact. Reviewers approve dataset versions the way they approve code, and the training job refuses to start on an unapproved version.</p>`,
  diagram:fig('Data as a versioned artifact with lineage', svgDiagram({w:900,h:220,
    boxes:[
      {id:'s',x:20,y:80,w:120,h:60,label:'Sources',sub:'licence, owner',cls:'v1'},
      {id:'v',x:170,y:80,w:120,h:60,label:'Validate',sub:'schema, lang',cls:'v2'},
      {id:'c',x:320,y:80,w:130,h:60,label:'Dedup + PII',sub:'exact, near-dup',cls:'warn'},
      {id:'sp',x:480,y:80,w:130,h:60,label:'Split by entity',sub:'+ decontaminate',cls:'hl'},
      {id:'snap',x:640,y:80,w:120,h:60,label:'Snapshot',sub:'immutable ID',cls:'ok'},
      {id:'run',x:790,y:80,w:100,h:60,label:'Run + model',sub:'lineage',cls:'v3'}
    ],
    arrows:[{from:'s',to:'v'},{from:'v',to:'c'},{from:'c',to:'sp'},{from:'sp',to:'snap'},{from:'snap',to:'run'}]
  }), 'Lineage lets you answer: which data produced the model that is in production right now?'),
  followups:[
    {q:'How do you detect benchmark contamination?',a:'Normalise text and compute n-gram (for example 13-gram) or embedding-similarity overlap between training data and each eval set; remove or flag hits and report the contamination rate with the eval results.'},
    {q:'A regression appears after retraining. How does lineage help?',a:'Diff the two dataset versions: new sources, changed filters, distribution shifts by language or intent. Retrain on the old data with the new code (and vice versa) to isolate whether code or data caused it.'},
    {q:'How do you handle a deletion request for someone\'s data used in training?',a:'Remove from source and future snapshots immediately; record it. For models already trained, the policy may require retraining from a snapshot without the data, which is why lineage and snapshot boundaries matter. Get legal guidance on obligations rather than improvising.'}
  ],
  tradeoffs:`<ul><li><b>Aggressive filtering</b> raises quality but can remove rare but important cases (for example Arabic dialect tickets).</li><li><b>Near-dedup thresholds</b>: too loose keeps duplicates, too tight removes legitimate variants.</li><li><b>Synthetic data</b> scales cheaply but inherits the generator's biases; keep a human-labelled eval set.</li></ul>`,
  failures:`<ul><li><b>Inflated eval scores</b> → leakage or contamination → entity split, decontamination.</li><li><b>Model outputs phone numbers from training data</b> → PII not redacted → redaction plus memorisation tests.</li><li><b>Cannot reproduce a model</b> → dataset was mutable → immutable snapshots referenced by ID.</li></ul>`,
  vocab:[
    {term:'Data leakage',def:'Information from the evaluation split appearing in training, inflating scores.'},
    {term:'Contamination',def:'Benchmark or eval items present in training data.'},
    {term:'Near-duplicate detection',def:'Finding highly similar documents (for example MinHash/LSH), not just exact copies.'},
    {term:'Provenance',def:'Recorded origin, owner and licence of each data source.'},
    {term:'Dataset card',def:'Documentation of a dataset\'s contents, intended use, filters and known limitations.'}
  ],
  mistakes:[
    'Random row splits for data with repeated entities.',
    'Treating "the job ran" as proof the data is good.',
    'Mutable datasets with no version recorded in the training run.',
    'Forgetting licences and consent for scraped or customer data.'
  ],
  related:['v1-data-pipelines','v2-mlops-foundations','v2-model-cicd']
},
{
  id:'trn-09', chapter:'v3-ch-training', difficulty:2,
  title:'Training loss keeps going down but the model is getting worse. What is happening?',
  understand:'A diagnosis question. They want a list of concrete causes ranked by likelihood and the evidence that distinguishes them, not "overfitting" alone.',
  short:'Training loss only says the model is fitting the training data. Several things make that diverge from quality. Overfitting shows as validation loss rising while training loss falls. Catastrophic forgetting shows as the target task improving while general abilities drop. Very often it is a formatting bug: the chat template at training time differs from the one at serving time, or we computed loss on the prompt tokens too, so the model learned to imitate users. And the evaluation itself might be contaminated or measuring the wrong thing. I would look at held-out loss, task metrics sliced by type and language, a general-capability regression suite, and a handful of outputs side by side before changing hyperparameters.',
  detailed:`
${table(['Cause','Distinguishing evidence','Fix'],[
 ['Overfitting','validation loss turns up while train loss falls; outputs echo training examples','early stopping on validation, fewer epochs, more/diverse data, lower LR or rank'],
 ['Catastrophic forgetting','target eval up, general eval (reasoning, safety, other languages) down','LoRA or lower LR, mix in general data, shorter training'],
 ['Chat-template mismatch','great in the training notebook, bad behind the serving engine','use tokenizer.apply_chat_template in both places; test the served prompt string'],
 ['Loss on prompt tokens','model starts writing user-style text or repeating questions','train on assistant tokens only'],
 ['Data quality / shortcuts','metric gains on easy slices, failure on real traffic','slice analysis; inspect samples; dedup; fix labels'],
 ['Eval contamination or wrong metric','offline score high, human review poor','decontaminate; task-specific rubric; human spot-checks'],
 ['Packing / truncation bugs','answers cut off or merged across examples','check max length, packing boundaries and attention masks']
])}
<h3>Loss masking in current tooling</h3>
<p>In TRL (v1.15 as of Oct 2026) <code>SFTConfig</code> has <code>assistant_only_loss</code> (default False; conversational datasets; requires a chat template with generation markers, which TRL patches for known families) and <code>completion_only_loss</code> (default None, meaning completion-only for prompt-completion datasets). The older <code>DataCollatorForCompletionOnlyLM</code> is no longer in the current docs. Defaults matter: with assistant_only_loss off for a chat dataset, the model learns from user turns too.</p>
${formula(`
Masked SFT loss over a conversation
            1
    L = − ───── Σ  log p(tᵢ | t₍<ᵢ₎)       over assistant tokens only
           |A|  i∈A
    ↑ A = set of assistant-token positions; user/system tokens get label −100 (ignored)
`)}
<h3>Triage order</h3>
<ol><li>Plot train vs validation loss on the same axis.</li><li>Render the exact prompt string used in training and at serving; diff them.</li><li>Run the target eval and a general regression suite, sliced by language (Arabic/English) and intent.</li><li>Read 20 outputs side by side with the base model.</li><li>Only then tune hyperparameters.</li></ol>
<p>Interview framing: name the cheapest check first ("I would diff the training and serving prompt strings"), because a template or masking bug is common, cheap to find, and invalidates every other experiment.</p>`,
  diagram:fig('Same falling training loss, different stories', svgDiagram({w:900,h:240,
    boxes:[
      {id:'t',x:20,y:90,w:170,h:60,label:'Train loss ↓',sub:'always looks good',cls:'ok'},
      {id:'v',x:260,y:20,w:200,h:56,label:'Val loss ↑',sub:'overfitting',cls:'bad'},
      {id:'g',x:260,y:92,w:200,h:56,label:'General eval ↓',sub:'forgetting',cls:'bad'},
      {id:'s',x:260,y:164,w:200,h:56,label:'Served output odd',sub:'template / masking',cls:'bad'},
      {id:'f1',x:540,y:20,w:330,h:56,label:'Early stop, more data, lower LR',cls:'v2'},
      {id:'f2',x:540,y:92,w:330,h:56,label:'LoRA, mix general data, fewer steps',cls:'v2'},
      {id:'f3',x:540,y:164,w:330,h:56,label:'Same chat template, assistant-only loss',cls:'v2'}
    ],
    arrows:[{from:'t',to:'v'},{from:'t',to:'g'},{from:'t',to:'s'},{from:'v',to:'f1'},{from:'g',to:'f2'},{from:'s',to:'f3'}]
  }), 'Each cause has its own evidence; check the cheap ones (template diff, masking) first.'),
  followups:[
    {q:'Validation loss also goes down but users complain. Now what?',a:'Loss measures token likelihood on your data distribution, not task success on real traffic. Compare training data distribution with production prompts (intents, languages, lengths), and run task-level metrics and human review on a sample of real traffic.'},
    {q:'How do you detect catastrophic forgetting before release?',a:'Keep a fixed general regression suite (instruction following, safety refusals, reasoning, other languages) and gate on "no significant drop vs base", alongside the target-task gain.'},
    {q:'What is NEFTune or label smoothing, and would you reach for them here?',a:'They are regularisers (noise on embeddings, softened targets). They are second-order knobs; I would fix data, template and masking first, then experiment with regularisation using the same eval.'}
  ],
  tradeoffs:`<ul><li><b>More epochs</b>: better fit, higher risk of overfitting and forgetting.</li><li><b>Higher LoRA rank / LR</b>: faster adaptation, more forgetting.</li><li><b>Mixing general data</b>: preserves capabilities, dilutes the target signal.</li></ul>`,
  failures:`<ul><li><b>Model replies with "User:" lines</b> → loss on user turns or template mismatch.</li><li><b>Arabic quality collapses after English-only SFT</b> → forgetting → bilingual data mix and per-language gates.</li><li><b>Scores jump suspiciously</b> → contamination → decontaminate and re-run.</li></ul>`,
  vocab:[
    {term:'Validation loss',def:'Loss on held-out data not used for training; the first overfitting signal.'},
    {term:'Chat template',def:'Model-specific format that wraps roles and turns into a token sequence.'},
    {term:'Loss masking',def:'Excluding certain tokens (user/system) from the loss by assigning them an ignore label.'},
    {term:'Early stopping',def:'Stopping training when validation metrics stop improving.'},
    {term:'Regression suite',def:'A fixed set of general-capability evaluations used to detect unintended degradation.'}
  ],
  mistakes:[
    'Celebrating falling training loss as proof of improvement.',
    'Jumping to hyperparameter tuning before checking template and masking.',
    'Evaluating only the target task and missing forgetting.',
    'Evaluating on data that overlaps training.'
  ],
  related:['v1-finetuning','v1-data-pipelines','v2-evaluation-monitoring','v1-training-loop']
},
{
  id:'trn-10', chapter:'v3-ch-training', difficulty:2,
  title:'Loss spikes, NaNs or hangs in multi-GPU training: how do you triage?',
  understand:'They want a structured approach that separates numerical, data, communication and hardware causes, with the evidence for each. The trap is changing several knobs at once or just raising timeouts.',
  short:'I first classify the symptom. A hang with no error is usually communication or a dead rank, so I look at which collective each rank is stuck in, NCCL debug logs, and Xid or link errors on the nodes. A NaN or a loss spike is numerical or data: I check gradient norms before the spike, whether we use FP16 without proper loss scaling, the learning-rate schedule and warm-up, and the exact batch that was being processed, because a single corrupted or extreme example can do it. Then I reproduce on a smaller scale, single node or even single GPU with the same batch, to separate model maths from infrastructure. Mitigations are gradient clipping, BF16 instead of FP16, warm-up, skipping or fixing bad data, and isolating faulty nodes, one change at a time.',
  detailed:`
<div class="dtree"><ul><li><span class="q">Is the job making progress?</span><ul>
<li><span class="a">No, but processes alive</span> Hang: dump stack traces of all ranks (py-spy), find the collective each rank is in; a rank missing from a collective or in a different one means divergent control flow or a dead peer. Check NCCL logs (NCCL_DEBUG=INFO), Xid 74 (NVLink), 79 (off the bus), network/EFA errors. Set process-group timeouts so hangs become errors.</li>
<li><span class="a">Yes, loss is NaN/Inf</span><ul>
<li><span class="q">FP16?</span> Check dynamic loss scaler (overflow counts). BF16 has the FP32 exponent range and usually needs no loss scaling.</li>
<li><span class="q">Gradient norm exploding before NaN?</span> Lower LR, longer warm-up, gradient clipping (for example max norm 1.0).</li>
<li><span class="q">Specific batch?</span> Log sample IDs per step; replay that batch on one GPU. Look for empty sequences, giant lengths, bad tokens.</li></ul></li>
<li><span class="a">Yes, sudden loss spike then recovery or divergence</span> Data (a shard of junk), LR schedule step, or optimizer state corruption after a bad resume. Roll back to a checkpoint before the spike and skip the offending data range.</li>
<li><span class="a">Only one rank differs</span> Suspect hardware (silent data corruption, ECC): compare per-rank gradient norms, run diagnostics, isolate the node.</li></ul></li></ul></div>
${formula(`
Why FP16 overflows and BF16 does not
    FP16 max ≈ 65,504            (5 exponent bits)
    BF16 max ≈ 3.4 × 10³⁸        (8 exponent bits, same as FP32)
    BF16 trades mantissa precision (7 bits vs FP16's 10) for range
`)}
<h3>Instrument before you need it</h3>
<p>Log per step: loss, gradient norm (global and per-rank), learning rate, tokens/s, loss-scale (if FP16), sample IDs, step time, and memory peak. Keep DCGM metrics and Xid events next to the training dashboard. Most "mysterious" spikes are diagnosable from these within minutes.</p>
<h3>Order of operations during an incident</h3><p>Stop the bleeding first: if loss is diverging, pause and keep the last good checkpoint safe from rotation. Then reproduce on the smallest scale that shows the problem. Only then change one variable at a time, each with a short run and a written hypothesis. Most teams lose days by restarting the full job with three simultaneous changes.</p>`,
  diagram:'',
  followups:[
    {q:'Why can a hang be caused by code, not hardware?',a:'If one rank takes a different branch (for example skips a step because its batch is empty) it calls a different collective or none, and the others wait forever. All ranks must call the same collectives in the same order.'},
    {q:'How does gradient clipping help, and what does it hide?',a:'It caps the global gradient norm so one bad batch cannot make a huge update. It can hide a persistent problem (bad data, too high LR); monitor how often clipping activates.'},
    {q:'Loss diverges only at 256 GPUs, not at 8. Ideas?',a:'Larger global batch changes the effective LR dynamics (need LR scaling and longer warm-up); more nodes raise odds of a faulty GPU; reductions in different order change numerics slightly. Test the global batch on fewer GPUs with accumulation to separate scale effects from hardware.'}
  ],
  tradeoffs:`<ul><li><b>Aggressive clipping</b>: stability vs slower learning.</li><li><b>Long warm-up</b>: stability vs wasted early steps.</li><li><b>Skipping bad batches automatically</b>: keeps training alive but can hide data pipeline bugs; log every skip.</li></ul>`,
  failures:`<ul><li><b>Hang for hours</b> → no timeout → enable timeouts and a no-progress alert.</li><li><b>Repeated NaN at the same step after resume</b> → deterministic data issue → skip/repair that shard.</li><li><b>Random NaNs on one node</b> → hardware → isolate and run diagnostics.</li></ul>`,
  vocab:[
    {term:'Loss scaling',def:'Multiplying the loss before backward in FP16 so small gradients do not underflow; dynamically reduced on overflow.'},
    {term:'Gradient clipping',def:'Rescaling gradients when their global norm exceeds a threshold.'},
    {term:'Warm-up',def:'Gradually increasing the learning rate at the start of training.'},
    {term:'Silent data corruption',def:'Hardware producing wrong results without raising an error.'},
    {term:'NCCL_DEBUG',def:'Environment variable that makes NCCL log its setup and communication details.'}
  ],
  mistakes:[
    'Raising the NCCL timeout as the fix for a hang.',
    'Changing LR, batch size and precision at once.',
    'Assuming BF16 needs loss scaling like FP16.',
    'Not logging sample IDs, so the bad batch cannot be replayed.'
  ],
  related:['v2-distributed-training','v1-training-loop','v1-multi-gpu-profiling']
},
{
  id:'trn-11', chapter:'v3-ch-training', difficulty:3,
  title:'We need a cheaper model for one task. Distil, fine-tune a small model, or quantize the big one?',
  understand:'An architect-level judgement call: three ways to cut serving cost, each with different quality risks, engineering effort and lifecycle cost. They want a decision process anchored in evaluation and unit economics.',
  short:'I would frame it as cost per successful request at the required quality. Quantizing the large model is the cheapest experiment: FP8 or INT4 can roughly halve or quarter weight memory with often small quality loss, and it keeps the model\'s general abilities, but the per-token compute of a large model remains. Fine-tuning a small model on the task can be far cheaper to serve but needs good labelled data. Distillation is a way to create that data: the large model, the teacher, generates or scores answers on real task inputs, and the small student learns from them. I would run all candidates through the same evaluation, compute cost per successful request with measured throughput, and keep a fallback route to the big model for low-confidence cases.',
  detailed:`
${table(['Option','What changes','Typical effort','Quality risk','Serving win'],[
 ['Quantize big model (FP8, INT4 weight-only)','precision of weights (and maybe KV)','days','small to moderate, task-dependent','memory 2–4×, fewer GPUs per replica; speed depends on kernels'],
 ['Fine-tune small model on labelled data','new smaller weights','weeks (data!)','depends on data coverage','large: smaller model is faster and cheaper per token'],
 ['Distil big → small','teacher generates or soft-labels training data','weeks','bounded by teacher and coverage','same as small fine-tune'],
 ['Route (small first, big fallback)','traffic policy','days','controlled by confidence threshold','blend of both']
])}
<h3>Unit economics with illustrative numbers</h3>
${formula(`
Cost per successful request = (GPU $/h ÷ requests per hour served) ÷ success rate

Illustrative (inputs are assumptions, not benchmarks):
  Big model   : 1 replica = 4 GPUs × $X/h, serves 3,600 req/h, success 0.95
                cost = 4X / 3,600 / 0.95 = 0.00117 X per success
  Small model : 1 GPU × $X/h, serves 7,200 req/h, success 0.90
                cost = X / 7,200 / 0.90 = 0.000154 X per success
  Ratio ≈ 7.6× cheaper — IF 0.90 success is acceptable for the task

Router: small handles 85 %, big handles 15 % escalations
  blended ≈ 0.85 × 0.000154 X + 0.15 × 0.00117 X ≈ 0.000307 X  (≈ 3.8× cheaper than big-only)
`)}
<h3>Distillation mechanics</h3>
<ul><li><b>Sequence-level</b>: teacher writes answers for real (de-identified) task inputs; student does SFT on them. Simple and common.</li>
<li><b>Logit-level</b>: student matches the teacher's token distribution (KL on soft targets). Needs teacher logits and a compatible tokenizer.</li>
<li><b>Filtered</b>: only keep teacher answers that pass checks (schema validation, unit tests, judge score) to avoid distilling mistakes.</li></ul>
<p>Check licences: some model licences restrict using outputs to train other models. That is a legal gate, not an engineering detail.</p>
<h3>Lifecycle cost</h3>
<p>Quantization is re-run per base upgrade (hours). A distilled student must be regenerated when the task changes. A router adds a confidence signal and an extra failure mode. Include these in the decision.</p>`,
  diagram:fig('Distillation pipeline with a quality filter', svgDiagram({w:900,h:220,
    boxes:[
      {id:'in',x:20,y:80,w:140,h:60,label:'Real task inputs',sub:'de-identified',cls:'v1'},
      {id:'t',x:200,y:80,w:140,h:60,label:'Teacher',sub:'large model',cls:'v2'},
      {id:'f',x:380,y:80,w:140,h:60,label:'Filter',sub:'schema, tests, judge',cls:'warn'},
      {id:'s',x:560,y:80,w:140,h:60,label:'Student SFT',sub:'small model',cls:'hl'},
      {id:'e',x:740,y:80,w:140,h:60,label:'Same eval',sub:'+ cost / success',cls:'ok'}
    ],
    arrows:[{from:'in',to:'t'},{from:'t',to:'f'},{from:'f',to:'s'},{from:'s',to:'e'}]
  }), 'The filter is what keeps the student from learning the teacher\'s mistakes.'),
  followups:[
    {q:'How do you set the router\'s confidence threshold?',a:'On a labelled eval set, plot success vs fraction routed to the small model for different signals (log-prob, a verifier, schema validity). Pick the point that meets the quality SLO at the lowest blended cost, then monitor drift in the routed fraction.'},
    {q:'Quantized INT4 was slower than BF16. How?',a:'Weight-only INT4 must dequantize in the kernel; at large batch the workload becomes compute-bound and dequantization overhead or weaker kernels can lose to BF16 or FP8 tensor-core paths. Benchmark at your real concurrency.'},
    {q:'What if the task changes monthly?',a:'Favour options with low lifecycle cost: quantized big model or prompt-plus-small-model with a fast regeneration pipeline. Automate distillation data refresh and evaluation as a pipeline, not a one-off.'}
  ],
  tradeoffs:`<ul><li><b>Quantize</b>: fastest, keeps generality, smaller saving.</li><li><b>Small fine-tune/distil</b>: biggest saving, needs data and ongoing maintenance, narrower competence.</li><li><b>Routing</b>: best blend, adds complexity and a confidence signal to maintain.</li></ul>`,
  failures:`<ul><li><b>Student good offline, poor in production</b> → distillation inputs not representative → sample from real traffic.</li><li><b>Router sends hard cases to small model</b> → quality incidents → recalibrate threshold, add verifier.</li><li><b>Licence violation</b> → legal risk → check model terms before distilling.</li></ul>`,
  vocab:[
    {term:'Knowledge distillation',def:'Training a smaller student model to imitate a larger teacher model\'s outputs or distributions.'},
    {term:'Teacher / student',def:'The large source model and the small model being trained.'},
    {term:'Soft targets',def:'The teacher\'s full probability distribution over tokens, used for logit distillation.'},
    {term:'Model cascade / router',def:'Serving pattern that tries a cheap model first and escalates to a larger one.'},
    {term:'Cost per successful request',def:'Infrastructure cost divided by requests that met the quality bar.'}
  ],
  mistakes:[
    'Comparing options by tokens per second only, ignoring success rate.',
    'Assuming quantization always speeds things up.',
    'Distilling unfiltered teacher outputs, including errors.',
    'Ignoring licence restrictions on using model outputs for training.'
  ],
  related:['v1-quantization-speculative','v1-finetuning','v2-finops-unit-economics','v2-ai-gateway']
}
]);
