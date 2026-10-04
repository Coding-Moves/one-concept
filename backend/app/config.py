from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Server-side configuration. Missing required values fail at startup, loudly."""

    owner_telemetry_enabled: bool = False

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True
    )

    environment: str = "development"
    log_level: str = "info"
    rate_limit_reads_per_minute: int = Field(default=120, ge=1, le=10000)
    rate_limit_writes_per_minute: int = Field(default=60, ge=1, le=10000)
    rate_limit_max_buckets: int = Field(default=20000, ge=1, le=100000)

    # Transaction-mode pooler (port 6543). Migrations use DIRECT_URL instead.
    database_url: str
    direct_url: str | None = None

    # Best-effort API pool warm-up; zero disables it. Workers do not start it.
    db_keepalive_interval_seconds: float = Field(default=30, ge=0, allow_inf_nan=False)
    db_keepalive_timeout_seconds: float = Field(default=5, gt=0, allow_inf_nan=False)

    supabase_url: str
    supabase_jwks_url: str
    # Present for legacy HS256 projects; this project signs with ES256 via JWKS.
    supabase_jwt_secret: str | None = None
    supabase_service_role_key: str | None = None
    # Public anon key. Safe to expose — it's already shipped in the mobile
    # bundle. The /reset-password landing page uses it (client-side) to call
    # Supabase's auth REST endpoint; the page is inert without it.
    supabase_anon_key: str | None = None

    # Enable only after schema, worker and mobile staging verification.
    weekly_quiz_notifications_enabled: bool = False

    # Generation. The key lives here and only here — never in the app bundle.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.1-flash-lite"
    generation_enabled: bool = False
    min_pool_per_topic: int = Field(default=25, ge=0)
    content_reserve_per_topic: int = Field(default=60, ge=1, le=365)
    # A learner nearing the end of a topic only schedules background work.
    content_low_watermark: int = Field(default=10, ge=0, le=30)
    content_critical_watermark: int = Field(default=3, ge=0, le=10)
    content_active_days: int = Field(default=90, ge=1, le=365)
    content_planned_reserve: int = Field(default=90, ge=1, le=1000)
    content_review_backlog_limit: int = Field(default=25, ge=1, le=250)
    # Future curated refill is deliberately conservative and uses an
    # allowance separate from editorial corrections and legacy enrichment.
    content_generation_batch: int = Field(default=5, ge=1, le=25)
    future_refill_daily_call_cap: int = Field(default=5, ge=0, le=100)
    future_refill_topic_daily_cap: int = Field(default=1, ge=1, le=10)
    future_refill_urgent_enabled: bool = False
    future_refill_urgent_daily_call_cap: int = Field(default=10, ge=0, le=100)
    future_refill_urgent_topic_daily_cap: int = Field(default=2, ge=1, le=10)
    # Shared by all generation paths; zero prevents new reservations.
    generation_max_concurrent: int = Field(default=3, ge=1, le=20)
    generation_daily_call_cap: int = Field(default=200, ge=0)
    # Seconds between worker calls; the free tier allows ~10 requests a minute.
    generation_pace_seconds: float = 6.0
    # Schedule background refill when a user's unread pool is low.
    generation_on_demand: bool = True

    allowed_origins: str = "http://localhost:8081"
    # Off until migration, owner bootstrap and dashboard/Auth setup are verified.
    editorial_enabled: bool = False
    editorial_invite_redirect_url: str = ""
    # Dedicated backend delivery; Supabase Auth templates are not a mail API.
    editorial_email_enabled: bool = False
    editorial_email_dashboard_url: str = ""
    editorial_email_test_recipients: str = ""
    editorial_email_daily_cap: int = Field(default=40, ge=0, le=500)
    editorial_email_from: str = ""
    editorial_gmail_client_id: str = ""
    editorial_gmail_client_secret: str = Field(default="", repr=False)
    editorial_gmail_refresh_token: str = Field(default="", repr=False)

    @model_validator(mode="after")
    def editorial_origins(self):
        if self.content_critical_watermark > self.content_low_watermark:
            raise ValueError("content_critical_watermark cannot exceed content_low_watermark")
        if self.future_refill_urgent_daily_call_cap < self.future_refill_daily_call_cap:
            raise ValueError("future_refill_urgent_daily_call_cap cannot be below the normal cap")
        if self.future_refill_urgent_topic_daily_cap < self.future_refill_topic_daily_cap:
            raise ValueError("future_refill_urgent_topic_daily_cap cannot be below the normal cap")
        if not self.editorial_enabled:
            return self
        if not self.cors_origins:
            raise ValueError("Editorial access requires explicit dashboard origins")
        for origin in self.cors_origins:
            parts = urlsplit(origin)
            local = (
                parts.hostname in ("localhost", "127.0.0.1") and not self.is_production
            )
            if (
                "*" in origin
                or not parts.hostname
                or parts.username
                or parts.password
                or parts.path
                or parts.query
                or parts.fragment
                or (parts.scheme != "https" and not (local and parts.scheme == "http"))
            ):
                raise ValueError(
                    "Editorial access requires exact HTTPS origins (HTTP localhost in development only)"
                )
        return self

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
