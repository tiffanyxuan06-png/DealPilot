"""What the API returns for each record. Built from the SQLAlchemy rows in backend/db/orm.py."""
from typing import Dict, List, Optional

from pydantic import SerializerFunctionWrapHandler, model_serializer

from backend.models.base import ApiModel
from backend.models.enums import PermissionMode, Stage


def _drop_owner_only(data: dict, *fields: str) -> dict:
    # Owner-only fields are None for Staff and then left out of the JSON entirely.
    for f in fields:
        if data.get(f) is None:
            data.pop(f, None)
    return data


class Product(ApiModel):
    sku: str
    name: str
    sell_price: int
    unit_cost: Optional[int] = None  # Owner only

    @model_serializer(mode="wrap")
    def _ser(self, handler: SerializerFunctionWrapHandler) -> dict:
        return _drop_owner_only(handler(self), "unitCost", "unit_cost")


class Rep(ApiModel):
    id: int
    name: str
    commission_pct: float
    won_rm: int = 0  # deals won this calendar month
    commission_rm: int = 0  # estimated; the Owner decides actual pay
    open_deals: int = 0
    overdue: int = 0


class DealItem(ApiModel):
    sku: str
    name: str
    qty: int
    unit_price: int


class Deal(ApiModel):
    id: str
    order_no: Optional[str] = None
    customer: str
    phone: str = ""
    rep_id: Optional[int] = None
    stage: Stage
    items: List[DealItem]
    discount: int = 0
    amount: int = 0
    follow_up_at: Optional[str] = None
    follow_up_text: str = ""
    follow_up_count: int = 0
    suggest_lost: bool = False  # after 3 unanswered follow-ups; a person always decides
    paused: bool = False
    loss_reason: str = ""
    deposit_ref: str = ""
    deposit_amount: Optional[int] = None
    notes: str = ""
    created_at: str
    won_at: Optional[str] = None
    margin_ok: bool = True
    margin_pct: Optional[float] = None  # Owner only

    @model_serializer(mode="wrap")
    def _ser(self, handler: SerializerFunctionWrapHandler) -> dict:
        return _drop_owner_only(handler(self), "marginPct", "margin_pct")


class Customer(ApiModel):
    name: str
    phone: str = ""
    tin: str = ""
    ssm_brn: str = ""
    lhdn_ready: bool = False
    open_records: int = 0
    tin_request_text: str = ""


class ClientMemory(ApiModel):
    customer: str
    phone: str = ""
    tier: str
    score: int
    style_summary: str
    payment_behavior: str
    total_orders: int
    total_paid_rm: int
    last_message: str = ""
    updated_at: str


class Approval(ApiModel):
    id: int
    action_key: str
    summary: str
    reason: str
    requested_by: str
    status: str
    decided_by: Optional[str] = None
    decision_note: str = ""
    created_at: str
    decided_at: Optional[str] = None


class PermissionAction(ApiModel):
    key: str
    label: str
    group: str
    mode: PermissionMode
    default: PermissionMode
    modes: List[PermissionMode]
    note: str = ""


class Permissions(ApiModel):
    follow_up_hours: int
    margin_floor_pct: float
    mode_labels: Dict[str, str]
    actions: List[PermissionAction]
    owner_only: List[str]
    mandatory_rules: List[str]
