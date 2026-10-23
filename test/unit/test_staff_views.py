"""Staff see only their own work, and the agent's buying level and re-engage alerts."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from conftest import OWNER, STAFF

from backend.services.intent import buying_level, promised_time, reengage_alerts


def test_staff_get_only_their_own_deals_customers_and_pay(client):
    owner = client.get("/api/state?role=OWNER").json()
    staff = client.get("/api/state?role=STAFF").json()
    aina = staff["myRepId"]
    assert aina == next(r["id"] for r in owner["reps"] if r["name"] == "Aina")
    assert {d["repId"] for d in staff["deals"]} == {aina}
    assert {c["repId"] for c in staff["customers"]} == {aina}
    assert [r["name"] for r in staff["reps"]] == ["Aina"] and staff["reps"][0]["rank"] >= 1
    assert staff["teamSize"] == len(owner["reps"]) == 3
    assert staff["logs"] == [] and owner["logs"]
    assert "Kedai Runcit Ah Seng" not in staff["clientMemories"]  # Ahmad's customer
    assert owner["myRepId"] is None and owner["reengage"] == []


def test_staff_cannot_act_on_another_reps_deal(client):
    r = client.post("/api/deals/QT-2026-101/action", json={**STAFF, "action": "SEND_FOLLOW_UP"})  # Ahmad's deal
    assert r.status_code == 403 and "another rep" in r.json()["detail"]
    assert client.post("/api/deals/QT-2026-101/action", json={**OWNER, "action": "SEND_FOLLOW_UP"}).status_code == 200


def test_buying_level_reads_the_customer_message():
    assert buying_level("Hold 3 units Daikin 1.5HP for me first boss, I transfer deposit tomorrow.") == "READY"
    assert buying_level("Can do better price for 2 units?") == "INTERESTED"
    assert buying_level("Boss, got 5 units Daikin 1.5HP and 5 bottles R32 gas? How much ah?") == "BROWSING"
    assert buying_level("One of the R32 gas cylinders you delivered is leaking at the valve.") == ""
    assert buying_level("Not interested, thanks") == ""
    assert promised_time("I transfer deposit tomorrow") == (24, "tomorrow")
    assert promised_time("Can do better price?") is None


def _memory(msg, hours_ago, now, name="Cust"):
    return SimpleNamespace(customer=name, phone="", tier="", last_message=msg,
                           last_customer_at=(now - timedelta(hours=hours_ago)).strftime("%Y-%m-%d %H:%M:%S"))


def test_reengage_waits_for_the_promised_time_or_24h():
    now = datetime(2026, 10, 23, 12, 0, 0)
    ready = "Hold 2 units for me, I transfer tomorrow"
    assert reengage_alerts([_memory(ready, 20, now)], [], now) == []  # "tomorrow" not passed yet
    [a] = reengage_alerts([_memory(ready, 25, now)], [], now)
    assert (a.level, a.quiet_hours) == ("READY", 25) and "tomorrow" in a.reason
    assert reengage_alerts([_memory("Can less?", 10, now)], [], now) == []  # interested, no time given: waits 24h
    assert len(reengage_alerts([_memory("Can less?", 30, now)], [], now)) == 1
    assert reengage_alerts([_memory("How much ah?", 72, now)], [], now) == []  # browsing never alerts


def test_seeded_staff_day_has_wisma_perdana_to_re_engage(client):
    staff = client.get("/api/state?role=STAFF").json()
    [a] = staff["reengage"]
    assert (a["customer"], a["level"], a["dealId"]) == ("Wisma Perdana Sdn Bhd", "INTERESTED", "QT-2026-103")
    assert staff["clientMemories"]["Tan Bros Trading"]["buyingLevel"] == "BROWSING"
