-- 0023 backfilled the per-concept ledger. Existing learners who had already
-- finished an entire subtopic also need the corresponding historical event so
-- Profile reports the correct state without replaying an old celebration.
begin;

with catalog as (
  select s.id as subtopic_id,
         array_agg(c.id order by c.id) as ids,
         count(*)::int as available
    from public.topics t
    join public.subtopics s on s.topic_id=t.id and s.is_active
    join public.concepts c on c.subtopic_id=s.id and c.status='published'
   where t.is_active
   group by s.id
), covered as (
  select done.user_id,catalog.*,max(done.completed_at) as completed_at,
         count(done.concept_id)::int as completed
    from catalog
    join public.user_concept_completions done on done.concept_id=any(catalog.ids)
   group by done.user_id,catalog.subtopic_id,catalog.ids,catalog.available
)
insert into public.user_subtopic_completions
  (user_id,subtopic_id,catalog_signature,catalog_concept_ids,completed_at,seen_at)
select user_id,subtopic_id,
       md5(array_to_string(ids, ',')) ||
         md5('one-concept-subtopic-v1:' || array_to_string(ids, ',')),
       ids,completed_at,now()
  from covered
 where completed=available
on conflict (user_id,subtopic_id,catalog_signature) do nothing;

commit;
