/* Volume 2, Part 3: Distributed training and inference */
registerLesson({
  id:'v2-parallelism', vol:2, part:3, num:1,
  title:'Parallelism strategies and Mixture-of-Experts', minutes:100,
  summary:'When a model or its training state does not fit on one GPU, or one GPU is too slow, the work has to be split. Data parallelism copies the model and splits the batch. Tensor parallelism splits each layer’s matrices. Pipeline parallelism splits the stack of layers. Expert parallelism places the experts of a mixture-of-experts model on different GPUs, and context parallelism splits very long sequences. Each split trades memory for communication, and this lesson shows the arithmetic that decides which one to use, including how ZeRO sharding makes a 70-billion-parameter training run fit.',
  objectives:[
    'Explain data, tensor, pipeline, expert and context parallelism and what each one communicates.',
    'Derive the column-then-row split of a transformer MLP and why it needs one all-reduce per block.',
    'Calculate the pipeline bubble fraction (p − 1)/(m + p − 1) and choose a micro-batch count.',
    'Explain MoE top-k routing, all-to-all dispatch, capacity and load balancing.',
    'Compute per-GPU training memory for a 70B model under ZeRO stages 1, 2 and 3 on 8 and 64 GPUs.'
  ],
  prereqs:['v1-transformer','v1-gpu-memory','v1-multi-gpu-profiling'],
  next:['v2-distributed-training','v2-distributed-inference','v2-capacity-planning'],
  tags:['distributed','gpu','training','moe'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A kitchen with one huge order. You can hire more cooks who each make complete dishes for different tables (data parallel), have several cooks share the chopping of one giant dish (tensor parallel), set up an assembly line where each cook does one stage (pipeline), or hire specialists and send each ingredient only to the specialist it needs (experts). Every option adds talking between cooks. Now the real mechanism.')}
<p>${term('Parallelism')} is how one model's work is split across many GPUs. There are five axes, and large runs combine several of them (often called "3D" or "4D" parallelism):</p>
${table(['Axis','What is split','What is communicated','Typical scope'],[
 ['Data parallel (DP)','the batch; every GPU holds a full model copy (or a shard with ZeRO/FSDP)','gradients (all-reduce) once per step; with sharding also parameters (all-gather)','across nodes'],
 ['Tensor parallel (TP)','each weight matrix inside a layer','activations (all-reduce) twice per transformer block, forward and backward','inside one NVLink domain'],
 ['Pipeline parallel (PP)','the stack of layers into stages','activations between neighbouring stages (point-to-point)','across nodes'],
 ['Expert parallel (EP)','the experts of an MoE layer','tokens to and from experts (all-to-all)','across GPUs/nodes'],
 ['Context / sequence parallel (CP/SP)','the sequence (tokens) dimension','keys/values passed around a ring, or activation shards','for very long contexts']
])}

<h2>2. Why do we need it?</h2>
<p>Two different reasons, and confusing them leads to bad designs:</p>
<ol>
<li><b>It does not fit.</b> Llama-3.1-70B-class weights in BF16 are about 141 GB, more than one 80 GB H100. Training needs far more than weights (gradients, optimizer state, activations).</li>
<li><b>It is too slow.</b> Training a large model on one GPU would take years; serving a burst of users on one replica would queue for minutes.</li>
</ol>
<p>Data parallelism solves "too slow" when the model fits. TP, PP, EP and CP solve "does not fit" (and also cut per-request latency for serving). ZeRO/FSDP is a memory trick applied to data parallelism. The old course's framing — "replication and sharding solve different problems" — is right; this lesson adds the numbers.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 Data parallelism and the memory wall</h3>
<p>Each of N GPUs runs forward and backward on a different slice of the global batch, then the gradients are averaged with an all-reduce (${L('v2-distributed-training','next lesson')} explains the ring algorithm) so every replica applies the same update. Global batch = micro-batch × gradient-accumulation steps × N. Doubling N without adjusting accumulation doubles the global batch and can change convergence: training is not a stateless Deployment you can HPA.</p>
<p>The problem: plain data parallelism (DDP) keeps the <b>whole training state</b> on every GPU. With mixed-precision Adam that is 16 bytes per parameter before activations:</p>
${formula(`
Training state per parameter (mixed precision, Adam; activations excluded)

   BF16 weights               2 B
   BF16 gradients             2 B
   FP32 master weights        4 B
   FP32 Adam first moment m   4 B
   FP32 Adam second moment v  4 B
   ─────────────────────────────
   total                     16 B      (ZeRO paper: 2Ψ + 2Ψ + 12Ψ, Ψ = parameters)

70B model:  70 × 10⁹ × 16 B = 1,120 × 10⁹ B = 1,120 GB per GPU under plain DDP
                                              ↑ 14× an 80 GB H100
`)}
<h3>3.2 ZeRO: shard the redundant state</h3>
<p>${term('ZeRO')} (Rajbhandari et al., arXiv 1910.02054) observes that data-parallel replicas hold identical copies of state and shards it across the N data-parallel ranks. Stage 1 shards the optimizer state (the 12 B), stage 2 also the gradients, stage 3 also the parameters. PyTorch FSDP implements the stage-3 idea (and a stage-2-like mode).</p>
${formula(`
Per-GPU training state for Ψ = 70 × 10⁹ parameters (activations NOT included)

                 formula                     N = 8          N = 64
DDP        16Ψ                             1,120 GB       1,120 GB
ZeRO-1     2Ψ + 2Ψ + 12Ψ/N                   385 GB         293 GB
ZeRO-2     2Ψ + (2Ψ + 12Ψ)/N                 262.5 GB       155.3 GB
ZeRO-3     16Ψ / N                           140 GB          17.5 GB

STEP 1  ZeRO-1, N = 8 :  140 + 140 + 840/8   = 140 + 140 + 105   = 385 GB
STEP 2  ZeRO-1, N = 64:  140 + 140 + 840/64  = 280 + 13.125      ≈ 293 GB
STEP 3  ZeRO-2, N = 8 :  140 + 980/8         = 140 + 122.5       = 262.5 GB
STEP 4  ZeRO-2, N = 64:  140 + 980/64        = 140 + 15.3        ≈ 155.3 GB
STEP 5  ZeRO-3, N = 8 :  1,120 / 8                               = 140 GB
STEP 6  ZeRO-3, N = 64:  1,120 / 64                              = 17.5 GB

ANSWER  On 80 GB GPUs only ZeRO-3 on 64 GPUs fits, leaving ≈ 60 GB for activations,
        temporary all-gathered layers and fragmentation. On 8 GPUs nothing fits:
        add TP/PP, CPU/NVMe offload, or more GPUs. Minimum for states alone:
        1,120 / 80 = 14 GPUs, with zero room for activations.
`)}
<p>The cost is communication. ZeRO-1 and ZeRO-2 move about the same bytes as DDP. ZeRO-3/FSDP must all-gather each layer's parameters before using it in forward and again in backward, then reduce-scatter gradients: the ZeRO paper puts this at about 1.5× DDP's volume. With fast interconnect and good overlap that is affordable; over a slow network it dominates step time.</p>

<h3>3.3 Tensor parallelism: splitting the matrices</h3>
<p>${term('Tensor parallelism')} (Megatron-LM, Shoeybi et al., arXiv 1909.08053) splits individual weight matrices. The transformer MLP is Z = GeLU(X·W₁)·W₂ with W₁ of shape h × 4h and W₂ of shape 4h × h. The trick is to split W₁ by <b>columns</b> and W₂ by <b>rows</b>:</p>
${formula(`
TP degree t = 2,  X: [tokens × h],  W₁ = [W₁⁽⁰⁾ | W₁⁽¹⁾]  (column split, each h × 2h)

GPU 0 :  Y⁽⁰⁾ = GeLU(X · W₁⁽⁰⁾)        GPU 1 :  Y⁽¹⁾ = GeLU(X · W₁⁽¹⁾)
                  ↑ GeLU is element-wise, so it can be applied to each half locally

         ┌ W₂⁽⁰⁾ ┐
W₂  =    │───────│   (row split, each 2h × h)
         └ W₂⁽¹⁾ ┘

GPU 0 :  Z⁽⁰⁾ = Y⁽⁰⁾ · W₂⁽⁰⁾            GPU 1 :  Z⁽¹⁾ = Y⁽¹⁾ · W₂⁽¹⁾
                  ↑ partial sums of the same [tokens × h] output

Z = Z⁽⁰⁾ + Z⁽¹⁾       ← ONE all-reduce per MLP block in the forward pass
`)}
<p>Attention is split the same way by heads: each GPU computes a subset of heads (column-parallel Q, K, V projections), then the output projection is row-parallel, followed by one all-reduce. So a transformer layer needs <b>two all-reduces in forward and two in backward</b>, each the size of the layer's activations. That is why TP lives inside an NVLink/NVSwitch domain.</p>
${anim('v2-par-tp-matmul')}
${formula(`
TP traffic for one 70B-shaped forward pass (h = 8,192, 80 layers, one 4,096-token sequence)

STEP 1  one all-reduce payload = tokens × h × 2 B = 4,096 × 8,192 × 2 = 67,108,864 B = 64 MiB
STEP 2  per GPU, ring all-reduce sends 2(t − 1)/t × payload; t = 8 → 1.75 × 64 MiB = 112 MiB
STEP 3  all-reduces per forward = 2 per layer × 80 layers = 160
        bytes sent per GPU = 160 × 112 MiB = 17,920 MiB = 17.5 GiB ≈ 18.8 GB
STEP 4  time if purely bandwidth-bound
        NVLink, assume ≈ 450 GB/s per direction (H100 is quoted at 900 GB/s total) → ≈ 42 ms
        400 Gb/s network = 50 GB/s                                                  → ≈ 376 ms

ANSWER  The same TP degree is ~9× slower across nodes. Keep TP ≤ GPUs per NVLink domain
        (8 on an HGX H100 node); use PP or DP across nodes.
`)}

<h3>3.4 Pipeline parallelism and the bubble</h3>
<p>${term('Pipeline parallelism')} assigns contiguous groups of layers to p stages on different GPUs. Only the activations at stage boundaries move (point-to-point), so it tolerates slower links. The problem is idle time: stage 3 cannot start until stages 0–2 have produced its input. Splitting the batch into m micro-batches keeps stages busy, but each step still has a fill and drain phase, the ${term('Pipeline bubble','pipeline bubble')} (GPipe schedule, Huang et al., arXiv 1811.06965):</p>
${formula(`
                       p − 1
bubble fraction  =  ───────────        p = pipeline stages, m = micro-batches per step
                     m + p − 1

STEP 1  p = 4, m = 4   →  3 / 7   = 42.9 % of GPU time idle
STEP 2  p = 4, m = 8   →  3 / 11  = 27.3 %
STEP 3  p = 4, m = 32  →  3 / 35  =  8.6 %
STEP 4  p = 8, m = 32  →  7 / 39  = 17.9 %     ← deeper pipeline needs more micro-batches

Rule of thumb: m ≥ 4p keeps the bubble under ≈ 20 %. More micro-batches means more
activation memory in flight (1F1B schedules cap it); interleaved schedules that give each
GPU several smaller stages shrink the bubble further at the cost of more communication.
`)}
${anim('v2-par-pipeline-bubbles')}

<h3>3.5 Mixture-of-Experts and expert parallelism</h3>
<p>A ${term('Mixture-of-Experts')} (MoE) layer replaces one feed-forward block with E expert feed-forward blocks and a small <b>router</b>. For each token the router scores all experts and sends the token to the <b>top-k</b> (often k = 1 or 2); the outputs are combined weighted by the router scores. Total parameters grow with E, but compute per token grows only with k. Mixtral 8x7B, for example, has 8 experts with top-2 routing (about 47B total, about 13B active per token); DeepSeek-V3 has 671B total and 37B active.</p>
<p>${term('Expert parallelism')} places different experts on different GPUs. Each MoE layer then needs two ${term('All-to-all','all-to-all')} collectives: <b>dispatch</b> (each GPU sends each token to the GPUs holding its chosen experts) and <b>combine</b> (results come back).</p>
${formula(`
One MoE layer, one micro-batch (illustrative shape)
tokens T = 4,096   experts E = 8   top-k = 2   hidden h = 4,096   BF16

STEP 1  token→expert assignments = T × k = 8,192; balanced average = 8,192 / 8 = 1,024 per expert
STEP 2  capacity with capacity factor 1.25 = 1,024 × 1.25 = 1,280 slots per expert
STEP 3  router sends 1,600 tokens to expert 2 → 1,600 − 1,280 = 320 overflow
        (dropped and passed through the residual, or re-routed — implementation-dependent)
STEP 4  all-to-all dispatch bytes = 8,192 × 4,096 × 2 B = 67,108,864 B = 64 MiB
        combine sends the same back → 128 MiB per MoE layer per micro-batch (upper bound:
        assignments whose expert is on the same GPU do not cross the network)

ANSWER  MoE saves FLOPs, not memory: all E experts' weights must be resident somewhere.
        It adds all-to-all traffic and load imbalance, which training counters with an
        auxiliary load-balancing loss (or bias-based balancing) that rewards even routing.
`)}
${anim('v2-par-moe-routing')}
<p>The slowest (most loaded) expert sets the layer's latency, exactly like a hot partition in Kafka sets consumer lag. In serving, popular experts can be replicated; in training, the balancing loss shapes the router itself.</p>

<h3>3.6 Context and sequence parallelism</h3>
<p>Long contexts break a different budget: activations and KV grow with sequence length. One million tokens of KV on the Llama-3.1-70B shape is 1,000,000 × 320 KiB ≈ 305 GiB (${L('v1-kv-cache','KV cache lesson')}), far beyond one GPU. ${term('Context parallelism')} splits the sequence across GPUs: each holds a block of queries, and key/value blocks are passed around a ring so each query block eventually attends to every key block (ring attention), overlapping the transfer with computation. Megatron's narrower <b>sequence parallelism</b> splits the LayerNorm and dropout activations along the sequence inside a TP group, cutting activation memory without extra communication volume compared with TP alone.</p>

<h3>3.7 Putting the axes together</h3>
<p>A typical large training layout, inside-out: TP inside the node (fast NVLink), PP across a few nodes, DP (with ZeRO-1/FSDP) across the rest, EP for MoE layers, CP only when sequences are very long. Total GPUs = TP × PP × DP (× CP). For example TP 8 × PP 4 × DP 16 = 512 GPUs.</p>

<h2>4. Where does it fit?</h2>
${fig('Mapping parallelism axes onto hardware', svgDiagram({w:900,h:340,
 zones:[{x:10,y:30,w:420,h:280,label:'Node A (8 GPUs, NVSwitch)'},{x:470,y:30,w:420,h:280,label:'Node B (8 GPUs, NVSwitch)'}],
 boxes:[
  {id:'a',x:30,y:70,w:380,h:60,label:'TP group: layers 1–40',sub:'2 all-reduces per layer over NVLink',cls:'hl'},
  {id:'b',x:490,y:70,w:380,h:60,label:'TP group: layers 41–80',sub:'2 all-reduces per layer over NVLink',cls:'hl'},
  {id:'c',x:30,y:200,w:380,h:60,label:'DP replica 0, PP stage 0',sub:'gradients reduce-scattered with other replicas'},
  {id:'d',x:490,y:200,w:380,h:60,label:'DP replica 0, PP stage 1',sub:'activations from stage 0'}
 ],
 arrows:[{from:'a',to:'b',label:'PP: activations (point-to-point, network)'},{from:'a',to:'c',cls:'dash'},{from:'b',to:'d',cls:'dash'}],
 notes:[{x:450,y:330,text:'Data-parallel gradient traffic crosses the network once per step; TP traffic never should.',anchor:'middle'}]
}), 'Place the chattiest axis (TP) on the fastest links, the least chatty (PP point-to-point, DP once per step) across nodes.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Interconnect and collectives:</b> every axis is a communication pattern implemented by NCCL over NVLink, InfiniBand, RoCE or EFA (${L('v2-distributed-training','distributed training')}, ${L('v1-multi-gpu-profiling','multi-GPU profiling')}).</li>
<li><b>Serving:</b> the same TP and PP flags appear in vLLM and SGLang; disaggregated serving adds KV transfer (${L('v2-distributed-inference','distributed inference')}).</li>
<li><b>Scheduling:</b> TP groups must land on one node, PP/DP groups on topologically close nodes, all at once (gang scheduling with Kueue, ${L('v1-k8s-gpu-stack','GPU stack')}).</li>
<li><b>Capacity and cost:</b> parallel layout sets GPU count per replica and therefore cost per token (${L('v2-capacity-planning','capacity planning')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Decision','Your input'],[
 ['Node shape','8-GPU NVSwitch nodes (HGX) versus PCIe nodes: PCIe nodes cannot host efficient TP 8.'],
 ['Fabric','InfiniBand/RoCE/EFA bandwidth per GPU, rail alignment, GPUDirect RDMA enabled and verified.'],
 ['Placement','topology-aware scheduling so a PP/DP group shares a leaf switch or block (Kueue Topology Aware Scheduling).'],
 ['Defaults for teams','blessed layouts per model size (e.g. TP 8 inside a node, FSDP across nodes) and the memory maths that justifies them.'],
 ['Observability','per-rank step time, collective time, GPU utilization versus SM activity, network counters.']
])}
${callout('devops','DevOps bridge','A TP group behaves like a single process spread over 8 GPUs: if one GPU dies, the whole group dies. DP replicas are closer to a StatefulSet that must stay in lock-step. Where the analogy breaks: Kubernetes has no notion of "these 64 pods are one program", so you add gang admission and topology placement on top.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Adding a second node makes training slower','TP spanning nodes, or DP all-reduce over a slow/misconfigured network','collective time per step; NCCL logs show socket transport instead of RDMA','keep TP in-node; enable RDMA/GPUDirect; check NIC affinity'],
 ['GPU utilization ~50 % with PP','bubble from too few micro-batches','profiler timeline shows idle at step start and end','raise m (≥ 4p), interleaved schedule'],
 ['OOM only on the last pipeline stage','stage imbalance (embedding/loss layers on one stage)','per-rank memory','rebalance layers per stage'],
 ['MoE step time spiky; one GPU always busiest','expert load imbalance','per-expert token counts','balancing loss, capacity factor, expert replication'],
 ['OOM with FSDP/ZeRO-3 despite maths saying it fits','activations, all-gathered layer buffers, fragmentation','memory snapshot by category','activation checkpointing, smaller micro-batch, more GPUs']
])}
<div class="dtree"><ul><li><span class="q">More GPUs, not faster. Why?</span><ul>
<li><span class="a">check</span>Collective time grew with the new GPUs → network-bound: wrong placement, TP across nodes, RDMA off.</li>
<li><span class="a">check</span>Idle gaps at step boundaries → pipeline bubble or data-loader stalls.</li>
<li><span class="a">check</span>One rank consistently slow → straggler (thermal, bad NIC, expert imbalance).</li>
<li><span class="a">check</span>Global batch changed → convergence, not throughput, is the issue.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<p>Scale TP up to the NVLink domain, PP until the bubble is unacceptable for your achievable micro-batch count, and DP for everything beyond. Communication must overlap with compute (gradient bucketing, prefetching the next layer's all-gather). Measure <b>scaling efficiency</b> = throughput(N) ÷ (N × throughput(1)) at each size; when it falls below your threshold, more GPUs are buying mostly communication.</p>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Scaling efficiency decides cost (illustrative measured numbers)

   64 GPUs: 100,000 tokens/s    128 GPUs: 170,000 tokens/s
   efficiency at 128 = 170,000 / (2 × 100,000) = 85 %

   GPU-hours per 10¹² training tokens at $X per GPU-hour:
     64 GPUs : 10¹² / 100,000 = 10⁷ s ≈ 2,778 h × 64  = 177,778 GPU-h
    128 GPUs : 10¹² / 170,000 ≈ 5.88 × 10⁶ s ≈ 1,634 h × 128 = 209,150 GPU-h

ANSWER  128 GPUs finish 41 % sooner but cost ≈ 18 % more. Time-to-result vs cost is
        a business decision; communication efficiency is the exchange rate.
`)}
<p>Other levers: ZeRO-1/2 when ZeRO-3 is not needed (less traffic), activation checkpointing instead of more GPUs, MoE for more quality per FLOP, and buying interconnect where TP/EP traffic is heavy rather than more GPUs.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“You need to fine-tune a 70B model fully. How many GPUs and which parallelism?”','<p><i>Answer (≈50 s):</i> "First the memory maths: mixed-precision Adam is about 16 bytes per parameter, so 1.12 TB of training state before activations. Plain data parallel cannot work. With ZeRO-3 or FSDP across 64 GPUs that is 17.5 GB per GPU, leaving room for activations on 80 GB cards; across 8 GPUs it is 140 GB, which does not fit. I would keep tensor parallel inside a node if I need it to cut activation memory, shard with FSDP across nodes, use activation checkpointing, and verify RDMA so the extra all-gather traffic overlaps with compute. Then I would measure scaling efficiency at 32, 64 and 128 GPUs and pick the size that meets the deadline at acceptable cost. If full fine-tuning is not required, LoRA changes the whole calculation."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"70B × 2 bytes = 140 GB, so two 80 GB GPUs."</p><p>That is inference weights only; it ignores gradients, optimizer state and activations.</p></div><div class="good"><h4>Strong answer</h4><p>States the per-parameter state, applies ZeRO stage maths, maps axes to interconnect, and plans to measure scaling efficiency.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Model size','training state 16 B/param','ZeRO/FSDP shards','communication volume','interconnect','step time'])}
${chain(['TP inside node','PP across nodes','DP everywhere','gang + topology scheduling'])}
<p>Next: ${L('v2-distributed-training','NCCL, fabrics, FSDP and recovery')}, then ${L('v2-distributed-inference','the same axes for serving')}.</p></div>
`,
  quiz:[
    {q:'Pipeline with p = 4 stages and m = 8 micro-batches. Bubble fraction?',options:['3/8 = 37.5 %','3/11 ≈ 27.3 %','4/12 ≈ 33 %','1/8 = 12.5 %'],answer:1,explain:'(p − 1)/(m + p − 1) = 3/11. 3/8 forgets that the fill/drain adds p − 1 slots to the m micro-batch slots.'},
    {q:'Per-GPU training state for a 70B model with ZeRO-3 on 64 GPUs (16 B/param, activations excluded)?',options:['140 GB','17.5 GB','1,120 GB','293 GB'],answer:1,explain:'ZeRO-3 shards all 16 bytes: 1,120 GB / 64 = 17.5 GB. 140 GB is ZeRO-3 on 8 GPUs; 293 GB is ZeRO-1 on 64.'},
    {q:'In a Megatron-style tensor-parallel MLP, why split W₁ by columns and W₂ by rows?',options:['To save disk space','So GeLU can be applied locally and only one all-reduce is needed after W₂','Because rows are faster on GPUs','So each GPU holds the full output'],answer:1,explain:'Column split gives each GPU independent slices of the hidden activation, GeLU is element-wise, and the row-split W₂ produces partial sums combined by one all-reduce.'},
    {q:'An MoE model has 8 experts and top-2 routing. Compared with a dense model with the same total parameters, it…',options:['needs less GPU memory for weights','uses less compute per token but still needs all expert weights resident','needs no communication','always has better quality'],answer:1,explain:'MoE saves FLOPs per token, not weight memory. Expert parallelism adds all-to-all communication.'},
    {q:'Why is tensor parallelism usually limited to one node?',options:['NCCL forbids cross-node TP','It needs two activation all-reduces per layer per pass, so it is very bandwidth-hungry; NVLink is roughly an order of magnitude faster than the network','Kubernetes cannot schedule it','TP only works with 8 GPUs'],answer:1,explain:'In the worked example the same traffic took ~42 ms on NVLink and ~376 ms over 400 Gb/s networking.'}
  ],
  flashcards:[
    {front:'Pipeline bubble fraction',back:'(p − 1)/(m + p − 1). p = 4, m = 4 → 42.9 %; m = 8 → 27.3 %; m = 32 → 8.6 %.'},
    {front:'Mixed-precision Adam bytes per parameter',back:'2 (BF16 weights) + 2 (grads) + 4 (FP32 master) + 4 + 4 (Adam m, v) = 16 B. 70B → 1,120 GB.'},
    {front:'ZeRO stages',back:'1: shard optimizer state; 2: + gradients; 3: + parameters (≈ FSDP full shard). ZeRO-3 costs ≈1.5× DDP communication.'},
    {front:'TP all-reduces per transformer layer',back:'Two in forward (after attention output projection and after MLP W₂) and two in backward.'},
    {front:'MoE all-to-all',back:'Dispatch tokens to their top-k experts’ GPUs and combine results back: two all-to-alls per MoE layer.'},
    {front:'Order of axes on hardware',back:'TP inside NVLink domain, PP across a few nodes, DP (ZeRO/FSDP) across the rest; EP for MoE; CP for very long sequences.'}
  ]
});
registerGlossary([
  {term:'Parallelism',def:'Splitting model work across GPUs along data, tensor, pipeline, expert or context (sequence) dimensions; each trades memory or time for communication.',lesson:'v2-parallelism',aliases:['model parallelism','3D parallelism']},
  {term:'ZeRO',def:'Zero Redundancy Optimizer: shards optimizer state (stage 1), gradients (stage 2) and parameters (stage 3) across data-parallel ranks to cut per-GPU memory.',lesson:'v2-parallelism',aliases:['ZeRO-3','DeepSpeed ZeRO']},
  {term:'Tensor parallelism',def:'Splitting individual weight matrices across GPUs (column then row split in Megatron style), requiring activation all-reduces inside every layer.',lesson:'v2-parallelism',aliases:['TP']},
  {term:'Pipeline parallelism',def:'Placing groups of consecutive layers on different GPUs (stages) and streaming micro-batches through them.',lesson:'v2-parallelism',aliases:['PP']},
  {term:'Pipeline bubble',def:'Idle GPU time during pipeline fill and drain; fraction (p − 1)/(m + p − 1) for p stages and m micro-batches.',lesson:'v2-parallelism'},
  {term:'Mixture-of-Experts',def:'Architecture where a router sends each token to the top-k of many expert feed-forward blocks, so total parameters exceed per-token compute.',lesson:'v2-parallelism',aliases:['MoE']},
  {term:'Expert parallelism',def:'Placing different MoE experts on different GPUs; tokens move to and from experts with all-to-all collectives.',lesson:'v2-parallelism',aliases:['EP']},
  {term:'All-to-all',def:'Collective in which every rank sends a distinct piece of data to every other rank; used for MoE token dispatch and combine.',lesson:'v2-parallelism'},
  {term:'Context parallelism',def:'Splitting the sequence dimension across GPUs, passing key/value blocks around a ring so attention covers the whole sequence; used for very long contexts.',lesson:'v2-parallelism',aliases:['sequence parallelism','ring attention']}
]);

registerLesson({
  id:'v2-distributed-training', vol:2, part:3, num:2,
  title:'Distributed training: NCCL, RDMA, InfiniBand, FSDP, DeepSpeed ZeRO and recovery', minutes:100,
  summary:'Distributed training is a tightly coupled program running on many machines at once. The GPUs exchange gradients and parameters through collective operations implemented by NCCL, over NVLink inside a server and over RDMA networks such as InfiniBand, RoCE or AWS EFA between servers. This lesson works through the cost of a ring all-reduce, compares DDP, FSDP and DeepSpeed ZeRO, shows how to checkpoint a terabyte of training state, and explains how jobs fail and recover on Kubernetes with gang admission.',
  objectives:[
    'Name the NCCL collectives each training strategy uses and compute ring all-reduce traffic 2(N − 1)/N × size.',
    'Compare InfiniBand, RoCE and EFA and explain RDMA and GPUDirect RDMA.',
    'Choose between DDP, FSDP2 and DeepSpeed ZeRO for a model size and network.',
    'Plan sharded checkpoints (DCP) and a checkpoint interval from checkpoint cost and failure rate.',
    'Diagnose hangs, collective timeouts, stragglers and Xid errors, and run training on Kubernetes with Kueue and Kubeflow Trainer.'
  ],
  prereqs:['v2-parallelism','v1-training-loop','v1-multi-gpu-profiling'],
  next:['v2-distributed-inference','v1-k8s-gpu-stack','v2-finops-optimization'],
  tags:['distributed','training','networking','kubernetes'],
  html:`
<h2>1. What is it?</h2>
<p>Distributed training runs one training job as N cooperating processes ("ranks"), usually one per GPU, across many nodes. The ranks synchronise with <b>collective operations</b> — every rank participates, and nobody proceeds until the collective completes. ${term('NCCL')} (NVIDIA Collective Communications Library) implements these collectives on NVIDIA GPUs, choosing algorithms (ring, tree) and transports (NVLink, PCIe, InfiniBand verbs, sockets, or network plugins such as AWS's OFI plugin for EFA). PyTorch's <code>torch.distributed</code> with the <code>nccl</code> backend calls it for you.</p>
${table(['Collective','What it does','Who uses it'],[
 ['all-reduce','every rank ends with the sum (or mean) of all ranks’ tensors','DDP gradients, TP activations'],
 ['reduce-scatter','sum, but each rank keeps only its 1/N slice','FSDP/ZeRO gradients'],
 ['all-gather','every rank ends with the concatenation of all slices','FSDP/ZeRO-3 parameters before each layer'],
 ['broadcast','one rank’s tensor copied to all','initial weights, config'],
 ['all-to-all','each rank sends a distinct piece to every other','MoE expert dispatch/combine'],
 ['send / recv','point-to-point','pipeline stages']
])}

<h2>2. Why do we need it?</h2>
<p>Because one GPU cannot hold or process the job (${L('v2-parallelism','parallelism lesson')}), and the speed of synchronisation sets the speed of the whole job. With synchronous training every step waits for the slowest rank and the slowest link. A 1,000-GPU job with a 10 % communication stall wastes the equivalent of 100 GPUs, all the time.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 Ring all-reduce</h3>
<p>Put N GPUs in a logical ring and cut the tensor into N chunks. In the <b>reduce-scatter</b> phase (N − 1 steps), each GPU sends one chunk to its neighbour and adds the chunk it receives; after N − 1 steps each GPU owns one fully summed chunk. In the <b>all-gather</b> phase (another N − 1 steps) the finished chunks travel around the ring until everyone has all of them.</p>
${anim('v2-dist-ring-allreduce')}
${formula(`
Ring all-reduce traffic per GPU

                     2 (N − 1)
bytes sent per GPU = ────────── × S            S = tensor size,  N = ranks
                         N                       2(N − 1) steps, each sending S / N

STEP 1  gradients of a 7B model in BF16:  S = 7 × 10⁹ × 2 B = 14 GB
STEP 2  N = 8 :  2 × 7 / 8 = 1.75        → 1.75 × 14 GB = 24.5 GB sent per GPU per step
STEP 3  N = 64:  2 × 63 / 64 = 1.97      → 27.6 GB      (approaches 2S as N grows:
                                                         per-GPU bytes barely grow with N)
STEP 4  time if bandwidth-bound, N = 8
        inside one node over NVLink, assume ≈ 450 GB/s per direction → 24.5 / 450 ≈ 54 ms
        across 8 nodes at 400 Gb/s per GPU (= 50 GB/s)               → 24.5 / 50  ≈ 0.49 s

ANSWER  Ring is bandwidth-optimal, but it has 2(N − 1) sequential steps, so latency grows
        with N; NCCL switches to tree algorithms when latency dominates (small messages,
        many ranks). Gradient bucketing lets the all-reduce of finished layers overlap with
        the backward pass of earlier layers.
`)}
<p>Note the p5.48xlarge numbers from AWS: 8 × H100 with 3,200 Gbps of EFA per instance, i.e. 400 Gb/s per GPU. That is the "50 GB/s per GPU" in the example.</p>

<h3>3.2 RDMA and the fabrics</h3>
<p>${term('RDMA')} (remote direct memory access) lets a NIC write into another machine's memory without involving either CPU or kernel on the data path. <b>GPUDirect RDMA</b> lets the NIC read and write <i>GPU</i> memory directly, skipping the copy through host RAM. Without it, inter-node collectives bounce through the CPU and run several times slower.</p>
${table(['Fabric','How it delivers RDMA','Operational notes'],[
 ['InfiniBand','dedicated lossless fabric with credit-based flow control and a subnet manager','the reference for large training clusters; separate network to operate'],
 ['RoCE v2','RDMA over Converged Ethernet: RDMA over UDP/IP on Ethernet','needs lossless tuning (PFC, ECN/congestion control); misconfiguration shows up as tail-latency spikes and pauses'],
 ['AWS EFA','Elastic Fabric Adapter; uses AWS’s SRD transport, accessed through libfabric; NCCL uses the aws-ofi-nccl plugin','EFA interfaces must be requested in the instance/pod spec; GPUDirect RDMA supported on p5 class'],
 ['Sockets (TCP)','no RDMA; NCCL fallback','works everywhere, slow; a silent fallback is a classic performance bug']
])}
<p><b>Topology</b> matters as much as fabric. Inside a node, NVLink/NVSwitch connects all 8 GPUs; between nodes, "rail-optimised" designs connect GPU k of every node to the same leaf switch, so collectives between same-index GPUs take one hop. <code>nvidia-smi topo -m</code> shows GPU–NIC affinity; each GPU should use the NIC on its own PCIe switch.</p>
${callout('unverified','Verify before relying on this','NCCL environment variables (for example <code>NCCL_DEBUG=INFO</code> to log chosen transports, <code>NCCL_SOCKET_IFNAME</code>, InfiniBand HCA selection) and their defaults change between NCCL releases. Confirm against the NCCL documentation for the version bundled with your PyTorch build. The research for this course did not verify NCCL flag defaults.')}

<h3>3.3 DDP, FSDP2 and DeepSpeed ZeRO</h3>
${table(['','DDP','FSDP (PyTorch)','DeepSpeed ZeRO'],[
 ['Model state per GPU','full copy','sharded parameters, gradients and optimizer state','stage 1: optimizer; 2: + gradients; 3: + parameters'],
 ['Collectives','all-reduce of gradients (bucketed, overlapped with backward)','all-gather params per layer (forward and backward), reduce-scatter grads','same patterns as FSDP for stage 3'],
 ['Traffic vs DDP','1×','≈ 1.5× for full sharding','stage 1–2 ≈ 1×, stage 3 ≈ 1.5×'],
 ['Extras','simplest, fastest when it fits','FSDP2 (<code>fully_shard</code>) shards per parameter using DTensor and composes with TP; a no-reshard-after-forward mode behaves like ZeRO-2','CPU/NVMe offload (ZeRO-Offload, ZeRO-Infinity), config-driven'],
 ['Pick when','model + optimizer state fit on each GPU','PyTorch-native stack, large models, composing with TP','existing DeepSpeed pipelines or heavy offload needs']
])}
<p>The old interview answer — "DDP keeps a full copy and syncs gradients; FSDP shards to save memory at the cost of communication" — is right. Strengthen it with the mapping (FSDP full shard ≈ ZeRO-3), the traffic factor (≈ 1.5×), and the 16-bytes-per-parameter arithmetic from the previous lesson.</p>
${code('python',`# FSDP2 sketch (PyTorch 2.x API names; verify against your pinned version)
import torch.distributed as dist
from torch.distributed.fsdp import fully_shard

dist.init_process_group("nccl")          # torchrun sets RANK, WORLD_SIZE, MASTER_ADDR
model = build_model()
for block in model.layers:               # shard each transformer block separately
    fully_shard(block)                   #   -> all-gather just-in-time, free after use
fully_shard(model)                       # root wrap for the remaining parameters
opt = torch.optim.AdamW(model.parameters(), lr=1e-4)`)}

<h3>3.4 Checkpointing at scale</h3>
<p>A 70B full-training checkpoint with optimizer state is about 1,120 GB (16 B × 70 × 10⁹). Gathering it to rank 0 and writing one file would take forever and need a terabyte of host RAM. PyTorch ${term('Distributed Checkpoint')} (DCP, <code>torch.distributed.checkpoint</code>) has every rank write its own shards in parallel plus metadata, and can <b>reshard on load</b> — resume on a different number of GPUs. Asynchronous save copies state to host memory and writes in the background so training continues.</p>
${formula(`
Checkpoint interval (Young's approximation)

          ┌─────────────────────┐
   τ  ≈  √ 2 × C × MTBF            C = time to write a checkpoint, MTBF = job's mean time between failures

STEP 1  C: 1,120 GB at an aggregate 10 GB/s to storage → 112 s   (illustrative storage rate)
STEP 2  MTBF of a large job: assume 8 h = 28,800 s               (measure yours: failures scale with GPU count)
STEP 3  τ ≈ √(2 × 112 × 28,800) = √6,451,200 ≈ 2,540 s ≈ 42 min
STEP 4  expected lost work per failure ≈ τ / 2 + restart time ≈ 21 min + restart

ANSWER  Checkpoint about every 40 minutes; if async save hides most of C, checkpoint
        more often. A doubling of GPU count roughly halves MTBF, so τ shrinks by √2.
`)}
<p>The old book's advice ("choose the interval from checkpoint cost, failure probability and lost-work tolerance") was correct; Young's formula makes it a number. Always save model, optimizer, LR scheduler, RNG states and data-loader position, or the resumed run is not the same run.</p>

<h3>3.5 Failure and recovery</h3>
<p><b>torchrun (torch elastic)</b> launches the ranks, runs a rendezvous (c10d backend) so they find each other, and on a worker failure tears down and restarts <i>all</i> workers, up to <code>--max-restarts</code>; with <code>--nnodes=MIN:MAX</code> it can continue with fewer nodes. Your training script must then resume from the last checkpoint — elasticity is restart-from-checkpoint, not hot replacement of a rank.</p>
<p><b>Collective hangs.</b> If one rank dies or stalls inside a collective, the others wait. PyTorch's NCCL watchdog aborts the process group after a timeout (configurable via <code>timeout=</code> in <code>init_process_group</code>). Raising the timeout hides problems; finding the stuck rank fixes them.</p>
<p><b>Stragglers.</b> A rank that is consistently 10 % slower makes every step 10 % slower. Causes: thermal or power throttling, a degraded NVLink or NIC, a noisy neighbour on shared storage, data-loader stalls, or expert imbalance. Detect with per-rank step-time histograms and collective wait time.</p>
<p><b>Hardware errors.</b> NVIDIA ${term('Xid')} errors appear in the kernel log and as the DCGM gauge <code>DCGM_FI_DEV_XID_ERRORS</code> (value of the <i>last</i> Xid, not a counter). NVIDIA's catalog classifies them:</p>
${table(['Xid','Meaning','Action bucket (NVIDIA catalog)'],[
 ['13, 31','graphics engine exception / GPU memory page fault — usually an application bug','restart the application'],
 ['48','double-bit ECC error','GPU reset or node reboot needed'],
 ['74','NVLink error','follow NVLink workflow; contact support'],
 ['79','GPU has fallen off the bus','restart bare metal; drain the node'],
 ['94 / 95','contained / uncontained memory error (A100 and later)','94: restart app; 95: reset GPU']
])}
${callout('unverified','Timeout defaults','The default NCCL process-group timeout and the names of async-error-handling environment variables have changed across PyTorch releases. Set the timeout explicitly in code and check the documentation for your version.')}

<h3>3.6 Training on Kubernetes</h3>
<p>Kubernetes schedules pods one at a time. A 64-pod training job that gets 60 pods placed will hold 480 GPUs idle while waiting for 4 more — or deadlock with another half-placed job. Two pieces fix this:</p>
<ul>
<li><b>Kueue</b> (v0.20.x, API <code>kueue.x-k8s.io/v1beta2</code>, as of Oct 2026) queues jobs and <b>admits a whole Workload at once</b> when quota for all of it is available (${term('Gang admission','gang admission')}). ClusterQueues hold quota per ResourceFlavor (e.g. H100 on-demand vs spot), LocalQueues give teams a namespaced entry point, Cohorts let queues borrow idle quota, and Topology Aware Scheduling (beta, enabled by default since v0.14) packs a job into a rack or block.</li>
<li><b>Kubeflow Trainer</b> (v2.3.0) provides the <code>TrainJob</code> API (<code>trainer.kubeflow.org/v1alpha1</code>) with reusable TrainingRuntime/ClusterTrainingRuntime templates; it builds on JobSet and integrates with Kueue. The project states it is in alpha. The legacy Training Operator v1 (PyTorchJob) still receives patches.</li>
</ul>
${code('yaml',`# Sketch: a TrainJob submitted to a Kueue LocalQueue (verify field names for your Trainer version)
apiVersion: trainer.kubeflow.org/v1alpha1
kind: TrainJob
metadata:
  name: atlas-sft-70b
  namespace: ml-team
  labels:
    kueue.x-k8s.io/queue-name: h100-queue    # Kueue admits all nodes together or none
spec:
  runtimeRef:
    name: torch-distributed                  # ClusterTrainingRuntime (torchrun launcher)
  trainer:
    image: registry.example.com/atlas/train@sha256:0000
    numNodes: 8
    resourcesPerNode:
      limits:
        nvidia.com/gpu: 8`)}
${callout('unverified','Alpha API','Kubeflow Trainer’s TrainJob is v1alpha1 and its README says APIs may change. Treat the YAML above as a shape, and copy field names from the version you install.')}

<h2>4. Where does it fit?</h2>
${fig('A training job on Kubernetes: control plane, data plane, storage', svgDiagram({w:900,h:350,
 zones:[{x:10,y:10,w:280,h:330,label:'Control'},{x:310,y:10,w:400,h:330,label:'GPU nodes (gang of 8)'},{x:730,y:10,w:160,h:330,label:'Storage'}],
 boxes:[
  {id:'tj',x:30,y:50,w:240,h:50,label:'TrainJob',sub:'Kubeflow Trainer'},
  {id:'kq',x:30,y:130,w:240,h:50,label:'Kueue',sub:'quota, gang admit, TAS',cls:'hl'},
  {id:'js',x:30,y:210,w:240,h:50,label:'JobSet + pods',sub:'torchrun per node'},
  {id:'n1',x:330,y:50,w:170,h:60,label:'Node 1',sub:'8 GPU NVSwitch'},
  {id:'n2',x:520,y:50,w:170,h:60,label:'Node 2',sub:'8 GPU NVSwitch'},
  {id:'fab',x:330,y:170,w:360,h:50,label:'RDMA fabric',sub:'IB / RoCE / EFA, GPUDirect',cls:'hl'},
  {id:'dc',x:330,y:260,w:360,h:50,label:'DCGM + per-rank metrics',sub:'Xid, step time, NCCL wait'},
  {id:'data',x:745,y:50,w:130,h:60,label:'Dataset',sub:'versioned'},
  {id:'ck',x:745,y:170,w:130,h:60,label:'Checkpoints',sub:'DCP shards'}
 ],
 arrows:[{from:'tj',to:'kq'},{from:'kq',to:'js'},{from:'js',to:'n1',fromSide:'right',toSide:'left'},{from:'n1',to:'fab',fromSide:'bottom',toSide:'top'},{from:'n2',to:'fab',fromSide:'bottom',toSide:'top'},{from:'data',to:'n2'},{from:'fab',to:'ck',label:'shards'},{from:'fab',to:'dc',cls:'dash'}]
}), 'Kueue decides when the whole gang starts; the fabric decides how fast it runs; checkpoints decide how much a failure costs.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Data pipelines</b> feed versioned datasets; data-loader throughput can be the real bottleneck (${L('v1-data-pipelines','data pipelines')}).</li>
<li><b>MLOps</b> records the run, config and checkpoint lineage in the tracker and registry (${L('v2-mlops-foundations','MLOps foundations')}).</li>
<li><b>GPU stack</b>: drivers, device plugin or DRA, DCGM exporter (${L('v1-k8s-gpu-stack','GPU stack')}).</li>
<li><b>FinOps</b>: capacity blocks, spot versus reserved, and checkpoint frequency all trade money for risk (${L('v2-finops-optimization','FinOps optimization')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${checklist([
 {key:'dt-fabric',text:'RDMA verified per node: NCCL logs show the RDMA/EFA transport, not sockets; GPU–NIC affinity correct.'},
 {key:'dt-burnin',text:'Node burn-in: DCGM diagnostics and an NCCL bandwidth test before nodes join the pool; quarantine on Xid 48/74/79/95.'},
 {key:'dt-queue',text:'Kueue ClusterQueues per GPU flavor, team LocalQueues, priorities and preemption policy.'},
 {key:'dt-ckpt',text:'Checkpoint storage throughput sized for sharded parallel writes; lifecycle policy for old checkpoints.'},
 {key:'dt-obs',text:'Per-rank step time, collective time, data-loader wait, Xid and ECC alerts.'},
 {key:'dt-cap',text:'Capacity plan: AWS Capacity Blocks (1–14 days or multiples of 7 up to 182, up to 64 instances per block) or GKE DWS flex-start with queued provisioning for all-at-once nodes.'}
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Job hangs at start','rendezvous cannot complete: a pod is pending, DNS/port blocked','pending pods; torchrun rendezvous logs','gang admission; network policy for the rendezvous port'],
 ['Hangs mid-training, then NCCL timeout','one rank crashed, OOMed or deadlocked in a different collective order','which rank is missing in logs; per-rank last op; Xid on that node','fix the rank; restart from checkpoint; do not just raise the timeout'],
 ['Throughput 3–5× below expectation multi-node','NCCL fell back to sockets; GPUDirect RDMA off','NCCL INFO logs show socket transport','enable EFA/IB in pod spec, plugin, devices'],
 ['Every step slower than the last benchmark','straggler rank','per-rank step time histogram','drain the slow node, check clocks/thermals/NIC'],
 ['Resumed run diverges','incomplete checkpoint (no optimizer/RNG/data position)','loss curve jump after resume','checkpoint full state with DCP'],
 ['Node lost: Xid 79 or 48','hardware fault','kernel log, DCGM Xid gauge','cordon and drain node, replace, restart job from checkpoint']
])}
<div class="dtree"><ul><li><span class="q">The job is stuck. What now?</span><ul>
<li><span class="a">check</span>All pods Running? No → admission/scheduling (Kueue, quota, topology).</li>
<li><span class="a">check</span>All ranks logging? One silent → that node: Xid, OOM, kernel log.</li>
<li><span class="a">check</span>All alive but no progress → collective mismatch or network: NCCL debug logs, fabric counters.</li>
<li><span class="a">check</span>Progress but slow → straggler or socket fallback.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<p>Scale with topology: keep TP in-node, rail-aligned DP, Kueue TAS to pack jobs into blocks. Overlap communication with compute (bucketing, prefetch). Use hierarchical collectives (reduce within the node over NVLink first, then across nodes). As the GPU count grows, MTBF falls, so invest in fast async checkpoints, automatic node health checks and automated restart — at large scale, failure handling is the scaling problem.</p>

<h2>9. How do we optimize its cost?</h2>
<ul>
<li><b>Idle GPUs during gang waits</b> are pure waste: admit whole jobs, not partial ones.</li>
<li><b>Spot/preemptible capacity</b> only with frequent, fast checkpoints and elastic restart; the expected lost work per interruption is about τ/2 plus restart time.</li>
<li><b>Network spend versus GPU spend:</b> a better fabric that raises scaling efficiency from 70 % to 90 % is worth ≈ 29 % more GPUs (0.9/0.7 = 1.29).</li>
<li><b>Right-size ZeRO stage:</b> ZeRO-3 when memory demands it; ZeRO-1/2 otherwise to save traffic.</li>
</ul>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“A 64-GPU training job is 40 % slower after moving to a new cluster. How do you investigate?”','<p><i>Answer (≈50 s):</i> "I would separate compute from communication. First, single-node throughput against the old cluster: if that matches, it is the fabric. Then NCCL debug logs to confirm it uses RDMA — EFA or InfiniBand with GPUDirect — and not a socket fallback, plus an NCCL all-reduce bandwidth test between nodes and a check of GPU-to-NIC affinity. Then per-rank step times to find stragglers, and DCGM for throttling or Xid errors. Finally I would check placement: if the scheduler spread the job across racks, Kueue topology-aware scheduling should pack it. The arithmetic helps: a ring all-reduce sends about two times the gradient size per GPU per step, so I can predict the expected communication time and see how far off we are."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Increase the NCCL timeout and add more GPUs."</p><p>Hides the fault and buys more communication.</p></div><div class="good"><h4>Strong answer</h4><p>Splits compute vs communication, verifies transport and topology, finds stragglers, uses expected-bytes arithmetic.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Gradients','reduce-scatter / all-gather','NCCL','RDMA fabric','step time','cost per run'])}
${chain(['Failure rate','checkpoint interval','DCP shards','torchrun restart','lost work'])}
<p>Next: ${L('v2-distributed-inference','distributed inference')} reuses TP/PP and moves KV caches over the same fabrics.</p></div>
`,
  quiz:[
    {q:'Ring all-reduce of 14 GB across 8 GPUs. Bytes sent per GPU?',options:['14 GB','1.75 GB','24.5 GB','112 GB'],answer:2,explain:'2(N − 1)/N × S = 1.75 × 14 = 24.5 GB. 1.75 GB confuses the factor with a fraction of S; 112 GB would be naïve send-to-everyone.'},
    {q:'Which collective does FSDP use before running a sharded layer’s forward pass?',options:['all-reduce','all-gather','broadcast','all-to-all'],answer:1,explain:'Each rank holds a shard; all-gather reassembles the full parameters just in time. Gradients are then reduce-scattered.'},
    {q:'Multi-node training is 4× slower than expected and NCCL logs show the socket transport. Most likely fix?',options:['Raise the NCCL timeout','Enable RDMA (EFA/InfiniBand devices, plugin, GPUDirect) for the pods','Use more data-loader workers','Switch to ZeRO-1'],answer:1,explain:'Socket fallback means no RDMA. Timeouts do not change bandwidth; ZeRO stage changes volume, not transport.'},
    {q:'Checkpoint takes 112 s and job MTBF is 8 h. Young’s formula suggests checkpointing about every…',options:['5 minutes','42 minutes','8 hours','2 minutes'],answer:1,explain:'√(2 × 112 × 28,800) ≈ 2,540 s ≈ 42 min.'},
    {q:'Why use Kueue for a 64-pod training job?',options:['It makes NCCL faster','It admits the whole workload only when quota for all pods is available, avoiding half-placed jobs holding GPUs idle','It replaces torchrun','It provides RDMA'],answer:1,explain:'Gang admission plus quotas and topology-aware placement. It does not change communication speed directly.'},
    {q:'DCGM_FI_DEV_XID_ERRORS reads 79 on one node. What do you do?',options:['Ignore it, it is a counter of retries','Cordon/drain the node: the GPU fell off the bus; restart the job from checkpoint elsewhere','Restart only the Python process','Raise the NCCL timeout'],answer:1,explain:'Xid 79 means the GPU has fallen off the bus; NVIDIA’s action bucket is a bare-metal restart. The gauge holds the last Xid value.'}
  ],
  flashcards:[
    {front:'Ring all-reduce cost',back:'2(N − 1) steps, each S/N; per GPU sends 2(N − 1)/N × S ≈ 2S. Bandwidth-optimal; latency grows with N (trees help).'},
    {front:'FSDP vs ZeRO',back:'FSDP full shard ≈ ZeRO-3 (params, grads, optimizer sharded; all-gather + reduce-scatter; ≈1.5× DDP traffic).'},
    {front:'InfiniBand vs RoCE vs EFA',back:'IB: dedicated lossless fabric. RoCE v2: RDMA over UDP/IP Ethernet, needs PFC/ECN tuning. EFA: AWS adapter using SRD via libfabric and the aws-ofi-nccl plugin.'},
    {front:'Young’s checkpoint interval',back:'τ ≈ √(2 × C × MTBF). C = 112 s, MTBF = 8 h → ≈ 42 min.'},
    {front:'DCP',back:'torch.distributed.checkpoint: each rank writes its shards in parallel; can reshard on load to a different world size; async save.'},
    {front:'torchrun elastic on failure',back:'Tears down and restarts all workers (up to --max-restarts), re-runs rendezvous; the script must resume from the last checkpoint.'},
    {front:'Kueue gang admission',back:'A Workload is admitted only when quota for all its pods is available; ClusterQueue/LocalQueue/ResourceFlavor/Cohort; TAS packs by topology.'}
  ]
});
registerGlossary([
  {term:'NCCL',def:'NVIDIA Collective Communications Library: implements all-reduce, all-gather, reduce-scatter, broadcast, all-to-all and point-to-point over NVLink, PCIe and RDMA networks.',lesson:'v2-distributed-training'},
  {term:'RDMA',def:'Remote direct memory access: a NIC reads/writes remote memory without CPU involvement on the data path; GPUDirect RDMA extends this to GPU memory.',lesson:'v2-distributed-training',aliases:['GPUDirect RDMA']},
  {term:'Ring all-reduce',def:'All-reduce in which ranks form a ring: N − 1 reduce-scatter steps then N − 1 all-gather steps; each rank sends 2(N − 1)/N of the tensor.',lesson:'v2-distributed-training'},
  {term:'FSDP',def:'PyTorch Fully Sharded Data Parallel: shards parameters, gradients and optimizer state across data-parallel ranks (ZeRO-3 style); FSDP2 exposes fully_shard.',lesson:'v2-distributed-training',aliases:['FSDP2','fully sharded data parallel']},
  {term:'Distributed Checkpoint',def:'PyTorch DCP (torch.distributed.checkpoint): parallel sharded save/load with resharding to a different world size and optional async save.',lesson:'v2-distributed-training',aliases:['DCP']},
  {term:'Gang admission',def:'Admitting or scheduling all pods of a distributed job together or not at all, so partial placements do not hold GPUs idle (Kueue Workloads).',lesson:'v2-distributed-training',aliases:['gang scheduling']},
  {term:'Xid',def:'NVIDIA driver error code logged by the kernel and exported by DCGM (last value); NVIDIA’s catalog maps each code to an action such as restart app, reset GPU or drain node.',lesson:'v2-distributed-training'},
  {term:'Straggler',def:'A rank that is consistently slower than the others; in synchronous training it sets the step time for the whole job.',lesson:'v2-distributed-training'}
]);

registerLesson({
  id:'v2-distributed-inference', vol:2, part:3, num:3,
  title:'Distributed inference: disaggregated prefill/decode, distributed loading and GPU fleet scheduling', minutes:90,
  summary:'Serving large models also spreads work across GPUs, but the goals differ from training: latency targets per request, steady token streaming, and fast scaling. This lesson covers tensor and pipeline parallelism for serving, then disaggregated serving, where one pool of GPUs processes prompts and another generates tokens, with the key-value cache shipped between them over fast networks. It works out when that transfer pays off, how to load hundreds of gigabytes of weights quickly, and how to schedule a mixed GPU fleet.',
  objectives:[
    'Choose TP and PP degrees for serving from weight size, KV capacity and interconnect.',
    'Explain disaggregated prefill/decode and calculate KV transfer time from bytes per token, prompt length and link bandwidth.',
    'Describe how vLLM, SGLang, NVIDIA Dynamo and llm-d implement disaggregation and KV-aware routing.',
    'Plan distributed model loading to cut cold-start time.',
    'Schedule a GPU fleet shared by inference and training without fragmentation.'
  ],
  prereqs:['v2-parallelism','v1-kv-cache','v1-engines'],
  next:['v2-distributed-kv','v2-hyperscale-serving','v2-capacity-planning'],
  tags:['inference','distributed','kv-cache','scheduling'],
  html:`
<h2>1. What is it?</h2>
<p>Distributed inference is serving one model with more than one GPU per replica (tensor or pipeline parallel), splitting the two phases of generation onto different GPU pools (${term('Disaggregated serving','disaggregated prefill/decode')}), and operating the fleet that hosts all of this: loading weights, routing requests to the replica that already holds the right KV cache, and placing multi-GPU replicas on hardware.</p>

<h2>2. Why do we need it?</h2>
<ul>
<li><b>Fit:</b> a 70B model in BF16 is ≈ 141 GB of weights — two 80 GB GPUs at minimum, and then there is almost no KV room left.</li>
<li><b>Latency:</b> TP divides each token's work across GPUs and cuts time per output token.</li>
<li><b>Interference:</b> prefill (compute-bound, bursty) and decode (memory-bandwidth-bound, steady) fight on the same GPU. A long prompt arriving stalls every streaming user on that replica (${L('v1-batching','chunked prefill')} reduces but does not remove this).</li>
</ul>

<h2>3. How does it work internally?</h2>
<h3>3.1 TP and PP for serving</h3>
<p>vLLM exposes <code>--tensor-parallel-size</code> (<code>-tp</code>), <code>--pipeline-parallel-size</code> (<code>-pp</code>) and <code>--data-parallel-size</code> (<code>-dp</code>), all defaulting to 1; SGLang uses <code>--tp-size</code> and <code>--dp-size</code>. With TP the KV cache is sharded along with the attention heads, so more TP means more total KV room as well as faster decode.</p>
${formula(`
Llama-3.1-70B shape on H100 80 GB, BF16, vLLM --gpu-memory-utilization 0.92 (default)
weights ≈ 141 GB; KV = 320 KiB per token = 327,680 B; activations ignored (illustrative)

STEP 1  TP = 2 : usable 2 × 80 × 0.92 = 147.2 GB  →  KV ≈ 147.2 − 141 = 6.2 GB
                 6.2 × 10⁹ / 327,680 ≈ 18,900 tokens   ≈ 2 sequences of 8k   ✗ useless
STEP 2  TP = 4 : usable 4 × 80 × 0.92 = 294.4 GB  →  KV ≈ 153.4 GB
                 153.4 × 10⁹ / 327,680 ≈ 468,000 tokens ≈ 57 sequences of 8k
STEP 3  TP = 8 : usable 588.8 GB → KV ≈ 447.8 GB ≈ 1.37 M tokens ≈ 166 sequences of 8k
                 8 KV heads / TP 8 = 1 KV head per GPU; TP above 8 would replicate KV heads

ANSWER  "Fits" (TP 2) and "serves" (TP 4–8) are different questions. Pick TP by KV capacity
        and latency target; compare cost per token of 2 × TP4 replicas against 1 × TP8.
`)}
<p>PP across nodes is used when one node is not enough (very large models) and adds a per-token hop; serving pipelines have bubbles too, filled by keeping many requests in flight.</p>

<h3>3.2 Disaggregated prefill and decode</h3>
<p>DistServe (arXiv 2401.09670) and Splitwise (arXiv 2311.18677) showed that serving prefill and decode on separate GPU pools lets each be sized and parallelised for its own SLO — TTFT for prefill, TPOT for decode — and improves goodput (requests per second that meet both SLOs). The price: the KV cache produced by prefill must move to the decode GPU before the first decode step.</p>
${anim('v2-dist-disagg-kv')}
${formula(`
KV transfer time = (KV bytes per token × prompt tokens) / link bandwidth

STEP 1  4,000-token prompt, Llama-3.1-70B shape (320 KiB/token)
        4,000 × 320 KiB = 1,280,000 KiB = 1,310,720,000 B ≈ 1.31 GB

STEP 2  link options
        400 Gb/s RDMA  = 50 GB/s   → 1.31 / 50   ≈ 26 ms
        100 Gb/s       = 12.5 GB/s → 1.31 / 12.5 ≈ 105 ms
        NVLink, ≈ 450 GB/s         → 1.31 / 450  ≈ 2.9 ms

STEP 3  compare with prefill compute (ILLUSTRATIVE): FLOPs ≈ 2 × params × tokens
        2 × 70 × 10⁹ × 4,000 = 5.6 × 10¹⁴ FLOP
        TP 4 H100, 989 TFLOPS dense BF16 each, assume 40 % achieved:
        4 × 989 × 0.4 ≈ 1,582 TFLOPS  →  5.6 × 10¹⁴ / 1.582 × 10¹⁵ ≈ 0.35 s

STEP 4  200-token prompt: KV = 200 × 320 KiB = 62.5 MiB → ≈ 1.3 ms at 50 GB/s,
        prefill ≈ 18 ms; fixed per-request overheads (scheduling, handshakes) now dominate

ANSWER  For long prompts the transfer (26 ms) is small next to prefill (≈ 350 ms) and
        removing interference wins. For short prompts the gain is small; route them to a
        local prefill on the decode worker. Over a slow link (100 Gb/s TCP) the transfer
        can erase the benefit — the old course's warning, now with numbers.
        Engines also overlap transfer with compute layer by layer.
`)}
${table(['System (as of Oct 2026)','How disaggregation is exposed'],[
 ['vLLM (v0.31)','<code>--kv-transfer-config</code> JSON, e.g. <code>{"kv_connector":"NixlConnector","kv_role":"kv_both"}</code>; connectors include NixlConnector, MooncakeConnector, LMCacheConnectorV1, MultiConnector'],
 ['SGLang (v0.5.21)','<code>--disaggregation-mode prefill|decode</code>, <code>--disaggregation-transfer-backend mooncake|nixl</code>, router launched with <code>--pd-disaggregation</code>'],
 ['NVIDIA Dynamo (v1.5.1)','orchestration framework <b>around</b> engines (vLLM, SGLang, TensorRT-LLM): OpenAI-compatible frontend, KV-aware router, Planner that sizes prefill and decode pools against TTFT/ITL targets, KV Block Manager, NIXL for transfers; Kubernetes operator with DynamoGraphDeployment'],
 ['llm-d (v0.10, CNCF Sandbox)','Kubernetes-native: router (proxy + endpoint picker) on Gateway API Inference Extension, prefix-cache-aware routing, P/D disaggregation and tiered KV offload as "well-lit paths"; KServe LLMInferenceService builds on it']
])}
${callout('warn','Correcting the old course','The original Volume 1 described Dynamo as "distributed inference coordination" in a way that implied it replaces engines. Dynamo does not generate tokens itself; it routes, schedules, plans capacity and moves KV between engine workers that do.')}

<h3>3.3 KV-aware routing</h3>
<p>If a request shares a prefix with KV already cached on some worker, sending it there skips that part of prefill. Dynamo's router (v1.5.1) scores each worker with a cost that adds the prefill blocks it would still need to compute (after credit for cached overlap) to its current decode load, and picks the lowest; llm-d's endpoint picker scores pods on KV-cache affinity and load. Details are in ${L('v2-distributed-kv','distributed KV and cache-aware routing')}.</p>

<h3>3.4 Distributed model loading</h3>
${formula(`
Cold start for one 70B replica (ILLUSTRATIVE throughputs — measure yours)

STEP 1  weights ≈ 141 GB
STEP 2  from object storage at 2 GB/s per node      → 141 / 2   ≈ 70 s
        from local NVMe at 10 GB/s                  → 141 / 10  ≈ 14 s
STEP 3  TP 4: each rank needs only its 1/4 shard ≈ 35 GB, loaded in parallel
STEP 4  scale-out of 10 replicas, each pulling 141 GB from the same bucket
        = 1,410 GB of egress in a burst → throttling makes every replica slower

ANSWER  Pre-stage weights (node-local cache, OCI image volumes — GA in Kubernetes 1.36 —
        or a pull-through cache), load per-rank shards with memory-mapped safetensors,
        and keep warm capacity for bursts. Measure node-ready → model-ready time.
`)}

<h3>3.5 GPU fleet scheduling</h3>
<p>Multi-GPU replicas need all their GPUs at once on the right topology: TP inside one node, multi-node replicas on NVLink-connected or close nodes. Kubernetes APIs that express this include LeaderWorkerSet for multi-node inference groups, Dynamo's Grove (PodCliqueSet), Kueue for gang admission and priority between training and inference, and DRA ComputeDomains for multi-node NVLink (${L('v1-k8s-gpu-stack','GPU stack')}).</p>
${formula(`
Fragmentation example: 10 nodes × 8 GPUs = 80 GPUs

demand: 6 replicas × TP4 = 24,  10 × TP2 = 20,  12 × TP1 = 12   → 56 GPUs
packed (bin-packing): TP4 pairs fill 3 nodes, TP2s fill 2.5 nodes, TP1s fill 1.5 nodes
        → 7 nodes used, 3 nodes fully free (24 GPUs) for a TP8 replica or a training gang
spread (random placement): ~3 free GPUs left on many nodes → no node has 8 free
        → the next TP8 replica is unschedulable although 24 GPUs are idle
`)}

<h2>4. Where does it fit?</h2>
${fig('Disaggregated serving: router, prefill pool, decode pool, KV fabric', svgDiagram({w:900,h:340,
 zones:[{x:270,y:20,w:270,h:300,label:'Prefill pool (compute-bound)'},{x:600,y:20,w:290,h:300,label:'Decode pool (bandwidth-bound)'}],
 boxes:[
  {id:'gw',x:20,y:140,w:110,h:56,label:'Gateway',sub:'auth, quotas'},
  {id:'rt',x:150,y:140,w:105,h:56,label:'Router',sub:'KV-aware',cls:'hl'},
  {id:'p1',x:290,y:70,w:230,h:56,label:'Prefill worker TP4',sub:'writes KV for prompt'},
  {id:'p2',x:290,y:210,w:230,h:56,label:'Prefill worker TP4',sub:'scaled by queue depth'},
  {id:'d1',x:620,y:70,w:250,h:56,label:'Decode worker TP4',sub:'streams tokens, steady TPOT'},
  {id:'d2',x:620,y:210,w:250,h:56,label:'Decode worker TP4',sub:'large batch'}
 ],
 arrows:[{from:'gw',to:'rt'},{from:'rt',to:'p1'},{from:'rt',to:'p2'},{from:'p1',to:'d1',label:'KV over NIXL/RDMA',cls:'hl'},{from:'p2',to:'d2',label:'KV',cls:'hl'}]
}), 'Each pool is sized for its own SLO; the KV transfer link becomes part of the critical path for TTFT.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>KV cache:</b> bytes per token set transfer cost (${L('v1-kv-cache','KV cache')}).</li>
<li><b>Routing and caching:</b> prefix reuse and KV offload (${L('v2-prefix-kv-cache','prefix caching')}, ${L('v2-distributed-kv','distributed KV')}).</li>
<li><b>Autoscaling:</b> prefill pool scales on queued prompt tokens, decode pool on KV usage and running sequences (${L('v1-k8s-autoscaling','autoscaling')}, ${L('v2-hyperscale-serving','hyperscale serving')}).</li>
<li><b>Network:</b> the same RDMA fabrics as training (${L('v2-distributed-training','distributed training')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Area','Responsibility'],[
 ['Topology','TP groups inside a node; prefill and decode pools on an RDMA-connected fabric; verify transfer backend (NIXL, Mooncake) actually uses RDMA.'],
 ['Pool sizing','prefill:decode ratio from measured prompt/output length mix; Dynamo Planner or your own autoscaling signals.'],
 ['Weights','pre-staging, versioned immutable artifacts, per-rank shard loading, warm pools.'],
 ['Fleet','bin-packing, priorities between inference and training, preemption policy, node health (Xid).'],
 ['Telemetry','TTFT split into queue + prefill + KV transfer; TPOT per pool; transfer bytes and time.']
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['TTFT got worse after enabling disaggregation','KV transfer over a slow path (TCP) or short prompts dominate','transfer time histogram; prompt length distribution','RDMA backend; conditional disaggregation for long prompts only'],
 ['Decode pool idle, prefill queue long','wrong pool ratio','queue depth per pool','rebalance pools; planner targets'],
 ['Requests fail mid-stream after a prefill node restart','KV lost in transit; no retry path','router errors','retry prefill; health-aware routing'],
 ['New replicas take 10+ minutes to serve','weight download from object storage under a burst','node-ready vs model-ready times','pre-stage weights, image volumes, warm pool'],
 ['TP8 replica pending with idle GPUs','fragmentation','free GPUs per node','bin-packing, defragment by draining, reserve whole nodes'],
 ['One TP replica slow','one GPU degraded (NVLink Xid 74, throttling)','per-GPU metrics, Xid','drain the node; replace']
])}
<div class="dtree"><ul><li><span class="q">Should we disaggregate?</span><ul>
<li><span class="a">no</span>Prompts are short, traffic is modest, chunked prefill already holds TPOT → tune the colocated engine first.</li>
<li><span class="a">maybe</span>Long prompts and long outputs mixed, TPOT SLO broken by prefill interference → pilot with an RDMA fabric and measure goodput.</li>
<li><span class="a">yes</span>Large fleet, distinct TTFT and TPOT SLOs, RDMA available → disaggregate with KV-aware routing and separate autoscaling.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<p>Scale pools independently: prefill by queued prompt tokens and TTFT, decode by KV usage, running sequences and TPOT. Add replicas (DP) before raising TP beyond what latency requires. For MoE models, wide expert parallelism across nodes (an llm-d well-lit path) spreads experts and KV. Keep KV transfers local to a fabric domain; cross-region disaggregation is not practical.</p>

<h2>9. How do we optimize its cost?</h2>
<ul>
<li>Compare cost per token at the SLO for TP4 × 2 replicas versus TP8 × 1 using measured goodput, not peak tokens/s.</li>
<li>Disaggregate only where it raises goodput enough to pay for the extra network and complexity — an extra layer without a measured SLO gain is architectural debt.</li>
<li>Use different GPU types per pool where supported (compute-heavy for prefill, memory-bandwidth-heavy for decode).</li>
<li>Avoid paying for idle GPUs stranded by fragmentation; bin-pack and schedule training into the gaps with preemptible priority.</li>
</ul>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Would you use disaggregated prefill and decode for our assistant?”','<p><i>Answer (≈50 s):</i> "It depends on the prompt and output mix and the network. Disaggregation helps when long prompts interfere with streaming decode and break the TPOT SLO. The cost is moving the KV cache: for a 70B-class model that is about 320 KiB per token, so a 4,000-token prompt is 1.3 GB — about 26 ms over 400 Gb/s RDMA, compared with roughly a third of a second of prefill, so it pays off. For 200-token prompts it does not, so I would disaggregate conditionally. I would first tune chunked prefill on a colocated deployment, then pilot with vLLM’s NIXL connector under Dynamo or llm-d, measure goodput at our TTFT and TPOT targets, and keep it only if cost per successful request falls."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Yes, disaggregation is the modern way and Dynamo replaces vLLM."</p><p>No numbers, and wrong about Dynamo’s role.</p></div><div class="good"><h4>Strong answer</h4><p>Ties the decision to interference, KV bytes, link speed and goodput, and positions Dynamo/llm-d as orchestration around engines.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Prompt tokens','KV bytes','link bandwidth','transfer time','TTFT'])}
${chain(['Model size','TP degree','KV capacity','concurrency','cost per token'])}
<p>Next: ${L('v2-distributed-kv','distributed KV caching')} and ${L('v2-hyperscale-serving','hyperscale serving')}; size it all in ${L('v2-capacity-planning','capacity planning')}.</p></div>
`,
  quiz:[
    {q:'A 4,000-token prompt on a 320 KiB/token model is transferred over 400 Gb/s RDMA. Roughly how long?',options:['2.6 ms','26 ms','260 ms','2.6 s'],answer:1,explain:'4,000 × 320 KiB ≈ 1.31 GB; 400 Gb/s = 50 GB/s; 1.31/50 ≈ 26 ms.'},
    {q:'Why can TP = 2 for a 70B BF16 model on two H100s be a poor serving choice?',options:['TP 2 is unsupported','Weights fit but leave only ≈ 6 GB for KV, about two 8k-token sequences','NVLink is too slow for TP 2','It doubles the weights'],answer:1,explain:'2 × 80 × 0.92 − 141 ≈ 6.2 GB of KV ≈ 18,900 tokens. TP 4 leaves ≈ 153 GB.'},
    {q:'What is NVIDIA Dynamo’s role?',options:['A new inference engine that replaces vLLM','An orchestration framework around engines: routing, planning, KV management and transfer','A GPU driver','A training framework'],answer:1,explain:'Dynamo runs vLLM, SGLang or TensorRT-LLM workers and adds a frontend, KV-aware router, planner, KVBM and NIXL.'},
    {q:'For which traffic does disaggregation help least?',options:['Long prompts with long streaming outputs','Short prompts with modest traffic','Mixed lengths with strict TPOT SLO','Large fleets with RDMA'],answer:1,explain:'Short prompts have little prefill to offload, and fixed transfer overheads dominate.'},
    {q:'A TP8 replica stays Pending while 24 GPUs are idle across the cluster. Likely cause?',options:['Driver bug','Fragmentation: no single node has 8 free GPUs','Kueue is broken','Too much KV'],answer:1,explain:'TP groups must be on one node; scattered free GPUs cannot host it. Bin-pack and reserve whole nodes.'}
  ],
  flashcards:[
    {front:'KV transfer time',back:'KV bytes/token × prompt tokens ÷ link bandwidth. 4,000 × 320 KiB ≈ 1.31 GB → ≈ 26 ms at 50 GB/s.'},
    {front:'Why disaggregate prefill/decode?',back:'Prefill is compute-bound and bursty, decode bandwidth-bound and steady; separating them removes interference and lets each pool meet its own SLO (TTFT vs TPOT).'},
    {front:'vLLM disaggregation flag',back:'--kv-transfer-config, e.g. {"kv_connector":"NixlConnector","kv_role":"kv_both"}.'},
    {front:'TP and KV capacity (70B, H100, util 0.92)',back:'TP2 ≈ 6 GB KV (≈ 2 × 8k seqs); TP4 ≈ 153 GB (≈ 57 × 8k); TP8 ≈ 448 GB (≈ 166 × 8k).'},
    {front:'Cold-start levers',back:'Pre-staged weights (node cache, OCI image volume), per-rank shard loading, mmap safetensors, warm pools.'},
    {front:'Fleet fragmentation',back:'Free GPUs scattered across nodes cannot host TP replicas; bin-pack and keep whole nodes free.'}
  ]
});
registerGlossary([
  {term:'Disaggregated serving',def:'Running prompt prefill and token decode on separate GPU pools and transferring the KV cache between them, so each pool meets its own latency target.',lesson:'v2-distributed-inference',aliases:['disaggregated prefill/decode','P/D disaggregation']},
  {term:'NIXL',def:'NVIDIA Inference Xfer Library: transfers KV and other data between workers and memory tiers over fast interconnects; used by Dynamo and vLLM’s NixlConnector.',lesson:'v2-distributed-inference'},
  {term:'Goodput',def:'Throughput counting only requests that meet all latency SLOs (e.g. TTFT and TPOT).',lesson:'v2-distributed-inference'}
]);
