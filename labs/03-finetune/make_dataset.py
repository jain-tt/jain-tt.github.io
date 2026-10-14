"""Capstone stage 3 data: synthetic travel-support tickets → prompt/completion SFT records, split BY CUSTOMER.

python make_dataset.py --n 600 --out data/
Synthetic on purpose: never put real customer data into a learning lab.
"""
import argparse
import json
import random
from pathlib import Path

ISSUES = [
    ("refund_status", "Where is my refund for booking {ref}? I cancelled {days} days ago.",
     "I'm sorry for the wait. Refunds for cancelled flights are processed within 14 days of cancellation. "
     "Your booking {ref} was cancelled {days} days ago, so {status}. Category: refund_status."),
    ("baggage", "How many bags can I take on booking {ref}?",
     "Economy fares include one 7 kg cabin bag; checked baggage depends on the airline and fare family. "
     "I can check the exact allowance for {ref} with the airline. Category: baggage."),
    ("change_date", "I need to move my flight {ref} to next week.",
     "I can help with a date change for {ref}. Fare differences and airline change fees may apply; "
     "I will confirm the total before anything is changed. Category: change_date."),
]


# [START build]
def make_record(rng: random.Random, customer: str) -> dict:
    kind, q, a = rng.choice(ISSUES)
    ref = f"ALM{rng.randint(100000, 999999)}"
    days = rng.randint(1, 30)
    status = "it should arrive within the next few days" if days < 14 else "it is overdue and I am escalating it now"
    return {"customer": customer, "category": kind,
            "prompt": [{"role": "user", "content": q.format(ref=ref, days=days)}],
            "completion": [{"role": "assistant", "content": a.format(ref=ref, days=days, status=status)}]}
# [END build]


# [START split]
def split_by_customer(records: list[dict], val_frac: float = 0.15, seed: int = 0):
    """All tickets of one customer go to the SAME split. A random row split would leak near-duplicate
    tickets of the same customer into validation and inflate the scores."""
    customers = sorted({r["customer"] for r in records})
    random.Random(seed).shuffle(customers)
    val_c = set(customers[: max(1, int(len(customers) * val_frac))])
    return [r for r in records if r["customer"] not in val_c], [r for r in records if r["customer"] in val_c]
# [END split]


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--n", type=int, default=600)
    a.add_argument("--out", default="data")
    x = a.parse_args()
    rng = random.Random(42)
    recs = [make_record(rng, f"cust{rng.randint(1, 120):03d}") for _ in range(x.n)]
    tr, va = split_by_customer(recs)
    out = Path(x.out); out.mkdir(exist_ok=True)
    for name, rows in (("train", tr), ("val", va)):
        with open(out / f"{name}.jsonl", "w") as f:
            for r in rows:
                f.write(json.dumps({"prompt": r["prompt"], "completion": r["completion"]}) + "\n")
    print(f"train {len(tr)}  val {len(va)}  customers in val: {len({r['customer'] for r in va})}")
