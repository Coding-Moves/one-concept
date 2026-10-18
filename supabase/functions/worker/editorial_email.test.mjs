import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEditorialEmailTask } from './editorial_email.ts';

const batch = { id: '11111111-1111-4111-8111-111111111111',
  claim_token: '22222222-2222-4222-8222-222222222222', attempts: 1,
  recipient_email: 'reviewer@example.test',
  subject: 'One Concept: assigned lessons to review', body: 'A lesson to review.' };
const config = { enabled: true, environment: 'production', testRecipients: new Set(),
  dashboardOrigin: 'https://review.example.test',
  allowedOrigins: new Set(['https://review.example.test']), from: 'editor@example.test',
  clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh',
  dailyCap: 40, databaseReady: true };

function harness({ valid = true, mail = async url => url.includes('oauth2.googleapis.com')
  ? Response.json({ access_token: 'token' }) : Response.json({ id: 'sent' }) } = {}) {
  const events = [];
  let claims = 0;
  const rpc = async (name) => {
    events.push(name);
    if (name === 'edge_worker_prepare_email') return 1;
    if (name === 'edge_worker_claim_email') return claims++ === 0 ? batch : null;
    throw new Error(`unexpected RPC ${name}`);
  };
  const transaction = async work => {
    events.push('begin');
    const query = async (statement) => {
      events.push(statement);
      if (statement.includes('from public.editorial_email_batches where')) {
        return [{ status: 'sending', claim_token: batch.claim_token }];
      }
      if (statement.includes('edge_worker_email_batch_eligible')) return [{ valid }];
      return [];
    };
    const result = await work(query);
    events.push('commit');
    return result;
  };
  const fetcher = async (url, options) => {
    events.push(url);
    return mail(url, options);
  };
  return { task: createEditorialEmailTask(rpc, transaction, fetcher, config), events };
}

test('Gmail send happens while review and notification locks remain held', async () => {
  const { task, events } = harness();
  const result = await task('run-id');
  assert.equal(result.sent, 1);
  const begin = events.indexOf('begin');
  const gmail = events.findIndex(item => item.includes('gmail.googleapis.com'));
  const commit = events.indexOf('commit');
  assert.ok(begin >= 0 && gmail > begin && commit > gmail);
  assert.ok(events.findIndex(item => item.includes('edge_worker_email_batch_eligible')) < gmail);
  assert.equal(events.filter(item => item === 'edge_worker_claim_email').length, 2);
});

test('revoked assignment suppresses outbox without calling Gmail', async () => {
  const { task, events } = harness({ valid: false,
    mail: async () => { throw new Error('must not call provider'); } });
  const result = await task('run-id');
  assert.equal(result.suppressed, 1);
  assert.equal(events.some(item => item.includes('oauth2.googleapis.com')), false);
  assert.ok(events.some(item => item.includes('set batch_id=null')));
});

test('disabled or unconfigured mail cannot contact the database or provider', async () => {
  const names = [];
  const rpc = async name => { names.push(name); throw new Error('must not call'); };
  const transaction = async () => { throw new Error('must not begin'); };
  const fetcher = async () => { throw new Error('must not call'); };
  const off = createEditorialEmailTask(rpc, transaction, fetcher, { ...config, enabled: false });
  assert.equal((await off('run-id')).disabled, 1);
  const missing = createEditorialEmailTask(rpc, transaction, fetcher,
    { ...config, databaseReady: false });
  await assert.rejects(missing('run-id'), /editorial_email_setup_blocked/);
  assert.deepEqual(names, []);
});
