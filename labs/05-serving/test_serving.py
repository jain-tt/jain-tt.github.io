import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from bench_client import one_request, summarize

HERE = Path(__file__).parent


def test_mock_server_and_bench():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    p = subprocess.Popen([sys.executable, str(HERE / "mock_openai_server.py"), "--port", str(port), "--itl-ms", "5",
                          "--prefill-ms-per-1k", "200", "--slots", "2"])
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/health"); break
            except OSError:
                time.sleep(0.1)
        r = one_request(f"http://127.0.0.1:{port}", "mock-1b", 1000, 20)
        assert r["tokens"] == 20
        assert r["ttft"] >= 0.2                                  # 1,000 prompt tokens × 200 ms per 1k
        assert 0.004 <= r["tpot"] < 0.05
        s = summarize([r, r, {"error": "x"}], 1.0, slo_ttft=1.0, slo_tpot=0.05)
        assert s["errors"] == 1 and s["goodput_req_s"] == 2.0
    finally:
        p.kill()
