# WhatsApp Sales Sidekick: Practical Agentic Architecture & Plan

> **Core Philosophy:** *What can a salesperson do in WhatsApp in 10 seconds that currently takes 2 minutes, requires switching apps, or is easily forgotten?*
> 
> We pivot away from an over-engineered 4-agent showcase with opaque trust scores and fragile ReAct loops. Instead, we build **one unified Sales Sidekick** that understands the active WhatsApp chat, runs deterministic business tools in the backend, and never forces the salesperson to leave WhatsApp or chat with a bot.

---

## 1. Architectural Pivot: Before vs. After

| Dimension | Previous Proposal (AI Showcase) | Redesigned WhatsApp Sales Sidekick |
| :--- | :--- | :--- |
| **Agent Topology** | 4 autonomous agents passing messages in loops | **1 Orchestrator Sidekick** with modular skills & backend tools |
| **Customer Profiling** | Opaque "Trust Score" (e.g. 94/100) | **Concrete Commitments & History** ("Promised transfer by Friday") |
| **Payment Verification** | DuitNow regex formatting check treated as truth | **Evidence-Based OCR:** Receipt is evidence to inspect, not bank proof |
| **Pricing & Margins** | Hardcoded 15% margin floors & 40% deposit rules | **Deterministic Rules Engine:** Configurable seller business policies |
| **LLM Tool Load** | 25+ exposed functions to a 3B/4B local model | **10 High-Value Compact Operations** cleanly separated into layers |
| **User Experience** | Separate chatbot modal requiring chat input | **Non-intrusive Extension Sidecar** with 10-second action pills |

---

## 2. The 3-Layer Architecture

To ensure high reliability on local models (such as `Qwen 2.5 3B/7B` in LM Studio) and zero hallucinations in financial math, the system is strictly split into 3 layers:

```mermaid
flowchart TD
    subgraph LayerA["Layer A: Understand (Local LLM)"]
        A1["Classify Intent & Stage"]
        A2["Extract Entities & Quantities"]
        A3["Detect Missing Information"]
        A4["Draft Contextual Replies"]
    end

    subgraph LayerB["Layer B: Execute (Deterministic Backend Tools)"]
        B1["Catalog Search & Pricing"]
        B2["Order & Item Resolution"]
        B3["Quote & Tax Calculations"]
        B4["Commitment & Reminder Store"]
        B5["OCR & Transaction Matcher"]
    end

    subgraph LayerC["Layer C: Protect (Permissions & Validation)"]
        C1["Quantity & Amount Guards"]
        C2["Discount Limit Enforcer"]
        C3["Human-in-the-Loop Approval"]
        C4["Duplicate Action Prevention"]
    end

    LayerA -->|Structured JSON Request| LayerB
    LayerB -->|Computed Results| LayerC
    LayerC -->|Validated Action Card| LayerA
    LayerC -->|One-Click Confirm| UI["WhatsApp Extension Panel"]
```

### Layer A — Understand (Local LLM)
- **Role:** Understand informal, multilingual (English, Manglish, Malay, Chinese) chat messages.
- **Tasks:**
  - Classify intent (inquiry, modification, commitment, price pushback, receipt sent).
  - Extract structured order parameters (product keywords, variant, quantity, delivery location).
  - Identify missing details before the seller quotes or commits.
  - Draft response options (Professional, Casual/Friendly, Firm).

### Layer B — Execute (Deterministic Backend)
- **Role:** Perform 100% accurate database operations, mathematical calculations, and catalog lookups.
- **Compact Toolset (10 Operations):**
  1. `get_conversation_context(phone)`: Recent chat summary, open orders, and unfulfilled commitments.
  2. `search_products(query, category, limit)`: Fuzzy match catalog SKUs, stock levels, and tiers.
  3. `get_customer_orders(phone, limit)`: Fetch order history (enables "Same as last month" resolution).
  4. `prepare_order(customer_id, items, delivery_address, notes)`: Create draft order structure.
  5. `calculate_quote(items, discount_pct, delivery_fee)`: Pure deterministic math (subtotal, SST, total).
  6. `create_document_draft(type, order_id, terms)`: Generate editable Quotation or Invoice.
  7. `extract_document(file_id, doc_type)`: OCR extraction of payment receipts and supplier bills.
  8. `match_transaction(amount, date, reference, customer_id)`: Correlate payment with open invoices.
  9. `save_commitment(phone, promise_text, due_date, party)`: Log dated promises ("customer promises to pay Friday").
  10. `get_pending_actions(phone)`: Pending follow-ups, expiring quotes, unverified payments.

### Layer C — Protect (Permissions & Validation)
- **Role:** Safety net preventing financial errors or unwanted automated actions.
- **Guards:**
  - Ensures prices and discounts do not exceed salesperson authorization limits.
  - Prevents issuing duplicate invoices or sending messages without seller confirmation.
  - Requires explicit salesperson sign-off ("Approve & Send") for every business action.

---

## 3. The 6 Practical Sales Skills

```mermaid
graph LR
    S1["1. Conversation Intelligence"] --> S2["2. Chat-to-Order"]
    S2 --> S3["3. Sales Decision Assistant"]
    S3 --> S4["4. Document-from-Chat"]
    S4 --> S5["5. Commitment Tracker"]
    S4 --> S6["6. Money Reconciliation"]
```

### Skill 1: Conversation Intelligence
- **What it does:** Reads the current chat thread to identify:
  - Deal stage (Cold inquiry, Evaluation, Price objection, Closing, Post-sale).
  - Unanswered customer questions or unresolved objections.
  - Multilingual nuances ("Can discount sikit?", "Boleh hantar esok?").
- **Output:** 2-3 instant reply pills (e.g. `Consultative`, `Direct/Closing`, `Value-add`) with inserted real catalog prices.

### Skill 2: Chat-to-Order
- **What it does:** Converts messy WhatsApp text into a structured order.
  - Handles references like: *"Boss, same model as last month, but 20 units to Shah Alam"*.
  - Calls `get_customer_orders` to identify the SKU from last month.
  - Identifies missing fields: *"Missing: Confirm delivery charge & stock availability for 20 units"*.
- **Output:** Editable Order Card right inside the WhatsApp extension.

### Skill 3: Sales Decision Assistant
- **What it does:** Empowers the seller during price pushbacks:
  - Compares requested models with inventory stock levels.
  - Recommends authorized alternatives if an item is out of stock or over budget.
  - Displays permitted discount thresholds without revealing company margins to the buyer.
  - Provides objection-handling battlecards ("Client says competitor is RM50 cheaper").

### Skill 4: Document-from-Chat
- **What it does:** Single-data-entry pipeline:
  - Conversation $\rightarrow$ Draft Order $\rightarrow$ Quotation $\rightarrow$ Tax Invoice.
  - The salesperson never retypes customer name, address, SKU, or prices.
  - Generates PDF/shareable link with 1 click.

### Skill 5: Commitment Tracker (Promises over Scores)
- **What it does:** Detects temporal commitments made by either party:
  - *Customer:* "I will bank in by 3pm tomorrow" $\rightarrow$ Sets alert for tomorrow 3:30pm.
  - *Customer:* "Hold 10 units for me until Monday" $\rightarrow$ Logs soft reservation note.
  - *Seller:* "I will check with warehouse and let you know" $\rightarrow$ Reminds seller in 2 hours.
- **Output:** Actionable commitment checklist with Snooze / Done / Dismiss buttons.

### Skill 6: Money & Transaction Reconciliation (OCR as Evidence)
- **What it does:** Processes payment slips sent by customers:
  - OCR extracts: Bank name, Date & Time, Amount (RM), Recipient Name, Reference ID.
  - Matches against pending unpaid invoices for this customer.
  - **Crucial Rule:** Receipts are treated as *Evidence to Review*, not automatic proof of funds.
  - Shows side-by-side comparison: Slip Amount vs. Invoice Balance.
  - One-click "Confirm Received & Mark Paid" or "Flag Discrepancy".

---

## 4. The Core Prioritized Sales Pipeline

The single most valuable workflow to implement first:

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Customer (WhatsApp)
    actor Rep as Salesperson
    participant Ext as WhatsApp Sidekick UI
    participant LLM as Layer A (Understand)
    participant Backend as Layer B (Execute)

    Customer->>Rep: "Boss, need 20 units model X to Shah Alam. Best price?"
    Rep->>Ext: Clicks "Draft Order"
    Ext->>LLM: Pass recent messages
    LLM->>Backend: search_products("model X") & get_customer_orders(phone)
    Backend-->>LLM: Product SKU found: RM 350/unit, In Stock: 45 units
    LLM-->>Ext: Prepared Draft Order + Flag: "Delivery fee required for Shah Alam"
    
    Rep->>Ext: Enters RM 30 delivery fee, clicks "Generate Quote"
    Ext->>Backend: calculate_quote(items, delivery=30)
    Backend-->>Ext: Quote #QT-1042 generated (Total: RM 7,030)
    Ext-->>Rep: One-click "Send Quote PDF & Summary"
    
    Rep->>Customer: Sends Quote via WhatsApp
    Customer->>Rep: "Agreed. Here is the deposit transfer slip" (Uploads Image)
    
    Rep->>Ext: Clicks "Scan Slip"
    Ext->>Backend: extract_document(receipt_img)
    Backend-->>Ext: Extracted RM 2,000 | Match: Quote #QT-1042 | Status: Partial (RM 5,030 balance)
    Ext-->>Rep: Displays "Match Found: Deposit RM 2,000. Convert to Active Order?"
    Rep->>Ext: Clicks "Confirm & Issue Deposit Invoice"
    Ext->>Backend: create_document_draft("invoice", order_id)
```

---

## 5. OCR & Receipt Verification Flow

Receipt images are often forged, edited, or sent with wrong amounts. The system treats OCR as an evidence-parsing assistant, not a blind validator:

```mermaid
flowchart TD
    Img["Customer sends Receipt Image"] --> OCR["OCR & LLM Extraction (Date, Amount, Ref, Bank)"]
    OCR --> Match{"Match against Customer's Open Invoices?"}
    
    Match -->|Exact Match| Green["Status: Likely Match (e.g. RM 1,200.00)"]
    Match -->|Partial Match| Yellow["Status: Partial Payment (e.g. RM 500 of RM 1,200)"]
    Match -->|No Match / Duplicate Ref| Red["Status: Unmatched / Duplicate Reference Alert"]
    
    Green --> Card["Present Evidence Card in Sidekick UI"]
    Yellow --> Card
    Red --> Card
    
    Card --> RepReview["Salesperson verifies with Online Banking"]
    RepReview -->|Seller clicks 'Confirm Received'| Paid["Mark Invoice Paid / Partial & Record Audit Log"]
    RepReview -->|Seller clicks 'Dispute/Reject'| Reject["Draft polite query message: 'Slip shows RM 500 but invoice is RM 1,200'"]
```

---

## 6. Implementation Roadmap & Milestones

### Stage 1: Conversation Intelligence & Copilot Prompts (In Progress / Operational)
- [x] WhatsApp extension UI loading & cache buster fix.
- [x] Multi-style reply prompts (Consultative, Direct, Friendly) with catalog price insertion.
- [ ] Implement `get_conversation_context` tool with prompt caching.

### Stage 2: Chat-to-Order & Catalog Matching (Priority Next)
- [ ] Backend endpoint: `POST /api/v1/copilot/extract-order`.
- [ ] Product SKU fuzzy search with stock availability check.
- [ ] Missing information detector (missing address, variant, delivery details).
- [ ] Sidekick UI: Interactive Draft Order Card with "Edit" & "Confirm" buttons.

### Stage 3: Quotation & Invoice Generation (The Core Pipeline)
- [ ] Deterministic quote calculation tool (`calculate_quote` with SST/discounts).
- [ ] Conversion: `Draft Order` $\rightarrow$ `Quotation` $\rightarrow$ `Invoice`.
- [ ] 1-click shareable quote summary formatted for WhatsApp.

### Stage 4: Commitment Tracker
- [ ] Extract temporal commitments from chat text ("transfer tomorrow", "reserve till Friday").
- [ ] SQLite/PostgreSQL `commitments` table with status (`pending`, `completed`, `dismissed`).
- [ ] Sidekick UI: Commitment widget with 1-click snooze and completion tracking.

### Stage 5: OCR Evidence Extraction & Payment Reconciliation
- [ ] Tesseract/Vision OCR extraction endpoint for receipt images.
- [ ] Auto-match extracted amount and reference against customer's open balance.
- [ ] Sidekick UI: "Payment Evidence Card" with one-click verification and audit log.

### Stage 6: Sales Analytics & Multi-rep Support
- [ ] Customer order history drawer in sidebar.
- [ ] Receivables and overdue payment tracker.
- [ ] Performance and conversion metrics.

---

## 7. Verification & Testing Protocol

1. **Unit Testing:**
   - Execute `pytest test/unit` (maintain 100% green pass rate across all 109+ tests).
   - Add unit tests for `calculate_quote` (rounding, discounts, tax) and `save_commitment`.
2. **Schema & Contract Testing:**
   - Verify all 10 tools return valid Pydantic schemas.
3. **Manual Verification Workflow:**
   - Provide explicit, step-by-step instructions for the user to test the WhatsApp Sidekick extension on mock chats (no browser automation).
