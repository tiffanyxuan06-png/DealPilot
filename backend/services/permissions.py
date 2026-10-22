"""Owner-controlled Staff permissions, the Owner approval queue, and the mandatory safety rules.

Every deal route calls `enforce()` before it changes anything:
- the Owner always passes;
- a Staff action is ALLOW (runs), APPROVAL (saved to the approval queue, runs when the Owner approves) or DENY (403);
- mandatory rules below can tighten a Staff action but can never be loosened from Settings.
"""
import json
import sqlite3
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import HTTPException

from backend.database import add_log, build_state_payload, follow_up_hours, get_setting, now_time_str
from backend.services.auth import current_role

ALLOW, APPROVAL, DENY = "ALLOW", "APPROVAL", "DENY"
MODE_LABELS = {ALLOW: "Allowed", APPROVAL: "Needs Owner approval", DENY: "Off"}

DEFAULT_MARGIN_FLOOR_PCT = 15.0

# key -> label, group, default Staff mode, modes the Owner may choose, short note shown in Settings
ACTIONS: Dict[str, Dict[str, Any]] = {
    "deal.create": {"label": "Log inquiry / send quote", "group": "Deals", "default": ALLOW},
    "deal.follow_up": {"label": "Send follow-up", "group": "Deals", "default": ALLOW},
    "deal.won": {"label": "Mark deal won", "group": "Deals", "default": ALLOW},
    "deal.lost": {"label": "Mark deal lost", "group": "Deals", "default": ALLOW},
    "deal.pause": {"label": "Pause / resume follow-ups (complaint)", "group": "Deals", "default": ALLOW},
    "discount.apply": {"label": "Give a discount", "group": "Pricing", "default": ALLOW,
                       "note": "Below the margin floor always needs approval"},
    "deal.set_tin": {"label": "Set customer LHDN TIN", "group": "Records", "default": ALLOW},
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
    "reps.manage": "Add or edit sales reps and commission rates",
    "reps.reassign": "Reassign a rep's customers and deals",
    "pricelist.edit": "Edit the price list",
    "export.csv": "Download the won-orders CSV",
}

MANDATORY_RULES: List[str] = [
    "The Owner always has full access. Only the Owner can change permissions, settings, the price list, reps and the margin floor, and reset data.",
    "Only the Owner can approve or reject a request. Staff cannot approve their own requests.",
    "A price or discount below the margin floor always needs Owner approval for Staff, whatever the setting.",
    "Only the Owner can reassign customers and download the won-orders CSV.",
    "Every RM amount in an AI reply must be one CashChase calculated; quotes always say 'subject to stock availability'.",
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


def margin_floor(conn: sqlite3.Connection) -> float:
    try:
        return float(get_setting(conn, "margin_floor_pct", str(DEFAULT_MARGIN_FLOOR_PCT)))
    except ValueError:
        return DEFAULT_MARGIN_FLOOR_PCT


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
    mandatory_reason: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Returns None when the action may run now, or a pending-approval response.

    Raises 403 (and closes `conn`) when the action is Off for Staff.
    `mandatory_reason` forces approval (e.g. a discount below the margin floor).
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


def permissions_payload(conn: sqlite3.Connection) -> Dict[str, Any]:
    return {
        "followUpHours": follow_up_hours(conn),
        "marginFloorPct": margin_floor(conn),
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
