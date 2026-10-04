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

-- This bucket is private. The authenticated API normalizes and writes avatars
-- with its service credential; mobile clients never receive that credential.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 262144,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
commit;
