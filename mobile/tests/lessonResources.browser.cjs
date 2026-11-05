const { chromium, expect } = require(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'index.html'))) throw Error('Pass the exported web directory');
const version = require('../app.config.js').expo.version;
const today = new Date().toISOString().slice(0, 10);
const lesson = {
  id: '33333333-3333-4333-8333-333333333333', slug: 'feature-flags',
  title: 'Feature Flags', summary: 'A feature flag lets a team enable a feature without another deployment.',
  example: 'A team enables a new checkout screen for a small group first.',
  topic_slug: 'software-engineering', topic_name: 'Software Engineering', content_version: 1,
};
const session = {
  access_token: 'fixture', refresh_token: 'fixture-refresh', token_type: 'bearer',
  expires_in: 864000, expires_at: Math.floor(Date.now() / 1000) + 864000,
  user: { id: '11111111-1111-1111-1111-111111111111', email: 'fixture@example.invalid',
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {},
    created_at: '2026-01-01T00:00:00Z' },
};
const state = {
  display_name: 'Reader', timezone: 'UTC', today, followed_topics: ['software-engineering'],
  learned: [{ concept_slug: lesson.slug, title: lesson.title, topic_name: lesson.topic_name, learned_on: today }],
  likes: [], bookmarks: [lesson.slug],
  saved: [{ concept_slug: lesson.slug, title: lesson.title, topic_name: lesson.topic_name, like_count: 0 }],
  stats: { current: 1, longest: 1, total_learned: 1, total_reviews: 0 },
  assignment_slug: lesson.slug,
  daily: { assigned_for: today, assigned_at: `${today}T08:00:00Z`, learned: true,
    completed_at: `${today}T09:00:00Z`, outside_followed_topics: false, concept: lesson },
};
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(root, relative === '/' ? 'index.html' : relative);
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript',
      '.ttf': 'font/ttf', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.statusCode = 404; res.end(); }
});

(async () => {
  await new Promise(resolve => server.listen(4781, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
    headless: true, args: ['--no-sandbox'] });
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
      await context.addInitScript(({ session, version, theme }) => {
        localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
        localStorage.setItem('one-concept/last-seen-version/v1', version);
        localStorage.setItem('one-concept/theme/v1', theme);
        window.externalSearches = [];
        window.open = url => { window.externalSearches.push(url); return null; };
      }, { session, version, theme });
      await context.route('**/api/**', async route => {
        const endpoint = new URL(route.request().url()).pathname.replace('/api', '');
        let body = {};
        if (endpoint === '/v1/me/state') body = state;
        else if (endpoint === '/v1/topics') body = [{ slug: lesson.topic_slug, name: lesson.topic_name, concept_count: 1, following: true }];
        else if (endpoint === '/v1/me/notifications') body = { enabled: false, reminder_times: ['08:00'] };
        else if (endpoint.startsWith('/v1/concepts/')) body = lesson;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await context.route('**/auth/v1/**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(session),
      }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:4781');
      const video = page.getByRole('link', { name: 'Find video tutorials about Feature Flags' });
      const reading = page.getByRole('link', { name: 'Find more reading about Feature Flags' });
      await expect(video).toBeVisible();
      await expect(reading).toBeVisible();
      if (process.env.LESSON_RESOURCES_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.LESSON_RESOURCES_SCREENSHOT_DIR, { recursive: true });
        await video.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(process.env.LESSON_RESOURCES_SCREENSHOT_DIR, `today-${theme}.png`) });
      }
      await video.click();
      await reading.click();
      let urls = await page.evaluate(() => window.externalSearches);
      assert.equal(urls.length, 2);
      assert.equal(new URL(urls[0]).searchParams.get('search_query'), 'Feature Flags in Software Engineering');
      assert.equal(new URL(urls[1]).searchParams.get('q'), 'Feature Flags in Software Engineering');

      await page.getByRole('tab', { name: 'History' }).click();
      await page.getByRole('button', { name: 'Open Feature Flags' }).click();
      await expect(video.last()).toBeVisible();
      await expect(reading.last()).toBeVisible();
      await video.last().click();
      urls = await page.evaluate(() => window.externalSearches);
      assert.equal(new URL(urls.at(-1)).searchParams.get('search_query'), 'Feature Flags in Software Engineering');
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('tab', { name: 'Profile' }).click();
      await page.getByText('Saved concepts', { exact: true }).click();
      await page.getByRole('button', { name: 'Open Feature Flags' }).click();
      await expect(video.last()).toBeVisible();
      await expect(reading.last()).toBeVisible();
      await reading.last().click();
      urls = await page.evaluate(() => window.externalSearches);
      assert.equal(new URL(urls.at(-1)).searchParams.get('q'), 'Feature Flags in Software Engineering');
      await page.evaluate(() => { window.open = () => { throw Error('No browser'); }; });
      await reading.last().click();
      await expect(page.getByText('Couldn’t open that search. Check your browser and connection, then try again.')).toBeVisible();
      urls = await page.evaluate(() => window.externalSearches);
      assert.equal(urls.length, 4, 'failed external open must not navigate elsewhere');
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
