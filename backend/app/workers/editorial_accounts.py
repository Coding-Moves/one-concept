"""One-time trusted owner bootstrap; never accepts or prints passwords/tokens."""

import argparse
import asyncio

from fastapi import HTTPException

from app.db.session import SessionLocal, engine
from app.services.editorial_accounts import bootstrap_owner


async def run(args):
    try:
        async with SessionLocal() as db, db.begin():
            await bootstrap_owner(db, args.email, args.name)
        print(
            "Owner membership created. Enroll and verify MFA before using editorial actions."
        )
    except HTTPException as exc:
        raise SystemExit(str(exc.detail)) from None
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True, help="Existing confirmed owner email")
    parser.add_argument("--name", required=True, help="Owner-approved attribution name")
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
