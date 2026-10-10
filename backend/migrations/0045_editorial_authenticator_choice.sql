-- Each editorial account may choose whether its verified authenticator is required.
-- Existing and newly invited accounts retain the previous MFA requirement.
begin;

alter table public.editorial_memberships
  add column require_mfa boolean not null default true;

alter table public.editorial_account_events
  drop constraint editorial_account_events_action_check;
alter table public.editorial_account_events
  add constraint editorial_account_events_action_check check (action in (
    'bootstrap','invite','profile_requested','profile_approved','access_changed',
    'notification_policy','notification_timezone','notification_retry',
    'authenticator_choice'
  ));

commit;
