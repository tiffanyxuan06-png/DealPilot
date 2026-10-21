"""Supabase login: no token = 401, and the role comes from the token, never from the request body."""
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

import backend.services.auth as auth
from conftest import OWNER

URL = "https://test-project.supabase.co"
KEY = ec.generate_private_key(ec.SECP256R1())


def token(role=None, key=KEY, expires_in=3600):
    claims = {"sub": "user-1", "aud": "authenticated", "iss": f"{URL}/auth/v1", "exp": int(time.time()) + expires_in}
    if role:
        claims["app_metadata"] = {"role": role}
    return {"Authorization": f"Bearer {jwt.encode(claims, key, algorithm='ES256')}"}


@pytest.fixture(autouse=True)
def login_on(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", URL)
    signing_key = SimpleNamespace(key=KEY.public_key())
    monkeypatch.setattr(auth, "_jwks_client", lambda url: SimpleNamespace(get_signing_key_from_jwt=lambda t: signing_key))


def test_api_needs_a_valid_token(client):
    assert client.get("/api/auth/config").status_code == 200
    assert client.get("/api/state").status_code == 401
    assert client.get("/api/state", headers=token(expires_in=-60)).status_code == 401
    assert client.get("/api/state", headers=token(key=ec.generate_private_key(ec.SECP256R1()))).status_code == 401
    assert client.get("/api/state", headers=token()).status_code == 200


def test_role_comes_from_token_not_body(client):
    # Staff claiming OWNER in the body is still Staff.
    assert client.post("/api/reset", json=OWNER, headers=token()).status_code == 403
    assert client.post("/api/reset", json=OWNER, headers=token("STAFF")).status_code == 403
    # An Owner token works even without a role in the body.
    assert client.post("/api/reset", headers=token("OWNER")).status_code == 200
