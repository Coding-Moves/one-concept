import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfflineCache } from '../src/services/offlineCache.ts';
import { bookmarkVersions, refreshSavedConcepts } from '../src/services/savedConceptSync.ts';

function makeCache() {
  const rows = new Map();
  const storage = {
    getItem: async key => rows.get(key) ?? null,
    setItem: async (key, value) => { rows.set(key, value); },
    getAllKeys: async () => [...rows.keys()],
    multiRemove: async keys => { keys.forEach(key => rows.delete(key)); },
  };
  return new OfflineCache(storage, 'lessons/');
}

const lesson = (version, summary) => ({
  id: 'saved', title: 'Saved lesson', category: 'Topic', summary,
  contentVersion: version, likeCount: 0,
});

test('the next online sync replaces a downloaded saved lesson; a failed sync keeps it', async () => {
  const cache = makeCache();
  await cache.set('saved', lesson(1, 'Old published body'));
  await refreshSavedConcepts(['saved', 'saved'], cache, async slug => {
    assert.equal(slug, 'saved');
    return lesson(2, 'Corrected published body');
  }, () => true);
  assert.deepEqual(await cache.get('saved'), lesson(2, 'Corrected published body'));
  await refreshSavedConcepts(['saved'], cache, async () => { throw Error('Temporary outage'); }, () => true);
  assert.deepEqual(await cache.get('saved'), lesson(2, 'Corrected published body'));
});

test('aligned versions skip current copies and download only missing or older lessons', async () => {
  const cache = makeCache();
  await cache.set('current', { ...lesson(2, 'Already current'), id: 'current' });
  await cache.set('saved', lesson(1, 'Old published body'));
  const versions = bookmarkVersions(['current', 'saved', 'missing'], [2, 2, 1]);
  const requested = [];
  await refreshSavedConcepts(['current', 'saved', 'missing'], cache, async slug => {
    requested.push(slug);
    return { ...lesson(slug === 'saved' ? 2 : 1, `Downloaded ${slug}`), id: slug };
  }, () => true, cache.epoch, versions);
  assert.deepEqual(requested.sort(), ['missing', 'saved']);
  assert.equal((await cache.get('current')).summary, 'Already current');
  assert.equal((await cache.get('saved')).summary, 'Downloaded saved');
  assert.equal((await cache.get('missing')).summary, 'Downloaded missing');
});

test('missing or malformed version arrays use the older-server refresh path', async () => {
  const cache = makeCache();
  await cache.set('saved', lesson(1, 'Old published body'));
  for (const versions of [undefined, [], [0], [NaN], ['2']]) {
    assert.equal(bookmarkVersions(['saved'], versions), null);
  }
  let calls = 0;
  await refreshSavedConcepts(['saved'], cache, async () => {
    calls += 1;
    return lesson(2, 'Corrected body');
  }, () => true, cache.epoch, bookmarkVersions(['saved'], undefined));
  assert.equal(calls, 1);
  assert.equal((await cache.get('saved')).summary, 'Corrected body');
});

test('overlapping syncs wait for the same slug and honor the newer advertised version', async () => {
  const cache = makeCache();
  let start, finish;
  const started = new Promise(resolve => { start = resolve; });
  const firstResponse = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  const download = async () => {
    calls += 1;
    if (calls === 1) { start(); return firstResponse; }
    return lesson(2, 'Corrected body');
  };
  const first = refreshSavedConcepts(['saved'], cache, download, () => true,
    cache.epoch, bookmarkVersions(['saved'], [1]));
  await started;
  const second = refreshSavedConcepts(['saved'], cache, download, () => true,
    cache.epoch, bookmarkVersions(['saved'], [2]));
  finish(lesson(1, 'Original body'));
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.deepEqual(await cache.get('saved'), lesson(2, 'Corrected body'));
});

test('a late saved download cannot replace a newer detail copy', async () => {
  const cache = makeCache();
  let start, finish;
  const started = new Promise(resolve => { start = resolve; });
  const response = new Promise(resolve => { finish = resolve; });
  const sync = refreshSavedConcepts(['saved'], cache, () => {
    start();
    return response;
  }, () => true, cache.epoch, bookmarkVersions(['saved'], [1]));
  await started;
  await cache.set('saved', lesson(3, 'Newer detail body'));
  finish(lesson(1, 'Older download'));
  await sync;
  assert.deepEqual(await cache.get('saved'), lesson(3, 'Newer detail body'));
});

test('an old-account download cannot overwrite the next account after sign-out', async () => {
  const cache = makeCache();
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const oldSync = refreshSavedConcepts(['saved'], cache, () => response, () => true);
  await cache.clear();
  await cache.set('saved', lesson(4, 'New account copy'));
  release(lesson(2, 'Old account response'));
  await oldSync;
  assert.deepEqual(await cache.get('saved'), lesson(4, 'New account copy'));
});
