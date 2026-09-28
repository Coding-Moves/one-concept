-- Complete the taxonomy rollout begun in 0017. Existing plans are already
-- editorially scoped to one topic; Core Concepts is the safe reviewed home
-- until an editor deliberately refines a plan into a narrower subtopic.
begin;

update public.concept_backlog b
set subtopic_id = s.id
from public.subtopics s
where s.topic_id = b.topic_id
  and s.slug = 'core-concepts'
  and b.subtopic_id is null;

alter table public.concept_backlog
  alter column subtopic_id set not null;

commit;
