# CashChase — 5-Day Phased Build Plan

This roadmap breaks the entire build into **4 clean phases (~12–14 hours total work)** so you and your team can build, test, and polish without stress before the deadline.

---

## Overview of the 4 Build Phases

```
Phase 1 (Hours 1–3)  ──► Backend State, Net Worth Math, 2 SME Profiles & API Routes
Phase 2 (Hours 4–7)  ──► Single-Page WebApp (Net Worth Banner + Upload/Phone Bar + Stock & Invoice Tables)
Phase 3 (Hours 8–11) ──► Local LLM Agent (Ollama/LM Studio + Cache) & Chrome Extension Sidebar on WhatsApp Web
Phase 4 (Hours 12–14)──► Excel Export, Role Guardrails, 60s SME Setup & Full Demo Rehearsal
```

---

## Phase 1: Core Engine, 2 SME Seed Profiles & API Routes (Hours 1–3)

### Goal
Set up the Next.js + Tailwind project and build the shared backend state so both the **Single-Page WebApp** and the **WhatsApp Chrome Extension** read and update the exact same numbers.

### Tasks
1. **Scaffold Next.js App (`src/`):**
   - Standard Next.js App Router + TypeScript + Tailwind CSS.
   - Enable CORS headers on `/api/*` so the Chrome Extension on `https://web.whatsapp.com` can call `http://localhost:3000/api/*` directly.
2. **Create the 2 SME Seed Profiles (`src/lib/store.ts`):**
   - **Profile 1 (`aircond`):** *Sejuk Jaya Aircond Sdn Bhd* (Cash `RM 9,800`, Daikin 1.5HP, R32 Gas, Copper Pipe, sample Quotes on Hold, Pending Invoices, Aftersales Paused Invoice, Supplier Stock Bill).
   - **Profile 2 (`fnb`):** *Kopi & Bakery Wholesale Sdn Bhd* (Cash `RM 6,400`, Arabica Coffee Beans 5kg, Barista Oat Milk Carton, wholesale quotes & invoices).
3. **Implement Core Math & State Transitions (`src/lib/engine.ts`):**
   - `calculateNetWorth(state)` → returns `cashOnHand`, `stockValue`, `coreNetWorth`, `pendingReceivables`, `pendingPayables`, `fullNetPosition`, and `totalUnitsOnHold`.
   - `createQuoteHold()` → increases `onHold` (48h timer), never deducts `onHand`.
   - `confirmDepositAndDeduct()` → Owner-only; deducts `onHold` and `onHand`, adds deposit to `cashOnHand`, creates Pending Invoice.
   - `releaseExpiredHold()` → reduces `onHold`, returns stock to `Available`.
   - `resolveAftersales()` → applies `-1 Stock Replacement` or `-RM Discount`, and lets Owner mark `Resolved`.
   - `applyUploadedInvoice()` → handles Supplier Stock Bill (`+onHand, -cashOnHand`), Operating Cost (`-cashOnHand`), and Customer Payment Receipt (`+cashOnHand`).
4. **Create REST API Endpoints:**
   - `GET /api/state` — returns full live state + calculated Net Worth + Activity Log.
   - `POST /api/action` — executes any of the deterministic actions above and logs to `activity_logs`.

### Phase 1 Done Check
- `curl http://localhost:3000/api/state` returns the complete JSON state and calculated Net Worth (`Core Net Worth: RM 20,000`).

---

## Phase 2: The Single-Page CashChase WebApp (Hours 4–7)

### Goal
Turn the interactive prototype (`CashChase_Interactive_Prototype.html`) into the live Next.js Single-Page WebApp at `http://localhost:3000/`.

### Tasks
1. **Top Global Bar:**
   - SME Profile Switcher (`Sejuk Jaya Aircond` ↔ `Kopi & Bakery Wholesale`)
   - Role Switcher (`👑 Owner (Hafiz)` ↔ `👤 Sales/Admin (Aina)`)
   - **Live Company Net Worth Hero Banner** (`Cash on Hand`, `Physical Stock Value`, `Core Net Worth`, `Stock On Hold`, `Full Net Position`).
2. **Zero-Friction Input Row:**
   - **Left:** **Drag & Drop Invoice / Receipt Upload Box** (supports uploading a real image/PDF or clicking the 3 quick-test sample bills: *Supplier Stock Bill*, *Operating Cost Bill*, *Customer DuitNow Receipt*).
   - **Right:** **Phone Call / Walk-In Quick Key-In Bar** (type 1 line like *"Hotel Seri Alam called, wants 2x Daikin 1.5HP"* → creates Quote & puts stock `On Hold`).
3. **Live Stock Count Table:**
   - Columns: `SKU`, `Item Name`, `Physical On Hand`, `⏳ On Hold (48h timer)`, `✅ Available to Sell`, `Unit Cost / Sell Price`, `Stock Value`, and `🔓 Release Hold` button.
4. **Unified Invoices, Quotes & Aftersales Table:**
   - Filter tabs: `All` | `⏳ Quotes (Stock Hold)` | `💰 Pending Invoices` | `⚠️ Aftersales Paused` | `📥 Supplier & Cost Bills`.
   - Inline 1-click buttons per row (`Confirm Deposit`, `Release Hold`, `-1 Stock Replace`, `-RM 180 Discount`, `✓ Mark Resolved`, `Confirm Paid`).
5. **Bottom Activity & Audit Log:**
   - Shows real-time append-only log of every human approval and stock/money update.

### Phase 2 Done Check
- Open `http://localhost:3000` in Chrome: uploading a Supplier Bill, keying a Phone Order, or confirming a Quote Deposit updates **Stock Count** and **Company Net Worth** live on the same page.

---

## Phase 3: Local LLM Agent & WhatsApp Chrome Extension Sidebar (Hours 8–11)

### Goal
Connect your **Local LLM (`Ollama` / `LM Studio`)** (with instant Demo Cache fallback) and build the **Chrome Extension Sidebar** that injects into `https://web.whatsapp.com` (plus keep the built-in WhatsApp Simulator tab on `localhost:3000` as a backup!).

### Tasks
1. **Local LLM + Cache Agent Route (`POST /api/agent/analyze`):**
   - Formats the request using the **CashChase Agent Input Envelope** (`SME_COMPANY`, `USER_ROLE`, `CATALOGUE_STATE`, `MESSAGE_TEXT`).
   - Calls `LLM_BASE_URL` (`http://localhost:11434/v1/chat/completions` for Ollama or RunPod URL) with `response_format: { type: "json_object" }`.
   - Validates output with Zod; if Local LLM is offline or slow (>5s), automatically returns the pre-baked JSON from `demoCache.ts` so the demo never fails.
2. **Chrome Extension Folder (`chrome-extension/`):**
   - `manifest.json` (Manifest V3, permissions for `https://web.whatsapp.com/*`).
   - `content.js` (~80 lines):
     - Injects a collapsible right-hand sidebar (`360px` wide) into `web.whatsapp.com` loading `http://localhost:3000/extension` (or rendering the extension card directly).
     - Reads the active chat title and last visible messages from WhatsApp Web's DOM (plus includes 4 quick-scenario preset buttons right inside the sidebar so you can test all 4 flows even on an empty chat!).
     - Listens for `"INSERT_WHATSAPP_REPLY"` and inserts the drafted quote/reply directly into WhatsApp Web's message input box (`div[contenteditable="true"]`).

### Phase 3 Done Check
- Load `chrome-extension/` as an Unpacked Extension in `chrome://extensions`.
- Open `https://web.whatsapp.com` (or use the built-in simulator on `localhost:3000`): clicking **`1-Click Hold Stock & Insert Quote`** pastes the reply into WhatsApp AND updates the Single-Page WebApp at `localhost:3000`!

---

## Phase 4: Bookkeeper Excel Export, 60s Setup & Demo Polish (Hours 12–14)

### Goal
Add the final high-scoring rubric touches and rehearse the 5-minute demo.

### Tasks
1. **1-Click Bookkeeper / LHDN CSV & Excel Export (`GET /api/export`):**
   - Downloads a multi-section `.csv` / `.xlsx` file containing:
     - **Company Net Worth Summary** (`Cash`, `Stock Value`, `Receivables`, `Payables`)
     - **Stock Count & Hold Status**
     - **Invoices & LHDN TIN Readiness List**
2. **60-Second SME Onboarding & Agent Prompt Inspector Tab:**
   - Shows judges how any new SME sets up CashChase in 3 steps (Drop old Excel/Supplier Bills → Enter Starting Cash → Set 48h Hold Timer) and displays the live Formatted Agent Input/Output JSON.
3. **Role Guardrail Verification:**
   - Verify that when switched to `👤 Sales/Admin (Aina)`, Owner-only buttons (`Confirm Deposit`, `Confirm Payment`, `Aftersales Stock Replace`) require Owner approval.

### Phase 4 Done Check
- Run through the entire 5-minute demo script twice without any errors.

---

## Phase 5: 2-Minute Transfer to Replit (Deployment Checklist)

Because the app uses a self-contained data store and an OpenAI-compatible LLM client (`src/lib/llm.ts`), moving from your laptop to Replit requires **zero code changes**:

1. **Push to GitHub & Import to Replit:**
   - Push the repo to a public GitHub repository (`cashchase`).
   - On Replit, click **Create Repl → Import from GitHub**.
2. **Connect `qwen3:4b` / RunPod in Replit Secrets:**
   - **Option A (Use your laptop's `qwen3:4b` via free Cloudflare/ngrok tunnel during live demo):**
     Run `ollama run qwen3:4b` on your laptop, then run `npx cloudflared tunnel --url http://localhost:11434` and set `LLM_BASE_URL="https://<your-tunnel>.trycloudflare.com/v1"` and `LLM_MODEL="qwen3:4b"` in Replit Secrets.
   - **Option B (Use RunPod Serverless $20 credit):**
     Set `LLM_BASE_URL="https://api.runpod.ai/v2/<ENDPOINT_ID>/openai/v1"`, `LLM_API_KEY="rp_..."`, and `LLM_MODEL="Qwen/Qwen3-4B"` in Replit Secrets.
   - **Option C (Built-in Demo Cache Fallback):**
     Keep `ENABLE_DEMO_CACHE="true"` in Replit Secrets so even if the GPU worker is asleep when a judge opens the link, every demo flow responds in `< 100ms`.
3. **Point Chrome Extension to Replit URL:**
   - Update `API_BASE` in `chrome-extension/content.js` from `http://localhost:3000` to your `https://<repl-name>.replit.app` URL.

