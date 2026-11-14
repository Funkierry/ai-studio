'use strict';
// Finished work as ordinary files: one folder per piece of work under the outputs folder, holding the program,
// the documents, and a readable record of how it was made. The folder is rewritten when the work moves on;
// once the work is accepted, only the record is touched again, so files edited there afterwards are left alone.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const G = require('./git');
const { safe } = require('./company');

const CODE = '程序', DOCS_DIR = '文档';
const J = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };
const utc = s => s ? new Date(`${String(s).replace(' ', 'T')}Z`).toISOString() : null;
function openFolder(dir) {
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [dir]] : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
}

function createOutputs(co, root, { trail, opener = openFolder } = {}) {
  const db = co.executionStore, { docs: DOCS, repos: REPOS } = co.paths;
  const fail = (message, status = 404) => { throw Object.assign(new Error(message), { status }); };
  const mtime = f => { try { return Math.round(fs.statSync(f).mtimeMs); } catch { return 0; } };
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;

  // what a piece of work has produced so far, and two fingerprints: one of the files, one of the record
  function load(id) {
    const m = /^([po]):(.+)$/.exec(String(id || ''));
    if (!m) fail('没有这项工作');
    if (m[1] === 'p') {
      const p = db.prepare('SELECT * FROM projects WHERE id=?').get(Number(m[2]));
      if (!p) fail('没有这项工作');
      const roles = db.prepare('SELECT * FROM roles WHERE project_id=? ORDER BY idx').all(p.id).map(r => ({ ...r, artifacts: J(r.artifacts, []) }));
      const repo = path.join(REPOS, p.slug || ''), refs = [];
      if (p.slug && G.isRepo(repo)) {
        refs.push('main');
        // before acceptance the shares still sit on their own branches: lay them over main in the order of the shares
        if (p.status !== 'done') for (const r of roles) {
          const branch = r.artifacts.find(a => a.type === 'commit' && a.branch && a.branch !== 'main')?.branch;
          if (branch && !refs.includes(branch) && G.branchExists(repo, branch)) refs.push(branch);
        }
      }
      const docDir = path.join(DOCS, '项目', p.slug || '');
      const docs = p.slug && fs.existsSync(docDir) ? fs.readdirSync(docDir).filter(f => f.endsWith('.md')).sort().map(f => [`${DOCS_DIR}/${f}`, path.join(docDir, f)]) : [];
      return { id, folder: p.slug, final: p.status === 'done', has: roles.some(r => r.artifacts.length), repo: refs.length ? repo : null, refs, docs,
        content: JSON.stringify([p.status, p.tag, roles.map(r => [r.status, r.artifacts.filter(a => a.hash).map(a => a.hash)]), docs.map(d => mtime(d[1]))]),
        record: JSON.stringify([count('SELECT COALESCE(MAX(id),0) n FROM project_messages WHERE project_id=?', p.id), count("SELECT COUNT(*) n FROM calls WHERE work=? AND status<>'running'", id)]) };
    }
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(m[2]);
    if (!o) fail('没有这项工作');
    const job = db.prepare('SELECT * FROM jobs WHERE order_id=?').get(o.id), commit = J(job?.result, {}).artifacts?.find(a => a.type === 'commit');
    const repo = commit ? path.join(REPOS, commit.repo) : null, doc = o.doc_path && path.join(DOCS, o.doc_path);
    const docs = doc && fs.existsSync(doc) ? [[`${safe(o.title)}.md`, doc]] : [];
    return { id, folder: `${safe(o.title)}-${String(o.id).slice(0, 8)}`, final: o.status === 'done', has: docs.length > 0,
      repo: repo && G.isRepo(repo) ? repo : null, refs: ['main'], docs,
      content: JSON.stringify([o.status, job?.status, job?.attempt, commit?.hash, docs.map(d => mtime(d[1]))]),
      record: JSON.stringify([count("SELECT COUNT(*) n FROM calls WHERE work=? AND status<>'running'", id), count('SELECT COUNT(*) n FROM reviews WHERE subject=?', o.id), o.status]) };
  }

  const row = id => db.prepare('SELECT * FROM exports WHERE work=?').get(id);
  function prune(dir, from) {
    for (let d = path.dirname(from); d.startsWith(dir + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch { return; } }
  }
  // bring the folder up to date; returns the export row, or null when there is nothing to save yet
  function sync(id) {
    const w = load(id), prev = row(id);
    if (!w.has) return prev || null;
    const dir = path.join(root, w.folder), signature = JSON.stringify([w.content, w.record]);
    if (prev && prev.signature === signature && prev.dir === dir && fs.existsSync(dir)) return prev;
    const before = prev && prev.dir === dir && fs.existsSync(dir) ? J(prev.signature, []) : [];
    const old = new Set(before.length ? J(prev.files, []) : []), written = new Set();
    const inside = rel => { const f = path.resolve(dir, rel); return f.startsWith(dir + path.sep) ? f : null; };
    const put = (rel, data) => { const f = inside(rel); if (!f) return; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); written.add(rel); };
    fs.mkdirSync(dir, { recursive: true });
    if (before[0] === w.content) {
      // only the record moved on: the program and documents on disk stay exactly as they are
      for (const rel of old) if (!rel.startsWith('过程记录')) written.add(rel);
    } else {
      if (w.repo) for (const ref of w.refs) for (const f of G.exportTree(w.repo, ref, path.join(dir, CODE))) written.add(`${CODE}/${f}`);
      for (const [rel, source] of w.docs) put(rel, fs.readFileSync(source));
    }
    for (const [rel, text] of trail ? trail.record(id) : []) put(rel, text);
    for (const rel of old) if (!written.has(rel)) { const f = inside(rel); if (f) { fs.rmSync(f, { force: true }); prune(dir, f); } }
    db.prepare(`INSERT INTO exports(work,dir,signature,files,final,at) VALUES(?,?,?,?,?,datetime('now'))
      ON CONFLICT(work) DO UPDATE SET dir=excluded.dir,signature=excluded.signature,files=excluded.files,final=excluded.final,at=excluded.at`)
      .run(id, dir, signature, JSON.stringify([...written].sort()), w.final ? 1 : 0);
    return row(id);
  }

  const PAGES = [`${CODE}/web/index.html`, `${CODE}/index.html`, `${CODE}/public/index.html`];
  function list(id) {
    const r = sync(id);
    if (!r) return { root, dir: null, final: false, files: [], page: null };
    const files = J(r.files, []).map(rel => { try { return { path: rel, size: fs.statSync(path.join(r.dir, rel)).size }; } catch { return null; } }).filter(Boolean);
    const names = files.map(f => f.path);
    return { root, dir: r.dir, final: !!r.final, at: utc(r.at), files, page: PAGES.find(p => names.includes(p)) || names.find(p => p.startsWith(`${CODE}/`) && p.endsWith('.html')) || null };
  }
  // the file on disk for a path this studio exported; anything else in the folder is not served
  function resolve(id, rel) {
    const r = row(id);
    if (!r || !J(r.files, []).includes(rel)) fail('没有这个文件');
    return path.join(r.dir, rel);
  }
  function read(id, rel) {
    const file = resolve(id, rel), size = fs.statSync(file).size;
    if (size > 600000) return { path: rel, size, large: true };
    const data = fs.readFileSync(file);
    return data.includes(0) ? { path: rel, size, binary: true } : { path: rel, size, content: data.toString('utf8') };
  }
  function open(id) {
    fs.mkdirSync(root, { recursive: true });
    const dir = id ? sync(id)?.dir : root;
    if (!dir) fail('这项工作还没有成品', 409);
    opener(dir);
    return { ok: true, dir };
  }
  // every piece of real work, oldest first; one that cannot be exported never stops the others
  function syncAll() {
    const ids = [...db.prepare('SELECT id FROM projects ORDER BY id').all().map(p => `p:${p.id}`),
      ...db.prepare("SELECT id FROM orders WHERE source NOT IN ('incoming','preset') AND doc_path IS NOT NULL ORDER BY created_at").all().map(o => `o:${o.id}`)];
    let saved = 0;
    for (const id of ids) { try { if (sync(id)) saved++; } catch (error) { console.error(`成品导出失败 ${id}：${error.message}`); } }
    return saved;
  }
  return { root, sync, list, read, resolve, open, syncAll };
}
module.exports = { createOutputs };
