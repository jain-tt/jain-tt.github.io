"""Cost per million tokens and per successful request.  Prices are inputs; use your contract prices.

python cost.py --gpu-hour 6.88 --gpus 1 --in-tps 9000 --out-tps 1800 --utilisation 0.45 --success 0.97 --tokens-in 1500 --tokens-out 300
"""
import argparse


# [START cost]
def unit_costs(gpu_hour, gpus, in_tps, out_tps, utilisation, success, tokens_in, tokens_out, other_monthly=0.0):
    """in_tps/out_tps: measured sustained tokens/s at SLO when busy. utilisation: fraction of hours busy."""
    hourly = gpu_hour * gpus + other_monthly / 730
    busy = utilisation
    tokens_per_hour = (in_tps + out_tps) * 3600 * busy
    req_per_hour = out_tps * 3600 * busy / tokens_out          # decode is the usual bottleneck for request rate
    return {
        "usd_per_hour": hourly,
        "usd_per_M_tokens_blended": hourly / tokens_per_hour * 1e6,
        "usd_per_request": hourly / req_per_hour,
        "usd_per_successful_request": hourly / (req_per_hour * success),
        "requests_per_hour": req_per_hour,
    }
# [END cost]


def main():
    a = argparse.ArgumentParser(description=__doc__)
    for k, d in [("gpu-hour", 6.88), ("gpus", 1), ("in-tps", 9000), ("out-tps", 1800), ("utilisation", 0.45),
                 ("success", 0.97), ("tokens-in", 1500), ("tokens-out", 300), ("other-monthly", 0.0)]:
        a.add_argument(f"--{k}", type=float, default=d)
    x = a.parse_args()
    r = unit_costs(x.gpu_hour, x.gpus, x.in_tps, x.out_tps, x.utilisation, x.success, x.tokens_in, x.tokens_out, x.other_monthly)
    for k, v in r.items():
        print(f"{k:30s} {v:,.4f}")


if __name__ == "__main__":
    main()
