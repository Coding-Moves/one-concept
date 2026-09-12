import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { restoreAuthSession } from '../src/services/authSession.ts';

const session = { user: { id: 'account-a' }, access_token: 'expired', refresh_token: 'saved' };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function setup(t, cache = Promise.resolve(session)) {
  const request = deferred();
  let notify;
  const seen = [];
  let ready = false;
  let cleared = 0;
  const stop = restoreAuthSession({
    getSession: () => request.promise,
    onAuthStateChange: (callback) => {
      notify = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  }, () => cache, (value) => seen.push(value), () => { ready = true; }, () => { cleared++; });
  t.after(stop);
  return { request, seen, stop, emit: (...args) => notify(...args),
    get ready() { return ready; }, get cleared() { return cleared; } };
}

test('opens cached account while refresh is stalled, then preserves it on network failure', async (t) => {
  const state = setup(t);
  await tick();
  assert.equal(state.ready, true);
  assert.deepEqual(state.seen, [session]);
  state.emit('INITIAL_SESSION', null);
  state.request.resolve({ data: { session: null }, error: new AuthRetryableFetchError('offline', 0) });
  await tick();
  assert.deepEqual(state.seen, [session]);
  assert.equal(state.cleared, 0);
  const refreshed = { ...session, access_token: 'fresh' };
  state.emit('TOKEN_REFRESHED', refreshed);
  assert.equal(state.seen.at(-1), refreshed);
});

test('confirmed absent session clears account caches', async (t) => {
  const state = setup(t);
  await tick();
  state.request.resolve({ data: { session: null }, error: null });
  await tick();
  assert.equal(state.seen.at(-1), null);
  assert.equal(state.cleared, 1);
});

test('sign-out wins over late cached and bootstrap sessions', async (t) => {
  const cache = deferred();
  const state = setup(t, cache.promise);
  state.emit('SIGNED_OUT', null);
  cache.resolve(session);
  state.request.resolve({ data: { session }, error: null });
  await tick();
  assert.deepEqual(state.seen, [null]);
  assert.equal(state.cleared, 1);
});

test('new account wins over a stale cached account', async (t) => {
  const cache = deferred();
  const state = setup(t, cache.promise);
  const next = { ...session, user: { id: 'account-b' } };
  state.emit('SIGNED_IN', next);
  cache.resolve(session);
  state.request.resolve({ data: { session }, error: null });
  await tick();
  assert.deepEqual(state.seen, [next]);
});

test('unmounted restore ignores late results', async (t) => {
  const cache = deferred();
  const state = setup(t, cache.promise);
  state.stop();
  cache.resolve(session);
  state.request.resolve({ data: { session }, error: null });
  await tick();
  assert.deepEqual(state.seen, []);
});
