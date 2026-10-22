"""Applies the SQL migrations for the current database, in name order, once each (recorded in schema_migrations).

Migrations live per database type: backend/schema/migrations/<dialect>/ (sqlite now; postgresql when we move).
Rules: never edit a pushed migration; add the next numbered file instead (docs/12_Data_Layer_Refactor_Plan.md).
"""
from pathlib import Path
from typing import List

from sqlalchemy import Engine, MetaData, inspect, text

from backend.services.clock import now_stamp

MIGRATIONS_ROOT = Path(__file__).resolve().parent.parent / "schema" / "migrations"
VERSIONS_TABLE = "schema_migrations"


def _is_pre_migration(engine: Engine) -> bool:
    """A database made before migrations existed (the cash & stock version, or the branch before doc 12):
    it has app tables but no recorded migration (schema_migrations missing, or left empty by a failed start).
    Those only ever held demo data, so they are rebuilt."""
    tables = set(inspect(engine).get_table_names())
    if not tables - {VERSIONS_TABLE}:
        return False
    if VERSIONS_TABLE not in tables:
        return True
    with engine.connect() as conn:
        return not conn.execute(text(f"SELECT COUNT(*) FROM {VERSIONS_TABLE}")).scalar()


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


def _apply(engine: Engine, version: str, sql: str) -> None:
    """Runs one migration file and records it in the same transaction, so a file is never half-applied or unrecorded."""
    record = f"INSERT INTO {VERSIONS_TABLE} (version, applied_at) VALUES ('{version}', '{now_stamp()}');"
    with engine.begin() as conn:
        if conn.dialect.name == "sqlite":
            # The sqlite driver runs one statement per execute(); executescript runs a whole file (incl. triggers).
            db = conn.connection.driver_connection
            try:
                db.executescript(f"BEGIN;\n{sql}\n{record}\nCOMMIT;")
            except Exception:
                if db.in_transaction:
                    db.rollback()
                raise
        else:
            conn.exec_driver_sql(f"{sql}\n{record}")


def migrate(engine: Engine) -> List[str]:
    """Applies the migrations not yet recorded. Returns the versions applied now."""
    folder = migrations_dir(engine)
    if _is_pre_migration(engine):
        drop_all(engine)
    with engine.begin() as conn:
        conn.execute(text(f"CREATE TABLE IF NOT EXISTS {VERSIONS_TABLE} (version VARCHAR(255) PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)"))
        done = set(conn.execute(text(f"SELECT version FROM {VERSIONS_TABLE}")).scalars())

    applied = []
    for path in sorted(folder.glob("*.sql")):
        if path.stem in done:
            continue
        try:
            _apply(engine, path.stem, path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise RuntimeError(f"Migration {engine.dialect.name}/{path.name} failed: {exc}") from exc
        applied.append(path.stem)
    return applied
