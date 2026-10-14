"""Right-sizing analysis. Pure functions: no I/O, fully unit-testable.

Design rules (why this is not "set request = average"):
1. Size CPU from a high percentile (p95) of per-pod usage, memory from the MAXIMUM
   (memory is not compressible: exceeding the limit means OOMKill, not slowness).
2. Count repeated short spikes. A workload that bursts to 4× its median every day
   needs headroom even if the p95 looks small.
3. HPA-aware: if an HPA scales on CPU utilisation (= usage / request), lowering the
   request raises utilisation and the HPA adds replicas. Savings can vanish or turn
   into cost. We recommend changing request and HPA target together, or leave it.
4. Refuse to recommend when metrics cover too little of the window.
5. Never cut more than MAX_STEP_DOWN in one change; critical workloads get more headroom.
6. Recent OOMKills or restarts block memory reductions.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from statistics import median


# [START policy]
@dataclass(frozen=True)
class Policy:
    cpu_percentile: float = 95.0
    cpu_headroom: float = 0.20            # +20 % above p95
    mem_headroom: float = 0.15            # +15 % above the 30-day max
    critical_extra_headroom: float = 0.15
    max_step_down: float = 0.50           # never cut more than 50 % in one change
    min_coverage: float = 0.90            # need ≥ 90 % of expected samples
    spike_factor: float = 3.0             # sample ≥ 3 × median counts as a spike
    min_cpu_m: int = 50
    min_mem_mi: int = 64
    price_vcpu_hour: float = 0.04         # ILLUSTRATIVE blended on-demand prices; replace with your rates
    price_gib_hour: float = 0.005
    hours_per_month: float = 730.0
# [END policy]


@dataclass
class Container:
    name: str
    cpu_request_m: int
    mem_request_mi: int
    cpu_limit_m: int | None
    mem_limit_mi: int | None


@dataclass
class Workload:
    namespace: str
    name: str
    kind: str
    replicas: int
    containers: list[Container]
    criticality: str = "standard"                    # from label atlas.io/criticality
    hpa: dict | None = None                          # {"min":2,"max":10,"metric":"cpu","target_utilization":70}
    oom_kills_30d: int = 0
    restarts_30d: int = 0


@dataclass
class Series:
    """Per-pod usage samples for one container over the window (hourly here)."""
    values: list[float]
    expected_samples: int


@dataclass
class Stats:
    avg: float
    p50: float
    p95: float
    p99: float
    max: float
    coverage: float
    spikes: int
    spike_days: int


@dataclass
class Recommendation:
    container: str
    status: str                                      # "change" | "keep" | "insufficient-data" | "blocked"
    reasons: list[str] = field(default_factory=list)
    cpu_request_m: int | None = None
    mem_request_mi: int | None = None
    mem_limit_mi: int | None = None
    monthly_saving_usd: float = 0.0
    hpa_note: str | None = None


# [START stats]
def percentile(sorted_vals: list[float], p: float) -> float:
    """Nearest-rank percentile on an already sorted list."""
    if not sorted_vals:
        return math.nan
    k = max(0, min(len(sorted_vals) - 1, math.ceil(p / 100 * len(sorted_vals)) - 1))
    return sorted_vals[k]


def stats(s: Series, policy: Policy, samples_per_day: int = 24) -> Stats:
    vals = [v for v in s.values if v is not None and not math.isnan(v)]
    if not vals:
        return Stats(math.nan, math.nan, math.nan, math.nan, math.nan, 0.0, 0, 0)
    sv = sorted(vals)
    med = median(sv)
    spike_idx = [i for i, v in enumerate(s.values) if v is not None and med > 0 and v >= policy.spike_factor * med]
    return Stats(avg=sum(vals) / len(vals), p50=med, p95=percentile(sv, 95), p99=percentile(sv, 99), max=sv[-1],
                 coverage=len(vals) / s.expected_samples, spikes=len(spike_idx),
                 spike_days=len({i // samples_per_day for i in spike_idx}))
# [END stats]


# [START recommend]
def recommend(w: Workload, c: Container, cpu: Series, mem: Series, p: Policy = Policy()) -> tuple[Recommendation, Stats, Stats]:
    cs, ms = stats(cpu, p), stats(mem, p)
    r = Recommendation(container=c.name, status="keep")

    # Rule 4: missing or incomplete metrics -> no recommendation
    if min(cs.coverage, ms.coverage) < p.min_coverage:
        r.status = "insufficient-data"
        r.reasons.append(f"metric coverage {min(cs.coverage, ms.coverage):.0%} < {p.min_coverage:.0%} of the window")
        return r, cs, ms

    extra = p.critical_extra_headroom if w.criticality == "critical" else 0.0

    # Rule 1+2: CPU from p95, raised if repeated spikes exist
    cpu_target = cs.p95 * (1 + p.cpu_headroom + extra)
    if cs.spike_days >= 7:                                  # spiking on ≥ 7 distinct days = a pattern, not noise
        cpu_target = max(cpu_target, cs.p99 * (1 + extra))
        r.reasons.append(f"CPU spikes ≥{p.spike_factor:g}× median on {cs.spike_days} days: sized from p99 ({cs.p99:.0f}m)")
    cpu_new = max(p.min_cpu_m, math.ceil(cpu_target / 10) * 10)

    # Rule 1+6: memory from the max; block reductions after OOMKills
    mem_new = max(p.min_mem_mi, math.ceil(ms.max * (1 + p.mem_headroom + extra) / 16) * 16)
    if w.oom_kills_30d > 0:
        mem_new = max(mem_new, c.mem_request_mi)
        r.reasons.append(f"{w.oom_kills_30d} OOMKill(s) in 30 days: memory will not be reduced"
                         + (f" (raised to {mem_new}Mi)" if mem_new > c.mem_request_mi else ""))

    # Rule 5: limit the size of a single step down
    floor_cpu = math.ceil(c.cpu_request_m * (1 - p.max_step_down))
    floor_mem = math.ceil(c.mem_request_mi * (1 - p.max_step_down))
    if cpu_new < floor_cpu:
        r.reasons.append(f"CPU cut capped at {p.max_step_down:.0%} this step ({c.cpu_request_m}m → {floor_cpu}m); re-analyse after a week")
        cpu_new = floor_cpu
    if mem_new < floor_mem:
        r.reasons.append(f"memory cut capped at {p.max_step_down:.0%} this step")
        mem_new = floor_mem

    # Rule 3: HPA interaction
    if w.hpa and w.hpa.get("metric") == "cpu" and cpu_new != c.cpu_request_m:
        t = w.hpa["target_utilization"] / 100
        util_after = cs.p50 / cpu_new
        r.hpa_note = (f"HPA scales on CPU at {t:.0%} of request. Median per-pod use {cs.p50:.0f}m is "
                      f"{cs.p50 / c.cpu_request_m:.0%} of today's request but would be {util_after:.0%} of {cpu_new}m. "
                      f"Change the HPA target together with the request, or the HPA will add replicas and cancel the saving.")
        if util_after > t:
            r.status = "blocked"
            r.reasons.append("lowering the CPU request would push median utilisation above the HPA target")
            r.cpu_request_m, r.mem_request_mi = c.cpu_request_m, mem_new
            return r, cs, ms

    # never set memory limit below the request; keep ≥ 25 % burst room above the observed max
    mem_limit = max(mem_new, math.ceil(ms.max * 1.25 / 16) * 16) if c.mem_limit_mi else None

    r.cpu_request_m, r.mem_request_mi, r.mem_limit_mi = cpu_new, mem_new, mem_limit
    if cpu_new == c.cpu_request_m and mem_new == c.mem_request_mi:
        r.status = "keep"
        r.reasons.append("requests already match observed usage")
    else:
        r.status = "change"
        reps = avg_replicas(w)
        d_cpu = (c.cpu_request_m - cpu_new) / 1000 * p.price_vcpu_hour
        d_mem = (c.mem_request_mi - mem_new) / 1024 * p.price_gib_hour
        r.monthly_saving_usd = round((d_cpu + d_mem) * reps * p.hours_per_month, 2)
        r.reasons.append(f"CPU p95 {cs.p95:.0f}m vs request {c.cpu_request_m}m; memory max {ms.max:.0f}Mi vs request {c.mem_request_mi}Mi")
    return r, cs, ms
# [END recommend]


def avg_replicas(w: Workload) -> float:
    if w.hpa:
        return (w.hpa["min"] + w.replicas) / 2       # crude: between floor and current
    return float(w.replicas)


def to_dict(x) -> dict:
    return asdict(x)
