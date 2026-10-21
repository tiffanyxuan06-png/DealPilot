import json
from typing import Any, Dict
from fastapi import APIRouter, HTTPException, Query

from backend.database import (
    add_log,
    build_state_payload,
    get_db,
    get_setting,
    now_time_str,
    recompute_stock_holds,
    set_setting,
)
from backend.models.schemas import WhatsAppAnalyzeRequest, WhatsAppExecuteRequest
from backend.services.lmstudio import call_lmstudio_chat, extract_json_from_llm
from backend.services.memory import clean_customer_name, compute_client_memory_rating
from backend.services.prompts import (
    build_whatsapp_copilot_system_prompt,
    build_whatsapp_copilot_user_prompt,
    deterministic_fallback_analysis,
)

router = APIRouter(tags=["WhatsApp Copilot"])


@router.get("/api/client/memory")
def get_client_memory_endpoint(
    customer: str = Query(..., description="Customer name"),
    phone: str = Query("", description="Phone number")
) -> Dict[str, Any]:
    state = build_state_payload()
    conn = get_db()
    try:
        mem = compute_client_memory_rating(customer, phone, state=state, conn=conn)
        return mem
    finally:
        conn.close()


@router.post("/api/whatsapp/analyze")
def api_whatsapp_analyze(req: WhatsAppAnalyzeRequest) -> Dict[str, Any]:
    state = build_state_payload()
    lm_url = state["company"]["lmstudioUrl"]
    lm_key = state["company"]["lmstudioApiKey"]
    lm_model = state["company"]["lmstudioModel"]

    if req.stock:
        normalized_stock = []
        for s in req.stock:
            normalized_stock.append({
                "sku": s.get("sku", ""),
                "name": s.get("name", ""),
                "onHand": s.get("onHand", s.get("on_hand", 0)),
                "onHold": s.get("onHold", s.get("on_hold", 0)),
                "sellPrice": s.get("sellPrice", s.get("sell_price", 0)),
                "unitCost": s.get("unitCost", s.get("unit_cost", 0)),
                "available": max(0, s.get("onHand", s.get("on_hand", 0)) - s.get("onHold", s.get("on_hold", 0))),
            })
        state["stock"] = normalized_stock
    if req.companyName:
        state["company"]["name"] = req.companyName
    if req.framework:
        state["company"]["framework"] = req.framework

    conn = get_db()
    client_memory_summary = compute_client_memory_rating(
        req.customer, req.phone or "", req.message, state=state, conn=conn
    )
    tier = client_memory_summary["tier"]
    score = client_memory_summary["score"]
    detected_style = client_memory_summary["styleSummary"]
    pay_behavior = client_memory_summary["paymentBehavior"]
    total_orders = client_memory_summary["totalOrders"]
    total_paid_rm = client_memory_summary["totalPaidRm"]

    stock_context = "\n".join(
        f"- {s['sku']}: {s['name']} | Sell: RM {s['sellPrice']} | Cost: RM {s['unitCost']} | "
        f"OnHand: {s['onHand']} | Held: {s['onHold']} | Available: {s['available']}"
        for s in state["stock"]
    )

    recent_context_str = "\n".join(
        f"  [{m.get('sender', 'Them')}]: {m.get('text', '')}"
        for m in (req.recentMessages or [])[-8:]
    ) or "  (First message in current view)"

    sender_turn_note = ""
    if req.lastSender == "ME" and req.lastMyMessage:
        sender_turn_note = f"""
[IMPORTANT TURN AWARENESS: OWNER ALREADY REPLIED]
The message "{req.lastMyMessage}" was sent by the BUSINESS OWNER (You), NOT the customer!
The customer's prior inquiry was: "{req.lastClientMessage or req.message}".
Do NOT analyze the owner's own message as a new inquiry. Draft a polite follow-up or confirmation if needed.
"""

    custom_directive_block = ""
    if (req.userInstruction or "").strip():
        custom_directive_block = f"""
[USER'S CUSTOM QUOTATION / REPLY INSTRUCTION (HIGHEST PRIORITY)]
The business owner explicitly requested: "{req.userInstruction.strip()}"
You MUST adjust the quotation items, quantities, installation labor, discounts, deposit percentage, and all recommended reply options to strictly follow this instruction!
"""

    tier_instruction = ""
    if tier == "NEW_CLIENT":
        tier_instruction = "\n[CLIENT TIER DIRECTIVE: NEW CLIENT]\nThis is a brand NEW customer with no past purchase records. Be warm, welcoming, and clear. Itemize prices accurately and specify that a 40% DuitNow deposit is required to confirm delivery and reserve stock."
    elif tier == "SLOW_PAYER_GHOST_RISK":
        tier_instruction = "\n[CLIENT TIER DIRECTIVE: GHOSTING RISK]\nThis customer has a history of letting holds expire without paying. Politely but firmly require a 50% deposit before locking warehouse stock."
    elif tier == "VIP_FAST_PAYER":
        tier_instruction = "\n[CLIENT TIER DIRECTIVE: VIP FAST PAYER]\nThis is a high-value, trusted repeat customer. Keep the tone warm, fast, and friendly, and offer immediate 48-hour stock hold."

    clean_cust_req = clean_customer_name(req.customer)
    system_prompt = build_whatsapp_copilot_system_prompt(
        company_name=state['company']['name'],
        stock_context=stock_context,
        framework=state['company']['framework'],
        clean_cust_req=clean_cust_req,
        phone=req.phone or "",
        tier=tier,
        score=score,
        pay_behavior=pay_behavior,
        detected_style=detected_style,
        recent_context_str=recent_context_str,
        tier_instruction=tier_instruction,
        sender_turn_note=sender_turn_note,
        custom_directive_block=custom_directive_block,
    )

    user_prompt = build_whatsapp_copilot_user_prompt(
        customer=req.customer,
        phone=req.phone or "",
        inquiry_message=req.lastClientMessage or req.message,
        last_my_message=req.lastMyMessage if req.lastSender == "ME" else None,
        user_instruction=req.userInstruction,
    )

    fallback_result = deterministic_fallback_analysis(
        req.customer, req.phone or "", req.message, state, user_instruction=req.userInstruction or ""
    )
    fallback_result["clientMemory"] = client_memory_summary

    try:
        llm_res = call_lmstudio_chat(lm_url, lm_model, system_prompt, user_prompt, api_key=lm_key)
        parsed = extract_json_from_llm(llm_res["clean_content"]) or {}

        merged = {
            **fallback_result,
            **{k: v for k, v in parsed.items() if v is not None and v != ""},
            "clientMemory": client_memory_summary,
        }
        # Code, not the AI, decides whether a quote holds stock (48h hold only when every item is available).
        if merged.get("intent") == "BUYING_INQUIRY" and fallback_result.get("intent") == "BUYING_INQUIRY":
            merged["extActionType"] = fallback_result["extActionType"]
            merged["extBtnLabel"] = fallback_result["extBtnLabel"]
        elif merged.get("intent") in ("BUYING_INQUIRY", "GENERAL_INQUIRY", "CASUAL_CHAT"):
            merged["extActionType"] = "REPLY_ONLY"
            merged["extBtnLabel"] = "💬 Insert Selected Reply (No Stock Hold)"

        conn.execute(
            """
            INSERT OR REPLACE INTO client_memories (
                customer, phone, tier, score, style_summary, payment_behavior,
                total_orders, total_paid_rm, last_message, recent_history_json,
                cached_analysis_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                req.customer.strip(),
                req.phone or "",
                tier,
                score,
                detected_style,
                pay_behavior,
                total_orders,
                total_paid_rm,
                req.message,
                json.dumps(req.recentMessages or []),
                json.dumps(merged),
                now_time_str(),
            ),
        )
        conn.commit()
        conn.close()
        return {
            "source": "lmstudio",
            "lmstudio_connected": True,
            "model_used": llm_res["model_used"],
            "raw_prompt": system_prompt + "\n\n" + user_prompt,
            "raw_llm_output": llm_res["raw_content"],
            "analysis": merged,
        }
    except Exception as e:
        conn.execute(
            """
            INSERT OR REPLACE INTO client_memories (
                customer, phone, tier, score, style_summary, payment_behavior,
                total_orders, total_paid_rm, last_message, recent_history_json,
                cached_analysis_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                req.customer.strip(),
                req.phone or "",
                tier,
                score,
                detected_style,
                pay_behavior,
                total_orders,
                total_paid_rm,
                req.message,
                json.dumps(req.recentMessages or []),
                json.dumps(fallback_result),
                now_time_str(),
            ),
        )
        conn.commit()
        conn.close()
        return {
            "source": "deterministic_fallback",
            "lmstudio_connected": False,
            "error": str(e),
            "raw_prompt": system_prompt + "\n\n" + user_prompt,
            "raw_llm_output": json.dumps(fallback_result, indent=2),
            "analysis": fallback_result,
        }


def _find_invoice(conn, req: WhatsAppExecuteRequest, types, exclude_status=None, latest_fallback=True):
    """Finds the record an action applies to: explicit invoiceId, else the latest one for this customer, else (optionally) the latest one."""
    type_sql = ",".join("?" for _ in types)
    status_sql = " AND status != ?" if exclude_status else ""
    params = list(types) + ([exclude_status] if exclude_status else [])
    if req.invoiceId:
        row = conn.execute(f"SELECT * FROM invoices WHERE id = ? AND type IN ({type_sql}){status_sql}", [req.invoiceId] + params).fetchone()
        if row:
            return row
    name = (req.customer or "").replace(" (Deposit)", "").strip()
    if name:
        row = conn.execute(
            f"SELECT * FROM invoices WHERE type IN ({type_sql}){status_sql} AND party LIKE ? ORDER BY rowid DESC LIMIT 1",
            params + [f"%{name}%"],
        ).fetchone()
        if row:
            return row
    if not latest_fallback:
        return None
    return conn.execute(
        f"SELECT * FROM invoices WHERE type IN ({type_sql}){status_sql} ORDER BY rowid DESC LIMIT 1", params
    ).fetchone()


@router.post("/api/whatsapp/execute")
def api_whatsapp_execute(req: WhatsAppExecuteRequest) -> Dict[str, Any]:
    conn = get_db()
    ts = now_time_str()
    role = req.role or "OWNER"
    action = req.actionType

    if action in ("REPLY_ONLY", "NO_ACTION"):
        add_log(conn, f"[{role}] Sent WhatsApp message to {req.customer} (Informational reply · Zero stock hold).")
        conn.commit()
        conn.close()
        return {"status": "ok", "action": "REPLY_ONLY", "state": build_state_payload()}

    if action == "CREATE_QUOTE_HOLD":
        for chk_sku, chk_qty in ((req.sku, req.qty or 1), (req.extraSku, req.extraQty or 0)):
            if not chk_sku or chk_qty <= 0:
                continue
            row = conn.execute("SELECT on_hand, on_hold FROM stock WHERE sku = ?", (chk_sku,)).fetchone()
            if row and chk_qty > row["on_hand"] - row["on_hold"]:
                conn.close()
                raise HTTPException(
                    status_code=409,
                    detail=f"Only {max(0, row['on_hand'] - row['on_hold'])}x {chk_sku} available to hold; requested {chk_qty}.",
                )
        quote_id = f"QT-{104 + conn.execute('SELECT COUNT(*) AS c FROM invoices').fetchone()['c']}"
        s1 = conn.execute("SELECT * FROM stock WHERE sku = ?", (req.sku,)).fetchone()
        s2 = conn.execute("SELECT * FROM stock WHERE sku = ?", (req.extraSku,)).fetchone() if req.extraSku else None

        s1_name = s1["name"] if s1 else req.sku
        items_desc = f"{req.qty}x {s1_name}"
        if s2 and (req.extraQty or 0) > 0:
            items_desc += f" + {req.extraQty}x {s2['name']}"
        items_desc += " (ON HOLD — 48h timer)"

        conn.execute(
            """
            INSERT INTO invoices (
                id, type, party, phone, hold_timer, chat_idx, items_text,
                sku, qty, extra_sku, extra_qty, amount, status, lhdn, created_at
            ) VALUES (?, 'QUOTE_HOLD', ?, ?, '⏳ 48h Left (Just Held)', 0, ?, ?, ?, ?, ?, ?, 'ON_HOLD_48H', '🟢 LHDN Ready', ?)
            """,
            (
                quote_id,
                req.customer,
                req.phone or "",
                items_desc,
                req.sku,
                req.qty or 1,
                req.extraSku,
                req.extraQty or 0,
                req.amount or 0,
                ts,
            ),
        )
        recompute_stock_holds(conn)
        add_log(
            conn,
            f"[{role}] WhatsApp Extension created Quote #{quote_id} ({req.customer}, RM {req.amount:,}) → Placed {req.qty}x {req.sku}"
            + (f" + {req.extraQty}x {req.extraSku}" if req.extraSku and req.extraQty else "")
            + " ON HOLD for 48h.",
        )
        conn.commit()
        conn.close()
        return {"status": "ok", "createdId": quote_id, "state": build_state_payload()}

    if action == "CONFIRM_DEPOSIT_DEDUCT":
        q = _find_invoice(conn, req, ("QUOTE_HOLD",), exclude_status="HOLD_RELEASED")

        sku = q["sku"] if q else (req.sku or "ACN-DAI-15")
        qty = q["qty"] if q else (req.qty or 5)
        extra_sku = q["extra_sku"] if q else req.extraSku
        extra_qty = (q["extra_qty"] or 0) if q else (req.extraQty or 0)
        quote_total = q["amount"] if q else 6650
        deposit = req.amount or 2000

        conn.execute("UPDATE stock SET on_hand = MAX(0, on_hand - ?) WHERE sku = ?", (qty, sku))
        if extra_sku and extra_qty > 0:
            conn.execute("UPDATE stock SET on_hand = MAX(0, on_hand - ?) WHERE sku = ?", (extra_qty, extra_sku))

        if q:
            conn.execute("UPDATE invoices SET status = 'HOLD_RELEASED', type = 'PAID_DONE' WHERE id = ?", (q["id"],))

        inv_id = f"INV-{204 + conn.execute('SELECT COUNT(*) AS c FROM invoices').fetchone()['c']}"
        remaining = max(0, quote_total - deposit)

        cash = int(get_setting(conn, "cash_on_hand", "9800")) + deposit
        set_setting(conn, "cash_on_hand", str(cash))

        conn.execute(
            """
            INSERT INTO invoices (
                id, type, party, phone, items_text, sku, qty, amount, status, lhdn, created_at
            ) VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', '🟢 LHDN Ready', ?)
            """,
            (
                inv_id,
                req.customer.replace(" (Deposit)", ""),
                req.phone or "",
                f"{qty}x {sku}" + (f" + {extra_qty}x {extra_sku}" if extra_sku else "") + f" (STOCK DEDUCTED · RM {deposit:,} Deposit Paid)",
                sku,
                qty,
                remaining,
                ts,
            ),
        )
        recompute_stock_holds(conn)
        add_log(
            conn,
            f"[{role}] Confirmed RM {deposit:,} Deposit via WhatsApp → Deducted physical stock ({qty}x {sku}), created #{inv_id} (Balance RM {remaining:,}), Cash +RM {deposit:,}.",
        )
        conn.commit()
        conn.close()
        return {"status": "ok", "createdId": inv_id, "state": build_state_payload()}

    if action == "AFTERSALES_REPLACE":
        inv = _find_invoice(conn, req, ("AFTERSALES",))
        sku = req.sku or "GAS-R32"
        if inv and sku not in (inv["sku"], inv["extra_sku"]):
            sku = inv["sku"]  # replace an item that is actually on this invoice
        conn.execute("UPDATE stock SET on_hand = MAX(0, on_hand - 1) WHERE sku = ?", (sku,))
        target = f"#{inv['id']}" if inv else req.customer
        if inv:
            conn.execute(
                """
                UPDATE invoices
                SET status = 'REPLACEMENT_SENT',
                    items_text = items_text || ' (1x Replacement ' || ? || ' Sent — Ready to Resolve)'
                WHERE id = ?
                """,
                (sku, inv["id"]),
            )
        add_log(conn, f"[{role}] Sent 1x Replacement {sku} (-1 Physical Stock) on {target} via WhatsApp Extension.")
        conn.commit()
        conn.close()
        return {"status": "ok", "state": build_state_payload()}

    if action == "RELEASE_EXPIRED_HOLD":
        inv = _find_invoice(conn, req, ("QUOTE_HOLD",), exclude_status="HOLD_RELEASED", latest_fallback=False)
        if inv:
            released = [inv]
        else:
            released = conn.execute(
                "SELECT * FROM invoices WHERE type = 'QUOTE_HOLD' AND status = 'HOLD_EXPIRED'"
            ).fetchall()
        for r in released:
            conn.execute("UPDATE invoices SET status = 'HOLD_RELEASED', type = 'PAID_DONE' WHERE id = ?", (r["id"],))
        recompute_stock_holds(conn)
        ids = ", ".join(f"#{r['id']}" for r in released) or "none"
        add_log(conn, f"[{role}] Released 48h stock hold on {ids} (units back to Available).")
        conn.commit()
        conn.close()
        return {"status": "ok", "state": build_state_payload()}

    conn.close()
    return {"status": "unknown_action", "state": build_state_payload()}
