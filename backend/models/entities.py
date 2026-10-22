"""What the API returns for each record. Built from the SQLAlchemy rows in backend/db/orm.py."""
from typing import Dict, List, Optional

from pydantic import Field

from backend.models.base import ApiModel
from backend.models.enums import PermissionMode, Stage


def _owner_only():
    """A field only the Owner receives: build_state sets it to None for Staff, and None is left out of the JSON."""
    return Field(None, exclude_if=lambda v: v is None)


class Product(ApiModel):
    """A price list line. `unit_cost` is left out of the JSON for Staff."""

    sku: str
    name: str
    sell_price: int
    unit_cost: Optional[int] = _owner_only()


class Rep(ApiModel):
    """A rep with this month's leaderboard numbers (active reps only)."""

    id: int
    name: str
    commission_pct: float
    won_rm: int = 0  # deals won this calendar month
    commission_rm: int = 0  # estimated; the Owner decides actual pay
    open_deals: int = 0
    overdue: int = 0
    potential_rm: int = 0  # commission if the rep's open quotes all close
    rank: int = 0  # 1-based by won_rm this month; ties share a rank


class DealItem(ApiModel):
    """One line on a quote, priced from the price list when the quote was made."""

    sku: str
    name: str
    qty: int
    unit_price: int


class Deal(ApiModel):
    """A deal with the live follow-up countdown and dashboard flags. `margin_pct` is Owner-only."""

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
    margin_pct: Optional[float] = _owner_only()
    at_risk: bool = False  # open quote that is paused, due to be dropped, or a big deal in follow-up


class Customer(ApiModel):
    """A customer on the Customers page: LHDN status, open deals and the ready-made TIN request."""

    name: str
    phone: str = ""
    tin: str = ""
    ssm_brn: str = ""
    lhdn_ready: bool = False
    open_records: int = 0
    tin_request_text: str = ""
    rep_id: Optional[int] = None  # rep on the customer's latest deal


class ClientMemory(ApiModel):
    """What the AI remembers about a customer (the history and cached reply stay on the server)."""

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
    """A Staff request in the Owner's approval queue."""

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
    """One Staff action on the Permissions page: its current mode, default and allowed modes."""

    key: str
    label: str
    group: str
    mode: PermissionMode
    default: PermissionMode
    modes: List[PermissionMode]
    note: str = ""


class Permissions(ApiModel):
    """The Permissions page: Staff action modes, Owner-only actions and the rules no one can turn off."""

    follow_up_hours: int
    margin_floor_pct: float
    mode_labels: Dict[str, str]
    actions: List[PermissionAction]
    owner_only: List[str]
    mandatory_rules: List[str]
