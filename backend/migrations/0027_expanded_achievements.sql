-- Achievement definitions are a durable, data-driven catalog. Awards are always
-- derived from accepted server records; this migration credits qualifying history.
begin;

alter table public.achievement_definitions
  add column category text not null default 'consistency'
    check (category in ('consistency', 'learning', 'review', 'quiz', 'path')),
  add column requirement jsonb not null default '{}'::jsonb
    check (jsonb_typeof(requirement) = 'object'),
  add column show_progress boolean not null default true;

alter table public.user_achievements
  drop constraint if exists user_achievements_source_check;
alter table public.user_achievements
  add constraint user_achievements_source_check
    check (source in ('history', 'completion', 'review', 'quiz', 'subtopic'));

update public.achievement_definitions
   set category = 'consistency', requirement = '{"event":"learning_day"}'::jsonb
 where metric = 'consecutive_days';

insert into public.achievement_definitions
  (code,metric,threshold,name,description,artwork_key,sort_order,category,requirement)
values
  ('concept_1','completed_concepts',1,'First concept','Your first completed concept is the start of a lasting library.','candle',20,'learning','{"event":"concept_completion"}'),
  ('concept_5','completed_concepts',5,'Curious mind','Five concepts completed and ready to connect.','spark',21,'learning','{"event":"concept_completion"}'),
  ('concept_10','completed_concepts',10,'Knowledge builder','Ten concepts made part of your learning journey.','star',22,'learning','{"event":"concept_completion"}'),
  ('concept_25','completed_concepts',25,'Quarter century','Twenty-five concepts completed with intention.','compass',23,'learning','{"event":"concept_completion"}'),
  ('concept_50','completed_concepts',50,'Half-century learner','Fifty concepts completed, one idea at a time.','emblem',24,'learning','{"event":"concept_completion"}'),
  ('concept_100','completed_concepts',100,'Century of ideas','One hundred concepts completed and kept.','universe',25,'learning','{"event":"concept_completion"}'),
  ('review_1','completed_reviews',1,'First revisit','Your first review strengthened a learned idea.','candle',30,'review','{"event":"review_completion"}'),
  ('review_5','completed_reviews',5,'Memory maker','Five reviews completed to keep ideas active.','spark',31,'review','{"event":"review_completion"}'),
  ('review_10','completed_reviews',10,'Recall rhythm','Ten reviews completed with care.','star',32,'review','{"event":"review_completion"}'),
  ('review_25','completed_reviews',25,'Practice pays','Twenty-five reviews completed.','compass',33,'review','{"event":"review_completion"}'),
  ('review_50','completed_reviews',50,'Reliable recall','Fifty reviews completed.','emblem',34,'review','{"event":"review_completion"}'),
  ('review_100','completed_reviews',100,'Review master','One hundred reviews completed.','universe',35,'review','{"event":"review_completion"}'),
  ('quiz_1','weekly_quizzes_completed',1,'Weekly challenger','Completed your first weekly quiz.','candle',40,'quiz','{"event":"weekly_quiz_completion"}'),
  ('quiz_5','weekly_quizzes_completed',5,'Quiz regular','Completed five distinct weekly quizzes.','spark',41,'quiz','{"event":"weekly_quiz_completion"}'),
  ('quiz_10','weekly_quizzes_completed',10,'Quiz explorer','Completed ten distinct weekly quizzes.','star',42,'quiz','{"event":"weekly_quiz_completion"}'),
  ('quiz_25','weekly_quizzes_completed',25,'Quiz scholar','Completed twenty-five distinct weekly quizzes.','emblem',43,'quiz','{"event":"weekly_quiz_completion"}'),
  ('quiz_50','weekly_quizzes_completed',50,'Quiz legacy','Completed fifty distinct weekly quizzes.','universe',44,'quiz','{"event":"weekly_quiz_completion"}'),
  ('perfect_quiz_1','weekly_perfect_scores',1,'Perfect recall','Earned a perfect score on a weekly quiz.','sun',45,'quiz','{"event":"weekly_quiz_perfect_score"}'),
  ('perfect_quiz_5','weekly_perfect_scores',5,'Perfect practice','Earned perfect scores on five distinct weekly quizzes.','planet',46,'quiz','{"event":"weekly_quiz_perfect_score"}'),
  ('subtopic_1','completed_subtopics',1,'First path','Completed your first learning path.','candle',50,'path','{"event":"subtopic_completion"}'),
  ('subtopic_5','completed_subtopics',5,'Path finder','Completed five distinct learning paths.','compass',51,'path','{"event":"subtopic_completion"}'),
  ('subtopic_10','completed_subtopics',10,'Path maker','Completed ten distinct learning paths.','emblem',52,'path','{"event":"subtopic_completion"}'),
  ('subtopic_25','completed_subtopics',25,'Path keeper','Completed twenty-five distinct learning paths.','universe',53,'path','{"event":"subtopic_completion"}')
on conflict (code) do nothing;

-- The first qualifying record sets the earned date. Replays collide on the
-- composite key, retaining an existing acknowledgement and historical date.
with days as (
  select user_id, assigned_for as d from public.daily_assignments where completed_at is not null
  union
  select user_id, assigned_for from public.daily_reviews where completed_at is not null
), streak_islands as (
  select user_id, d, d - (row_number() over (partition by user_id order by d))::int as grp from days
), streak_facts as (
  select user_id, d as earned_on, row_number() over (partition by user_id, grp order by d)::int as threshold
  from streak_islands
), concept_facts as (
  select user_id, completed_at::date as earned_on,
         row_number() over (partition by user_id order by completed_at, concept_id)::int as threshold
  from public.user_concept_completions
), review_facts as (
  select user_id, completed_at::date as earned_on,
         row_number() over (partition by user_id order by completed_at, id)::int as threshold
  from public.daily_reviews where completed_at is not null
), quiz_events as (
  select a.user_id, a.quiz_id, min(a.attempted_at) as occurred_at
  from public.weekly_quiz_attempts a group by a.user_id, a.quiz_id
), quiz_facts as (
  select user_id, occurred_at::date as earned_on,
         row_number() over (partition by user_id order by occurred_at, quiz_id)::int as threshold
  from quiz_events
), perfect_events as (
  select a.user_id, a.quiz_id, min(a.attempted_at) as occurred_at
  from public.weekly_quiz_attempts a
  join public.weekly_quizzes q on q.id=a.quiz_id and q.user_id=a.user_id
  where a.correct_count = jsonb_array_length(q.questions)
  group by a.user_id, a.quiz_id
), perfect_facts as (
  select user_id, occurred_at::date as earned_on,
         row_number() over (partition by user_id order by occurred_at, quiz_id)::int as threshold
  from perfect_events
), subtopic_events as (
  select user_id, subtopic_id, min(completed_at) as occurred_at
  from public.user_subtopic_completions group by user_id, subtopic_id
), subtopic_facts as (
  select user_id, occurred_at::date as earned_on,
         row_number() over (partition by user_id order by occurred_at, subtopic_id)::int as threshold
  from subtopic_events
), facts as (
  select user_id, 'consecutive_days'::text as metric, threshold, earned_on from streak_facts
  union all select user_id, 'completed_concepts', threshold, earned_on from concept_facts
  union all select user_id, 'completed_reviews', threshold, earned_on from review_facts
  union all select user_id, 'weekly_quizzes_completed', threshold, earned_on from quiz_facts
  union all select user_id, 'weekly_perfect_scores', threshold, earned_on from perfect_facts
  union all select user_id, 'completed_subtopics', threshold, earned_on from subtopic_facts
)
insert into public.user_achievements(user_id, achievement_code, earned_on, source)
select f.user_id, d.code, f.earned_on, 'history'
from facts f
join public.achievement_definitions d on d.metric=f.metric and d.threshold=f.threshold
on conflict (user_id, achievement_code) do nothing;

commit;
