import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateConcept, validateGenerated } from './gemini.ts';

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

test('bounded Gemini call requests JSON and validates a complete lesson package', async () => {
  let sent;
  const result = await generateConcept(async (url, options) => {
    assert.match(url, /^https:\/\/generativelanguage.googleapis.com\//);
    assert.equal(options.headers['x-goog-api-key'], 'fixture-key');
    sent = JSON.parse(options.body);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }] });
  }, { apiKey: 'fixture-key', model: 'gemini-fixture' },
  { title: 'Transactions', topic: 'Software Engineering', subtopic: 'Databases', angle: null });
  assert.equal(result.summary, generated.summary);
  assert.equal(result.learning_package.mcqs.length, 3);
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
});

test('unsafe or weak generated content is rejected before any private draft', () => {
  assert.throws(() => validateGenerated({ ...generated,
    summary: 'Here is a simple summary that has enough words to be long but starts with banned boilerplate and should be rejected by the worker before any staging.' }),
  /validation_failed/);
  const repeated = structuredClone(generated);
  repeated.learning_package.mcqs[0].options[1] = 'record the payment';
  assert.throws(() => validateGenerated(repeated), /validation_failed/);
});

test('rate limit and unknown provider results never become generated lessons', async () => {
  const input = { title: 'Transactions', topic: 'Software Engineering', subtopic: null, angle: null };
  const config = { apiKey: 'fixture-key', model: 'gemini-fixture' };
  await assert.rejects(generateConcept(async () => new Response('', { status: 429 }), config, input),
    error => error.code === 'rate_limited');
  await assert.rejects(generateConcept(async () => Response.json({ candidates: [] }), config, input),
    error => error.code === 'validation_failed');
  await assert.rejects(generateConcept(async () => { throw new Error('timeout'); }, config, input),
    error => error.code === 'provider_error');
});
