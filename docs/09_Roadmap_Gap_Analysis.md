# Roadmap Gap Analysis — What the Code Already Has

> Compares `06_Sales_Agent_Implementation_Roadmap.md` (and the sidebar/dashboard spec in `08_Sidebar_Flows_and_Dashboards.md`) with the code on `main` as of 22 Oct 2026.
> 对比路线图（06）与侧边栏/看板规格（08）和 2026 年 10 月 22 日的现有代码。

✅ = exists and can be reused · ⚠️ = partly exists, needs changing · ❌ = missing
✅ 已有可复用 · ⚠️ 部分有，要改 · ❌ 没有

**Totals / 统计：** ✅ 13 · ⚠️ 13 · ❌ 18. About a third can be reused, but the core of a sales agent is missing: deals and stages, reps, commission, margin guard, CSV and the dashboards.
约三分之一能复用，但销售助理的核心还没有：商机与阶段、业务员、佣金、利润底线、CSV、看板。

---

## 1. Data / 数据 (roadmap Phase 1)

| Roadmap item | Status | What exists now |
|---|---|---|
| Price list (`products`) | ⚠️ | The `stock` table already has sku, name, sell price and unit cost; remove the quantity columns (`backend/database.py`) |
| Salespeople (`reps`) | ❌ | Only Owner/Staff roles, no list of reps |
| Deals with stages | ❌ | The `invoices` table mixes quotes, invoices and bills; `QUOTE_HOLD` is the closest to "Quoted" |
| 48h follow-up timer | ⚠️ | `hold_expires_at`, `expire_holds()` and the demo fast-forward (`backend/routes/team.py`) can be reused |
| Follow-up count and "mark lost?" after 3 | ❌ | — |
| Loss reason | ❌ | A "declined" intent exists, but no reason is saved |
| Slip reference (info only) | ⚠️ | `receipt_ref` and `claimed_amount` exist on invoices |
| Complaint pauses follow-ups | ⚠️ | `AFTERSALES_PAUSED` exists, but it pauses one invoice, not a customer's follow-ups |

## 2. Sales logic / 销售逻辑 (roadmap Phase 2)

| Roadmap item | Status | What exists now |
|---|---|---|
| Code-priced quotes | ✅ | `deterministic_fallback_analysis` in `backend/services/prompts.py` prices items from the list |
| RM amount check on AI replies | ✅ | `check_ai_replies` in `backend/services/prompts.py` |
| "Subject to stock availability" disclaimer | ❌ | Replies currently say "Stock is available!" |
| Margin guard | ❌ | Unit cost data exists, but nothing checks margin |
| Discounts need the owner | ⚠️ | The `discount.apply` permission is approval-only, but it isn't tied to a margin floor (`backend/services/permissions.py`) |
| Mark won / Mark lost | ❌ | `CONFIRM_DEPOSIT_DEDUCT` is the closest, and it deducts stock and adds cash |
| Commission | ❌ | — |
| Reassign customers | ❌ | — |
| "Log inquiry" form | ⚠️ | The walk-in / phone order form can be repurposed (`POST /api/orders/walkin`) |
| Won-orders CSV | ❌ | Only the multi-sheet Excel export (`/api/export/xlsx` in `backend/routes/exports.py`) |
| Quote PDF | ✅ | `/api/invoices/{id}/pdf`; needs the disclaimer and the "48h stock hold" wording removed |
| Owner approvals, permissions, audit log | ✅ | Complete, including append-only database triggers |
| LHDN TIN collection | ✅ | Detects a TIN in chat and saves it on the customer (`backend/services/customers.py`) |
| Customer memory and rating | ⚠️ | Works, but scores from paid invoices and expired holds (`backend/services/memory.py`); needs won/lost |
| Price-list import (60-second setup) | ⚠️ | The stock-list import already reads SKU, name, cost and price (`backend/services/onboarding.py`); remove quantity and starting cash |
| "Ask AI" company Q&A | ⚠️ | Answers from net worth and stock (`backend/routes/company_ai.py`); needs to use the pipeline |

## 3. AI / AI (roadmap Phase 3)

| Roadmap item | Status | What exists now |
|---|---|---|
| Manglish and BM replies | ✅ | Reply options in EN, Manglish and BM |
| Intents | ⚠️ | 6 of 8 have an equivalent (deposit paid ≈ confirmed, aftersales ≈ complaint, expired hold ≈ follow-up due). Discount request is missing |
| Photo → quote | ⚠️ | Vision OCR exists (`api_ocr_extract` in `backend/routes/invoices.py`) and the extension already spots images in chat, but it only reads receipts, not order lists |
| Local LLM plus offline fallback | ✅ | LM Studio, RunPod and built-in answers |

## 4. Extension / 插件 (roadmap Phase 4)

| Roadmap item | Status | What exists now |
|---|---|---|
| Sidebar that inserts the reply | ✅ | Inserts into the WhatsApp message box |
| Manual "Analyse" trigger | ⚠️ conflict | A `MutationObserver` sends whichever chat is open to the backend and AI automatically (`extension/content.js:1165`). An "Analyse" button exists, but it isn't the only trigger |
| Customers-only allowlist | ❌ | Only a keyword check for casual chat (`extension/content.js:172`); no customer list |
| Casual chat not saved | ❌ | The backend saves memory for every analysed chat (`backend/routes/whatsapp.py`) |
| Rep, stage and commission in the sidebar | ❌ | It shows a stock summary instead (`extension/content.js:1059`), which needs removing |
| Unread-chat pre-check | ✅ | `scanUnreadSidebarChatsAndPreCache` runs locally only, with no network call |

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

1. **Privacy conflict / 隐私冲突：** the extension analyses chats automatically, so a chat with a friend or colleague is sent to the AI and its memory is saved. Fix this before the demo, or a judge could expose it with a non-customer chat. Phase 4 must add the allowlist, a manual trigger and "don't save casual chat".
   插件会自动分析，和朋友、同事的聊天也会发给 AI 并存进记忆。演示前必须修好。
2. **The core is missing / 核心缺失：** deals and stages, reps, commission, margin guard and the dashboards are all new work, most of Phases 1, 2 and 5.
   商机/阶段、业务员、佣金、利润底线、看板都要新写。
3. **Good reuse / 可复用的：** the follow-up timer and demo clock, code-priced quotes, the RM check, approvals, the audit log, TIN collection, the vision model and the price-list import. These should cut some time from the ~26h estimate.
   跟进计时、代码算价、金额检查、审批、日志、TIN、视觉模型、价目表导入都能复用。
4. **Photo → quote is half there / 照片报价有一半：** the extension already finds images and the backend has vision OCR, so it needs a new "read the order list" prompt and matching to the price list.
   插件能抓图片、后端有视觉识别，只需新的提示词和价目表匹配。
