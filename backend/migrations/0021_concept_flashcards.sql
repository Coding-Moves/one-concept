-- A reviewed recall prompt belongs to the published lesson version. Legacy
-- lessons remain null until an editor approves a real flashcard for them.
begin;

alter table public.concepts add column flashcard jsonb;

commit;
