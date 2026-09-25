import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfflineCache } from '../src/services/offlineCache.ts';
import { AchievementStore, nextMilestone, uncelebrated } from '../src/services/achievementStore.ts';
const badge = {code:'streak_7',metric:'consecutive_days',threshold:7,name:'First flame',description:'Seven days',artwork_key:'candle',earned_on:'2026-09-20',seen_at:null,source:'completion'};
const collection = {current_streak:7,longest_streak:7,items:[badge,{...badge,code:'streak_30',threshold:30,earned_on:null}]};
const defer = () => {let resolve;return {promise:new Promise(r=>resolve=r),resolve:(v)=>resolve(v)};};
function setup() {
 const rows=new Map();
 const disk={getItem:async k=>rows.get(k)??null,setItem:async(k,v)=>rows.set(k,v),getAllKeys:async()=>[...rows.keys()],multiRemove:async keys=>keys.forEach(k=>rows.delete(k))};
 const cache=new OfflineCache(disk,'awards/');
 return {cache,rows,disk};
}
test('awards persist offline and dismissals survive reopening with offline acknowledgement',async()=>{
 const {cache}=setup();let ack=[];
 const transport={load:async()=>collection,acknowledge:async(u,c)=>{ack.push([u,c]);throw Error('offline');}};
 const first=new AchievementStore('A',cache,transport);
 const snapshot=await first.refresh();assert.equal(uncelebrated(snapshot).length,1);
 assert.equal(nextMilestone(snapshot.collection).threshold,30);
 await first.dismiss(['streak_7','streak_30']);first.dispose();
 const reopened=new AchievementStore('A',cache,transport);
 assert.equal(uncelebrated(await reopened.cached()).length,0);
 await reopened.refresh();assert.ok(ack.every(([u,c])=>u==='A'&&c.length===1&&c[0]==='streak_7'));
});
test('late account A fetch cannot populate account B, even without sign-out cleanup',async()=>{
 const {cache,rows}=setup();const pending=defer();
 const a=new AchievementStore('A',cache,{load:()=>pending.promise,acknowledge:async()=>{}});
 const fetch=a.refresh();await new Promise(r=>setImmediate(r));a.dispose();
 const b=new AchievementStore('B',cache,{load:async()=>({...collection,items:[]}),acknowledge:async()=>{}});
 pending.resolve(collection);assert.equal(await fetch,null);assert.equal(await b.cached(),null);
 await b.refresh();assert.equal(rows.has('awards/A'),false);
 assert.equal((await b.cached()).collection.items.length,0);
});
test('sign-out fences queued reads/writes and acknowledgements, including same-account sign-in',async()=>{
 const {cache,rows}=setup();const pending=defer();let acks=0;
 const a=new AchievementStore('A',cache,{load:()=>pending.promise,acknowledge:async()=>acks++});
 const fetch=a.refresh();await new Promise(r=>setImmediate(r));
 const dismissal=a.dismiss(['streak_7']);await cache.clear();pending.resolve(collection);
 assert.equal(await fetch,null);assert.equal(await dismissal,null);assert.equal(acks,0);assert.equal(rows.size,0);
});
test('refresh cannot resurrect an acknowledged badge and requests carry their owning account',async()=>{
 const {cache}=setup();const ids=[];
 const store=new AchievementStore('A',cache,{load:async id=>{ids.push(id);return collection;},acknowledge:async id=>{ids.push(id);}});
 await store.refresh();await store.dismiss(['streak_7']);
 assert.equal(uncelebrated(await store.refresh()).length,0);assert.ok(ids.every(id=>id==='A'));
});
test('storage failures do not hide confirmed awards; broken streak keeps earned badge',async()=>{
 const {cache,disk}=setup();disk.setItem=async()=>{throw Error('full');};
 const store=new AchievementStore('A',cache,{load:async()=>({...collection,current_streak:0}),acknowledge:async()=>{}});
 const result=await store.refresh();assert.equal(result.collection.current_streak,0);
 assert.equal(result.collection.items[0].earned_on,badge.earned_on);
});
