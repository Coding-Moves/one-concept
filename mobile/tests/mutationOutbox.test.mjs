import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MutationOutbox } from '../src/services/mutationOutbox.ts';

function disk() {
  let raw=null;
  return {getItem:async()=>raw,setItem:async(_k,v)=>{raw=v;},removeItem:async()=>{raw=null;}};
}
const like={kind:'like',slug:'saved',desired:true};
const topics={kind:'topics',slugs:['new-server-topic']};
test('concurrent offline actions survive restart and keep only the latest intent for each key', async () => {
  const storage=disk(), queue=new MutationOutbox(storage,'queue');
  await Promise.all([queue.enqueue(like),queue.enqueue(topics),queue.enqueue({...like,desired:false})]);
  assert.deepEqual(await new MutationOutbox(storage,'queue').pending(),[{...like,desired:false},topics]);
});
test('an old acknowledgement cannot remove a newer same-key offline action', async () => {
  const queue=new MutationOutbox(disk(),'queue');
  await queue.enqueue(like);
  const [sent]=await queue.pending();
  await Promise.all([queue.enqueue({...like,desired:false}),queue.dequeue('like:saved',sent)]);
  assert.deepEqual(await queue.pending(),[{...like,desired:false}]);
});
test('sign-out clears a disk write already in flight before another account can read the queue', async () => {
  const storage=disk(), put=storage.setItem;
  let release, started;
  const writing=new Promise(r=>{started=r;});
  const finish=new Promise(r=>{release=r;});
  storage.setItem=async(k,v)=>{started();await finish;await put(k,v);};
  const queue=new MutationOutbox(storage,'queue');
  const write=queue.enqueue(like);
  await writing;
  const clear=queue.clear();
  release();
  await Promise.all([write,clear]);
  assert.deepEqual(await new MutationOutbox(storage,'queue').pending(),[]);
});
test('storage failures are reported and do not prevent a later retry', async () => {
  const storage=disk(), put=storage.setItem;
  storage.setItem=async()=>{throw new Error('disk full');};
  const queue=new MutationOutbox(storage,'queue');
  await assert.rejects(queue.enqueue(like),/disk full/);
  storage.setItem=put;
  await queue.enqueue(like);
  assert.deepEqual(await queue.pending(),[like]);
});
