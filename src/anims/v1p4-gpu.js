/* Animations for Volume 1, Part 4 (GPU fundamentals) */

/* ---------- Roofline: points moving between memory-bound and compute-bound ---------- */
Anim.register({
  id:'v1-gpu-roofline', title:'Roofline: why decode is memory-bound and prefill is compute-bound (H100 SXM, dense)', w:960, h:430,
  elements:[
    {type:'chart', id:'ch', x:90, y:40, w:520, h:300, xmax:1400, ymax:2100, xlabel:'arithmetic intensity (FLOP per byte from HBM)', ylabel:'attainable TFLOPS',
     series:[
      {id:'roof', label:'BF16 roof (989.5 TF dense)', points:[[0,0],[295.4,989.5],[1400,989.5]]},
      {id:'fp8', label:'FP8 roof (≈1,979 TF dense)', color:'var(--v2)', points:[]},
      {id:'pt', label:'workload point', color:'var(--bad)', points:[]}
     ]},
    {type:'label', id:'ridge', x:330, y:150, text:'ridge ≈ 295 FLOP/B', hidden:true},
    {type:'label', id:'mem', x:100, y:415, text:'← memory-bound region: limited by 3.35 TB/s', hidden:true},
    {type:'counter', id:'wl', x:650, y:50, label:'Workload', value:'—'},
    {type:'counter', id:'ai', x:650, y:120, label:'Arithmetic intensity', value:'—'},
    {type:'counter', id:'att', x:650, y:190, label:'Attainable (roofline ceiling)', value:'—'},
    {type:'counter', id:'bound', x:650, y:260, label:'Limited by', value:'—'},
    {type:'label', id:'eq', x:650, y:350, text:'attainable = min(peak FLOPS, AI × bandwidth)'}
  ],
  steps:[
    {caption:'The <b>roofline</b> plots how many FLOP/s a kernel can reach against its <b>arithmetic intensity</b> (AI): FLOPs done per byte read from HBM. The sloped part is bandwidth × AI (3.35 TB/s on an H100 SXM). The flat roof is the dense BF16 Tensor Core peak, 989.5 TFLOPS. NVIDIA’s headline 1,979 is <i>with 2:4 sparsity</i>; dense is half.', hl:['ch'], dur:5200},
    {caption:'Where slope meets roof is the <b>ridge point</b>: 989.5 × 10¹² ÷ 3.35 × 10¹² ≈ <b>295 FLOP/byte</b>. A kernel below 295 cannot reach peak no matter how good the code is; it waits on memory.', show:['ridge'], set:{ai:{value:'ridge = 295 FLOP/B'}}, dur:4600},
    {caption:'<b>Decode, batch 1.</b> One token multiplies a 4096×14336 BF16 weight matrix (117 MB) by one vector: 117 M FLOPs for 117 MB read → AI ≈ <b>1</b>. Ceiling = 1 × 3.35 TB/s = 3.35 TFLOPS, about <b>0.3 %</b> of the roof. The point hugs the left axis.', show:['mem'], set:{ch:{pt:[[1,0],[1,3.35]]}, wl:{value:'decode GEMV, batch 1'}, ai:{value:'≈ 1.0 FLOP/B'}, att:{value:'3.35 TFLOPS (0.3 % of peak)'}, bound:{value:'HBM bandwidth'}}, bad:['bound'], dur:5200},
    {caption:'<b>Decode, batch 64.</b> The same weights now serve 64 sequences per read. FLOPs grow 64×, bytes barely change → AI ≈ <b>63</b>. Ceiling ≈ 210 TFLOPS. This is why batching is the main throughput lever for decode.', set:{ch:{pt:[[62.7,0],[62.7,210]]}, wl:{value:'decode, batch 64'}, ai:{value:'≈ 63 FLOP/B'}, att:{value:'≈ 210 TFLOPS (21 %)'}, bound:{value:'HBM bandwidth'}}, warn:['bound'], dur:4800},
    {caption:'<b>Decode, batch 256.</b> AI ≈ 237, ceiling ≈ 794 TFLOPS — close to the ridge. But note: this counts weights only. Each sequence also reads its <i>own</i> KV cache, which is never shared, so attention keeps AI ≈ 1 for that part. Real decode stays memory-bound longer than this picture suggests.', set:{ch:{pt:[[237,0],[237,794]]}, wl:{value:'decode, batch 256 (weights only)'}, ai:{value:'≈ 237 FLOP/B'}, att:{value:'≈ 794 TFLOPS (80 %)'}, bound:{value:'bandwidth, nearing ridge'}}, warn:['bound'], dur:5200},
    {caption:'<b>Prefill, 2,048 prompt tokens.</b> Now it is a GEMM: 240.5 GFLOP for 193 MB moved → AI ≈ <b>1,247</b>, far right of the ridge. Ceiling = the roof, 989.5 TFLOPS. Prefill is <b>compute-bound</b>: more bandwidth would not help; more FLOPS would.', set:{ch:{pt:[[1246.6,0],[1246.6,989.5]]}, wl:{value:'prefill GEMM, 2,048 tokens'}, ai:{value:'≈ 1,247 FLOP/B'}, att:{value:'989.5 TFLOPS (roof)'}, bound:{value:'Tensor Core FLOPS'}}, ok:['bound'], dur:5000},
    {caption:'<b>Lower precision raises both limits.</b> FP8 Tensor Cores double the dense roof (≈1,979 TFLOPS) and halve the bytes per weight. Prefill gets up to 2× more compute; decode moves half the bytes, so its time per token roughly halves. The ridge moves to ≈ 591 FLOP/B.', set:{ch:{fp8:[[0,0],[590.7,1979],[1400,1979]]}, wl:{value:'same model, FP8 weights'}, ai:{value:'ridge ≈ 591 FLOP/B'}, att:{value:'roof ≈ 1,979 TFLOPS dense'}, bound:{value:'depends on side of ridge'}}, hl:['ch'], dur:5000},
    {caption:'Real kernels sit <b>below</b> the roof (launch overhead, imperfect tiling, power and clock limits). The roofline gives a ceiling and tells you which lever matters: <b>memory-bound → move fewer bytes</b> (batch, quantize, FP8 KV); <b>compute-bound → do cheaper math</b> (FP8/FP4 Tensor Cores, better kernels, more GPUs).', set:{wl:{value:'rule of thumb'}, ai:{value:'below ridge? cut bytes'}, att:{value:'above ridge? cut FLOP cost'}, bound:{value:'measure with Nsight Compute'}}, dur:5200}
  ]
});

/* ---------- Memory hierarchy data movement ---------- */
Anim.register({
  id:'v1-gpu-memhier', title:'Memory hierarchy: data moves inward, gets reused, results move out', w:960, h:430,
  elements:[
    {type:'zone', id:'smz', x:570, y:70, w:375, h:250, label:'One SM (H100 SXM has 132)'},
    {type:'node', id:'host', x:20, y:170, w:130, h:64, label:'Host RAM', sub:'CPU DDR', icon:'server'},
    {type:'node', id:'hbm', x:195, y:170, w:150, h:64, label:'HBM3', sub:'80 GB · 3.35 TB/s', icon:'memory', cls:'v2'},
    {type:'node', id:'l2', x:390, y:170, w:140, h:64, label:'L2 cache', sub:'50 MB, all SMs'},
    {type:'node', id:'smem', x:590, y:100, w:170, h:60, label:'Shared mem / L1', sub:'up to 228 KB / SM'},
    {type:'node', id:'regs', x:590, y:240, w:170, h:60, label:'Registers', sub:'256 KB / SM'},
    {type:'node', id:'tc', x:790, y:170, w:140, h:64, label:'Tensor Cores', sub:'4 per SM', icon:'bolt', cls:'hl'},
    {type:'edge', id:'e0', from:'host', to:'hbm', label:'PCIe'},
    {type:'edge', id:'e1', from:'hbm', to:'l2'},
    {type:'edge', id:'e2', from:'l2', to:'smem'},
    {type:'edge', id:'e3', from:'smem', to:'regs', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'e4', from:'regs', to:'tc'},
    {type:'bar', id:'bw', x:40, y:290, w:300, h:20, label:'HBM bandwidth in use', value:0},
    {type:'bar', id:'tcb', x:40, y:360, w:300, h:20, label:'Tensor Core busy', value:0, thresholds:false},
    {type:'counter', id:'reuse', x:400, y:350, label:'Reuse per byte loaded from HBM', value:'—'}
  ],
  steps:[
    {caption:'At startup the weights are copied <b>once</b> from host RAM to HBM over PCIe (Gen5 x16: 128 GB/s total, ≈64 GB/s each way). After that, nothing should cross PCIe on the hot path.', packets:[{edge:'e0',label:'weights',count:3,cls:'c-purple'}], hl:['host','hbm'], dur:4500},
    {caption:'A matrix-multiply kernel loads a <b>tile</b> of A and a tile of B (say 128×64 BF16 = 16 KB each) from HBM, through L2, into the SM’s <b>shared memory</b>. HBM is large but far: each access costs hundreds of clock cycles of latency.', packets:[{edge:'e1',label:'tile',cls:'c-blue'},{edge:'e2',label:'tile',delay:500,cls:'c-blue'}], set:{bw:{value:.5,text:'loading tiles'}}, hl:['l2','smem'], dur:4800},
    {caption:'Threads copy fragments from shared memory into <b>registers</b>, and Tensor Cores run matrix-multiply-accumulate on them. Shared memory and registers are on-chip: tens of cycles and about one cycle away.', packets:[{edge:'e3',label:'frag',cls:'c-blue'},{edge:'e4',label:'MMA',delay:400,cls:'c-ok'}], set:{tcb:{value:.85,text:'busy'}}, hl:['regs','tc'], dur:4500},
    {caption:'The key idea is <b>reuse</b>. Each element of the A tile is multiplied against all 128 columns of the B tile while it sits on-chip. One HBM read feeds ~128 multiply-adds. High reuse = high arithmetic intensity = compute-bound.', set:{reuse:{value:'≈ 128 multiply-adds per element (GEMM tile)'}, bw:{value:.35,text:'35 % — not the limit'}, tcb:{value:.9,text:'90 % busy'}}, ok:['tc'], dur:5000},
    {caption:'Results accumulate in registers and are written back to HBM <b>once</b> per output tile, not once per multiply.', packets:[{edge:'e4',reverse:true,label:'C',cls:'c-ok'},{edge:'e2',reverse:true,label:'C',delay:400,cls:'c-ok'},{edge:'e1',reverse:true,label:'C',delay:800,cls:'c-ok'}], dur:4200},
    {caption:'<b>Decode (GEMV) is different.</b> With batch 1, each weight is used for exactly one multiply-add and then discarded. Reuse ≈ 1. The Tensor Cores starve while HBM runs flat out: memory-bound.', set:{reuse:{value:'≈ 1 multiply-add per weight (batch 1)'}, bw:{value:.95,text:'≈ 95 % — the limit'}, tcb:{value:.05,text:'≈ 5 % busy'}}, packets:[{edge:'e1',count:4,gap:180,cls:'c-purple'},{edge:'e2',count:4,gap:180,delay:300,cls:'c-purple'}], warn:['hbm'], dur:5200},
    {caption:'If data had to come from host RAM each step (CPU offload, or a model that does not fit), the pipe shrinks from 3.35 TB/s to ≈64 GB/s each way: about <b>52× slower</b>. That is why “it fits if we offload” often means “it is unusably slow”.', packets:[{edge:'e0',count:2,gap:500,cls:'c-bad'}], bad:['host'], set:{bw:{value:.02,text:'PCIe-limited'}, tcb:{value:.01,text:'≈ idle'}}, dur:5000},
    {caption:'Summary: registers → shared memory/L1 → L2 → HBM → host RAM. Each step outward is bigger and slower. Fast kernels (FlashAttention, tiled GEMM) are mostly about keeping data in the inner rings and touching HBM as few times as possible.', hl:['smem','regs','l2'], dur:5000}
  ]
});

/* ---------- SIMT: warps executing a kernel across SMs ---------- */
Anim.register({
  id:'v1-cuda-simt', title:'SIMT: vector_add<<<4, 256>>> for n = 1,000 across SMs and warps', w:960, h:430,
  elements:[
    {type:'label', id:'launch', x:40, y:28, text:'Host: vector_add<<<blocks = 4, threads = 256>>>(a, b, c, n = 1000)'},
    {type:'node', id:'b0', x:40, y:60, w:170, h:48, label:'Block 0', sub:'i = 0 … 255'},
    {type:'node', id:'b1', x:40, y:120, w:170, h:48, label:'Block 1', sub:'i = 256 … 511'},
    {type:'node', id:'b2', x:40, y:180, w:170, h:48, label:'Block 2', sub:'i = 512 … 767'},
    {type:'node', id:'b3', x:40, y:240, w:170, h:48, label:'Block 3', sub:'i = 768 … 1023'},
    {type:'zone', id:'sm0', x:300, y:50, w:290, h:250, label:'SM 0'},
    {type:'zone', id:'sm1', x:640, y:50, w:290, h:250, label:'SM 1'},
    {type:'node', id:'s0a', x:320, y:80, w:250, h:70, label:'Block 0 → 8 warps', sub:'warp scheduler issues 1 instr / 32 lanes', hidden:true},
    {type:'node', id:'s0b', x:320, y:200, w:250, h:70, label:'Block 2 → 8 warps', sub:'resident at the same time', hidden:true},
    {type:'node', id:'s1a', x:660, y:80, w:250, h:70, label:'Block 1 → 8 warps', sub:'', hidden:true},
    {type:'node', id:'s1b', x:660, y:200, w:250, h:70, label:'Block 3 → 8 warps', sub:'last warp partly masked', hidden:true},
    {type:'edge', id:'eb0', from:'b0', to:'s0a'},
    {type:'edge', id:'eb1', from:'b1', to:'s1a'},
    {type:'edge', id:'eb2', from:'b2', to:'s0b'},
    {type:'edge', id:'eb3', from:'b3', to:'s1b'},
    {type:'grid', id:'lanes', x:170, y:340, rows:1, cols:32, cell:22, rowLabels:['lanes'], values:[[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]},
    {type:'counter', id:'idx', x:170, y:380, label:'Index arithmetic', value:'i = blockIdx.x × blockDim.x + threadIdx.x'}
  ],
  steps:[
    {caption:'The host launches the kernel with a <b>grid</b> of 4 <b>blocks</b> × 256 <b>threads</b> = 1,024 threads for 1,000 elements. Blocks = ⌈1000 ÷ 256⌉ = 4. The launch call returns to the CPU immediately; the GPU runs it later.', hl:['launch','b0','b1','b2','b3'], dur:5000},
    {caption:'The hardware block scheduler places blocks on <b>streaming multiprocessors (SMs)</b>. Block 0 → SM 0, Block 1 → SM 1. A block never splits across SMs, so its threads can share on-chip memory and synchronise.', show:['s0a','s1a'], packets:[{edge:'eb0',label:'B0'},{edge:'eb1',label:'B1'}], dur:4600},
    {caption:'Blocks 2 and 3 land too (an SM can hold several blocks at once, up to 2,048 resident threads on H100). Blocks are independent: CUDA guarantees no order between them. On a 132-SM H100, this tiny grid uses only 4 SMs (with this placement, just 2 of them).', show:['s0b','s1b'], packets:[{edge:'eb2',label:'B2'},{edge:'eb3',label:'B3'}], dur:5000},
    {caption:'Inside an SM, each block of 256 threads is cut into <b>8 warps of 32</b>. A warp is the unit that executes: the scheduler issues one instruction and all 32 lanes run it together on different data. NVIDIA calls this <b>SIMT</b>. Below: warp 0 of block 0, all 32 lanes active (i = 0…31).', set:{lanes:{values:[[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]]}}, hl:['s0a','lanes'], dur:5000},
    {caption:'Every thread computes its own global index. Thread 37 of block 2: i = 2 × 256 + 37 = <b>549</b>, so it adds a[549] + b[549]. Consecutive threads touch consecutive addresses, which lets the warp’s loads <b>coalesce</b> into a few wide memory transactions.', set:{idx:{value:'block 2, thread 37 → i = 2 × 256 + 37 = 549'}}, hl:['s0b','idx'], dur:5000},
    {caption:'Now the last warp of block 3 (threads 224–255, i = 992…1023). The guard <code>if (i &lt; n)</code> is true only for i = 992…999: <b>8 lanes work, 24 are masked off</b>. Without the guard, those 24 threads would write past the end of c[] — the classic “wrong only when n is not a multiple of 256” bug.', set:{lanes:{values:[[1,1,1,1,1,1,1,1,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12,.12]]}, idx:{value:'block 3, warp 7 → i = 992…1023; only 992…999 < 1000'}}, warn:['s1b'], dur:5600},
    {caption:'<b>Latency hiding.</b> A warp that issues a global-memory load waits hundreds of cycles. The scheduler switches to another ready warp at zero cost (each warp keeps its own registers). Many resident warps per SM keep the pipelines fed. That is the GPU’s answer to the CPU’s big caches.', busy:['s0a','s1a'], hl:['s0b','s1b'], dur:5200},
    {caption:'Totals: 4 blocks, 32 warps, 1,024 threads; 1,000 do useful work, 24 (2.3 %) are masked. The lesson for operators: a kernel can be “running” (nvidia-smi shows 100 % utilisation) while using a handful of the 132 SMs.', set:{idx:{value:'4 blocks · 32 warps · 1,024 threads · 24 masked'}}, ok:['b0','b1','b2','b3'], dur:5200}
  ]
});

/* ---------- Async launch, synchronisation, streams and CUDA graphs ---------- */
Anim.register({
  id:'v1-cuda-async', title:'Asynchronous launch: why naive timing lies, and what streams and CUDA graphs change', w:960, h:420,
  elements:[
    {type:'timeline', id:'tl', x:30, y:50, w:900, h:150, labelW:120, cols:16, ticks:true, rows:[{id:'cpu',label:'CPU thread'},{id:'s0',label:'GPU stream 0'},{id:'s1',label:'GPU stream 1'}]},
    {type:'counter', id:'naive', x:40, y:250, label:'time.time() around the launches', value:'—'},
    {type:'counter', id:'real', x:360, y:250, label:'True GPU time (CUDA events + sync)', value:'—'},
    {type:'counter', id:'note', x:680, y:250, label:'What changed', value:'—'},
    {type:'label', id:'lg', x:40, y:340, text:'Each column ≈ 10 µs (illustrative). Purple = launch / copy, blue = kernel running, amber = CPU blocked waiting.'}
  ],
  steps:[
    {caption:'The CPU <b>launches</b> three kernels (K1, K2, K3). Each launch only enqueues work on a stream and returns after a few microseconds. The GPU has not finished — or maybe even started — K1 when the CPU moves on.', set:{tl:{cells:[{row:'cpu',col:0,cls:'pre',text:'L1'},{row:'cpu',col:1,cls:'pre',text:'L2'},{row:'cpu',col:2,cls:'pre',text:'L3'}]}}, dur:4800},
    {caption:'The GPU executes K1, K2, K3 in order on stream 0. Work on one stream is always serialised in launch order.', set:{tl:{cells:[{row:'s0',col:1,cls:'dec',text:'K1',span:4},{row:'s0',col:5,cls:'dec',text:'K2',span:4},{row:'s0',col:9,cls:'dec',text:'K3',span:4}]}}, dur:4500},
    {caption:'Timing with <code>time.time()</code> before and after the three launches measures only the CPU part: ≈30 µs. The kernels actually ran for ≈120 µs. This is the most common benchmarking mistake in GPU code.', set:{naive:{value:'≈ 30 µs  (wrong)'}}, bad:['naive'], dur:4800},
    {caption:'Fix: record CUDA events around the work and call <code>torch.cuda.synchronize()</code> (or <code>event.synchronize()</code>) before reading the clock. The CPU now blocks until stream 0 drains, and the measurement covers the real GPU time.', set:{tl:{cells:[{row:'cpu',col:3,cls:'wait',text:'synchronize',span:10}]}, real:{value:'≈ 120 µs  (correct)'}}, ok:['real'], dur:5200},
    {caption:'<b>Streams</b> allow overlap. Put the next batch’s host-to-device copy on stream 1: it runs while K2 and K3 compute on stream 0. Different streams have no ordering unless you add events. Data loaders and NCCL use this to hide copies and communication behind compute.', set:{tl:{cells:[{row:'s1',col:5,cls:'pre',text:'H2D copy (next batch)',span:6}]}, note:{value:'copy hidden behind compute'}}, hl:['tl'], dur:5200},
    {caption:'Small kernels are <b>launch-bound</b>: if a decode step launches hundreds of tiny kernels, the GPU idles in the gaps while the CPU issues them. Gaps between K1, K2, K3 would be visible in an Nsight Systems trace.', set:{note:{value:'launch overhead dominates small kernels'}}, warn:['tl'], dur:4600},
    {caption:'<b>CUDA graphs</b> record a fixed sequence of launches once and replay the whole sequence with a single launch. CPU overhead per step collapses. vLLM and TensorRT-LLM capture graphs for decode batch sizes at startup — one reason startup takes longer and uses extra memory.', set:{tl:{cells:[{row:'cpu',col:0,cls:'pre',text:'graph launch',span:2},{row:'cpu',col:1},{row:'cpu',col:2}]}, note:{value:'1 launch replays K1→K2→K3'}}, ok:['note'], dur:5400}
  ]
});

/* ---------- Training memory stack vs one GPU ---------- */
Anim.register({
  id:'v1-gpumem-train', title:'Full fine-tuning an 8B model: where 16 bytes per parameter go', w:960, h:420,
  elements:[
    {type:'mem', id:'card', x:40, y:70, w:880, h:46, label:'One H100: 80 GiB ≈ 85.9 GB of HBM', segs:[{frac:1,cls:'free',label:'free'}]},
    {type:'counter', id:'need', x:40, y:150, label:'Needed (GB) — 8.03 B params', value:'0'},
    {type:'counter', id:'rule', x:400, y:150, label:'Bytes per parameter so far', value:'0'},
    {type:'node', id:'verdict', x:720, y:140, w:200, h:56, label:'fits', sub:'', cls:'x'},
    {type:'mem', id:'shard', x:40, y:280, w:880, h:40, label:'Per GPU with ZeRO-3 / FSDP over 8 GPUs', segs:[{frac:1,cls:'free',label:'not used yet'}]},
    {type:'counter', id:'alt', x:40, y:350, label:'Alternative', value:'—'}
  ],
  steps:[
    {caption:'Goal: full fine-tune of an 8-billion-parameter model (Llama-3.1-8B shape, 8.03 B params) with mixed-precision Adam on one 80 GiB GPU. Start with an empty card.', dur:4000},
    {caption:'<b>Weights in BF16</b>: 8.03 × 10⁹ × 2 B = 16.1 GB. This alone is what inference needs for weights.', set:{card:{segs:[{frac:.187,cls:'w',label:'weights 16.1'},{frac:.813,cls:'free',label:'free'}]}, need:{value:'16.1 GB'}, rule:{value:'2 B'}}, dur:4200},
    {caption:'<b>Gradients in BF16</b>: one gradient per trainable parameter, another 16.1 GB.', set:{card:{segs:[{frac:.187,cls:'w',label:'weights'},{frac:.187,cls:'grad',label:'grads 16.1'},{frac:.626,cls:'free',label:'free'}]}, need:{value:'32.1 GB'}, rule:{value:'2 + 2 = 4 B'}}, dur:4200},
    {caption:'<b>FP32 master weights</b>: mixed precision keeps a full-precision copy for the update step so tiny updates are not rounded away: 4 B/param = 32.1 GB.', set:{card:{segs:[{frac:.187,cls:'w',label:'weights'},{frac:.187,cls:'grad',label:'grads'},{frac:.374,cls:'opt',label:'FP32 master 32.1'},{frac:.252,cls:'free',label:'free'}]}, need:{value:'64.2 GB'}, rule:{value:'4 + 4 = 8 B'}}, dur:4600},
    {caption:'<b>Adam moments</b> m and v in FP32: 8 B/param = 64.2 GB more. Total model state = <b>16 B/param = 128.5 GB</b> (the ZeRO paper’s 2 + 2 + 12). It does not fit in 85.9 GB — and we have not counted a single activation yet.', set:{card:{segs:[{frac:.187,cls:'w',label:'weights'},{frac:.187,cls:'grad',label:'grads'},{frac:.374,cls:'opt',label:'master'},{frac:.252,cls:'frag',label:'Adam m,v → overflow'}]}, need:{value:'128.5 GB + activations'}, rule:{value:'16 B'}, verdict:{label:'CUDA OOM'}}, bad:['verdict','card'], dur:5600},
    {caption:'<b>Activations</b> saved for the backward pass scale with batch × sequence × hidden × layers. A rough GPT-style estimate for 4,096 tokens on this shape is ≈18 GB without recomputation, ≈1 GB of saved layer inputs with full activation checkpointing (plus one layer recomputed at a time). Illustrative — measure yours.', set:{need:{value:'≈ 129.5–146.5 GB'}}, bad:['verdict'], dur:5400},
    {caption:'<b>Shard it.</b> ZeRO-3 / FSDP splits weights, gradients and optimizer state across 8 GPUs: 128.5 ÷ 8 ≈ 16.1 GB per GPU, plus that GPU’s own activations and communication buffers. Now it fits — at the price of all-gather and reduce-scatter traffic every step.', set:{shard:{segs:[{frac:.187,cls:'opt',label:'1/8 of states 16.1'},{frac:.12,cls:'act',label:'activations'},{frac:.05,cls:'frag',label:'buffers'},{frac:.643,cls:'free',label:'free'}]}, verdict:{label:'fits when sharded'}}, ok:['verdict'], dur:5400},
    {caption:'<b>Or train less.</b> LoRA rank 16 on all linear layers of this shape adds ≈ 41.9 M trainable params → ≈0.67 GB of grads + optimizer state at 16 B each. The frozen base stays at 16.1 GB in BF16 (≈4–5 GB in 4-bit with QLoRA). One GPU is plenty.', set:{alt:{value:'LoRA r=16: 16.1 GB frozen + 0.67 GB trainable state + activations'}}, ok:['alt'], dur:5400}
  ]
});

/* ---------- Ring all-reduce ---------- */
Anim.register({
  id:'v1-mgpu-ring', title:'Ring all-reduce on 4 GPUs: reduce-scatter, then all-gather', w:960, h:420,
  elements:[
    {type:'node', id:'g0', x:60, y:60, w:160, h:56, label:'GPU 0', icon:'gpu'},
    {type:'node', id:'g1', x:740, y:60, w:160, h:56, label:'GPU 1', icon:'gpu'},
    {type:'node', id:'g2', x:740, y:320, w:160, h:56, label:'GPU 2', icon:'gpu'},
    {type:'node', id:'g3', x:60, y:320, w:160, h:56, label:'GPU 3', icon:'gpu'},
    {type:'edge', id:'r01', from:'g0', to:'g1', fromSide:'top', toSide:'top', label:'NVLink'},
    {type:'edge', id:'r12', from:'g1', to:'g2', fromSide:'right', toSide:'right'},
    {type:'edge', id:'r23', from:'g2', to:'g3', fromSide:'bottom', toSide:'bottom'},
    {type:'edge', id:'r30', from:'g3', to:'g0', fromSide:'left', toSide:'left'},
    {type:'grid', id:'d0', x:60, y:140, rows:1, cols:4, cell:36, colLabels:['c0','c1','c2','c3'], showValues:true, fmt:v=>Math.round(v*4)+'/4', values:[[.25,.25,.25,.25]]},
    {type:'grid', id:'d1', x:740, y:140, rows:1, cols:4, cell:36, colLabels:['c0','c1','c2','c3'], showValues:true, fmt:v=>Math.round(v*4)+'/4', values:[[.25,.25,.25,.25]]},
    {type:'grid', id:'d2', x:740, y:262, rows:1, cols:4, cell:36, colLabels:['c0','c1','c2','c3'], showValues:true, fmt:v=>Math.round(v*4)+'/4', values:[[.25,.25,.25,.25]]},
    {type:'grid', id:'d3', x:60, y:262, rows:1, cols:4, cell:36, colLabels:['c0','c1','c2','c3'], showValues:true, fmt:v=>Math.round(v*4)+'/4', values:[[.25,.25,.25,.25]]},
    {type:'counter', id:'phase', x:330, y:150, label:'Phase', value:'start'},
    {type:'counter', id:'sent', x:330, y:220, label:'Data sent by each GPU (S = gradient size)', value:'0'}
  ],
  steps:[
    {caption:'Data-parallel training: each GPU computed gradients on different data and must end with the <b>sum</b> of all four. NCCL’s ring algorithm splits each GPU’s gradient into 4 chunks (c0…c3). “1/4” means the chunk holds one GPU’s contribution.', hl:['d0','d1','d2','d3'], dur:4800},
    {caption:'<b>Reduce-scatter, step 1.</b> Every GPU sends one chunk to its neighbour at the same time; the receiver adds it to its own copy. All four links are busy in parallel.', packets:[{edge:'r01',label:'c0'},{edge:'r12',label:'c1'},{edge:'r23',label:'c2'},{edge:'r30',label:'c3'}], set:{d0:{values:[[.25,.25,.25,.5]]}, d1:{values:[[.5,.25,.25,.25]]}, d2:{values:[[.25,.5,.25,.25]]}, d3:{values:[[.25,.25,.5,.25]]}, phase:{value:'reduce-scatter 1/3'}, sent:{value:'S/4'}}, dur:4600},
    {caption:'<b>Step 2.</b> Each GPU forwards the partial sum it just built. Partial sums grow to 3/4.', packets:[{edge:'r01',label:'c3'},{edge:'r12',label:'c0'},{edge:'r23',label:'c1'},{edge:'r30',label:'c2'}], set:{d0:{values:[[.25,.25,.75,.5]]}, d1:{values:[[.5,.25,.25,.75]]}, d2:{values:[[.75,.5,.25,.25]]}, d3:{values:[[.25,.75,.5,.25]]}, phase:{value:'reduce-scatter 2/3'}, sent:{value:'2S/4'}}, dur:4400},
    {caption:'<b>Step 3.</b> After N − 1 = 3 steps, each GPU owns one <b>fully reduced</b> chunk (4/4): GPU 0 has c1, GPU 1 has c2, GPU 2 has c3, GPU 3 has c0.', packets:[{edge:'r01',label:'c2'},{edge:'r12',label:'c3'},{edge:'r23',label:'c0'},{edge:'r30',label:'c1'}], set:{d0:{values:[[.25,1,.75,.5]]}, d1:{values:[[.5,.25,1,.75]]}, d2:{values:[[.75,.5,.25,1]]}, d3:{values:[[1,.75,.5,.25]]}, phase:{value:'reduce-scatter done'}, sent:{value:'3S/4'}}, ok:['d0','d1','d2','d3'], dur:4800},
    {caption:'<b>All-gather, step 1.</b> Now each GPU passes its finished chunk around the ring; receivers overwrite instead of add.', packets:[{edge:'r01',label:'c1',cls:'c-ok'},{edge:'r12',label:'c2',cls:'c-ok'},{edge:'r23',label:'c3',cls:'c-ok'},{edge:'r30',label:'c0',cls:'c-ok'}], set:{d0:{values:[[1,1,.75,.5]]}, d1:{values:[[.5,1,1,.75]]}, d2:{values:[[.75,.5,1,1]]}, d3:{values:[[1,.75,.5,1]]}, phase:{value:'all-gather 1/3'}, sent:{value:'4S/4'}}, dur:4400},
    {caption:'<b>All-gather, step 2.</b>', packets:[{edge:'r01',label:'c0',cls:'c-ok'},{edge:'r12',label:'c1',cls:'c-ok'},{edge:'r23',label:'c2',cls:'c-ok'},{edge:'r30',label:'c3',cls:'c-ok'}], set:{d0:{values:[[1,1,.75,1]]}, d1:{values:[[1,1,1,.75]]}, d2:{values:[[.75,1,1,1]]}, d3:{values:[[1,.75,1,1]]}, phase:{value:'all-gather 2/3'}, sent:{value:'5S/4'}}, dur:4000},
    {caption:'<b>All-gather, step 3.</b> Every GPU now holds the complete sum. Each GPU sent 2(N − 1)/N × S = 6/4 × S = <b>1.5 S</b>, almost independent of N. That is why the ring is bandwidth-optimal — and why the slowest link in the ring sets the speed.', packets:[{edge:'r01',label:'c3',cls:'c-ok'},{edge:'r12',label:'c0',cls:'c-ok'},{edge:'r23',label:'c1',cls:'c-ok'},{edge:'r30',label:'c2',cls:'c-ok'}], set:{d0:{values:[[1,1,1,1]]}, d1:{values:[[1,1,1,1]]}, d2:{values:[[1,1,1,1]]}, d3:{values:[[1,1,1,1]]}, phase:{value:'all-reduce complete'}, sent:{value:'6S/4 = 1.5 S'}}, ok:['g0','g1','g2','g3'], dur:5200},
    {caption:'Scale it: BF16 gradients of an 8B model are S ≈ 16.06 GB. With 8 GPUs each sends 2 × 7/8 × 16.06 ≈ <b>28.1 GB</b> per step. At NVLink’s 450 GB/s per direction that is ≥ 62 ms; over a 50 GB/s-per-GPU network path it is ≥ 562 ms. Same algorithm, 9× different cost — topology matters.', set:{sent:{value:'8 GPUs, 8B model: ≈ 28.1 GB per GPU per step'}}, warn:['r30'], dur:5600}
  ]
});
