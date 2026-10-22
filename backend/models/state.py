"""The /api/state response and the envelope every action route returns."""
from typing import Dict, List, Optional

from backend.models.base import ApiModel
from backend.models.entities import Approval, ClientMemory, Customer, Deal, Permissions, Product, Rep


class Company(ApiModel):
    name: str
    preset: str
    framework: str
    follow_up_hours: int
    margin_floor_pct: float
    ai_provider: str
    lmstudio_url: str
    lmstudio_api_key: str  # empty when RunPod is used: its key stays on the server
    lmstudio_model: str


class StageTotals(ApiModel):
    count: int
    value_rm: int


class Pipeline(ApiModel):
    value_rm: int  # quoted but not yet won or lost
    by_stage: Dict[str, StageTotals]
    win_rate: float
    overdue: int


class StatePayload(ApiModel):
    company: Company
    products: List[Product]
    reps: List[Rep]
    deals: List[Deal]
    pipeline: Pipeline
    customers: List[Customer]
    client_memories: Dict[str, ClientMemory]
    permissions: Permissions
    approvals: List[Approval]
    logs: List[str]


class ActionResponse(ApiModel):
    """status: ok | pending_approval | updated | reset_complete. Extra fields only for some routes."""

    status: str
    state: StatePayload
    created_id: Optional[str] = None
    moved: Optional[List[str]] = None
    approval_id: Optional[int] = None
    reason: Optional[str] = None
    message: Optional[str] = None
