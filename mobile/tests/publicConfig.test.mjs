import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { publicConfigErrors, validUrl } from '../public-config.cjs';

const validConfiguration = {
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.org',
  EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'test-public-key',
};

test('missing or malformed public URLs are invalid before publication', () => {
  for (const value of [undefined, '', ' ', '/api', 'ftp://host', 'https://user:pass@host', 'https://host?q=x', 'https://host#x']) {
    assert.equal(validUrl(value), false, String(value));
  }
  assert.equal(validUrl('http://127.0.0.1:4781/api'), true);
  assert.equal(validUrl('https://api.example.org'), true);
});

test('release validation rejects non-public URLs and missing authentication configuration', () => {
  assert.deepEqual(publicConfigErrors(validConfiguration, true), []);
  for (const endpoint of ['http://api.example.org', 'https://localhost', 'https://test.invalid']) {
    assert.ok(publicConfigErrors({ ...validConfiguration, EXPO_PUBLIC_API_BASE_URL: endpoint }, true).length);
  }
  assert.ok(publicConfigErrors({ ...validConfiguration, EXPO_PUBLIC_SUPABASE_ANON_KEY: '' }, true).length);
});

test('validator fails safely without exposing a supplied public key', () => {
  const env = { ...process.env, ...validConfiguration, EXPO_PUBLIC_API_BASE_URL: '' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['scripts/validate-public-config.cjs', '--release'], {
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EXPO_PUBLIC_API_BASE_URL/);
  assert.doesNotMatch(result.stderr, /test-public-key/);
});
