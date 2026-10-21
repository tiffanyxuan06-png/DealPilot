from typing import Any, Dict
from fastapi import APIRouter

from backend.database import build_state_payload
from backend.models.schemas import CompanyAgentAskRequest
from backend.services.lmstudio import call_lmstudio_chat
from backend.services.prompts import build_company_agent_system_prompt

router = APIRouter(tags=["Company AI Agent"])


@router.post("/api/agent/ask")
def api_company_agent_ask(req: CompanyAgentAskRequest) -> Dict[str, Any]:
    """
    Answers any owner/staff question about the company using LM Studio Local API
    with full real-time company state injected into the system prompt.
    """
    db_state = build_state_payload()
    lm_url = db_state["company"]["lmstudioUrl"]
    lm_key = db_state["company"]["lmstudioApiKey"]
    lm_model = db_state["company"]["lmstudioModel"]

    active_st = req.state if req.state and isinstance(req.state, dict) else db_state
    c_name = active_st.get("name") or active_st.get("company", {}).get("name", db_state["company"]["name"])
    cash = active_st.get("cashOnHand") if "cashOnHand" in active_st else db_state["company"]["cashOnHand"]
    stock_items = active_st.get("stock", db_state["stock"])
    invoices = active_st.get("invoices", db_state["invoices"])

    stock_val = sum(s.get("onHand", 0) * s.get("unitCost", 0) for s in stock_items)
    pending_in = sum(i.get("amount", 0) for i in invoices if i.get("type") in ("PENDING", "AFTERSALES", "PENDING_VERIFY"))
    pending_out = sum(i.get("amount", 0) for i in invoices if i.get("type") == "SUPPLIER_COST" and i.get("status") == "UNPAID_PAYABLE")
    core_nw = cash + stock_val
    full_nw = core_nw + pending_in - pending_out

    stock_lines = "\n".join(
        f"- {s.get('sku')}: {s.get('name')} | OnHand={s.get('onHand', 0)} | Held={s.get('onHold', 0)} | "
        f"Available={max(0, s.get('onHand', 0) - s.get('onHold', 0))} | Cost=RM {s.get('unitCost', 0)} | Sell=RM {s.get('sellPrice', 0)}"
        for s in stock_items
    )
    inv_lines = "\n".join(
        f"- {i.get('id')} | {i.get('party')} | RM {i.get('amount')} | {i.get('status')} | {i.get('itemsText', '')}"
        for i in invoices
    )

    system_prompt = build_company_agent_system_prompt(
        company_name=c_name,
        core_nw=core_nw,
        cash=cash,
        stock_val=stock_val,
        pending_in=pending_in,
        pending_out=pending_out,
        full_nw=full_nw,
        stock_lines=stock_lines,
        inv_lines=inv_lines,
    )

    try:
        llm_res = call_lmstudio_chat(lm_url, lm_model, system_prompt, req.question, api_key=lm_key, timeout=20.0)
        return {
            "lmstudio_connected": True,
            "model_used": llm_res["model_used"],
            "answer": llm_res["clean_content"],
            "raw_prompt": system_prompt + "\n\nUser Question:\n" + req.question,
            "raw_system_prompt": system_prompt,
        }
    except Exception as e:
        return {
            "lmstudio_connected": False,
            "error": str(e),
            "answer": None,
        }
