// The boss's side of the studio: what is waiting, the work and who does which share of it, acceptance, and the project chat.
// Everything shown comes from the server every two seconds; panels are updated in place so a refresh never interrupts a click or typing.
import { patch } from './dom-patch.js';
import { createRefresher } from './live-refresh.js';
import { esc, enc, api, pending, enter, setText, calm } from './ui/format.js';
import { entries, needsYou, defaultStep } from './ui/model.js';
import * as V from './ui/views.js';
import { createDialogs } from './ui/dialogs.js';
import { projectColour } from './office/stage.js';
import { POSTS, postKey } from './office/roster.js';

const VIEWS = ['office', 'tasks', 'discussion'];

export async function mountWorkspace({ office, models }) {
  const root = document.createElement('main'); root.id = 'workspace'; document.body.prepend(root);
  root.innerHTML = `<header class="ws-top px"><h1>AI 工作室</h1>
    <nav class="ws-views" aria-label="工作区视图"><button data-view="office" aria-pressed="true">办公室<kbd>1</kbd></button><button data-view="tasks" aria-pressed="false">分工与验收<kbd>2</kbd></button><button data-view="discussion" aria-pressed="false">项目讨论<kbd>3</kbd></button><i class="ws-ink" aria-hidden="true"></i></nav>
    <span class="muted ws-spent" id="ws-status"></span><a class="btn" href="/company.html" target="_blank" rel="noopener">文件与记录 ↗</a><button class="btn primary" id="ws-create" title="快捷键 N">＋ 新工作</button></header>
    <div id="ws-notice" role="status"></div><div class="ws-grid">
    <div class="ws-main"><section class="ws-office" data-pane="office"></section>
    <section class="ws-panel" id="ws-detail" data-pane="tasks" aria-label="分工与验收"></section>
    <section class="ws-panel" id="ws-chat" data-pane="discussion" aria-label="项目讨论"><div id="ws-chat-heading"></div><button class="btn" id="ws-chat-older" hidden>查看更早的消息</button><div id="ws-messages" role="log" aria-live="polite" aria-label="员工讨论记录"></div><p id="ws-chat-running" class="muted"></p><form id="ws-chat-form"><textarea name="body" maxlength="6000" required aria-label="发给员工的消息" placeholder="补充要求或回答员工的问题。消息会进入员工的实际上下文，正在执行的调用结束后处理。"></textarea><div class="ws-send"><label><span>发给</span><select name="targetRole" aria-label="接收员工"></select></label><button class="btn primary" type="submit">发送</button></div><p class="form-error" role="alert"></p></form></section></div>
    <div class="ws-side"><section class="ws-panel ws-inbox" id="ws-inbox" hidden><h2>等你处理 <span class="ws-count" id="ws-inbox-count"></span></h2><div id="ws-inbox-list" class="ws-tasks"></div></section>
    <section class="ws-panel ws-list"><h2>工作</h2><div id="ws-tasks" class="ws-tasks"></div></section>
    <aside class="ws-panel ws-team"><div class="ws-panel-head"><h2>员工</h2><button class="btn" data-hire>＋ 添加</button></div><div id="ws-team"></div></aside>
    <p class="muted ws-foot"><span id="ws-version"></span> · 关闭页面任务也会继续 · <a href="/character-preview.html" target="_blank" rel="noopener">角色动作预览 ↗</a></p></div></div>
    <dialog id="ws-dialog"></dialog>`;
  root.querySelector('.ws-office').append(office.el);
  const $ = s => root.querySelector(s);

  let data, selected = null, view = 'office', lastDetail = '', lastTasks = '', lastTeam = '', dismissedNotice = false, noticeTimer = null, doneOpen = false;
  const steps = new Map(), stars = new Map(), drafts = new Map(), openBoxes = new Set(), previews = new Map(), previewCache = new Map(), teamRows = new Map();
  const chatCache = new Map(), chatDrafts = new Map(), sendIds = new Map();
  let chatProject = null, chatLoading = false, lastChat = '', lastChatHeading = '';

  const person = id => data.employees.find(e => e.id === id)?.name || id;
  const colourOf = entry => entry.p ? projectColour(entry.p.id) : '#a69fb8';
  const viewOf = extra => ({ data, selected, person, colourOf, colour: office.colourOf, ...extra });
  const notice = (message, error = false) => {
    clearTimeout(noticeTimer);
    $('#ws-notice').innerHTML = `<div class="ws-notice${error ? ' ws-error' : ''}"><span>${esc(message)}</span><button class="link" data-dismiss aria-label="关闭提示">关闭</button></div>`;
    if (!error) noticeTimer = setTimeout(() => $('#ws-notice').replaceChildren(), 6000);
  };
  // portraits are canvases: the HTML leaves a slot for each and this puts the right person in it
  function fillAvatars(scope) {
    for (const slot of scope.querySelectorAll('.ws-avatar[data-fill]')) {
      if (slot._for === slot.dataset.fill && slot.firstChild) continue;
      slot._for = slot.dataset.fill;
      slot.replaceChildren(office.avatar({ id: slot.dataset.fill }, Number(slot.dataset.size) || 28));
    }
  }

  // ---------- switching between the three views ----------
  const pane = name => $(`[data-pane=${name}]`);
  function setView(next) {
    next = VIEWS.includes(next) ? next : 'office';
    const before = view; view = next;
    const apply = () => {
      root.dataset.view = next;
      for (const b of root.querySelectorAll('.ws-views [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === next));
      moveInk(); office.setActive(next === 'office');
    };
    // the old page slides out and the new one in, in the direction of the tab that was chosen
    if (before !== next && root.dataset.view && document.startViewTransition && !calm.matches && !document.hidden) {
      root.dataset.dir = VIEWS.indexOf(next) > VIEWS.indexOf(before) ? 'forward' : 'back';
      document.startViewTransition(apply);
    } else { apply(); if (before !== next) enter(pane(next)); }
    if (data && next === 'discussion') { renderChat(); refreshMessages(); }
    if (next === 'discussion' && selected?.startsWith('p:')) history.replaceState(null, '', `#discussion/${selected.slice(2)}`);
    else if (location.hash.startsWith('#discussion')) history.replaceState(null, '', location.pathname);
  }
  // the marker under the view names slides to the chosen one
  function moveInk() {
    const button = root.querySelector('.ws-views [aria-pressed=true]'), ink = $('.ws-ink');
    ink.style.width = `${button.offsetWidth}px`; ink.style.transform = `translateX(${button.offsetLeft}px)`;
  }
  new ResizeObserver(moveInk).observe($('.ws-views'));
  setView('office');
  function select(id, nextView, step) {
    const same = selected === id, was = view;
    selected = id; lastDetail = '';
    if (step != null && id?.startsWith('p:')) steps.set(id, Number(step));
    if (nextView) setView(nextView);
    render();
    if (!same && was === view && view !== 'office') enter(pane(view), 3);
  }

  // clicking someone in the office shows what they are on; someone who never worked opens their settings
  function openEmployee(id) {
    if (!data) return;
    const discussing = data.projects.find(p => p.discussion?.some(t => t.employee === id && t.status === 'running'));
    if (discussing) return select(`p:${discussing.id}`, 'discussion');
    const jobs = data.jobs.filter(j => j.employee === id);
    const j = jobs.find(j => j.status === 'running') || jobs.find(j => j.status !== 'done') || jobs.at(-1);
    if (j) select(j.project_id ? `p:${j.project_id}` : `o:${j.order_id}`, 'tasks', j.project_id ? j.role_idx : null);
    else dialogs.employee(data.employees.find(e => e.id === id));
  }
  office.el.addEventListener('studio-employee', ev => openEmployee(ev.detail));

  // ---------- project discussion ----------
  function renderChat() {
    const p = data.projects.find(p => selected === `p:${p.id}`), form = $('#ws-chat-form');
    if (!p) {
      $('#ws-chat-heading').innerHTML = '<h2>项目讨论</h2><p class="muted">选择一个项目，查看员工交流；新建自主协作任务后，真实发言会出现在这里。</p>';
      form.hidden = true; $('#ws-messages').replaceChildren(); $('#ws-chat-running').textContent = ''; $('#ws-chat-older').hidden = true; chatProject = null; lastChat = ''; lastChatHeading = ''; return;
    }
    const changed = chatProject !== p.id;
    if (changed) {
      chatProject = p.id; lastChat = ''; lastChatHeading = ''; form.elements.body.value = chatDrafts.get(p.id) || '';
      form.elements.targetRole.innerHTML = p.roles.map(r => `<option value="${r.idx}">${esc(person(r.who))} · ${esc(r.name)}</option>`).join('');
    }
    form.hidden = false;
    const heading = V.chatHeading(viewOf(), p);
    if (heading !== lastChatHeading) { patch($('#ws-chat-heading'), heading); lastChatHeading = heading; }
    const cache = chatCache.get(p.id), messages = cache?.messages || [], signature = JSON.stringify(messages);
    if (signature !== lastChat) {
      const log = $('#ws-messages'), bottom = changed || log.scrollHeight - log.scrollTop - log.clientHeight < 70, v = viewOf();
      patch(log, messages.length ? messages.map(m => V.message(v, m)).join('') : '<p class="ws-empty">这里还没有讨论记录。旧项目只保留原有交付，新建自主协作任务会从开工讨论开始记录。</p>');
      fillAvatars(log);
      if (bottom) log.scrollTop = log.scrollHeight; lastChat = signature;
    }
    $('#ws-chat-older').hidden = !cache?.hasOlder;
    const running = (p.discussion || []).filter(t => t.status === 'running').map(t => person(t.employee));
    setText($('#ws-chat-running'), running.length ? `${running.join('、')} 正在阅读项目材料并回复…` : p.status === 'paused' ? '项目已暂停。消息会保存，后续调用等待继续执行。' : '');
  }
  async function refreshMessages(older = false) {
    if (chatLoading || view !== 'discussion' || !chatProject) return;
    const pid = chatProject, cache = chatCache.get(pid); chatLoading = true;
    try {
      const query = older && cache?.messages.length ? `?before=${cache.messages[0].id}` : cache?.messages.length ? `?after=${cache.messages.at(-1).id}` : '';
      const result = await api(`/api/workspace/projects/${pid}/messages${query}`);
      const messages = [...new Map([...(cache?.messages || []), ...result.messages].map(m => [m.id, m])).values()].sort((a, b) => a.id - b.id);
      chatCache.set(pid, { messages, hasOlder: older || !cache ? result.hasOlder : cache.hasOlder });
      const log = $('#ws-messages'), height = log.scrollHeight, top = log.scrollTop;
      if (chatProject === pid) { renderChat(); if (older) log.scrollTop = top + log.scrollHeight - height; }
    } catch (e) { if (chatProject === pid) $('#ws-chat-running').textContent = `讨论记录读取失败：${e.message}`; } finally { chatLoading = false; }
  }

  // ---------- everything else ----------
  function render() {
    const all = entries(data), waiting = needsYou(data), open = all.filter(e => e.status !== 'done' && !waiting.has(e.id)), finished = all.filter(e => e.status === 'done');
    if (!all.some(e => e.id === selected)) selected = (all.find(e => waiting.has(e.id)) || open[0] || finished[0])?.id || null;
    setText($('#ws-status'), `已花 ¥${data.spent.toFixed(2)}`);
    setText($('#ws-version'), `v${data.version}`);
    const title = waiting.size ? `(${waiting.size}) AI 工作室` : 'AI 工作室';
    if (document.title !== title) document.title = title;
    if (!dismissedNotice && data.demoHidden) { notice(`已隐藏 ${data.demoHidden} 条旧演示订单，它们不会自动执行。原记录仍可在「文件与记录」查看。`); dismissedNotice = true; }
    office.setInbox(waiting.size);

    // lists on the right: what waits for you first, then the rest, finished work folded away
    const v = viewOf();
    const inboxHTML = all.filter(e => waiting.has(e.id)).map(e => V.taskRow(v, e, waiting.get(e.id))).join('');
    const taskHTML = (open.length ? open.map(e => V.taskRow(v, e)).join('') : `<p class="ws-empty">${all.length ? '没有进行中的工作。' : '还没有工作。<br>点右上角「＋ 新工作」开始。'}</p>`)
      + (finished.length ? `<details id="ws-done"${doneOpen ? ' open' : ''}><summary>已完成（${finished.length}）</summary>${finished.map(e => V.taskRow(v, e)).join('')}</details>` : '');
    $('#ws-inbox').hidden = !waiting.size; setText($('#ws-inbox-count'), String(waiting.size));
    if (inboxHTML + taskHTML !== lastTasks) { patch($('#ws-inbox-list'), inboxHTML); patch($('#ws-tasks'), taskHTML); lastTasks = inboxHTML + taskHTML; }

    // the selected piece of work: its people are ringed in the office, its flow and acceptance fill the task view
    const entry = all.find(e => e.id === selected), detail = $('#ws-detail'), need = waiting.get(entry?.id);
    const jobs = entry ? data.jobs.filter(j => entry.p ? j.project_id === entry.p.id : j.order_id === entry.o.id) : [];
    office.focus(entry && entry.status !== 'done' ? [...new Set([...jobs.map(j => j.employee), ...(entry.p?.roles.map(r => r.who) || [])])] : []);
    renderChat();
    const step = entry?.p ? (steps.has(entry.id) ? steps.get(entry.id) : defaultStep(entry.p, jobs)) : null;
    const signature = JSON.stringify([entry, need, jobs, data.employees, step, stars.get(entry?.id)]);
    if (signature !== lastDetail) {
      lastDetail = signature;
      const dv = viewOf({ step, stars: stars.get(entry?.id) });
      patch(detail, !entry ? V.emptyPanel : entry.p ? V.projectPanel(dv, entry, need)
        : V.orderPanel(dv, entry, need, data.employees.map(e => `<option value="${esc(e.id)}">${esc(e.name)} · ${esc(POSTS[postKey(e.profile?.post)].label)}</option>`).join('')));
      fillAvatars(detail);
      // what was being typed, which boxes were open and which previews were showing all survive the update
      for (const f of detail.querySelectorAll('form[data-revise],form[data-reject]')) {
        const key = f.dataset.revise || `reject:${f.dataset.reject}`, draft = drafts.get(key) || '';
        if (f.elements.feedback.value !== draft) f.elements.feedback.value = draft;
        f.closest('details').open = openBoxes.has(key);
      }
      for (const b of detail.querySelectorAll('[data-preview]')) {
        const box = previews.get(`${b.dataset.preview}:${b.dataset.ref}`), home = b.closest('.ws-stepdetail,.ws-accept');
        if (box && !home.contains(box)) home.append(box);
      }
    }

    // staff on the right; rows stay in place between updates, so portraits keep animating and a press on one is never lost
    const talking = data.projects.flatMap(p => (p.discussion || []).filter(t => t.status === 'running'));
    const teamSignature = JSON.stringify([data.employees, data.jobs.filter(j => j.status === 'running').map(j => j.employee), talking]);
    if (teamSignature === lastTeam) return;
    lastTeam = teamSignature;
    const team = $('#ws-team'); team.querySelector('.ws-empty')?.remove();
    for (const [id, row] of teamRows) if (!data.employees.some(e => e.id === id)) { row.remove(); teamRows.delete(id); }
    for (const e of data.employees) {
      let row = teamRows.get(e.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'ws-person';
        const main = document.createElement('button'); main.className = 'ws-person-main'; main.dataset.person = e.id; main.append(office.avatar(e, 40), document.createElement('span'));
        const edit = document.createElement('button'); edit.className = 'link'; edit.dataset.employeeEdit = e.id; edit.textContent = '设置';
        row.append(main, edit); teamRows.set(e.id, row); team.append(row);
      }
      row.style.setProperty('--c', office.colourOf(e.id));
      row.querySelector('.link').setAttribute('aria-label', `${e.name}的设置`);
      const type = e.profile?.type || e.id, mode = e.profile?.connection, provider = models?.providers?.[mode ? models?.connections?.[mode]?.[type] : models?.types?.[type]];
      const state = talking.some(t => t.employee === e.id) ? '讨论中' : data.jobs.some(j => j.employee === e.id && j.status === 'running') ? '执行中' : '空闲';
      patch(row.querySelector('.ws-person-main>span'), `<b><i class="ws-dot"></i>${esc(e.name)}</b><small>${esc(POSTS[postKey(e.profile?.post)].label)} · <span class="${state === '空闲' ? '' : 'ws-on'}">${state}</span></small><small>${models?.fake ? '测试替身' : `${provider?.connection === 'local' ? '本机' : 'API'} · ${esc(provider?.model || '未接入模型')}`}</small>`);
    }
    if (!data.employees.length) team.innerHTML = '<div class="ws-empty"><p>工作室还没有员工。</p><button class="btn primary" data-hire>添加第一位员工</button></div>';
  }

  const refresher = createRefresher(async () => {
    try { data = await api('/api/workspace'); office.sync(data); render(); await refreshMessages(); }
    catch (e) { notice(`连接失败：${e.message}。页面不会重开任务。`, true); }
  });
  const refresh = () => { lastDetail = ''; return refresher.now(); };
  async function action(button, fn, reload = true) {
    const done = pending(button);
    try { await fn(); if (reload) await refresh(); } catch (e) { notice(e.message, true); } finally { done(); }
  }
  const dialogs = createDialogs({ root, office, refresh, notice, person, fillAvatars, data: () => data, setModels: m => { models = m; },
    select: (id, nextView) => { selected = id; setView(nextView); } });
  const employeeOfJob = id => data.jobs.find(j => j.id === id)?.employee;

  // ---------- clicks ----------
  root.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.dismiss !== undefined) $('#ws-notice').replaceChildren();
    if (d.hire !== undefined) dialogs.employee();
    if (d.newWork !== undefined || b.id === 'ws-create') dialogs.newWork();
    if (d.person) openEmployee(d.person);
    if (d.employeeEdit) dialogs.employee(data.employees.find(e => e.id === d.employeeEdit));
    if (d.view) setView(d.view);
    if (d.select) select(d.select, d.select.startsWith('o:') ? 'tasks' : d.go || (view === 'discussion' ? 'discussion' : 'tasks'), d.step);
    else if (d.step !== undefined && selected) { steps.set(selected, Number(d.step)); lastDetail = ''; render(); enter($('.ws-stepdetail'), 3); }
    if (d.locate) { setView('office'); office.locate(d.locate); }
    if (d.openChat) select(`p:${d.openChat}`, 'discussion');
    if (d.openTask) select(`p:${d.openTask}`, 'tasks');
    if (d.retryDiscussion) action(b, () => api(`/api/workspace/discussions/${d.retryDiscussion}/retry`, {}));
    if (d.startProject) action(b, () => api(`/api/workspace/projects/${d.startProject}/start`, {}));
    if (d.pause) action(b, () => api(`/api/workspace/projects/${d.pause}/pause`, { paused: d.paused === 'true' }));
    if (d.approve) action(b, async () => { const who = employeeOfJob(d.approve); await api(`/api/workspace/jobs/${enc(d.approve)}/approve`, {}); office.signal('approve', who); });
    if (d.accept) action(b, () => api(`/api/projects/${d.accept}/review`, { stars: stars.get(`p:${d.accept}`) ?? 3 }));
    if (d.preview) action(b, async () => {
      const repo = d.preview, ref = d.ref, k = `${repo}:${ref}`;
      let file = previewCache.get(k);
      if (!file) { const files = await api('/api/git/tree?' + new URLSearchParams({ repo, ref })); file = files.find(f => f === 'web/index.html') || files.find(f => f === 'index.html') || files.find(f => f.endsWith('.html')); if (file) previewCache.set(k, file); }
      if (!file) throw new Error('这份交付没有 HTML 页面；请在交付文档查看运行方法');
      const url = `${data.previewBase}/${enc(repo)}/${enc(ref)}/${file.split('/').map(enc).join('/')}`;
      const box = document.createElement('div'); box.className = 'ws-preview'; box.dataset.keep = '';
      box.innerHTML = `<p class="muted">静态页面预览 · 后端服务需按 README 启动 · <a href="${esc(url)}" target="_blank" rel="noopener">在新页打开 ↗</a></p><iframe src="${esc(url)}" title="交付页面预览" sandbox="allow-scripts allow-forms"></iframe>`;
      previews.set(k, box);
      const home = b.closest('.ws-stepdetail,.ws-accept,.ws-message'); home.querySelector('.ws-preview')?.remove(); home.append(box); enter(box);
    }, false);
  });
  root.addEventListener('change', ev => { const m = ev.target.name?.match(/^stars-(\d+)$/); if (m) stars.set(`p:${m[1]}`, Number(ev.target.value)); });
  root.addEventListener('input', ev => {
    const f = ev.target.closest('form[data-revise],form[data-reject]');
    if (f && ev.target.name === 'feedback') drafts.set(f.dataset.revise || `reject:${f.dataset.reject}`, ev.target.value);
  });
  root.addEventListener('toggle', ev => {
    if (ev.target.id === 'ws-done') doneOpen = ev.target.open;
    const f = ev.target.matches?.('[data-revise-box],[data-reject-box]') && ev.target.querySelector('form');
    if (!f) return;
    const key = f.dataset.revise || `reject:${f.dataset.reject}`;
    if (ev.target.open) { openBoxes.add(key); f.elements.feedback.focus({ preventScroll: true }); } else openBoxes.delete(key);
  }, true);
  root.addEventListener('submit', ev => {
    const form = ev.target;
    if (!form.dataset.revise && !form.dataset.reject && !form.dataset.startOrder) return;
    ev.preventDefault();
    const f = new FormData(form);
    action(form.querySelector('button'), async () => {
      if (form.dataset.startOrder) return api(`/api/workspace/orders/${enc(form.dataset.startOrder)}/start`, { employee: f.get('employee') });
      // sending work back: one share of a project, or the whole of a single delivery
      const job = form.dataset.revise || f.get('job') || form.dataset.reject, key = form.dataset.revise || `reject:${form.dataset.reject}`, who = employeeOfJob(job);
      await api(`/api/workspace/jobs/${enc(job)}/revise`, { feedback: f.get('feedback') });
      drafts.delete(key); openBoxes.delete(key); office.signal('revise', who);
    });
  });
  $('#ws-chat-older').onclick = () => refreshMessages(true);
  $('#ws-chat-form').elements.body.addEventListener('input', e => { if (chatProject) { chatDrafts.set(chatProject, e.target.value); sendIds.delete(chatProject); } });
  $('#ws-chat-form').onsubmit = async ev => {
    ev.preventDefault(); const form = ev.target, pid = chatProject; if (!pid) return;
    const done = pending(form.querySelector('button')), body = form.elements.body.value, target = Number(form.elements.targetRole.value); form.querySelector('.form-error').textContent = '';
    const clientId = sendIds.get(pid) || crypto.randomUUID(); sendIds.set(pid, clientId);
    try {
      await api(`/api/workspace/projects/${pid}/messages`, { body, targetRole: target, clientId });
      chatDrafts.delete(pid); sendIds.delete(pid); if (chatProject === pid && form.elements.body.value === body) form.elements.body.value = '';
      office.signal('message', data.projects.find(p => p.id === pid)?.roles.find(r => r.idx === target)?.who);
      await refresh();
    } catch (e) { form.querySelector('.form-error').textContent = e.message; } finally { done(); }
  };

  // ---------- keys ----------
  root.addEventListener('keydown', ev => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && ev.target.matches('textarea')) ev.target.form?.requestSubmit(); });
  document.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.closest?.('input,textarea,select,[contenteditable]') || $('#ws-dialog').open) return;
    if (['1', '2', '3'].includes(ev.key)) setView(VIEWS[ev.key - 1]);
    else if (ev.key.toLowerCase() === 'n') { ev.preventDefault(); dialogs.newWork(); }
  });

  const discussionLink = location.hash.match(/^#discussion\/(\d+)$/);
  if (discussionLink) { selected = `p:${discussionLink[1]}`; setView('discussion'); }
  await refresh();
  // no point refreshing a page nobody is looking at; coming back catches up at once
  const tick = () => { if (!document.hidden) refresher.poll(); };
  let timer = setInterval(tick, 2000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresher.poll(); });
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.addEventListener('pageshow', e => { if (e.persisted) { refresh(); timer = setInterval(tick, 2000); } });
}
