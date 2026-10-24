> [!IMPORTANT]
> ## 📁 Submission Documents & Templates
> **All required submission templates are in the Google Drive folder below. Download them before you start.**
>
> ### 👉 [**OPEN THE GOOGLE DRIVE FOLDER**](https://drive.google.com/drive/folders/1xw7c2aN8N-at8hPEULzkcU76e_FFb0Ef) 👈

---

# DealPilot

> Autonomous WhatsApp Web Copilot and Real-Time Deal CRM for Malaysian SMEs powered by local LLM and RunPod Serverless GPU.

---

## Team Information

| Field                  | Details                                     |
| ---------------------- | ------------------------------------------- |
| **Team Name**          | [Your Team Name]                            |
| **Team Domain**        | Domain 2: Orbyte Smart SME Challenge ("Less Busywork, Better Business") |
| **SDG Track (1–17)**   | SDG 8 — Decent Work and Economic Growth     |
| **Team Leader**        | Frederick Tiong                             |
| **University**         | [Your University Name]                      |
| **Number of Members**  | 3                                           |

## Links

| Resource          | Link                                           |
| ----------------- | ---------------------------------------------- |
| GitHub Repository | https://github.com/tiffanyxuan06-png/DealPilot  |
| Live Demo         | https://dealpilot.replit.app                   |
| RunPod Endpoint   | https://api.runpod.ai/v2/your-endpoint-id      |
| Slide Deck        | [Link to Slides]                               |
| Demo Video        | [Link to Demo Video]                           |

---

## Overview

### Problem

In Southeast Asia, over 80% of micro and SME commerce operates directly over WhatsApp chats. However, business owners and sales reps face severe busywork: juggling quotation calculations, tracking stock and reservations in disconnected spreadsheets, manually following up on aging quotes, and struggling with unrecorded warranty replacements or disputed payment slips. Crucial sales drop through the cracks, and business owners lack real-time visibility into their deals, margin leakage, and customer pipeline.

### Solution

**DealPilot** eliminates this busywork by integrating an intelligent Chrome Extension sidebar directly into **WhatsApp Web**, backed by a full-featured Deal CRM and local/cloud GPU AI inference (RunPod vLLM / LM Studio). It acts as an autonomous sales co-pilot: parsing customer inquiries, checking live catalog pricing and stock availability, recommending structured consultative sales options, generating quotation PDFs, tracking deal stages, and initiating WhatsApp conversations with one click.

### Key Features

- **In-Chat WhatsApp Web Copilot**: Directly reads the active WhatsApp conversation, detects buying intent, matches price lists, and crafts consultative reply options with 1-click draft insertion.
- **WhatsApp Web Direct Launcher**: Seamlessly opens customer chats (`web.whatsapp.com/send?phone=...`) and auto-extracts customer phone numbers from WhatsApp message identifiers.
- **Automated Deal Pipeline & CRM**: Tracks customer stages (Inquiry, Quoted, Follow-up, Payment Pending, Won), logs follow-up attempts, and alerts owners when hot leads go cold.
- **Margin Guard & Price List Alignment**: Enforces strict discount limits, quantity tiers, and prevents underquoting or unauthorized discounts through Owner approval workflows.
- **Role-Based Access Control & Approvals**: Separates Owner and Staff privileges with an audit trail, approval requests, and tamper-resistant activity logging.
- **Dual AI Infrastructure**: Seamlessly operates on **RunPod GPU serverless vLLM** in cloud deployment or **LM Studio** locally, with deterministic fallback responses ensuring zero downtime.

### Tech Stack

| Layer         | Technology                   |
| ------------- | ---------------------------- |
| Frontend      | HTML5, Vanilla JavaScript, Tailwind CSS (Browser runtime) |
| Chrome Ext.   | Manifest V3 Content Script & Background Worker (Vanilla JS / CSS) |
| Backend       | Python 3.11+, FastAPI, Uvicorn, Pydantic v2 |
| Database      | SQLite / SQLAlchemy with SQL migrations |
| AI / Compute  | RunPod Serverless GPU (vLLM / Qwen) & LM Studio (Local LLM/VLM) |
| Hosting / Dev | Replit, Cloud Run |

---

## Project Structure

```
.
├── backend/                 # FastAPI REST API & Core Business Services
│   ├── app.py               # Application entry point & router mounting
│   ├── config.py            # Environment configuration & settings
│   ├── db/                  # Database engine, SQLAlchemy ORM, seeds & migrations
│   ├── models/              # Pydantic v2 domain schemas & state entities
│   ├── routes/              # API endpoints (deals, whatsapp, team, onboarding, etc.)
│   ├── schema/              # SQL migrations & JSON demo seeds
│   └── services/            # Business logic, AI provider, prompts, pipeline & permissions
├── docs/                    # Architectural specs, user flows, and hackathon documentation
├── extension/               # DealPilot Chrome Extension (WhatsApp Web Copilot)
│   ├── manifest.json        # Extension Manifest V3 configuration
│   ├── content.js           # Content script injected into WhatsApp Web
│   ├── sidebar.css          # Extension styling & sidekick UI
│   └── background.js        # Service worker for extension lifecycle
├── submission/              # Required SDC Hackathon 2026 submission documents
│   ├── SDC2026_TeamName_Preliminary.pdf
│   ├── SDC2026_TeamName_TechDeclaration.pdf
│   ├── SDC2026_TeamName_Replit_POU.pdf
│   └── SDC2026_TeamName_Runpod_POU.pdf
├── test/                    # End-to-end integration and unit tests
│   ├── unit/                # Pytest unit tests (272 test cases)
│   ├── test_lmstudio_and_flow.py
│   └── test_lmstudio_live_chat.py
├── webapp/                  # Interactive DealPilot Web Application UI
│   ├── index.html           # Main CRM dashboard & deal management
│   ├── extension.html       # Extension download & installation guide
│   ├── privacy.html         # Privacy notice & data security guarantee
│   ├── css/                 # Stylesheets & Tailwind integration
│   └── js/                  # Client-side controllers (dashboard, copilot, auth, state)
├── .env.example             # Template for local & cloud environment variables
├── .gitignore               # Git ignore rules
├── .replit                  # Replit deployment & startup configuration
├── LICENSE                  # Apache 2.0 License
├── requirements.txt         # Core backend Python dependencies
├── requirements-dev.txt     # Development and testing dependencies
├── run_server.py            # Standalone server runner
├── start_dealpilot.bat      # Windows one-click launcher
└── README.md
```

### Architecture

```
                                    ┌────────────────────────────────────────┐
                                    │          WhatsApp Web Browser          │
                                    │    (DealPilot Chrome Extension Mv3)    │
                                    └──────────────────┬─────────────────────┘
                                                       │
                                  Direct API / JSON    │  web.whatsapp.com/send
                                                       ▼
┌───────────────────────┐           ┌────────────────────────────────────────┐
│  DealPilot Web App    │◄─────────►│     DealPilot FastAPI Backend API      │
│  (Dashboard / CRM)    │           │          (Replit / Cloud Run)          │
└───────────────────────┘           └──────────────────┬─────────────────────┘
                                                       │
                                   OpenAI-Compatible   │
                                   vLLM Protocol       ▼
                                    ┌────────────────────────────────────────┐
                                    │            AI Model Provider           │
                                    │  • RunPod Serverless GPU (Qwen-3/2.5)  │
                                    │  • LM Studio (Local Dev Fallback)      │
                                    └────────────────────────────────────────┘
```

---

## How to Run

### Option 1 — Run on Replit (Recommended)

1. Open the [Replit Project](https://replit.com/@your-username/your-project), or import this repository via **Create Repl → Import from GitHub**.
2. Open the **Secrets** tab (🔒) and add the variables listed in `.env.example`:
   - `AI_PROVIDER`: `runpod` (or `auto`)
   - `RUNPOD_API_KEY`: Your RunPod API key (`rpa_...`)
   - `RUNPOD_ENDPOINT_ID`: Your RunPod Serverless Endpoint ID
   - `RUNPOD_MODEL`: Model identifier (e.g. `Qwen/Qwen3-4B-Instruct`)
3. Click **Run**. Replit uses the `.replit` file to start `python run_server.py`.

### Option 2 — Run Locally

```bash
# 1. Clone the repository
git clone https://github.com/tiffanyxuan06-png/DealPilot.git
cd DealPilot

# 2. Create and activate a virtual environment
python -m venv venv
venv\Scripts\activate        # Linux/macOS: source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment variables
cp .env.example .env         # then fill in your values (default: SQLite + local LM Studio)

# 5. Run DealPilot
python run_server.py         # Or on Windows, double-click start_dealpilot.bat
```

### Run Tests

```bash
pip install -r requirements-dev.txt
python -m pytest test/unit -q
```
*(All 272 automated unit tests run against an isolated SQLite test database and do not require active AI servers).*

---

## How We Use Replit *(Required)*

- **Development & Collaboration:** Developed collaboratively using Replit environment and GitHub sync.
- **Hosting & Production Deployment:** DealPilot backend and web app are hosted as a Replit cloud deployment using `.replit` configuration with continuous availability.
- **Secrets Management:** Cloud GPU keys (`RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`) and environment settings are secured in Replit Secrets, strictly decoupled from the codebase.

📄 Proof of use: [`submission/SDC2026_TeamName_Replit_POU.pdf`](submission/SDC2026_TeamName_Replit_POU.pdf)

## How We Use RunPod *(Required)*

- **Workload:** High-performance LLM / VLM inference runs on RunPod Serverless GPUs using vLLM for fast quotation understanding, buying intent categorization, and contextual sales recommendations.
- **Setup:** RunPod Serverless Endpoint hosting `Qwen/Qwen3-4B-Instruct` (and `Qwen/Qwen2.5-VL-3B-Instruct` for multimodal vision verification).
- **Integration:** The backend connects to RunPod via `backend/services/ai_provider.py` and `backend/services/lmstudio.py` using OpenAI-compatible `/v1/chat/completions` endpoints.
- **Resilience & Fallback:** Built with automatic retry, timeout guards, and deterministic fallback responses, guaranteeing that DealPilot remains 100% operational even during RunPod GPU cold starts.

Example request:

```bash
curl -X POST https://api.runpod.ai/v2/$RUNPOD_ENDPOINT_ID/openai/v1/chat/completions \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B-Instruct",
    "messages": [{"role": "user", "content": "Boss how much for 3 units Daikin 1.5HP with installation?"}]
  }'
```

📄 Proof of use: [`submission/SDC2026_TeamName_Runpod_POU.pdf`](submission/SDC2026_TeamName_Runpod_POU.pdf)

---

## Challenges & Learnings

- **WhatsApp DOM Volatility & Extension Resilience:** WhatsApp Web frequently updates its DOM structure. We designed resilient multi-fallback selectors and utilized standard `web.whatsapp.com/send` protocols and message-ID extraction to reliably link conversations to CRM deals.
- **AI Latency vs. Sales Speed:** Sales agents need instantaneous responses. We implemented a dual-layer architecture combining local deterministic heuristic tools (instant quote math, margin checks) with asynchronous RunPod GPU inference.
- **Strict Privacy in External Messaging:** Malaysian SMEs handle confidential client numbers. DealPilot guarantees that unapproved client contacts are never synced or leaked, and API keys remain strictly on the backend.

## Future Improvements

- [ ] Direct integration with Malaysian e-Invoicing (LHDN MyInvois SDK).
- [ ] Multi-agent automated follow-up sequences with customizable cooldown periods.
- [ ] Voice note transcription and OCR receipt analysis via RunPod Whisper and Vision models.

## Team

| Name | Role | GitHub |
| --- | --- | --- |
| **Frederick Tiong** | Team Lead / Backend & AI | [@fredericktky](https://github.com/fredericktky) |
| **Ng Jing Xuan** | Frontend & Chrome Extension | [@tiffanyxuan06-png](https://github.com/tiffanyxuan06-png) |
| **Lim Yue Qi** | UI/UX & Quality Assurance | [@limyueqi](https://github.com/limyueqi) |

---

## Submission Checklist

- [ ] Team name, domain (Domain 2) and SDG track filled in
- [ ] Slide deck link added
- [ ] Demo video link added
- [ ] Replit used, with proof of use in `submission/`
- [ ] RunPod used, with proof of use in `submission/`
- [ ] Preliminary submission completed (`SDC2026_TeamName_Preliminary.pdf`)
- [ ] Technology declaration completed (`SDC2026_TeamName_TechDeclaration.pdf`)
- [ ] Submission files renamed with your team name (replace `TeamName`)
- [ ] "How to Run" steps verified
- [ ] No API keys or secrets committed to the repository

## License

This project is licensed under the [Apache License 2.0](LICENSE).
