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
  for(const theme of ['light','dark']) {
   let online=true, hold=false, release, reads=0;
   const errors=[], acknowledgements=[];
   const other={...session,access_token:'fixture-b',user:{...session.user,id:'22222222-2222-2222-2222-222222222222',email:'second@example.invalid'}};
   const definitions=[['candle','First flame',7],['flame','Steady fire',30],['spark','Bright spark',90],['sun','Guiding light',180],['emblem','Year of discovery',365],['compass','Trailblazer',500],['star','Golden legacy',1000],['planet','Beyond the horizon',5000],['universe','Universe of knowledge',10000]];
   const awards={current_streak:5,longest_streak:30,items:definitions.map(([art,name,n])=>({code:`streak_${n}`,metric:'consecutive_days',threshold:n,name,description:`${n} days of learning.`,artwork_key:art,earned_on:n<=30?'2026-08-20':null,seen_at:null,source:n<=30?'history':null}))};
   const state={display_name:'Reader',timezone:'UTC',today,followed_topics:['computer-science'],learned:[],likes:[],bookmarks:[],saved:[],stats:{current:5,longest:30,total_learned:0,total_reviews:0},assignment_slug:concept.slug,daily:{assigned_for:today,assigned_at:today+'T08:00:00Z',learned:false,completed_at:null,outside_followed_topics:false,concept}};
   const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
   await context.addInitScript(({session,version,theme})=>{
    if(!localStorage.getItem('test-initialized')) {
     localStorage.setItem('sb-127-auth-token',JSON.stringify(session));
     localStorage.setItem('one-concept/last-seen-version/v1','1.8.0');
     localStorage.setItem('one-concept/theme/v1',theme);
     localStorage.setItem('test-initialized','true');
    }
   },{session,version,theme});
   await context.route('**/api/**',async route=>{
    if(!online)return route.abort('internetdisconnected');
    const endpoint=new URL(route.request().url()).pathname.replace('/api','');let body={};
    const isOther=route.request().headers().authorization==='Bearer fixture-b';
    if(endpoint==='/v1/me/state')body=state;
    else if(endpoint==='/v1/topics')body=[{slug:'computer-science',name:'Computer Science',concept_count:125,following:true}];
    else if(endpoint==='/v1/me/notifications')body={enabled:false,reminder_times:['08:00']};
    else if(endpoint==='/v1/me/achievements') {
     reads++;
     body=isOther?{current_streak:0,longest_streak:0,items:awards.items.map(a=>({...a,earned_on:null,seen_at:null}))}:structuredClone(awards);
     if(hold&&!isOther)await new Promise(r=>release=r);
    }
    else if(endpoint==='/v1/me/achievements/seen') {
     acknowledgements.push(route.request().headers().authorization);
     assert.equal(isOther,false,'old dismissal must never use replacement token');
     const {codes}=route.request().postDataJSON();awards.items.forEach(a=>{if(codes.includes(a.code))a.seen_at=new Date().toISOString();});
     return route.fulfill({status:204});
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(new URL(route.request().url()).pathname.endsWith('/token')?other:session)}));
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4781');
   await expect(page.getByRole('button',{name:'Got it',exact:true})).toBeVisible();
   await expect(page.getByText(`Version ${version}`,{exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Continue learning'})).toHaveCount(0);
   await page.screenshot({path:`/tmp/release-whats-new-${theme}.png`});
   await page.getByRole('button',{name:'Got it',exact:true}).click();
   await expect.poll(()=>page.evaluate(()=>localStorage.getItem('one-concept/last-seen-version/v1'))).toBe(version);
   await expect(page.getByText('2 achievements earned',{exact:true})).toBeVisible();
   await page.screenshot({path:`/tmp/209-celebration-${theme}.png`});
   await page.getByRole('button',{name:'Continue learning',exact:true}).click();
   await expect.poll(()=>acknowledgements.length).toBeGreaterThan(0);
   await page.getByRole('tab',{name:'Profile'}).click();
   await page.getByRole('button',{name:'Open achievements'}).click();
   await expect(page.getByText('2 / 9 earned',{exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'First flame, 7 day achievement, earned'})).toBeVisible();
   assert.equal(await page.getByRole('button',{name:/90 day achievement/}).count(),0);
   await page.screenshot({path:`/tmp/209-collection-${theme}.png`});
   await page.getByRole('button',{name:'First flame, 7 day achievement, earned'}).click();
   await expect(page.getByText('Earned 2026-08-20',{exact:true})).toBeVisible();
   const contrast=await page.getByText('7 days of learning.',{exact:true}).evaluate((el,theme)=>{
    const rgb=s=>s.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
    const lum=s=>{const c=rgb(s);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
    const fg=lum(getComputedStyle(el).color),bg=lum(theme==='light'?'rgb(255,255,255)':'rgb(20,24,40)');
    return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
   },theme);assert.ok(contrast>=4.5,`detail contrast ${contrast}`);
   await page.screenshot({path:`/tmp/209-detail-${theme}.png`});
   await page.getByRole('button',{name:'Close achievement'}).click();
   // Narrow layout, enlarged text, long milestones and one-column collection.
   await page.setViewportSize({width:320,height:640});
   await page.evaluate(()=>document.querySelectorAll('div,span').forEach(el=>{
    if(el.childNodes.length===1&&el.firstChild?.nodeType===Node.TEXT_NODE){const s=getComputedStyle(el);el.style.fontSize=(parseFloat(s.fontSize)*1.6)+'px';const line=parseFloat(s.lineHeight);if(Number.isFinite(line))el.style.lineHeight=(line*1.6)+'px';}
   }));
   await page.getByText('10,000 days',{exact:true}).scrollIntoViewIfNeeded();
   const bounds=await page.getByText('10,000 days',{exact:true}).boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=321);
   // Offline reload retains awards and suppresses an already-dismissed celebration.
   online=false;await page.reload();
   await expect(page.getByRole('button',{name:'Got it',exact:true})).toHaveCount(0);
   await page.getByRole('tab',{name:'Profile'}).click();
   await page.getByRole('button',{name:'Open achievements'}).click();
   await expect(page.getByText('2 / 9 earned',{exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Continue learning'})).toHaveCount(0);
   online=true;hold=true;
   await page.getByRole('button',{name:'Refresh achievements',exact:true}).click();
   await expect.poll(()=>Boolean(release)).toBe(true);
   await page.getByRole('button',{name:'Back',exact:true}).click();
   await page.getByText('Sign out',{exact:true}).click();
   await page.getByPlaceholder('you@example.com').fill('second@example.invalid');
   await page.getByRole('textbox',{name:'Password',exact:true}).fill('test-password');
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await page.getByRole('tab',{name:'Profile'}).click();
   await page.getByRole('button',{name:'Open achievements'}).click();
   await expect(page.getByText('0 / 9 earned',{exact:true})).toBeVisible();
   hold=false;release();
   await page.waitForTimeout(500);
   await expect(page.getByRole('button',{name:'First flame, 7 day achievement, earned'})).toHaveCount(0);
   await expect(page.getByRole('button',{name:'Continue learning'})).toHaveCount(0);
   assert.deepEqual(errors,[]);
   console.log(`${theme}: grouped celebration, dismissal, collection, details, narrow/large text, offline restart and in-flight A-to-B switching passed (${reads} reads)`);
   await context.close();
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
