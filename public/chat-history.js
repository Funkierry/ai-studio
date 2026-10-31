const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds = {request:'项目要求',message:'人工消息',discussion:'员工讨论',question:'提问',revision:'返工意见',delivery:'交付摘要',test_result:'执行结果',release:'发布',notice:'系统通知'};
const sources = {human:'人工',system:'系统记录',model:'真实模型产出',test:'测试替身',unknown:'来源未标记'};
const name = (id, label) => ({boss:'老板',system:'执行系统',team:'全体员工'}[id] || label || id);
const when = s => new Date(s.replace(' ','T')+'Z').toLocaleString();
async function get(url) {const r=await fetch(url,{cache:'no-store'}), d=await r.json();if(!r.ok)throw new Error(d.error||r.status);return d;}
export async function mountHistory(view) {
  const f = await get('/api/collaboration/filters');
  if (!location.hash.startsWith('#chat')) return;
  view.innerHTML=`<section class="main px"><div class="main-head"><h2>协作聊天记录</h2><span class="label">历史查询不会启动模型或产生费用</span></div>
  <form id="history-form" class="history-filters">
    <label>项目<select name="project"><option value="">全部项目</option>${f.projects.map(p=>`<option value="${p.id}">${esc(p.name)}（${p.messages} 条）</option>`).join('')}</select></label>
    <label>参与员工<select name="participant"><option value="">全部员工</option><option value="boss">老板</option>${f.employees.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></label>
    <label>消息类型<select name="kind"><option value="">全部类型</option>${f.kinds.map(k=>`<option value="${esc(k)}">${esc(kinds[k]||k)}</option>`).join('')}</select></label>
    <label>正文关键词<input name="q" type="text" maxlength="500" placeholder="例如：接口、测试失败、验收口令"></label>
    <label>开始时间<input name="since" type="datetime-local"></label><label>结束时间<input name="until" type="datetime-local"></label>
    <button class="btn primary">查询</button><button type="button" class="btn" id="history-export">导出全部匹配记录</button>
  </form><p id="history-status" role="status"></p><div id="history-results"></div><button class="btn" id="history-more" hidden>加载更早记录</button>
  <dialog id="history-context"><h2>消息上下文</h2><div id="history-context-body"></div><button class="btn" id="history-close">关闭</button></dialog></section>`;
  const $=s=>view.querySelector(s), form=$('#history-form'), status=$('#history-status'), results=$('#history-results'), more=$('#history-more');
  const current=new URLSearchParams(location.hash.split('?')[1]||'');
  for(const key of ['project','participant','kind','q']) if(current.has(key))form.elements[key].value=current.get(key);
  let query={}, snapshot, next=null, busy=false, version=0;
  function card(m, contextButton=true) {
    return `<article class="history-message"><div class="main-head"><b>#${m.id} · ${esc(name(m.sender,m.sender_name))} → ${esc(name(m.recipient,m.recipient_name))}</b><span class="pill">${esc(kinds[m.kind]||m.kind)}</span></div>
      <p class="label">${esc(m.project_name)} · ${esc(when(m.created_at))} · ${esc(sources[m.source])}${m.model?' · '+esc(m.model):''}${m.reply_to?' · 回复 #'+m.reply_to:''}</p>
      <p class="history-body">${esc(m.body)}</p>${m.job_id?`<p class="label">关联任务 ${esc(m.job_id)} · 第 ${m.attempt||1} 次</p>`:''}
      ${contextButton?`<button class="btn" data-context="${m.id}">查看提问、回复和上下文</button>`:''}</article>`;
  }
  async function load(reset) {
    if(busy&&!reset)return;
    const ticket=++version;busy=true;more.disabled=true;
    if(reset){query=Object.fromEntries([...new FormData(form)].filter(([,v])=>v));for(const k of ['since','until'])if(query[k])query[k]=new Date(query[k]).toISOString();snapshot=undefined;next=null;results.replaceChildren();}
    status.textContent='正在查询…';
    try {
      const params={...query,limit:50,...(snapshot!==undefined?{snapshot}:{}),...(next?{before:next}:{})};
      const d=await get('/api/collaboration/messages?'+new URLSearchParams(params));
      if(ticket!==version||!view.contains(results))return;
      snapshot=d.snapshot;next=d.nextBefore;
      results.insertAdjacentHTML('beforeend',d.messages.map(m=>card(m)).join(''));
      status.textContent=d.total?`找到 ${d.total} 条，已显示 ${results.children.length} 条（最新在前）。`:'没有匹配的记录。旧项目没有群聊记录时不会补造发言。';
      more.hidden=!next;
    }catch(e){if(ticket===version)status.textContent='查询失败：'+e.message;}
    finally{if(ticket===version){busy=false;more.disabled=false;}}
  }
  form.onsubmit=e=>{e.preventDefault();load(true);};more.onclick=()=>load(false);
  results.onclick=async e=>{
    const b=e.target.closest('[data-context]');if(!b)return;
    try {const d=await get(`/api/collaboration/messages/${b.dataset.context}/context`);const body=$('#history-context-body');
      body.innerHTML=`<h3>回复链</h3>${[...d.parents,d.message,...d.replies].map(m=>card(m,false)).join('')}<h3>同项目相邻消息</h3>${d.nearby.map(m=>card(m,false)).join('')||'<p>没有相邻消息。</p>'}`;$('#history-context').showModal();
    }catch(e){status.textContent='上下文读取失败：'+e.message;}
  };
  $('#history-close').onclick=()=>$('#history-context').close();
  $('#history-export').onclick=async e=>{
    const button=e.currentTarget;if(busy)return;button.disabled=true;
    const saved={...query}, cutoff=snapshot;let cursor=null, rows=[];
    try {
      do {const d=await get('/api/collaboration/messages?'+new URLSearchParams({...saved,limit:200,...(cutoff!==undefined?{snapshot:cutoff}:{}),...(cursor?{before:cursor}:{})}));rows.push(...d.messages);cursor=d.nextBefore;}while(cursor);
      const url=URL.createObjectURL(new Blob([JSON.stringify({filters:saved,exported_at:new Date().toISOString(),messages:rows},null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='ai-collaboration-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent=`已导出 ${rows.length} 条记录。`;
    }catch(e){status.textContent='导出失败：'+e.message;}finally{button.disabled=false;}
  };
  await load(true);
}
