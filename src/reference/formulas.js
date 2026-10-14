/* Reference library: formulas. Every entry = Unicode formula, variables, worked example, caveats.
   Numbers are recomputed; illustrative inputs are labelled. Hardware/price facts from the 2026-10-14 research sheets. */
(function(){
'use strict';
function F(o){
  return {id:o.id,title:o.title,lesson:o.lesson,html:
    formula(o.f)+
    '<h4>Variables</h4><dl class="kv">'+o.vars.map(v=>'<dt>'+v[0]+'</dt><dd>'+v[1]+'</dd>').join('')+'</dl>'+
    '<h4>Worked example</h4>'+o.ex+
    '<h4>Caveats</h4><ul>'+o.cav.map(c=>'<li>'+c+'</li>').join('')+'</ul>'+
    (o.more||'')};
}
registerFormulas([

/* ================= memory ================= */
F({id:'f-tensor-bytes',title:'Tensor size in bytes',lesson:'v1-tensors-pytorch',
f:`
bytes = numel × bytes_per_element

numel = d₁ × d₂ × … × dₖ          (product of the shape)

bytes_per_element:  FP32 = 4   BF16/FP16 = 2   FP8/INT8 = 1   FP4/INT4 = 0.5`,
vars:[['numel','number of elements: product of every dimension of the shape (tensor.numel() in PyTorch)'],['bytes_per_element','size of the dtype (tensor.element_size())'],['dₖ','size of dimension k, e.g. batch, sequence, hidden']],
ex:formula(`
Activation tensor [batch 8, seq 4,096, hidden 4,096] in BF16

STEP 1  numel = 8 × 4,096 × 4,096       = 134,217,728 elements
STEP 2  bytes = 134,217,728 × 2         = 268,435,456 B
STEP 3  in binary units  268,435,456 / 2³⁰  = 0.25 GiB  (256 MiB)
        in decimal units 268,435,456 / 10⁹  = 0.268 GB

ANSWER  one such tensor = 256 MiB; a layer creates several of them`),
cav:['GB = 10⁹ bytes, GiB = 2³⁰ bytes (7.4 % larger). nvidia-smi and DCGM FB metrics report MiB; vendor spec sheets use GB.','Views and slices share storage; .contiguous() or .clone() allocates new memory.','The PyTorch caching allocator reserves more than it allocates; compare torch.cuda.memory_allocated() with memory_reserved().']}),

F({id:'f-weight-memory',title:'Parameters → weight memory',lesson:'v1-gpu-memory',
f:`
weight_bytes ≈ P × bytes_per_param × (1 + q)

P                = parameter count
bytes_per_param  = 2 (BF16) · 1 (FP8/INT8) · 0.5 (4-bit)
q                = quantization metadata overhead (scales, zero points; 0 for BF16)`,
vars:[['P','total parameters, from the model card or config (for MoE: ALL experts must be resident, not only active ones)'],['bytes_per_param','storage precision of the weights'],['q','extra fraction for quantization scales; a few percent for group-wise 4-bit formats (measure the checkpoint size)']],
ex:formula(`
STEP 1  8B model, BF16      8 × 10⁹ × 2    = 16 × 10⁹ B = 16 GB  (≈ 14.9 GiB)
STEP 2  70B model, BF16    70 × 10⁹ × 2    = 140 GB  → does not fit one 80 GB H100
STEP 3  70B model, FP8     70 × 10⁹ × 1    = 70 GB   → fits, but leaves ~10 GB for KV
STEP 4  70B model, 4-bit   70 × 10⁹ × 0.5  = 35 GB   (+ a few % for scales)

ANSWER  weights set the floor; KV cache and runtime overhead sit on top`),
cav:['MoE models: gpt-oss-120b has 117B total / 5.1B active parameters; memory follows the 117B, compute per token follows the 5.1B.','Add the CUDA context, NCCL buffers, CUDA graphs and activation workspace (hundreds of MiB to several GiB; measure, do not guess).','Checkpoint size on disk is the fastest sanity check: safetensors files ≈ weight bytes.']}),

F({id:'f-training-memory',title:'Training memory: mixed-precision Adam (16 bytes per parameter)',lesson:'v1-gpu-memory',
f:`
model states = 2Ψ + 2Ψ + KΨ  with K = 12   →  16Ψ bytes
               ↑     ↑     ↑
               │     │     FP32 master weights (4) + Adam m (4) + Adam v (4)
               │     FP16/BF16 gradients
               FP16/BF16 weights

ZeRO partitioning over N data-parallel GPUs (per GPU):
  stage 1 (optimizer)          2Ψ + 2Ψ + 12Ψ / N
  stage 2 (+ gradients)        2Ψ + 14Ψ / N
  stage 3 (+ parameters)       16Ψ / N

total ≈ model states + activations + temporary buffers`,
vars:[['Ψ','number of parameters (notation of the ZeRO paper, Rajbhandari et al.)'],['K','optimizer-state multiplier; 12 for mixed-precision Adam'],['N','data-parallel degree (GPUs sharing the shards)']],
ex:formula(`
Full fine-tune of a 7B model with Adam, 8 GPUs

STEP 1  unsharded    16 × 7 × 10⁹          = 112 GB    → no single 80 GB GPU
STEP 2  ZeRO-1       28 GB + 84 GB / 8      = 38.5 GB  per GPU
STEP 3  ZeRO-2       14 GB + 98 GB / 8      = 26.25 GB per GPU
STEP 4  ZeRO-3       112 GB / 8             = 14 GB    per GPU
STEP 5  LoRA instead: frozen BF16 base 14 GB + tiny adapter states (≪ 1 GB)

ANSWER  sharding or parameter-efficient tuning is mandatory at 7B+; then
        activations (batch × seq dependent) decide the rest`),
cav:['Activations are NOT included and often dominate at long sequence length; gradient checkpointing trades compute for activation memory.','FSDP2 (PyTorch fully_shard) shards the same states as ZeRO-3; the accounting is identical.','8-bit optimizers and BF16-only master weights change K; recompute for your optimizer.']}),

F({id:'f-kv-bytes',title:'KV cache bytes per token and per sequence',lesson:'v1-kv-cache',
f:`
KV bytes per token  = 2 × L × H_kv × d_head × b
                      ↑                       ↑
                      one K and one V         bytes per element (2 BF16, 1 FP8)

KV bytes per sequence = KV bytes per token × (prompt tokens + generated tokens)`,
vars:[['L','num_hidden_layers'],['H_kv','num_key_value_heads (NOT attention heads when the model uses GQA/MQA)'],['d_head','head dimension = hidden_size / num_attention_heads (unless head_dim is given explicitly)'],['b','KV-cache dtype bytes (vLLM --kv-cache-dtype, default auto = model dtype)']],
ex:formula(`
Llama-3.1-8B shape: L = 32, H_kv = 8, d_head = 128, BF16

STEP 1  per token     2 × 32 × 8 × 128 × 2    = 131,072 B = 128 KiB
STEP 2  8,192-token sequence  8,192 × 128 KiB  = 1,048,576 KiB = 1 GiB
STEP 3  Llama-3.1-70B shape (L = 80): 2 × 80 × 8 × 128 × 2 = 327,680 B = 320 KiB/token
STEP 4  70B, 8,192 tokens   8,192 × 320 KiB   = 2.5 GiB per sequence

ANSWER  long contexts × many users, not weights, usually cap concurrency`),
cav:['Using attention heads instead of KV heads over-estimates GQA models by the group ratio (8× for 70B).','Paged allocation wastes at most one partial block per sequence; contiguous pre-allocation wastes far more.','MLA (DeepSeek-style latent attention) and sliding-window layers change the formula; read the model architecture.']}),

F({id:'f-kv-concurrency',title:'KV budget → maximum concurrent sequences',lesson:'v1-kv-cache',
f:`
KV budget   = HBM × u − weights − runtime overhead

                    KV budget
max tokens  = ─────────────────────
               KV bytes per token

                       max tokens
max sequences ≈ ──────────────────────────
                 average tokens per sequence`,
vars:[['HBM','GPU memory (or the sum over tensor-parallel GPUs, with weights split the same way)'],['u','fraction the engine may use: vLLM --gpu-memory-utilization (default 0.92 as of Oct 2026); SGLang --mem-fraction-static (auto)'],['runtime overhead','activations, CUDA graphs, NCCL buffers; measure from the engine start-up log']],
ex:formula(`
8B model, BF16, one 80 GB H100, u = 0.92, overhead 4 GB (ILLUSTRATIVE)

STEP 1  KV budget   80 × 0.92 − 16 − 4            = 53.6 GB
STEP 2  max tokens  53.6 × 10⁹ / 131,072          ≈ 408,935 tokens
STEP 3  if the average live sequence holds 8,192 tokens
        408,935 / 8,192                            ≈ 49 sequences
STEP 4  if the average is 2,048 tokens            ≈ 199 sequences

ANSWER  concurrency is set by token mix; the engine logs the real number
        ("maximum concurrency for N tokens per request") at start-up`),
cav:['Engines cap concurrency separately (vLLM --max-num-seqs); the lower of the two limits wins.','When the budget runs out, vLLM preempts (default mode RECOMPUTE), which shows as latency spikes, not errors.','Prefix sharing lets many sequences reference the same blocks, so effective capacity can exceed this estimate.']}),

F({id:'f-lora-params',title:'LoRA trainable parameters r(d + k)',lesson:'v1-finetuning',
f:`
W' = W + ΔW,   ΔW = B·A,   B ∈ ℝ^(d×r),  A ∈ ℝ^(r×k)

trainable params per adapted matrix = r × (d + k)

scaling applied to ΔW = α / r`,
vars:[['d, k','output and input dimensions of the frozen weight matrix W (d × k)'],['r','LoRA rank (typically 8–64)'],['α','lora_alpha; the update is scaled by α/r']],
ex:formula(`
Llama-3.1-8B shape, r = 16, adapters on q, k, v, o in all 32 layers

STEP 1  q_proj 4,096 × 4,096   16 × (4,096 + 4,096) = 131,072
STEP 2  k_proj 1,024 × 4,096   16 × (1,024 + 4,096) =  81,920   ← GQA: 8 KV heads × 128
STEP 3  v_proj 1,024 × 4,096   16 × (1,024 + 4,096) =  81,920
STEP 4  o_proj 4,096 × 4,096   16 × (4,096 + 4,096) = 131,072
STEP 5  per layer                                    = 425,984
STEP 6  × 32 layers                                  = 13,631,488 ≈ 13.6 M
STEP 7  share of ~8.0 B                              ≈ 0.17 %
STEP 8  adapter file in BF16  13.6 M × 2 B           ≈ 27 MB

ANSWER  13.6 M trainable parameters; a 27 MB adapter on a 16 GB base`),
cav:['Activations and the frozen base still need memory; LoRA cuts optimizer and gradient memory, not forward-pass memory.','QLoRA stores the frozen base in 4-bit; adapters stay in BF16.','Serving many adapters: vLLM --enable-lora with --max-loras (default 1) bounds how many are resident per batch.']}),

/* ================= compute ================= */
F({id:'f-flops-per-token',title:'FLOPs per token: 2N inference, 6N training',lesson:'v1-neural-networks',
f:`
forward (inference)  ≈ 2N FLOPs per token      (one multiply + one add per weight)
training             ≈ 6N FLOPs per token      (forward 2N + backward 4N)

prefill compute      ≈ 2N × prompt tokens
training compute  C  ≈ 6N × D                  (D = training tokens)

          C
time = ─────────────────────────
        GPUs × peak FLOP/s × MFU`,
vars:[['N','parameters touched per token (for MoE: ACTIVE parameters)'],['D','number of training tokens'],['MFU','model FLOP utilization: achieved / peak; 35–55 % is typical for well-tuned dense training (measure)'],['peak','DENSE tensor throughput; NVIDIA sheets often print sparse numbers (H100 SXM BF16 1,979 is sparse; dense ≈ 989.5 TFLOPS)']],
ex:formula(`
Prefill of a 2,000-token prompt on an 8B model, one H100, assume 50 % MFU

STEP 1  FLOPs       2 × 8 × 10⁹ × 2,000         = 3.2 × 10¹³
STEP 2  achieved    989.5 × 10¹² × 0.5          = 4.95 × 10¹⁴ FLOP/s
STEP 3  time        3.2 × 10¹³ / 4.95 × 10¹⁴    ≈ 0.065 s  (65 ms)

Training an 8B model on 1 T tokens with 8 × H100 at 40 % MFU

STEP 4  C           6 × 8 × 10⁹ × 10¹²          = 4.8 × 10²²
STEP 5  throughput  8 × 989.5 × 10¹² × 0.4      = 3.17 × 10¹⁵ FLOP/s
STEP 6  time        4.8 × 10²² / 3.17 × 10¹⁵    ≈ 1.52 × 10⁷ s ≈ 176 days

ANSWER  prefill ≈ 65 ms (compute-bound); that training run needs ~22× more GPUs
        to finish in about 8 days`),
cav:['Ignores the attention n² term (see attention FLOPs); fine for short contexts, under-counts long ones.','Decode is rarely compute-bound; use the bandwidth formula for decode speed.','Activation recomputation adds roughly another forward pass (≈ 8N per token).']}),

F({id:'f-attention-flops',title:'Attention FLOPs (the quadratic part)',lesson:'v1-transformer',
f:`
per layer, one sequence of n tokens, model width d:

projections Q, K, V, O ≈ 2n(2d² + 2d·d_kv)        (linear in n)
scores  Q·Kᵀ           ≈ 2n²d
mixing  softmax(·)·V   ≈ 2n²d
                          ─────
attention core         ≈ 4n²d                      (quadratic in n)

causal masking: a kernel that skips masked blocks does about half of 4n²d`,
vars:[['n','sequence length in tokens'],['d','hidden size = attention heads × head_dim'],['d_kv','KV heads × head_dim (smaller than d under GQA)']],
ex:formula(`
Llama-3.1-8B shape, n = 8,192, d = 4,096, 32 layers, full (non-causal) count

STEP 1  per layer   4 × 8,192² × 4,096       = 4 × 67,108,864 × 4,096
                                             ≈ 1.10 × 10¹² FLOPs
STEP 2  32 layers   32 × 1.10 × 10¹²          ≈ 3.52 × 10¹³  (35 TFLOP)
STEP 3  weight FLOPs 2N·n = 2 × 8 × 10⁹ × 8,192 ≈ 1.31 × 10¹⁴ (131 TFLOP)
STEP 4  ratio       35 / 131                  ≈ 27 %

ANSWER  at 8 k tokens the quadratic term adds about a quarter on top of 2N·n;
        at 128 k it dominates (16× n → 256× the n² term)`),
cav:['FlashAttention changes MEMORY traffic (no n×n matrix in HBM), not the FLOP count.','During decode each new token costs 4·n·d per layer (linear), but it must READ n cached K/V vectors: bandwidth, not FLOPs, is the limit.','Different papers count multiply-add as 1 or 2 FLOPs; keep the convention consistent.']}),

F({id:'f-chinchilla',title:'Chinchilla compute-optimal: ~20 tokens per parameter',lesson:'v1-finetuning',
f:`
D_opt ≈ 20 × N                (Hoffmann et al. 2022, "Chinchilla")

C ≈ 6 × N × D                 (training FLOPs)`,
vars:[['N','parameters'],['D_opt','training tokens that minimise loss for a fixed compute budget'],['C','training compute in FLOPs']],
ex:formula(`
1 B-parameter model

STEP 1  D_opt   20 × 10⁹              = 2 × 10¹⁰ tokens (20 B)
STEP 2  C       6 × 10⁹ × 2 × 10¹⁰    = 1.2 × 10²⁰ FLOPs
STEP 3  on one H100 at 40 % MFU: 1.2 × 10²⁰ / (989.5 × 10¹² × 0.4)
                                       ≈ 3.03 × 10⁵ s ≈ 3.5 days

ANSWER  20 B tokens, 1.2 × 10²⁰ FLOPs`),
cav:['It is compute-optimal for TRAINING cost only. Production models are deliberately over-trained (many times more tokens per parameter) because a smaller model is cheaper to SERVE for its lifetime.','The 20 ratio is an approximate fit; later work refits the constants. Use it for orders of magnitude, not for budgets.','Not relevant to fine-tuning, which uses tiny token counts relative to pretraining.']}),

F({id:'f-roofline',title:'Arithmetic intensity and the roofline',lesson:'v1-gpu-architecture',
f:`
                       FLOPs performed
arithmetic intensity = ─────────────────        (FLOP / byte)
                        bytes moved (HBM)

attainable FLOP/s = min( peak FLOP/s ,  AI × memory bandwidth )

                 peak FLOP/s
ridge point  =  ─────────────
                 bandwidth`,
vars:[['AI','arithmetic intensity of the kernel'],['peak','dense tensor-core peak for the dtype'],['bandwidth','HBM bandwidth (H100 SXM 3.35 TB/s, H200 4.8 TB/s, A100 80GB 2.039 TB/s, L40S 864 GB/s, L4 300 GB/s)']],
ex:formula(`
H100 SXM, BF16 dense

STEP 1  ridge       989.5 × 10¹² / 3.35 × 10¹²   ≈ 295 FLOP/byte
STEP 2  decode GEMV at batch B: FLOPs ≈ 2·N·B, bytes ≈ 2·N (weights read once)
        AI ≈ B FLOP/byte
STEP 3  batch 1     AI ≈ 1   → attainable ≈ 3.35 TFLOP/s  (0.3 % of peak)
STEP 4  batch 64    AI ≈ 64  → attainable ≈ 214 TFLOP/s   (still memory-bound)
STEP 5  batch ≈ 295 reaches the ridge (ignoring KV reads, which lower AI)

ANSWER  decode is memory-bound; batching is the lever. Prefill (AI ≈ thousands)
        is compute-bound`),
cav:['KV-cache reads grow with context and do not amortise across the batch, so long-context decode stays memory-bound even at large batch.','DCGM_FI_PROF_DRAM_ACTIVE high + DCGM_FI_PROF_PIPE_TENSOR_ACTIVE low is the signature of a memory-bound kernel.','Use dense peaks; sparse figures double the apparent ceiling.']}),

F({id:'f-decode-bound',title:'Decode speed upper bound ≈ bandwidth ÷ bytes read per step',lesson:'v1-inference-anatomy',
f:`
                         memory bandwidth
steps/s per replica ≤ ─────────────────────────────────────
                       weight bytes + KV bytes read per step

per-stream tokens/s ≤ steps/s           (one token per sequence per step)
aggregate tokens/s  ≤ batch × steps/s
TPOT                ≥ 1 / steps/s`,
vars:[['weight bytes','all weights read once per decode step (per GPU share under tensor parallelism)'],['KV bytes read','sum over the batch of every cached token’s K and V'],['batch','sequences decoded together in one step']],
ex:formula(`
8B BF16 (16 GB) on one H100 (3.35 TB/s)

STEP 1  batch 1, short context   3.35 × 10¹² / 16 × 10⁹   ≈ 209 steps/s
        → ≤ 209 tok/s per stream, TPOT ≥ 4.8 ms
STEP 2  batch 32, 4,096-token contexts
        KV per sequence  4,096 × 131,072 B           = 0.537 GB
        KV for batch     32 × 0.537 GB               = 17.2 GB
        bytes per step   16 + 17.2                   = 33.2 GB
        steps/s          3.35 × 10¹² / 33.2 × 10⁹    ≈ 101
STEP 3  aggregate ≤ 32 × 101 ≈ 3,230 tok/s; per stream ≤ 101 tok/s (TPOT ≥ 9.9 ms)

ANSWER  batching multiplies throughput, long contexts erode it`),
cav:['This is a CEILING; real engines reach a fraction (kernel efficiency, scheduling, sampling overhead).','Speculative decoding and quantized weights/KV reduce bytes per generated token and raise the ceiling.','Under tensor parallelism each GPU reads its shard, but all-reduce latency is added per layer.']}),

/* ================= latency & queueing ================= */
F({id:'f-latency',title:'TTFT, TPOT, ITL and end-to-end latency',lesson:'v1-inference-anatomy',
f:`
E2E  = TTFT + (n_out − 1) × TPOT

TTFT = queue time + prefill time + first decode step + network

         E2E − TTFT
TPOT = ──────────────          (mean time per output token, per request)
         n_out − 1

per-user streaming speed = 1 / TPOT   tokens/s`,
vars:[['TTFT','time to first token (vllm:time_to_first_token_seconds)'],['TPOT','time per output token after the first (vllm:request_time_per_output_token_seconds)'],['ITL','inter-token latency: gap between consecutive tokens (vllm:inter_token_latency_seconds); its distribution shows stalls that the TPOT mean hides'],['n_out','generated tokens']],
ex:formula(`
TTFT 300 ms, TPOT 25 ms, 400 output tokens

STEP 1  decode part   399 × 0.025 s    = 9.975 s
STEP 2  E2E           0.3 + 9.975      = 10.275 s
STEP 3  stream speed  1 / 0.025        = 40 tokens/s (faster than people read)

ANSWER  E2E ≈ 10.3 s; TTFT dominates perceived responsiveness,
        TPOT dominates total time for long answers`),
cav:['Report percentiles (p50/p95/p99), never only means; SLOs are on tails.','Client-measured TTFT includes gateway, auth, guardrails and network; engine histograms do not.','vllm bench serve reports ttft, tpot, itl and e2el; --goodput applies SLO thresholds.']}),

F({id:'f-littles-law',title:'Little’s law L = λW',lesson:'v2-hyperscale-serving',
f:`
L = λ × W

L  average number of requests in the system
λ  average arrival rate (= throughput in a stable system)
W  average time each request spends in the system`,
vars:[['L','in-flight requests (queue + being served)'],['λ','requests per second'],['W','mean E2E seconds']],
ex:formula(`
50 requests/s, mean E2E 8 s

STEP 1  L = 50 × 8 = 400 requests in flight on average

Sizing check: if each replica holds 48 concurrent sequences comfortably,
STEP 2  400 / 48 ≈ 8.3  → at least 9 replicas, before headroom

ANSWER  400 concurrent; ≥ 9 replicas at that per-replica concurrency`),
cav:['Holds only for a STABLE system over a long enough window (arrivals ≈ completions). During overload the queue grows and the law describes nothing useful.','It gives the total in the system; it does NOT say how many are on the GPU versus waiting in a queue.','Mean-based: it says nothing about p99.']}),

F({id:'f-mm1',title:'Utilization and queueing delay (M/M/1)',lesson:'v2-hyperscale-serving',
f:`
       λ
ρ  = ─────                    (utilization, must be < 1)
       μ

          1                       ρ
W  = ───────── ,        W_q = ─────────
       μ − λ                    μ − λ

  W        1
──── = ───────     (time in system relative to service time)
 1/μ     1 − ρ`,
vars:[['λ','arrival rate'],['μ','service rate of one server'],['ρ','utilization'],['W, W_q','mean time in system / in queue']],
ex:formula(`
μ = 10 req/s (service time 0.1 s)

λ = 5    ρ = 0.50   W = 1/(10 − 5)    = 0.2 s   (2× service time)
λ = 8    ρ = 0.80   W = 1/(10 − 8)    = 0.5 s   (5×)
λ = 9    ρ = 0.90   W = 1/(10 − 9)    = 1.0 s   (10×)
λ = 9.5  ρ = 0.95   W = 1/(10 − 9.5)  = 2.0 s   (20×)

ANSWER  the last 10 % of utilization costs a 2× latency jump; leave headroom`),
cav:['LLM serving is not M/M/1 (batched service, variable token lengths), but the hockey-stick shape is the same: latency explodes as utilization approaches saturation.','Multi-server (M/M/c) queues tolerate higher ρ than M/M/1; simulate with labs/11-capacity/queue_sim.py.','Bursty arrivals (high variance) make waiting worse than the Poisson assumption.']}),

/* ================= capacity ================= */
F({id:'f-dau-rps',title:'DAU → requests/s → tokens/s',lesson:'v2-capacity-planning',
f:`
               DAU × requests per user per day
RPS_avg  =  ──────────────────────────────────
                         86,400

RPS_peak = RPS_avg × peak factor

prefill tokens/s = RPS_peak × mean input tokens  (after cache hits)
decode tokens/s  = RPS_peak × mean output tokens`,
vars:[['DAU','daily active users'],['peak factor','peak-hour rate ÷ daily average (measure from traffic; seasonal events such as Ramadan evenings or holiday sales shift it)'],['input/output tokens','from logs, by route; use distributions, not just means']],
ex:formula(`
ILLUSTRATIVE: 10 M DAU, 5 requests/user/day, peak factor 3,
1,500 input and 300 output tokens per request

STEP 1  requests/day   10,000,000 × 5        = 50,000,000
STEP 2  RPS_avg        50,000,000 / 86,400   ≈ 579 req/s
STEP 3  RPS_peak       579 × 3               ≈ 1,736 req/s
STEP 4  prefill        1,736 × 1,500         ≈ 2.60 M input tok/s
STEP 5  decode         1,736 × 300           ≈ 521 k output tok/s

ANSWER  size for ~1,736 req/s with BOTH token streams, then convert to replicas`),
cav:['Agents multiply calls: one user request may fan out to several model calls; count model calls, not user clicks.','Prefix/prompt caching removes part of the prefill demand; subtract only measured hit rates.','Peak factor should come from the busiest hour of the busiest season you must serve.']}),

F({id:'f-replicas-goodput',title:'Replicas from SLO goodput',lesson:'v2-capacity-planning',
f:`
                      ⌈        peak demand (req/s)            ⌉
replicas_needed  =    ⌈ ─────────────────────────────────────  ⌉
                      ⌈  goodput per replica at SLO (req/s)    ⌉

goodput = requests/s completed WITHIN the SLO (e.g. p95 TTFT ≤ 1 s and p95 TPOT ≤ 50 ms),
measured on a benchmark that replays the real input/output token distribution`,
vars:[['peak demand','from the DAU → RPS formula'],['goodput per replica','vllm bench serve --goodput ttft:… tpot:… on one replica with production-like prompts'],['⌈ ⌉','round up']],
ex:formula(`
ILLUSTRATIVE measurements: one replica meets the SLO up to 6 req/s
(≈ 9,000 input + 1,800 output tok/s with the real mix)

STEP 1  replicas   1,736 / 6          = 289.3 → 290
STEP 2  WRONG way: divide output demand by the engine's headline output
        throughput without SLO (say 2,400 tok/s):
        521,000 / 2,400               ≈ 217 replicas  → 25 % short,
        because it ignores prefill load and the latency SLO

ANSWER  290 replicas before headroom (see N+1 and failover formulas)`),
cav:['Goodput collapses past a knee; benchmark at several request rates and take the highest rate that still meets the SLO.','Separate routes with very different token shapes (RAG with 6 k-token prompts versus chat) into separate pools or weight them.','KV capacity can bind before compute: check max concurrency from the KV formula as well.']}),

F({id:'f-n-plus-1',title:'N+1 and zone headroom',lesson:'v2-capacity-planning',
f:`
with a utilization cap u_max:     replicas = ⌈ needed / u_max ⌉

surviving loss of one of Z zones:  per zone = ⌈ needed / (Z − 1) ⌉
                                   total    = Z × per zone`,
vars:[['needed','replicas required at peak at 100 % of measured goodput'],['u_max','highest steady utilization you accept (e.g. 0.8)'],['Z','availability zones (failure domains) used']],
ex:formula(`
needed = 290 replicas

STEP 1  cap at 80 %       290 / 0.8          = 362.5 → 363
STEP 2  3 zones, survive losing 1:
        per zone          290 / (3 − 1)      = 145
        total             3 × 145            = 435   (50 % more than 290)
STEP 3  4 zones:          290 / 3 = 96.7 → 97 per zone, total 388

ANSWER  more, smaller failure domains cost less headroom`),
cav:['GPU capacity in a zone may not exist when you need it; headroom must be RESERVED (reservations or capacity blocks), not assumed from on-demand.','Model load time (minutes) means autoscaling cannot replace lost capacity instantly; headroom covers that gap.','Use degraded modes (smaller model, shorter max tokens) to cut the headroom bill.']}),

F({id:'f-failover-headroom',title:'Region failover headroom',lesson:'v2-multi-region',
f:`
k active regions, must survive f region losses, max safe utilization u_max:

                         k − f
u_normal  ≤  u_max ×  ─────────
                           k`,
vars:[['k','active regions sharing traffic'],['f','regions that may fail at once (usually 1)'],['u_normal','steady-state utilization each region may run at']],
ex:formula(`
u_max = 0.8

2 regions, f = 1:  0.8 × 1/2  = 0.40  → each runs ≤ 40 %
3 regions, f = 1:  0.8 × 2/3  ≈ 0.533 → each runs ≤ 53 %
4 regions, f = 1:  0.8 × 3/4  = 0.60

ANSWER  two-region active-active doubles GPU spend for failover;
        degraded mode or a third region reduces it`),
cav:['Data residency may forbid failing over to a region in another country; then the residency-bound traffic needs in-country redundancy instead.','Cold regions (pilot light) need model weights pre-staged; download time sets the recovery time.','Cached prefixes do not move with traffic; the surviving region sees a cache-miss storm and more prefill.']}),

F({id:'f-concurrency-throughput',title:'Concurrency ↔ throughput ↔ TPOT',lesson:'v1-batching',
f:`
                         concurrent decoding streams
aggregate output tok/s ≈ ───────────────────────────
                                   TPOT`,
vars:[['concurrent streams','sequences in the decode batch'],['TPOT','mean time per output token at that concurrency']],
ex:formula(`
64 concurrent streams, TPOT 30 ms

STEP 1  64 / 0.030 ≈ 2,133 output tok/s per replica
STEP 2  doubling to 128 streams raises TPOT to (say, measured) 45 ms:
        128 / 0.045 ≈ 2,844 tok/s  (+33 % throughput, +50 % TPOT)

ANSWER  more batch = more throughput but slower streams; the SLO picks the point`),
cav:['TPOT grows with batch size and context length; measure the curve, do not extrapolate.','Chunked prefill interleaves prompt work with decode and raises TPOT while prompts arrive.']}),

/* ================= cost ================= */
F({id:'f-cost-per-mtok',title:'Cost per 1 M tokens (self-hosted)',lesson:'v2-finops-unit-economics',
f:`
                       hourly cost of the replica
cost per 1M tokens = ───────────────────────────────────── × 10⁶
                      tokens/s at SLO × 3,600 × utilization`,
vars:[['hourly cost','instance or GPU price (on-demand, reserved, spot), plus share of networking, storage, platform'],['tokens/s at SLO','measured goodput in tokens, not peak benchmark throughput'],['utilization','average fraction of the hour that capacity does useful work (traffic is not flat)']],
ex:formula(`
p5.48xlarge on-demand us-east-1: $55.04/h for 8 × H100 (AWS feed, 2026-10-12)

STEP 1  per GPU-hour       55.04 / 8                  = $6.88
STEP 2  ILLUSTRATIVE goodput 2,400 output tok/s per GPU
        tokens/hour        2,400 × 3,600              = 8.64 M
STEP 3  at 100 % use       6.88 / 8.64                ≈ $0.80 per 1 M output tokens
STEP 4  at 40 % average use 0.80 / 0.40               ≈ $1.99 per 1 M

Old-course example: $6/h ÷ 90,000 tok/h = $66.67 per 1 M — arithmetic correct,
but 90 k tok/h (25 tok/s) is unrealistically low for a GPU; treat it as illustrative only.

ANSWER  utilization moves unit cost more than the hourly price does`),
cav:['Input and output tokens cost very differently on GPUs (prefill is cheap per token, decode is expensive); report both or a blended rate with the mix stated.','Prices change; always cite the date and region.','Include idle warm capacity, failover headroom and evaluation traffic in the numerator.']}),

F({id:'f-cost-per-success',title:'Cost per successful request',lesson:'v2-finops-unit-economics',
f:`
                         Σ all model calls + retrieval + tools + guardrails + eval + infra
cost per success  =  ──────────────────────────────────────────────────────────────────
                                    requests that achieved the user goal`,
vars:[['numerator','every cost incurred, including retries, failed calls, agent loop iterations and judge calls'],['denominator','requests judged successful (task done, not escalated, not abandoned)']],
ex:formula(`
ILLUSTRATIVE month: 1,000,000 user requests

STEP 1  model calls   1.3 calls/request × 1 M × $0.004   = $5,200
STEP 2  retrieval + embeddings                            = $300
STEP 3  online judge on 5 % sample  50,000 × $0.01        = $500
STEP 4  total                                             = $6,000
STEP 5  successful requests 900,000
STEP 6  cost per success  6,000 / 900,000                 ≈ $0.0067

Naive "cost per call" = $0.004 → understates the true unit cost by 40 %

ANSWER  $0.0067 per successful request`),
cav:['Defining success needs an outcome signal (resolution, no human handoff, user rating); agree it with the product owner.','A cheaper model with lower success rate can cost MORE per success.']}),

F({id:'f-blended-routing',title:'Blended cost with model routing',lesson:'v2-ai-gateway',
f:`
cost/request = Σᵢ sᵢ × cᵢ  +  e × s_small × c_large  +  c_router

sᵢ  share of traffic routed to model i (Σ sᵢ = 1)
e   escalation rate: share of small-model answers re-run on the large model`,
vars:[['cᵢ','mean cost per request on model i'],['e','fraction of small-model responses that fail a check and are retried on the large model'],['c_router','classifier/embedding cost per request (often small but not zero)']],
ex:formula(`
ILLUSTRATIVE: small $0.0004/request, large $0.012/request, 70 % to small

STEP 1  no escalation   0.7 × 0.0004 + 0.3 × 0.012    = 0.00028 + 0.0036 = $0.00388
STEP 2  e = 10 %        + 0.10 × 0.7 × 0.012           = + $0.00084
STEP 3  blended                                        = $0.00472
STEP 4  saving vs all-large  1 − 0.00472 / 0.012       ≈ 60.7 %

ANSWER  routing saves ~61 % here; escalation ate 7 percentage points`),
cav:['Measure quality per route; a router that sends hard queries to the small model shifts cost into failures and support load.','Escalation also adds latency (two calls in series).']}),

F({id:'f-cache-savings',title:'Cache savings and break-even hit rate',lesson:'v2-cache-ops',
f:`
response/semantic cache, per request:
  cost_with = c_lookup + (1 − h) × c_miss
  saving    = h × c_miss − c_lookup

                    c_lookup
break-even  h* = ───────────
                    c_miss

provider prompt caching (prefix of P tokens reused r times, price p per token):
  no cache = (r + 1) × P × p
  cached   = w × P × p + r × ρ × P × p          (w write multiplier, ρ read multiplier)`,
vars:[['h','hit rate (measured, by route)'],['c_lookup','embedding + vector lookup + cache infra per request'],['c_miss','cost of a full model call'],['w, ρ','Anthropic as of Oct 2026: 5-min write 1.25×, read 0.1× (0.05× on some newest models)']],
ex:formula(`
Semantic cache, ILLUSTRATIVE: 1 M req/day, h = 20 %, c_miss $0.005, c_lookup $0.0002

STEP 1  saving/request  0.2 × 0.005 − 0.0002   = $0.0008
STEP 2  per day         1,000,000 × 0.0008     = $800
STEP 3  break-even      0.0002 / 0.005         = 4 % hit rate

Prompt caching: 9 reuses of the same prefix within the TTL, w = 1.25, ρ = 0.1
STEP 4  no cache  10 units;  cached  1.25 + 9 × 0.1 = 2.15 units
STEP 5  saving on the prefix  1 − 2.15/10 = 78.5 %

ANSWER  $800/day; prompt caching cuts the repeated prefix cost by ~79 %`),
cav:['A semantic-cache false hit returns a WRONG answer; the true cost includes quality loss. Tune the threshold on labelled pairs.','Tenant isolation: keys must include tenant/ACL scope or the cache leaks data.','Prefixes below the provider minimum (e.g. 512–4,096 tokens depending on model) are silently not cached.']}),

/* ================= distributed ================= */
F({id:'f-allreduce-ring',title:'Ring all-reduce time',lesson:'v2-distributed-training',
f:`
                 2(N − 1)      S
T_bandwidth  ≈  ────────── × ─────
                    N          B

T_latency    ≈  2(N − 1) × α

T            ≈  T_bandwidth + T_latency`,
vars:[['N','ranks in the ring'],['S','bytes reduced per rank (e.g. gradient bytes)'],['B','per-rank link bandwidth actually achieved (NCCL "busbw" is normalised so it compares to B)'],['α','per-step latency (µs scale)']],
ex:formula(`
Gradients of an 8B model in BF16: S = 16 GB, N = 8

STEP 1  inside one NVLink node, assume achieved B = 400 GB/s (ILLUSTRATIVE)
        T ≈ 2 × 7/8 × 16 / 400   = 1.75 × 0.04  = 0.07 s
STEP 2  across nodes, 400 Gb/s per GPU = 50 GB/s
        T ≈ 1.75 × 16 / 50       = 0.56 s

ANSWER  8× slower across the network; overlap with backward and bucket the gradients`),
cav:['DDP and FSDP overlap communication with backward compute; exposed (non-overlapped) time is what matters.','Gb (bits) vs GB (bytes): 400 Gb/s = 50 GB/s.','Measure with nccl-tests (all_reduce_perf) before blaming the model code.']}),

F({id:'f-pipeline-bubble',title:'Pipeline-parallel bubble fraction',lesson:'v2-parallelism',
f:`
                    p − 1
bubble fraction = ─────────          (GPipe / 1F1B schedules; share of total time idle)
                   m + p − 1

                       p − 1
interleaved (v chunks) ≈ ─────────── (relative to ideal compute, Megatron-LM)
                         v × m`,
vars:[['p','pipeline stages'],['m','micro-batches per global batch'],['v','model chunks per GPU in the interleaved schedule']],
ex:formula(`
p = 8 stages

m = 8     7 / (8 + 7)   = 7/15  ≈ 46.7 % idle
m = 32    7 / (32 + 7)  = 7/39  ≈ 17.9 % idle
m = 128   7 / 135              ≈  5.2 % idle

ANSWER  use many micro-batches (m ≫ p); that raises activation memory, so balance`),
cav:['Two definitions exist ((p−1)/m relative to ideal, or (p−1)/(m+p−1) of total); say which.','Unequal stage times (e.g. embedding/LM head stages) make the real bubble larger.']}),

F({id:'f-effective-batch',title:'Effective (global) batch size',lesson:'v1-training-loop',
f:`
global batch (sequences) = micro-batch × gradient accumulation steps × data-parallel ranks

tokens per optimizer step = global batch × sequence length`,
vars:[['micro-batch','sequences per GPU per forward/backward'],['grad accumulation','forward/backward passes summed before one optimizer step'],['DP ranks','data-parallel replicas (not TP or PP ranks)']],
ex:formula(`
micro-batch 4, accumulation 8, 16 DP ranks, 4,096-token sequences

STEP 1  sequences   4 × 8 × 16        = 512
STEP 2  tokens      512 × 4,096       = 2,097,152 ≈ 2.1 M tokens per step

ANSWER  2.1 M tokens per step; change any factor and re-tune the learning rate`),
cav:['Gradient accumulation must divide the loss correctly (average over the global batch), or the effective learning rate changes.','With packing, sequences per step stays fixed but real tokens per step varies less; with padding, count only non-pad tokens.']}),

F({id:'f-mfu',title:'Model FLOP utilization (MFU)',lesson:'v1-multi-gpu-profiling',
f:`
          6 × N × tokens/s per GPU
MFU  =  ──────────────────────────          (training; use 2N for inference)
          peak dense FLOP/s per GPU`,
vars:[['N','parameters (active parameters for MoE)'],['tokens/s per GPU','measured training throughput'],['peak','dense peak for the dtype']],
ex:formula(`
8B model, 10,000 tok/s per H100 (ILLUSTRATIVE)

STEP 1  achieved  6 × 8 × 10⁹ × 10,000   = 4.8 × 10¹⁴ FLOP/s
STEP 2  MFU       4.8 × 10¹⁴ / 989.5 × 10¹² ≈ 48.5 %

ANSWER  ~49 %; "GPU utilization 100 %" in nvidia-smi says nothing about this`),
cav:['nvidia-smi utilization.gpu = % of time at least one kernel ran; a GPU can show 100 % at 5 % MFU.','Hardware FLOP utilization (HFU) counts recomputation too and is higher than MFU.']}),

/* ================= data, eval, reliability ================= */
F({id:'f-download-time',title:'Model download / load time',lesson:'v2-rag-weight-cache',
f:`
             size (bytes) × 8
t_download = ─────────────────────         (bandwidth in bits/s)
              effective bandwidth

shared link, n replicas pulling at once:  t ≈ n × size × 8 / shared bandwidth

cold start ≈ node provision + image pull + weight download + load to GPU + warm-up`,
vars:[['size','checkpoint bytes'],['effective bandwidth','achieved throughput (often far below the NIC rating; S3 needs parallel range GETs)'],['n','replicas downloading through the same bottleneck (NAT, proxy, registry)']],
ex:formula(`
70B BF16 checkpoint = 140 GB

STEP 1  at 10 Gb/s     140 × 8 / 10    = 112 s
STEP 2  at 1 Gb/s      140 × 8 / 1     = 1,120 s ≈ 18.7 min
STEP 3  20 replicas through one 25 Gb/s NAT
        20 × 140 × 8 / 25              = 896 s ≈ 15 min each (all finish together)

ANSWER  stage weights near the nodes (local NVMe cache, image volumes, peer fetch)`),
cav:['Gb/s vs GB/s is a factor of 8; mixing them is the most common sizing error.','Loading to GPU also takes time (safetensors are memory-mappable; pickle checkpoints are slower and unsafe).','Kubernetes image volumes (OCI artifacts) are GA since v1.36 and let nodes cache weights like images.']}),

F({id:'f-retrieval-metrics',title:'Recall@k and MRR',lesson:'v2-rag-fundamentals',
f:`
            | relevant ∩ top-k |
recall@k = ────────────────────
               | relevant |

            1     |Q|    1
MRR     =  ───  ×  Σ  ─────────
           |Q|    q=1  rank_q              (rank of the FIRST relevant result; 0 if none)`,
vars:[['relevant','labelled relevant chunks for a query'],['top-k','retrieved results passed onward'],['rank_q','position (1-based) of the first relevant chunk for query q']],
ex:formula(`
Query A has 4 relevant chunks; 3 appear in the top 5
STEP 1  recall@5 = 3 / 4 = 0.75

Three queries, first relevant at rank 1, rank 3, and not found
STEP 2  MRR = (1/1 + 1/3 + 0) / 3 = 1.333 / 3 ≈ 0.444

ANSWER  recall@5 0.75; MRR 0.44 (one query missed entirely)`),
cav:['Recall@k bounds answer quality: the generator cannot cite what was not retrieved.','Label sets are incomplete; unlabelled relevant chunks look like false positives.','nDCG accounts for graded relevance and position; use it when order inside top-k matters.']}),

F({id:'f-psi',title:'Population Stability Index (PSI) for drift',lesson:'v2-evaluation-monitoring',
f:`
         B
PSI  =   Σ  (aᵢ − eᵢ) × ln( aᵢ / eᵢ )
        i=1

eᵢ  share of the reference (expected) data in bin i
aᵢ  share of the current (actual) data in bin i`,
vars:[['B','number of bins (often 10 quantile bins from the reference)'],['aᵢ, eᵢ','proportions, each summing to 1; add a small ε to empty bins']],
ex:formula(`
Reference [0.25, 0.25, 0.25, 0.25], current [0.10, 0.20, 0.30, 0.40]

STEP 1  (0.10 − 0.25) × ln(0.40) = −0.15 × −0.9163 = 0.1374
STEP 2  (0.20 − 0.25) × ln(0.80) = −0.05 × −0.2231 = 0.0112
STEP 3  (0.30 − 0.25) × ln(1.20) =  0.05 ×  0.1823 = 0.0091
STEP 4  (0.40 − 0.25) × ln(1.60) =  0.15 ×  0.4700 = 0.0705
STEP 5  PSI = 0.2282

ANSWER  ≈ 0.23: moderate shift by the common rule of thumb`),
cav:['Thresholds (< 0.1 stable, 0.1–0.25 moderate, > 0.25 major) are an industry convention, not a statistical test; Evidently’s psi method defaults to a 0.1 threshold.','PSI depends on binning; fix the bins from the reference set.','For LLM inputs, compute drift on embeddings, topic labels, languages (Arabic vs English share) or prompt lengths.']}),

F({id:'f-burn-rate',title:'Error-budget burn rate',lesson:'v2-ai-observability',
f:`
                observed error rate
burn rate  =  ──────────────────────
                    1 − SLO

                          burn rate × alert window
budget consumed  =  ─────────────────────────────
                         SLO period`,
vars:[['SLO','target, e.g. 0.999'],['error rate','bad events / total events in the window (errors, or requests outside the latency SLO)'],['SLO period','e.g. 30 days = 720 h']],
ex:formula(`
SLO 99.9 % over 30 days (budget 0.1 %)

STEP 1  error rate 1.44 %  → burn = 0.0144 / 0.001     = 14.4
STEP 2  in 1 h it consumes 14.4 × 1 / 720              = 2 % of the budget
STEP 3  at that rate the budget lasts 30 / 14.4        ≈ 2.1 days

Google SRE Workbook multiwindow alerts (99.9 %):
  page   1 h long / 5 m short,  burn 14.4  (2 % budget)
  page   6 h / 30 m,            burn 6     (5 %)
  ticket 3 d / 6 h,             burn 1     (10 %)

ANSWER  burn 14.4 pages someone; both windows must exceed the threshold`),
cav:['For LLMs define "bad" carefully: 5xx, timeouts, TTFT over the SLO, guardrail false blocks, empty answers.','Low-traffic services make burn rates noisy; use minimum request counts.']}),

F({id:'f-availability',title:'Availability of serial and redundant components',lesson:'v2-multi-region',
f:`
serial (all must work):        A = A₁ × A₂ × … × Aₙ

redundant (any one suffices):  A = 1 − (1 − A₁)(1 − A₂)…(1 − Aₙ)`,
vars:[['Aᵢ','availability of component i (fraction of time up), assumed independent']],
ex:formula(`
Gateway 0.999, model service 0.9995, vector DB 0.999 in series

STEP 1  0.999 × 0.9995           = 0.9985005
STEP 2  × 0.999                  = 0.9975020  → 99.75 % (≈ 1.8 h down per 30 days)

Two independent regions of 0.9975 each
STEP 3  1 − (0.0025)²            = 1 − 0.00000625 = 0.99999375

ANSWER  chains lose nines; redundancy adds them, IF failures are independent`),
cav:['Shared dependencies (one identity provider, one DNS, one model provider) break the independence assumption.','Downtime per 30 days = (1 − A) × 720 h.']}),

F({id:'f-vector-storage',title:'Vector index storage',lesson:'v2-rag-fundamentals',
f:`
raw vectors  = n × dims × bytes_per_dim

HNSW links   ≈ n × 2m × bytes_per_id        (layer 0 keeps up to 2m neighbours)

total        ≈ raw vectors + links + metadata + replicas`,
vars:[['n','number of chunks/vectors'],['dims','embedding dimension (e.g. 1024)'],['bytes_per_dim','4 float32, 2 halfvec/float16, 1 int8, 1/8 binary'],['m','HNSW connectivity (pgvector default 16)']],
ex:formula(`
10 M chunks, 1,024 dims, m = 16, 4-byte ids

STEP 1  float32     10⁷ × 1,024 × 4    = 40.96 GB
STEP 2  halfvec     10⁷ × 1,024 × 2    = 20.48 GB
STEP 3  HNSW links  10⁷ × 32 × 4       ≈ 1.28 GB
STEP 4  2 replicas of halfvec + links  ≈ 2 × 21.8 = 43.5 GB

ANSWER  ≈ 22 GB per copy at half precision; keep it in RAM for low latency`),
cav:['Engines differ in overhead; measure on a sample index.','Binary/int8 quantization cuts memory sharply but needs a rescoring step to keep recall.','Changing the embedding model means re-embedding every chunk: a full rebuild cost.']}),

F({id:'f-spec-decoding',title:'Speculative decoding: expected tokens per step',lesson:'v1-quantization-speculative',
f:`
                                 1 − α^(k+1)
E[tokens per target step]  =  ─────────────
                                  1 − α

                     1 − α^(k+1)
speed-up  ≈  ──────────────────────────
              (1 − α) × (k × c + 1)`,
vars:[['α','probability a drafted token is accepted (assumed independent per position)'],['k','draft tokens proposed per step'],['c','cost of one draft step ÷ cost of one target step']],
ex:formula(`
α = 0.8, k = 4, c = 0.05

STEP 1  α⁵ = 0.32768
STEP 2  E  = (1 − 0.32768) / 0.2       = 3.36 tokens per target step
STEP 3  cost per step  4 × 0.05 + 1    = 1.2
STEP 4  speed-up       3.36 / 1.2      ≈ 2.8×

α = 0.5 (harder text), same k, c
STEP 5  E = (1 − 0.03125) / 0.5 = 1.94;  speed-up 1.94 / 1.2 ≈ 1.6×

ANSWER  gains track acceptance rate; measure α on YOUR traffic`),
cav:['Output distribution is unchanged (lossless) with the standard rejection-sampling scheme (Leviathan et al.; Chen et al.).','At high batch the GPU is less memory-bound, so the extra verification work erodes the speed-up.','Formula from Leviathan et al., arXiv 2211.17192.']}),

F({id:'f-gpu-count',title:'GPUs per replica from memory',lesson:'v2-distributed-inference',
f:`
                  ⌈ weights + KV budget needed + overhead ⌉
GPUs per replica = ⌈ ───────────────────────────────────── ⌉ , rounded up to a valid TP size
                  ⌈        HBM per GPU × u               ⌉`,
vars:[['KV budget needed','KV bytes per token × tokens you want resident (concurrency × average context)'],['u','usable fraction (engine setting)'],['valid TP size','a divisor of attention heads, usually 1, 2, 4 or 8']],
ex:formula(`
70B BF16 (140 GB), want 64 sequences × 4,096 tokens resident, 320 KiB/token

STEP 1  KV       64 × 4,096 × 327,680 B   ≈ 85.9 GB
STEP 2  total    140 + 85.9 + 8 (overhead, ILLUSTRATIVE) ≈ 233.9 GB
STEP 3  H100 80 GB × 0.92 = 73.6 GB per GPU → 233.9 / 73.6 = 3.18 → 4 GPUs (TP = 4)
STEP 4  H200 141 GB × 0.92 = 129.7 GB → 1.80 → 2 GPUs (TP = 2)

ANSWER  4 × H100 or 2 × H200 per replica for that concurrency target`),
cav:['More TP adds all-reduce cost per layer; within one NVLink node it is usually acceptable, across nodes it rarely is.','FP8 weights halve the 140 GB term and may halve the GPU count.']})
]);
})();
