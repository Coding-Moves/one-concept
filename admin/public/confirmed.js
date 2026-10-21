// Supabase may return a short-lived session in the URL fragment after
// confirmation. This informational page never needs it.
if (location.hash || location.search) history.replaceState(null, '', location.pathname);
