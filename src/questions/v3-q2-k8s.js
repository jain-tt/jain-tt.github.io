/* Volume 3, Part 2, Chapter 6 — Questions: Kubernetes and distributed systems */
(function(){
const D=(t,spec,cap)=>fig(t,svgDiagram(spec),cap);

/* ---------- animations ---------- */
Anim.register({
  id:'v3q-k8s-coldstart', title:'Why a new GPU replica takes minutes, not seconds (ILLUSTRATIVE timings)', w:960, h:400,
  elements:[
    {type:'timeline', id:'tl', x:30, y:40, w:900, h:200, labelW:170, cols:12, ticks:true, rows:[
      {id:'node',label:'GPU node (Karpenter)'},{id:'img',label:'Image pull'},{id:'w',label:'Weight load'},{id:'warm',label:'Engine warm-up'},{id:'ready',label:'Ready + traffic'}]},
    {type:'label', id:'axis', x:200, y:262, text:'each column ≈ 30 s (ILLUSTRATIVE; measure your own)'},
    {type:'counter', id:'t', x:30, y:300, label:'Elapsed since scale-out decision', value:'0 s'},
    {type:'counter', id:'lever', x:430, y:300, label:'Lever that shortens this phase', value:'—'}
  ],
  steps:[
    {caption:'KEDA sees <code>vllm:num_requests_waiting</code> above threshold and raises desired replicas from 4 to 6. The new pods are <b>Pending</b>: no free GPU exists. Nothing useful has happened yet; the queue keeps growing.', set:{t:{value:'0 s'}}, dur:4000},
    {caption:'<b>Node provisioning.</b> Karpenter creates a NodeClaim, the cloud launches a GPU instance, it boots, joins the cluster and the GPU stack (driver, container toolkit, device plugin) must report <code>nvidia.com/gpu</code>. Illustrative 2–3 minutes; longer if the driver is installed at boot instead of baked into the image.', set:{tl:{cells:[{row:'node',col:0,span:5,cls:'wait',text:'launch + join + GPU stack'}]}, t:{value:'≈150 s'}, lever:{value:'warm spare nodes, baked AMI'}}, dur:5000},
    {caption:'<b>Image pull.</b> vLLM images with CUDA libraries are multi-GB. A cold node pulls the whole image. Illustrative 60 s.', set:{tl:{cells:[{row:'img',col:5,span:2,cls:'wait',text:'pull'}]}, t:{value:'≈210 s'}, lever:{value:'pre-pulled images, lazy loading'}}, dur:4200},
    {caption:'<b>Weight load.</b> A 70B model in BF16 is ≈141 GB. At an illustrative 1 GB/s from object storage that is ≈141 s; from local NVMe or a node cache at 5 GB/s it is ≈28 s.', set:{tl:{cells:[{row:'w',col:7,span:3,cls:'pre',text:'141 GB @ 1 GB/s'}]}, t:{value:'≈350 s'}, lever:{value:'node-local cache, OCI image volume, faster storage'}}, dur:5000},
    {caption:'<b>Engine warm-up.</b> The engine profiles memory, allocates KV blocks and captures CUDA graphs. Only then can it serve at full speed. Illustrative 30–60 s.', set:{tl:{cells:[{row:'warm',col:10,span:1,cls:'pre',text:'warm'}]}, t:{value:'≈390 s'}, lever:{value:'readiness = real inference'}}, dur:4200},
    {caption:'<b>Ready.</b> The startup probe passes, readiness passes after a real test generation, and the gateway starts sending traffic. Total ≈ 6–7 minutes in this illustration. A burst that doubles traffic in 2 minutes cannot be absorbed by autoscaling alone.', set:{tl:{cells:[{row:'ready',col:11,span:1,cls:'dec',text:'serve'}]}, t:{value:'≈400 s'}}, ok:['tl'], dur:5000},
    {caption:'<b>With a warm pool.</b> If a spare GPU node already exists with the image pulled and weights on local disk, only weight load from NVMe (≈28 s) and warm-up remain: under 2 minutes. That is why headroom and pre-warming are capacity decisions, not autoscaler settings.', set:{tl:{cells:[{row:'node',col:0,span:5,cls:'idle',text:'already running'},{row:'img',col:5,span:2,cls:'idle',text:'cached'}]}, t:{value:'≈90 s with warm pool'}, lever:{value:'pay for idle headroom'}}, dur:5200}
  ]
});

Anim.register({
  id:'v3q-k8s-gang', title:'Gang admission: why the default scheduler can deadlock distributed jobs', w:960, h:420,
  elements:[
    {type:'zone', id:'cl', x:20, y:20, w:600, h:250, label:'Cluster: 8 GPU nodes × 8 GPUs = 64 GPUs'},
    {type:'bar', id:'ja', x:60, y:80, w:520, h:24, label:'Job A needs 48 GPUs (6 workers × 8)', value:0},
    {type:'bar', id:'jb', x:60, y:160, w:520, h:24, label:'Job B needs 48 GPUs (6 workers × 8)', value:0},
    {type:'node', id:'q', x:660, y:60, w:270, h:60, label:'Kueue ClusterQueue', sub:'quota 64 GPUs, gang admission', icon:'queue'},
    {type:'node', id:'sched', x:660, y:170, w:270, h:60, label:'kube-scheduler', sub:'places pods one by one', icon:'k8s'},
    {type:'edge', id:'e1', from:'q', to:'sched', label:'admit whole Workload'},
    {type:'counter', id:'state', x:40, y:310, label:'State', value:'both jobs submitted'},
    {type:'counter', id:'idle', x:520, y:310, label:'GPUs allocated but idle', value:'0'}
  ],
  steps:[
    {caption:'Two training jobs each need 48 GPUs and the cluster has 64. Only one can run at a time. Each job starts only when <b>all</b> its workers are up, because NCCL collectives need every rank.', dur:4000},
    {caption:'<b>Without gang admission</b>, kube-scheduler places pods as they arrive. Job A gets 4 workers (32 GPUs), Job B gets 4 workers (32 GPUs). The cluster is full.', set:{ja:{value:0.667,text:'32 / 48'}, jb:{value:0.667,text:'32 / 48'}, state:{value:'partial allocation'}, idle:{value:'64'}}, warn:['ja','jb'], dur:4500},
    {caption:'Neither job has all ranks, so neither starts. Workers sit in NCCL init or barrier waits. <b>64 GPUs are allocated and 0 are doing work.</b> This is a resource deadlock; it lasts until someone deletes a job.', bad:['ja','jb','sched'], set:{state:{value:'deadlock: 0 useful work'}}, dur:4800},
    {caption:'<b>With Kueue</b>, jobs are suspended Workloads. Kueue admits a Workload only if the ClusterQueue has quota for the <b>whole</b> request (48 GPUs). Job A is admitted; Job B waits in the queue, holding nothing.', hl:['q'], set:{ja:{value:0,text:''}, jb:{value:0,text:'queued, holds 0'}, state:{value:'A admitted, B queued'}, idle:{value:'0'}}, packets:[{edge:'e1',label:'A: 48'}], dur:4800},
    {caption:'Job A’s pods are created and scheduled together. Using waitForPodsReady-style settings, Kueue can evict and requeue a Workload whose pods do not all become ready within a timeout, so a half-placed job does not hold GPUs forever.', set:{ja:{value:1,text:'48 / 48 running'}}, ok:['ja'], dur:4500},
    {caption:'When A finishes, its quota is released and B is admitted. With Topology Aware Scheduling (beta in Kueue, on by default) B’s 6 workers can also be packed into the same rack or NVLink block to keep collectives fast.', set:{ja:{value:0,text:'done'}, jb:{value:1,text:'48 / 48 running'}, state:{value:'B admitted, no deadlock'}}, ok:['jb','q'], dur:5000}
  ]
});

Anim.register({
  id:'v3q-k8s-xid', title:'Xid triage: classify before you act', w:960, h:420,
  elements:[
    {type:'node', id:'dcgm', x:30, y:40, w:190, h:60, label:'DCGM exporter', sub:'DCGM_FI_DEV_XID_ERRORS', icon:'chart'},
    {type:'node', id:'cls', x:290, y:40, w:190, h:60, label:'Classify Xid', sub:'NVIDIA Xid catalog', icon:'search'},
    {type:'node', id:'app', x:560, y:20, w:170, h:52, label:'App error', sub:'13, 31, 94', cls:'ok'},
    {type:'node', id:'reset', x:560, y:100, w:170, h:52, label:'GPU reset needed', sub:'48, 95, 64'},
    {type:'node', id:'hw', x:560, y:180, w:170, h:52, label:'Hardware / bus', sub:'79, 74'},
    {type:'node', id:'restart', x:770, y:20, w:170, h:52, label:'Restart pod', sub:'keep node'},
    {type:'node', id:'cordon', x:770, y:140, w:170, h:52, label:'Cordon + drain', sub:'then reset/reboot'},
    {type:'node', id:'ticket', x:770, y:240, w:170, h:52, label:'Replace node', sub:'vendor ticket'},
    {type:'edge', id:'e1', from:'dcgm', to:'cls'},
    {type:'edge', id:'e2', from:'cls', to:'app'},{type:'edge', id:'e3', from:'cls', to:'reset'},{type:'edge', id:'e4', from:'cls', to:'hw'},
    {type:'edge', id:'e5', from:'app', to:'restart'},{type:'edge', id:'e6', from:'reset', to:'cordon'},{type:'edge', id:'e7', from:'hw', to:'cordon'},{type:'edge', id:'e8', from:'cordon', to:'ticket', cls:'dash'},
    {type:'label', id:'note', x:30, y:340, text:'DCGM_FI_DEV_XID_ERRORS is a gauge holding the LAST Xid code, not a counter.\nAlert on changes, and read the kernel log (dmesg) for the full history.'}
  ],
  steps:[
    {caption:'A GPU reports an Xid: an error code the NVIDIA driver writes to the kernel log. DCGM exporter exposes <code>DCGM_FI_DEV_XID_ERRORS</code>, a <b>gauge of the last Xid value</b>, not a running count.', hl:['dcgm'], packets:[{edge:'e1',label:'Xid'}], dur:4200},
    {caption:'<b>Classify before acting.</b> NVIDIA’s Xid catalog gives each code an immediate-action bucket. Treating every Xid as “bad node” drains healthy hardware for application bugs.', hl:['cls'], dur:4000},
    {caption:'<b>Xid 13 / 31</b> (graphics exception, MMU page fault) usually mean an application bug such as an illegal address. <b>Xid 94</b> is a contained memory error: only the offending app must restart. Catalog action: RESTART_APP. Keep the node.', ok:['app','restart'], packets:[{edge:'e2'},{edge:'e5',delay:500}], dur:4800},
    {caption:'<b>Xid 48</b> (double-bit ECC) and <b>95</b> (uncontained memory error) need a GPU reset or node reboot to clear. <b>Xid 64</b> (row-remap failure) catalog action is RESET_GPU then contact support. Cordon so no new pods land, drain gracefully, then reset.', warn:['reset','cordon'], packets:[{edge:'e3'},{edge:'e6',delay:500}], dur:5000},
    {caption:'<b>Xid 79</b> (GPU fallen off the bus) and <b>74</b> (NVLink error) point at hardware or interconnect. Cordon, drain, and replace or open a support case. On a training job, one such GPU breaks every collective, so the whole job restarts from checkpoint.', bad:['hw'], warn:['cordon','ticket'], packets:[{edge:'e4'},{edge:'e7',delay:400},{edge:'e8',delay:900}], dur:5200},
    {caption:'Automate the <b>safe</b> half (cordon, label, ticket) and gate the disruptive half (drain of a node running a training job, reboot) behind a rate limit such as “at most 2 GPU nodes per hour” and a human approval for large jobs.', hl:['cordon'], show:['note'], dur:5000}
  ]
});

/* ---------- chapter lesson ---------- */
registerLesson({
  id:'v3-ch-k8s', vol:3, part:2, num:6,
  title:'Questions: Kubernetes and distributed systems', minutes:50,
  summary:'This chapter is the interview bank for running GPU workloads on Kubernetes. Interviewers want to hear how a GPU becomes a schedulable resource, how you share or isolate it, how you admit large distributed jobs without deadlocks, how you autoscale inference on the right signals, and what you do when a GPU node or a training job fails. Each answer is built from mechanism, numbers and an operational decision.',
  objectives:[
    'Explain GPU scheduling end to end: driver, device plugin or DRA, scheduler, and runtime, and say which pieces are mature in October 2026.',
    'Choose between whole GPUs, MIG, time-slicing and dedicated pools for a given isolation and utilisation requirement.',
    'Design admission, gang scheduling and quotas for distributed training with Kueue, and explain the deadlock it prevents.',
    'Autoscale LLM inference on queue and KV-cache signals and decompose cold-start time into levers.',
    'Run a failure drill: Xid triage, pods Pending, failed distributed training recovery with checkpoint maths.'
  ],
  prereqs:['v1-k8s-gpu-stack','v1-k8s-serving','v1-k8s-autoscaling'],
  next:['v3-ch-mlops','v3-ch-hyperscale','v3-debugging'],
  tags:['interview','kubernetes','gpu','scheduling','distributed-training'],
  html:`
<h2>What interviewers are really testing</h2>
<p>A DevOps engineer already knows Deployments, Services and HPA. The AI-infrastructure interview probes the places where that knowledge <b>stops being sufficient</b>: a GPU is an indivisible, expensive, slow-to-provision device; a model replica takes minutes to become useful; a training job is a single program spread over dozens of pods that must all start together and all survive together. Questions in this chapter check five things:</p>
<ol>
<li><b>Resource model.</b> Do you know how <code>nvidia.com/gpu</code> appears on a node, why it cannot be overcommitted, and what Dynamic Resource Allocation (DRA) changes?</li>
<li><b>Sharing and isolation.</b> Can you pick between whole GPUs, MIG and time-slicing, and say what each does and does not isolate?</li>
<li><b>Admission.</b> Do you understand gang scheduling, quotas and topology, or would you let two half-placed jobs deadlock 64 GPUs?</li>
<li><b>Elasticity.</b> Do you scale inference on queue depth and KV-cache pressure rather than CPU, and do you know where the minutes of a cold start go?</li>
<li><b>Failure.</b> Can you read an Xid, decide cordon versus restart, and resume a failed 512-GPU training job without losing a day?</li>
</ol>

${D('Mental model: the GPU path through Kubernetes', {w:900,h:300,
 zones:[{x:250,y:20,w:630,h:260,label:'GPU node'}],
 boxes:[
  {id:'q',x:20,y:40,w:190,h:56,label:'Kueue',sub:'quota, gang, topology'},
  {id:'s',x:20,y:150,w:190,h:56,label:'kube-scheduler',sub:'filters on GPU resource'},
  {id:'dp',x:280,y:60,w:200,h:56,label:'Device plugin / DRA',sub:'advertise GPUs',cls:'hl'},
  {id:'drv',x:280,y:180,w:200,h:56,label:'Driver + toolkit',sub:'GPU Operator'},
  {id:'pod',x:520,y:60,w:170,h:56,label:'Model pod',sub:'vLLM / trainer'},
  {id:'dcgm',x:520,y:180,w:170,h:56,label:'DCGM exporter',sub:'util, Xid, memory'},
  {id:'gpu',x:720,y:110,w:140,h:70,label:'GPU(s)',sub:'HBM, NVLink',cls:'v2'}
 ],
 arrows:[{from:'q',to:'s',label:'admit'},{from:'s',to:'dp',label:'bind'},{from:'dp',to:'pod',label:'device'},{from:'drv',to:'gpu'},{from:'pod',to:'gpu'},{from:'dcgm',to:'gpu',cls:'dash'}]
}, 'Kueue decides WHETHER a job may start; the scheduler decides WHERE; the device plugin or DRA driver decides WHICH device; the driver stack makes it usable; DCGM tells you if it is healthy.')}

<h2>Weak versus strong answers</h2>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“We set an HPA on CPU at 70 % and Kubernetes adds pods when traffic grows.”</p></div><div class="good"><h4>Strong answer</h4><p>“CPU tells me nothing about a GPU engine. I scale on <code>vllm:num_requests_waiting</code> and KV-cache usage through KEDA, and I size a warm pool because a new replica needs a node, an image, 140 GB of weights and warm-up — several minutes. Autoscaling handles the slow trend; headroom and admission control handle the burst.”</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“To share GPUs we enable time-slicing so more teams fit.”</p></div><div class="good"><h4>Strong answer</h4><p>“Time-slicing gives no memory or fault isolation, per NVIDIA’s own docs, so one tenant’s OOM or long kernel hurts the others. For untrusted or latency-sensitive tenants I use MIG on A100/H100-class GPUs, which partitions memory and SMs in hardware, or a dedicated pool. Time-slicing is for dev notebooks.”</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“If training fails, Kubernetes restarts the pod.”</p></div><div class="good"><h4>Strong answer</h4><p>“Restarting one rank does not resume a collective job. I detect the hang (NCCL timeout), isolate the bad node, restart the whole job from the latest sharded checkpoint, and choose the checkpoint interval so expected lost work is minutes, not hours.”</p></div></div>

<h2>Must-know numbers and formulas</h2>
${formula(`
GPU resource rule (device plugin)
  limits: nvidia.com/gpu: 1      requests may be omitted or must EQUAL limits
                                 extended resources are never overcommitted

H100 80 GB MIG                   memory in 1/8 slices, compute in 1/7 slices
  1g.10gb × 7    2g.20gb × 3    3g.40gb × 2    7g.80gb × 1

Weight-load time                 t  =  model bytes ÷ read bandwidth
  70B BF16 ≈ 141 GB @ 1 GB/s  →  ≈ 141 s        @ 5 GB/s → ≈ 28 s

Checkpoint interval (Young's approximation)
              ┌──────────────────────┐
  T_opt  ≈   √ 2 × C × MTBF            C = time to write one checkpoint
                                       MTBF = mean time between job failures
  C = 2 min, MTBF = 480 min  →  T_opt ≈ √1,920 ≈ 44 min
`)}
${table(['Fact (as of Oct 2026)','Value'],[
 ['Latest stable Kubernetes','v1.37.1'],
 ['DRA core API','<code>resource.k8s.io/v1</code>, GA in 1.34, feature gate locked on from 1.35'],
 ['NVIDIA DRA driver','v0.5.1; ComputeDomains officially supported, plain GPU allocation “can be tried out” but not yet officially supported'],
 ['Kueue','v0.20.x, API <code>kueue.x-k8s.io/v1beta2</code>, Topology Aware Scheduling beta and on by default'],
 ['KEDA','v2.21, Prometheus scaler with <code>threshold</code> and <code>activationThreshold</code>'],
 ['vLLM scaling metrics','<code>vllm:num_requests_waiting</code>, <code>vllm:kv_cache_usage_perc</code> (0–1)'],
 ['OCI image volume','Stable since Kubernetes 1.36 — mount model weights as a read-only OCI artifact']
])}

<h2>How to use this chapter</h2>
<p>Read the question and the “understand” line, then answer out loud for 60 seconds before revealing. Compare against the short answer, then study the detailed answer and the follow-ups: interviewers almost always ask at least two. The animations show the three mechanisms candidates most often get wrong: cold-start time, gang-scheduling deadlock, and Xid triage. Lessons behind this chapter: ${L('v1-k8s-gpu-stack','Kubernetes GPU stack')}, ${L('v1-k8s-serving','model serving on Kubernetes')}, ${L('v1-k8s-autoscaling','autoscaling GPU inference')} and ${L('v2-distributed-training','distributed training and recovery')}.</p>
`,
  quiz:[
    {q:'A pod spec sets requests nvidia.com/gpu: 1 and limits nvidia.com/gpu: 2. What happens?',options:['The pod gets 1 GPU guaranteed and can burst to 2','The API server rejects it: for extended resources requests must equal limits if both are set','The scheduler places it on a node with 2 free GPUs','Kubernetes rounds the request up to 2'],answer:1,explain:'Extended resources cannot be overcommitted, so request and limit must be equal if both are present. “Burst to 2” is the CPU/memory mental model and does not apply to GPUs.'},
    {q:'Which sharing method gives hardware memory and fault isolation between tenants on an H100?',options:['Time-slicing','CUDA MPS','MIG','Running two vLLM processes with --gpu-memory-utilization 0.45 each'],answer:2,explain:'MIG partitions memory and SMs in hardware. NVIDIA documents that time-slicing has no memory or fault isolation. Splitting gpu-memory-utilization is a soft budget inside one device, not isolation.'},
    {q:'Two 48-GPU training jobs are submitted to a 64-GPU cluster without Kueue. What is the most likely bad outcome?',options:['Both run at half speed','Each gets part of its workers, neither can start collectives, and the GPUs sit allocated but idle','The scheduler automatically queues the second job','Kubernetes preempts the older job'],answer:1,explain:'kube-scheduler places pods individually, so partial allocation is possible and leads to deadlock. Kueue admits whole workloads against quota, preventing it. The default scheduler has no job-level queue.'},
    {q:'You scale a vLLM Deployment with KEDA. Which signal is the best primary trigger?',options:['Container CPU utilisation','DCGM_FI_DEV_GPU_UTIL','vllm:num_requests_waiting (queue depth), with KV-cache usage as a secondary signal','Pod memory working set'],answer:2,explain:'Waiting requests directly show demand exceeding capacity. GPU utilisation is the fraction of time any kernel ran; it reads high even at moderate load, so it is a poor scale signal. CPU and RAM do not reflect GPU work.'},
    {q:'DCGM_FI_DEV_XID_ERRORS reads 79 on a node. What is the right first action?',options:['Restart the pod and keep the node','Ignore: 79 is informational','Cordon and drain the node; the GPU has fallen off the bus and needs bare-metal restart or replacement','Increase the pod memory limit'],answer:2,explain:'Xid 79 means the GPU fell off the bus; the catalog action is restart bare metal and contact support. Restarting the pod on the same node will fail again. Note the metric holds the last Xid value, not a count.'}
  ],
  flashcards:[
    {front:'Device plugin vs DRA in one line each',back:'Device plugin: advertises a count (nvidia.com/gpu) — whole, identical devices. DRA: ResourceClaims against DeviceClasses with attributes and selectors (resource.k8s.io/v1, GA 1.34) — structured, shareable, topology-aware devices.'},
    {front:'Why can GPUs not be overcommitted in Kubernetes?',back:'They are extended resources; requests must equal limits if both are set, and the scheduler counts whole units.'},
    {front:'MIG vs time-slicing',back:'MIG: hardware partitions of memory and SMs, fault isolation. Time-slicing: shared device, no memory or fault isolation; good for dev, not for untrusted or latency-critical tenants.'},
    {front:'What does Kueue add over kube-scheduler?',back:'Job-level admission against quota (ClusterQueue/LocalQueue/ResourceFlavor), gang semantics, fair sharing and borrowing via cohorts, priorities, and topology-aware placement.'},
    {front:'Best KEDA signals for LLM inference',back:'vllm:num_requests_waiting (queue) and vllm:kv_cache_usage_perc (memory pressure); TTFT p95 as a guard. Not CPU, not GPU util.'},
    {front:'Four phases of a GPU cold start',back:'Node provision + GPU stack ready → image pull → weight load (bytes ÷ bandwidth) → engine warm-up (KV allocation, CUDA graphs).'},
    {front:'Young’s checkpoint interval',back:'T_opt ≈ √(2 × C × MTBF). Expected lost work per failure ≈ T/2 plus restart time.'},
    {front:'Xid quick buckets',back:'13/31/94 → restart app; 48/95 → GPU reset/reboot; 64 → reset + support; 74 NVLink, 79 off the bus → cordon, drain, hardware case.'}
  ]
});

/* ---------- questions ---------- */
registerQuestions([
{
  id:'k8s-01', chapter:'v3-ch-k8s', difficulty:1,
  title:'How does Kubernetes know a node has a GPU, and how does a pod get one?',
  understand:'The interviewer checks whether you know the full chain from hardware to container, and that Kubernetes itself knows nothing about CUDA. They also want to hear whether you know the newer Dynamic Resource Allocation (DRA) model and its maturity.',
  short:'Kubernetes does not discover GPUs by itself. The NVIDIA driver and container toolkit make the device usable on the host, and a device plugin running as a DaemonSet advertises a countable extended resource, nvidia.com/gpu, to the kubelet. A pod asks for it in limits, the scheduler only considers nodes with free units, and at container start the plugin tells the runtime which device to inject. In practice the NVIDIA GPU Operator installs and manages that whole stack, plus GPU Feature Discovery labels and the DCGM exporter. The newer path is Dynamic Resource Allocation, which went GA in Kubernetes 1.34: drivers publish devices with attributes in ResourceSlices and pods reference ResourceClaims, so you can select by memory or model instead of counting identical units. NVIDIA’s DRA driver is still maturing for plain GPU allocation, so most production clusters today still use the device plugin.',
  detailed:`
<h4>The chain, bottom to top</h4>
<ol>
<li><b>Kernel driver</b> — talks to the GPU. Without it there is no <code>/dev/nvidia*</code>.</li>
<li><b>NVIDIA Container Toolkit</b> — hooks the container runtime (containerd) so a container can see the device nodes and driver libraries.</li>
<li><b>Device plugin</b> — a DaemonSet that registers with the kubelet over gRPC and reports a count, e.g. <code>nvidia.com/gpu: 8</code>. It also reports device health; an unhealthy device is removed from allocatable.</li>
<li><b>Scheduler</b> — filters nodes whose allocatable count minus what is already bound is at least the pod’s request.</li>
<li><b>Kubelet + plugin Allocate</b> — at container creation the plugin returns which device IDs to expose; the runtime injects them.</li>
</ol>
${code('yaml',`resources:
  limits:
    nvidia.com/gpu: 1      # requests optional; if set it MUST equal limits`)}
<p>The Kubernetes docs are explicit: GPUs are specified in limits; if requests are set they must equal limits; extended resources cannot be overcommitted. That is why there is no “burst to 2 GPUs”.</p>

<h4>What the GPU Operator adds</h4>
<p>The NVIDIA GPU Operator (26.7.x line as of Oct 2026) packages the containerised driver, container toolkit, device plugin, GPU Feature Discovery (node labels such as product and memory), DCGM exporter, MIG Manager and a validator. In managed offerings some of this is pre-installed: EKS Auto Mode, for example, ships the NVIDIA drivers and device plugin for supported instance types and the plugin does not appear as a visible DaemonSet.</p>

<h4>Dynamic Resource Allocation (DRA)</h4>
${table(['','Device plugin','DRA'],[
 ['Request model','Integer count of one resource name','ResourceClaim against a DeviceClass with CEL selectors on attributes'],
 ['Who publishes devices','Plugin reports count to kubelet','Driver publishes ResourceSlices (devices + attributes + capacity)'],
 ['Sharing','One container per device (or time-slicing hacks)','Claims can be shared between containers/pods; partitionable devices (beta 1.36)'],
 ['API','core extended resources','<code>resource.k8s.io/v1</code>, GA in 1.34'],
 ['NVIDIA support (Oct 2026)','Mature, default','Driver v0.5.1: ComputeDomains (multi-node NVLink) officially supported; plain GPU allocation “can be tried out”, not yet officially supported']
])}
<p>So the honest senior answer is: DRA is the future model and already GA in Kubernetes, but for NVIDIA single-GPU allocation the device plugin remains the production default today; DRA is in production use first for multi-node NVLink domains (GB200 NVL72-class systems).</p>

<h4>Scheduling hygiene</h4>
<ul><li>Taint GPU nodes (e.g. <code>nvidia.com/gpu=present:NoSchedule</code>) so CPU pods do not waste them; GPU pods tolerate the taint.</li>
<li>Use GFD labels or node pool labels in nodeAffinity to pick H100 vs L40S.</li>
<li>Watch <code>kubectl describe node</code> → Allocatable vs Allocated for <code>nvidia.com/gpu</code>.</li></ul>`,
  diagram:D('GPU discovery and allocation path', {w:900,h:300,
   boxes:[
    {id:'hw',x:20,y:200,w:130,h:56,label:'GPU',sub:'PCIe / SXM',cls:'v2'},
    {id:'drv',x:180,y:200,w:150,h:56,label:'Driver',sub:'/dev/nvidia*'},
    {id:'tk',x:360,y:200,w:170,h:56,label:'Container toolkit',sub:'runtime hook'},
    {id:'dp',x:180,y:60,w:170,h:56,label:'Device plugin',sub:'nvidia.com/gpu: 8',cls:'hl'},
    {id:'kl',x:400,y:60,w:130,h:56,label:'kubelet',sub:'allocatable'},
    {id:'sch',x:580,y:60,w:150,h:56,label:'Scheduler',sub:'filter + bind'},
    {id:'pod',x:580,y:200,w:150,h:56,label:'Pod',sub:'limits gpu: 1'},
    {id:'api',x:760,y:60,w:120,h:56,label:'API server'}
   ],
   arrows:[{from:'hw',to:'drv'},{from:'drv',to:'tk'},{from:'dp',to:'kl',label:'register'},{from:'kl',to:'api',fromSide:'top',toSide:'top',label:'node status'},{from:'sch',to:'api',both:true},{from:'kl',to:'pod',label:'Allocate'},{from:'tk',to:'pod',label:'inject device'}]
  }, 'The device plugin only advertises and allocates. The driver and toolkit make the device usable inside the container.'),
  followups:[
    {q:'A node shows nvidia.com/gpu: 0 allocatable although the instance has 8 GPUs. Where do you look?',a:'Device plugin pod on that node (CrashLoop? cannot find driver?), driver validator logs from the GPU Operator, nvidia-smi on the host, and whether a MIG strategy change made the plugin advertise MIG resources instead (e.g. nvidia.com/mig-1g.10gb). Also check health: the plugin removes unhealthy devices.'},
    {q:'Why can’t you give a pod “half a GPU” with requests: 0.5?',a:'Extended resources are integers and cannot be overcommitted. Fractional sharing needs MIG (hardware partitions advertised as separate resources), time-slicing (plugin advertises replicas), or DRA claims shared by several consumers.'},
    {q:'When would you adopt DRA now rather than later?',a:'When you need what counts cannot express: multi-node NVLink ComputeDomains on GB200-class racks (officially supported in NVIDIA’s DRA driver), attribute-based selection across heterogeneous GPUs, or shared claims. For a homogeneous H100 inference fleet, the device plugin is simpler and fully supported; I would pilot DRA in a non-critical pool and track the driver’s support statement.'},
    {q:'How does DRA interact with the cluster autoscaler or Karpenter?',a:'Autoscalers must simulate whether a new node would satisfy a ResourceClaim, which needs the driver’s ResourceSlice model for node types not yet running. Support is evolving; verify your autoscaler version supports DRA-aware scale-up before relying on it, otherwise pods with claims may stay Pending without triggering a scale-up.'}
  ],
  tradeoffs:`<ul><li><b>Device plugin</b>: simple, mature, universally supported by autoscalers; but only counts identical devices and cannot describe topology or attributes.</li><li><b>DRA</b>: expressive (selectors, sharing, partitions, multi-node domains) and GA in Kubernetes; but vendor driver maturity varies and tooling (autoscalers, quota) is catching up.</li><li><b>GPU Operator vs baked AMI</b>: the operator keeps driver versions consistent and upgradable as Kubernetes objects; baking the driver into the node image shortens boot time. Many teams bake the driver and let the operator manage the rest.</li></ul>`,
  failures:`${table(['Symptom','Evidence','Fix'],[
   ['Pods Pending: “Insufficient nvidia.com/gpu”','Node allocatable 0 or all bound','Check device plugin pod, driver validator, or add capacity'],
   ['Container starts but CUDA reports no device','Toolkit/runtime class not configured; missing runtimeClassName','Fix containerd config via operator; set runtime class'],
   ['GPU count drops from 8 to 7 overnight','Plugin marked a device unhealthy (often after an Xid)','Inspect DCGM Xid, cordon and drain, reset or replace'],
   ['Driver upgrade breaks all pods','Driver/CUDA forward-compat mismatch','Roll upgrades node pool by node pool; validate with a canary node']
  ])}`,
  vocab:[
   {term:'extended resource',def:'A node-level resource name outside CPU/memory (e.g. nvidia.com/gpu) counted in integers and never overcommitted.'},
   {term:'device plugin',def:'A kubelet gRPC plugin that advertises device counts and health and returns device IDs at allocation.'},
   {term:'DRA',def:'Dynamic Resource Allocation: devices described by drivers in ResourceSlices and requested via ResourceClaims (resource.k8s.io/v1).'},
   {term:'DeviceClass',def:'An admin- or driver-defined category of devices with selectors, referenced by ResourceClaims.'},
   {term:'GPU Feature Discovery',def:'Component that labels nodes with GPU product, memory, MIG capability and driver versions.'},
   {term:'NVIDIA Container Toolkit',def:'Runtime hook that exposes GPU device nodes and driver libraries to containers.'}
  ],
  mistakes:['Saying Kubernetes “natively supports GPUs”: the scheduler only counts a resource someone else advertises.','Setting requests lower than limits for GPUs, as you would for CPU.','Claiming DRA has fully replaced the device plugin for NVIDIA GPUs in production — NVIDIA’s own driver README says plain GPU allocation is not yet officially supported (as of Oct 2026).','Forgetting taints, so system pods or CPU jobs land on expensive GPU nodes.'],
  related:['v1-k8s-gpu-stack','v1-gpu-architecture','v1-k8s-serving']
},
{
  id:'k8s-02', chapter:'v3-ch-k8s', difficulty:2,
  title:'Several teams share a GPU cluster. Would you use whole GPUs, MIG, time-slicing or dedicated pools?',
  understand:'This tests whether you can separate utilisation goals from isolation guarantees. A strong answer maps workload type and trust level to a sharing method, and distinguishes performance isolation from security isolation.',
  short:'I start from two questions: does the workload need the whole GPU’s memory and bandwidth, and how much isolation does the tenant need? Production LLM serving usually needs whole GPUs or several, so I give it dedicated node pools. For small models, notebooks and batch embedding jobs on A100 or H100, MIG is my default for sharing because it partitions memory and streaming multiprocessors in hardware, so one tenant’s out-of-memory or long kernel cannot hurt another. Time-slicing I reserve for development: NVIDIA states it has no memory or fault isolation. On top of the device choice I add namespace quotas on nvidia.com/gpu, Kueue queues with fair sharing, and cost showback so teams see what they hold.',
  detailed:`
<h4>The options</h4>
${table(['Method','What is shared','Isolation','Typical use'],[
 ['Whole GPU(s), dedicated pool','Nothing','Full (separate device)','Production inference, training'],
 ['MIG','One GPU split into up to 7 hardware instances','Memory, cache and SM partitions; fault isolation','Small models, embeddings, notebooks, multi-tenant inference of small models'],
 ['Time-slicing','Device time, oversubscribed replicas','None for memory or faults (NVIDIA docs)','Dev/test, low-priority bursty jobs'],
 ['MPS','Concurrent kernels from several processes','Partial; limits on threads/memory, shared fault domain','Many small cooperative processes from one team']
])}
<h4>MIG numbers to know (H100 80 GB)</h4>
${formula(`
memory is cut in 1/8 slices, compute in 1/7 slices
  1g.10gb   × 7   → 1/7 SMs, 1/8 memory each
  2g.20gb   × 3
  3g.40gb   × 2   → 3/7 SMs, 4/8 memory
  4g.40gb   × 1   → 4/7 SMs, 4/8 memory
  7g.80gb   × 1   → whole GPU
`)}
<p>Note that 3g.40gb and 4g.40gb get the same memory but different compute. L40S and L4 do not support MIG, so on those cards the only sharing options are time-slicing or MPS — which pushes multi-tenant small-model workloads towards A100/H100 MIG or towards dedicated small GPUs.</p>
<h4>A concrete mapping (illustrative)</h4>
<ul>
<li><b>Atlas production chat (70B)</b>: dedicated H100 pool, tensor parallel inside one node, whole GPUs.</li>
<li><b>Embedding service (small encoder)</b>: MIG 2g.20gb or 3g.40gb instances, several replicas per GPU.</li>
<li><b>Data-science notebooks</b>: MIG 1g.10gb, or time-slicing on older cards with clear “no isolation” labelling.</li>
<li><b>Regulated tenant</b>: dedicated nodes plus network policy and separate namespaces; shared silicon is a residual risk to document.</li>
</ul>
<h4>Governance layer</h4>
<p><code>ResourceQuota</code> can cap <code>requests.nvidia.com/gpu</code> per namespace. Kueue adds ClusterQueues per team with nominal quota, cohorts for borrowing idle quota, and preemption by priority, so idle GPUs are lent rather than wasted and reclaimed when the owner needs them.</p>
<p>Performance isolation (predictable latency) and security isolation (no data leakage, no cross-tenant fault) are different. MIG helps both; time-slicing helps neither; a dedicated pool is the strongest but most expensive.</p>`,
  diagram:D('Matching workloads to sharing modes', {w:900,h:320,
   boxes:[
    {id:'a',x:20,y:30,w:230,h:56,label:'Prod LLM serving 70B',sub:'needs ≥ 1 full GPU'},
    {id:'b',x:20,y:120,w:230,h:56,label:'Embeddings, small models',sub:'< 20 GB each'},
    {id:'c',x:20,y:210,w:230,h:56,label:'Notebooks, dev jobs',sub:'bursty, low priority'},
    {id:'p1',x:340,y:30,w:220,h:56,label:'Dedicated pool',sub:'whole GPUs',cls:'ok'},
    {id:'p2',x:340,y:120,w:220,h:56,label:'MIG instances',sub:'hardware partitions',cls:'hl'},
    {id:'p3',x:340,y:210,w:220,h:56,label:'Time-slicing',sub:'no memory isolation',cls:'warn'},
    {id:'g',x:650,y:110,w:220,h:76,label:'Kueue + quotas',sub:'fair share, borrow, preempt'}
   ],
   arrows:[{from:'a',to:'p1'},{from:'b',to:'p2'},{from:'c',to:'p3'},{from:'p1',to:'g',cls:'dash'},{from:'p2',to:'g',cls:'dash'},{from:'p3',to:'g',cls:'dash'}]
  }, 'Isolation follows the trust and latency need; quota and fair-sharing sit above every pool.'),
  followups:[
    {q:'A team says MIG wastes capacity because their model needs 45 GB. What do you do?',a:'45 GB does not fit a 40 GB slice, so they need a 7g.80gb (whole GPU) or a larger-memory part such as H200 MIG profiles. Or reduce memory: FP8 weights, FP8 KV cache, shorter max context. MIG layouts are per GPU, so I keep separate node pools with different MIG configs rather than mixing.'},
    {q:'How do you change MIG layouts without disrupting running pods?',a:'MIG reconfiguration needs the GPU to be idle. With the GPU Operator’s MIG Manager you set a node label for the desired profile; the manager drains GPU workloads on that node and applies it. So I treat it as a node-pool change: cordon, drain, relabel, validate — never in place on a busy serving node.'},
    {q:'Is time-slicing ever acceptable in production?',a:'For low-priority, trusted, batch workloads where occasional slowdowns and a shared fault domain are acceptable, and where the alternative is idle GPUs. Never for latency-SLO serving or untrusted tenants, because one process can exhaust memory or stall others.'},
    {q:'How would you prove noisy-neighbour impact before and after MIG?',a:'Run the latency-sensitive workload alone and then alongside a synthetic heavy tenant; compare TTFT/TPOT p95 and variance, plus DCGM per-instance metrics. The improvement is the evidence for the extra cost of partitioning. [In my lab I would show the two latency histograms side by side.]'}
  ],
  tradeoffs:`<ul><li>MIG raises isolation but fixes partition sizes; fragmentation appears if demand does not match the layout.</li><li>Dedicated pools give the best latency and simplest security story but lowest utilisation unless Kueue lends idle quota to batch work with preemption.</li><li>Time-slicing maximises packing but turns one tenant’s failure into everyone’s incident.</li></ul>`,
  failures:`<ul><li><b>OOM in tenant B when tenant A loads a model</b> on a time-sliced GPU → shared memory, no isolation → move to MIG or separate GPUs.</li><li><b>p99 latency spikes at the same minute every hour</b> → a batch job co-located by time-slicing → separate pools or schedule batch off-peak with lower priority.</li><li><b>MIG nodes stuck with no allocatable resources after relabel</b> → MIG Manager failed because processes still held the GPU → drain fully, check MIG Manager logs, re-apply.</li></ul>`,
  vocab:[
   {term:'MIG',def:'Multi-Instance GPU: hardware partitioning of supported NVIDIA GPUs into isolated instances with dedicated memory and SM slices.'},
   {term:'time-slicing',def:'Oversubscribing a GPU by advertising replicas; processes share the device by time, without memory or fault isolation.'},
   {term:'MPS',def:'CUDA Multi-Process Service: lets kernels from several processes run concurrently on one GPU.'},
   {term:'noisy neighbour',def:'A co-tenant whose load degrades another tenant’s latency or throughput on shared hardware.'},
   {term:'cohort',def:'Kueue grouping of ClusterQueues that may borrow each other’s unused quota.'}
  ],
  mistakes:['Treating time-slicing as a security boundary.','Claiming MIG is available on L4/L40S (it is not on NVIDIA’s supported list).','Assuming 3g.40gb gives more memory than 4g.40gb — they get the same memory, different compute.','Measuring success by GPU utilisation only, while tail latency for the sensitive tenant worsens.'],
  related:['v1-k8s-gpu-stack','v2-governance','v2-finops-optimization']
},
{
  id:'k8s-03', chapter:'v3-ch-k8s', difficulty:2,
  title:'How do you schedule distributed training jobs on Kubernetes? Explain gang scheduling and Kueue.',
  understand:'The interviewer wants to know whether you understand that a distributed job is all-or-nothing, why the default scheduler is not enough, and how quotas, queues and topology fit together.',
  short:'A distributed training job is one program spread across many pods; NCCL collectives need every rank, so a job with 40 of 48 GPUs does no work at all. The default scheduler places pods one at a time, so two big jobs can each grab half the cluster and deadlock. I put Kueue in front: jobs are created suspended, Kueue admits a whole workload only when its ClusterQueue has quota for all of it, then the pods are released to the scheduler. Teams get LocalQueues mapped to ClusterQueues with nominal quota per GPU flavour, cohorts let them borrow idle quota, and priorities allow preemption. Topology-aware scheduling, which is beta and on by default in Kueue, packs a job into the same rack or NVLink block so collectives stay fast.',
  detailed:`
<h4>Why gang semantics matter</h4>
<p>Data-parallel or FSDP training performs all-reduce or reduce-scatter every step. Every rank must participate. Partial allocation therefore has zero value and blocks other jobs. The animation shows two 48-GPU jobs deadlocking a 64-GPU cluster.</p>
<h4>Kueue objects (API <code>kueue.x-k8s.io/v1beta2</code>, Kueue v0.20.x as of Oct 2026)</h4>
${table(['Object','Scope','Role'],[
 ['ResourceFlavor','cluster','A kind of capacity tied to node labels: e.g. h100-on-demand, h100-spot'],
 ['ClusterQueue','cluster','Quota per flavour, fair sharing, preemption rules'],
 ['LocalQueue','namespace','What a team submits to; points at a ClusterQueue'],
 ['Workload','namespace','The admission unit created for a Job/JobSet/TrainJob'],
 ['Cohort','cluster','ClusterQueues that can borrow each other’s unused quota'],
 ['WorkloadPriorityClass','cluster','Priority for ordering and preemption'],
 ['AdmissionCheck','cluster','External gate, e.g. provisioning request for capacity']
])}
${code('yaml',`apiVersion: kueue.x-k8s.io/v1beta2
kind: ClusterQueue
metadata: { name: research }
spec:
  cohort: gpu-shared
  namespaceSelector: {}
  resourceGroups:
  - coveredResources: ["nvidia.com/gpu"]
    flavors:
    - name: h100-on-demand
      resources:
      - name: nvidia.com/gpu
        nominalQuota: 64
        borrowingLimit: 32`)}
${callout('unverified','Check field names against your Kueue version','Kueue is still 0.x and the API moved to v1beta2; field shapes such as cohort references have changed between releases. Validate the YAML with your installed CRDs.')}
<h4>The job layer</h4>
<p>Kueue integrates with batch Jobs, JobSet, Kubeflow Trainer (TrainJob, <code>trainer.kubeflow.org/v1alpha1</code>, still alpha) and others. JobSet expresses “N replicated workers + a leader” with a shared lifecycle, so a failure in one worker can restart the set.</p>
<h4>Topology</h4>
<p>Tensor parallelism wants NVLink inside one node; data parallelism across nodes wants the same rack or network block to reduce hops. Kueue Topology Aware Scheduling uses a Topology object with levels (e.g. block, rack, hostname) from node labels and tries to place a workload’s pods in the lowest common level that fits.</p>
<h4>Capacity integration</h4>
<p>With cloud capacity that arrives all at once (GKE flex-start with queued provisioning, or reserved blocks), an AdmissionCheck waits until the capacity is provisioned before admitting, so pods are not created against nodes that do not exist yet.</p>`,
  diagram:anim('v3q-k8s-gang'),
  followups:[
    {q:'How would you share 128 H100s fairly between research and production fine-tuning?',a:'Two ClusterQueues in one cohort with nominal quotas (e.g. 64/64), borrowing allowed, production at higher WorkloadPriorityClass with preemption of borrowed capacity only. Research uses idle production quota at night but loses it, with checkpointed restarts, when production needs it.'},
    {q:'A job is admitted but some pods never become ready (image pull or node fault). What prevents it holding quota forever?',a:'Kueue’s wait-for-pods-ready behaviour: if all pods are not ready within a timeout, the workload is evicted and requeued with backoff, releasing quota. I also alert on admitted-but-not-running workloads.'},
    {q:'Why not just use the scheduler’s pod priority and preemption instead of Kueue?',a:'Pod priority works per pod, so preemption can kill a few ranks of a large job (destroying it) to place a few pods of another. Kueue reasons about whole workloads and quotas, preempting complete workloads and respecting borrowing rules.'},
    {q:'How does topology-aware placement change step time?',a:'All-reduce time depends on the slowest link. Packing ranks under one switch or NVLink domain reduces hop count and contention. I would measure step time and NCCL bus bandwidth with and without TAS on the same job; the delta justifies stricter placement versus faster admission.'},
    {q:'Where does Slurm still win?',a:'Mature HPC sites with Slurm expertise get gang scheduling, backfill and topology for free. Kubernetes wins when the same platform also serves inference, pipelines and GitOps. Some teams run Slurm-on-Kubernetes bridges; I would choose by the team’s operating model, not fashion.'}
  ],
  tradeoffs:`<ul><li>Strict gang admission increases wait time for large jobs but eliminates deadlock and idle allocation.</li><li>Borrowing improves utilisation but requires preemptible, checkpointed workloads.</li><li>Strict topology improves step time but may delay admission; allow a “preferred” level when queue time matters more.</li></ul>`,
  failures:`<ul><li><b>Large job never admitted</b> → smaller jobs keep fitting first (starvation) → priorities, fair-sharing policy, or reserved windows.</li><li><b>Admitted job slow</b> → ranks spread across racks → enable TAS, check NCCL bus bandwidth.</li><li><b>Quota shows free but pods Pending</b> → quota is logical; nodes missing or tainted → check ResourceFlavor node labels and autoscaler.</li></ul>`,
  vocab:[
   {term:'gang scheduling',def:'Starting all pods of a job together or none, so partial allocations cannot deadlock.'},
   {term:'ClusterQueue',def:'Kueue cluster-scoped pool of quota per ResourceFlavor with fair sharing and preemption policy.'},
   {term:'ResourceFlavor',def:'Kueue description of a capacity type tied to node labels (GPU model, spot/on-demand).'},
   {term:'Topology Aware Scheduling',def:'Kueue feature that places a workload’s pods within a topology level (block, rack, host) to reduce communication cost.'},
   {term:'JobSet',def:'Kubernetes API for a group of jobs (e.g. leader + workers) with a shared lifecycle and failure policy.'},
   {term:'borrowing',def:'A ClusterQueue using unused quota from others in its cohort, reclaimable by preemption.'}
  ],
  mistakes:['Assuming kube-scheduler does gang scheduling by default.','Using ResourceQuota alone: it limits totals but does not queue or admit whole jobs.','Citing Kueue API as v1beta1 — current docs use v1beta2 (as of Oct 2026).','Ignoring topology and then blaming the model for slow steps.'],
  related:['v2-distributed-training','v2-parallelism','v1-k8s-gpu-stack']
},
{
  id:'k8s-04', chapter:'v3-ch-k8s', difficulty:2,
  title:'How would you deploy a vLLM model server on Kubernetes properly?',
  understand:'The interviewer wants production details, not a Deployment with image and port. They listen for weight loading strategy, probes that reflect real readiness, rollout settings that respect scarce GPUs, and the engine flags that matter.',
  short:'I run vLLM as a Deployment on a tainted GPU node pool, requesting whole GPUs in limits and setting tensor parallelism to the GPUs per pod. Weights come from a pinned, checksummed source: a node-local cache or an OCI image volume, which is stable since Kubernetes 1.36, rather than downloading from the internet at start. A startup probe gives the model several minutes to load, readiness checks that the engine can actually serve, and liveness is conservative so a slow load is not killed. I set max model length to what the product needs, keep GPU memory utilisation explicit, use maxSurge zero or one depending on spare GPUs, add a PodDisruptionBudget, and expose /metrics to Prometheus so KEDA can scale on queue depth.',
  detailed:`
<h4>Manifest essentials</h4>
${code('yaml',`containers:
- name: vllm
  image: vllm/vllm-openai:<pinned-digest>
  args: ["--model", "/models/llama-3.1-8b-instruct",
         "--served-model-name", "atlas-chat",
         "--max-model-len", "8192",
         "--gpu-memory-utilization", "0.90",
         "--tensor-parallel-size", "1"]
  resources:
    limits: { nvidia.com/gpu: 1 }
  startupProbe:   { httpGet: { path: /health, port: 8000 }, periodSeconds: 10, failureThreshold: 60 }
  readinessProbe: { httpGet: { path: /health, port: 8000 }, periodSeconds: 5 }
  livenessProbe:  { httpGet: { path: /health, port: 8000 }, periodSeconds: 20, failureThreshold: 6 }`)}
<p>Notes: vLLM’s default <code>--gpu-memory-utilization</code> is 0.92 in current releases; I set it explicitly so behaviour does not change with an upgrade. <code>--max-model-len</code> defaults to the model config (often 128k); capping it protects KV capacity. Images are pinned by digest.</p>
<h4>Weights: the slowest part</h4>
${table(['Source','Pros','Cons'],[
 ['Download from Hugging Face at start','Simple','Slow, rate-limited, supply-chain risk, external dependency at every scale-out'],
 ['Object storage (S3/GCS) → emptyDir','Controlled, auditable','Every pod re-downloads; ≈141 s for 141 GB at 1 GB/s'],
 ['Shared PVC (EFS/Filestore/Lustre)','One copy','Throughput limits under many simultaneous loads'],
 ['Node-local NVMe cache (DaemonSet pre-pull)','Fast restarts','Cache management per node'],
 ['OCI image volume (stable in K8s 1.36)','Weights versioned and pulled like images, read-only mount','Registry size limits; still a pull on a cold node']
])}
<h4>Probes</h4>
<p><code>/health</code> tells you the server process is alive. For readiness I prefer a lightweight synthetic generation (a sidecar or a small readiness script that calls <code>/v1/completions</code> with max_tokens 1) so a pod with a broken engine is never added to the Service. Liveness must not kill a pod that is busy: a saturated engine can answer health slowly.</p>
<h4>Rollouts with scarce GPUs</h4>
<p>With <code>maxSurge: 1, maxUnavailable: 0</code> you need one spare GPU set per step. If none exists, the new pod is Pending forever and the rollout stalls. Options: keep a reserved spare, or use <code>maxSurge: 0, maxUnavailable: 1</code> and accept reduced capacity during the rollout (only if headroom allows). A PodDisruptionBudget stops node drains from evicting too many replicas at once.</p>
<h4>Graceful shutdown</h4>
<p>Set <code>terminationGracePeriodSeconds</code> long enough for in-flight streams (e.g. 60–120 s), and a preStop that removes the pod from load balancing before the engine stops.</p>
<h4>Security</h4>
<p>vLLM’s <code>--api-key</code> protects only the /v1, /v2 and /inference prefixes — /metrics and /health stay open — so put the engine behind the gateway and a NetworkPolicy, never on a public LoadBalancer.</p>`,
  diagram:D('Production vLLM pod on Kubernetes', {w:900,h:330,
   zones:[{x:240,y:20,w:640,h:290,label:'GPU node (tainted, labelled H100)'}],
   boxes:[
    {id:'gw',x:20,y:60,w:180,h:56,label:'AI gateway',sub:'auth, quotas'},
    {id:'svc',x:20,y:190,w:180,h:56,label:'Service',sub:'ready pods only'},
    {id:'pod',x:270,y:60,w:220,h:76,label:'vLLM container',sub:'gpu: 1, max-model-len 8192',cls:'hl'},
    {id:'cache',x:270,y:200,w:220,h:56,label:'Weights volume',sub:'NVMe cache / OCI image'},
    {id:'gpu',x:540,y:60,w:150,h:76,label:'H100 80 GB',cls:'v2'},
    {id:'prom',x:720,y:60,w:140,h:56,label:'Prometheus',sub:'/metrics'},
    {id:'keda',x:720,y:200,w:140,h:56,label:'KEDA',sub:'queue depth'}
   ],
   arrows:[{from:'gw',to:'svc'},{from:'svc',to:'pod'},{from:'cache',to:'pod',label:'read-only'},{from:'pod',to:'gpu'},{from:'pod',to:'prom',fromSide:'top',toSide:'top',cls:'dash',label:'scrape'},{from:'prom',to:'keda'}]
  }, 'Weights come from a controlled local source, probes reflect real serving, metrics feed autoscaling.'),
  followups:[
    {q:'The pod is Running and Ready but the first requests take 20 s. Why?',a:'Readiness only checked /health. The engine may still be compiling or capturing CUDA graphs, or the first request triggered lazy initialisation. Use a readiness check that runs a real generation, and warm the prefix cache with the system prompt.'},
    {q:'How do you serve a 70B model that does not fit one GPU?',a:'Tensor parallelism inside one node (e.g. --tensor-parallel-size 4 or 8 on NVLink), one pod per node holding all GPUs. Cross-node tensor parallelism is slow; use pipeline parallelism or larger-memory GPUs (H200 141 GB) if one node is not enough.'},
    {q:'How do you roll out new weights with no spare GPUs?',a:'Either buy temporary headroom (spare node or reserved capacity for the window), or shift traffic gradually with the gateway and replace one replica at a time with maxUnavailable 1 during low traffic, verifying SLO after each step. If headroom is below one replica, the rollout itself is a capacity risk to raise.'},
    {q:'Would you use KServe or llm-d instead of a raw Deployment?',a:'For one model, a Deployment plus gateway is easiest to reason about. For many models, prefix-aware routing and P/D disaggregation, llm-d (or KServe’s LLMInferenceService, which builds on it but is still alpha API in v0.21) adds an endpoint picker via the Gateway API Inference Extension. I would adopt them when routing intelligence is the bottleneck.'}
  ],
  tradeoffs:`<ul><li>Downloading at start is simple but couples availability to an external hub; local caches add operational work but cut cold start and remove that dependency.</li><li>Strict readiness (real generation) slows rollouts slightly but avoids black-holing traffic.</li><li>High gpu-memory-utilization gives more KV but less room for activation spikes and sidecars.</li></ul>`,
  failures:`${table(['Symptom','Cause','Fix'],[
   ['CrashLoop at start: KV cache too small for max_model_len','Context limit too large for remaining memory','Lower --max-model-len, FP8 KV, or more GPUs'],
   ['Pod killed during load','Liveness probe without startup probe','Add startupProbe with long failureThreshold'],
   ['Rollout stuck at 1 of N','maxSurge needs a GPU that does not exist','Spare capacity or maxSurge 0 / maxUnavailable 1'],
   ['Many pods loading at once saturate storage','Shared PVC or bucket throughput','Stagger, node caches, OCI image volume']
  ])}`,
  vocab:[
   {term:'startup probe',def:'Probe that holds liveness/readiness checks until a slow-starting container has finished initialising.'},
   {term:'image volume',def:'Kubernetes volume that mounts an OCI image or artifact read-only; stable since 1.36; useful for versioned model weights.'},
   {term:'tensor parallelism',def:'Splitting each layer’s matrices across GPUs; needs fast interconnect (NVLink) because it communicates every layer.'},
   {term:'PodDisruptionBudget',def:'Limit on voluntary evictions so drains and upgrades keep a minimum number of replicas.'},
   {term:'gpu-memory-utilization',def:'vLLM fraction of GPU memory it may use; what remains after weights and activations becomes KV blocks (default 0.92 as of Oct 2026).'}
  ],
  mistakes:['Using /health as proof the model can generate.','Pulling weights from the public internet on every scale-out.','Serving the model’s maximum context because the model card allows it.','Exposing the engine directly, assuming --api-key protects /metrics.'],
  related:['v1-k8s-serving','v1-engines','v1-k8s-production']
},
{
  id:'k8s-05', chapter:'v3-ch-k8s', difficulty:2,
  title:'How would you autoscale LLM inference on Kubernetes, and how do you handle cold starts?',
  understand:'Two skills are checked: choosing the right scaling signal for a GPU engine, and understanding that adding capacity takes minutes. The strong answer combines autoscaling with headroom and admission control.',
  short:'CPU-based HPA is the wrong signal: the work is on the GPU and the engine batches internally. I scale with KEDA’s Prometheus scaler on vLLM’s own metrics — mainly requests waiting per replica, with KV-cache usage and TTFT as secondary signals. Then I am honest about time: a new replica needs a GPU node, a multi-gigabyte image, maybe 140 gigabytes of weights and engine warm-up, which can add up to several minutes. So autoscaling follows the trend, while a warm buffer of ready replicas, pre-pulled images, local weight caches and admission control at the gateway absorb bursts. I scale out fast and scale in slowly, and I only use scale-to-zero for internal or batch models where a minutes-long first response is acceptable.',
  detailed:`
<h4>Signals</h4>
${table(['Signal','Meaning','Use'],[
 ['<code>vllm:num_requests_waiting</code>','Requests queued, not yet running','Primary scale-out trigger (per replica)'],
 ['<code>vllm:kv_cache_usage_perc</code> (0–1)','KV memory used','Secondary: sustained > ~0.9 means admission will start queueing'],
 ['<code>vllm:time_to_first_token_seconds</code> p95','User-visible queue + prefill','Guard / SLO alert, too laggy as sole trigger'],
 ['DCGM_FI_DEV_GPU_UTIL','Time any kernel ran','Poor trigger: reads high at moderate load'],
 ['CPU','Tokenisation, HTTP','Not representative']
])}
${code('yaml',`apiVersion: keda.sh/v1alpha1
kind: ScaledObject
spec:
  scaleTargetRef: { name: atlas-chat }
  minReplicaCount: 4
  maxReplicaCount: 40
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown: { stabilizationWindowSeconds: 600 }
  triggers:
  - type: prometheus
    metadata:
      serverAddress: http://prometheus:9090
      query: sum(vllm:num_requests_waiting{model_name="atlas-chat"})
      threshold: "4"          # target waiting requests per replica
      activationThreshold: "1"`)}
<p>KEDA (v2.21 as of Oct 2026) creates an HPA underneath; <code>threshold</code> is the per-replica target for an average-value metric, and <code>activationThreshold</code> (default 0) controls scaling from zero.</p>
<h4>Cold-start budget</h4>
<p>The animation decomposes an illustrative 6–7 minute cold start: node provisioning and GPU stack (≈2–3 min), image pull (≈1 min), weights (141 GB ÷ 1 GB/s ≈ 141 s), warm-up (≈30–60 s). Each phase has its own lever: warm spare nodes or a baked node image; pre-pulled images; node-local or image-volume weights; readiness that waits for warm-up.</p>
<h4>Headroom maths (illustrative)</h4>
${formula(`
STEP 1  traffic can rise 30 % within the 7-minute cold start
STEP 2  current need 20 replicas at target utilisation
STEP 3  warm buffer   = 20 × 0.30 = 6 replicas
STEP 4  cost of buffer = 6 replicas × GPUs per replica × $/GPU-h
ANSWER  keep ≈ 26 warm replicas; autoscale beyond that for slower trends
`)}
<h4>Scale-in</h4>
<p>Scale in slowly (long stabilisation window) because restarting costs minutes and long streams must drain. Use connection draining and a preStop delay.</p>
<h4>Node layer</h4>
<p>Pod autoscaling only creates Pending pods; Karpenter (v1.15 as of Oct 2026, NodePool + EC2NodeClass) or the cluster autoscaler provisions nodes. If GPU capacity is unavailable in the zone, nothing happens — so define fallbacks (other instance types, zones, or a capacity reservation).</p>`,
  diagram:anim('v3q-k8s-coldstart'),
  followups:[
    {q:'Why not use GPU utilisation as the HPA metric?',a:'nvidia-smi/DCGM utilisation is the fraction of time at least one kernel was running. A decode loop keeps it near 100 % even with spare batch capacity, so it saturates early and stops being informative. Queue depth and KV usage measure the actual constraint.'},
    {q:'How do you pick the waiting-requests threshold?',a:'From a load test: find the queue length per replica at which TTFT p95 crosses the SLO, and set the threshold well below it (e.g. half) to leave time for the cold start. Re-test after engine or model changes.'},
    {q:'Scale-to-zero: when is it acceptable?',a:'For internal tools, batch jobs or rarely used LoRA variants where the first request can wait minutes, or where a request can be queued and answered asynchronously. For user-facing chat it breaks the SLO; keep minReplicas ≥ 2 across zones.'},
    {q:'How would you scale disaggregated prefill and decode pools?',a:'Separately: prefill pool on TTFT/queued prompt tokens, decode pool on running sequences/KV usage and TPOT. Frameworks such as Dynamo’s Planner adjust prefill and decode replicas from performance models and traffic prediction; llm-d autoscales via KEDA on endpoint-picker metrics.'},
    {q:'Traffic is predictable (GCC evening peak, Ramadan nights). What do you add?',a:'Scheduled scaling ahead of the forecast (KEDA cron trigger alongside the Prometheus trigger, taking the max), plus capacity reservations for known events, so the cold start happens before the users arrive.'}
  ],
  tradeoffs:`<ul><li>A larger warm buffer costs idle GPU-hours but buys SLO safety during bursts; quantify both in money.</li><li>Aggressive scale-out risks thrash and wasted cold starts; conservative scale-out risks queue growth. Asymmetric behaviour (fast out, slow in) is the usual compromise.</li><li>Scaling on TTFT is user-centric but reacts late; queue depth is early but needs calibration per model.</li></ul>`,
  failures:`<ul><li><b>Desired replicas rise, pods Pending, queue explodes</b> → no GPU capacity in zone → fallback NodePools, reservations, admission control.</li><li><b>Replica count oscillates</b> → short stabilisation, threshold too close to SLO → widen windows, scale on smoothed metric.</li><li><b>Scale-out works but TTFT still bad</b> → bottleneck is the router sending to cold pods or prefill-heavy prompts → cache-aware routing, chunked prefill, check per-pod queues.</li></ul>`,
  vocab:[
   {term:'KEDA ScaledObject',def:'KEDA resource that drives an HPA from external metrics such as a Prometheus query.'},
   {term:'activationThreshold',def:'KEDA value deciding when a scaler is active (scale from zero); separate from the scaling threshold.'},
   {term:'warm pool',def:'Ready replicas or nodes kept idle to absorb bursts faster than cold provisioning.'},
   {term:'stabilisation window',def:'HPA behaviour setting that delays scale-in to avoid thrashing.'},
   {term:'cold start',def:'Time from scale decision to a replica serving at full speed: node, image, weights, warm-up.'}
  ],
  mistakes:['HPA on CPU for a GPU engine.','Treating GPU utilisation as “how full” the GPU is.','Expecting autoscaling to absorb a burst faster than the cold start.','Scale-to-zero for a latency-SLO chat product.'],
  related:['v1-k8s-autoscaling','v2-hyperscale-serving','v1-benchmarking']
},
{
  id:'k8s-06', chapter:'v3-ch-k8s', difficulty:2,
  title:'A GPU node starts throwing Xid errors. How do you detect and handle GPU node failures?',
  understand:'The interviewer checks whether you can tell application faults from hardware faults, use DCGM correctly, and automate remediation safely without draining healthy nodes or killing a large training job unnecessarily.',
  short:'I watch DCGM exporter metrics and the kernel log. The Xid metric is a gauge of the last error code, so I alert on changes and then classify using NVIDIA’s Xid catalog. Codes like 13 or 31 are usually application faults such as illegal memory access, so I restart the workload and keep the node. Xid 94 is a contained memory error where only the offending app restarts. Double-bit ECC (48), uncontained errors (95) or a GPU fallen off the bus (79) mean cordon and drain, then reset, reboot or replace. Automation cordons and labels immediately, but drains of nodes running large training jobs are rate-limited and approved, because one bad GPU already means the job restarts from checkpoint.',
  detailed:`
<h4>Signals</h4>
${table(['Metric / source','What it tells you'],[
 ['<code>DCGM_FI_DEV_XID_ERRORS</code>','Gauge: value of the LAST Xid. Not a count. Alert on change, read history in dmesg.'],
 ['<code>DCGM_FI_DEV_FB_USED</code> / <code>FB_FREE</code>','Framebuffer memory in MiB'],
 ['<code>DCGM_FI_DEV_POWER_USAGE</code>','Power in W; a GPU stuck at idle power during a job is suspicious'],
 ['Kernel log (NVRM: Xid …)','Full sequence with PIDs'],
 ['Device plugin health','Unhealthy devices are removed from allocatable']
])}
<h4>Xid catalog buckets (from NVIDIA’s catalog)</h4>
${table(['Xid','Meaning','Immediate action'],[
 ['13','Graphics engine exception (often app out-of-bounds)','Restart app'],
 ['31','GPU memory page fault (illegal address, usually app bug)','Restart app'],
 ['48','Double-bit ECC error','GPU reset / node reboot needed'],
 ['63','Row-remapping event','Ignore (informational)'],
 ['64','Row-remapping failure','Reset GPU, contact support'],
 ['74','NVLink error','NVLink workflow, contact support'],
 ['79','GPU fallen off the bus','Restart bare metal, contact support'],
 ['94','Contained memory error','Restart only the offending app'],
 ['95','Uncontained memory error','Reset the GPU']
])}
<p>94 and 95 apply to GPUs with error containment, starting with A100.</p>
<h4>Remediation pipeline</h4>
<ol>
<li>Detect: alert on Xid change or device count drop.</li>
<li>Classify: look up the code; app-class → restart workload; hardware-class → node action.</li>
<li>Contain: <code>kubectl cordon</code> and taint the node (e.g. <code>gpu-health=bad:NoSchedule</code>) — safe, reversible, automated.</li>
<li>Drain: evict pods respecting PDBs. For training nodes, coordinate with the job controller so it restarts from checkpoint on healthy nodes.</li>
<li>Repair: GPU reset or reboot; run a diagnostic (DCGM diagnostics) before uncordon.</li>
<li>Replace: for repeat offenders, terminate the instance (cloud) or open a hardware case.</li>
</ol>
<p>Rate-limit disruptive steps (e.g. at most 2 nodes per hour per pool) so a bad driver rollout producing Xids everywhere does not drain the whole fleet.</p>`,
  diagram:anim('v3q-k8s-xid'),
  followups:[
    {q:'Xids appear on every node right after a driver upgrade. What changes?',a:'It is not hardware. Stop remediation automation (blast-radius guard), roll the driver back on the canary pool, and compare with the CUDA/engine version. Correlate with the change event before draining anything.'},
    {q:'How does one bad GPU affect a 256-GPU training job?',a:'Collectives hang or fail on that rank; NCCL times out; the whole job stops. Recovery = cordon the node, restart all ranks from the last checkpoint on healthy capacity (spare node or smaller world size if elastic). Lost work = time since last checkpoint × 256 GPUs.'},
    {q:'What would you automate fully and what needs a human?',a:'Fully: alerting, classification, cordon/taint, ticket creation, evidence capture. Human or policy-gated: drains of nodes running large jobs, reboots in bulk, instance termination when capacity is scarce (you might not get it back).'},
    {q:'How do you catch silent failures that never produce an Xid?',a:'Periodic active checks: DCGM diagnostics during maintenance, NCCL all-reduce bandwidth tests on idle nodes, comparing per-GPU throughput across a job (stragglers), and power/clock anomalies. A GPU that is slow but not failing shows up as a straggler, not as an error.'}
  ],
  tradeoffs:`<ul><li>Aggressive auto-drain reduces time on bad hardware but risks mass disruption from a software cause; rate limits and change correlation are the guardrails.</li><li>Replacing instances quickly restores health but, in scarce GPU markets, you may not get the capacity back; sometimes reset-and-test is better.</li></ul>`,
  failures:`<ul><li><b>Node marked bad repeatedly after reboot</b> → persistent hardware fault → replace, track by serial number.</li><li><b>Inference pod restarts in a loop on one node</b> → Xid 13/31 from a model/engine bug, not hardware → check other nodes for same pattern, roll back engine version.</li><li><b>Alerts flap</b> → alerting on the gauge value rather than change → alert on changes() over a window and on device-count drops.</li></ul>`,
  vocab:[
   {term:'Xid',def:'NVIDIA driver error code written to the kernel log, classified in NVIDIA’s Xid catalog with recommended actions.'},
   {term:'DCGM exporter',def:'Prometheus exporter for NVIDIA Data Center GPU Manager metrics (utilisation, memory, power, Xid, profiling counters).'},
   {term:'double-bit ECC error',def:'Uncorrectable memory error (Xid 48) requiring GPU reset or node reboot.'},
   {term:'cordon',def:'Mark a node unschedulable without evicting running pods.'},
   {term:'straggler',def:'A slow rank or node that delays every synchronous training step.'}
  ],
  mistakes:['Treating the Xid metric as a counter and summing it.','Draining a node for Xid 13 caused by a model bug.','Automating reboots without a fleet-wide rate limit.','Uncordoning after reboot without running diagnostics.'],
  related:['v1-gpu-memory','v2-aiops','v2-distributed-training']
},
{
  id:'k8s-07', chapter:'v3-ch-k8s', difficulty:3,
  title:'How would you recover from a failed distributed training run?',
  understand:'A core reliability question for GPU platforms. The interviewer wants detection, isolation, checkpoint strategy with numbers, a correct restart procedure, and prevention — not “Kubernetes restarts the pod”.',
  short:'First I detect and classify: a crashed rank, an NCCL hang that hits the collective timeout, an out-of-memory, or a hardware Xid. Then I isolate — cordon any bad node so the restart does not land on it again. Recovery is a full-job restart from the latest complete checkpoint, because restarting one rank cannot rejoin an in-progress collective; with torchrun elastic or a JobSet failure policy that restart can be automatic. The checkpoint has to include model, optimiser and scheduler state, data-loader position and random-number state, so the resumed run is equivalent. I choose the checkpoint interval from the cost of writing one and the observed failure rate — Young’s approximation, square root of two times checkpoint cost times mean time between failures — and use sharded, asynchronous checkpoints so they are cheap enough to take often.',
  detailed:`
<h4>1. Detect</h4>
${table(['Failure','How it shows'],[
 ['Process crash (Python exception, CUDA OOM)','Pod exits non-zero; torchrun reports a failed worker'],
 ['NCCL hang','No step progress; NCCL watchdog/collective timeout fires after its timeout'],
 ['Hardware (Xid 48/79/74)','DCGM Xid change, kernel log, device count drop'],
 ['Straggler (slow GPU/link)','Step time rises; one rank consistently last'],
 ['Silent divergence','Loss spike / NaN — needs a training-health alert, not a crash alert']
])}
<p>Alert on “no step completed in N minutes”, not only on pod failure — hangs keep pods Running.</p>
<h4>2. Isolate</h4>
<p>Cordon/taint the faulty node, otherwise the restart lands on it again. Keep a small spare pool so the world size can be restored immediately.</p>
<h4>3. Restart from checkpoint</h4>
<ul>
<li>Restart <b>all ranks</b>: NCCL communicators cannot absorb a replaced rank mid-collective.</li>
<li>torchrun with <code>--max-restarts</code> and a rendezvous backend restarts the worker group; JobSet failure policies restart the set; Kueue requeues if quota is lost.</li>
<li>Load the latest <b>complete</b> checkpoint (write to a temp path, then atomically mark complete; otherwise a crash during save leaves a corrupt latest).</li>
</ul>
<h4>4. What a checkpoint must contain</h4>
<p>Model weights (sharded for FSDP via distributed checkpointing), optimiser state (often 2–3× the weights in size for Adam), LR scheduler, gradient scaler, step counter, data-loader/sampler position, RNG states. Without data position you silently repeat or skip data.</p>
<h4>5. Interval maths</h4>
${formula(`
Young's approximation:   T_opt ≈ √(2 × C × MTBF)

STEP 1  C    = 2 min      blocking time to save one checkpoint (ILLUSTRATIVE)
STEP 2  MTBF = 480 min    observed job-level mean time between failures
STEP 3  T_opt = √(2 × 2 × 480) = √1,920 ≈ 43.8 min
STEP 4  expected lost work per failure ≈ T/2 + restart R
                                       ≈ 21.9 + 10 = 31.9 min
STEP 5  512 GPUs × 31.9/60 h ≈ 272 GPU-hours per failure
STEP 6  at $6.88 per H100-hour (p5.48xlarge on-demand $55.04 ÷ 8,
        us-east-1, AWS price feed 2026-10-12)
        272 × 6.88 ≈ $1,872 per failure
ANSWER  checkpoint ≈ every 45 min; async saves shrink C and allow shorter T
`)}
<p>Job MTBF falls as the job grows: with many nodes, a failure somewhere becomes frequent, so large jobs must checkpoint more often and need cheaper (async, sharded) saves.</p>
<h4>6. Prevent</h4>
<p>Pre-flight checks before admission (NCCL all-reduce test, DCGM diag), TAS placement to avoid flaky links, spare nodes, and a post-incident review of failure classes.</p>`,
  diagram:D('Training failure recovery loop', {w:900,h:320,
   boxes:[
    {id:'run',x:20,y:120,w:150,h:60,label:'Training',sub:'512 GPUs',cls:'ok'},
    {id:'det',x:210,y:30,w:170,h:60,label:'Detect',sub:'no step in 10 min'},
    {id:'iso',x:420,y:30,w:170,h:60,label:'Isolate',sub:'cordon bad node',cls:'warn'},
    {id:'res',x:630,y:30,w:180,h:60,label:'Restart all ranks',sub:'torchrun / JobSet'},
    {id:'ck',x:630,y:210,w:180,h:60,label:'Load checkpoint',sub:'latest COMPLETE',cls:'hl'},
    {id:'st',x:420,y:210,w:170,h:60,label:'Checkpoint store',sub:'sharded, async'},
    {id:'pre',x:210,y:210,w:170,h:60,label:'Pre-flight',sub:'NCCL test, DCGM diag'}
   ],
   arrows:[{from:'run',to:'det',label:'hang/crash'},{from:'det',to:'iso'},{from:'iso',to:'res'},{from:'res',to:'ck'},{from:'st',to:'ck',label:'read'},{from:'run',to:'st',cls:'dash',label:'every T'},{from:'ck',to:'pre',label:'new world'},{from:'pre',to:'run'}]
  }, 'Restart the whole job from the last complete checkpoint, never just the failed pod.'),
  followups:[
    {q:'Why can’t you just replace the one failed rank?',a:'Collective communicators are created for a fixed set of ranks; in-flight all-reduces cannot complete without the dead rank. Elastic frameworks re-form the group, which is a restart of all workers from a checkpoint, possibly at a new world size.'},
    {q:'If you resume with fewer GPUs (elastic), what must change?',a:'Global batch size or gradient-accumulation steps to keep the effective batch; learning-rate schedule consistent with steps; resharding of FSDP state (distributed checkpoint formats support loading into a different sharding). Otherwise convergence changes silently.'},
    {q:'The job restarts but loss jumps. What went wrong?',a:'Likely missing state: optimiser moments not restored, scheduler reset to warm-up, data loader restarted from the beginning, or a partially written checkpoint. Validate checkpoints by loading them in CI and comparing a few steps of loss.'},
    {q:'How would you make checkpoints cheaper?',a:'Sharded saves (each rank writes its shard in parallel), asynchronous checkpointing (copy to CPU memory then write in the background), keeping only the last K, writing to a fast local tier first then uploading, and saving optimiser state less often than weights only if you accept the risk.'},
    {q:'At 4,096 GPUs, what changes in your strategy?',a:'Failures become hourly events. You need automated detection, hot spares, minutes-level checkpointing with async I/O, possibly in-memory checkpoint replication to peers, and continuous straggler detection. Recovery time (R) dominates, so pre-pulled images and fast rendezvous matter as much as checkpoint speed.'}
  ],
  tradeoffs:`<ul><li>Frequent checkpoints reduce lost work but cost I/O time and storage; Young’s formula balances them.</li><li>Spare nodes cost idle money but cut recovery from “wait for capacity” to minutes.</li><li>Elastic training keeps progress with fewer GPUs but complicates reproducibility.</li></ul>`,
  failures:`<ul><li><b>Corrupt latest checkpoint</b> → crash during save → atomic “complete” marker, keep previous K.</li><li><b>Restart lands on same bad node</b> → no cordon → automate taint on hardware Xid.</li><li><b>Job hangs forever</b> → no collective timeout or no progress alert → set NCCL/process-group timeouts and a step-progress alert.</li><li><b>Restart waits hours for GPUs</b> → quota released to others → keep reservation or priority for the resuming job.</li></ul>`,
  vocab:[
   {term:'NCCL timeout',def:'Collective operation timeout after which a hung all-reduce is aborted so the job can fail and restart.'},
   {term:'distributed checkpoint',def:'Sharded save where each rank writes its part, loadable into the same or a different sharding.'},
   {term:'Young’s approximation',def:'Optimal checkpoint interval ≈ √(2 × checkpoint cost × MTBF).'},
   {term:'elastic training',def:'Training that can restart with a different number of workers via rendezvous (e.g. torchrun).'},
   {term:'rendezvous',def:'Process by which workers discover each other and agree on ranks before training starts.'},
   {term:'MTBF',def:'Mean time between failures; for a job it shrinks roughly in proportion to the number of nodes.'}
  ],
  mistakes:['Relying on Kubernetes pod restarts for collective jobs.','Checkpointing only model weights.','Choosing checkpoint frequency by habit (“once a day”) instead of cost and failure rate.','Not detecting hangs because pods stay Running.'],
  related:['v2-distributed-training','v1-training-loop','v2-parallelism']
},
{
  id:'k8s-08', chapter:'v3-ch-k8s', difficulty:1,
  title:'All inference pods are Pending. How do you troubleshoot?',
  understand:'A practical debugging question. The interviewer wants a systematic path from the scheduler’s reason to the root cause, and to see that you know GPU-specific causes as well as generic ones.',
  short:'I start with the scheduler’s own explanation: kubectl describe pod and the events. The message tells me which filter failed — insufficient nvidia.com/gpu, untolerated taint, node affinity mismatch, quota exceeded, or an unbound volume or resource claim. Then I follow that branch. If GPUs are insufficient, I check whether nodes exist at all, whether the device plugin is advertising them, and whether the autoscaler tried and failed — NodePool limits, unavailable instance types or zone capacity. If it is quota, I check ResourceQuota and Kueue admission. Adding replicas does nothing when there are zero eligible nodes; I fix the eligibility or the capacity.',
  detailed:`
<h4>Read the reason first</h4>
${code('bash',`kubectl describe pod atlas-chat-7f9c-abcde | sed -n '/Events/,$p'
kubectl get events -n atlas --sort-by=.lastTimestamp | tail -20
kubectl get nodes -L node.kubernetes.io/instance-type,nvidia.com/gpu.product
kubectl describe node <gpu-node> | grep -A6 Allocat`)}
${table(['Event message (paraphrased)','Branch','Checks'],[
 ['0/12 nodes available: Insufficient nvidia.com/gpu','Capacity / advertisement','Do GPU nodes exist? Allocatable > 0? Device plugin healthy? All GPUs bound?'],
 ['node(s) had untolerated taint','Taints','GPU taint present but pod lacks toleration; or a gpu-health=bad taint from remediation'],
 ['node(s) didn’t match node affinity/selector','Placement rules','Label typo (e.g. product label value), wrong pool'],
 ['exceeded quota','Namespace ResourceQuota','requests.nvidia.com/gpu limit reached'],
 ['Workload not admitted / pod scheduling gated','Kueue','ClusterQueue quota, LocalQueue name, AdmissionCheck pending'],
 ['pod has unbound immediate PersistentVolumeClaims','Storage','PVC pending, zone mismatch with GPU nodes'],
 ['cannot allocate all claims','DRA','ResourceClaim unsatisfiable; DeviceClass selector too strict']
])}
<h4>Autoscaler branch</h4>
<p>If nodes should be created: check Karpenter NodeClaims and logs. Typical causes: NodePool <code>limits</code> on GPUs reached; instance type list too narrow; requested zone has no capacity (insufficient capacity errors from the cloud); EC2NodeClass AMI or subnet wrong. On EKS Auto Mode check the NodePool’s GPU requirements (instance-gpu-name labels).</p>
<h4>Not actually Pending</h4>
<p>Distinguish Pending (unscheduled) from scheduled-but-not-ready: ContainerCreating stuck on a large image pull, Init containers downloading weights, or CrashLoopBackOff on startup. Those have different fixes.</p>
<h4>Decision tree</h4>
<div class="dtree"><ul><li><span class="q">Event says Insufficient nvidia.com/gpu?</span><ul>
<li><span class="a">yes</span>Any GPU nodes? No → autoscaler/NodePool/capacity. Yes → allocatable 0 → device plugin/driver; allocatable > 0 but all bound → genuinely full: admission control, more capacity.</li>
<li><span class="a">no</span>Taint/affinity/quota/PVC/claim message → fix that rule.</li></ul></li></ul></div>`,
  diagram:D('Pending pod triage', {w:900,h:320,
   boxes:[
    {id:'p',x:20,y:130,w:150,h:56,label:'Pods Pending',cls:'bad'},
    {id:'ev',x:210,y:130,w:160,h:56,label:'describe + events',sub:'read the reason',cls:'hl'},
    {id:'cap',x:420,y:20,w:200,h:56,label:'Insufficient GPU',sub:'nodes? plugin? full?'},
    {id:'rule',x:420,y:100,w:200,h:56,label:'Taint / affinity',sub:'labels, tolerations'},
    {id:'quota',x:420,y:180,w:200,h:56,label:'Quota / Kueue',sub:'ResourceQuota, CQ'},
    {id:'pvc',x:420,y:260,w:200,h:50,label:'PVC / DRA claim'},
    {id:'as',x:670,y:20,w:210,h:56,label:'Autoscaler',sub:'NodePool limits, capacity'}
   ],
   arrows:[{from:'p',to:'ev'},{from:'ev',to:'cap'},{from:'ev',to:'rule'},{from:'ev',to:'quota'},{from:'ev',to:'pvc'},{from:'cap',to:'as'}]
  }, 'Every branch starts from the scheduler’s own message.'),
  followups:[
    {q:'Karpenter logs say insufficient capacity for p5.48xlarge in the zone. Options?',a:'Allow more zones or instance types (e.g. p5en, H200 or another family if the model fits), use a capacity reservation or Capacity Block for planned peaks, and protect the service meanwhile with admission control and fallback models.'},
    {q:'Pods were fine yesterday; today all Pending after a node image update. Likely cause?',a:'The new nodes do not advertise GPUs: driver missing or mismatched in the new image, toolkit not configured, or a label change breaking nodeAffinity. Compare a healthy old node with a new one: allocatable, labels, device-plugin logs.'},
    {q:'How do you stop this incident from being user-visible next time?',a:'Alert on Pending GPU pods older than N minutes and on desired-vs-ready replicas, keep minimum replicas on reserved capacity, and run a canary node for image changes before rolling the pool.'}
  ],
  tradeoffs:`<ul><li>Broad instance-type lists improve the chance of getting capacity but create heterogeneous performance; pin model-critical pools, keep flexible pools for batch.</li><li>Reserved capacity removes Pending risk at a fixed cost; on-demand is cheaper until the day it is unavailable.</li></ul>`,
  failures:`<ul><li>Remediation taint left on all nodes after an Xid storm → every pod Pending → audit taints, remove after diagnostics.</li><li>Quota silently reduced by a GitOps change → Kueue no longer admits → check recent commits to queue config.</li><li>PVC bound in zone A, GPUs only in zone B → topology-aware volume binding (WaitForFirstConsumer) or zone-local caches.</li></ul>`,
  vocab:[
   {term:'Pending',def:'Pod phase where the pod is accepted but not scheduled (or containers not yet created).'},
   {term:'taint / toleration',def:'Node marker that repels pods unless they explicitly tolerate it.'},
   {term:'NodePool limits',def:'Karpenter cap on total resources (e.g. GPUs) a NodePool may provision.'},
   {term:'scheduling gate',def:'Field that keeps a pod from being scheduled until removed; used by queueing systems.'}
  ],
  mistakes:['Scaling the Deployment up to “fix” Pending pods.','Restarting the scheduler.','Ignoring the event message and editing YAML randomly.','Confusing ContainerCreating (image/weights pull) with Pending.'],
  related:['v1-k8s-gpu-stack','v1-k8s-production','v3-debugging']
},
{
  id:'k8s-09', chapter:'v3-ch-k8s', difficulty:2,
  title:'A Spot GPU node is reclaimed. What happens, and when would you use Spot for AI workloads?',
  understand:'The interviewer tests whether you understand interruption semantics for inference versus training and can design capacity mixes with the right fallbacks.',
  short:'When a Spot node is reclaimed, the cloud gives a short warning, Karpenter or the node termination handler cordons and drains it, and pods are evicted. For inference, in-flight streams on that node fail unless the gateway retries idempotent requests elsewhere, and the replacement capacity takes minutes to warm. For training, the job stops and restarts from its last checkpoint. So I use Spot where interruption is cheap: batch embedding, offline evaluation, checkpointed training and burst inference above a reliable on-demand or reserved baseline. Latency-SLO serving keeps its baseline on non-Spot capacity, spread across zones, and I cap the Spot fraction to what the service can lose at once.',
  detailed:`
<h4>Sequence on reclaim</h4>
<ol>
<li>Cloud sends an interruption notice (on AWS a two-minute warning for Spot).</li>
<li>Karpenter (interruption handling is one of its disruption mechanisms) cordons and drains; pods get SIGTERM and their grace period.</li>
<li>Inference: preStop removes the pod from the Service; streams in flight either finish within the grace period or are cut.</li>
<li>Replacement: a new node is provisioned — possibly Spot again, possibly unavailable — then image, weights, warm-up.</li>
</ol>
${callout('unverified','Check interruption notice timing per cloud','AWS documents a two-minute Spot interruption notice; GCP Spot VMs have a shorter preemption notice. Confirm current values for your provider before designing grace periods.')}
<h4>Inference vs training</h4>
${table(['','Inference','Training'],[
 ['Unit of loss','In-flight requests (seconds of work)','Work since last checkpoint × all GPUs'],
 ['Recovery','Retry on another replica; capacity gap during warm-up','Full job restart from checkpoint'],
 ['Good Spot use','Burst capacity above baseline; async/batch inference','Checkpointed jobs with frequent async saves'],
 ['Bad Spot use','The only replicas of a latency-SLO service','Jobs without checkpoints; huge gangs (any one reclaim kills all)']
])}
<h4>Capacity mix (illustrative)</h4>
${formula(`
baseline demand          = 20 replicas  → on-demand/reserved, 3 zones
burst above baseline     = up to 10     → Spot, multiple instance types
max simultaneous Spot loss tolerated:
   if 10 Spot replicas vanish, 20 remain → still meets SLO at baseline load
ANSWER  Spot fraction ≤ the capacity you can lose without breaching the SLO
`)}
<p>Diversify across instance types and zones; correlated reclaims hit one pool at once. For large training gangs, a reclaim of any node kills the step, so Spot savings must exceed the lost-work cost computed with the checkpoint interval (see the training recovery question). Alternatives for predictable large jobs: capacity reservations or AWS Capacity Blocks (reserve 1–14 days or multiples of 7 up to 182 days, up to 8 weeks ahead; instances begin terminating 30 minutes before the block ends).</p>`,
  diagram:D('Spot reclaim: inference vs training', {w:900,h:300,
   boxes:[
    {id:'n',x:20,y:120,w:170,h:60,label:'Spot notice',sub:'≈ 2 min on AWS',cls:'warn'},
    {id:'dr',x:230,y:120,w:170,h:60,label:'Cordon + drain',sub:'Karpenter'},
    {id:'inf',x:450,y:40,w:200,h:60,label:'Inference pods',sub:'drain streams, retry'},
    {id:'tr',x:450,y:200,w:200,h:60,label:'Training job',sub:'all ranks stop',cls:'bad'},
    {id:'base',x:700,y:40,w:180,h:60,label:'On-demand baseline',sub:'absorbs traffic',cls:'ok'},
    {id:'ck',x:700,y:200,w:180,h:60,label:'Resume from ckpt',sub:'lost = T since save'}
   ],
   arrows:[{from:'n',to:'dr'},{from:'dr',to:'inf'},{from:'dr',to:'tr'},{from:'inf',to:'base',label:'reroute'},{from:'tr',to:'ck'}]
  }, 'Inference loses seconds of work if a baseline exists; training loses everything since the last checkpoint.'),
  followups:[
    {q:'How do you make streaming responses survive a node loss?',a:'You mostly cannot resume a token stream mid-generation on another replica without the KV state. The gateway can retry from scratch if no tokens were sent yet; after tokens were sent, return a clear error and let the client retry. Keep grace periods long enough to finish most streams.'},
    {q:'Your 64-GPU training job runs on Spot and gets reclaimed twice a day. Is it worth it?',a:'Compute it: lost work per reclaim ≈ (T/2 + restart) × 64 GPUs, times reclaims per day, versus the Spot discount × 64 × 24 h. If the checkpoint interval is 30 min and restart 15 min, loss ≈ 30 min × 64 = 32 GPU-h per reclaim, 64 GPU-h per day; if the discount saves more than 64 GPU-h worth per day, Spot wins — else use reserved capacity.'},
    {q:'What does Karpenter consolidation have to do with this?',a:'Consolidation voluntarily disrupts nodes to save money. For GPU inference pools, consolidation can evict warm replicas and trigger cold starts. Use disruption budgets or do-not-disrupt annotations on serving pods and allow consolidation mainly on batch pools.'}
  ],
  tradeoffs:`<ul><li>Spot saves money but adds interruption risk and cold-start load; value depends on how cheaply each workload restarts.</li><li>Diversifying instance types raises availability but complicates performance predictability.</li><li>Reservations or Capacity Blocks give certainty for planned runs at a fixed cost and no cancellation.</li></ul>`,
  failures:`<ul><li>All Spot replicas reclaimed together → service falls to baseline → if baseline is under-sized, SLO breach; size baseline for peak minus tolerated loss.</li><li>Replacement Spot unavailable → pods Pending → fallback NodePool to on-demand with priority ordering.</li><li>Training restarts lose more than expected → checkpoint interval too long → apply Young’s formula with measured reclaim rate.</li></ul>`,
  vocab:[
   {term:'Spot / preemptible',def:'Discounted cloud capacity that the provider can reclaim with short notice.'},
   {term:'interruption handling',def:'Karpenter mechanism that reacts to cloud interruption notices by cordoning and draining nodes.'},
   {term:'consolidation',def:'Karpenter disruption that replaces or removes under-used nodes to reduce cost.'},
   {term:'Capacity Block',def:'AWS reservation of GPU instances for a future fixed window (1–14 days or multiples of 7, up to 182 days).'}
  ],
  mistakes:['Putting all replicas of a user-facing model on Spot.','Assuming a reclaimed training pod “resumes”.','Ignoring correlated reclaims within one instance type and zone.','Letting consolidation churn warm GPU inference nodes.'],
  related:['v2-finops-optimization','v1-k8s-autoscaling','v2-distributed-training']
},
{
  id:'k8s-10', chapter:'v3-ch-k8s', difficulty:3,
  title:'How do model parallelism choices map onto Kubernetes topology?',
  understand:'This architect question links parallelism (tensor, pipeline, data, expert) to physical interconnects and to placement decisions in Kubernetes. The interviewer wants to hear why cross-node tensor parallelism is slow and how you would place each kind of traffic.',
  short:'Each parallelism type has a communication pattern, and placement should match it to the fastest link available. Tensor parallelism communicates inside every layer, so it belongs inside one node on NVLink — for example 8 GPUs at 900 gigabytes per second each on H100. Pipeline parallelism sends activations between stages only at stage boundaries, so it tolerates crossing nodes over InfiniBand or EFA. Data parallelism all-reduces gradients once per step, so it spans racks, ideally under one network block. In Kubernetes that means one pod per node owning all its GPUs for tensor parallel groups, topology-aware placement with Kueue for multi-node jobs, RDMA networking exposed to pods, and node pools that keep nodes of one job close together.',
  detailed:`
<h4>Communication by parallelism type</h4>
${table(['Type','What is split','Traffic','Best link'],[
 ['Tensor (TP)','Each layer’s matrices','All-reduce / all-gather inside every layer, every token','NVLink/NVSwitch within a node'],
 ['Pipeline (PP)','Layers into stages','Activations between adjacent stages; bubbles','Node-to-node RDMA'],
 ['Data (DP/FSDP)','Batches (FSDP also shards params)','Gradient all-reduce or reduce-scatter per step','Cluster fabric; same block/rack preferred'],
 ['Expert (EP)','MoE experts','All-to-all token routing','High-bandwidth fabric; very sensitive']
])}
<h4>Bandwidth gap (verified specs)</h4>
${formula(`
H100 SXM NVLink           900 GB/s per GPU
p5.48xlarge network       3,200 Gbps = 400 GB/s per NODE (8 GPUs)
                           → ≈ 50 GB/s per GPU across nodes
ratio                     900 ÷ 50 ≈ 18× less bandwidth per GPU off-node
`)}
<p>That ratio is why TP across nodes usually loses: per-layer collectives become network-bound. (Latency also rises.)</p>
<h4>Kubernetes placement</h4>
<ul>
<li><b>TP group = one pod = one node</b>: request all 8 GPUs (<code>nvidia.com/gpu: 8</code>), so the scheduler cannot split them.</li>
<li><b>Multi-node jobs</b>: LeaderWorkerSet or JobSet for groups; Kueue Topology Aware Scheduling (beta, on by default) with node labels for block/rack to keep ranks close.</li>
<li><b>RDMA</b>: EFA on AWS (p5 has 32 EFA interfaces) or InfiniBand via device plugins; GPUDirect RDMA so GPU memory goes to the NIC without CPU copies.</li>
<li><b>Rack-scale NVLink</b> (GB200 NVL72: 72 GPUs in one NVLink domain): the NVIDIA DRA driver’s ComputeDomains — the part of that driver that is officially supported — manage multi-node NVLink/IMEX domains.</li>
</ul>
<h4>Inference example (illustrative)</h4>
<p>Llama-3.1-70B BF16 weights ≈141 GB: TP=2 on H100 gives 70.5 GB of weights per GPU — leaving little KV; TP=4 gives ≈35 GB per GPU and room for KV. Choose TP=4 inside one node, and scale with data-parallel replicas (two TP=4 replicas per 8-GPU node).</p>`,
  diagram:D('Parallelism mapped to links', {w:900,h:330,
   zones:[{x:20,y:20,w:400,h:290,label:'Node A (NVLink domain)'},{x:480,y:20,w:400,h:290,label:'Node B (NVLink domain)'}],
   boxes:[
    {id:'a1',x:40,y:60,w:160,h:56,label:'TP group 1',sub:'GPUs 0–3',cls:'hl'},
    {id:'a2',x:240,y:60,w:160,h:56,label:'TP group 2',sub:'GPUs 4–7',cls:'hl'},
    {id:'b1',x:500,y:60,w:160,h:56,label:'TP group 3',sub:'GPUs 0–3',cls:'hl'},
    {id:'b2',x:700,y:60,w:160,h:56,label:'TP group 4',sub:'GPUs 4–7',cls:'hl'},
    {id:'pa',x:120,y:210,w:200,h:56,label:'PP stage 1',sub:'layers 1–40'},
    {id:'pb',x:580,y:210,w:200,h:56,label:'PP stage 2',sub:'layers 41–80'}
   ],
   arrows:[{from:'a1',to:'a2',both:true,label:'NVLink 900 GB/s'},{from:'b1',to:'b2',both:true,label:'NVLink'},{from:'pa',to:'pb',label:'RDMA ≈ 50 GB/s per GPU'}]
  }, 'Tensor parallel stays on NVLink; pipeline and data parallel cross the network.'),
  followups:[
    {q:'When is TP across two nodes acceptable?',a:'Rarely — when the model cannot fit any other way and latency matters less than fitting, or on rack-scale NVLink systems where the “nodes” share one NVLink domain. Otherwise prefer PP across nodes, bigger-memory GPUs, or quantisation.'},
    {q:'How would you verify the network is not the bottleneck for a training job?',a:'Run NCCL tests (all-reduce bus bandwidth) on the placed nodes, compare with expected fabric numbers, check step-time breakdown with the profiler (communication vs compute overlap), and confirm GPUDirect RDMA is active rather than falling back to TCP sockets.'},
    {q:'MoE expert parallelism: what is special?',a:'All-to-all traffic every MoE layer, with load imbalance if routing is skewed. It needs high bisection bandwidth and is sensitive to stragglers; wide EP is often deployed within rack-scale NVLink domains or with careful placement.'},
    {q:'How do you express “these 4 pods must be in the same rack” in Kubernetes?',a:'Kueue TAS with a required topology level (rack) from node labels, or pod affinity with topologyKey on a rack label. Kueue is better for jobs because it decides at admission for the whole workload.'}
  ],
  tradeoffs:`<ul><li>Higher TP reduces per-GPU memory and per-token latency up to a point, but adds communication; beyond the NVLink domain it usually hurts.</li><li>PP adds pipeline bubbles but tolerates slower links.</li><li>Strict topology placement improves performance but lengthens admission waits.</li></ul>`,
  failures:`<ul><li><b>Step time doubles after rescheduling</b> → ranks landed in different blocks → enforce TAS level.</li><li><b>NCCL falls back to sockets</b> → RDMA device not exposed to pod → check device plugin for EFA/IB, NCCL debug output.</li><li><b>OOM after reducing TP</b> → weights per GPU doubled → recompute memory before changing TP.</li></ul>`,
  vocab:[
   {term:'NVLink',def:'NVIDIA GPU-to-GPU interconnect; 900 GB/s per H100 SXM GPU.'},
   {term:'GPUDirect RDMA',def:'Lets a NIC read/write GPU memory directly, bypassing host memory copies.'},
   {term:'EFA',def:'AWS Elastic Fabric Adapter, an RDMA-capable network interface for HPC/ML instances.'},
   {term:'LeaderWorkerSet',def:'Kubernetes API for groups of pods with a leader and workers, used for multi-node inference.'},
   {term:'pipeline bubble',def:'Idle time in pipeline parallelism while stages wait for micro-batches.'}
  ],
  mistakes:['Saying “more GPUs always lower latency”.','Splitting a TP group across nodes because the scheduler allowed it.','Quoting NVLink and network numbers in the same units without converting Gbps to GB/s.','Ignoring optimizer/activation memory when picking TP for training.'],
  related:['v2-parallelism','v1-multi-gpu-profiling','v2-distributed-inference']
},
{
  id:'k8s-11', chapter:'v3-ch-k8s', difficulty:3,
  title:'Design a multi-tenant GPU platform on Kubernetes for several product and research teams.',
  understand:'An architect-level design question. The interviewer listens for tenancy boundaries, quota and fairness, isolation tiers, cost attribution, and the operating model — not just “one namespace per team”.',
  short:'I design tenancy in layers. Identity and namespaces give each team its own boundary with RBAC, network policies and secrets. Capacity is managed by Kueue: ResourceFlavors for each GPU type and purchase model, a ClusterQueue per team with nominal quota, a cohort so idle quota can be borrowed, and priorities so production can reclaim borrowed GPUs. Isolation comes in tiers: dedicated node pools for production serving and regulated tenants, MIG for small shared workloads, time-slicing only for development. Inference goes through a shared gateway with per-tenant token quotas. Every GPU-hour is labelled with team and workload so we can show back costs, and the platform publishes SLOs and paved-road templates so teams self-serve without filing tickets.',
  detailed:`
<h4>Layers</h4>
${table(['Layer','Mechanism','Purpose'],[
 ['Identity','SSO groups → namespaces, RBAC','Who can deploy what'],
 ['Network','NetworkPolicy default-deny, egress control','Stop lateral movement, data exfiltration'],
 ['Capacity','Kueue: ResourceFlavor, ClusterQueue per team, cohort, WorkloadPriorityClass','Fair share, borrowing, preemption'],
 ['Hard caps','ResourceQuota on requests.nvidia.com/gpu, LimitRange','Guard against runaway requests'],
 ['Isolation tiers','Dedicated pools / MIG / time-slicing','Match trust and latency needs'],
 ['Serving','Shared AI gateway with per-tenant keys, token quotas','Protect shared models from one tenant'],
 ['Cost','Labels → DCGM + kube metrics → showback','Make GPU use visible'],
 ['Paved road','Helm/Argo templates for serve, fine-tune, batch','Self-service with guardrails']
])}
<h4>Quota design (illustrative 128 H100s)</h4>
${formula(`
prod-serving     nominal 64   no borrowing out at peak, priority high
fine-tuning      nominal 32   may borrow up to 32, preemptible
research         nominal 32   may borrow up to 64 at night, preemptible
STEP 1  at 02:00 prod uses 40 → 24 idle GPUs lendable
STEP 2  research borrows 24 → utilisation 128/128
STEP 3  at 08:00 prod demand rises → Kueue preempts borrowed workloads
ANSWER  utilisation stays high; production always gets its nominal quota
`)}
<p>Borrowers must checkpoint, because preemption is expected.</p>
<h4>Showback</h4>
<p>Cost per team = Σ (GPU-hours allocated × rate) + shared overhead split. Track both allocated and actively used GPU time (e.g. from DCGM per-pod attribution) so teams see waste. Charging only on requests rewards over-requesting less than you might think — it is allocated time that blocks others, so allocation is the right base for chargeback, with utilisation as a coaching metric.</p>
<h4>Operating model</h4>
<p>Platform team owns clusters, GPU stack, gateway, queues, templates, SLOs. Product teams own their models, prompts, evals and on-call for their services. Changes to queues and quotas go through GitOps review.</p>`,
  diagram:D('Multi-tenant GPU platform layers', {w:900,h:340,
   boxes:[
    {id:'t1',x:20,y:30,w:150,h:50,label:'Team A ns'},
    {id:'t2',x:20,y:100,w:150,h:50,label:'Team B ns'},
    {id:'t3',x:20,y:170,w:150,h:50,label:'Research ns'},
    {id:'lq',x:220,y:100,w:160,h:56,label:'LocalQueues',sub:'per namespace'},
    {id:'cq',x:430,y:100,w:180,h:56,label:'ClusterQueues',sub:'cohort, borrowing',cls:'hl'},
    {id:'p1',x:670,y:20,w:210,h:50,label:'Dedicated H100 pool',sub:'prod',cls:'ok'},
    {id:'p2',x:670,y:100,w:210,h:50,label:'MIG pool',sub:'small models'},
    {id:'p3',x:670,y:180,w:210,h:50,label:'Spot / batch pool',sub:'preemptible',cls:'warn'},
    {id:'gw',x:220,y:260,w:260,h:56,label:'Shared AI gateway',sub:'per-tenant token quotas'},
    {id:'cost',x:540,y:260,w:240,h:56,label:'Showback',sub:'GPU-h by label'}
   ],
   arrows:[{from:'t1',to:'lq'},{from:'t2',to:'lq'},{from:'t3',to:'lq'},{from:'lq',to:'cq'},{from:'cq',to:'p1'},{from:'cq',to:'p2'},{from:'cq',to:'p3'},{from:'gw',to:'cost',cls:'dash'}]
  }, 'Namespaces give boundaries; Kueue shares capacity; pools give isolation tiers; the gateway and showback close the loop.'),
  followups:[
    {q:'A regulated tenant demands that no other tenant’s code runs on the same hardware. How?',a:'Dedicated node pool with taints only they tolerate, separate namespaces and network policies, possibly a separate cluster or account if the auditor requires it. Document that the control plane is shared unless you give them a separate cluster.'},
    {q:'How do you stop one team from monopolising a shared model behind the gateway?',a:'Per-tenant token-based rate limits and concurrency caps at the gateway, priority classes for requests, and per-tenant dashboards. Token limits matter more than request limits because one request can be 100k tokens.'},
    {q:'Research complains that preemption destroys their jobs. What do you change?',a:'Give them a small non-preemptible nominal quota for long runs, enforce checkpoint frequency for borrowers, and expose expected preemption windows (e.g. production ramps at 07:00). Preemption is a feature; surprise is the problem.'},
    {q:'How would you measure whether the platform is fair and efficient?',a:'Queue wait time per team and per job size, share of nominal quota received, borrowed GPU-hours, preemptions per team, allocated vs active GPU-hours, and cost per team. Review monthly with tenants.'}
  ],
  tradeoffs:`<ul><li>Shared cluster with quotas maximises utilisation; separate clusters maximise isolation and blast-radius control at higher operational cost.</li><li>Borrowing raises utilisation but needs preemption tolerance.</li><li>Showback first, chargeback later: chargeback creates incentives but also arguments about shared costs.</li></ul>`,
  failures:`<ul><li>One team’s runaway job holds all borrowed GPUs → borrowing limits and max job size.</li><li>Gateway quota missing for a new tenant → noisy neighbour on shared model → onboarding template enforces defaults.</li><li>Cost reports disagree with cloud bill → unlabelled pods or idle nodes → include idle capacity as a platform overhead line.</li></ul>`,
  vocab:[
   {term:'nominal quota',def:'The GPU amount a Kueue ClusterQueue is guaranteed.'},
   {term:'borrowing limit',def:'Maximum quota a ClusterQueue may borrow from its cohort.'},
   {term:'showback',def:'Reporting costs to teams without billing them.'},
   {term:'chargeback',def:'Billing internal teams for what they consume.'},
   {term:'paved road',def:'Supported templates and defaults that make the safe path the easy path.'}
  ],
  mistakes:['Equating a namespace with security isolation for GPUs.','Using only ResourceQuota (no queueing, no borrowing).','Rate-limiting by requests instead of tokens at the gateway.','Ignoring idle GPU cost in showback.'],
  related:['v2-platform-architecture','v2-governance','v2-finops-optimization']
}
]);
})();
