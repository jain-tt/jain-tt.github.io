import math
from kv_cache import kv_bytes_per_token, max_sequences
from capacity import size
from cost import unit_costs
from queue_sim import erlang_c_wait, simulate


def test_kv_llama_shapes():
    assert kv_bytes_per_token(32, 8, 128, 2) == 131_072          # Llama-3.1-8B: 128 KiB/token
    assert kv_bytes_per_token(80, 8, 128, 2) == 327_680          # Llama-3.1-70B: 320 KiB/token


def test_max_sequences():
    # 80 GB × 0.90 − 16 − 4 = 52 GB; 4,096 × 128 KiB = 0.5 GiB/seq → 96 sequences
    assert max_sequences(80, 0.90, 16, 4, 131_072, 4096) == 96


def test_capacity_matches_hand_math():
    r = size(10e6, 8, 3.2, 1500, 300, 0.4, 12.4, 1, 0.10, 2, 8.0)
    assert round(r["mean_rps"], 2) == 925.93
    assert r["replicas_at_peak"] == math.ceil(925.926 * 3.2 / 12.4)


def test_cost_monotonic():
    lo = unit_costs(6.88, 1, 9000, 1800, 0.9, 1, 1500, 300)["usd_per_M_tokens_blended"]
    hi = unit_costs(6.88, 1, 9000, 1800, 0.3, 1, 1500, 300)["usd_per_M_tokens_blended"]
    assert math.isclose(hi / lo, 3.0, rel_tol=1e-9)              # 3× less busy → 3× the unit cost


def test_queue_formula_matches_simulation():
    mu, c = 0.5, 8
    lam = 0.9 * c * mu
    assert abs(simulate(lam, mu, c) - erlang_c_wait(lam, mu, c)) / erlang_c_wait(lam, mu, c) < 0.15
