/* Volume 2, Part 5: Retrieval-augmented generation (RAG) */
registerLesson({
  id:'v2-rag-fundamentals', vol:2, part:5, num:1,
  title:'RAG fundamentals: embeddings, vector databases, chunking, hybrid search, reranking', minutes:95,
  summary:'Retrieval-augmented generation answers questions from your own documents. Documents are cut into chunks, turned into vectors by an embedding model and stored in an index. At question time the system finds the most relevant chunks, usually by combining keyword search with vector search, reorders them with a more careful reranker, and hands only the best few to the language model with citations. Most RAG quality problems are retrieval problems, so this lesson teaches each retrieval stage with real numbers.',
  objectives:[
    'Explain the ingestion path and the query path of a RAG system and what each stage produces.',
    'Compute cosine similarity, vector index memory, chunk counts and pgvector IVF parameters by hand.',
    'Explain how HNSW and IVF approximate nearest-neighbour search trade recall for speed.',
    'Choose a chunking strategy (fixed, recursive, structure-aware, semantic, late chunking, contextual retrieval) for a document type.',
    'Fuse BM25 and dense results with reciprocal rank fusion (k = 60) and explain why a reranker comes after fusion.',
    'Diagnose retrieval failures with recall@k before blaming the language model.'
  ],
  prereqs:['v1-tokenization-embeddings','v1-generation','v1-ai-apps-tools'],
  next:['v2-rag-production','v2-rag-weight-cache','v2-evaluation-monitoring'],
  tags:['rag','retrieval','vector-db','search'],
  html:`
<h2>1. What is it?</h2>
${callout('analogy','Analogy (only to start)','An open-book exam. The student (the language model) is clever but does not know your company policies. Before answering, a librarian finds the three most relevant pages and puts them on the desk. The answer is only as good as the pages the librarian picked. Now the real mechanism.')}
<p>${term('Retrieval-augmented generation')} (RAG) is a pattern, not a product. At request time the system <b>retrieves</b> passages from a corpus you control, <b>augments</b> the prompt with them, and the model <b>generates</b> an answer grounded in those passages, ideally with citations. Nothing about the model's weights changes. The model is not "trained on your documents"; it reads a few of them, freshly, for every request.</p>
<p>A RAG system has two pipelines that share one index:</p>
<ul>
<li><b>Ingestion (offline or streaming):</b> load documents → parse (PDF, HTML, Confluence, database rows) → split into ${term('Chunking','chunks')} → compute an embedding vector per chunk → write vectors plus text plus metadata (document id, version, tenant, ACL groups, language) into a ${term('Vector database','vector index')} and usually a keyword index too.</li>
<li><b>Query (online, per request):</b> embed the question → search the indexes (dense, lexical, or both) → filter by permission → fuse → rerank → assemble a bounded context → call the LLM → return the answer with sources.</li>
</ul>

<h2>2. Why do we need it?</h2>
<p>Three problems that neither prompting nor fine-tuning solves well:</p>
<ol>
<li><b>Changing knowledge.</b> Refund rules, visa requirements, fare conditions and runbooks change weekly. Fine-tuning bakes yesterday's facts into weights and needs a new training run, a new evaluation and a new release for every edit. Retrieval reads the current version.</li>
<li><b>Provenance.</b> An answer that cites "Refund policy POL-114, section 3.2, version 7" can be checked. A fine-tuned model cannot tell you where a fact came from.</li>
<li><b>Authorization.</b> Different users may see different documents. Retrieval can filter by the caller's identity before the model sees anything. Weights cannot be filtered per user.</li>
</ol>
<p>Fine-tuning is still the right tool for <i>behaviour</i>: tone, output format, domain vocabulary, tool-use style (${L('v1-finetuning','fine-tuning lesson')}). The rule of thumb from the old interview book is correct and worth keeping: decide what is missing — knowledge, behaviour, or both — and use RAG for knowledge, fine-tuning for behaviour.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 Embeddings: text becomes coordinates</h3>
<p>An embedding model (a ${term('Bi-encoder','bi-encoder')}: one transformer pass per text, independent of the query) maps a chunk to a fixed-length vector, for example 1,024 numbers. Texts with similar meaning land close together. Similarity is usually <b>cosine similarity</b>: the cosine of the angle between two vectors.</p>
${formula(`
                    q · d             Σᵢ qᵢ dᵢ
   cos(q, d)  =  ─────────  =  ─────────────────
                  ‖q‖ ‖d‖       √(Σ qᵢ²) √(Σ dᵢ²)

STEP 1  toy 2-dimensional vectors (real ones have 384–4,096 dims)
        q  = (0.6, 0.8)      "how do I get a refund"
        d₁ = (0.8, 0.6)      chunk: "Refunds are issued within 14 days…"
        d₂ = (−0.6, 0.8)     chunk: "Baggage allowance on domestic flights…"

STEP 2  all three already have length 1  (0.6² + 0.8² = 1)
        cos(q, d₁) = 0.6 × 0.8 + 0.8 × 0.6   = 0.48 + 0.48 = 0.96
        cos(q, d₂) = 0.6 × (−0.6) + 0.8 × 0.8 = −0.36 + 0.64 = 0.28

STEP 3  pgvector's <=> operator returns cosine DISTANCE = 1 − cos
        d₁ → 0.04      d₂ → 0.72      ORDER BY distance ascending → d₁ first

ANSWER  d₁ is retrieved. If vectors are normalised to length 1,
        cosine similarity = dot product, which is cheaper to compute.
`)}
<p>Embedding vectors are <b>coordinates, not facts</b>. A high cosine score means "talks about similar things", not "answers the question". "How do I get a refund?" and "Refunds are never available" are close in embedding space. That is why a reranker and evaluation exist.</p>
<p>Practical embedding facts (as of Oct 2026, from the providers' documentation):</p>
${table(['Model','Dims','Max input','Notes'],[
 ['OpenAI <code>text-embedding-3-small</code> / <code>-large</code>','1,536 / 3,072','8,192 tokens','<code>dimensions</code> parameter shortens vectors by dropping trailing values'],
 ['BAAI <code>bge-m3</code>','1,024','8,192 tokens','dense + sparse (lexical) + multi-vector outputs; 100+ languages, so a sensible default for Arabic + English'],
 ['Qwen3-Embedding 0.6B / 4B / 8B','1,024 / 2,560 / 4,096','32K tokens','100+ languages; supports shortened (Matryoshka-style) dims'],
 ['<code>nomic-embed-text-v1.5</code>','768 → 64','8,192 tokens',term('Matryoshka embeddings','Matryoshka')+' dims 768/512/256/128/64; needs task prefixes <code>search_query:</code> / <code>search_document:</code>'],
 ['Cohere <code>embed-v4.0</code>','256–1,536','128k','<code>input_type</code> = <code>search_document</code> or <code>search_query</code>; newer embed-v5.0 models exist']
])}
${callout('warn','Two rules that break silently','<b>1. Query and documents must be embedded by the same model and version.</b> Vectors from different models live in different coordinate systems; mixing them returns plausible-looking garbage with no error. <b>2. Respect asymmetric prefixes.</b> Models such as nomic and Cohere expect different markers for queries and documents; forgetting them lowers recall without any error message.')}

<h3>3.2 Why exact search does not scale, and what ANN indexes do</h3>
${formula(`
Corpus: 10,000,000 chunks × 1,024 dims, float32 (4 bytes)

STEP 1  raw vector memory
        10⁷ × 1,024 × 4 B = 40,960,000,000 B = 40.96 GB ≈ 38.1 GiB

STEP 2  exact (brute-force) search reads every vector for every query
        bytes read per query      = 40.96 GB
        at 100 queries/second     = 4,096 GB/s
                                     ↑ more than the HBM bandwidth of one H100 (3.35 TB/s)

STEP 3  compressed storage of the same vectors
        float16 / halfvec  (2 B)   → 20.48 GB
        int8               (1 B)   → 10.24 GB
        binary (1 bit/dim) 128 B   →  1.28 GB
        Elastic BBQ: 1 bit/dim + 14 B correction = 142 B → 1.42 GB

ANSWER  Production systems use approximate nearest-neighbour (ANN) indexes
        that look at a tiny fraction of vectors, often over compressed vectors,
        and accept recall slightly below 100 %.
`)}
<p>Two ANN families dominate:</p>
<p><b>${term('HNSW')}</b> (Hierarchical Navigable Small World, Malkov &amp; Yashunin, arXiv 1603.09320) builds a multi-layer proximity graph. Every vector is in layer 0; a random, exponentially shrinking subset is also in higher layers. A search enters at the top layer, greedily walks to the neighbour closest to the query, drops one layer, and repeats. At layer 0 it keeps a candidate list of size <code>ef_search</code> and returns the best k.</p>
${formula(`
HNSW layer sizes with m = 16 (level probability P(level ≥ l) = m⁻ˡ)

   layer 0 : 10,000,000 nodes        (every vector, up to 2m = 32 links each)
   layer 1 : 10⁷ / 16      =   625,000
   layer 2 : 10⁷ / 256     ≈    39,063
   layer 3 : 10⁷ / 4,096   ≈     2,441
   layer 4 : 10⁷ / 65,536  ≈       153
   layer 5 :                ≈        10   ← entry point lives up here

Link storage at layer 0 (rough, implementation-dependent)
   10⁷ × 32 links × 4 B per id ≈ 1.28 GB   on top of the vectors themselves
`)}
${anim('v2-rag-hnsw-search')}
<p>The knobs: <code>m</code> (links per node: more = better recall, more memory, slower build), <code>ef_construction</code> (build-time candidate list), and <code>ef_search</code> (query-time candidate list: the main recall-versus-latency dial). pgvector's defaults are <code>m = 16</code>, <code>ef_construction = 64</code>; Elasticsearch's dense_vector HNSW defaults are <code>m = 16</code>, <code>ef_construction = 100</code>.</p>
<p><b>${term('IVF')}</b> (inverted file) runs k-means to split vectors into <code>lists</code> clusters. A query compares itself with the centroids, then scans only the <code>probes</code> nearest clusters. pgvector's guidance:</p>
${formula(`
lists  = rows / 1,000          for up to 1M rows
       = √rows                 for more than 1M rows
probes : start with √lists

STEP 1  500,000 rows  → lists = 500,000 / 1,000 = 500   → probes ≈ √500 ≈ 22
STEP 2  4,000,000 rows → lists = √4,000,000 = 2,000     → probes ≈ √2,000 ≈ 45
STEP 3  fraction scanned for 4M rows ≈ 45 / 2,000 = 2.25 % of the vectors

ANSWER  IVF builds fast and uses little extra memory, but recall drops if the data
        drifts away from the centroids it was trained on (rebuild after big changes).
        HNSW gives better recall/latency at the cost of memory and slower builds.
`)}

<h3>3.3 Vector stores you will meet (as of Oct 2026)</h3>
${table(['Store','Shape','Facts worth knowing'],[
 ['pgvector (v0.8.7)','Postgres extension','HNSW and IVFFlat; types <code>vector</code>, <code>halfvec</code>, <code>sparsevec</code>, <code>bit</code>; HNSW index up to 2,000 dims for <code>vector</code>, 4,000 for <code>halfvec</code>; operators <code>&lt;-&gt;</code> L2, <code>&lt;#&gt;</code> negative inner product, <code>&lt;=&gt;</code> cosine distance'],
 ['Elasticsearch (9.5.x) / OpenSearch (3.9.x)','search engines with vectors','BM25 and kNN in one engine; native RRF (<code>rank_constant</code> default 60); Elastic BBQ quantization; OpenSearch hybrid query via search pipelines'],
 ['Qdrant (1.19.x), Weaviate (1.40.x), Milvus (3.0.x)','dedicated vector databases','payload/metadata filtering, sharding, replication, quantization options'],
 ['Pinecone','managed serverless','dense, sparse or integrated-embedding indexes; cloud and region cannot be changed after a serverless index is created — a data-residency decision made on day one'],
 ['Chroma (1.5.9), LanceDB (0.40), Vespa','embedded / lakehouse / large-scale serving','good for labs (Chroma, LanceDB) or very large ranking workloads (Vespa)']
])}
${callout('devops','DevOps bridge: start with the database you already operate','If you already run PostgreSQL with backups, failover, IAM and monitoring, pgvector gives you vectors with row-level security, joins to business tables and one fewer system. Move to a dedicated engine when measured scale (vectors, QPS, filter complexity) demands it, not because a diagram says "vector DB". Where the analogy breaks: ANN indexes are memory-hungry and slow to build, so they behave less like a B-tree and more like a cache you must warm.')}
${code('sql',`CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE chunks (
  id          bigserial PRIMARY KEY,
  doc_id      text NOT NULL,
  doc_version int  NOT NULL,
  tenant_id   text NOT NULL,
  acl_groups  text[] NOT NULL,
  lang        text,
  body        text NOT NULL,
  embedding   vector(1024) NOT NULL
);
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
-- query: $1 = query vector, $2 = tenant, $3 = caller's groups
SELECT id, doc_id, 1 - (embedding <=> $1) AS cosine
FROM chunks
WHERE tenant_id = $2 AND acl_groups && $3
ORDER BY embedding <=> $1
LIMIT 50;`)}

<h3>3.4 Chunking: the decision that most affects retrieval</h3>
<p>Embedding models have input limits and, more importantly, a single vector cannot represent a 40-page document well. So documents are split. Too small and a chunk loses its context ("it must be submitted within 7 days" — what must?). Too large and the vector blurs several topics and wastes prompt tokens.</p>
${formula(`
Fixed-size chunking with overlap
                    ⌈ L − c ⌉
   chunks  n  =     │───────│ + 1          L = doc tokens, c = chunk size, o = overlap
                    ⌈ c − o ⌉

STEP 1  L = 10,000 tokens, c = 512, o = 64 → stride = 512 − 64 = 448
STEP 2  n = ⌈(10,000 − 512) / 448⌉ + 1 = ⌈21.18⌉ + 1 = 22 + 1 = 23 chunks
STEP 3  check: chunk 23 starts at 22 × 448 = 9,856 and ends at 10,368 ≥ 10,000 ✓
STEP 4  stored tokens = 23 × 512 = 11,776 → 17.8 % more than the document

ANSWER  Overlap protects sentences cut at a boundary but costs embedding
        compute, storage and duplicate hits in the top-k.
`)}
${table(['Strategy','How it splits','Good for','Watch out'],[
 ['Fixed-size (+ overlap)','every c tokens','uniform text, quick baseline','cuts tables, sentences and headings in half'],
 ['Recursive','tries separators in order: sections → paragraphs → sentences → words, until under the size limit','most prose; the common default in frameworks','still blind to document semantics'],
 ['Structure-aware','by headings, list items, table rows, HTML/Markdown elements, PDF layout; keeps heading path as metadata','policies, runbooks, contracts, FAQs — Atlas policy docs','needs a good parser; scanned PDFs need OCR'],
 ['Semantic','embeds sentences and starts a new chunk where similarity between neighbours drops','long unstructured text with topic shifts','costs an embedding pass at ingest; thresholds need tuning'],
 [term('Late chunking'),'runs a long-context embedding model over the whole document first, then mean-pools token embeddings per chunk (Jina AI, arXiv 2409.04701)','chunks that depend on earlier context (pronouns, "this fee")','needs a long-context embedding model; doc must fit its window'],
 [term('Contextual retrieval'),'an LLM writes a short chunk-specific context ("This section of the 2026 refund policy covers…") that is prepended before embedding and BM25 indexing (Anthropic, Sep 2024)','large heterogeneous corpora','one LLM call per chunk at ingest; prompt caching of the parent document makes it affordable']
])}
<p>Anthropic's published numbers for contextual retrieval (their benchmark, top-20 retrieval failure rate): contextual embeddings cut failures from 5.7 % to 3.7 % (−35 %); adding contextual BM25 reached 2.9 % (−49 %); adding a reranker reached 1.9 % (−67 %). Treat these as evidence that the stages compound, not as numbers you will reproduce on your corpus.</p>
<p>Always store metadata with each chunk: document id and version, heading path, page, language, tenant, ACL groups, effective date. Retrieval filters, citations, freshness and deletion all depend on it.</p>

<h3>3.5 Lexical search: BM25</h3>
<p>Dense vectors are weak at exact tokens: booking references, flight numbers ("SV 1234"), error codes ("Xid 79"), SKU-like policy ids ("POL-114") and rare names. ${term('BM25')} is the classic lexical ranking function used by Lucene, Elasticsearch and OpenSearch.</p>
${formula(`
                       f(t, D) · (k₁ + 1)
score(D, Q) = Σ IDF(t) · ──────────────────────────────────────
             t∈Q        f(t, D) + k₁ · (1 − b + b · |D| / avgdl)

f(t,D) = term frequency in chunk D     |D| = chunk length     avgdl = average length
k₁ = 1.2 and b = 0.75 are Lucene's defaults

                   N − n(t) + 0.5
IDF(t) = ln( 1 + ──────────────── )     N = chunks, n(t) = chunks containing t
                    n(t) + 0.5

STEP 1  N = 1,000 chunks; "PNR" appears in 5, "booking" in 400
        IDF(PNR)     = ln(1 + 995.5 / 5.5)   = ln(182.0) = 5.20
        IDF(booking) = ln(1 + 600.5 / 400.5) = ln(2.50)  = 0.92
                       ↑ the rare term weighs about 5.7× more

STEP 2  term-frequency saturation for an average-length chunk (|D| = avgdl)
        f = 1  → 1 × 2.2 / (1 + 1.2)   = 1.00
        f = 3  → 3 × 2.2 / (3 + 1.2)   = 1.57
        f = 10 → 10 × 2.2 / (10 + 1.2) = 1.96   → never above k₁ + 1 = 2.2

ANSWER  BM25 rewards rare, exact terms and stops rewarding keyword stuffing.
`)}
<p>For Arabic, lexical search needs a language analyzer (normalising letter variants, stripping prefixes such as the definite article) or recall collapses; Elasticsearch and OpenSearch ship Arabic analyzers. Multilingual dense models (bge-m3, Qwen3-Embedding) help cross-language queries such as an English question over Arabic policy text.</p>

<h3>3.6 Hybrid search and reciprocal rank fusion</h3>
<p>${term('Hybrid search')} runs dense and lexical retrieval and merges the lists. Their scores are on different scales (cosine 0–1, BM25 unbounded), so adding raw scores is meaningless. ${term('Reciprocal rank fusion')} ignores scores and uses only ranks (Cormack, Clarke &amp; Büttcher, SIGIR 2009):</p>
${formula(`
                      1
RRF(d) =  Σ      ───────────          k = 60 (fixed in the paper; "near-optimal,
         r ∈ R    k + rank_r(d)                but the choice was not critical")
                                       Elasticsearch rank_constant and OpenSearch
                                       score-ranker rank_constant both default to 60

BM25 ranks : P03 = 1   P31 = 2   P12 = 3
Dense ranks: P12 = 1   P03 = 2   P44 = 3

STEP 1  P03 = 1/(60+1) + 1/(60+2) = 0.016393 + 0.016129 = 0.032522
STEP 2  P12 = 1/(60+3) + 1/(60+1) = 0.015873 + 0.016393 = 0.032266
STEP 3  P31 = 1/(60+2)            = 0.016129     (BM25 only)
STEP 4  P44 = 1/(60+3)            = 0.015873     (dense only)

ANSWER  fused order: P03, P12, P31, P44
        Documents found by BOTH retrievers rise to the top.

Why k = 60 and not 0?  ratio of rank-1 to rank-10 contribution
        k = 0  : (1/1) / (1/10)  = 10×     → one retriever's #1 dominates
        k = 60 : (1/61) / (1/70) = 1.15×   → agreement across lists matters more
`)}
<p>The alternative, <b>score normalisation + weighted sum</b> (min-max each list, then α·dense + (1−α)·lexical), can beat RRF when tuned on labelled data, but the weights drift whenever the corpus or models change. RRF is the robust default.</p>

<h3>3.7 Reranking: precision after recall</h3>
<p>The first stage is tuned for <b>recall</b> (do not miss the right chunk) over millions of chunks, so it must be cheap: one vector per chunk, compared with one query vector. A ${term('Reranker')} is tuned for <b>precision</b> over a few dozen candidates. A ${term('Cross-encoder')} feeds the query and a candidate <i>together</i> through a transformer and outputs one relevance score, so every query token can attend to every chunk token. That is far more accurate and far more expensive: it cannot be precomputed.</p>
${formula(`
Reranker cost per query (ILLUSTRATIVE inputs — measure your own)

STEP 1  candidates after fusion        = 50
STEP 2  tokens per pair (query + chunk) ≈ 30 + 400 = 430
STEP 3  tokens through the reranker    = 50 × 430 = 21,500 tokens per query
STEP 4  assume a measured 200,000 tok/s on one GPU for your reranker
        latency contribution ≈ 21,500 / 200,000 = 0.11 s ;  max ≈ 9 queries/s/GPU

ANSWER  Rerank 50, not 500. Rerank cost grows linearly with candidates × chunk size.
`)}
<p>Options (as of Oct 2026): hosted Cohere <code>rerank-v4.0-pro</code> / <code>rerank-v4.0-fast</code> / <code>rerank-v3.5</code>; open-weight <code>BAAI/bge-reranker-v2-m3</code> (multilingual, easy to self-host); Jina <code>jina-reranker-v3.5</code>. ColBERT (arXiv 2004.12832) and ColBERTv2 sit between: <b>late interaction</b> stores one vector per token and scores with MaxSim, giving cross-encoder-like quality at retrieval-time cost, paid for in index size.</p>
${anim('v2-rag-hybrid-request')}

<h3>3.8 Context assembly</h3>
<p>Take the top few reranked chunks (often 3–8), dedupe overlapping chunks, keep the source metadata, order them (most relevant first and last is a common mitigation for long contexts; see ${L('v2-rag-production','"lost in the middle"')}), and stay within a token budget. Instruct the model to answer only from the provided sources, cite them by id, and say "I don't know" when evidence is missing. Then <b>verify</b>: check that cited ids were actually in the context.</p>

<h2>4. Where does it fit?</h2>
${fig('RAG: ingestion path and query path share the index', svgDiagram({w:900,h:360,
 zones:[{x:10,y:10,w:880,h:120,label:'Ingestion path (batch or streaming)'},{x:10,y:150,w:880,h:200,label:'Query path (per request, latency budget)'}],
 boxes:[
  {id:'src',x:25,y:45,w:130,h:56,label:'Sources',sub:'PDF, wiki, DB rows'},
  {id:'parse',x:185,y:45,w:130,h:56,label:'Parse + chunk',sub:'structure-aware'},
  {id:'emb',x:345,y:45,w:130,h:56,label:'Embed',sub:'same model as query'},
  {id:'idx',x:520,y:45,w:170,h:56,label:'Indexes',sub:'HNSW + BM25 + metadata',cls:'hl'},
  {id:'meta',x:730,y:45,w:140,h:56,label:'Metadata',sub:'doc, version, ACL'},
  {id:'u',x:25,y:250,w:110,h:56,label:'User',sub:'identity'},
  {id:'gw',x:160,y:250,w:120,h:56,label:'Gateway',sub:'auth, groups'},
  {id:'ret',x:305,y:250,w:150,h:56,label:'Hybrid retrieve',sub:'ACL filter, RRF',cls:'hl'},
  {id:'rr',x:480,y:250,w:120,h:56,label:'Rerank',sub:'top 50 → 5'},
  {id:'llm',x:625,y:250,w:110,h:56,label:'LLM',sub:'grounded'},
  {id:'ans',x:760,y:250,w:115,h:56,label:'Answer',sub:'+ citations'}
 ],
 arrows:[{from:'src',to:'parse'},{from:'parse',to:'emb'},{from:'emb',to:'idx'},{from:'meta',to:'idx',cls:'dash'},
  {from:'u',to:'gw'},{from:'gw',to:'ret'},{from:'idx',to:'ret',fromSide:'bottom',toSide:'top',label:'search'},{from:'ret',to:'rr'},{from:'rr',to:'llm'},{from:'llm',to:'ans'}]
}), 'Retrieval is a data system bolted to an LLM. The index is the contract between the two paths: same embedding model, same chunk ids, same metadata schema.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>AI gateway</b> supplies the caller's identity and tenant, which become retrieval filters (${L('v2-ai-gateway','AI gateway')}).</li>
<li><b>Caches.</b> Query-embedding caches, retrieval-result caches and semantic caches sit in front of this path and must be invalidated when documents or permissions change (${L('v2-rag-weight-cache','RAG and embedding caching')}, ${L('v2-cache-ops','cache invalidation')}).</li>
<li><b>Prefix caching.</b> A stable system prompt placed before the retrieved chunks lets the engine reuse KV for that prefix; the chunks themselves vary per query (${L('v2-prefix-kv-cache','prefix caching')}).</li>
<li><b>Data platform.</b> Ingestion is an ETL pipeline: the same Spark/Airflow/Kafka skills apply, including CDC for freshness (${L('v2-rag-production','production RAG')}).</li>
<li><b>Evaluation.</b> Retrieval metrics and grounded-answer metrics are release gates (${L('v2-evaluation-monitoring','evaluation and monitoring')}).</li>
<li><b>Agents and MCP.</b> Search can be exposed as a tool that an agent decides when to call (${L('v2-agents','agents')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Area','Your responsibility'],[
 ['Index lifecycle','Build, rebuild and migrate indexes. A new embedding model means re-embedding the whole corpus into a <b>new</b> index and switching an alias (blue/green), never mixing vectors from two models.'],
 ['Version pinning','Pin embedding model id + revision, chunker version, analyzer config, reranker model. Record them in the index metadata and in every trace.'],
 ['Capacity','Vector memory (dims × bytes × rows), ANN graph overhead, replicas for QPS, build time, reranker GPUs.'],
 ['Latency budget','Per-stage p95: query embedding, search, rerank, LLM TTFT. Retrieval should be a small fraction of end-to-end latency.'],
 ['Data protection','Tenant and ACL fields in every chunk; backups; deletion propagation; encryption; data residency of managed indexes (region fixed at creation for Pinecone serverless).'],
 ['Quality signals','Recall@k on a golden set after every index or model change; zero-result rate; citation validity.']
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Confident answer from the wrong document','Retrieval miss; the right chunk was not in top-k','Golden-set recall@k; trace shows retrieved ids','Hybrid search, better chunking, reranker, query rewriting'],
 ['Exact identifiers (PNR, flight no., POL-114) not found','Dense-only retrieval','Lexical queries fail, semantic ones pass','Add BM25 and RRF'],
 ['All results irrelevant after a deploy','Query embedded with a different model/version than the index','Index metadata vs service config mismatch; cosine scores unusually low','Pin and assert model id at startup; rebuild index'],
 ['Recall fell slowly over months on IVF','Data drifted away from k-means centroids','Recall@k trend; growing list imbalance','Rebuild IVF lists or move to HNSW'],
 ['Search latency spikes, memory pressure','HNSW graph no longer fits in RAM; swapping','Node memory, page faults, index size vs RAM','Quantize vectors, shard, add memory'],
 ['Answers cut mid-thought or miss sources','Context budget overflow; truncation','Prompt token counts in traces','Fewer, better chunks; rerank harder'],
 ['Arabic queries much worse than English','English-only embedding model or missing Arabic analyzer','Recall@k by language slice','Multilingual embedder; language analyzers; slice-level gates']
])}
<div class="dtree"><ul><li><span class="q">The answer is wrong. Where did it break?</span><ul>
<li><span class="a">step 1</span>Is the correct passage in the corpus at the current version? No → ingestion/freshness problem.</li>
<li><span class="a">step 2</span>Is it in the first-stage top-50? No → retrieval problem (chunking, embedder, hybrid, filters).</li>
<li><span class="a">step 3</span>Is it in the reranked top-5 sent to the model? No → reranker or context budget.</li>
<li><span class="a">step 4</span>It was in the context and the answer still contradicts it → generation problem (prompt, model, "lost in the middle").</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<ol>
<li><b>Shrink vectors:</b> fewer dims (Matryoshka truncation), halfvec/int8/binary or BBQ quantization, often with a full-precision re-score of the top candidates.</li>
<li><b>Shard and replicate:</b> shard by tenant or hash for capacity; replicate for QPS and availability.</li>
<li><b>Filter efficiently:</b> partition by tenant when tenants are large; use engines whose filtered HNSW search keeps recall when filters are selective (see production lesson).</li>
<li><b>Separate ingest from serve:</b> index builds are CPU/memory heavy; do them on separate nodes or build-then-swap.</li>
<li><b>Batch embeddings</b> at ingest on GPUs; cache query embeddings for repeated questions.</li>
</ol>

<h2>9. How do we optimize its cost?</h2>
${formula(`
Ingest cost model (symbolic prices — use your provider's current rate card)

STEP 1  corpus: 2,000,000 chunks × 400 tokens = 800,000,000 tokens = 800 M tokens
STEP 2  hosted embedding at p dollars per 1M tokens → 800 × p dollars per full re-embed
STEP 3  self-hosted: assume a measured 50,000 tokens/s on one GPU
        800,000,000 / 50,000 = 16,000 s ≈ 4.4 GPU-hours per full re-embed
STEP 4  storage at 1,024 dims: float32 2,000,000 × 4,096 B = 8.19 GB
                               int8    2,000,000 × 1,024 B = 2.05 GB

ANSWER  Re-embedding is a planned, budgeted migration. Incremental (CDC-driven)
        re-embedding of only changed chunks is what keeps steady-state cost low.
`)}
<p>Per query, the expensive part is almost always the LLM call, which is driven by how many retrieved tokens you send. Five well-reranked chunks beat twenty mediocre ones on both quality and cost.</p>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“Users say the assistant can’t find booking references and policy numbers, but answers general questions fine. What do you do?”','<p><i>Answer (≈45 s):</i> "That pattern points at dense-only retrieval. Embeddings capture meaning but are weak on exact tokens like PNRs, flight numbers and policy ids. I would confirm with a golden set split into lexical and semantic queries and measure recall at k for each. The fix is hybrid retrieval: add BM25 with a proper analyzer, including Arabic, and fuse the two lists with reciprocal rank fusion, k equal to 60, then rerank the top fifty with a cross-encoder. I would gate the change on recall at k by query type and language, and watch the latency added by the reranker."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"Use a bigger embedding model" or "increase top-k to 50 and send everything to the LLM."</p><p>Neither fixes exact-token matching; the second multiplies cost and buries the right chunk.</p></div><div class="good"><h4>Strong answer</h4><p>Names the failure class (lexical vs semantic), measures recall@k by slice, adds BM25 + RRF + rerank, and gates on metrics.</p></div></div>

<h3>Lab (planned)</h3>
<p>The planned lab <code>labs/07-rag/rag_minimal.py</code> implements structure-aware chunking, BM25, a toy dense retriever, reciprocal rank fusion and ACL filtering in plain Python so you can recompute every number in this lesson on your laptop. See <code>labs/README.md</code> for its status.</p>

<div class="connections"><h4>How this connects</h4>
${chain(['Documents','chunks','embeddings','ANN index','hybrid + RRF','rerank','grounded answer'])}
${chain(['Retrieved tokens','prompt length','KV cache and TTFT','cost per answer'])}
<p>Next: ${L('v2-rag-production','production RAG')} adds freshness, access control, evaluation and the alternatives (GraphRAG, agentic RAG, long context). Related: ${L('v1-kv-cache','KV cache')} explains why stuffing long context is expensive.</p></div>
`,
  quiz:[
    {q:'Two vectors are normalised to length 1. Their cosine similarity is 0.96. What does pgvector’s <=> operator return for them?',options:['0.96','0.04','1.96','−0.96'],answer:1,explain:'<=> is cosine distance = 1 − cosine similarity = 0.04. Ordering by <=> ascending puts the most similar first. 0.96 would be the similarity, not the distance.'},
    {q:'Why do BM25 and dense scores need rank fusion instead of simple addition?',options:['BM25 is always more accurate','Their scores are on different, uncalibrated scales, so adding them is meaningless; RRF uses only ranks','Dense scores are negative','RRF is faster than BM25'],answer:1,explain:'Cosine is bounded, BM25 is unbounded and corpus-dependent. RRF sidesteps calibration by using 1/(k + rank). It is not about speed.'},
    {q:'With RRF k = 60, a chunk ranked 1st by BM25 and 2nd by dense scores…',options:['1/61 + 1/62 ≈ 0.0325','1 + 1/2 = 1.5','1/60 + 1/60 ≈ 0.0333','0.5'],answer:0,explain:'Each list contributes 1/(60 + rank): 1/61 + 1/62 = 0.016393 + 0.016129 = 0.032522. 1.5 would be k = 0.'},
    {q:'A 4,000,000-row pgvector table uses IVFFlat. Following pgvector’s guidance, roughly how many lists and probes?',options:['4,000 lists, 63 probes','2,000 lists, about 45 probes','400 lists, 20 probes','1,000 lists, 1 probe'],answer:1,explain:'Above 1M rows use √rows = 2,000 lists, and start with √lists ≈ 45 probes. rows/1,000 = 4,000 applies only up to 1M rows.'},
    {q:'You switched the query service to a new embedding model but did not rebuild the index. What happens?',options:['An error is raised at query time','Results become plausible-looking but largely irrelevant, with no error','Recall improves','Only latency changes'],answer:1,explain:'If dimensions match, nothing errors: vectors from two models live in different coordinate systems, so nearest neighbours are meaningless. Pin and assert model identity.'},
    {q:'Why does a cross-encoder reranker run only on the top few dozen candidates?',options:['It cannot handle more than 50 inputs','It scores each (query, chunk) pair jointly and cannot be precomputed, so cost grows linearly with candidates','It needs GPUs with MIG','It only works with BM25'],answer:1,explain:'The bi-encoder precomputes document vectors; a cross-encoder must run a full transformer pass per pair at query time. Use it for precision on a small candidate set.'}
  ],
  flashcards:[
    {front:'Ingestion path vs query path',back:'Ingestion: parse → chunk → embed → index with metadata. Query: embed question → hybrid search with ACL filter → fuse → rerank → bounded context → LLM → cited answer.'},
    {front:'RRF formula and default k',back:'RRF(d) = Σ 1/(k + rank_r(d)); k = 60 (Cormack et al. 2009; Elasticsearch and OpenSearch rank_constant default 60).'},
    {front:'HNSW knobs',back:'m (links per node), ef_construction (build candidate list), ef_search (query candidate list, main recall/latency dial). pgvector defaults m = 16, ef_construction = 64.'},
    {front:'pgvector IVFFlat sizing',back:'lists = rows/1,000 up to 1M rows, √rows above; probes start at √lists.'},
    {front:'10M × 1,024-dim float32 vectors',back:'40.96 GB raw (≈38.1 GiB); int8 10.24 GB; binary 1.28 GB.'},
    {front:'Why hybrid search?',back:'Dense captures meaning but misses exact tokens (PNRs, error codes, ids); BM25 catches exact rare terms. Fusion gets both.'},
    {front:'Bi-encoder vs cross-encoder',back:'Bi-encoder embeds query and document separately (precomputable, fast, recall). Cross-encoder scores the pair jointly (slow, precise, reranking).'}
  ]
});
registerGlossary([
  {term:'Retrieval-augmented generation',def:'Pattern where relevant passages are retrieved from a controlled corpus at request time and placed in the prompt so the model answers from them, ideally with citations.',lesson:'v2-rag-fundamentals',aliases:['RAG']},
  {term:'Vector database',def:'A store that indexes embedding vectors for approximate nearest-neighbour search, usually with metadata filtering; can be a dedicated engine or an extension such as pgvector.',lesson:'v2-rag-fundamentals',aliases:['vector index','vector store']},
  {term:'Chunking',def:'Splitting documents into retrievable units (fixed, recursive, structure-aware, semantic) before embedding; the single biggest lever on retrieval quality.',lesson:'v2-rag-fundamentals',aliases:['chunks']},
  {term:'Bi-encoder',def:'An embedding model that encodes query and document independently into vectors, so document vectors can be precomputed and searched quickly.',lesson:'v2-rag-fundamentals'},
  {term:'Cross-encoder',def:'A model that reads a query and a candidate passage together and outputs one relevance score; accurate but must run per pair at query time, so used for reranking.',lesson:'v2-rag-fundamentals'},
  {term:'HNSW',def:'Hierarchical Navigable Small World: a multi-layer proximity graph for approximate nearest-neighbour search; tuned with m, ef_construction and ef_search.',lesson:'v2-rag-fundamentals'},
  {term:'IVF',def:'Inverted-file ANN index: vectors are clustered with k-means into lists; a query scans only the nearest probes lists.',lesson:'v2-rag-fundamentals',aliases:['IVFFlat']},
  {term:'BM25',def:'Lexical ranking function based on term frequency with saturation (k₁), length normalisation (b) and inverse document frequency; strong on exact and rare terms.',lesson:'v2-rag-fundamentals'},
  {term:'Hybrid search',def:'Running lexical (e.g. BM25) and dense vector retrieval together and fusing their result lists.',lesson:'v2-rag-fundamentals'},
  {term:'Reciprocal rank fusion',def:'Rank-only fusion: score(d) = Σ 1/(k + rank); k = 60 by convention. Avoids calibrating incompatible scores.',lesson:'v2-rag-fundamentals',aliases:['RRF']},
  {term:'Reranker',def:'A second-stage model that reorders a small candidate set for precision, typically a cross-encoder or late-interaction model.',lesson:'v2-rag-fundamentals'},
  {term:'Late chunking',def:'Embedding a whole long document with a long-context model first, then pooling token embeddings per chunk so each chunk vector carries document context.',lesson:'v2-rag-fundamentals'},
  {term:'Contextual retrieval',def:'Prepending an LLM-written, chunk-specific context sentence to each chunk before embedding and BM25 indexing (Anthropic, 2024).',lesson:'v2-rag-fundamentals'},
  {term:'Matryoshka embeddings',def:'Embeddings trained so that a prefix of the vector (e.g. first 256 of 768 dims) is still a usable embedding, allowing cheaper storage.',lesson:'v2-rag-fundamentals',aliases:['MRL']}
]);

registerLesson({
  id:'v2-rag-production', vol:2, part:5, num:2,
  title:'Production RAG: freshness, access control, evaluation, GraphRAG, agentic RAG, long context, cost', minutes:100,
  summary:'A RAG demo answers questions. A production RAG system answers them from the current version of each document, never shows a user a passage they are not allowed to read, proves its quality with measurements, and stays within a latency and cost budget. This lesson builds that system: change data capture to keep the index fresh, permission filtering inside retrieval, retrieval and grounding metrics, when to reach for GraphRAG, agentic retrieval or simply a long context window, and how the Atlas capstone adds policy-document search.',
  objectives:[
    'Design a CDC pipeline (Debezium → Kafka → indexer) that keeps a RAG index fresh, including updates, deletes and permission changes.',
    'Enforce document ACLs at retrieval time and calculate why post-filtering fails for selective permissions.',
    'Evaluate RAG with retrieval metrics (recall@k, MRR) and RAGAS-style grounding metrics, separated by slice.',
    'Decide between classic RAG, GraphRAG, agentic RAG and long-context prompting using cost and quality arithmetic.',
    'Build a per-stage latency and cost budget and pick the right optimization lever.'
  ],
  prereqs:['v2-rag-fundamentals','v1-kv-cache','v2-ai-gateway'],
  next:['v2-evaluation-monitoring','v2-cache-ops','v2-agents','v2-capstone-platform'],
  tags:['rag','security','evaluation','cdc','capstone'],
  html:`
<h2>1. What is it?</h2>
<p>Production RAG is the retrieval pipeline from ${L('v2-rag-fundamentals','RAG fundamentals')} plus five operational properties: <b>freshness</b> (answers reflect the current document version within an agreed lag), <b>authorization</b> (retrieval only returns chunks the caller may read), <b>measured quality</b> (retrieval and grounding metrics gate every change), <b>observability</b> (every answer can be traced to index version, chunk ids and model versions) and a <b>latency and cost budget</b>. It also means knowing when plain RAG is the wrong tool and GraphRAG, agentic retrieval or long context fits better.</p>

<h2>2. Why do we need it?</h2>
<p>The failures that reach incident reviews are rarely "the model is dumb". They are:</p>
<ul>
<li>The assistant quotes last month's refund window because the nightly index rebuild failed silently.</li>
<li>A deleted or revoked document is still cited, because deletion never propagated to the vector index or a cache.</li>
<li>A sales agent sees an HR salary-band chunk because ACLs were checked in the prompt ("do not reveal HR data") instead of in retrieval.</li>
<li>A retriever change ships because "it looked better on five questions", and Arabic-language recall quietly drops.</li>
</ul>
<p>The old course's runbook for "RAG confidently answers with wrong material" (identify index/embedder/chunker/prompt/model versions, check ACLs and freshness, measure whether the right passage is in top-k, then check citations and abstention) is correct; this lesson turns each of those checks into a mechanism.</p>

<h2>3. How does it work internally?</h2>
<h3>3.1 Freshness: change data capture into the index</h3>
<p>You already know this pattern from data engineering. ${term('Change data capture')} reads a database's transaction log (Postgres WAL, MySQL binlog) and emits one event per row change. Debezium is the common open-source CDC connector; it publishes change events to Kafka topics. For RAG, the consumer of that topic is an <b>indexer</b> that re-chunks, re-embeds and upserts.</p>
${anim('v2-rag-cdc-freshness')}
<p>The design rules that make it correct:</p>
<ol>
<li><b>Key by document id.</b> Partition the Kafka topic by doc id so all changes to one document are processed in order by one consumer.</li>
<li><b>Deterministic chunk ids.</b> Chunk id = hash(doc_id, chunk_index) plus a content hash. On update, re-embed only chunks whose content hash changed, upsert them, and delete chunk ids that no longer exist. This turns "re-index the policy" into "re-embed 3 of 12 chunks".</li>
<li><b>Deletes are first-class.</b> A delete event must remove every chunk of the document from every index (vector, BM25) <i>and</i> invalidate caches. Debezium represents deletes as a delete event, typically followed by a ${term('Tombstone','tombstone')} record (null value) so Kafka log compaction can drop the key.</li>
<li><b>Permissions are data too.</b> Group membership and document ACLs change independently of content. Stream them through the same pipeline and update chunk metadata without re-embedding.</li>
<li><b>Idempotent, replayable consumers.</b> Upserts by chunk id make reprocessing safe; you can rewind the consumer group offset to rebuild after a bug.</li>
</ol>
${formula(`
Freshness lag budget (ILLUSTRATIVE — measure each hop in your pipeline)

   commit in Postgres                          t = 0
   Debezium reads WAL, publishes event         + 1.0 s
   Kafka produce → consume                     + 0.2 s
   indexer micro-batch window                  + 2.0 s
   chunk + embed 3 changed chunks              + 0.3 s
   index refresh / searchable                  + 1.0 s
   ─────────────────────────────────────────────────────
   commit → searchable                         ≈ 4.5 s

   nightly batch rebuild, worst case           ≈ 24 h  = 86,400 s

ANSWER  CDC cuts worst-case staleness by about 86,400 / 4.5 ≈ 19,000×.
        Alert on consumer lag (records and seconds), not only on "job succeeded".
`)}
${callout('devops','DevOps bridge: you have built this before','This is the same Debezium → Kafka → sink pattern used to feed a search cluster or a data lake. The new parts are the sink logic (chunk, embed, upsert by deterministic id) and the fact that the "sink" has derived state (embeddings) tied to a model version. Where the analogy breaks: changing the embedding model invalidates <i>every</i> row in the sink at once, so you also need a backfill path that re-embeds into a new index and swaps an alias.')}
${callout('unverified','Verify connector behaviour for your version','Debezium connector options (for example whether a tombstone follows each delete, snapshot modes, and how schema changes are emitted) are configuration-dependent. Check the connector documentation for the version you deploy and test delete propagation end to end.')}

<h3>3.2 Access control enforced inside retrieval</h3>
<p>The rule: <b>the model must never see a chunk the caller is not allowed to read.</b> A prompt instruction is not a security boundary; prompt injection or a simple "summarise everything above" defeats it. Authorization belongs in the retrieval query, using the identity the gateway verified, never an identity the model or user typed.</p>
${table(['Approach','How','Trade-off'],[
 ['Separate index or namespace per tenant','physical isolation; the query cannot reach other tenants','strongest isolation; more indexes to operate; best for hard multi-tenant boundaries'],
 ['Pre-filter (filtered ANN)','ACL predicate (<code>tenant_id = … AND acl_groups && caller_groups</code>) applied during the search','correct top-k; needs an engine whose filtered HNSW keeps recall when filters are selective'],
 ['Post-filter','search top-K, then drop disallowed results','simple but returns too few or zero results when the caller can see a small share of the corpus'],
 ['Row-level security','Postgres RLS policies on the chunks table (pgvector)','enforced by the database for every query path; test performance with the HNSW index']
])}
${formula(`
Why post-filtering fails for selective permissions
(assume the caller may read 5 % of chunks, independent of relevance)

STEP 1  fetch top-10, then filter: expected allowed results = 10 × 0.05 = 0.5
STEP 2  probability that NONE of the 10 is allowed = 0.95¹⁰ = 0.599
                                                    ↑ 60 % of queries return nothing
STEP 3  to expect 10 allowed results: K = 10 / 0.05 = 200 candidates
        (and the ANN search must have found those 200 in the first place)

ANSWER  Use pre-filtering or per-tenant partitions; post-filtering only works
        when most of the corpus is visible to most users.
`)}
<p>Also: sync permission changes quickly (a revoked user must lose access within the freshness SLO), include ACL fields in every cache key (${L('v2-cache-ops','cache tenant isolation')}), and log retrieved chunk ids per request for audit. For the threat side — poisoned documents, injected instructions inside retrieved text — see ${L('v2-ai-threat-model','AI threat modeling')}.</p>

<h3>3.3 Evaluating RAG: separate retrieval from generation</h3>
<p>One "RAG score" hides the failure source. Measure the stages separately on a versioned golden set (questions, expected source chunk ids, reference answers), sliced by language, document type and tenant.</p>
${formula(`
Retrieval metrics

recall@k  = fraction of questions whose relevant chunk appears in the top k
            20 questions, relevant chunk in top-5 for 16  →  recall@5 = 16 / 20 = 0.80

                  1   |Q|   1
MRR       =  ──── Σ  ──────          rankᵢ = position of first relevant result
                |Q|  i=1  rankᵢ

            3 questions, first relevant at ranks 1, 3, not found (contributes 0)
            MRR = (1/1 + 1/3 + 0) / 3 = 1.333 / 3 = 0.444

Grounding metric (RAGAS Faithfulness)

                       claims in the answer supported by the retrieved context
Faithfulness  =  ─────────────────────────────────────────────────────────────
                               total claims in the answer

            answer makes 5 claims, 4 are supported by the context  →  0.80
`)}
<p>recall@5 = 0.80 does <b>not</b> mean 80 % of answers are correct; the model can still ignore or misuse a retrieved passage. That is why grounding metrics exist. The common metric families (names as of Oct 2026):</p>
${table(['Framework','Retrieval-side metrics','Generation-side metrics'],[
 ['RAGAS 0.4 (collections API, <code>ragas.metrics.collections</code>)','<code>ContextPrecision</code>, <code>ContextRecall</code>, <code>ContextEntityRecall</code>','<code>Faithfulness</code>, <code>AnswerRelevancy</code>, <code>FactualCorrectness</code>, <code>NoiseSensitivity</code>; legacy <code>ragas.metrics</code> imports are deprecated in 0.4 and removed in 1.0'],
 ['DeepEval','<code>ContextualPrecisionMetric</code>, <code>ContextualRecallMetric</code>, <code>ContextualRelevancyMetric</code>','<code>FaithfulnessMetric</code>, <code>AnswerRelevancyMetric</code>, <code>HallucinationMetric</code>, <code>GEval</code>'],
 ['MLflow 3 GenAI scorers','<code>RetrievalRelevance</code>, <code>RetrievalSufficiency</code> (need a trace)','<code>RetrievalGroundedness</code>, <code>Correctness</code>, <code>Guidelines</code>'],
 ['TruLens "RAG triad"','context relevance','groundedness, answer relevance']
])}
<p>Most generation-side metrics use an LLM as judge, so they inherit judge bias and variance; calibrate them against human labels on a sample and version the judge prompt and model (${L('v2-evaluation-monitoring','evaluation lesson')}). Add two tests every enterprise RAG needs: a <b>revocation test</b> (revoke a user's access to a document, confirm it disappears from answers within the SLO) and an <b>abstention test</b> (ask questions the corpus cannot answer; the correct output is "I don't know").</p>

<h3>3.4 GraphRAG: when the answer is spread across the corpus</h3>
<p>Classic RAG finds a few passages similar to the question. It struggles with <b>global</b> questions such as "What are the recurring causes of refund complaints across all 2026 incident reports?", where no single chunk contains the answer. ${term('GraphRAG')} (Microsoft Research, Edge et al., arXiv 2404.16130) indexes differently: an LLM extracts entities and relationships from every chunk into a knowledge graph, the graph is partitioned into hierarchical communities, and an LLM writes a summary for each community. Global questions are answered map-reduce style over community summaries; local questions start from matching entities and walk their neighbourhood.</p>
${formula(`
GraphRAG indexing cost vs classic RAG (order of magnitude)

classic RAG ingest : 1 embedding pass per chunk          (2M chunks → 2M cheap encoder passes)
GraphRAG ingest    : ≥ 1 LLM extraction call per chunk   (2M chunks → ≥ 2M generative LLM calls)
                     + community summarisation calls
                     + rebuild work when documents change

ANSWER  GraphRAG trades a much more expensive, slower-to-refresh index for better
        answers to global, multi-hop questions. Use it for stable analytic corpora,
        not for fast-changing operational documents.
`)}

<h3>3.5 Agentic RAG: retrieval as a tool the model chooses to use</h3>
<p>In ${term('Agentic RAG')} an agent decides <i>whether</i> to retrieve, <i>what</i> to search for (query rewriting, decomposition into sub-questions), <i>which</i> source to query (policy index, booking API via MCP, web) and whether the evidence is sufficient or another search is needed (survey: Singh et al., arXiv 2501.09136; LangGraph's tutorial frames it as an agent "that decides when to search a vector store versus answering the user directly"). It handles multi-hop questions ("Is my Riyadh–Dubai booking refundable under the policy that applied when I booked?") that one retrieval cannot.</p>
<p>The cost is loops: each step is another LLM call plus retrieval. Cap iterations, set a token budget per request, and trace every step (${L('v2-agents','agents')}). Start with a fixed pipeline; add agentic behaviour only for the question classes your evaluation shows it helps.</p>

<h3>3.6 The long-context alternative</h3>
<p>Modern models accept very long prompts, so why not put the whole policy corpus in the context? Do the arithmetic.</p>
${formula(`
Policy corpus = 150,000 tokens.  10,000 questions per day.  Question + instructions ≈ 500 tokens.

STEP 1  long-context stuffing
        input per request = 150,000 + 500        = 150,500 tokens
        input per day     = 150,500 × 10,000     = 1,505,000,000 ≈ 1,505 M tokens

STEP 2  RAG with 6 chunks × 500 tokens
        input per request = 6 × 500 + 500        = 3,500 tokens
        input per day     = 3,500 × 10,000       = 35,000,000 = 35 M tokens
        ratio stuffing / RAG = 1,505 / 35        ≈ 43×

STEP 3  stuffing with provider prompt caching (cache read = 0.1 × base input price)
        cost-equivalent tokens per request ≈ 150,000 × 0.1 + 500 = 15,500
        per day ≈ 155 M  →  still ≈ 4.4× RAG, plus cache writes (1.25× base for the
        5-minute TTL) whenever the cache expires.  Some newest models price cache
        reads at 0.05× or 0.025×, which narrows the gap — recompute for your model.

STEP 4  self-hosted, KV memory per request on the Llama-3.1-70B shape (320 KiB/token)
        150,000 × 320 KiB = 48,000,000 KiB ≈ 45.8 GiB per concurrent request
                            ↑ more than half an 80 GB GPU, for ONE user

ANSWER  Long context is a valid tool for a small corpus, a single long document,
        or low-volume deep analysis. For high-volume Q&A over a large or permissioned
        corpus, retrieval wins on cost, latency (prefill of 150k tokens) and ACLs.
`)}
<p>Quality is not free either. "${term('Lost in the middle')}" (Liu et al., arXiv 2307.03172) showed that models use information at the beginning and end of a long context more reliably than information in the middle. Stuffing also ignores permissions unless you build a per-user corpus. A practical hybrid: retrieve, then give the model generous context around the retrieved hits (parent-document or section expansion) rather than either extreme.</p>

<h3>3.7 Latency and cost optimization</h3>
${table(['Stage','Illustrative p95 budget','Levers'],[
 ['Query embedding','15–30 ms','small/self-hosted embedder near the service; cache embeddings of repeated queries'],
 ['Hybrid search + ACL filter','20–60 ms','HNSW in RAM, quantized vectors, tenant partitions, tuned <code>ef_search</code>'],
 ['Rerank 50 candidates','50–150 ms','rerank fewer candidates, smaller/faster reranker, GPU batching, skip rerank for high-confidence lexical hits'],
 ['LLM time to first token','300–800 ms','fewer, better chunks (shorter prefill), stable prefix for prefix caching, smaller model via routing'],
 ['Whole answer','1–4 s','streaming, retrieval caching with correct invalidation, semantic cache only where safe']
])}
<p>Budget numbers above are illustrative targets, not measurements. Measure each stage with traces (${L('v2-ai-observability','AI observability')}). The largest cost lever is almost always <b>retrieved tokens sent to the LLM</b>; the largest quality lever is almost always <b>chunking + hybrid + rerank</b>.</p>

<h2>4. Where does it fit?</h2>
${fig('Production RAG: freshness, identity and evaluation around the retrieval core', svgDiagram({w:900,h:380,
 zones:[{x:10,y:10,w:420,h:150,label:'Data plane (CDC ingestion)'},{x:450,y:10,w:440,h:150,label:'Request path (trusted identity)'},{x:10,y:180,w:880,h:190,label:'Quality and operations'}],
 boxes:[
  {id:'db',x:25,y:45,w:110,h:50,label:'Policy DB',sub:'WAL'},
  {id:'k',x:160,y:45,w:110,h:50,label:'Debezium',sub:'→ Kafka'},
  {id:'ix',x:295,y:45,w:120,h:50,label:'Indexer',sub:'chunk, embed'},
  {id:'acl',x:160,y:105,w:110,h:44,label:'ACL sync',sub:'IdP groups'},
  {id:'gw',x:465,y:45,w:110,h:50,label:'Gateway',sub:'JWT → groups'},
  {id:'r',x:600,y:45,w:130,h:50,label:'Retriever',sub:'pre-filter',cls:'hl'},
  {id:'l',x:755,y:45,w:120,h:50,label:'LLM',sub:'cite or abstain'},
  {id:'vi',x:600,y:105,w:130,h:44,label:'Index v42',sub:'alias: live'},
  {id:'g',x:30,y:220,w:160,h:56,label:'Golden set',sub:'versioned, sliced'},
  {id:'e',x:220,y:220,w:170,h:56,label:'Offline eval',sub:'recall@k, faithfulness'},
  {id:'t',x:420,y:220,w:160,h:56,label:'Traces',sub:'chunk ids, versions'},
  {id:'o',x:610,y:220,w:150,h:56,label:'Online eval',sub:'sampled judges'},
  {id:'m',x:420,y:300,w:160,h:56,label:'Alerts',sub:'CDC lag, zero-hit'}
 ],
 arrows:[{from:'db',to:'k'},{from:'k',to:'ix'},{from:'acl',to:'ix'},{from:'ix',to:'vi',fromSide:'bottom',toSide:'left'},{from:'gw',to:'r'},{from:'r',to:'l'},{from:'vi',to:'r',fromSide:'top',toSide:'bottom'},
  {from:'g',to:'e'},{from:'e',to:'vi',cls:'dash',label:'gate'},{from:'l',to:'t',cls:'dash'},{from:'t',to:'o'},{from:'t',to:'m'}]
}), 'Three loops: CDC keeps the index fresh, identity flows from the gateway into the retrieval filter, and offline/online evaluation gates index and model changes.')}

<h2>5. How does it connect to other components?</h2>
<ul>
<li><b>Gateway and identity:</b> the verified token supplies tenant and groups for the retrieval filter (${L('v2-ai-gateway','AI gateway')}, ${L('v2-governance','governance')}).</li>
<li><b>Caches:</b> retrieval and semantic caches must key on ACL scope and be invalidated by the same CDC events (${L('v2-cache-ops','cache operations')}).</li>
<li><b>MLOps:</b> the index version, embedder, chunker, reranker and prompt are part of the release bundle (${L('v2-model-cicd','model CI/CD')}).</li>
<li><b>Agents and MCP:</b> retrieval becomes a tool; agentic RAG adds loops and budget limits (${L('v2-agents','agents')}, ${L('v2-mcp-why','MCP')}).</li>
<li><b>FinOps:</b> retrieved tokens per answer is a primary cost driver (${L('v2-finops-unit-economics','unit economics')}).</li>
</ul>

<h2>6. What does a DevOps / platform engineer manage?</h2>
${table(['Control','What you own'],[
 ['Freshness SLO','commit → searchable p99 target; CDC consumer lag alerts; dead-letter queue for documents that fail to parse'],
 ['Deletion and revocation','end-to-end tests that deleted or revoked content disappears from indexes, caches and answers within the SLO'],
 ['Index versions','immutable index versions behind an alias; backfill jobs for embedder changes; rollback by alias swap'],
 ['Identity propagation','retrieval service accepts identity only from the gateway; ACL fields mandatory on every chunk; audit log of chunk ids served'],
 ['Evaluation gates','golden set ownership, slice thresholds (language, tenant, doc type), judge versioning'],
 ['Budgets','per-stage latency SLOs; max retrieved tokens; agent iteration caps']
])}

<h2>7. What happens when it fails?</h2>
${table(['Symptom','Likely cause','Evidence','Fix'],[
 ['Old policy quoted after an update','CDC consumer stalled or indexer failing on a document','consumer lag (seconds) rising; DLQ count; index doc_version older than source','fix consumer; replay from offset; alert on lag, not job status'],
 ['Deleted document still cited','delete not propagated to BM25 index or cache','chunk ids for doc still present; cache hits','treat deletes as events to every index and cache; revocation test in CI'],
 ['User sees another team’s document','post-filter bug, missing ACL field, or ACL checked only in the prompt','audit log of chunk ids vs user groups','pre-filter or partition; reject chunks without ACL metadata; security incident process'],
 ['Many empty answers for some users','post-filtering with selective permissions','zero-hit rate by user group','pre-filtered search; per-tenant indexes'],
 ['Quality dropped after re-embedding','new embedder worse on a slice (e.g. Arabic) or mixed-version index','recall@k by slice; index metadata','alias rollback to previous index; slice-level gates'],
 ['p95 latency doubled','reranker saturated or candidates increased','per-stage spans in traces','fewer candidates, scale reranker, cache'],
 ['Agentic RAG costs exploded','unbounded loops or repeated searches','steps per request histogram','iteration cap, token budget, dedupe searches']
])}
<div class="dtree"><ul><li><span class="q">Answer cites the wrong or outdated policy</span><ul>
<li><span class="a">check</span>Index doc_version vs source version → older: freshness pipeline (CDC lag, DLQ).</li>
<li><span class="a">check</span>Correct version indexed but not in top-k → retrieval quality (chunking, hybrid, filters).</li>
<li><span class="a">check</span>In context but model used another chunk → ordering, prompt, "lost in the middle", rerank.</li>
<li><span class="a">check</span>Served from a cache → invalidation keyed by doc id and ACL scope.</li>
</ul></li></ul></div>

<h2>8. How do we scale it?</h2>
<ol>
<li><b>Ingestion:</b> scale indexer consumers with Kafka partitions; batch embeddings on GPUs; keep a separate backfill lane so a full re-embed does not starve live updates.</li>
<li><b>Serving:</b> replicate indexes for QPS; partition large tenants; keep HNSW in memory; quantize.</li>
<li><b>Multi-region:</b> index replicas per region for latency and data residency; CDC fans out per region (${L('v2-multi-region','multi-region')}).</li>
<li><b>Evaluation:</b> sample online traffic for judge-based scoring rather than scoring every request.</li>
</ol>

<h2>9. How do we optimize its cost?</h2>
<ul>
<li>Re-embed only changed chunks (content hashes) instead of whole documents.</li>
<li>Cap retrieved tokens; rerank to fewer, better chunks; long context only where the arithmetic above favours it.</li>
<li>Use the cheapest model that passes the evaluation gates for each question class (routing), and cache stable prefixes.</li>
<li>Choose GraphRAG and agentic RAG per question class, justified by measured quality gains, because both multiply LLM calls.</li>
</ul>

<h2>10. What might an interviewer ask?</h2>
${callout('interview','“How do you make sure an enterprise RAG assistant never leaks a document to someone who shouldn’t see it?”','<p><i>Answer (≈50 s):</i> "I enforce authorization in retrieval, not in the prompt. The gateway verifies the user’s token and passes tenant and groups to the retriever; the model never supplies identity. Every chunk carries tenant and ACL metadata, and chunks without it are rejected at ingest. For hard tenant boundaries I use separate indexes; inside a tenant I use pre-filtered search, because post-filtering returns empty or short results when a user can see only a small part of the corpus. Permission changes stream through the same CDC pipeline as content, caches are keyed by ACL scope, and I run a revocation test in CI that proves revoked content disappears within the SLO. Every request logs the chunk ids served, so I can audit."</p>')}
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"We tell the model in the system prompt not to reveal confidential documents."</p><p>Not a security boundary; prompt injection and summarisation bypass it.</p></div><div class="good"><h4>Strong answer</h4><p>Identity from the gateway, ACL metadata on every chunk, pre-filter or partition, permission CDC, cache scoping, revocation tests, audit logs.</p></div></div>

<h3>Capstone stage 6 — Atlas policy-document RAG</h3>
<p>Atlas so far (stages 1–5) is a fine-tuned small model served by vLLM on Kubernetes. Stage 6 adds a <b>policy assistant</b> over the (fictional) company's refund, baggage and visa-support policies in Arabic and English.</p>
${table(['Change','Why'],[
 ['New <b>retriever service</b> (pgvector + BM25 via Postgres full-text or OpenSearch) beside the vLLM deployment','knowledge lives outside the weights; policies change weekly'],
 ['Structure-aware chunking with heading path metadata','policies are sectioned documents; citations need section numbers'],
 ['Multilingual embedder (bge-m3 class) + Arabic analyzer for BM25','Arabic and English questions over bilingual documents'],
 ['Hybrid retrieval with RRF (k = 60) + small cross-encoder reranker','policy ids and fare codes need lexical match'],
 ['ACL metadata (agent team, region) enforced as a pre-filter from gateway claims','internal-only policies must not reach customer-facing flows'],
 ['Debezium CDC from the policy CMS database to the indexer','freshness SLO measured in seconds, not nightly'],
 ['Golden set with Arabic and English slices, revocation and abstention tests as CI gates','quality must be proven per language']
])}
<p><b>Lab-validated vs design.</b> The planned lab <code>labs/07-rag/rag_minimal.py</code> demonstrates chunking, BM25, a toy dense retriever, RRF and ACL filtering on a laptop, so you can verify the arithmetic and the filtering logic. The CDC pipeline, multilingual embedder choice, reranker latency and freshness SLO in this stage are a <b>design that has not been tested at scale</b>; treat every latency and cost figure as something to measure. Stage 7 (${L('v2-mcp-capstone','MCP tools')} and ${L('v2-agents','agents')}) turns this retriever into a tool; ${L('v2-capstone-platform','the platform capstone')} scales it.</p>

<div class="connections"><h4>How this connects</h4>
${chain(['DB commit','CDC event','re-embed changed chunks','index alias','fresh answer'])}
${chain(['Gateway identity','ACL pre-filter','authorized chunks','grounded answer','audit log'])}
${chain(['Golden set','recall@k + faithfulness','release gate','canary','online sampling'])}
<p>Go deeper: ${L('v2-evaluation-monitoring','evaluation and drift')}, ${L('v2-cache-ops','cache invalidation and tenant isolation')}, ${L('v2-ai-threat-model','prompt injection through retrieved content')}.</p></div>
`,
  quiz:[
    {q:'A user can read 5 % of chunks. You fetch top-10 and then drop disallowed ones. Roughly how often does the user get zero results (assume independence)?',options:['5 %','About 40 %','About 60 %','Never'],answer:2,explain:'P(none allowed) = 0.95¹⁰ ≈ 0.599. Post-filtering fails for selective permissions; pre-filter or partition instead. 5 % confuses the allow rate with the miss rate.'},
    {q:'Which design keeps a RAG index correct when a policy document is deleted in the source database?',options:['Nightly full rebuild only','CDC delete event → remove all chunk ids for that doc from every index and invalidate caches','Tell the model to ignore deleted documents','Lower the cache TTL to one hour'],answer:1,explain:'Deletes must propagate as events to every index (vector and BM25) and to caches. A nightly rebuild leaves up to 24 h of exposure; TTLs and prompt instructions do not guarantee removal.'},
    {q:'recall@5 on your golden set is 0.80. What can you conclude?',options:['80 % of answers are correct','The relevant chunk was in the top 5 for 80 % of questions; answer correctness still needs grounding metrics','The model hallucinates 20 % of the time','Faithfulness is 0.80'],answer:1,explain:'Retrieval and generation are separate stages. The model may ignore or misuse a retrieved passage, so faithfulness and correctness are measured separately.'},
    {q:'A 150,000-token corpus is stuffed into every prompt for 10,000 questions/day. Compared with RAG sending 3,500 tokens per question, input tokens are about…',options:['4× more','43× more','430× more','the same with caching'],answer:1,explain:'150,500 / 3,500 ≈ 43. Caching at 0.1× read price reduces the cost-equivalent to about 4.4×, but not to parity, and does not fix latency, KV memory or ACLs.'},
    {q:'When is GraphRAG the better choice?',options:['Fast-changing operational documents with simple lookups','Global or multi-hop questions over a relatively stable corpus, where the answer is spread across many documents','Whenever latency must be minimal','When you have no LLM budget at ingest'],answer:1,explain:'GraphRAG’s entity extraction and community summaries cost at least one LLM call per chunk and are slow to refresh, but they answer global questions that similarity search cannot.'},
    {q:'Where should the identity used for ACL filtering come from?',options:['The user’s question text','The LLM’s tool-call arguments','Claims in the token verified by the gateway, passed by the platform to the retriever','A system prompt'],answer:2,explain:'Identity must come from a trusted, verified source outside the model. Anything the model or user can write can be spoofed through prompt injection.'}
  ],
  flashcards:[
    {front:'CDC freshness pipeline for RAG',back:'DB WAL → Debezium → Kafka (keyed by doc id) → indexer: re-chunk, re-embed only changed chunks (content hash), upsert by deterministic chunk id, delete stale ids, invalidate caches.'},
    {front:'Why post-filtering fails',back:'If a user can see fraction p of the corpus, top-k post-filtered returns k·p results on average; with p = 5 %, k = 10, 60 % of queries return nothing.'},
    {front:'RAGAS Faithfulness',back:'Supported claims ÷ total claims in the answer, judged against the retrieved context (RAGAS 0.4 collections API: Faithfulness).'},
    {front:'MRR',back:'Mean of 1/rank of the first relevant result; ranks 1, 3, not-found → (1 + 0.333 + 0)/3 = 0.444.'},
    {front:'Lost in the middle',back:'Liu et al. 2023: models use information at the start and end of long contexts more reliably than in the middle.'},
    {front:'Long context vs RAG (150k-token corpus)',back:'≈43× more input tokens than 3.5k-token RAG; ≈45.8 GiB KV per request on a 70B shape; no per-user ACLs. Good for small corpora or single long documents.'},
    {front:'Agentic RAG',back:'An agent decides whether, what and where to retrieve and when evidence is sufficient; handles multi-hop questions; needs iteration caps and token budgets.'},
    {front:'Two tests every enterprise RAG needs',back:'Revocation test (revoked content disappears within the SLO) and abstention test (unanswerable questions get "I don’t know").'}
  ]
});
registerGlossary([
  {term:'Change data capture',def:'Reading a database transaction log (e.g. Postgres WAL) and emitting an event per row change; Debezium is a common open-source CDC connector that publishes to Kafka.',lesson:'v2-rag-production',aliases:['CDC']},
  {term:'Tombstone',def:'In Kafka, a record with a key and a null value that marks the key as deleted so log compaction can remove it; CDC pipelines use it to propagate deletes.',lesson:'v2-rag-production'},
  {term:'GraphRAG',def:'Microsoft Research approach that extracts an entity-relationship graph and hierarchical community summaries with an LLM, then answers global questions over those summaries.',lesson:'v2-rag-production'},
  {term:'Agentic RAG',def:'RAG where an agent decides whether, what and where to retrieve, can rewrite or decompose queries, and loops until evidence is sufficient.',lesson:'v2-rag-production'},
  {term:'Lost in the middle',def:'Finding (Liu et al., 2023) that language models use information placed in the middle of a long context less reliably than at its beginning or end.',lesson:'v2-rag-production'},
  {term:'Recall@k',def:'Fraction of evaluation questions for which a relevant item appears among the top k retrieved results.',lesson:'v2-rag-production',aliases:['recall at k']},
  {term:'Faithfulness',def:'RAG metric: share of claims in an answer that are supported by the retrieved context (also called groundedness).',lesson:'v2-rag-production',aliases:['groundedness']}
]);
