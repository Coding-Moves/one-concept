# One Concept email templates

These four templates customize the Auth messages used by current product flows.
They work with the project's configured sender when that Supabase project is
eligible for template customization; installing the HTML does not require an
app update. Provider setup remains separate in
[draft PR #187](https://github.com/Coding-Moves/one-concept/pull/187).

**Merging or releasing the app does not install these files in Supabase.**
Paste the templates into the dashboard to change future emails. The repository
stores their reviewed source; it does not synchronize production settings.

## Install

1. Open the correct Supabase project, then **Authentication → Emails → Templates**.
   Confirm the project allows customization before changing a template. New
   free-tier projects created on or after June 3, 2026 cannot customize Auth
   templates with Supabase's default mail provider; an eligible older project,
   custom SMTP, or a paid plan is needed. Do not assume staging and production
   have the same eligibility.
2. Open each template listed below and set its subject exactly as shown.
3. Replace the body with the entire raw HTML file, starting with `<!doctype html>`.
   Copy the file's source, not its rendered browser preview, and save.
4. Under **Security → Password changed**, also enable the notification and save.

| Supabase template | Subject | HTML source |
| --- | --- | --- |
| Confirm sign up | `Confirm your email — One Concept` | [confirm-signup.html](../backend/email-templates/confirm-signup.html) |
| Invite user | `You're invited to One Concept Review` | [invite-reviewer.html](../backend/email-templates/invite-reviewer.html) |
| Reset password | `Reset your password — One Concept` | [reset-password.html](../backend/email-templates/reset-password.html) |
| Password changed (Security) | `Your password was changed — One Concept` | [password-changed.html](../backend/email-templates/password-changed.html) |

The [app icon](../mobile/assets/icon.png) is the source for the public
`/one-concept-icon.png` asset. Each HTML template loads it from the public
review site while retaining a text wordmark when an email client blocks images.
Deploy that asset before installing the templates. The image is public and
contains no personal data or authentication token.
The **Coding Moves** text in the byline links to the
[Coding Moves products page](https://codingmoves.netlify.app/products/) in
these four Auth templates and both editorial email HTML sources. The brand link
is separate from each email's account or review action link.

## Trigger and destination inventory

This table records source-controlled flows. Whether a dashboard-only template
or security notification is enabled must be checked separately in each
Supabase project; repository code cannot read that setting.

| Trigger | Source | Auth template or sender | Return destination |
| --- | --- | --- | --- |
| Mobile signup | `mobile/src/context/AuthContext.tsx` | Confirm sign up | Matching Supabase Edge `/confirmed` |
| Public web signup and resend | `admin/src/publicAccount.tsx` | Confirm sign up | Review-site `/account/callback` |
| Mobile forgot password | `mobile/src/context/AuthContext.tsx` | Reset password | Matching Supabase Edge `/reset-password` |
| Public web forgot password | `admin/src/publicAccount.tsx` | Reset password | Review-site `/account/callback` |
| Reviewer forgot password | `admin/src/Auth.tsx` | Reset password | Review-site `/auth/callback` |
| Owner reviewer invitation | `supabase/functions/api/handler.ts` | Invite user | Review-site `/auth/callback`; membership requires the guarded owner flow |
| Password update | Supabase Auth | Password changed security notification, only if enabled in Auth settings | Informational message; no link token |
| Editorial assignment/digest | `supabase/functions/worker` | Separate Gmail sender and editorial template | Private review workspace after normal sign-in |

The retained FastAPI source also has reviewer invitation and editorial Gmail
code for historical parity. The production Railway services were removed, so
those paths are not live senders. The Supabase Edge API and worker are the
current production senders.

There is no product call to Magic Link/OTP, Change Email, or Reauthentication.
Their dashboard templates may retain defaults while these flows are inactive.
Check all Auth templates and security notifications in staging and production
before marking the inventory complete; do not enable an untested sender or
flow just because a template exists. Push reminders do not use these emails.

At release, record for each Supabase project: the Auth sender name/address,
custom SMTP status and recipient limits, Confirm sign up / Invite user / Reset
password template bodies and subjects, Password changed notification status,
the Magic Link/OTP / Change Email / Reauthentication template status, Site URL,
and exact redirect allowlist. Use only a test inbox you control for live sends.
No migration in this PR changes Auth dashboard settings.

Keep every `{{ .ConfirmationURL }}` placeholder in signup, invitation, and recovery. Supabase
fills in the appropriate verification URL; the button and copyable fallback
must both pass through that verification. Password changed reports a completed
change and intentionally has no token or reset-link placeholder. It directs
unrecognized changes to Forgot password in the app and the existing support email.

Mobile signup and recovery request landing pages on the build's configured API
origin. The public web account requests `/account/callback` for both flows.
The Site URL remains the fallback for earlier app versions, and all three
HTTPS destinations must be allowed in Supabase's URL Configuration.
Reviewer invitations instead request the exact
`https://coding-moves-one-concept-review.netlify.app/auth/callback` URL from the
server. Add it to the allowed Redirect URLs and set the API's
`EDITORIAL_INVITE_REDIRECT_URL` to that value. The invitation template does not
use Supabase's `{{ .SiteURL }}`, which is why its visible copy no longer says
`localhost:3000`. Keep the Supabase Site URL on the working public learner
fallback described in [AUTH_REDIRECTS.md](AUTH_REDIRECTS.md); a template cannot
repair a missing allowed redirect. Use **Reviewers → Invite reviewer** in the
review website; manually sending a Supabase Dashboard invitation does not grant
editorial membership.
Do not replace verification links with those landing-page URLs. Follow the
[authentication redirect runbook](AUTH_REDIRECTS.md) before testing the emails.
See [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Sending and activation

Template customization and sending capacity are separate. Supabase's default
sender is for testing: it currently sends only to project-team addresses and
allows two emails per hour. Other recipients require custom SMTP. These
templates do not remove sender limits or establish delivery. Check both the
[June 2026 template restriction](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)
and [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp)
(checked 2026-10-29) before activating either project.

Before announcing the new emails to users, test with accounts and inboxes you
control under the configured sender's limits:

- Confirm signup, follow the email's button, and successfully sign in to the app.
- Invite a new reviewer through the review website, follow the email button to
  the public callback, set a password, and sign in. Invite an existing confirmed
  learner separately and verify that their existing password opens the workspace
  after their reviewer name is approved.
- Request Forgot password, set a new password through the recovery email, and
  sign in with it. Verify the separate Password changed notification arrives.
- Check the design in a real inbox on phone and desktop, the full fallback links,
  and the Coding Moves organization and support destinations. Use a second inbox
  provider and a non-team recipient when custom SMTP is available.

Record the results before treating production activation as complete. Local
browser previews verify layout, not Gmail/Outlook rendering or live delivery.
No production settings or messages are changed by the template PR itself.

## Design

The dark masthead uses the shipped One Concept app icon and a text wordmark;
the icon is an optional remote image and the wordmark remains legible when
images are disabled. Inline styles, presentation tables, system fonts, and text
links keep the message readable in basic email clients.
Subjects are separate dashboard fields; the HTML comments do not configure them.

The four Auth templates share a 560px table container, a `#171923` masthead,
white content, a `#F8FAFC` footer, `#F3F5FA` outer background, `#526078` body
text, `#64748B` secondary text, and `#E2E8F0` borders. The action emails use
the existing indigo `#4F46E5` for their links and buttons. The unmodified
48px app icon sits beside the text wordmark; its public copy must be deployed
before these Dashboard templates are installed. The final browser previews
use synthetic URLs only and do not prove rendering in any particular inbox.
