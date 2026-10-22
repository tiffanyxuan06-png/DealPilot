"""Sales Flow Engine: deterministic conversation tracking, quotation handshake,
and sales coaching for WhatsApp copilot."""

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from backend.services.product_knowledge import (
    calculate_quote_preview,
    compare,
    recommend,
    upsell,
)

# Regex triggers
AFFIRMATIVE_WORDS = [
    "ok", "okay", "yes", "can", "boleh", "sure", "ya", "send", "go ahead",
    "proceed", "baik", "setuju", "on", "orait", "alright", "yep", "yup", "confirm"
]
AFFIRMATIVE_RE = re.compile(
    r"(?:^|\s|[.,!?;])(?:" + "|".join(re.escape(w) for w in AFFIRMATIVE_WORDS) + r")(?:$|\s|[.,!?;])|[👍👌]",
    re.IGNORECASE
)

EXPLICIT_QUOTE_RE = re.compile(
    r"(?:quote\s*me|quotation|sebut\s*harga|send\s*(?:me\s*)?quote|give\s*(?:me\s*)?quote|"
    r"buatkan\s*quote|buka\s*quote|open\s*quotation|generate\s*quote|how\s*much\s*for|"
    r"berapa\s*harga\s*untuk)",
    re.IGNORECASE
)

# Decline must use strict word boundary so 'tak' doesn't match 'take'
DECLINE_WORDS = ["no", "tak", "tak nak", "cancel", "mahal sangat", "dont want", "tak jadi", "batal", "not interested"]
DECLINE_RE = re.compile(
    r"(?:" + "|".join(re.escape(w) for w in DECLINE_WORDS) + r")",
    re.IGNORECASE
)

DISCOUNT_RE = re.compile(
    r"(discount|diskaun|murah\s*sikit|best\s*price|cheaper|less|kurang|potong|nego|kurangkan)",
    re.IGNORECASE
)

PAYMENT_RE = re.compile(
    r"(bank\s*in|bank-in|transferred|transfer|dah\s*bayar|dah\s*transfer|resit|receipt|slip|duitnow|paid|settle)",
    re.IGNORECASE
)

COMPLAINT_RE = re.compile(
    r"(rosak|bocor|leaking|not\s*cold|tak\s*sejuk|bising|noise|complaint|komplain|marah|problem|issue|masalah|pecah)",
    re.IGNORECASE
)

TIN_RE = re.compile(r"(TIN[:\s]+[A-Z0-9]+|SSM[:\s]+[A-Z0-9\-]+|C\d{10})", re.IGNORECASE)

COMPARE_RE = re.compile(
    r"(compare|versus|vs|mana\s*lagi\s*(?:elok|bagus)|which\s*is\s*better|difference|beza|apa\s*beza)",
    re.IGNORECASE
)

QUOTE_OFFER_KEYWORDS = [
    "quotation", "sebut harga", "quote", "prepare a quotation", "buka sebut harga",
    "nak quotation", "sediakan sebut harga", "formal quotation", "official quote"
]


@dataclass
class DealContext:
    customer: str
    phone: str
    stage: str
    items: List[Dict[str, Any]] = field(default_factory=list)
    needs: Dict[str, Any] = field(default_factory=dict)
    missing: List[str] = field(default_factory=list)
    signals: List[str] = field(default_factory=list)
    pending_offer: Optional[str] = None
    open_deal: Optional[Dict[str, Any]] = None
    recommended: List[Any] = field(default_factory=list)
    compare_data: Optional[Dict[str, Any]] = None
    last_customer_msg: str = ""
    last_my_msg: str = ""


def _get_item_prop(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        if key == "sell_price" and "sellPrice" in obj:
            return obj["sellPrice"]
        if key == "sellPrice" and "sell_price" in obj:
            return obj["sell_price"]
        return default
    return getattr(obj, key, default)


def _extract_product_slots(all_text: str, products: List[Any]) -> List[Dict[str, Any]]:
    """Scan conversation text to find mentioned products and quantities."""
    items = []
    text_lower = all_text.lower()

    sku_map = {_get_item_prop(p, "sku", ""): p for p in products}

    # Detect HP and Brand
    hp_matches = re.findall(r"(\d+(?:\.\d+)?)\s*(?:hp|horse\s*power|kuda)", text_lower)
    daikin_present = "daikin" in text_lower
    panasonic_present = "panasonic" in text_lower
    midea_present = "midea" in text_lower

    # Quantity check
    qty = 1
    qty_match = re.search(r"(\d+)\s*(?:units?|sets?|biji|buah|unit)", text_lower)
    if not qty_match:
        qty_match = re.search(r"(?:need|want|beli|order)\s+(\d+)", text_lower)
    if not qty_match:
        qty_match = re.search(r"(\d+)\s*x", text_lower)
    if qty_match:
        try:
            qty = max(1, int(qty_match.group(1)))
        except ValueError:
            qty = 1

    # Check if buying intent is present or just general consultation
    has_buy_intent = bool(qty_match or re.search(r"\b(need|want|beli|order|ambil|nak|beli|quote|sebut\s*harga|price|harga)\b", text_lower))
    is_pure_question = bool(re.search(r"\b(how\s*good|is\s+it\s+good|ok\s*tak|bagus\s*tak|review|what\s*is|mana\s*elok)\b", text_lower))

    matched_sku = None
    if hp_matches:
        hp_val = hp_matches[-1]
        if daikin_present or (not panasonic_present and not midea_present):
            if "1.5" in hp_val:
                matched_sku = "ACN-DAI-15"
            elif "2.0" in hp_val or "2" in hp_val:
                matched_sku = "ACN-DAI-20"
            elif "1.0" in hp_val or "1" in hp_val:
                matched_sku = "ACN-DAI-10"
        elif panasonic_present:
            if "1.5" in hp_val:
                matched_sku = "ACN-PAN-15"
            elif "1.0" in hp_val or "1" in hp_val:
                matched_sku = "ACN-PAN-10"
        elif midea_present:
            matched_sku = "ACN-MID-10"
    elif (has_buy_intent and not is_pure_question):
        if daikin_present:
            matched_sku = "ACN-DAI-15"
        elif panasonic_present:
            matched_sku = "ACN-PAN-15"
        elif midea_present:
            matched_sku = "ACN-MID-10"

    if matched_sku and matched_sku in sku_map:
        prod = sku_map[matched_sku]
        items.append({
            "sku": matched_sku,
            "name": _get_item_prop(prod, "name", matched_sku),
            "qty": qty,
            "price": int(_get_item_prop(prod, "sell_price", 0) or 0),
        })

    # Also check consumables / parts
    if "r32" in text_lower or "gas" in text_lower:
        if "GAS-R32" in sku_map and not any(it["sku"] == "GAS-R32" for it in items):
            g_qty = 1
            g_match = re.search(r"(\d+)\s*(?:bottles?|tanks?|tong|units?|sets?|x)?\s*(?:r32|gas)", text_lower)
            if not g_match:
                g_match = re.search(r"(?:r32|gas)[^\d]*(\d+)", text_lower)
            if g_match:
                try:
                    g_qty = max(1, int(g_match.group(1)))
                except ValueError:
                    g_qty = 1
            prod = sku_map["GAS-R32"]
            items.append({
                "sku": "GAS-R32",
                "name": _get_item_prop(prod, "name", "R32 Refrigerant Gas"),
                "qty": g_qty,
                "price": int(_get_item_prop(prod, "sell_price", 180) or 180),
            })

    if "copper" in text_lower or "piping" in text_lower or "paip" in text_lower:
        if "PIP-COP-3M" in sku_map and not any(it["sku"] == "PIP-COP-3M" for it in items):
            prod = sku_map["PIP-COP-3M"]
            items.append({
                "sku": "PIP-COP-3M",
                "name": _get_item_prop(prod, "name", "Copper Pipe 3m Set"),
                "qty": 1,
                "price": int(_get_item_prop(prod, "sell_price", 150) or 150),
            })

    return items


def build_deal_context(
    customer: str,
    phone: str,
    messages: List[Dict[str, str]],
    current_message: str,
    products: List[Any],
    open_deal: Optional[Dict[str, Any]] = None,
    cached_pending_offer: Optional[str] = None,
) -> DealContext:
    """Analyze full conversation history and synthesize deal context."""
    # Gather message texts
    all_customer_texts = []
    last_my_msg = ""
    last_customer_msg = current_message

    for m in messages:
        sender = m.get("sender") or m.get("role") or ""
        txt = m.get("text") or m.get("content") or ""
        if sender in ("Them", "customer", "user", "client"):
            all_customer_texts.append(txt)
            last_customer_msg = txt
        elif sender in ("ME", "assistant", "agent", "seller"):
            last_my_msg = txt

    if current_message and (not all_customer_texts or all_customer_texts[-1] != current_message):
        all_customer_texts.append(current_message)
        last_customer_msg = current_message

    full_chat_text = " ".join(all_customer_texts)
    latest_msg = last_customer_msg.strip()

    # Detect signals in latest customer message
    signals = []
    if AFFIRMATIVE_RE.search(latest_msg):
        signals.append("AFFIRMATIVE")
    if EXPLICIT_QUOTE_REQUEST := EXPLICIT_QUOTE_RE.search(latest_msg):
        signals.append("EXPLICIT_QUOTE_REQUEST")
    if DECLINE_RE.search(latest_msg):
        # Ensure decline isn't triggered if sentence is asking a positive question
        if not latest_msg.endswith("?"):
            signals.append("DECLINE")
    if DISCOUNT_RE.search(latest_msg):
        signals.append("DISCOUNT_REQUEST")
    if PAYMENT_RE.search(latest_msg):
        signals.append("PAYMENT_PROOF")
    if COMPLAINT_RE.search(latest_msg):
        signals.append("COMPLAINT")
    if TIN_RE.search(latest_msg):
        signals.append("LHDN_TIN")
    if COMPARE_RE.search(latest_msg) or "compare" in full_chat_text.lower():
        signals.append("COMPARING")

    # Detect installation
    install_needed = bool(re.search(r"(install|pasang|siap\s*pasang|installation)", full_chat_text, re.I))
    if install_needed:
        signals.append("INSTALL_MENTIONED")

    # Extract needs
    needs: Dict[str, Any] = {"install_needed": install_needed}
    sqft_match = re.search(r"(\d+)\s*(?:sqft|sq\s*ft|kaki\s*persegi|sf|kaki)", full_chat_text, re.I)
    if sqft_match:
        needs["room_sqft"] = int(sqft_match.group(1))

    hp_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:hp|horse\s*power|kuda)", full_chat_text, re.I)
    if hp_match:
        needs["hp"] = float(hp_match.group(1))

    if "daikin" in full_chat_text.lower():
        needs["brand"] = "Daikin"
    elif "panasonic" in full_chat_text.lower():
        needs["brand"] = "Panasonic"
    elif "midea" in full_chat_text.lower():
        needs["brand"] = "Midea"

    # Extract items
    items = _extract_product_slots(full_chat_text, products)

    # Detect missing
    missing = []
    if not items and "hp" not in needs and "room_sqft" not in needs:
        missing.append("cooling_needs_or_hp")
    if not items and ("hp" in needs or "room_sqft" in needs):
        missing.append("model_selection")

    # Determine pending offer
    pending_offer = cached_pending_offer
    if not pending_offer and last_my_msg:
        last_my_lower = last_my_msg.lower()
        if any(kw in last_my_lower for kw in QUOTE_OFFER_KEYWORDS) and "?" in last_my_msg:
            pending_offer = "QUOTE"

    # Get recommendations and comparison data
    recommended_prods = recommend(needs, products)

    compare_data = None
    if "COMPARING" in signals or len(items) > 1:
        compare_skus = [it["sku"] for it in items if it.get("sku")]
        if not compare_skus and recommended_prods:
            compare_skus = [_get_item_prop(p, "sku", "") for p in recommended_prods[:2]]
        compare_data = compare(compare_skus, products)

    ctx = DealContext(
        customer=customer,
        phone=phone,
        stage="NEW",
        items=items,
        needs=needs,
        missing=missing,
        signals=signals,
        pending_offer=pending_offer,
        open_deal=open_deal,
        recommended=recommended_prods,
        compare_data=compare_data,
        last_customer_msg=latest_msg,
        last_my_msg=last_my_msg,
    )
    ctx.stage = derive_stage(ctx)
    return ctx


def derive_stage(ctx: DealContext) -> str:
    """State machine deriving current deal stage from conversation context."""
    # Side states take precedence
    if "COMPLAINT" in ctx.signals:
        return "COMPLAINT"
    if "LHDN_TIN" in ctx.signals:
        return "LHDN_TIN"
    if "DECLINE" in ctx.signals:
        return "LOST"
    if "PAYMENT_PROOF" in ctx.signals:
        return "AWAITING_PAYMENT"

    # If there is already an active deal in pipeline
    if ctx.open_deal:
        deal_stage = (ctx.open_deal.get("stage") or "").upper()
        if "DISCOUNT_REQUEST" in ctx.signals:
            return "NEGOTIATING"
        if "AFFIRMATIVE" in ctx.signals:
            return "AWAITING_PAYMENT"
        if deal_stage in ("QUOTED", "FOLLOW_UP_DUE"):
            return "QUOTED"
        if deal_stage:
            return deal_stage

    # Pre-deal flow (Handshake logic)
    # 1. Did we offer a quote and customer affirmed?
    if ("AFFIRMATIVE" in ctx.signals) and (ctx.pending_offer == "QUOTE"):
        return "QUOTE_CONFIRMED"

    # 2. Did customer explicitly command a quote? ("quote me 2 units...")
    if "EXPLICIT_QUOTE_REQUEST" in ctx.signals and ctx.items:
        return "QUOTE_CONFIRMED"

    # If customer explicitly asks for discount on identified items
    if "DISCOUNT_REQUEST" in ctx.signals:
        return "NEGOTIATING"

    # 3. Customer has chosen/specified a model
    if ctx.items:
        # Check if staff's very last message already offered quotation and we're waiting
        if ctx.pending_offer == "QUOTE":
            return "QUOTE_OFFERED"
        return "READY_TO_QUOTE"

    # 4. Comparing models or evaluating needs
    if "COMPARING" in ctx.signals or "room_sqft" in ctx.needs:
        return "RECOMMEND"

    # 5. Casual chat or personal check-in
    msg = ctx.last_customer_msg.lower()
    casual_words = ["teh tarik", "lunch", "dinner", "makan", "minum", "kopi", "borak", "lepak", "free tak", "later"]
    if any(cw in msg for cw in casual_words):
        return "CASUAL"

    if msg in ("hi", "hello", "hai", "salam", "morning", "selamat pagi", "hey", "p"):
        return "DISCOVERY"

    return "DISCOVERY"


def next_best_action(
    ctx: DealContext,
    products: List[Any],
    goal: Optional[str] = None,
    framework: str = "",
) -> Dict[str, Any]:
    """Calculate next best action, coach guidance, UI chips, and quote preview."""
    stage = ctx.stage
    sku_primary = ctx.items[0]["sku"] if ctx.items else (_get_item_prop(ctx.recommended[0], "sku", None) if ctx.recommended else None)
    qty_primary = ctx.items[0]["qty"] if ctx.items else 1

    quote_preview = None
    if ctx.items or stage in ("READY_TO_QUOTE", "QUOTE_CONFIRMED", "QUOTED"):
        target_items = ctx.items or ([{"sku": sku_primary, "qty": 1}] if sku_primary else [])
        include_install = ctx.needs.get("install_needed", False)
        quote_preview = calculate_quote_preview(target_items, include_install, products, framework)

    chips = []
    action_type = "REPLY_ONLY"
    btn_label = "💬 Insert Selected Reply"
    coach_tip = ""
    intent = "PRODUCT_CONSULTATION"

    if stage == "DISCOVERY":
        intent = "PRODUCT_CONSULTATION"
        action_type = "REPLY_ONLY"
        btn_label = "💬 Reply: Ask Room Size / Needs"
        coach_tip = "Customer is exploring. Ask about room size (sqft) or cooling requirements before quoting."
        chips = [
            {"id": "ask_sqft", "label": "📏 Ask room size"},
            {"id": "recommend_daikin", "label": "❄️ Recommend Daikin 1.5HP"},
            {"id": "ask_budget", "label": "💰 Ask budget preference"},
        ]

    elif stage == "RECOMMEND":
        intent = "PRODUCT_CONSULTATION"
        action_type = "REPLY_ONLY"
        btn_label = "💬 Reply: Send Recommendation & Compare"
        coach_tip = "Recommend the best-fit model for their room size. Offer a side-by-side comparison to help them decide."
        chips = [
            {"id": "compare", "label": "⚖️ Compare Daikin vs Panasonic"},
            {"id": "offer_quote", "label": "📄 Offer quotation"},
            {"id": "upsell_install", "label": "🔧 Include installation"},
        ]

    elif stage == "READY_TO_QUOTE":
        intent = "BUYING_INQUIRY"
        action_type = "OFFER_QUOTE"
        btn_label = "📄 Ask customer: prepare quotation?"
        coach_tip = "Customer selected a model! Do not push an unrequested quote deal yet. Ask if they want an official quotation including installation."
        chips = [
            {"id": "offer_quote", "label": "📄 Offer quotation"},
            {"id": "compare", "label": "⚖️ Compare models"},
            {"id": "upsell_pipe", "label": "🧱 Add copper pipe"},
        ]

    elif stage == "QUOTE_OFFERED":
        intent = "PRODUCT_CONSULTATION"
        action_type = "NO_ACTION"
        btn_label = "💬 Insert Selected Reply"
        coach_tip = "Quotation offer sent. Waiting for customer's confirmation ('ok' / 'boleh')."
        chips = [
            {"id": "nudge", "label": "👋 Gentle follow-up"},
            {"id": "compare", "label": "⚖️ Show model comparison"},
        ]

    elif stage == "QUOTE_CONFIRMED":
        intent = "BUYING_INQUIRY"
        action_type = "CREATE_QUOTE"
        btn_label = "🚀 Generate quote & send PDF"
        coach_tip = "Customer said YES to the quotation! Review line items below, click to generate the quote deal, and send the official PDF."
        chips = [
            {"id": "create_quote", "label": "🚀 Generate quote"},
            {"id": "toggle_install", "label": "🔧 Installation included"},
            {"id": "add_pipe", "label": "🧱 Add extra piping"},
        ]

    elif stage == "QUOTED":
        intent = "FOLLOW_UP_DUE"
        action_type = "SEND_FOLLOW_UP"
        btn_label = "⏰ Lock Slot & Follow Up"
        coach_tip = "Quotation is active. Encourage customer to confirm installation date with a 40% deposit."
        chips = [
            {"id": "lock_slot", "label": "📅 Lock installation slot"},
            {"id": "payment_info", "label": "💳 Send DuitNow / Bank info"},
        ]

    elif stage == "NEGOTIATING":
        intent = "DISCOUNT_REQUEST"
        action_type = "SEND_COUNTER_OFFER"
        btn_label = "🤝 Send Value-add Counter-offer"
        coach_tip = "Customer requested a discount. Protect profit margin by offering free copper piping or installation warranty instead of cash discount."
        chips = [
            {"id": "free_piping", "label": "🎁 Free 3m piping"},
            {"id": "round_off", "label": "💵 Round off total"},
        ]

    elif stage == "AWAITING_PAYMENT":
        intent = "CUSTOMER_CONFIRMED"
        action_type = "MARK_WON"
        btn_label = "✅ Verify Deposit & Mark Won"
        coach_tip = "Customer sent payment confirmation. Check bank slip and mark deal as Won."
        chips = [
            {"id": "mark_won", "label": "✅ Mark Won"},
            {"id": "send_receipt", "label": "🧾 Acknowledge payment"},
        ]

    elif stage == "LOST":
        intent = "CUSTOMER_DECLINED"
        action_type = "MARK_LOST"
        btn_label = "❌ Record Loss & Polite Close"
        coach_tip = "Customer declined. Keep the door open for future maintenance or referral."
        chips = [
            {"id": "mark_lost", "label": "❌ Mark Lost"},
            {"id": "friendly_bye", "label": "👋 Friendly sign-off"},
        ]

    elif stage == "COMPLAINT":
        intent = "COMPLAINT"
        action_type = "LOG_COMPLAINT"
        btn_label = "⚠️ Log Service Ticket"
        coach_tip = "Customer reported an issue. Express empathy, prioritize technician dispatch, and do not debate."
        chips = [
            {"id": "log_complaint", "label": "⚠️ Log Ticket"},
            {"id": "arrange_tech", "label": "👨‍🔧 Dispatch Technician"},
        ]

    elif stage == "LHDN_TIN":
        intent = "SAVE_LHDN_TIN"
        action_type = "SAVE_LHDN_TIN"
        btn_label = "📋 Save LHDN e-Invoice Data"
        coach_tip = "Customer provided TIN/SSM. Save to database for e-Invoice validation."
        chips = [
            {"id": "save_tin", "label": "📋 Save TIN"},
        ]

    # Handle goal overrides from chips
    if goal == "compare":
        if not ctx.compare_data:
            compare_skus = [it["sku"] for it in ctx.items if it.get("sku")] or ["ACN-DAI-15", "ACN-PAN-15"]
            ctx.compare_data = compare(compare_skus, products)

    # Format human-friendly wants description
    wants_str = ""
    if ctx.items:
        wants_parts = [f"{it.get('qty', 1)}x {it.get('name', it.get('sku'))}" for it in ctx.items]
        wants_str = " · ".join(wants_parts)
    elif ctx.needs.get("room_sqft"):
        wants_str = f"Room size {ctx.needs['room_sqft']} sqft"
    elif ctx.needs.get("hp"):
        wants_str = f"{ctx.needs['hp']} HP unit"
    else:
        wants_str = "Cooling consultation"

    if ctx.needs.get("install_needed"):
        wants_str += " (incl. installation)"

    return {
        "stage": stage,
        "stageSteps": ["Discovery", "Recommend", "Ready to Quote", "Quote Confirmed", "Closed"],
        "stageIndex": _stage_to_index(stage),
        "intent": intent,
        "actionType": action_type,
        "btnLabel": btn_label,
        "coachTip": coach_tip,
        "chips": chips,
        "wants": wants_str,
        "missing": ctx.missing,
        "quotePreview": quote_preview,
        "compare": ctx.compare_data,
        "pendingOffer": ctx.pending_offer,
        "sku": sku_primary,
        "qty": qty_primary,
        "amount": quote_preview["total"] if quote_preview else 0,
    }


def _stage_to_index(stage: str) -> int:
    mapping = {
        "NEW": 0,
        "DISCOVERY": 0,
        "RECOMMEND": 1,
        "READY_TO_QUOTE": 2,
        "QUOTE_OFFERED": 2,
        "QUOTE_CONFIRMED": 3,
        "QUOTED": 3,
        "NEGOTIATING": 3,
        "AWAITING_PAYMENT": 4,
        "WON": 4,
        "LOST": 4,
        "COMPLAINT": 4,
        "LHDN_TIN": 4,
        "CASUAL": 0,
    }
    return mapping.get(stage, 0)


def generate_fallback_replies(
    ctx: DealContext,
    action: Dict[str, Any],
    products: List[Any],
) -> List[Dict[str, str]]:
    """Deterministic, highly realistic fallback replies tailored to the sales stage and catalog truth."""
    stage = action.get("stage", ctx.stage)
    qp = action.get("quotePreview")
    items_desc = action.get("wants", "aircond")
    total_str = f"RM {qp['total']:,}" if qp and qp.get("total") else ""
    deposit_str = f"RM {qp['depositRm']:,}" if qp and qp.get("depositRm") else ""

    if stage == "DISCOVERY":
        return [
            {
                "label": "Recommended",
                "text": "Hello Boss! May I know the estimated room size (sqft) or is it for a bedroom or living hall? That way I can recommend the exact right HP for you.",
            },
            {
                "label": "Casual Boss",
                "text": "Hi Boss! Bilik size berapa kaki persegi ya? Nak pasang kat bilik tidur ke living hall?",
            },
            {
                "label": "Bahasa Melayu",
                "text": "Salam sejahtera Boss. Boleh saya tahu anggaran keluasan bilik (kaki persegi)? Kami bantu pilihkan kapasiti HP yang paling jimat elektrik dan sejuk.",
            },
        ]

    elif stage in ("RECOMMEND", "DISCOVERY"):
        rec_name = _get_item_prop(ctx.recommended[0], 'name', 'Daikin 1.5HP Inverter Unit') if ctx.recommended else 'Daikin 1.5HP Inverter Unit'
        val = _get_item_prop(ctx.recommended[0], 'sell_price', 1150) if ctx.recommended else 1150
        rec_price = f'RM {val:,}'
        return [
            {
                "label": "Recommended",
                "text": f"Daikin is an excellent choice Boss! The {rec_name} ({rec_price}) features 5-star inverter energy saving and whisper-quiet cooling. May I know your room size (sqft) or horsepower needed?",
            },
            {
                "label": "Casual Boss",
                "text": f"Boss, untuk keluasan ni memang paling ngam pakai {rec_name} ({rec_price}). Sejuk padu dan jimat bil. Nak saya buka sebut harga rasmi sekali pasang?",
            },
            {
                "label": "Bahasa Melayu",
                "text": f"Untuk ruang ini, model {rec_name} ({rec_price}) paling sesuai. Penjimatan elektrik 5 bintang dan waranti 5 tahun kompresor. Boleh saya sediakan sebut harga rasmi?",
            },
        ]

    elif stage == "READY_TO_QUOTE":
        return [
            {
                "label": "Recommended",
                "text": f"Noted Boss! We have {items_desc} ready in stock. Would you like me to prepare an official quotation including standard installation for you?",
            },
            {
                "label": "Casual Boss",
                "text": f"Boleh Boss, stok {items_desc} memang ready. Nak saya buka sebut harga rasmi siap upah pemasangan?",
            },
            {
                "label": "Bahasa Melayu",
                "text": f"Baik Boss, unit {items_desc} ada dalam stok. Boleh saya sediakan sebut harga rasmi lengkap dengan kos pemasangan?",
            },
        ]

    elif stage == "QUOTE_CONFIRMED":
        return [
            {
                "label": "Recommended",
                "text": f"Here is the official quotation for {items_desc}. Total is {total_str} with {deposit_str} (40%) deposit to confirm installation date. PDF attached below for your review!",
            },
            {
                "label": "Casual Boss",
                "text": f"Siap Boss! Ni sebut harga untuk {items_desc}. Total {total_str}, deposit {deposit_str} je untuk lock tarikh pasang. Saya attach PDF kat bawah ya.",
            },
            {
                "label": "Bahasa Melayu",
                "text": f"Sebut harga rasmi untuk {items_desc} sudah siap. Jumlah keseluruhan adalah {total_str} (deposit 40% {deposit_str}). Fail PDF dilampirkan bersama.",
            },
        ]

    elif stage == "QUOTE_OFFERED":
        return [
            {
                "label": "Recommended",
                "text": "Let me know if you would like me to generate the official quotation or if you have any questions on the specifications, Boss!",
            },
            {
                "label": "Casual Boss",
                "text": "Ada apa-apa nak tanya pasal spec atau nak saya generate quotation terus Boss?",
            },
            {
                "label": "Bahasa Melayu",
                "text": "Sila beritahu jika Boss perlukan sebut harga rasmi atau maklumat lanjut berkenaan model ini.",
            },
        ]

    elif stage == "QUOTED":
        return [
            {
                "label": "Recommended",
                "text": f"Hi Boss, just following up on our quotation ({total_str}). Our installation slots for this week are filling up fast—would you like us to lock your slot with the {deposit_str} deposit?",
            },
            {
                "label": "Casual Boss",
                "text": f"Hi Boss! Nak follow up pasal quote {total_str} haritu. Slot technician minggu ni tinggal sikit, nak lock slot pasang Boss?",
            },
            {
                "label": "Bahasa Melayu",
                "text": f"Salam Boss, ingin susulan berkenaan sebut harga {total_str}. Boleh kami bantu kunci slot pemasangan minggu ini?",
            },
        ]

    elif stage == "NEGOTIATING":
        return [
            {
                "label": "Recommended",
                "text": f"We appreciate your business, Boss! Our unit prices are strictly factory controlled, but we can bundle in an extra 3m premium copper piping free of charge for this order. Can we proceed?",
            },
            {
                "label": "Casual Boss",
                "text": "Harga unit ni memang direct kilang Boss. Tapi saya belanja piping copper extra 3m percuma untuk Boss. Boleh kita jalan?",
            },
            {
                "label": "Bahasa Melayu",
                "text": "Untuk harga unit memang sudah harga terbaik kilang Boss. Sebagai tanda penghargaan, kami belanja set paip tembaga 3m secara percuma. Boleh kita sahkan?",
            },
        ]

    elif stage == "AWAITING_PAYMENT":
        return [
            {
                "label": "Recommended",
                "text": "Payment received with thanks! Our team is scheduling your installation. We will send the technician details shortly.",
            },
            {
                "label": "Casual Boss",
                "text": "Duit dah masuk Boss, terima kasih banyak! Saya terus arrange technician untuk pasang ikut slot.",
            },
            {
                "label": "Bahasa Melayu",
                "text": "Bayaran deposit telah disahkan. Terima kasih Boss! Kami akan maklumkan butiran juruteknik pemasangan dalam masa terdekat.",
            },
        ]

    # Default / Casual fallback
    return [
        {
            "label": "Recommended",
            "text": "Hello Boss! How can we assist you with air conditioning sales or installation today?",
        },
        {
            "label": "Casual Boss",
            "text": "Hi Boss! Boleh saya bantu pasal aircond atau quotation hari ni?",
        },
        {
            "label": "Bahasa Melayu",
            "text": "Salam sejahtera Boss. Ada apa yang boleh kami bantu berkenaan penyaman udara hari ini?",
        },
    ]