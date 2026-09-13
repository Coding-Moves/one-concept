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
 try{
  for(const theme of ['light','dark']){
   let online=true,completions=0,stateReads=0;
   const errors=[];
   const state={display_name:'Reader',timezone:'UTC',today,followed_topics:['computer-science'],learned:[{concept_slug:concept.slug,learned_on:'2026-01-01',title:concept.title,topic_name:concept.topic_name}],likes:[],bookmarks:[],saved:[],stats:{current:4,longest:8,total_learned:25,total_reviews:2},assignment_slug:null,daily:null,review:{review_id:'22222222-2222-4222-8222-222222222222',assigned_for:today,assigned_at:today+'T08:00:00Z',completed_at:null,learned:false,outside_followed_topics:false,concept}};
   const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'UTC'});
   await context.addInitScript(({session,version,theme})=>{
    if(!localStorage.getItem('fixture-seeded')){
     localStorage.setItem('sb-127-auth-token',JSON.stringify(session));
     localStorage.setItem('one-concept/last-seen-version/v1',version);
     localStorage.setItem('one-concept/theme/v1',theme);
     localStorage.setItem('fixture-seeded','yes');
    }
   },{session,version,theme});
   await context.route('**/api/**',async route=>{
    if(!online) return route.abort('internetdisconnected');
    const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.replace('/api','');
    let body={};
    if(endpoint==='/v1/me/state'){
     assert.equal(url.searchParams.get('reviews'),'true');stateReads++;body=state;
    } else if(endpoint.startsWith('/v1/reviews/') && endpoint.endsWith('/complete')){
     assert.equal(endpoint,`/v1/reviews/${state.review.review_id}/complete`);
     completions++;
     if(!state.review.learned){state.review.learned=true;state.review.completed_at=today+'T09:00:00Z';state.stats.current=5;state.stats.total_reviews=3;}
     body={completed:true,assigned_for:today,stats:state.stats};
    } else if(endpoint==='/v1/topics') body=[{slug:'computer-science',name:'Computer Science',concept_count:25,following:true},{slug:'future-subject',name:'Future subject',concept_count:4,following:false}];
    else if(endpoint==='/v1/me/notifications') body={enabled:false,reminder_times:['08:00']};
    else if(endpoint.startsWith('/v1/concepts/')) body=concept;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)}));
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4781');
   await expect(page.getByText('Today’s review',{exact:true})).toBeVisible();
   // Use the actual theme switch; persisted key is verified by the app itself.
   const switcher=page.getByRole('button',{name:theme==='dark'?'Switch to dark mode':'Switch to light mode'});
   if(await switcher.count()) await switcher.click();
   await expect(page.getByRole('button',{name:'Complete review',exact:true})).toBeVisible();
   assert.equal(completions,0);
   await page.getByRole('button',{name:'Explore another subject',exact:true}).click();
   await expect(page.getByText('Future subject',{exact:true})).toBeVisible();
   await page.getByRole('tab',{name:'Today'}).click();
   online=false;await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
   await page.getByRole('button',{name:'Complete review',exact:true}).click();
   await expect(page.getByText('Review complete — your learning day counts.',{exact:true})).toBeVisible();
   await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('one-concept/server-state/v1')||'{}').stats?.totalReviews)).toBe(3);
   await page.reload();
   await expect(page.getByText('Review complete — your learning day counts.',{exact:true})).toBeVisible();
   assert.equal(completions,0);
   // A narrow viewport with enlarged text must retain reachable actions.
   await page.setViewportSize({width:320,height:568});
   await page.evaluate(()=>document.querySelectorAll('div,span').forEach(el=>{
    if(el.childNodes.length===1 && el.firstChild?.nodeType===Node.TEXT_NODE){const style=getComputedStyle(el);const size=parseFloat(style.fontSize);const line=parseFloat(style.lineHeight);el.style.fontSize=(size*1.5)+'px';if(Number.isFinite(line))el.style.lineHeight=(line*1.5)+'px';}
   }));
   await page.getByRole('button',{name:'Explore another subject',exact:true}).scrollIntoViewIfNeeded();
   await expect(page.getByRole('button',{name:'Explore another subject',exact:true})).toBeInViewport();
   await page.screenshot({path:`/tmp/one-concept-195-review-${theme}.png`,fullPage:true});
   await expect(page.getByRole('button',{name:'Explore another subject',exact:true})).toBeVisible();
   online=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
   await expect.poll(()=>completions,{timeout:20000}).toBe(1);
   await expect.poll(()=>page.evaluate(()=>localStorage.getItem('one-concept/mutation-queue/v1')||'{}')).toBe('{}');
   assert.equal(state.stats.total_learned,25);
   assert.equal(state.stats.total_reviews,3);
   await page.reload();
   await expect(page.getByText('Review complete — your learning day counts.',{exact:true})).toBeVisible();
   assert.equal(completions,1);
   await page.getByRole('tab',{name:'Stats'}).click();
   await expect(page.getByText('Reviews completed: 3',{exact:true})).toBeVisible();
   assert.deepEqual(errors,[]);
   await context.close();
   console.log(`${theme}: cached review, offline completion/restart, reconnect, subject exploration, separate stats passed (${stateReads} state reads)`);
  }
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
