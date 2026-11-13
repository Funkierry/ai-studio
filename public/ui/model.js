// What the workspace shows, worked out from the server's snapshot. No page, no network: plain data in, plain data out.
import { postKey } from '../office/roster.js';
export const LABELS = { queued: '排队中', running: '执行中', done: '已完成', review: '待验收', gate: '待确认', failed: '失败', blocked: '需要处理', interrupted: '调用中断', paused: '已暂停', wait: '待开始', open: '未启动', assigned: '旧版任务 · 待接管' };

// every piece of work the boss can look at: projects, and orders that are not part of a project
export function entries(data) {
  return [
    ...data.projects.map(p => ({ id: `p:${p.id}`, title: p.name, status: p.status === 'done' || data.jobs.some(j => j.project_id === p.id) ? p.status : 'wait', p })),
    ...data.orders.filter(o => !data.projects.some(p => p.order_id === o.id)).map(o => ({ id: `o:${o.id}`, title: o.title, status: data.jobs.find(j => j.order_id === o.id)?.status || o.status, o })),
  ];
}

// Everything that cannot move on without the boss, one line per piece of work.
// kind says what is being asked: accept (final check), confirm (one share), answer (a question), fix (something broke).
export function needsYou(data) {
  const items = new Map();
  const add = (id, kind, why, extra = {}) => { if (!items.has(id)) items.set(id, { kind, why, view: 'tasks', ...extra }); };
  for (const p of data.projects) {
    if (['done', 'paused'].includes(p.status)) continue;
    const id = `p:${p.id}`, jobs = data.jobs.filter(j => j.project_id === p.id);
    if (p.status === 'blocked') {
      const talk = !!p.collaboration?.enabled;
      add(id, talk ? 'answer' : 'fix', p.collaboration?.reason || jobs.find(j => j.error)?.error || '项目停住了，需要你看一下', talk ? { view: 'discussion' } : {});
    }
    if (p.status === 'review') add(id, 'accept', '全部分工做完了，等你验收');
    for (const j of jobs) {
      const role = p.roles.find(r => r.idx === j.role_idx)?.name || '分工';
      if (j.status === 'review') add(id, 'confirm', `${role}做完了，等你确认`, { step: j.role_idx });
      if (['failed', 'interrupted'].includes(j.status)) add(id, 'fix', `${role}没有完成：${j.error || LABELS[j.status]}`, { step: j.role_idx });
    }
  }
  for (const j of data.jobs) {
    if (!j.order_id || data.projects.some(p => p.order_id === j.order_id)) continue;
    if (j.status === 'review') add(`o:${j.order_id}`, 'accept', '写好了，等你验收');
    if (['failed', 'interrupted'].includes(j.status)) add(`o:${j.order_id}`, 'fix', `没有完成：${j.error || LABELS[j.status]}`);
  }
  return items;
}
export const NEED_LABELS = { accept: '验收', confirm: '确认', answer: '回答', fix: '处理' };

// the state of each share of a project, in order: what the little progress strip is made of
export const cellsOf = (p, jobs) => p.roles.map(r => jobs.find(j => j.project_id === p.id && j.role_idx === r.idx)?.status || r.status);

// one line under a piece of work in the list
export function progress(entry, data, person) {
  if (entry.o) { const j = data.jobs.find(j => j.order_id === entry.o.id); return j ? person(j.employee) : '还没有负责人'; }
  const p = entry.p, done = p.roles.filter(r => r.status === 'done').length, talk = p.discussion?.find(t => t.status === 'running');
  const now = data.jobs.find(j => j.project_id === p.id && j.status === 'running'), role = now && p.roles.find(r => r.idx === now.role_idx);
  return `${done}/${p.roles.length} 份分工${talk ? ` · ${person(talk.employee)}讨论中` : role ? ` · ${person(now.employee)}：${role.name}` : ''}`;
}

// Shares laid out left to right by what they wait for: a share sits one column after the last thing it depends on,
// so shares in the same column run side by side.
export function stagesOf(roles) {
  const depth = new Map();
  const of = r => {
    if (depth.has(r.idx)) return depth.get(r.idx);
    depth.set(r.idx, 0); // a share that depends on itself by mistake must not loop forever
    const d = (r.deps || []).map(i => roles.find(x => x.idx === i)).filter(Boolean).reduce((max, dep) => Math.max(max, of(dep) + 1), 0);
    depth.set(r.idx, d); return d;
  };
  const columns = [];
  for (const r of roles) (columns[of(r)] ||= []).push(r);
  return columns.filter(Boolean);
}

// which share to show first when a project is opened: the one that needs the boss, else the one running, else the next one, else the last
export function defaultStep(p, jobs) {
  const state = r => jobs.find(j => j.role_idx === r.idx)?.status || r.status;
  return (p.roles.find(r => ['review', 'failed', 'interrupted'].includes(state(r)))
    || p.roles.find(r => state(r) === 'running')
    || p.roles.find(r => state(r) !== 'done')
    || p.roles.at(-1))?.idx ?? null;
}

// What the boss should look at before accepting a project: is every share done, did the tests pass, what was delivered.
export function acceptanceOf(p, jobs) {
  const done = p.roles.filter(r => r.status === 'done').length, all = p.roles.length;
  const artifacts = p.roles.flatMap(r => {
    const j = jobs.find(j => j.role_idx === r.idx);
    return (j?.result?.artifacts || r.artifacts || []).map(a => ({ ...a, role: r.name, who: r.who }));
  });
  const tests = artifacts.filter(a => a.type === 'test');
  const pass = tests.reduce((n, t) => n + (t.pass || 0), 0), fail = tests.reduce((n, t) => n + (t.fail || 0), 0), skipped = tests.reduce((n, t) => n + (t.skipped || 0), 0);
  const broken = artifacts.filter(a => ['fallback', 'db_error', 'conflict'].includes(a.type));
  const checks = [{ ok: done === all, label: `${done}/${all} 份分工完成` }];
  if (tests.length) checks.push({ ok: !fail && pass > 0, label: `自动化测试：通过 ${pass} · 失败 ${fail}${skipped ? ` · 跳过 ${skipped}` : ''}`, by: tests.at(-1).role });
  else if (artifacts.some(a => a.type === 'commit')) checks.push({ ok: null, label: '没有测试结果，验收时会运行集成检查' });
  if (broken.length) checks.push({ ok: false, label: `${[...new Set(broken.map(a => a.role))].join('、')}的交付生成失败或有冲突` });
  const reworks = p.reworks || 0;
  if (reworks) checks.push({ ok: null, label: `返工 ${reworks} 次` });
  return { checks, ready: checks.every(c => c.ok !== false), deliverables: artifacts.filter(a => a.type === 'doc' || a.type === 'commit') };
}

// Who does what when the boss has not chosen: by post first, then anyone not already on the job.
export function defaultTeam(employees) {
  // people hired in the first versions carry older names for their posts; postKey reads both
  const post = e => postKey(e.profile?.post), dev = ['frontend', 'backend'];
  const free = (...taken) => e => !taken.includes(e.id);
  const first = employees[0];
  const developer = employees.find(e => dev.includes(post(e))) || first;
  const tester = employees.find(e => post(e) === 'test') || employees.find(e => e.id !== developer.id) || developer;
  const planner = employees.find(e => post(e) === 'pm') || first;
  const backend = employees.find(e => post(e) === 'backend' && e.id !== planner.id) || developer;
  const frontend = employees.find(e => post(e) === 'frontend' && free(planner.id, backend.id)(e))
    || employees.find(e => dev.includes(post(e)) && free(planner.id, backend.id)(e)) || employees.find(free(planner.id, backend.id)) || developer;
  const integrator = employees.find(e => post(e) === 'test' && free(planner.id, backend.id, frontend.id)(e))
    || employees.find(e => dev.includes(post(e)) && free(planner.id, backend.id, frontend.id)(e)) || employees.find(free(planner.id, backend.id, frontend.id)) || tester;
  // a document goes to whoever holds the writing post; only without one does it fall to research or the planner
  const writer = ['writing', 'research', 'pm'].map(k => employees.find(e => post(e) === k)).find(Boolean) || planner;
  return { planner: planner.id, backend: backend.id, frontend: frontend.id, integrator: integrator.id, developer: developer.id, tester: tester.id, writer: writer.id };
}
// the steps a kind of work goes through, as shown in the new-work window: columns of [field, label]
export const PLANS = {
  team: [[['planner', '需求规划']], [['backend', '后端开发'], ['frontend', '前端开发']], [['integrator', '集成测试']]],
  code: [[['developer', '代码开发']], [['tester', '测试验收']]],
  doc: [[['writer', '撰写文档']]],
};
