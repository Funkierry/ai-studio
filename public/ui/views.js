// The HTML of each panel, built from data. Strings only, so the page can update panels in place
// (see dom-patch.js) and nothing here needs a browser to be checked.
// Portraits are canvases, which cannot live in a string: `avatar(id)` leaves a slot that the page fills in.
import { esc, enc, badge, clock, lasted, hourMinute } from './format.js';
import { LABELS, NEED_LABELS, stagesOf, acceptanceOf, cellsOf, progress } from './model.js';

export const avatar = (id, size = 28) => `<span class="ws-avatar" data-fill="${esc(id)}" data-size="${size}"></span>`;
const strip = cells => `<span class="ws-cells" aria-hidden="true">${cells.map(s => `<i class="${esc(s)}"></i>`).join('')}</span>`;

// ---------- work list ----------
// view: { data, selected, person(id), colourOf(entry) }
export function taskRow(view, e, need) {
  const cells = e.p ? cellsOf(e.p, view.data.jobs) : [e.status];
  return `<button class="ws-task" data-select="${esc(e.id)}"${need ? ` data-go="${need.view}"${need.step != null ? ` data-step="${need.step}"` : ''}` : ''} aria-current="${e.id === view.selected}" style="--c:${view.colourOf(e)}">
    <i class="ws-dot"></i><b>${esc(e.title)}</b>${need ? `<span class="ws-need ${need.kind}">${NEED_LABELS[need.kind]}</span>` : badge(e.status)}
    <small>${esc(need ? need.why : progress(e, view.data, view.person))}</small>${strip(cells)}</button>`;
}

// ---------- deliverables ----------
export function links(result) {
  return (result?.artifacts || []).filter(a => a.type === 'doc' || a.type === 'commit').map(a => a.type === 'doc'
    ? `<a class="btn" href="/company.html#docs/${enc(a.path)}" target="_blank" rel="noopener">${/测试/.test(a.path.split('/').at(-1)) ? '测试报告' : '交付文档'} ↗</a>`
    : `<a class="btn" href="/company.html#git/${enc(a.repo)}/${enc(a.branch)}/tree" target="_blank" rel="noopener">代码文件 ↗</a><a class="btn" href="/company.html#git/${enc(a.repo)}/${enc(a.branch)}/log" target="_blank" rel="noopener">代码差异 ↗</a><button class="btn" data-preview="${esc(a.repo)}" data-ref="${esc(a.branch)}">预览页面</button>`).join('');
}

// ---------- the flow of a project: who does which share, in what order ----------
// view adds: { colour(id), step (selected share idx) }
function stepCard(view, p, r, j) {
  const state = j?.status || r.status, who = j?.employee || r.who;
  const meta = j?.status === 'running' && j.started_at ? `${clock(j.started_at)} 开始`
    : j?.started_at && j.finished_at ? `用时 ${lasted(j.started_at, j.finished_at)}` : j?.waiting ? '等上游交付' : '';
  return `<button class="ws-step ${esc(state)}" data-key="step-${r.idx}" data-step="${r.idx}" aria-pressed="${view.step === r.idx}" style="--c:${view.colour(who)}">
    ${avatar(who)}<span class="ws-step-text"><b>${esc(r.name)}</b><small>${esc(view.person(who))}${j?.attempt > 1 ? ` · 第 ${j.attempt} 次` : ''}</small></span>
    ${badge(state)}<small class="ws-step-meta">${esc(meta)}</small></button>`;
}
export function flow(view, p, jobs) {
  const columns = stagesOf(p.roles);
  return `<div class="ws-flow" role="group" aria-label="分工流程">${columns.map((column, i) => `${i ? '<i class="ws-arrow" aria-hidden="true"></i>' : ''}<div class="ws-stage">${column.map(r => stepCard(view, p, r, jobs.find(j => j.role_idx === r.idx))).join('')}</div>`).join('')}
    <i class="ws-arrow" aria-hidden="true"></i><div class="ws-stage"><div class="ws-step final ${p.status === 'done' ? 'done' : p.status === 'review' ? 'review' : 'wait'}"><span class="ws-you" aria-hidden="true">你</span><span class="ws-step-text"><b>验收</b><small>${p.status === 'done' ? `已发布${p.tag ? ` ${esc(p.tag)}` : ''}` : p.status === 'review' ? '等你验收' : '全部做完后'}</small></span></div></div></div>`;
}

// ---------- one share in detail ----------
const reviseForm = (id, label, hint) => `<details data-revise-box="${esc(id)}"><summary>${label}</summary><form data-revise="${esc(id)}"><label><span>${hint}</span><textarea name="feedback" required placeholder="例如：减号按钮没有响应，请修复并补充测试"></textarea></label><button class="btn" type="submit">提交修改并执行</button></form></details>`;
export function jobDetail(view, j, r, p) {
  const result = j.result || {}, test = result.artifacts?.find(a => a.type === 'test');
  const deps = (r?.deps || []).map(idx => p.roles.find(x => x.idx === idx)).filter(Boolean);
  const idle = !['running', 'queued'].includes(j.status);
  return `<div class="ws-stepdetail" data-key="detail-${esc(j.id)}" style="--c:${view.colour(j.employee)}">
    <div class="ws-stephead"><button class="ws-who" data-locate="${esc(j.employee)}" title="在办公室里找到 TA">${avatar(j.employee, 36)}<span><b>${esc(view.person(j.employee))}</b><small>在办公室里找到 TA</small></span></button>
      <div><h3>${esc(r?.name || '交付')}</h3><p class="muted">${[r?.output && `交付物：${esc(r.output)}`, deps.length && `依赖：${deps.map(d => `${esc(d.name)}（${esc(view.person(d.who))}）`).join('、')}`].filter(Boolean).join(' · ')}</p></div>${badge(j.status)}</div>
    ${j.waiting ? `<p class="muted">${esc(j.waiting)}</p>` : ''}
    ${j.started_at ? `<p class="muted">${j.finished_at ? `${esc(clock(j.started_at))} 开始，用时 ${esc(lasted(j.started_at, j.finished_at))}` : `${esc(clock(j.started_at))} 开始，正在执行`}${j.attempt > 1 ? ` · 第 ${j.attempt} 次` : ''}</p>` : ''}
    ${!idle && result.artifacts?.length ? '<p class="muted">以下为上一版交付，本次修改完成后更新。</p>' : ''}
    ${j.error ? `<p class="ws-error">${esc(j.error)}</p>` : ''}${result.summary ? `<p class="ws-summary">${esc(result.summary)}</p>` : ''}
    ${test ? `<div class="ws-test${test.fail || !test.pass ? ' bad' : ''}">实际测试：通过 ${test.pass} · 失败 ${test.fail} · 跳过 ${test.skipped || 0}</div>` : ''}
    <div class="ws-actions">${j.status === 'review' && j.project_id ? `<button class="btn primary" data-approve="${esc(j.id)}">确认这份分工，继续往下做</button>` : ''}${links(result)}</div>
    ${idle && (j.project_id || j.status !== 'review') ? reviseForm(j.id, j.status === 'review' ? '要求修改' : '修改 / 重试这份分工', '具体修改要求（依赖这份交付的后续步骤会重新执行）') : ''}</div>`;
}
export function roleDetail(view, r, p) {
  return `<div class="ws-stepdetail" data-key="detail-r${r.idx}" style="--c:${view.colour(r.who)}">
    <div class="ws-stephead"><button class="ws-who" data-locate="${esc(r.who)}" title="在办公室里找到 TA">${avatar(r.who, 36)}<span><b>${esc(view.person(r.who))}</b><small>在办公室里找到 TA</small></span></button>
      <div><h3>${esc(r.name)}</h3><p class="muted">${r.output ? `交付物：${esc(r.output)}` : ''}</p></div>${badge(r.status)}</div>
    <p class="muted">${esc(r.description || '')}</p><div class="ws-actions">${links({ artifacts: r.artifacts })}</div>
    <p class="muted">${p.status === 'done' || r.status === 'done' ? '已保留旧版交付' : r.status === 'gate' ? '启动项目后恢复待确认的交付' : '等待你启动项目'}</p></div>`;
}

// ---------- acceptance: what to look at, then one decision ----------
const check = c => `<li class="${c.ok === false ? 'bad' : c.ok ? 'ok' : 'note'}"><i aria-hidden="true">${c.ok === false ? '✕' : c.ok ? '✓' : '·'}</i>${esc(c.label)}${c.by ? `<small>${esc(c.by)}</small>` : ''}</li>`;
const rejectForm = (key, options, open) => `<details data-reject-box="${esc(key)}"${open ? ' open' : ''}><summary>打回修改</summary><form data-reject="${esc(key)}">
  ${options ? `<label><span>让谁改</span><select name="job">${options}</select></label>` : ''}
  <label><span>哪里不对、要改成什么样</span><textarea name="feedback" required placeholder="写具体：哪个页面、哪个按钮、期望的结果"></textarea></label>
  <button class="btn" type="submit">打回并重做</button></form></details>`;
export function acceptProject(view, p, jobs) {
  const a = acceptanceOf(p, jobs);
  const options = p.roles.map(r => { const j = jobs.find(j => j.role_idx === r.idx); return j ? `<option value="${esc(j.id)}">${esc(r.name)} · ${esc(view.person(j.employee))}</option>` : ''; }).join('');
  return `<section class="ws-accept" aria-label="验收"><h3>验收 <small>看过下面几项，再做决定</small></h3>
    <ul class="ws-checks">${a.checks.map(check).join('')}</ul>
    ${p.roles.map(r => { const html = links({ artifacts: a.deliverables.filter(d => d.role === r.name) }); return html ? `<div class="ws-deliver"><span>${esc(r.name)} · ${esc(view.person(r.who))}</span>${html}</div>` : ''; }).join('')}
    <div class="ws-decide"><div class="ws-rate"><span>评分</span><fieldset class="ws-stars" aria-label="评分">${[3, 2, 1].map(n => `<label><input type="radio" name="stars-${p.id}" value="${n}"${n === (view.stars ?? 3) ? ' checked' : ''}><span aria-hidden="true">★</span><span class="sr">${n} 星</span></label>`).join('')}</fieldset></div>
      <button class="btn primary" data-accept="${p.id}">验收通过并发布</button></div>
    ${rejectForm(`p:${p.id}`, options)}
    <p class="muted">验收时会再运行一次集成检查；通过后合并代码、打上版本标签并写入项目总结。</p></section>`;
}
export function acceptOrder(view, o, j) {
  return `<section class="ws-accept" aria-label="验收"><h3>验收 <small>看过交付，再做决定</small></h3>
    <ul class="ws-checks">${check({ ok: true, label: `${view.person(j.employee)} 已写好交付` })}</ul>
    <div class="ws-actions">${links(j.result)}</div>
    <div class="ws-decide"><button class="btn primary" data-approve="${esc(j.id)}">验收通过</button></div>
    ${rejectForm(j.id, '')}</section>`;
}

// ---------- the whole task panel ----------
export function projectPanel(view, entry, need) {
  const p = entry.p, jobs = view.data.jobs.filter(j => j.project_id === p.id);
  const role = p.roles.find(r => r.idx === view.step) || p.roles[0], job = role && jobs.find(j => j.role_idx === role.idx);
  const callout = need && need.kind !== 'accept' ? `<div class="ws-callout ${need.kind}"><span class="ws-need ${need.kind}">${NEED_LABELS[need.kind]}</span><p>${esc(need.why)}</p>${need.view === 'discussion' ? '<button class="btn primary" data-view="discussion">去项目讨论里处理</button>' : ''}</div>` : '';
  return `<div class="ws-head" style="--c:${view.colourOf(entry)}"><i class="ws-dot"></i><h2>${esc(p.name)}</h2>${badge(entry.status)}
      <div class="ws-actions">${!jobs.length && p.status !== 'done' ? `<button class="btn primary" data-start-project="${p.id}">启动这个项目</button>` : ''}
        ${jobs.length && p.status !== 'done' ? `<button class="btn" data-pause="${p.id}" data-paused="${p.status !== 'paused'}">${p.status === 'paused' ? '继续执行' : '暂停后续步骤'}</button>` : ''}
        <button class="btn" data-open-chat="${p.id}">项目讨论</button><a class="btn" href="/company.html#git/${enc(p.slug)}/main/tree" target="_blank" rel="noopener">项目代码 ↗</a></div></div>
    <p class="ws-goal">${esc(p.goal)}</p>
    ${p.status === 'paused' ? '<p class="muted">后续步骤已暂停。已经发出的模型调用会完成并保留结果。</p>' : ''}
    ${callout}${p.status === 'review' ? acceptProject(view, p, jobs) : ''}
    <h3 class="ws-section">分工流程 <small>从左到右依次进行，同一列同时做；点一份看详情</small></h3>
    ${flow(view, p, jobs)}
    ${role ? (job ? jobDetail(view, job, role, p) : roleDetail(view, role, p)) : ''}`;
}
export function orderPanel(view, entry, need, employeeOptions) {
  const o = entry.o, j = view.data.jobs.find(j => j.order_id === o.id);
  return `<div class="ws-head" style="--c:${view.colourOf(entry)}"><i class="ws-dot"></i><h2>${esc(o.title)}</h2>${badge(entry.status)}</div>
    <p class="ws-goal">${esc(o.spec?.detail || o.brief)}</p>
    ${need && need.kind !== 'accept' ? `<div class="ws-callout ${need.kind}"><span class="ws-need ${need.kind}">${NEED_LABELS[need.kind]}</span><p>${esc(need.why)}</p></div>` : ''}
    ${j?.status === 'review' ? acceptOrder(view, o, j) : ''}
    ${j ? jobDetail(view, j, { name: '交付', output: '', deps: [] }, { roles: [] })
      : `<form data-start-order="${esc(o.id)}" class="ws-startorder"><label><span>负责人</span><select name="employee">${employeeOptions}</select></label><button class="btn primary">开始执行</button></form>`}`;
}
export const emptyPanel = '<div class="ws-empty"><h2>把需求交给员工</h2><p>点右上角「＋ 新工作」，写清楚要做什么就行。</p><button class="btn primary" data-new-work>＋ 新工作</button></div>';

// ---------- project discussion ----------
const KINDS = { request: '任务', message: '消息', discussion: '讨论', question: '提问', revision: '返工要求', delivery: '交付摘要', test_result: '执行结果', release: '发布', notice: '系统记录' };
export function message(view, m) {
  const from = m.sender === 'system' ? 'system' : m.sender === 'boss' ? 'boss' : 'employee';
  const name = id => id === 'team' ? '全体' : id === 'boss' ? '你' : view.person(id);
  return `<article class="ws-message ${from}" id="message-${m.id}"${from === 'employee' ? ` style="--c:${view.colour(m.sender)}"` : ''}>
    ${from === 'employee' ? avatar(m.sender, 30) : `<span class="ws-you${from === 'system' ? ' system' : ''}" aria-hidden="true">${from === 'boss' ? '你' : '系'}</span>`}
    <div class="ws-message-body"><div class="ws-message-meta"><b>${esc(from === 'system' ? '执行系统' : name(m.sender))}</b><span>→ ${esc(name(m.recipient))}</span><small>${esc(KINDS[m.kind] || m.kind)} · ${esc(hourMinute(m.created_at))}</small></div>
    ${m.reply_to ? `<a href="#message-${m.reply_to}" class="ws-reply">回复 #${m.reply_to}</a>` : ''}<p>${esc(m.body)}</p>
    ${m.meta?.provider ? `<small class="muted">${m.meta.provider === 'fake' ? '测试替身' : esc(m.meta.model || m.meta.provider)} · 调用记录 #${m.id}</small>` : ''}${m.meta?.artifacts ? `<div class="ws-actions">${links(m.meta)}</div>` : ''}</div></article>`;
}
export function chatHeading(view, p) {
  const c = p.collaboration, failed = (p.discussion || []).filter(t => ['failed', 'interrupted'].includes(t.status));
  return `<div class="ws-head" style="--c:${view.colourOf({ p })}"><i class="ws-dot"></i><h2>${esc(p.name)}</h2>${badge(p.status)}
      <div class="ws-actions">${p.status !== 'done' ? `<button class="btn" data-pause="${p.id}" data-paused="${p.status !== 'paused'}">${p.status === 'paused' ? '继续执行' : '暂停后续步骤'}</button>` : ''}<button class="btn" data-open-task="${p.id}">分工流程</button><a class="btn" href="/company.html#chat" target="_blank" rel="noopener">搜索协作记录 ↗</a></div></div>
    <p class="muted">${c?.enabled ? `自主协作 · 已自动返工 ${c.repairs}/${c.max_repairs} 轮 · 讨论调用上限 ${c.max_turns} 次` : '协作记录 · 可向负责人提问'}${p.tag ? ` · 已发布 ${esc(p.tag)}` : ''}</p>
    ${c?.reason ? `<p class="ws-error">${esc(c.reason)}</p>` : ''}${failed.map(t => `<p class="ws-error">${esc(view.person(t.employee))}：${esc(t.error)} <button class="btn" data-retry-discussion="${t.id}">重试这次讨论</button></p>`).join('')}`;
}
export { LABELS };
