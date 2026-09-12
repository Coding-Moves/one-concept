/** Only show known, actionable messages; native fetch errors can contain Java/JS logs. */
export function describeAuthError(error: unknown): string {
  const value = error as { message?: string; name?: string; status?: number; code?: string } | null;
  const message = typeof value?.message === 'string' ? value.message.toLowerCase() : '';
  if (value?.name === 'AuthRetryableFetchError' || value?.name === 'AbortError' ||
      value?.status === 0 || /network|fetch|timed? ?out|unknownhost|unable to resolve host/.test(message)) {
    return 'Could not connect. Check your internet connection and try again.';
  }
  if (value?.status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (message.includes('invalid login credentials')) {
    return 'That email and password combination did not match an account.';
  }
  if (message.includes('email not confirmed')) return 'Confirm your email before signing in.';
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'An account with that email already exists. Try signing in instead.';
  }
  if (value?.code === 'weak_password' || message.includes('password should be')) {
    return 'Use a stronger password with at least 6 characters.';
  }
  return 'Could not complete that request. Please try again in a moment.';
}
