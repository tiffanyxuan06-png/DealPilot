"""Switching SME profile loads that business's demo data in the backend (Owner only)."""
from conftest import OWNER, STAFF


def test_only_owner_switches(client):
    assert client.post("/api/profile", json={**STAFF, "preset": "fnb"}).status_code == 403
    assert client.post("/api/profile", json={**OWNER, "preset": "nope"}).status_code == 400


def test_switch_to_fnb(client):
    s = client.post("/api/profile", json={**OWNER, "preset": "fnb"}).json()["state"]
    assert (s["company"]["name"], s["company"]["preset"]) == ("Kopi & Bakery Wholesale Sdn Bhd", "fnb")
    assert next(d for d in s["deals"] if d["id"] == "QT-2026-302")["followUpText"].startswith("🔔")
    assert {c["name"] for c in s["customers"]} >= {"Cafe Hipster KL", "Bistro Bintang"}
    assert any("Switched SME profile" in line for line in s["logs"])


def test_mock_profile_numbers(client):
    """The mock seed (test data for every edge case) gives the dashboard numbers worked out by hand."""
    s = client.post("/api/profile", json={**OWNER, "preset": "mock"}).json()["state"]
    deals = {d["id"]: d for d in s["deals"]}
    assert len(deals) == 28
    reps = {r["name"]: r for r in s["reps"]}
    assert {n: (r["wonRm"], r["rank"]) for n, r in reps.items()} == {
        "Mei Ling": (9446, 1), "Aina": (4200, 2), "Ravi": (4200, 2), "Ahmad": (600, 4), "Siti": (0, 5)
    }
    assert (reps["Mei Ling"]["commissionRm"], reps["Ravi"]["potentialRm"]) == (236, 515)
    assert {i for i, d in deals.items() if d["atRisk"]} == {"QT-2026-508", "QT-2026-509", "QT-2026-510", "QT-2026-512"}
    assert deals["QT-2026-507"]["stage"] == "FOLLOW_UP"  # follow-up time passed while loading
    assert not deals["QT-2026-513"]["marginOk"]
    assert s["pipeline"]["lossReasons"] == {
        "Competitor price": 2, "No reply": 2, "Budget moved to next year": 1, "Cancelled after win": 1
    }
    rep_of = {c["name"]: c["repId"] for c in s["customers"]}
    assert rep_of["Hotel Seri Alam"] == reps["Siti"]["id"] and rep_of["Gudang Logistik Selatan"] is None
    assert rep_of["Pejabat Guaman Lee & Co"] == reps["Mei Ling"]["id"]


def test_reset_keeps_profile_and_back_to_aircond(client):
    client.post("/api/profile", json={**OWNER, "preset": "fnb"})
    assert client.post("/api/reset", json=OWNER).json()["state"]["company"]["preset"] == "fnb"
    s = client.post("/api/profile", json={**OWNER, "preset": "aircond"}).json()["state"]
    assert s["company"]["name"] == "Sejuk Jaya Aircond Sdn Bhd" and len(s["deals"]) == 10
