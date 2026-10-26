'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const motionModule = import('../public/office-motion.js');

async function fixture() {
  const {createOfficeMotion} = await motionModule;
  const staff = ['dev','qa'].map(id=>({id,name:id,x:0,y:0,path:[],anim:0,desk:{seat:{name:`${id}-desk`}}}));
  const moves=[],bubbles=[],packets=[];
  let packetTicks=0;
  const motion=createOfficeMotion({
    employees:()=>staff,
    move:(e,spot)=>{moves.push([e.id,spot.name]);e.path=[spot];},
    say:(e,text)=>bubbles.push([e.id,text]),
    handoff:(a,b)=>packets.push([a.id,b.id]),
    idleSpot:()=>({name:'lounge'}),reviewSpot:()=>({name:'boss'}),
    stepEmployee:(e,dt)=>{e.anim+=dt;},stepPackets:()=>packetTicks++,
  });
  const snapshot=(jobs, status='running')=>({orders:[],projects:[{id:1,status,roles:[{idx:0,name:'开发',deps:[]},{idx:1,name:'测试',deps:[0]}]}],jobs});
  const job=(idx,status,attempt=1)=>({id:`p:1:${idx}`,project_id:1,role_idx:idx,employee:idx?'qa':'dev',status,attempt});
  return {staff,moves,bubbles,packets,motion,snapshot,job,packetTicks:()=>packetTicks};
}

test('polling the same running job preserves movement and hands off only once',async()=>{
  const {motion,snapshot,job,staff,moves,packets}=await fixture();
  const s=snapshot([job(0,'done'),job(1,'running')]);
  motion.sync(s);staff[1].x=57;
  for(let i=0;i<5;i++)motion.sync(s);
  assert.equal(staff[1].x,57);
  assert.deepEqual(moves,[['qa','qa-desk']]);
  assert.deepEqual(packets,[['dev','qa']]);
  assert.equal(staff[1].writing.out,'测试');
  motion.sync(snapshot([job(0,'done'),job(1,'running',2)]));
  assert.equal(packets.length,2);
});

test('animation ticks continue advancing employees and documents between snapshots',async()=>{
  const {motion,staff,packetTicks}=await fixture();
  motion.step(0.1);motion.step(0.1);
  assert.equal(staff[0].anim,0.2);assert.equal(staff[1].anim,0.2);
  assert.equal(packetTicks(),2);
});

test('delivery walks to the boss then returns to the lounge without repeating on each poll',async()=>{
  const {motion,snapshot,job,staff,moves}=await fixture();
  motion.sync(snapshot([job(0,'done'),job(1,'running')]));
  const s=snapshot([job(0,'done'),job(1,'done')],'review');motion.sync(s);
  assert.equal(staff[1].writing,null);assert.equal(staff[1].carry,true);
  motion.step(10); // Walking time does not consume the pause at the boss's door.
  assert.equal(staff[1].carry,true);
  staff[1].path=[];motion.step(2);motion.sync(s);motion.step(2.1);
  assert.equal(staff[1].waiting,false);assert.equal(staff[1].carry,false);
  assert.equal(moves.at(-1)[1],'lounge');
  const count=moves.length;motion.sync(s);assert.equal(moves.length,count);
});

test('new work interrupts a review visit and returns the employee to their desk',async()=>{
  const {motion,snapshot,job,staff,moves}=await fixture();
  motion.sync(snapshot([job(0,'review')]));assert.equal(staff[0].waiting,true);
  const next={id:'o:next',order_id:'next',employee:'dev',status:'running',attempt:1};
  motion.sync({...snapshot([job(0,'review'),next]),orders:[{id:'next',title:'新工作'}]});
  assert.equal(staff[0].waiting,false);assert.equal(staff[0].carry,false);
  assert.equal(staff[0].writing.out,'新工作');assert.deepEqual(moves.at(-1),['dev','dev-desk']);
  staff[0].path=[];motion.step(10);assert.deepEqual(moves.at(-1),['dev','dev-desk']);
});

test('approval releases a review visit and a failed call shows no typing',async()=>{
  const {motion,snapshot,job,staff,bubbles}=await fixture();
  motion.sync(snapshot([job(0,'review')]));
  motion.sync(snapshot([job(0,'done')],'done'));assert.equal(staff[0].waiting,false);
  motion.sync(snapshot([job(1,'running')]));motion.sync(snapshot([job(1,'failed')],'blocked'));
  assert.equal(staff[1].writing,null);assert.match(bubbles.at(-1)[1],/没完成/);
});
