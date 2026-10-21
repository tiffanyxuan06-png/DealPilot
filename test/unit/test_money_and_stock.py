"""Net Worth math, quote holds, deposits and invoice actions."""
from conftest import OWNER, invoice, stock


def test_seed_numbers(client):
    s = client.get("/api/state").json()
    c = s["company"]
    assert (c["cashOnHand"], c["stockValue"], c["coreNetWorth"]) == (9800, 10190, 19990)
    assert (c["pendingReceivables"], c["pendingPayables"], c["fullNetWorth"]) == (8850, 1500, 27340)


def test_quote_holds_stock_without_deducting(client):
    r = client.post("/api/whatsapp/execute", json={**OWNER, "customer": "Tan Bros Trading", "actionType": "CREATE_QUOTE_HOLD",
                                                   "sku": "ACN-DAI-15", "qty": 5, "extraSku": "GAS-R32", "extraQty": 5, "amount": 6650}).json()
    daikin = stock(r["state"], "ACN-DAI-15")
    assert (daikin["onHand"], daikin["onHold"], daikin["available"]) == (8, 5, 3)
    assert r["state"]["company"]["coreNetWorth"] == 19990  # holding changes nothing yet


def test_cannot_hold_more_than_available(client):
    r = client.post("/api/whatsapp/execute", json={**OWNER, "customer": "X", "actionType": "CREATE_QUOTE_HOLD", "sku": "ACN-DAI-15", "qty": 50, "amount": 1})
    assert r.status_code == 409


def test_deposit_matches_customers_own_quote_and_deducts(client):
    client.post("/api/whatsapp/execute", json={**OWNER, "customer": "Tan Bros Trading", "actionType": "CREATE_QUOTE_HOLD",
                                               "sku": "ACN-DAI-15", "qty": 5, "extraSku": "GAS-R32", "extraQty": 5, "amount": 6650})
    s = client.post("/api/whatsapp/execute", json={**OWNER, "customer": "Tan Bros Trading", "actionType": "CONFIRM_DEPOSIT_DEDUCT", "amount": 2000}).json()["state"]
    assert stock(s, "ACN-DAI-15")["onHand"] == 3 and stock(s, "ACN-DAI-15")["onHold"] == 0
    assert stock(s, "GAS-R32")["onHand"] == 10
    assert s["company"]["cashOnHand"] == 11800
    assert invoice(s, "QT-102")["status"] == "ON_HOLD_48H"  # another customer's quote is untouched


def test_aftersales_replace_targets_the_customers_invoice(client):
    s = client.post("/api/whatsapp/execute", json={**OWNER, "customer": "Klinik Dr. Lim", "actionType": "AFTERSALES_REPLACE"}).json()["state"]
    assert invoice(s, "INV-201")["status"] == "REPLACEMENT_SENT"
    assert stock(s, "GAS-R32")["onHand"] == 14  # the item on the invoice, not the request default


def test_discount_and_resolve(client):
    s = client.post("/api/invoices/INV-201/action", json={**OWNER, "action": "DISCOUNT", "amount": 180}).json()["state"]
    assert invoice(s, "INV-201")["amount"] == 4620
    s = client.post("/api/invoices/INV-201/action", json={**OWNER, "action": "MARK_RESOLVED"}).json()["state"]
    assert (invoice(s, "INV-201")["type"], invoice(s, "INV-201")["status"]) == ("PENDING", "PENDING_PAYMENT")


def test_pipe_and_labor(client):
    s = client.post("/api/invoices/INV-202/action", json={**OWNER, "action": "ADD_PIPE_LABOR"}).json()["state"]
    assert invoice(s, "INV-202")["amount"] == 1650 + 2 * 150 + 350
    assert stock(s, "PIP-COP-3M")["onHand"] == 13
    assert s["company"]["cashOnHand"] == 9800 - 150


def test_unknown_invoice_action_is_rejected(client):
    assert client.post("/api/invoices/INV-202/action", json={**OWNER, "action": "NOPE"}).status_code == 400


def test_bills(client):
    s = client.post("/api/bills/apply", json={**OWNER, "kind": "supplier", "party": "Penghawa", "ref": "SUP-777", "amount": 2600, "qty": 20, "sku": "GAS-R32"}).json()["state"]
    assert stock(s, "GAS-R32")["onHand"] == 35 and s["company"]["cashOnHand"] == 7200
    s = client.post("/api/bills/apply", json={**OWNER, "kind": "expense", "party": "TNB", "ref": "EXP-1", "amount": 650}).json()["state"]
    assert s["company"]["cashOnHand"] == 6550


def test_opening_stock_does_not_touch_cash(client):
    s = client.post("/api/stock/add", json={**OWNER, "sku": "GAS-R32", "name": "R32", "qty": 3, "unitCost": 130, "sellPrice": 180, "payWithCash": False}).json()["state"]
    assert s["company"]["cashOnHand"] == 9800 and stock(s, "GAS-R32")["onHand"] == 18


def test_excel_export_for_owner(client):
    r = client.get("/api/export/xlsx?role=OWNER")
    assert r.status_code == 200 and r.content[:2] == b"PK"
