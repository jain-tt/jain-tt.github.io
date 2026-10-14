"""KV-cache memory from a model config.  python kv_cache.py --help

Examples
  python kv_cache.py --layers 32 --kv-heads 8 --head-dim 128 --context 8192 --sequences 16
  python kv_cache.py --hf-config config.json --context 4096 --gpu-gb 80 --weights-gb 16 --util 0.92
"""
import argparse
import json

GiB = 2**30


# [START formula]
def kv_bytes_per_token(layers: int, kv_heads: int, head_dim: int, dtype_bytes: float = 2) -> float:
    """One K and one V vector per layer per KV head. GQA models: use num_key_value_heads."""
    return 2 * layers * kv_heads * head_dim * dtype_bytes


def max_sequences(gpu_gb: float, util: float, weights_gb: float, overhead_gb: float,
                  per_token: float, context: int) -> int:
    """How many full-length sequences fit in the KV budget left after weights and runtime overhead."""
    budget_bytes = (gpu_gb * util - weights_gb - overhead_gb) * 1e9      # datasheets use GB (10^9)
    return max(0, int(budget_bytes // (per_token * context)))
# [END formula]


def from_hf_config(path: str) -> tuple[int, int, int]:
    c = json.load(open(path))
    heads = c["num_attention_heads"]
    head_dim = c.get("head_dim") or c["hidden_size"] // heads
    return c["num_hidden_layers"], c.get("num_key_value_heads", heads), head_dim


def main() -> None:
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--hf-config")
    a.add_argument("--layers", type=int, default=32)
    a.add_argument("--kv-heads", type=int, default=8)
    a.add_argument("--head-dim", type=int, default=128)
    a.add_argument("--dtype-bytes", type=float, default=2, help="2 = BF16/FP16, 1 = FP8")
    a.add_argument("--context", type=int, default=8192)
    a.add_argument("--sequences", type=int, default=1)
    a.add_argument("--gpu-gb", type=float)
    a.add_argument("--util", type=float, default=0.92, help="vLLM --gpu-memory-utilization (default 0.92 in recent vLLM)")
    a.add_argument("--weights-gb", type=float, default=0)
    a.add_argument("--overhead-gb", type=float, default=4, help="activations, CUDA graphs, allocator (measure yours)")
    x = a.parse_args()
    layers, kvh, hd = from_hf_config(x.hf_config) if x.hf_config else (x.layers, x.kv_heads, x.head_dim)
    per_tok = kv_bytes_per_token(layers, kvh, hd, x.dtype_bytes)
    per_seq = per_tok * x.context
    print(f"KV per token      : {per_tok:,.0f} B = {per_tok / 1024:,.1f} KiB")
    print(f"KV per sequence   : {per_seq / GiB:,.3f} GiB at {x.context:,} tokens")
    print(f"KV for {x.sequences} seqs  : {per_seq * x.sequences / GiB:,.2f} GiB")
    if x.gpu_gb:
        n = max_sequences(x.gpu_gb, x.util, x.weights_gb, x.overhead_gb, per_tok, x.context)
        print(f"max concurrent {x.context:,}-token sequences on {x.gpu_gb:g} GB: {n}")


if __name__ == "__main__":
    main()
