from typing import Any, Dict
from fastapi import APIRouter

from backend.database import build_state_payload, resolve_active_ai_credentials
from backend.models.schemas import CompanyAgentAskRequest
from backend.services.lmstudio import call_lmstudio_chat
from backend.services.prompts import build_company_agent_system_prompt

router = APIRouter(tags=["Company AI Agent"])


@router.post("/api/agent/ask")
def api_company_agent_ask(req: CompanyAgentAskRequest) -> Dict[str, Any]:
    """Answers questions about the sales pipeline with live data injected into the prompt (no unit costs: Staff ask too)."""
    st = build_state_payload()
    ai = resolve_active_ai_credentials()
    p = st["pipeline"]
    reps = {r["id"]: r["name"] for r in st["reps"]}

    summary_lines = "\n".join(
        [f"- Pipeline value (quoted, not yet won or lost): RM {p['valueRm']:,}", f"- Win rate: {p['winRate']:.0%}", f"- Follow-ups overdue: {p['overdue']}"]
        + [f"- {stage}: {v['count']} deal(s), RM {v['valueRm']:,}" for stage, v in p["byStage"].items()]
    )
    rep_lines = "\n".join(
        f"- {r['name']}: won RM {r['wonRm']:,}, est. commission RM {r['commissionRm']:,}, open deals {r['openDeals']}, overdue follow-ups {r['overdue']}"
        for r in st["reps"]
    )
    deal_lines = "\n".join(
        f"- {d['id']} | {d['customer']} | {reps.get(d['repId'], '-')} | {d['stage']} | RM {d['amount']:,} | "
        + ", ".join(f"{i['qty']}x {i['name']}" for i in d["items"])
        + (f" | {d['followUpText']}" if d["followUpText"] else "")
        + (f" | lost: {d['lossReason']}" if d["lossReason"] else "")
        for d in st["deals"]
    )
    product_lines = "\n".join(f"- {x['sku']}: {x['name']} | RM {x['sellPrice']:,}" for x in st["products"])

    system_prompt = build_company_agent_system_prompt(
        company_name=st["company"]["name"],
        summary_lines=summary_lines,
        rep_lines=rep_lines,
        deal_lines=deal_lines,
        product_lines=product_lines,
    )

    try:
        llm_res = call_lmstudio_chat(ai["base_url"], ai["model"], system_prompt, req.question, api_key=ai["api_key"], timeout=20.0)
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
