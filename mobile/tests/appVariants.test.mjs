import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagingGoogleServicesErrors } from '../scripts/validate-google-services.cjs';

function configFor(variant) {
  const env = { ...process.env, APP_VARIANT: variant };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./app.config.js").expo))'], {
    cwd: process.cwd(), env, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('staging and production can install beside each other and cannot receive each other\'s runtime', () => {
  const production = configFor('production');
  const staging = configFor('staging');
  assert.equal(production.name, 'One Concept');
  assert.equal(production.android.package, 'com.codingmoves.oneconcept');
  assert.equal(production.ios.bundleIdentifier, 'com.codingmoves.oneconcept');
  assert.equal(production.android.googleServicesFile, './google-services.json');
  assert.equal(production.runtimeVersion, '1.10.19');
  assert.equal(production.scheme, 'com.codingmoves.oneconcept');
  assert.equal(staging.name, 'One Concept Staging');
  assert.equal(staging.android.package, 'com.codingmoves.oneconcept.staging');
  assert.equal(staging.ios.bundleIdentifier, 'com.codingmoves.oneconcept.staging');
  assert.equal(staging.scheme, 'com.codingmoves.oneconcept.staging');
  assert.equal(staging.android.googleServicesFile, './google-services.staging.json');
  assert.notEqual(staging.runtimeVersion, production.runtimeVersion);
  assert.equal(staging.extra.appVariant, 'staging');
  assert.equal(staging.extra.eas.projectId, production.extra.eas.projectId);
});

test('a mistyped variant cannot silently fall back to production', () => {
  const env = { ...process.env, APP_VARIANT: 'stagng' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['-e', 'require("./app.config.js")'], {
    cwd: process.cwd(), env, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APP_VARIANT/);
});

test('EAS build profiles bind staging identity to preview updates only', () => {
  const build = JSON.parse(readFileSync('eas.json', 'utf8')).build;
  assert.equal(build.preview.env.APP_VARIANT, 'staging');
  assert.equal(build.preview.env.EXPO_PUBLIC_APP_VARIANT, 'staging');
  assert.equal(build.preview.environment, 'preview');
  assert.equal(build.preview.channel, 'preview');
  assert.equal(build['staging-development'].extends, 'development');
  assert.equal(build.development.env.APP_VARIANT, 'staging');
  assert.equal(build.development.environment, 'preview');
  assert.equal(build.development.channel, 'preview');
  assert.equal(build.development.developmentClient, true);
  assert.equal(build.production.env.APP_VARIANT, 'production');
  assert.equal(build.production.env.EXPO_PUBLIC_APP_VARIANT, 'production');
  assert.equal(build.production.environment, 'production');
  assert.equal(build.production.channel, 'production');
});

test('staging builds reject a Firebase file that only registers production', () => {
  const dir = mkdtempSync(join(tmpdir(), 'one-concept-firebase-'));
  const file = join(dir, 'google-services.json');
  try {
    assert.ok(stagingGoogleServicesErrors(file).length);
    writeFileSync(file, JSON.stringify({ client: [{ client_info: { android_client_info: { package_name: 'com.codingmoves.oneconcept' } } }] }));
    assert.ok(stagingGoogleServicesErrors(file).length);
    writeFileSync(file, JSON.stringify({ client: [{ client_info: { android_client_info: { package_name: 'com.codingmoves.oneconcept.staging' } } }] }));
    assert.deepEqual(stagingGoogleServicesErrors(file), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
