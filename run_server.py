"""
CashChase Backend & Live WebApp Launcher
========================================
Starts the FastAPI + SQLite + LM Studio Bridge server on http://localhost:8000

Usage:
    python run_server.py
"""

import os
import sys

import uvicorn

import backend.env  # noqa: F401  (loads .env so PORT and LM Studio settings apply)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    lm_url = os.getenv("LMSTUDIO_URL") or os.getenv("LMSTUDIO_BASE_URL") or "http://127.0.0.1:1234/v1"
    print("=" * 72)
    print(f"🚀 Starting CashChase Smart SME Server on http://localhost:{port}")
    print(f"   - Live Website UI      : http://localhost:{port}/")
    print(f"   - Interactive API Docs : http://localhost:{port}/docs")
    print(f"   - LM Studio Bridge URL : {lm_url}")
    print("=" * 72)
    # Only this computer can reach the server. Set HOST=0.0.0.0 in .env to open it to the Wi-Fi (e.g. a phone demo).
    host = os.getenv("HOST", "127.0.0.1")
    uvicorn.run("backend.app:app", host=host, port=port, reload=False)
