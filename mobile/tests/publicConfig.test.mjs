import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { publicConfigErrors, validUrl } from '../public-config.cjs';

test('missing and malformed endpoint configuration cannot be mistaken for offline', () => {
  for (const value of [undefined, '', ' ', '/api', 'ftp://host', 'https://user:pass@host', 'https://host?q=x', 'https://host#x']) {
    assert.equal(validUrl(value), false, String(value));
  }
  assert.equal(validUrl('http://127.0.0.1:4781/api'), true);
  assert.equal(validUrl('https://api.example.org'), true);
});

test('release validation rejects local/http endpoints and missing auth configuration', () => {
  const env = { EXPO_PUBLIC_API_BASE_URL: 'https://api.example.org', EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'test-public-key' };
  assert.deepEqual(publicConfigErrors(env, true), []);
  for (const endpoint of ['http://api.example.org', 'https://localhost', 'https://test.invalid']) {
    assert.ok(publicConfigErrors({ ...env, EXPO_PUBLIC_API_BASE_URL: endpoint }, true).length);
  }
  assert.ok(publicConfigErrors({ ...env, EXPO_PUBLIC_SUPABASE_ANON_KEY: '' }, true).length);
  const childEnv = { ...process.env, ...env, EXPO_PUBLIC_API_BASE_URL: '' };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['scripts/validate-public-config.cjs', '--release'], { env: childEnv, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EXPO_PUBLIC_API_BASE_URL/);
  assert.doesNotMatch(result.stderr, /test-public-key/);
});
