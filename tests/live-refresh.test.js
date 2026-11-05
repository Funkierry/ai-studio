'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const refreshModule = import('../public/live-refresh.js');

function gate() {
  const waiting=[];
  return {load:()=>new Promise(resolve=>waiting.push(resolve)),release:()=>waiting.shift()?.(),count:()=>waiting.length};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a refresh asked for during a load runs again afterwards, so a click is never lost',async()=>{
  const {createRefresher}=await refreshModule,g=gate();let loads=0;
  const r=createRefresher(()=>{loads++;return g.load();});
  r.poll();await tick();assert.equal(loads,1);
  let done=false;const after=r.now().then(()=>{done=true;});
  g.release();await tick();
  assert.equal(loads,2);assert.equal(done,false); // waits for the fresh load, not the stale one
  g.release();await after;assert.equal(done,true);
});

test('many clicks during a load share one follow-up and polling never piles up',async()=>{
  const {createRefresher}=await refreshModule,g=gate();let loads=0;
  const r=createRefresher(()=>{loads++;return g.load();});
  r.poll();r.poll();await tick();assert.equal(loads,1);
  const a=r.now(),b=r.now();r.poll();
  g.release();await tick();assert.equal(loads,2);
  g.release();await Promise.all([a,b]);assert.equal(loads,2);
  r.poll();await tick();assert.equal(loads,3);g.release();await tick();
});

test('a failed load does not stop the next one',async()=>{
  const {createRefresher}=await refreshModule;let loads=0;
  const r=createRefresher(async()=>{loads++;if(loads===1)throw new Error('boom');});
  await assert.rejects(r.now());
  await r.now();assert.equal(loads,2);
});
