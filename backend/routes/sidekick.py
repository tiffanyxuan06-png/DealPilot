"""FastAPI routes for the WhatsApp Sales Sidekick (Layer B Deterministic Execution)."""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.db import session_scope
from backend.services.sidekick_tools import (
    calculate_quote,
    get_commitments,
    get_conversation_context,
    get_customer_orders,
    match_transaction,
    prepare_order,
    save_commitment,
    search_products,
)

router = APIRouter(prefix="/api/v1/sidekick", tags=["WhatsApp Sales Sidekick"])


class RawItemRequest(BaseModel):
    name: Optional[str] = None
    sku: Optional[str] = None
    qty: int = 1


class SidekickLineItem(BaseModel):
    sku: str = ""
    name: str = ""
    qty: int = 1
    unit_price: int = 0
    line_total: int = 0


class PrepareOrderRequest(BaseModel):
    customer: str
    phone: str = ""
    items: List[RawItemRequest]
    delivery_area: str = ""
    notes: str = ""


class CalculateQuoteRequest(BaseModel):
    items: List[SidekickLineItem]
    discount_pct: float = 0.0
    delivery_fee: float = 0.0


class SaveCommitmentRequest(BaseModel):
    phone: str = ""
    customer: str = ""
    promise_text: str
    due_date: Optional[str] = None
    party: str = "customer"


class MatchTransactionRequest(BaseModel):
    amount: float
    ref_id: str = ""
    phone_or_customer: str = ""


class ProductSearchResult(BaseModel):
    sku: str
    name: str
    sell_price: int
    available_stock: int
    on_hold: int
    ready_stock: bool


class OrderHistoryItem(BaseModel):
    id: str
    order_no: Optional[str] = None
    stage: str
    created_at: str
    amount: int
    items: List[SidekickLineItem] = []


class PrepareOrderResponse(BaseModel):
    customer: str
    phone: str
    items: List[SidekickLineItem] = []
    delivery_area: str = ""
    subtotal: int = 0
    missing_fields: List[str] = []
    ready_to_quote: bool = False
    notes: str = ""


class CalculateQuoteResponse(BaseModel):
    subtotal: int
    discount_pct: float
    discount_rm: int
    delivery_fee: int
    total_payable: int
    deposit_required: int
    terms: str


class CommitmentResponse(BaseModel):
    id: int
    customer: str
    phone: str
    promise_text: str
    due_date: Optional[str] = None
    party: str
    status: str
    created_at: Optional[str] = None


class OpenDealContext(BaseModel):
    id: str
    stage: str
    amount: int
    items: List[SidekickLineItem] = []


class ConversationContextResponse(BaseModel):
    customer: str
    tin: str = ""
    open_deal: Optional[OpenDealContext] = None
    past_orders_count: int = 0
    recent_orders: List[OrderHistoryItem] = []
    pending_commitments: List[CommitmentResponse] = []


class MatchTransactionResponse(BaseModel):
    matched: bool
    match_status: str
    deal_id: Optional[str] = None
    customer: Optional[str] = None
    deal_amount: Optional[int] = None
    claimed_amount: float
    is_duplicate_ref: bool
    audit_note: str


def _clean_line_items(raw_items: List[Any]) -> List[SidekickLineItem]:
    cleaned = []
    for it in raw_items:
        if isinstance(it, dict):
            qty = int(it.get("qty", 1))
            unit_p = int(it.get("unit_price") or it.get("unitPrice", 0))
            tot = int(it.get("line_total", qty * unit_p))
            cleaned.append(
                SidekickLineItem(
                    sku=str(it.get("sku", "")),
                    name=str(it.get("name", "")),
                    qty=qty,
                    unit_price=unit_p,
                    line_total=tot,
                )
            )
        elif isinstance(it, SidekickLineItem):
            cleaned.append(it)
    return cleaned


@router.get("/products", response_model=List[ProductSearchResult])
def api_sidekick_search_products(
    query: str = Query("", description="Keyword or SKU"),
    limit: int = Query(5, ge=1, le=20),
) -> List[Dict[str, Any]]:
    with session_scope() as s:
        return search_products(s, query=query, limit=limit)


@router.get("/orders", response_model=List[OrderHistoryItem])
def api_sidekick_customer_orders(
    customer: str = Query(..., description="Customer name or phone"),
    limit: int = Query(3, ge=1, le=10),
) -> List[OrderHistoryItem]:
    with session_scope() as s:
        orders = get_customer_orders(s, phone_or_name=customer, limit=limit)
        return [
            OrderHistoryItem(
                id=o["id"],
                order_no=o.get("order_no"),
                stage=o["stage"],
                created_at=o["created_at"],
                amount=o["amount"],
                items=_clean_line_items(o.get("items", [])),
            )
            for o in orders
        ]


@router.post("/prepare-order", response_model=PrepareOrderResponse)
def api_sidekick_prepare_order(req: PrepareOrderRequest) -> PrepareOrderResponse:
    with session_scope() as s:
        raw_items = [i.model_dump() for i in req.items]
        res = prepare_order(
            s,
            customer=req.customer,
            phone=req.phone,
            raw_items=raw_items,
            delivery_area=req.delivery_area,
            notes=req.notes,
        )
        return PrepareOrderResponse(
            customer=res["customer"],
            phone=res["phone"],
            items=_clean_line_items(res["items"]),
            delivery_area=res["delivery_area"],
            subtotal=res["subtotal"],
            missing_fields=res["missing_fields"],
            ready_to_quote=res["ready_to_quote"],
            notes=res["notes"],
        )


@router.post("/calculate-quote", response_model=CalculateQuoteResponse)
def api_sidekick_calculate_quote(req: CalculateQuoteRequest) -> Dict[str, Any]:
    with session_scope() as s:
        raw_items = [i.model_dump() for i in req.items]
        return calculate_quote(
            s,
            items=raw_items,
            discount_pct=req.discount_pct,
            delivery_fee=req.delivery_fee,
        )


@router.post("/commitments", response_model=CommitmentResponse)
def api_sidekick_save_commitment(req: SaveCommitmentRequest) -> Dict[str, Any]:
    with session_scope() as s:
        return save_commitment(
            s,
            phone=req.phone,
            customer=req.customer,
            promise_text=req.promise_text,
            due_date=req.due_date,
            party=req.party,
        )


@router.get("/commitments", response_model=List[CommitmentResponse])
def api_sidekick_get_commitments(
    customer: Optional[str] = Query(None, description="Customer or phone"),
    status: str = Query("pending", description="pending | completed | ALL"),
) -> List[Dict[str, Any]]:
    with session_scope() as s:
        return get_commitments(s, phone_or_customer=customer, status=status)


@router.get("/context", response_model=ConversationContextResponse)
def api_sidekick_context(
    customer: str = Query(..., description="Customer name or phone"),
) -> ConversationContextResponse:
    with session_scope() as s:
        ctx = get_conversation_context(s, phone_or_customer=customer)
        open_d = ctx.get("open_deal")
        open_deal_obj = None
        if open_d:
            open_deal_obj = OpenDealContext(
                id=open_d["id"],
                stage=open_d["stage"],
                amount=open_d["amount"],
                items=_clean_line_items(open_d.get("items", [])),
            )
        recent_orders = [
            OrderHistoryItem(
                id=o["id"],
                order_no=o.get("order_no"),
                stage=o["stage"],
                created_at=o["created_at"],
                amount=o["amount"],
                items=_clean_line_items(o.get("items", [])),
            )
            for o in ctx.get("recent_orders", [])
        ]
        pending_comms = [
            CommitmentResponse(
                id=c["id"],
                customer=c["customer"],
                phone=c["phone"],
                promise_text=c["promise_text"],
                due_date=c.get("due_date"),
                party=c["party"],
                status=c["status"],
                created_at=c.get("created_at"),
            )
            for c in ctx.get("pending_commitments", [])
        ]
        return ConversationContextResponse(
            customer=ctx["customer"],
            tin=ctx.get("tin", ""),
            open_deal=open_deal_obj,
            past_orders_count=ctx.get("past_orders_count", 0),
            recent_orders=recent_orders,
            pending_commitments=pending_comms,
        )


@router.post("/match-transaction", response_model=MatchTransactionResponse)
def api_sidekick_match_transaction(req: MatchTransactionRequest) -> Dict[str, Any]:
    with session_scope() as s:
        return match_transaction(
            s,
            amount=req.amount,
            ref_id=req.ref_id,
            phone_or_customer=req.phone_or_customer,
        )
