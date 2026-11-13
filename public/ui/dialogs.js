// The two windows the boss fills in: new work, and an employee's settings.
// ctx: { root, data(), office, models(), setModels, refresh, notice, select(id, view), person(id) }
import { esc, enc, api, pending } from './format.js';
import { defaultTeam, PLANS } from './model.js';
import { POSTS, postKey } from '../office/roster.js';
import { collaborationRoles, collaborationWorkorder } from '../collaboration-plan.js';

export function createDialogs(ctx) {
  const d = ctx.root.querySelector('#ws-dialog');
  let workDraft = '';

  function open(html, submit, submitLabel = '开始', { then, onCancel } = {}) {
    d.innerHTML = `<form>${html}<p class="form-error" role="alert"></p><div class="ws-actions"><button class="btn primary" type="submit">${esc(submitLabel)}</button><button class="btn" type="button" data-close>取消</button></div></form>`;
    d.querySelector('[data-close]').onclick = () => { onCancel?.(); d.close(); };
    d.showModal();
    d.querySelector('form').onsubmit = async ev => {
      ev.preventDefault();
      const done = pending(d.querySelector('[type=submit]'));
      try { await submit(new FormData(ev.target)); d.close(); await ctx.refresh(); then?.(); }
      catch (e) { d.querySelector('.form-error').textContent = e.message; }
      finally { done(); }
    };
    return d;
  }
  const options = picked => ctx.data().employees.map(e => `<option value="${esc(e.id)}"${e.id === picked ? ' selected' : ''}>${esc(e.name)} · ${esc(POSTS[postKey(e.profile?.post)].label)}</option>`).join('');

  // ---------- new work: say what you want, see who will do which part, start ----------
  function newWork() {
    const data = ctx.data();
    if (!data) return;
    if (!data.employees.length) { employee(null, newWork); ctx.notice('先添加一位员工，加好后就能写新工作。'); return; }
    const picks = defaultTeam(data.employees), orderId = crypto.randomUUID();
    open(`<h2>新工作</h2>
      <label><span>要做什么、怎样算完成</span><textarea name="goal" required rows="5" placeholder="目标、功能、限制和验收标准"></textarea></label>
      <fieldset class="ws-choices kinds"><legend>怎么做</legend>
        <label class="ws-choice"><input type="radio" name="kind" value="team" checked><span><b>团队协作</b><small>讨论、分工、集成测试</small></span></label>
        <label class="ws-choice"><input type="radio" name="kind" value="code"><span><b>小型代码</b><small>开发、测试、验收</small></span></label>
        <label class="ws-choice"><input type="radio" name="kind" value="doc"><span><b>文档</b><small>撰写、验收</small></span></label>
      </fieldset>
      <div class="ws-plan"><p class="ws-plan-title">谁做哪一份 <small>可以直接换人</small></p><div class="ws-flow" data-plan></div><p class="muted" data-plan-note></p></div>
      <details><summary>更多设置：标题、协作方式</summary>
        <label><span>标题（留空时用需求的第一行）</span><input name="title" maxlength="80"></label>
        <label class="ws-check" data-team><input type="checkbox" name="autonomous" checked><span>员工自主沟通、返工并验收</span></label>
      </details>`, async f => {
      const title = String(f.get('title') || '').trim() || String(f.get('goal')).trim().split('\n')[0].slice(0, 60), goal = f.get('goal'), kind = f.get('kind');
      let selected;
      if (kind === 'team') {
        const autonomous = f.get('autonomous') === 'on';
        const roles = collaborationRoles({ planner: picks.planner, backend: picks.backend, frontend: picks.frontend, tester: picks.integrator, autonomous });
        const p = await api('/api/projects', { name: title, goal, roles, autonomous, workorder: collaborationWorkorder(title, goal, roles, data.employees) });
        selected = `p:${p.id}`;
      } else if (kind === 'code') {
        const p = await api('/api/projects', { name: title, goal, roles: [
          { name: '代码开发', who: picks.developer, deps: [], gate: false, out: '可运行代码与 README', desc: '按目标实现可运行代码，README 写清运行方法；把核心逻辑与 UI 分离，供后续 node:test 验证。' },
          { name: '测试验收', who: picks.tester, deps: [0], gate: false, out: 'tests/ 下的自动化测试与测试报告', desc: '阅读上游实现，用 node:test 测试真实代码和关键流程，不要复制实现充当测试；不适用的后端要求无需添加。' }] });
        selected = `p:${p.id}`;
      } else {
        await api('/api/orders', { id: orderId, title, brief: goal, source: 'custom', spec: { detail: goal, deliverable: { kind: 'doc' } } });
        await api(`/api/workspace/orders/${enc(orderId)}/start`, { employee: picks.writer });
        selected = `o:${orderId}`;
      }
      workDraft = '';
      ctx.select(selected, kind === 'team' ? 'discussion' : 'tasks');
    }, '开始', { onCancel: () => { workDraft = ''; } });
    // Esc closes the window but keeps what was typed; only 取消 throws it away
    const form = d.querySelector('form'), plan = d.querySelector('[data-plan]');
    form.elements.goal.value = workDraft;
    form.elements.goal.addEventListener('input', e => { workDraft = e.target.value; });
    const showPlan = () => {
      const kind = form.elements.kind.value, name = k => ctx.person(picks[k]);
      // the same left-to-right flow the task page shows later, with a person to pick on every step
      plan.innerHTML = PLANS[kind].map((column, i) => `${i ? '<i class="ws-arrow" aria-hidden="true"></i>' : ''}<div class="ws-stage">${column.map(([field, label]) =>
        `<label class="ws-step pick" style="--c:${ctx.office.colourOf(picks[field])}"><span class="ws-avatar" data-fill="${esc(picks[field])}" data-size="28"></span><span class="ws-step-text"><b>${label}</b><select name="${field}" aria-label="${label}由谁负责">${options(picks[field])}</select></span></label>`).join('')}</div>`).join('')
        + '<i class="ws-arrow" aria-hidden="true"></i><div class="ws-stage"><div class="ws-step final wait"><span class="ws-you" aria-hidden="true">你</span><span class="ws-step-text"><b>验收</b><small>做完后通知你</small></span></div></div>';
      ctx.fillAvatars(plan);
      d.querySelector('[data-team]').hidden = kind !== 'team';
      const team = [...new Set(['planner', 'backend', 'frontend', 'integrator'].map(name))].join('、');
      d.querySelector('[data-plan-note]').textContent = kind === 'doc' ? `${name('writer')} 撰写，写好后你来验收。`
        : kind === 'code' ? `${name('developer')} 开发，${name('tester')} 测试，做完你来验收。`
        : form.elements.autonomous.checked ? `${team} 先讨论再分工，测试失败自动返工（最多 2 轮）。你可以随时插话或暂停。` : `${team} 接力完成，需求规划做完先给你确认。`;
    };
    // rebuilt only when the kind of work, the way of working or a person changes; never while the request is being typed
    form.addEventListener('change', ev => {
      const name = ev.target.name;
      if (name in picks) picks[name] = ev.target.value; else if (name !== 'kind' && name !== 'autonomous') return;
      showPlan();
    });
    showPlan();
    form.elements.goal.focus();
  }

  // ---------- an employee: name, post, speciality, and which tool or model writes for them ----------
  async function employee(who, then) {
    try {
      const models = await api('/api/models'); ctx.setModels(models);
      if (!models.connections) throw new Error('接入选项需要新版服务，请重启工作室后刷新。');
      const data = ctx.data(), currentType = who?.profile?.type || who?.id;
      const providerOf = e => { const type = e.profile?.type || e.id, mode = e.profile?.connection; return models.providers?.[mode ? models.connections?.[mode]?.[type] : models.types?.[type]]; };
      const preferred = who ? providerOf(who)?.connection : null;
      const initialMode = preferred || (Object.values(models.connections.local).some(id => models.fake || models.providers[id]?.configured) ? 'local' : 'api');
      const occupied = !!who && (data.jobs.some(j => j.employee === who.id && j.status === 'running') || data.projects.some(p => p.discussion?.some(t => t.employee === who.id && t.status === 'running')));
      const post = postKey(who?.profile?.post || 'general');
      open(`<h2>${who ? `${esc(who.name)} · 设置` : '添加员工'}</h2>
        <div class="ws-row"><label><span>名字</span><input name="name" required maxlength="40" value="${esc(who?.name || '')}"></label>
        <label><span>岗位（决定 TA 在办公室里常去的地方）</span><select name="post">${Object.entries(POSTS).map(([k, p]) => `<option value="${k}"${k === post ? ' selected' : ''}>${p.label}</option>`).join('')}</select></label></div>
        <label><span>专长（可不填，会写进 TA 的每份工作说明）</span><input name="persona" maxlength="300" value="${esc(who?.profile?.persona || '')}" placeholder="比如：资深前端，擅长手机页面"></label>
        <fieldset class="ws-choices"${occupied ? ' disabled' : ''}><legend>接入方式</legend>
          <label class="ws-choice"><input type="radio" name="connection" value="local"${initialMode === 'local' ? ' checked' : ''}><span><b>本机</b><small>Claude Code、Codex 或本地模型服务</small></span></label>
          <label class="ws-choice"><input type="radio" name="connection" value="api"${initialMode === 'api' ? ' checked' : ''}><span><b>API 接入</b><small>配置好密钥的模型服务</small></span></label>
        </fieldset><p class="muted" data-connection-hint></p>
        <label><span data-model-label>工具 / 模型</span><select name="type" required${occupied ? ' disabled' : ''}></select></label><p class="muted" data-model-hint></p>`,
      async f => {
        const body = Object.fromEntries(f);
        if (!who) return api('/api/workspace/employees', body);
        await api(`/api/workspace/employees/${enc(who.id)}`, { name: body.name, post: body.post, persona: body.persona });
        if (!occupied && (body.connection !== preferred || body.type !== currentType)) await api(`/api/workspace/employees/${enc(who.id)}/connection`, { type: body.type, connection: body.connection });
      }, who ? '保存' : '添加员工', { then });
      const form = d.querySelector('form'), select = form.elements.type, submit = d.querySelector('[type=submit]');
      let named = !!who;
      form.elements.name.addEventListener('input', () => { named = true; });
      const showProvider = () => {
        const mode = form.elements.connection.value, p = models.providers[models.connections[mode][select.value]];
        const ready = !!p && (models.fake || p.configured), same = !!who && mode === preferred && select.value === currentType;
        submit.disabled = !ready && !same && !occupied;
        if (!named) form.elements.name.value = ctx.office.defaultName(select.value);
        d.querySelector('[data-model-hint]').textContent = p ? `${p.model} · ${p.hint}${!ready && mode === 'api' ? '。在项目的 .env 中配置相应密钥，再重启工作室。' : ''}` : '没有可用的接入配置。';
      };
      const showMode = () => {
        const mode = form.elements.connection.value, last = select.value || currentType;
        const entries = Object.entries(models.connections[mode]).filter(([type]) => type === currentType || !(mode === 'local' && type === 'gpt') && !(mode === 'api' && type === 'codex'));
        select.innerHTML = entries.map(([type, id]) => { const p = models.providers[id]; return `<option value="${esc(type)}">${esc(p.name)}${!models.fake && !p.configured ? '（未配置）' : ''}</option>`; }).join('');
        select.value = entries.some(([type]) => type === last) ? last : entries.find(([, id]) => models.fake || models.providers[id].configured)?.[0] || entries[0]?.[0] || '';
        d.querySelector('[data-model-label]').textContent = mode === 'local' ? '本机工具 / 模型' : 'API 模型';
        d.querySelector('[data-connection-hint]').textContent = occupied ? '这位员工正在执行调用，做完后才能切换接入方式。' : mode === 'local' ? '使用本机登录配置，仍可能访问云端模型；本机不等于离线运行。' : '使用服务端已有的密钥配置，按提供商计费。';
        showProvider();
      };
      for (const radio of form.querySelectorAll('[name=connection]')) radio.onchange = showMode;
      select.onchange = showProvider; showMode();
    } catch (e) { ctx.notice(e.message, true); }
  }
  return { newWork, employee };
}
