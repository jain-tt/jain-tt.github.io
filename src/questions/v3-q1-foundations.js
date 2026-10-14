/* Vol 3, Part 2, Chapter 1 — Questions: ML foundations and LLM internals */
registerLesson({
  id:'v3-ch-foundations', vol:3, part:2, num:1,
  title:'Questions: ML foundations and LLM internals', minutes:110,
  summary:'This chapter is the interview question bank for how a language model actually works: tokens, embeddings, attention, the decoder stack, logits and sampling, and why models hallucinate. Platform interviewers ask these to check that you can reason about cost, latency and memory from first principles instead of treating the model as a black box. Every answer is built to be spoken in under a minute and then defended with real numbers from Llama 3.1 model configs.',
  objectives:[
    'Explain an LLM request end to end, from text to streamed tokens, and link each stage to TTFT, TPOT and memory.',
    'Explain attention with the scaled dot-product formula, the causal mask, multi-head attention and grouped-query attention.',
    'Estimate parameter count and FLOPs per token from a model config.',
    'Explain tokenization, sampling and hallucination in terms an engineer can act on.',
    'Explain why long context and Mixture-of-Experts change memory and compute differently.'
  ],
  prereqs:['v1-neural-networks','v1-tokenization-embeddings','v1-transformer','v1-generation'],
  next:['v3-ch-training','v3-ch-gpu','v3-ch-inference','v3-prove-llm'],
  tags:['interview','transformer','attention','tokenization','fundamentals'],
  html:`
<h2>What interviewers test in this area</h2>
<p>An AI platform interview rarely asks you to derive backpropagation. It asks whether your mental model of the model is good enough to make infrastructure decisions. If you know that every request runs the same weights but owns a private, growing KV cache, you can explain why concurrency is memory-bound. If you know the model produces a probability distribution and then samples, you can explain why temperature 0 is not a correctness setting. If you know tokens are not words, you can explain why the same Arabic prompt costs more on one model than another.</p>
<p>Expect three kinds of question. <b>Explain</b> questions ("how does an LLM work?", "explain attention") test clarity: can you explain it in plain words and then go one level deeper with real shapes. <b>Estimate</b> questions ("how many parameters?", "how many FLOPs per token?") test whether you can read a <code>config.json</code>. <b>Consequence</b> questions ("why does long context cost more?", "why do models hallucinate?") test whether you connect internals to cost, latency and risk.</p>

<h2>The mental model</h2>
${fig('One request through a decoder-only LLM', svgDiagram({w:900,h:250,
  boxes:[
    {id:'t',x:20,y:90,w:120,h:60,label:'Tokenizer',sub:'text → IDs',cls:'v1'},
    {id:'e',x:170,y:90,w:120,h:60,label:'Embeddings',sub:'ID → vector',cls:'v1'},
    {id:'b',x:320,y:90,w:200,h:60,label:'N decoder blocks',sub:'attention + MLP',cls:'hl'},
    {id:'h',x:550,y:90,w:120,h:60,label:'LM head',sub:'→ logits',cls:'v2'},
    {id:'s',x:700,y:90,w:180,h:60,label:'Sample',sub:'temp, top-p → token',cls:'v2'},
    {id:'kv',x:320,y:190,w:200,h:50,label:'KV cache',sub:'per request, grows',cls:'warn'}
  ],
  arrows:[{from:'t',to:'e'},{from:'e',to:'b'},{from:'b',to:'h'},{from:'h',to:'s'},{from:'b',to:'kv',both:true},{from:'s',to:'b',cls:'dash',label:'next token loops back',fromSide:'top',toSide:'top'}]
}), 'Prefill runs the whole prompt through the blocks once; decode loops one token at a time, reading the KV cache.')}

<h2>Say it like a senior engineer</h2>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"The model understands the question and generates an answer."</p></div><div class="good"><h4>Strong answer</h4><p>"The prompt is tokenized and processed in one parallel prefill pass that fills the KV cache; then decode produces one token per forward pass by sampling from the output distribution. Prefill sets time-to-first-token, decode sets time-per-output-token."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Attention lets the model focus on important words."</p></div><div class="good"><h4>Strong answer</h4><p>"Each position computes a query, compares it with every earlier key using a scaled dot product, softmaxes the scores and takes a weighted average of the values. With grouped-query attention, many query heads share fewer key-value heads, which is what keeps the KV cache small."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Set temperature to zero to stop hallucinations."</p></div><div class="good"><h4>Strong answer</h4><p>"Temperature only sharpens the distribution. A model can be confidently wrong at temperature zero. I reduce hallucination with grounding, citations, abstention and evaluation."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"A 70B model needs a big GPU."</p></div><div class="good"><h4>Strong answer</h4><p>"70.6 billion parameters at 2 bytes is about 141 GB in BF16, so at least two 80 GB GPUs before any KV cache; the config tells me 80 layers and 8 KV heads, so each token of context adds 320 KiB."</p></div></div>

<h2>Must-know numbers (derive them)</h2>
${formula(`
STEP 1  Parameters of Llama-3.1-8B from config.json
        embeddings + LM head (untied) : 2 × 128,256 × 4,096   = 1,050,673,152
        per layer attention            : q 16.8M + k 4.2M + v 4.2M + o 16.8M = 41,943,040
        per layer MLP (SwiGLU, 3 mats)  : 3 × 4,096 × 14,336  = 176,160,768
        32 layers × 218,112,000 (incl. norms) = 6,979,584,000
        total ≈ 8.03 × 10⁹

STEP 2  FLOPs per generated token (forward)   ≈ 2 × N  = 2 × 8.03 × 10⁹ ≈ 16 GFLOP
        Training FLOPs per token               ≈ 6 × N  (forward 2N + backward 4N)

STEP 3  KV cache per token = 2 × layers × kv_heads × head_dim × bytes
        8B : 2 × 32 × 8 × 128 × 2 = 131,072 B = 128 KiB
        70B: 2 × 80 × 8 × 128 × 2 = 327,680 B = 320 KiB

STEP 4  Weights = params × bytes   70.6B × 2 B ≈ 141 GB (BF16)
`)}

<h2>How to use this chapter</h2>
<p>Say each answer aloud before revealing it, then do the follow-ups. The deeper lessons are ${L('v1-transformer','the transformer')}, ${L('v1-tokenization-embeddings','tokenization and embeddings')} and ${L('v1-generation','generation and sampling')}. The capstone demonstration is ${L('v3-prove-llm','Prove it 1: explain how an LLM works end to end')}. Train your tiny model in <code>labs/02-tiny-transformer/tiny_gpt.py</code> first: answers land better when you can say "[In my lab, the attention block I wrote…]".</p>
`,
  quiz:[
    {q:'Llama-3.1-70B has 64 attention heads and 8 KV heads. Why does this matter for serving?',options:['It makes training faster only','The KV cache stores 8 heads per layer, not 64, so KV memory per token is 8× smaller','It reduces the parameter count by 8×','It doubles the context window'],answer:1,explain:'Grouped-query attention shares K and V across query groups; KV per token is 2 × 80 × 8 × 128 × 2 = 320 KiB. Parameters shrink only a little (k and v projections).'},
    {q:'Logits [2.0, 1.0, 0.1] at temperature 0.5. Probability of the first token?',options:['0.66','0.86','0.50','1.00'],answer:1,explain:'Divide by 0.5 → [4, 2, 0.2]; exp → 54.6, 7.39, 1.22; 54.6 / 63.2 ≈ 0.86. Lower temperature sharpens, it does not make it 1.0.'},
    {q:'Roughly how many FLOPs does an 8B dense model spend per generated token (ignoring attention over context)?',options:['8 GFLOP','16 GFLOP','48 GFLOP','16 TFLOP'],answer:1,explain:'About 2 FLOPs per parameter per token (one multiply, one add) → 2 × 8 × 10⁹ = 16 GFLOP. 6N is training.'},
    {q:'Which statement about temperature 0 is correct?',options:['It guarantees factual answers','It is greedy decoding but outputs can still vary slightly with batching and numerics','It disables the KV cache','It increases diversity'],answer:1,explain:'Greedy picks the argmax, but floating-point reductions can differ with batch composition and kernels, and greedy answers can still be wrong.'},
    {q:'gpt-oss-120b has 117B total and 5.1B active parameters. Which is true?',options:['It needs memory for 5.1B parameters','Compute per token scales with active parameters, memory with total parameters','It is a dense model','It cannot be served on GPUs'],answer:1,explain:'MoE routes each token to a few experts, so FLOPs follow active parameters, but all experts must be resident in memory.'}
  ],
  flashcards:[
    {front:'LLM request in one line',back:'Tokenize → embed → N decoder blocks (attention + MLP) → LM head logits → sample → detokenize; prefill once, decode one token per pass with KV cache.'},
    {front:'Attention formula',back:'softmax(QKᵀ / √dₖ + causal mask) · V, per head; heads concatenated and projected by Wₒ.'},
    {front:'FLOPs per token',back:'≈ 2N forward (inference), ≈ 6N training (forward + backward), N = parameters; attention adds a term growing with context.'},
    {front:'Llama-3.1-8B parameter count',back:'≈ 8.03B: 1.05B embeddings + LM head, 32 layers × 218.1M (attention 41.9M + MLP 176.2M).'},
    {front:'Why temperature 0 ≠ truth',back:'It picks the most probable token; the most probable continuation can be wrong. Temperature changes sharpness, not knowledge.'},
    {front:'MoE memory vs compute',back:'Memory ∝ total parameters (all experts resident). Compute ∝ active parameters per token.'},
    {front:'Why tokens ≠ words',back:'Subword vocabularies (BPE) split rare words and non-English scripts into more pieces; the same text has different token counts per tokenizer.'},
    {front:'Long context cost',back:'Prefill attention FLOPs grow ≈ n², KV memory grows ≈ n per sequence, TTFT grows with prompt length.'}
  ]
});

registerQuestions([
{
  id:'fnd-01', chapter:'v3-ch-foundations', difficulty:1,
  title:'How does an LLM work, end to end?',
  understand:'The most common opener. They want a clear pipeline with correct names, and a hint that you know the serving consequences: prefill versus decode, the KV cache, and sampling. Depth beats buzzwords.',
  short:'The text is first turned into token IDs by the model\'s tokenizer, using its chat template. Each ID looks up a learned vector, an embedding. Those vectors go through a stack of identical decoder blocks; in each, attention lets every position mix in information from earlier positions, and an MLP transforms each position. At the end, the last position\'s vector is projected to a score for every token in the vocabulary, softmax turns those scores into probabilities, and the sampler picks one. That token is appended and the loop repeats. The first pass over the whole prompt is prefill, which fills the KV cache and sets time to first token; each later step processes one new token, reads the cache, and sets the time per output token.',
  detailed:`
<h3>Stage by stage, with Llama-3.1-8B shapes</h3>
${table(['Stage','What happens','Shape / number'],[
 ['Chat template','roles wrapped in special tokens','model-specific; must match training'],
 ['Tokenizer','byte-level BPE → IDs','vocab 128,256'],
 ['Embedding','ID selects a row of a learned matrix','[n, 4096]; table = 525M params'],
 ['32 decoder blocks','RMSNorm → attention (+residual) → RMSNorm → SwiGLU MLP (+residual)','[n, 4096] in and out'],
 ['Final norm + LM head','last position × [4096 × 128,256]','128,256 logits'],
 ['Sampler','temperature, top-k/top-p, penalties','one token ID'],
 ['Detokenize + stream','ID → text bytes, sent as SSE chunk','per token']
])}
<h3>Two phases</h3>
<p><b>Prefill</b>: all n prompt tokens go through the blocks in parallel. Lots of matrix-matrix work, usually compute-bound. It produces the keys and values of every prompt token in every layer, the ${term('KV cache')}, and the first output token. Its duration is most of TTFT.</p>
<p><b>Decode</b>: one token per step. Each step reads all the weights (16 GB for 8B in BF16) to process one token per sequence, plus that sequence's KV cache. Little arithmetic per byte, so decode is memory-bandwidth-bound; batching many sequences per step is how engines recover efficiency.</p>
${formula(`
Lower bound on decode step time (batch 1, 8B, BF16, one H100)
      bytes read    16 × 10⁹ B
  t ≥ ──────────  = ──────────────── ≈ 4.8 ms per token  → ≤ ≈ 209 tokens/s
      bandwidth     3.35 × 10¹² B/s
`)}
<h3>What is shared and what is private</h3>
<p>Weights are read-only and shared by every request on the replica. The KV cache is private per request and grows by 128 KiB per token for this model. That single fact explains why concurrency, not model size, usually limits how many users a GPU serves (see ${L('v1-kv-cache','the KV cache lesson')}).</p>
<p>Where training differs: training runs the same forward pass on known text, computes cross-entropy against the actual next tokens, and backpropagates to update weights. Inference never updates weights.</p>`,
  diagram:anim('v3q-fnd-e2e'),
  followups:[
    {q:'Where does the "knowledge" live?',a:'Distributed across the weights, mostly the MLP and attention projections, as learned statistical associations. There is no lookup table of facts, which is one reason the model can produce fluent but wrong text.'},
    {q:'Why does the first token take much longer than the rest?',a:'TTFT includes queueing plus prefill over the whole prompt; later tokens each cost one decode step. A 4,000-token prompt can take hundreds of milliseconds of prefill on a busy GPU, while a decode step is a few to tens of milliseconds.'},
    {q:'What breaks if the chat template at serving differs from training?',a:'The model sees token patterns it was not tuned on: it may ignore the system prompt, continue the user\'s turn, or never emit the end token. Always use the tokenizer\'s own chat template.'},
    {q:'Why is decode memory-bound but prefill compute-bound?',a:'Arithmetic intensity: prefill does about 2 FLOPs per weight per prompt token, so with thousands of tokens it reuses each weight byte many times. Decode with a small batch uses each weight once per step, about 1 FLOP per byte in BF16, far below the H100 ridge point of about 295.'}
  ],
  tradeoffs:`<ul><li><b>Bigger model</b>: better quality, more bytes read per decode step (slower TPOT), more GPUs.</li><li><b>Longer prompt</b>: more context, longer prefill and more KV memory.</li><li><b>Larger decode batch</b>: higher throughput per GPU, slightly slower per-token latency for each user.</li></ul>`,
  failures:`<ul><li><b>Model never stops</b> → wrong end-of-sequence/stop configuration or template → check generation config and template.</li><li><b>TTFT spikes</b> → long prompts or queueing → prompt length histogram, queue time metric.</li><li><b>Garbled characters in streams</b> → detokenizing partial UTF-8 bytes (common with Arabic) → use the engine\'s incremental detokenizer.</li></ul>`,
  vocab:[
    {term:'Prefill',def:'Processing all prompt tokens in parallel to build the KV cache and the first output token.'},
    {term:'Decode',def:'Generating one token per forward pass, reusing the KV cache.'},
    {term:'Logits',def:'Raw, unnormalised scores for every vocabulary token.'},
    {term:'LM head',def:'Final linear layer projecting the hidden state to vocabulary logits.'},
    {term:'Chat template',def:'Model-specific format that wraps messages with role and special tokens.'},
    {term:'Residual stream',def:'The hidden vector each block reads from and adds its output back into.'}
  ],
  mistakes:[
    'Saying the model "retrieves facts from a database".',
    'Saying each new token reprocesses the whole prompt (it does not, thanks to the KV cache).',
    'Merging prefill and decode into one "latency" number.',
    'Forgetting the sampler: the model outputs a distribution, not a word.'
  ],
  related:['v1-transformer','v1-inference-anatomy','v1-kv-cache','v3-prove-llm']
},
{
  id:'fnd-02', chapter:'v3-ch-foundations', difficulty:2,
  title:'Explain attention — and why grouped-query attention matters for serving.',
  understand:'They want the actual mechanism (queries, keys, values, scaled dot product, softmax, causal mask, heads) and the link to the KV cache. A tiny worked example is a strong signal.',
  short:'Each token\'s hidden vector is projected into three vectors: a query, which says what it is looking for; a key, which says what it offers; and a value, the content it passes on. For a position, we take the dot product of its query with the keys of all earlier positions, divide by the square root of the head dimension to keep scores in a sane range, apply a causal mask so it cannot see the future, softmax the scores into weights that sum to one, and take the weighted average of the values. Multi-head attention does this in parallel with different learned projections. Grouped-query attention lets several query heads share one key-value head, which cuts the KV cache: Llama-3.1-70B has 64 query heads but 8 KV heads, so it caches 8 times less per token.',
  detailed:`
${formula(`
                     Q · Kᵀ
Attention(Q,K,V) = softmax( ──────── + M ) · V        M = causal mask (0 or −∞)
                      √dₖ

Q = X·W_Q,  K = X·W_K,  V = X·W_V      X = [n, d_model]
`)}
<h3>Tiny worked example (one head, dₖ = 2)</h3>
${formula(`
Query of token 3:  q₃ = [1, 0]
Keys:  k₁ = [1, 0]   k₂ = [0, 1]   k₃ = [1, 1]

STEP 1  scores   q₃·k₁ = 1    q₃·k₂ = 0    q₃·k₃ = 1
STEP 2  ÷ √2     0.707         0             0.707
STEP 3  exp      2.028         1.000         2.028        sum = 5.056
STEP 4  weights  0.401         0.198         0.401
ANSWER  out₃ = 0.401·v₁ + 0.198·v₂ + 0.401·v₃
`)}
<h3>Why divide by √dₖ</h3>
<p>Dot products of random vectors grow with dimension; without scaling, softmax saturates (one weight near 1, gradients near 0). Dividing by √dₖ keeps the variance roughly constant.</p>
<h3>Heads and GQA</h3>
<p>Llama-3.1-70B: hidden 8192 = 64 heads × 128. Each head learns a different pattern (previous-token, syntactic links, retrieval of a named entity). Outputs are concatenated and projected by W_O.</p>
${table(['Variant','Query heads','KV heads','KV per token (70B shape, BF16)'],[
 ['Multi-head (MHA)','64','64','2 × 80 × 64 × 128 × 2 = 2,621,440 B = 2.5 MiB'],
 ['Grouped-query (GQA)','64','8','2 × 80 × 8 × 128 × 2 = 327,680 B = 320 KiB'],
 ['Multi-query (MQA)','64','1','40 KiB']
])}
<p>At 8,192 tokens, MHA would need 20 GiB of KV per sequence versus 2.5 GiB with GQA. That 8× is directly 8× more concurrent long conversations per GPU. Quality is close to MHA in practice, which is why most recent open models use GQA (DeepSeek models use a different compression, multi-head latent attention).</p>
<h3>Cost</h3>
<p>Prefill computes an n × n score matrix per head: quadratic in context length. Decode computes one row (1 × n) per step: linear per step. FlashAttention computes the same exact result without storing the n × n matrix in HBM.</p>`,
  diagram:anim('v3q-fnd-attn'),
  followups:[
    {q:'Are attention weights an explanation of the model\'s reasoning?',a:'Not reliably. They show where one head in one layer mixed information, but the residual stream, MLPs and many heads all contribute; attention maps are a debugging hint, not a faithful explanation.'},
    {q:'Why can decode reuse cached K and V but not cached Q?',a:'Each new token needs its own query to look at the past; past tokens\' keys and values do not change because of the causal mask, so they are cached. Past queries are never needed again.'},
    {q:'What does the causal mask do during training?',a:'It lets the model train on every position of a sequence in parallel while each position only sees earlier tokens, so one forward pass gives n next-token predictions.'},
    {q:'How would you check a model\'s KV heads before sizing a deployment?',a:'Read num_key_value_heads, num_hidden_layers and head_dim (or hidden_size / num_attention_heads) in config.json, then apply 2 × layers × kv_heads × head_dim × bytes.'}
  ],
  tradeoffs:`<ul><li><b>Fewer KV heads</b>: smaller cache, more concurrency; possible small quality loss.</li><li><b>More heads</b>: more patterns, more KV (for MHA).</li><li><b>Exact vs approximate attention</b>: sliding-window or sparse attention cut cost at long context but change what the model can see.</li></ul>`,
  failures:`<ul><li><b>KV sizing 8× too high</b> → used attention heads instead of KV heads → recompute with num_key_value_heads.</li><li><b>Numerical overflow in custom kernels</b> → missing scaling or FP16 softmax → use fused, tested kernels.</li><li><b>Quality drop at long context</b> → position handling or attention dilution → evaluate at target lengths.</li></ul>`,
  vocab:[
    {term:'Query / key / value',def:'Learned projections: what a position looks for, what it offers, and what it passes on.'},
    {term:'Scaled dot-product attention',def:'softmax(QKᵀ/√dₖ)V.'},
    {term:'Causal mask',def:'Sets scores for future positions to −∞ so a token attends only to itself and earlier tokens.'},
    {term:'Multi-head attention',def:'Several attention computations in parallel with different projections, concatenated.'},
    {term:'GQA',def:'Grouped-query attention: groups of query heads share one K/V head, shrinking the KV cache.'}
  ],
  mistakes:[
    'Describing attention as a database lookup or keyword match.',
    'Forgetting the √dₖ scaling or the causal mask.',
    'Using query-head count for KV memory.',
    'Saying attention is linear in context length during prefill.'
  ],
  related:['v1-transformer','v1-kv-cache','v1-multi-gpu-profiling']
},
{
  id:'fnd-03', chapter:'v3-ch-foundations', difficulty:1,
  title:'What is tokenization and why do two models count the same text differently?',
  understand:'They check that you know tokens are subword pieces from a model-specific vocabulary, and that token counts drive cost, latency and context limits. For a GCC company, Arabic versus English is the natural example.',
  short:'A tokenizer maps text to integer IDs from a fixed vocabulary, usually learned with byte-pair encoding: frequent character sequences become single tokens, rare ones are split into several pieces. Each model has its own vocabulary and rules, so the same sentence can be 20 tokens in one model and 30 in another. That matters because everything is priced and limited in tokens: context window, KV cache memory, prefill time, and API bills. Languages under-represented in the tokenizer\'s training data, often including Arabic, tend to need more tokens per word, so I would measure token counts on real traffic in both languages with each candidate model\'s own tokenizer before comparing cost or context budgets.',
  detailed:`
<h3>How BPE builds a vocabulary</h3>
<p>Start from bytes (byte-level BPE, as in Llama 3) so any text is representable. Repeatedly merge the most frequent adjacent pair into a new symbol until the vocabulary reaches its target size (Llama 3: 128,256 entries). Common English words become one token; rare words, names, code identifiers and scripts the tokenizer saw less often split into several.</p>
${formula(`
Why token counts matter (per request)

cost        = input_tokens × price_in + output_tokens × price_out
KV memory   = (input + output) tokens × KV bytes per token
prefill time ∝ input tokens (plus an n² attention term)
context fit : input + max_output ≤ context window
`)}
<h3>Arabic and English (measure, do not assume)</h3>
<p>Token-per-word ratios depend on the tokenizer, the dialect, diacritics, and normalisation (different Unicode forms of the same letter). For a bilingual travel assistant, take 1,000 real de-identified prompts per language and count with each candidate model's tokenizer:</p>
${code('python',`from transformers import AutoTokenizer
tok = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B-Instruct")
for text in samples:
    n = len(tok.encode(text, add_special_tokens=False))
    # record n, chars, words, language`)}
<p>Report median and p95 tokens per request per language. These numbers feed capacity planning and per-tenant chargeback directly.</p>
<h3>Other places tokenization bites</h3>
<ul><li><b>Vocabulary size and parameters</b>: the embedding and LM head scale with vocab: 2 × 128,256 × 4,096 ≈ 1.05B parameters in Llama-3.1-8B (about 13 %).</li>
<li><b>Special tokens</b>: chat templates add role and end tokens; count them.</li>
<li><b>Prefix caching</b>: caches match exact token sequences; a whitespace change at the start of a system prompt changes every token after it.</li>
<li><b>Streaming</b>: one character (especially multi-byte UTF-8) can span tokens; detokenize incrementally.</li></ul>
<h3>How to say it in the interview</h3><p>Lead with the consequence, not the algorithm: "token counts are the unit of cost, context and KV memory, and they depend on the tokenizer and the language". Then give the method: measure on real traffic per language with each candidate model's tokenizer, report median and p95, and feed those numbers into capacity and pricing. That one sentence shows you will not plan a bilingual GCC product with English-only assumptions.</p>`,
  diagram:fig('Same meaning, different token counts', svgDiagram({w:900,h:200,
    boxes:[
      {id:'t',x:20,y:70,w:180,h:60,label:'Text',sub:'Arabic or English',cls:'v1'},
      {id:'a',x:260,y:20,w:200,h:56,label:'Tokenizer A',sub:'vocab, merges',cls:'v2'},
      {id:'b',x:260,y:124,w:200,h:56,label:'Tokenizer B',sub:'different vocab',cls:'v2'},
      {id:'na',x:520,y:20,w:160,h:56,label:'n₁ tokens',cls:'hl'},
      {id:'nb',x:520,y:124,w:160,h:56,label:'n₂ tokens',cls:'hl'},
      {id:'c',x:740,y:70,w:140,h:60,label:'Cost, KV,',sub:'TTFT, context',cls:'warn'}
    ],
    arrows:[{from:'t',to:'a'},{from:'t',to:'b'},{from:'a',to:'na'},{from:'b',to:'nb'},{from:'na',to:'c'},{from:'nb',to:'c'}]
  }), 'Compare models on tokens measured with their own tokenizers, not on characters or words.'),
  followups:[
    {q:'Why not use a character-level tokenizer to avoid these issues?',a:'Sequences get several times longer, so attention cost (≈ n²), KV memory and decode steps all grow. Subword vocabularies balance sequence length against vocabulary size.'},
    {q:'Two vendors charge the same price per million tokens. Is the cost the same?',a:'No. Cost per request = tokens × price, and token counts differ by tokenizer and language. Compare cost per real request measured on your traffic.'},
    {q:'Can you change a model\'s tokenizer?',a:'Not without retraining or at least adapting the embedding and LM head. Extending a vocabulary is possible but needs continued training so new token embeddings become meaningful.'}
  ],
  tradeoffs:`<ul><li><b>Larger vocabulary</b>: shorter sequences, bigger embedding/LM head, more memory per token in the softmax.</li><li><b>Smaller vocabulary</b>: smaller tables, longer sequences.</li><li><b>Text normalisation</b>: improves consistency, but must be applied identically at training and serving.</li></ul>`,
  failures:`<ul><li><b>Bills higher than estimated</b> → estimated with words or another model\'s tokenizer → re-measure.</li><li><b>Context-length errors for Arabic users only</b> → higher token counts → per-language limits.</li><li><b>Prefix cache hit rate low</b> → small text differences at the start of prompts → canonicalise the prefix.</li></ul>`,
  vocab:[
    {term:'BPE',def:'Byte-pair encoding: builds a subword vocabulary by merging frequent adjacent symbol pairs.'},
    {term:'Vocabulary',def:'The fixed set of tokens a model can read and emit (128,256 for Llama 3).'},
    {term:'Special tokens',def:'Reserved IDs for roles, beginning/end of sequence and tool calls.'},
    {term:'Token fertility',def:'Average tokens per word for a language under a given tokenizer.'},
    {term:'Detokenization',def:'Converting IDs back to text, incrementally when streaming.'}
  ],
  mistakes:[
    'Saying "a token is a word" or using fixed 4-characters-per-token rules for all languages.',
    'Comparing models\' prices without measuring token counts on real traffic.',
    'Forgetting chat-template special tokens in context budgets.',
    'Quoting an Arabic token ratio without measuring it.'
  ],
  related:['v1-tokenization-embeddings','v2-capacity-planning','v2-finops-unit-economics']
},
{
  id:'fnd-04', chapter:'v3-ch-foundations', difficulty:2,
  title:'What are logits, softmax and temperature — and is temperature 0 deterministic?',
  understand:'They want the pipeline from raw scores to a chosen token and an honest answer about determinism. A worked softmax with two temperatures shows you really know it.',
  short:'The model\'s final layer outputs a logit, a raw score, for every token in the vocabulary. Softmax exponentiates and normalises them into probabilities. Temperature divides the logits before softmax: below one sharpens the distribution toward the top token, above one flattens it. Top-k and top-p then restrict sampling to the most likely tokens before one is drawn. Temperature zero usually means greedy decoding, always the top token, but it is not perfectly deterministic in a serving engine, because batching and parallel floating-point reductions can change the logits in the last decimal places and flip a near-tie. And determinism is not correctness: greedy can be confidently wrong.',
  detailed:`
${formula(`
              exp(zᵢ / T)
  pᵢ  =  ─────────────────
           Σⱼ exp(zⱼ / T)

Worked: logits z = [2.0, 1.0, 0.1]

T = 1.0   exp → 7.389, 2.718, 1.105   sum 11.212   p = 0.659, 0.242, 0.099
T = 0.5   z/T = 4, 2, 0.2
          exp → 54.598, 7.389, 1.221  sum 63.208   p = 0.864, 0.117, 0.019
T = 2.0   z/T = 1, 0.5, 0.05
          exp → 2.718, 1.649, 1.051   sum 5.418    p = 0.502, 0.304, 0.194
`)}
<h3>Decoding controls</h3>
${table(['Control','What it does','Typical use'],[
 ['Greedy (T=0)','argmax every step','extraction, classification, tool arguments'],
 ['Temperature','sharpen/flatten','creative vs precise text'],
 ['Top-k','keep the k most likely tokens','limit long tail'],
 ['Top-p (nucleus)','keep the smallest set with cumulative probability ≥ p','adaptive tail cut'],
 ['Repetition/frequency penalties','down-weight tokens already used','avoid loops'],
 ['Structured outputs','mask tokens that would break a JSON schema or grammar','reliable machine-readable output']
])}
<h3>Why T = 0 can still vary</h3>
<p>GPU kernels sum in parallel; floating-point addition is not associative, so a different batch composition or kernel choice can change logits by tiny amounts. When two tokens are nearly tied, that flips the argmax and the rest of the answer diverges. Engines can offer batch-invariant or deterministic modes at some throughput cost; check your engine's documentation. Seeds fix sampling randomness, not numerics.</p>
<p>Structured output (vLLM <code>structured_outputs</code> with xgrammar or guidance backends, as of v0.31) is a stronger tool than temperature for machine-readable results: it makes invalid tokens impossible.</p>
<h3>Penalties and stop conditions</h3><p>Presence and frequency penalties subtract from logits of tokens already generated, which reduces loops in long greedy outputs but can also suppress legitimately repeated terms such as a booking reference. Stop strings and the end-of-sequence token end generation; a missing stop configuration is a common cause of runaway outputs and cost. In platform terms, sampling parameters are part of the request contract: log them with every request, set safe defaults at the gateway, and cap <code>max_tokens</code> per product tier so a single request cannot generate an unbounded bill.</p>`,
  diagram:fig('From logits to one token', svgDiagram({w:900,h:180,
    boxes:[
      {id:'l',x:20,y:60,w:150,h:60,label:'Logits',sub:'128,256 scores',cls:'v1'},
      {id:'t',x:200,y:60,w:130,h:60,label:'÷ T',sub:'temperature',cls:'v2'},
      {id:'s',x:360,y:60,w:130,h:60,label:'Softmax',sub:'probabilities',cls:'v2'},
      {id:'f',x:520,y:60,w:170,h:60,label:'Filter',sub:'top-k, top-p, grammar',cls:'warn'},
      {id:'d',x:720,y:60,w:160,h:60,label:'Draw token',sub:'or argmax',cls:'ok'}
    ],
    arrows:[{from:'l',to:'t'},{from:'t',to:'s'},{from:'s',to:'f'},{from:'f',to:'d'}]
  }), 'Temperature changes shape; filters change support; the draw picks one.'),
  followups:[
    {q:'Is the top token\'s probability a confidence score you can show users?',a:'Not directly. Token probabilities are often poorly calibrated for factual correctness, and a long answer\'s correctness is not one token\'s probability. Use task-level verification or calibrated classifiers.'},
    {q:'Why do creative tasks use top-p rather than only temperature?',a:'High temperature raises the whole tail, including nonsense tokens; top-p cuts the tail adaptively while allowing variety among plausible tokens.'},
    {q:'You need reproducible outputs for an audit. What do you do?',a:'Store the exact prompt, model revision, engine version, sampling parameters and seed, plus the output itself. Bit-exact regeneration may not be possible under batching, so the stored output is the record.'}
  ],
  tradeoffs:`<ul><li><b>Low temperature</b>: consistent, but repetitive and can lock into a wrong path.</li><li><b>High temperature</b>: diverse, more errors.</li><li><b>Deterministic kernels</b>: reproducible, lower throughput.</li></ul>`,
  failures:`<ul><li><b>Invalid JSON in tool calls</b> → relying on temperature → use structured output.</li><li><b>Loops and repetition</b> → greedy on long generations → penalties, top-p.</li><li><b>Flaky evaluation scores</b> → sampling noise → fixed params, multiple runs, confidence intervals.</li></ul>`,
  vocab:[
    {term:'Logit',def:'Unnormalised score for a token before softmax.'},
    {term:'Softmax',def:'exp(zᵢ)/Σexp(zⱼ): turns scores into probabilities that sum to 1.'},
    {term:'Temperature',def:'Divisor applied to logits before softmax; controls sharpness.'},
    {term:'Top-p',def:'Nucleus sampling: sample from the smallest set of tokens whose probabilities sum to at least p.'},
    {term:'Greedy decoding',def:'Always choose the highest-probability token.'},
    {term:'Structured output',def:'Constraining decoding with a grammar or JSON schema so only valid tokens can be chosen.'}
  ],
  mistakes:[
    'Saying temperature 0 makes the model factual.',
    'Claiming T=0 is bit-for-bit deterministic in all engines.',
    'Treating token probability as calibrated confidence.',
    'Using temperature instead of structured output for JSON reliability.'
  ],
  related:['v1-generation','v1-ai-apps-tools','v2-evaluation-monitoring']
},
{
  id:'fnd-05', chapter:'v3-ch-foundations', difficulty:2,
  title:'Why do LLMs hallucinate, and how do you reduce it in a production system?',
  understand:'They test whether you can explain the cause without mysticism and propose system-level mitigations with measurement. "Lower the temperature" is the weak answer.',
  short:'A language model is trained to produce likely continuations, not verified facts. When the prompt asks for something it has no good evidence for, missing, outdated or ambiguous, the most likely continuation is still a fluent, confident answer. Training rewards plausible text, and nothing in the forward pass checks truth. So I treat it as a system problem: ground answers in retrieved, authorised sources and require citations; allow and reward "I don\'t know" or escalation; use tools for live facts like fares or booking status; validate structured outputs; and measure groundedness and correctness on an evaluation set and on sampled production traffic. Temperature changes randomness, not truthfulness.',
  detailed:`
<h3>Causes</h3>
<ul><li><b>Objective</b>: next-token prediction rewards plausibility. A confident wrong answer and a confident right answer look similar to the loss when both are fluent.</li>
<li><b>Knowledge gaps and staleness</b>: facts after the training cut-off, internal facts never seen, rare entities.</li>
<li><b>Prompt pressure</b>: questions that presuppose a false fact ("why was flight X cancelled?") pull the model to comply.</li>
<li><b>Context failures</b>: retrieval returned the wrong chunk, or the right chunk is buried in a long context and ignored.</li>
<li><b>Decoding</b>: high temperature samples low-probability continuations; but greedy can hallucinate too.</li></ul>
<h3>Mitigations, by layer</h3>
${table(['Layer','Mitigation','Evidence it works'],[
 ['Data','RAG over current, authorised documents; tools for live data','retrieval recall@k; tool success rate'],
 ['Prompt','instructions to answer only from context and to say when unsure; few-shot abstentions','abstention rate on unanswerable test items'],
 ['Output','citations checked against sources; schema validation; verifier model or rules','groundedness / faithfulness score'],
 ['Product','show sources; escalate to a human for high-stakes actions','escalation precision'],
 ['Model','fine-tune on grounded answers and refusals; choose models better at abstaining','eval deltas'],
 ['Monitoring','sample production answers for review; user feedback','weekly hallucination rate by intent']
])}
${formula(`
Measure it: hallucination rate on a labelled set
                   answers with unsupported claims
  rate      =  ─────────────────────────────────────
                      answered questions

Track separately:  abstention rate on unanswerable items (should be high)
                   abstention rate on answerable items  (should be low)
`)}
<h3>Travel example</h3>
<p>"Can I get a refund on my non-refundable fare if my flight is delayed 4 hours?" The model must answer from the fare rules and the airline policy for that booking, retrieved with the user's permissions, cite them, and hand off to an agent when the policy is ambiguous. The fare and delay status come from tools, never from model memory.</p>
<p>Interview framing: say "hallucination is a property of the system, not just the model", then name the three numbers you would track weekly: hallucination rate on answerable items, abstention rate on unanswerable items, and retrieval recall.</p>`,
  diagram:fig('Defence in depth against hallucination', svgDiagram({w:900,h:200,
    boxes:[
      {id:'q',x:20,y:70,w:120,h:60,label:'Question',cls:'v1'},
      {id:'r',x:170,y:70,w:150,h:60,label:'Ground',sub:'RAG + tools',cls:'v2'},
      {id:'g',x:350,y:70,w:150,h:60,label:'Generate',sub:'cite or abstain',cls:'hl'},
      {id:'v',x:530,y:70,w:150,h:60,label:'Verify',sub:'citations, schema',cls:'warn'},
      {id:'o',x:710,y:70,w:170,h:60,label:'Answer or escalate',cls:'ok'}
    ],
    arrows:[{from:'q',to:'r'},{from:'r',to:'g'},{from:'g',to:'v'},{from:'v',to:'o'}]
  }), 'No single layer eliminates hallucination; each one is measured.'),
  followups:[
    {q:'Does RAG eliminate hallucination?',a:'No. The model can still ignore or misread retrieved text, or retrieval can fetch the wrong document. RAG moves the problem to retrieval quality and faithfulness, which you can measure.'},
    {q:'How do you measure faithfulness at scale?',a:'An LLM-as-judge checking each claim against the retrieved context (as in RAGAS-style faithfulness), calibrated against a human-labelled subset, plus sampled human review for high-risk intents.'},
    {q:'Would a bigger model fix it?',a:'Larger models often hallucinate less on general knowledge, but still invent internal or recent facts. Grounding and verification are needed regardless; model size is one lever, measured on your eval.'}
  ],
  tradeoffs:`<ul><li><b>Strict "answer only from context"</b>: fewer hallucinations, more unhelpful refusals.</li><li><b>Verifier models</b>: better precision, more latency and cost.</li><li><b>Human escalation</b>: safest, expensive.</li></ul>`,
  failures:`<ul><li><b>Confident wrong policy answers</b> → stale index → freshness SLO and re-index on change.</li><li><b>Citations that do not support the claim</b> → no citation verification → check claims against cited chunks.</li><li><b>Too many refusals</b> → over-strict prompt → tune on answerable vs unanswerable sets.</li></ul>`,
  vocab:[
    {term:'Hallucination',def:'Fluent output that is unsupported by the sources or false.'},
    {term:'Grounding',def:'Making the model answer from supplied, authoritative context or tool results.'},
    {term:'Faithfulness',def:'Whether every claim in an answer is supported by the provided context.'},
    {term:'Abstention',def:'The model declining to answer or escalating when evidence is insufficient.'},
    {term:'Knowledge cut-off',def:'The date after which the model\'s training data contains no information.'}
  ],
  mistakes:[
    'Proposing temperature 0 as the fix.',
    'Claiming RAG solves hallucination completely.',
    'Not measuring abstention on unanswerable questions.',
    'Letting the model state live facts (prices, status) from memory instead of tools.'
  ],
  related:['v1-generation','v2-rag-production','v2-evaluation-monitoring']
},
{
  id:'fnd-06', chapter:'v3-ch-foundations', difficulty:3,
  title:'Why does long context cost so much more?',
  understand:'They want both compute and memory effects, with rough numbers: attention FLOPs grow quadratically in prefill, the KV cache grows linearly per sequence, and quality does not always improve with more context.',
  short:'Three costs grow with context. Prefill compute: the linear layers cost about two FLOPs per parameter per token, but attention compares every token with every earlier one, so that part grows with the square of the prompt length and eventually dominates. Memory: the KV cache grows linearly, 128 KiB per token for an 8B Llama, so a 128k-token conversation holds 16 GiB of KV on its own and fewer users fit on the GPU. Latency: time to first token grows with the prompt, and every decode step reads the whole cache. And quality can drop, because models do not use information in the middle of long contexts as reliably. So I treat context length as a budget, using retrieval and summarisation rather than stuffing everything in.',
  detailed:`
${formula(`
Prefill FLOPs for a prompt of n tokens (Llama-3.1-8B shape, approximate)

  linear layers  ≈ 2 × N × n                         N = 8.03 × 10⁹
  attention      ≈ 2 × L × n² × d                    L = 32, d = 4,096
                   ↑ QKᵀ and ×V, causal half included

n = 32,768 : linear ≈ 2 × 8.03e9 × 32,768  ≈ 5.3 × 10¹⁴
             attn   ≈ 2 × 32 × 32,768² × 4,096 ≈ 2.8 × 10¹⁴   (≈ 35 % of total)
n = 131,072: linear ≈ 2.1 × 10¹⁵
             attn   ≈ 4.5 × 10¹⁵                              (≈ 68 % of total)

KV memory per sequence (BF16, 128 KiB/token)
  32,768 tokens  →  4 GiB
  131,072 tokens → 16 GiB
`)}
<h3>Operational effects</h3>
<ul><li><b>Concurrency</b>: on one 80 GB GPU with ≈ 16 GB of weights, the KV pool fits only a handful of 128k-token sequences.</li>
<li><b>Head-of-line blocking</b>: one huge prefill can stall other users' decode steps unless the engine uses chunked prefill (default in vLLM V1).</li>
<li><b>Decode slows</b>: each step reads more KV; at long contexts KV reads can rival weight reads.</li>
<li><b>Cost</b>: providers bill every input token on every turn; multi-turn chat re-sends the history (prefix/prompt caching softens this).</li></ul>
<h3>Quality</h3>
<p>"Lost in the Middle" (Liu et al.) showed models use information at the start and end of long inputs better than in the middle. A 128k window is a capacity, not a guarantee of use. Evaluate at the context lengths you will actually use.</p>
<h3>Levers</h3>
<p>Retrieve less but better (reranking), summarise old turns, cap max context per tier, use prefix caching for stable prefixes, FP8 KV cache, and route very long requests to a dedicated pool.</p>
<p>Interview framing: say "context length is a budget I set per product tier", give the quadratic and linear terms, and name the lever you would pull first (retrieval quality and history summarisation) before buying memory.</p>`,
  diagram:fig('What grows with context length n', svgDiagram({w:900,h:200,
    boxes:[
      {id:'n',x:20,y:70,w:140,h:60,label:'Context n',sub:'prompt + history',cls:'v1'},
      {id:'c',x:230,y:10,w:220,h:56,label:'Prefill attention',sub:'∝ n²',cls:'bad'},
      {id:'m',x:230,y:74,w:220,h:56,label:'KV memory',sub:'∝ n per sequence',cls:'warn'},
      {id:'l',x:230,y:138,w:220,h:56,label:'TTFT, decode reads',sub:'grow with n',cls:'warn'},
      {id:'r',x:540,y:70,w:340,h:60,label:'Fewer users per GPU, higher cost',sub:'and middle-context recall drops',cls:'v2'}
    ],
    arrows:[{from:'n',to:'c'},{from:'n',to:'m'},{from:'n',to:'l'},{from:'c',to:'r'},{from:'m',to:'r'},{from:'l',to:'r'}]
  }), 'Context length is a cost and capacity policy, not just a model feature.'),
  followups:[
    {q:'Why does chunked prefill help other users?',a:'It splits a long prefill into token-budgeted chunks interleaved with decode steps, so running requests keep producing tokens instead of waiting behind one long prompt. It improves inter-token latency at a small TTFT cost for the long request.'},
    {q:'Long context vs RAG: which is cheaper?',a:'For repeated questions over a large corpus, RAG is usually far cheaper per request: a few thousand retrieved tokens instead of the whole corpus each time. Long context wins for one-off deep reading of a single document, especially with prompt caching.'},
    {q:'How would you set a max context policy?',a:'From the token-length distribution of real traffic and the KV budget: pick limits per product tier that cover p99 of legitimate use, route outliers to a long-context pool, and price them separately.'}
  ],
  tradeoffs:`<ul><li><b>Bigger window</b>: fewer retrieval misses, more cost and lower concurrency.</li><li><b>Summarisation</b>: cheaper turns, possible loss of detail.</li><li><b>FP8 KV</b>: half the KV memory, small accuracy risk to validate.</li></ul>`,
  failures:`<ul><li><b>TTFT p99 spikes</b> → a few very long prompts → chunked prefill, separate pool, limits.</li><li><b>KV usage at 100 %, rising queue</b> → long conversations → cap context, summarise.</li><li><b>Answers ignore facts in long docs</b> → middle-context loss → rerank and place key evidence near the end or start.</li></ul>`,
  vocab:[
    {term:'Context window',def:'Maximum tokens (input + output) a model can attend over.'},
    {term:'Quadratic attention',def:'Prefill attention cost grows with the square of sequence length.'},
    {term:'Chunked prefill',def:'Splitting prompt processing into chunks interleaved with decode steps.'},
    {term:'Lost in the middle',def:'Observed tendency of models to under-use information in the middle of long contexts.'},
    {term:'FP8 KV cache',def:'Storing keys and values in 8-bit floating point to halve KV memory.'}
  ],
  mistakes:[
    'Saying long context only costs memory, or only compute.',
    'Assuming a model uses all of a 128k window equally well.',
    'Ignoring that multi-turn chat re-sends history every turn.',
    'Using linear scaling for prefill time at very long contexts.'
  ],
  related:['v1-generation','v1-kv-cache','v1-batching','v2-rag-production']
},
{
  id:'fnd-07', chapter:'v3-ch-foundations', difficulty:3,
  title:'Estimate parameters, FLOPs per token and training compute from a model config.',
  understand:'A whiteboard question. They hand you (or expect you to know) a config and want a structured count of parameters, then FLOPs per token for inference and training, then a compute or time estimate with explicit assumptions.',
  short:'I count by component. Embeddings are vocabulary times hidden size, and the LM head the same again if it is not tied. Each decoder layer has attention projections: query and output are hidden by hidden, key and value are hidden by KV-heads times head dimension. Then the MLP: Llama uses SwiGLU with three matrices of hidden by intermediate size. For Llama-3.1-8B that gives about 218 million per layer, times 32 layers, plus a billion for embeddings: 8.03 billion. Inference costs about two FLOPs per parameter per token, 16 gigaflops, plus an attention term that grows with context. Training costs about six FLOPs per parameter per token, so training time is six times parameters times tokens divided by achieved FLOPs per second, with an explicit utilisation assumption.',
  detailed:`
<h3>Parameters, Llama-3.1-8B (hidden 4,096; 32 heads; 8 KV heads; head_dim 128; MLP 14,336; vocab 128,256; 32 layers)</h3>
${formula(`
STEP 1  embeddings              128,256 × 4,096            =   525,336,576
        LM head (untied)        4,096 × 128,256            =   525,336,576
STEP 2  per layer attention
        W_Q 4,096 × 4,096 = 16,777,216    W_K 4,096 × 1,024 = 4,194,304
        W_V 4,096 × 1,024 =  4,194,304    W_O 4,096 × 4,096 = 16,777,216
                                                   sum     =    41,943,040
STEP 3  per layer MLP (gate, up, down)  3 × 4,096 × 14,336 =   176,160,768
STEP 4  per layer norms                 2 × 4,096          =         8,192
        per layer total                                    =   218,112,000
STEP 5  32 layers                                          = 6,979,584,000
ANSWER  total ≈ 6,979,584,000 + 1,050,673,152 + 4,096     ≈ 8.03 × 10⁹
`)}
<p>Same method for Llama-3.1-70B (hidden 8,192; KV dim 1,024; MLP 28,672; 80 layers): per layer 150,994,944 attention + 704,643,072 MLP + norms = 855,654,400; × 80 = 68.45B; + 2.10B embeddings/LM head ≈ <b>70.55B</b>.</p>
<h3>FLOPs</h3>
${formula(`
Inference forward      ≈ 2N per token     (multiply + add per weight)
   8B → ≈ 16 GFLOP/token;  70B → ≈ 141 GFLOP/token
   + attention ≈ 4 × L × n_ctx × d per token (grows with context)

Training               ≈ 6N per token     (forward 2N, backward ≈ 4N)

Training compute, illustrative: 8B model on D = 1 × 10¹² tokens
   C = 6 × 8.03 × 10⁹ × 10¹² = 4.82 × 10²²  FLOP
   H100 dense BF16 peak 989.5 TFLOPS × MFU 40 % (assumption) = 3.96 × 10¹⁴ FLOP/s
   time = 4.82 × 10²² / 3.96 × 10¹⁴ ≈ 1.22 × 10⁸ GPU-seconds ≈ 33,800 GPU-hours
   on 512 GPUs ≈ 66 hours (before failures and restarts)
`)}
<p>Use dense peak numbers: NVIDIA's headline 1,979 TFLOPS for H100 BF16 is <i>with sparsity</i>; dense is half. State MFU as an assumption and give a range (30–50 % is a common planning band; measure yours).</p>`,
  diagram:fig('Where the parameters are (Llama-3.1-8B)', svgDiagram({w:900,h:200,
    boxes:[
      {id:'e',x:20,y:70,w:180,h:60,label:'Embed + LM head',sub:'1.05B (13 %)',cls:'v1'},
      {id:'a',x:230,y:70,w:200,h:60,label:'Attention × 32',sub:'1.34B (17 %)',cls:'v2'},
      {id:'m',x:460,y:70,w:420,h:60,label:'MLP × 32',sub:'5.64B (70 %)',cls:'hl'}
    ],
    notes:[{x:20,y:40,text:'Widths roughly proportional to parameter share. GQA makes K and V projections 4× smaller than Q.'}]
  }), 'Most parameters, and most FLOPs per token, are in the MLPs.'),
  followups:[
    {q:'Why is the backward pass about twice the forward?',a:'For each matmul, backward computes gradients with respect to both inputs (activations) and weights: two matmuls of the same size as the forward one.'},
    {q:'How do you sanity-check an MFU claim?',a:'MFU = (6 × N × tokens per second) / (GPUs × dense peak FLOPS). If someone quotes 80 % MFU with sparsity-inflated peaks, the number is wrong.'},
    {q:'How does the count change for an MoE model?',a:'Total parameters include every expert, but FLOPs per token use only active parameters (shared layers + the routed experts). Memory follows total, compute follows active.'},
    {q:'Does GQA change FLOPs much?',a:'Slightly: K and V projections shrink (4,096 × 1,024 instead of 4,096 × 4,096 in the 8B), saving about 25M params per layer. The big win is KV memory, not FLOPs.'}
  ],
  tradeoffs:`<ul><li><b>Untied vs tied embeddings</b>: untied adds vocab × hidden parameters, more flexibility.</li><li><b>Wider MLP</b>: more capacity and FLOPs per token.</li><li><b>More layers</b>: more depth, more KV per token and sequential latency.</li></ul>`,
  failures:`<ul><li><b>Planning off by 2×</b> → used sparse TFLOPS → use dense peak.</li><li><b>KV sizing off by 4–8×</b> → used attention heads → use KV heads.</li><li><b>Training schedule slips</b> → ignored restarts and checkpoints → apply a goodput factor.</li></ul>`,
  vocab:[
    {term:'SwiGLU',def:'Gated MLP with three matrices (gate, up, down) used in Llama models.'},
    {term:'Tied embeddings',def:'Sharing one matrix for input embeddings and the LM head.'},
    {term:'MFU',def:'Model FLOPs utilisation: achieved model FLOP/s divided by dense hardware peak.'},
    {term:'6N rule',def:'Training cost ≈ 6 FLOPs per parameter per token.'},
    {term:'Dense vs sparse TFLOPS',def:'Vendor peaks "with sparsity" assume 2:4 structured sparsity and are 2× the dense figure.'}
  ],
  mistakes:[
    'Using the 1,979 TFLOPS sparse figure for dense training estimates.',
    'Counting K and V projections as full hidden × hidden under GQA.',
    'Forgetting the untied LM head.',
    'Giving a training time with no utilisation assumption.'
  ],
  related:['v1-transformer','v1-gpu-architecture','v3-whiteboard','v2-capacity-planning']
},
{
  id:'fnd-08', chapter:'v3-ch-foundations', difficulty:2,
  title:'How does a transformer know word order, and how are context windows extended?',
  understand:'They test positional encoding knowledge (RoPE in modern models) and whether you understand that "128k context" comes from training and position scaling choices, with quality implications.',
  short:'Attention by itself is order-blind: it compares vectors, not positions. Modern models like Llama use rotary position embeddings, RoPE, which rotate each query and key vector by an angle that depends on its position, at many different frequencies. The dot product between a query and a key then depends on their relative distance. To extend the context window beyond what the model was pretrained on, you rescale those rotation frequencies and continue training on long sequences; Llama 3.1, for example, has a llama3-type rope scaling entry in its config, with an original 8,192-token setting and a 131,072-token maximum. The practical point: a model only works well at lengths it was trained and evaluated on, so I test quality at the context lengths we actually use.',
  detailed:`
<h3>Why position is needed</h3>
<p>Without positional information, "Riyadh to Dubai" and "Dubai to Riyadh" give the same multiset of vectors to attention. The causal mask adds some order signal, but explicit positions are needed for reliable modelling.</p>
<h3>RoPE in one formula</h3>
${formula(`
Split each q, k (head_dim = 128) into 64 pairs. Pair i at position m is rotated by angle m·θᵢ:

  θᵢ = base^(−2i / d)          base = rope_theta (500,000 in Llama 3.1)

  [x₂ᵢ' ]   [ cos mθᵢ   −sin mθᵢ ] [x₂ᵢ ]
  [x₂ᵢ₊₁']= [ sin mθᵢ    cos mθᵢ ] [x₂ᵢ₊₁]

Property:  (R_m q) · (R_n k) depends on (m − n)  →  relative position
`)}
<p>Low-index pairs rotate fast (fine, local position), high-index pairs rotate slowly (coarse, long-range position).</p>
<h3>Extending the window</h3>
<p>Llama 3.1's config (verified from a mirror of config.json): <code>max_position_embeddings 131072</code>, <code>rope_theta 500000</code>, <code>rope_scaling</code> of type <code>llama3</code> with <code>factor 8</code> and <code>original_max_position_embeddings 8192</code>. The llama3 scheme rescales frequencies by band (the slow, long-range components are stretched; the fast components are kept), and the model was trained further on long sequences. Other families use methods such as position interpolation, NTK-aware scaling or YaRN.</p>
${callout('note','Do not over-derive','The maximum context is not simply factor × original length; it is what the model was trained and evaluated for. Read the model card and test.')}
<h3>Operational consequences</h3>
<ul><li>Serving engines read rope_scaling from config; a wrong or missing value silently degrades long-context quality.</li>
<li>Setting <code>--max-model-len</code> above what the model supports may run but produce garbage at long lengths.</li>
<li>KV memory and attention cost still scale with the window; a larger window is not free.</li></ul>
<h3>What to check when onboarding a long-context model</h3><ol><li>Read <code>rope_scaling</code>, <code>rope_theta</code> and <code>max_position_embeddings</code> from config.json and confirm the engine logs the same values at startup.</li><li>Set the serving <code>--max-model-len</code> to the length you have evaluated, not the theoretical maximum.</li><li>Run a needle-retrieval and a task eval at 25 %, 50 % and 100 % of that length.</li></ol>`,
  diagram:fig('Position enters by rotating q and k', svgDiagram({w:900,h:180,
    boxes:[
      {id:'h',x:20,y:60,w:150,h:60,label:'Hidden state',sub:'position m',cls:'v1'},
      {id:'p',x:210,y:60,w:150,h:60,label:'Project q, k',cls:'v2'},
      {id:'r',x:400,y:60,w:180,h:60,label:'Rotate by m·θᵢ',sub:'RoPE',cls:'hl'},
      {id:'d',x:620,y:60,w:260,h:60,label:'q·k depends on m − n',sub:'relative distance',cls:'ok'}
    ],
    arrows:[{from:'h',to:'p'},{from:'p',to:'r'},{from:'r',to:'d'}]
  }), 'Values are not rotated; only queries and keys carry position.'),
  followups:[
    {q:'Why does RoPE give relative rather than absolute position?',a:'Rotations compose: rotating q by m and k by n and taking the dot product equals rotating by (m − n) relative to each other, so the score depends on distance.'},
    {q:'A vendor claims 1M-token context. What would you test?',a:'Needle-in-a-haystack style retrieval at several depths, multi-hop questions over long documents, and your real tasks at your real lengths; also TTFT, KV memory and cost at those lengths.'},
    {q:'Can you serve a model at a longer context than it was trained for by changing config?',a:'You can apply runtime rope scaling, but quality usually degrades without fine-tuning on long data. Treat it as an experiment requiring evaluation.'}
  ],
  tradeoffs:`<ul><li><b>Longer windows</b>: fewer truncation problems; more memory, cost and possible quality drop in the middle.</li><li><b>Scaling methods</b>: cheap extension vs needing long-context training.</li></ul>`,
  failures:`<ul><li><b>Good at 8k, nonsense at 64k</b> → rope scaling misconfigured or unsupported → check engine reads config correctly.</li><li><b>Engine refuses to start</b> → max-model-len exceeds KV memory → lower max length or add GPUs.</li></ul>`,
  vocab:[
    {term:'RoPE',def:'Rotary position embedding: rotates query/key pairs by position-dependent angles.'},
    {term:'rope_theta',def:'Base of the RoPE frequency schedule; larger values give slower rotations.'},
    {term:'Context extension',def:'Rescaling positional frequencies and training on longer sequences to raise the usable window.'},
    {term:'max_position_embeddings',def:'Configured maximum sequence length the model was set up for.'}
  ],
  mistakes:[
    'Saying transformers understand order inherently.',
    'Assuming a window is usable just because the config allows it.',
    'Multiplying factor × original length and presenting it as the guaranteed maximum.'
  ],
  related:['v1-transformer','v1-generation']
},
{
  id:'fnd-09', chapter:'v3-ch-foundations', difficulty:3,
  title:'What is a Mixture-of-Experts model and what does it change for infrastructure?',
  understand:'Architect-level. They want the split between total and active parameters, the memory versus compute consequence, and the serving implications: expert parallelism, all-to-all communication, load imbalance.',
  short:'In a Mixture-of-Experts model, the dense MLP in each layer is replaced by many expert MLPs plus a small router that sends each token to a few of them. So the model has a large total parameter count but each token only uses a fraction, its active parameters. DeepSeek-V3 has 671 billion total and 37 billion active; gpt-oss-120b has 117 billion total and 5.1 billion active. Compute per token follows active parameters, so it is cheap per token, but memory follows total parameters, because every expert must be resident somewhere. For serving that means you need lots of memory, often spread across GPUs with expert parallelism, all-to-all communication to send tokens to their experts, and attention to hot experts that unbalance load.',
  detailed:`
${formula(`
Dense:  every token uses every parameter      FLOPs/token ≈ 2 × N_total
MoE:    every token uses shared + k experts   FLOPs/token ≈ 2 × N_active
        memory needed                          ≈ N_total × bytes

DeepSeek-V3  : 671B total, 37B active (+14B MTP module on the hub = 685B files)
gpt-oss-120b : 117B total, 5.1B active; vendor states it fits one 80 GB GPU
gpt-oss-20b  :  21B total, 3.6B active
`)}
${callout('unverified','Verify before relying on this','gpt-oss fitting in 80 GB relies on its expert weights being shipped in a roughly 4-bit format; check the model card for the exact format and your engine\'s support before planning memory.')}
<h3>Serving implications</h3>
<ul><li><b>Memory-heavy, compute-light</b>: memory at 671B × 1 B (FP8) ≈ 671 GB of weights alone for DeepSeek-V3 → multi-GPU, often multi-node.</li>
<li><b>Expert parallelism (EP)</b>: place different experts on different GPUs; tokens are dispatched and combined via <b>all-to-all</b> each MoE layer. Interconnect bandwidth matters a lot.</li>
<li><b>Load imbalance</b>: popular experts become hot; routers are trained with balancing terms, but production traffic can still skew. Engines may replicate hot experts.</li>
<li><b>Batching helps more</b>: at small batch, each step touches few experts but you still pay for all-to-all; larger batches use the memory you paid for.</li>
<li><b>Decode bandwidth</b>: per token you read only active expert weights, so decode can be fast relative to model size.</li></ul>
${table(['','Dense 70B','MoE 671B / 37B active'],[
 ['Weights (FP8)','≈ 70 GB','≈ 671 GB'],
 ['FLOPs per token','≈ 141 GFLOP','≈ 74 GFLOP'],
 ['Typical layout','TP within one node','EP (+TP/DP) across many GPUs'],
 ['Key collective','all-reduce (TP)','all-to-all (EP)']
])}
<h3>Routing and capacity planning</h3><p>Because expert load depends on content, capacity planning for MoE needs traffic replay rather than averages: a burst of one kind of request (for example code or Arabic text) can concentrate tokens on a few experts. Monitor per-expert token counts if the engine exposes them, and plan headroom for skew. For fine-grained MoE models with many small experts, kernels that group tokens per expert are essential; check engine support for your exact model before committing hardware.</p>`,
  diagram:fig('MoE layer: router picks k experts per token', svgDiagram({w:900,h:240,
    boxes:[
      {id:'t',x:20,y:90,w:120,h:60,label:'Token',cls:'v1'},
      {id:'r',x:180,y:90,w:130,h:60,label:'Router',sub:'top-k scores',cls:'hl'},
      {id:'e1',x:380,y:20,w:150,h:50,label:'Expert 1',sub:'GPU 0',cls:'ok'},
      {id:'e2',x:380,y:95,w:150,h:50,label:'Expert 2',sub:'GPU 1',cls:'x'},
      {id:'e3',x:380,y:170,w:150,h:50,label:'Expert 7',sub:'GPU 3',cls:'ok'},
      {id:'c',x:620,y:90,w:250,h:60,label:'Weighted combine',sub:'all-to-all back',cls:'v2'}
    ],
    arrows:[{from:'t',to:'r'},{from:'r',to:'e1',label:'0.6'},{from:'r',to:'e3',label:'0.4'},{from:'e1',to:'c'},{from:'e3',to:'c'}]
  }), 'Only the chosen experts compute, but all experts must be in memory somewhere.'),
  followups:[
    {q:'Why might an MoE model be cheaper per token but not cheaper to host?',a:'FLOPs per token are low, but you must provision memory for all experts. At low traffic, most of that memory sits idle; MoE pays off at high, steady throughput.'},
    {q:'What goes wrong with expert parallelism on a weak network?',a:'All-to-all happens in every MoE layer on the critical path; on slow links it dominates step time and tail latency. Keep EP groups within high-bandwidth domains or use topology-aware placement.'},
    {q:'How does MoE affect fine-tuning?',a:'Full fine-tuning needs memory for all experts\' optimizer state; router stability is sensitive. LoRA on attention and shared layers is a common cheaper path; validate expert balance after tuning.'}
  ],
  tradeoffs:`<ul><li><b>MoE</b>: higher quality per FLOP, big memory footprint and communication complexity.</li><li><b>Dense</b>: simpler serving and tuning, more FLOPs per token for similar quality.</li></ul>`,
  failures:`<ul><li><b>One GPU saturated, others idle</b> → hot experts → expert replication or rebalancing.</li><li><b>High tail latency</b> → all-to-all over slow links → topology placement.</li><li><b>OOM despite low "active" size</b> → planned memory on active parameters → plan on total.</li></ul>`,
  vocab:[
    {term:'Mixture of Experts',def:'Architecture where a router sends each token to a few of many expert sub-networks.'},
    {term:'Active parameters',def:'Parameters actually used to process one token.'},
    {term:'Expert parallelism',def:'Distributing experts across GPUs and exchanging tokens with all-to-all.'},
    {term:'All-to-all',def:'Collective where every rank sends distinct data to every other rank.'},
    {term:'Load balancing loss',def:'Training term that encourages the router to use experts evenly.'}
  ],
  mistakes:[
    'Sizing memory on active parameters.',
    'Calling MoE "a model that uses less memory".',
    'Ignoring all-to-all communication.'
  ],
  related:['v2-parallelism','v2-distributed-inference','v1-gpu-memory']
},
{
  id:'fnd-10', chapter:'v3-ch-foundations', difficulty:1,
  title:'What does autograd / backward() actually do, and how is training different from inference?',
  understand:'Core understanding of the training loop: forward, loss, backward, optimizer step, and why training costs more memory and compute than inference.',
  short:'During the forward pass, PyTorch records the operations applied to tensors that require gradients, building a graph. Calling backward on the scalar loss walks that graph in reverse, applying the chain rule, and stores in each parameter\'s grad field how much a small change in that parameter would change the loss. backward does not change the weights; the optimizer step does, using those gradients, for example with Adam\'s running averages. Then gradients are zeroed for the next batch. Inference is just the forward pass without recording the graph, so no activations kept for backward, no gradients and no optimizer state. That is why training a model needs roughly 16 bytes per parameter plus activations, while serving needs about 2 plus the KV cache.',
  detailed:`
${code('python',`for batch in loader:
    optimizer.zero_grad()          # clear old gradients
    logits = model(batch.inputs)   # forward: graph recorded
    loss = loss_fn(logits, batch.targets)
    loss.backward()                # chain rule → param.grad
    optimizer.step()               # update weights from grads`)}
${formula(`
Chain rule on y = w·x, L = (y − t)²

  ∂L     ∂L   ∂y
 ──── = ──── · ──── = 2(y − t) · x
  ∂w     ∂y   ∂w

Update (SGD):  w ← w − η · ∂L/∂w
`)}
${table(['','Training','Inference'],[
 ['Graph recorded','yes','no (torch.inference_mode)'],
 ['Activations kept','for backward','discarded layer by layer'],
 ['Gradients','yes','no'],
 ['Optimizer state','yes (Adam: 2 FP32 tensors per param)','no'],
 ['Memory per param','≈ 16 B mixed precision + activations','≈ 2 B (BF16) + KV cache'],
 ['FLOPs per token','≈ 6N','≈ 2N'],
 ['Precision','BF16 compute + FP32 master','BF16, FP8 or lower']
])}
<p>The training lab <code>labs/01-pytorch-basics/tiny_mlp.py</code> runs this loop end to end on CPU; [In my lab I…] is the honest way to reference it.</p>
<h3>The four lines, in plain words</h3><p><b>Forward</b>: run inputs through the layers with current weights, producing predictions. Autograd records each operation and keeps the intermediate tensors (activations) it will need. <b>Loss</b>: one number saying how wrong the predictions are, for language models the cross-entropy of the true next token. <b>Backward</b>: walk the recorded graph from the loss to every parameter, multiplying local derivatives (chain rule), and accumulate the result into <code>param.grad</code>. <b>Step</b>: the optimizer reads the gradients and its own state and updates the weights; for Adam, it keeps running averages of the gradient and squared gradient per parameter and scales each update individually.</p><h3>Why this matters to a platform engineer</h3><p>Every memory line in a training budget maps to one of these lines: activations from forward, gradients from backward, optimizer state from step. Mixed precision, activation checkpointing, gradient accumulation and sharding are each a change to one of those lines. When a training job OOMs at step 1 rather than step 0, it is usually the optimizer state being created on the first step.</p>`,
  diagram:fig('Training loop vs inference path', svgDiagram({w:900,h:200,
    boxes:[
      {id:'f',x:20,y:70,w:150,h:60,label:'Forward',sub:'graph recorded',cls:'v1'},
      {id:'l',x:200,y:70,w:120,h:60,label:'Loss',cls:'v2'},
      {id:'b',x:350,y:70,w:150,h:60,label:'backward()',sub:'grads only',cls:'hl'},
      {id:'s',x:530,y:70,w:150,h:60,label:'optimizer.step',sub:'weights change',cls:'ok'},
      {id:'i',x:720,y:70,w:160,h:60,label:'Inference',sub:'forward only',cls:'x'}
    ],
    arrows:[{from:'f',to:'l'},{from:'l',to:'b'},{from:'b',to:'s'},{from:'s',to:'f',cls:'dash',label:'next batch',fromSide:'top',toSide:'top'}]
  }), 'Inference is the first box only, with no graph and no gradients.'),
  followups:[
    {q:'What happens if you forget zero_grad()?',a:'Gradients accumulate across batches, so updates become sums of several batches\' gradients. It is a bug unless done deliberately for gradient accumulation.'},
    {q:'Why use torch.inference_mode() in serving code?',a:'It disables graph recording and some autograd bookkeeping, saving memory and time, and guarantees no accidental gradient tracking.'},
    {q:'Why does Adam need extra memory?',a:'It keeps a running mean (m) and running mean of squares (v) of each parameter\'s gradient, usually in FP32: 8 bytes per parameter.'}
  ],
  tradeoffs:`<ul><li><b>Adam vs SGD</b>: Adam converges more robustly, costs 8 extra bytes per parameter.</li><li><b>Activation checkpointing</b>: less memory, more compute.</li></ul>`,
  failures:`<ul><li><b>Memory grows every step in serving</b> → graph recorded accidentally → inference_mode / no_grad.</li><li><b>Loss does not change</b> → optimizer not stepping or parameters frozen → check requires_grad and step calls.</li></ul>`,
  vocab:[
    {term:'Autograd',def:'PyTorch engine that records operations and computes gradients via the chain rule.'},
    {term:'Gradient',def:'Partial derivative of the loss with respect to a parameter.'},
    {term:'Optimizer step',def:'The update of parameters using gradients (SGD, Adam).'},
    {term:'Learning rate (η)',def:'Step size multiplier for updates.'},
    {term:'inference_mode',def:'PyTorch context that disables autograd tracking for faster, leaner inference.'}
  ],
  mistakes:[
    'Saying backward() updates the weights.',
    'Confusing gradients with the new parameter values.',
    'Assuming inference needs optimizer state.'
  ],
  related:['v1-neural-networks','v1-tensors-pytorch','v1-training-loop']
},
{
  id:'fnd-11', chapter:'v3-ch-foundations', difficulty:2,
  title:'What are embeddings, and how do token embeddings differ from the embeddings used in RAG?',
  understand:'They check you know the two meanings of "embedding" in LLM systems and the operational consequences of the second one (index versioning, dimension, model changes).',
  short:'An embedding is a learned vector that represents something so that similar things end up close together. Inside an LLM, the token embedding table maps each token ID to a vector, the input to the first layer; it is part of the model and trained with it. In RAG we use a separate embedding model that turns a whole sentence or document chunk into one vector, trained so that a question and the passages that answer it are close, and we store those vectors in a vector index. Operationally, the RAG embedding model is a dependency: changing it invalidates every stored vector, so the index must be versioned and re-embedded, and query and document vectors must always come from the same model version.',
  detailed:`
${table(['','Token embeddings (inside the LLM)','Text embeddings (for RAG / search)'],[
 ['Unit','one token','sentence, chunk or document'],
 ['Produced by','lookup in the LLM\'s embedding matrix','separate encoder model, pooled output'],
 ['Size (example)','128,256 × 4,096 table in Llama-3.1-8B','one vector per text, dimension set by the model'],
 ['Trained for','next-token prediction (with the LLM)','similarity / retrieval objectives (contrastive)'],
 ['Stored where','in the model weights','in a vector database with metadata and ACLs'],
 ['Change impact','new model checkpoint','re-embed the corpus, rebuild index']
])}
${formula(`
Cosine similarity between query q and chunk c
                 q · c
  cos(q, c) = ──────────
               ‖q‖ ‖c‖

Index memory (illustrative): 10,000,000 chunks × 1,024 dims × 4 B (FP32)
             = 40.96 × 10⁹ B ≈ 41 GB   (before index overhead; halve with FP16)
`)}
<h3>Operational rules</h3>
<ul><li>Pin the embedding model and version in index metadata; a mismatch silently destroys retrieval quality.</li>
<li>Re-embedding a large corpus is a batch job with real cost; plan blue/green indexes.</li>
<li>Multilingual retrieval (Arabic queries over English policies) needs a multilingual embedding model; evaluate recall per language.</li>
<li>Embedding results can be cached keyed by (model version, normalised text hash).</li></ul>
<h3>Serving the embedding model</h3><p>The embedding model is an inference service in its own right: it has its own latency budget (it sits in the TTFT path of every RAG request), its own GPU or CPU sizing, and its own batching. Short queries embed quickly; bulk re-embedding of a corpus is a throughput job best run as a batch pipeline with large batches, separate from the online path. Engines such as vLLM expose an embeddings endpoint, so one platform can serve both, but isolate them so a re-embedding job cannot starve online queries. Track embedding latency, batch size and error rate like any other dependency, and record the model version in every vector's metadata.</p>`,
  diagram:fig('Two different embeddings in one system', svgDiagram({w:900,h:210,
    zones:[{x:10,y:10,w:420,h:190,label:'Inside the LLM'},{x:460,y:10,w:430,h:190,label:'RAG retrieval',cls:'ok'}],
    boxes:[
      {id:'id',x:30,y:80,w:120,h:60,label:'Token IDs',cls:'v1'},
      {id:'te',x:180,y:80,w:220,h:60,label:'Embedding table',sub:'part of weights',cls:'hl'},
      {id:'tx',x:480,y:80,w:120,h:60,label:'Chunk text',cls:'v1'},
      {id:'em',x:620,y:50,w:250,h:50,label:'Embedding model v3',sub:'separate encoder',cls:'v2'},
      {id:'vi',x:620,y:130,w:250,h:50,label:'Vector index',sub:'version = v3',cls:'warn'}
    ],
    arrows:[{from:'id',to:'te'},{from:'tx',to:'em'},{from:'em',to:'vi'}]
  }), 'The index is only valid for the embedding model version that produced it.'),
  followups:[
    {q:'Can you use the LLM\'s own hidden states as retrieval embeddings?',a:'You can, but models trained specifically for retrieval usually perform much better per dimension and cost. Evaluate on your retrieval set before choosing.'},
    {q:'You upgrade the embedding model. Rollout plan?',a:'Build a new index in parallel (blue/green), evaluate recall@k on a labelled query set per language, shadow traffic, switch the alias, keep the old index until rollback window passes.'},
    {q:'Why normalise vectors?',a:'With unit-length vectors, cosine similarity equals the dot product, which many indexes compute faster; it also removes length effects.'}
  ],
  tradeoffs:`<ul><li><b>Higher dimension</b>: sometimes better recall, more memory and slower search.</li><li><b>Multilingual model</b>: one index for all languages, possibly lower peak quality per language.</li></ul>`,
  failures:`<ul><li><b>Retrieval quality collapses after deploy</b> → query and corpus embedded with different models → enforce version match.</li><li><b>Index memory exhausted</b> → FP32 vectors at scale → FP16/quantized vectors, sharding.</li></ul>`,
  vocab:[
    {term:'Embedding',def:'A dense vector representation in which similar items are close.'},
    {term:'Embedding table',def:'Matrix in the LLM mapping token IDs to input vectors.'},
    {term:'Cosine similarity',def:'Dot product of normalised vectors; measures direction similarity.'},
    {term:'Vector index',def:'Data structure (for example HNSW) for fast nearest-neighbour search.'},
    {term:'Re-embedding',def:'Recomputing all stored vectors after the embedding model changes.'}
  ],
  mistakes:[
    'Treating token embeddings and RAG embeddings as the same thing.',
    'Mixing embedding model versions between queries and documents.',
    'Forgetting re-embedding cost when changing models.'
  ],
  related:['v1-tokenization-embeddings','v2-rag-fundamentals','v2-rag-weight-cache']
}
]);
