-- Keep the private bio hidden from public profiles unless its owner selects it.
begin;

alter table public.profile_sharing
  add column show_bio boolean not null default false;

commit;
