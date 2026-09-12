/** Bound stalled connections, so screens can offer retry instead of spinning forever. */
export const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const signal = init?.signal;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort);
  const timeout = setTimeout(abort, 15000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
};
