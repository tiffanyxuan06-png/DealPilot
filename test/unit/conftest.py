"""Every test gets a fresh, migrated and seeded database in a temp folder (never your own)."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

# Login off by default (the real .env may turn it on); test_auth.py switches it on itself.
os.environ["SUPABASE_URL"] = ""
# Must be set before backend.app is imported: importing the app migrates and seeds the database.
os.environ["DATABASE_URL"] = "sqlite:///" + (Path(tempfile.mkdtemp()) / "test.db").as_posix()

from fastapi.testclient import TestClient  # noqa: E402

from backend.config import AppSettings  # noqa: E402

# Tests never read your own .env (e.g. AI_PROVIDER=runpod with a real key): only the environment set here or by a test.
AppSettings.model_config["env_file"] = None

from backend.app import app  # noqa: E402
from backend.db import init_database  # noqa: E402

OWNER = {"role": "OWNER"}
STAFF = {"role": "STAFF"}


@pytest.fixture
def client():
    init_database(force_reset=True)
    return TestClient(app)
