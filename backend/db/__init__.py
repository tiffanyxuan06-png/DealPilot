"""Database setup: migrate, then seed an empty database with a demo business."""
from typing import Optional

from sqlalchemy import func, select

from backend.db.engine import get_engine, session_scope


def init_database(force_reset: bool = False, preset: Optional[str] = None) -> None:
    """Applies pending migrations. `force_reset` drops everything first. An empty database gets `preset` (or the default demo)."""
    from backend.db import orm
    from backend.db.migrate import drop_all, migrate
    from backend.db.seed import DEFAULT_PRESET, seed_business

    engine = get_engine()
    if force_reset:
        drop_all(engine)
    migrate(engine)
    with session_scope() as session:
        if not session.scalar(select(func.count()).select_from(orm.Setting)):
            seed_business(session, preset or DEFAULT_PRESET)


__all__ = ["get_engine", "init_database", "session_scope"]
