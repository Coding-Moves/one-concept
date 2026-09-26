import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectDailyConcept } from '../src/services/dailyConcept.ts';

const concepts = [
  { id: 'alpha', title: 'Alpha' },
  { id: 'bravo', title: 'Bravo' },
  { id: 'charlie', title: 'Charlie' },
];

const state = (overrides = {}) => ({
  learned: [],
  assignment: null,
  followedTopics: [],
  likes: [],
  bookmarks: [],
  ...overrides,
});

test('daily selection is deterministic for the same date and pool', () => {
  const first = selectDailyConcept(concepts, state(), '2026-09-26');
  const reopened = selectDailyConcept(concepts, state(), '2026-09-26');
  assert.equal(reopened?.id, first?.id);
});

test('today keeps a valid existing assignment after the learner completes it', () => {
  const selected = selectDailyConcept(
    concepts,
    state({
      assignment: { conceptId: 'bravo', date: '2026-09-26' },
      learned: [{ conceptId: 'bravo', date: '2026-09-26' }],
    }),
    '2026-09-26',
  );
  assert.equal(selected?.id, 'bravo');
});

test('selection skips learned concepts, then cycles only after every concept is learned', () => {
  const unlearned = selectDailyConcept(
    concepts,
    state({ learned: [{ conceptId: 'alpha', date: '2026-09-20' }, { conceptId: 'bravo', date: '2026-09-21' }] }),
    '2026-09-26',
  );
  assert.equal(unlearned?.id, 'charlie');

  const cycled = selectDailyConcept(
    concepts,
    state({ learned: concepts.map((concept, index) => ({ conceptId: concept.id, date: `2026-09-${20 + index}` })) }),
    '2026-09-26',
  );
  assert.ok(concepts.some(concept => concept.id === cycled?.id));
});

test('an assignment outside the available subject pool is never returned', () => {
  const selected = selectDailyConcept(
    concepts.slice(0, 2),
    state({ assignment: { conceptId: 'charlie', date: '2026-09-26' } }),
    '2026-09-26',
  );
  assert.ok(selected);
  assert.notEqual(selected.id, 'charlie');
});
