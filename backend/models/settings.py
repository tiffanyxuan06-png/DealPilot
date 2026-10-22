"""Typed view of the `settings` table (business settings the Owner changes in the app).

Defaults come from backend/schema/seeds/defaults.json; environment settings live in backend/config.py.
"""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class BusinessSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    company_name: str = ""
    ssm: str = ""
    tin: str = ""
    sme_preset: str = "custom"
    framework: str = ""
    follow_up_hours: int = Field(ge=1, le=720)
    margin_floor_pct: float = Field(ge=0, le=90)
    # The Owner can point the app at another LM Studio from Settings; empty = use .env (backend/config.py).
    lmstudio_url: Optional[str] = None
    lmstudio_api_key: Optional[str] = None
    lmstudio_model: Optional[str] = None
    onboarding_json: str = ""  # the 60-second setup, so a reset rebuilds that business
