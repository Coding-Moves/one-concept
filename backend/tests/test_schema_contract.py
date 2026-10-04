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
            # The disposable fixture adds these helpers after applying the
            # migrations. They must not become production requirements.
            schema = await snapshot(connection)
            for name in (
                "public.concept_backlog.test_assign_backlog_subtopic",
                "public.concepts.test_assign_concept_subtopic",
            ):
                assert schema["triggers"].pop(name, None) is not None
            expected = {"migrations": migration_hashes(), "schema": schema}
            # This fixture only ever constructs a disposable container. It has
            # no URL override that could accidentally baseline a production DB.
            if os.environ.get("UPDATE_SCHEMA_CONTRACT") == "1":
                CONTRACT_PATH.parent.mkdir(exist_ok=True)
                CONTRACT_PATH.write_text(json.dumps(expected, indent=2, sort_keys=True) + "\n")
            assert json.loads(CONTRACT_PATH.read_text()) == expected
            assert await verify_schema(connection) == []
    finally:
        await engine.dispose()


@pytest.mark.parametrize("damage, expected", [
    ("alter table public.editorial_notification_outbox disable row level security", "tables: editorial_notification_outbox"),
    ("alter table public.editorial_generation_jobs disable row level security", "tables: editorial_generation_jobs"),
    ("alter table public.editorial_memberships disable row level security", "tables: editorial_memberships"),
    ("create policy leaked_editorial_accounts on public.editorial_memberships for select using (true)", "Unexpected policy:"),
    ("alter table public.concept_backlog drop column claimed_at", "columns: concept_backlog.claimed_at"),
    ("alter table public.connections disable row level security", "tables: connections"),
    ("create policy leaked_connections on public.connections for select using (true)", "Unexpected policy:"),
    ("alter table public.profile_connections disable row level security", "tables: profile_connections"),
    ("create policy leaked_profile_connections on public.profile_connections for select using (true)", "Unexpected policy:"),
    ("alter table public.profile_sharing disable row level security", "tables: profile_sharing"),
    ("create policy leaked_profiles on public.profile_sharing for select using (true)", "Unexpected policy:"),
    ("drop table public.content_conditions", "tables: content_conditions"),
    ("drop table public.user_achievements", "tables: user_achievements"),
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
