import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.health import router as health_router
from app.api.v1.pages import router as pages_router
from app.api.v1.router import api_router
from app.config import get_settings
from app.core.security import JwksCache
from app.db.session import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # One cache for the whole process: keys are shared, refreshed on rotation.
    app.state.jwks = JwksCache(settings.supabase_jwks_url)
    logging.getLogger("uvicorn").info(
        "One Concept API starting (environment=%s, transaction_pooler=%s)",
        settings.environment,
        settings.uses_transaction_pooler,
    )
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="One Concept API",
        version="0.2.0",
        description="Serves the daily concept. Owns the Gemini key and every database write.",
        lifespan=lifespan,
        # Keep the schema browsable in development, closed in production. Disable
        # openapi_url alongside docs_url: with /docs off but /openapi.json still
        # served, the full schema (every route, parameter, and model) stays
        # public in production, which defeats the point of closing the docs.
        docs_url=None if settings.is_production else "/docs",
        openapi_url=None if settings.is_production else "/openapi.json",
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(pages_router)
    app.include_router(api_router)
    return app


app = create_app()
