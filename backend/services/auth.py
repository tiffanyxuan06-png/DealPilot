"""Supabase login: verifies the access token the WebApp sends and decides the user's role.

Login is on when SUPABASE_URL is set in .env. The role comes from the user's Supabase
`app_metadata.role` (users cannot edit app_metadata themselves); anyone without it is Staff.
"""
import os
from contextvars import ContextVar
from functools import lru_cache
from typing import Any, Dict, Optional

import jwt

# The signed-in user's role for the request being handled (set by the login middleware in app.py).
_current_role: ContextVar[Optional[str]] = ContextVar("cashchase_role", default=None)


def supabase_url() -> str:
    return os.getenv("SUPABASE_URL", "").rstrip("/")


def auth_enabled() -> bool:
    return bool(supabase_url())


@lru_cache(maxsize=1)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    # Fetches the project's public signing keys once and caches them.
    return jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json")


def verify_token(token: str) -> Dict[str, Any]:
    """Returns the token's claims, or raises jwt.PyJWTError if it is missing, forged or expired."""
    url = supabase_url()
    key = _jwks_client(url).get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=["ES256", "RS256"], audience="authenticated", issuer=f"{url}/auth/v1")


def role_from_claims(claims: Dict[str, Any]) -> str:
    role = (claims.get("app_metadata") or {}).get("role", "")
    return "OWNER" if str(role).strip().upper() == "OWNER" else "STAFF"


def current_role() -> Optional[str]:
    return _current_role.get()


def set_current_role(role: Optional[str]):
    return _current_role.set(role)


def reset_current_role(token) -> None:
    _current_role.reset(token)
