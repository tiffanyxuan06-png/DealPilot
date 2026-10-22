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


def test_database_url_defaults_to_local_sqlite(monkeypatch):
    from backend.config import ROOT

    monkeypatch.delenv("DATABASE_URL")
    assert AppSettings(_env_file=None).database_url == "sqlite:///" + (ROOT / "backend" / "cashchase.db").as_posix()
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@h/db")
    assert get_settings().database_url == "postgresql+psycopg://u:p@h/db"  # the environment wins


def test_health_shows_database_type_only(client):
    assert client.get("/api/health").json()["database"] == "sqlite"


# --- Fixes from the independent review of the data-layer commit ---


def _deal_count():
    from sqlalchemy import text

    with get_engine().connect() as conn:
        return conn.execute(text("SELECT COUNT(*) FROM deals")).scalar()


@pytest.mark.parametrize("versions_table", ["missing", "empty"])
def test_pre_migration_database_is_rebuilt(client, versions_table):
    """A database from before migrations (or left half-migrated by a failed start) must not stop the server."""
    from sqlalchemy import text

    from backend.db import init_database

    with get_engine().begin() as conn:
        conn.execute(text("DROP TABLE schema_migrations"))
        conn.execute(text("DELETE FROM deals WHERE stage = 'LOST'"))  # mark it as "old data"
        if versions_table == "empty":
            conn.execute(text("CREATE TABLE schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)"))
    init_database()
    assert _deal_count() == 10  # rebuilt with fresh demo data
    assert migrate(get_engine()) == []


def test_failing_migration_changes_nothing(tmp_path, monkeypatch):
    from sqlalchemy import create_engine, inspect as sa_inspect

    import backend.db.migrate as migrate_mod

    folder = tmp_path / "sqlite"
    folder.mkdir()
    (folder / "001_ok.sql").write_text("CREATE TABLE a (id INTEGER);", encoding="utf-8")
    (folder / "002_bad.sql").write_text("CREATE TABLE b (id INTEGER);\nTHIS IS NOT SQL;", encoding="utf-8")
    monkeypatch.setattr(migrate_mod, "MIGRATIONS_ROOT", tmp_path)
    engine = create_engine(f"sqlite:///{(tmp_path / 'x.db').as_posix()}")
    with pytest.raises(RuntimeError, match="002_bad.sql failed"):
        migrate_mod.migrate(engine)
    tables = set(sa_inspect(engine).get_table_names())
    assert "a" in tables and "b" not in tables  # 002 rolled back completely
    with engine.connect() as conn:
        from sqlalchemy import text

        assert conn.execute(text("SELECT version FROM schema_migrations")).scalars().all() == ["001_ok"]
    engine.dispose()


def test_relative_sqlite_path_is_inside_the_project():
    from backend.config import ROOT

    url = AppSettings(_env_file=None, database_url="sqlite:///backend/x.db").database_url
    assert url == "sqlite:///" + (ROOT / "backend" / "x.db").as_posix()
    assert AppSettings(_env_file=None, database_url="postgresql+psycopg://u:p@h/db").database_url == "postgresql+psycopg://u:p@h/db"


def test_bad_input_is_400_with_one_sentence(client):
    """The WebApp shows `detail` as text, so validation errors must not come back as a 422 list."""
    from conftest import OWNER

    r = client.post("/api/deals", json={**OWNER, "customer": "  ", "items": [{"sku": "GAS-R32", "qty": 1}]})
    assert (r.status_code, r.json()["detail"]) == (400, "Enter the customer's name.")
    r = client.post("/api/deals", json={**OWNER, "customer": "A", "items": [{"sku": "GAS-R32", "qty": 0}]})
    assert r.status_code == 400 and isinstance(r.json()["detail"], str) and "qty" in r.json()["detail"]


def test_rep_names_are_matched_exactly(client):
    from conftest import OWNER

    assert client.post("/api/reps", json={**OWNER, "name": "%"}).status_code == 200  # no wildcard clash
    assert client.post("/api/reps", json={**OWNER, "name": "A_na"}).status_code == 200
    assert client.post("/api/reps", json={**OWNER, "name": "aina"}).status_code == 409


def test_whatsapp_tin_approval_replays_and_matches_any_case(client):
    from conftest import OWNER, STAFF

    client.post("/api/permissions", json={**OWNER, "staffModes": {"deal.set_tin": "APPROVAL"}})
    body = {"customer": "kedai runcit ah seng", "actionType": "SAVE_LHDN_TIN", "tin": "C29988776650"}
    r = client.post("/api/whatsapp/execute", json={**STAFF, **body}).json()
    assert r["status"] == "pending_approval"
    s = client.post(f"/api/approvals/{r['approvalId']}/decide", json={**OWNER, "decision": "APPROVE"}).json()["state"]
    assert next(c for c in s["customers"] if c["name"] == "Kedai Runcit Ah Seng")["tin"] == "C29988776650"
    assert any("open deals: #QT-2026-101" in line for line in s["logs"])  # lower-case name still finds the deal


# --- Every JSON route is described by a Pydantic model in /docs ---

# Free-form on purpose: the old copilot's AI output (Phase 3 gives it a model) and FastAPI's own 422 error model.
ALLOWED_FREE_FORM = {"WhatsAppAnalyzeResponse/properties/analysis", "ValidationError/properties/ctx"}


def _free_form(schema, path, out):
    if isinstance(schema, dict):
        if schema.get("type") == "object" and "properties" not in schema and schema.get("additionalProperties") in (None, True, {}):
            out.append(path)
        for k, v in schema.items():
            _free_form(v, f"{path}/{k}", out)
    elif isinstance(schema, list):
        for v in schema:
            _free_form(v, path, out)


def test_openapi_has_no_untyped_objects(client):
    spec = client.get("/openapi.json").json()
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            content = op["responses"]["200"].get("content", {})
            assert "application/json" not in content or "$ref" in str(content["application/json"]["schema"]), f"{method.upper()} {path} has no response model"
    out = []
    for name, schema in spec["components"]["schemas"].items():
        _free_form(schema, name, out)
    assert set(out) <= ALLOWED_FREE_FORM, f"untyped objects: {sorted(set(out) - ALLOWED_FREE_FORM)}"


def test_client_memory_route_matches_its_model(client):
    known = client.get("/api/client/memory", params={"customer": "Kedai Runcit Ah Seng"}).json()
    assert known["isNew"] is False and known["trustBadge"]
    new = client.get("/api/client/memory", params={"customer": "Nobody Yet"}).json()
    assert new["isNew"] is True and new["tier"] == "NEW_CLIENT"
