# CashChase — User Flows, Single-Page UI & Local LLM Agent Spec

**Architecture Rule:** Strictly **2 user-facing interfaces** backed by **1 Next.js API & 4 Data Tables**:
1. **Chrome Extension Sidebar on `web.whatsapp.com`** (`chrome-extension/` + `/extension` embed)
2. **ONE Single-Page CashChase WebApp (`http://localhost:3000/`)** where Net Worth, Invoice Uploads, Phone Orders, Stock Count, and Invoices/Aftersales all live on a single screen.

---

## 1. Visual Architecture & How Everything Connects

```mermaid
flowchart TB
    subgraph WA_EXT["Interface 1: Chrome Extension Sidebar on web.whatsapp.com"]
        DOM["Content Script reads active chat name + messages\n& inserts drafted reply into WhatsApp input box"]
        SIDE["Extension Sidebar UI\n• Shows Live Available Stock\n• 1-Click Hold Stock & Insert Quote\n• 1-Click Submit Deposit / Aftersales Issue"]
        DOM <--> SIDE
    end

    subgraph ONE_PAGE["Interface 2: Single-Page CashChase WebApp (localhost:3000)"]
        NW["Section 1: Live Company Net Worth Banner\n• Core Net Worth = Cash on Hand + Stock Value\n• Full Net Position = Core + Pending In - Pending Out"]
        INP["Section 2: Zero-Friction Input Row\n• Drag & Drop Invoice OCR (Supplier / Cost / Customer)\n• 1-Line Phone Call Quick Key-In Bar"]
        STK["Section 3A: Live Stock Count Table\n• Physical On Hand | On Hold (48h) | Available | Value"]
        INV["Section 3B: Unified Quotes, Invoices & Aftersales Table\n• Confirm Deposit (Deduct Stock) | Replace -1 Stock | Discount | Resolve"]
        LOG["Section 4: Immutable Orbyte Activity Log & Excel Export"]
    end

    subgraph BACKEND["Shared Backend & Local LLM (Ollama / LM Studio / RunPod)"]
        API["POST /api/agent/analyze  ·  POST /api/actions/execute"]
        DB[("4 Core Tables:\n1. customers (with LHDN TIN)\n2. stock_items (on_hand, on_hold, unit_cost)\n3. invoices_quotes (QUOTE_HOLD | PENDING | AFTERSALES | SUPPLIER_COST)\n4. activity_logs")]
    end

    SIDE --> API
    INP & STK & INV --> API
    API --> DB
    DB --> NW & STK & INV & LOG
```

---

## 2. Step-by-Step User Flows (Click-by-Click)

### Flow 1: WhatsApp Inquiry → Quotation & 48-Hour Stock Hold
1. **Trigger:** Customer texts on WhatsApp: *"Boss, got 5 units Daikin 1.5HP and 5 bottles R32 gas? How much?"*
2. **Extension Reads & Checks:** The Extension Sidebar sends the message + current catalogue state to `/api/agent/analyze`.
3. **Rule Verification:**
   - Checks `Available Stock = Physical On Hand - Stock On Hold`.
   - Computes total from official catalogue prices (`5 × RM 1,150 + 5 × RM 180 = RM 6,650`).
4. **Human Action (1 Click):** Sales/Admin clicks **`[✅ Hold Stock (48h) & Insert Quote Reply]`**.
5. **Outcome:**
   - Creates `QT-104` (`QUOTE_HOLD`) on the Single-Page WebApp.
   - Increases `on_hold` by `+5` on both items with a **48-hour countdown timer** (**does NOT deduct `on_hand` yet!**).
   - Auto-fills the WhatsApp Web chat box with the formatted quote reply.

---

### Flow 2: Order Confirmed & Deposit Paid → Physical Stock Deduction
1. **Trigger:** Customer replies on WhatsApp with confirmation & deposit receipt (*"Confirm QT-104, banked in RM 2,000 deposit"*).
2. **Extension / WebApp Detection:** Matches `QT-104` and extracts `RM 2,000` deposit.
3. **Role Guardrail:** If logged in as `Sales/Admin`, button says **`[📤 Submit for Owner Confirmation]`**. If `Owner`, button says **`[🔒 Owner: Confirm Deposit & Deduct Physical Stock]`**.
4. **Outcome When Owner Confirms:**
   - Releases the 5 units from `on_hold` (`-5`) AND deducts them from physical `on_hand` (`-5`).
   - Increases `Cash on Hand` by `+RM 2,000`.
   - Converts `QT-104` into Pending Customer Invoice `INV-204` (`Balance: RM 4,650`).
   - Updates **Company Net Worth** and logs the Owner's confirmation.

---

### Flow 3: Ghosted Quote (48-Hour Auto-Release)
1. **Trigger:** A quoted customer does not pay the deposit within 48 hours (`QT-101` expires).
2. **Action:** System highlights `QT-101` as **`HOLD_EXPIRED`**. Staff or Owner clicks **`[🔓 Release Held Stock]`** (or auto-release runs on check).
3. **Outcome:** Returns the held units back to `Available Stock` so other customers can purchase them, and drafts a polite WhatsApp follow-up + LHDN TIN request.

---

### Flow 4: 1-Drop Invoice Upload (Supplier Stock, Operating Cost, Customer Receipt) & Phone Calls
Located directly in **Section 2 of the Single-Page WebApp**:
1. **Supplier Stock Invoice Upload (e.g., Bought `+20x R32 Gas @ RM 130 = RM 2,600`):**
   - AI OCR extracts supplier name, matched SKU (`GAS-R32`), quantity (`+20`), and total (`RM 2,600`).
   - Clicking **Confirm** increases `Physical Stock On Hand` (`+20 units`, `+RM 2,600 Stock Value`) and reduces `Cash on Hand` (`-RM 2,600`) or adds to `Unpaid Supplier Bills`.
2. **Operating Cost / Expense Bill Upload (e.g., Shop Rent / Delivery Van Fuel `RM 650`):**
   - AI OCR extracts payee and amount.
   - Clicking **Confirm** reduces `Cash on Hand` (`-RM 650`, reducing Core Net Worth) with no stock change.
3. **Customer Payment Receipt Upload (e.g., DuitNow `RM 1,650` for `INV-202`):**
   - Owner clicks **Confirm Payment** → Closes `INV-202` and increases `Cash on Hand` (`+RM 1,650`).
4. **Phone Call / Walk-In Quick Key-In:**
   - When a customer calls on the phone instead of WhatsApp, staff types 1 line in the **Phone Call Bar** (e.g., *"Hotel Seri Alam called, wants 2x Daikin 1.5HP"*) and clicks **`+ Create Quote (Hold Stock)`**.

---

### Flow 5: Money-First Aftersales (Right on the Invoice Row)
1. **Trigger:** Customer complains on WhatsApp (*"Boss, 1 bottle R32 from INV-201 valve leaking, I hold the RM 4,800 balance until you replace or discount"*).
2. **Automatic Guardrail:** CashChase immediately sets `INV-201` to **`AFTERSALES_PAUSED`** so payment reminders are blocked.
3. **Owner Resolution (1 Click in Extension or on the WebApp Invoice Row):**
   - **Option A — `📦 -1 Stock Replace`:** Deducts `1 unit` from `Physical Stock On Hand` as a warranty replacement cost (reducing Stock Value by `RM 130` so Company Net Worth stays accurate) and drafts the apology reply.
   - **Option B — `💸 -RM Discount`:** Reduces the `INV-201` balance (e.g., `-RM 180`) and drafts the updated invoice balance reply.
4. **Closing the Loop:** Once delivered (or if 3 days pass with no further complaint), the Owner clicks **`[✓ Mark Resolved]`** on the `INV-201` row to return it to normal `PENDING_PAYMENT` status.

---

### Flow 6: Adding Labor Cost & On-Site Extra Piping / Materials to an Invoice
In real contractor/service SMEs, quotes and invoices include **Labor Charges** plus **extra materials used on site** (e.g., extra copper piping, trunking, brackets, or gas top-up):
1. **Low-Startup Owner Labor & Cost Framework (4 Presets + 1-Sentence Custom Generator):**
   - To keep startup time under 15 seconds for any SME, the Owner can either click one of **4 Industry Labor Presets**:
     - **Preset 1 — Contractor / Aircond:** Per-unit installation labor (`RM 250/unit`, installer cost `RM 120`) + extra piping/parts (`RM 150/set`, deducts physical stock).
     - **Preset 2 — Software / Agency:** Base license/package + custom dev / Change Requests billed at `RM 600 / Man-Day` (internal dev cost `RM 250/day`).
     - **Preset 3 — Wholesale / F&B:** Standard delivery `RM 50/trip` (driver cost `RM 35`, free > `RM 1,500`) + urgent lorry rush `+RM 120`.
     - **Preset 4 — Custom Retail / PC Build:** Flat assembly labor `RM 80/order` (tech cost `RM 35`) + physical parts deducted on deposit.
   - **OR type 1 sentence in the Custom Framework Prompt:** e.g., *"We install solar panels: RM 400 labor per panel (subcon cost RM 180) and RM 25/m extra DC cable"* → Clicking **`⚡ Generate Rules`** formats it into the structured `OWNER_BUSINESS_AND_LABOR_FRAMEWORK` block injected into `qwen3:4b`.
2. **Adding Extra Piping & Labor to an Active Invoice (`➕ Add Extra Pipe / Labor`):**
   - Triggered via **WhatsApp Extension** (*"Site used 2 extra sets copper pipe + installation labor"*), the **Phone Call Bar**, or the **`➕ Add Pipe / Labor`** button right on any `PENDING` invoice row.
   - **Automatic Stock & Net Worth Impact:**
     - **Extra Stock Used (`-2x Copper Pipe Set`):** Deducts `-2` from `Physical Stock On Hand` (`-RM 192 Stock Value`) and adds `+RM 300` (`2 × RM 150 sell price`) to the Customer's Pending Invoice balance.
     - **Labor Charge & Installer Cost:** Adds `+RM 350` (Customer Labor Charge) to the Customer's Pending Invoice balance, and deducts `-RM 150` (Installer/Subcon Labor Cost) from `Cash on Hand` (or adds to `Payables`).
     - Drafts an updated WhatsApp invoice summary for the customer in 1 click.

---

## 3. Agent Formatted Text Specification (Local LLM First)

To make sure a fast **Local LLM** (`Ollama` or `LM Studio` running `qwen2.5:7b` or `llama3.1:8b`) returns 100% reliable results without hallucinating prices or math, we use a **strict Input Text Envelope** and **strict JSON Output Schema**.

### 3.1 Environment Configuration (`.env.local`)
```env
# Option 1: Local LLM via Ollama (Default for fast, free local dev)
LLM_PROVIDER="local"
LLM_BASE_URL="http://localhost:11434/v1"
LLM_MODEL="qwen2.5:7b"

# Option 2: RunPod Serverless vLLM (For cloud demo)
# LLM_PROVIDER="runpod"
# LLM_BASE_URL="https://api.runpod.ai/v2/<ENDPOINT_ID>/openai/v1"
# LLM_API_KEY="rp_..."

# Always keep pre-verified demo cache enabled as instant fallback
ENABLE_DEMO_CACHE="true"
```

### 3.2 Exact Formatted Text Sent TO the Agent (`buildAgentPrompt()`)
```text
=== CASHCHASE AGENT INPUT ===
SME_COMPANY: Sejuk Jaya Aircond Sdn Bhd
USER_ROLE: OWNER
STOCK_HOLD_POLICY: 48 hours (Quotes only hold stock; physical stock deducts only after deposit confirmed)
CUSTOMER: Tan Bros Trading (+60 12-345 6789 | LHDN_TIN: C2088391020)
OPEN_RECORDS_FOR_CUSTOMER:
  - Quote #QT-104 | Amount: RM 6650 | Status: ON_HOLD_48H | Items: 5x ACN-DAI-15, 5x GAS-R32
CATALOGUE_STATE:
  - [SKU: ACN-DAI-15] Daikin 1.5HP Inverter Unit | Cost: RM 850 | Sell: RM 1150 | OnHand: 8 | OnHold: 3 | Available: 5
  - [SKU: GAS-R32] R32 Refrigerant Gas (3kg)     | Cost: RM 130 | Sell: RM 180  | OnHand: 15 | OnHold: 0 | Available: 15
  - [SKU: PIP-COP-3M] Copper Pipe 3m Set         | Cost: RM 96  | Sell: RM 150  | OnHand: 15 | OnHold: 2 | Available: 13
INPUT_SOURCE: WHATSAPP_EXTENSION
MESSAGE_TEXT:
"Boss, got 5 units Daikin 1.5HP and 5 bottles R32 gas? How much ah? Need quote urgently."
=============================
```

### 3.3 Exact JSON Schema Returned BY the Agent (`AgentProposalSchema`)
```json
{
  "intent": "CREATE_QUOTE_HOLD",
  "confidence": 0.95,
  "customerName": "Tan Bros Trading",
  "matchedRecordId": null,
  "items": [
    { "sku": "ACN-DAI-15", "qty": 5 },
    { "sku": "GAS-R32", "qty": 5 }
  ],
  "extractedAmountRM": null,
  "buyerTinExtracted": null,
  "requiresOwnerApproval": false,
  "stockEffect": "HOLD_ONLY_48H",
  "summaryReason": "Customer requested quote for 5x Daikin 1.5HP and 5x R32 Gas. All items available in stock.",
  "draftWhatsAppReply": "Hi Tan Bros! Both in stock. Quote #QT-104 for 5x Daikin 1.5HP (RM 5,750) + 5x R32 Gas (RM 900) = RM 6,650. We have placed these items ON HOLD for 48 hours—send deposit anytime to confirm!"
}
```

**Allowed `intent` values (6 deterministic routes):**
- `CREATE_QUOTE_HOLD` — Places items `On Hold (48h)` and builds Quotation.
- `CONFIRM_DEPOSIT_DEDUCT` — Owner confirms deposit; converts `On Hold` → `-Physical Stock` & `+Cash`.
- `AFTERSALES_ISSUE` — Pauses invoice chasing; proposes `-1 Stock Replace` or `-RM Discount`.
- `RELEASE_EXPIRED_HOLD` — Releases expired 48h quote hold back to `Available Stock`.
- `UPLOAD_BILL_EXTRACTED` — Used when OCRing a Supplier Stock Bill, Cost Bill, or Customer Receipt.
- `SAVE_LHDN_TIN` — Extracts Buyer TIN / SSM BRN from WhatsApp reply into Customer record.

---

## 4. Database Schema (4 Simple Tables)

Whether stored in SQLite / PGlite or JSON state for the 5-day prototype, the entire app needs only **4 tables**:

1. **`customers`**: `id`, `name`, `phone`, `tin_number`, `ssm_number`, `lhdn_ready`
2. **`stock_items`**: `sku`, `name`, `on_hand`, `on_hold`, `hold_note`, `unit_cost`, `sell_price`
3. **`invoices_quotes`**: `id`, `type` (`QUOTE_HOLD` | `PENDING` | `AFTERSALES` | `SUPPLIER_COST` | `PAID_DONE`), `party_name`, `items_json`, `amount`, `status`, `hold_expires_at`, `lhdn_status`
4. **`activity_logs`**: `id`, `timestamp`, `actor_role`, `action_type`, `description` (Append-only)
