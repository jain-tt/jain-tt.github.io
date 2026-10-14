"""Minimal, dependency-free RAG retrieval pipeline: chunking, BM25, a toy dense retriever,
reciprocal-rank fusion and ACL filtering BEFORE ranking. Teaching code: the "dense" vectors are
hashed bag-of-words, NOT a real embedding model — swap in one for real use.

python rag_minimal.py "how long do refunds take" --groups staff
"""
from __future__ import annotations

import argparse
import hashlib
import math
import re
from collections import Counter
from dataclasses import dataclass

DOCS = [
    {"id": "policy-refund-v7", "acl": {"public"}, "text": "Refunds for cancelled flights are processed within 14 days. "
     "Hotel refunds depend on the property policy. Contact support with your booking reference."},
    {"id": "policy-baggage-v3", "acl": {"public"}, "text": "Economy fares include one cabin bag of 7 kg. "
     "Checked baggage allowance depends on the airline and fare family."},
    {"id": "runbook-payments-oncall", "acl": {"staff"}, "text": "If refund jobs fail, check the payments-worker pods "
     "for CrashLoopBackOff and review the refund queue depth in Grafana before restarting anything."},
    {"id": "finance-margins-2026", "acl": {"finance"}, "text": "Refund processing costs and supplier margins by "
     "market for 2026. Confidential."},
]


@dataclass
class Chunk:
    doc_id: str
    idx: int
    text: str
    acl: set


# [START chunk]
def chunk(doc: dict, max_words: int = 25, overlap: int = 5) -> list[Chunk]:
    """Fixed-size word windows with overlap, cut at sentence ends when possible. Each chunk keeps the
    document id and ACL so that permissions travel with the data into the index."""
    words, out, start, i = doc["text"].split(), [], 0, 0
    while start < len(words):
        end = min(len(words), start + max_words)
        for j in range(end, start + max_words // 2, -1):           # prefer to end on a full stop
            if words[j - 1].endswith("."):
                end = j
                break
        out.append(Chunk(doc["id"], i, " ".join(words[start:end]), set(doc["acl"])))
        if end == len(words):
            break
        start, i = end - overlap, i + 1
    return out
# [END chunk]


def tokens(t: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", t.lower())


# [START bm25]
class BM25:
    def __init__(self, chunks: list[Chunk], k1: float = 1.2, b: float = 0.75):
        self.c, self.k1, self.b = chunks, k1, b
        self.tf = [Counter(tokens(c.text)) for c in chunks]
        self.len = [sum(t.values()) for t in self.tf]
        self.avg = sum(self.len) / len(self.len)
        df = Counter(w for t in self.tf for w in t)
        n = len(chunks)
        self.idf = {w: math.log(1 + (n - d + 0.5) / (d + 0.5)) for w, d in df.items()}

    def scores(self, q: str) -> list[float]:
        out = []
        for tf, ln in zip(self.tf, self.len):
            s = 0.0
            for w in tokens(q):
                if w in tf:
                    f = tf[w]
                    s += self.idf[w] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * ln / self.avg))
            out.append(s)
        return out
# [END bm25]


def toy_embed(t: str, dims: int = 64) -> list[float]:
    v = [0.0] * dims
    for w in tokens(t):
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % dims] += 1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b))


# [START rrf]
def rrf(rankings: list[list[int]], k: int = 60) -> list[tuple[int, float]]:
    """Reciprocal Rank Fusion: score(d) = Σ 1 / (k + rank_i(d)). Uses ranks, not raw scores,
    so BM25 and cosine scores (different scales) can be combined without calibration."""
    fused = Counter()
    for ranking in rankings:
        for rank, idx in enumerate(ranking, start=1):
            fused[idx] += 1 / (k + rank)
    return fused.most_common()
# [END rrf]


# [START acl]
def retrieve(query: str, user_groups: set, chunks: list[Chunk], top_k: int = 3):
    # 1. Permission filter FIRST. Never rank documents the user may not read, never rely on the LLM to hide them.
    allowed = [i for i, c in enumerate(chunks) if c.acl & user_groups]
    if not allowed:
        return []
    sub = [chunks[i] for i in allowed]
    bm = BM25(sub).scores(query)
    qv = toy_embed(query)
    dense = [cosine(qv, toy_embed(c.text)) for c in sub]
    r_bm = sorted(range(len(sub)), key=lambda i: -bm[i])
    r_dn = sorted(range(len(sub)), key=lambda i: -dense[i])
    fused = rrf([r_bm, r_dn])[:top_k]
    # 2. Return chunks WITH their source ids so the answer can cite them.
    return [(sub[i].doc_id, round(score, 4), sub[i].text) for i, score in fused]
# [END acl]


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("query")
    a.add_argument("--groups", default="public")
    x = a.parse_args()
    all_chunks = [c for d in DOCS for c in chunk(d)]
    for doc_id, score, text in retrieve(x.query, set(x.groups.split(",")) | {"public"}, all_chunks):
        print(f"[{doc_id}] {score}  {text}")
