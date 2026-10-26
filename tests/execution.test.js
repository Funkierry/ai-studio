'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCompany } = require('../lib/company');
const { createExecution } = require('../lib/execution');
const { createPreview } = require('../lib/preview');
const G = require('../lib/git');

const output = (files = {}) => ({ ok:true, data:{ summary:'实际交付',document:'正文',notes:'说明',files }, meta:{ model:'fixture',input_tokens:1,output_tokens:1,cny:0.01,ms:1 } });
const waitFor = async predicate => {
  const deadline = Date.now()+20000;
  while(!predicate()) { if(Date.now()>deadline) throw new Error('等待任务超时'); await new Promise(r=>setTimeout(r,10)); }
};
function fixture(t, write) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-execution-'));
  const calls=[];
  const co=createCompany(root,{writer:{status:()=>({fake:true}),write:async args=>{calls.push(args);return write?write(args):output();}}});
  co.syncEmployees(['dev','qa'].map(id=>({id,name:id,model:'fixture',profile:{type:'deepseek'}})));
  const ex=createExecution(co);
  t.after(()=>{ex.close();co.close();});
  return {root,co,ex,calls};
}
const launch = (co, roles) => co.launchProject({name:'任务执行回归',goal:'实现并验证实际代码',roles});
const doc = (name, who='dev', deps=[], gate=false) => ({name,who,deps,gate,out:'文档'});

test('reading state never resets assigned orders or running roles',t=>{
  const {co,ex}=fixture(t);
  const p=launch(co,[doc('说明文档')]);co.roleStarted(p.id,0);
  co.addOrder({id:'o',title:'真实任务',source:'custom'});co.setOrder('o',{status:'assigned',assignee:'dev'});
  for(let i=0;i<4;i++){co.state();ex.snapshot();}
  assert.equal(co.state().projects[0].roles[0].status,'run');
  assert.equal(co.state().orders[0].status,'assigned');
});

test('repeated starts do not duplicate calls; a review frees its employee and gates downstream work',async t=>{
  const pending=[];
  const {co,ex,calls}=fixture(t,()=>new Promise(resolve=>pending.push(resolve)));
  const p=launch(co,[doc('第一份文档','dev',[],true),doc('第二份文档','qa',[0])]);
  ex.createJobs(p.id);ex.createJobs(p.id);
  await waitFor(()=>pending.length===1);
  co.addOrder({id:'o',title:'另一项任务',source:'custom'});ex.startOrder('o','dev');ex.startOrder('o','dev');
  await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,1);
  for(let i=0;i<3;i++)ex.snapshot();
  pending.shift()(output());
  await waitFor(()=>calls.length===2);
  assert.equal(ex.snapshot().jobs.find(j=>j.id===`p:${p.id}:0`).status,'review');
  assert.equal(ex.snapshot().jobs.find(j=>j.id===`p:${p.id}:1`).status,'queued');
  pending.shift()(output());await waitFor(()=>ex.active.size===0);
  ex.approve(`p:${p.id}:0`);ex.approve(`p:${p.id}:0`);
  await waitFor(()=>calls.length===3);pending.shift()(output());await waitFor(()=>ex.active.size===0);
  assert.equal(ex.snapshot().projects[0].status,'review');
  ex.approve('o:o');ex.approve('o:o');
  assert.equal(co.summary().deliverables,1);
  assert.equal(ex.snapshot().spent,0.03);
});

test('pause finishes the current call but prevents downstream calls until resumed',async t=>{
  const pending=[];
  const {co,ex,calls}=fixture(t,()=>new Promise(resolve=>pending.push(resolve)));
  const p=launch(co,[doc('第一份文档'),doc('第二份文档','qa',[0])]);ex.createJobs(p.id);
  await waitFor(()=>calls.length===1);ex.pause(p.id,true);pending.shift()(output());
  await waitFor(()=>ex.active.size===0);
  assert.equal(calls.length,1);assert.equal(ex.snapshot().projects[0].status,'paused');
  ex.pause(p.id,false);await waitFor(()=>calls.length===2);pending.shift()(output());await waitFor(()=>ex.active.size===0);
  assert.equal(ex.snapshot().projects[0].status,'review');
});

test('restart marks in-flight calls interrupted without retrying or releasing dependencies',async t=>{
  const {co,ex,calls}=fixture(t);
  const p=launch(co,[doc('第一份文档'),doc('第二份文档','qa',[0])]);
  ex.close();ex.createJobs(p.id);
  co.executionStore.prepare("UPDATE jobs SET status='running',attempt=1 WHERE role_idx=0").run();
  const recovered=createExecution(co);t.after(()=>recovered.close());recovered.kick();
  await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,0);assert.equal(recovered.snapshot().projects[0].status,'blocked');
  assert.equal(recovered.snapshot().jobs.find(j=>j.role_idx===0).status,'interrupted');
  recovered.revise(`p:${p.id}:0`,'检查后重新执行');await waitFor(()=>recovered.active.size===0&&calls.length===2);
  assert.equal(recovered.snapshot().projects[0].status,'review');
});

test('provider failure blocks dependent work and cannot be approved',async t=>{
  const {co,ex,calls}=fixture(t,()=>({ok:false,reason:'模型不可用'}));
  const p=launch(co,[doc('第一份文档'),doc('第二份文档','qa',[0])]);ex.createJobs(p.id);
  await waitFor(()=>calls.length===1&&ex.active.size===0);
  assert.equal(ex.snapshot().projects[0].status,'blocked');assert.equal(calls.length,1);
  assert.throws(()=>ex.approve(`p:${p.id}:0`),/尚未达到/);
  assert.throws(()=>ex.revise(`p:${p.id}:0`,'   '),/具体/);
});

test('demo orders and invalid dependency graphs cannot start real work',t=>{
  const {co,ex}=fixture(t);
  co.addOrder({id:'demo',title:'演示任务',source:'incoming'});
  assert.throws(()=>ex.startOrder('demo','dev'),/演示订单/);
  assert.equal(ex.snapshot().orders.length,0);assert.equal(ex.snapshot().demoHidden,1);
  assert.throws(()=>launch(co,[doc('非法分工','dev',[0])]),/依赖/);
  assert.equal(ex.snapshot().projects.length,0);
});

test('legacy custom delivery is recovered for review without another model call',async t=>{
  const {co,ex,calls}=fixture(t);
  co.addOrder({id:'legacy',title:'已生成文档',source:'custom'});
  co.setOrder('legacy',{status:'assigned',assignee:'dev'});
  await co.orderDeliver('legacy',{lead:'dev'});
  const recovered=createExecution(co);t.after(()=>recovered.close());recovered.kick();
  await new Promise(r=>setImmediate(r));
  const j=recovered.snapshot().jobs.find(j=>j.order_id==='legacy');
  assert.equal(j.status,'review');assert.ok(j.result.doc);assert.equal(calls.length,1);
  recovered.approve(j.id);assert.equal(co.summary().deliverables,1);
});

test('revision reruns affected roles against new upstream code and only acceptance changes main',async t=>{
  let revision=0;const prompts=[];
  const {root,co,ex,calls}=fixture(t,args=>{
    if(args.kind==='code')return output({'web/counter.cjs':`exports.next = value => value + ${++revision};`,'web/index.html':'<!doctype html><title>Counter</title><button>+1</button>'});
    prompts.push(args.prompt);
    return output({'tests/counter.test.js':`const test=require('node:test');const assert=require('node:assert/strict');const {next}=require('../web/counter.cjs');test('real logic',()=>assert.equal(next(0),${revision}));`});
  });
  const p=launch(co,[{name:'代码开发',out:'代码',who:'dev',deps:[]},{name:'测试验收',out:'测试',who:'qa',deps:[0]}]);
  const dir=path.join(root,'repos',p.slug),head=G.git(dir,['rev-parse','main']);ex.createJobs(p.id);
  await waitFor(()=>calls.length===2&&ex.active.size===0);
  assert.equal(ex.snapshot().projects[0].status,'review');assert.equal(G.git(dir,['rev-parse','main']),head);
  assert.equal(ex.revise(`p:${p.id}:0`,'每次增加 2').affected,2);
  await waitFor(()=>calls.length===4&&ex.active.size===0);
  assert.equal(ex.snapshot().projects[0].status,'review');
  assert.match(prompts[1],/exports.next = value => value \+ 2;/);
  assert.doesNotMatch(prompts[1],/exports.next = value => value \+ 1;/);
  assert.equal(G.git(dir,['rev-parse','main']),head);
  assert.equal(co.executionStore.prepare("SELECT COUNT(*) n FROM pull_requests WHERE status='closed'").get().n,2);
  const result=co.projectReview(p.id,{stars:3});
  assert.equal(result.artifacts.find(a=>a.type==='test').pass,1);
  assert.match(G.show(dir,'main','web/counter.cjs'),/\+ 2/);
  assert.deepEqual(G.tags(dir),['v1.0']);
});

test('preview serves committed files on a separate origin and rejects write requests',async t=>{
  const {co}=fixture(t,()=>output({'web/index.html':'<!doctype html><title>Preview</title>'}));
  const p=launch(co,[{name:'代码开发',who:'dev',deps:[],out:'代码'}]);
  await co.roleDone(p.id,0,{attempt:1});
  const preview=createPreview(co);t.after(()=>preview.server.close());
  if(!preview.server.listening)await new Promise(r=>preview.server.once('listening',r));
  const url=`${preview.url()}/${encodeURIComponent(p.slug)}/${encodeURIComponent('feat/role-1-r1')}/web/index.html`;
  const r=await fetch(url);assert.equal(r.status,200);assert.match(await r.text(),/<title>Preview/);
  assert.match(r.headers.get('content-security-policy'),/form-action 'none'/);
  assert.equal((await fetch(url,{method:'POST'})).status,404);
});
