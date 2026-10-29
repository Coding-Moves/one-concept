const { chromium, expect } = require(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'index.html'))) throw Error('Pass the exported web directory');
const version = require('../app.config.js').expo.version;
const today = new Date().toISOString().slice(0, 10);
const concept = {
  id: '33333333-3333-4333-8333-333333333333', slug: 'first-lesson', title: 'One selected lesson',
  summary: 'A lesson from the chosen topic.', example: 'Choose a topic first.',
  topic_slug: 'computer-science', topic_name: 'Computer Science', content_version: 1, like_count: 0,
};
const session = {
  access_token: 'fixture', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 864000,
  expires_at: Math.floor(Date.now() / 1000) + 864000,
  user: { id: '11111111-1111-1111-1111-111111111111', email: 'fixture@example.invalid',
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(root, relative === '/' ? 'index.html' : relative);
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.ttf': 'font/ttf', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.statusCode = 404; res.end(); }
});

(async () => {
  await new Promise(resolve => server.listen(4781, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });
  try {
    let followed = [];
    const writes = [];
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
    await context.addInitScript(({ session, version }) => {
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
      localStorage.setItem('one-concept/last-seen-version/v1', version);
    }, { session, version });
    await context.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.replace('/api', '');
      if (endpoint === '/v1/me/topics' && route.request().method() === 'PUT') {
        followed = route.request().postDataJSON().topics;
        writes.push([...followed]);
      }
      const daily = followed.length ? {
        assigned_for: today, assigned_at: today + 'T08:00:00Z', learned: false, completed_at: null,
        outside_followed_topics: false, concept,
      } : null;
      const state = {
        display_name: 'First learner', timezone: 'UTC', today, followed_topics: followed,
        learned: [], likes: [], bookmarks: [], saved: [],
        stats: { current: 0, longest: 0, total_learned: 0, total_reviews: 0 },
        assignment_slug: daily ? concept.slug : null, daily,
        daily_availability: daily ? 'available' : 'personalization_required',
      };
      let body = {};
      if (endpoint === '/v1/me/state' || endpoint === '/v1/me/topics') body = state;
      else if (endpoint === '/v1/topics') body = [{ slug: 'computer-science', name: 'Computer Science', concept_count: 25, following: followed.includes('computer-science') }];
      else if (endpoint === '/v1/me/notifications') body = { enabled: false, weekly_quiz_enabled: false, reminder_times: ['08:00'] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await context.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4781');
    await expect(page.getByText('Follow your interests to start learning', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Choose topics' }).click();
    await page.getByRole('button', { name: 'Follow' }).click();
    await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
    await expect.poll(() => writes.length).toBe(1);
    await page.getByRole('button', { name: 'Close personalization' }).click();
    await page.getByRole('tab', { name: 'Today' }).click();
    await expect(page.getByText(concept.title, { exact: true })).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.getByText(concept.title, { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Profile' }).click();
    await page.getByText('Personalize your feed', { exact: true }).click();
    await page.getByRole('button', { name: 'Following' }).click();
    await expect.poll(() => writes.length).toBe(2);
    assert.deepEqual(writes, [['computer-science'], []]);
    await page.getByRole('button', { name: 'Close personalization' }).click();
    await page.getByRole('tab', { name: 'Today' }).click();
    await expect(page.getByText('Follow your interests to start learning', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Follow your interests to start learning', { exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
    console.log('new follow, lesson, refresh, last unfollow, and empty-state refresh passed');
    await context.close();
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
