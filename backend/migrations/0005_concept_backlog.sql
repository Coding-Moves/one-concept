-- 0005_concept_backlog.sql — the curated syllabus.
--
-- Gemini writes lessons; it does not choose subjects. Titles are curated ahead
-- of time so deduplication is trivial (a unique slug), quality stays under our
-- control, and generation can run as a background batch instead of on the
-- request path.

begin;

create table public.concept_backlog (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid        not null references public.topics (id) on delete cascade,
  slug        text        not null unique,
  title       text        not null,
  -- Optional steer for the generator when a title alone is ambiguous.
  angle       text,
  difficulty  smallint    check (difficulty between 1 and 3),
  status      text        not null default 'pending'
                          check (status in ('pending', 'generating', 'done', 'failed')),
  attempts    smallint    not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger concept_backlog_touch_updated_at
  before update on public.concept_backlog
  for each row execute function public.touch_updated_at();

-- The worker's hot query: next pending item for a topic, oldest first.
create index concept_backlog_pending_idx
  on public.concept_backlog (topic_id, created_at)
  where status = 'pending';

alter table public.concept_backlog enable row level security;
-- No client policies: the backlog is operational data, service-role only.

commit;
