/* Volume 1, Part 1 — AI and machine learning foundations
 * Lessons: v1-ai-landscape, v1-neural-networks, v1-tensors-pytorch
 * Animations live in src/anims/v1p1-3.js
 */

/* ------------------------------------------------------------------ */
/* 1.1.1  What AI, ML, deep learning and generative AI really are      */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v1-ai-landscape', vol:1, part:1, num:1,
  title:'What AI, ML, deep learning and generative AI really are', minutes:60,
  summary:'Artificial intelligence is the broad goal of making machines do tasks that need judgement. Machine learning is the main way we do it today: instead of writing rules, we let an algorithm fit the numbers inside a function to example data. Deep learning uses very large stacks of simple layers as that function. Generative AI uses deep learning to produce new text, images or audio, and large language models do it by predicting the next token again and again. For a platform engineer, a model is a versioned file of numbers plus the code that runs it, and the hard problems are data, compute, memory, latency and cost.',
  objectives:[
    'Place AI, machine learning, deep learning, generative AI and large language models correctly relative to each other, with one example of each.',
    'Explain the difference between training and inference, and between parameters and hyperparameters, in infrastructure terms.',
    'Name the four main learning paradigms (supervised, unsupervised, self-supervised, reinforcement) and say which one pretrains an LLM.',
    'Estimate training and inference compute with the 6·N·D and 2·N rules of thumb and state their limits.',
    'Decide when a classical ML model, a hosted LLM API, or a self-hosted open-weight model is the right tool.'
  ],
  prereqs:[],
  next:['v1-neural-networks','v1-tensors-pytorch','v1-transformer'],
  tags:['foundations','ml','llm','landscape'],
  html:`
<p>This lesson builds the vocabulary for the whole course. Every later lesson — GPUs, inference engines, Kubernetes serving, RAG, MCP — assumes you can say precisely what a model is, what training does to it, and what running it costs. We start from zero and stay concrete.</p>

<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Think of a model like a compiled binary whose behaviour is set by a huge configuration file of numbers. Nobody writes that file by hand; a training job generates it from examples. Now the real definitions.')}
<p>The terms are nested sets, not competitors:</p>
<dl class="kv">
<dt>${term('Artificial intelligence')}</dt><dd>The goal: machines doing tasks that normally need human judgement — recognising, deciding, translating, planning. Rule engines, search algorithms and expert systems are AI too.</dd>
<dt>${term('Machine learning')}</dt><dd>A <i>method</i> for AI: write a function with adjustable numbers (${term('parameter','parameters')}) and let an algorithm adjust those numbers to fit example data. Rules are <b>learned</b>, not written.</dd>
<dt>${term('Deep learning')}</dt><dd>Machine learning where the function is a <b>neural network</b> with many layers. Each layer is mostly matrix multiplication plus a simple non-linear function. Depth lets it learn features (edges, words, intents) instead of a human designing them.</dd>
<dt>${term('Generative AI')}</dt><dd>Deep learning models that <b>produce</b> new content (text, code, images, audio) instead of only a label or a number.</dd>
<dt>${term('Large language model')} (LLM)</dt><dd>A generative model for text, almost always a decoder-only ${L('v1-transformer','transformer')}, trained to predict the next ${term('token')} over trillions of tokens. Chat, summarisation, coding, tool calling and agents are all built on this one capability.</dd>
</dl>
${fig('AI, ML, deep learning, generative AI and LLMs are nested', svgDiagram({w:900,h:330,
 zones:[
  {x:20,y:20,w:860,h:290,label:'Artificial intelligence (any technique: rules, search, planning, learning)'},
  {x:60,y:55,w:780,h:240,label:'Machine learning (parameters fitted to data)'},
  {x:280,y:90,w:540,h:190,label:'Deep learning (many-layer neural networks)'},
  {x:470,y:125,w:330,h:140,label:'Generative AI',cls:'ok'}
 ],
 boxes:[
  {id:'rules',x:80,y:95,w:180,h:44,label:'Fraud rules engine',sub:'AI, not ML'},
  {id:'gbm',x:80,y:165,w:180,h:44,label:'Gradient boosting',sub:'ML, not deep'},
  {id:'cnn',x:300,y:150,w:150,h:44,label:'Image classifier',sub:'deep, not generative'},
  {id:'llm',x:500,y:160,w:130,h:50,label:'LLM',sub:'text generator',cls:'hl'},
  {id:'diff',x:650,y:160,w:130,h:50,label:'Diffusion',sub:'image generator'}
 ],
 notes:[{x:500,y:250,text:'LLMs are one family inside generative AI'}]
}), 'Every LLM is deep learning; most AI in production is still not an LLM. A pricing model or a demand forecast is usually classical ML.')}

<h3>Model, parameters, training, inference</h3>
<p>A <b>model</b> is a function <code>y = f(x; θ)</code>. <code>x</code> is the input (a ticket text, an image, a row of features), <code>y</code> the output (a class, a number, the next token), and <code>θ</code> (theta) the ${term('parameter','parameters')} — the learned numbers, also called <b>weights</b>. Llama-3.1-8B has about 8.03 billion of them.</p>
<ul>
<li><b>Training</b> searches for values of θ that make <code>f</code> fit the data. It needs the data, the gradients, optimizer state and a lot of compute. It runs for hours to months and writes ${term('checkpoint','checkpoints')}.</li>
<li><b>${term('Inference')}</b> uses fixed θ to compute outputs for new inputs. It runs for milliseconds to seconds per request, millions of times. Most production GPU spend over a model's life is usually inference, not training.</li>
<li><b>${term('Hyperparameter','Hyperparameters')}</b> are settings <i>you</i> choose and the training does not learn: learning rate, batch size, number of layers, LoRA rank. They are the training job's config file.</li>
</ul>
${callout('devops','DevOps bridge','Training is a batch job (like a big Spark or EMR job) that produces an artifact. Inference is a latency-sensitive online service (like an API tier) that loads that artifact. They need different hardware sizing, scaling, failure handling and SLOs. The bridge breaks in one important place: the artifact here is not code you can read and review — it is billions of numbers whose behaviour you can only test.')}

<h2>2. Why do we need it?</h2>
<p>Some problems cannot be solved well with hand-written rules. Classifying a free-text complaint in Arabic and English into 40 categories, spotting a fraudulent booking from 300 signals, or answering "can I change my Riyadh–Dubai flight to tomorrow?" from policy documents all involve patterns too numerous and fuzzy for <code>if/else</code>. Machine learning replaces "write the rules" with "collect examples and fit a function".</p>
<p>Deep learning was needed because classical ML required humans to design the features (word counts, ratios, flags). Neural networks learn features directly from raw text, pixels or audio, and keep improving as data and compute grow. Generative models were the next step: instead of one label per input, the same pretrained model can write, summarise, translate, extract and call tools, which is why one LLM can replace dozens of task-specific models.</p>
<h3>The four learning paradigms</h3>
${table(['Paradigm','Training signal','Example','Where you meet it'],[
 ['Supervised','Input paired with a correct label written by humans or systems','Ticket text → category; booking features → fraud yes/no','Classical ML, classifiers, SFT of LLMs'],
 ['Unsupervised','No labels; find structure','Clustering customers; anomaly detection on latency','AIOps, segmentation'],
 ['Self-supervised','Labels created from the data itself (hide a part, predict it)','Predict the next token of a web page','<b>LLM pretraining</b>; embedding models'],
 ['Reinforcement learning','A reward for actions or whole outputs','Reward answers humans prefer; reward correct maths','RLHF, GRPO, agents (see '+L('v1-finetuning','fine-tuning')+')']
])}
<p>The insight that made LLMs possible: <b>self-supervision needs no labelling team</b>. Every sentence on the web is its own training example — the label for position <i>t</i> is simply the token at <i>t</i>+1. That is why pretraining can use trillions of tokens.</p>

<h2>3. How does it work internally?</h2>
<h3>Learning is fitting numbers to minimise a loss</h3>
<p>Every ML method shares one loop, taught in detail in ${L('v1-neural-networks','the next lesson')}:</p>
<ol>
<li><b>Predict</b>: run inputs through <code>f(x; θ)</code> (the forward pass).</li>
<li><b>Score</b>: a ${term('loss function')} measures how wrong the prediction is, as one number.</li>
<li><b>Correct</b>: compute how the loss changes if each parameter moves slightly (the ${term('gradient')}), and move each parameter a small step downhill.</li>
<li><b>Repeat</b> over many batches until the loss stops improving on data the model has not seen.</li>
</ol>
<h3>What an LLM actually computes</h3>
<p>An LLM turns text into ${term('token')} IDs (${L('v1-tokenization-embeddings','tokenization')}), maps each ID to a vector, transforms the vectors through dozens of transformer layers, and produces a score for every token in the vocabulary — the ${term('logits')}. Softmax turns scores into probabilities; a sampler picks one token (${L('v1-generation','generation')}). That token is appended and the whole thing repeats. Everything an LLM "does" — answering, reasoning, calling a tool — is this loop.</p>
${formula(`
Pretraining objective (self-supervised next-token prediction)

for each position t in a sequence of tokens x₁ … xₙ :

    loss_t = − log P_θ( x_{t+1} | x₁ … x_t )
                       ↑            ↑
                       the true     everything before it
                       next token

total loss = mean of loss_t over all positions in the batch
`)}
<h3>Scale in numbers: two rules of thumb</h3>
<p>For dense transformers, a forward pass costs roughly <b>2 floating-point operations per parameter per token</b> (one multiply and one add). Training adds the backward pass, about twice the forward, so <b>≈ 6 FLOPs per parameter per token</b>. These rules ignore attention's extra cost at long context, but are the standard first estimate.</p>
${formula(`
STEP 1  inference compute per generated token, 8B dense model
        2 × N = 2 × 8.03 × 10⁹  ≈ 1.6 × 10¹⁰ FLOPs  (16 GFLOPs)

STEP 2  training compute, same model, D = 15 × 10¹² tokens
        6 × N × D = 6 × 8.03 × 10⁹ × 15 × 10¹²
                  ≈ 7.2 × 10²³ FLOPs

STEP 3  convert to GPU time on an H100 SXM
        dense BF16 peak ≈ 989.5 × 10¹² FLOP/s
        assume 40 % model FLOPs utilisation (illustrative)
        useful rate = 0.40 × 989.5 × 10¹² ≈ 3.96 × 10¹⁴ FLOP/s

        time = 7.2 × 10²³  /  3.96 × 10¹⁴
             ≈ 1.82 × 10⁹ GPU-seconds
             ≈ 505,000 GPU-hours
               ↑ ≈ 2,000 GPUs for ≈ 10.5 days

ANSWER  pretraining even an "small" 8B model is a large-cluster job;
        you will almost always adapt an existing open-weight model instead.
`)}
${callout('unverified','Check reported figures against the model card','Meta’s Llama 3.1 model card reports on the order of 1.46 million H100 GPU-hours for the 8B model and states pretraining on roughly 15 trillion tokens. Real runs use more compute than the 6·N·D estimate because of lower utilisation, failed runs, ablations and evaluation. Verify the exact figures on the current model card before quoting them.')}

<h3>Classical ML versus deep learning versus LLMs</h3>
${table(['Problem','Usually best first choice','Why'],[
 ['Fraud score from 300 tabular booking features','Gradient-boosted trees (XGBoost, LightGBM)','Tabular data, needs explanations and millisecond CPU inference'],
 ['Hotel demand forecast for Ramadan and Hajj peaks','Time-series model or gradient boosting with calendar features','Structured history; LLMs add nothing but cost'],
 ['Route 40 ticket categories, Arabic + English','Fine-tuned small encoder or a small LLM with few-shot prompts','Text understanding; small models are cheap'],
 ['Answer policy questions in natural language','LLM + retrieval (RAG)','Open-ended language, knowledge changes weekly'],
 ['Draft a reply and call the booking API','LLM with tool calling and approvals','Generation + action; see '+L('v1-ai-apps-tools','tools')]
])}

<h2>4. Where does it fit?</h2>
${fig('The model lifecycle a platform team operates', svgDiagram({w:900,h:300,
 boxes:[
  {id:'d',x:20,y:40,w:130,h:56,label:'Data',sub:'collect, clean, version'},
  {id:'t',x:190,y:40,w:130,h:56,label:'Training',sub:'GPU batch job',cls:'hl'},
  {id:'e',x:360,y:40,w:130,h:56,label:'Evaluation',sub:'quality gates'},
  {id:'r',x:530,y:40,w:150,h:56,label:'Model registry',sub:'versioned artifact'},
  {id:'s',x:720,y:40,w:160,h:56,label:'Inference service',sub:'online, SLOs',cls:'hl'},
  {id:'a',x:720,y:170,w:160,h:56,label:'Applications',sub:'chat, RAG, agents'},
  {id:'m',x:440,y:170,w:200,h:56,label:'Monitoring',sub:'quality, latency, cost'},
  {id:'f',x:190,y:170,w:170,h:56,label:'Feedback data',sub:'labels, preferences'}
 ],
 arrows:[{from:'d',to:'t'},{from:'t',to:'e'},{from:'e',to:'r'},{from:'r',to:'s',label:'deploy'},{from:'s',to:'a',fromSide:'bottom',toSide:'top'},{from:'a',to:'m',label:'traces'},{from:'m',to:'f'},{from:'f',to:'d',fromSide:'top',toSide:'bottom',cls:'dash'}]
}), 'Training (left half) is a batch pipeline; inference (right half) is an online service. Feedback closes the loop. Volume 1 follows this path from data to Kubernetes serving.')}
<p>This course follows the same path. Part 1–3 cover the left half (what a model is, how it learns, how it is trained and adapted). Parts 4–6 cover the right half (GPUs, ${L('v1-inference-anatomy','inference')}, ${L('v1-k8s-serving','Kubernetes serving')}). Volume 2 covers the platform around it.</p>

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Data platform → model.</b> Your Kafka, S3, Glue and Spark estate is the raw material. Training data quality decides model quality (${L('v1-data-pipelines','datasets')}).</li>
<li><b>Model → artifact store.</b> The output is files: weights (safetensors), config, tokenizer, chat template (${L('v1-training-loop','artifacts')}). They live in object storage or a model registry, versioned like container images.</li>
<li><b>Artifact → GPU runtime.</b> An inference engine (vLLM, SGLang, TensorRT-LLM) loads the weights into GPU memory and executes the forward pass (${L('v1-engines','engines')}).</li>
<li><b>Runtime → applications.</b> Applications call an API (often OpenAI-compatible), add retrieval and tools, and are governed by a gateway (${L('v2-ai-gateway','AI gateway')}).</li>
</ul>
<h3>Open-weight, open-source and closed models</h3>
${table(['Type','What you get','Operational consequence'],[
 ['Closed / hosted API','An HTTPS endpoint; no weights','No GPUs to run; per-token pricing; data leaves your boundary unless the provider offers in-region hosting'],
 ['Open-weight','Downloadable weights + config + tokenizer under a licence; training data and code usually not released','You run GPUs; you control data residency; you must read the licence (some restrict use or scale)'],
 ['Open-source (strict sense)','Weights, training code and data or a full data recipe under an open licence','Rare at frontier scale; best for research and reproducibility']
])}
<p>"Open-weight" is the precise term for Llama, Qwen, Mistral, Gemma and DeepSeek releases. Calling them "open source" is common but loose: you usually cannot rebuild them.</p>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li><b>Compute</b>: GPU capacity for training jobs and inference services, quotas, scheduling, utilisation (${L('v1-k8s-gpu-stack','Kubernetes GPU stack')}).</li>
<li><b>Artifacts</b>: immutable, versioned, scanned model files with lineage to data and code (${L('v2-mlops-foundations','MLOps foundations')}).</li>
<li><b>Environments</b>: pinned CUDA, driver, PyTorch and engine versions; reproducible images.</li>
<li><b>Serving</b>: latency SLOs (time to first token, time per output token), autoscaling, rollouts and rollbacks.</li>
<li><b>Data controls</b>: residency (for example Saudi PDPL obligations), PII handling, access control, audit.</li>
<li><b>Cost</b>: cost per token and per successful request, not just cost per GPU-hour (${L('v2-finops-unit-economics','AI FinOps')}).</li>
</ul>
${callout('devops','What carries over from your background, and what does not','Carries over: IaC, GitOps, CI/CD, observability, capacity planning, incident response, IAM. New: models fail <i>silently</i> — a pod can be Ready, return HTTP 200 in 300 ms, and still answer wrongly. Health checks prove the service runs; only <b>evaluation</b> proves it is correct. Correctness becomes a monitored SLI.')}

<h2>7. What happens when it fails?</h2>
${table(['Failure','Symptom','Root cause','Fix'],[
 ['Wrong tool','LLM bill grows; latency 2 s for a yes/no decision','LLM used for a deterministic or tabular task','Use rules or classical ML; keep LLMs for language'],
 ['Train/serve skew','Great offline accuracy, poor in production','Training data distribution differs from live traffic (language mix, seasonality)','Evaluate on recent production-like data; monitor drift (' + L('v2-evaluation-monitoring','monitoring') + ')'],
 ['Hallucination','Fluent but false answer','Model optimised for plausible next tokens, not truth','Grounding with retrieval, citations, abstention, evaluation (' + L('v1-generation','generation') + ')'],
 ['Artifact mismatch','Garbage output after an upgrade','Weights loaded with the wrong tokenizer or chat template','Version weights, tokenizer and template together'],
 ['Licence violation','Legal blocks a launch','Open-weight licence terms not reviewed','Licence review in the model intake process']
])}

<h2>8. How do we scale it?</h2>
<p>Training scales with <b>data × parameters</b> (6·N·D), so it needs many GPUs working together, linked by fast networks (${L('v2-distributed-training','distributed training')}). Inference scales with <b>requests × tokens</b>: more replicas, better batching, smaller or quantised models, caching (${L('v1-batching','batching')}, ${L('v2-cache-map','caching')}). Their bottlenecks differ: training is usually limited by compute and interconnect; LLM decoding is usually limited by GPU memory bandwidth and capacity (${L('v1-gpu-architecture','GPU architecture')}).</p>

<h2>9. How do we optimize its cost?</h2>
<ol>
<li><b>Pick the smallest model that passes your evaluation.</b> Inference compute is ≈ 2·N per token: an 8B model costs roughly 1/9 the FLOPs of a 70B model per token.</li>
<li><b>Adapt, do not pretrain.</b> Prompting, retrieval and LoRA fine-tuning cost hundreds to thousands of times less than pretraining (${L('v1-finetuning','fine-tuning')}).</li>
<li><b>Buy versus build.</b> A hosted API has zero idle cost; self-hosting wins only with steady volume, residency needs or customisation. Compare <i>cost per successful task</i>, not list prices (${L('v2-finops-optimization','FinOps optimization')}).</li>
<li><b>Route by difficulty.</b> Send easy requests to a small model and hard ones to a large model.</li>
</ol>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Explain AI, ML, deep learning and LLMs to me, and tell me where a platform team adds value.”','<p><i>Answer (≈50 s):</i> "AI is the goal; machine learning is the dominant method — instead of writing rules we fit the parameters of a function to data by minimising a loss. Deep learning uses many-layer neural networks as that function so features are learned, not hand-built. An LLM is a deep transformer pretrained with self-supervision to predict the next token over trillions of tokens; chat, summarisation and tool use are all that one loop. Operationally a model is a versioned artifact — weights, config, tokenizer, template — and training is a GPU batch job while inference is a latency-bound online service. A platform team owns the parts that decide whether it works in production: reproducible artifacts, GPU capacity, serving SLOs, evaluation as a release gate, data controls and cost per successful request."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"AI is when computers think. LLMs like ChatGPT are AI. We deploy them on Kubernetes."</p><p>No mechanism, no distinction between training and inference, no operational ownership.</p></div><div class="good"><h4>Strong answer</h4><p>Nested definitions, the next-token objective, training versus inference, the artifact view, and a concrete list of platform responsibilities including evaluation and cost.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Data','loss function','training (6·N·D)','checkpoint','inference (2·N per token)','application'])}
${chain(['Self-supervised pretraining','open-weight model','fine-tuning or RAG','your product'])}
<p>Next: ${L('v1-neural-networks','neural networks')} shows exactly how the "fit numbers to minimise a loss" loop works, with every number computed by hand. Then ${L('v1-tensors-pytorch','PyTorch')} shows how that loop becomes GPU kernels.</p></div>
`,
  quiz:[
    {q:'Which statement about the relationship between the terms is correct?',options:['Every machine learning model is a neural network','Every LLM is a deep learning model, but most production AI is not an LLM','Generative AI and machine learning are separate fields','Deep learning is a type of rule engine'],answer:1,explain:'LLMs are deep transformers, so they are deep learning. But fraud models, forecasts and rule engines (still AI) dominate production. Not every ML model is a neural network: gradient-boosted trees are ML without deep learning.'},
    {q:'How is an LLM pretrained?',options:['Supervised learning on human-labelled question–answer pairs','Self-supervised next-token prediction over very large text corpora','Unsupervised clustering of documents','Reinforcement learning from scratch'],answer:1,explain:'The label for each position is the next token of the same text, so no labelling is needed. Human-labelled pairs are used later in SFT, and reinforcement learning in preference tuning — not in pretraining.'},
    {q:'Using the 6·N·D rule, how many FLOPs does training a 1B-parameter model on 20B tokens need?',options:['1.2 × 10²⁰','2 × 10¹⁹','1.2 × 10²¹','6 × 10¹⁸'],answer:0,explain:'6 × 10⁹ × 2 × 10¹⁰ = 12 × 10¹⁹ = 1.2 × 10²⁰. The 2·N rule (2 × 10¹⁹ for these tokens) is for the forward pass only.'},
    {q:'A pod serving a model is Ready and returns HTTP 200 in 300 ms, but answers are wrong. Which control would have caught it?',options:['A liveness probe','HPA on CPU','An evaluation gate on a representative test set','A larger memory limit'],answer:2,explain:'Health checks prove the process works, not that the model is correct. Evaluation on representative data is the correctness check.'},
    {q:'Which is a hyperparameter rather than a parameter?',options:['A weight in the first layer','The learning rate','A bias value in the output layer','An embedding vector'],answer:1,explain:'Parameters are learned by training. The learning rate is chosen by you and controls how training updates the parameters.'}
  ],
  flashcards:[
    {front:'AI vs ML vs DL vs GenAI vs LLM',back:'Nested: AI (goal) ⊃ ML (fit parameters to data) ⊃ DL (many-layer neural nets) ⊃ GenAI (produces content) ⊃ LLMs (text, next-token transformers).'},
    {front:'Parameter vs hyperparameter',back:'Parameter: learned number inside the model (weights, biases). Hyperparameter: setting you choose (learning rate, batch size, layers, LoRA rank).'},
    {front:'Compute rules of thumb',back:'Inference ≈ 2·N FLOPs per token. Training ≈ 6·N·D FLOPs (N parameters, D tokens). Ignores long-context attention cost.'},
    {front:'Which learning paradigm pretrains an LLM?',back:'Self-supervised: the label for each position is the next token of the same text.'},
    {front:'Open-weight vs open-source',back:'Open-weight: weights + config + tokenizer under a licence; data/code usually withheld. Open-source: also code and data (or a full recipe), openly licensed.'},
    {front:'Why can a healthy pod serve a broken model?',back:'Health checks test the process, not correctness. Only evaluation on representative data proves output quality.'}
  ]
});
registerGlossary([
  {term:'Artificial intelligence',def:'The broad goal of making machines perform tasks that normally need human judgement; includes rules, search, planning and machine learning.',lesson:'v1-ai-landscape',aliases:['AI']},
  {term:'Machine learning',def:'Building a function with adjustable parameters and fitting those parameters to example data by minimising a loss, instead of writing rules by hand.',lesson:'v1-ai-landscape',aliases:['ML']},
  {term:'Deep learning',def:'Machine learning with many-layer neural networks that learn their own features from raw data.',lesson:'v1-ai-landscape'},
  {term:'Generative AI',def:'Models that produce new content (text, code, images, audio) rather than only a label or score.',lesson:'v1-ai-landscape',aliases:['GenAI']},
  {term:'Large language model',def:'A deep (usually decoder-only transformer) model pretrained to predict the next token over very large text corpora; the base of chat, RAG and agents.',lesson:'v1-ai-landscape',aliases:['LLM']},
  {term:'Parameter',def:'A learned number inside a model (a weight or bias). Model size is counted in parameters, e.g. 8 billion.',lesson:'v1-ai-landscape',aliases:['parameters','weights']},
  {term:'Hyperparameter',def:'A training or architecture setting chosen by the engineer, not learned: learning rate, batch size, number of layers, LoRA rank.',lesson:'v1-ai-landscape',aliases:['hyperparameters']},
  {term:'Inference',def:'Running a trained model with fixed parameters to produce outputs for new inputs; in LLMs, prefill plus token-by-token decode.',lesson:'v1-ai-landscape'},
  {term:'Self-supervised learning',def:'Training where labels come from the data itself, e.g. predicting the next token of a text; how LLMs are pretrained.',lesson:'v1-ai-landscape'},
  {term:'Open-weight model',def:'A model whose trained weights, config and tokenizer are downloadable under a licence, while training data and code are usually not released.',lesson:'v1-ai-landscape',aliases:['open weights']}
]);

/* ------------------------------------------------------------------ */
/* 1.1.2  Neural networks: parameters, loss, gradients and learning    */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v1-neural-networks', vol:1, part:1, num:2,
  title:'Neural networks: parameters, loss, gradients and learning', minutes:95,
  summary:'A neural network is a chain of simple steps: multiply the inputs by weights, add a bias, and pass the result through a small non-linear function. Training measures how wrong the output is with a loss function, then uses the chain rule to work out, for every weight, which direction would reduce that loss. Each weight then takes a small step in that direction, sized by the learning rate. This lesson computes every number of that loop by hand for a two-weight network, then shows how the same loop, with an optimizer called AdamW, trains a model with billions of weights.',
  objectives:[
    'Define weights, biases, activations, parameters and optimizer state, and count the parameters of a linear layer.',
    'Compute mean squared error and cross-entropy loss by hand, and explain why a fresh LLM starts with loss ≈ ln(vocabulary size).',
    'Run a complete forward pass, backward pass and update for a two-weight network, using the chain rule.',
    'Explain gradient descent and the effect of the learning rate (convergence, oscillation, divergence) with numbers.',
    'Explain what AdamW keeps per parameter and why it costs memory, and recognise exploding gradients and NaN losses.'
  ],
  prereqs:['v1-ai-landscape'],
  next:['v1-tensors-pytorch','v1-training-loop','v1-transformer'],
  tags:['foundations','training','maths','optimizer'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A mixing desk with millions of knobs. Someone plays a song (input), you hear the output, a judge scores how far it is from the target sound (loss). Training is a procedure that works out, for every knob at once, which way to turn it a little to improve the score. Now the real mechanism.')}
<p>A ${term('neural network')} is a function built from layers. One <b>neuron</b> takes inputs <code>x₁ … xₙ</code>, multiplies each by a ${term('weight')}, adds a ${term('bias')}, and applies a non-linear ${term('activation function')}:</p>
${formula(`
z = w₁x₁ + w₂x₂ + … + wₙxₙ + b        (weighted sum + bias)
a = φ(z)                               (activation, e.g. ReLU)

ReLU(z) = max(0, z)
SiLU(z) = z · σ(z)        σ(z) = 1 / (1 + e⁻ᶻ)     ← used in Llama FFNs
`)}
<p>A <b>layer</b> is many neurons sharing the same inputs, which is exactly a matrix multiplication. With input vector <b>x</b> of size <code>d_in</code> and <code>d_out</code> neurons:</p>
${formula(`
y = φ( x · W + b )

shapes:   x : [d_in]      W : [d_in, d_out]      b : [d_out]      y : [d_out]

parameters in the layer = d_in × d_out  +  d_out
                          ↑ weights        ↑ biases

example: d_in = 4,096, d_out = 4,096
         4,096 × 4,096 + 4,096 = 16,781,312 parameters
`)}
<p>Stack layers and you have a network. The weights and biases together are the <b>parameters</b>. The intermediate outputs (<code>z</code>, <code>a</code>) are <b>${term('activations')}</b>: they exist only while a batch is being processed, but during training they must be kept for the backward pass, which is why training needs much more GPU memory than inference.</p>
${callout('note','Why the non-linearity matters','Two linear layers in a row collapse into one: x·W₁·W₂ = x·(W₁W₂). Without φ, a 100-layer network could only learn straight-line relationships. The activation function is what lets depth add expressive power.')}

<h2>2. Why do we need it?</h2>
<p>We want a function that maps messy inputs (a ticket, an image, a token sequence) to useful outputs, and we cannot write its rules. A neural network with enough parameters can approximate almost any such function. The open question is <i>which</i> parameter values. There are billions of them, so we need an automatic, efficient way to improve all of them at once. That way is <b>gradient descent with backpropagation</b>, and it is the same algorithm whether the network has 2 weights or 400 billion.</p>

<h2>3. How does it work internally?</h2>
<p>The training loop has four steps. The animation runs it once; the rest of this section computes every number.</p>
${anim('v1-nn-train-loop')}

<h3>3.1 Loss functions: turning "wrong" into one number</h3>
<p>A ${term('loss function')} compares prediction <code>ŷ</code> to target <code>y</code>. Lower is better. Two cover almost everything in this course.</p>
<p><b>${term('Mean squared error')} (MSE)</b> for predicting numbers (prices, latencies):</p>
${formula(`
             1   n
    MSE  =  ─── Σ  (ŷᵢ − yᵢ)²
             n  i=1

example: predictions [210, 180, 330] ms, targets [200, 190, 300] ms
         errors       [ 10, −10,  30]
         squared      [100, 100, 900]
         MSE = (100 + 100 + 900) / 3 = 366.7 ms²
                                        ↑ squaring punishes the 30 ms miss 9× more than a 10 ms miss
`)}
<p><b>${term('Cross-entropy')}</b> for choosing among classes (a ticket category, or the next token out of 128,256). The model outputs raw scores called ${term('logits')}; ${term('softmax')} turns them into probabilities; the loss is the negative log of the probability given to the correct answer.</p>
${formula(`
                 exp(zᵢ)
    pᵢ  =  ───────────────          loss = − ln( p_correct )
               Σⱼ exp(zⱼ)

STEP 1  logits for 3 classes [refund, change, baggage] = [2.0, 1.0, 0.1]

STEP 2  exponentiate
        e²·⁰ = 7.389     e¹·⁰ = 2.718     e⁰·¹ = 1.105
        sum  = 11.212

STEP 3  probabilities
        p = [7.389, 2.718, 1.105] / 11.212 = [0.659, 0.242, 0.099]

STEP 4  loss if the true class is "refund"
        − ln(0.659) = 0.417           ← confident and right: small loss

        loss if the true class is "baggage"
        − ln(0.099) = 2.31            ← confident and wrong: large loss

ANSWER  cross-entropy rewards putting probability on the right answer and
        punishes confident mistakes steeply (− ln p → ∞ as p → 0).
`)}
${callout('tip','A number to remember: the loss of an untrained LLM','A randomly initialised model spreads probability evenly over the vocabulary. With Llama 3’s 128,256-token vocabulary, p_correct ≈ 1/128,256, so the starting loss is ln(128,256) ≈ 11.76. If your first logged training loss is far from ln(vocab size), suspect a bug (wrong labels, wrong vocabulary size, bad initialisation). Language-model loss is often reported as <b>perplexity</b> = e^loss: perplexity 128,256 at the start means "as unsure as a uniform guess over the whole vocabulary".')}

<h3>3.2 Gradients: which way is downhill?</h3>
<p>The ${term('gradient')} of the loss with respect to a weight, <code>∂L/∂w</code>, says how much the loss changes if that weight increases by a tiny amount. Negative gradient → increasing the weight lowers the loss. ${term('Backpropagation')} computes all gradients efficiently with the <b>chain rule</b>: if <code>L</code> depends on <code>ŷ</code>, which depends on <code>h</code>, which depends on <code>w</code>, then multiply the local derivatives along the path.</p>
${formula(`
     ∂L       ∂L     ∂ŷ     ∂h
    ────  =  ──── · ──── · ────          (chain rule)
     ∂w       ∂ŷ     ∂h     ∂w
`)}

<h3>3.3 Fully worked example: a two-weight network</h3>
<p>Network: input <code>x</code> → hidden <code>h = w₁·x</code> → output <code>ŷ = w₂·h</code>. (We use the identity activation so every number is easy to check; a ReLU would give the same result here because h &gt; 0, where ReLU’s derivative is 1.) Loss is squared error. Learning rate η = 0.01.</p>
${formula(`
GIVEN   x = 2      target y = 10      w₁ = 1.5      w₂ = 2.0      η = 0.01

STEP 1  forward pass
        h  = w₁ · x  = 1.5 × 2   = 3.0
        ŷ  = w₂ · h  = 2.0 × 3.0 = 6.0
        L  = (ŷ − y)² = (6 − 10)² = 16.0

STEP 2  backward: derivative of the loss w.r.t. the output
         ∂L
        ────  = 2(ŷ − y) = 2 × (6 − 10) = −8
         ∂ŷ

STEP 3  gradient for w₂   (ŷ = w₂·h, so ∂ŷ/∂w₂ = h)
         ∂L      ∂L
        ────  = ──── · h  = −8 × 3.0 = −24
        ∂w₂      ∂ŷ

STEP 4  pass the error back to h   (∂ŷ/∂h = w₂)
         ∂L      ∂L
        ────  = ──── · w₂ = −8 × 2.0 = −16
         ∂h      ∂ŷ

STEP 5  gradient for w₁   (h = w₁·x, so ∂h/∂w₁ = x)
         ∂L      ∂L
        ────  = ──── · x  = −16 × 2 = −32
        ∂w₁      ∂h
                    ↑ reuses the value from STEP 4 — this reuse is why
                      backprop costs about 2× a forward pass, not N×

STEP 6  update (gradient descent:  w ← w − η · ∂L/∂w)
        w₂ = 2.0 − 0.01 × (−24) = 2.24
        w₁ = 1.5 − 0.01 × (−32) = 1.82

STEP 7  forward again to check
        h  = 1.82 × 2    = 3.64
        ŷ  = 2.24 × 3.64 = 8.1536
        L  = (8.1536 − 10)² = (−1.8464)² ≈ 3.409

ANSWER  one update cut the loss from 16.0 to 3.41
`)}
${anim('v1-nn-backprop')}
<p>Everything in the 8-billion-parameter case is this, vectorised: the forward pass stores <code>h</code> (an activation), the backward pass multiplies local derivatives from the output back to the input, and every weight moves opposite to its gradient. Biases work the same way: for <code>z = w·x + b</code>, <code>∂z/∂b = 1</code>, so a bias gradient is just the error signal arriving at that neuron.</p>

<h3>3.4 Gradient descent and the learning rate</h3>
${formula(`
    w_new = w_old − η · ∂L/∂w
                    ↑
                    learning rate: how big a step
`)}
<p>The ${term('learning rate')} is the most important hyperparameter. Same two-weight network, same starting point, but η = 0.05 instead of 0.01:</p>
${formula(`
        w₂ = 2.0 − 0.05 × (−24) = 3.2
        w₁ = 1.5 − 0.05 × (−32) = 3.1
        h  = 3.1 × 2 = 6.2       ŷ = 3.2 × 6.2 = 19.84
        L  = (19.84 − 10)² = 96.8           ← loss went UP from 16 to 96.8
`)}
<p>Too large a step jumps past the minimum. The animation below uses an even simpler one-weight problem, <code>ŷ = w·2</code> with target 6 (minimum at w = 3), to show three regimes.</p>
${anim('v1-nn-gradient-descent')}
${formula(`
L(w) = (2w − 6)²          ∂L/∂w = 2(2w − 6) · 2 = 8w − 24          start w = 1

η = 0.05 (converges)
  step 1: grad = −16      w = 1 + 0.8     = 1.8      L = 5.76
  step 2: grad = −9.6     w = 1.8 + 0.48  = 2.28     L = 2.07
  step 3: grad = −5.76    w = 2.28 + 0.288 = 2.568   L = 0.75
  step 4: grad = −3.456   w = 2.741                  L = 0.27   → approaches 3

η = 0.25 (oscillates forever)
  step 1: w = 1 + 4 = 5   L = 16      grad = +16
  step 2: w = 5 − 4 = 1   L = 16      ← bounces between 1 and 5

η = 0.30 (diverges)
  step 1: w = 1 + 4.8 = 5.8           L = 31.4
  step 2: grad = 22.4, w = −0.92      L = 61.5    ← every step makes it worse
`)}
<p>In real training this is what a "loss spike" or a NaN often is: a step too large for the local curvature. Learning-rate <b>warmup</b> (start small, ramp up over the first few hundred or thousand steps) and <b>decay</b> (shrink towards the end, often cosine) exist for this reason.</p>

<h3>3.5 Batches, epochs and stochastic gradient descent</h3>
<p>Computing the gradient on the whole dataset per step is too slow, so each step uses a <b>mini-batch</b> (for example 32 examples or 1 million tokens). The batch gradient is a noisy estimate of the true one — hence <i>stochastic</i> gradient descent (SGD). One full pass over the data is an <b>${term('epoch')}</b>. LLM pretraining often sees most data about once; fine-tuning typically runs 1–3 epochs.</p>

<h3>3.6 AdamW: the optimizer every LLM uses</h3>
<p>Plain SGD uses one learning rate for every parameter. ${term('AdamW')} keeps two running averages <b>per parameter</b>: the mean of recent gradients (momentum, <code>m</code>) and the mean of recent squared gradients (<code>v</code>). It divides by √v, so each parameter gets its own effective step size; parameters with consistently large gradients take normalised steps, rarely-updated ones are not starved.</p>
${formula(`
m ← β₁·m + (1 − β₁)·g             (momentum, typical β₁ = 0.9)
v ← β₂·v + (1 − β₂)·g²            (scale,    typical β₂ = 0.95–0.999)

          m / (1 − β₁ᵗ)             ← bias correction for early steps
w ← w − η · ──────────────────  − η·λ·w
           √( v / (1 − β₂ᵗ) ) + ε        ↑ decoupled weight decay (the "W")

WORKED: first step, g = −16, β₁ = 0.9, β₂ = 0.999
        m = 0.1 × (−16) = −1.6          m̂ = −1.6 / 0.1   = −16
        v = 0.001 × 256  = 0.256        v̂ = 0.256 / 0.001 = 256
        update = η × (−16) / (√256) = η × (−1)
                                      ↑ step ≈ η regardless of gradient scale
`)}
<p>The "W" means weight decay is applied directly to the weights rather than mixed into the gradient (Loshchilov &amp; Hutter, "Decoupled Weight Decay Regularization"). It gently pulls weights toward zero, which regularises the model.</p>
${callout('warn','The infrastructure consequence: optimizer state is memory','AdamW stores m and v for every trainable parameter, usually in FP32: 8 bytes per parameter. In mixed-precision training a common layout is BF16 weights (2 B) + BF16 gradients (2 B) + FP32 master weights (4 B) + m and v (8 B) = <b>16 bytes per parameter</b>, before activations. For an 8.03B model: 8.03 × 10⁹ × 16 B ≈ 128 GB — more than one 80 GB GPU. That is why full fine-tuning of an 8B model needs several GPUs or memory sharding, and why LoRA (which trains under 1 % of the parameters) fits on one. See '+L('v1-gpu-memory','GPU memory accounting')+'.')}

<h2>4. Where does it fit?</h2>
${fig('One training step and what lives in GPU memory', svgDiagram({w:900,h:320,
 zones:[{x:20,y:200,w:860,h:100,label:'GPU memory during training'}],
 boxes:[
  {id:'b',x:20,y:40,w:120,h:56,label:'Batch',sub:'inputs + targets'},
  {id:'f',x:180,y:40,w:130,h:56,label:'Forward',sub:'compute ŷ',cls:'hl'},
  {id:'l',x:350,y:40,w:110,h:56,label:'Loss',sub:'one number'},
  {id:'bw',x:500,y:40,w:130,h:56,label:'Backward',sub:'gradients',cls:'hl'},
  {id:'o',x:670,y:40,w:210,h:56,label:'Optimizer step',sub:'AdamW updates weights'},
  {id:'w',x:40,y:230,w:150,h:50,label:'Weights',sub:'read every step'},
  {id:'a',x:220,y:230,w:170,h:50,label:'Activations',sub:'saved for backward'},
  {id:'g',x:420,y:230,w:150,h:50,label:'Gradients',sub:'one per weight'},
  {id:'s',x:600,y:230,w:260,h:50,label:'Optimizer state',sub:'m, v (+ FP32 master)'}
 ],
 arrows:[{from:'b',to:'f'},{from:'f',to:'l'},{from:'l',to:'bw'},{from:'bw',to:'o'},{from:'f',to:'a',cls:'dash'},{from:'bw',to:'g',cls:'dash'},{from:'o',to:'s',cls:'dash'}]
}), 'Inference needs only the weights (plus KV cache for LLMs). Training adds activations, gradients and optimizer state, typically 4–8× more memory.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Tensors and kernels.</b> Every forward and backward operation above is a matrix multiplication or element-wise op executed as a GPU kernel (${L('v1-tensors-pytorch','PyTorch internals')}, ${L('v1-cuda','CUDA')}).</li>
<li><b>Transformers.</b> An LLM is this exact machinery: linear layers, SiLU activations, normalisation and a cross-entropy loss over the vocabulary (${L('v1-transformer','transformer')}).</li>
<li><b>Training loop and checkpoints.</b> The loop above, plus data loading, evaluation and saving state, is a training job (${L('v1-training-loop','training loops')}).</li>
<li><b>Distributed training.</b> When gradients for one batch are computed on many GPUs, they are averaged with an all-reduce before the optimizer step (${L('v2-distributed-training','distributed training')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li><b>Memory budgets</b>: training memory = weights + gradients + optimizer state + activations. Sizing GPUs for a job starts from that sum.</li>
<li><b>Training telemetry</b>: loss curve, learning-rate schedule, <b>gradient norm</b>, throughput (tokens/s), and GPU memory — exported to the same Grafana/Mimir stack as service metrics, or an experiment tracker (${L('v2-mlops-foundations','MLflow/W&amp;B')}).</li>
<li><b>Alerting on learning, not just liveness</b>: alert on NaN loss, loss spikes, or a flat loss, not only on pod restarts.</li>
<li><b>Reproducibility</b>: seeds, pinned library versions, recorded hyperparameters.</li>
</ul>
${callout('devops','DevOps bridge — a control loop with a different signal','Gradient descent resembles an autoscaler’s control loop: measure error, adjust, repeat; too aggressive a gain causes oscillation (just like η = 0.25 above). Where it breaks: an HPA has one or two knobs and a clear target; the optimizer turns billions of knobs at once, and "healthy" infrastructure says nothing about whether it is converging.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Loss becomes NaN or inf','Learning rate too high; FP16 overflow; division by zero or log(0) in a custom loss; corrupt batch','Gradient-norm spike just before NaN; which step; data batch ID','Lower η, add warmup, gradient clipping (e.g. max norm 1.0), BF16 instead of FP16, skip/inspect bad batch'],
 ['Loss flat from step 0','Learning rate far too low; frozen parameters; labels not aligned; zero gradients','Gradient norm ≈ 0; count of trainable parameters','Check <code>requires_grad</code>, optimizer param list, label shift'],
 ['First loss far from ln(vocab)','Wrong vocab size, wrong labels, padding counted in loss','Initial loss value','Fix tokenizer/vocab mismatch; mask padding (label −100 in PyTorch convention)'],
 ['Loss oscillates, never settles','η too high for later training','Loss curve saw-tooth','Learning-rate decay; smaller η'],
 ['Training loss falls, validation loss rises','Overfitting','Gap between curves widening','Early stopping, more data, regularisation (see '+L('v1-training-loop','training loops')+')'],
 ['Gradients explode in deep nets','Unnormalised activations, bad init','Gradient norm growing per layer','Normalisation layers, residual connections, clipping']
])}
<div class="dtree"><ul><li><span class="q">Loss is NaN — where do I start?</span><ul>
<li><span class="a">step</span>Find the first NaN step and log the gradient norm for the 50 steps before it.</li>
<li><span class="a">spike first?</span>Gradient norm spiked → instability: lower η, add clipping/warmup, use BF16.</li>
<li><span class="a">no spike?</span>Sudden NaN → bad data or numeric bug: replay that exact batch on CPU in FP32.</li>
<li><span class="a">after resume?</span>Optimizer or scheduler state not restored → see ${L('v1-training-loop','checkpoints')}.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Bigger batches</b> give smoother gradients and better GPU utilisation, up to a point; larger batches often need a larger learning rate and warmup.</li>
<li><b>Gradient accumulation</b>: run several micro-batches, add up their gradients, then step once — a large effective batch with small memory.</li>
<li><b>Data parallelism</b>: each GPU computes gradients on different data; gradients are averaged across GPUs (${L('v2-parallelism','parallelism')}).</li>
<li><b>Activation checkpointing</b>: do not store all activations; recompute them during backward. Trades ≈ 30 % more compute for much less memory (exact overhead depends on what is recomputed).</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>Training cost ≈ GPU-hours × price. You reduce it by: not training at all (prompting or RAG); training fewer parameters (LoRA); using BF16/FP8 tensor cores; avoiding wasted runs with small pilot runs and good learning-rate choices; and stopping early when validation loss stops improving. A diverged run that is noticed after 3 days instead of 30 minutes is the most common avoidable cost — alert on loss and gradient norm.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Walk me through what happens in one training step.”','<p><i>Answer (≈50 s):</i> "A batch is loaded onto the GPU and the forward pass runs it through the layers — mostly matrix multiplications — saving activations. The loss function turns the predictions into one number; for LLMs that is cross-entropy over the vocabulary for every next-token position. Backward applies the chain rule from the loss back through every layer, producing a gradient for every parameter and reusing intermediate results so it costs about twice the forward. The optimizer, usually AdamW, updates each weight using its gradient plus per-parameter momentum and scale statistics, which is 8 extra bytes per parameter. Then gradients are zeroed and the next batch starts. Operationally I watch loss, gradient norm, learning rate, tokens per second and memory, and I alert on NaNs and spikes, because a pod can be healthy while training has diverged."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"The model looks at the data and learns from its mistakes using backpropagation."</p></div><div class="good"><h4>Strong answer</h4><p>Names forward → loss → backward → optimizer step → zero grads, explains the chain rule and gradient reuse, quantifies optimizer memory, and says what to monitor.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Weights','forward pass','loss','backward (chain rule)','gradients','AdamW step'])}
${chain(['16 bytes per parameter','GPU memory','LoRA / sharding','GPU count','training cost'])}
<p>Next: ${L('v1-tensors-pytorch','tensors and PyTorch')} shows how <code>loss.backward()</code> becomes an autograd graph and CUDA kernels. Later: ${L('v1-training-loop','training loops')} turns this into a resumable job, and ${L('v1-gpu-memory','GPU memory accounting')} turns the 16 B/parameter rule into capacity plans.</p></div>

<h3>Lab</h3>
<p>The planned lab <code>labs/01-pytorch-basics/tiny_mlp.py</code> runs this loop on a toy classification task. Before running anything, predict the first loss for 2 classes (answer: ln 2 ≈ 0.693), then multiply the learning rate by 100 and watch the loss curve. A minimal version:</p>
${code('python',`import torch
from torch import nn

torch.manual_seed(0)
x = torch.randn(512, 4)
y = (x[:, 0] + 2 * x[:, 1] > 0).long()          # 2 classes
model = nn.Sequential(nn.Linear(4, 16), nn.ReLU(), nn.Linear(16, 2))
opt = torch.optim.AdamW(model.parameters(), lr=1e-2, weight_decay=0.01)

for step in range(201):
    logits = model(x)                            # forward
    loss = nn.functional.cross_entropy(logits, y)
    opt.zero_grad(set_to_none=True)
    loss.backward()                              # backward: fills p.grad
    opt.step()                                   # AdamW update
    if step % 50 == 0:
        print(step, round(loss.item(), 4))       # first value near 0.69`)}
`,
  quiz:[
    {q:'A linear layer maps 1,024 inputs to 4,096 outputs with biases. How many parameters?',options:['4,194,304','4,198,400','5,120','4,195,328'],answer:1,explain:'1,024 × 4,096 = 4,194,304 weights plus 4,096 biases = 4,198,400. Forgetting the biases gives 4,194,304.'},
    {q:'Logits [2.0, 1.0, 0.1], true class is the first. Cross-entropy loss is about…',options:['0.42','0.66','2.31','1.10'],answer:0,explain:'Softmax gives p₁ = 7.389/11.212 = 0.659; −ln(0.659) ≈ 0.417. 0.66 is the probability, not the loss; 2.31 is the loss if the third class were correct.'},
    {q:'In the two-weight example (x = 2, h = w₁x, ŷ = w₂h, L = (ŷ−y)²), ∂L/∂ŷ = −8 and w₂ = 2. What is ∂L/∂w₁?',options:['−16','−24','−32','−8'],answer:2,explain:'∂L/∂h = ∂L/∂ŷ · w₂ = −16, then ∂L/∂w₁ = ∂L/∂h · x = −16 × 2 = −32. −24 is ∂L/∂w₂ (uses h = 3).'},
    {q:'Loss goes 16 → 16 → 16 while w alternates between 1 and 5. What is happening?',options:['Converged','Learning rate is exactly at the oscillation edge for this curvature','Gradients are zero','The data is corrupt'],answer:1,explain:'For L = (2w−6)², η = 0.25 makes every step overshoot by exactly the same amount, so it bounces. Smaller η converges; larger diverges.'},
    {q:'Why does full fine-tuning with AdamW in mixed precision need about 16 bytes per parameter?',options:['Weights are stored four times','BF16 weights 2 + BF16 grads 2 + FP32 master 4 + Adam m and v 8','KV cache needs 16 bytes per token','Activations are 16 bytes per parameter'],answer:1,explain:'That breakdown is the standard estimate, before activations. KV cache is an inference concept; activations depend on batch and sequence, not parameter count.'},
    {q:'The first logged loss of a new LLM training run with a 128,256-token vocabulary is 2.1. What should you suspect?',options:['Great initialisation','A bug: random init should give ≈ ln(128,256) ≈ 11.8','The learning rate is too low','Normal behaviour'],answer:1,explain:'An untrained model is near uniform, so loss ≈ ln(vocab). A much lower first loss suggests label leakage, wrong loss masking or a loaded checkpoint you did not expect.'}
  ],
  flashcards:[
    {front:'Neuron equation',back:'z = Σ wᵢxᵢ + b, a = φ(z). A layer is y = φ(xW + b).'},
    {front:'Cross-entropy loss',back:'−ln(p_correct), with p from softmax over logits. Untrained LLM: ≈ ln(vocab size), e.g. ln(128,256) ≈ 11.76.'},
    {front:'Chain rule in backprop',back:'∂L/∂w = ∂L/∂ŷ · ∂ŷ/∂h · ∂h/∂w; intermediate terms are reused, so backward ≈ 2× forward cost.'},
    {front:'Gradient descent update',back:'w ← w − η·∂L/∂w. η too small: slow. Too large: oscillation or divergence.'},
    {front:'What AdamW stores per parameter',back:'Two FP32 moments (m, v) = 8 bytes; with BF16 weights + grads + FP32 master ≈ 16 bytes per parameter total.'},
    {front:'Perplexity',back:'e^(cross-entropy loss). Uniform guessing over V tokens has perplexity V.'},
    {front:'First thing to check on a NaN loss',back:'The step it first appears and the gradient norm before it: spike → instability (η, clipping, FP16); no spike → bad data or numeric bug.'}
  ]
});
registerGlossary([
  {term:'Neural network',def:'A function built from stacked layers of weighted sums, biases and non-linear activations, whose parameters are learned by gradient descent.',lesson:'v1-neural-networks'},
  {term:'Weight',def:'A learned multiplier on an input connection; most of a model’s parameters are weights in matrices.',lesson:'v1-neural-networks',aliases:['weights']},
  {term:'Bias',def:'A learned constant added to a neuron’s weighted sum, letting it shift its output independently of the input. (Many LLM linear layers omit biases.)',lesson:'v1-neural-networks'},
  {term:'Activation function',def:'A non-linear function applied after a weighted sum (ReLU, GELU, SiLU). Without it, stacked layers collapse into one linear map.',lesson:'v1-neural-networks',aliases:['ReLU','SiLU']},
  {term:'Activations',def:'Intermediate outputs of layers for a given batch; kept in memory during training for the backward pass.',lesson:'v1-neural-networks'},
  {term:'Loss function',def:'A function that scores how wrong a prediction is as one number; training minimises it. Examples: MSE, cross-entropy.',lesson:'v1-neural-networks',aliases:['loss']},
  {term:'Mean squared error',def:'Average of squared differences between predictions and targets; the standard loss for regression.',lesson:'v1-neural-networks',aliases:['MSE']},
  {term:'Cross-entropy',def:'Loss for classification and language modelling: −ln of the probability the model assigned to the correct class or token.',lesson:'v1-neural-networks',aliases:['cross-entropy loss']},
  {term:'Gradient',def:'The vector of partial derivatives of the loss with respect to each parameter; points uphill, so training steps the opposite way.',lesson:'v1-neural-networks',aliases:['gradients']},
  {term:'Backpropagation',def:'Computing all gradients by applying the chain rule from the loss backwards through the network, reusing intermediate results.',lesson:'v1-neural-networks',aliases:['backprop','backward pass']},
  {term:'Gradient descent',def:'Optimisation that repeatedly moves parameters a small step opposite to the gradient: w ← w − η·∂L/∂w. With mini-batches it is stochastic gradient descent (SGD).',lesson:'v1-neural-networks',aliases:['SGD']},
  {term:'Learning rate',def:'The step-size hyperparameter η in gradient descent; usually warmed up then decayed during training.',lesson:'v1-neural-networks'},
  {term:'Epoch',def:'One full pass of training over the dataset.',lesson:'v1-neural-networks'},
  {term:'AdamW',def:'Adaptive optimizer keeping per-parameter momentum and squared-gradient averages, with weight decay applied directly to weights. Costs about 8 bytes of FP32 state per trainable parameter.',lesson:'v1-neural-networks',aliases:['Adam']},
  {term:'Perplexity',def:'e raised to the cross-entropy loss; the effective number of equally likely choices the model is unsure between.',lesson:'v1-neural-networks'},
  {term:'Gradient clipping',def:'Rescaling gradients when their overall norm exceeds a threshold, to prevent a single bad step from destabilising training.',lesson:'v1-neural-networks'}
]);

/* ------------------------------------------------------------------ */
/* 1.1.3  Tensors and PyTorch: from Python to GPU kernels              */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v1-tensors-pytorch', vol:1, part:1, num:3,
  title:'Tensors and PyTorch: from Python to GPU kernels', minutes:95,
  summary:'A tensor is a block of numbers in memory plus a small description of how to read it: its shape, its strides, its data type and the device it lives on. When you write a matrix multiplication in PyTorch, the call passes through a dispatcher that decides, layer by layer, whether to record it for gradients, which precision to use and which backend to run, and ends up as a CUDA kernel launched asynchronously on the GPU. Autograd records a graph of these operations so the backward pass can be computed. The caching allocator recycles GPU memory, and torch compile can fuse many small operations into fewer, faster kernels. Knowing this chain explains most performance and memory surprises an infrastructure engineer sees.',
  objectives:[
    'Predict the shape, element count and bytes of tensors in a transformer layer, and recognise shape errors before running code.',
    'Explain a tensor as storage plus view metadata (sizes, strides, offset, dtype, device) and why some views are non-contiguous.',
    'Trace one PyTorch operation through the dispatcher and ATen to a CUDA kernel, and explain asynchronous execution and synchronisation points.',
    'Explain how autograd builds and walks the graph, and what memory it keeps alive.',
    'Read memory_allocated versus memory_reserved, explain the caching allocator, and decide when torch.compile helps.'
  ],
  prereqs:['v1-neural-networks'],
  next:['v1-transformer','v1-training-loop','v1-cuda','v1-gpu-memory'],
  tags:['pytorch','tensors','gpu','internals'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A tensor is like a database table stored as one flat file, plus a schema that says how to read rows and columns from it. Change the schema (transpose, slice) and you see different data without copying the file. Now the real mechanism.')}
<p>A ${term('tensor')} is an n-dimensional array of numbers with four properties you must always know:</p>
${table(['Property','Example','Why an infra engineer cares'],[
 ['<b>shape</b>','<code>[8, 4096, 4096]</code> = batch × sequence × hidden','Decides which operations are legal and how much memory is used'],
 ['<b>dtype</b>','float32 (4 B), bfloat16 / float16 (2 B), float8 (1 B), int8 (1 B)','Bytes per element; which hardware units (Tensor Cores) are used'],
 ['<b>device</b>','<code>cpu</code>, <code>cuda:0</code>','Operands must be on the same device; copies cross PCIe'],
 ['<b>layout / strides</b>','contiguous or a strided view','Non-contiguous tensors can force hidden copies or slower kernels']
])}
<p>${term('PyTorch')} is the framework that creates tensors, runs operations on them on CPU or GPU, records how outputs were computed so it can differentiate them (autograd), and provides building blocks (<code>nn.Linear</code>, optimizers, data loaders). Almost every open-weight LLM is trained in PyTorch, and vLLM, SGLang and (since v1.0) TensorRT-LLM’s default backend execute models through PyTorch too.</p>

<h3>Shapes in a transformer: the ones you will see daily</h3>
${table(['Tensor','Shape','Llama-3.1-8B example','BF16 bytes'],[
 ['Token IDs','[B, T]','[1, 4096]','int64: 32 KiB'],
 ['Hidden states','[B, T, d]','[1, 4096, 4096]','2 × 4096 × 4096 = 32 MiB'],
 ['Q projection weight','[d, d]','[4096, 4096]','32 MiB'],
 ['K or V projection weight','[d, kv_heads × head_dim]','[4096, 1024]','8 MiB'],
 ['Q after head split','[B, heads, T, head_dim]','[1, 32, 4096, 128]','32 MiB'],
 ['Attention scores (if materialised)','[B, heads, T, T]','[1, 32, 4096, 4096]','2 × 32 × 4096² = 1 GiB'],
 ['Logits','[B, T, vocab]','[1, 4096, 128256]','≈ 1.05 GB (1,002 MiB)']
])}
<p>Two lessons hide in that table. First, the attention score matrix grows with T², which is why fused attention kernels (FlashAttention) never materialise it. Second, the logits for a long sequence are large: computing loss over 128,256 classes for every position is a real memory cost in training.</p>
${formula(`
Logits for one 4,096-token sequence in BF16
   4,096 × 128,256 × 2 B = 1,050,673,152 B ≈ 1.05 GB ≈ 0.98 GiB
   and FP32 for a numerically safe softmax doubles it.
`)}

<h2>2. Why do we need it?</h2>
<p>Neural networks are mostly matrix multiplications over very large arrays. Python lists are far too slow, and hand-writing GPU code for every layer is impractical. PyTorch gives a NumPy-like interface where the same line of Python runs on CPU or GPU, automatically picks fast vendor libraries (cuBLAS, cuDNN), and computes gradients for you. It is the layer between "a researcher’s model definition" and "kernels on a GPU", so most performance and memory problems you will debug live in the behaviour of this layer.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 A tensor is storage + view metadata</h3>
<p>Every tensor has a <b>storage</b> (one flat block of bytes on a device) and a <b>view</b>: sizes, ${term('stride','strides')} (how many elements to skip to move one step along each dimension), a storage offset, the dtype and the device. Many operations — <code>transpose</code>, <code>view</code>, slicing, <code>expand</code> — only create new metadata over the <i>same</i> storage. No data moves.</p>
${formula(`
a = torch.arange(6).reshape(2, 3)        storage: [0 1 2 3 4 5]
    shape (2, 3)   strides (3, 1)        a[i, j] = storage[3i + 1j]
    [[0 1 2]
     [3 4 5]]

b = a.t()        (transpose: SAME storage, new view)
    shape (3, 2)   strides (1, 3)        b[i, j] = storage[1i + 3j]
    [[0 3]
     [1 4]
     [2 5]]
    b.is_contiguous() → False             ← rows are not adjacent in memory

c = b.contiguous()   → allocates a new storage [0 3 1 4 2 5], strides (2, 1)
`)}
${fig('Two tensors, one storage', svgDiagram({w:900,h:250,
 boxes:[
  {id:'st',x:300,y:170,w:300,h:50,label:'Storage (cuda:0)',sub:'0 1 2 3 4 5 — 6 × int64',cls:'v2'},
  {id:'a',x:80,y:40,w:220,h:64,label:'Tensor a',sub:'shape (2,3) strides (3,1)'},
  {id:'b',x:340,y:40,w:220,h:64,label:'Tensor b = a.t()',sub:'shape (3,2) strides (1,3)',cls:'hl'},
  {id:'c',x:620,y:40,w:220,h:64,label:'c = b.contiguous()',sub:'new storage, strides (2,1)',cls:'warn'}
 ],
 arrows:[{from:'a',to:'st',fromSide:'bottom',toSide:'top'},{from:'b',to:'st',fromSide:'bottom',toSide:'top'},{from:'c',to:'st',fromSide:'bottom',toSide:'right',cls:'dash',label:'copied from'}]
}), 'Views share storage: writing through b changes a. .contiguous() and some reshape calls silently allocate and copy — a common source of extra memory and time.')}
<p>Consequences you will see: modifying a view modifies the original; <code>.view()</code> fails on non-contiguous tensors while <code>.reshape()</code> silently copies; a small slice of a huge tensor keeps the whole storage alive (a memory leak pattern when you keep "just one row" of the logits).</p>

<h3>3.2 From Python call to GPU kernel: the dispatcher</h3>
<p>When you write <code>y = x @ w</code> with CUDA tensors, the work passes through several layers. The animation follows one call.</p>
${anim('v1-pt-dispatch')}
<ol>
<li><b>Python frontend</b>: <code>torch.matmul</code> is a thin binding into C++.</li>
<li><b>${term('Dispatcher')}</b>: every PyTorch operator (for example <code>aten::mm</code>) has a table of implementations keyed by <b>dispatch keys</b> computed from the inputs and the current mode. The dispatcher calls them in priority order. Typical keys: <i>Autograd</i> (record a graph node if any input requires grad), <i>Autocast</i> (pick a lower precision inside <code>torch.autocast</code>), then a <i>backend</i> key such as <i>CUDA</i> or <i>CPU</i>. Tracing and functionalisation for <code>torch.compile</code> are also dispatch keys.</li>
<li><b>ATen</b> ("A Tensor library") is PyTorch’s C++ operator library. The CUDA kernel implementation of <code>mm</code> calls <b>cuBLAS</b> (or cuBLASLt), NVIDIA’s matrix library, which selects a GEMM kernel that uses Tensor Cores for BF16/FP16.</li>
<li><b>Kernel launch</b>: the CPU enqueues the kernel on a <b>${term('CUDA stream')}</b> (a FIFO queue of GPU work) and <b>returns immediately</b>. The Python line finishes before the GPU has computed anything.</li>
<li><b>GPU execution</b>: the kernel runs across the GPU’s streaming multiprocessors, reading weights from HBM (${L('v1-gpu-architecture','GPU architecture')}, ${L('v1-cuda','CUDA')}).</li>
</ol>
${callout('warn','Asynchronous execution changes how you time and debug','Because launches are asynchronous, <code>time.time()</code> around a GPU op measures the launch (microseconds), not the work. Anything that needs a GPU value on the CPU forces a <b>synchronisation</b>: <code>.item()</code>, <code>.cpu()</code>, <code>print(tensor)</code>, <code>.tolist()</code>, <code>torch.cuda.synchronize()</code>. A stray <code>loss.item()</code> every step stalls the CPU until the GPU finishes, so the CPU cannot queue ahead. Errors are asynchronous too: a CUDA error may be reported at a later, unrelated line. Set <code>CUDA_LAUNCH_BLOCKING=1</code> when debugging to make launches synchronous (slow, debugging only).')}

<h3>3.3 Autograd: the graph built during the forward pass</h3>
<p>If any input has <code>requires_grad=True</code>, the Autograd dispatch key records a node for every operation: its backward function (<code>MmBackward0</code>, <code>AddBackward0</code>…) and the tensors it needs for backward (<b>saved tensors</b>, i.e. activations). The output’s <code>.grad_fn</code> points at that node. <code>loss.backward()</code> walks the graph in reverse topological order, applying the chain rule exactly as in ${L('v1-neural-networks','the two-weight example')}, and <b>accumulates</b> results into <code>.grad</code> of leaf tensors (the parameters). After backward, the graph and its saved activations are freed.</p>
${code('python',`import torch
x  = torch.tensor([2.0])
w1 = torch.tensor([1.5], requires_grad=True)
w2 = torch.tensor([2.0], requires_grad=True)
h  = w1 * x                 # h.grad_fn = MulBackward0  (saves x)
y  = w2 * h                 # y.grad_fn = MulBackward0  (saves h)
loss = (y - 10) ** 2        # PowBackward0
loss.backward()
print(w1.grad, w2.grad)     # tensor([-32.]) tensor([-24.])  -- same as by hand`)}
<ul>
<li><b>Gradients accumulate</b>: calling backward twice adds. That is why training loops call <code>optimizer.zero_grad()</code> each step, and why gradient accumulation works for free.</li>
<li><b>Saved tensors are the activation memory</b> of training. Inside <code>torch.no_grad()</code> or <code>torch.inference_mode()</code> no graph is built, which is why inference needs far less memory.</li>
<li>Keeping a reference to <code>loss</code> (not <code>loss.item()</code>) in a Python list keeps every step’s graph alive — a classic GPU memory leak.</li>
</ul>

<h3>3.4 CUDA streams and overlap</h3>
<p>Kernels on one stream run in order; kernels on different streams may overlap. PyTorch uses a default stream per device unless you create others. Data loading uses <b>pinned (page-locked) host memory</b> and <code>.to('cuda', non_blocking=True)</code> so the copy over PCIe can overlap with compute. Distributed training overlaps gradient all-reduce (NCCL, on its own stream) with the rest of backward (${L('v2-distributed-training','distributed training')}).</p>

<h3>3.5 The caching allocator</h3>
<p><code>cudaMalloc</code> and <code>cudaFree</code> are slow and can synchronise the device. PyTorch’s ${term('caching allocator')} requests large segments from the driver once, then carves blocks out of them and <b>keeps freed blocks</b> for reuse instead of returning them.</p>
${table(['Number','Meaning','Where you see it'],[
 ['<code>torch.cuda.memory_allocated()</code>','Bytes in live tensors right now','Your model’s real usage'],
 ['<code>torch.cuda.memory_reserved()</code>','Bytes held by the caching allocator (allocated + cached free blocks)','Upper bound of what PyTorch holds'],
 ['nvidia-smi "memory used"','Reserved + CUDA context (often several hundred MiB) + other processes','What ops dashboards and DCGM show']
])}
<p>So nvidia-smi showing a process at 70 GB does not mean 70 GB of live tensors. And an out-of-memory error can occur with plenty of "free" memory if it is <b>fragmented</b> into blocks too small for the request; the OOM message prints both reserved and allocated figures so you can tell. The allocator is configurable through the <code>PYTORCH_CUDA_ALLOC_CONF</code> environment variable (for example <code>expandable_segments:True</code> to reduce fragmentation). Full OOM troubleshooting is in ${L('v1-gpu-memory','GPU memory accounting')}.</p>
${callout('unverified','Verify allocator option names for your PyTorch version','Allocator settings and their environment variable names have evolved across PyTorch 2.x releases (recent releases also accept a device-generic name). Check the CUDA semantics page of the docs for the version you pin before putting a setting in a Helm chart.')}

<h3>3.6 torch.compile: from many small kernels to fewer fused ones</h3>
<p>In normal ("eager") mode every operation is a separate kernel launch that reads its inputs from HBM and writes its output back. For a chain like <code>x * sigmoid(x) * up</code> that is three round trips to memory and three launches. ${term('torch.compile')} captures the model into a graph and generates optimised code:</p>
<ol>
<li><b>TorchDynamo</b> intercepts Python bytecode at run time and extracts an FX graph of tensor operations; code it cannot trace causes a <b>graph break</b> (it falls back to eager there).</li>
<li><b>AOTAutograd</b> derives the backward graph ahead of time.</li>
<li><b>TorchInductor</b> generates kernels — Triton kernels on GPU, C++ on CPU — <b>fusing</b> element-wise chains into single kernels so data is read once.</li>
<li><code>mode="reduce-overhead"</code> also uses <b>CUDA Graphs</b>: record a whole sequence of launches once, replay it with a single launch, removing CPU launch overhead (vital for small decode batches).</li>
</ol>
${formula(`
Why fusion matters for a memory-bound op chain (illustrative)
  tensor of 64 M BF16 elements = 128 MB
  eager:  3 kernels × (read 128 MB + write 128 MB) ≈ 768 MB of HBM traffic
          (more, since the multiply reads two inputs)
  fused:  1 kernel reads x and up once, writes once ≈ 384 MB
  on a 3.35 TB/s H100:  ≈ 0.23 ms  →  ≈ 0.11 ms
`)}
<p>Costs: the first call compiles (seconds to minutes), <b>new input shapes can trigger recompilation</b>, and graph breaks silently reduce the benefit. Inference engines handle this for you (vLLM compiles and captures CUDA graphs for a set of batch sizes at startup, which is part of its start-up time — see ${L('v1-k8s-serving','serving on Kubernetes')}).</p>

<h2>4. Where does it fit?</h2>
${fig('The software stack from model code to silicon', svgDiagram({w:900,h:340,
 boxes:[
  {id:'m',x:30,y:20,w:260,h:48,label:'Model code (nn.Module)',sub:'Llama, your tiny GPT'},
  {id:'eng',x:330,y:20,w:250,h:48,label:'Engines / trainers',sub:'vLLM, SGLang, HF Trainer'},
  {id:'pt',x:30,y:100,w:550,h:48,label:'PyTorch: Python API, autograd, torch.compile',cls:'hl'},
  {id:'disp',x:30,y:170,w:550,h:40,label:'Dispatcher → ATen operators'},
  {id:'lib',x:30,y:230,w:550,h:40,label:'cuBLAS, cuDNN, NCCL, Triton / custom CUDA kernels'},
  {id:'drv',x:30,y:290,w:550,h:40,label:'CUDA runtime + NVIDIA driver'},
  {id:'gpu',x:640,y:170,w:230,h:160,label:'GPU',sub:'SMs, Tensor Cores, HBM',cls:'v2'}
 ],
 arrows:[{from:'m',to:'pt',fromSide:'bottom',toSide:'top'},{from:'eng',to:'pt',fromSide:'bottom',toSide:'top'},{from:'pt',to:'disp',fromSide:'bottom',toSide:'top'},{from:'disp',to:'lib',fromSide:'bottom',toSide:'top'},{from:'lib',to:'drv',fromSide:'bottom',toSide:'top'},{from:'drv',to:'gpu',label:'launch'}]
}), 'Version compatibility runs down this stack: PyTorch wheel ↔ CUDA runtime ↔ driver ↔ GPU architecture. Your container image pins the top layers; the node pins the driver.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Container images.</b> A PyTorch wheel is built for a CUDA version (for example a <code>cu12x</code> wheel). It bundles the CUDA runtime libraries but needs a host <b>driver</b> new enough for that runtime. Mismatch → "CUDA driver version is insufficient" at start-up (${L('v1-k8s-gpu-stack','GPU stack on Kubernetes')}).</li>
<li><b>Inference engines</b> are PyTorch programs with custom kernels and their own memory managers (KV cache) on top of the caching allocator (${L('v1-kv-cache','KV cache')}).</li>
<li><b>Profiling.</b> <code>torch.profiler</code> and NVIDIA Nsight Systems show the dispatcher’s kernel launches on a timeline (${L('v1-multi-gpu-profiling','profiling')}).</li>
<li><b>Distributed.</b> <code>torch.distributed</code> wraps NCCL collectives; FSDP shards parameters and optimizer state (${L('v2-distributed-training','distributed training')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li><b>The compatibility matrix</b>: driver version on nodes, CUDA runtime in images, PyTorch version, engine version. Pin all four and test upgrades together.</li>
<li><b>Images</b>: CUDA-enabled base images are large (several GB); use layer caching and pre-pull on GPU nodes to cut cold starts.</li>
<li><b>Environment knobs</b>: allocator configuration, <code>CUDA_VISIBLE_DEVICES</code> (set by the device plugin in Kubernetes), NCCL settings, compile cache directories (persist them to avoid recompiling on every pod start).</li>
<li><b>Metrics</b>: GPU memory used vs. PyTorch reserved/allocated, GPU utilisation (time a kernel was running — not efficiency), SM activity from DCGM.</li>
</ul>
${callout('devops','DevOps bridge','The dispatcher is like an Envoy filter chain: each key (autograd, autocast, backend) is a filter that may act and then pass the call on. The caching allocator is like a connection pool: the process holds resources it is not currently using so the next request is fast — which is why "used" memory from outside looks higher than real usage. Where it breaks: nothing in Kubernetes resource accounting sees GPU memory at all.')}

<h2>7. What happens when it fails?</h2>
${table(['Error / symptom','Cause','Fix'],[
 ['<code>RuntimeError: mat1 and mat2 shapes cannot be multiplied (32x512 and 256x10)</code>','Inner dimensions differ (512 ≠ 256)','Fix the layer’s in_features or the input projection'],
 ['<code>Expected all tensors to be on the same device</code>','One operand on CPU, one on cuda:0','Move model and batch with <code>.to(device)</code>; check newly created tensors'],
 ['<code>view size is not compatible with input tensor’s size and stride</code>','<code>.view()</code> on a non-contiguous tensor','<code>.reshape()</code> or <code>.contiguous().view()</code>'],
 ['<code>CUDA out of memory</code> while reserved ≫ allocated','Fragmentation','Allocator expandable segments; consistent shapes; smaller batch'],
 ['GPU memory grows every step','Holding graph references (<code>losses.append(loss)</code>)','Store <code>loss.item()</code> or <code>loss.detach()</code>'],
 ['Training slower than expected, GPU utilisation low','CPU-bound: data loader, Python overhead, sync points (<code>.item()</code> every step)','More loader workers, pinned memory, remove syncs, torch.compile/CUDA graphs'],
 ['CUDA error reported at a random line','Asynchronous error reporting','Rerun with <code>CUDA_LAUNCH_BLOCKING=1</code>'],
 ['Slow first steps, then fast; recompiles in logs','torch.compile warm-up or shape-driven recompilation','Pad to fixed shape buckets; mark dynamic dims; persist compile cache']
])}

<h2>8. How do we scale it?</h2>
<p>Within one GPU: bigger batches to fill Tensor Cores, fused kernels, BF16, CUDA graphs. Across GPUs: data parallelism (DDP), sharded data parallelism (FSDP) when the model plus optimizer does not fit, tensor/pipeline parallelism for huge models (${L('v2-parallelism','parallelism')}). The scaling limit is usually not PyTorch itself but memory bandwidth, interconnect, or the CPU’s ability to launch kernels quickly enough.</p>

<h2>9. How do we optimize its cost?</h2>
<ul>
<li><b>Use the right dtype</b>: BF16 halves memory versus FP32 and runs on Tensor Cores; enable TF32 for remaining FP32 matmuls (<code>torch.set_float32_matmul_precision("high")</code>).</li>
<li><b>Remove sync points</b> and keep the GPU fed: a GPU waiting on Python is billed at the same hourly rate.</li>
<li><b>Fuse and compile</b> hot paths; for inference, rely on the engine’s compiled graphs.</li>
<li><b>Measure, do not guess</b>: <code>torch.profiler</code> traces before buying more GPUs.</li>
</ul>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“What actually happens when PyTorch runs a matmul on a GPU?”','<p><i>Answer (≈50 s):</i> "The Python call goes into the C++ dispatcher. The dispatcher computes dispatch keys from the inputs and current modes, so if a parameter requires grad the autograd layer records a backward node and saves the inputs it needs; under autocast it casts to BF16; then the CUDA backend’s ATen implementation calls cuBLAS, which picks a Tensor Core GEMM kernel. The kernel is enqueued on a CUDA stream and Python returns immediately — execution is asynchronous until something like .item() synchronises. Output memory comes from PyTorch’s caching allocator, which reuses blocks, so nvidia-smi shows reserved memory rather than live tensors. torch.compile changes this path by capturing a graph and fusing ops into Triton kernels, and CUDA graphs remove per-kernel launch overhead."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"PyTorch sends the matrix to the GPU and the GPU multiplies it."</p></div><div class="good"><h4>Strong answer</h4><p>Names dispatcher → autograd/autocast → ATen → cuBLAS → stream; explains asynchrony, sync points, the caching allocator and compile/fusion.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Python op','dispatcher','autograd node','ATen','cuBLAS kernel','CUDA stream','GPU SMs'])}
${chain(['caching allocator','reserved vs allocated','nvidia-smi view','OOM triage'])}
<p>Next: ${L('v1-transformer','the transformer')} is built from exactly these tensor ops. Later: ${L('v1-cuda','CUDA programming')} opens the kernel box, and ${L('v1-gpu-memory','GPU memory accounting')} uses the allocator numbers.</p></div>

<h3>Lab</h3>
<p>The planned lab <code>labs/01-pytorch-basics/tensors_autograd.py</code> prints shapes, strides and gradients. Try this short version and predict every output first:</p>
${code('python',`import torch
a = torch.arange(6).reshape(2, 3)
b = a.t()
print(a.stride(), b.stride(), b.is_contiguous())   # (3, 1) (1, 3) False
print(a.untyped_storage().data_ptr() == b.untyped_storage().data_ptr())  # True
b[0, 1] = 100
print(a)                                          # a[1, 0] is now 100

if torch.cuda.is_available():
    x = torch.randn(4096, 4096, device="cuda", dtype=torch.bfloat16)
    y = x @ x                                     # returns immediately
    torch.cuda.synchronize()                      # wait for the kernel
    print(torch.cuda.memory_allocated() / 2**20, "MiB allocated")
    print(torch.cuda.memory_reserved() / 2**20, "MiB reserved")`)}
`,
  quiz:[
    {q:'A tensor has shape (2, 3) and strides (3, 1). After .t(), what are the strides and is it contiguous?',options:['(3, 1), contiguous','(1, 3), not contiguous','(2, 1), contiguous','(1, 2), not contiguous'],answer:1,explain:'Transpose swaps sizes and strides without copying, so strides become (1, 3) and rows are no longer adjacent. (2, 1) is what .contiguous() would produce after copying.'},
    {q:'You time y = x @ w on a GPU with time.time() and get 15 microseconds for a large matmul. Why?',options:['cuBLAS is extremely fast','The kernel launch is asynchronous; you measured the enqueue, not the computation','The result was cached','The GPU skipped the work'],answer:1,explain:'Python returns after enqueuing on the stream. Synchronise (torch.cuda.synchronize or CUDA events) before stopping the timer.'},
    {q:'nvidia-smi shows the training process using 70 GB, but torch.cuda.memory_allocated() reports 40 GB. Most likely explanation?',options:['A memory leak in the driver','The caching allocator holds freed blocks for reuse, plus CUDA context','Another pod is using the GPU','Kubernetes is reserving memory'],answer:1,explain:'Reserved (cached) memory and context count in nvidia-smi but are not live tensors. Kubernetes does not account GPU memory.'},
    {q:'Which dispatcher layer records the information needed for loss.backward()?',options:['CUDA backend key','Autograd key','Autocast key','The NVIDIA driver'],answer:1,explain:'The Autograd key creates graph nodes and saves tensors. Autocast only chooses precision; the backend runs the kernel.'},
    {q:'What does torch.compile’s TorchInductor mainly do to speed up element-wise chains?',options:['Lowers precision to FP8','Fuses several ops into one generated kernel so data is read from HBM once','Moves work to the CPU','Increases batch size'],answer:1,explain:'Fusion reduces memory traffic and launches. Precision is unchanged unless you ask; batch size is your choice.'},
    {q:'GPU memory grows by a few hundred MB every training step until OOM. Which code is the likely culprit?',options:['optimizer.zero_grad()','losses.append(loss) for logging','torch.no_grad() during eval','model.to("cuda")'],answer:1,explain:'Keeping the loss tensor keeps its whole autograd graph and saved activations alive. Append loss.item() instead.'}
  ],
  flashcards:[
    {front:'Four things to know about every tensor',back:'shape, dtype (bytes/element), device, and layout/strides (contiguous or a view).'},
    {front:'Tensor = ?',back:'A storage (flat bytes on a device) + view metadata: sizes, strides, storage offset, dtype, device. Views share storage.'},
    {front:'PyTorch op path to the GPU',back:'Python → dispatcher (Autograd → Autocast → backend keys) → ATen CUDA implementation → cuBLAS/cuDNN/Triton kernel → enqueued on a CUDA stream → GPU.'},
    {front:'Common GPU sync points',back:'.item(), .cpu(), print(tensor), .tolist(), torch.cuda.synchronize(), some data-dependent ops. They block the CPU until queued GPU work finishes.'},
    {front:'memory_allocated vs memory_reserved',back:'Allocated: live tensors. Reserved: everything the caching allocator holds (live + cached free blocks). nvidia-smi ≈ reserved + CUDA context.'},
    {front:'torch.compile pipeline',back:'TorchDynamo (capture FX graph, graph breaks) → AOTAutograd (backward) → TorchInductor (fused Triton/C++ kernels); reduce-overhead mode adds CUDA Graphs.'},
    {front:'Logits memory for 4,096 tokens × 128,256 vocab in BF16',back:'4,096 × 128,256 × 2 B ≈ 1.05 GB per sequence.'}
  ]
});
registerGlossary([
  {term:'Tensor',def:'An n-dimensional array with a shape, dtype, device and strides; in PyTorch, a view over a storage of bytes.',lesson:'v1-tensors-pytorch',aliases:['tensors']},
  {term:'PyTorch',def:'Open-source deep learning framework providing GPU tensors, automatic differentiation, neural-network modules and compilation; the de facto standard for LLM training and much of inference.',lesson:'v1-tensors-pytorch'},
  {term:'Stride',def:'For each tensor dimension, how many storage elements to skip to move by one index; lets transposes and slices be views without copies.',lesson:'v1-tensors-pytorch',aliases:['strides','contiguous']},
  {term:'Dispatcher',def:'PyTorch’s C++ routing layer that sends each operator call through dispatch keys (autograd, autocast, backend) to the right implementation.',lesson:'v1-tensors-pytorch',aliases:['dispatch key']},
  {term:'ATen',def:'PyTorch’s C++ tensor operator library (aten::mm, aten::add…) whose backend implementations call CUDA kernels and vendor libraries such as cuBLAS.',lesson:'v1-tensors-pytorch'},
  {term:'Autograd',def:'PyTorch’s automatic differentiation: records a graph of operations during the forward pass and applies the chain rule backwards on loss.backward().',lesson:'v1-tensors-pytorch'},
  {term:'CUDA stream',def:'An ordered queue of GPU work; launches are asynchronous with respect to the CPU, and work on different streams can overlap.',lesson:'v1-tensors-pytorch',aliases:['stream']},
  {term:'Caching allocator',def:'PyTorch’s GPU memory manager that keeps freed blocks for reuse instead of returning them to the driver; explains reserved vs allocated memory.',lesson:'v1-tensors-pytorch'},
  {term:'torch.compile',def:'PyTorch’s compiler entry point: TorchDynamo captures graphs, TorchInductor generates fused kernels, optionally with CUDA Graphs to cut launch overhead.',lesson:'v1-tensors-pytorch',aliases:['TorchInductor','TorchDynamo']},
  {term:'CUDA Graphs',def:'A CUDA feature that records a sequence of kernel launches once and replays it with a single launch, removing CPU launch overhead.',lesson:'v1-tensors-pytorch'},
  {term:'cuBLAS',def:'NVIDIA’s GPU linear-algebra library; PyTorch matrix multiplications on CUDA usually run cuBLAS/cuBLASLt GEMM kernels.',lesson:'v1-tensors-pytorch'}
]);
