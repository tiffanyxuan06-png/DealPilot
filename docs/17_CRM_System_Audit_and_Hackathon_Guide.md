# CashChase CRM System Audit & Hackathon Guide

> **Executive Summary:** CashChase is **not** broken or unusable garbage. Approximately **85–90% of the core system is fully built and operational**, backed by automated SQLite schema migrations, 90+ unit tests, a complete FastAPI backend, a responsive 6-screen WebApp, and a WhatsApp Web Chrome extension.
>
> The perceived chaos stems from an architectural pivot: transitioning from an inventory/cashflow hold tracker ("Old CashChase") to a **WhatsApp Sales CRM & Pipeline** ("New CashChase"). This audit clarifies what is done, what is pending, what makes it compelling as a CRM, and exactly how to test and demo it for the hackathon.

---

## 1. Executive Status: What Is Done vs. What Is Not

### ✅ What Is Done & Working

1. **Pipeline & Deals Engine (`backend/routes/deals.py`, `backend/db/`):**
   - 5 standard deal stages: `INQUIRY` $\rightarrow$ `QUOTED` $\rightarrow$ `FOLLOW_UP` $\rightarrow$ `WON` / `LOST`.
   - Complete state transitions: `SEND_QUOTE`, `SEND_FOLLOW_UP`, `MARK_WON`, `MARK_LOST` (with mandatory loss reasons), `APPLY_DISCOUNT`, and `CANCEL_WON`.
   - 48-hour follow-up timers with automatic overdue tracking.

2. **Sales Reps & Commission System (`backend/routes/deals.py`, `backend/routes/team.py`):**
   - Rep profiles with configurable commission percentages.
   - Dynamic monthly commission calculations and real-time leaderboard ranks.
   - Open deal pipeline tracking with projected commission (`potentialRm`).
   - One-click customer/deal reassignment between reps.

3. **Deterministic Pricing & Margin Guard (`backend/services/prompts.py`, `permissions.py`):**
   - **Layer B Architecture:** Large Language Models **never** compute prices, discounts, or margins. All calculations are executed by deterministic Python catalog lookups.
   - Quotation prices strictly match the product price list.
   - Margin floor enforcement: staff cannot offer discounts below minimum margin without triggering an Owner Approval workflow.

4. **Owner Approvals & Append-Only Audit Trail:**
   - Role-based separation: Owner (`Encik Hafiz`) vs. Staff (`Aina`).
   - Sensitive actions (unauthorized discounts, deal cancellations) queue for owner approval.
   - Database triggers enforce an append-only audit log.

5. **Exports & Document Generation (`backend/routes/exports.py`, `backend/routes/deals.py`):**
   - One-click **Won Orders CSV export** (`/api/export/orders.csv`).
   - Formal **Quotation PDF generator** including required Malaysian disclaimer terms (*"Subject to stock availability · prices valid 7 days"*).

6. **AI Understanding & Fallback Layer (`backend/services/pipeline.py`, `lmstudio.py`):**
   - Local LLM integration (LM Studio, `Qwen 2.5` / `Qwen 3 VL`) for multi-lingual chat comprehension (English, Manglish, Bahasa Melayu).
   - Built-in **deterministic fallback engine**: if the local LLM is offline or times out, the system automatically falls back to deterministic rule matching so the demo never fails.

7. **Front-End User Interfaces (`webapp/index.html`, `webapp/js/`):**
   - **Pipeline Dashboard:** High-level KPIs (Active Value, Won This Month, Win Rate, Overdue Count) and stage breakdown cards.
   - **Deals & Quotations Table:** Instant stage filtering (`All`, `Inquiry`, `Quoted`, `Follow-up`, `Won`, `Lost`), rep filtering, and action triggers.
   - **Product Catalog:** Interactive pricing, unit costs, and profit margin displays.
   - **Customers Hub:** Customer database, assigned reps, and LHDN TIN/SSM numbers.
   - **Commission Ledger:** Rep performance rankings and commission payout summaries.
   - **WhatsApp CRM Simulator:** Fully interactive chat sandbox to demo the WhatsApp extension workflow without requiring real WhatsApp Web.

---

### ❌ What Is Incomplete or Lingering Clutter

1. **Legacy Mock Residue in `webapp/js/state.js`:**
   - The fallback mock dataset (`smeProfiles`) still contains old properties from the inventory pivot (`onHold`, `holdExpiresAt`, `AFTERSALES_PAUSED`, `claimedAmount`). When backend syncing is disconnected, the UI may show older terminology.
2. **Pytest CPU Latency on Live LLM Tests:**
   - Tests in `test_consultation_intent.py` query the local LM Studio model without mocking. Running these on CPU takes 20–30s per test, making full test suites feel frozen.
3. **Extension Auto-Trigger on Active Chat:**
   - The WhatsApp Chrome extension triggers analysis when navigating chats rather than strictly gating execution behind an explicit "Analyse" button click or an approved customer allowlist.
4. **Documentation Overload:**
   - `docs/` contains 18 separate planning documents generated across multiple iterations. Only `docs/00_Old_vs_New_Team_Briefing.md` and `docs/15_WhatsApp_Sales_Sidekick_Plan.md` represent the current architecture.

---

## 2. CRM Assessment: What Is Good vs. Bad

| Dimension | The Good (Hackathon Strengths) | The Bad / Limitations (Commercial CRM Comparison) |
| :--- | :--- | :--- |
| **User Workflow** | **Zero context switching:** Sales reps generate, review, and send formal quotes directly from WhatsApp Web without opening heavy CRM tabs. | **WhatsApp & Phone-Order Only:** No native email tracking, calendar sync, or omnichannel ticketing. |
| **Data & Math Integrity** | **Deterministic Layer B:** The AI interprets intent, but deterministic code prices the items. No hallucinated math or runaway discounts. | **Evidence-Based OCR vs Bank Webhooks:** Bank transfer slips are parsed as evidence for human review, not reconciled via live open-banking APIs. |
| **Governance & Security** | **Owner Guardrails:** Staff cannot bypass margins or erase deals. Actions are logged to an append-only audit table. | **Single-Tenant SQLite:** Defaults to a local SQLite database; not a multi-tenant cloud SaaS. |
| **Market Fit (Malaysia)** | Tailored for Malaysian micro-SMEs: Manglish/BM phrasing, SST compliance, DuitNow slip parsing, and LHDN e-Invoice TIN collection. | Currency and tax rules are fixed to RM and Malaysian e-Invoicing. |

---

## 3. User Friendliness Audit

### 👍 What Works Seamlessly
- **1-Click WhatsApp Insertion:** Generates multi-style replies (Professional, Casual Manglish, Malay) and inserts them directly into the active chat box.
- **Staff "My Day" Screen:** When switching to Staff view (`Aina`), complex financial charts are replaced by an actionable daily follow-up checklist.
- **Top Header Role Switcher:** Instant one-click toggle between `Owner` and `Staff` modes to clearly demonstrate access control to judges.
- **Demo Fast-Forward Button:** Simulate the passage of 48 hours in one click to showcase expired quotations and overdue follow-up alerts immediately.

### 👎 Areas That Cause Friction
- **Overcrowded Settings Modal:** Combines company setup, permission toggles, margin rules, and AI server endpoints in a single window.
- **Mixed Vocabulary:** Legacy terms like *"Stock Hold"* occasionally appear alongside new CRM concepts like *"Deals"* and *"Follow-up Due"*.

---

## 4. UI Health & Linking Status

- **Static Assets:** All local scripts (`tailwindcss`, `state.js`, `dashboard.js`, `copilot.js`, `pdf_export.js`, `team.js`, `onboarding.js`) and stylesheets are verified and link without 404 errors.
- **FastAPI Endpoints:** 41 registered API endpoints covering deals, actions, permissions, exports, onboarding, and sidekick tools.
- **Offline Reliability:** If local LM Studio or external CDNs are unavailable, deterministic fallbacks and local styles keep the interface functional.

---

## 5. Step-by-Step Testing & Demo Guide

### Step 1: Run Fast Deterministic Unit Tests
Run the deterministic verification suite in your terminal:
```powershell
python -m pytest test/unit/test_dashboard_numbers.py test/unit/test_deals.py test/unit/test_pipeline.py test/unit/test_sidekick_tools.py test/unit/test_sales_flow.py test/unit/test_data_layer.py -v
```
*Expected: 57 tests pass in ~10 seconds with zero external dependencies.*

### Step 2: Launch the CashChase Server
Start the local server:
```powershell
python run_server.py
```
*Verify output indicates server running at `http://localhost:8000` with database initialized.*

### Step 3: Test the UI Flows in Your Browser
1. Navigate to `http://localhost:8000`.
2. Sign in with the demo account by clicking **Owner (EH)** or **Staff (AI)**.
3. Verify the **Backend Status Pill** displays `● Backend Connected (SQLite)`.
4. **Pipeline View:**
   - Inspect the 4 KPI cards: Active Pipeline, Won This Month, Win Rate, Overdue Follow-ups.
   - Switch role to **Staff** $\rightarrow$ confirm the dashboard transitions to **"My Day"** action list.
5. **WhatsApp CRM Simulator (`WhatsApp CRM` tab):**
   - Select Chat 1 (`Tan Bros Trading`).
   - Click the primary action button to generate and insert the quotation into the chat.
6. **Deals & Quotes View:**
   - Filter by stage (`Quoted` / `Won`).
   - Click **Export Won Orders CSV** to download the orders sheet.
7. **Company AI Assistant:**
   - Click **"Ask AI"** on the left mascot card.
   - Ask: *"What is our win rate and how much is in the pipeline?"*
   - Verify the assistant streams live pipeline statistics.

---

## 6. Recommended Hackathon Pitch Narrative

1. **The Problem:** Micro-SMEs in Southeast Asia manage millions of Ringgit in business over WhatsApp and Excel. Traditional CRMs (Salesforce, HubSpot) are too complex, expensive, and require tedious manual data entry.
2. **The Solution:** CashChase is a **WhatsApp Sales Sidekick & Pipeline Hub**. It gives sales reps 10-second quotation shortcuts inside WhatsApp while giving business owners margin protection, overdue follow-up alerts, and automated commission tracking.
3. **The AI Secret Sauce (Layered Architecture):**
   - **Layer A (Understand):** Understands messy Manglish customer chats.
   - **Layer B (Execute):** Deterministic pricing engine that **never** hallucinates amounts.
   - **Layer C (Protect):** Owner approval rules stop bad discounts before they cost the company money.
