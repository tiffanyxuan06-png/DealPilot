"""Sales deals: inquiry → quote → follow-up → won / lost. Every amount is priced by code from the price list."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db import orm, session_scope
from backend.models.enums import OPEN_STAGES, PIPELINE_STAGES, DealAction, Stage
from backend.models.requests import DealActionRequest, DealCreateRequest, ProductUpsertRequest, ReassignRequest, RepUpsertRequest
from backend.models.state import ActionResponse
from backend.services.business import load_business
from backend.services.clock import now_stamp, now_time_str
from backend.services.customers import apply_tin, parse_tin, upsert_customer
from backend.services.permissions import enforce, normalize_role, register_handler, require_owner
from backend.services.pipeline import build_state, deal_commission, deal_margin_pct, follow_up_due_str, log, product_costs

router = APIRouter(tags=["Deals & Pipeline"])

BELOW_FLOOR = "Below the margin floor"  # shown to Staff, so it never states the margin %

ACTION_KEYS = {
    DealAction.SEND_QUOTE: "deal.create",
    DealAction.SEND_FOLLOW_UP: "deal.follow_up",
    DealAction.MARK_WON: "deal.won",
    DealAction.MARK_LOST: "deal.lost",
    DealAction.APPLY_DISCOUNT: "discount.apply",
    DealAction.PAUSE: "deal.pause",
    DealAction.RESUME: "deal.pause",
    DealAction.SET_TIN: "deal.set_tin",
}


def price_items(session: Session, items) -> List[Dict[str, Any]]:
    """Looks every item up on the price list. The price always comes from here, never from the request."""
    priced = []
    for it in items:
        p = session.scalars(select(orm.Product).where(orm.Product.sku == it.sku.strip().upper())).first()
        if not p:
            raise HTTPException(status_code=404, detail=f"{it.sku} is not on the price list.")
        priced.append({"sku": p.sku, "name": p.name, "qty": it.qty, "unitPrice": p.sell_price})
    return priced


def subtotal(items: List[Dict[str, Any]]) -> int:
    return sum(i["qty"] * i["unitPrice"] for i in items)


def below_floor(session: Session, items: List[Dict[str, Any]], amount: int) -> bool:
    return deal_margin_pct(items, amount, product_costs(session)) < load_business(session).margin_floor_pct


def default_rep_id(session: Session) -> Optional[int]:
    # ponytail: the demo has one Staff login, so new deals go to the first rep (Aina); link logins to reps for real teams.
    return session.scalars(select(orm.Rep.id).where(orm.Rep.active.is_(True)).order_by(orm.Rep.id).limit(1)).first()


def next_deal_id(session: Session) -> str:
    nums = [int(i.rsplit("-", 1)[-1]) for i in session.scalars(select(orm.Deal.id)) if i.rsplit("-", 1)[-1].isdigit()]
    return f"QT-{datetime.now().year}-{max(nums, default=100) + 1}"


@router.post("/api/deals", response_model=ActionResponse)
def api_create_deal(req: DealCreateRequest) -> ActionResponse:
    """Logs an inquiry (quote=False) or sends a quote. Staff need approval below the margin floor."""
    role = normalize_role(req.role)
    with session_scope() as s:
        items = price_items(s, req.items)
        if req.discount > subtotal(items):
            raise HTTPException(status_code=400, detail="The discount is bigger than the quote.")
        amount = subtotal(items) - req.discount
        rep = s.get(orm.Rep, req.rep_id or default_rep_id(s) or -1)
        if not rep:
            raise HTTPException(status_code=404, detail="That sales rep does not exist.")
        below = below_floor(s, items, amount)
        gate = enforce(
            s,
            role,
            "deal.create",
            handler="deal_create",
            payload={"body": req.model_dump()},
            summary=f"{'Quote' if req.quote else 'Inquiry'} for {req.customer}: RM {amount:,}" + (f" (RM {req.discount:,} off)" if req.discount else ""),
            mandatory_reason=BELOW_FLOOR if below else None,
        )
        if gate:
            return gate

        deal = orm.Deal(
            id=next_deal_id(s),
            customer=req.customer,
            phone=req.phone or "",
            rep_id=rep.id,
            stage=(Stage.QUOTED if req.quote else Stage.INQUIRY).value,
            discount=req.discount,
            amount=amount,
            follow_up_at=follow_up_due_str(load_business(s).follow_up_hours) if req.quote else None,
            notes=(req.notes or "").strip(),
            created_at=now_stamp(),
        )
        deal.items = items
        s.add(deal)
        upsert_customer(s, req.customer, now_time_str(), phone=req.phone or "")
        lines = ", ".join(f"{i['qty']}x {i['name']}" for i in items)
        log(
            s,
            f"[{role}] {'Quoted' if req.quote else 'Logged inquiry'} #{deal.id} for {req.customer} ({rep.name}): {lines} = RM {amount:,}"
            + (" · below the margin floor (Owner)" if below else "")
            + ".",
        )
        created = deal.id
    return ActionResponse(status="ok", created_id=created, state=build_state(role))


@router.post("/api/deals/{deal_id}/action", response_model=ActionResponse)
def api_deal_action(deal_id: str, req: DealActionRequest) -> ActionResponse:
    role = normalize_role(req.role)
    act = req.action
    with session_scope() as s:
        d = s.get(orm.Deal, deal_id)
        if not d:
            raise HTTPException(status_code=404, detail=f"Deal {deal_id} not found")
        if d.stage in (Stage.WON.value, Stage.LOST.value) and act != DealAction.SET_TIN:
            raise HTTPException(status_code=409, detail=f"#{deal_id} is already {d.stage.lower()}.")

        items = d.items
        who = f"#{deal_id} ({d.customer})"
        mandatory = None
        new_discount = new_amount = None
        tin = None
        if act == DealAction.SEND_QUOTE and d.stage != Stage.INQUIRY.value:
            raise HTTPException(status_code=409, detail=f"#{deal_id} has already been quoted.")
        if act == DealAction.SEND_FOLLOW_UP and d.stage not in PIPELINE_STAGES:
            raise HTTPException(status_code=409, detail="Send the quote first.")
        if act == DealAction.MARK_LOST and not (req.reason or "").strip():
            raise HTTPException(status_code=400, detail="Choose a reason the deal was lost (e.g. price, timing, competitor, no reply).")
        if act == DealAction.APPLY_DISCOUNT:
            new_discount = req.discount or 0
            if new_discount > subtotal(items):
                raise HTTPException(status_code=400, detail="The discount is bigger than the quote.")
            new_amount = subtotal(items) - new_discount
            if below_floor(s, items, new_amount):
                mandatory = BELOW_FLOOR
        if act == DealAction.SET_TIN:
            tin = parse_tin(req.tin or "")
            if not tin:
                raise HTTPException(status_code=400, detail=f"'{req.tin}' does not look like an LHDN TIN (e.g. C2588190021).")

        summary = {
            DealAction.SEND_QUOTE: f"Send quote {who}: RM {d.amount:,}",
            DealAction.SEND_FOLLOW_UP: f"Send follow-up on {who}",
            DealAction.MARK_WON: f"Mark {who} won (RM {d.amount:,})",
            DealAction.MARK_LOST: f"Mark {who} lost: {(req.reason or '').strip()}",
            DealAction.APPLY_DISCOUNT: f"Discount RM {new_discount or 0:,} on {who} (new total RM {new_amount or 0:,})",
            DealAction.PAUSE: f"Pause follow-ups on {who}",
            DealAction.RESUME: f"Resume follow-ups on {who}",
            DealAction.SET_TIN: f"Set LHDN TIN {tin} for {d.customer}",
        }[act]
        gate = enforce(
            s,
            role,
            ACTION_KEYS[act],
            handler="deal_action",
            payload={"path": {"deal_id": deal_id}, "body": req.model_dump(mode="json")},
            summary=summary,
            mandatory_reason=mandatory,
        )
        if gate:
            return gate

        rep = s.get(orm.Rep, d.rep_id) if d.rep_id is not None else None
        rep_name = rep.name if rep else "no rep"
        if act == DealAction.SEND_QUOTE:
            d.stage = Stage.QUOTED.value
            d.follow_up_at = follow_up_due_str(load_business(s).follow_up_hours)
            log(s, f"[{role}] Sent quote {who}: RM {d.amount:,}.")
        elif act == DealAction.SEND_FOLLOW_UP:
            # Back to QUOTED: it is waiting for a reply again; FOLLOW_UP means a follow-up is due now.
            d.follow_up_count += 1
            d.stage = Stage.QUOTED.value
            d.follow_up_at = follow_up_due_str(load_business(s).follow_up_hours)
            log(s, f"[{role}] Sent follow-up {d.follow_up_count} on {who}" + (" · no reply after 3 follow-ups: consider marking it lost" if d.follow_up_count >= 3 else "") + ".")
        elif act == DealAction.MARK_WON:
            d.stage = Stage.WON.value
            d.order_no = deal_id.replace("QT-", "SO-", 1)
            d.won_at = now_stamp()
            d.paused = False
            d.deposit_ref = (req.deposit_ref or "").strip()
            d.deposit_amount = req.deposit_amount
            commission = deal_commission(d.amount, rep.commission_pct) if rep else 0
            log(
                s,
                f"[{role}] Won {who} → order {d.order_no}, RM {d.amount:,}"
                + (f", customer's slip ref {d.deposit_ref}" if d.deposit_ref else "")
                + f" · est. commission RM {commission:,} for {rep_name}.",
            )
        elif act == DealAction.MARK_LOST:
            d.stage = Stage.LOST.value
            d.loss_reason = (req.reason or "").strip()
            log(s, f"[{role}] Marked {who} lost: {d.loss_reason}.")
        elif act == DealAction.APPLY_DISCOUNT:
            d.discount, d.amount = new_discount, new_amount
            log(s, f"[{role}] Discount RM {new_discount:,} on {who} → RM {new_amount:,}" + (" · below the margin floor (Owner)" if mandatory else "") + ".")
        elif act in (DealAction.PAUSE, DealAction.RESUME):
            pausing = act == DealAction.PAUSE
            note = (req.note or "").strip()
            if note:
                d.notes = (d.notes + "\n" if d.notes else "") + f"{'Paused' if pausing else 'Resumed'}: {note}"
            d.paused = pausing
            log(s, f"[{role}] {'Paused' if pausing else 'Resumed'} follow-ups on {who}" + (f": {note}" if note else "") + ".")
        elif act == DealAction.SET_TIN:
            open_ids = apply_tin(s, d.customer, tin, "", now_time_str())
            log(s, f"[{role}] Saved LHDN TIN {tin} for {d.customer}" + (f" (open deals: {', '.join('#' + i for i in open_ids)})" if open_ids else "") + ".")
    return ActionResponse(status="ok", state=build_state(role))


@router.post("/api/reps", response_model=ActionResponse)
def api_upsert_rep(req: RepUpsertRequest) -> ActionResponse:
    require_owner(req.role, "reps.manage")
    name = req.name.strip()
    with session_scope() as s:
        clash = s.scalars(select(orm.Rep).where(orm.Rep.name.ilike(name), orm.Rep.id != (req.id or -1))).first()
        if clash:
            raise HTTPException(status_code=409, detail=f"There is already a rep called {name}.")
        if req.id:
            rep = s.get(orm.Rep, req.id)
            if not rep:
                raise HTTPException(status_code=404, detail="That sales rep does not exist.")
            rep.name, rep.commission_pct, rep.active = name, req.commission_pct, req.active
            log(s, f"[OWNER] Updated rep {name}: {req.commission_pct:g}% commission{'' if req.active else ', inactive'}.")
        else:
            s.add(orm.Rep(name=name, commission_pct=req.commission_pct, active=req.active))
            log(s, f"[OWNER] Added rep {name} ({req.commission_pct:g}% commission).")
    return ActionResponse(status="ok", state=build_state(req.role))


@router.post("/api/reps/{rep_id}/reassign", response_model=ActionResponse)
def api_reassign_rep(rep_id: int, req: ReassignRequest) -> ActionResponse:
    """Moves a rep's open deals to another rep. Won deals stay, so commission history is kept."""
    require_owner(req.role, "reps.reassign")
    with session_scope() as s:
        src, dst = s.get(orm.Rep, rep_id), s.get(orm.Rep, req.to_rep_id)
        if not src or not dst:
            raise HTTPException(status_code=404, detail="That sales rep does not exist.")
        if src.id == dst.id:
            raise HTTPException(status_code=400, detail="Choose a different rep to hand the customers to.")
        if not dst.active:
            raise HTTPException(status_code=400, detail=f"{dst.name} is not active.")
        moved = s.scalars(
            select(orm.Deal).where(orm.Deal.rep_id == src.id, orm.Deal.stage.in_([st.value for st in OPEN_STAGES]))
        ).all()
        for d in moved:
            d.rep_id = dst.id
        customers = sorted({d.customer for d in moved})
        log(
            s,
            f"[OWNER] Reassigned {len(moved)} open deal(s) from {src.name} to {dst.name}" + (f": {', '.join(customers)}" if customers else "") + ".",
        )
        moved_ids = [d.id for d in moved]
    return ActionResponse(status="ok", moved=moved_ids, state=build_state(req.role))


@router.post("/api/products", response_model=ActionResponse)
def api_upsert_product(req: ProductUpsertRequest) -> ActionResponse:
    require_owner(req.role, "pricelist.edit")
    sku = req.sku.strip().upper()
    with session_scope() as s:
        s.merge(orm.Product(sku=sku, name=req.name.strip()[:80], sell_price=req.sell_price, unit_cost=req.unit_cost))
        log(s, f"[OWNER] Price list: {sku} {req.name.strip()} at RM {req.sell_price:,}.")
    return ActionResponse(status="ok", state=build_state(req.role))


register_handler("deal_create", api_create_deal, DealCreateRequest)
register_handler("deal_action", api_deal_action, DealActionRequest, ["deal_id"])
