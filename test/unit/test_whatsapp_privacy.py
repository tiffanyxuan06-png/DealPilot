"""Privacy gate on /api/whatsapp/analyze and photo-quote (docs/11 §4.1).

Strangers never reach the AI or client_memories; customers' casual chat is never remembered.
The allowlist reply, the casual-chat-not-saved basics and the strict-AI 503 are first checked in
test_phase3_sales_agent.py; this file adds the AI-call, database and activity-log proof.
"""
import json
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from conftest import OWNER, STAFF

from backend.db import orm, session_scope

STRANGER = "Zed Stranger"
CASUAL = "haha ok see you tonight bro"
SECRET = "my IC is 900101-14-5555 do not tell anyone"
BUYING = "Boss, need 2 units Daikin 1.5HP and 1 bottle R32 gas"


@pytest.fixture
def ai(monkeypatch):
    """Every way out to a model: the chat call (LM Studio and RunPod share it) and raw HTTP (vision). Counts both."""
    chat = MagicMock(side_effect=ConnectionError("AI offline in tests"))
    http = MagicMock(side_effect=OSError("network blocked in tests"))
    monkeypatch.setattr("backend.routes.whatsapp.call_lmstudio_chat", chat)
    monkeypatch.setattr("backend.services.lmstudio.call_lmstudio_chat", chat)
    monkeypatch.setattr("urllib.request.urlopen", http)
    chat.http = http
    return chat


def analyze(client, customer, message, phone=""):
    r = client.post("/api/whatsapp/analyze", json={**STAFF, "customer": customer, "phone": phone, "message": message, "strictAi": False})
    assert r.status_code == 200, r.text
    return r.json()["analysis"]


def memory_rows():
    with session_scope() as s:
        return {m.customer: m.last_message for m in s.scalars(select(orm.ClientMemory))}


def audit_text():
    with session_scope() as s:
        return "\n".join(e.entry for e in s.scalars(select(orm.AuditLog)))


def add_customer(client, name, phone="+60123450001"):
    assert client.post("/api/customers", json={**STAFF, "name": name, "phone": phone}).status_code == 200


def test_non_customer_gets_no_ai_no_memory_no_log(client, ai):
    before = memory_rows()
    a = analyze(client, STRANGER, SECRET, phone="+60199990000")
    assert a["intent"] == "NOT_A_CUSTOMER"
    assert ai.call_count == 0 and ai.http.call_count == 0
    assert memory_rows() == before
    assert STRANGER not in memory_rows()
    assert "900101" not in audit_text()


def test_non_customer_photo_never_reaches_the_ai(client, ai):
    r = client.post("/api/whatsapp/photo-quote", json={
        **STAFF, "customer": STRANGER, "fileName": "slip.jpg", "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    })
    assert r.status_code == 200
    assert r.json()["analysis"]["intent"] == "NOT_A_CUSTOMER"
    assert r.json()["items"] == []
    assert ai.call_count == 0 and ai.http.call_count == 0


@pytest.mark.parametrize("message", [CASUAL, "happy birthday!"])
def test_customer_casual_chat_is_not_remembered(client, ai, message):
    add_customer(client, "Casual Carl")
    a = analyze(client, "Casual Carl", message)
    assert a["intent"] == "CASUAL_CHAT"
    assert "Casual Carl" not in memory_rows()


def test_customer_casual_chat_leaves_existing_memory_unchanged(client, ai):
    add_customer(client, "Casual Carl")
    analyze(client, "Casual Carl", BUYING)
    saved = memory_rows()["Casual Carl"]
    analyze(client, "Casual Carl", CASUAL)
    assert memory_rows()["Casual Carl"] == saved


@pytest.mark.parametrize("ai_intent", ["BUYING_INQUIRY", "PRODUCT_CONSULTATION", "DISCOUNT_REQUEST"])
def test_ai_cannot_turn_casual_chat_into_a_remembered_intent(client, ai, ai_intent):
    """If the model labels a casual message as something else, code still decides: casual, nothing saved."""
    add_customer(client, "Casual Carl")
    reply = {"intent": ai_intent, "extActionType": "CREATE_QUOTE", "extDraft": "Sure boss"}
    ai.side_effect = None
    ai.return_value = {"clean_content": json.dumps(reply), "raw_content": json.dumps(reply), "model_used": "fake"}
    a = analyze(client, "Casual Carl", CASUAL)
    assert ai.call_count == 1
    assert a["intent"] == "CASUAL_CHAT" and a["extActionType"] == "NO_ACTION"
    assert "Casual Carl" not in memory_rows()


def test_customer_buying_message_is_remembered(client, ai):
    """Proves the gate, not a broken save: a real buying message from a customer does write memory."""
    add_customer(client, "Buyer Bob")
    a = analyze(client, "Buyer Bob", BUYING)
    assert a["intent"] == "BUYING_INQUIRY"
    assert ai.call_count == 1
    assert memory_rows()["Buyer Bob"] == BUYING


def test_memory_lookup_for_a_stranger_creates_nothing(client, ai):
    before = memory_rows()
    r = client.get("/api/client/memory", params={"customer": STRANGER, "phone": "+60199990000"})
    assert r.status_code == 200 and r.json()["isNew"] is True
    assert memory_rows() == before


def test_adding_the_contact_unlocks_normal_analysis(client, ai):
    assert analyze(client, STRANGER, BUYING)["intent"] == "NOT_A_CUSTOMER"
    assert STRANGER not in memory_rows() and ai.call_count == 0
    add_customer(client, STRANGER, phone="+60199990000")
    a = analyze(client, STRANGER, BUYING, phone="+60199990000")
    assert a["intent"] == "BUYING_INQUIRY" and a.get("isCustomer") is not False
    assert ai.call_count == 1
    assert memory_rows()[STRANGER] == BUYING


@pytest.mark.parametrize("message", [
    "boss got stock for daikin later? how much",
    "I will call you later about the aircond price",
    "lepak makan dulu, harga aircond berapa",
])
def test_loose_casual_words_next_to_a_business_word_are_still_an_inquiry(client, ai, message):
    add_customer(client, "Mixed Mei")
    a = analyze(client, "Mixed Mei", message)
    assert a["intent"] != "CASUAL_CHAT"
    assert memory_rows()["Mixed Mei"] == message


def test_pure_casual_chat_stays_casual_and_unsaved(client, ai):
    add_customer(client, "Mixed Mei")
    for message in ("jom makan later bro", "happy birthday!"):
        assert analyze(client, "Mixed Mei", message)["intent"] == "CASUAL_CHAT"
    assert "Mixed Mei" not in memory_rows()


def test_casual_chat_clears_ai_supplied_quote(client, ai):
    add_customer(client, "Casual Carl")
    reply = {"intent": "CASUAL_CHAT", "amount": 999, "items": [{"sku": "X", "qty": 1}]}
    ai.side_effect = None
    ai.return_value = {"clean_content": json.dumps(reply), "raw_content": json.dumps(reply), "model_used": "fake"}
    a = analyze(client, "Casual Carl", CASUAL)
    assert a["amount"] == 0 and a["items"] == []


def test_phone_match_needs_a_whole_number_not_a_fragment(client, ai):
    add_customer(client, "Short Sam", phone="12")
    assert analyze(client, "Stranger X", BUYING, phone="+60199123456")["intent"] == "NOT_A_CUSTOMER"
    add_customer(client, "Long Lee", phone="0123456789")
    for phone in ("+60 12-345 6789", "60123456789"):
        assert analyze(client, "Unsaved Name", BUYING, phone=phone)["intent"] != "NOT_A_CUSTOMER"
    assert analyze(client, "Unsaved Name", BUYING, phone="+60 12-999 9999")["intent"] == "NOT_A_CUSTOMER"


def test_unreadable_photo_from_a_customer_returns_the_retry_prompt(client, ai, monkeypatch):
    add_customer(client, "Photo Pat")
    monkeypatch.setattr("backend.routes.whatsapp.extract_items_from_image", lambda *a, **k: {"success": False, "items": []})
    r = client.post("/api/whatsapp/photo-quote", json={
        **STAFF, "customer": "Photo Pat", "fileName": "slip.jpg", "imageBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    })
    assert r.status_code == 200
    assert r.json()["status"] == "unreadable"
    assert r.json()["analysis"]["intent"] == "CASUAL_CHAT"
    assert "Couldn't read the photo" in r.json()["analysis"]["extTitle"]


@pytest.mark.parametrize("action", ["REPLY_ONLY", "NO_ACTION", "OFFER_QUOTE", "LOG_COMPLAINT"])
def test_execute_for_a_stranger_logs_and_saves_nothing(client, ai, action):
    r = client.post("/api/whatsapp/execute", json={**STAFF, "customer": STRANGER, "actionType": action, "note": "secret complaint text"})
    assert r.status_code == 200
    assert STRANGER not in audit_text() and "secret complaint" not in audit_text()
    assert STRANGER not in memory_rows()


@pytest.mark.parametrize("message", [
    "ok see you, coaching later",
    "see you at the factory, thanks for the ask",
    "lepak later, bring the setup",
    "tomorrow at the pack and go",
    "happy birthday, I'm back",
])
def test_short_business_words_inside_other_words_stay_casual(client, ai, message):
    add_customer(client, "Word Wan")
    assert analyze(client, "Word Wan", message)["intent"] == "CASUAL_CHAT"
    assert "Word Wan" not in memory_rows()


@pytest.mark.parametrize("message", [
    "boss got stock daikin later? how much",
    "need 2 unit ac 1.5hp",
    "gas r32 how much",
])
def test_short_business_words_as_whole_words_are_business(client, ai, message):
    add_customer(client, "Word Wan")
    assert analyze(client, "Word Wan", message)["intent"] != "CASUAL_CHAT"
    assert memory_rows()["Word Wan"] == message


def test_execute_for_a_customer_is_still_logged(client, ai):
    add_customer(client, "Buyer Bob")
    client.post("/api/whatsapp/execute", json={**STAFF, "customer": "Buyer Bob", "actionType": "REPLY_ONLY"})
    assert "Buyer Bob" in audit_text()


# Chats titled by phone number (contact not saved in WhatsApp) must resolve to the stored customer.
TAN = "Tan Bros Trading"
TAN_PHONE = "+60 12-345 6789"


def memory_row(name):
    with session_scope() as s:
        row = s.get(orm.ClientMemory, name)
        return row and (row.tier, row.phone, row.last_message)


@pytest.mark.parametrize("title, phone", [
    (TAN_PHONE, "60123456789"),
    (TAN_PHONE, "0123456789"),
    ("0123456789", "0123456789"),
])
def test_phone_titled_chat_updates_the_stored_customers_memory(client, ai, title, phone):
    tier = memory_row(TAN)[0]
    a = analyze(client, title, BUYING, phone=phone)
    assert a["intent"] == "BUYING_INQUIRY"
    assert a["clientMemory"]["tier"] == tier != "NEW_CLIENT"
    assert set(memory_rows()) - {TAN, "Klinik Dr. Lim", "Kedai Runcit Ah Seng", "Wisma Perdana Sdn Bhd"} == set()
    assert memory_row(TAN) == (tier, TAN_PHONE, BUYING)


def test_name_titled_chat_still_updates_the_same_row(client, ai):
    tier = memory_row(TAN)[0]
    a = analyze(client, TAN, BUYING, phone=TAN_PHONE)
    assert a["clientMemory"]["tier"] == tier
    assert memory_row(TAN) == (tier, TAN_PHONE, BUYING)


def test_phone_titled_chat_finds_the_open_deal(client, ai):
    """Klinik Dr. Lim has an open quote: the sales stage must match the name-titled chat, and execute must not 404."""
    by_name = analyze(client, "Klinik Dr. Lim", "can you give discount", phone="")
    by_phone = analyze(client, "+60 16-882 1920", "can you give discount", phone="60168821920")
    for key in ("stage", "intent", "extActionType"):
        assert by_phone[key] == by_name[key]
    assert by_phone["clientMemory"]["tier"] == by_name["clientMemory"]["tier"] != "NEW_CLIENT"
    r = client.post("/api/whatsapp/execute", json={
        **OWNER, "customer": "+60 16-882 1920", "phone": "60168821920", "actionType": "SEND_FOLLOW_UP",
    })
    assert r.status_code == 200, r.text
    assert "Klinik Dr. Lim" in audit_text()


def test_unmatched_number_stays_a_stranger(client, ai):
    before = memory_rows()
    a = analyze(client, "+60 12-999 9999", BUYING, phone="60129999999")
    assert a["intent"] == "NOT_A_CUSTOMER"
    assert memory_rows() == before


def test_name_titled_chat_never_borrows_another_customers_number(client, ai):
    """A has no phone, B owns number X. A chat titled A's name that carries X updates A only."""
    add_customer(client, "Alpha Ang", phone="")
    add_customer(client, "Beta Boon", phone="+60 12-777 0001")
    analyze(client, "Beta Boon", "Boss, need 1 bottle R32 gas", phone="+60 12-777 0001")
    beta = memory_row("Beta Boon")
    analyze(client, "Alpha Ang", BUYING, phone="60127770001")
    assert memory_row("Beta Boon") == beta
    assert memory_row("Alpha Ang") == ("NEW_CLIENT", "", BUYING)


def test_memory_lookup_only_rates_registered_customers(client, ai):
    with session_scope() as s:
        s.add(orm.ClientMemory(customer="Ghost Gus", phone="+60 11-111 2222", tier="VIP_FAST_PAYER", score=99, style_summary="",
                               payment_behavior="", total_orders=9, total_paid_rm=9999, last_message="", recent_history_json="[]",
                               cached_analysis_json="", updated_at=""))
    probe = client.get("/api/client/memory", params={"customer": "Someone Else", "phone": "60111112222"}).json()
    assert probe["tier"] == "NEW_CLIENT" and probe["totalPaidRm"] == 0
    stranger = analyze(client, "Someone Else", BUYING, phone="60111112222")
    assert stranger["intent"] == "NOT_A_CUSTOMER" and stranger["clientMemory"]["tier"] == "NEW_CLIENT"
    real = client.get("/api/client/memory", params={"customer": TAN_PHONE, "phone": "60123456789"}).json()
    assert real["tier"] == memory_row(TAN)[0] and real["customer"] == TAN
