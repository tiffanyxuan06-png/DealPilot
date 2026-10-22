"""Sales routes (roadmap Phase 2): quotes, follow-ups, won/lost, margin guard, reps, price list, CSV and PDF."""
import csv
import io

from conftest import OWNER, STAFF


def deal(state, deal_id):
    return next((d for d in state["deals"] if d["id"] == deal_id), None)


def act(client, deal_id, who=OWNER, **body):
    return client.post(f"/api/deals/{deal_id}/action", json={**who, **body})


def test_quote_is_priced_by_code(client):
    r = client.post("/api/deals", json={**STAFF, "customer": "Hotel Baru", "phone": "+60 12-111 2222",
                                        "items": [{"sku": "acn-dai-15", "qty": 2}, {"sku": "GAS-R32", "qty": 1}]}).json()
    d = deal(r["state"], r["createdId"])
    assert r["createdId"] == "QT-2026-106" and d["stage"] == "QUOTED" and d["amount"] == 2 * 1150 + 180
    assert d["repId"] == 1 and d["followUpText"].startswith("⏳ 47h")  # Staff login = Aina, follow-up in 48h
    assert any(c["name"] == "Hotel Baru" for c in r["state"]["customers"])
    assert client.post("/api/deals", json={**OWNER, "customer": "X", "items": [{"sku": "NOPE", "qty": 1}]}).status_code == 404


def test_inquiry_then_quote(client):
    r = client.post("/api/deals", json={**OWNER, "customer": "Kedai Baru", "quote": False, "items": [{"sku": "GAS-R32", "qty": 2}]}).json()
    assert deal(r["state"], r["createdId"])["stage"] == "INQUIRY"
    assert deal(act(client, r["createdId"], action="SEND_QUOTE").json()["state"], r["createdId"])["stage"] == "QUOTED"
    assert act(client, r["createdId"], action="SEND_QUOTE").status_code == 409


def test_follow_up_and_suggest_lost(client):
    d = deal(act(client, "QT-2026-101", STAFF, action="SEND_FOLLOW_UP").json()["state"], "QT-2026-101")
    assert (d["stage"], d["followUpCount"], d["suggestLost"]) == ("QUOTED", 2, False)
    for _ in range(3):
        s = act(client, "QT-2026-102", action="SEND_FOLLOW_UP").json()["state"]
    assert deal(s, "QT-2026-102")["suggestLost"] and deal(s, "QT-2026-102")["stage"] == "QUOTED"


def test_mark_won_and_commission(client):
    before = next(r for r in client.get("/api/state").json()["reps"] if r["name"] == "Aina")["commissionRm"]
    s = act(client, "QT-2026-103", STAFF, action="MARK_WON", depositRef="DN-20261022-11111", depositAmount=920).json()["state"]
    d = deal(s, "QT-2026-103")
    assert (d["stage"], d["orderNo"], d["depositRef"], d["depositAmount"]) == ("WON", "SO-2026-103", "DN-20261022-11111", 920)
    assert next(r for r in s["reps"] if r["name"] == "Aina")["commissionRm"] == before + round(2300 * 0.03)
    assert act(client, "QT-2026-103", action="MARK_LOST", reason="x").status_code == 409


def test_mark_lost_needs_reason(client):
    assert act(client, "QT-2026-102", STAFF, action="MARK_LOST").status_code == 400
    d = deal(act(client, "QT-2026-102", STAFF, action="MARK_LOST", reason="Competitor price").json()["state"], "QT-2026-102")
    assert (d["stage"], d["lossReason"]) == ("LOST", "Competitor price")


def test_margin_guard(client):
    # 2x Daikin: RM 2,300, cost RM 1,700. A RM 250 discount keeps 17% margin; RM 400 drops to 10.5% (floor 15%).
    assert deal(act(client, "QT-2026-103", STAFF, action="APPLY_DISCOUNT", discount=250).json()["state"], "QT-2026-103")["amount"] == 2050
    r = act(client, "QT-2026-103", STAFF, action="APPLY_DISCOUNT", discount=400).json()
    assert r["status"] == "pending_approval" and r["reason"] == "Below the margin floor"
    assert deal(r["state"], "QT-2026-103")["amount"] == 2050
    s = client.post(f"/api/approvals/{r['approvalId']}/decide", json={**OWNER, "decision": "APPROVE"}).json()["state"]
    d = deal(s, "QT-2026-103")
    assert d["amount"] == 1900 and d["discount"] == 400 and not d["marginOk"]


def test_staff_never_sees_costs(client):
    staff = client.get("/api/state").json()
    owner = client.get("/api/state", params=OWNER).json()
    assert all("unitCost" not in p for p in staff["products"]) and all("marginPct" not in d for d in staff["deals"])
    assert all("unitCost" in p for p in owner["products"]) and deal(owner, "QT-2026-103")["marginPct"] == 26.1
    assert deal(staff, "QT-2026-103")["marginOk"] is True


def test_owner_only_routes(client):
    assert client.post("/api/reps", json={**STAFF, "name": "Siti"}).status_code == 403
    assert client.post("/api/reps/2/reassign", json={**STAFF, "toRepId": 3}).status_code == 403
    assert client.post("/api/products", json={**STAFF, "sku": "X", "name": "X", "sellPrice": 1, "unitCost": 0}).status_code == 403
    assert client.get("/api/export/orders.csv", params=STAFF).status_code == 403
    s = client.post("/api/reps", json={**OWNER, "name": "Siti", "commissionPct": 4}).json()["state"]
    assert any(r["name"] == "Siti" and r["commissionPct"] == 4 for r in s["reps"])


def test_reassign_moves_only_open_deals(client):
    r = client.post("/api/reps/2/reassign", json={**OWNER, "toRepId": 3}).json()  # Ahmad -> Mei Ling
    assert sorted(r["moved"]) == ["QT-2026-101", "QT-2026-105"]
    assert deal(r["state"], "QT-2026-097")["repId"] == 2  # his won deal keeps its commission history
    assert any("Reassigned 2 open deal(s) from Ahmad to Mei Ling" in line for line in r["state"]["logs"])


def test_price_list_edit_changes_new_quotes(client):
    client.post("/api/products", json={**OWNER, "sku": "GAS-R32", "name": "R32 Refrigerant Gas (3kg)", "sellPrice": 200, "unitCost": 130})
    r = client.post("/api/deals", json={**OWNER, "customer": "Y", "items": [{"sku": "GAS-R32", "qty": 3}]}).json()
    assert deal(r["state"], r["createdId"])["amount"] == 600


def test_pause_and_tin(client):
    assert deal(act(client, "QT-2026-103", STAFF, action="PAUSE", note="Faulty unit").json()["state"], "QT-2026-103")["paused"]
    assert not deal(act(client, "QT-2026-103", STAFF, action="RESUME").json()["state"], "QT-2026-103")["paused"]
    assert act(client, "QT-2026-101", action="SET_TIN", tin="hello").status_code == 400
    s = act(client, "QT-2026-101", action="SET_TIN", tin="C29988776650").json()["state"]
    assert next(c for c in s["customers"] if c["name"] == "Kedai Runcit Ah Seng")["tin"] == "C29988776650"


def test_won_orders_csv(client):
    r = client.get("/api/export/orders.csv", params=OWNER)
    assert r.status_code == 200 and r.content.startswith(b"\xef\xbb\xbf")
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0].keys() >= {"Order_ID", "Customer_TIN", "Line_Total_MYR", "Payment_Deposit_Ref", "Sales_Rep"}
    assert len(rows) == 7  # aircond seed: 4 won orders with 2 + 2 + 1 + 2 lines
    tan = [x for x in rows if x["Order_ID"] == "SO-2026-099"]
    assert sum(float(x["Line_Total_MYR"]) for x in tan) == 3900 and tan[0]["Discount_MYR"] == "90.00"
    assert tan[0]["Customer_TIN"] == "C2088391020" and tan[0]["Sales_Rep"] == "Aina"
    assert client.get("/api/export/orders.csv", params={**OWNER, "from": "2099-01-01"}).content.count(b"\r\n") == 1
    assert client.get("/api/export/orders.csv", params={**OWNER, "from": "22/10"}).status_code == 400


def test_quote_pdf_has_disclaimer(client):
    r = client.get("/api/deals/QT-2026-103/pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and b"Subject to stock availability" in r.content
    assert client.get("/api/deals/NOPE/pdf").status_code == 404

    # Test /api/invoices/{id}/pdf route and payment instructions
    r_inv = client.get("/api/invoices/QT-2026-103/pdf")
    assert r_inv.status_code == 200 and r_inv.content.startswith(b"%PDF")
    assert b"Payment: Maybank" in r_inv.content
    assert client.get("/api/invoices/NOPE/pdf").status_code == 404
