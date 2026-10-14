/* Volume 1, Part 4: GPU fundamentals (4 lessons) */

/* ===================================================================== 1.4.1 */
registerLesson({
  id:'v1-gpu-architecture', vol:1, part:4, num:1,
  title:'GPU architecture: SMs, CUDA cores, Tensor Cores, HBM and bandwidth', minutes:85,
  summary:'A GPU trades the single-thread speed of a CPU for thousands of simple lanes and very fast memory. It is built from streaming multiprocessors that run threads in groups of thirty-two, with Tensor Cores for matrix maths and high-bandwidth memory stacked next to the chip. For language models, the question is almost never how many cores there are, but whether a piece of work is limited by arithmetic or by moving bytes from memory. The roofline model answers that with one division, and it explains why generating tokens is memory-bound while reading the prompt is compute-bound.',
  objectives:[
    'Explain why GPUs are designed for throughput and CPUs for latency, and what that means for AI workloads.',
    'Name the parts of an NVIDIA GPU (SM, warp, CUDA core, Tensor Core, registers, shared memory, L2, HBM) and what each contributes.',
    'Read a GPU datasheet correctly, including the difference between dense and sparsity TFLOPS.',
    'Compute arithmetic intensity and use the roofline model to classify decode as memory-bound and prefill as compute-bound on an H100-class GPU.',
    'Choose the right optimisation lever (fewer bytes vs cheaper FLOPs) from a roofline diagnosis.'
  ],
  prereqs:['v1-tensors-pytorch','v1-transformer'],
  next:['v1-cuda','v1-gpu-memory','v1-multi-gpu-profiling','v1-inference-anatomy'],
  tags:['gpu','hardware','performance','roofline'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A CPU is a team of a few senior engineers: each can handle any odd task quickly and on their own. A GPU is a factory floor of thousands of workers who all do the same simple step at the same time, fed by a very wide conveyor belt. If your job is “multiply these two huge matrices”, the factory wins by orders of magnitude. If your job is “parse this config and branch on every line”, the senior engineers win. Now the real mechanism.')}
<p>A ${term('GPU')} is a processor designed to run the <b>same instruction over many data elements at once</b>, with a memory system built to feed it hundreds of times more bytes per second than a CPU’s memory. Neural networks are dominated by matrix multiplications (see ${L('v1-tensors-pytorch','tensors and PyTorch')}), which are exactly that pattern: billions of independent multiply-adds.</p>
<p>An NVIDIA data-centre GPU is built from repeated blocks called ${term('streaming multiprocessor','streaming multiprocessors (SMs)')}. Each SM contains:</p>
<ul>
<li><b>${term('CUDA core','CUDA cores')}</b> — scalar arithmetic lanes (FP32/INT32) that execute ordinary instructions.</li>
<li><b>${term('Tensor Core','Tensor Cores')}</b> — fixed-function units that do small matrix multiply-accumulate operations (for example a tile of BF16 values multiplied and accumulated in FP32) in one instruction. Almost all of the advertised AI TFLOPS come from these.</li>
<li><b>Warp schedulers</b> — they issue instructions to groups of 32 threads called ${term('warp','warps')}.</li>
<li><b>Registers and shared memory / L1</b> — small, very fast on-chip storage private to the SM.</li>
</ul>
<p>All SMs share an <b>L2 cache</b> and the large off-chip memory, ${term('HBM')} (high-bandwidth memory), which sits in stacks on the same package as the GPU die.</p>
${table(['Part (H100 SXM, Hopper)','Count / size','What it is for'],[
 ['Streaming multiprocessors','132','Independent processors; blocks of threads are scheduled onto them'],
 ['FP32 CUDA cores','128 per SM','Scalar maths: activations, normalisation, element-wise ops'],
 ['Tensor Cores (4th gen)','4 per SM','Matrix multiply-accumulate in FP64/TF32/BF16/FP16/FP8/INT8'],
 ['Register file','256 KB per SM (65,536 × 32-bit)','Per-thread working values, ~1 cycle'],
 ['Shared memory + L1','256 KB per SM (up to 228 KB as shared)','Tiles reused by a block of threads'],
 ['L2 cache','50 MB','Shared by all SMs'],
 ['HBM3','80 GB, 3.35 TB/s','Weights, KV cache, activations']
])}
${callout('unverified','Where these numbers come from','Memory size, bandwidth and TFLOPS are from NVIDIA’s H100 product page (checked 2026-10-14). The per-SM figures (132 SMs, 128 FP32 cores and 4 Tensor Cores per SM, 256 KB register file, 256 KB L1/shared, 50 MB L2) are from NVIDIA’s Hopper architecture whitepaper; PCIe variants and other SKUs differ. Check the whitepaper for the exact part you run.')}

<h2>2. Why do we need it?</h2>
<h3>Latency-oriented versus throughput-oriented design</h3>
<p>A CPU core spends most of its transistors making <b>one thread</b> fast: large caches, branch prediction, out-of-order execution, high clock. A server CPU has dozens of such cores and, typically, a few hundred GB/s of DRAM bandwidth per socket.</p>
<p>A GPU spends its transistors on <b>many simple lanes</b> and on bandwidth. It does not try to make one thread fast. Instead it keeps tens of thousands of threads resident and, whenever one group waits for memory, it instantly switches to another group that is ready. This is called <b>latency hiding</b> by parallelism. The H100 has 3.35 TB/s of HBM bandwidth — roughly ten times a CPU socket — and about 989 dense BF16 TFLOPS on its Tensor Cores.</p>
${table(['','CPU (server)','GPU (H100 SXM)'],[
 ['Design goal','Low latency for one thread','High throughput for many threads'],
 ['Hides memory latency with','Big caches, prediction, out-of-order','Thousands of resident threads, fast switching'],
 ['Good at','Branchy, irregular, serial code; OS; I/O','Dense linear algebra, element-wise ops on large tensors'],
 ['Memory bandwidth','Hundreds of GB/s per socket','3.35 TB/s'],
 ['Bad at','Billions of identical multiply-adds','Branch-heavy code, tiny problems, anything serial']
])}
<p>A transformer forward pass is billions of multiply-adds in a handful of large matrix multiplications. That is why GPUs (and other accelerators like TPUs and Trainium) run training and inference, while the CPU handles tokenisation, HTTP, scheduling and data loading.</p>

<h2>3. How does it work internally?</h2>
<h3>Threads, warps and SMs</h3>
<p>You write a function (a <i>kernel</i>) for one thread. You launch it over a grid of thousands of threads, grouped into blocks. Each block runs on one SM. Inside the SM, threads execute in ${term('warp','warps')} of <b>32</b>: one instruction is issued and all 32 lanes execute it on their own data. NVIDIA calls this ${term('SIMT')} (single instruction, multiple threads). The full programming model is in ${L('v1-cuda','the CUDA lesson')}; here we need only the consequence: <b>the GPU is fast when it has lots of independent, uniform work and enough data arriving to keep the lanes busy</b>.</p>
<h3>CUDA cores versus Tensor Cores</h3>
<p>A CUDA core does one fused multiply-add on one pair of numbers per clock. A Tensor Core does a small <b>matrix</b> multiply-accumulate per instruction. For matrix-heavy work the difference is huge: on H100 SXM the datasheet gives 67 TFLOPS for FP64 Tensor, but 989.5 dense TFLOPS for BF16 Tensor and about 1,979 dense for FP8. Element-wise operations (GELU, softmax, layer norm, adding a bias) cannot use Tensor Cores and run on the ordinary lanes. That is one reason they are fused into the matmul kernels whenever possible.</p>
${callout('warn','Read the footnote: dense versus sparsity','NVIDIA’s H100 page lists BF16 Tensor at <b>1,979 TFLOPS</b> and FP8 at <b>3,958 TFLOPS</b>, both marked “with sparsity”. That assumes 2:4 structured sparsity (two of every four weights are zero, in a fixed pattern) which ordinary LLM checkpoints do not have. <b>Dense</b> figures are half: <b>989.5</b> BF16 and <b>≈1,979</b> FP8. Use dense numbers for capacity and roofline maths unless you have actually pruned the model to 2:4. The same applies to L4, L40S and Blackwell datasheets.')}
${table(['GPU (NVIDIA datasheet, Oct 2026)','Memory','Bandwidth','BF16 dense TFLOPS','FP8 dense TFLOPS','Ridge point BF16 (FLOP/B)'],[
 ['A100 80GB SXM','80 GB HBM2e','2,039 GB/s','312','— (no FP8)','≈ 153'],
 ['H100 SXM','80 GB HBM3','3.35 TB/s','989.5','≈ 1,979','≈ 295'],
 ['H200 SXM','141 GB HBM3e','4.8 TB/s','989.5','≈ 1,979','≈ 206'],
 ['L40S','48 GB GDDR6','864 GB/s','362','733','≈ 419'],
 ['L4','24 GB','300 GB/s','121 (242 sparse ÷ 2)','≈ 242 (485 sparse ÷ 2)','≈ 403']
])}
<p>Note what H200 changes relative to H100: the same compute, 76 % more memory and 43 % more bandwidth. For memory-bound decode that is a direct speed-up; for compute-bound prefill it changes almost nothing. That single observation is the whole lesson in miniature.</p>

<h3>The memory hierarchy</h3>
<p>Data lives in rings. Each ring outward is larger and slower: registers → shared memory/L1 → L2 → HBM → host RAM over PCIe → disk or network. Fast kernels load a tile from HBM once, keep it in shared memory and registers, and reuse it many times before writing results back. Slow kernels touch HBM for every operation.</p>
${anim('v1-gpu-memhier')}

<h3>Memory bandwidth and arithmetic intensity</h3>
<p>Every kernel does some number of floating-point operations (FLOPs) and moves some number of bytes to and from HBM. Their ratio is the ${term('arithmetic intensity')}:</p>
${formula(`
                         FLOPs performed
arithmetic intensity  = ─────────────────────     (unit: FLOP per byte)
                         bytes moved to/from HBM

                              peak FLOPS
ridge point (machine balance) = ──────────────
                              memory bandwidth

attainable FLOPS = min( peak FLOPS ,  intensity × bandwidth )
`)}
<p>This is the ${term('roofline model')} (Williams, Waterman and Patterson, 2009). If a kernel’s intensity is <b>below</b> the ridge point, the memory system cannot deliver bytes fast enough: it is <b>memory-bound</b>. Above the ridge, the arithmetic units are the limit: <b>compute-bound</b>.</p>

<h3>Worked example: decode GEMV vs prefill GEMM on an H100</h3>
<p>Take one real projection from a Llama-3.1-8B-shaped layer: the MLP up-projection, a weight matrix of 4,096 × 14,336 in BF16. A matrix–vector or matrix–matrix multiply of an (N × 4,096) input by this weight does <code>2 × N × 4,096 × 14,336</code> FLOPs (one multiply and one add per weight per token).</p>
${formula(`
STEP 1  machine balance, H100 SXM, dense BF16
                 989.5 × 10¹² FLOP/s
        ridge = ───────────────────── ≈ 295 FLOP/byte
                  3.35 × 10¹² B/s

STEP 2  decode: one new token, batch N = 1   (a GEMV)
        FLOPs = 2 × 1 × 4,096 × 14,336            = 117,440,512  ≈ 1.17 × 10⁸
        bytes ≈ weights 4,096 × 14,336 × 2 B      = 117,440,512
              + input 8 KB + output 28 KB          ≈ 117.5 MB
        intensity ≈ 1.0 FLOP/B                      ↑ far below 295

        time if memory-bound  = 117.5 MB ÷ 3.35 TB/s  ≈ 35.1 µs
        time if compute-bound = 1.17 × 10⁸ ÷ 989.5 × 10¹² ≈ 0.12 µs
        → memory time is ≈ 300× larger: MEMORY-BOUND

STEP 3  prefill: 2,048 prompt tokens at once   (a GEMM)
        FLOPs = 2 × 2,048 × 4,096 × 14,336       ≈ 2.405 × 10¹¹
        bytes = W 117.4 MB + X 16.8 MB + Y 58.7 MB ≈ 192.9 MB
        intensity ≈ 2.405 × 10¹¹ ÷ 1.929 × 10⁸     ≈ 1,247 FLOP/B
                                                    ↑ far above 295
        time if compute-bound ≈ 243 µs     time if memory-bound ≈ 57.6 µs
        → COMPUTE-BOUND

STEP 4  whole model, decode, batch 1  (8.03 × 10⁹ params, BF16)
        bytes per token ≈ 8.03 × 10⁹ × 2 B = 16.06 GB
        lower bound per token = 16.06 GB ÷ 3.35 TB/s ≈ 4.79 ms
        upper bound           ≈ 1 ÷ 4.79 ms         ≈ 209 tokens/s for ONE stream

ANSWER  Decode reads every weight to produce one token per sequence: intensity ≈ batch size.
        Prefill reuses each weight across thousands of tokens: intensity ≈ prompt length.
`)}
<p>Those are <b>ceilings</b>, not measurements. Real kernels reach a fraction of either roof, and decode also reads each sequence’s KV cache, which is never shared between sequences (see ${L('v1-kv-cache','the KV cache lesson')}). But the classification is robust and it drives every major inference design decision in Part 5.</p>
${anim('v1-gpu-roofline')}
${callout('note','Why batching rescues decode','At batch N, the same weight bytes serve N tokens. FLOPs grow N×, bytes barely change, so intensity ≈ N. Batch 64 gives intensity ≈ 63 and a ceiling of ≈ 210 TFLOPS instead of 3.35. That is the physical reason continuous batching (in ' + L('v1-batching','the batching lesson') + ') multiplies throughput, and why a lightly loaded inference server is so expensive per token.')}

<h2>4. Where does it fit?</h2>
${fig('Inside one GPU node: where each kind of byte lives and travels', svgDiagram({w:900,h:340,
 zones:[{x:250,y:20,w:630,h:300,label:'GPU package (H100 SXM)'}],
 boxes:[
  {id:'cpu',x:20,y:60,w:200,h:60,label:'Host CPU + RAM',sub:'tokenise, schedule, HTTP'},
  {id:'disk',x:20,y:220,w:200,h:60,label:'NVMe / network',sub:'model files, datasets'},
  {id:'hbm',x:280,y:220,w:250,h:70,label:'HBM3  80 GB',sub:'weights · KV cache · activations',cls:'v2'},
  {id:'l2',x:280,y:60,w:250,h:60,label:'L2 cache 50 MB',sub:'shared by all SMs'},
  {id:'sm',x:600,y:60,w:250,h:70,label:'132 SMs',sub:'registers · shared mem · Tensor Cores',cls:'hl'},
  {id:'nvl',x:600,y:220,w:250,h:70,label:'NVLink 900 GB/s',sub:'to other GPUs in the node'}
 ],
 arrows:[{from:'disk',to:'cpu',label:'load weights'},{from:'cpu',to:'hbm',label:'PCIe Gen5'},{from:'hbm',to:'l2',label:'3.35 TB/s'},{from:'l2',to:'sm'},{from:'hbm',to:'nvl',cls:'dash'}]
}), 'The CPU never touches weights during a forward pass: it launches kernels. Weights cross PCIe once at load time; after that the hot path is HBM ↔ L2 ↔ SMs, plus NVLink for multi-GPU work.')}
<p>In the full stack, the GPU sits under the inference engine (vLLM, SGLang, TensorRT-LLM), which sits under a router and a gateway, all scheduled by Kubernetes onto GPU nodes (${L('v1-k8s-gpu-stack','the Kubernetes GPU stack')}). Kubernetes sees the GPU as an opaque countable resource <code>nvidia.com/gpu: 1</code>; it knows nothing about SMs, HBM or bandwidth. Every one of those properties still decides your latency and cost.</p>

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Model size → HBM capacity.</b> Weights plus KV cache plus activations must fit (${L('v1-gpu-memory','GPU memory accounting')}).</li>
<li><b>Decode speed → HBM bandwidth.</b> Tokens per second per stream is bounded by bytes per token ÷ bandwidth. This is why H200 decodes faster than H100 with identical compute.</li>
<li><b>Prefill speed → Tensor Core FLOPS and precision.</b> Time to first token for long prompts tracks dense TFLOPS at the precision you run.</li>
<li><b>Multi-GPU → interconnect.</b> Tensor parallelism needs NVLink-class bandwidth; data parallelism and pipeline parallelism tolerate slower links (${L('v1-multi-gpu-profiling','multi-GPU communication')}).</li>
<li><b>Quantisation → both roofs.</b> Fewer bytes per weight helps the memory-bound side; lower-precision Tensor Core maths helps the compute-bound side (${L('v1-quantization-speculative','quantisation')}).</li>
<li><b>Kernels → how close you get to the roof.</b> FlashAttention, fused kernels and CUDA graphs move real performance up towards the ceiling (${L('v1-cuda','CUDA')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<p>You do not design SMs. You choose, provision and observe them:</p>
${table(['Decision','What to look at','Typical mistake'],[
 ['Which GPU for which workload','Memory size (does it fit with KV headroom?), bandwidth (decode), dense TFLOPS at your precision (prefill), interconnect, MIG support, price per hour','Comparing sparsity TFLOPS, or choosing by TFLOPS for a decode-heavy chat service'],
 ['Precision support','FP8 needs Hopper/Ada or newer; NVFP4 needs Blackwell; A100 has no FP8 Tensor Cores','Planning FP8 serving on A100s'],
 ['Node shape','GPUs per node, NVLink/NVSwitch domain, NICs per GPU, local NVMe for weights','Splitting a tensor-parallel model across nodes without NVLink'],
 ['Health and telemetry','DCGM exporter: memory used (MiB), power, temperature, Xid errors, tensor-pipe activity','Alerting only on “GPU utilisation”'],
 ['Power and thermals','H100 SXM is up to 700 W (configurable); throttling lowers clocks and FLOPS','Ignoring power capping during benchmarks']
])}
${callout('devops','DevOps bridge','Think of a GPU spec sheet like choosing an EC2 instance family: you would not pick a compute-optimised instance for an in-memory cache. Decode is the “memory-optimised” workload; prefill and training are “compute-optimised”. Where the analogy breaks: on a GPU both live on the same chip and the same request needs both, one after the other.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Decode tokens/s far below expectations, Tensor activity low, memory bandwidth high','Memory-bound by design (low batch)','DCGM_FI_PROF_DRAM_ACTIVE high, DCGM_FI_PROF_PIPE_TENSOR_ACTIVE low','Increase batching/concurrency, quantise weights, FP8 KV, faster-memory GPU'],
 ['Prefill slow, TTFT high for long prompts','Compute-bound, or running at a precision without Tensor Core support','Nsight Compute shows high SM throughput; check dtype','FP8 on Hopper+, chunked prefill, more GPUs (tensor parallel)'],
 ['nvidia-smi shows 100 % but throughput is poor','“Utilisation” = time at least one kernel ran, not how many SMs worked','Compare with SM-active / tensor-active profiling metrics','Profile kernels; increase parallelism; fuse small kernels'],
 ['Performance drops over minutes under load','Thermal or power throttling','Clocks and power from <code>nvidia-smi -q -d CLOCK,POWER,PERFORMANCE</code>','Fix cooling/power limits; report to provider'],
 ['Kernels fail with Xid 79 (fallen off the bus) or 48 (double-bit ECC)','Hardware or driver fault','<code>DCGM_FI_DEV_XID_ERRORS</code> (last Xid code), kernel log','Drain node; reset GPU or reboot per NVIDIA Xid catalog; RMA if repeated']
])}
${callout('warn','GPU utilisation is not efficiency','The nvidia-smi documentation defines utilization.gpu as the “percent of time over the past sample period during which one or more kernels was executing on the GPU”. One small kernel on one SM keeps it at 100 %. Use profiling metrics (SM active, tensor-pipe active, DRAM active) to judge how much of the chip is working. Details in ' + L('v1-multi-gpu-profiling','profiling') + '.')}

<h2>8. How do we scale it?</h2>
<ol>
<li><b>Use the chip you have better first</b>: batch more (raises intensity), quantise (fewer bytes), use fused kernels and CUDA graphs.</li>
<li><b>Scale up</b>: GPUs with more HBM and bandwidth (H100 → H200 → B200) for memory-bound decode; more dense TFLOPS for prefill-heavy workloads.</li>
<li><b>Scale within the node</b>: tensor parallelism over NVLink splits each matrix multiply across GPUs, adding both memory and bandwidth.</li>
<li><b>Scale out</b>: more replicas (data parallel) behind a router. Simple, linear, and usually the right first answer when the model fits on one GPU.</li>
</ol>

<h2>9. How do we optimize its cost?</h2>
<p>Price the <b>bottleneck</b>, not the chip. For a decode-heavy chat workload, cost per token tracks <b>bytes moved per token ÷ bandwidth</b> and how many sequences share each weight read. A quick illustration with the 8B shape at batch 1 versus a well-batched server:</p>
${formula(`
Batch 1, BF16:  ≤ 209 tok/s per GPU (bandwidth ceiling)          ← one user pays for the whole GPU
Batch 64, BF16: weights read once per step, plus 64 × KV reads
                e.g. 64 seqs × 2,048 ctx × 128 KiB = 17.2 GB KV
                step ≥ (16.06 + 17.2) GB ÷ 3.35 TB/s ≈ 9.9 ms
                ≤ 64 ÷ 9.9 ms ≈ 6,450 tok/s per GPU               ← ≈ 31× more tokens, same hourly price

(Ceilings, not measurements. Measure real throughput at your latency SLO.)
`)}
<p>The same arithmetic shows why <b>quantising weights</b> is the cheapest decode speed-up (fewer bytes per step), why <b>long contexts</b> cost more than their prompt-token count suggests (KV bytes per step grow), and why an <b>idle-but-allocated</b> GPU is the most expensive thing in your fleet. Pricing details are in ${L('v2-finops-unit-economics','AI FinOps unit economics')}.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Why is LLM decode memory-bound, and what would you do about it?”','<p><i>Answer (≈50 s):</i> “To produce one token for one sequence, the GPU has to read every weight from HBM once, and it does only one multiply-add per weight. That is an arithmetic intensity of about one FLOP per byte, while an H100 needs about 295 FLOP per byte — 989 dense BF16 TFLOPS divided by 3.35 TB/s — to be compute-bound. So decode runs at the speed of memory. The levers all reduce bytes per useful token: batch more sequences per weight read with continuous batching, quantise weights to FP8 or INT4, quantise the KV cache, or buy bandwidth with an H200 or B200. Prefill is the opposite: thousands of tokens reuse each weight, so it is compute-bound and benefits from FP8 Tensor Cores and more GPUs.”</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“Decode is slow because the GPU is not powerful enough, so we need more TFLOPS.”</p><p>Wrong roof: more TFLOPS does nothing for a kernel at intensity 1.</p></div><div class="good"><h4>Strong answer</h4><p>Computes intensity, names the ridge point with dense numbers, and maps each lever to bytes or FLOPs.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Model parameters','bytes per token','HBM bandwidth','TPOT','cost per token'])}
${chain(['Prompt length','FLOPs','Tensor Core TFLOPS','prefill time','TTFT'])}
<p>Next: ${L('v1-cuda','CUDA')} shows how threads, warps and memory access patterns decide how close a kernel gets to these roofs. Then ${L('v1-gpu-memory','GPU memory accounting')} turns HBM capacity into a budget, and ${L('v1-inference-anatomy','inference anatomy')} applies the roofline to prefill and decode.</p></div>

<h3>Lab</h3>
<p>The planned lab <code>labs/04-gpu/profile_matmul.py</code> times a matrix multiply and a matrix–vector multiply correctly (with synchronisation) and converts the times into achieved TFLOPS and GB/s. On any CUDA GPU you can reproduce the classification in a few lines:</p>
${code('python',`import torch
def bench(fn, iters=50):
    for _ in range(5): fn()                      # warm-up
    s, e = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
    s.record()
    for _ in range(iters): fn()
    e.record(); torch.cuda.synchronize()
    return s.elapsed_time(e) / iters / 1e3       # seconds per call

W = torch.randn(14336, 4096, device='cuda', dtype=torch.bfloat16)
for n in (1, 64, 2048):
    x = torch.randn(4096, n, device='cuda', dtype=torch.bfloat16)
    t = bench(lambda: W @ x)
    flops = 2 * n * 4096 * 14336
    bytes_ = 2 * (4096 * 14336 + 4096 * n + 14336 * n)
    print(n, 'TFLOPS', round(flops / t / 1e12, 1), 'GB/s', round(bytes_ / t / 1e9))`)}
<p>Expect n = 1 to show high GB/s and tiny TFLOPS, and n = 2048 the reverse. Your exact numbers depend on GPU, clocks and library versions — record them, do not quote them as universal.</p>
`,
  quiz:[
    {q:'An H100 SXM datasheet lists BF16 Tensor performance as 1,979 TFLOPS “with sparsity”. What figure should you use for a roofline of an ordinary dense LLM?',options:['1,979 TFLOPS','989.5 TFLOPS','3,958 TFLOPS','67 TFLOPS'],answer:1,explain:'Sparsity figures assume 2:4 structured sparsity, which normal checkpoints do not have. Dense is half: 989.5. 3,958 is FP8 with sparsity; 67 is FP64 Tensor.'},
    {q:'A kernel has arithmetic intensity 40 FLOP/byte on an H100 SXM (ridge ≈ 295 for BF16). What limits it?',options:['Tensor Core FLOPS','HBM bandwidth','PCIe bandwidth','The number of CUDA cores'],answer:1,explain:'Below the ridge point the kernel cannot be fed fast enough from HBM. Its ceiling is 40 × 3.35 TB/s ≈ 134 TFLOPS. PCIe is not on the hot path once weights are loaded.'},
    {q:'Why does H200 decode faster than H100 although both have the same Tensor Core TFLOPS?',options:['H200 has more SMs','H200 has 4.8 TB/s HBM3e versus 3.35 TB/s, and decode is memory-bound','H200 supports FP4','H200 uses NVLink 5'],answer:1,explain:'Decode is limited by bytes/second. The compute figures are identical on the datasheets; bandwidth and capacity are what changed.'},
    {q:'What is a warp on NVIDIA GPUs?',options:['A block of 256 threads','A group of 32 threads issued the same instruction together','One Tensor Core','A CUDA stream'],answer:1,explain:'Warps are 32 threads executed in SIMT fashion. Blocks contain several warps and are chosen by the programmer.'},
    {q:'Batch-1 decode of an 8.03 B-parameter BF16 model on one H100 SXM. What is the bandwidth ceiling on tokens/s for that single stream?',options:['≈ 2,090 tok/s','≈ 209 tok/s','≈ 21 tok/s','≈ 61,000 tok/s'],answer:1,explain:'16.06 GB per token ÷ 3.35 TB/s ≈ 4.79 ms → ≈ 209 tok/s at best. Real engines get somewhat less.'},
    {q:'Which change helps a compute-bound prefill most?',options:['Moving to a GPU with more HBM bandwidth but the same TFLOPS','Running the matmuls in FP8 on Hopper Tensor Cores','Increasing the KV-cache block size','Lowering max-num-seqs'],answer:1,explain:'Compute-bound work benefits from cheaper FLOPs. FP8 doubles the dense Tensor Core roof on Hopper. More bandwidth helps the memory-bound side, not this one.'}
  ],
  flashcards:[
    {front:'CPU vs GPU design goal',back:'CPU: low latency for few threads (caches, prediction, out-of-order). GPU: throughput for many threads, hiding latency by switching between thousands of resident threads; ~10× the memory bandwidth.'},
    {front:'H100 SXM key numbers (dense)',back:'132 SMs, 80 GB HBM3, 3.35 TB/s, BF16 989.5 TFLOPS dense (1,979 sparse), FP8 ≈1,979 dense (3,958 sparse), NVLink 900 GB/s, up to 700 W.'},
    {front:'Arithmetic intensity',back:'FLOPs ÷ bytes moved to/from HBM. Compare with ridge = peak FLOPS ÷ bandwidth (≈295 FLOP/B BF16 on H100).'},
    {front:'Roofline formula',back:'attainable FLOPS = min(peak FLOPS, intensity × memory bandwidth).'},
    {front:'Intensity of decode vs prefill',back:'Decode ≈ batch size (each weight used once per sequence). Prefill ≈ number of prompt tokens processed together (thousands) → compute-bound.'},
    {front:'CUDA core vs Tensor Core',back:'CUDA core: scalar FMA per clock (element-wise ops). Tensor Core: small matrix multiply-accumulate per instruction; provides nearly all AI TFLOPS.'},
    {front:'“Sparsity” TFLOPS',back:'Assume 2:4 structured sparsity. Divide by 2 for dense models.'}
  ]
});
registerGlossary([
  {term:'GPU',def:'Graphics processing unit: a throughput-oriented processor with many simple parallel lanes and very high memory bandwidth, used for training and inference.',lesson:'v1-gpu-architecture'},
  {term:'Streaming multiprocessor',def:'The repeated processing block of an NVIDIA GPU (132 on H100 SXM) with its own warp schedulers, CUDA cores, Tensor Cores, registers and shared memory.',lesson:'v1-gpu-architecture',aliases:['SM','SMs']},
  {term:'Warp',def:'A group of 32 GPU threads that the SM issues one instruction to at a time (SIMT execution).',lesson:'v1-gpu-architecture'},
  {term:'SIMT',def:'Single instruction, multiple threads: NVIDIA’s execution model where a warp of 32 threads executes the same instruction on different data, with per-thread masking for branches.',lesson:'v1-gpu-architecture'},
  {term:'CUDA core',def:'A scalar FP32/INT32 arithmetic lane inside an SM, used for element-wise and general-purpose instructions.',lesson:'v1-gpu-architecture'},
  {term:'Tensor Core',def:'A matrix multiply-accumulate unit in NVIDIA SMs that supplies most AI TFLOPS, at precisions such as TF32, BF16, FP16, FP8 and (Blackwell) FP4.',lesson:'v1-gpu-architecture'},
  {term:'HBM',def:'High-bandwidth memory: DRAM stacked on the GPU package (e.g. 80 GB at 3.35 TB/s on H100 SXM) holding weights, KV cache and activations.',lesson:'v1-gpu-architecture',aliases:['high-bandwidth memory','VRAM']},
  {term:'Arithmetic intensity',def:'FLOPs performed per byte moved to or from main memory; compared with the ridge point to decide whether a kernel is memory- or compute-bound.',lesson:'v1-gpu-architecture'},
  {term:'Roofline model',def:'Performance model where attainable FLOPS = min(peak FLOPS, arithmetic intensity × memory bandwidth).',lesson:'v1-gpu-architecture',aliases:['roofline']},
  {term:'Structured sparsity',def:'2:4 sparsity pattern (two zeros in every four weights) that NVIDIA Tensor Cores can exploit; datasheet “with sparsity” TFLOPS assume it and are 2× the dense figure.',lesson:'v1-gpu-architecture',aliases:['2:4 sparsity']}
]);

/* ===================================================================== 1.4.2 */
registerLesson({
  id:'v1-cuda', vol:1, part:4, num:2,
  title:'CUDA programming: kernels, threads, blocks, warps and memory hierarchy', minutes:90,
  summary:'CUDA is NVIDIA’s way of writing code that runs on the GPU. You write one function for one thread, then launch it over a grid of blocks of threads, and every thread works out which piece of data is its own from its block and thread number. Performance comes from three habits: neighbouring threads touch neighbouring memory, data that is reused is kept in fast shared memory, and the CPU never waits for the GPU unless it must. Launches are asynchronous, so timing GPU code without synchronising gives wrong answers. Streams overlap work and CUDA graphs remove launch overhead.',
  objectives:[
    'Explain the CUDA execution model: host and device, kernels, grids, blocks, threads and warps.',
    'Compute global thread indices and launch sizes, including the bounds check, for a vector add with n = 1,000.',
    'Explain memory coalescing, shared memory tiling, occupancy and warp divergence, with numbers.',
    'Time GPU code correctly using CUDA events and synchronisation, and explain why naive timing lies.',
    'Explain what CUDA streams and CUDA graphs do and why inference engines use them.'
  ],
  prereqs:['v1-gpu-architecture','v1-tensors-pytorch'],
  next:['v1-gpu-memory','v1-multi-gpu-profiling','v1-inference-anatomy'],
  tags:['gpu','cuda','performance'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A Kubernetes Job with parallelism: you write one container spec, set completions to a thousand, and each pod reads its index from an environment variable to know which shard to process. A CUDA kernel is the same idea, scaled down to nanoseconds and up to millions of “pods”. Where it breaks: CUDA threads are not isolated, they run in lock-step groups of 32, and they share memory.')}
<p>${term('CUDA')} is NVIDIA’s parallel computing platform: a C++ language extension, a compiler (<code>nvcc</code>), a runtime and driver API, and libraries (cuBLAS for matrix maths, cuDNN, NCCL for communication). The CPU is called the <b>host</b>, the GPU the <b>device</b>. A ${term('kernel')} is a function marked <code>__global__</code> that the host launches on the device. One launch runs the kernel body once per thread, across a ${term('grid')} of ${term('thread block','thread blocks')}.</p>
<p>You will rarely write production CUDA as a platform engineer. PyTorch, cuBLAS, FlashAttention and the inference engines already contain the kernels. You learn CUDA so that profiler traces, out-of-memory errors, “GPU at 100 % but slow” incidents and engine startup logs (CUDA graph capture!) make sense.</p>

<h2>2. Why do we need it?</h2>
<p>The GPU from ${L('v1-gpu-architecture','the previous lesson')} only performs well if work is split into many independent, uniform pieces and if data reaches the SMs efficiently. CUDA is the contract that expresses exactly that: “here is the per-thread work, here is how many threads, here is how they share data”. Without that structure the hardware has no way to schedule tens of thousands of threads or hide memory latency.</p>

<h2>3. How does it work internally?</h2>
<h3>The hierarchy: grid → block → warp → thread</h3>
${table(['Level','Chosen by','Runs on','Can share','Typical size'],[
 ['Grid','You (launch configuration)','Whole GPU','Global memory (HBM)','Thousands to millions of threads'],
 ['Thread block','You','One SM, never split','Shared memory, <code>__syncthreads()</code> barrier','128–1,024 threads (max 1,024)'],
 ['Warp','Hardware (consecutive 32 threads of a block)','One SM warp scheduler','Registers via warp shuffles','32 threads, always'],
 ['Thread','—','One lane','Its own registers','—']
])}
<p>Each thread reads built-in variables: <code>blockIdx.x</code> (which block), <code>blockDim.x</code> (threads per block), <code>threadIdx.x</code> (which thread inside the block), and <code>gridDim.x</code> (how many blocks). From these it computes which data element is its own.</p>

<h3>Worked example: vector add with n = 1,000</h3>
${code('cuda',`// labs/04-gpu/vector_add.cu (planned lab) — the kernel
__global__ void vector_add(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;   // global index
    if (i < n) {                                     // bounds check
        c[i] = a[i] + b[i];
    }
}

// host side
int n = 1000;
int threads = 256;
int blocks = (n + threads - 1) / threads;            // ceiling division
vector_add<<<blocks, threads>>>(d_a, d_b, d_c, n);   // asynchronous launch
cudaDeviceSynchronize();                             // wait before using d_c`)}
${formula(`
STEP 1  number of blocks
                 n + threads − 1      1,000 + 255
        blocks = ───────────────  =  ─────────────  = ⌊4.90⌋ = 4      (integer division)
                     threads             256

STEP 2  threads launched = 4 × 256 = 1,024          useful = 1,000     idle = 24

STEP 3  index of one thread
        block 2, thread 37:  i = blockIdx.x × blockDim.x + threadIdx.x
                               = 2 × 256 + 37
                               = 549            → computes c[549] = a[549] + b[549]

STEP 4  ranges per block
        block 0: 0–255   block 1: 256–511   block 2: 512–767   block 3: 768–1,023

STEP 5  warps
        warps per block = 256 ÷ 32 = 8        total warps = 4 × 8 = 32
        last warp of block 3 = threads 224–255 → i = 992–1,023
        i < 1,000 only for 992–999 → 8 active lanes, 24 masked lanes

ANSWER  4 blocks, 32 warps, 1,024 threads. The guard "if (i < n)" stops threads
        1,000–1,023 from writing past the end of c. Remove it and the program
        corrupts memory or faults only when n is not a multiple of 256.
`)}
${anim('v1-cuda-simt')}
${callout('note','Grid-stride loops','For very large n, kernels often launch a fixed number of blocks and let each thread loop: <code>for (int i = idx; i &lt; n; i += blockDim.x * gridDim.x)</code>. The same kernel then works for any n and any GPU size.')}

<h3>Warps, divergence and occupancy</h3>
<p>All 32 lanes of a warp execute the same instruction. If some lanes take an <code>if</code> branch and others the <code>else</code>, the warp runs both paths one after the other with lanes masked: this is ${term('warp divergence')}. The masked tail of block 3 above is a harmless case; a branch that splits every warp in half halves throughput.</p>
<p>${term('Occupancy')} is resident warps per SM ÷ the maximum (64 warps = 2,048 threads per SM on H100). It is limited by registers and shared memory per block:</p>
${formula(`
Registers per SM (H100)       = 65,536 × 32-bit
Kernel uses 64 registers/thread
Max resident threads          = 65,536 ÷ 64 = 1,024 threads = 32 warps
Occupancy                     = 32 ÷ 64     = 50 %
`)}
<p>Higher occupancy gives the scheduler more warps to switch to while others wait on memory. It is a means, not a goal: well-tuned GEMM kernels often run at modest occupancy because they keep data in registers.</p>

<h3>Memory coalescing</h3>
<p>Global memory is accessed in 32-byte sectors. When the 32 threads of a warp read 32 consecutive 4-byte floats, the hardware combines the requests into four sectors (128 bytes): every byte fetched is used. This is ${term('memory coalescing')}.</p>
${fig('Coalesced versus strided access by one warp', svgDiagram({w:900,h:250,
 boxes:[
  {id:'w1',x:20,y:30,w:200,h:56,label:'Warp: c[i] = a[i]',sub:'thread k reads a[k]'},
  {id:'m1',x:300,y:30,w:280,h:56,label:'4 sectors × 32 B = 128 B',sub:'all bytes used',cls:'ok'},
  {id:'r1',x:640,y:30,w:240,h:56,label:'1 × useful traffic',sub:'full bandwidth',cls:'ok'},
  {id:'w2',x:20,y:150,w:200,h:56,label:'Warp: a[i × 32]',sub:'stride of 32 floats'},
  {id:'m2',x:300,y:150,w:280,h:56,label:'32 sectors × 32 B = 1,024 B',sub:'4 B used of each 32 B',cls:'bad'},
  {id:'r2',x:640,y:150,w:240,h:56,label:'8 × the traffic',sub:'1/8 effective bandwidth',cls:'bad'}
 ],
 arrows:[{from:'w1',to:'m1'},{from:'m1',to:'r1'},{from:'w2',to:'m2'},{from:'m2',to:'r2'}]
}), 'Same number of useful bytes (32 floats = 128 B). The strided pattern moves 1,024 B to get them: 8× more HBM traffic. This is why tensor layout (row-major vs column-major, contiguous vs transposed views) matters for speed.')}

<h3>Shared memory and tiling</h3>
<p>${term('Shared memory')} is on-chip storage (up to 228 KB per SM on H100) visible to all threads of a block. The classic use is <b>tiling</b> a matrix multiply: a block loads a 32 × 32 tile of A and of B from HBM into shared memory once, calls <code>__syncthreads()</code>, and each thread then reads those values 32 times from shared memory instead of from HBM. Global traffic falls by the tile width, which raises arithmetic intensity exactly as the roofline demands. FlashAttention applies the same idea to attention: it never writes the full attention-score matrix to HBM.</p>

<h3>Asynchronous launch and correct timing</h3>
<p>A kernel launch only <b>enqueues</b> work. Control returns to the CPU within microseconds while the GPU runs the kernel later. Python code that wraps launches in <code>time.time()</code> measures the enqueue, not the work. Any operation that needs the result (<code>.item()</code>, <code>.cpu()</code>, printing a tensor) silently synchronises, which is why “the slow line” in a naive profile is often an innocent <code>.item()</code> that waited for everything before it.</p>
${code('python',`import time, torch
a = torch.randn(8192, 8192, device='cuda', dtype=torch.bfloat16)

t0 = time.time(); b = a @ a; t1 = time.time()
print('naive (wrong):', (t1 - t0) * 1e3, 'ms')       # measures the launch only

torch.cuda.synchronize()
start = torch.cuda.Event(enable_timing=True)
end = torch.cuda.Event(enable_timing=True)
start.record(); b = a @ a; end.record()
torch.cuda.synchronize()                               # wait for the GPU
print('events (right):', start.elapsed_time(end), 'ms')`)}
<p>Correct benchmarking also needs <b>warm-up</b> (the first call pays for library initialisation, autotuning and memory allocation) and several repetitions. ${L('v1-benchmarking','The benchmarking lesson')} applies the same discipline to whole inference servers.</p>

<h3>Streams</h3>
<p>A ${term('CUDA stream')} is an ordered queue of GPU work. Operations in one stream run in order; operations in different streams may overlap. Training loops overlap the next batch’s host-to-device copy with the current batch’s compute; NCCL runs communication on its own stream so gradients can be all-reduced while the backward pass continues. Pinned (page-locked) host memory is required for truly asynchronous copies.</p>

<h3>CUDA graphs</h3>
<p>Each launch costs CPU time (single-digit microseconds). A decode step of a large model can launch hundreds of kernels, each of which runs only microseconds at small batch. The CPU becomes the bottleneck and the GPU idles in the gaps. A ${term('CUDA graph')} records a whole sequence of launches once, then replays it with one launch. Inference engines capture graphs for a set of decode batch sizes at startup. Consequences you will see in operations:</p>
<ul>
<li>Startup takes longer (capture runs for each batch size) and logs mention graph capture.</li>
<li>Graphs reserve some GPU memory, which reduces what is left for KV cache (${L('v1-gpu-memory','memory accounting')}).</li>
<li>Shapes must be static: engines pad batches to the nearest captured size.</li>
<li>Disabling graphs (vLLM: <code>--enforce-eager</code>) is a useful debugging step and usually slows decode.</li>
</ul>
${anim('v1-cuda-async')}
${callout('unverified','Flag names change','<code>--enforce-eager</code> is a long-standing vLLM option; confirm it and the graph-capture settings with <code>vllm serve --help</code> for your pinned version.')}

<h2>4. Where does it fit?</h2>
${fig('The software stack from your Python to the SMs', svgDiagram({w:900,h:320,
 boxes:[
  {id:'app',x:20,y:20,w:250,h:52,label:'Your code / vLLM',sub:'Python'},
  {id:'pt',x:20,y:100,w:250,h:52,label:'PyTorch ops, torch.compile',sub:'dispatch, autograd'},
  {id:'lib',x:330,y:100,w:250,h:52,label:'cuBLAS · cuDNN · FlashAttention',sub:'tuned kernels'},
  {id:'tri',x:640,y:100,w:240,h:52,label:'Triton / custom CUDA',sub:'fused kernels'},
  {id:'rt',x:20,y:180,w:250,h:52,label:'CUDA runtime + driver',sub:'streams, graphs, memory'},
  {id:'nccl',x:330,y:180,w:250,h:52,label:'NCCL',sub:'multi-GPU collectives'},
  {id:'gpu',x:20,y:260,w:860,h:46,label:'GPU: SMs, Tensor Cores, HBM, NVLink',cls:'v2'}
 ],
 arrows:[{from:'app',to:'pt'},{from:'pt',to:'lib'},{from:'pt',to:'rt'},{from:'lib',to:'tri',cls:'dash'},{from:'rt',to:'gpu'},{from:'nccl',to:'gpu',fromSide:'bottom',toSide:'top'}]
}), 'You mostly operate at the top two layers. Version compatibility is checked at the bottom: the driver on the node must support the CUDA version the container was built against.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Driver ↔ container.</b> Containers ship the CUDA user-space libraries; the node supplies the kernel driver. A container built for a newer CUDA than the driver supports fails at startup. On Kubernetes, the NVIDIA GPU Operator manages drivers and the container toolkit (${L('v1-k8s-gpu-stack','Kubernetes GPU stack')}).</li>
<li><b>Kernels ↔ profilers.</b> Nsight Systems shows the launches, streams, gaps and synchronisations; Nsight Compute shows one kernel’s coalescing, occupancy and roofline position (${L('v1-multi-gpu-profiling','profiling')}).</li>
<li><b>Graphs ↔ memory budget.</b> Captured graphs and their buffers are part of the non-KV memory overhead.</li>
<li><b>Streams ↔ NCCL.</b> Communication overlaps computation only if it runs on separate streams and the code avoids needless synchronisation.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Area','Your responsibility'],[
 ['Driver / CUDA compatibility matrix','Pin node driver versions; record which CUDA the engine images need; upgrade drivers before images.'],
 ['Build images','Use vendor base images (CUDA runtime vs devel); keep <code>nvcc</code> out of runtime images unless JIT compilation needs it.'],
 ['Compute capability','Kernels are compiled for architectures (sm_80 A100, sm_90 H100, sm_100 B200). New GPU generation = check that images include matching kernels.'],
 ['JIT and caches','Triton, torch.compile and some engines compile kernels at startup; persist their cache directories to shorten restarts.'],
 ['Debug toggles','Know <code>CUDA_LAUNCH_BLOCKING=1</code> (makes launches synchronous so errors point to the right line) and eager mode in engines.']
])}
${callout('devops','DevOps bridge','The driver/CUDA relationship is like the kernel/glibc relationship for Linux containers: the container brings user space, the host brings the kernel, and compatibility runs in one direction (a newer driver supports older CUDA). Treat the GPU driver version as part of the node image, upgraded through the same pipeline as the AMI.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['“CUDA driver version is insufficient for CUDA runtime version”','Image built for newer CUDA than the node driver','Container log at startup; <code>nvidia-smi</code> shows driver and max CUDA','Upgrade node driver or use an image built for the older CUDA'],
 ['“no kernel image is available for execution on the device”','Binary not compiled for this GPU architecture','Error at first kernel launch','Use a build that includes your compute capability'],
 ['“an illegal memory access was encountered” (often Xid 31 / 13 in the kernel log)','Out-of-bounds index, missing bounds check, bad pointer','Error reported at a later, unrelated line because launches are async','Rerun with <code>CUDA_LAUNCH_BLOCKING=1</code>; check index arithmetic; compute-sanitizer'],
 ['Results wrong only when n is not a multiple of block size','Missing <code>if (i &lt; n)</code> guard or wrong ceiling division','Unit test with n = 1,000','Add the guard; test edge sizes'],
 ['Benchmark shows impossibly fast times','Timing without synchronisation','Times do not scale with problem size','CUDA events + synchronise; warm up'],
 ['Small-batch decode slow, GPU shows gaps between tiny kernels','Launch-bound (CPU overhead)','Nsight Systems timeline with gaps','CUDA graphs, kernel fusion, torch.compile']
])}
<div class="dtree"><ul><li><span class="q">A CUDA error appeared — where is it really?</span><ul>
<li><span class="a">step 1</span>Rerun with <code>CUDA_LAUNCH_BLOCKING=1</code> so the error is raised at the launch that caused it.</li>
<li><span class="a">step 2</span>Out-of-memory? Go to ${L('v1-gpu-memory','the OOM runbook')}. Illegal address? Check indices and tensor shapes.</li>
<li><span class="a">step 3</span>Check <code>dmesg</code>/DCGM for Xid codes: application Xids (13, 31) mean restart the app and fix code; hardware Xids (48, 79, 95) mean drain the node.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<p>Inside one GPU, scaling means exposing more parallel work: bigger batches, more blocks than SMs (several per SM so the scheduler can hide latency), and avoiding serial bottlenecks such as synchronisations in the inner loop. Beyond one GPU, the same kernels run on each device and NCCL moves data between them (${L('v1-multi-gpu-profiling','next lessons')}).</p>
<ul>
<li>Launch enough blocks: a grid of 4 blocks uses 4 of 132 SMs no matter how fast each block is.</li>
<li>Fuse small kernels (torch.compile, Triton) to cut HBM round-trips and launches.</li>
<li>Use CUDA graphs for repetitive, fixed-shape loops (decode).</li>
<li>Overlap copies and communication with compute using streams.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>GPU-hours are paid whether kernels are efficient or not. The cheapest optimisations are the ones the engines already do — make sure they are switched on: CUDA graphs not disabled in production, fused attention kernels in use, correct dtypes (no accidental FP32), and data loaders that keep the GPU fed. A training job whose Nsight Systems trace shows the GPU waiting on the data loader 30 % of the time is wasting 30 % of its bill; fixing the loader costs nothing in hardware.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Explain a CUDA kernel launch for vector addition, and how you would time it.”','<p><i>Answer (≈45 s):</i> “I write a kernel that computes one element per thread. Each thread computes its global index as blockIdx times blockDim plus threadIdx and checks it is less than n. For a thousand elements with 256-thread blocks I launch four blocks — 1,024 threads — and 24 threads are masked by the bounds check. The hardware schedules blocks onto SMs and runs each block as warps of 32. The launch is asynchronous, so to time it I record CUDA events around the kernel and synchronise before reading them, after a few warm-up runs. Timing with the CPU clock alone would only measure the launch.”</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“Each CUDA core runs one thread, so 1,000 elements need 1,000 cores.”</p><p>Threads are not pinned to cores; warps are scheduled and switched to hide latency.</p></div><div class="good"><h4>Strong answer</h4><p>Gives the index arithmetic, the bounds check, warps, asynchrony and event-based timing.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Kernel','grid of blocks','warps on SMs','coalesced loads','achieved bandwidth','roofline position'])}
${chain(['Async launch','streams','CUDA graphs','lower decode overhead','better TPOT'])}
<p>Next: ${L('v1-gpu-memory','GPU memory accounting')} explains where every byte of HBM goes and how to debug CUDA OOM. ${L('v1-multi-gpu-profiling','Profiling')} shows how to see all of this in Nsight Systems and Nsight Compute.</p></div>
`,
  quiz:[
    {q:'n = 1,000, blockDim = 256. Which launch is correct and how many threads do no work?',options:['3 blocks, 0 idle','4 blocks, 24 idle','4 blocks, 0 idle','1,000 blocks, 0 idle'],answer:1,explain:'⌈1000/256⌉ = 4 blocks = 1,024 threads; threads 1,000–1,023 are masked by the bounds check. 3 blocks would cover only 768 elements.'},
    {q:'Thread 37 of block 2 with blockDim 256 processes which index?',options:['39','549','293','512'],answer:1,explain:'i = 2 × 256 + 37 = 549.'},
    {q:'A Python benchmark times a matmul with time.time() before and after the call and gets 0.05 ms for a 16k × 16k matmul. Most likely?',options:['The GPU is extremely fast','The launch is asynchronous; the timer measured only the enqueue','The result is cached','Tensor Cores skip zeros'],answer:1,explain:'Without synchronisation (or CUDA events + sync) you measure the CPU-side launch. Always synchronise and warm up.'},
    {q:'Each thread of a warp reads a[i × 32] (float32). Compared with a[i], how much HBM traffic is generated for the same 128 useful bytes?',options:['Same','2×','8×','32×'],answer:2,explain:'32 different 32-byte sectors = 1,024 B instead of 4 sectors = 128 B: 8× the traffic.'},
    {q:'Why do inference engines capture CUDA graphs for decode?',options:['To save HBM','To replay many small kernel launches with one launch and remove CPU launch overhead','To enable tensor parallelism','To encrypt kernels'],answer:1,explain:'Decode at small batch is launch-bound. Graphs cut CPU overhead; they actually cost some memory, which is the trade-off.'}
  ],
  flashcards:[
    {front:'Global index formula (1-D)',back:'i = blockIdx.x × blockDim.x + threadIdx.x; guard with if (i < n).'},
    {front:'Blocks needed for n elements',back:'(n + threads − 1) / threads (integer ceiling). n = 1,000, 256 threads → 4 blocks, 24 idle threads.'},
    {front:'Warp divergence',back:'Lanes of one warp take different branches; the warp runs each path in turn with lanes masked, reducing throughput.'},
    {front:'Memory coalescing',back:'Consecutive threads accessing consecutive addresses let the warp fetch few 32-byte sectors; strided access multiplies traffic.'},
    {front:'Why naive GPU timing lies',back:'Launches are asynchronous. Use CUDA events and synchronize, after warm-up.'},
    {front:'CUDA stream',back:'Ordered queue of GPU work; different streams can overlap (copy with compute, NCCL with backward).'},
    {front:'CUDA graph',back:'Recorded sequence of launches replayed with one launch; removes CPU overhead; needs static shapes; costs some memory.'},
    {front:'CUDA_LAUNCH_BLOCKING=1',back:'Makes launches synchronous so errors are reported at the offending kernel. Debug only.'}
  ]
});
registerGlossary([
  {term:'CUDA',def:'NVIDIA’s GPU computing platform: C++ extensions, compiler (nvcc), runtime/driver APIs and libraries (cuBLAS, cuDNN, NCCL).',lesson:'v1-cuda'},
  {term:'Kernel',def:'A function launched by the host to run on the GPU, executed once per thread across a grid of thread blocks.',lesson:'v1-cuda',aliases:['CUDA kernel']},
  {term:'Grid',def:'All thread blocks created by one kernel launch.',lesson:'v1-cuda'},
  {term:'Thread block',def:'A group of up to 1,024 threads scheduled together on one SM, able to share memory and synchronise with __syncthreads().',lesson:'v1-cuda',aliases:['block','CTA']},
  {term:'Warp divergence',def:'When threads of one warp follow different branches, so the warp executes each path in turn with some lanes masked.',lesson:'v1-cuda'},
  {term:'Occupancy',def:'Resident warps on an SM divided by the hardware maximum; limited by registers and shared memory per block.',lesson:'v1-cuda'},
  {term:'Memory coalescing',def:'Combining the memory accesses of a warp into a few wide transactions when threads access consecutive addresses.',lesson:'v1-cuda',aliases:['coalesced access']},
  {term:'Shared memory',def:'Fast on-chip memory (up to 228 KB per SM on H100) shared by the threads of a block, used for tiling and data reuse.',lesson:'v1-cuda'},
  {term:'CUDA graph',def:'A captured sequence of GPU operations replayed with a single launch, removing per-kernel CPU launch overhead.',lesson:'v1-cuda',aliases:['CUDA graphs']}
]);

/* ===================================================================== 1.4.3 */
registerLesson({
  id:'v1-gpu-memory', vol:1, part:4, num:3,
  title:'GPU memory accounting and CUDA out-of-memory troubleshooting', minutes:85,
  summary:'GPU memory is the hardest limit in AI infrastructure. In training it holds the weights, their gradients, the optimizer state and the activations saved for the backward pass; with mixed-precision Adam that is about sixteen bytes per parameter before activations. In inference it holds the weights, the KV cache for every active token, temporary activations, CUDA graphs and allocator overhead. This lesson builds both budgets for an eight-billion and a seventy-billion parameter model, and gives a runbook that separates the three different “out of memory” failures you will meet: the pod killed for host memory, the CUDA out-of-memory exception, and an inference engine that has simply run out of KV-cache blocks.',
  objectives:[
    'Build a training memory budget (weights, gradients, optimizer state, activations) and explain the 16 bytes/parameter rule for mixed-precision Adam.',
    'Build an inference memory budget (weights, KV cache, activations, CUDA graphs, allocator overhead) for 8B and 70B models on 80 GB GPUs.',
    'Distinguish GB from GiB and nominal from usable GPU memory.',
    'Diagnose host OOMKilled vs CUDA OOM vs engine KV exhaustion from symptoms and evidence.',
    'Use PyTorch memory tools (memory_summary, memory snapshots, expandable segments) to find the cause of a CUDA OOM.'
  ],
  prereqs:['v1-gpu-architecture','v1-training-loop'],
  next:['v1-kv-cache','v1-multi-gpu-profiling','v2-distributed-training','v2-capacity-planning'],
  tags:['gpu','memory','oom','capacity','training','inference'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A GPU’s memory is like a fixed-size moving truck. Training packs the furniture (weights), a copy of every change you plan to make (gradients), your notes about past changes (optimizer state) and the boxes you will need to unpack again on the way back (activations). Inference packs only the furniture and a growing pile of per-customer boxes (KV cache). You cannot rent a bigger truck mid-journey; you plan the load. Now the real accounting.')}
<p><b>GPU memory accounting</b> is listing every consumer of ${term('HBM')}, estimating its size from the model and the workload, and comparing the total to what the device really offers. It is the first calculation in any training or serving design, and the first thing to redo when you see a ${term('CUDA OOM')}.</p>
${callout('note','Units first: GB versus GiB','1 GB = 10⁹ bytes. 1 GiB = 2³⁰ = 1,073,741,824 bytes (7.4 % larger). Model sizes are usually quoted in GB (parameters × bytes). NVIDIA markets the H100 as “80GB”; AWS lists it as 80 GiB usable per GPU; <code>nvidia-smi</code> and DCGM report MiB (DCGM_FI_DEV_FB_USED is in MiB). Mixing these silently costs 7 %, which is often exactly the margin between “fits” and “OOM”. This lesson budgets the H100 as 80 GiB ≈ 85.9 GB.')}

<h2>2. Why do we need it?</h2>
<p>A model that “fits” at load time can still fail: training needs several times the weight memory, and inference memory grows with every concurrent token. Without a budget you discover the limit in production, as an OOM crash in training or as queueing and latency spikes in serving. With a budget you can answer, before buying anything: how many GPUs, which parallelism, what maximum context, what concurrency per replica.</p>

<h2>3. How does it work internally?</h2>
<h3>Training budget</h3>
${table(['Consumer','Bytes per parameter (mixed-precision Adam)','Notes'],[
 ['Weights (BF16/FP16)','2','Used in forward and backward'],
 ['Gradients (BF16/FP16)','2','One per trainable parameter'],
 ['FP32 master weights','4','Optimizer updates a full-precision copy'],
 ['Adam first moment m (FP32)','4','Running mean of gradients'],
 ['Adam second moment v (FP32)','4','Running mean of squared gradients'],
 ['<b>Model state total</b>','<b>16</b>','ZeRO paper (Rajbhandari et al., 2019, arXiv 1910.02054): 2Ψ + 2Ψ + 12Ψ = 16Ψ'],
 ['Activations','depends on batch × sequence × hidden × layers','Saved forward outputs needed by backward; reduced by activation checkpointing'],
 ['Temporary buffers, communication, CUDA context','hundreds of MB to several GB','Measure; NCCL buffers grow with GPU count']
])}
${callout('warn','The 16 B/param rule has assumptions','It is right for mixed-precision training with Adam/AdamW and FP32 master weights and optimizer state, all parameters trainable. It is <i>not</i> universal: pure BF16 training without master weights, 8-bit optimizers, SGD, LoRA (only adapters are trainable) and ZeRO/FSDP sharding all change it. State the assumptions when you quote it. Activations come on top.')}
${anim('v1-gpumem-train')}
${formula(`
TRAINING — full fine-tune, Llama-3.1-8B shape (8.03 × 10⁹ params), mixed-precision Adam

STEP 1  model state  = 8.03 × 10⁹ × 16 B          = 128.5 GB
                          ↑ weights 16.1 + grads 16.1 + master 32.1 + Adam m,v 64.2

STEP 2  activations (rough GPT-style estimate, BF16, no recomputation, FlashAttention)
        per layer ≈ 34 × s × b × h bytes            (Korthikanti et al., arXiv 2205.05198)
                  = 34 × 4,096 × 1 × 4,096 ≈ 0.57 GB
        × 32 layers                                  ≈ 18.3 GB   (s = 4,096 tokens, b = 1)
        with full activation checkpointing: keep ≈ 2 × s × b × h per layer
                  = 2 × 4,096 × 4,096 × 32         ≈ 1.07 GB   + one layer recomputed at a time

STEP 3  total ≈ 128.5 + 18.3 ≈ 147 GB   (without checkpointing)
        one 80 GiB (85.9 GB) GPU: does NOT fit

STEP 4  ZeRO-3 / FSDP over 8 GPUs:  128.5 ÷ 8 ≈ 16.1 GB state per GPU
        + per-GPU activations + buffers → fits with room for a larger micro-batch

ANSWER  Full fine-tuning needs ≈ 8× the weight memory before activations.
        The activation constant is model-dependent (SwiGLU, GQA change it): treat it as an
        order-of-magnitude estimate and measure with torch.cuda.max_memory_allocated().
`)}
${formula(`
TRAINING — full fine-tune, Llama-3.1-70B shape (70.6 × 10⁹ params)

model state = 70.6 × 10⁹ × 16 B = 1,129.6 GB  ≈ 1.13 TB
÷ 85.9 GB per H100 ≈ 13.2 GPUs just for state → in practice 16+ GPUs (two 8-GPU nodes)
with ZeRO-3/FSDP, plus activations, plus inter-node all-gather / reduce-scatter traffic.
LoRA instead: frozen BF16 base 141 GB (or ≈ 35–40 GB in 4-bit with QLoRA) + small adapter state.
`)}
<p>LoRA changes the budget dramatically. For the 8B shape with rank 16 on every linear layer, trainable parameters per layer are r × (d_in + d_out) summed over q, k, v, o, gate, up, down = 1,310,720; × 32 layers ≈ 41.9 M. At 16 B each that is ≈ 0.67 GB of trainable state on top of the frozen 16.1 GB base. That is why a single GPU fine-tunes the Atlas model in ${L('v1-capstone-train','the capstone')} and ${L('v1-finetuning','the fine-tuning lesson')}.</p>

<h3>Inference budget</h3>
${table(['Consumer','Size driver','Typical behaviour'],[
 ['Weights','params × bytes/param (BF16 2, FP8 1, INT4 ≈ 0.5 + scales)','Fixed after load'],
 ['KV cache','tokens in flight × KV bytes/token (see the KV lesson)','Grows with concurrency × context; engines pre-allocate a pool'],
 ['Activations / workspace','max tokens per step (batch × chunk) × hidden × layers in flight','Engines measure a peak at startup (profiling run)'],
 ['CUDA graphs','number of captured batch sizes','Extra buffers held for the process lifetime'],
 ['CUDA context + libraries','per process (cuBLAS, NCCL workspaces)','Hundreds of MB per process; more with TP'],
 ['Allocator overhead / fragmentation','cached-but-unused blocks, gaps','Grows in long-running processes with varying shapes']
])}
<p>vLLM makes this explicit: <code>--gpu-memory-utilization</code> (default <b>0.92</b> as of v0.31, Oct 2026) is the fraction of the GPU this instance may use. At startup it loads weights, runs a profiling forward pass at the maximum batch to measure activation peak, and turns the remainder into KV-cache blocks. The log reports how many KV tokens fit.</p>
${formula(`
INFERENCE — Llama-3.1-8B shape on 1 × H100 (80 GiB), vLLM, BF16

STEP 1  budget      = 0.92 × 80 GiB              = 73.6 GiB
STEP 2  weights     = 8.03 × 10⁹ × 2 B = 16.06 GB = 14.96 GiB
STEP 3  activations + graphs + overhead ≈ 3 GiB   (ILLUSTRATIVE — read your startup log)
STEP 4  KV pool     = 73.6 − 14.96 − 3           ≈ 55.6 GiB
STEP 5  KV per token (32 layers × 8 KV heads × 128 dim × 2 × 2 B) = 128 KiB
        tokens      = 55.6 GiB ÷ 128 KiB          ≈ 455,000 tokens
        8,192-token sequences = 455,000 ÷ 8,192   ≈ 55 at once

ANSWER  ≈ 15 GiB of weights, ≈ 56 GiB of KV. On a small model KV dominates the card.
`)}
${formula(`
INFERENCE — Llama-3.1-70B shape (70.6 × 10⁹ params, 80 layers, 8 KV heads)
KV per token = 2 × 80 × 8 × 128 × 2 B = 320 KiB    weights BF16 = 141.2 GB = 131.5 GiB

Option A  TP = 2 (2 × H100), BF16 weights
          budget 2 × 73.6 = 147.2 GiB − weights 131.5 − overhead ≈ 6 (illustrative)
          KV ≈ 9.7 GiB → ≈ 31,800 tokens → ≈ 3.9 sequences of 8k         ← barely usable

Option B  TP = 4 (4 × H100), BF16 weights
          294.4 − 131.5 − ≈ 12 ≈ 150.9 GiB KV → ≈ 494,000 tokens → ≈ 60 sequences of 8k

Option C  TP = 2, FP8 weights (70.6 GB = 65.75 GiB)
          147.2 − 65.75 − ≈ 6 ≈ 75.5 GiB KV → ≈ 247,000 tokens → ≈ 30 sequences of 8k
          (validate quality — see the quantization lesson)
`)}
<p>With tensor parallelism the KV heads are split across GPUs (8 KV heads over TP=2 → 4 per GPU), so each GPU holds half of every token’s KV. The totals above are per replica. The KV formula and PagedAttention are explained in ${L('v1-kv-cache','the KV cache lesson')}; quantised options in ${L('v1-quantization-speculative','quantization')}.</p>

<h3>The PyTorch caching allocator</h3>
<p>PyTorch does not call <code>cudaMalloc</code> for every tensor. It requests large segments from the driver and carves them into blocks it caches for reuse. Two numbers matter:</p>
<ul>
<li><code>torch.cuda.memory_allocated()</code> — bytes held by live tensors.</li>
<li><code>torch.cuda.memory_reserved()</code> — bytes the allocator holds from the driver (allocated + cached free blocks). <code>nvidia-smi</code> shows roughly this plus the CUDA context.</li>
</ul>
<p>If reserved is much larger than allocated and an allocation still fails, the free memory is <b>fragmented</b>: plenty in total, but no single gap large enough. Setting <code>PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True</code> lets segments grow in place and usually reduces this. PyTorch’s own OOM message suggests it when reserved-but-unallocated memory is large.</p>

<h2>4. Where does it fit?</h2>
${fig('Three different memories, three different “out of memory” errors', svgDiagram({w:900,h:330,
 zones:[{x:20,y:20,w:280,h:290,label:'Node (Kubernetes sees this)'},{x:330,y:20,w:550,h:290,label:'GPU (Kubernetes does not see inside)',cls:'ok'}],
 boxes:[
  {id:'ram',x:40,y:60,w:240,h:60,label:'Host RAM',sub:'pod memory limit → OOMKilled'},
  {id:'load',x:40,y:200,w:240,h:60,label:'Loader / dataloader',sub:'reads files, pins memory'},
  {id:'alloc',x:350,y:60,w:240,h:60,label:'PyTorch allocator',sub:'torch.OutOfMemoryError',cls:'hl'},
  {id:'kv',x:620,y:60,w:240,h:60,label:'Engine KV pool',sub:'full → queue / preempt',cls:'hl'},
  {id:'hbm',x:350,y:200,w:510,h:60,label:'HBM: weights · KV blocks · activations · graphs',cls:'v2'}
 ],
 arrows:[{from:'load',to:'ram'},{from:'ram',to:'alloc',label:'copy'},{from:'alloc',to:'hbm'},{from:'kv',to:'hbm'}]
}), 'Host memory is governed by the pod limit; GPU memory by the allocator and the engine. Raising the pod memory limit fixes only the left-hand failure.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Context length and concurrency policies</b> at the gateway set peak KV usage (${L('v2-ai-gateway','AI gateway')}).</li>
<li><b>Parallelism choices</b> (tensor, pipeline, ZeRO/FSDP) divide weights, state and KV across GPUs (${L('v2-parallelism','parallelism')}, ${L('v2-distributed-training','distributed training')}).</li>
<li><b>Quantisation</b> shrinks weights and KV bytes (${L('v1-quantization-speculative','quantization')}).</li>
<li><b>Kubernetes resources</b>: <code>nvidia.com/gpu</code> requests whole GPUs (or MIG slices) but carries no memory quantity; host memory limits must still cover loading (${L('v1-k8s-serving','model serving on Kubernetes')}).</li>
<li><b>Capacity planning</b> turns the KV pool into sequences per replica and replicas per traffic level (${L('v2-capacity-planning','capacity planning')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Lever','Where','Effect'],[
 ['<code>--gpu-memory-utilization</code> (vLLM), <code>--mem-fraction-static</code> (SGLang), <code>--kv_cache_free_gpu_memory_fraction</code> (TensorRT-LLM)','Engine args','How much of the GPU the engine claims; the rest is headroom for other processes'],
 ['<code>--max-model-len</code>, <code>--max-num-seqs</code>, <code>--max-num-batched-tokens</code>','Engine args','Cap KV per sequence, concurrency and activation peak'],
 ['<code>PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True</code>','Pod env','Reduces fragmentation in PyTorch-based training/inference'],
 ['Pod memory request/limit','Deployment spec','Must cover host-side loading, tokenizer, pinned buffers'],
 ['<code>/dev/shm</code> size','emptyDir medium Memory','Multi-process engines and dataloaders use shared memory; default container shm is small'],
 ['One GPU per process unless MIG/time-slicing is intended','Device plugin / DRA config','Two processes on one GPU each think they own all of it']
])}
${callout('devops','DevOps bridge','The KV pool is like a JVM heap sized with -Xmx: the engine grabs it up front and manages it internally, so node-level metrics show the GPU “full” from the moment the server starts. Alert on the engine’s own usage metric (vllm:kv_cache_usage_perc) and queue length, not on DCGM_FI_DEV_FB_USED, which will sit near 92 % forever.')}

<h2>7. What happens when it fails? — the OOM runbook</h2>
${table(['Failure','Symptoms','Evidence','Fix'],[
 ['<b>Host OOMKilled</b>','Pod restarts; exit code 137; no Python traceback','<code>kubectl describe pod</code> → Last State: Terminated, Reason: OOMKilled; node memory metrics','Raise memory limit; load with safetensors mmap instead of reading whole files into RAM; fewer dataloader workers; avoid loading full checkpoint on every rank'],
 ['<b>CUDA OOM</b> (PyTorch)','<code>torch.OutOfMemoryError: CUDA out of memory. Tried to allocate …</code> with total, free, allocated and reserved figures','Traceback; <code>torch.cuda.memory_summary()</code>; snapshot; <code>nvidia-smi --query-compute-apps=pid,used_memory --format=csv</code>','Smaller micro-batch / sequence; activation checkpointing; ZeRO/FSDP; LoRA; BF16 not FP32; expandable segments if fragmented; kill stray processes on the GPU'],
 ['<b>Engine KV exhaustion</b>','No crash. TTFT rises, requests wait, preemptions under load','<code>vllm:kv_cache_usage_perc</code> ≈ 1.0, <code>vllm:num_requests_waiting</code> &gt; 0','Lower max context/concurrency, FP8 KV, more replicas/TP (see the KV lesson)'],
 ['<b>Engine fails at startup</b>','Error that the KV cache cannot hold even one max-length sequence, or OOM during profiling / graph capture','Startup log: weights size, KV blocks, graph capture','Lower <code>--max-model-len</code>, raise utilisation slightly, quantise, add TP; check nothing else is on the GPU'],
 ['<b>Slow creep to OOM over hours</b>','Long-running training or notebook OOMs late','Reserved grows while allocated stays flat; snapshot shows many small free blocks','Fragmentation: expandable segments; free references (lists of tensors holding graphs); avoid storing loss tensors without <code>.item()</code>']
])}
<div class="dtree"><ul><li><span class="q">Something says “out of memory”. Which one?</span><ul>
<li><span class="a">exit 137 / OOMKilled</span>Host RAM. Look at the pod limit and the loader. GPU is irrelevant.</li>
<li><span class="a">Python traceback with CUDA out of memory</span>Device memory in a PyTorch process. Read the numbers in the message: if “reserved but unallocated” is large → fragmentation; if allocated ≈ total → genuine over-subscription; if total is much smaller than the card → another process or a MIG slice.</li>
<li><span class="a">no error, just latency</span>Engine KV pool full: queueing and preemption. Go to ${L('v1-kv-cache','the KV lesson')}.</li>
<li><span class="a">Xid in the kernel log</span>Not an OOM at all; check the Xid catalog (31 = illegal address from the app; 48/95 = memory hardware errors).</li>
</ul></li></ul></div>
<h3>Finding the cause with a memory snapshot</h3>
${code('python',`import torch
torch.cuda.memory._record_memory_history(max_entries=100000)   # start recording
try:
    train_steps(5)                                              # reproduce the OOM
except torch.OutOfMemoryError:
    pass
finally:
    torch.cuda.memory._dump_snapshot('oom_snapshot.pickle')     # open in pytorch.org/memory_viz
    torch.cuda.memory._record_memory_history(enabled=None)      # stop recording
print(torch.cuda.memory_summary(abbreviated=True))
print('peak GiB', torch.cuda.max_memory_allocated() / 2**30)`)}
<p>The snapshot viewer shows every live allocation over time with the Python stack that created it, so you can see whether the peak is activations in backward, an optimizer step, a giant logits tensor (vocabulary × sequence length!) or a leak. The <code>_record_memory_history</code> API is underscore-prefixed (semi-private) and its arguments have changed across PyTorch releases; check the PyTorch “Understanding CUDA memory usage” page for your version.</p>
${callout('tip','The forgotten tensor: logits','For a 128,256-token vocabulary (Llama 3) and 8,192 positions, FP32 logits are 128,256 × 8,192 × 4 B ≈ 4.2 GB per sequence. Training code that computes the full logits for long sequences often OOMs at the loss, not in the transformer. Chunked or fused cross-entropy losses avoid materialising them.')}

<h2>8. How do we scale it?</h2>
<ol>
<li><b>Training</b>: activation checkpointing → mixed precision → ZeRO-1/2 (shard optimizer state and gradients) → ZeRO-3/FSDP (shard weights too) → tensor/pipeline parallelism for very large models → CPU/NVMe offload as a last resort (slow, see the PCIe numbers in ${L('v1-gpu-architecture','GPU architecture')}).</li>
<li><b>Inference</b>: quantise weights → FP8 KV cache → cap context and concurrency → tensor parallelism (adds HBM and bandwidth per replica) → more replicas → KV offload tiers (${L('v2-distributed-kv','distributed KV')}).</li>
</ol>

<h2>9. How do we optimize its cost?</h2>
<p>Memory, not compute, usually decides how many GPUs you buy. Two examples from the budgets above: the 70B model on two H100s in BF16 leaves room for ≈ 4 long sequences, which makes cost per token terrible; four H100s give ≈ 60, and FP8 weights on two give ≈ 30. The cheapest option per token is often <i>not</i> the smallest GPU count that loads the model. For training, LoRA turns a multi-node 70B job into something a single node can do, which removes inter-node networking from the bill and the failure modes. Always price “memory that holds users” (KV) rather than “memory that holds the model”.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How much GPU memory do you need to fine-tune and to serve a 7–8B model?”','<p><i>Answer (≈60 s):</i> “For serving, weights are about 2 bytes per parameter in BF16, so roughly 16 GB for 8B, and then the KV cache, which depends on concurrency times context: about 128 KiB per token for a Llama-3-8B shape, so one 8k conversation is 1 GiB. On an 80 GB H100 with vLLM at 92 % utilisation, that leaves about 55 GiB for KV, around 55 concurrent 8k sequences. For full fine-tuning with mixed-precision Adam, model state is about 16 bytes per parameter — weights, gradients, FP32 master and two Adam moments — so about 128 GB before activations; that needs ZeRO-3 or FSDP across several GPUs. With LoRA, only the adapters are trainable, so it fits on one GPU. And I’d always confirm the estimate with the engine’s startup log or max_memory_allocated, because activations and overheads are workload-specific.”</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“An 8B model is 16 GB, so a 24 GB GPU is enough for training and serving.”</p></div><div class="good"><h4>Strong answer</h4><p>Separates training state (16 B/param + activations) from serving (weights + KV), quantifies KV per token, and names how to verify.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Parameters','bytes per param','weights','+ KV per token × tokens in flight','fits / OOM','GPUs per replica'])}
${chain(['16 B/param','ZeRO / FSDP','NCCL traffic','multi-GPU topology'])}
<p>Next: ${L('v1-multi-gpu-profiling','multi-GPU communication and profiling')} — what it costs to shard memory across GPUs and how to see it. Then ${L('v1-kv-cache','the KV cache lesson')} in Part 5 zooms into the biggest inference consumer.</p></div>

<h3>Lab</h3>
<p>The planned lab <code>labs/04-gpu/gpu_memory.py</code> implements both budgets (regions <code>train</code> and <code>infer</code>), and <code>labs/11-capacity/kv_cache.py</code> computes KV bytes from a model config. Run them for the Atlas model you fine-tuned in ${L('v1-capstone-train','the capstone')} and compare with the vLLM startup log in ${L('v1-benchmarking','stage 4')}.</p>
`,
  quiz:[
    {q:'Mixed-precision Adam, all parameters trainable: model state for a 7 B-parameter model is approximately…',options:['14 GB','28 GB','112 GB','224 GB'],answer:2,explain:'16 B/param × 7 × 10⁹ = 112 GB (2 weights + 2 grads + 4 master + 4 m + 4 v), before activations. 14 GB is BF16 weights only.'},
    {q:'A training pod restarts with exit code 137 and Reason: OOMKilled. What is the most likely fix?',options:['Set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True','Increase the pod memory limit or reduce host-side memory use when loading','Lower --gpu-memory-utilization','Use FP8 KV cache'],answer:1,explain:'OOMKilled is the kernel’s cgroup killer for host RAM. GPU settings do not affect it.'},
    {q:'The CUDA OOM message reports a large amount of memory “reserved by PyTorch but unallocated”. What does that suggest?',options:['A hardware fault','Fragmentation in the caching allocator','The KV cache is full','A host OOM'],answer:1,explain:'Lots of cached-but-free memory that still cannot satisfy one allocation means fragmented blocks; expandable segments usually help.'},
    {q:'vLLM on one 80 GiB H100, default gpu-memory-utilization 0.92, 8B BF16 model (≈15 GiB), ≈3 GiB overhead. About how much is left for KV?',options:['≈ 65 GiB','≈ 56 GiB','≈ 42 GiB','≈ 18 GiB'],answer:1,explain:'0.92 × 80 = 73.6; 73.6 − 15 − 3 ≈ 55.6 GiB.'},
    {q:'An inference service shows DCGM_FI_DEV_FB_USED at 92 % of the GPU from the moment it starts. What does that tell you?',options:['It is about to OOM','Nothing alarming: the engine pre-allocates its KV pool','There is a memory leak','The model is too big'],answer:1,explain:'Engines claim a fixed fraction at startup. Use the engine’s KV-usage and queue metrics to judge pressure.'},
    {q:'Which statement about the 70B model on 2 × H100 in BF16 is correct?',options:['It cannot load at all','It loads but leaves only ≈ 10 GiB for KV, so only a few long sequences fit','It leaves ≈ 75 GiB for KV','It needs 16 GPUs'],answer:1,explain:'147 GiB budget − 131.5 GiB weights − overhead ≈ 10 GiB of KV ≈ 32k tokens. 16 GPUs is the full-fine-tuning figure.'}
  ],
  flashcards:[
    {front:'Mixed-precision Adam memory per parameter',back:'16 B: 2 (BF16 weights) + 2 (grads) + 4 (FP32 master) + 4 (m) + 4 (v). ZeRO paper. Activations extra.'},
    {front:'Inference memory consumers',back:'Weights, KV cache, activations/workspace, CUDA graphs, CUDA context/libraries, allocator fragmentation.'},
    {front:'GB vs GiB',back:'GB = 10⁹ B; GiB = 2³⁰ B (7.4 % larger). Model sizes in GB; nvidia-smi/DCGM in MiB.'},
    {front:'Three kinds of OOM',back:'Host OOMKilled (pod limit, exit 137); CUDA OOM (PyTorch exception); engine KV exhaustion (queueing/preemption, no crash).'},
    {front:'Fix for allocator fragmentation',back:'PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True; confirm with memory_summary / snapshot (reserved ≫ allocated).'},
    {front:'PyTorch memory snapshot',back:'torch.cuda.memory._record_memory_history(...), reproduce, torch.cuda.memory._dump_snapshot(file), view at pytorch.org/memory_viz.'},
    {front:'8B on one H100 with vLLM: KV room',back:'≈ 0.92 × 80 − 15 − 3 ≈ 55.6 GiB ≈ 455k tokens ≈ 55 × 8k sequences (illustrative overhead).'}
  ]
});
registerGlossary([
  {term:'CUDA OOM',def:'A device-memory allocation failure on the GPU (in PyTorch: torch.OutOfMemoryError), distinct from a host OOMKilled and from an engine’s KV-cache exhaustion.',lesson:'v1-gpu-memory',aliases:['CUDA out of memory']},
  {term:'ZeRO',def:'Zero Redundancy Optimizer (DeepSpeed): shards optimizer state (stage 1), gradients (2) and weights (3) across data-parallel GPUs to cut per-GPU memory.',lesson:'v1-gpu-memory',aliases:['ZeRO-3']},
  {term:'Activation checkpointing',def:'Saving only some forward activations and recomputing the rest during backward, trading compute for memory.',lesson:'v1-gpu-memory',aliases:['gradient checkpointing']},
  {term:'Expandable segments',def:'PyTorch allocator option (PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True) that lets memory segments grow, reducing fragmentation-related OOMs.',lesson:'v1-gpu-memory'},
  {term:'gpu-memory-utilization',def:'vLLM setting (default 0.92 as of v0.31) giving the fraction of GPU memory the engine may use; what remains after weights and activations becomes the KV pool.',lesson:'v1-gpu-memory'}
]);

/* ===================================================================== 1.4.4 */
registerLesson({
  id:'v1-multi-gpu-profiling', vol:1, part:4, num:4,
  title:'PCIe, NVLink, multi-GPU communication and GPU profiling', minutes:85,
  summary:'When a model or a training job needs more than one GPU, the GPUs must exchange data, and the speed of that exchange depends on the path: PCIe inside a server, NVLink between GPUs on the same baseboard, and InfiniBand, RoCE or AWS EFA between servers. NCCL is the library that runs collective operations such as all-reduce over those paths. The second half of the lesson is about seeing what the GPU is really doing. nvidia-smi and DCGM tell you whether the GPU is busy and healthy, the PyTorch profiler tells you which operations cost time, Nsight Systems shows the timeline of the whole program, and Nsight Compute explains a single kernel. GPU utilisation is not efficiency, and choosing the right tool for the question is most of the skill.',
  objectives:[
    'Compare PCIe, NVLink/NVSwitch, InfiniBand, RoCE and EFA by bandwidth, scope and typical use.',
    'Explain NCCL collectives and the ring all-reduce cost 2(N−1)/N × S, and estimate communication time for a gradient all-reduce.',
    'Choose the right parallelism for the available interconnect (tensor parallel inside NVLink, data/pipeline parallel across nodes).',
    'Pick the right tool among nvidia-smi, DCGM, PyTorch profiler, Nsight Systems and Nsight Compute for a given question.',
    'Explain why GPU utilisation differs from SM activity and use the correct DCGM metrics.'
  ],
  prereqs:['v1-gpu-architecture','v1-cuda','v1-gpu-memory'],
  next:['v2-parallelism','v2-distributed-training','v2-distributed-inference','v1-k8s-autoscaling'],
  tags:['gpu','networking','nccl','profiling','observability'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','GPUs on one baseboard connected by NVLink are like microservices on the same host talking over localhost. GPUs in different servers are like services in different availability zones: the network is fast, but an order of magnitude slower and higher latency than local. You design the split of work so the chatty parts stay local. Now the real numbers.')}
<p>Multi-GPU work needs <b>interconnects</b> (the physical paths) and a <b>communication library</b> (${term('NCCL')}, the NVIDIA Collective Communications Library) that runs collective operations over them. Understanding a slow multi-GPU job also needs <b>profiling</b>: tools that measure what each GPU, kernel and link is actually doing.</p>
${table(['Path','Scope','Bandwidth (datasheet)','Used for'],[
 ['PCIe Gen5 x16','CPU ↔ GPU, GPU ↔ NIC, GPU ↔ GPU without NVLink','128 GB/s total (≈64 GB/s each way) — H100 page','Loading weights, data loading, host offload'],
 ['NVLink 4 (H100)','GPU ↔ GPU within a node (through NVSwitch on HGX)','900 GB/s per GPU total (≈450 GB/s each way)','Tensor parallelism, fast all-reduce'],
 ['NVLink 5 (B200)','GPU ↔ GPU within a node / NVL72 rack','1.8 TB/s per GPU','Larger TP and expert-parallel domains'],
 ['InfiniBand (e.g. NDR, 400 Gb/s per port)','Node ↔ node, RDMA','≈50 GB/s per 400 Gb/s port','Multi-node training, disaggregated inference'],
 ['RoCE v2','Node ↔ node, RDMA over Ethernet','Depends on NIC (e.g. 400 GbE)','Same role as InfiniBand on Ethernet fabrics'],
 ['AWS EFA (p5.48xlarge)','Node ↔ node, OS-bypass','3,200 Gbps per node = 400 GB/s ≈ 50 GB/s per GPU','Multi-node training/inference on AWS']
])}
<p>Compare the per-GPU numbers: ≈450 GB/s each way over NVLink versus ≈50 GB/s per GPU across nodes — about <b>9×</b>. That ratio decides which parallelism runs where.</p>

<h2>2. Why do we need it?</h2>
<p>One GPU runs out of either memory or speed. A 70B model in BF16 needs at least two 80 GB GPUs just to load (${L('v1-gpu-memory','memory lesson')}); full fine-tuning of an 8B model needs about 128 GB of optimizer state. Splitting the work creates communication: gradients must be summed across data-parallel workers every step; tensor-parallel shards must exchange partial results in every layer; disaggregated serving moves KV cache from prefill GPUs to decode GPUs. If that communication is slow, adding GPUs adds cost without adding speed.</p>

<h2>3. How does it work internally?</h2>
<h3>Topology inside a node</h3>
<p>On an HGX H100 board, eight GPUs connect to NVSwitch chips, so every GPU reaches every other at full NVLink bandwidth. Each GPU also hangs off a PCIe switch shared with one or more NICs. <b>GPUDirect RDMA</b> lets a NIC read and write GPU memory directly, without bouncing through host RAM. <code>nvidia-smi topo -m</code> prints the matrix: <code>NV18</code> means 18 NVLink links between two GPUs; <code>PIX</code>, <code>PXB</code>, <code>NODE</code>, <code>SYS</code> mean progressively longer PCIe/CPU paths.</p>
${fig('An 8-GPU node and its links', svgDiagram({w:900,h:340,
 zones:[{x:20,y:20,w:860,h:300,label:'One HGX-class server (e.g. p5.48xlarge)'}],
 boxes:[
  {id:'g',x:60,y:60,w:340,h:70,label:'8 × H100',sub:'each 80 GB HBM3',cls:'v2'},
  {id:'nvs',x:60,y:200,w:340,h:60,label:'NVSwitch fabric',sub:'900 GB/s per GPU, all-to-all',cls:'hl'},
  {id:'pcie',x:470,y:60,w:180,h:70,label:'PCIe Gen5 switches',sub:'≈64 GB/s each way'},
  {id:'cpu',x:700,y:60,w:160,h:70,label:'CPUs + RAM',sub:'2 TiB on p5'},
  {id:'nic',x:470,y:200,w:390,h:60,label:'NICs: EFA / InfiniBand / RoCE',sub:'3,200 Gbps per node on p5 → other nodes'}
 ],
 arrows:[{from:'g',to:'nvs',label:'NVLink',both:true},{from:'g',to:'pcie',both:true},{from:'pcie',to:'cpu',both:true},{from:'pcie',to:'nic',label:'GPUDirect RDMA',both:true}]
}), 'Tensor parallelism stays inside the NVSwitch domain. Anything that leaves the node goes GPU → PCIe → NIC → network at roughly a ninth of the NVLink rate per GPU.')}

<h3>NCCL collectives</h3>
${table(['Collective','What it does','Where you see it'],[
 ['All-reduce','Every GPU ends with the sum of all GPUs’ buffers','DDP gradient sync; tensor-parallel layer outputs'],
 ['Reduce-scatter','Sum, but each GPU keeps only its shard','ZeRO/FSDP gradient sharding'],
 ['All-gather','Every GPU receives every shard','ZeRO-3/FSDP gathering weights before a layer'],
 ['Broadcast','One GPU’s buffer copied to all','Initial weights'],
 ['All-to-all','Each GPU sends a different piece to each other GPU','Mixture-of-Experts token routing']
])}
<p>NCCL detects the topology and picks algorithms (ring, tree and others) and transports (NVLink, PCIe, InfiniBand verbs, sockets, and plugins such as the AWS OFI plugin for EFA). In the ring algorithm, an all-reduce of S bytes over N GPUs is a reduce-scatter plus an all-gather, and each GPU sends:</p>
${formula(`
                       2 (N − 1)
bytes sent per GPU =  ─────────── × S        → approaches 2S as N grows
                           N

STEP 1  8B model, BF16 gradients:  S = 8.03 × 10⁹ × 2 B = 16.06 GB,  N = 8
        sent per GPU = 2 × 7/8 × 16.06 GB ≈ 28.1 GB

STEP 2  inside one node over NVLink (≈450 GB/s each way, theoretical)
        t ≥ 28.1 ÷ 450 ≈ 62 ms per step

STEP 3  same data over a ≈50 GB/s-per-GPU inter-node path
        t ≥ 28.1 ÷ 50 ≈ 562 ms per step

ANSWER  Same algorithm, ≈ 9× the communication time. Real runs overlap much of it with the
        backward pass (gradient buckets on a separate stream) and use hierarchical algorithms,
        so measure with nccl-tests; these are lower bounds, not predictions.
`)}
${anim('v1-mgpu-ring')}
<h3>Which parallelism goes on which link</h3>
${table(['Parallelism','Communication pattern','Volume / frequency','Put it on'],[
 ['Tensor parallel (TP)','All-reduce after attention and after MLP, every layer, every token','Small messages, very frequent, on the critical path of every decode step','NVLink inside one node'],
 ['Pipeline parallel (PP)','Point-to-point activations between stages','Moderate, once per stage boundary','Can cross nodes'],
 ['Data parallel (DP / DDP)','All-reduce of all gradients once per step','Large, once per step, overlappable','Within or across nodes'],
 ['ZeRO-3 / FSDP','All-gather weights + reduce-scatter grads per layer','Large and frequent','Fast fabric; across nodes needs good RDMA'],
 ['Expert parallel (MoE)','All-to-all token dispatch','Bursty, per MoE layer','NVLink domain; NVL72 for wide EP']
])}
<p>Decode with TP is especially sensitive: a 70B-shape model does two all-reduces per layer × 80 layers = 160 all-reduces per generated token. Each message is tiny (batch × hidden × 2 bytes), so latency, not bandwidth, dominates. Over NVLink that is affordable; across nodes it usually is not. The deep dive is ${L('v2-parallelism','parallelism strategies')}.</p>

<h3>Profiling: five tools, five questions</h3>
${table(['Tool','Answers the question','Granularity','Typical command / metric'],[
 ['<code>nvidia-smi</code>','Is the GPU present, healthy, how much memory is used, which process holds it, is it throttling?','Device snapshot (sample period 1/6 s to 1 s)','<code>nvidia-smi</code>, <code>nvidia-smi --query-compute-apps=pid,used_memory --format=csv</code>, <code>nvidia-smi topo -m</code>, <code>nvidia-smi -q -d CLOCK,POWER</code>'],
 ['DCGM / dcgm-exporter','How does the fleet behave over time; which nodes have errors?','Per-GPU time series in Prometheus','DCGM_FI_DEV_GPU_UTIL, DCGM_FI_PROF_SM_ACTIVE, DCGM_FI_PROF_PIPE_TENSOR_ACTIVE, DCGM_FI_PROF_DRAM_ACTIVE, DCGM_FI_DEV_FB_USED (MiB), DCGM_FI_DEV_POWER_USAGE, DCGM_FI_DEV_XID_ERRORS'],
 ['PyTorch profiler','Which PyTorch operators and kernels take the time, with what shapes, and how much memory?','Per operator / kernel, inside one process','<code>torch.profiler.profile(...)</code> → table or Chrome/Perfetto trace'],
 ['Nsight Systems (<code>nsys</code>)','Where is the time going across the whole program: CPU threads, CUDA API, kernels, copies, NCCL, gaps, synchronisations?','System-wide timeline','<code>nsys profile -t cuda,nvtx,osrt -o run python train.py</code>'],
 ['Nsight Compute (<code>ncu</code>)','Why is this one kernel slow: memory or compute bound, coalescing, occupancy, stall reasons?','Single kernel, hardware counters, replayed','<code>ncu --set full -k regex:gemm -c 1 -o k python bench.py</code>']
])}
${callout('warn','GPU utilisation is not SM activity','DCGM_FI_DEV_GPU_UTIL (and nvidia-smi “GPU-Util”) is the percent of time at least one kernel was executing. A kernel on 1 of 132 SMs scores 100 %. <b>DCGM_FI_PROF_SM_ACTIVE</b> is “the ratio of cycles an SM has at least 1 warp assigned”, averaged over SMs — that one would read ≈ 0.8 %. <b>DCGM_FI_PROF_PIPE_TENSOR_ACTIVE</b> shows Tensor Core usage, <b>DCGM_FI_PROF_DRAM_ACTIVE</b> memory-interface activity. Note: in dcgm-exporter’s default counter file (release 4.8.4, Sep 2026) SM_ACTIVE and SM_OCCUPANCY are <i>commented out</i>; enable them in your counters CSV if you want them.')}
${code('python',`import torch
from torch.profiler import profile, ProfilerActivity, schedule

with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA],
             schedule=schedule(wait=1, warmup=2, active=3),
             record_shapes=True, profile_memory=True,
             on_trace_ready=torch.profiler.tensorboard_trace_handler('./prof')) as prof:
    for step in range(6):
        train_step()          # your step function
        prof.step()
print(prof.key_averages().table(sort_by='cuda_time_total', row_limit=15))`)}
<p>The schedule skips the first step and warms up for two, exactly the discipline from ${L('v1-cuda','the CUDA lesson')}: never profile the cold start unless the cold start is the question.</p>

<h2>4. Where does it fit?</h2>
<p>Interconnect sits under every multi-GPU design in ${L('v2-distributed-training','distributed training')} and ${L('v2-distributed-inference','distributed inference')}; profiling sits beside everything as your evidence layer. DCGM feeds the same Prometheus/Mimir and Grafana you already run, and drives alerts and autoscaling signals in ${L('v1-k8s-autoscaling','GPU autoscaling and monitoring')}. Nsight tools are for engineers on a single node during an investigation, not for always-on monitoring.</p>

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Kubernetes scheduling</b>: a tensor-parallel pod must get GPUs from the same NVLink domain (one node); multi-node jobs need topology-aware placement (Kueue topology-aware scheduling, ${L('v1-k8s-gpu-stack','GPU stack')}).</li>
<li><b>Network fabric</b>: EFA/InfiniBand devices are exposed to pods by device plugins; NCCL needs them visible and configured, or it silently falls back to TCP sockets.</li>
<li><b>Engines</b>: vLLM <code>-tp</code>/<code>-pp</code>/<code>-dp</code>, SGLang <code>--tp</code>/<code>--dp-size</code>, TensorRT-LLM <code>--tp_size</code>/<code>--pp_size</code> map directly onto these collectives.</li>
<li><b>Observability</b>: DCGM metrics + engine metrics + Nsight traces form a top-down investigation path.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Area','What you own'],[
 ['Instance / node choice','NVLink domain size, NICs per GPU, EFA/IB availability, placement groups or capacity blocks for multi-node jobs'],
 ['NCCL configuration','Plugin versions (e.g. aws-ofi-nccl on EFA), environment such as <code>NCCL_DEBUG=INFO</code> for diagnosis, <code>NCCL_SOCKET_IFNAME</code> for the bootstrap interface; avoid copying tuning variables from blogs without measuring'],
 ['Baseline tests','Run <code>all_reduce_perf</code> from nccl-tests on every new node type and after driver/fabric changes; record bus bandwidth'],
 ['Monitoring','dcgm-exporter with a counter file that includes profiling metrics; dashboards per GPU and per job; alerts on Xid and NVLink errors'],
 ['Profiling access','Nsight tools need permissions for performance counters; plan how engineers can profile in a lab or debug namespace']
])}
${code('bash',`# baseline collective bandwidth on one 8-GPU node (nccl-tests)
./build/all_reduce_perf -b 8 -e 8G -f 2 -g 8
# show NCCL's chosen transports and topology
NCCL_DEBUG=INFO torchrun --nproc_per_node=8 train.py 2>&1 | grep -E "NET|Channel|Using"
# GPU-to-GPU topology
nvidia-smi topo -m`)}
${callout('devops','DevOps bridge','nccl-tests is to a GPU cluster what iperf is to a network: run it on day one, keep the numbers, and rerun after every change. If a training job is slow and all_reduce_perf bus bandwidth on those nodes is half of your baseline, you have found your incident before anyone opens a profiler.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Multi-node training 5–10× slower than expected','NCCL fell back to TCP sockets (EFA/IB not visible in the pod)','NCCL_DEBUG=INFO shows NET/Socket instead of the RDMA/OFI transport','Expose devices via the device plugin, install the right plugin, check security groups / placement'],
 ['Job hangs at first collective','Rank cannot reach peers; wrong interface; firewall','Hang with no error; NCCL debug output stops at bootstrap','Set NCCL_SOCKET_IFNAME; open ports; same NCCL versions on all ranks'],
 ['Hang mid-training on one rank','A rank crashed or is stuck; collective waits forever','One GPU at 0 % while others spin at 100 %','Use NCCL timeouts/watchdog; check the stuck rank’s logs and Xids'],
 ['TP inference slow on a new node type','GPUs connected over PCIe, not NVLink','<code>nvidia-smi topo -m</code> shows PIX/SYS not NV#','Use NVLink nodes for TP, or switch to data parallel'],
 ['Xid 74 in logs','NVLink error','DCGM_FI_DEV_XID_ERRORS = 74','Follow the NVIDIA Xid catalog workflow; drain node; contact support if repeated'],
 ['GPU util 100 % but tokens/s low','Few SMs busy, launch-bound or memory-bound','SM_ACTIVE, TENSOR_ACTIVE, DRAM_ACTIVE; Nsight Systems gaps','Batch more, CUDA graphs, fuse kernels; do not scale out yet']
])}
<div class="dtree"><ul><li><span class="q">“The GPU job is slow.” Which tool first?</span><ul>
<li><span class="a">fleet-wide or one node?</span>DCGM dashboards: compare this node’s SM/tensor/DRAM activity and Xids with its peers.</li>
<li><span class="a">is the GPU waiting?</span>Nsight Systems timeline: gaps between kernels = CPU, data loader, launch overhead or synchronisation; long NCCL ranges = communication.</li>
<li><span class="a">which op?</span>PyTorch profiler sorted by CUDA time.</li>
<li><span class="a">why is that kernel slow?</span>Nsight Compute: roofline position, achieved bandwidth, occupancy, stall reasons.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<ol>
<li>Keep the most frequent communication on the fastest link: TP within NVLink, DP/PP across nodes.</li>
<li>Overlap communication with computation (DDP gradient buckets, FSDP prefetch) and verify the overlap in Nsight Systems.</li>
<li>Reduce bytes: BF16 or FP8 communication, gradient accumulation (fewer all-reduces per sample), sharding only as far as memory requires.</li>
<li>Use topology-aware scheduling so a job’s ranks sit in the same rack/block of the fabric.</li>
<li>For inference, prefer more independent replicas over wider TP when the model fits; replicas scale linearly with no collectives.</li>
</ol>

<h2>9. How do we optimize its cost?</h2>
<p>Every millisecond a GPU spends waiting for a collective is paid compute time. For the example above, 562 ms of unhidden all-reduce on a step that computes for 1 s means ≈36 % of the bill is waiting. Fixes are often configuration, not hardware: get RDMA working, raise the micro-batch so compute hides communication, or choose instance types whose NVLink domain fits the job. Conversely, do not buy InfiniBand-class networking for inference fleets that only run independent single-node replicas.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“A dashboard shows 100 % GPU utilisation, but throughput is poor. What do you do?”','<p><i>Answer (≈50 s):</i> “GPU utilisation only says some kernel was running during the sample period — one tiny kernel on one SM counts as 100 %. So I look at the profiling metrics: SM active, tensor-pipe active and DRAM active from DCGM, which I enable in the exporter’s counter file. Low SM active means not enough parallel work or launch overhead; high DRAM with low tensor activity means memory-bound decode, so I batch more or quantise. Then I take an Nsight Systems trace to see gaps between kernels and long NCCL ranges, and only for a specific hot kernel do I go to Nsight Compute. For multi-GPU jobs I also check NCCL is using NVLink or RDMA rather than falling back to sockets.”</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>“100 % utilisation means the GPU is maxed out; we need more GPUs.”</p></div><div class="good"><h4>Strong answer</h4><p>Defines the metric precisely, names the better metrics, and walks the tool ladder from fleet to kernel.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Model too big','sharding','NCCL collectives','NVLink / RDMA','step time','cost'])}
${chain(['DCGM','Nsight Systems','PyTorch profiler','Nsight Compute','root cause'])}
<p>Next in Volume 1: ${L('v1-inference-anatomy','the anatomy of inference')}. Deeper in Volume 2: ${L('v2-parallelism','parallelism and MoE')}, ${L('v2-distributed-training','NCCL, RDMA, FSDP and ZeRO at scale')}, and ${L('v2-distributed-inference','disaggregated inference and KV transfer')}.</p></div>

<h3>Lab</h3>
<p>The planned lab <code>labs/04-gpu/profile_matmul.py</code> (region <code>profiler</code>) wraps a small training step in the PyTorch profiler and exports a trace you can open in Perfetto. On a multi-GPU machine, add a baseline <code>all_reduce_perf</code> run and save the bus-bandwidth table with the node type and driver version.</p>
`,
  quiz:[
    {q:'Ring all-reduce of S bytes over N GPUs: how much does each GPU send?',options:['S','S/N','2(N−1)/N × S','N × S'],answer:2,explain:'Reduce-scatter sends (N−1)/N × S, all-gather sends the same again. For N = 8, 1.75 S.'},
    {q:'Where should tensor parallelism of a 70B model run?',options:['Across nodes over Ethernet','Within one NVLink/NVSwitch domain','Over PCIe between nodes','It does not need communication'],answer:1,explain:'TP all-reduces twice per layer per token: small, frequent, latency-critical messages that need NVLink.'},
    {q:'Which metric best shows how much of the GPU’s SMs are doing work?',options:['DCGM_FI_DEV_GPU_UTIL','DCGM_FI_PROF_SM_ACTIVE','DCGM_FI_DEV_FB_USED','DCGM_FI_DEV_POWER_USAGE'],answer:1,explain:'GPU_UTIL is time with any kernel running. SM_ACTIVE averages the fraction of cycles each SM has a warp assigned. It is disabled in the exporter’s default counter file and must be enabled.'},
    {q:'A multi-node job is much slower than expected and NCCL_DEBUG=INFO shows NET/Socket. Most likely cause?',options:['Too many GPUs','RDMA devices (EFA/IB) not available to NCCL, so it uses TCP','HBM too small','CUDA graphs disabled'],answer:1,explain:'NCCL falls back to sockets when the RDMA transport or plugin is missing.'},
    {q:'You need to know why one specific GEMM kernel reaches only 30 % of peak. Which tool?',options:['nvidia-smi','DCGM','Nsight Systems','Nsight Compute'],answer:3,explain:'Nsight Compute profiles a single kernel with hardware counters (roofline, occupancy, stalls). Nsight Systems shows the timeline around it.'}
  ],
  flashcards:[
    {front:'H100 link bandwidths',back:'NVLink 900 GB/s per GPU total (≈450/dir); PCIe Gen5 x16 128 GB/s total (≈64/dir); p5 EFA 3,200 Gbps/node ≈ 50 GB/s per GPU.'},
    {front:'Ring all-reduce bytes per GPU',back:'2(N−1)/N × S. 8 GPUs, 16.06 GB grads → ≈28.1 GB each.'},
    {front:'Five profiling tools',back:'nvidia-smi (device snapshot), DCGM (fleet time series), PyTorch profiler (ops/kernels), Nsight Systems (timeline), Nsight Compute (one kernel).'},
    {front:'GPU util vs SM active',back:'GPU util = % time ≥1 kernel running. SM active = avg fraction of cycles SMs have a warp. One tiny kernel: 100 % vs <1 %.'},
    {front:'TP vs DP placement',back:'TP inside NVLink (frequent small all-reduces); DP/PP can cross nodes.'},
    {front:'GPUDirect RDMA',back:'NIC reads/writes GPU memory directly, skipping host RAM.'},
    {front:'First test on a new GPU node type',back:'nccl-tests all_reduce_perf baseline + nvidia-smi topo -m; keep the numbers.'}
  ]
});
registerGlossary([
  {term:'NCCL',def:'NVIDIA Collective Communications Library: topology-aware all-reduce, all-gather, reduce-scatter, broadcast and all-to-all over NVLink, PCIe and RDMA networks.',lesson:'v1-multi-gpu-profiling'},
  {term:'NVLink',def:'NVIDIA’s GPU-to-GPU interconnect (900 GB/s per H100, 1.8 TB/s per B200), switched by NVSwitch within a node or rack.',lesson:'v1-multi-gpu-profiling',aliases:['NVSwitch']},
  {term:'PCIe',def:'The general host bus connecting CPU, GPUs and NICs; Gen5 x16 gives 128 GB/s total.',lesson:'v1-multi-gpu-profiling'},
  {term:'InfiniBand',def:'Low-latency RDMA network fabric commonly used between GPU nodes for training and distributed inference.',lesson:'v1-multi-gpu-profiling'},
  {term:'RoCE',def:'RDMA over Converged Ethernet (v2: routable over UDP/IP), giving InfiniBand-style RDMA on Ethernet fabrics.',lesson:'v1-multi-gpu-profiling'},
  {term:'GPUDirect RDMA',def:'Direct data path between a network adapter and GPU memory that bypasses host memory.',lesson:'v1-multi-gpu-profiling'},
  {term:'All-reduce',def:'Collective in which every participant ends with the reduction (usually sum) of all participants’ buffers.',lesson:'v1-multi-gpu-profiling'},
  {term:'DCGM',def:'NVIDIA Data Center GPU Manager; dcgm-exporter publishes GPU health and profiling metrics (e.g. DCGM_FI_PROF_SM_ACTIVE) to Prometheus.',lesson:'v1-multi-gpu-profiling',aliases:['dcgm-exporter']},
  {term:'Nsight Systems',def:'NVIDIA system-wide timeline profiler (nsys) showing CPU threads, CUDA API calls, kernels, copies and NCCL.',lesson:'v1-multi-gpu-profiling',aliases:['nsys']},
  {term:'Nsight Compute',def:'NVIDIA kernel profiler (ncu) that analyses a single kernel with hardware counters: roofline, occupancy, memory throughput, stall reasons.',lesson:'v1-multi-gpu-profiling',aliases:['ncu']},
  {term:'SM active',def:'DCGM profiling metric DCGM_FI_PROF_SM_ACTIVE: fraction of cycles an SM has at least one warp assigned, averaged over SMs.',lesson:'v1-multi-gpu-profiling'}
]);
