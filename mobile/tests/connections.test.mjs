import './helpers/resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.EXPO_PUBLIC_API_BASE_URL ||= 'https://api.example.org';
const { apiRequest, apiRetryDelay, invalidateAccountRequests, setTokenProvider, ApiError, API_BASE_URL } = await import('../src/api/client.ts');
const { connectionList, requestConnection, actOnConnection, connectionError } = await import('../src/services/connections.ts');
const { openPublicProfile, onPublicProfileOpen } = await import('../src/services/publicProfileNavigation.ts');
const { blockRelationship, relationshipList } = await import('../src/services/relationships.ts');

test('connection requests stay account-bound and invitation cooldowns do not pause learning', async t => {
  invalidateAccountRequests();setTokenProvider(async uid=>{assert.equal(uid,'reader');return 'reader-token';});
  t.mock.method(globalThis,'fetch',async(_,init)=>{assert.equal(init.headers.Authorization,'Bearer reader-token');return new Response('{}',{status:429,headers:{'Retry-After':'604800'}});});
  await assert.rejects(requestConnection('reader','a'.repeat(43)),error=>error.status===429&&error.retryAfterMs===604800000);
  assert.equal(apiRetryDelay(),0);
  globalThis.fetch.mock.mockImplementation(async()=>new Response('{"daily":true}'));
  assert.deepEqual(await apiRequest('/v1/daily',{expectedUserId:'reader'}),{daily:true});
});
test('private connection list and mutations cannot return data after an account changes', async t => {
  invalidateAccountRequests();setTokenProvider(async uid=>{assert.equal(uid,'reader');return 'reader-token';});
  let resolve;
  t.mock.method(globalThis,'fetch',()=>new Promise(r=>resolve=r));
  const old=connectionList('reader','accepted');await new Promise(r=>setImmediate(r));invalidateAccountRequests();resolve(new Response('{"items":[{"display_name":"private"}]}'));
  await assert.rejects(old,error=>error.status===401);
  let sent;
  globalThis.fetch.mock.mockImplementation(async(_,options)=>{sent=options;return new Response(null,{status:204});});
  await actOnConnection('reader','pair','accept');assert.deepEqual(JSON.parse(sent.body),{action:'accept'});
});
test('connection errors stay friendly and public profile navigation is transient and allowlisted',()=>{
  const privateError=new ApiError(500,'SQL credentials',{email:'private@example.invalid'});
  assert.ok(!connectionError(privateError).includes('private@example.invalid'));
  const seen=[];const stop=onPublicProfileOpen(url=>seen.push(url));
  assert.equal(openPublicProfile('https://other.invalid/p/'+'a'.repeat(43)),false);
  const url=API_BASE_URL+'/p/'+'a'.repeat(43);
  assert.equal(openPublicProfile(url),true);assert.deepEqual(seen,[url]);stop();openPublicProfile(url);assert.equal(seen.length,1);
});
test('owned relationship list and block call use the current account token', async t => {
  invalidateAccountRequests();
  setTokenProvider(async uid => { assert.equal(uid, 'reader'); return 'reader-token'; });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return init.method === 'POST' ? new Response(null, { status: 204 }) : new Response('{"items":[],"next_cursor":null}');
  });
  assert.deepEqual((await relationshipList('reader')).items, []);
  await blockRelationship('reader', '11111111-1111-4111-8111-111111111111');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer reader-token');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer reader-token');
  assert.equal(calls[1].init.method, 'POST');
  assert.ok(String(calls[1].url).endsWith('/v1/me/relationships/11111111-1111-4111-8111-111111111111/block'));
});
