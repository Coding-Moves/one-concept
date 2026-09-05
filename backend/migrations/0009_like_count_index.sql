-- 0009_like_count_index.sql — fast public like counts.
--
-- A card now shows how many people liked it: count(*) over concept_interactions
-- with liked_at set, grouped by concept. The existing index is keyed by user
-- (for a user's own likes list); counting BY CONCEPT needs an index the other
-- way round. Partial on liked_at is not null so it only covers actual likes.

begin;

create index if not exists concept_interactions_like_count_idx
  on public.concept_interactions (concept_id)
  where liked_at is not null;

commit;
