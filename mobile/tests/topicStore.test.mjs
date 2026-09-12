import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TopicStore } from '../src/services/topicStore.ts';

const topics = [
  {slug:'computer-science',name:'Computer Science',conceptCount:25,following:true},
  {slug:'new-server-topic',name:'New server topic',conceptCount:12,following:false},
];
function setup() {
  let cached = null, queued;
  const calls = [];
  const deps = { read: async () => cached, write: async rows => { cached=rows; },
    fetch: async () => topics, pending: async () => queued,
    enqueue: async slugs => { queued=slugs; calls.push(slugs); } };
  return { deps, calls, store: new TopicStore(deps) };
}
function deferred() {
  let resolve;
  return { promise: new Promise(r => { resolve=r; }), resolve: (...args) => resolve(...args) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('offline dynamic topic follows survive restart and override stale server state until synced', async () => {
  const {store, deps, calls} = setup();
  await store.load();
  deps.fetch = async () => { throw new Error('offline'); };
  await store.toggle('new-server-topic');
  assert.deepEqual(calls, [['computer-science','new-server-topic']]);
  const reopened = new TopicStore(deps);
  await reopened.load();
  assert.equal(reopened.getSnapshot()[1].following, true);
  deps.fetch = async () => topics;
  await reopened.load();
  assert.equal(reopened.getSnapshot()[1].following, true);
});

test('rapid toggles preserve the complete followed set and stale catalog loads cannot undo them', async () => {
  const {store, deps, calls} = setup();
  await store.load();
  const response = deferred();
  deps.fetch = () => response.promise;
  const loading = store.load();
  await tick();
  await Promise.all([store.toggle('new-server-topic'),store.toggle('computer-science')]);
  response.resolve(topics);
  await loading;
  assert.deepEqual(calls.at(-1), ['new-server-topic']);
  assert.deepEqual(store.getSnapshot().map(t=>t.following), [false,true]);
});

test('cached catalog paints before a stalled fetch completes', async () => {
  const {store, deps} = setup();
  await store.load();
  const response = deferred();
  deps.fetch = () => response.promise;
  const reopened = new TopicStore(deps);
  const loading = reopened.load();
  await tick();
  assert.deepEqual(reopened.getSnapshot(), topics);
  response.resolve(topics);
  await loading;
});

test('account reset suppresses late topic fetches and queued follow writes', async () => {
  const {store, deps, calls} = setup();
  await store.load();
  const response = deferred();
  deps.fetch = () => response.promise;
  const loading = store.load();
  await tick();
  const write = store.toggle('new-server-topic');
  store.reset();
  response.resolve(topics);
  await Promise.all([loading,write]);
  assert.deepEqual(store.getSnapshot(), []);
  assert.deepEqual(calls, []);
});
