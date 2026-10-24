"""SQLAlchemy engine and sessions for DATABASE_URL. Tables come only from backend/schema/migrations (see migrate.py)."""
from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session

from backend.config import get_settings


@lru_cache(maxsize=None)
def _engine_for(url: str) -> Engine:
    if not url.startswith("sqlite"):
        return create_engine(url, pool_pre_ping=True)

    # SQLite (local testing): allow use across FastAPI's threads and turn on foreign keys, which SQLite leaves off.
    engine = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record) -> None:
        dbapi_conn.execute("PRAGMA foreign_keys = ON")

    return engine


def get_engine() -> Engine:
    return _engine_for(get_settings().database_url)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Commits on success, rolls back on any error, always closes (so a failed request never leaves the DB locked)."""
    session = Session(get_engine(), expire_on_commit=False)
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()
