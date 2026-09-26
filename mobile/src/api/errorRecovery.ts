export type RecoveryKind =
  | 'offline'
  | 'service_unavailable'
  | 'rate_limited'
  | 'session_expired'
  | 'configuration'
  | 'not_found'
  | 'unknown';

export interface RecoveryCopy {
  kind: RecoveryKind;
  title: string;
  message: string;
}

const COPY: Record<RecoveryKind, Omit<RecoveryCopy, 'kind'>> = {
  offline: {
    title: 'You’re offline',
    message: 'Check your connection and try again. Downloaded lessons stay available on this device.',
  },
  service_unavailable: {
    title: 'Service is temporarily unavailable',
    message: 'Your saved learning stays on this device. Please try again in a moment.',
  },
  rate_limited: {
    title: 'Please wait a moment',
    message: 'We’re limiting repeated requests to keep the service available. Try again shortly.',
  },
  session_expired: {
    title: 'Your session needs attention',
    message: 'Please sign in again, then try your request.',
  },
  configuration: {
    title: 'App setup is incomplete',
    message: 'Please install the latest app update. If this continues, contact support.',
  },
  not_found: {
    title: 'This item is unavailable',
    message: 'It may no longer be available. Return to your learning list and try another lesson.',
  },
  unknown: {
    title: 'Something went wrong',
    message: 'Your saved learning is still safe. Please try again in a moment.',
  },
};

/** Maps only known error classes to stable learner-facing language. */
export function classifyRecoveryError(error: unknown): RecoveryCopy {
  let kind: RecoveryKind = 'unknown';
  const value = error as { name?: unknown; status?: unknown } | null;
  if (value?.name === 'ApiConfigurationError') kind = 'configuration';
  else if (value?.name === 'ApiError' && typeof value.status === 'number') {
    if (value.status === 0) kind = 'offline';
    else if (value.status === 429) kind = 'rate_limited';
    else if (value.status === 401) kind = 'session_expired';
    else if (value.status === 404) kind = 'not_found';
    else if (value.status >= 500) kind = 'service_unavailable';
  } else if (value?.name === 'AbortError') kind = 'offline';
  return { kind, ...COPY[kind] };
}
