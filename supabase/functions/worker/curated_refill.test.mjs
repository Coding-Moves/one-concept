import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCuratedRefillTask } from './curated_refill.ts';

const config = {
  enabled: true, urgentEnabled: true, apiKey: 'fixture-key', model: 'gemini-fixture',
  activeDays: 90, reserve: 60, low: 10, critical: 3, minPool: 25,
  dailyCap: 5, topicCap: 1, urgentDailyCap: 10, urgentTopicCap: 2,
  maxConcurrent: 3, reviewLimit: 25,
};
const row = {
  id: '11111111-1111-4111-8111-111111111111',
  claim_token: '22222222-2222-4222-8222-222222222222',
  title: 'Transactions', angle: 'Use a shop order', difficulty: 2,
  topic_name: 'Software Engineering', subtopic_name: 'Databases',
  curriculum: { objective: 'Explain atomicity', prerequisites: ['tables'],
    references: ['Curated database guide'] },
};
const generated = {
  summary: 'A transaction groups several database changes into one unit. If one change fails, the database can roll the whole group back, keeping related records in agreement.',
  example: 'When an order is placed, the shop records the payment and removes one item from stock together. If the payment fails, the item stays in stock.',
  learning_package: {
    flashcard: { front: 'What does a transaction protect in a database?',
      back: 'It keeps related changes together so a failure can roll all of them back.' },
    mcqs: [0, 1, 2].map(index => ({
      question: `Which change belongs in transaction example ${index + 1}?`,
      options: ['Record the payment', 'Ignore the order', 'Delete every item', 'Change the weather'],
      correct_index: 0,
    })),
  },
};

test('normal refill plans readers and drafts exactly one validated concept', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'edge_worker_plan_active_readers') return 2;
    if (name === 'edge_worker_claim_curated_refill') return row;
    if (name === 'edge_worker_complete_curated_refill') return true;
    throw new Error('unexpected RPC');
  };
  const task = createCuratedRefillTask(rpc, async (_url, options) => {
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    assert.match(prompt, /Learning objective: Explain atomicity/);
    assert.match(prompt, /Editorial references: \["Curated database guide"\]/);
    return Response.json({ candidates: [{ content: { parts: [{
      text: JSON.stringify(generated),
    }] } }] });
  }, config, false);
  assert.deepEqual(await task('run'),
    { disabled: 0, planned: 2, claimed: 1, drafted: 1, failed: 0 });
  assert.deepEqual(calls.map(([name]) => name), [
    'edge_worker_plan_active_readers', 'edge_worker_claim_curated_refill',
    'edge_worker_complete_curated_refill',
  ]);
  assert.equal(calls[1][1].p_global_cap, 5);
  assert.equal(calls[2][1].p_learning_package.mcqs.length, 3);
});

test('urgent pass uses its separate caps and rate limit releases the title', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'edge_worker_claim_curated_refill') return row;
    if (name === 'edge_worker_release_curated_refill') return true;
    throw new Error('unexpected RPC');
  };
  const task = createCuratedRefillTask(rpc,
    async () => new Response('', { status: 429 }), config, true);
  assert.deepEqual(await task('run'),
    { disabled: 0, planned: 0, claimed: 1, drafted: 0, failed: 1 });
  assert.deepEqual(calls.map(([name]) => name), [
    'edge_worker_claim_curated_refill', 'edge_worker_release_curated_refill',
  ]);
  assert.equal(calls[0][1].p_low, 3);
  assert.equal(calls[0][1].p_global_cap, 10);
  assert.equal(calls[1][1].p_code, 'rate_limited');
});

test('disabled or invalid configuration cannot reserve provider quota', async () => {
  const rpc = async () => { throw new Error('should not call SQL'); };
  const fetcher = async () => { throw new Error('should not call provider'); };
  assert.equal((await createCuratedRefillTask(rpc, fetcher,
    { ...config, enabled: false }, false)('run')).disabled, 1);
  await assert.rejects(createCuratedRefillTask(rpc, fetcher,
    { ...config, dailyCap: 101 }, false)('run'), /invalid_refill_configuration/);
});
