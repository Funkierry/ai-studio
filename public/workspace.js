const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enc = encodeURIComponent;
const labels = { queued:'等待执行',running:'执行中',done:'已完成',review:'待验收',gate:'待确认',failed:'失败',blocked:'需要处理',interrupted:'调用中断',paused:'已暂停',wait:'待开始',open:'未启动',assigned:'旧版任务 · 待接管' };
const badge = s => `<span class="ws-state ${esc(s)}">${esc(labels[s] || s)}</span>`;
async function api(url, body) {
  const res = await fetch(url, body === undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

import { collaborationRoles, collaborationWorkorder } from './collaboration-plan.js';

export async function mountWorkspace({ office, models, onSnapshot, avatar }) {
  const css = document.createElement('link'); css.rel='stylesheet';css.href='/workspace.css';document.head.append(css);
  const root = document.createElement('main');root.id='workspace';document.body.prepend(root);
  root.innerHTML=`<header class="ws-top px"><div class="intro"><h1>AI 工作室</h1><p class="muted" id="ws-status">正在连接执行服务…</p></div><button class="btn primary" id="ws-create">＋ 新工作</button><button class="btn" id="ws-hire">添加员工</button><a class="btn" href="/company.html" target="_blank" rel="noopener">文件与记录 ↗</a></header>
    <nav class="ws-views" aria-label="工作区视图"><button class="btn" data-view="office" aria-pressed="true">像素工作室</button><button class="btn" data-view="tasks" aria-pressed="false">任务工作台</button><button class="btn" data-view="discussion" aria-pressed="false">项目讨论</button></nav>
    <div id="ws-notice" role="status"></div><div class="ws-grid">
    <section class="ws-office"><div id="ws-office"></div><p class="muted">点击小人查看工作，点击右侧任务查看交付。代码库和文档库仍在办公室里。 <a href="/character-preview.html" target="_blank" rel="noopener">角色动作预览 ↗</a></p></section>
    <section class="ws-panel ws-list"><h2>工作</h2><label><span>显示</span><select id="ws-filter"><option value="active">正在进行</option><option value="all">全部任务</option><option value="done">已完成</option></select></label><div id="ws-tasks" class="ws-tasks"></div></section>
    <section class="ws-panel" id="ws-detail" aria-label="任务详情"></section>
    <section class="ws-panel" id="ws-chat" aria-label="项目讨论"><div id="ws-chat-heading"></div><button class="btn" id="ws-chat-older" hidden>查看更早的消息</button><div id="ws-messages" role="log" aria-live="polite" aria-label="员工讨论记录"></div><p id="ws-chat-running" class="muted"></p><form id="ws-chat-form"><label><span>发给</span><select name="targetRole" aria-label="接收员工"></select></label><label><span>补充要求或回答员工的问题</span><textarea name="body" maxlength="6000" required placeholder="例如：先做最小可用版本，数据保存在本机；你们自行确定界面和接口。"></textarea></label><button class="btn primary" type="submit">发送到项目</button><p class="muted">消息会保留，并进入员工的实际上下文。正在执行的调用结束后再处理新消息。</p><p class="form-error" role="alert"></p></form></section>
    <aside class="ws-panel ws-team"><h2>员工</h2><p class="muted">只在真实调用期间占用员工</p><div id="ws-team"></div></aside></div>
    <dialog id="ws-dialog"></dialog>`;
  root.querySelector('#ws-office').append(office);
  const $ = s => root.querySelector(s);
  let data, selected = null, filter='active', busy=false, lastDetail='', lastTasks='', lastTeam='', dismissedNotice=false;
  const drafts=new Map(), expanded=new Set(), previews=new Map();
  const previewCache=new Map();
  const chatCache=new Map(),chatDrafts=new Map(),sendIds=new Map();
  let chatProject=null,chatLoading=false,lastChat='',lastChatHeading='';
  const person = id => data.employees.find(e=>e.id===id)?.name || id;
  const providerFor = e => {
    const type=e.profile?.type||e.id,mode=e.profile?.connection;
    return models?.providers?.[mode?models?.connections?.[mode]?.[type]:models?.types?.[type]];
  };
  const optEmployees = preferred => data.employees.map(e=>`<option value="${esc(e.id)}"${e.id===preferred?' selected':''}>${esc(e.name)} · ${esc(e.profile?.postLabel||e.profile?.post||e.model)}</option>`).join('');
  const notice = (message, error=false) => {$('#ws-notice').innerHTML=`<div class="ws-notice${error?' ws-error':''}">${esc(message)}</div>`;};
  function setView(view) {
    root.dataset.view=['tasks','discussion'].includes(view)?view:'office';
    for(const b of root.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===root.dataset.view));
    if(data&&view==='discussion'){renderChat();refreshMessages();}
    if(view==='discussion'&&selected?.startsWith('p:'))history.replaceState(null,'',`#discussion/${selected.slice(2)}`);
  }
  setView('office');
  office.addEventListener('studio-employee',ev=>{
    const discussing=data?.projects.find(p=>p.discussion?.some(t=>t.employee===ev.detail&&t.status==='running'));
    if(discussing){selected=`p:${discussing.id}`;setView('discussion');render();return;}
    const jobs=data?.jobs.filter(j=>j.employee===ev.detail)||[];
    const j=jobs.find(j=>j.status==='running')||jobs.find(j=>j.status!=='done')||jobs.at(-1);
    if(j){selected=j.project_id?`p:${j.project_id}`:`o:${j.order_id}`;lastDetail='';setView('tasks');render();}
    else notice(`${person(ev.detail)}当前没有执行中的工作，可以在「新工作」里指定为负责人。`);
  });
  function renderChat() {
    const p=data.projects.find(p=>selected===`p:${p.id}`),form=$('#ws-chat-form');
    if(!p){$('#ws-chat-heading').innerHTML='<h2>项目讨论</h2><p class="muted">选择一个项目，查看员工交流；新建自主协作任务后，真实发言会出现在这里。</p>';form.hidden=true;$('#ws-messages').replaceChildren();$('#ws-chat-running').textContent='';$('#ws-chat-older').hidden=true;chatProject=null;lastChat='';lastChatHeading='';return;}
    const changed=chatProject!==p.id;
    if(changed){chatProject=p.id;lastChat='';lastChatHeading='';form.elements.body.value=chatDrafts.get(p.id)||'';form.elements.targetRole.innerHTML=p.roles.map(r=>`<option value="${r.idx}">${esc(person(r.who))} · ${esc(r.name)}</option>`).join('');}
    form.hidden=false;
    const c=p.collaboration,failed=(p.discussion||[]).filter(t=>['failed','interrupted'].includes(t.status));
    const heading=`<h2>${esc(p.name)} · 项目讨论</h2>${badge(p.status)}<p class="muted">${c?.enabled?`自主协作 · 已自动返工 ${c.repairs}/${c.max_repairs} 轮 · 讨论调用上限 ${c.max_turns} 次`:'协作记录 · 可向负责人提问'}${p.tag?` · 已发布 ${esc(p.tag)}`:''}</p>${c?.reason?`<p class="ws-error">${esc(c.reason)}</p>`:''}${failed.map(t=>`<p class="ws-error">${esc(person(t.employee))}：${esc(t.error)} <button class="btn" data-retry-discussion="${t.id}">重试这次讨论</button></p>`).join('')}<div class="ws-actions"><button class="btn" data-view="tasks">查看分工与交付</button>${p.status!=='done'?`<button class="btn" data-pause="${p.id}" data-paused="${p.status!=='paused'}">${p.status==='paused'?'继续执行':'暂停后续步骤'}</button>`:''}</div>`;
    if(heading!==lastChatHeading){$('#ws-chat-heading').innerHTML=heading;lastChatHeading=heading;}
    const cache=chatCache.get(p.id),messages=cache?.messages||[];
    const signature=JSON.stringify(messages);
    if(signature!==lastChat){
      const log=$('#ws-messages'),bottom=changed||log.scrollHeight-log.scrollTop-log.clientHeight<70;
      const kind={request:'任务',message:'消息',discussion:'讨论',question:'提问',revision:'返工要求',delivery:'交付摘要',test_result:'执行结果',release:'发布',notice:'系统记录'};
      log.innerHTML=messages.length?messages.map(m=>`<article class="ws-message ${m.sender==='system'?'system':m.sender==='boss'?'boss':'employee'}" id="message-${m.id}"><div class="ws-message-meta"><b>${esc(m.sender==='system'?'执行系统':m.sender==='boss'?'你':person(m.sender))}</b><span>→ ${esc(m.recipient==='team'?'全体':m.recipient==='boss'?'你':person(m.recipient))}</span><small>${esc(kind[m.kind]||m.kind)} · ${esc(new Date(m.created_at.replace(' ','T')+'Z').toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</small></div>${m.reply_to?`<a href="#message-${m.reply_to}" class="ws-reply">回复 #${m.reply_to}</a>`:''}<p>${esc(m.body)}</p>${m.meta?.provider?`<small class="muted">${m.meta.provider==='fake'?'测试替身':esc(m.meta.model||m.meta.provider)} · 调用记录 #${m.id}</small>`:''}${m.meta?.artifacts?`<div class="ws-actions">${links(m.meta)}</div>`:''}</article>`).join(''):'<p class="ws-empty">这里还没有讨论记录。旧项目只保留原有交付，新建自主协作任务会从开工讨论开始记录。</p>';
      if(bottom)log.scrollTop=log.scrollHeight;lastChat=signature;
    }
    $('#ws-chat-older').hidden=!cache?.hasOlder;
    const running=(p.discussion||[]).filter(t=>t.status==='running').map(t=>person(t.employee));
    $('#ws-chat-running').textContent=running.length?`${running.join('、')} 正在阅读项目材料并回复…`:p.status==='paused'?'项目已暂停。消息会保存，后续调用等待继续执行。':'';
  }
  async function refreshMessages(older=false) {
    if(chatLoading||root.dataset.view!=='discussion'||!chatProject)return;
    const pid=chatProject,cache=chatCache.get(pid);chatLoading=true;
    try{
      const query=older&&cache?.messages.length?`?before=${cache.messages[0].id}`:cache?.messages.length?`?after=${cache.messages.at(-1).id}`:'';
      const result=await api(`/api/workspace/projects/${pid}/messages${query}`);
      const messages=[...new Map([...(cache?.messages||[]),...result.messages].map(m=>[m.id,m])).values()].sort((a,b)=>a.id-b.id);
      chatCache.set(pid,{messages,hasOlder:older||!cache?result.hasOlder:cache.hasOlder});
      const log=$('#ws-messages'),height=log.scrollHeight,top=log.scrollTop;
      if(chatProject===pid){renderChat();if(older)log.scrollTop=top+log.scrollHeight-height;}
    }catch(e){if(chatProject===pid)$('#ws-chat-running').textContent=`讨论记录读取失败：${e.message}`;}finally{chatLoading=false;}
  }
  function entries() {
    return [...data.projects.map(p=>({id:`p:${p.id}`,title:p.name,status:p.status==='done'||data.jobs.some(j=>j.project_id===p.id)?p.status:'wait',p})), ...data.orders.filter(o=>!data.projects.some(p=>p.order_id===o.id)).map(o=>({id:`o:${o.id}`,title:o.title,status:data.jobs.find(j=>j.order_id===o.id)?.status||o.status,o}))];
  }
  function links(result) {
    const arts=result?.artifacts||[];
    return arts.filter(a=>a.type==='doc'||a.type==='commit').map(a=>a.type==='doc'
      ? `<a class="btn" href="/company.html#docs/${enc(a.path)}" target="_blank" rel="noopener">${/测试/.test(a.path.split('/').at(-1))?'测试报告':'交付文档'} ↗</a>`
      : `<a class="btn" href="/company.html#git/${enc(a.repo)}/${enc(a.branch)}/tree" target="_blank" rel="noopener">代码文件 ↗</a><a class="btn" href="/company.html#git/${enc(a.repo)}/${enc(a.branch)}/log" target="_blank" rel="noopener">代码差异 ↗</a><button class="btn" data-preview="${esc(a.repo)}" data-ref="${esc(a.branch)}">预览页面</button>`).join('');
  }
  function jobHTML(j, name) {
    const r=j.result||{}, test=r.artifacts?.find(a=>a.type==='test');
    const project=data.projects.find(p=>p.id===j.project_id),role=project?.roles.find(r=>r.idx===j.role_idx);
    const dependencies=(role?.deps||[]).map(idx=>project.roles.find(r=>r.idx===idx)).filter(Boolean);
    return `<article class="ws-role"><h3>${esc(name)} · ${esc(person(j.employee))}</h3>${badge(j.status)}${j.attempt?` <small class="muted">第 ${j.attempt} 次调用</small>`:''}
      ${dependencies.length?`<p class="muted">依赖交付：${dependencies.map(d=>`${esc(d.name)}（${esc(person(d.who))}）`).join('、')}</p>`:''}
      ${j.waiting?`<p class="muted">${esc(j.waiting)}</p>`:''}${j.started_at?`<p class="muted">开始：${esc(j.started_at)} UTC${j.finished_at?` · 结束：${esc(j.finished_at)} UTC`:''}</p>`:''}
      ${['running','queued'].includes(j.status)&&r.artifacts?.length?'<p class="muted">以下为上一版交付，本次修改完成后更新。</p>':''}
      ${j.error?`<p class="ws-error">${esc(j.error)}</p>`:''}${r.summary?`<p>${esc(r.summary)}</p>`:''}
      ${test?`<div class="ws-test${test.fail||!test.pass?' bad':''}">实际测试：通过 ${test.pass} · 失败 ${test.fail} · 跳过 ${test.skipped||0}</div>`:''}
      <div class="ws-actions">${links(r)}${j.status==='review'?`<button class="btn primary" data-approve="${esc(j.id)}">${j.project_id?'确认这份分工':'验收通过'}</button>`:''}</div>
      ${!['running','queued'].includes(j.status)?`<details><summary>修改 / 重试这份分工</summary><form data-revise="${esc(j.id)}"><label><span>具体修改要求（依赖这份交付的后续步骤会重新执行）</span><textarea name="feedback" required placeholder="例如：减号按钮没有响应，请修复并补充测试"></textarea></label><button class="btn" type="submit">提交修改并执行</button></form></details>`:''}</article>`;
  }
  function render() {
    const all=entries(), visible=all.filter(e=>e.id===selected||filter==='all'||(filter==='done'?e.status==='done':e.status!=='done'));
    if (!selected) selected=visible[0]?.id||null;
    const status=`v${data.version} · 服务端执行 · 刷新或关闭页面不会停止任务 · 已记录模型费用 ¥${data.spent.toFixed(2)}`;
    if($('#ws-status').textContent!==status)$('#ws-status').textContent=status;
    if (!dismissedNotice && data.demoHidden) {notice(`已隐藏 ${data.demoHidden} 条旧演示订单，它们不会自动执行。原记录仍可在「文件与记录」查看。`);dismissedNotice=true;}
    const taskHTML=visible.length?visible.map(e=>`<button class="ws-task" data-select="${esc(e.id)}" aria-current="${e.id===selected}"><b>${esc(e.title)}</b>${badge(e.status)}</button>`).join(''):`<p class="ws-empty">${all.length?'没有符合当前筛选的工作。<br>可切换为「全部任务」。':'这里还没有工作。<br>点「新工作」开始。'}</p>`;
    if(taskHTML!==lastTasks){$('#ws-tasks').innerHTML=taskHTML;lastTasks=taskHTML;}
    const entry=all.find(e=>e.id===selected), detail=$('#ws-detail');
    renderChat();
    const signature=JSON.stringify([entry,data.jobs.filter(j=>entry?.p?j.project_id===entry.p.id:j.order_id===entry?.o?.id),data.employees]);
    const editing=detail.contains(document.activeElement)&&document.activeElement.matches('textarea,input,select');
    if (signature!==lastDetail && !editing) {
      lastDetail=signature;
      if (!entry) detail.innerHTML='<div class="ws-empty"><h2>把需求交给员工</h2><p>填写目标、选择负责人，代码任务会自动接力到测试。</p></div>';
      else if (entry.p) {
        const p=entry.p, jobs=data.jobs.filter(j=>j.project_id===p.id);
        detail.innerHTML=`<h2>${esc(p.name)}</h2>${badge(entry.status)}<p class="ws-goal">${esc(p.goal)}</p><div class="ws-actions">
          ${!jobs.length&&p.status!=='done'?`<button class="btn primary" data-start-project="${p.id}">启动这个项目</button>`:''}
          ${jobs.length&&p.status!=='done'?`<button class="btn" data-pause="${p.id}" data-paused="${p.status!=='paused'}">${p.status==='paused'?'继续执行':'暂停后续步骤'}</button>`:''}
          ${p.status==='review'?`<button class="btn primary" data-accept="${p.id}">运行集成检查并验收</button>`:''}
          <button class="btn" data-view="discussion">查看项目讨论</button>
          <a class="btn" href="/company.html#git/${enc(p.slug)}/main/tree" target="_blank" rel="noopener">项目代码 ↗</a></div>
          ${p.status==='paused'?'<p class="muted">后续步骤已暂停。已经发出的模型调用会完成并保留结果。</p>':''}
          ${p.tag?`<p>已发布 ${esc(p.tag)}</p>`:''}
          ${p.roles.map(r=>{const j=jobs.find(j=>j.role_idx===r.idx);return j?jobHTML(j,r.name):`<article class="ws-role"><h3>${esc(r.name)} · ${esc(person(r.who))}</h3>${badge(r.status)}<p class="muted">${esc(r.description)}</p><div class="ws-actions">${links({artifacts:r.artifacts})}</div><p>${p.status==='done'||r.status==='done'?'已保留旧版交付':r.status==='gate'?'启动项目后恢复待确认的交付':'等待你启动项目'}</p></article>`;}).join('')}`;
      } else {
        const o=entry.o,j=data.jobs.find(j=>j.order_id===o.id);
        detail.innerHTML=`<h2>${esc(o.title)}</h2><p class="ws-goal">${esc(o.spec.detail||o.brief)}</p>${j?jobHTML(j,'交付'):`<form data-start-order="${esc(o.id)}"><label><span>负责人</span><select name="employee">${optEmployees()}</select></label><button class="btn primary">开始执行</button></form>`}`;
      }
      for(const f of detail.querySelectorAll('form[data-revise]')) {
        f.elements.feedback.value=drafts.get(f.dataset.revise)||'';
        f.closest('details').open=expanded.has(f.dataset.revise);
      }
      for(const b of detail.querySelectorAll('[data-preview]')) {
        const box=previews.get(`${b.dataset.preview}:${b.dataset.ref}`);
        if(box)b.closest('.ws-role').append(box);
      }
    }
    const conversations=data.projects.flatMap(p=>(p.discussion||[]).filter(t=>t.status==='running'));
    const teamSignature=JSON.stringify([data.employees,data.jobs.filter(j=>j.status==='running').map(j=>j.employee),conversations]);
    if(teamSignature===lastTeam)return;
    lastTeam=teamSignature;$('#ws-team').replaceChildren();
    for(const e of data.employees) {
      const el=document.createElement('div');el.className='ws-person';el.append(avatar(e));
      const content=document.createElement('div'),running=data.jobs.find(j=>j.employee===e.id&&j.status==='running');
      const provider=providerFor(e),occupied=!!running||conversations.some(t=>t.employee===e.id);
      content.innerHTML=`<b>${esc(e.name)}</b><small>${esc(e.profile?.postLabel||e.profile?.post||'通用')} · ${conversations.some(t=>t.employee===e.id)?'参与项目讨论':running?'执行中':'可接新任务'}</small><small>${models?.fake?'测试替身':`${provider?.connection==='local'?'本机':'API 接入'} · ${esc(provider?.model||'未接入模型')}`}</small><button class="btn ws-access-button" data-employee-connection="${esc(e.id)}"${occupied?' disabled':''} aria-label="${esc(e.name)}的接入设置">接入设置</button>`;
      el.append(content);$('#ws-team').append(el);
    }
    if(!data.employees.length) $('#ws-team').innerHTML='<p class="ws-empty">先添加一位员工</p>';
  }
  async function refresh() {
    if(busy) return;busy=true;
    try {data=await api('/api/workspace');onSnapshot(data);render();await refreshMessages();} catch(e){notice(`连接失败：${e.message}。页面不会重开任务。`,true);} finally{busy=false;}
  }
  async function action(button, fn, reload=true) {
    button.disabled=true;
    try {await fn();if(reload){lastDetail='';await refresh();}} catch(e){notice(e.message,true);} finally{if(button.isConnected)button.disabled=false;}
  }
  function dialog(html, submit, submitLabel='开始') {
    const d=$('#ws-dialog');d.innerHTML=`<form>${html}<p class="form-error" role="alert"></p><div class="ws-actions"><button class="btn primary" type="submit">${esc(submitLabel)}</button><button class="btn" type="button" data-close>取消</button></div></form>`;
    d.querySelector('[data-close]').onclick=()=>d.close();d.showModal();
    d.querySelector('form').onsubmit=async ev=>{ev.preventDefault();const b=d.querySelector('[type=submit]');b.disabled=true;try{await submit(new FormData(ev.target));d.close();lastDetail='';await refresh();}catch(e){d.querySelector('.form-error').textContent=e.message;}finally{b.disabled=false;}};
    return d;
  }
  $('#ws-create').onclick=()=>{
    if(!data)return;
    if(!data.employees.length){notice('请先添加员工');return;}
    const developer=data.employees.find(e=>['frontend','backend','code'].includes(e.profile?.post))||data.employees[0];
    const tester=data.employees.find(e=>e.profile?.post==='test')||data.employees.find(e=>e.id!==developer.id)||developer;
    const planner=data.employees.find(e=>e.profile?.post==='pm')||data.employees[0];
    const backend=data.employees.find(e=>e.profile?.post==='backend'&&e.id!==planner.id)||developer;
    const frontend=data.employees.find(e=>e.profile?.post==='frontend'&&![planner.id,backend.id].includes(e.id))||data.employees.find(e=>['frontend','backend','code'].includes(e.profile?.post)&&![planner.id,backend.id].includes(e.id))||data.employees.find(e=>![planner.id,backend.id].includes(e.id))||developer;
    const integrator=data.employees.find(e=>e.profile?.post==='test'&&![planner.id,backend.id,frontend.id].includes(e.id))||data.employees.find(e=>['frontend','backend','code'].includes(e.profile?.post)&&![planner.id,backend.id,frontend.id].includes(e.id))||data.employees.find(e=>![planner.id,backend.id,frontend.id].includes(e.id))||tester;
    const orderId=crypto.randomUUID();
    const d=dialog(`<h2>新工作</h2>
      <label><span>标题（可留空）</span><input name="title" maxlength="80" placeholder="留空时使用需求的第一行"></label>
      <label><span>要做什么、怎样算完成</span><textarea name="goal" required placeholder="目标、功能、限制和验收标准"></textarea></label>
      <label><span>交付方式</span><select name="kind">
        <option value="team" selected>团队协作：讨论 → 分工 → 集成测试</option>
        <option value="code">小型代码：开发 → 测试 → 验收</option>
        <option value="doc">文档：撰写 → 验收</option>
      </select></label>
      <div data-team>
        <label class="ws-check"><input type="checkbox" name="autonomous" checked><span>员工自主沟通、返工并验收</span></label>
        <p class="muted">填写任务即可开始。员工先讨论共同约定，再分工执行；测试失败自动转派修复（最多 2 轮）。你可随时旁观、插话或暂停。</p>
        <details><summary>查看或调整团队成员</summary>
        <label><span>需求规划负责人</span><select name="planner">${optEmployees(planner.id)}</select></label>
        <label><span>后端开发负责人</span><select name="backend">${optEmployees(backend.id)}</select></label>
        <label><span>前端开发负责人</span><select name="frontend">${optEmployees(frontend.id)}</select></label>
        <label><span>集成测试负责人</span><select name="integrator">${optEmployees(integrator.id)}</select></label>
        </details>
      </div>
      <label data-owner hidden><span>负责人</span><select name="owner">${optEmployees(developer.id)}</select></label>
      <label data-tester hidden><span>代码测试负责人</span><select name="tester">${optEmployees(tester.id)}</select></label>`,async f=>{
      f.set('title',String(f.get('title')||'').trim()||String(f.get('goal')).trim().split('\n')[0].slice(0,60));
      if(f.get('kind')==='team') {
        const autonomous=f.get('autonomous')==='on';
        const roles=collaborationRoles({planner:f.get('planner'),backend:f.get('backend'),frontend:f.get('frontend'),tester:f.get('integrator'),autonomous});
        const p=await api('/api/projects',{name:f.get('title'),goal:f.get('goal'),roles,autonomous,workorder:collaborationWorkorder(f.get('title'),f.get('goal'),roles,data.employees)});
        selected=`p:${p.id}`;
      }else if(f.get('kind')==='code') {
        const p=await api('/api/projects',{name:f.get('title'),goal:f.get('goal'),roles:[
          {name:'代码开发',who:f.get('owner'),deps:[],gate:false,out:'可运行代码与 README',desc:'按目标实现可运行代码，README 写清运行方法；把核心逻辑与 UI 分离，供后续 node:test 验证。'},
          {name:'测试验收',who:f.get('tester'),deps:[0],gate:false,out:'tests/ 下的自动化测试与测试报告',desc:'阅读上游实现，用 node:test 测试真实代码和关键流程，不要复制实现充当测试；不适用的后端要求无需添加。'}]});selected=`p:${p.id}`;
      }else{
        const id=orderId;await api('/api/orders',{id,title:f.get('title'),brief:f.get('goal'),source:'custom',spec:{detail:f.get('goal'),deliverable:{kind:'doc'}}});
        await api(`/api/workspace/orders/${enc(id)}/start`,{employee:f.get('owner')});selected=`o:${id}`;
      }
      setView(f.get('kind')==='team'?'discussion':'tasks');
    });
    d.querySelector('[name=kind]').onchange=e=>{
      d.querySelector('[data-team]').hidden=e.target.value!=='team';
      d.querySelector('[data-owner]').hidden=e.target.value==='team';
      d.querySelector('[data-tester]').hidden=e.target.value!=='code';
    };
  };
  async function employeeDialog(employee) {
    try {
      models=await api('/api/models');
      if(!models.connections)throw new Error('接入选项需要新版服务，请重启工作室后刷新。');
      const currentType=employee?.profile?.type||employee?.id;
      const preferred=employee?providerFor(employee)?.connection:null;
      const initialMode=preferred||(Object.values(models.connections.local).some(id=>models.fake||models.providers[id]?.configured)?'local':'api');
      const d=dialog(`<h2>${employee?`${esc(employee.name)} · 接入设置`:'添加员工'}</h2>
        ${employee?'':'<label><span>名字</span><input name="name" required maxlength="40"></label>'}
        <fieldset class="ws-connections"><legend>接入方式</legend>
          <label class="ws-connection-option"><input type="radio" name="connection" value="local"${initialMode==='local'?' checked':''}><span><b>本机</b><small>使用本机的 Claude Code、Codex 或已配置的本地模型服务</small></span></label>
          <label class="ws-connection-option"><input type="radio" name="connection" value="api"${initialMode==='api'?' checked':''}><span><b>API 接入</b><small>使用配置好密钥的模型服务</small></span></label>
        </fieldset><p class="muted" data-connection-hint></p>
        <label><span data-model-label>工具 / 模型</span><select name="type" required></select></label><p class="muted" data-model-hint></p>
        ${employee?'<p class="muted">保存后用于这位员工后续的讨论和交付。姓名、岗位及历史记录保留。</p>':'<label><span>岗位</span><select name="post"><option value="frontend">前端开发</option><option value="backend">后端开发</option><option value="test">测试</option><option value="writing">文案写作</option><option value="general">通用</option></select></label><label><span>专长</span><input name="persona"></label>'}`,
        f=>api(employee?`/api/workspace/employees/${enc(employee.id)}/connection`:'/api/workspace/employees',Object.fromEntries(f)),employee?'保存接入设置':'添加员工');
      const form=d.querySelector('form'),select=form.elements.type,submit=d.querySelector('[type=submit]');
      function showProvider() {
        const mode=form.elements.connection.value,p=models.providers[models.connections[mode][select.value]];
        const ready=!!p&&(models.fake||p.configured);
        submit.disabled=!ready;
        d.querySelector('[data-model-hint]').textContent=p?`${p.model} · ${p.hint}${!ready&&mode==='api'?'。在项目的 .env 中配置相应密钥，再重启工作室。':''}`:'没有可用的接入配置。';
      }
      function showMode() {
        const mode=form.elements.connection.value,last=select.value||currentType;
        const entries=Object.entries(models.connections[mode]).filter(([type])=>type===currentType||!(mode==='local'&&type==='gpt')&&!(mode==='api'&&type==='codex'));
        select.innerHTML=entries.map(([type,id])=>{const p=models.providers[id];return `<option value="${esc(type)}">${esc(p.name)}${!models.fake&&!p.configured?'（未配置）':''}</option>`;}).join('');
        select.value=entries.some(([type])=>type===last)?last:entries.find(([,id])=>models.fake||models.providers[id].configured)?.[0]||entries[0]?.[0]||'';
        d.querySelector('[data-model-label]').textContent=mode==='local'?'本机工具 / 模型':'API 模型';
        d.querySelector('[data-connection-hint]').textContent=mode==='local'?'Claude Code 和 Codex 使用本机登录配置，仍可能访问云端模型；本机不等于离线运行。':'API 使用服务端已有的密钥配置，模型用量按提供商计费。';
        showProvider();
      }
      for(const radio of form.querySelectorAll('[name=connection]'))radio.onchange=showMode;
      select.onchange=showProvider;showMode();
    } catch(e) { notice(e.message,true); }
  }
  $('#ws-hire').onclick=()=>employeeDialog();
  $('#ws-filter').onchange=e=>{filter=e.target.value;selected=null;lastDetail='';render();};
  root.addEventListener('click',ev=>{
    const b=ev.target.closest('button');if(!b)return;
    if(b.dataset.employeeConnection)employeeDialog(data.employees.find(e=>e.id===b.dataset.employeeConnection));
    if(b.dataset.view)setView(b.dataset.view);
    if(b.dataset.select){selected=b.dataset.select;lastDetail='';setView(root.dataset.view==='discussion'?'discussion':'tasks');render();}
    if(b.dataset.retryDiscussion)action(b,()=>api(`/api/workspace/discussions/${b.dataset.retryDiscussion}/retry`,{}));
    if(b.dataset.startProject)action(b,()=>api(`/api/workspace/projects/${b.dataset.startProject}/start`,{}));
    if(b.dataset.pause)action(b,()=>api(`/api/workspace/projects/${b.dataset.pause}/pause`,{paused:b.dataset.paused==='true'}));
    if(b.dataset.approve)action(b,()=>api(`/api/workspace/jobs/${enc(b.dataset.approve)}/approve`,{}));
    if(b.dataset.accept)action(b,()=>api(`/api/projects/${b.dataset.accept}/review`,{stars:3}));
    if(b.dataset.preview)action(b,async()=>{
      const repo=b.dataset.preview,ref=b.dataset.ref,k=`${repo}:${ref}`;
      let file=previewCache.get(k);
      if(!file){const files=await api('/api/git/tree?'+new URLSearchParams({repo,ref}));file=files.find(f=>f==='web/index.html')||files.find(f=>f==='index.html')||files.find(f=>f.endsWith('.html'));if(file)previewCache.set(k,file);}
      if(!file)throw new Error('这份交付没有 HTML 页面；请在交付文档查看运行方法');
      const url=`${data.previewBase}/${enc(repo)}/${enc(ref)}/${file.split('/').map(enc).join('/')}`;
      const box=document.createElement('div');box.className='ws-preview';box.innerHTML=`<p class="muted">静态页面预览 · 后端服务需按 README 启动</p><p><a href="${esc(url)}" target="_blank" rel="noopener">在新页打开预览 ↗</a></p><iframe title="交付页面预览" sandbox="allow-scripts allow-same-origin" src="${esc(url)}"></iframe>`;
      previews.set(k,box);
      const card=b.closest('.ws-role,.ws-message');card.querySelector('.ws-preview')?.remove();card.append(box);
    },false);
  });
  $('#ws-chat-older').onclick=()=>refreshMessages(true);
  $('#ws-chat-form').elements.body.addEventListener('input',e=>{if(chatProject){chatDrafts.set(chatProject,e.target.value);sendIds.delete(chatProject);}});
  $('#ws-chat-form').onsubmit=async ev=>{
    ev.preventDefault();const form=ev.target,pid=chatProject;if(!pid)return;
    const button=form.querySelector('button'),body=form.elements.body.value;button.disabled=true;form.querySelector('.form-error').textContent='';
    const clientId=sendIds.get(pid)||crypto.randomUUID();sendIds.set(pid,clientId);
    try{await api(`/api/workspace/projects/${pid}/messages`,{body,targetRole:Number(form.elements.targetRole.value),clientId});chatDrafts.delete(pid);sendIds.delete(pid);if(chatProject===pid&&form.elements.body.value===body)form.elements.body.value='';await refresh();}
    catch(e){form.querySelector('.form-error').textContent=e.message;}finally{button.disabled=false;}
  };
  root.addEventListener('input',ev=>{const f=ev.target.closest('form[data-revise]');if(f)drafts.set(f.dataset.revise,f.elements.feedback.value);});
  root.addEventListener('toggle',ev=>{const f=ev.target.querySelector?.('form[data-revise]');if(f){if(ev.target.open)expanded.add(f.dataset.revise);else expanded.delete(f.dataset.revise);}},true);
  root.addEventListener('submit',ev=>{
    const form=ev.target;if(!form.dataset.revise&&!form.dataset.startOrder)return;ev.preventDefault();
    const f=new FormData(form);action(form.querySelector('button'),async()=>{
      if(form.dataset.revise){await api(`/api/workspace/jobs/${enc(form.dataset.revise)}/revise`,{feedback:f.get('feedback')});drafts.delete(form.dataset.revise);expanded.delete(form.dataset.revise);}
      else await api(`/api/workspace/orders/${enc(form.dataset.startOrder)}/start`,{employee:f.get('employee')});
    });
  });
  const discussionLink=location.hash.match(/^#discussion\/(\d+)$/);if(discussionLink){selected=`p:${discussionLink[1]}`;filter='all';$('#ws-filter').value='all';setView('discussion');}
  await refresh();let timer=setInterval(refresh,2000);
  window.addEventListener('pagehide',()=>clearInterval(timer));
  window.addEventListener('pageshow',e=>{if(e.persisted){refresh();timer=setInterval(refresh,2000);}});
}
