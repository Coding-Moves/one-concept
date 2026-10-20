import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mailSetupStatus, sendEditorialMail } from './editorial_mail.ts';

const batch = { id: '11111111-1111-4111-8111-111111111111',
  recipient_email: 'reviewer@example.test',
  subject: 'One Concept: assigned lessons to review',
  body: 'One lesson to review.\nhttps://review.example.test/?view=review&kind=revisions&id=22222222-2222-4222-8222-222222222222' };
const config = { enabled: true, environment: 'production', testRecipients: new Set(),
  dashboardOrigin: 'https://review.example.test',
  allowedOrigins: new Set(['https://review.example.test']), from: 'editor@example.test',
  clientId: 'test-client', clientSecret: 'test-secret', refreshToken: 'test-refresh' };

test('Gmail OAuth then MIME send succeeds without leaking credentials into body', async () => {
  const calls = [];
  const result = await sendEditorialMail(async (url, options) => {
    calls.push({ url, options });
    return url.includes('oauth2.googleapis.com')
      ? Response.json({ access_token: 'test-access' })
      : Response.json({ id: 'gmail-message-id' });
  }, batch, config);
  assert.deepEqual(result, { state: 'sent', code: null });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.authorization, 'Bearer test-access');
  const raw = JSON.parse(calls[1].options.body).raw;
  assert.equal(raw.includes('test-secret'), false);
  assert.match(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), /Message-ID: <11111111-1111-4111-8111-111111111111@example.test>/);
});

test('expired OAuth token is terminal; temporary OAuth failure retries', async () => {
  const invalid = await sendEditorialMail(async () => new Response('', { status: 401 }), batch, config);
  assert.deepEqual(invalid, { state: 'failed', code: 'sender_authorization' });
  const temporary = await sendEditorialMail(async () => new Response('', { status: 503 }), batch, config);
  assert.deepEqual(temporary, { state: 'pending', code: 'provider_temporary' });
});

test('unknown Gmail acceptance stays retryable under the existing at-least-once policy', async () => {
  const result = await sendEditorialMail(async url => {
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'token' });
    throw new Error('timeout');
  }, batch, config);
  assert.deepEqual(result, { state: 'pending', code: 'delivery_unknown' });
});

test('staging rejects recipient outside explicit test list before provider I/O', async () => {
  const stage = { ...config, environment: 'staging', testRecipients: new Set(['other@example.test']) };
  const result = await sendEditorialMail(async () => { throw new Error('must not call provider'); }, batch, stage);
  assert.deepEqual(result, { state: 'failed', code: 'staging_blocked' });
  assert.equal(mailSetupStatus({ ...stage, testRecipients: new Set() }), 'test_recipients_required');
});

test('staging email identifies itself and has no live review button', async () => {
  const stage = { ...config, environment: 'staging',
    testRecipients: new Set([batch.recipient_email]) };
  let mime = '';
  const result = await sendEditorialMail(async (url, options) => {
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'token' });
    const raw = JSON.parse(options.body).raw;
    mime = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    return Response.json({ id: 'gmail-message-id' });
  }, batch, stage);
  assert.equal(result.state, 'sent');
  assert.equal(mime.includes('STAGING DELIVERY TEST'), false); // MIME parts are base64 encoded.
  const htmlPart = mime.split('Content-Type: text/html; charset=UTF-8')[1];
  const html = atob(htmlPart.split('\r\n\r\n')[1].split('\r\n')[0]);
  assert.match(html, /STAGING DELIVERY TEST/);
  assert.equal(html.includes('<a href='), false);
});
