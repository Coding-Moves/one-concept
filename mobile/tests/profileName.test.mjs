import assert from 'node:assert/strict';
import { test } from 'node:test';
import './helpers/resolve-ts.mjs';
const { normalizeProfileName } = await import('../src/services/profileName.ts');
test('preferred names normalize accents and accept international scripts', () => {
  assert.equal(normalizeProfileName('  Jose\u0301  '), 'José');
  assert.equal(normalizeProfileName('معاویہ'), 'معاویہ');
  assert.equal(normalizeProfileName('😀'.repeat(60)), '😀'.repeat(60));
});
test('preferred names reject empty, oversized and invisible control characters', () => {
  for (const value of ['', '  ', 'a'.repeat(61), 'a\nb', 'a\u202eb']) assert.throws(() => normalizeProfileName(value));
});
