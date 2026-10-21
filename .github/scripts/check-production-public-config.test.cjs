const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { productionConfigReady } = require('./check-production-public-config.cjs');

const production = {
  EXPO_PUBLIC_API_BASE_URL: 'https://egdszjoesxlccauahmsx.supabase.co/functions/v1/api',
  EXPO_PUBLIC_SUPABASE_URL: 'https://egdszjoesxlccauahmsx.supabase.co',
};

test('production OTA accepts only the matching production API and Auth project', () => {
  assert.equal(productionConfigReady(production), true);
  assert.equal(productionConfigReady({ ...production,
    EXPO_PUBLIC_API_BASE_URL: 'https://one-concept-production.up.railway.app' }), false);
  assert.equal(productionConfigReady({ ...production,
    EXPO_PUBLIC_API_BASE_URL: 'https://zhrulokgngjceqgjkcmw.supabase.co/functions/v1/api' }), false);
  assert.equal(productionConfigReady({ ...production,
    EXPO_PUBLIC_SUPABASE_URL: 'https://zhrulokgngjceqgjkcmw.supabase.co' }), false);
});

test('a failed production gate prints no configured URL or public key', () => {
  const result = spawnSync(process.execPath, ['.github/scripts/check-production-public-config.cjs'], {
    env: { ...process.env, ...production,
      EXPO_PUBLIC_API_BASE_URL: 'https://private.example.test/secret',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'do-not-print-this-key' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /private\.example\.test|do-not-print-this-key/);
});
