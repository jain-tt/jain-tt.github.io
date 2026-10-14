"""Capstone stage 1: a character-level decoder-only transformer written from scratch.
Every piece an LLM has, at toy scale: embeddings, positions, causal multi-head attention, MLP,
residuals, RMSNorm, next-token loss, AdamW, checkpointing, and generation WITH a KV cache.

python tiny_gpt.py --steps 300            # ~1 minute on a laptop CPU
python tiny_gpt.py --generate-only        # load the checkpoint and sample
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F

CORPUS = ("The gateway checks the token. The router picks a replica. The engine runs prefill, then decode. "
          "The KV cache grows with every token. Admission control protects the GPU. ") * 60
CKPT = Path(__file__).with_name("tiny_gpt.pt")


# [START attention]
class CausalSelfAttention(nn.Module):
    def __init__(self, d_model: int, n_heads: int):
        super().__init__()
        assert d_model % n_heads == 0
        self.h, self.dk = n_heads, d_model // n_heads
        self.qkv = nn.Linear(d_model, 3 * d_model, bias=False)   # one matmul produces Q, K and V
        self.out = nn.Linear(d_model, d_model, bias=False)

    def forward(self, x, cache=None):
        B, T, C = x.shape
        q, k, v = self.qkv(x).split(C, dim=2)
        q, k, v = (t.view(B, T, self.h, self.dk).transpose(1, 2) for t in (q, k, v))   # [B, heads, T, dk]
        if cache is not None:                      # decode: prepend the stored keys/values of earlier tokens
            if cache.get("k") is not None:
                k = torch.cat([cache["k"], k], dim=2)
                v = torch.cat([cache["v"], v], dim=2)
            cache["k"], cache["v"] = k, v          # the KV cache: grows by T tokens per call
        scores = q @ k.transpose(-2, -1) / math.sqrt(self.dk)    # [B, heads, T_q, T_k]
        Tq, Tk = scores.shape[-2], scores.shape[-1]
        # causal mask: query i may only see keys ≤ its own absolute position
        mask = torch.ones(Tq, Tk, dtype=torch.bool, device=x.device).tril(diagonal=Tk - Tq)
        scores = scores.masked_fill(~mask, float("-inf"))
        att = scores.softmax(dim=-1)                              # each row sums to 1
        y = (att @ v).transpose(1, 2).contiguous().view(B, T, C) # weighted sum of values, heads re-joined
        return self.out(y)
# [END attention]


# [START block]
class RMSNorm(nn.Module):
    def __init__(self, d, eps=1e-6):
        super().__init__(); self.w = nn.Parameter(torch.ones(d)); self.eps = eps

    def forward(self, x):
        return self.w * x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps)


class Block(nn.Module):
    """Pre-norm transformer block: x + Attn(norm(x)), then x + MLP(norm(x))."""

    def __init__(self, d_model, n_heads):
        super().__init__()
        self.n1, self.attn = RMSNorm(d_model), CausalSelfAttention(d_model, n_heads)
        self.n2 = RMSNorm(d_model)
        self.mlp = nn.Sequential(nn.Linear(d_model, 4 * d_model), nn.GELU(), nn.Linear(4 * d_model, d_model))

    def forward(self, x, cache=None):
        x = x + self.attn(self.n1(x), cache)      # residual connection keeps gradients flowing
        return x + self.mlp(self.n2(x))
# [END block]


# [START model]
class TinyGPT(nn.Module):
    def __init__(self, vocab, d_model=64, n_heads=4, n_layers=2, ctx=64):
        super().__init__()
        self.ctx = ctx
        self.tok = nn.Embedding(vocab, d_model)               # token id → vector
        self.pos = nn.Embedding(ctx, d_model)                 # learned absolute positions (real LLMs mostly use RoPE)
        self.blocks = nn.ModuleList(Block(d_model, n_heads) for _ in range(n_layers))
        self.norm = RMSNorm(d_model)
        self.head = nn.Linear(d_model, vocab, bias=False)     # vector → one logit per vocabulary entry

    def forward(self, idx, caches=None, start_pos=0):
        T = idx.shape[1]
        pos = torch.arange(start_pos, start_pos + T, device=idx.device)
        x = self.tok(idx) + self.pos(pos)
        for i, b in enumerate(self.blocks):
            x = b(x, None if caches is None else caches[i])
        return self.head(self.norm(x))                        # [B, T, vocab]
# [END model]


def batches(data, ctx, bs, gen):
    ix = torch.randint(0, len(data) - ctx - 1, (bs,), generator=gen)
    x = torch.stack([data[i:i + ctx] for i in ix])
    return x, torch.stack([data[i + 1:i + ctx + 1] for i in ix])   # targets = inputs shifted by one


# [START train]
def train(steps: int):
    torch.manual_seed(0)
    chars = sorted(set(CORPUS)); stoi = {c: i for i, c in enumerate(chars)}
    data = torch.tensor([stoi[c] for c in CORPUS])
    split = int(0.9 * len(data)); tr, va = data[:split], data[split:]          # hold out the tail for validation
    model = TinyGPT(len(chars))
    print(f"parameters: {sum(p.numel() for p in model.parameters()):,}")
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.01)
    gen = torch.Generator().manual_seed(0)
    for step in range(steps + 1):
        x, y = batches(tr, model.ctx, 32, gen)
        logits = model(x)
        loss = F.cross_entropy(logits.view(-1, logits.size(-1)), y.view(-1))   # next-token prediction
        opt.zero_grad(set_to_none=True); loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)                # guards against exploding gradients
        opt.step()
        if step % 100 == 0:
            with torch.no_grad():
                xv, yv = batches(va, model.ctx, 32, gen)
                lv = model(xv)
                vloss = F.cross_entropy(lv.view(-1, lv.size(-1)), yv.view(-1))
            print(f"step {step:4d} train {loss.item():.3f} val {vloss.item():.3f}  (uniform guess = ln {len(chars)} = {math.log(len(chars)):.2f})")
    # a resumable checkpoint holds more than weights
    torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "step": steps, "chars": chars,
                "config": {"d_model": 64, "n_heads": 4, "n_layers": 2, "ctx": 64}}, CKPT)
    return model, chars
# [END train]


# [START generate]
@torch.no_grad()
def generate(model, chars, prompt="The ", n=80, temperature=0.8, use_cache=True):
    stoi = {c: i for i, c in enumerate(chars)}
    ids = torch.tensor([[stoi[c] for c in prompt]])
    caches = [dict() for _ in model.blocks] if use_cache else None
    logits = model(ids, caches)                                 # PREFILL: whole prompt at once, fills the cache
    out = list(prompt)
    for i in range(n):
        probs = (logits[0, -1] / temperature).softmax(-1)
        nxt = torch.multinomial(probs, 1)                       # sample the next token
        out.append(chars[nxt.item()])
        pos = len(out) - 1
        if pos >= model.ctx:
            break
        if use_cache:
            logits = model(nxt.view(1, 1), caches, start_pos=pos)   # DECODE: one new token, reuses cached K/V
        else:
            logits = model(torch.tensor([[stoi[c] for c in out]]))  # no cache: recompute the whole sequence
    return "".join(out)
# [END generate]


def load():
    ck = torch.load(CKPT, weights_only=True)     # weights_only: never unpickle arbitrary objects
    m = TinyGPT(len(ck["chars"]), **ck["config"]); m.load_state_dict(ck["model"]); m.eval()
    return m, ck["chars"]


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--steps", type=int, default=300)
    a.add_argument("--generate-only", action="store_true")
    x = a.parse_args()
    model, chars = load() if x.generate_only else train(x.steps)
    model.eval()
    torch.manual_seed(1)
    print("sample:", generate(model, chars))
