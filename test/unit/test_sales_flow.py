"""Unit tests for Sales Flow Engine: deal context, stage derivation, quotation handshake,
catalog-backed recommendations and comparison."""

import pytest
from backend.services.sales_flow import (
    build_deal_context,
    next_best_action,
    generate_fallback_replies,
)
from backend.services.product_knowledge import recommend, compare, calculate_quote_preview


class MockProduct:
    def __init__(self, sku, name, sell_price, unit_cost=500, specs=None):
        self.sku = sku
        self.name = name
        self.sell_price = sell_price
        self.unit_cost = unit_cost
        self.specs = specs or {}


@pytest.fixture
def catalog_products():
    return [
        MockProduct("ACN-DAI-10", "Daikin 1.0HP Inverter Unit", 950, specs={
            "brand": "Daikin", "category": "aircond", "hp": 1.0, "room_sqft": [80, 150], "best_for": "small bedroom"
        }),
        MockProduct("ACN-DAI-15", "Daikin 1.5HP Inverter Unit", 1150, specs={
            "brand": "Daikin", "category": "aircond", "hp": 1.5, "room_sqft": [150, 250], "best_for": "master bedroom"
        }),
        MockProduct("ACN-DAI-20", "Daikin 2.0HP Inverter Unit", 1750, specs={
            "brand": "Daikin", "category": "aircond", "hp": 2.0, "room_sqft": [250, 400], "best_for": "living room"
        }),
        MockProduct("ACN-PAN-10", "Panasonic 1.0HP Aero Series", 980, specs={
            "brand": "Panasonic", "category": "aircond", "hp": 1.0, "room_sqft": [80, 150], "best_for": "bedroom nanoe-X"
        }),
        MockProduct("ACN-PAN-15", "Panasonic 1.5HP Aero Series", 1200, specs={
            "brand": "Panasonic", "category": "aircond", "hp": 1.5, "room_sqft": [150, 250], "best_for": "master bedroom"
        }),
        MockProduct("ACN-MID-10", "Midea 1.0HP Standard Split", 790, specs={
            "brand": "Midea", "category": "aircond", "hp": 1.0, "room_sqft": [80, 150], "best_for": "budget rental"
        }),
        MockProduct("SVC-INSTALL", "Standard Installation Labor", 250, specs={
            "brand": "Sejuk Jaya", "category": "service"
        }),
        MockProduct("GAS-R32", "R32 Refrigerant Gas (3kg)", 180, specs={
            "category": "consumable"
        }),
        MockProduct("PIP-COP-3M", "Copper Pipe 3m Set", 150, specs={
            "category": "part"
        }),
    ]


def test_greeting_leads_to_discovery(catalog_products):
    ctx = build_deal_context("Tan Bros", "+60123456789", [], "Hi", catalog_products)
    assert ctx.stage == "DISCOVERY"
    action = next_best_action(ctx, catalog_products)
    assert action["actionType"] in ("REPLY_ONLY", "NO_ACTION")
    assert "room size" in action["coachTip"].lower() or "exploring" in action["coachTip"].lower()


def test_model_interest_triggers_offer_quote_handshake(catalog_products):
    msgs = [{"sender": "ME", "text": "Hello Boss! May I know your room size?"}]
    ctx = build_deal_context("Tan Bros", "+60123456789", msgs, "I want a daikin 1.5hp", catalog_products)
    assert ctx.stage == "READY_TO_QUOTE"
    assert len(ctx.items) == 1
    assert ctx.items[0]["sku"] == "ACN-DAI-15"

    action = next_best_action(ctx, catalog_products)
    assert action["actionType"] == "OFFER_QUOTE"
    assert "prepare quotation" in action["btnLabel"].lower() or "offer" in action["btnLabel"].lower()

    replies = generate_fallback_replies(ctx, action, catalog_products)
    assert any("quotation" in r["text"].lower() or "sebut harga" in r["text"].lower() for r in replies)


def test_quote_offer_followed_by_affirmation_advances_to_quote_confirmed(catalog_products):
    msgs = [
        {"sender": "Them", "text": "I want a daikin 1.5hp"},
        {"sender": "ME", "text": "Boleh Boss, stok ready. Nak saya buka sebut harga rasmi siap upah pemasangan?"},
    ]
    ctx = build_deal_context("Tan Bros", "+60123456789", msgs, "ok boss", catalog_products)
    assert ctx.stage == "QUOTE_CONFIRMED"

    action = next_best_action(ctx, catalog_products)
    assert action["actionType"] == "CREATE_QUOTE"
    assert action["quotePreview"] is not None
    # 1150 (unit) + 250 (install) = 1400
    assert action["quotePreview"]["total"] in (1150, 1400)


def test_explicit_quote_request_directly_confirms(catalog_products):
    ctx = build_deal_context("Tan Bros", "+60123456789", [], "Quote me 2 units Daikin 1.5hp", catalog_products)
    assert ctx.stage == "QUOTE_CONFIRMED"
    assert ctx.items[0]["qty"] == 2
    assert ctx.items[0]["sku"] == "ACN-DAI-15"

    action = next_best_action(ctx, catalog_products)
    assert action["actionType"] == "CREATE_QUOTE"
    assert action["quotePreview"]["subtotal"] >= 2300


def test_room_sqft_recommends_correct_hp_from_catalog(catalog_products):
    ctx = build_deal_context("Tan Bros", "+60123456789", [], "my room is 300 sqft, what should i use?", catalog_products)
    assert ctx.stage == "RECOMMEND"
    assert ctx.needs.get("room_sqft") == 300
    assert len(ctx.recommended) > 0
    # 300 sqft should recommend 2.0HP
    top_sku = ctx.recommended[0].sku
    assert "20" in top_sku or ctx.recommended[0].specs.get("hp") == 2.0


def test_compare_daikin_and_panasonic(catalog_products):
    comp = compare(["ACN-DAI-15", "ACN-PAN-15"], catalog_products)
    assert len(comp["rows"]) == 2
    skus = [r["sku"] for r in comp["rows"]]
    assert "ACN-DAI-15" in skus
    assert "ACN-PAN-15" in skus
    assert any("RM 1,150" in r["price"] for r in comp["rows"])
    assert any("RM 1,200" in r["price"] for r in comp["rows"])


def test_no_hallucinated_prices_in_replies(catalog_products):
    ctx = build_deal_context("Tan Bros", "+60123456789", [], "Daikin 1.5HP with install", catalog_products)
    action = next_best_action(ctx, catalog_products)
    replies = generate_fallback_replies(ctx, action, catalog_products)
    allowed_prices = {950, 980, 1150, 1200, 1400, 1750, 790, 250, 180, 150, 560}
    import re
    for r in replies:
        matches = re.findall(r"RM\s*([\d,]+)", r["text"])
        for m in matches:
            val = int(m.replace(",", ""))
            assert val in allowed_prices, f"Found unauthorized price RM {val} in reply: {r['text']}"


# ---- signals in Malay and Manglish (each pattern once silently matched nothing: a literal backspace replaced \b)

def test_sales_flow_source_has_no_control_characters():
    import pathlib
    import backend.services.sales_flow as sf
    assert bytes([8]) not in pathlib.Path(sf.__file__).read_bytes()


@pytest.mark.parametrize("message, signal", [
    ("Nak dapat 30% diskaun boleh tak", "DISCOUNT_REQUEST"),
    ("can give best price?", "DISCOUNT_REQUEST"),
    ("tak nak lah, mahal sangat", "DECLINE"),
    ("Dah bank in, ni slip", "PAYMENT_PROOF"),
    ("Aircond bocor air", "COMPLAINT"),
    ("TIN: C21884920000", "LHDN_TIN"),
])
def test_signals_are_detected(catalog_products, message, signal):
    assert signal in build_deal_context("Ali", "", [], message, catalog_products).signals


def test_boleh_tak_is_a_question_not_a_yes_or_a_no(catalog_products):
    quote = {"sender": "ME", "text": "Quotation for 3x Daikin 1.5HP Inverter Unit is RM 3,450. Would you like to proceed?"}
    ctx = build_deal_context("Ali", "", [quote], "Nak dapat 30% diskaun boleh tak", catalog_products,
                             open_deal={"id": "QT-1", "stage": "QUOTED"})
    assert ctx.signals == ["DISCOUNT_REQUEST"]
    assert ctx.stage == "NEGOTIATING"  # not "awaiting payment" (a yes) and not "lost" (a no)
    assert "AFFIRMATIVE" not in build_deal_context("Ali", "", [], "Boleh tak hantar esok", catalog_products).signals
    assert "AFFIRMATIVE" in build_deal_context("Ali", "", [], "Ok boleh, proceed", catalog_products).signals
