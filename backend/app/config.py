from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Server-side configuration. Missing required values fail at startup, loudly."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    environment: str = "development"
    log_level: str = "info"

    # Transaction-mode pooler (port 6543). Migrations use DIRECT_URL instead.
    database_url: str
    direct_url: str | None = None

    supabase_url: str
    supabase_jwks_url: str
    # Present for legacy HS256 projects; this project signs with ES256 via JWKS.
    supabase_jwt_secret: str | None = None
    supabase_service_role_key: str | None = None

    allowed_origins: str = "http://localhost:8081"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower().startswith("prod")

    @property
    def jwt_issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def sqlalchemy_url(self) -> str:
        """
        Normalise the Supabase connection string for SQLAlchemy + asyncpg.

        `?pgbouncer=true` is a Prisma convention, not a libpq parameter: asyncpg
        would try to send it as a server setting and the connection would fail.
        We strip it and disable prepared statements instead (see db/session.py),
        which is what a transaction-mode pooler actually requires.
        """
        url = self.database_url
        for token in ("?pgbouncer=true", "&pgbouncer=true"):
            url = url.replace(token, "")
        if url.startswith("postgresql+asyncpg://"):
            return url
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+asyncpg://", 1)
        return url

    @property
    def uses_transaction_pooler(self) -> bool:
        return ":6543/" in self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
