const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enc = encodeURIComponent;
const labels = { queued:'排队中',running:'执行中',done:'已完成',review:'待验收',gate:'待确认',failed:'失败',blocked:'需要处理',interrupted:'调用中断',paused:'已暂停',wait:'待开始',open:'未启动',assigned:'旧版任务 · 待接管' };
const badge = s => `<span class="ws-state ${esc(s)}">${esc(labels[s] || s)}</span>`;
const POSTS = [['pm','产品经理'],['frontend','前端开发'],['backend','后端开发'],['test','测试'],['design','设计'],['research','调研分析'],['writing','文案写作'],['general','通用']];
// employees hired in the old office page used these post names
const postKey = k => ({qa:'test',writer:'writing'}[k] || (POSTS.some(([p])=>p===k) ? k : 'general'));
// the server stores UTC; everything on screen is local time
const when = s => new Date(String(s).replace(' ','T')+'Z');
const clock = s => when(s).toLocaleString([], {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const lasted = (a,b) => {const sec=Math.max(0,Math.round((when(b)-when(a))/1000));return sec<60?`${sec} 秒`:`${Math.floor(sec/60)} 分 ${sec%60} 秒`;};
async function api(url, body) {
  const res = await fetch(url, body === undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

import { collaborationRoles, collaborationWorkorder } from './collaboration-plan.js';
import { patch } from './dom-patch.js';
import { createRefresher } from './live-refresh.js';

const calm = matchMedia('(prefers-reduced-motion: reduce)');
// the entering page arrives with a short slide; polling never calls this, only the boss's own moves do
const enter = (el, distance = 6) => {
  if (calm.matches || !el?.animate) return;
  el.animate([{opacity:0,transform:`translateY(${distance}px)`},{opacity:1,transform:'none'}],{duration:170,easing:'cubic-bezier(.2,.8,.3,1)'});
};
// Pressing a button shows at once that it registered. The spinner only appears if the answer takes a moment,
// so quick actions don't flicker.
function pending(button) {
  button.disabled=true;button.dataset.pending='';
  const slow=setTimeout(()=>button.classList.add('ws-loading'),160);
  return ()=>{clearTimeout(slow);delete button.dataset.pending;button.classList.remove('ws-loading');button.disabled=false;};
}
const setText = (el, text) => { if(el.textContent!==text)el.textContent=text; };

export async function mountWorkspace({ office, models, onSnapshot, avatar, defaultName }) {
  const root = document.createElement('main');root.id='workspace';document.body.prepend(root);
  root.innerHTML=`<header class="ws-top px"><h1>AI 工作室</h1>
    <nav class="ws-views" aria-label="工作区视图"><button data-view="office" aria-pressed="true">办公室</button><button data-view="tasks" aria-pressed="false">任务详情</button><button data-view="discussion" aria-pressed="false">项目讨论</button><i class="ws-ink" aria-hidden="true"></i></nav>
    <span class="muted ws-spent" id="ws-status"></span><a class="btn" href="/company.html" target="_blank" rel="noopener">文件与记录 ↗</a><button class="btn primary" id="ws-create">＋ 新工作</button></header>
    <div id="ws-notice" role="status"></div><div class="ws-grid">
    <div class="ws-main"><section class="ws-office"><div id="ws-office"></div></section>
    <section class="ws-panel" id="ws-detail" aria-label="任务详情"></section>
    <section class="ws-panel" id="ws-chat" aria-label="项目讨论"><div id="ws-chat-heading"></div><button class="btn" id="ws-chat-older" hidden>查看更早的消息</button><div id="ws-messages" role="log" aria-live="polite" aria-label="员工讨论记录"></div><p id="ws-chat-running" class="muted"></p><form id="ws-chat-form"><textarea name="body" maxlength="6000" required aria-label="发给员工的消息" placeholder="补充要求或回答员工的问题。消息会进入员工的实际上下文，正在执行的调用结束后处理。"></textarea><div class="ws-send"><label><span>发给</span><select name="targetRole" aria-label="接收员工"></select></label><button class="btn primary" type="submit">发送</button></div><p class="form-error" role="alert"></p></form></section></div>
    <div class="ws-side"><section class="ws-panel ws-inbox" id="ws-inbox" hidden><h2>等你处理 <span class="ws-count" id="ws-inbox-count"></span></h2><div id="ws-inbox-list" class="ws-tasks"></div></section>
    <section class="ws-panel ws-list"><h2>工作</h2><div id="ws-tasks" class="ws-tasks"></div></section>
    <aside class="ws-panel ws-team"><div class="ws-panel-head"><h2>员工</h2><button class="btn" data-hire>＋ 添加</button></div><div id="ws-team"></div></aside>
    <p class="muted ws-foot"><span id="ws-version"></span> · 关闭页面任务也会继续 · <a href="/character-preview.html" target="_blank" rel="noopener">角色动作预览 ↗</a></p></div></div>
    <dialog id="ws-dialog"></dialog>`;
  root.querySelector('#ws-office').append(office);
  const $ = s => root.querySelector(s);
  let data, selected = null, lastDetail='', lastTasks='', lastTeam='', dismissedNotice=false, noticeTimer=null, workDraft='', doneOpen=false;
  const roleOpen=new Map(),teamRows=new Map();
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
  const notice = (message, error=false) => {
    clearTimeout(noticeTimer);
    $('#ws-notice').innerHTML=`<div class="ws-notice${error?' ws-error':''}"><span>${esc(message)}</span><button class="link" data-dismiss aria-label="关闭提示">关闭</button></div>`;
    if(!error)noticeTimer=setTimeout(()=>$('#ws-notice').replaceChildren(),6000);
  };
  function setView(view) {
    const before=root.dataset.view;
    root.dataset.view=['tasks','discussion'].includes(view)?view:'office';
    for(const b of root.querySelectorAll('.ws-views [data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===root.dataset.view));
    moveInk();
    if(before&&before!==root.dataset.view)enter($({office:'.ws-office',tasks:'#ws-detail',discussion:'#ws-chat'}[root.dataset.view]));
    if(data&&root.dataset.view==='discussion'){renderChat();refreshMessages();}
    if(view==='discussion'&&selected?.startsWith('p:'))history.replaceState(null,'',`#discussion/${selected.slice(2)}`);
    else if(location.hash.startsWith('#discussion'))history.replaceState(null,'',location.pathname);
  }
  // the marker under the view names slides to the chosen one
  function moveInk() {
    const button=root.querySelector('.ws-views [aria-pressed=true]'),ink=$('.ws-ink');
    ink.style.width=`${button.offsetWidth}px`;ink.style.transform=`translateX(${button.offsetLeft}px)`;
  }
  new ResizeObserver(moveInk).observe($('.ws-views'));
  setView('office');
  // clicking someone in the office or the staff list shows what they are on; someone who never worked opens their settings
  function openEmployee(id) {
    if(!data)return;
    const discussing=data.projects.find(p=>p.discussion?.some(t=>t.employee===id&&t.status==='running'));
    if(discussing){selected=`p:${discussing.id}`;setView('discussion');render();return;}
    const jobs=data.jobs.filter(j=>j.employee===id);
    const j=jobs.find(j=>j.status==='running')||jobs.find(j=>j.status!=='done')||jobs.at(-1);
    if(j){selected=j.project_id?`p:${j.project_id}`:`o:${j.order_id}`;lastDetail='';setView('tasks');render();}
    else employeeDialog(data.employees.find(e=>e.id===id));
  }
  office.addEventListener('studio-employee',ev=>openEmployee(ev.detail));
  function renderChat() {
    const p=data.projects.find(p=>selected===`p:${p.id}`),form=$('#ws-chat-form');
    if(!p){$('#ws-chat-heading').innerHTML='<h2>项目讨论</h2><p class="muted">选择一个项目，查看员工交流；新建自主协作任务后，真实发言会出现在这里。</p>';form.hidden=true;$('#ws-messages').replaceChildren();$('#ws-chat-running').textContent='';$('#ws-chat-older').hidden=true;chatProject=null;lastChat='';lastChatHeading='';return;}
    const changed=chatProject!==p.id;
    if(changed){chatProject=p.id;lastChat='';lastChatHeading='';form.elements.body.value=chatDrafts.get(p.id)||'';form.elements.targetRole.innerHTML=p.roles.map(r=>`<option value="${r.idx}">${esc(person(r.who))} · ${esc(r.name)}</option>`).join('');}
    form.hidden=false;
    const c=p.collaboration,failed=(p.discussion||[]).filter(t=>['failed','interrupted'].includes(t.status));
    const heading=`<div class="ws-head"><h2>${esc(p.name)}</h2>${badge(p.status)}</div><p class="muted">${c?.enabled?`自主协作 · 已自动返工 ${c.repairs}/${c.max_repairs} 轮 · 讨论调用上限 ${c.max_turns} 次`:'协作记录 · 可向负责人提问'}${p.tag?` · 已发布 ${esc(p.tag)}`:''}</p>${c?.reason?`<p class="ws-error">${esc(c.reason)}</p>`:''}${failed.map(t=>`<p class="ws-error">${esc(person(t.employee))}：${esc(t.error)} <button class="btn" data-retry-discussion="${t.id}">重试这次讨论</button></p>`).join('')}<div class="ws-actions">${p.status!=='done'?`<button class="btn" data-pause="${p.id}" data-paused="${p.status!=='paused'}">${p.status==='paused'?'继续执行':'暂停后续步骤'}</button>`:''}<a class="btn" href="/company.html#chat" target="_blank" rel="noopener">搜索协作记录 ↗</a></div>`;
    if(heading!==lastChatHeading){$('#ws-chat-heading').innerHTML=heading;lastChatHeading=heading;}
    const cache=chatCache.get(p.id),messages=cache?.messages||[];
    const signature=JSON.stringify(messages);
    if(signature!==lastChat){
      const log=$('#ws-messages'),bottom=changed||log.scrollHeight-log.scrollTop-log.clientHeight<70;
      const kind={request:'任务',message:'消息',discussion:'讨论',question:'提问',revision:'返工要求',delivery:'交付摘要',test_result:'执行结果',release:'发布',notice:'系统记录'};
      patch(log,messages.length?messages.map(m=>`<article class="ws-message ${m.sender==='system'?'system':m.sender==='boss'?'boss':'employee'}" id="message-${m.id}"><div class="ws-message-meta"><b>${esc(m.sender==='system'?'执行系统':m.sender==='boss'?'你':person(m.sender))}</b><span>→ ${esc(m.recipient==='team'?'全体':m.recipient==='boss'?'你':person(m.recipient))}</span><small>${esc(kind[m.kind]||m.kind)} · ${esc(new Date(m.created_at.replace(' ','T')+'Z').toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</small></div>${m.reply_to?`<a href="#message-${m.reply_to}" class="ws-reply">回复 #${m.reply_to}</a>`:''}<p>${esc(m.body)}</p>${m.meta?.provider?`<small class="muted">${m.meta.provider==='fake'?'测试替身':esc(m.meta.model||m.meta.provider)} · 调用记录 #${m.id}</small>`:''}${m.meta?.artifacts?`<div class="ws-actions">${links(m.meta)}</div>`:''}</article>`).join(''):'<p class="ws-empty">这里还没有讨论记录。旧项目只保留原有交付，新建自主协作任务会从开工讨论开始记录。</p>');
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
  // everything that can't move on without the boss, one line per piece of work
  function needsYou() {
    const items=new Map(),add=(id,why,view='tasks')=>{if(!items.has(id))items.set(id,{why,view});};
    for(const p of data.projects) {
      if(['done','paused'].includes(p.status))continue;
      const id=`p:${p.id}`,jobs=data.jobs.filter(j=>j.project_id===p.id);
      if(p.status==='blocked')add(id,p.collaboration?.reason||jobs.find(j=>j.error)?.error||'项目停住了，需要你看一下',p.collaboration?.enabled?'discussion':'tasks');
      if(p.status==='review')add(id,'全部分工做完了，等你验收');
      for(const j of jobs) {
        const role=p.roles.find(r=>r.idx===j.role_idx)?.name||'分工';
        if(j.status==='review')add(id,`${role}做完了，等你确认`);
        if(['failed','interrupted'].includes(j.status))add(id,`${role}没有完成：${j.error||labels[j.status]}`);
      }
    }
    for(const j of data.jobs) {
      if(!j.order_id||data.projects.some(p=>p.order_id===j.order_id))continue;
      if(j.status==='review')add(`o:${j.order_id}`,'写好了，等你验收');
      if(['failed','interrupted'].includes(j.status))add(`o:${j.order_id}`,`没有完成：${j.error||labels[j.status]}`);
    }
    return items;
  }
  function progress(e) {
    if(e.o){const j=data.jobs.find(j=>j.order_id===e.o.id);return j?person(j.employee):'还没有负责人';}
    const p=e.p,done=p.roles.filter(r=>r.status==='done').length,talk=p.discussion?.find(t=>t.status==='running');
    const now=data.jobs.find(j=>j.project_id===p.id&&j.status==='running'),role=now&&p.roles.find(r=>r.idx===now.role_idx);
    return `${done}/${p.roles.length} 份分工${talk?` · ${person(talk.employee)}讨论中`:role?` · ${person(now.employee)}：${role.name}`:''}`;
  }
  const taskRow=(e,need)=>`<button class="ws-task" data-select="${esc(e.id)}"${need?` data-go="${need.view}"`:''} aria-current="${e.id===selected}"><b>${esc(e.title)}</b>${need?'':badge(e.status)}<small>${esc(need?need.why:progress(e))}</small></button>`;
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
    const open=roleOpen.has(j.id)?roleOpen.get(j.id):['running','review','failed','interrupted','blocked'].includes(j.status);
    return `<details class="ws-role" data-role="${esc(j.id)}"${open?' open':''}><summary><b>${esc(name)}</b><span class="muted">${esc(person(j.employee))}</span>${j.attempt>1?`<span class="muted">第 ${j.attempt} 次</span>`:''}${badge(j.status)}</summary>
      ${dependencies.length?`<p class="muted">依赖交付：${dependencies.map(d=>`${esc(d.name)}（${esc(person(d.who))}）`).join('、')}</p>`:''}
      ${j.waiting?`<p class="muted">${esc(j.waiting)}</p>`:''}${j.started_at?`<p class="muted">${j.finished_at?`${esc(clock(j.started_at))} 开始，用时 ${esc(lasted(j.started_at,j.finished_at))}`:`${esc(clock(j.started_at))} 开始`}</p>`:''}
      ${['running','queued'].includes(j.status)&&r.artifacts?.length?'<p class="muted">以下为上一版交付，本次修改完成后更新。</p>':''}
      ${j.error?`<p class="ws-error">${esc(j.error)}</p>`:''}${r.summary?`<p>${esc(r.summary)}</p>`:''}
      ${test?`<div class="ws-test${test.fail||!test.pass?' bad':''}">实际测试：通过 ${test.pass} · 失败 ${test.fail} · 跳过 ${test.skipped||0}</div>`:''}
      <div class="ws-actions">${j.status==='review'?`<button class="btn primary" data-approve="${esc(j.id)}">${j.project_id?'确认这份分工':'验收通过'}</button>`:''}${links(r)}</div>
      ${!['running','queued'].includes(j.status)?`<details data-revise-box><summary>修改 / 重试这份分工</summary><form data-revise="${esc(j.id)}"><label><span>具体修改要求（依赖这份交付的后续步骤会重新执行）</span><textarea name="feedback" required placeholder="例如：减号按钮没有响应，请修复并补充测试"></textarea></label><button class="btn" type="submit">提交修改并执行</button></form></details>`:''}</details>`;
  }
  function render() {
    const all=entries(),waiting=needsYou(),open=all.filter(e=>e.status!=='done'&&!waiting.has(e.id)),finished=all.filter(e=>e.status==='done');
    if(!all.some(e=>e.id===selected))selected=(all.find(e=>waiting.has(e.id))||open[0]||finished[0])?.id||null;
    const status=`已花 ¥${data.spent.toFixed(2)}`;
    if($('#ws-status').textContent!==status)$('#ws-status').textContent=status;
    setText($('#ws-version'),`v${data.version}`);
    const title=waiting.size?`(${waiting.size}) AI 工作室`:'AI 工作室';
    if(document.title!==title)document.title=title;
    if (!dismissedNotice && data.demoHidden) {notice(`已隐藏 ${data.demoHidden} 条旧演示订单，它们不会自动执行。原记录仍可在「文件与记录」查看。`);dismissedNotice=true;}
    const inboxHTML=all.filter(e=>waiting.has(e.id)).map(e=>taskRow(e,waiting.get(e.id))).join('');
    const taskHTML=(open.length?open.map(e=>taskRow(e)).join(''):`<p class="ws-empty">${all.length?'没有进行中的工作。':'还没有工作。<br>点右上角「＋ 新工作」开始。'}</p>`)
      +(finished.length?`<details id="ws-done"${doneOpen?' open':''}><summary>已完成（${finished.length}）</summary>${finished.map(e=>taskRow(e)).join('')}</details>`:'');
    $('#ws-inbox').hidden=!waiting.size;setText($('#ws-inbox-count'),String(waiting.size));
    if(inboxHTML+taskHTML!==lastTasks){patch($('#ws-inbox-list'),inboxHTML);patch($('#ws-tasks'),taskHTML);lastTasks=inboxHTML+taskHTML;}
    const entry=all.find(e=>e.id===selected), detail=$('#ws-detail'), need=waiting.get(entry?.id);
    renderChat();
    const signature=JSON.stringify([entry,need,data.jobs.filter(j=>entry?.p?j.project_id===entry.p.id:j.order_id===entry?.o?.id),data.employees]);
    if (signature!==lastDetail) {
      lastDetail=signature;
      if (!entry) patch(detail,'<div class="ws-empty"><h2>把需求交给员工</h2><p>点右上角「＋ 新工作」，写清楚要做什么就行。</p></div>');
      else if (entry.p) {
        const p=entry.p, jobs=data.jobs.filter(j=>j.project_id===p.id);
        const callout=need?`<div class="ws-callout"><p>${esc(need.why)}</p>${p.status==='review'?`<button class="btn primary" data-accept="${p.id}">运行集成检查并验收</button>`:need.view==='discussion'?'<button class="btn primary" data-view="discussion">去项目讨论里处理</button>':''}</div>`:'';
        patch(detail,`<div class="ws-head"><h2>${esc(p.name)}</h2>${badge(entry.status)}</div><p class="ws-goal">${esc(p.goal)}</p>${callout}<div class="ws-actions">
          ${!jobs.length&&p.status!=='done'?`<button class="btn primary" data-start-project="${p.id}">启动这个项目</button>`:''}
          ${jobs.length&&p.status!=='done'?`<button class="btn" data-pause="${p.id}" data-paused="${p.status!=='paused'}">${p.status==='paused'?'继续执行':'暂停后续步骤'}</button>`:''}
          <a class="btn" href="/company.html#git/${enc(p.slug)}/main/tree" target="_blank" rel="noopener">项目代码 ↗</a></div>
          ${p.status==='paused'?'<p class="muted">后续步骤已暂停。已经发出的模型调用会完成并保留结果。</p>':''}
          ${p.tag?`<p>已发布 ${esc(p.tag)}</p>`:''}
          ${p.roles.map(r=>{const j=jobs.find(j=>j.role_idx===r.idx);return j?jobHTML(j,r.name):`<details class="ws-role"><summary><b>${esc(r.name)}</b><span class="muted">${esc(person(r.who))}</span>${badge(r.status)}</summary><p class="muted">${esc(r.description)}</p><div class="ws-actions">${links({artifacts:r.artifacts})}</div><p>${p.status==='done'||r.status==='done'?'已保留旧版交付':r.status==='gate'?'启动项目后恢复待确认的交付':'等待你启动项目'}</p></details>`;}).join('')}`);
      } else {
        const o=entry.o,j=data.jobs.find(j=>j.order_id===o.id);
        patch(detail,`<div class="ws-head"><h2>${esc(o.title)}</h2>${badge(entry.status)}</div><p class="ws-goal">${esc(o.spec.detail||o.brief)}</p>${need?`<div class="ws-callout"><p>${esc(need.why)}</p></div>`:''}${j?jobHTML(j,'交付'):`<form data-start-order="${esc(o.id)}"><label><span>负责人</span><select name="employee">${optEmployees()}</select></label><button class="btn primary">开始执行</button></form>`}`);
      }
      for(const f of detail.querySelectorAll('form[data-revise]')) {
        const draft=drafts.get(f.dataset.revise)||'';
        if(f.elements.feedback.value!==draft)f.elements.feedback.value=draft;
        f.closest('details').open=expanded.has(f.dataset.revise);
      }
      for(const b of detail.querySelectorAll('[data-preview]')) {
        const box=previews.get(`${b.dataset.preview}:${b.dataset.ref}`);
        const role=b.closest('.ws-role');
        if(box&&!role.contains(box))role.append(box);
      }
    }
    const conversations=data.projects.flatMap(p=>(p.discussion||[]).filter(t=>t.status==='running'));
    const teamSignature=JSON.stringify([data.employees,data.jobs.filter(j=>j.status==='running').map(j=>j.employee),conversations]);
    if(teamSignature===lastTeam)return;
    lastTeam=teamSignature;
    const team=$('#ws-team');team.querySelector('.ws-empty')?.remove();
    for(const [id,row] of teamRows)if(!data.employees.some(e=>e.id===id)){row.remove();teamRows.delete(id);}
    for(const e of data.employees) {
      // rows stay in place between updates, so portraits keep animating and a press on one is never lost
      let el=teamRows.get(e.id);
      if(!el) {
        el=document.createElement('div');el.className='ws-person';
        const main=document.createElement('button');main.className='ws-person-main';main.dataset.person=e.id;main.append(avatar(e),document.createElement('span'));
        const edit=document.createElement('button');edit.className='link';edit.dataset.employeeEdit=e.id;edit.textContent='设置';
        el.append(main,edit);teamRows.set(e.id,el);team.append(el);
      }
      el.querySelector('.link').setAttribute('aria-label',`${e.name}的设置`);
      const provider=providerFor(e),state=conversations.some(t=>t.employee===e.id)?'讨论中':isRunning(e.id)?'执行中':'空闲';
      patch(el.querySelector('.ws-person-main>span'),`<b>${esc(e.name)}</b><small>${esc(e.profile?.postLabel||e.profile?.post||'通用')} · <span class="${state==='空闲'?'':'ws-on'}">${state}</span></small><small>${models?.fake?'测试替身':`${provider?.connection==='local'?'本机':'API'} · ${esc(provider?.model||'未接入模型')}`}</small>`);
    }
    if(!data.employees.length) team.innerHTML='<div class="ws-empty"><p>工作室还没有员工。</p><button class="btn primary" data-hire>添加第一位员工</button></div>';
  }
  const isRunning=id=>data.jobs.some(j=>j.employee===id&&j.status==='running');
  const refresher=createRefresher(async()=>{
    try {data=await api('/api/workspace');onSnapshot(data);render();await refreshMessages();} catch(e){notice(`连接失败：${e.message}。页面不会重开任务。`,true);}
  });
  const refresh=refresher.now;
  async function action(button, fn, reload=true) {
    const done=pending(button);
    try {await fn();if(reload){lastDetail='';await refresh();}} catch(e){notice(e.message,true);} finally{done();}
  }
  function dialog(html, submit, submitLabel='开始', {then, onCancel}={}) {
    const d=$('#ws-dialog');d.innerHTML=`<form>${html}<p class="form-error" role="alert"></p><div class="ws-actions"><button class="btn primary" type="submit">${esc(submitLabel)}</button><button class="btn" type="button" data-close>取消</button></div></form>`;
    d.querySelector('[data-close]').onclick=()=>{onCancel?.();d.close();};d.showModal();
    d.querySelector('form').onsubmit=async ev=>{ev.preventDefault();const done=pending(d.querySelector('[type=submit]'));try{await submit(new FormData(ev.target));d.close();lastDetail='';await refresh();then?.();}catch(e){d.querySelector('.form-error').textContent=e.message;}finally{done();}};
    return d;
  }
  $('#ws-create').onclick=()=>{
    if(!data)return;
    if(!data.employees.length){employeeDialog(null,()=>$('#ws-create').click());notice('先添加一位员工，加好后就能写新工作。');return;}
    const developer=data.employees.find(e=>['frontend','backend','code'].includes(e.profile?.post))||data.employees[0];
    const tester=data.employees.find(e=>e.profile?.post==='test')||data.employees.find(e=>e.id!==developer.id)||developer;
    const planner=data.employees.find(e=>e.profile?.post==='pm')||data.employees[0];
    const backend=data.employees.find(e=>e.profile?.post==='backend'&&e.id!==planner.id)||developer;
    const frontend=data.employees.find(e=>e.profile?.post==='frontend'&&![planner.id,backend.id].includes(e.id))||data.employees.find(e=>['frontend','backend','code'].includes(e.profile?.post)&&![planner.id,backend.id].includes(e.id))||data.employees.find(e=>![planner.id,backend.id].includes(e.id))||developer;
    const integrator=data.employees.find(e=>e.profile?.post==='test'&&![planner.id,backend.id,frontend.id].includes(e.id))||data.employees.find(e=>['frontend','backend','code'].includes(e.profile?.post)&&![planner.id,backend.id,frontend.id].includes(e.id))||data.employees.find(e=>![planner.id,backend.id,frontend.id].includes(e.id))||tester;
    const writer=data.employees.find(e=>['writing','pm','research'].includes(e.profile?.post))||planner;
    const orderId=crypto.randomUUID();
    const d=dialog(`<h2>新工作</h2>
      <label><span>要做什么、怎样算完成</span><textarea name="goal" required rows="5" placeholder="目标、功能、限制和验收标准"></textarea></label>
      <fieldset class="ws-choices kinds"><legend>怎么做</legend>
        <label class="ws-choice"><input type="radio" name="kind" value="team" checked><span><b>团队协作</b><small>讨论、分工、集成测试</small></span></label>
        <label class="ws-choice"><input type="radio" name="kind" value="code"><span><b>小型代码</b><small>开发、测试、验收</small></span></label>
        <label class="ws-choice"><input type="radio" name="kind" value="doc"><span><b>文档</b><small>撰写、验收</small></span></label>
      </fieldset>
      <p class="muted" data-plan></p>
      <details><summary>更多设置：标题、负责人</summary>
        <label><span>标题（留空时用需求的第一行）</span><input name="title" maxlength="80"></label>
        <div data-team>
          <label class="ws-check"><input type="checkbox" name="autonomous" checked><span>员工自主沟通、返工并验收</span></label>
          <div class="ws-row"><label><span>需求规划</span><select name="planner">${optEmployees(planner.id)}</select></label>
          <label><span>后端开发</span><select name="backend">${optEmployees(backend.id)}</select></label>
          <label><span>前端开发</span><select name="frontend">${optEmployees(frontend.id)}</select></label>
          <label><span>集成测试</span><select name="integrator">${optEmployees(integrator.id)}</select></label></div>
        </div>
        <label data-owner hidden><span>负责人</span><select name="owner">${optEmployees(developer.id)}</select></label>
        <label data-tester hidden><span>代码测试负责人</span><select name="tester">${optEmployees(tester.id)}</select></label>
      </details>`,async f=>{
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
      workDraft='';
      setView(f.get('kind')==='team'?'discussion':'tasks');
    },'开始',{onCancel:()=>{workDraft='';}});
    // Esc closes the window but keeps what was typed; only 取消 throws it away
    const form=d.querySelector('form');
    form.elements.goal.value=workDraft;
    form.elements.goal.addEventListener('input',e=>{workDraft=e.target.value;});
    let ownerChosen=false;
    form.elements.owner.addEventListener('change',()=>{ownerChosen=true;});
    const showPlan=()=>{
      const kind=form.elements.kind.value,name=k=>person(form.elements[k].value);
      if(!ownerChosen)form.elements.owner.value=(kind==='doc'?writer:developer).id;
      d.querySelector('[data-team]').hidden=kind!=='team';
      d.querySelector('[data-owner]').hidden=kind==='team';
      d.querySelector('[data-tester]').hidden=kind!=='code';
      const team=[...new Set(['planner','backend','frontend','integrator'].map(name))].join('、');
      d.querySelector('[data-plan]').textContent=kind==='doc'?`${name('owner')} 撰写，写好后你来验收。`
        :kind==='code'?`${name('owner')} 开发，${name('tester')} 测试，做完你来验收。`
        :form.elements.autonomous.checked?`${team} 先讨论再分工，测试失败自动返工（最多 2 轮）。你可以随时插话或暂停。`:`${team} 接力完成，需求规划做完先给你确认。`;
    };
    form.addEventListener('change',showPlan);showPlan();
  };
  async function employeeDialog(employee, then) {
    try {
      models=await api('/api/models');
      if(!models.connections)throw new Error('接入选项需要新版服务，请重启工作室后刷新。');
      const currentType=employee?.profile?.type||employee?.id;
      const preferred=employee?providerFor(employee)?.connection:null;
      const initialMode=preferred||(Object.values(models.connections.local).some(id=>models.fake||models.providers[id]?.configured)?'local':'api');
      const occupied=!!employee&&(isRunning(employee.id)||data.projects.some(p=>p.discussion?.some(t=>t.employee===employee.id&&t.status==='running')));
      const post=postKey(employee?.profile?.post||'general');
      const d=dialog(`<h2>${employee?`${esc(employee.name)} · 设置`:'添加员工'}</h2>
        <div class="ws-row"><label><span>名字</span><input name="name" required maxlength="40" value="${esc(employee?.name||'')}"></label>
        <label><span>岗位</span><select name="post">${POSTS.map(([k,label])=>`<option value="${k}"${k===post?' selected':''}>${label}</option>`).join('')}</select></label></div>
        <label><span>专长（可不填，会写进 TA 的每份工作说明）</span><input name="persona" maxlength="300" value="${esc(employee?.profile?.persona||'')}" placeholder="比如：资深前端，擅长手机页面"></label>
        <fieldset class="ws-choices"${occupied?' disabled':''}><legend>接入方式</legend>
          <label class="ws-choice"><input type="radio" name="connection" value="local"${initialMode==='local'?' checked':''}><span><b>本机</b><small>Claude Code、Codex 或本地模型服务</small></span></label>
          <label class="ws-choice"><input type="radio" name="connection" value="api"${initialMode==='api'?' checked':''}><span><b>API 接入</b><small>配置好密钥的模型服务</small></span></label>
        </fieldset><p class="muted" data-connection-hint></p>
        <label><span data-model-label>工具 / 模型</span><select name="type" required${occupied?' disabled':''}></select></label><p class="muted" data-model-hint></p>`,
        async f=>{
          const body=Object.fromEntries(f);
          if(!employee)return api('/api/workspace/employees',body);
          await api(`/api/workspace/employees/${enc(employee.id)}`,{name:body.name,post:body.post,persona:body.persona});
          if(!occupied&&(body.connection!==preferred||body.type!==currentType))await api(`/api/workspace/employees/${enc(employee.id)}/connection`,{type:body.type,connection:body.connection});
        },employee?'保存':'添加员工',{then});
      const form=d.querySelector('form'),select=form.elements.type,submit=d.querySelector('[type=submit]');
      let named=!!employee;
      form.elements.name.addEventListener('input',()=>{named=true;});
      function showProvider() {
        const mode=form.elements.connection.value,p=models.providers[models.connections[mode][select.value]];
        const ready=!!p&&(models.fake||p.configured),same=!!employee&&mode===preferred&&select.value===currentType;
        submit.disabled=!ready&&!same&&!occupied;
        if(!named&&defaultName)form.elements.name.value=defaultName(select.value);
        d.querySelector('[data-model-hint]').textContent=p?`${p.model} · ${p.hint}${!ready&&mode==='api'?'。在项目的 .env 中配置相应密钥，再重启工作室。':''}`:'没有可用的接入配置。';
      }
      function showMode() {
        const mode=form.elements.connection.value,last=select.value||currentType;
        const entries=Object.entries(models.connections[mode]).filter(([type])=>type===currentType||!(mode==='local'&&type==='gpt')&&!(mode==='api'&&type==='codex'));
        select.innerHTML=entries.map(([type,id])=>{const p=models.providers[id];return `<option value="${esc(type)}">${esc(p.name)}${!models.fake&&!p.configured?'（未配置）':''}</option>`;}).join('');
        select.value=entries.some(([type])=>type===last)?last:entries.find(([,id])=>models.fake||models.providers[id].configured)?.[0]||entries[0]?.[0]||'';
        d.querySelector('[data-model-label]').textContent=mode==='local'?'本机工具 / 模型':'API 模型';
        d.querySelector('[data-connection-hint]').textContent=occupied?'这位员工正在执行调用，做完后才能切换接入方式。':mode==='local'?'使用本机登录配置，仍可能访问云端模型；本机不等于离线运行。':'使用服务端已有的密钥配置，按提供商计费。';
        showProvider();
      }
      for(const radio of form.querySelectorAll('[name=connection]'))radio.onchange=showMode;
      select.onchange=showProvider;showMode();
    } catch(e) { notice(e.message,true); }
  }
  root.addEventListener('keydown',ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key==='Enter'&&ev.target.matches('textarea'))ev.target.form?.requestSubmit();});
  root.addEventListener('click',ev=>{
    const fold=ev.target.closest('summary')?.parentElement;
    if(fold?.dataset.role)roleOpen.set(fold.dataset.role,!fold.open);
    const b=ev.target.closest('button');if(!b)return;
    if(b.dataset.dismiss!==undefined)$('#ws-notice').replaceChildren();
    if(b.dataset.hire!==undefined)employeeDialog();
    if(b.dataset.person)openEmployee(b.dataset.person);
    if(b.dataset.employeeEdit)employeeDialog(data.employees.find(e=>e.id===b.dataset.employeeEdit));
    if(b.dataset.view)setView(b.dataset.view);
    if(b.dataset.select){
      const same=selected===b.dataset.select,view=root.dataset.view;
      selected=b.dataset.select;lastDetail='';
      setView(selected.startsWith('o:')?'tasks':b.dataset.go||(view==='discussion'?'discussion':'tasks'));
      render();
      if(!same&&view===root.dataset.view)enter($(view==='discussion'?'#ws-chat':'#ws-detail'),3);
    }
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
      const box=document.createElement('div');box.className='ws-preview';box.dataset.keep='';box.innerHTML=`<p class="muted">静态页面预览 · 后端服务需按 README 启动</p><p><a href="${esc(url)}" target="_blank" rel="noopener">在新页打开预览 ↗</a></p><iframe title="交付页面预览" sandbox="allow-scripts allow-same-origin" src="${esc(url)}"></iframe>`;
      previews.set(k,box);
      const card=b.closest('.ws-role,.ws-message');card.querySelector('.ws-preview')?.remove();card.append(box);
    },false);
  });
  $('#ws-chat-older').onclick=()=>refreshMessages(true);
  $('#ws-chat-form').elements.body.addEventListener('input',e=>{if(chatProject){chatDrafts.set(chatProject,e.target.value);sendIds.delete(chatProject);}});
  $('#ws-chat-form').onsubmit=async ev=>{
    ev.preventDefault();const form=ev.target,pid=chatProject;if(!pid)return;
    const done=pending(form.querySelector('button')),body=form.elements.body.value;form.querySelector('.form-error').textContent='';
    const clientId=sendIds.get(pid)||crypto.randomUUID();sendIds.set(pid,clientId);
    try{await api(`/api/workspace/projects/${pid}/messages`,{body,targetRole:Number(form.elements.targetRole.value),clientId});chatDrafts.delete(pid);sendIds.delete(pid);if(chatProject===pid&&form.elements.body.value===body)form.elements.body.value='';await refresh();}
    catch(e){form.querySelector('.form-error').textContent=e.message;}finally{done();}
  };
  root.addEventListener('input',ev=>{const f=ev.target.closest('form[data-revise]');if(f)drafts.set(f.dataset.revise,f.elements.feedback.value);});
  root.addEventListener('toggle',ev=>{
    if(ev.target.id==='ws-done')doneOpen=ev.target.open;
    const f=ev.target.matches?.('[data-revise-box]')&&ev.target.querySelector('form[data-revise]');
    if(f){if(ev.target.open)expanded.add(f.dataset.revise);else expanded.delete(f.dataset.revise);}
  },true);
  root.addEventListener('submit',ev=>{
    const form=ev.target;if(!form.dataset.revise&&!form.dataset.startOrder)return;ev.preventDefault();
    const f=new FormData(form);action(form.querySelector('button'),async()=>{
      if(form.dataset.revise){await api(`/api/workspace/jobs/${enc(form.dataset.revise)}/revise`,{feedback:f.get('feedback')});drafts.delete(form.dataset.revise);expanded.delete(form.dataset.revise);}
      else await api(`/api/workspace/orders/${enc(form.dataset.startOrder)}/start`,{employee:f.get('employee')});
    });
  });
  const discussionLink=location.hash.match(/^#discussion\/(\d+)$/);if(discussionLink){selected=`p:${discussionLink[1]}`;setView('discussion');}
  await refresh();
  // no point refreshing a page nobody is looking at; coming back catches up at once
  const tick=()=>{if(!document.hidden)refresher.poll();};
  let timer=setInterval(tick,2000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresher.poll();});
  window.addEventListener('pagehide',()=>clearInterval(timer));
  window.addEventListener('pageshow',e=>{if(e.persisted){refresh();timer=setInterval(tick,2000);}});
}
