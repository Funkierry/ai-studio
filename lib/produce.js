'use strict';
// What each kind of role actually hands over: documents for the doc library, code for the project repo.
// Until a real model is connected, contents come from these templates; the files, commits and tables are real.

const KINDS = [
  ['frontend', /前端|页面代码|界面实现/],
  ['backend', /后端|接口|服务端|数据库/],
  ['test', /测试|验收|回归/],
  ['code', /开发|代码|实现|修复|编程/],
  ['design', /设计|线框|原型|视觉/],
  ['prd', /需求|PRD/i],
];
function kindOf(role) {
  const s = `${role.name} ${role.output || ''}`;
  for (const [k, rx] of KINDS) if (rx.test(s)) return k;
  return 'doc';
}
const CODE_KINDS = new Set(['frontend', 'backend', 'code', 'test']);
const isFood = p => /餐|菜|饭|咖啡|奶茶|外卖|食/.test(`${p.name}${p.goal}`);
const noun = p => (isFood(p) ? '菜品' : '商品');

function seedRows(p) {
  return isFood(p)
    ? [['宫保鸡丁', 3200, '热菜'], ['鱼香肉丝', 2800, '热菜'], ['麻婆豆腐', 2200, '热菜'], ['拍黄瓜', 1200, '凉菜'], ['酸梅汤', 800, '饮品'], ['米饭', 200, '主食']]
    : [['基础版', 9900, '套餐'], ['专业版', 29900, '套餐'], ['企业版', 99900, '套餐'], ['上手培训', 19900, '服务']];
}
const sqlStr = s => `'${String(s).replace(/'/g, "''")}'`;

/* ---------------- documents ---------------- */
function header(c) {
  const L = [`# ${c.role.output || c.role.name}`, '',
    `> 项目：${c.project.name}　分工：${c.role.name}　负责人：${c.author.name}（${c.author.model}）　日期：${c.date}`,
    '> 正文由模板生成；接入真实 AI 后，这里会是员工实际写的内容。', '',
    '## 项目目标', '', c.project.goal || '（未填写）', '',
    '## 我的分工', '', c.role.description || c.role.name, ''];
  if (c.upstream.length) {
    L.push('## 依据的上游交付', '');
    for (const u of c.upstream) L.push(`- ${u.output || u.name}（${u.who}）${u.doc ? `：[${u.doc.split('/').pop()}](${u.doc.split('/').pop()})` : ''}${u.branch ? `，代码在分支 \`${u.branch}\`` : ''}`);
    L.push('');
  }
  return L;
}
function footer(c) {
  const L = [];
  if (c.decisions.length) { L.push('## 过程中老板的决定', ''); for (const d of c.decisions) L.push(`- ${d}`); L.push(''); }
  if (c.transcript.length) { L.push('## 工作记录', ''); for (const t of c.transcript) L.push(`- ${t}`); L.push(''); }
  return L;
}

function prdBody(c) {
  const n = noun(c.project), food = isFood(c.project);
  return ['## 用户与场景', '',
    '| 角色 | 场景 | 想要的结果 |', '|---|---|---|',
    food ? '| 顾客 | 扫码打开菜单 | 快速点到想吃的菜 |' : '| 用户 | 浏览列表 | 找到需要的商品 |',
    food ? '| 后厨 | 查看新订单 | 及时出餐、更新状态 |' : '| 运营 | 查看新订单 | 及时处理、更新状态 |', '',
    '## 功能清单', '', '| 编号 | 功能 | 优先级 |', '|---|---|---|',
    `| F1 | 按分类浏览${n} | P0 |`, '| F2 | 加入购物车、修改数量 | P0 |', '| F3 | 提交订单 | P0 |',
    '| F4 | 查看订单状态 | P1 |', `| F5 | ${food ? '后厨' : '运营'}查看并更新订单状态 | P1 |`, '',
    '## 页面清单', '', `1. ${n}列表页`, '2. 购物车', '3. 订单状态页', '',
    '## 边界情况', '', `- ${n}售罄时不能下单`, '- 提交失败要提示并允许重试', '- 重复提交要能识别', '',
    '## 待确认的问题', '', '- 第一版是否需要在线支付（建议先做到店支付）', ''];
}
function designBody(c) {
  const n = noun(c.project);
  return ['## 页面线框', '', `### 1. ${n}列表页`, '', '```',
    '┌──────────────────────────┐', `│  ${c.project.name.slice(0, 10).padEnd(10, '　')}      [购物车 2] │`, '├──────────────────────────┤',
    '│ [分类A] [分类B] [分类C]   │', `│ ${n}名称          ¥32  [+] │`, `│ ${n}名称          ¥28  [+] │`, '└──────────────────────────┘', '```', '',
    '### 2. 购物车', '', '```', '┌──────────────────────────┐', `│ ${n}名称   x2   ¥64   [-][+] │`, '│ 合计 ¥64        [提交订单] │', '└──────────────────────────┘', '```', '',
    '### 3. 订单状态页', '', '```', '┌──────────────────────────┐', '│ 订单 #12   状态：制作中     │', '│ ● 已下单 ● 制作中 ○ 已完成 │', '└──────────────────────────┘', '```', '',
    '## 交互说明', '', '- 点 [+] 直接加入购物车，右上角数字跟着变', '- 提交后跳到订单状态页，每 5 秒刷新一次状态', ''];
}
function docBody() {
  return ['## 结论', '', '- （接入 AI 后由负责人根据上游材料写出结论）', '',
    '## 主要内容', '', '- （待填写）', '', '## 依据与来源', '', '- （待填写）', '', '## 下一步', '', '- （待填写）', ''];
}
function codeDocBody(c) {
  const L = ['## 交付位置', '', `- 代码库：\`${c.repo}\``, `- 分支：\`${c.branch}\`，提交 \`${c.hash}\``];
  if (c.pr) L.push(`- 合并请求：#${c.pr.id}「${c.pr.title}」，审查人：${c.pr.reviewer}`);
  L.push('', '## 改动的文件', '', ...c.files.map(f => `- \`${f}\``), '');
  return L;
}
// real results of the test run, shared by the template and the model-written report
function testResults(c) {
  const t = c.testRun;
  const out = t.output.trim();
  return ['## 自动化测试结果（实际运行）', '', `通过 ${t.pass} 项，失败 ${t.fail} 项${t.skipped ? `，跳过 ${t.skipped} 项` : ''}。`, '',
    '```', out.length > 12000 ? `${out.slice(0, 12000)}\n…（输出过长，完整内容可在仓库里重新运行 node --test 查看）` : out, '```', '',
    '## 集成情况', '', ...(c.merges.length ? c.merges.map(m => m.type === 'conflict' ? `- #${m.pr}「${m.title}」合并冲突，没有合并` : `- 已合并 #${m.pr}「${m.title}」→ main（${m.hash}）`) : ['- 没有待合并的代码']), '',
    '## 结论', '', t.fail || !t.pass ? '- 测试没有全部通过，需要修复后再交付。' : '- 用例全部通过，可以交给老板验收。', ''];
}
function testBody(c) {
  return ['## 测试范围', '', '- 数据表能正常建立，示例数据能导入', '- 下单会写入订单和订单明细', '- 前端页面存在并引用了脚本', '', ...testResults(c)];
}

/* ---------------- code ---------------- */
function backendFiles(c) {
  const p = c.project, rows = seedRows(p);
  const schema = `-- ${p.name}：数据表（${c.author.name} 编写）
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  category TEXT,
  available INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  table_no TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL
);
`;
  const seed = `-- 示例${noun(p)}
INSERT INTO items (name, price_cents, category) VALUES
${rows.map(r => `  (${sqlStr(r[0])}, ${r[1]}, ${sqlStr(r[2])})`).join(',\n')};
`;
  const server = `// ${p.name} 后端服务（${c.author.name} 编写）
// 运行：node server/index.js，然后打开 http://localhost:4000
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const db = new DatabaseSync(process.env.DB_FILE || path.join(ROOT, 'data.db'));
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
if (!db.prepare('SELECT COUNT(*) AS n FROM items').get().n) db.exec(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));

const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
const readBody = req => new Promise(resolve => {
  let s = ''; req.on('data', c => (s += c));
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
});

function placeOrder({ table, items }) {
  if (!Array.isArray(items) || !items.length) return { error: '购物车是空的' };
  const price = db.prepare('SELECT price_cents, available FROM items WHERE id = ?');
  let total = 0;
  for (const it of items) {
    const p = price.get(it.id);
    if (!p || !p.available) return { error: \`没有这个${noun(p)}或已售罄：\${it.id}\` };
    total += p.price_cents * it.qty;
  }
  const o = db.prepare('INSERT INTO orders (table_no, total_cents) VALUES (?, ?)').run(String(table || ''), total);
  const add = db.prepare('INSERT INTO order_items (order_id, item_id, qty) VALUES (?, ?, ?)');
  for (const it of items) add.run(o.lastInsertRowid, it.id, it.qty);
  return { id: Number(o.lastInsertRowid), total_cents: total, status: 'new' };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/items') return send(res, 200, db.prepare('SELECT * FROM items WHERE available = 1').all());
  if (req.method === 'GET' && url.pathname === '/api/orders') return send(res, 200, db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 50').all());
  if (req.method === 'POST' && url.pathname === '/api/orders') {
    const r = placeOrder(await readBody(req));
    return send(res, r.error ? 400 : 201, r);
  }
  const m = url.pathname.match(/^\\/api\\/orders\\/(\\d+)$/);
  if (m && req.method === 'GET') {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(m[1]);
    return o ? send(res, 200, o) : send(res, 404, { error: '订单不存在' });
  }
  if (m && req.method === 'PATCH') {
    const b = await readBody(req);
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(String(b.status), m[1]);
    return send(res, 200, { ok: true });
  }
  // 前端页面在 web/ 目录
  const web = path.join(ROOT, 'web');
  const file = path.join(web, url.pathname === '/' ? 'index.html' : url.pathname);
  if (file.startsWith(web) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
    return fs.createReadStream(file).pipe(res);
  }
  send(res, 404, { error: 'not found' });
});

if (require.main === module) {
  const port = process.env.PORT || 4000;
  server.listen(port, () => console.log(\`已启动：http://localhost:\${port}\`));
}
module.exports = { server, db, placeOrder };
`;
  const api = `# 接口文档

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/items | ${noun(p)}列表（只含在售） |
| POST | /api/orders | 下单，body：\`{ "table": "A3", "items": [{ "id": 1, "qty": 2 }] }\` |
| GET | /api/orders/:id | 查询订单 |
| PATCH | /api/orders/:id | 更新状态，body：\`{ "status": "cooking" }\` |
| GET | /api/orders | 最近 50 个订单 |

金额单位都是「分」。
`;
  return { 'server/schema.sql': schema, 'server/seed.sql': seed, 'server/index.js': server, 'docs/API.md': api };
}

function frontendFiles(c) {
  const p = c.project, n = noun(p);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.name}</title>
<style>
  body { font-family: system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; background: #f6f4ef; color: #222; }
  header { padding: 16px; background: #222; color: #fff; display: flex; justify-content: space-between; }
  main { padding: 16px; max-width: 640px; margin: 0 auto; }
  .item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #ddd; }
  button { font: inherit; padding: 6px 12px; cursor: pointer; }
  #cart { margin-top: 20px; padding: 12px; background: #fff; }
  .muted { color: #777; font-size: 13px; }
</style>
</head>
<body>
<header><strong>${p.name}</strong><span id="count">购物车 0</span></header>
<main>
  <p class="muted">桌号 <input id="table" value="A1" size="4"></p>
  <div id="list">加载中…</div>
  <section id="cart"><h3>购物车</h3><div id="lines" class="muted">还没有${n}</div><p id="total"></p><button id="submit">提交订单</button><p id="status" class="muted"></p></section>
</main>
<script src="app.js"></script>
</body>
</html>
`;
  const js = `// ${p.name} 前端（${c.author.name} 编写），接口见 docs/API.md
const cart = new Map();
let items = [];
const yuan = c => '¥' + (c / 100).toFixed(2);

async function load() {
  items = await (await fetch('/api/items')).json();
  const list = document.getElementById('list');
  list.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = \`<span>\${it.name} <span class="muted">\${it.category || ''}</span></span><span>\${yuan(it.price_cents)} <button>+</button></span>\`;
    row.querySelector('button').onclick = () => { cart.set(it.id, (cart.get(it.id) || 0) + 1); render(); };
    list.appendChild(row);
  }
}

function render() {
  let total = 0, count = 0;
  const lines = [...cart].map(([id, qty]) => {
    const it = items.find(x => x.id === id);
    total += it.price_cents * qty; count += qty;
    return \`\${it.name} × \${qty}\`;
  });
  document.getElementById('lines').textContent = lines.join('，') || '还没有${n}';
  document.getElementById('total').textContent = total ? '合计 ' + yuan(total) : '';
  document.getElementById('count').textContent = '购物车 ' + count;
}

document.getElementById('submit').onclick = async () => {
  const body = { table: document.getElementById('table').value, items: [...cart].map(([id, qty]) => ({ id, qty })) };
  const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  const status = document.getElementById('status');
  if (!res.ok) { status.textContent = data.error; return; }
  cart.clear(); render();
  status.textContent = \`已下单，订单 #\${data.id}，合计 \${yuan(data.total_cents)}\`;
};

load();
`;
  return { 'web/index.html': html, 'web/app.js': js };
}

function genericCodeFiles(c) {
  const dir = `src/role-${c.role.idx + 1}`;
  return {
    [`${dir}/README.md`]: `# ${c.role.name}\n\n${c.role.description || ''}\n\n交付物：${c.role.output || '—'}\n`,
    [`${dir}/index.js`]: `// ${c.role.name}（${c.author.name} 编写）\n// ${c.role.description || ''}\nmodule.exports = {};\n`,
  };
}

function testFiles() {
  return {
    'tests/api.test.js': `// 自动化测试：用 node --test tests/api.test.js 运行
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const has = f => fs.existsSync(path.join(ROOT, f));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('server/schema.sql'));
  db.exec(read('server/seed.sql'));
  return db;
}

test('数据表能建立，示例数据能导入', { skip: !has('server/schema.sql') && '还没有后端代码' }, () => {
  const db = freshDb();
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM items').get().n > 0);
});

test('下单会写入订单和明细', { skip: !has('server/schema.sql') && '还没有后端代码' }, () => {
  const db = freshDb();
  const item = db.prepare('SELECT * FROM items LIMIT 1').get();
  const o = db.prepare('INSERT INTO orders (table_no, total_cents) VALUES (?, ?)').run('A1', item.price_cents * 2);
  db.prepare('INSERT INTO order_items (order_id, item_id, qty) VALUES (?, ?, ?)').run(o.lastInsertRowid, item.id, 2);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?').get(o.lastInsertRowid).n, 1);
});

test('前端页面存在并引用了 app.js', { skip: !has('web/index.html') && '还没有前端代码' }, () => {
  assert.match(read('web/index.html'), /app\\.js/);
});
`,
  };
}

function codeFiles(kind, c) {
  if (kind === 'backend') return backendFiles(c);
  if (kind === 'frontend') return frontendFiles(c);
  if (kind === 'test') return testFiles(c);
  return genericCodeFiles(c);
}

function roleDoc(kind, c) {
  let body;
  if (kind === 'prd') body = prdBody(c);
  else if (kind === 'design') body = designBody(c);
  else if (kind === 'test') body = testBody(c);
  else if (CODE_KINDS.has(kind)) body = codeDocBody(c);
  else body = docBody(c);
  return [...header(c), ...body, ...footer(c)].join('\n');
}

// a deliverable the employee's model actually wrote
function llmDoc(kind, c, gen) {
  const m = gen.meta, d = gen.data;
  const L = [`# ${c.role.output || c.role.name}`, '',
    `> 项目：${c.project.name}　分工：${c.role.name}　负责人：${c.author.name}（${c.author.model}）　日期：${c.date}`,
    `> 由 ${m.model} 撰写：输入 ${m.input_tokens} / 输出 ${m.output_tokens} token${m.cny != null ? `，约 ¥${m.cny.toFixed(2)}` : ''}，用时 ${Math.round(m.ms / 1000)} 秒`, '',
    `**摘要**：${d.summary}`, ''];
  if (c.upstream.length) {
    L.push('**依据**：', '');
    for (const u of c.upstream) L.push(`- ${u.output || u.name}（${u.who}）${u.doc ? `：[${u.doc.split('/').pop()}](${u.doc.split('/').pop()})` : ''}`);
    L.push('');
  }
  if (CODE_KINDS.has(kind)) {
    L.push(d.notes || '', '', ...codeDocBody(c));
    if (kind === 'test') L.push(...testResults(c));
  } else {
    // the doc already has its title; drop a second one the model may have written
    L.push(String(d.document).replace(/^\s*# [^\n]*\n+/, ''), '');
  }
  if (d.open_questions?.length) L.push('## 待老板确认', '', ...d.open_questions.map(q => `- ${q}`), '');
  if (c.decisions.length) L.push('## 过程中老板的决定', '', ...c.decisions.map(x => `- ${x}`), '');
  return L.join('\n');
}

function repoReadme(project, roles, people) {
  return [`# ${project.name}`, '', project.goal || '', '', '## 分工', '', '| # | 分工 | 负责人 | 交付物 |', '|---|---|---|---|',
    ...roles.map(r => `| ${r.idx + 1} | ${r.name} | ${people[r.who] || r.who} | ${r.output || '—'} |`), '',
    '## 运行', '', '后端完成后：`node server/index.js`，然后打开 http://localhost:4000', ''].join('\n');
}

module.exports = { kindOf, CODE_KINDS, codeFiles, roleDoc, llmDoc, repoReadme, seedRows, sqlStr, noun };
