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

    cust = customer.strip()
    phone_clean = (phone or "").strip()
    if not cust or cust.lower() in ("customer", "client", "walk-in", "walk-in counter", "no chat open"):
        return _new_client(cust, phone_clean, message)

    mem = session.scalars(select(orm.ClientMemory).where(func.lower(orm.ClientMemory.customer) == cust.lower())).first()
    if not mem and phone_clean:
        mem = session.scalars(select(orm.ClientMemory).where(orm.ClientMemory.phone == phone_clean, orm.ClientMemory.phone != "")).first()

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
