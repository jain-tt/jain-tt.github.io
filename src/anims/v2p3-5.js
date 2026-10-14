/* Animations for Volume 2 Parts 3-5: distributed systems, MLOps, RAG */

/* ---- Part 4: MLOps ---- */
Anim.register({
  id:'v2-mlops-release-pipeline', title:'An AI release pipeline with gates (one gate blocks an Arabic-slice regression)', w:960, h:440,
  elements:[
    {type:'node', id:'commit', x:30, y:50, w:190, h:60, label:'Change', sub:'data v412 + commit', icon:'doc'},
    {type:'node', id:'train', x:260, y:50, w:190, h:60, label:'Train (CT)', sub:'LoRA on pinned data', icon:'gpu'},
    {type:'node', id:'reg', x:490, y:50, w:190, h:60, label:'Register', sub:'v7 @candidate', icon:'db'},
    {type:'node', id:'eval', x:720, y:50, w:210, h:60, label:'Offline eval gate', sub:'overall + slices', icon:'check'},
    {type:'node', id:'sign', x:720, y:190, w:210, h:60, label:'Scan + sign', sub:'cosign, model-signing', icon:'shield'},
    {type:'node', id:'shadow', x:490, y:190, w:190, h:60, label:'Shadow', sub:'mirrored, discarded', icon:'cloud'},
    {type:'node', id:'canary', x:260, y:190, w:190, h:60, label:'Canary 10%', sub:'Argo analysis', icon:'chart'},
    {type:'node', id:'prom', x:30, y:190, w:190, h:60, label:'Promote', sub:'@champion', icon:'k8s'},
    {type:'edge', id:'e1', from:'commit', to:'train'},
    {type:'edge', id:'e2', from:'train', to:'reg'},
    {type:'edge', id:'e3', from:'reg', to:'eval'},
    {type:'edge', id:'e4', from:'eval', to:'sign'},
    {type:'edge', id:'e5', from:'sign', to:'shadow'},
    {type:'edge', id:'e6', from:'shadow', to:'canary'},
    {type:'edge', id:'e7', from:'canary', to:'prom'},
    {type:'counter', id:'cOverall', x:40, y:300, label:'Overall pass rate', value:'baseline 89.0 %'},
    {type:'counter', id:'cArabic', x:280, y:300, label:'Arabic slice (n = 200)', value:'baseline 88 %'},
    {type:'counter', id:'cAlias', x:540, y:300, label:'Registry aliases', value:'@champion → v6'},
    {type:'label', id:'note', x:40, y:380, text:'', hidden:true}
  ],
  steps:[
    {caption:'A change arrives: a new data snapshot (Delta version 412) and a training-code commit. The pipeline records both identities before anything else runs.', hl:['commit'], packets:[{edge:'e1',label:'v412'}], dur:3800},
    {caption:'<b>Continuous training</b> fine-tunes a LoRA adapter on the pinned snapshot. CT produces a <i>candidate</i>; it does not release anything.', hl:['train'], busy:['train'], packets:[{edge:'e2',label:'adapter'}], dur:3800},
    {caption:'The candidate is registered as <b>version 7</b> with alias <code>@candidate</code>. Production still resolves <code>@champion → v6</code>.', hl:['reg'], set:{cAlias:{value:'@champion → v6 · @candidate → v7'}}, packets:[{edge:'e3',label:'v7'}], dur:3800},
    {caption:'<b>Offline eval gate.</b> Overall pass rate rises 89.0 % → 91.0 %. But the Arabic slice falls 88 % → 79 % on 200 cases: z ≈ 0.09 / 0.0368 ≈ 2.4, a real regression.', hl:['eval'], set:{cOverall:{value:'89.0 % → 91.0 % (+2.0)'}, cArabic:{value:'88 % → 79 % (−9, z ≈ 2.4)'}}, dur:5000},
    {caption:'<b>Blocked.</b> The Arabic slice floor is a hard gate, so the global improvement cannot rescue v7. Nothing downstream runs; no GPU hours are spent on shadow or canary.', bad:['eval'], dim:['sign','shadow','canary','prom'], show:['note'], set:{note:{text:'Gate result: FAIL (critical slice). Cheap gates first save expensive ones.'}}, dur:5000},
    {caption:'The data team finds the snapshot under-sampled Arabic tickets, fixes the sampling, and the pipeline trains <b>v8</b>. Eval: overall 90.5 %, Arabic 89 % — every slice at or above its floor.', ok:['eval'], set:{cOverall:{value:'89.0 % → 90.5 %'}, cArabic:{value:'88 % → 89 % (pass)'}, cAlias:{value:'@champion → v6 · @candidate → v8'}, note:{text:'v8 passes offline gates.'}}, packets:[{edge:'e3',label:'v8'}], dur:4800},
    {caption:'<b>Supply-chain gate.</b> Image and model artifacts are scanned (no pickled code), licences checked, and signatures created and verified (cosign for the image, OpenSSF model-signing for the model directory).', ok:['sign'], packets:[{edge:'e4',label:'signed'}], dur:4200},
    {caption:'<b>Shadow.</b> A privacy-approved 10 % of live requests is mirrored to v8; responses are discarded. Crash rate, TTFT and judged quality distribution are compared with v6. Users see nothing.', hl:['shadow'], packets:[{edge:'e5',label:'mirror',count:3,cls:'c-blue'}], dur:4500},
    {caption:'<b>Canary.</b> Argo Rollouts sends 10 % of real users to v8. An AnalysisTemplate queries TTFT p95, error rate and negative-feedback rate per revision every few minutes and would abort automatically.', hl:['canary'], packets:[{edge:'e6',label:'10%',count:2,cls:'c-purple'}], set:{note:{text:'Analysis: TTFT p95 OK · errors OK · negative feedback OK'}}, dur:4800},
    {caption:'<b>Promote.</b> The pipeline moves <code>@champion → v8</code> and commits the concrete version and hash to the GitOps repo. v6 stays warm for 48 h so rollback is a traffic shift, not a cold start.', ok:['prom'], packets:[{edge:'e7',label:'v8',cls:'c-ok'}], set:{cAlias:{value:'@champion → v8 · @rollback → v6 (warm)'}, note:{text:'Release = bundle v8 + prompt v5 + index snapshot + image digest.'}}, dur:5200}
  ]
});

Anim.register({
  id:'v2-mlops-drift-investigate', title:'A drift alert triggers an investigation, not an automatic retrain', w:960, h:440,
  elements:[
    {type:'chart', id:'psi', x:70, y:50, w:380, h:190, xmax:14, ymax:1.0, xlabel:'day', ylabel:'PSI',
      series:[{id:'thr',label:'alert 0.25',points:[[0,0.25],[14,0.25]]},{id:'v',label:'lead_time PSI',points:[[0,0.03],[1,0.04],[2,0.02],[3,0.03],[4,0.05],[5,0.03],[6,0.04],[7,0.03]]}]},
    {type:'counter', id:'cpsi', x:70, y:290, label:'PSI today (lead_time_days)', value:'0.03'},
    {type:'node', id:'alert', x:560, y:30, w:220, h:50, label:'Drift alert', sub:'owner: risk-model team', icon:'warn'},
    {type:'node', id:'tri', x:560, y:110, w:220, h:50, label:'Triage runbook', sub:'cheapest layer first', icon:'search'},
    {type:'node', id:'data', x:490, y:200, w:200, h:50, label:'Data pipeline', sub:'contracts, schema', icon:'db'},
    {type:'node', id:'retr', x:730, y:200, w:200, h:50, label:'Retrieval / features', sub:'freshness, versions', icon:'cache'},
    {type:'node', id:'prompt', x:490, y:280, w:200, h:50, label:'Prompt / config', sub:'versions changed?', icon:'doc'},
    {type:'node', id:'model', x:730, y:280, w:200, h:50, label:'Model', sub:'last, with labels', icon:'llm'},
    {type:'node', id:'retrain', x:300, y:360, w:200, h:50, label:'Auto-retrain', sub:'learns the bug', icon:'x', hidden:true},
    {type:'node', id:'fix', x:560, y:360, w:280, h:50, label:'Fix CDC transform + backfill', sub:'model untouched', icon:'check', hidden:true},
    {type:'edge', id:'e0', from:'psi', to:'alert'},
    {type:'edge', id:'e1', from:'alert', to:'tri'},
    {type:'edge', id:'e2', from:'tri', to:'data'},
    {type:'edge', id:'e3', from:'tri', to:'retr'},
    {type:'edge', id:'e4', from:'data', to:'prompt'},
    {type:'edge', id:'e5', from:'retr', to:'model'},
    {type:'label', id:'root', x:70, y:345, text:'', hidden:true}
  ],
  steps:[
    {caption:'A cancellation-risk model on the same platform uses <code>lead_time_days</code>, fed by Debezium CDC from the bookings database. For a week, daily PSI against last quarter’s reference stays near 0.03 — normal variation.', hl:['psi'], dur:4200},
    {caption:'Day 8: PSI jumps to <b>0.91</b>, far above the 0.25 alert line. One feature, overnight, huge jump — the signature of a pipeline change rather than a real population shift.', set:{psi:{v:[[0,0.03],[1,0.04],[2,0.02],[3,0.03],[4,0.05],[5,0.03],[6,0.04],[7,0.03],[8,0.91]]}, cpsi:{value:'0.91 (alert > 0.25)'}}, bad:['psi'], packets:[{edge:'e0',label:'0.91',cls:'c-bad'}], dur:4500},
    {caption:'The alert routes to the model’s owner with a runbook link. It is an <b>investigation</b> ticket, not a retraining job.', hl:['alert'], packets:[{edge:'e1'}], dur:3800},
    {caption:'<b>What NOT to do:</b> an auto-retrain loop would train on last night’s data. The new model would learn that "lead time" now has values 24× larger, and ship that error with a green pipeline.', show:['retrain'], bad:['retrain'], dur:4800},
    {caption:'Triage starts at the cheapest, most likely layer: the <b>data pipeline</b>. Contract checks show the max value jumped from 365 to 8,760, and the schema registry shows a new version of the bookings topic.', hide:['retrain'], hl:['data'], warn:['data'], packets:[{edge:'e2',label:'check'}], dur:4800},
    {caption:'Root cause: the source service changed the column from <b>days to hours</b>. Debezium faithfully propagated it; the integer type did not change, so no transform failed. The CDC pipeline coerced it silently.', show:['root'], set:{root:{text:'Root cause: upstream unit change (days → hours) in CDC.\nRetrieval, prompt and model were never the problem.'}}, bad:['data'], dim:['retr','prompt','model'], dur:5200},
    {caption:'Fix the pipeline: convert hours back to days in the transform, add a contract (max ≤ 730, unit annotated), and backfill the affected partitions. The <b>model is not retrained</b>.', show:['fix'], ok:['fix'], dim:['retr','prompt','model'], dur:4500},
    {caption:'Day 10: PSI back to 0.04. Had the feature drifted gradually across many features instead, the next steps would be retrieval/features, prompt/config and finally the model — measuring quality on fresh labels before training any candidate, which would then pass the normal release gates.', set:{psi:{v:[[0,0.03],[1,0.04],[2,0.02],[3,0.03],[4,0.05],[5,0.03],[6,0.04],[7,0.03],[8,0.91],[9,0.88],[10,0.04],[11,0.03]]}, cpsi:{value:'0.04 (normal)'}}, ok:['psi','data'], show:['fix'], dur:5200}
  ]
});

Anim.register({
  id:'v2-mlops-alias-move', title:'Registry aliases: promotion and rollback are pointer moves', w:960, h:360,
  elements:[
    {type:'node', id:'v6', x:60, y:60, w:180, h:60, label:'Version 6', sub:'run a1f… data v398', icon:'db'},
    {type:'node', id:'v7', x:300, y:60, w:180, h:60, label:'Version 7', sub:'failed eval', icon:'db'},
    {type:'node', id:'v8', x:540, y:60, w:180, h:60, label:'Version 8', sub:'run c9e… data v412', icon:'db'},
    {type:'node', id:'champ', x:60, y:220, w:200, h:56, label:'@champion', icon:'key', cls:'hl'},
    {type:'node', id:'cand', x:330, y:220, w:200, h:56, label:'@candidate', icon:'key'},
    {type:'node', id:'git', x:620, y:220, w:290, h:56, label:'GitOps manifest', sub:'pins concrete version', icon:'k8s'},
    {type:'edge', id:'a1', from:'champ', to:'v6'},
    {type:'edge', id:'a2', from:'cand', to:'v7'},
    {type:'edge', id:'a3', from:'cand', to:'v8', hidden:true},
    {type:'edge', id:'a4', from:'champ', to:'v8', hidden:true},
    {type:'counter', id:'uri', x:60, y:320, label:'models:/atlas-support-lora@champion resolves to', value:'version 6'}
  ],
  steps:[
    {caption:'Versions are immutable and numbered. Aliases are mutable pointers. <code>@champion</code> points at version 6; the deployment manifest pins <b>version 6</b> explicitly.', hl:['champ','v6'], set:{git:{label:'GitOps manifest'}}, dur:4000},
    {caption:'Version 7 is registered and tagged <code>@candidate</code>. It fails the offline gate, so nothing else changes.', hl:['cand'], bad:['v7'], dur:3800},
    {caption:'Version 8 passes. The pipeline moves <code>@candidate</code> to v8 — one atomic metadata write via <code>set_registered_model_alias</code>.', hide:['a2'], show:['a3'], hl:['cand','v8'], dur:3800},
    {caption:'Promotion: the pipeline moves <code>@champion</code> to v8 and commits "version 8, sha256 …" to the GitOps repo. Argo CD deploys that immutable reference.', hide:['a1'], show:['a4'], ok:['v8','git'], set:{uri:{value:'version 8'}}, dur:4500},
    {caption:'Rollback is the reverse pointer move plus a Git revert to version 6 — fast only if version 6 is still warm. Old stages (Staging/Production) are deprecated since MLflow 2.9.0; aliases replace them.', hide:['a4'], show:['a1'], warn:['champ'], set:{uri:{value:'version 6 (rolled back)'}}, dur:4800}
  ]
});

/* ---- Part 5: RAG ---- */
Anim.register({
  id:'v2-rag-hnsw-search', title:'HNSW: greedy descent through a layered graph', w:960, h:440,
  elements:[
    {type:'zone', id:'z2', x:20, y:10, w:920, h:95, label:'Layer 2 (≈ 1/256 of vectors)'},
    {type:'zone', id:'z1', x:20, y:115, w:920, h:110, label:'Layer 1 (≈ 1/16 of vectors)'},
    {type:'zone', id:'z0', x:20, y:235, w:920, h:150, label:'Layer 0 (every vector)'},
    {type:'node', id:'A2', x:130, y:40, w:44, h:44, shape:'circle', label:'A'},
    {type:'node', id:'B2', x:580, y:40, w:44, h:44, shape:'circle', label:'B'},
    {type:'node', id:'A1', x:130, y:150, w:44, h:44, shape:'circle', label:'A'},
    {type:'node', id:'C1', x:360, y:150, w:44, h:44, shape:'circle', label:'C'},
    {type:'node', id:'B1', x:580, y:150, w:44, h:44, shape:'circle', label:'B'},
    {type:'node', id:'D1', x:820, y:150, w:44, h:44, shape:'circle', label:'D'},
    {type:'node', id:'A0', x:130, y:270, w:44, h:44, shape:'circle', label:'A'},
    {type:'node', id:'C0', x:360, y:270, w:44, h:44, shape:'circle', label:'C'},
    {type:'node', id:'F0', x:470, y:330, w:44, h:44, shape:'circle', label:'F'},
    {type:'node', id:'B0', x:580, y:270, w:44, h:44, shape:'circle', label:'B'},
    {type:'node', id:'G0', x:690, y:330, w:44, h:44, shape:'circle', label:'G'},
    {type:'node', id:'D0', x:820, y:270, w:44, h:44, shape:'circle', label:'D'},
    {type:'node', id:'Q', x:760, y:250, w:70, h:30, label:'query', cls:'hl', hidden:true},
    {type:'edge', id:'e2', from:'A2', to:'B2', arrow:false},
    {type:'edge', id:'e1a', from:'A1', to:'C1', arrow:false},
    {type:'edge', id:'e1b', from:'C1', to:'B1', arrow:false},
    {type:'edge', id:'e1c', from:'B1', to:'D1', arrow:false},
    {type:'edge', id:'e0a', from:'C0', to:'F0', arrow:false},
    {type:'edge', id:'e0b', from:'F0', to:'B0', arrow:false},
    {type:'edge', id:'e0c', from:'B0', to:'G0', arrow:false},
    {type:'edge', id:'e0d', from:'G0', to:'D0', arrow:false},
    {type:'edge', id:'e0e', from:'A0', to:'C0', arrow:false},
    {type:'edge', id:'d21', from:'B2', to:'B1', cls:'dash'},
    {type:'edge', id:'d10', from:'B1', to:'B0', cls:'dash'},
    {type:'counter', id:'dist', x:40, y:400, label:'Distance computations so far', value:'0'},
    {type:'counter', id:'brute', x:520, y:400, label:'Brute force on 10M vectors', value:'10,000,000'}
  ],
  steps:[
    {caption:'An HNSW index over 10 million chunk vectors. Every vector lives in layer 0; with m = 16 about 1 in 16 also appears in layer 1 and about 1 in 256 in layer 2. Higher layers are sparse "highways"; layer 0 is the dense local street map.', dur:4500},
    {caption:'A query vector arrives (shown near G in layer 0). Search starts at the fixed <b>entry point</b> A in the top layer and computes its distance to the query.', show:['Q'], hl:['A2'], set:{dist:{value:'1'}}, dur:4000},
    {caption:'<b>Greedy step in layer 2.</b> Compare the query with A’s neighbours. B is closer, so move to B. B has no closer neighbour in this layer: a local minimum.', hl:['B2'], packets:[{edge:'e2',label:'closer'}], set:{dist:{value:'2'}}, dur:4000},
    {caption:'<b>Descend.</b> B also exists in layer 1, so the search continues from B one layer down — it has already skipped most of the graph.', hl:['B1'], packets:[{edge:'d21'}], dur:3500},
    {caption:'In layer 1 the neighbours of B are C and D. Neither is closer to the query than B, so B is the best entry for layer 0. Distances computed: 4.', hl:['B1'], warn:['C1','D1'], set:{dist:{value:'4'}}, dur:4000},
    {caption:'<b>Layer 0.</b> Now the search keeps a candidate list of size <code>ef_search</code> (e.g. 40–100) instead of a single best node. From B it evaluates F, G and D.', hl:['B0'], packets:[{edge:'d10'}], warn:['F0','G0','D0'], set:{dist:{value:'7'}}, dur:4200},
    {caption:'G is closest. Its neighbours offer nothing better, and the candidate list stops improving, so the search ends. It returns the best k from the list: G, D, B.', ok:['G0','D0','B0'], packets:[{edge:'e0c',cls:'c-ok'}], set:{dist:{value:'9'}}, dur:4200},
    {caption:'In a real 10M-vector index a query typically evaluates thousands of vectors, not 10 million. That is the speed-up. The price: it can miss the true nearest neighbour (recall below 100 %). Raise <code>ef_search</code> for recall, lower it for latency; measure recall@k against exact search on a sample.', hl:['dist','brute'], dur:5000}
  ]
});

Anim.register({
  id:'v2-rag-hybrid-request', title:'One RAG request: identity, ACL filter, hybrid retrieval, RRF, rerank, cited answer', w:960, h:440,
  elements:[
    {type:'node', id:'user', x:20, y:50, w:120, h:56, label:'Agent', sub:'group: ops-KSA', icon:'user'},
    {type:'node', id:'gw', x:178, y:50, w:130, h:56, label:'AI gateway', sub:'verify JWT', icon:'shield'},
    {type:'node', id:'acl', x:345, y:50, w:140, h:56, label:'Policy filter', sub:'tenant + groups', icon:'lock'},
    {type:'node', id:'dense', x:520, y:16, w:140, h:56, label:'Dense ANN', sub:'HNSW top-50', icon:'search'},
    {type:'node', id:'lex', x:520, y:100, w:140, h:56, label:'BM25', sub:'top-50', icon:'doc'},
    {type:'node', id:'rrf', x:690, y:50, w:100, h:56, label:'RRF', sub:'k = 60'},
    {type:'node', id:'rr', x:815, y:50, w:125, h:56, label:'Rerank', sub:'cross-encoder'},
    {type:'node', id:'llm', x:790, y:210, w:150, h:56, label:'LLM', sub:'top-5 chunks', icon:'llm'},
    {type:'node', id:'ans', x:560, y:210, w:190, h:56, label:'Answer', sub:'cites POL-114 §3.2', icon:'check'},
    {type:'edge', id:'e1', from:'user', to:'gw'},
    {type:'edge', id:'e2', from:'gw', to:'acl'},
    {type:'edge', id:'e3', from:'acl', to:'dense'},
    {type:'edge', id:'e4', from:'acl', to:'lex'},
    {type:'edge', id:'e5', from:'dense', to:'rrf'},
    {type:'edge', id:'e6', from:'lex', to:'rrf'},
    {type:'edge', id:'e7', from:'rrf', to:'rr'},
    {type:'edge', id:'e8', from:'rr', to:'llm'},
    {type:'edge', id:'e9', from:'llm', to:'ans'},
    {type:'label', id:'lq', x:20, y:300, text:'Query: "refund window for SV fare class Y, POL-114?"'},
    {type:'label', id:'ld', x:20, y:330, text:'Dense ranks:'},
    {type:'tokens', id:'dl', x:130, y:318, h:24, items:['—']},
    {type:'label', id:'lb', x:20, y:365, text:'BM25 ranks:'},
    {type:'tokens', id:'bl', x:130, y:353, h:24, items:['—']},
    {type:'label', id:'lf', x:500, y:330, text:'Fused / reranked:'},
    {type:'tokens', id:'fl', x:630, y:318, h:24, items:['—']},
    {type:'counter', id:'lat', x:500, y:375, label:'Elapsed (illustrative)', value:'0 ms'}
  ],
  steps:[
    {caption:'An agent asks a question containing an exact policy id. The <b>gateway</b> verifies the JWT and extracts tenant = atlas and groups = [ops-KSA]. The model never supplies identity.', hl:['user','gw'], packets:[{edge:'e1',label:'JWT'}], dur:4200},
    {caption:'The groups become a <b>filter predicate</b> passed into both searches (pre-filtering). It is not a separate pass over results: disallowed chunks are never candidates.', hl:['acl'], packets:[{edge:'e2',label:'claims'}], set:{lat:{value:'5 ms'}}, dur:4200},
    {caption:'<b>Dense search</b> embeds the query (≈ 20 ms) and walks HNSW with the filter. Without the filter, H09 (HR salary bands) would have ranked #2; with it, H09 is excluded before ranking.', hl:['dense'], packets:[{edge:'e3',label:'vector + filter',cls:'c-blue'}], set:{dl:{items:[{t:'P12',cls:'hl'},'P03','P44']}, lat:{value:'45 ms'}}, dur:4800},
    {caption:'<b>BM25</b> runs in parallel with the same filter and catches the exact token "POL-114" that the embedding blurred: P03 ranks first.', hl:['lex'], packets:[{edge:'e4',label:'terms + filter',cls:'c-purple'}], set:{bl:{items:[{t:'P03',cls:'hl'},'P31','P12']}}, dur:4500},
    {caption:'<b>Reciprocal rank fusion</b>, k = 60: P03 = 1/61 + 1/62 = 0.03252; P12 = 1/63 + 1/61 = 0.03227; P31 = 1/62 = 0.01613; P44 = 1/63 = 0.01587. Chunks found by both retrievers rise.', hl:['rrf'], packets:[{edge:'e5'},{edge:'e6'}], set:{fl:{items:['P03','P12','P31','P44']}, lat:{value:'55 ms'}}, dur:5200},
    {caption:'The <b>cross-encoder</b> reads (query, chunk) pairs jointly for the ~50 fused candidates and reorders for precision. Here it promotes P12, which contains the actual refund-window sentence.', hl:['rr'], packets:[{edge:'e7',label:'50 pairs'}], set:{fl:{items:[{t:'P12',cls:'new'},'P03','P31']}, lat:{value:'160 ms'}}, dur:4800},
    {caption:'The top chunks (with ids, versions and section paths) go to the <b>LLM</b> with instructions to answer only from sources and to cite them.', hl:['llm'], packets:[{edge:'e8',label:'top-5'}], set:{lat:{value:'≈ 700 ms to first token'}}, dur:4200},
    {caption:'The answer cites POL-114 §3.2. The platform checks that every cited id was in the context and logs the served chunk ids for audit. Retrieval took ~160 ms; the LLM dominates latency and cost.', ok:['ans'], packets:[{edge:'e9',label:'cited',cls:'c-ok'}], dur:4800}
  ]
});

Anim.register({
  id:'v2-rag-cdc-freshness', title:'Keeping the index fresh with CDC: updates, deletes and permission changes', w:960, h:420,
  elements:[
    {type:'node', id:'pg', x:20, y:50, w:150, h:60, label:'Policy DB', sub:'Postgres WAL', icon:'db'},
    {type:'node', id:'dbz', x:200, y:50, w:150, h:60, label:'Debezium', sub:'CDC connector', icon:'gear'},
    {type:'node', id:'kafka', x:380, y:50, w:160, h:60, label:'Kafka topic', sub:'key = doc_id', icon:'queue'},
    {type:'node', id:'idx', x:570, y:50, w:170, h:60, label:'Indexer', sub:'chunk, hash, embed', icon:'bolt'},
    {type:'node', id:'vdb', x:770, y:50, w:170, h:60, label:'Vector + BM25', sub:'index alias: live', icon:'search'},
    {type:'node', id:'perm', x:200, y:190, w:170, h:60, label:'Permission sync', sub:'IdP groups, ACLs', icon:'key'},
    {type:'node', id:'cache', x:570, y:190, w:170, h:60, label:'Retrieval cache', sub:'keyed by doc + ACL', icon:'cache'},
    {type:'node', id:'rag', x:770, y:190, w:170, h:60, label:'RAG service', sub:'Atlas assistant', icon:'llm'},
    {type:'edge', id:'c1', from:'pg', to:'dbz'},
    {type:'edge', id:'c2', from:'dbz', to:'kafka'},
    {type:'edge', id:'c3', from:'kafka', to:'idx'},
    {type:'edge', id:'c4', from:'idx', to:'vdb'},
    {type:'edge', id:'c5', from:'perm', to:'kafka'},
    {type:'edge', id:'c6', from:'idx', to:'cache', label:'invalidate'},
    {type:'edge', id:'c7', from:'vdb', to:'rag'},
    {type:'counter', id:'lag', x:40, y:300, label:'Commit → searchable (illustrative)', value:'—'},
    {type:'counter', id:'ver', x:360, y:300, label:'POL-114 in index', value:'v6, 12 chunks'},
    {type:'counter', id:'emb', x:640, y:300, label:'Chunks re-embedded', value:'0'},
    {type:'label', id:'note', x:40, y:375, text:'', hidden:true}
  ],
  steps:[
    {caption:'The refund policy POL-114 is edited in the CMS database and committed as version 7. The index still holds version 6 (12 chunks).', hl:['pg'], set:{lag:{value:'t = 0 s'}}, dur:4000},
    {caption:'<b>Debezium</b> reads the Postgres WAL and publishes a change event (before/after row images) to Kafka. The topic is keyed by doc_id, so all events for POL-114 stay in order on one partition.', hl:['dbz','kafka'], packets:[{edge:'c1',label:'WAL'},{edge:'c2',label:'update',delay:500}], set:{lag:{value:'t ≈ 1.2 s'}}, dur:4500},
    {caption:'The <b>indexer</b> re-chunks v7 and compares content hashes with v6. Only 3 of 12 chunks changed, so only 3 are re-embedded, upserted by deterministic chunk id; one chunk that no longer exists is deleted.', hl:['idx'], packets:[{edge:'c3',label:'event'},{edge:'c4',label:'upsert 3, delete 1',delay:500,cls:'c-ok'}], set:{emb:{value:'3 of 12'}, ver:{value:'v7, 11 chunks'}, lag:{value:'t ≈ 4.5 s'}}, dur:5000},
    {caption:'The same event <b>invalidates</b> retrieval-cache entries that contain POL-114 chunks. Without this, cached results would keep serving v6 until a TTL expired.', hl:['cache'], packets:[{edge:'c6',cls:'c-bad'}], dur:4200},
    {caption:'Questions now retrieve v7. Freshness lag ≈ 4.5 s versus up to 24 h with a nightly rebuild. Alert on consumer lag in seconds, not on "job succeeded".', ok:['rag','vdb'], packets:[{edge:'c7',label:'v7'}], dur:4200},
    {caption:'A document is <b>deleted</b>. Debezium emits a delete event, typically followed by a tombstone so log compaction can drop the key. The indexer removes every chunk id for that doc from vector and BM25 indexes, and invalidates caches.', hl:['kafka','idx'], packets:[{edge:'c2',label:'delete',cls:'c-bad'},{edge:'c3',label:'tombstone',delay:500,cls:'c-bad'}], set:{emb:{value:'0 (delete only)'}}, dur:5000},
    {caption:'A user is <b>removed</b> from group ops-KSA. Permission changes flow through the same pipeline and update ACL metadata on chunks (or the group mapping) without re-embedding anything. Revocation must also meet the freshness SLO.', hl:['perm'], packets:[{edge:'c5',label:'ACL change',cls:'c-purple'},{edge:'c3',delay:500,cls:'c-purple'}], dur:5000},
    {caption:'Failure mode: the indexer crashes on a malformed PDF and consumer lag climbs. Users silently get stale answers. Send poison documents to a dead-letter queue, keep consuming, and page on lag.', bad:['idx'], warn:['kafka'], set:{lag:{value:'lag 45 min ↑'}}, dur:4800},
    {caption:'Changing the <b>embedding model</b> invalidates every vector at once. Backfill into a new index (v43) from a snapshot plus the Kafka stream, run the golden-set gate, then swap the alias. Rollback = swap back.', show:['note'], set:{note:{text:'Embedder change → new index + backfill + eval gate + alias swap (never mix vectors from two models).'}, lag:{value:'t ≈ 4.5 s'}}, ok:['vdb'], dur:5200}
  ]
});

/* ---- Part 3: distributed training and inference ---- */
Anim.register({
  id:'v2-par-tp-matmul', title:'Tensor parallelism: column split, row split, one all-reduce', w:960, h:430,
  elements:[
    {type:'node', id:'x', x:20, y:170, w:130, h:60, label:'Input X', sub:'tokens × h (copy on both)'},
    {type:'zone', id:'g0', x:190, y:20, w:560, h:170, label:'GPU 0'},
    {type:'zone', id:'g1', x:190, y:220, w:560, h:170, label:'GPU 1'},
    {type:'node', id:'w10', x:210, y:60, w:160, h:56, label:'W₁ columns 0..2h', sub:'h × 2h'},
    {type:'node', id:'y0', x:400, y:60, w:150, h:56, label:'Y⁽⁰⁾ = GeLU(XW₁⁽⁰⁾)', sub:'local'},
    {type:'node', id:'w20', x:580, y:60, w:150, h:56, label:'Z⁽⁰⁾ = Y⁽⁰⁾W₂⁽⁰⁾', sub:'partial sum'},
    {type:'node', id:'w11', x:210, y:260, w:160, h:56, label:'W₁ columns 2h..4h', sub:'h × 2h'},
    {type:'node', id:'y1', x:400, y:260, w:150, h:56, label:'Y⁽¹⁾ = GeLU(XW₁⁽¹⁾)', sub:'local'},
    {type:'node', id:'w21', x:580, y:260, w:150, h:56, label:'Z⁽¹⁾ = Y⁽¹⁾W₂⁽¹⁾', sub:'partial sum'},
    {type:'node', id:'ar', x:780, y:170, w:160, h:60, label:'All-reduce', sub:'Z = Z⁽⁰⁾ + Z⁽¹⁾', icon:'bolt'},
    {type:'edge', id:'e1', from:'x', to:'w10'},
    {type:'edge', id:'e2', from:'x', to:'w11'},
    {type:'edge', id:'e3', from:'w10', to:'y0'},
    {type:'edge', id:'e4', from:'w11', to:'y1'},
    {type:'edge', id:'e5', from:'y0', to:'w20'},
    {type:'edge', id:'e6', from:'y1', to:'w21'},
    {type:'edge', id:'e7', from:'w20', to:'ar'},
    {type:'edge', id:'e8', from:'w21', to:'ar'},
    {type:'counter', id:'mem', x:20, y:280, label:'MLP weights per GPU', value:'8h² → 4h²'},
    {type:'counter', id:'comm', x:20, y:340, label:'Communication', value:'none yet'}
  ],
  steps:[
    {caption:'An MLP block computes Z = GeLU(X·W₁)·W₂ with W₁ of shape h × 4h and W₂ of shape 4h × h. With tensor parallelism t = 2, each GPU stores half of both matrices: 8h² parameters become 4h² per GPU.', hl:['x'], dur:4500},
    {caption:'<b>Column split of W₁.</b> GPU 0 gets the first 2h columns, GPU 1 the last 2h. Both receive the full input X (it is already replicated from the previous all-reduce).', hl:['w10','w11'], packets:[{edge:'e1',label:'X'},{edge:'e2',label:'X'}], dur:4200},
    {caption:'Each GPU computes its half of the hidden activation. GeLU is element-wise, so applying it to each half separately gives exactly the same numbers as applying it to the whole. <b>No communication needed.</b>', hl:['y0','y1'], packets:[{edge:'e3'},{edge:'e4'}], dur:4500},
    {caption:'<b>Row split of W₂.</b> GPU 0 holds rows 0..2h, matching its half of Y. Each GPU produces a full-size [tokens × h] result, but it is only a <i>partial sum</i>.', hl:['w20','w21'], packets:[{edge:'e5'},{edge:'e6'}], dur:4500},
    {caption:'An <b>all-reduce</b> adds the partial sums so both GPUs hold the complete Z. For 4,096 tokens × h = 8,192 in BF16 that is 64 MiB per all-reduce.', hl:['ar'], packets:[{edge:'e7',label:'Z⁽⁰⁾',cls:'c-purple'},{edge:'e8',label:'Z⁽¹⁾',cls:'c-purple'}], set:{comm:{value:'1 all-reduce (64 MiB)'}}, dur:4800},
    {caption:'Attention is split the same way (heads per GPU, then a row-parallel output projection and one all-reduce). So every transformer layer costs <b>2 all-reduces forward + 2 backward</b>. For 80 layers that is 160 all-reduces per forward pass.', set:{comm:{value:'2 per layer × 80 = 160 per forward'}}, warn:['ar'], dur:4800},
    {caption:'Over NVLink this traffic takes tens of milliseconds per forward; over a 400 Gb/s network roughly 9× longer. That is why TP stays inside one NVLink domain and pipeline or data parallelism spans nodes.', ok:['g0','g1'], dur:4800}
  ]
});

(function(){
  function cells(p,m){
    var out=[];
    for(var s=0;s<p;s++){
      for(var i=0;i<m;i++){
        out.push({row:'s'+s,col:s+i,cls:'pre',text:'F'+(i+1)});
        out.push({row:'s'+s,col:(m+p-1)+i+(p-1-s),cls:'dec',text:'B'+(i+1)});
      }
    }
    return out;
  }
  function idle(p,m){
    var busy={},out=[];cells(p,m).forEach(function(c){busy[c.row+':'+c.col]=1;});
    var T=2*(m+p-1);
    for(var s=0;s<p;s++)for(var c=0;c<T;c++)if(!busy['s'+s+':'+c])out.push({row:'s'+s,col:c,cls:'idle'});
    return out;
  }
  var rows=[{id:'s0',label:'GPU 0'},{id:'s1',label:'GPU 1'},{id:'s2',label:'GPU 2'},{id:'s3',label:'GPU 3'}];
  var c44=cells(4,4), f44=c44.filter(function(c){return c.cls==='pre';}), b44=c44.filter(function(c){return c.cls==='dec';});
  Anim.register({
    id:'v2-par-pipeline-bubbles', title:'Pipeline parallelism: where the bubble comes from', w:960, h:440,
    elements:[
      {type:'label', id:'t1', x:40, y:16, text:'p = 4 stages, m = 4 micro-batches (GPipe schedule: all forwards, then all backwards)'},
      {type:'timeline', id:'tl', x:40, y:40, w:880, h:150, labelW:70, cols:14, ticks:true, rows:rows},
      {type:'label', id:'t2', x:40, y:222, text:'p = 4 stages, m = 8 micro-batches', hidden:true},
      {type:'timeline', id:'tl8', x:40, y:246, w:880, h:120, labelW:70, cols:22, rows:rows, hidden:true},
      {type:'counter', id:'bf', x:40, y:385, label:'Bubble fraction (p − 1)/(m + p − 1)', value:'—'},
      {type:'counter', id:'bf8', x:520, y:385, label:'With m = 8', value:'—', hidden:true}
    ],
    steps:[
      {caption:'Four GPUs each hold a quarter of the layers. A training step processes 4 micro-batches. Time runs left to right; each slot is one stage processing one micro-batch.', dur:4000},
      {caption:'<b>Forward passes</b> (F, purple). Micro-batch 1 enters GPU 0 at slot 1, reaches GPU 3 at slot 4. GPU 3 has nothing to do for its first 3 slots: the pipeline is filling.', set:{tl:{cells:f44}}, dur:5000},
      {caption:'<b>Backward passes</b> (B, green) run in reverse order of stages, starting at GPU 3. Now GPU 0 waits at the end while gradients flow back: the pipeline drains.', set:{tl:{cells:b44}}, dur:5000},
      {caption:'The empty dark slots are the <b>bubble</b>. Each GPU is idle 6 of 14 slots: (p − 1)/(m + p − 1) = 3/7 ≈ <b>42.9 %</b>. Four expensive GPUs, almost half wasted.', set:{tl:{cells:idle(4,4)}, bf:{value:'3 / 7 = 42.9 %'}}, warn:['tl'], dur:5200},
      {caption:'<b>More micro-batches</b> amortise the fill and drain. With m = 8 the same 3-slot fill/drain is spread over 11 slots per direction: 3/11 ≈ <b>27.3 %</b>. With m = 32 it would be 8.6 %.', show:['t2','tl8','bf8'], set:{tl8:{cells:cells(4,8).concat(idle(4,8)).map(function(c){return {row:c.row,col:c.col,cls:c.cls};})}, bf8:{value:'3 / 11 = 27.3 %'}}, ok:['tl8'], dur:5500},
      {caption:'The catch: more micro-batches in flight means more stored activations. 1F1B schedules interleave one forward and one backward to cap that memory; interleaved stages shrink the bubble further at the cost of more point-to-point communication. Rule of thumb: m ≥ 4p.', dur:5200}
    ]
  });
})();

Anim.register({
  id:'v2-par-moe-routing', title:'Mixture-of-Experts: top-2 routing, all-to-all and load imbalance', w:960, h:470,
  elements:[
    {type:'tokens', id:'toks', x:40, y:30, h:26, items:['refund','PNR','Riyadh','baggage','visa','fare']},
    {type:'node', id:'router', x:60, y:200, w:150, h:60, label:'Router', sub:'scores 8 experts', icon:'gear'},
    {type:'zone', id:'ga', x:400, y:80, w:540, h:170, label:'GPU A (experts 1–4)'},
    {type:'zone', id:'gb', x:400, y:265, w:540, h:170, label:'GPU B (experts 5–8)'},
    {type:'node', id:'e1', x:430, y:105, w:140, h:50, label:'Expert 1'},
    {type:'node', id:'e2', x:430, y:180, w:140, h:50, label:'Expert 2'},
    {type:'node', id:'e5', x:430, y:290, w:140, h:50, label:'Expert 5'},
    {type:'node', id:'e6', x:430, y:365, w:140, h:50, label:'Expert 6'},
    {type:'bar', id:'l1', x:620, y:125, w:280, h:18, label:'load E1', value:0},
    {type:'bar', id:'l2', x:620, y:200, w:280, h:18, label:'load E2', value:0},
    {type:'bar', id:'l5', x:620, y:310, w:280, h:18, label:'load E5', value:0},
    {type:'bar', id:'l6', x:620, y:385, w:280, h:18, label:'load E6', value:0},
    {type:'edge', id:'r1', from:'router', to:'e1', fromSide:'right', toSide:'left'},
    {type:'edge', id:'r2', from:'router', to:'e2', fromSide:'right', toSide:'left'},
    {type:'edge', id:'r5', from:'router', to:'e5', fromSide:'right', toSide:'left'},
    {type:'edge', id:'r6', from:'router', to:'e6', fromSide:'right', toSide:'left'},
    {type:'label', id:'cap', x:40, y:300, text:'capacity = 1,024 avg × 1.25\n= 1,280 slots per expert', hidden:true},
    {type:'counter', id:'a2a', x:40, y:360, label:'All-to-all bytes', value:'—'},
    {type:'counter', id:'act', x:40, y:420, label:'Compute per token', value:'2 of 8 experts'}
  ],
  steps:[
    {caption:'An MoE layer has 8 expert feed-forward blocks (4 shown) spread over 2 GPUs (expert parallelism). A micro-batch of 4,096 tokens arrives; six are shown.', hl:['toks'], dur:4200},
    {caption:'The <b>router</b>, a small linear layer, scores every expert for every token and keeps the <b>top-2</b>. Each token will use only 2 of 8 experts: compute per token is about a quarter of a dense model with the same total parameters.', hl:['router'], dur:4500},
    {caption:'<b>All-to-all dispatch.</b> Tokens are sent to the GPUs holding their chosen experts. 4,096 × 2 assignments × h 4,096 × 2 bytes = 64 MiB leaves the GPUs (minus tokens whose experts are local).', packets:[{edge:'r1',count:2},{edge:'r2',count:3,cls:'c-purple'},{edge:'r5',count:2,cls:'c-blue'},{edge:'r6',count:1}], set:{a2a:{value:'64 MiB dispatch'}, l1:{value:0.5,text:'1,000'}, l2:{value:0.62,text:'1,250'}, l5:{value:0.48,text:'960'}, l6:{value:0.45,text:'900'}}, dur:5200},
    {caption:'Balanced routing would give each expert 8,192 / 8 = 1,024 tokens. With capacity factor 1.25 each expert has 1,280 slots.', show:['cap'], dur:4200},
    {caption:'But the router loves Expert 2 for travel-policy tokens: it receives 1,600. 320 tokens overflow capacity and are dropped (passed through the residual) or re-routed, and GPU A becomes the straggler for this layer.', set:{l2:{value:0.98,text:'1,600 (320 over)'}}, bad:['e2'], warn:['ga'], dur:5200},
    {caption:'<b>All-to-all combine</b> returns expert outputs to the tokens’ home GPUs, weighted by router scores: another 64 MiB. Two all-to-alls per MoE layer, every layer.', packets:[{edge:'r1',reverse:true},{edge:'r2',reverse:true,cls:'c-purple'},{edge:'r5',reverse:true,cls:'c-blue'},{edge:'r6',reverse:true}], set:{a2a:{value:'64 + 64 = 128 MiB per layer'}}, dur:4800},
    {caption:'Training adds an <b>auxiliary load-balancing loss</b> (or bias-based balancing) so the router spreads tokens. Serving can replicate hot experts. Memory still holds all 8 experts: MoE saves FLOPs, not weight memory.', set:{l1:{value:0.6,text:'1,040'}, l2:{value:0.63,text:'1,060'}, l5:{value:0.58,text:'1,000'}, l6:{value:0.57,text:'990'}}, ok:['e1','e2','e5','e6'], dur:5200}
  ]
});

(function(){
  var N=4, S=14;
  var own=[];for(var g=0;g<N;g++){own[g]=[];for(var c=0;c<N;c++)own[g][c]=1;}
  function items(g,doneSet){return [0,1,2,3].map(function(c){var k=own[g][c];return k>=N?{t:'C'+c+' Σ',cls:'new'}:(k>1?{t:'C'+c+' '+k+'/4',cls:'hl'}:{t:'C'+c});});}
  var steps=[];
  function snap(){var s={};for(var g=0;g<N;g++)s['m'+g]={items:items(g)};return s;}
  steps.push({caption:'Four GPUs each hold a full 14 GB gradient tensor (a 7B model in BF16) cut into 4 chunks C0–C3. Goal: every GPU ends with the <b>sum</b> of all four tensors. They form a ring: 0 → 1 → 2 → 3 → 0.', set:snap(), dur:4800});
  for(var t=0;t<N-1;t++){
    var sent=[];for(var g2=0;g2<N;g2++){var c2=((g2-t)%N+N)%N;sent.push([g2,c2,own[g2][c2]]);}
    sent.forEach(function(x){var dst=(x[0]+1)%N;own[dst][x[1]]=Math.max(own[dst][x[1]],x[2]+1);});
    var st=snap();st.bytes={value:((t+1)*S/N).toFixed(1)+' GB'};
    steps.push({caption:'<b>Reduce-scatter step '+(t+1)+' of 3.</b> Every GPU sends one chunk (14/4 = 3.5 GB) to its neighbour, which <i>adds</i> it to its own copy. All 4 links are busy at once.'+(t===2?' Now each GPU owns one fully summed chunk (Σ).':''),
      packets:[0,1,2,3].map(function(g3){var c3=((g3-t)%N+N)%N;return {edge:'r'+g3,label:'C'+c3,cls:t===2?'c-ok':'c-purple'};}), set:st, dur:4800});
  }
  for(var u=0;u<N-1;u++){
    for(var g4=0;g4<N;g4++){var c4=((g4+1-u)%N+N)%N;var dst=(g4+1)%N;if(own[g4][c4]>=N)own[dst][c4]=N;}
    var st2=snap();st2.bytes={value:((N-1+u+1)*S/N).toFixed(1)+' GB'};
    steps.push({caption:'<b>All-gather step '+(u+1)+' of 3.</b> Finished chunks travel around the ring and simply overwrite stale copies — no more adding.'+(u===2?' Every GPU now holds the full sum.':''),
      packets:[0,1,2,3].map(function(g5){var c5=((g5+1-u)%N+N)%N;return {edge:'r'+g5,label:'C'+c5+' Σ',cls:'c-ok'};}), set:st2, dur:4500});
  }
  steps.push({caption:'Total: 2(N − 1) = 6 steps of S/N each, so every GPU sent 6 × 3.5 = <b>21 GB</b> = 2(N − 1)/N × S = 1.5 × 14 GB. With 8 GPUs it is 1.75 × S; as N grows it approaches 2S — per-GPU traffic barely grows with N, which is why the ring scales. Latency, however, grows with the number of steps.', ok:['g0','g1','g2','g3'], dur:5500});
  Anim.register({
    id:'v2-dist-ring-allreduce', title:'Ring all-reduce: reduce-scatter, then all-gather', w:960, h:440,
    elements:[
      {type:'node', id:'g0', x:60, y:40, w:150, h:56, label:'GPU 0', icon:'gpu'},
      {type:'node', id:'g1', x:750, y:40, w:150, h:56, label:'GPU 1', icon:'gpu'},
      {type:'node', id:'g2', x:750, y:260, w:150, h:56, label:'GPU 2', icon:'gpu'},
      {type:'node', id:'g3', x:60, y:260, w:150, h:56, label:'GPU 3', icon:'gpu'},
      {type:'edge', id:'r0', from:'g0', to:'g1'},
      {type:'edge', id:'r1', from:'g1', to:'g2'},
      {type:'edge', id:'r2', from:'g2', to:'g3'},
      {type:'edge', id:'r3', from:'g3', to:'g0'},
      {type:'tokens', id:'m0', x:240, y:150, h:24, items:['C0','C1','C2','C3']},
      {type:'tokens', id:'m1', x:520, y:150, h:24, items:['C0','C1','C2','C3']},
      {type:'tokens', id:'m2', x:520, y:216, h:24, items:['C0','C1','C2','C3']},
      {type:'tokens', id:'m3', x:240, y:216, h:24, items:['C0','C1','C2','C3']},
      {type:'label', id:'l0', x:240, y:136, text:'GPU 0 holds:'},
      {type:'label', id:'l1', x:520, y:136, text:'GPU 1 holds:'},
      {type:'label', id:'l3', x:240, y:202, text:'GPU 3 holds:'},
      {type:'label', id:'l2', x:520, y:202, text:'GPU 2 holds:'},
      {type:'counter', id:'bytes', x:60, y:385, label:'Bytes sent per GPU so far', value:'0 GB'},
      {type:'counter', id:'form', x:520, y:385, label:'Formula', value:'2(N − 1)/N × S'}
    ],
    steps:steps
  });
})();

Anim.register({
  id:'v2-dist-disagg-kv', title:'Disaggregated serving: prefill → KV transfer → decode', w:960, h:430,
  elements:[
    {type:'node', id:'user', x:20, y:60, w:120, h:56, label:'User', sub:'4,000-token prompt', icon:'user'},
    {type:'node', id:'router', x:170, y:60, w:140, h:56, label:'Router', sub:'Dynamo / llm-d', icon:'gear'},
    {type:'zone', id:'pz', x:340, y:20, w:250, h:150, label:'Prefill pool'},
    {type:'node', id:'pre', x:360, y:60, w:210, h:60, label:'Prefill worker TP4', sub:'computes KV for prompt', icon:'gpu'},
    {type:'zone', id:'dz', x:690, y:20, w:250, h:150, label:'Decode pool'},
    {type:'node', id:'dec', x:710, y:60, w:210, h:60, label:'Decode worker TP4', sub:'streams tokens', icon:'gpu'},
    {type:'edge', id:'a', from:'user', to:'router'},
    {type:'edge', id:'b', from:'router', to:'pre'},
    {type:'edge', id:'c', from:'pre', to:'dec', label:'NIXL / RDMA'},
    {type:'edge', id:'d', from:'dec', to:'user', path:'M815,120 C815,235 80,235 80,116'},
    {type:'counter', id:'kv', x:40, y:260, label:'KV to move (320 KiB/token)', value:'—'},
    {type:'counter', id:'xfer', x:360, y:260, label:'Transfer time', value:'—'},
    {type:'counter', id:'pf', x:660, y:260, label:'Prefill time (illustrative)', value:'—'},
    {type:'label', id:'note', x:40, y:340, text:'', hidden:true}
  ],
  steps:[
    {caption:'A 4,000-token prompt arrives (policy documents + question). The router (Dynamo’s KV-aware router or llm-d’s endpoint picker) picks a prefill worker, preferring one that already caches part of the prefix.', hl:['user','router'], packets:[{edge:'a',label:'prompt'},{edge:'b',delay:500}], dur:4500},
    {caption:'<b>Prefill</b> processes all 4,000 tokens in parallel: ≈ 2 × 70 × 10⁹ × 4,000 = 5.6 × 10¹⁴ FLOP, about 0.35 s on 4 H100s at an assumed 40 % of dense peak. It writes the KV cache.', hl:['pre'], busy:['pre'], set:{pf:{value:'≈ 350 ms'}}, dur:4800},
    {caption:'The KV cache must move: 4,000 × 320 KiB = <b>1.31 GB</b>. NIXL moves it GPU-to-GPU over RDMA (GPUDirect), layer by layer so transfer overlaps with compute.', set:{kv:{value:'4,000 × 320 KiB ≈ 1.31 GB'}}, hl:['c'], dur:4500},
    {caption:'At 400 Gb/s (50 GB/s) the transfer takes ≈ <b>26 ms</b> — under 10 % of the prefill time it frees the decode GPUs from.', packets:[{edge:'c',label:'1.31 GB',count:3,cls:'c-purple'}], set:{xfer:{value:'≈ 26 ms at 50 GB/s'}}, ok:['c'], dur:4800},
    {caption:'<b>Decode</b> streams tokens at a steady TPOT. Because no prefill runs on this GPU, a newly arriving long prompt cannot stall the 100+ sequences already streaming here.', hl:['dec'], packets:[{edge:'d',label:'tokens',count:4,cls:'c-ok',reverse:false}], dur:4800},
    {caption:'Same maths over a 100 Gb/s TCP path: 1.31 / 12.5 GB/s ≈ <b>105 ms</b> added to TTFT, and CPU copies on top. A slow link can erase the benefit.', set:{xfer:{value:'≈ 105 ms at 12.5 GB/s'}}, warn:['c'], dur:4800},
    {caption:'Short prompt (200 tokens): KV = 62.5 MiB → ≈ 1.3 ms to move, but prefill is only ≈ 18 ms and fixed overheads dominate. Good systems disaggregate <b>conditionally</b>: short prompts prefill locally on the decode worker.', set:{kv:{value:'200 × 320 KiB = 62.5 MiB'}, xfer:{value:'≈ 1.3 ms'}, pf:{value:'≈ 18 ms'}}, show:['note'], dur:5200},
    {caption:'Operate it with numbers: TTFT = queue + prefill + transfer; size prefill pools on queued prompt tokens and decode pools on KV usage (Dynamo’s Planner automates this). Keep it only if goodput at your TTFT and TPOT SLOs improves.', set:{note:{text:'Disaggregate when prefill interference breaks TPOT and an RDMA fabric makes transfer cheap.'}}, ok:['pz','dz'], dur:5200}
  ]
});
