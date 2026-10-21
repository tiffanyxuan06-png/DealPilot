"""Every test gets a fresh, seeded SQLite database in a temp folder (never backend/cashchase.db)."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

# Login off by default (the real .env may turn it on); test_auth.py switches it on itself.
os.environ["SUPABASE_URL"] = ""

import backend.database as database  # noqa: E402

# Must be set before backend.app is imported: importing the app initialises the database.
database.DB_PATH = Path(tempfile.mkdtemp()) / "test.db"

from fastapi.testclient import TestClient  # noqa: E402

from backend.app import app  # noqa: E402

OWNER = {"role": "OWNER"}
STAFF = {"role": "STAFF"}


@pytest.fixture
def client():
    database.init_db(force_reset=True)
    return TestClient(app)


def stock(state, sku):
    return next(s for s in state["stock"] if s["sku"] == sku)


def invoice(state, inv_id):
    return next((i for i in state["invoices"] if i["id"] == inv_id), None)
