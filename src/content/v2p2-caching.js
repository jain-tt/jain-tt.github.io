/* Volume 2, Part 2: the caching masterclass (6 lessons). Wrapped in an IIFE so helpers stay file-local. */
(function(){
'use strict';
// Ten-question table used for every caching mechanism in Part 2.
const TENQ=['1. Problem it solves','2. Where it operates','3. What exactly is stored','4. How it is reused','5. What consumes memory','6. What invalidates it','7. Latency / cost effect','8. Risks','9. How to measure it','10. Enterprise-scale behaviour'];
function tenQ(name, answers){
  return '<h4 class="tenq-title">Ten questions: '+name+'</h4>'+table(['Question','Answer for '+name], TENQ.map(function(q,i){return ['<b>'+q+'</b>', answers[i]];}));
}

/* ======================= 2.2.1 The caching map ======================= */
registerLesson({
  id:'v2-cache-map', vol:2, part:2, num:1,
  title:'The AI caching map: ten caches, ten different problems', minutes:80,
  summary:'People say "add a cache" as if there were one. An AI platform has at least ten, and they solve different problems. Response caches skip the model entirely. Prefix and prompt caches skip only the repeated part of the prompt computation. The per-request KV cache is working memory that makes generation possible at all. Offloaded and distributed KV caches stretch that memory across CPU, SSD and other machines. Retrieval and embedding caches skip search and encoding work. Weight caches make cold starts faster, and the GPU memory allocator caches memory blocks. This lesson draws the map, defines the ten questions you must answer for any cache, and shows how hit rates at different layers combine.',
  objectives:[
    'Name the ten caches of an AI platform, where each lives, and what unit of work each one avoids.',
    'Distinguish caches that skip the model, caches that skip part of the computation, and caches that are working memory.',
    'Apply the ten-question template (problem, location, stored data, reuse, memory, invalidation, effect, risk, measurement, scale) to any cache.',
    'Combine hit rates across layers correctly and estimate their effect on model calls, prefill tokens and decode tokens.',
    'Choose which caches to deploy first for a given workload using a decision tree.'
  ],
  prereqs:['v1-kv-cache','v2-platform-architecture','v2-ai-gateway'],
  next:['v2-response-semantic-cache','v2-prefix-kv-cache','v2-distributed-kv','v2-rag-weight-cache','v2-cache-ops'],
  tags:['caching','architecture','cost','latency'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A busy law office has several shortcuts. A filing cabinet of finished letters it can resend word for word. A template folder of standard opening paragraphs. A lawyer’s scratch notes for the case in front of them. A shelf of research already pulled for common questions. A warehouse of law books near the building instead of at the national library. They are all "caches", but they save different work and go stale for different reasons. Now the real mechanism.')}
<p>A cache stores the result of work so it can be reused instead of recomputed. In an AI platform the "work" happens at very different levels: a whole model call, the prefill computation for some tokens, a vector search, an embedding, a 140 GB weight download. So there are different caches, each with its own key, its own storage tier, and its own way of going wrong.</p>
${table(['#','Cache','Layer','Stored','Reuse unit','Avoids','Deep dive'],[
 ['1','Exact response cache','Gateway / app','Final answer text (+ metadata)','Whole request','The entire model call','2.2.2'],
 ['2','Semantic cache','Gateway / app','Query embedding + answer','Whole request (similar meaning)','The entire model call','2.2.2'],
 ['3','Provider prompt cache','External API','Provider-side prefix state (opaque)','Prompt prefix','Repeated prefix compute, billed at a discount','2.2.3'],
 ['4','Engine prefix cache (APC / RadixAttention)','Inference engine, GPU HBM','KV blocks of shared prefixes','16-token blocks (vLLM)','Prefill of the shared prefix','2.2.3'],
 ['5','Per-request KV cache (paged)','Inference engine, GPU HBM','K and V of every token of a live request','Each decode step','Recomputing earlier tokens every step',''+L('v1-kv-cache','Vol 1')+', 2.2.3'],
 ['6','Offloaded / distributed KV','CPU DRAM, NVMe, remote pool','Evicted or shared KV blocks','Prefix blocks across time and machines','Re-prefill after eviction or on another replica','2.2.4'],
 ['7','Retrieval result cache','Knowledge plane','Chunk ids + scores for a query','Query + index + ACL version','Search and rerank','2.2.5'],
 ['8','Embedding cache','Knowledge plane','Vectors keyed by content hash','Chunk or query text','Encoder inference','2.2.5'],
 ['9','Model-weight / artifact cache','Node disk, image layers, object storage','Weight files, tokenizer, engine artifacts','Model version','Download and load time (cold start)','2.2.5'],
 ['10','GPU memory caching allocator','Framework (PyTorch) / engine','Freed GPU memory blocks','Allocation sizes','cudaMalloc/cudaFree overhead','2.2.5']
])}
<p>One more mechanism is not a store but decides whether caches 4 and 6 hit at all: <b>cache-aware routing</b>, which sends a request to the replica that already holds its prefix (${L('v2-distributed-kv','lesson 2.2.4')}).</p>
${callout('warn','The most common confusion','The KV cache is <b>not</b> a Redis response cache. A response cache stores application-visible answers and can skip the model. A KV cache stores attention tensors inside the engine; even a full prefix hit still runs decode for every output token. Mixing these up is the first thing interviewers probe.')}

<h2>2. Why do we need it?</h2>
<p>LLM work is expensive and highly repetitive at several levels at once:</p>
<ul>
<li>Every request to one product carries the <b>same system prompt and tool schemas</b> (often 1,000–20,000 tokens). Recomputing them each time is pure waste → prefix and prompt caches.</li>
<li>Agents call the model dozens of times per task with a <b>growing, mostly identical</b> conversation → prefix caches and offload.</li>
<li>Many users ask the <b>same public questions</b> (baggage allowance, visa rules) → response and semantic caches.</li>
<li>Retrieval runs the same searches and embeds the same documents repeatedly → retrieval and embedding caches.</li>
<li>Autoscaling starts GPU pods that must load tens or hundreds of GB of weights → weight caches.</li>
</ul>
<p>Each cache attacks a different cost: GPU-seconds of prefill, GPU-seconds of decode, provider bills, vector-DB load, or cold-start minutes. You need the map to know which lever moves which cost.</p>

<h2>3. How does it work internally?</h2>
<h3>Watch one request cross the layers</h3>
${anim('v2-cache-layers')}

<h3>Three families</h3>
${table(['Family','Caches','What a "hit" means','Correctness rule'],[
 ['<b>Skip the model</b>','Exact response, semantic','No GPU work at all; answer returned','The stored answer must be valid for this user, now'],
 ['<b>Skip part of the computation</b>','Provider prompt cache, engine prefix cache, offloaded / distributed KV, retrieval, embedding','Some work is reused; the model still runs','Inputs must be identical (exact tokens, same model, same index version)'],
 ['<b>Working memory / infrastructure</b>','Per-request KV, GPU allocator, weight cache','Not about repeated requests; makes execution possible or fast','Capacity and integrity, not staleness']
])}
<p>The correctness rules differ sharply. The "skip part of the computation" caches are <b>exact</b>: a hit is mathematically the same computation, so they cannot give a wrong answer (their risks are capacity, isolation and side channels). The "skip the model" caches return an <b>old answer</b>, so they can be stale, unauthorised or simply inapplicable. That is why the skip-the-model caches need policy, while the computation caches mostly need engineering.</p>

<h3>The ten questions</h3>
<p>Every caching mechanism in this part is analysed with the same ten questions. Use them for design reviews too: a cache proposal that cannot answer all ten is not ready.</p>
${table(['#','Question','Why it matters'],[
 ['1','What problem does it solve?','Which cost or latency term it attacks; if that term is small, the cache is pointless'],
 ['2','Where does it operate?','Gateway, engine, GPU, CPU, disk, provider; sets latency and failure domain'],
 ['3','What exactly is stored?','Answers, tensors, ids, vectors, files; sets sensitivity and size'],
 ['4','How is it reused?','Exact key, similarity, prefix match; sets the hit pattern and correctness'],
 ['5','What consumes memory?','Bytes per entry × entries; must be sized'],
 ['6','What invalidates it?','TTL, version change, document change, permission change, eviction'],
 ['7','What is the latency and cost effect?','Hit benefit minus lookup cost on every miss'],
 ['8','What are the risks?','Staleness, leakage, false hits, side channels, hot spots'],
 ['9','How do we measure it?','Hit ratio (which kind), saved work, lookup latency, wrong-hit rate'],
 ['10','How does it behave at enterprise scale?','Multi-tenant isolation, multi-replica locality, multi-region consistency']
])}

<h3>Combining hit rates across layers</h3>
<p>Hit rates at different layers do not add. Each layer sees only the traffic the previous layer missed, and each saves a different kind of work.</p>
${formula(`
Illustrative traffic: 6,000 prompt tokens and 300 output tokens per request

Layer hit rates (measured separately)
  exact response cache       h₁ = 5 %   of requests
  semantic cache             h₂ = 8 %   of requests that missed exact
  engine prefix cache        p  = 35 %  of prompt tokens of requests that reach the model

STEP 1  Fraction of requests that reach the model
        (1 − h₁) × (1 − h₂) = 0.95 × 0.92 = 0.874      → 12.6 % of model calls avoided

STEP 2  Decode tokens per request (only response caches avoid decode)
        0.874 × 300 = 262 tokens                         → 12.6 % fewer decode tokens

STEP 3  Prefill tokens per request
        0.874 × 6,000 × (1 − 0.35) = 0.874 × 3,900 = 3,409 tokens
        vs 6,000 without caches                          → 43 % fewer prefill tokens

ANSWER  "5 % + 8 % + 35 % = 48 % saved" is wrong. The caches remove 12.6 % of
        decode work and 43 % of prefill work. Convert each to GPU-seconds or
        price separately (lesson 2.2.6 does this).
`)}

<h3>Caching is not free: the miss tax</h3>
<p>Every lookup costs latency on <b>every</b> request, but saves latency only on hits. A semantic cache that adds 25 ms (embed + search) to every request and saves ≈ 920 ms of TTFT on each hit breaks even on mean TTFT at a hit rate of 25 / 920 ≈ 2.7 %. But the 25 ms is added to the p95 of every miss. Below a few percent hit rate, a semantic cache usually makes the user experience worse.</p>

<h2>4. Where does it fit?</h2>
${fig('The caching map on the platform planes', svgDiagram({w:900,h:400,
 zones:[
  {x:10,y:10,w:300,h:180,label:'Gateway / application'},
  {x:320,y:10,w:570,h:180,label:'Model-serving plane'},
  {x:10,y:200,w:440,h:190,label:'Knowledge plane'},
  {x:460,y:200,w:430,h:190,label:'Node / cluster infrastructure'}
 ],
 boxes:[
  {id:'c1',x:30,y:40,w:260,h:40,label:'1 Exact response cache',cls:'hl'},
  {id:'c2',x:30,y:90,w:260,h:40,label:'2 Semantic cache',cls:'hl'},
  {id:'c3',x:30,y:140,w:260,h:40,label:'3 Provider prompt cache (remote)'},
  {id:'c4',x:340,y:40,w:260,h:40,label:'4 Engine prefix cache',cls:'v2'},
  {id:'c5',x:340,y:90,w:260,h:40,label:'5 Per-request paged KV',cls:'v2'},
  {id:'c6',x:620,y:40,w:250,h:90,label:'6 Offloaded / distributed KV',sub:'CPU · NVMe · remote pool',cls:'v2'},
  {id:'rt',x:340,y:140,w:530,h:40,label:'Cache-aware router (decides where 4 and 6 hit)',cls:'warn'},
  {id:'c7',x:30,y:230,w:400,h:44,label:'7 Retrieval result cache'},
  {id:'c8',x:30,y:290,w:400,h:44,label:'8 Embedding cache'},
  {id:'c9',x:480,y:230,w:390,h:44,label:'9 Model-weight / artifact cache'},
  {id:'c10',x:480,y:290,w:390,h:44,label:'10 GPU memory caching allocator'}
 ],
 arrows:[{from:'c4',to:'c6',label:'evict / load'},{from:'c5',to:'c4',fromSide:'top',toSide:'bottom'}]
}), 'Blue boxes skip the model entirely. Purple boxes reuse attention state. The router (amber) is not a cache but decides whether prefix state is found. Bottom-right caches make execution fast rather than avoiding repeated requests.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Response and semantic caches</b> depend on the gateway’s identity and tenant data (keys must include them) and on document versions from the knowledge plane (for invalidation).</li>
<li><b>Prefix caches</b> depend on <b>prompt layout</b> owned by application teams: stable content first. A product team adding a timestamp to the top of the system prompt can silently destroy the platform’s hit rate.</li>
<li><b>Prefix caches and offload</b> depend on the <b>router</b>: a hit only happens on the replica holding the blocks.</li>
<li><b>KV capacity</b> (cache 5) competes with cached prefix blocks (cache 4) for the same HBM; offload (6) relieves both.</li>
<li><b>Retrieval and embedding caches</b> depend on ingestion events (change data capture) for invalidation.</li>
<li><b>Weight caches</b> connect to autoscaling: cold-start time sets how early you must scale (${L('v1-k8s-autoscaling','GPU autoscaling')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
<p>Keep a <b>cache inventory</b>, one row per cache, owned like any other production dependency:</p>
${table(['Field','Example (retrieval cache)'],[
 ['Key','sha256(normalised query, index_version, acl_group_hash, top_k, reranker_version)'],
 ['Value','ordered chunk ids + scores (not chunk text)'],
 ['Scope','per tenant; shared across users with the same ACL-group hash'],
 ['Owner','data / search team'],
 ['Storage tier and size','Redis cluster, 6 GB budget, LRU'],
 ['TTL','1 h, plus event-driven purge'],
 ['Invalidation events','document update/delete, index rebuild, ACL change'],
 ['Bypass switch','feature flag per tenant and globally'],
 ['Metrics','hit ratio, lookup p99, purge lag p99, stale-hit audit rate'],
 ['Data classification','internal; contains no document text']
])}
${callout('devops','DevOps bridge','You already run CDN caches, Redis and HTTP caching headers. The new parts: (1) some keys must include identity and permission versions, which CDNs rarely do; (2) some caches live inside GPU memory, invisible to Kubernetes, and are sized by engine flags; (3) "hit" can mean a fraction of tokens, not a whole object.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Which cache','Evidence','Fix'],[
 ['Users get another tenant’s answer','Response / semantic','Key lacks tenant or ACL version','Disable cache, purge, fix key, incident process (2.2.6)'],
 ['Answer still shows old policy after update','Response / semantic / retrieval','Entry tags show old doc version','Event-driven purge by tag; versioned keys'],
 ['TTFT jumped after a prompt change','Prefix / provider prompt cache','prefix hit ratio fell; cached_tokens fell','Move volatile content to the end of the prompt'],
 ['Hit ratio fine, but TTFT p95 worse','Semantic (miss tax) or offload (slow tier)','Lookup latency histograms','Remove low-value layer or set tier thresholds'],
 ['Pods take 10 min to become ready','Weight cache cold','Image pull / download time in events','Node-local cache, pre-pull, image volumes'],
 ['nvidia-smi shows 92 % memory used at idle','Not a leak: engine pre-allocation','vLLM reserves --gpu-memory-utilization (default 0.92)','Expected; monitor KV usage instead']
])}

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Response caches</b> scale like any key-value store (shard by key), but semantic caches scale like vector databases (index memory, ANN recall).</li>
<li><b>Prefix caches</b> scale with HBM per replica, then with offload tiers, then with cache-aware routing so replicas specialise on prefixes instead of all holding the same ones.</li>
<li><b>Knowledge caches</b> scale with tenants × ACL groups: keys that include ACL hashes fragment the cache as permission diversity grows.</li>
<li><b>Weight caches</b> scale with node count and model count: pre-stage popular models on nodes; avoid every pod pulling from object storage at once.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>Rank caches by <b>avoided cost per unit of risk and effort</b>. For most chat and agent platforms the order is:</p>
<ol>
<li><b>Prefix caching</b> (engine and provider): exact, safe with tenant salts, often free to enable, large effect on prompt-heavy and agent workloads.</li>
<li><b>Embedding cache</b>: exact, cheap, avoids re-embedding unchanged content.</li>
<li><b>Weight cache</b>: shortens cold starts, so you can keep fewer idle GPUs warm.</li>
<li><b>Retrieval cache</b>: helpful with skewed query distributions; needs ACL-aware keys.</li>
<li><b>Exact response cache</b>: only for public, non-personal, deterministic-enough answers.</li>
<li><b>Semantic cache</b>: last, only for narrow, evaluated intents, because its failure mode is a confident wrong answer.</li>
</ol>
<div class="dtree"><ul><li><span class="q">Which cache should I add first?</span><ul>
<li><span class="a">prompts share long prefixes?</span>Yes → engine prefix cache + provider prompt caching; fix prompt layout.</li>
<li><span class="a">same public questions repeat verbatim?</span>Yes → exact response cache with tenant- and version-aware keys.</li>
<li><span class="a">paraphrases of a small set of public intents?</span>Yes → semantic cache, only after a labelled false-hit evaluation.</li>
<li><span class="a">documents re-embedded on every ingest?</span>Yes → embedding cache keyed by content hash + model version.</li>
<li><span class="a">cold starts block autoscaling?</span>Yes → weight cache on node NVMe or image volumes.</li>
<li><span class="a">KV evictions then re-prefill of long prefixes?</span>Yes → CPU/SSD offload and cache-aware routing.</li>
</ul></li></ul></div>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“What caches would you use in an LLM platform?”','<p><i>Answer (≈55 s):</i> "I separate them by what they skip. Response and semantic caches skip the model entirely, so they need keys with tenant, permission and document versions, and semantic caching needs a false-hit evaluation before launch. Prefix caching in the engine and provider prompt caching skip only the repeated prompt prefill; they are exact, so the risks are capacity, isolation and timing side channels, and the lever is prompt layout and cache-aware routing. The per-request KV cache is working memory, and I extend it with CPU or SSD offload when long prefixes get evicted and recomputed. In the knowledge plane I cache embeddings by content hash and retrieval results by query, index version and ACL group. And I cache model weights near the GPUs to cut cold starts. I measure each with its own hit definition — requests for response caches, tokens for prefix caches."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"We put Redis in front of the model to cache responses and use the KV cache."</p><p>One cache, wrong mental model of the KV cache, no correctness or isolation story.</p></div><div class="good"><h4>Strong answer</h4><p>Groups caches by what they skip, gives the correctness rule for each family, and says how each is keyed, invalidated and measured.</p></div></div>
${callout('note','What changed from the older course','The previous edition listed seven caches. This edition adds provider prompt caching (with real prices), separates offloaded/distributed KV from the engine prefix cache, adds the GPU memory caching allocator, and treats cache-aware routing as the mechanism that decides prefix hits. It also replaces "hit rate" with explicit hit definitions per layer.')}

<div class="connections"><h4>How this connects</h4>
${chain(['Request','exact','semantic','retrieval','prefix KV','decode','write-back'])}
${chain(['Prompt layout','prefix hit ratio','prefill tokens avoided','TTFT and GPU cost'])}
<p>Next: ${L('v2-response-semantic-cache','exact and semantic caching')}, then ${L('v2-prefix-kv-cache','prefix and prompt caching')}.</p></div>
`,
  quiz:[
    {q:'Which cache can return a wrong answer even though it works exactly as designed?',options:['Engine prefix cache','Embedding cache keyed by content hash','Semantic cache','GPU caching allocator'],answer:2,explain:'A semantic cache returns a stored answer for a similar, not identical, question. Prefix and embedding caches are exact: a hit reproduces the same computation.'},
    {q:'Exact cache hit rate is 5 % of requests and semantic 8 % of the remaining. What fraction of model calls is avoided?',options:['13 %','12.6 %','8 %','40 %'],answer:1,explain:'1 − 0.95 × 0.92 = 0.126. Hit rates at successive layers multiply on the miss path; they do not add.'},
    {q:'A prefix-cache hit on 2,000 of 6,000 prompt tokens avoids…',options:['The whole model call','Prefill for 2,000 tokens; decode still runs for every output token','Decode for 2,000 tokens','Nothing; prefix caching only saves memory'],answer:1,explain:'Prefix caching reuses KV for the shared prefix, removing that part of prefill. All output tokens are still decoded.'},
    {q:'nvidia-smi shows 92 % memory used on an idle vLLM pod. The most likely explanation is…',options:['A memory leak','vLLM pre-allocates a fraction of GPU memory (default 0.92) for weights and KV blocks','Prefix cache poisoning','The semantic cache is on the GPU'],answer:1,explain:'Engines reserve memory up front and manage it internally. Watch vllm:kv_cache_usage_perc instead.'},
    {q:'Which statement about a semantic cache with a 2 % hit rate and 25 ms lookup is most accurate?',options:['It always helps because hits are fast','It probably worsens p95 latency for the 98 % of requests that miss while saving little','It has no latency effect','It reduces decode cost by 25 %'],answer:1,explain:'The lookup is a tax on every request; at low hit rates the tax on misses dominates.'}
  ],
  flashcards:[
    {front:'Ten caches of an AI platform',back:'Exact response, semantic, provider prompt, engine prefix, per-request paged KV, offloaded/distributed KV, retrieval result, embedding, model-weight, GPU caching allocator. Plus cache-aware routing as the mechanism.'},
    {front:'Three cache families',back:'Skip the model (response, semantic); skip part of the computation (prompt, prefix, offload, retrieval, embedding); working memory / infrastructure (per-request KV, allocator, weights).'},
    {front:'Why do exact computation caches not return wrong answers?',back:'A hit requires identical inputs (tokens, model, index version), so reuse is the same computation. Their risks are capacity, isolation and side channels.'},
    {front:'Combining hit rates',back:'Successive layers multiply on the miss path: P(model call) = Π(1 − hᵢ). Response caches cut decode and prefill; prefix caches cut only prefill.'},
    {front:'Miss tax',back:'Lookup latency paid on every request. Break-even hit rate ≈ lookup cost ÷ latency saved per hit (for the mean); p95 of misses always gets worse.'},
    {front:'The ten questions',back:'Problem, location, stored data, reuse, memory, invalidation, latency/cost effect, risks, measurement, enterprise scale.'}
  ]
});
registerGlossary([
  {term:'Cache inventory',def:'A table listing every cache in a platform with its key, value, scope, owner, tier, size, TTL, invalidation events, bypass switch and metrics.',lesson:'v2-cache-map'},
  {term:'Miss tax',def:'The lookup latency and cost a cache adds to every request, including those that miss.',lesson:'v2-cache-map'},
  {term:'Hit ratio',def:'Fraction of lookups served from cache. Must state its unit: requests (response caches), tokens (prefix caches) or bytes.',lesson:'v2-cache-map',aliases:['hit rate']}
]);

/* ======================= 2.2.2 Exact response and semantic caching ======================= */
registerLesson({
  id:'v2-response-semantic-cache', vol:2, part:2, num:2,
  title:'Exact response caching and semantic caching', minutes:85,
  summary:'Response caches skip the model completely by returning an answer that was produced before. An exact cache does this only when the request is identical after normalisation, and only when the key also captures everything that changes the correct answer: tenant, permissions, model, prompt version, parameters and source documents. A semantic cache goes further and reuses an answer for a question with similar meaning, found by vector search. That can save money, but similarity is not sameness and it is never permission. This lesson builds both caches, sizes their memory, shows a false hit happening, and gives a way to pick a threshold from the cost of a wrong answer.',
  objectives:[
    'Answer the ten caching questions for exact response caching and for semantic caching.',
    'Design a normalised, versioned, tenant-scoped response cache key and decide what not to cache.',
    'Explain why a semantic cache produces false hits and apply slot checks, scoped indexes and verification to prevent them.',
    'Choose a semantic similarity threshold from a labelled evaluation and the cost of a false hit.',
    'Size the memory of a semantic cache index and of an exact response cache.'
  ],
  prereqs:['v2-cache-map','v2-ai-gateway','v1-tokenization-embeddings'],
  next:['v2-prefix-kv-cache','v2-cache-ops','v2-rag-fundamentals'],
  tags:['caching','semantic-cache','redis','security'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A help desk keeps a binder of answers. The <i>exact</i> rule: reuse an answer only if the question is word-for-word the same and the person is allowed to see it. The <i>semantic</i> rule: reuse an answer if the question means roughly the same thing. The second rule helps more people and occasionally hands a hotel guest the airline policy. Now the real mechanism.')}
<p>An ${term('exact response cache')} maps a key derived from the full request to the final response. A ${term('semantic cache')} stores an embedding of each cached question and, for a new question, searches for the nearest stored question; if similarity passes a threshold and checks pass, it returns that stored answer. Both live in front of the model, usually in the gateway or the application backend.</p>

<h2>2. Why do we need it?</h2>
<p>A cache hit on a response costs about a millisecond (exact) or tens of milliseconds (semantic) and zero GPU or provider tokens. A model call costs hundreds of milliseconds to seconds and real money. For high-volume public questions — opening hours, baggage rules, visa requirements, product FAQs — the same answers are generated thousands of times a day. In GCC travel, demand spikes before Ramadan, Eid and school holidays, and the question mix narrows at the same moment, which is exactly when a response cache relieves GPU capacity.</p>
<p>But most LLM traffic is <b>not</b> repeatable: conversations carry history, users include personal details, and agents call tools. Response caching helps a narrow slice, and it is the riskiest cache family. Treat it as a scalpel.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 Exact response cache</h3>
<p>The steps on every request:</p>
<ol>
<li><b>Eligibility</b>: policy decides whether this request class may be cached at all (public FAQ intent, no personal data detected, temperature within policy, no tool calls).</li>
<li><b>Canonicalise</b>: Unicode-normalise (NFKC), trim, collapse whitespace, optionally lower-case. Never apply normalisation that changes meaning (do not drop numbers or negations). For Arabic, decide explicitly whether to normalise letter variants and diacritics; test it on real traffic.</li>
<li><b>Build the key</b> from everything that changes the correct answer: tenant, ACL or entitlement version, <b>resolved</b> model and revision (not the alias), prompt-template version, locale, generation parameters, tool and schema hashes, and the normalised text. Hash it with an HMAC so raw prompts never appear in key names.</li>
<li><b>Lookup</b> (e.g. Redis GET). On a hit, re-check authorisation, then return. For streaming clients, replay the cached text as a stream so the client code path is identical.</li>
<li><b>On a miss</b>: call the model; apply output policy (redaction, refusal checks); decide if the result is cacheable; store with a TTL and <b>dependency tags</b> (document ids and versions used to produce it).</li>
</ol>
${callout('warn','Temperature and determinism','With temperature &gt; 0 the "correct" answer is a distribution, and caching freezes one sample. That is acceptable for FAQ answers that were reviewed, and unacceptable where variety is the product (creative text). Even at temperature 0, batched GPU inference is not guaranteed bit-identical, so do not rely on a cache to make outputs reproducible for audit; store the actual response that was served.')}
<p><b>Stampede protection.</b> When a popular entry expires, hundreds of concurrent requests miss at once and all call the model. Use request coalescing (one in-flight computation per key; others wait for it) and jittered TTLs.</p>

${tenQ('exact response cache',[
 'Repeated identical requests regenerate the same answer at full model cost and latency.',
 'Gateway or application backend, before any model call; store is Redis/Valkey or similar.',
 'Final response text (or structured output), plus metadata: model, template version, dependency tags, created-at.',
 'Exact key match after canonicalisation; whole response returned (replayed as a stream if needed).',
 'Entries × (key ≈ 64–100 B + value size + store overhead). Values dominate: answers of 1–4 KB.',
 'TTL; template or model version change (new key); document change (tag purge); permission change (ACL version in key); manual purge.',
 'Hit: ~1 ms, zero tokens. Miss: +~1 ms lookup. Saves 100 % of prefill and decode for hits.',
 'Cross-tenant leakage if tenant/ACL is missing from the key; stale answers after policy change; caching personal data; stampedes on expiry.',
 'Request hit ratio by intent and tenant; lookup p99; avoided tokens; stale-hit audit sampling; wrong-hit incidents (target zero).',
 'Hit ratio rises with traffic concentration but falls as personalisation grows; per-tenant namespaces; regional caches must receive purge events from every region.'
])}

<h3>3.2 Semantic cache</h3>
<p>The semantic path adds an embedding and a vector search:</p>
<ol>
<li><b>Eligibility</b> (stricter than exact): only allow-listed intents, no personal data, no conversation history (or only the last user turn when the intent is self-contained).</li>
<li><b>Embed</b> the normalised question with a fixed embedding model version (e.g. 1,024 dimensions).</li>
<li><b>Search</b> an approximate-nearest-neighbour index (HNSW or IVF) <b>filtered</b> by tenant, locale, intent and policy version.</li>
<li><b>Threshold</b>: accept the nearest candidate only if similarity ≥ a per-intent threshold.</li>
<li><b>Verify</b>: slot/entity match (product, route, fare class, country), optionally a cross-encoder or small judge model that answers "does the cached answer answer this question?".</li>
<li><b>Serve or fall through</b> to the model; log the candidate, score and decision either way.</li>
</ol>
${anim('v2-sem-false-hit')}
<p>The false hit in the animation is not a bug in the vector search. Embeddings are designed to place sentences with similar overall meaning close together; a single decisive word (hotel vs flight, refundable vs non-refundable, Riyadh vs Dubai) moves the vector only slightly. <b>Similarity proposes; rules and verification decide.</b></p>

<h3>3.3 Choosing a threshold from the cost of being wrong</h3>
<p>Do not pick 0.9 because a blog did. Build a labelled set from your traffic: pairs of (new question, nearest cached question) with a human label "the cached answer is correct for the new question: yes/no". Include near misses deliberately: product swaps, negations, different cities, different dates.</p>
${formula(`
Illustrative evaluation: 1,000 labelled candidate pairs for intent "cancellation policy"

threshold   served   correct   false hits   precision
  0.90        600      540         60         90.0 %
  0.93        420      405         15         96.4 %
  0.95        300      297          3         99.0 %

Value per served hit (illustrative):
  saving per hit           s = $0.010   (avoided model call)
  cost of one false hit    c = $0.50    (user re-asks + support contact share)

Expected value per served hit = s − (1 − precision) × c
  0.90:  0.010 − 0.100 × 0.50 = 0.010 − 0.050  = −$0.040   ← loses money
  0.93:  0.010 − 0.036 × 0.50 = 0.010 − 0.018  = −$0.008   ← still loses
  0.95:  0.010 − 0.010 × 0.50 = 0.010 − 0.005  = +$0.005   ← positive

Break-even precision = 1 − s ÷ c = 1 − 0.010 ÷ 0.50 = 98 %

ANSWER  For this intent the cache must be ≥ 98 % precise to be worth it.
        If a false hit can cost a refund dispute (c = $50), break-even precision
        is 99.98 %: do not semantically cache that intent at all.
`)}

${tenQ('semantic cache',[
 'Paraphrased repeats of the same public question miss an exact cache but could reuse the same approved answer.',
 'Gateway or application backend; needs an embedding model (GPU or API) and a vector index (Redis with vector search, Qdrant, pgvector, a managed service).',
 'Question embedding (e.g. 1,024 floats), normalised question text, answer, metadata (tenant, locale, intent, slots, policy version, dependency tags), created-at.',
 'Nearest-neighbour search with metadata filters, threshold, slot check and optional verifier; answer returned if all pass.',
 'Vectors (entries × dims × bytes per dim) + ANN graph links + answer payloads + metadata. Payloads and vectors dominate.',
 'TTL; embedding-model version change (all vectors invalid: rebuild); document/policy change (tag purge); threshold changes (no data change, but behaviour changes).',
 'Hit: embed + search ≈ 10–30 ms, zero model tokens. Miss: the same 10–30 ms added before the model call (miss tax).',
 'False hits (wrong but confident answers), cross-tenant leakage via a shared index, cache poisoning (an attacker plants a bad answer under a popular question), embedding inversion risk for sensitive text.',
 'Served-hit ratio, precision on a labelled sample (weekly), false-hit reports, score distribution of accepted hits, lookup p95, avoided tokens.',
 'Index memory grows with entries; per-tenant indexes or filters; multilingual traffic needs a multilingual embedding model and per-locale thresholds; regional copies must share purge events.'
])}

<h3>3.4 Memory sizing</h3>
${formula(`
Semantic cache: 5,000,000 entries, 1,024-dim embeddings

STEP 1  Raw vectors, float32 (4 bytes)
        5,000,000 × 1,024 × 4 B = 20,480,000,000 B = 20.48 GB ≈ 19.07 GiB

STEP 2  Same vectors in float16 (2 B)      = 10.24 GB
        int8 scalar quantisation (1 B)     =  5.12 GB

STEP 3  HNSW graph links, M = 16 (base layer holds ≈ 2M neighbour ids of 4 B)
        5,000,000 × 2 × 16 × 4 B ≈ 0.64 GB   (+ small upper layers; estimate)

STEP 4  Answer payloads, average 1.5 KB
        5,000,000 × 1,500 B = 7.5 GB

STEP 5  Total (float32 vectors) ≈ 20.48 + 0.64 + 7.5 ≈ 28.6 GB  + metadata
        Total (int8 vectors)    ≈  5.12 + 0.64 + 7.5 ≈ 13.3 GB  + metadata

Exact cache: 2,000,000 entries × (2,048 B value + 64 B key + ≈ 100 B store overhead)
        = 2,000,000 × 2,212 B ≈ 4.4 GB

ANSWER  A semantic cache costs several times the memory of an exact cache for
        the same number of entries; quantise vectors and cap entries per intent.
`)}

<h2>4. Where does it fit?</h2>
${fig('Response caches in the gateway path', svgDiagram({w:900,h:260,
 boxes:[
  {id:'in',x:10,y:100,w:110,h:56,label:'Request'},
  {id:'el',x:140,y:100,w:130,h:56,label:'Eligibility',sub:'policy, PII scan'},
  {id:'ex',x:290,y:40,w:150,h:56,label:'Exact lookup',sub:'Redis GET',cls:'hl'},
  {id:'se',x:290,y:160,w:150,h:56,label:'Semantic lookup',sub:'embed + ANN',cls:'hl'},
  {id:'ver',x:470,y:160,w:150,h:56,label:'Verify',sub:'slots, judge'},
  {id:'model',x:650,y:100,w:120,h:56,label:'Model call'},
  {id:'wb',x:790,y:100,w:100,h:56,label:'Write-back',sub:'tags, TTL'}
 ],
 arrows:[{from:'in',to:'el'},{from:'el',to:'ex'},{from:'ex',to:'se',label:'miss',fromSide:'bottom',toSide:'top'},{from:'se',to:'ver',label:'candidate'},{from:'ver',to:'model',label:'reject'},{from:'el',to:'model',label:'not eligible',cls:'dash',dy:-60},{from:'model',to:'wb'}]
}), 'Ineligible requests (personal data, history, tools) skip both caches. Exact is checked first because it is cheaper and safer.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Gateway identity</b> supplies tenant and entitlement versions for keys and filters (${L('v2-ai-gateway','AI gateway')}).</li>
<li><b>Knowledge plane</b> supplies document versions used to build answers; they become dependency tags so a policy update purges dependent answers (${L('v2-cache-ops','invalidation')}).</li>
<li><b>Guardrails</b> run before write-back: never cache an answer that failed or bypassed output checks.</li>
<li><b>Embedding service</b>: the semantic cache shares (or not) the embedding model used for RAG; sharing saves GPU but couples version upgrades.</li>
<li><b>Observability</b>: hit/miss and decisions logged per request; precision measured offline.</li>
</ul>
<h3>Products</h3>
<p>Gateways increasingly bundle these caches. LiteLLM’s proxy supports cache types including <code>redis</code>, <code>redis-semantic</code>, <code>qdrant-semantic</code>, <code>s3</code>, <code>gcs</code>, <code>local</code> and <code>disk</code>. Azure API Management has <code>llm-semantic-cache-lookup</code> and <code>llm-semantic-cache-store</code> policies backed by a RediSearch-compatible cache. Kong lists an AI semantic cache plugin. Whatever you use, the key design, eligibility policy, slot checks and evaluation remain your responsibility; no product knows that "hotel" and "flight" must not be swapped in your domain.</p>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Decision','Recommendation'],[
 ['Eligibility policy','Allow-list of intents; deny if PII detected, if history present, if tools were called'],
 ['Key schema','Versioned (<code>key_version</code> field) so a schema change is a clean cut-over'],
 ['TTL','Short by default (minutes to hours), plus event-driven purge; never rely on TTL for permissions'],
 ['Store','Separate logical DB or cluster per data class; encryption at rest; no raw prompts in key names'],
 ['Semantic thresholds','Per intent and locale, from labelled evaluation; stored in config with change review'],
 ['Kill switch','Global and per-tenant bypass flags; tested in game days'],
 ['Retention and erasure','Entries containing user-derived text must honour deletion requests; index by user where applicable']
])}
${callout('devops','DevOps bridge','This is the same discipline as CDN caching of authenticated pages: Vary headers, cache-control, purge APIs. The difference is that the "page" is generated by a model that may include facts from documents the next viewer is not allowed to see, so the Vary set must include permission versions.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['User sees another tenant’s data','Tenant or ACL missing from key / filter','Key schema; entry metadata','Bypass cache, purge, fix key, notify per incident policy'],
 ['Old policy answer after update','No dependency tags or purge failed','Entry tags show old doc version; purge lag metric','Tag-based purge; version check on write'],
 ['Hit ratio high, complaints rising','Semantic false hits','Accepted-hit score distribution shifted low; labelled precision fell','Raise threshold, add slot checks, narrow intents'],
 ['Hit ratio collapsed after deploy','Template or model version changed (new keys) or key schema bug','Hits by key_version','Expected after version bumps; warm popular entries'],
 ['Latency spikes at the top of each hour','Synchronised TTL expiry → stampede','Miss bursts aligned with TTL','Jittered TTLs, request coalescing'],
 ['Semantic cache returns nothing after embedding upgrade','Vectors from old model not comparable','Embedding model version mismatch','Rebuild index; key includes embedding model version']
])}

<h2>8. How do we scale it?</h2>
<ul>
<li>Exact caches: shard by key hash (Redis Cluster); hot keys replicated or held in a small in-process LRU in each gateway replica.</li>
<li>Semantic caches: partition by tenant and intent so each search is over a small index; quantise vectors; cap entries per intent with LRU or LFU.</li>
<li>Multi-region: caches are regional; publish purge events globally (Kafka topic) and include region in metrics.</li>
<li>Embedding cost: batch embedding calls; reuse the query embedding for RAG retrieval when the same model is used.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Illustrative: 20 M requests/month, 10 % are eligible public FAQ intents

Eligible requests          = 20,000,000 × 0.10 = 2,000,000
Exact hit ratio (eligible) = 30 %   → 600,000 hits
Semantic adds 15 % of the remaining eligible at 99 % precision
                            = 1,400,000 × 0.15 = 210,000 hits

Avoided model calls        = 810,000 = 4.05 % of all traffic
Avoided cost at $0.010 per call       = $8,100 / month
Cache running cost (store + embeddings, illustrative) = $1,200 / month
False-hit cost: 210,000 × 1 % × $0.50 = $1,050 / month

Net ≈ 8,100 − 1,200 − 1,050 = $5,850 / month

ANSWER  Real but modest: response caches cut cost only for the repeatable slice.
        Prefix caching (next lesson) usually saves more on the other 96 %.
`)}

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Would you add a semantic cache to our customer-support assistant?”','<p><i>Answer (≈50 s):</i> "Only for a narrow set of public intents, and only after an evaluation. Similarity is not sameness — ‘cancel my hotel’ and ‘cancel my flight’ embed close together but need different answers — and it is never permission. I would allow-list intents, exclude anything with personal data or conversation history, filter the index by tenant, locale and policy version, add slot checks for entities like product and route, and pick the threshold from a labelled near-miss set using the cost of a false hit: if a wrong answer costs fifty times what a hit saves, I need about 98 % precision to break even. I would also tag entries with document versions so a policy change purges them, and keep a kill switch."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Yes, set cosine similarity to 0.9 and cache everything to save tokens."</p></div><div class="good"><h4>Strong answer</h4><p>Narrow eligibility, scoped index, slot checks, threshold from labelled data and false-hit cost, dependency-tag invalidation, kill switch, and an honest estimate of how small the repeatable slice is.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Eligibility policy','key with tenant + versions','hit','no model call'])}
${chain(['Embedding','ANN search','threshold','slot check','serve or fall through'])}
<p>Next: ${L('v2-prefix-kv-cache','prefix caching and provider prompt caching')}, which save prefill work on the requests response caches cannot touch. Key design code and invalidation are in ${L('v2-cache-ops','cache operations')}.</p></div>
`,
  quiz:[
    {q:'Which field is MOST important to include in an exact response cache key for a multi-tenant platform?',options:['Request timestamp','Tenant id and entitlement/ACL version','Client IP address','Response length'],answer:1,explain:'Without tenant and permission versions, one tenant’s or user’s answer can be served to another. Timestamps would make every key unique.'},
    {q:'A semantic cache returns the flight-cancellation answer for a hotel question with similarity 0.96. What is the best structural fix?',options:['Lower the threshold','Add slot/entity checks and filter the index by intent/product metadata','Use a larger vector index','Increase TTL'],answer:1,explain:'Similarity alone cannot distinguish one decisive word. Slot checks and scoped filters make the decision on the attributes that determine correctness.'},
    {q:'Saving per hit is $0.01 and a false hit costs $0.50. What precision is needed to break even?',options:['50 %','90 %','98 %','99.98 %'],answer:2,explain:'Break-even precision = 1 − s ÷ c = 1 − 0.01 ÷ 0.5 = 0.98.'},
    {q:'5 M entries × 1,024 dims in float32 need how much memory for vectors alone?',options:['≈ 5 GB','≈ 10 GB','≈ 20.5 GB','≈ 41 GB'],answer:2,explain:'5×10⁶ × 1,024 × 4 B = 20.48×10⁹ B ≈ 20.5 GB (≈ 19.1 GiB). float16 halves it, int8 quarters it.'},
    {q:'Your embedding model is upgraded. What must happen to the semantic cache?',options:['Nothing','Rebuild it: vectors from different models are not comparable','Only raise the threshold','Only purge entries older than the TTL'],answer:1,explain:'Different embedding models produce incompatible vector spaces; include the model version in the cache identity and rebuild.'}
  ],
  flashcards:[
    {front:'What belongs in an exact response cache key?',back:'Tenant, entitlement/ACL version, resolved model + revision, template version, locale, generation params, tool/schema hashes, normalised text; HMAC-hashed; key_version field.'},
    {front:'Semantic cache decision pipeline',back:'Eligibility → embed → filtered ANN search → per-intent threshold → slot check / verifier → serve or fall through; log every decision.'},
    {front:'False hit',back:'A cache hit that returns an answer that is wrong for the new request; counted as a hit by dashboards, so it needs labelled evaluation to detect.'},
    {front:'Break-even precision for a semantic cache',back:'1 − (saving per hit ÷ cost of a false hit).'},
    {front:'Semantic index memory',back:'entries × dims × bytes per dim + ANN links + payloads. 5M × 1,024 × 4 B ≈ 20.5 GB vectors.'},
    {front:'Cache stampede fix',back:'Request coalescing (one in-flight computation per key) and jittered TTLs.'}
  ]
});
registerGlossary([
  {term:'Exact response cache',def:'A cache that returns a previously generated response when the canonicalised request key, including tenant, permission and version fields, matches exactly.',lesson:'v2-response-semantic-cache',aliases:['response cache']},
  {term:'Semantic cache',def:'A cache that embeds a question, finds the most similar cached question by vector search, and reuses its answer if similarity and verification checks pass.',lesson:'v2-response-semantic-cache'},
  {term:'False hit',def:'A cache hit that serves a response that is not correct or not permitted for the new request.',lesson:'v2-response-semantic-cache',aliases:['false semantic hit','wrong hit']},
  {term:'Cache stampede',def:'Many concurrent misses for the same key, typically when a popular entry expires, causing a burst of duplicate expensive computations.',lesson:'v2-response-semantic-cache',aliases:['thundering herd']},
  {term:'Request coalescing',def:'Allowing only one in-flight computation per cache key while other requests for the same key wait for its result.',lesson:'v2-response-semantic-cache',aliases:['singleflight']},
  {term:'Dependency tag',def:'Metadata on a cache entry naming the source documents and versions it was derived from, used for targeted purges.',lesson:'v2-response-semantic-cache'}
]);

/* ======================= 2.2.3 Prefix caching, KV reuse and provider prompt caching ======================= */
registerLesson({
  id:'v2-prefix-kv-cache', vol:2, part:2, num:3,
  title:'Prefix caching, KV reuse and provider prompt caching', minutes:95,
  summary:'Most prompts in a product start the same way: the same system instructions, the same tool definitions, often the same documents. Prefix caching keeps the attention keys and values computed for that shared start and reuses them, so the next request only computes the part that is new. Inside your own engine this is automatic prefix caching in vLLM or the radix cache in SGLang. With hosted models it is provider prompt caching, which Anthropic and OpenAI bill at a large discount. It is exact, so it never changes the answer, but it depends on prompt layout, routing, memory and tenant isolation. This lesson explains the block-hash mechanism, the per-request paged KV cache it builds on, and the real provider rules and prices.',
  objectives:[
    'Explain how vLLM automatic prefix caching identifies reusable blocks with chained block hashes, and why one early token change destroys all reuse.',
    'Answer the ten caching questions for the engine prefix cache, the per-request paged KV cache, and provider prompt caching.',
    'Design prompt layouts that maximise prefix reuse without hurting correctness.',
    'Use Anthropic cache_control and OpenAI automatic caching correctly, with their minimum lengths, TTLs and price multipliers.',
    'Calculate the saving and payback of prompt caching for an agent workload, and the HBM cost of keeping prefixes warm.',
    'Isolate prefix caches between tenants with cache salts and explain the timing side channel this prevents.'
  ],
  prereqs:['v1-kv-cache','v1-batching','v2-cache-map'],
  next:['v2-distributed-kv','v2-cache-ops','v2-finops-optimization'],
  tags:['caching','kv-cache','vllm','prompt-caching','finops'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A court interpreter translating the same 20-page standing instructions at the start of every hearing could instead keep the translated pages and only translate the new testimony. But the pages are reusable only if every word up to that point is identical, and only in the room where they were kept. Now the real mechanism.')}
<p>During prefill, the engine computes key and value vectors for every prompt token at every layer (${L('v1-kv-cache','KV cache')}). ${term('Prefix caching')} keeps those KV blocks after the request finishes and, for a later request whose prompt starts with <b>exactly the same tokens</b>, reuses them instead of recomputing. The new request prefills only its unique suffix.</p>
<p>Three mechanisms share this idea:</p>
${table(['Mechanism','Where','Who controls it','How you pay'],[
 ['<b>Per-request paged KV cache</b>','Your engine, GPU HBM','Engine (always on)','GPU memory; the base everything else builds on'],
 ['<b>Engine prefix cache</b> (vLLM automatic prefix caching, SGLang RadixAttention)','Your engine, GPU HBM','You: flags, salts, prompt layout, routing','Free compute saved; costs HBM held by cached blocks'],
 ['<b>Provider prompt caching</b> (Anthropic, OpenAI and others)','Provider’s servers, opaque','You: breakpoints / cache keys / layout; provider: retention','Discounted price for cached input tokens; sometimes a write premium']
])}

<h2>2. Why do we need it?</h2>
<p>Prefill cost grows with prompt length, and modern prompts are long and repetitive:</p>
<ul>
<li>A support assistant: 2,000-token system prompt + tool schemas on <b>every</b> request.</li>
<li>An agent: 20,000 tokens of instructions and tools, then 30–100 model calls per task, each re-sending the whole growing conversation.</li>
<li>Document Q&amp;A: many users asking about the same 50-page contract.</li>
</ul>
<p>Without prefix reuse, every call pays full prefill for content the engine processed seconds ago. That inflates TTFT (prefill is on the critical path) and GPU cost (prefill is compute-bound work). Prefix caching is usually the single highest-value cache in an LLM platform because it applies to almost all traffic, not just repeated questions.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 The per-request paged KV cache (the foundation)</h3>
<p>Volume 1 explained the KV cache and PagedAttention in detail. The short version needed here: KV memory is divided into fixed-size blocks (16 tokens by default in vLLM); each request has a block table mapping its logical blocks to physical blocks; blocks are allocated as tokens are produced and freed when the request ends. Because physical blocks can be referenced by several block tables, they can be <b>shared</b> — that is what makes prefix caching cheap to implement.</p>
${tenQ('per-request (paged) KV cache',[
 'Decode would otherwise recompute keys and values of all earlier tokens at every step (quadratic work).',
 'Inside the inference engine, in GPU HBM, managed by the block manager.',
 'Key and value vectors per layer, per KV head, per token of each live request (2 × layers × kv_heads × head_dim × bytes per token).',
 'Every decode step of the same request reads all its blocks; blocks can be shared across requests for identical prefixes.',
 'Tokens in flight × KV bytes per token: e.g. 128 KiB/token for a Llama-3.1-8B shape in BF16, 320 KiB for a 70B shape.',
 'Request completion (freed), preemption (evicted then recomputed; vLLM V1 default preemption mode is recompute).',
 'Makes decode linear per step; its capacity sets max concurrency and therefore cost per token.',
 'KV exhaustion → queueing, rising TTFT, preemptions; unbounded growth with long contexts.',
 '<code>vllm:kv_cache_usage_perc</code> (0–1), <code>vllm:num_requests_waiting</code>, <code>vllm:num_requests_running</code>, queue-time histogram.',
 'Per replica; scale by replicas, tensor parallelism (KV sharded across GPUs), FP8 KV, context limits, and offload tiers (lesson 2.2.4).'
])}

<h3>3.2 Engine prefix caching: chained block hashes</h3>
<p>vLLM’s automatic prefix caching (APC) gives each <b>full</b> block a hash computed from the parent block’s hash, the block’s token ids, and extra keys (LoRA adapter id, multimodal input hashes, and a <code>cache_salt</code> in the first block). The hash therefore identifies the entire prefix up to and including that block. A global hash table maps block hash → physical block.</p>
${formula(`
h₀ = H( seed       , tokens[0..15]  , extras incl. cache_salt )
h₁ = H( h₀         , tokens[16..31] , extras )
hᵢ = H( hᵢ₋₁       , tokens of block i , extras )
      ↑ chaining: changing ANY earlier token changes every later hash

Default H: sha256 (since vLLM v0.11); --prefix-caching-hash-algo also offers
sha256_cbor, xxhash, xxhash_cbor (faster, but non-cryptographic)
`)}
${anim('v2-prefix-hash')}
<p>On a new request the scheduler walks the prompt block by block, looking up each hash; the longest run of hits from the start is reused, and prefill starts at the first miss. Only full blocks are cached: a 2,000-token prefix with 16-token blocks gives exactly 125 reusable blocks; a 2,010-token prefix also gives 125, and the last 10 tokens are recomputed.</p>
<p><b>Eviction.</b> When a request finishes, its blocks’ reference counts drop; blocks with reference count 0 stay in memory as cached-but-free, in an LRU free queue. When a new allocation needs space, the least recently used free block is evicted and its hash removed. Blocks used by running requests are never evicted. vLLM queues a finished request’s blocks in reverse order so the tail of a long prefix is evicted before its head, keeping the most shared part alive longest.</p>
${table(['Engine','Mechanism','Controls (verify for your version)'],[
 ['vLLM (v0.31, Oct 2026)','Automatic prefix caching, block hashes, LRU','On by default for supported models; disable with <code>--no-enable-prefix-caching</code>; <code>--prefix-caching-hash-algo</code>; per-request <code>cache_salt</code>; metrics <code>vllm:prefix_cache_queries</code> and <code>vllm:prefix_cache_hits</code> (both counted in <b>tokens</b>)'],
 ['SGLang (v0.5.21)','RadixAttention: KV in a radix tree keyed by token sequences; LRU of leaves','<code>--disable-radix-cache</code>; <code>--radix-eviction-policy</code> (default <code>lru</code>; also lfu, slru, priority); <code>--schedule-policy lpm</code> (longest-prefix-match, cache-aware) is an option, default is <code>fcfs</code>; <code>--enable-hierarchical-cache</code> (default off) for host-memory tiers'],
 ['TensorRT-LLM','KV cache block reuse','Configured through the KV cache config of the LLM API; check option names in your version’s docs']
])}
${callout('unverified','TensorRT-LLM option names','The TensorRT-LLM KV-reuse option names were not re-verified for this edition (the backend architecture changed in the 1.x line). Check the KV cache configuration page for your pinned release.')}

${tenQ('engine prefix cache (vLLM APC / SGLang radix cache)',[
 'Repeated prefill of identical prompt prefixes (system prompt, tools, shared documents, agent history) across requests.',
 'Inside one engine instance, in GPU HBM (extended to CPU/SSD by offload connectors, lesson 2.2.4).',
 'KV blocks of full 16-token blocks (vLLM) or radix-tree nodes (SGLang), indexed by chained hash / token path.',
 'Longest matching run of blocks from the start of the prompt; prefill starts at the first miss. Works across users and requests on the same replica unless salted.',
 'Cached-but-unused blocks occupy HBM that live requests could use; the engine evicts them on demand, so they consume only otherwise-free blocks.',
 'Any token change at or before a block (including tokenizer or chat-template change), different LoRA adapter, different salt, model reload, LRU eviction under memory pressure.',
 'Hit removes that share of prefill FLOPs and time; does not change decode. TTFT falls roughly with prefill share; GPU capacity rises.',
 'Timing side channel across users if shared; hit-rate collapse from volatile prefix content; cross-tenant sharing; hash collisions with weak hash algorithms in multi-tenant settings.',
 'Token hit rate = rate(prefix_cache_hits) ÷ rate(prefix_cache_queries); TTFT by hit bucket; per-replica hit rate (locality).',
 'Per-replica cache: hit rate depends on routing. With N replicas and random routing, each prefix must be warmed N times; cache-aware routing and offload turn it into a fleet-level cache.'
])}

<h3>3.3 Prompt layout: the lever you control</h3>
${table(['Do','Do not'],[
 ['System prompt, then tool definitions, then long stable documents, then conversation, then the new user turn','Put the date, user name, request id or A/B flag at the top of the system prompt'],
 ['Keep tool schemas in a stable, deterministic order','Generate tool lists in random or dict order per request'],
 ['Version templates; roll out new versions gradually (each version is a cold cache)','Edit the system prompt in place many times a day'],
 ['Append to conversation history (prefix grows)','Rewrite or reorder earlier turns every call (summarisation resets the prefix: do it rarely)'],
 ['Put per-user data after shared content','Interleave per-user data inside shared instructions']
])}
<p>A useful check: tokenise two consecutive production prompts and find the first differing token position. That position, rounded down to a block boundary, is your maximum possible hit for that pair.</p>

<h3>3.4 Provider prompt caching</h3>
<p>Hosted models do the same thing on the provider’s side and pass part of the saving to you. The details differ and change often; these are from the providers’ documentation as of Oct 2026.</p>
${table(['','Anthropic (Claude API)','OpenAI'],[
 ['How enabled','Explicit <code>cache_control</code> breakpoints on content blocks, or automatic mode: one top-level <code>"cache_control": {"type": "ephemeral"}</code> places the breakpoint on the last cacheable block','Automatic for supported models; GPT-5.6+ also supports explicit breakpoints (up to 4 cache writes per request) via <code>prompt_cache_options</code>'],
 ['Breakpoints','Up to 4 per request; lookback window of 20 blocks per breakpoint','—'],
 ['Minimum cacheable length','Per model: 512 tokens (Claude 5.x models incl. Opus 5.5, Sonnet 5.5, Haiku 5.5), 1,024 (e.g. Opus 4.8, Sonnet 5, Sonnet 4.6/4.5), 2,048 (Opus 4.7), 4,096 (Opus 4.6/4.5, Haiku 4.5); shorter prompts are silently not cached','1,024 tokens for GPT-5.6 and later; for earlier models it varies with request settings; on earlier models cached tokens are reported in multiples of 128'],
 ['Matching','Exact: 100 % identical prompt segments up to the breakpoint','Exact prefix match'],
 ['Lifetime','5 minutes by default, refreshed free on each hit; optional 1 hour (<code>"ttl": "1h"</code>)','Earlier models: <code>prompt_cache_retention</code> <code>in_memory</code> (≈5–10 min idle, up to 1 h) or <code>24h</code> (default for non-ZDR orgs); GPT-5.6+: 30 minutes'],
 ['Write price','1.25 × base input (5-min TTL); 2 × base input (1-h TTL)','GPT-5.6+: 1.25 × base input; earlier models: no write premium'],
 ['Read price','0.1 × base input; 0.05 × on Opus 5.5 and Sonnet 5.5; 0.025 × on Fable 5.1 and Mythos 5.1','GPT-5.6+: 0.1 × (0.05 × on GPT-6.1 Sol); earlier models model-dependent (e.g. gpt-4o 50 % off, gpt-4.1 75 %, gpt-5 family 90 %)'],
 ['Usage fields','<code>cache_creation_input_tokens</code>, <code>cache_read_input_tokens</code>, <code>input_tokens</code> (total = sum of the three)','<code>usage.input_tokens_details.cached_tokens</code> (and <code>cache_write_tokens</code>)'],
 ['Routing hint / isolation','Caches isolated per organisation, and per workspace on the Claude API (Bedrock and Google Cloud: organisation level)','<code>prompt_cache_key</code>: influences routing and (5.6+) per-customer cache accounting; does not guarantee a hit']
])}
${code('json',`{
  "model": "claude-sonnet-5-5",
  "max_tokens": 1024,
  "system": [
    { "type": "text", "text": "You are Atlas, the travel assistant... (2,000+ tokens of policy)",
      "cache_control": { "type": "ephemeral" } }
  ],
  "messages": [ { "role": "user", "content": "Can I add a second bag to my Riyadh flight?" } ]
}`)}
<p>Model ids above are illustrative; use the exact id your account lists. The breakpoint marks the end of the reusable prefix; everything before it (tools, system) must be byte-identical across calls.</p>

<h3>3.5 Worked example: an agent on a hosted model</h3>
${formula(`
Claude Sonnet 5.5 (Oct 2026): base input $2.00 / M, output $10.00 / M
  5-min cache write 1.25 × 2.00 = $2.50 / M     cache read 0.05 × 2.00 = $0.10 / M

Agent task: 20,000-token stable prefix (system + tools), 50 model calls within
5 minutes, each adding 1,000 new input tokens and producing 300 output tokens.
(Simplified: we ignore history growth, which would increase the saving.)

WITHOUT caching
  input  50 × 21,000 = 1,050,000 tok × $2.00 / M = $2.100
  output 50 ×    300 =    15,000 tok × $10.0 / M = $0.150
  total                                           = $2.250

WITH caching
  write  1 × 20,000 tok × $2.50 / M               = $0.050
  reads 49 × 20,000 = 980,000 tok × $0.10 / M    = $0.098
  new   50 ×  1,000 =  50,000 tok × $2.00 / M    = $0.100
  output                                           = $0.150
  total                                            = $0.398

ANSWER  ≈ 82 % cheaper per task (input alone ≈ 88 %); TTFT also falls because
        the provider skips prefill for the cached 20,000 tokens.
`)}
${formula(`
Payback of a cache write (per cached token, in units of base input price)

5-minute TTL:  extra write cost = 1.25 − 1 = 0.25
               saving per read  = 1 − 0.10 = 0.90
               reads to pay back = 0.25 ÷ 0.90 ≈ 0.28  → 1 reuse is enough

1-hour TTL:    extra write cost = 2.00 − 1 = 1.00
               reads to pay back = 1.00 ÷ 0.90 ≈ 1.1   → needs 2 reuses
               (at a 0.05 read multiplier: 1.00 ÷ 0.95 ≈ 1.05 → still 2)
`)}

${tenQ('provider prompt caching',[
 'Paying full input price and full prefill latency for the same long prefix on every call to a hosted model.',
 'Inside the provider’s serving stack; you only control prompt structure, breakpoints / cache keys and retention options.',
 'Provider-side prefix state (opaque to you; conceptually KV for the prefix) tied to your organisation (and workspace on the Claude API).',
 'Exact prefix match up to a breakpoint (Anthropic) or automatically on the longest cached prefix (OpenAI), above a minimum length.',
 'Not your memory; you pay write premiums (Anthropic 1.25×/2×, OpenAI 1.25× on GPT-5.6+) instead.',
 'TTL expiry (5 min / 1 h; OpenAI in-memory minutes, 24 h, or 30 min on 5.6+), any change in the prefix, model change, provider-side eviction.',
 'Cached input billed at 0.1× (some models 0.05× or 0.025×); lower TTFT for long prefixes. Uncached and output tokens unchanged.',
 'Silent non-caching below minimum length; cost surprises from frequent writes (changing prefixes); cross-user timing leakage where caches are shared (see 2.2.6).',
 'Usage fields per call: cached-read and cache-write tokens ÷ total input; cost per task before and after; TTFT by cached share.',
 'Requests must reach the same provider cache: stable prefixes and (OpenAI) a stable prompt_cache_key per tenant or workflow; per-workspace isolation means identical prompts in different workspaces do not share.'
])}

<h2>4. Where does it fit?</h2>
${fig('Where prefix reuse happens', svgDiagram({w:900,h:250,
 zones:[{x:330,y:10,w:560,h:230,label:'Self-hosted engine replica'}],
 boxes:[
  {id:'app',x:10,y:30,w:150,h:56,label:'Prompt builder',sub:'layout = hit rate',cls:'hl'},
  {id:'gw',x:180,y:30,w:130,h:56,label:'Gateway',sub:'salt, cache key'},
  {id:'prov',x:180,y:150,w:130,h:56,label:'Provider API',sub:'prompt caching'},
  {id:'sch',x:350,y:30,w:160,h:56,label:'Scheduler',sub:'hash walk'},
  {id:'tbl',x:530,y:30,w:170,h:56,label:'Block hash table',cls:'v2'},
  {id:'pool',x:350,y:150,w:350,h:70,label:'HBM KV block pool',sub:'live blocks + cached free blocks (LRU)',cls:'v2'},
  {id:'met',x:720,y:30,w:150,h:56,label:'/metrics',sub:'hits, queries'}
 ],
 arrows:[{from:'app',to:'gw'},{from:'gw',to:'sch'},{from:'gw',to:'prov'},{from:'sch',to:'tbl',label:'lookup'},{from:'tbl',to:'pool',fromSide:'bottom',toSide:'top'},{from:'tbl',to:'met',cls:'dash'}]
}), 'The application’s prompt layout decides the maximum possible reuse; the gateway adds isolation (cache_salt, prompt_cache_key); the engine finds matching blocks.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Router</b>: a prefix is cached on one replica; without cache-aware routing each replica re-warms it (${L('v2-distributed-kv','next lesson')}).</li>
<li><b>Scheduler and batching</b>: cached blocks count as free capacity for admission; heavy prefix reuse lets more sequences fit (${L('v1-batching','batching')}).</li>
<li><b>Chunked prefill</b>: prefill of the uncached suffix is still chunked and interleaved with decode.</li>
<li><b>LoRA</b>: the adapter id is part of the hash, so each adapter has its own prefix cache.</li>
<li><b>Disaggregated serving</b>: prefix hits on prefill workers reduce the KV that must be transferred to decode workers only if the decode side can also reuse it (${L('v2-distributed-inference','distributed inference')}).</li>
<li><b>Gateway</b> sets <code>cache_salt</code> per tenant for self-hosted engines and a stable <code>prompt_cache_key</code> for OpenAI.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Area','Action'],[
 ['Enablement','Confirm APC is on (vLLM default for supported models); pin and record <code>--prefix-caching-hash-algo</code>; keep sha256 for multi-tenant'],
 ['Isolation','Gateway injects a per-tenant <code>cache_salt</code>; decide whether tenants may share (e.g. a public product prompt) explicitly'],
 ['Prompt governance','Template linting in CI: no volatile values before the user section; deterministic tool order; template version in metadata'],
 ['Dashboards','Token hit rate per model and replica; TTFT split by hit vs miss; KV usage'],
 ['Provider usage','Parse cached/write token fields into cost pipeline; alert on hit-rate drops'],
 ['Capacity','Account for HBM held by warm prefixes when tenants are salted (duplicates)']
])}
${code('promql',`# Prefix-cache token hit rate per model over 5 minutes (vLLM)
sum by (model_name) (rate(vllm:prefix_cache_hits[5m]))
/
sum by (model_name) (rate(vllm:prefix_cache_queries[5m]))`)}
${callout('devops','DevOps bridge','Think of the prefix cache like a CDN edge cache keyed by URL prefix — but per replica, invalidated by any byte change, and invisible to Kubernetes. A product team’s innocent template change is like adding a random query string to every URL: hit rate drops to zero and origin load (GPU prefill) jumps.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['TTFT up 40 % after an app release, traffic flat','Volatile value (date, user name) moved into the system prompt','Token hit rate fell; diff of templates; first differing token position','Move volatile content after shared content; template lint rule'],
 ['Hit rate high on one replica, near zero on others','Random routing; prefix warm only where first served','Per-replica hit rate','Cache-aware routing (2.2.4)'],
 ['Provider bill rose although caching is "on"','Prompt below minimum length, or prefix changes between calls → constant writes','cache_creation vs cache_read tokens','Reach minimum length, stabilise prefix, check breakpoint placement'],
 ['Hit rate drops under load','Cached blocks evicted by live requests (KV pressure)','KV usage ≈ 100 %, evictions','Offload tiers, more replicas, shorter contexts'],
 ['Tenant B is faster on tenant A’s prompts','Shared cache without salt (side channel)','Same hashes across tenants','Per-tenant cache_salt'],
 ['Output differs slightly between hit and miss','Numerical differences from different batch shapes/kernels','Diff at temperature 0','Expected in batched GPU inference; not a cache bug']
])}

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Fit more prefixes</b>: FP8 KV cache halves bytes per token, so twice as many warm prefixes fit.</li>
<li><b>Route for locality</b>: cache-aware routing so popular prefixes live on a subset of replicas.</li>
<li><b>Tier the memory</b>: CPU and SSD offload for long prefixes that get evicted.</li>
<li><b>Mind salting cost</b>: per-tenant salts duplicate identical prefixes.</li>
</ul>
${formula(`
HBM held by warm prefixes (Llama-3.1-8B shape, 128 KiB per token, BF16)

One 2,000-token system prompt:   2,000 × 128 KiB = 256,000 KiB = 250 MiB
100 tenants, identical prompt, salted per tenant:
                                 100 × 250 MiB = 25,000 MiB ≈ 24.4 GiB
Same 100 tenants, unsalted (shared):                       250 MiB

ANSWER  Isolation can cost ~24 GiB of HBM on one replica. Share a prefix
        only when its content is public (e.g. a product-wide system prompt)
        and the timing signal reveals nothing secret; salt everything else.
`)}

<h2>9. How do we optimize its cost?</h2>
<p>For self-hosted models, prefix hits convert directly into GPU capacity, but only for the prefill share of GPU time:</p>
${formula(`
Illustrative replica: GPU time split measured as 35 % prefill, 65 % decode
Token hit rate on prompt tokens: 50 %

GPU time saved ≈ 0.35 × 0.50 = 17.5 % of replica time
   ↑ not 50 %: decode is untouched, and attention over cached tokens
     still costs a little during prefill of the suffix

Capacity gain ≈ 1 ÷ (1 − 0.175) ≈ 1.21 → about 21 % more requests per GPU
                                         at the same utilisation
`)}
<p>For hosted models the saving is on the bill, computed per field as in the agent example. The full savings method, including why avoided prefill tokens are not "total tokens × hit rate", is in ${L('v2-cache-ops','cache operations')}.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Our TTFT doubled after a harmless prompt change. What happened?”','<p><i>Answer (≈45 s):</i> "Almost certainly prefix caching. vLLM caches KV in 16-token blocks whose hashes chain from the previous block, so any token change early in the prompt changes every later hash and the whole shared prefix misses. If someone put the current date or a request id at the top of the system prompt, every request now prefills the full system prompt and tools again. I would confirm it with the prefix-cache hit rate — vllm:prefix_cache_hits over prefix_cache_queries, both in tokens — and by diffing two consecutive prompts to find the first differing token. The fix is layout: stable content first, volatile content last, enforced by a template lint in CI. For hosted models I would check cache_read versus cache_creation tokens the same way."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"The model got slower; scale up GPUs."</p></div><div class="good"><h4>Strong answer</h4><p>Names chained block hashes, cites the token-based metric, finds the first differing token, fixes layout and adds a guardrail in CI.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Prompt layout','first differing token','block hashes','prefix hit tokens','prefill avoided','TTFT and GPU cost'])}
${chain(['Gateway salt','per-tenant hashes','no cross-tenant reuse','no timing leak'])}
<p>Next: ${L('v2-distributed-kv','distributed KV, offload and cache-aware routing')} make prefix caching work across a fleet.</p></div>
`,
  quiz:[
    {q:'A request’s prompt differs from a cached one only at token 5. With vLLM APC, how many blocks are reused?',options:['All but the first block','Zero: block 0 changes, and every later hash chains from it','Half of them','All of them, because only one token differs'],answer:1,explain:'Each block hash includes the parent hash, so a change in block 0 changes every subsequent hash.'},
    {q:'What do vllm:prefix_cache_queries and vllm:prefix_cache_hits count?',options:['Requests','Blocks','Tokens','Bytes'],answer:2,explain:'vLLM records the number of tokens queried and the number of those found in the cache, so their ratio is a token hit rate.'},
    {q:'Anthropic 5-minute cache writes cost 1.25× and reads 0.1× base input. How many reuses pay back a write?',options:['0 — writes are free','1','5','10'],answer:1,explain:'Extra write cost 0.25 per token; each read saves 0.9, so one reuse more than pays back.'},
    {q:'Why can per-tenant cache_salt increase GPU memory use?',options:['Salts are large','Identical prefixes from different tenants hash differently, so each tenant holds its own copy of the KV blocks','It disables PagedAttention','It forces FP32 KV'],answer:1,explain:'Isolation removes sharing; 100 tenants with the same 2,000-token prompt hold 100 copies.'},
    {q:'A self-hosted replica spends 35 % of GPU time in prefill. Token hit rate is 50 %. Roughly how much GPU time is saved?',options:['50 %','35 %','17.5 %','85 %'],answer:2,explain:'Only prefill benefits: 0.35 × 0.5 ≈ 17.5 %. Decode time is unchanged.'},
    {q:'An OpenAI request on GPT-5.6 has a 900-token prompt. What happens with prompt caching?',options:['It is cached at a discount','It is not cached: the minimum is 1,024 tokens for GPT-5.6+','It is cached for 24 hours','It fails with an error'],answer:1,explain:'Below the minimum length caching simply does not apply; no error is raised.'}
  ],
  flashcards:[
    {front:'vLLM block hash',back:'hᵢ = H(hᵢ₋₁, token ids of block i, extras: LoRA id, multimodal hashes, cache_salt in block 0). Default sha256. Only full 16-token blocks are cached.'},
    {front:'Prompt layout rule for caching',back:'Stable first (system, tools, shared docs), then conversation, then the new user turn. No dates or ids at the top.'},
    {front:'Anthropic prompt caching numbers (Oct 2026)',back:'5-min TTL default (refreshed on hit), 1-h option; write 1.25× / 2×; read 0.1× (0.05× Opus/Sonnet 5.5; 0.025× Fable/Mythos 5.1); ≤4 breakpoints; min 512–4,096 tokens by model; workspace isolation.'},
    {front:'OpenAI prompt caching numbers (Oct 2026)',back:'Automatic; min 1,024 tokens on GPT-5.6+; GPT-5.6+ read 0.1×, write 1.25×, 30-min TTL; earlier models no write premium, model-dependent discount, in_memory or 24h retention; prompt_cache_key is a hint.'},
    {front:'Token hit rate PromQL (vLLM)',back:'rate(vllm:prefix_cache_hits[5m]) / rate(vllm:prefix_cache_queries[5m])'},
    {front:'SGLang prefix cache',back:'RadixAttention: radix tree of token sequences → KV; default eviction lru; schedule-policy lpm optional (default fcfs); hierarchical cache off by default.'},
    {front:'What prefix caching never does',back:'Skip decode, share answers, or reuse blocks whose token ids differ.'}
  ]
});
registerGlossary([
  {term:'Prefix caching',def:'Reusing the KV cache computed for an identical prompt prefix across requests so only the new suffix is prefilled.',lesson:'v2-prefix-kv-cache',aliases:['automatic prefix caching','APC','prefix cache']},
  {term:'RadixAttention',def:'SGLang’s prefix-reuse mechanism that stores KV in a radix tree keyed by token sequences, with LRU eviction of leaves.',lesson:'v2-prefix-kv-cache',aliases:['radix cache']},
  {term:'Provider prompt caching',def:'A hosted-model feature that caches prompt prefixes on the provider side and bills cached input tokens at a discount (with possible write premiums).',lesson:'v2-prefix-kv-cache',aliases:['prompt caching']},
  {term:'cache_salt',def:'A per-request value mixed into the first block hash of vLLM’s prefix cache so that only requests with the same salt can share cached blocks.',lesson:'v2-prefix-kv-cache',aliases:['cache salt']},
  {term:'cache_control',def:'Anthropic API field that marks a prompt-cache breakpoint on a content block, or at top level for automatic placement.',lesson:'v2-prefix-kv-cache'},
  {term:'Block hash',def:'A hash identifying a full KV block together with all tokens before it (by chaining the parent hash), used to look up reusable prefix blocks.',lesson:'v2-prefix-kv-cache'}
]);

/* ======================= 2.2.4 Distributed KV, offload and cache-aware routing ======================= */
registerLesson({
  id:'v2-distributed-kv', vol:2, part:2, num:4,
  title:'Distributed KV cache, CPU/SSD offload and cache-aware routing', minutes:95,
  summary:'A prefix cache that lives in one GPU’s memory helps only requests that land on that GPU, and only until the blocks are evicted. Three techniques turn it into a fleet-wide resource. Offload copies evicted KV blocks to CPU memory and local SSD so they can be loaded back instead of recomputed. Distributed KV stores share those blocks across machines through a remote pool. Cache-aware routing sends each request to the replica that already holds most of its prefix, while still balancing load. This lesson explains each with transfer-versus-recompute arithmetic, capacity sizing, the routing cost function NVIDIA Dynamo uses, and the failure modes that make tail latency worse instead of better.',
  objectives:[
    'Answer the ten caching questions for CPU/SSD KV offload, distributed (remote) KV pools, and cache-aware routing.',
    'Decide when loading KV from a tier beats recomputing it, using bytes per token, bandwidth and prefill throughput.',
    'Size CPU and SSD offload capacity in tokens and prefixes for a given model shape.',
    'Explain how a KV-aware router scores replicas, including prefix overlap, load and hot-spot avoidance.',
    'Name the main implementations (vLLM connectors, LMCache, Mooncake, Dynamo KVBM and router, llm-d, SGLang HiCache) and what each provides.'
  ],
  prereqs:['v2-prefix-kv-cache','v1-kv-cache','v1-multi-gpu-profiling'],
  next:['v2-distributed-inference','v2-rag-weight-cache','v2-cache-ops','v2-hyperscale-serving'],
  tags:['caching','kv-cache','routing','llm-d','dynamo','offload'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A warehouse keeps the fastest-moving goods next to the packing desk, slower ones on upper shelves, and the rest in a regional depot. A smart dispatcher sends each order to the warehouse that already has most items on hand — unless that warehouse is overwhelmed. Moving goods between levels is never free. Now the real mechanism.')}
<p>Three related techniques extend the KV cache beyond one GPU’s HBM:</p>
${table(['Technique','What it does','Typical implementations (Oct 2026)'],[
 ['<b>KV offload (tiering)</b>','Copies KV blocks evicted from HBM to CPU DRAM, then local NVMe; loads them back on a later prefix hit','vLLM <code>OffloadingConnector</code>, LMCache, NVIDIA Dynamo KVBM, SGLang hierarchical cache (<code>--enable-hierarchical-cache</code>, off by default), llm-d tiered prefix cache'],
 ['<b>Distributed / remote KV pool</b>','Stores KV blocks in a shared pool reachable over the network, so replica B can load blocks that replica A computed','LMCache remote backends (Redis/Valkey, Mooncake, InfiniStore, S3-compatible, NIXL, GDS), Mooncake store, Dynamo KVBM with NIXL'],
 ['<b>Cache-aware routing</b>','Chooses the replica for a request using prefix overlap and load','NVIDIA Dynamo KV router, llm-d Router (endpoint picker), SGLang router, Ray Serve <code>PrefixCacheAffinityRouter</code>']
])}
<p>In vLLM, external KV systems plug in through <code>--kv-transfer-config</code> with a connector such as <code>LMCacheConnectorV1</code>, <code>NixlConnector</code>, <code>MooncakeConnector</code>, <code>OffloadingConnector</code> or <code>MultiConnector</code> (to combine several). The same connector interface carries KV between prefill and decode workers in disaggregated serving (${L('v2-distributed-inference','distributed inference')}).</p>

<h2>2. Why do we need it?</h2>
<ul>
<li><b>HBM is small relative to reusable state.</b> On a 70B-shape model, one 8,192-token prefix is 2.5 GiB of KV. After weights and live requests, a node holds only dozens of warm prefixes; anything else is evicted and later recomputed.</li>
<li><b>Fleets dilute hit rates.</b> With 20 replicas and random routing, a popular prefix must be computed up to 20 times, and each replica keeps a separate copy competing for its HBM.</li>
<li><b>Agents and multi-turn chat pause.</b> A user reads for two minutes; under load their conversation’s KV is evicted; the next turn re-prefills the whole history. Offload keeps it one PCIe transfer away.</li>
</ul>

<h2>3. How does it work internally?</h2>
<h3>3.1 Offload tiers</h3>
${anim('v2-kv-offload')}
<p>The offload connector hooks the engine’s block lifecycle. When the block manager evicts a cached block (or proactively, when a block is completed), the connector copies it to the next tier, keyed by the same block hash. On a new request, after the HBM lookup, the connector looks up the remaining hashes in lower tiers, schedules asynchronous loads into freshly allocated HBM blocks, and the scheduler starts prefill after the last loaded block. Tiers are LRU caches; none is durable: a lost tier only costs recomputation.</p>

<h3>3.2 Transfer versus recompute</h3>
${formula(`
Per-token comparison, 70B shape (80 layers, 8 KV heads, head_dim 128, BF16),
tensor parallelism 8 on one 8-GPU node

KV per token              = 2 × 80 × 8 × 128 × 2 B = 327,680 B = 320 KiB
KV per token per GPU      = 320 KiB ÷ 8 = 40 KiB  (each GPU loads its own shard)

Load from CPU DRAM at an assumed 25 GB/s effective per GPU
  t_load ≈ 40,960 B ÷ 25×10⁹ B/s ≈ 1.6 µs per token

Recompute (prefill) ≈ 2 × parameters FLOPs per token
  = 2 × 70.6×10⁹ = 1.41×10¹¹ FLOPs per token
  node throughput at an assumed 40 % of 8 × 989 TFLOPS (H100 dense BF16)
  = 0.40 × 7.91×10¹⁵ ≈ 3.16×10¹⁵ FLOP/s
  t_recompute ≈ 1.41×10¹¹ ÷ 3.16×10¹⁵ ≈ 45 µs per token

For an 8,192-token prefix
  load    ≈ 8,192 × 1.6 µs  ≈ 13 ms   (+ lookup and scheduling overhead)
  compute ≈ 8,192 × 45 µs   ≈ 370 ms

ANSWER  On large models, loading from DRAM is ~25× cheaper per token than
        recomputing. The win shrinks for small models (fewer FLOPs per KV
        byte), slow tiers, contended links, and short prefixes where absolute
        savings are only milliseconds.
`)}
<p>A general rule: offload wins when <code>bytes_per_token ÷ tier_bandwidth + overhead_per_token</code> is smaller than <code>1 ÷ prefill_tokens_per_second</code>. Models with GQA or MLA have few KV bytes per FLOP and benefit most; the bandwidth must be <b>measured</b> on your hardware with concurrent decode traffic, because offload shares PCIe and NVMe with weight loading and other I/O.</p>

<h3>3.3 Capacity sizing</h3>
${formula(`
70B shape, 320 KiB per token; one p5.48xlarge-class node
(2,048 GiB host RAM; 8 × 3,800 GB local NVMe per AWS specs)

CPU tier: reserve 1,000 GiB of host RAM for KV
  tokens = 1,000 × 2³⁰ B ÷ 327,680 B = 3,276,800 tokens ≈ 3.28 M
  8,192-token prefixes ≈ 3,276,800 ÷ 8,192 = 400

NVMe tier: use 25 TB of the 30.4 TB raw
  tokens = 25×10¹² ÷ 327,680 ≈ 76.3 M tokens ≈ 9,300 prefixes of 8,192

HBM tier for comparison: 8 × 80 GB = 640 GB; weights ≈ 141 GB; suppose 200 GB is
  left for cached (not live) blocks → 200×10⁹ ÷ 327,680 ≈ 0.61 M tokens ≈ 74 prefixes

ANSWER  DRAM adds ~5× and NVMe ~125× the warm-prefix capacity of HBM on this node.
`)}

${tenQ('CPU / SSD KV offload',[
 'Long prefixes evicted from HBM under load must be re-prefilled; HBM holds only a few dozen long prefixes per node.',
 'On the serving node: host DRAM (pinned memory) and local NVMe, attached to the engine through a KV connector.',
 'KV blocks (same tensors as in HBM, per TP shard), keyed by the engine’s block hashes, plus small metadata.',
 'On a prefix lookup miss in HBM, remaining block hashes are found in lower tiers and loaded asynchronously before prefill continues.',
 'Host DRAM and NVMe capacity: tokens × KV bytes per token; plus pinned-memory staging buffers.',
 'LRU eviction per tier, model or engine restart (unless the cache runs as a separate daemon, as LMCache can), model version change (hash/extras differ), salt differences.',
 'Load ≈ milliseconds vs recompute ≈ hundreds of ms for long prefixes on large models; lowers TTFT and prefill GPU time; costs DRAM/NVMe and PCIe bandwidth.',
 'Tail latency worse than recompute when tiers are contended; SSD wear from constant writes; KV for sensitive prompts persisted on disk (encrypt, wipe on node recycle).',
 'Hit tokens per tier, load latency p50/p99 per tier, bytes written per second (SSD wear), TTFT by hit tier, fallback-to-recompute count.',
 'Per-node cache: grows hit rates for sticky workloads; combine with cache-aware routing; node replacement (spot, Karpenter consolidation) drops the tier contents.'
])}

<h3>3.4 Distributed (remote) KV pools</h3>
<p>A remote pool lets any replica load blocks computed by any other: a shared document prefix computed once in the fleet can serve all replicas. The pool can be a cache daemon cluster (LMCache with Redis/Valkey, InfiniStore or Mooncake backends), an RDMA-connected memory pool (Mooncake), or object storage for very cold data. LMCache also supports reusing KV for non-prefix positions (CacheBlend), with selective recomputation to recover quality — a newer, less mature technique than exact prefix reuse.</p>
${formula(`
Remote load of one 8,192-token prefix (2.5 GiB, 70B shape)

Over a 400 Gb/s RDMA link ≈ 50 GB/s:     2.684×10⁹ ÷ 50×10⁹  ≈ 54 ms
Over a 100 Gb/s TCP link at 70 % ≈ 8.75 GB/s:  ÷ 8.75×10⁹ ≈ 307 ms
Recompute (from 3.2):                                         ≈ 370 ms

ANSWER  A remote pool needs RDMA-class networking to beat recomputation
        clearly for this shape; over ordinary TCP it barely breaks even.
`)}
${tenQ('distributed / remote KV pool',[
 'Each replica recomputing prefixes another replica already computed; per-node tiers that vanish with the node.',
 'A shared service across serving nodes (cache daemons, RDMA memory pool, object storage), reached through a KV connector and transfer library (e.g. NIXL).',
 'KV blocks keyed by content hash (model, layer layout and TP sharding must be compatible), plus an index of where blocks live.',
 'Lookup by block hash after local tiers miss; transfer over the network into HBM.',
 'Pool memory/disk across many machines; index metadata; network buffers.',
 'Pool-level eviction (LRU/TTL), model version change, incompatible parallelism layout, explicit purge.',
 'Fleet-wide reuse; benefit depends on network bandwidth versus prefill throughput; adds a network dependency to TTFT.',
 'Network contention with training or collective traffic; a pool outage turning into TTFT spikes (must fall back to recompute); cross-tenant sharing unless salted; data-at-rest exposure of prompt-derived tensors.',
 'Remote hit tokens, transfer latency and throughput, pool memory usage and eviction rate, fallback count.',
 'Behaves like a distributed cache: partition by hash, replicate hot blocks, keep it regional (cross-region KV transfer rarely beats recompute).'
])}

<h3>3.5 Cache-aware routing</h3>
${anim('v2-cache-routing')}
<p>A router needs two inputs per replica: <b>how much of this prompt it already holds</b> (overlap) and <b>how busy it is</b>. NVIDIA Dynamo’s KV router (v1.5.1) combines them in a cost and picks the lowest:</p>
${formula(`
cost(worker) = prefill_load_scale × adjusted_prefill_blocks
             + potential_decode_blocks
             + active_request_blocks

adjusted_prefill_blocks = max(0, active_prefill_blocks
                                 + incoming_prompt_blocks
                                 − overlap_credit_blocks)
                                   ↑ blocks of this prompt already cached on the worker

active_request_blocks = decode_active_request_weight × active_requests   (weight default 0)
defaults: --router-prefill-load-scale 1, --router-kv-overlap-score-credit 1.0,
          --router-temperature 0 (deterministic; > 0 samples from a softmax over costs)
`)}
<p>llm-d’s Router (proxy + endpoint picker, conformant with the Gateway API Inference Extension) scores pods with pluggable scorers — prefix-cache affinity, queue depth, KV utilisation — and can predict latency with a trained model; the SGLang router and Ray Serve’s <code>PrefixCacheAffinityRouter</code> follow the same idea. The upstream Gateway API Inference Extension v1.6 moved its full-featured endpoint picker into llm-d and now ships a lightweight one for conformance.</p>
<p><b>How the router knows what is cached.</b> Approximate: the router remembers which prefixes it sent where (cheap, wrong after evictions). Exact: engines publish KV events (block stored, block removed) to the router’s index (accurate, adds an event stream per replica). Dynamo’s router keeps a KV indexer fed by worker events.</p>

${tenQ('cache-aware routing',[
 'Random or least-loaded routing scatters prefixes across replicas, so prefix hit rates fall as the fleet grows.',
 'In the inference router / endpoint picker in front of a model pool (after the AI gateway).',
 'An index of which block hashes (or prefixes) each replica holds, plus live load metrics; no KV itself.',
 'Each request is routed to the replica with the lowest combined cost of uncached prefill and current load.',
 'Router memory for the prefix index (hashes × replicas); event-stream throughput for exact indexes.',
 'Engine evictions (exact indexes update on events; approximate ones drift), replica restarts, scale-in.',
 'Raises fleet hit rate and lowers TTFT and prefill GPU time; costs a few ms of routing and some load imbalance.',
 'Hot spots from too much affinity; stale index sending requests to replicas that evicted the prefix; router as a single point of failure.',
 'Fleet token hit rate vs per-replica hit rate, per-replica queue time spread, TTFT p95, routing decision latency, index staleness.',
 'Essential beyond a handful of replicas; scale the router horizontally with a shared or sharded index; combine with autoscaling so new replicas warm up gradually.'
])}

<h2>4. Where does it fit?</h2>
${fig('Fleet-level KV architecture', svgDiagram({w:900,h:330,
 zones:[{x:250,y:10,w:640,h:200,label:'Model pool (one region)'},{x:250,y:220,w:640,h:100,label:'Shared KV pool (optional)',cls:'ok'}],
 boxes:[
  {id:'gw',x:10,y:90,w:100,h:56,label:'AI gateway'},
  {id:'rt',x:130,y:90,w:110,h:56,label:'KV-aware router',cls:'hl'},
  {id:'r1',x:270,y:40,w:190,h:150,label:'Replica 1',sub:'HBM → DRAM → NVMe'},
  {id:'r2',x:480,y:40,w:190,h:150,label:'Replica 2',sub:'HBM → DRAM → NVMe'},
  {id:'r3',x:690,y:40,w:190,h:150,label:'Replica 3',sub:'HBM → DRAM → NVMe'},
  {id:'pool',x:400,y:245,w:330,h:56,label:'Remote KV store',sub:'RDMA / NIXL',cls:'v2'}
 ],
 arrows:[{from:'gw',to:'rt',cls:'hl'},{from:'rt',to:'r1',cls:'hl'},{from:'r1',to:'pool',cls:'dash',both:true},{from:'r2',to:'pool',cls:'dash',both:true},{from:'r3',to:'pool',cls:'dash',both:true},{from:'r3',to:'rt',cls:'dash',label:'KV events',fromSide:'top',toSide:'top'}]
}), 'Each replica has local tiers; a shared pool is optional and needs fast networking. KV events keep the router’s index exact.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Engine block manager and connector API</b>: offload and remote pools are engine plugins; versions of engine and connector must match.</li>
<li><b>Prefill/decode disaggregation</b>: the same transfer libraries (NIXL, Mooncake) move KV from prefill to decode workers; a remote pool can serve both.</li>
<li><b>Autoscaler</b>: new replicas start cold; routers should warm them gradually. Scale-in destroys local tiers; prefer removing replicas with the least unique hot state.</li>
<li><b>Kubernetes</b>: pinned host memory and NVMe must be requested and isolated (hostPath or local PVs, memory requests large enough for the DRAM tier).</li>
<li><b>Security</b>: offloaded KV is prompt-derived data at rest; tenant salts apply to offloaded blocks too.</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Area','Decision'],[
 ['Tier sizes','DRAM and NVMe budgets per node; leave host RAM for the OS, the engine and weight loading'],
 ['Admission thresholds','Minimum prefix length to offload; maximum acceptable load latency before falling back to recompute'],
 ['Disk hygiene','Separate NVMe for KV from model weights and logs; encrypt; wipe on node termination'],
 ['Router config','Overlap credit vs load weights; temperature; exact (events) vs approximate index'],
 ['Networking','RDMA/EFA for remote pools; keep KV traffic off links used by training collectives'],
 ['Rollouts','Engine, connector and router versions upgraded together; canary with hit-rate and TTFT gates']
])}
${callout('devops','DevOps bridge','Cache-aware routing is consistent hashing plus least-connections, done dynamically: like Envoy’s ring-hash load balancer with outlier detection, except the "hash" is a prefix of tokens, the server-side state changes every second, and the weights trade cache benefit against queue time.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['TTFT p99 worse after enabling SSD offload','NVMe contended by weight loading or logs; slow loads','Per-tier load latency, disk utilisation','Dedicated NVMe, latency-based fallback to recompute, raise min prefix length'],
 ['One replica overloaded, others idle','Affinity weight too high for a viral prefix','Queue-time spread, per-replica hit rate','Increase load weight, router temperature &gt; 0, replicate hot prefix'],
 ['Hit rate drops after scale-out','New replicas cold; router spreading load','Hit rate by replica age','Gradual warm-up; remote pool'],
 ['Requests hang intermittently with remote KV','Transfer timeouts, RDMA path or discovery issues','Connector logs, NIXL/transport errors','Timeouts with recompute fallback; check fabric health'],
 ['Host OOM on serving node','DRAM tier sized without headroom','Node memory, OOM kills','Reduce tier size; set container memory accordingly'],
 ['Router sends to replicas that no longer hold prefixes','Approximate index drift after evictions','Predicted vs actual hit tokens','Switch to event-fed index or shorten TTL of routing hints']
])}

<h2>8. How do we scale it?</h2>
<ul>
<li>Scale <b>out</b> replicas with cache-aware routing so each replica specialises; the effective cache is the union of replicas’ HBM, not one copy each.</li>
<li>Scale <b>down</b> the tiers: DRAM first (fast, sizeable), NVMe for long-tail reuse, remote pools only with RDMA-class networks.</li>
<li>Scale the <b>router</b> horizontally; shard the prefix index by hash if it grows.</li>
<li>Keep caches <b>regional</b>; cross-region KV movement almost never beats recomputation.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Illustrative fleet: 16 replicas of a 70B model, one 8-GPU node (TP=8) each.
Workload: 40 % of prompt tokens belong to long shared prefixes.

Before (random routing, HBM only): measured token hit rate      = 12 %
After  (KV-aware routing + DRAM tier): measured token hit rate  = 34 %

Prefill share of GPU time (measured)                            = 40 %
GPU time saved = 0.40 × (0.34 − 0.12) = 0.40 × 0.22             = 8.8 %
Replicas needed for the same load ≈ 16 × (1 − 0.088) ≈ 14.6     → 15 (round up)

ANSWER  About one node saved out of 16, plus better TTFT. Worth it when nodes
        cost tens of dollars per hour; not worth a remote KV pool on TCP.
`)}

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Should the router send a request to the replica with the prefix cached, or to the least-loaded replica?”','<p><i>Answer (≈45 s):</i> "Neither rule alone. I estimate time to first token on each candidate as queue wait plus prefill of the uncached part. In an example with an 8k prompt, a replica holding 6k tokens with a 300 ms queue beats an idle cold replica, 428 against 552 ms, but once its queue reaches 600 ms the cold one wins and the prefix gets replicated. Production routers like Dynamo’s KV router and llm-d’s endpoint picker encode this as a cost: uncached prefill blocks after overlap credit plus decode load. I’d tune the weights against TTFT p95 and per-replica queue spread, and use KV events so the index stays accurate after evictions."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Use sticky sessions so the cache always hits."</p><p>Creates hot spots and ignores eviction.</p></div><div class="good"><h4>Strong answer</h4><p>Computes both terms, shows the crossover, names real cost functions and index mechanisms, and states what to measure.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['HBM eviction','DRAM tier','NVMe tier','load vs recompute','TTFT'])}
${chain(['Prefix index','router cost','replica choice','fleet hit rate','GPUs needed'])}
<p>Next: ${L('v2-rag-weight-cache','retrieval, embedding and weight caching')}. For KV moving between prefill and decode pools, see ${L('v2-distributed-inference','distributed inference')}.</p></div>
`,
  quiz:[
    {q:'With TP=8 on a 70B shape, how much KV must EACH GPU load per token from the CPU tier?',options:['320 KiB','40 KiB','2.5 GiB','128 KiB'],answer:1,explain:'KV is sharded by KV heads across tensor-parallel ranks: 320 KiB ÷ 8 = 40 KiB per GPU per token, loaded in parallel.'},
    {q:'When is loading KV from a remote pool LEAST likely to beat recomputation?',options:['Large model, long prefix, RDMA network','Small model, short prefix, contended TCP network','Large model, long prefix, local DRAM','Any time the prefix is shared'],answer:1,explain:'Small models need few FLOPs per KV byte, short prefixes save little, and slow networks make transfer expensive.'},
    {q:'In Dynamo’s KV router cost, what does overlap_credit_blocks represent?',options:['Blocks the worker already has cached for this prompt, subtracted from prefill work','Blocks reserved for decode','Blocks offloaded to SSD','Blocks owned by other tenants'],answer:0,explain:'Cached overlap reduces the prefill blocks a worker must compute, lowering its cost.'},
    {q:'After enabling NVMe offload, TTFT p99 got worse. The most likely cause is…',options:['Prefix hashes changed','Contended or slow NVMe loads exceeding recompute time','The router is disabled','FP8 KV cache'],answer:1,explain:'If tier loads are slower than recompute (contention with weight loading or logs), offload hurts tail latency. Fall back to recompute above a latency threshold.'},
    {q:'1,000 GiB of DRAM holds how many tokens of KV at 320 KiB/token?',options:['≈ 328,000','≈ 3.28 million','≈ 32.8 million','≈ 3,200'],answer:1,explain:'1,000 × 2³⁰ ÷ (320 × 2¹⁰) = 3,276,800 tokens.'}
  ],
  flashcards:[
    {front:'Offload rule of thumb',back:'Wins when bytes_per_token ÷ tier bandwidth + overhead < 1 ÷ prefill tokens/s. Large models, long prefixes, fast tiers win most.'},
    {front:'70B-shape transfer vs recompute (8k prefix)',back:'DRAM load ≈ 13 ms (40 KiB/GPU/token at 25 GB/s) vs recompute ≈ 370 ms (2 × 70.6B FLOPs/token at 40 % of 8 × 989 TFLOPS). Assumptions labelled.'},
    {front:'vLLM KV connectors',back:'--kv-transfer-config with LMCacheConnectorV1, LMCacheMPConnector, NixlConnector, MooncakeConnector, OffloadingConnector, MultiConnector, FlexKVConnectorV1, …'},
    {front:'Dynamo KV router cost (v1.5.1)',back:'prefill_load_scale × max(0, active_prefill + incoming − overlap_credit) + potential_decode_blocks + weight × active_requests; lowest wins.'},
    {front:'Exact vs approximate prefix index',back:'Exact: engines publish block stored/removed events. Approximate: router remembers its own routing decisions; drifts after evictions.'},
    {front:'LMCache',back:'KV cache management layer; tiers CPU RAM, local disk, Redis/Valkey, Mooncake, InfiniStore, S3-compatible, NIXL, GDS; can run as a standalone daemon; CacheBlend for non-prefix reuse.'}
  ]
});
registerGlossary([
  {term:'KV offload',def:'Copying KV-cache blocks from GPU HBM to CPU memory or SSD so they can be loaded back instead of recomputed.',lesson:'v2-distributed-kv',aliases:['KV cache offloading','KV tiering']},
  {term:'Cache-aware routing',def:'Routing each inference request to the replica that minimises a cost combining uncached prefill (after prefix overlap) and current load.',lesson:'v2-distributed-kv',aliases:['KV-aware routing','prefix-aware routing']},
  {term:'LMCache',def:'An open-source KV cache management layer that stores and shares KV across GPU, CPU, disk and remote backends for engines such as vLLM.',lesson:'v2-distributed-kv'},
  {term:'KV connector',def:'vLLM plug-in interface (configured with --kv-transfer-config) that moves KV blocks to and from external tiers, pools or other workers.',lesson:'v2-distributed-kv'},
  {term:'KVBM',def:'NVIDIA Dynamo’s KV Block Manager, which manages KV blocks across memory tiers.',lesson:'v2-distributed-kv',aliases:['KV Block Manager']},
  {term:'Mooncake',def:'A KV-cache-centric serving architecture and transfer/store system used as a KV connector backend for disaggregated serving and remote KV pools.',lesson:'v2-distributed-kv'}
]);

/* ======================= 2.2.5 RAG retrieval, embedding and model-weight caching ======================= */
registerLesson({
  id:'v2-rag-weight-cache', vol:2, part:2, num:5,
  title:'RAG retrieval caching, embedding caching and model-weight caching', minutes:85,
  summary:'Not all expensive work in an AI platform happens in the language model. Retrieval runs searches and rerankers; ingestion and queries run embedding models; every new GPU pod must load tens or hundreds of gigabytes of weights; and the GPU framework itself caches memory blocks. This lesson covers the four caches that live outside the LLM’s attention: the retrieval result cache, which must respect index versions and permissions; the embedding cache, which is exact and keyed by content hash and model version; the model-weight cache, which decides how fast you can scale; and the GPU caching allocator, which explains why memory numbers look the way they do.',
  objectives:[
    'Answer the ten caching questions for retrieval result caches, embedding caches, model-weight caches and the GPU caching allocator.',
    'Design retrieval cache keys that include index version and ACL scope, and explain how permission diversity fragments hit rates.',
    'Size an embedding cache and calculate the re-embedding work it avoids on incremental ingestion.',
    'Calculate cold-start time with and without node-local weight caches and choose a weight distribution strategy on Kubernetes.',
    'Read PyTorch allocated versus reserved memory and explain engine pre-allocation.'
  ],
  prereqs:['v2-cache-map','v2-rag-fundamentals','v1-k8s-serving','v1-gpu-memory'],
  next:['v2-cache-ops','v2-rag-production','v1-k8s-autoscaling','v2-hyperscale-serving'],
  tags:['caching','rag','embeddings','cold-start','kubernetes'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A research library: the librarian remembers which shelf numbers answered a common question (retrieval cache), keeps index cards already written for every book (embedding cache), stocks popular books in the branch instead of ordering them from the central store each time (weight cache), and reuses empty shelves instead of building new ones (allocator). Now the real mechanisms.')}
${table(['Cache','Plane','Key','Value','Exact?'],[
 ['<b>Retrieval result cache</b>','Knowledge','normalised query + index version + ACL scope + retrieval params','ordered chunk ids + scores','Exact on its key, but its value goes stale when documents or permissions change'],
 ['<b>Embedding cache</b>','Knowledge','content hash + embedding model + version + params','vector','Yes: same text and model give the same vector'],
 ['<b>Model-weight / artifact cache</b>','Infrastructure','model id + revision (+ digest)','weight files, tokenizer, configs, compiled artifacts','Yes, if integrity is verified'],
 ['<b>GPU caching allocator</b>','Framework','allocation size class','freed GPU memory blocks','Not a data cache; a memory-reuse cache']
])}

<h2>2. Why do we need it?</h2>
<ul>
<li><b>Retrieval latency is on the TTFT path.</b> Embed + hybrid search + rerank is often 100–200 ms (${L('v2-platform-architecture','latency budget')}); popular queries repeat.</li>
<li><b>Re-embedding is the hidden ingestion cost.</b> Nightly pipelines that re-embed every chunk waste GPU hours on unchanged text.</li>
<li><b>Cold starts cap autoscaling.</b> A replica that needs 5–10 minutes to download and load weights cannot absorb a burst; you must keep idle GPUs warm instead, which is expensive.</li>
<li><b>Memory numbers confuse on-call engineers.</b> Without understanding allocator caching and engine pre-allocation, "92 % GPU memory used" looks like a leak.</li>
</ul>

<h2>3. How does it work internally?</h2>
<h3>3.1 Retrieval result cache</h3>
<p>The retrieval pipeline (${L('v2-rag-fundamentals','RAG fundamentals')}) is: embed query → vector search and keyword search with ACL filters → fuse → rerank → top-k chunks. A retrieval cache stores the <b>output ids and scores</b> for a key, so a repeated query skips search and rerank.</p>
<p>Three rules make it safe:</p>
<ol>
<li><b>Store ids, not text.</b> On a hit, fetch chunk text from the document store and <b>re-check authorisation per chunk</b>. The cache accelerates search; it never grants access.</li>
<li><b>Key includes the index version.</b> Every index update (new chunks, deletions) bumps a version; old entries become unreachable. Purge by document tag too, for faster freshness.</li>
<li><b>Key includes the ACL scope, not the user.</b> Results depend on what the user can see. Keying by user id kills the hit rate; keying by a hash of the user’s <i>ACL groups relevant to this corpus</i> lets users with the same entitlements share entries.</li>
</ol>
${formula(`
ACL fragmentation: why hit rates fall with permission diversity (illustrative)

Query distribution: a popular query is asked 1,000 times per hour
Users spread across G distinct ACL-group hashes for this corpus

Expected requests per (query, ACL hash) per hour ≈ 1,000 ÷ G
  G = 1     → 1,000 per key   → hit rate ≈ 99.9 % (1 miss per TTL window)
  G = 50    →    20 per key   → hit rate ≈ 95 %   (1 miss in 20)
  G = 1,000 →     1 per key   → hit rate ≈ 0 %

ANSWER  Design ACL scopes coarsely for caching (department, role), not per user,
        and cache only public or broadly shared corpora at first.
`)}
${tenQ('retrieval result cache',[
 'Repeated vector search, keyword search and reranking for the same query, which adds ~100–200 ms to TTFT and load to the vector DB.',
 'Knowledge plane, in or beside the retrieval service; usually Redis/Valkey.',
 'Ordered chunk ids, scores, index version and dependency tags (document ids and versions); not chunk text.',
 'Exact key match on (normalised query, index version, ACL-scope hash, top-k, filters, reranker version); chunk text re-fetched and re-authorised on every hit.',
 'Entries × (≈ 64 B key + k × (id ≈ 16 B + score 4 B) + overhead): 1 M entries with k = 20 ≈ 1 M × 564 B ≈ 0.56 GB.',
 'Index version bump, document update or delete (tag purge), ACL change (scope hash changes; read-time check catches the rest), reranker or embedding model change, TTL.',
 'Hit: ~2 ms instead of ~150 ms; reduces vector DB and reranker GPU load. Miss: ~1 ms extra.',
 'Returning chunks the user may no longer see (if read-time authorisation is skipped); stale results after document updates; low hit rate from per-user keys.',
 'Hit ratio by corpus and ACL scope, saved search time, purge lag, number of chunks dropped by read-time authorisation on hits (should be near zero; if not, keys are too coarse).',
 'Hit rate falls with ACL diversity and corpus churn; regional caches need purge events; large tenants may need dedicated cache capacity.'
])}

<h3>3.2 Embedding cache</h3>
<p>Embedding a given text with a given model and settings always gives the same vector (up to numerical noise), so this cache is exact and safe. The key is a <b>content hash</b> of the exact text sent to the encoder plus the model identity and settings that change the output (model name, revision, dimensions if truncated, normalisation, instruction prefix such as "query:" vs "passage:").</p>
${code('python',`import hashlib

def embedding_key(text, model_id, model_rev, dims, kind):
    # kind is "query" or "passage": many models embed them differently
    h = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return f"emb:{model_id}@{model_rev}:d{dims}:{kind}:{h}"`)}
${formula(`
Corpus: 2,000,000 documents × 20 chunks = 40,000,000 chunks, 1,024 dims, float16

Embedding cache size = 40,000,000 × 1,024 × 2 B = 81.92 GB  (+ keys ≈ 40 M × 100 B = 4 GB)

Nightly re-ingest where 3 % of chunks changed:
  without cache: embed 40,000,000 chunks
  with cache:    embed 40,000,000 × 0.03 = 1,200,000 chunks

At an assumed, measured 5,000 chunks/s per GPU:
  without: 40,000,000 ÷ 5,000 = 8,000 s ≈ 2.2 GPU-hours per night
  with:     1,200,000 ÷ 5,000 =   240 s ≈ 4 GPU-minutes per night

ANSWER  ≈ 97 % less embedding compute. The vectors already live in the vector
        index; the cache can be the index itself if it stores content hashes.
`)}
${tenQ('embedding cache',[
 'Re-running the encoder on unchanged chunks during re-ingestion, and on repeated identical queries.',
 'Ingestion pipeline and query path of the knowledge plane; a key-value store, or content-hash columns in the vector store.',
 'Vectors keyed by content hash + embedding model id/revision + dims + query/passage mode.',
 'Exact lookup before calling the encoder; on a hit, reuse the vector.',
 'Chunks × dims × bytes (e.g. 40 M × 1,024 × 2 B ≈ 82 GB); query embedding caches are small and short-lived.',
 'Embedding model upgrade (all keys change: plan a full re-embed and dual-index cut-over), chunking change (texts change), text change (new hash).',
 'Ingestion cost and time drop in proportion to the unchanged fraction; query embeddings cached save ~10–30 ms each.',
 'Mixing vectors from two model versions in one index (silently bad retrieval); keeping vectors of deleted sensitive documents (erasure obligations); embeddings can leak information about their text.',
 'Hit ratio during ingestion, re-embedded chunk count per run, model version distribution inside the index (must be one).',
 'Scales with corpus size; model upgrades are the expensive event: budget a full re-embed and an index swap.'
])}

<h3>3.3 Model-weight and artifact cache</h3>
<p>A serving pod starts by fetching weights (safetensors shards), tokenizer and configs, then loads them into GPU memory, possibly compiles kernels or captures CUDA graphs, and only then becomes ready. Weight caching attacks the fetch step; the load and warm-up steps remain.</p>
${formula(`
Cold start for a 70B model in BF16: 70.6 × 10⁹ × 2 B ≈ 141 GB of weights

Fetch from object storage at an assumed 1.5 GB/s per pod:  141 ÷ 1.5 ≈ 94 s
Read from node-local NVMe at an assumed 6 GB/s:            141 ÷ 6   ≈ 24 s
Second pod on the same node, files in OS page cache:       limited by
   host-to-GPU copy, not disk (often seconds to low tens of seconds)

Scale-out of 10 replicas at once from object storage:
   10 × 141 GB = 1.41 TB pulled concurrently → shared bucket/network limits
   can stretch each pull well beyond 94 s

ANSWER  Cache weights on nodes (or in a nearby cache tier) before the burst;
        it shortens the part of cold start you can control and lets you keep
        fewer warm idle replicas. Measure each phase separately.
`)}
<p>Options on Kubernetes, from simplest:</p>
${table(['Strategy','How','Trade-off'],[
 ['Download on start (no cache)','initContainer pulls from S3/GCS/HF to an emptyDir','Simple; slowest; every pod pays full fetch'],
 ['Node-local cache','hostPath or local PV on NVMe, filled by a DaemonSet pre-puller; pods mount read-only','Fast restarts; needs eviction and version cleanup per node'],
 ['Shared filesystem','ReadOnlyMany PVC on a network filesystem (EFS, Filestore, FSx for Lustre)','One copy for the fleet; throughput limited by the filesystem'],
 ['Image volumes (OCI artifacts)','Kubernetes <code>image</code> volume source mounts an OCI image or artifact read-only (stable since Kubernetes v1.36)','Reuses registry, signing and node image caching; large artifacts stress registries and node disk'],
 ['Weights in the container image','Bake weights into the serving image','Simple versioning; very large images, slow pulls, every code change re-pushes weights']
])}
${callout('warn','Integrity is part of caching','A cached weight file is code-adjacent: a tampered file changes model behaviour, and pickle-based formats can execute code on load. Prefer safetensors, pin revisions by commit hash or digest, verify signatures (Sigstore cosign for blobs or the OpenSSF model-signing tool) before a file enters the cache, and never set <code>trust_remote_code</code> without pinning and review.')}
${tenQ('model-weight / artifact cache',[
 'Long cold starts (downloading 10s–100s of GB) that slow autoscaling and recovery, and repeated egress from object storage.',
 'Node-local NVMe, shared filesystems, container/OCI image layers, regional object-storage mirrors; OS page cache on the node.',
 'Weight shards (safetensors), tokenizer, configs, LoRA adapters, compiled engine artifacts, keyed by model id + revision + digest.',
 'Pods mount or copy from the cache instead of fetching from origin; same version → same files.',
 'Disk: sum of cached model versions per node (e.g. 141 GB per 70B BF16 version); page cache uses host RAM opportunistically.',
 'New model revision (new key), digest mismatch, disk pressure eviction, node replacement.',
 'Fetch time from ~minutes to ~tens of seconds; fewer warm idle GPUs needed; less egress and registry load.',
 'Serving a wrong or tampered version; disk filling with old versions; thundering herd on origin during mass scale-out; cache poisoning via unsigned artifacts.',
 'Pod startup broken down into fetch, load to GPU, warm-up; cache hit per node; disk usage; origin throughput during scale events.',
 'Pre-stage popular models on GPU node pools; regional mirrors per region; lifecycle policy for old revisions; signature verification at fill time.'
])}

<h3>3.4 GPU memory caching allocator</h3>
<p>Calling <code>cudaMalloc</code> and <code>cudaFree</code> for every tensor would be slow and would synchronise the device. PyTorch therefore uses a <b>caching allocator</b>: freed tensor memory goes back to a PyTorch-managed pool and is reused for later allocations of fitting sizes, without returning it to the driver. Consequences:</p>
<ul>
<li><code>torch.cuda.memory_allocated()</code> = bytes held by live tensors; <code>torch.cuda.memory_reserved()</code> = bytes held by the allocator (live + cached free blocks). <code>nvidia-smi</code> shows roughly reserved memory plus the CUDA context, so it looks "full" after peaks.</li>
<li><code>torch.cuda.empty_cache()</code> returns cached free blocks to the driver; it frees no live tensors and does not fix a real leak.</li>
<li>Fragmentation: many different sizes can leave reserved-but-unusable gaps; <code>PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True</code> reduces this for variable-size workloads. <code>torch.cuda.memory_summary()</code> shows the breakdown.</li>
<li>Inference engines go further: vLLM pre-allocates a fraction of GPU memory (<code>--gpu-memory-utilization</code>, default 0.92) at startup, loads weights, profiles activation needs and turns the rest into KV blocks it manages itself. High <code>nvidia-smi</code> memory on an idle vLLM pod is by design; watch <code>vllm:kv_cache_usage_perc</code> instead.</li>
</ul>
${tenQ('GPU caching allocator',[
 'The latency and synchronisation cost of returning memory to and requesting it from the CUDA driver for every tensor.',
 'Inside the framework (PyTorch) or engine process, on each GPU.',
 'Free GPU memory segments and blocks, grouped by size; no user data meaning.',
 'Later allocations of fitting size reuse cached blocks without a driver call.',
 'Reserved minus allocated memory; fragmentation can make reserved memory much larger than live tensors.',
 'empty_cache(), process exit; engines that pre-allocate keep memory for their lifetime.',
 'Faster allocation; but memory appears "used" to other processes on the same GPU and to nvidia-smi.',
 'Misdiagnosed leaks; OOM from fragmentation despite free reserved memory; two processes on one GPU starving each other.',
 'memory_allocated vs memory_reserved, memory_summary(), DCGM framebuffer used; for vLLM, KV usage metrics.',
 'Matters for GPU sharing (MIG, time-slicing): each process’s reservation must fit its slice; set engine memory fractions explicitly when sharing.'
])}

<h2>4. Where does it fit?</h2>
${fig('Knowledge-plane and infrastructure caches', svgDiagram({w:900,h:300,
 zones:[{x:10,y:10,w:560,h:280,label:'Knowledge plane'},{x:580,y:10,w:310,h:280,label:'Serving node'}],
 boxes:[
  {id:'q',x:30,y:40,w:120,h:50,label:'Query'},
  {id:'qe',x:170,y:40,w:160,h:50,label:'Query embedding',sub:'emb cache',cls:'hl'},
  {id:'rc',x:350,y:40,w:200,h:50,label:'Retrieval cache',sub:'ids by index + ACL ver',cls:'hl'},
  {id:'vs',x:350,y:130,w:200,h:50,label:'Vector + keyword search'},
  {id:'auth',x:350,y:220,w:200,h:50,label:'Fetch text + re-authorise'},
  {id:'ing',x:30,y:150,w:160,h:50,label:'Ingestion'},
  {id:'ec',x:30,y:220,w:160,h:50,label:'Embedding cache',sub:'content hash',cls:'hl'},
  {id:'wc',x:600,y:40,w:270,h:50,label:'Weight cache (NVMe / image volume)',cls:'hl'},
  {id:'gpu',x:600,y:130,w:270,h:50,label:'GPU: weights + KV'},
  {id:'alloc',x:600,y:220,w:270,h:50,label:'Caching allocator / pre-allocation'}
 ],
 arrows:[{from:'q',to:'qe'},{from:'qe',to:'rc'},{from:'rc',to:'vs',label:'miss'},{from:'vs',to:'auth'},{from:'rc',to:'auth',cls:'dash',label:'hit',fromSide:'right',toSide:'right'},{from:'ing',to:'ec'},{from:'ec',to:'vs',cls:'dash',label:'vectors'},{from:'wc',to:'gpu',label:'load'},{from:'gpu',to:'alloc',cls:'dash'}]
}), 'Every retrieval path — hit or miss — ends in fetching text and re-authorising. The weight cache feeds the GPU; the allocator manages what is inside it.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Change data capture</b> from document stores and the IdP drives purges of retrieval caches and re-embedding (${L('v2-cache-ops','invalidation')}).</li>
<li><b>Vector index</b> versions and embedding model versions must move together; the retrieval cache keys on both.</li>
<li><b>Autoscaler</b>: weight-cache hit rate sets cold-start time, which sets how far ahead KEDA or HPA must scale (${L('v1-k8s-autoscaling','GPU autoscaling')}, ${L('v2-hyperscale-serving','warm-up and cold starts')}).</li>
<li><b>Supply chain</b>: the weight cache is filled only from verified artifacts (${L('v2-ai-threat-model','AI threat model')}).</li>
<li><b>GPU sharing</b>: allocator behaviour determines whether several processes can share one GPU (${L('v1-k8s-gpu-stack','GPU stack')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Cache','You own'],[
 ['Retrieval','Key schema with index version and ACL scope; Redis sizing; purge consumers; read-time authorisation is non-negotiable'],
 ['Embedding','Content-hash columns or KV store; model-version migration runbook (dual index, backfill, cut-over)'],
 ['Weights','Pre-puller DaemonSets or image volumes; per-node disk budgets and cleanup; signature verification; origin rate limits'],
 ['Allocator','Engine memory fractions when sharing GPUs; dashboards that show KV usage, not just framebuffer used']
])}
${callout('devops','DevOps bridge','The weight cache is your container-image cache problem again, with 100× larger artifacts: pre-pull, pin by digest, verify signatures, garbage-collect old versions. Where it differs: a weight load also has a GPU phase (host-to-device copy and warm-up) that no disk cache removes.')}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['Revoked user still sees a document in answers','Retrieval cache hit skipped read-time authorisation','Audit: chunks served after revocation','Enforce per-chunk authorisation on every hit; incident process'],
 ['Retrieval quality dropped after an embedding upgrade','Mixed vector versions in one index','Model version distribution in index','Dual-index cut-over; never mix'],
 ['Retrieval cache hit rate ≈ 0','Per-user keys or very fine ACL scopes','Distinct key count ≈ request count','Coarser ACL-scope hashing'],
 ['Pods stuck in ContainerCreating for minutes during a spike','Weight download from origin; registry or bucket throttling','Pod events, fetch timing','Pre-stage weights, node-local cache, stagger scale-out'],
 ['Node disk full on GPU nodes','Old model revisions never cleaned','Disk usage by model revision','Lifecycle policy in the pre-puller'],
 ['OOM although nvidia-smi showed free memory earlier','Fragmentation or another process’s reservation','memory_summary(), per-process usage','expandable_segments, explicit memory fractions, one engine per GPU or MIG']
])}

<h2>8. How do we scale it?</h2>
<ul>
<li>Retrieval caches scale with query concentration and ACL coarseness; shard by key; regional instances.</li>
<li>Embedding caches scale with corpus size; the expensive event is a model upgrade, so plan it as a migration.</li>
<li>Weight caches scale with nodes × model versions; use regional mirrors and pre-staging for the models in each node pool.</li>
<li>Allocator behaviour scales per GPU; it only matters at fleet level for GPU-sharing policies.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>The biggest money in this lesson is usually the <b>weight cache</b>, indirectly:</p>
${formula(`
Illustrative: to absorb bursts you keep W warm idle replicas because cold start is long.

Cold start 10 min (download from origin) → keep 4 warm spare replicas
Cold start 2 min (node-local cache + pre-staging) → keep 1 warm spare replica

Each replica = one 8-GPU node at an illustrative $55 / hour
Saving = 3 nodes × $55 × 730 hours / month ≈ $120,450 / month

ANSWER  Faster cold starts convert directly into fewer idle GPU nodes.
        (Node price illustrative; use your negotiated rate.)
`)}
<p>Embedding caches save ingestion GPU hours (≈ 97 % in the example above); retrieval caches save vector-DB and reranker capacity and a slice of TTFT.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How do you cache RAG retrieval without leaking documents?”','<p><i>Answer (≈45 s):</i> "I cache ids, not text, and I never let a cache hit skip authorisation: every chunk is re-fetched and checked against the user’s current permissions. The key includes the normalised query, the index version, the reranker version and a hash of the user’s ACL scope for that corpus — coarse enough, like role or department, that users can share entries, because per-user keys kill the hit rate. Entries are tagged with document ids so a document update purges them, and the index version changes on every rebuild. Embeddings I cache by content hash plus model version, which is exact and safe, and a model upgrade means a full re-embed into a new index with a cut-over."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Cache the retrieved chunks in Redis with a short TTL."</p></div><div class="good"><h4>Strong answer</h4><p>Ids not text, read-time authorisation, versioned keys, ACL-scope design for hit rate, tag purges, and a separate exact embedding cache.</p></div></div>

<div class="connections"><h4>How this connects</h4>
${chain(['Document change','CDC event','tag purge','index version','fresh retrieval'])}
${chain(['Weight cache','cold start','warm spares needed','GPU cost'])}
<p>Next: ${L('v2-cache-ops','cache operations')} — invalidation, isolation, security, metrics and the full savings method.</p></div>
`,
  quiz:[
    {q:'What should a retrieval result cache store?',options:['Full chunk text, to skip the document store','Chunk ids and scores; text is fetched and re-authorised on every hit','The final answer','User passwords for ACL checks'],answer:1,explain:'Storing ids lets permissions be re-checked on every hit and keeps document text out of the cache.'},
    {q:'Users of a corpus fall into 1,000 distinct ACL-group hashes and a query is asked 1,000 times per hour. Expected retrieval cache hit rate for that query?',options:['≈ 99.9 %','≈ 95 %','≈ 50 %','≈ 0 %'],answer:3,explain:'About one request per key per hour: almost every request is the first for its key.'},
    {q:'Which change invalidates every entry of an embedding cache?',options:['A new document','An embedding model upgrade','A user permission change','A retrieval cache purge'],answer:1,explain:'Vectors from a different model are not comparable; the model version is part of the key.'},
    {q:'torch.cuda.memory_reserved() is 30 GB and memory_allocated() is 12 GB. What is the 18 GB difference?',options:['Leaked tensors','Free blocks held by PyTorch’s caching allocator','KV cache of other processes','CUDA context only'],answer:1,explain:'Reserved includes cached free blocks; empty_cache() would return them to the driver.'},
    {q:'Why does a faster cold start reduce cost?',options:['GPUs get cheaper','You can keep fewer warm idle replicas for bursts','It reduces token prices','It improves prefix hit rates'],answer:1,explain:'Shorter cold start lets autoscaling react instead of pre-provisioning idle capacity.'}
  ],
  flashcards:[
    {front:'Retrieval cache key',back:'normalised query + index version + ACL-scope hash + top-k/filters + reranker version; value = ids + scores; re-authorise on hit.'},
    {front:'Embedding cache key',back:'content hash + embedding model id/revision + dims + query/passage mode.'},
    {front:'ACL fragmentation',back:'Hit rate falls as requests spread over more (query, ACL-scope) keys; use coarse scopes.'},
    {front:'70B BF16 weight fetch',back:'≈ 141 GB: ~94 s at 1.5 GB/s from object storage vs ~24 s at 6 GB/s from local NVMe (assumed rates).'},
    {front:'Kubernetes image volumes',back:'Mount an OCI image/artifact read-only as a volume (e.g. model weights); stable since Kubernetes v1.36.'},
    {front:'allocated vs reserved',back:'allocated = live tensors; reserved = allocator pool (live + cached free). empty_cache() returns free cached blocks, frees no tensors.'}
  ]
});
registerGlossary([
  {term:'Retrieval result cache',def:'A cache of ranked chunk ids and scores for a query, keyed by query, index version and ACL scope; chunk text is re-fetched and re-authorised on hits.',lesson:'v2-rag-weight-cache',aliases:['retrieval cache']},
  {term:'Embedding cache',def:'An exact cache of vectors keyed by content hash and embedding model version, avoiding re-encoding unchanged text.',lesson:'v2-rag-weight-cache'},
  {term:'Model-weight cache',def:'Node-local or nearby storage of model weight files and artifacts, keyed by model revision, used to shorten cold starts.',lesson:'v2-rag-weight-cache',aliases:['weight cache','artifact cache']},
  {term:'Caching allocator',def:'A framework memory allocator (e.g. PyTorch’s) that keeps freed GPU memory blocks for reuse instead of returning them to the CUDA driver.',lesson:'v2-rag-weight-cache',aliases:['CUDA caching allocator']},
  {term:'ACL scope hash',def:'A hash of the permission groups relevant to a corpus, used in cache keys so users with identical entitlements can share entries.',lesson:'v2-rag-weight-cache'},
  {term:'Index version',def:'A version number of a search index that changes on every update or rebuild and is included in retrieval cache keys.',lesson:'v2-rag-weight-cache'}
]);

/* ======================= 2.2.6 Cache operations ======================= */
registerLesson({
  id:'v2-cache-ops', vol:2, part:2, num:6,
  title:'Cache invalidation, consistency, tenant isolation, security, metrics and cost', minutes:100,
  summary:'A cache is a second copy of the truth, and every second copy can be stale, leak, or lie. This lesson turns the ten caches of an AI platform into something you can operate. It covers how to invalidate when documents and permissions change, what consistency each cache really needs, how to isolate tenants without destroying hit rates, the security risks including timing side channels in shared prompt caches, the exact definitions of hit ratio for each layer, the memory arithmetic, the metrics and alerts to run, and how to calculate savings correctly. The headline rule for cost: avoided prefill tokens are not total tokens times hit rate.',
  objectives:[
    'Choose invalidation mechanisms (TTL, versioned keys, tag purge, event-driven purge, conditional write-back, read-time validation) for each cache.',
    'Write a cache key function that is canonical, versioned, tenant-scoped and safe to log.',
    'Isolate tenants in every cache layer and explain the timing side channel of shared prefix and prompt caches.',
    'Define and monitor the correct hit ratio for each layer, with alerts for hit-rate collapse, purge lag and wrong hits.',
    'Compute cache savings correctly for self-hosted and hosted models, separating prefill, decode and price multipliers.',
    'Run the incident response for a cross-tenant cache leak.'
  ],
  prereqs:['v2-response-semantic-cache','v2-prefix-kv-cache','v2-distributed-kv','v2-rag-weight-cache'],
  next:['v2-finops-optimization','v2-ai-threat-model','v2-ai-observability','v2-governance','v2-capstone-platform'],
  tags:['caching','security','finops','observability','operations'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','A newspaper keeps printed copies in kiosks around the city. When a story is corrected, someone must pull the old copies from every kiosk, make sure no van delivers a pre-correction bundle afterwards, and make sure one subscriber’s private edition never ends up in a public kiosk. Now the real mechanism.')}
<p>Cache operations is the discipline of keeping cached copies <b>correct</b> (invalidation and consistency), <b>private</b> (tenant isolation and security), <b>visible</b> (metrics) and <b>worth it</b> (cost). The previous five lessons described what each cache stores; this one describes how to run them together.</p>

<h2>2. Why do we need it?</h2>
<p>The failure modes of AI caches are worse than those of ordinary web caches:</p>
<ul>
<li>A stale answer is <b>fluent and confident</b>; users cannot tell it is old.</li>
<li>A permission change must take effect <b>immediately</b> — a revoked employee must not keep reading finance documents through a cached retrieval result for an hour.</li>
<li>Shared caches can leak through <b>timing</b>: a faster response reveals that someone else recently sent the same prefix.</li>
<li>Savings are easy to <b>overstate</b>: a token hit rate is not a cost reduction.</li>
</ul>

<h2>3. How does it work internally?</h2>
<h3>3.1 Invalidation</h3>
${anim('v2-cache-invalidation')}
${table(['Mechanism','How it works','Good for','Not enough for'],[
 ['<b>TTL</b>','Entry expires after a fixed time','Bounding staleness of low-risk data; memory hygiene','Permission revocation; urgent corrections'],
 ['<b>Versioned keys</b>','Key includes model, template, index, ACL or schema versions; a bump makes old entries unreachable','Model/template/index changes; ACL changes per user','Selective changes inside one version (one document of thousands)'],
 ['<b>Tag (dependency) purge</b>','Entries carry tags (doc ids + versions); a purge deletes all keys with a tag','Document updates and deletes','Entries written without tags'],
 ['<b>Event-driven purge</b>','CDC or webhook events trigger tag purges and version bumps','Fast freshness (seconds)','Lost or delayed events (needs a TTL backstop)'],
 ['<b>Conditional write-back</b>','Write only if the versions read are still current (compare-and-set on a generation number)','The race where an in-flight request re-inserts stale data after a purge','—'],
 ['<b>Read-time validation</b>','On a hit, re-check authorisation and (cheaply) source versions before serving','Permissions: the only mechanism that guarantees "no access after revocation"','Expensive checks on every hit']
])}
<p>Which caches need which:</p>
${table(['Cache','Invalidation needed'],[
 ['Exact / semantic response','Versioned keys (model, template, ACL) + tag purge on documents + TTL backstop + conditional write-back + read-time authorisation'],
 ['Retrieval result','Index version in key + tag purge + ACL scope in key + read-time per-chunk authorisation'],
 ['Embedding','None for content (content-hash keys); full rebuild on model change'],
 ['Engine prefix / offloaded KV / provider prompt cache','None for content (token-exact); restart or model change clears; LRU/TTL handles memory'],
 ['Model weights','Version keys + digest verification; cleanup of old revisions'],
 ['GPU allocator','Not applicable']
])}
${callout('tip','The race nobody tests','A request reads document v7 at t=0, generation takes 8 s, the editor publishes v8 at t=3 and the purge runs at t=4. At t=8 the request writes its v7-based answer into the cache — after the purge. Fix: store the versions read with the request and write back only if they are still current (Redis WATCH/MULTI or a Lua compare-and-set on a version key).')}

<h3>3.2 Consistency: what each cache really needs</h3>
<ul>
<li><b>Exact-computation caches</b> (prefix, KV tiers, embeddings, weights) are trivially consistent: a hit is the same computation. Their only consistency risk is <i>identity</i> — a key that fails to capture something (tokenizer version, LoRA id, chat template) that changes the computation.</li>
<li><b>Derived-answer caches</b> (response, semantic, retrieval) are eventually consistent with their sources. State the bound as an SLO: "a published document change is reflected in cached answers within 60 s at p99".</li>
<li><b>Permissions</b> need stronger guarantees than content. Enforce them at read time, so cache consistency lag never becomes an access-control lag.</li>
<li><b>Multi-region</b>: purge events must reach every region; use a replicated event stream and measure purge lag per region. Prefer regional caches with global purge over a global cache.</li>
</ul>

<h3>3.3 Cache key design</h3>
${code('python',`import hashlib, hmac, json, unicodedata

KEY_SCHEMA = "rc-v3"   # bump to cut over cleanly when the schema changes

def normalise(text):
    text = unicodedata.normalize("NFKC", text).strip()
    return " ".join(text.split())          # collapse whitespace; keep case, digits, negations

def response_cache_key(secret: bytes, tenant, acl_version, req) -> str:
    material = {
        "schema": KEY_SCHEMA,
        "tenant": tenant,
        "acl": acl_version,                 # changes when the caller's entitlements change
        "model": req["resolved_model"],     # concrete model + revision, never the alias
        "template": req["template_version"],
        "locale": req["locale"],
        "params": {k: req["params"].get(k) for k in ("temperature", "max_tokens", "response_format")},
        "tools": req["tools_hash"],
        "text": normalise(req["user_text"]),
    }
    blob = json.dumps(material, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    digest = hmac.new(secret, blob.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{KEY_SCHEMA}:{tenant}:{digest}"  # tenant prefix enables per-tenant purge and quotas`)}
<p>Design notes:</p>
<ul>
<li><b>Canonical serialisation</b> (sorted keys, fixed separators) so logically equal requests hash equally.</li>
<li><b>HMAC, not a plain hash</b>: an attacker who can read key names cannot test guesses of prompts offline. Rotate the secret by bumping the schema.</li>
<li><b>Resolved model</b>, not the alias: when the alias moves to a new model, old answers stop matching.</li>
<li><b>Document versions</b> are usually not known before retrieval, so they are attached as <b>tags</b> at write time rather than put in the key. If you look up the response cache <i>after</i> retrieval, you can include them in the key instead and skip tag purges — at the cost of always running retrieval.</li>
<li><b>Tenant prefix in clear</b> so you can purge or cap one tenant’s entries; everything else hashed.</li>
</ul>

<h3>3.4 Tenant isolation, layer by layer</h3>
${table(['Layer','Isolation mechanism','Cost of isolation'],[
 ['Exact / semantic response','Tenant in key and in index filters; separate namespaces or clusters per data class','Lower hit rate for identical public questions across tenants (share only explicitly public content)'],
 ['Retrieval','Tenant + ACL-scope hash in key; read-time authorisation','ACL fragmentation of hit rate'],
 ['Engine prefix cache','Per-tenant <code>cache_salt</code> (vLLM) injected by the gateway','Duplicate KV blocks for identical prompts (e.g. 100 tenants × 250 MiB)'],
 ['Offloaded / remote KV','Salted hashes carry through; encrypt disks; wipe on node recycle','Same duplication, on cheaper tiers'],
 ['Provider prompt cache','Provider isolation (Anthropic: per organisation, and per workspace on the Claude API); separate workspaces or projects per tenant where required; OpenAI <code>prompt_cache_key</code> per tenant','Fewer cross-tenant hits; more cache writes'],
 ['Embedding','Usually safe to share for identical public text; per-tenant for private corpora (erasure)','Small'],
 ['Weights','Shared (same public model); per-tenant for fine-tuned adapters','None for base weights']
])}

<h3>3.5 Cache security</h3>
<p><b>Timing side channels.</b> A cache hit is faster than a miss. If two users share a prefix or prompt cache, user B can send a candidate prefix and measure TTFT: a fast answer reveals that someone recently sent that exact prefix. This is not theoretical:</p>
<ul>
<li>Gu, Li, Kuditipudi, Liang and Hashimoto, <i>Auditing Prompt Caching in Language Model APIs</i> (arXiv 2502.07776, ICML 2025) used statistical timing tests and detected <b>global cache sharing across users at seven API providers</b>, including OpenAI, at the time of their audit; they also showed timing can leak architecture information. Providers may have changed behaviour since; re-test rather than assume.</li>
<li>Song et al., <i>The Early Bird Catches the Leak: Unveiling Timing Side Channels in LLM Serving Systems</i> (arXiv 2409.20002) describe timing side channels from shared caches and memory allocation in serving systems that can be used to infer system prompts and other users’ prompts.</li>
<li>vLLM’s prefix-caching design documents per-request salting precisely to prevent timing-based inference of cached content, so that sharing is limited to requests that agree on a salt.</li>
</ul>
<p>Mitigations: per-tenant (or per-user for highly sensitive data) salts; never share caches across trust boundaries; keep secrets out of prompts in the first place; for provider caches, understand the isolation level (organisation, workspace) and separate sensitive tenants accordingly. Adding random delay is weak: it costs latency and averages out over many probes.</p>
<p><b>Other risks:</b></p>
${table(['Risk','Example','Mitigation'],[
 ['Cache poisoning','An attacker gets a manipulated answer (via prompt injection in a document) stored under a popular semantic key','Cache only answers that passed output guardrails; never cache answers derived from untrusted inputs; per-tenant indexes; review high-traffic entries'],
 ['Cross-tenant leakage','Key missing tenant/ACL','Key review, contract tests, canary tenants with synthetic secrets'],
 ['Sensitive data at rest','Personal data in response caches; prompt-derived KV on NVMe','Do not cache personal answers; encrypt; short TTL; wipe tiers on node recycle'],
 ['Erasure obligations','A user requests deletion (PDPL, GDPR-style rights)','Index entries by subject where user-derived; purge by subject; document what is cached'],
 ['Key leakage','Raw prompts in Redis key names visible to operators','HMAC keys; restrict KEYS/SCAN; audit access'],
 ['Weak hashing','Non-cryptographic prefix hash in multi-tenant engines allows engineered collisions','Use sha256 (vLLM default) where tenants are untrusted']
])}

<h3>3.6 Hit ratios: say which one</h3>
${table(['Ratio','Definition','Use for'],[
 ['Request hit ratio','hits ÷ lookups (requests)','Response, semantic, retrieval caches'],
 ['Token hit ratio','cached prompt tokens ÷ prompt tokens looked up','Engine prefix cache (vLLM counters are in tokens), provider prompt caching (cached ÷ input tokens)'],
 ['Byte hit ratio','bytes served from cache ÷ bytes requested','Weight and artifact caches, KV tiers'],
 ['Served-hit precision','correct hits ÷ served hits (labelled sample)','Semantic cache safety'],
 ['Eligible hit ratio','hits ÷ eligible lookups','Response caches with eligibility policies (otherwise policy changes look like cache changes)']
])}
<p>Two traps: (1) a hit ratio on a <b>shrinking eligible slice</b> can rise while savings fall; always report absolute avoided work. (2) A per-replica prefix hit ratio can look good while the fleet ratio is poor if routing spreads prefixes.</p>

<h3>3.7 Memory arithmetic in one place</h3>
${table(['Cache','Formula','Worked example'],[
 ['Per-request KV','tokens × 2 × layers × kv_heads × head_dim × bytes','8,192 tok × 320 KiB (70B shape) = 2.5 GiB'],
 ['Warm prefix in HBM','prefix tokens × KV bytes per token × copies (salts)','2,000 × 128 KiB × 100 tenants ≈ 24.4 GiB'],
 ['KV offload capacity','tier bytes ÷ KV bytes per token','1,000 GiB ÷ 320 KiB ≈ 3.28 M tokens'],
 ['Semantic cache','entries × dims × bytes + links + payloads','5 M × 1,024 × 4 B = 20.48 GB vectors (+0.64 GB links +7.5 GB payloads)'],
 ['Exact response cache','entries × (key + value + overhead)','2 M × 2,212 B ≈ 4.4 GB'],
 ['Retrieval cache','entries × (key + k × (id + score) + overhead)','1 M × 564 B ≈ 0.56 GB'],
 ['Embedding cache','chunks × dims × bytes','40 M × 1,024 × 2 B ≈ 82 GB'],
 ['Weights','parameters × bytes','70.6 B × 2 B ≈ 141 GB per BF16 70B revision']
])}

<h3>3.8 Monitoring</h3>
${table(['Signal','Metric (source)','Alert idea'],[
 ['Engine prefix token hit rate','<code>vllm:prefix_cache_hits</code> ÷ <code>vllm:prefix_cache_queries</code> (vLLM, tokens)','Drop &gt; 30 % vs 7-day baseline for 15 min → likely prompt layout change'],
 ['KV pressure','<code>vllm:kv_cache_usage_perc</code>, <code>vllm:num_requests_waiting</code>','KV &gt; 0.95 and waiting &gt; 0 for 10 min'],
 ['Provider cache usage','<code>cache_read_input_tokens</code> / <code>cached_tokens</code> per call; OTel <code>gen_ai.client.inference.usage.cache_read.input_tokens</code> and <code>…cache_write.input_tokens</code>','Cached share falls; write share rises (prefix churning)'],
 ['Response cache','Suggested names: <code>ai_cache_lookups_total{cache,result}</code>, <code>ai_cache_lookup_seconds</code>','Lookup p99 &gt; budget; hit ratio collapse after deploy'],
 ['Freshness','Suggested: <code>ai_cache_purge_lag_seconds</code> (event time → purge done)','p99 &gt; 60 s'],
 ['Safety','Suggested: <code>ai_cache_wrong_hits_total</code> (from audits and user reports), labelled precision','Any confirmed cross-tenant hit pages immediately'],
 ['Tiers','Load latency per tier, bytes written per second to NVMe, fallback-to-recompute count','Tier p99 load &gt; recompute estimate']
])}
${callout('warn','Label hygiene','Never put user ids, prompts or cache keys in Prometheus labels: cardinality explodes and you leak data into the metrics system. Use cache type, model, tenant tier and region as labels; put request-level detail in traces and audit logs.')}

<h3>3.9 Cost: computing savings correctly</h3>
<p>The most common error is "total tokens × hit rate = tokens saved = cost saved". It is wrong three ways: prefix caches save only prefill, prefill and decode cost different amounts per token, and providers price cached tokens with multipliers (and charge for writes).</p>
${formula(`
SELF-HOSTED (illustrative): 1,000,000 requests/day, 6,000 prompt + 400 output tokens each
Measured prefix token hit rate (vllm hits ÷ queries) = 30 %

STEP 1  Avoided prefill tokens = 0.30 × 6,000 × 1,000,000 = 1.8 × 10⁹ tokens/day
STEP 2  WRONG claim: (6,000 + 400) × 10⁶ × 0.30 = 1.92 × 10⁹ tokens "saved"
        and "30 % cost saving"
STEP 3  Measured GPU time split: 35 % prefill, 65 % decode
        GPU time saved ≈ 0.30 × 0.35 = 10.5 %
STEP 4  Fleet of 40 GPUs → 0.105 × 40 = 4.2 GPUs of capacity freed
        at an illustrative $4.00 per GPU-hour: 4.2 × 4.00 × 730 ≈ $12,264 / month
        (only realised if you actually scale down or absorb growth)

ANSWER  10.5 %, not 30 %.
`)}
${formula(`
HOSTED (Claude Opus 5.5, Oct 2026): base input $4.00/M, output $20.00/M,
cache read 0.05× = $0.20/M, 5-min write 1.25× = $5.00/M

Per request: 6,000 input (2,000 cacheable prefix + 4,000 unique) + 400 output
Prefix found in cache on 90 % of requests, written on 10 %

WITHOUT caching
  input  6,000 × 4.00 ÷ 10⁶                   = $0.02400
  output   400 × 20.00 ÷ 10⁶                  = $0.00800
  total                                        = $0.03200

WITH caching
  unique  4,000 × 4.00 ÷ 10⁶                  = $0.01600
  reads   2,000 × 0.90 × 0.20 ÷ 10⁶           = $0.00036
  writes  2,000 × 0.10 × 5.00 ÷ 10⁶           = $0.00100
  output                                       = $0.00800
  total                                        = $0.02536

Saving = (0.03200 − 0.02536) ÷ 0.03200 = 20.75 %

WRONG shortcut: cached share of all tokens = (2,000 × 0.90) ÷ 6,400 = 28 % "saving"
ANSWER  ≈ 21 % per request at 10⁶ requests/day ≈ $6,640/day — and to raise it,
        make more of the prompt a stable prefix, not more hits on a small one.
`)}
${formula(`
RESPONSE CACHE (any backend): avoided cost = hits × full request cost
   − cache running cost − false-hit cost   (lesson 2.2.2)
   It is the only cache family that removes decode and output-token cost.
`)}

<h2>4. Where does it fit?</h2>
${fig('The cache operations loop', svgDiagram({w:900,h:260,
 boxes:[
  {id:'src',x:10,y:30,w:160,h:56,label:'Sources',sub:'docs, IdP, registry'},
  {id:'ev',x:200,y:30,w:160,h:56,label:'Change events',sub:'CDC, webhooks'},
  {id:'inv',x:390,y:30,w:160,h:56,label:'Invalidator',sub:'tags, versions',cls:'hl'},
  {id:'c',x:580,y:30,w:300,h:56,label:'Caches (10 layers)',sub:'keys with tenant + versions',cls:'v2'},
  {id:'m',x:580,y:150,w:300,h:56,label:'Metrics + audits',sub:'hit, lag, wrong hits, cost'},
  {id:'fin',x:300,y:150,w:220,h:56,label:'FinOps savings report',sub:'per layer, per tenant'},
  {id:'sec',x:10,y:150,w:240,h:56,label:'Security review',sub:'isolation, side channels'}
 ],
 arrows:[{from:'src',to:'ev'},{from:'ev',to:'inv'},{from:'inv',to:'c'},{from:'c',to:'m',fromSide:'bottom',toSide:'top'},{from:'m',to:'fin'},{from:'fin',to:'sec',cls:'dash'}]
}), 'Correctness flows left to right (sources → events → purges → caches); evidence flows back (metrics → cost and security reviews).')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Gateway</b> computes response-cache keys, injects salts and prompt-cache keys, and enforces bypass flags (${L('v2-ai-gateway','AI gateway')}).</li>
<li><b>Knowledge plane</b> publishes document and ACL change events (${L('v2-rag-production','production RAG')}).</li>
<li><b>Observability</b> carries cache metrics and per-request cache decisions in traces (${L('v2-ai-observability','AI observability')}).</li>
<li><b>FinOps</b> turns avoided work into money with the method above (${L('v2-finops-optimization','FinOps optimisation')}).</li>
<li><b>Security and governance</b> own isolation policy and side-channel reviews (${L('v2-ai-threat-model','AI threat model')}, ${L('v2-governance','governance')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${checklist([
 {key:'v2co-inv',text:'Cache inventory complete: every cache has key, scope, owner, TTL, invalidation events, bypass switch, metrics.'},
 {key:'v2co-keys',text:'Key functions reviewed: tenant, ACL version, resolved model, template version; HMAC; schema version.'},
 {key:'v2co-salt',text:'Engine prefix caches salted per tenant at the gateway; provider workspaces/keys separated for sensitive tenants.'},
 {key:'v2co-purge',text:'CDC-driven purges with a TTL backstop; purge lag SLO and alert; conditional write-back.'},
 {key:'v2co-authz',text:'Read-time authorisation on every response and retrieval hit.'},
 {key:'v2co-metrics',text:'Dashboards with the correct hit ratio per layer, lookup latency, tier latency, wrong-hit counter.'},
 {key:'v2co-cost',text:'Monthly savings report computed per layer with prefill/decode split and price multipliers.'},
 {key:'v2co-drill',text:'Game day: disable each cache via its bypass flag and confirm capacity and SLOs hold.'}
])}
${callout('devops','DevOps bridge','Treat a cache like a database replica with an SLO, a runbook and a kill switch. The kill switch matters more than in web caching: when you suspect a leak, you must be able to bypass one layer for one tenant in seconds, and your GPUs must have the headroom to absorb the extra load.')}

<h2>7. What happens when it fails?</h2>
<h3>Runbook: suspected cross-tenant cache leak</h3>
<ol>
<li><b>Contain</b>: flip the bypass flag for the suspected cache layer (globally if unsure). Accept the extra GPU or provider cost.</li>
<li><b>Preserve evidence</b>: snapshot affected keys, entry metadata and audit records before purging.</li>
<li><b>Purge</b>: delete affected namespaces; rotate the key HMAC secret (bump schema version).</li>
<li><b>Root cause</b>: compare the key function and filters against the tenancy model; check recent deploys of gateway config.</li>
<li><b>Notify</b>: follow the data-incident process (privacy, legal, affected tenants) — a cache leak is a data breach candidate.</li>
<li><b>Prevent</b>: contract test with two synthetic tenants sending identical prompts; canary secret strings that must never cross tenants.</li>
</ol>
${table(['Symptom','Cause','Evidence','Fix'],[
 ['Old policy still served','Missing tags or failed purge; stale re-insert race','Entry tags, purge lag, write timestamps','Tag purges, CAS write-back, TTL backstop'],
 ['Revoked user still gets documents','Read-time authorisation skipped on hits','Audit of chunks served after revocation time','Enforce read-time checks; treat as incident'],
 ['Prefix hit rate collapsed','Prompt template change; tokenizer or chat-template change','First differing token between prompts','Layout fix; template lint'],
 ['Savings report says 30 %, bill fell 8 %','Token hit rate reported as cost saving','Method review','Compute per layer with prefill/decode split and multipliers'],
 ['Purge lag spikes during ingestion','Event consumer lag','Kafka consumer lag','Scale consumers; prioritise ACL events'],
 ['Wrong-hit reports rise','Semantic threshold or slot rules drifted','Accepted-hit score distribution','Re-evaluate thresholds; narrow intents']
])}

<h2>8. How do we scale it?</h2>
<ul>
<li><b>Purges</b> scale with the dependency index: tag → keys sets in Redis, sharded by tag; avoid SCAN-based purges in production.</li>
<li><b>Event streams</b>: separate topics for ACL events (small, urgent) and document events (large, bursty); ACL first.</li>
<li><b>Isolation cost</b> grows with tenants: share caches only for explicitly public content; budget HBM for salted duplicates.</li>
<li><b>Regions</b>: regional caches, global purge topic, per-region purge-lag SLOs.</li>
</ul>

<h2>9. How do we optimize its cost?</h2>
<p>Use the per-layer method from section 3.9, then rank improvements by avoided cost per engineering week:</p>
<ol>
<li>Make more of the prompt a stable prefix (biggest lever for both self-hosted and hosted).</li>
<li>Cache-aware routing to raise fleet hit rates.</li>
<li>Offload tiers for long reused prefixes on large models.</li>
<li>Response caching for the public, repeatable slice.</li>
<li>Semantic caching only where labelled precision clears the break-even.</li>
</ol>
<p>And count the costs: cache infrastructure, the extra HBM for warm prefixes and salted duplicates, provider write premiums, and the operational cost of invalidation pipelines.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Your team reports prefix caching saves 30 % of tokens. How much money does it save?”','<p><i>Answer (≈50 s):</i> "Not 30 %. vLLM’s prefix counters are prompt tokens, so 30 % of prefill tokens were avoided; output tokens and decode are untouched. On self-hosted GPUs I convert it using the measured prefill share of GPU time — at 35 % prefill that is about 10 % of GPU time, which is money only if we scale the fleet down or absorb growth. On a hosted model I price each field: cached reads at the read multiplier, writes at the write premium, unique input and output at full price; with a 2,000-token cacheable prefix out of 6,000 and 90 % reuse on Opus 5.5 that is about 21 % per request. Then I subtract the cost of running the cache. And I’d check isolation: salts per tenant so the saving does not come with a timing side channel."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"30 % of tokens, so 30 % of the bill."</p></div><div class="good"><h4>Strong answer</h4><p>Separates prefill from decode, uses measured GPU time split or provider multipliers, includes write premiums and cache costs, and mentions isolation.</p></div></div>

<h3>Capstone stage 8: caching Atlas</h3>
<p>For Atlas the design is: engine prefix caching on (default) with per-tenant <code>cache_salt</code> from the gateway; prompt templates linted so system prompt and tools come first; an exact response cache only for the public FAQ intents with keys as in section 3.3 and tag purges from the policy CMS; retrieval caching with ACL-scope keys and read-time authorisation; embeddings keyed by content hash; weights pre-staged on GPU nodes. Semantic caching stays off until a labelled near-miss set shows ≥ 98 % precision on an intent. In the lab, the prefix-cache hit rate and the TTFT difference can be observed on a single vLLM replica; fleet-level routing, offload and multi-region purges are a <b>design that has not been tested at scale</b>.</p>

${callout('note','Audit of the older course (caching chapters)','Kept: the correctness checklist, "similarity is not permission", "TTL is not a substitute for authorisation", keyed hashes for keys, and the worked KV example (2 × 32 × 8 × 128 × 2 × 8,192 × 20 B = 20 GiB, which is correct). Fixed or added: seven caches → ten, with provider prompt caching (real prices and minimums), the GPU caching allocator and offload tiers as separate layers; per-layer hit-ratio definitions (vLLM counts tokens); the savings method (the old "1 M × $0.002 × 30 %" example is valid only for response caches, which avoid the whole request); timing side channels with published evidence; cache_salt as the concrete isolation control; the stale re-insert race; and verified metric names in place of generic ones.')}

<div class="connections"><h4>How this connects</h4>
${chain(['Source change','event','purge / version bump','fresh cache','correct answer'])}
${chain(['Token hit rate','prefill share','GPU time saved','fleet size','cost'])}
${chain(['Shared cache','timing difference','side channel','salt per tenant'])}
<p>Next: ${L('v2-parallelism','Part 3: parallelism and distributed systems')}. For cost governance, see ${L('v2-finops-optimization','FinOps optimisation')}; for threats, ${L('v2-ai-threat-model','the AI threat model')}.</p></div>
`,
  quiz:[
    {q:'Which mechanism guarantees a revoked user cannot read a document through a cached retrieval result?',options:['A short TTL','Tag purge on the ACL event','Read-time authorisation of every chunk on every hit','Increasing the purge consumer count'],answer:2,explain:'Purges and TTLs bound staleness but can lag or fail; only checking permissions at read time guarantees no access after revocation.'},
    {q:'A request read doc v7, the doc was updated and purged, and then the request wrote its answer into the cache. What prevents this?',options:['Longer TTL','Conditional write-back that checks the versions read are still current','Semantic threshold tuning','Disabling prefix caching'],answer:1,explain:'Compare-and-set on document versions or a generation number rejects stale write-backs.'},
    {q:'Prefix token hit rate is 30 % and prefill takes 35 % of GPU time. GPU time saved is about…',options:['30 %','35 %','10.5 %','65 %'],answer:2,explain:'Only prefill benefits: 0.30 × 0.35 = 0.105.'},
    {q:'Why should engine prefix caches be salted per tenant?',options:['To increase hit rate','To prevent cross-tenant reuse, which creates a timing side channel revealing other tenants’ prompts','Because vLLM requires it','To reduce HBM use'],answer:1,explain:'Shared caches make hits faster than misses; an attacker can probe for others’ prefixes. Salting costs HBM through duplication.'},
    {q:'Why use HMAC rather than a plain SHA-256 for response cache keys?',options:['It is faster','Someone who can see key names cannot verify guessed prompts offline without the secret','Redis requires it','It compresses the key'],answer:1,explain:'Plain hashes of low-entropy prompts can be brute-forced or confirmed; HMAC needs the secret.'},
    {q:'Which metric labels are appropriate for a cache hit counter in Prometheus?',options:['user_id and prompt','cache type, model, tenant tier, region','cache key','full request URL with query text'],answer:1,explain:'High-cardinality or sensitive values belong in traces and audit logs, not metric labels.'}
  ],
  flashcards:[
    {front:'Six invalidation mechanisms',back:'TTL, versioned keys, tag purge, event-driven purge, conditional write-back (CAS), read-time validation.'},
    {front:'What enforces permission revocation?',back:'Read-time authorisation on every hit. Purges and TTLs only bound staleness.'},
    {front:'Stale re-insert race',back:'In-flight request writes old-version data after a purge. Fix: write back only if versions read are still current.'},
    {front:'Prompt-cache timing side channel evidence',back:'Gu et al. 2025 (arXiv 2502.07776, ICML): global cache sharing detected at 7 API providers incl. OpenAI at audit time. Song et al. (arXiv 2409.20002): timing channels in LLM serving.'},
    {front:'Correct savings method (self-hosted prefix)',back:'avoided prefill tokens → × prefill share of GPU time → GPU-hours → money only if capacity is released.'},
    {front:'Correct savings method (hosted)',back:'Price each field: unique input × 1, cache reads × read multiplier, writes × write premium, output × output price; compare to no-cache.'},
    {front:'Cross-tenant leak first action',back:'Bypass the cache layer (kill switch), preserve evidence, purge, rotate key secret, root-cause, notify per data-incident process.'}
  ]
});
registerGlossary([
  {term:'Cache invalidation',def:'Removing or making unreachable cache entries whose source data, permissions or computation identity have changed.',lesson:'v2-cache-ops'},
  {term:'Conditional write-back',def:'Writing a computed result into a cache only if the source versions it was computed from are still current, preventing stale re-inserts after a purge.',lesson:'v2-cache-ops',aliases:['compare-and-set write-back']},
  {term:'Read-time authorisation',def:'Checking the caller’s current permissions on every cache hit before serving, so cache staleness never extends access.',lesson:'v2-cache-ops'},
  {term:'Timing side channel',def:'Leaking information through response-time differences; in shared prompt or prefix caches, a fast response reveals that a prefix was recently cached by someone else.',lesson:'v2-cache-ops',aliases:['cache timing attack']},
  {term:'Purge lag',def:'Time from a source change event to the completion of the corresponding cache purge; a freshness SLO for derived caches.',lesson:'v2-cache-ops'},
  {term:'Token hit ratio',def:'Cached prompt tokens divided by prompt tokens looked up; the correct hit measure for prefix and prompt caches.',lesson:'v2-cache-ops',aliases:['token hit rate']}
]);
})();
