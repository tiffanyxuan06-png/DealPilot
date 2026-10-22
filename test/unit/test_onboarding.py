"""60-second setup: read a price list, start the business, keep it on reset."""
import base64
import io

from openpyxl import Workbook

from backend.services.onboarding import parse_price_list
from conftest import OWNER, STAFF

CSV = """Kedai Hardware Jaya - Price List Oct 2026
Item Code,Product Name,Qty On Hand,Unit Cost (RM),Selling Price
HW-001,PVC Pipe 1in,120,"RM 8.50",12
,Cement 50kg,40,18,
HW-003,Paint 5L White,15,,65
,,,,
"""


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def test_parse_messy_csv():
    items, warnings = parse_price_list("stock.csv", CSV.encode())
    assert [i["name"] for i in items] == ["PVC Pipe 1in", "Cement 50kg", "Paint 5L White"]
    pvc, cement, paint = items
    assert (pvc["sku"], pvc["unitCost"], pvc["sellPrice"]) == ("HW-001", 8, 12) and "qty" not in pvc
    assert cement["sku"] and cement["sellPrice"] == round(18 * 1.3) and cement["estimated"]
    assert paint["unitCost"] == round(65 / 1.3) and paint["estimated"]
    assert any("estimated" in w for w in warnings)


def test_parse_xlsx():
    wb = Workbook()
    ws = wb.active
    ws.append(["SKU", "Item", "Stock", "Cost", "Price"])
    ws.append(["BK-01", "Flour 25kg", 10, 60, 85])
    buf = io.BytesIO()
    wb.save(buf)
    items, _ = parse_price_list("list.xlsx", buf.getvalue())
    assert items == [{"sku": "BK-01", "name": "Flour 25kg", "unitCost": 60, "sellPrice": 85, "estimated": False}]


def test_no_name_column():
    items, warnings = parse_price_list("x.csv", b"a,b\n1,2\n")
    assert items == [] and "name" in warnings[0]


def test_preview_and_apply(client):
    assert client.post("/api/onboarding/preview", json={**STAFF, "fileName": "s.csv", "fileBase64": b64(CSV.encode())}).status_code == 403
    prev = client.post("/api/onboarding/preview", json={**OWNER, "fileName": "s.csv", "fileBase64": "data:text/csv;base64," + b64(CSV.encode())}).json()
    assert len(prev["items"]) == 3
    setup = {**OWNER, "companyName": "Kedai Hardware Jaya", "followUpHours": 24, "marginFloorPct": 20, "items": prev["items"]}
    s = client.post("/api/onboarding/apply", json=setup).json()["state"]
    c = s["company"]
    assert (c["name"], c["preset"], c["followUpHours"], c["marginFloorPct"]) == ("Kedai Hardware Jaya", "custom", 24, 20)
    assert s["deals"] == [] and [r["name"] for r in s["reps"]] == ["Owner"]
    assert {p["sku"] for p in s["products"]} >= {"HW-001", "HW-003"}
    assert any("Set up Kedai Hardware Jaya" in line for line in s["logs"])
    # the new business works: a quote priced from its own list, follow-up in 24h
    r = client.post("/api/deals", json={**OWNER, "customer": "Ali", "items": [{"sku": "HW-001", "qty": 10}]}).json()
    deal = next(d for d in r["state"]["deals"] if d["id"] == r["createdId"])
    assert deal["amount"] == 120 and deal["followUpText"].startswith("⏳ 23h")
    # reset rebuilds this business, not demo data
    s = client.post("/api/reset", json=OWNER).json()["state"]
    assert s["company"]["name"] == "Kedai Hardware Jaya" and s["deals"] == []


def test_apply_validation(client):
    base = {**OWNER, "companyName": "X", "followUpHours": 48, "marginFloorPct": 15}
    assert client.post("/api/onboarding/apply", json={**base, "items": []}).status_code == 400
    dup = [{"sku": "A", "name": "a"}, {"sku": "a", "name": "b"}]
    assert client.post("/api/onboarding/apply", json={**base, "items": dup}).status_code == 400
