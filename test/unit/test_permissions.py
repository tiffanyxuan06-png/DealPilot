"""Owner-controlled Staff permissions, the approval queue and the mandatory safety rules."""
import sqlite3

import pytest

import backend.database as database
from conftest import OWNER, STAFF, invoice


def test_missing_role_is_staff(client):
    assert client.post("/api/reset").status_code == 403
    assert client.post("/api/reset", json=OWNER).status_code == 200


def test_staff_routine_action_runs(client):
    r = client.post("/api/invoices/INV-202/action", json={**STAFF, "action": "MARK_PAID"})
    assert r.status_code == 200 and invoice(r.json()["state"], "INV-202")["status"] == "PAID"


def test_staff_discount_goes_to_owner_and_runs_on_approval(client):
    r = client.post("/api/invoices/INV-201/action", json={**STAFF, "action": "DISCOUNT", "amount": 180}).json()
    assert r["status"] == "pending_approval"
    assert invoice(r["state"], "INV-201")["amount"] == 4800  # nothing changed yet
    ap = r["approvalId"]
    assert client.post(f"/api/approvals/{ap}/decide", json={**STAFF, "decision": "APPROVE"}).status_code == 403
    s = client.post(f"/api/approvals/{ap}/decide", json={**OWNER, "decision": "APPROVE"}).json()["state"]
    assert invoice(s, "INV-201")["amount"] == 4620
    assert client.post(f"/api/approvals/{ap}/decide", json={**OWNER, "decision": "APPROVE"}).status_code == 409


def test_rejected_request_changes_nothing(client):
    r = client.post("/api/invoices/SUP-881/action", json={**STAFF, "action": "PAY_SUPPLIER"}).json()
    assert r["status"] == "pending_approval" and "threshold" in r["reason"]  # RM 1,500 > RM 1,000
    s = client.post(f"/api/approvals/{r['approvalId']}/decide", json={**OWNER, "decision": "REJECT", "note": "next week"}).json()["state"]
    assert invoice(s, "SUP-881")["status"] == "UNPAID_PAYABLE"
    assert any("Rejected request" in line for line in s["logs"])


def test_staff_money_out_under_threshold_runs(client):
    r = client.post("/api/bills/apply", json={**STAFF, "kind": "expense", "party": "TNB", "ref": "EXP-9", "amount": 650}).json()
    assert r["status"] == "ok"


def test_owner_turns_action_off_and_change_is_logged(client):
    s = client.post("/api/permissions", json={**OWNER, "staffModes": {"deposit.confirm": "DENY"}, "threshold": 2000}).json()["state"]
    assert any("Permission changed" in line and "Confirm deposit" in line for line in s["logs"])
    assert any("threshold: RM 1,000 → RM 2,000" in line for line in s["logs"])
    assert client.post("/api/invoices/QT-102/action", json={**STAFF, "action": "CONFIRM_QUOTE"}).status_code == 403
    assert client.post("/api/invoices/QT-102/action", json={**OWNER, "action": "CONFIRM_QUOTE"}).status_code == 200


def test_owner_sets_action_to_approval(client):
    client.post("/api/permissions", json={**OWNER, "staffModes": {"quote.create": "APPROVAL"}})
    r = client.post("/api/whatsapp/execute", json={**STAFF, "customer": "Tan Bros", "actionType": "CREATE_QUOTE_HOLD", "sku": "GAS-R32", "qty": 2, "amount": 360}).json()
    assert r["status"] == "pending_approval"
    s = client.post(f"/api/approvals/{r['approvalId']}/decide", json={**OWNER, "decision": "APPROVE"}).json()["state"]
    assert any(i["party"] == "Tan Bros" and i["type"] == "QUOTE_HOLD" for i in s["invoices"])


@pytest.mark.parametrize("key,mode", [("discount.apply", "ALLOW"), ("export.excel", "APPROVAL")])
def test_mandatory_modes_cannot_be_loosened(client, key, mode):
    assert client.post("/api/permissions", json={**OWNER, "staffModes": {key: mode}}).status_code == 400


def test_owner_only_actions(client):
    assert client.post("/api/permissions", json={**STAFF, "staffModes": {"deposit.confirm": "DENY"}}).status_code == 403
    assert client.post("/api/settings", json={**STAFF, "framework": "x"}).status_code == 403
    assert client.get("/api/export/xlsx?role=STAFF").status_code == 403


def test_audit_log_is_append_only(client):
    con = sqlite3.connect(database.DB_PATH)
    try:
        for sql in ("UPDATE audit_logs SET entry = 'x'", "DELETE FROM audit_logs"):
            with pytest.raises(sqlite3.DatabaseError, match="append-only"):
                con.execute(sql)
    finally:
        con.close()
