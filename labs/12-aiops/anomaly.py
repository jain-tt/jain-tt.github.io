"""Anomaly detection building blocks for AIOps: robust z-score (MAD), EWMA, multi-window burn rate.

python anomaly.py      # runs the demo on a synthetic latency series
"""
from __future__ import annotations

import math
from statistics import median


# [START mad]
def robust_z(values: list[float], window: int = 24, threshold: float = 3.5) -> list[tuple[int, float]]:
    """Flag points far from the rolling median, measured in MADs. Unlike mean/stddev, one big outlier
    cannot inflate the baseline and hide itself (masking)."""
    out = []
    for i in range(window, len(values)):
        base = values[i - window:i]
        med = median(base)
        mad = median(abs(x - med) for x in base) or 1e-9
        z = 0.6745 * (values[i] - med) / mad          # 0.6745 makes MAD comparable to σ for normal data
        if abs(z) > threshold:
            out.append((i, round(z, 1)))
    return out


def ewma(values: list[float], alpha: float = 0.3) -> list[float]:
    s, out = values[0], []
    for v in values:
        s = alpha * v + (1 - alpha) * s
        out.append(s)
    return out
# [END mad]


# [START burn]
def burn_rate(error_ratio: float, slo: float) -> float:
    """How fast the error budget is being consumed. 1.0 = exactly on budget for the SLO period."""
    return error_ratio / (1 - slo)


def should_page(err_long: float, err_short: float, slo: float, factor: float) -> bool:
    """Google SRE Workbook multi-window alert: both the long and the short window must exceed the
    burn-rate factor (e.g. 14.4 over 1 h AND 5 min). The short window stops paging once it recovers."""
    return burn_rate(err_long, slo) >= factor and burn_rate(err_short, slo) >= factor


SRE_WORKBOOK_POLICY = [  # (factor, long window, short window, action) for a 30-day SLO
    (14.4, "1h", "5m", "page"),     # 2 % of the monthly budget in 1 hour
    (6.0, "6h", "30m", "page"),     # 5 % in 6 hours
    (1.0, "3d", "6h", "ticket"),    # 10 % in 3 days
]
# [END burn]


if __name__ == "__main__":
    import random
    random.seed(7)
    ttft = [0.8 + random.gauss(0, 0.05) for _ in range(96)]
    ttft[60] = 2.9                                   # a burst
    print("robust-z anomalies (index, z):", robust_z(ttft))
    slo = 0.999
    print("burn rate at 1.5 % errors:", round(burn_rate(0.015, slo), 1), "→ page:", should_page(0.015, 0.02, slo, 14.4))
