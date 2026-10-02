const {chromium,expect}=require(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright/test');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.argv[2];
if(!root || !fs.existsSync(path.join(root,'index.html'))) throw Error('Pass the exported web directory');
const version=require('../app.config.js').expo.version;
const today=new Date().toISOString().slice(0,10);
const concept={id:'33333333-3333-4333-8333-333333333333',slug:'idempotency',title:'Reviewing invariants',summary:'An invariant is a rule that stays true while a system changes. Use it to check whether each operation keeps your data consistent.',example:'A library book can have one active borrower. Returning and lending it should preserve that rule.',topic_slug:'computer-science',topic_name:'Computer Science',content_version:2,like_count:0};
const session={access_token:'fixture',refresh_token:'fixture-refresh',token_type:'bearer',expires_in:864000,expires_at:Math.floor(Date.now()/1000)+864000,user:{id:'11111111-1111-1111-1111-111111111111',email:'fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}};
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.join(root,relative==='/'?'index.html':relative);
 try {res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}
 catch{res.statusCode=404;res.end();}
});
// Run against the exported app with dummy Auth/API responses only.
const output=process.env.UI_SCREENSHOT_DIR || '/tmp/one-concept-280-screens';
fs.mkdirSync(output,{recursive:true});
(async()=>{
 await new Promise(r=>server.listen(4781,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 try {
  for(const theme of ['light','dark']) {
   let online=true, conceptStatus=200;
   const lesson={...concept,review:null};
   const state={display_name:'Reader',timezone:'UTC',today,followed_topics:['computer-science'],
    learned:[{concept_slug:lesson.slug,title:lesson.title,topic_name:'Computer Science',learned_on:today}],
    likes:[],bookmarks:[lesson.slug],saved:[{concept_slug:lesson.slug,title:lesson.title,topic_name:'Computer Science',like_count:0}],
    stats:{current:1,longest:1,total_learned:1,total_reviews:0},assignment_slug:lesson.slug,
    daily:{assigned_for:today,assigned_at:today+'T08:00:00Z',learned:true,completed_at:today+'T09:00:00Z',outside_followed_topics:false,concept:lesson}};
   const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:2});
   await context.addInitScript(({session,version,theme})=>{
    if(!localStorage.getItem('fixture-initialized')) {
     localStorage.setItem('sb-127-auth-token',JSON.stringify(session));
     localStorage.setItem('one-concept/last-seen-version/v1',version);
     localStorage.setItem('one-concept/theme/v1',theme);
     localStorage.setItem('fixture-initialized','true');
    }
   },{session,version,theme});
   await context.route('**/api/**',async route=>{
    if(!online)return route.abort();
    const endpoint=new URL(route.request().url()).pathname.replace('/api','');let body={};
    if(endpoint==='/v1/me/state')body=state;
    else if(endpoint==='/v1/topics')body=[{slug:'computer-science',name:'Computer Science',concept_count:3,following:true}];
    else if(endpoint==='/v1/me/notifications')body={enabled:false,reminder_times:['08:00']};
    else if(endpoint.startsWith('/v1/concepts/')) {
     if(conceptStatus!==200)return route.fulfill({status:conceptStatus,contentType:'application/json',body:JSON.stringify({detail:'Unavailable'})});
     body=lesson;
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)}));
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const credit=()=>page.getByText(/^Reviewed by /).filter({visible:true});
   await page.goto('http://127.0.0.1:4781');
   await expect(page.getByText(lesson.title,{exact:true})).toBeVisible();
   await expect(credit()).toHaveCount(0);
   // Same-version legacy attestation should appear after online refresh.
   const longName='Alexandra Maria Elizabeth Catherine Williams Thompson';
   lesson.review={name:longName,reviewed_at:'2026-10-01T12:00:00Z',content_version:2};
   await page.getByRole('button',{name:'Refresh today',exact:true}).click();
   // Today stays focused on learning even when valid evidence is present.
   await expect(credit()).toHaveCount(0);
   await page.screenshot({path:path.join(output,`today-${theme}.png`)});
   await page.getByRole('tab',{name:'History'}).click();
   await page.getByRole('button',{name:'Open '+lesson.title,exact:true}).click();
   await expect(credit().last()).toHaveText('Reviewed by '+longName);
   await credit().scrollIntoViewIfNeeded();
   const metrics=await credit().evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth,border:getComputedStyle(el).borderTopWidth}));
   assert.ok(metrics.width<=360 && metrics.scroll<=metrics.client+1,JSON.stringify(metrics));
   assert.equal(parseFloat(metrics.border),0);
   await page.screenshot({path:path.join(output,`detail-${theme}.png`)});
   await page.getByRole('button',{name:'Close',exact:true}).click();
   await page.getByRole('tab',{name:'Profile'}).click();
   await page.getByText('Saved concepts',{exact:true}).click();
   await page.getByRole('button',{name:'Open '+lesson.title,exact:true}).click();
   await expect(credit().last()).toHaveText('Reviewed by '+longName);
   // Fresh version without evidence must remove the cached label entirely.
   lesson.content_version=3;lesson.summary='A newly published lesson body with no matching attribution.';lesson.review=null;
   await page.getByRole('button',{name:'Refresh lesson',exact:true}).click();
   await expect(page.getByText(lesson.summary,{exact:true}).last()).toBeVisible();
   await expect(credit()).toHaveCount(0);
   // New version receives its own name, including while the recall side is open.
   lesson.review={name:'Second Reviewer',reviewed_at:'2026-10-02T12:00:00Z',content_version:3};
   lesson.flashcard={front:'What must stay paired?',back:'The displayed body and its review evidence.'};
   await page.getByRole('button',{name:'Refresh lesson',exact:true}).click();
   await expect(credit()).toHaveText('Reviewed by Second Reviewer');
   await page.getByRole('button',{name:'Show recall answer'}).click();
   await page.waitForTimeout(350); // Let the 280ms flip finish before inspecting its image.
   await expect(page.getByText(lesson.flashcard.back,{exact:true})).toBeVisible();
   await expect(credit()).toHaveText('Reviewed by Second Reviewer');
   await credit().scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(output,`detail-recall-${theme}.png`)});
   await page.getByRole('button',{name:'Close',exact:true}).click();
   await page.getByRole('button',{name:'Back',exact:true}).click();
   await page.getByRole('tab',{name:'Today'}).click();
   await page.getByRole('button',{name:'Refresh today',exact:true}).click();
   await expect(credit()).toHaveCount(0);
   // Restart offline from a full cached state; no live metadata request needed.
   online=false;await page.reload();
   await expect(page.getByText(lesson.summary,{exact:true}).last()).toBeVisible();
   await expect(credit()).toHaveCount(0);
   await page.getByRole('tab',{name:'History'}).click();
   await page.getByRole('button',{name:'Open '+lesson.title,exact:true}).click();
   await expect(credit()).toHaveText('Reviewed by Second Reviewer');
   await page.getByRole('button',{name:'Close',exact:true}).click();
   // The fixture slug also exists in the bundled catalog: no demo resurrection.
   // A confirmed removal must replace an already painted cache, including on refresh.
   online=true;
   for(const status of [403,404,410]) {
    conceptStatus=200;
    await page.getByRole('button',{name:'Open '+lesson.title,exact:true}).click();
    await expect(credit()).toHaveText('Reviewed by Second Reviewer');
    await expect(page.getByRole('button',{name:'Refresh lesson',exact:true})).toBeEnabled();
    // A temporary service error still permits reading the downloaded pair.
    conceptStatus=503;
    await page.getByRole('button',{name:'Refresh lesson',exact:true}).click();
    await expect(page.getByRole('button',{name:'Refresh lesson',exact:true})).toBeEnabled();
    await expect(credit()).toHaveText('Reviewed by Second Reviewer');
    conceptStatus=status;
    await page.getByRole('button',{name:'Refresh lesson',exact:true}).click();
    await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
    await expect(credit()).toHaveCount(0);
    await expect(page.getByText(lesson.summary,{exact:true}).filter({visible:true})).toHaveCount(0);
    await expect.poll(()=>page.evaluate(slug=>localStorage.getItem('one-concept/concepts/v1/'+slug),lesson.slug)).toBe(null);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    // The next detail visit must also respect the server's denial.
    await page.getByRole('button',{name:'Open '+lesson.title,exact:true}).click();
    await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
    await expect(credit()).toHaveCount(0);
    await page.getByRole('button',{name:'Close',exact:true}).click();
   }
   // Refill before the existing offline/corrupt-cache checks.
   conceptStatus=200;
   await page.getByRole('button',{name:'Open '+lesson.title,exact:true}).click();
   await expect(credit()).toHaveText('Reviewed by Second Reviewer');
   await page.getByRole('button',{name:'Close',exact:true}).click();
   online=false;
   // A corrupted/stale cache pair must never show a mismatched version label.
   await page.evaluate(()=>{
    for(const key of Object.keys(localStorage).filter(k=>k.startsWith('one-concept/'))){
     try {const value=JSON.parse(localStorage.getItem(key));
      const scrub=obj=>{if(!obj||typeof obj!=='object')return;
       if(obj.review?.name==='Second Reviewer') {obj.review.content_version=99;obj.review.contentVersion=99;}
       Object.values(obj).forEach(scrub);};
      scrub(value);localStorage.setItem(key,JSON.stringify(value));
     }catch{}
    }
   });
   await page.reload();
   await expect(page.getByText(lesson.summary,{exact:true}).last()).toBeVisible();
   await expect(credit()).toHaveCount(0);
   await page.getByRole('tab',{name:'History'}).click();
   await page.getByRole('button',{name:'Open '+lesson.title,exact:true}).click();
   await expect(page.getByText(lesson.summary,{exact:true}).last()).toBeVisible();
   await expect(credit()).toHaveCount(0);
   await page.getByRole('button',{name:'Close',exact:true}).click();
   await page.getByRole('tab',{name:'Profile'}).click();
   await page.getByText('Sign out',{exact:true}).click();
   await expect(page.getByText('Welcome back',{exact:true})).toBeVisible();
   await expect.poll(async()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('one-concept/concepts/')).length)).toBe(0);
   assert.deepEqual(errors,[]);
   console.log(`${theme}: legacy/attested/corrected attribution, History/Saved, recall, offline restart, confirmed removal, temporary server failure, invalid cache, sign-out and detail-only wrapped borderless credit passed`);
   await context.close();
  }
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
