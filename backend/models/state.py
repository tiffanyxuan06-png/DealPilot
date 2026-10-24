"""The /api/state response and the envelope every action route returns."""
from typing import Dict, List, Optional

from pydantic import Field

from backend.models.base import ApiModel
from backend.models.entities import Approval, ClientMemory, Customer, Deal, Permissions, Product, ReengageAlert, Rep


class Company(ApiModel):
    """Business settings and the active AI server."""

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
    """Deal count and value (RM) for one stage."""

    count: int
    value_rm: int


class Pipeline(ApiModel):
    """Pipeline totals for the dashboard. `win_rate` is won / (won + lost), all time."""

    value_rm: int  # quoted but not yet won or lost
    by_stage: Dict[str, StageTotals]
    win_rate: float
    overdue: int
    loss_reasons: Dict[str, int]  # lost deals per reason, all time


class StatePayload(ApiModel):
    """Everything the WebApp and extension show, from GET /api/state. Built by pipeline.build_state."""

    company: Company
    products: List[Product]
    reps: List[Rep]
    deals: List[Deal]
    pipeline: Pipeline
    customers: List[Customer]
    client_memories: Dict[str, ClientMemory]
    permissions: Permissions
    approvals: List[Approval]
    logs: List[str]  # Owner only; empty for Staff
    team_size: int = 0  # active reps, so Staff can read their rank as "1st of 3"
    my_rep_id: Optional[int] = None  # the rep this Staff login is; None for the Owner
    reengage: List[ReengageAlert] = []  # Staff only: their customers who were ready to buy and went quiet


def _only_when_set():
    """An optional field that is left out of the JSON unless the route fills it in."""
    return Field(None, exclude_if=lambda v: v is None)


class ActionResponse(ApiModel):
    """status: ok | pending_approval | updated | reset_complete. Extra fields only for some routes."""

    status: str
    state: StatePayload
    created_id: Optional[str] = _only_when_set()
    created_deal_id: Optional[str] = _only_when_set()
    moved: Optional[List[str]] = _only_when_set()
    approval_id: Optional[int] = _only_when_set()
    reason: Optional[str] = _only_when_set()
    message: Optional[str] = _only_when_set()
    updated: Optional[List[str]] = _only_when_set()  # WhatsApp TIN: the open deals it now covers
