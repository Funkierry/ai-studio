'use strict';
// The record of how work went, and the plain files it leaves on disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createCompany } = require('../lib/company');
const { createExecution } = require('../lib/execution');
const { createTrail } = require('../lib/trail');
const { createOutputs } = require('../lib/outputs');
const { createPreview } = require('../lib/preview');

const output = (files = {}, extra = {}) => ({ ok: true, sent: '完整任务书 + 要交的东西', data: { summary: '实际交付', document: '## 正文\n\n写好了', notes: '说明', files, ...extra },
  meta: { model: 'fixture', input_tokens: 10, output_tokens: 20, cny: 0.01, ms: 1200 } });
const waitFor = async predicate => {
  const deadline = Date.now() + 20000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('等待任务超时'); await new Promise(r => setTimeout(r, 10)); }
};
function fixture(t, write) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-trail-')), out = path.join(root, '成品');
  const calls = [], opened = [], changed = [];
  const co = createCompany(root, { writer: { status: () => ({ fake: true }), write: async args => { calls.push(args); return write ? write(args, calls.length) : output(); } } });
  co.syncEmployees(['dev', 'qa'].map(id => ({ id, name: id === 'dev' ? '小开' : '小测', model: 'fixture', profile: { type: 'deepseek' } })));
  const trail = createTrail(co), outputs = createOutputs(co, out, { trail, opener: dir => opened.push(dir) });
  const ex = createExecution(co, { onChange: work => { changed.push(work); outputs.sync(work); } });
  t.after(() => { ex.close(); co.close(); });
  return { root, out, co, ex, trail, outputs, calls, opened, changed };
}
const order = (co, ex, id, title = '周报') => { co.addOrder({ id, title, brief: '写本周周报', source: 'custom', spec: { detail: '写本周周报', deliverable: { kind: 'doc' } } }); ex.startOrder(id, 'dev'); };

test('a single delivery leaves a record of the request, the call behind each version, the send-back and the acceptance', async t => {
  const { co, ex, trail, calls } = fixture(t);
  order(co, ex, 'w1');
  await waitFor(() => ex.active.size === 0 && calls.length === 1);
  let r = trail.of('o:w1');
  assert.deepEqual(r.entries.map(e => [e.from, e.kind]), [['boss', 'ask'], ['dev', 'delivery']]);
  assert.equal(r.entries[0].body, '写本周周报');
  assert.equal(r.entries[1].body, '实际交付');
  assert.deepEqual(r.entries[1].artifacts.map(a => a.type), ['doc']);
  // the call can be opened in full: exactly what was sent, and what came back
  const call = trail.call(r.entries[1].call.id);
  assert.equal(call.prompt, '完整任务书 + 要交的东西');
  assert.deepEqual([call.status, call.model, call.tokens, call.reply.summary, call.reply.text], ['done', 'fixture', 30, '实际交付', '## 正文\n\n写好了']);
  assert.equal(r.entries[1].call.prompt, undefined); // the list stays light; the text is fetched when asked for

  ex.revise('o:w1', '加上下周计划');
  await waitFor(() => ex.active.size === 0 && calls.length === 2);
  ex.approve('o:w1');
  r = trail.of('o:w1');
  assert.deepEqual(r.entries.map(e => e.kind), ['ask', 'delivery', 'revision', 'delivery', 'release']);
  assert.equal(r.entries[2].body, '加上下周计划');
  assert.equal(r.entries[3].attempt, 2);
  assert.match(calls[1].prompt, /加上下周计划/);
  assert.throws(() => trail.of('o:none'), /没有这项工作/);
  assert.throws(() => trail.call(999), /没有这次调用/);
});

test('a call that fails or is still running is visible, and a restart marks it as interrupted', async t => {
  let release;
  const { root, co, ex, trail, calls } = fixture(t, (args, n) => n === 1 ? { ok: false, reason: '模型超时', sent: '任务书' } : new Promise(resolve => { release = () => resolve(output()); }));
  order(co, ex, 'w2');
  await waitFor(() => calls.length === 1 && ex.active.size === 0);
  let r = trail.of('o:w2');
  assert.deepEqual(r.entries.map(e => e.kind), ['ask', 'failure']);
  assert.match(r.entries[1].body, /小开 的这次调用没有完成：模型超时/);
  assert.equal(trail.call(r.entries[1].call.id).prompt, '任务书');
  ex.revise('o:w2', '再试一次');
  await waitFor(() => calls.length === 2);
  r = trail.of('o:w2');
  assert.equal(r.running.length, 1);
  assert.deepEqual([r.running[0].employee, r.running[0].status], ['dev', 'running']);
  // the studio is closed while the call is out
  ex.close();
  const again = createExecution(co); t.after(() => again.close());
  assert.equal(trail.of('o:w2').running.length, 0);
  assert.equal(trail.of('o:w2').entries.at(-1).kind, 'failure');
  release();
  assert.ok(fs.existsSync(root));
});

test('a project records discussion, deliveries, the boss confirming a share and accepting the whole', async t => {
  const { co, ex, trail, calls, changed } = fixture(t, args => args.kind === 'test'
    ? output({ 'tests/a.test.js': "const test=require('node:test');test('ok',()=>{});" }) : args.kind === 'code' ? output({ 'web/index.html': '<h1>hi</h1>', 'README.md': '# 用法' }) : output());
  const p = co.launchProject({ name: '小工具', goal: '做一个小工具', roles: [
    { name: '代码开发', who: 'dev', deps: [], gate: true, out: '代码' }, { name: '测试验收', who: 'qa', deps: [0], gate: false, out: 'tests/ 测试' }] });
  ex.createJobs(p.id);
  await waitFor(() => ex.active.size === 0 && calls.length === 1);
  ex.approve(`p:${p.id}:0`);
  await waitFor(() => ex.snapshot().projects[0].status === 'review');
  ex.review(p.id, { stars: 2 });
  const r = trail.of(`p:${p.id}`);
  assert.deepEqual(r.entries.map(e => [e.from, e.kind]), [['boss', 'ask'], ['dev', 'delivery'], ['boss', 'approval'], ['qa', 'delivery'], ['boss', 'release']]);
  assert.equal(r.entries[1].role, 0);
  assert.ok(r.entries[1].call.id && r.entries[3].call.id, 'each delivery points at the call that wrote it');
  assert.deepEqual(r.entries[3].artifacts.map(a => a.type).sort(), ['commit', 'doc', 'test']);
  assert.equal(r.entries[3].artifacts.find(a => a.type === 'test').output, undefined); // test logs do not travel with the list
  assert.match(r.entries[4].body, /验收通过 ★★，已发布 v1\.0/);
  assert.ok(changed.includes(`p:${p.id}`));
  // a second acceptance changes nothing and adds nothing
  ex.review(p.id, { stars: 3 });
  assert.equal(trail.of(`p:${p.id}`).entries.length, 5);
});

test('finished work is saved as plain files: the program, the documents and a readable record', async t => {
  const { out, co, ex, outputs, calls, opened } = fixture(t, args => args.kind === 'test'
    ? output({ 'tests/a.test.js': "const test=require('node:test');test('ok',()=>{});" }) : args.kind === 'code' ? output({ 'web/index.html': '<h1>hi</h1>\n', 'web/app.js': 'let n=0;', 'README.md': '# 用法\n' }) : output());
  const p = co.launchProject({ name: '计数器', goal: '做一个计数器', roles: [
    { name: '代码开发', who: 'dev', deps: [], gate: false, out: '代码' }, { name: '测试验收', who: 'qa', deps: [0], gate: false, out: 'tests/ 测试' }] });
  const id = `p:${p.id}`;
  assert.deepEqual(outputs.list(id).files, []); // nothing handed in yet: no folder is made
  assert.equal(fs.existsSync(out), false);
  assert.throws(() => outputs.open(id), /还没有成品/);
  ex.createJobs(p.id);
  await waitFor(() => ex.snapshot().projects[0].status === 'review');
  let list = outputs.list(id);
  const dir = path.join(out, `${p.id}-计数器`);
  assert.equal(list.dir, dir); assert.equal(list.final, false);
  // before acceptance the shares are still on their own branches; the folder already has all of them
  for (const f of ['程序/web/index.html', '程序/web/app.js', '程序/README.md', '程序/tests/a.test.js', '文档/00-工作单.md', '文档/01-代码开发.md', '文档/02-测试验收.md', '过程记录.md'])
    assert.ok(list.files.some(x => x.path === f), `missing ${f}`);
  assert.equal(fs.readFileSync(path.join(dir, '程序/web/index.html'), 'utf8'), '<h1>hi</h1>\n'); // byte for byte, final newline included
  assert.equal(list.page, '程序/web/index.html');
  assert.equal(list.files.filter(f => f.path.startsWith('过程记录/调用-')).length, 2);
  const record = fs.readFileSync(path.join(dir, '过程记录.md'), 'utf8');
  assert.match(record, /老板 → 全体　提出要求/); assert.match(record, /小开 → 全体　交付\*\*（fixture，1 秒，¥0\.01，调用 #1）/); assert.match(record, /- 文档 01-代码开发\.md/);
  const callFile = list.files.find(f => f.path.startsWith('过程记录/调用-001-小开'));
  assert.match(fs.readFileSync(path.join(dir, callFile.path), 'utf8'), /## 交给模型的任务书\n\n完整任务书 \+ 要交的东西[\s\S]*## 模型的回复[\s\S]*web\/index\.html/);
  // the working copy of the repository is left exactly as it was
  assert.equal(co.git.log(`${p.id}-计数器`, 'main').length, 1);

  ex.review(p.id, { stars: 3 });
  list = outputs.list(id);
  assert.equal(list.final, true);
  assert.ok(list.files.some(f => f.path === '文档/99-项目总结.md'));
  // reading: text comes back, anything the studio did not export does not
  assert.equal(outputs.read(id, '程序/web/app.js').content, 'let n=0;');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'x');
  assert.throws(() => outputs.read(id, 'secret.txt'), /没有这个文件/);
  assert.throws(() => outputs.read(id, '../company.db'), /没有这个文件/);
  // after acceptance the files belong to the boss: a later message refreshes the record only
  fs.writeFileSync(path.join(dir, '程序/web/app.js'), 'let n=100; // 我自己改的');
  ex.postMessage(p.id, { body: '谢谢，做得好', targetRole: 0, clientId: 'client-0001' });
  await waitFor(() => ex.active.size === 0 && calls.length === 3);
  outputs.sync(id);
  assert.equal(fs.readFileSync(path.join(dir, '程序/web/app.js'), 'utf8'), 'let n=100; // 我自己改的');
  assert.match(fs.readFileSync(path.join(dir, '过程记录.md'), 'utf8'), /谢谢，做得好/);
  assert.ok(fs.existsSync(path.join(dir, 'secret.txt')), 'files the boss added are never removed');

  outputs.open(id); outputs.open();
  assert.deepEqual(opened, [dir, out]);
});

test('a document order is saved under its own name, replaced when redone, and old data is exported in one pass', async t => {
  const { out, co, ex, outputs, calls } = fixture(t, (args, n) => output({}, { document: `第 ${n} 版正文` }));
  order(co, ex, 'abcdef123456', '读书会 招募/文案');
  await waitFor(() => ex.active.size === 0 && calls.length === 1);
  const dir = path.join(out, '读书会 招募文案-abcdef12');
  assert.deepEqual(outputs.list('o:abcdef123456').files.map(f => f.path), ['读书会 招募文案.md', '过程记录.md', '过程记录/调用-001-小开-撰写文档.md']);
  assert.match(fs.readFileSync(path.join(dir, '读书会 招募文案.md'), 'utf8'), /第 1 版正文/);
  ex.revise('o:abcdef123456', '改短一点');
  await waitFor(() => ex.active.size === 0 && calls.length === 2);
  assert.match(fs.readFileSync(path.join(dir, '读书会 招募文案.md'), 'utf8'), /第 2 版正文/);
  assert.equal(outputs.list('o:abcdef123456').files.filter(f => f.path.startsWith('过程记录/')).length, 2);
  // a folder that went missing is written again, and demo orders are not exported
  fs.rmSync(out, { recursive: true, force: true });
  co.addOrder({ id: 'demo', title: '演示', source: 'preset' });
  assert.equal(outputs.syncAll(), 1);
  assert.ok(fs.existsSync(path.join(dir, '读书会 招募文案.md')));
});

test('a delivered page is served from the exported folder on its own address, and nothing else is', async t => {
  const { co, ex, outputs } = fixture(t, args => args.kind === 'test'
    ? output({ 'tests/a.test.js': "const test=require('node:test');test('ok',()=>{});" }) : output({ 'web/index.html': '<h1>页面</h1>', 'web/logo.png': 'not really a png' }));
  const p = co.launchProject({ name: '页面', goal: '做页面', roles: [{ name: '代码开发', who: 'dev', deps: [], gate: false, out: '代码' }] });
  ex.createJobs(p.id);
  await waitFor(() => ex.snapshot().projects[0].status === 'review');
  outputs.sync(`p:${p.id}`);
  const preview = createPreview(co, outputs);
  t.after(() => preview.server.close());
  await new Promise(r => preview.server.listening ? r() : preview.server.once('listening', r));
  const get = url => new Promise((resolve, reject) => http.get(`${preview.url()}${url}`, res => { let s = ''; res.on('data', c => { s += c; }); res.on('end', () => resolve([res.statusCode, res.headers['content-type'], s])); }).on('error', reject));
  const base = `/out/${encodeURIComponent(`p:${p.id}`)}/${encodeURIComponent('程序')}`;
  assert.deepEqual(await get(`${base}/web/index.html`), [200, 'text/html; charset=utf-8', '<h1>页面</h1>']);
  assert.equal((await get(`${base}/web/logo.png`))[1], 'image/png');
  assert.equal((await get(`${base}/.gitignore`))[0], 404);
  assert.equal((await get(`/out/${encodeURIComponent(`p:${p.id}`)}/${encodeURIComponent('过程记录.md')}`))[0], 404); // only pages and what they load
  assert.equal((await get('/out/p%3A999/x/index.html'))[0], 404);
});
