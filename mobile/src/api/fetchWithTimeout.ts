/** Bound stalled connections, so screens can offer retry instead of spinning forever. */
export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init?: Parameters<typeof fetch>[1],
  timeoutMs = 15000,
): Promise<Response> => {
  const controller = new AbortController();
  const signal = init?.signal;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort);
  const timeout = setTimeout(abort, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
};
