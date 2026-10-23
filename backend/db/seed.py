import json
"""Loads the demo businesses in backend/schema/seeds/*.json into an empty database.

Every file is validated by the Pydantic models below, so a typo fails with a clear message
instead of a half-seeded database. Times are relative to now, so follow-ups are live after every reset.
"""
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from backend.db import orm
from backend.models.enums import Stage
from backend.services.clock import TIME_FORMAT, now_time_str

SEEDS_DIR = Path(__file__).resolve().parent.parent / "schema" / "seeds"
DEFAULTS_FILE = "defaults"
DEFAULT_PRESET = "aircond"
CUSTOM_PRESET = "custom"  # a business from the 60-second setup (services/onboarding.py fills it in)

SettingValue = Union[str, int, float]


class SeedProduct(BaseModel):
    sku: str
    name: str
    sell_price: int = Field(ge=1)
    unit_cost: int = Field(ge=0)
    specs: Dict[str, Any] = Field(default_factory=dict)


class SeedRep(BaseModel):
    name: str
    commission_pct: float = Field(ge=0, le=50)


class SeedCustomer(BaseModel):
    name: str
    phone: str = ""
    tin: str = ""


class SeedItem(BaseModel):
    sku: str
    qty: int = Field(ge=1)


class SeedDeal(BaseModel):
    id: str
    customer: str
    rep: str
    stage: Stage
    items: List[SeedItem] = Field(min_length=1)
    discount: int = Field(0, ge=0)
    created_hours_ago: float = Field(ge=0)
    follow_up_in_hours: Optional[float] = None  # negative = already overdue
    follow_ups: int = Field(0, ge=0)
    paused: bool = False
    loss_reason: str = ""
    deposit_ref: str = ""
    deposit_amount: Optional[int] = Field(None, ge=0)
    won_hours_ago: Optional[float] = Field(None, ge=0)
    notes: str = ""

    @model_validator(mode="after")
    def _stage_fields(self) -> "SeedDeal":
        if self.stage == Stage.WON and self.won_hours_ago is None:
            raise ValueError(f"{self.id}: a WON deal needs won_hours_ago")
        if self.stage == Stage.LOST and not self.loss_reason:
            raise ValueError(f"{self.id}: a LOST deal needs loss_reason")
        return self


class SeedMemory(BaseModel):
    customer: str
    phone: str = ""
    tier: str
    score: int = Field(ge=0, le=100)
    style_summary: str
    payment_behavior: str
    total_orders: int = 0
    total_paid_rm: int = 0
    last_message: str = ""
    last_message_hours_ago: Optional[float] = Field(None, ge=0)  # when the customer sent last_message


class SeedFile(BaseModel):
    settings: Dict[str, SettingValue]
    products: List[SeedProduct]
    reps: List[SeedRep]
    customers: List[SeedCustomer]
    deals: List[SeedDeal]
    memories: List[SeedMemory] = []
    logs: List[str] = []

    @model_validator(mode="after")
    def _references(self) -> "SeedFile":
        if "company_name" not in self.settings:
            raise ValueError("settings.company_name is required")
        skus = {p.sku for p in self.products}
        reps = {r.name for r in self.reps}
        for d in self.deals:
            if d.rep not in reps:
                raise ValueError(f"{d.id}: unknown rep '{d.rep}'")
            missing = [i.sku for i in d.items if i.sku not in skus]
            if missing:
                raise ValueError(f"{d.id}: SKU not on the price list: {', '.join(missing)}")
        return self


class PricingRulePreset(BaseModel):
    """A starting point for "Rules the AI follows" in Settings → Pricing & AI rules."""

    label: str
    hint: str
    text: str


class DefaultsFile(BaseModel):
    settings: Dict[str, SettingValue]
    new_business_reps: List[SeedRep]
    pricing_rule_presets: Dict[str, PricingRulePreset] = {}


def _read(name: str, model: type) -> Any:
    path = SEEDS_DIR / f"{name}.json"
    return model.model_validate_json(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)  # read on every request via load_business; edits to defaults.json need a restart
def load_defaults() -> DefaultsFile:
    return _read(DEFAULTS_FILE, DefaultsFile)


def load_seed(name: str) -> SeedFile:
    return _read(name, SeedFile)


def available_presets() -> Dict[str, str]:
    """Demo businesses by file name -> company name (every seeds/*.json except defaults.json)."""
    return {p.stem: str(load_seed(p.stem).settings["company_name"]) for p in sorted(SEEDS_DIR.glob("*.json")) if p.stem != DEFAULTS_FILE}


def write_settings(session: Session, values: Dict[str, SettingValue]) -> None:
    for key, value in values.items():
        session.merge(orm.Setting(key=key, value=str(value)))


def seed_business(session: Session, preset: str) -> None:
    write_settings(session, {**load_defaults().settings, "sme_preset": preset})
    if preset == CUSTOM_PRESET:
        return
    seed = load_seed(preset)
    now = datetime.now()
    at = lambda hours: (now + timedelta(hours=hours)).strftime(TIME_FORMAT)  # noqa: E731
    ts = now_time_str()

    write_settings(session, seed.settings)
    session.add_all(
        orm.Product(
            sku=p.sku,
            name=p.name,
            sell_price=p.sell_price,
            unit_cost=p.unit_cost,
            specs_json=json.dumps(p.specs or {}),
        )
        for p in seed.products
    )
    reps = {r.name: orm.Rep(name=r.name, commission_pct=r.commission_pct) for r in seed.reps}
    session.add_all(reps.values())
    session.flush()  # gives the reps their ids

    products = {p.sku: p for p in seed.products}
    phones = {c.name: c.phone for c in seed.customers}
    for d in seed.deals:
        # Amounts are priced here from the price list, never stored in the seed.
        items = [{"sku": i.sku, "name": products[i.sku].name, "qty": i.qty, "unitPrice": products[i.sku].sell_price} for i in d.items]
        won = d.stage == Stage.WON
        deal = orm.Deal(
            id=d.id,
            order_no=d.id.replace("QT-", "SO-", 1) if won else None,
            customer=d.customer,
            phone=phones.get(d.customer, ""),
            rep_id=reps[d.rep].id,
            stage=d.stage.value,
            discount=d.discount,
            amount=sum(i["qty"] * i["unitPrice"] for i in items) - d.discount,
            follow_up_at=at(d.follow_up_in_hours) if d.follow_up_in_hours is not None else None,
            follow_up_count=d.follow_ups,
            paused=d.paused,
            loss_reason=d.loss_reason,
            deposit_ref=d.deposit_ref,
            deposit_amount=d.deposit_amount,
            notes=d.notes,
            created_at=at(-d.created_hours_ago),
            won_at=at(-d.won_hours_ago) if won else None,
        )
        deal.items = items
        session.add(deal)

    session.add_all(orm.Customer(name=c.name, phone=c.phone, tin=c.tin, ssm_brn="", updated_at=ts) for c in seed.customers)
    session.add_all(
        orm.ClientMemory(
            **m.model_dump(exclude={"last_message_hours_ago"}),
            recent_history_json="[]",
            cached_analysis_json="",
            updated_at=ts,
            last_customer_at=at(-m.last_message_hours_ago) if m.last_message_hours_ago is not None else "",
        )
        for m in seed.memories
    )
    session.add_all(orm.AuditLog(entry=e, created_at=ts) for e in seed.logs)
