-- Shared reservation ledger for every application Gemini generation path.
-- Calls are reserved before network I/O and never refunded after commit.
-- A new Pacific calendar day gets a new row; no reset job is needed.
begin;

create table public.generation_daily_usage (
  budget_day date primary key,
  calls_used integer not null default 0 check (calls_used >= 0)
);

-- Backend only. No policies means authenticated mobile users cannot access it,
-- even on installations whose default grants expose new public-schema tables.
alter table public.generation_daily_usage enable row level security;

commit;
