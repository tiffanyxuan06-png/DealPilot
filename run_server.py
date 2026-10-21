"""
CashChase Backend & Live WebApp Launcher
========================================
Starts the FastAPI + SQLite + LM Studio Bridge server on http://localhost:8000

Usage:
    python run_server.py
"""

import sys
import uvicorn

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

if __name__ == "__main__":
    print("=" * 72)
    print("🚀 Starting CashChase Smart SME Server on http://localhost:8000")
    print("   - Live Website UI      : http://localhost:8000/")
    print("   - Interactive API Docs : http://localhost:8000/docs")
    print("   - LM Studio Bridge URL : http://127.0.0.1:1234/v1")
    print("=" * 72)
    uvicorn.run("backend.app:app", host="0.0.0.0", port=8000, reload=False)
