import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withPendingProgress } from '../src/services/pendingProgress.ts';

const server={learned:[],assignment:{conceptId:'today',date:'2026-09-12'},followedTopics:[],likes:['liked'],bookmarks:[],savedConcepts:[],stats:{current:0,longest:2,totalLearned:2}};
test('a server refresh after a retryable error preserves pending unlike and saved metadata', () => {
  const saved={conceptId:'today',title:'Today',topicName:'Computer Science'};
  const previous={...server,likes:[],bookmarks:['today'],savedConcepts:[saved]};
  const next=withPendingProgress(server,previous,[{kind:'like',slug:'liked',desired:false},{kind:'save',slug:'today',desired:true}]);
  assert.deepEqual(next.likes,[]);
  assert.deepEqual(next.bookmarks,['today']);
  assert.deepEqual(next.savedConcepts,[saved]);
  assert.deepEqual(server.likes,['liked']);
});
test('unacknowledged unsave hides its server row and acknowledged changes use fresh state', () => {
  const saved={conceptId:'saved',title:'Saved',topicName:'Computer Science'};
  const state={...server,bookmarks:['saved'],savedConcepts:[saved]};
  const next=withPendingProgress(state,state,[{kind:'save',slug:'saved',desired:false}]);
  assert.deepEqual(next.savedConcepts,[]);
  assert.deepEqual(next.bookmarks,[]);
  assert.equal(withPendingProgress(state,next,[]),state);
});
test('preserves same-day offline completion without duplicating or backdating it', () => {
  const record={conceptId:'today',date:'2026-09-12'};
  const previous={...server,learned:[record],stats:{current:1,longest:2,totalLearned:3}};
  const queued=[{kind:'learn',date:'2026-09-12'}];
  const next=withPendingProgress(server,previous,queued);
  assert.deepEqual(next.learned,[record]);
  assert.equal(next.stats.totalLearned,3);
  assert.deepEqual(withPendingProgress(next,previous,queued).learned,[record]);
  assert.deepEqual(withPendingProgress({...server,assignment:{conceptId:'next',date:'2026-09-13'}},previous,queued).learned,[]);
});
