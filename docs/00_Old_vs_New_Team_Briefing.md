# DealPilot — Old vs. New Plan: Team Briefing Guide

Use this document to brief your teammates and get their feedback on why we simplified and refocused the old `.md` files into the new DealPilot design.

---

## 1. Why We Changed the Old `.md` Files (The Core Problem)

When we reviewed the official **Domain 2 Rubric (`Copy of Domain 2 (1).pdf`)**, we noticed 3 critical rules from the judges:
1. **"Focus: demo one clear use case."**
2. **"Clarity of Proposal (20%): Someone hearing it cold could explain it back."**
3. **"Add a distinct SME business capability, not reproduce Orbyte's existing HR and administrative functions."**

### What Was Wrong With the Old Plan (`old md/`):
- **Too Many Disconnected Modules (8 Screens, 6 Agents):** The old plan tried to build Debt Collection + Customer Support Ticketing + Technician Leave Scheduling + Supplier Purchase Order Splitting + Accounting Ledger + AI Chat Copilot all at once. Nobody hearing it cold could explain what our product actually was.
- **Overlapped With Orbyte's HR/Admin Features:** Checking technician leave (`Faiz on leave`) and scheduling service technicians belongs to Orbyte's internal HR/Work modules—not a commercial cash/stock tool.
- **WhatsApp Cloud API Webhook Friction:** Setting up Meta Business Verification, 24-hour window blocks, utility template approvals, and ngrok tunnels takes days and breaks easily during a live demo.
- **High Friction for SME Staff:** Forcing an admin or sales person to click across 8 different pages (`Dashboard`, `Collect`, `Care`, `Stock`, `Ledger`, `Guard`, `Ask`) creates *more* busywork instead of less.

---

## 2. Side-by-Side Comparison: Old Plan vs. New Plan

| Area | Old `.md` Plan (`old md/`) | New DealPilot Plan (`docs/`) | Why the New Plan is Better |
|---|---|---|---|
| **One-Sentence Pitch** | *"Collect · Care · Stock · Ledger — 4 agents checked by Guard for service jobs"* | **"WhatsApp Extension + 1-Page Stock & Invoice Hub that tracks Stock Holds, CashFlow, and Company Net Worth (`Cash + Stock`) in 1 click."** | Anyone can explain it back in 10 seconds. |
| **Target User** | Admin + Owner + Service Technicians | **Owner + Sales/Admin Staff** at 3–20 person micro-SMEs (currently using WhatsApp + Excel). | Focused user persona; zero HR/technician overlap with Orbyte. |
| **WhatsApp Integration** | Meta WhatsApp Cloud API + Webhooks + 24h Window + Meta Template Approvals | **Chrome Extension Sidebar on `web.whatsapp.com`** (reads active chat, checks stock, inserts reply/quote in 1 click). | Zero Meta API approval delays, no 24h window blocks, naturally Human-in-the-Loop. |
| **WebApp Layout** | **8 separate routes** (`/login`, `/dashboard`, `/collect`, `/care`, `/stock`, `/ledger`, `/guard`, `/ask`) | **ONE WebApp (`webapp/index.html`, `localhost:8000`)** with a left sidebar: Overview & Net Worth, Invoices & Quotes (upload + phone key-in), Stock & 48h Holds, Ledger, WhatsApp Simulator. | Far less UI code than 8 routes; everything one click away for staff. |
| **Stock Count Logic** | Only checked stock when a complaint ticket needed repair parts; generated split supplier POs. | **Live Stock Count (`On Hand` vs. `On Hold`):** Quotes lock stock **`On Hold for 48h`** (auto-releases if customer ghosts); physical stock **only deducts** when order + deposit is confirmed! | Solves a huge real-world SME pain point: overselling stock vs. ghosted quotations. |
| **Invoice Upload & Key-In** | Only uploaded customer DuitNow payment screenshots. | **1-Drop AI OCR Upload** for **Supplier Stock Bills** (`+Stock, -Cash`), **Cost/Expense Bills** (`-Cash`), & **Customer Receipts** (`+Cash`), plus a **1-Line Phone Call Bar** for phone orders. | Zero manual typing whether a supplier sends a PDF bill or a customer calls on the phone. |
| **Company Financial View** | Complex `Cash Health` formula (`0.8 / 0.6 / 0.4` risk weights + 30% PO split rule). | **Plain-English Company Net Worth:**<br>• **Core Net Worth** = `Cash on Hand + Physical Stock Value`<br>• **Full Net Position** = `Core + Pending Receivables − Pending Payables` | Micro-SME owners immediately understand *"How much Cash + Stock do I have right now?"* |
| **Aftersales / Customer Care** | Separate `/care` module with ticket states, technician availability, and repair scheduling. | **Money-First Aftersales right on the Invoice Row:**<br>1. Auto-pauses payment reminders<br>2. **1-Click Replace Stock (`-1 Stock`)** or **Discount (`-RM`)**<br>3. **1-Click Owner `Mark Resolved ✓`** | Ties aftersales 100% to Stock Value and Invoice Balance without building a ticketing system. |
| **External Systems & LHDN** | Ignored how SMEs onboard or handle Malaysia's LHDN e-Invoicing. | **60-Second Onboarding** (pick template or drop old Excel/bills), **LHDN TIN Collector on WhatsApp**, and **1-Click Monthly Excel Export** for bookkeepers. | Realistic for Malaysian micro-SMEs without needing live ERP integrations. |
| **AI Model Setup** | Mandated live RunPod vLLM cold-starts for 7 separate AI skills. | **1 Structured Agent Endpoint** (`POST /api/whatsapp/analyze`) on **LM Studio** (local, `qwen3-vl-4b-instruct`), plus a built-in deterministic fallback. RunPod is planned in `.env.example` but not wired in yet. | Free and fast to test locally on laptops; zero risk of RunPod cold-start failing the demo. |

---

## 3. The 4 Key Flows to Brief Your Friends On

When explaining the new flow to your team, walk through these **4 scenarios**:

1. **Flow 1 — Customer Asks for Price/Stock on WhatsApp (`Inquiry → 48h Stock Hold`):**
   - Customer asks on WhatsApp: *"Boss, got 5x Daikin 1.5HP and 5x R32 Gas? How much?"*
   - The **WhatsApp Extension Sidebar** checks `Available Stock (On Hand - On Hold)`, builds Quote `#QT-104`, and lets staff click **1 button** to paste the quote into WhatsApp and lock those units **`ON HOLD for 48 hours`**.
   - **Key rule:** Physical stock is **not** deducted yet! If the customer ghosts for 48 hours, the hold auto-releases so other customers can buy.
2. **Flow 2 — Customer Confirms & Pays Deposit (`Deposit → Deduct Physical Stock`):**
   - Customer sends deposit receipt on WhatsApp.
   - **Owner** clicks **`Confirm Deposit & Deduct Stock`** → Moves the units from `On Hold` to **`Deducted (-Physical Stock)`**, adds Deposit to **`Cash on Hand`**, and creates a **`Pending Customer Invoice`** for the balance.
3. **Flow 3 — Uploading Supplier Stock Bills, Expenses, or Taking Phone Calls (`WebApp Input Row`):**
   - Drop a **Supplier Stock Invoice PDF** → AI extracts items (`+20x R32 Gas`) → Clicking Confirm adds **`+20 Physical Stock On Hand`** (`+Stock Value`) and deducts **`Cash on Hand`** (or adds to `Payables`).
   - Drop an **Operating Cost Bill** (rent/utilities) → Deducts **`Cash on Hand`**.
   - Customer **calls on the phone** instead of WhatsApp → Type 1 sentence in the **Phone Call Quick Key-In bar** on the WebApp to create a Quote & Stock Hold immediately.
4. **Flow 4 — Customer Complains About a Faulty Item (`Money-First Aftersales`):**
   - Customer messages on WhatsApp: *"1 bottle R32 leaking, I hold balance payment first."*
   - DealPilot **auto-pauses payment chasing** on that invoice (`Aftersales Paused`).
   - Owner clicks **1 button** right on the invoice: either **`Replace -1 Stock`** (deducts 1 unit from Stock Count as warranty cost, updating Net Worth) OR **`Apply -RM Discount`**, then clicks **`Mark Resolved ✓`** to resume normal invoice status.

---

## 4. Questions to Ask Your Friends / Teammates

1. **UI Layout:** Run `start_cashchase.bat` and open `http://localhost:8000` in Chrome—do we all agree on having **only 2 interfaces** (the **WhatsApp Extension Sidebar** + the **sidebar WebApp**)?
2. **Stock Hold Rule:** Is the **48-hour Quote Hold → Deposit Deducts Stock** rule clear to everyone?
3. **Aftersales Scope:** Does everyone agree with keeping Aftersales strictly on the Invoice row (`Pause Chasing` + `-1 Stock Replace` or `-RM Discount` + `Mark Resolved`) instead of building a separate technician ticketing page?
4. **Task Split:** Who wants to take:
   - **Person 1:** FastAPI backend + SQLite state + Net Worth & Stock Hold Math + server-side role checks (`backend/`, `Phase 1` + `Phase 4`)
   - **Person 2:** WebApp UI — Overview, Invoices & Quotes, Stock, Ledger pages (`webapp/`, `Phase 2`)
   - **Person 3:** LM Studio Agent Prompt/JSON (`backend/services/prompts.py`) + Chrome Extension Sidebar on WhatsApp Web (`extension/`, `Phase 3`)
   - **Person 4:** Seed Data (Aircond + F&B profiles), Excel Export, Pitch Deck & Demo Video (`Phase 4`)
