"""Customer records with LHDN e-Invoice details (Buyer TIN, SSM BRN).

Deals store the customer name as text; customers are matched by their clean name
(e.g. "Tan Bros Trading (Phone Order)" -> "Tan Bros Trading"). The TIN goes to the accountant in the CSV.
"""
import re
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.db import orm
from backend.models import entities
from backend.models.enums import OPEN_STAGES
from backend.services.memory import clean_customer_name

# Malaysian LHDN TIN: letter prefix (C, IG, SG, OG, D, E, F, ...) + 8-12 digits, e.g. C2588190021, IG115002000.
TIN_RE = re.compile(r"\b((?:C|CS|D|E|F|FA|PT|TA|TC|TN|TR|TP|J|LE|IG|SG|OG)\s?\d{8,12})\b", re.I)
# SSM BRN (new 12-digit format), e.g. 202401009921.
SSM_RE = re.compile(r"\b((?:19|20)\d{2}0[1-6]\d{6})\b")

MISSING_TIN = "🟡 Missing TIN"


def customer_key(name: str) -> str:
    if not (name or "").strip():
        return ""
    return clean_customer_name(name).strip()


def parse_tin(text: str) -> Optional[str]:
    m = TIN_RE.search(text or "")
    return m.group(1).replace(" ", "").upper() if m else None


def parse_ssm(text: str) -> Optional[str]:
    m = SSM_RE.search(text or "")
    return m.group(1) if m else None


def is_customer(session: Session, name: str, phone: str = "") -> bool:
    """Checks if either clean_customer_name(name) or the digits of phone match an existing row in customers."""
    key = customer_key(name).lower()
    if key:
        row = session.scalars(select(orm.Customer).where(func.lower(orm.Customer.name) == key)).first()
        if row is not None:
            return True
    clean_digits = re.sub(r"\D", "", phone or "")
    if clean_digits and len(clean_digits) >= 7:
        rows = session.scalars(select(orm.Customer.phone).where(orm.Customer.phone != "")).all()
        for p in rows:
            p_digits = re.sub(r"\D", "", p)
            if p_digits and (clean_digits in p_digits or p_digits in clean_digits):
                return True
    return False


def get_customer(session: Session, name: str) -> Optional[orm.Customer]:
    key = customer_key(name)
    if not key:
        return None
    return session.scalars(select(orm.Customer).where(func.lower(orm.Customer.name) == key.lower())).first()


def upsert_customer(session: Session, name: str, ts: str, phone: str = "", tin: str = "", ssm_brn: str = "") -> None:
    key = customer_key(name)
    if not key:
        return
    row = get_customer(session, key)
    if row:
        row.phone = phone or row.phone
        row.tin = tin or row.tin
        row.ssm_brn = ssm_brn or row.ssm_brn
        row.updated_at = ts
    else:
        session.add(orm.Customer(name=key, phone=phone or "", tin=tin or "", ssm_brn=ssm_brn or "", updated_at=ts))
    session.flush()


def lhdn_for(session: Session, name: str) -> str:
    """LHDN status text for this customer."""
    row = get_customer(session, name)
    return f"🟢 LHDN TIN: {row.tin}" if row and row.tin else MISSING_TIN


def open_deal_ids(session: Session, name: str) -> List[str]:
    # Case-insensitive on every database (LIKE ignores case on SQLite but not on Postgres); tags like
    # "(Phone Order)" are stripped in Python, so the query only narrows by the clean name.
    key = customer_key(name).lower()
    rows = session.scalars(
        select(orm.Deal).where(
            orm.Deal.stage.in_([s.value for s in OPEN_STAGES]),
            func.lower(orm.Deal.customer).contains(key, autoescape=True),
        )
    )
    return [r.id for r in rows if customer_key(r.customer).lower() == key]


def apply_tin(session: Session, name: str, tin: str, ssm_brn: str, ts: str) -> List[str]:
    """Saves the TIN on the customer. Returns the customer's open deal ids (they will carry it into the CSV)."""
    upsert_customer(session, name, ts, tin=tin, ssm_brn=ssm_brn)
    return open_deal_ids(session, name)


def customers_payload(session: Session) -> List[entities.Customer]:
    """Every customer for the Customers page: TIN status, open deals, the ready-made TIN request, and their rep.

    A customer's rep is the rep on their most recent deal, so after a reassign the customer follows the
    deals that moved. Customers without any deal have no rep (None).
    """
    company = session.get(orm.Setting, "company_name")
    company_name = company.value if company else "us"
    # Newest deal first (id breaks ties within the same second), so the first deal seen per customer wins.
    # Names are matched like everywhere else in this file: "Tan Bros (Phone Order)" is "Tan Bros".
    latest_rep: dict = {}
    for d in session.scalars(select(orm.Deal).order_by(orm.Deal.created_at.desc(), orm.Deal.id.desc())):
        latest_rep.setdefault(customer_key(d.customer).lower(), d.rep_id)
    return [
        entities.Customer(
            name=c.name,
            phone=c.phone or "",
            tin=c.tin or "",
            ssm_brn=c.ssm_brn or "",
            lhdn_ready=bool(c.tin),
            open_records=len(open_deal_ids(session, c.name)),
            tin_request_text="" if c.tin else tin_request_text(c.name, company_name),
            rep_id=latest_rep.get(customer_key(c.name).lower()),
        )
        for c in session.scalars(select(orm.Customer).order_by(orm.Customer.name))
    ]


def tin_request_text(name: str, company: str) -> str:
    return (
        f"Hi {customer_key(name)}, for LHDN e-Invoicing could you share your company TIN "
        f"(e.g. C2588190021) and SSM registration no.? We will put them on your invoices from {company}. Thank you!"
    )
