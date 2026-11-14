'use strict';
// Pages the employees built are shown from their own address, apart from the studio's, so a delivered page
// can never reach the studio's own interfaces. Two sources: a commit in a repository, or an exported folder.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function createPreview(co, outputs) {
  const text = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const binary = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon' };
  const server = http.createServer((req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) throw new Error('Method not allowed');
      const parts = new URL(req.url, 'http://localhost').pathname.split('/').slice(1).map(decodeURIComponent);
      const [repo, ref, ...segments] = parts;
      const file = segments.join('/'), ext = path.extname(file).toLowerCase();
      if (!repo || !ref || !file || segments.includes('..') || segments.some(s => s.startsWith('.'))) throw new Error('Preview file not found');
      // /out/<work>/<path>: a file from the exported folder of that piece of work
      const fromFolder = repo === 'out' && outputs;
      if (!text[ext] && !(fromFolder && binary[ext])) throw new Error('Preview file not found');
      const content = fromFolder ? fs.readFileSync(outputs.resolve(ref, file)) : co.git.file(repo, ref, file).content;
      res.writeHead(200, { 'Content-Type': text[ext] || binary[ext], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'" });
      res.end(req.method === 'HEAD' ? '' : content);
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('没有找到可预览文件'); }
  });
  server.listen(0, '127.0.0.1');
  return { server, url: () => server.address() ? `http://127.0.0.1:${server.address().port}` : null };
}
module.exports = { createPreview };
