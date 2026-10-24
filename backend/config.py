"""App settings from the environment and the project's .env file (pydantic-settings).

Real environment variables win over .env, so a shell, Replit Secret or test can override any value.
Read with get_settings(): it builds a fresh object each call, so changes to the environment apply at once.
"""
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    # Any SQLAlchemy URL. Local testing uses SQLite (e.g. sqlite:///backend/cashchase.db, see .env.example);
    # production can point at Postgres once its migrations exist (backend/schema/migrations/<dialect>/).
    # Default for local testing; set DATABASE_URL (in .env or the environment) to use another database, e.g. Postgres later.
    database_url: str = Field(
        "sqlite:///backend/cashchase.db",
        validation_alias=AliasChoices("CASHCHASE_DATABASE_URL", "DATABASE_URL", "database_url"),
    )
    host: str = "127.0.0.1"  # set HOST=0.0.0.0 to open the server to the Wi-Fi (e.g. a phone demo)
    port: int = 8000

    # LMSTUDIO_BASE_URL is the older name used in .env.example.
    lmstudio_url: str = Field("http://127.0.0.1:1234/v1", validation_alias=AliasChoices("LMSTUDIO_URL", "LMSTUDIO_BASE_URL"))
    lmstudio_api_key: str = "lm-studio"
    lmstudio_model: str = "local-model"
    lmstudio_vision_model: str = "auto"

    ai_provider: str = "lmstudio"  # lmstudio | runpod | auto
    runpod_base_url: str = ""
    runpod_endpoint_id: str = ""
    runpod_api_key: str = ""
    runpod_model: str = ""
    runpod_vision_model: str = ""

    supabase_url: str = ""  # login is on when this is set
    supabase_anon_key: str = ""

    @field_validator("runpod_base_url", "runpod_endpoint_id", "runpod_api_key", "runpod_model", "runpod_vision_model")
    @classmethod
    def _ignore_placeholders(cls, v: str) -> str:
        # .env.example ships values like 'your_runpod_endpoint_id_here'; treat them as empty.
        v = (v or "").strip()
        return "" if "your_" in v else v

    @field_validator("database_url")
    @classmethod
    def _sqlite_path_from_project(cls, v: str) -> str:
        # A relative SQLite path means "inside the project", wherever the server is started from.
        prefix = "sqlite:///"
        if v.startswith(prefix):
            path = Path(v[len(prefix):])
            if str(path) not in ("", ":memory:") and not path.is_absolute():
                return prefix + (ROOT / path).as_posix()
        return v

    @field_validator("ai_provider")
    @classmethod
    def _lower(cls, v: str) -> str:
        return (v or "lmstudio").strip().lower()

    @field_validator("supabase_url")
    @classmethod
    def _no_trailing_slash(cls, v: str) -> str:
        return (v or "").strip().rstrip("/")


def get_settings() -> AppSettings:
    return AppSettings()
