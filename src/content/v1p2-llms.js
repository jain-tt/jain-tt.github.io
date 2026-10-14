/* Volume 1, Part 2 — Understanding LLMs
 * Lessons: v1-tokenization-embeddings, v1-transformer, v1-generation
 * Animations live in src/anims/v1p1-3.js
 */

/* ------------------------------------------------------------------ */
/* 1.2.1  Tokenization and embeddings                                  */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v1-tokenization-embeddings', vol:1, part:2, num:1,
  title:'Tokenization and embeddings', minutes:75,
  summary:'A language model never sees letters or words. A tokenizer first cuts the text into pieces called tokens, using merge rules learned from a large corpus, and replaces each piece with a number. The model then looks up a learned vector for each number in an embedding table; that vector is what the transformer works on. The tokenizer decides how many tokens a request costs, how much memory it uses and how much fits in the context window, and it can differ a lot between languages such as Arabic and English. Weights, tokenizer and chat template are one contract and must always be versioned together.',
  objectives:[
    'Run byte-pair encoding by hand: learn merges from a small corpus and encode a new word into token IDs.',
    'Explain why token counts differ between languages and tokenizers, and measure it rather than assume a ratio.',
    'Describe special tokens and chat templates, and diagnose failures caused by a wrong tokenizer or template.',
    'Explain an embedding table, compute its parameter count and memory, and compute cosine similarity between two vectors.',
    'Distinguish token embeddings inside an LLM from sentence embeddings used for retrieval.'
  ],
  prereqs:['v1-neural-networks','v1-tensors-pytorch'],
  next:['v1-transformer','v1-generation','v2-rag-fundamentals'],
  tags:['llm','tokenizer','embeddings','arabic'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Tokenization is like a compression dictionary: frequent fragments get their own short code, rare ones are spelled out from smaller parts. An embedding is like looking up each code in a table that returns a long list of numbers describing it. Now the real mechanism.')}
<p>A ${term('tokenizer')} converts text into a sequence of integer <b>token IDs</b> and back. A ${term('token')} is a unit from a fixed <b>vocabulary</b>: a whole common word (" the"), a word piece ("est"), punctuation, a single byte, or a special control marker. Modern LLM tokenizers are <b>subword</b> tokenizers: they sit between characters (too many tokens per text) and whole words (vocabulary too large and unable to handle new words).</p>
${table(['Model family','Tokenizer type','Vocabulary size'],[
 ['GPT-2','Byte-level BPE','50,257'],
 ['BERT (base)','WordPiece','30,522'],
 ['Llama 2','SentencePiece BPE','32,000'],
 ['Llama 3 / 3.1 / 3.2','Byte-level BPE (tiktoken-based)','128,256 (128,000 + 256 special)'],
 ['Qwen3','Byte-level BPE','config vocab_size 151,936']
])}
<p>An ${term('embedding')} is a learned vector for each token ID. The <b>embedding table</b> is a matrix of shape <code>[vocab_size, hidden_size]</code>; row <i>i</i> is the vector for token <i>i</i>. Looking up an ID is just selecting a row. For Llama-3.1-8B that table is 128,256 × 4,096.</p>

<h2>2. Why do we need it?</h2>
<p>Neural networks operate on numbers, not strings. We need (a) a reversible mapping from any text to a finite set of IDs, and (b) a way to turn each ID into something a network can compute with. Character-level vocabularies are tiny but make sequences 4–5× longer, and attention cost grows with length squared. Word-level vocabularies make sequences short but explode in size and cannot represent a new product name, a typo, or a code identifier. Subword tokenization is the compromise, and byte-level variants guarantee that <b>any</b> byte sequence — emojis, Arabic, binary-looking strings — can be encoded.</p>
<p>IDs alone carry no meaning: ID 13 is not "closer" to 14 than to 90,000. Embeddings give each token a position in a high-dimensional space that training shapes so that related tokens end up with related vectors.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 Byte-pair encoding (BPE), worked by hand</h3>
<p>${term('BPE')} training: start with single symbols, count every adjacent pair in the corpus (weighted by word frequency), merge the most frequent pair into a new symbol, record the merge rule, and repeat until the vocabulary reaches the target size.</p>
${formula(`
Corpus (word × count):  low ×5   lower ×2   newest ×6   widest ×3
Base symbols:           d e i l n o r s t w

STEP 1  count adjacent pairs
        e s : newest 6 + widest 3 = 9      s t : 9
        w e : lower 2 + newest 6  = 8      l o : 5 + 2 = 7     o w : 7
        merge #1   e + s → es

STEP 2  recount:  es t : 9               → merge #2   es + t → est
STEP 3  recount:  l o : 7                → merge #3   l + o  → lo
STEP 4  recount:  lo w : 7               → merge #4   lo + w → low

ENCODE "lowest" by replaying merges in order
        l o w e s t → l o w es t → l o w est → lo w est → low est

IDs     vocabulary order: d0 e1 i2 l3 n4 o5 r6 s7 t8 w9 es10 est11 lo12 low13
        "lowest" → [13, 11]

ANSWER  a word never seen in training costs 2 tokens instead of 6 characters
`)}
${anim('v1-tok-bpe')}
<p>Real tokenizers add two details. <b>Pre-tokenisation</b> splits text into chunks (words, numbers, punctuation, leading spaces) with a regular expression before BPE, so merges never cross those boundaries; that is why " delayed" with its leading space is usually a different token from "delayed". <b>Byte-level</b> BPE runs on UTF-8 bytes rather than characters: the 256 byte values are the base vocabulary, so nothing is ever out-of-vocabulary. WordPiece (BERT) and Unigram/SentencePiece (T5, Llama 2) are alternative algorithms with the same purpose.</p>

<h3>3.2 Why Arabic and English cost different amounts</h3>
<p>Merges are learned from the tokenizer’s training corpus. If that corpus had little Arabic, few Arabic merges exist, so Arabic words fall back to smaller pieces — in the worst case one token per UTF-8 byte, and each Arabic letter is 2 bytes in UTF-8. The same meaning can therefore cost several times more tokens in Arabic than in English with one tokenizer and nearly the same with another whose corpus and vocabulary were built for multilingual use. Diacritics (tashkeel), Arabizi (Arabic in Latin letters) and mixed Arabic–English sentences shift counts further.</p>
${callout('warn','Never assume a ratio — measure it with the tokenizer you deploy','Token counts drive four things at once: API cost (priced per token), KV-cache memory (per token), prefill latency, and how much of the context window remains. A GCC product with 50 % Arabic traffic should measure tokens per request per language on real (anonymised) samples for each candidate model before capacity planning. Published ratios for one tokenizer do not transfer to another.')}
${code('python',`from transformers import AutoTokenizer
# pin the exact revision you will deploy
tok = AutoTokenizer.from_pretrained("meta-llama/Llama-3.2-1B-Instruct", revision="<commit-sha>")
samples = {
    "en": "My flight to Riyadh was cancelled. Can I get a refund?",
    "ar": "تم إلغاء رحلتي إلى الرياض. هل يمكنني استرداد المبلغ؟",
}
for lang, text in samples.items():
    ids = tok.encode(text, add_special_tokens=False)
    print(lang, len(text.split()), "words", len(ids), "tokens",
          round(len(ids) / len(text.split()), 2), "tokens/word")`)}
<p>Run this over a few hundred real messages per language, not two sentences, and record tokens per request (p50 and p95) per language. Those numbers feed ${L('v2-capacity-planning','capacity planning')} and ${L('v2-finops-unit-economics','cost per request')}.</p>

<h3>3.2b Tokenizer quirks that cause real bugs</h3>
<ul>
<li><b>Leading spaces</b>: "Riyadh" at the start of a string and " Riyadh" after a word are different tokens. Concatenating pre-tokenised pieces gives different IDs from tokenising the joined string.</li>
<li><b>Numbers</b>: many tokenizers split digits into groups (Llama 3 splits numbers into chunks of up to three digits), so "12345" is several tokens. Arithmetic and long IDs (booking references, card numbers) cost more tokens than they look.</li>
<li><b>Case and Unicode normalisation</b>: "SAR", "sar", Arabic-Indic digits (٠١٢) and Western digits (012) are different byte sequences and therefore different tokens; normalise inputs where meaning is identical.</li>
<li><b>Whitespace and code</b>: indentation, tabs and repeated newlines may be merged or not, depending on the tokenizer; code-heavy prompts vary widely in token count between models.</li>
<li><b>Truncation</b>: cutting a prompt by characters can split a multi-byte character; always truncate by tokens.</li>
</ul>

<h3>3.3 Special tokens and chat templates</h3>
<p>Instruction-tuned models are trained on conversations serialised with <b>special tokens</b> that mark roles and turn boundaries. Llama 3 uses tokens such as <code>&lt;|begin_of_text|&gt;</code>, <code>&lt;|start_header_id|&gt;</code>, <code>&lt;|end_header_id|&gt;</code> and <code>&lt;|eot_id|&gt;</code> (end of turn). The ${term('chat template')} — a Jinja template shipped with the tokenizer — turns a list of <code>{role, content}</code> messages into that exact string.</p>
${code('text',`<|begin_of_text|><|start_header_id|>system<|end_header_id|>

You are Atlas, a travel-support assistant.<|eot_id|><|start_header_id|>user<|end_header_id|>

Can I change my booking ABC123?<|eot_id|><|start_header_id|>assistant<|end_header_id|>

`)}
<p>The model learned to answer only after that exact assistant header and to emit <code>&lt;|eot_id|&gt;</code> when done. Use a different template and the model sees text that looks like nothing it was trained on: it may ramble, continue the user’s message, or never stop. Always build prompts with <code>tokenizer.apply_chat_template(...)</code> or the engine’s chat endpoint, never by string concatenation.</p>

<h3>3.4 Embedding tables</h3>
${formula(`
token IDs  [13, 11]                         shape [T] = [2]
              │  row lookup in E (vocab × d)
              ▼
vectors    [ E[13] ; E[11] ]                shape [T, d] = [2, 4096]

Parameters and memory of the table, Llama-3.1-8B
   128,256 × 4,096         = 525,336,576 parameters
   × 2 bytes (BF16)        ≈ 1.05 GB
   Llama-3.1-8B also has a separate output LM head of the same shape
   (untied), so ≈ 1.05 B of its 8.03 B parameters are vocabulary-sized.
`)}
<p>Small models often <b>tie</b> the embedding and LM-head matrices (Llama-3.2-1B does) because at d = 2,048 a 128k vocabulary is already ≈ 263 M parameters — over a fifth of the model.</p>

<h3>3.5 What makes embeddings meaningful</h3>
<p>Nothing about embeddings is designed by hand. They start random and are updated by backpropagation like every other weight. Because tokens used in similar contexts receive similar gradient signals, related tokens drift toward similar directions. Similarity is measured with the ${term('cosine similarity')} — the cosine of the angle between two vectors.</p>
${formula(`
                    a · b
cos(a, b)  =  ─────────────────
               ‖a‖ × ‖b‖

Toy 3-dimensional example
   a = "refund"   = [0.9, 0.1, 0.3]
   b = "reimburse"= [0.8, 0.2, 0.4]
   c = "Riyadh"   = [0.1, 0.9, 0.0]

STEP 1  a·b = 0.72 + 0.02 + 0.12 = 0.86
        ‖a‖ = √(0.81 + 0.01 + 0.09) = √0.91 = 0.954
        ‖b‖ = √(0.64 + 0.04 + 0.16) = √0.84 = 0.917
        cos(a, b) = 0.86 / (0.954 × 0.917) = 0.86 / 0.875 = 0.983

STEP 2  a·c = 0.09 + 0.09 + 0 = 0.18
        ‖c‖ = √(0.01 + 0.81) = √0.82 = 0.906
        cos(a, c) = 0.18 / (0.954 × 0.906) = 0.18 / 0.864 = 0.208

ANSWER  refund ≈ reimburse (0.98); refund vs Riyadh unrelated (0.21)
`)}
${callout('note','Two different things are both called "embeddings"','<b>Token embeddings</b> (this lesson) are the first layer of an LLM: one vector per vocabulary entry, context-free, used only inside the model. <b>Sentence/document embeddings</b> come from a separate embedding model (for example the Qwen3-Embedding family) that turns a whole passage into one vector for search. RAG uses the second kind (' + L('v2-rag-fundamentals','RAG fundamentals') + '). Inside the transformer, token vectors become <i>contextual</i> after attention layers — the vector for "bank" after layer 20 depends on the sentence.')}

<h2>4. Where does it fit?</h2>
${fig('Text to vectors and back', svgDiagram({w:900,h:300,
 boxes:[
  {id:'msg',x:20,y:40,w:150,h:56,label:'Messages',sub:'role + content'},
  {id:'tpl',x:200,y:40,w:150,h:56,label:'Chat template',sub:'Jinja → string',cls:'hl'},
  {id:'tok',x:380,y:40,w:140,h:56,label:'Tokenizer',sub:'string → IDs',cls:'hl'},
  {id:'emb',x:550,y:40,w:150,h:56,label:'Embedding table',sub:'IDs → [T, d]'},
  {id:'tf',x:730,y:40,w:150,h:56,label:'Transformer',sub:'32 blocks'},
  {id:'head',x:730,y:180,w:150,h:56,label:'LM head',sub:'[d] → vocab logits'},
  {id:'samp',x:550,y:180,w:150,h:56,label:'Sampler',sub:'next token ID'},
  {id:'det',x:380,y:180,w:140,h:56,label:'Detokenizer',sub:'IDs → text'},
  {id:'out',x:200,y:180,w:150,h:56,label:'Streamed text',sub:'to client'}
 ],
 arrows:[{from:'msg',to:'tpl'},{from:'tpl',to:'tok'},{from:'tok',to:'emb'},{from:'emb',to:'tf'},{from:'tf',to:'head'},{from:'head',to:'samp'},{from:'samp',to:'det'},{from:'det',to:'out'},{from:'samp',to:'emb',cls:'dash',label:'append, repeat'}]
}), 'Tokenization and detokenization run on the CPU inside the serving engine; embeddings and everything after run on the GPU. The template, tokenizer and model weights must match.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Gateway and billing.</b> Rate limits, quotas and chargeback are all in tokens, so the gateway needs a tokenizer-consistent count or the engine’s reported usage (${L('v2-ai-gateway','AI gateway')}).</li>
<li><b>KV cache and context.</b> Every prompt token occupies KV memory (${L('v1-kv-cache','KV cache')}) and context-window space (${L('v1-generation','generation')}).</li>
<li><b>Prefix caching.</b> Cache hits require byte-identical token prefixes; a template change that alters one early token invalidates every cached prefix (${L('v2-prefix-kv-cache','prefix caching')}).</li>
<li><b>Fine-tuning.</b> Training data must be rendered with the same template that will be used at inference (${L('v1-finetuning','fine-tuning')}).</li>
<li><b>Streaming.</b> One token may be half of a multi-byte character; detokenizers buffer bytes until they form valid UTF-8 before streaming text. Arabic is a common place to see this.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li><b>Artifact integrity</b>: <code>tokenizer.json</code>, <code>tokenizer_config.json</code> (and in recent Transformers versions a separate <code>chat_template.jinja</code>), <code>special_tokens_map.json</code> and <code>generation_config.json</code> ship and version <b>with</b> the weights. Pin the Hub revision (commit SHA), not a branch.</li>
<li><b>Token telemetry</b>: input and output tokens per request, per tenant, per language — the basis of cost, capacity and abuse detection.</li>
<li><b>Limits</b>: max input tokens per request at the gateway, so one 100k-token paste cannot evict everyone’s KV cache.</li>
<li><b>Template changes as releases</b>: treat a chat-template change like a schema migration: evaluate before rollout.</li>
</ul>
${callout('devops','DevOps bridge','The tokenizer plus template is the model’s wire protocol — like a protobuf schema between services. Change it on one side only and you get no error, just wrong behaviour, exactly like a field renumbering. Where the analogy breaks: there is no compiler to catch it; only evaluation will.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Model never stops, or prints "assistant" headers in its output','Wrong chat template or missing end-of-turn/stop token','Raw prompt string; stop token IDs in generation config','Use the model’s own template; set stop tokens (e.g. <code>&lt;|eot_id|&gt;</code>)'],
 ['Garbled output after swapping a checkpoint','Weights loaded with a different tokenizer (IDs mean different tokens)','Tokenizer hash vs model card; vocab size vs embedding rows','Ship tokenizer with weights; validate vocab_size equality at load'],
 ['Arabic requests much slower and pricier','More tokens per message for this tokenizer','Tokens per request by language','Choose a model with better Arabic tokenization; budget separately'],
 ['Broken characters (�) in streamed Arabic or emoji','Streaming partial UTF-8 byte sequences','Raw token bytes','Use the engine’s incremental detokenizer; do not decode token by token yourself'],
 ['Prefix cache hit rate collapsed after a deploy','Template or system-prompt change altered early tokens','Diff of rendered prompts','Keep stable content first; version templates'],
 ['"Embedding size mismatch" when loading a fine-tune','Added special tokens without resizing embeddings, or mismatched base','Error message; vocab sizes','Resize token embeddings when adding tokens; same base revision']
])}

<h2>8. How do we scale it?</h2>
<p>Tokenization is CPU work. Fast tokenizers (Rust-based Hugging Face <code>tokenizers</code>, tiktoken) handle thousands of requests per second per core, but at very high request rates or with very long prompts the engine’s API-server process can become CPU-bound. Engines run tokenization in separate processes or threads; you scale it by giving serving pods enough CPU — GPU pods with one tiny CPU request are a common mistake. Larger vocabularies make sequences shorter (fewer tokens per request) at the cost of a bigger embedding table and LM head.</p>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Illustrative: 1,000,000 support messages per day, average 60 words each

tokenizer A: 1.3 tokens/word (EN-like)   → 78 M input tokens/day
tokenizer B: 3.0 tokens/word (poor AR)   → 180 M input tokens/day
                                            ↑ 2.3× the prefill compute,
                                              KV memory and per-token price
(ratios illustrative — measure your own)
`)}
<p>Levers: pick models whose tokenizer is efficient for your languages; keep system prompts short and stable (and cacheable); strip boilerplate (HTML, signatures, repeated quoted emails) before tokenisation; cap input length per use case.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Why does the same request cost different amounts on two models, and why might Arabic cost more?”','<p><i>Answer (≈45 s):</i> "Cost, latency and memory are all per token, and each model has its own tokenizer. BPE tokenizers learn merge rules from their training corpus, so text in languages that were under-represented gets split into smaller pieces — sometimes down to individual UTF-8 bytes, and Arabic letters are two bytes each. So the same Arabic sentence can be several times more tokens on one tokenizer than another. That increases price, KV-cache use and prefill time, and uses up context. I would measure tokens per request per language with the exact tokenizer revision we deploy, on real anonymised traffic, and use those numbers in capacity and cost planning rather than an English rule of thumb."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"A token is about four characters or three-quarters of a word."</p><p>That rule of thumb is for English on one family of tokenizers; it is wrong for Arabic and for other tokenizers.</p></div><div class="good"><h4>Strong answer</h4><p>Explains BPE merges and corpus coverage, connects tokens to cost, memory and latency, and proposes measurement.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Text','chat template','tokenizer (BPE)','token IDs','embedding rows','transformer'])}
${chain(['Tokens per request','KV memory','prefill time','price','capacity plan'])}
<p>Next: ${L('v1-transformer','the transformer')} turns these vectors into contextual representations. Later: ${L('v1-generation','generation')} turns logits back into tokens, and ${L('v2-rag-fundamentals','RAG')} uses a different kind of embedding for search.</p></div>
`,
  quiz:[
    {q:'Using the merges e+s, es+t, l+o, lo+w (in that order), how is "lowest" tokenized?',options:['l, o, w, e, s, t','low, est','lo, west','lowe, st'],answer:1,explain:'Applying merges in order gives l o w es t → l o w est → lo w est → low est. "west" and "lowe" are not in the learned vocabulary.'},
    {q:'Why is byte-level BPE never "out of vocabulary"?',options:['Its vocabulary contains every word','Its base vocabulary is all 256 byte values, so any UTF-8 text can be encoded','It ignores unknown characters','It uses a dictionary lookup'],answer:1,explain:'Any text is a sequence of bytes, and each byte is a token. Unknown words just cost more tokens.'},
    {q:'A fine-tuned model rambles and prints "assistant" mid-answer in production but behaved well in training. Most likely cause?',options:['GPU memory corruption','The serving prompt uses a different chat template from training','Too high a learning rate','Embedding table too small'],answer:1,explain:'Template mismatch produces out-of-distribution prompts and missing stop tokens. GPU corruption would look random, not structured.'},
    {q:'How many parameters is Llama-3.1-8B’s input embedding table (vocab 128,256, hidden 4,096)?',options:['≈ 52.5 M','≈ 525 M','≈ 5.25 B','≈ 131 M'],answer:1,explain:'128,256 × 4,096 = 525,336,576. The LM head is another table of the same size because they are not tied in this model.'},
    {q:'Vectors a = [1, 0] and b = [1, 1]. Cosine similarity?',options:['1.0','0.5','≈ 0.707','0'],answer:2,explain:'a·b = 1; ‖a‖ = 1; ‖b‖ = √2; 1/√2 ≈ 0.707.'},
    {q:'Which is true about token embeddings versus the embeddings in a vector database?',options:['They are the same vectors','Token embeddings are per vocabulary entry inside the LLM; vector-database embeddings come from a separate model that encodes whole passages','Vector databases store token IDs','Token embeddings are computed by the tokenizer'],answer:1,explain:'RAG uses sentence/document embedding models. The tokenizer produces IDs, not vectors.'}
  ],
  flashcards:[
    {front:'BPE training in one line',back:'Start from bytes/characters; repeatedly merge the most frequent adjacent pair into a new token; stop at the target vocabulary size. Encoding replays the merges in order.'},
    {front:'Llama 3 vocabulary size',back:'128,256 (128,000 BPE tokens + 256 special tokens). Llama 2: 32,000. GPT-2: 50,257.'},
    {front:'Why Arabic may cost more tokens',back:'Fewer Arabic merges in the tokenizer’s training corpus → smaller pieces, down to UTF-8 bytes (2 per Arabic letter). Measure per tokenizer.'},
    {front:'What a chat template is',back:'A Jinja template shipped with the tokenizer that renders role/content messages into the exact special-token format the model was trained on.'},
    {front:'Embedding table shape and cost',back:'[vocab, hidden]. Llama-3.1-8B: 128,256 × 4,096 = 525 M params ≈ 1.05 GB in BF16.'},
    {front:'Cosine similarity',back:'a·b / (‖a‖‖b‖); 1 = same direction, 0 = unrelated (orthogonal).'},
    {front:'Files that must ship with the weights',back:'config.json, tokenizer.json, tokenizer_config.json (or chat_template.jinja), special_tokens_map.json, generation_config.json — all from the same pinned revision.'}
  ]
});
registerGlossary([
  {term:'Token',def:'One unit of a model’s vocabulary (a word, sub-word, byte or special marker). Cost, context limits and KV memory are all counted in tokens.',lesson:'v1-tokenization-embeddings',aliases:['tokens','token ID']},
  {term:'Tokenizer',def:'The component that converts text to token IDs and back using a fixed vocabulary and rules (BPE, WordPiece, Unigram).',lesson:'v1-tokenization-embeddings'},
  {term:'BPE',def:'Byte-pair encoding: a sub-word tokenization algorithm that repeatedly merges the most frequent adjacent symbol pair; byte-level BPE starts from 256 byte values.',lesson:'v1-tokenization-embeddings',aliases:['byte-pair encoding']},
  {term:'Vocabulary',def:'The fixed set of tokens a tokenizer and model share; its size sets the embedding and LM-head dimensions.',lesson:'v1-tokenization-embeddings'},
  {term:'Special tokens',def:'Reserved vocabulary entries that mark structure (begin of text, role headers, end of turn) rather than content.',lesson:'v1-tokenization-embeddings'},
  {term:'Chat template',def:'A Jinja template, shipped with the tokenizer, that renders a list of role/content messages into the exact token format an instruction-tuned model was trained on.',lesson:'v1-tokenization-embeddings'},
  {term:'Embedding',def:'A learned vector representing a token (token embedding) or, from a separate model, a whole text (sentence embedding).',lesson:'v1-tokenization-embeddings',aliases:['embeddings','embedding table']},
  {term:'Cosine similarity',def:'a·b / (‖a‖‖b‖): the cosine of the angle between two vectors, used to compare embeddings.',lesson:'v1-tokenization-embeddings'},
  {term:'Tied embeddings',def:'Using the same matrix for the input embedding table and the output LM head, saving vocab × hidden parameters.',lesson:'v1-tokenization-embeddings'}
]);

/* ------------------------------------------------------------------ */
/* 1.2.2  The transformer                                              */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v1-transformer', vol:1, part:2, num:2,
  title:'The transformer: attention, multi-head attention, positions and feed-forward layers', minutes:110,
  summary:'A decoder-only transformer turns a sequence of token vectors into a prediction for the next token by passing them through a stack of identical blocks. Each block has two parts. Self-attention lets every token gather information from earlier tokens, weighting them by how well its query matches their keys. A feed-forward network then processes each token on its own and holds most of the parameters. Normalisation and residual additions keep the deep stack trainable, and rotary position embeddings tell attention how far apart tokens are. This lesson computes an attention row by hand, explains the causal mask and grouped-query attention, and counts all eight billion parameters of Llama 3.1 8B block by block.',
  objectives:[
    'Compute scaled dot-product attention for one query over four keys, including softmax, and explain the causal mask.',
    'Explain multi-head and grouped-query attention and their effect on parameters and KV-cache size.',
    'Explain RoPE, RMSNorm, residual connections and the SwiGLU feed-forward network at the level of the actual formulas.',
    'Count the parameters of Llama-3.1-8B from its config, block by block, and reach ≈ 8.03 B.',
    'Relate attention’s quadratic cost and the KV cache to prefill, decode and long-context serving.'
  ],
  prereqs:['v1-tokenization-embeddings','v1-neural-networks','v1-tensors-pytorch'],
  next:['v1-generation','v1-kv-cache','v1-inference-anatomy','v2-parallelism'],
  tags:['llm','transformer','attention','architecture'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Picture a meeting where, before each person speaks, they glance at everyone who spoke before them and decide how much each earlier remark matters to what they are about to say. Then each person thinks privately for a moment. Repeat this 32 times. Now the real mechanism.')}
<p>The ${term('transformer')} (Vaswani et al., "Attention Is All You Need", 2017) is the neural-network architecture behind every major LLM. LLMs use the <b>decoder-only</b> variant: a stack of identical <b>blocks</b>, each with</p>
<ol>
<li><b>${term('Self-attention')}</b> — mixes information <i>between</i> token positions;</li>
<li>a <b>feed-forward network</b> (FFN, also called MLP) — transforms each position <i>independently</i>;</li>
<li><b>normalisation</b> and <b>residual connections</b> around both, so dozens of blocks can be trained.</li>
</ol>
<p>Input: token embeddings <code>[T, d]</code>. Output of the last block: <code>[T, d]</code>, projected by the LM head to logits <code>[T, vocab]</code>. Position <i>t</i>’s logits predict token <i>t</i>+1.</p>
${anim('v1-tf-block')}

<h2>2. Why do we need it?</h2>
<p>Earlier sequence models (RNNs, LSTMs) read text one token at a time, carrying a single hidden state forward. That forced training to be sequential (slow on GPUs) and made it hard to use information from far back. Attention lets every position look at every earlier position <b>directly</b>, and all positions of a training sequence are computed <b>in parallel</b> as big matrix multiplications — exactly what GPUs are good at. That parallelism is why transformers could be scaled to trillions of training tokens.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 Scaled dot-product attention</h3>
<p>Each token vector <b>x</b> is projected into a query, key and value with learned matrices:</p>
${formula(`
q = x·W_Q        k = x·W_K        v = x·W_V

                         ⎛  Q · Kᵀ          ⎞
Attention(Q, K, V) = softmax ⎜ ───────  + mask ⎟ · V
                         ⎝   √dₖ            ⎠
                              ↑ dₖ = head dimension (128 in Llama-3.1-8B)
`)}
<p>Why divide by √dₖ? A dot product of two random dₖ-dimensional vectors has variance proportional to dₖ. Without scaling, scores for dₖ = 128 would be large, softmax would saturate to almost one-hot, and gradients would vanish.</p>

<h3>3.2 Worked example: one attention row, by hand</h3>
${formula(`
Sequence "The server is down", head dimension dₖ = 4, √dₖ = 2
Query of "down":  q₄ = [1, 2, 0, 1]
Keys:             k₁ (The)    = [1, 0, 0, 0]
                  k₂ (server) = [0, 2, 1, 2]
                  k₃ (is)     = [0, 1, 1, 0]
                  k₄ (down)   = [2, 1, 0, 0]

STEP 1  dot products q₄ · kᵢ
        q₄·k₁ = 1                       q₄·k₂ = 0 + 4 + 0 + 2 = 6
        q₄·k₃ = 0 + 2 + 0 + 0 = 2       q₄·k₄ = 2 + 2 + 0 + 0 = 4

STEP 2  scale by 1/√dₖ = 1/2
        s = [0.5, 3.0, 1.0, 2.0]

STEP 3  exponentiate
        e⁰·⁵ = 1.649   e³·⁰ = 20.086   e¹·⁰ = 2.718   e²·⁰ = 7.389
        sum  = 31.842

STEP 4  softmax weights
        a = [1.649, 20.086, 2.718, 7.389] / 31.842
          = [0.052, 0.631, 0.085, 0.232]          (sums to 1.000)

STEP 5  output = Σ aᵢ · vᵢ
        out₄ = 0.052·v₁ + 0.631·v₂ + 0.085·v₃ + 0.232·v₄

ANSWER  "down" draws 63 % of its new representation from "server"
`)}
<h3>3.3 The causal mask</h3>
<p>In training, all positions are processed at once, and position <i>t</i> must predict token <i>t</i>+1. If position 1 could attend to position 4, it would see the answer. The ${term('causal mask')} adds −∞ to every score where the key comes after the query, so after softmax those weights are exactly 0. The matrix of allowed attention is lower-triangular.</p>
${anim('v1-tf-attention')}
${formula(`
mask for T = 4 (0 = allowed, −∞ = blocked)      resulting weights (from the animation)
   [ 0   −∞  −∞  −∞ ]                            [1.00   0     0     0  ]
   [ 0    0  −∞  −∞ ]                            [0.31  0.69   0     0  ]
   [ 0    0   0  −∞ ]                            [0.15  0.60  0.25   0  ]
   [ 0    0   0   0 ]                            [0.05  0.63  0.09  0.23]
`)}
<h3>3.4 Multi-head and grouped-query attention</h3>
<p>One attention pattern is limiting. ${term('Multi-head attention')} splits d into h heads of size dₖ = d/h, runs attention independently in each, concatenates the results and mixes them with an output projection W_O. Different heads learn different relations (previous token, subject of the verb, matching bracket…). Llama-3.1-8B: d = 4,096, 32 heads × 128.</p>
<p>${term('GQA')} (grouped-query attention) keeps 32 query heads but only 8 key/value heads; each KV head is shared by 4 query heads. W_K and W_V shrink from 4,096 × 4,096 to 4,096 × 1,024, and — far more important for serving — the KV cache shrinks 4× (${L('v1-kv-cache','KV cache')}).</p>

<h3>3.5 Positions: RoPE</h3>
<p>Attention by itself is order-blind: shuffle the keys and the weighted sum is the same. Models must inject position. Llama, Qwen, Mistral and most current LLMs use ${term('RoPE')} (rotary position embedding, Su et al., RoFormer). RoPE treats each query and key vector as pairs of numbers and <b>rotates</b> pair <i>i</i> by an angle proportional to the token’s position <i>m</i>:</p>
${formula(`
angle for pair i at position m:      m · θᵢ        θᵢ = base^(−2i / dₖ)
                                                    base = 500,000 in Llama 3

rotation of one pair (x, y) by angle φ:
   x′ = x·cos φ − y·sin φ
   y′ = x·sin φ + y·cos φ

Key property: q rotated by m·θ, k rotated by n·θ  →  q′·k′ depends only on (m − n)

WORKED (one pair, θ = 0.5 rad per position, q = k = [1, 0])
   query at m = 3, key at n = 1:  angle difference = (3 − 1) × 0.5 = 1.0 rad
       q′·k′ = cos(1.0) = 0.540
   query at m = 10, key at n = 8: angle difference = 1.0 rad
       q′·k′ = cos(1.0) = 0.540          ← same relative distance, same score
`)}
<p>So RoPE encodes <b>relative</b> distance directly into the attention score, adds no parameters, and is applied to q and k only (never v). Low-index pairs rotate fast (fine position), high-index pairs slowly (coarse position). Context extension methods (Llama 3.1’s rope scaling, YaRN) work by rescaling these frequencies so positions beyond the training length stay in a familiar range; they change <code>config.json</code> fields such as <code>rope_theta</code> and <code>rope_scaling</code> — a reason never to edit config files casually.</p>

<h3>3.6 The feed-forward network: SwiGLU</h3>
<p>After attention mixes positions, the FFN transforms each position on its own. Llama-family models use ${term('SwiGLU')} (Shazeer, "GLU Variants Improve Transformer"):</p>
${formula(`
FFN(x) = W_down · ( SiLU(W_gate · x)  ⊙  (W_up · x) )
                     ↑ gate             ↑ elementwise product

shapes (Llama-3.1-8B): x [4096] → gate, up [14336] → down [4096]
parameters: 3 × 4,096 × 14,336 = 176,160,768 per block
`)}
<p>The FFN holds roughly 80 % of each block’s parameters. It is where much of the model’s stored "knowledge" is thought to reside, and in Mixture-of-Experts models it is the part replaced by many experts with a router (${L('v2-parallelism','MoE')}).</p>

<h3>3.7 RMSNorm and residual connections</h3>
${formula(`
RMSNorm(x) = x / RMS(x) ⊙ g          RMS(x) = √( mean(x²) + ε )

WORKED  x = [2, −2, 4, 0]
        mean(x²) = (4 + 4 + 16 + 0) / 4 = 6       RMS = √6 = 2.449
        x / RMS  = [0.816, −0.816, 1.633, 0]      then × learned gain g

Pre-norm block (Llama):
   h   = x + Attention( RMSNorm(x) )          ← residual add
   out = h + FFN( RMSNorm(h) )                ← residual add
`)}
<p>${term('RMSNorm')} keeps activations at a stable scale (it drops LayerNorm’s mean-subtraction and bias, which is cheaper). The ${term('residual connection')} means each sub-layer only adds a correction to a running "residual stream"; gradients flow straight back through the additions, which is what makes 32–126-layer stacks trainable.</p>

<h3>3.8 Counting Llama-3.1-8B’s parameters</h3>
<p>From <code>config.json</code>: hidden 4,096; 32 layers; 32 attention heads; 8 KV heads; head_dim 128; intermediate 14,336; vocab 128,256; embeddings not tied; no biases in linear layers.</p>
${formula(`
PER BLOCK
  W_Q   4,096 × 4,096            =  16,777,216
  W_K   4,096 × (8 × 128)        =   4,194,304
  W_V   4,096 × 1,024            =   4,194,304
  W_O   4,096 × 4,096            =  16,777,216
  attention subtotal             =  41,943,040

  W_gate 4,096 × 14,336          =  58,720,256
  W_up   4,096 × 14,336          =  58,720,256
  W_down 14,336 × 4,096          =  58,720,256
  FFN subtotal                   = 176,160,768

  2 RMSNorm gains 2 × 4,096      =       8,192
  block total                    = 218,112,000

STEP 2  32 blocks × 218,112,000  = 6,979,584,000

STEP 3  embedding  128,256 × 4,096 = 525,336,576
        LM head    4,096 × 128,256 = 525,336,576
        final RMSNorm              =       4,096

ANSWER  6,979,584,000 + 1,050,673,152 + 4,096 = 8,030,261,248 ≈ 8.03 B
        BF16 weights: 8.03 × 10⁹ × 2 B ≈ 16.06 GB ≈ 14.96 GiB
`)}
<h3>3.9 Compute and the quadratic term</h3>
<p>Per token, the matrix multiplications cost ≈ 2 FLOPs per parameter (≈ 16 GFLOPs for 8B). Attention adds work that grows with context: for each layer, each token’s query is dotted with every earlier key and the weights applied to every value — ≈ 4 · T · d FLOPs per token per layer. At T = 4,096 for the 8B shape that is 4 × 4,096 × 4,096 × 32 ≈ 2.1 GFLOPs per token, small next to 16 GFLOPs; at T = 128k it is ≈ 69 GFLOPs per token and dominates. In prefill, the whole T × T score matrix per head is computed: <b>quadratic</b> in prompt length. FlashAttention computes it in tiles inside on-chip memory, so the T × T matrix is never written to HBM; the FLOPs stay quadratic but memory traffic drops dramatically.</p>

<h2>4. Where does it fit?</h2>
${fig('A decoder-only LLM, end to end', svgDiagram({w:900,h:320,
 boxes:[
  {id:'ids',x:20,y:130,w:110,h:56,label:'Token IDs',sub:'[T]'},
  {id:'emb',x:160,y:130,w:120,h:56,label:'Embedding',sub:'[T, 4096]'},
  {id:'b1',x:320,y:40,w:300,h:60,label:'Block: RMSNorm → attention → +',sub:'mixes across tokens (uses KV cache)',cls:'hl'},
  {id:'b2',x:320,y:130,w:300,h:60,label:'Block: RMSNorm → SwiGLU FFN → +',sub:'per token, ≈ 80 % of params',cls:'hl'},
  {id:'rep',x:320,y:220,w:300,h:50,label:'× 32 layers',sub:'identical structure'},
  {id:'head',x:660,y:130,w:110,h:56,label:'Norm + head',sub:'[T, vocab]'},
  {id:'samp',x:800,y:130,w:80,h:56,label:'Sample',sub:'next ID'}
 ],
 arrows:[{from:'ids',to:'emb'},{from:'emb',to:'b1'},{from:'b1',to:'b2',fromSide:'bottom',toSide:'top'},{from:'b2',to:'rep',fromSide:'bottom',toSide:'top'},{from:'b2',to:'head'},{from:'head',to:'samp'}]
}), 'Only the attention half looks across tokens; that half reads and writes the KV cache during inference. Tensor parallelism splits heads and FFN columns across GPUs.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>KV cache</b>: the k and v vectors from 3.1 are what an inference engine stores per token, per layer, per KV head (${L('v1-kv-cache','KV cache')}).</li>
<li><b>Prefill vs decode</b>: prefill runs all prompt positions at once (big matmuls, compute-bound); decode runs one new position per step (memory-bandwidth-bound) (${L('v1-inference-anatomy','anatomy of inference')}).</li>
<li><b>Tensor parallelism</b>: attention heads and FFN columns are split across GPUs, with an all-reduce after each block’s attention and FFN (${L('v2-parallelism','parallelism')}).</li>
<li><b>Quantisation</b>: the linear-layer weights counted in 3.8 are what INT8/FP8/INT4 formats compress (${L('v1-quantization-speculative','quantization')}).</li>
<li><b>LoRA</b>: adapters attach to W_Q, W_K, W_V, W_O and the FFN projections (${L('v1-finetuning','fine-tuning')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li><b>Reading <code>config.json</code></b>: layers, hidden size, KV heads, head_dim, vocab, rope settings, max position embeddings. These drive weight memory, KV memory and engine compatibility.</li>
<li><b>Engine–architecture support</b>: a new architecture (new attention variant, MoE layout) needs engine support and kernels; pin engine versions known to support the model.</li>
<li><b>Context policy</b>: what max length to serve, given attention cost and KV memory, independent of what the model card allows.</li>
<li><b>GPU topology</b>: whether tensor parallelism is needed and whether the GPUs have NVLink (${L('v1-multi-gpu-profiling','multi-GPU')}).</li>
</ul>
${callout('devops','DevOps bridge','Attention is a content-addressed lookup inside the model — closer to a hash join weighted by similarity than to a network route. Where the analogy breaks: it never retrieves anything outside the current context. If a fact is not in the weights or in the prompt, attention cannot find it; that is what RAG adds.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['Engine refuses to load: unsupported architecture','Engine version lacks this model class or attention variant','Error names the architecture string from config.json','Upgrade to a version that lists the model; pin it'],
 ['Quality collapses beyond a certain prompt length','Serving beyond trained context or with wrong rope scaling','Quality vs length plot; rope fields in config','Respect max_position_embeddings; correct rope_scaling'],
 ['Prefill time grows much faster than prompt length','Quadratic attention at long context','TTFT vs prompt-length plot','Chunked prefill, shorter prompts, retrieval instead of stuffing'],
 ['OOM on long prompts but not short ones','Attention workspace or KV growth','Memory vs length','FlashAttention-enabled kernels, lower max length, more GPUs'],
 ['Outputs differ between engines for the same weights','Different kernels, precision, RoPE implementation or template','Greedy output diff on fixed prompts','Compare logits on a fixed prompt set; align template and dtype']
])}

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Bigger models</b>: more layers and wider d; parameters grow ≈ 12 · L · d² for standard blocks.</li>
<li><b>Efficient attention</b>: GQA/MQA (smaller KV), MLA (compressed latent KV), sliding-window attention, FlashAttention kernels.</li>
<li><b>Mixture-of-Experts</b>: many FFN experts, only a few active per token — more total parameters, same per-token FLOPs (${L('v2-parallelism','MoE')}).</li>
<li><b>Across GPUs</b>: tensor, pipeline and expert parallelism (${L('v2-distributed-inference','distributed inference')}).</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>Architecture choices are cost choices. A GQA model with 8 KV heads serves ≈ 4× the concurrent long contexts of an equivalent model with 32 KV heads on the same GPU. A smaller vocabulary is cheaper per position but may need more tokens per text. A dense 8B model costs ≈ 16 GFLOPs per token; a 70B model ≈ 141 GFLOPs. Pick architecture by measured quality per GPU-second on your traffic.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Explain self-attention and why long contexts are expensive.”','<p><i>Answer (≈55 s):</i> "Each token is projected into a query, a key and a value. A token’s query is dotted with the keys of all earlier tokens, scaled by the square root of the head dimension, causally masked so it cannot see the future, and softmaxed into weights; the output is the weighted sum of the values. Multi-head attention does this in parallel subspaces, and grouped-query attention shares key/value heads to shrink the KV cache. Long contexts are expensive two ways: in prefill the score computation is quadratic in prompt length, and in decode every new token must read the keys and values of every previous token from the KV cache, which grows linearly per sequence and limits how many sequences fit on a GPU. FlashAttention fixes the memory traffic of the score matrix but not the quadratic FLOPs."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Attention lets the model focus on important words."</p></div><div class="good"><h4>Strong answer</h4><p>Q·Kᵀ/√dₖ, mask, softmax, weighted V; heads and GQA; quadratic prefill and linear KV growth; what FlashAttention does and does not fix.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Embeddings','RMSNorm','attention (Q·K, mask, softmax, V)','residual','SwiGLU FFN','× L layers','logits'])}
${chain(['KV heads × head_dim × layers','KV bytes per token','concurrency per GPU','cost per token'])}
<p>Next: ${L('v1-generation','generation')} turns logits into text. Later: ${L('v1-kv-cache','KV cache')} stores the k and v vectors, and ${L('v1-gpu-memory','GPU memory')} uses the 16 GB of weights you just counted.</p></div>

<h3>Lab</h3>
<p>The planned lab <code>labs/02-tiny-transformer/tiny_gpt.py</code> implements a block from scratch. The core of causal attention in PyTorch is short:</p>
${code('python',`import math, torch
import torch.nn.functional as F

def causal_attention(q, k, v):
    # q, k, v: [batch, heads, T, head_dim]
    T, d = q.size(-2), q.size(-1)
    scores = q @ k.transpose(-2, -1) / math.sqrt(d)        # [B, H, T, T]
    mask = torch.triu(torch.ones(T, T, dtype=torch.bool, device=q.device), diagonal=1)
    scores = scores.masked_fill(mask, float("-inf"))      # block the future
    weights = F.softmax(scores, dim=-1)                   # each row sums to 1
    return weights @ v                                    # [B, H, T, head_dim]

# production code uses the fused kernel instead:
# F.scaled_dot_product_attention(q, k, v, is_causal=True)`)}
`,
  quiz:[
    {q:'Scaled scores for one query are [0.5, 3.0, 1.0, 2.0]. What weight goes to the second key?',options:['≈ 0.47','≈ 0.63','≈ 0.75','≈ 0.50'],answer:1,explain:'e³ = 20.09; sum of exps = 1.65 + 20.09 + 2.72 + 7.39 = 31.84; 20.09/31.84 ≈ 0.63. 0.47 would be 3.0 divided by the sum of raw scores, which is not softmax.'},
    {q:'What does the causal mask do?',options:['Hides padding tokens from the loss','Sets scores for future positions to −∞ so their softmax weight is 0','Removes stop words','Masks the KV cache'],answer:1,explain:'It enforces that position t only attends to positions ≤ t. Padding masks are a separate mechanism.'},
    {q:'Llama-3.1-8B has 32 query heads and 8 KV heads with head_dim 128. Shape of W_K?',options:['4,096 × 4,096','4,096 × 1,024','1,024 × 128','4,096 × 128'],answer:1,explain:'8 KV heads × 128 = 1,024 output columns. 4,096 × 4,096 is W_Q.'},
    {q:'Which property makes RoPE useful?',options:['It adds learned position vectors to v','The q·k score after rotation depends only on the relative distance m − n','It removes the need for a causal mask','It reduces the KV cache size'],answer:1,explain:'Rotations by m·θ and n·θ leave a dot product that depends on (m − n). RoPE applies to q and k only and does not change KV size.'},
    {q:'Where are most parameters in a Llama-3.1-8B block?',options:['Attention projections','RMSNorm gains','The SwiGLU FFN (≈ 176 M of ≈ 218 M)','Positional embeddings'],answer:2,explain:'FFN = 3 × 4,096 × 14,336 ≈ 176.2 M versus ≈ 41.9 M for attention. RoPE has no parameters.'},
    {q:'What does FlashAttention change?',options:['Makes attention linear in FLOPs','Avoids writing the T × T score matrix to HBM by computing it in on-chip tiles','Removes the softmax','Shrinks the KV cache'],answer:1,explain:'FLOPs remain quadratic; memory traffic and footprint drop. KV size is set by architecture and dtype.'}
  ],
  flashcards:[
    {front:'Attention formula',back:'softmax(Q·Kᵀ/√dₖ + mask)·V. Scaling keeps softmax from saturating as dₖ grows.'},
    {front:'Causal mask',back:'−∞ on scores where key position > query position; lower-triangular attention; prevents seeing future tokens.'},
    {front:'GQA in Llama-3.1-8B',back:'32 query heads share 8 KV heads (groups of 4); W_K, W_V are 4,096 × 1,024; KV cache 4× smaller than full MHA.'},
    {front:'RoPE',back:'Rotate pairs of q and k dimensions by position × θᵢ, θᵢ = base^(−2i/d); dot product depends on relative distance; no parameters.'},
    {front:'SwiGLU FFN',back:'W_down(SiLU(W_gate x) ⊙ W_up x). Llama-3.1-8B: 4,096 → 14,336 → 4,096, 176.2 M params per block.'},
    {front:'Llama-3.1-8B parameter count',back:'Block 218,112,000 × 32 = 6.98 B + embed 525.3 M + head 525.3 M + norm = 8,030,261,248.'},
    {front:'Pre-norm residual block',back:'h = x + Attn(RMSNorm(x)); out = h + FFN(RMSNorm(h)).'}
  ]
});
registerGlossary([
  {term:'Transformer',def:'Neural architecture built from attention and feed-forward blocks with residual connections; LLMs use the decoder-only, causally masked variant.',lesson:'v1-transformer'},
  {term:'Self-attention',def:'Each position computes softmax(q·kᵀ/√dₖ) weights over (earlier) positions and outputs the weighted sum of their value vectors.',lesson:'v1-transformer',aliases:['attention','scaled dot-product attention']},
  {term:'Query, key, value',def:'Three learned projections of each token vector: the query looks for information, keys are matched against it, values are what gets mixed into the output.',lesson:'v1-transformer',aliases:['Q K V']},
  {term:'Causal mask',def:'Adds −∞ to attention scores for future positions so each token attends only to itself and earlier tokens.',lesson:'v1-transformer'},
  {term:'Multi-head attention',def:'Running attention in several independent heads of size d/h in parallel, concatenating results and projecting with W_O.',lesson:'v1-transformer',aliases:['MHA']},
  {term:'RoPE',def:'Rotary position embedding: rotates pairs of query/key dimensions by angles proportional to position so attention scores depend on relative distance.',lesson:'v1-transformer',aliases:['rotary position embedding']},
  {term:'SwiGLU',def:'Gated feed-forward layer W_down(SiLU(W_gate x) ⊙ W_up x) used in Llama-family models.',lesson:'v1-transformer'},
  {term:'Feed-forward network',def:'The per-token MLP inside each transformer block; holds most of a dense model’s parameters.',lesson:'v1-transformer',aliases:['FFN','MLP block']},
  {term:'RMSNorm',def:'Normalisation dividing a vector by its root-mean-square and multiplying by a learned gain; cheaper than LayerNorm.',lesson:'v1-transformer'},
  {term:'Residual connection',def:'Adding a sub-layer’s output to its input (x + f(x)), so information and gradients flow straight through deep stacks.',lesson:'v1-transformer',aliases:['residual stream','skip connection']},
  {term:'FlashAttention',def:'An exact attention kernel that tiles the computation in on-chip memory so the T × T score matrix is never written to HBM.',lesson:'v1-transformer'},
  {term:'LM head',def:'The final linear layer mapping the hidden state to one logit per vocabulary token.',lesson:'v1-transformer',aliases:['language-model head']}
]);

/* ------------------------------------------------------------------ */
/* 1.2.3  Context windows, generation, decoding, sampling, hallucination */
/* ------------------------------------------------------------------ */
registerLesson({
  id:'v1-generation', vol:1, part:2, num:3,
  title:'Context windows, generation, decoding, sampling and hallucination', minutes:85,
  summary:'An LLM writes one token at a time. Each step it scores every token in the vocabulary, turns the scores into probabilities with softmax, and a sampler chooses one, guided by settings such as temperature, top-k and top-p. The chosen token is appended and the loop repeats until a stop token or a length limit. Everything the model can use must fit in its context window: the system prompt, history, retrieved documents and the answer itself. Because the model is trained to produce likely text rather than verified text, it can generate fluent statements that are false, which we call hallucination. This lesson works through the sampling maths and gives engineering controls for context and hallucination.',
  objectives:[
    'Trace the generation loop from logits to a streamed token, including prefill, decode and stop conditions.',
    'Compute softmax probabilities at different temperatures and apply top-k and top-p filtering by hand.',
    'Budget a context window across system prompt, history, retrieved documents and output, and explain the cost of long context.',
    'Explain why LLMs hallucinate and choose engineering mitigations (grounding, constrained output, abstention, evaluation).',
    'Explain why temperature 0 is not a guarantee of identical outputs in a batched serving system.'
  ],
  prereqs:['v1-transformer','v1-tokenization-embeddings'],
  next:['v1-inference-anatomy','v1-kv-cache','v1-ai-apps-tools','v2-rag-fundamentals'],
  tags:['llm','decoding','sampling','hallucination','context'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','Autocomplete on a phone keyboard that, instead of offering three suggestions, rolls a weighted die over every word it knows, writes the winner, and does it again. Now the real mechanism.')}
<p><b>Generation</b> (also called decoding) is the loop that turns a prompt into an answer:</p>
<ol>
<li>Run the model on the tokens so far and take the ${term('logits')} at the last position — one score per vocabulary token.</li>
<li>Apply decoding settings (temperature, top-k, top-p, penalties) and ${term('softmax')} to get probabilities.</li>
<li><b>Choose</b> one token (greedy or random sampling).</li>
<li>Append it, stream it to the client, and repeat until a <b>stop condition</b>: an end-of-turn token, a stop string, or <code>max_tokens</code>.</li>
</ol>
<p>The ${term('context window')} is the maximum number of tokens (prompt + generated output) the model can attend over in one sequence. Llama 3.1 models are specified for 128K tokens; many deployments serve less.</p>

<h2>2. Why do we need it?</h2>
<p>The model only ever predicts a probability distribution for the <i>next</i> token. Turning that into a useful answer needs a policy for choosing tokens and a loop. The policy matters: always choosing the single most likely token tends to produce repetitive, generic text in long outputs; sampling with no constraints produces nonsense from the long tail. Decoding settings are the product knobs between "precise and repeatable" (extraction, classification, tool arguments) and "varied" (drafting, brainstorming).</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 Prefill and decode</h3>
<p>The first forward pass processes the whole prompt in parallel and fills the ${L('v1-kv-cache','KV cache')}: <b>prefill</b>. Its time is most of the <b>time to first token</b> (TTFT). Each following step processes one new token, reusing cached keys and values: <b>decode</b>. Its speed is the <b>time per output token</b> (TPOT). A 3,000-token prompt with a 20-token answer is prefill-heavy; a 20-token prompt with a 2,000-token answer is decode-heavy. They stress the GPU differently (${L('v1-inference-anatomy','anatomy of inference')}).</p>

<h3>3.2 Softmax, temperature, top-k, top-p — worked</h3>
${anim('v1-gen-sampling')}
${formula(`
Prompt "The flight to Riyadh is" — five candidate tokens and their logits
   delayed 3.0    on 2.0    cancelled 1.0    boarding 0.5    purple −1.0

TEMPERATURE T rescales logits before softmax:   pᵢ = exp(zᵢ / T) / Σⱼ exp(zⱼ / T)

STEP 1  T = 1
        exp: 20.086, 7.389, 2.718, 1.649, 0.368       sum = 32.209
        p   = 0.624, 0.229, 0.084, 0.051, 0.011

STEP 2  T = 0.5   (z / T = 6, 4, 2, 1, −2)
        exp: 403.43, 54.60, 7.389, 2.718, 0.135       sum = 468.27
        p   = 0.862, 0.117, 0.016, 0.006, 0.0003       ← sharper

STEP 3  T = 2     (z / T = 1.5, 1, 0.5, 0.25, −0.5)
        exp: 4.482, 2.718, 1.649, 1.284, 0.607        sum = 10.739
        p   = 0.417, 0.253, 0.154, 0.120, 0.056        ← flatter

STEP 4  TOP-K = 2 at T = 1: keep the 2 highest, renormalise
        0.624 / 0.853 = 0.731      0.229 / 0.853 = 0.269

STEP 5  TOP-P = 0.9 at T = 1: smallest set with cumulative p ≥ 0.9
        cumulative: 0.624 → 0.853 → 0.937  (stop: ≥ 0.9)  keep 3
        renormalise by 0.937:  0.666, 0.244, 0.090

STEP 6  SAMPLE with uniform random r = 0.75 over the kept set
        delayed [0, 0.666)   on [0.666, 0.910)   cancelled [0.910, 1)
        r = 0.75 → "on"

ANSWER  T changes the shape; top-k / top-p cut the tail; the draw picks one.
        Greedy decoding (T → 0) would always output "delayed".
`)}
<p>Other common controls:</p>
${table(['Setting','What it does','Typical use'],[
 ['<code>temperature</code>','Divides logits by T before softmax. 0 is treated as greedy by most engines.','0–0.3 for extraction, tool arguments; 0.7–1.0 for drafting'],
 ['<code>top_p</code>','Nucleus sampling: keep the smallest set reaching cumulative probability p','0.9–0.95 is common'],
 ['<code>top_k</code>','Keep only the k most likely tokens','Simple tail cut; often combined with top-p'],
 ['<code>min_p</code>','Drop tokens with probability below min_p × p(top token)','Supported by several open engines'],
 ['<code>repetition_penalty</code>, <code>frequency_penalty</code>, <code>presence_penalty</code>','Lower logits of tokens already generated','Reduce loops in long outputs'],
 ['<code>max_tokens</code>','Hard cap on generated tokens','Cost and latency control; finish reason "length" when hit'],
 ['<code>stop</code>','Strings or token IDs that end generation','Structured outputs, templates'],
 ['<code>seed</code>','Seeds the sampler’s random generator','Repeatable sampling in a controlled setup'],
 ['Structured output / guided decoding','Masks tokens that would violate a JSON schema or grammar at each step','Reliable JSON for tools ('+L('v1-ai-apps-tools','tools')+')']
])}
${callout('warn','Temperature 0 is not a determinism guarantee in production','Greedy decoding removes sampling randomness, but floating-point results can depend on batch size and composition (kernels reduce in different orders when the batch changes), on GPU type, engine version and tensor-parallel layout. Two identical requests served in different batches can diverge after a near-tie. If you need reproducibility (tests, audits), pin engine version and hardware, and evaluate with tolerance; for some engines, batch-invariant kernels are an option at a throughput cost.')}

<h3>3.2b Beam search, stop conditions and streaming</h3>
<p><b>Beam search</b> keeps the <i>b</i> most probable partial sequences at each step instead of one. It suits tasks with one correct output (translation, some extraction) but tends to produce short, generic, repetitive text in open-ended chat, multiplies decode work by the beam width, and is rarely used by chat-serving engines’ default paths. Most LLM APIs expose sampling, not beams.</p>
<p><b>Stopping</b> happens on the first of: the model emits an end-of-sequence/end-of-turn token listed in <code>generation_config.json</code> (for Llama 3 instruct models, <code>&lt;|eot_id|&gt;</code> among others); the output ends with a requested stop string; or <code>max_tokens</code> is reached. Stop strings are matched on detokenised text, so the engine must hold back a few characters before streaming them in case they turn out to be the start of a stop string.</p>
<p><b>Streaming</b> sends each token’s text as soon as it is decoded (typically server-sent events with one JSON chunk per token or group of tokens). The client sees the first words after TTFT and then one chunk per TPOT; total time is roughly TTFT + (output tokens − 1) × TPOT.</p>
${formula(`
Illustrative latency of one streamed answer (measured values assumed)
   TTFT = 400 ms      TPOT = 25 ms      output = 300 tokens
   end-to-end ≈ 400 + 299 × 25 = 7,875 ms ≈ 7.9 s
   user perceives a response after 0.4 s; reading speed is slower than 40 tok/s,
   so streaming hides most of the decode time
`)}

<h3>3.3 The context window</h3>
<p>Everything the model can use for this answer must be inside the window, and the output consumes it too:</p>
${formula(`
context budget (tokens) =  system prompt
                         + tool / function definitions
                         + conversation history
                         + retrieved documents (RAG)
                         + current user message
                         + max_tokens reserved for the answer
                         ≤ served max length

WORKED  served max length 16,384
        system 800 + tools 1,200 + history 4,000 + RAG 6 × 900 = 5,400
        + user 300 + answer reserve 1,024
        = 12,724 tokens → fits, 3,660 spare

        KV memory for this request (Llama-3.1-8B shape, 128 KiB/token)
        12,724 × 128 KiB ≈ 1.55 GiB
`)}
<p>Why not simply serve the model’s maximum? (1) KV memory grows linearly with length, cutting concurrent users per GPU (${L('v1-kv-cache','KV cache')}); (2) prefill grows super-linearly with prompt length; (3) price is per token; (4) quality is not uniform: models often use information at the start and end of a long context better than the middle ("Lost in the Middle", Liu et al., 2023). More context is a cost and a quality risk, not a free upgrade.</p>
<p>When a conversation exceeds the budget, applications <b>truncate</b> (drop oldest turns), <b>summarise</b> older turns, or <b>retrieve</b> only relevant pieces. Silently truncating from the front can drop the system prompt — always protect it.</p>

<h3>3.4 Why hallucinations happen</h3>
<p>A ${term('hallucination')} is fluent output that is false or unsupported by the provided sources. It is not a bug in serving; it follows from how models are built:</p>
<ol>
<li><b>Objective</b>: pretraining maximises the likelihood of plausible continuations. Nothing in that loss distinguishes true from merely typical text.</li>
<li><b>Compressed, frozen knowledge</b>: facts are stored diffusely in weights, rare facts (a specific fare rule, a hotel’s 2026 policy) are poorly stored, and nothing after the training cut-off is known at all.</li>
<li><b>Sampling</b>: every token is a draw. Once a wrong token is emitted, later tokens are conditioned on it and the model continues consistently with its own error.</li>
<li><b>Incentives to guess</b>: if training and evaluation reward an answer over "I don’t know", models learn to guess confidently. OpenAI researchers argued this point in "Why Language Models Hallucinate" (2025).</li>
<li><b>Context failures</b>: the right document was not retrieved, was truncated, or sat in the middle of a long context.</li>
</ol>
${table(['Mitigation','How it helps','Limit'],[
 ['Grounding with retrieval (RAG) and citations','Puts the current fact in the context and makes claims checkable','Fails if retrieval misses; model can still ignore sources'],
 ['Tools for facts that systems own','Booking status from the booking API, not from the model','Needs tool calling and authorisation ('+L('v1-ai-apps-tools','tools')+')'],
 ['Instruct and train to abstain','"If the policy is not in the sources, say you don’t know and escalate"','Must be evaluated; models still over-answer'],
 ['Low temperature for factual tasks','Reduces tail sampling errors','Does not fix wrong knowledge'],
 ['Constrained / structured output','Prevents invented fields and malformed JSON','Values inside fields can still be wrong'],
 ['Evaluation and monitoring','Measures groundedness and error rates over time','Costs labelled data or LLM-judge validation ('+L('v2-evaluation-monitoring','evaluation')+')'],
 ['Human approval for actions','Stops a wrong answer becoming a wrong refund','Latency and staff cost']
])}

<h2>4. Where does it fit?</h2>
${fig('The generation loop inside a serving engine', svgDiagram({w:900,h:300,
 boxes:[
  {id:'req',x:20,y:40,w:140,h:56,label:'Request',sub:'messages + params'},
  {id:'tok',x:190,y:40,w:130,h:56,label:'Tokenize',sub:'template + IDs'},
  {id:'pre',x:350,y:40,w:150,h:56,label:'Prefill',sub:'all prompt tokens',cls:'hl'},
  {id:'dec',x:540,y:40,w:150,h:56,label:'Decode step',sub:'1 token, KV reuse',cls:'hl'},
  {id:'samp',x:720,y:40,w:160,h:56,label:'Logits → sampler',sub:'T, top-p, mask'},
  {id:'stop',x:720,y:170,w:160,h:56,label:'Stop?',sub:'EOT, stop, max_tokens'},
  {id:'stream',x:350,y:170,w:200,h:56,label:'Detokenize + stream',sub:'SSE chunks to client'},
  {id:'kv',x:540,y:170,w:120,h:56,label:'KV cache',sub:'grows +1'}
 ],
 arrows:[{from:'req',to:'tok'},{from:'tok',to:'pre'},{from:'pre',to:'dec',label:'first token'},{from:'dec',to:'samp'},{from:'samp',to:'stop',fromSide:'bottom',toSide:'top'},{from:'stop',to:'dec',label:'no: next step',cls:'dash'},{from:'samp',to:'stream',cls:'dash'},{from:'dec',to:'kv',fromSide:'bottom',toSide:'top'}]
}), 'Prefill sets TTFT; the decode loop sets TPOT. The engine batches decode steps of many requests together (continuous batching).')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Batching and scheduling</b>: each decode step is one iteration of the engine loop for every running sequence (${L('v1-batching','continuous batching')}).</li>
<li><b>Streaming APIs</b>: tokens leave as server-sent events; gateways and proxies must not buffer them (${L('v1-k8s-serving','serving')}).</li>
<li><b>Speculative decoding</b>: a draft model proposes several tokens that the main model verifies in one pass, preserving the target distribution (${L('v1-quantization-speculative','speculative decoding')}).</li>
<li><b>RAG and tools</b>: the main hallucination mitigations live outside the model (${L('v2-rag-fundamentals','RAG')}, ${L('v1-ai-apps-tools','tools')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<ul>
<li><b>Defaults and limits</b> at the gateway: max input tokens, max output tokens, allowed temperature range per use case.</li>
<li><b>Served context length</b> (<code>--max-model-len</code> in vLLM) — a capacity decision.</li>
<li><b>Telemetry</b>: input/output token histograms, finish reasons (<code>stop</code> vs <code>length</code>), TTFT, TPOT, and quality signals (thumbs, escalations, groundedness scores).</li>
<li><b>Proxy configuration</b> for streaming: disable response buffering, set idle timeouts above the longest expected generation.</li>
</ul>
${callout('devops','DevOps bridge','A streaming completion is a long-lived HTTP response, closer to a WebSocket or a large file download than to a normal API call. Load balancers with 60 s idle timeouts or buffering proxies break it. Where the analogy breaks: the server does not know the response size in advance — it depends on sampling.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Answers cut off mid-sentence','max_tokens too low','finish_reason = "length"','Raise max_tokens for that use case; ask for concise output'],
 ['Endless output or repeated phrases','Missing stop token, wrong template, low-temperature loops','Raw output; template','Correct template/stop IDs; repetition penalty'],
 ['Invalid JSON from tool calls','Unconstrained sampling','Parse failure rate','Guided decoding with a schema; low temperature'],
 ['Confident wrong policy answers','Hallucination: fact not in context','Trace shows no relevant retrieved passage','Improve retrieval; require citations; abstain'],
 ['"Context length exceeded" errors','Prompt + max_tokens over served limit','Request token counts','Trim history, summarise, cap RAG chunks'],
 ['Same request, different answers at T = 0','Batch-dependent numerics, different replicas/versions','Compare replicas and versions','Pin versions; tolerance-based tests; batch-invariant mode if needed'],
 ['Stream stalls then arrives all at once','Proxy buffering','Timing at client vs engine','Disable buffering at ingress/gateway']
])}

<h2>8. How do we scale it?</h2>
<p>Decode is sequential per request — you cannot parallelise one answer’s tokens — so throughput comes from running many requests together (batching), and per-request latency from faster decode steps (better kernels, quantisation, speculative decoding). Long contexts are scaled by limiting them, sharing prefixes (prefix caching), chunking prefill, and splitting prefill and decode onto different GPUs (${L('v2-distributed-inference','disaggregated serving')}).</p>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Illustrative request mix: 2,000 input + 300 output tokens per request

output tokens are generated one decode step each;
input tokens are processed in parallel in prefill
→ per token, output is usually several times more expensive to serve,
  which is why API price lists charge more per output token

Levers
  cap max_tokens per use case             (fewer decode steps)
  ask for concise, structured answers     (fewer output tokens)
  stable system prompt first              (prefix-cache hits on input)
  retrieve 3 good chunks, not 20          (smaller prefill, better focus)
`)}

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Why do LLMs hallucinate, and what would you do about it in a travel-support assistant?”','<p><i>Answer (≈55 s):</i> "The model is trained to produce likely continuations, not verified ones, its knowledge is a frozen compressed snapshot, and every token is sampled, so once it starts down a wrong path it stays consistent with the error. Evaluation and training that reward answering over abstaining make it guess. In a travel assistant I would not let the model be the source of truth for anything a system owns: booking status and fares come from read-only tools, policies come from retrieval with citations, and the prompt instructs it to say it does not know and escalate when sources do not cover the question. I would use low temperature for these factual flows and schema-constrained output for tool calls, require human approval for refunds or changes, and measure groundedness and escalation rates on an evaluation set and in production."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Set temperature to zero and the model won’t hallucinate."</p><p>Temperature 0 picks the most likely token, which can still be wrong; it also does not guarantee identical outputs in batched serving.</p></div><div class="good"><h4>Strong answer</h4><p>Explains the cause, moves facts to tools and retrieval, adds abstention, constraints, approvals and measurement.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Logits','temperature','top-k / top-p','sample','append','KV cache +1','repeat until stop'])}
${chain(['Context budget','KV memory','concurrency','TTFT','cost per request'])}
<p>Next: Part 3 trains and adapts these models, starting with ${L('v1-data-pipelines','datasets')}. Later: ${L('v1-inference-anatomy','inference anatomy')} measures TTFT and TPOT, and ${L('v2-rag-fundamentals','RAG')} grounds answers.</p></div>
`,
  quiz:[
    {q:'Logits [3, 2, 1, 0.5, −1]. At T = 0.5, approximately what probability does the top token get?',options:['0.62','0.86','0.42','0.97'],answer:1,explain:'Logits/T = [6, 4, 2, 1, −2]; e⁶ = 403.4 of a total 468.3 → 0.86. 0.62 is T = 1; 0.42 is T = 2.'},
    {q:'Probabilities 0.62, 0.23, 0.08, 0.05, 0.02. Which tokens survive top-p = 0.9?',options:['Only the first','First two','First three','All five'],answer:2,explain:'Cumulative 0.62 → 0.85 → 0.93; the smallest set reaching ≥ 0.9 has three tokens.'},
    {q:'Users report answers stopping mid-sentence. The API shows finish_reason "length". Cause?',options:['GPU OOM','max_tokens reached','Wrong chat template','Prefix cache miss'],answer:1,explain:'"length" means the output cap was hit. A template issue usually causes the opposite (no stop).'},
    {q:'Why might two identical requests at temperature 0 give different outputs in production?',options:['Temperature 0 is random','Batch composition, kernels, GPU type or engine version change floating-point results and can flip near-ties','The tokenizer is random','The KV cache is shared'],answer:1,explain:'Greedy removes sampling randomness, not numerical non-determinism from batched kernels and different replicas.'},
    {q:'Which is the most effective control against wrong booking-status answers?',options:['Lower temperature','A larger model','Fetch status from the booking API via a read-only tool and answer from that','Longer context window'],answer:2,explain:'Facts owned by a system should come from that system. Temperature and size reduce but do not remove fabrication.'},
    {q:'A 16k served context, system 800, tools 1,200, history 4,000, RAG 5,400, user 300 tokens. How many tokens remain for the answer?',options:['4,684','3,660','1,024','5,700'],answer:0,explain:'16,384 − (800 + 1,200 + 4,000 + 5,400 + 300) = 16,384 − 11,700 = 4,684. 3,660 is what is left after also reserving 1,024 for the answer.'}
  ],
  flashcards:[
    {front:'Generation loop',back:'Forward → logits at last position → temperature / filters → softmax → choose token → append + stream → repeat until EOT, stop string or max_tokens.'},
    {front:'Temperature',back:'pᵢ = exp(zᵢ/T)/Σexp(zⱼ/T). T < 1 sharpens, T > 1 flattens, T → 0 is greedy.'},
    {front:'Top-p (nucleus)',back:'Keep the smallest set of tokens whose cumulative probability ≥ p, renormalise, sample.'},
    {front:'Context window budget',back:'system + tools + history + retrieved docs + user + reserved output ≤ served max length.'},
    {front:'Why hallucinations happen',back:'Likelihood objective (not truth), frozen compressed knowledge, sampling that commits to errors, incentives to guess, context/retrieval failures.'},
    {front:'Is T = 0 deterministic in production?',back:'Not guaranteed: batch-dependent kernels, hardware, engine versions and TP layout change floating-point results.'},
    {front:'finish_reason values to monitor',back:'"stop" (natural end or stop string) vs "length" (hit max_tokens): a rising "length" share signals truncated answers.'}
  ]
});
registerGlossary([
  {term:'Logits',def:'Raw, unnormalised scores the model outputs for each vocabulary token (or class); softmax turns them into probabilities.',lesson:'v1-generation',aliases:['logit']},
  {term:'Softmax',def:'exp(zᵢ)/Σexp(zⱼ): converts a vector of scores into probabilities that sum to 1.',lesson:'v1-generation'},
  {term:'Temperature',def:'Sampling parameter T that divides logits before softmax: low T sharpens the distribution, high T flattens it.',lesson:'v1-generation'},
  {term:'Top-p',def:'Nucleus sampling: restrict choice to the smallest set of tokens whose cumulative probability reaches p.',lesson:'v1-generation',aliases:['nucleus sampling']},
  {term:'Top-k',def:'Restrict sampling to the k most probable tokens.',lesson:'v1-generation'},
  {term:'Greedy decoding',def:'Always choosing the highest-probability token (equivalent to temperature → 0).',lesson:'v1-generation'},
  {term:'Context window',def:'The maximum number of tokens (prompt plus generated output) a model can attend over in one sequence.',lesson:'v1-generation',aliases:['context length']},
  {term:'Hallucination',def:'Fluent model output that is false or not supported by the provided sources.',lesson:'v1-generation'},
  {term:'Prefill',def:'The first forward pass over all prompt tokens in parallel, which fills the KV cache and dominates time to first token.',lesson:'v1-generation'},
  {term:'Decode',def:'The token-by-token generation phase; each step processes one new token per sequence using the KV cache.',lesson:'v1-generation'},
  {term:'Guided decoding',def:'Masking tokens at each step so output must conform to a JSON schema, regex or grammar.',lesson:'v1-generation',aliases:['structured output','constrained decoding']}
]);
