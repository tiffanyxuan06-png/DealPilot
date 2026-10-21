"""Customer records with LHDN e-Invoice details (Buyer TIN, SSM BRN).

Invoices still store the customer name as text; customers are matched by their clean name
(e.g. "Tan Bros Trading (Phone Order)" -> "Tan Bros Trading").
"""
import re
import sqlite3
from typing import Any, Dict, List, Optional

from backend.services.memory import clean_customer_name

# Malaysian LHDN TIN: letter prefix (C, IG, SG, OG, D, E, F, ...) + 8-12 digits, e.g. C2588190021, IG115002000.
TIN_RE = re.compile(r"\b((?:C|CS|D|E|F|FA|PT|TA|TC|TN|TR|TP|J|LE|IG|SG|OG)\s?\d{8,12})\b", re.I)
# SSM BRN (new 12-digit format), e.g. 202401009921.
SSM_RE = re.compile(r"\b((?:19|20)\d{2}0[1-6]\d{6})\b")

MISSING_TIN = "🟡 Missing TIN"


def ensure_customers_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS customers (
            name TEXT PRIMARY KEY,
            phone TEXT DEFAULT '',
            tin TEXT DEFAULT '',
            ssm_brn TEXT DEFAULT '',
            updated_at TEXT NOT NULL
        )
        """
    )


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


def get_customer(conn: sqlite3.Connection, name: str) -> Optional[sqlite3.Row]:
    key = customer_key(name)
    return conn.execute("SELECT * FROM customers WHERE name = ? COLLATE NOCASE", (key,)).fetchone() if key else None


def upsert_customer(conn: sqlite3.Connection, name: str, ts: str, phone: str = "", tin: str = "", ssm_brn: str = "") -> None:
    key = customer_key(name)
    if not key:
        return
    row = get_customer(conn, key)
    if row:
        conn.execute(
            "UPDATE customers SET phone = ?, tin = ?, ssm_brn = ?, updated_at = ? WHERE name = ?",
            (phone or row["phone"], tin or row["tin"], ssm_brn or row["ssm_brn"], ts, row["name"]),
        )
    else:
        conn.execute(
            "INSERT INTO customers (name, phone, tin, ssm_brn, updated_at) VALUES (?, ?, ?, ?, ?)",
            (key, phone or "", tin or "", ssm_brn or "", ts),
        )


def lhdn_for(conn: sqlite3.Connection, name: str) -> str:
    """LHDN status text for a new invoice or quote for this customer."""
    row = get_customer(conn, name)
    return f"🟢 LHDN TIN: {row['tin']}" if row and row["tin"] else MISSING_TIN


def apply_tin(conn: sqlite3.Connection, name: str, tin: str, ssm_brn: str, ts: str) -> List[str]:
    """Saves the TIN on the customer and on their invoices that still need one. Returns the invoice ids updated."""
    upsert_customer(conn, name, ts, tin=tin, ssm_brn=ssm_brn)
    key = customer_key(name)
    updated = []
    rows = conn.execute(
        "SELECT id, party, lhdn FROM invoices WHERE type != 'SUPPLIER_COST' AND party LIKE ?", (f"%{key}%",)
    ).fetchall()
    for r in rows:
        if customer_key(r["party"]).lower() == key.lower() and "Consolidated" not in (r["lhdn"] or ""):
            conn.execute("UPDATE invoices SET lhdn = ? WHERE id = ?", (f"🟢 LHDN TIN: {tin}", r["id"]))
            updated.append(r["id"])
    return updated


def sync_customers_from_invoices(conn: sqlite3.Connection, ts: str) -> None:
    """Builds customer records from existing invoices (name, phone, TIN found in the LHDN text)."""
    rows = conn.execute("SELECT party, phone, lhdn FROM invoices WHERE type != 'SUPPLIER_COST'").fetchall()
    for r in rows:
        phone = r["phone"] if (r["phone"] or "").startswith("+") else ""
        upsert_customer(conn, r["party"], ts, phone=phone, tin=parse_tin(r["lhdn"] or "") or "")


def customers_payload(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    row = conn.execute("SELECT value FROM settings WHERE key = 'company_name'").fetchone()
    company = row["value"] if row else "us"
    out = []
    for c in conn.execute("SELECT * FROM customers ORDER BY name").fetchall():
        open_invoices = conn.execute(
            "SELECT COUNT(*) AS n FROM invoices WHERE type IN ('PENDING', 'PENDING_VERIFY', 'AFTERSALES', 'QUOTE_HOLD') AND party LIKE ?",
            (f"%{c['name']}%",),
        ).fetchone()["n"]
        out.append(
            {
                "name": c["name"],
                "phone": c["phone"] or "",
                "tin": c["tin"] or "",
                "ssmBrn": c["ssm_brn"] or "",
                "lhdnReady": bool(c["tin"]),
                "openRecords": open_invoices,
                "tinRequestText": "" if c["tin"] else tin_request_text(c["name"], company),
            }
        )
    return out


def tin_request_text(name: str, company: str) -> str:
    return (
        f"Hi {customer_key(name)}, for LHDN e-Invoicing could you share your company TIN "
        f"(e.g. C2588190021) and SSM registration no.? We will put them on your invoices from {company}. Thank you!"
    )
