"""Public failure responses that never expose infrastructure details."""

import logging
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

logger = logging.getLogger(__name__)


def _response(status_code: int, code: str, incident: str, retry_after: str | None = None) -> JSONResponse:
    """Keep the mobile contract stable and deliberately free of exception text."""
    headers = {"Cache-Control": "no-store", "X-Incident-Id": incident}
    if retry_after:
        headers["Retry-After"] = retry_after
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "incident_id": incident}},
        headers=headers,
    )


async def database_unavailable(_: Request, error: SQLAlchemyError) -> JSONResponse:
    incident = uuid4().hex
    # Driver messages can include endpoint/user information. Keep only the
    # exception class and opaque incident id in logs and responses.
    logger.warning("database request failed type=%s incident=%s", type(error).__name__, incident)
    return _response(503, "service_unavailable", incident, retry_after="30")


async def unexpected_failure(_: Request, error: Exception) -> JSONResponse:
    incident = uuid4().hex
    # #161 owns production reporting. Do not log exception text here: generic
    # exceptions can carry request data, credentials, or provider payloads.
    logger.error("unhandled request failure type=%s incident=%s", type(error).__name__, incident)
    return _response(500, "internal_error", incident)
