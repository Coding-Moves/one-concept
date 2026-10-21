import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateLegacy, parseLegacyResponse } from './legacy_generation.ts';

const source = { title: 'Transactions', summary: 'Old summary',
  example: 'Old example', subtopic_slug: 'databases',
  curriculum: { prerequisites: ['data-models'] } };
const payload = {
  objective: 'Explain why related changes roll back together', difficulty: 2,
  summary: 'A transaction groups several database changes into one unit. If one change fails, the database can roll the whole group back, keeping related records in agreement.',
  example: 'When an order is placed, the shop records the payment and removes one item from stock together. If the payment fails, the item stays in stock.',
  flashcard: { front: 'What does a transaction protect in a database?',
    back: 'It keeps related changes together so a failure can roll all of them back.' },
  mcqs: [0, 1, 2].map(index => ({
    question: `Which change belongs in transaction example ${index + 1}?`,
    options: ['Record the payment', 'Ignore the order', 'Delete every item', 'Change the weather'],
    correct_index: 0,
  })),
};
const response = { candidates: [{ finishReason: 'STOP',
  content: { parts: [{ text: `Research note.\nBEGIN_CARD_JSON\n${JSON.stringify(payload)}` }] },
  groundingMetadata: { groundingChunks: [
    { web: { uri: 'https://docs.postgresql.org/current/tutorial-transactions.html',
      title: 'PostgreSQL transactions' } },
    { web: { uri: 'https://localhost/private', title: 'Unsafe source' } },
  ] } }] };

test('legacy draft accepts only actual grounding metadata as references', async () => {
  const result = await generateLegacy(async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.deepEqual(request.tools, [{ googleSearch: {} }]);
    assert.match(request.contents[0].parts[0].text, /BEGIN_CARD_JSON/);
    return Response.json(response);
  }, { apiKey: 'fixture-key', model: 'gemini-3.1-flash-lite' },
  source, 'Software Engineering', 'Databases');
  assert.deepEqual(result.curriculum.references,
    [{ title: 'PostgreSQL transactions',
      url: 'https://docs.postgresql.org/current/tutorial-transactions.html' }]);
  assert.deepEqual(result.curriculum.prerequisites, ['data-models']);
  assert.equal(result.title, source.title);
});

test('a source claimed inside the model JSON cannot replace grounding metadata', () => {
  const forged = structuredClone(response);
  forged.candidates[0].groundingMetadata.groundingChunks = [];
  const marker = { ...payload, references: [{ title: 'Forged', url: 'https://example.com' }] };
  forged.candidates[0].content.parts[0].text = `BEGIN_CARD_JSON\n${JSON.stringify(marker)}`;
  assert.throws(() => parseLegacyResponse(forged, source, 'gemini-3.1-flash-lite'),
    error => error.code === 'source_missing');
});

test('rate limits and safety blocks cannot produce a private draft', async () => {
  await assert.rejects(generateLegacy(async () => new Response('', { status: 429 }),
    { apiKey: 'fixture-key', model: 'gemini-3.1-flash-lite' },
    source, 'Topic', 'Subtopic'), error => error.code === 'rate_limited');
  assert.throws(() => parseLegacyResponse(
    { candidates: [{ finishReason: 'SAFETY' }] }, source, 'gemini-3.1-flash-lite'),
  error => error.code === 'safety_blocked');
});
