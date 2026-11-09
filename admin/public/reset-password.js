(() => {
  const status = document.getElementById('status');
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const recoverySession = hash.get('type') === 'recovery'
    && hash.has('access_token') && hash.has('refresh_token')
    && !hash.has('error') && !query.has('error');
  const recoveryCode = query.has('code') && !query.has('error') && !hash.has('error');
  if (recoverySession || recoveryCode) {
    // The shared account flow verifies the session, checks the account identity,
    // and supports enrolled authenticators. It clears the token on arrival.
    const destination = new URL('/account/callback', location.origin);
    destination.search = location.search;
    if (recoveryCode && !destination.searchParams.get('type'))
      destination.searchParams.set('type', 'recovery');
    destination.hash = location.hash;
    location.replace(destination.toString());
    return;
  }
  history.replaceState(null, '', location.pathname);
  status.textContent = 'This reset link is invalid or has expired. Request a new link in the app.';
})();
