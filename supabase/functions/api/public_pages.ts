/** Browser landing pages served alongside the Supabase learner API. */

type PageConfig = { supabaseUrl: string; anonKey: string };

const STYLE = `
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0f1115; color: #e8eaf0; font: 16px/1.6 system-ui, sans-serif; }
  main { width: 100%; max-width: 420px; padding: 2rem; box-sizing: border-box; }
  h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
  p, label { color: #aeb5c3; }
  form { display: grid; gap: .75rem; }
  label { display: block; font-size: .9rem; }
  input { width: 100%; box-sizing: border-box; padding: .75rem; border-radius: 10px;
    border: 1px solid #3d4658; background: #171a21; color: #e8eaf0; font: inherit; }
  input:focus { outline: 2px solid #8da5ff; }
  button { padding: .8rem; border: 0; border-radius: 10px; background: #8da5ff;
    color: #0f1115; font: inherit; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .error { color: #ffaaaa; } .success { color: #9cebb5; }
  .hidden { display: none; }
`;

const CONFIRMED = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>One Concept — email confirmation</title><style nonce="__NONCE__">${STYLE}</style></head>
<body><main><h1 id="heading">Check your email link</h1>
<p id="message">Open the confirmation link from your email to finish setting up your account.</p>
</main><script nonce="__NONCE__">
const hash = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);
const error = hash.get('error_description') || query.get('error_description') ||
  hash.get('error') || query.get('error');
if (hash.get('type') === 'recovery' && hash.get('access_token')) {
  const reset = new URL('reset-password', location.href);
  reset.hash = location.hash;
  location.replace(reset.toString());
} else {
  history.replaceState(null, '', location.pathname);
  if (error) {
    document.getElementById('heading').textContent = 'Confirmation did not finish';
    document.getElementById('message').textContent = error;
    document.getElementById('message').className = 'error';
  } else if (hash.get('access_token')) {
    document.getElementById('heading').textContent = 'Email confirmed ✓';
    document.getElementById('message').textContent =
      "You're all set. Open the One Concept app and sign in to get today's concept.";
  }
}
</script></body></html>`;

const RESET = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>One Concept — reset password</title><style nonce="__NONCE__">${STYLE}</style></head>
<body><main><h1>Reset your password</h1>
<p id="intro">Choose a new password for your One Concept account.</p>
<form id="form" class="hidden" method="post"><div><label for="pw">New password</label>
<input id="pw" type="password" autocomplete="new-password" minlength="6" required></div>
<div><label for="pw2">Confirm new password</label>
<input id="pw2" type="password" autocomplete="new-password" minlength="6" required></div>
<button id="submit" type="submit">Update password</button></form>
<p id="message" role="alert"></p></main><script nonce="__NONCE__">
const config = __CONFIG__;
const form = document.getElementById('form');
const intro = document.getElementById('intro');
const message = document.getElementById('message');
const submit = document.getElementById('submit');
const hash = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);
const token = hash.get('access_token');
const type = hash.get('type');
const linkError = hash.get('error_description') || query.get('error_description') ||
  hash.get('error') || query.get('error');
history.replaceState(null, '', location.pathname);
function hideForm() { form.classList.add('hidden'); intro.classList.add('hidden'); }
function fail(text) { message.textContent = text; message.className = 'error'; }
if (linkError) { hideForm(); fail(linkError); }
else if (!token || type !== 'recovery') {
  hideForm();
  fail('This reset link is invalid or has expired. Open One Concept and request a new link.');
} else form.classList.remove('hidden');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('pw').value;
  const confirmation = document.getElementById('pw2').value;
  if (password.length < 6) { fail('Passwords need to be at least 6 characters.'); return; }
  if (password !== confirmation) { fail('The two passwords do not match.'); return; }
  submit.disabled = true;
  message.textContent = '';
  try {
    const result = await fetch(config.url + '/auth/v1/user', {
      method: 'PUT', headers: { apikey: config.anonKey,
        Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!result.ok) {
      const body = await result.json().catch(() => ({}));
      throw new Error(body.msg || body.error_description ||
        'Could not reset your password. Request a new link from the app.');
    }
    hideForm();
    message.textContent = 'Password updated ✓ Open One Concept and sign in with your new password.';
    message.className = 'success';
  } catch (error) {
    submit.disabled = false;
    fail(error instanceof Error ? error.message : 'Could not reset your password.');
  }
});
</script></body></html>`;

// Keep this learner-facing disclosure aligned with backend/app/privacy.py.
const PRIVACY = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>One Concept — Privacy Policy</title><style nonce="__NONCE__">${STYLE}
body { display: block; } main { max-width: 760px; margin: auto; }
h2 { margin: 2rem 0 .5rem; } li { margin-bottom: .4rem; color: #aeb5c3; }
a { color: #b5c4ff; } strong { color: #e8eaf0; }
</style></head><body><main><h1>Privacy Policy</h1><p>Effective: October 1, 2026</p>
<p>One Concept is operated by Coding Moves. This policy explains the data used to provide the app and how to contact us about it.</p>
<h2>Information used to provide the app</h2><ul>
<li><strong>Account information:</strong> Supabase Auth handles your email address and authentication session. Your verified account identity separates your data from other users.</li>
<li><strong>Profile and learning information:</strong> We store your display name, timezone, followed topics, daily assignments, completed lessons and reviews, streaks, likes, saved concepts, and reminder preferences.</li>
<li><strong>Notification information:</strong> If you allow notifications, the app sends an Expo push token and device platform so it can deliver your chosen reminders.</li>
<li><strong>Device-local information:</strong> Encrypted authentication data and app caches may remain on your device for sign-in and offline viewing.</li></ul>
<h2>How we use information</h2><p>We use this information to sign you in, select and remember learning activities, calculate streaks, keep saved and liked content, and send enabled reminders. We do not use the app for advertising or include behavioural analytics or crash-reporting SDKs.</p>
<h2>Optional public profile</h2><p>Profile sharing is off by default. If enabled, anyone with your link or QR code sees only the display name, streaks, learned-concept count and achievements you select. Your email, saved concepts, account identifiers and private activity are excluded. Turning sharing off revokes the link, but cannot erase screenshots already made.</p>
<h2>Optional Connections</h2><p>Connections stores requests, accepted relationships and blocks for your private lists. Receiving requests is off by default. Other learners see only the profile information you currently share. You can decline, cancel, remove or block a connection. Turn off profile sharing to revoke a public link. Limited request-event timestamps enforce invitation limits.</p>
<h2>Service providers</h2><p>Supabase provides authentication, database and API infrastructure. Expo delivers enabled push notifications. These providers process the information needed to run the app.</p>
<h2>Choices and retention</h2><p>You can turn reminders off in the app. Signing out removes account-scoped app caches and attempts to deregister the current device while online. Account and learning data remain associated with your account until you request deletion or we no longer need them to run the service.</p>
<h2>Security</h2><p>Private requests use a verified account token, and access controls are designed to limit data to the signed-in account. No internet transmission or storage method is completely secure.</p>
<h2>Your requests and contact</h2><p>Request access to, correction of, or deletion of your account data by emailing <a href="mailto:contactmuawia@gmail.com">contactmuawia@gmail.com</a> from your account address. We may need to verify the request.</p>
<h2>Changes</h2><p>We may update this policy as data practices change. The current version is published at this address with its effective date.</p>
</main></body></html>`;

function configLiteral(config: PageConfig): string {
  return JSON.stringify({ url: config.supabaseUrl.replace(/\/+$/, ''), anonKey: config.anonKey })
    .replace(/[<>&\u2028\u2029]/g, character =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function publicPage(path: string, method: string, config: PageConfig, cors: Headers): Response | null {
  if (!['/confirmed', '/reset-password', '/privacy'].includes(path)) return null;
  if (method !== 'GET') {
    const headers = new Headers(cors);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('allow', 'GET');
    return new Response(JSON.stringify({ detail: 'Method Not Allowed' }), { status: 405, headers });
  }
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const template = path === '/confirmed' ? CONFIRMED : path === '/privacy' ? PRIVACY : RESET;
  const body = template.replaceAll('__NONCE__', nonce)
    .replace('__CONFIG__', () => configLiteral(config));
  const headers = new Headers(cors);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-frame-options', 'DENY');
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('content-security-policy', `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src ${config.supabaseUrl}`);
  return new Response(body, { status: 200, headers });
}
