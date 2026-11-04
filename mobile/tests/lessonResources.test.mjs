import './helpers/resolve-ts.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lessonResourceUrl } from '../src/services/lessonResources.ts';

test('video and reading searches use the same specific title and topic', () => {
  const lesson = { title: '  Feature  Flags\n', category: ' Software   Engineering ' };
  const video = new URL(lessonResourceUrl(lesson, 'video'));
  const reading = new URL(lessonResourceUrl(lesson, 'reading'));
  assert.equal(video.origin, 'https://www.youtube.com');
  assert.equal(video.pathname, '/results');
  assert.equal(video.searchParams.get('search_query'), 'Feature Flags in Software Engineering');
  assert.equal(reading.origin, 'https://www.google.com');
  assert.equal(reading.pathname, '/search');
  assert.equal(reading.searchParams.get('q'), 'Feature Flags in Software Engineering');
});

test('external search is URL-encoded and includes no account or app credentials', () => {
  const url = new URL(lessonResourceUrl({
    title: 'A&B? = C', category: 'Math & logic',
  }, 'reading'));
  assert.equal(url.searchParams.get('q'), 'A&B? = C in Math & logic');
  assert.equal([...url.searchParams.keys()].join(','), 'q');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
});

test('missing or malformed lesson text does not open a search', () => {
  assert.equal(lessonResourceUrl({ title: ' ', category: 'Math' }, 'video'), null);
  assert.equal(lessonResourceUrl({ title: 'Limits', category: ' ' }, 'reading'), null);
  assert.equal(lessonResourceUrl({ title: '\ud800', category: 'Math' }, 'video'), null);
});
