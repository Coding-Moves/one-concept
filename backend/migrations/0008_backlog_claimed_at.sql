-- 0008_backlog_claimed_at.sql — reclaim stranded generation.
--
-- A worker claims a backlog row by setting status='generating' before the
-- (multi-second) Gemini call. If it is killed mid-call the row is stuck there
-- forever: _CLAIM only ever picks 'pending', so the title is silently lost from
-- the pool (issue #37). Record when the claim happened so a later run can tell a
-- genuinely in-flight claim from an abandoned one and reclaim the stale ones.

begin;

alter table public.concept_backlog
  add column if not exists claimed_at timestamptz;

commit;
