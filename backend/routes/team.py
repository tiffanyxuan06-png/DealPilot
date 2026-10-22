import json
from datetime import timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from backend.db import orm, session_scope
from backend.models import entities
from backend.models.enums import Role
from backend.models.requests import ApprovalDecisionRequest, FastForwardRequest, PermissionsUpdateRequest
from backend.models.state import ActionResponse
from backend.services.business import load_business, save_setting
from backend.services.clock import TIME_FORMAT, now_time_str, parse_time
from backend.services.permissions import (
    ACTIONS,
    ALLOW,
    APPROVAL,
    DENY,
    HANDLERS,
    MODE_LABELS,
    permissions_payload,
    require_owner,
    staff_mode,
)
from backend.services.pipeline import build_state, log

router = APIRouter(tags=["Team & Permissions"])


@router.get("/api/permissions", response_model=entities.Permissions)
def api_get_permissions() -> entities.Permissions:
    with session_scope() as s:
        return permissions_payload(s)


@router.post("/api/permissions", response_model=ActionResponse)
def api_update_permissions(req: PermissionsUpdateRequest) -> ActionResponse:
    require_owner(req.role, "permissions.change")
    with session_scope() as s:
        for key, mode in (req.staff_modes or {}).items():
            if key not in ACTIONS:
                raise HTTPException(status_code=400, detail=f"Unknown permission {key}")
            mode = mode.upper()
            allowed = ACTIONS[key].get("modes", [ALLOW, APPROVAL, DENY])
            if mode not in allowed:
                options = " or ".join(MODE_LABELS[m] for m in allowed)
                raise HTTPException(status_code=400, detail=f"'{ACTIONS[key]['label']}' can only be set to {options} (mandatory safety rule).")
            old = staff_mode(s, key)
            if old == mode:
                continue
            s.merge(orm.RolePermission(action_key=key, staff_mode=mode, updated_at=now_time_str(), updated_by=Role.OWNER.value))
            log(s, f"[OWNER] Permission changed · Staff · {ACTIONS[key]['label']}: {MODE_LABELS[old]} → {MODE_LABELS[mode]}.")

        biz = load_business(s)
        if req.margin_floor_pct is not None:
            new_floor = round(req.margin_floor_pct, 1)
            if new_floor != biz.margin_floor_pct:
                save_setting(s, "margin_floor_pct", new_floor)
                log(s, f"[OWNER] Setting changed · Margin floor: {biz.margin_floor_pct:g}% → {new_floor:g}%.")
        if req.follow_up_hours is not None and req.follow_up_hours != biz.follow_up_hours:
            save_setting(s, "follow_up_hours", req.follow_up_hours)
            log(s, f"[OWNER] Setting changed · Follow-up after: {biz.follow_up_hours}h → {req.follow_up_hours}h (applies to new quotes).")
    return ActionResponse(status="ok", state=build_state(req.role))


@router.post("/api/demo/fast-forward", response_model=ActionResponse)
def api_demo_fast_forward(req: FastForwardRequest) -> ActionResponse:
    """Demo helper: moves every follow-up time earlier, as if `hours` had passed, so judges can watch one fall due."""
    require_owner(req.role, "demo.time")
    with session_scope() as s:
        for d in s.scalars(select(orm.Deal).where(orm.Deal.follow_up_at.is_not(None))):
            due = parse_time(d.follow_up_at)
            if due:
                d.follow_up_at = (due - timedelta(hours=req.hours)).strftime(TIME_FORMAT)
        log(s, f"[OWNER] Demo: fast-forwarded the clock {req.hours}h for all follow-ups.")
    return ActionResponse(status="ok", state=build_state(req.role))


@router.post("/api/approvals/{approval_id}/decide", response_model=ActionResponse)
def api_decide_approval(approval_id: int, req: ApprovalDecisionRequest) -> ActionResponse:
    require_owner(req.role, "approval.decide")
    decision = req.decision.upper()
    note = (req.note or "").strip()
    with session_scope() as s:
        row = s.get(orm.ApprovalRequest, approval_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Approval request #AP-{approval_id} not found")
        if row.status != "PENDING":
            raise HTTPException(status_code=409, detail=f"Request #AP-{approval_id} is already {row.status}")
        if decision not in ("APPROVE", "REJECT"):
            raise HTTPException(status_code=400, detail="decision must be APPROVE or REJECT")
        summary, handler, payload_json = row.summary, row.handler, row.payload_json
        if decision == "REJECT":
            row.status, row.decided_by, row.decision_note, row.decided_at = "REJECTED", Role.OWNER.value, note, now_time_str()
            log(s, f"[OWNER] Rejected request #AP-{approval_id} from Staff: {summary}" + (f" ({note})" if note else "") + ".")
    if decision == "REJECT":
        return ActionResponse(status="ok", state=build_state(req.role))

    # Re-run the original request as the Owner. The route re-checks the current data (e.g. the deal is still open).
    fn, model = HANDLERS[handler]
    payload = json.loads(payload_json)
    body = {**payload.get("body", {}), "role": Role.OWNER.value}
    try:
        if model is None:
            fn(**payload.get("path", {}), role=Role.OWNER.value)
        else:
            fn(**payload.get("path", {}), req=model(**body))
        status, detail = "APPROVED", ""
    except HTTPException as exc:
        status, detail = "FAILED", str(exc.detail)

    with session_scope() as s:
        row = s.get(orm.ApprovalRequest, approval_id)
        row.status, row.decided_by, row.decision_note, row.decided_at = status, Role.OWNER.value, detail or note, now_time_str()
        if status == "APPROVED":
            log(s, f"[OWNER] Approved request #AP-{approval_id} from Staff: {summary}.")
        else:
            log(s, f"[OWNER] Approved request #AP-{approval_id} but it could not run: {detail}.")
    if status == "FAILED":
        raise HTTPException(status_code=409, detail=f"Approved, but the action could not run: {detail}")
    return ActionResponse(status="ok", state=build_state(req.role))
