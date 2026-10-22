"""Responses of the routes that don't return the app state (/api/state and action routes use models/state.py).

The AI routes keep snake_case keys (plain BaseModel): the WebApp and the extension read them that way.
"""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from backend.models.base import ApiModel
from backend.models.requests import OnboardingItem


class AiServerStatus(BaseModel):
    connected: bool
    url: str
    models: List[str]
    error: Optional[str] = None


class HealthResponse(ApiModel):
    status: str
    database: str  # the database type only, never the URL
    ai_provider: str
    lmstudio: AiServerStatus


class ClientMemoryRating(ApiModel):
    customer: str
    phone: str = ""
    tier: str
    score: int
    is_new: bool
    style_summary: str
    payment_behavior: str
    total_orders: int
    total_paid_rm: int
    trust_badge: str = ""  # known customers only
    deposit_requirement: str = ""  # known customers only
    last_message: str = ""  # new customers only
    updated_at: str = ""  # new customers only


class WhatsAppAnalyzeResponse(BaseModel):
    source: str  # lmstudio | deterministic_fallback
    lmstudio_connected: bool
    model_used: Optional[str] = None
    error: Optional[str] = None
    raw_prompt: str
    raw_llm_output: str
    # ponytail: the old copilot's free-form AI output; Phase 3 (docs/11 §4) rewrites analyze and gives it a model.
    analysis: Dict[str, Any]


class AgentAnswer(BaseModel):
    lmstudio_connected: bool
    answer: Optional[str] = None
    model_used: Optional[str] = None
    raw_prompt: Optional[str] = None
    raw_system_prompt: Optional[str] = None
    error: Optional[str] = None


class PriceListItem(OnboardingItem):
    estimated: bool = False  # a price or cost column was missing; the Owner should check it


class PriceListPreview(ApiModel):
    items: List[PriceListItem]
    warnings: List[str]


class AuthConfig(ApiModel):
    url: str  # empty = login off
    anon_key: str
