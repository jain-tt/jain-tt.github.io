/* Volume 3 · Part 2 · Chapter 10 — Questions: agents, A2A and agent security (question bank) */
registerLesson({
  id:'v3-ch-agents', vol:3, part:2, num:10,
  title:'Questions: agents, A2A and agent security', minutes:150,
  summary:'This chapter prepares you for the agent round of a senior AI platform interview. Interviewers want to know whether you can let a model take actions without letting it take the wrong ones. You will practise answers on guardrails for destructive actions, multi-tenant tool platforms, agent architectures, human approval, evaluation, cost, identity and delegation, the A2A protocol, and the ways multi-agent systems fail.',
  objectives:[
    'Explain, with layers outside the model, how to stop an agent from performing a destructive production action.',
    'Choose between a deterministic workflow, a single agent loop, plan-and-execute and a multi-agent supervisor for a given task, and justify the choice.',
    'Design human-in-the-loop approval that survives restarts, binds approval to an exact plan, and times out safely.',
    'Describe agent identity, delegated permissions and why token passthrough is forbidden.',
    'Explain what A2A adds next to MCP (Agent Cards, tasks, task states) and name the multi-agent failure modes from the OWASP Agentic Top 10.',
    'Build an evaluation and cost-control plan for an agent with measurable gates.'
  ],
  prereqs:['v2-agents','v2-a2a-multiagent','v2-mcp-security','v2-mcp-auth'],
  next:['v3-ch-hyperscale','v3-ch-security','v3-prove-mcp'],
  tags:['agents','a2a','mcp','security','interview'],
  html:`
<h2>What interviewers test in this chapter</h2>
<p>An agent is a program in which a language model chooses the next step: which tool to call, with which arguments, and when to stop. That single property changes the risk profile of everything around it. A chatbot that is wrong produces a bad paragraph. An agent that is wrong can delete a database, email a customer list to a stranger, or spend a month of GPU budget in an afternoon.</p>
<p>So the agent round is rarely about frameworks. Senior interviewers probe four things:</p>
<ul>
<li><b>Control.</b> Can you keep authority outside the model? Every strong answer puts the decisive check in code, identity or policy that the model cannot talk its way around: least-privilege credentials, a policy engine, an approval bound to a specific plan, deletion protection.</li>
<li><b>Judgement.</b> Do you know when <i>not</i> to use an agent? Many "agent" problems are better solved by a deterministic workflow with one or two model calls inside it.</li>
<li><b>Operations.</b> Can you evaluate, observe, budget and debug an agent? That means trajectories, tool-call accuracy, step and token budgets, and traces with the OpenTelemetry GenAI agent spans.</li>
<li><b>Ecosystem literacy.</b> Do you understand where MCP stops and A2A starts, what an Agent Card is, how tasks move through states, and which OWASP Agentic risks (ASI01–ASI10) apply to a design?</li>
</ul>
<p>Expect follow-ups that move from "what" to "what happens when it breaks". A candidate who says "we add human approval" will be asked what exactly the human approves, what happens when the plan changes after approval, and what happens if the approver never answers.</p>

<h2>The mental model</h2>
<p>Think of an agent as an untrusted planner sitting inside a trusted execution envelope. The model proposes. The envelope decides. Everything that grants or limits power — identity, scopes, policy, approval, budgets, audit — lives in the envelope, never in the prompt.</p>
${fig('Agent = untrusted planner inside a trusted envelope', svgDiagram({w:900,h:360,
  zones:[{x:20,y:40,w:300,h:290,label:'Untrusted: model + inputs',cls:'danger'},{x:340,y:40,w:540,h:290,label:'Trusted envelope (code, identity, policy)',cls:'ok'}],
  boxes:[
    {id:'u',x:40,y:70,w:120,h:50,label:'User / event',sub:'goal'},
    {id:'m',x:40,y:170,w:120,h:56,label:'LLM planner',sub:'proposes step',cls:'warn'},
    {id:'ctx',x:180,y:260,w:120,h:50,label:'Tool output',sub:'untrusted data'},
    {id:'pol',x:370,y:80,w:150,h:56,label:'Policy engine',sub:'Cedar / OPA',cls:'hl'},
    {id:'hitl',x:370,y:200,w:150,h:56,label:'Approval',sub:'bound to plan hash'},
    {id:'bud',x:550,y:200,w:140,h:56,label:'Budgets',sub:'steps, tokens, $'},
    {id:'ex',x:560,y:80,w:140,h:56,label:'Tool executor',sub:'scoped creds',cls:'ok'},
    {id:'aud',x:720,y:200,w:140,h:56,label:'Audit + traces',sub:'OTel GenAI'},
    {id:'sys',x:730,y:80,w:130,h:56,label:'Prod systems',sub:'K8s, DB, APIs'}
  ],
  arrows:[{from:'u',to:'m'},{from:'m',to:'pol',label:'tool call'},{from:'pol',to:'hitl',label:'if risky'},{from:'pol',to:'ex',label:'allow'},{from:'ex',to:'sys'},{from:'sys',to:'ctx',label:'result',cls:'dash'},{from:'ctx',to:'m',cls:'dash'},{from:'ex',to:'aud',cls:'dash'}]
}), 'The model never holds credentials. Every proposed tool call crosses into the trusted envelope, where policy, approval and budgets decide. Tool output flows back as untrusted data — the main prompt-injection path.')}
<p>Three consequences follow, and they answer most questions in this chapter. First, <b>the blast radius of an agent equals the permissions of its identity</b>, not the wording of its instructions. Second, <b>tool output is input from an attacker</b> until proven otherwise (OWASP ASI01 Agent Goal Hijack). Third, <b>every step costs money and time</b>, so loops need explicit budgets and termination conditions.</p>

<h2>Weak answer vs strong answer</h2>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"We tell the agent in the system prompt never to delete anything, and we use a powerful model so it follows instructions."</p><p>Prompts are guidance, not access control. Prompt injection, hallucinated arguments or a misread goal bypass them.</p></div><div class="good"><h4>Strong answer</h4><p>"The agent's identity has no delete permission at all. Mutating tools are separate, off by default, and go through a policy engine and a dry-run. A human approves the exact plan hash, the executor uses short-lived scoped credentials, and deletion protection plus backups bound the worst case."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"We will build a multi-agent system with a planner, a researcher and a reviewer agent."</p><p>Starts with the architecture fashion, not the task. Multiplies cost and failure modes.</p></div><div class="good"><h4>Strong answer</h4><p>"I start from the task's variability. If the steps are known, a deterministic workflow with a model call for classification is cheaper and testable. I add a single tool loop only where the path genuinely varies, and split into agents only when context or permissions must be separated."</p></div></div>
<div class="compare"><div class="bad"><h4>Weak answer</h4><p>"A2A replaces MCP for agents."</p></div><div class="good"><h4>Strong answer</h4><p>"They sit on different axes. MCP connects one agent to tools and data — vertical. A2A connects independent agents that keep their internals private, exchanging messages and long-running tasks — horizontal. A real platform uses both."</p></div></div>

<h2>How to practise this chapter</h2>
<ol>
<li>For each question, say the 45-second short answer aloud, then draw the diagram from memory.</li>
<li>Pick one design question (v3agt-01 or v3agt-02) and walk it end to end for the Atlas capstone: which tools are read-only, which need approval, which identity runs them.</li>
<li>Answer every follow-up out loud. Most interviews are lost on the second follow-up, not the first question.</li>
<li>Be honest about scope. Say "[In my lab I built an approval gate with LangGraph interrupt() and a Postgres checkpointer]" only if you did. Otherwise: "I have designed this but not run it in production; here is how I would validate it."</li>
</ol>
${callout('note','Versions move fast','Framework versions and spec details in this chapter are as of Oct 2026. MCP has two live eras: 2025-11-25 (initialize handshake, sessions) and 2026-07-28 (stateless, MRTR). A2A is at 1.0.x. Say which era you mean.')}

<div class="connections"><h4>How this connects</h4>
${chain(['Agent goal','Planner (LLM)','Policy + approval','Scoped tool call','Audit + eval','Cost per successful task'])}
${chain(['MCP (agent → tools)','A2A (agent → agent)','Identity + delegation','OWASP Agentic Top 10'])}
<p>Teaching lessons: ${L('v2-agents','AI agents')}, ${L('v2-a2a-multiagent','A2A and multi-agent systems')}, ${L('v2-mcp-security','MCP threat modeling')}, ${L('v2-mcp-auth','securing remote MCP')}, ${L('v2-governance','identity and governance')}. Question banks next door: ${L('v3-ch-mcp','MCP questions')} and ${L('v3-ch-security','AI security questions')}.</p></div>
`,
  quiz:[
    {q:'An agent has read-write Kubernetes credentials, and its system prompt says "never delete namespaces". What is the real control on namespace deletion?',options:['The system prompt','The model provider safety training','None — the effective control is whatever the credentials allow','The temperature setting'],answer:2,explain:'Blast radius equals the permissions of the identity. A prompt is advisory and can be overridden by injection or error. The tempting answer "the system prompt" confuses instructions with authorization.'},
    {q:'In LangGraph, a node calls interrupt() for approval. What must be true for resume to work, and what is the side-effect hazard?',options:['Nothing is needed; state is kept in the Python process','A checkpointer and a thread_id are required, and code before interrupt() re-runs on resume so it must be idempotent','Only a thread_id is needed; the node resumes exactly at the interrupt line','A checkpointer is needed but the node never re-executes'],answer:1,explain:'interrupt() requires a checkpointer and a thread_id; resuming with Command(resume=...) re-runs the node from its start, so anything before interrupt() executes again. Assuming it resumes at the exact line leads to duplicate side effects.'},
    {q:'Which statement about A2A and MCP is correct (as of Oct 2026)?',options:['A2A is a newer version of MCP','MCP connects an agent to tools and data; A2A connects independent agents; both can be used together','A2A only works over gRPC','MCP servers must publish an Agent Card'],answer:1,explain:'The A2A docs describe MCP as vertical and A2A as horizontal and recommend using both. A2A v1.0 supports JSON-RPC, gRPC and HTTP+JSON bindings; Agent Cards are an A2A concept at /.well-known/agent-card.json.'},
    {q:'An MCP server receives a user access token and needs to call a downstream billing API. What should it do?',options:['Forward the same token to the billing API','Obtain a separate token for the billing API (for example by token exchange or its own credentials) scoped to the user and task','Store the token in the tool arguments for the model to reuse','Ask the model for the billing API key'],answer:1,explain:'The MCP authorization spec forbids token passthrough: the server must not pass through the token it received; tokens must be audience-bound. Forwarding breaks audience validation and creates a confused deputy.'},
    {q:'Which OWASP Top 10 for Agentic Applications (2026) item best describes one agent failure triggering failures in many dependent agents?',options:['ASI01 Agent Goal Hijack','ASI05 Unexpected Code Execution','ASI08 Cascading Failures','ASI10 Rogue Agents'],answer:2,explain:'ASI08 Cascading Failures covers propagation of errors across connected agents and systems. Goal hijack (ASI01) is about redirecting an agent’s objective, typically via injected content.'}
  ],
  flashcards:[
    {front:'Blast radius of an agent',back:'Equals the permissions of the identity that executes its tools — not its prompt. Minimise permissions first.'},
    {front:'Approval bound to a plan hash',back:'The human approves a canonical hash of the exact actions and arguments; the executor refuses to run anything whose hash differs, so the plan cannot change after approval.'},
    {front:'LangGraph interrupt() requirements',back:'Checkpointer + thread_id in config; resume with Command(resume=value) on the same thread; the node re-runs from the start, so pre-interrupt code must be idempotent.'},
    {front:'When does a workflow beat an agent?',back:'When the steps are known, the action is high-risk or regulated, the volume is high, or you need exact reproducibility and cheap testing.'},
    {front:'A2A Agent Card location and purpose',back:'https://{domain}/.well-known/agent-card.json — describes name, skills, supported interfaces, capabilities and security schemes so other agents can discover and call it.'},
    {front:'A2A v1.0 task states',back:'SUBMITTED, WORKING, INPUT_REQUIRED, AUTH_REQUIRED, COMPLETED, FAILED, CANCELED, REJECTED (prefixed TASK_STATE_, plus UNSPECIFIED).'},
    {front:'Token passthrough',back:'Forwarding a token received by an MCP server to another API. Forbidden by the MCP auth spec; use audience-bound tokens obtained for the downstream resource.'},
    {front:'Three cost levers unique to agents',back:'Step/iteration caps with loop detection, model routing per step (cheap model for routine steps), and caching stable prompt prefixes and tool results.'},
    {front:'OWASP ASI03',back:'Identity & Privilege Abuse — agents misusing inherited or delegated credentials, over-broad scopes, or privilege escalation across agents.'}
  ]
});
registerQuestions([
{
  id:'v3agt-01', chapter:'v3-ch-agents', difficulty:3,
  title:'How do you prevent an AI agent from deleting production resources?',
  understand:`The interviewer is checking whether you know that a model cannot be trusted to obey instructions, and that safety must come from layers the model cannot influence: identity, permissions, policy, approval and recovery. In simple terms: an agent is a program that lets a language model pick actions. If the program's credentials can delete something, then eventually, through a bug, a misread goal or an injected instruction, it will. The strong answer removes the ability, not just the intention.`,
  short:`I don't rely on the prompt at all. First, the agent's identity simply cannot delete: its default credentials are read-only, scoped to the namespaces or accounts it needs, and short-lived. Mutating tools are separate tools, disabled by default, and every call passes through a policy engine outside the model that denies destructive verbs on production outright. Anything that changes state runs as a dry-run or plan first, a human approves the exact plan by its hash, and only then does an executor with a just-in-time credential apply it. Underneath that I keep cloud guardrails such as deny policies and deletion protection, plus tested backups, so even a total failure of the upper layers is recoverable. And everything is audited and traced.`,
  detailed:`<p>The question is really about <b>defence in depth with the model outside the trust boundary</b>. I walk the layers from "cannot" to "can recover".</p>
<h5>1. Identity: make deletion impossible by default</h5>
<p>The agent runs as its own workload identity (an IAM role via IRSA or EKS Pod Identity, a Kubernetes ServiceAccount, a database role). That identity gets <b>read-only</b> permissions: <code>get</code>, <code>list</code>, <code>watch</code> in Kubernetes RBAC; Describe and List actions in AWS. There is no <code>delete</code> verb anywhere in its grants. Credentials are short-lived and scoped to the environments the task needs. If the agent is fully compromised, the blast radius is "read some metadata".</p>
<h5>2. Tool design: narrow, typed, separate</h5>
<p>Do not expose <code>kubectl</code> or a shell as a tool. Expose <code>scale_deployment(namespace, name, replicas)</code> with an input schema that bounds replicas, rejects production namespaces unless a flag is set, and has no delete path at all. Read tools and write tools are different tools so they can be enabled, approved and audited separately. In MCP, mark read tools with <code>readOnlyHint: true</code> — but remember that annotations are hints and clients must treat them as untrusted unless the server is trusted; they are UX, not enforcement.</p>
<h5>3. Policy outside the model</h5>
<p>Every proposed call goes through a policy decision point: OPA/Rego, Cedar, or a managed equivalent such as the Policy service in Amazon Bedrock AgentCore, which intercepts tool calls at its gateway. Rules are explicit: deny any verb in {delete, destroy, terminate, drop, truncate} against resources tagged <code>env=prod</code>; deny wildcards; deny more than N resources per call; require approval for any write in production. The model cannot rewrite this policy because it is not in the prompt.</p>
<h5>4. Plan, then approve the exact plan</h5>
<p>Mutations follow the Terraform pattern: the agent produces a plan (a diff or a list of API calls), the system computes a canonical hash, a human approves that hash in a separate channel, and the executor refuses anything whose hash differs. This defeats the "approved one thing, executed another" attack and stale approvals. Approvals expire.</p>
<h5>5. Just-in-time execution credentials</h5>
<p>Only the executor, after approval, obtains a write credential that is scoped to exactly the approved resources and expires in minutes. The planner never sees it.</p>
<h5>6. Platform guardrails the agent cannot change</h5>
<p>AWS Organizations SCPs or permission boundaries that deny deletes in prod accounts; RDS and EC2 deletion protection; S3 Object Lock or versioning; Kubernetes admission control (Kyverno/Gatekeeper) and finalizers; Argo CD with self-heal so out-of-band changes are reverted.</p>
<h5>7. Recover and observe</h5>
<p>Backups with restore drills, point-in-time recovery, and a full audit trail: who asked, what the model proposed, what policy decided, who approved, what ran. Traces use the OpenTelemetry GenAI conventions (<code>execute_tool</code> spans with <code>gen_ai.tool.name</code>; Development status as of Oct 2026). A kill switch disables all write tools at once.</p>
${table(['Layer','Stops','Owned by'],[['Read-only identity','Everything destructive by default','Platform / IAM'],['Typed narrow tools','Arbitrary commands, wildcards','Tool author'],['Policy engine','Destructive verbs, prod writes','Security'],['Plan hash + approval','Plan drift, stale approvals','Service owner'],['SCP, deletion protection','Failures of all the above','Cloud governance'],['Backups + audit','Irreversible loss, no forensics','SRE']])}
<p>This maps directly to OWASP LLM06 Excessive Agency (2025 list; LLM03 in the 2026 list) and Agentic ASI02 Tool Misuse and ASI03 Identity &amp; Privilege Abuse.</p>`,
  diagram:anim('v3q-agent-approval')+fig('Layers between an agent and a destructive action', svgDiagram({w:900,h:300,
    boxes:[
      {id:'a',x:20,y:120,w:110,h:56,label:'Agent',sub:'proposes',cls:'warn'},
      {id:'t',x:150,y:120,w:110,h:56,label:'Typed tool',sub:'no delete path'},
      {id:'p',x:280,y:120,w:110,h:56,label:'Policy',sub:'deny prod verbs',cls:'hl'},
      {id:'d',x:410,y:120,w:110,h:56,label:'Dry-run',sub:'plan + hash'},
      {id:'h',x:540,y:120,w:110,h:56,label:'Human',sub:'approves hash'},
      {id:'e',x:670,y:120,w:110,h:56,label:'Executor',sub:'JIT scoped cred',cls:'ok'},
      {id:'g',x:670,y:220,w:210,h:50,label:'SCP + deletion protection',sub:'last line'},
      {id:'r',x:800,y:120,w:80,h:56,label:'Prod',sub:'resources'}
    ],
    arrows:[{from:'a',to:'t'},{from:'t',to:'p'},{from:'p',to:'d',label:'allow'},{from:'d',to:'h'},{from:'h',to:'e',label:'same hash'},{from:'e',to:'r'},{from:'g',to:'r',cls:'dash'}],
    notes:[{x:20,y:40,text:'Each box can say no. The model controls none of them.'}]
  }), 'Read-only identity is the default; the write path exists only after policy, dry-run and approval, using a credential the planner never sees.'),
  followups:[
    {q:'The approver clicks approve without reading. How do you make approval meaningful?',a:'Show a human-readable diff with risk highlights (resource count, prod tags, irreversibility), require a typed confirmation for destructive scopes, route high-risk changes to two approvers, and measure approval latency and rejection rates — a 100 % approval rate in under five seconds is a signal of rubber-stamping.'},
    {q:'What if the agent needs to delete things legitimately, for example clean up stale preview environments?',a:'Make it a narrow tool with a deterministic selector (label <code>preview=true</code>, age over seven days, non-prod account), enforce the selector in the tool and in policy rather than accepting arbitrary names, cap the batch size, soft-delete first, and keep a recovery window.'},
    {q:'How do you stop prompt injection from a log line convincing the agent to call a write tool?',a:'Treat tool output as untrusted data; separate the planning context that reads untrusted content from the context that can invoke privileged tools (dual-LLM or CaMeL-style patterns); and rely on policy plus approval so that even a hijacked plan cannot execute without a human seeing the exact diff.'},
    {q:'Where does MCP fit, and does the 2026-07-28 spec change anything here?',a:'The destructive tool lives behind an MCP server that is an OAuth resource server; scopes and per-tool authorization decide what a token may call. In 2026-07-28 the server is stateless and approval can come back through MRTR (InputRequiredResult with an elicitation), but the security model is unchanged: enforcement stays in the server and policy, not in the client or model.'}
  ],
  tradeoffs:`<p><b>Safety versus autonomy.</b> Every approval adds minutes of latency and human cost. Use risk tiers: read-only tools run freely; low-risk reversible writes in non-prod run with policy only; production writes need approval; irreversible actions need two approvers or are not offered as tools at all.</p>
<p><b>Generic tools versus narrow tools.</b> A generic <code>run_kubectl</code> tool is quick to build and very hard to secure because policy must parse free text. Narrow typed tools take longer to write but make policy, audit and evaluation tractable.</p>
<p><b>Central policy versus per-tool checks.</b> A central policy engine gives consistent rules and one audit log; per-tool checks catch domain-specific invariants. Do both: tools validate their own invariants, policy enforces organisation rules.</p>
<p><b>Operational considerations:</b> policy changes go through code review and CI like infrastructure code; approval services need their own SLO; the kill switch must be tested regularly.</p>`,
  failures:`<ul>
<li><b>Over-broad role reused from a CI pipeline.</b> Symptom: agent successfully deletes a resource "it should not have". Evidence: CloudTrail shows the agent role has <code>*</code> on the service. Fix: dedicated least-privilege role, permission boundary, access analyzer review.</li>
<li><b>Plan drift after approval.</b> Symptom: executed changes differ from the approved diff because the agent re-planned after a retry. Evidence: plan hash in audit log differs from approval record. Fix: executor verifies hash, approvals are single-use and expire.</li>
<li><b>Retry duplicates a side effect.</b> Symptom: two scale-downs or two tickets after a timeout. Fix: idempotency keys per action, check-then-act with resource versions.</li>
<li><b>Approval service down.</b> Symptom: agents queue writes indefinitely. Fix: fail closed (no write), alert, and time out pending approvals with a clear "not executed" result to the user.</li>
<li><b>Backups untested.</b> The last layer fails silently. Fix: scheduled restore drills with measured RTO.</li>
</ul>`,
  vocab:[
    {term:'Excessive agency',def:'OWASP LLM risk where an LLM system has more functionality, permissions or autonomy than its task needs (LLM06 in 2025, LLM03 in 2026).'},
    {term:'Plan hash',def:'A canonical digest of the exact actions and arguments to be executed; approval is bound to it.'},
    {term:'Just-in-time credential',def:'A short-lived credential issued only after approval and scoped to the approved resources.'},
    {term:'Policy decision point',def:'A component (OPA, Cedar engine) that evaluates a request against rules and returns allow/deny, independent of the caller.'},
    {term:'Service control policy',def:'An AWS Organizations guardrail that sets maximum permissions for accounts; it can deny actions regardless of IAM grants.'},
    {term:'Kill switch',def:'A single control that disables all mutating tools across agents immediately.'}
  ],
  mistakes:[
    'Saying the system prompt or a "safety instruction" prevents deletion — prompts are not access control and prompt injection bypasses them.',
    'Relying on MCP tool annotations such as destructiveHint as enforcement — the spec says clients must treat them as untrusted hints.',
    'Giving the agent an admin role "for now" and planning to tighten later — blast radius equals current permissions.',
    'Approval of a natural-language summary rather than the exact executable plan — the action can differ from the description.',
    'Forgetting recovery: without tested backups and deletion protection, one failure of the upper layers is permanent.'
  ],
  related:['v2-agents','v2-mcp-security','v2-governance','v2-mcp-capstone']
},
{
  id:'v3agt-02', chapter:'v3-ch-agents', difficulty:3,
  title:'How would you design MCP for a multi-tenant enterprise?',
  understand:`The interviewer wants to see whether you can turn a protocol into a safe shared platform: many business units or customers using the same MCP servers without seeing each other's data, exhausting each other's capacity, or escalating privileges. Simply: multi-tenancy means one system, many isolated customers. In MCP the hard parts are where tenant identity comes from, which tools each tenant sees, how data and caches are separated, and how usage is metered and audited.`,
  short:`I start with identity: the tenant comes from verified token claims, never from a tool argument the model can fill in. Every remote MCP server is an OAuth resource server that validates audience and tenant on every request. Tool lists can vary by authorization, so a tenant only sees the tools its scopes allow. Data access goes through tenant-scoped credentials or row-level filters enforced in the server, and every cache key includes the tenant. In front I put an MCP gateway or registry for discovery, quotas, rate limits and audit per tenant. I design for the stateless 2026-07-28 spec so servers scale horizontally, while still serving 2025-11-25 clients that use sessions, binding any session or state handle to the user and tenant. Isolation tiers range from shared pools to dedicated deployments for regulated tenants.`,
  detailed:`<p>I decompose the design into identity, discovery, authorization, data isolation, resource isolation, state, and audit. I also say which MCP spec era each part assumes.</p>
<h5>Identity: tenant from claims</h5>
<p>Each remote MCP server is an OAuth 2.1 resource server. It publishes RFC 9728 Protected Resource Metadata, the client discovers the authorization server, and the access token carries the user and the tenant (an <code>org</code> or <code>tenant</code> claim, or a per-tenant issuer). The server validates the audience (RFC 8707 resource indicator — the token must be issued for <i>this</i> server) and the issuer. The tenant used for every data access is the one from the token. If a tool has a <code>tenant_id</code> parameter at all, the server checks it equals the claim; the model never decides the tenant.</p>
<h5>Discovery: per-tenant tool catalogues</h5>
<p>Enterprises run an internal registry (the official MCP Registry is still preview as of Oct 2026 and is for public servers) listing approved servers, owners, data classification and required scopes. The spec allows <code>tools/list</code> to vary by authorization (in 2026-07-28 it must not vary per connection, but may vary by authorization). So tenant A with scope <code>bookings.read</code> sees <code>get_booking</code>; tenant B without it does not.</p>
<h5>Authorization: per tool, per resource</h5>
<p>Scopes gate tools; an internal policy engine gates resources (this booking belongs to this tenant). Insufficient scope returns 403 with <code>WWW-Authenticate: Bearer error="insufficient_scope"</code> so clients can step up. When the server calls downstream APIs it obtains its own audience-bound token (token exchange or a service credential plus user context) — passing through the received token is forbidden by the spec.</p>
<h5>Data isolation</h5>
<p>Choose per data store: separate database or schema per tenant for regulated tenants; row-level security keyed on the tenant claim for shared stores; per-tenant encryption keys where required. Vector indexes and RAG resources need tenant filters applied in the server, not by the model. <b>Cache keys</b> (tool-result caches, the 2026-07-28 <code>ttlMs</code>/<code>cacheScope</code> hints, embedding caches) must include tenant and, where results depend on user permissions, user.</p>
<h5>Resource isolation</h5>
<p>Per-tenant quotas and rate limits at an MCP-aware gateway (for example Agent Router, formerly Envoy AI Gateway, which has an <code>MCPRoute</code> CRD); per-tenant concurrency limits on expensive tools; separate node pools or deployments for noisy or premium tenants.</p>
<h5>State, by era</h5>
<p><b>2025-11-25:</b> sessions via <code>Mcp-Session-Id</code>; the spec says never use sessions for authentication and bind session IDs to the user (<code>&lt;user_id&gt;:&lt;session_id&gt;</code>). Horizontal scale needs sticky routing or a shared session store. <b>2026-07-28:</b> no sessions; cross-call state uses server-minted handles passed as arguments, and the spec's State Handle Hijacking guidance says possession of a handle is not authentication — key state as <code>&lt;user_id&gt;:&lt;handle&gt;</code> (I add the tenant). Stateless servers scale with an ordinary HPA.</p>
<h5>Audit and chargeback</h5>
<p>Every call is logged with tenant, user, client ID, tool, arguments hash, decision and latency; traces carry <code>traceparent</code> (in 2026-07-28 it can travel in <code>_meta</code>). Usage feeds per-tenant showback.</p>
${table(['Isolation tier','What is shared','Use for'],[['Pooled','Servers, DB with RLS, caches keyed by tenant','Internal teams, low sensitivity'],['Bridged','Servers shared; per-tenant DB/schema and keys','Most business units'],['Siloed','Dedicated deployment, AS, network','Regulated data, residency (e.g. PDPL)']])}`,
  diagram:fig('Multi-tenant MCP platform', svgDiagram({w:900,h:340,
    zones:[{x:330,y:20,w:550,h:300,label:'Platform (trusted)',cls:'ok'}],
    boxes:[
      {id:'ca',x:20,y:60,w:140,h:50,label:'Host: tenant A',sub:'agent / IDE'},
      {id:'cb',x:20,y:200,w:140,h:50,label:'Host: tenant B',sub:'agent / IDE'},
      {id:'as',x:180,y:130,w:130,h:56,label:'Auth server',sub:'tenant claim'},
      {id:'gw',x:350,y:130,w:130,h:56,label:'MCP gateway',sub:'quota, audit',cls:'hl'},
      {id:'reg',x:350,y:250,w:130,h:50,label:'Registry',sub:'approved servers'},
      {id:'s1',x:520,y:60,w:150,h:56,label:'Bookings MCP',sub:'validates aud+tenant'},
      {id:'s2',x:520,y:200,w:150,h:56,label:'Ops MCP',sub:'per-tool scopes'},
      {id:'dbA',x:720,y:40,w:140,h:46,label:'DB tenant A',cls:'v1'},
      {id:'dbB',x:720,y:100,w:140,h:46,label:'DB tenant B',cls:'v2'},
      {id:'pol',x:720,y:210,w:140,h:50,label:'Policy engine',sub:'resource checks'}
    ],
    arrows:[{from:'ca',to:'as',label:'OAuth',cls:'dash'},{from:'ca',to:'gw'},{from:'cb',to:'gw'},{from:'gw',to:'s1'},{from:'gw',to:'s2'},{from:'s1',to:'dbA'},{from:'s1',to:'dbB'},{from:'s2',to:'pol'},{from:'reg',to:'gw',cls:'dash'}]
  }), 'Tenant identity enters only via the token. Gateway enforces quotas and audit; each server validates audience and tenant and reaches tenant-scoped data.'),
  followups:[
    {q:'A tool returns cached results. How can tenants leak through the cache?',a:'If the key is the tool name plus arguments, tenant B asking the same question gets tenant A’s result. Include tenant and, for permission-dependent results, user or permission-set hash in the key; mark caches with the right scope; test with a cross-tenant canary.'},
    {q:'Should each tenant have its own authorization server?',a:'Usually one enterprise IdP with tenant claims is simpler; per-tenant issuers make sense for external customers bringing their own IdP. In that case servers keep an allow-list of issuers per tenant and validate iss (RFC 9207 iss validation is added in 2026-07-28).'},
    {q:'How do you onboard a new internal team’s MCP server onto the platform?',a:'A paved road: template repo with the SDK, auth middleware and telemetry; registry entry with owner, data class and scopes; security review of tool descriptions (tool poisoning) and annotations; staging with contract tests; then gateway route and quotas.'},
    {q:'Your clients are still on 2025-11-25 and your servers are 2026-07-28. What breaks?',a:'Dual-era SDKs handle it: the Python SDK serves both revisions and the TS v2 handler defaults to serving legacy clients statelessly. Server-initiated sampling or elicitation is unavailable on 2026 connections; use MRTR, which the SDKs map back for legacy clients where supported. Test both eras in CI.'}
  ],
  tradeoffs:`<p><b>Pooled vs siloed.</b> Pooled maximises utilisation and simplifies upgrades but makes isolation a software property you must test continuously. Siloed is strong and easy to explain to auditors but multiplies cost and operations. Most platforms offer tiers.</p>
<p><b>Central gateway vs direct connections.</b> A gateway gives uniform quotas, audit and allow-lists, at the cost of one more hop and a component that must be highly available. Direct connections are simpler for a handful of servers but lose central control.</p>
<p><b>Coarse scopes vs fine-grained policy.</b> Scopes are cheap and visible in consent screens; fine-grained resource policy is needed for "this booking belongs to this tenant". Use both; never try to encode every resource in scopes.</p>
<p><b>Operational:</b> per-tenant SLOs and dashboards, tenant-aware error budgets, and a documented offboarding path that deletes caches, indexes and logs.</p>`,
  failures:`<ul>
<li><b>Tenant from argument.</b> Symptom: a prompt-injected document makes the agent call <code>get_booking(tenant="other")</code> and it works. Fix: tenant derived from token; argument ignored or checked.</li>
<li><b>Noisy neighbour.</b> Symptom: one tenant's agent loops on an expensive search tool; others time out. Evidence: per-tenant request rate spike. Fix: per-tenant concurrency and rate limits, tool-level timeouts, budget alerts.</li>
<li><b>Session confusion (2025-11-25).</b> Symptom: 404 on session after scaling out, clients re-initialise in a storm. Fix: sticky routing or shared session store, or move to stateless mode.</li>
<li><b>Token passthrough.</b> Symptom: downstream API accepts tokens not issued for it; audit cannot tell who acted. Fix: token exchange with audience binding.</li>
<li><b>Stale tool catalogue.</b> Tenant loses scope but client cached the tool list. Fix: re-check authorization on every call, honour <code>ttlMs</code>, send list-changed notifications.</li>
</ul>`,
  vocab:[
    {term:'Resource indicator',def:'RFC 8707 parameter naming the MCP server the token is for; servers must validate tokens were issued for them.'},
    {term:'Protected Resource Metadata',def:'RFC 9728 document an MCP server publishes so clients can discover its authorization server.'},
    {term:'Row-level security',def:'Database feature that filters rows per session attribute such as tenant, enforced by the database rather than the application.'},
    {term:'Isolation tier',def:'Pooled, bridged or siloed: how much infrastructure tenants share.'},
    {term:'State handle',def:'2026-07-28 MCP pattern: server-minted identifier for cross-call state passed as a tool argument; not an authentication token.'},
    {term:'Noisy neighbour',def:'A tenant whose load degrades other tenants on shared capacity.'}
  ],
  mistakes:[
    'Putting tenant_id in the system prompt or as a model-filled argument and trusting it.',
    'Assuming MCP sessions (2025-11-25) authenticate the user — the spec forbids using sessions for authentication.',
    'Caching tool results without tenant in the key.',
    'Forwarding the user’s token to downstream APIs (token passthrough) instead of obtaining an audience-bound token.',
    'Describing only one spec era: the platform must say whether it serves 2025-11-25 clients, 2026-07-28 clients, or both.'
  ],
  related:['v2-mcp-auth','v2-mcp-deploy','v2-mcp-security','v2-cache-ops','v2-platform-architecture']
},
{
  id:'v3agt-03', chapter:'v3-ch-agents', difficulty:2,
  title:'What agent architectures do you know, and when would you use each?',
  understand:`The interviewer wants to know whether you can match the control structure to the problem, rather than reach for the most fashionable pattern. Simply: an agent architecture is the shape of the loop that decides who plans, who acts and who checks. The main shapes are a single tool-calling loop (often called ReAct), plan-and-execute, an explicit workflow graph, and a supervisor coordinating several specialised agents.`,
  short:`I think of four shapes. A single tool-calling loop, the ReAct style, where the model reasons, calls a tool, observes and repeats until done; it's flexible and good for short open-ended tasks with a handful of tools. Plan-and-execute, where one call makes an explicit plan and an executor works through it; it's easier to review and approve and cheaper because a smaller model can execute. A workflow or graph, where I define the nodes and edges in code, as in LangGraph, and the model decides only at certain branches; that's my default for production because it's testable and resumable. And a supervisor with specialised sub-agents, useful when contexts or permissions really must be separated. I pick the least autonomous shape that solves the task, because each step up adds cost, latency and failure modes.`,
  detailed:`<p>The decision variable is <b>how much of the control flow you let the model choose</b>. Less model control means more predictability and cheaper testing; more model control handles more variation.</p>
<h5>1. Single tool-calling loop (ReAct style)</h5>
<p>The model receives a goal and tool definitions, emits a tool call, the runtime executes it, appends the result, and loops until the model returns a final answer or a step cap is hit. Every provider's native tool calling supports this. <b>Good for:</b> short tasks, few tools (under roughly 10–20 before tool selection degrades — a heuristic, measure it), exploratory questions such as "why is this pod crashing?". <b>Risks:</b> unbounded loops, context growth (every observation is re-sent, so input tokens grow roughly quadratically with steps unless you summarise or cache), and injection through observations.</p>
<h5>2. Plan-and-execute</h5>
<p>A planner produces a structured plan (list of steps with tools and arguments). An executor carries out steps, possibly with a cheaper model or no model at all; a re-planner revises only on failure. <b>Good for:</b> tasks that need approval (the plan is the artefact a human approves), long tasks where re-reading the whole history every step is expensive. <b>Risks:</b> plans go stale when the world changes mid-execution; re-planning must be bounded.</p>
<h5>3. Workflow / state graph</h5>
<p>Nodes are functions (some call a model), edges are explicit, and conditional edges let the model choose among a few branches. State is checkpointed, so runs can pause for humans and resume. LangGraph (1.2.x, Production/Stable as of Oct 2026) and Microsoft Agent Framework workflows are examples; Temporal or Step Functions with model steps work too. <b>Good for:</b> production processes such as refund handling, incident triage, document processing. <b>Risks:</b> less flexible; graph design takes effort.</p>
<h5>4. Supervisor / multi-agent</h5>
<p>A supervisor routes sub-tasks to specialised agents, each with its own prompt, tools and possibly identity; results are merged. Agents may be in-process or remote via A2A. <b>Good for:</b> separating permissions (a read-only researcher and a write-capable executor), separating large contexts, or crossing organisational boundaries. <b>Risks:</b> cost multiplies, errors cascade (OWASP ASI08), inter-agent messages become an injection path (ASI07), and debugging needs distributed traces.</p>
${table(['Shape','Model controls','Testability','Typical cost'],[['Workflow graph','Branch choices only','High (unit-test nodes)','Low'],['Plan-and-execute','The plan','Medium (review plan)','Low–medium'],['Single loop','Every step','Low–medium','Medium, grows with steps'],['Supervisor + agents','Routing and steps','Low','High']])}
<p>A useful worked view of loop cost (ILLUSTRATIVE numbers):</p>
${formula(`Single loop, 2,000-token system+tools prefix,
each step adds 500 tokens of observation

STEP 1  input at step k  = 2,000 + 500·(k − 1)
STEP 2  total input, n steps = 2,000·n + 500·n(n − 1)/2
STEP 3  n = 10 → 20,000 + 22,500 = 42,500 input tokens
STEP 4  n = 20 → 40,000 + 95,000 = 135,000 input tokens
ANSWER  doubling steps ≈ 3.2× input tokens
        ↑ why step caps, summarisation and prefix caching matter`)}`,
  diagram:fig('Four agent shapes by autonomy', svgDiagram({w:900,h:300,
    boxes:[
      {id:'w',x:20,y:110,w:180,h:70,label:'Workflow graph',sub:'code decides; model branches',cls:'ok'},
      {id:'p',x:240,y:110,w:180,h:70,label:'Plan-and-execute',sub:'model plans once'},
      {id:'r',x:460,y:110,w:180,h:70,label:'Single loop (ReAct)',sub:'model picks each step',cls:'warn'},
      {id:'s',x:680,y:110,w:200,h:70,label:'Supervisor + agents',sub:'model routes agents',cls:'bad'}
    ],
    arrows:[{from:'w',to:'p'},{from:'p',to:'r'},{from:'r',to:'s'}],
    notes:[{x:20,y:60,text:'More autonomy → more flexibility, but more cost, latency and failure modes'},{x:20,y:240,text:'Default: the leftmost shape that solves the task'}]
  }), 'Move right only when the task genuinely needs the extra flexibility.'),
  followups:[
    {q:'Why does tool-selection accuracy fall as you add tools, and what do you do about it?',a:'Tool definitions compete for attention and consume context; similar names cause confusion. Group tools by domain, retrieve a relevant subset per request (deferred loading exists in several provider APIs), use precise names and descriptions, and measure tool-call accuracy on an eval set as the catalogue grows.'},
    {q:'How do you make a single-loop agent terminate reliably?',a:'Hard step and token caps, a progress check (same tool with same arguments twice → stop), an explicit finish tool with a schema, wall-clock timeout, and returning a partial result with a reason instead of looping silently.'},
    {q:'When is multi-agent actually justified?',a:'When permissions must differ (planner cannot write, executor cannot read untrusted web content), when contexts are too large to share, when teams own different agents, or when parallelism shortens wall-clock time enough to pay for the extra tokens. Not because "specialists sound better".'},
    {q:'How would you migrate a working ReAct prototype to production?',a:'Mine its traces for the common paths, turn those into explicit graph nodes, keep a bounded model-driven branch for the long tail, add checkpoints and approvals at side-effect nodes, and gate the switch on an eval suite comparing success rate and cost.'}
  ],
  tradeoffs:`<p><b>Flexibility vs predictability:</b> loops handle novel situations; graphs are reproducible and auditable. Regulated or destructive processes favour graphs.</p>
<p><b>Latency:</b> plan-and-execute can parallelise independent steps; single loops are sequential. Multi-agent can parallelise but adds coordination overhead.</p>
<p><b>Cost:</b> loops re-send growing history; plan-and-execute lets a cheap model or plain code execute; supervisors multiply calls.</p>
<p><b>Operational considerations:</b> whatever the shape, require checkpointing for anything over a few seconds, idempotent tools, and traces with <code>invoke_agent</code> and <code>execute_tool</code> spans so you can see which shape is costing what.</p>`,
  failures:`<ul>
<li><b>Infinite loop.</b> Symptom: rising token spend per task, same tool repeated. Evidence: <code>gen_ai.invoke_agent.tool_calls</code> histogram tail. Fix: caps and repeated-action detection.</li>
<li><b>Stale plan.</b> Symptom: executor fails on step 4 because step 2 changed state. Fix: preconditions per step, bounded re-planning.</li>
<li><b>Supervisor ping-pong.</b> Symptom: two agents hand the task back and forth. Fix: hop limit, explicit ownership per sub-task.</li>
<li><b>Context overflow.</b> Symptom: errors or degraded answers after many steps. Fix: summarise observations, store large results as references (resource links), not inline.</li>
</ul>`,
  vocab:[
    {term:'ReAct',def:'Pattern where the model interleaves reasoning and tool actions in a loop, observing results between steps.'},
    {term:'Plan-and-execute',def:'Architecture separating an up-front planning call from step execution, with re-planning on failure.'},
    {term:'State graph',def:'Workflow defined as nodes and edges with persisted state, allowing pause, resume and branching.'},
    {term:'Supervisor agent',def:'An agent that routes sub-tasks to other agents and aggregates results.'},
    {term:'Checkpointer',def:'Component that persists graph state after each step so a run can resume after interruption or failure.'}
  ],
  mistakes:[
    'Choosing multi-agent by default because it sounds advanced — it multiplies cost and failure modes.',
    'Ignoring context growth: assuming each loop step costs the same, when input tokens grow with history.',
    'Treating a framework name as an architecture ("we use LangChain") without describing the control flow.',
    'No termination strategy beyond "the model will say it is done".'
  ],
  related:['v2-agents','v2-a2a-multiagent','v1-ai-apps-tools']
},
{
  id:'v3agt-04', chapter:'v3-ch-agents', difficulty:2,
  title:'When would you choose deterministic automation over an AI agent?',
  understand:`The interviewer is testing judgement and honesty: do you push AI everywhere, or do you know where scripts, runbooks and workflows are better? Simply: deterministic automation does the same thing every time for the same input; an agent decides at runtime. The question is which tasks benefit from that runtime decision and which only gain risk and cost.`,
  short:`I use deterministic automation whenever the steps are known in advance, the action is high-risk or regulated, the volume is high, or I need exact reproducibility and audit. Restarting a crash-looping pod after a known signature, rotating certificates, or scaling on a metric are workflows, not agent tasks. I reach for an agent when the input is unstructured and the path genuinely varies, for example triaging a novel incident across logs, metrics and recent deploys, or answering open questions over many tools. Even then I usually embed the model inside a workflow: the model classifies or drafts, and deterministic code executes. A quick test is: if I could write the runbook as a flowchart, I automate the flowchart.`,
  detailed:`<p>The decision is about <b>variance, risk, volume and verifiability</b>. I use a simple scoring approach in design reviews.</p>
${table(['Factor','Favours deterministic','Favours agent'],[['Path variability','Known steps, finite branches','Open-ended, many possible paths'],['Input type','Structured events, metrics','Unstructured text, mixed evidence'],['Risk of action','Destructive, financial, regulated','Read-only or easily reversible'],['Volume','Thousands per hour','Tens to hundreds per day'],['Latency need','Milliseconds to seconds','Seconds to minutes acceptable'],['Correctness check','Must be exact and auditable','Human reviews output anyway'],['Cost per run','Fractions of a cent','Cents to dollars acceptable']])}
<h5>Why deterministic wins more often than people expect</h5>
<ul>
<li><b>Testability.</b> A script can be unit-tested and gives the same output each time. An agent's output is a distribution; you need eval suites and statistical gates.</li>
<li><b>Cost and latency.</b> A Lambda or Argo Workflow step costs almost nothing and runs in milliseconds. A ten-step agent loop costs tokens on every step and takes seconds to minutes.</li>
<li><b>Audit.</b> Regulators and change-management boards understand a reviewed runbook. "The model decided" is a weak audit answer.</li>
<li><b>Failure semantics.</b> Scripts fail loudly in known ways. Agents can fail plausibly — a confident wrong action.</li>
</ul>
<h5>Where agents earn their place</h5>
<ul>
<li>Investigations that require choosing what to look at next (an AIOps assistant correlating alerts, deploy history and logs — HolmesGPT and K8sGPT are open-source examples in CNCF Sandbox as of Oct 2026).</li>
<li>Natural-language front doors to many tools ("show me last week's failed bookings in Riyadh and the related errors").</li>
<li>Drafting artefacts that a human then reviews: incident summaries, pull requests, policy explanations.</li>
</ul>
<h5>The hybrid pattern (my default)</h5>
<p>Deterministic skeleton, model at the decision points. For example, an alert-triage workflow: deterministic enrichment (fetch deploys, pod events, dashboards) → model classifies likely cause and drafts a summary → deterministic routing to the owning team → if the classification matches a known remediation with a runbook, a deterministic remediation runs behind approval. The model never executes anything directly.</p>
<p>A cost comparison (ILLUSTRATIVE): a triage agent using 40,000 input and 2,000 output tokens per incident on a mid-tier model at $2 per million input and $10 per million output (Claude Sonnet 5.5 list price, as of Oct 2026) costs 40,000 × 2 / 10⁶ + 2,000 × 10 / 10⁶ = $0.08 + $0.02 = $0.10 per incident — trivial at 200 incidents a day, but the same pattern on 2 million booking events a day would be $200,000 a day, where a rules engine costs almost nothing.</p>`,
  diagram:fig('Hybrid: deterministic skeleton, model at decision points', svgDiagram({w:900,h:260,
    boxes:[
      {id:'a',x:20,y:100,w:120,h:56,label:'Alert',sub:'structured'},
      {id:'e',x:160,y:100,w:130,h:56,label:'Enrich',sub:'deterministic',cls:'ok'},
      {id:'m',x:310,y:100,w:130,h:56,label:'Classify + draft',sub:'LLM',cls:'warn'},
      {id:'r',x:460,y:100,w:130,h:56,label:'Route to owner',sub:'deterministic',cls:'ok'},
      {id:'h',x:610,y:100,w:120,h:56,label:'Approve',sub:'human'},
      {id:'x',x:750,y:100,w:130,h:56,label:'Runbook action',sub:'deterministic',cls:'ok'}
    ],
    arrows:[{from:'a',to:'e'},{from:'e',to:'m'},{from:'m',to:'r'},{from:'r',to:'h'},{from:'h',to:'x'}]
  }), 'The model interprets; code acts. Only the yellow step is probabilistic.'),
  followups:[
    {q:'Your VP wants "an agent that auto-remediates all incidents". How do you respond?',a:'Agree on the goal (lower MTTR), then propose a staged path: read-only triage agent first, measured on classification accuracy against post-incident reviews; then auto-remediation only for the top known signatures using deterministic runbooks behind approval; expand as precision is proven.'},
    {q:'How do you decide when an agent-assisted task is mature enough to become deterministic?',a:'Mine traces: when 80–90 % of runs follow the same few paths with the same tools, codify those paths, keep the agent for the remainder, and compare success rate and cost before and after.'},
    {q:'Is a rules engine plus an LLM fallback a good pattern?',a:'Often yes: rules handle the high-volume known cases cheaply, the model handles the long tail, and you log the fallback cases to grow the rules. Watch for the model fallback becoming the main path silently — alert on fallback rate.'}
  ],
  tradeoffs:`<p><b>Build effort:</b> agents are faster to prototype; deterministic workflows are faster to operate and certify. <b>Maintenance:</b> rules drift as systems change; agents adapt but regress silently when models change — both need tests. <b>Coverage:</b> rules miss the long tail; agents cover it with lower precision.</p>
<p><b>Operational considerations:</b> version prompts and model IDs like code, pin models in production, and re-run evals on every model upgrade, because an agent's behaviour can change without any code change.</p>`,
  failures:`<ul>
<li><b>Agent used for a high-volume path.</b> Symptom: token bill grows linearly with traffic; latency SLO missed. Fix: move the common path to rules.</li>
<li><b>Model upgrade changes behaviour.</b> Symptom: classification distribution shifts overnight. Fix: pinned model versions, canary with eval gate.</li>
<li><b>Rule rot.</b> Symptom: deterministic remediation fires for a signature that now means something else. Fix: rules owned and reviewed, with alerting on unexpected outcomes.</li>
</ul>`,
  vocab:[
    {term:'Deterministic workflow',def:'Automation whose steps and outputs are fixed for a given input, e.g. a runbook script or Argo Workflow.'},
    {term:'Hybrid automation',def:'A deterministic workflow with model calls only at interpretation or drafting points.'},
    {term:'Fallback rate',def:'Share of cases where rules defer to a model; a key health metric for hybrid systems.'},
    {term:'MTTR',def:'Mean time to restore service after an incident.'}
  ],
  mistakes:[
    'Saying agents are always better because they are adaptive — adaptivity is a cost when the path is known.',
    'Saying never use agents in operations — read-only investigation is a strong use case.',
    'Ignoring per-run token cost at production volume.',
    'Letting the model execute remediation directly instead of selecting a reviewed runbook.'
  ],
  related:['v2-agents','v2-aiops','v3-ch-aiops']
}
]);
registerQuestions([
{
  id:'v3agt-05', chapter:'v3-ch-agents', difficulty:2,
  title:'How do you design human-in-the-loop for an agent?',
  understand:`The interviewer checks whether you can make a pause-for-approval actually work in a distributed system: state survives the pause, the approver sees exactly what will happen, the approval cannot be reused for something else, and nothing runs twice when the agent resumes. Simple explanation: the agent stops before a risky step, saves where it was, asks a person, and continues only with the exact action that person approved.`,
  short:`I decide first which actions need a human, by risk tier, not by asking for everything, because people rubber-stamp a flood of prompts. For those actions the agent produces a concrete plan, the system pauses and persists its state, and the approver sees the exact tool, arguments, target resources and expected impact. The approval is bound to a hash of that plan, expires, and is recorded with the approver's identity. On approval the run resumes from the saved checkpoint; on rejection or timeout it takes a safe default. Mechanically, in LangGraph that is interrupt() with a checkpointer and a thread id, resumed with Command(resume=...), and because the node re-runs from the start on resume, any side effects before the interrupt must be idempotent. In MCP, a server can ask the user through elicitation; in the 2026-07-28 spec that comes back as an input_required result the client answers on retry.`,
  detailed:`
<h5>1. Decide where humans add value</h5>
${table(['Tier','Examples (Atlas)','Control'],[
  ['Read-only, low sensitivity','search bookings, read runbook','No approval; audit only'],
  ['Reversible write, bounded','scale staging deployment within limits, draft a reply','Auto-approve within policy; notify'],
  ['Customer-visible or money','send refund up to 500 SAR, email a customer','Approval by the requesting user'],
  ['Production change, irreversible','delete resources, change IAM, refunds above limit','Approval by a second, qualified person; change window']
])}
<p>Approval fatigue is the main failure mode: if 95% of prompts are trivial, approvers click "yes" without reading. Keep approvals rare and meaningful.</p>
<h5>2. Make the pause durable</h5>
<p>Approvals take minutes to hours; pods restart in between. The agent's state must live in a durable store, not in memory. LangGraph (1.2.x as of Oct 2026) implements this with <code>interrupt()</code>: the node pauses, the state is checkpointed, the value appears in <code>result["__interrupt__"]</code>; it <b>requires a checkpointer</b> (for example a Postgres-backed one in production; <code>InMemorySaver</code> is only for tests) and a <code>thread_id</code> in the config. Resume with <code>Command(resume=value)</code> on the same <code>thread_id</code>. Important detail: <b>the node's code before <code>interrupt()</code> runs again on resume</b>, so anything there must be idempotent.</p>
${code('python',`from langgraph.types import interrupt, Command

def refund_node(state):
    plan = build_refund_plan(state)            # pure, safe to re-run
    decision = interrupt({"plan": plan, "plan_hash": sha256(plan)})
    if decision["approved"] and decision["plan_hash"] == sha256(plan):
        return {"result": execute_refund(plan, idempotency_key=plan["id"])}
    return {"result": "rejected"}

# graph compiled with a durable checkpointer; config={"configurable": {"thread_id": ticket_id}}
# resume later: graph.invoke(Command(resume={"approved": True, "plan_hash": h}), config)`)}
<h5>3. Bind the approval to the action</h5>
<p>The approver approves a canonical plan (tool, arguments, resources, expected diff), not a sentence. Store the hash; the executor refuses anything else. Add expiry (for example 30 minutes), the approver's identity, and separation of duties for high tiers (the requester cannot approve their own production change).</p>
<h5>4. Channels</h5>
<ul>
<li><b>In the host UI</b>: the host shows the tool call and asks the user. Good for user-level actions; the server cannot verify it happened.</li>
<li><b>MCP elicitation</b>: the server asks the user for input. Form mode for simple confirmations; URL mode for anything sensitive (the spec forbids collecting secrets in form mode). In 2025-11-25 it is a server-initiated <code>elicitation/create</code>; in 2026-07-28 it is an <code>InputRequiredResult</code> and the client retries with <code>inputResponses</code>.</li>
<li><b>Out of band</b>: Slack/Teams approval, ITSM change ticket, or a web page; the server polls or receives a callback. Best for second-person approvals and auditable change management.</li>
</ul>
<h5>5. What the approver sees</h5>
<p>Exact resources and environment, before/after diff, blast radius (count of affected objects), rollback plan, why the agent proposes it (evidence links), and who asked. If the approver needs to read the agent's reasoning to understand the action, the plan is not concrete enough.</p>`,
  diagram:fig('Durable approval loop', svgDiagram({w:900,h:300,
    boxes:[
      {id:'a',x:20,y:120,w:140,h:56,label:'Agent step',sub:'builds plan'},
      {id:'c',x:200,y:40,w:160,h:50,label:'Checkpoint',sub:'thread_id state'},
      {id:'i',x:200,y:150,w:160,h:56,label:'interrupt()',sub:'plan + hash',cls:'warn'},
      {id:'h',x:420,y:150,w:170,h:56,label:'Approver',sub:'sees exact diff'},
      {id:'r',x:640,y:150,w:110,h:56,label:'Resume',sub:'same thread'},
      {id:'e',x:780,y:60,w:100,h:56,label:'Execute',sub:'idempotent',cls:'ok'},
      {id:'x',x:780,y:230,w:100,h:50,label:'Reject',sub:'safe default'}
    ],
    arrows:[{from:'a',to:'i'},{from:'i',to:'c',cls:'dash',label:'persist'},{from:'i',to:'h',label:'notify'},{from:'h',to:'r',label:'hash ok'},{from:'r',to:'e'},{from:'r',to:'x',cls:'dash'}]
  }), 'The pause is a persisted state, the approval is bound to a hash, and the resumed step must be safe to re-run.'),
  followups:[
    {q:'What happens if the approval arrives after the pod that started the run was replaced?',a:'Nothing breaks if state is in a durable checkpointer keyed by thread_id: any worker loads the thread and resumes. If state was in memory, the run is lost; that is why InMemorySaver is for tests only.'},
    {q:'The node calls an API before interrupt(). What goes wrong?',a:'On resume LangGraph re-runs the node from the beginning, so the API call happens twice. Move side effects after the interrupt or make them idempotent with a key.'},
    {q:'How do you stop approval fatigue?',a:'Tier actions, auto-approve bounded low-risk writes by policy, batch related approvals into one plan, measure approval rate and time-to-approve, and review any tool whose approvals are almost always yes or always no.'},
    {q:'Can the user approve their own production deletion?',a:'For high-risk tiers, no: separation of duties requires a second qualified approver, the same principle as change management for production.'}
  ],
  tradeoffs:`
<p><b>More approvals</b> lower risk per action but slow workflows and train people to click yes. <b>Policy auto-approval</b> scales but must be conservative and audited. <b>In-host approval</b> is fast and contextual but unverifiable by the server; <b>out-of-band</b> approval is auditable and supports two-person rules but adds latency and integration work.</p>
<p><b>Operational considerations:</b> monitor pending approvals, time-to-approve, expiry rate and rejection rate per tool; alert on runs stuck in interrupted state; include approver identity in audit logs; test resume after restarts in CI.</p>`,
  failures:`
<ul>
<li><b>Double execution on resume</b>: refund issued twice. Evidence: two refund ids for one ticket. Fix: idempotency keys; side effects only after the interrupt.</li>
<li><b>Approved one plan, executed another</b>: the agent re-planned after approval. Fix: executor checks the plan hash.</li>
<li><b>Orphaned runs</b>: approvals never answered; threads accumulate. Fix: expiry with a safe default and a notification.</li>
<li><b>Approver lacks context</b>: approves a deletion of "nodegroup-7" without knowing it is production. Fix: show environment, tags and blast radius in the request.</li>
</ul>`,
  vocab:[
    {term:'interrupt()',def:'LangGraph function that pauses a node, checkpoints state and surfaces a value for a human; resume with Command(resume=...).'},
    {term:'Checkpointer',def:'Durable store of agent graph state per thread_id, required for pausing and resuming.'},
    {term:'Plan hash',def:'Hash of a canonical action plan that an approval is bound to.'},
    {term:'Approval fatigue',def:'Approvers stop reading because they are asked too often.'},
    {term:'Separation of duties',def:'The requester of a high-risk change cannot approve it.'},
    {term:'Elicitation',def:'MCP mechanism for a server to request user input (form or URL mode).'}
  ],
  mistakes:[
    'Asking for approval on every tool call; it destroys the value of approvals.',
    'Keeping paused state in memory.',
    'Approving natural-language intents instead of exact plans.',
    'Ignoring that resumed nodes re-run code before the interrupt.'
  ],
  related:['v2-agents','v2-mcp-security']
},
{
  id:'v3agt-06', chapter:'v3-ch-agents', difficulty:2,
  title:'How do you evaluate an AI agent?',
  understand:`They want to know whether you can measure an agent the way you would test a distributed system: realistic tasks, deterministic checks where possible, and metrics for success, safety, cost and latency, run on every change. Simple explanation: give the agent a fixed set of realistic tasks in a sandbox, check whether it reached the right end state with the right tool calls and without breaking rules, and track how much it cost.`,
  short:`I evaluate outcomes first, then the path. I build a task suite from real tickets: each task has a starting environment, a goal, and a checker that verifies the end state, ideally deterministically, such as "the booking has a refund request for the right amount and nothing else changed". I run the agent in a sandbox with mocked or replayed tools, several times per task, because agents are non-deterministic, and report success rate with a confidence interval. Then trajectory metrics: right tools, valid arguments, number of steps, policy violations, approvals requested when they should be. Then cost and latency per successful task. LLM-as-judge helps for open-ended outputs like a customer reply, but I calibrate it against human labels and never use it for safety-critical checks alone. The suite runs in CI on every prompt, model or tool change, with adversarial tasks for injection, and online I watch task success and escalation rates.`,
  detailed:`
<h5>Layers of agent evaluation</h5>
${table(['Layer','What you measure','How'],[
  ['Task outcome','Did the end state match the goal?','Deterministic checker on sandbox state (DB rows, API calls made)'],
  ['Trajectory','Right tools, valid args, steps, loops, unnecessary calls','Compare tool-call log with expected or allowed sequences'],
  ['Safety','Policy violations, missing approvals, data leaks, injection success','Adversarial tasks, canary secrets, policy-engine logs'],
  ['Quality of text','Helpfulness, tone, faithfulness of the customer reply','Rubric graded by humans and a calibrated LLM judge'],
  ['Efficiency','Tokens, model calls, tool calls, wall time, cost per successful task','Traces (gen_ai.invoke_agent.* metrics, Development status)'],
  ['Robustness','Behaviour under tool errors, timeouts, partial data','Fault injection in mocked tools']
])}
<h5>Statistics matter</h5>
<p>Agents are stochastic. Run each task k times and report pass rate with uncertainty, and pass^k (all k succeed) for workflows that must be reliable.</p>
${formula(`
Illustrative: 120 tasks × 5 runs = 600 runs, 516 pass

STEP 1  pass rate p     = 516 ÷ 600
                        = 0.86
STEP 2  standard error  = √( p(1 − p) ÷ n )
                        = √( 0.86 × 0.14 ÷ 600 )
                        = √( 0.000201 )
                        ≈ 0.0142
STEP 3  95% interval    ≈ 0.86 ± 1.96 × 0.0142
                        ≈ 0.86 ± 0.028   →  0.832 … 0.888
ANSWER  a new version scoring 0.87 is NOT proven better;
        the difference is inside the noise
`)}
<p>(Runs of the same task are correlated, so the true interval is somewhat wider; the point is to stop shipping on one lucky run.)</p>
<h5>Sandbox design</h5>
<p>Never evaluate write tools against production. Use recorded responses (replay) for read tools, a seeded test database or ephemeral environment for writes, and fake external services. Keep the environment reset per run so results are reproducible.</p>
<h5>LLM-as-judge: use with care</h5>
<p>Judges are biased (position, length, self-preference) and drift when the judge model changes. Calibrate against a human-labelled sample, report agreement (for example Cohen's kappa), pin the judge model version, and never let a judge be the only gate for safety.</p>
<h5>Where evaluation runs</h5>
<ul>
<li><b>Pre-merge</b>: a fast smoke subset on every prompt, tool-schema or model change.</li>
<li><b>Pre-release</b>: full suite plus red-team set; compare with the current production version on the same tasks.</li>
<li><b>Online</b>: task success proxies (resolution without human escalation, user feedback), escalation rate, cost per resolved ticket, policy-deny rate; sample traces for human review.</li>
</ul>`,
  diagram:fig('Agent evaluation pipeline', svgDiagram({w:900,h:300,
    boxes:[
      {id:'t',x:20,y:120,w:140,h:56,label:'Task suite',sub:'real tickets + adversarial'},
      {id:'s',x:200,y:120,w:150,h:56,label:'Sandbox run',sub:'k runs per task',cls:'hl'},
      {id:'o',x:400,y:30,w:170,h:50,label:'Outcome checker',sub:'end state'},
      {id:'r',x:400,y:110,w:170,h:50,label:'Trajectory check',sub:'tools, args, steps'},
      {id:'f',x:400,y:190,w:170,h:50,label:'Safety + judge',sub:'policy, rubric'},
      {id:'m',x:630,y:110,w:240,h:56,label:'Scorecard',sub:'pass rate ± CI, cost/task'}
    ],
    arrows:[{from:'t',to:'s'},{from:'s',to:'o'},{from:'s',to:'r'},{from:'s',to:'f'},{from:'o',to:'m'},{from:'r',to:'m'},{from:'f',to:'m'}]
  }), 'Outcome first, path second, and always with uncertainty and cost on the scorecard.'),
  followups:[
    {q:'Why not just use a public agent benchmark?',a:'Public benchmarks measure generic capability on someone else\'s tools. Your risk is in your tools, policies and data; you need your own task suite, with public benchmarks only for shortlisting models.'},
    {q:'How do you evaluate an agent whose correct path is not unique?',a:'Check the end state and constraints (no forbidden calls, within budget) rather than an exact sequence; use allowed-sequence rules or a judge only for path quality.'},
    {q:'How do you catch regressions from a model upgrade the provider made?',a:'Pin model versions where possible, run the suite on the new version before switching, and keep a nightly run against production configuration so silent provider changes show up as metric shifts.'}
  ],
  tradeoffs:`
<p><b>Deterministic checkers</b> are precise but cost effort per task; <b>LLM judges</b> scale but are noisy. <b>Replayed tools</b> make runs reproducible but miss live API drift; <b>live sandboxes</b> catch drift but are flaky. Larger suites give tighter intervals but cost tokens on every run: budget evaluation spend like test infrastructure.</p>
<p><b>Operational considerations:</b> version the task suite with the agent; store traces of every evaluation run; gate releases on success rate, safety violations (target zero) and cost per successful task; review failures by category, not just the headline number.</p>`,
  failures:`
<ul>
<li><b>Benchmark overfitting</b>: prompt tuned to the suite; production success falls. Evidence: offline up, online escalation rate up. Fix: refresh tasks from recent tickets; hold out a set.</li>
<li><b>Judge drift</b>: scores jump after the judge model changed. Fix: pin and recalibrate the judge.</li>
<li><b>Sandbox leakage</b>: evaluation touched a real system. Fix: network isolation and fake credentials in eval environments.</li>
</ul>`,
  vocab:[
    {term:'Task success rate',def:'Fraction of runs that reach the goal state as verified by a checker.'},
    {term:'Trajectory evaluation',def:'Assessing the sequence of tool calls and decisions, not just the final answer.'},
    {term:'pass^k',def:'Probability that all k repeated runs of a task succeed; a reliability measure.'},
    {term:'LLM-as-judge',def:'Using a model to grade outputs against a rubric; needs calibration against humans.'},
    {term:'Replay',def:'Serving recorded tool responses so evaluation runs are reproducible.'},
    {term:'Cost per successful task',def:'Total spend (tokens, tools) divided by tasks that actually succeeded.'}
  ],
  mistakes:[
    'Judging an agent by a handful of demos.',
    'Reporting one run per task as if agents were deterministic.',
    'Using only an LLM judge, including for safety.',
    'Evaluating write tools against production systems.'
  ],
  related:['v2-agents','v2-evaluation-monitoring']
},
{
  id:'v3agt-07', chapter:'v3-ch-agents', difficulty:2,
  title:'How do you control the cost of an AI agent?',
  understand:`The interviewer wants to see that you understand why agents are expensive (many model calls, growing context, retries, loops) and that you can bound and reduce cost without breaking success rate. Simple explanation: every step of an agent re-sends a growing conversation to a model, so cost grows faster than the number of steps; you cap steps and tokens, use cheaper models where they work, cache what repeats, and measure cost per successful task.`,
  short:`Agent cost is driven by the number of model calls times the context each one carries, and the context grows every step because tool results get appended. So I control it in four ways. Hard limits: maximum steps, maximum tokens and a dollar budget per run and per tenant, with loop detection that stops repeated identical tool calls. Context management: compact or summarise tool outputs, return only the fields needed, keep the tool list small, and order the prompt so the stable prefix gets provider prompt-cache hits. Model routing: a cheaper model for routine steps like classification or extraction, the strong model only for planning or hard cases, validated by evaluation. And measurement: tokens and cost per run from traces, cost per successful task as the headline metric, and alerts on per-tenant spend anomalies. I compare changes by cost per successful task, because a cheaper agent that fails more often is not cheaper.`,
  detailed:`
<h5>Why agent cost grows superlinearly</h5>
${formula(`
Illustrative agent run: system + tools prefix P = 6,000 tokens,
each step appends a tool result of R = 1,500 tokens, n = 8 steps,
output 300 tokens per step

input tokens at step i  = P + (i − 1) × R
total input             = n × P + R × (0 + 1 + … + (n − 1))
                        = 8 × 6,000 + 1,500 × 28
                        = 48,000 + 42,000
                        = 90,000 input tokens
total output            = 8 × 300 = 2,400 tokens
`)}
${formula(`
Price it (list prices, as of Oct 2026, per 1M tokens):
Claude Sonnet 5.5  $2 input / $10 output

STEP 1  input   = 90,000 ÷ 1,000,000 × $2   = $0.180
STEP 2  output  = 2,400 ÷ 1,000,000 × $10   = $0.024
STEP 3  per run (no caching)                = $0.204

With prompt caching of the 6,000-token prefix on steps 2…8
(cache read 0.05× on Sonnet 5.5; first write 1.25×; 5-min TTL):
STEP 4  prefix cost without cache = 8 × 6,000 × $2/1M        = $0.0960
STEP 5  with cache = 6,000 × 1.25 × $2/1M                    = $0.0150
                   + 7 × 6,000 × 0.05 × $2/1M                = $0.0042
                                                    total    = $0.0192
STEP 6  saving per run ≈ $0.0960 − $0.0192                   = $0.0768
ANSWER  ≈ $0.127 per run, about 38% cheaper, from one change
`)}
<p>(Prices from the provider pricing page as of Oct 2026; caching rules and multipliers vary by model and provider. The previous tool results can also be cached if the prompt is append-only, which improves this further.)</p>
<h5>Levers, roughly in order of effort</h5>
<ol>
<li><b>Budgets and limits</b>: max steps (for example 15), max tokens per run, dollar budget per run and per tenant per day; terminate with a useful partial answer, not silently.</li>
<li><b>Loop detection</b>: same tool with same arguments twice in a row, or no state change in N steps → stop or escalate.</li>
<li><b>Lean tool outputs</b>: return IDs and key fields, not whole documents; truncate logs server-side; paginate.</li>
<li><b>Smaller tool sets</b> per task: tool definitions are input tokens on every step.</li>
<li><b>Cache-friendly prompts</b>: stable prefix first (system, tools), append-only history.</li>
<li><b>Model routing</b>: cheap model (for example list prices as of Oct 2026: gpt-6-luna $0.10/$0.50, Claude Haiku 5.5 $0.10/$0.50 for prompts up to 100K tokens) for routing, extraction, summarising tool outputs; strong model for planning; escalate on low confidence.</li>
<li><b>Deterministic shortcuts</b>: if 60% of tickets follow one path, run it as a workflow and use the agent only for the rest.</li>
<li><b>Batch APIs</b> for non-interactive agents (Anthropic batch is 50% off input and output, as of Oct 2026).</li>
</ol>
<h5>Measuring it</h5>
<p>Emit per-run tokens by type (input, cached input, output), model calls, tool calls and cost from traces; OpenTelemetry GenAI defines agent metrics such as <code>gen_ai.invoke_agent.duration</code>, <code>gen_ai.invoke_agent.inference_calls</code> and <code>gen_ai.invoke_agent.tool_calls</code> (Development status, Oct 2026). Report p50/p95 cost per run and cost per successful task, per tenant and per agent version.</p>`,
  diagram:fig('Where agent tokens come from', svgDiagram({w:900,h:280,
    boxes:[
      {id:'p',x:20,y:110,w:160,h:56,label:'Stable prefix',sub:'system + tools',cls:'ok'},
      {id:'h',x:220,y:110,w:160,h:56,label:'History',sub:'grows every step',cls:'warn'},
      {id:'r',x:420,y:110,w:160,h:56,label:'Tool results',sub:'often the biggest',cls:'warn'},
      {id:'m',x:620,y:110,w:120,h:56,label:'Model call',sub:'× n steps'},
      {id:'b',x:770,y:110,w:110,h:56,label:'Budget',sub:'stop / escalate',cls:'hl'}
    ],
    arrows:[{from:'p',to:'h'},{from:'h',to:'r'},{from:'r',to:'m'},{from:'m',to:'b'}],
    notes:[{x:20,y:200,text:'Cache the green part, shrink the amber parts, cap the number of model calls.'}]
  }), 'Each step re-sends everything before it, so trimming tool results and caching the prefix pay off on every later step.'),
  followups:[
    {q:'A tenant\'s agent spend tripled overnight. How do you investigate?',a:'Break cost down by run count, steps per run, tokens per step and model mix from traces. Typical causes: a loop after a tool started failing, a tool returning much larger outputs, a prompt change breaking cache hits, or a routing change to a pricier model.'},
    {q:'Does routing to a cheaper model always save money?',a:'Only if success rate holds. If the cheap model fails and the task escalates, you pay for both. Compare expected cost per successful task, including escalation rate.'},
    {q:'How do you enforce per-tenant budgets across many agent replicas?',a:'Meter tokens centrally (AI gateway or a shared counter keyed by tenant), check before each model call, and degrade gracefully (cheaper model, shorter context, queue) before hard rejection.'}
  ],
  tradeoffs:`
<p><b>Tight step limits</b> stop runaway cost but cut off legitimately long tasks; pair them with escalation. <b>Summarising tool outputs</b> saves tokens but can drop the detail the model needed. <b>Caching</b> needs prompt structure discipline; a dynamic timestamp at the top of the prompt destroys hit rates.</p>
<p><b>Operational considerations:</b> budgets as configuration per tenant; anomaly alerts on cost per run; dashboards with cached vs uncached input tokens; include cost in the agent evaluation scorecard so regressions are caught before release.</p>`,
  failures:`
<ul>
<li><b>Infinite retry loop</b> when a tool returns isError repeatedly: 200 steps in one run. Fix: loop detection, max steps, backoff, escalate.</li>
<li><b>Cache hit rate collapses</b> after adding the current time to the system prompt. Evidence: cache-read tokens near zero. Fix: put dynamic values after the stable prefix.</li>
<li><b>Huge tool output</b> (a 2 MB log) pasted into context: one run costs dollars. Fix: server-side truncation and summarisation, output size limits.</li>
</ul>`,
  vocab:[
    {term:'Step budget',def:'Maximum number of model/tool iterations allowed per agent run.'},
    {term:'Loop detection',def:'Stopping a run that repeats identical actions or makes no progress.'},
    {term:'Prompt caching',def:'Provider feature charging cached input prefix tokens at a fraction of the normal price.'},
    {term:'Model routing',def:'Sending each step or task to the cheapest model that meets quality.'},
    {term:'Cost per successful task',def:'Total agent spend divided by successful outcomes.'}
  ],
  mistakes:[
    'Estimating agent cost as steps × one prompt size, ignoring growing context.',
    'Comparing cost per run instead of cost per successful task.',
    'Putting volatile content at the start of the prompt and losing cache hits.',
    'No per-tenant budget, so one customer\'s loop burns the monthly budget.'
  ],
  related:['v2-agents','v2-finops-unit-economics','v2-prefix-kv-cache']
},
{
  id:'v3agt-08', chapter:'v3-ch-agents', difficulty:3,
  title:'How do you handle agent identity and delegated permissions?',
  understand:`They test whether you can answer "who is acting?" when an agent calls APIs on behalf of a user: the user, the agent, or both. Simple explanation: an agent should have its own identity (so you can limit and audit it) and also carry the identity of the user it works for, and its effective permission should be the overlap of the two, never more than either.`,
  short:`I give every agent its own workload identity, like a service account, and I also carry the user it is acting for. The effective permission should be the intersection: the agent can only do what both the agent's own role and the user's entitlements allow. Practically that means short-lived, audience-scoped tokens obtained by token exchange, so a downstream API receives a token that says "agent X on behalf of user Y" and nothing broader, rather than the user's original token being passed through, which MCP explicitly forbids. Agent roles are least-privilege and separated by function: a read-only investigator, a separate executor for approved changes. Every action is logged with both identities. And I watch for the classic failures in OWASP's agentic list: identity and privilege abuse, where an agent inherits too much, and confused-deputy attacks, where another user or agent tricks it into using its own privileges.`,
  detailed:`
<h5>Three identity patterns</h5>
${table(['Pattern','How it works','Problem'],[
  ['Agent uses the user\'s token directly','Token passthrough to downstream APIs','Agent gets all user rights everywhere; token replay; forbidden for MCP servers'],
  ['Agent uses only its own service account','One powerful identity for all users','Confused deputy: users get the agent\'s rights; audit loses the user'],
  ['Agent identity + delegated user context (recommended)','Token exchange: agent presents its identity and the user\'s token to the authorization server, receives a narrow token for one audience','More moving parts; requires IdP support']
])}
<h5>Effective permissions</h5>
${formula(`
effective = agent_role ∩ user_entitlements ∩ task_scope

Example (Atlas support agent):
agent_role          = {bookings:read, refunds:create≤500 SAR}
user_entitlements   = {bookings:read (KSA market), refunds:create≤2,000 SAR}
task_scope          = {booking QX7K2P only}
effective           = read QX7K2P, refund ≤ 500 SAR on QX7K2P
`)}
<h5>Mechanics</h5>
<ul>
<li><b>Workload identity for the agent</b>: IRSA or EKS Pod Identity, GKE Workload Identity, a Kubernetes ServiceAccount; no long-lived keys in the container.</li>
<li><b>User context</b>: the inbound user token (validated, audience = the agent service), then OAuth 2.0 token exchange (RFC 8693) to obtain a token for each downstream audience with an actor claim for the agent. Where the IdP does not support it, the agent's service identity calls the API with a signed user-context assertion the API is configured to trust.</li>
<li><b>Short lifetimes and narrow scopes</b>: minutes, one audience, minimal scopes; step-up for sensitive actions.</li>
<li><b>Separate identities per function</b>: planner/investigator (read-only) vs executor (write, just-in-time after approval).</li>
<li><b>Agent-to-agent calls</b>: an A2A server agent authenticates the calling agent with the schemes declared in its Agent Card (OAuth2, OpenID Connect, mutual TLS, API key, HTTP auth) and should still receive end-user context for authorization decisions.</li>
</ul>
<h5>Audit</h5>
<p>Every log line carries: end user, agent identity and version, tool, resource, decision, approval id. "mcp-server-sa deleted X" is not an acceptable audit trail.</p>
<h5>Managed options (as of Oct 2026)</h5>
<p>Platforms are adding agent identity services; for example Amazon Bedrock AgentCore includes an Identity service and a Policy service that intercepts tool calls at its gateway. Evaluate them against the same model: separate agent principal, delegated user context, narrow tokens, full audit.</p>`,
  diagram:fig('Delegated identity chain', svgDiagram({w:900,h:300,
    boxes:[
      {id:'u',x:20,y:120,w:120,h:56,label:'User',sub:'SSO login'},
      {id:'a',x:190,y:120,w:150,h:56,label:'Agent service',sub:'own workload ID',cls:'hl'},
      {id:'s',x:400,y:30,w:180,h:56,label:'Authorization server',sub:'token exchange'},
      {id:'p',x:400,y:200,w:180,h:56,label:'Policy engine',sub:'agent ∩ user ∩ task'},
      {id:'d',x:650,y:120,w:220,h:56,label:'Refund API',sub:'token: agent for user Y'}
    ],
    arrows:[{from:'u',to:'a',label:'user token'},{from:'a',to:'s',label:'exchange'},{from:'s',to:'a',cls:'dash'},{from:'a',to:'p'},{from:'a',to:'d',label:'narrow token'}]
  }), 'The downstream API sees both identities and a token valid only for itself, for minutes.'),
  followups:[
    {q:'Why is passing the user\'s token to every tool a problem?',a:'The token likely has broad audience and scopes; any compromised tool or server can replay it elsewhere. MCP forbids accepting tokens not issued for the server and forbids passing them upstream.'},
    {q:'What is a confused deputy in agent terms?',a:'An agent with more privileges than its caller being tricked, by a user, another agent or injected content, into using those privileges for the caller. Intersecting agent and user permissions and checking per action prevents it.'},
    {q:'How do you handle background agents with no interactive user?',a:'They act as themselves with a narrow service role, or on behalf of a named owner whose delegation is recorded with an expiry. Every run still has an accountable human owner in the audit trail.'}
  ],
  tradeoffs:`
<p><b>Token exchange</b> gives precise, auditable delegation but needs IdP support and adds latency (cache tokens until near expiry). <b>Service identity + signed context</b> is simpler but every API must trust and verify the assertion. <b>One identity per agent function</b> improves least privilege but multiplies roles to manage; manage them as code.</p>
<p><b>Operational considerations:</b> inventory of agent identities with owners; quarterly access reviews; alerts on unused or newly broadened permissions; token-exchange failure metrics; break-glass procedure to revoke an agent identity instantly.</p>`,
  failures:`
<ul>
<li><b>Agent role drifts to admin</b> "to fix a permission error". Evidence: IAM change history. Fix: permission boundaries, policy-as-code review, alerts on privilege expansion.</li>
<li><b>Audit shows only the service account</b> during an incident; nobody knows which user triggered the action. Fix: propagate and log user context everywhere.</li>
<li><b>Long-lived API key</b> baked into an agent image leaks via a public registry. Fix: workload identity, secret scanning, short-lived credentials.</li>
</ul>`,
  vocab:[
    {term:'Workload identity',def:'Platform-issued identity for a running workload (IRSA, Pod Identity, Workload Identity) instead of static keys.'},
    {term:'Token exchange',def:'OAuth 2.0 (RFC 8693) flow to obtain a new token for another audience, optionally with actor and subject.'},
    {term:'Delegation',def:'Allowing an agent to act for a user within limits, recorded with both identities.'},
    {term:'Confused deputy',def:'A privileged component misused by a less-privileged caller.'},
    {term:'OWASP ASI03',def:'Agentic Top 10 item: Identity & Privilege Abuse.'}
  ],
  mistakes:[
    'Giving the agent one admin service account "to keep it simple".',
    'Passing the user\'s token through to every downstream service.',
    'Logging only the agent identity, losing the user.',
    'Long-lived keys in agent configuration.'
  ],
  related:['v2-agents','v2-mcp-auth','v2-governance']
},
{
  id:'v3agt-09', chapter:'v3-ch-agents', difficulty:2,
  title:'What is A2A, and how do Agent Cards and tasks work?',
  understand:`They want to know whether you understand the agent-to-agent protocol well enough to say when to use it and how it differs from MCP. Simple explanation: A2A lets one agent hand work to another agent that may be built by a different team or vendor. An agent publishes an Agent Card describing its skills, endpoints and authentication; a client agent sends it a message, which creates a task that moves through states until it completes, fails or needs input.`,
  short:`A2A is an open protocol for agents to collaborate across boundaries. The current spec is 1.0, released in March 2026, governed under the Linux Foundation, and the project site now shows it as part of the Agentic AI Foundation. Discovery is through an Agent Card, a JSON document usually at /.well-known/agent-card.json, that lists the agent's name, skills, supported interfaces and protocol bindings, capabilities like streaming and push notifications, and security schemes such as OAuth2 or mutual TLS. Work is organised as tasks: a client sends a message, the remote agent creates a task with states like submitted, working, input-required, auth-required, completed, failed, canceled or rejected, and returns artifacts as outputs. It runs over JSON-RPC, gRPC or HTTP+JSON, with SSE streaming and webhooks. The way I contrast it with MCP: MCP is vertical, one agent to its tools and data; A2A is horizontal, agent to agent, where the remote side is opaque and long-running.`,
  detailed:`
<h5>Facts (A2A 1.0.0, released 2026-03-12; 1.0.1 on 2026-05-28; as of Oct 2026)</h5>
${table(['Concept','Details'],[
  ['Agent Card','At https://{domain}/.well-known/agent-card.json. Fields include name, description, supportedInterfaces[] (url, protocolBinding, protocolVersion, optional tenant; first is preferred), provider, version, capabilities (streaming, pushNotifications, extensions, extendedAgentCard), securitySchemes, securityRequirements, defaultInputModes/OutputModes, skills, signatures'],
  ['Task','The core unit of action: id, contextId, status, artifacts, history, metadata'],
  ['Task states (1.0)','TASK_STATE_SUBMITTED, WORKING, INPUT_REQUIRED, AUTH_REQUIRED, COMPLETED, FAILED, CANCELED, REJECTED (plus UNSPECIFIED)'],
  ['Message / Part / Artifact','Messages carry parts (content sections) with a role; artifacts are task outputs made of parts'],
  ['Operations (1.0)','SendMessage, SendStreamingMessage, GetTask, ListTasks, CancelTask, SubscribeToTask, GetExtendedAgentCard'],
  ['Bindings','JSON-RPC 2.0, gRPC, HTTP+JSON/REST (e.g. POST /message:send, GET /tasks/{id})'],
  ['Async','SSE streaming (capabilities.streaming); push notifications to client webhooks'],
  ['Versioning','A2A-Version header; empty means 0.3'],
  ['Security','APIKey, HTTPAuth, OAuth2, OpenIdConnect, MutualTls declared in the card']
])}
<h5>A typical flow (Atlas)</h5>
<ol>
<li>The Atlas support agent needs a visa-requirements check that another team's agent provides.</li>
<li>It fetches that agent's Agent Card, picks the preferred interface, authenticates with the declared OAuth2 scheme.</li>
<li>It calls SendMessage with the traveller's nationality and destination; the remote agent creates a task (SUBMITTED → WORKING).</li>
<li>The remote agent needs the passport expiry date → INPUT_REQUIRED; the client supplies it in a follow-up message with the same task/context id.</li>
<li>COMPLETED with an artifact containing the requirements; the client agent uses it in its reply.</li>
</ol>
<h5>A2A vs MCP in one table</h5>
${table(['','MCP','A2A'],[
  ['Connects','Agent/host to tools, data, prompts','Agent to agent'],
  ['Remote side','Transparent capabilities with schemas','Opaque agent with its own reasoning'],
  ['Unit of work','Single tool call (seconds)','Task with lifecycle (seconds to days)'],
  ['Discovery','Configured server, then tools/list','Agent Card at a well-known URL'],
  ['Official framing','"Vertical": deepens one agent','"Horizontal": connects agents across boundaries; use both together']
])}
<h5>Engineering concerns</h5>
<p>Agent Cards are self-descriptions: verify signatures where provided, allowlist which agents you call, and treat returned artifacts as untrusted input (OWASP ASI07 Insecure Inter-Agent Communication). Track tasks with timeouts and cancellation; long tasks need durable state on both sides.</p>`,
  diagram:fig('A2A task lifecycle', svgDiagram({w:900,h:300,
    boxes:[
      {id:'c',x:20,y:120,w:130,h:56,label:'Client agent'},
      {id:'k',x:190,y:30,w:190,h:50,label:'Agent Card',sub:'/.well-known/agent-card.json'},
      {id:'s',x:190,y:150,w:130,h:50,label:'SUBMITTED'},
      {id:'w',x:360,y:150,w:120,h:50,label:'WORKING',cls:'hl'},
      {id:'i',x:520,y:60,w:150,h:50,label:'INPUT_REQUIRED',cls:'warn'},
      {id:'d',x:720,y:150,w:150,h:50,label:'COMPLETED',sub:'artifacts',cls:'ok'},
      {id:'f',x:520,y:230,w:150,h:50,label:'FAILED / CANCELED',cls:'bad'}
    ],
    arrows:[{from:'c',to:'k',label:'discover'},{from:'c',to:'s',label:'SendMessage'},{from:'s',to:'w'},{from:'w',to:'i'},{from:'i',to:'w',cls:'dash',label:'more input'},{from:'w',to:'d'},{from:'w',to:'f',cls:'dash'}]
  }), 'Unlike a tool call, an A2A task has a lifecycle and can pause for input or authorization.'),
  followups:[
    {q:'When would you expose an internal agent over A2A instead of as an MCP server?',a:'When the capability is itself an agent with its own reasoning and long-running work, owned by another team or vendor, and the caller should not know its internals. If it is a deterministic operation with a schema, an MCP tool is simpler.'},
    {q:'How do you secure A2A between companies?',a:'Allowlist partner agents, verify Agent Card signatures, use OAuth2 client credentials or mutual TLS as declared, pass minimal data, validate artifacts as untrusted input, and log tasks with both organisations\' identifiers.'},
    {q:'What is the AUTH_REQUIRED state for?',a:'The remote agent needs additional authorization (for example user consent to a third-party system) before continuing; the client must obtain it and resume the task.'}
  ],
  tradeoffs:`
<p><b>A2A</b> preserves team autonomy and opacity across organisational boundaries and suits long-running delegated work, at the cost of weaker typing, harder evaluation (you cannot see inside the remote agent) and another trust boundary. <b>MCP tools</b> are transparent and testable but expose internals and suit synchronous operations. <b>Maturity</b>: A2A 1.0 is recent (2026); ecosystem support is growing but less broad than MCP.</p>
<p><b>Operational considerations:</b> SLOs per remote agent, task timeouts and cancellation, retries with idempotency on SendMessage, tracing across agents, cost attribution per task.</p>`,
  failures:`
<ul>
<li><b>Task stuck in WORKING</b> for hours. Fix: client-side deadlines, CancelTask, alerting on task age.</li>
<li><b>Injected instructions in an artifact</b> from a partner agent lead the client agent to call a sensitive tool. Fix: treat artifacts as data; policy gates on side effects.</li>
<li><b>Version mismatch</b>: client omits A2A-Version and server assumes 0.3. Evidence: VersionNotSupportedError or field errors. Fix: send the header; pin SDK versions.</li>
</ul>`,
  vocab:[
    {term:'A2A',def:'Agent2Agent protocol (spec 1.0.0, 2026) for agents to discover each other and delegate tasks.'},
    {term:'Agent Card',def:'JSON self-description of an agent at /.well-known/agent-card.json: skills, interfaces, capabilities, security schemes.'},
    {term:'Task',def:'A2A unit of work with id, contextId, status, artifacts and history.'},
    {term:'Artifact',def:'Output of an A2A task made of parts.'},
    {term:'INPUT_REQUIRED',def:'Task state meaning the remote agent needs more input from the client.'},
    {term:'Push notification',def:'Remote agent POSTs task updates to a client-registered webhook.'}
  ],
  mistakes:[
    '"A2A replaces MCP." The official framing is complementary: vertical vs horizontal.',
    'Using the old agent.json path or 0.3 method names as current without saying so.',
    'Trusting an Agent Card\'s claims without allowlisting or signature checks.',
    'Treating a task like a synchronous RPC with no timeout or cancellation.'
  ],
  related:['v2-a2a-multiagent','v2-agents']
},
{
  id:'v3agt-10', chapter:'v3-ch-agents', difficulty:3,
  title:'What are the failure modes of multi-agent systems, and how do you mitigate them?',
  understand:`The interviewer wants evidence that you have thought beyond the demo: what goes wrong when several agents coordinate, and how you would contain it. Simple explanation: more agents mean more model calls, more hand-offs and more places for errors and attacks to spread; a mistake or injected instruction in one agent can cascade through the others, and costs and latency multiply.`,
  short:`Multi-agent systems fail in ways single agents don't. Errors cascade: one agent's wrong output becomes another's trusted input, and by the end a confident wrong answer has passed several hands. Agents loop, delegating back and forth or re-planning forever. Cost and latency multiply with every hand-off. Goals drift or get hijacked: an injected instruction in one agent's input spreads to others. Inter-agent messages can be spoofed if the channel isn't authenticated. And responsibility blurs, so debugging and audit get hard. OWASP's agentic top 10 names several of these directly: goal hijack, insecure inter-agent communication, cascading failures, rogue agents. My mitigations: start with one agent or a fixed workflow and add agents only when evaluation shows a gain; a supervisor with explicit hand-off contracts and schemas; global budgets for steps, tokens and time across the whole run; validation at each hand-off; authenticated channels; per-agent least privilege; and end-to-end tracing so every decision is attributable.`,
  detailed:`
<h5>Failure taxonomy</h5>
${table(['Failure','What it looks like','Mitigation'],[
  ['Cascading errors (OWASP ASI08)','Researcher agent hallucinates a fare rule; writer agent presents it confidently','Validate hand-offs against schemas and sources; verifier step with tools, not just another opinion'],
  ['Loops and ping-pong','Agent A delegates to B, B asks A for clarification, repeat','Global step/hand-off limits; loop detection on message hashes; supervisor terminates'],
  ['Cost and latency explosion','Each hand-off re-sends context; 5 agents × 10 steps','Shared budget per run; smaller models for sub-agents; pass summaries, not transcripts'],
  ['Goal hijack spreading (ASI01)','Injected text in a fetched page makes the browsing agent instruct the executor','Untrusted-data quarantine; only the planner chooses actions; policy gates on side effects'],
  ['Insecure inter-agent communication (ASI07)','Spoofed or tampered messages between agents','Authenticated channels (mTLS, signed messages), allowlisted peers'],
  ['Rogue agents (ASI10)','A compromised or misconfigured agent acts outside its role','Per-agent identity and least privilege; kill switch; anomaly detection'],
  ['False consensus','Several agents with the same model agree on the same wrong answer','Diversity of evidence (tools, retrieval), not just more votes'],
  ['Unclear accountability','Nobody can say which agent made the call','End-to-end traces with agent name and version on every span']
])}
<h5>The cost multiplier, illustrated</h5>
${formula(`
Illustrative: one agent solves a task in 8 model calls averaging 15,000 input tokens.
A 4-agent design: supervisor 6 calls + 3 workers × 7 calls = 27 calls,
average 12,000 input tokens

single agent   = 8 × 15,000    = 120,000 input tokens
multi-agent    = 27 × 12,000   = 324,000 input tokens
ratio          = 324,000 ÷ 120,000 = 2.7×
ANSWER  the multi-agent design must deliver a real success-rate or
        latency gain (parallel workers) to justify ≈ 2.7× input tokens
`)}
<h5>Design guardrails</h5>
<ul>
<li><b>Default to simpler shapes</b>: workflow → single agent with tools → supervisor with workers, moving right only when evaluations justify it.</li>
<li><b>Contracts at hand-offs</b>: structured outputs with schemas, cited evidence, confidence; reject malformed hand-offs.</li>
<li><b>Global budgets</b>: steps, tokens, wall time and dollars for the whole run, enforced by the orchestrator, not by each agent.</li>
<li><b>Privilege separation</b>: only one agent (the executor) holds write tools, behind policy and approvals.</li>
<li><b>Observability</b>: OTel GenAI spans (<code>invoke_agent</code>, <code>execute_tool</code>) with agent name, linked in one trace; replayable transcripts.</li>
<li><b>Chaos testing</b>: inject tool errors, slow agents and adversarial content in evaluation, and check the system degrades gracefully.</li>
</ul>`,
  diagram:fig('Containment in a supervisor design', svgDiagram({w:900,h:300,
    boxes:[
      {id:'s',x:360,y:20,w:180,h:56,label:'Supervisor',sub:'global budget',cls:'hl'},
      {id:'r',x:60,y:150,w:170,h:56,label:'Research agent',sub:'read-only tools'},
      {id:'b',x:280,y:150,w:170,h:56,label:'Browse agent',sub:'untrusted web',cls:'warn'},
      {id:'w',x:500,y:150,w:170,h:56,label:'Writer agent',sub:'no tools'},
      {id:'e',x:720,y:150,w:160,h:56,label:'Executor',sub:'policy + approval'},
      {id:'v',x:360,y:240,w:180,h:50,label:'Validator',sub:'schema + evidence',cls:'ok'}
    ],
    arrows:[{from:'s',to:'r'},{from:'s',to:'b'},{from:'s',to:'w'},{from:'s',to:'e'},{from:'b',to:'v',cls:'dash'},{from:'r',to:'v',cls:'dash'},{from:'v',to:'s',label:'validated'}]
  }), 'Only validated hand-offs return to the supervisor; only the executor holds write tools.'),
  followups:[
    {q:'When is multi-agent actually worth it?',a:'When subtasks are genuinely independent and can run in parallel, need different tools or privileges (separation is a security benefit), or are owned by different teams (A2A). Not for making one model think harder; that is usually better solved with a better single agent.'},
    {q:'How do you debug a wrong answer from a 5-agent system?',a:'Use the end-to-end trace to find the first hand-off where the content diverged from evidence, then replay that agent with the recorded inputs. Without per-agent spans and stored transcripts you cannot.'},
    {q:'Does majority voting across agents fix hallucination?',a:'Only partly. Agents using the same model and context share failure modes and can agree on the same error. Grounding in tools and sources helps more than more votes.'}
  ],
  tradeoffs:`
<p><b>Multi-agent</b>: modularity, parallelism, privilege separation and team ownership, at the cost of tokens, latency, harder evaluation and new attack surfaces. <b>Single agent</b>: cheaper and easier to debug, but one context and one privilege set. <b>Frameworks</b> make multi-agent easy to start; they do not make it reliable.</p>
<p><b>Operational considerations:</b> per-run budgets enforced centrally, per-agent SLOs and cost attribution, trace sampling that keeps whole runs together, and a kill switch per agent.</p>`,
  failures:`
<ul>
<li><b>Runaway ping-pong</b> costs hundreds of dollars overnight. Fix: hand-off limits, loop detection, spend alerts.</li>
<li><b>Hallucinated fact laundered</b> through a summariser and a writer into a customer email. Fix: evidence-carrying hand-offs and a tool-based verifier.</li>
<li><b>Browse agent hijacked</b> instructs the executor to export data. Fix: executor accepts only supervisor plans that pass policy; browse agent has no channel to the executor.</li>
</ul>`,
  vocab:[
    {term:'Cascading failure (ASI08)',def:'An error or compromise in one agent propagating through others.'},
    {term:'Supervisor pattern',def:'A coordinating agent that delegates to workers and enforces budgets.'},
    {term:'Hand-off contract',def:'Schema and evidence requirements for messages between agents.'},
    {term:'Agent Goal Hijack (ASI01)',def:'An attacker redirecting an agent\'s objective, often via injected content.'},
    {term:'Rogue agent (ASI10)',def:'An agent acting outside its intended role due to compromise or misconfiguration.'}
  ],
  mistakes:[
    'Adding agents to improve quality without measuring cost and success.',
    'Letting every agent hold write tools.',
    'Per-agent budgets only, with no global run budget.',
    'Assuming agreement between agents means correctness.'
  ],
  related:['v2-a2a-multiagent','v2-agents','v2-ai-threat-model']
},
{
  id:'v3agt-11', chapter:'v3-ch-agents', difficulty:2,
  title:'Which agent framework would you choose, and why?',
  understand:`They are testing judgement, not brand loyalty: do you choose by requirements (state, durability, human-in-the-loop, ecosystem, language, hosting) and know the current landscape and its maturity. Simple explanation: frameworks give you the agent loop, state, tool wiring and tracing; pick the one whose model of state and control fits your workflow and your team, and keep your tools portable via MCP so you can change later.`,
  short:`I start from requirements, not the framework list. Do I need durable state and human approvals mid-run? Explicit graphs or free-form loops? Which language does the team use? Is it a managed hosting story or self-hosted on Kubernetes? Then I shortlist. As of October 2026: LangGraph, at 1.2, is my default for explicit, durable graphs with checkpointing and interrupts. Microsoft Agent Framework, 1.x, is the successor to both AutoGen and Semantic Kernel, so for .NET or Azure shops that's the natural choice, and AutoGen itself is in maintenance mode. OpenAI Agents SDK is still 0.x, Google ADK is 2.x, PydanticAI 2.x for typed Python, Strands from AWS, and the Claude Agent SDK, still alpha, exposes Claude Code's loop as a library. Whatever I pick, tools live behind MCP and traces use OpenTelemetry, so the framework is replaceable. I'd prototype the riskiest workflow in two candidates and decide on evidence.`,
  detailed:`
<h5>Decision criteria</h5>
${table(['Criterion','Question to ask'],[
  ['Control model','Explicit graph/workflow vs autonomous loop vs role-based crew?'],
  ['State and durability','Checkpointing, resume after restart, long-running human approvals?'],
  ['Human-in-the-loop','First-class interrupts and approvals?'],
  ['Tooling','Native MCP client support; typed tool schemas?'],
  ['Observability','OpenTelemetry/GenAI traces out of the box?'],
  ['Language and ecosystem','Python, TypeScript, .NET, Java, Go?'],
  ['Hosting','Self-host on Kubernetes or a managed runtime (e.g. Bedrock AgentCore, vendor platforms)?'],
  ['Maturity','Stable 1.x+ API or 0.x/alpha; release cadence; governance']
])}
<h5>Landscape snapshot (PyPI versions and status, as of Oct 2026)</h5>
${table(['Framework','Version / status','Notes'],[
  ['LangGraph','1.2.15, Production/Stable','Stateful graphs; interrupt() needs a checkpointer + thread_id'],
  ['LangChain','1.4.5, Production/Stable','Building blocks; agents built on LangGraph'],
  ['Microsoft Agent Framework','agent-framework 1.21.0, 1.0 GA ~April 2026','Official successor to Semantic Kernel and AutoGen; .NET and Python'],
  ['AutoGen','Maintenance mode; last autogen-agentchat 0.7.5 (2025-09-30)','New users directed to Agent Framework'],
  ['OpenAI Agents SDK','openai-agents 0.23.1','Still 0.x'],
  ['Google ADK','google-adk 2.12.0','2.x line'],
  ['PydanticAI','pydantic-ai 2.56.0, Production/Stable','Typed, Pydantic-style'],
  ['CrewAI','1.15.28','Role-playing multi-agent orchestration'],
  ['LlamaIndex','0.14.25','Data/RAG-centric, still 0.x'],
  ['Strands Agents (AWS)','1.60.0, Production/Stable','Model-driven, minimal code'],
  ['Claude Agent SDK','claude-agent-sdk 0.2.166, Alpha','Claude Code\'s agent loop as a library'],
  ['Amazon Bedrock AgentCore','Managed platform (SDK bedrock-agentcore 1.24.1)','Runtime, Memory, Gateway (APIs to MCP tools), Identity, Policy, Observability']
])}
<p>Versions move monthly; quote "as of" dates and expect interviewers to care more about criteria than numbers.</p>
<h5>Portability strategy</h5>
<ul>
<li>Tools behind MCP servers, not framework-specific tool classes, so any framework (and any vendor host) can use them.</li>
<li>Prompts and evaluation suites versioned outside the framework.</li>
<li>OpenTelemetry tracing so dashboards survive a framework change.</li>
<li>A thin internal interface for "run agent X with input Y, budget Z" so callers do not depend on the framework.</li>
</ul>
<p><b>Honest answer template:</b> "[I have built a prototype with LangGraph in my lab, including interrupts and a Postgres checkpointer. I have read about but not used Agent Framework in production; I would evaluate it for our .NET services with a two-week spike on the refund workflow.]"</p>`,
  diagram:fig('Keep the framework replaceable', svgDiagram({w:900,h:280,
    boxes:[
      {id:'c',x:20,y:110,w:150,h:56,label:'Callers',sub:'run(agent, input)'},
      {id:'f',x:230,y:110,w:200,h:56,label:'Agent framework',sub:'swappable',cls:'hl'},
      {id:'m',x:500,y:30,w:180,h:50,label:'MCP servers',sub:'tools'},
      {id:'p',x:500,y:115,w:180,h:50,label:'Prompts + evals',sub:'versioned'},
      {id:'o',x:500,y:200,w:180,h:50,label:'OTel traces',sub:'GenAI spans'},
      {id:'l',x:740,y:110,w:140,h:56,label:'Model gateway',sub:'routing, quotas'}
    ],
    arrows:[{from:'c',to:'f'},{from:'f',to:'m'},{from:'f',to:'p',cls:'dash'},{from:'f',to:'o',cls:'dash'},{from:'f',to:'l'}]
  }), 'Standard interfaces around the framework (MCP, OTel, a model gateway) make the framework choice reversible.'),
  followups:[
    {q:'Why not write your own agent loop?',a:'For a narrow agent, a small custom loop is fine and transparent. You will end up rebuilding checkpointing, interrupts, retries, tracing and streaming; adopt a framework when you need those, but keep interfaces standard.'},
    {q:'What would make you avoid a framework?',a:'0.x churn on a critical path without a migration plan, no durable state when you need approvals, poor observability, or a hosting model incompatible with your data-residency requirements.'},
    {q:'Managed runtime or self-host on Kubernetes?',a:'Managed runtimes speed up identity, memory, policy and observability; self-hosting gives control over residency, cost and versions. In KSA, region availability and data-processing location often decide it.'}
  ],
  tradeoffs:`
<p><b>Graph frameworks</b> (explicit control, durability) vs <b>autonomous loops</b> (flexibility, less predictable). <b>Managed platforms</b> (fast, integrated, vendor lock-in and region constraints) vs <b>self-hosted</b> (control, more ops). <b>Stable 1.x</b> vs <b>fast-moving 0.x</b> with newer features.</p>
<p><b>Operational considerations:</b> pin versions, track release notes, run the agent evaluation suite on framework upgrades, and budget time for migrations (AutoGen and Semantic Kernel users are migrating now).</p>`,
  failures:`
<ul>
<li><b>Framework upgrade changes default behaviour</b> (retries, prompt templates); success rate drops. Fix: pin versions, evaluate before upgrade.</li>
<li><b>Abandoned framework</b>: maintenance mode leaves security fixes uncertain. Fix: portability layer; migration plan.</li>
<li><b>In-memory state in production</b> because the tutorial used it; approvals lost on restart. Fix: durable checkpointer from day one.</li>
</ul>`,
  vocab:[
    {term:'LangGraph',def:'Library for stateful, graph-structured agents with checkpointing and interrupts.'},
    {term:'Microsoft Agent Framework',def:'Microsoft\'s open, multi-language agent framework; successor to Semantic Kernel and AutoGen.'},
    {term:'Checkpointer',def:'Durable store of agent state enabling resume and human-in-the-loop.'},
    {term:'Managed agent runtime',def:'Hosted service providing agent execution, identity, memory and policy (e.g. Bedrock AgentCore).'},
    {term:'Portability layer',def:'Standard interfaces (MCP, OTel, model gateway) that make framework choice reversible.'}
  ],
  mistakes:[
    'Choosing by popularity or a demo instead of state, approval and hosting requirements.',
    'Starting new projects on AutoGen without noting it is in maintenance mode.',
    'Coupling tools to one framework\'s tool classes.',
    'Quoting framework versions without an "as of" date.'
  ],
  related:['v2-agents','v2-landscape']
}
]);

registerGlossary([
  {term:'Agent Card',def:'A2A self-description of an agent (skills, interfaces, capabilities, security schemes), usually served at /.well-known/agent-card.json.',lesson:'v3-ch-agents'},
  {term:'A2A',def:'Agent2Agent protocol (spec 1.0.0, March 2026) for discovering agents and delegating tasks between them; complements MCP.',lesson:'v3-ch-agents',aliases:['Agent2Agent']},
  {term:'Human-in-the-loop',def:'Design where an agent pauses for human review or approval before risky actions, with durable state and approvals bound to exact plans.',lesson:'v3-ch-agents',aliases:['HITL']},
  {term:'Excessive Agency',def:'OWASP LLM risk (LLM06 in 2025, LLM03 in 2026): an LLM system granted more functionality, permissions or autonomy than needed.',lesson:'v3-ch-agents'},
  {term:'Plan hash',def:'Hash of a canonical action plan to which a human approval is bound, so a changed plan voids the approval.',lesson:'v3-ch-agents'}
]);
