import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler, signDispatch } from './handler.ts';

const key = 'test-dispatch-key-with-at-least-thirty-two-characters';
const runId = 'e741f4fa-16b0-4957-9f04-7f18380b4eca';
const issuedAt = 1_700_000_000;
const config = task => ({
  supabaseUrl: 'https://staging.example.invalid',
  serviceRoleKey: 'test-service-key',
  signingKey: key,
  tasks: task ? { daily_reminders: task } : {},
});

async function request(signature, overrides = {}) {
  return new Request('https://staging.example.invalid/functions/v1/worker', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ run_id: runId, job: 'daily_reminders', issued_at: issuedAt,
      signature, ...overrides }),
  });
}

const now = () => issuedAt * 1000;

test('signed request claims once, finishes, and reports only counts', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response('true', { status: 200 });
  };
  let ran = 0;
  const handler = createHandler(config(async () => { ran++; return { sent: 2 }; }), fetcher, now);
  const signature = await signDispatch(key, runId, 'daily_reminders', issuedAt);
  const response = await handler(await request(signature));
  assert.equal(response.status, 200);
  assert.equal(ran, 1);
  assert.deepEqual((await response.json()).counts, { sent: 2 });
  assert.deepEqual(calls.map(call => new URL(call.url).pathname),
    ['/rest/v1/rpc/edge_worker_start_run', '/rest/v1/rpc/edge_worker_finish_run']);
  assert.equal(calls[1].body.p_success, true);
});

test('unsigned, forged, and expired requests never reach a service RPC', async () => {
  let calls = 0;
  const handler = createHandler(config(async () => ({ sent: 1 })),
    async () => { calls++; throw new Error('unexpected RPC'); }, now);
  const valid = await signDispatch(key, runId, 'daily_reminders', issuedAt);
  assert.equal((await handler(await request('0'.repeat(64)))).status, 401);
  assert.equal((await handler(await request(valid, { job: 'weekly_quiz' }))).status, 401);
  assert.equal((await handler(await request(valid, { issued_at: issuedAt - 301 }))).status, 401);
  assert.equal((await handler(await request(valid, { issued_at: issuedAt + 31 }))).status, 401);
  assert.equal(calls, 0);
});

test('disabled job and duplicate ledger claim cannot run provider work', async () => {
  const signature = await signDispatch(key, runId, 'daily_reminders', issuedAt);
  const disabled = createHandler(config(null),
    async () => { throw new Error('unexpected RPC'); }, now);
  assert.equal((await disabled(await request(signature))).status, 503);

  let worked = false;
  const handler = createHandler(config(async () => { worked = true; return {}; }),
    async () => new Response('false', { status: 200 }), now);
  assert.equal((await handler(await request(signature))).status, 409);
  assert.equal(worked, false);
});

test('task failure records failed run without echoing provider details', async () => {
  const calls = [];
  const handler = createHandler(config(async () => { throw new Error('private provider detail'); }),
    async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return new Response('true', { status: 200 });
    }, now);
  const signature = await signDispatch(key, runId, 'daily_reminders', issuedAt);
  const response = await handler(await request(signature));
  assert.equal(response.status, 503);
  assert.equal(calls[1].p_success, false);
  assert.equal(JSON.stringify(await response.json()).includes('private provider detail'), false);
});

test('body limit and method guard reject public misuse before RPC', async () => {
  const handler = createHandler(config(async () => ({})),
    async () => { throw new Error('unexpected RPC'); }, now);
  assert.equal((await handler(new Request('https://staging.example.invalid/functions/v1/worker'))).status, 405);
  assert.equal((await handler(new Request('https://staging.example.invalid/functions/v1/worker', {
    method: 'POST', body: 'x'.repeat(513),
  }))).status, 413);
  const streamed = new Request('https://staging.example.invalid/functions/v1/worker', {
    method: 'POST', duplex: 'half', body: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(513)); controller.close(); },
    }),
  });
  assert.equal(streamed.headers.get('content-length'), null);
  assert.equal((await handler(streamed)).status, 413);
});
