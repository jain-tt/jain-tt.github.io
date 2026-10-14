/* Animations for Volume 1, Parts 1–3 (foundations, LLMs, training) */
(function(){

/* ---------- 1. The training loop ---------- */
Anim.register({
  id:'v1-nn-train-loop', title:'One training step: forward → loss → backward → update → checkpoint', w:960, h:420,
  elements:[
    {type:'node', id:'batch', x:40, y:60, w:130, h:60, label:'Batch', sub:'inputs + targets', icon:'db'},
    {type:'node', id:'fwd', x:200, y:60, w:150, h:60, label:'Forward', sub:'layers → ŷ', icon:'bolt'},
    {type:'node', id:'loss', x:380, y:60, w:130, h:60, label:'Loss', sub:'one number', icon:'chart'},
    {type:'node', id:'bwd', x:540, y:60, w:150, h:60, label:'Backward', sub:'chain rule', icon:'gear'},
    {type:'node', id:'opt', x:720, y:60, w:200, h:60, label:'Optimizer step', sub:'AdamW: w ← w − η·…', icon:'gear'},
    {type:'node', id:'ckpt', x:720, y:200, w:200, h:60, label:'Checkpoint', sub:'weights + optimizer + RNG', icon:'doc'},
    {type:'edge', id:'e1', from:'batch', to:'fwd'},
    {type:'edge', id:'e2', from:'fwd', to:'loss'},
    {type:'edge', id:'e3', from:'loss', to:'bwd'},
    {type:'edge', id:'e4', from:'bwd', to:'opt'},
    {type:'edge', id:'e5', from:'opt', to:'fwd', path:'M820,120 C820,170 275,170 275,120', label:'next step'},
    {type:'edge', id:'e6', from:'opt', to:'ckpt', fromSide:'bottom', toSide:'top', label:'every N steps'},
    {type:'chart', id:'curve', x:90, y:190, w:420, h:95, xmax:1000, ymax:12, xlabel:'training step', ylabel:'loss', series:[{id:'s', label:'training loss', points:[]}]},
    {type:'counter', id:'step', x:545, y:200, label:'Step', value:'1'},
    {type:'counter', id:'lossv', x:545, y:250, label:'Loss', value:'—'},
    {type:'mem', id:'mem', x:40, y:340, w:880, h:40, label:'GPU memory during this step (proportions illustrative)', segs:[{frac:.2,cls:'w',label:'weights'},{frac:.8,cls:'free',label:'free'}]}
  ],
  steps:[
    {caption:'A <b>batch</b> of examples (for an LLM: token sequences, with each target being the next token) is copied to the GPU. The weights are already resident.', hl:['batch'], packets:[{edge:'e1',label:'batch'}], dur:3500},
    {caption:'<b>Forward pass</b>: the batch flows through every layer (mostly matrix multiplications). Each layer’s output — an <i>activation</i> — is <b>saved</b>, because backward will need it. Activation memory grows with batch size × sequence length.', hl:['fwd'], packets:[{edge:'e2',label:'ŷ'}], set:{mem:{segs:[{frac:.2,cls:'w',label:'weights'},{frac:.35,cls:'act',label:'saved activations'},{frac:.45,cls:'free',label:'free'}]}}, dur:4200},
    {caption:'The <b>loss</b> compares predictions with targets. For a fresh LLM with a 128,256-token vocabulary it starts near ln(128,256) ≈ 11.8 — the model is guessing uniformly.', hl:['loss'], set:{lossv:{value:'11.8'}, curve:{s:[[0,11.8],[4,11.6]]}}, dur:3800},
    {caption:'<b>Backward pass</b>: autograd applies the chain rule from the loss back through every layer, producing one <b>gradient</b> per parameter. Activations are freed as soon as their layer is done; gradients take their place.', hl:['bwd'], packets:[{edge:'e3',label:'∂L'}], set:{mem:{segs:[{frac:.2,cls:'w',label:'weights'},{frac:.12,cls:'act',label:'act'},{frac:.2,cls:'grad',label:'gradients'},{frac:.48,cls:'free',label:'free'}]}}, dur:4200},
    {caption:'<b>Optimizer step</b>: AdamW updates each weight using its gradient plus two running averages (m, v) it keeps per parameter — 8 extra bytes each in FP32. This optimizer state is often the largest memory item in full fine-tuning.', hl:['opt'], packets:[{edge:'e4',label:'grads'}], set:{mem:{segs:[{frac:.2,cls:'w',label:'weights'},{frac:.2,cls:'grad',label:'gradients'},{frac:.4,cls:'opt',label:'optimizer state m, v'},{frac:.2,cls:'free',label:'free'}]}}, dur:4500},
    {caption:'Gradients are <b>zeroed</b> (PyTorch accumulates them otherwise) and the next batch starts. Step 2: loss already lower. One step on a large GPU cluster takes seconds; a pretraining run is hundreds of thousands of steps.', hl:['fwd'], packets:[{edge:'e5',label:'next'}], set:{step:{value:'2'}, lossv:{value:'9.5'}, curve:{s:[[0,11.8],[10,9.5]]}}, dur:4000},
    {caption:'After 1,000 steps the loss curve flattens. A falling <b>training</b> loss only proves the model fits this data; a separate <b>validation</b> loss on held-out data tells you whether it generalises.', set:{step:{value:'1,000'}, lossv:{value:'2.8'}, curve:{s:[[0,11.8],[10,9.5],[50,6.5],[150,4.5],[400,3.4],[700,3.0],[1000,2.8]]}}, hl:['curve'], dur:4500},
    {caption:'Every N steps the job writes a <b>checkpoint</b>: weights, optimizer state, learning-rate scheduler, gradient scaler, RNG states, step number and data position. Weights alone are enough for inference but <i>not</i> to resume training exactly.', hl:['ckpt'], ok:['ckpt'], packets:[{edge:'e6',label:'save',cls:'c-ok'}], dur:4500},
    {caption:'A node fails at step 1,370. The job restarts from the step-1,000 checkpoint and loses only 370 steps. Without optimizer and data-loader state, the resumed run would behave differently (loss spike) — a resumable checkpoint is what makes preemptible or spot GPUs usable.', bad:['fwd'], ok:['ckpt'], packets:[{edge:'e6',label:'restore',reverse:true,cls:'c-blue'}], set:{step:{value:'1,370 → 1,000'}}, dur:5000}
  ]
});

/* ---------- 2. Backprop on a two-weight network ---------- */
Anim.register({
  id:'v1-nn-backprop', title:'Backpropagation by hand: two weights, every number', w:960, h:420,
  elements:[
    {type:'node', id:'nx', x:40, y:80, w:130, h:64, label:'x = 2', sub:'input'},
    {type:'node', id:'nh', x:260, y:80, w:170, h:64, label:'h = w₁ · x', sub:'hidden'},
    {type:'node', id:'ny', x:500, y:80, w:170, h:64, label:'ŷ = w₂ · h', sub:'output'},
    {type:'node', id:'nl', x:740, y:80, w:180, h:64, label:'L = (ŷ − y)²', sub:'target y = 10'},
    {type:'edge', id:'e1', from:'nx', to:'nh', label:'w₁ = 1.5'},
    {type:'edge', id:'e2', from:'nh', to:'ny', label:'w₂ = 2.0'},
    {type:'edge', id:'e3', from:'ny', to:'nl'},
    {type:'counter', id:'ch', x:40, y:200, label:'h', value:'?'},
    {type:'counter', id:'cy', x:200, y:200, label:'ŷ', value:'?'},
    {type:'counter', id:'cl', x:360, y:200, label:'L', value:'?'},
    {type:'counter', id:'cg2', x:520, y:200, label:'∂L/∂w₂', value:'?'},
    {type:'counter', id:'cg1', x:740, y:200, label:'∂L/∂w₁', value:'?'},
    {type:'counter', id:'cdy', x:40, y:290, label:'∂L/∂ŷ', value:'?'},
    {type:'counter', id:'cdh', x:200, y:290, label:'∂L/∂h', value:'?'},
    {type:'counter', id:'cw', x:360, y:290, label:'weights after update (η = 0.01)', value:'w₁ = 1.5, w₂ = 2.0'},
    {type:'counter', id:'cl2', x:740, y:290, label:'loss after update', value:'?'},
    {type:'label', id:'note', x:40, y:380, text:'Forward pass: left to right. Backward pass: right to left, multiplying local derivatives (chain rule).'}
  ],
  steps:[
    {caption:'A tiny network: input x = 2, hidden h = w₁·x, output ŷ = w₂·h, squared-error loss against target y = 10. Start: w₁ = 1.5, w₂ = 2.0, learning rate η = 0.01.', hl:['nx'], dur:3800},
    {caption:'<b>Forward 1</b>: h = w₁·x = 1.5 × 2 = <b>3.0</b>. PyTorch saves h, because the gradient of w₂ will need it.', hl:['nh'], packets:[{edge:'e1',label:'2'}], set:{ch:{value:'3.0'}}, dur:3500},
    {caption:'<b>Forward 2</b>: ŷ = w₂·h = 2.0 × 3.0 = <b>6.0</b>. Then the loss: L = (6 − 10)² = <b>16</b>.', hl:['ny','nl'], packets:[{edge:'e2',label:'3.0'},{edge:'e3',label:'6.0',delay:500}], set:{cy:{value:'6.0'}, cl:{value:'16.0'}}, dur:4000},
    {caption:'<b>Backward starts at the loss</b>: ∂L/∂ŷ = 2(ŷ − y) = 2 × (6 − 10) = <b>−8</b>. Negative means "a larger ŷ would lower the loss".', hl:['nl'], packets:[{edge:'e3',label:'−8',reverse:true,cls:'c-purple'}], set:{cdy:{value:'−8'}}, dur:4000},
    {caption:'At the output node: ∂L/∂w₂ = ∂L/∂ŷ · h = −8 × 3 = <b>−24</b>. The error passed further back is ∂L/∂h = ∂L/∂ŷ · w₂ = −8 × 2 = <b>−16</b>.', hl:['ny'], packets:[{edge:'e2',label:'−16',reverse:true,cls:'c-purple'}], set:{cg2:{value:'−24'}, cdh:{value:'−16'}}, dur:4500},
    {caption:'At the hidden node: ∂L/∂w₁ = ∂L/∂h · x = −16 × 2 = <b>−32</b>. Note the reuse of −16 from the previous step: that reuse is why backward costs about 2× forward instead of once per weight.', hl:['nh'], packets:[{edge:'e1',label:'−32',reverse:true,cls:'c-purple'}], set:{cg1:{value:'−32'}}, dur:4500},
    {caption:'<b>Update</b> each weight against its gradient: w₂ = 2.0 − 0.01 × (−24) = <b>2.24</b>; w₁ = 1.5 − 0.01 × (−32) = <b>1.82</b>.', ok:['nh','ny'], set:{cw:{value:'w₁ = 1.82, w₂ = 2.24'}}, dur:4200},
    {caption:'<b>Check</b>: forward again. h = 1.82 × 2 = 3.64, ŷ = 2.24 × 3.64 = 8.1536, L = (8.1536 − 10)² ≈ <b>3.41</b>. One step cut the loss from 16 to 3.41. An LLM does exactly this for billions of weights per step.', ok:['nl'], packets:[{edge:'e1',label:'2'},{edge:'e2',label:'3.64',delay:400},{edge:'e3',label:'8.15',delay:800}], set:{ch:{value:'3.64'}, cy:{value:'8.15'}, cl2:{value:'3.41 (was 16.0)'}}, dur:5000},
    {caption:'Same start but η = 0.05: w₂ = 3.2, w₁ = 3.1, ŷ = 19.84, L = 96.8. The step overshot the minimum and the loss went <b>up</b>. The learning rate is the knob that decides between learning and diverging.', bad:['nl'], set:{cw:{value:'η = 0.05 → w₁ = 3.1, w₂ = 3.2'}, cl2:{value:'96.8 — overshoot'}}, dur:5000}
  ]
});

/* ---------- 3. Gradient descent on a loss curve ---------- */
var curve=[];for(var i=0;i<=24;i++){var w=i*0.25;curve.push([w,(2*w-6)*(2*w-6)]);}
Anim.register({
  id:'v1-nn-gradient-descent', title:'Gradient descent: the learning rate decides converge, oscillate or diverge', w:960, h:420,
  elements:[
    {type:'chart', id:'ch', cls:'v1gd', x:80, y:40, w:520, h:310, xmax:6, ymax:40, xlabel:'weight w (minimum at w = 3)', ylabel:'loss L(w) = (2w − 6)²', series:[{id:'curve', label:'loss curve', points:curve},{id:'run', label:'path of w', color:'#d97706', points:[[1,16]]}]},
    {type:'counter', id:'eta', x:660, y:50, label:'learning rate η', value:'0.05'},
    {type:'counter', id:'w', x:660, y:120, label:'w', value:'1.0'},
    {type:'counter', id:'g', x:660, y:190, label:'gradient ∂L/∂w = 8w − 24', value:'−16'},
    {type:'counter', id:'l', x:660, y:260, label:'loss', value:'16.0'},
    {type:'label', id:'reg', x:660, y:340, text:'regime: —'}
  ],
  steps:[
    {caption:'One weight, one example: ŷ = 2w, target 6, loss L = (2w − 6)². The minimum is at w = 3. We start at w = 1 where L = 16 and the gradient is 8·1 − 24 = −16 (downhill is to the right).', dur:4000},
    {caption:'η = 0.05: w ← 1 − 0.05 × (−16) = <b>1.8</b>, L = 5.76. Big gradient → big step.', set:{ch:{run:[[1,16],[1.8,5.76]]}, w:{value:'1.8'}, g:{value:'−9.6'}, l:{value:'5.76'}, reg:{text:'regime: converging'}}, dur:3600},
    {caption:'Next: w ← 1.8 − 0.05 × (−9.6) = <b>2.28</b>, L = 2.07. The slope is gentler near the bottom, so steps shrink automatically.', set:{ch:{run:[[1,16],[1.8,5.76],[2.28,2.07]]}, w:{value:'2.28'}, g:{value:'−5.76'}, l:{value:'2.07'}}, dur:3600},
    {caption:'Two more steps: w = 2.568 (L = 0.75), then 2.741 (L = 0.27). The path settles into the minimum at w = 3.', ok:['ch'], set:{ch:{run:[[1,16],[1.8,5.76],[2.28,2.07],[2.568,0.75],[2.741,0.27],[2.85,0.09],[2.92,0.03]]}, w:{value:'2.92'}, g:{value:'−0.64'}, l:{value:'0.03'}}, dur:4000},
    {caption:'Restart at w = 1 with <b>η = 0.25</b>: w ← 1 − 0.25 × (−16) = <b>5</b>. L = (10 − 6)² = 16 — no better. We jumped clean over the minimum.', warn:['ch'], set:{eta:{value:'0.25'}, ch:{run:[[1,16],[5,16]]}, w:{value:'5.0'}, g:{value:'+16'}, l:{value:'16.0'}, reg:{text:'regime: oscillating'}}, dur:4200},
    {caption:'From w = 5 the gradient is +16, so w ← 5 − 4 = <b>1</b>. Back where we started. It bounces between 1 and 5 forever: the loss curve of such a run is a flat, noisy line.', warn:['ch'], set:{ch:{run:[[1,16],[5,16],[1,16],[5,16]]}, w:{value:'1.0 ↔ 5.0'}}, dur:4200},
    {caption:'<b>η = 0.30</b>: w ← 1 + 4.8 = 5.8, L = 31.4; then gradient +22.4 sends w to −0.92 with L = 61.5 (off this chart). Each step is worse: <b>divergence</b>. In real training this ends as inf or NaN.', bad:['ch'], set:{eta:{value:'0.30'}, ch:{run:[[1,16],[5.8,31.36]]}, w:{value:'5.8 → −0.92'}, g:{value:'+22.4'}, l:{value:'31.4 → 61.5'}, reg:{text:'regime: diverging'}}, dur:4500},
    {caption:'Real loss surfaces have billions of dimensions and their curvature changes during training. That is why LLM training uses a <b>warmup</b> (small η first), a <b>decay</b> schedule, <b>gradient clipping</b> and AdamW’s per-parameter scaling instead of one fixed η.', set:{eta:{value:'warmup → peak → decay'}, ch:{run:[[1,16],[1.8,5.76],[2.28,2.07],[2.568,0.75],[2.741,0.27],[2.85,0.09],[2.92,0.03]]}, w:{value:'≈ 3'}, g:{value:'≈ 0'}, l:{value:'≈ 0'}, reg:{text:'regime: scheduled'}}, ok:['ch'], dur:4500}
  ]
});

/* ---------- 4. PyTorch op → kernel dispatch ---------- */
Anim.register({
  id:'v1-pt-dispatch', title:'From y = x @ w to a GPU kernel: the PyTorch dispatch path', w:960, h:440,
  elements:[
    {type:'node', id:'py', x:40, y:20, w:300, h:50, label:'Python: y = x @ w', sub:'inside torch.autocast("cuda")', icon:'doc'},
    {type:'zone', id:'dz', x:20, y:95, w:620, h:115, label:'Dispatcher: aten::mm, keys tried in priority order'},
    {type:'node', id:'kag', x:40, y:130, w:170, h:62, label:'Autograd key', sub:'record MmBackward0'},
    {type:'node', id:'kac', x:240, y:130, w:170, h:62, label:'Autocast key', sub:'FP32 → BF16'},
    {type:'node', id:'kcu', x:440, y:130, w:180, h:62, label:'CUDA key', sub:'ATen CUDA mm'},
    {type:'node', id:'graph', x:40, y:245, w:250, h:56, label:'Autograd graph', sub:'grad_fn, saves x and w', icon:'gear'},
    {type:'node', id:'alloc', x:700, y:130, w:220, h:62, label:'Caching allocator', sub:'reuse a free block for y', icon:'memory'},
    {type:'node', id:'blas', x:440, y:245, w:180, h:56, label:'cuBLAS GEMM', sub:'Tensor Core kernel', icon:'bolt'},
    {type:'node', id:'stream', x:440, y:350, w:180, h:56, label:'CUDA stream', sub:'FIFO queue of kernels', icon:'queue'},
    {type:'node', id:'gpu', x:700, y:350, w:220, h:56, label:'GPU', sub:'SMs read x, w from HBM', icon:'gpu'},
    {type:'edge', id:'e1', from:'py', to:'kag', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'e2', from:'kag', to:'kac'},
    {type:'edge', id:'e3', from:'kac', to:'kcu'},
    {type:'edge', id:'e4', from:'kag', to:'graph', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'e5', from:'kcu', to:'alloc'},
    {type:'edge', id:'e6', from:'kcu', to:'blas', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'e7', from:'blas', to:'stream', fromSide:'bottom', toSide:'top', label:'launch'},
    {type:'edge', id:'e8', from:'stream', to:'gpu'},
    {type:'counter', id:'cpu', x:40, y:340, label:'CPU (Python thread)', value:'running line: y = x @ w'},
    {type:'label', id:'cmp', x:700, y:250, text:'torch.compile path:\nDynamo graph → Inductor\n→ fused Triton kernels', hidden:true}
  ],
  steps:[
    {caption:'Python calls <code>torch.matmul</code>. It is a thin binding: the real work is the C++ operator <code>aten::mm</code>, routed by the <b>dispatcher</b>.', hl:['py'], packets:[{edge:'e1',label:'aten::mm'}], dur:3600},
    {caption:'<b>Autograd key</b> first: w requires grad, so a graph node (MmBackward0) is recorded and x and w are saved for the backward pass. In <code>torch.no_grad()</code> or inference mode this layer is skipped and nothing is saved.', hl:['kag','graph'], packets:[{edge:'e4',label:'node'}], dur:4200},
    {caption:'<b>Autocast key</b>: inside <code>torch.autocast</code>, matmuls run in BF16, so FP32 inputs are cast down. Same Python code, different precision, chosen by mode rather than by the model author.', hl:['kac'], packets:[{edge:'e2',label:'call'}], dur:3800},
    {caption:'<b>Backend key</b>: the inputs are CUDA tensors, so the CUDA implementation of ATen’s mm is selected. The same operator has CPU, CUDA and other backend implementations.', hl:['kcu'], packets:[{edge:'e3',label:'BF16'}], dur:3800},
    {caption:'The output y needs memory. The <b>caching allocator</b> hands out a block it already holds (no slow cudaMalloc). This is why nvidia-smi shows more memory than live tensors use.', hl:['alloc'], packets:[{edge:'e5',label:'y buffer'}], dur:3800},
    {caption:'ATen calls <b>cuBLAS</b>, which picks a GEMM kernel for these shapes and dtype — one that uses Tensor Cores for BF16.', hl:['blas'], packets:[{edge:'e6',label:'gemm'}], dur:3600},
    {caption:'The kernel is <b>enqueued</b> on the current CUDA stream and the call returns. Python moves on to the next line in microseconds; the GPU has not finished — maybe not even started.', hl:['stream'], packets:[{edge:'e7',label:'kernel'}], set:{cpu:{value:'already on the next line (async)'}}, dur:4200},
    {caption:'The GPU executes queued kernels in order on that stream, reading x and w from HBM and writing y. The CPU keeps queueing more work meanwhile — this overlap is how PyTorch keeps the GPU busy.', busy:['gpu'], packets:[{edge:'e8',label:'run'}], dur:3800},
    {caption:'Then the code calls <code>loss.item()</code>. The CPU needs a GPU value, so it <b>blocks</b> until the stream drains: a synchronisation point. One per step is fine; many per step starve the GPU.', warn:['py'], bad:['stream'], set:{cpu:{value:'BLOCKED at .item() — waiting for GPU'}}, dur:4200},
    {caption:'With <b>torch.compile</b>, Dynamo captures many such ops into a graph once and Inductor emits fused Triton kernels: fewer launches and fewer trips to HBM. CUDA Graphs can replay the whole sequence with one launch.', show:['cmp'], ok:['gpu'], set:{cpu:{value:'compiled: fewer, larger kernels'}}, dur:4500}
  ]
});

/* ---------- 5. Tokenization (BPE) ---------- */
Anim.register({
  id:'v1-tok-bpe', title:'Byte-pair encoding: learning merges, then turning text into token IDs', w:960, h:420,
  elements:[
    {type:'label', id:'corpus', x:40, y:28, text:'Training corpus (word × count):  low ×5   lower ×2   newest ×6   widest ×3'},
    {type:'label', id:'vocl', x:40, y:62, text:'Vocabulary'},
    {type:'tokens', id:'voc', x:40, y:76, h:26, items:['d','e','i','l','n','o','r','s','t','w']},
    {type:'counter', id:'merge', x:40, y:130, label:'Merge rules learned (applied in this order)', value:'none yet'},
    {type:'counter', id:'pair', x:560, y:130, label:'Most frequent adjacent pair', value:'—'},
    {type:'label', id:'encl', x:40, y:205, text:'Encode a new word: "lowest"'},
    {type:'tokens', id:'enc', x:40, y:220, h:28, items:['l','o','w','e','s','t']},
    {type:'label', id:'idsl', x:40, y:285, text:'Token IDs (position in the vocabulary)'},
    {type:'tokens', id:'ids', x:40, y:300, h:28, items:['?']},
    {type:'counter', id:'cnt', x:560, y:220, label:'Tokens for this text', value:'6'},
    {type:'label', id:'note', x:40, y:375, text:'', hidden:true}
  ],
  steps:[
    {caption:'BPE starts from single symbols. Here the base vocabulary is the 10 characters of the corpus (real byte-level BPE starts from all 256 byte values, so nothing is ever "unknown").', hl:['voc'], dur:3800},
    {caption:'Count adjacent pairs, weighted by word frequency. <b>e+s</b> appears 9 times (newest 6 + widest 3), tied with s+t. Merge it: <b>"es"</b> becomes a new vocabulary entry and merge rule #1.', set:{pair:{value:'e s → 9'}, merge:{value:'1. e+s'}, voc:{items:['d','e','i','l','n','o','r','s','t','w',{t:'es',cls:'new'}]}}, dur:4200},
    {caption:'Recount on the merged corpus. Now <b>es+t</b> appears 9 times → rule #2 creates <b>"est"</b>.', set:{pair:{value:'es t → 9'}, merge:{value:'1. e+s   2. es+t'}, voc:{items:['d','e','i','l','n','o','r','s','t','w','es',{t:'est',cls:'new'}]}}, dur:3800},
    {caption:'Next most frequent: <b>l+o</b> (7: low 5 + lower 2) → "lo", then <b>lo+w</b> (7) → "low". Training repeats until the vocabulary reaches the target size (Llama 3: 128,256 entries; most are merges learned from a huge multilingual corpus).', set:{pair:{value:'l o → 7, then lo w → 7'}, merge:{value:'1. e+s  2. es+t  3. l+o  4. lo+w'}, voc:{items:['d','e','i','l','n','o','r','s','t','w','es','est',{t:'lo',cls:'new'},{t:'low',cls:'new'}]}}, dur:4500},
    {caption:'<b>Encoding</b> "lowest" replays the merges in order: l o w e s t → l o w <b>es</b> t → l o w <b>est</b> → <b>lo</b> w est → <b>low est</b>. Six characters became two tokens — a word never seen in training is still encoded efficiently.', hl:['enc'], set:{enc:{items:[{t:'low',cls:'hl'},{t:'est',cls:'hl'}]}, cnt:{value:'2'}}, dur:4500},
    {caption:'Each token is replaced by its <b>ID</b> — its index in the vocabulary (d=0 … w=9, es=10, est=11, lo=12, low=13). The model only ever sees the integers <b>[13, 11]</b>; the embedding table turns each ID into a vector.', hl:['ids'], set:{ids:{items:[{t:'13',cls:'new'},{t:'11',cls:'new'}]}}, dur:4200},
    {caption:'Now encode <b>"Riyadh"</b>. None of its letters were common in this corpus, so no merges apply and (with byte fallback) it costs one token per byte. This is exactly why languages under-represented in a tokenizer’s training data — often Arabic for older or English-centric tokenizers — need <b>more tokens for the same meaning</b>.', warn:['enc','cnt'], set:{encl:{text:'Encode a word the merges never saw: "Riyadh"'}, enc:{items:['R','i','y','a','d','h']}, ids:{items:['byte','byte','byte','byte','d=0','byte']}, cnt:{value:'6 (one per byte)'}}, dur:5000},
    {caption:'More tokens means more cost (priced per token), more KV-cache memory, longer prefill and less room in the context window. Always <b>measure</b> token counts per language with the exact tokenizer you deploy; never assume English ratios.', show:['note'], set:{note:{text:'Same text, different tokenizer → different token count, cost and latency. The tokenizer is part of the model contract.'}}, dur:4500}
  ]
});

/* ---------- 6. Self-attention with causal mask ---------- */
var N=null;
Anim.register({
  id:'v1-tf-attention', title:'Self-attention: scores, causal mask, softmax, weighted sum', w:960, h:440,
  elements:[
    {type:'tokens', id:'seq', x:40, y:24, h:28, items:['The','server','is','down']},
    {type:'label', id:'gl', x:40, y:84, text:'rows = query token,  columns = key token'},
    {type:'grid', id:'att', x:120, y:120, rows:4, cols:4, cell:58, rowLabels:['The','server','is','down'], colLabels:['The','server','is','down'], values:[[N,N,N,N],[N,N,N,N],[N,N,N,N],[N,N,N,N]], maskNull:true, showValues:true},
    {type:'label', id:'qk', x:420, y:120, text:'Row "down":  sᵢ = q(down) · k(i) / √dₖ   (dₖ = 4, √dₖ = 2)'},
    {type:'counter', id:'cs', x:420, y:160, label:'scaled scores [The, server, is, down]', value:'—'},
    {type:'counter', id:'ce', x:420, y:225, label:'exp(score)', value:'—'},
    {type:'counter', id:'cw', x:420, y:290, label:'softmax weights (sum = 1)', value:'—'},
    {type:'counter', id:'co', x:420, y:355, label:'output vector for "down"', value:'—'}
  ],
  steps:[
    {caption:'Each token’s vector is projected three ways: a <b>query</b> q ("what am I looking for?"), a <b>key</b> k ("what do I contain?") and a <b>value</b> v ("what do I pass on?"). Here dₖ = 4.', hl:['seq'], dur:3800},
    {caption:'Every query is dotted with every key and divided by √dₖ = 2. Bigger score = more relevant. This 4 × 4 matrix is why attention cost grows with sequence length <b>squared</b>. (Scores illustrative; row "down" is the worked example.)', set:{att:{values:[[0.8,0.3,0.1,0.9],[0.2,1.0,0.4,1.2],[0.1,1.5,0.6,0.7],[0.5,3.0,1.0,2.0]]}}, hl:['att'], dur:4500},
    {caption:'Problem: the row for "The" has scores for "server", "is" and "down" — tokens that come <b>after</b> it. During training the model would be reading the answer it must predict.', warn:['att'], dur:4000},
    {caption:'The <b>causal mask</b> sets every future position (above the diagonal) to −∞ before softmax, so its weight becomes exactly 0. Token i may only attend to tokens 1…i.', set:{att:{values:[[0.8,N,N,N],[0.2,1.0,N,N],[0.1,1.5,0.6,N],[0.5,3.0,1.0,2.0]]}}, ok:['att'], dur:4200},
    {caption:'Worked row "down": q = [1, 2, 0, 1]; raw dot products with the four keys are 1, 6, 2, 4; divided by √4 = 2 gives <b>[0.5, 3.0, 1.0, 2.0]</b>.', hl:['cs'], set:{cs:{value:'[0.5, 3.0, 1.0, 2.0]'}}, dur:4200},
    {caption:'Exponentiate: e⁰·⁵ = 1.65, e³ = 20.09, e¹ = 2.72, e² = 7.39. Sum = 31.84.', hl:['ce'], set:{ce:{value:'[1.65, 20.09, 2.72, 7.39]  sum 31.84'}}, dur:4000},
    {caption:'Divide by the sum: weights <b>[0.05, 0.63, 0.09, 0.23]</b>. "down" pays 63 % of its attention to "server" — the thing that is down.', hl:['cw'], set:{cw:{value:'[0.05, 0.63, 0.09, 0.23]'}, att:{values:[[0.8,N,N,N],[0.2,1.0,N,N],[0.1,1.5,0.6,N],[0.05,0.63,0.09,0.23]]}}, dur:4200},
    {caption:'Softmax every row. Each row sums to 1 and contains only past-or-present tokens. "The" can only attend to itself (weight 1.0).', set:{att:{values:[[1.0,N,N,N],[0.31,0.69,N,N],[0.15,0.60,0.25,N],[0.05,0.63,0.09,0.23]]}}, ok:['att'], dur:4000},
    {caption:'Output for "down" = 0.05·v(The) + 0.63·v(server) + 0.09·v(is) + 0.23·v(down): a new vector that blends in context, mostly from "server". This mixing is the whole point of attention.', hl:['co'], set:{co:{value:'0.05·v₁ + 0.63·v₂ + 0.09·v₃ + 0.23·v₄'}}, dur:4500},
    {caption:'<b>Multi-head</b>: another head has its own Wq, Wk, Wv and learns a different pattern — here (illustrative) "attend to the previous token". Llama-3.1-8B runs 32 such heads per layer in parallel, then concatenates their outputs.', set:{att:{values:[[1.0,N,N,N],[0.9,0.1,N,N],[0.05,0.9,0.05,N],[0.02,0.08,0.85,0.05]]}, cw:{value:'head 2: [0.02, 0.08, 0.85, 0.05]'}}, hl:['att'], dur:4500},
    {caption:'During generation only the <b>last row</b> is new: the new token’s query against all cached keys and values. Rows above never change — which is exactly why engines keep a KV cache instead of recomputing them.', hl:['att'], dur:4200}
  ]
});

/* ---------- 7. Sampling with temperature ---------- */
function bars(vals,texts){var ids=['b1','b2','b3','b4','b5'],o={};for(var i=0;i<5;i++)o[ids[i]]={value:vals[i],text:texts?texts[i]:vals[i].toFixed(2)};return o;}
function merge(a,b){var o={};for(var k in a)o[k]=a[k];for(var k2 in b)o[k2]=b[k2];return o;}
Anim.register({
  id:'v1-gen-sampling', title:'From logits to the next token: softmax, temperature, top-k, top-p', w:960, h:430,
  elements:[
    {type:'tokens', id:'prompt', x:40, y:20, h:28, items:['The','flight','to','Riyadh','is']},
    {type:'bar', id:'b1', x:70, y:100, w:90, h:220, orient:'v', thresholds:false, label:'delayed', value:0, text:''},
    {type:'bar', id:'b2', x:200, y:100, w:90, h:220, orient:'v', thresholds:false, label:'on', value:0, text:''},
    {type:'bar', id:'b3', x:330, y:100, w:90, h:220, orient:'v', thresholds:false, label:'cancelled', value:0, text:''},
    {type:'bar', id:'b4', x:460, y:100, w:90, h:220, orient:'v', thresholds:false, label:'boarding', value:0, text:''},
    {type:'bar', id:'b5', x:590, y:100, w:90, h:220, orient:'v', thresholds:false, label:'purple', value:0, text:''},
    {type:'label', id:'lg', x:40, y:350, text:'logits:        3.0               2.0               1.0               0.5              −1.0'},
    {type:'counter', id:'temp', x:730, y:100, label:'Temperature T', value:'—'},
    {type:'counter', id:'filt', x:730, y:170, label:'Filter', value:'none'},
    {type:'counter', id:'pick', x:730, y:240, label:'Chosen token', value:'—'},
    {type:'label', id:'note', x:40, y:395, text:'(5 candidate tokens shown for clarity; a real vocabulary has ≈ 128k–152k entries)'}
  ],
  steps:[
    {caption:'After the last layer, the LM head outputs one <b>logit</b> per vocabulary token for the next position. Logits are unbounded scores, not probabilities.', hl:['lg'], dur:3800},
    {caption:'<b>Softmax at T = 1</b>: pᵢ = exp(zᵢ) / Σ exp(zⱼ). exp values 20.09, 7.39, 2.72, 1.65, 0.37 (sum 32.21) → <b>0.62, 0.23, 0.08, 0.05, 0.01</b>.', set:merge(bars([0.62,0.23,0.08,0.05,0.01]),{temp:{value:'1.0'}}), dur:4500},
    {caption:'<b>Greedy</b> decoding (equivalent to T → 0) always takes the highest bar: "delayed". Deterministic given identical numerics, but prone to repetitive, bland text in long outputs.', ok:['b1'], set:{pick:{value:'delayed (greedy)'}}, dur:4000},
    {caption:'<b>T = 0.5</b>: divide logits by T before softmax → [6, 4, 2, 1, −2] → <b>0.86, 0.12, 0.02, 0.01, 0.00</b>. Low temperature sharpens the distribution toward the top token.', set:merge(bars([0.86,0.12,0.02,0.01,0.0003],['0.86','0.12','0.02','0.01','0.00']),{temp:{value:'0.5'},pick:{value:'—'}}), dur:4500},
    {caption:'<b>T = 2</b>: logits / 2 = [1.5, 1, 0.5, 0.25, −0.5] → <b>0.42, 0.25, 0.15, 0.12, 0.06</b>. High temperature flattens it; even "purple" now has a 6 % chance — more creative, more likely to be wrong.', set:merge(bars([0.42,0.25,0.15,0.12,0.06]),{temp:{value:'2.0'}}), warn:['b5'], dur:4500},
    {caption:'Back to T = 1 with <b>top-k = 2</b>: keep only the 2 most likely tokens and renormalise: 0.62 / 0.85 = <b>0.73</b>, 0.23 / 0.85 = <b>0.27</b>. Everything else gets zero.', set:merge(bars([0.73,0.27,0,0,0],['0.73','0.27','0','0','0']),{temp:{value:'1.0'},filt:{value:'top-k = 2'}}), dur:4500},
    {caption:'<b>Top-p = 0.9</b> (nucleus): keep the smallest set whose cumulative probability reaches 0.9: 0.62 + 0.23 + 0.08 = 0.94 ≥ 0.9 → keep 3, renormalise → <b>0.67, 0.24, 0.09</b>. The set size adapts to how confident the model is.', set:merge(bars([0.67,0.24,0.09,0,0],['0.67','0.24','0.09','0','0']),{filt:{value:'top-p = 0.9'}}), dur:4800},
    {caption:'<b>Sample</b>: draw a random number r = 0.75. Cumulative ranges: delayed [0, 0.67), on [0.67, 0.91), cancelled [0.91, 1). r falls in "on" — sampling does not always pick the top token.', ok:['b2'], set:{pick:{value:'on   (r = 0.75)'}}, dur:4500},
    {caption:'"on" is appended to the sequence and the whole forward pass runs again for the next token. Nothing in this loop checks facts: a fluent, high-probability token can still be false. That is the root of <b>hallucination</b>.', set:{prompt:{items:['The','flight','to','Riyadh','is',{t:'on',cls:'new'}]}}, dur:4500}
  ]
});

/* ---------- 8. Transformer block data flow ---------- */
Anim.register({
  id:'v1-tf-block', title:'Inside one decoder block (Llama-style): shapes and residual stream', w:960, h:430,
  elements:[
    {type:'node', id:'emb', x:30, y:40, w:150, h:56, label:'Embedding', sub:'IDs → [T, 4096]', icon:'db'},
    {type:'node', id:'n1', x:220, y:40, w:120, h:56, label:'RMSNorm', sub:'scale only'},
    {type:'node', id:'attn', x:380, y:40, w:190, h:56, label:'Self-attention', sub:'32 Q heads, 8 KV heads', icon:'search'},
    {type:'node', id:'add1', x:610, y:40, w:70, h:56, label:'+', sub:'residual'},
    {type:'node', id:'n2', x:220, y:200, w:120, h:56, label:'RMSNorm', sub:'scale only'},
    {type:'node', id:'ffn', x:380, y:200, w:190, h:56, label:'SwiGLU FFN', sub:'4096 → 14336 → 4096', icon:'bolt'},
    {type:'node', id:'add2', x:610, y:200, w:70, h:56, label:'+', sub:'residual'},
    {type:'node', id:'rep', x:730, y:120, w:200, h:56, label:'× 32 blocks', sub:'same shapes in and out', icon:'gear'},
    {type:'node', id:'head', x:730, y:300, w:200, h:56, label:'Final norm + LM head', sub:'[T, 4096] → [T, 128256]', icon:'chart'},
    {type:'edge', id:'e1', from:'emb', to:'n1'},
    {type:'edge', id:'e2', from:'n1', to:'attn'},
    {type:'edge', id:'e3', from:'attn', to:'add1'},
    {type:'edge', id:'e4', from:'add1', to:'n2', path:'M645,96 C645,150 280,140 280,200'},
    {type:'edge', id:'e5', from:'n2', to:'ffn'},
    {type:'edge', id:'e6', from:'ffn', to:'add2'},
    {type:'edge', id:'e7', from:'add2', to:'rep'},
    {type:'edge', id:'e8', from:'rep', to:'head', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'r1', from:'emb', to:'add1', path:'M105,40 C105,10 645,10 645,40', cls:'dash'},
    {type:'counter', id:'shape', x:30, y:300, label:'Tensor shape here (batch 1, T tokens)', value:'[T] token IDs'},
    {type:'counter', id:'params', x:30, y:360, label:'Parameters in this part (Llama-3.1-8B)', value:'—'}
  ],
  steps:[
    {caption:'Token IDs index the <b>embedding table</b> (128,256 × 4,096). Each token becomes a 4,096-number vector. This vector stream — the <b>residual stream</b> — flows through all 32 blocks.', hl:['emb'], set:{shape:{value:'[T] → [T, 4096]'}, params:{value:'128,256 × 4,096 = 525.3 M'}}, dur:4200},
    {caption:'<b>RMSNorm</b> rescales each vector to unit root-mean-square, then multiplies by a learned gain. It keeps numbers in a stable range so deep stacks train. (4,096 parameters.)', hl:['n1'], packets:[{edge:'e1'}], set:{params:{value:'4,096'}}, dur:3800},
    {caption:'<b>Self-attention</b> mixes information <i>between</i> tokens: Q, K, V projections, RoPE rotation of q and k, causal softmax, weighted sum of V, output projection. Shape in = shape out.', hl:['attn'], packets:[{edge:'e2'}], set:{params:{value:'Wq 16.8M + Wk 4.2M + Wv 4.2M + Wo 16.8M = 41.9 M'}}, dur:4500},
    {caption:'<b>Residual add</b>: the attention output is <i>added</i> to the block’s input (dashed path), not substituted. Gradients flow straight through these additions, which is what lets 32+ layers train.', hl:['add1'], packets:[{edge:'e3'},{edge:'r1',cls:'c-purple'}], dur:4200},
    {caption:'Second RMSNorm, then the <b>SwiGLU feed-forward network</b>: works on each token independently. gate and up projections widen 4,096 → 14,336, SiLU(gate) ⊙ up, down projection back to 4,096. Most of the parameters live here.', hl:['ffn'], packets:[{edge:'e4'},{edge:'e5',delay:500}], set:{params:{value:'3 × 4,096 × 14,336 = 176.2 M'}, shape:{value:'[T, 4096] → [T, 14336] → [T, 4096]'}}, dur:4800},
    {caption:'Second residual add. One block ≈ 41.9 M + 176.2 M + 8 K norms = <b>218.1 M</b> parameters. The output has the same shape as the input, so blocks stack.', hl:['add2'], packets:[{edge:'e6'}], set:{params:{value:'per block ≈ 218.1 M'}, shape:{value:'[T, 4096]'}}, dur:4200},
    {caption:'Repeat <b>32 times</b>: 32 × 218.1 M ≈ 6.98 B parameters in the blocks.', hl:['rep'], packets:[{edge:'e7'}], set:{params:{value:'32 × 218.1 M ≈ 6.98 B'}}, dur:3800},
    {caption:'Final RMSNorm and the <b>LM head</b> (4,096 × 128,256, untied from the embedding in Llama-3.1-8B) produce logits for every vocabulary token. Total: 6.98 B + 2 × 0.525 B ≈ <b>8.03 B</b> parameters.', hl:['head'], packets:[{edge:'e8',label:'logits'}], set:{shape:{value:'[T, 128256] logits'}, params:{value:'total ≈ 8.03 B'}}, dur:4800}
  ]
});

/* ---------- 9. LoRA ---------- */
Anim.register({
  id:'v1-ft-lora', title:'LoRA: freeze W, train a low-rank update B·A', w:960, h:420,
  elements:[
    {type:'node', id:'x', x:40, y:150, w:100, h:56, label:'x', sub:'[4096]'},
    {type:'node', id:'W', x:200, y:40, w:240, h:90, label:'W (pretrained)', sub:'4096 × 4096 = 16.8 M', icon:'lock'},
    {type:'node', id:'A', x:200, y:230, w:160, h:62, label:'A  (r × k)', sub:'16 × 4096, random init'},
    {type:'node', id:'B', x:400, y:230, w:160, h:62, label:'B  (d × r)', sub:'4096 × 16, zero init'},
    {type:'node', id:'sum', x:600, y:150, w:80, h:56, label:'+'},
    {type:'node', id:'out', x:720, y:150, w:200, h:56, label:'h = Wx + (α/r)·BAx'},
    {type:'edge', id:'e1', from:'x', to:'W'},
    {type:'edge', id:'e2', from:'x', to:'A'},
    {type:'edge', id:'e3', from:'A', to:'B', label:'r = 16'},
    {type:'edge', id:'e4', from:'W', to:'sum'},
    {type:'edge', id:'e5', from:'B', to:'sum'},
    {type:'edge', id:'e6', from:'sum', to:'out'},
    {type:'counter', id:'c1', x:40, y:330, label:'Trainable parameters in this matrix', value:'16,777,216 (full fine-tune)'},
    {type:'counter', id:'c2', x:470, y:330, label:'Note', value:'every weight gets a gradient + AdamW state'}
  ],
  steps:[
    {caption:'<b>Full fine-tuning</b>: every entry of W (4,096 × 4,096 = 16.8 M for one projection) gets a gradient and 8 bytes of AdamW state. Across an 8B model that is ≈ 16 bytes × 8 B params ≈ 128 GB.', hl:['W'], dur:4200},
    {caption:'<b>LoRA</b> (Hu et al., 2021) freezes W and adds two thin matrices: A (16 × 4,096) and B (4,096 × 16). Trainable: r(d + k) = 16 × (4,096 + 4,096) = <b>131,072</b> — 0.78 % of W.', ok:['A','B'], dim:['W'], set:{c1:{value:'131,072 (0.78 % of 16.8 M)'}, c2:{value:'W frozen: no gradient, no optimizer state'}}, dur:4800},
    {caption:'B starts at <b>zero</b>, so B·A·x = 0 and the model initially behaves exactly like the base model. Training only moves it away as the data demands.', hl:['B'], set:{c2:{value:'B = 0 → BAx = 0 at step 0'}}, dur:4000},
    {caption:'<b>Forward</b>: x goes through the frozen W <i>and</i> through A then B; the results are added, with the adapter scaled by α/r (e.g. α = 32, r = 16 → ×2).', packets:[{edge:'e1'},{edge:'e2'},{edge:'e3',delay:500},{edge:'e4',delay:700},{edge:'e5',delay:1000},{edge:'e6',delay:1400}], dur:4500},
    {caption:'<b>Backward</b>: gradients flow through W (needed to reach earlier layers) but W itself is never updated. Only A and B receive updates, so optimizer state is tiny.', packets:[{edge:'e5',reverse:true,cls:'c-purple'},{edge:'e3',reverse:true,cls:'c-purple',delay:500}], ok:['A','B'], dur:4200},
    {caption:'Whole model, Llama-3.2-1B shape, r = 16 on q, k, v, o in all 16 layers: <b>3.4 M</b> trainable (0.28 %). Adding gate, up and down projections: <b>11.3 M</b> (0.91 %). The adapter file is tens of MB, not GB.', set:{c1:{value:'1B model: 3.4 M (attn) – 11.3 M (all linear)'}, c2:{value:'adapter ≈ 7–23 MB in BF16'}}, dur:4800},
    {caption:'<b>QLoRA</b>: store frozen W in 4-bit NF4 (≈ 0.5 byte per weight), dequantise to BF16 block by block during each matmul; A and B stay in BF16. Base-weight memory drops ≈ 4× versus BF16.', warn:['W'], set:{c2:{value:'QLoRA: W in NF4, adapters in BF16'}}, dur:4500},
    {caption:'<b>Deploy</b>: either merge W′ = W + (α/r)·B·A (no extra latency, one model per adapter) or keep adapters separate and let the engine serve many adapters on one base (vLLM <code>--enable-lora</code>). The adapter is only valid with the exact base revision it was trained on.', ok:['out'], set:{c2:{value:'merge, or serve many adapters on one base'}}, dur:4800}
  ]
});

/* ---------- 10. Capstone stages 1–3 ---------- */
Anim.register({
  id:'v1-cap-stages', title:'Atlas capstone stages 1–3: what changes at each stage', w:960, h:420,
  elements:[
    {type:'zone', id:'z1', x:20, y:20, w:290, h:300, label:'Stage 1: tiny char-level GPT'},
    {type:'zone', id:'z2', x:335, y:20, w:290, h:300, label:'Stage 2: open-weight instruct model'},
    {type:'zone', id:'z3', x:650, y:20, w:290, h:300, label:'Stage 3: LoRA SFT'},
    {type:'node', id:'d1', x:40, y:60, w:250, h:50, label:'Text file (public domain)', sub:'chars → IDs'},
    {type:'node', id:'m1', x:40, y:140, w:250, h:56, label:'Your model code', sub:'4 layers × 128 dims ≈ 0.8 M', icon:'llm'},
    {type:'node', id:'o1', x:40, y:230, w:250, h:56, label:'ckpt.pt (your format)', sub:'loss, samples'},
    {type:'node', id:'d2', x:355, y:60, w:250, h:50, label:'Hub repo, pinned revision', sub:'safetensors + tokenizer'},
    {type:'node', id:'m2', x:355, y:140, w:250, h:56, label:'Pretrained ~1B model', sub:'BPE, chat template', icon:'llm'},
    {type:'node', id:'o2', x:355, y:230, w:250, h:56, label:'Baseline eval', sub:'50 travel prompts'},
    {type:'node', id:'d3', x:670, y:60, w:250, h:50, label:'Synthetic tickets', sub:'split by customer'},
    {type:'node', id:'m3', x:670, y:140, w:250, h:56, label:'Base (frozen) + LoRA', sub:'≈ 0.3–0.9 % trainable', icon:'llm'},
    {type:'node', id:'o3', x:670, y:230, w:250, h:56, label:'Adapter + eval report', sub:'vs baseline'},
    {type:'edge', id:'a1', from:'d1', to:'m1', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'a2', from:'m1', to:'o1', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'b1', from:'d2', to:'m2', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'b2', from:'m2', to:'o2', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'c1', from:'d3', to:'m3', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'c2', from:'m3', to:'o3', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'x12', from:'o1', to:'m2', label:'concepts carry over'},
    {type:'edge', id:'x23', from:'o2', to:'m3', label:'baseline'},
    {type:'counter', id:'st', x:20, y:350, label:'What changed in the architecture', value:'—'}
  ],
  steps:[
    {caption:'<b>Stage 1</b>: you write every line — character tokenizer, embedding, causal attention, MLP, training loop, checkpoint, generation. Runs on a laptop CPU. Goal: understanding, not quality.', hl:['z1','m1'], packets:[{edge:'a1'},{edge:'a2',delay:500}], set:{st:{value:'Stage 1: code + data + CPU. Nothing external. Your own checkpoint format.'}}, dur:4500},
    {caption:'Stage 1 output: a checkpoint and samples that look like the training text. Loss started near ln(65) ≈ 4.17 for a 65-character vocabulary and fell. You can now read real model code.', ok:['o1'], dur:4000},
    {caption:'<b>Stage 2</b>: replace your toy with a pretrained ~1B open-weight instruct model, pinned to an exact revision. New architecture pieces: a BPE tokenizer, a chat template, safetensors weights, a model card and licence.', hl:['z2','m2','d2'], packets:[{edge:'x12'},{edge:'b1',delay:400}], set:{st:{value:'Stage 2: + artifact supply chain (Hub, revision pin, licence), + tokenizer/template contract, + GPU optional.'}}, dur:4800},
    {caption:'Before changing anything, run a <b>baseline evaluation</b> on ~50 realistic travel-support prompts. Without a baseline, you cannot prove fine-tuning helped.', ok:['o2'], packets:[{edge:'b2'}], dur:4000},
    {caption:'<b>Stage 3</b>: LoRA supervised fine-tuning on synthetic travel-support tickets, split by customer so no customer appears in both train and test. Base frozen; adapters trained.', hl:['z3','m3','d3'], packets:[{edge:'x23'},{edge:'c1',delay:400}], set:{st:{value:'Stage 3: + dataset pipeline, + training job, + adapter artifact tied to base revision, + eval gate.'}}, dur:4800},
    {caption:'Output: an adapter and an evaluation report comparing it with the stage-2 baseline on the same held-out set. Stage 4 serves it with vLLM and measures latency.', ok:['o3'], packets:[{edge:'c2'}], dur:4200},
    {caption:'<b>Honest status</b>: these stages are lab exercises on synthetic data. They demonstrate mechanics. They say nothing about production quality, safety or scale — those are the subject of later stages.', warn:['o1','o2','o3'], set:{st:{value:'Lab-validated mechanics only. Not production-tested.'}}, dur:4500}
  ]
});

})();

/* Chart axis paths need fill:none (engine stylesheet sets only stroke); harmless if styles.css adds it later. */
(function(){if(typeof document==='undefined'||!document.head)return;if(document.getElementById('v1p13-chart-axis-fix'))return;var s=document.createElement('style');s.id='v1p13-chart-axis-fix';s.textContent='.sc-chart .axis{fill:none}.sc-chart.v1gd path.line:nth-of-type(3){stroke:#d97706;stroke-dasharray:6 4;stroke-width:2.5}';document.head.appendChild(s);})();
