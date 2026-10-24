"""docs/19: the webapp holds no business data; everything it shows comes from the backend.

Demo data lives only in backend/schema/seeds/*.json. This fails if a company, rep, customer, product, SKU or
deal number from those files, an RM figure, or the old cash/stock profile code shows up in webapp/.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEBAPP = ROOT / "webapp"
SEEDS = ROOT / "backend" / "schema" / "seeds"
# Phase 3 moves the WhatsApp demo chats into the seeds (docs/19, option B); until then they are allowed here only.
ALLOWED = {WEBAPP / "js" / "demo_chats.js"}


def webapp_files():
    for path in sorted(WEBAPP.rglob("*")):
        if path.suffix in (".js", ".html") and "vendor" not in path.parts and path not in ALLOWED:
            yield path, path.read_text(encoding="utf-8")


def seed_values():
    values = set()
    for path in SEEDS.glob("*.json"):
        if path.stem == "defaults":
            continue
        seed = json.loads(path.read_text(encoding="utf-8"))
        values.add(seed["settings"]["company_name"])
        values |= {r["name"] for r in seed["reps"]}
        values |= {c["name"] for c in seed["customers"]}
        values |= {p["name"] for p in seed["products"]} | {p["sku"] for p in seed["products"]}
        values |= {d["id"] for d in seed["deals"]} | {d["customer"] for d in seed["deals"]}
    return {v for v in values if len(v) >= 4}  # skip very short names that match ordinary words


def test_no_seed_names_numbers_or_ids_in_webapp():
    found = [(p.relative_to(ROOT).as_posix(), v) for p, text in webapp_files() for v in seed_values() if v in text]
    assert not found, f"seed data hardcoded in the webapp: {found}"


def test_no_old_cash_and_stock_profile_code():
    found = [
        (p.relative_to(ROOT).as_posix(), word)
        for p, text in webapp_files()
        for word in ("smeProfiles", "cashOnHand", "st.stock", "st.invoices", "currentSME")
        if word in text
    ]
    assert not found, f"old offline profile code in the webapp: {found}"


def test_no_rm_figures_outside_placeholders():
    found = []
    for p, text in webapp_files():
        text = re.sub(r'placeholder="[^"]*"', "", text)  # hints like "e.g. RM 400 labour" are fine
        found += [(p.relative_to(ROOT).as_posix(), m) for m in re.findall(r"RM\s?[1-9][\d,.]*", text)]
    assert not found, f"RM amounts hardcoded in the webapp (they must come from the backend): {found}"
