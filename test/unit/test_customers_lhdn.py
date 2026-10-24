"""Customer records and LHDN e-Invoice TIN handling."""
from unittest import mock

import backend.routes.whatsapp as whatsapp_route
from backend.services.customers import parse_ssm, parse_tin
from conftest import OWNER, STAFF


def customer(state, name):
    return next((c for c in state["customers"] if c["name"] == name), None)


def offline_ai():
    return mock.patch.object(whatsapp_route, "call_lmstudio_chat", side_effect=RuntimeError("LM Studio offline"))


def test_parse_tin_and_ssm():
    assert parse_tin("ok boss my TIN is c 2588190021 ya") == "C2588190021"
    assert parse_tin("call me 0123456789") is None
    assert parse_tin("ref DN-20261117-88412") is None
    assert parse_ssm("SSM 202401009921") == "202401009921"


def test_customers_seeded_with_tins(client):
    s = client.get("/api/state?role=OWNER").json()
    assert customer(s, "Restoran Selera Kampung")["tin"] == "C20449102"
    ah_seng = customer(s, "Kedai Runcit Ah Seng")
    assert ah_seng["tin"] == "" and "LHDN e-Invoicing" in ah_seng["tinRequestText"]


def test_missing_tin_adds_ask_for_tin_reply(client):
    with offline_ai():
        a = client.post("/api/whatsapp/analyze", json={**STAFF, "customer": "Kedai Runcit Ah Seng", "message": "need 2 units Daikin 1.5HP"}).json()["analysis"]
        b = client.post("/api/whatsapp/analyze", json={**STAFF, "customer": "Restoran Selera Kampung", "message": "need 2 units Daikin 1.5HP"}).json()["analysis"]
    assert any("LHDN" in o["label"] for o in a["replyOptions"])
    assert not any("LHDN" in o["label"] for o in b["replyOptions"])


def test_customer_sends_tin_on_whatsapp(client):
    with offline_ai():
        a = client.post("/api/whatsapp/analyze", json={**STAFF, "customer": "Kedai Runcit Ah Seng",
                                                       "message": "Ok boss, TIN C2588190021, SSM 202401009921"}).json()["analysis"]
    assert (a["intent"], a["extActionType"], a["tin"], a["ssmBrn"]) == ("SAVE_LHDN_TIN", "SAVE_LHDN_TIN", "C2588190021", "202401009921")
    r = client.post("/api/whatsapp/execute", json={**OWNER, "customer": "Kedai Runcit Ah Seng", "actionType": "SAVE_LHDN_TIN",
                                                   "tin": a["tin"], "ssmBrn": a["ssmBrn"]}).json()
    s = r["state"]
    assert customer(s, "Kedai Runcit Ah Seng")["tin"] == "C2588190021"
    assert any("Saved LHDN TIN C2588190021" in line for line in s["logs"])


def test_bad_tin_rejected(client):
    r = client.post("/api/whatsapp/execute", json={**OWNER, "customer": "X", "actionType": "SAVE_LHDN_TIN", "tin": "hello"})
    assert r.status_code == 400
