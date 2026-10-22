"""Owner-controlled Staff permissions, the Owner approval queue, and the mandatory safety rules.

Every deal route calls `enforce()` before it changes anything:
- the Owner always passes;
- a Staff action is ALLOW (runs), APPROVAL (saved to the approval queue, runs when the Owner approves) or DENY (403);
- mandatory rules below can tighten a Staff action but can never be loosened from Settings.

The rules are code on purpose: they are what the backend enforces, so changes go through review.
"""
import json
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import case, select
from sqlalchemy.orm import Session

from backend.db import orm
from backend.models import entities
from backend.models.enums import PermissionMode, Role
from backend.models.state import ActionResponse
from backend.services.auth import current_role
from backend.services.business import load_business
from backend.services.clock import now_time_str

ALLOW, APPROVAL, DENY = PermissionMode.ALLOW.value, PermissionMode.APPROVAL.value, PermissionMode.DENY.value
MODE_LABELS = {ALLOW: "Allowed", APPROVAL: "Needs Owner approval", DENY: "Off"}

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

# Handlers that an approved request re-runs: name -> (route function, request model or None).
# The stored payload keeps the path params ({"path": {...}, "body": {...}}), so they are not listed here.
HANDLERS: Dict[str, Tuple[Callable, Any]] = {}


def register_handler(name: str, fn: Callable, model: Any) -> None:
    HANDLERS[name] = (fn, model)


def normalize_role(role: Optional[str]) -> str:
    """Unknown or missing roles get the least privilege.

    With login on, the signed-in user's role always wins over the role a request claims.
    """
    role = current_role() or role
    return Role.OWNER.value if (role or "").strip().upper() == Role.OWNER.value else Role.STAFF.value


def staff_mode(session: Session, key: str) -> str:
    row = session.get(orm.RolePermission, key)
    mode = row.staff_mode if row else ACTIONS[key]["default"]
    allowed = ACTIONS[key].get("modes", [ALLOW, APPROVAL, DENY])
    return mode if mode in allowed else ACTIONS[key]["default"]


def require_owner(role: Optional[str], key: str) -> None:
    if normalize_role(role) != Role.OWNER.value:
        raise HTTPException(status_code=403, detail=f"Only the Owner can do this: {OWNER_ONLY[key]}.")


def enforce(
    session: Session,
    role: Optional[str],
    key: str,
    *,
    handler: str,
    payload: Dict[str, Any],
    summary: str,
    mandatory_reason: Optional[str] = None,
) -> Optional[ActionResponse]:
    """Returns None when the action may run now, or a pending-approval response (the request is saved and committed).

    Raises 403 when the action is Off for Staff. `mandatory_reason` forces approval (e.g. below the margin floor).
    """
    from backend.services.pipeline import build_state, log

    if normalize_role(role) == Role.OWNER.value:
        return None

    mode = staff_mode(session, key)
    label = ACTIONS[key]["label"]
    if mode == DENY:
        raise HTTPException(status_code=403, detail=f"Staff are not allowed to: {label}. Ask the Owner.")

    reason = None
    if mode == APPROVAL:
        reason = f"Owner set '{label}' to need approval"
    if mandatory_reason:
        reason = mandatory_reason
    if reason is None:
        return None

    request = orm.ApprovalRequest(
        action_key=key,
        summary=summary,
        reason=reason,
        handler=handler,
        payload_json=json.dumps(payload),
        requested_by=Role.STAFF.value,
        created_at=now_time_str(),
    )
    session.add(request)
    session.flush()
    log(session, f"[STAFF] Requested Owner approval #AP-{request.id}: {summary} ({reason}).")
    session.commit()
    return ActionResponse(
        status="pending_approval",
        approval_id=request.id,
        message=f"Sent to Owner for approval: {summary}",
        reason=reason,
        state=build_state(),
    )


def permissions_payload(session: Session) -> entities.Permissions:
    biz = load_business(session)
    return entities.Permissions(
        follow_up_hours=biz.follow_up_hours,
        margin_floor_pct=biz.margin_floor_pct,
        mode_labels=MODE_LABELS,
        actions=[
            entities.PermissionAction(
                key=key,
                label=a["label"],
                group=a["group"],
                mode=staff_mode(session, key),
                default=a["default"],
                modes=a.get("modes", [ALLOW, APPROVAL, DENY]),
                note=a.get("note", ""),
            )
            for key, a in ACTIONS.items()
        ],
        owner_only=list(OWNER_ONLY.values()),
        mandatory_rules=MANDATORY_RULES,
    )


def approvals_payload(session: Session, limit: int = 20) -> List[entities.Approval]:
    pending_first = case((orm.ApprovalRequest.status == "PENDING", 0), else_=1)
    rows = session.scalars(select(orm.ApprovalRequest).order_by(pending_first, orm.ApprovalRequest.id.desc()).limit(limit))
    return [entities.Approval.model_validate(r) for r in rows]
