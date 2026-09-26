import './helpers/resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previousDateKey, todayKey } from '../src/services/dates.ts';
const { computeStreaks } = await import('../src/services/streak.ts');

const record = date => ({ conceptId: `concept-${date}`, date });

test('current streak accepts today and counts each learning day only once', () => {
  const today = todayKey();
  const yesterday = previousDateKey(today);
  const twoDaysAgo = previousDateKey(yesterday);
  const stats = computeStreaks([record(today), record(yesterday), record(yesterday), record(twoDaysAgo)]);
  assert.deepEqual(stats, { current: 3, longest: 3, totalLearned: 3 });
});

test('an unfinished today preserves a streak ending yesterday', () => {
  const yesterday = previousDateKey(todayKey());
  const beforeYesterday = previousDateKey(yesterday);
  const stats = computeStreaks([record(yesterday), record(beforeYesterday)]);
  assert.deepEqual(stats, { current: 2, longest: 2, totalLearned: 2 });
});

test('longest streak follows calendar boundaries rather than string order', () => {
  const stats = computeStreaks([
    record('2024-12-30'),
    record('2024-12-31'),
    record('2025-01-01'),
    record('2025-01-03'),
  ]);
  assert.equal(stats.longest, 3);
  assert.equal(stats.totalLearned, 4);
});
