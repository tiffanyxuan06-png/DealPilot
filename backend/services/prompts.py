import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from backend.services.memory import clean_customer_name


def build_whatsapp_copilot_system_prompt(
    company_name: str,
    stock_context: str,
    framework: str,
    clean_cust_req: str,
    phone: str,
    tier: str,
    score: int,
    pay_behavior: str,
    detected_style: str,
    recent_context_str: str,
    tier_instruction: str = "",
    sender_turn_note: str = "",
    custom_directive_block: str = "",
) -> str:
    return f"""You are CashChase Orbyte SME Copilot for {company_name}.
Analyze the customer's WhatsApp message using ONLY the live warehouse stock, owner pricing rules, and the Client Memory Profile below.
Adapt your recommended replies to match the customer's tone and client relationship.
{tier_instruction}
{sender_turn_note}
{custom_directive_block}
[CLIENT MEMORY PROFILE (CROSS-CHAT MEMORY)]
- Customer: {clean_cust_req} ({phone})
- Client Tier & Score: {tier} (Trust Score: {score}/100)
- Payment Track Record: {pay_behavior}
- Communication Style: {detected_style}
- Recent Chat Context:
{recent_context_str}

[LIVE WAREHOUSE STOCK]
{stock_context}

[OWNER LABOR & PRICING FRAMEWORK]
{framework}

[CRITICAL WHATSAPP COMMUNICATION RULES FOR CUSTOMER REPLIES]:
1. CUSTOMER DECLINED ("no", "not now", "tak jadi", "cancel", "no thanks", "pass"):
   - When a customer says "no", "cancel", "not interested", "takpe", or declines:
     * NEVER lecture them about expired holds, missed deposits, or stock release!
     * NEVER push them to re-order or pay a deposit immediately!
     * NEVER output robotic status notes like "keterangan: telah tamat tempoh" or "stok tidak diperuntukkan".
     * ALWAYS reply gracefully, politely, and warmly: "Understood Boss, no problem at all! Thanks for letting us know. Reach out anytime if you need anything in the future!"
2. NEVER UPDATE OR TELL CLIENT ABOUT INTERNAL STOCK COUNTS / WAREHOUSE POOL:
   - NEVER tell the client your internal stock counts, available units, or pool statuses:
     * DO NOT say: "stock is now back in pool", "stock is free again", "Available: 5 units", "stock is zero", "only 2 units left in database", or "stock not locked".
     * Internal inventory quantities and pools are strictly internal to the owner. The customer only needs to know whether you can deliver their order!
     * If in stock: simply state "Stock is available!" or "Ready stock Boss!".
     * If out of stock: state "Sorry Boss, this item is currently out of stock. We have a fresh shipment arriving soon or can recommend alternatives." (NEVER dump "OnHand: 3, Held: 8, Available: 0").
3. NEVER MENTION INTERNAL WAREHOUSE/ERP MECHANICS:
   - NEVER tell the customer: "deducted stock", "remove stock", "locked stock", "lock the stock", "kunci stok", "stok ditolak", or "tolak stok".
   - Always use natural merchant phrasing: "your order is confirmed and scheduled for delivery", "confirm your order".
4. NEVER LEAK INTERNAL DATABASE IDS OR CRM NOTES:
   - Do NOT say "Quote #QT-101", "hold expired today", "no deposit received", or internal CRM badges. Greet cleanly as "{clean_cust_req}" or "Boss".
5. KEEP REPLIES SHORT, CONCISE, AND HUMAN (1-2 sentences max). Real Malaysian merchants on WhatsApp chat directly without walls of text or bureaucratic system scripts.

Return ONLY a valid JSON object with these keys:
{{
  "intent": "BUYING_INQUIRY" | "DEPOSIT_PAID" | "AFTERSALES_ISSUE" | "EXPIRED_HOLD_FOLLOWUP" | "CASUAL_CHAT" | "CUSTOMER_DECLINED",
  "badge": "Short 2-3 word label",
  "extTitle": "Action card title",
  "extCheck": "Multi-line summary of stock availability and RM calculation (Note: a quote places stock ON HOLD for 48h; physical stock is only deducted after the deposit is confirmed)",
  "extActionDesc": "1-sentence explanation of what clicking the primary button will do",
  "extDraft": "Primary WhatsApp reply adapted to this client's relationship & tone",
  "replyOptions": [
    {{"label": "⭐ Option 1: Best Match for Client & Your Prompt", "text": "..."}},
    {{"label": "🤝 Option 2: Friendly Boss Style (40% Deposit to Confirm)", "text": "..."}},
    {{"label": "⚡ Option 3: Fast-Close / Priority Dispatch Offer", "text": "..."}},
    {{"label": "🇲🇾 Option 4: Bahasa Melayu / Formal", "text": "..."}}
  ],
  "extBtnLabel": "✅ Hold Stock (48h) & Insert Selected Reply",
  "extActionType": "CREATE_QUOTE_HOLD" | "REPLY_ONLY" | "CONFIRM_DEPOSIT_DEDUCT" | "AFTERSALES_REPLACE" | "RELEASE_EXPIRED_HOLD",
  "sku": "Primary SKU code (e.g. ACN-DAI-15)",
  "qty": 5,
  "extraSku": "Secondary SKU code if any (e.g. GAS-R32) or null",
  "extraQty": 0,
  "amount": 6650
}}"""


def build_whatsapp_copilot_user_prompt(
    customer: str,
    phone: str,
    inquiry_message: str,
    last_my_message: Optional[str] = None,
    user_instruction: Optional[str] = None,
) -> str:
    user_prompt = (
        f"Customer: {customer} ({phone})\n"
        f"Customer Inquiry: \"{inquiry_message}\"\n"
    )
    if last_my_message:
        user_prompt += f"Owner's Last Sent Message: \"{last_my_message}\"\n"
    if user_instruction and user_instruction.strip():
        user_prompt += f"Owner's Custom Quotation/Reply Instruction: \"{user_instruction.strip()}\""
    return user_prompt


def build_company_agent_system_prompt(
    company_name: str,
    core_nw: int,
    cash: int,
    stock_val: int,
    pending_in: int,
    pending_out: int,
    full_nw: int,
    stock_lines: str,
    inv_lines: str,
) -> str:
    return f"""You are the CashChase Orbyte Company AI Copilot for {company_name}.
Answer the user's question concisely and accurately using ONLY the live company data below.

[FINANCIAL SUMMARY]
- Core Net Worth: RM {core_nw:,} (Verified Cash: RM {cash:,} + Physical Stock Value: RM {stock_val:,})
- Pending Customer Receivables: RM {pending_in:,}
- Unpaid Supplier Payables: RM {pending_out:,}
- Projected Full Net Worth: RM {full_nw:,}

[LIVE WAREHOUSE STOCK & CAPACITY]
{stock_lines}

[ALL QUOTES, INVOICES & SUPPLIER BILLS]
{inv_lines}
"""


def deterministic_fallback_analysis(
    customer: str,
    phone: str,
    message_text: str,
    state: Dict[str, Any],
    user_instruction: str = "",
) -> Dict[str, Any]:
    clean_cust = clean_customer_name(customer)
    combined_text = f"{message_text} {user_instruction}".strip()
    msg_lower = combined_text.lower()
    instr_lower = (user_instruction or "").lower()

    stock_items = state.get("stock", [])
    if not stock_items:
        stock_items = [
            {"sku": "ITEM-01", "name": "Standard Stock Item", "sellPrice": 100, "unitCost": 50, "onHand": 10, "onHold": 0}
        ]
    primary_item = stock_items[0]
    secondary_item = stock_items[1] if len(stock_items) > 1 else primary_item
    company_name = state.get("company", {}).get("name", "our company")

    # 0. Customer Decline / Cancellation / Pass detection
    decline_tokens = ["no", "nope", "not now", "cancel", "tak", "takpe", "tak nak", "tak jadi", "batal", "no thanks", "next time", "pass"]
    words_in_msg = [w.strip() for w in re.split(r"\W+", msg_lower) if w.strip()]
    is_declining = any(
        re.search(rf"\b{re.escape(k)}\b", msg_lower) for k in decline_tokens
    ) and (len(words_in_msg) <= 6 or any(phrase in msg_lower for phrase in ["no thanks", "tak jadi", "tak nak", "not now", "next time", "cancel order"]))

    if is_declining and not any(k in msg_lower for k in ["bank in", "deposit", "duitnow", "receipt", "resit", "quote", "harga", "price"]):
        opt1 = f"Understood {clean_cust}, no problem at all! Thanks for letting us know. Reach out anytime if you need anything in the future!"
        opt2 = f"Alright Boss, noted with thanks! Reach out anytime if you need supply down the road."
        opt3 = f"Baik {clean_cust}, tidak mengapa. Terima kasih kerana maklumkan. Hubungi kami bila-bila masa jika perlukan bekalan nanti ya!"
        return {
            "intent": "CUSTOMER_DECLINED",
            "badge": "Decline Acknowledged",
            "extTitle": f"🤝 {clean_cust} Passed / Declined",
            "extCheck": "🟢 Customer politely declined the quotation or follow-up.\nNo payment chasing or deposit required.",
            "extActionDesc": "Insert a friendly, zero-pressure reply to keep the customer relationship warm.",
            "extDraft": opt1,
            "replyOptions": [
                {"label": "🤝 Option 1: Polite & Friendly Close (Recommended)", "text": opt1},
                {"label": "👍 Option 2: Casual Boss Style", "text": opt2},
                {"label": "🇲🇾 Option 3: Bahasa Melayu (Terima Kasih)", "text": opt3},
            ],
            "extBtnLabel": "💬 Insert Polite Acknowledgment",
            "extActionType": "NO_ACTION",
            "sku": None,
            "qty": 0,
            "amount": 0,
        }

    # 1. Aftersales / Faulty / Leaking detection
    if any(k in msg_lower for k in ["leak", "rosak", "faulty", "broken", "bocor", "defect", "problem", "error", "bug"]):
        issue_item = secondary_item
        for s in stock_items:
            tokens = [t.lower() for t in re.split(r"\W+", s["name"]) if len(t) > 2 and t.lower() not in ["unit", "set", "pack", "carton", "box", "supply", "standard", "item"]]
            if s["sku"].lower() in msg_lower or any(t in msg_lower for t in tokens):
                issue_item = s
                break
        rebate_amt = issue_item.get("sellPrice", issue_item.get("sell_price", 150))
        opt1 = (
            f"Sorry about the issue {clean_cust}! We will deliver 1x replacement {issue_item['name']} "
            f"today at no charge."
        )
        opt2 = (
            f"Hi {clean_cust}, sorry for the trouble! If you prefer not to wait, "
            f"we can apply an immediate RM {rebate_amt:,} credit rebate off your balance today."
        )
        opt3 = (
            f"Maaf atas masalah itu {clean_cust}! Kami akan hantar 1x gantian {issue_item['name']} "
            f"hari ini tanpa sebarang caj."
        )
        return {
            "intent": "AFTERSALES_ISSUE",
            "badge": "3. Aftersales Issue",
            "extTitle": "⚠️ Faulty Item Reported (Reminders Paused)",
            "extCheck": f"🛡️ Payment chasing is AUTO-PAUSED.\n📦 Recommended Fix: Send 1x replacement {issue_item['name']} (-1 Stock)",
            "extActionDesc": "Choose a recommended resolution reply below, then press the big button to execute.",
            "extDraft": opt1,
            "replyOptions": [
                {"label": "📦 Option 1: Free 1-to-1 Replacement (Recommended)", "text": opt1},
                {"label": f"💸 Option 2: Offer RM {rebate_amt:,} Instant Discount / Rebate", "text": opt2},
                {"label": "🇲🇾 Option 3: Bahasa Melayu (Gantian Segera)", "text": opt3},
            ],
            "extBtnLabel": "📦 Send -1 Replacement Stock & Insert Reply",
            "extActionType": "AFTERSALES_REPLACE",
            "sku": issue_item["sku"],
            "qty": 1,
            "amount": 0,
        }

    # 2. Deposit / Receipt / Bank-In detection
    if any(k in msg_lower for k in ["bank in", "bank-in", "deposit", "duitnow", "receipt", "resit", "paid", "transfer", "ref"]):
        amt_match = re.search(r"rm\s*([\d,]+)", msg_lower)
        claimed_amt = int(amt_match.group(1).replace(",", "")) if amt_match else 2000
        ref_match = re.search(r"(dn-[\w-]+)", msg_lower)
        ref_no = ref_match.group(1).upper() if ref_match else f"DN-{datetime.now().strftime('%Y%m%d')}-99281"
        opt1 = (
            f"Thanks {clean_cust}! Received RM {claimed_amt:,} deposit (Ref: {ref_no}). "
            f"Your order is confirmed and scheduled for delivery!"
        )
        opt2 = (
            f"Thanks Boss! Received your RM {claimed_amt:,} DuitNow deposit already. "
            f"Arranging earliest dispatch for your team!"
        )
        opt3 = (
            f"Terima kasih {clean_cust}! Deposit RM {claimed_amt:,} (Rujukan: {ref_no}) telah diterima. "
            f"Pesanan anda sudah disahkan dan penghantaran akan diuruskan."
        )
        return {
            "intent": "DEPOSIT_PAID",
            "badge": "2. Deposit / Payment Sent",
            "extTitle": "💰 Deposit / Payment Claimed → Verify & Confirm Order",
            "extCheck": (
                f"💵 Claimed Amount: RM {claimed_amt:,} (Ref: {ref_no})\n"
                f"📦 Action: Stage for Bank Verification OR Confirm Deposit & Allocate Order"
            ),
            "extActionDesc": "Choose a confirmation reply below, then press the big button to confirm deposit & update records.",
            "extDraft": opt1,
            "replyOptions": [
                {"label": "✅ Option 1: Confirm Deposit & Schedule Delivery", "text": opt1},
                {"label": "🚚 Option 2: Friendly Boss Style (Earliest Dispatch)", "text": opt2},
                {"label": "🇲🇾 Option 3: Bahasa Melayu (Pengesahan Deposit)", "text": opt3},
            ],
            "extBtnLabel": f"💰 Confirm RM {claimed_amt:,} Deposit & Confirm Order",
            "extActionType": "CONFIRM_DEPOSIT_DEDUCT",
            "sku": primary_item["sku"],
            "qty": 5,
            "amount": claimed_amt,
            "receiptRef": ref_no,
        }

    # 3. Follow-up on prior inquiry
    if "expired" in msg_lower or "no deposit" in msg_lower or "50 hours" in msg_lower or "follow-up" in msg_lower:
        opt1 = (
            f"Hi {clean_cust}! Just checking in on your inquiry for {primary_item['name']}. "
            f"Let us know if you would like us to schedule delivery for your team!"
        )
        opt2 = (
            f"Hi Boss! Following up to see if you still need this order arranged? "
            f"Let us know whenever you are ready."
        )
        opt3 = (
            f"Salam {clean_cust}, sekadar bertanya khabar mengenai sebut harga hari itu. "
            f"Maklumkan jika anda masih berminat untuk penghantaran ya."
        )
        p_price = primary_item.get("sellPrice", primary_item.get("sell_price", 1000))
        return {
            "intent": "EXPIRED_HOLD_FOLLOWUP",
            "badge": "Follow-Up Ready",
            "extTitle": "⏳ Quotation Follow-Up Check",
            "extCheck": f"📦 Follow-up check for {primary_item['name']}.\nInternal hold released in warehouse if customer does not proceed.",
            "extActionDesc": "Choose a follow-up reply below, then press the button to release the hold and update records.",
            "extDraft": opt1,
            "replyOptions": [
                {"label": "💬 Option 1: Friendly Follow-Up (Recommended)", "text": opt1},
                {"label": "🤝 Option 2: Casual Boss Style", "text": opt2},
                {"label": "🇲🇾 Option 3: Bahasa Melayu (Pertanyaan Santai)", "text": opt3},
            ],
            "extBtnLabel": "🔓 Release Held Stock & Insert Follow-Up",
            "extActionType": "RELEASE_EXPIRED_HOLD",
            "sku": primary_item["sku"],
            "qty": 3,
            "amount": p_price * 3,
        }

    # 4. Check if message is a genuine business inquiry or casual chat with friends
    all_stock_keywords = set()
    for s in stock_items:
        all_stock_keywords.add(s["sku"].lower())
        for w in re.split(r"\W+", s["name"]):
            wl = w.lower()
            if len(wl) >= 3 and wl not in ["unit", "set", "pack", "carton", "box", "with", "and", "the"]:
                all_stock_keywords.add(wl)

    generic_biz_words = [
        "quote", "quotation", "sebut harga", "harga", "price", "deposit", "duitnow",
        "stok", "stock", "unit", "set", "carton", "seat", "bag", "license", "order", "pesanan",
        "install", "pasang", "bocor", "leak", "rosak", "defect", "renew", "delivery"
    ]

    is_biz = (
        bool(user_instruction)
        or any(k in msg_lower for k in all_stock_keywords)
        or any(k in msg_lower for k in generic_biz_words)
        or bool(re.search(r"\d+\s*(?:units?|x|sets?|pcs|cartons?|seats?|bottles?|tanks?|bags?|kg)", msg_lower))
    )

    if not is_biz:
        greeting = f"Hi {clean_cust}! Let us know if {company_name} can assist with any orders or inquiries today."
        return {
            "intent": "CASUAL_CHAT",
            "badge": "💬 Casual Chat",
            "extTitle": f"💬 Chatting with {clean_cust}",
            "extCheck": "🟢 Personal / Casual chat detected.\nNo warehouse stock hold or quotation required.",
            "extActionDesc": "Type a prompt below if this contact requests a quote or pricing.",
            "extDraft": greeting,
            "replyOptions": [
                {"label": "👋 Friendly Greeting", "text": greeting},
                {"label": "🇲🇾 Bahasa Melayu", "text": f"Salam {clean_cust}, ada apa-apa yang kami boleh bantu hari ini?"}
            ],
            "extBtnLabel": "💬 Insert Friendly Reply",
            "extActionType": "NO_ACTION",
            "sku": None,
            "qty": 0,
            "amount": 0,
        }

    # 5. Buying Inquiry / Quotation Dynamic Parser
    matched_lines = []
    for s in stock_items:
        s_price = s.get("sellPrice", s.get("sell_price", 100))
        terms = [re.escape(s["sku"].lower())]
        for w in re.split(r"\W+", s["name"]):
            wl = w.lower()
            if len(wl) >= 3 and wl not in ["unit", "set", "box", "pack", "carton", "with", "and", "the", "for", "item"]:
                terms.append(re.escape(wl))
        if not terms:
            continue
        term_pattern = r"(?:" + "|".join(terms) + r")"
        qty_pattern = rf"(\d+)\s*(?:units?|x|sets?|pcs|bottles?|tanks?|cartons?|seats?|boxes?|packs?|kg|litres?|days?|man-days?)?\s*{term_pattern}"
        m = re.search(qty_pattern, msg_lower)
        if m:
            qty = int(m.group(1))
        elif re.search(rf"\b{term_pattern}\b", msg_lower):
            m_num = re.search(rf"(\d+)\s+{term_pattern}", msg_lower) or re.search(rf"{term_pattern}\s+(\d+)", msg_lower)
            qty = int(m_num.group(1)) if m_num else 1
        else:
            qty = 0
        if qty > 0:
            matched_lines.append({"item": s, "qty": qty, "price": s_price})

    if not matched_lines:
        m_num = re.search(r"(\d+)\s*(?:units?|x|sets?|pcs|cartons?|seats?|bags?|kg|bottles?)", msg_lower)
        q = int(m_num.group(1)) if m_num else (5 if "quote" in msg_lower else 1)
        p_price = primary_item.get("sellPrice", primary_item.get("sell_price", 100))
        matched_lines.append({"item": primary_item, "qty": q, "price": p_price})

    labor_fee = 0
    labor_desc = ""
    if any(k in msg_lower or k in instr_lower for k in ["install", "pasang", "labor"]):
        labor_fee = 250 * matched_lines[0]["qty"]
        labor_desc = f"Standard Install Labor (RM {labor_fee:,})"
    elif any(k in msg_lower or k in instr_lower for k in ["delivery", "lorry", "van", "transport"]):
        labor_fee = 50
        labor_desc = "Cold-Chain Van Delivery (RM 50)"

    subtotal_rm = sum(l["qty"] * l["price"] for l in matched_lines) + labor_fee

    discount_rm = 0
    m_pct = re.search(r"(\d+)\s*%\s*(?:discount|off|less)", instr_lower)
    m_rm_disc = re.search(r"(?:rm|less|discount)\s*(\d+)", instr_lower)
    if m_pct:
        discount_rm = int(round(subtotal_rm * (int(m_pct.group(1)) / 100.0)))
    elif m_rm_disc and "discount" in instr_lower:
        discount_rm = int(m_rm_disc.group(1))

    total_rm = max(0, subtotal_rm - discount_rm)
    deposit_40 = int(round(total_rm * 0.4))
    deposit_50 = int(round(total_rm * 0.5))

    items_summary = " + ".join(
        f"{l['qty']}x {l['item']['name']} (RM {l['qty'] * l['price']:,})"
        for l in matched_lines
    )
    if labor_desc:
        items_summary += f" + {labor_desc}"
    if discount_rm > 0:
        items_summary += f" [Less Special Discount: -RM {discount_rm:,}]"

    custom_prefix = f"✨ [Custom Quote: {user_instruction}] " if user_instruction else ""

    opt1 = (
        f"Hi {clean_cust}! Stock is available. Official Quote for {items_summary} = RM {total_rm:,}. "
        f"Let us know if you would like to confirm with a 40% deposit (RM {deposit_40:,}) to confirm your order and schedule delivery!"
    )
    opt2 = (
        f"Ready Boss! {items_summary} total RM {total_rm:,}. "
        f"Just DuitNow 40% deposit (RM {deposit_40:,}) when ready, and we will confirm your order and arrange earliest delivery!"
    )
    opt3 = (
        f"Hi {clean_cust}, if you confirm with a 50% deposit (RM {deposit_50:,}) today, we can lock {items_summary} "
        f"at RM {total_rm:,} and prioritize earliest dispatch for your team!"
    )
    opt4 = (
        f"Salam {clean_cust}! Sebut harga rasmi untuk {items_summary} = Jumlah RM {total_rm:,}. "
        f"Sila buat bayaran deposit 40% (RM {deposit_40:,}) untuk pengesahan pesanan dan penjadualan penghantaran."
    )

    primary_matched = matched_lines[0]
    extra_matched = matched_lines[1] if len(matched_lines) > 1 else None

    # Quotes hold stock for 48h, but only when every requested item is available to sell.
    can_hold = all(
        l["qty"] <= l["item"].get("available", l["item"].get("onHand", 0) - l["item"].get("onHold", 0))
        for l in matched_lines
    )

    return {
        "intent": "BUYING_INQUIRY",
        "badge": "1. Price & Quote Info",
        "extTitle": f"📋 {custom_prefix}Price Quote → Hold Stock for 48h" if can_hold else f"📋 {custom_prefix}Price Quote · Not Enough Stock to Hold",
        "extCheck": (
            f"📦 {items_summary}\n"
            + (f"🛠️ Labor/Service: RM {labor_fee:,}\n" if labor_fee > 0 else "")
            + (f"🎁 Special Discount Applied: -RM {discount_rm:,}\n" if discount_rm > 0 else "")
            + f"💰 Quote Total: RM {total_rm:,} (40% Deposit: RM {deposit_40:,})\n"
            + (
                "⏳ Quote places these units ON HOLD for 48h. Physical stock is only deducted after the deposit is confirmed."
                if can_hold
                else "⚠️ Not enough available stock to hold all items. Reply only; no stock is held."
            )
        ),
        "extActionDesc": (
            "Choose a reply option below. The button places the quoted units ON HOLD for 48h and inserts the reply."
            if can_hold
            else "Choose a reply option below. No stock is held because some items are not available."
        ),
        "extDraft": opt1,
        "replyOptions": [
            {"label": "💬 Option 1: Stock Info & Price", "text": opt1},
            {"label": f"🤝 Option 2: Friendly Boss Style (DuitNow 40% to Confirm)", "text": opt2},
            {"label": f"⚡ Option 3: Fast-Close Priority Dispatch (50% Deposit RM {deposit_50:,})", "text": opt3},
            {"label": "🇲🇾 Option 4: Bahasa Melayu (Sebut Harga Rasmi)", "text": opt4},
        ],
        "extBtnLabel": "✅ Hold Stock (48h) & Insert Selected Reply" if can_hold else "💬 Insert Selected Reply (No Stock Hold)",
        "extActionType": "CREATE_QUOTE_HOLD" if can_hold else "REPLY_ONLY",
        "sku": primary_matched["item"]["sku"],
        "qty": primary_matched["qty"],
        "extraSku": extra_matched["item"]["sku"] if extra_matched else None,
        "extraQty": extra_matched["qty"] if extra_matched else 0,
        "amount": total_rm,
    }
