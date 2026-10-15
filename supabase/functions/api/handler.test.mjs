import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from './handler.ts';

const userId = 'b5a94932-62e0-4780-91c7-af48b93e27ab';
const config = {
  supabaseUrl: 'https://one-concept.supabase.co',
  anonKey: 'public-anon-key',
  serviceRoleKey: 'private-service-key',
  allowedOrigins: ['https://review.example.com'],
};
const request = (path, init = {}) => new Request(`https://one-concept.supabase.co/functions/v1/api${path}`, init);

test('health probes the database and sets exact-origin CORS', async () => {
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    return Response.json({ status: 'ok', database: 'reachable' });
  });
  const result = await handler(request('/health', { headers: { origin: 'https://review.example.com' } }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { status: 'ok', database: 'reachable' });
  assert.equal(result.headers.get('access-control-allow-origin'), 'https://review.example.com');
  assert.equal(result.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/edge_api_health$/);
  assert.equal(calls[0].init.headers.apikey, config.serviceRoleKey);
});

test('an unapproved browser origin never reaches Supabase', async () => {
  const handler = createHandler(config, () => { throw Error('must not fetch'); });
  const result = await handler(request('/health', { headers: { origin: 'https://evil.example' } }));
  assert.equal(result.status, 403);
  assert.equal(result.headers.get('access-control-allow-origin'), null);
});

test('preflight uses an exact allowed origin', async () => {
  const handler = createHandler(config, () => { throw Error('must not fetch'); });
  const result = await handler(request('/v1/topics', { method: 'OPTIONS', headers: { origin: 'https://review.example.com' } }));
  assert.equal(result.status, 204);
  assert.match(result.headers.get('access-control-allow-headers'), /authorization/);
});

test('topics requires Auth verification and passes only its returned user ID to the service RPC', async () => {
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    return Response.json([{ id: 'topic-1', slug: 'software-engineering', following: true }]);
  });
  const missing = await handler(request('/v1/topics'));
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { detail: 'Missing bearer token' });
  assert.equal(missing.headers.get('www-authenticate'), 'Bearer');
  assert.equal(calls.length, 0);
  const result = await handler(request('/v1/topics', { headers: { authorization: 'Bearer user-access-token' } }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), [{ id: 'topic-1', slug: 'software-engineering', following: true }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.apikey, config.anonKey);
  assert.equal(calls[0].init.headers.authorization, 'Bearer user-access-token');
  assert.equal(calls[1].init.headers.apikey, config.serviceRoleKey);
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_user_id: userId });
});

test('rejected or malformed Auth responses cannot reach the service RPC', async () => {
  for (const authResult of [new Response(null, { status: 401 }), Response.json({ id: 'not-a-uuid' })]) {
    let calls = 0;
    const handler = createHandler(config, async () => { calls++; return authResult; });
    const result = await handler(request('/v1/topics', { headers: { authorization: 'Bearer bad-token' } }));
    assert.equal(result.status, 401);
    assert.deepEqual(await result.json(), { detail: 'Invalid or expired token' });
    assert.equal(calls, 1);
  }
});

test('published concept detail uses the verified account and keeps the existing body', async () => {
  const calls = [];
  const body = { id: 'concept-1', slug: 'hash-tables', title: 'Hash Tables', like_count: 0 };
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    return url.endsWith('/auth/v1/user') ? Response.json({ id: userId }) : Response.json(body);
  });
  const result = await handler(request('/v1/concepts/hash-tables', { headers: { authorization: 'Bearer account-token' } }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), body);
  assert.match(calls[1].url, /\/rpc\/edge_api_concept$/);
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_user_id: userId, p_slug: 'hash-tables' });
});

test('like and save writes are idempotent method-to-state operations', async () => {
  const writes = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    writes.push(JSON.parse(init.body));
    return Response.json(true);
  });
  for (const [method, kind, on] of [
    ['PUT', 'like', true], ['DELETE', 'like', false],
    ['PUT', 'save', true], ['DELETE', 'save', false],
  ]) {
    const result = await handler(request(`/v1/concepts/hash-tables/${kind}`, {
      method, headers: { authorization: 'Bearer account-token' },
    }));
    assert.equal(result.status, 204);
    assert.equal(await result.text(), '');
    assert.deepEqual(writes.at(-1), { p_user_id: userId, p_slug: 'hash-tables', p_kind: kind, p_on: on });
  }
});

test('missing concepts return the original not-found contracts', async () => {
  const handler = createHandler(config, async url =>
    url.endsWith('/auth/v1/user') ? Response.json({ id: userId }) : Response.json(null));
  const headers = { authorization: 'Bearer account-token' };
  const detail = await handler(request('/v1/concepts/missing', { headers }));
  assert.equal(detail.status, 404);
  assert.deepEqual(await detail.json(), { detail: 'Concept not found' });
  const writeHandler = createHandler(config, async url =>
    url.endsWith('/auth/v1/user') ? Response.json({ id: userId }) : Response.json(false));
  const write = await writeHandler(request('/v1/concepts/missing/save', { method: 'PUT', headers }));
  assert.equal(write.status, 404);
});

test('notification preferences preserve the older-client weekly choice', async () => {
  const calls = [];
  const prefs = { enabled: false, weekly_quiz_enabled: true, reminder_times: ['08:00', '20:00'] };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, input: JSON.parse(init.body) });
    return Response.json(prefs);
  });
  const headers = { authorization: 'Bearer account-token', 'content-type': 'application/json' };
  const get = await handler(request('/v1/me/notifications', { headers }));
  assert.deepEqual(await get.json(), prefs);
  assert.match(calls[0].url, /\/rpc\/edge_api_notifications$/);
  const put = await handler(request('/v1/me/notifications', {
    method: 'PUT', headers,
    body: JSON.stringify({ enabled: false, reminder_times: ['20:00', '08:00', '08:00'] }),
  }));
  assert.equal(put.status, 200);
  assert.deepEqual(calls[1].input, {
    p_user_id: userId, p_enabled: false, p_weekly: null, p_times: ['08:00', '20:00'],
  });
});

test('streak statistics use only the verified account', async () => {
  const stats = { current: 3, longest: 7, total_learned: 26, total_reviews: 2 };
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(stats);
  });
  const result = await handler(request('/v1/me/stats', {
    headers: { authorization: 'Bearer account-token' },
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), stats);
  assert.match(calls[0].url, /\/rpc\/edge_api_stats$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId });
});

test('invalid or excessive preference bodies fail before database access', async () => {
  let calls = 0;
  const handler = createHandler(config, async url => {
    calls++;
    return url.endsWith('/auth/v1/user') ? Response.json({ id: userId }) : Response.json({});
  });
  const headers = { authorization: 'Bearer account-token', 'content-type': 'application/json' };
  const invalid = await handler(request('/v1/me/notifications', {
    method: 'PUT', headers, body: JSON.stringify({ enabled: true, reminder_times: ['25:00'] }),
  }));
  assert.equal(invalid.status, 422);
  const excessive = await handler(request('/v1/me/notifications', {
    method: 'PUT', headers, body: JSON.stringify({ enabled: true, reminder_times: ['08:00'], filler: 'x'.repeat(5000) }),
  }));
  assert.equal(excessive.status, 413);
  assert.equal(calls, 2); // Auth only; no service RPC.
});

test('push-token registration and bodyless sign-out use the verified account', async () => {
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push(JSON.parse(init.body));
    return Response.json(true);
  });
  const headers = { authorization: 'Bearer account-token', 'content-type': 'application/json' };
  const registered = await handler(request('/v1/me/push-token', {
    method: 'POST', headers,
    body: JSON.stringify({ expo_push_token: 'ExponentPushToken[test-device]', platform: 'android' }),
  }));
  assert.equal(registered.status, 204);
  assert.deepEqual(calls[0], {
    p_user_id: userId, p_token: 'ExponentPushToken[test-device]',
    p_platform: 'android', p_register: true,
  });
  const removed = await handler(request('/v1/me/push-token', { method: 'DELETE', headers }));
  assert.equal(removed.status, 204);
  assert.deepEqual(calls[1], {
    p_user_id: userId, p_token: null, p_platform: null, p_register: false,
  });
});

test('upstream failures are generic and do not reveal secrets', async () => {
  const handler = createHandler(config, async () => new Response('provider-secret', { status: 500 }));
  const result = await handler(request('/health'));
  assert.equal(result.status, 503);
  const body = await result.text();
  assert.equal(body.includes('provider-secret'), false);
  assert.equal(body.includes(config.serviceRoleKey), false);
  assert.equal(result.headers.get('retry-after'), '30');
  assert.match(result.headers.get('x-incident-id'), /^[0-9a-f]{32}$/);
  assert.equal(JSON.parse(body).error.code, 'service_unavailable');
});

test('only exact API path and method combinations are served', async () => {
  const handler = createHandler(config, () => { throw Error('must not fetch'); });
  assert.equal((await handler(request('/v1/unknown'))).status, 404);
  assert.equal((await handler(request('/health', { method: 'POST' }))).status, 405);
  assert.equal((await handler(new Request('https://one-concept.supabase.co/elsewhere/health'))).status, 404);
});

test('configuration rejects wildcard and unsafe browser origins', () => {
  assert.throws(() => createHandler({ ...config, allowedOrigins: ['*'] }));
  assert.throws(() => createHandler({ ...config, allowedOrigins: ['http://review.example.com'] }));
});
