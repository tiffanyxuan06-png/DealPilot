"""Owner-controlled Staff permissions, the Owner approval queue, and the mandatory safety rules.

Every money / stock route calls `enforce()` before it changes anything:
- the Owner always passes;
- a Staff action is ALLOW (runs), APPROVAL (saved to the approval queue, runs when the Owner approves) or DENY (403);
- mandatory rules below can tighten a Staff action but can never be loosened from Settings.
"""
import json
import sqlite3
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import HTTPException

from backend.database import add_log, build_state_payload, get_setting, now_time_str
from backend.services.auth import current_role

ALLOW, APPROVAL, DENY = "ALLOW", "APPROVAL", "DENY"
MODE_LABELS = {ALLOW: "Allowed", APPROVAL: "Needs Owner approval", DENY: "Off"}

DEFAULT_THRESHOLD_RM = 1000

# key -> label, group, default Staff mode, modes the Owner may choose, short note shown in Settings
ACTIONS: Dict[str, Dict[str, Any]] = {
    "quote.create": {"label": "Create quote & hold stock", "group": "Sales & Stock", "default": ALLOW},
    "quote.release": {"label": "Release a stock hold", "group": "Sales & Stock", "default": ALLOW},
    "order.walkin_paid": {"label": "Walk-in sale (paid now)", "group": "Sales & Stock", "default": ALLOW},
    "stock.add": {"label": "Add / restock stock", "group": "Sales & Stock", "default": ALLOW,
                  "note": "Paid restock above the threshold always needs approval"},
    "receipt.stage": {"label": "Upload customer receipt", "group": "Money In", "default": ALLOW},
    "receipt.verify": {"label": "Verify receipt against bank", "group": "Money In", "default": ALLOW,
                       "note": "Receipts that fail checks always need approval"},
    "deposit.confirm": {"label": "Confirm deposit (deducts stock, adds cash)", "group": "Money In", "default": ALLOW},
    "invoice.mark_paid": {"label": "Mark invoice fully paid", "group": "Money In", "default": ALLOW},
    "bill.record": {"label": "Record supplier / expense bill", "group": "Money Out", "default": ALLOW,
                    "note": "Above the threshold always needs approval"},
    "bill.pay": {"label": "Pay supplier bill", "group": "Money Out", "default": ALLOW,
                 "note": "Above the threshold always needs approval"},
    "labor.add": {"label": "Add extra piping & labor to invoice", "group": "Money Out", "default": ALLOW},
    "aftersales.replace": {"label": "Send aftersales replacement (-1 stock)", "group": "Aftersales", "default": ALLOW},
    "aftersales.resolve": {"label": "Mark aftersales resolved", "group": "Aftersales", "default": ALLOW},
    "discount.apply": {"label": "Give or change a discount / rebate", "group": "Aftersales", "default": APPROVAL,
                       "modes": [APPROVAL, DENY], "note": "Only the Owner sets discounts"},
    "invoice.set_tin": {"label": "Set customer LHDN TIN", "group": "Records", "default": ALLOW},
    "export.excel": {"label": "Export monthly Excel", "group": "Records", "default": DENY, "modes": [ALLOW, DENY]},
}

# Owner-only actions: not configurable.
OWNER_ONLY = {
    "permissions.change": "Change Team & Permissions",
    "settings.change": "Change business settings & AI rules",
    "data.reset": "Reset demo data",
    "approval.decide": "Approve or reject requests",
    "demo.time": "Fast-forward demo time",
    "profile.switch": "Switch SME profile",
    "business.setup": "Set up a new business (60-second setup)",
}

MANDATORY_RULES: List[str] = [
    "The Owner always has full access. Only the Owner can change permissions, settings or the approval threshold, and reset data.",
    "Only the Owner can approve or reject a request. Staff cannot approve their own requests.",
    "Discounts and rebates are set by the Owner: Staff can only request them (never 'Allowed').",
    "Staff money-out above the approval threshold (bills, payments, paid restock) always needs Owner approval.",
    "Receipts that fail checks (reference already used, amount does not match the balance) always need Owner approval.",
    "Stock can never be held beyond what is available; physical stock is only deducted on a confirmed deposit, sale or replacement.",
    "The activity log is append-only and records every action, request, decision and permission change.",
]

# Handlers that an approved request re-runs: name -> (function, request model or None, path param names)
HANDLERS: Dict[str, Tuple[Callable, Any, List[str]]] = {}


def register_handler(name: str, fn: Callable, model: Any, path_params: Optional[List[str]] = None) -> None:
    HANDLERS[name] = (fn, model, path_params or [])


def normalize_role(role: Optional[str]) -> str:
    """Unknown or missing roles get the least privilege.

    With login on, the signed-in user's role always wins over the role a request claims.
    """
    role = current_role() or role
    return "OWNER" if (role or "").strip().upper() == "OWNER" else "STAFF"


def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS role_permissions (
            action_key TEXT PRIMARY KEY,
            staff_mode TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS approval_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_key TEXT NOT NULL,
            summary TEXT NOT NULL,
            reason TEXT NOT NULL,
            handler TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            requested_by TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            decided_by TEXT DEFAULT NULL,
            decision_note TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            decided_at TEXT DEFAULT NULL
        );
        """
    )


def staff_mode(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT staff_mode FROM role_permissions WHERE action_key = ?", (key,)).fetchone()
    mode = row["staff_mode"] if row else ACTIONS[key]["default"]
    allowed = ACTIONS[key].get("modes", [ALLOW, APPROVAL, DENY])
    return mode if mode in allowed else ACTIONS[key]["default"]


def approval_threshold(conn: sqlite3.Connection) -> int:
    try:
        return int(get_setting(conn, "owner_approval_threshold", str(DEFAULT_THRESHOLD_RM)))
    except ValueError:
        return DEFAULT_THRESHOLD_RM


def require_owner(role: Optional[str], key: str, conn: Optional[sqlite3.Connection] = None) -> None:
    if normalize_role(role) != "OWNER":
        if conn is not None:
            conn.close()
        raise HTTPException(status_code=403, detail=f"Only the Owner can do this: {OWNER_ONLY[key]}.")


def enforce(
    conn: sqlite3.Connection,
    role: Optional[str],
    key: str,
    *,
    handler: str,
    payload: Dict[str, Any],
    summary: str,
    money_out_rm: Optional[int] = None,
    mandatory_reason: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Returns None when the action may run now, or a pending-approval response.

    Raises 403 (and closes `conn`) when the action is Off for Staff.
    `money_out_rm` applies the threshold rule; `mandatory_reason` forces approval (e.g. a receipt that failed checks).
    """
    if normalize_role(role) == "OWNER":
        return None

    mode = staff_mode(conn, key)
    label = ACTIONS[key]["label"]
    if mode == DENY:
        conn.close()
        raise HTTPException(status_code=403, detail=f"Staff are not allowed to: {label}. Ask the Owner.")

    reason = None
    if mode == APPROVAL:
        reason = f"Owner set '{label}' to need approval"
    if money_out_rm is not None and money_out_rm > approval_threshold(conn):
        reason = f"Above RM {approval_threshold(conn):,} approval threshold"
    if mandatory_reason:
        reason = mandatory_reason
    if reason is None:
        return None

    cur = conn.execute(
        """
        INSERT INTO approval_requests (action_key, summary, reason, handler, payload_json, requested_by, created_at)
        VALUES (?, ?, ?, ?, ?, 'STAFF', ?)
        """,
        (key, summary, reason, handler, json.dumps(payload), now_time_str()),
    )
    request_id = cur.lastrowid
    add_log(conn, f"[STAFF] Requested Owner approval #AP-{request_id}: {summary} ({reason}).")
    conn.commit()
    conn.close()
    return {
        "status": "pending_approval",
        "approvalId": request_id,
        "message": f"Sent to Owner for approval: {summary}",
        "reason": reason,
        "state": build_state_payload(),
    }


def payee_matches_company(payee: str, company: str) -> bool:
    """Lenient name match: the main words of the company name (not 'Sdn Bhd') must appear in the payee."""
    import re

    skip = {"sdn", "bhd", "enterprise", "trading", "plt", "the"}
    words = [w for w in re.findall(r"[a-z0-9]+", company.lower()) if len(w) >= 3 and w not in skip]
    payee_l = payee.lower()
    hits = sum(1 for w in words if w in payee_l)
    return hits >= min(2, len(words)) if words else True


def receipt_check_reasons(conn: sqlite3.Connection, inv: sqlite3.Row, paid_rm: Optional[int]) -> List[str]:
    """Code-only receipt checks. Worded as 'needs checking', never as fraud."""
    reasons = []
    ref = (inv["receipt_ref"] or "").strip()
    if ref:
        other = conn.execute(
            "SELECT id FROM invoices WHERE receipt_ref = ? AND id != ? LIMIT 1", (ref, inv["id"])
        ).fetchone()
        if other:
            reasons.append(f"reference {ref} already used on #{other['id']}")
    payee = (inv["receipt_payee"] or "").strip()
    company = get_setting(conn, "company_name", "")
    if payee and company and not payee_matches_company(payee, company):
        reasons.append(f"paid to '{payee}', not {company}")
    seen = paid_rm if paid_rm is not None else inv["claimed_amount"]
    if seen is not None and seen != inv["amount"]:
        diff = inv["amount"] - seen
        reasons.append(f"RM {abs(diff):,} {'short' if diff > 0 else 'over'} vs balance RM {inv['amount']:,}")
    return reasons


def permissions_payload(conn: sqlite3.Connection) -> Dict[str, Any]:
    return {
        "threshold": approval_threshold(conn),
        "holdHours": int(get_setting(conn, "hold_hours", "48") or 48),
        "modeLabels": MODE_LABELS,
        "actions": [
            {
                "key": key,
                "label": a["label"],
                "group": a["group"],
                "mode": staff_mode(conn, key),
                "default": a["default"],
                "modes": a.get("modes", [ALLOW, APPROVAL, DENY]),
                "note": a.get("note", ""),
            }
            for key, a in ACTIONS.items()
        ],
        "ownerOnly": list(OWNER_ONLY.values()),
        "mandatoryRules": MANDATORY_RULES,
    }


def approvals_payload(conn: sqlite3.Connection, limit: int = 20) -> List[Dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM approval_requests ORDER BY (status = 'PENDING') DESC, id DESC LIMIT ?", (limit,)
    ).fetchall()
    return [
        {
            "id": r["id"],
            "actionKey": r["action_key"],
            "summary": r["summary"],
            "reason": r["reason"],
            "requestedBy": r["requested_by"],
            "status": r["status"],
            "decidedBy": r["decided_by"],
            "decisionNote": r["decision_note"] or "",
            "createdAt": r["created_at"],
            "decidedAt": r["decided_at"],
        }
        for r in rows
    ]
