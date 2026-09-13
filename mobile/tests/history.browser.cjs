const {chromium,expect}=require(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright/test');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.argv[2];
if(!root || !fs.existsSync(path.join(root,'index.html'))) throw Error('Pass the exported web directory');
const version=require('../app.config.js').expo.version;
const today=new Date().toISOString().slice(0,10);
const concept={id:'33333333-3333-4333-8333-333333333333',slug:'known-lesson',title:'Reviewing invariants',summary:'An invariant is a rule that stays true while a system changes. Use it to check whether each operation keeps your data consistent.',example:'A library book can have one active borrower. Returning and lending it should preserve that rule.',topic_slug:'computer-science',topic_name:'Computer Science',content_version:2,like_count:0};
const session={access_token:'fixture',refresh_token:'fixture-refresh',token_type:'bearer',expires_in:864000,expires_at:Math.floor(Date.now()/1000)+864000,user:{id:'11111111-1111-1111-1111-111111111111',email:'fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}};
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.join(root,relative==='/'?'index.html':relative);
 try {res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}
 catch{res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(4781,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 try {
  let online=true, failPage=false, holdPage=false, releasePage, pageRequests=0, detailRequests=0;
  const records=Array.from({length:120},(_,i)=>({concept_slug:`lesson-${i}`,title:`Historical lesson ${i}`,topic_name:'Computer Science',like_count:0,learned_on:new Date(Date.now()-(i+1)*86400000).toISOString().slice(0,10)}));
  const state={display_name:'Reader',timezone:'UTC',today,followed_topics:['computer-science'],learned:records.slice(0,50),history_next_cursor:records[49].learned_on,likes:[],bookmarks:[],saved:[],stats:{current:120,longest:120,total_learned:120,total_reviews:0},assignment_slug:concept.slug,daily:{assigned_for:today,assigned_at:today+'T08:00:00Z',learned:false,completed_at:null,outside_followed_topics:false,concept}};
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(({session,version})=>{
   if(!localStorage.getItem('fixture-seeded')){
    localStorage.setItem('sb-127-auth-token',JSON.stringify(session));
    localStorage.setItem('one-concept/last-seen-version/v1',version);
    localStorage.setItem('fixture-seeded','yes');
   }
  },{session,version});
  await context.route('**/api/**',async route=>{
   if(!online) return route.abort('internetdisconnected');
   const url=new URL(route.request().url()), endpoint=url.pathname.replace('/api','');let body={};
   if(endpoint==='/v1/me/state') {assert.equal(url.searchParams.get('compact'),'true');body=state;}
   else if(endpoint==='/v1/me/history') {
    pageRequests++;assert.equal(url.searchParams.get('limit'),'50');
    if(holdPage) await new Promise(r=>{releasePage=r;});
    if(failPage) return route.fulfill({status:503,contentType:'application/json',body:'{}'});
    const remaining=records.filter(r=>r.learned_on<url.searchParams.get('before'));
    const items=remaining.slice(0,50);body={items,next_cursor:remaining.length>50?items.at(-1).learned_on:null};
   } else if(endpoint==='/v1/topics') body=[{slug:'computer-science',name:'Computer Science',concept_count:125,following:true}];
   else if(endpoint==='/v1/me/notifications') body={enabled:false,reminder_times:['08:00']};
   else if(endpoint.startsWith('/v1/concepts/')) { detailRequests++;body={...concept,slug:decodeURIComponent(endpoint.split('/').pop()),title:'Historical lesson 119',summary:'Downloaded historical explanation.'}; }
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)}));
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Keyboard activation avoids racing the virtualized footer's scroll settling.
  const older=async label=>{const button=page.getByRole('button',{name:label,exact:true});await button.focus();await button.press('Enter');};
  await page.goto('http://127.0.0.1:4781');
  await expect(page.getByText('Today’s concept',{exact:true})).toBeVisible();assert.equal(pageRequests,0);
  await page.getByRole('tab',{name:'History'}).click();
  await expect(page.getByText('50 of 120 learned concepts loaded.',{exact:true})).toBeVisible();assert.equal(pageRequests,0);
  failPage=true;await older('Load older lessons');
  await expect(page.getByRole('button',{name:'Retry older lessons',exact:true})).toBeVisible();failPage=false;
  await older('Retry older lessons');
  await expect(page.getByText('100 of 120 learned concepts loaded.',{exact:true})).toBeVisible();
  await older('Load older lessons');
  await expect(page.getByText('120 of 120 learned concepts loaded.',{exact:true})).toBeVisible();
  await page.getByPlaceholder('Search loaded history').fill('Historical lesson 119');
  await page.getByRole('button',{name:'Open Historical lesson 119',exact:true}).click();
  await expect(page.getByText('Downloaded historical explanation.',{exact:true})).toBeVisible();
  online=false;await page.reload();await page.getByRole('tab',{name:'History'}).click();
  await expect(page.getByText('50 of 120 learned concepts loaded.',{exact:true})).toBeVisible();
  await older('Load older lessons');
  await expect(page.getByText('100 of 120 learned concepts loaded.',{exact:true})).toBeVisible();
  await older('Load older lessons');
  await expect(page.getByText('120 of 120 learned concepts loaded.',{exact:true})).toBeVisible();
  await page.getByPlaceholder('Search loaded history').fill('Historical lesson 119');
  await page.getByRole('button',{name:'Open Historical lesson 119',exact:true}).click();
  await expect(page.getByText('Downloaded historical explanation.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Refresh lesson',exact:true}).click();
  const previousDetails=detailRequests;online=true;
  await page.getByRole('button',{name:'Refresh lesson',exact:true}).click();
  await expect.poll(()=>detailRequests).toBe(previousDetails+1);
  console.log('PASS: bounded History pages, retry, search and downloaded history/detail after offline restart');
  online=true;holdPage=true;await page.reload();await page.getByRole('tab',{name:'History'}).click();
  await older('Load older lessons');await expect.poll(()=>!!releasePage).toBe(true);
  await page.getByRole('tab',{name:'Profile'}).click();await page.getByText('Sign out',{exact:true}).click();
  await expect(page.getByText('Welcome back — sign in to pick up your streak.',{exact:true})).toBeVisible();releasePage();
  await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('one-concept/history-pages/')).length)).toBe(0);
  assert.deepEqual(errors,[]);console.log('PASS: sign-out clears History pages and fences a late page response');await context.close();
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
