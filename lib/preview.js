'use strict';
const http = require('node:http');
const path = require('node:path');

function createPreview(co) {
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) throw new Error('Method not allowed');
      const parts = new URL(req.url, 'http://localhost').pathname.split('/').slice(1).map(decodeURIComponent);
      const [repo, ref, ...segments] = parts;
      const file = segments.join('/');
      if (!repo || !ref || !file || segments.includes('..') || segments.some(s => s.startsWith('.')) || !mime[path.extname(file)]) throw new Error('Preview file not found');
      const content = co.git.file(repo, ref, file).content;
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'" });
      res.end(req.method === 'HEAD' ? '' : content);
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('没有找到可预览文件'); }
  });
  server.listen(0, '127.0.0.1');
  return { server, url: () => server.address() ? `http://127.0.0.1:${server.address().port}` : null };
}
module.exports = { createPreview };
