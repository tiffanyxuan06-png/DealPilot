"""DealPilot's RunPod serverless worker: Qwen3-VL-8B-Instruct served with vLLM.

The backend talks to RunPod through the OpenAI-compatible address
(https://api.runpod.ai/v2/<ENDPOINT_ID>/openai/v1/chat/completions). RunPod hands those requests to this handler as
{"input": {"openai_route": "/v1/chat/completions", "openai_input": {...}}}, so backend/services/lmstudio.py works
with this worker unchanged. A plain job also works:
    {"input": {"prompt": "Boss, 3 unit Daikin 1.5HP how much?"}}
    {"input": {"messages": [...], "max_tokens": 600, "temperature": 0.1}}

The model only reads chats and photos and writes wording. Prices are never computed here: the backend's Layer-B
code prices every quote from the SME's own price list.

Settings (RunPod endpoint environment variables):
    MODEL_NAME            default Qwen/Qwen3-VL-8B-Instruct
    MAX_MODEL_LEN         default 16384
    GPU_MEMORY_UTILIZATION default 0.90
"""
import os
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

MODEL_NAME = os.getenv("MODEL_NAME", "Qwen/Qwen3-VL-8B-Instruct")
SYSTEM_PROMPT = (
    "You are DealPilot, a sales assistant for a Malaysian SME. Understand English, Bahasa Melayu and Manglish. "
    "Never invent prices: use only the prices you are given."
)
DEFAULT_MAX_TOKENS = 600
DEFAULT_TEMPERATURE = 0.1

_llm = None  # loaded once per worker, on the first job


def get_llm():
    """Loads the model the first time a job arrives; later jobs on the same worker reuse it."""
    global _llm
    if _llm is None:
        from vllm import LLM

        _llm = LLM(
            model=MODEL_NAME,
            max_model_len=int(os.getenv("MAX_MODEL_LEN", "16384")),
            gpu_memory_utilization=float(os.getenv("GPU_MEMORY_UTILIZATION", "0.90")),
            limit_mm_per_prompt={"image": 2},  # order slips and payment receipts
        )
    return _llm


def vllm_chat(messages: List[Dict[str, Any]], max_tokens: int, temperature: float) -> Dict[str, Any]:
    """Runs one chat on the GPU. Messages use the OpenAI format, including image_url parts for photos."""
    from vllm import SamplingParams

    out = get_llm().chat(messages, SamplingParams(max_tokens=max_tokens, temperature=temperature))[0]
    choice = out.outputs[0]
    return {
        "text": choice.text,
        "finish_reason": choice.finish_reason or "stop",
        "prompt_tokens": len(out.prompt_token_ids or []),
        "completion_tokens": len(choice.token_ids or []),
    }


def build_messages(job_input: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Accepts OpenAI-style messages, or a bare prompt (optionally with a system prompt)."""
    messages = job_input.get("messages")
    if messages:
        return messages
    prompt = str(job_input.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("Send 'messages' or 'prompt'.")
    return [
        {"role": "system", "content": job_input.get("system_prompt") or SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]


def chat_completion(body: Dict[str, Any], chat: Callable = vllm_chat) -> Dict[str, Any]:
    """Answers like OpenAI's /v1/chat/completions, which is what the backend reads."""
    result = chat(
        build_messages(body),
        int(body.get("max_tokens") or DEFAULT_MAX_TOKENS),
        float(body.get("temperature", DEFAULT_TEMPERATURE)),
    )
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": MODEL_NAME,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": result["text"]},
            "finish_reason": result["finish_reason"],
        }],
        "usage": {
            "prompt_tokens": result["prompt_tokens"],
            "completion_tokens": result["completion_tokens"],
            "total_tokens": result["prompt_tokens"] + result["completion_tokens"],
        },
    }


def handler(job: Dict[str, Any], chat: Optional[Callable] = None) -> Dict[str, Any]:
    chat = chat or vllm_chat
    job_input = job.get("input") or {}
    route = job_input.get("openai_route")
    try:
        if route == "/v1/models":
            return {"object": "list", "data": [{"id": MODEL_NAME, "object": "model", "owned_by": "dealpilot"}]}
        if route == "/v1/chat/completions":
            return chat_completion(job_input.get("openai_input") or {}, chat)
        if route:
            return {"error": f"Route {route} is not supported; use /v1/chat/completions."}
        reply = chat_completion(job_input, chat)
        return {"output": reply["choices"][0]["message"]["content"], "usage": reply["usage"]}
    except ValueError as e:
        return {"error": str(e)}


if __name__ == "__main__":
    import runpod

    runpod.serverless.start({"handler": handler})
