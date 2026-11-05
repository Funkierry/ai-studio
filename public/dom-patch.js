// Updates a panel in place instead of replacing it, so a refresh never swallows
// a click that is halfway down, moves the caret, resets a scroll or reloads a preview.
const keyOf = n => n.nodeType === 1 ? n.dataset.select || n.dataset.role || n.id || null : null;
const kept = n => n.nodeType === 1 && n.hasAttribute('data-keep');
const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

function syncAttributes(from, to) {
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
}
function syncNode(from, to) {
  if (from.nodeType !== 1) { if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return; }
  if (from.hasAttribute('data-pending')) return; // a button waiting on the server stays as it is until the answer arrives
  syncAttributes(from, to);
  if (from.nodeName !== 'TEXTAREA') syncChildren(from, to); // what is typed in a box belongs to the person typing
}
function syncChildren(parent, next) {
  const keyed = new Map();
  for (const n of parent.childNodes) { const key = keyOf(n); if (key) keyed.set(key, n); }
  const used = new Set();
  let at = parent.firstChild;
  for (const child of [...next.childNodes]) {
    while (at && (used.has(at) || kept(at))) at = at.nextSibling;
    const key = keyOf(child);
    let match = key ? keyed.get(key) : null;
    if (match && (!sameKind(match, child) || used.has(match))) match = null;
    if (!key) {
      let n = at;
      while (n && (used.has(n) || kept(n) || keyOf(n) || !sameKind(n, child))) n = n.nextSibling;
      match = n;
    }
    if (match) {
      syncNode(match, child);
      if (match !== at) parent.insertBefore(match, at); // moved only when the order really changed, so focus stays put
      used.add(match);
    } else {
      parent.insertBefore(child, at);
      used.add(child);
    }
  }
  for (const n of [...parent.childNodes]) if (!used.has(n) && !kept(n)) n.remove();
}
export function patch(element, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  syncChildren(element, template.content);
}
