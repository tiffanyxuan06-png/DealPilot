"""Sales pipeline rules shared by the routes: follow-up timer, margin, commission, the activity log and /api/state."""
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.db import orm, session_scope
from backend.models import entities
from backend.models.enums import OPEN_STAGES, PIPELINE_STAGES, Role, Stage
from backend.models.settings import BusinessSettings
from backend.models.state import Company, Pipeline, StageTotals, StatePayload
from backend.services.business import load_business
from backend.services.clock import TIME_FORMAT, now_stamp, now_time_str, parse_time

FOLLOW_UPS_BEFORE_SUGGEST_LOST = 3
AT_RISK_FOLLOW_UP_RM = 3000  # a big deal already in follow-up is worth watching
# Loss reason prefix written by the CANCEL_WON action; the dashboard groups all cancellations under it.
CANCELLED_AFTER_WIN = "Cancelled after win"


def loss_bucket(reason: Optional[str]) -> str:
    """The dashboard group for a lost deal's reason.

    Cancelled orders all count as one "Cancelled after win" bar (each carries its own free-text reason),
    and a missing reason counts as "No reason". Every other reason is its own group.
    """
    reason = reason or ""
    if reason.startswith(CANCELLED_AFTER_WIN + ":"):
        return CANCELLED_AFTER_WIN
    return reason or "No reason"


def log(session: Session, message: str) -> None:
    """Adds a line to the append-only activity log."""
    ts = now_time_str()
    session.add(orm.AuditLog(entry=f"{ts} · {message}", created_at=ts))


def follow_up_due_str(hours: int, from_time: Optional[datetime] = None) -> str:
    return ((from_time or datetime.now()) + timedelta(hours=hours)).strftime(TIME_FORMAT)


def _span(secs: int) -> str:
    return f"{secs // 3600}h {secs % 3600 // 60:02d}m"


def follow_up_text(stage: str, follow_up_at: Optional[str], paused: bool) -> str:
    """Live countdown shown in the WebApp and the extension."""
    if stage not in PIPELINE_STAGES:
        return ""
    if paused:
        return "⏸ Follow-ups paused (complaint)"
    due = parse_time(follow_up_at)
    if not due:
        return ""
    secs = int((due - datetime.now()).total_seconds())
    if secs > 0:
        return f"⏳ {_span(secs)} to follow-up"
    return f"🔔 Follow-up due · {_span(-secs)} overdue"


def refresh_follow_ups(session: Session) -> None:
    """Quotes with no reply by their follow-up time move to FOLLOW_UP. Paused (complaint) deals wait."""
    due = session.scalars(
        select(orm.Deal).where(
            orm.Deal.stage == Stage.QUOTED.value,
            orm.Deal.paused.is_(False),
            orm.Deal.follow_up_at.is_not(None),
            orm.Deal.follow_up_at <= now_stamp(),
        )
    ).all()
    for deal in due:
        deal.stage = Stage.FOLLOW_UP.value
        log(session, f"[SYSTEM] Quote #{deal.id} ({deal.customer}) had no reply in time → follow-up due.")


def deal_commission(amount: int, commission_pct: float) -> int:
    # Commission on the amount after discount, so a discount also costs the rep.
    return round(amount * commission_pct / 100)


def deal_margin_pct(items: List[Dict[str, Any]], amount: int, costs: Dict[str, int]) -> float:
    """Margin % on the deal total after discount: (amount - unit cost x qty) / amount."""
    if amount <= 0:
        return -100.0
    cost = sum(costs.get(i["sku"], 0) * i["qty"] for i in items)
    return round((amount - cost) / amount * 100, 1)


def product_costs(session: Session) -> Dict[str, int]:
    return {p.sku: p.unit_cost for p in session.scalars(select(orm.Product))}


def resolve_active_ai_credentials(biz: Optional[BusinessSettings] = None) -> Dict[str, str]:
    """LM Studio (from .env, or the Owner's override in Settings) or RunPod (.env only; the key never leaves the server)."""
    from backend.services.ai_provider import active_provider, runpod_credentials

    if active_provider() == "runpod":
        return runpod_credentials()
    if biz is None:
        with session_scope() as session:
            biz = load_business(session)
    env = get_settings()
    return {
        "provider": "lmstudio",
        "base_url": (biz.lmstudio_url or env.lmstudio_url).strip().rstrip("/"),
        "api_key": (biz.lmstudio_api_key or env.lmstudio_api_key).strip(),
        "model": (biz.lmstudio_model or env.lmstudio_model).strip(),
        "vision_model": env.lmstudio_vision_model,
    }


def _deal(row: orm.Deal, costs: Dict[str, int], floor: float, is_owner: bool) -> entities.Deal:
    """One deal as the API shows it, with the flags the dashboards use.

    `costs` are unit costs per SKU and `floor` the Owner's margin floor (%). `margin_pct` is only filled in
    for the Owner; everyone gets `margin_ok`, so Staff can see a quote is too cheap without seeing the cost.
    """
    items = row.items
    pct = deal_margin_pct(items, row.amount, costs)
    # Only quotes still waiting for an answer can be "suggest lost" or "at risk"; won and lost deals are settled.
    suggest_lost = row.stage in PIPELINE_STAGES and row.follow_up_count >= FOLLOW_UPS_BEFORE_SUGGEST_LOST
    return entities.Deal(
        id=row.id,
        order_no=row.order_no,
        customer=row.customer,
        phone=row.phone or "",
        rep_id=row.rep_id,
        stage=row.stage,
        items=items,
        discount=row.discount,
        amount=row.amount,
        follow_up_at=row.follow_up_at,
        follow_up_text=follow_up_text(row.stage, row.follow_up_at, row.paused),
        follow_up_count=row.follow_up_count,
        suggest_lost=suggest_lost,
        paused=row.paused,
        loss_reason=row.loss_reason or "",
        deposit_ref=row.deposit_ref or "",
        deposit_amount=row.deposit_amount,
        notes=row.notes or "",
        created_at=row.created_at,
        won_at=row.won_at,
        margin_ok=pct >= floor,
        margin_pct=pct if is_owner else None,
        # At risk = an open quote the Owner should look at: 3+ unanswered follow-ups, paused by a complaint,
        # or a big deal (≥ RM 3,000) whose follow-up is already due.
        at_risk=row.stage in PIPELINE_STAGES
        and (suggest_lost or row.paused or (row.stage == Stage.FOLLOW_UP.value and row.amount >= AT_RISK_FOLLOW_UP_RM)),
    )


def build_state(role: Optional[str] = None) -> StatePayload:
    """Everything the WebApp and extension show. Staff never receive unit costs or margin %."""
    from backend.services.customers import customers_payload
    from backend.services.permissions import approvals_payload, normalize_role, permissions_payload

    is_owner = normalize_role(role) == Role.OWNER.value
    with session_scope() as session:
        refresh_follow_ups(session)
        session.flush()
        biz = load_business(session)
        ai = resolve_active_ai_credentials(biz)

        product_rows = session.scalars(select(orm.Product).order_by(orm.Product.sku)).all()
        costs = {p.sku: p.unit_cost for p in product_rows}
        products = [
            entities.Product(
                sku=p.sku,
                name=p.name,
                sell_price=p.sell_price,
                unit_cost=p.unit_cost if is_owner else None,
                specs=p.specs,
            )
            for p in product_rows
        ]
        deals = [
            _deal(r, costs, biz.margin_floor_pct, is_owner)
            for r in session.scalars(select(orm.Deal).order_by(orm.Deal.created_at.desc())).all()
        ]

        def overdue(d: entities.Deal) -> bool:
            return d.stage == Stage.FOLLOW_UP and not d.paused

        month = datetime.now().strftime("%Y-%m")
        reps = []
        for r in session.scalars(select(orm.Rep).where(orm.Rep.active.is_(True)).order_by(orm.Rep.id)).all():
            mine = [d for d in deals if d.rep_id == r.id]
            won = [d for d in mine if d.stage == Stage.WON and (d.won_at or "").startswith(month)]
            reps.append(
                entities.Rep(
                    id=r.id,
                    name=r.name,
                    commission_pct=r.commission_pct,
                    won_rm=sum(d.amount for d in won),
                    commission_rm=sum(deal_commission(d.amount, r.commission_pct) for d in won),
                    open_deals=sum(1 for d in mine if d.stage in OPEN_STAGES),
                    overdue=sum(1 for d in mine if overdue(d)),
                    # What the rep would earn if every quote still waiting for an answer closed. Inquiries
                    # (no price sent yet) and settled deals don't count.
                    potential_rm=sum(
                        deal_commission(d.amount, r.commission_pct) for d in mine if d.stage in PIPELINE_STAGES
                    ),
                )
            )
        # Competition ranking by this month's won RM among active reps: equal totals share a rank and the next
        # rank is skipped (1, 1, 3). With no wins yet, everyone is rank 1.
        for rep in reps:
            rep.rank = 1 + sum(1 for o in reps if o.won_rm > rep.won_rm)

        won_count = sum(1 for d in deals if d.stage == Stage.WON)
        lost_count = sum(1 for d in deals if d.stage == Stage.LOST)
        pipeline = Pipeline(
            value_rm=sum(d.amount for d in deals if d.stage in PIPELINE_STAGES),
            by_stage={
                s.value: StageTotals(count=sum(1 for d in deals if d.stage == s), value_rm=sum(d.amount for d in deals if d.stage == s))
                for s in Stage
            },
            win_rate=round(won_count / (won_count + lost_count), 2) if won_count + lost_count else 0.0,
            overdue=sum(1 for d in deals if overdue(d)),
            loss_reasons=dict(Counter(loss_bucket(d.loss_reason) for d in deals if d.stage == Stage.LOST)),  # all time
        )

        memories = {
            m.customer: entities.ClientMemory.model_validate(m)
            for m in session.scalars(select(orm.ClientMemory).order_by(orm.ClientMemory.score.desc())).all()
        }
        logs = [r.entry for r in session.scalars(select(orm.AuditLog).order_by(orm.AuditLog.id.desc()).limit(100))]

        return StatePayload(
            company=Company(
                name=biz.company_name,
                preset=biz.sme_preset,
                framework=biz.framework,
                follow_up_hours=biz.follow_up_hours,
                margin_floor_pct=biz.margin_floor_pct,
                ai_provider=ai["provider"],
                lmstudio_url=ai["base_url"],
                lmstudio_api_key=ai["api_key"] if ai["provider"] == "lmstudio" else "",
                lmstudio_model=ai["model"],
            ),
            products=products,
            reps=reps,
            deals=deals,
            pipeline=pipeline,
            customers=customers_payload(session),
            client_memories=memories,
            permissions=permissions_payload(session),
            approvals=approvals_payload(session),
            logs=logs,
        )
