"""
DealPilot Backend & Live WebApp Launcher
========================================
Starts the FastAPI server (database from DATABASE_URL, AI via LM Studio or RunPod) on http://localhost:8000

Usage:
    python run_server.py
"""

import sys

import uvicorn

from backend.config import get_settings

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

if __name__ == "__main__":
    env = get_settings()
    port, lm_url = env.port, env.lmstudio_url
    print("=" * 72)
    print(f"🚀 Starting DealPilot Smart SME Server on http://localhost:{port}")
    print(f"   - Live Website UI      : http://localhost:{port}/")
    print(f"   - Interactive API Docs : http://localhost:{port}/docs")
    print(f"   - LM Studio Bridge URL : {lm_url}")
    print("=" * 72)
    # Only this computer can reach the server. Set HOST=0.0.0.0 in .env to open it to the Wi-Fi (e.g. a phone demo).
    uvicorn.run("backend.app:app", host=env.host, port=port, reload=False)
