import assert from 'node:assert/strict';
import test from 'node:test';
import { workerSetting } from './worker_settings.ts';

test('staging canary settings affect the worker only', () => {
  const values = new Map([
    ['GENERATION_ENABLED', 'false'],
    ['WORKER_CANARY_GENERATION_ENABLED', 'true'],
  ]);
  const get = name => values.get(name);
  assert.equal(workerSetting('staging', 'GENERATION_ENABLED', get), 'true');
  assert.equal(workerSetting('production', 'GENERATION_ENABLED', get), 'false');
  assert.equal(workerSetting('development', 'GENERATION_ENABLED', get), 'false');
});

test('missing staging override uses the ordinary worker setting', () => {
  assert.equal(workerSetting('staging', 'EDITORIAL_ENABLED', name =>
    name === 'EDITORIAL_ENABLED' ? 'true' : undefined), 'true');
});
