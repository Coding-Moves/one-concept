// Supabase verifies the link before redirecting here. The page must not claim
// success on a direct visit, and it never needs to retain a returned session.
const hash = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);
const error = hash.get('error_description') || query.get('error_description') ||
  hash.get('error') || query.get('error');
if (hash.get('type') === 'recovery' && hash.get('access_token') && !error) {
  const reset = new URL('/reset-password', location.origin);
  reset.hash = location.hash;
  location.replace(reset.toString());
} else {
  history.replaceState(null, '', location.pathname);
  const heading = document.getElementById('heading');
  const message = document.getElementById('message');
  if (error) {
    heading.textContent = 'Confirmation did not finish';
    message.textContent = error;
  } else if (hash.get('access_token')) {
    heading.textContent = 'Email confirmed ✓';
    message.textContent = "You're all set. Open the One Concept app and sign in to get today's concept.";
  }
}
