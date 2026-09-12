# One Concept email templates

These three templates customize emails sent by Supabase Auth. They work with
the project's configured sender; installing the HTML does not require Resend,
a purchased domain, or an app update. Provider setup remains separate in
[draft PR #187](https://github.com/Coding-Moves/one-concept/pull/187).

**Merging or releasing the app does not install these files in Supabase.**
Paste the templates into the dashboard to change future emails. The repository
stores their reviewed source; it does not synchronize production settings.

## Install

1. Open the correct Supabase project, then **Authentication → Emails → Templates**.
2. Open each template listed below and set its subject exactly as shown.
3. Replace the body with the entire raw HTML file, starting with `<!doctype html>`.
   Copy the file's source, not its rendered browser preview, and save.
4. Under **Security → Password changed**, also enable the notification and save.

| Supabase template | Subject | HTML source |
| --- | --- | --- |
| Confirm sign up | `Confirm your email — One Concept` | [confirm-signup.html](../backend/email-templates/confirm-signup.html) |
| Reset password | `Reset your password — One Concept` | [reset-password.html](../backend/email-templates/reset-password.html) |
| Password changed (Security) | `Your password was changed — One Concept` | [password-changed.html](../backend/email-templates/password-changed.html) |

Keep every `{{ .ConfirmationURL }}` placeholder in signup and recovery. Supabase
fills in the appropriate verification URL; the button and copyable fallback
must both pass through that verification. Password changed reports a completed
change and intentionally has no token or reset-link placeholder. It directs
unrecognized changes to Forgot password in the app and the existing support email.

Preserve the project's existing working redirect configuration. Signup uses the
configured Site URL for `/confirmed`; recovery requests `/reset-password` on the
app's API base URL. The corresponding HTTPS destinations must be allowed in
Supabase's URL Configuration. Do not replace verification links with those
landing-page URLs. See [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Sending and activation

Template customization and sending capacity are separate. Supabase's default
sender is for testing: it currently sends only to project-team addresses and
allows two emails per hour. Other recipients require custom SMTP, which can be
the owner's existing Gmail setup once configured and tested. These templates
do not remove sender limits or establish delivery. See
[Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp)
(checked 2026-09-12).

Before announcing the new emails to users, test with accounts and inboxes you
control under the configured sender's limits:

- Confirm signup, follow the email's button, and successfully sign in to the app.
- Request Forgot password, set a new password through the recovery email, and
  sign in with it. Verify the separate Password changed notification arrives.
- Check the design in a real inbox on phone and desktop, the full fallback links,
  and the Coding Moves organization and support destinations. Use a second inbox
  provider and a non-team recipient when custom SMTP is available.

Record the results before treating production activation as complete. Local
browser previews verify layout, not Gmail/Outlook rendering or live delivery.
No production settings or messages are changed by the template PR itself.

## Design

The dark masthead uses the owner's selected One Concept text branding and links
Coding Moves once to its GitHub organization. The app's current image assets are
Expo starter icons, so the emails do not use them as a logo. Inline styles,
presentation tables, system fonts, and text links need no external assets.
Subjects are separate dashboard fields; the HTML comments do not configure them.
