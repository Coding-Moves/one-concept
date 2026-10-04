-- Private learner profile enhancements. Existing `avatar_url` remains the sole
-- avatar reference: it stores either a vetted `preset:<name>` value or a
-- service-owned private Storage object key, never a public URL or device path.
begin;

alter table public.profiles
  add column if not exists bio text;

alter table public.profiles
  add constraint profiles_bio_one_line
  check (bio is null or (char_length(bio) between 1 and 160 and bio !~ E'[\\n\\r\\t]'));

alter table public.profile_sharing
  add column if not exists show_avatar boolean not null default false;

-- The private `profile-avatars` Storage bucket is created through Supabase's
-- Storage dashboard during rollout; see docs/PROFILE_AVATARS.md. It is not a
-- PostgreSQL relation and therefore cannot be managed by this migration suite.
commit;
