"""SQLAlchemy models for the tables created by backend/schema/migrations.

These models never create tables (no metadata.create_all): change the schema with a new migration file,
then update the matching model here. test_schema_matches_orm checks the two agree.
"""
import json
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, ForeignKey, Integer, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base for every table model. Tables come from the migrations, never from create_all."""


class Setting(Base):
    """One business setting per row (company name, follow-up hours, margin floor...); read through BusinessSettings."""

    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class Product(Base):
    """The price list. Prices and costs are whole RM; unit_cost is Owner-only and never sent to Staff."""

    __tablename__ = "products"
    sku: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    sell_price: Mapped[int] = mapped_column(Integer)
    unit_cost: Mapped[int] = mapped_column(Integer)
    specs_json: Mapped[str] = mapped_column(Text, default="{}")

    @property
    def specs(self) -> dict:
        try:
            return json.loads(self.specs_json or "{}")
        except Exception:
            return {}


class Rep(Base):
    """A sales rep. commission_pct applies to the deal amount after discount; inactive reps keep their old deals."""

    __tablename__ = "reps"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    commission_pct: Mapped[float] = mapped_column(default=3.0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Deal(Base):
    """One quote from inquiry to won or lost.

    `id` is the quote number (QT-2026-101) and `order_no` the sales order number given when it is won.
    `stage` holds a Stage value; `items_json` is the line list (use the `items` property). `follow_up_at`
    is when the next follow-up is due and `paused` stops the timer after a complaint. `deposit_ref` and
    `deposit_amount` are what the customer says they paid: information only, never checked against a bank.
    Times are local text in clock.TIME_FORMAT, so they sort as strings.
    """

    __tablename__ = "deals"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    order_no: Mapped[Optional[str]] = mapped_column(Text, default=None)
    customer: Mapped[str] = mapped_column(Text)
    phone: Mapped[str] = mapped_column(Text, default="")
    rep_id: Mapped[Optional[int]] = mapped_column(ForeignKey("reps.id"))
    stage: Mapped[str] = mapped_column(Text)
    items_json: Mapped[str] = mapped_column(Text, default="[]")
    discount: Mapped[int] = mapped_column(Integer, default=0)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    follow_up_at: Mapped[Optional[str]] = mapped_column(Text, default=None)
    follow_up_count: Mapped[int] = mapped_column(Integer, default=0)
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    loss_reason: Mapped[str] = mapped_column(Text, default="")
    deposit_ref: Mapped[str] = mapped_column(Text, default="")
    deposit_amount: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(Text)
    won_at: Mapped[Optional[str]] = mapped_column(Text, default=None)

    @property
    def items(self) -> List[Dict[str, Any]]:
        return json.loads(self.items_json or "[]")

    @items.setter
    def items(self, value: List[Dict[str, Any]]) -> None:
        self.items_json = json.dumps(value)


class AuditLog(Base):
    """The activity log. Append-only: database triggers reject UPDATE and DELETE."""

    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(Text)


class ClientMemory(Base):
    """What the AI remembers about a customer: tier code, trust score (0-100), chat style and payment habits.

    `recent_history_json` keeps the last messages and `cached_analysis_json` the last AI reply for them.
    """

    __tablename__ = "client_memories"
    customer: Mapped[str] = mapped_column(Text, primary_key=True)
    phone: Mapped[str] = mapped_column(Text, default="")
    tier: Mapped[str] = mapped_column(Text, default="NEW_CLIENT")
    score: Mapped[int] = mapped_column(Integer, default=50)
    style_summary: Mapped[str] = mapped_column(Text, default="")
    payment_behavior: Mapped[str] = mapped_column(Text, default="")
    total_orders: Mapped[int] = mapped_column(Integer, default=0)
    total_paid_rm: Mapped[int] = mapped_column(Integer, default=0)
    last_message: Mapped[str] = mapped_column(Text, default="")
    recent_history_json: Mapped[str] = mapped_column(Text, default="[]")
    cached_analysis_json: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[str] = mapped_column(Text)
    last_customer_at: Mapped[str] = mapped_column(Text, default="")  # full timestamp of the customer's last message


class Customer(Base):
    """A customer's LHDN e-Invoice details. `name` is the clean name deals are matched on (tags stripped).

    `rep_id` is who looks after them until their first deal; after that the rep on their newest deal counts.
    """

    __tablename__ = "customers"
    name: Mapped[str] = mapped_column(Text, primary_key=True)
    phone: Mapped[str] = mapped_column(Text, default="")
    tin: Mapped[str] = mapped_column(Text, default="")
    ssm_brn: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[str] = mapped_column(Text)
    rep_id: Mapped[Optional[int]] = mapped_column(ForeignKey("reps.id"))


class RolePermission(Base):
    """The Owner's choice for one Staff action: ALLOW, APPROVAL or DENY. Missing rows use the default."""

    __tablename__ = "role_permissions"
    action_key: Mapped[str] = mapped_column(Text, primary_key=True)
    staff_mode: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text)
    updated_by: Mapped[str] = mapped_column(Text)


class ApprovalRequest(Base):
    """A Staff action waiting for the Owner.

    `handler` names the registered function that replays the action with `payload_json` once approved.
    `status` is PENDING, APPROVED or REJECTED.
    """

    __tablename__ = "approval_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    action_key: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    handler: Mapped[str] = mapped_column(Text)
    payload_json: Mapped[str] = mapped_column(Text)
    requested_by: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="PENDING")
    decided_by: Mapped[Optional[str]] = mapped_column(Text, default=None)
    decision_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(Text)
    decided_at: Mapped[Optional[str]] = mapped_column(Text, default=None)

class Commitment(Base):
    """Customer or rep promise tracked by the WhatsApp Sales Sidekick."""

    __tablename__ = "commitments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    phone: Mapped[str] = mapped_column(Text, default="")
    customer: Mapped[str] = mapped_column(Text, default="")
    promise_text: Mapped[str] = mapped_column(Text)
    due_date: Mapped[Optional[str]] = mapped_column(Text, default=None)
    party: Mapped[str] = mapped_column(Text, default="customer")
    status: Mapped[str] = mapped_column(Text, default="pending")
    created_at: Mapped[str] = mapped_column(Text)

