'use strict';
// The company's systems of record: who works here, what was ordered, decided, built, spent and written down.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const store = require('./store');
const G = require('./git');
const P = require('./produce');
const writer = require('./writer');

const today = () => new Date().toLocaleDateString('sv-SE');
const safe = s => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || '未命名';
const BOSS = { name: '老板', email: 'boss@ai-studio.local', model: '人类' };

function createCompany(dataDir) {
  const DOCS = path.join(dataDir, 'docs');
  const REPOS = path.join(dataDir, 'repos');
  const BIZ = path.join(dataDir, 'biz');
  for (const d of [dataDir, REPOS, BIZ]) fs.mkdirSync(d, { recursive: true });
  const db = store.open(path.join(dataDir, 'company.db'));
  const J = store.json;

  /* ---------- doc library: a git repo of markdown files ---------- */
  G.init(DOCS);
  if (!G.log(DOCS).length) {
    G.commit(DOCS, {
      author: BOSS, message: '建立公司文档库',
      files: {
        '公司/README.md': '# AI 工作室\n\n这里是公司的文档库。每份文档都有完整的修改历史。\n\n- `项目/`：每个项目的工作单、各分工的交付文档、项目总结\n- `交付/`：单独订单验收通过后的交付物\n- `会议纪要/`：会议室里每次讨论的记录\n- `公司/`：公司层面的说明和规则\n',
        '公司/协作规则.md': '# 协作规则\n\n1. 开工前先读项目目标和上游交付物。\n2. 和同时进行的同事对齐接口、格式等约定，有变动马上同步。\n3. 遇到需要拍板的事，停下来问老板，不要自己猜。\n4. 交付物写清楚放在哪里、怎么用。\n5. 代码改动走合并请求，由另一位同事审查后合并。\n',
      },
    });
  }

  const emp = id => {
    const r = db.prepare('SELECT * FROM employees WHERE id=?').get(id);
    // the kind of AI decides which model writes for this person; early employees used the kind as their id
    const pr = r ? J(r.profile, {}) : {};
    return r ? { id: r.id, name: r.name, model: r.model, type: pr.type || r.id, persona: pr.persona || '', email: `${r.id}@ai-studio.local` }
      : { id, name: id || '未知', model: '', type: id, persona: '', email: 'unknown@ai-studio.local' };
  };
  const repoDir = slug => path.join(REPOS, slug);
  const docCommit = (rel, content, author, message) => G.commit(DOCS, { files: { [rel]: content }, author, message });

  /* ---------- employees & orders ---------- */
  function syncEmployees(list) {
    const up = db.prepare(`INSERT INTO employees(id,name,model,profile,level,xp,speed,memory,stamina,spent,prefs,bond,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,model=excluded.model,profile=excluded.profile,level=excluded.level,xp=excluded.xp,
      speed=excluded.speed,memory=excluded.memory,stamina=excluded.stamina,spent=excluded.spent,prefs=excluded.prefs,bond=excluded.bond,updated_at=excluded.updated_at`);
    for (const e of list) up.run(e.id, e.name, e.model, JSON.stringify(e.profile || {}), e.level | 0, e.xp | 0, e.speed | 0, e.memory | 0,
      +e.stamina || 0, +e.spent || 0, JSON.stringify(e.prefs || []), JSON.stringify(e.bond || {}));
    return { ok: true };
  }
  function addOrder(o) {
    db.prepare(`INSERT OR IGNORE INTO orders(id,title,brief,est,task_key,source,spec) VALUES(?,?,?,?,?,?,?)`)
      .run(o.id, o.title, o.brief || '', o.est || '', o.task_key || null, o.source || 'custom', JSON.stringify(o.spec || {}));
    return { ok: true };
  }
  function updateOrder(id, b) {
    db.prepare(`UPDATE orders SET title=COALESCE(?,title), brief=COALESCE(?,brief), est=COALESCE(?,est), spec=COALESCE(?,spec),
      updated_at=datetime('now','localtime') WHERE id=?`)
      .run(b.title ?? null, b.brief ?? null, b.est ?? null, b.spec ? JSON.stringify(b.spec) : null, id);
    return { ok: true };
  }
  function setOrder(id, { status, assignee, mode }) {
    db.prepare(`UPDATE orders SET status=?, assignee=COALESCE(?,assignee), mode=COALESCE(?,mode), updated_at=datetime('now','localtime') WHERE id=?`)
      .run(status, assignee || null, mode || null, id);
    return { ok: true };
  }

  /* ---------- the running log ---------- */
  function events({ activity = [], ledger = [] }) {
    const a = db.prepare('INSERT INTO activity(actor,kind,text,task,game_day,game_time) VALUES(?,?,?,?,?,?)');
    for (const e of activity) a.run(e.actor || '', e.kind || '', e.text || '', e.task || null, e.day | 0, e.time || '');
    const l = db.prepare("INSERT INTO ledger(employee,task,tokens,cost,game_day,source) VALUES(?,?,?,?,?,'sim')");
    for (const e of ledger) l.run(e.employee, e.task || null, e.tokens | 0, +e.cost || 0, e.day | 0);
    return { ok: true };
  }
  function approval(b) {
    db.prepare(`INSERT INTO approvals(kind,task,project_id,title,detail,risk,decision,proposed_by,auto,people,game_day,game_time)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.kind || 'approve', b.task || '', b.project_id || null, b.title || '', b.detail || '',
      b.risk || '', b.decision || '', b.proposed_by || null, b.auto ? 1 : 0, JSON.stringify(b.people || []), b.day | 0, b.time || '');
    return { ok: true };
  }
  function review(b) {
    db.prepare('INSERT INTO reviews(subject,verdict,reason,people,project_id) VALUES(?,?,?,?,?)')
      .run(b.subject, b.verdict || 'rejected', b.reason || '', JSON.stringify(b.people || []), b.project_id || null);
    if (b.project_id) db.prepare('UPDATE projects SET reworks=reworks+1 WHERE id=?').run(b.project_id);
    return { ok: true };
  }

  /* ---------- deliverables & meetings become documents ---------- */
  function deliverable(b) {
    const people = (b.people || []).map(emp);
    if (b.doc) {
      // the model already wrote it into the library while working; acceptance only records the verdict
      db.prepare(`INSERT INTO deliverables(title,body,people,mode,stars,reworks,cost,decisions,doc_path,order_id) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(b.title, b.body || '', JSON.stringify(people.map(p => p.name)), b.mode, b.stars | 0, b.reworks | 0, +b.cost || 0, JSON.stringify(b.decisions || []), b.doc, b.order_id || null);
      if (b.order_id) setOrder(b.order_id, { status: 'done' });
      return { ok: true, doc: b.doc };
    }
    const rel = `交付/${today()}-${safe(b.title.replace(/[《》]/g, ''))}.md`;
    const md = [`# ${b.title}`, '', `> 负责人：${people.map(p => `${p.name}（${p.model}）`).join('、')}　方式：${b.mode_label || b.mode}　验收：${'★'.repeat(b.stars)}${'☆'.repeat(3 - b.stars)}　花费：¥${(+b.cost || 0).toFixed(2)}${b.reworks ? `　返工 ${b.reworks} 次` : ''}`,
      '> 正文由模板生成；接入真实 AI 后，这里会是员工实际交付的内容。', '',
      '## 摘要', '', b.body || '', '',
      ...(b.decisions?.length ? ['## 过程中老板的决定', '', ...b.decisions.map(d => `- ${d}`), ''] : []),
      ...(b.transcript?.length ? ['## 工作记录', '', ...b.transcript.map(t => `- ${t}`), ''] : [])].join('\n');
    const c = docCommit(rel, md, people[0] || BOSS, `交付：${b.title}（${'★'.repeat(b.stars)}）`);
    db.prepare(`INSERT INTO deliverables(title,body,people,mode,stars,reworks,cost,decisions,doc_path,order_id) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(b.title, b.body || '', JSON.stringify(people.map(p => p.name)), b.mode, b.stars | 0, b.reworks | 0, +b.cost || 0, JSON.stringify(b.decisions || []), rel, b.order_id || null);
    if (b.order_id) setOrder(b.order_id, { status: 'done' });
    return { ok: true, doc: rel, commit: c.hash };
  }
  function meeting(b) {
    const people = (b.attendees || []).map(emp);
    const rel = `会议纪要/${today()}-${safe(b.topic)}.md`;
    const md = [`# 会议纪要：${b.topic}`, '', `> 参会：${people.map(p => p.name).join('、')}　日期：${today()}`, '',
      '## 讨论过程', '', ...(b.transcript || []).map(t => `- ${t}`), '',
      '## 决定', '', ...(b.decisions?.length ? b.decisions.map(d => `- ${d}`) : ['- 没有需要老板拍板的分歧']), ''].join('\n');
    const c = docCommit(rel, md, people[0] || BOSS, `会议纪要：${b.topic}`);
    db.prepare('INSERT INTO meetings(topic,attendees,transcript,decision,doc_path) VALUES(?,?,?,?,?)')
      .run(b.topic, JSON.stringify(people.map(p => p.name)), JSON.stringify(b.transcript || []), (b.decisions || []).join('；'), rel);
    return { ok: true, doc: rel, commit: c.hash };
  }

  /* ---------- projects ---------- */
  function launchProject(b) {
    const info = db.prepare('INSERT INTO projects(name,goal,order_id) VALUES(?,?,?)').run(b.name, b.goal || '', b.order_id || null);
    const id = Number(info.lastInsertRowid);
    const slug = `${id}-${safe(b.name)}`;
    db.prepare('UPDATE projects SET slug=? WHERE id=?').run(slug, id);
    const add = db.prepare('INSERT INTO roles(project_id,idx,name,description,output,deps,gate,who,kind) VALUES(?,?,?,?,?,?,?,?,?)');
    const roles = b.roles.map((r, i) => {
      const kind = P.kindOf({ name: r.name, output: r.out });
      const rid = Number(add.run(id, i, r.name, r.desc || '', r.out || '', JSON.stringify(r.deps || []), r.gate ? 1 : 0, r.who, kind).lastInsertRowid);
      return { id: rid, idx: i, name: r.name, output: r.out, who: r.who, kind };
    });
    const people = Object.fromEntries(db.prepare('SELECT id,name FROM employees').all().map(e => [e.id, e.name]));
    const dir = repoDir(slug);
    G.init(dir);
    const c = G.commit(dir, { author: BOSS, message: `创建项目仓库：${b.name}`,
      files: { 'README.md': P.repoReadme({ name: b.name, goal: b.goal }, roles, people), '.gitignore': 'data.db\nnode_modules/\n' } });
    const wo = `项目/${slug}/00-工作单.md`;
    docCommit(wo, b.workorder || `# ${b.name}\n`, BOSS, `项目立项：${b.name}`);
    if (b.order_id) setOrder(b.order_id, { status: 'assigned', mode: 'project' });
    return { id, slug, repo: slug, roles: roles.map(r => ({ id: r.id, idx: r.idx, kind: r.kind })), artifacts: [{ type: 'commit', repo: slug, branch: 'main', hash: c.hash }, { type: 'doc', path: wo }] };
  }

  function projectRow(id) {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    if (!p) throw Object.assign(new Error('项目不存在'), { status: 404 });
    return p;
  }
  const rolesOf = pid => db.prepare('SELECT * FROM roles WHERE project_id=? ORDER BY idx').all(pid);

  function openPR(p, role, branch, author, hash) {
    const roles = rolesOf(p.id);
    const down = roles.find(r => J(r.deps, []).includes(role.idx) && r.who !== role.who);
    const reviewer = down ? emp(down.who).name : (roles.find(r => r.who !== role.who) ? emp(roles.find(r => r.who !== role.who).who).name : '老板');
    const existing = db.prepare("SELECT * FROM pull_requests WHERE repo=? AND branch=? AND status='open'").get(p.slug, branch);
    if (existing) {
      db.prepare('UPDATE pull_requests SET head=? WHERE id=?').run(hash, existing.id);
      return { id: existing.id, title: existing.title, reviewer: existing.reviewer };
    }
    const title = `${role.name}：${role.output || role.name}`;
    const id = Number(db.prepare('INSERT INTO pull_requests(repo,branch,title,author,reviewer,project_id,role_id,head) VALUES(?,?,?,?,?,?,?,?)')
      .run(p.slug, branch, title, author.name, reviewer, p.id, role.id, hash).lastInsertRowid);
    return { id, title, reviewer };
  }
  function mergeOpenPRs(p, reviewerName) {
    const out = [];
    for (const pr of db.prepare("SELECT * FROM pull_requests WHERE repo=? AND status='open' ORDER BY id").all(p.slug)) {
      const m = G.merge(repoDir(p.slug), pr.branch, `合并 #${pr.id}：${pr.title}（审查：${reviewerName || pr.reviewer}）`);
      if (m.ok) {
        db.prepare("UPDATE pull_requests SET status='merged', merged_at=datetime('now','localtime'), note=? WHERE id=?").run(`审查通过：${reviewerName || pr.reviewer}`, pr.id);
        out.push({ type: 'merge', pr: pr.id, title: pr.title, hash: m.hash });
      } else {
        db.prepare("UPDATE pull_requests SET status='conflict', note=? WHERE id=?").run(m.out.slice(0, 500), pr.id);
        out.push({ type: 'conflict', pr: pr.id, title: pr.title });
      }
    }
    return out;
  }
  function testFiles(dir) {
    const out = [];
    const walk = rel => {
      const abs = path.join(dir, rel);
      if (!fs.existsSync(abs)) return;
      for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
        const r = `${rel}/${d.name}`;
        if (d.isDirectory()) walk(r);
        else if (/\.test\.(c|m)?js$/.test(d.name)) out.push(r);
      }
    };
    walk('tests');
    return out;
  }
  function runTests(dir, branch) {
    return G.withBranch(dir, branch, () => {
      const files = testFiles(dir);
      if (!files.length) return { pass: 0, fail: 0, skipped: 0, output: '没有找到 tests/ 下的 .test.js 文件', code: null };
      const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: dir, encoding: 'utf8', timeout: 120000 });
      const output = `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`.replace(/\x1b\[[0-9;]*m/g, '');
      const num = rx => +((output.match(rx) || [])[1] || 0);
      return { pass: num(/ℹ pass (\d+)/), fail: num(/ℹ fail (\d+)/), skipped: num(/ℹ skipped (\d+)/), output, code: r.status };
    });
  }

  /* ---------- the brief an employee's model works from ---------- */
  const MAX_BRIEF = 400000; // characters of material per brief; anything beyond is listed as left out, never cut silently
  const TEXT_FILE = /\.(js|mjs|cjs|json|sql|md|html|css|txt|ya?ml)$/i;
  const readDoc = rel => { try { return fs.readFileSync(path.join(DOCS, rel), 'utf8'); } catch { return null; } };
  const fence = (body, lang = '') => `\`\`\`\`${lang}\n${body}\n\`\`\`\``;
  function repoSnapshot(dir, ref) {
    if (!G.tryGit(dir, ['rev-parse', '--verify', '-q', ref]).ok) return [];
    return G.tree(dir, ref).filter(f => TEXT_FILE.test(f) && f !== '.gitignore').map(f => [f, G.show(dir, ref, f)]);
  }
  function projectDecisions(pid, extra) {
    const rows = db.prepare('SELECT title, decision FROM approvals WHERE project_id=? ORDER BY id').all(pid).map(a => `${a.title} → ${a.decision}`);
    return [...new Set([...rows, ...(extra || [])])];
  }
  function buildBrief({ p, role, roles, author, prefs, b, docRel, branch }) {
    const L = [`# 项目：${p.name}`, '', '## 项目目标', '', p.goal || '（未填写）', ''];
    const wo = readDoc(`项目/${p.slug}/00-工作单.md`);
    if (wo) L.push('## 工作单（老板制定的分工）', '', wo, '');
    const down = roles.filter(r => J(r.deps, []).includes(role.idx));
    if (author.persona) L.push('## 你的岗位与专长', '', author.persona, '');
    L.push('## 你的分工', '', `你是 ${author.name}（${author.model}），负责第 ${role.idx + 1} 份分工「${role.name}」。`,
      `- 要做什么：${role.description || role.name}`, `- 交付物：${role.output || role.name}`,
      `- 做完交给：${down.length ? down.map(r => `「${r.name}」（${emp(r.who).name}）`).join('、') : '老板验收'}`, '');
    if (prefs.length) L.push('## 老板对你的长期要求（来自以前的打回意见）', '', ...prefs.map(x => `- ${x}`), '');
    const decisions = projectDecisions(p.id, b.decisions);
    if (decisions.length) L.push('## 本项目里老板已经做的决定', '', ...decisions.map(x => `- ${x}`), '');
    const said = (b.transcript || []).filter(t => t.startsWith('老板'));
    if (said.length) L.push('## 你工作时老板说过的话', '', ...said.map(x => `- ${x}`), '');
    if (b.feedback) {
      L.push('## 老板的修改意见（这次必须解决）', '', b.feedback, '');
      const prev = readDoc(docRel);
      if (prev) L.push('### 你上一版交的文档', '', fence(prev, 'markdown'), '');
    }
    // material: upstream docs, upstream code, current code; listed in that order until the budget runs out
    const parts = [];
    for (const k of J(role.deps, [])) {
      const u = roles[k];
      if (!u) continue;
      const art = J(u.artifacts, []);
      const doc = art.find(a => a.type === 'doc')?.path;
      const text = doc && readDoc(doc);
      if (text) parts.push([`### 「${u.name}」（${emp(u.who).name}）交的文档：${doc}`, fence(text, 'markdown')]);
    }
    if (P.CODE_KINDS.has(role.kind)) {
      const dir = repoDir(p.slug), seen = new Map();
      for (const [f, c] of repoSnapshot(dir, 'main')) seen.set(f, c);
      for (const k of J(role.deps, [])) {
        const ub = J(roles[k]?.artifacts, []).find(a => a.type === 'commit' && a.branch !== 'main')?.branch;
        if (ub) for (const [f, c] of repoSnapshot(dir, ub)) if (seen.get(f) !== c) { seen.set(f, c); }
      }
      if (b.feedback && branch) for (const [f, c] of repoSnapshot(dir, branch)) seen.set(f, c);
      for (const [f, c] of seen) parts.push([`### 代码：${f}`, fence(c)]);
    }
    let used = L.join('\n').length;
    const left = [];
    if (parts.length) L.push('## 可以参考的材料', '');
    for (const [title, body] of parts) {
      if (used + body.length > MAX_BRIEF) { left.push(title.replace(/^### /, '')); continue; }
      L.push(title, '', body, '');
      used += body.length;
    }
    if (left.length) L.push(`（材料太多，下面这些没有放进来：${left.join('；')}）`, '');
    return L.join('\n');
  }
  function fakeOutput(kind, ctx) {
    if (P.CODE_KINDS.has(kind)) {
      return { summary: `（测试替身）${ctx.role.output || ctx.role.name}`, notes: '测试替身生成的说明。',
        files: Object.entries(P.codeFiles(kind, ctx)).map(([p, c]) => ({ path: p, content: c })) };
    }
    return { summary: `（测试替身）${ctx.role.output || ctx.role.name}`, document: '## 正文\n\n测试替身生成的文档。', open_questions: [] };
  }

  // A role is finished: the employee's own model writes the deliverable (template if that fails),
  // then it becomes a doc, a branch + commit + PR, a business database or a real test run.
  async function roleDone(pid, idx, b) {
    const p = projectRow(pid);
    const role = db.prepare('SELECT * FROM roles WHERE project_id=? AND idx=?').get(pid, idx);
    if (!role) throw Object.assign(new Error('分工不存在'), { status: 404 });
    const author = emp(role.who);
    const prefs = J(db.prepare('SELECT prefs FROM employees WHERE id=?').get(role.who)?.prefs, []);
    const roles = rolesOf(pid);
    const upstream = J(role.deps, []).map(k => roles[k]).filter(Boolean).map(u => {
      const art = J(u.artifacts, []);
      return { name: u.name, output: u.output, who: emp(u.who).name, doc: art.find(a => a.type === 'doc')?.path, branch: art.find(a => a.type === 'commit' && a.branch !== 'main')?.branch };
    });
    const ctx = { project: p, role, author, upstream, date: today(),
      decisions: b.decisions || [], transcript: b.transcript || [], repo: p.slug, merges: [] };
    const artifacts = [];
    const dir = repoDir(p.slug);
    const docRel = `项目/${p.slug}/${String(role.idx + 1).padStart(2, '0')}-${safe(role.name)}.md`;
    const code = P.CODE_KINDS.has(role.kind);
    const branch = code ? `${role.kind === 'test' ? 'test' : 'feat'}/role-${role.idx + 1}` : null;
    if (role.kind === 'test') {
      // integrate everyone's open work first, so tests are written and run against the combined code
      ctx.merges = mergeOpenPRs(p);
      artifacts.push(...ctx.merges);
    }

    const prompt = buildBrief({ p, role, roles, author, prefs, b, docRel, branch });
    // keep exactly what the employee was given, so any deliverable can be traced back to its brief
    const briefFile = path.join(dataDir, 'briefs', p.slug, `${String(role.idx + 1).padStart(2, '0')}-${safe(role.name)}${b.rework ? `-修改-${Date.now()}` : ''}.md`);
    fs.mkdirSync(path.dirname(briefFile), { recursive: true });
    fs.writeFileSync(briefFile, prompt);
    const gen = await writer.write({ employee: author, kind: role.kind, prompt, fake: () => fakeOutput(role.kind, ctx) });
    // from here on everything is synchronous, so two hand-overs finishing together can't interleave git operations
    if (gen.ok) {
      artifacts.push({ type: 'llm', ...gen.meta });
      db.prepare("INSERT INTO ledger(employee,task,tokens,cost,game_day,source,model) VALUES(?,?,?,?,?,'api',?)")
        .run(role.who, `${p.name} · ${role.name}`, gen.meta.input_tokens + gen.meta.output_tokens, gen.meta.cny || 0, b.day | 0, gen.meta.model);
    } else {
      artifacts.push({ type: 'fallback', reason: gen.reason });
    }

    if (code) {
      const files = gen.ok ? gen.data.files : P.codeFiles(role.kind, ctx);
      const c = G.commit(dir, { files, branch, author, message: `${b.rework ? '按老板意见修改：' : ''}${role.name}：${role.output || role.name}` });
      artifacts.push({ type: 'commit', repo: p.slug, branch, hash: c.hash, files: Object.keys(files).length });
      if (role.kind === 'test') {
        ctx.testRun = runTests(dir, branch);
        artifacts.push({ type: 'test', pass: ctx.testRun.pass, fail: ctx.testRun.fail });
      }
      const pr = openPR(p, role, branch, author, c.hash);
      artifacts.push({ type: 'pr', id: pr.id, title: pr.title, reviewer: pr.reviewer });
      Object.assign(ctx, { branch, hash: c.hash, pr, files: Object.keys(files) });
      if (files['server/schema.sql']) {
        // the business database is rebuilt from whatever schema and seed data the backend now has
        const dbFile = path.join(BIZ, `${p.slug}.db`);
        try {
          for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
          const biz = new DatabaseSync(dbFile);
          try { biz.exec(files['server/schema.sql']); if (files['server/seed.sql']) biz.exec(files['server/seed.sql']); } finally { biz.close(); }
          artifacts.push({ type: 'db', name: `${p.slug}.db` });
        } catch (err) {
          artifacts.push({ type: 'db_error', reason: err.message });
        }
      }
    }
    const content = gen.ok ? P.llmDoc(role.kind, ctx, gen) : P.roleDoc(role.kind, ctx);
    const d = docCommit(docRel, content, author, `${b.rework ? '修改' : '提交'}文档：${role.output || role.name}`);
    artifacts.unshift({ type: 'doc', path: docRel, hash: d.hash });

    db.prepare(`UPDATE roles SET status='done', cost=cost+?, artifacts=?, finished_at=datetime('now','localtime') WHERE id=?`)
      .run(+b.cost || 0, JSON.stringify(artifacts), role.id);
    db.prepare('UPDATE projects SET cost=cost+? WHERE id=?').run(+b.cost || 0, pid);
    return { ok: true, artifacts, summary: gen.ok ? gen.data.summary : null, open_questions: gen.ok ? gen.data.open_questions || [] : [] };
  }
  /* ---------- single orders: optional plan first, then the real deliverable ---------- */
  const MODE_TEXT = { solo: '单人完成', team: '分工协作：你主写，搭档审查', meet: '先开会讨论，再由你定稿' };
  const ORDER_DOC_ASK = '按订单要求写出完整、可以直接使用的交付文档。如果订单有验收标准，在文档最后加一节「验收标准自查」，逐条写明是否满足、在哪里体现。';
  const ORDER_CODE_ASK = '按订单要求实现代码，交出可以直接运行的文件。在 notes 里写清楚怎么运行；如果订单有验收标准，逐条写明是否满足。';
  const PLAN_ASK = '先不要做正式交付。写一份简短的工作计划给老板确认：你理解的目标、交付物的结构或提纲、分几步做、准备怎么满足每条验收标准、需要老板确认的问题。';
  function orderRow(id) {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if (!o) throw Object.assign(new Error('订单不存在'), { status: 404 });
    return { ...o, spec: J(o.spec, {}) };
  }
  const prefsOf = id => J(db.prepare('SELECT prefs FROM employees WHERE id=?').get(id)?.prefs, []);
  const orderDocPath = o => `交付/${safe(o.title)}-${o.id}.md`;
  function orderBrief(o, { lead, members, mode, b, withPrev }) {
    const s = o.spec || {};
    const L = [`# 订单：${o.title}`, '', '## 要做什么', '', s.detail || o.brief || '（老板没写详细要求，按标题理解）', '',
      '## 交付物', '', `${s.deliverable?.kind === 'code' ? '代码' : '文档'}${s.deliverable?.name ? `：${s.deliverable.name}` : ''}`, ''];
    if (s.criteria?.length) L.push('## 验收标准（交付时逐条自查）', '', ...s.criteria.map((c, i) => `${i + 1}. ${c}`), '');
    if (s.priority === 'urgent') L.push('## 优先级', '', '紧急：先保证核心内容完整可用，次要内容可以简写并注明。', '');
    if (s.refs) L.push('## 老板给的参考资料', '', fence(s.refs), '');
    if (s.approvedPlan) L.push('## 老板已经确认的工作计划（按这个做）', '', s.approvedPlan, '');
    const others = members.filter(m => m.id !== lead.id);
    L.push('## 你是谁', '', `你是 ${lead.name}（${lead.model}）。${others.length ? `这单和 ${others.map(m => m.name).join('、')} 一起做（${MODE_TEXT[mode] || MODE_TEXT.solo}），由你执笔。` : '这单由你独立完成。'}`, '');
    if (lead.persona) L.push('## 你的岗位与专长', '', lead.persona, '');
    const prefs = prefsOf(lead.id);
    if (prefs.length) L.push('## 老板对你的长期要求（来自以前的打回意见）', '', ...prefs.map(x => `- ${x}`), '');
    if (b.decisions?.length) L.push('## 这单里老板已经做的决定', '', ...b.decisions.map(x => `- ${x}`), '');
    const said = (b.transcript || []).filter(t => t.startsWith('老板'));
    if (said.length) L.push('## 你工作时老板说过的话', '', ...said.map(x => `- ${x}`), '');
    if (b.feedback) {
      L.push('## 老板的修改意见（这次必须解决）', '', b.feedback, '');
      const prev = withPrev && readDoc(withPrev);
      if (prev) L.push('### 你上一版交的东西', '', fence(prev, 'markdown'), '');
    }
    return L.join('\n');
  }
  function recordCall(gen, who, task, day) {
    if (gen.ok) db.prepare("INSERT INTO ledger(employee,task,tokens,cost,game_day,source,model) VALUES(?,?,?,?,?,'api',?)")
      .run(who, task, gen.meta.input_tokens + gen.meta.output_tokens, gen.meta.cny || 0, day | 0, gen.meta.model);
    return gen.ok ? { type: 'llm', ...gen.meta } : { type: 'fallback', reason: gen.reason };
  }
  // keep exactly what the employee was given for an order, like the project briefs
  function saveOrderBrief(o, what, prompt) {
    const f = path.join(dataDir, 'briefs', 'orders', `${safe(o.title)}-${o.id}`, `${what}-${Date.now()}.md`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, prompt);
    return prompt;
  }
  async function orderPlan(id, b) {
    const o = orderRow(id), lead = emp(b.lead), members = (b.members || [b.lead]).map(emp);
    const gen = await writer.write({ employee: lead, kind: 'plan', ask: PLAN_ASK,
      prompt: saveOrderBrief(o, '计划', orderBrief(o, { lead, members, mode: b.mode, b })),
      fake: () => ({ summary: '（测试替身）工作计划', document: '1. 先读要求和参考资料\n2. 搭好提纲\n3. 写正文并逐条自查验收标准', open_questions: [] }) });
    const art = recordCall(gen, lead.id, `计划：${o.title}`, b.day);
    const s = o.spec || {};
    const plan = gen.ok ? String(gen.data.document).replace(/^\s*# [^\n]*\n+/, '')
      : ['1. 读清楚订单要求和参考资料', `2. 列出${s.deliverable?.name || '交付物'}的结构`, '3. 完成正文', ...(s.criteria?.length ? ['4. 逐条对照验收标准自查'] : [])].join('\n');
    return { ok: true, plan, summary: gen.ok ? gen.data.summary : '模型没写成，这是按订单要求生成的计划提纲', open_questions: gen.ok ? gen.data.open_questions : [], artifacts: [art] };
  }
  async function orderDeliver(id, b) {
    const o = orderRow(id), s = o.spec || {}, lead = emp(b.lead), members = (b.members || [b.lead]).map(emp);
    const code = s.deliverable?.kind === 'code';
    const docRel = orderDocPath(o);
    const gen = await writer.write({ employee: lead, kind: code ? 'code' : 'doc', rules: 'order', ask: code ? ORDER_CODE_ASK : ORDER_DOC_ASK,
      prompt: saveOrderBrief(o, b.feedback ? '修改' : '交付', orderBrief(o, { lead, members, mode: b.mode, b, withPrev: b.feedback ? docRel : null })),
      fake: () => code ? { summary: `（测试替身）${o.title}`, notes: '测试替身生成的说明。', files: [{ path: 'README.md', content: `# ${o.title}\n` }] }
        : { summary: `（测试替身）${o.title}`, document: '## 正文\n\n测试替身生成的交付文档。', open_questions: [] } });
    // everything below is synchronous, so concurrent hand-overs can't interleave git operations
    const artifacts = [recordCall(gen, lead.id, o.title, b.day)];
    let repo = null, files = null;
    if (code) {
      files = gen.ok ? gen.data.files : { 'README.md': `# ${o.title}\n\n${s.detail || o.brief || ''}\n\n（模型没写成，这里只有订单要求。）\n` };
      repo = `o-${safe(o.title)}-${o.id}`;
      const dir = repoDir(repo);
      G.init(dir);
      if (!G.log(dir).length) G.commit(dir, { files: { '.gitignore': 'data.db\nnode_modules/\n' }, author: BOSS, message: `创建订单仓库：${o.title}` });
      const c = G.commit(dir, { files, author: lead, message: `${b.feedback ? '按老板意见修改：' : ''}${o.title}` });
      artifacts.push({ type: 'commit', repo, branch: 'main', hash: c.hash, files: Object.keys(files).length });
    }
    const m = gen.meta, d = gen.data || {};
    const L = [`# ${s.deliverable?.name || o.title}`, '',
      `> 订单：${o.title}　负责人：${members.map(x => `${x.name}（${x.model}）`).join('、')}　方式：${MODE_TEXT[b.mode] || MODE_TEXT.solo}　日期：${today()}`,
      gen.ok ? `> 由 ${m.model} 撰写：输入 ${m.input_tokens} / 输出 ${m.output_tokens} token${m.cny != null ? `，约 ¥${m.cny.toFixed(2)}` : ''}，用时 ${Math.round(m.ms / 1000)} 秒`
        : `> 模型没写成（${gen.reason}），下面只有订单要求，等接入模型后重做。`, ''];
    if (gen.ok) {
      L.push(`**摘要**：${d.summary}`, '');
      if (code) L.push(d.notes || '', '', '## 代码位置', '', `- 代码库：\`${repo}\`，main 分支`, ...Object.keys(files).map(f => `- \`${f}\``), '');
      else L.push(String(d.document).replace(/^\s*# [^\n]*\n+/, ''), '');
      if (d.open_questions?.length) L.push('## 待老板确认', '', ...d.open_questions.map(q => `- ${q}`), '');
    } else {
      L.push('## 要做什么', '', s.detail || o.brief || '', '');
    }
    if (s.criteria?.length) L.push('## 订单的验收标准', '', ...s.criteria.map((c, i) => `${i + 1}. ${c}`), '');
    if (b.decisions?.length) L.push('## 过程中老板的决定', '', ...b.decisions.map(x => `- ${x}`), '');
    const dc = docCommit(docRel, L.join('\n'), lead, `${b.feedback ? '修改' : '交付'}：${o.title}`);
    artifacts.unshift({ type: 'doc', path: docRel, hash: dc.hash });
    db.prepare('UPDATE orders SET doc_path=? WHERE id=?').run(docRel, o.id);
    return { ok: true, artifacts, doc: docRel, summary: gen.ok ? d.summary : null, open_questions: gen.ok ? d.open_questions || [] : [] };
  }

  function roleStarted(pid, idx) {
    db.prepare(`UPDATE roles SET status='run', started_at=datetime('now','localtime') WHERE project_id=? AND idx=?`).run(pid, idx);
    return { ok: true };
  }

  function projectReview(pid, b) {
    const p = projectRow(pid);
    const people = [...new Set(rolesOf(pid).map(r => r.who))].map(emp);
    if (!b.stars) {
      review({ subject: p.name, verdict: 'rejected', reason: b.reason, people: people.map(x => x.name), project_id: pid });
      return { ok: true };
    }
    const dir = repoDir(p.slug);
    const artifacts = mergeOpenPRs(p, '老板');
    const tag = G.tag(dir, 'v1.0', `${p.name} 验收通过 ${'★'.repeat(b.stars)}`);
    artifacts.push({ type: 'tag', name: tag });
    const roles = rolesOf(pid);
    const prs = db.prepare('SELECT * FROM pull_requests WHERE repo=? ORDER BY id').all(p.slug);
    const rel = `项目/${p.slug}/99-项目总结.md`;
    const fresh = projectRow(pid);
    const md = [`# 项目总结：${p.name}`, '', `> 验收：${'★'.repeat(b.stars)}${'☆'.repeat(3 - b.stars)}　返工：${fresh.reworks} 次　花费：¥${fresh.cost.toFixed(2)}　版本：${tag}`, '',
      '## 目标', '', p.goal || '', '', '## 分工与交付', '', '| # | 分工 | 负责人 | 交付物 | 花费 |', '|---|---|---|---|---|',
      ...roles.map(r => `| ${r.idx + 1} | ${r.name} | ${emp(r.who).name} | ${r.output || '—'} | ¥${r.cost.toFixed(2)} |`), '',
      '## 代码', '', `- 代码库：\`${p.slug}\`，发布标签 \`${tag}\``, ...prs.map(x => `- #${x.id} ${x.title}（${x.author}，审查 ${x.reviewer}）：${x.status === 'merged' ? '已合并' : x.status}`), '',
      ...(b.decisions?.length ? ['## 过程中老板的决定', '', ...b.decisions.map(d => `- ${d}`), ''] : [])].join('\n');
    const d = docCommit(rel, md, BOSS, `项目验收：${p.name}（${'★'.repeat(b.stars)}）`);
    artifacts.unshift({ type: 'doc', path: rel, hash: d.hash });
    db.prepare(`UPDATE projects SET status='done', stars=?, tag=?, finished_at=datetime('now','localtime') WHERE id=?`).run(b.stars, tag, pid);
    db.prepare(`INSERT INTO deliverables(title,body,people,mode,stars,reworks,cost,decisions,doc_path,project_id,order_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(`《${p.name}》`, roles.map(r => `${r.name}：${r.output}`).join('；'), JSON.stringify(people.map(x => x.name)), 'project', b.stars, fresh.reworks, fresh.cost, JSON.stringify(b.decisions || []), rel, pid, p.order_id);
    if (p.order_id) setOrder(p.order_id, { status: 'done' });
    return { ok: true, artifacts };
  }

  /* ---------- state for the office on load ---------- */
  function state() {
    // in-flight work does not survive a reload: it goes back to the queue and restarts
    db.exec("UPDATE orders SET status='open' WHERE status='assigned' AND (mode IS NULL OR mode<>'project')");
    db.exec("UPDATE roles SET status='wait' WHERE status='run'");
    const employees = db.prepare('SELECT * FROM employees ORDER BY hired_at').all().map(e => ({ ...e, profile: J(e.profile, {}), prefs: J(e.prefs, []), bond: J(e.bond, {}) }));
    const orders = db.prepare("SELECT * FROM orders WHERE status='open' ORDER BY created_at").all().map(o => ({ ...o, spec: J(o.spec, {}) }));
    const projects = db.prepare("SELECT * FROM projects WHERE status<>'done' ORDER BY id").all().map(p => ({
      ...p, roles: rolesOf(p.id).map(r => ({ ...r, deps: J(r.deps, []), gate: !!r.gate })) }));
    const done = db.prepare('SELECT COUNT(*) n FROM deliverables').get().n;
    return { employees, orders, projects, completed: done };
  }

  /* ---------- browsing the systems ---------- */
  function repos() {
    return fs.readdirSync(REPOS).filter(d => G.isRepo(path.join(REPOS, d))).map(slug => {
      const dir = repoDir(slug), last = G.log(dir, 'main')[0];
      return { slug, branches: G.branches(dir), tags: G.tags(dir), last,
        open_prs: db.prepare("SELECT COUNT(*) n FROM pull_requests WHERE repo=? AND status='open'").get(slug).n };
    });
  }
  const checkRepo = slug => {
    const dir = path.resolve(REPOS, slug || '');
    if (!dir.startsWith(REPOS + path.sep) || !G.isRepo(dir)) throw Object.assign(new Error('仓库不存在'), { status: 404 });
    return dir;
  };
  const checkRef = ref => { if (!/^[\w.\-/]+$/.test(ref || '')) throw Object.assign(new Error('分支名不合法'), { status: 400 }); return ref; };
  const docPath = rel => {
    const f = path.resolve(DOCS, rel || '');
    if (!f.startsWith(DOCS + path.sep) || !f.endsWith('.md')) throw Object.assign(new Error('文档路径不合法'), { status: 400 });
    return f;
  };

  const git = {
    repos,
    log: (slug, ref = 'main') => G.log(checkRepo(slug), checkRef(ref)),
    tree: (slug, ref = 'main') => G.tree(checkRepo(slug), checkRef(ref)),
    file: (slug, ref, file) => ({ content: G.show(checkRepo(slug), checkRef(ref), file) }),
    commit: (slug, hash) => { if (!/^[0-9a-f]{4,40}$/.test(hash)) throw Object.assign(new Error('提交号不合法'), { status: 400 }); return G.commitDetail(checkRepo(slug), hash); },
    prs: slug => db.prepare('SELECT * FROM pull_requests WHERE repo=? ORDER BY id DESC').all(slug),
  };
  const docs = {
    tree: () => G.tree(DOCS, 'main'),
    file: rel => ({ path: rel, content: fs.readFileSync(docPath(rel), 'utf8'), history: G.log(DOCS, 'main', rel) }),
    version: (rel, hash) => { docPath(rel); if (!/^[0-9a-f]{4,40}$/.test(hash)) throw Object.assign(new Error('版本号不合法'), { status: 400 }); return { content: G.show(DOCS, hash, rel) }; },
    save: ({ path: rel, content, message }) => { docPath(rel); const c = docCommit(rel, content, BOSS, message || `老板修改：${rel}`); return { ok: true, hash: c.hash }; },
  };

  function databases() {
    const list = [{ name: 'company', label: '公司数据库（事务记录）' }];
    for (const f of fs.readdirSync(BIZ).filter(f => f.endsWith('.db'))) list.push({ name: f, label: `业务库：${f.replace(/\.db$/, '')}` });
    return list;
  }
  function dbFile(name) {
    if (name === 'company') return path.join(dataDir, 'company.db');
    const f = path.resolve(BIZ, name || '');
    if (!f.startsWith(BIZ + path.sep) || !fs.existsSync(f)) throw Object.assign(new Error('数据库不存在'), { status: 404 });
    return f;
  }
  function query(name, sql) {
    const s = String(sql || '').trim().replace(/;+\s*$/, '');
    if (!/^(select|with|pragma)\b/i.test(s) || s.includes(';')) throw Object.assign(new Error('这里只能执行一条只读查询（SELECT / WITH / PRAGMA）'), { status: 400 });
    const conn = new DatabaseSync(dbFile(name), { readOnly: true });
    try {
      const rows = conn.prepare(s).all().slice(0, 500);
      return { columns: rows[0] ? Object.keys(rows[0]) : [], rows };
    } finally { conn.close(); }
  }
  const tables = name => query(name, "SELECT name, (SELECT COUNT(*) FROM pragma_table_info(m.name)) AS columns FROM sqlite_master m WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").rows;

  const RECORDS = {
    orders: 'SELECT id AS 编号, title AS 订单, status AS 状态, assignee AS 负责人, mode AS 方式, created_at AS 创建时间, updated_at AS 更新时间 FROM orders ORDER BY created_at DESC',
    roles: `SELECT p.name AS 项目, r.idx+1 AS 序号, r.name AS 分工, e.name AS 负责人, r.kind AS 类型, r.status AS 状态, printf('¥%.2f', r.cost) AS 花费, r.finished_at AS 完成时间
            FROM roles r JOIN projects p ON p.id=r.project_id LEFT JOIN employees e ON e.id=r.who ORDER BY r.project_id DESC, r.idx`,
    projects: "SELECT id AS 编号, name AS 项目, status AS 状态, stars AS 评分, reworks AS 返工, printf('¥%.2f', cost) AS 花费, tag AS 版本, created_at AS 立项, finished_at AS 验收 FROM projects ORDER BY id DESC",
    approvals: "SELECT at AS 时间, CASE kind WHEN 'choice' THEN '分歧裁决' ELSE '审批' END AS 类型, task AS 事项, title AS 内容, decision AS 你的决定, CASE auto WHEN 1 THEN '自动' ELSE '' END AS 方式 FROM approvals ORDER BY id DESC",
    deliverables: "SELECT at AS 时间, title AS 交付物, people AS 负责人, mode AS 方式, stars AS 评分, reworks AS 返工, printf('¥%.2f', cost) AS 花费, doc_path AS 文档 FROM deliverables ORDER BY id DESC",
    reviews: 'SELECT at AS 时间, subject AS 对象, reason AS 打回原因, people AS 相关员工 FROM reviews ORDER BY id DESC',
    meetings: 'SELECT at AS 时间, topic AS 议题, attendees AS 参会, decision AS 决定, doc_path AS 纪要 FROM meetings ORDER BY id DESC',
    ledger: `SELECT e.name AS 员工, CASE l.source WHEN 'api' THEN '真实模型调用' ELSE '办公室模拟' END AS 来源, COUNT(*) AS 次数, SUM(l.tokens) AS token, printf('¥%.2f', SUM(l.cost)) AS 花费
             FROM ledger l LEFT JOIN employees e ON e.id=l.employee GROUP BY l.employee, l.source ORDER BY l.source, SUM(l.cost) DESC`,
    ledger_detail: `SELECT l.at AS 时间, e.name AS 员工, CASE l.source WHEN 'api' THEN '真实' ELSE '模拟' END AS 来源, l.model AS 模型, l.task AS 事项, l.tokens AS token, printf('¥%.4f', l.cost) AS 花费
                    FROM ledger l LEFT JOIN employees e ON e.id=l.employee ORDER BY l.id DESC LIMIT 300`,
    model_calls: `SELECT l.at AS 时间, e.name AS 员工, l.model AS 模型, l.task AS 分工, l.tokens AS token, printf('¥%.4f', l.cost) AS 花费
                  FROM ledger l LEFT JOIN employees e ON e.id=l.employee WHERE l.source='api' ORDER BY l.id DESC`,
    employees: "SELECT name AS 员工, model AS 模型, level AS 等级, xp AS 经验, speed AS 速度, memory AS 记忆力, printf('%d%%', stamina) AS 精力, printf('¥%.2f', spent) AS 累计花费, prefs AS 记住的偏好, hired_at AS 入职 FROM employees ORDER BY hired_at",
    activity: 'SELECT at AS 时间, game_time AS 游戏时间, actor AS 员工, kind AS 类型, text AS 内容 FROM activity ORDER BY id DESC LIMIT 400',
    prs: 'SELECT id AS 编号, repo AS 仓库, title AS 合并请求, branch AS 分支, author AS 作者, reviewer AS 审查人, status AS 状态, created_at AS 创建, merged_at AS 合并 FROM pull_requests ORDER BY id DESC',
  };
  function records(type) {
    if (!RECORDS[type]) throw Object.assign(new Error('没有这类记录'), { status: 404 });
    const rows = db.prepare(RECORDS[type]).all();
    return { columns: rows[0] ? Object.keys(rows[0]) : [], rows };
  }
  function summary() {
    const n = sql => db.prepare(sql).get().n;
    return {
      employees: n('SELECT COUNT(*) n FROM employees'), projects: n('SELECT COUNT(*) n FROM projects'),
      repos: repos().length, commits: repos().reduce((s, r) => s + G.log(repoDir(r.slug), 'main').length, 0),
      docs: G.tree(DOCS).length, open_prs: n("SELECT COUNT(*) n FROM pull_requests WHERE status='open'"),
      approvals: n('SELECT COUNT(*) n FROM approvals'), deliverables: n('SELECT COUNT(*) n FROM deliverables'),
      spent: db.prepare('SELECT COALESCE(SUM(cost),0) n FROM ledger').get().n,
      api_spent: db.prepare("SELECT COALESCE(SUM(cost),0) n FROM ledger WHERE source='api'").get().n,
    };
  }

  return { syncEmployees, addOrder, updateOrder, orderPlan, orderDeliver, setOrder, events, approval, review, deliverable, meeting, launchProject, roleStarted, roleDone, projectReview,
    state, git, docs, databases, tables, query, records, summary, models: writer.status };
}

module.exports = { createCompany };
