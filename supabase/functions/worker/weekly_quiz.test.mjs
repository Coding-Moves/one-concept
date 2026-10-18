import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWeeklyQuizTask } from './weekly_quiz.ts';

const row = { id: '11111111-1111-4111-8111-111111111111',
  quiz_id: '22222222-2222-4222-8222-222222222222',
  to: 'ExponentPushToken[weekly-test]', attempts: 1 };
const receipt = { id: row.id, ticket: 'ticket-123', accepted_at: '2026-10-18T09:00:00Z' };

function harness({ batch = [row], receipts = [], provider, config = {} }) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'edge_worker_enqueue_weekly') return 1;
    if (name === 'edge_worker_claim_weekly') return batch;
    if (name === 'edge_worker_claim_weekly_receipts') return receipts;
    return 1;
  };
  const task = createWeeklyQuizTask(rpc, provider, {
    enabled: true, environment: 'production', testTokens: new Set(), ...config,
  });
  return { task, calls };
}

test('weekly delivery records ticket and receipt in separate committed steps', async () => {
  const requests = [];
  const provider = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/getReceipts')) return Response.json({ data: {
      [receipt.ticket]: { status: 'ok' },
    } });
    return Response.json({ data: [{ status: 'ok', id: 'next-ticket' }] });
  };
  const { task, calls } = harness({ provider, receipts: [receipt] });
  const result = await task('run-id');
  assert.equal(result.accepted, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body, { ids: [receipt.ticket] });
  assert.equal(requests[1].body[0].data.quiz_id, row.quiz_id);
  assert.deepEqual(calls.find(call => call.name === 'edge_worker_record_weekly').args.p_results,
    [{ id: row.id, status: 'accepted', ticket: 'next-ticket' }]);
  assert.deepEqual(calls.find(call => call.name === 'edge_worker_record_weekly_receipts').args.p_results,
    [{ id: row.id, ticket: receipt.ticket, status: 'ok' }]);
});

test('uncertain Expo response is recorded unknown and not retried', async () => {
  const { task, calls } = harness({ provider: async () => { throw new Error('timeout'); } });
  await assert.rejects(task('run-id'), /weekly_push_outcome_unknown/);
  assert.deepEqual(calls.find(call => call.name === 'edge_worker_record_weekly').args.p_results,
    [{ id: row.id, status: 'unknown' }]);
});

test('explicit Expo rate limit may retry, but staging blocks real handsets', async () => {
  const limited = harness({ provider: async () => new Response('', { status: 429 }) });
  await limited.task('run-id');
  assert.deepEqual(limited.calls.find(call => call.name === 'edge_worker_record_weekly').args.p_results,
    [{ id: row.id, status: 'retry' }]);

  const staging = harness({ provider: async () => { throw new Error('must not call Expo'); },
    config: { environment: 'staging', testTokens: new Set(['ExponentPushToken[other]']) } });
  assert.equal((await staging.task('run-id')).blocked, 1);
  assert.deepEqual(staging.calls.find(call => call.name === 'edge_worker_record_weekly').args.p_results,
    [{ id: row.id, status: 'failed', error: 'staging_blocked' }]);
});

test('disabled weekly notifications do not touch the database', async () => {
  const { task, calls } = harness({ provider: async () => { throw new Error('must not call Expo'); },
    config: { enabled: false } });
  assert.equal((await task('run-id')).disabled, 1);
  assert.deepEqual(calls, []);
});
