from typing import Any, Dict
from fastapi import APIRouter
from backend.database import (
    DB_PATH,
    DEFAULT_LMSTUDIO_API_KEY,
    DEFAULT_LMSTUDIO_URL,
    add_log,
    build_state_payload,
    get_db,
    get_setting,
    init_db,
    set_setting,
)
from backend.models.schemas import SettingsUpdateRequest
from backend.services.lmstudio import check_lmstudio_health

router = APIRouter(tags=["State & Settings"])


@router.get("/api/health")
def api_health() -> Dict[str, Any]:
    conn = get_db()
    lm_url = get_setting(conn, "lmstudio_url", DEFAULT_LMSTUDIO_URL)
    lm_key = get_setting(conn, "lmstudio_api_key", DEFAULT_LMSTUDIO_API_KEY)
    conn.close()
    lm_status = check_lmstudio_health(lm_url, api_key=lm_key)
    return {
        "status": "ok",
        "database": str(DB_PATH),
        "lmstudio": lm_status,
    }


@router.get("/api/state")
def api_get_state() -> Dict[str, Any]:
    return build_state_payload()


@router.post("/api/reset")
def api_reset_db() -> Dict[str, Any]:
    init_db(force_reset=True)
    return {"status": "reset_complete", "state": build_state_payload()}


@router.post("/api/settings")
def api_update_settings(req: SettingsUpdateRequest) -> Dict[str, Any]:
    conn = get_db()
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
