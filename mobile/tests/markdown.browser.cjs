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
  id: '33333333-3333-4333-8333-333333333333', slug: 'markdown-lesson',
  title: 'Markdown lesson',
  summary: '# A heading\n\nA **bold** paragraph with [unsafe](javascript:alert(1)).\n\n```js\nconst longValue = "012345678901234567890123456789012345678901234567890123456789";\n```',
  example: '> A quoted idea\n\n- First item\n- Second item',
  topic_slug: 'computer-science', topic_name: 'Computer Science', content_version: 1, like_count: 0,
};
const session = { access_token: 'fixture', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 864000, expires_at: Math.floor(Date.now() / 1000) + 864000, user: { id: '11111111-1111-1111-1111-111111111111', email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
const state = { display_name: 'Reader', timezone: 'UTC', today, followed_topics: ['computer-science'], learned: [], likes: [], bookmarks: [], saved: [], stats: { current: 0, longest: 0, total_learned: 0, total_reviews: 0 }, assignment_slug: concept.slug, daily: { assigned_for: today, assigned_at: today + 'T08:00:00Z', learned: false, completed_at: null, outside_followed_topics: false, concept } };
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
      const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
      await context.addInitScript(({ session, version, theme }) => {
        localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
        localStorage.setItem('one-concept/last-seen-version/v1', version);
        localStorage.setItem('one-concept/theme/v1', theme);
      }, { session, version, theme });
      await context.route('**/api/**', async route => {
        const endpoint = new URL(route.request().url()).pathname.replace('/api', '');
        const body = endpoint === '/v1/me/state' ? state : endpoint === '/v1/topics'
          ? [{ slug: 'computer-science', name: 'Computer Science', concept_count: 25, following: true }]
          : endpoint === '/v1/me/notifications' ? { enabled: false, weekly_quiz_enabled: false, reminder_times: ['08:00'] }
          : endpoint === '/v1/me/achievements' || endpoint === '/v1/me/subtopics/progress' ? { items: [] }
          : concept;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await context.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:4781');
      await expect(page.getByText('A heading', { exact: true })).toBeVisible();
      await expect(page.getByText('bold', { exact: true })).toBeVisible();
      await expect(page.getByText('const', { exact: true })).toBeVisible();
      await expect(page.getByText('First item', { exact: true })).toBeVisible();
      const scrollableCode = await page.getByText('const', { exact: true }).evaluate(node => {
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowX === 'auto' && parent.scrollWidth > parent.clientWidth) return true;
        }
        return false;
      });
      assert.equal(scrollableCode, true, 'long code stays in a horizontal scroll container');
      assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
      assert.equal((await page.locator('body').innerText()).includes('[unsafe](javascript:'), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/markdown-lesson-${theme}.png`, fullPage: true, animations: 'disabled' });
      console.log(`${theme}: lesson Markdown renders safely`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
