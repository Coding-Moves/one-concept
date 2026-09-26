import './helpers/resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.org';
const { apiRequest, ApiError, setTokenProvider, invalidateAccountRequests, setConnectivity, getConnectivity, apiRetryDelay, parseRetryAfter } = await import('../src/api/client.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('sign-out while token lookup waits never sends with the next account token', async t => {
  invalidateAccountRequests();
  let release;
  setTokenProvider(() => new Promise(resolve => { release = resolve; }));
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  const request = apiRequest('/write', { method: 'PUT' });
  await tick();
  invalidateAccountRequests();
  release('next-account-token');
  await assert.rejects(request, error => error instanceof ApiError && error.status === 401);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('late old-account responses cannot alter new-account connectivity or return data', async t => {
  invalidateAccountRequests(); setConnectivity(false); setTokenProvider(async () => 'old');
  let release;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { release = resolve; }));
  const request = apiRequest('/state'); await tick();
  invalidateAccountRequests(); setTokenProvider(async () => 'new');
  release(new Response('{"private":"old account"}'));
  await assert.rejects(request, error => error.status === 401);
  assert.equal(getConnectivity(), false);
});

test('429 Retry-After prevents subsequent requests until the server deadline', async t => {
  invalidateAccountRequests(); setTokenProvider(async () => 'token');
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
  await assert.rejects(apiRequest('/write'), error => error.retryAfterMs === 60000);
  await assert.rejects(apiRequest('/state'), error => error.status === 429);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
  now += 60000;
  assert.equal(apiRetryDelay(), 0);
  await assert.rejects(apiRequest('/state'), error => error.status === 429);
  assert.equal(globalThis.fetch.mock.callCount(), 2);
  invalidateAccountRequests();
});

test('Retry-After accepts seconds and HTTP dates, rejects malformed values', () => {
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:02:00 GMT', 60000), 60000);
  assert.equal(parseRetryAfter('garbage'), 0);
  assert.equal(parseRetryAfter('-5'), 0);
});
