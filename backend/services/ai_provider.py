"""Which AI server CashChase talks to: LM Studio on the laptop, or a RunPod serverless vLLM endpoint.

Both speak the OpenAI chat API, so only the address, key and model change. Chosen with AI_PROVIDER in .env:
  lmstudio (default) · runpod · auto (RunPod when its key and endpoint are filled in, else LM Studio)
The RunPod key stays on the server; it is never sent to the WebApp or the extension.
"""
import os
from typing import Dict


def _env(name: str) -> str:
    """Empty for unset values and for the placeholders in .env.example (e.g. 'your_runpod_endpoint_id_here')."""
    value = (os.getenv(name) or "").strip()
    return "" if (not value or "your_" in value) else value


def runpod_base_url() -> str:
    explicit = _env("RUNPOD_BASE_URL")
    if explicit:
        return explicit.rstrip("/")
    endpoint = _env("RUNPOD_ENDPOINT_ID")
    return f"https://api.runpod.ai/v2/{endpoint}/openai/v1" if endpoint else ""


def runpod_ready() -> bool:
    return bool(_env("RUNPOD_API_KEY") and runpod_base_url())


def active_provider() -> str:
    choice = (os.getenv("AI_PROVIDER") or "lmstudio").strip().lower()
    if choice == "runpod":
        return "runpod" if runpod_ready() else "lmstudio"  # half-filled RunPod settings fall back to LM Studio
    if choice == "auto":
        return "runpod" if runpod_ready() else "lmstudio"
    return "lmstudio"


def runpod_credentials() -> Dict[str, str]:
    return {
        "provider": "runpod",
        "base_url": runpod_base_url(),
        "api_key": _env("RUNPOD_API_KEY"),
        "model": _env("RUNPOD_MODEL") or "local-model",
        "vision_model": _env("RUNPOD_VISION_MODEL") or "auto",
    }
