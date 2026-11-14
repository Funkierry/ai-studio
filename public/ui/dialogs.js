// The windows that open over the page: one model call in full, and an employee's settings.
// ctx: { root, data(), office, setModels, refresh, notice, person(id) }
import { esc, enc, api, pending } from './format.js';
import { markdown } from './markdown.js';
import { POSTS, postKey } from '../office/roster.js';

const ACTIONS = { continue: '继续', question: '向同事提问', revise: '要求返工', ask_user: '请老板决定' };

export function createDialogs(ctx) {
  const d = ctx.root.querySelector('#ws-dialog');

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

  // ---------- one model call in full: what the employee was given on the left, what came back on the right ----------
  async function call(id) {
    const shell = body => `<div class="ws-call"><div class="ws-call-head"><h2 data-title>模型调用 #${Number(id)}</h2><button class="btn" type="button" data-close>关闭</button></div>${body}</div>`;
    d.innerHTML = shell('<p class="muted">正在读取…</p>');
    const closable = () => { d.querySelector('[data-close]').onclick = () => d.close(); };
    closable(); d.showModal();
    try {
      const c = await api(`/api/workspace/calls/${Number(id)}`), r = c.reply || {};
      const state = c.status === 'done' ? '已完成' : c.status === 'running' ? '还在执行' : '没有完成';
      const reply = c.status === 'running' ? '<p class="muted">还在执行，回复回来后会显示在这里。</p>'
        : c.status !== 'done' ? `<p class="ws-error">${esc(c.error || '没有拿到回复')}</p>`
        : [r.summary && `<p class="ws-summary"><b>摘要</b>　${esc(r.summary)}</p>`, r.text && `<div class="md">${markdown(r.text)}</div>`,
          r.action && `<p class="muted">选择的行动：${esc(ACTIONS[r.action] || r.action)}${r.target_roles?.length ? `（指向第 ${r.target_roles.map(i => i + 1).join('、')} 份分工）` : ''}</p>`,
          r.files?.length && `<p><b>写出的文件</b></p><ul>${r.files.map(f => `<li><code>${esc(f)}</code></li>`).join('')}</ul><p class="muted">文件内容在「成品」里看。</p>`,
          r.open_questions?.length && `<p><b>待你确认</b></p><ul>${r.open_questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>`].filter(Boolean).join('') || '<p class="muted">回复里没有内容。</p>';
      d.innerHTML = shell(`<p class="muted">${[state, c.model && esc(c.model), c.ms != null && `用时 ${Math.round(c.ms / 1000)} 秒`, c.tokens ? `${c.tokens.toLocaleString()} token` : '', c.cost != null && `¥${Number(c.cost).toFixed(2)}`, c.attempt > 1 && `第 ${c.attempt} 次`].filter(Boolean).join(' · ')}</p>
        <div class="ws-call-cols"><section><h3>交给 TA 的任务书<small>${c.prompt.length.toLocaleString()} 字</small></h3><pre>${esc(c.prompt)}</pre></section>
        <section><h3>TA 的回复</h3><div class="ws-call-reply">${reply}</div></section></div>`);
      d.querySelector('[data-title]').textContent = `${ctx.person(c.employee)} · ${c.title || '模型调用'}`;
      closable();
    } catch (e) { d.innerHTML = shell(`<p class="ws-error">${esc(e.message)}</p>`); closable(); }
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
  return { call, employee };
}
