"""Auth-reading Edge RPCs keep Auth tables private from the service role."""

import uuid

from sqlalchemy import text


async def test_auth_read_rpcs_work_without_granting_auth_table_access(session, user):
    assert not (await session.execute(text("select has_table_privilege('service_role', 'auth.users', 'SELECT')"))).scalar_one()
    assert not (await session.execute(text("select has_table_privilege('service_role', 'auth.sessions', 'SELECT')"))).scalar_one()

    # Supabase grants public application-table access to service_role. The
    # disposable PostgreSQL fixture starts with no such grants, so reproduce
    # them here while keeping the Auth schema restricted.
    await session.execute(text("grant usage on schema public to service_role"))
    await session.execute(text("grant all on all tables in schema public to service_role"))
    await session.execute(text("grant usage on all sequences in schema public to service_role"))
    await session.execute(text("set local role service_role"))
    calls = (
        ("select public.edge_api_daily(:id, 10, 60, 90, null)", {"id": user}),
        ("select public.edge_api_achievements(:id)", {"id": user}),
        ("select public.edge_api_weekly_quiz(:id)", {"id": user}),
        ("select public.edge_api_subtopic_quiz(:id, :completion)",
         {"id": user, "completion": uuid.uuid4()}),
        ("select public.edge_api_editorial_me(:id, :session, 'aal1')",
         {"id": user, "session": uuid.uuid4()}),
        ("select public.edge_api_state(:id, true, true, 10, 60, 90, null)", {"id": user}),
    )
    for sql, params in calls:
        await session.execute(text(sql), params)


async def test_auth_read_rpcs_are_not_callable_by_client_roles(session):
    for signature in (
        "public.edge_api_daily(uuid,integer,integer,integer,date)",
        "public.edge_api_achievements(uuid)",
        "public.edge_api_weekly_quiz(uuid)",
        "public.edge_api_subtopic_quiz(uuid,uuid)",
        "public.edge_api_editorial_me(uuid,uuid,text)",
    ):
        for role in ("anon", "authenticated"):
            assert not (await session.execute(text("select has_function_privilege(:role, :signature, 'EXECUTE')"),
                {"role": role, "signature": signature})).scalar_one()
        assert (await session.execute(text("select has_function_privilege('service_role', :signature, 'EXECUTE')"),
            {"signature": signature})).scalar_one()
        assert (await session.execute(text("""select prosecdef and proconfig @> array['search_path=""']::text[]
            from pg_proc where oid = to_regprocedure(:signature)"""),
            {"signature": signature})).scalar_one()
