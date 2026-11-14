// The studio as a tool: say what you want on one page, watch how it is made, and get the files.
// Left: every piece of work. Middle: 1 what was asked, 2 the record of how it went, 3 what came out.
// Everything shown comes from the server every two seconds; parts are updated in place so a refresh never interrupts a click or typing.
import { patch } from './dom-patch.js';
import { createRefresher } from './live-refresh.js';
import { esc, enc, api, pending, enter, setText, calm } from './ui/format.js';
import { entries, needsYou, flowOf, firstFile, fileKind } from './ui/model.js';
import * as V from './ui/views.js';
import { markdown } from './ui/markdown.js';
import { createDialogs } from './ui/dialogs.js';
import { createComposer } from './ui/compose.js';
import { projectColour } from './office/stage.js';
import { POSTS, postKey } from './office/roster.js';

const VIEWS = ['work', 'office'], NEW = 'new';

export async function mountWorkspace({ office, models }) {
  const root = document.createElement('main'); root.id = 'workspace'; document.body.prepend(root);
  root.innerHTML = `<header class="ws-top px"><h1>AI 工作室</h1>
    <nav class="ws-views" aria-label="视图"><button data-view="work" aria-pressed="true">工作台<kbd>1</kbd></button><button data-view="office" aria-pressed="false">办公室<kbd>2</kbd></button><i class="ws-ink" aria-hidden="true"></i></nav>
    <span class="muted ws-spent" id="ws-status"></span><button class="btn" data-open-root title="打开保存成品的本机文件夹">成品文件夹</button><a class="btn" href="/company.html" target="_blank" rel="noopener">文件与记录 ↗</a></header>
    <div id="ws-notice" role="status"></div>
    <div class="ws-panes">
    <div class="ws-body" data-pane="work">
      <aside class="ws-rail"><button class="btn primary ws-new" data-new title="快捷键 N">＋ 新工作</button><div id="ws-rail"></div><p class="muted ws-foot"><span id="ws-version"></span> · 关掉页面，工作也会继续</p></aside>
      <div class="ws-main">
        <div id="ws-work" hidden>
          <div id="ws-head" class="ws-panel"></div>
          <div class="ws-cols">
            <section class="ws-panel ws-process" aria-label="过程">
              <h3 class="ws-num"><b aria-hidden="true">2</b>过程<small>谁做了什么、说了什么，按时间排列</small></h3>
              <div id="ws-flow"></div><div id="ws-share"></div>
              <div class="ws-filters" id="ws-filters" role="group" aria-label="筛选记录"></div>
              <div id="ws-trail" role="log" aria-live="polite" aria-label="过程记录"></div>
              <div id="ws-running"></div>
              <form id="ws-say" hidden><textarea name="body" maxlength="6000" required rows="2" aria-label="给员工留言" placeholder="给员工留言：补充要求，或回答他们的问题。会进入员工下一次工作的材料。"></textarea>
                <div class="ws-send"><label><span>发给</span><select name="targetRole" aria-label="接收员工"></select></label><button class="btn primary" type="submit">发送</button></div><p class="form-error" role="alert"></p></form>
            </section>
            <section class="ws-panel ws-result" aria-label="成品">
              <h3 class="ws-num"><b aria-hidden="true">3</b>成品<small>做出来的文件，同时保存在本机</small></h3>
              <div id="ws-accept"></div><div id="ws-out"></div><div id="ws-viewer" hidden></div>
            </section>
          </div>
        </div>
      </div>
    </div>
    <div class="ws-officepane" data-pane="office"><section class="ws-office"></section>
      <aside class="ws-panel ws-team"><div class="ws-panel-head"><h2>员工</h2><button class="btn" data-hire>＋ 添加</button></div><div id="ws-team"></div>
        <p class="muted ws-foot">办公室只是现场画面，不影响工作和费用。<a href="/character-preview.html" target="_blank" rel="noopener">角色动作预览 ↗</a></p></aside></div>
    </div>
    <dialog id="ws-dialog"></dialog>`;
  root.querySelector('.ws-office').append(office.el);
  const $ = s => root.querySelector(s);

  let data, selected = null, view = 'work', detail = null, filter = 'all', doneOpen = false, recordOpen = false, noticeTimer = null;
  let lastRail = '', lastHead = '', lastProcess = '', lastTrail = '', lastResult = '', lastTeam = '', shown = '', sayFor = null, trailFor = null;
  const steps = new Map(), stars = new Map(), drafts = new Map(), openBoxes = new Set(), expanded = new Set(), fileOf = new Map(), asSource = new Set();
  const sayDrafts = new Map(), sendIds = new Map(), teamRows = new Map();

  const person = id => data.employees.find(e => e.id === id)?.name || id || '未指定';
  const colourOf = entry => entry.p ? projectColour(entry.p.id) : '#a69fb8';
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

  // ---------- the two views ----------
  const pane = name => $(`[data-pane=${name}]`);
  function setView(next) {
    next = VIEWS.includes(next) ? next : 'work';
    const before = view; view = next;
    const apply = () => {
      root.dataset.view = next;
      for (const b of root.querySelectorAll('.ws-views [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === next));
      moveInk(); office.setActive(next === 'office');
    };
    if (before !== next && root.dataset.view && document.startViewTransition && !calm.matches && !document.hidden) {
      root.dataset.dir = VIEWS.indexOf(next) > VIEWS.indexOf(before) ? 'forward' : 'back';
      document.startViewTransition(apply);
    } else { apply(); if (before !== next) enter(pane(next)); }
  }
  function moveInk() {
    const button = root.querySelector('.ws-views [aria-pressed=true]'), ink = $('.ws-ink');
    ink.style.width = `${button.offsetWidth}px`; ink.style.transform = `translateX(${button.offsetLeft}px)`;
  }
  new ResizeObserver(moveInk).observe($('.ws-views'));
  setView('work');

  // ---------- choosing a piece of work ----------
  function select(id, { step } = {}) {
    const same = selected === id;
    selected = id;
    if (step !== undefined && id !== NEW) steps.set(id, step);
    if (view !== 'work') setView('work');
    // work that was created a moment ago is not in the data yet: the refresh below brings it
    if (data && (id === NEW || entries(data).some(e => e.id === id))) render();
    if (!same) { enter(id === NEW ? composer.el : $('#ws-work'), 4); if (id === NEW) composer.focus(); }
    return refresh();
  }
  // clicking someone in the office shows what they are on; someone who never worked opens their settings
  function openEmployee(id) {
    if (!data) return;
    const jobs = data.jobs.filter(j => j.employee === id);
    const talking = data.projects.find(p => p.discussion?.some(t => t.employee === id && t.status === 'running'));
    const j = jobs.find(j => j.status === 'running') || jobs.find(j => j.status !== 'done') || jobs.at(-1);
    if (talking) select(`p:${talking.id}`);
    else if (j) select(j.project_id ? `p:${j.project_id}` : `o:${j.order_id}`, { step: j.project_id ? j.role_idx : 0 });
    else dialogs.employee(data.employees.find(e => e.id === id));
  }
  office.el.addEventListener('studio-employee', ev => openEmployee(ev.detail));

  // ---------- 3 · one file shown in full ----------
  function showFile(id, out) {
    const viewer = $('#ws-viewer'), path = fileOf.get(id);
    if (!out?.dir || !path) { viewer.hidden = true; shown = ''; return; }
    const source = asSource.has(`${id}|${path}`), key = `${id}|${path}|${out.at}|${source}`;
    if (key === shown) return;
    shown = key; viewer.hidden = false;
    const kind = fileKind(path), size = out.files.find(f => f.path === path)?.size;
    const headHTML = extra => `<div class="ws-viewer-head"><b>${esc(path)}</b>${extra}</div>`;
    if (kind === 'page' && data.previewBase && !source) {
      const url = `${data.previewBase}/out/${enc(id)}/${path.split('/').map(enc).join('/')}`;
      viewer.innerHTML = `${headHTML(`<span class="muted">页面预览。要用到后端的功能，需按 README 启动程序。</span><button class="btn" data-source>看源码</button><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">在新页打开 ↗</a>`)}<iframe src="${esc(url)}" title="页面预览" sandbox="allow-scripts allow-forms"></iframe>`;
      return;
    }
    viewer.innerHTML = `${headHTML(kind === 'page' ? '<button class="btn" data-source>看页面</button>' : '')}<p class="muted ws-viewer-wait">正在读取…</p>`;
    api(`/api/workspace/works/${enc(id)}/file?${new URLSearchParams({ path })}`).then(f => {
      if (shown !== key) return;
      const body = f.large ? `<p class="muted">这个文件有 ${Math.round((f.size || size || 0) / 1024)} KB，太大了，请在文件夹里打开。</p>`
        : f.binary ? '<p class="muted">这不是文本文件，请在文件夹里打开。</p>'
        : kind === 'doc' ? `<div class="md">${markdown(f.content)}</div>` : `<pre>${esc(f.content)}</pre>`;
      viewer.querySelector('.ws-viewer-wait').outerHTML = `<div class="ws-viewer-body">${body}</div>`;
    }).catch(e => { if (shown === key) viewer.querySelector('.ws-viewer-wait').textContent = `读取失败：${e.message}`; });
  }

  // ---------- drawing ----------
  function render() {
    const all = entries(data), waiting = needsYou(data);
    if (selected !== NEW && !all.some(e => e.id === selected)) selected = (all.find(e => waiting.has(e.id)) || all.find(e => e.status !== 'done'))?.id || NEW;
    setText($('#ws-status'), `已花 ¥${data.spent.toFixed(2)}`);
    setText($('#ws-version'), `v${data.version}`);
    const title = waiting.size ? `(${waiting.size}) AI 工作室` : 'AI 工作室';
    if (document.title !== title) document.title = title;
    office.setInbox(waiting.size);

    const base = { data, selected, person, colourOf, colour: office.colourOf };
    const railHTML = V.rail(base, all, waiting, doneOpen);
    if (railHTML !== lastRail) { patch($('#ws-rail'), railHTML); lastRail = railHTML; }
    $('.ws-new').setAttribute('aria-current', String(selected === NEW));
    composer.el.hidden = selected !== NEW; $('#ws-work').hidden = selected === NEW;
    composer.sync();
    renderTeam();
    if (selected === NEW) { office.focus([]); return; }

    const entry = all.find(e => e.id === selected), found = waiting.get(entry.id);
    const jobs = data.jobs.filter(j => entry.p ? j.project_id === entry.p.id : j.order_id === entry.o.id);
    // a single delivery has one share; what is wrong with it is always about that share
    const need = found && { ...found, step: found.step ?? (entry.o && found.kind === 'fix' ? 0 : undefined) };
    office.focus(entry.status !== 'done' ? [...new Set([...jobs.map(j => j.employee), ...(entry.p?.roles.map(r => r.who) || [])])] : []);
    const mine = detail?.id === entry.id ? detail : null, out = mine?.outputs, flowing = flowOf(entry, jobs);
    const step = steps.get(entry.id) ?? null, role = step != null ? flowing.p.roles.find(r => r.idx === step) : null;
    if (out && (!fileOf.has(entry.id) || !out.files.some(f => f.path === fileOf.get(entry.id)))) fileOf.set(entry.id, firstFile(out));
    const v = { ...base, step: role ? step : null, stars: stars.get(entry.id), filter, expanded, outputs: out, file: fileOf.get(entry.id), recordOpen };

    // 1 · the request, and what waits for the boss
    const headSig = JSON.stringify([entry, need, jobs.map(j => [j.id, j.status])]);
    if (headSig !== lastHead) { lastHead = headSig; patch($('#ws-head'), V.head(v, entry, need, need?.kind === 'confirm' ? jobs.find(j => j.status === 'review' && j.role_idx === need.step) : null)); }

    // 2 · who does what, then one share opened
    const processSig = JSON.stringify([flowing, v.step, data.employees.map(e => [e.id, e.name])]);
    if (processSig !== lastProcess) {
      lastProcess = processSig;
      patch($('#ws-flow'), V.flow(v, flowing.p, flowing.jobs));
      patch($('#ws-share'), role ? V.share(v, role, flowing.jobs.find(j => j.role_idx === step), flowing.p, !entry.p) : '');
      fillAvatars($('.ws-process'));
      restoreForms($('#ws-share'));
    }
    // 2 · the record
    const log = $('#ws-trail');
    if (!mine) { if (trailFor !== `wait:${entry.id}`) { trailFor = `wait:${entry.id}`; lastTrail = ''; patch(log, '<p class="ws-empty">正在读取记录…</p>'); patch($('#ws-filters'), ''); patch($('#ws-running'), ''); } }
    else {
      const trailSig = JSON.stringify([mine.trail.entries, filter, v.step, [...expanded], out?.at]);
      if (trailSig !== lastTrail) {
        const fresh = trailFor !== entry.id, bottom = fresh || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        lastTrail = trailSig; trailFor = entry.id;
        patch($('#ws-filters'), V.filters(v, mine.trail, role?.name));
        patch(log, V.trail(v, mine.trail)); fillAvatars(log);
        if (bottom) log.scrollTop = log.scrollHeight;
      }
      patch($('#ws-running'), V.running(v, mine.trail)); fillAvatars($('#ws-running'));
    }
    // 2 · a word to the people on it (projects only: a single delivery is sent back instead)
    const say = $('#ws-say');
    say.hidden = !entry.p;
    if (entry.p && sayFor !== entry.id) {
      sayFor = entry.id; say.elements.body.value = sayDrafts.get(entry.id) || ''; say.querySelector('.form-error').textContent = '';
      say.elements.targetRole.innerHTML = entry.p.roles.map(r => `<option value="${r.idx}">${esc(person(r.who))} · ${esc(r.name)}</option>`).join('');
    }

    // 3 · the decision, then the files
    const resultSig = JSON.stringify([entry.id, entry.status, need?.kind, jobs.map(j => [j.id, j.status, j.result?.artifacts]), stars.get(entry.id), out, v.file, recordOpen, !!mine]);
    if (resultSig !== lastResult) {
      lastResult = resultSig;
      patch($('#ws-accept'), need?.kind !== 'accept' ? '' : entry.p ? V.acceptProject(v, entry.p, jobs) : V.acceptOrder(v, jobs.find(j => j.status === 'review') || jobs[0]));
      restoreForms($('#ws-accept'));
      patch($('#ws-out'), mine ? V.files(v, entry) : '<p class="ws-empty">正在读取成品…</p>');
    }
    showFile(entry.id, out);
  }
  // what was being typed and which boxes were open survive an update
  function restoreForms(scope) {
    for (const f of scope.querySelectorAll('form[data-revise],form[data-reject]')) {
      const key = f.dataset.revise || `reject:${f.dataset.reject}`, draft = drafts.get(key) || '';
      if (f.elements.feedback.value !== draft) f.elements.feedback.value = draft;
      f.closest('details').open = openBoxes.has(key);
    }
  }
  // staff beside the office; rows stay in place between updates, so portraits keep animating and a press on one is never lost
  function renderTeam() {
    const talking = data.projects.flatMap(p => (p.discussion || []).filter(t => t.status === 'running'));
    const signature = JSON.stringify([data.employees, data.jobs.filter(j => j.status === 'running').map(j => j.employee), talking]);
    if (signature === lastTeam) return;
    lastTeam = signature;
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

  // ---------- loading ----------
  const refresher = createRefresher(async () => {
    try {
      data = await api('/api/workspace'); office.sync(data);
      // decide what is selected before asking for its record
      const all = entries(data), waiting = needsYou(data);
      if (selected !== NEW && !all.some(e => e.id === selected)) selected = (all.find(e => waiting.has(e.id)) || all.find(e => e.status !== 'done'))?.id || NEW;
      const id = selected;
      if (id !== NEW) { const d = await api(`/api/workspace/works/${enc(id)}`); if (selected === id) detail = { id, ...d }; }
      render();
    } catch (e) { notice(`连接失败：${e.message}。页面不会重开任务。`, true); }
  });
  const refresh = () => refresher.now();
  async function action(button, fn, reload = true) {
    const done = pending(button);
    try { await fn(); if (reload) await refresh(); } catch (e) { notice(e.message, true); } finally { done(); }
  }
  const dialogs = createDialogs({ root, office, refresh, notice, person, data: () => data, setModels: m => { models = m; } });
  const composer = createComposer({ office, person, fillAvatars, data: () => data, hire: () => dialogs.employee(), select: id => select(id) });
  $('.ws-main').prepend(composer.el);
  const employeeOfJob = id => data.jobs.find(j => j.id === id)?.employee;
  const redraw = () => { lastHead = lastProcess = lastTrail = lastResult = ''; render(); };

  // ---------- clicks ----------
  root.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.dismiss !== undefined) $('#ws-notice').replaceChildren();
    if (d.hire !== undefined && !b.closest('#ws-compose')) dialogs.employee();
    if (d.new !== undefined) select(NEW);
    if (d.person) openEmployee(d.person);
    if (d.employeeEdit) dialogs.employee(data.employees.find(e => e.id === d.employeeEdit));
    if (d.view) setView(d.view);
    if (d.select) select(d.select);
    else if (d.step !== undefined && selected !== NEW) {
      // pressing the open share again closes it
      const idx = Number(d.step), opening = steps.get(selected) !== idx || b.closest('.ws-callout');
      steps.set(selected, opening ? idx : null); redraw();
      if (opening) { enter($('#ws-share'), 3); if (b.closest('.ws-callout')) { const box = $('#ws-share details'); if (box) { box.open = true; } $('#ws-share').scrollIntoView({ block: 'nearest', behavior: calm.matches ? 'auto' : 'smooth' }); } }
    }
    if (d.filter) { filter = d.filter; redraw(); }
    if (d.expand) { expanded.has(d.expand) ? expanded.delete(d.expand) : expanded.add(d.expand); redraw(); }
    if (d.call) dialogs.call(d.call);
    if (d.file && selected !== NEW) {
      fileOf.set(selected, d.file); if (d.file.startsWith('过程记录')) recordOpen = true;
      redraw(); $('#ws-viewer').scrollIntoView({ block: 'nearest', behavior: calm.matches ? 'auto' : 'smooth' });
    }
    if (d.source !== undefined && selected !== NEW) { const key = `${selected}|${fileOf.get(selected)}`; asSource.has(key) ? asSource.delete(key) : asSource.add(key); render(); }
    if (d.openFolder !== undefined) action(b, async () => { const r = await api(`/api/workspace/works/${enc(selected)}/open`, {}); notice(`已在文件管理器里打开：${r.dir}`); }, false);
    if (d.openRoot !== undefined) action(b, async () => { const r = await api('/api/workspace/outputs/open', {}); notice(`已在文件管理器里打开：${r.dir}`); }, false);
    if (d.copy) navigator.clipboard?.writeText(d.copy).then(() => notice('路径已复制'), () => notice(`复制失败，路径是：${d.copy}`, true)) ?? notice(`路径是：${d.copy}`);
    if (d.reply !== undefined) { const box = $('#ws-say').elements.body; box.scrollIntoView({ block: 'center', behavior: calm.matches ? 'auto' : 'smooth' }); box.focus({ preventScroll: true }); }
    if (d.locate) { setView('office'); office.locate(d.locate); }
    if (d.retryDiscussion) action(b, () => api(`/api/workspace/discussions/${d.retryDiscussion}/retry`, {}));
    if (d.startProject) action(b, () => api(`/api/workspace/projects/${d.startProject}/start`, {}));
    if (d.pause) action(b, () => api(`/api/workspace/projects/${d.pause}/pause`, { paused: d.paused === 'true' }));
    if (d.approve) action(b, async () => { const who = employeeOfJob(d.approve); await api(`/api/workspace/jobs/${enc(d.approve)}/approve`, {}); office.signal('approve', who); });
    if (d.accept) action(b, () => api(`/api/projects/${d.accept}/review`, { stars: stars.get(`p:${d.accept}`) ?? 3 }));
  });
  root.addEventListener('change', ev => { const m = ev.target.name?.match(/^stars-(\d+)$/); if (m) stars.set(`p:${m[1]}`, Number(ev.target.value)); });
  root.addEventListener('input', ev => {
    const f = ev.target.closest('form[data-revise],form[data-reject]');
    if (f && ev.target.name === 'feedback') drafts.set(f.dataset.revise || `reject:${f.dataset.reject}`, ev.target.value);
    if (ev.target.form?.id === 'ws-say' && sayFor) { sayDrafts.set(sayFor, ev.target.value); sendIds.delete(sayFor); }
  });
  root.addEventListener('toggle', ev => {
    if (ev.target.id === 'ws-done') doneOpen = ev.target.open;
    if (ev.target.matches?.('[data-record]')) recordOpen = ev.target.open;
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
  $('#ws-say').onsubmit = async ev => {
    ev.preventDefault();
    const form = ev.target, id = sayFor; if (!id) return;
    const pid = Number(id.slice(2)), done = pending(form.querySelector('button')), body = form.elements.body.value, target = Number(form.elements.targetRole.value);
    form.querySelector('.form-error').textContent = '';
    const clientId = sendIds.get(id) || crypto.randomUUID(); sendIds.set(id, clientId);
    try {
      await api(`/api/workspace/projects/${pid}/messages`, { body, targetRole: target, clientId });
      sayDrafts.delete(id); sendIds.delete(id); if (sayFor === id && form.elements.body.value === body) form.elements.body.value = '';
      office.signal('message', data.projects.find(p => p.id === pid)?.roles.find(r => r.idx === target)?.who);
      await refresh();
      const log = $('#ws-trail'); log.scrollTop = log.scrollHeight;
    } catch (e) { form.querySelector('.form-error').textContent = e.message; } finally { done(); }
  };

  // ---------- keys ----------
  root.addEventListener('keydown', ev => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && ev.target.matches('textarea')) ev.target.form?.requestSubmit(); });
  document.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.closest?.('input,textarea,select,[contenteditable]') || $('#ws-dialog').open) return;
    if (['1', '2'].includes(ev.key)) setView(VIEWS[ev.key - 1]);
    else if (ev.key.toLowerCase() === 'n') { ev.preventDefault(); select(NEW); }
  });

  await refresh();
  if (selected === NEW) composer.focus();
  // no point refreshing a page nobody is looking at; coming back catches up at once
  const tick = () => { if (!document.hidden) refresher.poll(); };
  let timer = setInterval(tick, 2000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresher.poll(); });
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.addEventListener('pageshow', e => { if (e.persisted) { refresh(); timer = setInterval(tick, 2000); } });
}
