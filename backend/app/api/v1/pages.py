"""Tiny human-facing pages.

Supabase sends the post-verification redirect wherever its Site URL points.
The app is native, so there is no web app to land on — this page closes the
loop with a clear instruction instead of a dead localhost tab.
"""

import json

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.config import get_settings

router = APIRouter(tags=["pages"])

_CONFIRMED = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>One Concept — email confirmed</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           background: #0f1115; color: #e8eaf0;
           font: 18px/1.6 system-ui, sans-serif; }
    main { text-align: center; padding: 2rem; }
    h1 { font-size: 1.6rem; margin-bottom: 0.5rem; }
    p { color: #9aa1b0; }
  </style>
</head>
<body>
  <main>
    <h1>Email confirmed ✓</h1>
    <p>You're all set. Open the <strong>One Concept</strong> app on your
       phone and sign in to get today's concept.</p>
  </main>
</body>
</html>"""


@router.get("/confirmed", response_class=HTMLResponse, include_in_schema=False)
async def confirmed() -> str:
    return _CONFIRMED


# The password-recovery link Supabase emails lands here (its Site URL / the
# redirectTo the app passes). Supabase verifies the token and appends the
# recovery session to the URL *fragment* (#access_token=...&type=recovery),
# which the browser never sends to us — so the token stays client-side. The
# page reads it and calls Supabase's auth REST endpoint directly to set the new
# password; the anon key it needs is public (already in the app bundle).
_RESET_PASSWORD = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>One Concept — reset password</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           background: #0f1115; color: #e8eaf0;
           font: 16px/1.6 system-ui, sans-serif; }
    main { width: 100%; max-width: 360px; padding: 2rem; box-sizing: border-box;
           text-align: center; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
    p { color: #9aa1b0; margin: 0 0 1.25rem; }
    form { display: grid; gap: 0.75rem; text-align: left; }
    label { font-size: 0.85rem; color: #9aa1b0; }
    input { width: 100%; box-sizing: border-box; padding: 0.7rem 0.8rem;
            border-radius: 10px; border: 1px solid #2a2f3a; background: #171a21;
            color: #e8eaf0; font-size: 1rem; }
    input:focus { outline: none; border-color: #6c8cff; }
    button { margin-top: 0.5rem; padding: 0.8rem; border: 0; border-radius: 10px;
             background: #6c8cff; color: #0f1115; font-size: 1rem; font-weight: 700;
             cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: default; }
    .msg { margin-top: 1rem; font-size: 0.9rem; }
    .err { color: #ff8c8c; }
    .ok { color: #7ee0a2; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <main>
    <h1>Reset your password</h1>
    <p id="intro">Choose a new password for your One Concept account.</p>

    <form id="form">
      <div>
        <label for="pw">New password</label>
        <input id="pw" type="password" autocomplete="new-password"
               minlength="6" required>
      </div>
      <div>
        <label for="pw2">Confirm new password</label>
        <input id="pw2" type="password" autocomplete="new-password"
               minlength="6" required>
      </div>
      <button id="submit" type="submit">Update password</button>
    </form>

    <p id="msg" class="msg"></p>
  </main>

  <script>
    var CFG = __CONFIG__;
    var form = document.getElementById('form');
    var intro = document.getElementById('intro');
    var msg = document.getElementById('msg');
    var submit = document.getElementById('submit');

    function fail(text) {
      msg.textContent = text;
      msg.className = 'msg err';
    }
    function disableForm() {
      form.classList.add('hidden');
      intro.classList.add('hidden');
    }

    // Recovery session arrives in the URL fragment (implicit flow).
    var params = new URLSearchParams(location.hash.slice(1));
    var accessToken = params.get('access_token');
    var type = params.get('type');
    var linkError = params.get('error_description');

    if (linkError) {
      disableForm();
      fail(linkError.replace(/\\+/g, ' '));
    } else if (!accessToken || type !== 'recovery') {
      disableForm();
      fail('This reset link is invalid or has expired. Open the One Concept app and request a new link.');
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var pw = document.getElementById('pw').value;
      var pw2 = document.getElementById('pw2').value;
      if (pw.length < 6) { fail('Passwords need to be at least 6 characters.'); return; }
      if (pw !== pw2) { fail('The two passwords do not match.'); return; }

      submit.disabled = true;
      msg.textContent = '';
      msg.className = 'msg';
      try {
        var res = await fetch(CFG.url + '/auth/v1/user', {
          method: 'PUT',
          headers: {
            'apikey': CFG.anonKey,
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ password: pw })
        });
        if (!res.ok) {
          var body = await res.json().catch(function () { return {}; });
          throw new Error(body.msg || body.error_description ||
            'Could not reset your password. The link may have expired — request a new one from the app.');
        }
        // Drop the token from the URL/history now that it's spent.
        history.replaceState(null, '', location.pathname);
        disableForm();
        msg.textContent = 'Password updated ✓ Open the One Concept app and sign in with your new password.';
        msg.className = 'msg ok';
      } catch (err) {
        submit.disabled = false;
        fail(err.message);
      }
    });
  </script>
</body>
</html>"""


_RESET_UNCONFIGURED = _CONFIRMED.replace(
    "<title>One Concept — email confirmed</title>",
    "<title>One Concept — reset password</title>",
).replace(
    "<h1>Email confirmed ✓</h1>",
    "<h1>Reset unavailable</h1>",
).replace(
    "<p>You're all set. Open the <strong>One Concept</strong> app on your\n"
    "       phone and sign in to get today's concept.</p>",
    "<p>Password reset isn't configured on the server yet. "
    "Please try again later.</p>",
)


@router.get("/reset-password", response_class=HTMLResponse, include_in_schema=False)
async def reset_password() -> str:
    settings = get_settings()
    if not settings.supabase_anon_key:
        # No public key configured — the page can't call Supabase, so fail
        # clearly instead of rendering a form that silently can't submit.
        return _RESET_UNCONFIGURED
    config = json.dumps(
        {"url": settings.supabase_url.rstrip("/"), "anonKey": settings.supabase_anon_key}
    )
    return _RESET_PASSWORD.replace("__CONFIG__", config)
