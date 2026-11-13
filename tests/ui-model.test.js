'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modelModule = import('../public/ui/model.js');
const viewsModule = import('../public/ui/views.js');

const roles=(...deps)=>deps.map((d,idx)=>({idx,name:`分工${idx}`,deps:d,who:`e${idx}`,status:'wait',artifacts:[]}));
const project=(over={})=>({id:1,name:'番茄钟',goal:'做一个番茄钟',slug:'tomato',status:'running',roles:roles([],[0],[0],[0,1,2]),discussion:[],...over});
const job=(idx,status,over={})=>({id:`p:1:${idx}`,project_id:1,role_idx:idx,employee:`e${idx}`,status,attempt:1,result:null,...over});
const snapshot=(p,jobs=[],orders=[])=>({projects:p?[p]:[],jobs,orders,employees:[0,1,2,3].map(i=>({id:`e${i}`,name:`员工${i}`}))});

test('shares are laid out by what they wait for: parallel shares share a column',async()=>{
  const {stagesOf}=await modelModule;
  assert.deepEqual(stagesOf(roles([],[0],[0],[0,1,2])).map(c=>c.map(r=>r.idx)),[[0],[1,2],[3]]);
  assert.deepEqual(stagesOf(roles([],[])).map(c=>c.map(r=>r.idx)),[[0,1]]);
  assert.deepEqual(stagesOf(roles([],[0],[1])).map(c=>c.length),[1,1,1]);
  // bad data must not hang the page: a share that waits for itself, or for one that does not exist
  assert.equal(stagesOf([{idx:0,deps:[0]},{idx:1,deps:[9]}]).flat().length,2);
});

test('what waits for the boss says what kind of decision it is and where to make it',async()=>{
  const {needsYou}=await modelModule;
  const review=needsYou(snapshot(project({status:'review'}),[0,1,2,3].map(i=>job(i,'done'))));
  assert.deepEqual(review.get('p:1'),{kind:'accept',why:'全部分工做完了，等你验收',view:'tasks'});
  const gate=needsYou(snapshot(project(),[job(0,'review')])).get('p:1');
  assert.equal(gate.kind,'confirm');assert.equal(gate.step,0);
  const failed=needsYou(snapshot(project(),[job(0,'done'),job(1,'failed',{error:'测试未通过'})])).get('p:1');
  assert.equal(failed.kind,'fix');assert.equal(failed.step,1);assert.match(failed.why,/测试未通过/);
  const question=needsYou(snapshot(project({status:'blocked',collaboration:{enabled:true,reason:'用哪种配色？'}}))).get('p:1');
  assert.deepEqual([question.kind,question.view,question.why],['answer','discussion','用哪种配色？']);
  assert.equal(needsYou(snapshot(project({status:'paused'}),[job(0,'review')])).size,0);
  const order=needsYou(snapshot(null,[{id:'o:x',order_id:'x',employee:'e0',status:'review'}],[{id:'x',title:'周报'}]));
  assert.equal(order.get('o:x').kind,'accept');
});

test('opening a project shows the share that needs you, else the one running, else the next one',async()=>{
  const {defaultStep}=await modelModule,p=project();
  assert.equal(defaultStep(p,[job(0,'done'),job(1,'running'),job(2,'failed')]),2);
  assert.equal(defaultStep(p,[job(0,'done'),job(1,'running'),job(2,'queued')]),1);
  assert.equal(defaultStep(p,[job(0,'done')]),1);
  const done=project({roles:roles([],[0]).map(r=>({...r,status:'done'}))});
  assert.equal(defaultStep(done,[job(0,'done'),job(1,'done')]),1);
});

test('the acceptance checklist reports unfinished shares, failed tests and broken deliveries',async()=>{
  const {acceptanceOf}=await modelModule;
  const done=project({status:'review',roles:roles([],[0]).map(r=>({...r,status:'done'}))});
  const good=acceptanceOf(done,[job(0,'done',{result:{artifacts:[{type:'commit',repo:'tomato',branch:'dev'},{type:'doc',path:'a.md'}]}}),job(1,'done',{result:{artifacts:[{type:'test',pass:12,fail:0}]}})]);
  assert.equal(good.ready,true);assert.deepEqual(good.checks.map(c=>c.ok),[true,true]);assert.equal(good.deliverables.length,2);
  const bad=acceptanceOf(done,[job(0,'done',{result:{artifacts:[{type:'fallback'}]}}),job(1,'done',{result:{artifacts:[{type:'test',pass:3,fail:2}]}})]);
  assert.equal(bad.ready,false);assert.match(bad.checks.find(c=>c.ok===false).label,/失败 2/);assert.ok(bad.checks.some(c=>/生成失败/.test(c.label)));
  const untested=acceptanceOf(done,[job(0,'done',{result:{artifacts:[{type:'commit',repo:'r',branch:'b'}]}}),job(1,'done')]);
  assert.equal(untested.ready,true);assert.ok(untested.checks.some(c=>c.ok===null&&/集成检查/.test(c.label)));
  assert.equal(acceptanceOf(project(),[]).checks[0].ok,false);
});

test('the default team puts people on the post they hold and avoids giving one person every share',async()=>{
  const {defaultTeam}=await modelModule,e=(id,post)=>({id,profile:{post}});
  const full=defaultTeam([e('p','pm'),e('b','backend'),e('f','frontend'),e('t','test'),e('w','writing')]);
  assert.deepEqual(full,{planner:'p',backend:'b',frontend:'f',integrator:'t',developer:'b',tester:'t',writer:'w'});
  const three=defaultTeam([e('p','pm'),e('b1','backend'),e('b2','backend')]);
  assert.equal(new Set([three.planner,three.backend,three.frontend]).size,3);
  assert.equal(defaultTeam([e('p','pm'),e('old','writer')]).writer,'old'); // a post saved under its older name still counts
  assert.equal(defaultTeam([e('p','pm'),e('q','qa'),e('c','code')]).tester,'q');
  const solo=defaultTeam([e('only','general')]);
  assert.ok(Object.values(solo).every(id=>id==='only'));
});

test('the task page shows the flow, the acceptance panel only when it is time, and never trusts text as HTML',async()=>{
  const V=await viewsModule;
  const view={data:null,selected:'p:1',person:id=>`员工${id.slice(1)}`,colourOf:()=>'#f2b544',colour:()=>'#6ea8ff',step:1};
  const running=project({name:'<img src=x onerror=alert(1)>',goal:'<script>alert(1)</script>'}),jobs=[job(0,'done'),job(1,'running',{started_at:'2026-11-13 10:00:00'})];
  view.data=snapshot(running,jobs);
  const html=V.projectPanel(view,{id:'p:1',status:'running',p:running},undefined);
  assert.ok(!html.includes('<script>')&&!html.includes('<img src=x'));
  assert.equal((html.match(/class="ws-stage"/g)||[]).length,4); // three columns of shares and the boss's own step
  assert.equal((html.match(/data-step="/g)||[]).length,4);
  assert.match(html,/data-step="1" aria-pressed="true"/);
  assert.ok(!html.includes('ws-accept'));
  const finished=project({status:'review',roles:roles([],[0]).map(r=>({...r,status:'done'}))});
  view.data=snapshot(finished,[job(0,'done'),job(1,'done',{result:{artifacts:[{type:'test',pass:5,fail:0}]}})]);
  const review=V.projectPanel(view,{id:'p:1',status:'review',p:finished},{kind:'accept',why:'等你验收',view:'tasks'});
  assert.match(review,/data-accept="1"/);assert.match(review,/data-reject="p:1"/);assert.match(review,/通过 5 · 失败 0/);
  assert.equal((review.match(/name="stars-1"/g)||[]).length,3);
  // a single delivery is accepted or sent back as a whole
  const order={id:'x',title:'周报',brief:'写周报',spec:{}},oj={id:'o:x',order_id:'x',employee:'e0',status:'review',attempt:1,result:{summary:'写好了'}};
  view.data=snapshot(null,[oj],[order]);
  const single=V.orderPanel(view,{id:'o:x',status:'review',o:order},{kind:'accept'},'');
  assert.match(single,/data-approve="o:x"/);assert.match(single,/data-reject="o:x"/);assert.ok(!single.includes('data-revise='));
});
