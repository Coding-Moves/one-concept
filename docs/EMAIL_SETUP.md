# Authentication email with Resend

This is the shared delivery and branding setup for [#152](https://github.com/Coding-Moves/one-concept/issues/152)
and [#171](https://github.com/Coding-Moves/one-concept/issues/171).
**Status: prepared for installation; production SMTP and inbox delivery are not verified.**
Keep the implementation PR in draft until the acceptance checks below pass.

The app already asks Supabase Auth to send signup and password-recovery emails.
Supabase owns verification tokens; Resend transports the messages through custom
SMTP. FastAPI serves the existing confirmation and password-reset pages. The
HTML files in this repository must be installed in Supabase; deploying or merging
them does not install them. Daily reminders remain push notifications.

## What the owner needs to do

The owner has set a **$0 budget, with no domain purchase**. Complete the numbered
steps below only using free services. If registration, identity verification,
or DNS requires payment, stop; no charge is authorized. Production activation
remains pending until the owner controls a suitable domain.
You do not need website hosting, a paid mailbox, or a Supabase custom API domain
to send these emails. A mailbox is needed separately only if you want to receive
replies at the sending address.

[Resend's free sending plan](https://resend.com/pricing) currently allows 3,000
emails per month, at most 100 per day (checked 2026-09-12). These are emails, not
users: signups, resets, and repeat requests all share the allowance. Stay on Free
and recheck its limits before a public launch. Domain ownership is a prerequisite
for [real-user delivery](https://resend.com/docs/dashboard/domains/introduction);
the testing sender is not a replacement for your own domain.

### 1. Obtain a free domain with DNS control and create the Resend account

One candidate is [.pp.ua through NIC.UA](https://nic.ua/en/domains/.pp.ua), which
currently lists free registration and renewal. Its
[DNS hosting is free for domains registered there](https://nic.ua/en/domains/nameservers).
This is a candidate, not a verified deployment: name availability, account
eligibility, activation, Resend acceptance, and inbox delivery still need checks.

Before choosing it, read these conditions: NIC.UA requires a linked payment card
for identification and phone/SMS or Telegram activation; .pp.ua registrant contact
data is public. The owner must decide whether those terms are acceptable and
complete registration directly. Do not register or publish contact information
on the owner's behalf. See [activation requirements](https://nic.ua/en/knowledge-base/how-to-activate-pp-ua-domain)
and [public registration data](https://nic.ua/en/knowledge-base/pp-ua-domains-restrictions).

If acceptable, search for an available project name such as `oneconcept.pp.ua`
(availability is not established), verify a zero order total, complete the
registrar's activation steps, and enable its free DNS service. Complete activation
within the registrar's stated window. Free domains still need timely renewal
and reactivation; record the expiry privately. An expired domain may require a
paid restoration, which is outside this budget.

Then create your account at [Resend](https://resend.com/signup) and select Free.
If the free domain cannot be activated or accepted by Resend, keep this setup
pending instead of buying an alternative or treating `onboarding@resend.dev` as
production. That [test sender only reaches your own Resend account address](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

The examples below use `example.com`. Replace it with your activated domain.
We will use **`auth.example.com`** as the sending domain and
**`noreply@auth.example.com`** as the sender. The `auth` subdomain does not require
a separate registration. It can coexist with a future website/API domain.

### 2. Verify the sending domain

In **Resend → Domains → Add domain**, enter `auth.example.com`.
In your registrar's DNS panel, copy the exact record type, name, value, and
priority that Resend provides for sending verification (DKIM and SPF/return-path
records). Values depend on the domain and region; do not copy somebody else's
DNS values. Some DNS panels append your root domain automatically, so check the
resulting full record name before saving.

Enable sending; receiving is not required. An MX record requested for the sending
return-path belongs at the exact name Resend specifies, not automatically at the
root of your domain. Wait until Resend marks sending **Verified**. Follow
[Resend's DMARC guide](https://resend.com/docs/dashboard/domains/dmarc) for the
sending domain as well; if a record already exists, edit it instead of adding
a second DMARC policy. An initial monitoring policy can be tightened after
verifying legitimate mail; use a report address only if you actually monitor it.

In that Resend domain's settings, leave **click tracking and open tracking off**.
Supabase verification links must reach Supabase unchanged. See
[Supabase's email tracking guidance](https://supabase.com/docs/guides/auth/auth-email-templates#email-tracking).

### 3. Create a dedicated sending key

In **Resend → API Keys**, create a key named `one-concept-supabase-auth` with
**Sending access**, limited to the verified sending domain. Copy it to your
password manager and use it only as the SMTP password in the next step. Resend
documents [sending-only, domain-scoped keys](https://resend.com/docs/dashboard/api-keys/introduction).

Do not put this key in a template, Git, a PR, the mobile app, or a chat message.
No new Railway or `EXPO_PUBLIC_*` environment variable is needed.

### 4. Configure Supabase custom SMTP

First open the **existing One Concept Supabase project**. Inspect whether custom
SMTP or a Send Email Auth Hook is already configured; record the non-secret
settings and save the current templates privately before changing anything.
An existing Send Email hook can handle delivery instead of SMTP; resolve which
delivery path is active before switching it.

Go to **Authentication → Email → SMTP Settings** (some dashboard versions group
this under Notifications). Enable custom SMTP and enter:

| Field | Value |
| --- | --- |
| Sender name | `One Concept — by Coding Moves` |
| Sender email | `noreply@auth.example.com` with your actual verified domain |
| SMTP host | `smtp.resend.com` |
| SMTP port | `465` (TLS) |
| SMTP username | `resend` |
| SMTP password | The dedicated Resend API key from step 3 |

Save. These values follow [Resend's Supabase SMTP guide](https://resend.com/docs/send-with-supabase-smtp).
Settings take effect in Supabase immediately; no APK or backend deployment is
required. Keep email confirmation enabled.

Under **Authentication → Rate Limits**, inspect the email-sending limit.
Supabase documents an initial custom-SMTP limit of **30 emails/hour**, which is
configurable. Keep that conservative starting value for initial testing; raising
it does not raise Resend's 100/day and 3,000/month limits. Custom SMTP removes
the built-in sender's restrictions, not all limits.
[Supabase SMTP limits](https://supabase.com/docs/guides/auth/auth-smtp).

### 5. Preserve the app's existing redirect URLs

Find the app's current `EXPO_PUBLIC_API_BASE_URL` in the EAS environment settings
or the existing deployment configuration. Call that HTTPS origin `API_BASE`
below, with no trailing slash. This is the current backend address, **not** the
new email-sending domain; setting up email does not move the backend.

In **Supabase → Authentication → URL Configuration**, verify:

| Setting | Expected value |
| --- | --- |
| Site URL | `API_BASE/confirmed` |
| Redirect URL allow list | Contains `API_BASE/confirmed` and `API_BASE/reset-password` |

Preserve other legitimate existing redirects. The signup call currently relies
on Site URL; `resetPasswordForEmail` explicitly requests `/reset-password`.
Keep the project's existing Supabase URL and anon/publishable key unchanged.
Do not replace the email action link with either landing-page URL: the user must
first pass through Supabase's token verification endpoint.

### 6. Install the two templates

In **Supabase → Authentication → Email → Templates**, open each matching template.
Set its subject below, then paste the **entire raw HTML file**, including its
`{{ .ConfirmationURL }}` placeholders, into the body and save.

| Supabase template | Subject | File |
| --- | --- | --- |
| Confirm sign up | `Confirm your email — One Concept` | [confirm-signup.html](../backend/email-templates/confirm-signup.html) |
| Reset password | `Reset your password — One Concept` | [reset-password.html](../backend/email-templates/reset-password.html) |

On GitHub, open the file and choose **Raw** to copy its source. Do not copy a
rendered browser preview or replace the placeholders manually. Both templates
use the same supported variable, but Supabase supplies the appropriate signup
or recovery verification URL for the selected template. Subjects are separate
dashboard fields; the HTML comments do not configure them.

The templates use inline styles, table layouts, system fonts, visible fallback
links, and a text wordmark. They require no external images or JavaScript.
They do not claim an expiry duration, which is controlled by Supabase settings.
The app has no magic-link sign-in button, so the optional magic-link template
from #171 is deferred; no new authentication method is enabled by this PR.
[Supabase template variables](https://supabase.com/docs/guides/auth/auth-email-templates#terminology).

### 7. Verify real delivery before completing either issue

Use addresses you control, including one outside your Supabase organization's
team. Never publish passwords, full verification URLs, tokens, SMTP keys, or
private recipient details as evidence. Record the time, provider, redacted
delivery status, and outcome in the PR's activation checklist.

- [ ] **Signup:** create a fresh test account in the installed app. Receive the
  branded confirmation email, inspect the sender and layout, use its button, and
  successfully sign in to the app. A `/confirmed` page alone is not proof that
  the account can sign in.
- [ ] **Password recovery:** for that account, use Forgot password in the app,
  receive the branded email, open `/reset-password` via its button, set a new
  password, then successfully sign in with the new password.
- [ ] **Used/expired recovery link:** confirm it does not permit another reset;
  request a fresh link and check that recovery still works.
- [ ] **Second inbox provider:** repeat delivery checks using another inbox
  provider you control (for example Gmail and Outlook). Check Spam/Junk too.
- [ ] **Authentication headers:** inspect a delivered email's headers for SPF,
  DKIM, and DMARC results; resolve failures before calling the setup complete.
- [ ] **Fallback link:** use a fresh email and copy its fallback URL into the
  browser; verify that it completes the same action as the button.
- [ ] **Provider evidence:** Resend logs show successful delivery for signup and
  recovery, and Supabase Auth logs show no SMTP failure. Provider acceptance
  alone does not prove inbox delivery or working links.

When these pass, record the actual results, mark the PR ready, and merge the
single PR that closes both #152 and #171. Do not close either as completed while
domain verification or real delivery is still pending.

## Operating and troubleshooting

Use **Resend → Emails/Logs** for delivery, bounce, suppression, and quota details;
use **Supabase → Logs → Auth** for request and SMTP errors. FastAPI does not send
these messages and cannot establish delivery from its own logs. Check remaining
Resend allowance before a signup campaign, and review failures after activation.

| Symptom | Check |
| --- | --- |
| Only team members receive mail | Correct Supabase project, custom SMTP saved, domain verified, Send Email hook status. |
| SMTP authentication/sender error | Dedicated key, sending-domain scope, exact From address, host and port. |
| Rate-limit error or missing messages | Both Supabase's hourly limit and Resend's daily/monthly allowance; use a new request after limits permit. |
| Email arrives, link fails | Tracking disabled, correct template slot, intact placeholder, existing backend redirects; request a fresh link. Some inbox scanners consume one-time links. |
| Reset page says it is unavailable | Existing backend `SUPABASE_ANON_KEY` and deployment configuration; see [RELEASING.md](../RELEASING.md). |
| Password reset gives no account-specific detail | Expected: the app deliberately avoids disclosing whether an account exists. |

If an installation breaks delivery, restore the saved template/settings for any
previously working custom provider. Reverting a Git commit does not restore
Supabase configuration. The built-in sender is restricted and is not a production
fallback. For a compromised/rotated Resend key, create a replacement scoped key,
update the SMTP password, test delivery, then revoke the old key.
