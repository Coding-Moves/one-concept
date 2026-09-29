import './helpers/resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { greetingFor } = await import('../src/services/greeting.ts');

test('uses profile timezone at morning, afternoon, and evening boundaries', () => {
  assert.equal(greetingFor(new Date('2026-01-01T06:00:00Z'), 'Asia/Karachi', 'Muawiya'), 'Good morning, Muawiya');
  assert.equal(greetingFor(new Date('2026-01-01T07:00:00Z'), 'Asia/Karachi', 'Muawiya'), 'Good afternoon, Muawiya');
  assert.equal(greetingFor(new Date('2026-01-01T13:00:00Z'), 'Asia/Karachi', 'Muawiya'), 'Good evening, Muawiya');
});

test('never substitutes an account identifier when the profile name is absent', () => {
  assert.equal(greetingFor(new Date('2026-01-01T06:00:00Z'), 'UTC', null), 'Good morning');
});
