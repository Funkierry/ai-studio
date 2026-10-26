'use strict';

const J = (s, fallback = {}) => { try { return JSON.parse(s); } catch { return fallback; } };
const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };

function createCollaboration(co, { revise, kick }) {
  const db = co.executionStore;
  const project = pid => { const p = db.prepare('SELECT * FROM projects WHERE id=?').get(pid); if (!p) fail('项目不存在'); return p; };
  const roles = pid => db.prepare('SELECT * FROM roles WHERE project_id=? ORDER BY idx').all(pid);
  const state = pid => db.prepare('SELECT * FROM project_team WHERE project_id=?').get(pid);
  const turns = pid => db.prepare('SELECT * FROM discussion_turns WHERE project_id=? ORDER BY id').all(pid);
  function append(pid, { sender = 'system', recipient = 'team', kind = 'notice', body, replyTo = null, jobId = null, attempt = null, meta = {}, key = null }) {
    const r = db.prepare('INSERT OR IGNORE INTO project_messages(project_id,sender,recipient,kind,body,reply_to,job_id,attempt,meta,dedupe_key) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(pid, sender, recipient, kind, body, replyTo, jobId, attempt, JSON.stringify(meta), key);
    return r.changes ? Number(r.lastInsertRowid) : db.prepare('SELECT id FROM project_messages WHERE dedupe_key=?').get(key)?.id;
  }
  function waitForUser(pid, reason, waitingRole = null) {
    db.prepare("UPDATE project_team SET stage='needs_input',reason=?,waiting_role=? WHERE project_id=?").run(reason, waitingRole, pid);
    db.prepare("UPDATE projects SET status='blocked' WHERE id=? AND status NOT IN ('done','paused')").run(pid);
  }
  function queue(pid, role, purpose, { replyTo = null, depth = 0, key } = {}) {
    if (db.prepare('SELECT 1 FROM discussion_turns WHERE dedupe_key=?').get(key)) return false;
    const config = state(pid);
    const used = db.prepare('SELECT COALESCE(SUM(MAX(attempt,1)),0) n FROM discussion_turns WHERE project_id=?').get(pid).n;
    if (used >= (config?.max_turns || 20)) { waitForUser(pid, `已达到本项目 ${config?.max_turns || 20} 次讨论调用上限，请查看记录后手动安排后续工作。`); return false; }
    db.prepare('INSERT INTO discussion_turns(project_id,role_idx,employee,purpose,reply_to,depth,dedupe_key) VALUES(?,?,?,?,?,?,?)')
      .run(pid, role.idx, role.who, purpose, replyTo, depth, key);
    return true;
  }
  function initialize(pid) {
    const p = project(pid), config = state(pid);
    append(pid, { sender: 'boss', kind: 'request', body: `${p.name}\n${p.goal}`, key: `project:${pid}:goal` });
    if (config?.enabled) {
      for (const r of roles(pid)) queue(pid, r, 'kickoff', { key: `kickoff:${pid}:${r.idx}` });
      append(pid, { body: '员工将先在这里讨论共同约定，再完成各自交付；测试失败会自动找责任员工返工，集成检查通过后发布本地成果。', key: `project:${pid}:autonomous` });
    }
  }
  function blockedReason(pid) {
    const config = state(pid);
    if (config?.stage === 'needs_input') return config.reason;
    if (db.prepare("SELECT 1 FROM discussion_turns WHERE project_id=? AND status IN ('queued','running')").get(pid)) return '等待项目讨论与同事回复';
    return '';
  }
  function delivery(j, result, error) {
    const r = roles(j.project_id).find(r => r.idx === j.role_idx);
    if (result.summary) append(j.project_id, { sender: j.employee, kind: 'delivery', body: result.summary,
      jobId: j.id, attempt: j.attempt + 1, meta: { artifacts: result.artifacts || [] }, key: `delivery:${j.id}:${j.attempt + 1}` });
    if (error) append(j.project_id, { body: `${r?.name || '分工'}：${error}`, kind: 'test_result', jobId: j.id, attempt: j.attempt + 1, key: `result:${j.id}:${j.attempt + 1}` });
    if (state(j.project_id)?.enabled && !error && result.open_questions?.length) {
      const body = result.open_questions.join('\n');
      append(j.project_id, { sender: j.employee, recipient: 'boss', kind: 'question', body, jobId: j.id, key: `questions:${j.id}:${j.attempt + 1}` });
      waitForUser(j.project_id, '员工需要你补充关键信息，请在项目讨论中回答。', j.role_idx);
    }
  }
  function eligible() {
    return db.prepare(`SELECT t.* FROM discussion_turns t JOIN projects p ON p.id=t.project_id
      LEFT JOIN project_team c ON c.project_id=p.id
      WHERE t.status='queued' AND p.status<>'paused' AND COALESCE(c.stage,'working')<>'needs_input'
      AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND j.status='running')
      AND NOT EXISTS(SELECT 1 FROM discussion_turns t2 WHERE t2.project_id=p.id AND t2.status='running')
      ORDER BY CASE WHEN t.purpose='kickoff' THEN 1 ELSE 0 END,t.id`).all();
  }
  function advance() {
    for (const config of db.prepare('SELECT * FROM project_team WHERE enabled=1').all()) {
      const pid = config.project_id, p = project(pid);
      if (['done','paused'].includes(p.status) || config.stage === 'needs_input') continue;
      const discussion = turns(pid);
      if (discussion.some(t => ['queued','running'].includes(t.status))) continue;
      if (discussion.some(t => ['failed','interrupted'].includes(t.status))) { waitForUser(pid, '还有失败或中断的讨论调用，请查看记录并明确重试后继续。'); continue; }
      const jobs = db.prepare('SELECT * FROM jobs WHERE project_id=?').all(pid);
      if (!jobs.length || jobs.some(j => j.status === 'running')) continue;
      const broken = jobs.find(j => ['failed','interrupted'].includes(j.status));
      if (broken) {
        const artifacts = J(broken.result).artifacts || [];
        if (broken.status === 'interrupted' || artifacts.some(a => a.type === 'fallback') || !artifacts.some(a => a.type === 'test')) {
          waitForUser(pid, broken.error || '调用中断或交付失败，请检查原因后手动重试。'); continue;
        }
        if (config.repairs >= config.max_repairs) {
          waitForUser(pid, `已自动返工 ${config.repairs} 轮，测试仍未通过。请查看失败证据后决定下一步。`);
          append(pid, { body: state(pid).reason, key: `repair-limit:${pid}:${config.repairs}` }); continue;
        }
        const key = `triage:${broken.id}:${broken.attempt}`;
        if (db.prepare('SELECT 1 FROM discussion_turns WHERE dedupe_key=?').get(key)) {
          waitForUser(pid, '员工讨论后尚未形成可执行的修复，请查看问题并补充要求。'); continue;
        }
        const r = roles(pid).find(r => r.idx === broken.role_idx);
        if (queue(pid, r, 'triage', { key })) {
          db.prepare("UPDATE project_team SET stage='repairing' WHERE project_id=?").run(pid);
          db.prepare("UPDATE projects SET status='running' WHERE id=?").run(pid);
        }
      } else if (jobs.every(j => j.status === 'done')) {
        try {
          const accepted = co.projectReview(pid, { stars: 3, automatic: true });
          const test = accepted.artifacts?.find(a => a.type === 'test');
          const tag = accepted.artifacts?.find(a => a.type === 'tag');
          append(pid, { kind: 'release', body: `集成检查完成${test ? `：通过 ${test.pass}，失败 ${test.fail}，跳过 ${test.skipped || 0}` : ''}。已发布本地成果 ${tag?.name || ''}。`, meta: { artifacts: accepted.artifacts }, key: `release:${pid}` });
          db.prepare("UPDATE project_team SET stage='done',reason='' WHERE project_id=?").run(pid);
        } catch (error) { waitForUser(pid, `最终集成检查未通过：${error.message}`); append(pid, { kind: 'test_result', body: state(pid).reason }); }
      } else {
        db.prepare("UPDATE project_team SET stage='working' WHERE project_id=?").run(pid);
      }
    }
  }
  function complete(turn, gen) {
    const pid = turn.project_id, allRoles = roles(pid), config = state(pid), p = project(pid), data = gen.data;
    if (!data || typeof data.message !== 'string' || !data.message.trim() || data.message.length > 8000 || !['continue','question','revise','ask_user'].includes(data.action) || !Array.isArray(data.target_roles)) fail('讨论返回格式无效');
    const targets = [...new Set(data.target_roles)].map(idx => allRoles.find(r => r.idx === idx));
    if (targets.some(r => !r)) fail('讨论指定了不属于本项目的分工');
    if (data.action === 'question' && (targets.length !== 1 || targets[0].who === turn.employee)) fail('提问必须指定另一位项目成员');
    if (data.action === 'revise' && !targets.length) fail('返工需要指定责任分工');
    db.exec('BEGIN IMMEDIATE');
    try {
      const messageId = append(pid, { sender: turn.employee, recipient: data.action === 'ask_user' ? 'boss' : targets.length === 1 ? targets[0].who : 'team',
        kind: data.action === 'question' || data.action === 'ask_user' ? 'question' : data.action === 'revise' ? 'revision' : 'discussion',
        body: data.message.trim(), replyTo: turn.reply_to, attempt: turn.attempt,
        meta: { ...gen.meta, action: data.action, target_roles: data.target_roles }, key: `talk:${turn.id}:${turn.attempt}` });
      db.prepare("UPDATE discussion_turns SET status='done',result=?,error='',finished_at=datetime('now') WHERE id=?").run(JSON.stringify(gen), turn.id);
      if (data.action === 'ask_user') waitForUser(pid, '员工提出了需要你决定的问题，请在讨论中回答。');
      else if (data.action === 'question') {
        if (turn.depth >= 2) waitForUser(pid, '这组问题已经往返讨论多次，请帮员工明确取舍。');
        else queue(pid, targets[0], 'reply', { replyTo: messageId, depth: turn.depth + 1, key: `reply:${messageId}` });
      } else if (data.action === 'revise') {
        if (p.status === 'done') append(pid, { body: '这个项目已经发布。以上建议已保留；新的修改请创建后续任务。', replyTo: messageId });
        else if (config?.repairs >= config?.max_repairs) waitForUser(pid, '已达到自动返工上限，请查看讨论后手动安排。');
        else {
          const jobs = db.prepare('SELECT * FROM jobs WHERE project_id=?').all(pid);
          if (targets.some(r => !jobs.some(j => j.role_idx === r.idx && j.attempt > 0))) fail('不能返工尚未产生交付的分工');
          revise(`p:${pid}:${targets[0].idx}`, data.message.trim(), { targets: targets.map(r => r.idx), actor: turn.employee, messageId });
          db.prepare("UPDATE project_team SET repairs=repairs+1,stage='working',reason='',waiting_role=NULL WHERE project_id=?").run(pid);
          append(pid, { body: `已按消息 #${messageId} 安排 ${targets.map(r => r.name).join('、')} 返工，依赖它们的分工将自动重新执行。`, replyTo: messageId });
        }
      } else if (turn.purpose === 'triage') waitForUser(pid, '测试仍然失败，排查员工没有给出修复对象，请查看讨论。');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function failed(turn, error) {
    db.prepare("UPDATE discussion_turns SET status='failed',error=?,finished_at=datetime('now') WHERE id=?").run(error.message, turn.id);
    waitForUser(turn.project_id, `讨论调用失败：${error.message}`);
    append(turn.project_id, { body: `讨论调用失败，未生成员工发言：${error.message}`, key: `talk-error:${turn.id}:${turn.attempt}` });
  }
  function messages(pid, { after = 0, before = 0 } = {}) {
    project(pid);
    const rows = after ? db.prepare('SELECT * FROM project_messages WHERE project_id=? AND id>? ORDER BY id LIMIT 100').all(pid, after)
      : db.prepare('SELECT * FROM project_messages WHERE project_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT 100').all(pid, before, before).reverse();
    const first = rows[0]?.id;
    return { messages: rows.map(m => ({ ...m, meta: J(m.meta) })), hasOlder: !!(first && db.prepare('SELECT 1 FROM project_messages WHERE project_id=? AND id<?').get(pid, first)) };
  }
  function post(pid, { body, targetRole, clientId }) {
    const p = project(pid), allRoles = roles(pid);
    if (typeof body !== 'string' || !body.trim() || body.length > 6000) fail('请输入 1 到 6000 字的消息');
    if (typeof clientId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(clientId)) fail('消息标识无效，请刷新后重试');
    const key = `boss:${pid}:${clientId}`;
    const existing = db.prepare('SELECT id FROM project_messages WHERE dedupe_key=?').get(key);
    if (existing) return { ok: true, id: existing.id };
    const target = targetRole == null ? allRoles[0] : allRoles.find(r => r.idx === targetRole);
    if (!target) fail('请选择本项目的一位员工');
    db.prepare('INSERT OR IGNORE INTO project_team(project_id) VALUES(?)').run(pid);
    const config = state(pid);
    const id = append(pid, { sender: 'boss', recipient: target.who, kind: 'message', body: body.trim(), key });
    db.prepare("UPDATE project_team SET stage='working',reason='',waiting_role=NULL WHERE project_id=?").run(pid);
    if (config.waiting_role != null && p.status !== 'done' && !db.prepare("SELECT 1 FROM jobs WHERE project_id=? AND status='running'").get(pid)) {
      revise(`p:${pid}:${config.waiting_role}`, `老板回复了项目讨论：${body.trim()}`, { messageId: id });
    } else queue(pid, target, 'boss_reply', { replyTo: id, key: `reply:${id}` });
    kick(); return { ok: true, id };
  }
  function retry(id) {
    const turn = db.prepare('SELECT * FROM discussion_turns WHERE id=?').get(id);
    if (!turn || !['failed','interrupted'].includes(turn.status)) fail('这次讨论无需重试');
    db.prepare("UPDATE discussion_turns SET status='queued',error='' WHERE id=?").run(id);
    db.prepare("UPDATE project_team SET stage='working',reason='',waiting_role=NULL WHERE project_id=?").run(turn.project_id);
    kick(); return { ok: true };
  }
  return { initialize, state, turns, append, delivery, blockedReason, eligible, advance, complete, failed, messages, post, retry, waitForUser };
}

module.exports = { createCollaboration };
