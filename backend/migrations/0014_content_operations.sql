begin;
create table public.content_worker_runs (
  worker text primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null,
  generated integer not null default 0,
  failed integer not null default 0
);
alter table public.content_worker_runs enable row level security;
create table public.content_conditions (
  key text primary key,
  active boolean not null,
  changed_at timestamptz not null default now(),
  observed_at timestamptz not null default now()
);
alter table public.content_conditions enable row level security;
commit;
