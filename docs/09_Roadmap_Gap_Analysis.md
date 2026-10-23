# Roadmap Gap Analysis — What the Code Already Has

> Compares `06_Sales_Agent_Implementation_Roadmap.md` (and the sidebar/dashboard spec in `08_Sidebar_Flows_and_Dashboards.md`) with the code on `main` as of 22 Oct 2026.
> 对比路线图（06）与侧边栏/看板规格（08）和 2026 年 10 月 22 日的现有代码。

✅ = exists and can be reused (it may still need edits) · ⚠️ = partly exists, needs changing · ❌ = missing
✅ 已有可复用（可能仍需修改）· ⚠️ 部分有，要改 · ❌ 没有

> **⚠️ This is a snapshot of `main` before any sales-agent work.** The tables below are kept as the original analysis. For where each item stands now, read the status block below; for what to build next, follow [doc 11](11_Remaining_Build_Plan.md).
> 本文是开工前 `main` 的快照。最新进度看下面的状态表，接下来做什么看文档 11。

### Status after Phases 1–2 (branch `reposition-sales-crm`, 22 Oct 2026) / 第一、二阶段后的状态

| Area | Done in the backend | Backend work still left (Phase 3, doc 11 §4) | Frontend work left |
|---|---|---|---|
| Data | Price list, reps, deals with stages, 48h follow-up timer, follow-up count + "suggest lost", loss reason, slip ref, complaint pause | — | — |
| Sales logic | Mark won/lost, margin guard, commission, reassign, log inquiry, won-orders CSV, quote PDF with disclaimer, permissions, price-list import, "Ask AI" on the pipeline, customer memory scored from deals (data-layer refactor), dashboard numbers and cancel won order (gap fixes below) | Disclaimer and margin guard inside **WhatsApp replies** | Webapp pages (Phase 5) |
| AI | — | New intents incl. discount request; prompt uses the price list (no stock); `/api/whatsapp/execute` creates and moves deals; photo → quote (`/api/whatsapp/photo-quote`) | — |
| Privacy | Skip non-customers before calling the AI, casual chat not saved, `POST /api/customers`; photo → quote and `execute` also refuse strangers (Phase 4 fixes below) | — | ✅ Extension half done (Phase 4 fixes below) |
| Extension | — | — | The 6 roadmap rows are done (Phase 4 fixes below). Still left: the manual run on real WhatsApp Web (doc 11 §5 steps 1–5) and a slip-reference box for Mark won |
| Webapp | — | — | All of Phase 5 |

### Phase 1–2 gap fixes (22 Oct 2026, committed) / 第一、二阶段补漏

Found by comparing Phases 1–2 with the dashboards in doc 08 and the overview page. Each was built by one agent and checked by a separate reviewer.

| # | Gap | Status | What it adds | Proof |
|---|---|---|---|---|
| 1 | Numbers the dashboards need | ✅ Done, reviewed (APPROVE) | `reps[].potentialRm` (commission if open quotes close) and `rank` (by won RM this month, ties share a rank); `customers[].repId` (rep of the latest deal); `pipeline.lossReasons` (lost deals per reason; cancelled orders grouped as "Cancelled after win"); `deals[].atRisk` (open quote that is paused, past 3 follow-ups, or ≥ RM 3,000 in follow-up) | `test_dashboard_numbers.py` (11 tests) |
| 2 | Cancel a won order | ✅ Done, reviewed (APPROVE) | Deal action `CANCEL_WON`: Owner only (Staff 403), reason required, deal → Lost with "Cancelled after win: …", order no. kept; commission reversed and logged (or "won in an earlier month" if so); drops out of the CSV | `test_cancel_won.py` (8 tests) |
| 3 | Link each login to a rep; Staff see only their own numbers | ⏸ Parked | Built, but the access-control review found Staff could still see other reps' data (activity log, approvals, customer memory, quote PDF, `/api/client/memory`, WhatsApp TIN). Removed from the code; the work is saved as `.claude/parked/item3-rep-login.patch` (applies cleanly; not in git) with the reviewer's findings to fix before resuming | — |

Tests after items 1–2: **97 passed, 2 failed** (`test_runpod.py::test_runpod_down_falls_back`, `test_security.py::test_uploads_must_be_small_images_or_pdfs`, both waiting on Phase 3).

### Phase 4 extension fixes (23 Oct 2026, committed) / 第四阶段插件

Each row was built by one agent and checked by a separate reviewer; every review round's findings were fixed and re-reviewed. The extension is tested from pytest with a Node harness (`test/unit/extension_harness*.js`, Node built-ins only, fake WhatsApp DOM, records every network call). Not yet tried on real WhatsApp Web.

| # | Roadmap row | Status | What changed | Proof |
|---|---|---|---|---|
| 1 | Sidebar that inserts the reply | ✅ Verified, reviewed (APPROVE) | No change needed: fills the WhatsApp box and never presses Send | `test_extension.py::test_insert_reply_*` |
| 2 | Manual "Analyse" trigger | ✅ Done, reviewed (APPROVE) | Switching chats or new messages make **no** network call. Only a click sends chat content: 🔄 Rescan, Ask AI / Enter, or the new "📷 Quote from photo" button (`/api/whatsapp/photo-quote`; the automatic `/api/ocr/extract` call is gone, PDFs get a "type the items" hint) | `test_switching_chats_and_new_messages_send_nothing`, `test_analyse_click_sends_the_open_chat_once`, `test_customer_photo_offers_a_button_and_sends_only_on_click` |
| 3 | Customers-only allowlist | ✅ Done, reviewed (APPROVE) | The sidebar checks the customer list from `/api/state` locally (name, or phone digits like the backend). A friend's chat shows "Not a customer" + "➕ Add as customer" (`POST /api/customers`) and nothing can be sent for it; the phone number is now sent with analyze, execute, photo-quote and the memory lookup | `test_friend_chat_says_not_a_customer_and_no_button_sends_anything`, `test_add_as_customer_posts_once_then_rescan_analyses`, `test_phone_title_sends_its_digits_in_analyze_execute_and_photo_quote` |
| 4 | Casual chat not saved | ✅ Done, reviewed (APPROVE) | Backend fixes: photo-quote refused strangers' photos too late (now before the AI); the AI could relabel casual chat as a sales intent and get it saved (now casual stays casual); short words like "ac" matched inside "coaching"/"back" (now whole words); phone match needed whole numbers; unreadable photo returned 500; `execute` for a stranger no longer logs their name. Found with the mock data: a customer whose chat is titled by phone number got a second, blank memory and their open deal wasn't found; now every request is matched to the stored customer once and uses their name, memory lookups compare phone digits, and the memory lookup only rates registered customers | `test_whatsapp_privacy.py` (39 tests) |
| 5 | Rep, stage and commission in the sidebar | ✅ Done, reviewed (APPROVE) | Stock card and all stock wording removed (manifest too). New card: follow-ups due and reps' commission this month. Each quote shows rep, stage ("New quote" for a new one), follow-up n of 3, total and "Margin ✓ · You earn RM x" (Staff never see cost or margin %). The offline draft prices only from the price list, else says "let me confirm the price". The main button sends the real execute body (no more `ACN-DAI-15` / RM 6,650 defaults); `CREATE_QUOTE` without items is refused (400) | `test_sidebar_shows_followups_due_and_commission_and_no_stock_wording`, `test_rescan_shows_rep_stage_follow_up_total_margin_and_commission`, `test_offline_guess_prices_from_the_loaded_price_list_only`, `test_main_button_sends_only_the_contract_fields_from_the_analysis`, `test_whatsapp_execute_create_quote_needs_an_item` |
| 6 | Unread-chat pre-check | ✅ Verified, reviewed (APPROVE) | No change needed: local only, no network call (checked including delayed timers) | `test_unread_precheck_fills_cache_with_no_network_call` |

Left for later: run doc 11 §5 steps 1–5 on real WhatsApp Web; a slip-reference box so Mark won can be done from the sidebar when the chat has no slip ref (today it asks for one and sends nothing).

Tests after Phase 4: **237 passed, 3 failed**. The 3 are teammates' Phase 3 tests that already failed before this work: `test_consultation_intent.py::test_consultative_product_advice_does_not_quote`, `test_phase3_sales_agent.py::test_buying_inquiry_has_disclaimer`, `test_receipts_and_replies.py::test_ai_reply_check`.

So the backend is **not** finished: Phase 3 is backend work (AI prompts, WhatsApp routes, photo → quote, privacy). Phases 4–5 are frontend.
后端还没做完：第三阶段（AI、WhatsApp 接口、照片报价、隐私）都是后端工作；第四、五阶段才是前端。

**Totals / 统计：** ✅ 13 · ⚠️ 13 · ❌ 18. About a third can be reused, but the core of a sales agent is missing: deals and stages, reps, commission, margin guard, CSV and the dashboards.
约三分之一能复用，但销售助理的核心还没有：商机与阶段、业务员、佣金、利润底线、CSV、看板。

---

## 1. Data / 数据 (roadmap Phase 1) — verified 22 Oct 2026

| Roadmap item | Status | What exists now | Now (after Phase 1) |
|---|---|---|---|
| Price list (`products`) | ⚠️ | The `stock` table already has sku, name, sell price and unit cost; remove the quantity columns (`backend/database.py`) | ✅ Done · `products` table, no quantity (`001_initial.sql`) · `test_deals.py::test_price_list_edit_changes_new_quotes`, `test_data_layer.py::test_schema_matches_orm` |
| Salespeople (`reps`) | ❌ | Only Owner/Staff roles, no list of reps | ✅ Done · `reps` table with commission % and active flag · `test_data_layer.py::test_rep_names_are_matched_exactly`, `test_deals.py::test_reassign_moves_only_open_deals` |
| Deals with stages | ❌ | The `invoices` table mixes quotes, invoices and bills; `QUOTE_HOLD` is the closest to "Quoted" | ✅ Done · `deals` table, stage limited to INQUIRY / QUOTED / FOLLOW_UP / WON / LOST · `test_deals.py::test_inquiry_then_quote` |
| 48h follow-up timer | ⚠️ | `hold_expires_at`, `expire_holds()` and the demo fast-forward (`backend/routes/team.py`) can be reused | ✅ Done · `follow_up_at` + demo fast-forward · `test_pipeline.py::test_quote_moves_to_follow_up_when_time_passes`, `test_phase2_verification.py::test_follow_up_hours_apply_to_new_quotes` |
| Follow-up count and "mark lost?" after 3 | ❌ | — | ✅ Done · `follow_up_count`, `suggestLost` (a person still decides) · `test_deals.py::test_follow_up_and_suggest_lost` |
| Loss reason | ❌ | A "declined" intent exists, but no reason is saved | ✅ Done · reason required to mark lost · `test_deals.py::test_mark_lost_needs_reason` |
| Slip reference (info only) | ⚠️ | `receipt_ref` and `claimed_amount` exist on invoices | ✅ Done · `deposit_ref`, `deposit_amount` on deals, never checked against a bank · `test_deals.py::test_mark_won_and_commission` |
| Complaint pauses follow-ups | ⚠️ | `AFTERSALES_PAUSED` exists, but it pauses one invoice, not a customer's follow-ups | ✅ Done per deal · `paused` stops the timer · `test_pipeline.py::test_follow_up_due_and_complaint_pause`, `test_deals.py::test_pause_and_tin`. Pausing **all** of a customer's open deals from a WhatsApp complaint is Phase 3 |

## 2. Sales logic / 销售逻辑 (roadmap Phase 2) — verified 22 Oct 2026

| Roadmap item | Status | What exists now | Now (after Phase 2) |
|---|---|---|---|
| Code-priced quotes | ✅ | `deterministic_fallback_analysis` in `backend/services/prompts.py` prices items from the list | ✅ Done · `test_deals.py::test_quote_is_priced_by_code` |
| RM amount check on AI replies | ✅ | `check_ai_replies` in `backend/services/prompts.py` | ⏳ Phase 3 · only runs inside `/api/whatsapp/analyze`; `test_receipts_and_replies.py::test_ai_reply_check` fails until then |
| "Subject to stock availability" disclaimer | ❌ | Replies currently say "Stock is available!" | PDF ✅ `test_deals.py::test_quote_pdf_has_disclaimer`; WhatsApp replies ⏳ Phase 3 |
| Margin guard | ❌ | Unit cost data exists, but nothing checks margin | ✅ Done · `test_deals.py::test_margin_guard`, `test_phase2_verification.py::test_margin_floor_applies_to_new_quotes` |
| Discounts need the owner | ⚠️ | The `discount.apply` permission is approval-only, but it isn't tied to a margin floor (`backend/services/permissions.py`) | ✅ Done · `test_deals.py::test_margin_guard`, `test_permissions.py::test_approval_only_owner_decides_once` |
| Mark won / Mark lost | ❌ | `CONFIRM_DEPOSIT_DEDUCT` is the closest, and it deducts stock and adds cash | ✅ Done · `test_deals.py::test_mark_won_and_commission`, `test_deals.py::test_mark_lost_needs_reason` |
| Commission | ❌ | — | ✅ Done · `test_deals.py::test_mark_won_and_commission`, `test_pipeline.py::test_pipeline_and_commission` |
| Reassign customers | ❌ | — | ✅ Done · `test_deals.py::test_reassign_moves_only_open_deals` |
| "Log inquiry" form | ⚠️ | The walk-in / phone order form can be repurposed (`POST /api/orders/walkin`) | ✅ Done · `test_deals.py::test_inquiry_then_quote` |
| Won-orders CSV | ❌ | Only the multi-sheet Excel export (`/api/export/xlsx` in `backend/routes/exports.py`) | ✅ Done · `test_deals.py::test_won_orders_csv`, `test_phase2_verification.py::test_csv_date_range` |
| Quote PDF | ✅ | `/api/invoices/{id}/pdf`; needs the disclaimer and the "48h stock hold" wording removed | ✅ Done · `test_deals.py::test_quote_pdf_has_disclaimer` |
| Owner approvals, permissions, audit log | ✅ | Complete, including append-only database triggers | ✅ Done · `test_permissions.py::test_owner_turns_action_off_and_change_is_logged`, `test_phase2_verification.py::test_approval_and_permission_changes_are_audited`, `test_permissions.py::test_audit_log_is_append_only` |
| LHDN TIN collection | ✅ | Detects a TIN in chat and saves it on the customer (`backend/services/customers.py`) | Saving a TIN on a deal ✅ `test_deals.py::test_pause_and_tin`; detecting it in WhatsApp chat ⏳ Phase 3 (`test_customers_lhdn.py` 2 tests fail) |
| Customer memory and rating | ⚠️ | Works, but scores from paid invoices and expired holds (`backend/services/memory.py`); needs won/lost | ✅ Done (data-layer refactor) · `backend/services/memory.py` scores from won deals and "No reply" losses |
| Price-list import (60-second setup) | ⚠️ | The stock-list import already reads SKU, name, cost and price (`backend/services/onboarding.py`); remove quantity and starting cash | ✅ Done · `test_onboarding.py::test_preview_and_apply` (creates one rep "Owner") |
| "Ask AI" company Q&A | ⚠️ | Answers from net worth and stock (`backend/routes/company_ai.py`); needs to use the pipeline | ✅ Done · `test_phase2_verification.py::test_ask_ai_prompt_uses_pipeline_and_hides_costs` (no unit costs in prompt) |

## 3. AI / AI (roadmap Phase 3)

| Roadmap item | Status | What exists now |
|---|---|---|
| Manglish and BM replies | ✅ | Reply options in EN, Manglish and BM |
| Intents | ⚠️ | 6 of 8 have an equivalent (deposit paid ≈ confirmed, aftersales ≈ complaint, expired hold ≈ follow-up due). Discount request is missing |
| Photo → quote | ⚠️ | Vision OCR exists (`api_ocr_extract` in `backend/routes/invoices.py`) and the extension already spots images in chat, but it only reads receipts, not order lists |
| Local LLM plus offline fallback | ✅ | LM Studio, RunPod and built-in answers |

## 4. Extension / 插件 (roadmap Phase 4) — verified 23 Oct 2026

| Roadmap item | Status | What exists now | Now (after Phase 4 fixes) |
|---|---|---|---|
| Sidebar that inserts the reply | ✅ | Inserts into the WhatsApp message box | ✅ Verified · `test_extension.py::test_insert_reply_fills_compose_box_without_sending` |
| Manual "Analyse" trigger | ⚠️ conflict | A `MutationObserver` sends whichever chat is open to the backend and AI automatically (`extension/content.js:1165`). An "Analyse" button exists, but it isn't the only trigger | ✅ Done · the observer only reads the chat locally; Rescan / Ask AI / photo button are the only senders · `test_switching_chats_and_new_messages_send_nothing` |
| Customers-only allowlist | ❌ | Only a keyword check for casual chat (`extension/content.js:172`); no customer list | ✅ Done · "Not a customer" + "Add as customer" · `test_friend_chat_says_not_a_customer_and_no_button_sends_anything` |
| Casual chat not saved | ❌ | The backend saves memory for every analysed chat (`backend/routes/whatsapp.py`) | ✅ Done · `test_whatsapp_privacy.py` |
| Rep, stage and commission in the sidebar | ❌ | It shows a stock summary instead (`extension/content.js:1059`), which needs removing | ✅ Done · stock removed; follow-ups due, commission, rep/stage/"You earn RM x" · `test_rescan_shows_rep_stage_follow_up_total_margin_and_commission` |
| Unread-chat pre-check | ✅ | `scanUnreadSidebarChatsAndPreCache` runs locally only, with no network call | ✅ Verified · `test_unread_precheck_fills_cache_with_no_network_call` |

## 5. Webapp / 网页 (roadmap Phase 5)

| Roadmap item | Status | What exists now |
|---|---|---|
| Boss pipeline dashboard | ❌ | The current dashboard shows net worth and invoices |
| Rep "My day" dashboard | ❌ | — |
| Commission leaderboard | ❌ | — |
| At-risk deals, loss reasons | ❌ | — |
| Owner approvals card | ✅ | On the dashboard |
| Activity log | ✅ | On the dashboard |
| WhatsApp demo page | ✅ | Exists; needs new sales scenarios |
| Owner/Staff switch, Staff = Aina | ✅ | Exists |

---

## Most important findings / 最重要的发现

1. **Privacy conflict / 隐私冲突：** the extension analyses chats automatically, so a chat with a friend or colleague is sent to the AI and its memory is saved. Fix this before the demo, or a judge could expose it with a non-customer chat. The fix has two halves: the **backend (Phase 3)** skips non-customers and doesn't save casual chat; the **extension (Phase 4)** only analyses on the Analyse button and offers "Add as customer".
   插件会自动分析，和朋友、同事的聊天也会发给 AI 并存进记忆。演示前必须修好。
2. **The core is missing / 核心缺失：** deals and stages, reps, commission, margin guard and the dashboards are all new work, most of Phases 1, 2 and 5.
   商机/阶段、业务员、佣金、利润底线、看板都要新写。
3. **Good reuse / 可复用的：** the follow-up timer and demo clock, code-priced quotes, the RM check, approvals, the audit log, TIN collection, the vision model and the price-list import. These should cut some time from the ~26h estimate.
   跟进计时、代码算价、金额检查、审批、日志、TIN、视觉模型、价目表导入都能复用。
4. **Photo → quote is half there / 照片报价有一半：** the extension already finds images and the backend has vision OCR, so it needs a new "read the order list" prompt and matching to the price list.
   插件能抓图片、后端有视觉识别，只需新的提示词和价目表匹配。
