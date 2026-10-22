"""WhatsApp copilot. Phase 3 (docs/11 §4) rewrites analyze for sales intents and execute for deal actions."""
import json
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.db import orm, session_scope
from backend.models.enums import OPEN_STAGES, DealAction
from backend.models.requests import (
    CustomerCreateRequest,
    DealActionRequest,
    DealCreateRequest,
    DealItemRequest,
    PhotoQuoteRequest,
    WhatsAppAnalyzeRequest,
    WhatsAppExecuteRequest,
)
from backend.models.responses import ClientMemoryRating, OcrExtractResponse, PhotoQuoteResponse, ReceiptSaveResponse, WhatsAppAnalyzeResponse
from backend.models.state import ActionResponse
from backend.routes.deals import api_create_deal, api_deal_action
from backend.services.business import load_business
from backend.services.clock import now_time_str
from backend.services.customers import (
    apply_tin,
    get_customer,
    is_customer,
    parse_ssm,
    parse_tin,
    tin_request_text,
    upsert_customer,
)
from backend.services.lmstudio import call_lmstudio_chat, extract_json_from_llm
from backend.services.memory import clean_customer_name, compute_client_memory_rating
from backend.services.permissions import enforce, normalize_role, register_handler
from backend.services.pipeline import build_state, log, resolve_active_ai_credentials
from backend.services.prompts import (
    as_customer_text,
    build_whatsapp_copilot_system_prompt,
    build_whatsapp_copilot_user_prompt,
    check_ai_replies,
    deterministic_fallback_analysis,
)
from backend.services.vision import (
    check_upload_type,
    extract_items_from_image,
    match_items_to_products,
)

router = APIRouter(tags=["WhatsApp Copilot"])


@router.get("/api/client/memory", response_model=ClientMemoryRating)
def get_client_memory_endpoint(
    customer: str = Query(..., description="Customer name"),
    phone: str = Query("", description="Phone number"),
) -> Dict[str, Any]:
    return compute_client_memory_rating(customer, phone)


def _save_memory(session: Session, req: WhatsAppAnalyzeRequest, mem: Dict[str, Any], analysis: Dict[str, Any]) -> None:
    session.merge(
        orm.ClientMemory(
            customer=req.customer.strip(),
            phone=req.phone or "",
            tier=mem["tier"],
            score=mem["score"],
            style_summary=mem["styleSummary"],
            payment_behavior=mem["paymentBehavior"],
            total_orders=mem["totalOrders"],
            total_paid_rm=mem["totalPaidRm"],
            last_message=req.message,
            recent_history_json=json.dumps([m.model_dump() for m in req.recent_messages or []]),
            cached_analysis_json=json.dumps(analysis),
            updated_at=now_time_str(),
        )
    )


def _find_open_deal(session: Session, customer: str) -> Optional[orm.Deal]:
    key = clean_customer_name(customer).lower()
    return session.scalars(
        select(orm.Deal).where(
            orm.Deal.stage.in_([s.value for s in OPEN_STAGES]),
            func.lower(orm.Deal.customer).contains(key, autoescape=True)
        ).order_by(orm.Deal.id.desc())
    ).first()


@router.post("/api/whatsapp/analyze", response_model=WhatsAppAnalyzeResponse)
def api_whatsapp_analyze(req: WhatsAppAnalyzeRequest) -> Dict[str, Any]:
    mem = compute_client_memory_rating(req.customer, req.phone or "", req.message)
    tier = mem["tier"]

    # Customer allowlist check (docs/11 §4.1)
    with session_scope() as s:
        registered = is_customer(s, req.customer, req.phone or "")
    if not registered:
        analysis = {
            "intent": "NOT_A_CUSTOMER",
            "isCustomer": False,
            "badge": "Not a customer",
            "extTitle": f"{clean_customer_name(req.customer)} (Not in Directory)",
            "extCheck": "🟡 Contact not registered in customer directory.\nClick 'Add as customer' to enable sales quotes and tracking.",
            "extActionDesc": "Add this contact to your customer list to start tracking deals.",
            "extDraft": f"Hi {clean_customer_name(req.customer)}, thanks for reaching out! Let me get your details registered with our team.",
            "replyOptions": [
                {"label": "Register Contact", "text": f"Hi {clean_customer_name(req.customer)}, thanks for reaching out! Let me get your details registered with our team."}
            ],
            "extActionType": "NO_ACTION",
            "extBtnLabel": "👤 Add as customer",
            "items": [],
            "amount": 0,
            "marginOk": True,
            "clientMemory": mem,
        }
        return {
            "source": "allowlist",
            "lmstudio_connected": False,
            "raw_prompt": "",
            "raw_llm_output": "",
            "analysis": analysis,
        }

    state = build_state().model_dump(by_alias=True)  # Staff view: no unit costs reach the AI
    state["stock"] = [{**p, "onHand": 0, "onHold": 0, "available": 0} for p in state["products"]]
    ai = resolve_active_ai_credentials()
    if req.company_name:
        state["company"]["name"] = req.company_name
    if req.framework:
        state["company"]["framework"] = req.framework

    price_context = "\n".join(f"- {p['sku']}: {p['name']} | Sell: RM {p['sellPrice']}" for p in state["products"])

    recent_context_str = "\n".join(
        f"  [{as_customer_text(m.sender)}]: {as_customer_text(m.text)}"
        for m in (req.recent_messages or [])[-8:]
    ) or "  (First message in current view)"

    sender_turn_note = ""
    if req.last_sender == "ME" and req.last_my_message:
        sender_turn_note = f"""
[IMPORTANT TURN AWARENESS: OWNER ALREADY REPLIED]
The message "{req.last_my_message}" was sent by the BUSINESS OWNER (You), NOT the customer!
The customer's prior inquiry was: "{req.last_client_message or req.message}".
Do NOT analyze the owner's own message as a new inquiry. Draft a polite follow-up or confirmation if needed.
"""

    custom_directive_block = ""
    if (req.user_instruction or "").strip():
        custom_directive_block = f"""
[USER'S CUSTOM QUOTATION / REPLY INSTRUCTION (HIGHEST PRIORITY)]
The business owner explicitly requested: "{req.user_instruction.strip()}"
You MUST adjust the quotation items, quantities, installation labor, discounts and all recommended reply options to strictly follow this instruction!
"""

    tier_instruction = {
        "NEW_CLIENT": "\n[CLIENT TIER DIRECTIVE: NEW CLIENT]\nThis is a brand NEW customer. Be warm, welcoming and clear. Itemize prices accurately.",
        "SLOW_PAYER_GHOST_RISK": "\n[CLIENT TIER DIRECTIVE: GHOSTING RISK]\nThis customer often goes quiet after a quote. Be friendly and ask for a clear yes or no.",
        "VIP_FAST_PAYER": "\n[CLIENT TIER DIRECTIVE: VIP]\nThis is a high-value, trusted repeat customer. Keep the tone warm, fast and friendly.",
    }.get(tier, "")

    system_prompt = build_whatsapp_copilot_system_prompt(
        company_name=state["company"]["name"],
        stock_context=price_context,
        framework=state["company"]["framework"],
        clean_cust_req=clean_customer_name(req.customer),
        phone=req.phone or "",
        tier=tier,
        score=mem["score"],
        pay_behavior=mem["paymentBehavior"],
        detected_style=mem["styleSummary"],
        recent_context_str=recent_context_str,
        tier_instruction=tier_instruction,
        sender_turn_note=sender_turn_note,
        custom_directive_block=custom_directive_block,
    )
    user_prompt = build_whatsapp_copilot_user_prompt(
        customer=req.customer,
        phone=req.phone or "",
        inquiry_message=req.last_client_message or req.message,
        last_my_message=req.last_my_message if req.last_sender == "ME" else None,
        user_instruction=req.user_instruction,
    )

    fallback = deterministic_fallback_analysis(req.customer, req.phone or "", req.message, state, user_instruction=req.user_instruction or "")
    fallback["clientMemory"] = mem

    strict_mode = bool(os.getenv("CASHCHASE_STRICT_AI", "0") in ("1", "true", "True") or req.strict_ai)

    # The model call happens outside any database session: it can take 10s+ and must not hold a connection.
    try:
        llm_res = call_lmstudio_chat(ai["base_url"], ai["model"], system_prompt, user_prompt, api_key=ai["api_key"])
    except Exception as e:
        if strict_mode:
            raise HTTPException(
                status_code=503,
                detail=f"Strict AI mode is ON: Live AI service is unreachable ({str(e)}). Templated fallback blocked."
            )
        with session_scope() as s:
            _add_tin_request(s, fallback, req.customer)
            if fallback.get("intent") != "CASUAL_CHAT":
                _save_memory(s, req, mem, fallback)
        return {
            "source": "deterministic_fallback",
            "lmstudio_connected": False,
            "error": str(e),
            "raw_prompt": system_prompt + "\n\n" + user_prompt,
            "raw_llm_output": json.dumps(fallback, indent=2),
            "analysis": fallback,
        }

    with session_scope() as s:
        _add_tin_request(s, fallback, req.customer)
        parsed = extract_json_from_llm(llm_res["clean_content"]) or {}
        merged = {**fallback, **{k: v for k, v in parsed.items() if v is not None and v != ""}, "clientMemory": mem}

        # Code, not the AI, decides the action and prices the quote
        if fallback.get("intent") == "PRODUCT_CONSULTATION" or parsed.get("intent") == "PRODUCT_CONSULTATION":
            merged["intent"] = "PRODUCT_CONSULTATION"
            merged["extActionType"] = "REPLY_ONLY"
            merged["extBtnLabel"] = fallback.get("extBtnLabel", "💬 Reply with Product Consultation")
            merged["sku"] = fallback.get("sku")
            merged["qty"] = 0
            merged["amount"] = 0
            for k in ("extTitle", "extCheck", "extActionDesc"):
                if k in fallback:
                    merged[k] = fallback[k]
        elif fallback.get("intent") == "BUYING_INQUIRY":
            merged["intent"] = "BUYING_INQUIRY"
            merged["extActionType"] = "CREATE_QUOTE"
            merged["extBtnLabel"] = fallback.get("extBtnLabel", "Send quote & insert reply")
            for k in ("items", "amount", "marginOk", "commissionRm", "extCheck", "qty", "sku", "extraSku", "extraQty"):
                if k in fallback:
                    merged[k] = fallback[k]
        elif fallback.get("intent") == "DISCOUNT_REQUEST":
            merged["intent"] = "DISCOUNT_REQUEST"
            merged["extActionType"] = fallback.get("extActionType", "SEND_COUNTER_OFFER")
            for k in ("amount", "discount", "marginOk", "extCheck"):
                if k in fallback:
                    merged[k] = fallback[k]
        elif fallback.get("intent") == "CUSTOMER_CONFIRMED":
            merged["intent"] = "CUSTOMER_CONFIRMED"
            merged["extActionType"] = "MARK_WON"
            for k in ("depositRef", "depositAmount", "dealId"):
                if k in fallback:
                    merged[k] = fallback[k]
        elif fallback.get("intent") == "CUSTOMER_DECLINED":
            merged["intent"] = "CUSTOMER_DECLINED"
            merged["extActionType"] = "MARK_LOST"
            for k in ("lossReasonSuggestion", "dealId"):
                if k in fallback:
                    merged[k] = fallback[k]
        elif fallback.get("intent") == "COMPLAINT":
            merged["intent"] = "COMPLAINT"
            merged["extActionType"] = "LOG_COMPLAINT"
            for k in ("dealId",):
                if k in fallback:
                    merged[k] = fallback[k]
        elif fallback.get("intent") == "FOLLOW_UP_DUE":
            merged["intent"] = "FOLLOW_UP_DUE"
            merged["extActionType"] = "SEND_FOLLOW_UP"
            for k in ("dealId", "followUp"):
                if k in fallback:
                    merged[k] = fallback[k]
        elif fallback.get("intent") == "SAVE_LHDN_TIN":
            for k in ("intent", "extActionType", "extBtnLabel", "tin", "ssmBrn", "extCheck"):
                merged[k] = fallback.get(k)
        elif fallback.get("intent") == "CASUAL_CHAT":
            merged["intent"] = "CASUAL_CHAT"
            merged["extActionType"] = "NO_ACTION"
            merged["extBtnLabel"] = "💬 Insert Selected Reply"

        # Every RM amount in an AI reply must be one CashChase calculated; pressure wording is blocked.
        merged = check_ai_replies(merged, fallback, state, req.customer)
        _add_tin_request(s, merged, req.customer)
        if merged.get("intent") != "CASUAL_CHAT":
            _save_memory(s, req, mem, merged)
    return {
        "source": "lmstudio",
        "lmstudio_connected": True,
        "model_used": llm_res["model_used"],
        "raw_prompt": system_prompt + "\n\n" + user_prompt,
        "raw_llm_output": llm_res["raw_content"],
        "analysis": merged,
    }


def _add_tin_request(session: Session, analysis: Dict[str, Any], customer: str) -> None:
    """If this customer has no LHDN TIN on file, offer a ready-made WhatsApp reply asking for it."""
    if analysis.get("intent") == "SAVE_LHDN_TIN" or not isinstance(analysis.get("replyOptions"), list):
        return
    row = get_customer(session, customer)
    if row is not None and row.tin:
        return
    if any("TIN" in str(o.get("label", "")) or "TIN" in str(o.get("text", "")) for o in analysis["replyOptions"] if isinstance(o, dict)):
        return
    company = load_business(session).company_name or "us"
    analysis["replyOptions"].append({"label": "🧾 Ask for LHDN e-Invoice TIN", "text": tin_request_text(customer, company)})
    analysis["tinMissing"] = True


@router.post("/api/whatsapp/execute", response_model=ActionResponse)
def api_whatsapp_execute(req: WhatsAppExecuteRequest) -> ActionResponse:
    role = normalize_role(req.role)
    action = req.action_type

    if action in ("REPLY_ONLY", "NO_ACTION"):
        with session_scope() as s:
            log(s, f"[{role}] Sent WhatsApp message to {req.customer}.")
        return ActionResponse(status="ok", state=build_state(role))

    if action == "CREATE_QUOTE":
        deal_items = req.items
        if not deal_items:
            sku = req.sku or "ACN-DAI-15"
            qty = req.qty or 1
            deal_items = [DealItemRequest(sku=sku, qty=qty)]
        create_req = DealCreateRequest(
            role=role,
            customer=req.customer,
            phone=req.phone or "",
            items=deal_items,
            discount=req.discount or 0,
            quote=True,
        )
        res = api_create_deal(create_req)
        return ActionResponse(status="ok", created_id=res.created_id, created_deal_id=res.created_id, state=res.state)

    if action in ("SEND_COUNTER_OFFER", "ASK_OWNER"):
        deal_id = req.deal_id
        if not deal_id:
            with session_scope() as s:
                d = _find_open_deal(s, req.customer)
                if not d:
                    raise HTTPException(status_code=404, detail=f"No open deal found for {req.customer} to discount.")
                deal_id = d.id
        return api_deal_action(deal_id, DealActionRequest(role=role, action=DealAction.APPLY_DISCOUNT, discount=req.discount or 0))

    if action == "SEND_FOLLOW_UP":
        deal_id = req.deal_id
        if not deal_id:
            with session_scope() as s:
                d = _find_open_deal(s, req.customer)
                if not d:
                    raise HTTPException(status_code=404, detail=f"No open deal found for {req.customer} to follow up.")
                deal_id = d.id
        return api_deal_action(deal_id, DealActionRequest(role=role, action=DealAction.SEND_FOLLOW_UP))

    if action == "MARK_WON":
        deal_id = req.deal_id
        if not deal_id:
            with session_scope() as s:
                d = _find_open_deal(s, req.customer)
                if not d:
                    raise HTTPException(status_code=404, detail=f"No open deal found for {req.customer} to mark won.")
                deal_id = d.id
        return api_deal_action(
            deal_id,
            DealActionRequest(
                role=role,
                action=DealAction.MARK_WON,
                deposit_ref=req.deposit_ref or "",
                deposit_amount=req.deposit_amount,
            )
        )

    if action == "MARK_LOST":
        deal_id = req.deal_id
        if not deal_id:
            with session_scope() as s:
                d = _find_open_deal(s, req.customer)
                if not d:
                    raise HTTPException(status_code=404, detail=f"No open deal found for {req.customer} to mark lost.")
                deal_id = d.id
        reason = req.reason or "Customer declined on WhatsApp"
        return api_deal_action(deal_id, DealActionRequest(role=role, action=DealAction.MARK_LOST, reason=reason))

    if action == "LOG_COMPLAINT":
        deal_id = req.deal_id
        if not deal_id:
            with session_scope() as s:
                d = _find_open_deal(s, req.customer)
                if d:
                    deal_id = d.id
        if deal_id:
            return api_deal_action(deal_id, DealActionRequest(role=role, action=DealAction.PAUSE, note=req.note or "Customer complaint on WhatsApp"))
        else:
            with session_scope() as s:
                log(s, f"[{role}] Logged complaint for {req.customer}: {req.note or 'Issue reported on WhatsApp'}")
            return ActionResponse(status="ok", state=build_state(role))

    if action == "SAVE_LHDN_TIN":
        with session_scope() as s:
            tin = parse_tin(req.tin or "")
            if not tin:
                raise HTTPException(status_code=400, detail=f"'{req.tin}' does not look like an LHDN TIN (e.g. C2588190021).")
            gate = enforce(
                s, role, "deal.set_tin", handler="whatsapp_execute", payload={"body": req.model_dump()},
                summary=f"Save LHDN TIN {tin} for {req.customer}",
            )
            if gate:
                return gate
            ssm = parse_ssm(req.ssm_brn or "") or ""
            updated = apply_tin(s, req.customer, tin, ssm, now_time_str())
            log(
                s,
                f"[{role}] Saved LHDN TIN {tin}" + (f" / SSM {ssm}" if ssm else "") + f" for {clean_customer_name(req.customer)} from WhatsApp"
                + (f" (open deals: {', '.join('#' + i for i in updated)})." if updated else "."),
            )
        return ActionResponse(status="ok", state=build_state(role), updated=updated)

    raise HTTPException(status_code=400, detail=f"Unknown action: {action}")


@router.post("/api/customers", response_model=ActionResponse)
def api_create_customer(req: CustomerCreateRequest) -> ActionResponse:
    role = normalize_role(req.role)
    with session_scope() as s:
        upsert_customer(s, req.name, now_time_str(), phone=req.phone or "")
        log(s, f"[{role}] Added customer {clean_customer_name(req.name)} to directory.")
    return ActionResponse(status="ok", state=build_state(role))


@router.post("/api/whatsapp/photo-quote", response_model=PhotoQuoteResponse)
def api_whatsapp_photo_quote(req: PhotoQuoteRequest) -> Dict[str, Any]:
    check_upload_type(req.image_base64)
    extracted = extract_items_from_image(req.image_base64, req.file_name or "photo.jpg")
    if not extracted.get("success") or not extracted.get("items"):
        return {
            "status": "unreadable",
            "editable": False,
            "items": [],
            "analysis": {
                "intent": "CASUAL_CHAT",
                "badge": "Unreadable Photo",
                "extTitle": "Couldn't read the photo, please type the items",
                "extCheck": "The image or document text could not be clearly recognized.\nPlease type the items or send a clearer photo.",
                "extActionDesc": "Type the items in chat to generate a quote.",
                "extDraft": "Sorry Boss, couldn't quite catch the items from the photo. Could you type what you need?",
                "replyOptions": [
                    {"label": "Ask to type items", "text": "Sorry Boss, couldn't quite catch the items from the photo. Could you type what you need?"}
                ],
                "extActionType": "NO_ACTION",
                "extBtnLabel": "💬 Ask customer to type items",
            }
        }
    with session_scope() as s:
        matched = match_items_to_products(extracted["items"], s)
        subtotal_rm = sum(it["lineTotal"] for it in matched)
        lines_summary = "\n".join(f"{it['qty']}x {it['name']} · RM {it['lineTotal']:,}" for it in matched)
        items_line = ", ".join(f"{it['qty']}x {it['name']}" for it in matched)
        draft_msg = f"Hi {clean_customer_name(req.customer)}! Based on your photo, here is the quotation: {items_line} = RM {subtotal_rm:,}. Subject to stock availability · prices valid 7 days."
        analysis = {
            "intent": "BUYING_INQUIRY",
            "isCustomer": True,
            "badge": "Photo Quote",
            "extTitle": f"Photo Order Quote for {clean_customer_name(req.customer)}",
            "extCheck": f"{lines_summary}\nTotal: RM {subtotal_rm:,}\nSubject to stock availability · prices valid 7 days",
            "extActionDesc": "Review and edit the line items below, then create the quote.",
            "extDraft": draft_msg,
            "replyOptions": [
                {
                    "label": "Photo Quote Reply",
                    "text": draft_msg
                }
            ],
            "extActionType": "CREATE_QUOTE",
            "extBtnLabel": "Send quote & insert reply",
            "items": matched,
            "amount": subtotal_rm,
            "discount": 0,
            "marginOk": True,
        }
        return {
            "status": "extracted",
            "editable": True,
            "items": matched,
            "subtotal": subtotal_rm,
            "disclaimer": "Subject to stock availability · prices valid 7 days",
            "analysis": analysis,
        }


@router.post("/api/ocr/extract", response_model=OcrExtractResponse)
def api_ocr_extract(payload: Dict[str, Any]) -> Dict[str, Any]:
    b64 = payload.get("imageBase64") or payload.get("image_base64")
    check_upload_type(b64)
    fname = payload.get("fileName") or payload.get("file_name") or "doc.png"
    return extract_items_from_image(b64 or "", fname)


@router.post("/api/receipts/save", response_model=ReceiptSaveResponse)
def api_receipts_save(payload: Dict[str, Any]) -> Dict[str, Any]:
    b64 = payload.get("imageBase64") or payload.get("image_base64")
    check_upload_type(b64)
    return {"status": "ok"}


register_handler("whatsapp_execute", api_whatsapp_execute, WhatsAppExecuteRequest)
