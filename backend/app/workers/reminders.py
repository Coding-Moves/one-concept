"""Run with: python -m app.workers.reminders

Scheduled every 15 minutes. Nudges users whose reminder time just
passed in their own timezone and who have not finished today's concept.
"""

import asyncio
import logging

from app.db.session import SessionLocal, engine
from app.services.reminders import send_due_reminders


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    try:
        async with SessionLocal() as session:
            result = await send_due_reminders(session, window_minutes=15)
        logging.info("sent %s, dropped %s stale tokens, failed %s", result.sent, result.dropped_tokens, result.failed)
        if result.failed:
            raise SystemExit(1)  # Visible to the supervisor; do not retry claimed slots.
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
