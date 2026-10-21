# CashChase for Orbyte — Master PRD (Redesigned v7.0)

**Event:** SDC Hackathon 2026 · Domain 2: Orbyte Smart SME Challenge ("Less Busywork, Better Business")  
**Sponsor:** Alpha Red Solutions Sdn Bhd  
**Target Users:** Owners and Sales/Admin staff at Malaysian micro & small businesses (3–20 staff)  
**Architecture:** 1 Chrome Extension Sidebar on `web.whatsapp.com` (`extension/`) + 1 Sidebar WebApp served by the FastAPI backend at `localhost:8000` (pages: *Overview & Net Worth*, *Invoices & Quotes*, *Stock & 48h Holds*, *Ledger*, *WhatsApp Simulator*, plus the *SME Profile & AI Labor Rules* settings)  
**Stack (as built):** Python FastAPI + SQLite (`backend/`) · plain HTML/JS + Tailwind CDN (`webapp/`) · Chrome Extension MV3 (`extension/`) · LM Studio local OpenAI-compatible API (`http://127.0.0.1:1234/v1`)

---

## 1. One-Sentence Pitch (Explain-It-Back Test)

> **"Small businesses run sales on WhatsApp and track stock & invoices in messy spreadsheets. CashChase connects a WhatsApp Web Extension Sidebar to an All-in-One Stock & Invoice Hub—so SME staff can quote, hold stock, upload supplier/cost bills, handle aftersales replacements, and track live Company Net Worth (`Cash + Stock`) in one click with zero manual data entry."**

---

## 2. The Problem We Solve

### 2.1 Daily Friction in Malaysian Micro-SMEs
In 80% of micro and small businesses (air-cond contractors, spare-parts suppliers, small wholesalers, hardware shops), daily operations happen across **WhatsApp chats, PDF bills, phone calls, and disconnected Excel sheets**:
1. **Ghost Quotes vs. Oversold Stock:** Sales staff send quotes on WhatsApp without locking stock. Either two staff members promise the same stock to different customers (**overselling**), or staff hold stock mentally for a customer who ghosts them (**lost sales**).
2. **Manual Copy-Pasting:** Admin staff spend evenings re-typing WhatsApp orders, supplier stock invoices, operating expenses, and payment receipts into spreadsheets.
3. **Blind Payment Chasing During Aftersales Issues:** A customer reports a faulty unit on WhatsApp and withholds balance payment, but nobody updates the invoice tracker—leading to embarrassing payment reminders or unrecorded warranty stock replacements.
4. **Zero Visibility Into Real Company Net Worth:** Micro-SME owners don't read complex accounting balance sheets. They simply want to know: *"How much Cash and Physical Stock do I actually have right now, and how much money is coming in vs. going out?"*

---

## 3. What Makes CashChase Special (Our 3 Unfair Advantages)

| Existing Market Tool | Why It Fails Micro-SMEs | What CashChase Does Differently |
|---|---|---|
| **1. Spreadsheets + WhatsApp** | High manual friction; no live link between a WhatsApp quote and available warehouse stock. | **Chat-Triggered 48h Stock Hold & Auto-Release:** Quoting from the WhatsApp Extension locks stock **`On Hold for 48h`** without deducting physical stock. If unconfirmed after 48h, it **auto-releases** for other customers. Physical stock only deducts when the order & deposit are confirmed. |
| **2. Accounting ERPs** *(AutoCount, SQL, Bukku)* | Built for accountants, not frontline sales; blind to WhatsApp chats; requires heavy setup and manual data entry. | **1-Drop Bill Upload & Live Company Net Worth (`Cash + Stock`):** Drop any Supplier Stock Bill, Cost Bill, or Customer Receipt into the single-page WebApp to update Stock Count and Net Worth automatically—plus a 1-click Monthly Excel export for their bookkeeper. |
| **3. WhatsApp Chatbots** *(Wati, Respond.io)* | Blind to inventory levels and invoice balances; spams customers even when an item is faulty. | **Money-First Aftersales Guardrail:** Detects Malay/English/Manglish complaints on WhatsApp, **auto-pauses payment reminders** on that invoice, and lets the Owner resolve it in 1 click (**`-1 Replacement Stock`** or **`-RM Discount`**). |

---

## 4. The Core Automated Journey (Domain 2 Rubric Alignment)

Every flow in CashChase follows the 5 mandatory steps required by the Domain 2 rubric:

```
[1. Trigger] ──► [2. Connected Data] ──► [3. Decision Logic (AI + Rules)] ──► [4. Human Approval] ──► [5. Visible Outcome + Audit Log]
```

1. **Trigger:**
   - Customer messages on WhatsApp (*Buying Inquiry*, *Deposit Paid*, or *Aftersales Faulty Item*), **OR**
   - Customer calls on the phone (staff types a 1-line note in the WebApp), **OR**
   - Staff drags & drops a Supplier Stock Invoice, Operating Expense Bill, or Payment Receipt PDF into the WebApp.
2. **Connected Data:**
   - CashChase pulls together **Customer Profile (including LHDN TIN status)** + **Live Stock Count (`Physical On Hand`, `On Hold`, `Available`)** + **CashFlow & Pending Invoices**.
3. **Decision Logic (AI Proposes, Rules Decide):**
   - **AI (LM Studio local LLM, e.g. `qwen3-vl-4b-instruct`; RunPod planned, not yet wired in code):** Reads unstructured WhatsApp chats (English, Malay, Manglish) and OCRs uploaded PDF/image bills into a strict JSON schema.
   - **Deterministic Rules (Code):** Checks `Available = On Hand - On Hold`, calculates exact prices from the catalogue, sets the 48-hour hold expiry timer, enforces role limits, and computes **Company Net Worth**.
4. **Human Approval (People Stay in Control):**
   - **Sales/Admin Staff:** Can 1-click approve routine Quotations (putting stock `On Hold`), insert WhatsApp replies, and upload draft bills.
   - **Company Owner:** Must approve consequential financial/stock actions: confirming customer Deposits/Payments (which deducts physical stock and increases Cash), approving Supplier Stock/Cost bills above threshold, applying Aftersales Stock Replacements (`-1 Stock`) or Discounts (`-RM`), and marking Aftersales issues `Resolved`.
5. **Visible Outcome & Activity Log:**
   - Reply/Quote inserts directly into WhatsApp Web; **Stock Count** and **Company Net Worth (`Cash + Stock Value`)** update immediately on the WebApp; and an immutable entry is written to the **Activity & Audit Log**.

---

## 5. Business Formulas & Rules

### 5.1 Stock Count States
- **Physical Stock On Hand (`on_hand`):** Actual units physically in the storeroom.
- **Stock On Hold (`on_hold`):** Units temporarily reserved by active Quotations (default **48-hour expiry timer**).
- **Available to Sell (`available`):**
  $$\text{Available Stock} = \text{Physical Stock On Hand} - \text{Stock On Hold}$$
- **Stock Deduction Rule:** Sending a Quotation **only** increases `on_hold`. Physical `on_hand` is **only** deducted when:
  1. The customer confirms the order and the **Owner confirms the deposit/invoice**, OR
  2. The **Owner approves a `-1` Aftersales Warranty Replacement**.

### 5.2 Company Net Worth & CashFlow Formulas
- **Physical Stock Value:**
  $$\text{Total Stock Value} = \sum \left(\text{Physical Stock On Hand} \times \text{Unit Cost}\right)$$
- **Core Company Net Worth (Liquid Cash + Physical Stock):**
  $$\text{Core Net Worth} = \text{Cash on Hand} + \text{Total Stock Value}$$
- **Full Adjusted Net Position (Including Pending Invoices):**
  $$\text{Full Net Position} = \text{Core Net Worth} + \text{Pending Customer Receivables} - \text{Pending Supplier/Cost Payables}$$

### 5.3 Role-Based Permissions (Simulated Orbyte RBAC)

> **Current repo status:** the Owner/Staff switch (`toggleRole()` in `webapp/index.html`) is UI-only. API requests carry `role` in the request body (default `OWNER`), so the backend does not yet enforce this table. Server-side 403 checks are a TODO (see `03_Five_Day_Phased_Build_Plan.md`, Phase 4).

| Action | 👤 Sales / Admin Staff | 👑 Company Owner |
|---|---|---|
| Read WhatsApp chat via Extension, generate Quote (`Stock On Hold`), insert reply | ✅ Allowed (1-Click) | ✅ Allowed |
| Key in Phone Call Quote or upload draft Supplier/Cost/Customer Invoice | ✅ Allowed | ✅ Allowed |
| Release an expired 48h Quote Stock Hold | ✅ Allowed | ✅ Allowed |
| **Confirm Customer Deposit / Payment** (converts `On Hold` → `-Physical Stock` & `+Cash`) | 🔒 Submits for Owner Approval | ✅ Allowed |
| **Approve Supplier Stock Bill / Operating Expense Payment** (`-Cash`) | 🔒 Submits if > RM 1,000 | ✅ Allowed |
| **Approve Aftersales Stock Replacement (`-1 Stock`) or Discount (`-RM`)** | 🔒 Submits for Owner Approval | ✅ Allowed |
| **Mark Aftersales Issue Resolved** (resumes payment follow-up) | 🔒 Owner Only | ✅ Allowed |
| **Export Monthly Bookkeeper / LHDN Excel (`.xlsx`) & Switch SME Profile** | 🔒 Owner Only | ✅ Allowed |

---

## 6. How CashChase Fits Orbyte & Scales Across SMEs

1. **Complements Orbyte Without Overlap:** Orbyte manages **internal HR & team workflows** (`eLeave`, `eClaim`, `Attendance`). CashChase adds the **external Commercial, Stock & CashFlow loop**, plugging into Orbyte's simulated Role Switcher, Approval Inbox, and Audit Log.
2. **60-Second Zero-Typing Setup for Any SME:**
   - Any SME (the repo ships 3 profiles: Air-cond contractor *Sejuk Jaya*, Software Studio *NexaByte IT*, Wholesale F&B *Kopi & Bakery*) sets up CashChase in 3 steps:
     1. Pick an industry template **or** drop their existing `Stock_List.xlsx` / past 3 Supplier Invoices into the upload box (AI auto-builds their catalogue).
     2. Enter 1 number: **Starting Cash on Hand**.
     3. Set their **Quote Hold Timer** (default `48h`) and **Owner Approval Threshold** (default `RM 1,000`).
3. **Malaysian LHDN e-Invoice Readiness & Bookkeeper Export:**
   - Tracks Buyer `TIN` & `SSM BRN` on customer records (with a 1-click WhatsApp TIN request helper) and exports a clean multi-sheet `.xlsx` for their monthly bookkeeper—without performing live statutory filings.
4. **PDPA & Data Privacy:**
   - Uses 100% synthetic data for demonstration. In production, customer phone numbers and invoice documents are scoped strictly by tenant RBAC, never used to train external models, and logged with full audit traceability.
