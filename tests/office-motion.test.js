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

test('everyone in a discussion gathers at the table, then goes back; a real reply becomes a bubble',async()=>{
  const {createOfficeMotion}=await motionModule;
  const staff=['dev','qa'].map(id=>({id,name:id,x:0,y:0,path:[],anim:0,desk:{seat:{name:`${id}-desk`}}}));
  const moves=[],bubbles=[];
  const motion=createOfficeMotion({employees:()=>staff,move:(e,s)=>{moves.push([e.id,s.name]);},say:(e,t)=>bubbles.push([e.id,t]),handoff(){},
    idleSpot:()=>({name:'lounge'}),reviewSpot:()=>({name:'boss'}),stepEmployee(){},stepPackets(){},
    meetSpot:i=>({name:`table-${i}`}),speech:async()=>'我建议先做登录'});
  const turns=(a,b)=>[{id:1,employee:'dev',role_idx:0,status:a,attempt:1},{id:2,employee:'qa',role_idx:1,status:b,attempt:1}];
  const snap=list=>({orders:[],jobs:[],projects:[{id:1,status:'running',roles:[{idx:0,name:'开发',deps:[]}],discussion:list}]});
  motion.sync(snap(turns('running','queued')));
  assert.deepEqual(moves,[['dev','table-0'],['qa','table-1']]);
  assert.equal(staff[0].writing.talk,true);assert.deepEqual(staff[0].talkTo,[staff[1]]);
  motion.sync(snap(turns('done','running'))); // the speaker stays at the table while the next one talks
  assert.equal(moves.length,2);assert.equal(staff[0].writing,null);assert.equal(staff[1].writing.talk,true);
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(bubbles.at(-1),['dev','我建议先做登录']);
  motion.sync(snap(turns('done','done')));
  assert.equal(staff[0].meeting,null);assert.deepEqual(moves.slice(2),[['dev','lounge'],['qa','lounge']]);
});

test('accepting and failing are told apart from what was already true when the page opened',async()=>{
  const {createOfficeMotion}=await motionModule;
  const staff=[{id:'dev',name:'dev',x:0,y:0,path:[],anim:0,desk:{seat:{}}}],reactions=[];
  const motion=createOfficeMotion({employees:()=>staff,move(){},say(){},handoff(){},idleSpot:()=>({}),reviewSpot:()=>({}),stepEmployee(){},stepPackets(){},react:(k,t)=>reactions.push([k,t.map(e=>e.id)])});
  const job=status=>({id:'p:1:0',project_id:1,role_idx:0,employee:'dev',status,attempt:1});
  const snap=(status,j)=>({orders:[],projects:[{id:1,status,roles:[{idx:0,name:'开发',deps:[]}]}],jobs:[job(j)]});
  motion.sync(snap('done','done'));assert.deepEqual(reactions,[]); // old finished work does not celebrate on every page load
  motion.sync(snap('running','running'));motion.sync(snap('blocked','failed'));
  assert.deepEqual(reactions,[['failed',['dev']]]);
  motion.sync(snap('review','done'));motion.sync(snap('done','done'));
  assert.deepEqual(reactions.at(-1),['accepted',['dev']]);
});
