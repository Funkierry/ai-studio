// Small helpers every part of the workspace uses: safe text, times, the server, and button feedback.
import { LABELS } from './model.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const enc = encodeURIComponent;
export const badge = s => `<span class="ws-state ${esc(s)}">${esc(LABELS[s] || s)}</span>`;
// the server stores UTC; everything on screen is local time
const when = s => new Date(String(s).replace(' ', 'T') + 'Z');
export const clock = s => when(s).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const hourMinute = s => when(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const lasted = (a, b) => { const sec = Math.max(0, Math.round((when(b) - when(a)) / 1000)); return sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`; };

export async function api(url, body) {
  const res = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

export const calm = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: true };
// a panel the boss just asked for arrives with a short slide; background refreshes never call this
export function enter(el, distance = 6) {
  if (calm.matches || !el?.animate) return;
  el.animate([{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: 'none' }], { duration: 170, easing: 'cubic-bezier(.2,.8,.3,1)' });
}
// Pressing a button shows at once that it registered. The spinner only appears if the answer takes a moment,
// so quick actions don't flicker.
export function pending(button) {
  button.disabled = true; button.dataset.pending = '';
  const slow = setTimeout(() => button.classList.add('ws-loading'), 160);
  return () => { clearTimeout(slow); delete button.dataset.pending; button.classList.remove('ws-loading'); button.disabled = false; };
}
export const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
