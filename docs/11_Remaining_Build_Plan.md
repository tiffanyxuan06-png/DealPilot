# Remaining Build Plan — Phases 3 to 7

> Team guide for finishing the sales agent. Read this first; it replaces phases 3–7 of `06_Sales_Agent_Implementation_Roadmap.md` with file-level detail.
> 团队指南：完成销售助理剩下的阶段 3–7。先读这份文件。
>
> Branch: `reposition-sales-crm` (Phase 2 = commit `f4e793a`). `main` still has the old cash & stock demo and stays untouched until the merge checklist in section 10 passes.
>
> Related: [06 roadmap](06_Sales_Agent_Implementation_Roadmap.md) · [08 sidebar, flows and dashboards](08_Sidebar_Flows_and_Dashboards.md) · [09 gap analysis](09_Roadmap_Gap_Analysis.md) · [10 Phase 2 plan](10_Phase2_Build_Plan.md)

---

## 0. Where we are / 目前进度

| Phase | Status | What it gave us |
|---|---|---|
| 1 · Data model | ✅ done | `products`, `reps`, `deals` tables; demo data for aircond and F&B; 48h follow-up timer; new `/api/state` |
| 2 · Sales routes | ✅ done | Deal actions, margin guard, reps, price list, won-orders CSV, quote PDF, permissions |
| 3 · AI + WhatsApp backend | ⬜ next | WhatsApp analyze/execute for deals, photo → quote, privacy fix |
| 4 · Chrome extension | ⬜ | Sidebar wired to deals |
| 5 · Webapp | ⬜ | Pipeline, Deals, Customers, Commission, WhatsApp demo, Settings |
| 6 · Tests and docs | ⬜ | All tests green, docs updated |
| 7 · Demo | ⬜ | Seed story, real CSV import, rehearsal |

**Tests today:** 54 pass, 6 fail. All 6 go through `/api/whatsapp/analyze`, `/api/whatsapp/execute` or the removed upload route, and Phase 3 fixes them:
`test_customers_lhdn.py` (2), `test_receipts_and_replies.py` (1), `test_runpod.py` (2), `test_security.py` (1).

**Broken until fixed:** the webapp shows old built-in demo numbers (Phase 5); the extension can't analyze or act (Phases 3–4).

---

## 1. Team setup / 开发环境 (everyone, 15 min)

```bash
git fetch origin
git checkout reposition-sales-crm
pip install -r requirements-dev.txt
```

**Run without login while developing.** Login (Supabase) is on in `.env`, so the API returns 401 until you sign in. For local development, start the server with login off:

```bash
SUPABASE_URL= python run_server.py
```

PowerShell: `$env:SUPABASE_URL=""; python run_server.py`. The webapp then shows the **Owner / Staff demo buttons** on the sign-in page.

**`DATABASE_URL` is required.** Add `DATABASE_URL=sqlite:///backend/cashchase.db` to your `.env` (SQLite is for local testing only; see `.env.example`). The data layer is described in [doc 12](12_Data_Layer_Refactor_Plan.md): tables come only from `backend/schema/migrations/<database>/*.sql`, queries go through SQLAlchemy (`backend/db/`), demo data lives in `backend/schema/seeds/*.json`, and requests/responses/settings are Pydantic models in `backend/models/`. Never write raw SQLite-specific SQL in app code.

**Run the tests** (uses a temporary database, never your own):

```bash
python -m pytest -q test/unit
```

**Things that will bite you / 注意事项**

1. **Encoding:** our laptops default to the Chinese GBK encoding. In any Python script that reads JSON, CSV or files from the app, use `open(path, encoding="utf-8")`, or set `PYTHONUTF8=1`. The app itself is fine.
2. **Stray empty files:** a Claude hook on one laptop creates empty files in the repo root (`48`, `RM`, `ALLOW`, `Dict[str`…) after edits. Before every commit run `git status` and delete any empty file you didn't create. Never `git add .` blindly.
3. **Your local database is rebuilt** automatically the first time the new code starts (it only ever held demo data). Use **Settings → Reset** or `POST /api/reset {"role":"OWNER"}` to get fresh demo data.
4. **Restart old servers.** A server started before you pulled still runs the old code.

**Git workflow / Git 流程**

- Each person branches off `reposition-sales-crm`, e.g. `phase3-ai`, `phase5-webapp`.
- Open a pull request **into `reposition-sales-crm`**, never into `main`.
- One owner per file area (section 3). If you must touch another person's file, say so in the team chat first.
- Pull `reposition-sales-crm` at least once a day so conflicts stay small.
- Commit messages: what changed and why, in plain words. No `Co-Authored-By` lines.

---

## 2. API contract / 接口约定

Everyone builds against this. If you need to change it, update this section in the same pull request.

### 2.1 Roles

Every POST body takes `"role": "OWNER" | "STAFF"`; a missing role is treated as Staff. With login on, the signed-in user's role always wins. `GET /api/state` takes `?role=OWNER` or the `X-CashChase-Role` header.

### 2.2 `GET /api/state` (built in Phase 1–2)

```json
{
  "company":  { "name": "Sejuk Jaya Aircond Sdn Bhd", "preset": "aircond", "framework": "…",
                "followUpHours": 48, "marginFloorPct": 15.0, "aiProvider": "lmstudio",
                "lmstudioUrl": "…", "lmstudioApiKey": "…", "lmstudioModel": "…" },
  "products": [{ "sku": "ACN-DAI-15", "name": "Daikin 1.5HP Inverter Unit", "sellPrice": 1150, "unitCost": 850 }],
  "reps":     [{ "id": 1, "name": "Aina", "commissionPct": 3.0, "wonRm": 5350, "commissionRm": 161, "openDeals": 1, "overdue": 0 }],
  "deals":    [{ "id": "QT-2026-103", "orderNo": null, "customer": "Wisma Perdana Sdn Bhd", "phone": "+60 12-998 4410",
                 "repId": 1, "stage": "QUOTED",
                 "items": [{ "sku": "ACN-DAI-15", "name": "Daikin 1.5HP Inverter Unit", "qty": 2, "unitPrice": 1150 }],
                 "discount": 0, "amount": 2300, "followUpAt": "2026-10-23 17:00:00", "followUpText": "⏳ 21h 53m to follow-up",
                 "followUpCount": 0, "suggestLost": false, "paused": false, "lossReason": "", "depositRef": "",
                 "depositAmount": null, "notes": "", "createdAt": "2026-10-21 15:00:00", "wonAt": null,
                 "marginOk": true, "marginPct": 26.1 }],
  "pipeline": { "valueRm": 8350, "winRate": 0.8, "overdue": 1,
                "byStage": { "INQUIRY": { "count": 1, "valueRm": 2300 }, "QUOTED": { "count": 3, "valueRm": 4900 }, "…": "…" } },
  "customers": [{ "name": "Tan Bros Trading", "phone": "…", "tin": "C2088391020", "ssmBrn": "", "lhdnReady": true, "openRecords": 0, "tinRequestText": "" }],
  "clientMemories": { "Tan Bros Trading": { "tier": "VIP_FAST_PAYER", "score": 94, "styleSummary": "…", "paymentBehavior": "…" } },
  "permissions": { "followUpHours": 48, "marginFloorPct": 15.0, "modeLabels": {}, "actions": [], "ownerOnly": [], "mandatoryRules": [] },
  "approvals": [{ "id": 1, "summary": "…", "reason": "Below the margin floor", "status": "PENDING" }],
  "logs": ["07:54 PM · [STAFF] Won #QT-2026-106 …"]
}
```

- `unitCost` and `marginPct` are **only sent to the Owner**. Everyone gets `marginOk`.
- Stages: `INQUIRY → QUOTED → FOLLOW_UP → WON | LOST`. `FOLLOW_UP` means "a follow-up is due now"; after one is sent the deal returns to `QUOTED`.
- `followUpText` is ready to display. `suggestLost` is true after 3 unanswered follow-ups.
- `reps[].wonRm` and `commissionRm` count deals won this calendar month.

### 2.3 Routes that exist now (Phase 2)

| Method & path | Body | Who | Notes |
|---|---|---|---|
| `POST /api/deals` | `customer, phone?, repId?, items:[{sku, qty}], discount?, quote (true), notes?` | `deal.create` | `quote:false` logs an inquiry. Returns `createdId`. Unknown SKU → 404 |
| `POST /api/deals/{id}/action` | `action` + fields below | per action | Won/lost deals → 409 (except `SET_TIN`) |
| ↳ `SEND_QUOTE` | — | `deal.create` | Inquiry → Quoted |
| ↳ `SEND_FOLLOW_UP` | — | `deal.follow_up` | Count +1, back to Quoted, new 48h timer |
| ↳ `MARK_WON` | `depositRef?, depositAmount?` | `deal.won` | Sets `orderNo` `SO-…` |
| ↳ `MARK_LOST` | `reason` (required) | `deal.lost` | No reason → 400 |
| ↳ `APPLY_DISCOUNT` | `discount` (total RM) | `discount.apply` | Below margin floor → Staff get `pending_approval` |
| ↳ `PAUSE` / `RESUME` | `note?` | `deal.pause` | Complaint pause |
| ↳ `SET_TIN` | `tin` | `deal.set_tin` | Bad TIN → 400 |
| `POST /api/reps` | `id?, name, commissionPct, active` | Owner | Add or edit |
| `POST /api/reps/{id}/reassign` | `toRepId` | Owner | Moves open deals only; returns `moved` |
| `POST /api/products` | `sku, name, sellPrice, unitCost` | Owner | Add or edit a price-list item |
| `GET /api/export/orders.csv` | `?role=OWNER&from=YYYY-MM-DD&to=…` | Owner | UTF-8 with BOM |
| `GET /api/deals/{id}/pdf` | — | anyone | Quote or sales-order PDF |
| `POST /api/permissions` | `staffModes?, followUpHours?, marginFloorPct?` | Owner | |
| `POST /api/approvals/{id}/decide` | `decision: APPROVE | REJECT, note?` | Owner | |
| `POST /api/demo/fast-forward` | `hours` | Owner | Moves every follow-up time earlier |
| `POST /api/profile` | `preset: aircond | fnb` | Owner | Loads that demo business |
| `POST /api/reset` | — | Owner | Fresh demo data (keeps the profile) |
| `POST /api/onboarding/preview` · `/apply` | `fileName, fileBase64` · `companyName, followUpHours, marginFloorPct, items:[{sku, name, unitCost, sellPrice}]` | Owner | 60-second setup |
| `POST /api/agent/ask` | `question` | anyone | "Ask AI" over the pipeline |
| `GET /api/client/memory?customer=` | — | anyone | Customer rating card |

Errors: `{"detail": "plain sentence"}` with 400 (bad input), 403 (not allowed), 404 (not found), 409 (wrong state). A request needing approval returns 200 with `{"status": "pending_approval", "approvalId", "reason", "message", "state"}`.

### 2.4 Routes Phase 3 will deliver (build the frontends against these now)

**`POST /api/whatsapp/analyze`** — body unchanged (`customer, phone, message, recentMessages, userInstruction, lastSender, lastClientMessage, lastMyMessage, role`). Response `analysis`:

```json
{
  "intent": "BUYING_INQUIRY | DISCOUNT_REQUEST | CUSTOMER_CONFIRMED | CUSTOMER_DECLINED | COMPLAINT | FOLLOW_UP_DUE | SAVE_LHDN_TIN | CASUAL_CHAT | NOT_A_CUSTOMER",
  "isCustomer": true,
  "badge": "Price quote", "extTitle": "Quote for Tan Bros Trading",
  "extCheck": "5x Daikin 1.5HP … = RM 6,650\nSubject to stock availability",
  "replyOptions": [{ "label": "Manglish", "text": "…" }, { "label": "English", "text": "…" }, { "label": "Bahasa Melayu", "text": "…" }],
  "extDraft": "the first reply option",
  "extActionType": "CREATE_QUOTE | SEND_COUNTER_OFFER | ASK_OWNER | SEND_FOLLOW_UP | MARK_WON | MARK_LOST | LOG_COMPLAINT | SAVE_LHDN_TIN | REPLY_ONLY | NO_ACTION",
  "extBtnLabel": "Send quote & insert reply",
  "dealId": "QT-2026-103 or null",
  "items": [{ "sku": "ACN-DAI-15", "name": "…", "qty": 5, "unitPrice": 1150 }],
  "discount": 0, "amount": 6650, "marginOk": true, "commissionRm": 200,
  "depositRef": "DN-…", "depositAmount": 2000,
  "lossReasonSuggestion": "Price",
  "tin": null, "ssmBrn": null,
  "followUp": { "count": 1, "of": 3 },
  "clientMemory": { "tier": "…", "score": 94, "styleSummary": "…" },
  "replyCheck": { "checked": true, "fixed": [] }
}
```

- `NOT_A_CUSTOMER`: the contact is not in `customers`. Nothing is sent to the AI and nothing is saved; the sidebar shows "Add as customer".
- Prices, `amount`, `marginOk` and `commissionRm` always come from code, never from the model.

**`POST /api/whatsapp/execute`** — `customer, phone, actionType, dealId?, items?, discount?, depositRef?, depositAmount?, reason?, note?, tin?, ssmBrn?, role`. Each action calls the same code as `/api/deals…`, so permissions and the margin guard apply.

**`POST /api/whatsapp/photo-quote`** — `customer, phone, imageBase64, role`. Returns the same `analysis` with `intent: BUYING_INQUIRY` built from the items read in the photo, or `{"analysis": {"intent": "CASUAL_CHAT", "extTitle": "Couldn't read the photo, please type the items"}}`.

**`POST /api/customers`** — `name, phone, role`. Marks a WhatsApp contact as a customer (allowlist).

---

## 3. Who does what / 分工

| Person | Area | Phases | Files they own |
|---|---|---|---|
| **P1 · Backend** | Python routes and services | 3 | `backend/` |
| **P2 · Webapp** | WebApp pages | 5 | `webapp/` |
| **P3 · Extension** | Chrome extension | 4 | `extension/` |
| **P4 · Data, docs, demo** | Seeds, docs, CSV import test, pitch | 6 (docs), 7 | `backend/services/profiles.py` (seed story only), `docs/`, `README.md` |

**Two-person team:** You = P1 + P3 (backend, then extension). Teammate = P2 + P4 (webapp, then docs and demo).

**Order and overlap**

```
Day 1 ─ P1: Phase 3 ─────────────┐        P2: Phase 5 against section 2 (state + Phase 2 routes work today)
                                 ├─► P3: Phase 4 (needs Phase 3 analyze/execute)
Day 2 ─ P2: Phase 5 WhatsApp page needs Phase 3
Day 3 ─ Everyone: Phase 6 ──► P4: Phase 7 rehearsal ──► merge to main (section 10)
```

P2 can start **now**: everything on the Pipeline, Deals, Customers, Commission and Settings pages already works against the Phase 2 API. Only the WhatsApp demo page waits for Phase 3.

---

## 4. Phase 3 · AI and WhatsApp backend / AI 与 WhatsApp 后端 (P1, ~5h)

**Goal:** the WhatsApp copilot understands sales chats, prices them from the price list, and its buttons create and move deals. Non-customers are never analysed or remembered.

### 4.1 Customer allowlist and privacy (do first)

- `backend/services/customers.py`: add `is_customer(conn, name, phone) -> bool` (match the clean name, or the phone digits).
- `backend/routes/customers.py` (new, small): `POST /api/customers` adds a contact (role Staff allowed, logged).
- `backend/routes/whatsapp.py` → `api_whatsapp_analyze`: if not a customer, return `intent: NOT_A_CUSTOMER` **before** calling the AI, and do **not** write `client_memories`.
- Only write `client_memories` when the intent is not `CASUAL_CHAT` / `NOT_A_CUSTOMER`.
- Test: a non-customer message never calls `call_lmstudio_chat` (mock it and assert not called) and leaves `client_memories` unchanged.

### 4.2 Code-built analysis (`backend/services/prompts.py`)

Rewrite `deterministic_fallback_analysis(customer, phone, message, state, user_instruction, open_deal)`. It is the source of truth; the AI only words the replies.

| Intent | Detect (keywords, Malay + English + Manglish) | Code builds | Action |
|---|---|---|---|
| `SAVE_LHDN_TIN` | `parse_tin()` finds a TIN (keep current logic) | thank-you replies | `SAVE_LHDN_TIN` |
| `CUSTOMER_DECLINED` | keep current decline tokens | warm reply, `lossReasonSuggestion` from words (mahal/expensive → Price, nanti/later → Timing, lain/other shop → Competitor) | `MARK_LOST` |
| `COMPLAINT` | leak, rosak, bocor, faulty, broken, problem, defect | apology replies | `LOG_COMPLAINT` (pauses follow-ups) |
| `CUSTOMER_CONFIRMED` | confirm, ok proceed, bank in, deposit, transfer, paid, DuitNow | thanks; read `depositRef` (`DN-…`) and `depositAmount` (`RM x`) | `MARK_WON` on the open deal |
| `DISCOUNT_REQUEST` | can less, discount, murah sikit, best price, kurang | counter-offers that pass the margin floor: free delivery, round down to the nearest RM 50/100, small % off; each priced by code | `SEND_COUNTER_OFFER`, or `ASK_OWNER` if the customer's number is below the floor |
| `FOLLOW_UP_DUE` | the open deal's stage is `FOLLOW_UP` (from state, not from the text) | polite nudge in the customer's language; `followUp.count/of` | `SEND_FOLLOW_UP` |
| `BUYING_INQUIRY` | items or quantities from the price list (keep the current matcher, minus stock) | quote lines from the price list + labour rules; **append "Subject to stock availability · prices valid 7 days"** | `CREATE_QUOTE` |
| `CASUAL_CHAT` | nothing business-related | greeting only | `NO_ACTION` |

- Remove every stock idea: `available`, `onHand`, `onHold`, "ready stock", "hold stock", deposits as a stock rule.
- Add `marginOk` and `commissionRm` using `deal_margin_pct` and `deal_commission` from `backend/services/pipeline.py` (the rep is the open deal's rep, else the default rep).
- `build_whatsapp_copilot_system_prompt`: replace `[LIVE WAREHOUSE STOCK]` with `[PRICE LIST]` (SKU, name, price — **no costs**), update the JSON schema to the new intents and actions, keep the security and tone rules, drop the stock-count rules.
- `check_ai_replies` / `allowed_reply_amounts`: build allowed amounts from the code-built analysis, the price list and this customer's deals (replace `state["invoices"]` with `state["deals"]`). Re-append the disclaimer to every quote reply after the check, so the AI can't drop it.

### 4.3 `api_whatsapp_analyze` (`backend/routes/whatsapp.py`)

- Drop the `req.stock` override and `stock_context`; pass the price list.
- Find the customer's open deal (latest `INQUIRY/QUOTED/FOLLOW_UP` for the clean name) and pass it to the fallback.
- Keep: code decides `extActionType`, `items`, `amount`; the AI may only reword replies.
- Tier directives: remove "lock warehouse stock" wording.

### 4.4 `api_whatsapp_execute`

Replace the body with a dispatcher that calls the Phase 2 functions in `backend/routes/deals.py` (call them directly with built request models, so permissions, the margin guard and logging stay in one place):

| `actionType` | Calls |
|---|---|
| `CREATE_QUOTE` | `api_create_deal(DealCreateRequest(customer, phone, items, discount, quote=True))` |
| `SEND_COUNTER_OFFER` / `ASK_OWNER` | `api_deal_action(dealId, APPLY_DISCOUNT, discount)` (ASK_OWNER goes to approval for Staff) |
| `SEND_FOLLOW_UP` | `api_deal_action(dealId, SEND_FOLLOW_UP)` |
| `MARK_WON` | `api_deal_action(dealId, MARK_WON, depositRef, depositAmount)` |
| `MARK_LOST` | `api_deal_action(dealId, MARK_LOST, reason)` |
| `LOG_COMPLAINT` | `api_deal_action(dealId, PAUSE, note=message)` (if no open deal: just log it) |
| `SAVE_LHDN_TIN` | keep the current TIN code |
| `REPLY_ONLY` / `NO_ACTION` | log "reply sent" only |

Update `WhatsAppExecuteRequest` in `backend/models/schemas.py` (remove `sku/qty/extraSku/extraQty/amount` defaults like `"ACN-DAI-15"`; add `dealId, items, discount, depositRef, depositAmount, reason, note`). Remove `EXECUTE_ACTION_KEYS` and `_require_available`.

### 4.5 Photo → quote

- New `backend/services/vision.py`: restore the vision call from the old route with `git show 71242c5:backend/routes/invoices.py` (function `api_ocr_extract`, the `data:image/` branch). Keep `check_upload_type` and the 10 MB limit from `backend/app.py`.
- Prompt: "Read this order list. Return JSON `{"items": [{"name": "...", "qty": 1}]}`." Then **code** matches each name to the price list (reuse the inquiry matcher), so prices never come from the model.
- `POST /api/whatsapp/photo-quote` returns a normal `analysis`. If vision is offline or nothing matches: `CASUAL_CHAT` with "Couldn't read the photo, please type the items".
- Add one fixture image to `test/fixtures/` (a phone photo of a handwritten list) for the demo and a test with the vision call mocked.

### 4.6 Customer memory (`backend/services/memory.py`)

`compute_client_memory_rating`: score from deals instead of invoices — won count and value (good), lost to "No reply" or `suggestLost` (ghost risk), discount requests (haggler). Keep the tier codes (`VIP_FAST_PAYER`, `SLOW_PAYER_GHOST_RISK`, …) because the prompt uses them; reword `paymentBehavior` into sales terms (no "48h hold", no "lock stock").

### 4.7 Tests (P1)

- Fix the 6 failing tests: rewrite `test_customers_lhdn.py` WhatsApp tests for deals; update `test_ai_reply_check` (expects `amount` 6650 from code); `test_runpod.py` analyze tests; `test_security.py` upload test → point at `/api/whatsapp/photo-quote`.
- New `test/unit/test_whatsapp_sales.py`: one test per intent with the AI mocked offline; non-customer is skipped and not saved; disclaimer present on every quote reply; an AI reply with a made-up RM amount is replaced; execute `CREATE_QUOTE` creates a deal; execute `ASK_OWNER` as Staff → `pending_approval`; photo-quote with mocked vision.

**Done when:** all tests pass; on localhost, `analyze` for "Boss, got 5 Daikin 1.5HP?" from Tan Bros returns `CREATE_QUOTE`, RM 5,750 and the disclaimer; for a non-customer it returns `NOT_A_CUSTOMER` without calling the model.

---

## 5. Phase 4 · Chrome extension / 插件 (P3, ~4h, after Phase 3)

**File map of `extension/content.js` (1,444 lines):**

| Lines | Function | Change |
|---|---|---|
| 11–34 | `getCcRole` / `setCcRole` | keep |
| 45–104 | `ccApiRequest`, `sendToBackground` | keep |
| 157–325 | `buildLocalSmartAnalysis` (offline guess with "ready stock" text) | rewrite to the new intents; no stock wording; add the disclaimer |
| 449–516 | `detectIncomingReceiptOrPdf`, `blobUrlToBase64` | reuse for photo → quote |
| 517–561 | `insertReplyIntoWhatsAppBox` | keep |
| 562–607 | `scanUnreadSidebarChatsAndPreCache` | keep (local only, no network) |
| 615–650 | `refreshClientMemoryPill` | change "lock stock" tooltips to sales wording |
| 651–785 | `scanActiveWhatsAppChat` | **stop auto-sending**: read the chat, but only call `analyze` from the Analyse button |
| 827–897 | `handleAutoDetectedAttachment` (calls `/api/ocr/extract`) | replace with a "📷 Quote from photo" button → `/api/whatsapp/photo-quote` |
| 951–1190 | `createSidebar` (HTML, incl. the live stock card at ~1059 and the MutationObserver at ~1165) | remove the stock card; keep the observer for chat switching only |
| 1191–1204 | `refreshStateFromBackend` (stock summary) | show the rep's follow-ups due today instead |
| 1205–1326 | `renderAnalysisResult` | render the layout in doc 08 §1: customer card, what they want, quote with "Margin ✓ · You earn RM x", reply picker, one main button |
| 1327–1393 | `analyzeCurrentMessage` | stop sending `stock`; handle `NOT_A_CUSTOMER` ("Add as customer" → `POST /api/customers`) |
| 1394–end | `executePrimaryAction` | send the new execute body (section 2.4); show "Sent to Owner for approval" on `pending_approval` |

**Manual test on WhatsApp Web** (two phones/numbers, see doc 08 §5):
1. Open a friend's chat → sidebar says "Not a customer", **no network call** (check DevTools → Network).
2. Add the contact as a customer → Analyse → quote with disclaimer → Send → the deal appears in the webapp.
3. Reply "can less boss?" → counter-offer → as Staff, ask below the floor → approval appears on the Owner dashboard.
4. Reply "ok confirm, bank in RM 2000 ref DN-123" → Mark won → commission updates.
5. Send a photo of the handwritten list → Quote from photo.

**Done when:** steps 1–5 work and the extension never shows stock counts.

---

## 6. Phase 5 · Webapp / 网页 (P2, ~7h, can start now)

Spec for what each person sees: **doc 08 §2–3**. Keep the existing look (`webapp/css/style.css`, Tailwind classes, mascots).

### 6.1 Files

| File | Action |
|---|---|
| `webapp/js/stock_ocr.js` | **delete** (and its `<script>` tag) |
| `webapp/js/state.js` | Delete the offline `smeProfiles` copies of stock, invoices and logs and the `software` profile; keep only the WhatsApp demo chat scripts for `aircond` and `fnb`. `syncFromBackend` → `GET /api/state?role=${currentRole}`; `applyBackendState` stores `company, products, reps, deals, pipeline, customers, approvals, permissions, logs`. If the backend is offline, show "Start the server" instead of fake numbers. Remove `presetFrameworks` stock wording |
| `webapp/js/dashboard.js` | Rewrite: Owner "Pipeline" and Staff "My day" dashboards, Deals page, Customers page, Commission page. Remove every `/api/invoices`, `/api/orders/walkin`, `/api/stock` call |
| `webapp/js/copilot.js` | WhatsApp demo page: render the new `analysis` (section 2.4); new scenario buttons: asks for a quote, sends a photo, "can less?", goes quiet (demo clock +48h), confirms with slip ref, declines, complains, Malay inquiry, a friend chatting (not a customer) |
| `webapp/js/team.js` | Settings: `followUpHours`, `marginFloorPct` (replace `holdHours`, `threshold`); new **Reps** card (add/edit name and commission %, reassign) and **Price list** card (`POST /api/products`) |
| `webapp/js/onboarding.js` | Send `followUpHours, marginFloorPct`; remove starting cash, threshold, quantity, stock value |
| `webapp/js/pdf_export.js` | Quote preview from `deal.items`; download → `GET /api/deals/{id}/pdf`; CSV button → `GET /api/export/orders.csv?role=OWNER` (Owner only) |
| `webapp/js/company_ai.js`, `inspector.js` | Suggested questions: "Who should I follow up today?", "Which deals are at risk?", "Who closed the most this month?", "Why are we losing deals?" |
| `webapp/index.html` | Nav: Pipeline (Owner) / My day (Staff), Deals, Customers, Commission, WhatsApp demo. Delete pages Invoices, Stock, Ledger and the verify, receipt and hold-inspector modals. Login side copy: no "48h stock holds" or "Money coming in" |

### 6.2 Pages

| Page | Owner | Staff (rep = Aina) |
|---|---|---|
| **Pipeline / My day** | Pipeline value · won this month · win rate · overdue; approvals waiting (Approve/Reject); bar per stage; rep leaderboard; at-risk deals (`suggestLost`, paused, big quotes in Follow-up); loss reasons; activity log | Today's follow-ups (`stage === "FOLLOW_UP"` for my `repId`); my commission + potential (`amount × rate` of my open deals); my rank only; my deals by stage; waiting for boss (my approvals); paused customers; recent wins |
| **Deals** | All deals, filter by stage and rep; one main button per deal by stage (Inquiry → Send quote, Quoted → Follow up, Follow-up → Send follow-up, + Mark won / Mark lost); margin % column; Download CSV | My deals only; same buttons; "Margin ✓/✗" only |
| **Customers** | Name, rep (from latest deal), TIN status, open deals, "Ask for TIN on WhatsApp", Reassign rep | My customers |
| **Commission** | Leaderboard: won RM, commission, win rate, open, overdue; "estimated" label | My numbers + rank |
| **Log inquiry** (form on Deals) | customer, phone, items from the price list, quote now or inquiry only → `POST /api/deals` | same |

- Show the rep name from `reps` by `repId`. Show `followUpText` as is.
- Every button calls the API and re-renders from the returned `state`; on `pending_approval` show the toast "Sent to the Owner for approval".

**Done when:** Owner ↔ Staff switch shows the two dashboards; every number on screen matches `GET /api/state`; nothing mentions cash, stock or net worth; no console errors.

---

## 7. Phase 6 · Tests and docs / 测试与文档 (everyone, ~3h)

**Tests:** `python -m pytest -q test/unit` all green; rewrite `test/test_lmstudio_and_flow.py` (end-to-end with LM Studio) for the sales flow; `run_tests.bat` passes.

**Docs (P4):**

| File | Update |
|---|---|
| `README.md` | Sales-agent intro, how to run with login off, CSV export, test command |
| `docs/00_Old_vs_New_Team_Briefing.md` | Add "v8: sales agent" column; link doc 07 |
| `docs/01_CashChase_Master_PRD.md` | New pitch, users, pipeline formulas, permissions table (from section 2.3) |
| `docs/02_User_Flows_and_Agent_Spec.md` | Flows from doc 08, intents and actions from section 2.4, tables `products/reps/deals` |
| `docs/03_Five_Day_Phased_Build_Plan.md` | Replace with a pointer to docs 06 and 11 |
| `docs/04_Pitch_and_Selling_Playbook.md` | New pitch, differentiators, judge answers, demo script (section 8) |
| `docs/05_CSV_Accounting_Bridge_Spec.md` | Copy in from the Downloads version; one export (won orders) with the real columns from `backend/routes/exports.py`; add `INQUIRY`; remove "three formats" |

---

## 8. Phase 7 · Demo / 演示 (P4, ~3h)

- [ ] **Seed story** (`backend/services/profiles.py`, aircond): Tan Bros (photo quote), Kedai Ah Seng (follow-up due), Wisma Perdana (confirms with slip ref), a decline, Klinik Dr. Lim (complaint pause), Ahmad's customers to reassign. Most of this already exists; check it against the script.
- [ ] **Photo:** a phone photo of a handwritten list matching the price list (e.g. "5 Daikin 1.5HP, 5 R32, 2 copper pipe").
- [ ] **Real CSV import** into AutoCount or Bukku (trial account). Fix column names if the import rejects them; the Discount and Sales_Rep mappings are untested.
- [ ] **Real WhatsApp** (optional): two prepaid SIMs registered a few days early; pre-record a 30-second backup video.
- [ ] **Rehearse twice:** once with LM Studio, once with it off (built-in answers).

| Time | On screen | Say |
|---|---|---|
| 0:00–0:40 | Owner pipeline + leaderboard | "Every open quote and who's closing, without touching accounting." |
| 0:40–1:40 | Photo of a handwritten list → priced quote | "Prices come from code, with 'subject to stock availability'." |
| 1:40–2:30 | "Boss, can less?" → counter-offer; deeper cut → Owner approves | "Salespeople can't give away margin." |
| 2:30–3:20 | Demo clock +48h → Manglish follow-up → customer confirms → Mark won | "No quote is forgotten, and Aina's commission goes up." |
| 3:20–4:10 | Ahmad "leaves" → Reassign | "Customers stay with the company." |
| 4:10–5:00 | Download CSV → open in Excel | "The accountant imports this; nobody changed software." |

---

## 9. Definition of done per pull request / 每个 PR 的完成标准

- [ ] Tests pass (`python -m pytest -q test/unit`), and new behaviour has a test.
- [ ] Tried on localhost with login off.
- [ ] No stray files (`git status` clean except your changes).
- [ ] Section 2 updated if the API changed.
- [ ] Nothing mentions cash on hand, stock counts or net worth.

---

## 10. Merge to `main` checklist / 合并到 main

- [ ] Phases 3–6 merged into `reposition-sales-crm`; all tests green.
- [ ] Full demo script runs twice without errors (LM Studio on and off).
- [ ] Webapp and extension tested with **login on** (Supabase) as both Owner and Staff.
- [ ] Tag the old version first: `git tag v7-cash-stock-demo origin/main` and push the tag.
- [ ] Pull request `reposition-sales-crm → main`, reviewed by at least one teammate.
- [ ] Tell the team to pull and restart their servers (their local databases rebuild automatically).

---

## 11. Open decisions / 待决定

| # | Decision | Suggestion | Owner of the decision |
|---|---|---|---|
| 1 | Product name (SalesKaki, QuoteBoss, Kejar, keep CashChase) | Decide this week, or keep CashChase for the hackathon | Team |
| 2 | Can Staff see the leaderboard? | Own rank only | Team |
| 3 | Monthly sales targets on "My day"? | Later | Team |
| 4 | Real WhatsApp segment in the demo? | 30 s + backup video | P4 |
| 5 | Link logins to reps (instead of Staff = Aina) | After the hackathon | P1 |

## 12. Risks / 风险

| Risk | Mitigation |
|---|---|
| `content.js` is large and fragile against WhatsApp Web layout changes | Change wiring only; keep DOM selectors; test on the day before the demo |
| Vision model misreads the photo | Code matches to the price list and asks when unsure; rehearse with the prepared photo |
| Webapp and backend drift | Section 2 is the contract; change it in the same pull request |
| CSV rejected by the accounting software | Real import test in Phase 7 |
| Two people editing one file | File ownership in section 3; pull daily |
| Stray empty files from a hook | Check `git status` before every commit |
