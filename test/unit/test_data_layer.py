"""Data layer (docs/12): SQL migrations, ORM, JSON seeds and settings."""
import json

import pytest
from pydantic import ValidationError
from sqlalchemy import inspect

from backend.config import AppSettings, get_settings
from backend.db import get_engine
from backend.db.migrate import migrate, migrations_dir
from backend.db.orm import Base
from backend.db.seed import SeedFile, available_presets, load_defaults, load_seed


def test_schema_matches_orm(client):
    """Every ORM model's table and columns exist in the migrated database, so the SQL files and models can't drift."""
    insp = inspect(get_engine())
    tables = set(insp.get_table_names())
    for table in Base.metadata.sorted_tables:
        assert table.name in tables, f"{table.name} is in orm.py but no migration creates it"
        db_cols = {c["name"] for c in insp.get_columns(table.name)}
        assert {c.name for c in table.columns} == db_cols, f"{table.name}: orm.py and the migrations disagree"


def test_migrations_apply_once(client):
    assert migrate(get_engine()) == []  # already applied when the app started
    assert migrations_dir(get_engine()).name == get_engine().dialect.name


def test_seed_files_are_valid():
    presets = available_presets()
    assert presets == {"aircond": "Sejuk Jaya Aircond Sdn Bhd", "fnb": "Kopi & Bakery Wholesale Sdn Bhd"}
    for name in presets:
        load_seed(name)  # raises if a teammate's edit breaks the file
    assert load_defaults().settings["follow_up_hours"] == 48


def test_bad_seed_fails_clearly():
    good = json.loads(SeedFile.model_validate(load_seed("aircond").model_dump()).model_dump_json())
    good["deals"][0]["items"][0]["sku"] = "TYPO-123"
    with pytest.raises(ValidationError, match="SKU not on the price list: TYPO-123"):
        SeedFile.model_validate(good)


def test_database_url_is_required(monkeypatch):
    monkeypatch.delenv("DATABASE_URL")
    with pytest.raises(ValidationError):
        AppSettings(_env_file=None)
    monkeypatch.setattr("backend.config.AppSettings", lambda: AppSettings(_env_file=None))
    with pytest.raises(RuntimeError, match="DATABASE_URL is not set"):
        get_settings()


def test_health_shows_database_type_only(client):
    assert client.get("/api/health").json()["database"] == "sqlite"
