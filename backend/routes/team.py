from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from datetime import timedelta

from backend.database import (
    HOLD_TIME_FORMAT,
    add_log,
    build_state_payload,
    get_db,
    get_setting,
    now_time_str,
    parse_hold_time,
    set_setting,
)
from backend.models.schemas import ApprovalDecisionRequest, FastForwardRequest, PermissionsUpdateRequest
from backend.services.permissions import (
    ACTIONS,
    ALLOW,
    APPROVAL,
    DENY,
    HANDLERS,
    MODE_LABELS,
    approval_threshold,
    permissions_payload,
    require_owner,
    staff_mode,
)

router = APIRouter(tags=["Team & Permissions"])


@router.get("/api/permissions")
def api_get_permissions() -> Dict[str, Any]:
    conn = get_db()
    try:
        return permissions_payload(conn)
    finally:
        conn.close()


@router.post("/api/permissions")
def api_update_permissions(req: PermissionsUpdateRequest) -> Dict[str, Any]:
    conn = get_db()
    require_owner(req.role, "permissions.change", conn)

    for key, mode in (req.staffModes or {}).items():
        if key not in ACTIONS:
            conn.close()
            raise HTTPException(status_code=400, detail=f"Unknown permission {key}")
        mode = mode.upper()
        allowed = ACTIONS[key].get("modes", [ALLOW, APPROVAL, DENY])
        if mode not in allowed:
            conn.close()
            options = " or ".join(MODE_LABELS[m] for m in allowed)
            raise HTTPException(
                status_code=400,
                detail=f"'{ACTIONS[key]['label']}' can only be set to {options} (mandatory safety rule).",
            )
        old = staff_mode(conn, key)
        if old == mode:
            continue
        conn.execute(
            """
            INSERT INTO role_permissions (action_key, staff_mode, updated_at, updated_by) VALUES (?, ?, ?, 'OWNER')
            ON CONFLICT(action_key) DO UPDATE SET staff_mode = excluded.staff_mode,
                updated_at = excluded.updated_at, updated_by = excluded.updated_by
            """,
            (key, mode, now_time_str()),
        )
        add_log(
            conn,
            f"[OWNER] Permission changed · Staff · {ACTIONS[key]['label']}: {MODE_LABELS[old]} → {MODE_LABELS[mode]}.",
        )

    if req.threshold is not None:
        new_threshold = max(0, int(req.threshold))
        old_threshold = approval_threshold(conn)
        if new_threshold != old_threshold:
            set_setting(conn, "owner_approval_threshold", str(new_threshold))
            add_log(conn, f"[OWNER] Permission changed · Approval threshold: RM {old_threshold:,} → RM {new_threshold:,}.")

    if req.holdHours is not None:
        new_hours = min(720, max(1, int(req.holdHours)))
        old_hours = int(get_setting(conn, "hold_hours", "48") or 48)
        if new_hours != old_hours:
            set_setting(conn, "hold_hours", str(new_hours))
            add_log(conn, f"[OWNER] Setting changed · Quote stock hold: {old_hours}h → {new_hours}h (applies to new quotes).")

    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload()}


@router.post("/api/demo/fast-forward")
def api_demo_fast_forward(req: FastForwardRequest) -> Dict[str, Any]:
    """Demo helper: moves every hold expiry earlier, as if `hours` had passed, so judges can watch a hold expire."""
    conn = get_db()
    require_owner(req.role, "demo.time", conn)
    hours = min(240, max(1, int(req.hours)))
    rows = conn.execute("SELECT id, hold_expires_at FROM invoices WHERE hold_expires_at IS NOT NULL").fetchall()
    for r in rows:
        expires = parse_hold_time(r["hold_expires_at"])
        if expires:
            conn.execute(
                "UPDATE invoices SET hold_expires_at = ? WHERE id = ?",
                ((expires - timedelta(hours=hours)).strftime(HOLD_TIME_FORMAT), r["id"]),
            )
    add_log(conn, f"[OWNER] Demo: fast-forwarded the clock {hours}h for all quote holds.")
    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload()}


@router.post("/api/approvals/{approval_id}/decide")
def api_decide_approval(approval_id: int, req: ApprovalDecisionRequest) -> Dict[str, Any]:
    conn = get_db()
    require_owner(req.role, "approval.decide", conn)
    row = conn.execute("SELECT * FROM approval_requests WHERE id = ?", (approval_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Approval request #AP-{approval_id} not found")
    if row["status"] != "PENDING":
        conn.close()
        raise HTTPException(status_code=409, detail=f"Request #AP-{approval_id} is already {row['status']}")

    decision = req.decision.upper()
    note = (req.note or "").strip()
    if decision == "REJECT":
        conn.execute(
            "UPDATE approval_requests SET status = 'REJECTED', decided_by = 'OWNER', decision_note = ?, decided_at = ? WHERE id = ?",
            (note, now_time_str(), approval_id),
        )
        add_log(conn, f"[OWNER] Rejected request #AP-{approval_id} from Staff: {row['summary']}" + (f" ({note})" if note else "") + ".")
        conn.commit()
        conn.close()
        return {"status": "ok", "state": build_state_payload()}
    if decision != "APPROVE":
        conn.close()
        raise HTTPException(status_code=400, detail="decision must be APPROVE or REJECT")
    conn.close()

    # Re-run the original request as the Owner. The route re-checks the current data (e.g. the quote is still on hold).
    import json

    fn, model, _ = HANDLERS[row["handler"]]
    payload = json.loads(row["payload_json"])
    body = {**payload.get("body", {}), "role": "OWNER"}
    try:
        if model is None:
            fn(**payload.get("path", {}), role="OWNER")
        else:
            fn(**payload.get("path", {}), req=model(**body))
        status, detail = "APPROVED", ""
    except HTTPException as exc:
        status, detail = "FAILED", str(exc.detail)

    conn = get_db()
    conn.execute(
        "UPDATE approval_requests SET status = ?, decided_by = 'OWNER', decision_note = ?, decided_at = ? WHERE id = ?",
        (status, detail or note, now_time_str(), approval_id),
    )
    if status == "APPROVED":
        add_log(conn, f"[OWNER] Approved request #AP-{approval_id} from Staff: {row['summary']}.")
    else:
        add_log(conn, f"[OWNER] Approved request #AP-{approval_id} but it could not run: {detail}.")
    conn.commit()
    conn.close()
    if status == "FAILED":
        raise HTTPException(status_code=409, detail=f"Approved, but the action could not run: {detail}")
    return {"status": "ok", "state": build_state_payload()}
