from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class WhatsAppAnalyzeRequest(BaseModel):
    customer: str
    phone: Optional[str] = ""
    message: str
    userInstruction: Optional[str] = ""
    recentMessages: Optional[List[Dict[str, Any]]] = None
    role: Optional[str] = "OWNER"
    lastSender: Optional[str] = "Them"
    lastClientMessage: Optional[str] = ""
    lastMyMessage: Optional[str] = ""
    smePreset: Optional[str] = None
    companyName: Optional[str] = None
    stock: Optional[List[Dict[str, Any]]] = None
    framework: Optional[str] = None


class WhatsAppExecuteRequest(BaseModel):
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
    role: Optional[str] = "OWNER"


class WalkInOrderRequest(BaseModel):
    customerName: str
    buyerTin: Optional[str] = ""
    sku: str
    qty: int = 1
    mode: str = "PAID_NOW"  # PAID_NOW or QUOTE_HOLD


class VerifyReceiptRequest(BaseModel):
    decision: str  # FULL, PARTIAL, CONFIRM, REJECT
    paidAmount: Optional[int] = None  # amount actually seen in the bank; defaults to the claimed amount
    role: Optional[str] = "OWNER"


class InvoiceActionRequest(BaseModel):
    action: str
    tin: Optional[str] = ""
    amount: Optional[int] = None  # DISCOUNT rebate, ATTACH_RECEIPT claimed amount
    ref: Optional[str] = ""  # ATTACH_RECEIPT reference
    sku: Optional[str] = None  # REPLACE_ONE / ADD_PIPE_LABOR item
    role: Optional[str] = "OWNER"


class SettingsUpdateRequest(BaseModel):
    framework: Optional[str] = None
    lmstudioUrl: Optional[str] = None
    lmstudioApiKey: Optional[str] = None
    lmstudioModel: Optional[str] = None


class AddStockRequest(BaseModel):
    sku: str
    name: str
    qty: int = 1
    unitCost: int = 100
    sellPrice: int = 150
    payWithCash: bool = True  # False = opening stock / already paid, no cash change
    role: Optional[str] = "OWNER"


class BillApplyRequest(BaseModel):
    kind: str  # supplier | expense | customer
    party: str
    ref: Optional[str] = ""
    amount: int
    qty: int = 1
    sku: Optional[str] = None  # supplier bill: existing SKU
    newSkuName: Optional[str] = None  # supplier bill: create this SKU if `sku` does not exist
    newSellPrice: Optional[int] = None
    invoiceId: Optional[str] = None  # customer receipt: invoice to attach to
    role: Optional[str] = "OWNER"


class OcrExtractRequest(BaseModel):
    fileName: str
    imageBase64: Optional[str] = None
    customer: Optional[str] = None
    extractedText: Optional[str] = None


class ReceiptSaveRequest(BaseModel):
    invoiceId: Optional[str] = ""
    customer: str
    fileName: str
    fileType: Optional[str] = "pdf"
    ref: Optional[str] = ""
    amount: Optional[int] = 0
    imageBase64: Optional[str] = ""
    ocrSummary: Optional[str] = ""


class CompanyAgentAskRequest(BaseModel):
    question: str
    state: Optional[Dict[str, Any]] = None
