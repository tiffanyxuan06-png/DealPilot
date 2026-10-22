"""Applies the SQL migrations for the current database, in name order, once each (recorded in schema_migrations).

Migrations live per database type: backend/schema/migrations/<dialect>/ (sqlite now; postgresql when we move).
Rules: never edit a pushed migration; add the next numbered file instead (docs/12_Data_Layer_Refactor_Plan.md).
"""
from pathlib import Path
from typing import List

from sqlalchemy import Engine, MetaData, inspect, text

from backend.services.clock import now_stamp

MIGRATIONS_ROOT = Path(__file__).resolve().parent.parent / "schema" / "migrations"
LEGACY_TABLE = "invoices"  # only exists in the old cash & stock version, whose database held demo data only


def migrations_dir(engine: Engine) -> Path:
    folder = MIGRATIONS_ROOT / engine.dialect.name
    if not folder.is_dir():
        raise RuntimeError(f"No migrations for {engine.dialect.name} yet: add backend/schema/migrations/{engine.dialect.name}/001_initial.sql")
    return folder


def drop_all(engine: Engine) -> None:
    """Drops every table (and its triggers), in foreign-key order. Used by reset and to rebuild an old database."""
    meta = MetaData()
    meta.reflect(engine)
    meta.drop_all(engine)


def _run_script(conn, sql: str) -> None:
    if conn.dialect.name == "sqlite":
        # The sqlite driver runs one statement per execute(); executescript runs a whole file (incl. triggers),
        # wrapped in BEGIN/COMMIT so a failing file changes nothing.
        db = conn.connection.driver_connection
        try:
            db.executescript(f"BEGIN;\n{sql}\nCOMMIT;")
        except Exception:
            if db.in_transaction:
                db.rollback()
            raise
    else:
        conn.exec_driver_sql(sql)


def migrate(engine: Engine) -> List[str]:
    """Applies the migrations not yet recorded. Returns the versions applied now."""
    folder = migrations_dir(engine)
    if LEGACY_TABLE in inspect(engine).get_table_names():
        drop_all(engine)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)"))
        done = set(conn.execute(text("SELECT version FROM schema_migrations")).scalars())

    applied = []
    for path in sorted(folder.glob("*.sql")):
        if path.stem in done:
            continue
        sql = path.read_text(encoding="utf-8")
        try:
            with engine.begin() as conn:
                _run_script(conn, sql)
                conn.execute(text("INSERT INTO schema_migrations (version, applied_at) VALUES (:v, :t)"), {"v": path.stem, "t": now_stamp()})
        except Exception as exc:
            raise RuntimeError(f"Migration {engine.dialect.name}/{path.name} failed: {exc}") from exc
        applied.append(path.stem)
    return applied
