# Lab 10 — Capstone: DevOps infrastructure-optimisation MCP server

An MCP server that lets an AI assistant analyse Kubernetes workloads against 30 days of utilisation
(Mimir/Prometheus) and cost, and PROPOSE right-sizing changes that a different human must approve.
Tested 2026-10-14 (Python 3.14, `mcp` 2.3.0): `pytest` → 4 passed. Sample tool output: `sample_output.json`.

```
AI host (agent) ──MCP──▶ optimizer server ──read-only──▶ Kubernetes API · Mimir · OpenCost
                               │ propose_change (records only)
                               ▼
                       change store (pending) ──approve_cli (different human, plan hash)──▶ approved
                                                       │ apply_cli (CI/GitOps identity) writes patch to repo
                                                       ▼
                                               Argo CD sync ──▶ cluster      validate_change (read-only) ◀─ MCP
                     every step ──▶ hash-chained audit.jsonl
```

## Tools
| Tool | Effect | Annotations |
|---|---|---|
| `list_namespaces`, `list_workloads` | read | readOnly |
| `analyze_workload` | 30-day avg/p50/p95/p99/max, spike days, coverage, recommendation | readOnly |
| `recommend_namespace` | ranked recommendations + illustrative monthly saving | readOnly |
| `propose_change` | records a pending proposal; the SERVER computes the patch | not readOnly, not destructive, idempotent |
| `get_change_status`, `validate_change` | read | readOnly |

There is deliberately no approve/apply/patch/scale tool (a test enforces this).

## The analysis rules (src/optimizer_mcp/analysis.py)
1. CPU from p95 (+20 %), memory from the 30-day max (+15 %). Never from the average.
2. Spikes ≥ 3× median on ≥ 7 distinct days → size CPU from p99.
3. HPA on CPU utilisation → explain the interaction; block if median utilisation would exceed the target.
4. Metric coverage < 90 % of the window → `insufficient-data`, no recommendation.
5. At most 50 % reduction per change; critical workloads get +15 % headroom.
6. Any OOMKill in 30 days → memory is never reduced (raised if the max needs it).

## Run
```bash
python fixtures/generate.py           # deterministic synthetic 30-day data
pip install -e ".[dev]" && pytest -q
python -m optimizer_mcp.server        # stdio; add --http for Streamable HTTP
OPTIMIZER_SOURCE=live MIMIR_URL=... MIMIR_TENANT=... python -m optimizer_mcp.server   # real cluster (read-only SA)
```
Approval and apply (outside MCP):
```bash
python -m optimizer_mcp.approve_cli <id> <plan_hash>          # must be a different user than the requester
python -m optimizer_mcp.apply_cli <id> /path/to/gitops-repo    # writes overlays/<ns>/<name>-resources.patch.json
```

## Live-mode RBAC (read-only)
`get, list` on `deployments`, `horizontalpodautoscalers`, `namespaces`; Mimir read for
`container_cpu_usage_seconds_total`, `container_memory_working_set_bytes`,
`kube_pod_container_status_last_terminated_reason` (kube-state-metrics). Deploy with the same chart
pattern as lab 08 (non-root, NetworkPolicy, OAuth on HTTP).

## Security review
| Threat | Control |
|---|---|
| Prompt injection makes the agent push a harmful change | The model cannot set numbers (server computes the patch); propose ≠ approve ≠ apply; approval needs the exact plan hash |
| Self-approval | Requester ≠ approver enforced in the store |
| Approved plan swapped before apply | apply_cli re-hashes the stored patch and refuses on mismatch |
| Tampering with history | Hash-chained audit log; `AuditLog.verify()` |
| Server credentials abused | ServiceAccount has get/list only; NetworkPolicy egress allowlist |
| Bad recommendation | Step cap, OOM and HPA rules, validate_change after rollout, rollback = git revert |

## Operational runbook
- **Symptom: everything says `insufficient-data`.** Check the Mimir tenant header, the scrape of
  cAdvisor metrics, and that the 30-day retention covers the window.
- **Symptom: savings look huge.** Check the price inputs in `Policy` (illustrative defaults) and the HPA replica assumption.
- **After apply.** Wait ≥ 3 days, run `validate_change`; on `rollback-recommended`, git-revert the overlay.

## Failure simulations (do them)
1. Delete 8 days of samples in `fixtures/generate.py` for `payments/api` → status becomes `insufficient-data`.
2. Set `oom_kills_30d` on `api` → memory recommendation never goes down.
3. Try approving as the requester → `separation of duties` error.
4. Edit the stored patch in `changes.db` after approval → `apply_cli` refuses (hash mismatch).
5. Edit a line of `audit.jsonl` → `AuditLog().verify()` returns False.

What is lab-validated: the rules, the workflow and the audit chain on synthetic data.
Not validated: live Mimir/Kubernetes integration and behaviour at real-cluster scale.
