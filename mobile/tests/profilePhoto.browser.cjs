const { chromium, expect } = require(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'index.html'))) throw Error('Pass the exported web directory');
const version = require('../app.config.js').expo.version;
const today = new Date().toISOString().slice(0, 10);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
const concept = { id: '33333333-3333-4333-8333-333333333333', slug: 'known-lesson', title: 'Review invariants', summary: 'A rule that stays true while a system changes.', example: 'A book can have one active borrower.', topic_slug: 'computer-science', topic_name: 'Computer Science', content_version: 2, like_count: 0 };
const session = { access_token: 'fixture', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 864000, expires_at: Math.floor(Date.now() / 1000) + 864000, user: { id: '11111111-1111-1111-1111-111111111111', email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };

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
    for (const theme of ['light', 'dark']) {
      let failUpload = true;
      let uploads = 0;
      const state = { display_name: 'Reader', bio: null, avatar_ref: null, avatar_url: null, timezone: 'UTC', today, followed_topics: ['computer-science'], learned: [], likes: [], bookmarks: [], saved: [], stats: { current: 0, longest: 0, total_learned: 0, total_reviews: 0 }, assignment_slug: concept.slug, daily: { assigned_for: today, assigned_at: today + 'T08:00:00Z', learned: false, completed_at: null, outside_followed_topics: false, concept } };
      const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
      await context.addInitScript(({ session, version, theme }) => {
        localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
        localStorage.setItem('one-concept/last-seen-version/v1', version);
        localStorage.setItem('one-concept/theme/v1', theme);
      }, { session, version, theme });
      await context.route('**/api/**', async route => {
        const endpoint = new URL(route.request().url()).pathname.replace('/api', '');
        let body = {}, status = 200;
        if (endpoint === '/v1/me/state') body = state;
        else if (endpoint === '/v1/me/avatar' && route.request().method() === 'PUT') {
          uploads++;
          if (failUpload) { status = 503; body = { detail: 'Photo uploads unavailable' }; }
          else { state.avatar_ref = 'avatars/fixture/photo.jpg'; state.avatar_url = 'data:image/png;base64,' + png.toString('base64'); body = state; }
        } else if (endpoint === '/v1/me/achievements') body = { items: [] };
        else if (endpoint === '/v1/me/subtopics/progress') body = { items: [] };
        else if (endpoint === '/v1/topics') body = [{ slug: 'computer-science', name: 'Computer Science', concept_count: 25, following: true }];
        else if (endpoint === '/v1/me/notifications') body = { enabled: false, weekly_quiz_enabled: false, reminder_times: ['08:00'] };
        else if (endpoint.startsWith('/v1/concepts/')) body = concept;
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await context.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:4781');
      await page.getByRole('tab', { name: 'Profile' }).click();
      await page.getByText('Edit profile', { exact: true }).click();
      const choose = async () => {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Choose photo' }).click();
        await (await chooser).setFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: png });
      };
      await choose();
      await expect(page.getByText('Preview your photo')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save photo' })).toBeVisible();
      assert.equal(uploads, 0, 'selection must not upload without confirmation');
      await page.getByRole('button', { name: 'Cancel photo change' }).click();
      await expect(page.getByText('Preview your photo')).toHaveCount(0);
      assert.equal(uploads, 0);
      await choose();
      await page.getByText('Preview your photo').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/profile-photo-preview-${theme}.png`, animations: 'disabled' });
      await page.getByRole('button', { name: 'Save photo' }).click();
      await expect(page.getByText(/Photo saving is unavailable/)).toBeVisible();
      await expect(page.getByText('Preview your photo')).toBeVisible();
      assert.equal(uploads, 1);
      failUpload = false;
      await page.getByRole('button', { name: 'Save photo' }).click();
      await expect(page.getByText('Profile photo saved.')).toBeVisible();
      await expect(page.getByText('Preview your photo')).toHaveCount(0);
      assert.equal(uploads, 2);
      assert.deepEqual(errors, []);
      console.log(`${theme}: preview, cancellation, upload failure/retry, confirmed save passed`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
