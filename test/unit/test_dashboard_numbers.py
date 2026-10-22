"""Numbers the Owner and Staff dashboards need, all from GET /api/state."""
from conftest import OWNER, STAFF
from sqlalchemy import text

from backend.db import get_engine
from backend.services.pipeline import deal_commission


def deal(state, deal_id):
    """The deal with this id from an /api/state payload."""
    return next(d for d in state["deals"] if d["id"] == deal_id)


def act(client, deal_id, who=OWNER, **body):
    """Runs one deal action as `who` (Owner by default) and returns the new state."""
    return client.post(f"/api/deals/{deal_id}/action", json={**who, **body}).json()["state"]


def test_potential_rm_sums_open_quote_commission(client):
    """potentialRm is the commission on a rep's quotes still waiting for an answer; winning one removes it."""
    s = client.get("/api/state", params=OWNER).json()
    for rep in s["reps"]:
        open_quotes = [d for d in s["deals"] if d["repId"] == rep["id"] and d["stage"] in ("QUOTED", "FOLLOW_UP")]
        assert rep["potentialRm"] == sum(deal_commission(d["amount"], rep["commissionPct"]) for d in open_quotes)
    assert next(r for r in s["reps"] if r["name"] == "Ahmad")["potentialRm"] > 0  # QT-2026-101 + QT-2026-102 are open
    # Winning a quote takes it out of "potential" (INQUIRY never counted).
    s = act(client, "QT-2026-103", STAFF, action="MARK_WON", depositRef="DN-20261022-11111", depositAmount=920)
    assert next(r for r in s["reps"] if r["name"] == "Aina")["potentialRm"] == 0


def test_rank_by_won_rm_with_ties(client):
    """Reps rank by won RM this month; reps with equal totals share a rank (competition ranking)."""
    s = client.get("/api/state", params=OWNER).json()
    by_name = {r["name"]: r for r in s["reps"]}
    assert (by_name["Aina"]["rank"], by_name["Mei Ling"]["rank"], by_name["Ahmad"]["rank"]) == (1, 2, 3)
    # Two new reps with nothing won tie below Ahmad: 4, 4 (competition ranking).
    for name in ("Siti", "Raju"):
        s = client.post("/api/reps", json={**OWNER, "name": name, "commissionPct": 3}).json()["state"]
    by_name = {r["name"]: r for r in s["reps"]}
    assert (by_name["Siti"]["rank"], by_name["Raju"]["rank"], by_name["Ahmad"]["rank"]) == (4, 4, 3)


def test_customer_rep_follows_latest_deal(client):
    """A customer's repId is the rep on their newest deal, so it follows a reassign and a new quote."""
    rep = lambda s, name: next(c for c in s["customers"] if c["name"] == name)["repId"]
    s = client.get("/api/state", params=OWNER).json()
    assert rep(s, "Hotel Seri Alam") == 2 and rep(s, "Klinik Dr. Lim") == 3
    s = client.post("/api/reps/2/reassign", json={**OWNER, "toRepId": 1}).json()["state"]
    assert rep(s, "Hotel Seri Alam") == 1  # its only deal moved
    assert rep(s, "Pusat Servis Jaya") == 2  # lost deal stays with Ahmad
    new = client.post("/api/deals", json={**STAFF, "customer": "Klinik Dr. Lim", "items": [{"sku": "GAS-R32", "qty": 1}]}).json()["state"]
    assert rep(new, "Klinik Dr. Lim") == 1  # newest deal (Aina) beats the older ones


def test_loss_reasons_count_lost_deals(client):
    """lossReasons counts lost deals per reason and picks up a new MARK_LOST."""
    assert client.get("/api/state", params=OWNER).json()["pipeline"]["lossReasons"] == {"Competitor price": 1}
    s = act(client, "QT-2026-102", action="MARK_LOST", reason="No reply")  # a lost deal with a new reason
    assert s["pipeline"]["lossReasons"] == {"Competitor price": 1, "No reply": 1}


def test_at_risk_flags(client):
    """atRisk marks paused quotes, big deals in follow-up and quotes past 3 follow-ups, but not fresh or won deals."""
    s = client.get("/api/state", params=OWNER).json()
    assert deal(s, "QT-2026-104")["atRisk"] is True  # paused (complaint)
    assert deal(s, "QT-2026-101")["atRisk"] is True  # FOLLOW_UP and RM 3,450
    assert deal(s, "QT-2026-103")["atRisk"] is False and deal(s, "QT-2026-099")["atRisk"] is False
    for _ in range(3):
        s = act(client, "QT-2026-102", action="SEND_FOLLOW_UP")
    assert deal(s, "QT-2026-102")["suggestLost"] and deal(s, "QT-2026-102")["atRisk"] is True
    fresh = client.post("/api/deals", json={**STAFF, "customer": "Kedai Baru", "items": [{"sku": "GAS-R32", "qty": 1}]}).json()
    assert deal(fresh["state"], fresh["createdId"])["atRisk"] is False


def test_staff_state_still_has_no_costs(client):
    """The new dashboard fields reach Staff, while unit costs and margin % still don't."""
    staff = client.get("/api/state").json()
    assert all("unitCost" not in p for p in staff["products"]) and all("marginPct" not in d for d in staff["deals"])
    assert all("atRisk" in d for d in staff["deals"]) and all("rank" in r and "potentialRm" in r for r in staff["reps"])


def test_customer_match_ignores_tag_and_case(client):
    """A deal for 'KLINIK DR. LIM (Phone Order)' counts for the customer 'Klinik Dr. Lim'."""
    s = client.post("/api/deals", json={**OWNER, "customer": "KLINIK DR. LIM (Phone Order)", "repId": 2,
                                        "items": [{"sku": "GAS-R32", "qty": 1}]}).json()["state"]
    assert next(c for c in s["customers"] if c["name"] == "Klinik Dr. Lim")["repId"] == 2


def test_inactive_rep_is_hidden_and_does_not_change_ranks(client):
    """An inactive rep is not listed and does not push other reps down the ranking."""
    before = {r["name"]: r["rank"] for r in client.get("/api/state", params=OWNER).json()["reps"]}
    s = client.post("/api/reps", json={**OWNER, "name": "Gone", "commissionPct": 3, "active": False}).json()["state"]
    assert "Gone" not in [r["name"] for r in s["reps"]]
    assert {r["name"]: r["rank"] for r in s["reps"]} == before


def test_tie_with_wins_skips_the_next_rank(client):
    """Two reps with the same non-zero won RM share a rank, and the next rank is skipped (4, 4, 6)."""
    for name in ("Siti", "Raju", "Tia"):
        s = client.post("/api/reps", json={**OWNER, "name": name, "commissionPct": 3}).json()["state"]
    ids = {r["name"]: r["id"] for r in s["reps"]}
    for name, qty in (("Siti", 2), ("Raju", 2), ("Tia", 1)):
        r = client.post("/api/deals", json={**OWNER, "customer": f"Cust {name}", "repId": ids[name],
                                            "items": [{"sku": "GAS-R32", "qty": qty}]}).json()
        s = act(client, r["createdId"], action="MARK_WON", depositRef="DN-20261022-11111", depositAmount=100)
    by_name = {r["name"]: r for r in s["reps"]}
    assert by_name["Siti"]["wonRm"] == by_name["Raju"]["wonRm"] > by_name["Tia"]["wonRm"] > 0
    assert (by_name["Siti"]["rank"], by_name["Raju"]["rank"], by_name["Tia"]["rank"]) == (4, 4, 6)


def test_inquiry_is_not_potential(client):
    """An inquiry (no price sent yet) adds nothing to the rep's potential commission."""
    before = next(r for r in client.get("/api/state").json()["reps"] if r["name"] == "Aina")["potentialRm"]
    s = client.post("/api/deals", json={**OWNER, "customer": "Kedai Baru", "repId": 1, "quote": False,
                                        "items": [{"sku": "GAS-R32", "qty": 5}]}).json()["state"]
    assert next(r for r in s["reps"] if r["name"] == "Aina")["potentialRm"] == before


def test_lost_deal_without_reason_is_counted_as_no_reason(client):
    """A lost deal with an empty reason is counted under 'No reason'."""
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE deals SET loss_reason = '' WHERE id = 'QT-2026-092'"))
    assert client.get("/api/state", params=OWNER).json()["pipeline"]["lossReasons"] == {"No reason": 1}
