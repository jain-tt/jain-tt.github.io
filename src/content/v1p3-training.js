/* Volume 1, Part 3 — Building and training models
 * Lessons: v1-data-pipelines, v1-training-loop, v1-finetuning, v1-capstone-train
 * Animations live in src/anims/v1p1-3.js
 */

/* ------------------------------------------------------------------ */
/* 1.3.1  Datasets: preparation, cleaning, splitting and evaluation    */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v1-data-pipelines', vol:1, part:3, num:1,
  title:'Datasets: preparation, cleaning, splitting and evaluation', minutes:80,
  summary:'A model learns whatever its training data contains, including duplicates, personal data, licence problems and test answers that leaked into training. A training dataset pipeline therefore looks like any good data pipeline — ingest, validate, transform, version — plus steps specific to machine learning: removing exact and near duplicates, redacting personal information, checking licences, formatting examples for the model, and splitting into training, validation and test sets in a way that does not leak. Splitting by customer or by time, rather than at random, is often the difference between a believable evaluation and a misleading one. This lesson builds that pipeline for synthetic travel-support tickets and shows how to read evaluation metrics honestly.',
  objectives:[
    'Design an auditable dataset pipeline from raw records to versioned train, validation and test files with a manifest.',
    'Apply exact and near-duplicate removal and estimate Jaccard similarity with MinHash.',
    'Identify leakage paths (duplicates, same customer, future data, benchmark contamination) and choose an entity- or time-based split.',
    'Plan PII handling and licence checks, including Saudi PDPL obligations, as pipeline gates.',
    'Compute precision, recall and F1 from a confusion matrix and explain why accuracy can mislead.'
  ],
  prereqs:['v1-neural-networks','v1-tokenization-embeddings'],
  next:['v1-training-loop','v1-finetuning','v2-mlops-foundations','v2-evaluation-monitoring'],
  tags:['data','training','evaluation','privacy'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Training data is the source code of a model’s behaviour, and the dataset pipeline is its build system. A bug in the data is a bug in the product, but there is no compiler warning. Now the real mechanism.')}
<p>A <b>dataset pipeline</b> turns raw records (support tickets, chat logs, documents, booking events) into model-ready, versioned files: typically <b>train</b>, <b>validation</b> and <b>test</b> splits, plus a <b>manifest</b> recording where every record came from and what was done to it. For LLM fine-tuning the output is usually JSONL in a chat format; for pretraining it is tokenised, packed binary shards.</p>
${code('json',`{"messages": [
  {"role": "system", "content": "You are Atlas, a travel-support assistant for a GCC travel company."},
  {"role": "user", "content": "My JED to CAI flight tomorrow was cancelled. What are my options?"},
  {"role": "assistant", "content": "I am sorry about the cancellation. You can choose a free rebooking on the next available flight or a refund to the original payment method. Would you like me to check rebooking options?"}
], "meta": {"customer_id": "C-10432", "created": "2026-03-14", "lang": "en", "source": "synthetic-v3"}}`)}

<h2>2. Why do we need it?</h2>
<p>Models amplify their data. If 5 % of tickets are duplicated 50 times, the model over-learns those answers. If tickets contain passport numbers, the model can memorise and regurgitate them. If the test set contains near-copies of training tickets, the evaluation reports a quality the model will never reach in production. If the data’s licence forbids commercial use, the model may be unusable. None of these produce an error; they produce a model that looks fine and is not. The pipeline is where you prevent them, and the manifest is how you prove later which data trained which model.</p>

<h2>3. How does it work internally?</h2>
${fig('A training-data pipeline with gates', svgDiagram({w:900,h:320,
 boxes:[
  {id:'src',x:20,y:40,w:120,h:56,label:'Sources',sub:'tickets, chats, docs'},
  {id:'lic',x:165,y:40,w:120,h:56,label:'Licence and consent',sub:'allowed use?',cls:'warn'},
  {id:'norm',x:310,y:40,w:120,h:56,label:'Normalise',sub:'encoding, lang ID'},
  {id:'pii',x:455,y:40,w:120,h:56,label:'PII redaction',sub:'detect + mask',cls:'warn'},
  {id:'dd',x:600,y:40,w:130,h:56,label:'Deduplicate',sub:'exact + near'},
  {id:'q',x:755,y:40,w:125,h:56,label:'Quality filter',sub:'length, toxicity'},
  {id:'fmt',x:755,y:170,w:125,h:56,label:'Format',sub:'chat JSONL'},
  {id:'split',x:560,y:170,w:170,h:56,label:'Split',sub:'by customer / time',cls:'hl'},
  {id:'chk',x:365,y:170,w:170,h:56,label:'Leakage checks',sub:'overlap train↔test',cls:'warn'},
  {id:'ver',x:150,y:170,w:190,h:56,label:'Versioned snapshot',sub:'hashes + manifest'},
  {id:'tr',x:20,y:260,w:130,h:44,label:'train'},
  {id:'va',x:170,y:260,w:130,h:44,label:'validation'},
  {id:'te',x:320,y:260,w:130,h:44,label:'test (locked)',cls:'ok'}
 ],
 arrows:[{from:'src',to:'lic'},{from:'lic',to:'norm'},{from:'norm',to:'pii'},{from:'pii',to:'dd'},{from:'dd',to:'q'},{from:'q',to:'fmt',fromSide:'bottom',toSide:'top'},{from:'fmt',to:'split'},{from:'split',to:'chk'},{from:'chk',to:'ver'},{from:'ver',to:'tr',fromSide:'bottom',toSide:'top'},{from:'ver',to:'va',fromSide:'bottom',toSide:'top'},{from:'ver',to:'te',fromSide:'bottom',toSide:'top'}]
}), 'Orange boxes are gates that can block a record or the whole dataset. Every stage logs counts in and out, so a sudden drop (or rise) is visible.')}

<h3>3.1 Deduplication</h3>
<p><b>Exact duplicates</b>: normalise (lower-case, collapse whitespace, strip signatures), hash with SHA-256, keep one record per hash. <b>Near duplicates</b> (the same template ticket with a different booking reference) need a similarity measure. The standard is <b>Jaccard similarity</b> over <b>shingles</b> (overlapping word n-grams), approximated at scale with ${term('MinHash')}.</p>
${formula(`
Jaccard similarity  J(A, B) = |A ∩ B| / |A ∪ B|

Two tickets as sets of 3-word shingles (simplified to letters)
   A = {a, b, c, d, e}          B = {a, b, c, d, f}
   |A ∩ B| = 4                  |A ∪ B| = 6
   J = 4 / 6 = 0.667

MinHash: hash every shingle with k different hash functions, keep the minimum
   P( min-hash of A = min-hash of B ) = J(A, B)
   with k = 128 hash functions, J is estimated with standard error
      √( J(1 − J) / k ) = √( 0.667 × 0.333 / 128 ) = √0.001736 ≈ 0.042

Locality-sensitive hashing (LSH) groups signatures into bands so that only
likely-similar pairs are compared — no need for n² comparisons.

Typical policy: drop near-duplicates above a threshold such as J ≥ 0.8
(tune on a labelled sample: too low removes legitimate variants)
`)}

<h3>3.2 PII, consent and licences</h3>
<ul>
<li><b>Detect</b> personal data with rules (regex for emails, phone numbers in +966/+971 formats, card numbers with Luhn checks, passport and national-ID patterns, booking references) and NER models for names and addresses (Microsoft Presidio is a common open-source framework). Arabic names and mixed-script text need models that support Arabic — test detection recall on Arabic samples explicitly.</li>
<li><b>Act</b>: replace with typed tags (<code>[PASSENGER_NAME]</code>, <code>[PNR]</code>) so the model still learns structure; or drop the record.</li>
<li><b>Legal basis</b>: in Saudi Arabia the Personal Data Protection Law (PDPL) has been in force since 14 September 2023 with compliance expected from 14 September 2024, supervised by SDAIA. Using customer conversations for training needs a lawful basis, purpose limitation and residency decisions — involve your privacy team; the pipeline enforces their decisions, it does not make them.</li>
<li><b>Licences</b>: every source needs a recorded licence or contract that permits training and commercial use. Public web text, model-generated data (some model licences restrict using outputs to train other models) and partner content all have terms.</li>
</ul>

<h3>3.3 Splitting without leakage</h3>
<p>${term('Data leakage')} is any path by which information from the evaluation data reaches training, making scores look better than reality.</p>
${table(['Leakage path','Example','Prevention'],[
 ['Duplicates across splits','Same template ticket in train and test','Deduplicate <i>before</i> splitting; check cross-split near-duplicates'],
 ['Same entity in both splits','Customer C-10432’s five tickets split 3/2; the model memorises their booking details','Split <b>by customer</b> (group split): all of a customer’s records go to one split'],
 ['Future information','Train on March–June, test on January; or features computed after the event','Split <b>by time</b>: train on older, test on newer — mirrors deployment'],
 ['Benchmark contamination','Public eval questions present in pretraining web data','N-gram overlap checks against eval sets; prefer private, fresh eval sets'],
 ['Tuning on the test set','Choosing hyperparameters by test score','Tune on validation; touch test once per release candidate']
])}
${formula(`
Why group splits matter (illustrative)
   10,000 tickets from 2,000 customers, 5 each
   random 80/10/10 split: P(a test ticket's customer has ≥ 1 ticket in train)
      = 1 − 0.2⁴ ≈ 0.998    (each of the other 4 tickets is outside train with p = 0.2)
   → nearly every test ticket has a "sibling" in training data
   group split by customer: that probability is 0 by construction
`)}
<p>Typical proportions: 80/10/10 or 90/5/5 for fine-tuning; for small datasets keep at least a few hundred test examples per important category, or confidence intervals become too wide to compare models.</p>

<h3>3.4 Evaluation metrics, read honestly</h3>
${formula(`
Escalation classifier on 1,000 test tickets (120 truly need escalation)

                     predicted escalate   predicted not
actually escalate         TP = 80            FN = 40
actually not              FP = 20            TN = 860

accuracy  = (80 + 860) / 1,000           = 0.94
precision = TP / (TP + FP) = 80 / 100     = 0.80   ← of flagged, how many right
recall    = TP / (TP + FN) = 80 / 120     = 0.667  ← of real cases, how many caught
                 2 × P × R      2 × 0.80 × 0.667
F1        =   ───────────  =  ─────────────────  = 0.727
                 P + R           0.80 + 0.667

A model that NEVER escalates scores accuracy 880 / 1,000 = 0.88
   ↑ accuracy hides that it misses every one of the 120 cases that matter
`)}
<h3>3.5 How big must the test set be?</h3>
<p>A test score is an estimate with uncertainty. For a pass/fail metric with true rate p measured on n examples, the 95 % confidence half-width is about 1.96 × √(p(1 − p)/n). This tells you whether a "2-point improvement" is real.</p>
${formula(`
Required n for a ±3-point margin at p ≈ 0.80

             1.96² × p × (1 − p)       3.8416 × 0.16
     n  =  ─────────────────────  =  ──────────────  ≈ 683 examples
                  margin²                0.0009

With only 100 examples:  1.96 × √(0.16 / 100) = 1.96 × 0.04 ≈ ±7.8 points
   ↑ a new adapter scoring 82 % vs a baseline at 79 % on 100 examples
     is NOT evidence of improvement
`)}
<p>Per-segment results (Arabic only, escalations only) need enough examples <i>per segment</i>, which is why evaluation sets are usually stratified: a fixed minimum per category and language.</p>

<h3>3.6 Formats, packing and tokenised shards</h3>
<p>Fine-tuning data is usually JSONL (one conversation per line, easy to diff and review) or Parquet (columnar, compressed, good for large sets and Spark). Pretraining data is pre-tokenised into binary shards of token IDs so the GPU never waits for text processing. Because sequences vary in length, batches padded to the longest sequence waste compute; <b>packing</b> concatenates several short examples into one fixed-length sequence (with attention masking or separators so examples do not attend to each other where the trainer supports it).</p>
${formula(`
Padding waste, illustrative batch of 8 tickets padded to 1,024 tokens
   real lengths: 180, 240, 310, 150, 900, 220, 260, 200   → 2,460 real tokens
   padded:       8 × 1,024                               = 8,192 token slots
   utilisation = 2,460 / 8,192 ≈ 30 %   → 70 % of the step’s compute is padding
   packing into 1,024-token sequences needs ⌈2,460 / 1,024⌉ = 3 sequences
`)}

<p>For LLM outputs, metrics include exact match (structured fields), schema validity, groundedness and correctness rated by humans or an LLM judge calibrated against humans, refusal/escalation correctness, and per-language breakdowns. Volume 2 covers evaluation frameworks (${L('v2-evaluation-monitoring','evaluation and monitoring')}).</p>

<h2>4. Where does it fit?</h2>
<p>The pipeline sits between your data platform and the training job. Its output is an immutable, versioned snapshot referenced by ID from every training run and every model artifact. That reference is what lets you answer, months later, "which data trained the model that gave this answer?" — the core of ${L('v2-mlops-foundations','MLOps lineage')}.</p>

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Upstream</b>: Kafka/Debezium change streams, S3 data lakes, ticketing exports. Schema changes upstream silently change the dataset.</li>
<li><b>Versioning</b>: DVC or lakeFS for Git-like versions over object storage; Delta Lake or Iceberg tables with time travel; or immutable S3 prefixes plus a manifest with hashes.</li>
<li><b>Validation</b>: data-contract tools (Great Expectations, Soda Core) for counts, nulls, distributions.</li>
<li><b>Training</b>: the training job reads a pinned snapshot ID (${L('v1-training-loop','training loops')}).</li>
<li><b>Evaluation and drift</b>: the test set defines release gates; production inputs are compared with training distributions to detect drift (${L('v2-evaluation-monitoring','monitoring')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li>The orchestration (Airflow, Argo Workflows, Kubeflow Pipelines) with retries, idempotent stages and per-stage metrics.</li>
<li>Storage layout and access control: raw PII data in a restricted bucket, redacted data elsewhere; in-region storage where residency requires it.</li>
<li>The manifest schema and its enforcement: no training job runs on a snapshot without a manifest and passing gates.</li>
<li>Audit logs of who accessed raw data and which jobs read which snapshots.</li>
</ul>
${code('yaml',`dataset_id: atlas-support-sft
version: 2026-10-14.1
sources:
  - name: synthetic-tickets-v3
    licence: internal-synthetic
    records_in: 52000
pipeline_commit: 3f2c9e1
stages:
  pii_redaction: {tool: presidio + custom-ar-rules, records_dropped: 0, entities_masked: 18342}
  dedup: {exact_removed: 3120, near_dup_threshold: 0.8, near_removed: 2210}
  quality_filter: {removed: 670}
split: {strategy: group_by_customer, train: 36800, validation: 4600, test: 4600, seed: 1234}
leakage_checks: {cross_split_near_dups: 0, customer_overlap: 0}
files:
  train.jsonl: sha256:9b1e...
  validation.jsonl: sha256:4c77...
  test.jsonl: sha256:e0a2...`)}
${callout('devops','DevOps bridge','Treat a dataset snapshot exactly like a container image: immutable, content-addressed, built by a pipeline from pinned inputs, scanned (PII instead of CVEs), and promoted. Where the analogy breaks: you cannot "rebuild from source" if the source system has since deleted records — keep the snapshot.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely data cause','Evidence','Fix'],[
 ['Offline scores excellent, production poor','Leakage or train/serve distribution shift','Cross-split overlap; compare language/category mix with live traffic','Group/time split; fresh test set from recent traffic'],
 ['Model repeats one canned reply','Heavy duplication of a template answer','Duplicate cluster sizes','Near-dedup; cap examples per template'],
 ['Model outputs a real phone number or name','PII not redacted; memorisation','Search training data for the string','Fix detectors (incl. Arabic); retrain; add output PII filter'],
 ['Arabic quality much worse than English','Too few or low-quality Arabic examples; PII tool over-masks Arabic','Per-language counts and metrics','Balance languages; per-language evaluation'],
 ['Retrained model got worse with "more data"','New source had label noise or different conventions','Per-source metrics','Gate new sources; evaluate per source'],
 ['Pipeline output count halved overnight','Upstream schema or encoding change','Stage-by-stage counts','Data contracts; alert on count deltas']
])}

<h2>8. How do we scale it?</h2>
<p>Pretraining-scale pipelines process billions of documents: use distributed engines (Spark, Ray Data), shard by hash, run MinHash-LSH dedup as a distributed join, and write tokenised, packed shards so GPUs never wait on text processing. Fine-tuning datasets are thousands to hundreds of thousands of examples: a single machine is usually enough, and quality review time — not compute — is the bottleneck.</p>

<h2>9. How do we optimize its cost?</h2>
<p>Data quality is the cheapest model improvement. Removing duplicates and low-quality records shortens training (fewer tokens) and often improves quality. A smaller, well-curated SFT set (a few thousand high-quality examples) frequently beats a large noisy one. Human labelling is expensive: label where the model is uncertain or wrong (active learning) rather than at random, and reuse a stable, versioned evaluation set across releases so you do not pay to rebuild it.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Your fine-tuned model scored 95 % offline but users say it is bad. What do you check?”','<p><i>Answer (≈50 s):</i> "First, whether the evaluation is believable. I would check for leakage — near-duplicates across splits, the same customers in train and test, or a random split where a time split was needed — and whether the test set reflects production: language mix, categories, ticket length, recent policies. Then I would check the metric: high accuracy on an imbalanced task can hide poor recall on the cases that matter, so I would look at per-class precision and recall and per-language results. Finally I would sample real production conversations, label a few hundred, and compare. Usually the fix is a group- or time-based split and a fresh test set from recent traffic, not more GPUs."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Train longer or use a bigger model."</p></div><div class="good"><h4>Strong answer</h4><p>Questions the evaluation first: leakage, split strategy, distribution shift, metric choice, per-segment results.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Raw records','licence + PII gates','dedup','group/time split','versioned snapshot','training run','evaluation gate'])}
<p>Next: ${L('v1-training-loop','training loops')} consume the snapshot. Later: ${L('v2-mlops-foundations','MLOps foundations')} track lineage, and ${L('v2-ai-threat-model','AI threat modeling')} covers data poisoning.</p></div>

<h3>Lab</h3>
<p>The planned lab <code>labs/03-finetune/make_dataset.py</code> generates synthetic travel-support tickets and splits them by customer. The heart of a group split is short:</p>
${code('python',`import hashlib, json, random

def split_of(customer_id, seed="1234"):
    # stable assignment: same customer -> same split, on every run
    h = int(hashlib.sha256((seed + customer_id).encode()).hexdigest(), 16) % 100
    return "train" if h < 80 else ("validation" if h < 90 else "test")

def exact_key(text):
    return hashlib.sha256(" ".join(text.lower().split()).encode()).hexdigest()`)}
`,
  quiz:[
    {q:'Two tickets have shingle sets of sizes 5 and 5 sharing 4 shingles. Jaccard similarity?',options:['0.8','0.667','0.5','0.4'],answer:1,explain:'Intersection 4, union 5 + 5 − 4 = 6, so 4/6 ≈ 0.667. 0.8 divides by one set size instead of the union.'},
    {q:'Customers each have about five tickets. Why is a random ticket-level split risky?',options:['It is slower','Nearly every test ticket has tickets from the same customer in training, inflating scores','Random splits are illegal under PDPL','It changes the tokenizer'],answer:1,explain:'The model can memorise customer-specific details. Group the split by customer.'},
    {q:'Confusion matrix TP 80, FP 20, FN 40, TN 860. Recall?',options:['0.80','0.667','0.94','0.727'],answer:1,explain:'Recall = 80/(80+40). 0.80 is precision, 0.94 accuracy, 0.727 F1.'},
    {q:'Which split strategy best mirrors deploying a model next month?',options:['Random split','Split by time: train on older data, test on the most recent','Split by text length','Test on the training set'],answer:1,explain:'A time split tests generalisation to the future, the situation the deployed model faces.'},
    {q:'Where should deduplication happen relative to splitting?',options:['After splitting, within each split only','Before splitting, plus a cross-split check afterwards','It is not needed for fine-tuning','Only on the test set'],answer:1,explain:'Deduplicating before splitting prevents duplicates landing in different splits; the cross-split check catches near-duplicates that slipped through.'}
  ],
  flashcards:[
    {front:'Data leakage',back:'Any path by which evaluation information reaches training: cross-split duplicates, same entity in both splits, future data, benchmark contamination, tuning on test.'},
    {front:'Group split',back:'Assign all records of one entity (customer, account, document) to the same split, e.g. by hashing the entity ID.'},
    {front:'MinHash',back:'k hash functions; keep each one’s minimum over a document’s shingles. P(minimums match) = Jaccard similarity. LSH bands find candidate pairs without n² comparisons.'},
    {front:'Precision vs recall',back:'Precision = TP/(TP+FP): of flagged, how many right. Recall = TP/(TP+FN): of real cases, how many caught. F1 = harmonic mean.'},
    {front:'Saudi PDPL dates',back:'In force 14 Sep 2023; compliance expected from 14 Sep 2024; regulator SDAIA.'},
    {front:'What goes in a dataset manifest',back:'Dataset ID/version, sources + licences, pipeline commit, per-stage counts, split strategy + seed, leakage-check results, file hashes.'}
  ]
});
registerGlossary([
  {term:'Data leakage',def:'Information from validation or test data reaching training (duplicates, same entities, future data, contamination), inflating evaluation scores.',lesson:'v1-data-pipelines',aliases:['leakage']},
  {term:'Deduplication',def:'Removing exact (hash-equal) and near-duplicate (high-similarity) records from a dataset.',lesson:'v1-data-pipelines',aliases:['dedup']},
  {term:'MinHash',def:'A sketching technique whose matching minimum hashes estimate the Jaccard similarity of two sets; combined with LSH for large-scale near-duplicate detection.',lesson:'v1-data-pipelines'},
  {term:'Jaccard similarity',def:'|A ∩ B| / |A ∪ B| for two sets, e.g. sets of word n-grams.',lesson:'v1-data-pipelines'},
  {term:'Group split',def:'Splitting data so that all records of one entity (e.g. a customer) fall into the same split.',lesson:'v1-data-pipelines'},
  {term:'Validation set',def:'Held-out data used during development to tune hyperparameters and choose checkpoints; distinct from the locked test set.',lesson:'v1-data-pipelines',aliases:['test set']},
  {term:'Precision',def:'TP / (TP + FP): the share of positive predictions that are correct.',lesson:'v1-data-pipelines'},
  {term:'Recall',def:'TP / (TP + FN): the share of actual positives the model finds.',lesson:'v1-data-pipelines'},
  {term:'F1 score',def:'Harmonic mean of precision and recall: 2PR / (P + R).',lesson:'v1-data-pipelines'},
  {term:'PDPL',def:'Saudi Arabia’s Personal Data Protection Law (in force 14 Sep 2023, compliance expected from 14 Sep 2024), supervised by SDAIA.',lesson:'v1-data-pipelines'}
]);

/* ------------------------------------------------------------------ */
/* 1.3.2  Training loops, optimizers, checkpoints, artifacts, repro    */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v1-training-loop', vol:1, part:3, num:2,
  title:'Training loops, optimizers, checkpoints, artifacts and reproducibility', minutes:95,
  summary:'A training job repeats a simple loop — load a batch, forward, loss, backward, optimizer step — wrapped in the machinery that makes it a reliable production job: learning-rate schedules, mixed precision, periodic evaluation, resumable checkpoints and experiment tracking. A checkpoint that only holds weights is enough to serve a model but not to resume training exactly; for that you also need optimizer, scheduler, scaler and random-number states and the position in the data. The final model artifact is a set of files — safetensors weights, config, tokenizer, chat template — that must be versioned together. This lesson also shows how to recognise overfitting and underfitting, how to choose checkpoint frequency, and what reproducibility can and cannot promise.',
  objectives:[
    'Write the steps of a production training loop, including gradient accumulation, clipping, schedules and evaluation.',
    'List what a resumable checkpoint must contain, estimate its size, and choose a checkpoint interval from failure rate and write time.',
    'Describe the files of a model artifact and why safetensors is preferred to pickle.',
    'Choose between FP32, TF32, BF16, FP16 and FP8 for training and explain loss scaling.',
    'Diagnose overfitting and underfitting from loss curves and state what reproducibility controls exist.'
  ],
  prereqs:['v1-neural-networks','v1-tensors-pytorch','v1-data-pipelines'],
  next:['v1-finetuning','v1-capstone-train','v1-gpu-memory','v2-distributed-training','v2-mlops-foundations'],
  tags:['training','checkpoints','artifacts','mixed-precision','reproducibility'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A training job is a very long database migration that rewrites billions of rows (weights) thousands of times. You would never run such a migration without transactions, progress markers and the ability to resume. Checkpoints are those markers. Now the real mechanism.')}
<p>A <b>training loop</b> is the code that repeatedly updates model parameters from data. A <b>training job</b> is that loop plus everything that makes it operable: configuration, data loading, schedules, precision handling, evaluation, logging, ${term('checkpoint','checkpointing')} and the final export of a <b>model artifact</b>.</p>
${anim('v1-nn-train-loop')}

<h2>2. Why do we need it?</h2>
<p>The four-line loop from ${L('v1-neural-networks','neural networks')} trains a toy. Real jobs run for hours to weeks on expensive GPUs that fail, get preempted, or are shared. Without schedules they diverge; without mixed precision they are 2× slower and use 2× memory; without checkpoints a failure at hour 70 costs 70 hours; without evaluation you do not know which checkpoint is best; without tracking nobody can reproduce or audit the result.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 The production loop</h3>
${code('python',`model.train()
for step in range(start_step, total_steps):
    for micro in range(grad_accum_steps):                 # gradient accumulation
        batch = next(train_iter)                          # tokens -> GPU (pinned, non_blocking)
        with torch.autocast("cuda", dtype=torch.bfloat16):
            logits = model(batch["input_ids"])
            loss = cross_entropy(logits, batch["labels"]) / grad_accum_steps
        loss.backward()                                   # grads accumulate in .grad
    torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
    optimizer.step()
    scheduler.step()
    optimizer.zero_grad(set_to_none=True)
    if step % log_every == 0:   log(step, loss, lr, grad_norm, tokens_per_sec)
    if step % eval_every == 0:  evaluate(model, val_loader)   # under torch.no_grad()
    if step % ckpt_every == 0:  save_checkpoint(step)`)}

<h3>3.2 Effective batch size and gradient accumulation</h3>
${formula(`
effective batch = micro-batch × accumulation steps × data-parallel GPUs

WORKED  micro-batch 4 sequences, accumulation 8, 8 GPUs
        4 × 8 × 8 = 256 sequences per optimizer step
        × 4,096 tokens per sequence = 1,048,576 tokens per step (≈ 1 M)

Doubling GPUs to 16 without changing accumulation → 512 sequences per step:
a different optimisation problem (learning rate and schedule may need retuning).
`)}

<h3>3.3 Learning-rate schedule: warmup then cosine decay</h3>
${formula(`
warmup (t < W):     η(t) = η_max × t / W
cosine (t ≥ W):     progress p = (t − W) / (T − W)
                    η(t) = η_min + ½ (η_max − η_min)(1 + cos(π p))

WORKED  η_max = 3 × 10⁻⁴,  η_min = 3 × 10⁻⁵,  W = 2,000,  T = 100,000
        t = 1,000  →  η = 3 × 10⁻⁴ × 1,000 / 2,000 = 1.5 × 10⁻⁴   (warming up)
        t = 51,000 →  p = 49,000 / 98,000 = 0.5,  cos(π/2) = 0
                      η = 3 × 10⁻⁵ + ½ × 2.7 × 10⁻⁴ = 1.65 × 10⁻⁴
        t = 100,000 → p = 1, cos(π) = −1  →  η = η_min = 3 × 10⁻⁵
`)}
<p>Warmup protects early training, when AdamW’s statistics are still unreliable; decay lets the model settle into a minimum. Fine-tuning uses much smaller peak rates (LoRA commonly 1 × 10⁻⁴ – 2 × 10⁻⁴; full fine-tuning lower) and short warmups.</p>

<h3>3.4 Mixed precision</h3>
${table(['Format','Sign / exponent / mantissa bits','Range (max)','Training use'],[
 ['FP32','1 / 8 / 23','≈ 3.4 × 10³⁸','Master weights, optimizer state, reductions'],
 ['TF32','1 / 8 / 10 (stored in 32 bits)','as FP32','Tensor Core matmuls for FP32 code on Ampere and later'],
 ['BF16','1 / 8 / 7','≈ 3.4 × 10³⁸','Default for LLM training: FP32 range, half the bytes'],
 ['FP16','1 / 5 / 10','65,504','Needs loss scaling to avoid gradient underflow'],
 ['FP8 E4M3 / E5M2','1 / 4 / 3 and 1 / 5 / 2','448 / 57,344','Hopper/Blackwell training with per-tensor or block scaling (emerging, framework support required)']
])}
<p>${term('Mixed precision')} runs matmuls in BF16/FP16 on Tensor Cores while keeping precision-sensitive parts (master weights, optimizer moments, softmax and loss) in FP32. FP16’s narrow exponent means small gradients underflow to zero, so FP16 training multiplies the loss by a large <b>scale factor</b> before backward and divides it out before the step (<code>torch.amp.GradScaler</code>), skipping steps that overflow. BF16 has FP32’s exponent range and usually needs no scaler — the main reason it became the default.</p>

<h3>3.5 Evaluation, overfitting and underfitting</h3>
${table(['Pattern','Training loss','Validation loss','Diagnosis','Action'],[
 ['Underfitting','High, flat','High','Model too small, LR too low, too few steps, bad data','Train longer, raise LR, bigger model, fix data'],
 ['Good fit','Falling','Falling, close to train','Learning generalisable patterns','Continue; pick best validation checkpoint'],
 ['Overfitting','Still falling','Bottoms out, then rises','Memorising training examples','Early stopping, more/better data, fewer epochs, regularisation (weight decay, dropout), smaller LoRA rank'],
 ['Divergence','Spikes or NaN','Spikes','Instability','Lower LR, warmup, clipping, BF16, inspect batch']
])}
<p>${term('Overfitting')} in fine-tuning is common because datasets are small: three or more epochs over a few thousand examples often memorise them. Always select the checkpoint by <b>validation</b> metrics, and confirm the winner once on the locked test set.</p>

<h3>3.6 What a resumable checkpoint contains</h3>
${table(['Item','Why it is needed for exact resume'],[
 ['Model weights (and FP32 master weights if used)','The parameters themselves'],
 ['Optimizer state (AdamW m, v, step count)','Without it AdamW restarts with zero momentum and bias-correction from step 1 → loss spike'],
 ['LR scheduler state','Otherwise warmup restarts or the decay position is wrong'],
 ['Gradient scaler state (FP16)','Current loss scale'],
 ['RNG states: Python, NumPy, torch CPU, every CUDA device','Same dropout masks and data shuffling'],
 ['Global step, epoch, data-loader / sampler position','Do not repeat or skip data'],
 ['Config, code commit, data snapshot ID, library versions','Know what you are resuming; reproducibility']
])}
${formula(`
Checkpoint size, full fine-tuning of an 8.03 B model with AdamW
   BF16 weights            8.03 × 10⁹ × 2 B = 16.06 GB
   FP32 master weights     8.03 × 10⁹ × 4 B = 32.12 GB
   AdamW m and v (FP32)    8.03 × 10⁹ × 8 B = 64.24 GB
   total                                     ≈ 112.4 GB   (gradients are not saved)
   at an effective 1 GB/s to object storage  ≈ 112 s per checkpoint

Weights-only export for inference: 16.06 GB  (7× smaller)

How often to checkpoint? Young/Daly first-order optimum:
   interval ≈ √( 2 × C × MTBF )      C = checkpoint write time, MTBF = mean time between job failures
   C = 112 s, MTBF = 8 h = 28,800 s
   interval ≈ √( 2 × 112 × 28,800 ) = √6,451,200 ≈ 2,540 s ≈ 42 min
   (MTBF illustrative; a 1,000-GPU job fails far more often than one GPU)
`)}
<p>Engineering rules: write to a temporary path and atomically rename or write a "COMPLETE" marker last, so a crash mid-write never leaves a checkpoint that looks valid; verify by loading periodically; keep the last <i>k</i> plus the best-by-validation; for multi-GPU jobs use sharded, asynchronous checkpointing (<code>torch.distributed.checkpoint</code>) so every rank writes its shard in parallel (${L('v2-distributed-training','distributed training')}).</p>

<h3>3.7 The model artifact</h3>
${table(['File','Contents'],[
 ['<code>model.safetensors</code> or <code>model-0000N-of-0000M.safetensors</code> + <code>model.safetensors.index.json</code>','Weights; large models are sharded with an index mapping tensor names to files'],
 ['<code>config.json</code>','Architecture: layers, hidden size, heads, KV heads, vocab, rope settings, dtype'],
 ['<code>generation_config.json</code>','Default sampling parameters and stop/EOS token IDs'],
 ['<code>tokenizer.json</code>, <code>tokenizer_config.json</code>, <code>special_tokens_map.json</code>','Tokenizer and special tokens'],
 ['Chat template (in <code>tokenizer_config.json</code> or a separate <code>chat_template.jinja</code>)','How messages become tokens'],
 ['Model card (<code>README.md</code>) and licence','Intended use, evaluation, limits, terms'],
 ['For LoRA: <code>adapter_model.safetensors</code> + <code>adapter_config.json</code>','Adapter weights, rank, targets, and the base model it requires']
])}
<p>${term('safetensors')} is a simple format: a JSON header describing each tensor (name, dtype, shape, byte offsets) followed by raw bytes. Loading it cannot execute code and can be memory-mapped (zero-copy). PyTorch’s <code>.pt/.bin</code> files use Python <b>pickle</b>, and the Hugging Face documentation warns that loading a pickle can execute arbitrary code; attacks using malicious pickled models on public hubs have been documented. Recent PyTorch versions default <code>torch.load</code> to <code>weights_only=True</code> to reduce this risk, but the platform policy should be: <b>accept safetensors only</b> for third-party weights, pin revisions, and never set <code>trust_remote_code=True</code> without review (${L('v2-ai-threat-model','AI threat modeling')}).</p>

<h3>3.8 Reproducibility: what you can and cannot promise</h3>
${code('python',`import os, random, numpy as np, torch
os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"   # required for deterministic cuBLAS
random.seed(1234); np.random.seed(1234); torch.manual_seed(1234)  # seeds CPU and all CUDA devices
torch.use_deterministic_algorithms(True)            # error on non-deterministic ops
torch.backends.cudnn.benchmark = False              # no autotuned kernel choice
g = torch.Generator().manual_seed(1234)             # pass to DataLoader(generator=g)`)}
<p>Even with all of this, bit-identical results are only expected on the same hardware, driver, CUDA, PyTorch version and parallel layout; deterministic mode can be slower. In practice teams aim for <b>statistical reproducibility</b> (same data, code and config give the same metrics within noise) and record everything needed to rerun: code commit, image digest, data snapshot, config, seeds, GPU type and count.</p>

<h3>3.9 What to log for every run</h3>
${table(['Category','Fields','Why'],[
 ['Identity','run ID, code commit, image digest, config file, data snapshot ID, base model revision','Reproduce and audit'],
 ['Optimisation','loss (train, validation), learning rate, gradient norm, loss scale (FP16), skipped steps','Detect divergence and schedule bugs'],
 ['Throughput','tokens/s, step time, data-loader wait, MFU','Find bottlenecks; cost per run'],
 ['Resources','GPU memory allocated/reserved, GPU utilisation, host memory, network/storage throughput','Size jobs; catch leaks'],
 ['Outputs','checkpoint paths and hashes, best step, evaluation results','Lineage into the registry']
])}
<p>Log at a fixed step interval to an experiment tracker (MLflow, W&amp;B) and export the operational subset (tokens/s, memory, utilisation, errors) to your normal metrics stack, so training jobs appear on the same dashboards and alerts as everything else.</p>

<h2>4. Where does it fit?</h2>
${fig('A training job on a platform', svgDiagram({w:900,h:320,
 boxes:[
  {id:'cfg',x:20,y:40,w:150,h:56,label:'Run config',sub:'git commit + params'},
  {id:'data',x:20,y:140,w:150,h:56,label:'Data snapshot',sub:'versioned, read-only'},
  {id:'img',x:20,y:240,w:150,h:56,label:'Image digest',sub:'CUDA + PyTorch'},
  {id:'job',x:230,y:130,w:200,h:76,label:'Training job',sub:'GPU pods (Job / PyTorchJob)',cls:'hl'},
  {id:'trk',x:490,y:40,w:170,h:56,label:'Experiment tracker',sub:'loss, lr, metrics'},
  {id:'ck',x:490,y:140,w:170,h:56,label:'Checkpoint store',sub:'S3 / GCS, sharded'},
  {id:'ev',x:490,y:240,w:170,h:56,label:'Evaluation',sub:'validation + test'},
  {id:'reg',x:720,y:140,w:160,h:56,label:'Model registry',sub:'artifact + lineage',cls:'ok'}
 ],
 arrows:[{from:'cfg',to:'job'},{from:'data',to:'job'},{from:'img',to:'job'},{from:'job',to:'trk',label:'metrics'},{from:'job',to:'ck',label:'every N steps'},{from:'ck',to:'ev'},{from:'ev',to:'reg',label:'passes gate'},{from:'ck',to:'job',cls:'dash',label:'resume'}]
}), 'Every arrow is something the platform must make reliable: pinned inputs, durable checkpoints, tracked metrics and a gated promotion into the registry.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>GPU memory</b>: weights + gradients + optimizer state + activations decide batch size and GPU count (${L('v1-gpu-memory','GPU memory')}).</li>
<li><b>Schedulers</b>: Kubernetes Jobs, Kubeflow Training Operator, Kueue for quotas and gang scheduling, or Slurm (${L('v2-distributed-training','distributed training')}).</li>
<li><b>Tracking and registry</b>: MLflow or W&amp;B for runs; the registry stores promoted artifacts with lineage (${L('v2-mlops-foundations','MLOps foundations')}).</li>
<li><b>Serving</b>: engines load the exported artifact; LoRA adapters may be served on a shared base (${L('v1-engines','engines')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li><b>Checkpoint storage</b>: throughput (parallel multipart uploads), lifecycle rules (keep last k + best), encryption, region.</li>
<li><b>Preemption handling</b>: catch SIGTERM, write a checkpoint within the grace period, resume automatically on restart; this is what makes spot GPUs viable.</li>
<li><b>Training observability</b>: loss, validation metrics, learning rate, gradient norm, tokens/s, MFU, GPU memory, data-loader wait time, alerts on NaN and stalls.</li>
<li><b>Artifact policy</b>: safetensors only, signed and scanned, registered with lineage before anything can deploy it.</li>
</ul>
${formula(`
Model FLOPs utilisation (MFU) — the training efficiency number to track

MFU = (6 × N × measured tokens/s) / peak FLOP/s

WORKED (illustrative measurement)
   8.03 B model, 3,000 tokens/s per H100 SXM, dense BF16 peak 989.5 TFLOP/s
   6 × 8.03 × 10⁹ × 3,000 = 1.445 × 10¹⁴ FLOP/s
   MFU = 1.445 × 10¹⁴ / 9.895 × 10¹⁴ ≈ 14.6 %   → much room to optimise
`)}
${callout('devops','DevOps bridge','A training job is a stateful batch workload like a long Spark job with checkpointed state, not a stateless Deployment. Kubernetes restart policies restart the pod; only the job’s own checkpoint logic restores progress. Where the analogy breaks: synchronous multi-GPU training fails as a unit — one bad GPU stops all of them.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Loss spikes right after resume','Optimizer/scheduler state not restored; data order restarted','Compare LR and step before/after; checkpoint keys','Restore full state; resume sampler position'],
 ['Checkpoint fails to load: missing or unexpected keys','Model code changed, or saved a wrapped (DDP/compiled) model with prefixed names','Key names (e.g. "module." or "_orig_mod." prefixes)','Save the unwrapped module’s state_dict; version model code with checkpoints'],
 ['Corrupt "latest" checkpoint after a node crash','Non-atomic write','File size/hash; no COMPLETE marker','Write-then-rename; verify on load; keep previous'],
 ['Validation loss rising while training loss falls','Overfitting','Curves','Early stopping, fewer epochs, more data'],
 ['GPU utilisation low, tokens/s low','Data loader or storage bottleneck; CPU-bound','Data wait time per step; CPU usage','More workers, pre-tokenised shards, local NVMe cache'],
 ['Job lost hours of work after preemption','Interval too long; no SIGTERM handling','Last checkpoint time vs preemption time','Young/Daly interval; checkpoint on SIGTERM'],
 ['FP16 run: many skipped steps, loss scale collapses','Overflow/underflow','GradScaler scale history','Switch to BF16, lower LR']
])}

<h2>8. How do we scale it?</h2>
<p>Scale data parallelism for throughput (more GPUs, same model copy), shard optimizer state and parameters when they no longer fit (FSDP / ZeRO), add tensor and pipeline parallelism for the largest models, and use activation checkpointing to trade compute for memory (${L('v2-parallelism','parallelism')}). Checkpointing must scale too: sharded and asynchronous, or the job spends its time writing.</p>

<h2>9. How do we optimize its cost?</h2>
<ul>
<li>Raise MFU before adding GPUs: BF16, fused kernels/<code>torch.compile</code>, larger micro-batches, sequence packing (no padding waste), fast data loading.</li>
<li>Use spot/preemptible GPUs for jobs with robust resume.</li>
<li>Stop early: pick the best validation checkpoint instead of running all planned epochs.</li>
<li>Run small pilot jobs to find a stable learning rate before the expensive run.</li>
<li>Expire intermediate checkpoints; 112 GB × hundreds of checkpoints is a real storage bill.</li>
</ul>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“A training job was preempted. What must you have saved to resume it exactly, and how often would you checkpoint?”','<p><i>Answer (≈50 s):</i> "Weights alone are enough to serve but not to resume. For an exact resume I need the model weights and any FP32 master copy, the optimizer state — AdamW’s two moments and step count — the learning-rate scheduler, the gradient scaler if using FP16, the random-number states for every device, the global step and the data-loader position, plus the config, code commit and data snapshot ID. For an 8B full fine-tune that is roughly 112 GB, so I would write it sharded and asynchronously, atomically, and verify loads. For the interval I would start from Young/Daly — the square root of two times the write time times the mean time between failures — which is about 40 minutes for a two-minute write and an eight-hour MTBF, and also checkpoint on the SIGTERM that precedes a spot preemption."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Save the model every epoch."</p></div><div class="good"><h4>Strong answer</h4><p>Lists full training state, sizes it, chooses an interval with a formula, and covers atomic writes and preemption signals.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Data snapshot','training loop','schedules + mixed precision','evaluation','checkpoint','safetensors artifact','registry','serving'])}
<p>Next: ${L('v1-finetuning','fine-tuning methods')} use this loop with different trainable parameters and losses. Later: ${L('v2-model-cicd','model CI/CD')} promotes the artifact, and ${L('v2-distributed-training','distributed training')} scales the loop across nodes.</p></div>
`,
  quiz:[
    {q:'Micro-batch 2, accumulation 16, 4 GPUs, 2,048-token sequences. Tokens per optimizer step?',options:['65,536','262,144','131,072','16,384'],answer:1,explain:'2 × 16 × 4 = 128 sequences × 2,048 = 262,144 tokens.'},
    {q:'You resume from a weights-only checkpoint with a fresh AdamW. What do you expect?',options:['Identical continuation','A loss spike or changed dynamics, because momentum and variance estimates restart from zero','A crash','Faster convergence'],answer:1,explain:'Optimizer state carries the per-parameter statistics; without it the first steps behave like the start of training, and the scheduler position may be wrong too.'},
    {q:'Why is BF16 usually preferred over FP16 for LLM training?',options:['It has more mantissa bits','It has FP32’s exponent range, so it rarely overflows/underflows and usually needs no loss scaling','It uses 1 byte','It is supported only on CPUs'],answer:1,explain:'BF16 has 8 exponent bits (FP16 has 5) but fewer mantissa bits (7 vs 10).'},
    {q:'Using Young/Daly, checkpoint write 60 s and MTBF 10 h. Approximate interval?',options:['≈ 10 min','≈ 35 min','≈ 2 h','≈ 6 h'],answer:1,explain:'√(2 × 60 × 36,000) = √4,320,000 ≈ 2,078 s ≈ 35 min.'},
    {q:'Why should a platform accept only safetensors for third-party weights?',options:['They are always smaller','Loading pickle-based .bin/.pt files can execute arbitrary code; safetensors is pure data and memory-mappable','Engines cannot load .bin','safetensors are encrypted'],answer:1,explain:'The safety property is the point; size is the same tensor data.'},
    {q:'Training loss keeps falling; validation loss rose for the last two evaluations. Best action?',options:['Train for more epochs','Select the best-validation checkpoint and stop (early stopping), then check data size/quality','Increase learning rate','Delete the validation set'],answer:1,explain:'That pattern is overfitting.'}
  ],
  flashcards:[
    {front:'Effective batch size',back:'micro-batch × gradient-accumulation steps × data-parallel GPUs (× tokens per sequence for tokens/step).'},
    {front:'Warmup + cosine schedule',back:'Linear warmup to η_max over W steps, then η_min + ½(η_max − η_min)(1 + cos(πp)).'},
    {front:'Resumable checkpoint contents',back:'Weights (+FP32 master), optimizer state, scheduler, grad scaler, RNG states (all devices), step + data position, config/commit/data ID.'},
    {front:'Full-FT checkpoint size, 8B AdamW',back:'16 GB BF16 weights + 32 GB FP32 master + 64 GB m, v ≈ 112 GB. Weights-only export ≈ 16 GB.'},
    {front:'Young/Daly checkpoint interval',back:'≈ √(2 × checkpoint write time × MTBF).'},
    {front:'BF16 vs FP16',back:'BF16: 8 exponent / 7 mantissa bits, FP32 range, no scaler usually. FP16: 5 / 10, max 65,504, needs loss scaling.'},
    {front:'Model artifact files',back:'safetensors shards + index, config.json, generation_config.json, tokenizer files, chat template, model card/licence; adapters add adapter_config.json.'},
    {front:'MFU',back:'(6 × N × tokens/s) / peak FLOP/s — fraction of the GPU’s peak doing useful model math.'}
  ]
});
registerGlossary([
  {term:'Checkpoint',def:'Saved training state. A weights-only checkpoint can be served; a resumable one also holds optimizer, scheduler, scaler and RNG states and the data position.',lesson:'v1-training-loop',aliases:['checkpoints']},
  {term:'Gradient accumulation',def:'Summing gradients over several micro-batches before one optimizer step, to get a large effective batch with limited memory.',lesson:'v1-training-loop'},
  {term:'Learning-rate schedule',def:'The planned change of learning rate over training, typically linear warmup followed by cosine or linear decay.',lesson:'v1-training-loop',aliases:['warmup','cosine decay']},
  {term:'Mixed precision',def:'Running most math in BF16/FP16 (or FP8) while keeping sensitive state such as master weights and optimizer moments in FP32.',lesson:'v1-training-loop'},
  {term:'BF16',def:'bfloat16: 16-bit float with 8 exponent and 7 mantissa bits; FP32’s range at half the bytes; default for LLM training.',lesson:'v1-training-loop',aliases:['bfloat16']},
  {term:'Loss scaling',def:'Multiplying the loss before backward (and unscaling before the step) so small FP16 gradients do not underflow.',lesson:'v1-training-loop',aliases:['GradScaler']},
  {term:'Overfitting',def:'The model fits training data (including noise) better while getting worse on held-out data; seen as validation loss rising while training loss falls.',lesson:'v1-training-loop',aliases:['underfitting']},
  {term:'Early stopping',def:'Ending training (or selecting the checkpoint) when validation metrics stop improving.',lesson:'v1-training-loop'},
  {term:'safetensors',def:'A tensor file format with a JSON header and raw bytes; cannot execute code on load and supports zero-copy memory mapping.',lesson:'v1-training-loop'},
  {term:'Model artifact',def:'The versioned set of files that defines a usable model: weights, config, generation config, tokenizer, chat template, model card and licence.',lesson:'v1-training-loop'},
  {term:'MFU',def:'Model FLOPs utilisation: useful model FLOPs per second divided by the hardware’s peak FLOPs per second.',lesson:'v1-training-loop',aliases:['model FLOPs utilization']}
]);

/* ------------------------------------------------------------------ */
/* 1.3.3  Pretraining, CPT, SFT, LoRA/QLoRA, preference opt, distill   */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v1-finetuning', vol:1, part:3, num:3,
  title:'Pretraining, continued pretraining, SFT, LoRA/QLoRA, preference optimization and distillation', minutes:110,
  summary:'There are several ways to change what a model knows or how it behaves, and they differ by orders of magnitude in cost. Pretraining builds general ability from trillions of tokens. Continued pretraining adds a domain or language. Supervised fine-tuning teaches a format and behaviour from example conversations. LoRA and QLoRA do that while training under one percent of the weights, often on a single GPU. Preference methods such as RLHF with PPO, DPO and GRPO push the model toward answers people or verifiers prefer. Distillation teaches a small model to imitate a large one. Many problems need none of these: if the issue is missing or changing facts, retrieval is usually the right tool. This lesson explains each method with numbers and gives a decision procedure.',
  objectives:[
    'Place pretraining, continued pretraining, SFT, LoRA, QLoRA, RLHF/PPO, DPO, GRPO and distillation on a cost/benefit map and say what each changes.',
    'Explain SFT loss masking and why the training template must match serving.',
    'Compute LoRA trainable parameters r(d + k) for real layer shapes and estimate memory for full fine-tuning, LoRA and QLoRA.',
    'Explain QLoRA’s NF4 base with BF16 adapters, DPO’s loss with a worked number, and GRPO’s group-relative advantage.',
    'Decide between prompting, RAG, fine-tuning and distillation for a given problem.'
  ],
  prereqs:['v1-training-loop','v1-transformer','v1-data-pipelines'],
  next:['v1-capstone-train','v1-quantization-speculative','v2-rag-fundamentals','v2-model-cicd'],
  tags:['fine-tuning','lora','qlora','rlhf','dpo','grpo','distillation'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Pretraining is a general education; continued pretraining is a degree in a specialty; SFT is on-the-job training with worked examples; preference tuning is performance feedback; distillation is an expert writing a study guide for a junior. RAG is giving the employee the policy binder instead of making them memorise it. Now the real mechanisms.')}
${table(['Method','Data','What changes','Typical cost','Maturity'],[
 ['Pretraining','Trillions of unlabelled tokens','All weights from random init','Thousands of GPUs for weeks','Mature, frontier labs'],
 ['Continued pretraining (CPT)','Billions of in-domain tokens (e.g. Arabic, legal, code)','All weights; knowledge and language coverage','Tens–hundreds of GPUs for days','Mature'],
 ['Supervised fine-tuning (SFT)','Thousands–millions of prompt/response examples','Behaviour, format, style, task skill','One to a few GPUs (with LoRA), hours','Mature'],
 ['LoRA / QLoRA','Same as SFT (or preference data)','Small adapter matrices; base frozen','Single GPU often enough','Mature, broadly adopted'],
 ['RLHF with PPO','Prompts + reward model trained on human preference pairs','Policy towards high reward, KL-limited','High: several models in memory','Mature at labs; complex to run'],
 ['DPO','Pairs (prompt, chosen, rejected)','Policy directly from preferences','≈ SFT cost (two forward passes per pair + reference)','Broadly adopted'],
 ['GRPO','Prompts + reward function (often verifiable: tests, maths answers)','Policy via group-relative advantages; no critic model','Generation-heavy; moderate to high','Rapidly adopted since 2024–25; emerging tooling'],
 ['Distillation','Teacher outputs (logits or generated text)','Small student imitates large teacher','Teacher inference + student training','Mature']
])}

<h2>2. Why do we need it?</h2>
<p>A pretrained base model continues text; it does not reliably follow instructions, answer in your JSON schema, use your brand tone, refuse what your policy forbids, or know your domain’s jargon. A general instruct model is closer, but may still be too large, too slow, weak in Gulf Arabic, or verbose. Fine-tuning changes <b>behaviour</b> cheaply. What it is poor at is injecting <b>facts that change</b>: fares, policies and booking states change daily, and weights are frozen at training time. That is why the decision between fine-tuning and retrieval comes first.</p>
${callout('tip','The decision procedure, in order','<ol><li><b>Prompting</b> (instructions + a few examples) — try first; cheapest; measure on your eval set.</li><li><b>RAG / tools</b> — if the gap is missing, private or changing <i>knowledge</i> (' + L('v2-rag-fundamentals','RAG') + ').</li><li><b>SFT with LoRA</b> — if the gap is <i>behaviour</i>: format, tone, task skill, consistent tool-call structure, a smaller model matching a bigger one on a narrow task.</li><li><b>Preference tuning</b> (DPO/GRPO) — if outputs are valid but not the ones you prefer, or you have a verifiable reward.</li><li><b>Continued pretraining</b> — if the language or domain itself is under-represented (large unlabelled corpus available).</li><li><b>Distillation</b> — if a large model works and you need the same on a narrow task at a fraction of the serving cost.</li></ol>Combining is normal: a LoRA-tuned small model that calls tools and reads retrieved policies.')}

<h2>3. How does it work internally?</h2>
<h3>3.1 Pretraining and continued pretraining</h3>
<p>Both minimise next-token cross-entropy over raw text (${L('v1-ai-landscape','self-supervised')}). Continued pretraining starts from a pretrained checkpoint with a lower learning rate and typically <b>mixes in general data</b> ("replay") so the model does not lose existing abilities — the risk called <b>catastrophic forgetting</b>. Adding a language may also require extending the tokenizer (new tokens, new embedding rows), which is a significant, rarely necessary step.</p>

<h3>3.2 Supervised fine-tuning (SFT)</h3>
<p>${term('SFT')} trains on conversations rendered with the model’s chat template. Loss is computed <b>only on the assistant tokens</b>: system and user tokens are given label −100 (PyTorch’s ignore index), so the model learns to produce answers, not to imitate users.</p>
${formula(`
tokens:  <sys> You are Atlas … <user> My flight was cancelled … <asst> I am sorry … <eot>
labels:   −100 −100 …          −100 −100 …                         I am sorry … <eot>
                                                                    ↑ loss only here

SFT loss = mean over assistant tokens of  − ln P(token | everything before it)
`)}
<p>Quality beats quantity: a few thousand clean, consistent, representative examples often outperform a large noisy set. Include hard cases: escalations, refusals, missing information, Arabic and mixed-language messages.</p>

<h3>3.3 LoRA: low-rank adaptation</h3>
<p>${term('LoRA')} (Hu et al., 2021) freezes each pretrained weight W (d × k) and learns an update ΔW = B·A with A: r × k and B: d × r, with rank r ≪ d, k.</p>
${formula(`
h = W·x + (α / r) · B·A·x        A initialised random,  B initialised to 0  → ΔW = 0 at start

trainable parameters per adapted matrix = r × (d + k)     vs   d × k for full fine-tuning

WORKED 1  one 4,096 × 4,096 projection, r = 16
          16 × (4,096 + 4,096) = 131,072      vs 16,777,216      → 0.78 %

WORKED 2  Llama-3.2-1B shape (hidden 2,048, 16 layers, 8 KV heads × 64,
          intermediate 8,192, total ≈ 1.236 B params), r = 16

          q_proj  2,048 → 2,048 : 16 × (2,048 + 2,048) =  65,536
          k_proj  2,048 →   512 : 16 × (2,048 +   512) =  40,960
          v_proj  2,048 →   512 :                         40,960
          o_proj  2,048 → 2,048 :                         65,536
          attention per layer                           = 212,992
          × 16 layers                                   = 3,407,872   (0.28 %)

          gate_proj, up_proj 2,048 → 8,192 : 16 × 10,240 = 163,840 each
          down_proj 8,192 → 2,048          :              163,840
          MLP per layer = 491,520  × 16                 = 7,864,320

          all linear layers: 3,407,872 + 7,864,320      = 11,272,192  (0.91 %)
          adapter file in BF16 ≈ 11.27 M × 2 B          ≈ 22.5 MB
`)}
${anim('v1-ft-lora')}
<p>Hyperparameters that matter: <b>rank r</b> (8–64 typical; capacity of the update), <b>α</b> (scale; α/r multiplies the update — many recipes set α = r or 2r), <b>target modules</b> (attention only, or all linear layers — usually better), <b>learning rate</b> (higher than full fine-tuning, e.g. 1 × 10⁻⁴ – 2 × 10⁻⁴), and dropout on the adapter.</p>

<h3>3.4 Memory: full fine-tuning vs LoRA vs QLoRA</h3>
${formula(`
8.03 B model, AdamW, before activations (activations depend on batch × sequence)

FULL FINE-TUNE  (BF16 weights, BF16 grads, FP32 master, FP32 m and v)
   8.03 × 10⁹ × (2 + 2 + 4 + 8) B = 128.5 GB       → multiple 80 GB GPUs + sharding

LoRA, r = 16 on all linear layers of the 8B shape
   adapters ≈ 42 M params (see below)
   frozen BF16 base       8.03 × 10⁹ × 2 B            = 16.06 GB
   adapter weights + grads + FP32 master + m, v
                          42 × 10⁶ × 16 B             ≈  0.67 GB
   total                                              ≈ 16.7 GB  → fits one GPU with room for activations

   (8B LoRA count: per layer q 131,072 + k 81,920 + v 81,920 + o 131,072
    + gate 294,912 + up 294,912 + down 294,912 = 1,310,720; × 32 = 41,943,040)

QLoRA: base stored in 4-bit NF4 ≈ 0.5 B/param plus quantisation constants
   8.03 × 10⁹ × 0.5 B     ≈ 4.0 GB  (+ embeddings/LM head often kept in 16-bit,
                                      + constants: realistic ≈ 5–6 GB)
   + adapters as above    ≈ 0.67 GB
   total                  ≈ 6–7 GB  → fits a 24 GB GPU with activations
`)}
<h3>3.5 QLoRA in detail</h3>
<p>${term('QLoRA')} (Dettmers et al., 2023) combined three ideas so that a 65B model could be fine-tuned on a single 48 GB GPU:</p>
<ol>
<li><b>${term('NF4')}</b> (4-bit NormalFloat): a 4-bit data type whose 16 levels are placed at quantiles of a normal distribution, matching how pretrained weights are distributed. Weights are quantised in blocks (e.g. 64 values) with one scale per block.</li>
<li><b>Double quantisation</b>: the per-block scales are themselves quantised, cutting their overhead from ≈ 0.5 to ≈ 0.127 bits per parameter (per the paper).</li>
<li><b>Paged optimizers</b>: optimizer state can spill to CPU memory via unified memory during spikes, avoiding OOM.</li>
</ol>
<p>During each forward and backward, the NF4 base blocks are <b>dequantised to BF16</b> on the fly for the matmul; the LoRA adapters A and B are trained in BF16. So "4-bit training" is a misnomer: storage of the frozen base is 4-bit; computation and the trainable parameters are 16-bit. QLoRA trains somewhat slower than LoRA because of dequantisation, and the result is an adapter for the <b>quantised</b> base — test quality on the base precision you will actually serve.</p>
${callout('warn','QLoRA depends on library and hardware support','The common implementation is bitsandbytes with Hugging Face PEFT/Transformers. Support varies by GPU vendor, architecture and version. Pin versions and test on your exact GPU type before planning around it.')}

<h3>3.6 Preference optimisation</h3>
<p>SFT shows the model good answers. Preference methods show it which of two answers is <i>better</i>, which captures qualities that are hard to write down (helpfulness, concision, safe refusal style).</p>
<p><b>${term('RLHF')} with PPO</b> (as in InstructGPT, Ouyang et al., 2022): (1) collect human rankings of model outputs; (2) train a <b>reward model</b> to predict them; (3) optimise the policy with PPO to maximise reward minus a <b>KL penalty</b> that keeps it close to the SFT reference model, so it does not drift into gibberish that fools the reward model. A PPO setup holds four models — policy, reference, reward and value (critic) — which makes it memory-hungry and operationally complex.</p>
<p><b>${term('DPO')}</b> (Rafailov et al., 2023) skips the reward model and RL loop. For each prompt x with a chosen answer y_w and rejected answer y_l it increases the policy’s log-probability margin of y_w over y_l, measured relative to a frozen reference model:</p>
${formula(`
             ⎡       ⎛  ⎛ log πθ(y_w|x) − log π_ref(y_w|x) ⎞   ⎛ log πθ(y_l|x) − log π_ref(y_l|x) ⎞ ⎞ ⎤
L_DPO = − ln σ ⎢  β ·  ⎜  ⎝            chosen gain             ⎠ − ⎝           rejected gain            ⎠ ⎟ ⎥
             ⎣       ⎝                                                                                      ⎠ ⎦

WORKED  β = 0.1
  at the start πθ = π_ref → both gains 0 → σ(0) = 0.5 → loss = − ln 0.5 = 0.693
  after training: chosen gain +2.0, rejected gain −1.0
      margin = 2.0 − (−1.0) = 3.0      β × 3.0 = 0.3
      σ(0.3) = 1 / (1 + e⁻⁰·³) = 1 / 1.741 = 0.574
      loss = − ln 0.574 = 0.554                  ← lower: preference learned
`)}
<p><b>${term('GRPO')}</b> (Group Relative Policy Optimization, introduced in DeepSeekMath, Shao et al., 2024, and used for DeepSeek-R1’s reasoning training) samples a <b>group</b> of answers per prompt, scores each with a reward function, and uses each answer’s reward relative to its group as the advantage — no learned value model needed:</p>
${formula(`
advantage Aᵢ = (rᵢ − mean(r)) / std(r)

WORKED  4 sampled answers to one refund-policy question, reward 1 if the
        answer matches the verified policy outcome, else 0
        r = [1, 0, 0, 1]      mean = 0.5      std = 0.5
        A = [+1, −1, −1, +1]
        → raise the probability of answers 1 and 4, lower 2 and 3
          (with a clipped objective and a KL term to the reference model)
`)}
<p>GRPO shines when rewards are <b>verifiable</b> (unit tests pass, a maths answer matches, a JSON validates, a tool call returns the expected record). It is generation-heavy — each step samples several full answers — so inference speed becomes the training bottleneck, and training frameworks often embed an inference engine such as vLLM for the rollouts.</p>
${callout('danger','Reward hacking','Any method that optimises a score will find the score’s weaknesses: verbose answers if the judge likes length, confident tone if raters reward confidence, formats that pass a checker without being right. Keep a held-out human-reviewed evaluation that the optimisation never sees, and never let preference tuning substitute for authorisation controls on tools.')}

<h3>3.7 Distillation</h3>
<p>${term('Distillation')} trains a small <b>student</b> to imitate a large <b>teacher</b>. Two forms: <b>logit distillation</b> (minimise the KL divergence between teacher and student next-token distributions, often softened with a temperature — needs the same tokenizer and access to teacher logits) and <b>sequence-level / synthetic-data distillation</b> (the teacher generates answers to many prompts; the student is SFT-trained on them — works across tokenizers and through APIs, subject to the teacher’s licence terms). The payoff is serving cost: an 8B student needs about 1/9 of the per-token FLOPs of a 70B teacher (${L('v1-ai-landscape','2·N rule')}).</p>

<h2>4. Where does it fit?</h2>
${fig('From base model to a deployed specialised model', svgDiagram({w:900,h:300,
 boxes:[
  {id:'pt',x:20,y:110,w:130,h:56,label:'Pretrained base',sub:'open weights'},
  {id:'cpt',x:180,y:30,w:150,h:56,label:'Continued pretrain',sub:'optional: language/domain',cls:'x'},
  {id:'sft',x:180,y:190,w:150,h:56,label:'SFT (LoRA)',sub:'behaviour, format',cls:'hl'},
  {id:'pref',x:370,y:190,w:160,h:56,label:'DPO / GRPO',sub:'optional: preferences'},
  {id:'ev',x:570,y:110,w:130,h:56,label:'Evaluation gate',sub:'vs baseline',cls:'warn'},
  {id:'serve',x:740,y:110,w:140,h:56,label:'Serve',sub:'merged or adapter'},
  {id:'rag',x:570,y:220,w:130,h:56,label:'RAG + tools',sub:'facts at runtime',cls:'ok'}
 ],
 arrows:[{from:'pt',to:'cpt',cls:'dash'},{from:'pt',to:'sft'},{from:'cpt',to:'sft',cls:'dash'},{from:'sft',to:'pref'},{from:'pref',to:'ev'},{from:'sft',to:'ev',cls:'dash'},{from:'ev',to:'serve'},{from:'rag',to:'serve',label:'context'}]
}), 'Weights carry behaviour; retrieval and tools carry changing facts. Every path passes an evaluation gate against the un-tuned baseline.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Data pipeline</b>: SFT and preference datasets need the same dedup, PII and split discipline (${L('v1-data-pipelines','datasets')}).</li>
<li><b>Serving</b>: engines such as vLLM can serve many LoRA adapters on one base (<code>--enable-lora</code>, <code>--max-loras</code>), and gateways can route tenants to adapters (${L('v1-engines','engines')}).</li>
<li><b>Quantisation</b>: an adapter trained on a BF16 base may behave differently on an INT4 base; evaluate the served combination (${L('v1-quantization-speculative','quantization')}).</li>
<li><b>Prefix caching</b>: KV cache entries are adapter-specific (the adapter changes K and V), so caches are keyed by adapter ID.</li>
<li><b>MLOps</b>: adapters are artifacts with lineage to base revision, data snapshot and eval report (${L('v2-model-cicd','model CI/CD')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li>A <b>fine-tuning service</b>: templated jobs (base model, dataset ID, LoRA config) on a GPU queue with quotas (Kueue), outputs registered automatically.</li>
<li><b>Base-model intake</b>: licence review, pinned revision, safetensors only, security scan, baseline evaluation.</li>
<li><b>Adapter lifecycle</b>: compatibility (adapter ↔ base revision ↔ tokenizer ↔ template), storage, rollout and rollback per tenant.</li>
<li><b>Evaluation gates</b>: no adapter deploys without beating the baseline on the locked test set and passing safety checks.</li>
</ul>
${callout('devops','DevOps bridge','A LoRA adapter is like a small overlay layer on a large immutable base image: cheap to build, cheap to store, and many can share one base. Where it breaks: it is only valid on the exact base revision it was trained on, it changes computation (not just files), and its effect can only be verified by evaluation.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Tuned model lost general skills or Arabic quality','Catastrophic forgetting: too many epochs, too high LR, narrow data','General benchmark / per-language eval before vs after','Lower LR, fewer epochs, mix general data, LoRA instead of full FT'],
 ['Adapter loads but output is garbage','Wrong base revision, different tokenizer or template, wrong target modules','adapter_config base model; template diff','Pin base revision with adapter; same template in train and serve'],
 ['Model learned to imitate users','Loss not masked to assistant tokens','Label inspection (−100 on non-assistant)','Assistant-only loss / completion-only collator'],
 ['Fine-tune "knows" outdated fares','Facts trained into weights','Answers vs current source','Move facts to RAG/tools; train behaviour only'],
 ['DPO model became verbose and sycophantic','Preference data biased toward long, agreeable answers; β too low','Length distribution of chosen vs rejected','Balance data; length-controlled evaluation; tune β'],
 ['GRPO reward rises, quality falls','Reward hacking','Human review of high-reward samples','Fix reward; add held-out human eval; KL constraint'],
 ['QLoRA OOM or very slow','Unsupported kernels, long sequences, no gradient checkpointing','Peak memory and step time','Gradient checkpointing, shorter max length, check library/GPU support']
])}

<h2>8. How do we scale it?</h2>
<p>SFT with LoRA scales with data parallelism; full fine-tuning of large models needs FSDP/ZeRO sharding (${L('v2-distributed-training','distributed training')}). Preference methods with online generation (PPO, GRPO) are bounded by rollout throughput, so they borrow inference-engine techniques: batching, KV cache, separate generation workers. Serving many fine-tunes scales with multi-adapter serving rather than one GPU pool per model.</p>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Illustrative: 20,000 SFT examples × 600 tokens × 3 epochs = 36 M training tokens
LoRA on an 8B model ≈ (forward + backward) ≈ 6 × N FLOPs per token as an upper estimate
   (frozen base still needs backward through activations; weight-gradient work is skipped,
    so true cost is lower — use 6N as a conservative bound)
   6 × 8.03 × 10⁹ × 36 × 10⁶ ≈ 1.73 × 10¹⁸ FLOPs
   at an assumed 30 % MFU on one H100 (0.30 × 989.5 × 10¹² ≈ 2.97 × 10¹⁴ FLOP/s)
   ≈ 5,830 s ≈ 1.6 GPU-hours

Compare: pretraining the same model ≈ 7.2 × 10²³ FLOPs → ≈ 400,000× more
`)}
<p>Fine-tuning is cheap; the expensive parts are data curation, evaluation and the serving footprint. Distillation or a well-tuned small model is the main serving-cost lever: same task quality on a model a fraction of the size.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“The business wants the assistant to know our latest baggage policies. Fine-tune or RAG?”','<p><i>Answer (≈50 s):</i> "RAG, because policies are facts that change and need citations and access control; fine-tuning bakes in a snapshot that goes stale and cannot be traced to a source. I would fine-tune — with LoRA, so it is a small adapter on a pinned base — only for behaviour: consistent tone, our escalation rules, structured outputs for the booking tools, or making a smaller model as good as a bigger one on this narrow task. LoRA trains about one percent or less of the parameters, so an 8B model fits on one GPU and the adapter is tens of megabytes. Either way the change ships only if it beats the un-tuned baseline on a held-out, customer-split evaluation set, including Arabic."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Fine-tune the model on the policy PDFs so it knows them."</p></div><div class="good"><h4>Strong answer</h4><p>Separates knowledge (RAG) from behaviour (LoRA SFT), quantifies LoRA, and makes evaluation the release gate.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Base model','(CPT)','SFT with LoRA','(DPO / GRPO)','evaluation gate','adapter or merged weights','multi-adapter serving'])}
${chain(['Changing facts','RAG + tools','not fine-tuning'])}
<p>Next: ${L('v1-capstone-train','the capstone')} runs SFT with LoRA end to end. Later: ${L('v1-engines','engines')} serve adapters, and ${L('v2-rag-production','production RAG')} handles knowledge.</p></div>
`,
  quiz:[
    {q:'LoRA with r = 8 on a 4,096 × 1,024 projection. Trainable parameters?',options:['32,768','40,960','4,194,304','8,192'],answer:1,explain:'r(d + k) = 8 × (4,096 + 1,024) = 40,960. 4,194,304 is the full matrix.'},
    {q:'What is stored in 4-bit in QLoRA?',options:['Everything, including gradients','The frozen base weights (NF4); adapters and computation are BF16','Only the adapters','The KV cache'],answer:1,explain:'NF4 base blocks are dequantised to BF16 for each matmul; LoRA A and B are trained in BF16.'},
    {q:'In SFT, why are system and user tokens labelled −100?',options:['To save memory','So loss is computed only on assistant tokens and the model learns to answer, not to imitate users','They are padding','To speed up tokenization'],answer:1,explain:'−100 is the ignore index for PyTorch cross-entropy.'},
    {q:'At the start of DPO training (policy = reference), what is the loss for every pair?',options:['0','ln 2 ≈ 0.693','1','β'],answer:1,explain:'Both gains are 0 so σ(0) = 0.5 and −ln 0.5 = 0.693.'},
    {q:'GRPO rewards for a group are [1, 1, 0, 0, 0, 0]. What sign do the first two advantages have?',options:['Negative','Zero','Positive','Undefined'],answer:2,explain:'Mean ≈ 0.333; answers above the group mean get positive advantages. No value model is needed.'},
    {q:'Which problem is best solved with RAG rather than fine-tuning?',options:['Answer in a strict JSON schema','Use the company’s friendly tone','Answer from this week’s updated cancellation policy, with citations','Make a 1B model match an 8B model on ticket routing'],answer:2,explain:'Changing facts with citations belong in retrieval. The others are behaviour or distillation problems.'}
  ],
  flashcards:[
    {front:'LoRA formula',back:'h = Wx + (α/r)·B·A·x; A: r × k (random), B: d × r (zero); trainable r(d + k) per matrix.'},
    {front:'LoRA counts to remember',back:'4,096² matrix, r 16: 131,072 (0.78 %). Llama-3.2-1B r 16 all linear: 11.27 M (0.91 %). 8B r 16 all linear: 41.9 M.'},
    {front:'Memory: full FT vs LoRA vs QLoRA (8B)',back:'≈ 128 GB (16 B/param) vs ≈ 16.7 GB (BF16 base + adapters) vs ≈ 6–7 GB (NF4 base + adapters), before activations.'},
    {front:'QLoRA’s three ideas',back:'NF4 4-bit base, double quantisation of scales, paged optimizers. Compute and adapters in BF16.'},
    {front:'DPO loss',back:'−ln σ(β[(log πθ(y_w) − log π_ref(y_w)) − (log πθ(y_l) − log π_ref(y_l))]). Starts at ln 2.'},
    {front:'GRPO advantage',back:'(rᵢ − mean(r_group)) / std(r_group); no critic/value model; best with verifiable rewards.'},
    {front:'RLHF-PPO models in memory',back:'Policy, reference, reward model, value (critic).'},
    {front:'Fine-tune or RAG?',back:'Behaviour (format, tone, skill) → fine-tune. Changing/private facts with citations → RAG/tools.'}
  ]
});
registerGlossary([
  {term:'Continued pretraining',def:'Further next-token training of a pretrained model on a large in-domain or in-language corpus, usually mixed with general data to avoid forgetting.',lesson:'v1-finetuning',aliases:['CPT','domain-adaptive pretraining']},
  {term:'SFT',def:'Supervised fine-tuning on prompt–response examples (chat format), with loss on the response tokens.',lesson:'v1-finetuning',aliases:['supervised fine-tuning','instruction tuning']},
  {term:'LoRA',def:'Low-Rank Adaptation: freeze W and train ΔW = B·A of rank r, adding r(d + k) parameters per adapted matrix.',lesson:'v1-finetuning',aliases:['low-rank adaptation','adapter']},
  {term:'QLoRA',def:'LoRA on a frozen base stored in 4-bit NF4 (with double quantisation and paged optimizers); base dequantised to BF16 for compute.',lesson:'v1-finetuning'},
  {term:'NF4',def:'4-bit NormalFloat: a 4-bit data type with levels at normal-distribution quantiles, used for QLoRA base weights.',lesson:'v1-finetuning'},
  {term:'RLHF',def:'Reinforcement learning from human feedback: train a reward model on human preferences, then optimise the policy (often with PPO) under a KL penalty to a reference model.',lesson:'v1-finetuning',aliases:['PPO']},
  {term:'DPO',def:'Direct Preference Optimization: trains directly on chosen/rejected pairs with a logistic loss on log-probability margins relative to a reference model.',lesson:'v1-finetuning'},
  {term:'GRPO',def:'Group Relative Policy Optimization: RL that samples a group of answers per prompt and uses group-normalised rewards as advantages, without a value model.',lesson:'v1-finetuning'},
  {term:'Distillation',def:'Training a smaller student model to imitate a larger teacher, via teacher logits (KL) or teacher-generated data.',lesson:'v1-finetuning',aliases:['knowledge distillation']},
  {term:'Catastrophic forgetting',def:'Loss of previously learned abilities when a model is trained further on narrow data.',lesson:'v1-finetuning'},
  {term:'Reward hacking',def:'A model exploiting weaknesses of a reward or judge to score highly without truly improving.',lesson:'v1-finetuning'}
]);

/* ------------------------------------------------------------------ */
/* 1.3.4  Capstone stages 1–3                                          */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v1-capstone-train', vol:1, part:3, num:4,
  title:'Capstone stages 1–3: tiny model → open-weight model → LoRA fine-tune', minutes:90,
  summary:'This capstone starts the Atlas thread, a fictional AI assistant platform for a GCC travel company that the course builds stage by stage. In stage one you train a tiny character-level transformer from scratch on a laptop, so every concept from Parts 1 to 3 becomes code you have run. In stage two you replace it with a small pretrained open-weight instruct model, pinned to an exact revision, and measure a baseline on realistic travel-support prompts. In stage three you fine-tune that model with LoRA on synthetic support tickets split by customer, and compare it against the baseline. At each stage the lesson states what changed in the architecture and what has, and has not, been validated.',
  objectives:[
    'Train a character-level decoder-only transformer, predict its starting loss, and generate text from a checkpoint.',
    'Load a pinned open-weight instruct model with its chat template and run a reproducible baseline evaluation.',
    'Build a synthetic SFT dataset split by customer and run a LoRA fine-tune with assistant-only loss.',
    'Compare tuned and baseline models on the same held-out set and decide whether to promote.',
    'State, for each stage, what changed architecturally and what is lab-validated versus untested at scale.'
  ],
  prereqs:['v1-finetuning','v1-training-loop','v1-transformer'],
  next:['v1-gpu-architecture','v1-inference-anatomy','v1-benchmarking'],
  tags:['capstone','lab','pytorch','lora','atlas'],
  html:`
<p><b>Atlas</b> is the course’s running system: an enterprise AI assistant platform for a fictional GCC travel company. Stages 1–3 (this lesson) produce a model. Stage 4 serves it with vLLM (${L('v1-benchmarking','benchmarking')}), stage 5 deploys it on Kubernetes (${L('v1-k8s-production','production readiness')}), and Volume 2 adds RAG, MCP tools, hardening and scale (${L('v2-capstone-platform','capstone platform')}).</p>
${anim('v1-cap-stages')}
${callout('warn','What this capstone does and does not prove','These are lab exercises on public-domain or synthetic data, on a laptop or a single GPU. They demonstrate the mechanics end to end. They do not demonstrate production quality, safety, Arabic performance on real customers, or behaviour at scale, and you should not describe them as production experience. The lab files referenced below are planned paths (see <code>labs/README.md</code>); check <code>labs/TEST_RESULTS.md</code> for which have been run and tested.')}

<h2>1. What is it?</h2>
<p>Three increasingly realistic ways of getting a model that can answer a travel-support question:</p>
${table(['Stage','You build','Model','Hardware','Lab path (planned)'],[
 ['1','Everything from scratch','Char-level GPT, ≈ 0.8 M params','Laptop CPU','<code>labs/02-tiny-transformer/tiny_gpt.py</code> (with <code>labs/01-pytorch-basics/</code> as warm-up)'],
 ['2','Loading, prompting, baseline evaluation','Pretrained ≈ 0.6–1.2 B instruct model (Qwen3-0.6B or Llama-3.2-1B-Instruct class)','CPU works slowly; any small GPU','<code>labs/03-finetune/</code> (baseline script)'],
 ['3','Dataset + LoRA SFT + comparison','Same base + LoRA adapter','One GPU (a 1B model also runs on CPU, slowly)','<code>labs/03-finetune/make_dataset.py</code>, <code>labs/03-finetune/lora_sft.py</code>']
])}

<h2>2. Why do we need it?</h2>
<p>Reading about backpropagation and attention is not the same as watching a loss curve fall on code you wrote. Stage 1 removes every abstraction, so later, when a framework hides something, you know what it is hiding. Stage 2 shows what a pretrained model gives you for free — and the supply-chain and contract issues (licence, revision, tokenizer, template) that come with it. Stage 3 is the most common real-world customisation: a small adapter on an open model, gated by evaluation.</p>

<h2>3. How does it work internally?</h2>
<h3>Stage 1 — a tiny character-level GPT</h3>
<p><b>Data</b>: one public-domain text file (for example a few MB of classic literature). Character vocabulary: every distinct character, typically 60–100 (65 for the widely used Tiny Shakespeare file). Split the text 90/10 into train/validation by position, not randomly, so validation is genuinely unseen text.</p>
<p><b>Model</b>: the decoder-only block from ${L('v1-transformer','the transformer lesson')} with small sizes: 4 layers, 4 heads, embedding 128, context (block size) 128, learned position embeddings (simpler than RoPE for a first build), LayerNorm, GELU MLP with 4× expansion.</p>
${formula(`
Parameter estimate (vocab V = 65, d = 128, L = 4, block 128)
   per block: attention 4d² = 65,536   MLP 8d² = 131,072   ≈ 196,608 (+ biases, norms)
   4 blocks ≈ 786,432
   token embedding  65 × 128  =  8,320
   position emb.   128 × 128  = 16,384
   LM head tied to token embedding
   total ≈ 0.81 M parameters

Starting loss: uniform over 65 characters → ln 65 = 4.17
   ↑ if your first logged loss is far from 4.17, look for a bug before training further

Compute for 2,000 steps × batch 32 × 128 tokens = 8.19 M tokens
   6 × 0.81 × 10⁶ × 8.19 × 10⁶ ≈ 4.0 × 10¹³ FLOPs
   on a laptop CPU at an assumed 100 GFLOP/s effective ≈ 400 s  (illustrative)
`)}
${code('python',`# core of the training step in tiny_gpt.py (simplified)
def get_batch(data, block, batch):
    ix = torch.randint(len(data) - block - 1, (batch,))
    x = torch.stack([data[i:i + block] for i in ix])
    y = torch.stack([data[i + 1:i + block + 1] for i in ix])   # targets = inputs shifted by one
    return x, y

for step in range(max_steps):
    x, y = get_batch(train_data, block_size, batch_size)
    logits = model(x)                                          # [B, T, V]
    loss = F.cross_entropy(logits.view(-1, V), y.view(-1))
    opt.zero_grad(set_to_none=True)
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    opt.step()
    if step % 200 == 0:
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(),
                    "step": step, "config": cfg}, "ckpt.pt")`)}
<p><b>What to observe and record</b> (your own numbers — do not copy anyone else’s): first loss vs 4.17; training and validation loss every 200 steps; the step where validation stops improving; samples at step 0 (random characters), mid-way (word-like shapes) and the end (plausible spelling and line structure). Then delete the process, reload <code>ckpt.pt</code> and confirm generation continues — a first resumable checkpoint.</p>
<p><b>Generation from your checkpoint</b> closes the loop with ${L('v1-generation','decoding')}: feed a prompt, take the logits of the last position, divide by a temperature, sample, append, crop the context to the block size, repeat.</p>
${code('python',`@torch.no_grad()
def generate(model, idx, max_new_tokens, temperature=0.8):
    model.eval()
    for _ in range(max_new_tokens):
        logits = model(idx[:, -block_size:])[:, -1, :]      # last position only
        probs = torch.softmax(logits / temperature, dim=-1)
        nxt = torch.multinomial(probs, num_samples=1)        # sample one id
        idx = torch.cat([idx, nxt], dim=1)
    return idx`)}
<p>This naive loop recomputes the whole context every step; the lab’s optional KV-cache variant stores keys and values per layer so each step processes one token — the same optimisation production engines rely on (${L('v1-kv-cache','KV cache')}). Time both versions at 128 and 1,024 generated characters and note how the gap grows with length.</p>
<p><b>Architecture at stage 1</b>: one Python process, one text file, your own checkpoint format. Nothing external. This is the "hello world" that makes every later abstraction legible.</p>

<h3>Stage 2 — a pretrained open-weight instruct model</h3>
<p><b>Intake checklist</b> (the platform discipline starts here):</p>
${checklist([
 {key:'cap2-licence',text:'Read the licence (e.g. Apache-2.0 for Qwen3 models; the Llama 3.2 Community License for Llama 3.2) and record it.'},
 {key:'cap2-rev',text:'Pin the exact Hub revision (commit SHA), not <code>main</code>.'},
 {key:'cap2-st',text:'Confirm weights are safetensors; do not set <code>trust_remote_code=True</code>.'},
 {key:'cap2-cfg',text:'Read <code>config.json</code>: layers, hidden size, KV heads, vocab, max position embeddings, tied embeddings.'},
 {key:'cap2-mem',text:'Estimate memory: ≈ 1.24 B × 2 B ≈ 2.5 GB in BF16 for a Llama-3.2-1B-class model.'},
 {key:'cap2-tok',text:'Measure tokens per message for English and Arabic samples with this tokenizer.'}
])}
${code('python',`from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

MODEL, REV = "meta-llama/Llama-3.2-1B-Instruct", "<pinned-commit-sha>"   # or a Qwen3 small model
tok = AutoTokenizer.from_pretrained(MODEL, revision=REV)
model = AutoModelForCausalLM.from_pretrained(MODEL, revision=REV, torch_dtype=torch.bfloat16)

messages = [{"role": "system", "content": "You are Atlas, a travel-support assistant."},
            {"role": "user", "content": "My flight from Jeddah was cancelled. What can I do?"}]
inputs = tok.apply_chat_template(messages, add_generation_prompt=True, return_tensors="pt")
out = model.generate(inputs, max_new_tokens=200, do_sample=False)     # greedy for a stable baseline
print(tok.decode(out[0][inputs.shape[-1]:], skip_special_tokens=True))`)}
<p><b>Baseline evaluation</b>: write about 50 realistic prompts across categories (cancellation, refund, baggage, change fee, visa questions to escalate, angry customer, Arabic, mixed Arabic–English) with a short rubric per prompt: required facts, required escalation, forbidden claims, tone. Score greedy outputs. Record scores per category and language, tokens per answer and time per answer. This number is what stage 3 must beat.</p>
<p><b>Architecture change from stage 1</b>: the model now comes from an external supply chain (Hub, licence, revision), and correctness depends on a <b>contract</b> of weights + tokenizer + chat template + generation config. You no longer write the model; you operate it.</p>

<h3>Stage 3 — LoRA SFT on synthetic travel-support tickets</h3>
<p><b>Dataset</b> (<code>make_dataset.py</code>): generate several thousand synthetic tickets from templates and slot values (routes such as RUH–DXB or JED–CAI, fare classes, booking references, dates, policies) with a desired assistant reply each, including escalation and "I don’t know" cases, in English and Arabic. Assign each synthetic customer an ID and <b>split by customer</b> (${L('v1-data-pipelines','group split')}). Deduplicate. Keep the 50 stage-2 prompts as an additional, never-trained evaluation set.</p>
${callout('note','Synthetic data limits','Template-generated data teaches format and policy rules well but is far less varied than real customers. High scores on a synthetic test set say little about real traffic; the honest claim is "learned the target format and rules on synthetic data".')}
<p><b>Training</b> (<code>lora_sft.py</code>), typical starting configuration for a ≈ 1B model:</p>
${code('python',`from peft import LoraConfig

lora = LoraConfig(
    r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
)
# training settings (illustrative starting points, tune on validation):
#   learning rate 2e-4, cosine schedule, warmup 3 %, 2 epochs,
#   max sequence length 1,024, BF16, assistant-only loss,
#   evaluate every N steps, keep the best-validation adapter`)}
${formula(`
Trainable parameters (Llama-3.2-1B shape, r = 16, all linear layers)
   = 11,272,192  ≈ 0.91 % of ≈ 1.236 B          (worked in the fine-tuning lesson)
Adapter size in BF16 ≈ 22.5 MB
Memory (BF16 base ≈ 2.5 GB + adapter state ≈ 0.18 GB + activations) → fits a small GPU
`)}
<p><b>Evaluation report</b> (one page, versioned next to the adapter):</p>
${table(['Section','Content'],[
 ['Identity','Adapter name, base model + revision, dataset snapshot ID, training config hash, code commit'],
 ['Training summary','Steps, epochs, final train/validation loss, best-validation step, wall-clock time, GPU type'],
 ['Results vs baseline','Per category and per language: baseline score, adapter score, n, 95 % interval'],
 ['Regressions','Every category that got worse, with examples'],
 ['Safety and behaviour','Escalation correctness, refusal behaviour, PII in outputs, hallucinated policy claims'],
 ['Decision','Promote / do not promote, and why; known limits (synthetic data, lab scale)']
])}
<p><b>Compare</b>: run the stage-2 harness with the adapter loaded, on the same prompts and the held-out customer split, greedy decoding, same template. Promote only if it beats the baseline on the categories you care about and does not regress Arabic or escalation behaviour. Then either merge the adapter (one artifact, no extra latency) or keep it separate for multi-adapter serving in stage 4.</p>
<p><b>Architecture change from stage 2</b>: a data pipeline, a training job, a new artifact type (adapter) tied to a base revision, and an evaluation gate between training and serving — the skeleton of an MLOps platform.</p>

<h2>4. Where does it fit?</h2>
${fig('Atlas after stage 3', svgDiagram({w:900,h:300,
 boxes:[
  {id:'gen',x:20,y:40,w:160,h:56,label:'Ticket generator',sub:'synthetic, EN + AR'},
  {id:'ds',x:220,y:40,w:160,h:56,label:'Dataset snapshot',sub:'split by customer'},
  {id:'hub',x:20,y:180,w:160,h:56,label:'Base model',sub:'pinned revision'},
  {id:'tr',x:420,y:110,w:160,h:56,label:'LoRA SFT job',sub:'one GPU',cls:'hl'},
  {id:'ad',x:620,y:40,w:120,h:56,label:'Adapter',sub:'≈ 22 MB'},
  {id:'ev',x:620,y:180,w:120,h:56,label:'Eval vs baseline',sub:'gate',cls:'warn'},
  {id:'next',x:770,y:110,w:110,h:56,label:'Stage 4',sub:'vLLM serve',cls:'x'}
 ],
 arrows:[{from:'gen',to:'ds'},{from:'ds',to:'tr'},{from:'hub',to:'tr'},{from:'tr',to:'ad'},{from:'ad',to:'ev',fromSide:'bottom',toSide:'top'},{from:'hub',to:'ev',cls:'dash',label:'baseline'},{from:'ev',to:'next',label:'promote'}]
}), 'Everything left of the gate is lab-validated mechanics. Serving, scale and real users begin in stage 4.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li>Stage 1 uses ${L('v1-tensors-pytorch','tensors and autograd')}, ${L('v1-transformer','attention')} and ${L('v1-training-loop','checkpoints')} directly.</li>
<li>Stage 2 uses ${L('v1-tokenization-embeddings','tokenizers and templates')} and ${L('v1-generation','decoding')}.</li>
<li>Stage 3 uses ${L('v1-data-pipelines','dataset discipline')} and ${L('v1-finetuning','LoRA')}.</li>
<li>Part 4 explains what the GPU did during all this (${L('v1-gpu-architecture','GPU architecture')}, ${L('v1-gpu-memory','GPU memory')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<p>Even in a lab, practise the platform habits: a pinned environment (requirements lock or image digest), the model revision and licence recorded, the dataset snapshot hashed, run configs committed, metrics logged to a tracker, artifacts named with their lineage (<code>atlas-sft-lora-r16-ds2026-10-14.1-base&lt;sha&gt;</code>), and a written evaluation report. These are the same controls stage 5 automates in CI/CD.</p>
${callout('devops','DevOps bridge','Stage 1 is "write a binary from scratch", stage 2 is "pull a vendor image and pin its digest", stage 3 is "build an overlay and gate it with integration tests". Where it breaks: unit tests do not exist for model behaviour; the evaluation set is your test suite and must be versioned and protected like one.')}

<h2>7. What happens when it fails?</h2>
${table(['Stage','Symptom','Cause','Fix'],[
 ['1','First loss ≈ 0.5, not 4.17','Targets equal inputs (no shift) or leakage','Targets are inputs shifted by one position'],
 ['1','Samples are only newlines or one repeated character','Too few steps, LR too low, or sampling bug','Check loss is falling; check softmax over the last dimension'],
 ['1','Validation loss rises after a while','Overfitting a small text','Keep the best checkpoint; add dropout; smaller model'],
 ['2','Rambling, never stops, prints role names','Prompt built by string concatenation, not the chat template','<code>apply_chat_template(..., add_generation_prompt=True)</code>'],
 ['2','Out of memory on a small GPU','FP32 load (≈ 5 GB for 1.24 B params)','Load in BF16; CPU for the baseline if needed'],
 ['3','Tuned model worse than baseline on stage-2 prompts','Overfit to synthetic templates; forgot general skills','Fewer epochs, lower LR, more diverse data, mix general examples'],
 ['3','Great on synthetic test, poor on stage-2 prompts','Synthetic distribution ≠ realistic prompts','Treat stage-2 set as the main gate; diversify generation'],
 ['3','Adapter loads with warnings, outputs unchanged','Wrong target module names for this architecture','Match module names to the model’s layers; check trainable-parameter count']
])}

<h2>8. How do we scale it?</h2>
<p>Not here — deliberately. What would change for real: real (consented, redacted) conversations instead of synthetic ones; a larger base (7–8B) on one or several GPUs; distributed or managed training jobs; automated evaluation in CI; and serving behind a gateway with autoscaling (stages 4–9). The mechanics you ran stay identical; the operational envelope changes.</p>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Stage 3 compute, conservative 6·N·D bound (illustrative dataset)
   5,000 examples × 400 tokens × 2 epochs = 4 M tokens
   6 × 1.236 × 10⁹ × 4 × 10⁶ ≈ 3.0 × 10¹⁶ FLOPs
   on a small GPU delivering an assumed 20 TFLOP/s effective ≈ 1,500 s ≈ 25 min
   on a laptop CPU at an assumed 0.1 TFLOP/s effective      ≈ 83 h → use a GPU or a smaller model
`)}
<p>The cheapest path is: prove the pipeline on the smallest model and a small dataset slice, then scale up once evaluation shows a real gain. Shut down rented GPUs between runs.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Tell me about a model you have trained or fine-tuned.”','<p><i>Answer template (≈60 s — use your real numbers):</i> "In a lab I built a small character-level transformer from scratch in PyTorch — about [0.8] million parameters — to understand attention, the training loop and checkpointing; it started at the expected ln-65 loss of about 4.17 and reached [your validation loss]. Then I took a [1B-class] open-weight instruct model, pinned its revision and licence, and built a [50]-prompt travel-support baseline. I generated [5,000] synthetic tickets, split them by customer to avoid leakage, and trained a LoRA adapter with rank 16 on all linear layers — about [11] million trainable parameters, under one percent. On the held-out set it improved [metric] from [x] to [y] but regressed on [z], which I traced to [cause]. It is a lab result on synthetic data, not production, but it is the same pipeline I would automate with evaluation gates in CI."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"I fine-tuned Llama and it worked well."</p><p>No numbers, no baseline, no data discipline, and an implied production claim.</p></div><div class="good"><h4>Strong answer</h4><p>Concrete sizes and losses, a baseline, a leakage-safe split, a measured comparison including regressions, and an honest scope statement.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Stage 1: from-scratch GPT','Stage 2: pinned open-weight model + baseline','Stage 3: LoRA adapter + eval gate','Stage 4: vLLM serving','Stage 5: Kubernetes'])}
<p>Next: Part 4 opens the GPU — ${L('v1-gpu-architecture','GPU architecture')} explains why your stage-3 run was memory-bound in places, and ${L('v1-inference-anatomy','inference anatomy')} prepares stage 4.</p></div>
`,
  quiz:[
    {q:'Your stage-1 model has a 65-character vocabulary. What should the first logged loss be, roughly?',options:['0.69','4.17','11.76','65'],answer:1,explain:'Uniform guessing gives ln 65 ≈ 4.17. ln 2 = 0.69 is for two classes; 11.76 is ln of Llama 3’s vocabulary.'},
    {q:'In stage 2, which step most directly protects the comparison in stage 3?',options:['Using a bigger GPU','Recording a baseline on fixed prompts with greedy decoding and the correct chat template','Raising temperature','Merging the adapter'],answer:1,explain:'Without a fixed, reproducible baseline you cannot show the adapter helped.'},
    {q:'Why split the synthetic tickets by customer?',options:['To balance languages','So no customer’s details appear in both training and test, preventing leakage','It is faster','LoRA requires it'],answer:1,explain:'A group split prevents memorised customer-specific details from inflating test scores.'},
    {q:'The adapter trains but outputs are identical to the base model and trainable params are 0. Likely cause?',options:['Learning rate too high','target_modules names do not match the model’s layer names','Too many epochs','Wrong tokenizer'],answer:1,explain:'If no modules match, no adapters are attached. Always print the trainable-parameter count.'},
    {q:'Which statement about these stages is honest for a CV or interview?',options:['Production experience fine-tuning LLMs','Lab-built pipeline on synthetic data with measured comparison to a baseline','Trained an LLM from scratch at scale','Deployed Atlas to millions of users'],answer:1,explain:'The capstone validates mechanics in a lab; claims must match that scope.'}
  ],
  flashcards:[
    {front:'Atlas stages 1–3',back:'1: char-level GPT from scratch (CPU). 2: pinned open-weight instruct model + baseline eval. 3: LoRA SFT on synthetic tickets, split by customer, compared with baseline.'},
    {front:'Stage 1 parameter estimate',back:'4 layers × 12d² (d = 128) ≈ 786 K + embeddings ≈ 0.81 M params. Starting loss ln 65 ≈ 4.17.'},
    {front:'What changes architecturally in stage 2',back:'External supply chain (Hub, revision, licence) and the weights + tokenizer + chat template + generation-config contract.'},
    {front:'What changes architecturally in stage 3',back:'Dataset pipeline, training job, adapter artifact tied to a base revision, and an evaluation gate before serving.'},
    {front:'LoRA config used in stage 3',back:'r 16, α 32, dropout 0.05, all linear projections; ≈ 11.3 M trainable (0.91 %) for a Llama-3.2-1B shape; adapter ≈ 22.5 MB.'},
    {front:'Lab-validated vs not',back:'Validated: mechanics on public/synthetic data at lab scale. Not validated: real-customer quality, safety, Arabic on real traffic, serving at scale.'}
  ]
});
registerGlossary([
  {term:'Atlas',def:'The course’s fictional enterprise AI assistant platform for a GCC travel company, built in stages from a tiny model to a multi-region platform.',lesson:'v1-capstone-train'},
  {term:'Baseline evaluation',def:'Scoring an unmodified model on a fixed evaluation set before changing anything, so later changes can be compared fairly.',lesson:'v1-capstone-train',aliases:['baseline']},
  {term:'Character-level model',def:'A language model whose vocabulary is individual characters; simple to build, long sequences, used for teaching.',lesson:'v1-capstone-train'}
]);
