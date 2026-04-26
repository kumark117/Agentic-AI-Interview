import asyncio
import logging
import os
from contextlib import asynccontextmanager
from contextlib import suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.routes import router as v1_router
from app.core.config import settings
from app.db.base import engine, init_db_schema
from app.services.cleanup_worker import cleanup_inactive_sessions
from app.services.redis_client import redis_client

# Render (and some dashboards) serve the FE on *.onrender.com. Regex is checked in addition to
# AI_INTERVIEW_CORS_ORIGINS so preflight still passes if the explicit list is mis-copied.
_CORS_ONRENDER_REGEX = r"^https://[^/]+\.onrender\.com$"


def _log_cors_at_startup() -> None:
    """Stdout + WARNING: Render often hides or truncates uvicorn INFO lines."""
    msg = (
        f"ai-interview CORS allow_origins={settings.cors_origins_list!r} "
        f"allow_origin_regex={_CORS_ONRENDER_REGEX!r}"
    )
    print(msg, flush=True)
    logging.getLogger("uvicorn.error").warning("%s", msg)


@asynccontextmanager
async def lifespan(_: FastAPI):
    _log_cors_at_startup()
    if settings.effective_auto_create_schema:
        await init_db_schema()

    disable_cleanup = settings.effective_disable_cleanup_worker or os.getenv("AI_DISABLE_CLEANUP_WORKER", "0") == "1"
    cleanup_task: asyncio.Task | None = None
    if not disable_cleanup:
        cleanup_task = asyncio.create_task(cleanup_inactive_sessions())

    try:
        yield
    finally:
        if cleanup_task is not None:
            cleanup_task.cancel()
            with suppress(asyncio.CancelledError):
                await cleanup_task
        await redis_client.aclose()
        await engine.dispose()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=_CORS_ONRENDER_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(v1_router, prefix=settings.api_prefix)
