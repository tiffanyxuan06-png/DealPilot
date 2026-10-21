"""Switching SME profile loads that business's demo data in the backend (Owner only)."""
from conftest import OWNER, STAFF, invoice, stock


def test_only_owner_switches(client):
    assert client.post("/api/profile", json={**STAFF, "preset": "fnb"}).status_code == 403
    assert client.post("/api/profile", json={**OWNER, "preset": "nope"}).status_code == 400


def test_switch_to_fnb(client):
    s = client.post("/api/profile", json={**OWNER, "preset": "fnb"}).json()["state"]
    c = s["company"]
    assert (c["name"], c["preset"], c["cashOnHand"]) == ("Kopi & Bakery Wholesale Sdn Bhd", "fnb", 6400)
    assert c["stockValue"] == 20 * 180 + 30 * 90
    assert stock(s, "BEAN-ARA-5K")["onHold"] == 4  # QT-301 is a live 48h hold
    assert invoice(s, "QT-301")["holdTimer"].startswith(("⏳ 29h", "⏳ 30h"))
    assert {cu["name"] for cu in s["customers"]} == {"Cafe Hipster KL", "Bistro Bintang"}
    assert any("Switched SME profile" in line for line in s["logs"])


def test_software_profile_actions_work(client):
    s = client.post("/api/profile", json={**OWNER, "preset": "software"}).json()["state"]
    assert stock(s, "SW-POS-PRO")["onHold"] == 5 and stock(s, "LAB-DEV-DAY")["onHold"] == 3
    s = client.post("/api/invoices/QT-701/action", json={**OWNER, "action": "CONFIRM_QUOTE"}).json()["state"]
    assert stock(s, "SW-POS-PRO")["onHand"] == 20 and stock(s, "LAB-DEV-DAY")["onHand"] == 17
    assert s["company"]["cashOnHand"] == 14500 + round(7800 * 0.4)


def test_reset_keeps_profile_and_back_to_aircond(client):
    client.post("/api/profile", json={**OWNER, "preset": "fnb"})
    assert client.post("/api/reset", json=OWNER).json()["state"]["company"]["preset"] == "fnb"
    s = client.post("/api/profile", json={**OWNER, "preset": "aircond"}).json()["state"]
    assert s["company"]["coreNetWorth"] == 19990 and invoice(s, "INV-205") is not None
