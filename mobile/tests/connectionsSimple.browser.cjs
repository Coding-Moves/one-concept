const { chromium, expect } = require(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'index.html'))) throw Error('Pass the exported web directory');
const version = require('../app.config.js').expo.version;
const today = new Date().toISOString().slice(0, 10);
const token = 'b'.repeat(43);
const relationshipId = '22222222-2222-4222-8222-222222222222';
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
      let connected = false, revoked = false, blocked = false;
      const state = { display_name: 'Reader', timezone: 'UTC', today, followed_topics: ['computer-science'], learned: [], likes: [], bookmarks: [], saved: [], stats: { current: 0, longest: 0, total_learned: 0, total_reviews: 0 }, assignment_slug: concept.slug, daily: { assigned_for: today, assigned_at: today + 'T08:00:00Z', learned: false, completed_at: null, outside_followed_topics: false, concept } };
      const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
      await context.addInitScript(({ session, version, theme }) => {
        localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
        localStorage.setItem('one-concept/last-seen-version/v1', version);
        localStorage.setItem('one-concept/theme/v1', theme);
      }, { session, version, theme });
      await context.route('**/api/**', async route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api', '');
        let body = {}, status = 200;
        if (endpoint === '/v1/me/state' || endpoint === '/v1/me') body = state;
        else if (endpoint === '/v1/me/relationships') body = { items: connected ? [{ id: relationshipId, display_name: revoked ? 'Private learner' : 'Bea', public_path: revoked ? null : `/p/${token}`, avatar_ref: revoked ? null : 'preset:forest', avatar_url: null }] : [], next_cursor: null };
        else if (endpoint === `/v1/me/relationships/with/${token}`) {
          if (request.method() === 'POST') { connected = true; blocked = false; }
          body = { state: revoked || blocked ? 'unavailable' : connected ? 'connected' : 'available', relationship_id: connected ? relationshipId : null };
        } else if (endpoint === `/v1/me/relationships/${relationshipId}` && request.method() === 'DELETE') { connected = false; status = 204; }
        else if (endpoint === `/v1/me/relationships/${relationshipId}/block` && request.method() === 'POST') { connected = false; blocked = true; status = 204; }
        else if (endpoint.startsWith('/v1/public-profiles/')) { if (revoked) status = 404; else body = { display_name: 'Bea', avatar_ref: 'preset:forest', achievements: [] }; }
        else if (endpoint === '/v1/me/achievements') body = { items: [] };
        else if (endpoint === '/v1/me/subtopics/progress') body = { items: [] };
        else if (endpoint === '/v1/topics') body = [{ slug: 'computer-science', name: 'Computer Science', concept_count: 25, following: true }];
        else if (endpoint === '/v1/me/notifications') body = { enabled: false, weekly_quiz_enabled: false, reminder_times: ['08:00'] };
        else if (endpoint.startsWith('/v1/concepts/')) body = concept;
        await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(body) });
      });
      await context.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }));
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:4781');
      await page.getByRole('tab', { name: 'Profile' }).click();
      await page.getByText('Connections', { exact: true }).click();
      await expect(page.getByText('No connections yet')).toBeVisible();
      await page.getByRole('button', { name: 'Open shared link' }).click();
      const input = page.getByRole('textbox', { name: 'Shared profile link' });
      await input.fill('bad link');
      await page.getByRole('button', { name: 'Open profile link' }).click();
      await expect(page.getByText(/Paste a valid One Concept/)).toBeVisible();
      await input.fill(`http://127.0.0.1:4781/api/p/${token}`);
      await page.getByRole('button', { name: 'Open profile link' }).click();
      await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(page.getByText('Connected.', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Close profile' }).click();
      await expect(page.getByRole('button', { name: 'Close profile' })).toHaveCount(0);
      await expect(page.getByText('Bea', { exact: true })).toBeVisible();
      await page.screenshot({ path: `/tmp/connections-list-${theme}.png`, fullPage: true, animations: 'disabled' });
      await context.setOffline(true);
      await expect(page.getByText('Connect to load or change your connections.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'View profile' })).toBeDisabled();
      await context.setOffline(false);
      await expect(page.getByRole('button', { name: 'View profile' })).toBeEnabled();
      await page.getByRole('button', { name: 'View profile' }).click();
      await expect(page.getByRole('button', { name: 'Close profile' })).toBeVisible();
      await page.getByRole('button', { name: 'Close profile' }).click();
      await page.getByRole('button', { name: 'More options' }).click();
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm disconnect' }).click();
      await expect(page.getByText('No connections yet')).toBeVisible();
      connected = true; revoked = true;
      await page.getByRole('button', { name: 'Back' }).click();
      await page.getByText('Connections', { exact: true }).click();
      await expect(page.getByText('Profile is private')).toBeVisible();
      await expect(page.getByRole('button', { name: 'View profile' })).toHaveCount(0);
      await page.getByRole('button', { name: 'More options' }).click();
      await page.getByRole('button', { name: 'Block', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm block' }).click();
      await expect(page.getByText('No connections yet')).toBeVisible();
      await page.screenshot({ path: `/tmp/connections-simple-${theme}.png`, fullPage: true, animations: 'disabled' });
      assert.equal(blocked, true);
      assert.deepEqual(errors, []);
      console.log(`${theme}: open, connect, view, disconnect, revoked profile and block passed`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
