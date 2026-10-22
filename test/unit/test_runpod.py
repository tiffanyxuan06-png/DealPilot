"""AI provider choice (LM Studio / RunPod), tested against a fake OpenAI-compatible RunPod server."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from backend.services.ai_provider import active_provider
from conftest import OWNER

KEY = "rpa_test_key_123"


class FakeRunPod(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):
        pass

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorised(self):
        return self.headers.get("Authorization") == f"Bearer {KEY}"

    def do_GET(self):
        if not self._authorised():
            return self._send(401, {"error": "bad key"})
        self._send(200, {"data": [{"id": "Qwen/Qwen3-4B"}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeRunPod.calls.append({"path": self.path, "model": body.get("model"), "auth": self.headers.get("Authorization")})
        if not self._authorised():
            return self._send(401, {"error": "bad key"})
        reply = {"intent": "BUYING_INQUIRY", "extDraft": "Hi from RunPod! Total RM 2,300.", "replyOptions": [{"label": "1", "text": "Hi from RunPod! Total RM 2,300."}]}
        self._send(200, {"choices": [{"message": {"content": json.dumps(reply)}}]})


@pytest.fixture
def runpod(monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), FakeRunPod)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    FakeRunPod.calls = []
    monkeypatch.setenv("AI_PROVIDER", "runpod")
    monkeypatch.setenv("RUNPOD_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    monkeypatch.setenv("RUNPOD_API_KEY", KEY)
    monkeypatch.setenv("RUNPOD_MODEL", "Qwen/Qwen3-4B")
    yield server
    server.shutdown()


@pytest.mark.parametrize("env,expected", [
    ({}, "lmstudio"),
    ({"AI_PROVIDER": "runpod", "RUNPOD_API_KEY": "rpa_your_runpod_api_key_here", "RUNPOD_ENDPOINT_ID": "your_runpod_endpoint_id_here"}, "lmstudio"),
    ({"AI_PROVIDER": "runpod", "RUNPOD_API_KEY": KEY}, "lmstudio"),  # no endpoint yet
    ({"AI_PROVIDER": "auto", "RUNPOD_API_KEY": KEY, "RUNPOD_ENDPOINT_ID": "abc123"}, "runpod"),
    ({"AI_PROVIDER": "runpod", "RUNPOD_API_KEY": KEY, "RUNPOD_ENDPOINT_ID": "abc123"}, "runpod"),
])
def test_provider_choice(monkeypatch, env, expected):
    for k in ("AI_PROVIDER", "RUNPOD_API_KEY", "RUNPOD_ENDPOINT_ID", "RUNPOD_BASE_URL"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    assert active_provider() == expected


def test_endpoint_id_builds_runpod_url(monkeypatch):
    monkeypatch.delenv("RUNPOD_BASE_URL", raising=False)
    monkeypatch.setenv("RUNPOD_ENDPOINT_ID", "abc123")
    from backend.services.ai_provider import runpod_base_url

    assert runpod_base_url() == "https://api.runpod.ai/v2/abc123/openai/v1"


def test_analyze_uses_runpod_with_key_and_model(client, runpod):
    r = client.post("/api/whatsapp/analyze", json={**OWNER, "customer": "Tan Bros Trading", "message": "need 2 units Daikin 1.5HP"}).json()
    assert r["source"] == "lmstudio" and "Hi from RunPod! Total RM 2,300." in r["analysis"]["extDraft"]
    call = FakeRunPod.calls[-1]
    assert call["path"] == "/v1/chat/completions" and call["model"] == "Qwen/Qwen3-4B" and call["auth"] == f"Bearer {KEY}"


def test_runpod_key_never_reaches_the_browser(client, runpod):
    state_text = client.get("/api/state").text
    assert KEY not in state_text
    assert json.loads(state_text)["company"]["aiProvider"] == "runpod"
    health = client.get("/api/health").json()
    assert health["aiProvider"] == "runpod" and health["lmstudio"]["connected"] and KEY not in json.dumps(health)


def test_runpod_down_falls_back(client, monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "runpod")
    monkeypatch.setenv("RUNPOD_BASE_URL", "http://127.0.0.1:9/v1")  # nothing listens here
    monkeypatch.setenv("RUNPOD_API_KEY", KEY)
    r = client.post("/api/whatsapp/analyze", json={**OWNER, "customer": "Tan Bros Trading", "message": "need 2 units Daikin 1.5HP"}).json()
    assert r["source"] == "deterministic_fallback" and r["analysis"]["extActionType"] in ("OFFER_QUOTE", "CREATE_QUOTE")
