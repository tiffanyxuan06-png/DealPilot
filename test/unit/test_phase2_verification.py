"""Phase 2 gaps found while verifying docs/09: Ask AI prompt, audit trail, owner settings on new quotes, CSV dates."""
import csv
import io

import backend.routes.company_ai as company_ai
from conftest import OWNER, STAFF


def deal(state, deal_id):
    return next((d for d in state["deals"] if d["id"] == deal_id), None)


def test_ask_ai_prompt_uses_pipeline_and_hides_costs(client, monkeypatch):
    seen = {}

    def fake(base_url, model, system_prompt, question, **kw):
        seen["prompt"] = system_prompt
        return {"model_used": "fake", "clean_content": "ok"}

    monkeypatch.setattr(company_ai, "call_lmstudio_chat", fake)
    r = client.post("/api/agent/ask", json={"question": "Who is winning?"}).json()
    assert r["answer"] == "ok"
    p = seen["prompt"]
    assert "QT-2026-103" in p and "Wisma Perdana" in p and "Aina" in p and "commission" in p
    assert "850" not in p and "unitCost" not in p and "margin" not in p.lower()


def test_approval_and_permission_changes_are_audited(client):
    ap = client.post("/api/deals/QT-2026-103/action", json={**STAFF, "action": "APPLY_DISCOUNT", "discount": 500}).json()["approvalId"]
    s = client.post(f"/api/approvals/{ap}/decide", json={**OWNER, "decision": "APPROVE"}).json()["state"]
    assert any(f"Approved request #AP-{ap}" in line for line in s["logs"])
    s = client.post("/api/permissions", json={**OWNER, "staffModes": {"deal.won": "DENY"}}).json()["state"]
    assert any("Permission changed" in line for line in s["logs"])


def test_follow_up_hours_apply_to_new_quotes(client):
    client.post("/api/permissions", json={**OWNER, "followUpHours": 24})
    r = client.post("/api/deals", json={**OWNER, "customer": "Hotel Baru", "items": [{"sku": "GAS-R32", "qty": 1}]}).json()
    assert deal(r["state"], r["createdId"])["followUpText"].startswith("⏳ 23h")


def test_margin_floor_applies_to_new_quotes(client):
    body = {"customer": "Hotel Baru", "items": [{"sku": "ACN-DAI-15", "qty": 2}], "discount": 400}  # 10.5% margin
    assert client.post("/api/deals", json={**STAFF, **body}).json()["status"] == "pending_approval"
    assert client.post("/api/deals", json={**OWNER, **body}).json()["status"] == "ok"  # Owner is not blocked
    client.post("/api/permissions", json={**OWNER, "marginFloorPct": 5})
    assert client.post("/api/deals", json={**STAFF, **body}).json()["status"] == "ok"


def test_csv_date_range(client):
    ok = client.get("/api/export/orders.csv", params={**OWNER, "from": "2000-01-01", "to": "2099-12-31"})
    assert len(list(csv.DictReader(io.StringIO(ok.content.decode("utf-8-sig"))))) == 7
    assert client.get("/api/export/orders.csv", params={**OWNER, "to": "2000-01-01"}).content.count(b"\r\n") == 1
