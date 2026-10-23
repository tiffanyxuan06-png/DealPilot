"""Buying intent read from a customer's last WhatsApp message, and the re-engage alerts built from it.

A plain price question ("how much ah?") is BROWSING and waits on the normal follow-up timer. A customer who
picked a model or asked for a better price is INTERESTED; one who asked us to hold stock, promised to pay or
confirmed is READY. When an INTERESTED or READY customer goes quiet, their rep gets an alert: when the time
they promised has passed ("I transfer tomorrow"), or after QUIET_HOURS if they gave no time.
"""
import re
from datetime import datetime, timedelta
from typing import Iterable, List, Optional

from backend.models import entities
from backend.models.enums import OPEN_STAGES, Stage
from backend.services.clock import parse_time
from backend.services.customers import customer_key

QUIET_HOURS = 24

_NOT_BUYING_RE = re.compile(
    r"\b(no thanks|not interested|tak nak|tak jadi|cancel|batal|dont want|don't want|"
    r"rosak|bocor|leaking|not cold|tak sejuk|complaint|komplain)\b",
    re.IGNORECASE,
)
_READY_RE = re.compile(
    r"\b(hold|keep|reserve|book|chop)\b[^.?!]*\bfor me\b|"
    r"\b(i'?ll|i will|i)\s+(transfer|bank\s*in|pay|settle)\b|\bdeposit\b|"
    r"\b(confirm|proceed|go ahead|ok deal|nak order|i take|ambil)\b",
    re.IGNORECASE,
)
_INTERESTED_RE = re.compile(
    r"\b(discount|diskaun|cheaper|best price|better price|can less|kurang|nego|potong)\b|"
    r"\b(quote me|quotation|sebut harga|send (me )?(a )?quote)\b|"
    r"\b(deliver|delivery|install(ation)? date|when can)\b",
    re.IGNORECASE,
)
_BROWSING_RE = re.compile(r"\?|\b(how much|price|harga|berapa|got stock|ada stok|available)\b", re.IGNORECASE)

# Times a customer names in a chat, as hours after their message.
_PROMISES = [
    (re.compile(r"\b(tonight|malam ni|later today|petang ni|this evening)\b", re.IGNORECASE), 8, "tonight"),
    (re.compile(r"\b(tomorrow|tmr|tmrw|esok|besok)\b", re.IGNORECASE), 24, "tomorrow"),
    (re.compile(r"\b(this weekend|weekend)\b", re.IGNORECASE), 72, "this weekend"),
    (re.compile(r"\b(next week|minggu depan)\b", re.IGNORECASE), 168, "next week"),
]


def buying_level(message: str) -> str:
    """READY, INTERESTED, BROWSING, or "" (not a buying message, e.g. a complaint or a decline)."""
    text = (message or "").strip()
    if not text or _NOT_BUYING_RE.search(text):
        return ""
    if _READY_RE.search(text):
        return "READY"
    if _INTERESTED_RE.search(text):
        return "INTERESTED"
    if _BROWSING_RE.search(text):
        return "BROWSING"
    return ""


def promised_time(message: str) -> Optional[tuple]:
    """(hours after the message, the words they used) when the customer named a time, else None."""
    for pattern, hours, words in _PROMISES:
        if pattern.search(message or ""):
            return hours, words
    return None


def _items_text(deal: Optional[entities.Deal]) -> str:
    if not deal or not deal.items:
        return "your order"
    return ", ".join(f"{i.qty} units {i.name}" if i.qty > 1 else i.name for i in deal.items)


def _suggested(level: str, customer: str, deal: Optional[entities.Deal]) -> str:
    what = _items_text(deal)
    if level == "READY":
        return f"Hi {customer}, still keen on the {what}? I can send the bank details for the deposit whenever you're ready."
    return f"Hi {customer}, following up on the {what}. Shall I send you an updated quote today?"


def reengage_alerts(
    memories: Iterable, deals: List[entities.Deal], now: Optional[datetime] = None
) -> List[entities.ReengageAlert]:
    """Alerts for customers at READY or INTERESTED who went quiet, READY first, then the longest quiet.

    `memories` are client_memories rows; `deals` are the deals the viewer may see. A customer whose latest deal
    is already won or lost, or whose follow-ups are paused for a complaint, gets no alert.
    """
    now = now or datetime.now()
    latest = {}
    for d in sorted(deals, key=lambda d: d.created_at or ""):
        latest[customer_key(d.customer).lower()] = d
    alerts = []
    for m in memories:
        level = buying_level(m.last_message)
        last_at = parse_time(getattr(m, "last_customer_at", ""))
        if level not in ("READY", "INTERESTED") or not last_at:
            continue
        deal = latest.get(customer_key(m.customer).lower())
        if deal and (deal.stage in (Stage.WON, Stage.LOST) or deal.paused):
            continue
        promise = promised_time(m.last_message)
        due = last_at + timedelta(hours=promise[0] if promise else QUIET_HOURS)
        if now < due:
            continue
        quiet = int((now - last_at).total_seconds() // 3600)
        reason = (
            f"They said \"{promise[1]}\" and that time has passed"
            if promise else f"No reply for {quiet} hours after showing interest"
        )
        # "Wisma Perdana Sdn Bhd" reads oddly in a greeting; drop the company suffix
        name = re.sub(r"\s+(Sdn\.?\s*Bhd\.?|Bhd\.?|Enterprise|Trading)$", "", customer_key(m.customer), flags=re.IGNORECASE)
        alerts.append(
            entities.ReengageAlert(
                customer=m.customer,
                phone=m.phone or "",
                deal_id=deal.id if deal and deal.stage in OPEN_STAGES else None,
                amount=deal.amount if deal and deal.stage in OPEN_STAGES else None,
                level=level,
                said=m.last_message,
                quiet_hours=quiet,
                reason=reason,
                tier=m.tier or "",
                suggested_message=_suggested(level, name, deal if deal and deal.stage in OPEN_STAGES else None),
            )
        )
    alerts.sort(key=lambda a: (a.level != "READY", -a.quiet_hours))
    return alerts
