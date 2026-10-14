/* Volume 1, Part 6: Deploying AI on Kubernetes (5 lessons) */

/* ---------- 1.6.1 Kubernetes GPU stack ---------- */
registerLesson({
  id:'v1-k8s-gpu-stack', vol:1, part:6, num:1,
  title:'Kubernetes GPU stack: drivers, GPU Operator, device plugins, DRA, MIG and sharing', minutes:85,
  summary:'Kubernetes does not know what a GPU is. A chain of layers makes one usable by a pod: the NVIDIA driver on the host, the container toolkit that injects the device into containers, a device plugin or a Dynamic Resource Allocation driver that advertises it, the kubelet that hands it out and the scheduler that places pods. The NVIDIA GPU Operator installs and upgrades most of these layers. This lesson walks the chain, shows how GPUs can be shared with MIG, time-slicing or MPS and what isolation each gives up, and explains how to run GPU node pools and driver upgrades safely.',
  objectives:[
    'Trace a GPU pod from YAML to a running CUDA process through driver, toolkit, device plugin or DRA driver, kubelet, scheduler and runtime, and name the failure symptom at each layer.',
    'Write correct GPU resource requests (whole integers, requests equal limits) and explain why fractional nvidia.com/gpu is impossible with the device plugin.',
    'Explain what Dynamic Resource Allocation adds (ResourceSlice, DeviceClass, ResourceClaim, CEL selectors) and its maturity as of Oct 2026.',
    'Choose between whole GPUs, MIG, time-slicing and MPS using isolation, utilisation and cost arguments, with MIG profile arithmetic.',
    'Design GPU node pools with taints, labels and a canary-based driver upgrade process.'
  ],
  prereqs:['v1-gpu-architecture','v1-gpu-memory','v1-engines'],
  next:['v1-k8s-serving','v1-k8s-autoscaling','v2-distributed-inference','v2-distributed-training'],
  tags:['kubernetes','gpu','dra','mig','platform'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Think of a GPU node like a building with a special room (the GPU). The building has the room (hardware), a key cutter (the driver), a receptionist who knows how many rooms exist (the device plugin), and a booking desk that assigns rooms to guests (scheduler and kubelet). If any one of them is missing, guests cannot get in, even though the room exists. Now the real mechanism.')}
<p>The <b>Kubernetes GPU stack</b> is the set of layers that turns a physical NVIDIA GPU into something a pod can request in YAML and use from CUDA. From the bottom up:</p>
${table(['Layer','What it is','Who usually installs it'],[
 ['1. Host kernel driver','NVIDIA kernel modules plus user-space driver libraries (<code>libcuda.so</code>, <code>nvidia-smi</code>). Talks to the hardware.','Node image (EKS GPU AMI, GKE COS/Ubuntu with driver install) or the GPU Operator driver container'],
 ['2. NVIDIA Container Toolkit','Hooks into containerd/CRI-O (or generates CDI specs) so a container gets the device files and driver libraries.','Node image or GPU Operator'],
 ['3. Device plugin <i>or</i> DRA driver','Advertises GPUs to the kubelet (device plugin: a count of <code>nvidia.com/gpu</code>; DRA: rich device descriptions in ResourceSlices) and prepares the device at pod start.','GPU Operator / Helm chart / managed platform'],
 ['4. kubelet','Receives the advertisement, updates Node status, allocates specific devices to containers at admission.','Kubernetes'],
 ['5. kube-scheduler','Places pods only on nodes with enough allocatable GPUs (or devices matching a claim).','Kubernetes'],
 ['6. Pod / container','Your image: CUDA runtime libraries, PyTorch, vLLM. It does <b>not</b> contain the kernel driver.','You']
])}
<p>Two extra pieces surround the chain: ${term('GPU Feature Discovery')} labels nodes with GPU model, memory and driver details, and the ${term('DCGM exporter')} exposes GPU health and utilisation metrics. The ${term('GPU Operator')} is a Kubernetes operator that deploys and upgrades layers 1–3 plus these extras as DaemonSets.</p>

<h2>2. Why do we need it?</h2>
<p>Kubernetes natively schedules CPU, memory, ephemeral storage and hugepages. It has no idea a node has eight H100s, which ones are healthy, or which are already used. Without the stack:</p>
<ul>
<li>The scheduler cannot place a GPU pod on the right node, or would double-book the same GPU to two pods.</li>
<li>A container cannot open <code>/dev/nvidia*</code>; CUDA fails with “no CUDA-capable device is detected”.</li>
<li>Nobody notices when a GPU falls off the bus, because nothing reports device health.</li>
<li>Driver versions drift across nodes, and an image built for a newer CUDA fails only on some nodes.</li>
</ul>
<p>The stack gives you <b>exclusive, healthy, correctly-versioned</b> GPUs on demand — the same promise Kubernetes makes for CPU, extended to a device it does not understand.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 The device plugin path, step by step</h3>
${anim('v1-k8s-gpu-sched')}
<ol>
<li><b>Driver and toolkit ready.</b> The kernel module is loaded; <code>nvidia-smi</code> works on the host; the runtime is configured for NVIDIA devices.</li>
<li><b>Registration.</b> The device plugin (a DaemonSet pod) connects to the kubelet over a Unix socket under <code>/var/lib/kubelet/device-plugins/</code>, registers the resource name <code>nvidia.com/gpu</code>, then keeps a <code>ListAndWatch</code> gRPC stream open, sending device IDs and health.</li>
<li><b>Advertisement.</b> The kubelet writes <code>capacity</code> and <code>allocatable</code> for <code>nvidia.com/gpu</code> into Node status.</li>
<li><b>Scheduling.</b> A pod with <code>nvidia.com/gpu: 1</code> passes the scheduler’s resource filter only on nodes where allocatable minus already-allocated ≥ 1, and only if it tolerates the node’s taints and matches its affinity.</li>
<li><b>Allocation.</b> On the chosen node the kubelet’s device manager selects specific free devices and calls the plugin’s <code>Allocate</code>, which returns device nodes, mounts, environment variables and/or CDI device names.</li>
<li><b>Container start.</b> The runtime creates the container with those devices and the host’s driver libraries. CUDA initialises; the container sees only its allocated GPUs, renumbered from 0.</li>
</ol>

<h3>3.2 Extended-resource rules you must get right</h3>
<p>To Kubernetes, <code>nvidia.com/gpu</code> is an ${term('extended resource')}. The Kubernetes docs are explicit (verified Oct 2026): GPUs are specified in <code>limits</code>; you may also set <code>requests</code>, but then the two values must be equal; you cannot set a request without a limit. Extended resources “cannot be overcommitted”. Quantities are whole integers.</p>
${code('yaml',`resources:
  limits:
    nvidia.com/gpu: 1        # correct: request defaults to the same value
    cpu: "8"
    memory: 48Gi
  requests:
    cpu: "4"                 # CPU/memory may differ between request and limit
    memory: 48Gi
# WRONG: nvidia.com/gpu: 0.5          -> rejected, must be a whole number
# WRONG: requests 1, limits 2 for GPU  -> rejected, must be equal`)}
${callout('warn','A GPU request is not a VRAM limit','With the plain device plugin, a pod gets the <i>whole</i> device exclusively, so memory is “limited” only by the card itself. Kubernetes memory requests/limits are host RAM and never see HBM. The only Kubernetes-visible way to bound GPU memory per pod is a hardware partition (MIG) or a DRA driver that models capacity. With time-slicing, nothing stops one pod from taking all the HBM.')}

<h3>3.3 GPU Feature Discovery labels</h3>
<p>GPU Feature Discovery (GFD) runs on each GPU node and adds labels such as <code>nvidia.com/gpu.product</code> (e.g. <code>NVIDIA-H100-80GB-HBM3</code>), <code>nvidia.com/gpu.memory</code> (in MiB), <code>nvidia.com/gpu.count</code>, <code>nvidia.com/mig.capable</code>, and, when sharing is configured, <code>nvidia.com/gpu.replicas</code>. You use them in <code>nodeSelector</code> or node affinity to pin a model to the GPU type it was benchmarked on.</p>
${callout('unverified','Check label names on your cluster','GFD label names have changed between versions (for example the CUDA driver version labels). Before writing selectors, run <code>kubectl get node &lt;gpu-node&gt; -o jsonpath="{.metadata.labels}"</code> and copy what is actually there. Managed platforms add their own labels too (EKS Auto Mode: <code>eks.amazonaws.com/instance-gpu-name</code>, verified).')}

<h3>3.4 The NVIDIA GPU Operator</h3>
<p>The operator watches a <code>ClusterPolicy</code> custom resource and deploys, per GPU node, the components NVIDIA lists on its overview page (verified Oct 2026, operator line <b>26.7.x</b>, CalVer YY.M.patch):</p>
${table(['Component','Job'],[
 ['NVIDIA driver (containerized)','Builds/loads the kernel driver from a container, so the node image does not need it. Optional: disable if your AMI already has a driver.'],
 ['NVIDIA Container Toolkit','Configures the container runtime for GPU injection.'],
 ['Kubernetes device plugin','Advertises <code>nvidia.com/gpu</code> (or MIG resources) and handles time-slicing/MPS sharing config.'],
 ['GPU Feature Discovery','Node labels for model, memory, MIG capability, sharing.'],
 ['DCGM Exporter','Prometheus metrics: utilisation, memory, power, XID errors, profiling counters.'],
 ['MIG Manager','Applies MIG layouts chosen by a node label, draining GPU pods first.'],
 ['Validator','Runs CUDA/plugin validation pods; other components wait for it.'],
 ['Driver Manager','Handles driver upgrades: cordon, evict GPU pods, reload driver.'],
 ['Others','vGPU and KubeVirt device plugins, GDS and GDRCopy drivers, Confidential Computing manager — for specialised setups.']
])}
<p>Components start in dependency order: driver → toolkit → validator → device plugin → GFD/DCGM. That ordering is why a broken driver shows up as a stuck device plugin pod in <code>Init</code>.</p>
${callout('devops','DevOps bridge','The GPU Operator is like a CNI plugin or the EBS CSI driver: node-level infrastructure delivered as DaemonSets and owned by the platform team. It does not choose model precision, tune the KV cache or check model quality. On EKS Auto Mode the drivers and device plugin are built in (“runs automatically and isn’t visible as a daemon set”), so you would not install the operator’s driver or plugin there.')}

<h3>3.5 Dynamic Resource Allocation (DRA)</h3>
<p>The device plugin API can only say “node has N of resource X”. It cannot express “a GPU with at least 80 GB on the same NVLink domain as my other GPU”, cannot share a device between pods in a modelled way, and the scheduler never learns <i>which</i> device a pod got. ${term('Dynamic Resource Allocation')} (DRA) replaces the counter with structured descriptions.</p>
${table(['DRA object (resource.k8s.io/v1)','Created by','Meaning'],[
 ['<b>ResourceSlice</b>','The DRA driver on each node','List of devices on that node with attributes (product, memory, driver version, topology) and capacities.'],
 ['<b>DeviceClass</b>','Admin or driver install','A named category, e.g. <code>gpu.nvidia.com</code>, with default selectors/config.'],
 ['<b>ResourceClaim</b>','User (or generated from a template)','“I need devices of this class matching these CEL expressions.” After scheduling, its status records exactly which device was allocated.'],
 ['<b>ResourceClaimTemplate</b>','User','Generates one ResourceClaim per pod, like a volumeClaimTemplate.']
])}
${code('yaml',`apiVersion: resource.k8s.io/v1
kind: ResourceClaimTemplate
metadata: { name: one-big-gpu, namespace: atlas }
spec:
  spec:
    devices:
      requests:
      - name: gpu
        exactly:
          deviceClassName: gpu.nvidia.com
          count: 1
          selectors:
          - cel:
              # attribute names come from the driver's ResourceSlices
              expression: device.capacity["gpu.nvidia.com"].memory.compareTo(quantity("80Gi")) >= 0
---
# in the Pod spec
spec:
  resourceClaims:
  - name: gpu
    resourceClaimTemplateName: one-big-gpu
  containers:
  - name: vllm
    resources:
      claims:
      - name: gpu`)}
<p><b>Maturity (as of Oct 2026, verified):</b> DRA core graduated to GA in Kubernetes <b>1.34</b>, and its feature gate is locked on from 1.35; the API is <code>resource.k8s.io/v1</code>. Latest stable Kubernetes is 1.37. Sub-features mature separately: prioritized alternatives (beta 1.34), partitionable devices, device taints and consumable capacity (beta 1.36), and “extended resource” mapping that lets a classic <code>nvidia.com/gpu</code> request be satisfied by a DRA driver (alpha 1.34 → beta 1.36). The NVIDIA DRA driver (now <code>kubernetes-sigs/dra-driver-nvidia-gpu</code>, v0.5.1) officially supports <b>ComputeDomains</b> (multi-node NVLink/IMEX on GB200-class systems); its README says plain GPU allocation “can be tried out” but is “not yet officially supported”, and the GPU kubelet plugin is disabled by default in the chart.</p>
${callout('tip','What this means in practice','For single-node GPU inference in 2026 the device plugin is still the production default. Learn DRA now because it is the direction of travel (sharing, partitioning, topology-aware multi-node), and because GB200 NVL72 multi-node NVLink already needs it. Mark DRA GPU allocation as <b>emerging</b>, the DRA API itself as <b>GA</b>.')}
${callout('unverified','CEL attribute names','The selector expression above uses a capacity named <code>memory</code> under the <code>gpu.nvidia.com</code> domain. Exact attribute names are published by the driver; read them with <code>kubectl get resourceslices -o yaml</code> before relying on them.')}

<h3>3.6 Sharing a GPU: MIG, time-slicing and MPS</h3>
${anim('v1-k8s-mig-ts')}
<p>${term('MIG')} (Multi-Instance GPU) cuts a supported GPU into hardware instances, each with dedicated memory and compute slices. Supported (NVIDIA list, Oct 2026): A100, A30 (4 instances), H100, H200, H20, GH200, B200, GB200, GB300 and RTX PRO 6000 Blackwell (4). <b>L4, L40S and T4 do not support MIG.</b></p>
${table(['H100 80GB profile','Instances per GPU','Memory share','Compute share'],[
 ['1g.10gb','7','1/8','1/7'],
 ['1g.20gb','4','2/8','1/7'],
 ['2g.20gb','3','2/8','2/7'],
 ['3g.40gb','2','4/8','3/7'],
 ['4g.40gb','1','4/8','4/7'],
 ['7g.80gb','1','8/8','7/7']
])}
<p>Note the asymmetry: memory comes in <b>eighths</b>, compute in <b>sevenths</b>, and 3g.40gb and 4g.40gb get the same memory. Profiles can be mixed on one GPU within placement rules, for example one 4g.40gb plus one 3g.40gb.</p>
<p><b>MIG strategies</b> in the device plugin: <code>single</code> (all instances on a node are the same profile and are advertised as plain <code>nvidia.com/gpu</code>, so existing YAML works) and <code>mixed</code> (each profile is its own resource, e.g. <code>nvidia.com/mig-1g.10gb: 1</code>). The MIG Manager applies a named layout when you set a node label such as <code>nvidia.com/mig.config=all-1g.10gb</code>; it must evict GPU pods on that GPU first, so re-partitioning is a maintenance operation, not a per-request action.</p>
<p>${term('Time-slicing')} is a device-plugin configuration that advertises each GPU several times:</p>
${code('yaml',`# device plugin config (ConfigMap referenced by the GPU Operator ClusterPolicy)
version: v1
sharing:
  timeSlicing:
    resources:
    - name: nvidia.com/gpu
      replicas: 4          # node with 1 GPU now advertises nvidia.com/gpu: 4`)}
<p>NVIDIA’s documentation states the trade-off directly: “Unlike Multi-Instance GPU (MIG), there is no memory or fault-isolation between replicas.” The GPU switches between processes’ contexts; each gets a share of time; memory is first-come, first-served.</p>
<p>${term('MPS')} (CUDA Multi-Process Service) lets kernels from different processes run concurrently through a shared server, packing small workloads better than time-slicing, with optional per-client limits; a fatal error in one client can affect others on the same MPS server. Newer device-plugin versions can expose MPS sharing too.</p>
${callout('unverified','Verify MPS support details','MPS sharing support and its memory/thread-percentage limits depend on your device-plugin and driver versions; check the device plugin README for your pinned version before designing around it.')}
${table(['Option','Memory isolation','Fault isolation','Performance isolation','Typical use'],[
 ['Whole GPU','Yes (exclusive)','Yes','Yes','Production LLM serving, training'],
 ['MIG','Yes (hardware)','Yes, per instance','Strong (dedicated slices)','Small models, multi-tenant inference, notebooks needing guarantees'],
 ['MPS','Partial (limits possible)','Weak (shared server)','Partial (concurrent)','Many small trusted inference processes'],
 ['Time-slicing','<b>None</b>','<b>None</b>','None (contention)','Dev, CI, demos, bursty low-priority work']
])}

<h3>3.7 Node pools, taints and tolerations</h3>
<p>GPU nodes are expensive, so keep non-GPU pods off them with a taint, e.g. <code>nvidia.com/gpu=present:NoSchedule</code>. GPU pods add the matching toleration. Kubernetes has an admission plugin, <code>ExtendedResourceToleration</code>, that automatically adds a toleration for taints whose key equals an extended resource name the pod requests, which saves boilerplate when enabled (managed clusters differ — check). Separate pools by purpose and hardware:</p>
<ul>
<li><b>serving-h100</b>: on-demand/reserved, taint <code>workload=serving</code>, latency-critical replicas.</li>
<li><b>batch-h100-spot</b>: interruptible, for evals, embeddings backfills, training with checkpoints.</li>
<li><b>small-l4</b>: cheap single-GPU nodes for small models, rerankers, embedding models.</li>
<li><b>dev-mig</b>: MIG-partitioned A100/H100 for notebooks and CI.</li>
</ul>

<h2>4. Where does it fit?</h2>
${fig('The GPU stack on one node, and who owns each layer', svgDiagram({w:900,h:380,
 zones:[{x:20,y:20,w:560,h:340,label:'GPU node'},{x:600,y:20,w:280,h:340,label:'Control plane',cls:'ok'}],
 boxes:[
  {id:'hw',x:40,y:290,w:520,h:50,label:'8 × H100 (PCIe / NVLink)',sub:'hardware',cls:'v2'},
  {id:'drv',x:40,y:225,w:250,h:50,label:'NVIDIA driver',sub:'kernel module + libcuda'},
  {id:'tk',x:310,y:225,w:250,h:50,label:'Container Toolkit',sub:'runtime hook / CDI'},
  {id:'dp',x:40,y:150,w:250,h:56,label:'Device plugin / DRA driver',sub:'advertise + prepare',cls:'hl'},
  {id:'kl',x:310,y:150,w:250,h:56,label:'kubelet + containerd',sub:'allocate, start containers'},
  {id:'gfd',x:40,y:60,w:160,h:56,label:'GFD',sub:'node labels'},
  {id:'dcgm',x:220,y:60,w:160,h:56,label:'DCGM exporter',sub:'metrics'},
  {id:'pod',x:400,y:60,w:160,h:56,label:'vLLM pod',sub:'CUDA runtime',cls:'ok'},
  {id:'api',x:630,y:60,w:220,h:56,label:'API server',sub:'Node status, claims'},
  {id:'sch',x:630,y:160,w:220,h:56,label:'kube-scheduler',sub:'filter by GPUs/claims'},
  {id:'ops',x:630,y:270,w:220,h:56,label:'GPU Operator',sub:'ClusterPolicy reconcile',cls:'hl'}
 ],
 arrows:[{from:'dp',to:'kl',label:'register'},{from:'kl',to:'api',label:'node status'},{from:'api',to:'sch',fromSide:'bottom',toSide:'top'},{from:'kl',to:'pod',fromSide:'top',toSide:'bottom'},{from:'ops',to:'tk',cls:'dash',label:'installs'},{from:'drv',to:'hw',fromSide:'bottom',toSide:'top'}]
}), 'Platform team owns everything inside the node box except the vLLM pod. The scheduler only sees what the device plugin or DRA driver publishes.')}
<p>Above this lesson sits ${L('v1-k8s-serving','model serving')} (Deployments, probes, weights), then ${L('v1-k8s-autoscaling','autoscaling')} and ${L('v1-k8s-production','production hardening')}. Below it sits the hardware you studied in ${L('v1-gpu-architecture','GPU architecture')} and ${L('v1-multi-gpu-profiling','multi-GPU interconnects')}.</p>

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Node autoscaling</b> (Karpenter, cluster-autoscaler) reacts to pods Pending on <code>Insufficient nvidia.com/gpu</code>; it needs to know which instance types provide GPUs (${L('v1-k8s-autoscaling','autoscaling lesson')}).</li>
<li><b>Monitoring</b>: DCGM exporter metrics feed Grafana and alerts (XID errors, memory used in MiB, power).</li>
<li><b>Batch scheduling</b>: Kueue (v0.20, API <code>kueue.x-k8s.io/v1beta2</code>) adds quotas, fair sharing and gang admission on top of the same GPU resources (${L('v2-distributed-training','distributed training')}).</li>
<li><b>Multi-node inference</b>: tensor/pipeline parallel across nodes needs topology (same NVLink domain, same rack, EFA/InfiniBand), which is where DRA ComputeDomains and topology-aware scheduling matter (${L('v2-distributed-inference','distributed inference')}).</li>
<li><b>Cost</b>: OpenCost can allocate GPU cost per pod using GPU allocation × node GPU hourly cost (${L('v2-finops-unit-economics','AI FinOps')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Responsibility','Concrete decisions'],[
 ['Driver/CUDA compatibility matrix','Pin driver branch per node pool; record which image CUDA versions it supports; block images that need a newer driver.'],
 ['Operator configuration','Which components the operator owns vs the AMI (driver preinstalled? toolkit?); ClusterPolicy in Git.'],
 ['Pool design','GPU types, on-demand vs spot vs capacity reservations, taints, labels, max nodes per pool.'],
 ['Sharing policy','Which pools use MIG (which layout), time-slicing (dev only), or whole GPUs.'],
 ['Health','Alerts on XID errors, GPU missing from allocatable, DCGM exporter down, ECC errors; automated cordon of bad nodes.'],
 ['Upgrades','Driver, operator, Kubernetes and node image upgrades via canary pools.']
])}
<h3>Driver upgrade canary</h3>
<ol>
<li>Read the compatibility matrix: new driver branch vs your CUDA images, Kubernetes version and operator version.</li>
<li>Create a <b>canary node pool</b> (or label one node) with the new driver; on AMI-based clusters this is a new node group/NodePool with the new AMI.</li>
<li>Run validation: operator validator pods, a CUDA sample, then a real vLLM smoke test and a short benchmark comparing TTFT/TPOT with the old pool.</li>
<li>Route a small share of production traffic (one replica) to the canary pool for a day; watch XID errors and latency.</li>
<li>Roll the rest gradually with a <code>maxUnavailable</code>-style limit and a PodDisruptionBudget on serving Deployments. The operator’s driver upgrade policy can cordon/drain nodes in limited parallelism; confirm the exact <code>upgradePolicy</code> fields for your operator version.</li>
<li>Keep the old AMI/driver version available to roll back by re-creating nodes, not by downgrading in place.</li>
</ol>

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely layer','Evidence','Fix'],[
 ['Pod Pending: <code>Insufficient nvidia.com/gpu</code>','No free GPUs, or plugin advertises 0','<code>kubectl describe node</code> → Allocatable/Allocated; plugin pod status','Scale node pool; fix plugin/driver; check quotas'],
 ['Pod Pending: <code>untolerated taint</code>','Pod lacks toleration for the GPU pool','Scheduler event text','Add toleration (or enable ExtendedResourceToleration)'],
 ['Pod Pending but GPUs free, with node affinity on product label','Label mismatch (product name string)','Node labels vs selector','Fix selector; copy label values from the node'],
 ['Container starts, CUDA error “driver version is insufficient”','Image CUDA newer than host driver','<code>nvidia-smi</code> on host vs image CUDA version','Upgrade driver (canary) or use an older image'],
 ['“no CUDA-capable device is detected”','Runtime did not inject devices','Container has no <code>/dev/nvidia*</code>; toolkit/runtime config; pod requested no GPU','Request <code>nvidia.com/gpu</code>; fix toolkit/runtimeClass'],
 ['Allocatable GPUs drop from 8 to 7','One GPU unhealthy (e.g. Xid 79 fallen off the bus, Xid 48 double-bit ECC)','DCGM <code>DCGM_FI_DEV_XID_ERRORS</code> (gauge of last XID), <code>dmesg</code>','Drain node, reset GPU or replace hardware'],
 ['Time-sliced pods randomly OOM','No memory isolation','<code>nvidia-smi</code> shows one process holding most memory','Set per-engine memory fraction; use MIG for isolation'],
 ['All GPU pods stuck after operator upgrade','Driver container failed to build/load (kernel mismatch)','Driver pod logs; validator Init state','Roll back node image or operator version on canary first']
])}
<div class="dtree"><ul><li><span class="q">GPU pod not running — where is it stuck?</span><ul>
<li><span class="a">Pending</span>Read the FailedScheduling event: insufficient GPUs → capacity or plugin; taint → toleration; affinity → labels.</li>
<li><span class="a">ContainerCreating</span>Runtime/toolkit or DRA prepare failed → kubelet events, toolkit config.</li>
<li><span class="a">Running but crashing</span>CUDA init error → driver/CUDA mismatch; OOM → model too big for GPU or MIG slice.</li>
<li><span class="a">Running, slow</span>Shared GPU (time-slicing contention), wrong GPU type, thermal/power throttling → DCGM metrics.</li>
</ul></li></ul></div>
${code('bash',`kubectl describe pod atlas-vllm-0 | sed -n '/Events/,$p'
kubectl get node gpu-node-1 -o jsonpath='{.status.allocatable}'
kubectl -n gpu-operator get pods -o wide            # driver, toolkit, plugin, validator
kubectl -n gpu-operator logs ds/nvidia-device-plugin-daemonset --tail=50
kubectl debug node/gpu-node-1 -it --image=ubuntu -- chroot /host nvidia-smi`)}

<h2>8. How do we scale it?</h2>
<ul>
<li><b>More nodes, more pools</b>: node autoscaling per GPU type; pools sized against cloud quotas (GPU quotas are often the real limit).</li>
<li><b>Fewer wasted GPUs</b>: right-size the GPU type to the model (an 8B model in BF16 does not need an H100 80GB for low traffic); MIG for small models.</li>
<li><b>Topology</b>: multi-GPU pods should land on one node with NVLink; multi-node jobs need placement in the same network block (Kueue TAS, DRA ComputeDomains).</li>
<li><b>Fleet operations</b>: automate cordon-and-replace on XID; keep driver drift at zero within a pool; label nodes with driver and image versions for fast incident triage.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>A worked comparison using AWS on-demand prices from the us-east-1 price feed dated 2026-10-12 (prices change; recheck):</p>
${formula(`
STEP 1  H100 cost per GPU-hour on p5.48xlarge
        $55.04 / h  ÷  8 GPUs  =  $6.88 per GPU-hour

STEP 2  split one H100 into 7 MIG 1g.10gb instances
        $6.88  ÷  7  ≈  $0.98 per instance-hour   (if all 7 are used)

STEP 3  compare a whole L4 (g6.xlarge, 22 GiB usable)
        $0.8048 per hour  (includes 4 vCPU + host RAM)

STEP 4  the 1.7B Atlas model: weights ≈ 1.7 × 10⁹ × 2 B ≈ 3.4 GB
        fits a 1g.10gb slice (≈10 GB) with ≈ 6 GB for KV and runtime
        fits an L4 with far more KV room

ANSWER  Per hour the L4 and a fully packed MIG slice cost about the same.
        The L4 gives 2× the memory; the MIG slice only wins if you already
        own H100 capacity (reservation, idle headroom) — an empty slice costs
        the same as a busy one.
`)}
<p>Other levers: spot GPUs for batch pools; capacity reservations or AWS Capacity Blocks for predictable training windows; consolidation (Karpenter) to remove half-empty GPU nodes; and refusing time-slicing in production because the hidden cost is SLO violations.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How does a pod get a GPU in Kubernetes, and how would you share GPUs?”','<p><i>Answer (≈50 s):</i> "Kubernetes doesn’t know GPUs natively. The host needs the NVIDIA driver and the container toolkit; a device plugin registers with the kubelet and advertises <code>nvidia.com/gpu</code> as an extended resource; the scheduler places pods by that count and the kubelet allocates specific devices, which the runtime injects. Requests must be whole and equal to limits, so you can’t ask for half a GPU. To share, I’d use MIG where I need isolation — each slice has its own memory and compute — and time-slicing only for dev, because it has no memory or fault isolation. DRA is GA since 1.34 and is the future for richer allocation, but NVIDIA’s DRA GPU allocation isn’t officially supported yet, so for production single-node serving I still use the device plugin, usually installed by the GPU Operator."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Install the GPU Operator and request nvidia.com/gpu: 0.5 to share a GPU."</p><p>Fractional extended resources are rejected, and the answer ignores isolation.</p></div><div class="good"><h4>Strong answer</h4><p>Names each layer, the extended-resource rules, the isolation trade-off of each sharing mode, and DRA’s real maturity.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['NVIDIA driver','container toolkit','device plugin / DRA','kubelet','scheduler','vLLM pod'])}
${chain(['GPU type + sharing mode','memory per pod','KV capacity','concurrency','cost per token'])}
<p>Next: ${L('v1-k8s-serving','serve a model on these GPUs')} with the right probes and weight loading. Later: ${L('v2-distributed-inference','fleet scheduling for distributed inference')} and ${L('v2-finops-optimization','GPU cost optimisation')}.</p></div>
`,
  quiz:[
    {q:'Which resource spec is valid for a container that needs one GPU via the NVIDIA device plugin?',options:['requests nvidia.com/gpu: 1, no limits','limits nvidia.com/gpu: 1 (requests omitted or equal)','limits nvidia.com/gpu: 0.5','requests 1, limits 2'],answer:1,explain:'Extended resources go in limits; requests, if set, must equal limits; quantities are whole numbers. A request without a limit, a fraction, or unequal values are all rejected.'},
    {q:'A node has 8 H100s and the driver works on the host, but kubectl shows allocatable nvidia.com/gpu: 0. Most likely cause?',options:['The pods have no tolerations','The device plugin is not running or reports devices unhealthy','The scheduler is down','MIG is enabled'],answer:1,explain:'Allocatable for extended resources comes only from the device plugin (or DRA driver). Tolerations affect scheduling, not what the node advertises.'},
    {q:'Which statement about time-slicing is correct?',options:['Each replica gets a fixed share of HBM','It provides fault isolation like MIG','It advertises one physical GPU several times with no memory or fault isolation','It only works on L4 GPUs'],answer:2,explain:'NVIDIA’s docs: unlike MIG, there is no memory or fault isolation between replicas. MIG is the hardware-partitioned option.'},
    {q:'On an H100 80GB, how many 3g.40gb MIG instances fit, and what fraction of memory does each get?',options:['2 instances, 4/8 of memory each','3 instances, 3/8 each','2 instances, 3/7 of memory each','7 instances, 1/7 each'],answer:0,explain:'3g.40gb allows 2 instances; memory is divided in eighths (4/8 each), compute in sevenths (3/7 each).'},
    {q:'What does DRA add compared with the device plugin?',options:['Fractional nvidia.com/gpu quantities in limits','Device descriptions with attributes in ResourceSlices, claims matched by CEL selectors, and the allocated device recorded in the claim','A replacement for the NVIDIA driver','Automatic MIG on L4 GPUs'],answer:1,explain:'DRA (GA in 1.34) models devices and claims. It does not change extended-resource rules, does not replace the driver, and L4 has no MIG.'},
    {q:'You must upgrade the GPU driver across 40 serving nodes. Best first step?',options:['Upgrade all nodes in place overnight','Create a canary pool with the new driver, validate CUDA + a vLLM benchmark, then roll gradually with PDBs','Upgrade the container images to the latest CUDA first','Disable the device plugin during the upgrade'],answer:1,explain:'Driver changes can break CUDA images or performance; a canary with real inference validation and gradual rollout limits blast radius.'}
  ],
  flashcards:[
    {front:'The six layers that make a GPU usable by a pod',back:'Host driver → container toolkit → device plugin or DRA driver → kubelet (device manager) → scheduler → pod/container with CUDA runtime.'},
    {front:'Extended-resource rules for nvidia.com/gpu',back:'Set in limits; requests optional but must equal limits; whole integers; never overcommitted.'},
    {front:'DRA status (Oct 2026)',back:'Core API resource.k8s.io/v1 GA in Kubernetes 1.34, gate locked from 1.35. NVIDIA DRA driver v0.5.1: ComputeDomains supported; GPU allocation not yet officially supported.'},
    {front:'MIG vs time-slicing isolation',back:'MIG: dedicated memory and compute slices, fault isolation. Time-slicing: shared memory, no fault isolation, contention.'},
    {front:'H100 80GB MIG memory vs compute granularity',back:'Memory in 1/8 slices, compute in 1/7. 1g.10gb ×7; 3g.40gb ×2 (4/8 memory, 3/7 compute).'},
    {front:'GPUs without MIG support',back:'L4, L40S, T4 (not on NVIDIA’s MIG supported list).'},
    {front:'Is a GPU request a VRAM limit?',back:'No. Kubernetes memory limits are host RAM. Only MIG (or a capacity-aware DRA driver) bounds GPU memory per pod.'}
  ]
});
registerGlossary([
  {term:'Device plugin',def:'Kubernetes extension (usually a DaemonSet) that registers with the kubelet, advertises a countable extended resource such as nvidia.com/gpu, reports device health and prepares devices for containers.',lesson:'v1-k8s-gpu-stack'},
  {term:'Extended resource',def:'A node resource outside CPU/memory (e.g. nvidia.com/gpu), counted in whole integers, never overcommitted; requests must equal limits.',lesson:'v1-k8s-gpu-stack'},
  {term:'GPU Feature Discovery',def:'NVIDIA component that labels nodes with GPU product, memory, count, MIG capability and sharing settings for use in node selectors.',lesson:'v1-k8s-gpu-stack',aliases:['GFD']},
  {term:'DCGM exporter',def:'NVIDIA Prometheus exporter for GPU metrics from the Data Center GPU Manager: utilisation, framebuffer memory (MiB), power, XID errors and profiling counters.',lesson:'v1-k8s-gpu-stack',aliases:['dcgm-exporter']},
  {term:'Dynamic Resource Allocation',def:'Kubernetes API (resource.k8s.io/v1, GA in 1.34) in which drivers publish device descriptions (ResourceSlices) and pods request devices through ResourceClaims with CEL selectors.',lesson:'v1-k8s-gpu-stack',aliases:['DRA']},
  {term:'MIG',def:'Multi-Instance GPU: hardware partitioning of supported NVIDIA GPUs (A100, H100, H200, B200…) into instances with dedicated memory and compute slices and fault isolation.',lesson:'v1-k8s-gpu-stack',aliases:['Multi-Instance GPU']},
  {term:'Time-slicing',def:'GPU sharing where the device plugin advertises one GPU as several replicas and processes take turns; no memory or fault isolation.',lesson:'v1-k8s-gpu-stack',aliases:['GPU time-slicing']},
  {term:'MPS',def:'CUDA Multi-Process Service: runs kernels from several processes concurrently through one server; better packing than time-slicing, weaker isolation than MIG.',lesson:'v1-k8s-gpu-stack',aliases:['Multi-Process Service']}
]);

/* ---------- 1.6.2 Model serving on Kubernetes ---------- */
registerLesson({
  id:'v1-k8s-serving', vol:1, part:6, num:2,
  title:'Model serving on Kubernetes: deployments, health checks, weight loading, KServe and llm-d', minutes:90,
  summary:'Serving a language model on Kubernetes looks like running any web service, but three things are different. Each replica needs a whole GPU and takes minutes to start because it must load gigabytes of weights. Health checks must tell the difference between loading, ready and broken. And each request may stream tokens for a minute, so shutting a pod down must let those streams finish. This lesson builds a complete vLLM Deployment line by line, compares ways to get model weights onto nodes with real download arithmetic, and explains what KServe, llm-d and the Gateway API Inference Extension add on top.',
  objectives:[
    'Choose between Deployment, StatefulSet and LeaderWorkerSet for single-GPU, multi-GPU and multi-node model servers.',
    'Write and explain every safety-relevant field of a vLLM Deployment: GPU limits, shared memory, model cache, secret-sourced token, startup/readiness/liveness probes, grace period and preStop.',
    'Compare five model-weight distribution strategies and compute load times for a given model size and bandwidth.',
    'Explain what KServe InferenceService / LLMInferenceService and llm-d with InferencePool + endpoint picker add beyond a Service.',
    'Design graceful shutdown so in-flight streams finish during rollouts and scale-down.'
  ],
  prereqs:['v1-k8s-gpu-stack','v1-inference-anatomy','v1-engines','v1-benchmarking'],
  next:['v1-k8s-autoscaling','v1-k8s-production','v2-ai-gateway','v2-distributed-kv','v2-rag-weight-cache'],
  tags:['kubernetes','serving','vllm','kserve','llm-d'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A model server is like a large restaurant kitchen rather than a food truck. It takes a long time to open in the morning (ovens heat up = weights load), you must not tell customers it is open before the ovens are hot (readiness), and at closing time you finish the meals already cooking rather than throwing them away (draining). Now the real mechanism.')}
<p><b>Model serving on Kubernetes</b> means running an inference engine (here vLLM, see ${L('v1-engines','inference engines')}) as Kubernetes workloads that expose an OpenAI-compatible HTTP API, are placed on GPU nodes, report honest health, receive weights efficiently, and are routed to intelligently. The basic building blocks are the ones you know — Deployment, Service, probes, volumes, Secrets — configured for a process that is GPU-bound, slow to start and holds long-lived streaming connections.</p>

<h2>2. Why do we need it?</h2>
<p>Running <code>vllm serve</code> on one VM works for a demo. Production needs: several replicas behind one endpoint, zero-downtime model upgrades, automatic restart of hung processes, controlled weight distribution (no hundred pods pulling 140 GB from the internet at once), secrets out of images, and routing that understands LLM load. Kubernetes gives the control loop; this lesson is about configuring it so that its assumptions (fast start, short requests, cheap replicas) do not hurt you.</p>
${table(['Web-service assumption','LLM-serving reality','Consequence'],[
 ['Starts in seconds','Starts in 1–10+ minutes (pull image, load weights, warm up)','Probes and autoscaling must allow for it'],
 ['Requests last milliseconds','Streams last seconds to minutes','Shutdown and rollouts must drain'],
 ['Replicas are cheap','Each replica holds ≥ 1 GPU','Surge capacity and rollouts are constrained by spare GPUs'],
 ['Round-robin load balancing is fine','Load depends on prompt length, KV usage and prefix-cache contents','Model-aware routing (endpoint picker) pays off']
])}

<h2>3. How does it work internally?</h2>
<h3>3.1 Choosing the workload controller</h3>
${table(['Controller','Use it when','Why'],[
 ['<b>Deployment</b>','Each replica fits on one node (1–8 GPUs, tensor parallel inside the node)','Replicas are interchangeable; rolling updates; works with HPA/KEDA.'],
 ['<b>StatefulSet</b>','Replicas need stable names or their own persistent volume (e.g. a per-replica local cache), or a framework expects ordinal identities','Stable identity and per-pod PVCs; slower ordered rollouts.'],
 ['<b>LeaderWorkerSet</b> (LWS)','One model replica spans several nodes (e.g. tensor parallel 8 × pipeline parallel 2 across two 8-GPU nodes)','Creates <i>groups</i> of pods (one leader + N workers) that are scheduled, restarted and rolled out as a unit; scaling adds whole groups.']
])}
<p>${term('LeaderWorkerSet')} is a Kubernetes SIG project (API group <code>leaderworkerset.x-k8s.io</code>). If any pod in a group fails, the group is restarted together, which matches how a multi-node model replica actually fails: losing one shard makes the whole replica useless. Multi-node serving is covered in ${L('v2-distributed-inference','distributed inference')}; for the Atlas 1.7B model a Deployment is right.</p>

<h3>3.2 A complete vLLM Deployment, annotated</h3>
<p>This is the shape the planned Helm chart in <code>labs/06-k8s/atlas-llm/</code> (template <code>templates/deployment.yaml</code>) renders. Read the comments; every one is a production lesson.</p>
${code('yaml',`apiVersion: apps/v1
kind: Deployment
metadata:
  name: atlas-llm
  namespace: atlas
  labels: { app: atlas-llm, bundle: "v7" }
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1            # needs ONE spare GPU somewhere, or the rollout stalls
      maxUnavailable: 0      # never drop below 2 ready replicas
  selector:
    matchLabels: { app: atlas-llm }
  template:
    metadata:
      labels: { app: atlas-llm, bundle: "v7" }
    spec:
      terminationGracePeriodSeconds: 120   # >= preStop + longest expected stream
      nodeSelector:
        nvidia.com/gpu.product: NVIDIA-L4  # pin to the GPU type you benchmarked
      tolerations:
      - { key: nvidia.com/gpu, operator: Exists, effect: NoSchedule }
      containers:
      - name: vllm
        image: vllm/vllm-openai:v0.31.0     # pin a version; in prod pin the digest
        args:
        - --model=/models/atlas-1.7b        # local path: no download at start
        - --served-model-name=atlas
        - --max-model-len=8192              # product limit, not the model maximum
        - --gpu-memory-utilization=0.90
        - --port=8000
        env:
        - name: HF_TOKEN                    # only needed if the pod downloads gated weights
          valueFrom:
            secretKeyRef: { name: hf-token, key: token, optional: true }
        - name: HF_HUB_OFFLINE              # fail fast instead of silently downloading
          value: "1"
        ports:
        - { name: http, containerPort: 8000 }
        resources:
          limits:   { nvidia.com/gpu: 1, cpu: "4", memory: 24Gi }
          requests: { nvidia.com/gpu: 1, cpu: "4", memory: 24Gi }
        startupProbe:                       # covers weight load + warm-up
          httpGet: { path: /health, port: http }
          periodSeconds: 10
          failureThreshold: 60              # 60 x 10 s = 10 min budget
        readinessProbe:                     # gate traffic
          httpGet: { path: /health, port: http }
          periodSeconds: 5
          failureThreshold: 3
        livenessProbe:                      # only restarts a truly hung process
          httpGet: { path: /health, port: http }
          periodSeconds: 15
          timeoutSeconds: 5
          failureThreshold: 4               # 60 s of failures before a restart
        lifecycle:
          preStop:
            exec: { command: ["sleep", "15"] }   # let endpoints/proxies catch up
        volumeMounts:
        - { name: dshm, mountPath: /dev/shm }
        - { name: models, mountPath: /models, readOnly: true }
      volumes:
      - name: dshm                          # PyTorch/NCCL use shared memory; the 64 MiB
        emptyDir: { medium: Memory, sizeLimit: 8Gi }   # container default is too small
      - name: models
        persistentVolumeClaim: { claimName: atlas-models-rox, readOnly: true }`)}
<h4>Why each part matters</h4>
<ul>
<li><b>GPU limits = requests</b>: the extended-resource rule from ${L('v1-k8s-gpu-stack','the GPU stack lesson')}. CPU and host memory still matter: tokenisation, the API server and weight loading use CPU and RAM; give enough RAM to hold safetensors pages during load.</li>
<li><b><code>/dev/shm</code></b>: containers get a small shared-memory mount by default (64 MiB under Docker/containerd defaults). Multi-GPU tensor parallelism (NCCL) and PyTorch worker processes use shared memory; the vLLM Docker docs recommend <code>--ipc=host</code> for this reason. On Kubernetes, a memory-backed <code>emptyDir</code> at <code>/dev/shm</code> is the equivalent. It counts against the pod’s memory.</li>
<li><b>Model cache volume</b>: weights come from a volume, not from the internet at start (strategies below). <code>HF_HUB_OFFLINE=1</code> makes a missing file a fast, visible error rather than a silent multi-GB download.</li>
<li><b>Token from a Secret</b>: never bake a Hugging Face token into the image or the args. In production the Secret is synced from a vault (${L('v1-k8s-production','production lesson')}).</li>
<li><b>startupProbe</b>: until it succeeds, liveness and readiness are not run. Size <code>failureThreshold × periodSeconds</code> to your slowest measured start plus margin.</li>
<li><b>readinessProbe</b>: removes the pod from the Service’s endpoints when it fails. vLLM’s API server only starts listening after the engine has loaded, so <code>/health</code> returning 200 means “loaded and the engine is alive”.</li>
<li><b>livenessProbe, carefully</b>: restarting a GPU server costs minutes of capacity. Use generous thresholds; a slow but alive server under heavy load must not be killed. Never point liveness at an endpoint that runs inference.</li>
<li><b>preStop + grace period</b>: see 3.5.</li>
</ul>
${callout('warn','/health is liveness-quality, not capacity-quality','A replica with 200 requests queued still returns 200 on <code>/health</code>. Readiness keeps broken pods out; it does not balance load. Load-aware routing (endpoint picker, below) and autoscaling on queue metrics do that.')}
${callout('unverified','Engine behaviour on SIGTERM','Whether your vLLM version stops accepting new requests and waits for in-flight streams on SIGTERM, and for how long, has changed across releases. Test it: start a long stream, delete the pod, and watch whether the stream completes. If it does not, the preStop hook and gateway-side draining must cover the gap.')}

<h3>3.3 Getting weights onto the node</h3>
<p>Weight loading is usually the largest part of start time. First the arithmetic (sizes from parameter count × bytes; bandwidths are <b>illustrative</b> — measure yours):</p>
${formula(`
Model sizes (BF16 = 2 bytes per parameter)
  Atlas 1.7B   :   1.7 × 10⁹ × 2 B ≈   3.4 GB
  8B class     :   8.0 × 10⁹ × 2 B ≈  16 GB
  70B class    :  70.6 × 10⁹ × 2 B ≈ 141 GB

                       size (GB)
  download time  =  ─────────────────
                     bandwidth (GB/s)

STEP 1  70B from a public hub at an effective 0.1 GB/s
          141 / 0.1  = 1,410 s ≈ 23.5 min

STEP 2  70B from S3 in-region at an effective 1 GB/s per pod
          141 / 1    =   141 s ≈ 2.4 min

STEP 3  50 pods restarting together, each needing 100 GB, shared store
        capped at an aggregate 10 GB/s
          50 × 100 GB = 5,000 GB
          5,000 / 10  =   500 s ≈ 8.3 min   ← every pod waits for the herd

STEP 4  same 100 GB from node-local NVMe at 3 GB/s (already cached)
          100 / 3     ≈    33 s per pod, independent of how many pods restart

ANSWER  Distribution strategy changes start time by 10–40× and decides whether
        a mass restart is a 1-minute blip or a 10-minute outage.
`)}
${table(['Strategy','How','Strengths','Weaknesses'],[
 ['<b>Bake into the image</b>','<code>COPY</code> weights into the container image','Immutable, signed with the image, no runtime credentials','Huge images (layer limits, slow pulls and pushes); every code change re-ships weights unless layered carefully; registry storage cost'],
 ['<b>Init container download</b>','Init container pulls from S3/GCS/HF into an <code>emptyDir</code>','Simple; one image serves many models','Every start repeats the download; egress cost; thundering herd; needs credentials in the pod'],
 ['<b>Shared PVC, ReadOnlyMany</b>','EFS/Filestore/FSx for Lustre/NFS mounted read-only by all replicas','Download once; simple','Shared throughput cap (STEP 3); network filesystem latency during load; another stateful dependency'],
 ['<b>Node-local NVMe cache</b>','A DaemonSet or init step pre-fetches to local disk (e.g. p5 nodes have 8 × 3.8 TB NVMe); pods mount via hostPath/local PV','Fastest restarts; no herd after first fetch','Cache invalidation and disk management; first start on a new node still pays the download'],
 ['<b>OCI image volume / modelcar</b>','Package weights as an OCI artifact; mount with the Kubernetes <code>image</code> volume source (GA in 1.36) or KServe’s “modelcar” sidecar pattern','Registry dedup, signing and caching reuse your container supply chain; node runtime caches layers','Needs a runtime and Kubernetes version that support it; big artifacts still pull at registry speed the first time']
])}
${code('yaml',`# Kubernetes image volume (stable since v1.36): weights as an OCI artifact
volumes:
- name: models
  image:
    reference: registry.example.com/models/atlas-1.7b@sha256:...   # pin by digest
    pullPolicy: IfNotPresent`)}
<p>A common production combination: weights stored once in object storage (source of truth, versioned by digest), pre-fetched to node-local NVMe or mounted as an OCI image volume, with <code>HF_HUB_OFFLINE=1</code> in the engine. See ${L('v2-rag-weight-cache','model-weight caching')} for the fleet-scale version.</p>

<h3>3.4 KServe and llm-d: what they add</h3>
<p>${term('KServe')} (v0.21.0, Sept 2026) is a model-serving platform on Kubernetes. Its classic <b>InferenceService</b> CRD takes a model format and <code>storageUri</code> and creates the Deployment, Service, storage initializer and autoscaling for you (raw-deployment or Knative serverless mode). For LLMs it now has <b>LLMInferenceService</b> (<code>llmisvc</code>), built on llm-d and the Gateway API Inference Extension. In the v0.21.0 CRD it is served as <code>v1alpha1</code> and <code>v1alpha2</code> — still <b>alpha</b> in API terms, even though the project bills it as production-ready.</p>
<p>${term('llm-d')} (v0.10.0, a CNCF Sandbox project) is a Kubernetes-native distributed inference stack around vLLM/SGLang: an L7 router (proxy + ${term('endpoint picker')}), prefix-cache-aware and predicted-latency routing, KV-cache indexing and tiered offload, and prefill/decode disaggregation. It builds on the <b>Gateway API Inference Extension</b> (GAIE, v1.6.2), whose central object is the ${term('InferencePool')} (<code>inference.networking.k8s.io/v1</code>): an “LLM-aware Service” that selects model-server pods and names an endpoint picker that chooses the best pod per request.</p>
${code('yaml',`apiVersion: inference.networking.k8s.io/v1
kind: InferencePool
metadata: { name: atlas-pool, namespace: atlas }
spec:
  selector:
    matchLabels: { app: atlas-llm }
  targetPorts:
  - number: 8000
  endpointPickerRef:          # ext-proc service that scores pods per request
    name: atlas-epp
    port: { number: 9002 }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: atlas-route, namespace: atlas }
spec:
  parentRefs: [{ name: ai-gateway }]
  rules:
  - backendRefs:
    - group: inference.networking.k8s.io
      kind: InferencePool
      name: atlas-pool`)}
${callout('unverified','Check field names against your installed CRD','The InferencePool field names above follow the v1 API; run <code>kubectl explain inferencepool.spec</code> on your cluster. Note GAIE v1.6.0 removed the alpha InferenceObjective/InferenceModelRewrite APIs and moved the full-featured endpoint picker to llm-d; GAIE itself now ships only a lightweight conformance picker.')}
${table(['Capability','Plain Deployment + Service','KServe InferenceService','llm-d / GAIE InferencePool'],[
 ['Routing','Round-robin per connection','Service / Knative','Per-request: queue depth, KV usage, prefix-cache affinity, LoRA presence'],
 ['Model lifecycle','You write everything','storageUri, runtimes, autoscaling defaults','Well-lit-path Helm recipes'],
 ['Disaggregated prefill/decode','No','Via LLMInferenceService (llm-d)','Yes'],
 ['Maturity','Mature','InferenceService mature; LLMInferenceService alpha API','GAIE InferencePool v1; llm-d 0.x (emerging)']
])}
<p>Why per-request routing matters: two requests sharing a 3,000-token system prompt are much cheaper if they land on the replica that already holds that prefix in its KV cache (${L('v2-prefix-kv-cache','prefix caching')}). A round-robin Service spreads them randomly, so every replica recomputes the prefix.</p>

<h3>3.5 Graceful shutdown and in-flight streams</h3>
${anim('v1-k8s-rolling')}
<p>When a pod is deleted (rollout, scale-down, node drain), Kubernetes does several things <b>at the same time</b>: marks the pod Terminating, removes it from EndpointSlices, and runs the preStop hook. Only after preStop finishes does the container get SIGTERM; when <code>terminationGracePeriodSeconds</code> (counted from the start, including preStop) expires, it gets SIGKILL.</p>
${formula(`
grace period  ≥  preStop delay  +  longest expected stream  +  margin

  longest stream (p99)  = 1,500 output tokens × 30 ms TPOT = 45 s
  preStop delay         = 15 s   (endpoint removal propagates to proxies)
  margin                = 20 s
                          ──────
  terminationGracePeriodSeconds  ≥  80 s   → choose 120 s
`)}
<p>Also add a <b>PodDisruptionBudget</b> (e.g. <code>maxUnavailable: 1</code>) so node drains and Karpenter consolidation cannot take several replicas at once, and cap output length at the gateway so no stream can outlive the grace period.</p>

<h2>4. Where does it fit?</h2>
${fig('Request path for Atlas on Kubernetes', svgDiagram({w:900,h:340,
 zones:[{x:250,y:20,w:630,h:300,label:'Cluster (namespace atlas)'}],
 boxes:[
  {id:'c',x:20,y:140,w:200,h:56,label:'Client app',sub:'OpenAI SDK, streaming'},
  {id:'gw',x:270,y:140,w:160,h:56,label:'AI gateway',sub:'auth, quotas',cls:'hl'},
  {id:'epp',x:470,y:50,w:170,h:56,label:'Endpoint picker',sub:'scores pods'},
  {id:'pool',x:470,y:140,w:170,h:56,label:'InferencePool',sub:'or Service'},
  {id:'p1',x:690,y:60,w:170,h:56,label:'vLLM pod 1',sub:'GPU, KV cache',cls:'ok'},
  {id:'p2',x:690,y:150,w:170,h:56,label:'vLLM pod 2',sub:'GPU, KV cache',cls:'ok'},
  {id:'w',x:470,y:240,w:390,h:56,label:'Weights: OCI image / PVC / NVMe cache',sub:'read-only mount',cls:'v2'}
 ],
 arrows:[{from:'c',to:'gw',label:'HTTPS + SSE'},{from:'gw',to:'pool'},{from:'gw',to:'epp',cls:'dash',label:'which pod?'},{from:'pool',to:'p1'},{from:'pool',to:'p2'},{from:'w',to:'p2',fromSide:'right',toSide:'bottom',cls:'dash'}]
}), 'The gateway authenticates and meters; the pool plus endpoint picker selects a replica per request; weights arrive from a read-only source at start.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Inputs</b>: GPU nodes (${L('v1-k8s-gpu-stack','GPU stack')}), weights and tokenizer from the model registry (${L('v2-mlops-foundations','MLOps foundations')}), secrets from a vault.</li>
<li><b>Outputs</b>: an OpenAI-compatible API consumed by applications (${L('v1-ai-apps-tools','next-but-one lesson')}); <code>/metrics</code> scraped by Prometheus.</li>
<li><b>Autoscaling</b>: queue and KV metrics drive replica count (${L('v1-k8s-autoscaling','next lesson')}).</li>
<li><b>Gateway</b>: authentication, per-tenant token quotas and model routing live in front (${L('v2-ai-gateway','AI gateway')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li>The Helm chart/values for each model: image digest, engine flags, GPU type, probes, grace period, PDB, volumes.</li>
<li>The weight distribution system and its credentials, caching and cleanup.</li>
<li>Rollout policy: surge GPUs, max unavailable, canary steps (${L('v1-k8s-production','production lesson')}).</li>
<li>Routing layer choice: Service, Gateway + InferencePool, KServe, llm-d.</li>
<li>Start-time SLO: measured breakdown (schedule → pull → load → warm-up → ready) tracked per release.</li>
</ul>
${callout('devops','DevOps bridge','Treat the model server like a JVM service with a 5-minute warm-up and long-polling clients: startupProbe for warm-up, readiness for traffic, very cautious liveness, preStop + long grace for connection draining, and PDBs for drains. The analogy breaks on capacity: you cannot surge without a spare GPU.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['CrashLoopBackOff during first deploy, logs show loading progress then exit 137/143','Liveness killed it during weight load','Events: Liveness probe failed; no startupProbe','Add startupProbe sized to measured load time'],
 ['Rollout stuck: new pod Pending','No spare GPU for maxSurge','FailedScheduling Insufficient nvidia.com/gpu','Reserve a surge GPU, lower maxSurge with maxUnavailable 1, or blue/green pool'],
 ['NCCL / “bus error” / shm errors with tensor parallel','/dev/shm too small','Error mentions shared memory','Memory-backed emptyDir at /dev/shm'],
 ['Users see truncated answers during deploys','SIGKILL before streams finish; no preStop','Client errors correlate with rollout times','preStop sleep, longer grace, output caps, PDB'],
 ['Pods start slowly only when many restart together','Shared storage throughput cap','Storage throughput at max; per-pod load time ↑ with pod count','Node-local cache, staggered rollouts, OCI image volume'],
 ['Pod ready but every request 404 “model not found”','Client uses a different model name than <code>--served-model-name</code>','<code>GET /v1/models</code>','Align names; gateway rewrites'],
 ['Pod silently downloads weights from the internet at start','Path wrong, cache empty, online mode','Egress spike; slow start','Local path + HF_HUB_OFFLINE=1, NetworkPolicy egress deny']
])}

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Replica scale-out</b> (data parallel) for throughput, with load-aware routing so replicas are evenly loaded.</li>
<li><b>Tensor parallel inside a node</b> when a model does not fit one GPU; <b>LeaderWorkerSet</b> when it does not fit one node.</li>
<li><b>Faster starts</b> to make scaling usable: local caches, image pre-pulling, smaller images, fewer warm-up steps.</li>
<li><b>Prefix-aware routing and disaggregation</b> (llm-d) when prompts are long and shared.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>Start time is money: a replica that takes 6 minutes to become ready on an H100 at $6.88/GPU-hour (p5.48xlarge on-demand, 2026-10-12 price feed) burns 0.1 h × $6.88 ≈ $0.69 per start doing nothing, and more importantly forces you to keep idle warm capacity because scaling is slow. Halving start time lets you run less standing headroom. Other levers: right-size <code>--max-model-len</code> (more KV room = more concurrency per GPU, ${L('v1-kv-cache','KV cache')}); pick the cheapest GPU that meets the SLO; avoid egress by keeping weights in-region.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Walk me through deploying vLLM on Kubernetes for production.”','<p><i>Answer (≈60 s):</i> "A Deployment pinned to the GPU type I benchmarked, with <code>nvidia.com/gpu</code> limits, a memory-backed <code>/dev/shm</code>, weights mounted read-only from a pre-populated cache or OCI image volume — never downloaded from the internet at start — and the HF token from a Secret only if needed. A startupProbe sized to the measured load time, readiness on <code>/health</code> to gate traffic, and a very conservative liveness probe because restarts cost minutes of GPU. For rollouts, maxSurge 1 / maxUnavailable 0 needs a spare GPU; preStop plus a grace period longer than the longest stream so in-flight responses finish; a PDB for drains. In front, a gateway for auth and token quotas, and if prompts share long prefixes, an InferencePool with an endpoint picker so requests land where the KV cache already is."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Use a Deployment with a liveness probe and an HPA on CPU."</p></div><div class="good"><h4>Strong answer</h4><p>Separates startup, readiness and liveness, plans weight distribution and draining, and knows that capacity and routing are LLM-specific.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['weights source','load time','startupProbe','readiness','EndpointSlice','traffic'])}
${chain(['SIGTERM','preStop','drain streams','grace period','no truncated answers'])}
<p>Next: ${L('v1-k8s-autoscaling','autoscale on the right signals')} — and see how start time from this lesson becomes the cold-start budget. Later: ${L('v2-distributed-kv','cache-aware routing at fleet scale')}.</p></div>
`,
  quiz:[
    {q:'Why does a vLLM Deployment need a startupProbe?',options:['To check GPU temperature','So liveness/readiness do not run, and kill or misjudge the pod, while weights are still loading','To download weights','To make the pod start faster'],answer:1,explain:'Until the startupProbe succeeds, liveness and readiness are not evaluated. Without it, a liveness probe can kill a pod that is only slow to load.'},
    {q:'A rolling update with maxSurge 1 and maxUnavailable 0 never progresses; the new pod is Pending with Insufficient nvidia.com/gpu. Best explanation?',options:['The readiness probe is wrong','There is no spare GPU for the surge pod','The image is too large','HPA is fighting the rollout'],answer:1,explain:'maxUnavailable 0 forbids removing an old pod first, so the rollout depends on a spare GPU for the surge pod.'},
    {q:'50 replicas each need 100 GB of weights from a shared filesystem limited to 10 GB/s aggregate. Approximate time until all have their weights?',options:['10 s','100 s','500 s','5,000 s'],answer:2,explain:'50 × 100 GB = 5,000 GB; 5,000 / 10 GB/s = 500 s. Per-pod bandwidth is the shared cap divided among all pods.'},
    {q:'p99 stream lasts 45 s, preStop sleeps 15 s. Which terminationGracePeriodSeconds is safe?',options:['30 (default)','45','60','120'],answer:3,explain:'The grace period includes preStop: 15 + 45 = 60 s with zero margin. 120 s leaves margin. 30 s would SIGKILL mid-stream.'},
    {q:'What does an InferencePool with an endpoint picker add over a plain Service?',options:['TLS termination','Per-request pod selection using model-server state such as queue depth, KV usage and prefix-cache affinity','GPU allocation','Weight download'],answer:1,explain:'A Service balances connections blindly. The endpoint picker scores pods per request using inference-specific signals.'},
    {q:'When is LeaderWorkerSet the right controller?',options:['Any single-GPU model','When one model replica spans several nodes and its pods must be scheduled and restarted as a group','For batch embedding jobs','To get stable pod names'],answer:1,explain:'LWS manages groups (leader + workers) as one unit, matching multi-node tensor/pipeline-parallel replicas.'}
  ],
  flashcards:[
    {front:'Three probes for an LLM server and their jobs',back:'startupProbe: tolerate long weight load. readinessProbe: gate traffic. livenessProbe: restart only truly hung processes, with generous thresholds.'},
    {front:'Why mount an emptyDir at /dev/shm?',back:'Containers get a tiny default shared memory; NCCL/PyTorch multi-process communication needs more. Memory-backed emptyDir (counts against pod memory).'},
    {front:'Grace period formula',back:'terminationGracePeriodSeconds ≥ preStop delay + longest expected stream + margin (grace includes preStop time).'},
    {front:'Five ways to get weights to a pod',back:'Bake into image; init-container download; shared ReadOnlyMany PVC; node-local NVMe cache; OCI image volume / modelcar.'},
    {front:'Kubernetes image volume status',back:'Mount an OCI image/artifact read-only as a volume: alpha 1.31, beta 1.33, stable 1.36.'},
    {front:'KServe LLMInferenceService maturity (v0.21.0)',back:'Served as v1alpha1 and v1alpha2 — alpha API; built on llm-d and the Gateway API Inference Extension.'},
    {front:'InferencePool',back:'GAIE CRD (inference.networking.k8s.io/v1): selects model-server pods and names an endpoint picker that chooses a pod per request.'}
  ]
});
registerGlossary([
  {term:'LeaderWorkerSet',def:'Kubernetes SIG workload API (leaderworkerset.x-k8s.io) that manages groups of pods (one leader, several workers) as a unit, used for multi-node model replicas.',lesson:'v1-k8s-serving',aliases:['LWS']},
  {term:'startupProbe',def:'Kubernetes probe that must succeed before liveness and readiness probes run; used to tolerate long model-weight loading.',lesson:'v1-k8s-serving',aliases:['startup probe']},
  {term:'preStop hook',def:'Container lifecycle hook run when a pod starts terminating, before SIGTERM; often a short sleep so endpoint removal propagates before the process stops.',lesson:'v1-k8s-serving',aliases:['preStop']},
  {term:'Image volume',def:'Kubernetes volume source that mounts an OCI image or artifact read-only into a pod (stable since 1.36); used to ship model weights through a registry.',lesson:'v1-k8s-serving',aliases:['OCI image volume','modelcar']}
]);

/* ---------- 1.6.3 Autoscaling and monitoring GPU inference ---------- */
registerLesson({
  id:'v1-k8s-autoscaling', vol:1, part:6, num:3,
  title:'Autoscaling and monitoring GPU inference', minutes:85,
  summary:'Autoscaling a language model on CPU usage does not work, because CPU is not what limits it and GPU utilization saturates long before latency breaks. Good scaling signals come from the inference engine itself: how many requests are running and waiting, how full the KV cache is, and how long users wait for the first token. This lesson builds a KEDA autoscaler on real vLLM metrics, tunes the Horizontal Pod Autoscaler so it neither flaps nor reacts too late, adds GPU node autoscaling with Karpenter, and works through the cold-start budget that decides how much warm capacity you must keep. It ends with a monitoring dashboard design that combines GPU and engine metrics.',
  objectives:[
    'Explain why CPU-based HPA and raw GPU utilization are poor scaling signals for LLM serving.',
    'Write a KEDA ScaledObject with a Prometheus trigger on exact vLLM metric names and compute the replica count it will produce.',
    'Tune HPA behavior (stabilization windows, policies) to avoid flapping and slow scale-up.',
    'Compute a cold-start budget (node provision + image pull + weight load + warm-up) and size warm headroom from it.',
    'Design a Grafana dashboard combining DCGM exporter and engine metrics around SLOs, saturation and cost.'
  ],
  prereqs:['v1-k8s-serving','v1-batching','v1-kv-cache','v1-benchmarking'],
  next:['v1-k8s-production','v2-hyperscale-serving','v2-capacity-planning','v2-ai-observability'],
  tags:['kubernetes','autoscaling','keda','karpenter','monitoring'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A call centre does not hire based on how hot the phones are. It hires based on how many callers are on hold and how long they wait — and it knows a new agent needs weeks of training, so it hires before the queue explodes. Now the real mechanism.')}
<p><b>Autoscaling GPU inference</b> is two control loops stacked: a <b>pod autoscaler</b> (HPA, usually driven by ${term('KEDA')}) that sets the number of model-server replicas from a demand signal, and a <b>node autoscaler</b> (${term('Karpenter')} or cluster-autoscaler) that adds GPU nodes when replicas cannot be placed. <b>Monitoring</b> is the measurement layer both loops and humans depend on: engine metrics (queues, KV, latency histograms) and GPU metrics from the DCGM exporter.</p>

<h2>2. Why do we need it?</h2>
<p>Traffic for a travel assistant is not flat: evenings, weekends, Ramadan and Eid, school holidays and flash sales move demand several-fold. A fixed fleet sized for the peak wastes GPU-hours most of the day; one sized for the average breaks the latency SLO at peak. But autoscaling GPUs is harder than web autoscaling, for three reasons:</p>
<ol>
<li><b>Wrong default signal.</b> CPU usage of a vLLM pod barely tracks load (the GPU does the work), and GPU utilization (${L('v1-gpu-architecture','time with ≥ 1 kernel running')}) reads near 100 % at moderate load, then stays there while queues grow.</li>
<li><b>Slow supply.</b> A new replica may need a new GPU node, a multi-GB image and gigabytes of weights: minutes, not seconds.</li>
<li><b>Expensive mistakes.</b> Flapping one GPU replica up and down wastes the minutes of loading each time, and scaling down mid-stream truncates answers.</li>
</ol>

<h2>3. How does it work internally?</h2>
<h3>3.1 Choosing the signal</h3>
${table(['Signal (vLLM metric, verified names)','What it measures','As a scaling signal'],[
 ['<code>vllm:num_requests_running</code> + <code>vllm:num_requests_waiting</code>','Sequences in the running batch and in the engine queue','<b>Best primary signal.</b> Total in-flight work; stable when capacity catches up.'],
 ['<code>vllm:num_requests_waiting</code> alone','Engine queue length','Good alarm, poor control signal: drops to 0 after scale-up → scale-down → queue returns (oscillation).'],
 ['<code>vllm:kv_cache_usage_perc</code> (0–1)','Fraction of KV blocks in use','Good secondary signal for long-context workloads; near 1.0 means admission will stall.'],
 ['<code>vllm:time_to_first_token_seconds</code> (histogram) p95','User-visible waiting + prefill','The SLO itself. Lagging, so use it to <i>validate</i> or as a guardrail trigger, not the only trigger.'],
 ['<code>vllm:generation_tokens_total</code> rate','Output tokens per second','Useful for capacity planning and cost; per-replica ceiling varies with prompt mix.'],
 ['CPU utilization','Process CPU','Not correlated with GPU work. Do not use.'],
 ['<code>DCGM_FI_DEV_GPU_UTIL</code>','% of time any kernel ran','Saturates early; does not show headroom. Do not use for scaling.']
])}
${callout('note','Metric names checked Oct 2026','The vLLM names above come from the vLLM metrics design page (verified 2026-10-14). The old <code>vllm:gpu_cache_usage_perc</code> name is no longer listed; use <code>vllm:kv_cache_usage_perc</code>. Metrics carry a <code>model_name</code> label in current releases; confirm labels on your live <code>/metrics</code> endpoint.')}
<p>How to pick the target: load-test one replica (${L('v1-benchmarking','benchmarking')}) and find the concurrency at which TTFT p95 and TPOT p95 still meet the SLO — say 32 concurrent sequences. Set the scaling target <b>below</b> it — say 24 — so that new capacity is ordered while the existing fleet still meets the SLO.</p>

<h3>3.2 The HPA formula</h3>
${formula(`
                                      currentMetricValue
desiredReplicas  =  ⌈ currentReplicas × ──────────────────── ⌉
                                      desiredMetricValue

For an external metric with an AverageValue target (KEDA's default for
Prometheus), currentMetricValue is the total divided by currentReplicas, so:

                        total in-flight
desiredReplicas  =  ⌈ ───────────────── ⌉
                        target per replica

STEP 1  total in-flight = running 150 + waiting 30 = 180
STEP 2  target per replica = 24
STEP 3  180 / 24 = 7.5  →  ⌈7.5⌉ = 8 replicas
        (HPA ignores changes within its default 10 % tolerance)
`)}

<h3>3.3 KEDA ScaledObject on vLLM metrics</h3>
<p>KEDA (v2.21, Sept 2026) watches external sources and manages an HPA for you. Its Prometheus scaler takes a PromQL query, a <code>threshold</code> (the per-replica target) and an <code>activationThreshold</code> (the value above which the workload is “active”; matters for scale from zero). This is the shape of the planned chart template <code>labs/06-k8s/atlas-llm/templates/keda.yaml</code>:</p>
${code('yaml',`apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: atlas-llm
  namespace: atlas
spec:
  scaleTargetRef:
    name: atlas-llm                 # the Deployment
  minReplicaCount: 2                # warm floor: never fewer than 2
  maxReplicaCount: 12               # bounded by GPU quota and budget
  pollingInterval: 15               # seconds between queries (default 30)
  cooldownPeriod: 300               # only used for scaling to/from zero
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleUp:
          stabilizationWindowSeconds: 0
          policies:
          - { type: Pods, value: 4, periodSeconds: 60 }    # add up to 4 per minute
        scaleDown:
          stabilizationWindowSeconds: 600                  # 10 min of lower demand first
          policies:
          - { type: Pods, value: 1, periodSeconds: 120 }   # remove 1 per 2 minutes
  triggers:
  - type: prometheus
    metadata:
      serverAddress: http://prometheus.monitoring.svc:9090
      query: |
        sum(vllm:num_requests_running{model_name="atlas"})
        + sum(vllm:num_requests_waiting{model_name="atlas"})
      threshold: "24"               # target in-flight per replica
      activationThreshold: "1"
  - type: prometheus                # second trigger: KV pressure (HPA takes the max)
    metricType: Value
    metadata:
      serverAddress: http://prometheus.monitoring.svc:9090
      query: avg(vllm:kv_cache_usage_perc{model_name="atlas"})
      threshold: "0.75"`)}
<p>With several triggers, the HPA computes a desired count for each and uses the <b>maximum</b>. The second trigger uses <code>metricType: Value</code> because an average ratio must not be divided by replica count again: HPA then scales by currentReplicas × current/target (e.g. 4 × 0.90/0.75 = 4.8 → 5).</p>
${callout('tip','HPA behavior defaults to know','Without a <code>behavior</code> block, Kubernetes scales up immediately (stabilization 0 s, up to 100 % or 4 pods per 15 s, whichever is more) and scales down using the highest recommendation of the last <b>300 s</b>. For GPU replicas, slow down scale-down further (minutes of loading are wasted by every flap) and cap scale-up to what the node pool can actually deliver.')}

<h3>3.4 Node autoscaling for GPUs</h3>
<p>When the HPA creates pods that do not fit, they go Pending with <code>Insufficient nvidia.com/gpu</code>. A node autoscaler reacts:</p>
<ul>
<li><b>Karpenter</b> (AWS provider v1.15, Oct 2026; APIs <code>karpenter.sh/v1</code> NodePool and <code>karpenter.k8s.aws/v1</code> EC2NodeClass) looks at pending pods’ requirements and launches a fitting instance directly, without node groups. Disruption features (consolidation, expiry, drift, interruption) also remove nodes — protect serving pods with PDBs.</li>
<li><b>cluster-autoscaler</b> grows predefined node groups (ASGs/MIGs). Scaling a GPU group from zero needs node-template hints so it knows the group offers <code>nvidia.com/gpu</code>.</li>
<li><b>EKS Auto Mode</b> uses Karpenter-style NodePools with built-in NVIDIA drivers and device plugin.</li>
</ul>
${code('yaml',`apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: gpu-serving
spec:
  template:
    metadata:
      labels: { workload: serving }
    spec:
      nodeClassRef: { group: karpenter.k8s.aws, kind: EC2NodeClass, name: gpu }
      requirements:
      - { key: karpenter.k8s.aws/instance-family, operator: In, values: ["g6", "g6e"] }
      - { key: karpenter.sh/capacity-type, operator: In, values: ["on-demand"] }
      taints:
      - { key: nvidia.com/gpu, value: present, effect: NoSchedule }
      expireAfter: 720h
  limits:
    nvidia.com/gpu: 16              # hard budget guard for this pool
  disruption:
    consolidationPolicy: WhenEmpty  # do not repack busy serving nodes
    consolidateAfter: 10m`)}
${callout('warn','Capacity is not guaranteed','A node autoscaler can only launch what the cloud has. GPU instances can be unavailable in a zone (InsufficientInstanceCapacity). For serving, keep a floor of on-demand or reserved capacity, allow several instance types and zones, and treat spot GPUs as burst for interruptible work. AWS Capacity Blocks reserve GPUs for 1–182-day windows, mainly for training.')}

<h3>3.5 The cold-start budget</h3>
<style>.sc-chart .axis{fill:none}[data-anim="v1-k8s-keda-cold"] .sc-chart path.line:nth-of-type(3){stroke:var(--ok)}[data-anim="v1-k8s-keda-cold"] .sc-chart path.line:nth-of-type(4){stroke:var(--bad)}[data-anim="v1-k8s-keda-cold"] [data-id="ldem"] text{fill:var(--accent)}[data-anim="v1-k8s-keda-cold"] [data-id="lcap"] text{fill:var(--ok)}[data-anim="v1-k8s-keda-cold"] [data-id="lq"] text{fill:var(--bad)}</style>
${anim('v1-k8s-keda-cold')}
<p>Every scaling decision becomes capacity only after a chain of delays. Measure each one; the numbers below are an <b>illustrative</b> budget for an 8B BF16 model (16 GB weights) on a new GPU node:</p>
${formula(`
STEP 1  detect      KEDA poll 15 s + HPA sync ≈ 15 s           ≈  30 s
STEP 2  node        launch + boot + join + driver/plugin ready ≈ 240 s
STEP 3  image       10 GB image at 200 MB/s effective:
                    10,000 MB / 200 MB/s                        =  50 s
STEP 4  weights     16 GB from S3 at 0.5 GB/s:  16 / 0.5        =  32 s
STEP 5  load+warm   load to HBM, memory profiling, CUDA graphs  ≈  90 s
STEP 6  ready       probe period + endpoint propagation         ≈  15 s
                                                                 ──────
        total cold start (new node)                              ≈ 457 s ≈ 7.6 min
        warm node, image cached, weights on local NVMe:
          30 + 0 + 0 + (16 GB / 3 GB/s ≈ 5) + 90 + 15             ≈ 140 s ≈ 2.3 min
`)}
<p>Then size headroom from how fast demand can grow during one cold start:</p>
${formula(`
headroom (concurrent)  ≥  demand growth rate  ×  cold-start time

  growth rate   = 20 concurrent requests per minute   (from last peak's ramp)
  cold start    = 7.6 min
  headroom      ≥ 20 × 7.6 = 152 concurrent  ≈  ⌈152 / 24⌉ = 7 replicas of spare

  with a warm node pool (2.3 min):  20 × 2.3 = 46 → ⌈46 / 24⌉ = 2 replicas
`)}
<p>This is why the cheapest way to meet the SLO is often to <b>shorten the cold start</b> rather than to keep more idle replicas.</p>

<h3>3.6 Warm pools and scale-to-zero</h3>
<ul>
<li><b>Replica floor</b> (<code>minReplicaCount</code>): simplest warm capacity; costs full GPU price.</li>
<li><b>Warm nodes without replicas</b>: run low-priority “balloon” pods (a pause container requesting one GPU, with a negative-value PriorityClass). Real pods preempt them instantly; the node autoscaler then replaces the balloon pods in the background. You pay for the GPU node but skip node launch.</li>
<li><b>Pre-pulled images and pre-fetched weights</b> on every GPU node via a DaemonSet: removes STEP 3 and most of STEP 4.</li>
<li><b>Scale to zero</b> (<code>minReplicaCount: 0</code>): saves all GPU cost when idle, but the first request waits the full cold start (minutes). Requests must be held somewhere while waiting (e.g. the KEDA HTTP add-on or a gateway queue) with client timeouts longer than the cold start. Reasonable for internal tools, dev endpoints, rarely used fine-tunes; not for a customer-facing assistant.</li>
</ul>

<h3>3.7 Monitoring: what to collect</h3>
<p>From the <b>DCGM exporter</b> (defaults checked against <code>default-counters.csv</code>, release 4.8.4):</p>
${table(['Metric','Meaning','Note'],[
 ['<code>DCGM_FI_DEV_GPU_UTIL</code>','% of time ≥ 1 kernel was running','Not SM efficiency; 100 % does not mean saturated'],
 ['<code>DCGM_FI_PROF_PIPE_TENSOR_ACTIVE</code>','Ratio of cycles the tensor pipe is active','Better view of useful math'],
 ['<code>DCGM_FI_PROF_DRAM_ACTIVE</code>','Ratio of cycles memory interface is busy','Decode is usually bandwidth-bound'],
 ['<code>DCGM_FI_DEV_FB_USED</code> / <code>_FB_FREE</code>','Framebuffer memory in <b>MiB</b>','vLLM pre-allocates; expect ~90 % used always'],
 ['<code>DCGM_FI_DEV_POWER_USAGE</code>','Power in W','Throttling and efficiency'],
 ['<code>DCGM_FI_DEV_XID_ERRORS</code>','<b>Last</b> XID code seen (a gauge, not a counter)','Alert on change / non-zero; Xid 79, 48, 95 need node action'],
 ['<code>DCGM_FI_PROF_SM_ACTIVE</code>, <code>_SM_OCCUPANCY</code>','SM activity / occupancy','<b>Disabled by default</b>; enable in the counters CSV if you need them']
])}
<p>From the <b>engine</b>: the request-level histograms <code>vllm:time_to_first_token_seconds</code>, <code>vllm:inter_token_latency_seconds</code>, <code>vllm:e2e_request_latency_seconds</code>, <code>vllm:request_queue_time_seconds</code>; counters <code>vllm:prompt_tokens_total</code>, <code>vllm:generation_tokens_total</code>, <code>vllm:request_success_total</code>; gauges for running/waiting and KV usage; prefix-cache <code>vllm:prefix_cache_queries</code> and <code>vllm:prefix_cache_hits</code>.</p>
${code('promql',`# TTFT p95 per model over 5 minutes
histogram_quantile(0.95,
  sum by (le, model_name) (rate(vllm:time_to_first_token_seconds_bucket[5m])))

# output tokens per second per replica
sum by (pod) (rate(vllm:generation_tokens_total[1m]))

# prefix-cache hit ratio
sum(rate(vllm:prefix_cache_hits[5m])) / sum(rate(vllm:prefix_cache_queries[5m]))

# GPUs reporting an XID other than 0
DCGM_FI_DEV_XID_ERRORS != 0`)}
${callout('unverified','Counter suffixes','Prometheus client libraries may expose counters with a <code>_total</code> suffix (e.g. the prefix-cache counters could appear as <code>vllm:prefix_cache_hits_total</code>). Check the exact series names on your engine’s <code>/metrics</code> before writing alerts.')}

<h2>4. Where does it fit?</h2>
${fig('Two control loops and the measurement layer', svgDiagram({w:900,h:340,
 boxes:[
  {id:'eng',x:30,y:40,w:180,h:56,label:'vLLM /metrics',sub:'queue, KV, TTFT'},
  {id:'dcgm',x:30,y:150,w:180,h:56,label:'DCGM exporter',sub:'GPU util, XID, MiB'},
  {id:'prom',x:270,y:95,w:170,h:56,label:'Prometheus',sub:'or Mimir',cls:'hl'},
  {id:'keda',x:500,y:40,w:170,h:56,label:'KEDA → HPA',sub:'pod loop'},
  {id:'dep',x:720,y:40,w:160,h:56,label:'Deployment',sub:'replicas'},
  {id:'karp',x:720,y:150,w:160,h:56,label:'Karpenter',sub:'node loop'},
  {id:'graf',x:500,y:150,w:170,h:56,label:'Grafana + alerts',sub:'humans'},
  {id:'cloud',x:720,y:260,w:160,h:56,label:'Cloud GPU capacity',sub:'quota, zones',cls:'v2'}
 ],
 arrows:[{from:'eng',to:'prom'},{from:'dcgm',to:'prom'},{from:'prom',to:'keda'},{from:'keda',to:'dep',label:'replicas'},{from:'dep',to:'karp',label:'Pending pods'},{from:'karp',to:'cloud'},{from:'prom',to:'graf'}]
}), 'The pod loop reacts in seconds to engine metrics; the node loop reacts to Pending pods and is bounded by cloud capacity.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Serving config</b> (${L('v1-k8s-serving','previous lesson')}): start time sets the cold-start budget; PDBs and grace periods make scale-down safe.</li>
<li><b>Engine scheduling</b> (${L('v1-batching','batching')}, ${L('v1-kv-cache','KV cache')}): <code>--max-num-seqs</code> and KV capacity set per-replica concurrency limits that define the scaling target.</li>
<li><b>Gateway</b> (${L('v2-ai-gateway','AI gateway')}): admission control and per-tenant limits protect the fleet during the minutes before new capacity arrives.</li>
<li><b>Capacity planning</b> (${L('v2-capacity-planning','capacity planning')}) sets min/max replicas; ${L('v2-hyperscale-serving','hyperscale serving')} goes deeper into queueing and warm-up.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li>Per-model scaling targets from load tests, re-measured when the model, engine version or prompt mix changes.</li>
<li>KEDA/HPA behavior tuning; replica min/max tied to GPU quota and budget.</li>
<li>Node pools: instance types, zones, capacity type, limits, consolidation policy, warm balloon pods.</li>
<li>Cold-start measurement per release and its reduction (image size, weight cache).</li>
<li>Dashboards and alerts; the Prometheus scrape config and retention for engine and DCGM metrics.</li>
</ul>
<h3>Dashboard design (one model, one page)</h3>
${table(['Row','Panels','Question it answers'],[
 ['1. SLO','TTFT p95/p99, ITL p95, E2E p95, error rate, success rate vs SLO lines','Are users OK right now?'],
 ['2. Demand','Requests/s, prompt tokens/s, output tokens/s, prompt-length histogram','What is coming in?'],
 ['3. Saturation','Running, waiting, KV usage per pod, queue time p95, prefix-cache hit ratio','Where is the bottleneck?'],
 ['4. Scaling','Desired vs ready replicas, Pending pods, nodes by pool, time-to-ready of last scale-up','Is capacity keeping up?'],
 ['5. GPU health','Tensor active, DRAM active, FB used (MiB), power, XID by node','Is hardware healthy and used well?'],
 ['6. Cost','GPU-hours by pool, output tokens per GPU-hour, cost per 1M tokens','Is it efficient?']
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['Latency breaks at peak, HPA never scaled','Scaling on CPU or GPU util','Flat CPU, GPU util 100 %, waiting rising','Scale on running + waiting'],
 ['Replicas oscillate every few minutes','Trigger on waiting-only, or short scale-down window','Replica graph sawtooth','Use running + waiting; longer scale-down stabilization'],
 ['Desired replicas up, ready replicas flat for 10 min','Node provisioning or GPU capacity shortage','Pending pods; Karpenter events (insufficient capacity)','More instance types/zones; reservations; warm nodes'],
 ['New nodes up but pods slow to Ready','Image pull / weight download','Pod events timeline; storage throughput','Pre-pull, node-local weights, image volumes'],
 ['KEDA shows 0 / errors','Prometheus query returns no data (label mismatch, metric renamed)','KEDA operator logs; run the query in Prometheus','Fix query; alert on scaler errors; set a safe floor'],
 ['Answers truncated during scale-down','Pods removed mid-stream','Client errors at scale-down times','Grace period, preStop, slower scale-down, PDB'],
 ['Karpenter consolidation keeps moving serving pods','Consolidation of under-utilized nodes','Disruption events','<code>WhenEmpty</code> policy for serving pools; PDBs']
])}

<h2>8. How do we scale it?</h2>
<p>Past one model and a few replicas: separate pools per GPU type and model size; scale on per-model signals; add gateway-level admission control and priority classes (paid tier vs free tier); route with an endpoint picker so new replicas are filled immediately; and for very large fleets, use predictive scaling from time-of-day patterns (Ramadan evenings are predictable) to pre-warm before the ramp. llm-d documents autoscaling via KEDA on endpoint-picker metrics; NVIDIA Dynamo’s Planner adjusts prefill and decode workers separately (${L('v2-distributed-inference','distributed inference')}).</p>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Illustrative day for Atlas on L4 nodes (g6.xlarge $0.8048/h, 2026-10-12 feed)

Fixed peak fleet:   8 replicas × 24 h × $0.8048      = $154.52 / day
Autoscaled:         2 replicas × 16 h  (night/day)    =  32 GPU-h
                    8 replicas ×  8 h  (evening peak) =  64 GPU-h
                    total 96 GPU-h × $0.8048           =  $77.26 / day

Saving              ($154.52 − $77.26) / $154.52       ≈ 50 %
  ↑ only real if the cold start is short enough to follow the ramp;
    otherwise you add warm headroom and the saving shrinks.
`)}
<p>Also: scale-to-zero for rarely-used endpoints, spot for interruptible batch pools, and a higher scaling target (fewer, busier replicas) where the SLO allows — the target is a direct cost/latency dial.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How would you autoscale an LLM endpoint on Kubernetes?”','<p><i>Answer (≈60 s):</i> "Not on CPU, and not on GPU utilization, which reads 100 % long before latency breaks. I load-test one replica to find the concurrency where TTFT and TPOT still meet the SLO, set the target below that, and scale with KEDA on running-plus-waiting requests from the engine’s metrics, with KV-cache usage as a second trigger. Scale-up fast but capped to what the node pool can deliver, scale-down slow with a long stabilization window. Then the real problem is cold start: node launch, image pull, weight load and warm-up can be seven minutes, so I measure it, shorten it with pre-pulled images and node-local weights, and keep warm headroom equal to demand growth during one cold start. Gateway admission control covers the minutes in between."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Set HPA to 70 % GPU utilization."</p></div><div class="good"><h4>Strong answer</h4><p>Engine-level signal with a measured target, HPA behavior tuning, node loop, cold-start arithmetic and headroom.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['load test','per-replica target','KEDA query','HPA replicas','Pending pods','Karpenter node','cold start','capacity'])}
${chain(['cold-start time','required headroom','idle GPU-hours','cost per token'])}
<p>Next: ${L('v1-k8s-production','secure and release it safely')}. Deeper: ${L('v2-hyperscale-serving','queueing, admission control and warm-up at scale')} and ${L('v2-ai-observability','AI observability and SLOs')}.</p></div>
`,
  quiz:[
    {q:'Why is DCGM_FI_DEV_GPU_UTIL a poor autoscaling signal for LLM serving?',options:['It is not exported by default','It measures the fraction of time any kernel runs, so it saturates near 100 % well before latency breaks','It is reported in MiB','It only works with MIG'],answer:1,explain:'GPU utilization is time-based; once kernels run continuously it reads ~100 % while queues can still grow a lot.'},
    {q:'Total in-flight requests are 130 and the KEDA threshold (AverageValue) is 24. How many replicas does HPA want?',options:['5','6','24','130'],answer:1,explain:'130 / 24 = 5.42 → ceil = 6.'},
    {q:'Why not scale on vllm:num_requests_waiting alone?',options:['It does not exist','After scale-up the queue drops to zero, prompting scale-down and recreating the queue (oscillation)','It is a histogram','KEDA cannot query it'],answer:1,explain:'A queue-only signal removes its own cause. Running + waiting stays proportional to demand after capacity catches up.'},
    {q:'Cold start is 7.6 min and demand can grow by 20 concurrent per minute. Per-replica target is 24. Spare replicas needed?',options:['2','5','7','20'],answer:2,explain:'20 × 7.6 = 152 concurrent; 152 / 24 = 6.33 → 7 replicas.'},
    {q:'Which change shortens cold start the most for a new GPU node?',options:['Lower pollingInterval from 15 s to 5 s','Keep warm nodes (balloon pods) with images pre-pulled and weights on local NVMe','Raise maxReplicaCount','Use the waiting-queue metric'],answer:1,explain:'Node launch and downloads dominate the budget; detection is seconds.'},
    {q:'What does DCGM_FI_DEV_XID_ERRORS report?',options:['A counter of all XID errors','The value of the last XID error encountered (a gauge)','GPU temperature','ECC-corrected bytes'],answer:1,explain:'Per the dcgm-exporter counters file it is a gauge of the last XID code; alert on non-zero/changes.'}
  ],
  flashcards:[
    {front:'Best primary autoscaling signal for vLLM',back:'vllm:num_requests_running + vllm:num_requests_waiting (total in-flight), target set below the SLO-safe concurrency per replica.'},
    {front:'HPA formula',back:'desired = ⌈currentReplicas × current / target⌉; for AverageValue external metrics = ⌈total / target per replica⌉.'},
    {front:'HPA default behavior',back:'Scale-up: no stabilization (up to 100 % or 4 pods per 15 s). Scale-down: 300 s stabilization window.'},
    {front:'Cold-start components',back:'Detect + node provision + image pull + weight download + load/warm-up + readiness propagation.'},
    {front:'Headroom rule',back:'Spare capacity ≥ demand growth rate × cold-start time.'},
    {front:'KV usage metric name (current vLLM)',back:'vllm:kv_cache_usage_perc (0–1). The old gpu_cache_usage_perc name is not listed any more.'},
    {front:'Scale-to-zero trade-off',back:'Saves idle GPU cost; first request waits a full cold start (minutes) and must be buffered. Fine for internal/rare endpoints.'}
  ]
});
registerGlossary([
  {term:'ScaledObject',def:'KEDA custom resource (keda.sh/v1alpha1) linking a workload to triggers, min/max replicas and HPA behavior.',lesson:'v1-k8s-autoscaling'},
  {term:'Scale to zero',def:'Autoscaling a workload to zero replicas when idle; saves cost but makes the next request wait a full cold start.',lesson:'v1-k8s-autoscaling'},
  {term:'Stabilization window',def:'HPA behavior setting: the period over which past recommendations are considered before scaling, damping flapping (default 300 s for scale-down).',lesson:'v1-k8s-autoscaling'}
]);

/* ---------- 1.6.4 Security, CI/CD, GitOps, rollback, readiness (capstone stage 5) ---------- */
registerLesson({
  id:'v1-k8s-production', vol:1, part:6, num:4,
  title:'Security, CI/CD, GitOps, rollback and production readiness (capstone stage 5)', minutes:95,
  summary:'A model endpoint that works is not yet a production service. It needs the usual Kubernetes hardening — pod security, network policy, secrets from a vault, signed images — plus things specific to AI: proof of where the model weights came from, a release that versions the model, tokenizer, adapter, prompt and engine together, and a canary that judges the new release on latency and answer quality, not just on pods being up. This lesson builds that pipeline with Argo CD and Argo Rollouts, shows how to roll back the whole release bundle at once, gives a production readiness checklist, and completes capstone stage five: deploying the Atlas assistant to Kubernetes.',
  objectives:[
    'Apply Pod Security Standards, NetworkPolicy and workload identity (IRSA / EKS Pod Identity) to a model-serving namespace.',
    'Sign and verify container images with cosign and model weights with OpenSSF model signing, and enforce verification at admission.',
    'Structure GitOps for AI with Argo CD ApplicationSets and sync waves.',
    'Design an Argo Rollouts canary with AnalysisTemplates on TTFT, error rate and evaluation score, and explain its GPU-specific limits.',
    'Define a release bundle (image, model, tokenizer, adapter, prompt, engine args) and roll it back atomically.',
    'Complete capstone stage 5 and state what is lab-validated versus untested at scale.'
  ],
  prereqs:['v1-k8s-serving','v1-k8s-autoscaling','v1-capstone-train','v1-benchmarking'],
  next:['v1-ai-apps-tools','v2-model-cicd','v2-ai-threat-model','v2-governance','v2-mcp-deploy'],
  tags:['kubernetes','security','gitops','argo','release','capstone'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Shipping a model is like a pharmacy dispensing medicine: the box (container image) must be sealed and traceable, the contents (weights) must match the label, the prescription (prompt and config) must match the medicine, and if a batch is bad you recall the whole batch, not just the box. Now the real mechanism.')}
<p>This lesson covers the <b>production layer</b> around a model server: <b>security</b> (who can run what, talk to whom, read which secrets, and whether artifacts are genuine), <b>delivery</b> (CI builds and verifies; GitOps declares; progressive delivery judges), <b>rollback</b> (of everything that changes behaviour), and <b>readiness</b> (a checklist you can defend). It ends with capstone stage 5: Atlas on Kubernetes.</p>

<h2>2. Why do we need it?</h2>
<ul>
<li>Model servers hold valuable assets (weights, tokens, customer prompts) and often run as root in large images with many dependencies.</li>
<li>Model artifacts are a supply-chain risk: pickle files can execute code on load; <code>trust_remote_code</code> runs Python from the model repo (see ${L('v2-ai-threat-model','AI threat modeling')}).</li>
<li>Behaviour changes come from more than code: a new tokenizer chat template, a LoRA adapter or a system-prompt edit can break answers while every pod is “Healthy”.</li>
<li>Rolling back only the image while the model, adapter and prompt stay new can produce a combination that was never tested.</li>
</ul>

<h2>3. How does it work internally?</h2>
<h3>3.1 Pod Security and the runtime boundary</h3>
<p>${term('Pod Security Standards')} define three levels — <b>privileged</b>, <b>baseline</b>, <b>restricted</b> — enforced per namespace by the built-in Pod Security Admission via labels:</p>
${code('yaml',`apiVersion: v1
kind: Namespace
metadata:
  name: atlas
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/warn: restricted`)}
<p><b>restricted</b> requires non-root, no privilege escalation, dropped capabilities and a seccomp profile. GPU <i>workloads</i> can run under it: device access is granted by the device plugin and runtime, not by privileges. The GPU <i>infrastructure</i> (driver container, toolkit, device plugin, DCGM) needs privileged access, so the <code>gpu-operator</code> namespace is labelled privileged and tightly access-controlled. Practical gotchas for vLLM under restricted: set <code>runAsNonRoot</code>/<code>runAsUser</code>, make cache directories writable (<code>HF_HOME</code> on an emptyDir), and use a read-only root filesystem where the image allows it.</p>
${code('yaml',`securityContext:            # container level
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  capabilities: { drop: ["ALL"] }
  seccompProfile: { type: RuntimeDefault }`)}

<h3>3.2 NetworkPolicy: who may talk to the model</h3>
${code('yaml',`apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: atlas-llm, namespace: atlas }
spec:
  podSelector: { matchLabels: { app: atlas-llm } }
  policyTypes: ["Ingress", "Egress"]
  ingress:
  - from:                                  # only the gateway may call the API
    - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: ai-gateway } }
    ports: [{ port: 8000 }]
  - from:                                  # Prometheus scrapes /metrics
    - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: monitoring } }
    ports: [{ port: 8000 }]
  egress:
  - to:                                    # DNS only; no internet, no HF Hub
    - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }
    ports: [{ port: 53, protocol: UDP }, { port: 53, protocol: TCP }]`)}
<p>Notes: NetworkPolicy needs a CNI that enforces it (Calico, Cilium, the VPC CNI with network policy enabled). Standard NetworkPolicy matches IPs/CIDRs and pods, not DNS names, so “allow S3 only” is done with VPC endpoints plus CIDR rules, or a CNI with FQDN policies. Denying internet egress also guarantees the engine cannot silently download weights. vLLM’s <code>--api-key</code> protects only the <code>/v1</code>-style paths, not <code>/metrics</code> or <code>/health</code>, so network policy is the real boundary; authentication belongs at the gateway.</p>

<h3>3.3 Secrets and workload identity</h3>
<ul>
<li><b>Never</b> in images, Helm values in Git, or command-line args (visible in <code>ps</code> and pod specs).</li>
<li>Source of truth in a vault (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault). The ${term('External Secrets Operator')} syncs selected keys into Kubernetes Secrets and refreshes them.</li>
<li>Cloud access without static keys: <b>IRSA</b> (IAM Roles for Service Accounts: a ServiceAccount annotated with <code>eks.amazonaws.com/role-arn</code>, trust via the cluster’s OIDC provider) or <b>EKS Pod Identity</b> (an agent on nodes plus an association created through the EKS API; no per-cluster OIDC trust policy to maintain). GKE uses Workload Identity Federation.</li>
</ul>
${code('yaml',`apiVersion: external-secrets.io/v1      # older installs: v1beta1
kind: ExternalSecret
metadata: { name: hf-token, namespace: atlas }
spec:
  refreshInterval: 1h
  secretStoreRef: { kind: ClusterSecretStore, name: aws-secrets-manager }
  target: { name: hf-token }
  data:
  - secretKey: token
    remoteRef: { key: atlas/hf-token }`)}
${code('bash',`# EKS Pod Identity: let the atlas-llm ServiceAccount read the model bucket
aws eks create-pod-identity-association --cluster-name atlas-prod --namespace atlas --service-account atlas-llm --role-arn arn:aws:iam::111122223333:role/atlas-model-reader`)}
${callout('unverified','API versions','Check the External Secrets Operator API version served by your installed release (<code>kubectl api-resources | grep externalsecrets</code>) before applying.')}

<h3>3.4 Signing images and models</h3>
<p><b>Images</b>: sign in CI by digest with ${term('cosign')} (Sigstore; latest v3.1.x, Oct 2026), keyless via the CI system’s OIDC identity, and verify at admission with a policy engine (Kyverno <code>verifyImages</code> or the Sigstore policy-controller) that checks the signer identity.</p>
${code('bash',`cosign sign --yes registry.example.com/atlas/vllm@sha256:4f1c...
cosign verify registry.example.com/atlas/vllm@sha256:4f1c... --certificate-identity-regexp 'https://github.com/example/atlas/.*' --certificate-oidc-issuer https://token.actions.githubusercontent.com`)}
<p><b>Models</b>: weights are not images, so sign the model directory too. The OpenSSF model-signing project (<code>sigstore/model-transparency</code>, PyPI <code>model-signing</code> 1.1.x) produces a Sigstore bundle covering every file’s hash:</p>
${code('bash',`model_signing sign models/atlas-1.7b-sft            # writes model.sig (Sigstore bundle)
model_signing verify models/atlas-1.7b-sft --signature model.sig   # plus identity flags for keyless`)}
<p>Provenance rules: load <b>safetensors</b>, not pickle (<code>.bin</code>/<code>.pt</code>) formats from untrusted sources; keep <code>trust_remote_code</code> off, or pin the model repo to a commit hash and review the code; mirror approved models into your own registry/bucket instead of pulling from a public hub at runtime; record model source, revision, license and evaluation results in the registry (${L('v2-mlops-foundations','MLOps foundations')}).</p>

<h3>3.5 GitOps with Argo CD</h3>
<p>CI builds, tests, scans, signs and evaluates; it then opens a pull request that changes <b>one file</b> in the deployment repo: the release bundle. ${term('Argo CD')} reconciles the cluster to Git. An <b>ApplicationSet</b> stamps one Application per environment/region from a template:</p>
${code('yaml',`apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata: { name: atlas-llm, namespace: argocd }
spec:
  generators:
  - list:
      elements:
      - { env: staging, server: https://staging.k8s.example.internal }
      - { env: prod-me, server: https://prod-me.k8s.example.internal }
  template:
    metadata: { name: 'atlas-llm-{{env}}' }
    spec:
      project: ai-serving
      source:
        repoURL: https://git.example.com/platform/atlas-deploy
        targetRevision: main
        path: charts/atlas-llm
        helm:
          valueFiles: ['values.yaml', 'envs/{{env}}.yaml', 'bundle.yaml']
      destination: { server: '{{server}}', namespace: atlas }
      syncPolicy:
        automated: { prune: true, selfHeal: true }`)}
<p><b>Sync waves</b> order resources within a sync with the annotation <code>argocd.argoproj.io/sync-wave</code> (lower first, default 0): e.g. wave <code>-2</code> namespace and NetworkPolicy, <code>-1</code> ExternalSecret and weight-prefetch Job, <code>0</code> Rollout and Service, <code>1</code> ScaledObject. A <code>PreSync</code> hook Job can run a smoke evaluation against staging before the sync proceeds.</p>
${callout('warn','“Synced and Healthy” is not “correct”','Argo CD’s health for a Deployment means the rollout finished and pods are ready. It knows nothing about answer quality or TTFT. That judgement belongs to progressive delivery analysis and evaluation.')}

<h3>3.6 Progressive delivery with Argo Rollouts</h3>
${anim('v1-k8s-canary')}
<p>${term('Argo Rollouts')} (v1.10, Oct 2026; CRDs Rollout, AnalysisTemplate, ClusterAnalysisTemplate, AnalysisRun, Experiment in <code>argoproj.io/v1alpha1</code>) replaces the Deployment with a Rollout that shifts traffic in steps and runs analysis between them.</p>
${code('yaml',`apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: atlas-llm, namespace: atlas }
spec:
  replicas: 4
  selector: { matchLabels: { app: atlas-llm } }
  template: { }        # same pod template as the Deployment in the serving lesson
  strategy:
    canary:
      stableService: atlas-stable
      canaryService: atlas-canary
      trafficRouting:  # weights set on a Gateway API HTTPRoute via the Rollouts plugin
        plugins:
          argoproj-labs/gatewayAPI: { httpRoute: atlas-route, namespace: atlas }
      steps:
      - setWeight: 10
      - analysis:
          templates: [{ templateName: llm-canary-slo }]
          args: [{ name: canary-hash, valueFrom: { podTemplateHashValue: Latest } }]
      - setWeight: 50
      - analysis:
          templates: [{ templateName: llm-canary-slo }]
          args: [{ name: canary-hash, valueFrom: { podTemplateHashValue: Latest } }]
      - setWeight: 100
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata: { name: llm-canary-slo, namespace: atlas }
spec:
  args: [{ name: canary-hash }]
  metrics:
  - name: ttft-p95
    interval: 1m
    count: 10
    failureLimit: 2                       # 3rd failure fails the run
    successCondition: result[0] < 1.5
    provider:
      prometheus:
        address: http://prometheus.monitoring.svc:9090
        query: |
          histogram_quantile(0.95, sum by (le) (rate(
            vllm:time_to_first_token_seconds_bucket{rollouts_pod_template_hash="{{args.canary-hash}}"}[5m])))
  - name: error-rate
    interval: 1m
    count: 10
    failureLimit: 1
    successCondition: result[0] < 0.01
    provider:
      prometheus:
        address: http://prometheus.monitoring.svc:9090
        query: |
          sum(rate(gateway_requests_total{backend="atlas-canary",code=~"5.."}[5m]))
          / sum(rate(gateway_requests_total{backend="atlas-canary"}[5m]))
  - name: online-eval
    interval: 5m
    count: 2
    successCondition: result[0] >= 0.85   # LLM-judge / rubric score on sampled canary traffic
    provider:
      prometheus:
        address: http://prometheus.monitoring.svc:9090
        query: avg(atlas_eval_score{pod_template_hash="{{args.canary-hash}}"})`)}
${callout('unverified','Labels and plugin names','<code>rollouts_pod_template_hash</code> only exists in Prometheus if your scrape config copies the pod label <code>rollouts-pod-template-hash</code> onto series. <code>gateway_requests_total</code> and <code>atlas_eval_score</code> are stand-ins for your gateway’s and eval job’s real metric names. Gateway API traffic routing is provided by an Argo Rollouts plugin; check its name and configuration for your Rollouts version.')}
<p><b>GPU-specific limits of canaries:</b></p>
<ul>
<li><b>Granularity.</b> Without traffic routing, Rollouts approximates weight by replica ratio: with 4 replicas the smallest step is 25 %. Use Gateway/mesh traffic routing for 5–10 % steps.</li>
<li><b>Spare GPUs.</b> The canary pod needs a GPU in addition to the stable fleet.</li>
<li><b>Statistical power.</b> At 10 % of a quiet service, ten minutes may contain too few long-prompt requests to see a KV-capacity regression (exactly what the animation shows surfacing at 50 %). Run analysis long enough, or replay a representative traffic sample against the canary first (shadow/experiment).</li>
<li><b>Quality signals</b> are slower and noisier than latency; combine an offline eval gate in CI (${L('v2-evaluation-monitoring','evaluation')}) with online sampled scoring during the canary.</li>
</ul>

<h3>3.7 The release bundle and full rollback</h3>
<p>A ${term('release bundle')} is the single versioned unit that determines model behaviour. Everything that can change an answer is pinned in it:</p>
${code('yaml',`# bundle.yaml — one file, one commit, one version
bundle:
  version: v8
  engineImage: registry.example.com/atlas/vllm@sha256:4f1c...     # engine + CUDA libs
  engineArgs: { maxModelLen: 8192, kvCacheDtype: auto, servedModelName: atlas }
  model:      { uri: s3://atlas-models/atlas-1.7b-sft, digest: sha256:9ab2... }
  tokenizer:  { digest: sha256:77e0..., chatTemplate: chat-templates/atlas-v3.jinja }
  adapter:    { name: travel-support-lora, digest: sha256:c3d1... }
  prompt:     { systemPrompt: prompts/atlas-system.md, version: 12 }
  evals:      { offlineReport: s3://atlas-evals/v8/report.json, score: 0.87 }`)}
<p>Rollback = <code>git revert</code> of the bundle commit; Argo CD syncs and the Rollout performs a fast rollback to the previous pod template. Because every artifact is addressed by digest and the previous ones are still in the registry/bucket (retention policy!), the old combination is restored exactly. Also: version response/semantic caches by bundle (so v8 answers are not served after rollback), and keep the previous weights in node caches so rollback does not pay a cold download.</p>
${table(['If you roll back only…','…while keeping new…','What can go wrong'],[
 ['Engine image','Model with a new architecture','Old engine cannot load the model; pods crash'],
 ['Model weights','Chat template','Template tokens the old model was not trained on → degraded or odd answers'],
 ['Base model','LoRA adapter','Adapter trained for another base: refuses to load or silently wrong'],
 ['Code and model','System prompt referencing new tools','Model calls tools the app no longer has']
])}

<h2>4. Where does it fit?</h2>
${fig('From commit to traffic: the AI release path', svgDiagram({w:900,h:340,
 zones:[{x:20,y:20,w:270,h:300,label:'CI (build + prove)'},{x:310,y:20,w:570,h:300,label:'CD (declare + judge)',cls:'ok'}],
 boxes:[
  {id:'b',x:40,y:50,w:230,h:50,label:'Build + scan image',sub:'SBOM, CVEs'},
  {id:'s',x:40,y:120,w:230,h:50,label:'Sign image + model',sub:'cosign, model-signing'},
  {id:'e',x:40,y:190,w:230,h:50,label:'Offline eval + load test',sub:'quality, TTFT/TPOT'},
  {id:'pr',x:40,y:260,w:230,h:50,label:'PR: bundle.yaml',sub:'digests only',cls:'hl'},
  {id:'git',x:330,y:260,w:150,h:50,label:'Git main',sub:'reviewed'},
  {id:'argo',x:520,y:260,w:150,h:50,label:'Argo CD',sub:'ApplicationSet'},
  {id:'adm',x:520,y:150,w:150,h:50,label:'Admission',sub:'PSA, verify sigs'},
  {id:'ro',x:710,y:150,w:150,h:50,label:'Argo Rollouts',sub:'canary + analysis',cls:'hl'},
  {id:'prod',x:710,y:50,w:150,h:50,label:'Production',sub:'stable bundle',cls:'ok'}
 ],
 arrows:[{from:'b',to:'s'},{from:'s',to:'e'},{from:'e',to:'pr'},{from:'pr',to:'git'},{from:'git',to:'argo'},{from:'argo',to:'adm'},{from:'adm',to:'ro'},{from:'ro',to:'prod',label:'promote'}]
}), 'CI proves the artifacts; Git declares the bundle; admission verifies signatures and pod security; Rollouts decides promotion from live SLO and eval metrics.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li>The model registry and eval pipeline produce the digests and reports the bundle references (${L('v2-model-cicd','model CI/CD')}).</li>
<li>The gateway enforces authentication, tenant quotas and records per-bundle metrics (${L('v2-ai-gateway','AI gateway')}).</li>
<li>Observability supplies the canary metrics (${L('v1-k8s-autoscaling','monitoring')}, ${L('v2-ai-observability','AI observability')}).</li>
<li>Governance consumes the audit trail: who approved which bundle, signed by whom, evaluated how (${L('v2-governance','governance')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<p>The pipeline, policies and guardrails: admission policies (PSA levels, signature verification), NetworkPolicy baselines, secret stores and identities, the deployment repo layout and ApplicationSets, Rollout and AnalysisTemplate libraries reused by every model team, artifact retention for rollback, and the readiness review. Model teams own the bundle contents and eval thresholds.</p>
${callout('devops','DevOps bridge','Everything here is familiar — PSA, NetworkPolicy, ESO, IRSA, cosign, Argo CD, Argo Rollouts. What is new is the <b>artifact set</b> (weights, tokenizer, adapter, prompt) and the <b>success metric</b> (TTFT, tokens, eval score). Extend your existing platform rather than building a parallel “ML platform” with weaker controls.')}

<h3>Production readiness checklist</h3>
${checklist([
 {key:'v1k8s-prr-gpu',text:'GPU type pinned by label; requests = limits; PDB set; spare GPU for surge or a documented blue/green pool.'},
 {key:'v1k8s-prr-probes',text:'startupProbe sized to measured load time; readiness on /health; conservative liveness; preStop + grace period ≥ longest stream.'},
 {key:'v1k8s-prr-weights',text:'Weights from an internal, versioned source by digest; HF_HUB_OFFLINE=1; no runtime internet egress.'},
 {key:'v1k8s-prr-sec',text:'Namespace enforces restricted Pod Security; non-root; NetworkPolicy default-deny with gateway + monitoring ingress only.'},
 {key:'v1k8s-prr-secrets',text:'Secrets via External Secrets / vault; workload identity (IRSA or Pod Identity), no static cloud keys.'},
 {key:'v1k8s-prr-sign',text:'Image signed and verified at admission; model directory signed; safetensors only; trust_remote_code off or pinned and reviewed.'},
 {key:'v1k8s-prr-bundle',text:'Release bundle pins image, engine args, model, tokenizer + chat template, adapter, prompt; previous bundle artifacts retained.'},
 {key:'v1k8s-prr-canary',text:'Canary with analysis on TTFT p95, error rate and an eval score; tested abort; rollback by git revert rehearsed.'},
 {key:'v1k8s-prr-scale',text:'KEDA on running + waiting with load-tested target; HPA behavior tuned; cold-start time measured; warm headroom sized.'},
 {key:'v1k8s-prr-obs',text:'Dashboard (SLO, demand, saturation, scaling, GPU health, cost); alerts on SLO burn, XID, scaler errors, Pending GPU pods.'},
 {key:'v1k8s-prr-gw',text:'Gateway: authentication, per-tenant token and concurrency limits, max output tokens, request timeouts, audit logging with redaction.'},
 {key:'v1k8s-prr-runbook',text:'Runbooks: GPU node failure, model rollback, capacity shortage, driver upgrade; on-call knows them.'}
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['Pods rejected: “violates PodSecurity restricted”','Image runs as root / needs writable root FS','Admission error text','Set runAsUser, writable cache emptyDir, adjust image'],
 ['Pods rejected by signature policy','Unsigned digest or wrong signer identity','Kyverno/policy-controller event','Sign in CI; fix identity regexp; never bypass in prod'],
 ['Pods cannot reach model bucket','NetworkPolicy or missing IAM role','Timeouts vs AccessDenied in logs','VPC endpoint CIDR rule; Pod Identity association'],
 ['Canary passes, full rollout degrades','Analysis too short / too little traffic at low weight','Analysis sample counts; prompt-length mix','Longer analysis, traffic replay, more steps'],
 ['Rollback restores image but answers still wrong','Only part of the bundle reverted; cache serving new answers','Bundle diff; cache keys','Revert whole bundle; version caches by bundle'],
 ['Argo CD keeps reverting a hot-fix','Manual change in cluster with selfHeal on','Argo CD diff','Fix in Git; that is the point']
])}

<h2>8. How do we scale it?</h2>
<p>From one model to a platform: an ApplicationSet per model team (git or cluster generators), shared Rollout/Analysis templates, a central policy library, and bundles per region (data residency: a GCC deployment may need the model served in-country — see ${L('v2-multi-region','multi-region')}). Promotion moves the same bundle digest through staging → one region → all regions with automated analysis at each gate.</p>

<h2>9. How do we optimize its cost?</h2>
<p>Canaries cost spare GPUs and time: one surge L4 for a 40-minute canary is ≈ 0.67 h × $0.8048 ≈ $0.54 (on-demand, 2026-10-12 feed) — negligible against one bad release. The expensive mistakes are slow rollouts that hold double capacity for hours (blue/green with 20 GPUs held for 2 h = 40 extra GPU-hours) and rollbacks that re-download weights. Keep previous weights cached, run traffic replay in staging on smaller GPUs where possible, and size canary steps to reach statistical confidence quickly.</p>

<h2>Capstone stage 5: deploy Atlas to Kubernetes</h2>
<p><b>What changed since stage 4</b> (${L('v1-benchmarking','serve with vLLM and benchmark')}): the LoRA-tuned Atlas model (${L('v1-capstone-train','stages 1–3')}) moves from a single <code>vllm serve</code> process to a Kubernetes service with GPU scheduling, probes, autoscaling, GitOps and a canary. The architecture gains a control plane; the model and engine are unchanged.</p>
${fig('Atlas stage 5 architecture', svgDiagram({w:900,h:320,
 zones:[{x:240,y:20,w:640,h:280,label:'EKS/GKE cluster — namespace atlas (restricted PSA, default-deny NetworkPolicy)'}],
 boxes:[
  {id:'u',x:20,y:130,w:190,h:56,label:'Support agents app',sub:'OpenAI SDK'},
  {id:'gw',x:260,y:130,w:150,h:56,label:'Gateway',sub:'auth, quotas'},
  {id:'svc',x:440,y:130,w:150,h:56,label:'Service / Pool',sub:'stable + canary'},
  {id:'r',x:620,y:60,w:240,h:56,label:'Rollout: 2–8 × vLLM',sub:'1 × L4 each, Atlas 1.7B+LoRA',cls:'ok'},
  {id:'k',x:620,y:150,w:240,h:56,label:'KEDA ScaledObject',sub:'running + waiting, target 24'},
  {id:'w',x:620,y:235,w:240,h:50,label:'Weights PVC / image volume',sub:'digest-pinned',cls:'v2'},
  {id:'a',x:260,y:235,w:330,h:50,label:'Argo CD + Rollouts',sub:'bundle.yaml from Git',cls:'hl'}
 ],
 arrows:[{from:'u',to:'gw'},{from:'gw',to:'svc'},{from:'svc',to:'r'},{from:'k',to:'r',fromSide:'top',toSide:'bottom'},{from:'a',to:'svc',fromSide:'top',toSide:'bottom',cls:'dash'}]
}), 'Stage 5 adds the Kubernetes control plane around the stage-4 engine. RAG, MCP tools and agents arrive in Volume 2.')}
<p><b>Planned lab</b>: the Helm chart <code>labs/06-k8s/atlas-llm/</code> (see <code>labs/README.md</code>) renders the vLLM Deployment with probes, PDB, KEDA ScaledObject, NetworkPolicy and ServiceMonitor, with key files <code>templates/deployment.yaml</code>, <code>templates/keda.yaml</code> and <code>values.yaml</code>. Steps:</p>
<ol>
<li>Without a GPU: create a local cluster (kind or k3d), set chart values to run the stdlib mock OpenAI server (<code>labs/05-serving/mock_openai_server.py</code>) instead of vLLM, and verify probes, NetworkPolicy (with a policy-enforcing CNI), rollout and draining with the bench client.</li>
<li>With a GPU cluster: install the GPU Operator (or use a managed GPU node pool), label/taint the pool, install KEDA and Prometheus, then deploy the chart with the real vLLM image and the stage-3 weights from a PVC or image volume.</li>
<li>Run <code>labs/05-serving/bench_client.py</code> at rising concurrency and watch KEDA scale; record cold-start breakdown.</li>
<li>Commit a bundle change (e.g. a new system prompt version), let Argo CD sync and Argo Rollouts canary it; then force a failing analysis (lower the TTFT threshold) and observe the abort; finish with a <code>git revert</code>.</li>
</ol>
${callout('warn','Lab-validated versus not','What a lab can demonstrate: the manifests are valid, probes/draining/rollback behave as described, KEDA reacts to load, and the cold-start breakdown on your hardware. What it does <b>not</b> demonstrate: behaviour at production traffic levels, multi-zone capacity shortages, real user quality metrics, or long-run cost. Describe it in interviews as “demonstrated in a lab”, never as production experience.')}

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How do you roll out a new model version safely, and how do you roll back?”','<p><i>Answer (≈60 s):</i> "I treat the release as a bundle: engine image digest, engine flags, model weights digest, tokenizer and chat template, LoRA adapter and system-prompt version, all in one Git commit after CI has signed the image and the weights and passed offline evals and a load test. Argo CD syncs it; Argo Rollouts canaries it through Gateway API weights with an AnalysisTemplate on canary-only TTFT p95, error rate and a sampled online eval score, and aborts automatically if any fails. Rollback is a git revert of the bundle, so every artifact moves back together, and caches are keyed by bundle. The GPU-specific caveats are that the canary needs a spare GPU and enough traffic at low weight to catch regressions like long-context KV pressure."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Change the image tag, let Argo CD sync, and roll back with <code>kubectl rollout undo</code> if pods crash."</p></div><div class="good"><h4>Strong answer</h4><p>Bundle versioning, signed artifacts, metric-based canary analysis including quality, and atomic Git-based rollback.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['CI: build, sign, eval','bundle.yaml PR','Argo CD sync','admission checks','Rollouts canary','analysis','promote or abort'])}
${chain(['bundle digest','cache keys','metrics labels','audit trail','rollback'])}
<p>Next: ${L('v1-ai-apps-tools','build applications on the endpoint')}. Deeper: ${L('v2-model-cicd','model CI/CD and prompt versioning')}, ${L('v2-ai-threat-model','AI threat modeling')} and ${L('v2-mcp-deploy','deploying MCP servers')} with the same patterns.</p></div>
`,
  quiz:[
    {q:'Which namespace typically needs the privileged Pod Security level in a GPU cluster?',options:['The model-serving namespace','The GPU Operator namespace (driver, toolkit, device plugin)','kube-public','Every namespace with GPU pods'],answer:1,explain:'Infrastructure that loads drivers and touches the host needs privileges; GPU workloads get devices via the plugin and runtime and can run under restricted.'},
    {q:'Argo CD shows the Atlas app Synced and Healthy. What does that guarantee?',options:['Answers are correct','Cluster resources match Git and rollouts completed with ready pods','TTFT meets the SLO','The model is signed'],answer:1,explain:'Argo CD health is resource health. Quality and latency need analysis and evaluation.'},
    {q:'A rollback reverted only the engine image. Answers are still degraded. Most likely reason?',options:['Argo CD is broken','Other bundle parts (model, tokenizer template, adapter, prompt) or caches still reflect the new release','The GPU driver changed','The PDB blocked it'],answer:1,explain:'Behaviour depends on the whole bundle and caches; revert the bundle atomically and key caches by bundle.'},
    {q:'With 4 replicas and no traffic-routing integration, what is the smallest canary weight Argo Rollouts can achieve?',options:['1 %','10 %','25 %','50 %'],answer:2,explain:'Without traffic routing, weight is approximated by replica ratio: 1 of 4 pods = 25 %.'},
    {q:'Why deny internet egress from the model-serving pods?',options:['To reduce GPU memory','So the engine cannot silently download unreviewed weights or exfiltrate data; weights come only from internal, signed sources','Because vLLM requires it','To speed up probes'],answer:1,explain:'It enforces the provenance path and limits exfiltration; it also makes a missing local file fail fast.'},
    {q:'In an AnalysisTemplate metric with failureLimit: 2, when does the AnalysisRun fail?',options:['On the first failed measurement','On the second failed measurement','On the third failed measurement','Never'],answer:2,explain:'The run fails when failures exceed failureLimit, i.e. on the 3rd failure.'}
  ],
  flashcards:[
    {front:'Pod Security Standards levels',back:'privileged, baseline, restricted; enforced per namespace via pod-security.kubernetes.io/enforce label.'},
    {front:'IRSA vs EKS Pod Identity',back:'IRSA: ServiceAccount annotated with role ARN, trust via cluster OIDC provider. Pod Identity: node agent + association via EKS API, no per-cluster OIDC trust policy.'},
    {front:'What goes in a release bundle?',back:'Engine image digest, engine args, model weights digest, tokenizer + chat template, adapter, system-prompt version, eval report.'},
    {front:'Sync waves',back:'argocd.argoproj.io/sync-wave annotation orders resources within a sync (lower first, default 0).'},
    {front:'Canary metrics for an LLM',back:'Canary-only TTFT p95, error rate, and an online eval/quality score; plus enough traffic to be meaningful.'},
    {front:'How to sign model weights',back:'OpenSSF model-signing (model_signing sign on the model directory) → Sigstore bundle over all file hashes; verify before load.'},
    {front:'Why NetworkPolicy matters with vLLM --api-key',back:'The API key protects only /v1-style paths, not /metrics or /health; network policy is the real boundary.'}
  ]
});
registerGlossary([
  {term:'Pod Security Standards',def:'Kubernetes security profiles (privileged, baseline, restricted) enforced per namespace by Pod Security Admission labels.',lesson:'v1-k8s-production',aliases:['PSS','Pod Security Admission']},
  {term:'External Secrets Operator',def:'Kubernetes operator that syncs secrets from external stores (AWS Secrets Manager, Vault, GCP Secret Manager) into Kubernetes Secrets.',lesson:'v1-k8s-production',aliases:['ESO']},
  {term:'IRSA',def:'IAM Roles for Service Accounts: EKS mechanism mapping a ServiceAccount to an IAM role through the cluster OIDC provider.',lesson:'v1-k8s-production'},
  {term:'EKS Pod Identity',def:'EKS mechanism granting IAM roles to ServiceAccounts through a node agent and API-managed associations, without per-cluster OIDC trust policies.',lesson:'v1-k8s-production'},
  {term:'cosign',def:'Sigstore CLI for signing and verifying container images and blobs, including keyless signing with OIDC identities.',lesson:'v1-k8s-production'},
  {term:'Argo CD',def:'GitOps controller that continuously reconciles Kubernetes resources to manifests in Git; ApplicationSets generate many Applications from templates.',lesson:'v1-k8s-production',aliases:['ApplicationSet']},
  {term:'Argo Rollouts',def:'Progressive-delivery controller providing canary and blue/green Rollouts with metric-driven AnalysisTemplates and automatic abort.',lesson:'v1-k8s-production',aliases:['AnalysisTemplate']}
]);

/* ---------- 1.6.5 From model to application ---------- */
registerLesson({
  id:'v1-ai-apps-tools', vol:1, part:6, num:5,
  title:'From model to application: APIs, structured output, tool calling and a first look at MCP', minutes:80,
  summary:'Applications talk to a served model through an HTTP API, and almost every engine and provider now speaks the same shape: the OpenAI-compatible chat completions API, with answers streamed back token by token as server-sent events. To build reliable software on top, the model must often return valid JSON, which engines guarantee by masking every token that would break a schema before sampling. And to act in the world, the model proposes tool calls that the application validates, authorizes and executes in a loop. This lesson explains each of these mechanisms, with numbers, and ends with a first look at the Model Context Protocol, the standard way to connect tools to AI applications.',
  objectives:[
    'Write and read a Chat Completions request and response, including roles, finish_reason and usage.',
    'Explain server-sent-event streaming, how clients assemble deltas, and how TTFT appears to users.',
    'Explain constrained decoding (grammar → allowed-token mask → logits set to −∞) and compute how masking changes token probabilities.',
    'Implement the tool-calling loop with validation, authorization, iteration caps and idempotency, and estimate its token cost.',
    'Describe MCP’s host/client/server roles, why a protocol helps, and the difference between the 2025-11-25 and 2026-07-28 spec revisions.'
  ],
  prereqs:['v1-generation','v1-tokenization-embeddings','v1-k8s-serving'],
  next:['v2-mcp-why','v2-mcp-protocol','v2-agents','v2-ai-gateway','v2-rag-fundamentals'],
  tags:['api','structured-output','tool-calling','mcp','applications'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','The model is a very capable consultant who can only speak. The application is the office around them: it hands over the case file (messages), asks for answers on a specific form (structured output), and when the consultant says “please look up booking ABC123”, a clerk with the right permissions does it and brings back the result (tool calling). The consultant never touches the filing cabinet. Now the real mechanism.')}
<p>Four application-layer mechanisms sit between a served model and a product:</p>
<ol>
<li>The ${term('Chat Completions API')}: a JSON-over-HTTP contract for sending a conversation and receiving the next assistant message.</li>
<li><b>Streaming</b> with ${term('server-sent events')} (SSE): the answer arrives as many small chunks as tokens are generated.</li>
<li>${term('Structured output')}: forcing the output to match a JSON Schema using ${term('constrained decoding')}.</li>
<li>${term('Tool calling')}: the model emits a structured request to run a function; the application runs it and returns the result.</li>
</ol>
<p>And a first look at ${term('MCP')}, the Model Context Protocol, which standardises how applications discover and call tools and data sources.</p>

<h2>2. Why do we need it?</h2>
<ul>
<li><b>Portability</b>: vLLM, SGLang, TensorRT-LLM, Dynamo and most hosted providers expose OpenAI-compatible endpoints. One client library and one gateway can front all of them, and switching from a hosted model to self-hosted Atlas is a base-URL change.</li>
<li><b>Perceived latency</b>: a 400-token answer at 30 ms per token takes 12 s to finish; streaming shows the first words after the TTFT (e.g. 0.4 s).</li>
<li><b>Reliability</b>: code cannot parse “Sure! Here is the JSON you asked for: …”. Schema-constrained output removes a whole class of parsing failures.</li>
<li><b>Action</b>: answering “where is my booking?” requires reading a system of record. Tool calling lets a model request that safely, with the application in control.</li>
</ul>

<h2>3. How does it work internally?</h2>
<h3>3.1 The Chat Completions request and response</h3>
${code('json',`POST /v1/chat/completions
{
  "model": "atlas",
  "messages": [
    {"role": "system", "content": "You are Atlas, a travel-support assistant. Answer briefly."},
    {"role": "user",   "content": "Can I bring a 23 kg bag on an economy ticket to Jeddah?"}
  ],
  "temperature": 0.2,
  "max_tokens": 300,
  "stream": false
}`)}
${code('json',`{
  "id": "chatcmpl-7f3a",
  "object": "chat.completion",
  "model": "atlas",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "It depends on your fare: ..."},
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 41, "completion_tokens": 58, "total_tokens": 99}
}`)}
<ul>
<li><b>Roles</b>: <code>system</code> (instructions), <code>user</code>, <code>assistant</code> (previous model turns), <code>tool</code> (tool results). The engine renders them into one token sequence with the model’s <b>chat template</b> — which is why the tokenizer’s template is part of the release bundle (${L('v1-k8s-production','production lesson')}).</li>
<li><b>Stateless</b>: the server keeps no conversation. Every call sends the full history; cost and prefill grow with the conversation (prefix caching softens this: ${L('v2-prefix-kv-cache','prefix caching')}).</li>
<li><b><code>finish_reason</code></b>: <code>stop</code> (natural end or stop sequence), <code>length</code> (hit <code>max_tokens</code> — the answer is truncated), <code>tool_calls</code> (the model wants a tool run).</li>
<li><b><code>usage</code></b>: token counts for metering and cost; the gateway records them per tenant.</li>
</ul>
<p>vLLM also serves the newer <code>/v1/responses</code> endpoint and an Anthropic-compatible <code>/v1/messages</code> (verified Oct 2026); the concepts below carry over.</p>

<h3>3.2 Streaming with server-sent events</h3>
<p>With <code>"stream": true</code> the response is <code>Content-Type: text/event-stream</code>. Each event is a line starting with <code>data: </code> carrying a JSON chunk whose <code>delta</code> holds the new text; a blank line ends the event; the stream ends with <code>data: [DONE]</code>.</p>
${code('text',`data: {"id":"chatcmpl-7f3a","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}

data: {"id":"chatcmpl-7f3a","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"It"}}]}

data: {"id":"chatcmpl-7f3a","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" depends"}}]}

data: {"id":"chatcmpl-7f3a","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]`)}
<p>The client concatenates <code>delta.content</code>. With <code>"stream_options": {"include_usage": true}</code> a final chunk carries <code>usage</code>. Tool calls stream too: their <code>arguments</code> arrive as string fragments to concatenate before parsing.</p>
${formula(`
User-visible timing for a streamed answer of n output tokens

  first words appear at      TTFT
  answer complete at         TTFT + (n − 1) × TPOT

  n = 400, TTFT = 0.4 s, TPOT = 30 ms
  complete = 0.4 + 399 × 0.030 = 0.4 + 11.97 ≈ 12.4 s
  without streaming the user stares at nothing for ≈ 12.4 s
`)}
${callout('devops','DevOps bridge','SSE is a long-lived HTTP response. Every hop must not buffer it (disable proxy buffering for the route, e.g. <code>X-Accel-Buffering: no</code> on nginx), idle timeouts must exceed the longest gap between tokens and total timeouts the longest answer, and load balancers must allow minutes-long responses. This is the same reason pod shutdown must drain ('+L('v1-k8s-serving','serving lesson')+'). If a stream breaks, the client cannot resume it; it must retry the whole request, paying again.')}

<h3>3.3 Structured output and constrained decoding</h3>
<p>Two ways to ask for JSON: <b>prompting</b> (“reply in JSON”) — usually works, sometimes does not — and <b>constrained decoding</b>, which makes invalid output impossible. In the OpenAI-compatible API you pass a schema:</p>
${code('json',`"response_format": {
  "type": "json_schema",
  "json_schema": {
    "name": "booking_status",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "booking_ref": {"type": "string"},
        "status": {"type": "string", "enum": ["confirmed", "cancelled", "pending"]}
      },
      "required": ["booking_ref", "status"],
      "additionalProperties": false
    }
  }
}`)}
<p><b>How it works.</b> The engine compiles the schema into a grammar (a finite-state machine or pushdown automaton over characters). At every decode step it computes, from the grammar state, which vocabulary tokens are legal next, builds a <b>mask</b>, sets the logits of illegal tokens to −∞, and only then applies softmax and sampling. Illegal tokens get probability exactly zero. After sampling, the grammar state advances by the chosen token’s characters.</p>
${formula(`
Decode step: the schema now requires the value of "status"

token          logit    allowed?
"maybe"         2.0       no   (not in the enum)
"confirmed"     1.2       yes
"cancelled"     0.4       yes
"pending"      −0.3       yes

STEP 1  without a mask (softmax over all four)
        exp: 7.389, 3.320, 1.492, 0.741      Σ = 12.942
        p("maybe") = 7.389 / 12.942 ≈ 0.571   ← invalid output 57 % of the time

STEP 2  with the mask: logit("maybe") → −∞, exp(−∞) = 0
        Σ = 3.320 + 1.492 + 0.741 = 5.553

                         exp(1.2)       3.320
        p("confirmed") = ─────────── = ─────── ≈ 0.598
                            Σ           5.553
        p("cancelled") = 1.492 / 5.553 ≈ 0.269
        p("pending")   = 0.741 / 5.553 ≈ 0.133

ANSWER  The relative order of the legal tokens is preserved; the illegal one is
        removed. Syntax is guaranteed — truth is not.
`)}
<ul>
<li><b>In vLLM</b> (verified Oct 2026): structured outputs are configured with <code>--structured-outputs-config</code> (backend <code>auto</code> by default; backends include xgrammar and guidance); requests use <code>response_format</code> with a JSON schema or the <code>structured_outputs</code> field (choice, regex, json, grammar). The older <code>guided_*</code> request parameters were removed in v0.12.0 — old tutorials using them will fail.</li>
<li><b>Costs and caveats</b>: computing the mask adds per-token CPU work (modern backends precompute most of it); constraining can push a model into low-probability paths and lower answer quality if the schema fights what the model wants to say; a <code>length</code> finish can still cut JSON off mid-object, so set <code>max_tokens</code> generously and check <code>finish_reason</code>; and valid JSON can still contain a wrong booking reference. Validate semantics in code.</li>
</ul>

<h3>3.4 Tool calling: the loop</h3>
${anim('v1-k8s-tool-loop')}
<p>You describe tools to the model with JSON Schema; the model may answer with <code>tool_calls</code> instead of text:</p>
${code('json',`"tools": [{
  "type": "function",
  "function": {
    "name": "get_booking",
    "description": "Read one booking owned by the signed-in customer. Read-only.",
    "parameters": {
      "type": "object",
      "properties": {"booking_ref": {"type": "string", "pattern": "^[A-Z0-9]{6}$"}},
      "required": ["booking_ref"],
      "additionalProperties": false
    }
  }
}]

// model reply
"message": {
  "role": "assistant",
  "content": null,
  "tool_calls": [{"id": "call_1", "type": "function",
                  "function": {"name": "get_booking", "arguments": "..."}}]
},
"finish_reason": "tool_calls"
// arguments is a JSON *string* to parse: {"booking_ref": "ABC123"}`)}
<p>The application then runs the loop:</p>
${code('python',`messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]
for step in range(5):                                   # hard cap on iterations
    r = client.chat.completions.create(model="atlas", messages=messages, tools=TOOLS)
    choice = r.choices[0]
    messages.append(choice.message)
    if choice.finish_reason != "tool_calls":
        break                                           # final answer
    for call in choice.message.tool_calls:
        result = run_tool(call.function.name,           # parse JSON, validate schema,
                          call.function.arguments,      # authorize against the SESSION user,
                          user=session.user)            # require approval for writes
        messages.append({"role": "tool", "tool_call_id": call.id, "content": result})`)}
<p>The rules that make it safe (more in ${L('v2-agents','agents')} and ${L('v2-mcp-security','MCP security')}):</p>
<ol>
<li><b>The model proposes; the application decides.</b> A tool call is just generated text in a structured shape. Authority comes from the application’s identity and policy, never from the prompt.</li>
<li><b>Validate</b> arguments against the schema (they may be malformed or hallucinated); return validation errors as tool results so the model can correct itself.</li>
<li><b>Authorize</b> using the session: the model can write any booking reference; only the app knows whose session this is.</li>
<li><b>Separate reads from writes</b>; writes need confirmation, idempotency keys and audit logs.</li>
<li><b>Bound the loop</b>: max iterations, total deadline, token budget.</li>
<li><b>Treat tool output as untrusted data</b>: a booking note saying “ignore previous instructions” is prompt injection.</li>
</ol>
${callout('unverified','Engine flags for tool calling','In vLLM, automatic tool calling for open-weight models is enabled with server flags (<code>--enable-auto-tool-choice</code> and a model-specific <code>--tool-call-parser</code>, e.g. a Hermes-style parser for Qwen-family models). Parser names and the right template depend on your model and vLLM version; check the tool-calling docs for your pinned release and test parsing with your exact model.')}
${formula(`
Token cost of a 3-call tool loop (illustrative sizes)

call 1 input  = system 800 + tool schemas 1,200 + user 100       = 2,100
       output = tool call                                         =    60
call 2 input  = 2,100 + 60 + tool result 900                      = 3,060
       output = second tool call                                  =    70
call 3 input  = 3,060 + 70 + tool result 400                      = 3,530
       output = final answer                                      =   250

total input   = 2,100 + 3,060 + 3,530 = 8,690   (≈ 4.1 × a single call)
total output  =    60 +    70 +   250 =   380
latency       ≈ 3 × TTFT + decode of 380 tokens + 2 tool round trips
`)}
<p>Tool schemas are sent on every call: ten verbose tools can cost thousands of input tokens per request. Keep descriptions tight, expose only the tools relevant to the task, and rely on prefix caching by keeping the system prompt and tool list byte-identical and first.</p>

<h3>3.5 A first look at MCP</h3>
<p>Every application above defines its own tools in its own code. With N AI applications (chat assistant, IDE agent, ops bot) and M systems (bookings, Jira, Kubernetes, Confluence), that is up to N × M custom integrations. The <b>Model Context Protocol</b> defines one way for an AI application to <i>discover and call</i> tools, read resources and fetch prompt templates from a server, so each system is wrapped once and each application implements the protocol once: N + M.</p>
${fig('MCP roles: the host owns the model loop and the policy', svgDiagram({w:900,h:300,
 zones:[{x:20,y:20,w:420,h:260,label:'Host application (e.g. Atlas app, IDE, desktop assistant)'}],
 boxes:[
  {id:'loop',x:40,y:60,w:180,h:56,label:'Model + tool loop',sub:'this lesson',cls:'hl'},
  {id:'c1',x:250,y:60,w:170,h:56,label:'MCP client 1'},
  {id:'c2',x:250,y:180,w:170,h:56,label:'MCP client 2'},
  {id:'pol',x:40,y:180,w:180,h:56,label:'Consent + policy',sub:'approvals, scopes'},
  {id:'s1',x:520,y:60,w:200,h:56,label:'MCP server: bookings',sub:'tools, resources',cls:'ok'},
  {id:'s2',x:520,y:180,w:200,h:56,label:'MCP server: k8s ops',sub:'read-only tools',cls:'ok'},
  {id:'api',x:760,y:120,w:120,h:56,label:'Real APIs',sub:'DB, cluster'}
 ],
 arrows:[{from:'loop',to:'c1'},{from:'c1',to:'s1',label:'JSON-RPC'},{from:'c2',to:'s2',label:'JSON-RPC'},{from:'s1',to:'api'},{from:'s2',to:'api'},{from:'loop',to:'pol',fromSide:'bottom',toSide:'top',cls:'dash'}]
}), 'One client per server connection inside the host. Servers expose tools, resources and prompts; the host still decides what runs.')}
<ul>
<li><b>Roles</b> (spec wording): <b>hosts</b> are the LLM applications; <b>clients</b> are connectors inside the host; <b>servers</b> provide context and capabilities. Messages are <b>JSON-RPC 2.0</b>, over <b>stdio</b> (local subprocess) or <b>Streamable HTTP</b> (remote).</li>
<li><b>Server primitives</b>: tools (actions, with JSON Schema inputs — the same idea as function calling), resources (readable data) and prompts (templates).</li>
<li><b>What MCP does not change</b>: the model still only proposes; the host still validates, authorizes and asks for approval. MCP standardises the plumbing, not the trust decisions.</li>
</ul>
<p><b>Which spec revision?</b> As of Oct 2026 the <b>current</b> revision is <b>2026-07-28</b>, a breaking redesign: stateless, with no <code>initialize</code> handshake and no <code>Mcp-Session-Id</code>; servers implement <code>server/discover</code>; every request carries its protocol version and client capabilities in <code>_meta</code>. The previous revision, <b>2025-11-25</b>, uses an <code>initialize</code> handshake and sessions, and is still what most clients and tutorials show. Always say which era you mean. ${L('v2-mcp-why','Why MCP exists')} and ${L('v2-mcp-protocol','Inside MCP')} teach both in depth.</p>

<h2>4. Where does it fit?</h2>
${fig('Application layer on top of the Kubernetes serving stack', svgDiagram({w:900,h:300,
 boxes:[
  {id:'ui',x:20,y:120,w:150,h:56,label:'Chat UI',sub:'renders SSE'},
  {id:'app',x:210,y:120,w:170,h:56,label:'Atlas app',sub:'loop, schemas, policy',cls:'hl'},
  {id:'gw',x:420,y:120,w:150,h:56,label:'AI gateway',sub:'auth, tokens, quotas'},
  {id:'eng',x:610,y:120,w:150,h:56,label:'vLLM pods',sub:'constrained decoding'},
  {id:'tools',x:210,y:230,w:170,h:56,label:'Tools / MCP servers',sub:'booking, ops',cls:'ok'},
  {id:'k8s',x:610,y:230,w:270,h:56,label:'Kubernetes GPU platform',sub:'lessons 1.6.1–1.6.4',cls:'v2'}
 ],
 arrows:[{from:'ui',to:'app',label:'SSE',both:true},{from:'app',to:'gw',label:'/v1/chat/completions'},{from:'gw',to:'eng'},{from:'app',to:'tools'},{from:'eng',to:'k8s',fromSide:'bottom',toSide:'top',cls:'dash'}]
}), 'The application owns conversation state, schemas, tool execution and policy. The gateway and engine are shared platform services.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Engine</b>: structured outputs and tool-call parsing run inside the engine (${L('v1-engines','engines')}); chat templates come from the tokenizer.</li>
<li><b>Gateway</b>: meters <code>usage</code>, enforces max tokens, holds SSE connections, routes models (${L('v2-ai-gateway','AI gateway')}).</li>
<li><b>RAG</b>: retrieval is often exposed as a tool or done before the call (${L('v2-rag-fundamentals','RAG fundamentals')}).</li>
<li><b>Agents</b>: an agent is this loop plus planning, memory and longer autonomy (${L('v2-agents','agents')}).</li>
<li><b>Observability</b>: each model call and tool call becomes a span (OpenTelemetry GenAI conventions, ${L('v2-ai-observability','AI observability')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li>The OpenAI-compatible endpoint contract and its versioning (model names, max tokens, supported features such as tools and JSON schema).</li>
<li>Proxy/LB configuration for SSE: buffering off, timeouts, connection limits, draining.</li>
<li>Engine flags for structured outputs and tool parsing, tested per model.</li>
<li>Tool infrastructure: service identities, least-privilege credentials, rate limits, audit logs, approval workflow services; MCP server hosting (${L('v2-mcp-deploy','deploying MCP')}).</li>
<li>Telemetry: tokens per call, calls per conversation, tool error rates, loop lengths.</li>
</ul>

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['Answers cut off mid-sentence','<code>finish_reason: "length"</code> (max_tokens)','finish_reason in logs','Raise max_tokens; ask for shorter answers; detect and continue'],
 ['Streaming arrives all at once at the end','A proxy buffers the response','Time-to-first-byte ≈ total time at client; fine at engine','Disable buffering on the route'],
 ['Streams die after 60 s','Idle/total timeout on LB or ingress','Gateway 504s at fixed duration','Raise timeouts for the AI route'],
 ['JSON parse errors with prompt-only JSON','No constrained decoding','Parse error rate','Use response_format json_schema; validate'],
 ['Requests with guided_json rejected after upgrade','guided_* parameters removed in vLLM v0.12.0','400 errors after engine upgrade','Move to response_format / structured_outputs'],
 ['Model never calls tools / prints tool JSON as text','Tool parsing not enabled or wrong parser/template','Raw output contains tool markup','Enable auto tool choice with the right parser; test per model'],
 ['Loop runs forever / costs spike','No iteration cap; model retries failing tool','Calls per conversation histogram','Cap iterations and tokens; return clear tool errors'],
 ['Tool executed on someone else’s booking','Authorization derived from model arguments','Audit log: user ≠ owner','Authorize from session; never from model output']
])}

<h2>8. How do we scale it?</h2>
<p>Application servers are ordinary stateless services, but they hold many long SSE connections: scale on concurrent connections, not CPU, and use async I/O. Push shared prefixes (system prompt, tool list) first to maximise prefix-cache hits. Run tools concurrently when the model emits parallel tool calls. Separate interactive traffic from batch (e.g. bulk classification with structured output) into different gateway priorities or model pools.</p>

<h2>9. How do we optimize its cost?</h2>
<ul>
<li>Every loop iteration re-sends the context: from the worked example, 8,690 input tokens instead of 2,100. Fewer, smarter tools and deterministic code paths for simple cases (e.g. regex-detect a booking reference and call <code>get_booking</code> directly) cut calls.</li>
<li>Prefix caching (self-hosted) and provider prompt caching (hosted) make repeated prefixes much cheaper (${L('v2-prefix-kv-cache','prefix caching')}).</li>
<li>Constrained decoding avoids retry-on-parse-failure loops, which double cost silently.</li>
<li>Cap <code>max_tokens</code> per use case; output tokens are the slow and usually the expensive ones.</li>
</ul>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How does function calling actually work, and how do you make it safe?”','<p><i>Answer (≈50 s):</i> "The model never calls anything. We send tool definitions as JSON Schema with the conversation; the model generates a structured tool call — name plus a JSON string of arguments — and stops with finish_reason tool_calls. The application parses and validates the arguments, authorizes the action against the signed-in user’s session rather than anything the model said, executes it with its own least-privilege credentials, appends the result as a tool message and calls the model again, until it stops. Safety lives in that application code: schema validation, authorization, confirmation and idempotency for writes, iteration and token caps, and treating tool output as untrusted data because it can carry prompt injection. MCP standardises how tools are discovered and invoked across apps, but it doesn’t move that responsibility."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"The model calls the API directly using the function we give it."</p></div><div class="good"><h4>Strong answer</h4><p>Model proposes, app validates/authorizes/executes in a bounded loop; constrained decoding for argument syntax; injection-aware.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['messages + tools','chat template','constrained decoding','tool_calls','validate + authorize','execute','tool message','final answer'])}
${chain(['function calling','MCP tools','MCP servers on Kubernetes','agents with approvals'])}
<p>Volume 1 ends here. Volume 2 opens with ${L('v2-platform-architecture','the end-to-end platform')} and builds on this lesson in ${L('v2-mcp-why','Why MCP exists')}, ${L('v2-mcp-protocol','Inside MCP')} and ${L('v2-agents','AI agents')}.</p></div>
`,
  quiz:[
    {q:'A response ends with finish_reason "length". What happened?',options:['The model chose to stop','The output hit max_tokens and is truncated','A tool must be called','The stream was cancelled by the client'],answer:1,explain:'length means the token limit was reached. stop is a natural end; tool_calls requests tool execution.'},
    {q:'With constrained decoding, what happens to a token that would violate the schema?',options:['It is sampled with lower temperature','Its logit is set to −∞ so its probability is exactly 0 before sampling','It is replaced after generation','The request fails'],answer:1,explain:'The grammar mask removes illegal tokens before softmax; legal tokens keep their relative order.'},
    {q:'Legal tokens have logits 1.2, 0.4 and −0.3 after masking. Probability of the first?',options:['≈ 0.33','≈ 0.45','≈ 0.60','≈ 0.80'],answer:2,explain:'exp values 3.320, 1.492, 0.741; sum 5.553; 3.320 / 5.553 ≈ 0.598.'},
    {q:'In the tool-calling loop, where must authorization for get_booking(ABC123) come from?',options:['The model’s argument','The system prompt','The application’s session identity and policy','The tool description'],answer:2,explain:'The model can produce any argument; only the application knows who the user is.'},
    {q:'Streaming works when calling vLLM directly, but through the ingress the whole answer appears at the end. Likely cause?',options:['vLLM disabled streaming','A proxy buffers the response','TTFT is too high','max_tokens too low'],answer:1,explain:'Buffering proxies hold SSE chunks; disable buffering for the route.'},
    {q:'Which is true of the MCP 2026-07-28 revision compared with 2025-11-25?',options:['It adds an initialize handshake','It is stateless: no initialize handshake and no Mcp-Session-Id; servers implement server/discover','It removes tools','It replaces JSON-RPC with gRPC'],answer:1,explain:'2026-07-28 removed the handshake and sessions; 2025-11-25 has them and is still common in clients and tutorials.'}
  ],
  flashcards:[
    {front:'Chat Completions finish_reason values',back:'stop (natural end), length (max_tokens hit, truncated), tool_calls (model requests a tool).'},
    {front:'SSE stream shape',back:'Lines "data: {chunk}" with choices[].delta.content, blank line between events, ending with "data: [DONE]".'},
    {front:'Constrained decoding in one sentence',back:'Compile schema to a grammar, compute allowed next tokens each step, set illegal logits to −∞, then sample.'},
    {front:'vLLM structured outputs (Oct 2026)',back:'--structured-outputs-config (backend auto: xgrammar, guidance); response_format json_schema or structured_outputs field; guided_* params removed in v0.12.0.'},
    {front:'Tool-calling safety rules',back:'Model proposes, app decides; validate schema; authorize from session; confirm + idempotency for writes; cap iterations; tool output is untrusted.'},
    {front:'Why MCP?',back:'Turns N apps × M systems custom integrations into N + M: one protocol for discovering/calling tools, resources and prompts.'},
    {front:'MCP current vs previous revision',back:'2026-07-28 (current): stateless, server/discover, per-request _meta. 2025-11-25: initialize handshake + sessions, still common.'}
  ]
});
registerGlossary([
  {term:'Chat Completions API',def:'OpenAI-compatible HTTP API (POST /v1/chat/completions) taking role-tagged messages and returning the next assistant message with finish_reason and token usage; implemented by vLLM, SGLang and most providers.',lesson:'v1-ai-apps-tools'},
  {term:'Server-sent events',def:'HTTP streaming format (text/event-stream) of "data:" lines; used to stream generated tokens as chunks ending with data: [DONE].',lesson:'v1-ai-apps-tools',aliases:['SSE']},
  {term:'Structured output',def:'Model output forced to match a JSON Schema or grammar, typically via constrained decoding.',lesson:'v1-ai-apps-tools',aliases:['JSON schema output']},
  {term:'Constrained decoding',def:'Decoding in which a grammar determines the legal next tokens each step and illegal tokens’ logits are masked to −∞ before sampling, guaranteeing syntactic validity.',lesson:'v1-ai-apps-tools',aliases:['grammar-constrained decoding','logit masking']},
  {term:'Tool calling',def:'Pattern where the model emits a structured request (tool name + JSON arguments) and the application validates, authorizes, executes it and returns the result for the next model call.',lesson:'v1-ai-apps-tools'}
]);
