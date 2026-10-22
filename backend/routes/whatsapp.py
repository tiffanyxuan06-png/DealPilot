"""WhatsApp copilot. Phase 3 (docs/11 §4) rewrites analyze for sales intents and execute for deal actions."""
import json
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy.orm import Session

from backend.db import orm, session_scope
from backend.models.requests import WhatsAppAnalyzeRequest, WhatsAppExecuteRequest
from backend.models.responses import ClientMemoryRating, WhatsAppAnalyzeResponse
from backend.models.state import ActionResponse
from backend.services.business import load_business
from backend.services.clock import now_time_str
from backend.services.customers import apply_tin, get_customer, parse_ssm, parse_tin, tin_request_text
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


@router.post("/api/whatsapp/analyze", response_model=WhatsAppAnalyzeResponse)
def api_whatsapp_analyze(req: WhatsAppAnalyzeRequest) -> Dict[str, Any]:
    state = build_state().model_dump(by_alias=True)  # Staff view: no unit costs reach the AI
    # ponytail: the old copilot prompt still expects a "stock" list; Phase 3 replaces it with the price list.
    state["stock"] = [{**p, "onHand": 0, "onHold": 0, "available": 0} for p in state["products"]]
    ai = resolve_active_ai_credentials()
    if req.company_name:
        state["company"]["name"] = req.company_name
    if req.framework:
        state["company"]["framework"] = req.framework

    mem = compute_client_memory_rating(req.customer, req.phone or "", req.message)
    tier = mem["tier"]
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

    # The model call happens outside any database session: it can take 10s+ and must not hold a connection.
    try:
        llm_res = call_lmstudio_chat(ai["base_url"], ai["model"], system_prompt, user_prompt, api_key=ai["api_key"])
    except Exception as e:
        with session_scope() as s:
            _add_tin_request(s, fallback, req.customer)
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
        # Code, not the AI, decides the action and prices the quote.
        if merged.get("intent") == "BUYING_INQUIRY" and fallback.get("intent") == "BUYING_INQUIRY":
            for k in ("extActionType", "extBtnLabel", "sku", "qty", "extraSku", "extraQty", "amount"):
                merged[k] = fallback.get(k)
        elif merged.get("intent") in ("BUYING_INQUIRY", "GENERAL_INQUIRY", "CASUAL_CHAT"):
            merged["extActionType"] = "REPLY_ONLY"
            merged["extBtnLabel"] = "💬 Insert Selected Reply"
        if fallback.get("intent") == "SAVE_LHDN_TIN":
            for k in ("intent", "extActionType", "extBtnLabel", "tin", "ssmBrn", "extCheck"):
                merged[k] = fallback.get(k)
        # Every RM amount in an AI reply must be one CashChase calculated; pressure wording is blocked.
        merged = check_ai_replies(merged, fallback, state, req.customer)
        _add_tin_request(s, merged, req.customer)
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
    if any("LHDN TIN" in str(o.get("label", "")) for o in analysis["replyOptions"] if isinstance(o, dict)):
        return
    company = load_business(session).company_name or "us"
    analysis["replyOptions"].append({"label": "🧾 Ask for LHDN e-Invoice TIN", "text": tin_request_text(customer, company)})
    analysis["tinMissing"] = True


@router.post("/api/whatsapp/execute", response_model=ActionResponse)
def api_whatsapp_execute(req: WhatsAppExecuteRequest) -> ActionResponse:
    role = normalize_role(req.role)
    action = req.action_type
    with session_scope() as s:
        if action in ("REPLY_ONLY", "NO_ACTION"):
            log(s, f"[{role}] Sent WhatsApp message to {req.customer}.")
            updated = None
        elif action == "SAVE_LHDN_TIN":
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
        else:
            raise HTTPException(
                status_code=501,
                detail=f"WhatsApp action {action} is being rebuilt for deals (docs/11 §4.4). Use /api/deals for now.",
            )
    return ActionResponse(status="ok", state=build_state(role), updated=updated)


register_handler("whatsapp_execute", api_whatsapp_execute, WhatsAppExecuteRequest)
