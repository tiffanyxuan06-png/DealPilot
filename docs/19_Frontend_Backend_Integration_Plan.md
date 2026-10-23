# Webapp ↔ Backend Integration (Phases 1–2): Plan

> **Status: ✅ Built (23 Oct 2026), option B** (WhatsApp demo chats stay in `webapp/js/demo_chats.js` until Phase 3). Branch: `reposition-sales-crm`.
> **状态：** 已完成（选项 B：WhatsApp 演示对话留到第三阶段）。
>
> What changed from the plan:
> - `smeProfiles` (≈640 lines, incl. the removed "software" business) is gone; `appState` in `state.js` is filled only by `applyBackendState`.
> - `GET /api/presets` returns the businesses **and** the pricing-rule presets. The presets moved from the webapp into `backend/schema/seeds/defaults.json`, rewritten without stock holds or internal costs, because the AI reads them. "Rules the AI follows" is now saved through `/api/settings`; before, it only changed the page.
> - The 60-second setup's template tiles come from `/api/presets`. Blank follow-up and margin fields use the backend defaults: the webapp had 20% hard-coded, the backend says 15%.
> - The role badge shows "Owner", or the rep the backend links to the Staff login, instead of hard-coded names.
> - The agent inspector shows only the prompt and output the backend returned. The made-up OCR and auto-guard samples are removed.
> - The scripted "customer sends…" buttons moved into `demo_chats.js` with the chats.
> - Guard test: `test/unit/test_webapp_no_seed_data.py`. Backend test: `test_data_layer.py::test_presets_come_from_the_seed_files`.
>
> **Rule / 规则:** the webapp holds **no business data**. Every name, number, deal, product, rep, chat and log it shows comes from a backend response. Demo ("mock") data lives only in `backend/schema/seeds/*.json` and reaches the page through the API. If the backend is unreachable, the page says so and shows empty states, never sample numbers.
> 网页不存任何业务数据；演示数据只放在后端 seeds，通过 API 取得。后端连不上时显示“后端离线”，不显示假数字。
>
> Related: [09 gap analysis](09_Roadmap_Gap_Analysis.md) (Phases 1–2 are done in the backend) · [12 data layer](12_Data_Layer_Refactor_Plan.md) (seeds as JSON)

---

## 1. What is hardcoded today / 目前写死在前端的数据

Checked 23 Oct 2026 on `e2faf1a`.

| Where | Hardcoded data | Used by |
|---|---|---|
| `webapp/js/state.js` `smeProfiles` (~640 lines) | 3 whole businesses (aircond, **software** — removed from the backend in Phase 1, fnb): company name, `cashOnHand`, framework text, `stock`, `invoices`, WhatsApp `chats`, `logs` | Everything when the backend is offline; `name`, `stock`, `invoices`, `chats`, `cashOnHand` even when it is online (the backend only overwrites some fields) |
| `state.js` `applyBackendState` | Maps deals into a fake `invoices` list for the old PDF modal | PDF preview |
| `state.js` business switcher | Options built from `smeProfiles` keys (incl. `software`) | Settings → business |
| `webapp/index.html` | Sample values in the markup: "RM 8,850", "Wisma Perdana · RM 2,000", "Sejuk Jaya Aircond", "Tan Bros Trading", "#QT-104", "RM 6,650", an `aircond` `<option>`, seed names in placeholders | Shown until JS overwrites them, and wherever it doesn't |
| `webapp/js/pdf_export.js` | Client-side "fake PDF" fallback from the preview text; `openPdfForInvoice` reads the fake `invoices`; sample DuitNow receipt templates (receipts were dropped in Phase 1) | PDF preview / download |
| `webapp/js/copilot.js` | Offline branch that edits `stock`, `invoices` and `cashOnHand` (`CREATE_QUOTE_HOLD`, `CONFIRM_DEPOSIT_DEDUCT`, …) | WhatsApp page when the backend is off |
| `webapp/js/inspector.js` | Agent descriptions mention cash, stock and 48h holds | "See agent prompts" |

Already backend-driven (keep): Pipeline, Deals & Quotes, Customers, Commission and Price list pages read `deals`, `reps`, `products`, `customers`, `pipeline` from `/api/state`; approvals and permissions (`team.js`); CSV; Ask AI (fixed in `e2faf1a`).

---

## 2. Build steps / 步骤 (Phases 1–2 only)

### Step 1 — One state, filled only from `/api/state` (state.js, ~2h)
- Delete `smeProfiles`. Replace it with one `appState` object that `applyBackendState(data)` fills from the response, field for field (`company`, `products`, `reps`, `deals`, `pipeline`, `customers`, `clientMemories`, `permissions`, `approvals`, `logs`, `reengage`, `teamSize`).
- `getState()` returns `appState`; `usesBackend()` becomes "backend reachable". Drop `currentSME` / `backendPreset`: the business is `appState.company.preset`.
- Drop the fake `invoices` mapping.
- Backend unreachable → `appState` stays empty; every page renders its empty state plus the existing "Backend offline · run python run_server.py" pill.

### Step 2 — Business switcher from the backend (backend + state.js, ~0.5h)
- New `GET /api/presets` → `{ "aircond": "Sejuk Jaya Aircond Sdn Bhd", "fnb": "Kopi & Bakery Wholesale Sdn Bhd" }` from `available_presets()` (the seed files), with a response model and a test.
- The switcher lists exactly those, plus "My business" when `company.preset == "custom"`. `software` disappears.

### Step 3 — Strip sample values from `index.html` (~0.5h)
- Replace every sample name and RM figure in the markup with an empty value (`—` / `RM 0`) that the render code fills.
- Placeholders become generic hints ("Customer name", "Ask about your pipeline").

### Step 4 — PDF from deals only (pdf_export.js, ~1h)
- Preview and download for any deal read `appState.deals` and `/api/deals/{id}/pdf`.
- Remove the client-side fake PDF (backend down → "Backend offline, can't make the PDF").
- Remove the DuitNow sample receipt templates.

### Step 5 — Remove the offline stock/cash simulation (copilot.js, inspector.js, ~0.5h)
- Delete the `CREATE_QUOTE_HOLD` / `CONFIRM_DEPOSIT_DEDUCT` / `AFTERSALES_REPLACE` / `RELEASE_EXPIRED_HOLD` offline branch. With the backend off, the action button says the backend is offline.
- Inspector text: describe the sales agent (price list, follow-ups, margin floor), not cash and stock.

### Step 6 — Guard test + check (~1h)
- `test/unit/test_webapp_no_seed_data.py`: fails if `webapp/` contains seed data, e.g. any customer, rep or company name from `backend/schema/seeds/*.json`, `cashOnHand`, `smeProfiles`, or an `RM <number>` literal outside placeholders. This keeps the rule from coming back.
- Localhost run, twice:
  1. Backend on: every page's numbers match `/api/state` for aircond, then switch to fnb.
  2. Backend off: offline pill, empty pages, no sample data anywhere.

**Total: about 5.5h.**

---

## 3. Decision needed / 需要决定

**The WhatsApp demo chats (8 scripted conversations in `smeProfiles.*.chats`) are mock data too, but they belong to Phases 3–5.**

| Option | What happens | Cost |
|---|---|---|
| **A. Move them now (recommended)** | Seeds get `"chats": [{customer, phone, messages:[{from, text, minutesAgo}]}]`; `/api/state` returns them (Owner: all, Staff: their customers'). The suggestion panel comes from `/api/whatsapp/analyze`, not pre-written text. No mock data left in the webapp. | +2h |
| B. Later, with Phase 3 | The WhatsApp page keeps its scripts until then; the guard test skips `chats`. | 0h now |

## 4. Risks / 风险

| Risk | Mitigation |
|---|---|
| Teammates' PRs edit `state.js`, `dashboard.js`, `index.html` | Land open PRs first, then do this in small commits per step; merge `origin/reposition-sales-crm` before each push. |
| A page silently depended on a hardcoded field | Step 6's two localhost runs; the guard test. |
| Demo without the backend breaks | That is intended: the demo always runs the backend (`python run_server.py`). |
