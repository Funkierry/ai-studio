'use strict';
// The browser observes jobs. Only this process owns and schedules model calls.
const { randomUUID } = require('node:crypto');
const { createCollaboration } = require('./collaboration');
const J = (s, fallback = {}) => { try { return JSON.parse(s); } catch { return fallback; } };
const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
const brokenArtifact = artifacts => artifacts.find(a => ['fallback', 'conflict', 'db_error'].includes(a.type) || (a.type === 'test' && (a.fail || !a.pass || (a.code != null && a.code !== 0))));

function createExecution(co, { concurrency = 3 } = {}) {
  const db = co.executionStore, active = new Map();
  let scheduled = false, closed = false;
  const team = createCollaboration(co, { revise, kick });
  // An interrupted provider request cannot safely be billed twice automatically.
  db.exec("UPDATE jobs SET status='interrupted', error='服务重启时调用尚未完成，请检查结果后手动重试' WHERE status='running'");
  db.exec("UPDATE roles SET status='interrupted' WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.project_id=roles.project_id AND j.role_idx=roles.idx AND j.status='interrupted')");
  db.exec("UPDATE orders SET status='interrupted' WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.order_id=orders.id AND j.status='interrupted')");
  db.exec("UPDATE projects SET status='blocked' WHERE status NOT IN ('done','paused') AND EXISTS (SELECT 1 FROM jobs j WHERE j.project_id=projects.id AND j.status='interrupted')");
  db.exec("UPDATE discussion_turns SET status='interrupted',error='服务重启时讨论尚未完成，请检查后手动重试' WHERE status='running'");
  for (const t of db.prepare("SELECT * FROM discussion_turns WHERE status='interrupted'").all()) team.waitForUser(t.project_id, t.error);
  // Keep already-generated legacy deliveries reviewable without another model call.
  const legacy = db.prepare("SELECT * FROM orders o WHERE source NOT IN ('incoming','preset') AND status IN ('assigned','review') AND doc_path IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.order_id=o.id)").all();
  for (const o of legacy) {
    let generated=false;
    try { generated=/^> 由 .+ 撰写：/m.test(co.docs.file(o.doc_path).content); } catch { /* Keep the path and require a retry if the old file is missing. */ }
    const result={doc:o.doc_path,summary:'旧版已生成的交付，升级时保留，未重新调用模型。',artifacts:[{type:'doc',path:o.doc_path}]};
    db.prepare('INSERT INTO jobs(id,order_id,employee,status,result,error) VALUES(?,?,?,?,?,?)')
      .run(`o:${o.id}`,o.id,o.assignee,generated?'review':'failed',JSON.stringify(result),generated?'':'旧版交付未确认生成成功，请查看文档后修改 / 重试');
  }
  const role = j => db.prepare('SELECT * FROM roles WHERE project_id=? AND idx=?').get(j.project_id, j.role_idx);
  const job = id => { const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(id); if (!j) fail('任务不存在'); return j; };
  const input = j => ({ ...J(j.input), attempt: j.attempt + 1, rework: j.attempt > 0, lead: j.employee, members: [j.employee], mode: 'solo' });
  const employeeExists = id => !!db.prepare('SELECT id FROM employees WHERE id=?').get(id);
  const key = (pid, idx) => `p:${pid}:${idx}`;

  function createJobs(pid) {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(pid);
    if (!p || p.status === 'done') fail('项目不存在或已经完成');
    const roles = db.prepare('SELECT * FROM roles WHERE project_id=? ORDER BY idx').all(pid);
    if (roles.some(r => !employeeExists(r.who))) fail('请先为每份分工指定现有员工');
    for (const r of roles) {
      const artifacts=J(r.artifacts, []);
      const status=['done','gate'].includes(r.status) ? brokenArtifact(artifacts) ? 'failed' : r.status==='gate' ? 'review' : 'done' : 'queued';
      db.prepare('INSERT OR IGNORE INTO jobs(id,project_id,role_idx,employee,status,result,error) VALUES(?,?,?,?,?,?,?)')
        .run(key(pid, r.idx), pid, r.idx, r.who, status, JSON.stringify({ artifacts }),status==='failed'?'旧版交付未通过检查，请修改 / 重试':'');
    }
    db.prepare("UPDATE projects SET status='running' WHERE id=?").run(pid);
    team.initialize(pid);
    refreshProject(pid); kick();
    return { ok: true, id: pid };
  }
  function startOrder(id, employee) {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if (!o || o.status === 'done') fail('订单不存在或已经完成');
    if (['incoming', 'preset'].includes(o.source)) fail('演示订单不会调用真实模型，请新建真实任务');
    if (!employeeExists(employee)) fail('请选择负责员工');
    db.prepare('INSERT OR IGNORE INTO jobs(id,order_id,employee) VALUES(?,?,?)').run(`o:${id}`, id, employee);
    kick(); return { ok: true };
  }
  function refreshProject(pid) {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(pid);
    if (!p || ['paused', 'done'].includes(p.status)) return;
    const jobs = db.prepare('SELECT status FROM jobs WHERE project_id=?').all(pid);
    if (!jobs.length) return;
    const talking = team.turns(pid).some(t => ['queued','running'].includes(t.status));
    const status = team.state(pid)?.stage === 'needs_input' ? 'blocked' : talking ? 'running' : jobs.every(j => j.status === 'done') ? 'review' : jobs.some(j => ['failed', 'interrupted'].includes(j.status)) ? 'blocked' : 'running';
    db.prepare('UPDATE projects SET status=? WHERE id=?').run(status, pid);
  }
  function blockedReason(j, rows) {
    if (j.status !== 'queued') return j.error || '';
    if (j.project_id) {
      const p = db.prepare('SELECT status FROM projects WHERE id=?').get(j.project_id);
      if (p.status === 'paused') return '项目已暂停';
      const discussion = team.blockedReason(j.project_id);
      if (discussion) return discussion;
      const r = role(j);
      for (const dep of J(r.deps, [])) {
        const d = rows.find(x => x.id === key(j.project_id, dep));
        if (!d || d.status !== 'done') {
          const upstream = db.prepare('SELECT name FROM roles WHERE project_id=? AND idx=?').get(j.project_id, dep);
          return `等待「${upstream?.name || dep}」${d?.status === 'review' ? '确认' : d?.status === 'failed' ? '修复' : '完成'}`;
        }
      }
    }
    const running = rows.find(x => x.status === 'running' && x.employee === j.employee);
    if (running || db.prepare("SELECT 1 FROM discussion_turns WHERE employee=? AND status='running'").get(j.employee)) return '负责人正在执行另一项任务或参与讨论，完成后自动开始';
    if (active.size >= concurrency) return '等待执行名额';
    return '';
  }
  function kick() {
    if (scheduled || closed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (closed) return;
      team.advance();
      for (const turn of team.eligible()) {
        if (active.size >= concurrency) break;
        if (db.prepare("SELECT 1 FROM discussion_turns WHERE status='running' AND (employee=? OR project_id=?)").get(turn.employee,turn.project_id) || db.prepare("SELECT 1 FROM jobs WHERE status='running' AND employee=?").get(turn.employee)) continue;
        executeDiscussion(turn);
      }
      for (const j of db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at,id").all()) {
        const rows = db.prepare('SELECT * FROM jobs').all();
        if (!blockedReason(j, rows)) execute(j);
      }
    });
  }
  function executeDiscussion(t) {
    const id = `discussion:${t.id}`;
    db.prepare("UPDATE discussion_turns SET status='running',attempt=attempt+1,error='',started_at=datetime('now'),finished_at=NULL WHERE id=?").run(t.id);
    active.set(id, true);
    refreshProject(t.project_id);
    const turn = { ...t, attempt: t.attempt + 1 };
    Promise.resolve().then(() => co.discuss(turn)).then(result => team.complete(turn, result)).catch(error => team.failed(turn, error)).finally(() => {
      active.delete(id); refreshProject(t.project_id); kick();
    });
  }
  function execute(j) {
    const body = input(j);
    db.prepare("UPDATE jobs SET status='running',attempt=attempt+1,error='',started_at=datetime('now'),finished_at=NULL WHERE id=?").run(j.id);
    active.set(j.id, true);
    if (j.project_id) co.roleStarted(j.project_id, j.role_idx);
    else co.setOrder(j.order_id, { status: 'assigned', assignee: j.employee, mode: 'solo' });
    Promise.resolve().then(() => j.project_id ? co.roleDone(j.project_id, j.role_idx, body) : co.orderDeliver(j.order_id, body)).then(result => {
      const artifacts = result.artifacts || [];
      const broken = brokenArtifact(artifacts);
      const r = j.project_id ? role(j) : null;
      const questions = r && team.state(j.project_id)?.enabled && result.open_questions?.length;
      const status = broken ? 'failed' : !r || r.gate || questions ? 'review' : 'done';
      const error = broken ? broken.reason || (broken.type === 'test' ? `测试未通过：通过 ${broken.pass}，失败 ${broken.fail}，跳过 ${broken.skipped || 0}` : '交付存在合并冲突') : '';
      db.prepare("UPDATE jobs SET status=?,result=?,error=?,finished_at=datetime('now') WHERE id=?").run(status, JSON.stringify(result), error, j.id);
      if (r) db.prepare('UPDATE roles SET status=? WHERE id=?').run(status === 'review' ? 'gate' : status, r.id);
      else co.setOrder(j.order_id, { status });
      if (r) team.delivery(j, result, error);
    }).catch(error => {
      db.prepare("UPDATE jobs SET status='failed',error=?,finished_at=datetime('now') WHERE id=?").run(error.message, j.id);
      if (j.project_id) db.prepare("UPDATE roles SET status='failed' WHERE project_id=? AND idx=?").run(j.project_id, j.role_idx);
      else co.setOrder(j.order_id, { status: 'failed' });
      if (j.project_id) team.delivery(j, {}, error.message);
    }).finally(() => {
      active.delete(j.id);
      if (j.project_id) refreshProject(j.project_id);
      kick();
    });
  }
  function revise(id, feedback, options = {}) {
    const j = job(id);
    if (typeof feedback !== 'string' || !feedback.trim()) fail('请写清具体要修改什么');
    if (j.project_id && db.prepare("SELECT 1 FROM jobs WHERE project_id=? AND status='running'").get(j.project_id)) fail('项目仍有调用执行中，请等当前调用结束后修改');
    if (j.status === 'running') fail('当前调用仍在执行，请完成后再修改');
    if (j.project_id && db.prepare("SELECT 1 FROM projects WHERE id=? AND status='done'").get(j.project_id)) fail('项目已经发布，请新建后续工作');
    if (!options.actor && j.project_id && db.prepare("SELECT 1 FROM discussion_turns WHERE project_id=? AND status='running'").get(j.project_id)) fail('员工正在讨论，请在项目讨论中补充要求，或等讨论结束后修改');
    const affected = new Set(options.targets || [j.role_idx]);
    if (j.project_id) {
      const roles = db.prepare('SELECT * FROM roles WHERE project_id=?').all(j.project_id);
      if ([...affected].some(idx=>!roles.some(r=>r.idx===idx))) fail('返工分工不存在');
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of roles) if (!affected.has(r.idx) && J(r.deps, []).some(d => affected.has(d))) { affected.add(r.idx); changed = true; }
      }
      for (const idx of affected) {
        const r = roles.find(x => x.idx === idx);
        const direct = (options.targets || [j.role_idx]).includes(idx);
        const source = options.actor ? `同事在项目讨论消息 #${options.messageId} 提出的修复要求` : '老板的修改要求';
        const message = direct ? `${source}：${feedback.trim()}` : `上游正在按以下意见修改。请读取上游的新交付，按你自己的职责重新验证和更新；不要把其他岗位的文件修改要求当成你的分工。\n${source}：${feedback.trim()}`;
        db.prepare("UPDATE jobs SET status='queued',input=?,error='',finished_at=NULL WHERE id=?")
          .run(JSON.stringify({ feedback: message }), key(j.project_id, idx));
        db.prepare("UPDATE roles SET status='wait' WHERE id=?").run(r.id);
        db.prepare("UPDATE pull_requests SET status='closed',note='已由修改版本替代' WHERE role_id=? AND status<>'merged'").run(r.id);
      }
      db.prepare("UPDATE projects SET status=CASE WHEN status='paused' THEN 'paused' ELSE 'running' END,reworks=reworks+1 WHERE id=?").run(j.project_id);
      db.prepare("UPDATE project_team SET stage='working',reason='',waiting_role=NULL WHERE project_id=?").run(j.project_id);
      if (!options.actor && !options.messageId) team.append(j.project_id, {sender:'boss',kind:'revision',body:feedback.trim(),jobId:id});
    } else {
      db.prepare("UPDATE jobs SET status='queued',input=?,error='',finished_at=NULL WHERE id=?").run(JSON.stringify({ feedback: feedback.trim() }), id);
      co.setOrder(j.order_id, { status: 'open' });
    }
    if (!options.actor) co.review({ subject: j.project_id ? `项目 ${j.project_id} / 分工 ${j.role_idx + 1}` : j.order_id, reason: feedback.trim(), people: [j.employee] });
    kick(); return { ok: true, affected: affected.size };
  }
  function approve(id) {
    const j = job(id);
    if (j.status === 'done') return { ok: true };
    if (j.status !== 'review') fail('这份任务尚未达到验收条件');
    const result = J(j.result);
    if (j.project_id && team.state(j.project_id)?.stage === 'needs_input') fail('请先在项目讨论里回答员工的问题');
    if (j.project_id) db.prepare("UPDATE roles SET status='done' WHERE project_id=? AND idx=?").run(j.project_id, j.role_idx);
    else {
      const o = db.prepare('SELECT * FROM orders WHERE id=?').get(j.order_id);
      co.deliverable({ title: o.title, body: result.summary || '', doc: result.doc, people: [j.employee], mode: 'solo', stars: 3, order_id: o.id });
    }
    db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(id);
    if (j.project_id) refreshProject(j.project_id);
    kick(); return { ok: true };
  }
  function pause(pid, paused) {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(pid);
    if (!p || p.status === 'done') fail('项目不存在或已经完成');
    db.prepare('UPDATE projects SET status=? WHERE id=?').run(paused ? 'paused' : 'running', pid);
    if (!paused) { refreshProject(pid); kick(); }
    return { ok: true };
  }
  function snapshot() {
    const state = co.state(), rows = db.prepare('SELECT * FROM jobs ORDER BY created_at,id').all();
    const projects = db.prepare('SELECT * FROM projects ORDER BY id DESC').all().map(p => ({ ...p,
      collaboration: team.state(p.id), discussion: team.turns(p.id).map(t=>({id:t.id,employee:t.employee,role_idx:t.role_idx,purpose:t.purpose,status:t.status,error:t.error,attempt:t.attempt})),
      roles: db.prepare('SELECT * FROM roles WHERE project_id=? ORDER BY idx').all(p.id).map(r => ({ ...r, deps: J(r.deps, []), artifacts: J(r.artifacts, []) })) }));
    const orders = db.prepare("SELECT * FROM orders WHERE source NOT IN ('incoming','preset') ORDER BY created_at DESC").all().map(o => ({ ...o, spec: J(o.spec) }));
    return { employees: state.employees, projects, orders,
      jobs: rows.map(j => ({ ...j, result: J(j.result), input: J(j.input), waiting: blockedReason(j, rows) })),
      spent: db.prepare("SELECT COALESCE(SUM(cost),0) n FROM ledger WHERE source='api'").get().n,
      demoHidden: db.prepare("SELECT COUNT(*) n FROM orders WHERE source IN ('incoming','preset') AND status<>'done'").get().n };
  }
  function employeeConnection(type, connection) {
    const models = co.models();
    if (!Object.hasOwn(models.types || {}, type)) fail('未知模型类型');
    const mode = connection ?? models.providers[models.types[type]]?.connection;
    if (!['local','api'].includes(mode)) fail('请选择本机或 API 接入');
    const provider = models.connections?.[mode]?.[type];
    if (!provider) fail('这个模型不支持所选接入方式');
    if (!models.fake && !models.providers[provider]?.configured) fail(models.providers[provider]?.hint || '所选接入尚未配置');
    return mode;
  }
  function addEmployee({ name, type, connection, post = 'general', persona = '' }) {
    if (typeof name !== 'string' || !name.trim() || !type) fail('请填写姓名并选择模型');
    const mode = employeeConnection(type, connection);
    const id = `${type}-${randomUUID()}`;
    const postLabel={frontend:'前端开发',backend:'后端开发',test:'测试',writing:'文案写作',general:'通用'}[post]||post;
    co.syncEmployees([{ id, name: name.trim(), model: type, profile: { type, connection: mode, post, postLabel, persona }, level: 1, stamina: 100, memory: 5, speed: 5 }]);
    return { ok: true, id };
  }
  function updateEmployeeConnection(id, { type, connection }) {
    const e = db.prepare('SELECT * FROM employees WHERE id=?').get(id);
    if (!e) fail('员工不存在');
    if (db.prepare("SELECT 1 FROM jobs WHERE employee=? AND status='running'").get(id) || db.prepare("SELECT 1 FROM discussion_turns WHERE employee=? AND status='running'").get(id)) fail('这位员工仍在执行调用，请完成后再切换接入方式');
    const mode = employeeConnection(type, connection);
    const profile = { ...J(e.profile), type, connection: mode };
    db.prepare("UPDATE employees SET model=?,profile=?,updated_at=datetime('now','localtime') WHERE id=?").run(type, JSON.stringify(profile), id);
    return { ok: true, id };
  }
  return { createJobs, startOrder, revise, approve, pause, snapshot, addEmployee, updateEmployeeConnection, kick, active,
    messages:team.messages, postMessage:team.post, retryDiscussion:team.retry,
    close: () => { closed = true; } };
}
module.exports = { createExecution };
