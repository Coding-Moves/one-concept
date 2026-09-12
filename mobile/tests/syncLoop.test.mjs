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
