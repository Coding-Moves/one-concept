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
   let nameSaves=0, failName=true, holdName=false, releaseName;
   let sharing={enabled:false,show_name:false,show_streak:false,show_learning:false,achievement_codes:[],version:0,public_path:null};
   let conflict=false;
   const token='a'.repeat(43), errors=[];
   const state={display_name:'Reader',timezone:'UTC',today,followed_topics:['computer-science'],learned:[],likes:[],bookmarks:[],saved:[],stats:{current:0,longest:0,total_learned:0,total_reviews:0},assignment_slug:concept.slug,daily:{assigned_for:today,assigned_at:today+'T08:00:00Z',learned:false,completed_at:null,outside_followed_topics:false,concept}};
   const context=await browser.newContext({viewport:{width:320,height:740}});
   await context.addInitScript(({session,version,theme})=>{
    localStorage.setItem('sb-127-auth-token',JSON.stringify(session));
    localStorage.setItem('one-concept/last-seen-version/v1',version);
    localStorage.setItem('one-concept/theme/v1',theme);
   },{session,version,theme});
   await context.route('**/api/**',async route=>{
    const request=route.request(), endpoint=new URL(request.url()).pathname.replace('/api','');let body={},status=200;
    if(endpoint==='/v1/me/state')body=state;
    else if(endpoint==='/v1/me' && request.method()==='PATCH'){
     const input=request.postDataJSON();
     if(input.display_name){nameSaves++;if(holdName)await new Promise(r=>releaseName=r);if(failName)status=503;else state.display_name=input.display_name;}
     body=state;
    }
    else if(endpoint==='/v1/me/profile-sharing'){
     if(request.method()==='PUT'){
      if(conflict){status=409;body={detail:'Settings changed'};}
      else {const input=request.postDataJSON();sharing={...input,version:sharing.version+1,public_path:input.enabled?`/p/${token}`:null};}
     }
     if(status===200)body=sharing;
    }
    else if(endpoint==='/v1/me/achievements')body={items:[{code:'concept_1',name:'First concept',earned_on:today,seen_at:today,metric:'concepts',threshold:1,description:'A beginning',artwork_key:'candle'}]};
    else if(endpoint==='/v1/topics')body=[{slug:'computer-science',name:'Computer Science',concept_count:125,following:true}];
    else if(endpoint==='/v1/me/notifications')body={enabled:false,reminder_times:['08:00']};
    else if(endpoint.startsWith('/v1/concepts/'))body=concept;
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   });
   await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)}));
   const page=await context.newPage();page.on('console',m=>{if(m.type()==='error') console.error(m.text());});page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
   await page.goto('http://127.0.0.1:4781');
   await expect(page.getByText(concept.summary,{exact:true})).toBeVisible();
   await page.getByRole('tab',{name:'Profile'}).click();
   await page.getByText('Edit profile',{exact:true}).click();
   const input=page.getByRole('textbox',{name:'Preferred name'});
   await input.fill('   ');await page.getByRole('button',{name:'Save name',exact:true}).click();
   assert.equal(nameSaves,0);
   await input.fill('  Amina  ');await page.getByRole('button',{name:'Save name',exact:true}).click();
   await expect(page.getByText(/Could not save your name/)).toBeVisible();await expect(input).toHaveValue('  Amina  ');
   failName=false;holdName=true;
   await page.getByRole('button',{name:'Save name',exact:true}).click();
   await expect.poll(()=>!!releaseName).toBe(true);
   await expect(page.getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();
   releaseName();holdName=false;
   await expect(page.getByText('Your name is saved.',{exact:true})).toBeVisible();assert.equal(nameSaves,2);
   await expect(input).toHaveValue('Amina');
   await page.getByRole('button',{name:'Back',exact:true}).click();
   await expect(page.getByText('Amina',{exact:true})).toBeVisible();
   await page.getByText('Public profile & sharing',{exact:true}).click();
   await expect(page.getByText('Sharing: Off',{exact:true})).toBeVisible();
   await page.getByRole('switch',{name:'Display name: Amina',exact:true}).check();
   await page.getByRole('button',{name:'Enable sharing with these choices'}).click();
   await expect(page.getByText('Sharing: On',{exact:true})).toBeVisible();
   assert.equal(sharing.show_name,true);assert.equal(sharing.show_streak,false);assert.deepEqual(sharing.achievement_codes,[]);
   await page.getByRole('button',{name:'Show profile QR'}).click();
   const qr=page.getByLabel('QR code containing only your public profile link');
   await qr.evaluate(el=>el.scrollIntoView({block:'center'}));await expect(qr).toBeVisible();
   const bounds=await qr.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=321);
   await page.screenshot({path:`/tmp/profile-sharing-${theme}.png`,fullPage:true});
   conflict=true;
   await page.getByRole('switch',{name:'Total concepts learned'}).check();
   await page.getByRole('button',{name:'Save public choices'}).click();
   await expect(page.getByText(/Changes were not confirmed/)).toBeVisible();
   await expect(page.getByRole('switch',{name:'Total concepts learned'})).toBeChecked();
   await expect(page.getByRole('button',{name:'Show profile QR'})).toHaveCount(0);
   conflict=false;
   await page.getByRole('button',{name:'Reload settings'}).click();
   await expect(page.getByRole('switch',{name:'Total concepts learned'})).not.toBeChecked();
   await page.getByRole('button',{name:'Turn off sharing now'}).click();
   await expect(page.getByText('Sharing: Off',{exact:true})).toBeVisible();
   await expect(qr).toHaveCount(0);assert.equal(sharing.public_path,null);
   assert.deepEqual(errors,[]);
   console.log(`${theme}: name validation/retry/duplicate prevention/state refresh, opt-in sharing, QR layout, stale-write recovery and disable passed`);
   await context.close();
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
