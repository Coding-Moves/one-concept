import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generationAllowed } from './provider_gate.ts';

test('staging generation requires an explicit worker-only opt-in', () => {
  assert.equal(generationAllowed('staging', undefined), false);
  assert.equal(generationAllowed('staging', 'false'), false);
  assert.equal(generationAllowed('staging', 'true'), true);
  assert.equal(generationAllowed('development', undefined), false);
  assert.equal(generationAllowed('production', undefined), true);
});
