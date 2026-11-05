// Presentation only: model execution and billing remain entirely on the server.
export function createOfficeMotion({ employees, move, say, handoff, idleSpot, reviewSpot, stepEmployee, stepPackets, meetSpot, speech, react }) {
  let seen = new Map();
  let projects = new Map();
  const visits = new Map();
  const nameOf = (s, j) => j.discussion ? '项目讨论' : j.project_id
    ? s.projects.find(p => p.id === j.project_id)?.roles.find(r => r.idx === j.role_idx)?.name || '任务'
    : s.orders.find(o => o.id === j.order_id)?.title || '任务';
  const awaitingReview = (s, j) => !j.discussion && (j.status === 'review' ||
    (j.status === 'done' && s.projects.find(p => p.id === j.project_id)?.status === 'review' &&
      s.projects.find(p => p.id === j.project_id)?.roles.at(-1)?.idx === j.role_idx));
  const rest = e => {
    e.writing = null; e.waiting = false; e.carry = false; e.talkTo = null;
    visits.delete(e.id);
    const spot = idleSpot(e); if (spot) move(e, spot);
    e.wanderT = 4 + Math.random() * 5;
  };

  function sync(s) {
    s={...s,jobs:[...s.jobs,...s.projects.flatMap(p=>(p.discussion||[]).map(t=>({...t,id:`discussion:${t.id}`,project_id:p.id,discussion:true})))]};
    const staff = employees(), byId = new Map(staff.map(e => [e.id, e]));
    const running = new Map(s.jobs.filter(j => j.status === 'running').map(j => [j.employee, j]));
    // While a project is being discussed its people stand around the meeting table, not just the one speaking.
    const gathered = new Map();
    if (meetSpot) for (const p of s.projects) {
      const turns = p.discussion || [];
      if (turns.some(t => ['queued', 'running'].includes(t.status))) for (const t of turns) {
        const busyElsewhere = running.get(t.employee) && !running.get(t.employee).discussion;
        if (byId.has(t.employee) && !busyElsewhere && !gathered.has(t.employee)) gathered.set(t.employee, p.id);
      }
    }
    const left = new Set();
    for (const e of staff) {
      if (e.meeting && !gathered.has(e.id)) {
        e.meeting = null; e.talkTo = null; left.add(e.id);
        if (!running.has(e.id)) rest(e);
      }
    }
    // Cancel a delivery visit immediately if the employee receives new work or it is approved.
    for (const [id, visit] of visits) {
      const j = s.jobs.find(j => j.id === visit.job);
      if (running.has(id)) {
        visits.delete(id); const e = byId.get(id); e.waiting = false; e.carry = false;
      } else if (!j || !awaitingReview(s, j)) rest(byId.get(id));
    }
    for (const j of s.jobs) {
      const e = byId.get(j.employee); if (!e) continue;
      const prev = seen.get(j.id);
      const changed = !prev || prev.status !== j.status || prev.attempt !== j.attempt;
      if (prev && prev.status === 'review' && j.status === 'done' && !j.project_id) react?.('accepted', [e]);
      if (prev && prev.status === 'running' && j.status === 'failed') react?.('failed', [e]);
      if (!changed || running.has(e.id)) continue;
      if (awaitingReview(s, j)) {
        e.writing = null; e.waiting = true; e.carry = true;
        visits.set(e.id, { job: j.id, remaining: 4 });
        move(e, reviewSpot(e));
        say(e, '交付好了，等你验收', 'ask');
      } else if (prev?.status === 'running' || ['failed', 'interrupted'].includes(j.status)) {
        if (gathered.has(e.id) || left.has(e.id)) { e.writing = null; e.talkTo = null; } else rest(e);
        say(e, j.status === 'failed' ? '这次没完成，请看任务里的原因' : j.status === 'interrupted' ? '调用中断了，需要你确认重试' : j.discussion ? '已在项目群里回复' : '这份完成，已保存交付', j.status === 'done' ? 'say' : 'ask');
        if (j.discussion && j.status === 'done') speech?.(j).then(text => { if (text) say(e, text, 'say', 6); }).catch(() => {});
      }
    }
    for (const [id, j] of running) {
      const e = byId.get(id); if (!e) continue;
      const prev = seen.get(j.id);
      const changed = !prev || prev.status !== 'running' || prev.attempt !== j.attempt;
      const talking = gathered.has(id) && j.discussion;
      e.writing = talking ? { out: nameOf(s, j), talk: true } : { out: nameOf(s, j) }; e.waiting = false; e.carry = false;
      e.talkTo = talking ? [...gathered].filter(([other, p]) => other !== id && p === gathered.get(id)).map(([other]) => byId.get(other)) : null;
      if (!changed) continue;
      if (!talking) move(e, e.desk.seat);
      say(e, `${j.attempt > 1 ? '按修改意见继续：' : '开始：'}${nameOf(s, j)}`, 'think');
      const p = s.projects.find(p => p.id === j.project_id);
      const role = p?.roles.find(r => r.idx === j.role_idx);
      for (const dep of j.discussion ? [] : role?.deps || []) {
        const upstream = s.jobs.find(u => u.project_id === j.project_id && u.role_idx === dep && u.status === 'done');
        const from = upstream && byId.get(upstream.employee);
        if (from && from !== e) {
          handoff(from, e);
          say(from, `交付已传给${e.name}`, 'say');
        }
      }
    }
    let seat = 0;
    for (const [id, pid] of gathered) {
      const e = byId.get(id), spot = meetSpot(seat++);
      if (e.meeting) continue;
      e.meeting = pid; e.waiting = false; e.carry = false; visits.delete(id);
      move(e, spot);
    }
    for (const p of s.projects) {
      const before = projects.get(p.id);
      if (before && before !== 'done' && p.status === 'done') {
        const team = [...new Set(s.jobs.filter(j => j.project_id === p.id && !j.discussion).map(j => j.employee))].map(id => byId.get(id)).filter(Boolean);
        react?.('accepted', team);
      }
    }
    projects = new Map(s.projects.map(p => [p.id, p.status]));
    seen = new Map(s.jobs.map(j => [j.id, { status: j.status, attempt: j.attempt }]));
  }

  function step(dt) {
    for (const e of employees()) {
      stepEmployee(e, dt);
      const visit = visits.get(e.id);
      if (visit && !e.path.length) {
        visit.remaining -= dt;
        if (visit.remaining <= 0) rest(e);
      }
    }
    stepPackets(dt);
  }
  return { sync, step };
}
