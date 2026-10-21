/** Shared by build/publication validation and its tests. Public values only. */
function validUrl(value, release = false) {
  if (typeof value !== 'string' || !value || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash
      && (!release || (url.protocol === 'https:'
        && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        && !url.hostname.endsWith('.invalid')));
  } catch { return false; }
}

function publicConfigErrors(env, release = false) {
  const errors = [];
  for (const key of ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_WEB_BASE_URL']) {
    if (!validUrl(env[key], release)) errors.push(`${key} must be a valid ${release ? 'public HTTPS' : 'HTTP(S)'} URL without credentials, query or fragment`);
  }
  if (validUrl(env.EXPO_PUBLIC_WEB_BASE_URL, release)
      && new URL(env.EXPO_PUBLIC_WEB_BASE_URL).pathname !== '/') {
    errors.push('EXPO_PUBLIC_WEB_BASE_URL must be a website origin without a path');
  }
  if (env.EXPO_PUBLIC_LEGACY_WEB_BASE_URL && !validUrl(env.EXPO_PUBLIC_LEGACY_WEB_BASE_URL, release)) {
    errors.push('EXPO_PUBLIC_LEGACY_WEB_BASE_URL must be a valid public URL');
  }
  if (!env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()) errors.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is required');
  return errors;
}

module.exports = { validUrl, publicConfigErrors };
