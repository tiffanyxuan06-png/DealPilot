"""Owner-only CANCEL_WON: a won order goes to LOST, its commission is reversed and the CSV drops it."""
import csv
import io
from datetime import datetime

from sqlalchemy import text

from backend.db import get_engine
from conftest import OWNER, STAFF

WON = "QT-2026-099"  # Tan Bros Trading, RM 3,900, order SO-2026-099, rep Aina (3%)


def act(client, deal_id, who=OWNER, **body):
    """Sends CANCEL_WON for a deal as `who` (Owner by default) and returns the raw response."""
    return client.post(f"/api/deals/{deal_id}/action", json={**who, "action": "CANCEL_WON", **body})


def state(client):
    """The Owner's /api/state, so every rep and deal is visible."""
    return client.get("/api/state", params=OWNER).json()


def deal(s, deal_id=WON):
    """The deal with this id (the seeded won order by default)."""
    return next(d for d in s["deals"] if d["id"] == deal_id)


def aina(s):
    """Aina's rep entry: she owns the seeded won order QT-2026-099."""
    return next(r for r in s["reps"] if r["name"] == "Aina")


def csv_orders(client):
    """The order numbers in the won-orders CSV the accountant would download."""
    text = client.get("/api/export/orders.csv", params=OWNER).content.decode("utf-8-sig")
    return {r["Order_ID"] for r in csv.DictReader(io.StringIO(text))}


def test_staff_cannot_cancel(client):
    """Staff get 403, and the deal, the log and the approval queue stay unchanged."""
    before = state(client)
    r = act(client, WON, STAFF, reason="x")
    assert r.status_code == 403 and r.json()["detail"] == "Only the Owner can do this: Cancel a won order."
    after = state(client)
    assert deal(after)["stage"] == "WON" and after["logs"] == before["logs"] and after["approvals"] == before["approvals"]


def test_staff_on_missing_deal_gets_403_not_404(client):
    """Staff get 403 even for a deal that doesn't exist, so the answer reveals nothing."""
    assert act(client, "NOPE", STAFF, reason="x").status_code == 403


def test_needs_reason(client):
    """A cancel without a reason (or with only spaces) is refused and the order stays won."""
    assert act(client, WON).status_code == 400
    assert act(client, WON, reason="   ").status_code == 400
    assert deal(state(client))["stage"] == "WON"


def test_only_won_deals(client):
    """Only won orders can be cancelled: open and lost deals give 409, unknown ids 404."""
    assert act(client, "QT-2026-101", reason="x").status_code == 409  # open
    assert act(client, "NOPE", reason="x").status_code == 404
    client.post("/api/deals/QT-2026-102/action", json={**OWNER, "action": "MARK_LOST", "reason": "Price"})
    assert act(client, "QT-2026-102", reason="x").status_code == 409  # lost, not won


def test_owner_cancels_won_order(client):
    """Cancelling moves the order to LOST, reverses this month's commission, logs it and drops it from the CSV."""
    before = state(client)
    this_month = deal(before)["wonAt"].startswith(datetime.now().strftime("%Y-%m"))
    drop_commission, drop_won = (round(3900 * 0.03), 3900) if this_month else (0, 0)
    assert "SO-2026-099" in csv_orders(client)

    s = act(client, WON, reason="Customer cancelled the project").json()["state"]
    d = deal(s)
    assert d["stage"] == "LOST" and d["lossReason"] == "Cancelled after win: Customer cancelled the project"
    assert d["orderNo"] == "SO-2026-099" and d["wonAt"] == deal(before)["wonAt"]
    assert aina(s)["commissionRm"] == aina(before)["commissionRm"] - drop_commission
    assert aina(s)["wonRm"] == aina(before)["wonRm"] - drop_won
    assert "SO-2026-099" not in csv_orders(client)

    line = next(x for x in s["logs"] if "Cancelled won order SO-2026-099" in x)
    assert "[OWNER] Cancelled won order SO-2026-099 (#QT-2026-099, Tan Bros Trading): Customer cancelled the project" in line
    assert ("est. commission RM 117 reversed for Aina" if this_month else "won in an earlier month") in line
    assert s["pipeline"]["lossReasons"]["Cancelled after win"] == 1


def test_cancel_order_won_in_an_earlier_month(client):
    """An order won in an earlier month leaves this month's commission alone, and the log says so."""
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE deals SET won_at = '2020-01-15 10:00:00' WHERE id = :id"), {"id": WON})
    before = state(client)
    s = act(client, WON, reason="Stock never arrived").json()["state"]
    assert deal(s)["stage"] == "LOST" and aina(s)["commissionRm"] == aina(before)["commissionRm"]
    assert aina(s)["wonRm"] == aina(before)["wonRm"]
    line = next(x for x in s["logs"] if "Cancelled won order SO-2026-099" in x)
    assert "won in an earlier month, so this month's commission for Aina is unchanged" in line and "reversed" not in line


def test_cancelled_deal_is_lost_for_further_actions(client):
    """A cancelled order is settled like any lost deal: only the TIN can still change."""
    assert act(client, WON, reason="x").status_code == 200
    assert client.post(f"/api/deals/{WON}/action", json={**OWNER, "action": "MARK_WON"}).status_code == 409
    assert act(client, WON, reason="again").status_code == 409
    assert client.post(f"/api/deals/{WON}/action", json={**OWNER, "action": "SET_TIN", "tin": "C29988776650"}).status_code == 200


def test_not_a_staff_setting(client):
    """Cancelling is Owner only, so it is listed as Owner-only and absent from the Staff settings."""
    perms = client.get("/api/state").json()["permissions"]
    assert "deal.cancel_won" not in {a["key"] for a in perms["actions"]}
    assert "Cancel a won order" in perms["ownerOnly"]
    assert any("cancel a won order" in rule for rule in perms["mandatoryRules"])
