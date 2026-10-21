import re
import sqlite3
from datetime import datetime
from typing import Any, Dict
from backend.database import get_db


def clean_customer_name(name: str) -> str:
    """Clean customer name by removing parenthetical tags like (Deposit), (Walk-in), etc."""
    if not name:
        return "Boss"
    cleaned = re.sub(r"\s*[\(\[][^\)\]]*[\)\]]", "", name).strip(" !?,.:;*#-_\"'")
    return cleaned or "Boss"


def compute_client_memory_rating(
    customer: str,
    phone: str = "",
    message: str = "",
    state: Dict[str, Any] = None,
    conn = None
) -> Dict[str, Any]:
    """
    Computes accurate, persistent memory rating for WhatsApp clients.
    Distinguishes genuine NEW_CLIENT from repeat buyers, high-risk ghosts, and VIP fast payers.
    """
    cust_clean = customer.strip()
    phone_clean = (phone or "").strip()
    should_close = False
    if conn is None:
        conn = get_db()
        should_close = True

    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS client_memories (
                customer TEXT PRIMARY KEY,
                phone TEXT DEFAULT '',
                tier TEXT NOT NULL DEFAULT 'NEW_CLIENT',
                score INTEGER NOT NULL DEFAULT 50,
                style_summary TEXT NOT NULL DEFAULT 'Direct SME buyer · Prefers fast stock & price confirmation',
                payment_behavior TEXT NOT NULL DEFAULT 'Standard payment terms apply',
                total_orders INTEGER NOT NULL DEFAULT 0,
                total_paid_rm INTEGER NOT NULL DEFAULT 0,
                last_message TEXT DEFAULT '',
                recent_history_json TEXT DEFAULT '[]',
                cached_analysis_json TEXT DEFAULT '',
                updated_at TEXT NOT NULL
            )
            """
        )

        if not cust_clean or cust_clean.lower() in ("customer", "client", "walk-in", "walk-in counter", "no chat open"):
            return {
                "customer": cust_clean or "New Client",
                "phone": phone_clean,
                "tier": "NEW_CLIENT",
                "score": 50,
                "styleSummary": "Direct SME buyer · Prefers clear pricing & fast confirmation",
                "paymentBehavior": "🆕 New Customer · No past transaction history · Standard terms apply (30%-50% deposit to lock stock)",
                "totalOrders": 0,
                "totalPaidRm": 0,
                "isNew": True,
                "lastMessage": message or "",
                "updatedAt": datetime.now().strftime("%I:%M %p"),
            }

        mem_row = conn.execute(
            "SELECT * FROM client_memories WHERE LOWER(customer) = LOWER(?)", (cust_clean,)
        ).fetchone()

        if not mem_row and phone_clean:
            mem_row = conn.execute(
                "SELECT * FROM client_memories WHERE phone = ? AND phone != ''", (phone_clean,)
            ).fetchone()

        # Invoices matching this customer
        cust_invoices = []
        if cust_clean and len(cust_clean) >= 3:
            if state and "invoices" in state:
                cust_invoices = [
                    i for i in state["invoices"]
                    if cust_clean.lower() == i.get("party", "").lower() or (
                        len(cust_clean) >= 4 and cust_clean.lower() in i.get("party", "").lower()
                    )
                ]
            else:
                inv_rows = conn.execute(
                    "SELECT * FROM invoices WHERE LOWER(party) = ? OR (LENGTH(?) >= 4 AND LOWER(party) LIKE ?)",
                    (cust_clean.lower(), cust_clean, f"%{cust_clean.lower()}%")
                ).fetchall()
                cust_invoices = [dict(r) for r in inv_rows]

        # Detect tone / communication style
        msg_low = (message or "").lower()
        if any(w in msg_low for w in ["boss", "ah", "la", "lah", "bro", "urgent", "yo"]):
            detected_style = "Friendly Malaysian Boss / Manglish style ('Boss', 'lah') · Prefers warm, fast, direct replies"
        elif any(w in msg_low for w in ["salam", "tuan", "encik", "berapa", "stok", "terima kasih", "tuan haji"]):
            detected_style = "Polite Bahasa Melayu style · Prefers respectful BM or bilingual reply"
        elif mem_row and mem_row["style_summary"]:
            detected_style = mem_row["style_summary"]
        else:
            detected_style = "Professional SME buyer · Prefers clear itemization & transparent pricing"

        # Calculate transaction track record
        paid_invoices = [i for i in cust_invoices if i.get("status") in ("PAID", "VERIFIED")]
        expired_holds = sum(1 for i in cust_invoices if i.get("status") in ("HOLD_EXPIRED", "EXPIRED"))
        short_payments = sum(
            1 for i in cust_invoices
            if i.get("claimedAmount") and i.get("amount") and i.get("claimedAmount") < i.get("amount")
        )

        if mem_row and mem_row["tier"] != "NEW_CLIENT":
            tier = mem_row["tier"]
            score = mem_row["score"]
            pay_behavior = mem_row["payment_behavior"]
            total_orders = mem_row["total_orders"]
            total_paid_rm = mem_row["total_paid_rm"]
            is_new = False
        elif len(cust_invoices) == 0:
            tier = "NEW_CLIENT"
            score = 50
            is_new = True
            pay_behavior = "🆕 New Customer · No past transaction history · Standard terms apply (30%-50% deposit to lock stock)"
            total_orders = 0
            total_paid_rm = 0
        else:
            is_new = False
            total_orders = len(cust_invoices)
            total_paid_rm = sum(i.get("amount", 0) for i in paid_invoices)
            if expired_holds > 0:
                tier = "SLOW_PAYER_GHOST_RISK"
                score = max(25, 55 - (expired_holds * 15))
                pay_behavior = f"⚠️ Ghosting / Hold Expired ({expired_holds}x expired >48h) · Strict 50% deposit required"
            elif short_payments > 0:
                tier = "PARTIAL_SHORT_PAYER"
                score = 58
                pay_behavior = "⚠️ Shortfall History · Sent screenshot with underpaid amount · Verify bank before release"
            elif len(paid_invoices) >= 3 and total_paid_rm >= 10000:
                tier = "VIP_FAST_PAYER"
                score = min(98, 86 + len(paid_invoices) * 2)
                pay_behavior = f"⭐⭐⭐⭐⭐ VIP Grade A · {len(paid_invoices)} orders (RM {total_paid_rm:,} paid) · Immediate 48h hold"
            elif len(paid_invoices) >= 1:
                tier = "REPEAT_CLIENT"
                score = 75
                pay_behavior = f"⭐⭐⭐⭐ Verified Client · {len(paid_invoices)} completed orders (RM {total_paid_rm:,} paid)"
            else:
                tier = "PROSPECT_CLIENT"
                score = 60
                pay_behavior = f"Inquiry Stage · {total_orders} quotation(s) generated, awaiting initial deposit"

        return {
            "customer": cust_clean,
            "phone": phone_clean,
            "tier": tier,
            "score": score,
            "isNew": is_new,
            "styleSummary": detected_style,
            "paymentBehavior": pay_behavior,
            "totalOrders": total_orders,
            "totalPaidRm": total_paid_rm,
            "trustBadge": "🆕 New Client" if tier == "NEW_CLIENT" else f"{'⚠️' if score < 60 else '⭐'} {tier.replace('_', ' ')} ({score}/100)",
            "depositRequirement": "50% upfront" if tier == "SLOW_PAYER_GHOST_RISK" else ("40% standard" if tier == "NEW_CLIENT" else "Standard / 48h hold"),
        }
    finally:
        if should_close:
            conn.close()
