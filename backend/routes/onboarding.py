from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from backend.database import build_state_payload, get_db, init_db, now_time_str
from backend.models.schemas import OnboardingApplyRequest, OnboardingPreviewRequest
from backend.services.onboarding import apply_onboarding, decode_upload, parse_price_list
from backend.services.permissions import require_owner

router = APIRouter(tags=["60-Second Setup"])


@router.post("/api/onboarding/preview")
def api_onboarding_preview(req: OnboardingPreviewRequest) -> Dict[str, Any]:
    """Reads an uploaded price list and returns the items for the Owner to check. Changes nothing."""
    require_owner(req.role, "business.setup")
    if not req.fileName.lower().endswith((".xlsx", ".xlsm", ".csv", ".txt")):
        raise HTTPException(status_code=400, detail="Upload an Excel (.xlsx) or CSV price list.")
    try:
        items, warnings = parse_price_list(req.fileName, decode_upload(req.fileBase64))
    except Exception as exc:  # unreadable or corrupt file
        raise HTTPException(status_code=400, detail=f"Could not read {req.fileName}: {exc}")
    return {"items": items, "warnings": warnings}


@router.post("/api/onboarding/apply")
def api_onboarding_apply(req: OnboardingApplyRequest) -> Dict[str, Any]:
    """Starts CashChase for a new business with its own price list (replaces the demo data)."""
    require_owner(req.role, "business.setup")
    name = req.companyName.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter the business name.")
    if not req.items:
        raise HTTPException(status_code=400, detail="Add at least one price-list item.")
    skus = [i.sku.strip().upper() for i in req.items]
    if any(not s for s in skus) or len(set(skus)) != len(skus):
        raise HTTPException(status_code=400, detail="Every item needs its own SKU (no blanks or duplicates).")
    setup = {
        "companyName": name,
        "followUpHours": min(720, max(1, req.followUpHours)),
        "marginFloorPct": min(90.0, max(0.0, req.marginFloorPct)),
        "items": [
            {"sku": s, "name": i.name.strip()[:80] or s, "unitCost": max(0, i.unitCost), "sellPrice": max(0, i.sellPrice)}
            for s, i in zip(skus, req.items)
        ],
    }
    init_db(force_reset=True, preset="custom")
    conn = get_db()
    apply_onboarding(conn, setup, now_time_str())
    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload(req.role)}
