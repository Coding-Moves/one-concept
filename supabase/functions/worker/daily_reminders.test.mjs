import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDailyReminderTask } from './daily_reminders.ts';

function harness(batch, provider, options = { environment: 'production', testTokens: new Set() }) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'edge_worker_enqueue_reminders') return batch.length;
    if (name === 'edge_worker_claim_reminders') return batch;
    return batch.length;
  };
  const task = createDailyReminderTask(rpc, provider, options);
  return { task, calls };
}

test('one invocation sends at most 100 and records invalid handsets', async () => {
  const batch = Array.from({ length: 100 }, (_, index) => ({ id: index + 1,
    to: `ExponentPushToken[test-${index}]` }));
  let sent;
  const provider = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ data: sent.map((_, index) => index === 1
      ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
      : { status: 'ok', id: `ticket-${index}` }) }), { status: 200 });
  };
  const { task, calls } = harness(batch, provider);
  const result = await task('run-id');
  assert.equal(sent.length, 100);
  assert.deepEqual(result, { enqueued: 100, claimed: 100, accepted: 99,
    rejected: 0, dropped: 1, unknown: 0, blocked: 0 });
  const recorded = calls.find(call => call.name === 'edge_worker_record_reminders').args.p_results;
  assert.deepEqual(recorded[1], { id: 2, status: 'rejected', error: 'DeviceNotRegistered' });
});

test('provider timeout is marked unknown and never retried by the task', async () => {
  const { task, calls } = harness([{ id: 9, to: 'ExponentPushToken[test]' }],
    async () => { throw new Error('provider timeout'); });
  await assert.rejects(task('run-id'), /expo_transport_unknown/);
  const recorded = calls.find(call => call.name === 'edge_worker_record_reminders').args.p_results;
  assert.deepEqual(recorded, [{ id: 9, status: 'unknown' }]);
  assert.equal(calls.filter(call => call.name === 'edge_worker_claim_reminders').length, 1);
});

test('staging allows only explicit test tokens to reach Expo', async () => {
  const { task, calls } = harness([{ id: 3, to: 'ExponentPushToken[real]' }],
    async () => { throw new Error('Expo must not be called'); },
    { environment: 'staging', testTokens: new Set(['ExponentPushToken[test]']) });
  const result = await task('run-id');
  assert.equal(result.blocked, 1);
  const recorded = calls.find(call => call.name === 'edge_worker_record_reminders').args.p_results;
  assert.deepEqual(recorded, [{ id: 3, status: 'rejected', error: 'staging_blocked' }]);
});

test('allowlisted staging phone receives an explicitly labeled test reminder', async () => {
  const token = 'ExponentPushToken[test]';
  let sent;
  const { task } = harness([{ id: 3, to: token }], async (_url, options) => {
    sent = JSON.parse(options.body);
    return Response.json({ data: [{ status: 'ok', id: 'test-ticket' }] });
  }, { environment: 'staging', testTokens: new Set([token]) });
  assert.equal((await task('run-id')).accepted, 1);
  assert.equal(sent[0].title, 'One Concept staging test');
  assert.match(sent[0].body, /No action needed/);
});

test('an ok ticket without an id is fenced as unknown and fails the run', async () => {
  const { task, calls } = harness([{ id: 12, to: 'ExponentPushToken[test]' }],
    async () => Response.json({ data: [{ status: 'ok' }] }));
  await assert.rejects(task('run-id'), /expo_transport_unknown/);
  assert.deepEqual(calls.find(call => call.name === 'edge_worker_record_reminders').args.p_results,
    [{ id: 12, status: 'unknown' }]);
});

test('malformed claim cannot trigger provider I/O', async () => {
  const { task } = harness([{ id: 1, to: '' }],
    async () => { throw new Error('Expo must not be called'); });
  await assert.rejects(task('run-id'), /invalid_reminder_claim/);
});
