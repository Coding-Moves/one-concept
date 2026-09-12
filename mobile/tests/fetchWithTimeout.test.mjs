import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchWithTimeout } from '../src/api/fetchWithTimeout.ts';

test('stalled fetch aborts after 15 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const pending = fetchWithTimeout('https://example.invalid');
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  t.mock.timers.tick(15000);
  await rejected;
});

test('forwards caller cancellation and successful responses', async (t) => {
  const response = new Response('{}');
  const fetch = t.mock.method(globalThis, 'fetch', async (_, { signal }) => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return response;
  });
  assert.equal(await fetchWithTimeout('https://example.invalid'), response);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchWithTimeout('https://example.invalid', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 2);
});
