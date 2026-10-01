-- Preserve every existing timezone. Only new profiles may initialize from a phone.
begin;
alter table public.profiles add column timezone_initialized boolean not null default false;
update public.profiles set timezone_initialized = true;
commit;
