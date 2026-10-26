// Presentation only: model execution and billing remain entirely on the server.
export function createOfficeMotion({ employees, move, say, handoff, idleSpot, reviewSpot, stepEmployee, stepPackets }) {
  let seen = new Map();
  const visits = new Map();
  const nameOf = (s, j) => j.project_id
    ? s.projects.find(p => p.id === j.project_id)?.roles.find(r => r.idx === j.role_idx)?.name || '任务'
    : s.orders.find(o => o.id === j.order_id)?.title || '任务';
  const awaitingReview = (s, j) => j.status === 'review' ||
    (j.status === 'done' && s.projects.find(p => p.id === j.project_id)?.status === 'review' &&
      s.projects.find(p => p.id === j.project_id)?.roles.at(-1)?.idx === j.role_idx);
  const rest = e => {
    e.writing = null; e.waiting = false; e.carry = false;
    visits.delete(e.id);
    const spot = idleSpot(e); if (spot) move(e, spot);
    e.wanderT = 4 + Math.random() * 5;
  };

  function sync(s) {
    const staff = employees(), byId = new Map(staff.map(e => [e.id, e]));
    const running = new Map(s.jobs.filter(j => j.status === 'running').map(j => [j.employee, j]));
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
      if (!changed || running.has(e.id)) continue;
      if (awaitingReview(s, j)) {
        e.writing = null; e.waiting = true; e.carry = true;
        visits.set(e.id, { job: j.id, remaining: 4 });
        move(e, reviewSpot(e));
        say(e, '交付好了，等你验收', 'ask');
      } else if (prev?.status === 'running' || ['failed', 'interrupted'].includes(j.status)) {
        rest(e);
        say(e, j.status === 'failed' ? '这次没完成，请看任务里的原因' : j.status === 'interrupted' ? '调用中断了，需要你确认重试' : '这份完成，已保存交付', j.status === 'done' ? 'say' : 'ask');
      }
    }
    for (const [id, j] of running) {
      const e = byId.get(id); if (!e) continue;
      const prev = seen.get(j.id);
      const changed = !prev || prev.status !== 'running' || prev.attempt !== j.attempt;
      e.writing = { out: nameOf(s, j) }; e.waiting = false; e.carry = false;
      if (!changed) continue;
      move(e, e.desk.seat);
      say(e, `${j.attempt > 1 ? '按修改意见继续：' : '开始：'}${nameOf(s, j)}`, 'think');
      const p = s.projects.find(p => p.id === j.project_id);
      const role = p?.roles.find(r => r.idx === j.role_idx);
      for (const dep of role?.deps || []) {
        const upstream = s.jobs.find(u => u.project_id === j.project_id && u.role_idx === dep && u.status === 'done');
        const from = upstream && byId.get(upstream.employee);
        if (from && from !== e) {
          handoff(from, e);
          say(from, `交付已传给${e.name}`, 'say');
        }
      }
    }
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
