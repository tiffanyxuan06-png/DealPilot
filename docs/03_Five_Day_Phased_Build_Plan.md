# CashChase — 5-Day Phased Build Plan

This roadmap breaks the entire build into **4 clean phases (~12–14 hours total work)** so you and your team can build, test, and polish without stress before the deadline.

**Updated to match the repo as built:** Python **FastAPI + SQLite** backend (`backend/`), plain **HTML/JS + Tailwind CDN** WebApp (`webapp/`), **Chrome Extension MV3** (`extension/`), and **LM Studio** as the local LLM. Everything runs on **`http://localhost:8000`** (`start_cashchase.bat` or `python run_server.py`).
Status key: ✅ built · ⚠️ partly built · ❌ not built yet.

---

## Overview of the 4 Build Phases

```
Phase 1 (Hours 1–3)  ──► FastAPI + SQLite State, Net Worth Math, SME Profiles & API Routes      ✅
Phase 2 (Hours 4–7)  ──► Sidebar WebApp (Overview, Invoices & Quotes, Stock, Ledger, Simulator) ⚠️ not wired to the backend
Phase 3 (Hours 8–11) ──► LM Studio Agent (+ fallback) & Chrome Extension Sidebar on WhatsApp Web ✅
Phase 4 (Hours 12–14)──► Excel/PDF Export ✅ · Role Guardrails ❌ · Security fixes ❌ · Rehearsal
```

### Repo map
| Path | What it is |
|---|---|
| `run_server.py`, `start_cashchase.bat` | Start the server on port 8000 |
| `backend/app.py` | FastAPI app, CORS, serves `webapp/` |
| `backend/database.py` | SQLite schema, seed data, `build_state_payload()` (Net Worth math) |
| `backend/routes/state.py` | `/api/health`, `/api/state`, `/api/reset`, `/api/settings` |
| `backend/routes/whatsapp.py` | `/api/client/memory`, `/api/whatsapp/analyze`, `/api/whatsapp/execute` |
| `backend/routes/invoices.py` | Walk-in orders, receipt verify, invoice actions, stock add, OCR, receipts |
| `backend/routes/exports.py` | `/api/export/xlsx`, `/api/invoices/{id}/pdf` |
| `backend/routes/company_ai.py` | `/api/agent/ask` (company Q&A) |
| `backend/services/lmstudio.py`, `prompts.py`, `memory.py` | LM Studio client, prompts + fallback answers, client memory |
| `webapp/index.html`, `webapp/js/*.js` | The WebApp |
| `extension/manifest.json`, `content.js`, `background.js` | WhatsApp Web sidebar (`BACKEND_URL` in `content.js`) |
| `test/*.py`, `run_tests.bat` | End-to-end flow test and live LM Studio chat test |

---

## Phase 1: Core Engine, SME Seed Profiles & API Routes (Hours 1–3) ✅

### Goal
Shared backend state so both the **WebApp** and the **WhatsApp Chrome Extension** read and update the exact same numbers.

### Tasks
1. ✅ **FastAPI app (`backend/app.py`):** serves the WebApp from `webapp/` and the API under `/api/*`. CORS is enabled so the extension on `https://web.whatsapp.com` can call `http://localhost:8000/api/*`.
2. ✅ **SQLite schema + seed (`backend/database.py`):** tables `settings`, `stock`, `invoices`, `client_memories`, `receipt_records`, `audit_logs`. Seed company *Sejuk Jaya Aircond Sdn Bhd*: Cash `RM 9,800`; Daikin 1.5HP, R32 Gas, Copper Pipe 3m; quotes on hold (`QT-101` expired, `QT-102`), pending invoice `INV-202`, aftersales `INV-201`, receipt to verify `INV-205`, supplier bill `SUP-881`.
3. ⚠️ **SME profiles:** the WebApp offers Aircond (*Sejuk Jaya*), Software Studio (*NexaByte IT*) and Wholesale F&B (*Kopi & Bakery*). Only the aircond profile is seeded in the database; the other two live in the front-end simulator data.
4. ✅ **Core math & state transitions:**
   - `build_state_payload()` returns `cashOnHand`, `stockValue`, `coreNetWorth`, `pendingReceivables`, `pendingPayables`, `fullNetWorth`.
   - `POST /api/whatsapp/execute` with `CREATE_QUOTE_HOLD` (increases `on_hold`, never deducts `on_hand`), `CONFIRM_DEPOSIT_DEDUCT` (deducts hold + on-hand, adds deposit to cash, creates pending invoice), `AFTERSALES_REPLACE` (`-1` stock), `RELEASE_EXPIRED_HOLD`.
   - `POST /api/invoices/{id}/action` with `RELEASE_QUOTE`, `CONFIRM_QUOTE`, `MARK_PAID`, `PAY_SUPPLIER`, `SET_TIN`.
   - `POST /api/orders/walkin` (phone / walk-in quote), `POST /api/stock/add` (restock / new SKU), `POST /api/invoices/{id}/verify-receipt`.
5. ✅ **Every action writes to `audit_logs`.**

### Phase 1 Done Check
- `curl http://localhost:8000/api/state` returns the full state. On a fresh seed: **Cash RM 9,800 + Stock RM 10,190 = Core Net Worth RM 19,990**; Receivables RM 8,850; Payables RM 1,500; Full Net Position RM 27,340.

---

## Phase 2: The CashChase WebApp (Hours 4–7) ⚠️

> **Biggest gap:** the WebApp keeps its own hard-coded data in `webapp/js/state.js` (one copy per SME profile) and never calls `GET /api/state`, `/api/whatsapp/execute`, `/api/invoices/{id}/action`, `/api/orders/walkin`, `/api/stock/add` or `/api/invoices/{id}/verify-receipt`. Actions taken in the WebApp only change browser memory (lost on refresh), and actions taken in the WhatsApp extension (saved in SQLite) do not show up in the WebApp. Wire the WebApp to `/api/state` + the action endpoints.

### Goal
The live WebApp at `http://localhost:8000/` (`webapp/index.html`).

### Tasks
1. ✅ **Top bar:** Role switcher chip (`👑 Encik Hafiz (Owner)` ↔ Staff) and the live Net Worth figures.
2. ✅ **Left sidebar pages:** *Overview* (Today items + Recent Activity & Audit Log) · *Invoices & Quotes* (AI Vision OCR upload, Walk-In / Phone bar, All Quotes, Invoices & Aftersales table) · *Stock* (add / restock SKU, Live Warehouse Stock & 48h Holds, who is holding stock) · *Ledger* (master database & full ledger) · *WhatsApp Simulator*.
3. ✅ **Settings:** SME Business Profile & AI Labor Pricing Rules (preset frameworks + custom text, LM Studio URL/model).
4. ✅ **Inline 1-click row buttons** (Confirm Deposit, Release Hold, Replace -1 Stock, Mark Paid, Pay Supplier, Set TIN).

### Phase 2 Done Check
- Open `http://localhost:8000`: uploading a supplier bill, keying a phone order, or confirming a deposit updates **Stock** and **Net Worth** live, **and the same numbers appear after a page refresh and in the extension** (❌ not true yet).

---

## Phase 3: LM Studio Agent & WhatsApp Chrome Extension Sidebar (Hours 8–11) ✅

### Goal
Connect **LM Studio** (with a deterministic fallback so the demo never fails) and the **Chrome Extension Sidebar** on `https://web.whatsapp.com` (the built-in WhatsApp Simulator page stays as the backup).

### Tasks
1. ✅ **Agent route (`POST /api/whatsapp/analyze`):** builds the prompt in `backend/services/prompts.py` (company, stock, owner labor framework, client memory, message), calls LM Studio at `http://127.0.0.1:1234/v1/chat/completions`, and returns the JSON (`intent`, `extDraft`, 4 `replyOptions`, `extActionType`, `sku`, `qty`, `amount`).
2. ✅ **Fallback:** if LM Studio is offline or returns bad JSON, `deterministic_fallback_analysis()` returns a pre-written answer.
3. ✅ **Client memory (`backend/services/memory.py`, `GET /api/client/memory`):** remembers tier, tone and history per customer.
4. ✅ **OCR (`POST /api/ocr/extract`):** fast PDF text extraction with `pypdf` first (note: `pypdf` is not in `requirements.txt` yet), then LM Studio vision for images.
5. ✅ **Chrome Extension (`extension/`, Manifest V3):** `content.js` injects the sidebar into `web.whatsapp.com`, reads the active chat name and recent messages, shows reply options, and inserts the chosen reply into the WhatsApp message box. `background.js` forwards the sidebar's API calls to `http://127.0.0.1:8000` (avoids mixed-content blocks).
6. ❌ **RunPod:** listed in `.env.example` (`AI_PROVIDER`, `RUNPOD_*`) but not called by the backend yet.
7. ⚠️ **Quote-hold rule mismatch:** the live prompt tells the model not to hold stock until a deposit is confirmed (`REPLY_ONLY`), while the Simulator and the flows doc use `CREATE_QUOTE_HOLD` on inquiry. Pick one rule.

### Phase 3 Done Check
- Load `extension/` as an Unpacked Extension in `chrome://extensions`.
- Open `https://web.whatsapp.com` (or the WhatsApp Simulator page): choosing a reply inserts it into WhatsApp AND the WebApp at `localhost:8000` updates.
- `run_tests.bat` passes (`test/test_lmstudio_and_flow.py`).

---

## Phase 4: Export, Role Guardrails, Security & Demo Polish (Hours 12–14)

### Tasks
1. ✅ **Bookkeeper Excel export (`GET /api/export/xlsx`)** and **invoice/quote PDF (`GET /api/invoices/{id}/pdf`)**.
2. ✅ **Company Q&A agent (`POST /api/agent/ask`)** and the Agent Prompt Inspector (`webapp/js/inspector.js`).
3. ❌ **Server-side role guardrails:** the role switcher is UI-only; requests send `role` in the body (default `OWNER`, and the extension always sends `OWNER`). Add a server-checked session and return **403** for Staff on: Confirm Deposit/Payment, Aftersales Replace / Discount, Mark Resolved, Pay Supplier > RM 1,000, Excel export, Settings, Reset.
4. ❌ **Security fixes before any shared demo:**
   - `GET /api/receipts/file/{name}` serves any file from the repo root (including `.env`); restrict to a receipts folder and to `.pdf/.png/.jpg`.
   - `run_server.py` binds `0.0.0.0`; use `127.0.0.1`.
   - CORS `allow_origins=["*"]` with credentials; allow only `http://localhost:8000` and `https://web.whatsapp.com`.
   - `POST /api/reset` and `POST /api/settings` (can change the LM Studio URL) have no protection; make them Owner-only.
   - `webapp/js/company_ai.js` and `webapp/js/copilot.js` put AI / chat text into `innerHTML` unescaped; escape it.
   - Uploaded `file_data` has no size or type limit.
5. ❌ **Receipt and draft checks:** payee ≠ business, reused reference, amount ≠ balance ("Receipt needs checking"); drafts must match amount, invoice number and customer name.
6. ⚠️ **60-second onboarding:** preset frameworks exist in Settings; "drop old Excel / supplier bills to build the catalogue" is not built.

### Phase 4 Done Check
- Run the 5-minute demo script (`04_Pitch_and_Selling_Playbook.md` §4) twice without errors.
- Switched to Staff, the Owner-only actions return 403 from the server, not only hidden buttons.

---

## Phase 5: Transfer to Replit (Deployment Checklist)

Because the app is a self-contained FastAPI + SQLite server with an OpenAI-compatible LLM client (`backend/services/lmstudio.py`), moving to Replit needs only config:

1. **Push to GitHub & import to Replit:** Create Repl → Import from GitHub → run `pip install -r requirements.txt` and `python run_server.py` (on Replit, bind to the port Replit provides).
2. **Point the LLM at a reachable endpoint (Replit Secrets):**
   - **Option A — laptop LM Studio through a tunnel:** run `npx cloudflared tunnel --url http://localhost:1234` and set `LMSTUDIO_URL="https://<your-tunnel>.trycloudflare.com/v1"`.
   - **Option B — RunPod serverless vLLM:** needs the RunPod provider wired into the backend first (Phase 3, task 6).
   - **Option C — fallback only:** with no LLM reachable, the deterministic fallback answers keep every demo flow working.
3. **Point the Chrome Extension at the Replit URL:** update `BACKEND_URL` in `extension/content.js` (and the default URL in `extension/background.js`) and add the Replit host to `host_permissions` in `extension/manifest.json`.
4. **Before going public:** finish the Phase 4 security fixes; a public URL exposes `/api/reset`, `/api/settings` and the receipt file route.
