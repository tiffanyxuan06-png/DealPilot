"""Owner-controlled Staff permissions, the approval queue and the mandatory safety rules."""
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from backend.db import get_engine
from conftest import OWNER, STAFF


def deal(state, deal_id):
    return next((d for d in state["deals"] if d["id"] == deal_id), None)


def test_missing_role_is_staff(client):
    assert client.post("/api/reset").status_code == 403
    assert client.post("/api/reset", json=OWNER).status_code == 200


def test_staff_routine_action_runs(client):
    r = client.post("/api/deals/QT-2026-101/action", json={**STAFF, "action": "SEND_FOLLOW_UP"})
    assert r.status_code == 200 and deal(r.json()["state"], "QT-2026-101")["followUpCount"] == 2


def test_approval_only_owner_decides_once(client):
    r = client.post("/api/deals/QT-2026-103/action", json={**STAFF, "action": "APPLY_DISCOUNT", "discount": 500}).json()
    assert r["status"] == "pending_approval"
    ap = r["approvalId"]
    assert client.post(f"/api/approvals/{ap}/decide", json={**STAFF, "decision": "APPROVE"}).status_code == 403
    assert client.post(f"/api/approvals/{ap}/decide", json={**OWNER, "decision": "APPROVE"}).status_code == 200
    assert client.post(f"/api/approvals/{ap}/decide", json={**OWNER, "decision": "APPROVE"}).status_code == 409


def test_rejected_request_changes_nothing(client):
    r = client.post("/api/deals/QT-2026-103/action", json={**STAFF, "action": "APPLY_DISCOUNT", "discount": 500}).json()
    s = client.post(f"/api/approvals/{r['approvalId']}/decide", json={**OWNER, "decision": "REJECT", "note": "too low"}).json()["state"]
    assert deal(s, "QT-2026-103")["amount"] == 2300
    assert any("Rejected request" in line for line in s["logs"])


def test_owner_turns_action_off_and_change_is_logged(client):
    s = client.post("/api/permissions", json={**OWNER, "staffModes": {"deal.won": "DENY"}, "marginFloorPct": 20}).json()["state"]
    assert any("Permission changed" in line and "Mark deal won" in line for line in s["logs"])
    assert any("Margin floor: 15% → 20%" in line for line in s["logs"])
    assert s["company"]["marginFloorPct"] == 20
    assert client.post("/api/deals/QT-2026-103/action", json={**STAFF, "action": "MARK_WON"}).status_code == 403
    assert client.post("/api/deals/QT-2026-103/action", json={**OWNER, "action": "MARK_WON"}).status_code == 200


def test_owner_sets_action_to_approval(client):
    client.post("/api/permissions", json={**OWNER, "staffModes": {"deal.create": "APPROVAL"}})
    r = client.post("/api/deals", json={**STAFF, "customer": "Tan Bros Trading", "items": [{"sku": "GAS-R32", "qty": 2}]}).json()
    assert r["status"] == "pending_approval"
    s = client.post(f"/api/approvals/{r['approvalId']}/decide", json={**OWNER, "decision": "APPROVE"}).json()["state"]
    assert any(d["customer"] == "Tan Bros Trading" and d["amount"] == 360 and d["stage"] == "QUOTED" for d in s["deals"])


def test_owner_sets_follow_up_hours(client):
    s = client.post("/api/permissions", json={**OWNER, "followUpHours": 24}).json()["state"]
    assert s["company"]["followUpHours"] == 24 and s["permissions"]["followUpHours"] == 24


@pytest.mark.parametrize("key,mode", [("discount.apply", "BOGUS"), ("no.such.action", "ALLOW")])
def test_bad_permission_changes_are_refused(client, key, mode):
    assert client.post("/api/permissions", json={**OWNER, "staffModes": {key: mode}}).status_code == 400


def test_owner_only_actions(client):
    assert client.post("/api/permissions", json={**STAFF, "staffModes": {"deal.won": "DENY"}}).status_code == 403
    assert client.post("/api/settings", json={**STAFF, "framework": "x"}).status_code == 403
    assert client.get("/api/export/orders.csv?role=STAFF").status_code == 403


def test_audit_log_is_append_only(client):
    for sql in ("UPDATE audit_logs SET entry = 'x'", "DELETE FROM audit_logs"):
        with pytest.raises(DBAPIError, match="append-only"):
            with get_engine().begin() as conn:
                conn.execute(text(sql))
