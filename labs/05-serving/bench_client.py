"""Open-loop streaming load generator for any OpenAI-compatible endpoint (vLLM, SGLang, TensorRT-LLM serve,
or mock_openai_server.py). Measures TTFT, TPOT, end-to-end latency and goodput at your SLO.

python bench_client.py --url http://127.0.0.1:8000 --model mock-1b --rate 4 --requests 40 \
       --prompt-tokens 800 --max-tokens 128 --slo-ttft 1.0 --slo-tpot 0.05
Open loop = requests are sent on a Poisson schedule whether or not earlier ones finished,
which is how real users behave (closed-loop tools hide queueing: "coordinated omission").
"""
import argparse
import json
import random
import statistics
import threading
import time
import urllib.request


# [START request]
def one_request(url, model, prompt_tokens, max_tokens, api_key=None):
    body = json.dumps({"model": model, "stream": True, "max_tokens": max_tokens,
                       "stream_options": {"include_usage": True},
                       "messages": [{"role": "user", "content": "word " * prompt_tokens}]}).encode()
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(f"{url}/v1/chat/completions", data=body, headers=headers)
    t0 = time.perf_counter()
    first, n_tokens = None, 0
    with urllib.request.urlopen(req, timeout=300) as resp:
        for raw in resp:                                   # SSE: lines of "data: {...}"
            line = raw.decode().strip()
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            chunk = json.loads(line[6:])
            if chunk.get("choices") and chunk["choices"][0].get("delta", {}).get("content"):
                n_tokens += 1
                if first is None:
                    first = time.perf_counter()
    end = time.perf_counter()
    ttft = (first or end) - t0
    tpot = (end - first) / (n_tokens - 1) if first and n_tokens > 1 else 0.0   # time per output token after the first
    return {"ttft": ttft, "tpot": tpot, "e2e": end - t0, "tokens": n_tokens}
# [END request]


# [START metrics]
def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def summarize(results, duration, slo_ttft, slo_tpot):
    ok = [r for r in results if "error" not in r]
    good = [r for r in ok if r["ttft"] <= slo_ttft and r["tpot"] <= slo_tpot]
    out = {"requests": len(results), "errors": len(results) - len(ok),
           "throughput_req_s": len(ok) / duration,
           "output_tok_s": sum(r["tokens"] for r in ok) / duration,
           "goodput_req_s": len(good) / duration,                     # requests that met BOTH SLOs, per second
           "slo_attainment": len(good) / len(results) if results else 0}
    for k in ("ttft", "tpot", "e2e"):
        vals = [r[k] for r in ok]
        if vals:
            out[f"{k}_p50"], out[f"{k}_p95"], out[f"{k}_p99"] = pct(vals, 50), pct(vals, 95), pct(vals, 99)
            out[f"{k}_mean"] = statistics.fmean(vals)
    return out
# [END metrics]


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--url", default="http://127.0.0.1:8000")
    a.add_argument("--model", default="mock-1b")
    a.add_argument("--rate", type=float, default=4.0, help="mean arrivals per second (Poisson)")
    a.add_argument("--requests", type=int, default=40)
    a.add_argument("--prompt-tokens", type=int, default=800)
    a.add_argument("--max-tokens", type=int, default=128)
    a.add_argument("--slo-ttft", type=float, default=1.0)
    a.add_argument("--slo-tpot", type=float, default=0.05)
    a.add_argument("--api-key")
    a.add_argument("--seed", type=int, default=1)
    x = a.parse_args()
    rng = random.Random(x.seed)
    results, threads, lock = [], [], threading.Lock()

    def run():
        try:
            r = one_request(x.url, x.model, x.prompt_tokens, x.max_tokens, x.api_key)
        except Exception as e:
            r = {"error": str(e)}
        with lock:
            results.append(r)

    start = time.perf_counter()
    for _ in range(x.requests):
        t = threading.Thread(target=run); t.start(); threads.append(t)
        time.sleep(rng.expovariate(x.rate))
    for t in threads:
        t.join()
    s = summarize(results, time.perf_counter() - start, x.slo_ttft, x.slo_tpot)
    for k, v in s.items():
        print(f"{k:18s} {v:.3f}" if isinstance(v, float) else f"{k:18s} {v}")


if __name__ == "__main__":
    main()
