"""Read-only owner aggregates. No emails, notes, lesson bodies or raw logs."""

from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import text


PENDING = """r.status in ('draft','pending_review','changes_requested','validation_failed','approved')
 and r.base_version=c.content_version and c.status<>'archived'"""
LEARNERS = """learners as (
 select p.id,p.created_at from profiles p where p.created_at<:stop and (
 not exists(select 1 from editorial_memberships m where m.user_id=p.id)
 or exists(select 1 from user_concept_completions x where x.user_id=p.id and x.completed_at<:stop)
 or exists(select 1 from daily_reviews x where x.user_id=p.id and x.completed_at<:stop)))"""


def window(start: date | None, end: date | None):
    now = datetime.now(timezone.utc)
    end = end or now.date()
    if end < date(1, 1, 30):
        raise HTTPException(422, "End date must allow a 30-day activity window")
    start = start or end - timedelta(days=29)
    if end > now.date() or start > end or (end - start).days > 89:
        raise HTTPException(
            422,
            "Choose an ordered UTC range of at most 90 days, ending no later than today",
        )
    stop = min(datetime.combine(end + timedelta(days=1), time.min, timezone.utc), now)
    return {
        "start": datetime.combine(start, time.min, timezone.utc),
        "stop": stop,
        "end": end,
        "observed_at": now,
    }


async def rows(db, sql, params=None):
    return [dict(r) for r in (await db.execute(text(sql), params or {})).mappings()]


async def overview(db, period):
    params = {
        **period,
        "month": datetime.combine(
            period["end"] - timedelta(days=29), time.min, timezone.utc
        ),
        "week": datetime.combine(
            period["end"] - timedelta(days=6), time.min, timezone.utc
        ),
        "day": datetime.combine(period["end"], time.min, timezone.utc),
    }
    metrics = (
        await rows(
            db,
            f"""with {LEARNERS}, activity as (
      select user_id,completed_at,'lesson' as kind from user_concept_completions
       where completed_at>=least(cast(:start as timestamptz),cast(:month as timestamptz)) and completed_at<:stop
      union all select user_id,completed_at,'review' from daily_reviews
       where completed_at>=least(cast(:start as timestamptz),cast(:month as timestamptz)) and completed_at<:stop
    ), valid as (select a.* from activity a join learners l on l.id=a.user_id)
    select (select count(*) from learners) as registered,
      (select count(*) from learners where created_at>=:start) as new_registrations,
      count(distinct user_id) filter(where completed_at>=:day) as active_day,
      count(distinct user_id) filter(where completed_at>=:week) as active_week,
      count(distinct user_id) filter(where completed_at>=:month) as active_month,
      count(*) filter(where kind='lesson' and completed_at>=:start) as lessons,
      count(*) filter(where kind='review' and completed_at>=:start) as reviews
    from valid""",
            params,
        )
    )[0]
    trends = await rows(
        db,
        f"""with {LEARNERS}, activity as (
      select user_id,completed_at,'lesson' as kind from user_concept_completions where completed_at>=:start and completed_at<:stop
      union all select user_id,completed_at,'review' from daily_reviews where completed_at>=:start and completed_at<:stop
    ), daily as (select (completed_at at time zone 'UTC')::date as day,
       count(*) filter(where kind='lesson') as lessons,count(*) filter(where kind='review') as reviews,
       count(distinct user_id) as active from activity join learners on learners.id=activity.user_id group by 1)
    select d::date as day,coalesce(lessons,0) as lessons,coalesce(reviews,0) as reviews,coalesce(active,0) as active
    from generate_series(cast(:start as timestamptz),cast(:end as date)::timestamp at time zone 'UTC',interval '1 day') d
    left join daily on daily.day=d::date order by d""",
        params,
    )
    team = (
        await rows(
            db,
            """select
      count(*) filter(where status='active' and approved_name is null) as invited,
      count(*) filter(where status='active' and approved_name is not null) as active,
      count(*) filter(where status='revoked') as revoked from editorial_memberships""",
        )
    )[0]
    queue = (
        await rows(
            db,
            f"""select count(*) as pending,
      count(*) filter(where assigned_to is not null) as assigned,
      count(*) filter(where review_due_at<statement_timestamp()) as overdue
      from concept_revisions r join concepts c on c.id=r.concept_id where {PENDING}""",
        )
    )[0]
    return {**period, "metrics": metrics, "trend": trends, "team": team, "queue": queue}


async def reviewers(db, period, cursor, limit):
    params = {**period, "cursor": cursor, "limit": limit + 1}
    items = await rows(
        db,
        f"""with identities as (
      select user_id as id from editorial_memberships
      union select actor_id from editorial_revision_events where created_at>=:start and created_at<:stop
      union select e.actor_id from editorial_publications p join editorial_revision_events e on e.id=p.approval_id
        where p.recorded_at>=:start and p.recorded_at<:stop
    ), page as (select id from identities where (cast(:cursor as uuid) is null or id>cast(:cursor as uuid)) order by id limit :limit),
    evidence as (select e.* from editorial_revision_events e join page on page.id=e.actor_id
      where e.created_at>=:start and e.created_at<:stop),
    counts as (select actor_id,
      count(*) filter(where action in ('approved','attested')) as approval_events,
      count(distinct concept_id) filter(where action in ('approved','attested')) as approved_concepts,
      count(*) filter(where action='rejected') as rejections,
      count(*) filter(where action='changes_requested') as changes_requested from evidence group by actor_id),
    published as (select e.actor_id,count(distinct p.concept_id) as published_concepts
      from editorial_publications p join editorial_revision_events e on e.id=p.approval_id join page on page.id=e.actor_id
      where p.recorded_at>=:start and p.recorded_at<:stop group by e.actor_id),
    work as (select assigned_to,count(*) as pending,count(*) filter(where review_due_at<statement_timestamp()) as overdue
      from concept_revisions r join concepts c on c.id=r.concept_id join page on page.id=r.assigned_to
      where {PENDING} group by assigned_to)
    select page.id,coalesce(signature.registered_name,m.approved_name,'Name pending') as name,
      signature.created_at as signature_at,coalesce(m.status,'deleted') as status,
      coalesce(approval_events,0) as approval_events,coalesce(approved_concepts,0) as approved_concepts,
      coalesce(published_concepts,0) as published_concepts,coalesce(rejections,0) as rejections,
      coalesce(changes_requested,0) as changes_requested,coalesce(pending,0) as pending,coalesce(overdue,0) as overdue
    from page left join editorial_memberships m on m.user_id=page.id
    left join counts on counts.actor_id=page.id left join published on published.actor_id=page.id
    left join work on work.assigned_to=page.id
    left join lateral (select registered_name,created_at from editorial_revision_events e where actor_id=page.id and created_at<:stop
      order by created_at desc,id desc limit 1) signature on true order by page.id""",
        params,
    )
    return {
        "items": items[:limit],
        "next_cursor": items[limit - 1]["id"] if len(items) > limit else None,
        "observed_at": period["observed_at"],
    }


async def operations(db, settings):
    now = datetime.now(timezone.utc)
    workers = []
    for service, stale_minutes in (("reminders", 45), ("pool_topup", 2160)):
        event = await rows(
            db,
            """select observed_at,code,correlation_id from owner_operation_events
          where service=:service and observed_at>=now()-interval '30 days' order by observed_at desc,id desc limit 1""",
            {"service": service},
        )
        event = event[0] if event else None
        status = "unavailable"
        # API and worker processes can have different environment switches.
        # A recorded observation remains evidence until its freshness expires.
        if event:
            age = (now - event["observed_at"]).total_seconds() / 60
            status = (
                "stale"
                if age > (30 if event["code"] == "started" else stale_minutes)
                else event["code"]
            )
        workers.append(
            {
                "service": service,
                "status": status,
                "observation": event,
                "stale_after_minutes": stale_minutes,
            }
        )
    budget = await db.scalar(
        text("""select coalesce((select calls_used from generation_daily_usage
      where budget_day=(statement_timestamp() at time zone 'America/Los_Angeles')::date),0)""")
    )
    jobs = (
        await rows(
            db,
            """select count(*) filter(where status='pending') as pending,
      count(*) filter(where status='generating') as generating,count(*) filter(where status='failed') as failed,
      count(*) filter(where status='generating' and claimed_at<now()-interval '30 minutes') as stale
      from editorial_generation_jobs""",
        )
    )[0]
    emails = (
        await rows(
            db,
            """select count(*) filter(where status='pending') as pending,
      count(*) filter(where status='sending') as sending,count(*) filter(where status='failed') as failed,
      count(*) filter(where status='sent' and sent_at>=now()-interval '24 hours') as sent_last_day from editorial_email_batches""",
        )
    )[0]
    return {
        "observed_at": now,
        "environment": settings.environment,
        "api": "reachable",
        "database": "reachable",
        "telemetry_enabled": settings.owner_telemetry_enabled,
        "generation_enabled": settings.generation_enabled,
        "email_enabled": settings.editorial_email_enabled,
        "workers": workers,
        "revision_jobs": jobs,
        "emails": emails,
        "budget": {
            "reserved_calls": budget,
            "configured_cap": settings.generation_daily_call_cap,
            "timezone": "America/Los_Angeles",
        },
        "unavailable": [
            "Host CPU and memory",
            "Provider delivery/inbox logs",
            "Historical uptime and request latency",
        ],
    }


async def events(db, period, source, severity, search, correlation, cursor, limit):
    before_time = before_key = None
    if cursor:
        try:
            stamp, before_key = cursor.split("~", 1)
            before_time = datetime.fromisoformat(stamp)
            if before_time.tzinfo is None or len(before_key) > 80:
                raise ValueError
        except ValueError:
            raise HTTPException(422, "Invalid event cursor") from None
    params = {
        **period,
        "source": source,
        "severity": severity,
        "search": search,
        "correlation": correlation,
        "before_time": before_time,
        "before_key": before_key,
        "limit": limit + 1,
    }
    # Only allowlisted columns: no note/details/body/error text ever enters this result.
    items = await rows(
        db,
        """with events as (
      select 'operation:'||id::text as key,observed_at,service as source,code as action,severity,correlation_id from owner_operation_events
        where observed_at>=:start and observed_at<:stop and observed_at>=now()-interval '30 days'
      union all select 'review:'||id::text,created_at,'review',action,
        case when action='validation_failed' then 'error' else 'info' end,id from editorial_revision_events where created_at>=:start and created_at<:stop
      union all select 'workflow:'||id::text,created_at,'workflow',action,'info',id from editorial_workflow_events where created_at>=:start and created_at<:stop
      union all select 'account:'||id::text,created_at,'account',action,'info',null::uuid from editorial_account_events where created_at>=:start and created_at<:stop
    ) select * from events where (cast(:source as text) is null or source=:source)
      and (cast(:severity as text) is null or severity=:severity)
      and (cast(:correlation as uuid) is null or correlation_id=:correlation)
      and (cast(:search as text) is null or strpos(lower(source||' '||action),lower(:search))>0)
      and (cast(:before_time as timestamptz) is null or (observed_at,key)<(:before_time,:before_key))
      order by observed_at desc,key desc limit :limit""",
        params,
    )
    last = items[limit - 1] if len(items) > limit else None
    return {
        "items": items[:limit],
        "next_cursor": f"{last['observed_at'].isoformat()}~{last['key']}"
        if last
        else None,
        "observed_at": period["observed_at"],
    }
