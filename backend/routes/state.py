import json
from typing import Any, Dict, Optional
from fastapi import APIRouter, Header, HTTPException
from backend.database import (
    DB_PATH,
    DEFAULT_LMSTUDIO_API_KEY,
    DEFAULT_LMSTUDIO_URL,
    add_log,
    build_state_payload,
    get_db,
    get_setting,
    init_db,
    now_time_str,
    resolve_active_ai_credentials,
    set_setting,
)
from backend.models.schemas import ProfileSwitchRequest, RoleRequest, SettingsUpdateRequest
from backend.services.onboarding import apply_onboarding
from backend.services.profiles import PROFILE_NAMES
from backend.services.permissions import require_owner
from backend.services.lmstudio import check_lmstudio_health

router = APIRouter(tags=["State & Settings"])


@router.get("/api/health")
def api_health() -> Dict[str, Any]:
    ai = resolve_active_ai_credentials()
    lm_status = check_lmstudio_health(ai["base_url"], api_key=ai["api_key"])
    return {
        "status": "ok",
        "database": str(DB_PATH),
        "aiProvider": ai["provider"],
        "lmstudio": lm_status,
    }


@router.get("/api/state")
def api_get_state() -> Dict[str, Any]:
    return build_state_payload()


@router.post("/api/reset")
def api_reset_db(
    req: Optional[RoleRequest] = None, x_cashchase_role: Optional[str] = Header(None)
) -> Dict[str, Any]:
    require_owner((req.role if req else None) or x_cashchase_role, "data.reset")
    conn = get_db()
    preset = get_setting(conn, "sme_preset", "aircond")  # reset keeps the current business profile
    setup_json = get_setting(conn, "onboarding_json", "")
    conn.close()
    init_db(force_reset=True, preset=preset)
    if preset == "custom" and setup_json:
        # A business from the 60-second setup is rebuilt from its own stock list, not demo data.
        conn = get_db()
        apply_onboarding(conn, json.loads(setup_json), now_time_str())
        conn.commit()
        conn.close()
    return {"status": "reset_complete", "state": build_state_payload()}


@router.post("/api/profile")
def api_switch_profile(req: ProfileSwitchRequest) -> Dict[str, Any]:
    """Owner only: load another SME profile's demo data (replaces the current demo data)."""
    require_owner(req.role, "profile.switch")
    preset = (req.preset or "").strip().lower()
    if preset not in PROFILE_NAMES:
        raise HTTPException(status_code=400, detail=f"Unknown profile '{req.preset}'. Choose one of: {', '.join(PROFILE_NAMES)}")
    init_db(force_reset=True, preset=preset)
    conn = get_db()
    add_log(conn, f"[OWNER] Switched SME profile to {PROFILE_NAMES[preset]} (demo data loaded).")
    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload()}


@router.post("/api/settings")
def api_update_settings(req: SettingsUpdateRequest) -> Dict[str, Any]:
    conn = get_db()
    require_owner(req.role, "settings.change", conn)
    if req.framework is not None:
        set_setting(conn, "framework", req.framework)
        add_log(conn, "[OWNER] Updated AI Custom Labor & Pricing Framework.")
    if req.lmstudioUrl is not None:
        set_setting(conn, "lmstudio_url", req.lmstudioUrl.strip())
        add_log(conn, f"[OWNER] Updated LM Studio Local API URL to {req.lmstudioUrl.strip()}.")
    if req.lmstudioApiKey is not None:
        set_setting(conn, "lmstudio_api_key", req.lmstudioApiKey.strip())
    if req.lmstudioModel is not None:
        set_setting(conn, "lmstudio_model", req.lmstudioModel.strip())
    conn.commit()
    conn.close()
    return {"status": "updated", "state": build_state_payload()}
