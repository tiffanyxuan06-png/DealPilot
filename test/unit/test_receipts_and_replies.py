"""The AI reply check: every RM amount in an AI reply must be one DealPilot calculated; threats are blocked.

(Receipt checks were removed with the cash features; this file now covers only the reply check.)
"""
import json
from unittest import mock

import backend.routes.whatsapp as whatsapp_route
from conftest import OWNER


def fake_ai(analysis):
    content = json.dumps(analysis)
    return mock.patch.object(whatsapp_route, "call_lmstudio_chat",
                             return_value={"clean_content": content, "raw_content": content, "model_used": "fake"})


def test_ai_reply_check(client):
    ai = {
        "intent": "BUYING_INQUIRY",
        "extDraft": "Hi Tan Bros! Total RM 6,650. Deposit RM 2,660 to confirm. Subject to stock availability · prices valid 7 days",
        "replyOptions": [
            {"label": "1", "text": "5x Daikin + 5x R32 = RM 6,650. Subject to stock availability · prices valid 7 days"},
            {"label": "2", "text": "Special price boss, RM 5,999 only!"},
            {"label": "3", "text": "Pay RM 6,650 today or we take legal action."},
        ],
        "qty": 9, "amount": 1234,
    }
    with fake_ai(ai):
        r = client.post("/api/whatsapp/analyze", json={**OWNER, "customer": "Tan Bros Trading",
                                                       "message": "Boss, got 5 units Daikin 1.5HP and 5 bottles R32 gas? How much ah?"}).json()
    a = r["analysis"]
    assert r["source"] == "lmstudio"
    assert a["replyOptions"][0]["text"] == ai["replyOptions"][0]["text"]
    assert "5,999" not in a["replyOptions"][1]["text"] and "corrected" in a["replyOptions"][1]["label"]
    assert "legal action" not in a["replyOptions"][2]["text"]
    assert a["extDraft"] == ai["extDraft"]
    assert (a["amount"], a["qty"]) == (6650, 5)  # the quote is priced by code
