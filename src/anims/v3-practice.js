/* Vol 3 animations: practice drills and prove-it checkpoints */
Anim.register({
  id:'v3-llm-token-journey', title:'One token’s journey through an LLM, end to end (Llama-3.1-8B shape)', w:960, h:440,
  elements:[
    {type:'label', id:'seql', x:20, y:22, text:'Sequence the model has seen (token pieces; ids are illustrative)'},
    {type:'tokens', id:'seq', x:20, y:34, h:28, items:['The',' flight',' to',' Riy','adh',' is']},
    {type:'node', id:'tok', x:20, y:110, w:120, h:60, label:'Tokenizer', sub:'BPE → ids', icon:'doc'},
    {type:'node', id:'emb', x:160, y:110, w:130, h:60, label:'Embedding', sub:'id → 4,096', icon:'memory'},
    {type:'node', id:'lay', x:310, y:110, w:150, h:60, label:'32 layers', sub:'attention + FFN', icon:'llm'},
    {type:'node', id:'head', x:480, y:110, w:160, h:60, label:'Norm + LM head', sub:'→ 128,256 logits', icon:'chart'},
    {type:'node', id:'samp', x:660, y:110, w:130, h:60, label:'Sampler', sub:'T 0.7, top-p 0.9', icon:'gear'},
    {type:'node', id:'det', x:810, y:110, w:130, h:60, label:'Detokenize', sub:'id → text', icon:'doc'},
    {type:'node', id:'kv', x:310, y:230, w:150, h:60, label:'KV cache', sub:'128 KiB / token', icon:'memory'},
    {type:'node', id:'cli', x:810, y:230, w:130, h:60, label:'Client', sub:'SSE stream', icon:'user'},
    {type:'edge', id:'e1', from:'tok', to:'emb'},
    {type:'edge', id:'e2', from:'emb', to:'lay'},
    {type:'edge', id:'e3', from:'lay', to:'head'},
    {type:'edge', id:'e4', from:'head', to:'samp'},
    {type:'edge', id:'e5', from:'samp', to:'det'},
    {type:'edge', id:'e6', from:'lay', to:'kv', label:'K,V'},
    {type:'edge', id:'e7', from:'det', to:'cli'},
    {type:'label', id:'probs', x:490, y:220, text:'', hidden:true},
    {type:'counter', id:'shape', x:20, y:340, label:'Tensor shape now', value:'text (UTF-8 bytes)'},
    {type:'counter', id:'cost', x:330, y:340, label:'Work / memory this stage', value:'—'},
    {type:'counter', id:'kvc', x:690, y:340, label:'KV cache for this request', value:'0 tokens'}
  ],
  steps:[
    {caption:'A user types <i>"The flight to Riyadh is"</i>. The model never sees characters: it sees integers. The <b>tokenizer</b> (byte-level BPE, 128,256-entry vocabulary for Llama 3.1) splits the text into pieces. Rare words such as city names may split into several pieces, so token count depends on the tokenizer and the language.', hl:['tok'], set:{shape:{value:'6 token ids  [1 × 6]'}, cost:{value:'CPU, microseconds'}}, dur:4800},
    {caption:'<b>Embedding lookup.</b> Each id selects one row of a 128,256 × 4,096 table (≈1.05 GB in BF16). Six ids become a 6 × 4,096 matrix. This is a memory gather, not maths-heavy.', hl:['emb'], packets:[{edge:'e1',label:'ids'}], set:{shape:{value:'[6 × 4,096]'}, cost:{value:'gather 6 rows of 4,096'}}, dur:4500},
    {caption:'<b>Prefill through 32 layers.</b> All 6 tokens go through every layer in parallel. In each layer: attention (32 query heads, 8 KV heads, causal mask) then the FFN (4,096 → 14,336 → 4,096). Forward cost ≈ 2 × 8.03 B params × 6 tokens ≈ 96 GFLOP. Big batched matmuls on Tensor Cores: this phase is compute-bound.', hl:['lay'], busy:['lay'], packets:[{edge:'e2',label:'6 × 4,096',cls:'c-blue'}], set:{cost:{value:'≈ 96 GFLOP (2 × P × 6)'}}, dur:5200},
    {caption:'Every layer writes each token’s <b>key and value</b> vectors into the KV cache: 2 × 32 layers × 8 KV heads × 128 × 2 bytes = <b>128 KiB per token</b>. Six tokens → 768 KiB. These are kept so no later step recomputes the prompt.', hl:['kv'], packets:[{edge:'e6',label:'K,V ×6',cls:'c-purple'}], set:{kvc:{value:'6 tokens × 128 KiB = 768 KiB'}}, dur:4800},
    {caption:'<b>Final norm + LM head.</b> Only the <i>last</i> position matters for the next token. Its 4,096-vector is multiplied by a 4,096 × 128,256 matrix → one logit (score) per vocabulary entry.', hl:['head'], packets:[{edge:'e3',label:'last h'}], set:{shape:{value:'[1 × 128,256] logits'}, cost:{value:'4,096 × 128,256 matmul'}}, dur:4500},
    {caption:'<b>Sampling.</b> Logits ÷ temperature (0.7) → softmax → probabilities. Top-p 0.9 keeps the smallest set of tokens that sums to 0.9 and samples one. Probabilities shown are illustrative.', hl:['samp'], show:['probs'], set:{probs:{text:'illustrative top candidates\n" delayed"   0.41\n" on"        0.22\n" full"      0.12\n" cancelled" 0.08'}, cost:{value:'softmax + top-p over 128,256'}}, packets:[{edge:'e4',label:'logits'}], dur:5200},
    {caption:'The sampled id is <b>detokenized</b> to " delayed" and streamed to the client as a server-sent event. The time from request arrival to this moment is <b>TTFT</b>: queueing + prefill + the first sample.', hl:['det','cli'], ok:['cli'], packets:[{edge:'e5',label:'id'},{edge:'e7',label:'" delayed"',delay:500,cls:'c-ok'}], set:{seq:{items:['The',' flight',' to',' Riy','adh',' is',{t:' delayed',cls:'new'}]}, shape:{value:'1 new token'}}, dur:5000},
    {caption:'<b>Decode step.</b> Only the new token goes through embedding and the 32 layers. Its query attends to the 6 cached keys/values plus its own. The step must still read <b>all ≈16 GB of weights</b> from HBM: ≥ 16.06 GB ÷ 3.35 TB/s ≈ 4.8 ms on an H100 at batch 1. This phase is bandwidth-bound; batching many users shares the weight read.', hl:['emb','lay'], busy:['lay'], packets:[{edge:'e2',label:'1 × 4,096',cls:'c-blue'},{edge:'e6',label:'+1',delay:500,cls:'c-purple'}], set:{shape:{value:'[1 × 4,096] per step'}, cost:{value:'read 16 GB weights ≈ 4.8 ms'}, kvc:{value:'7 tokens × 128 KiB = 896 KiB'}}, hide:['probs'], dur:5600},
    {caption:'The loop repeats: one token in, one token out, KV grows by 128 KiB each step. The gap between streamed tokens is <b>TPOT</b> (time per output token). Throughput per GPU comes from running many sequences in the same step (continuous batching).', hl:['samp','det','cli'], packets:[{edge:'e4'},{edge:'e5',delay:300},{edge:'e7',delay:600,cls:'c-ok'}], set:{seq:{items:['The',' flight',' to',' Riy','adh',' is',' delayed',{t:' by',cls:'new'}]}, kvc:{value:'8 tokens × 128 KiB = 1 MiB'}}, dur:4800},
    {caption:'It stops on an end-of-sequence token, a stop string, or <code>max_tokens</code>. A 4,096-token conversation would hold 4,096 × 128 KiB = <b>0.5 GiB</b> of KV — per user. That is why KV memory, not the 16 GB of weights, usually caps how many users one GPU serves.', hl:['kv'], warn:['kv'], set:{kvc:{value:'4,096 tokens → 0.5 GiB per request'}, cost:{value:'stop: EOS / stop string / max_tokens'}}, dur:5200},
    {caption:'<b>Where the time goes — the operational summary.</b> Tokenizer and sampler: tiny. Prefill: compute-bound → TTFT. Decode: HBM-bandwidth-bound → TPOT. KV cache: grows per token → concurrency and cost. That chain is what you size, monitor and optimise.', ok:['lay','kv'], dur:5200}
  ]
});

Anim.register({
  id:'v3-plat-pipeline', title:'The Atlas platform pipeline: from dataset to a monitored canary (with one automatic rollback)', w:960, h:440,
  elements:[
    {type:'zone', id:'zt', x:10, y:14, w:940, h:104, label:'Build and gate'},
    {type:'zone', id:'zr', x:10, y:134, w:940, h:200, label:'Release and run'},
    {type:'node', id:'data', x:24, y:42, w:130, h:56, label:'Dataset', sub:'split by customer', icon:'db'},
    {type:'node', id:'train', x:174, y:42, w:140, h:56, label:'LoRA train', sub:'r=16, 13.6 M', icon:'gpu'},
    {type:'node', id:'eval', x:334, y:42, w:130, h:56, label:'Eval gate', sub:'vs base model', icon:'check'},
    {type:'node', id:'reg', x:484, y:42, w:140, h:56, label:'Registry', sub:'@candidate', icon:'db'},
    {type:'node', id:'img', x:644, y:42, w:140, h:56, label:'Signed weights', sub:'image / volume', icon:'shield'},
    {type:'node', id:'pr', x:804, y:42, w:136, h:56, label:'GitOps PR', sub:'model ref', icon:'doc'},
    {type:'node', id:'argo', x:804, y:166, w:136, h:56, label:'Argo CD sync', sub:'Git = desired', icon:'k8s'},
    {type:'node', id:'can', x:634, y:166, w:150, h:56, label:'Canary 10%', sub:'Argo Rollouts', icon:'server'},
    {type:'node', id:'ana', x:434, y:166, w:160, h:56, label:'AnalysisRun', sub:'TTFT p95, errors', icon:'chart'},
    {type:'node', id:'prod', x:204, y:166, w:170, h:56, label:'Promote 100%', sub:'stable = new', icon:'check'},
    {type:'node', id:'rb', x:434, y:262, w:160, h:56, label:'Auto rollback', sub:'stable keeps traffic', icon:'warn'},
    {type:'node', id:'mon', x:24, y:166, w:150, h:56, label:'Monitoring', sub:'vLLM + DCGM + cost', icon:'chart'},
    {type:'edge', id:'e1', from:'data', to:'train'},
    {type:'edge', id:'e2', from:'train', to:'eval'},
    {type:'edge', id:'e3', from:'eval', to:'reg'},
    {type:'edge', id:'e4', from:'reg', to:'img'},
    {type:'edge', id:'e5', from:'img', to:'pr'},
    {type:'edge', id:'e6', from:'pr', to:'argo'},
    {type:'edge', id:'e7', from:'argo', to:'can'},
    {type:'edge', id:'e8', from:'can', to:'ana'},
    {type:'edge', id:'e9', from:'ana', to:'prod', label:'pass'},
    {type:'edge', id:'e10', from:'ana', to:'rb', label:'fail'},
    {type:'edge', id:'e11', from:'prod', to:'mon'},
    {type:'edge', id:'e12', from:'mon', to:'data'},
    {type:'counter', id:'status', x:24, y:362, label:'Pipeline status', value:'waiting for data'},
    {type:'counter', id:'metric', x:520, y:362, label:'Evidence at this step', value:'—'}
  ],
  steps:[
    {caption:'<b>Data.</b> Synthetic travel-support conversations in chat format, split train/val/test <i>by customer</i> so no customer appears in both train and test. The dataset hash is recorded so the run is reproducible.', hl:['data'], set:{status:{value:'dataset v3 built'}, metric:{value:'3,000 / 300 / 300 examples (illustrative)'}}, dur:4600},
    {caption:'<b>LoRA fine-tune.</b> TRL SFT + PEFT LoRA (r 16, alpha 32 on q,k,v,o): ≈13.6 M trainable parameters on an 8B-class base — 0.17 %. Loss only on assistant tokens. Output: an adapter of tens of MB plus training curves.', hl:['train'], busy:['train'], packets:[{edge:'e1',label:'JSONL'}], set:{status:{value:'training run #17'}, metric:{value:'val loss falling, no divergence'}}, dur:4800},
    {caption:'<b>Eval gate.</b> The adapter is scored against the base model on held-out customers: task accuracy, JSON validity, a safety set, and a short latency check. It must beat the base and not regress safety. This one passes.', hl:['eval'], ok:['eval'], packets:[{edge:'e2',label:'adapter'}], set:{status:{value:'eval passed'}, metric:{value:'task +7 pts, JSON 99.6 %, safety flat (illustr.)'}}, dur:4800},
    {caption:'<b>Registry + supply chain.</b> Base revision, adapter, chat template and eval report are registered together under alias <code>@candidate</code>. Weights are packaged (image or OCI volume) and signed.', hl:['reg','img'], packets:[{edge:'e3',label:'pass',cls:'c-ok'},{edge:'e4',label:'v18',delay:500}], set:{status:{value:'atlas-support v18 @candidate'}, metric:{value:'artifacts hashed + signed'}}, dur:4600},
    {caption:'<b>GitOps.</b> A pull request changes one line — the model reference — in the deployment repo. Review + CI checks, merge. <b>Argo CD</b> sees Git changed and syncs the Rollout object in the cluster.', hl:['pr','argo'], packets:[{edge:'e5',label:'ref'},{edge:'e6',label:'merge',delay:500}], set:{status:{value:'PR merged, Argo CD syncing'}, metric:{value:'desired state = Git commit abc123'}}, dur:4600},
    {caption:'<b>Canary.</b> Argo Rollouts starts new pods (startup probe allows minutes for weight loading) and sends ~10 % of traffic to them. The stable version keeps 90 % and stays warm for rollback.', hl:['can'], busy:['can'], packets:[{edge:'e7',label:'10 %'}], set:{status:{value:'canary at 10 %'}, metric:{value:'canary pods Ready after 6 min load'}}, dur:4600},
    {caption:'<b>Analysis fails.</b> The AnalysisRun queries Prometheus: canary TTFT p95 = <b>1.4 s</b> against a 0.8 s condition. (In this story a serving flag differed from stable.) Offline eval could not see this — only real load does.', hl:['ana'], bad:['ana'], packets:[{edge:'e8',label:'PromQL'}], set:{status:{value:'analysis FAILED'}, metric:{value:'TTFT p95 1.4 s > 0.8 s'}}, dur:5000},
    {caption:'<b>Automatic rollback.</b> The rollout aborts; traffic returns to the stable version in seconds because stable pods never went away. Users saw a brief p95 bump on 10 % of traffic, inside the error budget.', hl:['rb'], warn:['rb'], packets:[{edge:'e10',label:'abort',cls:'c-bad'}], set:{status:{value:'rolled back to v17'}, metric:{value:'error budget used: small (illustrative)'}}, dur:4800},
    {caption:'<b>Fix and retry.</b> The flag is aligned in Git, a new PR re-runs the same path, and this time TTFT p95 = 0.62 s and errors are flat. Rollouts steps 10 % → 50 % → 100 %.', hl:['ana','prod'], ok:['ana','prod'], packets:[{edge:'e7',label:'10 %'},{edge:'e8',label:'PromQL',delay:400},{edge:'e9',label:'pass',delay:800,cls:'c-ok'}], set:{status:{value:'v18 promoted to 100 %'}, metric:{value:'TTFT p95 0.62 s, errors 0.1 %'}}, dur:5000},
    {caption:'<b>Monitoring closes the loop.</b> Dashboards track TTFT/TPOT, queue and KV usage, GPU health and $ per million tokens. Thumbs-down and low-score conversations become candidate eval and training examples for the next cycle.', hl:['mon','data'], packets:[{edge:'e11',label:'metrics'},{edge:'e12',label:'feedback',delay:500,cls:'c-purple'}], set:{status:{value:'steady state'}, metric:{value:'≈ $0.80–2.00 per M output tokens (illustrative)'}}, dur:5000}
  ]
});

Anim.register({
  id:'v3-10m-funnel', title:'10 million users → GPUs → dollars: the capacity funnel (illustrative assumptions, verified price)', w:960, h:430,
  elements:[
    {type:'node', id:'dau', x:20, y:40, w:160, h:56, label:'Daily users', sub:'A1, A2', icon:'user'},
    {type:'node', id:'rps', x:210, y:40, w:160, h:56, label:'Peak RPS', sub:'A3: 4× mean', icon:'clock'},
    {type:'node', id:'tok', x:400, y:40, w:160, h:56, label:'Tokens / s', sub:'A4: 700 in / 250 out', icon:'bolt'},
    {type:'node', id:'cache', x:590, y:40, w:160, h:56, label:'After caches', sub:'A6, A7', icon:'cache'},
    {type:'node', id:'route', x:780, y:40, w:160, h:56, label:'Model tiers', sub:'A8: 85 / 15 %', icon:'gear'},
    {type:'node', id:'good', x:780, y:220, w:160, h:56, label:'Goodput / replica', sub:'A9 measured at SLO', icon:'chart'},
    {type:'node', id:'rep', x:590, y:220, w:160, h:56, label:'Replicas', sub:'A10: 80 % load', icon:'server'},
    {type:'node', id:'reg', x:400, y:220, w:160, h:56, label:'3 regions', sub:'peak ÷ (n − 1)', icon:'globe'},
    {type:'node', id:'gpu', x:210, y:220, w:160, h:56, label:'GPUs', sub:'8-GPU nodes', icon:'gpu'},
    {type:'node', id:'cost', x:20, y:220, w:160, h:56, label:'$ / month', sub:'$6.88 / GPU-h', icon:'money'},
    {type:'edge', id:'e1', from:'dau', to:'rps'},
    {type:'edge', id:'e2', from:'rps', to:'tok'},
    {type:'edge', id:'e3', from:'tok', to:'cache'},
    {type:'edge', id:'e4', from:'cache', to:'route'},
    {type:'edge', id:'e5', from:'route', to:'good', fromSide:'right', toSide:'right'},
    {type:'edge', id:'e6', from:'good', to:'rep'},
    {type:'edge', id:'e7', from:'rep', to:'reg'},
    {type:'edge', id:'e8', from:'reg', to:'gpu'},
    {type:'edge', id:'e9', from:'gpu', to:'cost'},
    {type:'counter', id:'c1', x:20, y:120, label:'requests / day', value:'—'},
    {type:'counter', id:'c2', x:210, y:120, label:'mean → peak', value:'—'},
    {type:'counter', id:'c3', x:400, y:120, label:'peak tokens / s', value:'—'},
    {type:'counter', id:'c4', x:590, y:120, label:'GPU requests / s', value:'—'},
    {type:'counter', id:'c5', x:780, y:120, label:'output tok/s per tier', value:'—'},
    {type:'counter', id:'c6', x:780, y:300, label:'per replica at SLO', value:'—'},
    {type:'counter', id:'c7', x:590, y:300, label:'replicas (1 region)', value:'—'},
    {type:'counter', id:'c8', x:400, y:300, label:'GPUs, 3 regions', value:'—'},
    {type:'counter', id:'c9', x:210, y:300, label:'rounded to nodes', value:'—'},
    {type:'counter', id:'c10', x:20, y:300, label:'monthly (illustr.)', value:'—'},
    {type:'label', id:'note', x:20, y:390, text:''}
  ],
  steps:[
    {caption:'<b>Users → requests.</b> 10,000,000 daily active users × 6 requests each = <b>60,000,000 requests per day</b>. These are labelled assumptions (A1, A2) — the first thing to confirm with the interviewer.', hl:['dau'], set:{c1:{value:'60,000,000'}}, dur:4500},
    {caption:'<b>Requests → peak RPS.</b> 60 M ÷ 86,400 s = 694.4 req/s on average. Capacity is sized for the peak: with a 4× peak-to-mean ratio (A3) that is <b>2,777.8 req/s</b>. Little’s law with a 9.25 s mean request gives ≈ 26 k open streams.', hl:['rps'], packets:[{edge:'e1',label:'÷ 86,400'}], set:{c2:{value:'694 → 2,778 /s'}}, dur:4800},
    {caption:'<b>Requests → tokens.</b> At 700 input and 250 output tokens per request (A4): 2,778 × 700 ≈ <b>1.94 M prompt tok/s</b> and 2,778 × 250 ≈ <b>694 k output tok/s</b>. Both must be sized: prefill (compute) and decode (bandwidth).', hl:['tok'], packets:[{edge:'e2',label:'× tokens'}], set:{c3:{value:'1.94 M in / 694 k out'}}, dur:4800},
    {caption:'<b>Remove work first.</b> A tenant-safe response cache at 10 % hits leaves <b>2,500 req/s</b> for the GPUs. Prefix caching of the 500-token shared system prompt (90 % hits) cuts uncached prompt tokens per request from 700 to <b>250</b>.', hl:['cache'], ok:['cache'], packets:[{edge:'e3',label:'−10 %',cls:'c-ok'}], set:{c4:{value:'2,500 /s · 250 new tok'}}, dur:5000},
    {caption:'<b>Route by difficulty.</b> 85 % to an 8B-class model (2,125 req/s → 531,250 output tok/s), 15 % to a 70B-class model (375 req/s → 93,750 output tok/s). Tier mix is a cost decision backed by evals.', hl:['route'], packets:[{edge:'e4',label:'85 / 15'}], set:{c5:{value:'8B 531 k · 70B 94 k'}}, dur:4800},
    {caption:'<b>Goodput, not peak throughput.</b> From your benchmark at TTFT p95 ≤ 800 ms and TPOT p95 ≤ 40 ms with this token shape (A9, illustrative): 8B ≈ 2,400 output tok/s per H100; 70B ≈ 1,800 per 4-GPU replica. Prefill and KV are checked separately — neither binds here.', hl:['good'], warn:['good'], packets:[{edge:'e5',label:'measure'}], set:{c6:{value:'2,400 · 1,800 tok/s'}}, dur:5200},
    {caption:'<b>Replicas at 80 % load.</b> 8B: 531,250 ÷ 1,920 = 276.7 → <b>277 GPUs</b>. 70B: 93,750 ÷ 1,440 = 65.1 → <b>66 replicas = 264 GPUs</b>. One region carrying all peak would need ≈ 541 H100s.', hl:['rep'], packets:[{edge:'e6',label:'÷ goodput'}], set:{c7:{value:'277 + 66×4 = 541 GPUs'}}, dur:5000},
    {caption:'<b>Survive a region loss.</b> Three active-active regions; if one fails the other two carry 100 %, so each is sized for 50 % of global peak: 139 + 132 = 271 GPUs per region, <b>813 total</b> (1.5 × 541). Residency-bound traffic may degrade locally instead of failing over.', hl:['reg'], warn:['reg'], packets:[{edge:'e7',label:'× 1.5'}], set:{c8:{value:'813 GPUs'}}, dur:5200},
    {caption:'<b>Round to hardware.</b> 8-GPU nodes: 18 nodes for the 8B pool (144 GPUs) and 17 for the TP-4 70B pool (136) per region → 35 nodes × 3 = <b>105 nodes, 840 GPUs</b> at peak.', hl:['gpu'], packets:[{edge:'e8',label:'nodes'}], set:{c9:{value:'105 nodes = 840 GPUs'}}, dur:4800},
    {caption:'<b>Dollars.</b> $55.04/h per p5.48xlarge ÷ 8 = $6.88/GPU-h (us-east-1, 2026-10-12). Peak fleet all month on-demand ≈ $4.2 M. Autoscaled (≈ 55 % average) with 300 GPUs committed at an illustrative 35 % off ≈ <b>$1.8 M/month ≈ $0.18 per DAU ≈ $3.9 per M output tokens</b>.', hl:['cost'], ok:['cost'], packets:[{edge:'e9',label:'× $'}], set:{c10:{value:'≈ $1.8 M (peak $4.2 M)'}}, dur:5400},
    {caption:'<b>Sensitivity.</b> Output tokens, measured goodput and peak factor each scale the fleet roughly linearly: 8× peak or 500 output tokens or −50 % goodput → ≈ 1,626 GPUs. So the next step is always: replay real traffic and re-benchmark.', hl:['tok','good','rps'], set:{note:{text:'Doubling any of: peak factor, output tokens, 1 ÷ goodput  →  ≈ 2× GPUs and $.'}}, dur:5200}
  ]
});

Anim.register({
  id:'v3-mcp-request', title:'One MCP tools/call crossing the auth and approval boundaries (remote server, OAuth 2.1)', w:960, h:440,
  elements:[
    {type:'zone', id:'z1', x:10, y:14, w:190, h:330, label:'User device'},
    {type:'zone', id:'z2', x:250, y:14, w:450, h:330, label:'Platform: MCP server', cls:'ok'},
    {type:'zone', id:'z3', x:750, y:14, w:200, h:330, label:'Downstream', cls:'danger'},
    {type:'node', id:'host', x:24, y:60, w:162, h:60, label:'Host + client', sub:'Claude Code', icon:'agent'},
    {type:'node', id:'as', x:24, y:230, w:162, h:60, label:'OAuth AS', sub:'IdP, PKCE', icon:'key'},
    {type:'node', id:'srv', x:400, y:60, w:170, h:60, label:'MCP server', sub:'resource server', icon:'server'},
    {type:'node', id:'pol', x:270, y:180, w:150, h:56, label:'Token + scope', sub:'iss, aud, exp', icon:'shield'},
    {type:'node', id:'apr', x:530, y:180, w:150, h:56, label:'Approval', sub:'human, bound', icon:'user'},
    {type:'node', id:'aud', x:400, y:270, w:170, h:56, label:'Audit log', sub:'who, what, result', icon:'doc'},
    {type:'node', id:'k8s', x:770, y:60, w:166, h:60, label:'Kubernetes API', sub:'server’s own SA', icon:'k8s'},
    {type:'edge', id:'e1', from:'host', to:'srv', label:'POST /mcp'},
    {type:'edge', id:'e2', from:'host', to:'as'},
    {type:'edge', id:'e3', from:'srv', to:'pol'},
    {type:'edge', id:'e4', from:'srv', to:'apr'},
    {type:'edge', id:'e5', from:'srv', to:'k8s'},
    {type:'edge', id:'e6', from:'srv', to:'aud'},
    {type:'counter', id:'http', x:24, y:370, label:'HTTP / MCP', value:'—'},
    {type:'counter', id:'tok', x:300, y:370, label:'Token', value:'none'},
    {type:'counter', id:'act', x:620, y:370, label:'Action', value:'—'}
  ],
  steps:[
    {caption:'The model in the host decides to call <code>unhealthy_pods(namespace="checkout")</code>. The MCP client POSTs <code>tools/call</code> to <code>https://mcp.atlas.example/mcp</code>. On revision 2026-07-28 the protocol version travels in <code>_meta</code> and the <code>MCP-Protocol-Version</code> header — no handshake, no session. It has no token yet.', hl:['host'], packets:[{edge:'e1',label:'tools/call'}], set:{http:{value:'POST, no Authorization'}}, dur:5200},
    {caption:'The server is an OAuth <b>resource server</b>. It answers <b>401</b> with <code>WWW-Authenticate: Bearer resource_metadata="…"</code>. The client fetches that Protected Resource Metadata (RFC 9728) and learns which authorization server to use.', hl:['srv'], bad:['srv'], packets:[{edge:'e1',label:'401 + PRM',reverse:true,cls:'c-bad'}], set:{http:{value:'401 → PRM discovered'}}, dur:5000},
    {caption:'<b>OAuth 2.1 authorization code + PKCE (S256)</b>, with <code>resource=https://mcp.atlas.example/mcp</code> (RFC 8707). The user signs in and consents to scopes <code>ops.read ops.write</code>. The token’s <b>audience is this server</b> and nothing else.', hl:['as','host'], packets:[{edge:'e2',label:'PKCE + resource'},{edge:'e2',label:'token',reverse:true,delay:900,cls:'c-ok'}], set:{tok:{value:'aud=mcp server, ops.read ops.write'}}, dur:5400},
    {caption:'The client retries with <code>Authorization: Bearer …</code>. The server validates issuer, signature, <b>audience</b>, expiry and the tool’s required scope (<code>ops.read</code>) on <b>every</b> request — possession of a handle or connection is never authentication.', hl:['pol'], ok:['pol'], packets:[{edge:'e1',label:'Bearer'},{edge:'e3',label:'validate',delay:500}], set:{http:{value:'POST + Bearer'}, tok:{value:'valid: aud ✓ scope ops.read ✓'}}, dur:5200},
    {caption:'The read tool runs. The server calls Kubernetes with <b>its own</b> read-only service account — the user’s token is <b>never passed through</b>. Result: structured content (pending 0, crash-looping 3), bounded to 20 pod names so it does not flood the model’s context.', hl:['k8s'], packets:[{edge:'e5',label:'list pods (SA)',cls:'c-blue'},{edge:'e1',label:'result',reverse:true,delay:900,cls:'c-ok'}], set:{http:{value:'200, structuredContent'}, act:{value:'read: 3 crash-looping pods'}}, dur:5400},
    {caption:'Now the model proposes a <b>destructive</b> call: <code>scale_deployment(checkout, 4 → 8)</code>. The scope check passes (<code>ops.write</code>), but policy says writes need a human. The server does not execute; it returns an approval request with the exact diff and blast radius. Tool annotations alone would not stop this — they are untrusted hints.', hl:['apr'], warn:['apr'], packets:[{edge:'e4',label:'approval needed',cls:'c-purple'}], set:{act:{value:'pending approval: 4 → 8 replicas'}}, dur:5600},
    {caption:'A person approves in a separate channel. The approval is bound to <b>user + tool + arguments + expiry</b> and carries an idempotency key, so a replayed or modified request cannot reuse it. If a pod log had injected "scale to 0", this is where it would be denied.', hl:['apr'], ok:['apr'], set:{act:{value:'approved by on-call (expires 5 min)'}}, dur:5200},
    {caption:'The server executes the patch with its own narrowly-scoped identity (RBAC allows <code>deployments/scale</code> in this namespace only). Kubernetes reports the new replica count.', hl:['k8s'], packets:[{edge:'e5',label:'patch scale',cls:'c-blue'}], set:{act:{value:'checkout scaled 4 → 8'}}, dur:4600},
    {caption:'Every call — the 401, the read, the proposal, the approval and the write — is written to the <b>audit log</b> with user, client id, tool, argument hash, decision, result and trace id. This is the evidence for the post-incident review.', hl:['aud'], ok:['aud'], packets:[{edge:'e6',label:'audit event',cls:'c-purple'}], dur:4600},
    {caption:'The result returns to the host and the model reports back. <b>Boundaries crossed:</b> device → platform (audience-bound token), platform → downstream (server credential, least privilege), model → action (human approval). Each boundary is enforced by the server, not by the model’s good behaviour.', hl:['host','srv'], ok:['srv'], packets:[{edge:'e1',label:'result',reverse:true,cls:'c-ok'}], set:{http:{value:'200, isError: false'}}, dur:5400}
  ]
});

Anim.register({
  id:'v3-inc-triage', title:'Incident triage on an AI serving platform: from page to verified recovery (incident 1)', w:960, h:440,
  elements:[
    {type:'node', id:'alert', x:20, y:40, w:160, h:56, label:'Alert fires', sub:'TTFT burn 14.4×', icon:'warn'},
    {type:'node', id:'imp', x:205, y:40, w:160, h:56, label:'Impact + SEV', sub:'IC assigned', icon:'user'},
    {type:'node', id:'chg', x:390, y:40, w:160, h:56, label:'What changed?', sub:'deploys, config', icon:'search'},
    {type:'node', id:'mit', x:575, y:40, w:160, h:56, label:'Mitigate', sub:'flag / rollback', icon:'shield'},
    {type:'node', id:'ver', x:760, y:40, w:170, h:56, label:'Verify', sub:'burn < 1×', icon:'check'},
    {type:'node', id:'q', x:20, y:190, w:160, h:56, label:'Queue / KV?', sub:'waiting, kv usage', icon:'queue'},
    {type:'node', id:'pre', x:205, y:190, w:160, h:56, label:'Prefill?', sub:'prompt tok, TTFT', icon:'bolt'},
    {type:'node', id:'dec', x:390, y:190, w:160, h:56, label:'Decode?', sub:'TPOT, batch', icon:'clock'},
    {type:'node', id:'gpu', x:575, y:190, w:160, h:56, label:'GPU health?', sub:'Xid, power', icon:'gpu'},
    {type:'node', id:'up', x:760, y:190, w:170, h:56, label:'Upstream?', sub:'RAG, gateway', icon:'cloud'},
    {type:'edge', id:'e1', from:'alert', to:'imp'},
    {type:'edge', id:'e2', from:'imp', to:'chg'},
    {type:'edge', id:'e3', from:'chg', to:'mit'},
    {type:'edge', id:'e4', from:'mit', to:'ver'},
    {type:'edge', id:'e5', from:'imp', to:'q', fromSide:'bottom', toSide:'top'},
    {type:'edge', id:'e6', from:'q', to:'pre'},
    {type:'edge', id:'e7', from:'pre', to:'dec'},
    {type:'edge', id:'e8', from:'dec', to:'gpu'},
    {type:'edge', id:'e9', from:'gpu', to:'up'},
    {type:'chart', id:'ch', x:80, y:300, w:380, h:100, xmax:60, ymax:2.5, xlabel:'minutes since 09:30', ylabel:'TTFT p95 (s)', series:[{id:'t',label:'TTFT p95',points:[[0,0.45],[10,0.46]]}]},
    {type:'counter', id:'ev', x:520, y:300, label:'Evidence', value:'—'},
    {type:'counter', id:'dec2', x:520, y:360, label:'Decision', value:'—'}
  ],
  steps:[
    {caption:'<b>10:02 — Page.</b> The TTFT SLO burn rate is 14.4× over 1 hour and confirmed over 5 minutes (the Google SRE workbook page threshold for a 99.9 % SLO). TTFT p95 is 2.3 s against 0.8 s.', hl:['alert'], bad:['alert'], set:{ch:{t:[[0,0.45],[10,0.46],[20,1.2],[32,2.3]]}, ev:{value:'TTFT p95 2.3 s, TPOT p95 31 ms'}}, dur:5000},
    {caption:'<b>Impact and severity first.</b> ≈ 30 % of region-A requests are over 800 ms; no errors; other regions fine. Declare SEV2, assign an incident commander, start the timeline. Users are slowed, not failed.', hl:['imp'], packets:[{edge:'e1',label:'page'}], set:{ev:{value:'region A only, ~30 % slow'}, dec2:{value:'SEV2, IC assigned'}}, dur:4800},
    {caption:'<b>What changed?</b> No model or engine deploy today. Change log shows a retrieval config change at 09:40: top-k 5 → 20 for one intent. Correlated in time — note it, and keep the evidence walk going in parallel.', hl:['chg'], warn:['chg'], packets:[{edge:'e2'}], set:{ev:{value:'09:40 retrieval top-k 5 → 20'}}, dur:5000},
    {caption:'<b>Queue / KV?</b> Waiting requests are up a little, queue time p95 0.4 s — but <code>vllm:kv_cache_usage_perc</code> peaks at 0.71. KV exhaustion would sit near 1.0. Queueing is a <i>symptom</i> here, not the cause.', hl:['q'], packets:[{edge:'e5',label:'check'}], set:{ev:{value:'KV 0.71, queue p95 0.4 s'}, dec2:{value:'KV exhaustion: ruled out'}}, dur:5000},
    {caption:'<b>Prefill?</b> <code>vllm:request_prefill_time_seconds</code> p95 1.7 s (was 0.18 s). Prompt tokens per request 1,150 → 3,900. This is the mechanism: bigger prompts → more prefill work → later first tokens for everyone in the batch.', hl:['pre'], bad:['pre'], packets:[{edge:'e6'}], set:{ev:{value:'prefill p95 1.7 s, prompt 3,900 tok'}, dec2:{value:'prime suspect: prompt growth'}}, dur:5200},
    {caption:'<b>Decode and GPU?</b> TPOT is unchanged and DCGM shows no new Xid, normal power and clocks. A sick GPU or an oversized batch would slow decode too — so both are ruled out.', hl:['dec','gpu'], ok:['dec','gpu'], packets:[{edge:'e7'},{edge:'e8',delay:400}], set:{ev:{value:'TPOT flat, no Xid'}, dec2:{value:'decode + GPU: ruled out'}}, dur:4800},
    {caption:'<b>Upstream?</b> Gateway span latency is flat; retrieval latency is flat — retrieval is fast, it is just returning 4× more text. The cause is the config change found earlier.', hl:['up'], ok:['up'], packets:[{edge:'e9'}], set:{dec2:{value:'cause: top-k 20 → long prompts'}}, dur:4600},
    {caption:'<b>10:15 — Mitigate.</b> Reversible and fast: a feature flag sets top-k back to 5. No pod restarts (which would lose warm GPU capacity for minutes).', hl:['mit'], ok:['mit'], packets:[{edge:'e3',label:'flag',cls:'c-ok'}], set:{dec2:{value:'mitigation: top-k back to 5'}}, dur:4600},
    {caption:'<b>10:24 — Verify.</b> Prompt tokens per request back to ≈ 1,200; TTFT p95 0.52 s; short-window burn rate below 1×. Resolved at 10:40 after a sustained period.', hl:['ver'], ok:['ver'], packets:[{edge:'e4',label:'watch',cls:'c-ok'}], set:{ch:{t:[[0,0.45],[10,0.46],[20,1.2],[32,2.3],[45,2.1],[54,0.52],[60,0.48]]}, ev:{value:'TTFT p95 0.52 s, burn < 1×'}}, dur:5000},
    {caption:'<b>Learn.</b> Blameless postmortem: root cause (retrieval config grew prompts 3×), detection gap (no alert on prompt tokens per request), actions with owners: gateway token budget, canary with TTFT analysis for retrieval config, prompt-size alert.', hl:['alert','pre','mit'], set:{dec2:{value:'3 actions, owners assigned'}}, dur:5200}
  ]
});

Anim.register({
  id:'v3-ivw-framework', title:'Building an answer with the six-step framework: "Our LLM API is slow"', w:960, h:400,
  elements:[
    {type:'node', id:'w', x:20, y:40, w:140, h:56, label:'1 Workload', sub:'clarify', icon:'search'},
    {type:'node', id:'p', x:178, y:40, w:140, h:56, label:'2 Path', sub:'draw it', icon:'globe'},
    {type:'node', id:'b', x:336, y:40, w:140, h:56, label:'3 Bottleneck', sub:'which binds', icon:'warn'},
    {type:'node', id:'o', x:494, y:40, w:140, h:56, label:'4 Options', sub:'with metrics', icon:'chart'},
    {type:'node', id:'f', x:652, y:40, w:140, h:56, label:'5 Failure', sub:'rollback', icon:'shield'},
    {type:'node', id:'v', x:810, y:40, w:130, h:56, label:'6 Validate', sub:'evidence', icon:'check'},
    {type:'edge', id:'e1', from:'w', to:'p'},
    {type:'edge', id:'e2', from:'p', to:'b'},
    {type:'edge', id:'e3', from:'b', to:'o'},
    {type:'edge', id:'e4', from:'o', to:'f'},
    {type:'edge', id:'e5', from:'f', to:'v'},
    {type:'bar', id:'str', x:20, y:150, w:920, h:22, label:'Answer strength (mechanism + numbers + trade-offs + validation)', value:0.05, text:'weak', thresholds:false},
    {type:'label', id:'said', x:20, y:210, text:'Candidate says: "We should add more GPUs."'}
  ],
  steps:[
    {caption:'The reflex answer — "add more GPUs" — has no mechanism, no number, no trade-off and no validation. Interviewers hear it constantly. Watch the same answer grow through the six steps.', hl:['str'], dur:4200},
    {caption:'<b>1 Workload.</b> Clarify before solving: TTFT or TPOT? Which percentile, since when, which models and tenants? Typical prompt and output lengths? This alone shows you know latency has two halves.', hl:['w'], set:{str:{value:0.2,text:'clarified'}, said:{text:'"Is it time to first token or the stream? Which p95, since when, which tenants,\nand what are typical prompt and output lengths?"'}}, dur:4800},
    {caption:'<b>2 Path.</b> Draw the request: client → gateway → retrieval → engine queue → prefill → decode → stream. Each hop is a span you can measure.', hl:['p'], packets:[{edge:'e1'}], set:{str:{value:0.35,text:'+ path'}, said:{text:'"Client → gateway → retrieval → engine queue → prefill → decode → stream.\nI’d pull a trace with a span per hop."'}}, dur:4600},
    {caption:'<b>3 Bottleneck.</b> Name the discriminating signals: TTFT up and TPOT flat → queueing or prefill (waiting requests, KV usage, prompt tokens). TPOT up → decode (batch, GPU health).', hl:['b'], packets:[{edge:'e2'}], set:{str:{value:0.55,text:'+ mechanism'}, said:{text:'"TTFT up, TPOT flat → queue or prefill: vllm:num_requests_waiting, KV usage,\nprompt tokens per request. TPOT up → decode: batch size, Xid, clocks."'}}, dur:5200},
    {caption:'<b>4 Options with metrics.</b> KV-bound → scale out or cap context (judge by KV usage). Prompt growth → token budget, prefix caching (judge by prefill time). Decode-bound → smaller batch or more replicas (judge by TPOT p95).', hl:['o'], packets:[{edge:'e3'}], set:{str:{value:0.72,text:'+ trade-offs'}, said:{text:'"Three levers, each with the metric that chooses it — and the cheapest one first."'}}, dur:5000},
    {caption:'<b>5 Failure and rollback.</b> If a deploy or config change correlates, roll it back first; GPUs take minutes to add, so protect the SLO with admission control meanwhile.', hl:['f'], packets:[{edge:'e4'}], set:{str:{value:0.86,text:'+ safety'}, said:{text:'"If a change correlates, roll back first. Meanwhile admission control protects\nthe SLO, because new GPU replicas take minutes."'}}, dur:4800},
    {caption:'<b>6 Validate.</b> Say how you would know it worked: short-window burn rate under 1×, p95 back to baseline, and a postmortem with a leading-indicator alert. Same facts as the reflex answer — now a senior answer.', hl:['v'], ok:['v','str'], packets:[{edge:'e5',cls:'c-ok'}], set:{str:{value:0.98,text:'strong'}, said:{text:'"Done when burn rate is under 1× and p95 is back — then a postmortem\nwith an alert on prompt tokens per request."'}}, dur:5000}
  ]
});

Anim.register({
  id:'v3-wb-roofline', title:'Roofline on an H100: why decode is bandwidth-bound and prefill is compute-bound (8B, BF16)', w:960, h:430,
  elements:[
    {type:'chart', id:'rf', x:90, y:40, w:520, h:300, xmax:600, ymax:1500, xlabel:'arithmetic intensity (FLOP per byte)', ylabel:'attainable TFLOP/s', series:[
      {id:'roof',label:'roofline',points:[[0,0],[295,989.5],[600,989.5]]},
      {id:'b1',label:'decode b=1',color:'#ef4444',points:[[1,0],[1,3.35]]},
      {id:'b64',label:'decode b=64',color:'#f59e0b',points:[[64,0],[64,214]]},
      {id:'kv',label:'b=64 + KV reads',color:'#a855f7',points:[[42,0],[42,141]]},
      {id:'pf',label:'prefill 2k (off-chart, ≈2,000)',color:'#22c55e',points:[[600,0],[600,989.5]]}]},
    {type:'counter', id:'ridge', x:660, y:60, label:'Ridge point', value:'—'},
    {type:'counter', id:'pt', x:660, y:140, label:'Point being placed', value:'—'},
    {type:'counter', id:'lim', x:660, y:220, label:'Limited by', value:'—'},
    {type:'label', id:'lesson', x:660, y:300, text:''}
  ],
  steps:[
    {caption:'The <b>roofline</b>: attainable performance = min(peak FLOP/s, bandwidth × intensity). H100 SXM: 3.35 TB/s of HBM and ≈ 989.5 TFLOP/s dense BF16. The sloped part is bandwidth-bound; the flat part compute-bound.', set:{rf:{roof:[[0,0],[295,989.5],[600,989.5]],b1:[[0,0],[0,0]],b64:[[0,0],[0,0]],kv:[[0,0],[0,0]],pf:[[0,0],[0,0]]}}, dur:5000},
    {caption:'The <b>ridge point</b> is where they meet: 989.5 × 10¹² ÷ 3.35 × 10¹² ≈ <b>295 FLOP per byte</b>. A kernel needs at least that much arithmetic per byte read to use the Tensor Cores fully.', hl:['ridge'], set:{ridge:{value:'≈ 295 FLOP/B'}}, dur:4800},
    {caption:'<b>Decode at batch 1.</b> Each step reads all 16 GB of weights to do ≈ 2 FLOPs per parameter: ≈ 1 FLOP/byte. Attainable ≈ 3.35 TFLOP/s — about 0.3 % of peak. Time per token ≥ 4.8 ms.', set:{rf:{b1:[[1,0],[1,3.35]]}, pt:{value:'decode b=1 → 1 FLOP/B'}, lim:{value:'HBM bandwidth'}}, dur:5000},
    {caption:'<b>Decode at batch 64.</b> The same weight read now serves 64 sequences: ≈ 64 FLOP/byte → up to ≈ 214 TFLOP/s. Throughput rises ~64× while time per step barely moves. This is why continuous batching exists.', set:{rf:{b64:[[64,0],[64,214]]}, pt:{value:'decode b=64 → 64 FLOP/B'}, lim:{value:'still bandwidth'}}, dur:5000},
    {caption:'<b>But KV reads add bytes.</b> With 1,000-token contexts, each step also reads 64 × 1,000 × 128 KiB = 8.4 GB of KV. Intensity falls to ≈ 1.03 × 10¹² ÷ 24.5 × 10⁹ ≈ 42 FLOP/byte (≈ 141 TFLOP/s). Long contexts make decode <i>more</i> bandwidth-bound.', set:{rf:{kv:[[42,0],[42,141]]}, pt:{value:'b=64 + KV → ≈ 42 FLOP/B'}}, dur:5400},
    {caption:'<b>Prefill of 2,000 tokens.</b> One weight read serves 2,000 tokens: ≈ 2,000 FLOP/byte (off the right edge of this chart). It sits on the flat roof: <b>compute-bound</b>. Its time ≈ FLOPs ÷ (peak × MFU) and it sets TTFT.', set:{rf:{pf:[[600,0],[600,989.5]]}, pt:{value:'prefill 2k → ≈ 2,000 FLOP/B'}, lim:{value:'Tensor Core compute'}}, dur:5200},
    {caption:'<b>What to say:</b> "Decode is bandwidth-bound, so I batch it and pick GPUs by HBM bandwidth and capacity; prefill is compute-bound, so long prompts cost TTFT and FLOPs." Peak TFLOPS on a spec sheet mostly matters for prefill and training.', show:['lesson'], set:{lesson:{text:'decode → bandwidth → batch it\nprefill → compute → TTFT\nKV reads lower intensity further'}}, dur:5200}
  ]
});

Anim.register({
  id:'v3-dbg-method', title:'Narrowing a symptom layer by layer (drill D2: GPUs at 30 %, latency high)', w:960, h:420,
  elements:[
    {type:'node', id:'sym', x:20, y:30, w:920, h:50, label:'Symptom: latency p95 3× worse, GPU utilisation only 30 %', icon:'warn'},
    {type:'node', id:'gw', x:20, y:130, w:165, h:56, label:'Gateway', sub:'queue, spans', icon:'shield'},
    {type:'node', id:'eq', x:205, y:130, w:165, h:56, label:'Engine queue', sub:'waiting', icon:'queue'},
    {type:'node', id:'pf', x:390, y:130, w:165, h:56, label:'Prefill / decode', sub:'TTFT, TPOT', icon:'bolt'},
    {type:'node', id:'kv', x:575, y:130, w:165, h:56, label:'KV + GPU', sub:'kv usage, DCGM', icon:'gpu'},
    {type:'node', id:'ct', x:760, y:130, w:180, h:56, label:'Container', sub:'CPU throttling', icon:'k8s'},
    {type:'edge', id:'e1', from:'gw', to:'eq'},
    {type:'edge', id:'e2', from:'eq', to:'pf'},
    {type:'edge', id:'e3', from:'pf', to:'kv'},
    {type:'edge', id:'e4', from:'kv', to:'ct'},
    {type:'counter', id:'h', x:20, y:250, label:'Hypothesis under test', value:'—'},
    {type:'counter', id:'ev', x:20, y:310, label:'Evidence', value:'—'},
    {type:'counter', id:'v', x:20, y:370, label:'Verdict', value:'—'}
  ],
  steps:[
    {caption:'The tempting conclusion is "buy faster GPUs". The method says: walk the request path, and for each layer state what evidence would rule it in or out. Low GPU utilisation already hints the GPU is <i>waiting</i>, not working.', hl:['sym'], dur:4600},
    {caption:'<b>Gateway.</b> Is work piling up before the engine (a concurrency or connection limit)? Gateway queue time is small and upstream concurrency is well below its limit.', hl:['gw'], set:{h:{value:'gateway limiting concurrency'}, ev:{value:'gateway queue p95 8 ms; limit not reached'}, v:{value:'ruled out'}}, dim:['eq','pf','kv','ct'], dur:4600},
    {caption:'<b>Engine queue.</b> <code>vllm:num_requests_waiting</code> is near 0 and running requests are low per step — yet requests take long. The engine is not saturated; something slows each step.', hl:['eq'], ok:['gw'], packets:[{edge:'e1'}], set:{h:{value:'engine capacity / KV queueing'}, ev:{value:'waiting ≈ 0, running low'}, v:{value:'not a capacity queue'}}, dim:['pf','kv','ct'], dur:4800},
    {caption:'<b>Prefill and decode.</b> Both TTFT and TPOT are up, and prompt lengths are unchanged. Every step is slower — consistent with gaps <i>between</i> GPU steps rather than heavier GPU work.', hl:['pf'], ok:['gw','eq'], packets:[{edge:'e2'}], set:{h:{value:'heavier prompts / outputs'}, ev:{value:'tokens per request flat; TTFT and TPOT both ↑'}, v:{value:'ruled out — steps are slow'}}, dim:['kv','ct'], dur:4800},
    {caption:'<b>KV and GPU health.</b> KV usage 0.35; no Xid; clocks and power normal; tensor-pipe activity low. The GPU is idle between steps, not sick.', hl:['kv'], ok:['gw','eq','pf'], packets:[{edge:'e3'}], set:{h:{value:'KV pressure or GPU fault'}, ev:{value:'KV 0.35, no Xid, tensor active low'}, v:{value:'ruled out — GPU waiting'}}, dim:['ct'], dur:4800},
    {caption:'<b>Container.</b> The engine’s CPU-side work (scheduler loop, tokenizer, detokenizer, HTTP streaming) needs cores. CFS throttled periods exceed 60 % for the vllm container with a 2-core limit.', hl:['ct'], bad:['ct'], ok:['gw','eq','pf','kv'], packets:[{edge:'e4',cls:'c-bad'}], set:{h:{value:'engine CPU-starved'}, ev:{value:'cfs_throttled / cfs_periods > 0.6'}, v:{value:'root cause found'}}, dur:5000},
    {caption:'<b>Fix and prevent.</b> Raise the CPU request/limit for engine pods; GPU utilisation rises and latency drops without new GPUs. Add a throttling alert on GPU pods and include real resource specs in load tests.', ok:['ct','sym'], set:{v:{value:'fixed: CPU limit raised; alert added'}}, dur:4800}
  ]
});

Anim.register({
  id:'v3-sd-gateway', title:'One request through an enterprise AI gateway (with a fallback when a backend fails)', w:960, h:420,
  elements:[
    {type:'node', id:'app', x:20, y:60, w:120, h:56, label:'Team app', sub:'API key / JWT', icon:'user'},
    {type:'node', id:'auth', x:160, y:60, w:120, h:56, label:'AuthN', sub:'which app?', icon:'key'},
    {type:'node', id:'quota', x:300, y:60, w:120, h:56, label:'Quota', sub:'tokens/min', icon:'clock'},
    {type:'node', id:'pol', x:440, y:60, w:120, h:56, label:'Policy', sub:'PII, residency', icon:'shield'},
    {type:'node', id:'rt', x:580, y:60, w:120, h:56, label:'Router', sub:'alias → model', icon:'gear'},
    {type:'node', id:'cache', x:720, y:60, w:120, h:56, label:'Cache', sub:'tenant-keyed', icon:'cache'},
    {type:'node', id:'ext', x:580, y:220, w:170, h:56, label:'External API', sub:'provider A', icon:'cloud'},
    {type:'node', id:'vl', x:780, y:220, w:160, h:56, label:'vLLM pool', sub:'self-hosted', icon:'gpu'},
    {type:'node', id:'met', x:160, y:220, w:260, h:56, label:'Metering + audit', sub:'tokens, $ per team', icon:'money'},
    {type:'edge', id:'e1', from:'app', to:'auth'},
    {type:'edge', id:'e2', from:'auth', to:'quota'},
    {type:'edge', id:'e3', from:'quota', to:'pol'},
    {type:'edge', id:'e4', from:'pol', to:'rt'},
    {type:'edge', id:'e5', from:'rt', to:'cache'},
    {type:'edge', id:'e6', from:'rt', to:'ext'},
    {type:'edge', id:'e7', from:'rt', to:'vl'},
    {type:'edge', id:'e8', from:'ext', to:'met'},
    {type:'counter', id:'st', x:20, y:330, label:'Request state', value:'—'},
    {type:'counter', id:'lat', x:520, y:330, label:'Gateway overhead so far', value:'0 ms'}
  ],
  steps:[
    {caption:'A team’s app sends a chat request for model alias <code>chat-default</code> with streaming on. It never names a vendor, so the platform can change routes without app changes.', hl:['app'], packets:[{edge:'e1',label:'POST'}], set:{st:{value:'received'}}, dur:4400},
    {caption:'<b>Authentication.</b> The key or JWT identifies the app and team. Unknown or revoked credentials stop here with 401.', hl:['auth'], ok:['auth'], packets:[{edge:'e2'}], set:{st:{value:'team = payments-ai'}, lat:{value:'2 ms'}}, dur:4200},
    {caption:'<b>Quota.</b> Token-per-minute and request limits for this team and model are checked. Output tokens are only known afterwards, so token usage is charged when the response completes; the next request may get 429.', hl:['quota'], ok:['quota'], packets:[{edge:'e3'}], set:{st:{value:'within quota (61 % used)'}, lat:{value:'4 ms'}}, dur:4800},
    {caption:'<b>Policy.</b> A PII detector finds a passport number and masks it; the request is tagged as residency-bound, so only in-region backends are allowed for it.', hl:['pol'], warn:['pol'], packets:[{edge:'e4',label:'masked'}], set:{st:{value:'PII masked, residency: in-region'}, lat:{value:'11 ms'}}, dur:4800},
    {caption:'<b>Router + cache.</b> The alias resolves to an ordered list: provider A, then the self-hosted pool. A tenant-keyed cache (tenant + model + prompt version) misses.', hl:['rt','cache'], packets:[{edge:'e5',label:'lookup'},{edge:'e5',label:'miss',reverse:true,delay:600}], set:{st:{value:'cache miss → route to provider A'}, lat:{value:'14 ms'}}, dur:4800},
    {caption:'<b>Backend failure.</b> Provider A returns 503s; the circuit breaker for that route opens after the error threshold.', hl:['ext'], bad:['ext'], packets:[{edge:'e6',label:'request'},{edge:'e6',label:'503',reverse:true,delay:700,cls:'c-bad'}], set:{st:{value:'provider A failing, breaker open'}}, dur:4600},
    {caption:'<b>Fallback.</b> The router retries once on the self-hosted vLLM pool, which is also in-region, so the residency policy still holds. Tokens stream back to the app.', hl:['vl'], ok:['vl'], packets:[{edge:'e7',label:'retry',cls:'c-ok'},{edge:'e7',label:'stream',reverse:true,delay:800,cls:'c-ok'}], set:{st:{value:'served by vLLM pool (fallback)'}, lat:{value:'16 ms + model time'}}, dur:5000},
    {caption:'<b>Metering and audit.</b> Input and output tokens, model, backend, team, latency and the fallback are recorded (prompt content only if opted in, redacted). Chargeback and the provider-error SLO both come from this record.', hl:['met'], ok:['met'], packets:[{edge:'e8',label:'usage',cls:'c-purple'}], set:{st:{value:'metered: 840 in / 230 out tokens'}}, dur:4800}
  ]
});
