"""Sales deals: inquiry → quote → follow-up → won / lost. Every amount is priced by code from the price list."""
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

from backend.database import (
    OPEN_STAGES,
    PIPELINE_STAGES,
    add_log,
    build_state_payload,
    deal_commission,
    deal_margin_pct,
    follow_up_due_str,
    get_db,
    now_stamp,
    now_time_str,
)
from backend.models.schemas import DealActionRequest, DealCreateRequest, ProductUpsertRequest, ReassignRequest, RepUpsertRequest
from backend.services.customers import apply_tin, parse_tin, upsert_customer
from backend.services.permissions import enforce, margin_floor, normalize_role, register_handler, require_owner

router = APIRouter(tags=["Deals & Pipeline"])

BELOW_FLOOR = "Below the margin floor"  # shown to Staff, so it never states the margin %

ACTION_KEYS = {
    "SEND_QUOTE": "deal.create",
    "SEND_FOLLOW_UP": "deal.follow_up",
    "MARK_WON": "deal.won",
    "MARK_LOST": "deal.lost",
    "APPLY_DISCOUNT": "discount.apply",
    "PAUSE": "deal.pause",
    "RESUME": "deal.pause",
    "SET_TIN": "deal.set_tin",
}


def _fail(conn, status: int, detail: str) -> None:
    conn.close()
    raise HTTPException(status_code=status, detail=detail)


def price_items(conn, items) -> List[Dict[str, Any]]:
    """Looks every item up on the price list. The price always comes from here, never from the request."""
    priced = []
    for it in items:
        p = conn.execute("SELECT * FROM products WHERE UPPER(sku) = ?", (it.sku.strip().upper(),)).fetchone()
        if not p:
            _fail(conn, 404, f"{it.sku} is not on the price list.")
        priced.append({"sku": p["sku"], "name": p["name"], "qty": max(1, int(it.qty)), "unitPrice": p["sell_price"]})
    if not priced:
        _fail(conn, 400, "Add at least one item.")
    return priced


def subtotal(items: List[Dict[str, Any]]) -> int:
    return sum(i["qty"] * i["unitPrice"] for i in items)


def margin_of(conn, items: List[Dict[str, Any]], amount: int) -> float:
    costs = {r["sku"]: r["unit_cost"] for r in conn.execute("SELECT sku, unit_cost FROM products").fetchall()}
    return deal_margin_pct(items, amount, costs)


def default_rep_id(conn) -> Optional[int]:
    # ponytail: the demo has one Staff login, so new deals go to the first rep (Aina); link logins to reps for real teams.
    row = conn.execute("SELECT id FROM reps WHERE active = 1 ORDER BY id LIMIT 1").fetchone()
    return row["id"] if row else None


def next_deal_id(conn) -> str:
    nums = []
    for r in conn.execute("SELECT id FROM deals").fetchall():
        tail = r["id"].rsplit("-", 1)[-1]
        if tail.isdigit():
            nums.append(int(tail))
    return f"QT-{datetime.now().year}-{max(nums, default=100) + 1}"


def _rep(conn, rep_id: Optional[int]):
    return conn.execute("SELECT * FROM reps WHERE id = ?", (rep_id,)).fetchone() if rep_id is not None else None


@router.post("/api/deals")
def api_create_deal(req: DealCreateRequest) -> Dict[str, Any]:
    """Logs an inquiry (quote=False) or sends a quote. Staff need approval below the margin floor."""
    conn = get_db()
    role = normalize_role(req.role)
    customer = (req.customer or "").strip()
    if not customer:
        _fail(conn, 400, "Enter the customer's name.")
    items = price_items(conn, req.items)
    discount = max(0, req.discount or 0)
    if discount > subtotal(items):
        _fail(conn, 400, "The discount is bigger than the quote.")
    amount = subtotal(items) - discount
    rep_id = req.repId or default_rep_id(conn)
    rep = _rep(conn, rep_id)
    if not rep:
        _fail(conn, 404, "That sales rep does not exist.")
    below = margin_of(conn, items, amount) < margin_floor(conn)
    gate = enforce(
        conn,
        role,
        "deal.create",
        handler="deal_create",
        payload={"body": req.model_dump()},
        summary=f"{'Quote' if req.quote else 'Inquiry'} for {customer}: RM {amount:,}" + (f" (RM {discount:,} off)" if discount else ""),
        mandatory_reason=BELOW_FLOOR if below else None,
    )
    if gate:
        return gate

    deal_id = next_deal_id(conn)
    stage = "QUOTED" if req.quote else "INQUIRY"
    conn.execute(
        """
        INSERT INTO deals (id, customer, phone, rep_id, stage, items_json, discount, amount, follow_up_at, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            deal_id,
            customer,
            req.phone or "",
            rep["id"],
            stage,
            json.dumps(items),
            discount,
            amount,
            follow_up_due_str(conn) if req.quote else None,
            (req.notes or "").strip(),
            now_stamp(),
        ),
    )
    upsert_customer(conn, customer, now_time_str(), phone=req.phone or "")
    lines = ", ".join(f"{i['qty']}x {i['name']}" for i in items)
    add_log(
        conn,
        f"[{role}] {'Quoted' if req.quote else 'Logged inquiry'} #{deal_id} for {customer} ({rep['name']}): {lines} = RM {amount:,}"
        + (" · below the margin floor (Owner)" if below else "")
        + ".",
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "createdId": deal_id, "state": build_state_payload(role)}


@router.post("/api/deals/{deal_id}/action")
def api_deal_action(deal_id: str, req: DealActionRequest) -> Dict[str, Any]:
    conn = get_db()
    d = conn.execute("SELECT * FROM deals WHERE id = ?", (deal_id,)).fetchone()
    if not d:
        _fail(conn, 404, f"Deal {deal_id} not found")
    act = (req.action or "").upper()
    role = normalize_role(req.role)
    if act not in ACTION_KEYS:
        _fail(conn, 400, f"Unknown deal action {req.action}")
    if d["stage"] in ("WON", "LOST") and act != "SET_TIN":
        _fail(conn, 409, f"#{deal_id} is already {d['stage'].lower()}.")

    items = json.loads(d["items_json"] or "[]")
    who = f"#{deal_id} ({d['customer']})"
    mandatory = None
    new_discount = new_amount = None
    tin = None
    if act == "SEND_QUOTE" and d["stage"] != "INQUIRY":
        _fail(conn, 409, f"#{deal_id} has already been quoted.")
    if act == "SEND_FOLLOW_UP" and d["stage"] not in PIPELINE_STAGES:
        _fail(conn, 409, "Send the quote first.")
    if act == "MARK_LOST" and not (req.reason or "").strip():
        _fail(conn, 400, "Choose a reason the deal was lost (e.g. price, timing, competitor, no reply).")
    if act == "MARK_WON" and req.depositAmount is not None and req.depositAmount < 0:
        _fail(conn, 400, "The deposit amount cannot be negative.")
    if act == "APPLY_DISCOUNT":
        new_discount = max(0, req.discount or 0)
        if new_discount > subtotal(items):
            _fail(conn, 400, "The discount is bigger than the quote.")
        new_amount = subtotal(items) - new_discount
        if margin_of(conn, items, new_amount) < margin_floor(conn):
            mandatory = BELOW_FLOOR
    if act == "SET_TIN":
        tin = parse_tin(req.tin or "")
        if not tin:
            _fail(conn, 400, f"'{req.tin}' does not look like an LHDN TIN (e.g. C2588190021).")

    summary = {
        "SEND_QUOTE": f"Send quote {who}: RM {d['amount']:,}",
        "SEND_FOLLOW_UP": f"Send follow-up on {who}",
        "MARK_WON": f"Mark {who} won (RM {d['amount']:,})",
        "MARK_LOST": f"Mark {who} lost: {(req.reason or '').strip()}",
        "APPLY_DISCOUNT": f"Discount RM {new_discount or 0:,} on {who} (new total RM {new_amount or 0:,})",
        "PAUSE": f"Pause follow-ups on {who}",
        "RESUME": f"Resume follow-ups on {who}",
        "SET_TIN": f"Set LHDN TIN {tin} for {d['customer']}",
    }[act]
    gate = enforce(
        conn,
        role,
        ACTION_KEYS[act],
        handler="deal_action",
        payload={"path": {"deal_id": deal_id}, "body": req.model_dump()},
        summary=summary,
        mandatory_reason=mandatory,
    )
    if gate:
        return gate

    rep = _rep(conn, d["rep_id"])
    rep_name = rep["name"] if rep else "no rep"
    if act == "SEND_QUOTE":
        conn.execute("UPDATE deals SET stage = 'QUOTED', follow_up_at = ? WHERE id = ?", (follow_up_due_str(conn), deal_id))
        add_log(conn, f"[{role}] Sent quote {who}: RM {d['amount']:,}.")
    elif act == "SEND_FOLLOW_UP":
        count = d["follow_up_count"] + 1
        # Back to QUOTED: it is waiting for a reply again; FOLLOW_UP means a follow-up is due now.
        conn.execute(
            "UPDATE deals SET stage = 'QUOTED', follow_up_count = ?, follow_up_at = ? WHERE id = ?",
            (count, follow_up_due_str(conn), deal_id),
        )
        add_log(conn, f"[{role}] Sent follow-up {count} on {who}" + (" · no reply after 3 follow-ups: consider marking it lost" if count >= 3 else "") + ".")
    elif act == "MARK_WON":
        order_no = deal_id.replace("QT-", "SO-", 1)
        conn.execute(
            "UPDATE deals SET stage = 'WON', order_no = ?, won_at = ?, paused = 0, deposit_ref = ?, deposit_amount = ? WHERE id = ?",
            (order_no, now_stamp(), (req.depositRef or "").strip(), req.depositAmount, deal_id),
        )
        commission = deal_commission(d["amount"], rep["commission_pct"]) if rep else 0
        add_log(
            conn,
            f"[{role}] Won {who} → order {order_no}, RM {d['amount']:,}"
            + (f", customer's slip ref {req.depositRef.strip()}" if (req.depositRef or "").strip() else "")
            + f" · est. commission RM {commission:,} for {rep_name}.",
        )
    elif act == "MARK_LOST":
        conn.execute("UPDATE deals SET stage = 'LOST', loss_reason = ? WHERE id = ?", ((req.reason or "").strip(), deal_id))
        add_log(conn, f"[{role}] Marked {who} lost: {(req.reason or '').strip()}.")
    elif act == "APPLY_DISCOUNT":
        conn.execute("UPDATE deals SET discount = ?, amount = ? WHERE id = ?", (new_discount, new_amount, deal_id))
        add_log(
            conn,
            f"[{role}] Discount RM {new_discount:,} on {who} → RM {new_amount:,}"
            + (" · below the margin floor (Owner)" if mandatory else "")
            + ".",
        )
    elif act in ("PAUSE", "RESUME"):
        note = (req.note or "").strip()
        notes = d["notes"] or ""
        if note:
            notes = (notes + "\n" if notes else "") + f"{'Paused' if act == 'PAUSE' else 'Resumed'}: {note}"
        conn.execute("UPDATE deals SET paused = ?, notes = ? WHERE id = ?", (1 if act == "PAUSE" else 0, notes, deal_id))
        add_log(conn, f"[{role}] {'Paused' if act == 'PAUSE' else 'Resumed'} follow-ups on {who}" + (f": {note}" if note else "") + ".")
    elif act == "SET_TIN":
        open_ids = apply_tin(conn, d["customer"], tin, "", now_time_str())
        add_log(conn, f"[{role}] Saved LHDN TIN {tin} for {d['customer']}" + (f" (open deals: {', '.join('#' + i for i in open_ids)})" if open_ids else "") + ".")

    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload(role)}


@router.post("/api/reps")
def api_upsert_rep(req: RepUpsertRequest) -> Dict[str, Any]:
    conn = get_db()
    require_owner(req.role, "reps.manage", conn)
    name = (req.name or "").strip()
    if not name:
        _fail(conn, 400, "Enter the rep's name.")
    if not 0 <= req.commissionPct <= 50:
        _fail(conn, 400, "Commission must be between 0% and 50%.")
    clash = conn.execute("SELECT id FROM reps WHERE LOWER(name) = LOWER(?) AND id != ?", (name, req.id or -1)).fetchone()
    if clash:
        _fail(conn, 409, f"There is already a rep called {name}.")
    if req.id:
        if not _rep(conn, req.id):
            _fail(conn, 404, "That sales rep does not exist.")
        conn.execute(
            "UPDATE reps SET name = ?, commission_pct = ?, active = ? WHERE id = ?",
            (name, req.commissionPct, 1 if req.active else 0, req.id),
        )
        add_log(conn, f"[OWNER] Updated rep {name}: {req.commissionPct:g}% commission{'' if req.active else ', inactive'}.")
    else:
        conn.execute("INSERT INTO reps (name, commission_pct, active) VALUES (?, ?, ?)", (name, req.commissionPct, 1 if req.active else 0))
        add_log(conn, f"[OWNER] Added rep {name} ({req.commissionPct:g}% commission).")
    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload(req.role)}


@router.post("/api/reps/{rep_id}/reassign")
def api_reassign_rep(rep_id: int, req: ReassignRequest) -> Dict[str, Any]:
    """Moves a rep's open deals to another rep. Won deals stay, so commission history is kept."""
    conn = get_db()
    require_owner(req.role, "reps.reassign", conn)
    src, dst = _rep(conn, rep_id), _rep(conn, req.toRepId)
    if not src or not dst:
        _fail(conn, 404, "That sales rep does not exist.")
    if src["id"] == dst["id"]:
        _fail(conn, 400, "Choose a different rep to hand the customers to.")
    if not dst["active"]:
        _fail(conn, 400, f"{dst['name']} is not active.")
    marks = ",".join("?" for _ in OPEN_STAGES)
    moved = conn.execute(
        f"SELECT id, customer FROM deals WHERE rep_id = ? AND stage IN ({marks})", (src["id"], *OPEN_STAGES)
    ).fetchall()
    conn.execute(f"UPDATE deals SET rep_id = ? WHERE rep_id = ? AND stage IN ({marks})", (dst["id"], src["id"], *OPEN_STAGES))
    customers = sorted({r["customer"] for r in moved})
    add_log(
        conn,
        f"[OWNER] Reassigned {len(moved)} open deal(s) from {src['name']} to {dst['name']}"
        + (f": {', '.join(customers)}" if customers else "")
        + ".",
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "moved": [r["id"] for r in moved], "state": build_state_payload(req.role)}


@router.post("/api/products")
def api_upsert_product(req: ProductUpsertRequest) -> Dict[str, Any]:
    conn = get_db()
    require_owner(req.role, "pricelist.edit", conn)
    sku = (req.sku or "").strip().upper()
    name = (req.name or "").strip()
    if not sku or not name:
        _fail(conn, 400, "Every item needs a SKU and a name.")
    if req.sellPrice < 1 or req.unitCost < 0:
        _fail(conn, 400, "The price must be at least RM 1 and the cost cannot be negative.")
    conn.execute(
        """
        INSERT INTO products (sku, name, sell_price, unit_cost) VALUES (?, ?, ?, ?)
        ON CONFLICT(sku) DO UPDATE SET name = excluded.name, sell_price = excluded.sell_price, unit_cost = excluded.unit_cost
        """,
        (sku, name[:80], req.sellPrice, req.unitCost),
    )
    add_log(conn, f"[OWNER] Price list: {sku} {name} at RM {req.sellPrice:,}.")
    conn.commit()
    conn.close()
    return {"status": "ok", "state": build_state_payload(req.role)}


register_handler("deal_create", api_create_deal, DealCreateRequest)
register_handler("deal_action", api_deal_action, DealActionRequest, ["deal_id"])
