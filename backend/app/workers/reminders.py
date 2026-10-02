"""Run with: python -m app.workers.reminders

Scheduled on Railway every 15 minutes. Nudges users whose reminder time just
passed in their own timezone and who have not finished today's concept.
"""

import asyncio
import logging

from app.config import get_settings
from app.services.weekly_quiz_notifications import send_weekly_quiz_notifications
from app.db.session import SessionLocal, engine
from app.services.reminders import send_due_reminders
from app.services.editorial_notifications import run as notify_reviewers


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    async with SessionLocal() as session:
        result = await send_due_reminders(session, window_minutes=15)

    logging.info("sent %s, dropped %s stale tokens", result.sent, result.dropped_tokens)
    if get_settings().weekly_quiz_notifications_enabled:
        async with SessionLocal() as session:
            weekly = await send_weekly_quiz_notifications(session)
        logging.info("weekly quiz: accepted %s, dropped %s stale tokens", weekly.sent, weekly.dropped_tokens)
    # Same scheduled process; no additional paid scheduler or service.
    async with SessionLocal() as session:
        result = await notify_reviewers(session, get_settings())
    logging.info("editorial email: status=%s processed=%s", result["status"], result["processed"])
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
