"""SQLAlchemy models for the tables created by backend/schema/migrations.

These models never create tables (no metadata.create_all): change the schema with a new migration file,
then update the matching model here. test_schema_matches_orm checks the two agree.
"""
import json
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, ForeignKey, Integer, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class Product(Base):
    __tablename__ = "products"
    sku: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    sell_price: Mapped[int] = mapped_column(Integer)
    unit_cost: Mapped[int] = mapped_column(Integer)


class Rep(Base):
    __tablename__ = "reps"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    commission_pct: Mapped[float] = mapped_column(default=3.0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Deal(Base):
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
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(Text)


class ClientMemory(Base):
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


class Customer(Base):
    __tablename__ = "customers"
    name: Mapped[str] = mapped_column(Text, primary_key=True)
    phone: Mapped[str] = mapped_column(Text, default="")
    tin: Mapped[str] = mapped_column(Text, default="")
    ssm_brn: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[str] = mapped_column(Text)


class RolePermission(Base):
    __tablename__ = "role_permissions"
    action_key: Mapped[str] = mapped_column(Text, primary_key=True)
    staff_mode: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text)
    updated_by: Mapped[str] = mapped_column(Text)


class ApprovalRequest(Base):
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
