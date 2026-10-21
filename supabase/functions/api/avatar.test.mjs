import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from './handler.ts';
import { inspectAvatar, AvatarInputError } from './avatar_image.ts';

const userId = 'b5a94932-62e0-4780-91c7-af48b93e27ab';
const config = {
  supabaseUrl: 'https://one-concept.supabase.co',
  anonKey: 'public-anon-key',
  serviceRoleKey: 'private-service-key',
  allowedOrigins: [],
};
const request = (path, init = {}) =>
  new Request('https://one-concept.supabase.co/functions/v1/api' + path, init);

test('avatar upload and removal save private keys and clean old objects', async () => {
  const calls = [];
  const old = 'avatars/' + userId + '/' + 'a'.repeat(32) + '.jpg';
  const normalized = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (url.includes('/storage/v1/object/sign/')) {
      const key = url.split('/profile-avatars/')[1];
      return Response.json({ signedURL: '/object/sign/profile-avatars/' + key + '?token=short' });
    }
    if (url.endsWith('edge_api_set_avatar')) {
      const key = JSON.parse(init.body).p_avatar_key;
      return Response.json({ state: { avatar_ref: key }, old_avatar_ref: old });
    }
    return Response.json({ ok: true });
  }, async () => normalized);
  const auth = { authorization: 'Bearer user-token' };
  const put = await handler(request('/v1/me/avatar?compact=true', {
    method: 'PUT', headers: { ...auth, 'content-type': 'image/png' },
    body: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
  }));
  assert.equal(put.status, 200);
  const result = await put.json();
  assert.match(result.avatar_ref, new RegExp('^avatars/' + userId + '/[a-f0-9]{32}[.]jpg$'));
  assert.match(result.avatar_url, /token=short$/);
  const upload = calls.find(call => call.url.includes('/object/profile-avatars/avatars/'));
  assert.equal(upload.init.method, 'POST');
  assert.equal(upload.init.headers['content-type'], 'image/jpeg');
  assert.deepEqual(new Uint8Array(await upload.init.body.arrayBuffer()), normalized);
  assert.equal(JSON.parse(calls.find(call => call.url.endsWith('edge_api_set_avatar')).init.body).p_compact, true);
  const cleanup = calls.find(call => call.init.method === 'DELETE');
  assert.deepEqual(JSON.parse(cleanup.init.body).prefixes, [old]);
  const removed = await handler(request('/v1/me/avatar', { method: 'DELETE', headers: auth }));
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).avatar_ref, null);
  assert.equal(calls.filter(call => call.url.endsWith('edge_api_set_avatar')).length, 2);
  assert.equal((await handler(request('/v1/me/avatar', {
    method: 'GET', headers: auth }))).status, 405);
});

test('avatar rejects invalid and oversized uploads before storage', async () => {
  const calls = [];
  const handler = createHandler(config, async (url) => {
    calls.push(url);
    return url.endsWith('/auth/v1/user') ? Response.json({ id: userId }) : Response.json({});
  }, async () => { throw new AvatarInputError(422, 'Invalid photo'); });
  const auth = { authorization: 'Bearer user-token' };
  const wrong = await handler(request('/v1/me/avatar', {
    method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream' },
    body: Uint8Array.from([1]),
  }));
  assert.equal(wrong.status, 415);
  const invalid = await handler(request('/v1/me/avatar', {
    method: 'PUT', headers: { ...auth, 'content-type': 'image/png' },
    body: Uint8Array.from([1]),
  }));
  assert.equal(invalid.status, 422);
  const large = await handler(request('/v1/me/avatar', {
    method: 'PUT', headers: { ...auth, 'content-type': 'image/png' },
    body: new Uint8Array(5 * 1024 * 1024 + 1),
  }));
  assert.equal(large.status, 413);
  assert.equal(calls.filter(url => url.includes('/storage/')).length, 0);
});

test('avatar headers reject huge dimensions and mismatched image types', () => {
  const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12P4////fwAJ+wP90YOM8AAAAABJRU5ErkJggg==',
    'base64'));
  assert.doesNotThrow(() => inspectAvatar(png, 'image/png'));
  assert.throws(() => inspectAvatar(png, 'image/jpeg'), AvatarInputError);
  const huge = new Uint8Array(png);
  huge.set([0, 0, 0x20, 0], 16);
  huge.set([0, 0, 0x20, 0], 20);
  assert.throws(() => inspectAvatar(huge, 'image/png'), error =>
    error instanceof AvatarInputError && error.status === 422);
  const nineMegapixels = new Uint8Array(png);
  nineMegapixels.set([0, 0, 0x0b, 0xb8], 16);
  nineMegapixels.set([0, 0, 0x0b, 0xb8], 20);
  assert.throws(() => inspectAvatar(nineMegapixels, 'image/png'), error =>
    error instanceof AvatarInputError && /8 million pixels/.test(error.message));
  const jpeg = new Uint8Array(21);
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x13, 0x88, 0x13, 0x88]);
  assert.doesNotThrow(() => inspectAvatar(jpeg, 'image/jpeg'));
});
