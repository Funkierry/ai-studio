'use strict';
// AI 工作室 local server: serves the office and the company systems, and records everything that happens.
// Run: node server.js  →  http://localhost:5300
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
// API keys and model choices live in .env next to this file (see .env.example); load them before the model clients read them
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
// --fake-llm: canned model output, for testing the pipeline without spending money
if (process.argv.includes('--fake-llm')) process.env.STUDIO_FAKE_LLM = '1';
const { createCompany } = require('./lib/company');

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const PORT = +(arg('port') || process.env.PORT) || 5300;
const DATA = path.resolve(arg('data') || process.env.STUDIO_DATA || path.join(__dirname, 'data'));
const PUBLIC = path.join(__dirname, 'public');
const co = createCompany(DATA);

const routes = [];
const on = (method, pattern, fn) => routes.push({ method, fn, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`) });

on('GET', '/api/state', () => co.state());
on('GET', '/api/summary', () => co.summary());
on('GET', '/api/models', () => co.models());
on('POST', '/api/employees/sync', b => co.syncEmployees(b));
on('POST', '/api/orders', b => co.addOrder(b));
on('POST', '/api/orders/:id/update', (b, p) => co.updateOrder(p.id, b));
on('POST', '/api/orders/:id/plan', (b, p) => co.orderPlan(p.id, b));
on('POST', '/api/orders/:id/deliver', (b, p) => co.orderDeliver(p.id, b));
on('POST', '/api/orders/:id', (b, p) => co.setOrder(p.id, b));
on('POST', '/api/events', b => co.events(b));
on('POST', '/api/approvals', b => co.approval(b));
on('POST', '/api/reviews', b => co.review(b));
on('POST', '/api/deliverables', b => co.deliverable(b));
on('POST', '/api/meetings', b => co.meeting(b));
on('POST', '/api/projects', b => co.launchProject(b));
on('POST', '/api/projects/:id/roles/:idx/start', (b, p) => co.roleStarted(+p.id, +p.idx));
on('POST', '/api/projects/:id/roles/:idx/done', (b, p) => co.roleDone(+p.id, +p.idx, b));
on('POST', '/api/projects/:id/review', (b, p) => co.projectReview(+p.id, b));

on('GET', '/api/git/repos', () => co.git.repos());
on('GET', '/api/git/log', (b, p, q) => co.git.log(q.get('repo'), q.get('ref') || 'main'));
on('GET', '/api/git/tree', (b, p, q) => co.git.tree(q.get('repo'), q.get('ref') || 'main'));
on('GET', '/api/git/file', (b, p, q) => co.git.file(q.get('repo'), q.get('ref') || 'main', q.get('path')));
on('GET', '/api/git/commit', (b, p, q) => co.git.commit(q.get('repo'), q.get('hash')));
on('GET', '/api/git/prs', (b, p, q) => co.git.prs(q.get('repo')));
on('GET', '/api/docs/tree', () => co.docs.tree());
on('GET', '/api/docs/file', (b, p, q) => co.docs.file(q.get('path')));
on('GET', '/api/docs/version', (b, p, q) => co.docs.version(q.get('path'), q.get('hash')));
on('POST', '/api/docs/file', b => co.docs.save(b));
on('GET', '/api/db/list', () => co.databases());
on('GET', '/api/db/tables', (b, p, q) => co.tables(q.get('db')));
on('GET', '/api/db/query', (b, p, q) => co.query(q.get('db'), q.get('sql')));
on('GET', '/api/records/:type', (b, p) => co.records(p.type));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 5e6) reject(Object.assign(new Error('请求太大'), { status: 413 })); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(Object.assign(new Error('请求不是合法的 JSON'), { status: 400 })); } });
  });
}
const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) {
    const r = routes.find(x => x.method === req.method && x.re.test(pathname));
    if (!r) return send(res, 404, { error: '没有这个接口' });
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      return send(res, 200, await r.fn(body, pathname.match(r.re).groups || {}, url.searchParams));
    } catch (e) {
      if (!e.status) console.error(e);
      return send(res, e.status || 500, { error: e.message });
    }
  }
  const file = path.resolve(PUBLIC, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`AI 工作室已启动：http://localhost:${PORT}`);
  console.log(`公司数据目录：${DATA}`);
});
