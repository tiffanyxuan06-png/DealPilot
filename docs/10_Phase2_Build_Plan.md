# Phase 2 Build Plan — Sales Routes, Permissions, CSV

> Detailed plan for Phase 2 of `06_Sales_Agent_Implementation_Roadmap.md`. Branch: `reposition-sales-crm`.
> 第二阶段详细计划：销售接口、权限、CSV。

**Already done (uncommitted):** permissions (`backend/services/permissions.py`), request schemas (`backend/models/schemas.py`), and hiding unit costs and margin % from Staff in `/api/state` (`backend/database.py`).
**Remaining:** the 6 steps below, about 3 hours.

> ⚠️ The server does not start until Step 4: `backend/routes/team.py` still imports the removed approval threshold.

---

## Step 1 · Deals routes / 商机接口

**New file:** `backend/routes/deals.py`

| Route | What it does | Who |
|---|---|---|
| `POST /api/deals` | Log an inquiry (`quote: false`) or create a quote. Code prices every item from the price list; an unknown SKU returns 404. A quote gets a follow-up time of now + 48h. The customer is saved to the customer list. | Staff allowed (`deal.create`) |
| `POST /api/deals/{id}/action` | One of the actions below | Depends on the action |

| Action | Rule |
|---|---|
| `SEND_QUOTE` | Inquiry → Quoted; starts the 48h timer |
| `SEND_FOLLOW_UP` | Follow-up count +1, restart the 48h timer, Follow-up → back to Quoted (waiting for a reply again) |
| `MARK_WON` | Sets order no. `SO-…`; saves the slip ref and amount (optional, information only); logs the commission earned |
| `MARK_LOST` | Reason required (400 without one) |
| `APPLY_DISCOUNT` | Recalculates the amount. Below the margin floor, Staff → owner approval. The Owner may go below it; this is logged |
| `PAUSE` / `RESUME` | Complaint pause, with a note |
| `SET_TIN` | Saves the TIN on the customer |

- Won and lost deals can't be changed again (409).
- Every action writes an audit-log line.
- Approvals re-run the request as the Owner (existing mechanism).

## Step 2 · Reps and price list / 业务员与价目表 (owner only)

| Route | What it does |
|---|---|
| `POST /api/reps` | Add or edit a rep: name, commission %, active |
| `POST /api/reps/{id}/reassign` | Move all of that rep's open deals to another rep. Won deals stay with the original rep, so commission history is kept |
| `POST /api/products` | Add or edit a price-list item: SKU, name, price, cost |

## Step 3 · CSV and quote PDF / CSV 与报价 PDF

**File:** `backend/routes/exports.py` (the Excel export is removed)

- `GET /api/export/orders.csv?from=&to=` (owner only): won orders, one line item per row, `utf-8-sig`.
  - Columns follow `05_CSV_Accounting_Bridge_Spec.md` Export A, plus `Payment_Deposit_Amount_MYR`.
  - The deal's discount goes on its first line, so the line totals add up to the deal amount.
  - Every export is written to the audit log.
- `GET /api/deals/{id}/pdf`: quote PDF with the rep's name and the line "Subject to stock availability · prices valid 7 days".

## Step 4 · Smaller updates / 其他修改

- `backend/routes/team.py`: settings save follow-up hours and the margin floor; the money threshold is removed.
- `backend/routes/onboarding.py`: the price-list import takes follow-up hours and margin floor (no starting cash or threshold); the preview no longer shows a stock value.
- `backend/routes/company_ai.py` + its prompt in `backend/services/prompts.py`: "Ask AI" answers from the pipeline, reps, deals and price list.
- `backend/app.py`: register the deals routes. Delete `backend/routes/invoices.py`; Phase 3 brings back its vision code from git history.

## Step 5 · Tests / 测试

**New file:** `test/unit/test_deals.py` (about 12 tests):

- Quote priced by code; unknown SKU returns 404
- Follow-up → count +1 and back to Quoted; 3 follow-ups → `suggestLost`
- Mark won → order no., slip ref and commission; won deals can't change
- Mark lost needs a reason
- Staff discount above the floor runs; below the floor → approval, and approving applies it
- Staff get 403 on reps, reassign, price list and CSV
- Reassign moves only open deals
- CSV: one row per line item, TIN included, totals equal the deal amount
- PDF contains the disclaimer
- Staff state has no `unitCost` or `marginPct`; the Owner's does

The existing `test/unit/test_pipeline.py` must still pass.

## Step 6 · Check and ship / 检查与推送

- Run the tests.
- Localhost check with `curl`: quote → discount → approval → won → download and open the CSV.
- Commit on the branch and push the branch (not `main`).
- Mark Phase 2 done in the roadmap.

---

## Choices to confirm / 待确认的选择

| # | Choice | Alternative |
|---|---|---|
| 1 | After a follow-up is sent, the deal goes back to Quoted; "Follow-up" means "due now" | Keep it in Follow-up until won or lost |
| 2 | The deal discount sits on the first CSV line | Spread it across every line |
| 3 | Staff deals go to Aina by default (the demo has one Staff login) | Link each login to a rep (later) |
| 4 | The RM 1,000 money threshold is removed; the margin floor replaces it | Keep a deal-size threshold too |
| 5 | The Owner can go below the margin floor without approval, but it's logged | Block it for everyone |

## Still not working after Phase 2 / 第二阶段后仍不能用

- WhatsApp actions and the AI prompt (Phase 3)
- The Chrome extension (Phase 4)
- The webapp (Phase 5)
