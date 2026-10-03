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
   const errors=[],token='b'.repeat(43), pair='22222222-2222-4222-8222-222222222222',blockedId='44444444-4444-4444-8444-444444444444';
   const peer={id:pair,display_name:'Bea',public_path:`/p/${token}`};
   let offline=false;
   let relationship='available',blocked=false,prefs={accepting_requests:false,version:0},failSettings=true,requestCalls=0,releaseRequest;
   const state={display_name:'Reader',timezone:'UTC',today,followed_topics:['computer-science'],learned:[],likes:[],bookmarks:[],saved:[],stats:{current:0,longest:0,total_learned:0,total_reviews:0},assignment_slug:concept.slug,daily:{assigned_for:today,assigned_at:today+'T08:00:00Z',learned:false,completed_at:null,outside_followed_topics:false,concept}};
   const context=await browser.newContext({viewport:{width:320,height:740}});
   await context.addInitScript(({session,version,theme})=>{
    localStorage.setItem('sb-127-auth-token',JSON.stringify(session));localStorage.setItem('one-concept/last-seen-version/v1',version);localStorage.setItem('one-concept/theme/v1',theme);
   },{session,version,theme});
   await context.route('**/api/**',async route=>{
    if(offline) return route.abort('internetdisconnected');
    const request=route.request(), url=new URL(request.url()), endpoint=url.pathname.replace('/api','');let body={},status=200;
    if(endpoint==='/v1/me/state'||endpoint==='/v1/me')body=state;
    else if(endpoint==='/v1/me/achievements')body={items:[]};
    else if(endpoint==='/v1/topics')body=[{slug:'computer-science',name:'Computer Science',concept_count:125,following:true}];
    else if(endpoint==='/v1/me/notifications')body={enabled:false,reminder_times:['08:00']};
    else if(endpoint.startsWith('/v1/concepts/'))body=concept;
    else if(endpoint.startsWith('/v1/public-profiles/'))body={display_name:'Bea',concepts_learned:12,achievements:[]};
    else if(endpoint==='/v1/me/connections/settings'){
     if(request.method()==='PUT'){if(failSettings)status=503;else prefs={...request.postDataJSON(),version:prefs.version+1};}body=prefs;
    }
    else if(endpoint===`/v1/me/connections/with/${token}`){
     if(request.method()==='POST'){requestCalls++;await new Promise(r=>releaseRequest=r);relationship='outgoing';}
     body={state:blocked?'unavailable':relationship,id:['accepted','outgoing','incoming'].includes(relationship)?pair:null};
    }
    else if(endpoint===`/v1/me/connections/${pair}/actions`){
     const action=request.postDataJSON().action;
     relationship=action==='accept'?'accepted':action==='decline'||action==='cancel'||action==='remove'?'cooldown':'unavailable';
     if(action==='block')blocked=true;status=204;
    }
    else if(endpoint===`/v1/me/connections/blocks/${blockedId}`){blocked=false;relationship='cooldown';status=204;}
    else if(endpoint==='/v1/me/connections'){
     const kind=url.searchParams.get('kind');
     body={items:kind==='blocked'&&blocked?[{...peer,id:blockedId,public_path:null}]:!blocked&&((kind==='accepted'&&relationship==='accepted')||(kind==='incoming'&&relationship==='incoming')||(kind==='outgoing'&&relationship==='outgoing'))?[peer]:[],next_cursor:null};
    }
    await route.fulfill({status,contentType:'application/json',body:status===204?'':JSON.stringify(body)});
   });
   await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)}));
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4781');await expect(page.getByText(concept.summary,{exact:true})).toBeVisible();
   await page.getByRole('tab',{name:'Profile'}).click();await page.getByText('Connections',{exact:true}).click();
   await expect(page.getByText(/No connections yet/)).toBeVisible();
   const preference=page.getByRole('switch',{name:'Accept new connection requests'});
   await preference.click();await expect(preference).toBeChecked();await expect(page.getByText(/Could not confirm/)).toBeVisible();await expect(preference).not.toBeChecked();
   failSettings=false;await preference.click();await expect(preference).toBeChecked();
   const input=page.getByRole('textbox',{name:'Shared profile link'});
   await input.fill('invalid');await page.getByRole('button',{name:'Open shared profile',exact:true}).click();await expect(page.getByText(/Enter a valid One Concept/)).toBeVisible();
   await input.fill(`http://127.0.0.1:4781/api/p/${token}`);await page.getByRole('button',{name:'Open shared profile',exact:true}).click();
   await expect(page.getByText('Bea',{exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Send connection request',exact:true})).toBeEnabled();
   offline=true;
   await page.getByRole('button',{name:'Send connection request',exact:true}).click();
   await expect(page.getByText(/Could not confirm that change/)).toBeVisible();assert.equal(requestCalls,0);
   offline=false;
   await page.getByRole('button',{name:'Send connection request',exact:true}).click();
   await expect.poll(()=>!!releaseRequest).toBe(true);await expect(page.getByRole('button',{name:'Send connection request',exact:true})).toBeDisabled();releaseRequest();
   await expect(page.getByText('Request pending',{exact:true})).toBeVisible();assert.equal(requestCalls,1);
   await page.getByRole('button',{name:'Cancel request',exact:true}).click();await expect(page.getByText(/A previous request ended/)).toBeVisible();
   await page.getByRole('button',{name:'Close profile',exact:true}).click();
   relationship='incoming';await page.getByRole('button',{name:'Requests',exact:true}).click();
   await expect(page.getByText('Bea',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Decline request',exact:true}).click();
   await expect(page.getByText('Bea',{exact:true})).toHaveCount(0);
   relationship='incoming';await page.getByRole('button',{name:'Reload connections',exact:true}).click();await page.getByRole('button',{name:'Accept request',exact:true}).click();
   await page.getByRole('button',{name:'My connections',exact:true}).click();await expect(page.getByText('Bea',{exact:true})).toBeVisible();
   await page.screenshot({path:`/tmp/connections-${theme}.png`,fullPage:true});
   await page.getByRole('button',{name:'Remove connection',exact:true}).click();await page.getByRole('button',{name:'Confirm remove',exact:true}).click();await expect(page.getByText('Bea',{exact:true})).toHaveCount(0);
   relationship='accepted';await page.getByRole('button',{name:'Reload connections',exact:true}).click();await page.getByRole('button',{name:'Block person',exact:true}).click();await page.getByRole('button',{name:'Confirm block',exact:true}).click();
   await page.getByRole('button',{name:'Blocked',exact:true}).click();await expect(page.getByText('Bea',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Unblock person',exact:true}).click();await expect(page.getByText('Bea',{exact:true})).toHaveCount(0);
   await page.evaluate(()=>document.querySelectorAll('div,span').forEach(el=>{if(el.childNodes.length===1&&el.firstChild?.nodeType===Node.TEXT_NODE){const style=getComputedStyle(el);el.style.fontSize=(parseFloat(style.fontSize)*1.8)+'px';}}));
   await page.getByRole('button',{name:'My connections',exact:true}).click();await expect(page.getByText(/No connections yet/)).toBeVisible();
   assert.deepEqual(errors,[]);console.log(`${theme}: request consent, failed settings, duplicate guard, cancel, decline, accept, private list, remove, block/unblock and large text passed`);await context.close();
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
