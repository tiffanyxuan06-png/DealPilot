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


def test_reset_keeps_profile_and_back_to_aircond(client):
    client.post("/api/profile", json={**OWNER, "preset": "fnb"})
    assert client.post("/api/reset", json=OWNER).json()["state"]["company"]["preset"] == "fnb"
    s = client.post("/api/profile", json={**OWNER, "preset": "aircond"}).json()["state"]
    assert s["company"]["name"] == "Sejuk Jaya Aircond Sdn Bhd" and len(s["deals"]) == 10
