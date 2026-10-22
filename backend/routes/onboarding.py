from fastapi import APIRouter, HTTPException

from backend.db import init_database, session_scope
from backend.db.seed import CUSTOM_PRESET, load_defaults
from backend.models.requests import OnboardingApplyRequest, OnboardingPreviewRequest
from backend.models.responses import PriceListPreview
from backend.models.state import ActionResponse
from backend.services.onboarding import apply_onboarding, decode_upload, parse_price_list
from backend.services.permissions import require_owner
from backend.services.pipeline import build_state

router = APIRouter(tags=["60-Second Setup"])


@router.post("/api/onboarding/preview", response_model=PriceListPreview)
def api_onboarding_preview(req: OnboardingPreviewRequest) -> PriceListPreview:
    """Reads an uploaded price list and returns the items for the Owner to check. Changes nothing."""
    require_owner(req.role, "business.setup")
    if not req.file_name.lower().endswith((".xlsx", ".xlsm", ".csv", ".txt")):
        raise HTTPException(status_code=400, detail="Upload an Excel (.xlsx) or CSV price list.")
    try:
        items, warnings = parse_price_list(req.file_name, decode_upload(req.file_base64))
    except Exception as exc:  # unreadable or corrupt file
        raise HTTPException(status_code=400, detail=f"Could not read {req.file_name}: {exc}")
    return PriceListPreview(items=items, warnings=warnings)


@router.post("/api/onboarding/apply", response_model=ActionResponse)
def api_onboarding_apply(req: OnboardingApplyRequest) -> ActionResponse:
    """Starts CashChase for a new business with its own price list (replaces the demo data)."""
    require_owner(req.role, "business.setup")
    name = req.company_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter the business name.")
    if not req.items:
        raise HTTPException(status_code=400, detail="Add at least one price-list item.")
    skus = [i.sku.strip().upper() for i in req.items]
    if any(not s for s in skus) or len(set(skus)) != len(skus):
        raise HTTPException(status_code=400, detail="Every item needs its own SKU (no blanks or duplicates).")
    defaults = load_defaults().settings
    setup = {
        "companyName": name,
        "followUpHours": req.follow_up_hours or int(defaults["follow_up_hours"]),
        "marginFloorPct": req.margin_floor_pct if req.margin_floor_pct is not None else float(defaults["margin_floor_pct"]),
        "items": [
            {"sku": s, "name": i.name.strip()[:80] or s, "unitCost": i.unit_cost, "sellPrice": i.sell_price}
            for s, i in zip(skus, req.items)
        ],
    }
    init_database(force_reset=True, preset=CUSTOM_PRESET)
    with session_scope() as s:
        apply_onboarding(s, setup)
    return ActionResponse(status="ok", state=build_state(req.role))
