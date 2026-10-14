from rag_minimal import DOCS, chunk, retrieve, rrf


def chunks():
    return [c for d in DOCS for c in chunk(d)]


def test_acl_filter_before_ranking():
    ids = {d for d, _, _ in retrieve("refund costs margins", {"public"}, chunks(), top_k=10)}
    assert "finance-margins-2026" not in ids and "runbook-payments-oncall" not in ids


def test_staff_sees_runbook():
    ids = [d for d, _, _ in retrieve("refund jobs fail payments", {"public", "staff"}, chunks())]
    assert ids[0] == "runbook-payments-oncall"


def test_rrf_formula():
    fused = dict(rrf([[0, 1], [1, 0]], k=60))
    assert abs(fused[0] - (1 / 61 + 1 / 62)) < 1e-12
