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
// The supplied Android screenshots are the before evidence. This checks the
// exported UI at narrow widths; browser text enlargement is not native font QA.
const output=process.env.UI_SCREENSHOT_DIR || '/tmp/one-concept-271-screens';
fs.mkdirSync(output,{recursive:true});
(async()=>{
 await new Promise(r=>server.listen(4781,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 try {
  for(const theme of ['light','dark']) {
   let catalogCount=25;
   const names=['Artificial Intelligence','Software Engineering','Computer Science','Mathematics','Linux & Systems'];
   const counts=[1,11,3,1,2];
   const saved=names.map((name,i)=>({concept_slug:`saved-${i}`,title:['Neural networks','Message queues','Database indexes','Vector spaces','The shell'][i],topic_name:name,like_count:0}));
   const state={display_name:'Reader',timezone:'UTC',today,followed_topics:['computer-science'],
    learned:[{concept_slug:concept.slug,title:concept.title,topic_name:'Computer Science',learned_on:today}],
    learned_before_window:Object.fromEntries(names.map((name,i)=>[name,counts[i]-(i===2?1:0)])),
    likes:[],bookmarks:saved.map(x=>x.concept_slug),saved,
    stats:{current:4,longest:4,total_learned:18,total_reviews:0},assignment_slug:concept.slug,
    daily:{assigned_for:today,assigned_at:today+'T08:00:00Z',learned:true,completed_at:today+'T09:00:00Z',outside_followed_topics:false,concept}};
   const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:2});
   await context.addInitScript(({session,version,theme})=>{
    localStorage.setItem('sb-127-auth-token',JSON.stringify(session));
    localStorage.setItem('one-concept/last-seen-version/v1',version);
    localStorage.setItem('one-concept/theme/v1',theme);
   },{session,version,theme});
   await context.route('**/api/**',async route=>{
    const endpoint=new URL(route.request().url()).pathname.replace('/api','');let body={};
    if(endpoint==='/v1/me/state')body=state;
    else if(endpoint==='/v1/topics')body=names.map((name,i)=>({slug:`topic-${i}`,name,concept_count:catalogCount,following:true}));
    else if(endpoint==='/v1/me/notifications')body={enabled:false,reminder_times:['08:00']};
    else if(endpoint.startsWith('/v1/concepts/'))body={...concept,slug:decodeURIComponent(endpoint.split('/').pop())};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)}));
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4781');
   const success=page.getByText('Learned today — see you tomorrow!',{exact:true});
   await success.scrollIntoViewIfNeeded();await expect(success).toBeVisible();
   const outlined=await success.evaluate(el=>getComputedStyle(el.parentElement).borderTopWidth);
   // Browsers may round a half-point CSS border to one device pixel.
   assert.ok(parseFloat(outlined)>0 && parseFloat(outlined)<=1, outlined);
   await page.screenshot({path:path.join(output,`today-${theme}.png`)});
   await page.getByRole('tab',{name:'Stats'}).click();
   await expect(page.getByText('Concepts learned',{exact:true})).toBeVisible();
   await expect(page.getByText('11 learned',{exact:true})).toBeVisible();
   await expect(page.getByText('3 learned',{exact:true})).toBeVisible();
   await expect(page.getByText('No reviews completed yet',{exact:true})).toBeVisible();
   await expect(page.getByText(/18 \/ 125|11 \/ 25/)).toHaveCount(0);
   await page.screenshot({path:path.join(output,`stats-${theme}.png`)});
   catalogCount=100;
   state.stats.total_reviews=2;
   await page.getByRole('button',{name:'Refresh stats',exact:true}).click();
   await expect(page.getByText('2 reviews completed',{exact:true})).toBeVisible();
   await expect(page.getByText('11 learned',{exact:true})).toBeVisible();
   await expect(page.getByText(/18 \/ 500|11 \/ 100/)).toHaveCount(0);
   delete state.stats.total_reviews;
   await page.getByRole('button',{name:'Refresh stats',exact:true}).click();
   await expect(page.getByText('Review activity unavailable',{exact:true})).toBeVisible();
   await page.getByRole('tab',{name:'Profile'}).click();
   await page.getByText('Saved concepts',{exact:true}).click();
   const all=page.getByRole('button',{name:'All',exact:true});
   await expect(all).toBeVisible();
   const assertChip=async locator=>{
    const metrics=await locator.evaluate(el=>{
     const box=el.getBoundingClientRect();
     let parent=el.parentElement;
     while(parent && getComputedStyle(parent).overflowX!=='auto' && getComputedStyle(parent).overflowX!=='scroll')parent=parent.parentElement;
     if(!parent)throw Error('Missing scroll rail');
     const rail=parent.getBoundingClientRect();
     return {height:box.height,top:box.top,bottom:box.bottom,railTop:rail.top,railBottom:rail.bottom};
    });
    assert.ok(metrics.height>=48,JSON.stringify(metrics));
    assert.ok(metrics.top>=metrics.railTop && metrics.bottom<=metrics.railBottom,JSON.stringify(metrics));
   };
   await assertChip(all);
   await page.screenshot({path:path.join(output,`saved-${theme}.png`)});
   const ai=page.getByRole('button',{name:'Artificial Intelligence',exact:true});
   await ai.click();
   await expect(page.getByRole('button',{name:'Open Neural networks',exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Open Message queues',exact:true})).toHaveCount(0);
   await all.click();
   await page.getByRole('textbox',{name:'Search saved concepts'}).fill('queues');
   await expect(page.getByRole('button',{name:'Open Message queues',exact:true})).toBeVisible();
   await page.getByRole('textbox',{name:'Search saved concepts'}).fill('');
   await page.setViewportSize({width:320,height:700});
   await page.evaluate(()=>document.querySelectorAll('div,span,input').forEach(el=>{
    if((el.childNodes.length===1&&el.firstChild?.nodeType===Node.TEXT_NODE)||el.tagName==='INPUT'){
     const s=getComputedStyle(el);el.style.fontSize=(parseFloat(s.fontSize)*1.8)+'px';
     const line=parseFloat(s.lineHeight);if(Number.isFinite(line))el.style.lineHeight=(line*1.8)+'px';
    }
   }));
   await assertChip(all);await assertChip(ai);
   await ai.scrollIntoViewIfNeeded();await ai.click();
   await expect(page.getByRole('button',{name:'Open Neural networks',exact:true})).toBeVisible();
   await page.screenshot({path:path.join(output,`saved-enlarged-${theme}.png`)});
   assert.deepEqual(errors,[]);
   console.log(`${theme}: success outline, learned totals, growing catalog, zero/nonzero/unavailable reviews, Saved filter/search and enlarged rail passed`);
   await context.close();
  }
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
