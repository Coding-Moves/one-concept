-- 0002_rls.sql — Row Level Security.
--
-- IMPORTANT: the FastAPI backend connects with the service role, which bypasses
-- every policy below. RLS is the second lock, not the first: it protects data if
-- the app ever talks to Supabase directly, and it turns a forgotten
-- `where user_id = ...` in future direct-client code into an empty result set
-- instead of a leak. Backend authorization stays mandatory regardless.
--
-- Absence of a policy means denial, so anything not granted here is
-- service-role-only by construction.

begin;

alter table public.profiles                 enable row level security;
alter table public.topics                   enable row level security;
alter table public.concepts                 enable row level security;
alter table public.user_topics              enable row level security;
alter table public.daily_assignments        enable row level security;
alter table public.concept_interactions     enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.device_tokens            enable row level security;

-- ------------------------------------------------- reference data (read-only)
create policy topics_select_active
  on public.topics for select to authenticated
  using (is_active);

create policy concepts_select_published
  on public.concepts for select to authenticated
  using (status = 'published');

-- ------------------------------------------------- profiles
-- Insert is handled by the on_auth_user_created trigger, so no insert policy.
create policy profiles_select_own
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy profiles_update_own
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ------------------------------------------------- followed topics
create policy user_topics_select_own
  on public.user_topics for select to authenticated
  using (auth.uid() = user_id);

create policy user_topics_insert_own
  on public.user_topics for insert to authenticated
  with check (auth.uid() = user_id);

create policy user_topics_delete_own
  on public.user_topics for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------- assignments
-- Read-only to clients. Creating an assignment runs the selection algorithm and
-- completing one needs a trusted clock, so both stay server-side.
create policy daily_assignments_select_own
  on public.daily_assignments for select to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------- likes / saves
create policy concept_interactions_select_own
  on public.concept_interactions for select to authenticated
  using (auth.uid() = user_id);

create policy concept_interactions_insert_own
  on public.concept_interactions for insert to authenticated
  with check (auth.uid() = user_id);

create policy concept_interactions_update_own
  on public.concept_interactions for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy concept_interactions_delete_own
  on public.concept_interactions for delete to authenticated
  using (auth.uid() = user_id);

-- ------------------------------------------------- notification preferences
create policy notification_preferences_select_own
  on public.notification_preferences for select to authenticated
  using (auth.uid() = user_id);

create policy notification_preferences_update_own
  on public.notification_preferences for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------- device tokens
create policy device_tokens_select_own
  on public.device_tokens for select to authenticated
  using (auth.uid() = user_id);

create policy device_tokens_insert_own
  on public.device_tokens for insert to authenticated
  with check (auth.uid() = user_id);

create policy device_tokens_update_own
  on public.device_tokens for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy device_tokens_delete_own
  on public.device_tokens for delete to authenticated
  using (auth.uid() = user_id);

commit;
