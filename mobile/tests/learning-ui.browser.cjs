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
   let online=true,reads=0,detailReads=0,hold=false,release;
   const errors=[];
   const state={display_name:'Reader',timezone:'UTC',today,followed_topics:['computer-science'],learned:[],likes:[],bookmarks:[],saved:[],stats:{current:0,longest:0,total_learned:0,total_reviews:0},assignment_slug:concept.slug,daily:{assigned_for:today,assigned_at:today+'T08:00:00Z',learned:false,completed_at:null,outside_followed_topics:false,concept}};
   const context=await browser.newContext({viewport:{width:320,height:700}});
   await context.addInitScript(({session,version,theme})=>{
    localStorage.setItem('sb-127-auth-token',JSON.stringify(session));
    localStorage.setItem('one-concept/last-seen-version/v1',version);
    localStorage.setItem('one-concept/theme/v1',theme);
   },{session:{...session,user:{...session.user,email:'averylongreadernamefortextsizing@example.invalid'}},version,theme});
   await context.route('**/api/**',async route=>{
    if(!online)return route.abort('internetdisconnected');
    const endpoint=new URL(route.request().url()).pathname.replace('/api','');let body={};
    if(endpoint==='/v1/me/state'){reads++;if(hold)await new Promise(r=>{release=r;});body=state;}
    else if(endpoint==='/v1/topics')body=[{slug:'computer-science',name:'Computer Science',concept_count:125,following:true}];
    else if(endpoint==='/v1/me/notifications')body={enabled:false,reminder_times:['08:00']};
    else if(endpoint.startsWith('/v1/concepts/')){detailReads++;body=concept;}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)}));
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4781');
   await expect(page.getByText(concept.summary,{exact:true})).toBeVisible();
   const before=reads;hold=true;
   await page.getByRole('button',{name:'Refresh today',exact:true}).click();
   await expect.poll(()=>!!release).toBe(true);
   await expect(page.getByRole('button',{name:'Refresh today',exact:true})).toBeDisabled();
   hold=false;release();
   await expect(page.getByRole('button',{name:'Refresh today',exact:true})).toBeEnabled();assert.equal(reads,before+1);
   online=false;await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
   await page.getByRole('button',{name:'Refresh today',exact:true}).click();
   await expect(page.getByText(concept.summary,{exact:true})).toBeVisible();
   const banner=page.getByRole('alert',{name:'You are offline. Changes will sync when you reconnect.'});
   await expect(banner).toBeVisible();
   const ratio=await banner.evaluate(el=>{
    const rgb=s=>s.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
    const lum=s=>{const c=rgb(s);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
    const bg=lum(getComputedStyle(el).backgroundColor);
    const text=[...el.querySelectorAll('div')].find(x=>x.textContent==='Offline — changes will sync when you reconnect');
    const fg=lum(getComputedStyle(text).color);return(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05);
   });assert.ok(ratio>=4.5,`contrast ${ratio}`);
   await page.getByRole('tab',{name:'Profile'}).click();
   await page.evaluate(()=>document.querySelectorAll('div,span').forEach(el=>{
    if(el.childNodes.length===1&&el.firstChild?.nodeType===Node.TEXT_NODE){const s=getComputedStyle(el);el.style.fontSize=(parseFloat(s.fontSize)*1.8)+'px';const line=parseFloat(s.lineHeight);if(Number.isFinite(line))el.style.lineHeight=(line*1.8)+'px';}
   }));
   const email=page.getByText('averylongreadernamefortextsizing@example.invalid',{exact:true});
   await email.scrollIntoViewIfNeeded();await expect(email).toBeVisible();
   const bounds=await email.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=321);
   await page.screenshot({path:`/tmp/next-profile-${theme}.png`,fullPage:true});
   assert.deepEqual(errors,[]);console.log(`${theme}: refresh completion/disabled state, offline content, contrast ${ratio.toFixed(2)}:1 and enlarged profile passed`);
   await context.close();
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
