"""Apply the cutover to a real pre-0033 database containing learner progress."""

import uuid

import asyncpg

from tests.conftest import AUTH_STUB, MIGRATIONS


async def test_cutover_preserves_catalog_and_progress_without_inventing_reviews(
    database,
):
    dsn = database.replace("postgresql+asyncpg", "postgresql")
    name = "cutover_" + uuid.uuid4().hex
    admin = await asyncpg.connect(dsn)
    db = None
    try:
        await admin.execute(f'create database "{name}"')
        db = await asyncpg.connect(dsn.rsplit("/", 1)[0] + "/" + name)
        # Roles are cluster-wide and supplied by the main disposable fixture.
        await db.execute(AUTH_STUB.replace("create role authenticated;", ""))
        for migration in sorted(MIGRATIONS.glob("0*.sql")):
            if migration.name < "0033_editorial_provenance.sql":
                await db.execute(migration.read_text())
        cid = await db.fetchval(
            "select id from concepts where status='published' limit 1"
        )
        uid = uuid.uuid4()
        await db.execute(
            "insert into auth.users(id,email) values ($1,$2)",
            uid,
            f"{uid}@example.invalid",
        )
        await db.execute(
            """insert into daily_assignments(user_id,concept_id,assigned_for,completed_at)
            values ($1,$2,current_date,now())""",
            uid,
            cid,
        )
        await db.execute(
            """insert into concept_interactions(user_id,concept_id,saved_at)
            values ($1,$2,now())""",
            uid,
            cid,
        )
        # A historical operator name must not become a trusted badge at cutover.
        await db.execute(
            """insert into concept_revisions(concept_id,base_version,body,status,reviewed_by)
            values ($1,0,'{}','published','Historical CLI name')""",
            cid,
        )
        draft_id = await db.fetchval(
            """insert into concepts
            (topic_id,subtopic_id,slug,title,summary,example,status,content_version)
            select topic_id,subtopic_id,'private-cutover-draft',title,summary,example,'draft',0
            from concepts where id=$1 returning id""",
            cid,
        )
        before = await db.fetch(
            "select id,to_jsonb(c)::text as body from concepts c order by id"
        )
        progress = await db.fetchval(
            "select to_jsonb(a)::text from daily_assignments a where user_id=$1", uid
        )
        saved = await db.fetchval(
            "select to_jsonb(i)::text from concept_interactions i where user_id=$1", uid
        )
        published = await db.fetchval(
            "select count(*) from concepts where status='published'"
        )
        await db.execute((MIGRATIONS / "0033_editorial_provenance.sql").read_text())
        assert (
            await db.fetch(
                "select id,to_jsonb(c)::text as body from concepts c order by id"
            )
            == before
        )
        assert (
            await db.fetchval(
                "select to_jsonb(a)::text from daily_assignments a where user_id=$1",
                uid,
            )
            == progress
        )
        assert (
            await db.fetchval(
                "select to_jsonb(i)::text from concept_interactions i where user_id=$1",
                uid,
            )
            == saved
        )
        assert (
            await db.fetchval("select count(*) from editorial_legacy_versions")
            == published
        )
        assert not await db.fetchval(
            "select exists(select 1 from editorial_legacy_versions where concept_id=$1)",
            draft_id,
        )
        assert await db.fetchval("select count(*) from editorial_revision_events") == 0
        assert await db.fetchval("select count(*) from editorial_publications") == 0
        # Even privileged later imports do not extend the grandfather inventory.
        await db.execute(
            "update concepts set status='published',content_version=1 where id=$1",
            draft_id,
        )
        assert (
            await db.fetchval("select count(*) from editorial_legacy_versions")
            == published
        )
        assert not await db.fetchval(
            "select exists(select 1 from editorial_legacy_versions where concept_id=$1)",
            draft_id,
        )
    finally:
        if db is not None:
            await db.close()
        await admin.execute(f'drop database if exists "{name}" with (force)')
        await admin.close()
