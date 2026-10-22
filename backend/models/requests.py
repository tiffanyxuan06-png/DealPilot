"""Request bodies. JSON uses camelCase (e.g. repId); Python uses snake_case. Simple checks live here, not in routes."""
from typing import Any, Dict, List, Optional

from pydantic import Field, field_validator

from backend.models.base import ApiModel
from backend.models.enums import DealAction


class RoleRequest(ApiModel):
    """Base for requests that say who is acting."""

    role: Optional[str] = None  # missing role = Staff (least privilege); with login on, the signed-in role wins


class ChatMessage(ApiModel):
    """One WhatsApp message read from the chat by the extension."""

    sender: str = "Them"
    text: str = ""
    is_me: Optional[bool] = None  # sent by the extension


class WhatsAppAnalyzeRequest(RoleRequest):
    """The open WhatsApp chat, sent for the AI to suggest a reply."""

    customer: str
    phone: Optional[str] = ""
    message: str
    user_instruction: Optional[str] = ""
    recent_messages: Optional[List[ChatMessage]] = None
    last_sender: Optional[str] = "Them"
    last_client_message: Optional[str] = ""
    last_my_message: Optional[str] = ""
    sme_preset: Optional[str] = None
    company_name: Optional[str] = None
    framework: Optional[str] = None
    strict_ai: Optional[bool] = None
    goal: Optional[str] = None
    stage: Optional[str] = None


class DealItemRequest(ApiModel):
    """A SKU and quantity; the price comes from the price list, never the client."""

    sku: str = Field(min_length=1)
    qty: int = Field(1, ge=1)


class WhatsAppExecuteRequest(RoleRequest):
    customer: str
    phone: Optional[str] = ""
    action_type: str
    deal_id: Optional[str] = None
    items: Optional[List[DealItemRequest]] = None
    sku: Optional[str] = None
    qty: Optional[int] = 1
    discount: Optional[int] = 0
    deposit_ref: Optional[str] = ""
    deposit_amount: Optional[int] = None
    reason: Optional[str] = ""
    note: Optional[str] = ""
    tin: Optional[str] = None
    ssm_brn: Optional[str] = None


class PhotoQuoteRequest(RoleRequest):
    customer: str
    phone: Optional[str] = ""
    image_base64: str
    file_name: Optional[str] = "photo.jpg"


class CustomerCreateRequest(RoleRequest):
    name: str
    phone: Optional[str] = ""


class DealCreateRequest(RoleRequest):
    """A new quote, or an inquiry with `quote` False."""

    customer: str
    phone: Optional[str] = ""
    rep_id: Optional[int] = None  # missing = the rep for this login (see routes/deals.default_rep_id)
    items: List[DealItemRequest] = Field(min_length=1)
    discount: int = Field(0, ge=0)
    quote: bool = True  # False = log an inquiry only (no quote sent yet)
    notes: Optional[str] = ""

    @field_validator("customer")
    @classmethod
    def _customer_named(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Enter the customer's name.")
        return v


class DealActionRequest(RoleRequest):
    """One DealAction. Only the fields for that action are read."""

    action: DealAction
    discount: Optional[int] = Field(None, ge=0)  # APPLY_DISCOUNT: total discount on the deal (RM)
    deposit_ref: Optional[str] = ""  # MARK_WON: slip reference the customer gave (information only)
    deposit_amount: Optional[int] = Field(None, ge=0)  # MARK_WON: amount the customer says they paid (information only)
    reason: Optional[str] = ""  # MARK_LOST
    note: Optional[str] = ""  # PAUSE / RESUME
    tin: Optional[str] = ""  # SET_TIN

    @field_validator("action", mode="before")
    @classmethod
    def _upper(cls, v: Any) -> Any:
        return v.upper() if isinstance(v, str) else v


class RepUpsertRequest(RoleRequest):
    """Add a rep (no id) or change one."""

    id: Optional[int] = None  # missing = add a new rep
    name: str = Field(min_length=1)
    commission_pct: float = Field(3.0, ge=0, le=50)
    active: bool = True


class ReassignRequest(RoleRequest):
    """Move a rep's open deals to another rep."""

    to_rep_id: int


class ProductUpsertRequest(RoleRequest):
    """Add or change a price list line (matched by SKU)."""

    sku: str = Field(min_length=1)
    name: str = Field(min_length=1)
    sell_price: int = Field(ge=1)
    unit_cost: int = Field(ge=0)


class SettingsUpdateRequest(RoleRequest):
    """Owner settings; fields left out are unchanged."""

    framework: Optional[str] = None
    lmstudio_url: Optional[str] = None
    lmstudio_api_key: Optional[str] = None
    lmstudio_model: Optional[str] = None


class CompanyAgentAskRequest(ApiModel):
    """A question for the company agent about the business data."""

    question: str


class PermissionsUpdateRequest(RoleRequest):
    """Owner changes to Staff modes, the follow-up timer or the margin floor."""

    staff_modes: Optional[Dict[str, str]] = None  # action key -> ALLOW | APPROVAL | DENY
    follow_up_hours: Optional[int] = Field(None, ge=1, le=720)
    margin_floor_pct: Optional[float] = Field(None, ge=0, le=90)


class OnboardingPreviewRequest(RoleRequest):
    """A price list file (Excel or CSV) to read before setup."""

    file_name: str
    file_base64: str  # data URL or plain base64


class OnboardingItem(ApiModel):
    """One price list line from the setup file."""

    sku: str
    name: str
    unit_cost: int = Field(0, ge=0)
    sell_price: int = Field(0, ge=0)


class OnboardingApplyRequest(RoleRequest):
    """The 60-second setup: company name, timers and the checked price list."""

    company_name: str
    follow_up_hours: Optional[int] = Field(None, ge=1, le=720)  # missing = defaults.json
    margin_floor_pct: Optional[float] = Field(None, ge=0, le=90)
    items: List[OnboardingItem]


class ProfileSwitchRequest(RoleRequest):
    """Load a demo business from the seeds."""

    preset: str  # a file name in backend/schema/seeds, e.g. aircond | fnb


class FastForwardRequest(RoleRequest):
    """Demo only: bring every follow-up due time this many hours earlier, as if the time had passed."""

    hours: int = Field(48, ge=1, le=240)


class ApprovalDecisionRequest(RoleRequest):
    """The Owner's answer to a pending approval."""

    decision: str  # APPROVE | REJECT
    note: Optional[str] = ""
