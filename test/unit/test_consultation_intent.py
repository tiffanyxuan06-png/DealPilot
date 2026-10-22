"""Test for consultative product advice inquiries vs buying quotes."""
from conftest import OWNER


def test_consultative_product_advice_does_not_quote(client):
    req = {
        "customer": "Tan Bros Trading",
        "phone": "+60 12-345 6789",
        "message": "How good is daikin aircond",
        "recentMessages": [
            {"from": "customer", "time": "10:00 AM", "text": "hi"},
            {"from": "customer", "time": "10:01 AM", "text": "How good is daikin aircond"},
        ],
    }
    r = client.post("/api/whatsapp/analyze", json=req)
    assert r.status_code == 200
    res = r.json()
    analysis = res["analysis"]

    # Must be PRODUCT_CONSULTATION and REPLY_ONLY, NOT CREATE_QUOTE!
    assert analysis["intent"] == "PRODUCT_CONSULTATION"
    assert analysis["extActionType"] == "REPLY_ONLY"
    assert "Reply" in analysis["extBtnLabel"]
    assert "Send Quote" not in analysis["extBtnLabel"]
    assert analysis["amount"] == 0
    assert "Daikin" in analysis["extDraft"]
    assert any(term in analysis["extDraft"].lower() for term in ["room", "ruang", "saiz", "size", "hp", "horsepower", "inverter"])


def test_specific_quote_request_does_quote(client):
    req = {
        "customer": "Tan Bros Trading",
        "phone": "+60 12-345 6789",
        "message": "Quote me 2 units Daikin 1.5hp",
    }
    r = client.post("/api/whatsapp/analyze", json=req)
    assert r.status_code == 200
    res = r.json()
    analysis = res["analysis"]
    assert analysis["intent"] == "BUYING_INQUIRY"
    assert analysis["extActionType"] == "CREATE_QUOTE"
    assert analysis["amount"] == 2 * 1150
