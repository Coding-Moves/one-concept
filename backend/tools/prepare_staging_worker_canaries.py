"""Seed four isolated staging worker canaries without logging private inputs.

This deliberately refuses an occupied queue or any active scheduler. Run once
from the protected staging environment before dispatching provider canaries.
"""

import json
import os
import re
import subprocess
import sys

try:
    from .apply_staging_migrations import DEMO_PROJECT_REF, connection_environment
except ImportError:
    from apply_staging_migrations import DEMO_PROJECT_REF, connection_environment


EMAIL = re.compile(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\Z")
TOKEN = re.compile(r"(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{8,160}\]\Z")


def literal(value: str) -> str:
    """Quote a private value as one PostgreSQL literal, including apostrophes."""
    if any(character in value for character in "\x00\r\n"):
        raise ValueError("invalid private input")
    return "'" + value.replace("'", "''") + "'"


def prepare_sql(learner: str, reviewer: str, owner: str, token: str) -> str:
    source_body = {
        "title": "Staging worker canary: transactions",
        "summary": "A transaction keeps related database changes together. When one change "
                   "fails, the database rolls every change back so its records remain consistent.",
        "example": "A shop records payment and stock together for an order, or undoes both.",
        "curriculum": {},
        "learning_package": {
            "flashcard": {"front": "What is a transaction?", "back": "Related changes together."},
            "mcqs": [
                {"question": f"What happens to transaction change {number} on failure?",
                 "options": ["It rolls back", "It stays", "It doubles", "It disappears"],
                 "correct_index": 0} for number in range(1, 4)
            ],
        },
    }
    return f"""begin;
do $canary$
declare
  v_learner uuid; v_reviewer uuid; v_owner uuid;
  v_topic uuid; v_subtopic uuid; v_subslug text;
  v_tz text; v_local timestamp; v_week date;
  v_quiz uuid; v_concept uuid; v_revision uuid;
  v_feedback uuid; v_event uuid; v_source text;
  v_body jsonb := {literal(json.dumps(source_body))}::jsonb;
begin
  if current_database() <> 'postgres' or
     (select count(*) from cron.job where jobname like 'one-concept-%' and active) <> 0 or
     (select count(*) from public.edge_worker_jobs where enabled) <> 0 or
     (select count(*) from public.device_tokens) <> 0 or
     (select count(*) from public.daily_reminder_outbox) <> 0 or
     (select count(*) from public.weekly_quiz_notifications) <> 0 or
     (select count(*) from public.editorial_notification_outbox o
       where o.batch_id is null and not o.suppressed and
         public.edge_worker_email_entry_eligible(o.id)) <> 0 or
     (select count(*) from public.editorial_email_batches where status in ('pending','sending')) <> 0 or
     (select count(*) from public.editorial_email_attempts
       where started_at>clock_timestamp()-interval '24 hours') <> 0 or
     (select count(*) from public.editorial_generation_jobs where status in ('pending','generating')) <> 0 or
     (select coalesce(sum(calls_used),0) from public.generation_daily_usage
       where budget_day=(clock_timestamp() at time zone 'America/Los_Angeles')::date) <> 0 then
    raise exception 'Canary staging queues must be idle and empty';
  end if;
  select id into v_learner from auth.users
    where lower(email)=lower({literal(learner)}) and email_confirmed_at is not null;
  select id into v_reviewer from auth.users
    where lower(email)=lower({literal(reviewer)}) and email_confirmed_at is not null;
  select id into v_owner from auth.users
    where lower(email)=lower({literal(owner)}) and email_confirmed_at is not null;
  if v_learner is null or v_reviewer is null or v_owner is null or
     v_learner=v_reviewer or v_reviewer=v_owner or v_learner=v_owner or
     not exists(select 1 from public.profiles where id=v_learner) or
     not exists(select 1 from public.editorial_memberships m
       where m.user_id=v_reviewer and m.status='active' and
         m.approved_name is not null and 'review'=any(m.capabilities) and
         lower(m.invited_email)=lower({literal(reviewer)})) or
     not exists(select 1 from public.editorial_memberships m
       where m.user_id=v_owner and m.status='active' and
         m.approved_name is not null and
         array['review','request_generation']::text[] <@ m.capabilities) then
    raise exception 'Staging learner, reviewer or owner is not ready';
  end if;
  select c.topic_id,c.subtopic_id,s.slug into v_topic,v_subtopic,v_subslug
    from public.concepts c join public.topics t on t.id=c.topic_id and t.is_active
    join public.subtopics s on s.id=c.subtopic_id and s.is_active
    where c.status='published' order by c.id limit 1;
  if v_topic is null then raise exception 'Staging catalog is missing'; end if;
  select tz into v_tz from (values ('UTC'),('Asia/Tokyo'),
      ('America/New_York'),('Pacific/Honolulu')) as zones(tz)
    where (clock_timestamp() at time zone tz)::time between time '10:00' and time '17:00'
    limit 1;
  if v_tz is null then raise exception 'No safe quiz delivery window'; end if;
  update public.profiles set timezone=v_tz where id=v_learner;
  v_local := clock_timestamp() at time zone v_tz;
  v_week := (clock_timestamp() at time zone 'UTC')::date -
    (extract(isodow from clock_timestamp() at time zone 'UTC')::integer-1);
  if exists(select 1 from public.daily_assignments where user_id=v_learner
       and assigned_for=v_local::date and completed_at is not null) or
     exists(select 1 from public.daily_reviews where user_id=v_learner
       and assigned_for=v_local::date and completed_at is not null) or
     exists(select 1 from public.weekly_quizzes where user_id=v_learner and week_start=v_week)
    then raise exception 'Staging learner has conflicting completed work';
  end if;
  insert into public.user_topics(user_id,topic_id) values(v_learner,v_topic)
    on conflict do nothing;
  insert into public.notification_preferences(user_id,enabled,weekly_quiz_enabled,reminder_times)
    values(v_learner,true,true,array[(v_local::time+interval '1 hour')::time])
    on conflict(user_id) do update set enabled=true,weekly_quiz_enabled=true,
      reminder_times=excluded.reminder_times;
  insert into public.device_tokens(user_id,expo_push_token,platform)
    values(v_learner,{literal(token)},'android');
  insert into public.daily_reminder_outbox(user_id,local_date,slot,expo_push_token)
    values(v_learner,v_local::date,v_local::time,{literal(token)});
  insert into public.weekly_quizzes(user_id,week_start,questions,notification_queued_at)
    values(v_learner,v_week,'[]'::jsonb,clock_timestamp()) returning id into v_quiz;
  insert into public.weekly_quiz_notifications(quiz_id,expo_push_token)
    values(v_quiz,{literal(token)});

  insert into public.concepts(topic_id,subtopic_id,slug,title,summary,status,curriculum)
    values(v_topic,v_subtopic,'staging-worker-email-'||substr(gen_random_uuid()::text,1,8),
      'Staging worker email canary','A private reviewer email test.','published','{{}}'::jsonb)
    returning id into v_concept;
  insert into public.concept_revisions(concept_id,base_version,body,status,assigned_to)
    values(v_concept,1,'{{}}'::jsonb,'draft',v_reviewer) returning id into v_revision;
  update public.editorial_notification_outbox set created_at=clock_timestamp()-interval '6 minutes'
    where revision_id=v_revision;

  insert into public.concepts(topic_id,subtopic_id,slug,title,summary,example,status,curriculum)
    values(v_topic,v_subtopic,'staging-worker-ai-'||substr(gen_random_uuid()::text,1,8),
      'Staging worker canary: transactions',v_body->>'summary',v_body->>'example',
      'published','{{}}'::jsonb) returning id into v_concept;
  v_body := v_body || jsonb_build_object('subtopic_slug',v_subslug);
  insert into public.concept_revisions(concept_id,base_version,body,status,assigned_to)
    values(v_concept,1,v_body,'changes_requested',v_owner) returning id into v_revision;
  insert into public.editorial_revision_events(revision_id,concept_id,base_version,
    actor_id,registered_name,action,revision_body,source_snapshot,note)
    select v_revision,v_concept,1,v_owner,'Staging Owner','changes_requested',
      v_body,to_jsonb(c)-array['created_at','published_at','status'],
      'Clarify the failed payment example before approval.'
      from public.concepts c where c.id=v_concept returning id into v_feedback;
  insert into public.editorial_workflow_events(revision_id,concept_id,topic_id,
    actor_id,registered_name,action,note,details)
    values(v_revision,v_concept,v_topic,v_owner,'Staging Owner','generation_requested',
      'Please correct the example for this private review.',
      jsonb_build_object('kind','revision','feedback_event_id',v_feedback))
    returning id into v_event;
  select encode(pg_catalog.sha256(convert_to(
      public.edge_api_editorial_python_json(jsonb_build_object(
        'revision',public.edge_api_editorial_revision_token(v_revision),
        'siblings',(select coalesce(jsonb_agg(r.id order by r.id),'[]'::jsonb)
          from public.concept_revisions r where r.concept_id=v_concept))),
      'UTF8')),'hex') into v_source;
  insert into public.editorial_generation_jobs(source_revision_id,concept_id,topic_id,
    feedback_event_id,request_event_id,requested_by,source_token,source_body,feedback,available_at)
    values(v_revision,v_concept,v_topic,v_feedback,v_event,v_owner,v_source,v_body,
      'Clarify the failed payment example before approval.',clock_timestamp());
end
$canary$;
commit;"""


def main() -> int:
    staging = os.environ.get("STAGING_PROJECT_REF", "")
    production = os.environ.get("PRODUCTION_PROJECT_REF", "")
    learner = os.environ.get("STAGING_CANARY_LEARNER_EMAIL", "").strip()
    reviewer = os.environ.get("STAGING_CANARY_REVIEWER_EMAIL", "").strip()
    owner = os.environ.get("STAGING_CANARY_OWNER_EMAIL", "").strip()
    token = os.environ.get("STAGING_CANARY_PUSH_TOKEN", "").strip()
    if staging != DEMO_PROJECT_REF or staging == production:
        print("Canary staging target is invalid", file=sys.stderr)
        return 2
    invalid = [name for name, value in (
        ("learner email", learner), ("reviewer email", reviewer),
        ("owner email", owner)
    ) if not EMAIL.fullmatch(value)]
    if not TOKEN.fullmatch(token):
        invalid.append("Expo push token")
    if invalid:
        print("Invalid canary inputs: " + ", ".join(invalid), file=sys.stderr)
        if "Expo push token" in invalid:
            print("Token must contain only ExpoPushToken[...] or "
                  "ExponentPushToken[...] with no header, quotes or spaces",
                  file=sys.stderr)
        return 2
    try:
        env = connection_environment(staging, production, os.environ["STAGING_DIRECT_URL"])
        sql = prepare_sql(learner, reviewer, owner, token)
    except (KeyError, ValueError):
        print("Canary staging connection or fixture input is invalid", file=sys.stderr)
        return 2
    result = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"],
                            input=sql, env=env, text=True, capture_output=True,
                            timeout=30, check=False)
    if result.returncode:
        print("Canary fixture setup failed; transaction rolled back", file=sys.stderr)
        return 1
    print("Staging canary fixtures seeded for one phone, one inbox and one AI draft")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
