-- Keep denormalized owner IDs provably aligned with their immutable parents.
-- This protects account boundaries even if a future service query regresses.
begin;

alter table public.user_subtopic_completions
  add constraint user_subtopic_completions_id_user_id_key unique (id, user_id);
alter table public.subtopic_quizzes
  add constraint subtopic_quizzes_completion_owner_fkey
  foreign key (subtopic_completion_id, user_id)
  references public.user_subtopic_completions(id, user_id) on delete restrict;
alter table public.subtopic_quizzes
  add constraint subtopic_quizzes_id_user_id_key unique (id, user_id);
alter table public.subtopic_quiz_attempts
  add constraint subtopic_quiz_attempts_quiz_owner_fkey
  foreign key (quiz_id, user_id)
  references public.subtopic_quizzes(id, user_id) on delete restrict;

commit;
