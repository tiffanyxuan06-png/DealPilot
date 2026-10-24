from datetime import datetime
from typing import Optional

# Full timestamps compare correctly as text, so queries can filter on them directly.
TIME_FORMAT = "%Y-%m-%d %H:%M:%S"


def now_stamp() -> str:
    return datetime.now().strftime(TIME_FORMAT)


def now_time_str() -> str:
    """Clock time shown in the activity log, e.g. 07:54 PM."""
    return datetime.now().strftime("%I:%M %p")


def parse_time(value: Optional[str]) -> Optional[datetime]:
    try:
        return datetime.strptime(value, TIME_FORMAT) if value else None
    except ValueError:
        return None
