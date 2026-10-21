"""Receipt checks and the AI reply check."""
import json
from unittest import mock

import backend.routes.whatsapp as whatsapp_route
from backend.services.permissions import payee_matches_company
from conftest import OWNER, STAFF


def test_payee_matching():
    company = "Sejuk Jaya Aircond Sdn Bhd"
    assert payee_matches_company("SEJUK JAYA AIRCOND", company)
    assert not payee_matches_company("Ali Trading Enterprise", company)
    assert not payee_matches_company("Jaya Motor", company)


def test_ocr_reads_payee(client):
    r = client.post("/api/ocr/extract", json={"fileName": "DuitNow.pdf",
                                              "pdfText": "DuitNow Transfer: RM 1,650.00 from Restoran Selera Kampung to Ali Trading Enterprise · Ref: DN-77"}).json()
    assert r["extracted"]["payee"] == "Ali Trading Enterprise"


def test_short_receipt_needs_owner(client):
    r = client.post("/api/invoices/INV-205/verify-receipt", json={**STAFF, "decision": "CONFIRM", "paidAmount": 2200}).json()
    assert r["status"] == "pending_approval" and "needs checking" in r["reason"]


def test_wrong_payee_needs_owner_even_for_full_amount(client):
    client.post("/api/bills/apply", json={**STAFF, "kind": "customer", "party": "Restoran Selera Kampung", "ref": "DN-77",
                                          "amount": 1650, "invoiceId": "INV-202", "payee": "Ali Trading Enterprise"})
    r = client.post("/api/invoices/INV-202/verify-receipt", json={**STAFF, "decision": "CONFIRM", "paidAmount": 1650}).json()
    assert r["status"] == "pending_approval" and "paid to 'Ali Trading Enterprise'" in r["reason"]


def test_clean_receipt_staff_verifies(client):
    client.post("/api/bills/apply", json={**STAFF, "kind": "customer", "party": "Klinik Dr. Lim", "ref": "DN-88",
                                          "amount": 4800, "invoiceId": "INV-201", "payee": "Sejuk Jaya Aircond"})
    assert client.post("/api/invoices/INV-201/verify-receipt", json={**STAFF, "decision": "CONFIRM", "paidAmount": 4800}).json()["status"] == "ok"


def fake_ai(analysis):
    content = json.dumps(analysis)
    return mock.patch.object(whatsapp_route, "call_lmstudio_chat",
                             return_value={"clean_content": content, "raw_content": content, "model_used": "fake"})


def test_ai_reply_check(client):
    ai = {
        "intent": "BUYING_INQUIRY",
        "extDraft": "Hi Tan Bros! Total RM 6,650. Deposit RM 2,660 to confirm.",
        "replyOptions": [
            {"label": "1", "text": "5x Daikin + 5x R32 = RM 6,650."},
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


def test_inquiry_holds_only_when_stock_available(client):
    with mock.patch.object(whatsapp_route, "call_lmstudio_chat", side_effect=RuntimeError("LM Studio offline")):
        ok = client.post("/api/whatsapp/analyze", json={**OWNER, "customer": "A", "message": "need 2 units Daikin 1.5HP"}).json()["analysis"]
        too_many = client.post("/api/whatsapp/analyze", json={**OWNER, "customer": "B", "message": "need 20 units Daikin 1.5HP"}).json()["analysis"]
    assert ok["extActionType"] == "CREATE_QUOTE_HOLD"
    assert too_many["extActionType"] == "REPLY_ONLY"
