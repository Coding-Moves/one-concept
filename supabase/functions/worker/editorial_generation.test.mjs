import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEditorialGenerationTask } from './editorial_generation.ts';

const config = { enabled: true, apiKey: 'fixture-secret-key',
  model: 'gemini-fixture', dailyCap: 200, maxConcurrent: 3 };
const row = {
  id: '11111111-1111-4111-8111-111111111111',
  claim_token: '22222222-2222-4222-8222-222222222222',
  topic: 'Software Engineering', subtopic: 'Databases',
  feedback: 'Clarify the rollback example and make the question more useful.',
  source_body: { title: 'Transactions',
    summary: 'A transaction groups related changes together so they succeed or fail as a unit.',
    example: 'A shop records payment and stock together.',
    curriculum: { objective: 'Explain atomicity' },
    learning_package: { flashcard: { front: 'Old?', back: 'Old answer' }, mcqs: [] },
    private_identity: 'never send this field',
  },
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

test('one correction keeps its title, review feedback and private completion gate', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    return name === 'edge_worker_claim_editorial_revision' ? row : 'ready_for_review';
  };
  const result = await createEditorialGenerationTask(rpc, async (_url, options) => {
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    assert.match(prompt, /Clarify the rollback example/);
    assert.match(prompt, /Keep the approved title/);
    assert.doesNotMatch(prompt, /private_identity/);
    assert.doesNotMatch(prompt, /fixture-secret-key/);
    return Response.json({ candidates: [{ content: { parts: [{
      text: JSON.stringify(generated),
    }] } }] });
  }, config)('run');
  assert.deepEqual(result, { disabled: 0, claimed: 1, ready: 1, failed: 0 });
  assert.deepEqual(calls.map(([name]) => name), [
    'edge_worker_claim_editorial_revision', 'edge_worker_finish_editorial_revision',
  ]);
  assert.equal(calls[1][1].p_failure, null);
  assert.equal(calls[1][1].p_learning_package.mcqs.length, 3);
});

test('provider rejection finishes the fenced claim without staging a revision', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    return name === 'edge_worker_claim_editorial_revision' ? row : 'pending';
  };
  const result = await createEditorialGenerationTask(rpc,
    async () => new Response('', { status: 429 }), config)('run');
  assert.equal(result.failed, 1);
  assert.equal(calls[1][1].p_failure, 'rate_limited');
  assert.equal(calls[1][1].p_learning_package, null);
});

test('disabled editorial work cannot claim or contact a provider', async () => {
  const task = createEditorialGenerationTask(
    async () => { throw new Error('SQL called'); },
    async () => { throw new Error('provider called'); },
    { ...config, enabled: false });
  assert.equal((await task('run')).disabled, 1);
});
