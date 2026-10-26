'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createCompany} = require('../lib/company');
const {createExecution} = require('../lib/execution');
const G = require('../lib/git');

const meta={provider:'fixture',model:'fixture',input_tokens:1,output_tokens:1,cny:0,ms:1};
const talk=(message,action='continue',target_roles=[])=>({ok:true,data:{message,action,target_roles},meta});
const work=(files={},document='共同约定',open_questions=[])=>({ok:true,data:{summary:document,notes:document,document,open_questions,files},meta});
const until=async predicate=>{const deadline=Date.now()+60000;while(!predicate()){if(Date.now()>deadline)throw new Error('协作等待超时');await new Promise(r=>setTimeout(r,15));}};
function setup(t,write){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-team-')),calls=[];
  const co=createCompany(root,{writer:{status:()=>({fake:true}),write:args=>{calls.push(args);return write(args);}}});
  co.syncEmployees(['pm','api','ui','qa'].map(id=>({id,name:id,model:'fixture',profile:{type:'deepseek'}})));
  const ex=createExecution(co);t.after(()=>{ex.close();co.close();});
  return {root,co,ex,calls};
}
const simpleRoles=[{name:'需求规划',out:'说明文档',who:'pm',deps:[]},{name:'补充说明',out:'说明文档',who:'api',deps:[0]}];

test('employees ask and reply, share decisions, repair a real test failure and publish autonomously',async t=>{
  let changes=0,asked=false;const qaPrompts=[];
  const {root,co,ex,calls}=setup(t,async args=>{
    if(args.kind==='discussion'){
      if(args.prompt.includes('## 本次发言：triage')){
        assert.match(args.prompt,/失败 1|fail.*1/);
        return talk('实际断言发现 next(0) 得到 1，应为 2。请 api 修复 server/logic.cjs，qa 保留断言复测。','revise',[1]);
      }
      if(args.employee.id==='pm'&&!asked){asked=true;return talk('api，请确认 STEP_CONTRACT 的步长采用 2。','question',[1]);}
      if(args.prompt.includes('## 本次发言：reply')){assert.match(args.prompt,/STEP_CONTRACT/);return talk('确认 STEP_CONTRACT：步长为 2，前端与测试共同遵守。');}
      return talk(`${args.employee.id} 已阅读同事消息并同意 STEP_CONTRACT。`);
    }
    assert.match(args.prompt,/确认 STEP_CONTRACT/);
    if(args.kind==='prd')return work({},'STEP_CONTRACT：步长 2');
    if(args.kind==='backend')return work({'server/logic.cjs':`exports.next = n => n + ${++changes};`});
    if(args.kind==='frontend')return work({'web/view.cjs':'exports.label = "STEP_CONTRACT";'});
    qaPrompts.push(args.prompt);
    return work({'tests/flow.test.js':"const test=require('node:test'),assert=require('node:assert/strict');test('actual upstream behavior',()=>{assert.equal(require('../server/logic.cjs').next(0),2);assert.equal(require('../web/view.cjs').label,'STEP_CONTRACT');});"});
  });
  const {collaborationRoles}=await import('../public/collaboration-plan.js');
  const p=co.launchProject({name:'自主协作回归',goal:'员工自行完成步长为 2 的功能',autonomous:true,roles:collaborationRoles({planner:'pm',backend:'api',frontend:'ui',tester:'qa',autonomous:true})});
  ex.createJobs(p.id);ex.createJobs(p.id);
  await until(()=>ex.snapshot().projects[0].status==='done'&&ex.active.size===0);
  const s=ex.snapshot(),jobs=s.jobs,rows=ex.messages(p.id).messages;
  assert.deepEqual(jobs.map(j=>j.attempt),[1,2,1,2]);
  assert.equal(s.projects[0].collaboration.repairs,1);
  assert.equal(calls.filter(c=>c.kind==='discussion').length,6);
  const question=rows.find(m=>m.sender==='pm'&&m.kind==='question');
  assert.ok(question);assert.ok(rows.find(m=>m.sender==='api'&&m.reply_to===question.id));
  assert.ok(rows.find(m=>m.sender==='qa'&&m.kind==='revision'&&m.recipient==='api'));
  assert.ok(rows.find(m=>m.kind==='test_result'&&/失败 1/.test(m.body)));
  assert.ok(rows.find(m=>m.kind==='release'));
  assert.match(qaPrompts[1],/n \+ 2/);
  assert.equal(G.show(path.join(root,'repos',p.slug),'main','server/logic.cjs'),'exports.next = n => n + 2;');
  assert.deepEqual(G.tags(path.join(root,'repos',p.slug)),['v1.0']);
  const costCount=co.executionStore.prepare("SELECT COUNT(*) n FROM ledger WHERE source='api'").get().n;
  assert.equal(costCount,calls.length);
  for(let i=0;i<4;i++)ex.snapshot();
  assert.equal(ex.messages(p.id).messages.length,rows.length);
  assert.throws(()=>ex.revise(`p:${p.id}:1`,'改已发布代码'),/已经发布/);
});

test('a critical question pauses work; boss messages are durable and deduplicated and respect pause',async t=>{
  let asked=false;
  const {co,ex,calls}=setup(t,async args=>{
    if(args.kind==='discussion'){
      if(!asked){asked=true;return talk('交付语言需要确认，请老板决定。','ask_user');}
      if(args.prompt.includes('boss_reply'))assert.match(args.prompt,/只用中文/);
      return talk('收到，使用中文。');
    }
    assert.match(args.prompt,/只用中文/);return work();
  });
  const p=co.launchProject({name:'需要确认',goal:'整理说明',roles:simpleRoles,autonomous:true});ex.createJobs(p.id);
  await until(()=>ex.active.size===0&&ex.snapshot().projects[0].status==='blocked');
  assert.equal(calls.length,1);ex.pause(p.id,true);
  const body={body:'只用中文，其他细节你们自行决定。',clientId:'boss-answer-0001'};
  const first=ex.postMessage(p.id,body),second=ex.postMessage(p.id,body);assert.equal(first.id,second.id);
  await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);
  assert.equal(ex.snapshot().projects[0].status,'paused');
  ex.pause(p.id,false);await until(()=>ex.snapshot().projects[0].status==='done'&&ex.active.size===0);
  assert.equal(ex.messages(p.id).messages.filter(m=>m.kind==='message').length,1);
});

test('discussion recovery requires explicit retry and never fabricates an employee reply',async t=>{
  const {co,ex,calls}=setup(t,async args=>args.kind==='discussion'?talk('恢复后真实回复'):work());
  const p=co.launchProject({name:'讨论恢复',roles:simpleRoles,autonomous:true});ex.close();ex.createJobs(p.id);
  co.executionStore.prepare("UPDATE discussion_turns SET status='running',attempt=1 WHERE role_idx=0").run();
  const recovered=createExecution(co);t.after(()=>recovered.close());recovered.kick();
  await new Promise(r=>setImmediate(r));assert.equal(calls.length,0);
  assert.equal(recovered.messages(p.id).messages.filter(m=>m.sender==='pm').length,0);
  const turn=recovered.snapshot().projects[0].discussion.find(t=>t.status==='interrupted');
  recovered.retryDiscussion(turn.id);
  await until(()=>recovered.snapshot().projects[0].status==='done'&&recovered.active.size===0);
  assert.equal(recovered.snapshot().projects[0].discussion.find(t=>t.id===turn.id).attempt,2);
});

test('unresolved failures stop after the automatic repair limit and never publish',async t=>{
  const {co,ex,root}=setup(t,async args=>{
    if(args.kind==='discussion')return args.prompt.includes('## 本次发言：triage')?talk('测试实际失败，请 api 修复 next。','revise',[0]):talk('准备执行。');
    if(args.kind==='code')return work({'web/logic.cjs':'exports.next = () => 1;'});
    return work({'tests/logic.test.js':"const test=require('node:test'),assert=require('node:assert/strict');test('actual logic',()=>assert.equal(require('../web/logic.cjs').next(),2));"});
  });
  const p=co.launchProject({name:'返工有界',autonomous:true,roles:[{name:'代码开发',out:'代码',who:'api',deps:[]},{name:'测试验收',out:'测试',who:'qa',deps:[0]}]});ex.createJobs(p.id);
  await until(()=>ex.active.size===0&&ex.snapshot().projects[0].collaboration.stage==='needs_input');
  const s=ex.snapshot();assert.equal(s.projects[0].collaboration.repairs,2);assert.deepEqual(s.jobs.map(j=>j.attempt),[3,3]);
  assert.deepEqual(G.tags(path.join(root,'repos',p.slug)),[]);
  assert.match(s.projects[0].collaboration.reason,/2 轮/);
});

test('invalid employee routing fails without changing jobs or showing a fake message',async t=>{
  const {co,ex}=setup(t,async()=>talk('请不存在的同事处理。','question',[999]));
  const p=co.launchProject({name:'路由检查',roles:simpleRoles,autonomous:true});ex.createJobs(p.id);
  await until(()=>ex.active.size===0&&ex.snapshot().projects[0].status==='blocked');
  assert.ok(ex.snapshot().jobs.every(j=>j.attempt===0));
  assert.equal(ex.messages(p.id).messages.filter(m=>m.sender==='pm').length,0);
  assert.throws(()=>ex.postMessage(p.id,{body:'你好',targetRole:999,clientId:'invalid-recipient'}),/本项目/);
});

test('a pending boss message prevents acceptance and one employee never runs two calls at once',async t=>{
  let release;const {co,ex,calls}=setup(t,args=>args.kind==='discussion'?new Promise(resolve=>{release=()=>resolve(talk('已阅读补充。'));}):Promise.resolve(work()));
  const p=co.launchProject({name:'讨论挡住验收',roles:[simpleRoles[0]]});ex.createJobs(p.id);
  await until(()=>ex.active.size===0&&calls.length===1);
  ex.postMessage(p.id,{body:'请说明交付依据。',clientId:'boss-question-002'});
  assert.throws(()=>co.projectReview(p.id,{stars:3}),/讨论尚未/);
  await until(()=>ex.active.size===1);
  assert.equal(ex.snapshot().projects.find(x=>x.id===p.id).status,'running');
  const other=co.launchProject({name:'同一员工另一工作',roles:[simpleRoles[0]]});ex.createJobs(other.id);
  await new Promise(r=>setImmediate(r));assert.equal(calls.length,2);
  release();await until(()=>ex.active.size===0&&calls.length===3);
  co.projectReview(p.id,{stars:3});assert.equal(ex.snapshot().projects.find(x=>x.id===p.id).status,'done');
});

test('exhausted discussion budget remains blocked when a real test failure needs triage',async t=>{
  const {co,ex,calls,root}=setup(t,async args=>{
    if(args.kind==='discussion')return talk('共同约定：实际结果应为 2。');
    if(args.kind==='code')return work({'web/logic.cjs':'exports.next = () => 1;'});
    return work({'tests/budget.test.js':"const test=require('node:test'),assert=require('node:assert/strict');test('actual result',()=>assert.equal(require('../web/logic.cjs').next(),2));"});
  });
  const p=co.launchProject({name:'讨论预算边界',autonomous:true,roles:[{name:'代码开发',out:'代码',who:'api',deps:[]},{name:'测试验收',out:'测试',who:'qa',deps:[0]}]});
  co.executionStore.prepare('UPDATE project_team SET max_turns=2 WHERE project_id=?').run(p.id);
  ex.createJobs(p.id);
  await until(()=>ex.active.size===0&&ex.snapshot().projects[0].collaboration.stage==='needs_input');
  const s=ex.snapshot();assert.equal(s.projects[0].status,'blocked');assert.match(s.projects[0].collaboration.reason,/2 次讨论/);
  assert.equal(calls.filter(c=>c.kind==='discussion').length,2);assert.equal(s.projects[0].collaboration.repairs,0);
  assert.deepEqual(G.tags(path.join(root,'repos',p.slug)),[]);
  ex.kick();await new Promise(r=>setImmediate(r));assert.equal(ex.snapshot().projects[0].status,'blocked');
});
