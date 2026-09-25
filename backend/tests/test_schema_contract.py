import json
import os

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.schema import CONTRACT_PATH, migration_hashes, snapshot, verify_schema


async def test_migrations_produce_reviewed_schema_contract(database):
    engine = create_async_engine(database)
    try:
        async with engine.begin() as connection:
            # This fixture only ever constructs a disposable container. It has
            # no URL override that could accidentally baseline a production DB.
            if os.environ.get("UPDATE_SCHEMA_CONTRACT") == "1":
                CONTRACT_PATH.parent.mkdir(exist_ok=True)
                CONTRACT_PATH.write_text(json.dumps({
                    "migrations": migration_hashes(), "schema": await snapshot(connection),
                }, indent=2, sort_keys=True) + "\n")
            assert await verify_schema(connection) == []
    finally:
        await engine.dispose()


@pytest.mark.parametrize("damage, expected", [
    ("alter table public.concept_backlog drop column claimed_at", "columns: concept_backlog.claimed_at"),
    ("drop table public.content_conditions", "tables: content_conditions"),
    ("alter table public.daily_assignments drop constraint daily_assignments_no_repeat", "constraints: daily_assignments.daily_assignments_no_repeat"),
    ("alter table public.concept_revisions disable row level security", "tables: concept_revisions"),
    ("create policy leaked_drafts on public.concept_revisions for select using (true)", "Unexpected policy:"),
    ("alter table auth.users disable trigger on_auth_user_created", "triggers: auth.users.on_auth_user_created"),
])
async def test_false_ledger_cannot_hide_missing_or_unsafe_schema(database, damage, expected):
    # applied.txt remains unchanged and fully populated in every case.
    engine = create_async_engine(database)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(text(damage))
                errors = await verify_schema(connection)
                assert any(expected in error for error in errors), errors
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


async def test_verification_works_in_read_only_transaction(database):
    engine = create_async_engine(database)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("set transaction read only"))
            assert await verify_schema(connection) == []
    finally:
        await engine.dispose()
