const { chromium, expect } = require(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const appVersion = require('../app.config.js').expo.version;
const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'index.html'))) throw new Error('Pass an Expo web export directory as the first argument.');
const baseline = process.argv.includes('--baseline');
const midnight = process.argv.includes('--midnight');
const largeCollections = process.argv.includes('--large-collections');
const date = new Date().toISOString().slice(0, 10);
const concept = (slug, title) => ({ id: slug, slug, title, summary: `Full explanation of ${title}.`, example: `A concrete example of ${title}.`, topic_slug: 'computer-science', topic_name: 'Computer Science', like_count: 2 });
const daily = concept('fixture-daily', 'Daily fixture');
const saved = concept('fixture-saved', 'Saved fixture');
const unread = concept('fixture-unread', 'Unread saved fixture');
const state = { display_name: 'Fixture', timezone: 'UTC', today: date, followed_topics: ['computer-science'], learned: [], likes: [], bookmarks: [saved.slug, unread.slug], saved: [saved, unread].map(c => ({concept_slug:c.slug, title:c.title, topic_name:c.topic_name})), stats: {current:0,longest:0,total_learned:0}, assignment_slug: daily.slug, daily: { assigned_for: date, assigned_at: new Date().toISOString(), completed_at: null, learned:false, outside_followed_topics:false, concept:daily } };
const collection = [saved, unread, ...Array.from({length:363}, (_, i) => concept(`older-${i}`, `Older lesson ${i}`))];
collection[364] = {...collection[364], title:'Older mathematics fixture', topic_name:'Mathematics'};
if (largeCollections) {
  state.bookmarks = collection.map(c=>c.slug);
  state.saved = collection.slice(0,50).map(c=>({concept_slug:c.slug,title:c.title,topic_name:c.topic_name,like_count:c.like_count}));
  state.saved_next_cursor = '50';
  state.learned = state.saved.map((c,i)=>({...c,learned_on:new Date(Date.now()-(i+1)*86400000).toISOString().slice(0,10)}));
  state.learned_before_window = {'Computer Science':314,Mathematics:1};
  state.stats = {current:365,longest:365,total_learned:365};
}
let savedRequests = 0, failSaved = false, holdSaved = false, releaseSaved;
let online = true;
let failLikes = false;
let failTopics = false;
let stateRequests = 0, topicRequests = 0;
let holdLike = false, releaseLike;
const writes = [];
const errors = [];
const session = { access_token:'fixture', refresh_token:'fixture-refresh', token_type:'bearer', expires_in:864000, expires_at:Math.floor(Date.now()/1000)+864000, user:{ id:'11111111-1111-1111-1111-111111111111', email:'fixture@example.invalid', aud:'authenticated', role:'authenticated', app_metadata:{}, user_metadata:{}, created_at:'2026-01-01T00:00:00Z' } };
const server = http.createServer((req,res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(root, relative === '/' ? 'index.html' : relative);
  try { const body = fs.readFileSync(file); res.setHeader('Content-Type', ({'.html':'text/html','.js':'application/javascript','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)] || 'application/octet-stream'); res.end(body); }
  catch { res.statusCode=404; res.end(); }
});
(async () => {
 await new Promise(r => server.listen(4781, '127.0.0.1', r));
 const browser = await chromium.launch({ executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH, headless:true, args:['--no-sandbox'] });
 try {
  const context = await browser.newContext({viewport:{width:390,height:844},timezoneId:'UTC'});
  await context.addInitScript(({session, appVersion}) => {
    Object.defineProperty(navigator, 'share', {configurable:true,value:async data=>{window.fixtureShared=data;}});
    if (!localStorage.getItem('fixture-seeded')) {
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
      localStorage.setItem('one-concept/last-seen-version/v1',appVersion);
      localStorage.setItem('fixture-seeded','yes');
    }
  }, {session, appVersion});
  await context.route('**/api/**', async route => {
    if (!online) return route.abort('internetdisconnected');
    const req = route.request(); const endpoint = new URL(req.url()).pathname.replace('/api','');
    const method = req.method();
    if (endpoint === '/v1/me/state') {
      stateRequests++;
    }
    if (process.argv.includes('--require-compact') && ['/v1/me/state','/v1/me/topics','/v1/me'].includes(endpoint)) {
      assert.equal(new URL(req.url()).searchParams.get('compact'),'true');
    }
    if (endpoint === '/v1/me/saved') {
      savedRequests++;
      if (holdSaved) await new Promise(r=>{releaseSaved=r;});
      if (failSaved) return route.fulfill({status:503,contentType:'application/json',body:'{}'});
      const url=new URL(req.url()); const offset=Number(url.searchParams.get('cursor'));
      assert.equal(url.searchParams.get('limit'),'50');
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        items:collection.slice(offset,offset+50).map(c=>({concept_slug:c.slug,title:c.title,topic_name:c.topic_name,like_count:c.like_count})),
        next_cursor:offset+50<collection.length ? String(offset+50) : null,
      })});
    }
    if (endpoint === '/v1/topics') {
      topicRequests++;
      if (failTopics) return route.abort('connectionreset');
    }
    if (holdLike && endpoint.endsWith('/like')) { await new Promise(r=>{releaseLike=r;}); return route.abort('internetdisconnected'); }
    if (method !== 'GET') writes.push({endpoint,method,body:req.postDataJSON()});
    if (failLikes && endpoint.endsWith('/like')) return route.fulfill({status:503,contentType:'application/json',body:'{}'});
    let body = {};
    if (endpoint === '/v1/me/topics' && method === 'PUT') state.followed_topics = req.postDataJSON().topics;
    const interaction = endpoint.match(/^\/v1\/concepts\/([^/]+)\/(like|save)$/);
    if (interaction) {
      const key=interaction[2]==='like'?'likes':'bookmarks'; const slug=interaction[1];
      state[key] = state[key].filter(id=>id!==slug);
      if(method==='PUT') state[key].push(slug);
    }
    if (endpoint === '/v1/me/state' || endpoint === '/v1/me/topics') body=state;
    else if (endpoint === '/v1/topics' && largeCollections) body=[
      {slug:'computer-science',name:'Computer Science',concept_count:400,following:true},
      {slug:'mathematics',name:'Mathematics',concept_count:25,following:false},
    ];
    else if (endpoint === '/v1/topics') body=[{slug:'computer-science',name:'Computer Science',concept_count:25},{slug:'new-topic',name:'New topic',concept_count:12}].map(t=>({...t,following:state.followed_topics.includes(t.slug)}));
    else if (endpoint.startsWith('/v1/concepts/') && method === 'GET') body=[daily,...(largeCollections ? collection : [saved,unread])].find(c=>endpoint.endsWith(c.slug));
    else if (endpoint === '/v1/me/notifications') body={enabled:false,reminder_times:[]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await context.route('**/auth/v1/**', route => route.abort('internetdisconnected'));
  const page=await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));
  const profile=async()=>page.getByText('Profile',{exact:true}).last().click();
  const close=async()=>page.getByRole('button',{name:'Close',exact:true}).last().click();
  const queue=async()=>page.evaluate(()=>JSON.parse(localStorage.getItem('one-concept/mutation-queue/v1')||'{}'));
  if (midnight) await page.clock.setFixedTime(new Date(date+'T23:59:00Z'));
  await page.goto('http://127.0.0.1:4781');
  await expect(page.getByText(daily.summary,{exact:true})).toBeVisible();
  if (largeCollections) {
    assert.equal(savedRequests,0,'Older Saved metadata must not load on startup');
    await page.getByText('Stats',{exact:true}).last().click();
    await expect(page.getByText('365 / 425',{exact:true})).toBeVisible();
    await expect(page.getByText('364 / 400',{exact:true})).toBeVisible();
    await expect(page.getByText('1 / 25',{exact:true})).toBeVisible();
    console.log('PASS: compact startup retains all-time and per-topic totals');
    await expect.poll(async()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('one-concept/concepts/')).length),{timeout:30000}).toBe(366);
    // No Saved screen/cache yet: downloaded lesson bodies must supply older titles offline.
    online=false; await page.reload();
    await expect(page.getByText(daily.summary,{exact:true})).toBeVisible();
    await profile(); await page.getByText('Saved concepts',{exact:true}).click();
    await page.getByPlaceholder('Search saved concepts').fill('Older mathematics');
    await page.getByRole('button',{name:'Open Older mathematics fixture',exact:true}).click();
    await expect(page.getByText(collection[364].summary,{exact:true})).toBeVisible();
    await close();
    console.log('PASS: unopened older saved lesson remains searchable and readable offline');
    await page.getByRole('button',{name:'Back',exact:true}).click();
    // Force page loading to prove that search/filter do not merely rely on cached bodies.
    await page.evaluate(()=>{for(const k of Object.keys(localStorage)) if(k.startsWith('one-concept/concepts/') || k.startsWith('one-concept/saved-list/')) localStorage.removeItem(k);});
    online=true; failSaved=true;
    await page.reload(); await expect(page.getByText(daily.summary,{exact:true})).toBeVisible();
    await profile(); await page.getByText('Saved concepts',{exact:true}).click();
    await expect(page.getByText('Some saved concepts could not be refreshed. Tap to retry.',{exact:true})).toBeVisible();
    const beforeRetry=savedRequests;
    await page.waitForTimeout(1500); assert.equal(savedRequests,beforeRetry,'Failed pages must not spin');
    failSaved=false;
    await page.getByText('Some saved concepts could not be refreshed. Tap to retry.',{exact:true}).click();
    await expect.poll(()=>savedRequests-beforeRetry).toBe(7);
    await expect(page.getByText('Loading more saved concepts…',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Mathematics',exact:true}).click();
    await page.getByPlaceholder('Search saved concepts').fill('Older mathematics');
    await page.getByRole('button',{name:'Open Older mathematics fixture',exact:true}).click();
    await expect(page.getByText(collection[364].summary,{exact:true})).toBeVisible();
    await close();
    if(process.env.COLLECTION_SCREENSHOT_PATH) await page.screenshot({path:process.env.COLLECTION_SCREENSHOT_PATH});
    console.log('PASS: bounded pages, retry, older title search, and category filter');
    online=false; await page.reload(); await expect(page.getByText(daily.summary,{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Mark as learned',exact:true}).click();
    await expect.poll(async()=>(await queue()).learn?.date).toBe(date);
    await page.getByText('Stats',{exact:true}).last().click();
    await expect(page.getByText('366 / 425',{exact:true})).toBeVisible();
    await expect(page.getByText('365 / 400',{exact:true})).toBeVisible();
    console.log('PASS: offline completion increments aggregate and category totals');
    await profile(); await page.getByText('Saved concepts',{exact:true}).click();
    await page.getByPlaceholder('Search saved concepts').fill('Older mathematics');
    await page.getByRole('button',{name:'Open Older mathematics fixture',exact:true}).click();
    await page.getByRole('button',{name:'Remove from saved',exact:true}).last().click();
    await expect.poll(async()=>(await queue())['save:older-362']?.desired).toBe(false);
    await close();
    await expect(page.getByRole('button',{name:'Open Older mathematics fixture',exact:true})).toHaveCount(0);
    console.log('PASS: pending unsave overrides cached page membership');
    // Drop only this test's pending actions to isolate a late successful page response.
    await page.evaluate(()=>localStorage.removeItem('one-concept/mutation-queue/v1'));
    online=true; holdSaved=true;
    await page.reload(); await expect(page.getByText(daily.summary,{exact:true})).toBeVisible();
    await profile(); await page.getByText('Saved concepts',{exact:true}).click();
    await expect.poll(()=>Boolean(releaseSaved)).toBe(true);
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await page.getByText('Sign out',{exact:true}).click();
    await expect(page.getByText('Welcome back — sign in to pick up your streak.',{exact:true})).toBeVisible();
    holdSaved=false; releaseSaved(); await page.waitForTimeout(500);
    await expect.poll(async()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('one-concept/saved-list/') || k.startsWith('one-concept/concepts/')).length)).toBe(0);
    assert.deepEqual(errors,[]);
    console.log('PASS: sign-out fences a late Saved page and removes collection caches');
    return;
  }
  if (process.argv.includes('--partial-connectivity')) {
    await expect.poll(()=>topicRequests).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    const beforeState=stateRequests, beforeTopics=topicRequests;
    failTopics=true;
    await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
    await expect.poll(()=>topicRequests-beforeTopics).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    assert.equal(stateRequests-beforeState,1);
    assert.equal(topicRequests-beforeTopics,1);
    await expect.poll(()=>topicRequests-beforeTopics,{timeout:7000}).toBe(2);
    await page.waitForTimeout(1000);
    assert.equal(stateRequests-beforeState,2);
    assert.equal(topicRequests-beforeTopics,2);
    // Recover without an online event: the backed-off timer must still retry.
    failTopics=false;
    await expect.poll(()=>topicRequests-beforeTopics,{timeout:12000}).toBe(3);
    await expect(page.getByText('Offline — changes will sync when you reconnect',{exact:true})).toHaveCount(0);
    await page.waitForTimeout(1000);
    assert.equal(stateRequests-beforeState,3);
    assert.equal(topicRequests-beforeTopics,3);
    assert.deepEqual(errors,[]);
    console.log('PASS: partial connectivity backs off, recovers automatically, and stops polling');
    return;
  }
  if (midnight) {
    holdLike=true;
    await page.getByRole('button',{name:'Like',exact:true}).click();
    await expect.poll(()=>Boolean(releaseLike)).toBe(true);
    await page.clock.setFixedTime(new Date(new Date(date+'T23:59:00Z').getTime()+120000));
    await page.getByRole('button',{name:'Save for later',exact:true}).click();
    // Let the date-change effect run while Save is waiting behind Like.
    await page.waitForTimeout(300);
    online=false; holdLike=false; releaseLike(); releaseLike=undefined;
    await expect.poll(async()=>(await queue())['save:fixture-daily']?.desired).toBe(true);
    await expect(page.getByRole('button',{name:'Remove from saved',exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button',{name:'Remove from saved',exact:true})).toBeVisible();
    online=true; await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await expect.poll(async()=>Object.keys(await queue()).length).toBe(0);
    assert(state.bookmarks.includes(daily.slug));
    assert(writes.some(w=>w.endpoint==='/v1/concepts/fixture-daily/save' && w.method==='PUT'));
    assert.deepEqual(errors,[]);
    console.log('PASS: save queued across midnight survives restart and syncs');
    return;
  }
  await profile(); await page.getByText('Saved concepts',{exact:true}).click();
  await page.getByRole('button',{name:'Open Saved fixture',exact:true}).click();
  await expect(page.getByText(saved.summary,{exact:true})).toBeVisible();
  console.log('CONTROL: saved detail loads online');
  online=false; await page.reload();
  await expect(page.getByText(daily.summary,{exact:true})).toBeVisible();
  await profile(); await page.getByText('Saved concepts',{exact:true}).click();
  await page.getByRole('button',{name:'Open Saved fixture',exact:true}).click();
  if (baseline) await expect(page.getByText('This concept couldn’t be loaded. Check your connection and try again.',{exact:true})).toBeVisible();
  else await expect(page.getByText(saved.summary,{exact:true})).toBeVisible();
  console.log(baseline?'CONFIRMED: previously viewed saved body unavailable offline':'PASS: viewed saved body survives offline restart');
  if (process.env.OFFLINE_SCREENSHOT_PATH) await page.screenshot({path:process.env.OFFLINE_SCREENSHOT_PATH});
  if (!baseline) {
    await page.getByRole('button',{name:'Share',exact:true}).last().click();
    await expect.poll(()=>page.evaluate(()=>window.fixtureShared?.text)).toContain(saved.summary);
    console.log('PASS: sharing cached text works offline');
  }
  await close();
  if (!baseline) {
    await page.getByRole('button',{name:'Open Unread saved fixture',exact:true}).click();
    await expect(page.getByText(unread.summary,{exact:true})).toBeVisible();
    console.log('PASS: saved body downloaded without opening its detail'); await close();
  }
  online=true; await page.reload();
  await expect(page.getByText(daily.summary,{exact:true})).toBeVisible();
  await profile(); await page.getByText('Personalize your feed',{exact:true}).click();
  await expect(page.getByText('New topic',{exact:true})).toBeVisible();
  online=false; await page.getByText('Follow',{exact:true}).click();
  await expect(page.getByText('Following',{exact:true})).toHaveCount(2);
  await page.waitForTimeout(500);
  if (baseline) assert.equal((await queue()).topics, undefined);
  else assert.deepEqual((await queue()).topics.slugs,['computer-science','new-topic']);
  console.log(baseline?'CONFIRMED: offline topic change is not in persistent queue':'PASS: offline topic change is queued');
  await page.reload(); await expect(page.getByText(daily.summary,{exact:true})).toBeVisible();
  await profile(); await page.getByText('Personalize your feed',{exact:true}).click();
  if(baseline) await expect(page.getByText('Connect to load your topics and choose what to learn next.',{exact:true})).toBeVisible();
  else { await expect(page.getByText('New topic',{exact:true})).toBeVisible(); await expect(page.getByText('Following',{exact:true})).toHaveCount(2); }
  console.log(baseline?'CONFIRMED: warm topic catalog lost on offline restart':'PASS: catalog and followed choices survive offline restart');
  await close(); await page.getByText('Today',{exact:true}).last().click();
  await page.getByRole('button',{name:'Like',exact:true}).click();
  await expect.poll(async()=>(await queue())['like:fixture-daily']?.desired).toBe(true);
  console.log('CONTROL: offline like is persistently queued');
  const before=writes.length; online=true;
  if (!process.argv.includes('--no-event')) await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  if(baseline) { await page.waitForTimeout(2500); assert.equal(writes.length,before); assert.equal((await queue())['like:fixture-daily'].desired,true); }
  else { await expect.poll(async()=>Object.keys(await queue()).length,{timeout:35000}).toBe(0); assert(state.likes.includes('fixture-daily')); assert(state.followed_topics.includes('new-topic')); }
  console.log(baseline?'CONFIRMED: connectivity restore alone does not flush queue':'PASS: reconnection automatically flushes likes and topics');
  if (!baseline) {
    await profile(); await page.getByText('Personalize your feed',{exact:true}).click();
    await expect(page.getByText('Following',{exact:true})).toHaveCount(2);
    await close(); await page.getByText('Today',{exact:true}).last().click();
    if (process.argv.includes('--retry-error')) {
      online=false; await page.getByRole('button',{name:'Unlike',exact:true}).click();
      await expect.poll(async()=>(await queue())['like:fixture-daily']?.desired).toBe(false);
      failLikes=true; online=true;
      await page.evaluate(()=>window.dispatchEvent(new Event('online')));
      await page.waitForTimeout(1500);
      await expect(page.getByRole('button',{name:'Like',exact:true})).toBeVisible();
      assert.equal((await queue())['like:fixture-daily'].desired,false);
      console.log('PASS: transient replay error preserves pending unlike in the UI');
      failLikes=false; await page.evaluate(()=>window.dispatchEvent(new Event('online')));
      await expect.poll(async()=>Object.keys(await queue()).length).toBe(0);
    }
    online=false;
    await page.getByRole('button',{name:'Save for later',exact:true}).click();
    await expect.poll(async()=>(await queue())['save:fixture-daily']?.desired).toBe(true);
    await page.reload(); await expect(page.getByText(daily.summary,{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Remove from saved',exact:true})).toBeVisible();
    await profile(); await page.getByText('Saved concepts',{exact:true}).click();
    await page.getByRole('button',{name:'Open Daily fixture',exact:true}).click();
    await expect(page.getByText(daily.summary,{exact:true}).last()).toBeVisible();
    await close(); await page.getByRole('button',{name:'Back',exact:true}).click();
    console.log('PASS: offline save survives restart and its full text opens from Saved');
    if (process.argv.includes('--signout-inflight')) {
      online=true; holdLike=true;
      await page.getByText('Today',{exact:true}).last().click();
      await page.getByRole('button',{name:/^(Like|Unlike)$/}).click();
      await expect.poll(()=>Boolean(releaseLike)).toBe(true);
      await profile();
    }
    await page.getByText('Sign out',{exact:true}).click();
    await expect(page.getByText('Welcome back — sign in to pick up your streak.',{exact:true})).toBeVisible();
    if (releaseLike) { releaseLike(); await page.waitForTimeout(500); }
    await expect.poll(async()=>page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('one-concept/concepts/') || key.startsWith('one-concept/topics/') || key.startsWith('one-concept/saved-list/') || key==='one-concept/mutation-queue/v1').length)).toBe(0);
    console.log('PASS: sign-out removes full lessons, topics, and queued actions');
  }
  assert.deepEqual(errors,[]); console.log('No browser runtime errors');
 } finally { await browser.close(); await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
