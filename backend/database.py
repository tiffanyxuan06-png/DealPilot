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


def now_time_str() -> str:
    return datetime.now().strftime("%I:%M %p")


HOLD_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def hold_expiry_str(conn: sqlite3.Connection, from_time: Optional[datetime] = None) -> str:
    """When a quote created now stops holding stock (default 48h, Owner setting `hold_hours`)."""
    try:
        hours = int(get_setting(conn, "hold_hours", "48"))
    except ValueError:
        hours = 48
    return ((from_time or datetime.now()) + timedelta(hours=hours)).strftime(HOLD_TIME_FORMAT)


def parse_hold_time(value: Optional[str]) -> Optional[datetime]:
    try:
        return datetime.strptime(value, HOLD_TIME_FORMAT) if value else None
    except ValueError:
        return None


def hold_timer_text(status: str, expires_at: Optional[str], stored: str) -> str:
    """Live countdown shown in the WebApp and the extension."""
    expires = parse_hold_time(expires_at)
    if not expires:
        return stored or ""
    secs = int((expires - datetime.now()).total_seconds())
    if status == "ON_HOLD_48H" and secs > 0:
        return f"⏳ {secs // 3600}h {secs % 3600 // 60:02d}m left"
    if status == "HOLD_EXPIRED":
        ago = max(0, -secs)
        return f"⚠️ Expired {ago // 3600}h {ago % 3600 // 60:02d}m ago · stock released"
    return stored or ""


def expire_holds(conn: sqlite3.Connection) -> None:
    """Quotes whose 48h hold has run out stop holding stock (units go back to Available). The quote stays for follow-up."""
    now = datetime.now()
    rows = conn.execute(
        "SELECT * FROM invoices WHERE type = 'QUOTE_HOLD' AND status = 'ON_HOLD_48H' AND hold_expires_at IS NOT NULL"
    ).fetchall()
    for r in rows:
        expires = parse_hold_time(r["hold_expires_at"])
        if expires and expires <= now:
            conn.execute("UPDATE invoices SET status = 'HOLD_EXPIRED' WHERE id = ?", (r["id"],))
            items = f"{r['qty']}x {r['sku']}" + (f" + {r['extra_qty']}x {r['extra_sku']}" if r["extra_sku"] and r["extra_qty"] else "")
            add_log(conn, f"[SYSTEM] Quote #{r['id']} ({r['party']}) expired with no deposit → {items} released back to Available.")
    if rows:
        recompute_stock_holds(conn)


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


def resolve_active_ai_credentials(conn: Optional[sqlite3.Connection] = None) -> Dict[str, str]:
    should_close = False
    if conn is None:
        conn = get_db()
        should_close = True
    try:
        url = get_setting(conn, "lmstudio_url", DEFAULT_LMSTUDIO_URL).strip() or DEFAULT_LMSTUDIO_URL
        api_key = get_setting(conn, "lmstudio_api_key", DEFAULT_LMSTUDIO_API_KEY).strip() or DEFAULT_LMSTUDIO_API_KEY
        model = get_setting(conn, "lmstudio_model", DEFAULT_LMSTUDIO_MODEL).strip() or DEFAULT_LMSTUDIO_MODEL
        return {
            "base_url": url.rstrip("/"),
            "api_key": api_key,
            "model": model,
        }
    finally:
        if should_close:
            conn.close()


def recompute_stock_holds(conn: sqlite3.Connection) -> None:
    """Keeps stock.on_hold and stock.hold_note 100% synchronized with active QUOTE_HOLD records."""
    stocks = conn.execute("SELECT sku FROM stock").fetchall()
    active_holds = conn.execute(
        "SELECT id, party, sku, qty, extra_sku, extra_qty, status, hold_timer FROM invoices WHERE type = 'QUOTE_HOLD' AND status = 'ON_HOLD_48H'"
    ).fetchall()

    for s in stocks:
        sku = s["sku"]
        total_held = 0
        notes = []
        for h in active_holds:
            if h["sku"] == sku and h["qty"] > 0:
                total_held += h["qty"]
                notes.append(f"{h['qty']}x {h['id']} ({h['party']})")
            elif h["extra_sku"] == sku and (h["extra_qty"] or 0) > 0:
                total_held += h["extra_qty"]
                notes.append(f"{h['extra_qty']}x {h['id']} ({h['party']})")

        note_str = " + ".join(notes) if notes else "-"
        conn.execute(
            "UPDATE stock SET on_hold = ?, hold_note = ? WHERE sku = ?",
            (total_held, note_str, sku),
        )


def build_state_payload() -> Dict[str, Any]:
    conn = get_db()
    expire_holds(conn)
    recompute_stock_holds(conn)
    conn.commit()

    cash_on_hand = int(get_setting(conn, "cash_on_hand", "9800"))
    company_name = get_setting(conn, "company_name", "Sejuk Jaya Aircond Sdn Bhd")
    active_preset = get_setting(conn, "sme_preset", "aircond")
    framework = get_setting(conn, "framework", "")
    ai_creds = resolve_active_ai_credentials(conn)
    lmstudio_url = ai_creds["base_url"]
    lmstudio_api_key = ai_creds["api_key"]
    lmstudio_model = ai_creds["model"]

    stock_rows = conn.execute("SELECT * FROM stock").fetchall()
    inv_rows = conn.execute("SELECT * FROM invoices ORDER BY rowid DESC").fetchall()
    log_rows = conn.execute("SELECT entry FROM audit_logs ORDER BY id DESC LIMIT 100").fetchall()
    mem_rows = conn.execute("SELECT * FROM client_memories ORDER BY score DESC").fetchall()

    client_memories_dict: Dict[str, Any] = {}
    for m in mem_rows:
        client_memories_dict[m["customer"]] = {
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

    invoices_list: List[Dict[str, Any]] = []
    for r in inv_rows:
        invoices_list.append(
            {
                "id": r["id"],
                "type": r["type"],
                "party": r["party"],
                "phone": r["phone"] or "",
                "holdTimer": hold_timer_text(r["status"], r["hold_expires_at"], r["hold_timer"] or ""),
                "holdExpiresAt": r["hold_expires_at"],
                "chatIdx": r["chat_idx"],
                "itemsText": r["items_text"],
                "sku": r["sku"],
                "qty": r["qty"],
                "extraSku": r["extra_sku"],
                "extraQty": r["extra_qty"] or 0,
                "amount": r["amount"],
                "claimedAmount": r["claimed_amount"],
                "receiptRef": r["receipt_ref"] or "",
                "receiptPayee": r["receipt_payee"] or "",
                "status": r["status"],
                "lhdn": r["lhdn"],
                "createdAt": r["created_at"],
            }
        )

    stock_list: List[Dict[str, Any]] = []
    for s in stock_rows:
        sku = s["sku"]
        holders = []
        for inv in invoices_list:
            if inv["type"] == "QUOTE_HOLD" and inv["status"] == "ON_HOLD_48H":
                if inv["sku"] == sku:
                    holders.append(
                        {
                            "quoteId": inv["id"],
                            "party": inv["party"],
                            "phone": inv["phone"],
                            "heldQty": inv["qty"],
                            "amount": inv["amount"],
                            "status": inv["status"],
                            "holdTimer": inv["holdTimer"] or ("⚠️ Expired" if inv["status"] == "HOLD_EXPIRED" else "⏳ 48h Hold"),
                            "itemsText": inv["itemsText"],
                        }
                    )
                elif inv["extraSku"] == sku and inv["extraQty"] > 0:
                    holders.append(
                        {
                            "quoteId": inv["id"],
                            "party": inv["party"],
                            "phone": inv["phone"],
                            "heldQty": inv["extraQty"],
                            "amount": inv["amount"],
                            "status": inv["status"],
                            "holdTimer": inv["holdTimer"] or "⏳ 48h Hold",
                            "itemsText": inv["itemsText"],
                        }
                    )

        on_hand = s["on_hand"]
        on_hold = s["on_hold"]
        avail = max(0, on_hand - on_hold)
        stock_list.append(
            {
                "sku": sku,
                "name": s["name"],
                "onHand": on_hand,
                "onHold": on_hold,
                "available": avail,
                "holdNote": s["hold_note"],
                "unitCost": s["unit_cost"],
                "sellPrice": s["sell_price"],
                "stockValue": on_hand * s["unit_cost"],
                "holders": holders,
            }
        )

    stock_value = sum(item["stockValue"] for item in stock_list)
    core_net_worth = cash_on_hand + stock_value
    pending_in = sum(
        i["amount"]
        for i in invoices_list
        if i["type"] in ("PENDING", "AFTERSALES", "PENDING_VERIFY")
    )
    pending_out = sum(
        i["amount"]
        for i in invoices_list
        if i["type"] == "SUPPLIER_COST" and i["status"] == "UNPAID_PAYABLE"
    )

    try:
        rec_rows = conn.execute("SELECT * FROM receipt_records ORDER BY created_at DESC").fetchall()
        receipts_list = [
            {
                "id": r["id"],
                "invoiceId": r["invoice_id"],
                "customer": r["customer"],
                "fileName": r["file_name"],
                "fileType": r["file_type"],
                "ref": r["ref"],
                "amount": r["amount"],
                "htmlPreview": r["html_preview"],
                "createdAt": r["created_at"],
            }
            for r in rec_rows
        ]
    except Exception:
        receipts_list = []

    from backend.services.customers import customers_payload
    from backend.services.permissions import approvals_payload, permissions_payload

    customers = customers_payload(conn)
    permissions = permissions_payload(conn)
    approvals = approvals_payload(conn)

    conn.close()
    return {
        "permissions": permissions,
        "approvals": approvals,
        "customers": customers,
        "company": {
            "name": company_name,
            "preset": active_preset,
            "cashOnHand": cash_on_hand,
            "stockValue": stock_value,
            "coreNetWorth": core_net_worth,
            "pendingReceivables": pending_in,
            "pendingPayables": pending_out,
            "fullNetWorth": core_net_worth + pending_in - pending_out,
            "lmstudioUrl": lmstudio_url,
            "lmstudioApiKey": lmstudio_api_key,
            "lmstudioModel": lmstudio_model,
            "framework": framework,
        },
        "stock": stock_list,
        "invoices": invoices_list,
        "receipts": receipts_list,
        "clientMemories": client_memories_dict,
        "logs": [r["entry"] for r in log_rows],
    }


def init_db(force_reset: bool = False, preset: Optional[str] = None) -> None:
    """Creates tables and seeds demo data. `preset` picks the SME profile to seed (default: air-cond)."""
    conn = get_db()
    cur = conn.cursor()

    if force_reset:
        cur.executescript(
            """
            DROP TABLE IF EXISTS settings;
            DROP TABLE IF EXISTS stock;
            DROP TABLE IF EXISTS invoices;
            DROP TABLE IF EXISTS chats;
            DROP TABLE IF EXISTS audit_logs;
            DROP TABLE IF EXISTS client_memories;
            DROP TABLE IF EXISTS receipt_records;
            DROP TABLE IF EXISTS role_permissions;
            DROP TABLE IF EXISTS approval_requests;
            DROP TABLE IF EXISTS customers;
            """
        )

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS stock (
            sku TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            on_hand INTEGER NOT NULL,
            on_hold INTEGER NOT NULL,
            hold_note TEXT NOT NULL,
            unit_cost INTEGER NOT NULL,
            sell_price INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            party TEXT NOT NULL,
            phone TEXT DEFAULT '',
            hold_timer TEXT DEFAULT '',
            hold_expires_at TEXT DEFAULT NULL,
            chat_idx INTEGER DEFAULT NULL,
            items_text TEXT NOT NULL,
            sku TEXT NOT NULL,
            qty INTEGER NOT NULL,
            extra_sku TEXT DEFAULT NULL,
            extra_qty INTEGER DEFAULT 0,
            amount INTEGER NOT NULL,
            claimed_amount INTEGER DEFAULT NULL,
            receipt_ref TEXT DEFAULT '',
            receipt_payee TEXT DEFAULT '',
            status TEXT NOT NULL,
            lhdn TEXT NOT NULL,
            created_at TEXT NOT NULL
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
            style_summary TEXT NOT NULL DEFAULT 'Direct SME buyer · Prefers fast stock & price confirmation',
            payment_behavior TEXT NOT NULL DEFAULT 'Standard payment terms apply',
            total_orders INTEGER NOT NULL DEFAULT 0,
            total_paid_rm INTEGER NOT NULL DEFAULT 0,
            last_message TEXT DEFAULT '',
            recent_history_json TEXT DEFAULT '[]',
            cached_analysis_json TEXT DEFAULT '',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS receipt_records (
            id TEXT PRIMARY KEY,
            invoice_id TEXT DEFAULT '',
            customer TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_type TEXT NOT NULL DEFAULT 'pdf',
            ref TEXT DEFAULT '',
            amount INTEGER NOT NULL DEFAULT 0,
            file_data TEXT DEFAULT '',
            html_preview TEXT DEFAULT '',
            created_at TEXT NOT NULL
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

    from backend.services.permissions import ensure_tables

    ensure_tables(conn)

    # Older databases: add the hold expiry column.
    cols = [c["name"] for c in conn.execute("PRAGMA table_info(invoices)").fetchall()]
    if "hold_expires_at" not in cols:
        conn.execute("ALTER TABLE invoices ADD COLUMN hold_expires_at TEXT DEFAULT NULL")
    if "receipt_payee" not in cols:
        conn.execute("ALTER TABLE invoices ADD COLUMN receipt_payee TEXT DEFAULT ''")

    from backend.services.customers import ensure_customers_table

    ensure_customers_table(conn)

    cur.execute("SELECT COUNT(*) AS cnt FROM settings")
    if cur.fetchone()["cnt"] == 0:
        seed_default_data(conn, preset or "aircond")
    active_preset = get_setting(conn, "sme_preset", "aircond")

    from backend.services.customers import sync_customers_from_invoices, upsert_customer

    if conn.execute("SELECT COUNT(*) AS cnt FROM customers").fetchone()["cnt"] == 0:
        sync_customers_from_invoices(conn, now_time_str())
        if active_preset == "aircond":
            # Demo customer who asks for a quote on WhatsApp (no invoice yet).
            upsert_customer(conn, "Tan Bros Trading", now_time_str(), phone="+60 12-345 6789", tin="C2088391020")

    cur.execute("SELECT COUNT(*) AS cnt FROM receipt_records")
    if cur.fetchone()["cnt"] == 0 and active_preset == "aircond":
        seed_receipt_records(conn)

    conn.commit()
    conn.close()


def seed_receipt_records(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    ts = now_time_str()
    receipt_rows = [
        (
            "REC-2026-001",
            "INV-205",
            "Wisma Perdana Sdn Bhd",
            "DuitNow_Receipt_DN88412.pdf",
            "pdf",
            "DN-20261117-88412",
            2200,
            "",
            "DuitNow Instant Transfer: RM 2,200.00 from Wisma Perdana Sdn Bhd to Sejuk Jaya Aircond Sdn Bhd · Ref: DN-20261117-88412",
            ts,
        ),
        (
            "REC-2026-002",
            "SUP-881",
            "Penghawa Dingin Supplies (Supplier)",
            "Sample_Supplier_Bill.pdf",
            "pdf",
            "SUP-881",
            1500,
            "",
            "Supplier Tax Invoice #SUP-881: 10x Copper Pipe Set (RM 1,500.00) · Penghawa Dingin Supplies",
            ts,
        ),
        (
            "REC-2026-003",
            "INV-202",
            "Restoran Selera Kampung",
            "DuitNow_Transfer_DN55190.pdf",
            "pdf",
            "DN-20261117-55190",
            1650,
            "",
            "DuitNow Instant Transfer: RM 1,650.00 from Restoran Selera Kampung · Ref: DN-20261117-55190",
            ts,
        ),
    ]
    cur.executemany(
        """
        INSERT OR REPLACE INTO receipt_records (
            id, invoice_id, customer, file_name, file_type, ref,
            amount, file_data, html_preview, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        receipt_rows,
    )


def seed_default_data(conn: sqlite3.Connection, preset: str = "aircond") -> None:
    cur = conn.cursor()

    default_settings = {
        "company_name": "Sejuk Jaya Aircond Sdn Bhd",
        "ssm": "202401009921 (1554821-X)",
        "tin": "C2588190021",
        "cash_on_hand": "9800",
        "sme_preset": "aircond",
        "framework": (
            "1. Standard installation labor: RM 250/unit (Installer subcon cost: RM 120/unit).\n"
            "2. Extra copper piping: RM 150 per 3m set (deducts PIP-COP-3M stock; cost RM 96).\n"
            "3. Quotes hold stock for 48h; deduct physical stock only after deposit is confirmed."
        ),
        "lmstudio_url": DEFAULT_LMSTUDIO_URL,
        "lmstudio_api_key": DEFAULT_LMSTUDIO_API_KEY,
        "lmstudio_model": DEFAULT_LMSTUDIO_MODEL,
        "owner_approval_threshold": "1000",
        "hold_hours": "48",
    }
    for k, v in default_settings.items():
        cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, v))

    ts = now_time_str()
    if preset != "aircond":
        from backend.services.profiles import seed_profile

        for k in ("ssm", "tin"):  # Sejuk Jaya registration details
            cur.execute("DELETE FROM settings WHERE key = ?", (k,))
        seed_profile(conn, preset, ts, HOLD_TIME_FORMAT)

    if preset == "aircond":
        stock_rows = [
            ("ACN-DAI-15", "Daikin 1.5HP Inverter Unit", 8, 0, "-", 850, 1150),
            ("GAS-R32", "R32 Refrigerant Gas (3kg)", 15, 0, "-", 130, 180),
            ("PIP-COP-3M", "Copper Pipe 3m Set", 15, 2, "2x QT-102 (41h left)", 96, 150),
        ]
        cur.executemany(
            """
            INSERT INTO stock (sku, name, on_hand, on_hold, hold_note, unit_cost, sell_price)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            stock_rows,
        )

        invoice_rows = [
            (
                "INV-205",
                "PENDING_VERIFY",
                "Wisma Perdana Sdn Bhd",
                "+60 12-998 4410",
                "",
                None,
                "2x Daikin 1.5HP (Customer sent DuitNow Screenshot RM 2,200 · Ref: DN-88412 · RM 200 Short)",
                "ACN-DAI-15",
                2,
                None,
                0,
                2400,
                2200,
                "DN-20261117-88412",
                "PENDING_BANK_VERIFY",
                "🟢 LHDN TIN: C20991820",
                ts,
            ),
            (
                "QT-101",
                "QUOTE_HOLD",
                "Kedai Runcit Ah Seng",
                "+60 19-221 0091",
                "⚠️ Expired",
                3,
                "3x Daikin 1.5HP (48h hold expired · no deposit)",
                "ACN-DAI-15",
                3,
                None,
                0,
                3450,
                None,
                "",
                "HOLD_EXPIRED",
                "🟡 Missing TIN",
                ts,
            ),
            (
                "QT-102",
                "QUOTE_HOLD",
                "Syarikat Bina Jaya",
                "+60 12-773 8810",
                "⏳ 41h Left (Active)",
                None,
                "2x Copper Pipe 3m Set (ON HOLD — 41h left)",
                "PIP-COP-3M",
                2,
                None,
                0,
                300,
                None,
                "",
                "ON_HOLD_48H",
                "🟢 LHDN TIN: C21884920",
                ts,
            ),
            (
                "INV-201",
                "AFTERSALES",
                "Klinik Dr. Lim",
                "+60 16-882 1920",
                "",
                2,
                "4x Daikin 1.5HP, 4x R32 Gas (1x R32 reported leaking)",
                "GAS-R32",
                1,
                None,
                0,
                4800,
                None,
                "",
                "AFTERSALES_PAUSED",
                "🟢 LHDN TIN: C20114892",
                ts,
            ),
            (
                "INV-202",
                "PENDING",
                "Restoran Selera Kampung",
                "+60 13-551 9022",
                "",
                None,
                "1x Daikin 1.5HP + Standard Install",
                "ACN-DAI-15",
                1,
                None,
                0,
                1650,
                None,
                "",
                "PENDING_PAYMENT",
                "🟢 LHDN TIN: C20449102",
                ts,
            ),
            (
                "SUP-881",
                "SUPPLIER_COST",
                "Penghawa Dingin Supplies (Supplier)",
                "+60 3-7881 9900",
                "",
                None,
                "10x Copper Pipe Set (Stock-In Bill)",
                "PIP-COP-3M",
                10,
                None,
                0,
                1500,
                None,
                "",
                "UNPAID_PAYABLE",
                "🟢 Supplier e-Inv",
                ts,
            ),
        ]
        cur.executemany(
            """
            INSERT INTO invoices (
                id, type, party, phone, hold_timer, chat_idx, items_text,
                sku, qty, extra_sku, extra_qty, amount, claimed_amount,
                receipt_ref, status, lhdn, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            invoice_rows,
        )
        # Real hold times for the demo quotes: QT-101 ran out 2h ago, QT-102 has 41h left.
        now = datetime.now()
        cur.execute("UPDATE invoices SET hold_expires_at = ? WHERE id = 'QT-101'", ((now - timedelta(hours=2)).strftime(HOLD_TIME_FORMAT),))
        cur.execute("UPDATE invoices SET hold_expires_at = ? WHERE id = 'QT-102'", ((now + timedelta(hours=41)).strftime(HOLD_TIME_FORMAT),))
        # The seeded DuitNow receipt for INV-205 was paid to the company (it is RM 200 short, which is the check it fails).
        cur.execute("UPDATE invoices SET receipt_payee = 'Sejuk Jaya Aircond Sdn Bhd' WHERE id = 'INV-205'")

        logs = [
            "10:45 AM · [System] QT-101 (Kedai Ah Seng): 48h Stock Hold expired with no deposit (3x Daikin released back to Available).",
            "10:42 AM · [Auto-OCR] Decoded DuitNow Receipt Ref: DN-88412 from Wisma Perdana (RM 2,200 vs RM 2,400 invoice: RM 200 Shortfall).",
            "09:51 AM · [Guard] Auto-paused reminders on INV-201 (Klinik Dr. Lim) due to aftersales complaint.",
            "09:00 AM · [System] Loaded CashChase SME Database (Cash: RM 9,800 · Physical Stock: RM 10,190).",
        ]
        for entry in reversed(logs):
            cur.execute("INSERT INTO audit_logs (entry, created_at) VALUES (?, ?)", (entry, ts))

    memory_rows = [
        (
            "Tan Bros Trading",
            "+60 12-345 6789",
            "VIP_FAST_PAYER",
            94,
            "Friendly Manglish Boss style ('Boss, got stock?') · Appreciates fast quotes & immediate 48h hold",
            "⭐⭐⭐⭐⭐ Grade A Client · 6 past orders (RM 28,400 paid) · Always pays 40% DuitNow deposit within 2 hours",
            6,
            28400,
            "Boss, got 5 units Daikin 1.5HP and 5 bottles R32 gas? How much ah?",
            "[]",
            "",
            ts,
        ),
        (
            "Klinik Dr. Lim",
            "+60 16-882 1920",
            "LONG_TERM_PARTNER",
            88,
            "Polite & professional medical clinic · Values fast aftersales service & respectful tone",
            "⭐⭐⭐⭐ Reliable Payer · 4 past orders (RM 19,200 paid) · Currently has 1 leaking R32 cylinder on #INV-201",
            4,
            19200,
            "One of the R32 gas cylinders you delivered yesterday is leaking at the valve.",
            "[]",
            "",
            ts,
        ),
        (
            "Kedai Runcit Ah Seng",
            "+60 19-221 0091",
            "SLOW_PAYER_GHOST_RISK",
            42,
            "Short casual messages · Frequently asks to hold stock but delays deposit >48 hours",
            "⚠️ High Ghosting Risk · 2 expired quote holds in the past · Require strict 40% deposit before locking stock",
            1,
            1150,
            "Hold 3 units Daikin 1.5HP for me first boss, I transfer deposit tomorrow.",
            "[]",
            "",
            ts,
        ),
        (
            "Wisma Perdana Sdn Bhd",
            "+60 12-998 4410",
            "PARTIAL_SHORT_PAYER",
            58,
            "Corporate procurement · Tends to round down or deduct RM 100-200 on DuitNow transfers",
            "⚠️ Watch Shortfalls · Sent RM 2,200 receipt for RM 2,400 invoice (#INV-205) · Always verify bank amount",
            3,
            9600,
            "Attached DuitNow receipt RM 2,200 for #INV-205.",
            "[]",
            "",
            ts,
        ),
        (
            "Mega Retail Sdn Bhd",
            "+60 12-309 8821",
            "HIGH_VALUE_ENTERPRISE",
            91,
            "Retail chain enterprise · Values SLA, milestone delivery, and formal invoices",
            "⭐⭐⭐⭐⭐ Enterprise Client · 3 past orders (RM 24,500 paid) · Always pays 40% deposit promptly",
            3,
            24500,
            "Expanding 5 outlets. Need 5x Cloud POS License Seats and 3 Developer Sprint Days.",
            "[]",
            "",
            ts,
        ),
        (
            "Klinik Medika Group",
            "+60 12-880 4411",
            "RELIABLE_HEALTHCARE",
            87,
            "Medical group · Sensitive to software uptime during clinic operating hours",
            "⭐⭐⭐⭐ Reliable Payer · 4 past orders (RM 18,600 paid) · Always settles invoices on time",
            4,
            18600,
            "On POS v2.4 the LHDN MyInvois XML export is throwing a 500 server error.",
            "[]",
            "",
            ts,
        ),
        (
            "Apex Logistics Sdn Bhd",
            "+60 19-332 9901",
            "CAUTIOUS_CORPORATE",
            65,
            "Logistics firm · Multi-stage approval process · Requires clear scope definition",
            "⭐⭐⭐ Corporate · 1 past order (RM 4,200 paid) · Do not hold sprint capacity without firm deposit",
            1,
            4200,
            "Need quote for 2x POS Seats + 4 Dev Days.",
            "[]",
            "",
            ts,
        ),
        (
            "Cafe Hipster KL",
            "+60 17-998 1122",
            "POPULAR_CAFE_PARTNER",
            92,
            "High-volume specialty cafe · Values fast delivery and fresh roasted beans",
            "⭐⭐⭐⭐⭐ Repeat F&B Partner · 8 past orders (RM 16,800 paid) · Always confirms orders with 40% deposit",
            8,
            16800,
            "Can quote 6 bags of Arabica 5kg and 10 cartons Barista Oat Milk with cold delivery?",
            "[]",
            "",
            ts,
        ),
        (
            "Bistro Bintang",
            "+60 13-441 2289",
            "GROWING_RESTAURANT",
            80,
            "Casual dining restaurant · Orders monthly beverage supplies",
            "⭐⭐⭐⭐ Reliable Client · 3 past orders (RM 5,400 paid) · Reliable payer",
            3,
            5400,
            "Need 10x Oat Milk Carton delivered today.",
            "[]",
            "",
            ts,
        ),
        (
            "Bintang E-Commerce Sdn Bhd",
            "+60 13-441 9901",
            "HIGH_VALUE_ENTERPRISE",
            93,
            "E-commerce operator · Direct professional tone · Immediate DuitNow payments",
            "⭐⭐⭐⭐⭐ Fast Payer · 3 past orders (RM 24,500 paid) · Always transfers 40% deposit promptly",
            3,
            24500,
            "Hi team, confirmed! We just transferred RM 3,120 deposit via DuitNow (Ref: DN-20261117-88410).",
            "[]",
            "",
            ts,
        ),
        (
            "Urban Roasters TTDI",
            "+60 18-332 5590",
            "POPULAR_CAFE_PARTNER",
            93,
            "Artisan specialty coffee roastery · Friendly tone · Prompt morning deliveries needed",
            "⭐⭐⭐⭐⭐ Repeat F&B Partner · 8 past orders (RM 16,800 paid) · Always confirms orders with 40% deposit",
            8,
            16800,
            "Hi Boss! Just transferred RM 1,164 deposit via DuitNow (Ref: DN-20261117-77319).",
            "[]",
            "",
            ts,
        ),
    ]
    cur.executemany(
        """
        INSERT OR REPLACE INTO client_memories (
            customer, phone, tier, score, style_summary, payment_behavior,
            total_orders, total_paid_rm, last_message, recent_history_json,
            cached_analysis_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        memory_rows,
    )
