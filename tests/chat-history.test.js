'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const store=require('../lib/store');
const {createChatHistory}=require('../lib/chat-history');
function setup(t) {
  const db=store.open(':memory:');t.after(()=>db.close());
  db.exec("INSERT INTO projects(id,name) VALUES(1,'项目甲'),(2,'项目乙'); INSERT INTO employees(id,name) VALUES('a','方案员'),('b','审查员')");
  const insert=db.prepare('INSERT INTO project_messages(project_id,sender,recipient,kind,body,reply_to,meta,created_at) VALUES(?,?,?,?,?,?,?,?)');
  const add=(pid,sender,body,reply=null,meta={},to='team',kind='discussion')=>Number(insert.run(pid,sender,to,kind,body,reply,JSON.stringify(meta),'2026-10-31 03:00:00').lastInsertRowid);
  return {db,history:createChatHistory(db),add};
}
test('literal keyword, participant, project and time filters preserve provenance',t=>{
  const {history,add}=setup(t);
  const id=add(1,'a','接口 100%_ ready',null,{provider:'deepseek',model:'real'},'b','question');
  add(2,'a','接口 100xx ready',null,{provider:'fake'});
  add(1,'boss','接口选择');add(1,'system','接口结果');
  assert.deepEqual(history.search({q:'%_'}).messages.map(m=>m.id),[id]);
  assert.equal(history.search({q:"' OR 1=1 --"}).total,0);
  const found=history.search({project:1,participant:'b',kind:'question',since:'2026-10-31T02:59:00Z',until:'2026-10-31T03:01:00Z'});
  assert.equal(found.total,1);assert.equal(found.messages[0].source,'model');assert.equal(found.messages[0].sender_name,'方案员');
  assert.equal(history.search({project:2}).messages[0].source,'test');
  assert.equal(history.search({sender:'boss'}).messages[0].source,'human');
  assert.equal(history.search({sender:'system'}).messages[0].source,'system');
  assert.throws(()=>history.search({since:'nonsense'}),/时间/);
  assert.throws(()=>history.search({project:'NaN'}),/编号/);
  assert.throws(()=>history.search({limit:'-1'}),/编号/);
});
test('stable pagination excludes newer arrivals and has no omissions across 200+ rows',t=>{
  const {history,add,db}=setup(t);
  for(let i=0;i<235;i++)add(1,'a',`记录 ${i}`);
  let page=history.search({limit:37}), ids=page.messages.map(m=>m.id),snapshot=page.snapshot;
  add(1,'a','查询期间的新消息');
  while(page.nextBefore){page=history.search({limit:37,snapshot,before:page.nextBefore});assert.equal(page.total,235);ids.push(...page.messages.map(m=>m.id));}
  assert.equal(ids.length,235);assert.equal(new Set(ids).size,235);assert.equal(Math.max(...ids),235);
  assert.equal(db.prepare('SELECT count(*) n FROM discussion_turns').get().n,0);
});
test('context links replies only inside the same project; unknown sources stay unknown',t=>{
  const {history,add}=setup(t);
  const q=add(1,'a','请确认口令',null,{},'b','question');
  const answer=add(1,'b','口令 CHECK-42',q,{provider:'deepseek',model:'real'},'a');
  add(2,'b','不应泄漏到甲项目',q);
  const followup=add(1,'a','已采用',answer,{artifacts:[{type:'llm',provider:'claude-cli',model:'claude'}]},'team','delivery');
  assert.deepEqual(history.context(q).replies.map(m=>m.id),[answer]);
  assert.deepEqual(history.context(followup).parents.map(m=>m.id),[q,answer]);
  assert.equal(history.context(q).message.source,'unknown');
  assert.equal(history.context(followup).message.source,'model');
  assert.throws(()=>history.context(900),/不存在/);
  assert.equal(history.filters().projects.length,2);
});
