import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withCompletedReview, withPendingProgress } from '../src/services/pendingProgress.ts';
import { MutationOutbox } from '../src/services/mutationOutbox.ts';

const state = {
  learned: [{conceptId:'known',date:'2026-09-12'}], assignment:null,
  followedTopics:[],likes:[],bookmarks:[],
  stats:{current:8,longest:10,totalLearned:25,totalReviews:2},
  serverDaily:{status:'review',stale:false,payload:{review_id:'review-1',assigned_for:'2026-09-13',learned:false,concept:{slug:'known'}}},
};
test('review completion advances activity once and leaves unique learning untouched', () => {
  const once=withCompletedReview(state,'review-1');
  assert.deepEqual(once.learned,state.learned);
  assert.deepEqual(once.stats,{current:9,longest:10,totalLearned:25,totalReviews:3});
  assert.equal(withCompletedReview(once,'review-1'),once);
  assert.equal(withCompletedReview(state,'different-review'),state);
});
test('pending completion survives stale refresh but cannot complete another day or review', () => {
  const queued=[{kind:'review',reviewId:'review-1',date:'2026-09-13'}];
  const once=withCompletedReview(state,'review-1');
  const merged=withPendingProgress(state,once,queued);
  assert.equal(merged.serverDaily.payload.learned,true);
  assert.equal(merged.stats.totalReviews,3);
  assert.equal(withPendingProgress(merged,once,queued).stats.totalReviews,3);
  const next={...state,serverDaily:{...state.serverDaily,payload:{...state.serverDaily.payload,review_id:'review-2'}}};
  assert.equal(withPendingProgress(next,once,queued).serverDaily.payload.learned,false);
});
test('review outbox survives restart, coalesces two taps, and clears on account change', async () => {
  const rows=new Map();
  const disk={getItem:async k=>rows.get(k)??null,setItem:async(k,v)=>rows.set(k,v),removeItem:async k=>rows.delete(k)};
  const first=new MutationOutbox(disk,'queue');
  const action={kind:'review',reviewId:'review-1',date:'2026-09-13'};
  await Promise.all([first.enqueue(action),first.enqueue(action)]);
  const restarted=new MutationOutbox(disk,'queue');
  assert.deepEqual(await restarted.pending(),[action]);
  await restarted.clear();
  assert.deepEqual(await restarted.pending(),[]);
});
