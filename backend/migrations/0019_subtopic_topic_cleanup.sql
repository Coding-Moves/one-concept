-- A topic with no dependent learner/content records may be deleted by a
-- maintenance or disposable-test cleanup. Its private taxonomy must not leave
-- an orphaned foreign-key blocker. Concepts and backlog still reference both
-- the topic and subtopic, so populated topics remain protected.
begin;

alter table public.subtopics
  drop constraint subtopics_topic_id_fkey,
  add constraint subtopics_topic_id_fkey
    foreign key (topic_id) references public.topics(id) on delete cascade;

commit;
