"""Users → requests → tokens → replicas → GPUs.  Every input is an ASSUMPTION you must replace with measurements.

python capacity.py --dau 10000000 --req-per-user 8 --peak-factor 3.2 --goodput-rps 12.4 --gpus-per-replica 1 --regions 2
"""
import argparse
import math


# [START model]
def size(dau, req_per_user, peak_factor, in_tokens, out_tokens, prefix_hit, goodput_rps, gpus_per_replica,
         reserve, regions, latency_s):
    daily = dau * req_per_user
    mean_rps = daily / 86_400
    peak_rps = mean_rps * peak_factor
    prefill_tps = peak_rps * in_tokens * (1 - prefix_hit)       # tokens the GPUs must actually prefill
    decode_tps = peak_rps * out_tokens
    in_flight = peak_rps * latency_s                             # Little's law (stable system only)
    replicas = math.ceil(peak_rps / goodput_rps)                 # goodput MEASURED at your SLO with your token mix
    with_reserve = math.ceil(replicas * (1 + reserve))
    # survive the loss of one region: remaining regions must carry the whole peak
    per_region = math.ceil(with_reserve / (regions - 1)) if regions > 1 else with_reserve
    total_replicas = per_region * regions
    return {"daily_requests": daily, "mean_rps": mean_rps, "peak_rps": peak_rps,
            "prefill_tokens_per_s": prefill_tps, "decode_tokens_per_s": decode_tps,
            "requests_in_flight": in_flight, "replicas_at_peak": replicas, "replicas_with_reserve": with_reserve,
            "replicas_per_region": per_region, "total_replicas": total_replicas,
            "total_gpus": total_replicas * gpus_per_replica,
            "average_utilisation": mean_rps / (total_replicas * goodput_rps)}
# [END model]


def main():
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument("--dau", type=float, default=10_000_000)
    a.add_argument("--req-per-user", type=float, default=8)
    a.add_argument("--peak-factor", type=float, default=3.2)
    a.add_argument("--in-tokens", type=float, default=1500)
    a.add_argument("--out-tokens", type=float, default=300)
    a.add_argument("--prefix-hit", type=float, default=0.4)
    a.add_argument("--goodput-rps", type=float, required=True, help="MEASURED requests/s per replica at your SLO")
    a.add_argument("--gpus-per-replica", type=int, default=1)
    a.add_argument("--reserve", type=float, default=0.10)
    a.add_argument("--regions", type=int, default=2)
    a.add_argument("--latency-s", type=float, default=8.0, help="mean end-to-end seconds per request")
    x = a.parse_args()
    r = size(x.dau, x.req_per_user, x.peak_factor, x.in_tokens, x.out_tokens, x.prefix_hit, x.goodput_rps,
             x.gpus_per_replica, x.reserve, x.regions, x.latency_s)
    for k, v in r.items():
        print(f"{k:24s} {v:,.2f}" if isinstance(v, float) else f"{k:24s} {v:,}")


if __name__ == "__main__":
    main()
