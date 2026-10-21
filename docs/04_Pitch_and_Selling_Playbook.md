# CashChase — Pitch, Selling Points & Judge Q&A Playbook

Use this playbook to pitch CashChase to **hackathon judges**, **mentors**, and **SME owners**. Everything here is aligned directly with the **Domain 2 Marking Rubric (`Copy of Domain 2 (1).pdf`)**.

---

## 1. The 30-Second Elevator Pitch

> *"In Malaysia, 80% of micro and small businesses run their sales on WhatsApp and track their stock and invoices in messy spreadsheets. Accounting software like AutoCount is blind to WhatsApp chats, while WhatsApp chatbots are blind to warehouse stock and unpaid invoices.*
>
> *We built **CashChase for Orbyte**: a **WhatsApp Web Extension Sidebar** connected to a **Single-Page Stock & CashFlow Hub**. When a customer asks for stock on WhatsApp, CashChase checks live inventory, drafts the quote, and locks those units **On Hold for 48 hours**—only deducting physical stock once the deposit is confirmed. And when staff drop in a supplier bill or customer receipt, CashChase automatically updates **Company Net Worth (`Cash + Stock Value`)** in one click with zero manual data entry."*

---

## 2. How We Sell CashChase (The 4 Core Selling Points)

### Selling Point #1: Solves "Ghost Quotes" vs. "Oversold Stock" Automatically
- **The Pain:** When Customer A asks for 5 units on WhatsApp, staff send a quote. Ten minutes later, Customer B asks for the same item. Either the staff oversells stock they don't have, or they hold stock for Customer A who ghosts them for a week.
- **How CashChase Solves It:** Clicking **Approve Quote** in our WhatsApp Extension puts those units **`On Hold for 48 hours`** without deducting physical stock.
  - If Customer A pays the deposit → Owner clicks **Confirm Deposit**, converting `On Hold` into **`Deducted Physical Stock`** and **`+Cash on Hand`**.
  - If Customer A ghosts for 48 hours → The stock hold **auto-releases** back to `Available Stock` so Customer B can buy!

### Selling Point #2: Zero-Friction for Sales & Admin (No Manual Data Entry)
- **The Pain:** Admin and sales staff hate switching tabs and typing invoice rows into forms.
- **How CashChase Solves It:**
  - **On WhatsApp Web:** Our Chrome Extension Sidebar lives right inside `web.whatsapp.com`. One click reads the chat, checks stock, holds inventory, and inserts the reply into the WhatsApp message box.
  - **On the Single-Page WebApp:** Staff just drag-and-drop any **Supplier Stock Bill PDF** (`+Stock, -Cash`), **Operating Expense Bill** (`-Cash`), or **Customer Receipt** (`+Cash`)—or type a 1-line note when a customer calls on the phone.

### Selling Point #3: Money-First Aftersales Guardrail (Right on the Invoice)
- **The Pain:** A customer texts in Manglish: *"Boss, 1 bottle R32 leaking la, I hold the RM 4,800 balance until you replace it."* In normal SMEs, nobody updates the spreadsheet, and an admin embarrassingly sends them a payment reminder the next day.
- **How CashChase Solves It:** CashChase detects the complaint on WhatsApp, **automatically pauses payment reminders** on that invoice, and gives the Owner two 1-click resolutions right on the invoice row:
  1. **`Replace -1 Stock`** (deducts 1 unit from Physical Stock as warranty cost, keeping Company Net Worth accurate), OR
  2. **`Apply -RM Discount`** (reduces the invoice balance), followed by a 1-click **`Mark Resolved ✓`** button.

### Selling Point #4: Plain-English Live Company Net Worth (`Cash + Stock`)
- **The Pain:** Micro-SME owners don't understand accounting Debit/Credit balance sheets. They wake up asking: *"How much Cash and Stock do I actually have today?"*
- **How CashChase Solves It:** The top banner of our Single-Page WebApp translates every WhatsApp order and uploaded bill into two crystal-clear numbers:
  - **Core Net Worth** = `Cash on Hand + Physical Stock Value`
  - **Full Net Position** = `Core Net Worth + Pending Customer Invoices − Pending Supplier Bills`

---

## 3. How We Answer the Tough Judge Questions

### Q1: "What if the SME already has accounting software, or what if they only use Excel?"
> **Answer:** *"Our target market is the 3-to-20 person Malaysian micro-SME (contractors, spare-parts shops, small wholesalers) who currently use **WhatsApp + Excel** and hand a folder of bills to an external bookkeeper once a month. CashChase replaces their messy daily Excel sheet with zero setup, and gives them a **1-Click Monthly Excel Export (including LHDN Buyer TINs)** to hand straight to their bookkeeper or import into their accountant's software."*

### Q2: "How does a new SME set this up without spending days typing in their inventory?"
> **Answer:** *"We built **60-Second Zero-Typing Onboarding**. When an SME enables CashChase inside Orbyte, they just drop their existing Excel stock list or their last 3 Supplier Invoices into the upload box, type 1 number for their starting bank balance, and AI auto-populates their Stock Catalogue (`SKU, Unit Cost, Selling Price, Opening Stock`)."*

### Q3: "How does this fit into Orbyte without duplicating Orbyte's existing features?"
> **Answer:** *"Orbyte manages **internal HR and team operations** (`eLeave`, `eClaim`, `Attendance`). Orbyte does not have a customer-facing WhatsApp sales, stock-hold, and cashflow engine. CashChase plugs into Orbyte as the **Commercial & Stock Module**, reusing Orbyte's Role Permissions (`Owner` vs. `Sales/Admin`) and Immutable Activity Log."*

### Q4: "Where do you use AI vs. Rules, and how do people stay in control?"
> **Answer:** *"We follow a strict rule: **AI reads and drafts; deterministic code does all the math; humans approve every action.** Our Local LLM (`Qwen 2.5` via Ollama/RunPod) only extracts structured JSON from messy Malay/Manglish WhatsApp chats and uploaded invoice PDFs. Deterministic TypeScript code calculates stock availability, 48-hour hold timers, and Company Net Worth. Nothing is ever sent or deducted without a human click—and high-impact actions like confirming payments or deducting warranty stock require the **Owner** role."*

### Q5: "How would Orbyte monetize CashChase as a startup product?"
> **Answer:**
> - **Freemium (Included in Orbyte Core):** Single-Page Stock & Net Worth Tracker + Manual Phone Order Key-In + 30 AI WhatsApp/Invoice scans per month.
> - **CashChase Pro Module (RM 49 / month per SME):** Unlimited WhatsApp Extension Sidebar AI scans, Unlimited 1-Drop Invoice OCR Uploads, 48h Auto-Release Stock Holds, and 1-Click Bookkeeper/LHDN Excel Exports.

---

## 4. The 5-Minute Live Demo Script

| Minute | What You Show on Screen | What You Say to Judges |
|---|---|---|
| **0:00 – 0:45** | **Problem & Top Net Worth Banner** | Introduce *Sejuk Jaya Aircond Sdn Bhd*. Point to the top banner: **Cash on Hand (`RM 9,800`) + Physical Stock Value (`RM 10,200`) = `RM 20,000` Core Net Worth**. |
| **0:45 – 1:45** | **Flow 1: WhatsApp Inquiry → 48h Stock Hold** | Click **Tan Bros Trading** inquiry (*"Need 5x Daikin 1.5HP & 5x R32 Gas"*). In the **Chrome Extension Sidebar**, click **`1-Click Hold Stock (48h) & Insert Quote`**. Show the reply inserted into WhatsApp, and show `5 units` move to **`On Hold (48h)`**—while physical stock is **not** deducted yet! |
| **1:45 – 2:30** | **Flow 2: Role Guardrail + Owner Deposit Confirmation** | Switch to **Deposit Paid** chat. Switch role to **Sales/Admin (`Aina`)** first to show that staff cannot confirm money (`Owner Approval Required`). Switch back to **Owner (`Hafiz`)** and click **`Confirm Deposit & Deduct Physical Stock`**. Watch `On Hold` convert to **`Deducted`**, `Cash` jump by `+RM 2,000`, and `INV-204` appear! |
| **2:30 – 3:30** | **Flow 3: Aftersales Faulty Item on Unpaid Invoice** | Click **Klinik Dr. Lim** chat (*"1 bottle R32 leaking, I hold RM 4,800 payment"*). Point out that payment reminders on `INV-201` were **auto-paused**. Click **`Replace -1x R32 from Stock`**, then switch to the **Single-Page WebApp** and click **`✓ Mark Resolved`** on `INV-201`. |
| **3:30 – 4:30** | **Flow 4: 1-Drop Supplier Invoice OCR & Phone Call Bar** | On the **Single-Page WebApp**, click **Supplier Stock Bill (`+20x R32 Gas, RM 2,600`)** → Click **Confirm**. Watch Physical Stock jump by `+20 units` and Net Worth update live. Then click **`+ Create Quote`** on the **Phone Call Bar** to show how phone orders work just as fast. |
| **4:30 – 5:00** | **Flow 5: 60s Multi-SME Switch, Prompt View & Excel Export** | Switch the top dropdown from **Sejuk Jaya Aircond** to **Kopi & Bakery Wholesale** to prove any SME can onboard in 60 seconds. Show the **Formatted Agent Prompt & JSON** tab and click **`Export Monthly Excel (.xlsx)`**. |
