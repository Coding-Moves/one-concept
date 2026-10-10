const { chromium, expect } = require(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'index.html'))) throw Error('Pass the exported web directory');
const version = require('../app.config.js').expo.version;
const today = new Date().toISOString().slice(0, 10);
const token = 'a'.repeat(43);
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
    const state = { display_name: 'Reader', bio: 'Learning systems', avatar_ref: null, avatar_url: null, timezone: 'UTC', today, followed_topics: ['computer-science'], learned: [], likes: [], bookmarks: [], saved: [], stats: { current: 0, longest: 0, total_learned: 0, total_reviews: 0 }, assignment_slug: concept.slug, daily: { assigned_for: today, assigned_at: today + 'T08:00:00Z', learned: false, completed_at: null, outside_followed_topics: false, concept } };
    let sharing = { enabled: false, show_name: false, show_avatar: false, show_bio: false, show_streak: false, show_learning: false, achievement_codes: [], version: 0, public_path: null };
    let conflictOnce = false;
    let connected = false;
    const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
    await context.addInitScript(({ session, version }) => {
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
      localStorage.setItem('one-concept/last-seen-version/v1', version);
    }, { session, version });
    await context.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.replace('/api', '');
      let body = {};
      let status = 200;
      if (endpoint === '/v1/me/state') body = state;
      else if (endpoint === '/v1/me' && route.request().method() === 'PATCH') {
        const input = route.request().postDataJSON();
        if (Object.hasOwn(input, 'bio')) state.bio = input.bio || null;
        body = state;
      } else if (endpoint === '/v1/me/profile-sharing') {
        if (route.request().method() === 'PUT') {
          if (conflictOnce) {
            conflictOnce = false;
            status = 409;
            body = { detail: 'Settings changed. Reload before saving.' };
          } else {
            const input = route.request().postDataJSON();
            sharing = { ...input, version: sharing.version + 1, public_path: input.enabled ? `/p/${token}` : null };
          }
        }
        if (status === 200) body = sharing;
      } else if (endpoint.startsWith('/v1/public-profiles/')) {
        if (!sharing.enabled) { status = 404; body = { detail: 'Profile unavailable' }; }
        else body = { ...(sharing.show_name ? { display_name: state.display_name } : {}), ...(sharing.show_bio && state.bio ? { bio: state.bio } : {}), ...(sharing.show_streak ? { current_streak: 0, longest_streak: 0 } : {}), achievements: [] };
      }
      else if (endpoint === '/v1/me/relationships') body = { items: [], next_cursor: null };
      else if (endpoint.includes('/v1/me/relationships/with/')) {
        if (route.request().method() === 'POST') connected = true;
        body = connected ? { state: 'connected', relationship_id: '22222222-2222-4222-8222-222222222222' } : { state: 'available', relationship_id: null };
      }
      else if (endpoint === '/v1/me/achievements') body = { items: [] };
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
    await expect(page.getByText('Learning systems', { exact: true }).last()).toBeVisible();
    await page.getByText('Public profile', { exact: true }).click();
    if (process.env.PROFILE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.PROFILE_SCREENSHOT_DIR, 'sharing-choices.png'), fullPage: true });
    await expect(page.getByRole('switch', { name: 'Share short bio' })).not.toBeChecked();
    await page.getByRole('switch', { name: 'Share display name' }).check();
    await page.getByRole('button', { name: 'Review changes' }).click();
    await expect(page.getByText('Visitor preview')).toBeVisible();
    await expect(page.getByText('Reader', { exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Publish profile' }).click();
    assert.equal(sharing.enabled, true);
    assert.equal(sharing.show_name, true);
    assert.equal(sharing.show_bio, false);
    await page.getByRole('switch', { name: 'Share short bio' }).check();
    await expect(page.getByText('You have changes that are not published yet.')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Share learning streak' })).toHaveCount(0);
    await page.getByRole('button', { name: /Learning highlights/ }).click();
    await page.getByRole('switch', { name: 'Share learning streak' }).check();
    await page.getByRole('button', { name: 'Review changes' }).click();
    await expect(page.getByText('Visitor preview')).toBeVisible();
    if (process.env.PROFILE_SCREENSHOT_DIR) {
      await page.waitForTimeout(450);
      await page.screenshot({ path: path.join(process.env.PROFILE_SCREENSHOT_DIR, 'sharing-review.png') });
    }
    await expect(page.getByText('Learning systems', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Current streak · Best 0')).toBeVisible();
    await page.getByRole('button', { name: 'Publish changes' }).click();
    assert.equal(sharing.show_bio, true);
    assert.equal(sharing.show_streak, true);
    await expect(page.getByText('Public profile is live', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View and share profile' }).click();
    await expect(page.getByText('Learning systems', { exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Close share preview' }).click();
    await page.getByRole('switch', { name: 'Share profile avatar' }).check();
    conflictOnce = true;
    await page.getByRole('button', { name: 'Review changes' }).click();
    await page.getByRole('button', { name: 'Publish changes' }).click();
    await expect(page.getByText(/Sharing changed on another device/)).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Share profile avatar' })).toBeChecked();
    await page.getByRole('button', { name: 'Discard edits and reload' }).click();
    await expect(page.getByRole('switch', { name: 'Share profile avatar' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByText('Connections', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Shared profile link' }).fill(`http://127.0.0.1:4781/api/p/${token}`);
    await page.getByRole('button', { name: 'Open shared profile' }).click();
    await expect(page.getByText('Learning systems', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('ONE CONCEPT', { exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close shared profile' }).click();
    await expect(page.getByRole('button', { name: 'Close shared profile' })).toHaveCount(0);
    await page.getByRole('button', { name: '← Back' }).click();
    await page.getByText('Edit profile', { exact: true }).click();
    const bioInput = page.getByRole('textbox', { name: 'Short bio' });
    await bioInput.click();
    await bioInput.press('ControlOrMeta+A');
    await bioInput.press('Backspace');
    await expect(bioInput).toHaveValue('');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByText('Learning systems', { exact: true })).toHaveCount(0);
    assert.equal(state.bio, null);
    await page.getByText('Public profile', { exact: true }).click();
    await page.getByRole('button', { name: 'Turn off sharing' }).click();
    await page.getByRole('button', { name: 'Confirm turn off sharing' }).click();
    assert.equal(sharing.enabled, false);
    await expect(page.getByText(/Sharing is off/)).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByText('Connections', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Shared profile link' }).fill(`http://127.0.0.1:4781/api/p/${token}`);
    await page.getByRole('button', { name: 'Open shared profile' }).click();
    await expect(page.getByText(/profile is unavailable/i)).toBeVisible();
    assert.deepEqual(errors, []);
    console.log('minimal publish, Connect, expanded preview, conflict recovery, bio clearing, and link revocation passed');
    await context.close();
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
