// A small Markdown reader for delivered documents: headings, lists, tables, code, quotes, bold, links.
// Everything is escaped first, so whatever a model wrote can only ever become text and these few tags.
import { esc } from './format.js';

function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => /^https?:\/\//.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>` : text);
}
export function markdown(src) {
  const L = String(src || '').replace(/\r/g, '').split('\n'), out = [];
  let i = 0;
  while (i < L.length) {
    const l = L[i];
    const fence = l.match(/^\s*(`{3,})/);
    if (fence) {
      const buf = []; i++;
      while (i < L.length && !L[i].trimStart().startsWith(fence[1])) buf.push(L[i++]);
      i++; out.push(`<pre>${esc(buf.join('\n'))}</pre>`); continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { const n = Math.min(h[1].length + 1, 5); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (l.startsWith('|')) {
      const rows = []; while (i < L.length && L[i].startsWith('|')) rows.push(L[i++]);
      const cells = r => r.replace(/^\||\|\s*$/g, '').split('|').map(c => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^\|?[\s:|-]+\|?$/.test(r)));
      out.push(`<div class="md-table"><table>${body.map((r, k) => `<tr>${cells(r).map(c => k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('')}</tr>`).join('')}</table></div>`); continue;
    }
    if (/^\s*[-*]\s/.test(l)) { const buf = []; while (i < L.length && /^\s*[-*]\s/.test(L[i])) buf.push(L[i++].replace(/^\s*[-*]\s/, '')); out.push(`<ul>${buf.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`); continue; }
    if (/^\s*\d+[.、]\s*/.test(l)) { const buf = []; while (i < L.length && /^\s*\d+[.、]\s*/.test(L[i])) buf.push(L[i++].replace(/^\s*\d+[.、]\s*/, '')); out.push(`<ol>${buf.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`); continue; }
    if (l.startsWith('>')) { const buf = []; while (i < L.length && L[i].startsWith('>')) buf.push(L[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < L.length && L[i].trim() && !/^(#{1,4}\s|\||\s*`{3,}|>|\s*[-*]\s|\s*\d+[.、]\s)/.test(L[i])) buf.push(L[i++]);
    if (!buf.length) buf.push(L[i++]); // a line no rule above took must still move on
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
  }
  return out.join('');
}
