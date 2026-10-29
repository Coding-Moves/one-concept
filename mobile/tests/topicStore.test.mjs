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
  let resolve, reject;
  return { promise: new Promise((r, j) => { resolve=r; reject=j; }), resolve: (...args) => resolve(...args), reject: (...args) => reject(...args) };
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

test('last unfollow stays empty across a stale catalog reload and a new store', async () => {
  const { store, deps, calls } = setup();
  await store.load();
  await store.toggle('computer-science');
  assert.deepEqual(calls, [[]]);
  assert.equal(store.getSnapshot().some(topic => topic.following), false);
  await store.load();
  assert.equal(store.getSnapshot().some(topic => topic.following), false);
  const reopened = new TopicStore(deps);
  await reopened.load();
  assert.equal(reopened.getSnapshot().some(topic => topic.following), false);
});

test('a refresh cannot restore a stale follow while the last-unfollow enqueue is pending', async () => {
  const { store, deps } = setup();
  await store.load();
  const enqueued = deferred();
  const releaseEnqueue = deferred();
  deps.enqueue = async slugs => {
    enqueued.resolve();
    await releaseEnqueue.promise;
    deps.queued = slugs;
  };
  deps.pending = async () => deps.queued;

  const unfollow = store.toggle('computer-science');
  await enqueued.promise;
  const refresh = store.load();
  await tick();
  releaseEnqueue.resolve();
  await Promise.all([unfollow, refresh]);
  assert.equal(store.getSnapshot()[0].following, false);
});

test('a failed pending enqueue still rolls back when a refresh also fails offline', async () => {
  const { store, deps } = setup();
  await store.load();
  const enqueued = deferred();
  const releaseEnqueue = deferred();
  deps.enqueue = async () => {
    enqueued.resolve();
    await releaseEnqueue.promise;
  };
  deps.fetch = async () => { throw new Error('offline'); };

  const unfollow = store.toggle('computer-science');
  await enqueued.promise;
  const refresh = store.load();
  releaseEnqueue.reject(new Error('queue storage unavailable'));
  await assert.rejects(unfollow, /queue storage unavailable/);
  await refresh;
  assert.equal(store.getSnapshot()[0].following, true);
});

test('catalog cache failure cannot roll back a durable follow intent', async () => {
  const { store, deps, calls } = setup();
  await store.load();
  deps.write = async () => { throw new Error('catalog cache unavailable'); };
  await store.toggle('new-server-topic');
  assert.deepEqual(calls, [['computer-science', 'new-server-topic']]);
  assert.equal(store.getSnapshot()[1].following, true);
  const reopened = new TopicStore(deps);
  await reopened.load();
  assert.equal(reopened.getSnapshot()[1].following, true);
});

test('failed durable enqueue rolls back the visible topic choice', async () => {
  const { store, deps } = setup();
  await store.load();
  deps.enqueue = async () => { throw new Error('queue storage unavailable'); };
  await assert.rejects(store.toggle('new-server-topic'), /queue storage unavailable/);
  assert.equal(store.getSnapshot()[1].following, false);
});
