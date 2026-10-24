# Original Plan vs Sales Agent — Comparison

> **Original** = docs `00`–`04` in this folder plus `05_CSV_Accounting_Bridge_Spec.md` (v7: cash, stock and net worth).
> **Current** = the sales-agent plan agreed on 22 Oct 2026 after the mentor session (details in `06_Sales_Agent_Implementation_Roadmap.md`).
>
> **原始方案** = 文档 00–04 加 CSV 规格 05（现金、库存、净资产版）。**当前方案** = 2026 年 10 月 22 日导师会议后定下的销售助理版。

**In one line / 一句话：** we went from a "cash, stock and net worth" tool that overlaps with accounting to a "quote, follow up and close" tool that hands accounting one CSV file.
从和会计重叠的"现金/库存/净资产"工具，变成"报价/跟进/成交"并只交一个 CSV 给会计的销售工具。

---

## 1. Positioning / 定位

| Area | Original (v7 docs) | Current (sales agent) |
|---|---|---|
| **One-line pitch** | "WhatsApp extension + stock & invoice hub that tracks stock holds, cash flow and company net worth (cash + stock)." | "WhatsApp sales agent that quotes from your price list, reminds reps to follow up, protects your margin, and hands won orders to the accountant as one CSV." |
| **Category** | Cash, stock and invoice tool (close to light accounting) | Sales assistant / mini-CRM |
| **Relationship to accounting software** | Replaces the daily Excel and does bookkeeping-like work (cash, payables, net worth) | Doesn't touch the books; only hands over a CSV |
| **Main user** | Owner + Sales/Admin staff | Salesperson first, then the owner; the accountant only receives a file |
| **Name** | DealPilot | Rename this week if the team agrees (SalesKaki, QuoteBoss, Kejar), otherwise DealPilot |
| **Why it changed** | — | The mentor said accountants resist tools that touch their books; a sales tool avoids that |

## 2. Features / 功能

| Area | Original | Current |
|---|---|---|
| **Quotes** | A quote puts stock on hold for 48h | Priced from the price list with a "subject to stock availability · prices valid 7 days" disclaimer; no stock held |
| **48h timer** | Releases held stock automatically | Follow-up reminder; after 3 tries with no reply it suggests "mark as lost" (never automatic) |
| **Stock** | On hand / on hold / available, restocking, deductions | Removed; only a price list remains (SKU, name, sell price, unit cost) |
| **Cash and net worth** | Cash on hand, core net worth, full net position | Removed |
| **Supplier and expense bills** | OCR upload of bills (+stock, −cash) | Removed |
| **Deposits and receipts** | Owner confirms deposit → deducts stock, adds cash; bank receipt checks | Slip reference and amount stored as information only; no balance maths |
| **Aftersales** | Pause payment chasing, replace −1 stock, discount, mark resolved | Polite reply + customer note + pause that customer's follow-ups |
| **Invoices** | Pending invoices, mark paid, pay supplier | Removed; invoices are the accounting system's job |
| **Pipeline** | None | New: Inquiry → Quoted → Follow-up → Won / Lost, value per stage, win rate, overdue follow-ups |
| **Salespeople** | Only roles (Owner Hafiz, Staff Aina) | New: 3 reps (Aina, Ahmad, Mei Ling) with deals assigned |
| **Differentiators** | 48h stock hold, net worth, money-first aftersales | Commission tracker, margin guard, photo → quote, reassign customer |
| **Phone and walk-in** | Walk-in sale (paid now, deducts stock) or phone quote hold | "Log inquiry" form that creates a deal |
| **Customer memory and rating** | Based on paid invoices, expired holds, short payments | Based on won, lost and follow-up history |
| **LHDN TIN** | Collected on WhatsApp, shown on invoices | Kept; collected on WhatsApp and included in the CSV |
| **"Code does the maths" rule** | Code calculates prices, stock and net worth; checks RM amounts | Kept; code calculates prices, discounts, margin and commission, checks RM amounts and adds the disclaimer |

## 3. Accounting handover / 会计对接

| Area | Original | Current |
|---|---|---|
| **Export** | Multi-sheet Excel "master ledger" (`/api/export/xlsx`) | One owner-only "Download CSV" of won orders |
| **CSV spec (05)** | Says "three formats" but defines two: A (won sales orders) and B (quotation pipeline) | One file only: Export A, one line item per row with the TIN; Export B dropped (pipeline stays on our dashboard) |
| **Stages in the CSV** | QUOTED, FOLLOW_UP, WON, LOST | Adds INQUIRY |
| **API to accounting** | None | Considered (download API, Bukku push, MCP), then dropped as off-focus and parked |
| **Software mapping** | AutoCount, SQL Account, Bukku mapping table | Same, plus Discount and Sales_Rep (untested guesses; check with a real import) |

## 4. Product structure / 产品结构

| Area | Original | Current |
|---|---|---|
| **Interfaces** | WhatsApp extension + webapp | Same two |
| **Webapp pages** | Overview & Net Worth, Invoices & Quotes, Stock & 48h Holds, Ledger, WhatsApp Simulator, Settings | Pipeline, Deals, Customers, Commission, WhatsApp demo, Settings |
| **Database tables** | `stock`, `invoices`, `receipt_records`, `client_memories`, `audit_logs`, `settings`, `customers`, permission tables | Drop `stock`, `invoices`, `receipt_records`; add `products`, `reps`, `deals`; keep the rest |
| **AI intents** | Buying inquiry, deposit paid, aftersales, expired-hold follow-up, casual chat, declined, save TIN | Buying inquiry, discount request, customer confirmed, declined, complaint, follow-up due, save TIN, casual chat |
| **Extension actions** | Create quote hold, confirm deposit & deduct, aftersales replace, release expired hold | Create quote, send follow-up, mark won, mark lost, log complaint, save TIN, reply only |
| **Permissions** | Groups: Sales & Stock, Money In, Money Out, Aftersales; RM 1,000 money-out threshold; receipt checks | Deal actions for staff; discounts below the margin floor always need the owner; reassign, price list and CSV are owner only |
| **60-second setup** | Stock list with quantities and costs + starting cash + hold time + threshold | Price list (SKU, name, price, cost) + follow-up hours + margin floor |
| **Demo businesses** | Aircond, software studio, F&B | Aircond (main) + F&B; software studio removed |
| **AI model** | LM Studio local, RunPod optional, built-in fallback | Same, plus the vision model for photo → quote |

## 5. Pitch and plan / 推介与计划

| Area | Original | Current |
|---|---|---|
| **Demo script** | Net worth banner → 48h stock hold → deposit deducts stock → aftersales −1 stock → supplier bill OCR → profile switch & Excel | Pipeline & leaderboard → photo → quote → margin guard → 48h follow-up → won & commission → reassign → CSV in Excel |
| **Judge Q1: "They already have accounting software?"** | "We replace the messy Excel and give a monthly Excel export" | "We don't replace it. We feed your accountant a clean CSV" |
| **Competitors named** | Spreadsheets, accounting ERPs, WhatsApp chatbots (Wati, respond.io) | Plus RakanSales, SleekFlow, AutoCount salesman apps, One Mobile, and free WhatsApp Web CRM extensions |
| **Pricing** | Freemium in Orbyte Core + Pro RM 49/month (stock holds, OCR, Excel export) | Same price with sales features (draft); AI cost per SME still not calculated |
| **Build plan** | 5 days, 4 phases, mostly marked built | 8 phases, about 26h, mostly a rewrite (see doc 06) |
| **Team split** | P1 backend & net worth · P2 webapp pages · P3 AI & extension · P4 seeds, Excel & pitch | P1 data & sales routes · P2 new webapp pages · P3 AI, photo → quote & extension · P4 demo data, CSV import test & docs |

## 6. What stays the same / 不变的部分

- The WhatsApp Web extension and the simulated WhatsApp demo
- Manglish and BM replies, customer memory, and the AI tone rules
- AI drafts, code does the maths, a human approves every action
- Owner/Staff permissions with owner approvals, and the append-only audit log
- LHDN TIN collection, LM Studio or RunPod with the built-in fallback, and the FastAPI + SQLite stack

## 7. Parked for later / 之后再考虑

Accounting API · MCP server · direct Bukku sync · order-change deposit recalculation · customer tier pricing · repeat-order reminders · voice note → quote · festive greetings.
