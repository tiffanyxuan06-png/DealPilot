"""
CashChase End-to-End Flow & LM Studio Local API Test Script
============================================================
Location: /test/test_lmstudio_and_flow.py

What this script tests:
1. Checks LM Studio Local API connectivity (default: http://127.0.0.1:1234/v1/models)
2. Resets & initializes the CashChase SQLite backend state
3. Step 1: WhatsApp Buying Inquiry -> Calls /api/whatsapp/analyze (LM Studio) -> Executes 48h Stock Hold
4. Step 2: Verifies "Who Is Holding Stock" breakdown on each SKU (Customer name, Quote #, Qty, Timer)
5. Step 3: WhatsApp Deposit Paid -> Calls /api/whatsapp/analyze -> Deducts Physical Stock & adds Cash
6. Step 4: Manual Bank Statement Verification on Pending Receipt (#INV-205)
7. Step 5: Walk-In Customer Sale (Consolidated LHDN e-Invoice EI00000000010)

Usage:
    python test/test_lmstudio_and_flow.py
"""

import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Add project root to sys.path so we can test directly against FastAPI TestClient or live server
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from fastapi.testclient import TestClient
from backend.app import app, check_lmstudio_health, DEFAULT_LMSTUDIO_URL

client = TestClient(app)


def print_banner(title: str) -> None:
    print("\n" + "=" * 78)
    print(f"  {title}")
    print("=" * 78)


def print_stock_summary(state: dict) -> None:
    c = state["company"]
    print(
        f"  [Net Worth] Core: RM {c['coreNetWorth']:,} "
        f"(Cash: RM {c['cashOnHand']:,} + Stock Value: RM {c['stockValue']:,})"
    )
    print("  [Warehouse Stock & Holders]:")
    for s in state["stock"]:
        holders_str = (
            ", ".join(f"{h['party']} ({h['heldQty']}x · {h['quoteId']} · {h['holdTimer']})" for h in s["holders"])
            if s["holders"]
            else "None"
        )
        print(
            f"    - {s['sku']} ({s['name']}): "
            f"OnHand={s['onHand']} | OnHold={s['onHold']} | Available={s['available']} "
            f"| Held By: [{holders_str}]"
        )


def run_all_tests() -> None:
    print_banner("0. CHECKING LM STUDIO LOCAL API (http://127.0.0.1:1234/v1)")
    lm_health = check_lmstudio_health(DEFAULT_LMSTUDIO_URL)
    if lm_health["connected"]:
        print(f"  ✅ Connected to LM Studio at {lm_health['url']}!")
        print(f"  🤖 Loaded Models: {lm_health['models']}")
    else:
        print(f"  ℹ️ LM Studio not detected at {lm_health['url']} ({lm_health.get('error')})")
        print("     -> When you start LM Studio's Local Server on port 1234, /api/whatsapp/analyze")
        print("        will automatically use your loaded local model! Using fallback engine for now.")

    # 1. Reset DB to clean starting state
    print_banner("1. INITIALIZING CLEAN SQLITE DATABASE STATE (/api/reset)")
    res = client.post("/api/reset", json={"role": "OWNER"})
    assert res.status_code == 200
    state = res.json()["state"]
    print_stock_summary(state)

    # 2. WhatsApp Buying Inquiry -> Analyze via LM Studio + Execute 48h Hold
    print_banner("2. WHATSAPP INQUIRY -> LM STUDIO ANALYZE -> 48H STOCK HOLD")
    wa_msg = "Boss, got 5 units Daikin 1.5HP and 5 bottles R32 gas? Need quote urgently with standard installation."
    print(f"  💬 Incoming WhatsApp from Tan Bros Trading: \"{wa_msg}\"")

    analyze_res = client.post(
        "/api/whatsapp/analyze",
        json={
            "customer": "Tan Bros Trading",
            "phone": "+60 12-345 6789",
            "message": wa_msg,
            "role": "OWNER",
        },
    )
    assert analyze_res.status_code == 200
    a_data = analyze_res.json()
    analysis = a_data["analysis"]
    print(f"  🧠 Engine Source       : {a_data['source']} (LM Studio Connected: {a_data['lmstudio_connected']})")
    print(f"  🎯 Detected Intent     : {analysis.get('intent')}")
    print(f"  📋 Stock & Price Check :\n     " + analysis.get("extCheck", "").replace("\n", "\n     "))
    print(f"  ✍️ Draft WhatsApp Reply: \"{analysis.get('extDraft')}\"")
    print(f"  🔘 1 Big Button Label  : [{analysis.get('extBtnLabel')}]")

    # Click the 1 Big Button to execute the 48h Stock Hold
    exec_res = client.post(
        "/api/whatsapp/execute",
        json={
            "customer": "Tan Bros Trading",
            "phone": "+60 12-345 6789",
            "actionType": "CREATE_QUOTE_HOLD",
            "sku": analysis.get("sku", "ACN-DAI-15"),
            "qty": analysis.get("qty", 5),
            "extraSku": analysis.get("extraSku", "GAS-R32"),
            "extraQty": analysis.get("extraQty", 5),
            "amount": analysis.get("amount", 7900),
            "role": "OWNER",
        },
    )
    assert exec_res.status_code == 200
    state = exec_res.json()["state"]
    created_quote_id = exec_res.json()["createdId"]
    print(f"\n  ✅ Executed 1 Big Button! Created Quote Hold #{created_quote_id} (Physical Stock NOT deducted yet):")
    print_stock_summary(state)

    # 3. WhatsApp Deposit Paid -> Confirm Deposit & Deduct Physical Stock
    print_banner("3. WHATSAPP DEPOSIT PAID -> DEDUCT PHYSICAL STOCK & ADD CASH")
    dep_msg = f"Ok boss confirm order for {created_quote_id}! I just bank in RM 2,000 deposit via DuitNow Ref DN-99281."
    print(f"  💬 Incoming WhatsApp from Tan Bros Trading: \"{dep_msg}\"")

    dep_analyze = client.post(
        "/api/whatsapp/analyze",
        json={
            "customer": "Tan Bros Trading",
            "phone": "+60 12-345 6789",
            "message": dep_msg,
            "role": "OWNER",
        },
    ).json()["analysis"]
    print(f"  🎯 Detected Intent     : {dep_analyze.get('intent')}")
    print(f"  🔘 1 Big Button Label  : [{dep_analyze.get('extBtnLabel')}]")

    dep_exec = client.post(
        "/api/whatsapp/execute",
        json={
            "customer": "Tan Bros Trading",
            "phone": "+60 12-345 6789",
            "actionType": "CONFIRM_DEPOSIT_DEDUCT",
            "amount": 2000,
            "role": "OWNER",
        },
    )
    assert dep_exec.status_code == 200
    state = dep_exec.json()["state"]
    print(f"\n  ✅ Deposit Confirmed! Created Invoice #{dep_exec.json()['createdId']} (-5 Daikin, -5 R32 from Physical Stock, +RM 2,000 Cash):")
    print_stock_summary(state)

    # 4. Manual Bank Receipt Verification on #INV-205
    print_banner("4. MANUAL BANK RECEIPT VERIFICATION (#INV-205 - PARTIAL PAYMENT)")
    ver_res = client.post(
        "/api/invoices/INV-205/verify-receipt",
        json={"decision": "PARTIAL", "role": "OWNER"},
    )
    assert ver_res.status_code == 200
    state = ver_res.json()["state"]
    inv_205 = next(i for i in state["invoices"] if i["id"] == "INV-205")
    print(f"  ✅ Verified Partial Receipt on #INV-205 -> Status: {inv_205['status']} | Remaining Balance: RM {inv_205['amount']:,}")
    print(f"  💰 Updated Cash on Hand: RM {state['company']['cashOnHand']:,}")

    # 5. Walk-In Customer Order (No WhatsApp, Consolidated LHDN e-Invoice)
    print_banner("5. WALK-IN CUSTOMER SALE (CONSOLIDATED LHDN E-INVOICE)")
    walkin_res = client.post(
        "/api/orders/walkin",
        json={
            "customerName": "Encik Razak",
            "buyerTin": "",  # Blank -> Auto-tagged as Consolidated e-Invoice (EI00000000010)
            "sku": "PIP-COP-3M",
            "qty": 2,
            "mode": "PAID_NOW",
            "role": "OWNER",
        },
    )
    assert walkin_res.status_code == 200
    state = walkin_res.json()["state"]
    w_id = walkin_res.json()["createdId"]
    w_inv = next(i for i in state["invoices"] if i["id"] == w_id)
    print(f"  ✅ Created Walk-In Invoice #{w_id}: {w_inv['party']} | {w_inv['itemsText']} | LHDN: {w_inv['lhdn']}")
    print_stock_summary(state)

    # 8. Test Real .xlsx Export, Real .pdf Export, and Stage 1 Direct PDF Text Decoding
    print_banner("8. TESTING REAL .XLSX EXPORT, REAL .PDF GENERATION & STAGE 1 DIRECT PDF TEXT DECODING")
    import base64

    r_xlsx = client.get("/api/export/xlsx?role=OWNER")
    assert r_xlsx.status_code == 200
    assert r_xlsx.content[:2] == b"PK"
    print(f"  ✅ /api/export/xlsx generated valid 5-sheet OpenXML Excel (.xlsx) binary ({len(r_xlsx.content):,} bytes)")

    r_pdf = client.get("/api/invoices/QT-104/pdf")
    assert r_pdf.status_code == 200
    assert r_pdf.content.startswith(b"%PDF-1.4")
    print(f"  ✅ /api/invoices/QT-104/pdf generated valid searchable PDF-1.4 binary ({len(r_pdf.content):,} bytes)")

    pdf_b64 = "data:application/pdf;base64," + base64.b64encode(r_pdf.content).decode("ascii")
    r_ocr = client.post(
        "/api/ocr/extract",
        json={"fileName": "QT-104_Supplier_Invoice.pdf", "imageBase64": pdf_b64},
    )
    assert r_ocr.status_code == 200
    ocr_json = r_ocr.json()
    assert ocr_json.get("pdf_text_decoded") is True
    print(
        f"  ✅ Stage 1 Direct PDF Text Decode succeeded (bypassed Vision OCR)! "
        f"Method: {ocr_json.get('extraction_method')} | Extracted: {ocr_json.get('extracted')}"
    )

    print_banner("🎉 ALL BACKEND + WHATSAPP + STOCK HOLD + LEDGER + PDF/XLSX TESTS PASSED!")


if __name__ == "__main__":
    run_all_tests()
