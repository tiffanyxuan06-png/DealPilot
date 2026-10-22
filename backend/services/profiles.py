"""Demo businesses. Switching profile (Owner only) reloads the database with that business.

Each profile seeds a price list, three sales reps, deals in every pipeline stage, customers (with
LHDN TINs where known) and client memories. Times are relative to now, so follow-up timers are live.
"""
import json
import sqlite3
from datetime import datetime, timedelta
from typing import Any, Dict

from backend.database import TIME_FORMAT, now_time_str

REPS = [("Aina", 3.0), ("Ahmad", 3.0), ("Mei Ling", 3.0)]  # Aina is the Staff login in the demo

# Deal fields: id, customer, phone, rep, stage, items [(sku, qty)], and optional
# discount, created_h (hours ago), follow_up_h (hours from now; negative = overdue),
# follow_ups, paused, loss_reason, deposit_ref, deposit_amount, won_h (hours ago), notes.
PROFILES: Dict[str, Dict[str, Any]] = {
    "aircond": {
        "settings": {
            "company_name": "Sejuk Jaya Aircond Sdn Bhd",
            "ssm": "202401009921 (1554821-X)",
            "tin": "C2588190021",
            "framework": (
                "1. Standard installation labor: RM 250/unit.\n"
                "2. Extra copper piping: RM 150 per 3m set.\n"
                "3. Free delivery in the Klang Valley for orders above RM 3,000."
            ),
        },
        "products": [
            ("ACN-DAI-15", "Daikin 1.5HP Inverter Unit", 1150, 850),
            ("GAS-R32", "R32 Refrigerant Gas (3kg)", 180, 130),
            ("PIP-COP-3M", "Copper Pipe 3m Set", 150, 96),
        ],
        "customers": [
            ("Tan Bros Trading", "+60 12-345 6789", "C2088391020"),
            ("Wisma Perdana Sdn Bhd", "+60 12-998 4410", "C20991820"),
            ("Syarikat Bina Jaya", "+60 12-773 8810", "C21884920"),
            ("Klinik Dr. Lim", "+60 16-882 1920", "C20114892"),
            ("Restoran Selera Kampung", "+60 13-551 9022", "C20449102"),
            ("Kedai Runcit Ah Seng", "+60 19-221 0091", ""),
            ("Hotel Seri Alam", "+60 3-5511 2020", ""),
            ("Pusat Servis Jaya", "+60 17-660 3321", ""),
            ("Bengkel Maju Motor", "+60 11-2233 4455", ""),
        ],
        "deals": [
            dict(id="QT-2026-105", customer="Hotel Seri Alam", rep="Ahmad", stage="INQUIRY",
                 items=[("ACN-DAI-15", 2)], created_h=3,
                 notes="Called the office: wants 2x 1.5HP for guest rooms. Needs a quote."),
            dict(id="QT-2026-104", customer="Klinik Dr. Lim", rep="Mei Ling", stage="QUOTED",
                 items=[("ACN-DAI-15", 2)], created_h=60, follow_up_h=-12, paused=True,
                 notes="Paused: reported a leaking R32 cylinder from SO-2026-095. Clear once the replacement is sorted."),
            dict(id="QT-2026-103", customer="Wisma Perdana Sdn Bhd", rep="Aina", stage="QUOTED",
                 items=[("ACN-DAI-15", 2)], created_h=26, follow_up_h=22),
            dict(id="QT-2026-102", customer="Syarikat Bina Jaya", rep="Mei Ling", stage="QUOTED",
                 items=[("PIP-COP-3M", 2)], created_h=7, follow_up_h=41),
            dict(id="QT-2026-101", customer="Kedai Runcit Ah Seng", rep="Ahmad", stage="FOLLOW_UP",
                 items=[("ACN-DAI-15", 3)], created_h=50, follow_up_h=-2, follow_ups=1,
                 notes="Said 'transfer deposit tomorrow' two days ago."),
            dict(id="QT-2026-099", customer="Tan Bros Trading", rep="Aina", stage="WON",
                 items=[("ACN-DAI-15", 3), ("GAS-R32", 3)], discount=90, created_h=40, won_h=30,
                 deposit_ref="DN-20261021-88310", deposit_amount=1560, notes="Rounded down to RM 3,900."),
            dict(id="QT-2026-098", customer="Restoran Selera Kampung", rep="Aina", stage="WON",
                 items=[("ACN-DAI-15", 1), ("PIP-COP-3M", 2)], created_h=80, won_h=50,
                 deposit_ref="DN-20261020-55190", deposit_amount=580),
            dict(id="QT-2026-097", customer="Bengkel Maju Motor", rep="Ahmad", stage="WON",
                 items=[("GAS-R32", 6)], created_h=110, won_h=90, notes="Cash on delivery."),
            dict(id="QT-2026-095", customer="Klinik Dr. Lim", rep="Mei Ling", stage="WON",
                 items=[("ACN-DAI-15", 4), ("GAS-R32", 4)], created_h=200, won_h=150,
                 deposit_ref="DN-20261016-44120", deposit_amount=2128),
            dict(id="QT-2026-092", customer="Pusat Servis Jaya", rep="Ahmad", stage="LOST",
                 items=[("GAS-R32", 5)], created_h=150, follow_ups=3, loss_reason="Competitor price"),
        ],
        "memories": [
            ("Tan Bros Trading", "+60 12-345 6789", "VIP_FAST_PAYER", 94,
             "Friendly Manglish boss style ('Boss, got stock?') · Likes fast, itemised quotes",
             "⭐⭐⭐⭐⭐ Repeat buyer · 6 past orders (RM 28,400) · Usually confirms within 2 hours of a quote",
             6, 28400, "Boss, got 5 units Daikin 1.5HP and 5 bottles R32 gas? How much ah?"),
            ("Klinik Dr. Lim", "+60 16-882 1920", "LONG_TERM_PARTNER", 88,
             "Polite and professional clinic · Values fast aftersales and a respectful tone",
             "⭐⭐⭐⭐ Reliable buyer · 4 past orders (RM 19,200) · Open complaint about a leaking R32 cylinder",
             4, 19200, "One of the R32 gas cylinders you delivered is leaking at the valve."),
            ("Kedai Runcit Ah Seng", "+60 19-221 0091", "SLOW_PAYER_GHOST_RISK", 42,
             "Short casual messages · Often asks for a quote then goes quiet",
             "⚠️ Goes quiet after quotes · 2 past quotes lost to no reply · Follow up early",
             1, 1150, "Hold 3 units Daikin 1.5HP for me first boss, I transfer deposit tomorrow."),
            ("Wisma Perdana Sdn Bhd", "+60 12-998 4410", "PARTIAL_SHORT_PAYER", 58,
             "Corporate procurement · Often asks for RM 100–200 off before confirming",
             "⚠️ Haggles on most quotes · 3 past orders (RM 9,600) · Check the margin before giving a discount",
             3, 9600, "Can do better price for 2 units?"),
        ],
        "logs": [
            "09:00 AM · [System] Loaded Sejuk Jaya demo: 3 reps, 10 deals.",
            "09:51 AM · [Mei Ling] Paused follow-ups for Klinik Dr. Lim (leaking R32 cylinder reported).",
            "10:30 AM · [System] Quote #QT-2026-101 (Kedai Runcit Ah Seng) had no reply in time → follow-up due.",
        ],
    },
    "fnb": {
        "settings": {
            "company_name": "Kopi & Bakery Wholesale Sdn Bhd",
            "framework": (
                "1. Wholesale items use catalogue carton/bag pricing.\n"
                "2. Cold-chain delivery: RM 50 per trip, FREE for orders above RM 1,500.\n"
                "3. Urgent same-day lorry dispatch: +RM 120."
            ),
        },
        "products": [
            ("BEAN-ARA-5K", "Arabica Coffee Beans (5kg Bag)", 260, 180),
            ("MLK-OAT-CTN", "Barista Oat Milk (Carton 12x1L)", 135, 90),
            ("CUP-PAP-8OZ", "Paper Cup 8oz (Carton of 1,000)", 120, 78),
        ],
        "customers": [
            ("Cafe Hipster KL", "+60 17-998 1122", "C21455667780"),
            ("Urban Roasters TTDI", "+60 18-332 5590", ""),
            ("Kopi Corner Bangsar", "+60 12-447 8890", ""),
            ("Bistro Bintang", "+60 13-441 2290", ""),
            ("Daily Roast Cafe", "+60 18-771 9022", ""),
        ],
        "deals": [
            dict(id="QT-2026-303", customer="Kopi Corner Bangsar", rep="Ahmad", stage="INQUIRY",
                 items=[("CUP-PAP-8OZ", 3)], created_h=2, notes="Walked in: asked for paper cup prices."),
            dict(id="QT-2026-302", customer="Urban Roasters TTDI", rep="Mei Ling", stage="FOLLOW_UP",
                 items=[("BEAN-ARA-5K", 6), ("MLK-OAT-CTN", 10)], created_h=55, follow_up_h=-7),
            dict(id="QT-2026-301", customer="Cafe Hipster KL", rep="Aina", stage="QUOTED",
                 items=[("BEAN-ARA-5K", 4)], created_h=18, follow_up_h=30),
            dict(id="QT-2026-296", customer="Cafe Hipster KL", rep="Aina", stage="WON",
                 items=[("BEAN-ARA-5K", 5), ("CUP-PAP-8OZ", 2)], created_h=120, won_h=100,
                 deposit_ref="DN-20261018-66102", deposit_amount=616),
            dict(id="QT-2026-295", customer="Bistro Bintang", rep="Ahmad", stage="WON",
                 items=[("MLK-OAT-CTN", 10)], created_h=60, won_h=40,
                 deposit_ref="DN-20261020-77319", deposit_amount=540),
            dict(id="QT-2026-290", customer="Daily Roast Cafe", rep="Mei Ling", stage="LOST",
                 items=[("BEAN-ARA-5K", 4)], created_h=170, follow_ups=3, loss_reason="No reply"),
        ],
        "memories": [
            ("Cafe Hipster KL", "+60 17-998 1122", "POPULAR_CAFE_PARTNER", 92,
             "High-volume specialty cafe · Values fast delivery and fresh beans",
             "⭐⭐⭐⭐⭐ Repeat buyer · 8 past orders (RM 16,800) · Reorders beans about every 2 weeks",
             8, 16800, "Can quote 4 bags of Arabica 5kg with cold delivery?"),
            ("Bistro Bintang", "+60 13-441 2290", "GROWING_RESTAURANT", 80,
             "Casual dining restaurant · Orders beverage supplies monthly",
             "⭐⭐⭐⭐ Reliable buyer · 3 past orders (RM 5,400)",
             3, 5400, "Need 10x Oat Milk Carton delivered today."),
            ("Urban Roasters TTDI", "+60 18-332 5590", "POPULAR_CAFE_PARTNER", 90,
             "Artisan roastery · Friendly tone · Needs early-morning deliveries",
             "⭐⭐⭐⭐⭐ Repeat buyer · 8 past orders (RM 16,800) · Slow to reply on big quotes",
             8, 16800, "Let me check with my partner first boss."),
        ],
        "logs": [
            "10:00 AM · [System] Loaded Kopi & Bakery demo: 3 reps, 6 deals.",
        ],
    },
}

PROFILE_NAMES = {k: v["settings"]["company_name"] for k, v in PROFILES.items()}


def seed_profile(conn: sqlite3.Connection, preset: str) -> None:
    """Fills an empty database with one demo business. Amounts are computed here from the price list."""
    p = PROFILES[preset]
    now = datetime.now()
    at = lambda hours: (now + timedelta(hours=hours)).strftime(TIME_FORMAT)  # noqa: E731
    ts = now_time_str()

    for k, v in p["settings"].items():
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, v))
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('sme_preset', ?)", (preset,))

    conn.executemany("INSERT INTO products (sku, name, sell_price, unit_cost) VALUES (?, ?, ?, ?)", p["products"])
    conn.executemany("INSERT INTO reps (name, commission_pct) VALUES (?, ?)", REPS)
    rep_ids = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM reps").fetchall()}
    products = {sku: (name, price) for sku, name, price, _cost in p["products"]}
    phones = {name: phone for name, phone, _tin in p["customers"]}

    for d in p["deals"]:
        items = [{"sku": sku, "name": products[sku][0], "qty": qty, "unitPrice": products[sku][1]} for sku, qty in d["items"]]
        discount = d.get("discount", 0)
        won = d["stage"] == "WON"
        conn.execute(
            """
            INSERT INTO deals (id, order_no, customer, phone, rep_id, stage, items_json, discount, amount,
                               follow_up_at, follow_up_count, paused, loss_reason, deposit_ref, deposit_amount,
                               notes, created_at, won_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                d["id"],
                d["id"].replace("QT-", "SO-") if won else None,
                d["customer"],
                phones.get(d["customer"], ""),
                rep_ids[d["rep"]],
                d["stage"],
                json.dumps(items),
                discount,
                sum(i["qty"] * i["unitPrice"] for i in items) - discount,
                at(d["follow_up_h"]) if "follow_up_h" in d else None,
                d.get("follow_ups", 0),
                1 if d.get("paused") else 0,
                d.get("loss_reason", ""),
                d.get("deposit_ref", ""),
                d.get("deposit_amount"),
                d.get("notes", ""),
                at(-d["created_h"]),
                at(-d["won_h"]) if won else None,
            ),
        )

    conn.executemany(
        "INSERT INTO customers (name, phone, tin, ssm_brn, updated_at) VALUES (?, ?, ?, '', ?)",
        [(name, phone, tin, ts) for name, phone, tin in p["customers"]],
    )
    conn.executemany(
        """
        INSERT INTO client_memories (customer, phone, tier, score, style_summary, payment_behavior,
                                     total_orders, total_paid_rm, last_message, recent_history_json,
                                     cached_analysis_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '', ?)
        """,
        [m + (ts,) for m in p["memories"]],
    )
    for entry in p["logs"]:
        conn.execute("INSERT INTO audit_logs (entry, created_at) VALUES (?, ?)", (entry, ts))
