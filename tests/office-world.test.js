'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const worldModule = import('../public/office/world.js');
const rosterModule = import('../public/office/roster.js');
const routinesModule = import('../public/office/routines.js');

test('every post has a station of its own that someone can stand at and walk away from',async()=>{
  const {STATIONS,AREAS}=await worldModule,{POSTS}=await rosterModule;
  assert.deepEqual(Object.keys(STATIONS).sort(),Object.keys(POSTS).sort());
  const places=new Set();
  for(const [post,s] of Object.entries(STATIONS)){
    const area=AREAS.find(a=>a.key===s.area);
    assert.ok(s.x>=area.x0&&s.x<=area.x1&&s.y>=area.y0&&s.y<=area.y1,post);
    assert.ok(Array.isArray(s.exit)&&Number.isFinite(s.cx)&&s.doing.length&&s.name,post);
    places.add(`${s.x},${s.y}`);
  }
  assert.equal(places.size,Object.keys(STATIONS).length); // no two posts share a place
});

test('routes stay in the room when they can, never cut through a desk, and use the walker\'s own corridor lane',async()=>{
  const {DESKS,LOUNGE,STATIONS,route,laneOf,CORRIDOR}=await worldModule;
  assert.deepEqual(route(LOUNGE[0],LOUNGE[3]),[{x:LOUNGE[3].x,y:LOUNGE[3].y}]);
  // two desks on the same aisle: out to the aisle and back in, without visiting the corridor
  const same=route(DESKS[0].seat,DESKS[3].seat);
  assert.ok(same.every(p=>p.y<100));assert.equal(same[0].x,DESKS[0].seat.cx);
  // desks on different aisles and other rooms go through the corridor on the given lane
  const lane=laneOf(1),far=route(DESKS[0].seat,STATIONS.backend,lane);
  assert.equal(far.filter(p=>p.y===lane).length,2);
  assert.deepEqual(far.at(-1),{x:STATIONS.backend.x,y:STATIONS.backend.y});
  const lanes=[0,1,2,3,4].map(laneOf);
  assert.equal(new Set(lanes).size,5);assert.ok(lanes.every(y=>Math.abs(y-CORRIDOR)<=6));
});

test('desks, seats and spare seats never overlap',async()=>{
  const {DESKS,SERVER_DESK,SPARE_SEATS,QUEUE,MEET_SPOTS}=await worldModule;
  const seats=[...DESKS,SERVER_DESK].map(d=>d.seat).concat(SPARE_SEATS,QUEUE,MEET_SPOTS);
  for(let i=0;i<seats.length;i++)for(let k=i+1;k<seats.length;k++)assert.ok(Math.hypot(seats[i].x-seats[k].x,seats[i].y-seats[k].y)>=14,`${i}/${k}`);
});

test('each person gets a colour of their own; the first of a kind takes that kind\'s hue',async()=>{
  const {assignColors,typeOf,postKey,nextName}=await rosterModule;
  const staff=['claude','deepseek','deepseek','deepseek','gpt','deepseek','deepseek','claude','gpt','gemini','codex','deepseek'].map((type,i)=>({id:`e${i}`,profile:{type}}));
  const colours=assignColors(staff);
  assert.equal(new Set(colours.values()).size,10); // distinct until the ten colours run out
  assert.equal(new Set([...colours.values()].slice(0,10)).size,10);
  assert.equal(colours.get('e0'),typeOf('claude').hue);assert.equal(colours.get('e1'),typeOf('deepseek').hue);
  assert.notEqual(colours.get('e2'),colours.get('e1'));
  assert.deepEqual([...assignColors(staff.slice(0,5)).values()],[...colours.values()].slice(0,5)); // hiring never recolours the people already here
  assert.equal(postKey('qa'),'test');assert.equal(postKey('writer'),'writing');assert.equal(postKey('nonsense'),'general');
  assert.equal(nextName('deepseek',['阿深','深深']),'鲸鲸');
  assert.equal(nextName('codex',['小码','码码'],2),'小码 3号');
});

async function routineFixture(){
  const {createRoutines}=await routinesModule;
  const desk={seat:{name:'desk'}},place={name:'机柜',doing:['看看服务日志'],emote:'gear',post:'backend'};
  const e={id:'a',path:[],spot:desk.seat,desk,writing:{out:'后端开发'}};
  const walks=[],said=[],emotes=[];
  const routines=createRoutines({employees:()=>[e],station:()=>place,home:x=>x.desk.seat,random:()=>0,
    walk:(x,spot)=>{walks.push(spot.name);x.spot=spot;x.path=[spot];},say:(x,t,k)=>said.push([t,k]),emote:(x,k)=>emotes.push(k)});
  const run=s=>{for(let i=0;i<s*10;i++)routines.step(.1);};
  return {routines,e,walks,said,emotes,run,desk};
}

test('someone working walks to their post\'s station, spends a moment there and comes back',async()=>{
  const {e,walks,said,emotes,run}=await routineFixture();
  run(6);assert.deepEqual(walks,['机柜']);assert.equal(e.errand,'机柜');
  run(3);assert.equal(said.length,0); // still walking: nothing happens until they arrive
  e.path=[];run(1);
  assert.deepEqual(said,[['看看服务日志','tool']]);assert.deepEqual(emotes,['gear']);assert.equal(e.atStation,'backend');
  run(4);assert.deepEqual(walks,['机柜','desk']);assert.equal(e.atStation,null);
  e.path=[];run(1);assert.equal(e.errand,null);
  run(13);assert.equal(walks.length,2); // the next trip waits its turn
  run(2);assert.equal(walks.length,3);
});

test('a trip ends at once when the work ends, and never starts in a meeting, at the boss\'s door, or while being carried',async()=>{
  const {e,walks,run}=await routineFixture();
  run(6);e.writing=null;run(1);
  assert.equal(e.errand,null);assert.equal(e.atStation,null);
  for(const state of [{meeting:1},{waiting:true},{held:true},{social:true},{writing:{out:'讨论',talk:true}}]){
    const f=await routineFixture();Object.assign(f.e,state);f.run(30);assert.deepEqual(f.walks,[],JSON.stringify(state));
  }
  assert.equal(walks.length,1);
});
