'use strict';
// How a piece of work went, in order: what was asked, who said and delivered what, what the boss decided,
// and the model call behind each step. Nothing is stored here; it is read from what the company already keeps.
const J = (s, fallback = {}) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };
// the database holds some times in UTC and some in local time; everything leaves here as one kind
const utc = s => s ? new Date(`${String(s).replace(' ', 'T')}Z`).toISOString() : null;
const local = s => s ? new Date(String(s).replace(' ', 'T')).toISOString() : null;
const KINDS = { ask: '提出要求', message: '消息', discussion: '讨论', question: '提问', revision: '要求修改', delivery: '交付', test_result: '执行结果',
  failure: '没有完成', release: '验收发布', notice: '系统记录', approval: '确认', call: '模型调用' };
const SHOWN = new Set(['doc', 'commit', 'test', 'tag']);
const slim = a => ({ type: a.type, path: a.path, repo: a.repo, branch: a.branch, files: a.files, pass: a.pass, fail: a.fail, skipped: a.skipped, name: a.name });
const artifactsOf = list => (Array.isArray(list) ? list : []).filter(a => SHOWN.has(a.type)).map(slim);

function createTrail(co) {
  const db = co.executionStore;
  const fail = message => { throw Object.assign(new Error(message), { status: 404 }); };
  const COLUMNS = 'id,work,role_idx,employee,kind,title,attempt,status,error,model,tokens_in,tokens_out,cost,ms,started_at,finished_at,LENGTH(prompt) AS prompt_chars';
  const brief = c => ({ id: c.id, employee: c.employee, role: c.role_idx, kind: c.kind, title: c.title, attempt: c.attempt, status: c.status, error: c.error,
    model: c.model, tokens: (c.tokens_in || 0) + (c.tokens_out || 0), cost: c.cost, ms: c.ms, started: utc(c.started_at), finished: utc(c.finished_at), prompt_chars: c.prompt_chars });
  const callsOf = work => db.prepare(`SELECT ${COLUMNS} FROM calls WHERE work=? ORDER BY id`).all(work).map(brief);
  // Times are kept to the second, so things that happened within one second are put in the order they must have happened:
  // entries may carry `seq` for that; otherwise the order they were stored in stands.
  const sorted = entries => entries.map((e, i) => [e, i]).sort((a, b) => (a[0].at || '').localeCompare(b[0].at || '')
    || (a[0].seq != null && b[0].seq != null ? a[0].seq - b[0].seq : 0) || a[1] - b[1]).map(([{ seq, ...e }]) => e);

  function parse(id) {
    const m = /^([po]):(.+)$/.exec(String(id || ''));
    if (!m) fail('没有这项工作');
    return m[1] === 'p' ? { project: Number(m[2]) } : { order: m[2] };
  }

  function project(pid) {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(pid);
    if (!p) fail('没有这项工作');
    const calls = callsOf(`p:${pid}`), byId = new Map(calls.map(c => [c.id, c])), used = new Set();
    const entries = [{ key: 'ask', at: local(p.created_at), from: 'boss', to: 'team', kind: 'ask', body: p.goal || p.name }];
    const messages = db.prepare("SELECT * FROM project_messages WHERE project_id=? AND kind<>'request' ORDER BY id").all(pid);
    for (const m of messages) {
      const meta = J(m.meta), call = byId.get(meta.call);
      if (call) used.add(call.id);
      const role = m.job_id ? Number(String(m.job_id).split(':')[2]) : call?.role;
      // messages written before calls were kept still say which model wrote them
      const old = !call && meta.model ? { model: meta.model, ms: meta.ms, cost: meta.cny, tokens: (meta.input_tokens || 0) + (meta.output_tokens || 0) } : null;
      entries.push({ key: `m${m.id}`, id: m.id, at: utc(m.created_at), from: m.sender, to: m.recipient, kind: m.kind, body: m.body, reply_to: m.reply_to,
        role: Number.isInteger(role) ? role : null, attempt: m.attempt, call: call || old, artifacts: artifactsOf(meta.artifacts) });
    }
    // a call that never turned into a message (it failed, or saving its result failed) is still shown
    for (const c of calls) if (c.status !== 'running' && !used.has(c.id))
      entries.push({ key: `c${c.id}`, at: c.finished || c.started, from: c.status === 'done' ? c.employee : 'system', to: 'team', kind: c.status === 'done' ? 'call' : 'failure',
        body: c.status === 'done' ? '' : `${co.emp(c.employee).name} 的这次调用没有完成：${c.error || '原因未知'}`, role: c.role, attempt: c.attempt, call: c, artifacts: [] });
    // projects from before messages were kept: each share still shows what it handed in, and the acceptance is still there
    const told = new Set(messages.map(m => m.job_id).filter(Boolean));
    const roles = db.prepare('SELECT * FROM roles WHERE project_id=? ORDER BY idx').all(pid);
    for (const j of db.prepare('SELECT * FROM jobs WHERE project_id=? ORDER BY role_idx').all(pid)) {
      if (told.has(j.id) || !['done', 'review', 'failed'].includes(j.status)) continue;
      const r = roles.find(x => x.idx === j.role_idx), result = J(j.result), at = utc(j.finished_at) || local(r?.finished_at) || local(p.created_at);
      entries.push(j.status === 'failed'
        ? { key: `j${j.id}`, at, from: 'system', to: 'team', kind: 'failure', body: `${r?.name || '分工'}：${j.error || '没有完成'}`, role: j.role_idx, artifacts: [] }
        : { key: `j${j.id}`, at, from: j.employee, to: 'boss', kind: 'delivery', body: result.summary || `交付了「${r?.name || '分工'}」。`, role: j.role_idx,
          artifacts: artifactsOf(result.artifacts?.length ? result.artifacts : J(r?.artifacts, [])) });
    }
    if (p.status === 'done' && !messages.some(m => m.kind === 'release'))
      entries.push({ key: 'done', at: local(p.finished_at) || local(p.created_at), from: 'boss', to: 'team', kind: 'release', body: `验收通过${p.stars ? ` ${'★'.repeat(p.stars)}` : ''}${p.tag ? `，版本 ${p.tag}` : ''}。`, artifacts: [] });
    return { title: p.name, entries: sorted(entries), running: calls.filter(c => c.status === 'running') };
  }

  function order(oid) {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(oid);
    if (!o) fail('没有这项工作');
    const spec = J(o.spec), job = db.prepare('SELECT * FROM jobs WHERE order_id=?').get(oid), result = J(job?.result);
    const calls = callsOf(`o:${oid}`), finished = calls.filter(c => c.status !== 'running');
    const replies = new Map(db.prepare('SELECT id,reply FROM calls WHERE work=?').all(`o:${oid}`).map(c => [c.id, J(c.reply)]));
    // the n-th attempt is followed by the n-th request to redo it, which leads to attempt n+1
    const entries = [{ key: 'ask', seq: 0, at: local(o.created_at), from: 'boss', to: job?.employee || 'team', kind: 'ask', body: spec.detail || o.brief || o.title }];
    finished.forEach((c, i) => {
      const latest = i === finished.length - 1;
      const seq = c.attempt ? c.attempt * 2 : undefined;
      if (c.status === 'done') entries.push({ key: `c${c.id}`, seq, at: c.finished, from: c.employee, to: 'boss', kind: c.kind === 'plan' ? 'discussion' : 'delivery',
        body: replies.get(c.id)?.summary || '交付了成品。', attempt: c.attempt, call: c, artifacts: latest ? artifactsOf(result.artifacts) : [] });
      else entries.push({ key: `c${c.id}`, seq, at: c.finished || c.started, from: 'system', to: 'boss', kind: 'failure',
        body: `${co.emp(c.employee).name} 的这次调用没有完成：${c.error || '原因未知'}`, attempt: c.attempt, call: c, artifacts: [] });
    });
    // work delivered before calls were kept: only the result is known
    if (!finished.length && job?.finished_at) entries.push(job.status === 'failed'
      ? { key: 'job', at: utc(job.finished_at), from: 'system', to: 'boss', kind: 'failure', body: job.error || '没有完成', artifacts: [] }
      : { key: 'job', at: utc(job.finished_at), from: job.employee, to: 'boss', kind: 'delivery', body: result.summary || '交付了成品。', artifacts: artifactsOf(result.artifacts) });
    db.prepare('SELECT * FROM reviews WHERE subject=? ORDER BY id').all(oid).forEach((r, i) =>
      entries.push({ key: `r${r.id}`, seq: finished.some(c => c.attempt) ? (i + 1) * 2 + 1 : undefined, at: local(r.at), from: 'boss', to: job?.employee || 'team', kind: 'revision', body: r.reason, artifacts: [] }));
    for (const d of db.prepare('SELECT * FROM deliverables WHERE order_id=? ORDER BY id').all(oid))
      entries.push({ key: `d${d.id}`, seq: 1e9, at: local(d.at), from: 'boss', to: job?.employee || 'team', kind: 'release', body: '验收通过。', artifacts: [] });
    return { title: o.title, entries: sorted(entries), running: calls.filter(c => c.status === 'running') };
  }

  const of = id => { const w = parse(id); return w.project != null ? project(w.project) : order(w.order); };

  // one call in full: exactly what the employee was given and what came back
  function call(id) {
    const c = db.prepare(`SELECT ${COLUMNS},prompt,reply FROM calls WHERE id=?`).get(Number(id));
    if (!c) fail('没有这次调用的记录');
    return { ...brief(c), work: c.work, prompt: c.prompt, reply: J(c.reply) };
  }

  /* ---------- the same record as files a person can read without the studio ---------- */
  const name = id => id === 'boss' ? '老板' : id === 'system' ? '执行系统' : id === 'team' ? '全体' : co.emp(id).name;
  const stamp = iso => iso ? new Date(iso).toLocaleString('sv-SE').slice(0, 16) : '';
  const callLine = c => !c ? '' : [c.model, c.ms != null && `${Math.round(c.ms / 1000)} 秒`, c.cost != null && `¥${Number(c.cost).toFixed(2)}`, c.id && `调用 #${c.id}`].filter(Boolean).join('，');
  const artifactLine = a => a.type === 'doc' ? `文档 ${String(a.path || '').split('/').at(-1)}` : a.type === 'commit' ? `代码（分支 ${a.branch}${a.files ? `，${a.files} 个文件` : ''}）`
    : a.type === 'test' ? `测试：通过 ${a.pass || 0}，失败 ${a.fail || 0}，跳过 ${a.skipped || 0}` : `版本 ${a.name}`;
  const fileName = c => `过程记录/调用-${String(c.id).padStart(3, '0')}-${String(`${name(c.employee)}-${c.title || c.kind}`).replace(/[<>:"/\\|?*\x00-\x1f\s]+/g, '_').slice(0, 40)}.md`;
  function replyText(r) {
    const L = [];
    if (r.summary) L.push(`**摘要**：${r.summary}`, '');
    if (r.text) L.push(r.text, '');
    if (r.action) L.push(`行动：${r.action}${r.target_roles?.length ? `（指向分工 ${r.target_roles.map(i => i + 1).join('、')}）` : ''}`, '');
    if (r.files?.length) L.push('写出的文件：', ...r.files.map(f => `- ${f}`), '');
    if (r.open_questions?.length) L.push('待确认的问题：', ...r.open_questions.map(q => `- ${q}`), '');
    return L.join('\n') || '（没有内容）';
  }
  // [relative path, text] pairs: one overview, plus one file per model call with the full brief and reply
  function record(id) {
    const t = of(id), files = [];
    const L = [`# 过程记录：${t.title}`, '', `> 导出时间 ${stamp(new Date().toISOString())}。按时间顺序记录了这项工作里每个人说了什么、交了什么，以及你的每个决定。`,
      '> 每次模型调用的完整任务书和回复在「过程记录」文件夹里，文件名里的编号就是下面的调用编号。', ''];
    let day = '';
    for (const e of t.entries) {
      const at = stamp(e.at);
      if (at.slice(0, 10) !== day) { day = at.slice(0, 10); L.push(`## ${day}`, ''); }
      L.push(`**${at.slice(11)}　${name(e.from)} → ${name(e.to)}　${KINDS[e.kind] || e.kind}**${callLine(e.call) ? `（${callLine(e.call)}）` : ''}`, '');
      if (e.body) L.push(e.body, '');
      if (e.artifacts?.length) L.push(...e.artifacts.map(a => `- ${artifactLine(a)}`), '');
    }
    files.push(['过程记录.md', L.join('\n')]);
    const w = parse(id), work = w.project != null ? `p:${w.project}` : `o:${w.order}`;
    for (const c of db.prepare(`SELECT ${COLUMNS},prompt,reply FROM calls WHERE work=? AND status<>'running' ORDER BY id`).all(work)) {
      const b = brief(c);
      files.push([fileName(b), [`# 调用 #${c.id}：${name(c.employee)} · ${c.title || c.kind}`, '',
        `> ${stamp(b.started)} 开始　${c.status === 'done' ? '完成' : `没有完成：${c.error}`}　${callLine({ ...b, id: null })}`, '',
        '## 交给模型的任务书', '', c.prompt, '', '## 模型的回复', '', c.status === 'done' ? replyText(J(c.reply)) : '（没有回复）', ''].join('\n')]);
    }
    return files;
  }

  return { of, call, record, KINDS };
}
module.exports = { createTrail };
