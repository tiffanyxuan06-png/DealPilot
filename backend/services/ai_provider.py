"""Which AI server DealPilot talks to: LM Studio on the laptop, or a RunPod serverless vLLM endpoint.

Both speak the OpenAI chat API, so only the address, key and model change. Chosen with AI_PROVIDER in .env:
  lmstudio (default) · runpod · auto (RunPod when its key and endpoint are filled in, else LM Studio)
The RunPod key stays on the server; it is never sent to the WebApp or the extension.
"""
from typing import Dict

from backend.config import get_settings


def runpod_base_url() -> str:
    env = get_settings()
    if env.runpod_base_url:
        return env.runpod_base_url.rstrip("/")
    return f"https://api.runpod.ai/v2/{env.runpod_endpoint_id}/openai/v1" if env.runpod_endpoint_id else ""


def runpod_ready() -> bool:
    return bool(get_settings().runpod_api_key and runpod_base_url())


def active_provider() -> str:
    choice = get_settings().ai_provider
    if choice in ("runpod", "auto"):
        return "runpod" if runpod_ready() else "lmstudio"  # half-filled RunPod settings fall back to LM Studio
    return "lmstudio"


def runpod_credentials() -> Dict[str, str]:
    env = get_settings()
    return {
        "provider": "runpod",
        "base_url": runpod_base_url(),
        "api_key": env.runpod_api_key,
        "model": env.runpod_model or "local-model",
        "vision_model": env.runpod_vision_model or "auto",
    }
