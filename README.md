# CashChase for Orbyte SME

Intelligent WhatsApp Copilot and Real-Time Net Worth Engine for SMEs powered by local LLM / VLM (LM Studio).

---

## Quick Start Guide

### Step 1: Set Up LM Studio & Model
1. Download and install [LM Studio](https://lmstudio.ai/).
2. Open LM Studio, search for and download the model:
   - **`qwen3-vl-4b-instruct`** (or `qwen3-4b-instruct`)
3. Go to the **Developer / Local Server** tab (`<->` icon on the left sidebar).
4. Select the downloaded model from the top dropdown to load it into memory.
5. Click **Start Server**:
   - Ensure the server port is set to `1234` (`http://127.0.0.1:1234/v1`).
   - Enable **CORS** in the server settings.

---

### Step 2: Run CashChase
Simply double-click:
```text
start_cashchase.bat
```
*(or run `.\start_cashchase.bat` in your PowerShell / Command Prompt)*

This will:
- Start the CashChase backend server on `http://localhost:8000`
- Automatically open the interactive web dashboard in your browser

---

### Step 3: Install the WhatsApp Web Chrome Extension (Optional)
To use CashChase directly inside live [WhatsApp Web](https://web.whatsapp.com/):

1. Open Google Chrome, Brave, or Microsoft Edge.
2. Navigate to:
   - Chrome / Brave: `chrome://extensions`
   - Edge: `edge://extensions`
3. Toggle on **Developer mode** (top-right switch).
4. Click **Load unpacked** (top-left button).
5. Select the **`extension/`** folder inside this project directory (`cashchase/extension`).
6. Open [web.whatsapp.com](https://web.whatsapp.com/) in your browser.
7. Click any conversation — the CashChase Copilot sidebar appears on the right side with live stock checks, customer memory, and 1-click quote holds.

---

## What's Included
- **Live WhatsApp Copilot**: Generates contextual replies, 48-hour stock holds, and after-sales resolutions.
- **Stock & Inventory Guard**: Automatically tracks on-hand vs. on-hold stock with zero stock leakage to customers.
- **Real-Time Net Worth Engine**: Live cash on hand, physical stock value, receivables, and payables.
- **OCR Receipt Verification**: Two-stage fast PDF text extraction and fallback Vision OCR for bank slips.
- **Multi-SME Profiles**: Seamlessly switch between Aircond Contractor, Software Studio, and Wholesale F&B.
- **Owner-Controlled Team Permissions**: In ⚙️ Settings → Team & Permissions the Owner sets each Staff action to Allowed, Needs Owner approval, or Off. Requests show up under **Owner Approvals** on the Dashboard. Everything is checked by the backend and logged.
- **Real 48h Quote Holds**: Quotes hold stock with a live countdown and release it automatically when they expire (Owner-only ⏩ demo clock in Settings).
- **Safety Checks**: Receipts with the wrong payee, a reused reference, or the wrong amount go to the Owner; every RM amount in an AI reply must match an amount CashChase calculated.

---

## Configuration (`.env`)
Copy `.env.example` to `.env`. It is loaded automatically when the server starts; values already set in your environment (e.g. Replit Secrets) win.
- `LMSTUDIO_URL`, `LMSTUDIO_API_KEY`, `LMSTUDIO_MODEL`: your LM Studio server (default `http://127.0.0.1:1234/v1`).
- `PORT`: server port (default `8000`).

---

## Running the Tests
```text
pip install -r requirements-dev.txt
python -m pytest -q
```
The tests use a temporary database (your `backend/cashchase.db` is never touched) and do not need LM Studio. `run_tests.bat` runs them first, then the LM Studio end-to-end scripts in `test/`.
