'use strict';
// The page itself: the record and the files as data, then the HTML each part of the page is made of.
const test = require('node:test');
const assert = require('node:assert/strict');
const modelModule = import('../public/ui/model.js');
const viewsModule = import('../public/ui/views.js');

const roles = (...deps) => deps.map((d, idx) => ({ idx, name: `分工${idx}`, deps: d, who: `e${idx}`, status: 'wait', artifacts: [] }));
const project = (over = {}) => ({ id: 1, name: '番茄钟', goal: '做一个番茄钟', slug: 'tomato', status: 'running', roles: roles([], [0], [0], [0, 1, 2]), discussion: [], ...over });
const job = (idx, status, over = {}) => ({ id: `p:1:${idx}`, project_id: 1, role_idx: idx, employee: `e${idx}`, status, attempt: 1, result: null, ...over });
const snapshot = (p, jobs = [], orders = []) => ({ projects: p ? [p] : [], jobs, orders, employees: [0, 1, 2, 3].map(i => ({ id: `e${i}`, name: `员工${i}` })) });

test('the record can be narrowed to talk, deliveries, the boss own decisions, or one share', async () => {
  const { filterTrail, isLong } = await modelModule;
  const entries = [{ kind: 'ask', from: 'boss' }, { kind: 'discussion', from: 'e0', role: 0 }, { kind: 'delivery', from: 'e0', role: 0 }, { kind: 'revision', from: 'boss', role: 1 },
    { kind: 'delivery', from: 'e1', role: 1 }, { kind: 'failure', from: 'system', role: 1 }, { kind: 'release', from: 'boss' }];
  assert.equal(filterTrail(entries).length, 7);
  assert.deepEqual(filterTrail(entries, 'talk').map(e => e.kind), ['ask', 'discussion']);
  assert.deepEqual(filterTrail(entries, 'deliver').map(e => e.kind), ['delivery', 'delivery', 'failure', 'release']);
  assert.deepEqual(filterTrail(entries, 'mine').map(e => e.kind), ['ask', 'revision', 'release']);
  assert.deepEqual(filterTrail(entries, 'all', 1).map(e => e.kind), ['revision', 'delivery', 'failure']);
  assert.equal(isLong('短'), false); assert.equal(isLong('x'.repeat(500)), true); assert.equal(isLong('a\n'.repeat(9)), true);
});

test('files are grouped with the result first and the record last, and the most useful one opens first', async () => {
  const { fileGroups, firstFile, fileFor, sizeText, fileKind } = await modelModule;
  const f = path => ({ path, size: 10 });
  const work = { page: '程序/web/index.html', files: ['过程记录.md', '过程记录/调用-001.md', '文档/01-需求.md', '程序/README.md', '程序/web/index.html', '程序/web/js/app.js'].map(f) };
  const groups = fileGroups(work.files);
  assert.deepEqual(groups.map(g => g.name), ['程序', '文档', '过程记录']);
  assert.deepEqual(groups[0].files.map(x => x.label), ['README.md', 'web/index.html', 'web/js/app.js']);
  assert.deepEqual(groups[2].files.map(x => x.path), ['过程记录.md', '过程记录/调用-001.md']);
  assert.equal(firstFile(work), '程序/web/index.html');
  assert.equal(firstFile({ page: null, files: work.files.filter(x => !x.path.endsWith('.html')) }), '程序/README.md');
  const order = { page: null, files: ['周报.md', '过程记录.md'].map(f) };
  assert.equal(fileGroups(order.files)[0].name, ''); assert.equal(firstFile(order), '周报.md');
  assert.equal(firstFile({ files: [] }), null); assert.equal(firstFile(null), null);
  // what an employee handed in leads to the exported file
  assert.equal(fileFor(work, { type: 'doc', path: '项目/1-x/01-需求.md' }), '文档/01-需求.md');
  assert.equal(fileFor(order, { type: 'doc', path: '交付/周报-abc.md' }), '周报.md');
  assert.equal(fileFor(work, { type: 'commit', branch: 'feat/role-1' }), '程序/web/index.html');
  assert.equal(fileFor(work, { type: 'test' }), null);
  assert.deepEqual([sizeText(12), sizeText(2048), sizeText(3 * 1048576)], ['12 B', '2.0 KB', '3.0 MB']);
  assert.deepEqual(['a.md', 'web/index.html', 'x.js'].map(fileKind), ['doc', 'page', 'text']);
});

test('a single delivery is drawn with the same flow as a project, and the plan is said in one sentence', async () => {
  const { flowOf, planLine } = await modelModule;
  const entry = { id: 'o:x', status: 'review', o: { id: 'x', spec: { deliverable: { kind: 'doc' } } } };
  const flow = flowOf(entry, [{ id: 'o:x', order_id: 'x', employee: 'e0', status: 'review' }]);
  assert.deepEqual([flow.p.single, flow.p.status, flow.p.roles[0].name, flow.p.roles[0].who, flow.jobs[0].role_idx], [true, 'review', '撰写文档', 'e0', 0]);
  assert.equal(flowOf({ ...entry, status: 'open' }, []).p.roles[0].who, undefined);
  const p = project(); assert.equal(flowOf({ p }, []).p, p);
  const picks = { writer: 'w', developer: 'd', tester: 't', planner: 'p', backend: 'd', frontend: 'f', integrator: 't' }, person = id => id.toUpperCase();
  assert.equal(planLine('doc', picks, person), 'W 撰写，写好后你来验收。');
  assert.equal(planLine('code', picks, person), 'D 开发，T 测试，做完你来验收。');
  assert.match(planLine('team', picks, person, true), /^P、D、F、T 先讨论再分工/);
  assert.match(planLine('team', picks, person, false), /需求规划做完先给你确认/);
});

test('a project that is stuck says which share broke, so the page can open it', async () => {
  const { needsYou } = await modelModule;
  const stuck = needsYou(snapshot(project({ status: 'blocked' }), [job(0, 'done'), job(1, 'failed', { error: '测试未通过' })])).get('p:1');
  assert.deepEqual([stuck.kind, stuck.step], ['fix', 1]);
  const asked = needsYou(snapshot(project({ status: 'blocked', collaboration: { enabled: true, reason: '已自动返工 2 轮' } }), [job(2, 'failed')])).get('p:1');
  assert.deepEqual([asked.kind, asked.step, asked.why], ['answer', 2, '已自动返工 2 轮']);
});

test('the page shows the request, the flow, the record and the files, and never trusts text as HTML', async () => {
  const V = await viewsModule, { markdown } = await import('../public/ui/markdown.js');
  const evil = '<img src=x onerror=alert(1)>', safe = html => assert.ok(!html.includes('<img src=x') && !html.includes('<script>'), html.slice(0, 200));
  const view = { data: null, selected: 'p:1', person: id => `员工${String(id).slice(1)}`, colourOf: () => '#f2b544', colour: () => '#6ea8ff', step: null, filter: 'all', expanded: new Set(), outputs: null };
  const running = project({ name: evil, goal: '<script>alert(1)</script>' }), jobs = [job(0, 'review'), job(1, 'running', { started_at: '2026-11-13 10:00:00' })];
  view.data = snapshot(running, jobs);
  const entry = { id: 'p:1', title: running.name, status: 'running', p: running };

  // 1 · the request, with the decision that is waiting
  const head = V.head(view, entry, { kind: 'confirm', why: '分工0做完了，等你确认', step: 0 }, jobs[0]);
  safe(head); assert.match(head, /你的要求/); assert.match(head, /data-approve="p:1:0"/); assert.match(head, /等你确认/);
  assert.ok(!V.head(view, entry, undefined, null).includes('ws-callout'));
  // work that was never started offers a person to give it to
  const idle = { id: 'o:x', title: '周报', status: 'open', o: { id: 'x', title: '周报', brief: '写周报', spec: {} } };
  assert.match(V.head({ ...view, data: snapshot(null, [], [idle.o]) }, idle, undefined, null), /data-start-order="x"/);

  // 2 · the flow: three columns of shares and the boss's own step; a share waiting inside a project reads "待确认"
  const flow = V.flow(view, running, jobs);
  assert.equal((flow.match(/class="ws-stage"/g) || []).length, 4); assert.equal((flow.match(/data-step="/g) || []).length, 4);
  assert.match(flow, /待确认/); assert.ok(!flow.includes('待验收'));
  assert.match(V.flow(view, { single: true, status: 'review', roles: [{ idx: 0, name: '撰写文档', who: 'e0', deps: [] }] }, [{ role_idx: 0, employee: 'e0', status: 'review' }]), /待验收/);

  // 2 · the record
  const t = { running: [{ id: 9, employee: 'e1', title: '后端开发', attempt: 2, started: new Date(Date.now() - 5000).toISOString(), prompt_chars: 1234 }], entries: [
    { key: 'ask', at: '2026-11-13T02:00:00.000Z', from: 'boss', to: 'team', kind: 'ask', body: evil },
    { key: 'm2', at: '2026-11-13T02:05:00.000Z', from: 'e0', to: 'team', kind: 'delivery', body: 'x'.repeat(600), role: 0, call: { id: 7, model: 'm', ms: 12000, cost: 0.02 }, artifacts: [{ type: 'doc', path: '项目/1/01-需求.md' }, { type: 'test', pass: 3, fail: 1 }] },
    { key: 'm3', at: '2026-11-14T02:05:00.000Z', from: 'system', to: 'team', kind: 'failure', body: '没有完成', role: 1, artifacts: [] }] };
  view.outputs = { dir: 'D:\\成品\\1-x', root: 'D:\\成品', final: false, page: null, files: [{ path: '文档/01-需求.md', size: 100 }, { path: '过程记录.md', size: 50 }] };
  const log = V.trail(view, t);
  safe(log);
  assert.equal((log.match(/class="ws-entry /g) || []).length, 3); assert.equal((log.match(/class="ws-day"/g) || []).length, 2);
  assert.match(log, /data-call="7"/); assert.match(log, /m · 12 秒 · ¥0\.02/);
  assert.match(log, /data-file="文档\/01-需求\.md"/); assert.match(log, /class="ws-chip bad">测试：通过 3 · 失败 1/);
  assert.match(log, /class="ws-entry-text clamp"/); assert.match(log, /data-expand="m2">展开全文/);
  assert.match(V.trail({ ...view, expanded: new Set(['m2']) }, t), /data-expand="m2">收起/);
  assert.equal((V.trail({ ...view, step: 1 }, t).match(/class="ws-entry /g) || []).length, 1);
  assert.match(V.trail({ ...view, filter: 'talk', step: 1 }, t), /这个筛选下没有记录/);
  assert.match(V.filters({ ...view, step: 0 }, t, '需求规划'), /只看「需求规划」/);
  const live = V.running(view, t);
  assert.match(live, /员工1<\/b> 正在做「后端开发」（第 2 次）/); assert.match(live, /已 5 秒 · 任务书 1,234 字/); assert.match(live, /data-call="9"/);

  // 3 · the files, and the decision only when it is time
  const files = V.files({ ...view, file: '文档/01-需求.md' }, entry);
  assert.match(files, /进行中的当前版本/); assert.match(files, /data-open-folder/); assert.ok(files.includes('D:\\成品\\1-x'));
  assert.match(files, /data-file="文档\/01-需求\.md" aria-current="true"/); assert.match(files, /<details class="ws-filegroup"[^>]*data-record/);
  assert.match(V.files({ ...view, outputs: { root: 'D:\\成品', dir: null, files: [] } }, entry), /还没有成品/);
  const finished = project({ status: 'review', roles: roles([], [0]).map(r => ({ ...r, status: 'done' })) });
  const accept = V.acceptProject(view, finished, [job(0, 'done'), job(1, 'done', { result: { artifacts: [{ type: 'test', pass: 5, fail: 0 }] } })]);
  assert.match(accept, /data-accept="1"/); assert.match(accept, /data-reject="p:1"/); assert.match(accept, /通过 5 · 失败 0/);
  assert.equal((accept.match(/name="stars-1"/g) || []).length, 3);
  // a single delivery is accepted or sent back as a whole
  const single = V.acceptOrder(view, { id: 'o:x', employee: 'e0', status: 'review' });
  assert.match(single, /data-approve="o:x"/); assert.match(single, /data-reject="o:x"/);

  // one share opened: failed work can be retried, finished projects cannot be changed
  const share = V.share(view, running.roles[1], job(1, 'failed', { error: evil }), running, false);
  safe(share); assert.match(share, /data-revise="p:1:1"/); assert.match(share, /修改 \/ 重试/);
  assert.ok(!V.share(view, running.roles[0], job(0, 'done'), { ...running, status: 'done' }, false).includes('data-revise='));

  // the list on the left opens the finished group when the chosen work is in it
  const done = project({ id: 2, name: '旧项目', status: 'done' });
  const all = [entry, { id: 'p:2', title: done.name, status: 'done', p: done }];
  assert.match(V.rail({ ...view, selected: 'p:2' }, all, new Map([['p:1', { kind: 'confirm', why: '等你确认' }]]), false), /<details id="ws-done" class="ws-group" open>/);
  assert.match(V.rail(view, all, new Map(), false), /<details id="ws-done" class="ws-group">/);
  assert.match(V.rail(view, [], new Map(), false), /还没有工作/);

  // delivered documents are shown as pages, but only as text and a few safe tags
  const md = markdown(['# 标题', '', `${evil} **粗** [坏](javascript:alert(1)) [好](https://example.com)`, '', '- 一', '- 二', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '```', '<script>x</script>', '```'].join('\n'));
  safe(md); assert.ok(!md.includes('href="javascript:'));
  assert.match(md, /<h2>标题<\/h2>/); assert.match(md, /<strong>粗<\/strong>/); assert.match(md, /href="https:\/\/example\.com"/); assert.match(md, /<li>一<\/li>/); assert.match(md, /<td>2<\/td>/);
  assert.equal(markdown('#### 小\n> 引\n1. 甲\n---\n'.repeat(50)).includes('<h5>小</h5>'), true);
});
