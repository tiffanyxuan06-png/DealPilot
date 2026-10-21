"""48h quote holds: real expiry, automatic release, late deposits, hold length."""
from conftest import OWNER, STAFF, invoice, stock


def make_quote(client, qty=5):
    r = client.post("/api/whatsapp/execute", json={**OWNER, "customer": "Tan Bros Trading", "actionType": "CREATE_QUOTE_HOLD",
                                                   "sku": "ACN-DAI-15", "qty": qty, "amount": 1150 * qty}).json()
    return r["createdId"], r["state"]


def test_seeded_expired_quote_holds_nothing(client):
    s = client.get("/api/state").json()
    assert invoice(s, "QT-101")["status"] == "HOLD_EXPIRED"
    assert stock(s, "ACN-DAI-15")["onHold"] == 0
    assert invoice(s, "QT-102")["holdTimer"].startswith(("⏳ 40h", "⏳ 41h"))


def test_hold_expires_and_releases_stock(client):
    q, s = make_quote(client)
    assert invoice(s, q)["holdTimer"].startswith("⏳ 47h")
    s = client.post("/api/demo/fast-forward", json={**OWNER, "hours": 48}).json()["state"]
    assert invoice(s, q)["status"] == "HOLD_EXPIRED"
    assert stock(s, "ACN-DAI-15")["onHold"] == 0
    assert any("expired with no deposit" in line and q in line for line in s["logs"])


def test_late_deposit_only_if_stock_still_free(client):
    q, _ = make_quote(client, qty=5)
    client.post("/api/demo/fast-forward", json={**OWNER, "hours": 48})
    client.post("/api/orders/walkin", json={**OWNER, "customerName": "Walk-in", "sku": "ACN-DAI-15", "qty": 6, "mode": "PAID_NOW"})
    r = client.post(f"/api/invoices/{q}/action", json={**OWNER, "action": "CONFIRM_QUOTE"})
    assert r.status_code == 409 and "expired" in r.json()["detail"]


def test_late_deposit_ok_when_stock_free(client):
    q, _ = make_quote(client, qty=2)
    client.post("/api/demo/fast-forward", json={**OWNER, "hours": 48})
    assert client.post(f"/api/invoices/{q}/action", json={**OWNER, "action": "CONFIRM_QUOTE"}).status_code == 200


def test_owner_sets_hold_length(client):
    s = client.post("/api/permissions", json={**OWNER, "holdHours": 24}).json()["state"]
    assert s["permissions"]["holdHours"] == 24
    r = client.post("/api/orders/walkin", json={**OWNER, "customerName": "Ali", "sku": "GAS-R32", "qty": 1, "mode": "QUOTE_HOLD"}).json()
    assert invoice(r["state"], r["createdId"])["holdTimer"].startswith("⏳ 23h")


def test_only_owner_can_fast_forward(client):
    assert client.post("/api/demo/fast-forward", json={**STAFF, "hours": 48}).status_code == 403
