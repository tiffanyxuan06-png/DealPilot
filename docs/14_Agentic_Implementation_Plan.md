# 14. WhatsApp Sales Sidekick Implementation Plan

## Goal Description
Implement the **WhatsApp Sales Sidekick** across the 3 layers (**Understand**, **Execute**, **Protect**) with a prioritized path:
$$\text{Conversation} \longrightarrow \text{Order} \longrightarrow \text{Quotation} \longrightarrow \text{Invoice} \longrightarrow \text{Payment Status}$$

This replaces complex ReAct multi-agent loops with a high-speed, predictable tool executor tailored for local models (`qwen2.5-3b-instruct` / `qwen2.5-7b-instruct`) in LM Studio.

---

## 1. Technical Components & File Structure

```
backend/
├── services/
│   ├── prompts.py               # Layer A: Lightweight prompts (Intent, Entities, Replies)
│   ├── sidekick_tools.py        # Layer B: 10 deterministic backend tools
│   ├── guards.py                # Layer C: Permissions, discount limits, audit validation
│   └── ocr_evidence.py          # Evidence-based receipt extractor & transaction matcher
├── routers/
│   └── sidekick_router.py       # Fast API endpoints for WhatsApp Copilot & Order Actions
webapp/
├── js/
│   ├── copilot.js               # Sidekick panel & 10-second action pills
│   ├── order_card.js            # Interactive Draft Order & Quote Card
│   └── ocr_card.js              # Evidence-based Payment Verification Card
```

---

## 2. Phased Implementation Roadmap

### Phase 1: Conversation Context & Strategic Reply Copilot (Completed & Verified)
- [x] WhatsApp extension UI loading & cache buster fix (`copilot.js`, `inspector.js`).
- [x] Multi-style reply prompts (Consultative, Direct, Friendly) with catalog price insertion.
- [x] Maintain 100% test pass rate across 109 unit tests (`pytest test/unit`).

### Phase 2: Chat-to-Order & Catalog Matching (Next Priority)
- [ ] **Layer B Tool**: `search_products(query, category, limit)` with fuzzy SKU matching.
- [ ] **Layer B Tool**: `get_customer_orders(phone, limit)` to resolve "Same as last month" orders.
- [ ] **Layer A LLM Prompt**: `extract_order_intent(messages)` returning structured JSON:
  ```json
  {
    "items": [{"raw_query": "Daikin 1.5hp", "qty": 12}],
    "delivery_location": "Shah Alam",
    "missing_fields": ["delivery_fee", "preferred_delivery_date"],
    "discount_requested": true
  }
  ```
- [ ] **UI Component**: Interactive `Order Card` in WhatsApp extension with editable fields.

### Phase 3: Quotation & Invoice Generation (The Core Pipeline)
- [ ] **Layer B Tool**: `calculate_quote(items, discount_pct, delivery_fee)`:
  - Deterministic calculation: subtotal, SST, approved discount, total.
- [ ] **Layer B Tool**: `create_document_draft(type, order_id, terms)`:
  - Converts confirmed order into a formal Quote or Invoice record.
- [ ] **WhatsApp Formatter**: 1-click formatted summary ready to copy or send directly to the customer.

### Phase 4: Commitment Tracker (Promises over Scores)
- [ ] Database Table: `commitments` (`id`, `phone`, `promise_text`, `due_date`, `party`, `status`).
- [ ] **Layer A Extraction**: Scans chat for temporal commitments ("transfer tomorrow", "reserve till Friday").
- [ ] **Layer B Tool**: `save_commitment(phone, promise_text, due_date, party)`.
- [ ] **UI Widget**: Actionable Commitment checklist with Snooze, Complete, and Dismiss buttons.

### Phase 5: OCR Evidence Extraction & Payment Verification
- [ ] **Layer B Tool**: `extract_document(file_id, doc_type)`:
  - Extracts Bank Name, Amount (RM), Date, and Reference ID.
- [ ] **Layer B Tool**: `match_transaction(amount, ref_id, customer_id)`:
  - Correlates against customer's open invoices.
  - Flags duplicate reference IDs and amount discrepancies.
- [ ] **UI Component**: Evidence Verification Card showing side-by-side comparison before marking paid.

### Phase 6: Company Operations & Receivables Visibility
- [ ] Aging receivables dashboard (0–14 days, 15–30 days, 30+ days).
- [ ] Deal conversion metrics & daily commitment audit.

---

## 3. Local Model Verification & Latency Budget

| Step | Operation | Max Latency Budget | Mechanism |
| :--- | :--- | :--- | :--- |
| **1** | Casual Greeting ("Hi", "Thanks") | < 1.5s | Direct LLM response (zero tool calls) |
| **2** | Product / Price Inquiry | < 5.0s | Single tool call (`search_products`) + response synthesis |
| **3** | Chat-to-Order Extraction | < 4.0s | Structured JSON extraction from conversation |
| **4** | Quote & Tax Math | < 50ms | Pure deterministic Python math (Layer B) |
| **5** | Payment Receipt Verification | < 3.0s | Fast OCR extraction + SQL invoice match |
