import re
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.db import orm, session_scope
from backend.models.enums import Stage


def clean_customer_name(name: str) -> str:
    """Clean customer name by removing parenthetical tags like (Deposit), (Walk-in), etc."""
    if not name:
        return "Boss"
    cleaned = re.sub(r"\s*[\(\[][^\)\]]*[\)\]]", "", name).strip(" !?,.:;*#-_\"'")
    return cleaned or "Boss"


def same_phone(a: str, b: str) -> bool:
    """True when two numbers are the same line: digits only, at least 7, one ends with the other (country code or not)."""
    da, db = re.sub(r"\D", "", a or ""), re.sub(r"\D", "", b or "")
    return len(da) >= 7 and len(db) >= 7 and (da.endswith(db) or db.endswith(da))


def find_memory_by_phone(session: Session, phone: str) -> Optional[orm.ClientMemory]:
    """The saved client memory whose phone is the same line as this number."""
    if not re.sub(r"\D", "", phone or ""):
        return None
    rows = session.scalars(select(orm.ClientMemory).where(orm.ClientMemory.phone != "").order_by(orm.ClientMemory.customer))
    return next((m for m in rows if same_phone(m.phone, phone)), None)


def _new_client(customer: str, phone: str, message: str) -> Dict[str, Any]:
    return {
        "customer": customer or "New Client",
        "phone": phone,
        "tier": "NEW_CLIENT",
        "score": 50,
        "styleSummary": "Direct SME buyer · Prefers clear pricing & fast confirmation",
        "paymentBehavior": "🆕 New customer · No past deals yet",
        "totalOrders": 0,
        "totalPaidRm": 0,
        "isNew": True,
        "lastMessage": message or "",
        "updatedAt": datetime.now().strftime("%I:%M %p"),
    }


def compute_client_memory_rating(customer: str, phone: str = "", message: str = "", session: Optional[Session] = None) -> Dict[str, Any]:
    """Rating for a WhatsApp customer from their saved memory and their deals (won = paid, lost to no reply = ghost risk).

    Phase 3 (docs/11 §4.6) refines the scoring; the tier codes stay because the AI prompt uses them.
    """
    if session is None:
        with session_scope() as s:
            return compute_client_memory_rating(customer, phone, message, s)

    from backend.services.customers import find_customer  # customers.py imports this module

    cust = customer.strip()
    phone_clean = (phone or "").strip()
    if not cust or cust.lower() in ("customer", "client", "walk-in", "walk-in counter", "no chat open"):
        return _new_client(cust, phone_clean, message)
    # Only a registered customer has a rating; a stranger (or a number nobody saved) is just new.
    row = find_customer(session, cust, phone_clean)
    if row is None:
        return _new_client(cust, phone_clean, message)
    cust, phone_clean = row.name, row.phone or phone_clean

    mem = session.scalars(select(orm.ClientMemory).where(func.lower(orm.ClientMemory.customer) == cust.lower())).first()
    if not mem and row.phone:
        mem = find_memory_by_phone(session, row.phone)

    deals = []
    if len(cust) >= 3:
        deals = [
            d for d in session.scalars(select(orm.Deal).where(func.lower(orm.Deal.customer).contains(cust.lower(), autoescape=True)))
            if d.customer.lower() == cust.lower() or len(cust) >= 4
        ]

    msg = (message or "").lower()
    if any(w in msg for w in ["boss", "ah", "la", "lah", "bro", "urgent", "yo"]):
        style = "Friendly Malaysian Boss / Manglish style ('Boss', 'lah') · Prefers warm, fast, direct replies"
    elif any(w in msg for w in ["salam", "tuan", "encik", "berapa", "stok", "terima kasih", "tuan haji"]):
        style = "Polite Bahasa Melayu style · Prefers respectful BM or bilingual reply"
    elif mem and mem.style_summary:
        style = mem.style_summary
    else:
        style = "Professional SME buyer · Prefers clear itemization & transparent pricing"

    won = [d for d in deals if d.stage == Stage.WON.value]
    ghosted = sum(1 for d in deals if d.stage == Stage.LOST.value and (d.loss_reason or "").lower() == "no reply")

    if mem and mem.tier != "NEW_CLIENT":
        tier, score, behaviour = mem.tier, mem.score, mem.payment_behavior
        total_orders, total_paid = mem.total_orders, mem.total_paid_rm
        is_new = False
    elif not deals:
        return {**_new_client(cust, phone_clean, message), "styleSummary": style}
    else:
        is_new = False
        total_orders = len(deals)
        total_paid = sum(d.amount for d in won)
        if ghosted:
            tier, score = "SLOW_PAYER_GHOST_RISK", max(25, 55 - ghosted * 15)
            behaviour = f"⚠️ Went quiet on {ghosted} quote(s) · Follow up early"
        elif len(won) >= 3 and total_paid >= 10000:
            tier, score = "VIP_FAST_PAYER", min(98, 86 + len(won) * 2)
            behaviour = f"⭐⭐⭐⭐⭐ Repeat buyer · {len(won)} orders (RM {total_paid:,})"
        elif won:
            tier, score = "REPEAT_CLIENT", 75
            behaviour = f"⭐⭐⭐⭐ Repeat buyer · {len(won)} order(s) (RM {total_paid:,})"
        else:
            tier, score = "PROSPECT_CLIENT", 60
            behaviour = f"Prospect · {total_orders} quote(s), none won yet"

    return {
        "customer": cust,
        "phone": phone_clean,
        "tier": tier,
        "score": score,
        "isNew": is_new,
        "styleSummary": style,
        "paymentBehavior": behaviour,
        "totalOrders": total_orders,
        "totalPaidRm": total_paid,
        "trustBadge": f"{'⚠️' if score < 60 else '⭐'} {tier.replace('_', ' ')} ({score}/100)",
        "depositRequirement": "50% upfront" if tier == "SLOW_PAYER_GHOST_RISK" else "Standard terms",
    }
