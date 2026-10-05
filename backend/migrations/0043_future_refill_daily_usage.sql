-- Future curated-card refill has its own Pacific-day allowance. Editorial
-- corrections and legacy enrichment must never consume these reserves.
begin;

create table public.future_refill_daily_usage (
  budget_day date primary key,
  calls_used integer not null default 0 check (calls_used >= 0)
);

create table public.future_refill_topic_daily_usage (
  budget_day date not null,
  topic_id uuid not null references public.topics(id) on delete cascade,
  calls_used integer not null default 0 check (calls_used >= 0),
  primary key (budget_day, topic_id)
);

alter table public.future_refill_daily_usage enable row level security;
alter table public.future_refill_topic_daily_usage enable row level security;
revoke all on public.future_refill_daily_usage, public.future_refill_topic_daily_usage
  from public, authenticated;

commit;
