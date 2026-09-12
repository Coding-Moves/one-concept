import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSyncLoop } from '../src/services/syncLoop.ts';

const settle = async () => { for (let i=0;i<5;i++) await Promise.resolve(); };
test('retries without navigation, backs off, and stops polling after the queue drains', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0, pending=true;
  const loop=createSyncLoop(async()=>{ calls++; return pending; });
  t.after(loop.stop);
  loop.wake(); t.mock.timers.tick(0); await settle();
  assert.equal(calls,1);
  t.mock.timers.tick(4999); await settle(); assert.equal(calls,1);
  t.mock.timers.tick(1); await settle(); assert.equal(calls,2);
  t.mock.timers.tick(9999); await settle(); assert.equal(calls,2);
  pending=false; t.mock.timers.tick(1); await settle(); assert.equal(calls,3);
  t.mock.timers.tick(60000); await settle(); assert.equal(calls,3);
});

test('background pauses timers and foreground triggers immediate synchronization', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0;
  const loop=createSyncLoop(async()=>{ calls++; return true; });
  t.after(loop.stop);
  loop.wake(); t.mock.timers.tick(0); await settle();
  loop.setActive(false); t.mock.timers.tick(60000); await settle(); assert.equal(calls,1);
  loop.setActive(true); t.mock.timers.tick(0); await settle(); assert.equal(calls,2);
});

test('partial connectivity wakeups retain exponential backoff until synchronization succeeds', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0, failing=true;
  const loop=createSyncLoop(async()=>{
    calls++;
    if (failing) {
      // A state response reports online; the subsequent topics fetch fails.
      loop.wake();
      loop.retry();
    }
    return failing;
  });
  t.after(loop.stop);
  loop.wake(); t.mock.timers.tick(0); await settle();
  for (const delay of [5000,10000,20000,30000,30000]) {
    const before=calls;
    t.mock.timers.tick(delay-1); await settle(); assert.equal(calls,before);
    t.mock.timers.tick(1); await settle(); assert.equal(calls,before+1);
  }
  failing=false;
  t.mock.timers.tick(30000); await settle(); assert.equal(calls,7);
  t.mock.timers.tick(60000); await settle(); assert.equal(calls,7);
});

test('a reconnect while waiting for retry triggers an immediate attempt', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0, failing=true;
  const loop=createSyncLoop(async()=>{ calls++; return failing; });
  t.after(loop.stop);
  loop.wake(); t.mock.timers.tick(0); await settle();
  t.mock.timers.tick(1000); await settle(); assert.equal(calls,1);
  failing=false; loop.wake(); t.mock.timers.tick(0); await settle();
  assert.equal(calls,2);
  t.mock.timers.tick(60000); await settle(); assert.equal(calls,2);
});

test('wakeups during successful synchronization coalesce into one additional attempt', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0, resolve;
  const loop=createSyncLoop(()=>{
    calls++;
    return calls===1 ? new Promise(r=>{resolve=r;}) : Promise.resolve(false);
  });
  t.after(loop.stop);
  loop.wake(); t.mock.timers.tick(0); await settle();
  loop.wake(); loop.wake();
  t.mock.timers.tick(1000); await settle(); assert.equal(calls,1);
  resolve(false); await settle();
  t.mock.timers.tick(0); await settle(); assert.equal(calls,2);
  t.mock.timers.tick(60000); await settle(); assert.equal(calls,2);
});

test('overlapping wakeups never run concurrent flushes and stop prevents late rescheduling', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0, resolve;
  const loop=createSyncLoop(()=>{ calls++; return new Promise(r=>{resolve=r;}); });
  loop.wake(); t.mock.timers.tick(0); await settle();
  loop.wake(); loop.wake(); loop.retry(); t.mock.timers.tick(10000); await settle();
  assert.equal(calls,1);
  loop.stop(); resolve(true); await settle();
  t.mock.timers.tick(60000); await settle(); assert.equal(calls,1);
});
