import base64
import io
import json
import os
import re
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.database import (
    add_log,
    build_state_payload,
    get_db,
    get_setting,
    now_time_str,
    recompute_stock_holds,
    set_setting,
)
from backend.models.schemas import (
    AddStockRequest,
    BillApplyRequest,
    InvoiceActionRequest,
    OcrExtractRequest,
    ReceiptSaveRequest,
    VerifyReceiptRequest,
    WalkInOrderRequest,
)
from backend.services.lmstudio import (
    call_lmstudio_chat,
    check_lmstudio_health,
    extract_json_from_llm,
    select_best_lmstudio_model,
)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
router = APIRouter(tags=["Invoices, Stock & Receipts"])


@router.post("/api/orders/walkin")
def api_create_walkin_order(req: WalkInOrderRequest) -> Dict[str, Any]:
    conn = get_db()
    ts = now_time_str()
    s = conn.execute("SELECT * FROM stock WHERE sku = ?", (req.sku,)).fetchone()
    if not s:
        conn.close()
        raise HTTPException(status_code=404, detail=f"SKU {req.sku} not found")

    qty = max(1, req.qty)
    total_amount = s["sell_price"] * qty
    buyer_tin = (req.buyerTin or "").strip()
    lhdn_status = (
        f"🟢 LHDN TIN: {buyer_tin}"
        if buyer_tin
        else "🔵 Consolidated e-Invoice (EI00000000010)"
    )

    count = conn.execute("SELECT COUNT(*) AS c FROM invoices").fetchone()["c"]

    if req.mode == "PAID_NOW":
        new_id = f"INV-{301 + count}"
        conn.execute("UPDATE stock SET on_hand = MAX(0, on_hand - ?) WHERE sku = ?", (qty, req.sku))
        cash = int(get_setting(conn, "cash_on_hand", "9800")) + total_amount
        set_setting(conn, "cash_on_hand", str(cash))

        conn.execute(
            """
            INSERT INTO invoices (
                id, type, party, phone, items_text, sku, qty, amount, status, lhdn, created_at
            ) VALUES (?, 'PAID_DONE', ?, 'Walk-In Counter', ?, ?, ?, ?, 'PAID', ?, ?)
            """,
            (
                new_id,
                f"{req.customerName} (Walk-In)",
                f"{qty}x {s['name']} (Walk-In Paid Immediately · Stock Deducted)",
                req.sku,
                qty,
                total_amount,
                lhdn_status,
                ts,
            ),
        )
        add_log(
            conn,
            f"[OWNER] Walk-In Sale #{new_id} ({req.customerName}) → Deducted {qty}x {s['name']} from Stock, Cash +RM {total_amount:,} ({lhdn_status}).",
        )
    else:
        new_id = f"QT-{110 + count}"
        lhdn_quote = f"🟢 LHDN TIN: {buyer_tin}" if buyer_tin else "🟡 Missing TIN"
        conn.execute(
            """
            INSERT INTO invoices (
                id, type, party, phone, hold_timer, items_text, sku, qty, amount, status, lhdn, created_at
            ) VALUES (?, 'QUOTE_HOLD', ?, 'Phone Order', '⏳ 48h Left (Just Held)', ?, ?, ?, ?, 'ON_HOLD_48H', ?, ?)
            """,
            (
                new_id,
                f"{req.customerName} (Phone Order)",
                f"{qty}x {s['name']} (ON HOLD — 48h timer)",
                req.sku,
                qty,
                total_amount,
                lhdn_quote,
                ts,
            ),
        )
        recompute_stock_holds(conn)
        add_log(
            conn,
            f"[OWNER] Phone Quote #{new_id} ({req.customerName}) → Placed {qty}x {s['name']} ON HOLD for 48h.",
        )

    conn.commit()
    conn.close()
    return {"status": "ok", "createdId": new_id, "state": build_state_payload()}


@router.post("/api/invoices/{inv_id}/verify-receipt")
def api_verify_receipt(inv_id: str, req: VerifyReceiptRequest) -> Dict[str, Any]:
    conn = get_db()
    inv = conn.execute("SELECT * FROM invoices WHERE id = ?", (inv_id,)).fetchone()
    if not inv:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Invoice {inv_id} not found")

    amount = inv["amount"]
    claimed = inv["claimed_amount"] or amount
    decision = req.decision.upper()
    if decision == "CONFIRM" or (decision in ("FULL", "PARTIAL") and req.paidAmount is not None):
        # Owner typed the amount actually seen in the bank: full if it covers the balance, else partial.
        paid_seen = req.paidAmount if req.paidAmount is not None else claimed
        decision = "FULL" if paid_seen >= amount else "PARTIAL"
        claimed = paid_seen

    if decision == "FULL":
        cash = int(get_setting(conn, "cash_on_hand", "9800")) + amount
        set_setting(conn, "cash_on_hand", str(cash))
        conn.execute(
            """
            UPDATE invoices
            SET type = 'PAID_DONE', status = 'PAID',
                items_text = items_text || ' [✅ Bank Verified Full Payment +RM ' || ? || ']'
            WHERE id = ?
            """,
            (f"{amount:,}", inv_id),
        )
        add_log(
            conn,
            f"[OWNER] Verified Bank Statement for #{inv_id} (Ref: {inv['receipt_ref'] or 'DN-Check'}) → Approved Full Payment (+RM {amount:,} Cash on Hand).",
        )
    elif decision == "PARTIAL":
        paid_now = claimed if claimed < amount else int(amount * 0.5)
        remaining = max(0, amount - paid_now)
        cash = int(get_setting(conn, "cash_on_hand", "9800")) + paid_now
        set_setting(conn, "cash_on_hand", str(cash))
        conn.execute(
            """
            UPDATE invoices
            SET type = 'PENDING', status = 'PARTIAL_PAID', amount = ?,
                items_text = ?
            WHERE id = ?
            """,
            (
                remaining,
                f"Partial RM {paid_now:,} Verified in Bank · Remaining Balance: RM {remaining:,}",
                inv_id,
            ),
        )
        add_log(
            conn,
            f"[OWNER] Verified Partial Bank Receipt of RM {paid_now:,} on #{inv_id} → Cash +RM {paid_now:,}, Remaining Balance RM {remaining:,}.",
        )
    else:
        conn.execute(
            """
            UPDATE invoices
            SET type = 'PENDING', status = 'RECEIPT_REJECTED',
                items_text = '⚠️ Receipt Rejected (Not found in Bank Statement) — Follow up required'
            WHERE id = ?
            """,
            (inv_id,),
        )
        add_log(conn, f"[OWNER] Rejected unverified receipt on #{inv_id} (Not found in Bank Statement). Cash unchanged.")

    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload()}


@router.post("/api/invoices/{inv_id}/action")
def api_invoice_action(inv_id: str, req: InvoiceActionRequest) -> Dict[str, Any]:
    conn = get_db()
    inv = conn.execute("SELECT * FROM invoices WHERE id = ?", (inv_id,)).fetchone()
    if not inv:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Invoice {inv_id} not found")

    act = req.action.upper()
    if act == "RELEASE_QUOTE":
        conn.execute("UPDATE invoices SET status = 'HOLD_RELEASED', type = 'PAID_DONE' WHERE id = ?", (inv_id,))
        recompute_stock_holds(conn)
        add_log(conn, f"[{req.role}] Released Quote Hold #{inv_id} (+{inv['qty']}x {inv['sku']} returned to Available Stock).")
    elif act == "CONFIRM_QUOTE":
        conn.execute("UPDATE stock SET on_hand = MAX(0, on_hand - ?) WHERE sku = ?", (inv["qty"], inv["sku"]))
        if inv["extra_sku"] and (inv["extra_qty"] or 0) > 0:
            conn.execute("UPDATE stock SET on_hand = MAX(0, on_hand - ?) WHERE sku = ?", (inv["extra_qty"], inv["extra_sku"]))
        deposit = int(round(inv["amount"] * 0.4))
        remaining = max(0, inv["amount"] - deposit)
        cash = int(get_setting(conn, "cash_on_hand", "9800")) + deposit
        set_setting(conn, "cash_on_hand", str(cash))
        conn.execute(
            """
            UPDATE invoices
            SET type = 'PENDING', status = 'PENDING_PAYMENT', amount = ?,
                items_text = ?
            WHERE id = ?
            """,
            (remaining, f"{inv['qty']}x {inv['sku']} (STOCK DEDUCTED · Deposit RM {deposit:,} Paid)", inv_id),
        )
        recompute_stock_holds(conn)
        add_log(conn, f"[OWNER] Confirmed Deposit RM {deposit:,} on #{inv_id} → Deducted {inv['qty']}x {inv['sku']} from Physical Stock.")
    elif act == "MARK_PAID":
        cash = int(get_setting(conn, "cash_on_hand", "9800")) + inv["amount"]
        set_setting(conn, "cash_on_hand", str(cash))
        conn.execute("UPDATE invoices SET type = 'PAID_DONE', status = 'PAID' WHERE id = ?", (inv_id,))
        add_log(conn, f"[OWNER] Confirmed full payment of RM {inv['amount']:,} on #{inv_id} (+Cash on Hand).")
    elif act == "PAY_SUPPLIER":
        cash = int(get_setting(conn, "cash_on_hand", "9800")) - inv["amount"]
        set_setting(conn, "cash_on_hand", str(cash))
        conn.execute("UPDATE invoices SET type = 'PAID_DONE', status = 'PAID_SUPPLIER' WHERE id = ?", (inv_id,))
        add_log(conn, f"[OWNER] Paid Supplier Bill #{inv_id} (-RM {inv['amount']:,} Cash).")
    elif act == "SET_TIN":
        tin_val = (req.tin or "").strip()
        new_lhdn = f"🟢 LHDN TIN: {tin_val}" if tin_val else "🔵 Consolidated e-Invoice"
        conn.execute("UPDATE invoices SET lhdn = ? WHERE id = ?", (new_lhdn, inv_id))
        add_log(conn, f"[{req.role}] Updated LHDN e-Invoice status on #{inv_id} to {new_lhdn}.")
    elif act == "REPLACE_ONE":
        sku = req.sku or inv["sku"]
        item = conn.execute("SELECT name FROM stock WHERE sku = ?", (sku,)).fetchone()
        item_name = item["name"] if item else sku
        conn.execute("UPDATE stock SET on_hand = MAX(0, on_hand - 1) WHERE sku = ?", (sku,))
        conn.execute(
            "UPDATE invoices SET status = 'REPLACEMENT_SENT', items_text = items_text || ? WHERE id = ?",
            (f" (1x Replacement {item_name} Sent — Ready to Mark Resolved)", inv_id),
        )
        add_log(conn, f"[{req.role}] Sent 1x Replacement {item_name} for #{inv_id} (-1 Physical Stock).")
    elif act == "DISCOUNT":
        rebate = max(0, req.amount or 0)
        new_amount = max(0, inv["amount"] - rebate)
        conn.execute(
            "UPDATE invoices SET amount = ?, status = 'DISCOUNT_APPLIED', items_text = items_text || ? WHERE id = ?",
            (new_amount, f" (RM {rebate:,} Credit Rebate Applied — Ready to Mark Resolved)", inv_id),
        )
        add_log(conn, f"[{req.role}] Applied RM {rebate:,} Aftersales Credit Rebate on #{inv_id} (Balance RM {new_amount:,}).")
    elif act == "MARK_RESOLVED":
        conn.execute("UPDATE invoices SET type = 'PENDING', status = 'PENDING_PAYMENT' WHERE id = ?", (inv_id,))
        add_log(conn, f"[{req.role}] Marked Aftersales Issue on #{inv_id} RESOLVED → Resumed normal Pending Invoice status.")
    elif act == "ADD_PIPE_LABOR":
        # Flow 6: extra copper piping (deducts stock) + installation labor (customer charge vs installer cost).
        pipe_sku = req.sku or "PIP-COP-3M"
        pipe = conn.execute("SELECT * FROM stock WHERE sku = ?", (pipe_sku,)).fetchone()
        if not pipe:
            conn.close()
            raise HTTPException(status_code=404, detail=f"SKU {pipe_sku} not found")
        pipe_qty = 2
        pipe_charge = pipe["sell_price"] * pipe_qty
        labor_charge, installer_cost = 350, 150
        conn.execute("UPDATE stock SET on_hand = MAX(0, on_hand - ?) WHERE sku = ?", (pipe_qty, pipe_sku))
        conn.execute(
            "UPDATE invoices SET amount = amount + ?, items_text = items_text || ? WHERE id = ?",
            (
                pipe_charge + labor_charge,
                f" + [{pipe_qty}x {pipe['name']} (RM {pipe_charge:,}) & Labor (RM {labor_charge:,})]",
                inv_id,
            ),
        )
        cash = int(get_setting(conn, "cash_on_hand", "9800")) - installer_cost
        set_setting(conn, "cash_on_hand", str(cash))
        add_log(
            conn,
            f"[{req.role}] Added Extra Piping (-{pipe_qty} Stock, +RM {pipe_charge:,}) & Labor (+RM {labor_charge:,}, -RM {installer_cost:,} Installer Cost) on #{inv_id}.",
        )
    elif act == "ATTACH_RECEIPT":
        claimed = max(0, req.amount or 0)
        ref = (req.ref or "").strip()
        conn.execute(
            """
            UPDATE invoices
            SET type = 'PENDING_VERIFY', status = 'PENDING_BANK_VERIFY', claimed_amount = ?, receipt_ref = ?,
                items_text = items_text || ?
            WHERE id = ?
            """,
            (claimed, ref, f" (OCR Receipt Claimed RM {claimed:,} · Ref: {ref} · Waiting Bank Verify)", inv_id),
        )
        add_log(conn, f"[{req.role}] OCR Customer Receipt ({ref}, RM {claimed:,}) staged for #{inv_id} in PENDING_VERIFY.")
    else:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Unknown invoice action {req.action}")

    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload()}


def _unique_id(conn, prefix: str, preferred: str = "") -> str:
    """Returns `preferred` if it is free, else the next free `<prefix>-<n>` id."""
    if preferred and not conn.execute("SELECT 1 FROM invoices WHERE id = ?", (preferred,)).fetchone():
        return preferred
    n = conn.execute("SELECT COUNT(*) AS c FROM invoices").fetchone()["c"] + 900
    while conn.execute("SELECT 1 FROM invoices WHERE id = ?", (f"{prefix}-{n}",)).fetchone():
        n += 1
    return f"{prefix}-{n}"


@router.post("/api/stock/{sku}/release")
def api_release_sku_holds(sku: str, role: str = "OWNER") -> Dict[str, Any]:
    """Releases every active quote hold on one SKU back to Available."""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM invoices WHERE type = 'QUOTE_HOLD' AND status != 'HOLD_RELEASED' AND (sku = ? OR extra_sku = ?)",
        (sku, sku),
    ).fetchall()
    for r in rows:
        if r["sku"] == sku:
            conn.execute("UPDATE invoices SET status = 'HOLD_RELEASED', type = 'PAID_DONE' WHERE id = ?", (r["id"],))
        else:
            conn.execute("UPDATE invoices SET extra_qty = 0 WHERE id = ?", (r["id"],))
    recompute_stock_holds(conn)
    add_log(conn, f"[{role}] Released all held units of {sku} back to Available Stock ({len(rows)} quote(s)).")
    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload()}


@router.post("/api/bills/apply")
def api_apply_bill(req: BillApplyRequest) -> Dict[str, Any]:
    """Saves a confirmed OCR document: supplier stock bill (+stock, -cash), expense (-cash) or customer receipt (pending bank verify)."""
    conn = get_db()
    ts = now_time_str()
    kind = req.kind.lower()
    ref = (req.ref or "").strip()
    amount = max(0, req.amount)
    qty = max(1, req.qty)

    if kind == "supplier":
        sku = (req.sku or "").strip().upper()
        item = conn.execute("SELECT * FROM stock WHERE UPPER(sku) = ?", (sku,)).fetchone() if sku else None
        if item:
            conn.execute("UPDATE stock SET on_hand = on_hand + ? WHERE sku = ?", (qty, item["sku"]))
            sku, item_name = item["sku"], item["name"]
        else:
            if not sku or not req.newSkuName:
                conn.close()
                raise HTTPException(status_code=400, detail="Supplier bill needs an existing sku, or sku + newSkuName for a new item")
            item_name = req.newSkuName.strip()
            unit_cost = max(1, round(amount / qty))
            conn.execute(
                "INSERT INTO stock (sku, name, on_hand, on_hold, hold_note, unit_cost, sell_price) VALUES (?, ?, ?, 0, '-', ?, ?)",
                (sku, item_name, qty, unit_cost, req.newSellPrice or unit_cost),
            )
        cash = int(get_setting(conn, "cash_on_hand", "9800")) - amount
        set_setting(conn, "cash_on_hand", str(cash))
        bill_id = _unique_id(conn, "SUP", ref if ref.startswith("SUP") else "")
        conn.execute(
            """
            INSERT INTO invoices (id, type, party, items_text, sku, qty, amount, status, lhdn, created_at)
            VALUES (?, 'SUPPLIER_COST', ?, ?, ?, ?, ?, 'PAID_STOCK_IN', '🟢 Supplier e-Inv', ?)
            """,
            (bill_id, req.party, f"+{qty}x {item_name} Added to Physical Stock (OCR Bill {ref})", sku, qty, amount, ts),
        )
        add_log(conn, f"[{req.role}] OCR Supplier Bill {ref} ({req.party}) → +{qty}x {item_name} added to Stock, Cash -RM {amount:,}.")
        created = bill_id
    elif kind == "expense":
        cash = int(get_setting(conn, "cash_on_hand", "9800")) - amount
        set_setting(conn, "cash_on_hand", str(cash))
        exp_id = _unique_id(conn, "EXP", ref if ref.startswith("EXP") else "")
        conn.execute(
            """
            INSERT INTO invoices (id, type, party, items_text, sku, qty, amount, status, lhdn, created_at)
            VALUES (?, 'SUPPLIER_COST', ?, ?, '-', 1, ?, 'PAID_EXPENSE', '🔵 Consolidated', ?)
            """,
            (exp_id, req.party, f"Operating Expense ({ref})", amount, ts),
        )
        add_log(conn, f"[{req.role}] OCR Operating Expense {ref} ({req.party}) → Cash -RM {amount:,}.")
        created = exp_id
    elif kind == "customer":
        target = None
        if req.invoiceId:
            target = conn.execute("SELECT id FROM invoices WHERE id = ?", (req.invoiceId,)).fetchone()
        if not target:
            target = conn.execute(
                "SELECT id FROM invoices WHERE type IN ('PENDING', 'AFTERSALES') AND party LIKE ? ORDER BY rowid DESC LIMIT 1",
                (f"%{req.party}%",),
            ).fetchone()
        if target:
            conn.execute(
                """
                UPDATE invoices
                SET type = 'PENDING_VERIFY', status = 'PENDING_BANK_VERIFY', claimed_amount = ?, receipt_ref = ?,
                    items_text = items_text || ?
                WHERE id = ?
                """,
                (amount, ref, f" (OCR Receipt Claimed RM {amount:,} · Ref: {ref} · Waiting Bank Verify)", target["id"]),
            )
            created = target["id"]
        else:
            created = _unique_id(conn, "INV")
            first_sku = conn.execute("SELECT sku FROM stock LIMIT 1").fetchone()
            conn.execute(
                """
                INSERT INTO invoices (id, type, party, items_text, sku, qty, amount, claimed_amount, receipt_ref, status, lhdn, created_at)
                VALUES (?, 'PENDING_VERIFY', ?, ?, ?, 1, ?, ?, ?, 'PENDING_BANK_VERIFY', '🟢 LHDN Ready', ?)
                """,
                (
                    created,
                    req.party,
                    f"Customer Payment Receipt Claimed RM {amount:,} (Ref: {ref})",
                    first_sku["sku"] if first_sku else "-",
                    amount,
                    amount,
                    ref,
                    ts,
                ),
            )
        add_log(conn, f"[{req.role}] OCR Customer Receipt ({ref}, RM {amount:,}) staged on #{created} in PENDING_VERIFY.")
    else:
        conn.close()
        raise HTTPException(status_code=400, detail=f"Unknown bill kind {req.kind}")

    conn.commit()
    conn.close()
    return {"status": "ok", "createdId": created, "state": build_state_payload()}


@router.post("/api/stock/add")
def api_add_or_restock(req: AddStockRequest) -> Dict[str, Any]:
    conn = get_db()
    sku = req.sku.strip().upper()
    existing = conn.execute("SELECT * FROM stock WHERE UPPER(sku) = ?", (sku,)).fetchone()
    qty = max(1, req.qty)

    if existing:
        conn.execute(
            "UPDATE stock SET on_hand = on_hand + ?, unit_cost = ?, sell_price = ? WHERE UPPER(sku) = ?",
            (qty, req.unitCost, req.sellPrice, sku),
        )
    else:
        conn.execute(
            """
            INSERT INTO stock (sku, name, on_hand, on_hold, hold_note, unit_cost, sell_price)
            VALUES (?, ?, ?, 0, '-', ?, ?)
            """,
            (sku, req.name.strip(), qty, req.unitCost, req.sellPrice),
        )

    total_cost = qty * req.unitCost
    if req.payWithCash:
        cash = int(get_setting(conn, "cash_on_hand", "9800")) - total_cost
        set_setting(conn, "cash_on_hand", str(cash))
        conn.execute(
            """
            INSERT INTO invoices (id, type, party, items_text, sku, qty, amount, status, lhdn, created_at)
            VALUES (?, 'SUPPLIER_COST', 'Warehouse Restock Purchase', ?, ?, ?, ?, 'PAID_STOCK_IN', '🟢 Supplier e-Inv', ?)
            """,
            (_unique_id(conn, "SUP"), f"+{qty}x {req.name} ({sku}) Added to Stock", sku, qty, total_cost, now_time_str()),
        )
        add_log(
            conn,
            f"[{req.role}] Purchased & Restocked +{qty}x {req.name} ({sku}) → Cash -RM {total_cost:,}.",
        )
    else:
        add_log(conn, f"[{req.role}] Added +{qty}x {req.name} ({sku}) to Warehouse Stock (Stock Value +RM {total_cost:,}).")

    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload()}


@router.post("/api/ocr/extract")
def api_ocr_extract(req: OcrExtractRequest) -> Dict[str, Any]:
    state = build_state_payload()
    lm_url = state["company"]["lmstudioUrl"]
    lm_key = state["company"]["lmstudioApiKey"]
    lm_model = state["company"]["lmstudioModel"]

    fname = (req.fileName or "receipt.png").lower()
    decoded_pdf_text = (req.extractedText or "").strip()

    if req.imageBase64 and (
        req.imageBase64.startswith("data:application/pdf") or fname.endswith(".pdf")
    ):
        try:
            from pypdf import PdfReader

            b64_part = req.imageBase64.split(",", 1)[1] if "," in req.imageBase64 else req.imageBase64
            pdf_bytes = base64.b64decode(b64_part)
            reader = PdfReader(io.BytesIO(pdf_bytes))
            page_texts = []
            for page in reader.pages:
                t = page.extract_text() or ""
                if t.strip():
                    page_texts.append(t.strip())
            if page_texts:
                decoded_pdf_text = ("\n".join(page_texts) + "\n" + decoded_pdf_text).strip()
        except Exception:
            pass

    amt_match = re.search(
        r"(?:rm|myr)\s*([\d,]+(?:\.\d{2})?)", fname + " " + decoded_pdf_text, flags=re.I
    )
    parsed_amt = int(float(amt_match.group(1).replace(",", ""))) if amt_match else 2000
    ref_match = re.search(r"((?:DN|SUP|INV|EXP)-[\w-]+)", fname + " " + decoded_pdf_text, flags=re.I)
    parsed_ref = ref_match.group(1).upper() if ref_match else f"DN-{datetime.now().strftime('%Y%m%d')}-55190"

    default_extracted = {
        "kind": "supplier" if ("sup" in fname or "stock" in fname or "bill" in fname or "supplier" in decoded_pdf_text.lower()) else ("expense" if "exp" in fname else "customer"),
        "party": req.customer or "Restoran Selera Kampung (INV-202)",
        "ref": parsed_ref,
        "qty": 1,
        "amount": parsed_amt if (req.customer or amt_match) else 1650,
    }

    if decoded_pdf_text or fname.endswith(".pdf"):
        try:
            sys_p = (
                "You are a fast PDF text & receipt parser for a Malaysian SME. "
                "Extract JSON with keys: {\"kind\": \"customer\"|\"supplier\"|\"expense\", \"party\": \"...\", \"ref\": \"...\", \"qty\": 1, \"amount\": 2000}"
            )
            usr_p = (
                f"Customer: {req.customer or 'Unknown'}\n"
                f"PDF File Name: {req.fileName}\n"
                f"Directly Decoded PDF Text:\n{decoded_pdf_text[:3000] or req.fileName}"
            )
            llm_res = call_lmstudio_chat(lm_url, lm_model, sys_p, usr_p, api_key=lm_key, timeout=15.0)
            parsed = extract_json_from_llm(llm_res["clean_content"])
            if parsed:
                return {
                    "lmstudio_vision": False,
                    "pdf_text_decoded": True,
                    "extraction_method": "direct_pdf_text_decode",
                    "model_used": f"{llm_res['model_used']} (Direct PDF Text Decode)",
                    "source_type": "direct_pdf_text_decode",
                    "decoded_text_preview": decoded_pdf_text[:400],
                    "extracted": {**default_extracted, **parsed},
                }
        except Exception:
            pass
        return {
            "lmstudio_vision": False,
            "pdf_text_decoded": True,
            "extraction_method": "direct_pdf_text_decode",
            "model_used": "Direct PDF Text Decoder (pypdf)",
            "source_type": "direct_pdf_text_decode",
            "decoded_text_preview": decoded_pdf_text[:400],
            "extracted": default_extracted,
        }

    # Vision fallback for images
    if req.imageBase64 and req.imageBase64.startswith("data:image/"):
        health = check_lmstudio_health(lm_url, api_key=lm_key)
        if health["connected"] and health["models"]:
            active_model = select_best_lmstudio_model(
                health["models"], configured_model=lm_model, task="vision"
            )
            url = lm_url.rstrip("/") + "/chat/completions"
            payload = {
                "model": active_model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    "Extract receipt or invoice fields from this image as JSON with keys: "
                                    '{"kind": "customer"|"supplier"|"expense", "party": "...", "ref": "...", "qty": 1, "amount": 1650}'
                                ),
                            },
                            {"type": "image_url", "image_url": {"url": req.imageBase64}},
                        ],
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 300,
            }
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {lm_key}"}
            try:
                http_req = urllib.request.Request(
                    url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST"
                )
                with urllib.request.urlopen(http_req, timeout=20.0) as resp:
                    raw = json.loads(resp.read().decode("utf-8"))
                    content = raw["choices"][0]["message"]["content"]
                    parsed = extract_json_from_llm(content)
                    if parsed:
                        res_obj = {
                            "lmstudio_vision": True,
                            "model_used": f"{active_model} (Vision OCR)",
                            "source_type": "vision_ocr",
                            "extracted": {**default_extracted, **parsed},
                        }
                        try:
                            rec_conn = get_db()
                            rec_conn.execute(
                                """
                                INSERT OR REPLACE INTO receipt_records (
                                    id, invoice_id, customer, file_name, file_type, ref, amount, file_data, html_preview, created_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    f"REC-{datetime.now().strftime('%Y%m%d%H%M%S')}",
                                    "",
                                    req.customer or default_extracted.get("party", "Customer Upload"),
                                    req.fileName or "Receipt_Photo.png",
                                    "image",
                                    default_extracted.get("ref", "DN-Check"),
                                    default_extracted.get("amount", 2000),
                                    req.imageBase64 or "",
                                    f"Receipt Copy for {req.customer or 'Customer'} · RM {default_extracted.get('amount', 2000):,}",
                                    now_time_str()
                                )
                            )
                            rec_conn.commit()
                            rec_conn.close()
                        except Exception:
                            pass
                        return res_obj
            except Exception:
                pass

    return {
        "lmstudio_vision": False,
        "extracted": default_extracted,
    }


@router.get("/api/receipts")
def list_receipt_records():
    conn = get_db()
    try:
        rows = conn.execute("SELECT id, invoice_id, customer, file_name, file_type, ref, amount, html_preview, created_at FROM receipt_records ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.get("/api/receipts/{receipt_id}")
def get_receipt_record(receipt_id: str):
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM receipt_records WHERE id = ? OR invoice_id = ?", (receipt_id, receipt_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Receipt record not found")
        return dict(row)
    finally:
        conn.close()


@router.get("/api/invoices/{inv_id}/receipt")
def get_invoice_receipt(inv_id: str):
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM receipt_records WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 1", (inv_id,)).fetchone()
        if not row:
            inv = conn.execute("SELECT * FROM invoices WHERE id = ?", (inv_id,)).fetchone()
            if inv and inv["receipt_ref"]:
                return {
                    "id": f"REC-{inv_id}",
                    "invoice_id": inv_id,
                    "customer": inv["party"],
                    "file_name": f"DuitNow_Receipt_{inv['receipt_ref']}.pdf",
                    "file_type": "pdf",
                    "ref": inv["receipt_ref"],
                    "amount": inv["claimed_amount"] or inv["amount"],
                    "html_preview": f"DuitNow Instant Transfer: RM {(inv['claimed_amount'] or inv['amount']):,} · Ref: {inv['receipt_ref']}",
                    "created_at": inv["created_at"],
                }
            raise HTTPException(status_code=404, detail=f"No receipt attached to invoice {inv_id}")
        return dict(row)
    finally:
        conn.close()


@router.post("/api/receipts/save")
def save_receipt_record(req: ReceiptSaveRequest):
    conn = get_db()
    try:
        ts = now_time_str()
        rec_id = f"REC-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        conn.execute(
            """
            INSERT OR REPLACE INTO receipt_records (
                id, invoice_id, customer, file_name, file_type, ref, amount, file_data, html_preview, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rec_id,
                req.invoiceId or "",
                req.customer,
                req.fileName,
                req.fileType or "pdf",
                req.ref or "",
                req.amount or 0,
                req.fileData or "",
                req.htmlPreview or "",
                ts,
            ),
        )
        conn.commit()
        return {"status": "saved", "receiptId": rec_id}
    finally:
        conn.close()


@router.get("/api/receipts/file/{file_name}")
def get_receipt_file(file_name: str):
    safe_name = os.path.basename(file_name)
    file_path = BASE_DIR / safe_name
    if file_path.exists():
        media_type = "application/pdf" if safe_name.endswith(".pdf") else "image/png"
        return FileResponse(file_path, media_type=media_type, filename=safe_name)
    raise HTTPException(status_code=404, detail=f"Receipt file '{safe_name}' not found on server")
