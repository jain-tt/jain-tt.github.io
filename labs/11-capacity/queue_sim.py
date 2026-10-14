"""Why latency explodes near 100 % utilisation: M/M/c queue simulation vs the Erlang C formula.

python queue_sim.py --servers 8 --service-s 2.0
"""
import argparse
import math
import random


# [START sim]
def erlang_c_wait(lam: float, mu: float, c: int) -> float:
    """Mean queueing delay Wq for M/M/c (Poisson arrivals, exponential service). Requires λ < c·μ."""
    a = lam / mu
    rho = a / c
    if rho >= 1:
        return math.inf
    s = sum(a**k / math.factorial(k) for k in range(c))
    top = a**c / math.factorial(c) / (1 - rho)
    p_wait = top / (s + top)
    return p_wait / (c * mu - lam)


def simulate(lam: float, mu: float, c: int, n: int = 200_000, seed: int = 1) -> float:
    rng = random.Random(seed)
    free_at = [0.0] * c
    t, total_wait = 0.0, 0.0
    for _ in range(n):
        t += rng.expovariate(lam)
        i = min(range(c), key=free_at.__getitem__)
        start = max(t, free_at[i])
        total_wait += start - t
        free_at[i] = start + rng.expovariate(mu)
    return total_wait / n
# [END sim]


def main():
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument("--servers", type=int, default=8)
    a.add_argument("--service-s", type=float, default=2.0)
    x = a.parse_args()
    mu = 1 / x.service_s
    print(f"{'util':>5} {'Wq formula (s)':>15} {'Wq simulated (s)':>17}")
    for u in (0.5, 0.7, 0.8, 0.9, 0.95, 0.98):
        lam = u * x.servers * mu
        print(f"{u:5.2f} {erlang_c_wait(lam, mu, x.servers):15.3f} {simulate(lam, mu, x.servers):17.3f}")


if __name__ == "__main__":
    main()
