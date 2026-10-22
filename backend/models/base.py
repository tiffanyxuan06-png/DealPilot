"""Shared base for the API models: camelCase JSON, read straight from SQLAlchemy rows."""
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """snake_case in Python, camelCase in JSON (both accepted on input)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True, serialize_by_alias=True)
