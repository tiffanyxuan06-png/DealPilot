from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class WhatsAppAnalyzeRequest(BaseModel):
    customer: str
    phone: Optional[str] = ""
    message: str
    userInstruction: Optional[str] = ""
    recentMessages: Optional[List[Dict[str, Any]]] = None
    role: Optional[str] = None  # missing role = Staff (least privilege)
    lastSender: Optional[str] = "Them"
    lastClientMessage: Optional[str] = ""
    lastMyMessage: Optional[str] = ""
    smePreset: Optional[str] = None
    companyName: Optional[str] = None
    stock: Optional[List[Dict[str, Any]]] = None
    framework: Optional[str] = None


class WhatsAppExecuteRequest(BaseModel):  # Phase 3 replaces this with deal actions
    customer: str
    phone: Optional[str] = "+60 12-345 6789"
    actionType: str
    sku: Optional[str] = "ACN-DAI-15"
    qty: Optional[int] = 5
    extraSku: Optional[str] = None
    extraQty: Optional[int] = 0
    amount: Optional[int] = 6650
    receiptRef: Optional[str] = None
    invoiceId: Optional[str] = None
    tin: Optional[str] = None  # SAVE_LHDN_TIN
    ssmBrn: Optional[str] = None
    role: Optional[str] = None  # missing role = Staff (least privilege)


class DealItem(BaseModel):
    sku: str
    qty: int = 1


class DealCreateRequest(BaseModel):
    customer: str
    phone: Optional[str] = ""
    repId: Optional[int] = None  # missing = the rep for this login (see deals.default_rep_id)
    items: List[DealItem]
    discount: int = 0
    quote: bool = True  # False = log an inquiry only (no quote sent yet)
    notes: Optional[str] = ""
    role: Optional[str] = None  # missing role = Staff (least privilege)


class DealActionRequest(BaseModel):
    action: str  # SEND_QUOTE | SEND_FOLLOW_UP | MARK_WON | MARK_LOST | APPLY_DISCOUNT | PAUSE | RESUME | SET_TIN
    discount: Optional[int] = None  # APPLY_DISCOUNT: total discount on the deal (RM)
    depositRef: Optional[str] = ""  # MARK_WON: slip reference the customer gave (information only)
    depositAmount: Optional[int] = None  # MARK_WON: amount the customer says they paid (information only)
    reason: Optional[str] = ""  # MARK_LOST
    note: Optional[str] = ""  # PAUSE / RESUME
    tin: Optional[str] = ""  # SET_TIN
    role: Optional[str] = None


class RepUpsertRequest(BaseModel):
    id: Optional[int] = None  # missing = add a new rep
    name: str
    commissionPct: float = 3.0
    active: bool = True
    role: Optional[str] = None


class ReassignRequest(BaseModel):
    toRepId: int
    role: Optional[str] = None


class ProductUpsertRequest(BaseModel):
    sku: str
    name: str
    sellPrice: int
    unitCost: int
    role: Optional[str] = None


class SettingsUpdateRequest(BaseModel):
    framework: Optional[str] = None
    lmstudioUrl: Optional[str] = None
    lmstudioApiKey: Optional[str] = None
    lmstudioModel: Optional[str] = None
    role: Optional[str] = None


class CompanyAgentAskRequest(BaseModel):
    question: str
    state: Optional[Dict[str, Any]] = None


class RoleRequest(BaseModel):
    role: Optional[str] = None


class PermissionsUpdateRequest(BaseModel):
    role: Optional[str] = None
    staffModes: Optional[Dict[str, str]] = None  # action key -> ALLOW | APPROVAL | DENY
    followUpHours: Optional[int] = None  # how long a quote waits for a reply before a follow-up is due
    marginFloorPct: Optional[float] = None  # Staff need approval below this margin


class OnboardingPreviewRequest(BaseModel):
    role: Optional[str] = None
    fileName: str
    fileBase64: str  # data URL or plain base64


class OnboardingItem(BaseModel):
    sku: str
    name: str
    unitCost: int = 0
    sellPrice: int = 0


class OnboardingApplyRequest(BaseModel):
    role: Optional[str] = None
    companyName: str
    followUpHours: int = 48
    marginFloorPct: float = 15
    items: List[OnboardingItem]


class ProfileSwitchRequest(BaseModel):
    role: Optional[str] = None
    preset: str  # aircond | fnb


class FastForwardRequest(BaseModel):
    role: Optional[str] = None
    hours: int = 48


class ApprovalDecisionRequest(BaseModel):
    role: Optional[str] = None
    decision: str  # APPROVE | REJECT
    note: Optional[str] = ""
