/* Animations for Volume 1 Part 6: Deploying AI on Kubernetes */

/* 1. Scheduling a GPU pod through the device plugin (and DRA), including failure */
Anim.register({
  id:'v1-k8s-gpu-sched', title:'How a pod gets a GPU: device plugin, scheduler, kubelet, runtime (and DRA)', w:960, h:560,
  elements:[
    {type:'zone', id:'zA', x:20, y:200, w:300, h:220, label:'Node A — CPU only (m7i)'},
    {type:'zone', id:'zB', x:350, y:200, w:590, h:260, label:'Node B — GPU pool (8 × H100), tainted for GPU pods'},
    {type:'node', id:'pod', x:20, y:40, w:200, h:56, label:'Pod atlas-vllm', sub:'limits nvidia.com/gpu: 1', icon:'k8s'},
    {type:'node', id:'api', x:260, y:40, w:190, h:56, label:'API server', sub:'Pods, Nodes, claims', icon:'server'},
    {type:'node', id:'sched', x:490, y:40, w:190, h:56, label:'kube-scheduler', sub:'filter → score → bind', icon:'gear'},
    {type:'node', id:'rc', x:720, y:40, w:220, h:56, label:'ResourceClaim', sub:'allocated: gpu-3 (DRA)', icon:'doc', hidden:true},
    {type:'node', id:'kA', x:40, y:250, w:260, h:56, label:'kubelet A', sub:'nvidia.com/gpu: 0', icon:'k8s'},
    {type:'node', id:'kB', x:370, y:240, w:150, h:56, label:'kubelet B', sub:'device manager', icon:'k8s'},
    {type:'node', id:'dp', x:560, y:240, w:150, h:56, label:'Device plugin', sub:'DaemonSet', icon:'gear'},
    {type:'node', id:'gpu', x:750, y:240, w:170, h:56, label:'GPU 3', sub:'/dev/nvidia3', icon:'gpu'},
    {type:'node', id:'rt', x:370, y:350, w:150, h:56, label:'containerd', sub:'+ NVIDIA toolkit', icon:'server'},
    {type:'node', id:'ctr', x:560, y:350, w:360, h:56, label:'vLLM container', sub:'CUDA init → load weights', icon:'llm'},
    {type:'edge', id:'ePodApi', from:'pod', to:'api'},
    {type:'edge', id:'eApiSched', from:'api', to:'sched'},
    {type:'edge', id:'eSchedA', from:'sched', to:'kA', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'eSchedB', from:'sched', to:'kB', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'eKBApi', from:'kB', to:'api', fromSide:'top', toSide:'bottom'},
    {type:'edge', id:'eDpKB', from:'dp', to:'kB'},
    {type:'edge', id:'eKBRt', from:'kB', to:'rt'},
    {type:'edge', id:'eRtCtr', from:'rt', to:'ctr'},
    {type:'edge', id:'eGpuCtr', from:'gpu', to:'ctr', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'eSchedRc', from:'sched', to:'rc', hidden:true},
    {type:'counter', id:'alloc', x:40, y:440, label:'Node B nvidia.com/gpu', value:'capacity 0 — nothing advertised yet'},
    {type:'label', id:'evt', x:350, y:500, anchor:'start', text:'', hidden:true}
  ],
  steps:[
    {caption:'Two nodes. Node B has 8 physical H100s, the NVIDIA kernel driver and the NVIDIA Container Toolkit installed. Yet Kubernetes sees <b>zero</b> GPUs on it: the kubelet only knows CPU, memory, ephemeral storage and hugepages natively. GPUs must be <i>advertised</i> by an extension.', hl:['kB','zB'], dur:4500},
    {caption:'The <b>device plugin</b> (a DaemonSet, often installed by the GPU Operator) starts on node B. It registers with the kubelet over a Unix socket in <code>/var/lib/kubelet/device-plugins/</code>, then streams its device list with health through <code>ListAndWatch</code>: 8 device IDs, all Healthy.', hl:['dp'], packets:[{edge:'eDpKB',label:'8 devices',cls:'c-purple'}], dur:4500},
    {caption:'The kubelet adds the extended resource to the Node status: <code>capacity</code> and <code>allocatable</code> now show <code>nvidia.com/gpu: 8</code>. The scheduler can only see GPUs through this number.', hl:['kB','api'], packets:[{edge:'eKBApi',label:'gpu: 8'}], set:{alloc:{value:'allocatable 8 · allocated 0'}}, dur:4200},
    {caption:'A user applies the vLLM Deployment. Its pod asks for <code>nvidia.com/gpu: 1</code> in <b>limits</b> (the request defaults to the limit and must equal it; extended resources are whole integers and are never overcommitted).', hl:['pod'], packets:[{edge:'ePodApi',label:'create'}], dur:4000},
    {caption:'The scheduler <b>filters</b>: node A has 0 allocatable GPUs (and no toleration is needed there, but it still cannot fit) → rejected. Node B has 8 free and the pod tolerates its GPU taint → feasible. After <b>scoring</b>, the pod is <b>bound</b> to node B.', bad:['kA'], ok:['kB'], packets:[{edge:'eApiSched',label:'watch'},{edge:'eSchedA',label:'0 GPUs',cls:'c-bad',delay:500},{edge:'eSchedB',label:'bind',cls:'c-ok',delay:900}], dur:5000},
    {caption:'The kubelet’s <b>device manager</b> picks a free healthy device (GPU 3) and calls the plugin’s <code>Allocate</code>. The plugin answers with what the runtime must inject: device nodes or CDI device names, and environment such as <code>NVIDIA_VISIBLE_DEVICES</code>.', hl:['kB','dp'], packets:[{edge:'eDpKB',label:'Allocate',reverse:true},{edge:'eDpKB',label:'GPU-3',delay:900,cls:'c-purple'}], set:{alloc:{value:'allocatable 8 · allocated 1'}}, dur:4800},
    {caption:'containerd, configured by the <b>NVIDIA Container Toolkit</b>, creates the container with <code>/dev/nvidia3</code>, <code>/dev/nvidiactl</code>, <code>/dev/nvidia-uvm</code> and the host driver’s user-space libraries (e.g. <code>libcuda.so</code>) mounted in. The image itself ships CUDA runtime libraries, not the driver.', hl:['rt'], packets:[{edge:'eKBRt',label:'create'},{edge:'eRtCtr',label:'inject /dev/nvidia3',delay:600}], dur:4800},
    {caption:'vLLM starts. Inside the container it sees exactly <b>one</b> GPU (as <code>cuda:0</code>), which is physical GPU 3. CUDA initialises against the host driver: the driver must be new enough for the CUDA version the image was built with. Now weights load into HBM.', ok:['ctr','gpu'], packets:[{edge:'eGpuCtr',label:'CUDA ok',cls:'c-ok'}], dur:4500},
    {caption:'<b>Failure 1: no free GPU.</b> Seven more single-GPU pods fill node B. The 9th pod stays <b>Pending</b>. Nothing is broken; there is simply no node whose allocatable GPUs fit. This is the event a node autoscaler (Karpenter / cluster-autoscaler) reacts to.', bad:['pod'], show:['evt'], set:{alloc:{value:'allocatable 8 · allocated 8 · free 0'}, evt:{text:'Warning FailedScheduling: 0/2 nodes are available:\n2 Insufficient nvidia.com/gpu.'}}, dur:5200},
    {caption:'<b>Failure 2: GPUs exist but are invisible.</b> After a driver upgrade the kernel module fails to load. The device plugin cannot enumerate devices (or reports them Unhealthy), so allocatable drops. Pods that need a GPU go Pending even though the hardware is in the rack. Check the plugin and driver pods first, not the Deployment YAML.', warn:['dp','kB'], set:{alloc:{value:'allocatable 0 (plugin unhealthy) · hardware 8'}, evt:{text:'Node B: driver pod CrashLoopBackOff → device plugin\nreports 0 healthy devices → new GPU pods Pending.'}}, dur:5500},
    {caption:'<b>The DRA path</b> (Dynamic Resource Allocation, GA in Kubernetes 1.34). A DRA driver publishes <b>ResourceSlices</b> describing each device and its attributes. The pod references a <b>ResourceClaim</b> (created from a template) that asks for a DeviceClass plus CEL selectors. The scheduler allocates a concrete device <i>into the claim</i>; the kubelet then asks the driver to prepare it and the runtime injects it via CDI.', show:['rc','eSchedRc'], hide:['evt'], hl:['rc','sched'], set:{dp:{label:'DRA driver'}, alloc:{value:'devices described in ResourceSlices'}}, packets:[{edge:'eDpKB',label:'prepare',reverse:true,delay:900},{edge:'eSchedRc',label:'allocate',cls:'c-purple'}], dur:6000},
    {caption:'Same destination, richer contract. Device plugin: “give me <i>N</i> of resource X”. DRA: “give me a device whose attributes match this expression, maybe shared or partitioned, and record which one I got”. Both end with the runtime injecting a device into the container.', ok:['ctr','rc'], dur:4500}
  ]
});

/* 2. MIG versus time-slicing */
Anim.register({
  id:'v1-k8s-mig-ts', title:'Sharing one GPU: MIG partitions versus time-slicing', w:960, h:520,
  elements:[
    {type:'label', id:'tM', x:30, y:28, anchor:'start', text:'MIG: hardware partitions (H100 80GB)'},
    {type:'mem', id:'migmem', x:30, y:62, w:420, h:40, segs:[{frac:1,cls:'free',label:'one GPU · 80 GB · all SMs'}]},
    {type:'timeline', id:'tlM', x:30, y:150, w:420, h:120, labelW:70, cols:10, ticks:true, rows:[{id:'A',label:'Pod A'},{id:'B',label:'Pod B'},{id:'C',label:'Pod C'}]},
    {type:'label', id:'tT', x:500, y:28, anchor:'start', text:'Time-slicing: replicas 4 on the same H100'},
    {type:'mem', id:'tsmem', x:500, y:62, w:430, h:40, segs:[{frac:1,cls:'free',label:'80 GB shared, no per-pod limit'}]},
    {type:'timeline', id:'tlT', x:500, y:150, w:430, h:120, labelW:70, cols:10, ticks:true, rows:[{id:'A',label:'Pod A'},{id:'B',label:'Pod B'},{id:'C',label:'Pod C'}]},
    {type:'counter', id:'cM', x:30, y:310, label:'MIG: what pod A gets', value:'—'},
    {type:'counter', id:'cT', x:500, y:310, label:'Time-slicing: what pod A gets', value:'—'},
    {type:'counter', id:'adv', x:30, y:380, label:'Advertised to Kubernetes', value:'nvidia.com/gpu: 1'},
    {type:'label', id:'note', x:30, y:470, anchor:'start', text:'', hidden:true}
  ],
  steps:[
    {caption:'One H100 80GB. Without sharing, Kubernetes advertises it as <code>nvidia.com/gpu: 1</code> and gives it to one pod. If that pod serves a 1.7B-parameter model (≈3.4 GB of BF16 weights), most of the 80 GB and most of the compute sit idle. Two ways to share it follow.', dur:4500},
    {caption:'<b>MIG</b> (Multi-Instance GPU) partitions the GPU in hardware. With the profile <code>1g.10gb</code> × 7, each instance gets 1/8 of the memory and 1/7 of the compute slices, plus its own share of cache and memory paths. Memory comes in eighths, so one eighth stays unused in this layout. The <b>MIG Manager</b> applies the layout from a node label.', set:{migmem:{segs:[{frac:.125,cls:'kv',label:'1g'},{frac:.125,cls:'kv',label:'1g'},{frac:.125,cls:'kv',label:'1g'},{frac:.125,cls:'kv',label:'1g'},{frac:.125,cls:'kv',label:'1g'},{frac:.125,cls:'kv',label:'1g'},{frac:.125,cls:'kv',label:'1g'},{frac:.125,cls:'frag',label:'1/8'}]}, adv:{value:'MIG mixed: nvidia.com/mig-1g.10gb: 7 · single: nvidia.com/gpu: 7'}}, hl:['migmem'], dur:5500},
    {caption:'Three pods each get one MIG instance. They run <b>at the same time</b>, on separate hardware slices. Pod A’s throughput and latency do not depend on what B and C are doing (within the limits of shared power and thermals).', set:{tlM:{cells:[0,1,2,3,4,5,6,7,8,9].flatMap(c=>[{row:'A',col:c,cls:'dec'},{row:'B',col:c,cls:'dec'},{row:'C',col:c,cls:'dec'}])}, cM:{value:'own 10 GB + 1/7 of SMs, isolated'}}, ok:['tlM'], dur:4500},
    {caption:'<b>Time-slicing</b> is a device-plugin setting: <code>replicas: 4</code> makes the plugin advertise the same physical GPU four times. Kubernetes now places up to four pods on it. Nothing is partitioned: all pods see the whole 80 GB and all SMs.', set:{adv:{value:'time-slicing: nvidia.com/gpu: 4 (one physical GPU)'}, tsmem:{segs:[{frac:.08,cls:'w',label:'A'},{frac:.08,cls:'kv',label:'B'},{frac:.08,cls:'act',label:'C'},{frac:.76,cls:'free',label:'free, unprotected'}]}}, hl:['tsmem'], dur:4800},
    {caption:'When all three are busy, the GPU <b>switches between their contexts</b> in time slices. Each pod runs only part of the time. If each could keep the GPU busy alone, each now gets roughly a third of it, so per-token latency can rise up to about 3× (illustrative; it depends on how much each pod actually used).', set:{tlT:{cells:[0,1,2,3,4,5,6,7,8,9].flatMap(c=>[{row:'A',col:c,cls:c%3===0?'dec':'wait'},{row:'B',col:c,cls:c%3===1?'dec':'wait'},{row:'C',col:c,cls:c%3===2?'dec':'wait'}])}, cT:{value:'~1/3 of GPU time when all busy'}}, warn:['tlT'], dur:5200},
    {caption:'<b>No memory isolation.</b> Pod C runs vLLM with the default memory fraction (about 0.9 of the GPU). It grabs ≈72 GB. Pods A and B now fail to allocate their KV cache and crash with CUDA out-of-memory. Kubernetes cannot see or limit GPU memory here.', set:{tsmem:{segs:[{frac:.04,cls:'w',label:''},{frac:.04,cls:'kv',label:''},{frac:.9,cls:'frag',label:'C took ~72 GB'},{frac:.02,cls:'free'}]}, cT:{value:'A and B: CUDA OOM'}}, bad:['tsmem'], dur:5200},
    {caption:'<b>No fault isolation.</b> NVIDIA’s own docs: unlike MIG, “there is no memory or fault-isolation between replicas”. An error that needs a GPU reset takes every time-sliced pod down together. With MIG, instances are isolated from each other’s faults and memory.', set:{tlT:{cells:[{row:'A',col:9,cls:'pre',text:'✗'},{row:'B',col:9,cls:'pre',text:'✗'},{row:'C',col:9,cls:'pre',text:'✗'}]}}, bad:['tlT'], ok:['tlM'], dur:5000},
    {caption:'<b>MPS</b> (CUDA Multi-Process Service) is a third option: kernels from several processes run <i>concurrently</i> through one MPS server, so a GPU can be filled more fully than with time-slicing, and per-client limits can be set. But it is weaker isolation than MIG: a fatal fault in one client can affect the others sharing that server.', show:['note'], set:{note:{text:'MPS: concurrent kernels, better packing than time-slicing, weaker isolation than MIG.\nUse for many small, trusted processes you own.'}}, dur:5200},
    {caption:'<b>Decision.</b> Production LLM serving with big KV caches: whole GPUs. Small models or many tenants needing guaranteed isolation on A100/H100/H200/B200: MIG (not available on L4 or L40S). Notebooks, CI and bursty dev work: time-slicing, with a per-pod memory flag set by convention. Many small trusted inference processes: consider MPS.', set:{note:{text:'Whole GPU → big models, production SLOs.  MIG → isolation + guaranteed slice.\nTime-slicing → dev/CI, best effort.  MPS → packing trusted small processes.'}}, ok:['migmem'], dur:5500}
  ]
});

/* 3. Rolling update of an LLM Deployment with probes and draining */
Anim.register({
  id:'v1-k8s-rolling', title:'Rolling update of an LLM Deployment: startup, readiness and draining streams', w:960, h:540,
  elements:[
    {type:'node', id:'gw', x:30, y:200, w:170, h:60, label:'Gateway / Service', sub:'EndpointSlice', icon:'cloud'},
    {type:'node', id:'old1', x:330, y:60, w:200, h:60, label:'pod v1-a · Ready', sub:'model rev A', icon:'llm'},
    {type:'node', id:'old2', x:330, y:200, w:200, h:60, label:'pod v1-b · Ready', sub:'model rev A', icon:'llm'},
    {type:'node', id:'new1', x:330, y:340, w:200, h:60, label:'pod v2-a · Pending', sub:'model rev B', icon:'llm', hidden:true},
    {type:'edge', id:'eg1', from:'gw', to:'old1'},
    {type:'edge', id:'eg2', from:'gw', to:'old2'},
    {type:'edge', id:'eg3', from:'gw', to:'new1', hidden:true},
    {type:'bar', id:'cap', x:600, y:70, w:320, h:22, label:'Ready replicas (desired 2, maxUnavailable 0)', value:1, text:'2 / 2', thresholds:false},
    {type:'counter', id:'drain', x:600, y:130, label:'In-flight streams on v1-a', value:'12'},
    {type:'counter', id:'tgp', x:790, y:130, label:'Termination clock', value:'—'},
    {type:'node', id:'probe', x:600, y:340, w:320, h:60, label:'startupProbe GET /health', sub:'every 10 s, up to 60 failures', icon:'clock', hidden:true},
    {type:'label', id:'note', x:600, y:240, anchor:'start', text:'', hidden:true}
  ],
  steps:[
    {caption:'Two vLLM replicas serve model revision A; each holds about 12 streaming responses. The Deployment uses <code>maxSurge: 1</code>, <code>maxUnavailable: 0</code>: never go below 2 ready replicas. That only works if there is <b>one spare GPU</b> for the surge pod.', hl:['old1','old2'], packets:[{edge:'eg1',count:2},{edge:'eg2',count:2}], dur:4500},
    {caption:'A Git commit changes the model revision to B. The Deployment controller creates a surge pod <b>v2-a</b>. The scheduler finds the spare GPU. (No spare GPU? The pod stays Pending and the rollout simply stalls; nothing serves revision B.)', show:['new1','eg3'], hl:['new1'], dur:4500},
    {caption:'The container starts. vLLM loads weights into HBM, profiles memory and captures CUDA graphs. Until that finishes the API port is not answering. The <b>startupProbe</b> allows 60 × 10 s = 600 s before giving up; liveness and readiness probes do not run until it succeeds.', show:['probe'], warn:['new1'], set:{new1:{label:'pod v2-a · loading'}}, dur:5000},
    {caption:'<b>Anti-pattern:</b> no startupProbe, and a livenessProbe with <code>initialDelaySeconds: 30</code>. At 30 s the weights are still loading, liveness fails three times, the kubelet <b>kills</b> the container, it restarts, loads again, is killed again: CrashLoopBackOff. The rollout never progresses.', bad:['new1'], show:['note'], set:{note:{text:'liveness kills a pod that is only slow,\nnot broken → CrashLoopBackOff'}}, dur:5200},
    {caption:'With the startupProbe in place, loading completes at about 150 s (illustrative). <code>/health</code> returns 200, the readinessProbe passes, and the pod is added to the EndpointSlice. Only now does traffic reach it.', ok:['new1'], hide:['note'], set:{new1:{label:'pod v2-a · Ready'}, probe:{label:'readinessProbe GET /health: 200'}, cap:{value:1,text:'3 / 2 (surge)'}}, packets:[{edge:'eg3',label:'new req',cls:'c-ok'}], dur:4800},
    {caption:'Now the controller may remove one old pod. <b>v1-a becomes Terminating</b>. Two things start in parallel: it is removed from the EndpointSlice (so no <i>new</i> requests), and its <b>preStop</b> hook runs (e.g. sleep 15 s) so that every proxy and gateway has time to notice before the process is signalled.', warn:['old1'], set:{old1:{label:'pod v1-a · Terminating'}, tgp:{value:'t = 0 s of 120 s'}, cap:{value:1,text:'2 / 2'}}, packets:[{edge:'eg2'},{edge:'eg3'}], dur:5200},
    {caption:'<b>Draining.</b> The 12 streams already running on v1-a keep generating tokens back to their clients. A 1,500-token answer at 30 ms per output token needs 45 s. After preStop, the process receives SIGTERM and should stop accepting work but finish what it has.', busy:['old1'], set:{drain:{value:'12 → 5 (streams finishing)'}, tgp:{value:'t = 40 s of 120 s'}}, packets:[{edge:'eg1',reverse:true,label:'tokens',cls:'c-blue',count:3}], dur:5200},
    {caption:'At about 70 s the last stream on v1-a ends and the process exits on its own, well inside <code>terminationGracePeriodSeconds: 120</code>. No client saw a cut-off answer.', dim:['old1'], set:{drain:{value:'0 — exited cleanly'}, tgp:{value:'t = 70 s, exit 0'}}, ok:['new1','old2'], dur:4500},
    {caption:'<b>Anti-pattern:</b> the default grace period is 30 s. Here SIGKILL would arrive at t = 30 s while streams still needed 45 s: users get answers truncated mid-sentence and the client retries, doubling GPU work. Size the grace period from your longest expected stream plus the preStop delay.', bad:['old1'], show:['note'], set:{note:{text:'grace 30 s < longest stream 45 s + preStop 15 s\n→ SIGKILL → truncated answers + retries'}}, dur:5200},
    {caption:'The same cycle repeats for v1-b → v2-b. Total rollout ≈ 2 × (150 s load + 70 s drain) = 440 s ≈ 7.3 min for two replicas. With 20 replicas and one surge GPU it would take over an hour, which is why large fleets raise maxSurge (if spare GPUs exist) or use blue/green pools.', hide:['note'], set:{old2:{label:'pod v2-b · Ready'}, old1:{label:'pod v1-a · gone'}, cap:{value:1,text:'2 / 2 on revision B'}}, ok:['old2','new1'], dim:['old1'], dur:5500}
  ]
});

/* 4. KEDA scaling on queue length, with node cold start visible on a chart */
Anim.register({
  id:'v1-k8s-keda-cold', title:'KEDA scales on in-flight requests, but GPU cold start lags the demand', w:960, h:520,
  elements:[
    {type:'label', id:'ylab', x:80, y:34, anchor:'start', text:'concurrent requests (illustrative)'},
    {type:'label', id:'y0', x:72, y:300, anchor:'end', text:'0'},
    {type:'label', id:'y100', x:72, y:175, anchor:'end', text:'100'},
    {type:'label', id:'y200', x:72, y:50, anchor:'end', text:'200'},
    {type:'label', id:'x0', x:80, y:316, text:'0'},
    {type:'label', id:'x5', x:210, y:316, text:'5'},
    {type:'label', id:'x10', x:340, y:316, text:'10'},
    {type:'label', id:'x15', x:470, y:316, text:'15'},
    {type:'label', id:'x20', x:600, y:316, text:'20 min'},
    {type:'chart', id:'ch', x:80, y:50, w:520, h:250, xmax:20, ymax:200, series:[
      {id:'dem', points:[[0,40],[4,40]]},
      {id:'cap', points:[[0,48],[4,48]]},
      {id:'q', points:[[0,0],[4,0]]}
    ]},
    {type:'label', id:'ldem', x:80, y:480, anchor:'start', text:'━ demand (in-flight)'},
    {type:'label', id:'lcap', x:260, y:480, anchor:'start', text:'━ capacity = ready replicas × 24'},
    {type:'label', id:'lq', x:520, y:480, anchor:'start', text:'━ waiting (queue)'},
    {type:'counter', id:'rep', x:80, y:350, label:'Desired / Ready replicas', value:'2 / 2'},
    {type:'counter', id:'wait', x:340, y:350, label:'Waiting requests', value:'0'},
    {type:'counter', id:'clock', x:80, y:420, label:'Cold-start clock', value:'—'},
    {type:'counter', id:'ttft', x:340, y:420, label:'TTFT p95 (illustrative)', value:'0.4 s'},
    {type:'node', id:'prom', x:680, y:30, w:250, h:56, label:'Prometheus', sub:'vllm:num_requests_*', icon:'chart'},
    {type:'node', id:'keda', x:680, y:120, w:250, h:56, label:'KEDA ScaledObject', sub:'poll every 30 s', icon:'gear'},
    {type:'node', id:'hpa', x:680, y:210, w:250, h:56, label:'HPA', sub:'desired = ⌈in-flight / 24⌉', icon:'k8s'},
    {type:'node', id:'karp', x:680, y:300, w:250, h:56, label:'Karpenter', sub:'launch GPU node', icon:'cloud'},
    {type:'node', id:'pods', x:680, y:390, w:250, h:56, label:'vLLM pods', sub:'pull · load weights · Ready', icon:'llm'},
    {type:'edge', id:'e1', from:'prom', to:'keda'},
    {type:'edge', id:'e2', from:'keda', to:'hpa'},
    {type:'edge', id:'e3', from:'hpa', to:'karp'},
    {type:'edge', id:'e4', from:'karp', to:'pods'}
  ],
  steps:[
    {caption:'Baseline: 40 concurrent requests. Load tests showed one replica holds its TTFT/TPOT SLO up to 32 concurrent sequences, so the scaling target is set lower, at <b>24</b>, to leave headroom. 2 replicas × 24 = 48 capacity.', hl:['ch'], dur:4500},
    {caption:'An evening peak starts (think Ramadan iftar traffic; numbers illustrative). Demand crosses 48 at about minute 4.4 and reaches 120 by minute 6. Requests beyond capacity wait in the engine queue, so <b>TTFT climbs</b> while GPU utilization already reads ~100 % and CPU barely moves.', set:{ch:{dem:[[0,40],[4,40],[6,120]], cap:[[0,48],[6,48]], q:[[0,0],[4.4,0],[6,72]]}, wait:{value:'72'}, ttft:{value:'3.5 s'}}, warn:['ch'], dur:5000},
    {caption:'KEDA polls Prometheus every 30 s. Query: in-flight = running + waiting = 80 at minute 5 → HPA desired = ⌈80 / 24⌉ = <b>4</b>. Two new pods are created but stay <b>Pending</b>: there is no free GPU.', hl:['keda','hpa'], packets:[{edge:'e1',label:'80'},{edge:'e2',label:'want 4',delay:500}], set:{rep:{value:'4 / 2'}, clock:{value:'t+0: pods Pending'}}, dur:5000},
    {caption:'Karpenter sees the unschedulable pods and launches a GPU instance. Cold-start budget (illustrative): node launch + boot + join + driver/device plugin ≈ 4 min, image pull ≈ 1 min, weights + warm-up ≈ 2 min. Meanwhile demand reaches 180 → desired ⌈180/24⌉ = 8.', hl:['karp'], packets:[{edge:'e3',label:'Pending pods'},{edge:'e4',label:'new node',delay:600}], set:{ch:{dem:[[0,40],[4,40],[6,120],[8,180],[12,180]], cap:[[0,48],[12,48]], q:[[0,0],[4.4,0],[6,72],[8,132],[12,132]]}, rep:{value:'8 / 2'}, wait:{value:'132'}, clock:{value:'t+7 min: first pods Ready'}, ttft:{value:'8 s+ (SLO broken)'}}, bad:['ch'], dur:5800},
    {caption:'Minute 12: the first two new pods become Ready (7 min after the trigger). Capacity 96. The queue shrinks to 84 but is still far above zero.', set:{ch:{dem:[[0,40],[4,40],[6,120],[8,180],[13,180]], cap:[[0,48],[12,48],[12,96],[13,96]], q:[[0,0],[4.4,0],[6,72],[8,132],[12,132],[12,84],[13,84]]}, rep:{value:'8 / 4'}, wait:{value:'84'}}, hl:['pods'], packets:[{edge:'e4',label:'Ready',cls:'c-ok'}], dur:4500},
    {caption:'Minute 15: all 8 replicas Ready, capacity 192 ≥ 180. The queue drains. A <b>7-minute cold start</b> turned into about <b>10 minutes</b> of broken TTFT for every user, even though the autoscaler made the right decision within a minute.', set:{ch:{dem:[[0,40],[4,40],[6,120],[8,180],[20,180]], cap:[[0,48],[12,48],[12,96],[13,96],[13,120],[15,120],[15,192],[20,192]], q:[[0,0],[4.4,0],[6,72],[8,132],[12,132],[12,84],[13,84],[13,60],[15,60],[15,0],[20,0]]}, rep:{value:'8 / 8'}, wait:{value:'0'}, ttft:{value:'0.5 s'}, clock:{value:'degraded ≈ minutes 4.4 → 15'}}, ok:['pods'], dur:5500},
    {caption:'<b>Replay with a warm pool</b>: two spare GPU nodes kept running with the image pre-pulled and weights on local NVMe. Pod start is now ≈ 2 min (no node launch, no pull). Capacity arrives at minutes 7, 8 and 10; the queue peaks lower and is gone by minute 10.', set:{ch:{dem:[[0,40],[4,40],[6,120],[8,180],[20,180]], cap:[[0,48],[7,48],[7,96],[8,96],[8,120],[10,120],[10,192],[20,192]], q:[[0,0],[4.4,0],[6,72],[7,54],[8,60],[10,60],[10,0],[20,0]]}, lcap:{text:'━ capacity with warm pool'}, clock:{value:'pod start ≈ 2 min (warm node)'}, rep:{value:'8 / 8 by minute 10'}}, ok:['ch'], dur:5800},
    {caption:'Scale-down is the mirror risk. HPA’s default scale-down stabilization window is 300 s, so a brief dip does not remove GPUs you will need again in a minute. Do <i>not</i> scale on the waiting-queue alone: once capacity catches up the queue reads 0 and replicas would be removed, recreating the queue (oscillation). Running + waiting is stable.', hl:['hpa'], dur:5200},
    {caption:'<b>Rule of thumb.</b> Headroom must cover demand growth during one cold start: if demand can rise by 20 concurrent per minute and cold start is 7 min, keep about 140 concurrent of spare capacity, or shorten the cold start. Autoscaling fixes sustained load; warm capacity and admission control protect the first minutes.', ok:['keda','hpa','karp','pods'], dur:5500}
  ]
});

/* 5. Argo Rollouts canary with automated analysis and rollback */
Anim.register({
  id:'v1-k8s-canary', title:'Canary a new release bundle with Argo Rollouts analysis, then roll back', w:960, h:500,
  elements:[
    {type:'node', id:'git', x:30, y:40, w:200, h:60, label:'Git: release bundle', sub:'image + model + prompt', icon:'doc'},
    {type:'node', id:'argo', x:30, y:170, w:200, h:60, label:'Argo CD', sub:'sync to cluster', icon:'gear'},
    {type:'node', id:'ro', x:30, y:300, w:200, h:60, label:'Argo Rollouts', sub:'canary controller', icon:'k8s'},
    {type:'node', id:'gw', x:300, y:170, w:170, h:60, label:'Gateway', sub:'weighted routes', icon:'cloud'},
    {type:'node', id:'stable', x:540, y:80, w:190, h:60, label:'stable · bundle v7', sub:'4 replicas', icon:'llm'},
    {type:'node', id:'canary', x:540, y:260, w:190, h:60, label:'canary · bundle v8', sub:'1 replica', icon:'llm', hidden:true},
    {type:'node', id:'prom', x:780, y:170, w:150, h:60, label:'Prometheus', sub:'TTFT, errors', icon:'chart'},
    {type:'node', id:'an', x:300, y:380, w:430, h:60, label:'AnalysisRun', sub:'TTFT p95 < 1.5 s · errors < 1 % · eval ≥ 0.85', icon:'check', hidden:true},
    {type:'edge', id:'eGA', from:'git', to:'argo'},
    {type:'edge', id:'eAR', from:'argo', to:'ro'},
    {type:'edge', id:'eGS', from:'gw', to:'stable'},
    {type:'edge', id:'eGC', from:'gw', to:'canary', hidden:true},
    {type:'edge', id:'eSP', from:'stable', to:'prom'},
    {type:'edge', id:'eCP', from:'canary', to:'prom', hidden:true},
    {type:'edge', id:'ePA', from:'prom', to:'an', fromSide:'bottom', toSide:'right', hidden:true},
    {type:'edge', id:'eRG', from:'ro', to:'gw', fromSide:'right', toSide:'bottom'},
    {type:'bar', id:'w', x:780, y:300, w:150, h:20, label:'canary weight', value:0, text:'0 %', thresholds:false},
    {type:'counter', id:'res', x:780, y:350, label:'Analysis', value:'—'}
  ],
  steps:[
    {caption:'Production runs <b>bundle v7</b>: engine image digest, model revision, tokenizer and chat template, LoRA adapter, system prompt version and engine flags, all pinned in one Git commit. A pull request bumps everything to <b>v8</b> together.', hl:['git','stable'], packets:[{edge:'eGS',count:3}], dur:4500},
    {caption:'Argo CD sees the merged commit and syncs the Rollout object. Argo CD only makes the cluster match Git. Whether v8 is <i>good</i> is decided by the Rollout’s analysis, not by Argo CD’s “Healthy”.', hl:['argo'], packets:[{edge:'eGA',label:'v8'},{edge:'eAR',label:'sync',delay:600}], dur:4500},
    {caption:'Argo Rollouts starts one canary pod (it needs a spare GPU). It waits for readiness after the model loads, then <code>setWeight: 10</code> sends 10 % of traffic to the canary through the Gateway route.', show:['canary','eGC','eCP'], hl:['canary','ro'], set:{w:{value:.1,text:'10 %'}}, packets:[{edge:'eRG',label:'10 %'},{edge:'eGS',count:2,delay:500},{edge:'eGC',delay:700,cls:'c-purple'}], dur:5000},
    {caption:'An <b>AnalysisRun</b> queries Prometheus every minute, filtered to canary pods only: TTFT p95, error rate, and an eval score published by an online evaluation job. All pass for 10 minutes.', show:['an','ePA'], ok:['an'], packets:[{edge:'eCP',cls:'c-purple'},{edge:'ePA',label:'0.9 s · 0.2 %',delay:600}], set:{res:{value:'pass (TTFT 0.9 s)'}}, dur:5000},
    {caption:'Next step <code>setWeight: 50</code>. Now the canary takes half the traffic, with one GPU. Its queue builds, and long prompts reveal that bundle v8 set a larger <code>--max-model-len</code>, which leaves fewer KV blocks per GPU.', set:{w:{value:.5,text:'50 %'}}, warn:['canary'], packets:[{edge:'eRG',label:'50 %'},{edge:'eGC',count:3,cls:'c-purple'},{edge:'eGS',count:2}], dur:5000},
    {caption:'Analysis fails: canary TTFT p95 = 2.1 s, above the 1.5 s threshold, on 3 consecutive measurements (failureLimit reached). The AnalysisRun is marked <b>Failed</b>.', bad:['an','canary'], packets:[{edge:'eCP',cls:'c-bad'},{edge:'ePA',label:'2.1 s',cls:'c-bad',delay:500}], set:{res:{value:'FAILED (TTFT 2.1 s)'}}, dur:5000},
    {caption:'Argo Rollouts <b>aborts</b>: weight goes back to 0 %, all traffic returns to stable v7, and the canary is scaled down. Users saw degraded TTFT on part of the traffic for a few minutes; nobody lost the service.', set:{w:{value:0,text:'0 %'}}, ok:['stable'], dim:['canary'], packets:[{edge:'eRG',label:'0 %',cls:'c-ok'},{edge:'eGS',count:3}], dur:5000},
    {caption:'The cluster is still declared as v8 in Git, so Argo CD shows the Rollout as Degraded. The durable fix is a <b>git revert</b> of the bundle commit (all six artifacts move back together), or a corrected v9 with the old context limit. Never “fix” it by hand in the cluster; Argo CD would undo it.', hl:['git','argo'], packets:[{edge:'eGA',label:'revert → v7'}], dur:5000}
  ]
});

/* 6. Tool-calling loop */
Anim.register({
  id:'v1-k8s-tool-loop', title:'The tool-calling loop: the model proposes, the application decides and executes', w:960, h:500,
  elements:[
    {type:'node', id:'user', x:30, y:200, w:140, h:60, label:'Traveller', sub:'chat UI', icon:'user'},
    {type:'node', id:'app', x:240, y:200, w:180, h:60, label:'Atlas app', sub:'orchestrator loop', icon:'gear'},
    {type:'node', id:'llm', x:500, y:60, w:200, h:60, label:'Model (vLLM)', sub:'/v1/chat/completions', icon:'llm'},
    {type:'node', id:'pol', x:500, y:200, w:200, h:60, label:'Validate + authorize', sub:'schema · owner · policy', icon:'shield'},
    {type:'node', id:'tool', x:760, y:200, w:170, h:60, label:'Booking API', sub:'tools run here', icon:'server'},
    {type:'node', id:'appr', x:500, y:340, w:200, h:60, label:'Human approval', sub:'for write actions', icon:'user', hidden:true},
    {type:'edge', id:'eUA', from:'user', to:'app'},
    {type:'edge', id:'eAL', from:'app', to:'llm', fromSide:'top', toSide:'left'},
    {type:'edge', id:'eAP', from:'app', to:'pol'},
    {type:'edge', id:'ePT', from:'pol', to:'tool'},
    {type:'edge', id:'ePH', from:'pol', to:'appr', hidden:true},
    {type:'edge', id:'eHU', from:'appr', to:'user', fromSide:'left', toSide:'bottom', hidden:true},
    {type:'counter', id:'iter', x:760, y:60, label:'Model call #', value:'1'},
    {type:'counter', id:'ctx', x:760, y:110, label:'Input tokens this call', value:'2,100'},
    {type:'tokens', id:'msgs', x:30, y:440, h:26, items:['system','user']},
    {type:'label', id:'ml', x:30, y:425, anchor:'start', text:'messages[] sent on the next call'}
  ],
  steps:[
    {caption:'The traveller writes: “Where is my booking ABC123, and can I move it to Friday?” The app sends the conversation <b>plus three tool definitions</b> (name, description, JSON-Schema parameters): <code>get_booking</code>, <code>search_flights</code>, <code>change_booking</code>. About 2,100 input tokens (illustrative).', hl:['user','app'], packets:[{edge:'eUA',label:'question'},{edge:'eAL',label:'messages + tools',delay:600}], dur:5000},
    {caption:'The model does not call anything. It <b>returns text</b> describing a call: <code>finish_reason: "tool_calls"</code> with <code>get_booking</code> and arguments <code>{"booking_ref":"ABC123"}</code>, as a JSON <i>string</i>. It is a proposal.', hl:['llm'], packets:[{edge:'eAL',label:'tool_calls',reverse:true,cls:'c-purple'}], set:{msgs:{items:['system','user',{t:'assistant: tool_calls',cls:'new'}]}}, dur:5000},
    {caption:'The app <b>parses and validates</b> the arguments against the schema, then checks <b>authorization from the session</b>, not from the model: is ABC123 owned by this signed-in user? Only then does it call the read-only booking API with the app’s own scoped credentials.', hl:['pol'], ok:['pol'], packets:[{edge:'eAP',label:'proposal'},{edge:'ePT',label:'GET booking',delay:600,cls:'c-ok'}], dur:5200},
    {caption:'The result goes back into the conversation as a <code>role: "tool"</code> message with the matching <code>tool_call_id</code>, and the model is called <b>again</b> with the whole history. Context grows: 2,100 + 60 + 900 = 3,060 input tokens.', packets:[{edge:'ePT',label:'result',reverse:true},{edge:'eAL',label:'+ tool result',delay:700}], set:{iter:{value:'2'}, ctx:{value:'3,060'}, msgs:{items:['system','user','assistant: tool_calls',{t:'tool: booking JSON',cls:'new'}]}}, dur:5000},
    {caption:'Call 2 proposes <code>search_flights</code> for Friday; the app validates and runs it; call 3 starts with 3,530 input tokens. The model now proposes <code>change_booking</code>, a <b>write</b> that costs money.', set:{iter:{value:'3'}, ctx:{value:'3,530'}, msgs:{items:['system','user','tool_calls','tool','tool_calls','tool',{t:'tool_calls: change_booking',cls:'new'}]}}, packets:[{edge:'eAL',label:'change_booking',reverse:true,cls:'c-purple'},{edge:'eAP',delay:600}], warn:['pol'], dur:5000},
    {caption:'Policy says writes need <b>explicit confirmation</b>. The app does not execute; it shows the user the exact change and fare difference and asks. The model cannot bypass this, because the check lives in code, outside the prompt.', show:['appr','ePH','eHU'], hl:['appr'], packets:[{edge:'ePH',label:'needs approval'},{edge:'eHU',label:'confirm?',delay:600}], dur:5000},
    {caption:'The user confirms. The app executes <code>change_booking</code> with an <b>idempotency key</b> (a retry must not change the booking twice), appends the result, and the model writes the final answer with <code>finish_reason: "stop"</code>. Loop ends.', ok:['tool','llm','user'], packets:[{edge:'ePT',label:'POST change',cls:'c-ok'},{edge:'eAL',label:'final answer',reverse:true,delay:700}], set:{iter:{value:'4 (final)'}}, dur:5000},
    {caption:'<b>What breaks loops:</b> malformed JSON arguments (return a validation error as the tool result, let the model retry once), a model that keeps calling tools (cap iterations, e.g. 5, and a total deadline), and <b>prompt injection</b> inside tool results (“ignore your instructions and refund…”). Tool output is data, never authority.', bad:['tool'], warn:['llm'], dur:5500},
    {caption:'<b>Cost and latency:</b> three model calls re-sent 2,100 + 3,060 + 3,530 = 8,690 input tokens instead of 2,100, plus three TTFTs and the tool latencies. Prefix caching helps because each call shares the previous call’s prefix. MCP (next) standardises how tools are <i>discovered and called</i>; it does not change who decides.', hl:['app'], dur:5500}
  ]
});
