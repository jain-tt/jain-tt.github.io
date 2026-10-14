import torch
from tiny_gpt import TinyGPT


def test_kv_cache_matches_full_recompute():
    """The cached decode path must produce exactly the logits of recomputing the whole sequence."""
    torch.manual_seed(0)
    m = TinyGPT(vocab=20).eval()
    seq = torch.randint(0, 20, (1, 12))
    with torch.no_grad():
        full = m(seq)[0, -1]
        caches = [dict() for _ in m.blocks]
        m(seq[:, :8], caches)                               # prefill 8 tokens
        for p in range(8, 12):
            last = m(seq[:, p:p + 1], caches, start_pos=p)  # decode one token at a time
    assert torch.allclose(full, last[0, -1], atol=1e-5)
    assert caches[0]["k"].shape[2] == 12                    # cache holds 12 positions


def test_causal_mask_blocks_future():
    torch.manual_seed(0)
    m = TinyGPT(vocab=20).eval()
    a = torch.randint(0, 20, (1, 10)); b = a.clone(); b[0, 9] = (a[0, 9] + 1) % 20
    with torch.no_grad():
        assert torch.allclose(m(a)[0, :9], m(b)[0, :9], atol=1e-6)   # changing token 9 cannot affect positions 0-8
