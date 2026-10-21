import json
import re
import urllib.request
from typing import Any, Dict, List, Optional
from backend.database import DEFAULT_LMSTUDIO_URL, DEFAULT_LMSTUDIO_API_KEY, DEFAULT_LMSTUDIO_MODEL


def check_lmstudio_health(base_url: str, api_key: str = DEFAULT_LMSTUDIO_API_KEY) -> Dict[str, Any]:
    url = base_url.rstrip("/") + "/models"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models = [m.get("id", "unknown") for m in data.get("data", [])]
            return {"connected": True, "url": base_url, "models": models}
    except Exception as e:
        return {"connected": False, "url": base_url, "models": [], "error": str(e)}


def select_best_lmstudio_model(
    available_models: List[str],
    configured_model: str = "local-model",
    task: str = "text",
) -> str:
    """
    Task-Aware Auto-Routing for LM Studio:
    1. If user set a specific model ID (not 'local-model' or 'auto'), use it.
    2. If task == 'vision' (Receipt OCR), look for 'vl', 'vision', 'llava', 'pixtral'.
    3. If task == 'text', prefer instruct models ('qwen', 'llama', 'mistral', 'deepseek', 'gemma').
    """
    if configured_model and configured_model not in ("local-model", "auto"):
        return configured_model

    if not available_models:
        return configured_model or "local-model"

    chat_models = [
        m for m in available_models
        if not any(emb in m.lower() for emb in ("embed", "nomic-embed", "bge-", "text-embedding"))
    ] or available_models

    if task == "vision":
        vision_keywords = ("vl", "vision", "llava", "pixtral", "minicpm", "gemma-3", "moondream")
        for m in chat_models:
            if any(vk in m.lower() for vk in vision_keywords):
                return m

    text_preferred = ("qwen", "llama", "mistral", "deepseek", "gemma", "phi")
    for m in chat_models:
        if any(tk in m.lower() for tk in text_preferred):
            return m

    return chat_models[0]


def call_lmstudio_chat(
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    api_key: str = DEFAULT_LMSTUDIO_API_KEY,
    timeout: float = 25.0,
) -> Dict[str, Any]:
    health = check_lmstudio_health(base_url, api_key=api_key)
    active_model = select_best_lmstudio_model(
        health.get("models", []), configured_model=model, task="text"
    )

    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": active_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 600,
    }

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw_body = json.loads(resp.read().decode("utf-8"))
        content = raw_body["choices"][0]["message"]["content"]
        clean_content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
        return {
            "connected": True,
            "model_used": active_model,
            "raw_content": content,
            "clean_content": clean_content,
        }


def extract_json_from_llm(text: str) -> Optional[Dict[str, Any]]:
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    candidate = fence_match.group(1) if fence_match else text
    brace_match = re.search(r"(\{.*\})", candidate, flags=re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(1))
        except Exception:
            return None
    return None
