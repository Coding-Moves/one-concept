import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLegacyEnrichmentTask } from './legacy_enrichment.ts';

const config = { enabled: true, apiKey: 'fixture-key', dailyCap: 200,
  maxConcurrent: 3, reviewLimit: 25 };
const row = { id: '11111111-1111-4111-8111-111111111111',
  claim_token: '22222222-2222-4222-8222-222222222222',
  topic: 'Software Engineering', subtopic: 'Databases',
  model: 'gemini-3.1-flash-lite',
  source_body: { title: 'Transactions', subtopic_slug: 'databases',
    curriculum: { prerequisites: [] } } };

test('one legacy entry is claimed and blocked for incomplete provider content', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    return name === 'edge_worker_claim_legacy_enrichment' ? row : 'blocked';
  };
  const task = createLegacyEnrichmentTask(rpc, async () => Response.json({
    candidates: [{ finishReason: 'STOP',
      content: { parts: [{ text: 'BEGIN_CARD_JSON\n{}' }] },
      groundingMetadata: { groundingChunks: [] } }],
  }), config);
  assert.equal((await task('run')).failed, 1);
  assert.deepEqual(calls.map(([name]) => name), [
    'edge_worker_claim_legacy_enrichment', 'edge_worker_finish_legacy_enrichment',
  ]);
  assert.equal(calls[1][1].p_failure, 'package_invalid');
  assert.equal(calls[1][1].p_body, null);
});

test('disabled legacy work cannot claim an owner batch', async () => {
  const task = createLegacyEnrichmentTask(
    async () => { throw new Error('SQL called'); },
    async () => { throw new Error('provider called'); },
    { ...config, enabled: false });
  assert.equal((await task('run')).disabled, 1);
});
