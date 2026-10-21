"""Use disposable PostgreSQL stubs to test the signed pg_net handoff."""

import hashlib
import hmac

import pytest
from sqlalchemy import text


STUBS = (
    "create schema if not exists extensions",
    "create extension if not exists pgcrypto with schema extensions",
    "create schema vault",
    "create table vault.decrypted_secrets(name text primary key, decrypted_secret text not null)",
    "create schema net",
    """create table net.request_queue(
  id bigint generated always as identity primary key,
  url text not null, headers jsonb not null, body jsonb not null
)""",
    """create table net._http_response(
  id bigint, status_code integer, timed_out boolean, error_msg text
)""",
    """create function net.http_post(
  url text, body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type":"application/json"}'::jsonb,
  timeout_milliseconds integer default 2000
) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into net.request_queue(url,headers,body)
    values (url,headers,body) returning id into v_id;
  return v_id;
end $$""",
)


@pytest.mark.asyncio
async def test_dispatch_is_signed_one_use_and_http_result_is_distinct_from_work(session):
    for statement in STUBS:
        await session.execute(text(statement))
    key = "test-worker-secret-with-at-least-thirty-two-characters"
    url = "https://zhrulokgngjceqgjkcmw.supabase.co/functions/v1/worker"
    await session.execute(text("""insert into vault.decrypted_secrets(name,decrypted_secret)
      values ('one_concept_worker_url',:url),
        ('one_concept_worker_signing_key',:key)"""), {"url": url, "key": key})
    await session.execute(text("update public.edge_worker_jobs set enabled=true where name in ('prefetch','editorial_email')"))

    request_id = await session.scalar(text("select public.edge_worker_dispatch('editorial_email')"))
    assert request_id is not None
    assert await session.scalar(text("select public.edge_worker_dispatch('editorial_email')")) is None
    queued = (await session.execute(text("select url,headers,body from net.request_queue where id=:id"),
                                    {"id": request_id})).one()
    assert queued.url == url
    assert queued.headers == {"Content-Type": "application/json"}
    body = queued.body
    message = f"v1\n{body['run_id']}\n{body['job']}\n{body['issued_at']}".encode()
    assert body["signature"] == hmac.new(key.encode(), message, hashlib.sha256).hexdigest()
    assert "service" not in str(queued.headers).lower()
    assert key not in str(body)

    await session.execute(text("insert into net._http_response(id,status_code) values (:id,200)"),
                          {"id": request_id})
    assert await session.scalar(text("select public.edge_worker_poll_http()")) == 1
    row = (await session.execute(text("""select status,http_status,http_checked_at
      from public.edge_worker_runs where request_id=:id"""), {"id": request_id})).one()
    assert row.status == "queued"  # HTTP success is not task completion.
    assert row.http_status == 200 and row.http_checked_at is not None

    failed_id = await session.scalar(text("select public.edge_worker_dispatch('prefetch')"))
    await session.execute(text("insert into net._http_response(id,status_code) values (:id,503)"),
                          {"id": failed_id})
    assert await session.scalar(text("select public.edge_worker_poll_http()")) == 1
    assert await session.scalar(text("select status from public.edge_worker_runs where request_id=:id"),
                                {"id": failed_id}) == "failed"
    await session.execute(text("update public.edge_worker_jobs set enabled=false where name in ('prefetch','editorial_email')"))
    await session.execute(text("delete from public.edge_worker_runs where job in ('prefetch','editorial_email')"))
    await session.commit()
