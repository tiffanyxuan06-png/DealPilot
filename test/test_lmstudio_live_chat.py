"""
Interactive LM Studio + WhatsApp Extension Prompt Tester
=========================================================
Location: /test/test_lmstudio_live_chat.py

Use this script to test sending custom WhatsApp messages through your local
LM Studio server (http://127.0.0.1:1234/v1) and see:
- The exact system prompt injected (Live Stock + Owner Custom Labor Rules)
- The raw output from your LM Studio model
- The parsed 1-Big-Button extension card & WhatsApp draft reply

Usage:
    python test/test_lmstudio_live_chat.py
    python test/test_lmstudio_live_chat.py "Boss how much for 3 units Daikin 1.5HP with installation?"
"""

import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from fastapi.testclient import TestClient
from backend.app import app, check_lmstudio_health, DEFAULT_LMSTUDIO_URL

client = TestClient(app)


def test_single_message(message: str, customer: str = "Tan Bros Trading") -> None:
    print("\n" + "-" * 76)
    print(f"💬 Testing WhatsApp Message from [{customer}]:")
    print(f"   \"{message}\"")
    print("-" * 76)

    res = client.post(
        "/api/whatsapp/analyze",
        json={
            "customer": customer,
            "phone": "+60 12-345 6789",
            "message": message,
            "role": "OWNER",
        },
    )
    data = res.json()
    print(f"🔌 LM Studio Connected : {data.get('lmstudio_connected')} (Source: {data.get('source')})")
    if data.get("model_used"):
        print(f"🤖 LM Studio Model     : {data.get('model_used')}")
    if data.get("lmstudio_error"):
        print(f"⚠️ LM Studio Note      : {data.get('lmstudio_error')}")

    print("\n📦 [PARSED WHATSAPP SIDEBAR EXTENSION PAYLOAD]:")
    print(json.dumps(data.get("analysis", {}), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    health = check_lmstudio_health(DEFAULT_LMSTUDIO_URL)
    print("=" * 76)
    print(f"LM Studio Status at {DEFAULT_LMSTUDIO_URL}: {'🟢 ONLINE' if health['connected'] else '🟡 OFFLINE (Fallback Active)'}")
    if health["models"]:
        print(f"Loaded Models: {', '.join(health['models'])}")
    print("=" * 76)

    if len(sys.argv) > 1:
        custom_msg = " ".join(sys.argv[1:])
        test_single_message(custom_msg)
    else:
        sample_messages = [
            ("Tan Bros Trading", "Boss, got 4 units Daikin 1.5HP and 2 bottles R32 gas? Include installation please."),
            ("Klinik Dr. Lim", "Boss, 1 bottle R32 gas from INV-201 valve leaking la. Can replace?"),
            ("Wisma Perdana", "Boss I already bank in RM 2,000 deposit via DuitNow Ref DN-88219."),
        ]
        for cust, msg in sample_messages:
            test_single_message(msg, cust)
