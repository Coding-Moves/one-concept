import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiConfigurationError, ApiError } from '../src/api/errors.ts';
import { classifyRecoveryError } from '../src/api/errorRecovery.ts';

test('recovery classifier never exposes API detail or exception message', () => {
  const error = new ApiError(503, 'postgres://secret@host', { detail: 'token=private' });
  const result = classifyRecoveryError(error);
  assert.equal(result.kind, 'service_unavailable');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('recovery classifier maps every actionable transport category', () => {
  assert.equal(classifyRecoveryError(new ApiError(0, 'network')).kind, 'offline');
  assert.equal(classifyRecoveryError(new ApiError(429, 'wait')).kind, 'rate_limited');
  assert.equal(classifyRecoveryError(new ApiError(401, 'expired')).kind, 'session_expired');
  assert.equal(classifyRecoveryError(new ApiError(404, 'missing')).kind, 'not_found');
  assert.equal(classifyRecoveryError(new ApiConfigurationError()).kind, 'configuration');
  assert.equal(classifyRecoveryError(new Error('token=private')).kind, 'unknown');
});
