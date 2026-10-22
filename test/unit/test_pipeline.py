"""Sales-agent data model (roadmap Phase 1): tables, demo seeds, follow-up timer and the state shape."""
from datetime import datetime

import backend.database as database
from conftest import OWNER


def deal(state, deal_id):
    return next((d for d in state["deals"] if d["id"] == deal_id), None)


def test_state_shape(client):
    s = client.post("/api/reset", json=OWNER).json()["state"]
    assert {"company", "products", "reps", "deals", "pipeline", "customers", "clientMemories", "permissions", "approvals", "logs"} <= s.keys()
    assert "stock" not in s and "invoices" not in s and "cashOnHand" not in s["company"]
    assert [r["name"] for r in s["reps"]] == ["Aina", "Ahmad", "Mei Ling"]
    assert {d["stage"] for d in s["deals"]} == {"INQUIRY", "QUOTED", "FOLLOW_UP", "WON", "LOST"}
    assert (s["company"]["followUpHours"], s["company"]["marginFloorPct"]) == (48, 15)


def test_amounts_and_order_numbers_come_from_code(client):
    s = client.get("/api/state").json()
    tan = deal(s, "QT-2026-099")
    assert tan["amount"] == 3 * 1150 + 3 * 180 - 90
    assert tan["orderNo"] == "SO-2026-099" and tan["depositRef"] == "DN-20261021-88310"
    assert deal(s, "QT-2026-102")["orderNo"] is None


def test_follow_up_due_and_complaint_pause(client):
    s = client.get("/api/state").json()
    due = deal(s, "QT-2026-101")
    assert due["stage"] == "FOLLOW_UP" and due["followUpText"].startswith("🔔")
    paused = deal(s, "QT-2026-104")  # follow-up time has passed, but the customer has an open complaint
    assert paused["stage"] == "QUOTED" and paused["paused"] and paused["followUpText"].startswith("⏸")


def test_quote_moves_to_follow_up_when_time_passes(client):
    assert deal(client.get("/api/state").json(), "QT-2026-102")["stage"] == "QUOTED"
    client.post("/api/demo/fast-forward", json={**OWNER, "hours": 48})
    s = client.get("/api/state").json()
    assert deal(s, "QT-2026-102")["stage"] == "FOLLOW_UP"
    assert any("QT-2026-102" in line and "follow-up due" in line for line in s["logs"])


def test_pipeline_and_commission(client):
    s = client.get("/api/state").json()
    p = s["pipeline"]
    assert p["valueRm"] == sum(d["amount"] for d in s["deals"] if d["stage"] in ("QUOTED", "FOLLOW_UP"))
    assert p["winRate"] == round(4 / 5, 2)  # aircond seed: 4 won, 1 lost
    assert p["byStage"]["LOST"] == {"count": 1, "valueRm": 900}
    month = datetime.now().strftime("%Y-%m")
    for rep in s["reps"]:
        won = [d for d in s["deals"] if d["repId"] == rep["id"] and d["stage"] == "WON" and d["wonAt"].startswith(month)]
        assert rep["wonRm"] == sum(d["amount"] for d in won)
        assert rep["commissionRm"] == sum(round(d["amount"] * 0.03) for d in won)


def test_fnb_profile_and_software_removed(client):
    assert client.post("/api/profile", json={**OWNER, "preset": "software"}).status_code == 400
    s = client.post("/api/profile", json={**OWNER, "preset": "fnb"}).json()["state"]
    assert s["company"]["name"] == "Kopi & Bakery Wholesale Sdn Bhd"
    assert {p["sku"] for p in s["products"]} == {"BEAN-ARA-5K", "MLK-OAT-CTN", "CUP-PAP-8OZ"}
    assert {d["stage"] for d in s["deals"]} == {"INQUIRY", "QUOTED", "FOLLOW_UP", "WON", "LOST"}


def test_old_cash_and_stock_database_is_rebuilt(client):
    conn = database.get_db()
    conn.execute("CREATE TABLE invoices (id TEXT)")
    conn.commit()
    conn.close()
    database.init_db()
    conn = database.get_db()
    assert not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'invoices'").fetchone()
    assert conn.execute("SELECT COUNT(*) AS n FROM deals").fetchone()["n"] == 10
    conn.close()
