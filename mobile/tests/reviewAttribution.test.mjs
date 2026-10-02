import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapConcept, normalizeCachedConcept, reviewForConcept } from '../src/services/conceptMapping.ts';
import { OfflineCache } from '../src/services/offlineCache.ts';

const payload = {
  id: 'private-concept-id', slug: 'lesson', title: 'Lesson', summary: 'Version two text',
  example: null, topic_slug: 'topic', topic_name: 'Topic', content_version: 2,
  review: { name: 'Registered Reviewer', reviewed_at: '2026-10-01T12:00:00Z', content_version: 2 },
};

test('one mapping pairs full lesson content with safe public review fields', () => {
  const lesson = mapConcept({...payload, review: {...payload.review, email:'private@example.invalid', reviewer_id:'private'}});
  assert.equal(lesson.review.name, 'Registered Reviewer');
  assert.deepEqual(Object.keys(lesson.review).sort(), ['contentVersion','name','reviewedAt']);
  assert.equal(lesson.review.contentVersion, lesson.contentVersion);
  assert.equal(JSON.stringify(lesson).includes('private'), false);
});

test('legacy, absent, malformed and mismatched evidence never create a label', () => {
  for (const review of [null, undefined, 'Reviewer', {}, {...payload.review, name:''},
    {...payload.review, name:'Bad\nName'}, {...payload.review, reviewed_at:'not-a-date'},
    {...payload.review, content_version:1}]) {
    assert.equal(mapConcept({...payload, review}).review, undefined);
  }
  assert.equal(mapConcept({...payload, content_version:undefined}).review, undefined);
  assert.equal(mapConcept({...payload, content_version:0, review:{...payload.review, content_version:0}}).review, undefined);
  const cached = mapConcept(payload);
  assert.equal(reviewForConcept({...cached, contentVersion:3}), undefined);
  assert.equal(normalizeCachedConcept({...cached, review:'bad'}).review, undefined);
});

test('an online response replaces evidence even for same-version attestation or removal', () => {
  const legacy = mapConcept({...payload, review:null});
  const attested = mapConcept(payload);
  assert.equal(legacy.review, undefined);
  assert.equal(attested.contentVersion, legacy.contentVersion);
  assert.ok(attested.review);
  const fresh = mapConcept({...payload, content_version:3, summary:'New unreviewed body', review:null});
  assert.equal(fresh.review, undefined);
  assert.equal(fresh.summary, 'New unreviewed body');
});

test('offline restart preserves the exact pair; account cleanup rejects late attribution writes', async () => {
  const rows = new Map();
  const disk = {getItem:async k=>rows.get(k)??null, setItem:async(k,v)=>{rows.set(k,v);},
    getAllKeys:async()=>[...rows.keys()], multiRemove:async ks=>ks.forEach(k=>rows.delete(k))};
  const cache = new OfflineCache(disk,'lessons/');
  const old = mapConcept(payload);
  await cache.set(old.id, old);
  const restarted = new OfflineCache(disk,'lessons/');
  assert.deepEqual(normalizeCachedConcept(await restarted.get(old.id)), JSON.parse(JSON.stringify(old)));
  const epoch = cache.epoch;
  await cache.clear();
  await cache.set(old.id, old, epoch);
  assert.equal(await cache.get(old.id), null);
  await cache.set(old.id, mapConcept({...payload, content_version:3, review:null}));
  assert.equal(normalizeCachedConcept(await cache.get(old.id)).review, undefined);
});
