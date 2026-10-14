/* Vol 3, Part 2, Chapter 3 — Questions: GPU, CUDA and performance */
registerLesson({
  id:'v3-ch-gpu', vol:3, part:2, num:3,
  title:'Questions: GPU, CUDA and performance', minutes:120,
  summary:'This chapter is the interview question bank for GPUs: what is busy, what is full, and what is slow. Interviewers use these questions to separate people who read dashboards from people who understand them. You will practise explaining low utilization with high latency, what really happens when GPU memory fills, how to size memory for a 70 billion parameter model, the roofline model, CUDA basics, profiling, GPU sharing, quantization, interconnects and hardware failures, always with numbers from verified H100 and H200 specifications.',
  objectives:[
    'Explain why GPU utilization and latency can disagree, using the precise definition of the utilization metric.',
    'Size GPU memory and tensor-parallel layout for a 70B model, including KV-cache token budget and concurrency.',
    'Use arithmetic intensity and the H100 ridge point to predict compute-bound versus memory-bound phases.',
    'Choose between MIG, time-slicing, MPS and whole GPUs, and between quantization formats, with evidence.',
    'Triage GPU faults from Xid codes and DCGM metrics before restarting anything.'
  ],
  prereqs:['v1-gpu-architecture','v1-cuda','v1-gpu-memory','v1-multi-gpu-profiling'],
  next:['v3-ch-inference','v3-ch-k8s','v3-whiteboard','v3-debugging'],
  tags:['interview','gpu','cuda','performance','memory'],
  html:`
<h2>What interviewers test in this area</h2>
<p>GPU questions are where an infrastructure engineer can stand out or fall flat. The weak candidate reads one number off a dashboard ("the GPU is at 30 %, so it has headroom") and proposes a bigger instance. The strong candidate knows that a GPU has four separate limits — compute (Tensor Core FLOPS), memory capacity (HBM gigabytes), memory bandwidth (terabytes per second) and interconnect (NVLink, PCIe, network) — and that each workload phase hits a different one. Interviewers probe this with symptoms ("utilization low, latency high"), with sizing ("how many GPUs for a 70B model?"), and with failure scenarios ("a node keeps crashing").</p>
<p>Your Kubernetes and observability background is an asset: DCGM exporter is just another Prometheus exporter, Xid errors are kernel log events, MIG is a resource-partitioning scheme with a device plugin. Use those bridges, then show the GPU-specific detail.</p>

<h2>The mental model: four limits</h2>
${fig('Four separate GPU limits, four separate symptoms', svgDiagram({w:900,h:250,
  boxes:[
    {id:'c',x:20,y:40,w:200,h:70,label:'Compute',sub:'989.5 TFLOPS BF16 dense',cls:'v1'},
    {id:'b',x:240,y:40,w:200,h:70,label:'HBM bandwidth',sub:'3.35 TB/s (H100)',cls:'v2'},
    {id:'m',x:460,y:40,w:200,h:70,label:'HBM capacity',sub:'80 GB (H100)',cls:'warn'},
    {id:'i',x:680,y:40,w:200,h:70,label:'Interconnect',sub:'NVLink 900 GB/s',cls:'v3'},
    {id:'c2',x:20,y:160,w:200,h:60,label:'Prefill, training',sub:'slow TTFT / step',cls:'x'},
    {id:'b2',x:240,y:160,w:200,h:60,label:'Decode',sub:'slow TPOT',cls:'x'},
    {id:'m2',x:460,y:160,w:200,h:60,label:'KV / OOM',sub:'queueing, preemption',cls:'x'},
    {id:'i2',x:680,y:160,w:200,h:60,label:'TP, FSDP, EP',sub:'comm-bound steps',cls:'x'}
  ],
  arrows:[{from:'c',to:'c2'},{from:'b',to:'b2'},{from:'m',to:'m2'},{from:'i',to:'i2'}]
}), 'Every GPU performance question starts by naming which of the four limits is binding.')}

<h2>Say it like a senior engineer</h2>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"GPU utilization is 95 %, so the GPU is maxed out."</p></div><div class="good"><h4>Strong answer</h4><p>"nvidia-smi utilization is the fraction of time at least one kernel was running. I would look at SM activity, Tensor pipe activity and DRAM activity in DCGM before saying the GPU is saturated."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"We ran out of GPU memory, so we need a bigger GPU."</p></div><div class="good"><h4>Strong answer</h4><p>"First I separate weights, activations and KV cache. In inference, the engine pre-allocates KV and queues when it is full, so the fix is usually context limits, FP8 KV or more replicas, not a different card."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"A 70B model needs a lot of GPUs."</p></div><div class="good"><h4>Strong answer</h4><p>"141 GB of BF16 weights do not fit on two H100s once the engine's 0.92 memory fraction is applied. Four H100s with TP=4 leave about 137 GB for KV, roughly 419,000 tokens, which is about 51 concurrent 8k-token sequences."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"INT4 is four times faster than BF16."</p></div><div class="good"><h4>Strong answer</h4><p>"INT4 weights are a quarter of the bytes, which helps memory-bound decode, but weight-only kernels dequantize, so at high batch they can lose to FP8. I benchmark at our concurrency and evaluate quality."</p></div></div>

<h2>Must-know numbers (with derivations)</h2>
${formula(`
H100 SXM: 80 GB HBM3 · 3.35 TB/s · BF16 dense 989.5 TFLOPS (1,979 is WITH sparsity)
H200 SXM: 141 GB HBM3e · 4.8 TB/s · same compute as H100

Ridge point (H100, BF16)
     989.5 × 10¹² FLOP/s
   ─────────────────────  ≈ 295 FLOP per byte
     3.35 × 10¹² B/s

Decode lower bound, 8B BF16, batch 1
   16 × 10⁹ B ÷ 3.35 × 10¹² B/s ≈ 4.8 ms per token

70B weights      70.6 × 10⁹ × 2 B ≈ 141 GB (BF16) · ≈ 71 GB (FP8) · ≈ 35 GB + scales (INT4)
KV per token     2 × 80 × 8 × 128 × 2 B = 327,680 B = 320 KiB (BF16)
vLLM default     --gpu-memory-utilization 0.92 (as of v0.31, Oct 2026)
`)}

<h2>Question map</h2>
<p>The eleven questions below fall into four groups. <b>Symptoms</b>: low utilization with high latency (Q1), memory filling up (Q2), a crashing node (Q10). <b>Sizing and limits</b>: the 70B memory plan (Q3), the roofline (Q4), interconnects (Q9). <b>Mechanisms</b>: CUDA (Q5), FlashAttention (Q11). <b>Platform choices</b>: profiling method (Q6), GPU sharing (Q7), quantization formats (Q8). If you only have an hour before an interview, do Q1, Q2, Q3 and Q4 aloud with the numbers: they are the most frequently asked and the ones where a numeric answer separates you from other candidates.</p>
<h2>How to use this chapter</h2>
<p>Answer aloud, then check the numbers yourself; recomputing is the practice. Background lessons: ${L('v1-gpu-architecture','GPU architecture')}, ${L('v1-cuda','CUDA')}, ${L('v1-gpu-memory','GPU memory accounting')} and ${L('v1-multi-gpu-profiling','multi-GPU and profiling')}. The labs <code>labs/04-gpu/gpu_memory.py</code> and <code>labs/04-gpu/profile_matmul.py</code> run on a laptop and give you honest "[In my lab I measured…]" material.</p>
`,
  quiz:[
    {q:'nvidia-smi shows 100 % GPU utilization. What does that guarantee?',options:['All SMs are fully busy','At least one kernel was running during most of the sample period','Tensor Cores are at peak','Memory bandwidth is saturated'],answer:1,explain:'The documented definition is the percent of time one or more kernels was executing. A single small kernel can show 100 %. Use DCGM SM_ACTIVE, PIPE_TENSOR_ACTIVE and DRAM_ACTIVE for depth.'},
    {q:'Llama-3.1-70B in BF16 on 2 × H100 80 GB with vLLM defaults. What happens?',options:['Fits with room for 50 users','Weights barely fit, essentially no KV cache: fails to start or is unusable','Fits only with FP8 KV','Fits on one GPU'],answer:1,explain:'0.92 × 160 = 147.2 GB usable; weights are ≈ 141 GB plus activation reserve → no meaningful KV pool. Use TP=4, FP8 weights, or H200s.'},
    {q:'Decode at batch 1 on an H100 has arithmetic intensity of roughly…',options:['1 FLOP/byte','30 FLOP/byte','295 FLOP/byte','2,000 FLOP/byte'],answer:0,explain:'Each 2-byte BF16 weight is used for one multiply-add (2 FLOPs) per token: ≈ 1 FLOP/byte, far below the ≈ 295 ridge point, so bandwidth-bound.'},
    {q:'Which GPU supports MIG?',options:['L4','L40S','H100','T4'],answer:2,explain:'MIG is on A100, H100, H200, B200 and others; L4, L40S and T4 are not on NVIDIA\'s MIG supported list.'},
    {q:'Xid 79 on a node means…',options:['Application illegal memory access','GPU has fallen off the bus','A contained ECC error','NCCL timeout'],answer:1,explain:'Xid 79 is GPU fallen off the bus; the catalog\'s immediate action is a bare-metal restart and it usually needs hardware investigation. Xid 13/31 are typically application faults.'}
  ],
  flashcards:[
    {front:'GPU utilization (nvidia-smi / DCGM_FI_DEV_GPU_UTIL)',back:'Percent of time at least one kernel was executing in the sample period. Not SM efficiency.'},
    {front:'H100 ridge point (BF16)',back:'989.5 TFLOPS ÷ 3.35 TB/s ≈ 295 FLOP/byte. Below: bandwidth-bound; above: compute-bound.'},
    {front:'70B on H100s, BF16, vLLM 0.92',back:'TP=2 does not fit. TP=4: ≈ 137 GB KV ≈ 419k tokens ≈ 51 × 8k sequences. TP=8: ≈ 416 GB KV ≈ 1.27M tokens.'},
    {front:'CUDA OOM vs OOMKilled',back:'CUDA OOM = GPU HBM allocation failed (PyTorch error). OOMKilled = container exceeded host RAM limit (cgroup). Different memory, different fixes.'},
    {front:'MIG vs time-slicing',back:'MIG: hardware partitions with isolated memory and faults (A100/H100/H200/B200…). Time-slicing: shared GPU, no memory or fault isolation.'},
    {front:'Nsight Systems vs Nsight Compute',back:'Systems: timeline across CPU, GPU, kernels, copies, NCCL — find gaps. Compute: deep analysis of one kernel — find why it is slow.'},
    {front:'Why FlashAttention is faster',back:'Tiles Q, K, V through on-chip SRAM and never writes the n × n score matrix to HBM; exact result, fewer HBM bytes.'},
    {front:'Xid quick triage',back:'13/31 app bug → restart app; 48 DBE ECC → reset/drain; 74 NVLink; 79 off the bus → drain, hardware; 94 contained → restart app; 95 uncontained → reset GPU.'}
  ]
});

registerQuestions([
{
  id:'gpu-01', chapter:'v3-ch-gpu', difficulty:2,
  title:'Why might GPU utilization be low despite high latency?',
  understand:'A classic symptom question. The interviewer checks whether you know what the utilization metric actually measures and whether you can find where time goes in an AI request: outside the GPU, on the CPU, or inside the GPU but not using it well.',
  short:'Because most of the request\'s latency may not be on the GPU at all, and the utilization metric is coarse. A request spends time in the gateway, retrieval, reranking, tool calls and queueing before the prompt even exists; then the engine\'s CPU side tokenizes, schedules and launches kernels, and a single busy Python process can starve the GPU. On the GPU, decode at small batch is memory-bound, so kernels run but do little math. So I trace one slow request end to end and compare span timings with GPU timelines, then check queue time, batch size and CPU saturation. And the reverse trap too: nvidia-smi can show 100 percent with idle SMs, because it only means a kernel was running.',
  detailed:`
<h3>What the metric means</h3>
<p>NVIDIA documents utilization.gpu (and DCGM_FI_DEV_GPU_UTIL) as the "percent of time over the past sample period during which one or more kernels was executing on the GPU". It says nothing about how many SMs were busy or whether Tensor Cores were used. Deeper DCGM profiling fields exist: DCGM_FI_PROF_SM_ACTIVE and SM_OCCUPANCY (off by default in dcgm-exporter's default counters), PIPE_TENSOR_ACTIVE and DRAM_ACTIVE (on by default).</p>
<h3>Where the latency hides</h3>
${table(['Place','Typical cause','Evidence','Fix'],[
 ['Before the GPU','auth, RAG search, reranker, tool calls, prompt assembly','trace spans (OpenTelemetry) before the engine','parallelise, cache retrieval, faster reranker'],
 ['Engine queue','KV full or max-num-seqs reached','vllm:num_requests_waiting, vllm:request_queue_time_seconds','more replicas, context limits'],
 ['Engine CPU','tokenization of huge prompts, Python scheduler, many small kernel launches','CPU at 100 % on one core; gaps in Nsight Systems timeline','CUDA graphs, faster tokenizer, more CPU'],
 ['Host-device copies','pageable memory, synchronous copies','memcpy blocks on timeline','pinned memory, overlap'],
 ['On the GPU, inefficient','batch 1 decode: bandwidth-bound, tiny matmuls','DRAM_ACTIVE high, TENSOR_ACTIVE low','batch more decodes, quantize weights'],
 ['After the GPU','slow client streaming, output guardrails','spans after first token','async streaming, faster checks']
])}
${formula(`
Illustrative breakdown of a 4.0 s request (assumed measurements)
  gateway + retrieval + rerank     1.5 s   GPU idle
  engine CPU (tokenize, schedule)  0.4 s   GPU mostly idle
  prefill                          0.25 s  GPU busy, compute-bound
  decode 300 tokens × 5 ms         1.5 s   kernels running, low math per byte
  tool call + streaming tail       0.35 s  GPU idle

GPU busy share ≈ (0.25 + 1.5) / 4.0 ≈ 44 % of wall time,
yet a 1.5 s → 0.3 s retrieval fix cuts latency by 30 % with zero GPU change.
`)}
<h3>Method</h3>
<ol><li>Trace one slow request end to end with spans for each stage.</li><li>Correlate engine metrics: queue time, TTFT, inter-token latency, running and waiting requests.</li><li>Capture an Nsight Systems timeline on the engine to see gaps between kernels.</li><li>Only then decide: fix upstream, fix CPU path, raise batch, or add GPUs.</li></ol>`,
  diagram:anim('v3q-gpu-lowutil'),
  followups:[
    {q:'Utilization is 100 % but throughput is poor. How?',a:'One long-running small kernel or a series of launch-bound kernels keeps "a kernel running" all the time while most SMs idle. Check SM_ACTIVE (enable it in dcgm-exporter), PIPE_TENSOR_ACTIVE and achieved tokens/s versus a benchmark.'},
    {q:'How do CUDA graphs help here?',a:'They capture a sequence of kernel launches once and replay them with one launch, removing per-kernel CPU launch overhead, which matters in decode where each step launches many small kernels.'},
    {q:'Would you autoscale on GPU utilization?',a:'No. It is a poor proxy for capacity. Scale on queue depth / waiting requests, KV usage and TTFT against the SLO, which reflect user experience and the real limit.'},
    {q:'How do you prove the CPU is the bottleneck?',a:'Engine process pegged at 100 % of a core, gaps between kernels on the timeline, and GPU throughput improves when the same load is split across more engine processes or when CUDA graphs are enabled.'}
  ],
  tradeoffs:`<ul><li><b>Bigger batches</b> raise GPU efficiency but add per-token latency for each user.</li><li><b>More replicas</b> fix queueing but cost GPUs that may sit at low utilization.</li><li><b>Fixing upstream</b> (RAG, tools) is often the cheapest latency win.</li></ul>`,
  failures:`<ul><li><b>Retrieval slowdown</b> → latency up, GPU util down → trace spans show pre-engine time.</li><li><b>CPU-starved engine</b> → low util, high TPOT → CPU limits too low in the pod spec; raise or remove CPU limits for the engine.</li><li><b>Throttled GPU clocks</b> (thermal/power) → lower throughput at same util → DCGM clocks and power.</li></ul>`,
  vocab:[
    {term:'GPU utilization',def:'Percent of sample time with at least one kernel executing; not a measure of SM saturation.'},
    {term:'SM_ACTIVE',def:'DCGM ratio of cycles an SM has at least one warp assigned (off by default in dcgm-exporter).'},
    {term:'PIPE_TENSOR_ACTIVE',def:'DCGM ratio of cycles the Tensor Core pipe is active.'},
    {term:'Kernel launch overhead',def:'CPU time to issue each GPU kernel; dominant when kernels are tiny.'},
    {term:'CUDA graph',def:'A recorded sequence of GPU operations replayed with one launch.'}
  ],
  mistakes:[
    'Proposing a bigger GPU without locating the latency.',
    'Treating 100 % utilization as proof of saturation.',
    'Autoscaling on GPU utilization.',
    'Ignoring CPU limits on the inference pod.'
  ],
  related:['v1-gpu-architecture','v1-multi-gpu-profiling','v1-k8s-autoscaling','v2-ai-observability']
},
{
  id:'gpu-02', chapter:'v3-ch-gpu', difficulty:1,
  title:'What happens when GPU memory fills up?',
  understand:'They want you to separate cases: training or naive serving (allocation failure, CUDA OOM), modern inference engines (pre-allocated KV pool, admission control, preemption), and the unrelated Kubernetes OOMKilled. Bonus for fragmentation and allocator behaviour.',
  short:'It depends on who is allocating. In training or a plain PyTorch server, the next allocation fails and you get a CUDA out-of-memory error; the process usually dies and you lose the step. Sometimes there is enough free memory in total but not in one contiguous block, which is fragmentation in PyTorch\'s caching allocator. Inference engines like vLLM behave differently: at startup they pre-allocate a fraction of GPU memory, 0.92 by default, load the weights, and turn the rest into KV-cache blocks. When the blocks run out, nothing crashes: new requests wait in the queue, and if running sequences need more blocks, the scheduler preempts one and recomputes it later. Users see rising time to first token. And a Kubernetes OOMKilled is host RAM, not GPU memory.',
  detailed:`
<h3>Case 1: training or naive serving</h3>
<ul><li>PyTorch raises <code>torch.OutOfMemoryError: CUDA out of memory</code> when an allocation cannot be satisfied.</li>
<li>The caching allocator keeps freed blocks for reuse; <code>torch.cuda.memory_reserved()</code> can be far above <code>memory_allocated()</code>. Varying tensor sizes (variable sequence lengths) fragment the pool. The allocator setting <code>PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True</code> reduces fragmentation in many workloads.</li>
<li>Peaks come from activations at the longest sequence, optimizer state creation at the first step, and evaluation passes that forget <code>no_grad</code>.</li></ul>
<h3>Case 2: an inference engine (vLLM)</h3>
${formula(`
Startup budget per GPU (vLLM, illustrative 8B on one H100 80 GB)
  usable    = 0.92 × 80 GB                    = 73.6 GB
  weights   = 8.03 × 10⁹ × 2 B                ≈ 16.1 GB
  activation/workspace (profiled at startup)  ≈  4 GB  (illustrative)
  KV pool   = 73.6 − 16.1 − 4                 ≈ 53.5 GB
  tokens    = 53.5 × 10⁹ / 131,072 B          ≈ 408,000 tokens
`)}
<p>When the pool is exhausted the scheduler: (1) stops admitting new requests, so <code>vllm:num_requests_waiting</code> rises and TTFT and <code>vllm:request_queue_time_seconds</code> grow; (2) if running sequences need new blocks, preempts a sequence (default mode RECOMPUTE in V1), freeing its blocks and re-running its prefill later. <code>vllm:kv_cache_usage_perc</code> sits near 1.0. Throughput may hold while latency degrades.</p>
<p>If the engine cannot fit even one max-length sequence at startup, it refuses to start with an error about max model length versus KV capacity: lower <code>--max-model-len</code> or add memory.</p>
<h3>Case 3: not GPU memory at all</h3>
<p>Kubernetes <b>OOMKilled</b> (exit code 137) means the container exceeded its host RAM limit: tokenizer workers, CPU swap space for KV, model loading buffers. GPU HBM is invisible to cgroups. Fix the pod memory limit, not the GPU.</p>
${table(['Symptom','Memory','First fix'],[
 ['torch.OutOfMemoryError in training','HBM','micro-batch, checkpointing, sharding'],
 ['Engine queue grows, KV ≈ 100 %','HBM (KV pool)','context limits, FP8 KV, replicas'],
 ['Preemptions, TPOT jitter','HBM (KV pool)','lower max-num-seqs, more memory'],
 ['OOMKilled, exit 137','host RAM','raise pod memory limit, check loaders'],
 ['Xid 48/94/95, ECC','HBM hardware','drain node, follow Xid workflow']
])}`,
  diagram:anim('v3q-gpu-memfull'),
  followups:[
    {q:'Why does nvidia-smi show 74 GB used on an idle vLLM server?',a:'The engine pre-allocates its KV pool at startup up to the memory-utilization fraction. Used memory is a reservation, not load. Use vllm:kv_cache_usage_perc for real KV pressure.'},
    {q:'Two vLLM instances on one GPU both crash at start. Why?',a:'Each assumes it may take 0.92 of the GPU. --gpu-memory-utilization is a per-instance fraction; set fractions that sum below 1.0, or better use MIG partitions for isolation.'},
    {q:'Recompute or swap for preemption?',a:'Recompute re-runs prefill (GPU compute, no extra memory); swapping copies KV to CPU memory and back over PCIe. vLLM V1 defaults to recompute; swap only helps when prefill is expensive relative to PCIe transfer, and costs host RAM.'},
    {q:'How do you prevent CUDA OOM in a long training run?',a:'Cap max sequence length, measure peak memory on the worst-case batch at step 0, use activation checkpointing, set expandable segments, and alert on reserved memory growth.'}
  ],
  tradeoffs:`<ul><li><b>Higher memory fraction</b>: more KV capacity, less headroom for other processes and spikes.</li><li><b>Larger max context</b>: supports long users, fewer concurrent sequences.</li><li><b>Preemption</b>: avoids crashes, wastes recompute and adds latency.</li></ul>`,
  failures:`<ul><li><b>Silent latency incident</b>: no errors, TTFT p95 doubles → KV exhaustion → alert on waiting requests and KV usage.</li><li><b>OOM after model upgrade</b> → new model larger or different KV shape → recompute the budget per model.</li><li><b>Fragmentation OOM with free memory shown</b> → allocator fragmentation → expandable segments, consistent shapes.</li></ul>`,
  vocab:[
    {term:'Caching allocator',def:'PyTorch component that keeps freed GPU blocks for reuse instead of returning them to the driver.'},
    {term:'Fragmentation',def:'Free memory split into pieces too small for a requested allocation.'},
    {term:'KV pool',def:'GPU memory an engine reserves at startup for KV-cache blocks.'},
    {term:'Preemption (recompute)',def:'Evicting a running sequence\'s KV and re-running its prefill later.'},
    {term:'OOMKilled',def:'Kubernetes/cgroup kill when a container exceeds its host RAM limit.'}
  ],
  mistakes:[
    'Treating high nvidia-smi memory usage on a vLLM server as a leak.',
    'Raising the pod memory limit to fix a GPU OOM.',
    'Saying a modern engine crashes when KV fills (it queues and preempts).',
    'Running two engines with default memory fractions on one GPU.'
  ],
  related:['v1-gpu-memory','v1-kv-cache','v1-batching','v1-k8s-serving']
},
{
  id:'gpu-03', chapter:'v3-ch-gpu', difficulty:3,
  title:'How would you size GPU memory for a 70B model?',
  understand:'The defining quantitative question. They expect weights by precision, KV per token from the config, the engine\'s memory fraction, tensor-parallel options that divide the heads, a KV token budget, concurrency at realistic context lengths, and a recommendation tied to SLO and cost.',
  short:'I start from the config. Llama-3.1-70B is about 70.6 billion parameters, so weights are about 141 GB in BF16, 71 in FP8, and around 35 plus scales in INT4. KV per token is two times 80 layers times 8 KV heads times 128 times 2 bytes, 320 KiB. With vLLM\'s default 0.92 memory fraction, two H100s give 147 GB usable, which BF16 weights fill completely, so that does not work. Four H100s with tensor parallel 4 give 294 GB; minus weights and an activation reserve, about 137 GB of KV, roughly 419,000 tokens, which is about 51 sequences at full 8k context, more at real average lengths. FP8 weights on two H100s with FP8 KV give about the same token budget at half the GPUs. I would pick by benchmarking quality and latency at our real length distribution.',
  detailed:`
<h3>Inputs (from config.json and specs)</h3>
${formula(`
Params ≈ 70.6 × 10⁹      layers 80   attn heads 64   KV heads 8   head_dim 128
Weights  BF16 = 141.1 GB   FP8 = 70.6 GB   INT4 ≈ 35.3 GB + scales ≈ 39 GB (illustrative)
KV/token BF16 = 2 × 80 × 8 × 128 × 2 = 327,680 B (320 KiB);  FP8 KV = 163,840 B
Usable HBM = 0.92 × HBM per GPU (vLLM default)
Activation / workspace reserve: 4 GB per GPU (ILLUSTRATIVE; the engine profiles the real value)
`)}
<h3>The table</h3>
${table(['Layout','Usable','− weights − reserve','KV pool','KV tokens','Seqs @4k','@8k','@32k'],[
 ['2 × H100, TP=2, BF16','147.2 GB','−141.1 −8','≈ −1.9 GB','does not fit','—','—','—'],
 ['4 × H100, TP=4, BF16','294.4 GB','−141.1 −16','137.3 GB','≈ 419,000','102','51','12'],
 ['8 × H100, TP=8, BF16','588.8 GB','−141.1 −32','415.7 GB','≈ 1,269,000','309','154','38'],
 ['2 × H100, TP=2, FP8 W, BF16 KV','147.2 GB','−70.6 −8','68.6 GB','≈ 209,000','51','25','6'],
 ['2 × H100, TP=2, FP8 W, FP8 KV','147.2 GB','−70.6 −8','68.6 GB','≈ 419,000','102','51','12'],
 ['1 × H200, FP8 W, FP8 KV','129.7 GB','−70.6 −4','55.1 GB','≈ 336,000','82','41','10'],
 ['2 × H200, TP=2, BF16','259.4 GB','−141.1 −8','110.3 GB','≈ 337,000','82','41','10'],
 ['1 × H100, INT4 W, BF16 KV','73.6 GB','−39 −4','30.6 GB','≈ 93,000','22','11','2']
])}
${formula(`
Worked row: 4 × H100, TP = 4, BF16
STEP 1  usable   = 0.92 × 4 × 80 GB           = 294.4 GB
STEP 2  KV pool  = 294.4 − 141.1 − 4 × 4       = 137.3 GB
STEP 3  tokens   = 137.3 × 10⁹ / 327,680 B     ≈ 419,000
STEP 4  seqs @8k = 419,000 / 8,192             ≈ 51  (all at full length: worst case)
ANSWER  51 worst-case 8k sequences; with an average of 2k tokens resident, ≈ 200
`)}
<h3>Constraints on TP</h3>
<p>TP must divide the 64 query heads and the 8 KV heads: TP ∈ {1, 2, 4, 8}. At TP=8 each GPU holds one KV head per layer. Beyond 8 you replicate KV heads or add pipeline parallelism. Keep TP inside one NVLink domain (one 8-GPU node).</p>
<h3>Choosing</h3>
<ul><li><b>Lowest latency</b>: TP=8 BF16 (more bandwidth per token: 141 GB read across 8 × 3.35 TB/s ≈ 5.3 ms per decode step ideal).</li>
<li><b>Best cost per token</b> often: FP8 weights + FP8 KV on 2 × H100 or 1 × H200, if evaluation shows acceptable quality.</li>
<li><b>Throughput at scale</b>: several TP=4 replicas rather than one TP=8, since replicas scale linearly and avoid extra communication.</li></ul>
<p>Then benchmark the shortlisted layouts with your real input/output distribution and pick the cheapest that meets TTFT/TPOT SLOs at target concurrency (goodput per dollar).</p>`,
  diagram:fig('Per-GPU memory, 4 × H100 TP=4 BF16 (illustrative reserve)', svgDiagram({w:900,h:220,
    boxes:[
      {id:'w',x:20,y:80,w:390,h:60,label:'Weights shard ≈ 35.3 GB',sub:'141.1 GB ÷ 4',cls:'v1'},
      {id:'r',x:420,y:80,w:60,h:60,label:'4 GB',sub:'act',cls:'warn'},
      {id:'k',x:490,y:80,w:300,h:60,label:'KV ≈ 34.3 GB',sub:'2 KV heads / layer',cls:'hl'},
      {id:'f',x:800,y:80,w:80,h:60,label:'6.4 GB',sub:'not used',cls:'x'}
    ],
    notes:[{x:20,y:50,text:'One H100 of four: 80 GB; 0.92 × 80 = 73.6 GB used by the engine.'},{x:20,y:180,text:'KV is sharded by KV heads: each GPU stores 2 of the 8 KV heads for every token.'}]
  }), 'Widths roughly proportional to GB.'),
  followups:[
    {q:'Why not TP=16 across two nodes for more KV?',a:'TP communicates twice per layer per step; across nodes that is on slow links and dominates decode latency. Use two TP=8 replicas instead, or pipeline parallelism across nodes if a single replica must be bigger.'},
    {q:'How does prefix caching change the sizing?',a:'Shared prefixes (system prompt, tool schemas) are stored once and referenced by many sequences, so effective capacity rises for chat workloads. Measure prefix hit rate and resident tokens rather than assume.'},
    {q:'Your SLO needs 500 concurrent chats averaging 3k resident tokens. How many replicas of TP=4 BF16?',a:'Tokens needed = 500 × 3,000 = 1.5M. One TP=4 replica holds ≈ 419k → about 3.6, so 4 replicas for memory, plus headroom (N+1) = 5, then verify TPOT and TTFT at that concurrency in a benchmark.'},
    {q:'Is FP8 KV safe?',a:'Usually small quality impact, but it is model- and task-dependent; evaluate on your set, including long-context tasks. It halves KV bytes and therefore doubles token capacity.'}
  ],
  tradeoffs:`<ul><li><b>More TP</b>: lower latency, more communication, fewer replicas per node.</li><li><b>Lower precision</b>: fewer GPUs, quality risk to evaluate.</li><li><b>H200 vs H100</b>: more memory and bandwidth per GPU, higher price; fewer GPUs per replica.</li></ul>`,
  failures:`<ul><li><b>Engine fails to start</b> → max-model-len too large for KV pool → lower it or add GPUs.</li><li><b>Queueing at modest traffic</b> → sized for average, not p95 resident tokens → resize on percentile.</li><li><b>OOM after enabling another feature</b> (speculative draft model, LoRA) → extra weights not budgeted.</li></ul>`,
  vocab:[
    {term:'Tensor parallelism (TP)',def:'Splitting each layer\'s matrices across GPUs; requires all-reduce every layer.'},
    {term:'KV token budget',def:'Total tokens of KV the pool can hold across all sequences.'},
    {term:'gpu-memory-utilization',def:'vLLM fraction of each GPU\'s memory the instance may use (default 0.92).'},
    {term:'FP8 KV cache',def:'Storing keys and values in 8-bit floats; halves KV memory.'},
    {term:'Goodput per dollar',def:'Requests served within SLO per unit of GPU cost.'}
  ],
  mistakes:[
    'Using attention heads (64) instead of KV heads (8) for KV size: 8× error.',
    'Forgetting the engine memory fraction and activation reserve.',
    'Confusing GB and GiB (141 GB ≈ 131 GiB).',
    'Assuming every sequence sits at max context, or that none do.',
    'Proposing TP across nodes.'
  ],
  related:['v1-gpu-memory','v1-kv-cache','v2-capacity-planning','v2-parallelism','v3-whiteboard']
},
{
  id:'gpu-04', chapter:'v3-ch-gpu', difficulty:2,
  title:'Explain arithmetic intensity and the roofline. Why is decode memory-bound?',
  understand:'They want the definition, the H100 ridge point, and the ability to place prefill, decode at different batch sizes and training on the roofline, then derive what hardware or software change helps each.',
  short:'Arithmetic intensity is how many floating-point operations you do per byte moved from memory. The roofline says attainable performance is the lower of the compute peak and bandwidth times intensity. On an H100, 989 dense BF16 teraflops divided by 3.35 terabytes per second gives a ridge point around 295 FLOPs per byte. Decode at batch one reads each two-byte weight to do one multiply-add, about one FLOP per byte, far left of the ridge, so it is bandwidth-bound: an 8B model needs at least about 4.8 milliseconds per token just to read 16 GB of weights. Batching shares each weight read across sequences, raising intensity. Prefill processes thousands of tokens per weight read, so it is compute-bound. That is why bandwidth and quantized weights help decode, and FLOPS help prefill.',
  detailed:`
${formula(`
                       FLOPs performed
Arithmetic intensity = ─────────────────
                       bytes moved (HBM)

Attainable = min( peak FLOP/s ,  bandwidth × intensity )

H100 SXM BF16:  ridge = 989.5 × 10¹² / 3.35 × 10¹² ≈ 295 FLOP/byte
H200 SXM BF16:  ridge = 989.5 × 10¹² / 4.8 × 10¹²  ≈ 206 FLOP/byte
`)}
<h3>Placing workloads</h3>
${table(['Workload','Intensity (approx.)','Bound','Attainable on H100'],[
 ['Decode, batch 1, BF16 weights','≈ 1 FLOP/B','bandwidth','≈ 3.35 TFLOPS (0.3 % of peak)'],
 ['Decode, batch 64','≈ 64 FLOP/B (less with KV reads)','bandwidth','≈ 214 TFLOPS upper bound'],
 ['Decode, batch 256','≈ 256 FLOP/B','near ridge','KV capacity usually limits first'],
 ['Prefill, 2,000 tokens','≈ 2,000 FLOP/B','compute','≈ 989.5 TFLOPS roof'],
 ['Training step, large batch','high','compute (+ comms)','MFU 30–50 % typical planning band']
])}
${formula(`
Decode lower bounds (weights only, ideal bandwidth)
  8B  BF16, 1 × H100 :  16.1 GB  / 3.35 TB/s          ≈ 4.8 ms/token
  70B BF16, TP=4 H100: 141.1 GB / (4 × 3.35 TB/s)     ≈ 10.5 ms/token  (+ all-reduce)
  70B FP8,  TP=4 H100:  70.6 GB / 13.4 TB/s           ≈ 5.3 ms/token
  70B BF16, TP=4 H200: 141.1 GB / (4 × 4.8 TB/s)      ≈ 7.3 ms/token
`)}
<h3>KV reads do not amortise</h3>
<p>Each sequence reads its own KV every step: at 8k context the 70B model reads 2.5 GiB of KV per sequence per token. With large batches and long contexts, KV traffic can exceed weight traffic, so decode stays bandwidth-bound even at batch sizes that would otherwise reach the ridge. FP8 KV halves it.</p>
<h3>What it predicts</h3>
<ul><li>Faster TFLOPS GPU → shorter prefill/TTFT, little TPOT change at small batch.</li><li>More bandwidth (H200) or fewer bytes (FP8/INT4 weights) → better TPOT.</li><li>Bigger batch → more tokens/s per GPU until KV capacity or the ridge.</li><li>Speculative decoding uses spare compute in memory-bound decode; it helps less when decode is already compute-bound.</li></ul>`,
  diagram:anim('v3q-gpu-roofline'),
  followups:[
    {q:'Why does batching barely slow each user\'s TPOT at small batch?',a:'Below the ridge, step time is set by reading the weights; adding sequences adds a little KV read and compute, so throughput rises almost linearly while step time grows slowly, until compute or KV reads dominate.'},
    {q:'Does INT4 weight-only quantization help prefill?',a:'Little or not at all: prefill is compute-bound and the matmul runs in 16-bit after dequantization. It mainly helps decode (fewer bytes) and memory capacity.'},
    {q:'How would you measure where a kernel sits on the roofline?',a:'Nsight Compute reports achieved FLOP/s and memory throughput per kernel and can plot a roofline; compare with the hardware peaks.'}
  ],
  tradeoffs:`<ul><li><b>Batch size</b>: throughput vs per-user latency.</li><li><b>Precision</b>: fewer bytes vs accuracy.</li><li><b>GPU choice</b>: FLOPS-rich vs bandwidth-rich per dollar depends on prefill/decode mix.</li></ul>`,
  failures:`<ul><li><b>Bought higher-FLOPS GPUs, TPOT unchanged</b> → decode bandwidth-bound → compare bandwidth, not FLOPS.</li><li><b>Throughput plateaus with more users</b> → KV capacity or KV reads → FP8 KV, context limits.</li></ul>`,
  vocab:[
    {term:'Arithmetic intensity',def:'FLOPs per byte moved between memory and compute units.'},
    {term:'Roofline model',def:'Performance bound = min(peak compute, bandwidth × intensity).'},
    {term:'Ridge point',def:'Intensity where the bandwidth and compute limits meet (≈ 295 FLOP/B for H100 BF16).'},
    {term:'Memory-bound',def:'Performance limited by bytes moved per second rather than FLOPs.'},
    {term:'Compute-bound',def:'Performance limited by arithmetic throughput.'}
  ],
  mistakes:[
    'Using the sparsity peak (1,979 TFLOPS) for the ridge point.',
    'Saying all LLM inference is compute-bound.',
    'Forgetting per-sequence KV reads when reasoning about large batches.'
  ],
  related:['v1-gpu-architecture','v1-inference-anatomy','v1-quantization-speculative']
},
{
  id:'gpu-05', chapter:'v3-ch-gpu', difficulty:1,
  title:'What is CUDA, in one minute?',
  understand:'Core question. They want the programming model (kernel, grid, block, thread, warp), the memory hierarchy, and the distinction between driver, toolkit and libraries.',
  short:'CUDA is NVIDIA\'s platform for running parallel code on its GPUs. You write a kernel, a function that runs on the GPU, and launch it over a grid of thread blocks; each thread handles a small piece of data, using its block and thread index. The hardware runs threads in groups of 32 called warps on streaming multiprocessors, and a block stays on one SM so its threads can share fast on-chip shared memory and synchronise. Performance mostly comes from memory: registers and shared memory are fast, HBM is large but far slower, so good kernels read memory in coalesced chunks and reuse data on chip. In practice we rarely write kernels; PyTorch calls libraries like cuBLAS and cuDNN, and Tensor Cores do the matrix maths.',
  detailed:`
${code('cuda',`__global__ void add(const float* a, const float* b, float* c, int n) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;   // global index
  if (i < n) c[i] = a[i] + b[i];                    // bounds check
}
// launch: enough 256-thread blocks to cover n elements
add<<<(n + 255) / 256, 256>>>(a, b, c, n);`)}
<p>The lab <code>labs/04-gpu/vector_add.cu</code> contains this kernel with timing using CUDA events.</p>
<h3>Execution hierarchy</h3>
${table(['Level','What it is','Hardware'],[
 ['Grid','all blocks of one kernel launch','whole GPU'],
 ['Block','up to 1,024 threads that can share memory and sync','one SM'],
 ['Warp','32 threads executing the same instruction','SM scheduler unit'],
 ['Thread','one lane of work','CUDA core / Tensor Core pipes']
])}
<h3>Memory hierarchy (fast → slow)</h3>
${table(['Memory','Scope','Notes'],[
 ['Registers','per thread','fastest; running out reduces occupancy'],
 ['Shared memory / L1','per block (per SM)','programmer-managed tile cache'],
 ['L2 cache','whole GPU','shared by SMs'],
 ['HBM (global memory)','whole GPU','80 GB at 3.35 TB/s on H100'],
 ['Host RAM','CPU side','over PCIe; slowest path']
])}
<h3>Performance basics</h3>
<ul><li><b>Coalescing</b>: threads in a warp reading consecutive addresses make one wide transaction.</li><li><b>Divergence</b>: if threads in a warp take different branches, the branches run serially.</li><li><b>Occupancy</b>: enough resident warps to hide memory latency.</li><li><b>Tensor Cores</b>: dedicated matrix-multiply units; most LLM FLOPs run there via cuBLAS/CUTLASS kernels.</li></ul>
<h3>Driver vs toolkit vs libraries</h3>
<p>The <b>driver</b> (kernel module on the node, installed by the GPU Operator on Kubernetes) talks to the hardware. The <b>CUDA toolkit/runtime</b> (nvcc, libcudart) is usually in the container image. <b>Libraries</b> (cuBLAS, cuDNN, NCCL) ship with frameworks. The driver must be new enough for the toolkit version in the image; that compatibility is a common deployment failure.</p>
<h3>How CUDA shows up in Kubernetes operations</h3><p>The GPU Operator installs the driver and container toolkit on nodes; the device plugin advertises <code>nvidia.com/gpu</code>; containers bring the CUDA runtime and libraries. Most production CUDA incidents are therefore version and placement problems (driver too old for the image, wrong GPU type selected, MIG layout mismatch), not kernel bugs. Say that in an interview and you sound like someone who has operated GPUs, not just read about them.</p>`,
  diagram:fig('Grid → blocks → warps → threads, and where data lives', svgDiagram({w:900,h:230,
    boxes:[
      {id:'g',x:20,y:80,w:140,h:60,label:'Grid',sub:'one kernel launch',cls:'v1'},
      {id:'b',x:200,y:80,w:150,h:60,label:'Block → SM',sub:'shared memory',cls:'v2'},
      {id:'w',x:390,y:80,w:150,h:60,label:'Warp',sub:'32 threads, lockstep',cls:'hl'},
      {id:'r',x:580,y:20,w:140,h:50,label:'Registers',sub:'fastest',cls:'ok'},
      {id:'l2',x:580,y:90,w:140,h:50,label:'L2',sub:'shared',cls:'v3'},
      {id:'h',x:580,y:160,w:140,h:50,label:'HBM',sub:'80 GB, 3.35 TB/s',cls:'warn'},
      {id:'p',x:760,y:160,w:120,h:50,label:'Host RAM',sub:'via PCIe',cls:'x'}
    ],
    arrows:[{from:'g',to:'b'},{from:'b',to:'w'},{from:'w',to:'r'},{from:'w',to:'l2'},{from:'w',to:'h'},{from:'h',to:'p'}]
  }), 'Speed falls and capacity rises as you move down the memory hierarchy.'),
  followups:[
    {q:'Why do we time GPU code with synchronisation?',a:'Kernel launches are asynchronous; the CPU returns immediately. Without torch.cuda.synchronize() or CUDA events, you time the launch, not the work.'},
    {q:'What is a common container failure related to CUDA versions?',a:'The image\'s CUDA runtime needs a newer driver than the node has, giving errors like "CUDA driver version is insufficient". Align images with the GPU Operator\'s driver version.'},
    {q:'What does a fused kernel buy you?',a:'It combines several operations so intermediates stay in registers/shared memory instead of round-tripping through HBM, cutting memory traffic and launch overhead (FlashAttention is a famous example).'}
  ],
  tradeoffs:`<ul><li><b>Custom kernels</b>: maximum performance, high maintenance; prefer libraries and compilers (torch.compile, Triton language) first.</li><li><b>Larger blocks</b>: more sharing, fewer resident blocks per SM.</li></ul>`,
  failures:`<ul><li><b>Illegal memory access</b> (often Xid 13/31) → missing bounds check or bad index → compute-sanitizer.</li><li><b>Driver/runtime mismatch</b> → container fails at init → pin compatible versions.</li><li><b>Slow kernel</b> → uncoalesced access or divergence → Nsight Compute.</li></ul>`,
  vocab:[
    {term:'Kernel',def:'A function launched from the CPU that runs on the GPU across many threads.'},
    {term:'Warp',def:'Group of 32 threads executing in lockstep.'},
    {term:'SM',def:'Streaming multiprocessor: the GPU\'s compute building block.'},
    {term:'Shared memory',def:'Fast on-chip memory shared by threads in a block.'},
    {term:'Coalesced access',def:'Adjacent threads reading adjacent addresses, combined into few memory transactions.'},
    {term:'Tensor Core',def:'Specialised unit for matrix multiply-accumulate.'}
  ],
  mistakes:[
    'Confusing the CUDA driver with the CUDA toolkit.',
    'Saying more threads always means more speed.',
    'Timing GPU code without synchronisation.'
  ],
  related:['v1-cuda','v1-gpu-architecture','v1-tensors-pytorch']
},
{
  id:'gpu-06', chapter:'v3-ch-gpu', difficulty:2,
  title:'How would you profile a slow PyTorch or inference workload?',
  understand:'They test method: measure end to end, synchronise timings, use the right tool at the right level (PyTorch profiler, Nsight Systems, Nsight Compute, DCGM), and avoid premature kernel tuning.',
  short:'Top down. First I measure the end-to-end number that matters, step time or tokens per second, with warm-up and proper GPU synchronisation, because CUDA calls are asynchronous. Then I look at the fleet view in DCGM: is the GPU idle, bandwidth-heavy or Tensor Core heavy? Then the PyTorch profiler or Nsight Systems gives a timeline across CPU threads, kernel launches, memory copies and NCCL calls, which shows whether the GPU waits on the data loader, the CPU, communication or synchronisation points. Only when one kernel dominates do I open Nsight Compute to see why that kernel is slow. Each fix is verified against the original measurement.',
  detailed:`
<h3>Levels and tools</h3>
${table(['Question','Tool','What it shows'],[
 ['Is it slow, and how slow?','benchmark harness with synchronisation','step time, tokens/s, TTFT/TPOT distributions'],
 ['Is the GPU busy, and on what?','DCGM exporter (Prometheus/Grafana)','GPU_UTIL, PIPE_TENSOR_ACTIVE, DRAM_ACTIVE, power, clocks'],
 ['Where does the time go in a step?','torch.profiler, Nsight Systems','timeline: CPU ops, kernel launches, gaps, memcpy, NCCL'],
 ['Why is this kernel slow?','Nsight Compute','achieved FLOPs and bandwidth, occupancy, stalls, roofline'],
 ['Inference engine view','engine metrics','queue time, batch size, KV usage, prefill/decode time']
])}
${code('python',`import torch
from torch.profiler import profile, ProfilerActivity
torch.cuda.synchronize(); t0 = time.perf_counter()
with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA]) as prof:
    for _ in range(10):
        out = model(x)
    torch.cuda.synchronize()
print(prof.key_averages().table(sort_by="cuda_time_total", row_limit=15))`)}
<p>See <code>labs/04-gpu/profile_matmul.py</code> for a runnable version (regions <code>timing</code>, <code>profiler</code>).</p>
<h3>Common findings and fixes</h3>
${table(['Timeline pattern','Meaning','Fix'],[
 ['GPU idle between steps, CPU busy in data loading','input pipeline bound','more workers, pinned memory, prefetch'],
 ['Thousands of tiny kernels with gaps','launch overhead','CUDA graphs, torch.compile, fusion'],
 ['Long cudaMemcpy / synchronise calls','host-device transfers on the critical path','pinned memory, async copies, keep data on GPU'],
 ['NCCL kernels dominate','communication-bound','overlap comms, bigger buckets, topology'],
 ['One matmul kernel dominates, low achieved FLOPs','bad shapes or precision','align dimensions, use BF16/FP8 Tensor Core paths']
])}
<h3>Rules</h3>
<ul><li>Warm up first (compilation, cudnn autotune, allocator).</li><li>Synchronise before reading clocks or use CUDA events.</li><li>Profile a few steps, not hours: traces get huge.</li><li>Change one thing at a time and re-measure.</li></ul>
<h3>Profiling an inference engine specifically</h3><p>For vLLM-style engines, start with engine metrics: if queue time dominates, profiling kernels is pointless. If step time is the problem, capture a short Nsight Systems trace of a steady-state window under a realistic load generator. Look for: the share of each step in attention vs matmuls, NCCL time for tensor-parallel replicas, gaps between steps (scheduler CPU time), and whether CUDA graphs are being used for decode. Compare a trace at batch 8 with one at batch 128 to see where scaling stops.</p>`,
  diagram:fig('Profile top-down: system → step → kernel', svgDiagram({w:900,h:200,
    boxes:[
      {id:'m',x:20,y:70,w:170,h:60,label:'Measure E2E',sub:'synchronised',cls:'v1'},
      {id:'d',x:220,y:70,w:170,h:60,label:'DCGM',sub:'busy on what?',cls:'v2'},
      {id:'s',x:420,y:70,w:200,h:60,label:'Nsight Systems',sub:'timeline gaps',cls:'hl'},
      {id:'c',x:650,y:70,w:230,h:60,label:'Nsight Compute',sub:'one hot kernel',cls:'warn'}
    ],
    arrows:[{from:'m',to:'d'},{from:'d',to:'s'},{from:'s',to:'c'}]
  }), 'Most problems are found at the timeline level; kernel-level tuning is the last step.'),
  followups:[
    {q:'Profiling in production Kubernetes pods: concerns?',a:'Overhead and trace size; permissions for profiling counters (often restricted to admin); sensitive data in traces. Use short, sampled captures on a canary pod, or DCGM metrics continuously.'},
    {q:'The profiler shows the GPU busy 95 % of the step, all in matmuls, but MFU is 25 %. What next?',a:'Nsight Compute on the top matmuls: check whether Tensor Cores are used (precision, shapes divisible by 8/16), achieved bandwidth vs FLOPs, and whether small batch makes them memory-bound.'},
    {q:'What does torch.compile change in the timeline?',a:'It fuses many elementwise ops into fewer generated kernels and can use CUDA graphs, reducing launches and memory traffic; compile time is paid on first run.'}
  ],
  tradeoffs:`<ul><li><b>Continuous metrics</b> (DCGM) are cheap but coarse; <b>traces</b> are detailed but expensive and short.</li><li><b>Optimising kernels</b> yields little if the timeline shows idle gaps.</li></ul>`,
  failures:`<ul><li><b>Misleading micro-benchmarks</b> → no warm-up or synchronisation → fix harness.</li><li><b>Profiler distorts timing</b> → overhead → compare with unprofiled runs.</li><li><b>Profiling counters unavailable in container</b> → permission settings → run on a dedicated debug node.</li></ul>`,
  vocab:[
    {term:'Nsight Systems',def:'System-wide timeline profiler for CPU, GPU, memory copies and communication.'},
    {term:'Nsight Compute',def:'Kernel-level profiler with detailed hardware counters and roofline analysis.'},
    {term:'torch.profiler',def:'PyTorch\'s built-in profiler for operator and kernel timings.'},
    {term:'CUDA events',def:'GPU-side timestamps for accurate kernel timing.'},
    {term:'Pinned memory',def:'Page-locked host memory enabling fast asynchronous transfers.'}
  ],
  mistakes:[
    'Starting with kernel tuning before looking at the timeline.',
    'Timing without synchronisation or warm-up.',
    'Profiling for a long time and drowning in trace data.'
  ],
  related:['v1-multi-gpu-profiling','v1-cuda','v1-benchmarking']
},
{
  id:'gpu-07', chapter:'v3-ch-gpu', difficulty:1,
  title:'MIG versus time-slicing versus MPS versus whole GPUs: when do you use each?',
  understand:'They test GPU sharing options for multi-tenant platforms: isolation guarantees, supported hardware, granularity and how Kubernetes exposes them.',
  short:'A whole GPU is simplest and isolates best, but small models waste most of it. MIG, on supported data-centre GPUs like A100, H100, H200 and B200, splits one GPU into up to seven hardware partitions, each with its own memory slice and compute slices and fault isolation; on an H100 80 GB, profiles go from 1g.10gb up to 7g.80gb. It is good for many small, steady inference services or notebooks, but partitions are fixed sizes and reconfiguration needs the GPU idle. Time-slicing just lets several pods take turns on one GPU, with no memory or fault isolation, so one tenant can OOM another; fine for dev and bursty low-priority work. MPS lets processes run kernels concurrently on one GPU with better utilisation than time-slicing, but still limited isolation. L4 and L40S do not support MIG.',
  detailed:`
${table(['Option','Isolation','Granularity','Hardware','Best for'],[
 ['Whole GPU','full','1 GPU','all','large models, latency-critical serving, training'],
 ['MIG','hardware: memory, cache, compute slices; fault isolation','fixed profiles (up to 7)','A100, H100, H200, B200, GB200 and others (not L4/L40S/T4)','many small steady services, multi-tenant notebooks'],
 ['MPS','limited (shared address-space protections improved, still shared faults)','fractional, concurrent','most CUDA GPUs','co-located cooperative processes, inference bursts'],
 ['Time-slicing','none for memory or faults','N replicas of a GPU','all (via device plugin config)','dev/test, low-priority bursty jobs']
])}
<h3>H100 80 GB MIG profiles (NVIDIA docs, Oct 2026)</h3>
${table(['Profile','Max count','Memory share','Compute share'],[
 ['1g.10gb','7','1/8','1/7'],
 ['1g.20gb','4','1/4','1/7'],
 ['2g.20gb','3','2/8','2/7'],
 ['3g.40gb','2','4/8','3/7'],
 ['4g.40gb','1','4/8','4/7'],
 ['7g.80gb','1','full','7/7']
])}
${formula(`
Will an 8B BF16 model fit in a 3g.40gb slice?
  weights 16.1 GB, reserve ≈ 3 GB (illustrative) → 40 GB − 19.1 ≈ 20.9 GB KV
  ≈ 20.9 × 10⁹ / 131,072 B ≈ 159,000 tokens → ≈ 19 sequences at 8k
  and compute is 3/7 of the GPU, so TPOT and throughput are lower than a full H100.
`)}
<h3>Kubernetes exposure</h3>
<p>The NVIDIA GPU Operator's MIG Manager applies a MIG layout per node (via labels); the device plugin advertises either a single strategy (<code>nvidia.com/gpu</code>) or mixed strategy resources like <code>nvidia.com/mig-3g.40gb</code>. Time-slicing is configured in the device plugin, which advertises more <code>nvidia.com/gpu</code> replicas than physical GPUs. NVIDIA's docs are explicit: unlike MIG there is no memory or fault isolation between time-sliced replicas. GPU requests must be in limits (extended resources cannot be overcommitted).</p>
<h3>Choosing a layout for a platform</h3><p>Group workloads by size class and give each class a node pool: whole-GPU nodes for large or latency-critical models, MIG nodes with a fixed layout (for example 2 × 3g.40gb or 7 × 1g.10gb) for small models and notebooks, and a small time-sliced pool for development. Fixed layouts per pool keep scheduling predictable and avoid frequent reconfiguration.</p>`,
  diagram:fig('Sharing options on one GPU', svgDiagram({w:900,h:250,
    zones:[{x:10,y:20,w:430,h:220,label:'MIG (H100): hardware partitions',cls:'ok'},{x:460,y:20,w:430,h:220,label:'Time-slicing: shared everything',cls:'danger'}],
    boxes:[
      {id:'m1',x:30,y:60,w:190,h:70,label:'3g.40gb',sub:'tenant A, own memory',cls:'v1'},
      {id:'m2',x:230,y:60,w:190,h:70,label:'3g.40gb',sub:'tenant B, own memory',cls:'v2'},
      {id:'m3',x:30,y:150,w:390,h:60,label:'faults stay inside one partition',cls:'ok'},
      {id:'t1',x:480,y:60,w:190,h:70,label:'Pod A',sub:'takes turns',cls:'v1'},
      {id:'t2',x:680,y:60,w:190,h:70,label:'Pod B',sub:'takes turns',cls:'v2'},
      {id:'t3',x:480,y:150,w:390,h:60,label:'one 80 GB pool: A can OOM B',cls:'bad'}
    ]
  }), 'MIG trades flexibility for isolation; time-slicing trades isolation for sharing.'),
  followups:[
    {q:'Can you change MIG layouts on the fly?',a:'Reconfiguration requires no processes on the affected GPU; in Kubernetes that means draining GPU workloads from the node while MIG Manager applies the new layout. Plan layouts per node pool rather than per pod.'},
    {q:'Is MIG good for a 70B model?',a:'No. A 70B model needs multiple whole GPUs with NVLink for tensor parallelism. MIG suits small models and small workloads.'},
    {q:'How do you charge back shared GPUs?',a:'Attribute by MIG profile size (memory and compute fractions) or, for time-slicing, by measured usage per pod (DCGM per-process metrics are limited); simpler is to give each tenant fixed slices and charge the slice.'}
  ],
  tradeoffs:`<ul><li><b>MIG</b>: strong isolation, fixed sizes, possible stranded capacity.</li><li><b>Time-slicing</b>: flexible, no isolation, noisy neighbours.</li><li><b>MPS</b>: better concurrency than time-slicing, weaker isolation than MIG.</li><li><b>Whole GPU</b>: best performance and isolation, lowest utilisation for small workloads.</li></ul>`,
  failures:`<ul><li><b>Tenant A crashes tenant B</b> on time-sliced GPU → no isolation → MIG or dedicated GPUs for production.</li><li><b>Pods pending for mig resources</b> → node layout mismatch → check MIG Manager labels and advertised resources.</li><li><b>Latency spikes on shared GPU</b> → contention → move latency-critical services to whole GPUs.</li></ul>`,
  vocab:[
    {term:'MIG',def:'Multi-Instance GPU: hardware partitioning of supported NVIDIA GPUs into isolated instances.'},
    {term:'MIG profile',def:'A partition size such as 1g.10gb or 3g.40gb (compute slices, memory).'},
    {term:'Time-slicing',def:'Sharing a GPU by interleaving workloads in time, without memory or fault isolation.'},
    {term:'MPS',def:'Multi-Process Service: lets multiple processes run kernels concurrently on one GPU.'},
    {term:'MIG Manager',def:'GPU Operator component that applies MIG layouts to nodes.'}
  ],
  mistakes:[
    'Saying MIG works on every NVIDIA GPU (not on L4, L40S, T4).',
    'Claiming time-slicing isolates memory.',
    'Using MIG for models that need multi-GPU tensor parallelism.'
  ],
  related:['v1-k8s-gpu-stack','v2-governance','v2-finops-optimization']
},
{
  id:'gpu-08', chapter:'v3-ch-gpu', difficulty:2,
  title:'What are the trade-offs between quantization formats?',
  understand:'They want you to distinguish weight-only from weight-and-activation quantization, KV quantization, hardware support (FP8 on Hopper/Ada, NVFP4 on Blackwell), and an evaluation method. "INT4 is 4× faster" is the trap.',
  short:'Quantization stores numbers in fewer bits. The question is what you quantize and whether the hardware has kernels for it. Weight-only formats like AWQ or GPTQ at 4 bits shrink weights to roughly a quarter, which helps memory capacity and memory-bound decode, but the matmul still runs in 16-bit after dequantization, so at high batch it can be slower than FP8. FP8 for weights and activations runs natively on Hopper Tensor Cores, halves memory and can raise compute throughput, usually with small quality loss. FP8 KV cache halves KV memory and doubles concurrency. NVFP4 is a Blackwell feature. I choose by measuring quality on our eval set, plus TTFT, TPOT and throughput at our real concurrency.',
  detailed:`
${table(['Format','What is quantized','Bytes per weight','Speed effect','Hardware notes'],[
 ['BF16 (baseline)','nothing','2','reference','all modern GPUs'],
 ['FP8 W8A8','weights + activations','1','faster prefill (FP8 Tensor Cores) and decode','Hopper (H100/H200), Ada (L40S/L4), Blackwell'],
 ['INT8 W8A8 (e.g. SmoothQuant)','weights + activations','1','faster on INT8-capable paths','older GPUs (A100) too'],
 ['W4A16 (AWQ, GPTQ)','weights only','≈ 0.5 + scales','faster decode at small batch; can lose at large batch','broad kernel support'],
 ['NVFP4','weights (+ activations)','≈ 0.5 + scales','high throughput on supported kernels','Blackwell only (not Hopper/Ada/Ampere) per TRT-LLM docs'],
 ['FP8 KV cache','keys and values','KV 1 byte per element','2× KV capacity, less KV bandwidth','engine flag (vLLM --kv-cache-dtype fp8)']
])}
${formula(`
70B weights by format
  BF16  70.6 × 10⁹ × 2   = 141.1 GB
  FP8   70.6 × 10⁹ × 1   =  70.6 GB
  INT4  70.6 × 10⁹ × 0.5 =  35.3 GB  (+ group scales, ≈ 39 GB illustrative)

Batch-1 decode lower bound on ONE H100 (bandwidth only; BF16 does not fit, FP8 leaves ≈ 3 GB for KV):
  INT4 ≈ 39 GB / 3.35 TB/s ≈ 11.6 ms/token
`)}
<h3>Why INT4 can be slower</h3>
<p>Weight-only kernels load 4-bit weights and dequantize to BF16 inside the kernel. At batch 1 the byte saving dominates and it wins. At large batch the step becomes compute-bound; dequantization overhead and less-optimised kernels can make it lose to FP8, which uses native FP8 Tensor Core instructions.</p>
<h3>Evaluation method</h3>
<ol><li>Use calibrated checkpoints from a reputable pipeline (for example NVIDIA ModelOpt or the model publisher) or quantize with representative calibration data.</li><li>Run the same task eval set (by language and intent) and a general regression suite; compare with BF16.</li><li>Benchmark at real input/output length distribution and concurrency: TTFT, TPOT, goodput.</li><li>Compute cost per successful request; pick the cheapest that meets quality and SLO.</li></ol>`,
  diagram:fig('Where quantization acts in a forward pass', svgDiagram({w:900,h:200,
    boxes:[
      {id:'w',x:20,y:70,w:180,h:60,label:'Weights',sub:'FP8 / INT4 / NVFP4',cls:'v1'},
      {id:'a',x:230,y:70,w:180,h:60,label:'Activations',sub:'BF16 or FP8',cls:'v2'},
      {id:'mm',x:440,y:70,w:180,h:60,label:'Matmul',sub:'native FP8 or dequant',cls:'hl'},
      {id:'kv',x:650,y:70,w:230,h:60,label:'KV cache',sub:'BF16 or FP8',cls:'warn'}
    ],
    arrows:[{from:'w',to:'mm'},{from:'a',to:'mm'},{from:'mm',to:'kv'}]
  }), 'Each box can be quantized independently; speed depends on which matmul path the kernel uses.'),
  followups:[
    {q:'Arabic quality dropped after quantization but English did not. Why might that be?',a:'Calibration data may have been mostly English, so scales fit English activation ranges; lower-resource language paths are more sensitive. Recalibrate with bilingual data and gate per language.'},
    {q:'When is FP8 KV a bad idea?',a:'When long-context accuracy tasks regress on your eval, or the engine/hardware lacks efficient FP8 attention kernels. Always measure; it is usually a good trade but not universal.'},
    {q:'Does quantization reduce cost per token?',a:'Only if it lets you use fewer GPUs per replica or more concurrency per GPU at the same SLO and quality. Measure tokens/s per GPU and success rate, then compute cost per successful request.'}
  ],
  tradeoffs:`<ul><li><b>Fewer bits</b>: more capacity, more bandwidth headroom, more quality risk.</li><li><b>Weight-only vs W8A8</b>: easier quality vs better compute speed.</li><li><b>Hardware lock-in</b>: NVFP4 needs Blackwell.</li></ul>`,
  failures:`<ul><li><b>Quality regression on a slice</b> → calibration mismatch → representative calibration, per-slice gates.</li><li><b>No speed-up</b> → kernels fall back to slow path → check engine logs and supported formats.</li><li><b>Engine refuses model</b> → format not supported on this GPU → choose a supported format.</li></ul>`,
  vocab:[
    {term:'Weight-only quantization',def:'Low-bit weights dequantized to higher precision for compute (e.g. W4A16).'},
    {term:'W8A8',def:'8-bit weights and 8-bit activations, enabling 8-bit matmuls.'},
    {term:'AWQ / GPTQ',def:'Post-training 4-bit weight quantization methods using calibration data.'},
    {term:'NVFP4',def:'NVIDIA 4-bit floating-point format supported on Blackwell.'},
    {term:'Calibration data',def:'Representative inputs used to choose quantization scales.'}
  ],
  mistakes:[
    'Assuming lower bits are always faster.',
    'Not evaluating quality per language or task slice.',
    'Planning NVFP4 on Hopper GPUs.',
    'Forgetting scale/zero-point overhead in memory estimates.'
  ],
  related:['v1-quantization-speculative','v1-engines','v1-benchmarking']
},
{
  id:'gpu-09', chapter:'v3-ch-gpu', difficulty:3,
  title:'PCIe, NVLink, InfiniBand/EFA: why does tensor parallelism stay inside a node?',
  understand:'Architect-level. They want approximate bandwidth figures, the communication pattern of tensor-parallel decode, a back-of-envelope cost per step, and the conclusion that TP belongs on NVLink while data parallel or pipeline parallel can cross nodes.',
  short:'The links differ by about an order of magnitude. NVLink on an H100 node gives 900 gigabytes per second per GPU; PCIe Gen5 is 128 gigabytes per second total for the slot; inter-node networks like InfiniBand or EFA are around 400 gigabits per GPU, about 50 gigabytes per second. Tensor parallelism splits every layer\'s matmuls, so it needs an all-reduce of the activations twice per layer, every decode step. For a 70B model that is 160 all-reduces per token step. On NVLink that adds well under a millisecond; across nodes, bandwidth and especially per-message latency add several milliseconds per step, which can double TPOT. So TP stays inside the NVLink domain, and I scale across nodes with independent replicas, pipeline parallelism, or for training, data-parallel and FSDP with hybrid sharding.',
  detailed:`
${table(['Link','Approximate bandwidth (H100 era)','Scope'],[
 ['NVLink + NVSwitch','900 GB/s per GPU (total, both directions)','GPUs within one HGX node'],
 ['PCIe Gen5 x16','128 GB/s (total, both directions)','GPU ↔ CPU, NIC, storage'],
 ['InfiniBand / EFA','p5.48xlarge: 3,200 Gbps per node ≈ 400 Gbps per GPU ≈ 50 GB/s','between nodes'],
 ['GB200 NVL72','130 TB/s NVLink across 72 GPUs','rack-scale NVLink domain']
])}
${formula(`
Tensor-parallel decode, Llama-3.1-70B, TP = 4, batch 64 (illustrative)

STEP 1  message per all-reduce = batch × hidden × 2 B
                               = 64 × 8,192 × 2  = 1,048,576 B = 1 MiB
STEP 2  ring all-reduce sends per GPU ≈ 2 × (TP − 1)/TP × message
                               = 2 × 3/4 × 1 MiB = 1.5 MiB
STEP 3  all-reduces per step   = 2 per layer × 80 layers = 160
        bytes per GPU per step = 160 × 1.5 MiB = 240 MiB ≈ 252 MB
STEP 4  time at ≈ 450 GB/s one-direction NVLink ≈ 0.56 ms
        time at ≈ 50 GB/s network               ≈ 5.0 ms
        + per-message latency: 160 × (say) 20 µs = 3.2 ms   ← latency matters too
ANSWER  NVLink: < 1 ms per step; cross-node: ≈ 5–8 ms per step,
        comparable to the whole ideal decode step (≈ 10.5 ms for BF16 TP=4)
`)}
<p>The per-message latency number is illustrative; small messages at batch 1 make latency, not bandwidth, the bottleneck, which is even worse across nodes.</p>
<h3>Design rules</h3>
<ul><li><b>Serving</b>: TP within a node; replicas across nodes; pipeline parallelism across nodes only if one replica must exceed a node; prefill/decode disaggregation moves KV between nodes (bulk transfer, tolerant of bandwidth, sensitive to size).</li>
<li><b>Training</b>: TP in node, PP and DP across nodes; hybrid sharding so FSDP all-gathers stay in node.</li>
<li><b>Kubernetes</b>: topology-aware scheduling (gang scheduling, Kueue TAS) so a job's ranks land on well-connected nodes; GPUDirect RDMA and EFA device plugins for network paths.</li></ul>
<p>Interview framing: lead with "TP communicates every layer on the critical path, so it belongs on the fastest link", then give one number from the worked example.</p>`,
  diagram:fig('Fast inside the node, slow between nodes', svgDiagram({w:900,h:250,
    zones:[{x:10,y:20,w:400,h:210,label:'Node 1 (NVSwitch)'},{x:490,y:20,w:400,h:210,label:'Node 2 (NVSwitch)'}],
    boxes:[
      {id:'a',x:30,y:60,w:170,h:60,label:'TP group',sub:'GPUs 0–3',cls:'hl'},
      {id:'b',x:220,y:60,w:170,h:60,label:'TP group',sub:'GPUs 4–7',cls:'hl'},
      {id:'c',x:510,y:60,w:170,h:60,label:'TP group',sub:'GPUs 0–3',cls:'hl'},
      {id:'d',x:700,y:60,w:170,h:60,label:'TP group',sub:'GPUs 4–7',cls:'hl'},
      {id:'n1',x:110,y:160,w:200,h:50,label:'NIC: ≈ 50 GB/s/GPU',cls:'warn'},
      {id:'n2',x:590,y:160,w:200,h:50,label:'NIC: ≈ 50 GB/s/GPU',cls:'warn'}
    ],
    arrows:[{from:'n1',to:'n2',label:'IB / EFA',both:true}],
    notes:[{x:30,y:145,text:'NVLink ≈ 900 GB/s'}]
  }), 'Each TP group is an independent replica; only replica-level traffic (requests, KV transfer) crosses nodes.'),
  followups:[
    {q:'Why does PCIe matter for inference at all?',a:'Model loading from host or NVMe, KV offload to CPU memory, and GPUs without NVLink (L40S/L4 nodes) do TP over PCIe, which is far slower; such nodes favour TP=1 replicas.'},
    {q:'What is GPUDirect RDMA?',a:'NICs read and write GPU memory directly without staging in host memory, cutting latency and CPU load for NCCL and KV transfers between nodes.'},
    {q:'Rack-scale NVLink (GB200 NVL72) changes what?',a:'The NVLink domain grows to 72 GPUs, so large TP/EP groups (for big MoE models) can stay on NVLink, which is why such systems target very large models and wide expert parallelism.'}
  ],
  tradeoffs:`<ul><li><b>Bigger TP</b>: lower per-token latency until communication dominates.</li><li><b>Replicas</b>: linear throughput scaling, no inter-GPU traffic, more weight copies.</li><li><b>Rack-scale NVLink</b>: more flexibility, higher cost and power.</li></ul>`,
  failures:`<ul><li><b>TPOT doubles after rescheduling</b> → TP ranks split across nodes or PCIe-only → enforce node-local placement.</li><li><b>NCCL slow / falls back to TCP</b> → RDMA misconfigured → check NCCL logs for transport selection.</li><li><b>Xid 74</b> → NVLink error → drain and diagnose.</li></ul>`,
  vocab:[
    {term:'NVLink / NVSwitch',def:'High-bandwidth GPU-to-GPU links and switches within a node or rack.'},
    {term:'InfiniBand / EFA',def:'Low-latency inter-node networks (EFA on AWS) used by NCCL.'},
    {term:'GPUDirect RDMA',def:'Direct NIC access to GPU memory.'},
    {term:'Ring all-reduce',def:'All-reduce algorithm where each GPU sends about 2(N−1)/N of the data.'},
    {term:'NVLink domain',def:'Set of GPUs connected by NVLink at full bandwidth.'}
  ],
  mistakes:[
    'Quoting 900 GB/s as one-direction bandwidth (it is the total).',
    'Placing TP across nodes.',
    'Ignoring per-message latency for small decode all-reduces.'
  ],
  related:['v1-multi-gpu-profiling','v2-parallelism','v2-distributed-inference','v1-k8s-gpu-stack']
},
{
  id:'gpu-10', chapter:'v3-ch-gpu', difficulty:2,
  title:'A GPU node keeps crashing under load. How do you isolate the problem?',
  understand:'An operations question where your SRE instincts shine: preserve evidence, classify errors (application vs device vs host), use Xid codes and DCGM, cordon and drain, and follow vendor actions rather than blind restarts.',
  short:'First, preserve evidence before restarting anything: kernel logs with NVIDIA Xid messages, DCGM metrics for temperature, power, clocks and ECC, the application error, and which pods ran there. Then classify. Xid 13 and 31 usually mean the application did something illegal, so it is a software bug and restarting the app is the documented action. Xid 48 is a double-bit ECC error, 79 means the GPU fell off the bus, 74 is NVLink, 95 is an uncontained memory error: those are hardware or driver issues, so I cordon and drain the node and follow NVIDIA\'s workflow, GPU reset or reboot, diagnostics, and replacement if it recurs. I also separate CUDA OOM and Kubernetes OOMKilled, which are not device faults at all. And I automate it: Xid alerts that cordon nodes.',
  detailed:`
<h3>Evidence to collect (before any restart)</h3>
<ul><li><code>dmesg</code> / journal lines containing <code>NVRM: Xid</code> with codes and PCI address.</li>
<li>DCGM: <code>DCGM_FI_DEV_XID_ERRORS</code> (a gauge holding the <i>last</i> Xid value, not a counter), temperature, power (<code>DCGM_FI_DEV_POWER_USAGE</code>), clocks, ECC counters, PCIe replay counters.</li>
<li><code>nvidia-smi -q</code> for ECC, retired/remapped pages, throttle reasons.</li>
<li>Application logs and exit codes; Kubernetes events (OOMKilled, evictions).</li>
<li>Which workloads and image versions ran on the node; driver version.</li></ul>
<h3>Xid triage (NVIDIA Xid catalog, landing page updated Sep 2026)</h3>
${table(['Xid','Meaning','Catalog immediate action','Platform response'],[
 ['13','graphics engine exception (often app out-of-bounds)','RESTART_APP','fix app; node usually healthy'],
 ['31','GPU memory page fault (illegal address, usually app bug)','RESTART_APP','fix app; check for driver bug if widespread'],
 ['43','GPU stopped processing','IGNORE','correlate with others'],
 ['45','preemptive cleanup after previous errors','follow other Xid','look for the root Xid'],
 ['48','double-bit ECC error','GPU reset or node reboot needed','drain, reset, watch for repeats'],
 ['63 / 64','memory remapping event / failure','64: RESET_GPU','64 → drain, contact support'],
 ['74','NVLink error','NVLink workflow','drain; TP jobs affected'],
 ['79','GPU fallen off the bus','RESTART_BM (bare metal)','drain; hardware ticket'],
 ['94','contained memory error','RESTART_APP','only the offending app restarts'],
 ['95','uncontained memory error','RESET_GPU','drain and reset']
])}
<h3>Process</h3>
<ol><li>Cordon the node; drain workloads (with PDBs respected) so users stop hitting it.</li><li>Collect evidence; open a hardware ticket for hardware-class Xids.</li><li>Reset or reboot per the catalog; run diagnostics (DCGM diagnostics levels) before readmitting.</li><li>Reproduce under load on the isolated node with a known-good workload; compare with a healthy node.</li><li>Return to service only after a clean burn-in; track repeat offenders and replace.</li></ol>
<p>Automate: a controller or alert rule that cordons and taints nodes on hardware-class Xids and notifies on-call, so the next pod is not scheduled onto a bad GPU.</p>`,
  diagram:fig('Classify before you restart', svgDiagram({w:900,h:240,
    boxes:[
      {id:'s',x:20,y:90,w:140,h:60,label:'Crash under load',cls:'bad'},
      {id:'e',x:190,y:90,w:150,h:60,label:'Collect evidence',sub:'Xid, DCGM, events',cls:'hl'},
      {id:'a',x:400,y:20,w:200,h:56,label:'App fault',sub:'Xid 13 / 31 / 94',cls:'v1'},
      {id:'h',x:400,y:92,w:200,h:56,label:'Device fault',sub:'Xid 48 / 74 / 79 / 95',cls:'bad'},
      {id:'m',x:400,y:164,w:200,h:56,label:'Not GPU',sub:'OOMKilled, CUDA OOM',cls:'warn'},
      {id:'f1',x:650,y:20,w:230,h:56,label:'Fix code, restart app',cls:'ok'},
      {id:'f2',x:650,y:92,w:230,h:56,label:'Cordon, drain, reset, diag',cls:'ok'},
      {id:'f3',x:650,y:164,w:230,h:56,label:'Limits, batch, context',cls:'ok'}
    ],
    arrows:[{from:'s',to:'e'},{from:'e',to:'a'},{from:'e',to:'h'},{from:'e',to:'m'},{from:'a',to:'f1'},{from:'h',to:'f2'},{from:'m',to:'f3'}]
  }), 'The Xid code decides whether this is your bug or the hardware\'s.'),
  followups:[
    {q:'Thermal throttling: how would you spot it?',a:'Clocks drop under load while temperature or power hits limits; throughput per GPU falls on that node versus peers. nvidia-smi throttle reasons and DCGM clocks/temperature confirm it; fix airflow, power caps or hardware.'},
    {q:'Why alert on Xid with a gauge carefully?',a:'DCGM_FI_DEV_XID_ERRORS holds the last Xid value, so a change in value (or presence of a non-zero value) is the signal; counting occurrences needs the separate exporter counters (disabled by default) or log-based alerts.'},
    {q:'One node has repeated Xid 31 across different apps. App bug or hardware?',a:'If several unrelated, well-tested apps fault only on that node, suspect hardware or driver on that node: compare driver versions, run diagnostics and burn-in, and swap the workload to a peer node to confirm.'}
  ],
  tradeoffs:`<ul><li><b>Aggressive auto-cordon</b> protects users but may strand capacity on false positives.</li><li><b>Quick restart</b> restores service but destroys evidence.</li></ul>`,
  failures:`<ul><li><b>Restart loop on the same GPU</b> → no cordon → automate taints on hardware Xids.</li><li><b>TP job hangs</b> after Xid 74 on one GPU → whole replica unhealthy → health checks must fail the replica.</li></ul>`,
  vocab:[
    {term:'Xid',def:'NVIDIA driver error code logged by the kernel for GPU events.'},
    {term:'ECC DBE',def:'Double-bit ECC error: uncorrectable memory error (Xid 48).'},
    {term:'Fallen off the bus',def:'GPU no longer reachable over PCIe (Xid 79).'},
    {term:'DCGM diagnostics',def:'NVIDIA Data Center GPU Manager health tests at several depth levels.'},
    {term:'Cordon / drain',def:'Kubernetes: mark a node unschedulable and evict its pods.'}
  ],
  mistakes:[
    'Restarting before capturing Xid and DCGM evidence.',
    'Treating CUDA OOM or OOMKilled as hardware faults.',
    'Treating DCGM_FI_DEV_XID_ERRORS as a counter.',
    'Returning a node to service without diagnostics.'
  ],
  related:['v1-k8s-gpu-stack','v2-aiops','v3-debugging','v1-gpu-memory']
},
{
  id:'gpu-11', chapter:'v3-ch-gpu', difficulty:3,
  title:'Why is FlashAttention faster than standard attention?',
  understand:'Architect-level depth on IO-aware algorithm design. They want: standard attention materialises the n × n matrix in HBM; FlashAttention tiles the computation in on-chip SRAM with an online softmax, produces the exact same result, and saves HBM traffic and memory.',
  short:'Standard attention computes the full n by n score matrix, writes it to HBM, reads it back for softmax, writes the probabilities, and reads them again to multiply by V. For long sequences that matrix is huge and the work is dominated by memory traffic, not maths. FlashAttention is IO-aware: it splits queries, keys and values into tiles that fit in on-chip shared memory, computes scores and a running, numerically stable softmax tile by tile, and accumulates the output without ever writing the full matrix to HBM. The result is exact, not an approximation. It uses memory linear in sequence length and much less HBM traffic, so it is faster, especially at long context, and it also enables longer training sequences. Later versions improved parallelism and use Hopper-specific features.',
  detailed:`
${formula(`
Standard attention memory for the score matrix (one head, one sequence)
  n = 8,192 tokens, BF16:  n² × 2 B = 67,108,864 × 2 = 134,217,728 B = 128 MiB
  × 32 heads (8B model)                                = 4 GiB per layer per sequence
  → written and read several times: HBM traffic dominates

FlashAttention keeps tiles in SRAM (per-SM shared memory: KB to hundreds of KB)
  extra memory O(n) for softmax statistics, never O(n²)
`)}
<h3>Online softmax: the trick that makes tiling exact</h3>
<p>Softmax needs the maximum and the sum over the whole row. FlashAttention keeps, for each query row, a running maximum m and running sum ℓ. When a new tile of scores arrives, it rescales previous partial results:</p>
${formula(`
m_new = max(m_old, max(tile))
ℓ_new = ℓ_old · exp(m_old − m_new) + Σ exp(tile − m_new)
O_new = O_old · exp(m_old − m_new) + exp(tile − m_new) · V_tile
Final output = O / ℓ      ← identical to softmax(QKᵀ/√d)·V up to floating-point rounding
`)}
<h3>Versions (paper titles verified)</h3>
<ul><li>FlashAttention: "Fast and Memory-Efficient Exact Attention with IO-Awareness" (arXiv 2205.14135).</li>
<li>FlashAttention-2 (arXiv 2307.08691): better work partitioning across warps and thread blocks.</li>
<li>FlashAttention-3 (arXiv 2407.08608): uses Hopper features (asynchrony, FP8).</li></ul>
<h3>Why platform engineers care</h3>
<ul><li>Engines and training frameworks pick attention backends; the wrong backend (unsupported GPU or dtype) silently falls back to a slower path.</li>
<li>Paged KV caches need attention kernels that read non-contiguous blocks; engines ship such kernels (FlashAttention-style and others).</li>
<li>It changes the roofline position of attention: fewer bytes moved, more of the time in compute.</li></ul>
<p>Decode attention (one query row per sequence) is a different shape; engines use specialised decode kernels that split the KV sequence across thread blocks.</p>
<p>Interview framing: "FlashAttention is an IO optimisation, not a maths change: same exact result, far fewer HBM bytes, and memory linear in sequence length". Then mention that it is why long-context training became practical.</p>`,
  diagram:fig('Standard vs IO-aware attention', svgDiagram({w:900,h:250,
    zones:[{x:10,y:20,w:430,h:220,label:'Standard',cls:'danger'},{x:460,y:20,w:430,h:220,label:'FlashAttention',cls:'ok'}],
    boxes:[
      {id:'a1',x:30,y:60,w:120,h:50,label:'QKᵀ',cls:'v1'},
      {id:'a2',x:170,y:60,w:120,h:50,label:'HBM n×n',cls:'bad'},
      {id:'a3',x:310,y:60,w:110,h:50,label:'softmax',cls:'v1'},
      {id:'a4',x:170,y:160,w:120,h:50,label:'HBM n×n',cls:'bad'},
      {id:'a5',x:310,y:160,w:110,h:50,label:'× V',cls:'v1'},
      {id:'b1',x:480,y:60,w:180,h:50,label:'Load Q, K, V tiles',cls:'v2'},
      {id:'b2',x:690,y:60,w:180,h:50,label:'SRAM: score + softmax',cls:'hl'},
      {id:'b3',x:690,y:160,w:180,h:50,label:'Accumulate O',cls:'ok'},
      {id:'b4',x:480,y:160,w:180,h:50,label:'Write O once',cls:'ok'}
    ],
    arrows:[{from:'a1',to:'a2'},{from:'a2',to:'a3'},{from:'a3',to:'a4'},{from:'a4',to:'a5'},{from:'b1',to:'b2'},{from:'b2',to:'b3'},{from:'b3',to:'b4'}]
  }), 'Same maths, far fewer HBM round trips.'),
  followups:[
    {q:'Is FlashAttention an approximation like sparse attention?',a:'No. It computes exact attention; differences are only floating-point rounding. Sparse or sliding-window attention change what is computed.'},
    {q:'Does it reduce FLOPs?',a:'Not meaningfully; it may even recompute some values in backward. The win is memory traffic and memory footprint, which were the real bottleneck.'},
    {q:'How would you confirm your engine uses an efficient attention backend?',a:'Check engine startup logs for the selected attention backend, compare against supported GPU and dtype, and profile attention kernels with Nsight Systems.'}
  ],
  tradeoffs:`<ul><li><b>Fused kernels</b>: big speed-ups, but hardware- and dtype-specific code paths.</li><li><b>Recomputation in backward</b>: saves memory for a little extra compute.</li></ul>`,
  failures:`<ul><li><b>Slow long-context prefill</b> after a GPU or dtype change → backend fallback → check logs.</li><li><b>Numerical mismatch in tests</b> → expecting bitwise equality with naive attention → compare with tolerances.</li></ul>`,
  vocab:[
    {term:'IO-aware algorithm',def:'Algorithm designed to minimise data movement between memory levels.'},
    {term:'Tiling',def:'Processing data in blocks that fit in fast on-chip memory.'},
    {term:'Online softmax',def:'Computing softmax incrementally with running max and sum.'},
    {term:'SRAM / shared memory',def:'Small, fast on-chip memory per SM.'},
    {term:'Attention backend',def:'The kernel implementation an engine selects for attention.'}
  ],
  mistakes:[
    'Calling FlashAttention approximate.',
    'Saying it reduces FLOPs as its main benefit.',
    'Ignoring backend selection when changing GPUs or dtypes.'
  ],
  related:['v1-cuda','v1-gpu-architecture','v1-transformer']
}
]);
