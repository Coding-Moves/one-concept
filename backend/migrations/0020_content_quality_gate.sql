-- An immutable quality checklist belongs to each approved revision, never to a
-- mutable operator profile. RLS already keeps editorial records backend-only.
begin;
alter table public.concept_revisions add column quality_review jsonb;
commit;
