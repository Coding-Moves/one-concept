import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeAuthError } from '../src/services/authErrors.ts';

test('network and native transport errors produce friendly connection advice', () => {
  for (const error of [
    new TypeError('Failed to fetch'),
    new Error('java.net.UnknownHostException: Unable to resolve host'),
    { name: 'AuthRetryableFetchError', message: 'internal trace' },
    { name: 'AbortError', message: 'aborted' },
  ]) {
    assert.equal(describeAuthError(error), 'Could not connect. Check your internet connection and try again.');
  }
});

test('unknown errors never render internal diagnostics', () => {
  for (const error of [new Error('SECRET_INTERNAL_TRACE'), null, 'raw error', {}]) {
    assert.equal(describeAuthError(error), 'Could not complete that request. Please try again in a moment.');
  }
});

test('invalid credentials and confirmation retain actionable guidance', () => {
  assert.match(describeAuthError({ message: 'Invalid login credentials' }), /did not match/);
  assert.match(describeAuthError({ message: 'Email not confirmed' }), /Confirm your email/);
  assert.match(describeAuthError({ status: 429 }), /Too many attempts/);
});
