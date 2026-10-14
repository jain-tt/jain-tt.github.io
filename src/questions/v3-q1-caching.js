/* Vol 3, Part 2, Chapter 5 — Questions: caching */
registerLesson({
  id:'v3-ch-caching', vol:3, part:2, num:5,
  title:'Questions: caching', minutes:110,
  summary:'This chapter is the interview question bank for caching in AI systems. The word cache covers at least five different mechanisms: exact response caches, semantic caches, retrieval caches, prefix and prompt caches, and the per-request KV cache. Interviewers test whether you can name what each one reuses, design a safe key, invalidate correctly, route traffic to where the cache lives, and prove the savings with numbers, without leaking one tenant\'s data to another.',
  objectives:[
    'Distinguish exact, semantic, retrieval, prefix/prompt and KV caches by what they reuse, their key, and their risk.',
    'Design tenant-safe cache keys and invalidation rules for RAG and model upgrades.',
    'Calculate savings from provider prompt caching and self-hosted prefix caching, including break-even.',
    'Explain cache-aware routing and its interaction with load balancing.',
    'Debug a prefix-cache hit-rate drop and decide when not to cache at all.'
  ],
  prereqs:['v2-cache-map','v2-response-semantic-cache','v2-prefix-kv-cache','v2-distributed-kv','v2-cache-ops'],
  next:['v3-ch-k8s','v3-ch-finops','v3-ch-security','v3-system-design'],
  tags:['interview','caching','prefix-cache','semantic-cache','security'],
  html:`
<h2>What interviewers test in this area</h2>
<p>Caching questions look easy and are full of traps. A DevOps engineer knows Redis, CDNs and TTLs, and that experience transfers, but AI adds three twists. First, there are several caches at different layers, and they save different things: a response cache skips the model entirely, a prefix cache only skips part of prefill, and the KV cache is not a cross-request cache at all. Second, correctness is fuzzy: a semantic cache returns an answer to a <i>similar</i> question, which can be confidently wrong. Third, caches in multi-tenant AI platforms are a data-leak surface: a cache key without tenant and permission scope can serve one customer's answer to another.</p>
<p>So interviewers probe: "what is the difference between these caches?", "when would you use prefix caching?", "how do you design the key?", "how do you invalidate when a document changes?", "how does the router know where the cache is?", and "prove it saves money". Strong answers always name <b>what is reused, the key, the scope, the freshness rule and the metric</b>.</p>

<h2>The mental model: five caches, five jobs</h2>
${fig('What each cache reuses and what it skips', svgDiagram({w:900,h:270,
  boxes:[
    {id:'e',x:20,y:40,w:160,h:70,label:'Exact response',sub:'skips everything',cls:'v1'},
    {id:'s',x:200,y:40,w:160,h:70,label:'Semantic',sub:'skips everything*',cls:'bad'},
    {id:'r',x:380,y:40,w:160,h:70,label:'Retrieval',sub:'skips search',cls:'v2'},
    {id:'p',x:560,y:40,w:160,h:70,label:'Prefix / prompt',sub:'skips part of prefill',cls:'hl'},
    {id:'k',x:740,y:40,w:140,h:70,label:'KV cache',sub:'skips recompute in-request',cls:'ok'},
    {id:'risk',x:20,y:170,w:520,h:60,label:'Higher in the stack: bigger saving, correctness depends on the key',cls:'warn'},
    {id:'safe',x:560,y:170,w:320,h:60,label:'Lower: exact token match, output unchanged',cls:'ok'}
  ],
  notes:[{x:200,y:135,text:'* only if "similar" really means "same answer"'}]
}), 'Name the cache by what it reuses; then talk about key, scope, freshness and metric.')}

<h2>Say it like a senior engineer</h2>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"We cache LLM responses in Redis to make it faster."</p></div><div class="good"><h4>Strong answer</h4><p>"I would layer caches by what they reuse: exact responses for deterministic, non-personal requests; prefix caching for the shared system prompt and tool schemas; retrieval caching keyed by index version. Each has a tenant-scoped key, a freshness rule and a hit-rate and wrong-hit metric."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Semantic caching saves a lot of tokens."</p></div><div class="good"><h4>Strong answer</h4><p>"Semantic caching is only safe where a false hit is cheap. I would set the similarity threshold from a labelled set of paraphrase pairs and the cost of a wrong answer, and partition by tenant and permissions."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"The KV cache stores answers so the next user is faster."</p></div><div class="good"><h4>Strong answer</h4><p>"The KV cache is per-request attention state. Reuse across requests is prefix caching, which only works for byte-identical token prefixes on the same model and adapter."</p></div></div>

<h2>Must-know numbers (derive them)</h2>
${formula(`
Provider prompt caching (Anthropic, as of Oct 2026): write 1.25× (5-min TTL) or 2× (1-h),
                                                    read 0.1× base input price
  Break-even, 5-min TTL: one write costs +0.25, each read saves 0.90
     → profitable after the first reuse
  Break-even, 1-h TTL: one write costs +1.00 → needs ≥ 2 reads to profit

Input-cost saving example: 6,000-token shared prefix, 500-token suffix, 95 % hit
  uncached  = 6,500 P
  cached    = 0.05 × 6,000 × 1.25 P + 0.95 × 6,000 × 0.1 P + 500 P
            = 375 P + 570 P + 500 P = 1,445 P   → 77.8 % lower input cost

Self-hosted prefix cache: KV per token (Llama-3.1-70B, BF16) = 320 KiB
  a 4,096-token shared prefix = 1.25 GiB of KV, stored once and shared
`)}

<h2>Question map</h2>
<p>Eleven questions. <b>Concepts</b>: the five caches (Q1) and when prefix caching pays (Q2). <b>Correctness and safety</b>: cache keys (Q3), invalidation (Q4), semantic thresholds (Q7), when not to cache (Q10). <b>Architecture</b>: cache-aware routing (Q5) and KV tiers (Q8). <b>Money and operations</b>: savings maths (Q6), measurement (Q9) and a hit-rate regression drill (Q11). In a travel context, keep one example ready: published baggage policy is cacheable with version scoping; a specific booking's refund eligibility and live fares are never response-cached.</p>
<h2>How to use this chapter</h2>
<p>For every answer, practise the five-part shape: <b>reuses → key → scope → freshness → metric</b>. Background: ${L('v2-cache-map','the caching map')}, ${L('v2-response-semantic-cache','response and semantic caching')}, ${L('v2-prefix-kv-cache','prefix caching')}, ${L('v2-distributed-kv','distributed KV and cache-aware routing')} and ${L('v2-cache-ops','cache operations')}. Where you have built a cache yourself, say so with a template like "[In my lab I measured a prefix hit rate of … on …]"; otherwise say what you would measure.</p>
`,
  quiz:[
    {q:'Which cache can return a wrong answer even when it works exactly as designed?',options:['Prefix cache','KV cache','Semantic cache','Model-weight cache'],answer:2,explain:'A semantic hit means "similar question", not "same correct answer". Prefix and KV reuse require exact token matches and do not change outputs.'},
    {q:'A system prompt begins with the current timestamp. Effect on prefix caching?',options:['None','Every request has a different first block, so almost nothing after it is reused','Hit rate improves','Only decode slows'],answer:1,explain:'Prefix block hashes chain from the first block; a changing first block invalidates the whole chain. Put volatile content at the end.'},
    {q:'Anthropic 5-minute cache: write 1.25×, read 0.1×. Two requests share a 10,000-token prefix within 5 minutes. Cost of that prefix vs uncached?',options:['Higher','Same','1.35 vs 2.0 units: cheaper','0.2 vs 2.0 units'],answer:2,explain:'Uncached: 2 × 1.0 = 2.0. Cached: 1.25 (write) + 0.1 (read) = 1.35. One reuse already pays.'},
    {q:'Why include the LoRA adapter id in prefix-cache block hashes?',options:['For billing','The same tokens produce different KV under different adapters','To reduce memory','It is not needed'],answer:1,explain:'KV depends on the weights; reusing KV computed with another adapter would give wrong results. vLLM includes LoRA id in the block hash.'},
    {q:'Best primary signal for cache-aware routing decisions?',options:['Round robin','Prefix overlap combined with worker load','CPU usage','Client IP hash'],answer:1,explain:'Affinity without load creates hotspots; load without affinity wastes prefill. Routers such as Dynamo\'s combine both in one cost.'}
  ],
  flashcards:[
    {front:'Five AI caches',back:'Exact response, semantic, retrieval/embedding, prefix/prompt (cross-request KV reuse), per-request KV cache. Plus model-weight caching for cold starts.'},
    {front:'Safe response-cache key',back:'HMAC over tenant + principal/ACL scope, model + revision + adapter, prompt-template version, tool/schema version, index/doc versions, normalised input, generation params, locale.'},
    {front:'Prefix cache correctness',back:'Exact token match on same model, revision and adapter (and cache salt). Output is unchanged; only compute is saved.'},
    {front:'Provider caching break-even',back:'5-min write 1.25×, read 0.1×: profit after 1 reuse. 1-h write 2×: need ≥ 2 reuses.'},
    {front:'Semantic cache threshold rule',back:'Serve a hit only if P(correct | similarity) > W/(S+W), where S = saving per hit, W = cost of a wrong answer.'},
    {front:'Invalidation strategies',back:'Versioned keys (namespace bump), dependency tags → targeted purge, TTL as backstop, ACL check at read time always.'},
    {front:'Cache-aware routing failure mode',back:'Hotspots on the replica holding a popular prefix; fix by including load in the cost and replicating hot prefixes.'},
    {front:'Prefix hit-rate drop: usual suspects',back:'Volatile content early in the prompt, non-deterministic tool/JSON ordering, new model/template version, per-user salt, routing change, KV eviction pressure, TTL expiry.'}
  ]
});

registerQuestions([
{
  id:'cch-01', chapter:'v3-ch-caching', difficulty:1,
  title:'Semantic vs exact vs prefix vs KV cache: what is the difference?',
  understand:'The foundational caching question. They want each cache defined by what it reuses, where it lives, its key, what it saves and its correctness risk. Mixing up the KV cache with a response cache is the classic failure.',
  short:'They reuse different things. An exact response cache stores a finished answer under a key built from the normalised request and its context; a hit skips retrieval and the model entirely, and is correct as long as the key captures everything that changes the answer. A semantic cache does the same but matches similar questions by embedding similarity, so it saves more but can return a wrong answer. A prefix cache, inside the inference engine or a provider\'s prompt caching, reuses the computed attention state of an identical token prefix like a system prompt, so it only skips part of the prefill and never changes the output. The KV cache is the per-request attention state that lets decode avoid recomputing earlier tokens; on its own it is not shared across users at all.',
  detailed:`
${table(['Cache','Reuses','Key','Lives in','Saves','Correctness risk'],[
 ['Exact response','final answer','hash of normalised request + context dimensions','gateway / Redis','whole request (retrieval + GPU)','stale or mis-scoped key'],
 ['Semantic','answer to a similar question','embedding + similarity threshold, partitioned by tenant','vector store','whole request','false hits by design'],
 ['Retrieval / embedding','chunk ids, embeddings','(query hash, index version) / (text hash, model version)','app cache','search / embedding calls','stale index, revoked ACLs'],
 ['Prefix / prompt','KV of an identical token prefix','chained block hashes (+ model, adapter, salt)','engine HBM / CPU tier; provider','part of prefill (TTFT, compute)','none for output; side-channel concerns'],
 ['KV (per request)','attention state of this sequence','position in the sequence','engine HBM','recompute of earlier tokens in decode','none; capacity risk']
])}
<h3>How they stack on one request</h3>
<p>Gateway authenticates → exact cache → semantic cache (if enabled) → retrieval cache → prompt assembled → engine checks prefix cache → computes only uncached tokens → decode uses the request's KV cache. The upper layers give the biggest saving per hit and carry the most correctness risk; the lower layers give smaller savings but are exact.</p>
${formula(`
Illustrative request: 3,000-token system prompt + tools, 400 retrieved, 100 question

exact hit        → GPU work 0
prefix hit 3,000 → prefill 500 of 3,500 tokens (−86 % prefill), decode unchanged
no cache         → prefill 3,500 + decode
`)}
<p>Also on the map: <b>model-weight caching</b> (node-local copies of weights to cut cold-start time) and <b>provider prompt caching</b> (Anthropic and OpenAI's managed prefix caching, priced per cached token).</p>
<h3>Interview framing</h3><p>Answer with the five-part shape for each cache: what it reuses, its key, its scope, its freshness rule and its metric. If time is short, contrast just two: "a response cache skips the model and can be wrong if the key is incomplete; a prefix cache skips part of prefill and cannot change the answer". That single contrast shows you understand the risk gradient across the stack.</p>`,
  diagram:anim('v3q-cch-ladder'),
  followups:[
    {q:'Can a prefix cache hit change the answer?',a:'No. It reuses KV computed for exactly the same tokens with the same weights; the next-token distribution is identical (up to floating-point non-determinism that exists anyway). That is why prefix caching is on by default in vLLM for supported models.'},
    {q:'Where would you not put a semantic cache?',a:'Anywhere answers depend on user-specific data, live facts (fares, availability, booking status), or actions with side effects. Use it, if at all, for public, stable FAQ content.'},
    {q:'Which cache helps decode speed?',a:'None of the cross-request caches directly; the per-request KV cache is what makes decode linear instead of quadratic. Response caches avoid decode entirely by skipping the model.'},
    {q:'Is provider prompt caching the same as vLLM prefix caching?',a:'Same idea (reuse KV of an identical prefix), different control: providers decide placement and TTL and charge write/read multipliers; in vLLM you control routing, memory and eviction yourself.'}
  ],
  tradeoffs:`<ul><li><b>Exact cache</b>: safe and simple, low hit rate for free-form chat.</li><li><b>Semantic cache</b>: higher hit rate, correctness risk.</li><li><b>Prefix cache</b>: safe, large TTFT wins for long shared prompts, uses KV memory.</li></ul>`,
  failures:`<ul><li><b>Cross-tenant answer leak</b> → response key missing tenant scope.</li><li><b>Stale answers</b> → key missing document/model version.</li><li><b>Low prefix hit rate</b> → volatile content at the start of prompts.</li></ul>`,
  vocab:[
    {term:'Exact response cache',def:'Stores full answers keyed by a canonical request representation.'},
    {term:'Semantic cache',def:'Returns a stored answer for a sufficiently similar earlier request.'},
    {term:'Prefix caching',def:'Engine-level reuse of KV blocks for identical token prefixes across requests.'},
    {term:'Prompt caching',def:'Provider-managed prefix caching with its own pricing and TTL.'},
    {term:'KV cache',def:'Per-request attention keys and values stored for decode.'}
  ],
  mistakes:[
    'Saying the KV cache stores answers for other users.',
    'Treating semantic hits as equivalent to exact hits.',
    'Placing caches before authentication.',
    'Forgetting retrieval caches have their own freshness problem.'
  ],
  related:['v2-cache-map','v2-response-semantic-cache','v2-prefix-kv-cache','v1-kv-cache']
},
{
  id:'cch-02', chapter:'v3-ch-caching', difficulty:1,
  title:'When should prefix caching be used?',
  understand:'They want the workload patterns where prefix caching pays (long, stable shared prefixes; multi-turn chat; agents; repeated documents), how to structure prompts for it, and when it does little.',
  short:'Whenever many requests start with the same long sequence of tokens, which in practice is most production LLM traffic: a long system prompt, tool or function schemas, few-shot examples, the same retrieved document asked about repeatedly, and especially multi-turn chats and agent loops, where every turn re-sends the whole history. The engine then computes only the new tokens, which cuts time to first token and prefill compute. vLLM enables it by default for supported models, so the work is mostly prompt design: put stable content first and volatile content like timestamps, user names and the question last, keep tool definitions in a deterministic order, and route a conversation to the same replica. It helps little for short or unique prompts, and the cached blocks compete with live requests for KV memory.',
  detailed:`
<h3>Where it pays</h3>
${table(['Pattern','Shared prefix','Typical effect'],[
 ['Long system prompt + tool schemas','thousands of tokens on every request','large TTFT and prefill reduction'],
 ['Multi-turn chat','the whole previous conversation','turn k only prefills the new message'],
 ['Agent loops','system + tools + growing trace','each step re-uses all earlier steps'],
 ['Document Q&A','same document, many questions','document prefilled once'],
 ['Few-shot classification','examples block','examples prefilled once'],
 ['Batch evaluation','same instructions over many items','instructions prefilled once']
])}
${formula(`
Multi-turn example (ideal, no eviction between turns)
  system prompt 2,000 tokens; each turn adds 300 user + 300 assistant tokens; 10 turns

Without prefix caching, prefill tokens per turn k = 2,000 + 600(k − 1) + 300
  total = 10 × 2,300 + 600 × (0+1+…+9) = 23,000 + 27,000 = 50,000 tokens

With prefix caching: turn 1 prefills 2,300; turns 2–10 prefill ≈ 300 new user tokens
  (assistant tokens already have KV from decode)
  total ≈ 2,300 + 9 × 300 = 5,000 tokens   → ≈ 90 % less prefill
`)}
<h3>How it works in vLLM (design doc)</h3>
<p>Full KV blocks are identified by a hash of (parent block hash, the block's tokens, extra keys such as LoRA id, multimodal hashes and an optional cache salt). A new request walks its blocks from the start and reuses every block whose hash is present. Free blocks with reference count zero stay cached and are evicted LRU. Default hash is sha256 (since v0.11); it is on by default for supported models and disabled with <code>--no-enable-prefix-caching</code>.</p>
<h3>Prompt structure rules</h3>
<ol><li>Static first: system instructions, policies, tool schemas, few-shot examples.</li><li>Semi-static next: tenant-level context, retrieved documents (in stable order).</li><li>Volatile last: timestamps, user profile, the question.</li><li>Serialise tools and JSON deterministically (sorted keys, fixed order).</li><li>Route a session to the same replica (session affinity or cache-aware routing).</li></ol>
<h3>When it helps little</h3>
<p>Short prompts, unique prompts (each request different from the first token), workloads where KV memory is so tight that cached blocks are evicted before reuse, and decode-dominated workloads (it does nothing for TPOT).</p>`,
  diagram:fig('Structure prompts static-first', svgDiagram({w:900,h:200,
    boxes:[
      {id:'s',x:20,y:70,w:240,h:60,label:'System + policies',sub:'shared by all',cls:'ok'},
      {id:'t',x:270,y:70,w:200,h:60,label:'Tool schemas',sub:'sorted, versioned',cls:'ok'},
      {id:'d',x:480,y:70,w:180,h:60,label:'Retrieved docs',sub:'stable order',cls:'v2'},
      {id:'q',x:670,y:70,w:210,h:60,label:'Time, user, question',sub:'volatile',cls:'warn'}
    ],
    notes:[{x:20,y:160,text:'← cache hits extend from the left until the first differing token'}]
  }), 'Reuse stops at the first token that differs, so volatile content belongs at the end.'),
  followups:[
    {q:'Does prefix caching reduce cost on a self-hosted GPU fleet?',a:'Yes, indirectly: less prefill compute per request means more requests per GPU at the same TTFT SLO, so fewer replicas. Quantify with prefill share of GPU time and hit rate (see the savings question).'},
    {q:'Why route a conversation to the same replica?',a:'The cached prefix lives in that replica\'s HBM (or its CPU tier). Another replica would miss and prefill the whole history again.'},
    {q:'Any security concern?',a:'Shared prefix caches can leak information through timing (a hit is faster). Engines offer per-tenant isolation such as vLLM\'s cache_salt in the first block hash; use it in multi-tenant deployments that share replicas.'}
  ],
  tradeoffs:`<ul><li><b>Keeping cached blocks</b> raises hit rate but reduces free KV for new requests (they are evicted LRU when needed).</li><li><b>Session affinity</b> raises hits but can unbalance load.</li><li><b>Prompt restructuring</b> may slightly change model behaviour; evaluate.</li></ul>`,
  failures:`<ul><li><b>Hit rate near zero</b> → volatile content first or non-deterministic serialisation.</li><li><b>Hit rate drops at peak</b> → eviction under KV pressure.</li><li><b>Hit rate drops after scale-out</b> → random routing spreads sessions.</li></ul>`,
  vocab:[
    {term:'Automatic prefix caching (APC)',def:'vLLM feature reusing hashed KV blocks of identical prefixes.'},
    {term:'Block hash chain',def:'Each block\'s hash includes its parent\'s, so a match implies the whole prefix matches.'},
    {term:'Cache salt',def:'Extra value mixed into the first block hash to isolate caches per tenant.'},
    {term:'RadixAttention',def:'SGLang\'s prefix cache organised as a radix tree of token sequences.'},
    {term:'Session affinity',def:'Routing all requests of a session to the same backend.'}
  ],
  mistakes:[
    'Putting timestamps or user names at the top of the system prompt.',
    'Expecting prefix caching to speed up decode.',
    'Believing similar wording gives partial hits (it must be identical tokens).',
    'Ignoring routing: the cache is per replica.'
  ],
  related:['v2-prefix-kv-cache','v1-kv-cache','v2-distributed-kv']
},
{
  id:'cch-03', chapter:'v3-ch-caching', difficulty:2,
  title:'How do you design a safe cache key?',
  understand:'A security-and-correctness question. They want every dimension that changes the correct answer or who may see it, plus implementation details: canonicalisation, keyed hashing, partitioning, and what to do with sampling parameters.',
  short:'A cache key must include everything that changes either the correct answer or who is allowed to see it. For a response cache that means the tenant and the caller\'s permission scope, the model, its revision and any adapter, the prompt-template and system-prompt version, tool and schema versions, the versions of the documents or index the answer depends on, the normalised user input, generation parameters, locale and output format. I hash it with a keyed HMAC so raw prompts never appear in key names, partition storage by tenant, and still re-check authorization when serving a hit. I only cache deterministic, non-personal requests; if temperature is high, a cached answer is just one sample. For engine prefix caches, the key is exact tokens plus model and adapter, with a per-tenant salt when isolation matters.',
  detailed:`
<h3>Key dimensions (response cache)</h3>
${table(['Dimension','Why','Example'],[
 ['Tenant id','no cross-customer reuse','t:almosafer-b2b-42'],
 ['Principal scope / ACL fingerprint','two users in one tenant may see different documents','hash of group memberships or entitlement set'],
 ['Model id + revision + adapter','different weights → different answers','llama-3.1-8b@sha, lora:support-v7'],
 ['Prompt template / system prompt version','instructions change answers','tmpl:v14'],
 ['Tool / schema versions','tool behaviour and output format','tools:v3'],
 ['Index version or doc versions used','freshness','idx:2026-10-14T02:00'],
 ['Normalised input','canonical text (Unicode normalisation, whitespace, case policy)','NFC, trimmed'],
 ['Generation params','temperature, max_tokens, response format','t=0, json'],
 ['Locale / language','Arabic vs English answer','ar-SA'],
 ['Safety / policy version','guardrail changes alter outputs','policy:v5']
])}
${code('python',`import hmac, hashlib, json
def cache_key(secret: bytes, ctx: dict) -> str:
    canon = json.dumps(ctx, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "resp:" + ctx["tenant"] + ":" + hmac.new(secret, canon.encode(), hashlib.sha256).hexdigest()`)}
<h3>Rules beyond the key</h3>
<ul><li><b>Authorise on read</b>: even with ACL scope in the key, verify the caller may see every source the cached answer cites (permissions can be revoked after caching).</li>
<li><b>Do not cache</b> responses containing personal data, live facts, or tool side effects.</li>
<li><b>Partition storage</b> per tenant (separate key prefixes or databases) so a bug cannot scan across tenants; encrypt at rest.</li>
<li><b>Sampling</b>: at temperature 0, a cached answer is a faithful replay; at higher temperature it pins one sample, which may be acceptable or not.</li>
<li><b>Key length</b>: put only hashes in keys; store the metadata (versions, sources) in the value for audit and invalidation.</li></ul>
<h3>Engine-level keys</h3>
<p>Prefix caches are keyed by token content chained per block, plus model and adapter; vLLM adds LoRA id, multimodal hashes and optional <code>cache_salt</code>. Providers scope caches to the organisation; OpenAI's <code>prompt_cache_key</code> is a routing hint and accounting key, not a security boundary.</p>
<p>Test it: write a unit test that two tenants asking the same question get different keys, and a regression test that every key dimension is populated before a write is allowed.</p>`,
  diagram:fig('Key = what changes the answer + who may see it', svgDiagram({w:900,h:220,
    boxes:[
      {id:'who',x:20,y:30,w:260,h:60,label:'Who',sub:'tenant, principal scope',cls:'bad'},
      {id:'what',x:20,y:130,w:260,h:60,label:'What computes it',sub:'model, revision, adapter, template',cls:'v2'},
      {id:'data',x:320,y:30,w:260,h:60,label:'Which data',sub:'index / doc versions',cls:'v1'},
      {id:'in',x:320,y:130,w:260,h:60,label:'Input + params',sub:'normalised, locale, format',cls:'v3'},
      {id:'k',x:640,y:80,w:240,h:60,label:'HMAC key',sub:'per-tenant partition',cls:'hl'}
    ],
    arrows:[{from:'who',to:'k'},{from:'what',to:'k'},{from:'data',to:'k'},{from:'in',to:'k'}]
  }), 'Missing any box creates either stale answers or a data leak.'),
  followups:[
    {q:'Why HMAC rather than plain SHA-256?',a:'Keys and logs may be visible to operators or other systems; a plain hash of a short prompt can be brute-forced or matched against guesses. HMAC with a secret prevents that and lets you rotate the secret to invalidate everything.'},
    {q:'Two users in the same tenant ask the same question but have different document permissions. How do you avoid recomputing for everyone?',a:'Include an ACL fingerprint (hash of the effective permission set) so users with identical entitlements share entries, while different entitlements get different keys; still authorise on read.'},
    {q:'How do you handle Arabic normalisation in keys?',a:'Apply one documented normalisation (Unicode NFC, optional removal of diacritics and tatweel, unify letter variants if your policy says so) both when writing and reading, and test that it does not merge questions with different meanings.'}
  ],
  tradeoffs:`<ul><li><b>More dimensions</b>: safer, lower hit rate.</li><li><b>Coarser scope</b> (tenant-wide): higher hit rate, needs strong read-time authorisation.</li></ul>`,
  failures:`<ul><li><b>Cross-tenant leak</b> → tenant missing in key → incident response, purge, add scope, add tests.</li><li><b>Stale answers after model upgrade</b> → model revision missing → namespace bump.</li><li><b>Hit rate collapse</b> → key includes a request id or timestamp by mistake.</li></ul>`,
  vocab:[
    {term:'Cache key',def:'Identifier under which a cached value is stored and looked up.'},
    {term:'HMAC',def:'Keyed hash; prevents guessing inputs from keys and allows rotation.'},
    {term:'ACL fingerprint',def:'Hash of a caller\'s effective permissions used as a key dimension.'},
    {term:'Canonicalisation',def:'Converting input to one standard form before hashing.'},
    {term:'Authorise on read',def:'Re-checking permissions when serving a cached value.'}
  ],
  mistakes:[
    'Keying only on the prompt text.',
    'Treating OpenAI prompt_cache_key as an isolation mechanism.',
    'Putting raw prompts in key names or logs.',
    'Caching answers derived from personal data.'
  ],
  related:['v2-cache-ops','v2-response-semantic-cache','v2-governance','v2-ai-threat-model']
},
{
  id:'cch-04', chapter:'v3-ch-caching', difficulty:2,
  title:'How do you handle cache invalidation in an LLM/RAG system?',
  understand:'They want a strategy, not just TTLs: versioned namespaces, dependency tracking from answers to source documents, event-driven purges, permission revocation handling, and what changes per cache layer (model upgrades, prompt changes, index rebuilds).',
  short:'I combine three mechanisms. Versioning: the key includes model, prompt-template and index versions, so a model upgrade or prompt change simply moves to a new namespace and old entries age out. Dependency tracking: each cached answer or retrieval result records which documents and versions it used, and a document-change event from the ingestion pipeline purges exactly those entries. And TTLs as a backstop, sized to how stale the business tolerates. Permissions are different: a revocation must take effect immediately, so I never rely on the cache for authorization; I re-check access to every cited source when serving a hit. Engine prefix caches mostly invalidate themselves, because they are keyed by exact tokens and model, but a weight swap in place needs a cache reset.',
  detailed:`
${table(['Change','Affected caches','Mechanism'],[
 ['Policy document edited','response, semantic, retrieval','change event → purge entries tagged with doc id; re-index'],
 ['Permissions revoked','any cache that returns content','authorise on read; purge tagged entries; never rely on TTL'],
 ['Embedding model upgraded','embedding cache, vector index, retrieval cache','new index version (blue/green); keys include model version'],
 ['LLM upgraded / new adapter','response, semantic, prefix','model revision in keys; prefix caches keyed by model; new replicas start empty'],
 ['Prompt template changed','response, semantic, prefix','template version in key; prefix hashes change naturally'],
 ['Tool behaviour changed','responses that used the tool','tool version in key'],
 ['Live data (fares, availability)','none should hold it','do not cache, or cache seconds with explicit staleness']
])}
<h3>Dependency tagging</h3>
${code('python',`# on write
redis.set(key, answer_json, ex=ttl)
for doc in cited_docs:                       # doc = (doc_id, version)
    redis.sadd("dep:" + tenant + ":" + doc.id, key)
# on document change event
for k in redis.smembers("dep:" + tenant + ":" + changed_id):
    redis.delete(k)
redis.delete("dep:" + tenant + ":" + changed_id)`)}
<h3>Consistency choices</h3>
<ul><li><b>Purge then rebuild</b>: simplest; brief miss storm after big changes (protect with request coalescing).</li>
<li><b>Stale-while-revalidate</b>: serve old answer while refreshing; acceptable only for low-risk content.</li>
<li><b>Ordering</b>: re-index first, then purge, or a request may repopulate the cache from the old index. Better: include index version in the key so ordering cannot cause staleness.</li></ul>
${formula(`
TTL sizing (backstop): max acceptable staleness S, change events reliable with probability r
  TTL ≈ S   when events can be missed;  longer TTL only when r is high and monitored
`)}
<h3>Who owns invalidation</h3><p>Make the ingestion pipeline the owner of change events (it knows when a document version changes), the gateway the owner of response-cache purges, and the platform team the owner of namespace bumps on model or template releases. Document this in the runbook; most stale-cache incidents are ownership gaps, not technical failures.</p>`,
  diagram:fig('Event-driven invalidation with versioned keys', svgDiagram({w:900,h:220,
    boxes:[
      {id:'src',x:20,y:80,w:150,h:60,label:'Doc store',sub:'policy v12 → v13',cls:'v1'},
      {id:'ing',x:200,y:80,w:150,h:60,label:'Ingestion',sub:'re-chunk, embed',cls:'v2'},
      {id:'idx',x:380,y:20,w:160,h:60,label:'Index v+1',sub:'new version',cls:'ok'},
      {id:'ev',x:380,y:140,w:160,h:60,label:'Change event',sub:'doc id, tenant',cls:'warn'},
      {id:'c',x:600,y:80,w:160,h:60,label:'Cache',sub:'purge tagged keys',cls:'hl'},
      {id:'r',x:790,y:80,w:90,h:60,label:'Read',sub:'ACL check',cls:'bad'}
    ],
    arrows:[{from:'src',to:'ing'},{from:'ing',to:'idx'},{from:'ing',to:'ev'},{from:'ev',to:'c'},{from:'c',to:'r'}]
  }), 'Versions make staleness impossible by construction; events purge precisely; TTL catches what is missed.'),
  followups:[
    {q:'A document is deleted for legal reasons. What must happen?',a:'Remove it from the source and index, purge every cache entry tagged with it (responses, semantic entries, retrieval results, embeddings), and verify by searching caches for the doc id. Logs and traces containing its text may need handling too.'},
    {q:'Does purging the cache fix an outdated vector index?',a:'No. The cache will refill from the stale index. Fix ingestion and index freshness first; cache purge is the last step.'},
    {q:'How do you avoid a miss storm after a global namespace bump?',a:'Warm the new namespace with top queries, coalesce identical concurrent misses, and roll the version gradually (per tenant or percentage) while watching GPU load.'}
  ],
  tradeoffs:`<ul><li><b>Short TTLs</b>: fresher, lower hit rate, more GPU load.</li><li><b>Dependency tracking</b>: precise, adds write-path complexity and storage.</li><li><b>Version bumps</b>: simple and safe, cause cold caches.</li></ul>`,
  failures:`<ul><li><b>Old policy served after update</b> → no event or index version not in key.</li><li><b>Revoked user still sees content</b> → relying on TTL for authz.</li><li><b>Event consumer lag</b> → purge delayed → monitor lag, TTL backstop.</li></ul>`,
  vocab:[
    {term:'Namespace versioning',def:'Including a version in all keys so a bump invalidates everything at once.'},
    {term:'Dependency tag',def:'Mapping from a source (document) to cache entries derived from it.'},
    {term:'Stale-while-revalidate',def:'Serving a stale entry while refreshing it in the background.'},
    {term:'Miss storm',def:'Burst of cache misses (and backend load) after mass invalidation.'},
    {term:'Request coalescing',def:'Letting one request compute a missing value while identical ones wait.'}
  ],
  mistakes:[
    'Relying on TTL for permission revocation.',
    'Purging the cache before the index is updated.',
    'Forgetting that model and prompt upgrades invalidate response caches.',
    'Assuming engine prefix caches need manual invalidation on prompt changes (they do not; weight swaps do).'
  ],
  related:['v2-cache-ops','v2-rag-production','v2-rag-weight-cache']
},
{
  id:'cch-05', chapter:'v3-ch-caching', difficulty:3,
  title:'How does cache-aware routing work, and what can go wrong?',
  understand:'Architect-level. They want the mechanism (index of which worker holds which prefix blocks, fed by engine events), the scoring that mixes affinity and load, current implementations, and failure modes like hotspots and stale indexes.',
  short:'Prefix caches live inside each replica, so a request only gets a hit if it lands where its prefix is cached. A cache-aware router keeps an index of which KV blocks each worker holds, fed by events from the engines, hashes the incoming prompt into blocks the same way, and scores each worker by overlap and by load. Dynamo\'s KV router, for example, computes a cost from the prefill blocks still needed after subtracting cached overlap, plus the worker\'s decode load, and picks the lowest. llm-d\'s endpoint picker and SGLang\'s router do similar things. The trap is pure affinity: a popular prefix drags all traffic to one worker. Load in the score fixes that and naturally replicates hot prefixes. If the index goes stale, you only lose hits, never correctness, because reuse is verified on the worker.',
  detailed:`
<h3>Mechanism</h3>
<ol><li>Engines publish KV events (block stored / removed) to the router's indexer.</li>
<li>For a new request, the router tokenizes and hashes the prompt into blocks (same block size and hash scheme as the engines).</li>
<li>For each worker: overlap = number of leading blocks it already holds; load = active prefill and decode work.</li>
<li>Score and pick; optionally sample with a temperature to spread load.</li></ol>
${formula(`
Dynamo KV router cost (v1.5.1 docs)
  cost = prefill_load_scale × adjusted_prefill_blocks + potential_decode_blocks + active_request_blocks
  adjusted_prefill_blocks = max(0, active_prefill_blocks + incoming_prompt_blocks − overlap_credit_blocks)

Worked (illustrative): prompt = 256 blocks (4,096 tokens, 16-token blocks)
  W1: overlap 240, active prefill 20, decode 300 → (20 + 256 − 240) + 300 = 336
  W2: overlap 0,   active prefill 0,  decode 200 → 256 + 200             = 456
  → W1 wins; it prefills 16 blocks instead of 256

Later W1 is hot: active prefill 400, decode 900
  W1: (400 + 256 − 240) + 900 = 1,316   vs  W2: 456  → W2 wins, accepts a miss
`)}
<h3>Implementations (as of Oct 2026)</h3>
<ul><li><b>NVIDIA Dynamo</b>: KV-aware router with KV indexer; <code>--router-mode kv</code> on the frontend; tunables such as <code>--router-kv-overlap-score-credit</code> and <code>--router-temperature</code>.</li>
<li><b>llm-d / Gateway API Inference Extension</b>: endpoint picker scores pods on prefix-cache affinity, load and LoRA availability; llm-d adds KV indexing and predicted-latency routing.</li>
<li><b>SGLang</b>: router with cache-aware policies; inside one server, <code>--schedule-policy lpm</code> (longest prefix match) is an option, default <code>fcfs</code>.</li>
<li><b>Ray Serve LLM</b>: <code>PrefixCacheAffinityRouter</code>.</li>
<li><b>Simple fallback</b>: consistent hashing on session id or a hash of the system prompt, with bounded load.</li></ul>
<p>Interview framing: "affinity times load times index freshness". Say that a stale index costs hits, never correctness, and that load must be in the score to avoid hotspots; then name one implementation you have read about or run [In my lab I used …].</p>`,
  diagram:anim('v3q-cch-route'),
  followups:[
    {q:'Why not just use session stickiness?',a:'Stickiness helps multi-turn chat but ignores cross-session sharing (same system prompt across users) and ignores load, so popular sessions or tenants create hotspots. KV-aware routing generalises it.'},
    {q:'What if the router tokenizes differently from the engine?',a:'Block hashes will not match, so overlap is always zero and routing degrades to load balancing. Router and engines must share tokenizer, block size and hash scheme versions.'},
    {q:'How do you measure whether it works?',a:'Prefix hit rate per worker and fleet-wide, TTFT p95, prefill tokens per request, and load skew (max/mean queue across workers). Compare against round robin in an A/B.'},
    {q:'How does it interact with autoscaling?',a:'New replicas start cold and the router prefers warm ones, so new capacity may sit idle; load terms in the cost or warm-up routing are needed so scale-out actually relieves pressure.'}
  ],
  tradeoffs:`<ul><li><b>Affinity weight</b>: higher → more hits, more skew.</li><li><b>Router temperature</b>: spreads load at some hit-rate cost.</li><li><b>Central indexer</b>: precise but another component to scale and keep consistent.</li></ul>`,
  failures:`<ul><li><b>Hotspot</b> on one replica → load not in cost → tune weights.</li><li><b>Stale index after restart</b> → misses → consume removal events, expire entries.</li><li><b>Router CPU bottleneck</b> on tokenizing huge prompts → scale router, approximate hashing.</li></ul>`,
  vocab:[
    {term:'Cache-aware routing',def:'Choosing a backend by expected cache reuse as well as load.'},
    {term:'KV events',def:'Notifications from engines when KV blocks are stored or evicted.'},
    {term:'Overlap',def:'Number of leading prompt blocks already cached on a worker.'},
    {term:'Endpoint picker (EPP)',def:'Gateway API Inference Extension component that selects a model-server pod.'},
    {term:'Load skew',def:'Imbalance of work across replicas, e.g. max/mean queue length.'}
  ],
  mistakes:[
    'Sticky routing without load awareness.',
    'Assuming a stale index can produce wrong outputs.',
    'Mismatched tokenizer/block size between router and engines.',
    'Forgetting cold replicas after scale-out.'
  ],
  related:['v2-distributed-kv','v2-ai-gateway','v2-distributed-inference','v1-k8s-serving']
},
{
  id:'cch-06', chapter:'v3-ch-caching', difficulty:3,
  title:'Prove the savings: how much does caching actually save?',
  understand:'A quantitative FinOps question. They want correct arithmetic for provider prompt caching (write premium, read discount, break-even), for self-hosted prefix caching (prefill share of GPU time), and for response caching, with labelled assumptions and a measurement plan.',
  short:'It depends on the layer, so I compute each. For provider prompt caching, cache writes cost a premium and reads a steep discount; on Anthropic\'s current pricing a five-minute write is 1.25 times base input and a read is 0.1 times, so one reuse already pays for the write. With a 6,000-token shared prefix, a 500-token suffix and a 95 percent hit rate, input cost falls about 78 percent. For a self-hosted fleet, prefix caching saves prefill compute: if prefill is, say, 40 percent of GPU time and 77 percent of prompt tokens hit, I free about 31 percent of GPU time at the same latency, which turns into fewer replicas. Response caching saves whole requests, but only for the hit fraction that is also correct. Then I prove it with an A/B on cost per successful request.',
  detailed:`
<h3>1. Provider prompt caching (Anthropic multipliers, as of Oct 2026)</h3>
${formula(`
Let P = base input price per token. Prefix X tokens, suffix Y tokens, hit rate h.

Uncached input cost per request   = (X + Y) P
Cached (5-min TTL)                = (1 − h) · X · 1.25 P + h · X · 0.1 P + Y P

X = 6,000, Y = 500, h = 0.95
  uncached = 6,500 P
  cached   = 0.05 × 7,500 P + 0.95 × 600 P + 500 P = 375 P + 570 P + 500 P = 1,445 P
  saving   = 1 − 1,445/6,500 ≈ 77.8 % of input cost (output tokens unchanged)

Break-even reads per write
  5-min:  extra write cost 0.25,  saving per read 0.90  → 0.25/0.90 ≈ 0.28 → 1 read pays
  1-hour: extra write cost 1.00,  saving per read 0.90  → 1.11 → need ≥ 2 reads
    check, 2 requests: uncached 2.0 vs cached 2.0 + 0.1 = 2.1 (worse)
           3 requests: uncached 3.0 vs cached 2.0 + 0.2 = 2.2 (better)
`)}
<p>Note model-specific exceptions (Opus 5.5 and Sonnet 5.5 reads at 0.05×) and minimum cacheable lengths (512 to 4,096 tokens depending on model); below the minimum nothing is cached. OpenAI caches automatically on supported models with its own multipliers. Read actual usage fields (<code>cache_read_input_tokens</code>, <code>cache_creation_input_tokens</code>; OpenAI <code>cached_tokens</code>) to measure h, rather than assuming it.</p>
<h3>2. Self-hosted prefix caching</h3>
${formula(`
f_p = share of GPU time spent in prefill (measured, e.g. from prefill/decode time metrics)
t   = share of prompt tokens served from cache (prefix_cache_hits / prefix_cache_queries)

GPU time freed ≈ f_p × t
Illustrative: f_p = 0.40, t = 0.77 → 0.308 → ≈ 31 % of GPU time
  replicas at same load and SLO ≈ 20 × (1 − 0.308) ≈ 13.8 → 14 instead of 20
  (decode-bound fleets save much less; verify with a benchmark at equal SLO)
`)}
<h3>3. Response caching</h3>
${formula(`
Saving per request ≈ h_correct × (full request cost) − cache infra cost
Wrong hits are negative savings: each costs an escalation, a refund or trust.
`)}
<h3>Measurement plan</h3>
<ol><li>Baseline cost per successful request and TTFT p95 for two weeks.</li><li>Enable caching for a traffic slice (A/B by tenant or percentage).</li><li>Compare cost per successful request, GPU-hours, TTFT, quality metrics and wrong-hit incidents.</li><li>Report savings net of cache infrastructure.</li></ol>`,
  diagram:fig('Where each cache saves money', svgDiagram({w:900,h:200,
    boxes:[
      {id:'a',x:20,y:70,w:260,h:60,label:'Provider prompt cache',sub:'input-token bill ↓',cls:'v1'},
      {id:'b',x:320,y:70,w:260,h:60,label:'Self-hosted prefix cache',sub:'prefill GPU time ↓',cls:'hl'},
      {id:'c',x:620,y:70,w:260,h:60,label:'Response cache',sub:'whole requests ↓',cls:'v2'}
    ],
    notes:[{x:20,y:160,text:'Measure all three as cost per successful request, net of cache infrastructure and wrong hits.'}]
  }), 'Different layers, different line items on the bill.'),
  followups:[
    {q:'Your hit rate is 95 % on Monday and 40 % on Saturday. Why might that be?',a:'Lower traffic means requests are spaced beyond the provider TTL (5 minutes), so caches expire between uses. Consider the 1-hour TTL for low-traffic periods only if reuse per write is at least two.'},
    {q:'Does caching reduce output-token cost?',a:'Prompt and prefix caching do not; output tokens are still generated. Only response caches avoid output generation.'},
    {q:'How would you present this to finance?',a:'Monthly cost per successful request before and after, with confidence intervals from the A/B, savings net of cache infrastructure, and a sensitivity table for hit rate and traffic.'}
  ],
  tradeoffs:`<ul><li><b>Longer TTL</b>: more hits at low traffic, higher write price.</li><li><b>Prompt restructuring for caching</b>: savings vs possible quality change; evaluate.</li></ul>`,
  failures:`<ul><li><b>Bill increases after enabling caching</b> → writes without reuse (1-hour TTL, low traffic, unique prefixes).</li><li><b>Savings disappear</b> → prompt changes broke prefix stability.</li><li><b>Below minimum length</b> → silently uncached.</li></ul>`,
  vocab:[
    {term:'Cache write premium',def:'Extra price charged when a prompt prefix is written to a provider cache.'},
    {term:'Cache read discount',def:'Reduced price for input tokens served from cache.'},
    {term:'Break-even reuse',def:'Number of reads per write needed for caching to save money.'},
    {term:'Prefill share',def:'Fraction of GPU time spent processing prompts.'},
    {term:'Cost per successful request',def:'Total cost divided by requests that met quality and SLO.'}
  ],
  mistakes:[
    'Using hit rate as savings without the write premium.',
    'Assuming output costs fall with prompt caching.',
    'Projecting self-hosted savings without measuring prefill share.',
    'Ignoring wrong-hit costs for response caches.'
  ],
  related:['v2-finops-optimization','v2-finops-unit-economics','v2-prefix-kv-cache']
},
{
  id:'cch-07', chapter:'v3-ch-caching', difficulty:2,
  title:'How would you set the similarity threshold for a semantic cache — and should you have one?',
  understand:'They test whether you treat semantic caching as a precision/recall decision with business costs, evaluated on labelled data and scoped safely, rather than picking 0.9 because it sounds high.',
  short:'A semantic cache is a classifier deciding "these two questions have the same correct answer". So I would build a labelled set of question pairs from real traffic, both true paraphrases and dangerous near-misses like "can I cancel my booking" versus "can I change my booking", embed them, and plot precision and hit rate against the threshold. The threshold comes from economics: a hit saves a few cents, a wrong answer can cost a support escalation or a refund, so the required precision is high. If the wrong-answer cost is a thousand times the saving, I need about 99.9 percent precision, which often leaves too few hits to bother. I would limit it to stable, public, non-personalised content, partition it by tenant, locale and content version, and monitor wrong hits.',
  detailed:`
${formula(`
Serve a semantic hit only if its expected value is positive:
   P(correct | sim) × S  −  (1 − P(correct | sim)) × W  >  0

                       W
   P(correct | sim) > ─────
                      S + W

S = saving per hit (illustrative $0.002)
W = cost of a wrong answer (illustrative $2: escalation, refund risk)
   required precision > 2 / 2.002 ≈ 0.999
`)}
<h3>Building the threshold</h3>
<ol><li>Sample real queries (de-identified), group by intent and language.</li><li>Label pairs: same-answer, different-answer (include hard negatives that differ in one critical word, negation, dates, fare classes, cities).</li><li>Compute similarity with the production embedding model; plot precision vs coverage for thresholds.</li><li>Choose the threshold meeting the required precision; check per language (Arabic and English separately) and per intent.</li><li>Optionally add a verifier: a cheap model checks whether the cached answer answers the new question.</li></ol>
${table(['Content type','Semantic cache?'],[
 ['Public FAQ (baggage allowance by fare family, published policy)','candidate, with doc-version scoping'],
 ['Personal booking questions','no'],
 ['Live prices, availability, flight status','no (tools)'],
 ['Agent actions with side effects','never'],
 ['Internal knowledge with ACLs','only with ACL-fingerprint partitioning, usually not worth it']
])}
<h3>Operational guard rails</h3>
<p>Partition the vector space by tenant, locale and content version; store source document versions with each answer; sample hits for human review; let users flag wrong answers and purge on flag; and track wrong-hit rate as a first-class SLO.</p>
<h3>A safer alternative architecture</h3><p>Instead of returning a stored answer, use semantic similarity to fetch a <i>candidate</i> answer and pass it to the model as context ("a previous answer to a similar question was …"). The model still answers the actual question and can correct differences, so you save less (prefill and decode still run, though answers may be shorter) but remove most false-hit risk. Another option is to cache only the expensive intermediate steps, such as retrieval or tool results that are not user-specific, keyed exactly.</p>`,
  diagram:fig('Threshold is a business decision', svgDiagram({w:900,h:200,
    boxes:[
      {id:'l',x:20,y:70,w:190,h:60,label:'Labelled pairs',sub:'incl. hard negatives',cls:'v1'},
      {id:'c',x:240,y:70,w:190,h:60,label:'Precision vs hits',sub:'per language',cls:'v2'},
      {id:'e',x:460,y:70,w:190,h:60,label:'Required precision',sub:'W / (S + W)',cls:'hl'},
      {id:'d',x:680,y:70,w:200,h:60,label:'Threshold or no cache',cls:'warn'}
    ],
    arrows:[{from:'l',to:'c'},{from:'c',to:'e'},{from:'e',to:'d'}]
  }), 'If the required precision leaves almost no hits, the right answer is not to semantic-cache.'),
  followups:[
    {q:'Why are hard negatives essential?',a:'Embedding similarity is high for questions differing in one critical detail (cancel vs change, Riyadh vs Jeddah, before vs after departure). Without them, measured precision is wildly optimistic.'},
    {q:'Could you cache the retrieval step semantically instead of the answer?',a:'Yes, and it is safer: reusing the retrieved documents for a similar query still lets the model answer the actual question, and permissions are checked on the documents. The saving is smaller but correctness risk drops.'},
    {q:'How do you detect drift in a semantic cache?',a:'Track hit rate, wrong-hit reports and verifier disagreement over time; re-run the labelled evaluation after embedding-model or content changes.'}
  ],
  tradeoffs:`<ul><li><b>Lower threshold</b>: more hits, more wrong answers.</li><li><b>Verifier</b>: higher precision, adds latency and cost.</li><li><b>Retrieval-level semantic caching</b>: smaller saving, much safer.</li></ul>`,
  failures:`<ul><li><b>Wrong answer to a near-duplicate</b> → threshold too low or no hard negatives.</li><li><b>Cross-locale mistakes</b> → missing locale partition.</li><li><b>Stale FAQ answers</b> → no content version scoping.</li></ul>`,
  vocab:[
    {term:'Similarity threshold',def:'Minimum embedding similarity to treat a stored question as a match.'},
    {term:'Hard negative',def:'A pair that looks similar but needs a different answer.'},
    {term:'Precision',def:'Share of served hits that were correct.'},
    {term:'Coverage / hit rate',def:'Share of requests served from the cache.'},
    {term:'Verifier',def:'A check, often a small model, confirming a cached answer fits the new question.'}
  ],
  mistakes:[
    'Choosing a threshold like 0.9 without labelled data.',
    'Ignoring the cost asymmetry of wrong answers.',
    'Semantic-caching personalised or live content.',
    'Evaluating only on easy paraphrases.'
  ],
  related:['v2-response-semantic-cache','v2-evaluation-monitoring','v2-cache-ops']
},
{
  id:'cch-08', chapter:'v3-ch-caching', difficulty:3,
  title:'What is multi-tier KV caching (offload to CPU/SSD), and when does it pay?',
  understand:'Architect-level. They want the tier hierarchy, the key comparison (reload time vs recompute time), bandwidth numbers, current implementations, and the risks (tail latency, complexity).',
  short:'GPU memory holds only so much KV, so engines evict cached prefixes and later recompute them. Multi-tier KV caching keeps evicted blocks in cheaper, larger tiers: CPU DRAM, local NVMe, or a shared remote store, and loads them back on a hit. It pays when reloading is faster than recomputing. For a 70B model, 8,000 tokens of KV is 2.5 GiB; pulling that over PCIe at a few tens of gigabytes per second takes tens of milliseconds, while recomputing the prefill takes hundreds of milliseconds. So for long, reused contexts like multi-turn chats, agent traces and document Q&A, offload raises effective hit rate and cuts TTFT. It costs host memory, PCIe bandwidth, complexity and tail-latency risk when tiers are slow, so I measure hit benefit against transfer cost on real traffic.',
  detailed:`
${table(['Tier','Capacity (order of)','Bandwidth to GPU (order of)','Use'],[
 ['GPU HBM','tens of GB per GPU','TB/s','active and hot prefixes'],
 ['CPU DRAM','hundreds of GB to TB per node','PCIe Gen5 x16: 128 GB/s total (≈ 64 GB/s each way, theoretical)','warm prefixes, recent sessions'],
 ['Local NVMe','TBs','GB/s per drive','cold sessions, long documents'],
 ['Remote / shared store','large, shared','network-bound (RDMA helps)','cross-node reuse']
])}
${formula(`
Reload vs recompute, Llama-3.1-70B BF16, 8,192-token prefix

KV size  = 8,192 × 327,680 B = 2.68 × 10⁹ B (2.5 GiB)
  with TP = 4 each GPU holds 1/4 → 0.67 GB per GPU over its own PCIe link

Reload  ≈ 0.67 GB / 64 GB/s ≈ 10.5 ms   (theoretical, per GPU in parallel)
Recompute prefill FLOPs ≈ 2 × 70.6 × 10⁹ × 8,192 ≈ 1.16 × 10¹⁵ (+ attention)
  on 4 × H100 at an assumed 50 % of dense BF16 peak (4 × 989.5 × 0.5 ≈ 1.98 × 10¹⁵ FLOP/s)
  ≈ 0.58 s
→ reload is roughly 50× faster in this illustrative case
`)}
<p>The comparison flips for short prefixes (little to recompute, fixed transfer overheads) and for slow remote tiers.</p>
<h3>Implementations (as of Oct 2026)</h3>
<ul><li><b>vLLM</b>: KV connectors via <code>--kv-transfer-config</code>, including <code>OffloadingConnector</code>, <code>LMCacheConnectorV1</code> and <code>MooncakeConnector</code>.</li>
<li><b>SGLang</b>: <code>--enable-hierarchical-cache</code> (default off).</li>
<li><b>Dynamo</b>: KVBM (KV Block Manager) across memory tiers, with NIXL transfers.</li>
<li><b>llm-d</b>: tiered prefix cache (CPU/SSD) as a well-lit path.</li></ul>
<h3>Platform concerns</h3>
<p>Host RAM sizing (pod memory limits: KV offload can trigger OOMKilled), NUMA placement, PCIe contention with model loading and networking, encryption and tenant isolation of KV at rest in shared tiers, and metrics per tier (hits, load latency, evictions).</p>
<p>Interview framing: "offload pays when reload beats recompute"; give the 2.5 GiB example and the tens-of-milliseconds versus hundreds-of-milliseconds comparison, then name the operational cost (host RAM limits, PCIe contention, tail latency).</p>`,
  diagram:fig('KV tiers: capacity up, bandwidth down', svgDiagram({w:900,h:220,
    boxes:[
      {id:'h',x:20,y:80,w:180,h:60,label:'HBM',sub:'TB/s, tens of GB',cls:'ok'},
      {id:'c',x:240,y:80,w:180,h:60,label:'CPU DRAM',sub:'PCIe, hundreds of GB',cls:'v1'},
      {id:'n',x:460,y:80,w:180,h:60,label:'Local NVMe',sub:'GB/s, TBs',cls:'v2'},
      {id:'r',x:680,y:80,w:200,h:60,label:'Remote store',sub:'network, shared',cls:'warn'}
    ],
    arrows:[{from:'h',to:'c',both:true,label:'evict / load'},{from:'c',to:'n',both:true},{from:'n',to:'r',both:true}]
  }), 'A tier is worth it when load time < recompute time for the prefixes you actually reuse.'),
  followups:[
    {q:'Why can offload hurt tail latency?',a:'Loads from slow tiers sit on the critical path of TTFT; under contention (PCIe busy, remote store slow) a "hit" can take longer than recomputing. Implementations need timeouts and fallback to recompute.'},
    {q:'How does offload relate to preemption swap?',a:'Swap preemption moves an in-flight sequence\'s KV to CPU to free GPU blocks; offload tiers keep finished or idle prefixes for future reuse. Same hardware path, different purpose.'},
    {q:'Shared remote KV store across tenants: concerns?',a:'KV tensors are derived from customer prompts and can leak content; isolate per tenant (salt/namespace), encrypt, restrict access, and set retention like any other customer data.'}
  ],
  tradeoffs:`<ul><li><b>More tiers</b>: higher effective hit rate vs complexity and host resources.</li><li><b>Remote tiers</b>: cross-node reuse vs network latency.</li></ul>`,
  failures:`<ul><li><b>OOMKilled pods</b> → CPU offload exceeds pod memory limit.</li><li><b>TTFT p99 worse</b> → slow tier loads → timeouts, fallback.</li><li><b>Version mismatch</b> between engine and connector → disable and pin.</li></ul>`,
  vocab:[
    {term:'KV offloading',def:'Moving KV blocks from GPU memory to CPU, SSD or remote storage.'},
    {term:'Tiered cache',def:'Hierarchy of storage levels with different capacity and speed.'},
    {term:'KV connector',def:'vLLM plug-in interface for transferring KV to other workers or tiers.'},
    {term:'KVBM',def:'Dynamo KV Block Manager.'},
    {term:'Recompute vs reload',def:'The core trade-off: re-run prefill or fetch stored KV.'}
  ],
  mistakes:[
    'Assuming offload is free.',
    'Forgetting host memory limits in Kubernetes.',
    'Using PCIe total bandwidth as one-direction bandwidth.',
    'Ignoring data protection for stored KV.'
  ],
  related:['v2-distributed-kv','v1-kv-cache','v2-distributed-inference']
},
{
  id:'cch-09', chapter:'v3-ch-caching', difficulty:2,
  title:'How do you measure whether caching is working?',
  understand:'They want per-layer metrics, token-weighted hit rates, correctness metrics, latency split by hit and miss, memory cost, and the business metric that ties them together.',
  short:'Per layer, and always with a correctness metric next to the hit rate. For response and semantic caches: hit rate, wrong-hit rate from sampled review and user flags, latency for hits versus misses, staleness incidents, and invalidation volume. For prefix caching: token-weighted hit rate from the engine\'s prefix-cache hits over queries, prefill tokens per request, TTFT p95 and per-replica hit rates to catch routing problems. For provider caching: cache-read and cache-write tokens from the usage fields. Then the business view: cost per successful request and GPU-hours for the same traffic. A high hit rate is not success if hits are stale, leak data, or merely add memory pressure.',
  detailed:`
${table(['Layer','Metrics','Source'],[
 ['Exact / semantic response','hit rate, wrong-hit rate, p95 latency hit vs miss, staleness incidents, purge counts','gateway/cache metrics, review sampling'],
 ['Retrieval / embedding','hit rate, index version skew, recall on eval set','app metrics, offline eval'],
 ['Engine prefix cache','rate(vllm:prefix_cache_hits) / rate(vllm:prefix_cache_queries), prompt tokens, TTFT, per replica','vLLM /metrics'],
 ['Provider prompt cache','cache_read_input_tokens, cache_creation_input_tokens, input_tokens; OpenAI cached_tokens','API usage fields'],
 ['KV tiers','tier hits, load latency, evictions','engine/connector metrics'],
 ['Business','cost per successful request, GPU-hours per 1k requests, quality score','FinOps + eval']
])}
${formula(`
Token-weighted prefix hit rate (what saves compute)
          Σ cached prompt tokens
  h_t = ────────────────────────
          Σ prompt tokens queried

Request-weighted hit rate can mislead:
  90 short prompts hit 100 % (100 tokens each) + 10 long prompts miss (10,000 each)
  request hit ≈ 90 %, token hit = 9,000 / 109,000 ≈ 8 %
`)}
<p>Check the exact semantics of each metric in your engine version's metric help text (for example whether a counter is in tokens or requests) before building dashboards.</p>
<h3>Dashboards and alerts</h3>
<ul><li>Hit-rate drop alerts per layer (often the first sign of a prompt-template regression).</li><li>Wrong-hit rate SLO for response caches.</li><li>Load skew across replicas when cache-aware routing is on.</li><li>Cache memory usage vs KV pressure on engines.</li></ul>
<h3>Segment the metrics</h3><p>Fleet-wide averages hide the problems that matter. Break hit rates down by tenant, by prompt template version, by language and by replica. A tenant with a 5 % prefix hit rate while others sit at 80 % usually has volatile content at the top of its prompts; one replica with a low hit rate usually indicates a routing or restart problem. For provider caching, segment by model, because minimum cacheable lengths and multipliers differ per model.</p><h3>Tie to money</h3><p>Translate each layer's metric into its line item: response-cache hits into avoided requests, prefix hits into prefill GPU-seconds or cached-input tokens, and wrong hits into support cost. Present the net figure monthly next to cost per successful request.</p>`,
  diagram:fig('Hit rate is not the goal', svgDiagram({w:900,h:200,
    boxes:[
      {id:'h',x:20,y:70,w:180,h:60,label:'Hit rate',sub:'token-weighted',cls:'v1'},
      {id:'c',x:230,y:70,w:180,h:60,label:'Correctness',sub:'wrong hits, staleness',cls:'bad'},
      {id:'l',x:440,y:70,w:180,h:60,label:'Latency',sub:'hit vs miss',cls:'v2'},
      {id:'b',x:650,y:70,w:230,h:60,label:'Cost per successful request',cls:'hl'}
    ],
    arrows:[{from:'h',to:'b'},{from:'c',to:'b'},{from:'l',to:'b'}]
  }), 'Every cache dashboard needs a correctness panel next to the hit-rate panel.'),
  followups:[
    {q:'Prefix hit rate is high but TTFT did not improve. Why?',a:'TTFT may be dominated by queueing or pre-engine work, or hits are on short prefixes while long prompts miss (request-weighted vs token-weighted). Break TTFT down and use token-weighted hit rate.'},
    {q:'How do you estimate wrong-hit rate cheaply?',a:'Sample hits, re-run the request without cache, and have a judge model or human compare; plus count user flags. Report with confidence intervals.'},
    {q:'What does a sudden fleet-wide hit-rate drop at a deploy time suggest?',a:'Prompt template or tool schema change, tokenizer/model change, or router change. Diff the rendered prompts before and after.'}
  ],
  tradeoffs:`<ul><li><b>More sampling for correctness</b>: better confidence, more cost.</li><li><b>Fine-grained metrics</b> (per tenant/prefix): useful, cardinality cost.</li></ul>`,
  failures:`<ul><li><b>Celebrating a high hit rate on stale content</b> → no staleness metric.</li><li><b>Dashboard shows request hit rate</b> → misleading savings.</li><li><b>Cardinality explosion</b> from per-prefix labels → aggregate.</li></ul>`,
  vocab:[
    {term:'Token-weighted hit rate',def:'Cached prompt tokens divided by all prompt tokens.'},
    {term:'Wrong-hit rate',def:'Share of cache hits that returned an incorrect or unauthorised answer.'},
    {term:'Load skew',def:'Imbalance across replicas, often caused by affinity routing.'},
    {term:'Usage fields',def:'Provider API counts of cached and uncached tokens per request.'}
  ],
  mistakes:[
    'Reporting hit rate without correctness.',
    'Request-weighted instead of token-weighted hit rates.',
    'Not splitting latency by hit and miss.'
  ],
  related:['v2-cache-ops','v2-ai-observability','v2-finops-unit-economics']
},
{
  id:'cch-10', chapter:'v3-ch-caching', difficulty:1,
  title:'When should you avoid caching an LLM response?',
  understand:'A judgement question. They want concrete categories where response caching is wrong (personal, live, side-effecting, safety-critical, high-variance), and the alternative caches that are still safe in those cases.',
  short:'I avoid caching responses whenever the answer depends on something the key cannot safely capture or that changes too fast. Personal answers: anything using the user\'s bookings, profile or private documents. Live facts: fares, seat availability, flight status, which in travel change by the minute and must come from tools. Anything with side effects: an agent\'s action must never be replayed from cache. Safety- or compliance-sensitive decisions where every answer must be fresh and auditable. And creative or high-temperature outputs where users expect variety. In those cases I still cache lower layers that are safe: the shared system-prompt prefix in the engine, embeddings, and retrieval results with permission checks, so latency improves without serving someone the wrong answer.',
  detailed:`
${table(['Situation','Why not cache the response','What to cache instead'],[
 ['Personal context (my booking, my refund)','key would need user id → near-zero reuse; leak risk','prefix (system + tools), retrieval of public policy'],
 ['Live data (fares, availability, status)','stale within minutes; wrong answers cost money','nothing for the facts; prefix for instructions'],
 ['Agent actions / tool calls with side effects','replay could double-book or double-refund','idempotency keys at the tool, not response caching'],
 ['Regulated or safety-critical decisions','need fresh evaluation and audit trail','retrieval cache with versioning; full logging'],
 ['High-temperature creative tasks','users expect variety','prefix caching'],
 ['Rapidly changing policies','invalidation overhead > savings','short-TTL retrieval cache with doc versions']
])}
<h3>Travel example</h3>
<p>"What is the baggage allowance on economy saver from Riyadh to Dubai?" is a published policy: cacheable with doc-version scoping (and locale). "Can I still cancel booking ABC123 for free?" depends on the booking, the fare rules and the current time: never response-cache it; cache the policy retrieval and the system prompt prefix.</p>
${formula(`
Rule of thumb: cache a response only if
  (1) the answer is a pure function of key dimensions you can enumerate,
  (2) a wrong or stale hit is cheap relative to the saving,
  (3) no side effects are attached to producing it.
`)}
<h3>Making it enforceable</h3><p>Do not rely on developers remembering these rules. Classify request types at the gateway (for example by route or by an intent label), attach a caching policy to each class (cacheable, cacheable-with-scope, never), and mark responses non-cacheable automatically when generation touched personal data, live-data tools or side-effecting tools. Log the decision with the request so audits can show why something was or was not served from cache. Review the policy table whenever a new tool or data source is added to the assistant, because a new tool can silently turn a cacheable request class into a non-cacheable one.</p>`,
  diagram:fig('Decide per request class', svgDiagram({w:900,h:220,
    boxes:[
      {id:'q',x:20,y:80,w:150,h:60,label:'Request class',cls:'v1'},
      {id:'p',x:230,y:20,w:180,h:50,label:'Personal?',cls:'warn'},
      {id:'l',x:230,y:85,w:180,h:50,label:'Live facts?',cls:'warn'},
      {id:'s',x:230,y:150,w:180,h:50,label:'Side effects?',cls:'bad'},
      {id:'n',x:480,y:85,w:180,h:50,label:'Any yes → no response cache',cls:'bad'},
      {id:'y',x:700,y:85,w:180,h:50,label:'Else: cache with scope',cls:'ok'}
    ],
    arrows:[{from:'q',to:'p'},{from:'q',to:'l'},{from:'q',to:'s'},{from:'p',to:'n'},{from:'l',to:'n'},{from:'s',to:'n'},{from:'n',to:'y',cls:'dash',label:'otherwise'}]
  }), 'Lower-layer caches (prefix, retrieval) still apply when response caching is ruled out.'),
  followups:[
    {q:'Product wants all repeated questions cached to cut cost. How do you respond?',a:'Show the request-class breakdown with expected savings and risk per class; cache the safe classes now, and for the rest use prefix and retrieval caching, which give much of the latency benefit without correctness risk.'},
    {q:'How do you stop a cached answer from embedding stale live data?',a:'Never cache responses that included tool results for live data; mark such responses non-cacheable at generation time based on which tools ran.'},
    {q:'Is it ever OK to cache personal answers?',a:'Per-user caches with short TTLs for repeated identical requests (for example a user refreshing) can be acceptable if scoped to the user and encrypted, but the saving is small; usually not worth the risk.'}
  ],
  tradeoffs:`<ul><li><b>Caching fewer classes</b>: safer, smaller savings.</li><li><b>Lower-layer caching</b>: safe latency wins, smaller cost wins.</li></ul>`,
  failures:`<ul><li><b>Customer sees another customer\'s booking details</b> → personal response cached.</li><li><b>Wrong fare quoted</b> → live data cached.</li><li><b>Duplicate refund</b> → cached action replay.</li></ul>`,
  vocab:[
    {term:'Non-cacheable marker',def:'Flag set on a response when its generation used personal or live data.'},
    {term:'Idempotency key',def:'Identifier that makes a repeated action request safe to retry.'},
    {term:'Request class',def:'Category of requests sharing caching rules.'}
  ],
  mistakes:[
    'Caching everything by default.',
    'Caching responses that included live tool results.',
    'Forgetting that prefix and retrieval caches remain available.'
  ],
  related:['v2-response-semantic-cache','v2-cache-ops','v2-agents']
},
{
  id:'cch-11', chapter:'v3-ch-caching', difficulty:2,
  title:'Prefix-cache hit rate dropped from 80 % to 15 % after a release. How do you debug it?',
  understand:'A debugging drill. They want a hypothesis list ordered by likelihood, the evidence for each (render and diff prompts, routing, eviction, versions), and a fix plus prevention.',
  short:'A drop that coincides with a release usually means the prompts stopped being byte-identical at the start. So first I render the exact token sequence of a few requests from before and after, and diff them. Typical culprits are a timestamp, request id or user name moved into the system prompt, tool definitions serialised in a different order, a new template or tokenizer version, or a per-user cache salt. If prompts are stable, I check routing: did the release change the router or replica count so sessions spread out? Then memory: did context limits or concurrency change so cached blocks are evicted before reuse? Then versions: new model revision or adapter ids mean a cold cache that should recover. I fix the cause and add a canary check on hit rate to the release gate.',
  detailed:`
<div class="dtree"><ul><li><span class="q">Are the first tokens identical across requests?</span><ul>
<li><span class="a">no</span> Volatile content early (timestamp, date, request id, user name, A/B flag), non-deterministic JSON key order for tools, changed whitespace or template → move volatile content to the end, canonicalise serialisation.</li>
<li><span class="a">yes</span><ul>
<li><span class="q">Same model revision / adapter / salt?</span> New weights or LoRA id → new hashes; expect warm-up, not a permanent drop. A cache salt per user instead of per tenant → isolation too fine.</li>
<li><span class="q">Routing changed?</span> More replicas, router mode changed, session affinity lost → per-replica hit rates fall evenly → restore cache-aware routing.</li>
<li><span class="q">Eviction pressure?</span> KV usage near 100 % with new longer contexts or higher max-num-seqs → cached blocks evicted (LRU) before reuse → capacity, context caps, CPU tier.</li>
<li><span class="q">Provider caching?</span> Prompt shrank below the minimum cacheable length, traffic gaps exceed TTL, breakpoint placement changed.</li></ul></li></ul></li></ul></div>
${formula(`
Impact check (illustrative): 3,500-token prompts, 40 req/s
  hit 80 % → uncached ≈ 700 tokens/request → 28,000 prefill tok/s
  hit 15 % → uncached ≈ 2,975 tokens/request → 119,000 prefill tok/s  (≈ 4.25×)
  → TTFT and GPU load rise sharply even though nothing "broke"
`)}
<h3>Evidence</h3>
<ul><li>Rendered prompts (with the tokenizer) diffed before vs after; compare the first 256 tokens.</li><li><code>vllm:prefix_cache_hits</code>/<code>queries</code> per replica and per model.</li><li><code>vllm:kv_cache_usage_perc</code>, waiting requests.</li><li>Router logs: chosen worker and overlap per request.</li><li>Provider usage fields: <code>cache_read_input_tokens</code> vs <code>cache_creation_input_tokens</code>.</li></ul>
<h3>Prevention</h3>
<p>A prompt-stability unit test (render the template twice with different volatile inputs and assert the static prefix is identical), a canary gate on prefix hit rate and TTFT, and an owner for the system prompt layout.</p>
<h3>Communicating the fix</h3><p>Report the incident in business terms: prefill load rose about 4× and TTFT p95 rose with it, caused by a prompt-layout change; fixed by moving volatile content to the end; prevented by a prompt-stability test and a hit-rate gate in the canary. This turns a cache detail into a release-engineering improvement.</p>`,
  diagram:fig('Debug order', svgDiagram({w:900,h:200,
    boxes:[
      {id:'a',x:20,y:70,w:160,h:60,label:'Diff prompts',sub:'first tokens',cls:'hl'},
      {id:'b',x:205,y:70,w:160,h:60,label:'Versions',sub:'model, adapter, salt',cls:'v1'},
      {id:'c',x:390,y:70,w:160,h:60,label:'Routing',sub:'per-replica hits',cls:'v2'},
      {id:'d',x:575,y:70,w:160,h:60,label:'Eviction',sub:'KV pressure',cls:'warn'},
      {id:'e',x:760,y:70,w:120,h:60,label:'Gate it',sub:'canary check',cls:'ok'}
    ],
    arrows:[{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'d'},{from:'d',to:'e'}]
  }), 'Most hit-rate regressions are prompt-layout regressions.'),
  followups:[
    {q:'The diff shows only a date string at the top of the system prompt. Quick fix?',a:'Move the date to the end of the prompt (or into the user message), redeploy, and confirm hit rate recovers; check that the model still uses the date correctly via eval.'},
    {q:'Hit rate recovered for English but not Arabic. Why?',a:'Arabic prompts might use a different template or locale-specific system prompt that still has volatile content, or text normalisation differs; render and diff the Arabic path specifically.'},
    {q:'Why might hit rate drop only at peak hours?',a:'KV pressure evicts cached prefix blocks under load (LRU), and autoscaling adds cold replicas; it is capacity, not prompt layout.'}
  ],
  tradeoffs:`<ul><li><b>Strict prompt layout rules</b> slow product iteration slightly but protect cost and TTFT.</li><li><b>Per-tenant salts</b>: isolation vs lower sharing.</li></ul>`,
  failures:`<ul><li><b>Silent cost increase</b> after release → hit rate not monitored.</li><li><b>TTFT SLO breach</b> at same traffic → prefill load up 4×.</li></ul>`,
  vocab:[
    {term:'Prompt stability',def:'Property that the static prefix of a prompt is byte-identical across requests.'},
    {term:'Release gate',def:'Automated check that blocks rollout when a metric regresses.'},
    {term:'LRU eviction',def:'Removing least recently used cached blocks first when memory is needed.'},
    {term:'Cache salt',def:'Value mixed into the first block hash to isolate caches.'}
  ],
  mistakes:[
    'Restarting engines to "fix" the cache.',
    'Assuming the engine is broken before diffing prompts.',
    'Ignoring per-replica hit rates (routing).'
  ],
  related:['v2-prefix-kv-cache','v2-cache-ops','v3-debugging']
}
]);
