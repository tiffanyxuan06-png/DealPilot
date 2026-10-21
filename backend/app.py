from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from backend.database import init_db
from backend.services.lmstudio import check_lmstudio_health, DEFAULT_LMSTUDIO_URL, call_lmstudio_chat
from backend.routes.state import router as state_router
from backend.routes.whatsapp import router as whatsapp_router
from backend.routes.company_ai import router as company_ai_router
from backend.routes.invoices import router as invoices_router
from backend.routes.exports import router as exports_router
from backend.routes.team import router as team_router
from backend.routes.onboarding import router as onboarding_router

BASE_DIR = Path(__file__).resolve().parent.parent
WEBAPP_DIR = BASE_DIR / "webapp"

# Initialize SQLite database schema & seeds if missing
init_db(force_reset=False)

app = FastAPI(
    title="CashChase Orbyte API",
    description="Intelligent WhatsApp Copilot & Real-Time Net Worth Engine for SMEs",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Modular API Routers
app.include_router(state_router)
app.include_router(whatsapp_router)
app.include_router(company_ai_router)
app.include_router(invoices_router)
app.include_router(exports_router)
app.include_router(team_router)
app.include_router(onboarding_router)

# Mount webapp static directory, including /js and /css
if WEBAPP_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(WEBAPP_DIR)), name="static")
    js_dir = WEBAPP_DIR / "js"
    css_dir = WEBAPP_DIR / "css"
    if js_dir.exists():
        app.mount("/js", StaticFiles(directory=str(js_dir)), name="js")
    if css_dir.exists():
        app.mount("/css", StaticFiles(directory=str(css_dir)), name="css")


@app.get("/", response_class=HTMLResponse)
def root() -> HTMLResponse:
    index_file = WEBAPP_DIR / "index.html"
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>CashChase Orbyte Backend Online</h1><p>Webapp directory not found.</p>")
