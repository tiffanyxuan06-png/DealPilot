from enum import Enum


class Stage(str, Enum):
    """Where a deal is: INQUIRY -> QUOTED <-> FOLLOW_UP -> WON or LOST."""

    INQUIRY = "INQUIRY"
    QUOTED = "QUOTED"
    FOLLOW_UP = "FOLLOW_UP"  # a follow-up is due now; after one is sent the deal returns to QUOTED
    WON = "WON"
    LOST = "LOST"


OPEN_STAGES = (Stage.INQUIRY, Stage.QUOTED, Stage.FOLLOW_UP)
PIPELINE_STAGES = (Stage.QUOTED, Stage.FOLLOW_UP)  # quoted but not yet decided


class Role(str, Enum):
    """Who is acting. The Owner sees costs and margins; Staff follow the Owner's permission modes."""

    OWNER = "OWNER"
    STAFF = "STAFF"


class PermissionMode(str, Enum):
    """What happens when Staff try an action: do it, ask the Owner first, or refuse."""

    ALLOW = "ALLOW"
    APPROVAL = "APPROVAL"
    DENY = "DENY"


class DealAction(str, Enum):
    """Actions on one deal through POST /api/deals/{id}/action."""

    SEND_QUOTE = "SEND_QUOTE"
    SEND_FOLLOW_UP = "SEND_FOLLOW_UP"
    MARK_WON = "MARK_WON"
    MARK_LOST = "MARK_LOST"
    APPLY_DISCOUNT = "APPLY_DISCOUNT"
    PAUSE = "PAUSE"
    RESUME = "RESUME"
    SET_TIN = "SET_TIN"
    CANCEL_WON = "CANCEL_WON"  # Owner only: a won order is cancelled and its commission reversed
