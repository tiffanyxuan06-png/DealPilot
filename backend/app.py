from pathlib import Path
import jwt
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.config import get_settings
from backend.db import init_database
from backend.models.responses import AuthConfig
from backend.routes.state import router as state_router
from backend.routes.whatsapp import router as whatsapp_router
from backend.routes.company_ai import router as company_ai_router
from backend.routes.exports import router as exports_router
from backend.routes.deals import router as deals_router
from backend.routes.team import router as team_router
from backend.routes.onboarding import router as onboarding_router
from backend.routes.sidekick import router as sidekick_router
from backend.services.auth import auth_enabled, reset_current_role, role_from_claims, set_current_role, verify_token

BASE_DIR = Path(__file__).resolve().parent.parent
WEBAPP_DIR = BASE_DIR / "webapp"

# Apply pending migrations; an empty database gets the demo business.
init_database()

app = FastAPI(
    title="DealPilot Orbyte API",
    description="WhatsApp sales agent for Malaysian SMEs: quotes, follow-ups, pipeline and a won-orders CSV",
    version="2.0.0",
)

# Only pages served from this machine may call the API from a browser. The extension's background
# worker is not limited by CORS (it has host_permissions), and logins travel as a Bearer header, not cookies.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def validation_error_as_text(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Bad input is a 400 with one plain sentence, like every other error the WebApp and extension show."""
    first = exc.errors()[0] if exc.errors() else {}
    msg = str(first.get("msg", "Invalid request.")).removeprefix("Value error, ")
    field = ".".join(str(p) for p in first.get("loc", ())[1:] if not isinstance(p, int))
    custom = first.get("type") == "value_error"  # our own validators already write a full sentence
    return JSONResponse({"detail": msg if custom or not field else f"{field}: {msg}"}, status_code=400)


# Uploads arrive as base64 inside JSON: 15 MB of JSON is about a 10 MB file.
MAX_REQUEST_BYTES = 15 * 1024 * 1024


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    # ponytail: trusts Content-Length (browsers and the extension always send it); a chunked body is not counted
    if int(request.headers.get("content-length") or 0) > MAX_REQUEST_BYTES:
        return JSONResponse({"detail": "File too large (max 10 MB)."}, status_code=413)
    return await call_next(request)

PUBLIC_API_PATHS = {"/api/auth/config"}  # the login page needs this before anyone is signed in


@app.middleware("http")
async def require_login(request: Request, call_next):
    """With login on, every /api call needs a valid Supabase token; its user's role is used for permissions."""
    path = request.url.path
    if not auth_enabled() or request.method == "OPTIONS" or not path.startswith("/api/") or path in PUBLIC_API_PATHS:
        return await call_next(request)
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        return JSONResponse({"detail": "Please log in."}, status_code=401)
    try:
        claims = await run_in_threadpool(verify_token, header[len("Bearer "):].strip())
    except jwt.PyJWTError:
        return JSONResponse({"detail": "Your login has expired. Please log in again."}, status_code=401)
    token = set_current_role(role_from_claims(claims))
    try:
        return await call_next(request)
    finally:
        reset_current_role(token)


# Include Modular API Routers
app.include_router(state_router)
app.include_router(whatsapp_router)
app.include_router(company_ai_router)
app.include_router(exports_router)
app.include_router(deals_router)
app.include_router(team_router)
app.include_router(onboarding_router)
app.include_router(sidekick_router)

# Mount webapp static directory, including /js and /css
if WEBAPP_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(WEBAPP_DIR)), name="static")
    js_dir = WEBAPP_DIR / "js"
    css_dir = WEBAPP_DIR / "css"
    img_dir = WEBAPP_DIR / "img"
    if js_dir.exists():
        app.mount("/js", StaticFiles(directory=str(js_dir)), name="js")
    if css_dir.exists():
        app.mount("/css", StaticFiles(directory=str(css_dir)), name="css")
    if img_dir.exists():
        app.mount("/img", StaticFiles(directory=str(img_dir)), name="img")


@app.get("/api/auth/config", response_model=AuthConfig)
def auth_config() -> AuthConfig:
    """Public Supabase settings for the WebApp login (the anon key is safe to expose)."""
    env = get_settings()
    return AuthConfig(url=env.supabase_url, anon_key=env.supabase_anon_key)


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def root() -> HTMLResponse:
    index_file = WEBAPP_DIR / "index.html"
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>DealPilot Orbyte Backend Online</h1><p>Webapp directory not found.</p>")
