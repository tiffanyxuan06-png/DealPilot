"""WhatsApp copilot. Phase 3 (docs/11 §4) rewrites analyze for sales intents and execute for deal actions."""
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

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
    ReengageRequest,
    WhatsAppAnalyzeRequest,
    WhatsAppExecuteRequest,
)
from backend.models.responses import ClientMemoryRating, OcrExtractResponse, PhotoQuoteResponse, ReceiptSaveResponse, WhatsAppAnalyzeResponse
from backend.models.state import ActionResponse
from backend.routes.deals import api_create_deal, api_deal_action
from backend.services.business import load_business
from backend.services.clock import now_stamp, now_time_str
from backend.services.customers import (
    apply_tin,
    find_customer,
    get_customer,
    parse_ssm,
    parse_tin,
    tin_request_text,
    upsert_customer,
)
from backend.services.lmstudio import call_lmstudio_chat, extract_json_from_llm
from backend.services.memory import clean_customer_name, compute_client_memory_rating, find_memory_by_phone
from backend.services.permissions import enforce, normalize_role, register_handler
from backend.services.pipeline import build_state, log, resolve_active_ai_credentials, staff_rep_id
from backend.services.sales_flow import (
    build_deal_context,
    next_best_action,
    generate_fallback_replies,
)
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


def _resolve_customer(customer: str, phone: str) -> Tuple[str, str, bool]:
    """(name, phone, registered). A number-titled chat resolves to the stored customer: stored name and phone."""
    with session_scope() as s:
        row = find_customer(s, customer, phone)
        if row is None:
            return customer, phone, False
        if not row.phone:  # a number that belongs to another customer is not this one's
            other = find_customer(s, "", phone)
            phone = "" if other and other.name != row.name else phone
        return row.name, row.phone or phone, True


def _save_memory(session: Session, customer: str, phone: str, req: WhatsAppAnalyzeRequest, mem: Dict[str, Any], analysis: Dict[str, Any]) -> None:
    old = session.get(orm.ClientMemory, customer.strip())
    session.merge(
        orm.ClientMemory(
            customer=customer.strip(),
            phone=phone or (old.phone if old else ""),
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
            # The analysed message is the customer's latest one, so this is when they last wrote.
            last_customer_at=now_stamp() if req.message else (old.last_customer_at if old else ""),
        )
    )


def _find_client_memory(session: Session, customer: str, phone: str = "") -> Optional[orm.ClientMemory]:
    c_clean = clean_customer_name(customer).strip()
    mem = session.scalars(select(orm.ClientMemory).where(orm.ClientMemory.customer.ilike(c_clean))).first()
    return mem or find_memory_by_phone(session, phone)


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
    customer, phone, registered = _resolve_customer(req.customer, req.phone or "")
    mem = compute_client_memory_rating(customer, phone, req.message)
    tier = mem["tier"]

    # Customer allowlist check (docs/11 §4.1)
    cached_pending = None
    open_deal_dict = None
    with session_scope() as s:
        mem_row = _find_client_memory(s, customer, phone)
        if mem_row and mem_row.cached_analysis_json:
            try:
                cached_pending = json.loads(mem_row.cached_analysis_json).get("pendingOffer")
            except Exception:
                pass
        open_deal_row = _find_open_deal(s, customer)
        if open_deal_row:
            open_deal_dict = {
                "id": open_deal_row.id,
                "stage": open_deal_row.stage,
                "amount": open_deal_row.amount,
                "items": [
                    {
                        "sku": it.get("sku") if isinstance(it, dict) else getattr(it, "sku", ""),
                        "qty": it.get("qty", 1) if isinstance(it, dict) else getattr(it, "qty", 1),
                    }
                    for it in (open_deal_row.items or [])
                ],
            }
    if not registered:
        analysis = {
            "intent": "NOT_A_CUSTOMER",
            "isCustomer": False,
            "badge": "Not a customer",
            "extTitle": f"{clean_customer_name(customer)} (Not in Directory)",
            "extCheck": "🟡 Contact not registered in customer directory.\nClick 'Add as customer' to enable sales quotes and tracking.",
            "extActionDesc": "Add this contact to your customer list to start tracking deals.",
            "extDraft": f"Hi {clean_customer_name(customer)}, thanks for reaching out! Let me get your details registered with our team.",
            "replyOptions": [
                {"label": "Register Contact", "text": f"Hi {clean_customer_name(customer)}, thanks for reaching out! Let me get your details registered with our team."}
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
You MUST adjust items, prices, discounts, and reply tone to match this instruction.
CRITICAL: If the instruction mentions internal CRM actions (such as "Mark won", "Mark lost", "Auto-pause reminders"), execute them internally for "extActionType". Customer-facing replies (extDraft and replyOptions) MUST ALWAYS use natural, empathetic merchant language (e.g. "Order confirmed!", "We will replace the item for you immediately!"). NEVER tell the customer internal CRM actions, prompt commands, or backend statuses (e.g. NEVER say "we've paused reminders", "reminders paused", "marked WON", "deal closed"). Customers should only receive direct, polite customer service!
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
        clean_cust_req=clean_customer_name(customer),
        phone=phone,
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
        customer=customer,
        phone=phone,
        inquiry_message=req.last_client_message or req.message,
        last_my_message=req.last_my_message if req.last_sender == "ME" else None,
        user_instruction=req.user_instruction,
    )

    # Build deal context from complete chat history
    # The extension labels lines "You" / "Client (name)" with isMe; the WebApp uses "ME" / "Them". Normalise both,
    # or the history is ignored and the quote the rep already sent is never seen.
    recent_msgs = [
        {"sender": "ME" if (m.is_me or m.sender.strip().lower() in ("me", "you")) else "Them", "text": m.text}
        for m in (req.recent_messages or [])
    ]
    deal_ctx = build_deal_context(
        customer=customer,
        phone=phone,
        messages=recent_msgs,
        current_message=req.message,
        products=state["products"],
        open_deal=open_deal_dict,
        cached_pending_offer=cached_pending,
    )
    deal_action = next_best_action(
        deal_ctx,
        products=state["products"],
        goal=req.goal,
        framework=state["company"]["framework"],
    )
    sales_replies = generate_fallback_replies(deal_ctx, deal_action, state["products"])

    fallback = deterministic_fallback_analysis(customer, phone, req.message, state, user_instruction=req.user_instruction or "")
    fallback["clientMemory"] = mem
    fallback["stage"] = deal_action["stage"]
    fallback["stageSteps"] = deal_action["stageSteps"]
    fallback["stageIndex"] = deal_action["stageIndex"]
    fallback["coachTip"] = deal_action["coachTip"]
    fallback["chips"] = deal_action["chips"]
    fallback["wants"] = deal_action["wants"]
    fallback["missing"] = deal_action["missing"]
    fallback["quotePreview"] = deal_action["quotePreview"]
    fallback["compare"] = deal_action["compare"]
    fallback["pendingOffer"] = deal_action["pendingOffer"]

    if deal_action["stage"] == "CASUAL" or fallback.get("intent") == "CASUAL_CHAT":
        fallback["intent"] = "CASUAL_CHAT"
        fallback["extActionType"] = "NO_ACTION"
        fallback["extBtnLabel"] = "💬 Insert Selected Reply"
        fallback["amount"] = 0

    elif deal_action["stage"] == "NEGOTIATING" or fallback.get("intent") == "DISCOUNT_REQUEST":
        fallback["intent"] = "DISCOUNT_REQUEST"
        fallback["extActionType"] = "SEND_COUNTER_OFFER"
        fallback["extBtnLabel"] = deal_action["btnLabel"]
        if deal_action.get("quotePreview"):
            fallback["amount"] = deal_action["quotePreview"]["total"]
            fallback["items"] = deal_action["quotePreview"]["items"]
        if deal_action["stage"] == "NEGOTIATING":
            # Talk about the quote this customer actually has (from the chat), not a stock example.
            wants = deal_action.get("wants") or "this order"
            total = (deal_action.get("quotePreview") or {}).get("total")
            on = f"{wants} (RM {total:,})" if total else wants
            fallback["extTitle"] = f"🤝 Discount request on {on}"
            fallback["extCheck"] = (
                f"🛡️ They want a lower price on {on}.\n"
                "Offer a value-add (free piping or delivery) instead of cutting the unit price. "
                "A discount below the margin floor needs the Owner's approval."
            )
            fallback["replyOptions"] = sales_replies
            fallback["extDraft"] = sales_replies[0]["text"]

    elif deal_action["actionType"] == "OFFER_QUOTE":
        fallback["intent"] = "BUYING_INQUIRY"
        fallback["extActionType"] = "OFFER_QUOTE"
        fallback["extBtnLabel"] = deal_action["btnLabel"]
        fallback["extTitle"] = f"📄 Quotation Ready to Offer ({deal_action['wants']})"
        fallback["extCheck"] = (
            f"📋 Quotation Handshake:\n"
            f"- Customer interested in: {deal_action['wants']}\n"
            f"- Recommended step: Ask customer if they want an official quotation.\n"
            f"- Once customer confirms (yes/ok), copilot advances to Quote Generation."
        )
        fallback["extDraft"] = sales_replies[0]["text"]
        fallback["replyOptions"] = sales_replies
        fallback["sku"] = deal_action["sku"]
        fallback["qty"] = deal_action["qty"]
        if deal_action.get("quotePreview"):
            fallback["amount"] = deal_action["quotePreview"]["total"]
            fallback["items"] = deal_action["quotePreview"]["items"]

    elif deal_action["actionType"] == "CREATE_QUOTE":
        fallback["intent"] = "BUYING_INQUIRY"
        fallback["extActionType"] = "CREATE_QUOTE"
        fallback["extBtnLabel"] = deal_action["btnLabel"]
        fallback["extTitle"] = f"🚀 Quotation Confirmed ({deal_action['wants']})"
        fallback["extCheck"] = (
            f"✅ Quotation Agreed:\n"
            f"- Items: {deal_action['wants']}\n"
            f"- Total: RM {deal_action['amount']:,}\n"
            f"- Ready to generate official deal and export PDF."
        )
        fallback["replyOptions"] = sales_replies
        fallback["extDraft"] = sales_replies[0]["text"]
        if deal_action.get("quotePreview"):
            fallback["amount"] = deal_action["quotePreview"]["total"]
            fallback["items"] = deal_action["quotePreview"]["items"]

    elif deal_action["stage"] in ("RECOMMEND", "DISCOVERY"):
        fallback["intent"] = "PRODUCT_CONSULTATION"
        fallback["extActionType"] = "REPLY_ONLY"
        fallback["extBtnLabel"] = deal_action["btnLabel"]
        fallback["replyOptions"] = sales_replies
        fallback["extDraft"] = sales_replies[0]["text"]

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
            _add_tin_request(s, fallback, customer)
            if fallback.get("intent") != "CASUAL_CHAT":
                _save_memory(s, customer, phone, req, mem, fallback)
        return {
            "source": "deterministic_fallback",
            "lmstudio_connected": False,
            "error": str(e),
            "raw_prompt": system_prompt + "\n\n" + user_prompt,
            "raw_llm_output": json.dumps(fallback, indent=2),
            "analysis": fallback,
        }

    with session_scope() as s:
        _add_tin_request(s, fallback, customer)
        parsed = extract_json_from_llm(llm_res["clean_content"]) or {}
        merged = {**fallback, **{k: v for k, v in parsed.items() if v is not None and v != ""}, "clientMemory": mem}

        merged["stage"] = fallback.get("stage", deal_action["stage"])
        merged["stageSteps"] = fallback.get("stageSteps", deal_action["stageSteps"])
        merged["stageIndex"] = fallback.get("stageIndex", deal_action["stageIndex"])
        merged["coachTip"] = parsed.get("coachTip") or fallback.get("coachTip", deal_action["coachTip"])
        merged["chips"] = fallback.get("chips", deal_action["chips"])
        merged["wants"] = fallback.get("wants", deal_action["wants"])
        merged["missing"] = fallback.get("missing", deal_action["missing"])
        merged["quotePreview"] = fallback.get("quotePreview", deal_action["quotePreview"])
        merged["compare"] = fallback.get("compare", deal_action["compare"])
        merged["pendingOffer"] = fallback.get("pendingOffer", deal_action["pendingOffer"])

        # Code, not the AI, decides the action and prices the quote. Casual chat goes first so the AI cannot
        # relabel it (e.g. as PRODUCT_CONSULTATION) and get it saved to client memory.
        if fallback.get("intent") == "CASUAL_CHAT":
            merged["intent"] = "CASUAL_CHAT"
            merged["extActionType"] = "NO_ACTION"
            merged["extBtnLabel"] = "💬 Insert Selected Reply"
            merged["amount"] = 0
            merged["items"] = []
        elif fallback.get("extActionType") == "OFFER_QUOTE":
            merged["intent"] = "BUYING_INQUIRY"
            merged["extActionType"] = "OFFER_QUOTE"
            merged["extBtnLabel"] = fallback.get("extBtnLabel")
            merged["sku"] = fallback.get("sku")
            merged["qty"] = fallback.get("qty", 0)
            if fallback.get("quotePreview"):
                merged["amount"] = fallback["quotePreview"]["total"]
                merged["items"] = fallback["quotePreview"]["items"]
        elif fallback.get("intent") == "PRODUCT_CONSULTATION" or parsed.get("intent") == "PRODUCT_CONSULTATION":
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

        # Every RM amount in an AI reply must be one DealPilot calculated; pressure wording is blocked.
        merged = check_ai_replies(merged, fallback, state, customer)
        _add_tin_request(s, merged, customer)
        if merged.get("intent") != "CASUAL_CHAT":
            _save_memory(s, customer, phone, req, mem, merged)
    return {
        "source": "lmstudio",
        "provider": ai.get("provider", "lmstudio"),
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
    customer, phone, known = _resolve_customer(req.customer, req.phone or "")
    action = req.action_type

    # A stranger leaves no trace: nothing is logged or saved for a contact that is not a customer.
    if action in ("REPLY_ONLY", "NO_ACTION", "OFFER_QUOTE"):
        if not known:
            return ActionResponse(status="ok", state=build_state(role))

    if action in ("REPLY_ONLY", "NO_ACTION"):
        with session_scope() as s:
            log(s, f"[{role}] Sent WhatsApp message to {customer}.")
        return ActionResponse(status="ok", state=build_state(role))

    if action == "OFFER_QUOTE":
        with session_scope() as s:
            mem_row = _find_client_memory(s, customer, phone)
            if mem_row:
                try:
                    data = json.loads(mem_row.cached_analysis_json or "{}")
                except Exception:
                    data = {}
                data["pendingOffer"] = "QUOTE"
                mem_row.cached_analysis_json = json.dumps(data)
            log(s, f"[{role}] Offered formal quotation to {customer}.")
        return ActionResponse(status="ok", state=build_state(role))

    if action == "CREATE_QUOTE":
        deal_items = req.items
        if not deal_items:
            if not req.sku:
                raise HTTPException(status_code=400, detail="Add at least one item to quote.")
            deal_items = [DealItemRequest(sku=req.sku, qty=req.qty or 1)]
        create_req = DealCreateRequest(
            role=role,
            customer=customer,
            phone=phone,
            items=deal_items,
            discount=req.discount or 0,
            quote=True,
        )
        res = api_create_deal(create_req)
        with session_scope() as s:
            mem_row = _find_client_memory(s, customer, phone)
            if mem_row and mem_row.cached_analysis_json:
                try:
                    data = json.loads(mem_row.cached_analysis_json)
                    data.pop("pendingOffer", None)
                    mem_row.cached_analysis_json = json.dumps(data)
                except Exception:
                    pass
        return ActionResponse(status="ok", created_id=res.created_id, created_deal_id=res.created_id, state=res.state)

    if action in ("SEND_COUNTER_OFFER", "ASK_OWNER"):
        deal_id = req.deal_id
        if not deal_id:
            with session_scope() as s:
                d = _find_open_deal(s, customer)
                if not d:
                    raise HTTPException(status_code=404, detail=f"No open deal found for {customer} to discount.")
                deal_id = d.id
        return api_deal_action(deal_id, DealActionRequest(role=role, action=DealAction.APPLY_DISCOUNT, discount=req.discount or 0))

    if action == "SEND_FOLLOW_UP":
        deal_id = req.deal_id
        if not deal_id:
            with session_scope() as s:
                d = _find_open_deal(s, customer)
                if not d:
                    raise HTTPException(status_code=404, detail=f"No open deal found for {customer} to follow up.")
                deal_id = d.id
        return api_deal_action(deal_id, DealActionRequest(role=role, action=DealAction.SEND_FOLLOW_UP))

    if action == "MARK_WON":
        deal_id = req.deal_id
        if not deal_id:
            with session_scope() as s:
                d = _find_open_deal(s, customer)
                if not d:
                    raise HTTPException(status_code=404, detail=f"No open deal found for {customer} to mark won.")
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
                d = _find_open_deal(s, customer)
                if not d:
                    raise HTTPException(status_code=404, detail=f"No open deal found for {customer} to mark lost.")
                deal_id = d.id
        reason = req.reason or "Customer declined on WhatsApp"
        return api_deal_action(deal_id, DealActionRequest(role=role, action=DealAction.MARK_LOST, reason=reason))

    if action == "LOG_COMPLAINT":
        deal_id = req.deal_id
        if not deal_id:
            with session_scope() as s:
                d = _find_open_deal(s, customer)
                if d:
                    deal_id = d.id
        if deal_id:
            return api_deal_action(deal_id, DealActionRequest(role=role, action=DealAction.PAUSE, note=req.note or "Customer complaint on WhatsApp"))
        else:
            with session_scope() as s:
                if known:
                    log(s, f"[{role}] Logged complaint for {customer}: {req.note or 'Issue reported on WhatsApp'}")
            return ActionResponse(status="ok", state=build_state(role))

    if action == "SAVE_LHDN_TIN":
        with session_scope() as s:
            tin = parse_tin(req.tin or "")
            if not tin:
                raise HTTPException(status_code=400, detail=f"'{req.tin}' does not look like an LHDN TIN (e.g. C2588190021).")
            gate = enforce(
                s, role, "deal.set_tin", handler="whatsapp_execute", payload={"body": req.model_dump()},
                summary=f"Save LHDN TIN {tin} for {customer}",
            )
            if gate:
                return gate
            ssm = parse_ssm(req.ssm_brn or "") or ""
            updated = apply_tin(s, customer, tin, ssm, now_time_str())
            log(
                s,
                f"[{role}] Saved LHDN TIN {tin}" + (f" / SSM {ssm}" if ssm else "") + f" for {clean_customer_name(customer)} from WhatsApp"
                + (f" (open deals: {', '.join('#' + i for i in updated)})." if updated else "."),
            )
        return ActionResponse(status="ok", state=build_state(role), updated=updated)

    raise HTTPException(status_code=400, detail=f"Unknown action: {action}")


@router.post("/api/customers", response_model=ActionResponse)
def api_create_customer(req: CustomerCreateRequest) -> ActionResponse:
    role = normalize_role(req.role)
    with session_scope() as s:
        # A new customer goes to the default rep, like a new deal (routes/deals.py), so Staff see them before any quote
        upsert_customer(s, req.name, now_time_str(), phone=req.phone or "", rep_id=staff_rep_id(s))
        log(s, f"[{role}] Added customer {clean_customer_name(req.name)} to directory.")
    return ActionResponse(status="ok", state=build_state(role))


@router.post("/api/reengage", response_model=ActionResponse)
def api_reengage(req: ReengageRequest) -> ActionResponse:
    """Records what the rep did with a re-engage alert (one activity-log line). A send on an open deal goes
    through SEND_FOLLOW_UP instead, which logs and resets its timer."""
    role = normalize_role(req.role)
    name = clean_customer_name(req.customer)
    with session_scope() as s:
        log(s, f"[{role}] " + (f"Re-engaged {name} on WhatsApp." if req.action == "SENT" else f"Dismissed the re-engage alert for {name}."))
    return ActionResponse(status="ok", state=build_state(role))


@router.post("/api/whatsapp/photo-quote", response_model=PhotoQuoteResponse)
def api_whatsapp_photo_quote(req: PhotoQuoteRequest) -> Dict[str, Any]:
    check_upload_type(req.image_base64)
    customer, phone, registered = _resolve_customer(req.customer, req.phone or "")
    if not registered:  # a stranger's photo is never sent to the AI
        name = clean_customer_name(customer)
        return {
            "status": "not_a_customer",
            "editable": False,
            "items": [],
            "analysis": {
                "intent": "NOT_A_CUSTOMER",
                "isCustomer": False,
                "badge": "Not a customer",
                "extTitle": f"{name} (Not in Directory)",
                "extCheck": "🟡 Contact not registered in customer directory.\nClick 'Add as customer' to enable photo quotes.",
                "extActionDesc": "Add this contact to your customer list to start tracking deals.",
                "extDraft": "",
                "extActionType": "NO_ACTION",
                "extBtnLabel": "👤 Add as customer",
                "amount": 0,
            },
        }
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
                "amount": 0,
            }
        }
    with session_scope() as s:
        matched = match_items_to_products(extracted["items"], s)
        subtotal_rm = sum(it["lineTotal"] for it in matched)
        lines_summary = "\n".join(f"{it['qty']}x {it['name']} · RM {it['lineTotal']:,}" for it in matched)
        items_line = ", ".join(f"{it['qty']}x {it['name']}" for it in matched)
        draft_msg = f"Hi {clean_customer_name(customer)}! Based on your photo, here is the quotation: {items_line} = RM {subtotal_rm:,}. Subject to stock availability · prices valid 7 days."
        analysis = {
            "intent": "BUYING_INQUIRY",
            "isCustomer": True,
            "badge": "Photo Quote",
            "extTitle": f"Photo Order Quote for {clean_customer_name(customer)}",
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
