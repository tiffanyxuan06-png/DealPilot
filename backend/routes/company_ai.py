from fastapi import APIRouter

from backend.models.requests import CompanyAgentAskRequest
from backend.models.responses import AgentAnswer
from backend.services.lmstudio import call_lmstudio_chat
from backend.services.pipeline import build_state, resolve_active_ai_credentials
from backend.services.prompts import build_company_agent_system_prompt

router = APIRouter(tags=["Company AI Agent"])


@router.post("/api/agent/ask", response_model=AgentAnswer)
def api_company_agent_ask(req: CompanyAgentAskRequest) -> AgentAnswer:
    """Answers questions about the sales pipeline with live data injected into the prompt (no unit costs: Staff ask too)."""
    st = build_state()  # Staff view: never includes unit costs or margin %
    ai = resolve_active_ai_credentials()
    p = st.pipeline
    reps = {r.id: r.name for r in st.reps}

    summary_lines = "\n".join(
        [f"- Pipeline value (quoted, not yet won or lost): RM {p.value_rm:,}", f"- Win rate: {p.win_rate:.0%}", f"- Follow-ups overdue: {p.overdue}"]
        + [f"- {stage}: {v.count} deal(s), RM {v.value_rm:,}" for stage, v in p.by_stage.items()]
    )
    rep_lines = "\n".join(
        f"- {r.name}: won RM {r.won_rm:,}, est. commission RM {r.commission_rm:,}, open deals {r.open_deals}, overdue follow-ups {r.overdue}"
        for r in st.reps
    )
    deal_lines = "\n".join(
        f"- {d.id} | {d.customer} | {reps.get(d.rep_id, '-')} | {d.stage.value} | RM {d.amount:,} | "
        + ", ".join(f"{i.qty}x {i.name}" for i in d.items)
        + (f" | {d.follow_up_text}" if d.follow_up_text else "")
        + (f" | lost: {d.loss_reason}" if d.loss_reason else "")
        for d in st.deals
    )
    product_lines = "\n".join(f"- {x.sku}: {x.name} | RM {x.sell_price:,}" for x in st.products)

    system_prompt = build_company_agent_system_prompt(
        company_name=st.company.name,
        summary_lines=summary_lines,
        rep_lines=rep_lines,
        deal_lines=deal_lines,
        product_lines=product_lines,
    )

    try:
        llm_res = call_lmstudio_chat(ai["base_url"], ai["model"], system_prompt, req.question, api_key=ai["api_key"], timeout=60.0)
        return AgentAnswer(
            lmstudio_connected=True,
            model_used=llm_res["model_used"],
            answer=llm_res["clean_content"],
            raw_prompt=system_prompt + "\n\nUser Question:\n" + req.question,
            raw_system_prompt=system_prompt,
        )
    except Exception as e:
        return AgentAnswer(lmstudio_connected=False, error=str(e))
