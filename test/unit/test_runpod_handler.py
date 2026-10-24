"""runpod/handler.py, with a fake model in place of vLLM (no GPU needed)."""
import importlib.util
from pathlib import Path

HANDLER = Path(__file__).resolve().parents[2] / "runpod" / "handler.py"
spec = importlib.util.spec_from_file_location("runpod_handler", HANDLER)
rp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rp)


def fake_chat(calls):
    def chat(messages, max_tokens, temperature):
        calls.append({"messages": messages, "max_tokens": max_tokens, "temperature": temperature})
        return {"text": "Boss, 3 unit ready.", "finish_reason": "stop", "prompt_tokens": 12, "completion_tokens": 5}
    return chat


def test_openai_route_returns_a_chat_completion_the_backend_can_read():
    calls = []
    body = {
        "model": "Qwen/Qwen3-VL-8B-Instruct",
        "messages": [{"role": "system", "content": "sys"}, {"role": "user", "content": "how much?"}],
        "temperature": 0.1,
        "max_tokens": 600,
    }
    res = rp.handler({"input": {"openai_route": "/v1/chat/completions", "openai_input": body}}, chat=fake_chat(calls))
    assert res["choices"][0]["message"]["content"] == "Boss, 3 unit ready."
    assert res["usage"]["total_tokens"] == 17
    assert calls[0]["messages"] == body["messages"]
    assert calls[0]["max_tokens"] == 600


def test_models_route_lists_the_served_model():
    res = rp.handler({"input": {"openai_route": "/v1/models"}}, chat=fake_chat([]))
    assert res["data"][0]["id"] == rp.MODEL_NAME


def test_plain_prompt_gets_the_dealpilot_system_prompt():
    calls = []
    res = rp.handler({"input": {"prompt": "Boss, 3 unit Daikin 1.5HP how much?"}}, chat=fake_chat(calls))
    assert res["output"] == "Boss, 3 unit ready."
    assert calls[0]["messages"][0] == {"role": "system", "content": rp.SYSTEM_PROMPT}
    assert calls[0]["temperature"] == rp.DEFAULT_TEMPERATURE


def test_empty_job_and_unknown_route_return_an_error():
    assert "error" in rp.handler({"input": {}}, chat=fake_chat([]))
    assert "error" in rp.handler({"input": {"openai_route": "/v1/embeddings"}}, chat=fake_chat([]))
