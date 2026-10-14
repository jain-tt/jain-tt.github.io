"""GPU memory estimates for training vs inference. Lower bounds: measure the real thing.

python gpu_memory.py train --params-b 8 --gpus 8 --zero 3
python gpu_memory.py infer --params-b 70 --weight-bytes 2 --layers 80 --kv-heads 8 --head-dim 128 --context 8192 --seqs 32
"""
import argparse

GB = 1e9


# [START train]
def training_bytes_per_param(zero_stage: int, n_gpus: int) -> float:
    """Mixed-precision Adam (ZeRO paper): 2 (bf16/fp16 weights) + 2 (grads) + 12 (fp32 master + m + v) = 16 B.
    ZeRO-1 shards the 12 optimizer bytes, ZeRO-2 also the 2 gradient bytes, ZeRO-3 also the 2 weight bytes."""
    w, g, o = 2.0, 2.0, 12.0
    if zero_stage >= 1: o /= n_gpus
    if zero_stage >= 2: g /= n_gpus
    if zero_stage >= 3: w /= n_gpus
    return w + g + o
# [END train]


# [START infer]
def inference_bytes(params_b, weight_bytes, layers, kv_heads, head_dim, kv_bytes, context, seqs, tp=1):
    weights = params_b * 1e9 * weight_bytes / tp
    kv = 2 * layers * kv_heads * head_dim * kv_bytes * context * seqs / tp     # KV heads are split across TP ranks
    return weights, kv
# [END infer]


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = a.add_subparsers(dest="mode", required=True)
    t = sub.add_parser("train"); t.add_argument("--params-b", type=float, required=True)
    t.add_argument("--gpus", type=int, default=1); t.add_argument("--zero", type=int, default=0, choices=[0, 1, 2, 3])
    i = sub.add_parser("infer"); i.add_argument("--params-b", type=float, required=True)
    for k, d in [("weight-bytes", 2.0), ("layers", 32), ("kv-heads", 8), ("head-dim", 128), ("kv-bytes", 2.0),
                 ("context", 8192), ("seqs", 1), ("tp", 1)]:
        i.add_argument(f"--{k}", type=float, default=d)
    x = a.parse_args()
    if x.mode == "train":
        b = training_bytes_per_param(x.zero, x.gpus)
        print(f"{b:.2f} B/param per GPU → {x.params_b * 1e9 * b / GB:,.1f} GB per GPU before activations")
    else:
        w, kv = inference_bytes(x.params_b, x.weight_bytes, int(x.layers), int(x.kv_heads), int(x.head_dim),
                                x.kv_bytes, int(x.context), int(x.seqs), int(x.tp))
        print(f"weights {w / GB:,.1f} GB + KV {kv / GB:,.1f} GB = {(w + kv) / GB:,.1f} GB per GPU (+ activations, CUDA graphs, fragmentation)")


if __name__ == "__main__":
    main()
