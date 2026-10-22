import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException

from backend.config import get_settings
from backend.db import init_database, session_scope
from backend.db.seed import CUSTOM_PRESET, available_presets
from backend.models.requests import ProfileSwitchRequest, RoleRequest, SettingsUpdateRequest
from backend.models.state import ActionResponse, StatePayload
from backend.services.business import load_business, save_setting
from backend.services.lmstudio import check_lmstudio_health
from backend.services.onboarding import apply_onboarding
from backend.services.permissions import require_owner
from backend.services.pipeline import build_state, log, resolve_active_ai_credentials

router = APIRouter(tags=["State & Settings"])


@router.get("/api/health")
def api_health() -> Dict[str, Any]:
    ai = resolve_active_ai_credentials()
    return {
        "status": "ok",
        # Only the database type, never the URL (it can hold a password).
        "database": get_settings().database_url.split(":", 1)[0],
        "aiProvider": ai["provider"],
        "lmstudio": check_lmstudio_health(ai["base_url"], api_key=ai["api_key"]),
    }


@router.get("/api/state", response_model=StatePayload)
def api_get_state(role: Optional[str] = None, x_cashchase_role: Optional[str] = Header(None)) -> StatePayload:
    """Unit costs and margin % are only included for the Owner (with login on, the signed-in role decides)."""
    return build_state(role or x_cashchase_role)


@router.post("/api/reset", response_model=ActionResponse)
def api_reset_db(req: Optional[RoleRequest] = None, x_cashchase_role: Optional[str] = Header(None)) -> ActionResponse:
    role = (req.role if req else None) or x_cashchase_role
    require_owner(role, "data.reset")
    with session_scope() as s:
        biz = load_business(s)  # reset keeps the current business
    init_database(force_reset=True, preset=biz.sme_preset)
    if biz.sme_preset == CUSTOM_PRESET and biz.onboarding_json:
        # A business from the 60-second setup is rebuilt from its own price list, not demo data.
        with session_scope() as s:
            apply_onboarding(s, json.loads(biz.onboarding_json))
    return ActionResponse(status="reset_complete", state=build_state(role))


@router.post("/api/profile", response_model=ActionResponse)
def api_switch_profile(req: ProfileSwitchRequest) -> ActionResponse:
    """Owner only: load another demo business from backend/schema/seeds (replaces the current data)."""
    require_owner(req.role, "profile.switch")
    presets = available_presets()
    preset = (req.preset or "").strip().lower()
    if preset not in presets:
        raise HTTPException(status_code=400, detail=f"Unknown profile '{req.preset}'. Choose one of: {', '.join(presets)}")
    init_database(force_reset=True, preset=preset)
    with session_scope() as s:
        log(s, f"[OWNER] Switched SME profile to {presets[preset]} (demo data loaded).")
    return ActionResponse(status="ok", state=build_state(req.role))


@router.post("/api/settings", response_model=ActionResponse)
def api_update_settings(req: SettingsUpdateRequest) -> ActionResponse:
    require_owner(req.role, "settings.change")
    with session_scope() as s:
        if req.framework is not None:
            save_setting(s, "framework", req.framework)
            log(s, "[OWNER] Updated AI Custom Labor & Pricing Framework.")
        if req.lmstudio_url is not None:
            save_setting(s, "lmstudio_url", req.lmstudio_url.strip())
            log(s, f"[OWNER] Updated LM Studio Local API URL to {req.lmstudio_url.strip()}.")
        if req.lmstudio_api_key is not None:
            save_setting(s, "lmstudio_api_key", req.lmstudio_api_key.strip())
        if req.lmstudio_model is not None:
            save_setting(s, "lmstudio_model", req.lmstudio_model.strip())
    return ActionResponse(status="updated", state=build_state(req.role))
