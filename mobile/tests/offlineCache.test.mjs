import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfflineCache } from '../src/services/offlineCache.ts';

function disk() {
  const rows = new Map();
  return { rows, getItem: async k => rows.get(k) ?? null,
    setItem: async (k, v) => { rows.set(k, v); },
    getAllKeys: async () => [...rows.keys()],
    multiRemove: async keys => { keys.forEach(k => rows.delete(k)); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  return { promise: new Promise(r => { resolve = r; }), resolve: (...args) => resolve(...args) };
}

test('full lesson text survives a new cache instance and corrupt entries do not block other lessons', async () => {
  const storage = disk();
  const cache = new OfflineCache(storage, 'lessons/');
  const lesson = { id: 'saved', summary: 'Full explanation', example: 'Concrete example' };
  await cache.set(lesson.id, lesson);
  storage.rows.set('lessons/corrupt', '{');
  const reopened = new OfflineCache(storage, 'lessons/');
  assert.deepEqual(await reopened.get('saved'), lesson);
  assert.equal(await reopened.get('corrupt'), null);
});

test('sign-out removes pending disk writes and rejects late downloads without deleting device preferences', async () => {
  const storage = disk();
  const started = deferred(), finish = deferred();
  storage.setItem = async (k, v) => { started.resolve(); await finish.promise; storage.rows.set(k, v); };
  storage.rows.set('theme', 'dark');
  const cache = new OfflineCache(storage, 'lessons/');
  const oldAccount = cache.epoch;
  const write = cache.set('saved', { summary:'old account' }, oldAccount);
  await started.promise;
  const clear = cache.clear();
  const lateDownload = cache.set('late', { summary:'late old account' }, oldAccount);
  finish.resolve();
  await Promise.all([write, clear, lateDownload]);
  assert.deepEqual([...storage.rows], [['theme', 'dark']]);
  await cache.set('new', { summary:'new account' });
  assert.deepEqual(await cache.get('new'), { summary:'new account' });
});

test('sign-out suppresses a disk read already in flight', async () => {
  const storage = disk(), response = deferred();
  storage.getItem = () => response.promise;
  const cache = new OfflineCache(storage, 'lessons/');
  const read = cache.get('old');
  await tick();
  await cache.clear();
  response.resolve(JSON.stringify({summary:'old account'}));
  assert.equal(await read, null);
});

test('failed storage writes do not poison subsequent downloads or cleanup', async () => {
  const storage = disk();
  const put = storage.setItem;
  storage.setItem = async () => { throw new Error('disk full'); };
  const cache = new OfflineCache(storage, 'lessons/');
  await assert.rejects(cache.set('one', {summary:'one'}));
  storage.setItem = put;
  await cache.set('two', {summary:'two'});
  assert.deepEqual(await cache.get('two'), {summary:'two'});
  await cache.clear();
  assert.equal(await cache.get('two'), null);
});
