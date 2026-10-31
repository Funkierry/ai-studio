'use strict';

// Read-only history: exact literal keyword matching, stable cursor pagination,
// and reply context. Reading history never schedules a model call.
const bad = message => { throw Object.assign(new Error(message), { status: 400 }); };
const number = (v, fallback) => {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) bad('编号必须是非负整数');
  return n;
};
const parsed = value => { try { return JSON.parse(value); } catch { return {}; } };
const select = `SELECT m.*, p.name AS project_name,
  COALESCE(e.name,m.sender) AS sender_name, COALESCE(r.name,m.recipient) AS recipient_name
  FROM project_messages m JOIN projects p ON p.id=m.project_id
  LEFT JOIN employees e ON e.id=m.sender LEFT JOIN employees r ON r.id=m.recipient`;
function decorate(m) {
  const meta = parsed(m.meta);
  const llm = meta.provider ? meta : (meta.artifacts || []).find(a => a.type === 'llm');
  const source = m.sender === 'boss' ? 'human' : m.sender === 'system' ? 'system'
    : llm?.provider && !['fake','fixture'].includes(llm.provider) ? 'model'
    : llm?.provider ? 'test' : 'unknown';
  return { ...m, meta, source, model: llm?.model || null, provider: llm?.provider || null };
}
function createChatHistory(db) {
  function search(options = {}) {
    const snapshot = number(options.snapshot, db.prepare('SELECT COALESCE(MAX(id),0) id FROM project_messages').get().id);
    const before = number(options.before, 0), limit = Math.min(200, Math.max(1, number(options.limit, 50)));
    const clauses = ['m.id<=?'], args = [snapshot];
    if (options.project) { clauses.push('m.project_id=?'); args.push(number(options.project)); }
    if (options.sender) { clauses.push('m.sender=?'); args.push(String(options.sender)); }
    if (options.participant) { clauses.push('(m.sender=? OR m.recipient=?)'); args.push(String(options.participant), String(options.participant)); }
    if (options.kind) { clauses.push('m.kind=?'); args.push(String(options.kind)); }
    if (options.q) {
      if (String(options.q).length > 500) bad('关键词不能超过500字');
      clauses.push('instr(lower(m.body),lower(?))>0'); args.push(String(options.q));
    }
    for (const [key, op] of [['since','>='],['until','<=']]) if (options[key]) {
      const d = new Date(options[key]);
      if (!Number.isFinite(d.getTime())) bad('时间必须是有效的 ISO 日期时间');
      clauses.push(`m.created_at${op}?`); args.push(d.toISOString().slice(0,19).replace('T',' '));
    }
    const where = clauses.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM project_messages m WHERE ${where}`).get(...args).n;
    const rows = db.prepare(`${select} WHERE ${where}${before ? ' AND m.id<?' : ''} ORDER BY m.id DESC LIMIT ?`)
      .all(...args, ...(before ? [before] : []), limit + 1);
    const more = rows.length > limit;
    const messages = rows.slice(0,limit).map(decorate);
    return { messages, total, snapshot, nextBefore: more ? messages.at(-1).id : null };
  }
  function context(id) {
    id = number(id);
    const anchor = db.prepare(`${select} WHERE m.id=?`).get(id);
    if (!anchor) throw Object.assign(new Error('消息不存在'), { status: 404 });
    const parents = [], seen = new Set([id]); let parent = anchor.reply_to;
    while (parent && !seen.has(parent) && parents.length < 20) {
      seen.add(parent);
      const row = db.prepare(`${select} WHERE m.id=? AND m.project_id=?`).get(parent,anchor.project_id);
      if (!row) break;
      parents.push(decorate(row)); parent = row.reply_to;
    }
    const replies = db.prepare(`${select} WHERE m.reply_to=? AND m.project_id=? ORDER BY m.id LIMIT 100`).all(id,anchor.project_id).map(decorate);
    const before = db.prepare(`${select} WHERE m.project_id=? AND m.id<? ORDER BY m.id DESC LIMIT 3`).all(anchor.project_id,id).reverse();
    const after = db.prepare(`${select} WHERE m.project_id=? AND m.id>? ORDER BY m.id LIMIT 3`).all(anchor.project_id,id);
    return { message: decorate(anchor), parents: parents.reverse(), replies, nearby: [...before,...after].map(decorate) };
  }
  function filters() {
    return {
      projects: db.prepare('SELECT p.id,p.name,COUNT(m.id) messages FROM projects p LEFT JOIN project_messages m ON m.project_id=p.id GROUP BY p.id ORDER BY p.id DESC').all(),
      employees: db.prepare('SELECT id,name FROM employees ORDER BY name').all(),
      kinds: db.prepare('SELECT DISTINCT kind FROM project_messages ORDER BY kind').all().map(r=>r.kind),
    };
  }
  return { search, context, filters };
}
module.exports = { createChatHistory };
