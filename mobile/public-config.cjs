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

const PROJECT_URLS = {
  production: 'https://egdszjoesxlccauahmsx.supabase.co',
  staging: 'https://zhrulokgngjceqgjkcmw.supabase.co',
};
const PRODUCTION_WEB_HOSTS = new Set([
  'coding-moves-one-concept-review.netlify.app',
  'review.oneconcept.codingmoves.com',
]);

function validWebOrigin(value, release = false) {
  if (!validUrl(value, release)) return false;
  return new URL(value).pathname === '/';
}

function publicConfigErrors(env, release = false, variant = null) {
  const errors = [];
  for (const key of ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_WEB_BASE_URL']) {
    if (!validUrl(env[key], release)) errors.push(`${key} must be a valid ${release ? 'public HTTPS' : 'HTTP(S)'} URL without credentials, query or fragment`);
  }
  if (validUrl(env.EXPO_PUBLIC_WEB_BASE_URL, release)
      && new URL(env.EXPO_PUBLIC_WEB_BASE_URL).pathname !== '/') {
    errors.push('EXPO_PUBLIC_WEB_BASE_URL must be a website origin without a path');
  }
  if (env.EXPO_PUBLIC_LEGACY_WEB_BASE_URL && !validWebOrigin(env.EXPO_PUBLIC_LEGACY_WEB_BASE_URL, release)) {
    errors.push('EXPO_PUBLIC_LEGACY_WEB_BASE_URL must be a valid public website origin');
  }
  if (validUrl(env.EXPO_PUBLIC_API_BASE_URL, release)
      && validUrl(env.EXPO_PUBLIC_SUPABASE_URL, release)) {
    const api = new URL(env.EXPO_PUBLIC_API_BASE_URL);
    const auth = new URL(env.EXPO_PUBLIC_SUPABASE_URL);
    if (api.hostname.endsWith('.supabase.co')
        && (api.pathname !== '/functions/v1/api' || api.origin !== auth.origin)) {
      errors.push('Supabase API and Auth must use the same project and exact API function path');
    }
  }
  if (!env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()) errors.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is required');
  if (release && variant !== null) {
    if (!Object.hasOwn(PROJECT_URLS, variant)) {
      errors.push('APP_VARIANT must explicitly identify staging or production');
    } else {
      const projectUrl = PROJECT_URLS[variant];
      if (env.EXPO_PUBLIC_APP_VARIANT !== variant) errors.push('Public app variant does not match the requested publication variant');
      if (env.EXPO_PUBLIC_SUPABASE_URL !== projectUrl || env.EXPO_PUBLIC_API_BASE_URL !== `${projectUrl}/functions/v1/api`) {
        errors.push(`${variant} app requires its matching Supabase Auth and Edge API project`);
      }
      if (variant === 'staging') {
        for (const key of ['EXPO_PUBLIC_WEB_BASE_URL', 'EXPO_PUBLIC_LEGACY_WEB_BASE_URL']) {
          if (validWebOrigin(env[key], true) && PRODUCTION_WEB_HOSTS.has(new URL(env[key]).hostname)) {
            errors.push(`${key} must not use the production review website in staging`);
          }
        }
      }
    }
  }
  return errors;
}

module.exports = { validUrl, validWebOrigin, publicConfigErrors };
