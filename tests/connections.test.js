'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const writer = require('../lib/writer');
const {createCompany} = require('../lib/company');
const {createExecution} = require('../lib/execution');
const {claudeCode,codexCli} = require('../lib/providers/cli');
const providers = {anthropic:require('../lib/providers/anthropic'),openai:require('../lib/providers/openai'),deepseek:require('../lib/providers/deepseek'),'claude-cli':claudeCode,'codex-cli':codexCli};

function mockProviders(t, unavailable=[]) {
  const calls=[];
  for(const [id,p] of Object.entries(providers)) {
    t.mock.method(p,'status',()=>({name:id,model:`model:${id}`,configured:!unavailable.includes(id),hint:unavailable.includes(id)?'未配置':'已配置'}));
    t.mock.method(p,'generate',async args=>{
      calls.push({id,args});
      return {text:JSON.stringify(args.schema.properties.message?{message:'按所选接入回复。',action:'continue',target_roles:[]}:{summary:'实际交付',document:'说明正文',open_questions:[]}),model:`model:${id}`,input_tokens:1,output_tokens:1,usd:0};
    });
  }
  return calls;
}
const request = (type,connection,kind='doc') => ({employee:{name:'员工',type,connection},kind,prompt:'整理一份说明'});
const until = async predicate => { const end=Date.now()+20000;while(!predicate()){if(Date.now()>end)throw new Error('等待调用超时');await new Promise(r=>setTimeout(r,15));} };

test('explicit local and API choices route both deliverables and discussions without fallback',async t=>{
  const calls=mockProviders(t);
  const local=await writer.write(request('claude','local'));
  const api=await writer.write(request('claude','api','discussion'));
  const codex=await writer.write(request('gpt','local','discussion'));
  assert.equal(local.meta.provider,'claude-cli');assert.equal(api.meta.provider,'anthropic');assert.equal(codex.meta.provider,'codex-cli');
  assert.deepEqual(calls.map(c=>c.id),['claude-cli','anthropic','codex-cli']);
  const status=writer.status();assert.equal(status.connections.local.claude,'claude-cli');assert.equal(status.connections.api.claude,'anthropic');
  assert.equal(status.connections.local.deepseek,undefined);assert.equal(status.connections.api.deepseek,'deepseek');
  assert.equal(status.providers['codex-cli'].connection,'local');
});

test('an unavailable, unsupported or failed explicit connection never calls the other provider',async t=>{
  const calls=mockProviders(t,['anthropic']);
  assert.equal((await writer.write(request('claude','api'))).ok,false);
  assert.equal((await writer.write(request('deepseek','local'))).ok,false);
  assert.equal((await writer.write(request('claude','invalid'))).ok,false);
  assert.equal(calls.length,0);
  t.mock.method(claudeCode,'generate',async()=>{throw new Error('本机登录失效');});
  assert.match((await writer.write(request('claude','local'))).reason,/本机登录失效/);
  assert.equal(calls.length,0);
});

test('employees without a saved connection keep the existing automatic selection',async t=>{
  const calls=mockProviders(t,['anthropic']);
  assert.equal((await writer.write(request('claude'))).meta.provider,'claude-cli');
  assert.equal((await writer.write(request('gpt'))).meta.provider,'openai');
  assert.deepEqual(calls.map(c=>c.id),['claude-cli','openai']);
});

test('employee connection persists after reopening and reaches real writer routing without changing history',async t=>{
  const calls=mockProviders(t),root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-access-'));
  let co=createCompany(root),ex=createExecution(co);
  t.after(()=>{ex.close();co.close();});
  const employee=ex.addEmployee({name:'接入验收',type:'claude',connection:'local',post:'writing',persona:'简洁'});
  co.executionStore.prepare('UPDATE employees SET spent=7,level=4 WHERE id=?').run(employee.id);
  ex.updateEmployeeConnection(employee.id,{type:'claude',connection:'api'});
  const saved=ex.snapshot().employees.find(e=>e.id===employee.id);
  assert.equal(saved.name,'接入验收');assert.equal(saved.profile.persona,'简洁');assert.equal(saved.profile.post,'writing');assert.equal(saved.spent,7);assert.equal(saved.level,4);
  ex.close();co.close();co=createCompany(root);ex=createExecution(co);
  assert.equal(ex.snapshot().employees.find(e=>e.id===employee.id).profile.connection,'api');
  co.addOrder({id:'access-order',title:'接入验收说明',source:'custom'});ex.startOrder('access-order',employee.id);
  await until(()=>ex.active.size===0&&calls.length===1);
  assert.deepEqual(calls.map(c=>c.id),['anthropic']);
  assert.equal(ex.snapshot().jobs[0].status,'review');
});

test('connection changes reject invalid options and cannot change an in-flight employee',t=>{
  mockProviders(t,['anthropic']);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-access-busy-')),co=createCompany(root),ex=createExecution(co);
  t.after(()=>{ex.close();co.close();});ex.close();
  assert.throws(()=>ex.addEmployee({name:'无配置',type:'claude',connection:'api'}),/未配置/);
  assert.throws(()=>ex.addEmployee({name:'错误接入',type:'deepseek',connection:'local'}),/不支持/);
  assert.throws(()=>ex.addEmployee({name:'错误接入',type:'claude',connection:'auto'}),/请选择/);
  const e=ex.addEmployee({name:'忙碌员工',type:'claude',connection:'local'});
  co.executionStore.prepare("INSERT INTO jobs(id,employee,status) VALUES('busy',?,'running')").run(e.id);
  assert.throws(()=>ex.updateEmployeeConnection(e.id,{type:'gpt',connection:'api'}),/仍在执行/);
  co.executionStore.prepare("UPDATE jobs SET status='done' WHERE id='busy'").run();
  const project=co.launchProject({name:'进行中的讨论',roles:[{name:'需求说明',out:'文档',who:e.id,deps:[]}]});
  co.executionStore.prepare("INSERT INTO discussion_turns(project_id,role_idx,employee,purpose,status) VALUES(?,0,?,'kickoff','running')").run(project.id,e.id);
  assert.throws(()=>ex.updateEmployeeConnection(e.id,{type:'gpt',connection:'api'}),/仍在执行/);
  assert.equal(ex.snapshot().employees.find(x=>x.id===e.id).profile.connection,'local');
});
