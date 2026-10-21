# CashChase — Problems To Solve

Checked against the code on `main` (FastAPI + SQLite backend, `webapp/`, `extension/`). Effort is a rough guess.
Status key: ⬜ open · ✅ fixed · ⏭️ skipped (team decision).

**How #1/#2 were fixed:** the aircond profile now loads from `GET /api/state`, every WebApp button calls its backend route, and the page re-checks the backend every 4 s so actions from the WhatsApp extension appear. The F&B and Software profiles are still front-end demo data (#27).

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
| 15 | Owner / Staff not checked on the server; role comes from the browser, and the extension always sends `OWNER` | `backend/models/schemas.py`, `extension/content.js` | 1–2 h | ⬜ |
| 16 | No Owner approval for bills over RM 1,000 | missing rule | 30 min | ⬜ |
| 17 | 48h holds never really expire (no timestamp / timer; "expired" is fixed text) | `backend/database.py` | 1 h | ⬜ |
| 18 | No fake-receipt check (payee, reused reference, amount vs balance) | `/verify-receipt` | 1 h | ⬜ |
| 19 | Drafted replies not checked for correct amount / invoice no. / name | missing | 1 h | ⬜ |
| 20 | Audit log can be edited / deleted | `audit_logs` | 20 min | ⬜ |

## P2 — setup and config

| # | Problem | Where | Effort | Status |
|---|---|---|---|---|
| 23 | `.env.example` says `LMSTUDIO_BASE_URL`, code reads `LMSTUDIO_URL` | `.env.example`, `backend/database.py` | 5 min | ⬜ |
| 24 | RunPod listed but not connected | `backend/services/lmstudio.py` | 1–2 h | ⬜ |
| 25 | `.env` not loaded unless started via `start_cashchase.bat` | `run_server.py` | 15 min | ⬜ |
| 26 | Tests need LM Studio running; nothing tests roles or money math | `test/` | 2 h | ⬜ |

## P2 — features promised in the plan but missing

| # | Problem | Effort | Status |
|---|---|---|---|
| 27 | Only the aircond profile is in the database; F&B / Software Studio are front-end only | 1–2 h | ⬜ |
| 28 | 60-second onboarding (drop old Excel / bills → catalogue) not built | 2–3 h | ⬜ |
| 29 | LHDN TIN request on WhatsApp not built (only `SET_TIN` row action) | 1 h | ⬜ |
| 30 | No customers table; customer details spread across invoices and client memory | 1 h | ⬜ |
| 31 | Operating expense bill (−cash) not saved to the backend | 30 min | ✅ |
| 32 | Flow 6 (labour + extra piping on an invoice) not a backend action | 1–2 h | ✅ |
| 33 | "Prototype — synthetic data" label not shown on screens | 10 min | ⬜ |

## Decisions to make (not code)

| # | Question | Status |
|---|---|---|
| 34 | Quote-hold rule (same as #7) | ✅ quotes hold 48h; deposit deducts |
| 35 | Keep Python FastAPI or rewrite in Next.js? (recommend keep Python) | ⬜ |
| 36 | Rename "Net Worth" to "Cash + Stock Value"? | ⬜ |
| 37 | Cut Flow 6 and extra profiles to keep "one use case"? | ⬜ |
| 38 | Excel only, or also CSV? | ⬜ |
