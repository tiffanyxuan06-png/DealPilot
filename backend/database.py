import json
import os
import sqlite3
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from pathlib import Path

import backend.env  # noqa: F401  (loads .env before the defaults below are read)

DB_PATH = Path(__file__).resolve().parent / "cashchase.db"

# LMSTUDIO_URL is the name the code always used; LMSTUDIO_BASE_URL is the older name in .env.example.
DEFAULT_LMSTUDIO_URL = os.getenv("LMSTUDIO_URL") or os.getenv("LMSTUDIO_BASE_URL") or "http://127.0.0.1:1234/v1"
DEFAULT_LMSTUDIO_API_KEY = os.getenv("LMSTUDIO_API_KEY", "lm-studio")
DEFAULT_LMSTUDIO_MODEL = os.getenv("LMSTUDIO_MODEL", "local-model")

STAGES = ("INQUIRY", "QUOTED", "FOLLOW_UP", "WON", "LOST")
OPEN_STAGES = ("INQUIRY", "QUOTED", "FOLLOW_UP")
PIPELINE_STAGES = ("QUOTED", "FOLLOW_UP")  # quoted but not yet decided

# Full timestamps compare correctly as text, so SQL can filter on them directly.
TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def now_time_str() -> str:
    return datetime.now().strftime("%I:%M %p")


def now_stamp() -> str:
    return datetime.now().strftime(TIME_FORMAT)


def parse_time(value: Optional[str]) -> Optional[datetime]:
    try:
        return datetime.strptime(value, TIME_FORMAT) if value else None
    except ValueError:
        return None


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def get_setting(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, str(value)))


def add_log(conn: sqlite3.Connection, msg: str) -> None:
    ts = now_time_str()
    full_entry = f"{ts} · {msg}"
    conn.execute("INSERT INTO audit_logs (entry, created_at) VALUES (?, ?)", (full_entry, ts))


def follow_up_hours(conn: sqlite3.Connection) -> int:
    """How long a quote waits for a reply before it needs a follow-up (default 48h, Owner setting)."""
    try:
        return max(1, int(get_setting(conn, "follow_up_hours", "48")))
    except ValueError:
        return 48


def follow_up_due_str(conn: sqlite3.Connection, from_time: Optional[datetime] = None) -> str:
    return ((from_time or datetime.now()) + timedelta(hours=follow_up_hours(conn))).strftime(TIME_FORMAT)


def _span(secs: int) -> str:
    return f"{secs // 3600}h {secs % 3600 // 60:02d}m"


def follow_up_text(stage: str, follow_up_at: Optional[str], paused: bool) -> str:
    """Live countdown shown in the WebApp and the extension."""
    if stage not in PIPELINE_STAGES:
        return ""
    if paused:
        return "⏸ Follow-ups paused (complaint)"
    due = parse_time(follow_up_at)
    if not due:
        return ""
    secs = int((due - datetime.now()).total_seconds())
    if secs > 0:
        return f"⏳ {_span(secs)} to follow-up"
    return f"🔔 Follow-up due · {_span(-secs)} overdue"


def refresh_follow_ups(conn: sqlite3.Connection) -> None:
    """Quotes with no reply by their follow-up time move to FOLLOW_UP. Paused (complaint) deals wait."""
    rows = conn.execute(
        "SELECT id, customer FROM deals WHERE stage = 'QUOTED' AND paused = 0 AND follow_up_at IS NOT NULL AND follow_up_at <= ?",
        (now_stamp(),),
    ).fetchall()
    for r in rows:
        conn.execute("UPDATE deals SET stage = 'FOLLOW_UP' WHERE id = ?", (r["id"],))
        add_log(conn, f"[SYSTEM] Quote #{r['id']} ({r['customer']}) had no reply in time → follow-up due.")


def deal_commission(amount: int, commission_pct: float) -> int:
    # Commission on the amount after discount, so a discount also costs the rep.
    return round(amount * commission_pct / 100)


def deal_margin_pct(items: List[Dict[str, Any]], amount: int, costs: Dict[str, int]) -> float:
    """Margin % on the deal total after discount: (amount - unit cost x qty) / amount."""
    if amount <= 0:
        return -100.0
    cost = sum(costs.get(i["sku"], 0) * i["qty"] for i in items)
    return round((amount - cost) / amount * 100, 1)


def resolve_active_ai_credentials(conn: Optional[sqlite3.Connection] = None) -> Dict[str, str]:
    should_close = False
    if conn is None:
        conn = get_db()
        should_close = True
    try:
        from backend.services.ai_provider import active_provider, runpod_credentials

        if active_provider() == "runpod":
            return runpod_credentials()
        url = get_setting(conn, "lmstudio_url", DEFAULT_LMSTUDIO_URL).strip() or DEFAULT_LMSTUDIO_URL
        api_key = get_setting(conn, "lmstudio_api_key", DEFAULT_LMSTUDIO_API_KEY).strip() or DEFAULT_LMSTUDIO_API_KEY
        model = get_setting(conn, "lmstudio_model", DEFAULT_LMSTUDIO_MODEL).strip() or DEFAULT_LMSTUDIO_MODEL
        return {
            "provider": "lmstudio",
            "base_url": url.rstrip("/"),
            "api_key": api_key,
            "model": model,
            "vision_model": (os.getenv("LMSTUDIO_VISION_MODEL") or "auto").strip() or "auto",
        }
    finally:
        if should_close:
            conn.close()


FOLLOW_UPS_BEFORE_SUGGEST_LOST = 3


def _deal_dict(r: sqlite3.Row) -> Dict[str, Any]:
    paused = bool(r["paused"])
    return {
        "id": r["id"],
        "orderNo": r["order_no"],
        "customer": r["customer"],
        "phone": r["phone"] or "",
        "repId": r["rep_id"],
        "stage": r["stage"],
        "items": json.loads(r["items_json"] or "[]"),
        "discount": r["discount"],
        "amount": r["amount"],
        "followUpAt": r["follow_up_at"],
        "followUpText": follow_up_text(r["stage"], r["follow_up_at"], paused),
        "followUpCount": r["follow_up_count"],
        # After 3 unanswered follow-ups the app suggests "mark as lost"; a person always decides.
        "suggestLost": r["stage"] in PIPELINE_STAGES and r["follow_up_count"] >= FOLLOW_UPS_BEFORE_SUGGEST_LOST,
        "paused": paused,
        "lossReason": r["loss_reason"] or "",
        "depositRef": r["deposit_ref"] or "",
        "depositAmount": r["deposit_amount"],
        "notes": r["notes"] or "",
        "createdAt": r["created_at"],
        "wonAt": r["won_at"],
    }


def build_state_payload(role: Optional[str] = None) -> Dict[str, Any]:
    """Everything the WebApp and extension show. Staff never receive unit costs or margin %."""
    from backend.services.permissions import normalize_role

    is_owner = normalize_role(role) == "OWNER"
    conn = get_db()
    refresh_follow_ups(conn)
    conn.commit()

    ai_creds = resolve_active_ai_credentials(conn)
    try:
        margin_floor = float(get_setting(conn, "margin_floor_pct", "15"))
    except ValueError:
        margin_floor = 15.0

    product_rows = conn.execute("SELECT * FROM products ORDER BY sku").fetchall()
    costs = {p["sku"]: p["unit_cost"] for p in product_rows}
    products = [
        {"sku": p["sku"], "name": p["name"], "sellPrice": p["sell_price"], **({"unitCost": p["unit_cost"]} if is_owner else {})}
        for p in product_rows
    ]
    deals = [_deal_dict(r) for r in conn.execute("SELECT * FROM deals ORDER BY created_at DESC").fetchall()]
    for d in deals:
        pct = deal_margin_pct(d["items"], d["amount"], costs)
        d["marginOk"] = pct >= margin_floor
        if is_owner:
            d["marginPct"] = pct

    def overdue(d: Dict[str, Any]) -> bool:
        return d["stage"] == "FOLLOW_UP" and not d["paused"]

    month = datetime.now().strftime("%Y-%m")
    reps: List[Dict[str, Any]] = []
    for r in conn.execute("SELECT * FROM reps WHERE active = 1 ORDER BY id").fetchall():
        mine = [d for d in deals if d["repId"] == r["id"]]
        won = [d for d in mine if d["stage"] == "WON" and (d["wonAt"] or "").startswith(month)]
        reps.append(
            {
                "id": r["id"],
                "name": r["name"],
                "commissionPct": r["commission_pct"],
                "wonRm": sum(d["amount"] for d in won),
                "commissionRm": sum(deal_commission(d["amount"], r["commission_pct"]) for d in won),
                "openDeals": sum(1 for d in mine if d["stage"] in OPEN_STAGES),
                "overdue": sum(1 for d in mine if overdue(d)),
            }
        )

    won_count = sum(1 for d in deals if d["stage"] == "WON")
    lost_count = sum(1 for d in deals if d["stage"] == "LOST")
    pipeline = {
        "valueRm": sum(d["amount"] for d in deals if d["stage"] in PIPELINE_STAGES),
        "byStage": {
            s: {"count": sum(1 for d in deals if d["stage"] == s), "valueRm": sum(d["amount"] for d in deals if d["stage"] == s)}
            for s in STAGES
        },
        "winRate": round(won_count / (won_count + lost_count), 2) if won_count + lost_count else 0.0,
        "overdue": sum(1 for d in deals if overdue(d)),
    }

    client_memories: Dict[str, Any] = {}
    for m in conn.execute("SELECT * FROM client_memories ORDER BY score DESC").fetchall():
        client_memories[m["customer"]] = {
            "customer": m["customer"],
            "phone": m["phone"] or "",
            "tier": m["tier"],
            "score": m["score"],
            "styleSummary": m["style_summary"],
            "paymentBehavior": m["payment_behavior"],
            "totalOrders": m["total_orders"],
            "totalPaidRm": m["total_paid_rm"],
            "lastMessage": m["last_message"] or "",
            "updatedAt": m["updated_at"],
        }

    log_rows = conn.execute("SELECT entry FROM audit_logs ORDER BY id DESC LIMIT 100").fetchall()

    from backend.services.customers import customers_payload
    from backend.services.permissions import approvals_payload, permissions_payload

    customers = customers_payload(conn)
    permissions = permissions_payload(conn)
    approvals = approvals_payload(conn)

    company = {
        "name": get_setting(conn, "company_name", "Sejuk Jaya Aircond Sdn Bhd"),
        "preset": get_setting(conn, "sme_preset", "aircond"),
        "framework": get_setting(conn, "framework", ""),
        "followUpHours": follow_up_hours(conn),
        "marginFloorPct": margin_floor,
        "aiProvider": ai_creds["provider"],
        "lmstudioUrl": ai_creds["base_url"],
        # The RunPod key is a paid secret: it stays on the server (routes read it with resolve_active_ai_credentials).
        "lmstudioApiKey": ai_creds["api_key"] if ai_creds["provider"] == "lmstudio" else "",
        "lmstudioModel": ai_creds["model"],
    }

    conn.close()
    return {
        "company": company,
        "products": products,
        "reps": reps,
        "deals": deals,
        "pipeline": pipeline,
        "customers": customers,
        "clientMemories": client_memories,
        "permissions": permissions,
        "approvals": approvals,
        "logs": [r["entry"] for r in log_rows],
    }


OLD_TABLES = ("stock", "invoices", "receipt_records", "chats")  # cash & stock version, before the sales agent
TABLES = ("settings", "products", "reps", "deals", "audit_logs", "client_memories", "role_permissions", "approval_requests", "customers")


def init_db(force_reset: bool = False, preset: Optional[str] = None) -> None:
    """Creates tables and seeds demo data. `preset` picks the SME profile to seed (default: air-cond).

    A database from the old cash & stock version is rebuilt from scratch (it only ever held demo data).
    """
    conn = get_db()
    cur = conn.cursor()

    old_version = cur.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'invoices'").fetchone()
    if force_reset or old_version:
        cur.executescript("".join(f"DROP TABLE IF EXISTS {t};" for t in OLD_TABLES + TABLES))

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS products (
            sku TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sell_price INTEGER NOT NULL,
            unit_cost INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            commission_pct REAL NOT NULL DEFAULT 3.0,
            active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS deals (
            id TEXT PRIMARY KEY,
            order_no TEXT DEFAULT NULL,
            customer TEXT NOT NULL,
            phone TEXT DEFAULT '',
            rep_id INTEGER REFERENCES reps(id),
            stage TEXT NOT NULL CHECK (stage IN ('INQUIRY', 'QUOTED', 'FOLLOW_UP', 'WON', 'LOST')),
            items_json TEXT NOT NULL DEFAULT '[]',
            discount INTEGER NOT NULL DEFAULT 0,
            amount INTEGER NOT NULL DEFAULT 0,
            follow_up_at TEXT DEFAULT NULL,
            follow_up_count INTEGER NOT NULL DEFAULT 0,
            paused INTEGER NOT NULL DEFAULT 0,
            loss_reason TEXT DEFAULT '',
            deposit_ref TEXT DEFAULT '',
            deposit_amount INTEGER DEFAULT NULL,
            notes TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            won_at TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS client_memories (
            customer TEXT PRIMARY KEY,
            phone TEXT DEFAULT '',
            tier TEXT NOT NULL DEFAULT 'NEW_CLIENT',
            score INTEGER NOT NULL DEFAULT 50,
            style_summary TEXT NOT NULL DEFAULT 'Direct SME buyer · Prefers fast quotes',
            payment_behavior TEXT NOT NULL DEFAULT 'No past deals yet',
            total_orders INTEGER NOT NULL DEFAULT 0,
            total_paid_rm INTEGER NOT NULL DEFAULT 0,
            last_message TEXT DEFAULT '',
            recent_history_json TEXT DEFAULT '[]',
            cached_analysis_json TEXT DEFAULT '',
            updated_at TEXT NOT NULL
        );
        """
    )

    # Mandatory rule: the activity log is append-only (reset drops and recreates the whole table).
    cur.executescript(
        """
        CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs
        BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs
        BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
        """
    )

    from backend.services.customers import ensure_customers_table
    from backend.services.permissions import ensure_tables

    ensure_tables(conn)
    ensure_customers_table(conn)

    if cur.execute("SELECT COUNT(*) AS cnt FROM settings").fetchone()["cnt"] == 0:
        seed_default_data(conn, preset or "aircond")

    conn.commit()
    conn.close()


def seed_default_data(conn: sqlite3.Connection, preset: str = "aircond") -> None:
    defaults = {
        "sme_preset": preset,
        "follow_up_hours": "48",
        "margin_floor_pct": "15",
        "lmstudio_url": DEFAULT_LMSTUDIO_URL,
        "lmstudio_api_key": DEFAULT_LMSTUDIO_API_KEY,
        "lmstudio_model": DEFAULT_LMSTUDIO_MODEL,
    }
    for k, v in defaults.items():
        set_setting(conn, k, v)

    from backend.services.profiles import PROFILES, seed_profile

    if preset in PROFILES:
        seed_profile(conn, preset)
    # "custom": the 60-second setup fills the business in (backend/services/onboarding.py)
