const { chromium, expect } = require(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'index.html'))) throw new Error('Pass an Expo web export directory.');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
  try {
    res.setHeader('Content-Type', ({'.html':'text/html', '.js':'application/javascript', '.ttf':'font/ttf', '.png':'image/png'})[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.statusCode = 404; res.end(); }
});

(async () => {
  await new Promise(resolve => server.listen(4781, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH, args:['--no-sandbox']});
  try {
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({viewport:{width:390, height:844}, colorScheme});
      const errors = [], requests = [];
      let release;
      await context.route('**/auth/v1/**', async route => {
        const endpoint = new URL(route.request().url()).pathname;
        const body = route.request().postDataJSON();
        requests.push({endpoint, body});
        await new Promise(resolve => { release = resolve; });
        const signup = endpoint.endsWith('/signup');
        await route.fulfill({status:signup ? 200 : 400, contentType:'application/json', body:JSON.stringify(signup
          ? {user:{id:'fixture', email:body.email, identities:[]}, session:null}
          : {code:'invalid_credentials', message:'Invalid login credentials'})});
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:4781');
      await expect(page.getByText('Welcome back — sign in to pick up your streak.', {exact:true})).toBeVisible();
      const password = page.getByPlaceholder('At least 6 characters');
      const show = page.getByRole('button', {name:'Show password', exact:true});
      const hide = page.getByRole('button', {name:'Hide password', exact:true});
      await expect(password).toHaveJSProperty('type', 'password');
      // Also fails against the original UI, which has no visibility control.
      await expect(show).toBeVisible({timeout:2000});
      const value = 'Fixture-Password-182!';
      await page.getByPlaceholder('you@example.com').fill('fixture@example.invalid');
      await password.fill(value);
      const toggle = async () => {
        await show.click();
        await expect(password).toHaveJSProperty('type', 'text');
        await expect(password).toHaveValue(value);
        await hide.focus();
        await page.keyboard.press('Enter');
        await expect(password).toHaveJSProperty('type', 'password');
        await expect(password).toHaveValue(value);
      };
      await toggle();
      await show.click();
      await page.getByRole('button', {name:'New here? Create an account', exact:true}).click();
      await expect(password).toHaveJSProperty('type', 'password');
      await expect(password).toHaveValue(value);
      await expect(password).toHaveAttribute('autocomplete', 'new-password');
      await toggle();
      await show.click();
      await page.getByRole('button', {name:'Already have an account? Sign in', exact:true}).click();
      await expect(password).toHaveJSProperty('type', 'password');
      await expect(password).toHaveAttribute('autocomplete', 'current-password');
      console.log(`PASS (${colorScheme}): sign-in/signup toggle, keyboard control, retained value, and mode remasking`);

      await show.click();
      await page.getByRole('button', {name:'Sign in', exact:true}).click();
      await expect.poll(() => requests.length).toBe(1);
      await expect(password).toHaveJSProperty('type', 'password');
      await expect(show).toBeDisabled();
      await expect(password).not.toBeEditable();
      assert.equal(requests[0].body.password, value);
      release();
      await expect(show).toBeEnabled();
      await expect(password).toHaveValue(value);
      await expect(password).toHaveJSProperty('type', 'password');
      await page.getByRole('button', {name:'New here? Create an account', exact:true}).click();
      await show.click();
      await page.getByRole('button', {name:'Create account', exact:true}).click();
      await expect.poll(() => requests.length).toBe(2);
      await expect(show).toBeDisabled();
      assert.equal(requests[1].body.password, value);
      release();
      await expect(page.getByText('Check your email', {exact:true})).toBeVisible();
      await expect(page.getByText('Welcome back — sign in to pick up your streak.', {exact:true})).toBeVisible();
      await expect(password).toHaveJSProperty('type', 'password');
      console.log(`PASS (${colorScheme}): in-flight requests mask/disable the field and signup returns masked`);

      for (const width of [320, 390, 960]) {
        await page.setViewportSize({width, height:844});
        const box = await show.boundingBox();
        assert(box.width >= 44 && box.height >= 44, 'Visibility control must remain tappable');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      }
      await page.setViewportSize({width:390, height:844});
      await password.fill('');
      await page.getByPlaceholder('you@example.com').fill('');
      if (process.env.PASSWORD_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.PASSWORD_SCREENSHOT_DIR, {recursive:true});
        await page.screenshot({path:path.join(process.env.PASSWORD_SCREENSHOT_DIR, `password-${colorScheme}.png`)});
      }
      await show.click();
      await page.reload();
      await expect(password).toHaveJSProperty('type', 'password');
      await expect(password).toHaveValue('');
      assert.deepEqual(errors, []);
      console.log(`PASS (${colorScheme}): responsive touch targets and reload starts masked with no persisted password`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error); process.exitCode = 1; server.close();});
