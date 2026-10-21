"""60-second setup: read a business's own stock list (.xlsx / .csv) and start CashChase with it.

Column names are matched in code (no AI): SKU / item code, item name, quantity, unit cost, selling price.
"""
import base64
import csv
import io
import json
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

HEADER_ALIASES = {
    "sku": ["sku", "code", "item code", "product code", "part no", "part number", "kod"],
    "name": ["name", "item", "item name", "product", "product name", "description", "nama", "barang"],
    "qty": ["qty", "quantity", "stock", "on hand", "onhand", "balance", "kuantiti", "units"],
    "unitCost": ["cost", "unit cost", "cost price", "buy price", "purchase price", "kos"],
    "sellPrice": ["price", "sell", "sell price", "selling price", "retail", "retail price", "unit price", "harga"],
}
MAX_ITEMS = 500


def _norm(h: Any) -> str:
    return re.sub(r"[^a-z0-9 ]", "", str(h or "").strip().lower())


def _match_headers(headers: List[Any]) -> Dict[str, int]:
    found: Dict[str, int] = {}
    normed = [_norm(h) for h in headers]
    for field, aliases in HEADER_ALIASES.items():
        for i, h in enumerate(normed):
            if i in found.values():
                continue
            if any(h == a or re.search(rf"\b{re.escape(a)}\b", h) for a in aliases):
                found[field] = i
                break
    return found


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"(?i)rm|myr|,|\s", "", str(v))
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _make_sku(name: str, used: set) -> str:
    base = "-".join(w[:3].upper() for w in re.findall(r"[A-Za-z0-9]+", name)[:3]) or "ITEM"
    sku, n = base, 2
    while sku in used:
        sku, n = f"{base}-{n}", n + 1
    return sku


def read_rows(file_name: str, data: bytes) -> List[List[Any]]:
    if file_name.lower().endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook

        ws = load_workbook(io.BytesIO(data), read_only=True, data_only=True).active
        return [list(r) for r in ws.iter_rows(values_only=True)]
    text = data.decode("utf-8-sig", errors="replace")
    return [r for r in csv.reader(io.StringIO(text))]


def decode_upload(file_base64: str) -> bytes:
    payload = file_base64.split(",", 1)[1] if file_base64.startswith("data:") else file_base64
    return base64.b64decode(payload)


def parse_stock_list(file_name: str, data: bytes) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Returns (items, warnings). Rows without a name or with no usable numbers are skipped."""
    rows = [r for r in read_rows(file_name, data) if any(str(c or "").strip() for c in r)]
    if not rows:
        return [], ["The file is empty."]
    header_idx, cols = 0, {}
    for i, r in enumerate(rows[:10]):  # the header may sit below a title row
        cols = _match_headers(r)
        if "name" in cols and ("qty" in cols or "sellPrice" in cols or "unitCost" in cols):
            header_idx = i
            break
    if "name" not in cols:
        return [], ["Could not find an item name column (e.g. 'Item', 'Product', 'Description')."]
    missing = [label for f, label in (("qty", "quantity"), ("unitCost", "unit cost"), ("sellPrice", "selling price")) if f not in cols]
    warnings = [f"No {', '.join(missing)} column found; please check those values below."] if missing else []

    items, used = [], set()
    for r in rows[header_idx + 1:]:
        get = lambda f: r[cols[f]] if f in cols and cols[f] < len(r) else None  # noqa: E731
        name = str(get("name") or "").strip()
        if not name:
            continue
        qty, cost, price = _num(get("qty")), _num(get("unitCost")), _num(get("sellPrice"))
        sku = str(get("sku") or "").strip().upper() or _make_sku(name, used)
        if sku in used:
            sku = _make_sku(name, used)
        used.add(sku)
        estimated = False
        if price is None and cost is not None:
            price, estimated = round(cost * 1.3), True
        if cost is None and price is not None:
            cost, estimated = round(price / 1.3), True
        items.append(
            {
                "sku": sku,
                "name": name[:80],
                "qty": max(0, int(qty or 0)),
                "unitCost": max(0, int(round(cost or 0))),
                "sellPrice": max(0, int(round(price or 0))),
                "estimated": estimated,
            }
        )
        if len(items) >= MAX_ITEMS:
            warnings.append(f"Only the first {MAX_ITEMS} items were read.")
            break
    if any(i["estimated"] for i in items):
        warnings.append("Some costs or prices were missing and were estimated with a 30% margin (marked ✏️). Please check them.")
    return items, warnings


def apply_onboarding(conn: sqlite3.Connection, setup: Dict[str, Any], ts: str) -> None:
    """Fills an empty database with the business from the setup form. Stored so Reset can rebuild it."""
    settings = {
        "company_name": setup["companyName"],
        "cash_on_hand": str(int(setup["startingCash"])),
        "hold_hours": str(int(setup["holdHours"])),
        "owner_approval_threshold": str(int(setup["threshold"])),
        "sme_preset": "custom",
        "framework": setup.get("framework") or "Quotes hold stock for the hold time; physical stock is only deducted after the deposit is confirmed.",
        "onboarding_json": json.dumps(setup),
    }
    for k, v in settings.items():
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, v))
    for k in ("ssm", "tin"):
        conn.execute("DELETE FROM settings WHERE key = ?", (k,))
    conn.executemany(
        "INSERT INTO stock (sku, name, on_hand, on_hold, hold_note, unit_cost, sell_price) VALUES (?, ?, ?, 0, '-', ?, ?)",
        [(i["sku"], i["name"], i["qty"], i["unitCost"], i["sellPrice"]) for i in setup["items"]],
    )
    stock_value = sum(i["qty"] * i["unitCost"] for i in setup["items"])
    conn.execute(
        "INSERT INTO audit_logs (entry, created_at) VALUES (?, ?)",
        (
            f"{ts} · [OWNER] Set up {setup['companyName']}: {len(setup['items'])} stock items (RM {stock_value:,} stock value), "
            f"starting cash RM {int(setup['startingCash']):,}, {int(setup['holdHours'])}h quote hold, RM {int(setup['threshold']):,} approval threshold.",
            ts,
        ),
    )
