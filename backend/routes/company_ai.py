from fastapi import APIRouter

from backend.models.enums import Stage
from backend.models.requests import CompanyAgentAskRequest
from backend.models.responses import AgentAnswer
from backend.services.lmstudio import call_lmstudio_chat
from backend.services.pipeline import build_state, resolve_active_ai_credentials
from backend.services.prompts import build_company_agent_system_prompt

router = APIRouter(tags=["Company AI Agent"])


@router.post("/api/agent/ask", response_model=AgentAnswer)
def api_company_agent_ask(req: CompanyAgentAskRequest) -> AgentAnswer:
    """Answers questions about the sales pipeline with live data injected into the prompt.

    The Owner gets the whole team, Staff their own deals. The prompt lists sell prices only, never unit costs or margin %.
    """
    st = build_state(req.role)
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
            provider=ai.get("provider", "lmstudio"),
            model_used=llm_res["model_used"],
            answer=llm_res["clean_content"],
            raw_prompt=system_prompt + "\n\nUser Question:\n" + req.question,
            raw_system_prompt=system_prompt,
        )
    except Exception as e:
        return AgentAnswer(
            lmstudio_connected=False,
            error=str(e),
            answer=_offline_answer(req.question, st, reps, summary_lines, rep_lines, product_lines),
        )


OFFLINE_NOTE = "⚠️ The AI model isn't reachable right now, so this comes straight from your live sales data."


def _offline_answer(question: str, st, reps, summary_lines: str, rep_lines: str, product_lines: str) -> str:
    """No AI: answer the common questions from the pipeline instead of leaving the Owner with nothing."""
    # ponytail: keyword routing; free-form questions need the AI model.
    q = question.lower()
    if any(w in q for w in ("follow", "overdue", "today", "need me", "due", "approval", "pending")):
        due = [d for d in st.deals if d.stage == Stage.FOLLOW_UP and not d.paused]
        approvals = [a for a in st.approvals if a.status == "PENDING"]
        lines = [f"- {d.id} {d.customer} ({reps.get(d.rep_id, '-')}): RM {d.amount:,} · {d.follow_up_text}" for d in due]
        lines += [f"- Approval #AP-{a.id}: {a.summary}" for a in approvals]
        body = "Needs you today:\n" + ("\n".join(lines) if lines else "- Nothing: no follow-ups due and no approvals waiting.")
    elif any(w in q for w in ("commission", "rep", "leader", "salesm", "staff", "who is winning", "best")):
        body = "Sales reps this month:\n" + rep_lines
    elif any(w in q for w in ("tin", "lhdn", "e-invoice", "einvoice")):
        missing = [c.name for c in st.customers if not c.lhdn_ready]
        body = f"LHDN e-Invoice: {len(st.customers) - len(missing)} customer(s) ready, {len(missing)} missing a TIN" + (
            ":\n" + "\n".join(f"- {n}" for n in missing) if missing else "."
        )
    elif any(w in q for w in ("price", "product", "sku", "catalog", "how much")):
        body = "Price list:\n" + product_lines
    elif any(w in q for w in ("pipeline", "won", "lost", "win rate", "sales", "quote", "deal")):
        body = "Pipeline:\n" + summary_lines
    else:
        body = "I can't answer free-form questions while the AI is offline. Start LM Studio (or set AI_PROVIDER=runpod) and ask again.\n\nPipeline right now:\n" + summary_lines
    return f"{OFFLINE_NOTE}\n\n{body}"
