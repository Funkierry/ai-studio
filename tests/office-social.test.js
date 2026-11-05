'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const socialModule = import('../public/office-social.js');

async function fixture(names=['a','b']) {
  const {createOfficeSocial}=await socialModule;
  const staff=names.map(id=>({id,name:id,type:'other',x:0,y:0,path:[],desk:{}}));
  const said=[],emotes=[],walks=[],left=[];
  const social=createOfficeSocial({employees:()=>staff,free:e=>!e.writing&&!e.waiting&&!e.meeting,
    walk:(e,s)=>walks.push([e.id,s]),halt:e=>{e.path=[];},beside:(a,b)=>`near-${b.id}`,coffeeSpot:()=>'coffee',leave:e=>left.push(e.id),
    say:(e,t)=>said.push([e.id,t]),emote:(e,k)=>emotes.push([e.id,k]),random:()=>.3});
  const run=(s=30)=>{for(let i=0;i<s*10;i++)social.step(.1);};
  return {social,staff,said,emotes,walks,left,run};
}

test('anywhere a pointer lets go, the person lands somewhere they can stand and leave from',async()=>{
  const {spotAt,AREAS}=await socialModule;
  for(let x=0;x<=384;x+=6)for(let y=0;y<=224;y+=6){
    const s=spotAt({x,y}),a=AREAS.find(r=>r.key===s.area);
    assert.ok(s.x>=a.x0&&s.x<=a.x1&&s.y>=a.y0&&s.y<=a.y1,`${x},${y}`);
    assert.ok(Array.isArray(s.exit)&&Number.isFinite(s.cx),`${x},${y}`);
  }
  assert.equal(spotAt({x:200,y:195}).area,'lounge');
  const table=spotAt({x:56,y:60}); // dropped on the meeting table: slides off it
  assert.equal(table.area,'meeting');
  assert.ok(table.x<=34||table.x>=78||table.y<=46||table.y>=82);
  assert.equal(spotAt({x:330,y:205}).cx,323);
});

test('dropping on a free colleague high-fives; a working colleague gets cheered and is not moved',async()=>{
  const {social,staff:[a,b],emotes,said,walks,run}=await fixture();
  social.dropped(a,{on:b,area:'lounge'});run(6);
  assert.deepEqual(emotes.slice(0,2),[['a','hand'],['b','hand']]);
  assert.deepEqual(said.slice(0,2).map(s=>s[0]),['a','b']);
  assert.equal(a.social,false);assert.equal(b.social,false);
  b.writing={out:'x'};walks.length=0;said.length=0;
  social.dropped(a,{on:b,area:'lounge'});social.step(.1);
  assert.match(said[0][1],/b加油/);assert.equal(walks.length,0);
});

test('someone who is busy says so and no scene starts',async()=>{
  const {social,staff:[a,b],said,walks}=await fixture();
  a.writing={out:'x'};
  social.dropped(a,{on:b,area:'lounge'});social.step(.1);
  assert.match(said[0][1],/回去/);assert.equal(walks.length,0);assert.ok(!a.social);
});

test('a scene stops at once when real work arrives or the person is picked up',async()=>{
  const {social,staff:[a,b],said}=await fixture();
  social.handoff(a,b);social.step(.1);
  assert.equal(a.carry,true);assert.equal(a.social,true);
  a.writing={out:'新工作'};social.step(.1);
  assert.equal(a.social,false);assert.equal(said.length,0);
  a.writing=null;social.dropped(a,{area:'lounge'});social.step(.1);
  a.held=true;social.step(.1);assert.equal(a.social,false);assert.equal(a.cup,false);
});

test('coffee reaches a working colleague and the visitor leaves',async()=>{
  const {staff:[a,b],said,walks,left,run}=await fixture();
  b.writing={out:'写代码'};
  run(30);
  assert.deepEqual(walks.slice(0,2),[['a','coffee'],['a','near-b']]);
  assert.ok(said.some(([who,t])=>who==='b'&&t==='谢谢！'));
  assert.ok(b.desk.cupT>0);assert.ok(left.includes('a'));assert.equal(a.cup,false);
});

test('finished work is carried over by hand and acceptance is celebrated',async()=>{
  const {social,staff:[a,b],said,emotes,left,run}=await fixture();
  social.handoff(a,b);run(7);
  assert.ok(said.some(([who,t])=>who==='b'&&t==='收到'));assert.ok(emotes.some(([who,k])=>who==='b'&&k==='check'));
  assert.equal(a.carry,false);assert.deepEqual(left,['a']);
  emotes.length=0;social.celebrate([a,b]);social.step(.1);
  assert.equal(emotes.filter(([,k])=>k==='star').length,2);assert.ok(said.some(([,t])=>t==='验收通过！'));
});
