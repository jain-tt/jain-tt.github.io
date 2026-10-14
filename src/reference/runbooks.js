/* Reference library: troubleshooting runbooks.
   Format: symptom → triage questions → evidence → hypotheses → decision tree → mitigation → verification → prevention.
   Metric names: vLLM and DCGM names verified 2026-10-14 (vllm:num_preemptions is NOT on the vLLM metrics page: check live /metrics). */
(function(){
'use strict';
function Q(q,br){return '<ul><li><span class="q">'+q+'</span><ul>'+br.map(b=>'<li><span class="a">'+b[0]+'</span> '+b[1]+'</li>').join('')+'</ul></li></ul>';}
const ul=a=>'<ul>'+a.map(x=>'<li>'+x+'</li>').join('')+'</ul>';
const ol=a=>'<ol>'+a.map(x=>'<li>'+x+'</li>').join('')+'</ol>';
function RB(o){
  return {id:o.id,title:o.title,lesson:o.lesson,html:
    '<p><b>Symptom.</b> '+o.symptom+'</p>'+
    '<h4>1. Triage questions (first 5 minutes)</h4>'+ol(o.triage)+
    '<h4>2. Evidence to collect</h4>'+o.evidence+
    '<h4>3. Hypotheses and what distinguishes them</h4>'+table(['Hypothesis','Evidence that confirms it','Evidence that rules it out'],o.hyp)+
    '<h4>4. Decision tree</h4><div class="dtree">'+o.tree+'</div>'+
    '<h4>5. Mitigation (stop the bleeding first)</h4>'+ol(o.mit)+
    '<h4>6. Verification</h4>'+ul(o.verify)+
    '<h4>7. Prevention</h4>'+ul(o.prevent)};
}
const P95=(m)=>'histogram_quantile(0.95, sum by (le) (rate('+m+'_bucket[5m])))';

registerRunbooks([

RB({id:'rb-high-ttft',title:'High time to first token (TTFT)',lesson:'v1-inference-anatomy',
symptom:'p95 TTFT breaches the SLO (for example > 2 s) while TPOT may look normal. Users see a long blank pause before streaming starts.',
triage:['Is it all models/routes or one? All replicas or one?','Did traffic, prompt length or the release change (new system prompt, bigger RAG context)?','Is the time spent queueing, in prefill, or before the engine (gateway, auth, guardrails, retrieval)?','Did prefix-cache hit rate drop (new prompt template, cache salt, replica reshuffle)?'],
evidence:code('promql',`
# engine-side TTFT and its parts
${P95('vllm:time_to_first_token_seconds')}
${P95('vllm:request_queue_time_seconds')}
${P95('vllm:request_prefill_time_seconds')}
# queue depth vs running
sum(vllm:num_requests_waiting)  ;  sum(vllm:num_requests_running)
# prompt size trend (tokens per request)
sum(rate(vllm:prompt_tokens_total[5m])) / sum(rate(vllm:request_success_total[5m]))
# prefix cache hit ratio
sum(rate(vllm:prefix_cache_hits[5m])) / sum(rate(vllm:prefix_cache_queries[5m]))`)+'<p>Compare client-side TTFT (gateway or OTel gen_ai.server.time_to_first_token) with engine TTFT: the gap is outside the engine.</p>',
hyp:[
['Queueing: arrivals exceed capacity','queue_time p95 high; num_requests_waiting > 0 and growing','queue time ≈ 0'],
['Longer prompts (RAG/system-prompt growth)','prompt tokens per request rose after a release; prefill_time up','tokens per request flat'],
['Prefix-cache misses','hit ratio fell (template change, routing no longer cache-aware)','hit ratio unchanged'],
['Large prefills blocking (chunked prefill off or budget too high)','TTFT spikes correlate with very long prompts arriving','spikes independent of prompt size'],
['Outside the engine (gateway, retrieval, guardrails)','client TTFT ≫ engine TTFT; trace spans show retrieval/guardrail time','client ≈ engine TTFT']],
tree:Q('Is client TTFT much larger than engine TTFT?',[['yes','Look at gateway/retrieval/guardrail spans in traces; fix the slow hop.'],['no',Q('Is vllm:request_queue_time_seconds the main part?',[['yes','Capacity: scale out, shed or lower max tokens; check autoscaler signal (queue depth, not CPU).'],['no',Q('Did prompt tokens per request or cache-miss rate rise?',[['yes','Trim context, restore stable prompt prefix, enable cache-aware routing.'],['no','Profile prefill: chunked-prefill settings, TP size, GPU health (throttling, Xid).']])]])]]),
mit:['Scale out replicas (pre-warmed if possible) or shift traffic to a healthy pool.','Admission control: return 429 early with Retry-After rather than letting queues grow.','Temporarily cap input context (RAG top-k, history truncation) for the affected route.','Roll back the release that changed prompt shape.'],
verify:['p95 TTFT back under SLO for 30+ minutes at comparable traffic.','Queue time near zero; prefix hit ratio back to baseline.'],
prevent:['Alert on queue time and burn rate, not just TTFT.','Load-test every prompt-template change with production token distributions.','Scale on num_requests_waiting / KV usage via KEDA, with headroom for model load time.']}),

RB({id:'rb-high-tpot',title:'High time per output token (slow streaming)',lesson:'v1-batching',
symptom:'Streaming is slow: p95 TPOT or inter-token latency (ITL) above SLO; long answers take far longer.',
triage:['Did concurrency per replica rise (fewer replicas, bigger batches)?','Did average context length grow (long conversations, bigger RAG)?','Are there periodic stalls (ITL spikes) rather than uniformly slow tokens?','Any GPU clock throttling, power capping or Xid errors?'],
evidence:code('promql',`
${P95('vllm:request_time_per_output_token_seconds')}
${P95('vllm:inter_token_latency_seconds')}
avg(vllm:num_requests_running)                   # batch size per replica
avg(vllm:kv_cache_usage_perc)                    # 0..1
avg(DCGM_FI_PROF_DRAM_ACTIVE)                    # memory-bound signature
avg(DCGM_FI_DEV_POWER_USAGE)`)+'<p>Plot TPOT against num_requests_running: a clean upward slope means batch-size pressure; spikes at fixed batch mean stalls.</p>',
hyp:[
['Batch too large (throughput tuned over latency)','TPOT rises with num_requests_running','TPOT flat across batch sizes'],
['Long contexts (more KV read per step)','context length per request grew','context flat'],
['Prefill interference (chunked prefill stealing step time)','ITL spikes when long prompts arrive','spikes uncorrelated with arrivals'],
['Preemption/recompute','KV usage near 1.0; preemption counter rising (check live /metrics)','KV usage < 0.9'],
['Hardware degradation','power/clock drop, Xid in DCGM_FI_DEV_XID_ERRORS, one replica only','all replicas equally slow']],
tree:Q('Is it one replica or all?',[['one','Hardware or noisy neighbour: check DCGM clocks/power/Xid; cordon and drain that node.'],['all',Q('Does TPOT track batch size?',[['yes','Lower --max-num-seqs or add replicas; consider speculative decoding for low batch.'],['no',Q('ITL spikes when long prompts arrive?',[['yes','Tune --max-num-batched-tokens / chunked prefill, or disaggregate prefill.'],['no','Check KV pressure and preemptions (see KV exhaustion runbook).']])]])]]),
mit:['Add replicas or reduce max concurrent sequences per replica.','Route long-context traffic to a separate pool.','Cap max output tokens for non-critical routes.'],
verify:['TPOT p95 under SLO at the same request rate; ITL p99 stable.'],
prevent:['Benchmark the TPOT vs concurrency curve per model/GPU and set max-num-seqs from it.','Separate pools by token shape; alert on ITL p99.']}),

RB({id:'rb-low-util-high-latency',title:'Low GPU utilization but high latency',lesson:'v1-gpu-architecture',
symptom:'Latency is bad, yet GPUs look idle (DCGM_FI_DEV_GPU_UTIL 20–40 %). Someone proposes adding GPUs.',
triage:['Is the bottleneck before the GPU (tokenization, CPU, retrieval, network, gateway)?','Is the queue in the engine or in front of it (gateway concurrency limits, client pools)?','Are requests arriving one at a time (batch size 1)?','Is the metric being read correctly (GPU_UTIL is time-with-a-kernel, not SM efficiency)?'],
evidence:code('promql',`
avg(DCGM_FI_DEV_GPU_UTIL)
avg(DCGM_FI_PROF_PIPE_TENSOR_ACTIVE)
avg(vllm:num_requests_running) ; sum(vllm:num_requests_waiting)
rate(container_cpu_cfs_throttled_periods_total{container="vllm"}[5m])`)+code('bash',`
kubectl top pod -l app=atlas-llm
kubectl exec -it <pod> -- nvidia-smi dmon -s pucm -c 10`),
hyp:[
['Upstream bottleneck (retrieval, guardrail, gateway)','traces show time outside the engine; engine queue empty','engine queue non-empty'],
['CPU throttling of the server process (tokenizer, scheduler, detokenize)','CFS throttling high; CPU limit too low','no throttling'],
['Low concurrency (gateway or client caps at a few in-flight requests)','num_requests_running ≈ 1–4 constantly','running large'],
['Head-of-line blocking in a single-threaded component','one component at 100 % CPU','none'],
['Wrong metric interpretation','tensor-pipe active low but util normal for load','—']],
tree:Q('Is vllm:num_requests_waiting > 0?',[['yes','Engine-side scheduling: check CPU throttling and max-num-seqs; the GPU is starved by the scheduler.'],['no',Q('Is num_requests_running small?',[['yes','Concurrency is capped upstream: raise gateway/client concurrency, check connection pools.'],['no','Latency is outside the GPU: trace retrieval, guardrails, network.']])]]),
mit:['Remove CPU limits (keep requests) on the engine container or raise them.','Raise gateway/client max in-flight requests.','Fix the slow upstream dependency; cache retrieval results.'],
verify:['Batch size rises, latency falls, GPU util rises without more GPUs.'],
prevent:['Dashboard showing GPU util beside batch size, queue, CPU throttling and trace breakdown.','Teach on-call: "GPU utilization" ≠ efficiency.']}),

RB({id:'rb-cuda-oom',title:'CUDA out of memory (OOM)',lesson:'v1-gpu-memory',
symptom:'"torch.OutOfMemoryError: CUDA out of memory" at start-up, at the first large request, or after hours of running.',
triage:['At start-up, at first big request, or after a long time (leak/fragmentation)?','Inference engine or training job?','Did model, max context, batch, dtype or engine version change?','Is another process on the same GPU (time-slicing, a stuck pod)?'],
evidence:code('bash',`
kubectl logs <pod> --previous | grep -i -E "out of memory|KV cache|max_model_len"
kubectl exec -it <pod> -- nvidia-smi --query-gpu=memory.used,memory.total --format=csv
kubectl exec -it <pod> -- nvidia-smi --query-compute-apps=pid,used_memory --format=csv`)+'<p>For PyTorch training also log torch.cuda.memory_allocated(), memory_reserved() and torch.cuda.memory_summary() around the failing step.</p>',
hyp:[
['Engine budget too high for this GPU (another process or larger overhead)','fails at start-up; nvidia-smi shows other processes','GPU otherwise empty'],
['max-model-len too large for KV budget','log says KV cache cannot hold max_model_len tokens','start-up succeeds'],
['Training activations (batch/sequence too large)','fails in forward/backward of first steps','fails later'],
['Fragmentation / leak','reserved ≫ allocated; memory grows over steps','memory flat'],
['Sharing without isolation (time-slicing)','several pods on one GPU','dedicated GPU']],
tree:Q('Does it fail at start-up?',[['yes',Q('Are other processes on the GPU?',[['yes','Remove the stray process/pod; use MIG or whole GPUs for isolation.'],['no','Lower --gpu-memory-utilization or --max-model-len, use FP8 weights/KV, or add TP.']])],['no',Q('Training job?',[['yes','Reduce micro-batch, enable gradient checkpointing, ZeRO/FSDP sharding, check for retained graphs.'],['no','Inference after start-up rarely OOMs (KV is pre-allocated): suspect CUDA graphs, LoRA loads, multimodal inputs; check engine logs.']])]]),
mit:['Restart with reduced memory settings (context cap, utilization fraction).','Move to a larger-memory GPU class or higher TP.','For training: halve micro-batch and double gradient accumulation (same global batch).'],
verify:['Pod stable for a soak test at peak concurrency; memory flat over time.'],
prevent:['Pre-compute memory with labs/04-gpu/gpu_memory.py for every model change.','Pin engine versions; read release notes for default changes (e.g. gpu-memory-utilization 0.92).']}),

RB({id:'rb-kv-exhaustion',title:'KV-cache exhaustion and preemptions',lesson:'v1-kv-cache',
symptom:'Latency spikes and throughput drops under load without errors; KV usage pinned near 100 %; requests get preempted and recomputed.',
triage:['Did average context length or concurrency rise?','Is max-num-seqs higher than the KV budget can hold?','Is prefix caching still effective?','Are some requests extremely long (outliers)?'],
evidence:code('promql',`
max(vllm:kv_cache_usage_perc)                       # near 1.0 = pressure
sum(vllm:num_requests_waiting)
rate(vllm:num_preemptions_total[5m])                # name UNVERIFIED: check the live /metrics output
sum(rate(vllm:prompt_tokens_total[5m])) + sum(rate(vllm:generation_tokens_total[5m]))`),
hyp:[
['Context growth','tokens per request rising','flat'],
['Over-admission (max-num-seqs too high)','preemptions with many running sequences','few running'],
['Long-tail outliers','a few requests with huge contexts','uniform lengths'],
['Lost prefix sharing','hit ratio fell','unchanged']],
tree:Q('Is kv_cache_usage_perc ≥ 0.95 during the incident?',[['yes',Q('Did tokens per request grow?',[['yes','Cap context per route, summarise history, move long-context traffic to a bigger-HBM pool.'],['no','Lower max-num-seqs, add replicas, or use FP8 KV cache.']])],['no','Not KV: go to the high TPOT or TTFT runbook.']]),
mit:['Add replicas; route long-context requests elsewhere.','Set per-route max input/output tokens.','Enable FP8 KV cache (--kv-cache-dtype fp8) after a quality check.'],
verify:['KV usage under ~90 % at peak; preemption rate ~0; TPOT stable.'],
prevent:['Capacity model per route using the KV concurrency formula.','Alert on sustained KV usage > 0.9 and on preemptions.']}),

RB({id:'rb-pending-gpu',title:'Pod stuck Pending waiting for a GPU',lesson:'v1-k8s-gpu-stack',
symptom:'Inference/training pods stay Pending; events show "Insufficient nvidia.com/gpu" or no nodes match.',
triage:['Do GPU nodes exist and advertise nvidia.com/gpu allocatable?','Do the pod nodeSelector/affinity/tolerations match the GPU node labels and taints?','Is the autoscaler (Karpenter/cluster autoscaler) trying, and failing on capacity?','Is a quota (ResourceQuota, Kueue ClusterQueue) blocking admission?'],
evidence:code('bash',`
kubectl describe pod <pod> | sed -n '/Events/,$p'
kubectl get nodes -L nvidia.com/gpu.product -L karpenter.sh/nodepool
kubectl describe node <gpu-node> | grep -A5 -E "Allocatable|Taints"
kubectl get pods -n gpu-operator
kubectl get nodeclaims ; kubectl get events -A --field-selector reason=FailedScheduling
kubectl get workloads -A        # if Kueue is used`),
hyp:[
['No capacity in the zone/instance type','NodeClaim errors: insufficient capacity','nodes launch'],
['Device plugin not running / driver broken','node has 0 allocatable nvidia.com/gpu; gpu-operator pods failing','allocatable > 0'],
['Scheduling constraints mismatch','missing toleration or wrong label in events','events show only Insufficient GPU'],
['GPUs held by other pods (fragmentation)','sum of requested = allocatable on every node','free GPUs exist'],
['Queue/quota','Kueue workload not admitted; ResourceQuota exceeded','no queueing']],
tree:Q('Does any node show allocatable nvidia.com/gpu > 0?',[['no',Q('Do GPU nodes exist?',[['no','Autoscaler/capacity: check NodeClaim events, try other zones/instance families, use capacity reservations.'],['yes','Driver/device plugin issue: check GPU Operator validator and plugin pods.']])],['yes',Q('Do events show taint/affinity mismatch?',[['yes','Fix tolerations/nodeSelector.'],['no','GPUs are occupied or quota blocks: check Kueue admission, preempt lower priority work.']])]]),
mit:['Fall back to another instance family/zone in the NodePool.','Preempt lower-priority batch jobs (PriorityClass/Kueue).','Restart failed device plugin/driver pods on affected nodes.'],
verify:['Pod scheduled and Ready; nvidia-smi works inside it.'],
prevent:['Reserved capacity for SLO-bound inference; spot/flex only for batch.','Alerts on Pending GPU pods older than N minutes.']}),

RB({id:'rb-xid',title:'GPU Xid errors',lesson:'v1-multi-gpu-profiling',
symptom:'DCGM_FI_DEV_XID_ERRORS shows a non-zero code; pods crash with CUDA errors; node logs show "NVRM: Xid".',
triage:['Which Xid code? (it is a gauge of the LAST code, not a count)','One GPU, one node, or many?','Did it coincide with a driver/firmware/app change?','Is the application the cause (13, 31 often app bugs) or hardware (48, 79, 95)?'],
evidence:code('bash',`
kubectl debug node/<node> -it --image=ubuntu -- chroot /host dmesg -T | grep -i xid
kubectl exec -it <dcgm-exporter-pod> -- nvidia-smi -q -d ECC,PAGE_RETIREMENT,ROW_REMAPPER`)+table(['Xid','Meaning (NVIDIA catalog)','Typical action'],[['13','Graphics engine exception (often app bug)','Restart app; investigate code'],['31','GPU memory page fault (illegal address, usually app)','Restart app; check kernels/versions'],['48','Double-bit ECC error','Reset GPU or reboot node'],['63 / 64','Memory row remap event / remap failure','63 ignore; 64 reset GPU, contact support'],['74','NVLink error','Follow NVLink workflow; contact support'],['79','GPU has fallen off the bus','Reboot node; contact support'],['94 / 95','Contained / uncontained memory error','94 restart app; 95 reset GPU']]),
hyp:[['Application fault','13/31 on one workload, follows the workload to other nodes','follows the node'],['Hardware fault','48/64/79/95 recurring on the same GPU','random across fleet'],['Driver/firmware regression','fleet-wide after an upgrade','no recent change']],
tree:Q('Is the code 48, 64, 74, 79 or 95?',[['yes','Hardware path: cordon + drain the node, reset/reboot, open a vendor/cloud ticket if it recurs.'],['no',Q('Does it follow the workload across nodes?',[['yes','Application/driver compatibility: roll back the app or engine version.'],['no','Watch the node; repeat offences → treat as hardware.']])]]),
mit:['Cordon and drain the node; let the scheduler place pods elsewhere.','For cloud instances, stop/start to move to new hardware.'],
verify:['No new Xid on the replacement; workload healthy for a soak period.'],
prevent:['Alert on DCGM_FI_DEV_XID_ERRORS changes per GPU; automate cordon for hardware Xids.','Run DCGM diagnostics during node bootstrap.']}),

RB({id:'rb-nccl-timeout',title:'NCCL timeout / hung distributed job',lesson:'v2-distributed-training',
symptom:'Training or multi-GPU inference hangs, then fails with a NCCL watchdog timeout or collective error.',
triage:['Did all ranks start? Is one rank dead or slow?','Is the failure at initialisation (network/topology) or mid-run (straggler, hardware)?','Did the network (EFA/IB), driver or container change?','Are all ranks executing the same collectives in the same order (code divergence)?'],
evidence:code('bash',`
# re-run with NCCL logging
NCCL_DEBUG=INFO NCCL_DEBUG_SUBSYS=INIT,NET torchrun ...
kubectl logs <rank-pod> | grep -i -E "nccl|timeout|watchdog"
kubectl get pods -o wide -l job=<job>          # node placement, restarts
# baseline the fabric
all_reduce_perf -b 8 -e 1G -f 2 -g 8           # nccl-tests`),
hyp:[['Dead/slow rank (OOM, Xid, preempted node)','one rank exited or restarted','all ranks alive'],['Network misconfiguration (wrong interface, EFA/IB not used)','INIT logs show socket transport, low busbw','correct transport, normal busbw'],['Code divergence (rank-dependent branch skips a collective)','hang at the same step every time, all ranks alive','random step'],['Fabric degradation','nccl-tests busbw well below baseline on some nodes','baseline normal']],
tree:Q('Did any rank die or restart?',[['yes','Fix that rank (OOM/Xid/preemption), then resume from checkpoint.'],['no',Q('Does nccl-tests reach expected bus bandwidth?',[['no','Network: interface selection, EFA/IB device plugin, security groups, placement.'],['yes','Code: check for rank-dependent control flow and mismatched collectives.']])]]),
mit:['Restart from the last checkpoint on healthy nodes (exclude the bad node).','Use elastic/fault-tolerant launch so one failure does not waste the whole job.'],
verify:['Steps progress at baseline speed; busbw matches baseline.'],
prevent:['Checkpoint frequently (cost of lost work vs checkpoint overhead).','Gang scheduling and topology-aware placement (Kueue TAS).','Pre-flight nccl-tests on new nodes.']}),

RB({id:'rb-model-load',title:'Model load failure / slow cold start',lesson:'v1-k8s-serving',
symptom:'New replicas CrashLoopBackOff or stay unready for many minutes; scale-up does not help in time.',
triage:['Does the download fail (auth, path) or just take long?','Is the readiness/startup probe killing the pod before load finishes?','Version mismatch between engine and model architecture?','Is trust_remote_code or a revision change involved?'],
evidence:code('bash',`
kubectl describe pod <pod> | grep -E "Liveness|Readiness|Startup|Killing|Back-off"
kubectl logs <pod> -c vllm | grep -i -E "error|loading|safetensors|architecture"
kubectl get events --field-selector involvedObject.name=<pod>`),
hyp:[['Probe too aggressive','"Killing … failed liveness probe" during load','no probe kills'],['Download bottleneck','long time between start and "loading weights"; shared NAT','fast download'],['Credentials','401/403 from hub or object store','no auth errors'],['Unsupported architecture/version','error naming the architecture or config key','loads then fails later'],['Insufficient memory','OOM at load','—']],
tree:Q('Is the pod killed by a probe?',[['yes','Add a startupProbe with a long failureThreshold; keep liveness simple.'],['no',Q('Is it failing or just slow?',[['failing','Read the log error: credentials, architecture support, memory.'],['slow','Pre-stage weights: node-local cache, OCI image volume, in-cluster mirror; parallel downloads.']])]]),
mit:['Roll back to the previous model/engine version.','Temporarily raise startup probe thresholds.','Point to an in-region mirror of the weights.'],
verify:['Time from pod start to Ready measured and within budget.'],
prevent:['Pin model revision (commit hash) and engine version together; test in staging.','Use safetensors only; never pickle from untrusted sources.']}),

RB({id:'rb-quality-regression',title:'Quality regression after a release',lesson:'v2-model-cicd',
symptom:'After a model, prompt, retrieval or engine change, users report worse answers; thumbs-down rate or escalations rise; no errors or latency change.',
triage:['What changed: model weights, quantization, prompt version, retrieval index, engine version, sampling parameters?','Which routes/languages/tenants are affected (e.g. Arabic only)?','Do offline eval scores for the new version differ from the old?','Is the regression real or a traffic-mix change?'],
evidence:ul(['Online signals by version label: user feedback rate, escalation rate, answer length, refusal rate, judge scores on a sample.','Offline: rerun the golden dataset on old vs new with the same judge version.','Traces of bad examples: retrieved context, prompt version, model, parameters.'])+code('promql',`
sum by (model_version) (rate(atlas_feedback_negative_total[1h])) / sum by (model_version) (rate(atlas_feedback_total[1h]))`)+'<p>(atlas_* are application metrics you define; they are not provided by any engine.)</p>',
hyp:[['Model/quantization change','regression on the golden set with identical prompts','golden set unchanged'],['Prompt change','diff in prompt version; failures cluster on new instructions','prompt unchanged'],['Retrieval change (index, chunking, embedding model)','context recall drops; wrong chunks in traces','retrieval metrics unchanged'],['Engine default change (sampling, chat template)','same weights, different outputs after engine upgrade','engine unchanged'],['Traffic mix','new topic/language share rises','mix stable']],
tree:Q('Does the offline golden set reproduce the regression?',[['yes','Bisect the change set (model, prompt, retrieval, engine) one at a time; roll back the culprit.'],['no','Online-only: check traffic mix and drift (PSI on topics/languages); extend the golden set with new failure cases.']]),
mit:['Roll back the last release (model alias / prompt alias / index alias) — keep releases alias-based so rollback is a pointer change.','Shift traffic back to the old version via the gateway (canary weights).'],
verify:['Feedback and judge scores return to baseline; golden-set score equals pre-release.'],
prevent:['Release gates: offline eval thresholds per slice (language, route), canary with online metrics, automatic rollback.','Version everything together (model, prompt, index, engine) in one release manifest.']}),

RB({id:'rb-rag-stale',title:'RAG returns wrong or stale answers',lesson:'v2-rag-production',
symptom:'The assistant cites an outdated policy, misses a new document, or answers confidently from the wrong source.',
triage:['Is the correct document in the index at all? Since when?','Is it retrieved (in top-k) but ignored, or not retrieved?','Is an ACL filter or tenant filter excluding it?','Is a response/semantic cache serving an old answer?'],
evidence:ul(['Search the index directly for the document ID and its updated_at.','Trace for the failing query: retrieved chunk IDs, scores, filters applied, prompt.','Ingestion pipeline lag: last successful run, failed documents.','Cache hit flag for the response.']),
hyp:[['Ingestion lag/failure','document missing or old version in index','current version indexed'],['Retrieval miss (chunking, embedding, lexical terms)','document indexed but not in top-k; BM25 finds it','in top-k'],['Generation ignores context','correct chunk in prompt, wrong answer','chunk absent'],['Stale cache','cache hit served','cache miss'],['ACL over-filtering','document filtered by permissions','no filter']],
tree:Q('Is the current document version in the index?',[['no','Fix ingestion: rerun, alert on lag, handle deletes/updates (tombstones).'],['yes',Q('Is it in the retrieved top-k?',[['no','Improve retrieval: hybrid search, reranker, chunking, query rewrite.'],['yes',Q('Was the answer a cache hit?',[['yes','Invalidate by document version; include index version in cache keys.'],['no','Prompting/grounding: require citations, lower temperature, add a groundedness check.']])]])]]),
mit:['Purge cache entries tied to the changed documents.','Re-ingest affected sources; pin the critical policy as a high-priority source.'],
verify:['Failing query now cites the current version; regression test added to the RAG eval set.'],
prevent:['Freshness SLO (max ingestion lag) with alerts.','Cache keys include document/index version and tenant/ACL scope.']}),

RB({id:'rb-cache-leak',title:'Cache leak: one user sees another user’s data',lesson:'v2-cache-ops',
symptom:'A user receives an answer containing another customer’s booking details or another tenant’s content. Treat as a security incident.',
triage:['Which cache served it (response, semantic, prompt/prefix, retrieval)?','Does the cache key include tenant, user/ACL scope and data version?','How many responses could be affected and since when?','Is personal data involved (PDPL/GDPR notification duties)?'],
evidence:ul(['Trace of the leaked response: cache hit flag, cache key, tenant ID of writer vs reader.','Cache key schema and recent code changes.','Access logs to scope exposure.']),
hyp:[['Semantic cache keyed only on prompt embedding','similar questions from different tenants hit the same entry','key includes tenant'],['Response cache key missing user scope','personalised answers cached globally','personal answers never cached'],['Retrieval cache ignoring ACL','cached retrieval results reused across users','retrieval not cached']],
tree:Q('Was the leaked response a cache hit?',[['yes','Disable that cache now, purge it, fix the key to include tenant + ACL scope + version.'],['no','Not a cache: check retrieval ACL filters and prompt assembly (wrong context injected).']]),
mit:['Disable the cache layer (fail closed), purge all entries.','Start the security incident process; scope affected users; legal/privacy notification assessment.'],
verify:['Cross-tenant test suite passes; no cross-tenant hits in logs after re-enable.'],
prevent:['Never cache personalised responses in shared caches; namespace keys by tenant.','Automated cross-tenant leak tests in CI.']}),

RB({id:'rb-cost-spike',title:'Cost spike',lesson:'v2-finops-unit-economics',
symptom:'Daily AI spend jumps (provider bill, token usage or GPU hours) without a matching rise in users.',
triage:['Tokens up or price up? Input or output tokens?','Which tenant, route, model or agent?','Did cache hit rate drop or retries/agent loops rise?','Did someone route traffic to a more expensive model or raise max tokens?'],
evidence:code('promql',`
sum by (tenant, model) (rate(gen_ai_client_inference_usage_input_tokens_total[1h]))   # new OTel counter, exporter-dependent name
sum by (route) (rate(atlas_model_calls_total[1h])) / sum by (route) (rate(atlas_user_requests_total[1h]))   # calls per request
sum(rate(vllm:prefix_cache_hits[1h])) / sum(rate(vllm:prefix_cache_queries[1h]))`)+'<p>Exported Prometheus names for OTel metrics depend on the exporter; older instrumentations still emit gen_ai.client.token.usage.</p>',
hyp:[['Agent loop or retry storm','calls per user request rising','flat'],['Routing change to bigger model','model share shifted','unchanged'],['Cache regression','hit rate fell','unchanged'],['Abuse / runaway client','one key/tenant dominates','spread evenly'],['GPU idle spend','GPU hours up, tokens flat (scaled up, never down)','utilization normal']],
tree:Q('Did tokens per user request rise?',[['yes',Q('Did model calls per request rise?',[['yes','Agent loop/retries: see agent runaway runbook; add step and budget caps.'],['no','Prompt/context growth or cache loss: check prompt version and hit rates.']])],['no',Q('Did tokens per tenant shift sharply?',[['yes','Abuse or a new integration: apply per-tenant quotas.'],['no','Price/routing/GPU idle: check model mix and autoscaler scale-down.']])]]),
mit:['Per-tenant token quotas at the gateway; budget alerts with hard caps.','Roll back routing/prompt changes.'],
verify:['Cost per successful request back to baseline.'],
prevent:['Showback/chargeback per tenant; anomaly detection on spend per route.','max_tokens and max agent steps on every route.']}),

RB({id:'rb-mcp-connection',title:'MCP connection failure',lesson:'v2-mcp-deploy',
symptom:'The client (Claude Desktop/Code, VS Code, Cursor, an agent) cannot connect to an MCP server, lists no tools, or errors on every call.',
triage:['stdio or remote (Streamable HTTP)?','Which spec era do client and server speak (2025-11-25 handshake vs 2026-07-28 stateless)?','Does MCP Inspector connect to the same server?','For remote: DNS/TLS/proxy/CORS, path (/mcp) correct?'],
evidence:code('bash',`
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/list
npx @modelcontextprotocol/inspector --server-url https://mcp.example.com/mcp --transport http
curl -si https://mcp.example.com/mcp -X POST -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d "{}"
tail -f ~/Library/Logs/Claude/mcp*.log`)+'<p>stdio servers must write ONLY protocol messages to stdout; log to stderr.</p>',
hyp:[['stdio server prints logs to stdout','JSON parse errors in client log','clean stdout'],['Wrong command/path/env in config','spawn errors (ENOENT), missing env vars','server starts'],['Version/era mismatch','client sends initialize to a server rejecting legacy (or vice versa)','both in same era or server serves both'],['Network/TLS/proxy/CORS','curl fails; browser clients blocked by CORS (Mcp-* headers)','curl works'],['Auth','401 responses (see auth runbook)','no 401']],
tree:Q('Does MCP Inspector work against the server?',[['no',Q('stdio?',[['yes','Run the command by hand; check stdout pollution, interpreter path, env.'],['no','Network/TLS/path/CORS; then auth.']])],['yes','Client config issue: format (mcpServers vs servers), transport type, scope; check the client logs and protocol era.']]),
mit:['Pin a known-good server version; restart the client after config edits.','Serve both eras (Python SDK and TS v2 createMcpHandler can).'],
verify:['tools/list returns the expected tools from the real client.'],
prevent:['Contract tests with Inspector CLI in CI; health endpoint; publish config snippets per client.']}),

RB({id:'rb-mcp-auth-loop',title:'MCP auth 401/403 loop',lesson:'v2-mcp-auth',
symptom:'The client keeps re-opening the browser login, or every call returns 401/403 after a successful login.',
triage:['401 (no/invalid token) or 403 (insufficient scope)?','Does the 401 include WWW-Authenticate with resource_metadata?','Is the token audience equal to the canonical MCP server URI (RFC 8707 resource)?','Clock skew, issuer mismatch, or refresh failure?'],
evidence:code('bash',`
curl -si https://mcp.example.com/mcp -X POST -d "{}" | grep -i www-authenticate
curl -s https://mcp.example.com/.well-known/oauth-protected-resource
# decode the access token claims (aud, iss, scope, exp) with your JWT tool; never paste real tokens into shared tools`),
hyp:[['Audience mismatch (resource indicator)','token aud ≠ server URI (trailing slash, path, http vs https)','aud matches'],['Missing PRM / wrong metadata','no resource_metadata in 401; PRM 404','PRM served'],['Scope insufficient','403 with error="insufficient_scope"','401 only'],['Issuer mismatch / JWKS rotation','signature or iss validation errors in server log','validation passes'],['Client cannot register','no CIMD/DCR support on the AS','registration ok']],
tree:Q('Is it 403 with insufficient_scope?',[['yes','Grant/request the scope; step-up authorization; check per-tool scope mapping.'],['no',Q('Does the token aud equal the canonical server URI?',[['no','Fix the resource parameter/URI canonicalisation on client and AS.'],['yes','Check iss/JWKS/clock skew and refresh-token handling; check PRM and AS metadata URLs.']])]]),
mit:['Correct the canonical URI in server config and AS audience settings.','Temporarily extend clock-skew tolerance (seconds, not minutes).'],
verify:['Login once, tools/call succeeds, token refresh works after expiry.'],
prevent:['Auth integration tests per client; never accept tokens not issued for this server (no token passthrough).']}),

RB({id:'rb-agent-runaway',title:'Agent runaway loop',lesson:'v2-agents',
symptom:'An agent repeats tool calls, burns tokens, hits rate limits, or keeps acting after the task should be done.',
triage:['Is there a step limit, token budget and wall-clock timeout?','Is a tool returning an error the model misreads as "try again"?','Is the agent stuck between two states (plan/act oscillation)?','Is it causing side effects (writes) — stop it first?'],
evidence:ul(['Trace: sequence of tool calls, arguments, results (gen_ai.execute_tool spans, gen_ai.invoke_agent.tool_calls).','Token usage per run; repeated identical arguments.','Tool error messages returned to the model.']),
hyp:[['Unclear tool errors','same call repeated after an error','varied calls'],['No termination criterion','agent never emits a final answer','final answer emitted'],['Context overflow / lost goal','loops start after history truncation','short runs loop too'],['Prompt injection from tool output','tool result contains instructions the agent follows','clean results']],
tree:Q('Are side-effecting tools involved?',[['yes','Kill the run, revoke the session token, review effects; require approval for writes.'],['no',Q('Same tool + same arguments repeated?',[['yes','Fix tool error messages (actionable, non-retryable flag); add duplicate-call detection.'],['no','Add termination criteria, planner limits, and context management.']])]]),
mit:['Hard caps: max steps, max tokens/cost per run, timeout; circuit breaker per tool.','Disable the offending tool via the gateway/MCP server allow-list.'],
verify:['Replay the failing task: terminates within caps with a correct or graceful answer.'],
prevent:['Agent evals with loop-inducing scenarios; human-in-the-loop for writes; budgets per tenant.']}),

RB({id:'rb-region-failover',title:'Region failover',lesson:'v2-multi-region',
symptom:'A region (or its GPU capacity, or a model provider in that region) is down or degraded; traffic must move.',
triage:['Is the failure total, partial (one dependency), or a model-provider outage?','Does data residency allow serving these users from the other region?','Does the surviving region have headroom (reserved GPUs) and the model weights staged?','Which degraded mode is acceptable (smaller model, shorter context, read-only tools)?'],
evidence:ul(['Health checks per region and per dependency (gateway, model pool, vector DB, identity).','Surviving region utilization vs the failover headroom formula.','DNS/GSLB weights and TTLs.']),
hyp:[['Full region outage','all dependencies failing','single dependency'],['Model pool only (GPU or provider)','gateway healthy, model errors/timeouts','model healthy'],['Data layer (vector DB, cache) only','retrieval errors','retrieval fine']],
tree:Q('Can affected users legally be served from another region?',[['no','Degraded in-region mode: cached/static answers, smaller model on remaining capacity, clear user messaging.'],['yes',Q('Does the target region have headroom for the extra load?',[['yes','Shift traffic gradually (GSLB weights), watch TTFT and queue in the target.'],['no','Shift partially + degrade (smaller model, lower max tokens, shed low-priority tenants).']])]]),
mit:['Shift traffic in steps (25/50/100 %) watching the target region’s queue and KV usage.','Enable degraded modes before the target saturates.'],
verify:['Error rate and latency within degraded-mode SLO; no residency violations in logs.'],
prevent:['Game days; pre-staged weights; reserved headroom; documented residency rules per tenant.']})
]);
})();
