"""Unit tests for WhatsApp Sales Sidekick deterministic Layer B tools and routes."""
import pytest
from conftest import OWNER, STAFF


def test_sidekick_search_products(client):
    r = client.get("/api/v1/sidekick/products?query=daikin")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    item = next(p for p in data if "DAI" in p["sku"].upper())
    assert item["sku"] == "ACN-DAI-15"
    assert item["sell_price"] == 1150
    assert "available_stock" in item
    assert "ready_stock" in item


def test_sidekick_prepare_and_calculate_order(client):
    # Test prepare-order
    prep_req = {
        "customer": "Restoran Selera",
        "phone": "+60 12-333 4444",
        "items": [{"name": "Daikin 1.5hp", "qty": 3}],
        "delivery_area": "Subang Jaya",
        "notes": "Urgent installation",
    }
    r_prep = client.post("/api/v1/sidekick/prepare-order", json=prep_req)
    assert r_prep.status_code == 200
    prep_data = r_prep.json()
    assert prep_data["customer"] == "Restoran Selera"
    assert len(prep_data["items"]) == 1
    assert prep_data["items"][0]["sku"] == "ACN-DAI-15"
    assert prep_data["items"][0]["qty"] == 3
    assert prep_data["subtotal"] == 3 * 1150
    assert prep_data["ready_to_quote"] is True

    # Test calculate-quote
    calc_req = {
        "items": prep_data["items"],
        "discount_pct": 5.0,
        "delivery_fee": 50.0,
    }
    r_calc = client.post("/api/v1/sidekick/calculate-quote", json=calc_req)
    assert r_calc.status_code == 200
    calc_data = r_calc.json()
    assert calc_data["subtotal"] == 3450
    assert calc_data["discount_rm"] == round(3450 * 0.05)
    expected_total = 3450 - round(3450 * 0.05) + 50
    assert calc_data["total_payable"] == expected_total
    assert calc_data["deposit_required"] == round(expected_total * 0.40)


def test_sidekick_commitments_lifecycle(client):
    # Save a commitment
    save_req = {
        "phone": "+60 19-887 6655",
        "customer": "Encik Razak",
        "promise_text": "Will transfer deposit by 3pm tomorrow",
        "due_date": "2026-10-24 15:00:00",
        "party": "customer",
    }
    r_save = client.post("/api/v1/sidekick/commitments", json=save_req)
    assert r_save.status_code == 200
    saved = r_save.json()
    assert saved["id"] > 0
    assert saved["customer"] == "Encik Razak"
    assert saved["status"] == "pending"

    # Query commitments
    r_get = client.get("/api/v1/sidekick/commitments?customer=Razak")
    assert r_get.status_code == 200
    comms = r_get.json()
    assert any(c["id"] == saved["id"] for c in comms)


def test_sidekick_match_transaction(client):
    # Klinik Dr. Lim has an open QUOTED deal (QT-2026-103) with amount 2300 (40% = 920)
    match_req = {
        "amount": 920.0,
        "ref_id": "TEST-MB-999",
        "phone_or_customer": "Klinik Dr. Lim",
    }
    r_match = client.post("/api/v1/sidekick/match-transaction", json=match_req)
    assert r_match.status_code == 200
    data = r_match.json()
    assert data["matched"] is True
    assert data["match_status"] == "EXACT_DEPOSIT_MATCH"
    assert data["is_duplicate_ref"] is False
