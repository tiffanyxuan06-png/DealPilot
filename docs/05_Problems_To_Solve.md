# CashChase — Problems To Solve

Checked against the code on `main` (FastAPI + SQLite backend, `webapp/`, `extension/`). Effort is a rough guess.
Status key: ⬜ open · ✅ fixed · ⚠️ partly fixed · ⏭️ skipped (team decision).

**How #1/#2 were fixed:** the aircond profile now loads from `GET /api/state`, every WebApp button calls its backend route, and the page re-checks the backend every 4 s so actions from the WhatsApp extension appear. All three SME profiles now live in the backend (#27).

**Team decision (21 Oct):** this is a hackathon demo on a laptop, so the security items are **skipped** for now. Revisit them before anything is put on a public URL.

---

## P0 — the core demo story

| # | Problem | Where | Effort | Status |
|---|---|---|---|---|
| 1 | WebApp uses its own hard-coded data instead of the backend, so it never shows changes made from the WhatsApp extension, and its own changes are lost on refresh | `webapp/js/state.js` never calls `GET /api/state` | 2–3 h | ✅ |
| 2 | WebApp buttons don't save (confirm deposit, release hold, mark paid, phone order, restock, verify receipt, bills) | WebApp never calls the backend action routes | with #1 | ✅ |
| 3 | Aftersales replace only works on `INV-201` | `backend/routes/whatsapp.py` (`AFTERSALES_REPLACE`) | 30 min | ✅ |
| 4 | Release expired hold only works on `QT-101` | `backend/routes/whatsapp.py` (`RELEASE_EXPIRED_HOLD`) | 30 min | ✅ |
| 5 | No "−RM discount" action in the backend | missing route | 30 min | ✅ |
| 6 | No "Mark resolved" action in the backend (only browser memory) | missing route | 30 min | ✅ |
| 7 | Quote-hold rule clash: the live AI prompt said "don't hold stock until deposit"; the plan says quotes hold stock 48h. **Decision: quotes hold stock for 48h; the deposit deducts it.** Code (not the AI) now picks `CREATE_QUOTE_HOLD` when every item is available, and `/api/whatsapp/execute` refuses to hold more than is available (409) | `backend/services/prompts.py` | 20 min | ✅ |
| 8 | `openpyxl` and `pypdf` missing from `requirements.txt` → Excel export / PDF reading fail on a fresh install | `requirements.txt` | 5 min | ✅ |

## Security (⏭️ skipped for the hackathon demo)

| # | Problem | Where | Status |
|---|---|---|---|
| 9 | `/api/receipts/file/.env` downloads the secrets file | `backend/routes/invoices.py` | ⏭️ |
| 10 | Server open to the whole Wi-Fi (`0.0.0.0`) | `run_server.py` | ⏭️ |
| 11 | CORS `*` with credentials — any website can call the API | `backend/app.py` | ⏭️ |
| 12 | `POST /api/reset` unprotected | `backend/routes/state.py` | ⏭️ |
| 13 | `POST /api/settings` can redirect the AI URL | `backend/routes/state.py` | ⏭️ |
| 14 | AI / chat text rendered into `innerHTML` unescaped | `webapp/js/company_ai.js`, `webapp/js/copilot.js` | ⏭️ |
| 21 | No size / type limit on uploaded files | `/api/receipts/save`, `/api/ocr/extract` | ⏭️ |
| 22 | Customer chat text can steer the AI (prompt injection) | `backend/services/prompts.py` | ⏭️ |

## P1 — "people stay in control"

| # | Problem | Where | Effort | Status |
|---|---|---|---|---|
| 15 | Owner / Staff not checked on the server. **Fixed:** Owner-configurable permissions (Settings → Team & Permissions), enforced on the backend, with an Owner Approvals queue; the extension has a 👑/👤 role selector | `backend/services/permissions.py`, `backend/routes/team.py` | 1–2 h | ✅ |
| 16 | No Owner approval for bills over RM 1,000. **Fixed:** mandatory threshold rule (Owner can change the amount) | `backend/services/permissions.py` | 30 min | ✅ |
| 17 | 48h holds never really expire. **Fixed:** real expiry time per quote; expired quotes release their stock automatically (quote kept for follow-up, logged); live countdown; Owner sets the hold length; Owner-only demo clock (+24h / +48h) | `backend/database.py`, `backend/routes/team.py` | 1 h | ✅ |
| 18 | No fake-receipt check. **Fixed:** payee ≠ company, reference already used, or amount ≠ balance → "Receipt needs checking", always sent to the Owner | `backend/services/permissions.py`, `/api/ocr/extract` | 1 h | ✅ |
| 19 | AI replies not checked. **Fixed:** every RM amount in an AI reply must be one CashChase calculated, and pressure / threat wording is blocked; a failing reply is swapped for the code-built one and labelled "corrected by CashChase". Quote items and amount come from code | `backend/services/prompts.py` (`check_ai_replies`) | 1 h | ✅ |
| 20 | Audit log can be edited / deleted. **Fixed:** SQLite triggers block UPDATE / DELETE | `audit_logs` | 20 min | ✅ |

## P2 — setup and config

| # | Problem | Where | Effort | Status |
|---|---|---|---|---|
| 23 | `.env.example` said `LMSTUDIO_BASE_URL`, code reads `LMSTUDIO_URL`. **Fixed:** `.env.example` uses `LMSTUDIO_URL`; the code accepts both names | `.env.example`, `backend/database.py` | 5 min | ✅ |
| 24 | RunPod listed but not connected | `backend/services/lmstudio.py` | 1–2 h | ⬜ |
| 25 | `.env` was never loaded. **Fixed:** `backend/env.py` loads it at startup (real environment values win); `PORT` is honoured | `run_server.py` | 15 min | ✅ |
| 26 | No fast tests. **Fixed:** 35 pytest tests in `test/unit/` (money math, holds, permissions, receipts, AI reply check) on a temp database; `python -m pytest -q` | `test/` | 2 h | ✅ |

## P2 — features promised in the plan but missing

| # | Problem | Effort | Status |
|---|---|---|---|
| 27 | Only the aircond profile was in the database. **Fixed:** all 3 profiles are in the backend (`backend/services/profiles.py`); the Owner switches profile in Settings, which loads that business's demo data for the WebApp and extension | 1–2 h | ✅ |
| 28 | 60-second onboarding (drop old Excel / bills → catalogue) not built | 2–3 h | ⬜ |
| 29 | LHDN TIN request on WhatsApp. **Fixed:** customers without a TIN get an "Ask for LHDN e-Invoice TIN" reply option and a "📨 Ask TIN on WhatsApp" button in the directory; when a customer sends their TIN (and SSM no.), code detects it and one click saves it to the customer and their invoices | 1 h | ✅ |
| 30 | No customers table. **Fixed:** `customers` table (name, phone, TIN, SSM BRN) built from invoices; new quotes/invoices take their LHDN status from it; Excel export has a Customers & LHDN sheet | 1 h | ✅ |
| 31 | Operating expense bill (−cash) not saved to the backend | 30 min | ✅ |
| 32 | Flow 6 (labour + extra piping on an invoice) not a backend action | 1–2 h | ✅ |
| 33 | "Prototype — synthetic data" label not shown. **Fixed:** shown in the WebApp top bar and the extension sidebar | 10 min | ✅ |

## Decisions to make (not code)

| # | Question | Status |
|---|---|---|
| 34 | Quote-hold rule (same as #7) | ✅ quotes hold 48h; deposit deducts |
| 35 | Keep Python FastAPI or rewrite in Next.js? (recommend keep Python) | ⬜ |
| 36 | Rename "Net Worth" to "Cash + Stock Value"? | ⬜ |
| 37 | Cut Flow 6 and extra profiles to keep "one use case"? | ⬜ |
| 38 | Excel only, or also CSV? | ⬜ |
