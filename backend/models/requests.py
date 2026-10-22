"""Request bodies. JSON uses camelCase (e.g. repId); Python uses snake_case. Simple checks live here, not in routes."""
from typing import Any, Dict, List, Optional

from pydantic import Field, field_validator

from backend.models.base import ApiModel
from backend.models.enums import DealAction


class RoleRequest(ApiModel):
    role: Optional[str] = None  # missing role = Staff (least privilege); with login on, the signed-in role wins


class WhatsAppAnalyzeRequest(RoleRequest):
    customer: str
    phone: Optional[str] = ""
    message: str
    user_instruction: Optional[str] = ""
    recent_messages: Optional[List[Dict[str, Any]]] = None
    last_sender: Optional[str] = "Them"
    last_client_message: Optional[str] = ""
    last_my_message: Optional[str] = ""
    sme_preset: Optional[str] = None
    company_name: Optional[str] = None
    framework: Optional[str] = None


class WhatsAppExecuteRequest(RoleRequest):  # Phase 3 replaces the action list with deal actions
    customer: str
    phone: Optional[str] = ""
    action_type: str
    tin: Optional[str] = None  # SAVE_LHDN_TIN
    ssm_brn: Optional[str] = None


class DealItemRequest(ApiModel):
    sku: str = Field(min_length=1)
    qty: int = Field(1, ge=1)


class DealCreateRequest(RoleRequest):
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
    id: Optional[int] = None  # missing = add a new rep
    name: str = Field(min_length=1)
    commission_pct: float = Field(3.0, ge=0, le=50)
    active: bool = True


class ReassignRequest(RoleRequest):
    to_rep_id: int


class ProductUpsertRequest(RoleRequest):
    sku: str = Field(min_length=1)
    name: str = Field(min_length=1)
    sell_price: int = Field(ge=1)
    unit_cost: int = Field(ge=0)


class SettingsUpdateRequest(RoleRequest):
    framework: Optional[str] = None
    lmstudio_url: Optional[str] = None
    lmstudio_api_key: Optional[str] = None
    lmstudio_model: Optional[str] = None


class CompanyAgentAskRequest(ApiModel):
    question: str


class PermissionsUpdateRequest(RoleRequest):
    staff_modes: Optional[Dict[str, str]] = None  # action key -> ALLOW | APPROVAL | DENY
    follow_up_hours: Optional[int] = Field(None, ge=1, le=720)
    margin_floor_pct: Optional[float] = Field(None, ge=0, le=90)


class OnboardingPreviewRequest(RoleRequest):
    file_name: str
    file_base64: str  # data URL or plain base64


class OnboardingItem(ApiModel):
    sku: str
    name: str
    unit_cost: int = Field(0, ge=0)
    sell_price: int = Field(0, ge=0)


class OnboardingApplyRequest(RoleRequest):
    company_name: str
    follow_up_hours: Optional[int] = Field(None, ge=1, le=720)  # missing = defaults.json
    margin_floor_pct: Optional[float] = Field(None, ge=0, le=90)
    items: List[OnboardingItem]


class ProfileSwitchRequest(RoleRequest):
    preset: str  # a file name in backend/schema/seeds, e.g. aircond | fnb


class FastForwardRequest(RoleRequest):
    hours: int = Field(48, ge=1, le=240)


class ApprovalDecisionRequest(RoleRequest):
    decision: str  # APPROVE | REJECT
    note: Optional[str] = ""
