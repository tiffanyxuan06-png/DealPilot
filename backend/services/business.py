"""Read and write the business settings (the `settings` table), typed by BusinessSettings."""
from typing import Union

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db import orm
from backend.db.seed import load_defaults
from backend.models.settings import BusinessSettings


def load_business(session: Session) -> BusinessSettings:
    """defaults.json first, then whatever the database holds."""
    stored = {row.key: row.value for row in session.scalars(select(orm.Setting))}
    return BusinessSettings.model_validate({**load_defaults().settings, **stored})


def save_setting(session: Session, key: str, value: Union[str, int, float]) -> None:
    BusinessSettings.model_validate({**load_business(session).model_dump(), key: value})  # rejects bad values early
    session.merge(orm.Setting(key=key, value=str(value)))
