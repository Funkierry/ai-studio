// The HTML of each part of the page, built from data. Strings only, so the page can update parts in place
// (see dom-patch.js) and nothing here needs a browser to be checked.
// Portraits are canvases, which cannot live in a string: `avatar(id)` leaves a slot that the page fills in.
import { esc, badge, clock, lasted } from './format.js';
import { LABELS, NEED_LABELS, TRAIL_KINDS, TRAIL_FILTERS, RECORD, stagesOf, acceptanceOf, cellsOf, progress, filterTrail, isLong, fileGroups, fileFor, sizeText } from './model.js';

export const avatar = (id, size = 28) => `<span class="ws-avatar" data-fill="${esc(id)}" data-size="${size}"></span>`;
const strip = cells => `<span class="ws-cells" aria-hidden="true">${cells.map(s => `<i class="${esc(s)}"></i>`).join('')}</span>`;
const num = (n, title, note = '') => `<h3 class="ws-num"><b aria-hidden="true">${n}</b>${title}${note ? `<small>${note}</small>` : ''}</h3>`;

// ---------- the list of work on the left ----------
// view: { data, selected, person(id), colourOf(entry), colour(id) }
export function railRow(view, e, need) {
  const cells = e.p ? cellsOf(e.p, view.data.jobs) : [e.status];
  return `<button class="ws-task" data-select="${esc(e.id)}" aria-current="${e.id === view.selected}" style="--c:${view.colourOf(e)}">
    <i class="ws-dot"></i><b>${esc(e.title)}</b>${need ? `<span class="ws-need ${need.kind}">${NEED_LABELS[need.kind]}</span>` : badge(e.status)}
    <small>${esc(need ? need.why : progress(e, view.data, view.person))}</small>${strip(cells)}</button>`;
}
export function rail(view, all, waiting, doneOpen) {
  const need = all.filter(e => waiting.has(e.id)), open = all.filter(e => e.status !== 'done' && !waiting.has(e.id)), finished = all.filter(e => e.status === 'done');
  const group = (title, list, cls = '') => list.length ? `<div class="ws-group ${cls}" data-key="g-${title}"><h2>${title}<span class="ws-count">${list.length}</span></h2>${list.map(e => railRow(view, e, waiting.get(e.id))).join('')}</div>` : '';
  if (!all.length) return '<p class="ws-empty">还没有工作。<br>在右边写下要做什么，就能开始。</p>';
  return group('等你处理', need, 'need') + group('进行中', open)
    + (finished.length ? `<details id="ws-done" class="ws-group"${doneOpen || finished.some(e => e.id === view.selected) ? ' open' : ''}><summary>已完成<span class="ws-count">${finished.length}</span></summary>${finished.map(e => railRow(view, e)).join('')}</details>` : '');
}

// ---------- 1 · what was asked ----------
export function head(view, entry, need, job) {
  const p = entry.p, o = entry.o, jobs = p ? view.data.jobs.filter(j => j.project_id === p.id) : [];
  const failed = (p?.discussion || []).filter(t => ['failed', 'interrupted'].includes(t.status));
  const banner = !need ? '' : `<div class="ws-callout ${need.kind}" data-key="need"><span class="ws-need ${need.kind}">等你${NEED_LABELS[need.kind]}</span><p>${esc(need.why)}</p>${
    need.kind === 'accept' ? '<span class="muted">看过右边的成品，在那里验收或打回。</span>'
    : need.kind === 'confirm' && job ? `<button class="btn primary" data-approve="${esc(job.id)}">确认，继续往下做</button><button class="btn" data-step="${need.step}">要求修改</button>`
    : need.kind === 'answer' ? `<button class="btn primary" data-reply>去回复</button>${need.step != null ? `<button class="btn" data-step="${need.step}">看出问题的分工</button>` : ''}`
    : need.step != null ? `<button class="btn primary" data-step="${need.step}">查看并处理</button>` : ''}</div>`;
  return `<div class="ws-head" style="--c:${view.colourOf(entry)}"><i class="ws-dot"></i><h2>${esc(entry.title)}</h2>${badge(entry.status)}
      <div class="ws-actions">${p && !jobs.length && p.status !== 'done' ? `<button class="btn primary" data-start-project="${p.id}">启动这个项目</button>` : ''}
        ${p && jobs.length && p.status !== 'done' ? `<button class="btn" data-pause="${p.id}" data-paused="${p.status !== 'paused'}">${p.status === 'paused' ? '继续执行' : '暂停后续步骤'}</button>` : ''}</div></div>
    <section class="ws-request">${num(1, '你的要求', esc(when(p?.created_at || o?.created_at)))}<p class="ws-goal">${esc(p ? p.goal : o.spec?.detail || o.brief)}</p></section>
    ${p?.status === 'paused' ? '<p class="muted">后续步骤已暂停。已经发出的模型调用会完成并保留结果。</p>' : ''}
    ${o && !view.data.jobs.some(j => j.order_id === o.id) ? `<form data-start-order="${esc(o.id)}" class="ws-callout ws-startorder"><p>这项工作还没有开始。选一位员工来做：</p><select name="employee" aria-label="负责人">${view.data.employees.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select><button class="btn primary" type="submit">交给 TA 开始</button></form>` : ''}
    ${banner}${failed.map(t => `<p class="ws-error">${esc(view.person(t.employee))} 的讨论没有完成：${esc(t.error)} <button class="btn" data-retry-discussion="${t.id}">重试</button></p>`).join('')}`;
}
// projects and orders are created in local time, which is what the boss expects to read
const when = s => s ? String(s).slice(5, 16).replace('-', '/') : '';
// the record arrives with full timestamps
const timeOf = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

// ---------- 2 · the flow: who does which share, in what order ----------
function stepCard(view, r, j, single) {
  // inside a project a finished share waits to be confirmed; only the whole thing is accepted
  const status = j?.status || r.status, state = status === 'review' && !single ? 'gate' : status, who = j?.employee || r.who;
  const meta = j?.status === 'running' && j.started_at ? `${clock(j.started_at)} 开始`
    : j?.started_at && j.finished_at ? `用时 ${lasted(j.started_at, j.finished_at)}` : j?.waiting ? '等上游交付' : '';
  return `<button class="ws-step ${esc(state)}" data-key="step-${r.idx}" data-step="${r.idx}" aria-pressed="${view.step === r.idx}" style="--c:${who ? view.colour(who) : 'var(--line)'}">
    ${who ? avatar(who) : '<span class="ws-you system" aria-hidden="true">?</span>'}<span class="ws-step-text"><b>${esc(r.name)}</b><small>${esc(who ? view.person(who) : '还没有负责人')}${j?.attempt > 1 ? ` · 第 ${j.attempt} 次` : ''}</small></span>
    ${badge(state)}<small class="ws-step-meta">${esc(meta)}</small></button>`;
}
export function flow(view, p, jobs) {
  const columns = stagesOf(p.roles);
  return `<div class="ws-flow" role="group" aria-label="分工流程">${columns.map((column, i) => `${i ? '<i class="ws-arrow" aria-hidden="true"></i>' : ''}<div class="ws-stage">${column.map(r => stepCard(view, r, jobs.find(j => j.role_idx === r.idx), p.single)).join('')}</div>`).join('')}
    <i class="ws-arrow" aria-hidden="true"></i><div class="ws-stage"><div class="ws-step final ${p.status === 'done' ? 'done' : p.status === 'review' ? 'review' : 'wait'}"><span class="ws-you" aria-hidden="true">你</span><span class="ws-step-text"><b>验收</b><small>${p.status === 'done' ? `已验收${p.tag ? ` ${esc(p.tag)}` : ''}` : p.status === 'review' ? '等你验收' : '全部做完后'}</small></span></div></div></div>`;
}

// one share opened: its state, and the way to send it back
const reviseForm = (id, label, hint) => `<details data-revise-box="${esc(id)}"><summary>${label}</summary><form data-revise="${esc(id)}"><label><span>${hint}</span><textarea name="feedback" required placeholder="例如：减号按钮没有响应，请修复并补充测试"></textarea></label><button class="btn" type="submit">提交修改并重做</button></form></details>`;
export function share(view, r, j, p, single) {
  const who = j?.employee || r.who, result = j?.result || {}, test = result.artifacts?.find(a => a.type === 'test');
  const deps = (r.deps || []).map(idx => p.roles.find(x => x.idx === idx)).filter(Boolean);
  const idle = j && !['running', 'queued'].includes(j.status);
  return `<div class="ws-stepdetail" data-key="share-${r.idx}" style="--c:${who ? view.colour(who) : 'var(--line)'}">
    <div class="ws-stephead">${who ? `<button class="ws-who" data-locate="${esc(who)}" title="在办公室里找到 TA">${avatar(who, 32)}<span><b>${esc(view.person(who))}</b><small>在办公室里找到 TA</small></span></button>` : ''}
      <div><h4>${esc(r.name)}</h4><p class="muted">${[r.output && `交付物：${esc(r.output)}`, deps.length && `依赖：${deps.map(d => `${esc(d.name)}（${esc(view.person(d.who))}）`).join('、')}`].filter(Boolean).join(' · ')}</p></div>
      <button class="link" data-step="${r.idx}">收起</button></div>
    ${j?.waiting && j.status === 'queued' ? `<p class="muted">${esc(j.waiting)}</p>` : ''}
    ${j?.started_at ? `<p class="muted">${j.finished_at ? `${esc(clock(j.started_at))} 开始，用时 ${esc(lasted(j.started_at, j.finished_at))}` : `${esc(clock(j.started_at))} 开始，正在执行`}${j.attempt > 1 ? ` · 第 ${j.attempt} 次` : ''}</p>` : ''}
    ${j?.error ? `<p class="ws-error">${esc(j.error)}</p>` : ''}${result.summary ? `<p class="ws-summary">${esc(result.summary)}</p>` : ''}
    ${test ? `<div class="ws-test${test.fail || !test.pass ? ' bad' : ''}">实际测试：通过 ${test.pass} · 失败 ${test.fail} · 跳过 ${test.skipped || 0}</div>` : ''}
    ${!j ? `<p class="muted">${esc(r.description || '')}</p>` : ''}
    <div class="ws-actions">${j?.status === 'review' && !single ? `<button class="btn primary" data-approve="${esc(j.id)}">确认这份分工，继续往下做</button>` : ''}</div>
    ${idle && !(single && j.status === 'review') && p.status !== 'done' ? reviseForm(j.id, j.status === 'review' ? '要求修改' : ['failed', 'interrupted'].includes(j.status) ? '修改 / 重试' : '让 TA 修改这份分工', '具体修改要求（依赖这份交付的后续步骤会重新执行）') : ''}</div>`;
}

// ---------- 2 · the record: who said and handed in what, in order ----------
const chip = (view, a) => {
  if (a.type === 'test') return `<span class="ws-chip ${a.fail || !a.pass ? 'bad' : 'ok'}">测试：通过 ${a.pass || 0} · 失败 ${a.fail || 0}</span>`;
  if (a.type === 'tag') return `<span class="ws-chip ok">版本 ${esc(a.name)}</span>`;
  const file = fileFor(view.outputs, a), label = a.type === 'doc' ? `文档 ${esc(String(file || a.path || '').split('/').at(-1))}` : `代码${a.files ? ` ${a.files} 个文件` : ''}`;
  return file ? `<button class="ws-chip" data-file="${esc(file)}">${label} →</button>` : `<span class="ws-chip">${label}</span>`;
};
const callLine = c => !c ? '' : `<div class="ws-entry-call">${[c.model && esc(c.model), c.ms != null && `${Math.round(c.ms / 1000)} 秒`, c.cost != null && `¥${Number(c.cost).toFixed(2)}`].filter(Boolean).join(' · ')}${
  c.id ? `<button class="link" data-call="${c.id}">看任务书和回复</button>` : ''}</div>`;
export function entry(view, e) {
  const from = e.from === 'system' ? 'system' : e.from === 'boss' ? 'boss' : 'employee';
  const name = id => id === 'team' ? '全体' : id === 'boss' ? '你' : id === 'system' ? '执行系统' : view.person(id);
  const long = isLong(e.body), open = view.expanded?.has(e.key);
  return `<article class="ws-entry ${from} k-${esc(e.kind)}" data-key="${esc(e.key)}"${from === 'employee' ? ` style="--c:${view.colour(e.from)}"` : ''}>
    ${from === 'employee' ? avatar(e.from, 30) : `<span class="ws-you${from === 'system' ? ' system' : ''}" aria-hidden="true">${from === 'boss' ? '你' : '系'}</span>`}
    <div class="ws-entry-body"><div class="ws-entry-meta"><b>${esc(name(e.from))}</b>${e.to && e.to !== e.from ? `<span>→ ${esc(name(e.to))}</span>` : ''}<span class="ws-kind">${esc(TRAIL_KINDS[e.kind] || e.kind)}</span><time>${esc(timeOf(e.at))}</time></div>
    ${e.body ? `<p class="ws-entry-text${long && !open ? ' clamp' : ''}">${esc(e.body)}</p>${long ? `<button class="link" data-expand="${esc(e.key)}">${open ? '收起' : '展开全文'}</button>` : ''}` : ''}
    ${e.artifacts?.length ? `<div class="ws-chips">${e.artifacts.map(a => chip(view, a)).join('')}</div>` : ''}${callLine(e.call)}</div></article>`;
}
const day = iso => new Date(iso).toLocaleDateString([], { month: 'long', day: 'numeric', weekday: 'short' });
// view adds: { filter, step, expanded, outputs }
export function trail(view, t) {
  const list = filterTrail(t.entries, view.filter, view.step);
  if (!list.length) return `<p class="ws-empty">${t.entries.length ? '这个筛选下没有记录。' : '还没有记录。'}</p>`;
  let last = '';
  return list.map(e => { const d = day(e.at), mark = d === last ? '' : `<p class="ws-day" data-key="day-${esc(d)}">${esc(d)}</p>`; last = d; return mark + entry(view, e); }).join('');
}
export function filters(view, t, stepName) {
  const n = f => filterTrail(t.entries, f, view.step).length;
  return `${TRAIL_FILTERS.map(([key, label]) => `<button data-filter="${key}" aria-pressed="${view.filter === key}">${label}<small>${n(key)}</small></button>`).join('')}${
    stepName ? `<button class="ws-only" data-step="${view.step}" title="取消，只看这份分工">只看「${esc(stepName)}」 ✕</button>` : ''}`;
}
export function running(view, t, now = Date.now()) {
  return t.running.map(c => `<div class="ws-running" data-key="run-${c.id}" style="--c:${view.colour(c.employee)}">${avatar(c.employee, 26)}<span><b>${esc(view.person(c.employee))}</b> 正在做「${esc(c.title || '任务')}」${c.attempt > 1 ? `（第 ${c.attempt} 次）` : ''}
    <small>已 ${Math.max(0, Math.round((now - new Date(c.started)) / 1000))} 秒 · 任务书 ${Number(c.prompt_chars || 0).toLocaleString()} 字</small></span><button class="link" data-call="${c.id}">看任务书</button></div>`).join('');
}

// ---------- 3 · what came out: the decision, where it is on disk, the files ----------
const check = c => `<li class="${c.ok === false ? 'bad' : c.ok ? 'ok' : 'note'}"><i aria-hidden="true">${c.ok === false ? '✕' : c.ok ? '✓' : '·'}</i>${esc(c.label)}${c.by ? `<small>${esc(c.by)}</small>` : ''}</li>`;
const rejectForm = (key, options) => `<details data-reject-box="${esc(key)}"><summary>打回修改</summary><form data-reject="${esc(key)}">
  ${options ? `<label><span>让谁改</span><select name="job">${options}</select></label>` : ''}
  <label><span>哪里不对、要改成什么样</span><textarea name="feedback" required placeholder="写具体：哪个页面、哪个按钮、期望的结果"></textarea></label>
  <button class="btn" type="submit">打回并重做</button></form></details>`;
export function acceptProject(view, p, jobs) {
  const a = acceptanceOf(p, jobs);
  const options = p.roles.map(r => { const j = jobs.find(j => j.role_idx === r.idx); return j ? `<option value="${esc(j.id)}">${esc(r.name)} · ${esc(view.person(j.employee))}</option>` : ''; }).join('');
  return `<section class="ws-accept" aria-label="验收"><h4>等你验收 <small>看过下面的文件，再做决定</small></h4>
    <ul class="ws-checks">${a.checks.map(check).join('')}</ul>
    <div class="ws-decide"><div class="ws-rate"><span>评分</span><fieldset class="ws-stars" aria-label="评分">${[3, 2, 1].map(n => `<label><input type="radio" name="stars-${p.id}" value="${n}"${n === (view.stars ?? 3) ? ' checked' : ''}><span aria-hidden="true">★</span><span class="sr">${n} 星</span></label>`).join('')}</fieldset></div>
      <button class="btn primary" data-accept="${p.id}">验收通过</button></div>
    ${rejectForm(`p:${p.id}`, options)}
    <p class="muted">通过时会再跑一次集成检查，然后合并代码、打上版本号，并把正式版保存到本地文件夹。</p></section>`;
}
export function acceptOrder(view, j) {
  return `<section class="ws-accept" aria-label="验收"><h4>等你验收 <small>看过下面的文件，再做决定</small></h4>
    <ul class="ws-checks">${check({ ok: true, label: `${view.person(j.employee)} 已交付` })}</ul>
    <div class="ws-decide"><button class="btn primary" data-approve="${esc(j.id)}">验收通过</button></div>
    ${rejectForm(j.id, '')}</section>`;
}
// view adds: { outputs, file (selected path), recordOpen }
export function files(view, entry) {
  const out = view.outputs;
  if (!out?.dir) return `<p class="ws-empty">还没有成品。<br>员工交付后，文件会出现在这里，并保存到<br><code>${esc(out?.root || view.data.outRoot || '')}</code></p>`;
  const row = f => `<button class="ws-file" data-file="${esc(f.path)}" aria-current="${f.path === view.file}"><span>${esc(f.label)}</span><small>${sizeText(f.size)}</small></button>`;
  const groups = fileGroups(out.files);
  return `<div class="ws-outbar" data-key="bar"><span class="ws-state ${out.final ? 'done' : 'review'}">${out.final ? '已验收的正式版' : entry.status === 'review' ? '待验收的版本' : '进行中的当前版本'}</span>
      <div class="ws-actions">${out.page ? `<button class="btn" data-file="${esc(out.page)}">预览页面</button>` : ''}<button class="btn primary" data-open-folder>打开文件夹</button><button class="btn" data-copy="${esc(out.dir)}">复制路径</button></div>
      <code class="ws-path" title="保存在本机的这个文件夹">${esc(out.dir)}</code></div>
    <div class="ws-files" data-key="files">${groups.map(g => g.name === RECORD
      ? `<details class="ws-filegroup" data-key="fg-${RECORD}" data-record${view.recordOpen ? ' open' : ''}><summary>${RECORD}<small>${g.files.length} 个文件 · 每次模型调用的任务书和回复</small></summary>${g.files.map(row).join('')}</details>`
      : `<div class="ws-filegroup" data-key="fg-${esc(g.name)}">${g.name ? `<h5>${esc(g.name)}<small>${g.files.length} 个文件</small></h5>` : ''}${g.files.map(row).join('')}</div>`).join('')}</div>`;
}

export const sectionTitle = num;
export { LABELS };
