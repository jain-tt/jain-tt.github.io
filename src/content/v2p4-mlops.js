/* Volume 2, Part 4 — MLOps and LLMOps: foundations, model CI/CD, evaluation and monitoring */

/* ------------------------------------------------------------------ */
/* 2.4.1  MLOps foundations                                            */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v2-mlops-foundations', vol:2, part:4, num:1,
  title:'MLOps foundations: data versioning, experiment tracking, feature stores, registries, MLflow', minutes:85,
  summary:'A model is the product of three inputs: the data it saw, the code that trained it, and the base model it started from. MLOps is the discipline of recording all three so any model can be reproduced, compared, approved and rolled back. This lesson covers dataset versioning with DVC, lakeFS and Delta Lake, experiment tracking with MLflow, feature stores such as Feast and when you do not need one, and model registries, where aliases like champion now replace the old staging and production stages.',
  objectives:[
    'Explain why a model version is meaningless without the data snapshot, code commit and base-model revision that produced it.',
    'Choose between DVC, lakeFS and Delta Lake time travel for a given dataset shape and team.',
    'Describe the MLflow tracking server (backend store versus artifact store) and run it in a production-safe way.',
    'Explain point-in-time joins and training-serving skew, and decide when a feature store such as Feast is worth operating.',
    'Use registry aliases (models:/name@champion) instead of deprecated stages, and explain what promotion means operationally.'
  ],
  prereqs:['v1-data-pipelines','v1-training-loop','v1-finetuning'],
  next:['v2-model-cicd','v2-evaluation-monitoring','v2-distributed-training'],
  tags:['mlops','mlflow','data-versioning','feature-store','registry'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','In DevOps, a container image digest tells you exactly what is running, because the image is built from a Dockerfile and a commit. In ML, the "binary" is the model weights, and the "source code" includes the training data. If you version the code but not the data, you have a build you can never reproduce. Now the real mechanism.')}
<p>${term('MLOps')} is the set of practices and systems that make the model lifecycle reproducible, auditable and operable: <b>data → training run → candidate model → evaluation → registry → deployment → monitoring → (sometimes) retraining</b>. It borrows CI/CD, observability and GitOps from DevOps, and adds four things DevOps never needed:</p>
<ol>
<li><b>Data versioning</b> — an immutable identity for the exact dataset a model was trained and evaluated on.</li>
<li><b>Experiment tracking</b> — a record of every training run: parameters, metrics, code commit, data version, produced artifacts.</li>
<li><b>Feature management</b> — the same feature computed the same way for training (historical) and serving (live).</li>
<li><b>A model registry</b> — named, versioned models with mutable pointers (aliases) that deployments resolve, plus approval metadata.</li>
</ol>
<p>LLMOps is the same discipline applied to LLM applications, where the "model" is often an external API or a base model plus adapter, and much of the behaviour lives in prompts, retrieval indexes and tool schemas (${L('v2-model-cicd','next lesson')}). AIOps is a different term entirely — applying analytics to IT operations (${L('v2-aiops','AIOps lesson')}).</p>

<h2>2. Why do we need it?</h2>
<p>Three questions arrive in every serious incident or audit, and without MLOps nobody can answer them:</p>
<ul>
<li><b>"Which model is serving, and what produced it?"</b> A tag like <code>latest</code> or a file called <code>model_final_v2.pt</code> answers nothing.</li>
<li><b>"Can we reproduce last month's model?"</b> Only if the data snapshot still exists and you know which one it was. Data lakes overwrite partitions; CDC tables mutate; a backfill silently changes history.</li>
<li><b>"Why did quality change?"</b> Model, data, code, base model, tokenizer and prompt may all have moved. You need lineage to bisect.</li>
</ul>
${formula(`
Model behaviour  =  f( data snapshot , training code , base model + config )
                       ↑                ↑                ↑
                       DVC / lakeFS /   git commit       registry version /
                       Delta version                      HF revision hash

Reproducibility requires all three identities, recorded together, per run.
`)}
<p>The learner's DevOps instinct is correct but incomplete: pinning container images by digest is necessary, and it covers none of the three inputs above.</p>

<h2>3. How does it work internally?</h2>
<h3>3a. Dataset versioning: three different mechanisms</h3>
<p>All three tools give a dataset an immutable identity, but they work at different layers. Versions below are as of Oct 2026.</p>
${table(['Tool','Mechanism','Unit of versioning','Best fit','Licence / status'],[
 ['<b>DVC</b> (3.67.x)','Git extension. Large files are hashed (content-addressed) and pushed to a remote (S3, GCS…). Git stores a small <code>.dvc</code> pointer file with the hash.','Files / directories referenced from a git commit','Small teams, file-shaped datasets (Parquet, JSONL, images), "Git for Data & Models"','Apache-2.0'],
 ['<b>lakeFS</b> (v1.88.x)','A server in front of object storage that adds Git-like branches, commits and merges over the whole bucket; clients use an S3-compatible gateway, so paths look like <code>s3://repo/branch/path</code>.','A commit of an entire repository (bucket prefix)','Data-lake teams: isolate a backfill on a branch, validate, then merge atomically','BUSL-1.1 (source-available, not OSI open source)'],
 ['<b>Delta Lake</b> (4.4.x)','A table format: Parquet files plus a transaction log. Each write is an ACID commit with a version number; old versions stay readable until vacuumed.','A table version (or timestamp)','Spark/lakehouse tables; reproducible training reads via time travel','Open source (Linux Foundation project)']
])}
${code('bash',`# DVC: version a dataset alongside the training code
dvc init
dvc remote add -d store s3://atlas-ml-data/dvc
dvc add data/support_tickets_2026-10.parquet      # writes data/...parquet.dvc (hash pointer)
git add data/support_tickets_2026-10.parquet.dvc .gitignore
git commit -m "tickets snapshot 2026-10"
dvc push                                          # uploads content-addressed blobs`)}
${code('python',`# Delta Lake: read exactly the table version a model was trained on
df = (spark.read.format("delta")
        .option("versionAsOf", 412)               # recorded in the training run
        .load("s3://atlas-lake/curated/support_tickets"))`)}
${callout('warn','Time travel is not retention','Delta keeps old versions only until a VACUUM removes the files they depend on, and lakeFS commits only help if garbage collection does not delete them. If compliance needs "reproduce any production model for 2 years", set retention and GC policies explicitly — otherwise the version number in your run metadata points at deleted files.')}

<h3>3b. Experiment tracking: the MLflow tracking server</h3>
<p>MLflow (3.17.x as of Oct 2026) has two storage halves, and getting them wrong is the most common production mistake:</p>
<ul>
<li><b>Backend store</b> — "persists various metadata for each Run, such as run ID, start and end times, parameters, metrics". A SQL database (SQLAlchemy URI). The default is a local SQLite file <code>sqlite:///mlflow.db</code>, which is fine on a laptop and wrong on Kubernetes.</li>
<li><b>Artifact store</b> — "persists (typically large) artifacts for each run, such as model weights". Object storage. With <code>--serve-artifacts</code> (default True) the server proxies uploads to <code>--artifacts-destination</code>, so clients never need direct bucket credentials.</li>
</ul>
${code('bash',`mlflow server \\
  --backend-store-uri postgresql://mlflow@pg.ml.internal:5432/mlflow \\
  --artifacts-destination s3://atlas-mlflow-artifacts \\
  --host 0.0.0.0 --port 5000          # defaults are 127.0.0.1 and 5000`)}
<p>A run should log, at minimum: git commit, data version (DVC hash / lakeFS commit / Delta version), base-model revision hash, hyper-parameters, metrics per step, the evaluation report, and the produced artifact with its <b>signature</b> (input/output schema via <code>mlflow.models.infer_signature</code>).</p>
${code('python',`import mlflow
with mlflow.start_run(run_name="lora-r16-tickets-2026-10") as run:
    mlflow.set_tags({"git_commit": GIT_SHA, "data_version": "delta:support_tickets@412",
                     "base_model": "Qwen3-1.7B@<hf-revision-hash>"})
    mlflow.log_params({"lora_r": 16, "lr": 2e-4, "epochs": 3})
    for step, loss in train():
        mlflow.log_metric("train_loss", loss, step=step)
    mlflow.log_metric("eval_pass_rate", 0.905)`)}

<h3>3c. Feature stores and point-in-time correctness</h3>
<p>A ${term('feature store')} solves one specific problem: the same feature must be computed identically for training (from history) and for serving (live, in milliseconds). Feast (v0.67, actively released through Oct 2026) describes the two halves as "an offline store for historical feature extraction used in model training" and "an online store for serving features at low-latency in production".</p>
<p>The hard part is the ${term('point-in-time join')}. When you build a training row for an event at time t, you must join each feature's value <i>as it was at t</i>, never a later value. Otherwise the model trains on information from the future — ${term('data leakage')} — and looks excellent offline, then fails live.</p>
${table(['booking_id','event time (label: cancelled?)','feature: customer_cancellations_90d','value at event time','latest value (wrong to use)'],[
 ['B-101','2026-03-01 10:00','computed daily','1','4 (includes cancellations after 1 March)'],
 ['B-102','2026-06-15 08:30','computed daily','0','2']
])}
<p>Feast's <code>get_historical_features(entity_df, features)</code> performs this "as of" join for each row's timestamp; <code>feast materialize</code> copies the latest values into the online store (e.g. Redis) for <code>get_online_features</code>. ${term('Training-serving skew')} is what you get when the two paths compute the feature differently — e.g. training in Spark SQL with UTC days and serving in Java with local Riyadh days.</p>
${callout('tip','When you do NOT need a feature store','A document-RAG assistant like Atlas has no tabular features to share between training and serving: its "features" are retrieved chunks, and the consistency problem lives in the index and the embedding model version (see '+L('v2-rag-production','production RAG')+'). A feature store pays off when several models reuse many entity-keyed features (customer, route, hotel) online with low latency — e.g. fraud scoring, fare-anomaly detection or personalised ranking. Do not add one because a reference architecture shows it.')}

<h3>3d. The model registry and aliases</h3>
<p>A ${term('model registry')} gives each model a name, numbered immutable versions, and metadata (source run, tags, description, approval). Deployments should never reference a run path; they reference the registry.</p>
<p>In MLflow, the mechanism for "which version is production" changed. <b>Stages</b> (None/Staging/Production/Archived via <code>transition_model_version_stage</code>) are <b>deprecated since MLflow 2.9.0</b> and "will be removed in a future major release" — they still exist in the 3.17 client API, so do not claim they were removed. The replacement is ${term('model alias','aliases')}: "a mutable, named reference to a particular version of a registered model".</p>
${code('python',`from mlflow import MlflowClient
import mlflow

client = MlflowClient()
mv = mlflow.register_model(f"runs:/{run.info.run_id}/model", "atlas-support-lora")   # -> version 8
client.set_registered_model_alias(name="atlas-support-lora", alias="candidate", version=mv.version)

# later, after gates pass (next lesson):
client.set_registered_model_alias(name="atlas-support-lora", alias="champion", version="8")

# serving resolves the alias at load time
model = mlflow.pyfunc.load_model("models:/atlas-support-lora@champion")`)}
<p>Why aliases beat stages: you can have as many as you need (<code>@champion</code>, <code>@challenger</code>, <code>@ksa-prod</code>, <code>@rollback</code>), moving one is a single atomic metadata write, and the URI is explicit. Why aliases are still dangerous: an alias is <i>mutable</i>. A serving pod that loads <code>@champion</code> at start-up will pick up a different model on its next restart. For GitOps, resolve the alias to a concrete version in the pipeline and write the version number (and artifact hash) into the deployment manifest.</p>
${anim('v2-mlops-alias-move')}

<h2>4. Where does it fit?</h2>
${fig('ML lineage: from source event to serving model', svgDiagram({w:900,h:360,
 zones:[{x:10,y:20,w:250,h:320,label:'Data plane (DataOps)'},{x:280,y:20,w:330,h:320,label:'Training plane (MLOps)'},{x:630,y:20,w:260,h:320,label:'Serving plane'}],
 boxes:[
  {id:'src',x:30,y:50,w:210,h:52,label:'Sources',sub:'Kafka / Debezium CDC, S3'},
  {id:'ver',x:30,y:150,w:210,h:52,label:'Versioned datasets',sub:'DVC | lakeFS | Delta',cls:'hl'},
  {id:'fs',x:30,y:250,w:210,h:52,label:'Feature store',sub:'offline + online (Feast)'},
  {id:'run',x:300,y:50,w:290,h:52,label:'Training run',sub:'code commit + data ver + base model'},
  {id:'trk',x:300,y:150,w:140,h:52,label:'Tracking',sub:'MLflow runs'},
  {id:'art',x:450,y:150,w:140,h:52,label:'Artifacts',sub:'S3 weights'},
  {id:'reg',x:300,y:250,w:290,h:52,label:'Model registry',sub:'versions + @aliases',cls:'hl'},
  {id:'cd',x:650,y:150,w:220,h:52,label:'Release pipeline',sub:'gates, GitOps'},
  {id:'svc',x:650,y:250,w:220,h:52,label:'Serving',sub:'vLLM / KServe / API'},
  {id:'mon',x:650,y:50,w:220,h:52,label:'Monitoring',sub:'drift, quality, cost'}
 ],
 arrows:[{from:'src',to:'ver'},{from:'ver',to:'fs'},{from:'ver',to:'run',label:'snapshot id'},{from:'run',to:'trk',fromSide:'bottom',toSide:'top'},{from:'run',to:'art',fromSide:'bottom',toSide:'top'},{from:'trk',to:'reg',fromSide:'bottom',toSide:'top'},{from:'reg',to:'cd',label:'resolve alias'},{from:'cd',to:'svc',fromSide:'bottom',toSide:'top'},{from:'fs',to:'svc',cls:'dash',label:'online features'},{from:'svc',to:'mon',cls:'dash',fromSide:'right',toSide:'right'},{from:'mon',to:'run',cls:'dash',label:'evidence, not auto'}]
}), 'Every arrow carries an identity: snapshot id, run id, model version, image digest. Monitoring feeds evidence back to humans and the training plane; it should not silently trigger retraining (see '+L('v2-evaluation-monitoring','evaluation and monitoring')+').')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Upstream data engineering.</b> CDC (Debezium → Kafka) and Spark jobs produce curated tables (${L('v1-data-pipelines','data pipelines')}). Data contracts (schema, freshness, PII class, owner) are enforced there; MLOps consumes a snapshot id.</li>
<li><b>Training.</b> The training job (${L('v1-training-loop','training loop')}, ${L('v2-distributed-training','distributed training')}) reads a pinned data version and logs to tracking. Checkpoints go to the artifact store.</li>
<li><b>Release.</b> The registry is the hand-off point to ${L('v2-model-cicd','model CI/CD')}: a version with alias <code>@candidate</code> enters the gates; promotion moves <code>@champion</code>.</li>
<li><b>Serving.</b> Serving consumes a concrete version (${L('v1-k8s-serving','model serving on Kubernetes')}), plus online features if any.</li>
<li><b>Governance.</b> Lineage answers audit questions such as "which personal data trained this model?" (${L('v2-governance','governance')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Component','You own','Typical decisions'],[
 ['MLflow tracking server','Deployment (Helm), Postgres backend, S3 artifact bucket, auth in front (it has no strong multi-tenant auth of its own in OSS), backups','HA Postgres; bucket lifecycle rules; SSO via proxy; one server per environment or per business unit'],
 ['Data versioning','DVC remotes and IAM, or the lakeFS server and its metadata DB; Delta VACUUM/retention policies','Retention period = model audit period; who may merge to lakeFS main'],
 ['Feature store','Online store (Redis/DynamoDB) capacity and latency SLO, materialization jobs, registry','Whether to run one at all; freshness SLO per feature view'],
 ['Registry','Who may set which alias (RBAC), webhook/CI integration, artifact immutability','Only the pipeline service account may move @champion'],
 ['Cost','Artifact storage growth (every checkpoint × every run), GPU training quota','Keep final + best checkpoints, expire the rest']
])}
${callout('devops','DevOps bridge','The registry is to models what a container registry plus a Git tag is to services. An alias is like a mutable image tag such as <code>:stable</code> — convenient for humans, dangerous for reproducible deploys. Treat it the way you treat tags in GitOps: resolve to a digest (model version + artifact hash) in the pipeline, commit that to the manifest repo, and let Argo CD deploy the immutable reference.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Cannot reproduce last quarter’s model; metrics differ by several points','Training read a "latest" partition that has since been backfilled','Run has no data_version tag; Delta history shows overwrite after the run','Make data_version a required tag (fail the run without it); read by version'],
 ['Offline AUC excellent, production poor from day one','Leakage via non point-in-time join, or training-serving skew','Compare feature values logged at serving with offline values for the same entity/time','Use point-in-time joins; one feature definition for both paths'],
 ['MLflow UI slow / runs missing after pod restart','SQLite backend on an emptyDir, or tracking pod with local ./mlruns','Server args show default backend URI','Postgres backend, S3 artifacts, PVC-free stateless server'],
 ['Rollback deployed a model that was never evaluated','Someone moved the alias manually; deploy resolved alias at start-up','Registry audit / alias history; pod start times','RBAC on alias changes; manifests pin version, not alias'],
 ['Artifact bucket cost growing fast','Every intermediate checkpoint of every run kept','S3 inventory by prefix','Lifecycle rules: keep registered versions, expire unregistered run artifacts after N days']
])}
<div class="dtree"><ul><li><span class="q">A model’s quality changed — which input moved?</span><ul>
<li><span class="a">diff</span>Compare run tags of the two versions: data_version, git_commit, base_model, params.</li>
<li><span class="a">data moved</span>Diff dataset statistics (row counts, label balance, slice sizes) between versions; check contracts.</li>
<li><span class="a">code moved</span>Bisect commits with a fixed data version on a small eval.</li>
<li><span class="a">nothing moved</span>Then it is the environment: serving config, tokenizer, prompt, retrieval index — the release bundle (${L('v2-model-cicd','next lesson')}).</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Tracking load:</b> metric logging from hundreds of distributed ranks overwhelms a single server — log from rank 0 only, batch metrics, and scale the stateless server horizontally behind a load balancer with one Postgres.</li>
<li><b>Data size:</b> DVC handles files well but every <code>dvc add</code> hashes the data; for TB-scale lakes prefer lakeFS or Delta, which version metadata rather than copying.</li>
<li><b>Organisation:</b> a platform team runs shared tracking/registry; teams get namespaces (experiments, model-name prefixes) and RBAC. This is the self-service pattern of ${L('v2-capstone-platform','the platform capstone')}.</li>
<li><b>Feature serving:</b> online store sized like any cache: keys × value size × replicas, with p99 latency SLOs.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>Content-addressed or metadata-level versioning is what makes "keep every version" affordable. Illustrative numbers:</p>
${formula(`
STEP 1  dataset size                         200 GB
STEP 2  daily change (new + modified rows)     2 % → 4 GB/day
STEP 3  30 daily snapshots as full copies     30 × 200 GB = 6,000 GB
STEP 4  30 snapshots, deduplicated by content
        (DVC hashes / lakeFS / Delta files)   200 + 30 × 4 = 320 GB
                                               ↑ ≈ 19× less storage
ANSWER  Version by content or by table log, never by copying folders.
`)}
<p>The caveat: deduplication works at file granularity. If your job rewrites every Parquet file daily (e.g. a full re-sort), nothing dedupes and you pay for full copies. Partition so that unchanged data stays in unchanged files. The bigger cost lever is usually checkpoints: a 1.7B-parameter model checkpoint with optimizer state is roughly 1.7 × 10⁹ × 16 B ≈ 27 GB (mixed-precision Adam; see ${L('v1-gpu-memory','GPU memory')}); keeping 50 of them per run is 1.35 TB per run.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How would you make a model reproducible and safely promotable?”','<p><i>Answer (≈50 s):</i> "I treat a model as the output of three versioned inputs: a data snapshot, a code commit and a base-model revision. Every training run must log all three plus params, metrics and the artifact signature to a tracking server with a real database and object storage — a run without a data version fails. Datasets are versioned by content: DVC for file-shaped data, lakeFS or Delta time travel for lake tables, with retention matching our audit period. Candidates are registered as numbered versions; promotion is moving an alias like champion, and only the pipeline identity may do that after evaluation gates pass. Deployments pin the resolved version and hash, not the alias, so GitOps stays reproducible and rollback is a revert."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"We store models in S3 with version numbers in the filename and use MLflow Production stage."</p><p>No data lineage, filename conventions are not identity, and stages are deprecated.</p></div><div class="good"><h4>Strong answer</h4><p>Names the three inputs, how each is versioned, aliases with RBAC, and why manifests pin a concrete version.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Data snapshot','Training run','Registered version','Alias','Release bundle','Serving'])}
${chain(['Point-in-time join','No leakage','Honest offline metrics','Trustworthy promotion'])}
<p>Next: ${L('v2-model-cicd','model CI/CD')} turns the registry into gated promotion; ${L('v2-evaluation-monitoring','evaluation and monitoring')} decides what the gates measure. For LLM apps the same lineage idea extends to prompts and indexes (${L('v2-rag-production','production RAG')}).</p></div>

<h3>Lab</h3>
<p>Locally: run <code>mlflow server</code> with a SQLite backend and a local artifacts directory, train the toy model from <code>labs/01-pytorch-basics/tiny_mlp.py</code> twice with different data seeds, log data hashes as tags, register both, and move the <code>@champion</code> alias between them. Then answer: what would a pod that loads <code>@champion</code> at start-up serve after a restart?</p>
`,
  quiz:[
    {q:'Which three identities are needed to reproduce a trained model?',options:['Container image digest, Helm chart version, node type','Data snapshot, training code commit, base-model revision (plus config)','Model filename, S3 bucket, training date','GPU type, CUDA version, driver version'],answer:1,explain:'Behaviour is a function of data, code and starting weights. Runtime versions matter for serving reproducibility but do not define what the model learned.'},
    {q:'What is the status of MLflow model registry stages (Staging/Production) as of MLflow 3.17?',options:['Removed in MLflow 3.0','Deprecated since 2.9.0, still present, slated for removal; use aliases','The recommended way to promote models','Renamed to aliases with identical semantics'],answer:1,explain:'The client API still exposes transition_model_version_stage with a deprecation note since 2.9.0. Saying "removed in 3.x" is wrong; the recommended replacement is set_registered_model_alias.'},
    {q:'Offline accuracy is excellent but the model performs poorly from its first day in production. Which is the most likely data cause?',options:['Too many GPUs','Leakage from a non point-in-time join or training-serving skew','The alias was named champion','DVC was used instead of lakeFS'],answer:1,explain:'Future information in training features inflates offline metrics; different feature computation paths cause skew. Tool choice does not cause this.'},
    {q:'A team builds a document-RAG assistant with no tabular features. Do they need Feast?',options:['Yes, every ML platform needs a feature store','No — the consistency problem lives in the index and embedding version, not shared entity features','Yes, to store embeddings','Only if they use MLflow'],answer:1,explain:'Feature stores solve shared, entity-keyed features for training and low-latency serving. A vector index is a different system with its own versioning needs.'},
    {q:'Why should a GitOps manifest pin a model version rather than models:/name@champion?',options:['Aliases are slower to resolve','An alias is mutable, so a restart could silently load a different model than the one Git says is deployed','MLflow cannot load aliases','Argo CD does not support Python'],answer:1,explain:'The alias is a moving pointer. Resolve it in the pipeline and commit the concrete version and hash so Git is the true record.'}
  ],
  flashcards:[
    {front:'MLflow backend store vs artifact store',back:'Backend: SQL DB for run metadata (params, metrics, tags). Artifact: object storage for large files (weights). Default backend sqlite:///mlflow.db is laptop-only.'},
    {front:'DVC vs lakeFS vs Delta Lake',back:'DVC: git extension, content-hashed files + pointer files. lakeFS: Git-like branches/commits over a whole object-store repo (BUSL-1.1). Delta: table format with transaction log and time travel (versionAsOf).'},
    {front:'Point-in-time join',back:'Join each feature’s value as of the training event’s timestamp, never a later value — prevents leakage.'},
    {front:'Training-serving skew',back:'The same feature computed differently offline and online (logic, timezone, units, freshness), so the live model sees different inputs than it trained on.'},
    {front:'MLflow alias',back:'Mutable named pointer to a model version: models:/atlas-support-lora@champion. Set with MlflowClient.set_registered_model_alias. Replaces deprecated stages.'},
    {front:'When is a feature store worth it?',back:'Many models reuse entity-keyed features that must be identical in training and low-latency serving (fraud, ranking, pricing). Not for plain document RAG.'}
  ]
});
registerGlossary([
  {term:'MLOps',def:'Practices and systems that make the model lifecycle (data, training, evaluation, registry, release, monitoring) reproducible, auditable and operable.',lesson:'v2-mlops-foundations'},
  {term:'Feature store',def:'A system that defines features once and serves them consistently: historical values for training (offline store) and fresh values at low latency for inference (online store). Feast is the main open-source example.',lesson:'v2-mlops-foundations'},
  {term:'Point-in-time join',def:'Joining each training example to feature values as they were at the example’s event time, preventing future information from leaking into training.',lesson:'v2-mlops-foundations',aliases:['as-of join']},
  {term:'Data leakage',def:'Information unavailable at prediction time (future values, labels, test data) entering training, which inflates offline metrics.',lesson:'v2-mlops-foundations'},
  {term:'Training-serving skew',def:'A mismatch between how inputs or features are computed for training and for live inference.',lesson:'v2-mlops-foundations'},
  {term:'Model registry',def:'A catalogue of named models with immutable numbered versions, metadata, lineage and mutable pointers (aliases) used for promotion and deployment.',lesson:'v2-mlops-foundations'},
  {term:'Model alias',def:'In MLflow, a mutable named reference (e.g. @champion) to one version of a registered model; the replacement for deprecated registry stages.',lesson:'v2-mlops-foundations',aliases:['registry alias']},
  {term:'DVC',def:'Data Version Control: a Git extension that stores content hashes of large data files in Git and the files themselves in remote storage.',lesson:'v2-mlops-foundations'},
  {term:'lakeFS',def:'A server adding Git-like branches, commits and merges over object storage, used to version entire data lakes (BUSL-1.1 licence).',lesson:'v2-mlops-foundations'},
  {term:'Delta Lake',def:'An open table format with an ACID transaction log; time travel lets you read an earlier table version for reproducible training.',lesson:'v2-mlops-foundations'}
]);

/* ------------------------------------------------------------------ */
/* 2.4.2  Model CI/CD                                                  */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v2-model-cicd', vol:2, part:4, num:2,
  title:'Model CI/CD, promotion, continuous training, prompt versioning and rollback', minutes:90,
  summary:'Shipping an AI change is not shipping a container. The thing you release is a bundle: model weights, tokenizer, adapter, chat template, prompt version, retrieval index, engine image and the evaluation report that justified it. This lesson builds a release pipeline with gates — offline evaluation by slice, security and signing, shadow traffic, canary analysis — and explains when automatic retraining helps and when it quietly institutionalises a broken data pipeline. Rollback means restoring the whole compatible bundle, from a warm pool.',
  objectives:[
    'List every artifact in an AI release bundle and explain the failure when only one of them is rolled back.',
    'Design a model CI/CD pipeline with explicit gates: offline eval (overall and per slice), security/signing, shadow, canary with automated analysis, promotion.',
    'Decide when continuous training is justified and when it is harmful.',
    'Version prompts as first-class artifacts with the MLflow prompt registry and aliases.',
    'Plan rollback: what to keep warm, how fast it must be, and what it costs.'
  ],
  prereqs:['v2-mlops-foundations','v1-k8s-production'],
  next:['v2-evaluation-monitoring','v2-rag-production','v2-ai-observability'],
  tags:['mlops','llmops','cicd','release','rollback','argo-rollouts'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','An airline does not release a new aircraft by checking that the engines start. It checks the engines, the software, the cabin configuration, and the crew’s procedures together — and it keeps the old aircraft ready until the new one has flown real routes. A model release is the same: many parts, checked together, with the old version kept ready. Now the real mechanism.')}
<p>${term('Model CI/CD')} is the automated path from a change — new data, new code, a new base model, a new prompt, a re-built index — to a model-backed service in production, with <b>gates</b> that must pass before each step. It has three loops:</p>
<ul>
<li><b>CI</b> (continuous integration): code, configuration and prompt changes are tested — unit tests, schema checks, small deterministic evals.</li>
<li><b>CT</b> (${term('continuous training')}): a pipeline that can retrain a candidate model when data or code changes, under policy.</li>
<li><b>CD</b> (continuous delivery): a candidate passes evaluation, security and live-traffic gates and is promoted, with rollback ready.</li>
</ul>
<p>The unit of release is not "the model". It is the ${term('release bundle')}.</p>

<h2>2. Why do we need it?</h2>
<p>Traditional CI/CD answers "does the code do what it did before?" with deterministic tests. Model behaviour is statistical, depends on data you did not write, and changes when <i>any</i> of a dozen artifacts change. Typical incidents this prevents:</p>
<ul>
<li>A fine-tuned model improves average correctness by 2 points but degrades Arabic queries by 9 points. A single global threshold passes it.</li>
<li>Rolling back the engine image while the new tokenizer and chat template stay deployed: the old model receives a prompt format it never saw and answers degrade, while every health check is green.</li>
<li>Someone edits the system prompt in a UI. No model version changed; quality changed.</li>
<li>Nightly automatic retraining on data from a broken CDC feed: the model learns the bug and ships it.</li>
</ul>
<p>A green Argo CD sync proves desired resources exist. It proves nothing about whether answers are correct.</p>

<h2>3. How does it work internally?</h2>
<h3>3a. The release bundle</h3>
<p>Everything that changes behaviour must be versioned and promoted together. An improved version of the old course's release record:</p>
${code('yaml',`release_id: atlas-assistant-2026-10-14-a
model:
  base: Qwen3-1.7B@<immutable-hf-revision>        # values in <> are fill-in fields
  adapter: atlas-support-lora, registry version 8, sha256:<hash>
  tokenizer_revision: <same revision as base>
  chat_template_version: 3
prompt:
  system: prompts:/atlas-support-system/5          # MLflow prompt registry version
retrieval:
  index_snapshot: policy-docs-2026-10-13T02:00Z
  embedding_model: <name>@<revision>
  reranker: <name>@<revision>
  chunker_config: v4
runtime:
  image: registry.example/atlas-vllm@sha256:<digest>
  engine_args: {max_model_len: 8192, kv_cache_dtype: auto}
evaluation:
  golden_set_version: 12
  report_run_id: <mlflow run id>
  judge: <judge model>@<version>, judge_prompt v2
approvals: [ml-lead, security]                     # enforced by the pipeline, not by this YAML`)}
<p>The bundle is stored in Git (the GitOps source of truth), referenced by the deployment, and rolled back as a unit. Its fields also become trace attributes so every production answer can be tied to a release (${L('v2-ai-observability','observability')}).</p>

<h3>3b. Pipeline stages and gates</h3>
${table(['Stage','What runs','Gate (examples)','Blocks on'],[
 ['1. CI','Unit tests, prompt template rendering, schema validation of tool definitions, lint','All tests green; prompt renders for every locale','Any failure'],
 ['2. Train / build (CT)','Training or fine-tune on a pinned data version; or index rebuild','Run logged with data_version, git_commit, base revision; loss curve sane','Missing lineage; divergence'],
 ['3. Register','Candidate version + alias @candidate; bundle file written','Signature present; artifact hash recorded','—'],
 ['4. Offline eval','Golden sets, regression set, safety/red-team set, per-slice metrics, latency/cost benchmark','Overall ≥ baseline − tolerance <b>and</b> every critical slice ≥ its floor; safety 100 % of hard cases; p95 TTFT within SLO','Any critical slice regression'],
 ['5. Security / supply chain','Image scan, model artifact scan (no pickle code execution), licence check, signing','Signatures verify (cosign for images; OpenSSF model-signing for model dirs)','Unsigned or unverifiable artifact'],
 ['6. Shadow','Mirror a privacy-approved share of live traffic; responses discarded','No crash; latency within SLO; judge-score distribution not worse','Errors, latency, judged regressions'],
 ['7. Canary','Small % of real users, automated analysis','Error rate, TTFT p95, negative-feedback rate, judge score vs baseline','Analysis failure → automatic abort'],
 ['8. Promote','Move @champion; update GitOps manifest to the concrete version','Approvals recorded','—']
])}
${anim('v2-mlops-release-pipeline')}

<h3>3c. Slice-level gates, with numbers</h3>
<p>Global averages hide regressions. The decision rule must be per ${term('slice')} (language, tenant, intent, channel), and the slice must be large enough for the difference to be real rather than noise.</p>
${formula(`
Arabic slice: baseline pass rate p₁ = 0.88, candidate p₂ = 0.79, n = 200 cases each

STEP 1  standard error of the difference
                ┌──────────────────────────────┐
        SE  =  √ p₁(1 − p₁)/n  +  p₂(1 − p₂)/n
            =  √ 0.88·0.12/200 + 0.79·0.21/200
            =  √ 0.000528 + 0.0008295
            =  √ 0.0013575  ≈ 0.0368

STEP 2  z = (p₁ − p₂) / SE = 0.09 / 0.0368 ≈ 2.44   > 1.96 → real regression (5 % level)

STEP 3  same rates with only n = 50 per slice
        SE = √ (0.002112 + 0.003318) ≈ 0.0737     z ≈ 1.22 → cannot tell from noise

ANSWER  Block the candidate. And size every critical slice so a 5–10 point
        regression is detectable — 50 cases is not enough.
`)}
<p>Overall pass rate rising from 89 % to 91 % does not rescue this candidate. For a GCC travel product where a large share of traffic is Arabic, the Arabic slice is a hard gate, not a footnote.</p>

<h3>3d. Shadow and canary on Kubernetes</h3>
<p>${term('Shadow deployment')} mirrors requests to the candidate and throws its responses away (or stores them for offline judging). It finds crashes, latency and quality distribution shifts with zero user impact — but costs a full extra serving fleet for the shadow share and must respect privacy rules for stored prompts. It cannot reveal how users react.</p>
<p>A canary sends a small share of real users to the candidate. With Argo Rollouts (v1.10.x as of Oct 2026), canary steps (<code>setWeight</code>, <code>pause</code>, <code>analysis</code>) reference an <code>AnalysisTemplate</code> that queries metrics and aborts automatically:</p>
${code('yaml',`apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata: {name: atlas-llm-canary}
spec:
  args: [{name: rev}]
  metrics:
  - name: ttft-p95
    interval: 2m
    failureLimit: 2
    successCondition: result[0] < 1.5            # seconds; your SLO
    provider:
      prometheus:
        address: http://mimir-query.monitoring:8080/prometheus
        query: |
          histogram_quantile(0.95, sum by (le) (rate(
            vllm:time_to_first_token_seconds_bucket{rollouts_pod_template_hash="{{args.rev}}"}[5m])))
  - name: thumbs-down-rate                       # custom app metric (illustrative name)
    interval: 5m
    failureLimit: 1
    successCondition: result[0] < 0.06
    provider:
      prometheus:
        address: http://mimir-query.monitoring:8080/prometheus
        query: |
          sum(rate(atlas_feedback_negative_total{rev="{{args.rev}}"}[15m]))
          / sum(rate(atlas_feedback_total{rev="{{args.rev}}"}[15m]))`)}
${callout('unverified','Check field names against your Argo Rollouts version','The CRDs (Rollout, AnalysisTemplate, AnalysisRun) and canary steps are verified for v1.10.x; confirm provider fields and label names (e.g. the pod-template-hash label your metrics carry) with your installed version and exporter.')}
<p>How long must a canary run? Enough to collect a meaningful number of outcomes per slice. Illustrative: 40 requests/s total, 10 % canary → 4 req/s → 14,400 requests/hour. If 15 % of traffic is a slice you care about and only 5 % of users leave feedback, that slice gives 14,400 × 0.15 × 0.05 ≈ 108 feedback events per hour — so a 10-minute canary has about 18 and proves almost nothing about that slice. Use online LLM-judge sampling to get denser quality signal (${L('v2-evaluation-monitoring','next lesson')}).</p>

<h3>3e. Prompt versioning</h3>
<p>A prompt is code that changes behaviour, so it gets versions, review, evaluation and aliases. MLflow's prompt registry gives each prompt name immutable versions and mutable aliases, mirroring the model registry:</p>
${code('python',`import mlflow

p = mlflow.genai.register_prompt(
    name="atlas-support-system",
    template="You are Atlas, a travel-support assistant. Reply in the user's language. Question: {{question}}",
    commit_message="Reply in user language (Arabic fix)")

mlflow.genai.set_prompt_alias("atlas-support-system", alias="production", version=p.version)

prompt = mlflow.genai.load_prompt("prompts:/atlas-support-system@production")   # or prompts:/atlas-support-system/5
text = prompt.format(question=user_question)`)}
${callout('unverified','Verify before relying on this','register_prompt, load_prompt and the prompts:/name@alias URI are verified for MLflow 3.17; the exact keyword names of set_prompt_alias and the double-brace template syntax should be checked against your version’s API reference.')}
<p>Rules: the bundle pins a prompt <b>version</b>, not an alias (same reason as models); prompt edits go through the same offline eval gate; and a UI that edits production prompts directly is a change-management bypass.</p>

<h3>3f. Continuous training — and when not to</h3>
<p>Continuous training retrains on a schedule or trigger. It is justified when the world genuinely changes faster than humans can review and labels arrive reliably — e.g. a fare-anomaly model whose routes and seasons change weekly, with ground truth arriving within days. It is harmful when:</p>
<ul>
<li>the trigger is a drift alarm caused by a <b>broken pipeline</b> (the new model learns the bug — see ${L('v2-evaluation-monitoring','drift')});</li>
<li>labels are biased feedback (thumbs-down comes mostly from angry users), so retraining amplifies the bias;</li>
<li>the model is an LLM fine-tune whose failures are mostly prompt/retrieval issues — RAG freshness fixes most "stale knowledge" problems without training (${L('v2-rag-production','production RAG')});</li>
<li>there is no automated gate strong enough to catch regressions, so CT becomes continuous un-reviewed release.</li>
</ul>
<p>Even when CT is used, <b>CT produces candidates; CD decides releases</b>. A retrained model enters stage 4 like any other.</p>

<h3>3g. Rollback</h3>
<p>Rollback means restoring the previous <b>bundle</b> — model, adapter, tokenizer, template, prompt, index snapshot, image — and invalidating anything derived from the bad version (response and semantic caches, ${L('v2-cache-ops','cache operations')}). Speed depends on whether the previous model is warm:</p>
${formula(`
Cold rollback (illustrative, measure your own):
  GPU node provision      3–8 min   (if no free GPU node)
+ weight download         2–6 min   (e.g. 16 GB at 100–250 MB/s effective)
+ engine start, CUDA graphs ~1–2 min
= roughly 6–16 minutes of degraded service

Warm rollback:
  previous ReplicaSet still running (Argo Rollouts keeps it during the canary;
  a "rollback pool" keeps N replicas after promotion)
  → traffic shift in seconds

Cost of a warm pool: N replicas × GPU $/h × hours kept
  e.g. 2 replicas × 1 GPU × $X/h × 24 h = 48 GPU-hours per release
`)}
<p>A common compromise: keep the previous version warm at reduced replica count for 24–72 hours after promotion, then scale it to zero but keep the image and weights cached on nodes (${L('v2-rag-weight-cache','weight caching')}).</p>

<h2>4. Where does it fit?</h2>
${fig('Model CI/CD: three loops, one bundle', svgDiagram({w:900,h:340,
 zones:[{x:10,y:20,w:280,h:300,label:'CI + CT'},{x:310,y:20,w:300,h:300,label:'Gates'},{x:630,y:20,w:260,h:300,label:'CD (GitOps)'}],
 boxes:[
  {id:'chg',x:30,y:50,w:240,h:50,label:'Change',sub:'code | data | prompt | base model'},
  {id:'ci',x:30,y:140,w:240,h:50,label:'CI tests',sub:'units, schemas, render'},
  {id:'ct',x:30,y:230,w:240,h:50,label:'Train / rebuild (CT)',sub:'pinned data version'},
  {id:'reg',x:330,y:50,w:260,h:50,label:'Registry @candidate',sub:'bundle file in Git',cls:'hl'},
  {id:'off',x:330,y:140,w:260,h:50,label:'Offline eval + slices',sub:'golden, safety, perf'},
  {id:'sec',x:330,y:230,w:260,h:50,label:'Scan + sign',sub:'cosign, model-signing'},
  {id:'sh',x:650,y:50,w:220,h:50,label:'Shadow',sub:'mirrored, discarded'},
  {id:'can',x:650,y:140,w:220,h:50,label:'Canary + analysis',sub:'Argo Rollouts',cls:'hl'},
  {id:'pro',x:650,y:230,w:220,h:50,label:'Promote @champion',sub:'previous kept warm',cls:'ok'}
 ],
 arrows:[{from:'chg',to:'ci'},{from:'ci',to:'ct'},{from:'ct',to:'reg',label:'register'},{from:'reg',to:'off'},{from:'off',to:'sec'},{from:'sec',to:'sh',label:'pass'},{from:'sh',to:'can'},{from:'can',to:'pro'},{from:'can',to:'reg',cls:'dash',label:'abort → rollback'}]
}), 'Every gate reads the same bundle. Failure at any gate stops the bundle; nothing is promoted partially.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Registry and tracking</b> (${L('v2-mlops-foundations','foundations')}): source of candidate versions and lineage.</li>
<li><b>Evaluation</b> (${L('v2-evaluation-monitoring','evaluation and monitoring')}): defines golden sets, judges and slice floors used by stages 4, 6 and 7.</li>
<li><b>Kubernetes delivery</b> (${L('v1-k8s-production','production readiness and GitOps')}): Argo CD syncs the manifest; Argo Rollouts runs canary analysis; readiness probes must mean "model loaded and can serve".</li>
<li><b>Gateway</b> (${L('v2-ai-gateway','AI gateway')}): for hosted-model apps the "deployment" is a routing rule change (model A → model B) and is canaried at the gateway.</li>
<li><b>Security</b> (${L('v2-ai-threat-model','threat model')}): signing and scanning are supply-chain controls for artifacts that execute in privileged GPU runtimes.</li>
<li><b>Observability</b>: release id on every trace and metric so analysis can compare revisions.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Area','Ownership'],[
 ['Pipeline platform','Runners with GPU access for eval (often a separate GPU queue via Kueue), secrets for registry/judge APIs, caching of base weights for fast eval jobs'],
 ['Gate definitions as code','Thresholds, slice floors and required approvals in versioned config reviewed like code; no "skip eval" button without an audited override'],
 ['Promotion identity','Only the pipeline service account can move @champion / update the production manifest'],
 ['Progressive delivery','Rollout objects, AnalysisTemplates, metric availability per revision label, abort automation'],
 ['Rollback readiness','Warm-pool policy, previous bundle retained, cache invalidation hooks, rollback drill each quarter'],
 ['Cost','Shadow fleet and eval GPU hours; judge API spend per release']
])}
${callout('devops','DevOps bridge — and where it breaks','This is a normal Jenkins/GitHub Actions + Argo CD + Argo Rollouts pipeline with extra stages. It breaks in two places: (1) tests are statistical, so thresholds need sample sizes and slices, not pass/fail asserts; (2) "the artifact" is a bundle of many independently-versioned things, so a single image digest is not a release identity.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['After rollback, answers still poor','Only the image was rolled back; prompt/template/index/adapter stayed on the new version','Trace attributes show mixed release fields','Roll back the bundle; make the bundle the only deploy unit'],
 ['Canary passed, complaints rose after 100 %','Canary too short or slice too small; metric was latency only','Feedback rate by slice post-promotion','Quality metrics in analysis; minimum sample per slice; longer bake'],
 ['Eval gate flaky: same candidate passes then fails','Judge non-determinism, tiny golden set, temperature > 0','Repeated runs show ± several points','Fix judge temperature and version, repeat runs, larger sets, confidence intervals'],
 ['Rollback took 15 minutes','Previous version scaled to zero; weights re-downloaded; no free GPU node','Pod events, image/weight pull durations','Warm pool for 24–72 h; node-local weight cache'],
 ['Behaviour changed with no release','Prompt edited in a UI or provider silently updated the hosted model alias','Prompt registry history; provider model id in traces','Pin prompt versions and dated provider model ids; alert on change'],
 ['Nightly CT model regressed','Trained on a broken data partition','Data contract check results for that partition','Contract checks gate CT; CT output must pass the full CD gates']
])}
<div class="dtree"><ul><li><span class="q">Quality dropped after a release — roll back?</span><ul>
<li><span class="a">yes, if</span>user harm or SLO breach is ongoing: roll back the whole bundle first, investigate second.</li>
<li><span class="a">then</span>diff the two bundles field by field; re-run the offline eval of both on the same golden set version.</li>
<li><span class="a">eval shows no difference</span>the golden set does not cover the failing traffic → add the failing cases to the set before re-releasing.</li>
<li><span class="a">eval shows the regression</span>the gate threshold or slice floor was wrong → fix the gate config.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Many teams:</b> a shared pipeline template (reusable workflow / Jenkins shared library) where teams supply the bundle, golden sets and thresholds; the platform supplies the gates.</li>
<li><b>Eval throughput:</b> run golden sets against an ephemeral vLLM deployment of the candidate with high concurrency; batch judge calls; cache judge results keyed by (case, output hash, judge version).</li>
<li><b>Many models:</b> registry naming conventions and per-model gate configs; promotion events to a central audit log.</li>
<li><b>Multi-region:</b> promote region by region (e.g. one GCC region first) with the same analysis; data-residency rules decide which traffic may be mirrored where (${L('v2-multi-region','multi-region')}).</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Per-release cost (illustrative inputs — replace with yours)

STEP 1  offline eval   3,000 cases × 2 runs × (gen + judge)
        generation on own GPU: ~0.5 GPU-hour
        judge API: 6,000 calls × 1,500 tokens ≈ 9 M tokens × judge price

STEP 2  shadow         10 % mirror for 24 h on 2 extra GPUs  = 48 GPU-hours
STEP 3  canary         uses production capacity (little extra)
STEP 4  warm rollback  2 GPUs × 48 h                          = 96 GPU-hours

ANSWER  Shadow and warm rollback dominate. Shorten them for low-risk changes
        (prompt typo), keep them for base-model or adapter changes.
`)}
<p>Risk-tier the pipeline: a documentation-only prompt change runs CI + offline eval; an adapter change runs everything; a base-model swap adds human review. Cheap gates first, expensive gates last, so most bad candidates die before they cost GPU hours.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“What does CI/CD look like for an LLM application?”','<p><i>Answer (≈55 s):</i> "The release unit is a bundle — base model and adapter, tokenizer and chat template, prompt version, retrieval index snapshot, engine image digest and the eval report — versioned in Git and promoted together. The pipeline runs normal CI, then registers a candidate, then gates: offline evaluation on versioned golden sets with per-slice floors, for us Arabic versus English and by intent, with enough cases per slice to be statistically meaningful; security scanning and signing; shadow traffic for latency and judged quality; then an Argo Rollouts canary whose analysis checks TTFT, errors and quality signals and aborts automatically. Promotion moves the champion alias and commits the concrete version. The previous bundle stays warm for a day or two so rollback is a traffic shift, and rollback also invalidates caches. Retraining only produces candidates; it never bypasses the gates."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"We build the Docker image, run unit tests and deploy with Argo CD; if something breaks we roll back the image."</p><p>Ignores model behaviour, prompts and indexes; image rollback leaves the rest of the bundle on the bad version.</p></div><div class="good"><h4>Strong answer</h4><p>Bundle identity, statistical slice gates, shadow/canary with automated quality analysis, warm bundle rollback, CT feeding CD rather than replacing it.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Change','Candidate bundle','Offline + slice gates','Shadow','Canary analysis','@champion','Warm rollback'])}
${chain(['Drift alert','Investigation','Fix data or prompt','New candidate','Same gates'])}
<p>Builds on ${L('v1-k8s-production','GitOps and rollback for serving')}. Next: ${L('v2-evaluation-monitoring','what the gates measure')}; for capstone stage 6 the index snapshot joins the bundle (${L('v2-rag-production','production RAG')}).</p></div>
`,
  quiz:[
    {q:'An incident is mitigated by rolling back the vLLM image, but answers stay poor. Most likely reason?',options:['The GPU is faulty','The new prompt/chat template/adapter/index remained deployed — only one part of the bundle was rolled back','Argo CD is out of sync','Rollback always takes 24 hours'],answer:1,explain:'Behaviour depends on the whole bundle. Rolling back one artifact creates a combination nobody tested.'},
    {q:'Candidate: overall pass rate 89 % → 91 %, Arabic slice 88 % → 79 % with 200 cases per slice. What should the gate do?',options:['Pass — overall improved','Block — the Arabic regression is statistically real (z ≈ 2.4) and the slice is critical','Pass with a warning','Retrain automatically'],answer:1,explain:'Slice gates prevent averages hiding regressions. With n=200 the 9-point drop is well beyond noise; with n=50 it would not be distinguishable, which is why slices must be sized.'},
    {q:'What does shadow deployment reveal that canary does not, and vice versa?',options:['Shadow shows user reactions; canary does not','Shadow tests crashes/latency/judged quality with zero user impact; only canary reveals real user behaviour and feedback','They are identical','Canary needs no metrics'],answer:1,explain:'Shadow responses are discarded, so users never see them; only a canary exposes real users and their reactions.'},
    {q:'When is continuous training most likely to be harmful?',options:['When labels arrive quickly and reliably','When the retrain trigger is a drift alarm caused by a broken upstream pipeline','When gates are strong','When the model is small'],answer:1,explain:'Retraining on broken data teaches the model the bug. Investigate drift first; CT outputs must still pass CD gates.'},
    {q:'Why should a release bundle pin prompts:/atlas-support-system/5 rather than @production?',options:['Aliases do not exist for prompts','An alias can move without a release, changing behaviour outside the pipeline and breaking reproducible rollback','Version numbers load faster','MLflow requires it'],answer:1,explain:'Same logic as model aliases: mutable pointers are for humans and pipelines; deployed bundles need immutable references.'}
  ],
  flashcards:[
    {front:'AI release bundle contents',back:'Base model + adapter (hashes), tokenizer, chat template, prompt version, retrieval index snapshot + embedding/reranker versions, engine image digest + engine args, eval report id, judge version, approvals.'},
    {front:'Model CI/CD gate order',back:'CI → train/register → offline eval with slice floors → scan/sign → shadow → canary with automated analysis → promote alias (pin version in Git) → keep previous warm.'},
    {front:'Shadow vs canary',back:'Shadow: mirrored traffic, responses discarded, no user impact, extra fleet cost. Canary: small % of real users, real feedback, automated abort.'},
    {front:'Continuous training rule',back:'CT produces candidates; CD decides releases. Never retrain automatically on an uninvestigated drift alarm.'},
    {front:'Why slice sample size matters',back:'SE of a pass-rate difference ≈ √(p₁(1−p₁)/n + p₂(1−p₂)/n). A 9-point drop is significant at n=200 (z≈2.4) but not at n=50 (z≈1.2).'},
    {front:'Fast rollback requires…',back:'Previous bundle warm (replicas running or weights node-cached), bundle-level revert in Git, and cache invalidation of outputs from the bad release.'}
  ]
});
registerGlossary([
  {term:'Model CI/CD',def:'Automated, gated delivery of model-backed services: CI for code and prompts, continuous training for candidates, and continuous delivery through evaluation, security, shadow and canary gates.',lesson:'v2-model-cicd'},
  {term:'Continuous training',def:'Retraining models automatically on a schedule or trigger; it should produce candidates that still pass release gates, never auto-release.',lesson:'v2-model-cicd',aliases:['CT']},
  {term:'Release bundle',def:'The full set of artifacts that determine an AI service’s behaviour (weights, adapter, tokenizer, chat template, prompt, index, image, configs, eval report), versioned and promoted as one unit.',lesson:'v2-model-cicd',aliases:['AI release bundle']},
  {term:'Shadow deployment',def:'Mirroring live requests to a candidate whose responses are not returned to users, to test stability, latency and quality without user impact.',lesson:'v2-model-cicd',aliases:['shadow traffic']},
  {term:'Slice',def:'A subset of evaluation or production traffic (language, tenant, intent, region) measured separately so averages cannot hide regressions.',lesson:'v2-model-cicd',aliases:['slice-level gate']},
  {term:'Prompt registry',def:'A versioned store for prompt templates with immutable versions and aliases (e.g. MLflow prompts:/name@production).',lesson:'v2-model-cicd'}
]);

/* ------------------------------------------------------------------ */
/* 2.4.3  Evaluation, monitoring and drift                             */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v2-evaluation-monitoring', vol:2, part:4, num:3,
  title:'Evaluation frameworks, online/offline evaluation, monitoring and drift', minutes:95,
  summary:'Evaluation answers whether a model or AI application is good enough to ship; monitoring answers whether it is still good enough in production. Offline evaluation uses versioned golden sets and automatic scorers, including language models acting as judges, which have known biases you must measure. Online evaluation uses shadow traffic, canaries, sampled judging and user feedback. Drift detection compares today’s inputs with a reference using statistics such as the population stability index, the Kolmogorov–Smirnov test and Jensen–Shannon distance. A drift alarm starts an investigation; it should not trigger automatic retraining.',
  objectives:[
    'Design an evaluation strategy that separates offline (golden sets) and online (shadow, canary, sampled judging, feedback) signals.',
    'Use LLM-as-judge safely: know position, verbosity and self-preference bias, and calibrate judges against human labels.',
    'Pick an evaluation framework (MLflow GenAI evaluate, lm-evaluation-harness, RAGAS, DeepEval, promptfoo, Evidently) for a given job.',
    'Compute PSI, the KS statistic and Jensen–Shannon divergence/distance by hand and know Evidently’s default methods and thresholds.',
    'Distinguish data, concept and quality drift, and run a drift investigation instead of an automatic retrain.'
  ],
  prereqs:['v2-model-cicd','v2-mlops-foundations'],
  next:['v2-rag-production','v2-ai-observability','v2-aiops'],
  tags:['evaluation','llm-as-judge','drift','monitoring','mlops'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A driving test checks a learner on a fixed route before they get a licence (offline evaluation). Insurance telematics then watches how they actually drive every day (online monitoring). And if the roads change — a new motorway, different traffic rules — even a good driver may start making mistakes (drift). Now the real mechanism.')}
<p>Three related but different activities:</p>
<ul>
<li><b>Offline evaluation</b> — run a candidate against fixed, versioned datasets (${term('golden set','golden sets')}, regression sets, safety sets) and score outputs with code, reference answers, humans or an ${term('LLM-as-judge')}. Reproducible; used as release gates.</li>
<li><b>Online evaluation</b> — measure quality on live traffic: shadow comparisons, canary analysis, sampled judging of production traces, user feedback, business outcomes (bookings completed, tickets deflected).</li>
<li><b>Monitoring and drift detection</b> — watch inputs, outputs and outcomes continuously and alert when distributions move away from a reference (${term('data drift')}), when the input→output relationship changes (${term('concept drift')}), or when measured quality falls (quality drift).</li>
</ul>

<h2>2. Why do we need it?</h2>
<p>An AI service can be 99.99 % available and still be unfit: confidently wrong, in the wrong language, leaking another tenant's data, or slowly getting worse as the world changes. Availability SLOs do not see any of that. Specific reasons:</p>
<ul>
<li>Outputs are open-ended text; "correct" needs a scorer.</li>
<li>Production traffic differs from the test set and keeps changing — Ramadan and Hajj season queries, new routes, new policies.</li>
<li>Ground truth often arrives late (did the customer cancel? was the refund right?) or never.</li>
<li>Many root causes are outside the model: a CDC schema change, a stale index, an edited prompt. Monitoring must point at the layer, not just say "worse".</li>
</ul>

<h2>3. How does it work internally?</h2>
<h3>3a. Offline evaluation design</h3>
<p>A golden set is a versioned table of cases: input, optional context, expected answer or rubric, tags (slice: language, intent, tenant, difficulty), and owner. Build several, with separate purposes:</p>
${table(['Set','Size (typical starting point)','Scorer','Gate'],[
 ['Happy-path golden set','300–3,000, stratified by slice','Reference match, rubric judge, code checks (JSON valid, cites a source)','Overall and per-slice floors'],
 ['Regression set','Every past incident becomes a case','Exact/rubric','100 % must pass'],
 ['Safety / red-team set','Prompt injection, data exfiltration, forbidden requests','Code + judge + human review','Zero tolerance on hard cases'],
 ['Performance set','Realistic input/output length mix','TTFT, TPOT, cost per request ('+L('v1-benchmarking','benchmarking')+')','Within SLO and budget']
])}
<p>Disaggregate failures: for a RAG answer, separately score retrieval (was the right document in the top k?), grounding (are claims supported by retrieved context?) and the answer itself. One "RAG score" hides where it broke (${L('v2-rag-production','RAG evaluation')}).</p>

<h3>3b. LLM-as-judge: useful, biased, and measurable</h3>
<p>A judge model reads the input, output (and reference or context) and returns a label or score against a rubric. It scales human-like grading, but has documented biases:</p>
${table(['Bias','What happens','Mitigation'],[
 ['Position bias','In pairwise comparisons the judge prefers the answer shown first (or second)','Evaluate both orders; count a win only if consistent; report the consistency rate'],
 ['Verbosity bias','Longer, more detailed answers score higher even when not more correct','Rubrics that reward correctness and concision; length-controlled comparisons'],
 ['Self-preference','A judge favours outputs from its own model family','Use a judge from a different family than the candidate, or several judges'],
 ['Rubric drift','Changing the judge model or judge prompt changes all scores','Version the judge model and prompt in the bundle; never compare scores across judge versions'],
 ['Language skew','Judges can be weaker in Arabic than English','Calibrate per language slice against native-speaker labels']
])}
<p>Calibrate before trusting. Label a sample with humans and measure agreement beyond chance with Cohen's κ:</p>
${formula(`
100 cases, binary pass/fail
            judge pass   judge fail
human pass      65            5        → human pass rate  0.70
human fail      10           20        → judge pass rate  0.75

STEP 1  observed agreement   pₒ = (65 + 20) / 100 = 0.85
STEP 2  chance agreement     pₑ = 0.70·0.75 + 0.30·0.25 = 0.525 + 0.075 = 0.60
                pₒ − pₑ      0.85 − 0.60
STEP 3  κ  =  ────────── = ───────────── = 0.625
                1 − pₑ        1 − 0.60

ANSWER  85 % raw agreement is only κ ≈ 0.63 (moderate–substantial). Note the judge
        is lenient: 10 human-fails it passed. Tighten the rubric, re-measure per slice.
`)}
<h3>3c. Frameworks (as of Oct 2026)</h3>
${table(['Tool','What it is for','Key facts'],[
 ['<b>MLflow GenAI evaluate</b>','Evaluating LLM apps and agents inside the MLflow tracking/registry you already run','<code>mlflow.genai.evaluate(data, scorers, predict_fn)</code>; built-in judge scorers such as <code>Correctness</code>, <code>RelevanceToQuery</code>, <code>Guidelines</code>; RAG scorers <code>RetrievalGroundedness</code>, <code>RetrievalSufficiency</code> (need a trace); custom <code>@scorer</code>; custom judges via <code>mlflow.genai.make_judge</code>. <code>Safety</code> and <code>RetrievalRelevance</code> are Databricks-managed only.'],
 ['<b>lm-evaluation-harness</b> (EleutherAI)','Standard academic benchmarks (multiple-choice, generation tasks) for base/fine-tuned models','Model-level capability, not your application; good for "did fine-tuning damage general ability?"'],
 ['<b>RAGAS</b> (v0.4.x)','RAG metrics','Recommended collections API <code>ragas.metrics.collections</code>: <code>Faithfulness</code>, <code>AnswerRelevancy</code>, <code>ContextPrecision</code>, <code>ContextRecall</code>; legacy <code>ragas.metrics</code> names deprecated in 0.4, removed in 1.0'],
 ['<b>DeepEval</b>','Pytest-style LLM tests in CI','<code>AnswerRelevancyMetric</code>, <code>FaithfulnessMetric</code>, <code>ContextualPrecisionMetric</code>, <code>ContextualRecallMetric</code>, <code>HallucinationMetric</code>, <code>GEval</code>, agent metrics like <code>TaskCompletionMetric</code>, <code>ToolCorrectnessMetric</code>'],
 ['<b>promptfoo</b>','Config-driven prompt × model matrix tests with assertions, often in CI and for red-teaming','Declarative test cases and assertions; compares providers side by side'],
 ['<b>Evidently</b> (0.7.x)','Data/prediction drift and LLM output descriptors','Drift presets (defaults below); LLM judges <code>LLMEval</code>, <code>FaithfulnessLLMEval</code>, <code>CorrectnessLLMEval</code>, <code>PIILLMEval</code> etc. (default judge model gpt-4o-mini)']
])}
${callout('unverified','Verify before relying on this','lm-evaluation-harness and promptfoo were not in the verified research set. The harness CLI is commonly <code>lm_eval</code> with model, model-args and tasks options, and promptfoo uses a YAML config of prompts, providers and assertions — confirm flags and schema with <code>--help</code> and the docs of the version you pin.')}
${code('python',`import mlflow
from mlflow.genai.scorers import Correctness, Guidelines, scorer

@scorer
def cites_policy(outputs) -> bool:          # deterministic code check
    return "[policy:" in str(outputs)

result = mlflow.genai.evaluate(
    data=golden_rows,                       # versioned golden set v12
    predict_fn=atlas_answer,                # the candidate bundle under test
    scorers=[Correctness(),
             Guidelines(name="same_language",
                        guidelines="If the question is in Arabic, the answer must be in Arabic."),
             cites_policy])`)}
<p>The row format (inputs / expectations keys) and the parameter names a custom scorer may declare should be checked against the MLflow 3.17 docs; the entry point and scorer names above are verified.</p>

<h3>3d. Drift: what can change</h3>
${table(['Type','Definition','Travel example','Detectable without labels?'],[
 ['Data (covariate) drift','P(x) changes','Share of Arabic queries rises from 30 % to 60 % in Ramadan; new routes appear','Yes'],
 ['Concept drift','P(y | x) changes','A new refund policy: the same question now has a different correct answer','No — needs labels or judged outcomes'],
 ['Prediction / output drift','Distribution of outputs changes','Refusal rate doubles; average answer length halves','Yes'],
 ['Quality drift','Measured quality falls','Judged groundedness drops from 0.92 to 0.84','Needs scorer or labels'],
 ['Pipeline breakage (looks like drift)','Inputs change because the pipeline broke','A CDC column changes unit from days to hours','Yes — and it is the most common cause']
])}

<h3>3e. The statistics, worked</h3>
<p><b>Population Stability Index</b> (${term('PSI')}) compares binned proportions: expected (reference) eᵢ and actual (current) aᵢ.</p>
${formula(`
           k
  PSI  =   Σ  (aᵢ − eᵢ) · ln(aᵢ / eᵢ)
          i=1

Feature: booking lead time, 4 bins, reference = quartiles of last quarter
         bin:      0–7 d   8–30 d   31–90 d   >90 d
         eᵢ        0.25    0.25     0.25      0.25
         aᵢ        0.10    0.20     0.30      0.40

STEP 1  bin 1   (0.10 − 0.25) · ln(0.40) = (−0.15)(−0.9163) = 0.1374
STEP 2  bin 2   (0.20 − 0.25) · ln(0.80) = (−0.05)(−0.2231) = 0.0112
STEP 3  bin 3   (0.30 − 0.25) · ln(1.20) = ( 0.05)( 0.1823) = 0.0091
STEP 4  bin 4   (0.40 − 0.25) · ln(1.60) = ( 0.15)( 0.4700) = 0.0705
                                                              ──────
ANSWER  PSI ≈ 0.228
        ↑ every term is ≥ 0 (both factors share a sign), so PSI ≥ 0
`)}
<p>A widely used industry <i>convention</i> (not a statistical test) reads PSI &lt; 0.1 as little change, 0.1–0.25 as moderate, &gt; 0.25 as significant. 0.228 is "moderate — look at it". Empty bins make ln blow up; real implementations add a small ε.</p>
${code('python',`import math
def psi(expected, actual, eps=1e-6):
    total = 0.0
    for e, a in zip(expected, actual):
        e, a = max(e, eps), max(a, eps)
        total += (a - e) * math.log(a / e)
    return total

print(round(psi([.25, .25, .25, .25], [.10, .20, .30, .40]), 3))   # 0.228`)}
<p><b>Kolmogorov–Smirnov</b> (${term('KS test')}) compares two empirical cumulative distribution functions of a numeric feature; the statistic is the largest vertical gap.</p>
${formula(`
  D  =  max | F_ref(x) − F_cur(x) |
         x

Prompt length (tokens), CDF read at four points (illustrative):
  x            500    1,000   2,000   4,000
  F_ref(x)     0.40   0.70    0.90    1.00
  F_cur(x)     0.25   0.50    0.80    0.98
  |gap|        0.15   0.20    0.10    0.02     → D ≥ 0.20
                      ↑ the true D is the max over ALL x; reading 4 points gives a lower bound

Large-sample critical value at α = 0.05 (n = m = 500):
                    ┌─────────┐
  D_crit ≈ 1.358 · √ (n + m)/(n·m)  = 1.358 · √ 0.004 ≈ 0.086

ANSWER  0.20 > 0.086 → reject "same distribution" (p ≪ 0.05)
`)}
<p>Caution: with very large samples KS flags tiny, harmless differences as significant. That is why Evidently switches to a distance measure above 1,000 rows.</p>
<p><b>Jensen–Shannon</b> (${term('Jensen–Shannon divergence')}) is a symmetric, bounded version of KL divergence, good for categorical features such as language or intent mix.</p>
${formula(`
  M = ½ (P + Q)
  JS(P ‖ Q) = ½ KL(P ‖ M) + ½ KL(Q ‖ M)        with log base 2 → 0 ≤ JS ≤ 1
  JS distance = √ JS

Language mix: P (reference) = [en 0.70, ar 0.30],  Q (current) = [en 0.40, ar 0.60]
STEP 1  M = [0.55, 0.45]
STEP 2  KL(P‖M) = 0.70·log₂(0.70/0.55) + 0.30·log₂(0.30/0.45)
                = 0.70·0.3479 + 0.30·(−0.5850) = 0.2435 − 0.1755 = 0.0681
STEP 3  KL(Q‖M) = 0.40·log₂(0.40/0.55) + 0.60·log₂(0.60/0.45)
                = 0.40·(−0.4594) + 0.60·0.4150 = −0.1838 + 0.2490 = 0.0652
STEP 4  JS = ½ (0.0681 + 0.0652) ≈ 0.0667
STEP 5  JS distance = √0.0667 ≈ 0.258

ANSWER  Against a 0.1 threshold the divergence (0.067) says "no drift" but the
        distance (0.258) says "drift". Know which one your tool reports.
`)}
<p>SciPy's <code>scipy.spatial.distance.jensenshannon</code> returns the <i>distance</i> (square root); check which quantity your monitoring tool thresholds before copying thresholds between tools.</p>

<h3>3f. Evidently defaults (0.7.x, verified Oct 2026)</h3>
${table(['Column type and size','Default method','Default threshold','Drift when'],[
 ['Numerical, ≤ 1,000 rows','<code>ks</code> (Kolmogorov–Smirnov)','0.05','p-value &lt; 0.05'],
 ['Numerical, &gt; 1,000 rows','<code>wasserstein</code> (normed)','0.1','distance ≥ 0.1'],
 ['Categorical, &gt; 2 labels, ≤ 1,000 rows','<code>chisquare</code>','0.05','p-value &lt; 0.05'],
 ['Binary categorical, ≤ 1,000 rows','<code>z</code> (Z-test)','0.05','p-value &lt; 0.05'],
 ['Categorical, &gt; 1,000 rows','<code>jensenshannon</code>','0.1','distance ≥ 0.1'],
 ['Text','<code>perc_text_content_drift</code> (≤1,000) / <code>abs_text_content_drift</code> (&gt;1,000)','0.95 / 0.55','domain-classifier score above threshold'],
 ['Opt-in','<code>psi</code> is available but <b>not</b> a default','0.1','PSI ≥ 0.1']
])}
<p>Note Evidently's PSI default threshold (0.1) is stricter than the 0.25 "significant" convention. Thresholds are policy; choose them per feature from historical variation (e.g. the 99th percentile of weekly PSI over a stable quarter), not by copying.</p>
<p><b>Embedding drift</b> for LLM inputs: embed a daily sample of queries and compare with the reference via a domain classifier (can a model tell old from new?) or the distance between mean embeddings. It catches "users started asking about something new" — a signal to update RAG content, not necessarily to retrain.</p>
${anim('v2-mlops-drift-investigate')}

<h2>4. Where does it fit?</h2>
${fig('Evaluation and monitoring loop', svgDiagram({w:900,h:350,
 zones:[{x:10,y:20,w:290,h:310,label:'Offline (pre-release)'},{x:320,y:20,w:270,h:310,label:'Online (production)'},{x:610,y:20,w:280,h:310,label:'Decide'}],
 boxes:[
  {id:'gold',x:30,y:50,w:250,h:50,label:'Golden + regression sets',sub:'versioned, sliced'},
  {id:'judge',x:30,y:140,w:250,h:50,label:'Scorers + judges',sub:'calibrated, versioned',cls:'hl'},
  {id:'gate',x:30,y:230,w:250,h:50,label:'Release gates',sub:'per-slice floors'},
  {id:'tr',x:340,y:50,w:230,h:50,label:'Traces + feedback',sub:'release id on every span'},
  {id:'samp',x:340,y:140,w:230,h:50,label:'Sampled online judging',sub:'1–5 % of traffic'},
  {id:'drift',x:340,y:230,w:230,h:50,label:'Drift monitors',sub:'PSI, KS, JS, embeddings',cls:'hl'},
  {id:'tri',x:630,y:140,w:240,h:50,label:'Investigation',sub:'data → retrieval → prompt → model',cls:'warn'},
  {id:'fix',x:630,y:230,w:240,h:50,label:'Fix + new candidate',sub:'through the same gates',cls:'ok'},
  {id:'inc',x:630,y:50,w:240,h:50,label:'Incident / rollback',sub:'if users harmed now'}
 ],
 arrows:[{from:'gold',to:'judge'},{from:'judge',to:'gate'},{from:'gate',to:'tr',label:'release'},{from:'tr',to:'samp'},{from:'samp',to:'drift'},{from:'drift',to:'tri',label:'alert'},{from:'samp',to:'tri',cls:'dash'},{from:'tri',to:'fix'},{from:'tri',to:'inc',cls:'dash'},{from:'fix',to:'gate',cls:'dash',label:'new failing cases join golden set'}]
}), 'Production failures become new golden cases, so offline evaluation keeps up with real traffic.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Release pipeline</b> (${L('v2-model-cicd','model CI/CD')}): offline results are the gates; online signals feed canary analysis.</li>
<li><b>Observability</b> (${L('v2-ai-observability','AI observability')}): traces with GenAI attributes are the raw material for sampled judging; Langfuse, Phoenix, LangSmith and MLflow Tracing all ingest OpenTelemetry-style traces.</li>
<li><b>AIOps</b> (${L('v2-aiops','AIOps')}): drift and quality alerts are correlated with deploys, data-pipeline runs and incidents.</li>
<li><b>Data pipelines</b> (${L('v1-data-pipelines','data pipelines')}): data contracts upstream (Great Expectations 1.24, Soda Core 4.x contracts) catch breakage before it becomes "drift".</li>
<li><b>RAG</b> (${L('v2-rag-fundamentals','RAG fundamentals')}, ${L('v2-rag-production','production RAG')}): retrieval metrics, freshness and ACL tests are part of evaluation.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Area','Ownership','Facts to know (Oct 2026)'],[
 ['Trace/eval platform','Run or buy: Langfuse, Arize Phoenix, LangSmith, MLflow Tracing; retention; PII redaction before storage','Langfuse: MIT core + /ee, self-host via Docker Compose or Helm, acquired by ClickHouse (Jan 2026), OTLP over HTTP only. Phoenix: Elastic License 2.0 (not OSI), free self-host. LangSmith: self-host is an Enterprise add-on on Kubernetes.'],
 ['Drift jobs','Scheduled Evidently (or similar) jobs per model, reference windows, threshold config in Git, alert routing','Defaults per table above; references must be versioned too'],
 ['Online judging','Sampling rate, judge API budget, judge version pinning, privacy approval for sending prompts to a judge','Judge cost scales with sampled traffic × tokens'],
 ['Feedback capture','Event schema for thumbs/corrections tied to trace and release ids','Feedback is biased: angry users click more'],
 ['Label pipelines','Human review queues for calibration and ground truth','Native Arabic reviewers for Arabic slices']
])}
${callout('devops','DevOps bridge','Drift monitors are synthetic checks on distributions instead of endpoints. Treat them like alerts: version the thresholds, route by owner, add runbooks, and measure alert precision. A drift alert that pages someone at 3 a.m. with no runbook is the AI equivalent of a CPU alert on a batch node.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Action'],[
 ['PSI spikes overnight on one feature','Upstream schema/unit change (CDC), null flood, join bug','Data-contract results, schema registry diff, null rate','Fix pipeline, backfill; do <b>not</b> retrain on the broken data'],
 ['Drift on many features at once, gradual','Real population shift (season, new market, campaign)','Calendar (Ramadan, summer), marketing launches, slice mix','Evaluate current model on recent labelled sample; retrain candidate only if quality fell'],
 ['No drift alarms, but complaints rise','Concept drift (policy changed) or quality drift invisible to input stats','Sampled judge scores, feedback by intent, policy change log','Update RAG content or prompt; add cases to golden set'],
 ['Judge scores jump after no release','Judge model or judge prompt changed','Judge version in eval logs','Pin judge versions; re-baseline'],
 ['Drift alerts fire constantly','Thresholds copied, references stale, KS with huge n','Alert history, sample sizes','Per-feature thresholds from historical variation; distance metrics for large n'],
 ['Offline eval great, online bad','Golden set unrepresentative','Compare slice mix of golden set vs production','Re-stratify golden set from production samples']
])}
<div class="dtree"><ul><li><span class="q">Drift alert fired — what now?</span><ul>
<li><span class="a">1. data pipeline</span>Contract checks, schema diff, null/unit/type changes, late partitions. Most alerts end here.</li>
<li><span class="a">2. retrieval / features</span>Index freshness, embedding model version, feature store materialization lag.</li>
<li><span class="a">3. prompt / config</span>Prompt version, provider model id, engine args changed?</li>
<li><span class="a">4. model</span>Only now: is it real population or concept change? Measure quality on fresh labels. If it fell, train a candidate and send it through the gates.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Sample, don't judge everything:</b> 1–5 % of traffic stratified by slice, plus 100 % of flagged traces (negative feedback, errors, refusals).</li>
<li><b>Compute drift on aggregates:</b> hourly histograms per feature in the stream processor (Flink/Spark), PSI on histograms — not raw rows in a notebook.</li>
<li><b>Many models:</b> a drift service with per-model config (features, reference version, method, threshold, owner) in Git.</li>
<li><b>Labels:</b> active sampling — send uncertain or disagreeing (judge vs feedback) cases to humans first.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Online judging budget (illustrative inputs)

STEP 1  traffic                 2,000,000 requests/day
STEP 2  sample rate             2 %          → 40,000 judged/day
STEP 3  tokens per judge call   ~1,800 (question + context + answer + rubric)
STEP 4  judge tokens/day        40,000 × 1,800 = 72,000,000 ≈ 72 M tokens/day
STEP 5  at a judge price of $P per M input tokens → 72·P $/day (+ output tokens)

Levers: smaller calibrated judge for routine scoring, big judge only for disputes;
        cache scores by (case, output hash, judge version); stratify, do not over-sample
        the dominant slice.
`)}
<p>Compare with the cost of not knowing: a silent 9-point regression in the Arabic slice for a week. Evaluation spend is insurance priced per release and per day; size it deliberately and report it in ${L('v2-finops-unit-economics','unit economics')}.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How do you detect model drift, and what do you do when you find it?”','<p><i>Answer (≈55 s):</i> "I monitor three layers against versioned references: inputs, with PSI or Jensen–Shannon for categorical mixes and KS or Wasserstein for numeric features; outputs, like refusal rate and answer length; and quality, through sampled LLM-judge scores calibrated against human labels per language, plus feedback and business outcomes. Thresholds are set per feature from historical variation. When an alert fires I treat it as an investigation, not a retrain trigger: first the data pipeline — schema, units, nulls, because a CDC change is the most common cause — then retrieval and features, then prompt and config, and only then the model. If quality on fresh labels really fell, a retrained candidate goes through the same release gates. Retraining on a broken feed just teaches the model the bug."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"We use Evidently and retrain automatically when drift is detected."</p><p>No distinction between pipeline breakage, population shift and concept drift; automatic retraining can institutionalise errors.</p></div><div class="good"><h4>Strong answer</h4><p>Layers, named statistics with thresholds rationale, calibrated judges, ordered investigation, retrain only through gates.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Golden sets','Calibrated judges','Release gates','Production traces','Sampled judging','Drift + quality alerts','Investigation','New golden cases'])}
${chain(['CDC schema change','Input drift','PSI alert','Pipeline fix','No retrain needed'])}
<p>Next: ${L('v2-rag-production','RAG evaluation with RAGAS metrics')}; ${L('v2-ai-observability','OpenTelemetry GenAI traces')} feed online evaluation; ${L('v2-aiops','AIOps')} correlates drift with deploys and pipeline runs.</p></div>

<h3>Lab</h3>
<p>The anomaly lab (<code>labs/12-aiops/anomaly.py</code>) covers robust z-scores and burn-rate alerting. Extend it with the PSI function above: compute weekly PSI of a synthetic feature over 12 weeks, inject a unit change (days → hours) in week 9, and confirm your threshold catches it while normal seasonal variation does not.</p>
`,
  quiz:[
    {q:'Reference bins e = [0.25,0.25,0.25,0.25], current a = [0.10,0.20,0.30,0.40]. PSI ≈ ?',options:['0.05','0.228','0.60','1.0'],answer:1,explain:'Σ(aᵢ−eᵢ)ln(aᵢ/eᵢ) = 0.1374+0.0112+0.0091+0.0705 ≈ 0.228 — moderate by the common convention, above Evidently’s default PSI threshold of 0.1.'},
    {q:'Evidently’s default drift method for a numerical column with 50,000 rows is…',options:['KS test, p < 0.05','Normed Wasserstein distance, threshold 0.1','PSI, threshold 0.25','Chi-square'],answer:1,explain:'KS is the default only up to 1,000 rows; above that Evidently uses normed Wasserstein (≥ 0.1). PSI is opt-in. KS with huge samples flags trivial differences.'},
    {q:'A judge agrees with humans on 85 % of cases; human pass rate 70 %, judge pass rate 75 %. Cohen’s κ is…',options:['0.85','0.625','0.60','0.25'],answer:1,explain:'pₑ = 0.7·0.75 + 0.3·0.25 = 0.60; κ = (0.85−0.60)/(1−0.60) = 0.625. Raw agreement overstates reliability.'},
    {q:'A new refund policy makes old correct answers wrong, but query distributions are unchanged. This is…',options:['Data drift','Concept drift — detectable only with labels or judged outcomes','Pipeline breakage','Position bias'],answer:1,explain:'P(y|x) changed while P(x) did not, so input-distribution monitors stay silent. Quality monitoring and content updates catch it.'},
    {q:'Overnight, PSI on booking lead time jumps from 0.03 to 0.9. Best first action?',options:['Retrain the model on last night’s data','Check the data pipeline: schema/unit change, nulls, contract results','Increase the alert threshold','Roll back the Kubernetes cluster'],answer:1,explain:'Sudden single-feature jumps are almost always pipeline changes. Retraining would teach the model the bug.'},
    {q:'Which mitigation addresses position bias in pairwise LLM judging?',options:['Use a longer rubric','Evaluate both answer orders and count a win only when consistent','Use temperature 1.0','Use the candidate’s own model as judge'],answer:1,explain:'Swapping order exposes position preference. Using the candidate’s own family as judge adds self-preference bias.'}
  ],
  flashcards:[
    {front:'PSI formula and convention',back:'PSI = Σ (aᵢ − eᵢ)·ln(aᵢ/eᵢ). Convention: < 0.1 small, 0.1–0.25 moderate, > 0.25 significant. Evidently PSI default threshold 0.1 (not a default method).'},
    {front:'KS statistic',back:'D = maxₓ |F_ref(x) − F_cur(x)|. Large-sample critical value at α=0.05 ≈ 1.358·√((n+m)/(nm)). Oversensitive for huge n.'},
    {front:'Jensen–Shannon',back:'JS = ½KL(P‖M) + ½KL(Q‖M), M = ½(P+Q); base 2 → 0..1. Distance = √JS. SciPy’s jensenshannon returns the distance.'},
    {front:'Evidently default drift methods',back:'Num ≤1000: ks p<0.05. Num >1000: normed wasserstein ≥0.1. Cat >2 labels ≤1000: chisquare. Binary ≤1000: z. Cat >1000: jensenshannon ≥0.1. PSI opt-in.'},
    {front:'Data vs concept drift',back:'Data drift: P(x) changes (detectable without labels). Concept drift: P(y|x) changes (needs labels/judged outcomes).'},
    {front:'Three LLM-judge biases',back:'Position (order), verbosity (length), self-preference (own family). Mitigate with order swaps, length-aware rubrics, cross-family judges, κ calibration per slice, pinned judge versions.'},
    {front:'Drift alert investigation order',back:'Data pipeline → retrieval/features → prompt/config → model. Retrain only if quality on fresh labels fell, and only through release gates.'}
  ]
});
registerGlossary([
  {term:'Golden set',def:'A versioned, curated evaluation dataset of inputs with expected answers or rubrics and slice tags, used for reproducible offline evaluation and release gates.',lesson:'v2-evaluation-monitoring',aliases:['golden dataset']},
  {term:'LLM-as-judge',def:'Using a language model with a rubric to score or compare outputs; scalable but subject to position, verbosity and self-preference bias, so it must be calibrated against human labels and version-pinned.',lesson:'v2-evaluation-monitoring',aliases:['LLM judge']},
  {term:'Data drift',def:'A change in the distribution of model inputs P(x) relative to a reference period.',lesson:'v2-evaluation-monitoring',aliases:['covariate drift']},
  {term:'Concept drift',def:'A change in the relationship between inputs and the correct output P(y|x); invisible to input monitoring and detected through labels or judged outcomes.',lesson:'v2-evaluation-monitoring'},
  {term:'PSI',def:'Population Stability Index: Σ (aᵢ − eᵢ)·ln(aᵢ/eᵢ) over bins of a feature, comparing current with reference proportions.',lesson:'v2-evaluation-monitoring',aliases:['population stability index']},
  {term:'KS test',def:'Kolmogorov–Smirnov test: compares two empirical CDFs using the maximum vertical gap D; Evidently’s default for numerical columns up to 1,000 rows.',lesson:'v2-evaluation-monitoring',aliases:['Kolmogorov–Smirnov test']},
  {term:'Jensen–Shannon divergence',def:'Symmetric, bounded divergence between two distributions (0–1 in base 2); its square root is the Jensen–Shannon distance. Evidently’s default for large categorical columns.',lesson:'v2-evaluation-monitoring',aliases:['JS divergence','Jensen–Shannon distance']},
  {term:'Cohen’s kappa',def:'Agreement between two raters corrected for chance: κ = (pₒ − pₑ)/(1 − pₑ). Used to calibrate LLM judges against human labels.',lesson:'v2-evaluation-monitoring',aliases:['kappa']}
]);
