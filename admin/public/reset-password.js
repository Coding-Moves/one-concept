(() => {
  const form = document.getElementById('reset-form');
  const status = document.getElementById('status');
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const accessToken = hash.get('access_token');
  const valid = accessToken && hash.get('type') === 'recovery'
    && !hash.has('error') && !query.has('error');

  // Fragments stay on the device, but remove the credential from browser
  // history before any network request or user interaction.
  history.replaceState(null, '', location.pathname);
  const config = window.ONE_CONCEPT_PUBLIC_CONFIG;
  if (!valid || !config?.supabaseUrl || !config?.key) {
    status.textContent = 'This reset link is invalid or has expired. Request a new link in the app.';
    return;
  }
  form.hidden = false;
  status.textContent = '';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('password').value;
    const confirmation = document.getElementById('confirm-password').value;
    if (password.length < 6 || password !== confirmation) {
      status.textContent = 'Use at least 6 characters and enter the same password twice.';
      return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Updating password…';
    try {
      const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: { apikey: config.key, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        cache: 'no-store', credentials: 'omit', redirect: 'error',
      });
      if (!response.ok) throw new Error('reset failed');
      form.hidden = true;
      status.textContent = 'Password updated. Open One Concept and sign in with your new password.';
    } catch {
      status.textContent = 'Could not update your password. Request a new reset link in the app.';
      button.disabled = false;
    }
  });
})();
