"""A stdlib OpenAI-compatible /v1/chat/completions server that STREAMS fake tokens with a realistic
shape: a prefill delay proportional to prompt length, then a fixed inter-token delay, and a single-worker
"GPU" so concurrent requests queue. Lets you practise benchmarking without a GPU.

python mock_openai_server.py --port 8000 --prefill-ms-per-1k 120 --itl-ms 25 --slots 4
"""
import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ARGS = None
SLOTS = None


# [START stream]
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):           # keep stdout quiet
        pass

    def do_GET(self):
        if self.path == "/health":
            self._send(200, b"{}")
        elif self.path == "/v1/models":
            self._send(200, json.dumps({"object": "list", "data": [{"id": "mock-1b", "object": "model"}]}).encode())
        else:
            self._send(404, b"{}")

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        prompt = " ".join(m.get("content", "") for m in body.get("messages", []))
        prompt_tokens = max(1, len(prompt) // 4)                    # rough 4 chars/token for English
        max_tokens = int(body.get("max_tokens") or body.get("max_completion_tokens") or 64)
        with SLOTS:                                                  # queue when all "batch slots" are busy
            time.sleep(prompt_tokens / 1000 * ARGS.prefill_ms_per_1k / 1000)   # prefill
            if not body.get("stream"):
                text = " tok" * max_tokens
                time.sleep(max_tokens * ARGS.itl_ms / 1000)
                return self._send(200, json.dumps({"id": "x", "object": "chat.completion", "choices": [{"index": 0,
                    "message": {"role": "assistant", "content": text}, "finish_reason": "length"}],
                    "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": max_tokens}}).encode())
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            for i in range(max_tokens):
                chunk = {"id": "x", "object": "chat.completion.chunk",
                         "choices": [{"index": 0, "delta": {"content": " tok"}, "finish_reason": None}]}
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode()); self.wfile.flush()
                time.sleep(ARGS.itl_ms / 1000)                       # decode step
            usage = {"id": "x", "object": "chat.completion.chunk", "choices": [],
                     "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": max_tokens}}
            self.wfile.write(f"data: {json.dumps(usage)}\n\ndata: [DONE]\n\n".encode()); self.wfile.flush()
# [END stream]

    def _send(self, code, payload):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    global ARGS, SLOTS
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--prefill-ms-per-1k", type=float, default=120)
    p.add_argument("--itl-ms", type=float, default=25)
    p.add_argument("--slots", type=int, default=4)
    ARGS = p.parse_args()
    SLOTS = threading.Semaphore(ARGS.slots)
    ThreadingHTTPServer(("127.0.0.1", ARGS.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
