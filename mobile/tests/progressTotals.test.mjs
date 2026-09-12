import assert from 'node:assert/strict';
import { test } from 'node:test';
import { learnedTopicCounts } from '../src/services/progressTotals.ts';
import { withPendingProgress } from '../src/services/pendingProgress.ts';

test('compact totals include older topics and an offline completion exactly once', () => {
  const record = {conceptId:'today', date:'2026-09-12', topicName:'Computer Science'};
  const server = {
    learned:[{conceptId:'yesterday', date:'2026-09-11', topicName:'Computer Science'}],
    learnedBeforeWindow:{'Computer Science':314, Mathematics:50},
    assignment:{conceptId:'today',date:'2026-09-12'}, likes:[],bookmarks:[],followedTopics:[],
    stats:{current:1,longest:1,totalLearned:365},
  };
  const previous = {...server, learned:[...server.learned,record],
    stats:{...server.stats,totalLearned:366}};
  const pending = [{kind:'learn',date:'2026-09-12'}];
  const once = withPendingProgress(server, previous, pending);
  const twice = withPendingProgress(once, previous, pending);
  assert.deepEqual(learnedTopicCounts(twice.learned,twice.learnedBeforeWindow),
    new Map([['Computer Science',316],['Mathematics',50]]));
  assert.equal(twice.stats.totalLearned,366);
  assert.deepEqual(server.learnedBeforeWindow,{'Computer Science':314,Mathematics:50});
});

test('legacy state still derives categories from its complete learned list', () => {
  assert.deepEqual(learnedTopicCounts([{topicName:'Mathematics'},{topicName:'Mathematics'},{}]),
    new Map([['Mathematics',2]]));
});
