import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authLandingUrl } from '../src/services/authRedirect.ts';

test('builds confirmation and recovery landings on the browser website', () => {
  assert.equal(authLandingUrl('confirmed', 'https://web.example.org'), 'https://web.example.org/confirmed');
  assert.equal(authLandingUrl('reset-password', 'https://web.example.org/'), 'https://web.example.org/reset-password');
  assert.equal(authLandingUrl('confirmed', 'https://api.example.org/functions/v1/api'), undefined);
});

test('never passes a malformed or credential-bearing redirect to Supabase', () => {
  for (const baseUrl of ['', 'not a url', 'ftp://api.example.org', 'https://user:pass@api.example.org', 'https://api.example.org?x=1']) {
    assert.equal(authLandingUrl('confirmed', baseUrl), undefined, baseUrl);
  }
});
