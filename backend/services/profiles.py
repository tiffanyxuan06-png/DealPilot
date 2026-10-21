"""Demo data for the extra SME profiles. Switching profile (Owner only) reloads the database with that business.

The air-cond profile (Sejuk Jaya) is seeded in backend/database.py.
"""
import sqlite3
from datetime import datetime, timedelta
from typing import Any, Dict

PROFILES: Dict[str, Dict[str, Any]] = {
    "software": {
        "settings": {
            "company_name": "NexaByte Software Studio Sdn Bhd",
            "cash_on_hand": "14500",
            "framework": (
                "1. Base software modules use catalogue price (annual seat license).\n"
                "2. Custom features / Change Requests are billed at RM 600 per Developer Man-Day (Internal dev labor cost: RM 250/day).\n"
                "3. Quotes hold sprint capacity / licenses for 48h; lock sprint only after 40% deposit."
            ),
        },
        "stock": [
            ("SW-POS-PRO", "Cloud POS Annual License Seat", 25, 300, 1200),
            ("LAB-DEV-DAY", "Developer Sprint Man-Day (Capacity)", 20, 250, 600),
        ],
        # id, type, party, phone, items_text, sku, qty, extra_sku, extra_qty, amount, status, lhdn, hold_hours_left
        "invoices": [
            ("QT-701", "QUOTE_HOLD", "Mega Retail Sdn Bhd", "+60 12-309 8821", "5x Cloud POS Seat + 3x Dev Man-Days (ON HOLD — 48h timer)",
             "SW-POS-PRO", 5, "LAB-DEV-DAY", 3, 7800, "ON_HOLD_48H", "🟢 LHDN TIN: C22998811", 36),
            ("INV-801", "PENDING", "Klinik Medika Group", "+60 12-880 4411", "3x Cloud POS License (Deployed · Waiting Balance)",
             "SW-POS-PRO", 3, None, 0, 3600, "PENDING_PAYMENT", "🟢 LHDN Ready", None),
            ("SUP-402", "SUPPLIER_COST", "Cloud Infra Global Ltd", "", "High-Availability Server Cluster Hosting (Monthly)",
             "SW-POS-PRO", 1, None, 0, 1800, "UNPAID_PAYABLE", "🟢 Supplier e-Inv", None),
        ],
        "logs": [
            "09:31 AM · [Guard] Auto-paused reminders on INV-801 (Klinik Medika) due to LHDN XML bug.",
            "10:15 AM · [Setup] Loaded Software Studio profile & Man-Day Labor Framework.",
        ],
    },
    "fnb": {
        "settings": {
            "company_name": "Kopi & Bakery Wholesale Sdn Bhd",
            "cash_on_hand": "6400",
            "framework": (
                "1. Wholesale items use catalogue carton/bag pricing.\n"
                "2. Standard cold-chain delivery labor/van fee: RM 50 per trip (Driver cost: RM 35), FREE for orders > RM 1,500.\n"
                "3. Urgent same-day lorry dispatch: +RM 120 charge (Lorry cost: RM 80)."
            ),
        },
        "stock": [
            ("BEAN-ARA-5K", "Arabica Coffee Beans (5kg Bag)", 20, 180, 260),
            ("MLK-OAT-CTN", "Barista Oat Milk (Carton 12x1L)", 30, 90, 135),
        ],
        "invoices": [
            ("QT-301", "QUOTE_HOLD", "Cafe Hipster KL", "+60 17-998 1122", "4x Arabica 5kg (ON HOLD — 48h timer)",
             "BEAN-ARA-5K", 4, None, 0, 1040, "ON_HOLD_48H", "🟢 LHDN Ready", 30),
            ("INV-501", "PENDING", "Bistro Bintang", "+60 13-441 2290", "10x Oat Milk Carton",
             "MLK-OAT-CTN", 10, None, 0, 1350, "PENDING_PAYMENT", "🟡 Missing TIN", None),
            ("SUP-601", "SUPPLIER_COST", "Nusantara Coffee Importers Sdn Bhd", "", "30x Arabica 5kg Green Beans (Stock-In Bill)",
             "BEAN-ARA-5K", 30, None, 0, 3600, "UNPAID_PAYABLE", "🟢 Supplier e-Inv", None),
        ],
        "logs": [
            "09:21 AM · [Guard] Auto-paused reminders on INV-501 (Bistro Bintang) due to damaged carton.",
            "10:00 AM · [Setup] Loaded Wholesale F&B profile.",
        ],
    },
}

PROFILE_NAMES = {"aircond": "Sejuk Jaya Aircond Sdn Bhd", **{k: v["settings"]["company_name"] for k, v in PROFILES.items()}}


def seed_profile(conn: sqlite3.Connection, preset: str, ts: str, time_format: str) -> None:
    """Fills an empty database with one of the extra profiles."""
    p = PROFILES[preset]
    for k, v in p["settings"].items():
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, v))
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('sme_preset', ?)", (preset,))
    conn.executemany(
        "INSERT INTO stock (sku, name, on_hand, on_hold, hold_note, unit_cost, sell_price) VALUES (?, ?, ?, 0, '-', ?, ?)",
        p["stock"],
    )
    now = datetime.now()
    for (inv_id, typ, party, phone, items, sku, qty, extra_sku, extra_qty, amount, status, lhdn, hours_left) in p["invoices"]:
        expires = (now + timedelta(hours=hours_left)).strftime(time_format) if hours_left is not None else None
        conn.execute(
            """
            INSERT INTO invoices (id, type, party, phone, hold_timer, hold_expires_at, items_text, sku, qty,
                                  extra_sku, extra_qty, amount, status, lhdn, created_at)
            VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (inv_id, typ, party, phone, expires, items, sku, qty, extra_sku, extra_qty, amount, status, lhdn, ts),
        )
    for entry in p["logs"]:
        conn.execute("INSERT INTO audit_logs (entry, created_at) VALUES (?, ?)", (entry, ts))
