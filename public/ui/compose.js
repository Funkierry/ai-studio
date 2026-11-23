// Where work starts: say what you want, pick what should come out, press start.
// ctx: { data(), office, person(id), fillAvatars(el), refresh(), hire(then), select(id) }
import { esc, enc, api, pending } from './format.js';
import { defaultTeam, PLANS, planLine } from './model.js';
import { POSTS, postKey } from '../office/roster.js';
import { collaborationRoles, collaborationWorkorder } from '../collaboration-plan.js';

const remembered = () => { try { return localStorage.getItem('studio-kind'); } catch { return null; } };
const remember = kind => { try { localStorage.setItem('studio-kind', kind); } catch { /* private windows may refuse; the choice just is not kept */ } };

const ICONS = {
  doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  code: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  team: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
};
const TEMPLATES = [
  { label: '番茄钟小工具', kind: 'code', goal: '做一个简洁美观的番茄钟网页工具：\n1. 支持 25 分钟专注与 5 分钟休息倒计时，可开始、暂停、重置\n2. 记录今天完成的番茄个数并本地持久化\n3. 界面清爽，支持快捷键操作与桌面/手机自适应' },
  { label: '产品方案文档', kind: 'doc', goal: '撰写一份清晰可落地的产品方案文档：\n1. 背景与目标用户痛点\n2. 核心功能拆解与交互流程\n3. 里程碑排期与验收标准' },
  { label: '全栈任务看板', kind: 'team', goal: '开发一个轻量任务看板 Web 应用：\n1. 支持待办、进行中、已完成三列状态切换与新增/编辑/删除任务\n2. 提供后端持久化接口与完整的自动化测试\n3. 界面美观易用，包含搜索与标签筛选' },
];

export function createComposer(ctx) {
  const el = document.createElement('section');
  el.className = 'ws-panel ws-compose'; el.id = 'ws-compose';
  const first = ['doc', 'code', 'team'].includes(remembered()) ? remembered() : 'doc';
  const choice = (value, title, note) => `<label class="ws-choice"><input type="radio" name="kind" value="${value}"${value === first ? ' checked' : ''}><i class="ws-choice-ico">${ICONS[value]}</i><span><b>${title}</b><small>${note}</small></span></label>`;
  el.innerHTML = `<form>
    <div class="ws-compose-head"><div><h2>要做什么？</h2>
    <p class="muted">写清楚目标和怎样算完成。员工做好后，文件会出现在这一页，并保存到本机的文件夹里。</p></div></div>
    <div class="ws-templates"><span>快速示例</span>${TEMPLATES.map((t, i) => `<button type="button" class="ws-tpl" data-tpl="${i}">✦ ${esc(t.label)}</button>`).join('')}</div>
    <div class="ws-goal-wrap">
      <textarea name="goal" required rows="6" maxlength="20000" aria-label="要做什么" placeholder="例如：做一个番茄钟网页，能开始、暂停、重置，并记下今天完成了几个番茄。"></textarea>
      <span class="ws-goal-count" data-count></span>
    </div>
    <fieldset class="ws-choices kinds"><legend>要什么成品</legend>
      ${choice('doc', '一份文档', '一人撰写，最快')}${choice('code', '一个小程序', '一人开发，一人测试')}${choice('team', '一个完整项目', '规划、前后端、集成测试')}
    </fieldset>
    <div class="ws-plan" data-staff>
      <div class="ws-plan-title"><span>谁来做</span><button type="button" class="btn" data-swap aria-expanded="false">调整分工 ▾</button></div>
      <p data-plan-note></p>
      <div class="ws-flow" data-plan hidden></div>
    </div>
    <div class="ws-empty" data-nostaff hidden><p>工作室还没有员工，先添加一位。</p><button class="btn primary" type="button" data-hire>添加第一位员工</button></div>
    <details><summary>更多设置</summary>
      <label><span>标题（留空时用要求的第一行）</span><input name="title" maxlength="80"></label>
      <label class="ws-check" data-team><input type="checkbox" name="autonomous" checked><span>员工自己沟通、返工并验收。关掉后，需求规划做完先给你确认，最后由你验收。</span></label>
    </details>
    <p class="form-error" role="alert"></p>
    <div class="ws-start"><button class="btn primary" type="submit">开始执行</button><span class="muted">Ctrl + Enter</span><span class="muted ws-saveto">成品保存到 <code data-root></code></span></div>
  </form>`;
  const form = el.querySelector('form'), plan = el.querySelector('[data-plan]'), swap = el.querySelector('[data-swap]'), count = el.querySelector('[data-count]');
  let picks = null, staff = null;
  const syncCount = () => { const n = form.elements.goal.value.trim().length; count.textContent = n ? `${n} 字` : ''; };
  form.elements.goal.addEventListener('input', syncCount);
  el.addEventListener('click', ev => {
    const tplBtn = ev.target.closest('[data-tpl]');
    if (!tplBtn) return;
    const tpl = TEMPLATES[Number(tplBtn.dataset.tpl)];
    if (!tpl) return;
    form.elements.goal.value = tpl.goal;
    const radio = form.querySelector(`input[name="kind"][value="${tpl.kind}"]`);
    if (radio) { radio.checked = true; remember(tpl.kind); showPlan(); }
    syncCount();
    form.elements.goal.focus();
  });

  const options = picked => ctx.data().employees.map(e => `<option value="${esc(e.id)}"${e.id === picked ? ' selected' : ''}>${esc(e.name)} · ${esc(POSTS[postKey(e.profile?.post)].label)}</option>`).join('');
  function showPlan() {
    const kind = form.elements.kind.value;
    el.querySelector('[data-team]').hidden = kind !== 'team';
    if (!picks) return;
    el.querySelector('[data-plan-note]').textContent = planLine(kind, picks, ctx.person, form.elements.autonomous.checked);
    // the same left-to-right flow the work page shows later, with a person to pick on every step
    plan.innerHTML = PLANS[kind].map((column, i) => `${i ? '<i class="ws-arrow" aria-hidden="true"></i>' : ''}<div class="ws-stage">${column.map(([field, label]) =>
      `<label class="ws-step pick" style="--c:${ctx.office.colourOf(picks[field])}"><span class="ws-avatar" data-fill="${esc(picks[field])}" data-size="28"></span><span class="ws-step-text"><b>${label}</b><select name="${field}" aria-label="${label}由谁负责">${options(picks[field])}</select></span></label>`).join('')}</div>`).join('')
      + '<i class="ws-arrow" aria-hidden="true"></i><div class="ws-stage"><div class="ws-step final wait"><span class="ws-you" aria-hidden="true">你</span><span class="ws-step-text"><b>验收</b><small>做完后通知你</small></span></div></div>';
    ctx.fillAvatars(plan);
  }
  // called on every refresh: the people to choose from may have changed
  function sync() {
    const data = ctx.data(), now = JSON.stringify(data.employees.map(e => [e.id, e.name, e.profile?.post]));
    el.querySelector('[data-root]').textContent = data.outRoot || '';
    if (now === staff) return;
    staff = now; picks = data.employees.length ? defaultTeam(data.employees) : null;
    el.querySelector('[data-staff]').hidden = !picks; el.querySelector('[data-nostaff]').hidden = !!picks;
    form.querySelector('[type=submit]').disabled = !picks;
    showPlan();
  }
  swap.onclick = () => { plan.hidden = !plan.hidden; swap.setAttribute('aria-expanded', String(!plan.hidden)); swap.textContent = plan.hidden ? '调整分工 ▾' : '收起 ▴'; };
  el.querySelector('[data-hire]').onclick = () => ctx.hire();
  // rebuilt only when the kind of work, the way of working or a person changes; never while the request is being typed
  form.addEventListener('change', ev => {
    const name = ev.target.name;
    if (picks && name in picks) picks[name] = ev.target.value;
    else if (name === 'kind') remember(ev.target.value);
    else if (name !== 'autonomous') return;
    showPlan();
  });
  form.onsubmit = async ev => {
    ev.preventDefault();
    if (!picks) return;
    const data = ctx.data(), f = new FormData(form), error = form.querySelector('.form-error'), done = pending(form.querySelector('[type=submit]'));
    const goal = String(f.get('goal')).trim(), title = String(f.get('title') || '').trim() || goal.split('\n')[0].slice(0, 60), kind = f.get('kind');
    error.textContent = '';
    try {
      let id;
      if (kind === 'team') {
        const autonomous = f.get('autonomous') === 'on';
        const roles = collaborationRoles({ planner: picks.planner, backend: picks.backend, frontend: picks.frontend, tester: picks.integrator, autonomous });
        id = `p:${(await api('/api/projects', { name: title, goal, roles, autonomous, workorder: collaborationWorkorder(title, goal, roles, data.employees) })).id}`;
      } else if (kind === 'code') {
        id = `p:${(await api('/api/projects', { name: title, goal, roles: [
          { name: '代码开发', who: picks.developer, deps: [], gate: false, out: '可运行代码与 README', desc: '按目标实现可运行代码，README 写清运行方法；把核心逻辑与 UI 分离，供后续 node:test 验证。' },
          { name: '测试验收', who: picks.tester, deps: [0], gate: false, out: 'tests/ 下的自动化测试与测试报告', desc: '阅读上游实现，用 node:test 测试真实代码和关键流程，不要复制实现充当测试；不适用的后端要求无需添加。' }] })).id}`;
      } else {
        const order = crypto.randomUUID();
        await api('/api/orders', { id: order, title, brief: goal, source: 'custom', spec: { detail: goal, deliverable: { kind: 'doc' } } });
        await api(`/api/workspace/orders/${enc(order)}/start`, { employee: picks.writer });
        id = `o:${order}`;
      }
      form.elements.goal.value = ''; form.elements.title.value = ''; syncCount();
      ctx.select(id);
    } catch (e) { error.textContent = e.message; } finally { done(); }
  };
  return { el, sync, focus: () => form.elements.goal.focus({ preventScroll: true }) };
}
