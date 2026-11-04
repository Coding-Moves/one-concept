/** Bound stalled connections, so screens can offer retry instead of spinning forever. */
export class RequestTimeoutError extends Error {
  constructor() {
    super('Request timed out');
    this.name = 'RequestTimeoutError';
  }
}

export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init?: Parameters<typeof fetch>[1],
  timeoutMs = 15000,
): Promise<Response> => {
  const controller = new AbortController();
  let timedOut = false;
  const signal = init?.signal;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort);
  const timeout = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
};
