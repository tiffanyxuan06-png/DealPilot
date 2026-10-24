"""Sidekick tools: deterministic Layer B operations for the WhatsApp Sales Sidekick.

Every mathematical calculation, inventory lookup, order structure, and commitment
is executed deterministically without relying on local LLM arithmetic.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.db import orm
from backend.models.enums import OPEN_STAGES, Stage
from backend.services.business import load_business
from backend.services.clock import now_stamp
from backend.services.customers import get_customer


def search_products(
    session: Session, query: str = "", category: Optional[str] = None, limit: int = 5
) -> List[Dict[str, Any]]:
    """Fuzzy searches products by name or SKU, returning selling price and active hold status."""
    stmt = select(orm.Product)
    if query:
        q = f"%{query.strip()}%"
        stmt = stmt.where(or_(orm.Product.sku.ilike(q), orm.Product.name.ilike(q)))
    
    products = session.scalars(stmt.limit(limit)).all()
    
    # Calculate holds across active quotes
    open_deals = session.scalars(
        select(orm.Deal).where(orm.Deal.stage.in_([Stage.QUOTED.value, Stage.FOLLOW_UP.value]))
    ).all()
    
    holds_by_sku: Dict[str, int] = {}
    for d in open_deals:
        for it in d.items:
            sku = it.get("sku", "").upper()
            holds_by_sku[sku] = holds_by_sku.get(sku, 0) + it.get("qty", 1)

    result = []
    for p in products:
        sku = p.sku.upper()
        on_hold = holds_by_sku.get(sku, 0)
        # Default ready stock assumption for SME demo is 15 units per catalog item
        estimated_on_hand = 15
        available = max(0, estimated_on_hand - on_hold)
        result.append({
            "sku": p.sku,
            "name": p.name,
            "sell_price": p.sell_price,
            "available_stock": available,
            "on_hold": on_hold,
            "ready_stock": available > 0,
        })
    return result


def get_customer_orders(
    session: Session, phone_or_name: str, limit: int = 3
) -> List[Dict[str, Any]]:
    """Retrieves previous orders for customer to resolve 'Same as last month' references."""
    clean = phone_or_name.strip()
    if not clean:
        return []
    
    deals = session.scalars(
        select(orm.Deal)
        .where(
            or_(
                orm.Deal.customer.ilike(f"%{clean}%"),
                orm.Deal.phone.contains(clean)
            )
        )
        .order_by(orm.Deal.created_at.desc())
        .limit(limit)
    ).all()

    return [
        {
            "id": d.id,
            "order_no": d.order_no,
            "stage": d.stage,
            "created_at": (d.created_at or "")[:10],
            "amount": d.amount,
            "items": d.items,
        }
        for d in deals
    ]


def prepare_order(
    session: Session,
    customer: str,
    phone: str,
    raw_items: List[Dict[str, Any]],
    delivery_area: str = "",
    notes: str = "",
) -> Dict[str, Any]:
    """Matches raw requested items to official catalog SKUs and detects missing fields."""
    matched_items = []
    missing_fields = []
    
    all_products = {p.sku.upper(): p for p in session.scalars(select(orm.Product)).all()}
    
    for req_item in raw_items:
        raw_name = req_item.get("name") or req_item.get("sku") or ""
        qty = int(req_item.get("qty", 1))
        
        # Try direct SKU lookup
        sku_candidate = raw_name.strip().upper()
        matched = all_products.get(sku_candidate)
        
        # Try fuzzy name match
        if not matched:
            for p in all_products.values():
                if raw_name.lower() in p.name.lower() or raw_name.lower() in p.sku.lower():
                    matched = p
                    break
        
        if matched:
            matched_items.append({
                "sku": matched.sku,
                "name": matched.name,
                "qty": qty,
                "unit_price": matched.sell_price,
                "line_total": qty * matched.sell_price,
            })
        else:
            missing_fields.append(f"Unmatched item: '{raw_name}'. Please verify SKU.")

    if not delivery_area:
        missing_fields.append("Delivery location or installation address required.")
    
    subtotal = sum(i["line_total"] for i in matched_items)
    
    return {
        "customer": customer,
        "phone": phone,
        "items": matched_items,
        "delivery_area": delivery_area,
        "subtotal": subtotal,
        "missing_fields": missing_fields,
        "ready_to_quote": len(matched_items) > 0 and len(missing_fields) == 0,
        "notes": notes,
    }


def calculate_quote(
    session: Session,
    items: List[Dict[str, Any]],
    discount_pct: float = 0.0,
    delivery_fee: float = 0.0,
) -> Dict[str, Any]:
    """Pure deterministic pricing calculation (Subtotal, Discount, Delivery, Grand Total)."""
    subtot = sum(int(i.get("qty", 1)) * int(i.get("unit_price") or i.get("unitPrice", 0)) for i in items)
    discount_rm = round(subtot * (discount_pct / 100.0))
    total_payable = max(0, subtot - discount_rm + round(delivery_fee))
    deposit_required = round(total_payable * 0.40)  # Standard Malaysian 40% commercial deposit

    return {
        "subtotal": subtot,
        "discount_pct": discount_pct,
        "discount_rm": discount_rm,
        "delivery_fee": round(delivery_fee),
        "total_payable": total_payable,
        "deposit_required": deposit_required,
        "terms": "Subject to stock availability - prices valid 7 days from quote date.",
    }


def save_commitment(
    session: Session,
    phone: str,
    customer: str,
    promise_text: str,
    due_date: Optional[str] = None,
    party: str = "customer",
) -> Dict[str, Any]:
    """Records a concrete temporal commitment made in chat."""
    c = orm.Commitment(
        phone=phone.strip(),
        customer=customer.strip(),
        promise_text=promise_text.strip(),
        due_date=due_date,
        party=party,
        status="pending",
        created_at=now_stamp(),
    )
    session.add(c)
    session.flush()
    return {
        "id": c.id,
        "customer": c.customer,
        "phone": c.phone,
        "promise_text": c.promise_text,
        "due_date": c.due_date,
        "party": c.party,
        "status": c.status,
    }


def get_commitments(
    session: Session, phone_or_customer: Optional[str] = None, status: str = "pending"
) -> List[Dict[str, Any]]:
    """Fetches commitments, optionally filtered by phone or customer."""
    stmt = select(orm.Commitment)
    if status != "ALL":
        stmt = stmt.where(orm.Commitment.status == status)
    if phone_or_customer:
        clean = phone_or_customer.strip()
        stmt = stmt.where(
            or_(
                orm.Commitment.phone.contains(clean),
                orm.Commitment.customer.ilike(f"%{clean}%")
            )
        )
    commitments = session.scalars(stmt.order_by(orm.Commitment.id.desc())).all()
    return [
        {
            "id": c.id,
            "customer": c.customer,
            "phone": c.phone,
            "promise_text": c.promise_text,
            "due_date": c.due_date,
            "party": c.party,
            "status": c.status,
            "created_at": c.created_at,
        }
        for c in commitments
    ]


def match_transaction(
    session: Session,
    amount: float,
    ref_id: str = "",
    phone_or_customer: str = "",
) -> Dict[str, Any]:
    """Matches payment slip evidence against open invoices/quotes."""
    clean = phone_or_customer.strip()
    stmt = select(orm.Deal).where(orm.Deal.stage.in_([s.value for s in OPEN_STAGES]))
    if clean:
        stmt = stmt.where(
            or_(
                orm.Deal.customer.ilike(f"%{clean}%"),
                orm.Deal.phone.contains(clean)
            )
        )
    
    open_deals = session.scalars(stmt.order_by(orm.Deal.created_at.desc())).all()
    
    # Check duplicate reference
    is_duplicate_ref = False
    if ref_id:
        existing = session.scalars(
            select(orm.Deal).where(orm.Deal.deposit_ref == ref_id.strip())
        ).first()
        if existing:
            is_duplicate_ref = True

    matched_deal = None
    match_status = "NO_MATCH"
    
    for d in open_deals:
        # Exact match or deposit match (40%)
        if abs(d.amount - amount) < 1.0:
            matched_deal = d
            match_status = "EXACT_MATCH"
            break
        elif abs(round(d.amount * 0.40) - amount) < 1.0:
            matched_deal = d
            match_status = "EXACT_DEPOSIT_MATCH"
            break
        elif amount < d.amount:
            matched_deal = d
            match_status = "PARTIAL_PAYMENT"
            break

    return {
        "matched": matched_deal is not None,
        "match_status": match_status,
        "deal_id": matched_deal.id if matched_deal else None,
        "customer": matched_deal.customer if matched_deal else None,
        "deal_amount": matched_deal.amount if matched_deal else None,
        "claimed_amount": amount,
        "is_duplicate_ref": is_duplicate_ref,
        "audit_note": (
            "⚠️ DUPLICATE PAYMENT REFERENCE DETECTED!" if is_duplicate_ref
            else "Receipt parsed as evidence. Confirm with online banking before marking paid."
        ),
    }


def get_conversation_context(
    session: Session, phone_or_customer: str
) -> Dict[str, Any]:
    """Comprehensive conversation summary, past orders, and pending commitments."""
    clean = phone_or_customer.strip()
    past_orders = get_customer_orders(session, clean, limit=3)
    pending_commitments = get_commitments(session, clean, status="pending")
    cust = get_customer(session, clean)
    
    open_deal = session.scalars(
        select(orm.Deal).where(
            orm.Deal.stage.in_([s.value for s in OPEN_STAGES]),
            or_(orm.Deal.customer.ilike(f"%{clean}%"), orm.Deal.phone.contains(clean))
        ).order_by(orm.Deal.id.desc())
    ).first()

    return {
        "customer": clean,
        "tin": cust.tin if cust else "",
        "open_deal": {
            "id": open_deal.id,
            "stage": open_deal.stage,
            "amount": open_deal.amount,
            "items": open_deal.items,
        } if open_deal else None,
        "past_orders_count": len(past_orders),
        "recent_orders": past_orders,
        "pending_commitments": pending_commitments,
    }
