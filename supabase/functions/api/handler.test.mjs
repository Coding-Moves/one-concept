import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from './handler.ts';

const userId = 'b5a94932-62e0-4780-91c7-af48b93e27ab';
const config = {
  supabaseUrl: 'https://one-concept.supabase.co',
  anonKey: 'public-anon-key',
  serviceRoleKey: 'private-service-key',
  allowedOrigins: ['https://review.example.com'],
};
const request = (path, init = {}) => new Request(`https://one-concept.supabase.co/functions/v1/api${path}`, init);
const editorialToken = (claims) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

test('health probes the database and sets exact-origin CORS', async () => {
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    return Response.json({ status: 'ok', database: 'reachable' });
  });
  const result = await handler(request('/health', { headers: { origin: 'https://review.example.com' } }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { status: 'ok', database: 'reachable' });
  assert.equal(result.headers.get('access-control-allow-origin'), 'https://review.example.com');
  assert.equal(result.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/edge_api_health$/);
  assert.equal(calls[0].init.headers.apikey, config.serviceRoleKey);
});

test('an unapproved browser origin never reaches Supabase', async () => {
  const handler = createHandler(config, () => { throw Error('must not fetch'); });
  const result = await handler(request('/health', { headers: { origin: 'https://evil.example' } }));
  assert.equal(result.status, 403);
  assert.equal(result.headers.get('access-control-allow-origin'), null);
});

test('preflight uses an exact allowed origin', async () => {
  const handler = createHandler(config, () => { throw Error('must not fetch'); });
  const result = await handler(request('/v1/topics', { method: 'OPTIONS', headers: { origin: 'https://review.example.com' } }));
  assert.equal(result.status, 204);
  assert.match(result.headers.get('access-control-allow-headers'), /authorization/);
});

test('topics requires Auth verification and passes only its returned user ID to the service RPC', async () => {
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    return Response.json([{ id: 'topic-1', slug: 'software-engineering', following: true }]);
  });
  const missing = await handler(request('/v1/topics'));
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { detail: 'Missing bearer token' });
  assert.equal(missing.headers.get('www-authenticate'), 'Bearer');
  assert.equal(calls.length, 0);
  const result = await handler(request('/v1/topics', { headers: { authorization: 'Bearer user-access-token' } }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), [{ id: 'topic-1', slug: 'software-engineering', following: true }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.apikey, config.anonKey);
  assert.equal(calls[0].init.headers.authorization, 'Bearer user-access-token');
  assert.equal(calls[1].init.headers.apikey, config.serviceRoleKey);
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_user_id: userId });
});

test('editorial me rechecks an Auth-verified session and server membership', async () => {
  const sessionId = 'a5a94932-62e0-4780-91c7-af48b93e27ab';
  const token = editorialToken({ sub: userId, session_id: sessionId, aal: 'aal1' });
  const calls = [];
  let payload = { member: { user_id: userId, require_mfa: true },
    onboarding_required: false, name_approval_pending: false, mfa_required: true };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    return Response.json(payload);
  };
  const disabled = createHandler(config, fetcher);
  assert.equal((await disabled(request('/v1/editorial/me', {
    headers: { authorization: `Bearer ${token}` },
  }))).status, 503);
  assert.equal(calls.length, 1);
  const handler = createHandler({ ...config, editorialEnabled: true }, fetcher);
  assert.equal((await handler(request('/v1/editorial/me'))).status, 401);
  const wrongSub = editorialToken({ sub: 'a5a94932-62e0-4780-91c7-af48b93e27ab', session_id: sessionId });
  assert.equal((await handler(request('/v1/editorial/me', {
    headers: { authorization: `Bearer ${wrongSub}` },
  }))).status, 401);
  const result = await handler(request('/v1/editorial/me', { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), payload);
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.match(calls.at(-1).url, /\/rpc\/edge_api_editorial_me$/);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), {
    p_user_id: userId, p_session_id: sessionId, p_aal: 'aal1',
  });
  payload = { error: 'session_required' };
  assert.equal((await handler(request('/v1/editorial/me', {
    headers: { authorization: `Bearer ${token}` },
  }))).status, 401);
  payload = { error: 'unavailable' };
  assert.equal((await handler(request('/v1/editorial/me', {
    headers: { authorization: `Bearer ${token}` },
  }))).status, 403);
});

test('weekly quiz selection uses the verified account and never exposes a private RPC result to anonymous callers', async () => {
  const calls = [];
  const quiz = { available: false, week_start: '2026-10-12', required_concepts: 7,
    available_concepts: 2, detail: 'Complete more concepts with reviewed questions to unlock this weekly quiz.' };
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    return Response.json(quiz);
  });
  assert.equal((await handler(request('/v1/quizzes/weekly'))).status, 401);
  assert.equal(calls.length, 0);
  const headers = { authorization: 'Bearer account-token' };
  const result = await handler(request('/v1/quizzes/weekly', { headers }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), quiz);
  assert.match(calls[1].url, /\/rpc\/edge_api_weekly_quiz$/);
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_user_id: userId });
  assert.equal((await handler(request('/v1/quizzes/weekly', { method: 'POST', headers }))).status, 405);
  assert.equal(calls.length, 2);
});

test('weekly attempts validate the complete answer set before account-scoped scoring', async () => {
  const quizId = 'a5a94932-62e0-4780-91c7-af48b93e27ab';
  const answers = Array.from({ length: 7 }, (_, i) => ({ question_id: `question-${i}`, selected_index: i % 4 }));
  const calls = [];
  let resultBody = { attempt_id: quizId, quiz_id: quizId, correct_count: 5, results: [] };
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    return Response.json(resultBody);
  });
  const path = `/v1/quizzes/weekly/${quizId}/attempts`;
  const headers = { authorization: 'Bearer account-token', 'content-type': 'application/json' };
  assert.equal((await handler(request(path, { method: 'POST', headers, body: JSON.stringify({ answers: [] }) }))).status, 422);
  assert.equal(calls.length, 1);
  assert.equal((await handler(request(path, { method: 'POST', headers,
    body: JSON.stringify({ answers: [...answers.slice(0, 6), answers[0]] }) }))).status, 422);
  assert.equal(calls.length, 2);
  const scored = await handler(request(path, { method: 'POST', headers, body: JSON.stringify({ answers }) }));
  assert.equal(scored.status, 200);
  assert.deepEqual(await scored.json(), resultBody);
  assert.match(calls[3].url, /\/rpc\/edge_api_submit_weekly_quiz$/);
  assert.deepEqual(JSON.parse(calls[3].init.body), { p_user_id: userId, p_quiz_id: quizId, p_answers: answers });
  resultBody = { error: 'invalid' };
  const changed = await handler(request(path, { method: 'POST', headers, body: JSON.stringify({ answers }) }));
  assert.equal(changed.status, 400);
  assert.deepEqual(await changed.json(), { detail: 'Answers must match this quiz exactly' });
  assert.equal((await handler(request(path, { headers }))).status, 405);
});

test('subtopic quiz selection uses only the owned completion and hides missing events', async () => {
  const completionId = 'a5a94932-62e0-4780-91c7-af48b93e27ab';
  const calls = [];
  let resultBody = { available: false, completion_id: completionId, reviewed_concepts: 1,
    required_concepts: 3, topic_name: 'Mathematics', subtopic_name: 'Probability',
    detail: 'This optional quiz will unlock when enough reviewed questions are available.' };
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    return Response.json(resultBody);
  });
  const path = `/v1/quizzes/subtopics/${completionId}`;
  assert.equal((await handler(request(path))).status, 401);
  assert.equal(calls.length, 0);
  const headers = { authorization: 'Bearer account-token' };
  const result = await handler(request(path, { headers }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), resultBody);
  assert.match(calls[1].url, /\/rpc\/edge_api_subtopic_quiz$/);
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_user_id: userId, p_completion_id: completionId });
  resultBody = { error: 'unavailable' };
  const missing = await handler(request(path, { headers }));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { detail: 'Completed subtopic not found' });
  assert.equal((await handler(request(path, { method: 'POST', headers }))).status, 405);
});

test('subtopic attempts validate variable quiz size and score only the verified account', async () => {
  const quizId = 'a5a94932-62e0-4780-91c7-af48b93e27ab';
  const calls = [];
  let payload = { attempt_id: quizId, quiz_id: quizId, correct_count: 2, question_count: 3, results: [] };
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    return Response.json(payload);
  });
  const path = `/v1/quizzes/subtopics/${quizId}/attempts`;
  const headers = { authorization: 'Bearer account-token', 'content-type': 'application/json' };
  const answers = Array.from({ length: 3 }, (_, i) => ({ question_id: `question-${i}`, selected_index: i }));
  assert.equal((await handler(request(path, { method: 'PUT', headers }))).status, 405);
  assert.equal((await handler(request(path, { method: 'POST', headers,
    body: JSON.stringify({ answers: [...answers.slice(0, 2), answers[0]] }) }))).status, 422);
  assert.equal(calls.length, 1);
  const result = await handler(request(path, { method: 'POST', headers, body: JSON.stringify({ answers }) }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), payload);
  assert.match(calls[2].url, /\/rpc\/edge_api_submit_subtopic_quiz$/);
  assert.deepEqual(JSON.parse(calls[2].init.body), { p_user_id: userId, p_quiz_id: quizId, p_answers: answers });
  payload = { error: 'unavailable' };
  const missing = await handler(request(path, { method: 'POST', headers, body: JSON.stringify({ answers }) }));
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { detail: 'Subtopic quiz not found' });
});

test('subtopic attempt history is bounded by an owned completion and hides unknown events', async () => {
  const completionId = 'a5a94932-62e0-4780-91c7-af48b93e27ab';
  const calls = [];
  let payload = { items: [{ attempt_id: completionId, correct_count: 2, question_count: 3 }] };
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    return Response.json(payload);
  });
  const path = `/v1/quizzes/subtopics/${completionId}/attempts`;
  assert.equal((await handler(request(path))).status, 401);
  assert.equal(calls.length, 0);
  const headers = { authorization: 'Bearer account-token' };
  const result = await handler(request(path, { headers }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), payload);
  assert.match(calls[1].url, /\/rpc\/edge_api_subtopic_quiz_attempts$/);
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_user_id: userId, p_completion_id: completionId });
  payload = { error: 'unavailable' };
  const missing = await handler(request(path, { headers }));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { detail: 'Completed subtopic not found' });
});

test('daily returns the verified account assignment or typed unavailable state', async () => {
  const calls = [];
  let payload = {
    assigned_for: '2026-10-15', assigned_at: '2026-10-15T08:00:00+00:00',
    completed_at: null, learned: false, outside_followed_topics: false,
    concept: { id: userId, slug: 'hash-tables' },
  };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(payload);
  });
  const headers = { authorization: 'Bearer account-token' };
  const selected = await handler(request('/v1/daily', { headers }));
  assert.equal(selected.status, 200);
  assert.deepEqual(await selected.json(), payload);
  assert.match(calls[0].url, /\/rpc\/edge_api_daily$/);
  assert.deepEqual(calls[0].args, {
    p_user_id: userId, p_low: 10, p_reserve: 60, p_active_days: 90, p_today: null,
  });
  payload = { assigned_for: '2026-10-16', reason: 'catalog_exhausted',
    detail: 'You have already been assigned every available concept.' };
  const unavailable = await handler(request('/v1/daily', { headers }));
  assert.equal(unavailable.status, 409);
  assert.deepEqual(await unavailable.json(), payload);
  assert.equal((await handler(request('/v1/daily', { method: 'POST', headers }))).status, 405);
});

test('daily completion is account-scoped and preserves the missing-assignment response', async () => {
  const calls = [];
  let body = { completed: true, assigned_for: '2026-10-15', stats: {
    current: 1, longest: 1, total_learned: 1, total_reviews: 0,
  }, subtopic_completion: null };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(body);
  });
  const headers = { authorization: 'Bearer account-token' };
  const completed = await handler(request('/v1/daily/complete', { method: 'POST', headers }));
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), body);
  assert.match(calls[0].url, /\/rpc\/edge_api_complete_daily$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_today: null });
  body = null;
  const missing = await handler(request('/v1/daily/complete', { method: 'POST', headers }));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    detail: 'No concept has been assigned recently. Fetch /v1/daily first.',
  });
  assert.equal((await handler(request('/v1/daily/complete', { headers }))).status, 405);
});

test('startup state uses verified identity, bounded supply settings, and private avatar signing', async () => {
  const ref = `avatars/${userId}/${'a'.repeat(32)}.jpg`;
  const calls = [];
  const state = { today: '2026-10-15', daily: null, daily_availability: 'review_available',
    avatar_ref: ref, avatar_url: null, learned: [], bookmarks: [] };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, init });
    if (url.includes('/storage/v1/object/sign/')) {
      return Response.json({ signedURL: `/object/sign/profile-avatars/${ref}?token=private-signature` });
    }
    return Response.json({ ...state });
  });
  const headers = { authorization: 'Bearer account-token' };
  const result = await handler(request('/v1/me/state?compact=true&reviews=true', { headers }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ...state,
    avatar_url: `${config.supabaseUrl}/storage/v1/object/sign/profile-avatars/${ref}?token=private-signature`,
  });
  assert.match(calls[0].url, /\/rpc\/edge_api_state$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_user_id: userId, p_compact: true, p_reviews: true,
    p_low: 10, p_reserve: 60, p_active_days: 90, p_today: null,
  });
  assert.equal(calls[1].init.headers.apikey, config.serviceRoleKey);
  assert.deepEqual(JSON.parse(calls[1].init.body), { expiresIn: 120 });
  const invalid = await handler(request('/v1/me/state?compact=maybe', { headers }));
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 2);
});

test('startup state never signs another account avatar key', async () => {
  let storageCalls = 0;
  const handler = createHandler(config, async (url) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (url.includes('/storage/v1/')) { storageCalls++; throw Error('must not sign'); }
    return Response.json({ avatar_ref: `avatars/${'b'.repeat(36)}/${'a'.repeat(32)}.jpg` });
  });
  const result = await handler(request('/v1/me/state', { headers: { authorization: 'Bearer account-token' } }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).avatar_url, null);
  assert.equal(storageCalls, 0);
});

test('topic follow replacement uses the verified account and keeps the state response', async () => {
  const calls = [];
  let payload = { followed_topics: ['software-engineering'], daily: null,
    daily_availability: 'available', avatar_ref: null, avatar_url: null };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(payload);
  });
  const headers = { authorization: 'Bearer account-token' };
  const updated = await handler(request('/v1/me/topics?compact=true', {
    method: 'PUT', headers, body: JSON.stringify({ topics: ['software-engineering'] }),
  }));
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), payload);
  assert.match(calls[0].url, /\/rpc\/edge_api_set_topics$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId,
    p_slugs: ['software-engineering'], p_compact: true, p_today: null });
  payload = { error: 'unknown_topics', topics: ['missing'] };
  const unknown = await handler(request('/v1/me/topics', {
    method: 'PUT', headers, body: JSON.stringify({ topics: ['missing'] }),
  }));
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { detail: "Unknown topics: ['missing']" });
  const invalid = await handler(request('/v1/me/topics', {
    method: 'PUT', headers, body: JSON.stringify({ topics: [null] }),
  }));
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 2);
  assert.equal((await handler(request('/v1/me/topics', { headers }))).status, 405);
});

test('profile edit validates the input, preserves timezone errors, and deletes only its old avatar', async () => {
  const oldRef = `avatars/${userId}/${'a'.repeat(32)}.jpg`;
  const calls = [];
  let payload = { state: { display_name: 'Muawiya', bio: null,
    avatar_ref: 'preset:aurora', avatar_url: null, daily: null }, old_avatar_ref: oldRef };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, init });
    return url.includes('/storage/v1/') ? Response.json({}) : Response.json(payload);
  });
  const headers = { authorization: 'Bearer account-token' };
  const updated = await handler(request('/v1/me?compact=true', {
    method: 'PATCH', headers, body: JSON.stringify({
      display_name: '  Muawiya  ', bio: '  ', avatar_preset: 'aurora',
      timezone: 'Asia/Karachi', initialize_timezone: true,
    }),
  }));
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), payload.state);
  assert.match(calls[0].url, /\/rpc\/edge_api_patch_profile$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_user_id: userId, p_display_name: 'Muawiya', p_has_bio: true, p_bio: null,
    p_avatar_preset: 'aurora', p_timezone: 'Asia/Karachi',
    p_initialize_timezone: true, p_compact: true, p_today: null,
  });
  assert.match(calls[1].url, /\/storage\/v1\/object\/profile-avatars$/);
  assert.equal(calls[1].init.headers.apikey, config.serviceRoleKey);
  assert.deepEqual(JSON.parse(calls[1].init.body), { prefixes: [oldRef] });

  payload = { error: 'unknown_timezone' };
  const timezone = await handler(request('/v1/me', {
    method: 'PATCH', headers, body: JSON.stringify({ timezone: 'Not/A/Zone' }),
  }));
  assert.equal(timezone.status, 400);
  assert.deepEqual(await timezone.json(), { detail: 'Unknown timezone' });
  assert.equal(calls.length, 3);
  const invalid = await handler(request('/v1/me', {
    method: 'PATCH', headers, body: JSON.stringify({ display_name: '  ' }),
  }));
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 3);
  assert.equal((await handler(request('/v1/me', { headers }))).status, 405);
});

test('analytics uses only the verified account and preserves the bounded read model', async () => {
  const calls = [];
  const payload = { total_concepts: 0, total_reviews: 0, weekly_quiz_attempts: 0,
    active_days: 0, recent_concepts: [], recent_quizzes: [],
    activity: Array.from({ length: 28 }, (_, index) => ({ day: `2026-10-${String(index + 1).padStart(2, '0')}` })),
    topics: [], subtopics: [], achievements: [] };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(payload);
  });
  const headers = { authorization: 'Bearer account-token' };
  const result = await handler(request('/v1/me/analytics', { headers }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), payload);
  assert.match(calls[0].url, /\/rpc\/edge_api_analytics$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId });
  assert.equal((await handler(request('/v1/me/analytics', { method: 'POST', headers }))).status, 405);
  assert.equal(calls.length, 1);
});

test('sharing settings are private, versioned, and reject unearned selections', async () => {
  const calls = [];
  let payload = { enabled: false, show_name: false, show_avatar: false,
    show_bio: false, show_streak: false, show_learning: false,
    achievement_codes: [], version: 0, public_path: null };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(payload);
  });
  const headers = { authorization: 'Bearer account-token' };
  const missing = await handler(request('/v1/me/profile-sharing'));
  assert.equal(missing.status, 401);
  assert.equal(calls.length, 0);
  const current = await handler(request('/v1/me/profile-sharing', { headers }));
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), payload);
  assert.match(calls[0].url, /\/rpc\/edge_api_sharing_get$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId });
  assert.equal(current.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal(current.headers.get('referrer-policy'), 'no-referrer');

  payload = { ...payload, enabled: true, show_bio: true, version: 1, public_path: `/p/${'a'.repeat(43)}` };
  const changed = await handler(request('/v1/me/profile-sharing', {
    method: 'PUT', headers, body: JSON.stringify({ enabled: true, show_bio: true,
      achievement_codes: [], version: 0 }),
  }));
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), payload);
  assert.match(calls[1].url, /\/rpc\/edge_api_sharing_put$/);
  assert.deepEqual(calls[1].args, {
    p_user_id: userId, p_enabled: true, p_show_name: false,
    p_show_avatar: false, p_show_bio: true, p_show_streak: false,
    p_show_learning: false, p_codes: [], p_version: 0,
  });

  payload = { error: 'version_conflict' };
  const stale = await handler(request('/v1/me/profile-sharing', {
    method: 'PUT', headers, body: JSON.stringify({ version: 0 }),
  }));
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { detail: 'Settings changed. Reload before saving.' });
  payload = { error: 'unearned_achievements' };
  const unearned = await handler(request('/v1/me/profile-sharing', {
    method: 'PUT', headers, body: JSON.stringify({ version: 1, achievement_codes: ['concept_1'] }),
  }));
  assert.equal(unearned.status, 422);
  assert.deepEqual(await unearned.json(), { detail: 'Only earned achievements can be shared' });
  for (const body of [{ version: -1 }, { version: 1, enabled: 'yes' },
    { version: 1, achievement_codes: [null] }, { version: 1, other_account: userId }]) {
    const invalid = await handler(request('/v1/me/profile-sharing', {
      method: 'PUT', headers, body: JSON.stringify(body),
    }));
    assert.equal(invalid.status, 422);
  }
  assert.equal(calls.length, 4);
  assert.equal((await handler(request('/v1/me/profile-sharing', { method: 'POST', headers }))).status, 405);
});

test('public profile is anonymous, field-filtered, and never exposes the private avatar key', async () => {
  const token = 'a'.repeat(43);
  const key = `avatars/${userId}/${'b'.repeat(32)}.jpg`;
  const calls = [];
  let payload = { profile: { achievements: [{ name: 'First concept', description: 'Learned one',
    internal_code: 'concept_1' }], bio: 'Selected bio', hidden_email: 'private@example.invalid' },
    avatar_key: key, avatar_owner: userId };
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/storage/v1/object/sign/')) {
      return Response.json({ signedURL: `/object/sign/profile-avatars/${key}?token=temporary` });
    }
    if (url.endsWith('/auth/v1/user')) throw Error('anonymous route must not authenticate');
    return Response.json(payload);
  });
  const shown = await handler(request(`/v1/public-profiles/${token}`));
  assert.equal(shown.status, 200);
  assert.deepEqual(await shown.json(), { achievements: [{ name: 'First concept', description: 'Learned one' }],
    bio: 'Selected bio', avatar_url: `${config.supabaseUrl}/storage/v1/object/sign/profile-avatars/${key}?token=temporary` });
  assert.match(calls[0].url, /\/rpc\/edge_api_public_profile$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_token: token });
  assert.equal(shown.headers.get('cache-control'), 'no-store');
  assert.equal(shown.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal(shown.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(shown.headers.get('x-content-type-options'), 'nosniff');

  payload = null;
  const revoked = await handler(request(`/v1/public-profiles/${token}`));
  assert.equal(revoked.status, 404);
  assert.deepEqual(await revoked.json(), { detail: 'Profile unavailable' });
  const invalid = await handler(request('/v1/public-profiles/bad-token'));
  assert.equal(invalid.status, 404);
  assert.equal(calls.length, 3);
  assert.equal((await handler(request(`/v1/public-profiles/${token}`, { method: 'POST' }))).status, 405);
});

test('public profile signs only an owner-matching private avatar key', async () => {
  const token = 'c'.repeat(43);
  let storageCalls = 0;
  const handler = createHandler(config, async url => {
    if (url.includes('/storage/v1/')) { storageCalls++; throw Error('must not sign'); }
    return Response.json({ profile: { achievements: [] },
      avatar_key: `avatars/${'d'.repeat(36)}/${'e'.repeat(32)}.jpg`, avatar_owner: userId });
  });
  const result = await handler(request(`/v1/public-profiles/${token}`));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { achievements: [] });
  assert.equal(storageCalls, 0);
});

test('connection settings use verified identity and reject stale or malformed writes', async () => {
  const calls = [];
  let payload = { accepting_requests: false, version: 0 };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(payload);
  });
  const headers = { authorization: 'Bearer account-token' };
  assert.equal((await handler(request('/v1/me/connections/settings'))).status, 401);
  const current = await handler(request('/v1/me/connections/settings', { headers }));
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), payload);
  assert.match(calls[0].url, /\/rpc\/edge_api_connection_settings_get$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId });
  payload = { accepting_requests: true, version: 1 };
  const updated = await handler(request('/v1/me/connections/settings', {
    method: 'PUT', headers, body: JSON.stringify({ accepting_requests: true, version: 0 }),
  }));
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), payload);
  assert.match(calls[1].url, /\/rpc\/edge_api_connection_settings_put$/);
  assert.deepEqual(calls[1].args, { p_user_id: userId, p_accepting: true, p_version: 0 });
  payload = { error: 'version_conflict' };
  const stale = await handler(request('/v1/me/connections/settings', {
    method: 'PUT', headers, body: JSON.stringify({ accepting_requests: false, version: 0 }),
  }));
  assert.equal(stale.status, 409);
  assert.equal(stale.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.deepEqual(await stale.json(), { detail: 'Settings changed. Reload before saving.' });
  for (const body of [{ accepting_requests: 'yes', version: 0 },
    { accepting_requests: true, version: -1 },
    { accepting_requests: true, version: 0, other_user: userId }]) {
    assert.equal((await handler(request('/v1/me/connections/settings', {
      method: 'PUT', headers, body: JSON.stringify(body),
    }))).status, 422);
  }
  assert.equal(calls.length, 3);
  assert.equal((await handler(request('/v1/me/connections/settings', {
    method: 'POST', headers,
  }))).status, 405);
});

test('connection list scopes kind and cursor to the verified account', async () => {
  const cursor = '00000000-0000-4000-8000-000000000001';
  const calls = [];
  const page = { items: [{ id: cursor, display_name: 'Private learner', public_path: null }],
    next_cursor: null };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(page);
  });
  const headers = { authorization: 'Bearer account-token' };
  assert.equal((await handler(request('/v1/me/connections'))).status, 401);
  const listed = await handler(request(`/v1/me/connections?kind=blocked&cursor=${cursor}&limit=1`, { headers }));
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), page);
  assert.equal(listed.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(calls[0].url, /\/rpc\/edge_api_connections$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId,
    p_kind: 'blocked', p_cursor: cursor, p_limit: 1 });
  const defaultPage = await handler(request('/v1/me/connections', { headers }));
  assert.equal(defaultPage.status, 200);
  assert.deepEqual(calls[1].args, { p_user_id: userId,
    p_kind: 'accepted', p_cursor: null, p_limit: 25 });
  for (const query of ['kind=unknown', 'cursor=bad', 'limit=0', 'limit=51']) {
    assert.equal((await handler(request(`/v1/me/connections?${query}`, { headers }))).status, 422);
  }
  assert.equal(calls.length, 2);
  assert.equal((await handler(request('/v1/me/connections', { method: 'POST', headers }))).status, 405);
});

test('connection status uses only the verified account and a valid shared token', async () => {
  const token = 's'.repeat(43);
  const calls = [];
  const status = { id: null, state: 'available', retry_after: null };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(status);
  });
  const headers = { authorization: 'Bearer account-token' };
  assert.equal((await handler(request(`/v1/me/connections/with/${token}`))).status, 401);
  const result = await handler(request(`/v1/me/connections/with/${token}`, { headers }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.deepEqual(await result.json(), status);
  assert.match(calls[0].url, /\/rpc\/edge_api_connection_status$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_token: token });
  assert.equal((await handler(request('/v1/me/connections/with/bad', { headers }))).status, 404);
  assert.equal(calls.length, 1);
});

test('connection requests preserve pair status, privacy, and retry headers', async () => {
  const token = 'r'.repeat(43);
  const calls = [];
  let payload = { id: '00000000-0000-4000-8000-000000000001', state: 'outgoing', retry_after: null };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(payload);
  });
  const headers = { authorization: 'Bearer account-token' };
  const path = `/v1/me/connections/with/${token}`;
  assert.equal((await handler(request(path, { method: 'POST' }))).status, 401);
  const sent = await handler(request(path, { method: 'POST', headers }));
  assert.equal(sent.status, 200);
  assert.deepEqual(await sent.json(), payload);
  assert.match(calls[0].url, /\/rpc\/edge_api_connection_request$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_token: token });
  for (const [error, status] of [['unavailable', 404], ['self', 400], ['incoming', 409]]) {
    payload = { error };
    const denied = await handler(request(path, { method: 'POST', headers }));
    assert.equal(denied.status, status);
    assert.equal(denied.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.ok((await denied.json()).detail);
  }
  payload = { error: 'cooldown', retry_after: 604800 };
  const cooldown = await handler(request(path, { method: 'POST', headers }));
  assert.equal(cooldown.status, 429);
  assert.equal(cooldown.headers.get('retry-after'), '604800');
  payload = { error: 'limit', retry_after: 86400 };
  const limited = await handler(request(path, { method: 'POST', headers }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '86400');
  assert.equal((await handler(request('/v1/me/connections/with/bad', {
    method: 'POST', headers,
  }))).status, 404);
  assert.equal((await handler(request(path, { method: 'DELETE', headers }))).status, 405);
  assert.equal(calls.length, 6);
});

test('blocking a public connection token is authenticated and returns private 204', async () => {
  const token = 'b'.repeat(43);
  const calls = [];
  let payload = { ok: true };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(payload);
  });
  const path = `/v1/me/connections/with/${token}/block`;
  const headers = { authorization: 'Bearer account-token' };
  assert.equal((await handler(request(path, { method: 'POST' }))).status, 401);
  const blocked = await handler(request(path, { method: 'POST', headers }));
  assert.equal(blocked.status, 204);
  assert.equal(blocked.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(calls[0].url, /\/rpc\/edge_api_connection_block_token$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_token: token });
  payload = { error: 'unavailable' };
  assert.equal((await handler(request(path, { method: 'POST', headers }))).status, 404);
  payload = { error: 'self' };
  assert.equal((await handler(request(path, { method: 'POST', headers }))).status, 400);
  assert.equal((await handler(request('/v1/me/connections/with/bad/block', {
    method: 'POST', headers,
  }))).status, 404);
  assert.equal((await handler(request(path, { method: 'GET', headers }))).status, 405);
  assert.equal(calls.length, 3);
});

test('directed relationship blocking reuses the pair-safe RPC and hides self identity', async () => {
  const token = 'c'.repeat(43);
  const calls = [];
  let payload = { ok: true };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(payload);
  });
  const path = `/v1/me/relationships/with/${token}/block`;
  const headers = { authorization: 'Bearer account-token' };
  assert.equal((await handler(request(path, { method: 'POST' }))).status, 401);
  const blocked = await handler(request(path, { method: 'POST', headers }));
  assert.equal(blocked.status, 204);
  assert.equal(blocked.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(calls[0].url, /\/rpc\/edge_api_connection_block_token$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_token: token });
  payload = { error: 'self' };
  assert.equal((await handler(request(path, { method: 'POST', headers }))).status, 404);
  payload = { error: 'unavailable' };
  assert.equal((await handler(request(path, { method: 'POST', headers }))).status, 404);
  assert.equal((await handler(request('/v1/me/relationships/with/bad/block', {
    method: 'POST', headers,
  }))).status, 404);
  assert.equal((await handler(request(path, { method: 'GET', headers }))).status, 405);
  assert.equal(calls.length, 3);
});

test('connection actions use the verified account and validate method, ID, and action', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const calls = [];
  let payload = { ok: true };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(payload);
  });
  const path = `/v1/me/connections/${id}/actions`;
  const headers = { authorization: 'Bearer account-token' };
  const body = JSON.stringify({ action: 'accept' });
  assert.equal((await handler(request(path, { method: 'POST', body }))).status, 401);
  const accepted = await handler(request(path, { method: 'POST', headers, body }));
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(calls[0].url, /\/rpc\/edge_api_connection_action$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId,
    p_connection_id: id, p_action: 'accept' });
  for (const [error, status] of [['unavailable', 404], ['recipient_only', 403],
    ['sender_only', 403], ['changed', 409], ['invalid', 422]]) {
    payload = { error };
    assert.equal((await handler(request(path, { method: 'POST', headers, body }))).status, status);
  }
  assert.equal((await handler(request('/v1/me/connections/bad/actions', {
    method: 'POST', headers, body,
  }))).status, 422);
  for (const invalid of [{ action: 'approve' }, { action: 'accept', user_id: userId }]) {
    assert.equal((await handler(request(path, {
      method: 'POST', headers, body: JSON.stringify(invalid),
    }))).status, 422);
  }
  assert.equal((await handler(request(path, { method: 'GET', headers }))).status, 405);
  assert.equal(calls.length, 6);
});

test('unblock deletes only the verified account block and remains idempotent', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json({ ok: true });
  });
  const path = `/v1/me/connections/blocks/${id}`;
  const headers = { authorization: 'Bearer account-token' };
  assert.equal((await handler(request(path, { method: 'DELETE' }))).status, 401);
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await handler(request(path, { method: 'DELETE', headers }));
    assert.equal(result.status, 204);
    assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  }
  assert.match(calls[0].url, /\/rpc\/edge_api_connection_unblock$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_block_id: id });
  assert.equal((await handler(request('/v1/me/connections/blocks/bad', {
    method: 'DELETE', headers,
  }))).status, 422);
  assert.equal((await handler(request(path, { method: 'POST', headers }))).status, 405);
  assert.equal(calls.length, 2);
});

test('directed relationship status uses the verified caller and hides invalid tokens', async () => {
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json({ state: 'available', relationship_id: null });
  });
  const path = `/v1/me/relationships/with/${'a'.repeat(43)}`;
  const headers = { authorization: 'Bearer account-token' };
  assert.equal((await handler(request(path))).status, 401);
  const result = await handler(request(path, { headers }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { state: 'available', relationship_id: null });
  assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(calls[0].url, /\/rpc\/edge_api_relationship_status$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_token: 'a'.repeat(43) });
  assert.equal((await handler(request('/v1/me/relationships/with/bad', { headers }))).status, 404);
  assert.equal((await handler(request(path, { method: 'DELETE', headers }))).status, 405);
  assert.equal(calls.length, 1);
});

test('directed connect preserves caller scope, privacy, and rate-limit header', async () => {
  const calls = [];
  let reply = { state: 'connected', relationship_id: '00000000-0000-4000-8000-000000000001' };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(reply);
  });
  const path = `/v1/me/relationships/with/${'a'.repeat(43)}`;
  const headers = { authorization: 'Bearer account-token' };
  const created = await handler(request(path, { method: 'POST', headers }));
  assert.equal(created.status, 200);
  assert.deepEqual(await created.json(), reply);
  assert.match(calls[0].url, /\/rpc\/edge_api_relationship_connect$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_token: 'a'.repeat(43) });
  reply = { error: 'unavailable' };
  assert.equal((await handler(request(path, { method: 'POST', headers }))).status, 404);
  reply = { error: 'limit', retry_after: 86400 };
  const limited = await handler(request(path, { method: 'POST', headers }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '86400');
  assert.equal((await handler(request('/v1/me/relationships/with/bad', {
    method: 'POST', headers,
  }))).status, 404);
  assert.equal(calls.length, 3);
});

test('directed relationship removal is authenticated, owner-bound, and idempotent', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json({ ok: true });
  });
  const path = `/v1/me/relationships/${id}`;
  const headers = { authorization: 'Bearer account-token' };
  assert.equal((await handler(request(path, { method: 'DELETE' }))).status, 401);
  for (let repeat = 0; repeat < 2; repeat++) {
    const removed = await handler(request(path, { method: 'DELETE', headers }));
    assert.equal(removed.status, 204);
    assert.equal(removed.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  }
  assert.match(calls[0].url, /\/rpc\/edge_api_relationship_remove$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_relationship_id: id });
  assert.equal((await handler(request('/v1/me/relationships/bad', {
    method: 'DELETE', headers,
  }))).status, 422);
  assert.equal((await handler(request(path, { method: 'POST', headers }))).status, 405);
  assert.equal(calls.length, 2);
});

test('blocking an owned relationship ID is private and works after token revocation', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json({ ok: true });
  });
  const path = `/v1/me/relationships/${id}/block`;
  const headers = { authorization: 'Bearer account-token' };
  assert.equal((await handler(request(path, { method: 'POST' }))).status, 401);
  for (let repeat = 0; repeat < 2; repeat++) {
    const blocked = await handler(request(path, { method: 'POST', headers }));
    assert.equal(blocked.status, 204);
    assert.equal(blocked.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  }
  assert.match(calls[0].url, /\/rpc\/edge_api_relationship_block$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_relationship_id: id });
  assert.equal((await handler(request('/v1/me/relationships/bad/block', {
    method: 'POST', headers,
  }))).status, 422);
  assert.equal((await handler(request(path, { method: 'DELETE', headers }))).status, 405);
  assert.equal(calls.length, 2);
});

test('directed pages hide internal avatar data and sign only owner-bound photos', async () => {
  const peer = '00000000-0000-4000-8000-000000000002';
  const firstId = '00000000-0000-4000-8000-000000000003';
  const photo = `avatars/${peer}/${'a'.repeat(32)}.jpg`;
  const cursor = `2026-10-15T12:00:00.000000Z:${firstId}`;
  const rpcCalls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (url.includes('/storage/v1/object/sign/')) {
      assert.match(url, new RegExp(`${peer}/`));
      return Response.json({ signedURL: `/object/sign/profile-avatars/${photo}?token=short` });
    }
    rpcCalls.push({ url, args: JSON.parse(init.body) });
    return Response.json({ items: [
      { id: firstId, display_name: 'Private learner', public_path: `/p/${'a'.repeat(43)}`,
        avatar_ref: null, avatar_key: photo, avatar_owner: peer, sort_time: 'internal' },
      { id: '00000000-0000-4000-8000-000000000004', display_name: 'Older',
        public_path: null, avatar_ref: 'preset:aurora', avatar_key: null,
        avatar_owner: null, sort_time: 'internal' },
    ], next_cursor: cursor });
  });
  const headers = { authorization: 'Bearer account-token' };
  const path = `/v1/me/relationships?limit=2&cursor=${encodeURIComponent(cursor)}`;
  assert.equal((await handler(request(path))).status, 401);
  const result = await handler(request(path, { headers }));
  assert.equal(result.status, 200);
  const page = await result.json();
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].avatar_ref, null);
  assert.match(page.items[0].avatar_url, new RegExp(`${peer}/`));
  assert.equal(page.items[1].avatar_ref, 'preset:aurora');
  assert.equal(page.items[1].avatar_url, null);
  assert.equal(page.items[0].avatar_key, undefined);
  assert.equal(page.items[0].avatar_owner, undefined);
  assert.equal(page.items[0].sort_time, undefined);
  assert.equal(page.next_cursor, cursor);
  assert.match(rpcCalls[0].url, /\/rpc\/edge_api_relationships$/);
  assert.deepEqual(rpcCalls[0].args, { p_user_id: userId,
    p_cursor_at: '2026-10-15T12:00:00.000000Z', p_cursor_id: firstId, p_limit: 2 });
  assert.equal((await handler(request('/v1/me/relationships?cursor=bad', { headers }))).status, 422);
  const invalidDate = `2026-02-30T12:00:00Z:${firstId}`;
  assert.equal((await handler(request(`/v1/me/relationships?cursor=${encodeURIComponent(invalidDate)}`,
    { headers }))).status, 422);
  assert.equal((await handler(request('/v1/me/relationships?limit=51', { headers }))).status, 422);
  assert.equal((await handler(request('/v1/me/relationships', { method: 'POST', headers }))).status, 405);
  assert.equal(rpcCalls.length, 1);
});

test('directed pages never sign a photo key from another account', async () => {
  const peer = '00000000-0000-4000-8000-000000000002';
  let storageCalls = 0;
  const handler = createHandler(config, async (url) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (url.includes('/storage/v1/')) storageCalls++;
    return Response.json({ items: [{
      id: '00000000-0000-4000-8000-000000000003', display_name: 'Private learner',
      public_path: null, avatar_ref: null,
      avatar_key: `avatars/${userId}/${'a'.repeat(32)}.jpg`, avatar_owner: peer,
    }], next_cursor: null });
  });
  const result = await handler(request('/v1/me/relationships', {
    headers: { authorization: 'Bearer account-token' },
  }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).items[0].avatar_url, null);
  assert.equal(storageCalls, 0);
});

test('achievements are account-scoped and acknowledgment validates its code list', async () => {
  const calls = [];
  const payload = { current_streak: 1, longest_streak: 2, items: [{ code: 'first-concept', seen_at: null }] };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(url.endsWith('/rpc/edge_api_achievements') ? payload : null);
  });
  const headers = { authorization: 'Bearer account-token' };
  const result = await handler(request('/v1/me/achievements', { headers }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), payload);
  assert.match(calls[0].url, /\/rpc\/edge_api_achievements$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId });
  const seen = await handler(request('/v1/me/achievements/seen', {
    method: 'POST', headers, body: JSON.stringify({ codes: ['first-concept'] }),
  }));
  assert.equal(seen.status, 204);
  assert.match(calls[1].url, /\/rpc\/edge_api_achievements_seen$/);
  assert.deepEqual(calls[1].args, { p_user_id: userId, p_codes: ['first-concept'] });
  const invalid = await handler(request('/v1/me/achievements/seen', {
    method: 'POST', headers, body: JSON.stringify({ codes: [] }),
  }));
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 2);
  assert.equal((await handler(request('/v1/me/achievements/seen', { headers }))).status, 405);
});

test('review completion uses the verified account and preserves conflict response', async () => {
  const reviewId = '42fb4109-a67a-4b2d-a824-4d4635001c3e';
  const calls = [];
  let payload = { completed: true, assigned_for: '2026-10-15', stats: {
    current: 1, longest: 1, total_learned: 2, total_reviews: 1,
  }, subtopic_completion: null };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(payload);
  });
  const headers = { authorization: 'Bearer account-token' };
  const completed = await handler(request(`/v1/reviews/${reviewId}/complete`, { method: 'POST', headers }));
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), payload);
  assert.match(calls[0].url, /\/rpc\/edge_api_complete_review$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_review_id: reviewId, p_today: null });
  payload = null;
  const stale = await handler(request(`/v1/reviews/${reviewId}/complete`, { method: 'POST', headers }));
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { detail: 'Review is unavailable or its completion window has ended' });
  const invalid = await handler(request('/v1/reviews/not-a-uuid/complete', { method: 'POST', headers }));
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 2);
  assert.equal((await handler(request(`/v1/reviews/${reviewId}/complete`, { headers }))).status, 405);
});

test('rejected or malformed Auth responses cannot reach the service RPC', async () => {
  for (const authResult of [new Response(null, { status: 401 }), Response.json({ id: 'not-a-uuid' })]) {
    let calls = 0;
    const handler = createHandler(config, async () => { calls++; return authResult; });
    const result = await handler(request('/v1/topics', { headers: { authorization: 'Bearer bad-token' } }));
    assert.equal(result.status, 401);
    assert.deepEqual(await result.json(), { detail: 'Invalid or expired token' });
    assert.equal(calls, 1);
  }
});

test('published concept detail uses the verified account and keeps the existing body', async () => {
  const calls = [];
  const body = { id: 'concept-1', slug: 'hash-tables', title: 'Hash Tables', like_count: 0 };
  const handler = createHandler(config, async (url, init) => {
    calls.push({ url, init });
    return url.endsWith('/auth/v1/user') ? Response.json({ id: userId }) : Response.json(body);
  });
  const result = await handler(request('/v1/concepts/hash-tables', { headers: { authorization: 'Bearer account-token' } }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), body);
  assert.match(calls[1].url, /\/rpc\/edge_api_concept$/);
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_user_id: userId, p_slug: 'hash-tables' });
});

test('like and save writes are idempotent method-to-state operations', async () => {
  const writes = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    writes.push(JSON.parse(init.body));
    return Response.json(true);
  });
  for (const [method, kind, on] of [
    ['PUT', 'like', true], ['DELETE', 'like', false],
    ['PUT', 'save', true], ['DELETE', 'save', false],
  ]) {
    const result = await handler(request(`/v1/concepts/hash-tables/${kind}`, {
      method, headers: { authorization: 'Bearer account-token' },
    }));
    assert.equal(result.status, 204);
    assert.equal(await result.text(), '');
    assert.deepEqual(writes.at(-1), { p_user_id: userId, p_slug: 'hash-tables', p_kind: kind, p_on: on });
  }
});

test('missing concepts return the original not-found contracts', async () => {
  const handler = createHandler(config, async url =>
    url.endsWith('/auth/v1/user') ? Response.json({ id: userId }) : Response.json(null));
  const headers = { authorization: 'Bearer account-token' };
  const detail = await handler(request('/v1/concepts/missing', { headers }));
  assert.equal(detail.status, 404);
  assert.deepEqual(await detail.json(), { detail: 'Concept not found' });
  const writeHandler = createHandler(config, async url =>
    url.endsWith('/auth/v1/user') ? Response.json({ id: userId }) : Response.json(false));
  const write = await writeHandler(request('/v1/concepts/missing/save', { method: 'PUT', headers }));
  assert.equal(write.status, 404);
});

test('notification preferences preserve the older-client weekly choice', async () => {
  const calls = [];
  const prefs = { enabled: false, weekly_quiz_enabled: true, reminder_times: ['08:00', '20:00'] };
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, input: JSON.parse(init.body) });
    return Response.json(prefs);
  });
  const headers = { authorization: 'Bearer account-token', 'content-type': 'application/json' };
  const get = await handler(request('/v1/me/notifications', { headers }));
  assert.deepEqual(await get.json(), prefs);
  assert.match(calls[0].url, /\/rpc\/edge_api_notifications$/);
  const put = await handler(request('/v1/me/notifications', {
    method: 'PUT', headers,
    body: JSON.stringify({ enabled: false, reminder_times: ['20:00', '08:00', '08:00'] }),
  }));
  assert.equal(put.status, 200);
  assert.deepEqual(calls[1].input, {
    p_user_id: userId, p_enabled: false, p_weekly: null, p_times: ['08:00', '20:00'],
  });
});

test('streak statistics use only the verified account', async () => {
  const stats = { current: 3, longest: 7, total_learned: 26, total_reviews: 2 };
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(stats);
  });
  const result = await handler(request('/v1/me/stats', {
    headers: { authorization: 'Bearer account-token' },
  }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), stats);
  assert.match(calls[0].url, /\/rpc\/edge_api_stats$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId });
});

test('history and saved pages use verified identity and bounded cursors', async () => {
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json({ items: [], next_cursor: null });
  });
  const headers = { authorization: 'Bearer account-token' };
  const history = await handler(request('/v1/me/history?cursor=2026-10-14&limit=2', { headers }));
  assert.equal(history.status, 200);
  assert.match(calls[0].url, /\/rpc\/edge_api_history$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId, p_before: '2026-10-14', p_limit: 2 });

  const cursor = Buffer.from(JSON.stringify(['2026-10-14T08:30:00.000000+00:00', userId])).toString('base64url');
  const saved = await handler(request(`/v1/me/saved?cursor=${cursor}&limit=1`, { headers }));
  assert.equal(saved.status, 200);
  assert.match(calls[1].url, /\/rpc\/edge_api_saved$/);
  assert.deepEqual(calls[1].args, {
    p_user_id: userId, p_before: '2026-10-14T08:30:00.000000+00:00',
    p_concept_id: userId, p_limit: 1,
  });
});

test('invalid pagination is rejected before service-role RPC access', async () => {
  let serviceCalls = 0;
  const handler = createHandler(config, async url => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    serviceCalls++;
    return Response.json({ items: [], next_cursor: null });
  });
  const headers = { authorization: 'Bearer account-token' };
  for (const [path, status] of [
    ['/v1/me/history?cursor=2026-02-30', 422],
    ['/v1/me/history?limit=101', 422],
    ['/v1/me/saved?cursor=not-base64', 400],
    ['/v1/me/saved?limit=0', 422],
  ]) {
    assert.equal((await handler(request(path, { headers }))).status, status);
  }
  assert.equal(serviceCalls, 0);
  assert.equal((await handler(request('/v1/me/history'))).status, 401);
});

test('subtopic progress and seen writes use the verified account', async () => {
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push({ url, args: JSON.parse(init.body) });
    return Response.json(url.endsWith('edge_api_subtopic_progress') ? { items: [] } : true);
  });
  const headers = { authorization: 'Bearer account-token', 'content-type': 'application/json' };
  const progress = await handler(request('/v1/me/subtopics/progress', { headers }));
  assert.equal(progress.status, 200);
  assert.deepEqual(await progress.json(), { items: [] });
  assert.match(calls[0].url, /\/rpc\/edge_api_subtopic_progress$/);
  assert.deepEqual(calls[0].args, { p_user_id: userId });

  const seen = await handler(request('/v1/me/subtopics/completions/seen', {
    method: 'POST', headers, body: JSON.stringify({ ids: [userId] }),
  }));
  assert.equal(seen.status, 204);
  assert.match(calls[1].url, /\/rpc\/edge_api_mark_subtopics_seen$/);
  assert.deepEqual(calls[1].args, { p_user_id: userId, p_ids: [userId] });
});

test('subtopic acknowledgment rejects invalid IDs before service-role access', async () => {
  let serviceCalls = 0;
  const handler = createHandler(config, async url => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    serviceCalls++;
    return Response.json(true);
  });
  const headers = { authorization: 'Bearer account-token', 'content-type': 'application/json' };
  for (const ids of [[], ['invalid-id'], Array(101).fill(userId)]) {
    const result = await handler(request('/v1/me/subtopics/completions/seen', {
      method: 'POST', headers, body: JSON.stringify({ ids }),
    }));
    assert.equal(result.status, 422);
  }
  assert.equal(serviceCalls, 0);
  assert.equal((await handler(request('/v1/me/subtopics/completions/seen', { headers }))).status, 405);
});

test('invalid or excessive preference bodies fail before database access', async () => {
  let calls = 0;
  const handler = createHandler(config, async url => {
    calls++;
    return url.endsWith('/auth/v1/user') ? Response.json({ id: userId }) : Response.json({});
  });
  const headers = { authorization: 'Bearer account-token', 'content-type': 'application/json' };
  const invalid = await handler(request('/v1/me/notifications', {
    method: 'PUT', headers, body: JSON.stringify({ enabled: true, reminder_times: ['25:00'] }),
  }));
  assert.equal(invalid.status, 422);
  const excessive = await handler(request('/v1/me/notifications', {
    method: 'PUT', headers, body: JSON.stringify({ enabled: true, reminder_times: ['08:00'], filler: 'x'.repeat(5000) }),
  }));
  assert.equal(excessive.status, 413);
  assert.equal(calls, 2); // Auth only; no service RPC.
});

test('push-token registration and bodyless sign-out use the verified account', async () => {
  const calls = [];
  const handler = createHandler(config, async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    calls.push(JSON.parse(init.body));
    return Response.json(true);
  });
  const headers = { authorization: 'Bearer account-token', 'content-type': 'application/json' };
  const registered = await handler(request('/v1/me/push-token', {
    method: 'POST', headers,
    body: JSON.stringify({ expo_push_token: 'ExponentPushToken[test-device]', platform: 'android' }),
  }));
  assert.equal(registered.status, 204);
  assert.deepEqual(calls[0], {
    p_user_id: userId, p_token: 'ExponentPushToken[test-device]',
    p_platform: 'android', p_register: true,
  });
  const removed = await handler(request('/v1/me/push-token', { method: 'DELETE', headers }));
  assert.equal(removed.status, 204);
  assert.deepEqual(calls[1], {
    p_user_id: userId, p_token: null, p_platform: null, p_register: false,
  });
});

test('upstream failures are generic and do not reveal secrets', async () => {
  const handler = createHandler(config, async () => new Response('provider-secret', { status: 500 }));
  const result = await handler(request('/health'));
  assert.equal(result.status, 503);
  const body = await result.text();
  assert.equal(body.includes('provider-secret'), false);
  assert.equal(body.includes(config.serviceRoleKey), false);
  assert.equal(result.headers.get('retry-after'), '30');
  assert.match(result.headers.get('x-incident-id'), /^[0-9a-f]{32}$/);
  assert.equal(JSON.parse(body).error.code, 'service_unavailable');
});

test('only exact API path and method combinations are served', async () => {
  const handler = createHandler(config, () => { throw Error('must not fetch'); });
  assert.equal((await handler(request('/v1/unknown'))).status, 404);
  assert.equal((await handler(request('/health', { method: 'POST' }))).status, 405);
  assert.equal((await handler(new Request('https://one-concept.supabase.co/elsewhere/health'))).status, 404);
});

test('configuration rejects wildcard and unsafe browser origins', () => {
  assert.throws(() => createHandler({ ...config, allowedOrigins: ['*'] }));
  assert.throws(() => createHandler({ ...config, allowedOrigins: ['http://review.example.com'] }));
  assert.throws(() => createHandler({ ...config, contentLowWatermark: 31 }));
  assert.throws(() => createHandler({ ...config, contentReservePerTopic: 0 }));
});
