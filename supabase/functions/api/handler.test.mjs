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
    assert.equal(calls, 1);
  }
});

test('upstream failures are generic and do not reveal secrets', async () => {
  const handler = createHandler(config, async () => new Response('provider-secret', { status: 500 }));
  const result = await handler(request('/health'));
  assert.equal(result.status, 503);
  const body = await result.text();
  assert.equal(body.includes('provider-secret'), false);
  assert.equal(body.includes(config.serviceRoleKey), false);
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
