# Sales Agent — Implementation Roadmap

> **Status:** Plan agreed with the team on 22 Oct 2026. No code changed yet. Work happens on the branch `reposition-sales-crm`.
> **状态：** 2026 年 10 月 22 日团队已同意的计划，代码尚未修改，在 `reposition-sales-crm` 分支上开发。
>
> Overview page: https://claude.ai/artifact/2z6vfqbfjL66cf9gUcJKUe · Team briefing: https://claude.ai/artifact/5UkD8eRp5tqUPrCCUxLjFd
>
> Related docs: [07 comparison with the original plan](07_Original_vs_Sales_Agent_Comparison.md) · [08 sidebar, flows and dashboards](08_Sidebar_Flows_and_Dashboards.md) · [09 gap analysis: what the code already has](09_Roadmap_Gap_Analysis.md) · [10 Phase 2 build plan](10_Phase2_Build_Plan.md) · **[11 remaining build plan (phases 3–7): start here](11_Remaining_Build_Plan.md)**

---

## 1. What we are building / 我们要做什么

A **WhatsApp sales agent** for Malaysian SMEs. It quotes from the company's own price list, reminds salespeople to follow up, protects the owner's margin on discounts, and hands won orders to the accountant as one CSV file.

给马来西亚中小企业的 **WhatsApp 销售助理**：按自家价目表报价、提醒跟进、守住折扣利润、把成交订单以一个 CSV 交给会计。

### Settled decisions / 已定决策

| Topic | Decision |
|---|---|
| Product focus | Sales only: quotes, follow-ups, pipeline. No ledger, stock counts or cash on hand. |
| Accounting API | Dropped. |
| Accounting handover | One owner-only **Download CSV** button for won orders. |
| CSV contents | One file: won orders, one line item per row, customer name, phone and TIN on each row. |
| Payments | Store the slip reference and amount the customer says they paid. Information only, no balance maths. |
| Hackathon features | Commission tracker, margin guard, photo → quote, reassign customer. |
| Follow-ups | 48h default (owner can change). After 3 follow-ups with no reply, suggest "mark as lost", never automatic. |
| Salespeople | 3 seeded reps: Aina (the Staff login), Ahmad, Mei Ling. |
| Pricing | One sell price per item, no tiers. Unit cost kept only for the margin guard. |
| Complaints | Polite reply + note on the customer + pause that customer's follow-ups until a rep clears it. |
| Demo businesses | Aircond (main) and F&B. Software studio removed. |
| Database | `backend/cashchase.db` is reset and reseeded (demo data only). |
| Name | Rename this week if the team agrees, otherwise keep CashChase. |

### Out of scope (parked) / 暂不做
Accounting API · MCP server · direct Bukku sync · order-change deposit recalculation · customer tier pricing · repeat-order reminders · voice note → quote · festive greetings.

---

## 2. Phases at a glance / 阶段总览

| # | Phase | Owner | Estimate | Depends on |
|---|---|---|---|---|
| 0 | Prep and freeze the old demo | Lead | 0.5h | — |
| 1 | Data model and seeds | Person 1 (backend) | 3h | 0 |
| 2 | Sales routes, permissions, CSV | Person 1 (backend) | 4h | 1 |
| 3 | AI prompts and WhatsApp actions | Person 3 (AI + extension) | 4h | 1 (needs the new state shape) |
| 4 | Chrome extension sidebar | Person 3 (AI + extension) | 3h | 3 |
| 5 | Webapp pages | Person 2 (webapp) | 6h | 1 (state shape), 2 (routes) |
| 6 | Tests and docs | Everyone; Person 4 leads docs | 3h | 2–5 |
| 7 | Demo data polish, CSV import test, rehearsal | Person 4 | 3h | 6 |
| | **Total** | | **~26h** | |

```
0 ──► 1 ──┬──► 2 ──────────┬──► 5 ──┐
          └──► 3 ──► 4 ────┘        ├──► 6 ──► 7
                                    ┘
```

**Parallel work / 并行：** once Phase 1 has the new `GET /api/state` shape, Person 1 (routes), Person 2 (webapp, against the new state) and Person 3 (prompts) can work at the same time. Agree on the JSON shape in Phase 1 first (section 4.1).

---

## 3. Phase 0 — Prep / 准备 (0.5h)

- [ ] Tag the current demo so the old version is recoverable: `git tag v7-cash-stock-demo` on `main`.
- [ ] Work on `reposition-sales-crm`; each person uses their own branch or worktree off it, then merges.
- [ ] Decide the product name, or confirm we keep CashChase for the hackathon.
- [ ] Agree the state JSON shape in section 4.1 before anyone writes UI.

---

## 4. Phase 1 — Data model and seeds / 数据模型与演示数据 (Person 1, 3h)

**Files:** `backend/database.py`, `backend/services/profiles.py`, `backend/services/customers.py`, `backend/services/permissions.py` (`ensure_tables` only)

### Tables
**Drop:** `stock`, `invoices`, `receipt_records`.
**Keep:** `settings`, `audit_logs` (keep the append-only triggers), `client_memories`, `customers`, `role_permissions`, `approval_requests`.
**Add:**

```sql
CREATE TABLE products (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sell_price INTEGER NOT NULL,   -- whole RM, same as today
  unit_cost INTEGER NOT NULL     -- only used by the margin guard
);

CREATE TABLE reps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  commission_pct REAL NOT NULL DEFAULT 3.0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE deals (
  id TEXT PRIMARY KEY,               -- QT-2026-104
  order_no TEXT DEFAULT NULL,        -- SO-2026-104, set when won
  customer TEXT NOT NULL,
  phone TEXT DEFAULT '',
  rep_id INTEGER REFERENCES reps(id),
  stage TEXT NOT NULL,               -- INQUIRY | QUOTED | FOLLOW_UP | WON | LOST
  items_json TEXT NOT NULL DEFAULT '[]',  -- [{sku, name, qty, unit_price}]
  discount INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0,      -- total after discount, computed by code
  follow_up_at TEXT DEFAULT NULL,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,      -- complaint pause
  loss_reason TEXT DEFAULT '',
  deposit_ref TEXT DEFAULT '',            -- what the customer said they paid (info only)
  deposit_amount INTEGER DEFAULT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  won_at TEXT DEFAULT NULL
);
```

### Settings
- Rename `hold_hours` → `follow_up_hours` (default 48).
- Add `margin_floor_pct` (default 15).
- Remove `cash_on_hand`.

### Code
- Replace `expire_holds()` / `recompute_stock_holds()` with `refresh_follow_ups(conn)`: any `QUOTED` or `FOLLOW_UP` deal whose `follow_up_at <= now` and `paused = 0` moves to `FOLLOW_UP`. Reuse `HOLD_TIME_FORMAT` and `parse_hold_time`.
- Rewrite `build_state_payload()` (shape in 4.1).
- Seeds: rewrite the aircond seed and the `fnb` profile in `profiles.py` as products + reps + deals across all five stages. Delete the `software` profile and its `PROFILE_NAMES` entry.
- `customers.py`: replace the `invoices` queries (`apply_tin`, `sync_customers_from_invoices`, `open records` count) with `deals`.

### 4.1 State shape (agree first) / 先统一的数据格式

```json
{
  "company": { "name": "...", "preset": "aircond", "framework": "...", "followUpHours": 48, "marginFloorPct": 15, "aiProvider": "lmstudio" },
  "products": [{ "sku": "ACN-DAI-15", "name": "...", "sellPrice": 1150, "unitCost": 850 }],
  "reps": [{ "id": 1, "name": "Aina", "commissionPct": 3.0, "wonRm": 5750, "commissionRm": 172, "openDeals": 2, "overdue": 1 }],
  "deals": [{ "id": "QT-2026-104", "orderNo": null, "customer": "...", "phone": "...", "repId": 1, "stage": "QUOTED",
              "items": [{ "sku": "...", "name": "...", "qty": 5, "unitPrice": 1150 }], "discount": 0, "amount": 6650,
              "followUpAt": "...", "followUpText": "⏳ 41h to follow-up", "followUpCount": 0, "paused": false,
              "lossReason": "", "depositRef": "", "depositAmount": null, "createdAt": "...", "wonAt": null }],
  "pipeline": { "valueRm": 8350, "byStage": { "QUOTED": { "count": 3, "valueRm": 4900 }, "...": "one entry per stage" }, "winRate": 0.8, "overdue": 1 },
  "customers": [], "clientMemories": {}, "permissions": {}, "approvals": [], "logs": []
}
```

**Done when / 完成标准：** `POST /api/reset` then `GET /api/state` returns the shape above with aircond demo data: 3 reps and at least one deal in every stage.

> **✅ Phase 1 done (22 Oct 2026).** Checked by `test/unit/test_pipeline.py` (7 tests) and on localhost. Notes for the next phases:
> - `pipeline.byStage` holds `{count, valueRm}` per stage; `reps[].wonRm` and `commissionRm` count deals won this calendar month.
> - An old cash & stock database is rebuilt automatically on start-up (it only held demo data).
> - The invoices router is no longer registered; `/api/whatsapp/execute`, `/api/export/*`, `/api/agent/ask` and the analyze prompt still expect stock and break until Phases 2–3. The 60-second setup already imports into `products`.
> - The webapp falls back to its built-in old demo data until Phase 5, so its numbers and buttons are not real yet.
> - 40 old tests (holds, money, invoices, receipts, software profile, Excel) fail by design until Phase 6 rewrites them.

---

## 5. Phase 2 — Sales routes, permissions, CSV / 销售接口、权限、CSV (Person 1, 4h)

**Files:** new `backend/routes/deals.py`; delete `backend/routes/invoices.py`; edit `backend/routes/exports.py`, `backend/routes/team.py`, `backend/routes/state.py`, `backend/routes/onboarding.py`, `backend/routes/company_ai.py`, `backend/services/permissions.py`, `backend/services/onboarding.py`, `backend/models/schemas.py`, `backend/app.py`.

### Routes
| Route | Does |
|---|---|
| `POST /api/deals` | Log an inquiry or create a quote (phone, walk-in or WhatsApp). Code prices the items from `products`. |
| `POST /api/deals/{id}/action` | `SEND_FOLLOW_UP` (count +1, next follow-up time), `MARK_WON` (deposit ref and amount optional, sets `order_no`), `MARK_LOST` (reason required), `APPLY_DISCOUNT`, `PAUSE` / `RESUME`, `SET_TIN` |
| `POST /api/reps/{id}/reassign` | Move a rep's open deals and customers to another rep (owner only). |
| `POST /api/reps` | Add or edit a rep and their commission % (owner only). |
| `GET /api/export/orders.csv` | Won orders, one line item per row, `utf-8-sig`, stdlib `csv` (owner only; replaces `/api/export/xlsx`). |
| `GET /api/deals/{id}/pdf` | Quote PDF with "Subject to stock availability · prices valid 7 days" (moved from `/api/invoices/{id}/pdf`). |

### Margin guard / 利润底线
- One function: `margin_ok(conn, items, discount) -> (ok, margin_pct)`, where margin = (total − Σ unit_cost × qty) ÷ total.
- `APPLY_DISCOUNT` and quote creation call it. Below the floor, `enforce()` sends the request for owner approval with `mandatory_reason="Below RM-margin floor"`. This can never be set to Allowed.

### Permissions (`permissions.py`)
Replace `ACTIONS` with:

| Key | Label | Staff default |
|---|---|---|
| `deal.create` | Log inquiry / create quote | Allowed |
| `deal.follow_up` | Send follow-up | Allowed |
| `deal.won` | Mark deal won | Allowed |
| `deal.lost` | Mark deal lost | Allowed |
| `discount.apply` | Discount above the margin floor | Allowed |
| `deal.set_tin` | Set customer LHDN TIN | Allowed |

Add to `OWNER_ONLY`: `reps.manage`, `reps.reassign`, `pricelist.edit`, `export.csv`.
Remove `receipt_check_reasons`, `payee_matches_company` and the money-out threshold. Rewrite `MANDATORY_RULES` around the margin floor, approvals and the audit log.

### Other edits
- `team.py`: `holdHours` → `followUpHours`; the demo fast-forward moves `deals.follow_up_at`.
- `onboarding`: the setup reads a **price list** (SKU, name, sell price, cost) and drops quantity and starting cash; it adds follow-up hours and the margin floor.
- `company_ai.py` + `build_company_agent_system_prompt`: answer from the pipeline, reps and deals instead of net worth.
- `app.py`: register `deals_router` and drop `invoices_router`.

**Done when / 完成标准：** each action works from `curl`; Staff gets a pending approval below the margin floor and a 403 on owner-only routes; the CSV opens in Excel with the TIN filled in.

> **✅ Phase 2 done (22 Oct 2026)**, built to [doc 10](10_Phase2_Build_Plan.md) with its five choices. Checked by `test/unit/test_deals.py` (13 tests) and a full quote → discount → approval → won → CSV run on localhost.
> - `/api/state` now takes `?role=` (or the `X-CashChase-Role` header): unit costs and margin % go to the Owner only; every deal has `marginOk` and `suggestLost`.
> - The 60-second setup creates one rep, "Owner" (0% commission), so a new business can quote straight away.
> - `routes/invoices.py`, `test_holds.py` and `test_money_and_stock.py` are deleted; Phase 3 restores the vision code from git history.
> - Still failing until Phase 3: 6 tests that go through `/api/whatsapp/analyze` or the old upload route.

---

## 6. Phase 3 — AI prompts and WhatsApp actions / AI 与 WhatsApp 操作 (Person 3, 4h)

**Files:** `backend/services/prompts.py`, `backend/routes/whatsapp.py`, `backend/services/memory.py`, `backend/models/schemas.py`

- **Intents:** `BUYING_INQUIRY`, `DISCOUNT_REQUEST`, `CUSTOMER_CONFIRMED`, `CUSTOMER_DECLINED`, `COMPLAINT`, `FOLLOW_UP_DUE`, `SAVE_LHDN_TIN`, `CASUAL_CHAT`.
- **Actions** (`/api/whatsapp/execute`): `CREATE_QUOTE`, `SEND_FOLLOW_UP`, `MARK_WON`, `MARK_LOST`, `LOG_COMPLAINT` (note + pause), `SAVE_LHDN_TIN`, `REPLY_ONLY`. Each one calls the Phase 2 functions; no stock or cash logic is left.
- **Prompt:** replace "LIVE WAREHOUSE STOCK" with the price list (no quantities, no costs shown to the AI). Remove the stock-count rules and keep the tone, decline and no-internal-IDs rules.
- **Disclaimer:** code appends "Subject to stock availability · prices valid 7 days" to every quote reply in `deterministic_fallback_analysis` and after `check_ai_replies`, so the AI can't drop it.
- **Margin guard in replies:** for `DISCOUNT_REQUEST`, code builds counter-offers (free delivery, round down, bundle) that pass `margin_ok`. `check_ai_replies` keeps rejecting any RM amount code didn't calculate.
- **Photo → quote:** move the vision call out of the old `api_ocr_extract` into `backend/services/vision.py`, and add `POST /api/whatsapp/photo-quote` (image → item names and quantities as JSON → matched to `products` by code → the same quote path). Fallback: if vision is offline, return "Couldn't read the photo, please type the items."
- **Memory:** `compute_client_memory_rating` scores from won / lost / follow-up history instead of paid invoices and expired holds.

**Done when / 完成标准：** with LM Studio off, the fallback gives the right intent and a code-priced reply for each of the 8 intents; with it on, an RM amount the AI makes up is replaced.

---

## 7. Phase 4 — Chrome extension / 插件 (Person 3, 3h)

**Files:** `extension/content.js` (1,444 lines, **not reviewed yet**), `extension/background.js`

- [ ] Read `content.js` first and list every call to the old actions (`CREATE_QUOTE_HOLD`, `CONFIRM_DEPOSIT_DEDUCT`, `AFTERSALES_REPLACE`, `RELEASE_EXPIRED_HOLD`) and every stock display.
- [ ] Swap them for the new actions; show the rep, the stage and "follow-up due" in the sidebar.
- [ ] Add a "📷 Quote from photo" button that reads the last image in the chat.
- [ ] Remove the stock panel and the "check payment" checkbox; "Mark won" saves the slip reference instead.

- [ ] **Privacy (must fix, see [09](09_Roadmap_Gap_Analysis.md)):** the `MutationObserver` at `content.js:1165` sends the open chat to the AI automatically. Make "Analyse" the only trigger, add the customers-only allowlist, and stop the backend saving memory for casual chats.

**Risk / 风险：** this is the largest file in the extension. If it is tangled, keep the sidebar layout and change only the action wiring.

---

## 8. Phase 5 — Webapp / 网页 (Person 2, 6h)

**Files:** `webapp/index.html`, `webapp/js/state.js`, `webapp/js/dashboard.js`, `webapp/js/copilot.js`, `webapp/js/team.js`, `webapp/js/onboarding.js`, `webapp/js/company_ai.js`, `webapp/js/pdf_export.js`, `webapp/js/inspector.js`; delete `webapp/js/stock_ocr.js`.

| Page | Shows |
|---|---|
| **Pipeline** (home) | Value per stage, win rate, follow-ups due today, owner approvals, recent activity. |
| **Deals** | List filtered by stage and rep; one main button per deal (Follow up / Mark won / Mark lost); quote PDF; "Log inquiry" form (replaces walk-in). |
| **Customers** | Customer list with rep, TIN status, open deals; **Reassign** (owner). |
| **Commission** | Leaderboard: won RM, commission RM, open deals, overdue follow-ups per rep. |
| **WhatsApp demo** | The existing simulated chat + sidebar, rewired to the new actions; new scenario chats (quote, discount, follow-up, confirm, decline, complaint, photo). |
| **Settings** | Reps and commission %, margin floor, follow-up hours, price-list import, permissions, AI connection. |

- **Remove from `index.html`:** the net-worth KPI cards, Invoices, Stock and Ledger pages, the verify, receipt and hold-inspector modals, and the "Download monthly Excel" button.
- **`state.js`:** delete the offline `smeProfiles` copies of stock and invoices; the page always reads `GET /api/state`. Keep only the WhatsApp demo chat scripts on the frontend.
- **Owner-only button:** "Download CSV" on the Deals page calls `/api/export/orders.csv`.

**Done when / 完成标准：** every button calls a backend route; switching Owner ↔ Staff shows the approval flow; nothing mentions cash, stock or net worth.

---

## 9. Phase 6 — Tests and docs / 测试与文档 (everyone, 3h)

| Test file | Action |
|---|---|
| `test/unit/test_holds.py` | Delete → new `test_pipeline.py`: follow-up timer, 3-strike suggestion, pause on complaint, won / lost. |
| `test/unit/test_money_and_stock.py` | Delete → new `test_margin_commission.py`: margin floor triggers approval; commission sums. |
| new `test/unit/test_csv_export.py` | One row per line item, TIN present, `utf-8-sig`, Staff gets 403. |
| `test_receipts_and_replies.py` | Keep the reply checks (RM amounts, pressure words, disclaimer present); drop the receipt checks. |
| `test_permissions.py`, `test_profiles.py`, `test_onboarding.py`, `test_customers_lhdn.py` | Update to the new keys, the two profiles and the price-list setup. |
| `test_auth.py`, `test_runpod.py`, `test_security.py` | Should pass unchanged; fix only what breaks. |
| `test/test_lmstudio_and_flow.py` | Rewrite the end-to-end flow for the sales demo. |

Run: `python -m pytest -q` (uses a temporary database).

**Docs (Person 4):** update `README.md` and docs `00`–`04` to the sales agent; move the CSV spec into `docs/05_CSV_Accounting_Bridge_Spec.md` with one export format, the `INQUIRY` stage added and the new name.

---

## 10. Phase 7 — Demo polish and rehearsal / 演示 (Person 4, 3h)

- [ ] Seed the aircond story: Tan Bros (photo quote), Kedai Ah Seng (follow-up due), Wisma Perdana (confirms with slip ref), a decline, Klinik Dr. Lim (complaint pause), Ahmad's customers to reassign.
- [ ] Prepare one photo of a handwritten order list for photo → quote.
- [ ] **Import the CSV into AutoCount or Bukku for real** and fix the column names (the Discount and Sales_Rep mappings are untested).
- [ ] Run the 5-minute script twice, once with LM Studio and once with it off (fallback only).

| Time | On screen |
|---|---|
| 0:00–0:40 | Pipeline dashboard and rep leaderboard |
| 0:40–1:40 | Photo of a handwritten list → priced quote with disclaimer |
| 1:40–2:30 | "Boss, can less?" → margin-guard counter-offer; a deeper cut goes to the owner |
| 2:30–3:20 | Demo clock +48h → Manglish follow-up → customer confirms → Mark won → Aina's commission rises |
| 3:20–4:10 | Ahmad "leaves" → owner reassigns his customers |
| 4:10–5:00 | Download CSV → open in Excel |

---

## 11. Risks / 风险

| Risk | Mitigation |
|---|---|
| `content.js` is large and unreviewed | Phase 4 starts by mapping it; change only the action wiring if needed. |
| Webapp and backend drift apart | Freeze the state shape in 4.1 before Phase 5. |
| Vision model misreads the photo | Code matches items to the price list and asks when unsure; rehearse with the prepared photo. |
| CSV columns rejected by AutoCount or Bukku | Real import test in Phase 7. |
| Two people editing the same file | One owner per file area as in section 2; merge through the lead. |

---

## 12. Still open / 仍待决定

1. Final demo script (the table above is a draft).
2. Names for Person 1–4.
3. Final CSV columns after the import test.
4. Product name.
