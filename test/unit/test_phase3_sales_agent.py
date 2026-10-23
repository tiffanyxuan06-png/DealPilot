"""Unit tests specifically covering Phase 3 Sales Agent features:
- Customer allowlist (NOT_A_CUSTOMER for unknown contacts)
- 8 sales intents, including DISCOUNT_REQUEST
- Price list prompt grounding & quote disclaimer
- WhatsApp button deal execution (CREATE_QUOTE, SEND_FOLLOW_UP, MARK_WON, MARK_LOST, LOG_COMPLAINT)
- Photo -> Quote editable items response
- Privacy fix: CASUAL_CHAT does not save memory
- Strict AI mode (rejects fallback when LM Studio offline)
"""
import pytest
from conftest import OWNER, STAFF


def test_customer_allowlist_unknown_contact(client):
    r = client.post("/api/whatsapp/analyze", json={
        **STAFF,
        "customer": "Unknown Walk In",
        "message": "Hi boss, how much is aircond?",
        "strictAi": False,
    }).json()
    assert r["analysis"]["intent"] == "NOT_A_CUSTOMER"
    assert r["analysis"]["isCustomer"] is False
    assert "Add as customer" in r["analysis"]["extBtnLabel"]


def test_discount_request_intent_and_counter_offers(client):
    r = client.post("/api/whatsapp/analyze", json={
        **STAFF,
        "customer": "Restoran Selera Kampung",
        "message": "Boss, got discount or best price for 2 units Daikin 1.5HP?",
        "strictAi": False,
    }).json()
    a = r["analysis"]
    assert a["intent"] == "DISCOUNT_REQUEST"
    assert "Free Delivery" in a["extCheck"] or "Counter-Offer" in a["extCheck"] or "free" in a["extDraft"].lower()
    assert "prices valid 7 days" in a["extDraft"]
    assert a["amount"] == 2 * 1150


def test_buying_inquiry_has_disclaimer(client):
    r = client.post("/api/whatsapp/analyze", json={
        **STAFF,
        "customer": "Kedai Runcit Ah Seng",
        "message": "Boss, need 2 units Daikin 1.5HP and 1 bottle R32 gas",
        "strictAi": False,
    }).json()
    a = r["analysis"]
    assert a["intent"] == "BUYING_INQUIRY"
    assert "Subject to stock availability" in a["extDraft"]
    assert a["amount"] == 2 * 1150 + 180


def test_privacy_fix_casual_chat_not_saved_in_memories(client):
    # Register customer first
    client.post("/api/customers", json={**STAFF, "name": "Random Friend", "phone": "+60123459999"})
    # Customer sends personal message
    r = client.post("/api/whatsapp/analyze", json={
        **STAFF,
        "customer": "Random Friend",
        "message": "Bro, free for teh tarik later?",
        "strictAi": False,
    }).json()
    assert r["analysis"]["intent"] == "CASUAL_CHAT"
    # Verify not in clientMemories
    mem_check = client.get("/api/client/memory", params={"customer": "Random Friend"}).json()
    assert mem_check["isNew"] is True and mem_check["totalOrders"] == 0


def test_strict_ai_mode_rejects_offline_fallback(client, monkeypatch):
    monkeypatch.setenv("CASHCHASE_STRICT_AI", "1")
    monkeypatch.setenv("LMSTUDIO_URL", "http://127.0.0.1:9/v1")
    # Calling analyze with strictAi=True when LM Studio is down raises 503
    r = client.post("/api/whatsapp/analyze", json={
        **STAFF,
        "customer": "Kedai Runcit Ah Seng",
        "message": "need 2 units Daikin 1.5HP",
        "strictAi": True,
    })
    assert r.status_code == 503
    assert "Strict AI mode is ON" in r.json()["detail"]


def test_whatsapp_execute_create_quote_needs_an_item(client):
    """No items and no sku is a 400, not a silent ACN-DAI-15 x1 quote."""
    before = len(client.get("/api/state", params={"role": "STAFF"}).json()["deals"])
    r = client.post("/api/whatsapp/execute", json={**STAFF, "customer": "Hotel Grand Malaya", "actionType": "CREATE_QUOTE"})
    assert r.status_code == 400 and r.json()["detail"] == "Add at least one item to quote."
    assert len(client.get("/api/state", params={"role": "STAFF"}).json()["deals"]) == before
    ok = client.post("/api/whatsapp/execute", json={**STAFF, "customer": "Hotel Grand Malaya", "actionType": "CREATE_QUOTE",
                                                    "items": [{"sku": "GAS-R32", "qty": 2}]})
    assert ok.status_code == 200 and ok.json()["createdDealId"].startswith("QT-")


def test_whatsapp_execute_deal_lifecycle(client):
    # 1. Create Quote Deal via WhatsApp button
    r1 = client.post("/api/whatsapp/execute", json={
        **STAFF,
        "customer": "Hotel Grand Malaya",
        "actionType": "CREATE_QUOTE",
        "sku": "ACN-DAI-15",
        "qty": 3,
    }).json()
    assert r1["status"] == "ok"
    deal_id = r1.get("createdDealId") or r1.get("createdId")
    assert deal_id.startswith("QT-")

    # 2. Send follow-up via WhatsApp button
    r2 = client.post("/api/whatsapp/execute", json={
        **STAFF,
        "customer": "Hotel Grand Malaya",
        "dealId": deal_id,
        "actionType": "SEND_FOLLOW_UP",
    }).json()
    assert r2["status"] == "ok"
    d2 = next(d for d in r2["state"]["deals"] if d["id"] == deal_id)
    assert d2["followUpCount"] == 1

    # 3. Mark Won with slip reference via WhatsApp button
    r3 = client.post("/api/whatsapp/execute", json={
        **STAFF,
        "customer": "Hotel Grand Malaya",
        "dealId": deal_id,
        "actionType": "MARK_WON",
        "depositRef": "DN-20261022-8877",
        "depositAmount": 3450,
    }).json()
    assert r3["status"] == "ok"
    d3 = next(d for d in r3["state"]["deals"] if d["id"] == deal_id)
    assert d3["stage"] == "WON"
    assert d3["depositRef"] == "DN-20261022-8877"
    assert d3["depositAmount"] == 3450


def test_customer_declined_defaults_loss_reason(client):
    r1 = client.post("/api/deals", json={
        **STAFF,
        "customer": "Pelanggan Batal",
        "items": [{"sku": "GAS-R32", "qty": 1}],
    }).json()
    deal_id = r1["createdId"]

    # Mark lost without explicit reason
    r2 = client.post("/api/whatsapp/execute", json={
        **STAFF,
        "customer": "Pelanggan Batal",
        "dealId": deal_id,
        "actionType": "MARK_LOST",
    }).json()
    assert r2["status"] == "ok"
    d = next(d for d in r2["state"]["deals"] if d["id"] == deal_id)
    assert d["stage"] == "LOST"
    assert d["lossReason"] == "Customer declined on WhatsApp"


def test_complaint_pauses_deal(client):
    r1 = client.post("/api/deals", json={
        **STAFF,
        "customer": "Restoran Bocor",
        "items": [{"sku": "GAS-R32", "qty": 1}],
    }).json()
    deal_id = r1["createdId"]

    r2 = client.post("/api/whatsapp/execute", json={
        **STAFF,
        "customer": "Restoran Bocor",
        "dealId": deal_id,
        "actionType": "LOG_COMPLAINT",
        "note": "R32 gas cylinder nozzle leaking",
    }).json()
    assert r2["status"] == "ok"
    d = next(d for d in r2["state"]["deals"] if d["id"] == deal_id)
    assert d["paused"] is True
    assert "nozzle leaking" in d["notes"]


def test_photo_quote_extracts_editable_items(client):
    client.post("/api/customers", json={**STAFF, "name": "Bengkel Ah Hock"})  # photos are only read for customers
    payload = {
        "fileName": "order_daikin_r32.jpg",
        "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        "customer": "Bengkel Ah Hock",
    }
    r = client.post("/api/whatsapp/photo-quote", json=payload).json()
    assert r["status"] == "extracted"
    assert r["editable"] is True
    assert len(r["items"]) >= 1
    first = r["items"][0]
    assert "sku" in first and "unitPrice" in first and "lineTotal" in first
    assert r["subtotal"] > 0
    assert "prices valid 7 days" in r["disclaimer"]


def test_quote_picks_only_the_named_model(client):
    # "Daikin 1.5HP" is that one unit, not every Daikin and every 1.5HP; each quantity stays with its item
    r = client.post("/api/whatsapp/analyze", json={
        **STAFF,
        "customer": "Tan Bros Trading",
        "message": "Boss, need 3 units Panasonic 1.0HP and 2 copper pipe",
        "strictAi": False,
    }).json()
    a = r["analysis"]
    assert a["amount"] == 3 * 980 + 2 * 150
    assert a["qty"] == 3
