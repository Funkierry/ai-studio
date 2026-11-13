// The office on screen: who is where, the routes they walk, what flies between them, and the pointer.
// Presentation only. Nothing in here starts a model call, changes a task or costs money.
import { W, H, ROOMS, DESKS, SERVER_DESK, QUEUE, LOUNGE, MEET_SPOTS, SPARE_SEATS, STATIONS, BOSS_SEAT, spotAt, route, laneOf, inRoom } from './world.js';
import { TYPES, POSTS, postKey, typeOf, addCustomTypes, assignColors, nextName } from './roster.js';
import { drawFigure, sizeOf, avatarOf, tickPortraits, onArtReady, reducedMotion } from './sprites.js';
import { paintBackdrop, paintLive, paintLighting, daylight } from './backdrop.js';
import { createOfficeMotion } from './motion.js';
import { createOfficeSocial } from './social.js';
import { createRoutines } from './routines.js';

const R = (c, colour, x, y, w, h) => { c.fillStyle = colour; c.fillRect(x, y, w, h); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const PROJECT_COLOURS = ['#f2b544', '#7fb6e6', '#78cfa2', '#c3a6ea', '#ee7b86', '#59d0d0'];
export const projectColour = id => PROJECT_COLOURS[Math.abs(Number(id) || 0) % PROJECT_COLOURS.length];
const HOLD_MS = 280, FOOT = 14;

// tiny pictures that pop up over someone's head
const SHAPES = {
  heart: [['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'], '#ee7b86'],
  note: [['..###', '..#.#', '..#.#', '###.#', '##.##'], '#c3a6ea'],
  star: [['...#...', '..###..', '#######', '.#####.', '.#.#.#.'], '#f2b544'],
  check: [['.....##', '....##.', '##.##..', '.###...', '..#....'], '#78cfa2'],
  hand: [['.#.#.#.', '.#.#.#.', '.#####.', '######.', '.#####.', '..###..'], '#f6d7b0'],
  bulb: [['.###.', '#####', '#####', '.###.', '.#.#.', '.###.'], '#ffd76a'],
  gear: [['.#.#.', '#####', '##.##', '#####', '.#.#.'], '#9fb8c8'],
  sweat: [['.#.', '.#.', '###', '###', '.#.'], '#7fb6e6'],
  steam: [['.#', '#.', '.#'], '#e8e4ef'],
  dust: [['##', '##'], '#b9b2c8'],
  key: [['#'], '#ffffff'],
};

export function createOffice({ models } = {}) {
  addCustomTypes(models?.custom_types);
  const el = document.createElement('section');
  el.className = 'stage-wrap px';
  el.innerHTML = `<div class="stage"><canvas role="img" aria-label="像素办公室：点击员工查看 TA 的工作，长按可以拖动；点击机房、档案室或老板办公室打开代码、文档和记录"></canvas><div class="overlay"></div></div>
    <div class="stage-legend" role="list" aria-label="员工和 TA 的路线颜色"></div>`;
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d'), overlay = el.querySelector('.overlay'), legend = el.querySelector('.stage-legend');
  const bg = Object.assign(document.createElement('canvas'), { width: W, height: H });
  paintBackdrop(bg.getContext('2d'));
  const forcedHour = new URLSearchParams(location.search).get('hour');
  const clock = () => { const d = new Date(); if (forcedHour !== null && forcedHour !== '') d.setHours(+forcedHour, 0); return d; };

  const actors = [], byId = new Map(), packets = [], fx = [], greeted = new Map();
  let T = 0, sceneScale = 2, active = true, held = null, press = null, skipClick = false, hover = null;
  let focus = new Set(), inbox = 0, snapshot = null, firstSync = true, legendKey = '';

  // ---------- people ----------
  const busy = e => !!(e.writing || e.waiting || e.meeting);
  const freeLounge = () => { const free = LOUNGE.filter(s => !actors.some(a => a.spot === s)); return free[Math.floor(Math.random() * free.length)]; };
  const idleSpot = e => freeLounge() || LOUNGE[actors.indexOf(e) % LOUNGE.length];
  const pathTo = (e, from, spot) => route(from, spot, e.lane);
  function goTo(e, spot) {
    if (e.spot === spot) return;
    // finish the current walk before changing destination; nobody ever jumps across a room
    if (e.path.length) e.path.push(...pathTo(e, e.spot, spot)); else e.path = pathTo(e, e.spot, spot);
    e.spot = spot;
  }
  function say(e, text, kind = 'say', seconds = 3.4) {
    e.bubble = text.length > 34 ? text.slice(0, 33) + '…' : text; e.bubbleKind = kind; e.bubbleT = seconds;
  }
  function emote(e, kind) {
    const y = e.y - sizeOf(e).height - 3;
    const add = (x, yy, vx, vy, dur) => { if (fx.length < 120) fx.push({ kind, x, y: yy, vx, vy, t: 0, dur }); };
    if (kind === 'dust') { for (const d of [-1, 1]) add(e.x + d * 5, e.y - 1, d * 16, -5, .35); return; }
    if (kind === 'star') { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(e.x, y, Math.cos(a) * 24, Math.sin(a) * 14 - 12, .9); } return; }
    if (['hand', 'bulb', 'gear', 'check', 'sweat'].includes(kind)) { add(e.x, y - 2, 0, -6, 1.1); if (!reducedMotion.matches && kind !== 'sweat') e.hopT = .45; return; }
    for (let i = 0; i < (kind === 'note' ? 2 : 3); i++) add(e.x + (i - 1) * 7, y + i * 2, (i - 1) * 3, -15, 1.1 + i * .15);
    if (!reducedMotion.matches && kind !== 'steam') e.hopT = .45;
  }
  // Something visibly travels between two people (or the boss's desk): a delivery, a letter, a change request, a stamp.
  function mail(from, to, kind = 'doc', done) {
    const end = p => p === 'boss' ? BOSS_SEAT : p;
    if (packets.length < 24) packets.push({ from: end(from), to: end(to), kind, t: 0, dur: 1.3, done });
  }
  function hire(saved, index, walkIn) {
    const type = TYPES[saved.profile?.type] ? saved.profile.type : TYPES[saved.id] ? saved.id : 'claude';
    const kind = typeOf(type), variant = saved.profile?.variant ?? actors.filter(a => a.type === type).length;
    const real = kind.needs === 'server' && !SERVER_DESK.owner ? SERVER_DESK : DESKS.find(d => !d.owner);
    const desk = real || { seat: SPARE_SEATS[actors.filter(a => a.desk.spare).length % SPARE_SEATS.length], spare: true };
    const e = { id: saved.id, type, variant, look: kind.look, outfit: kind.outfits[variant % kind.outfits.length], desk, lane: laneOf(index), speed: 36 + (index * 7) % 10,
      name: saved.name, post: 'general', colour: '#fff', x: 0, y: 0, spot: null, path: [], trail: [], anim: Math.random() * 5,
      bubble: null, bubbleKind: 'say', bubbleT: 0, wanderT: 3 + Math.random() * 6, writing: null, waiting: false, carry: false };
    if (real) real.owner = e;
    const spot = idleSpot(e);
    if (walkIn) { e.spot = { x: 4, y: e.lane, exit: [], cx: 4, area: 'hall' }; e.x = 4; e.y = e.lane; goTo(e, spot); say(e, `大家好，我是${e.name}`); }
    else { e.spot = spot; e.x = spot.x; e.y = spot.y; }
    e.tag = document.createElement('div'); e.tag.className = 'tag';
    e.tag.innerHTML = '<span class="st"></span><i class="post"></i><span class="nm"></span>';
    e.bub = document.createElement('div'); e.bub.className = 'bubble'; e.bub.hidden = true;
    overlay.append(e.tag, e.bub);
    actors.push(e); byId.set(e.id, e);
    return e;
  }
  function stepActor(e, dt) {
    e.anim += dt;
    if (e.bubble) { e.bubbleT -= dt; if (e.bubbleT <= 0) e.bubble = null; }
    if (e.pingT > 0) e.pingT -= dt;
    while (e.trail.length && T - e.trail[0].t > 2.4) e.trail.shift();
    if (e.held) return;
    if (e.path.length) {
      const p = e.path[0], dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy), step = e.speed * dt;
      if (d <= step) { e.x = p.x; e.y = p.y; e.path.shift(); } else { e.x += dx / d * step; e.y += dy / d * step; }
      const last = e.trail.at(-1);
      if (!last || Math.hypot(last.x - e.x, last.y - e.y) > 6) e.trail.push({ x: e.x, y: e.y, t: T, side: e.trail.length % 2 });
    } else if (!busy(e) && !e.social) {
      e.wanderT -= dt;
      if (e.wanderT <= 0) { e.wanderT = 9 + Math.random() * 9; const spot = freeLounge(); if (spot) goTo(e, spot); }
    }
  }
  const beside = (a, b) => {
    const near = side => spotAt({ x: b.x + side * 20, y: b.y + 2 }), side = a.x <= b.x ? -1 : 1, first = near(side);
    return Math.hypot(first.x - b.x, first.y - b.y) < 34 ? first : near(-side);
  };
  const walkFromHere = (e, spot) => { e.path = pathTo(e, spotAt({ x: e.x, y: e.y }), spot); e.spot = spot; };

  const social = createOfficeSocial({
    employees: () => actors, free: e => !busy(e), beside, say, emote,
    walk: walkFromHere,
    halt: e => { const here = spotAt({ x: e.x, y: e.y }); e.path = [{ x: here.x, y: here.y }]; e.spot = here; },
    coffeeSpot: () => spotAt({ x: 244, y: 164 }), leave: e => goTo(e, idleSpot(e)),
    errands: [
      { spot: () => spotAt({ x: 138, y: 164 }), lines: ['给绿植浇点水', '这盆长得真好'], emote: 'heart' },
      { spot: () => spotAt({ x: 318, y: 170 }), lines: ['翻翻以前的交付', '找本书看看'], emote: 'note' },
      { spot: () => spotAt({ x: 190, y: 148 }), lines: ['看看大家做到哪了', '今天交付了不少'], emote: 'check' },
      { spot: () => spotAt({ x: 180, y: 172 }), lines: ['坐一会儿', '歇口气'], emote: 'steam' },
    ],
  });
  const routines = createRoutines({
    employees: () => actors, say, emote, walk: goTo, home: e => e.desk.seat,
    station: e => STATIONS[e.post] && { ...STATIONS[e.post], post: e.post },
  });
  const motion = createOfficeMotion({
    employees: () => actors, move: goTo, say, idleSpot, mail,
    handoff: (from, to) => { mail(from, to, 'doc', () => emote(to, 'check')); social.handoff(from, to); },
    meetSpot: i => MEET_SPOTS[i % MEET_SPOTS.length],
    reviewSpot: e => QUEUE[actors.indexOf(e) % QUEUE.length],
    stepEmployee: stepActor,
    stepPackets: dt => { for (const p of [...packets]) { p.t += dt; if (p.t >= p.dur) { packets.splice(packets.indexOf(p), 1); p.done?.(); } } },
    speech: async j => {
      const { messages } = await fetch(`/api/workspace/projects/${j.project_id}/messages`, { cache: 'no-store' }).then(r => r.json());
      const m = messages.filter(m => m.sender === j.employee).at(-1);
      const text = (m?.body || '').split('\n').map(l => l.replace(/[#>*`_-]+/g, '').trim()).find(Boolean) || '';
      return { text, to: m?.recipient };
    },
    react: (kind, team) => { if (kind === 'accepted') { social.celebrate(team); for (const e of team) mail('boss', e, 'stamp'); } else if (kind === 'failed' && team[0]) { emote(team[0], 'sweat'); social.comfort(team[0]); } },
  });

  // ---------- what the server says is happening ----------
  function sync(s) {
    snapshot = s;
    const colours = assignColors(s.employees);
    s.employees.forEach((saved, i) => {
      const e = byId.get(saved.id) || hire(saved, i, !firstSync);
      e.name = saved.name; e.post = postKey(saved.profile?.post); e.colour = colours.get(saved.id);
      const [, post, nm] = e.tag.children;
      if (nm.textContent !== e.name) nm.textContent = e.name;
      if (post.textContent !== POSTS[e.post].glyph) post.textContent = POSTS[e.post].glyph;
      e.tag.style.setProperty('--c', e.colour); e.bub.style.setProperty('--c', e.colour);
    });
    for (const e of [...actors]) if (!s.employees.some(saved => saved.id === e.id)) {
      e.tag.remove(); e.bub.remove(); if (e.desk.owner === e) e.desk.owner = null;
      actors.splice(actors.indexOf(e), 1); byId.delete(e.id);
    }
    firstSync = false;
    motion.sync(s);
    renderLegend();
  }
  const stateOf = e => e.held ? '被你拎起来了' : e.waiting ? '等你验收' : e.meeting ? (e.writing?.talk ? '发言中' : '开会中')
    : e.writing ? (e.atStation ? `在${STATIONS[e.post]?.name || '站点'}` : e.errand ? `去${e.errand}` : `在做：${e.writing.out}`) : e.social ? '和同事一起' : e.path.length ? '走动中' : '空闲';
  function renderLegend() {
    const html = actors.map(e => `<button type="button" role="listitem" data-actor="${esc(e.id)}" style="--c:${e.colour}"${busy(e) ? ' data-busy' : ''}><i></i><b>${esc(e.name)}</b><span>${esc(POSTS[e.post].label)} · ${esc(stateOf(e))}</span></button>`).join('');
    if (html === legendKey) return;
    legendKey = html;
    // rebuilt only when something changed, and never while a row is being pressed
    if (!legend.matches(':active')) legend.innerHTML = html;
  }
  legend.addEventListener('click', ev => { const b = ev.target.closest('[data-actor]'); if (b) locate(b.dataset.actor); });
  legend.addEventListener('pointerover', ev => { hover = byId.get(ev.target.closest('[data-actor]')?.dataset.actor) || null; });
  legend.addEventListener('pointerleave', () => { hover = null; });
  const open = id => el.dispatchEvent(new CustomEvent('studio-employee', { detail: id }));
  function locate(id) { const e = byId.get(id); if (!e) return; e.pingT = 2.6; if (!e.bubble) say(e, '我在这儿', 'think', 1.8); }

  // ---------- drawing ----------
  function resize() {
    const width = cv.getBoundingClientRect().width;
    if (!width) return;
    // an even number of screen pixels per floor unit keeps the 1.5× sprites on whole pixels
    const scale = Math.max(2, Math.min(6, 2 * Math.ceil(width * (devicePixelRatio || 1) / W / 2)));
    if (scale === sceneScale && cv.width === W * scale) return;
    sceneScale = scale; cv.width = W * scale; cv.height = H * scale;
  }
  new ResizeObserver(resize).observe(cv);
  const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
  function drawDesk(d) {
    const o = d.owner, at = o && !o.path.length && o.spot === d.seat, on = at && o.writing && !o.writing.talk;
    R(ctx, '#3a3346', d.x + 10, d.y + 2, 8, 6); R(ctx, '#4a4260', d.x + 10, d.y + 2, 8, 2);          // chair
    return () => {
      R(ctx, '#9a7452', d.x, d.y + 10, 28, 4); R(ctx, '#c79f74', d.x, d.y, 28, 10); R(ctx, '#d8b389', d.x, d.y, 28, 1); R(ctx, '#b88f66', d.x, d.y + 9, 28, 1);
      R(ctx, '#2a2d3b', d.x + 1, d.y - 6, 10, 8); R(ctx, '#2a2d3b', d.x + 5, d.y + 2, 2, 2);
      R(ctx, on ? '#16202e' : '#3d4256', d.x + 2, d.y - 5, 8, 6);
      if (on) screen(d.x + 2, d.y - 5, o);
      R(ctx, '#e6e1ea', d.x + 13, d.y + 4, 8, 2); R(ctx, '#cfc9d6', d.x + 13, d.y + 5, 8, 1);
      if (on && !reducedMotion.matches && Math.random() < .25) fx.push({ kind: 'key', x: d.x + 14 + Math.random() * 6, y: d.y + 3, vx: 0, vy: -9, t: 0, dur: .3, colour: o.colour });
      if (o) { R(ctx, '#6a5a48', d.x + 24, d.y - 2, 1, 6); R(ctx, o.colour, d.x + 20, d.y - 2, 4, 3); }        // the owner's flag
      if (d.cupT > 0) { R(ctx, '#efe9dc', d.x + 22, d.y + 5, 3, 3); R(ctx, '#7a4a2c', d.x + 22, d.y + 5, 3, 1); }
    };
  }
  // what the desk screen shows depends on the post: code, a page being laid out, a list, checks, a chart
  function screen(x, y, o) {
    const k = Math.floor(T * 5), c = o.colour, kind = POSTS[o.post].screen;
    if (kind === 'code') for (let i = 0; i < 5; i++) R(ctx, i % 2 ? c : '#9fb8c8', x + 1 + (i + k) % 2, y + i, 2 + (i * 3 + k) % 5, 1);
    else if (kind === 'blocks') { R(ctx, c, x + 1, y + 1, 6, 1); R(ctx, '#c3a6ea', x + 1, y + 3, 2 + k % 3, 2); R(ctx, '#78cfa2', x + 5, y + 3, 2, 1 + k % 2); }
    else if (kind === 'checks') for (let i = 0; i < 3; i++) { R(ctx, i <= k % 4 ? '#78cfa2' : '#5d6a86', x + 1, y + 1 + i * 2, 1, 1); R(ctx, '#9fb8c8', x + 3, y + 1 + i * 2, 4, 1); }
    else if (kind === 'chart') for (let i = 0; i < 4; i++) { const h = 1 + (i * 2 + k) % 4; R(ctx, i % 2 ? c : '#9fb8c8', x + 1 + i * 2, y + 6 - h, 1, h); }
    else for (let i = 0; i < 3; i++) R(ctx, i === k % 3 ? c : '#9fb8c8', x + 1, y + 1 + i * 2, 3 + (i * 2 + (i === k % 3 ? k : 0)) % 4, 1);
  }
  function drawRoute(e) {
    const strong = e === hover || focus.has(e.id) || e.held;
    // footprints fade out behind
    for (const p of e.trail) { ctx.globalAlpha = Math.max(0, 1 - (T - p.t) / 2.4) * (strong ? .9 : .6); R(ctx, e.colour, Math.round(p.x) - 1 + p.side * 2, Math.round(p.y), 2, 1); }
    ctx.globalAlpha = 1;
    if (!e.path.length || e.held) return;
    // the way ahead in this person's own colour, ending in a marker at where they are going
    ctx.save(); ctx.strokeStyle = alpha(e.colour, strong ? .95 : .55); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.lineDashOffset = -T * 14;
    ctx.beginPath(); ctx.moveTo(e.x, e.y - .5); for (const p of e.path) ctx.lineTo(p.x, p.y - .5); ctx.stroke(); ctx.restore();
    const end = e.path.at(-1), pulse = 1 + (Math.sin(T * 6) + 1) * .8;
    ctx.strokeStyle = alpha(e.colour, .9); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(end.x, end.y, 3 + pulse, 1.5 + pulse * .45, 0, 0, Math.PI * 2); ctx.stroke();
    R(ctx, e.colour, end.x - 1, end.y - 1, 2, 2);
  }
  function drawPerson(e) {
    const lift = e.drawLift || 0, { half } = sizeOf(e), x = Math.round(e.x * 2) / 2, y = Math.round(e.y * 2) / 2;
    // rings on the floor: the person's colour when they belong to the selected work, a call-out when you look for them
    if (focus.has(e.id) || e === hover) { ctx.strokeStyle = alpha(e.colour, .9); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, y, half + 2, 4, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (e.pingT > 0) { const k = 1 - (e.pingT % .9) / .9; ctx.strokeStyle = alpha(e.colour, 1 - k); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, half + k * 16, 4 + k * 6, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = `rgba(0,0,0,${lift ? .2 : .3})`; ctx.beginPath(); ctx.ellipse(x, y, lift ? half - 3 : half - 1, lift ? 1.5 : 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(x + (e.held && !reducedMotion.matches ? Math.round(Math.sin(T * 16)) : 0), y - lift); drawFigure(ctx, e); ctx.restore();
    if (held?.on === e) { const { height } = sizeOf(e); ctx.strokeStyle = '#f2b544'; ctx.lineWidth = 1; ctx.strokeRect(x - half - 1.5, y - height - 1.5, half * 2 + 3, height + 3); }
  }
  function tether(a, b, colour, flow) {
    const ax = a.x, ay = a.y - sizeOf(a).height - 2, bx = b.x, by = b.y - sizeOf(b).height - 2;
    ctx.save(); ctx.setLineDash([2, 3]); ctx.lineDashOffset = -T * 12; ctx.strokeStyle = alpha(colour, .75); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.restore();
    if (flow) { const k = (T * .8) % 1; R(ctx, colour, Math.round(ax + (bx - ax) * k) - 1, Math.round(ay + (by - ay) * k) - 1, 2, 2); }
  }
  function drawPacket(p) {
    const k = p.t / p.dur, x = p.from.x + (p.to.x - p.from.x) * k, y = p.from.y - 12 + (p.to.y - p.from.y) * k - Math.sin(Math.PI * k) * 18;
    const px = Math.round(x) - 3, py = Math.round(y) - 3;
    R(ctx, 'rgba(0,0,0,.3)', px + 1, py + 1, 7, 6);
    if (p.kind === 'talk') { R(ctx, '#f4efe2', px, py, 7, 5); R(ctx, '#c9c2b2', px, py, 7, 1); R(ctx, '#c9c2b2', px + 1, py + 1, 1, 1); R(ctx, '#c9c2b2', px + 5, py + 1, 1, 1); R(ctx, '#c9c2b2', px + 2, py + 2, 3, 1); }
    else if (p.kind === 'stamp') { R(ctx, '#78cfa2', px, py, 7, 6); R(ctx, '#1b1824', px + 1, py + 3, 1, 1); R(ctx, '#1b1824', px + 2, py + 4, 1, 1); R(ctx, '#1b1824', px + 3, py + 3, 1, 1); R(ctx, '#1b1824', px + 4, py + 2, 1, 1); R(ctx, '#1b1824', px + 5, py + 1, 1, 1); }
    else { R(ctx, '#efe9dc', px, py, 7, 6); R(ctx, p.kind === 'fix' ? '#ee7b86' : '#c3a6ea', px, py, 7, 2); R(ctx, '#a69fb8', px + 1, py + 3, 5, 1); }
  }
  function draw() {
    const light = daylight(clock());
    ctx.setTransform(sceneScale, 0, 0, sceneScale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bg, 0, 0);
    const open = (snapshot?.projects || []).filter(p => !['done'].includes(p.status));
    paintLive(ctx, {
      t: T, light, calm: reducedMotion.matches, waiting: inbox, meeting: actors.some(e => e.meeting && !e.path.length),
      running: new Set(actors.filter(e => e.writing && !e.writing.talk).map(e => e.post)),
      busyStations: new Set(actors.map(e => e.atStation).filter(s => typeof s === 'string')),
      projects: open.map(p => ({ colour: projectColour(p.id), cells: p.roles.map(r => snapshot.jobs.find(j => j.project_id === p.id && j.role_idx === r.idx)?.status || r.status) })),
    });
    const target = held && !held.on && ROOMS[held.spot?.area];
    if (target) { ctx.fillStyle = 'rgba(242,181,68,.1)'; ctx.fillRect(target.x, target.y, target.w, target.h); }
    for (const e of actors) drawRoute(e);
    if (held?.spot && !held.on) { const { x, y } = held.spot; for (const [dx, dy] of [[-7, -3], [6, -3], [-7, 2], [6, 2]]) R(ctx, '#f2b544', x + dx, y + dy, 2, 1); }
    // everything standing on the floor, far to near, so people pass behind and in front of desks correctly
    const items = [];
    for (const d of SERVER_DESK.owner ? [...DESKS, SERVER_DESK] : DESKS) items.push([d.y + 14, drawDesk(d)]);
    for (const e of actors) items.push([e.y, () => drawPerson(e)]);
    items.sort((a, b) => a[0] - b[0]).forEach(i => i[1]());
    // who is working with whom right now
    for (const e of actors) for (const o of [...(e.links || []), ...(e.talkTo || [])]) if (!e.path.length && !o.path.length) tether(e, o, e.colour, true);
    const team = actors.filter(e => focus.has(e.id) && e.writing && !e.writing.talk && !e.meeting && !e.path.length);
    for (let i = 1; i < team.length; i++) tether(team[i - 1], team[i], team[i].colour, true);
    packets.forEach(drawPacket);
    for (const p of fx) {
      const [rows, colour] = SHAPES[p.kind];
      ctx.globalAlpha = Math.min(1, (p.dur - p.t) / (p.dur * .4)); ctx.fillStyle = p.colour || colour;
      const x = Math.round(p.x - rows[0].length / 2), y = Math.round(p.y);
      rows.forEach((row, r) => [...row].forEach((ch, i) => { if (ch === '#') ctx.fillRect(x + i, y + r, 1, 1); }));
    }
    ctx.globalAlpha = 1;
    if (light.ambient) {
      const lamps = [{ x: 246, y: 150, r: 26, warm: true }, { x: 60, y: 160, r: 34 }];
      for (const e of actors) lamps.push({ x: e.x, y: e.y - 10, r: 26 });
      for (const d of [...DESKS, SERVER_DESK]) if (d.owner?.writing && d.owner.spot === d.seat && !d.owner.path.length) lamps.push({ x: d.x + 8, y: d.y, r: 38, warm: true });
      for (const [key, r] of Object.entries(ROOMS)) if (actors.some(e => inRoom(e, r))) lamps.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, r: 64, warm: key === 'lounge' || key === 'boss' });
      if (inbox) lamps.push({ x: 343, y: 46, r: 40, warm: true });
      paintLighting(ctx, light, lamps, sceneScale);
    }
  }
  // name tags and speech bubbles are real text on top of the canvas, moved only when someone moved
  const pct = (v, total) => (v / total * 100) + '%';
  function place(node, x, y) { const at = x.toFixed(1) + ',' + y.toFixed(1); if (node._at === at) return; node._at = at; node.style.left = pct(x, W); node.style.top = pct(y, H); }
  function statusIcon(e) {
    if (e.waiting) return ['!', 'warn'];
    if (e.writing?.talk) return ['议', 'meet'];
    if (e.atStation || e.errand) return ['→', 'work'];
    if (e.writing) return ['写', 'work'];
    if (e.meeting) return ['会', 'meet'];
    return ['', ''];
  }
  function syncOverlay() {
    const placed = [], tags = [];
    for (const e of [...actors].sort((a, b) => b.y - a.y)) {
      const top = e.y - sizeOf(e).height - 3 - (e.drawLift || 0);
      // name tags of people standing close together stack too, so every name stays readable
      let tagY = top;
      while (tags.some(p => Math.abs(p.x - e.x) < 30 && Math.abs(p.y - tagY) < 7)) tagY -= 7;
      tags.push({ x: e.x, y: tagY });
      place(e.tag, e.x, Math.max(tagY, 7));
      const hot = e === hover || focus.has(e.id);
      if (e.tag.classList.contains('hot') !== hot) e.tag.classList.toggle('hot');
      const [icon, cls] = statusIcon(e), st = e.tag.firstChild;
      if (st.textContent !== icon) { st.textContent = icon; st.className = 'st ' + cls; }
      if (e.bubble) {
        if (e.bub.hidden) e.bub.hidden = false;
        if (e.bub.dataset.txt !== e.bubble) { e.bub.dataset.txt = e.bubble; e.bub.textContent = e.bubble; e.bub.className = 'bubble ' + e.bubbleKind; }
        // bubbles of people standing close together stack instead of covering each other
        const bx = Math.min(Math.max(e.x, 46), W - 46); let by = top - 9;
        while (placed.some(p => Math.abs(p.x - bx) < 80 && Math.abs(p.y - by) < 15)) by -= 15;
        placed.push({ x: bx, y: by });
        place(e.bub, bx, Math.max(by, 12));
      } else if (!e.bub.hidden) e.bub.hidden = true;
    }
  }
  for (const [key, r] of Object.entries(ROOMS)) {
    const label = document.createElement('span');
    label.className = 'room-label'; label.textContent = r.open ? `${r.label} ↗` : r.label;
    label.style.left = pct(r.lx, W); label.style.top = pct(r.ly, H); label.dataset.room = key;
    overlay.append(label);
  }
  const you = document.createElement('span'); you.className = 'you'; you.textContent = '你的座位';
  you.style.left = pct(BOSS_SEAT.x, W); you.style.top = pct(BOSS_SEAT.y + 6, H); overlay.append(you);

  // ---------- time ----------
  function stepEffects(dt) {
    for (const p of [...fx]) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.t >= p.dur) fx.splice(fx.indexOf(p), 1); }
    for (const d of [...DESKS, SERVER_DESK]) if (d.cupT > 0) d.cupT -= dt;
    for (const e of actors) {
      e.lift = (e.lift || 0) + ((e.held ? 9 : 0) - (e.lift || 0)) * Math.min(1, dt * (e.held ? 16 : 11));
      if (e.lift < .2 && !e.held) e.lift = 0;
      if (e.hopT > 0) e.hopT = Math.max(0, e.hopT - dt);
      e.drawLift = Math.round(e.lift + (e.hopT > 0 ? Math.sin(Math.PI * (1 - e.hopT / .45)) * 6 : 0));
    }
    // two people passing each other in the corridor say hello, once in a while
    for (let i = 0; i < actors.length; i++) for (let k = i + 1; k < actors.length; k++) {
      const a = actors[i], b = actors[k];
      if (!a.path.length || !b.path.length || a.held || b.held || Math.hypot(a.x - b.x, a.y - b.y) > 12) continue;
      const pair = a.id + '|' + b.id;
      if (T - (greeted.get(pair) ?? -99) < 25) continue;
      greeted.set(pair, T); emote(a, 'hand'); if (!b.bubble) say(b, Math.random() < .5 ? '嗨～' : '辛苦啦', 'say', 1.4);
    }
  }
  let last = performance.now(), legendT = 0;
  // the people keep moving in a background tab (the work does not stop either); drawing happens only when visible
  setInterval(() => {
    const now = performance.now(); let dt = Math.min(1.5, (now - last) / 1000); last = now; T += dt;
    stepEffects(dt); social.step(dt); routines.step(dt);
    while (dt > 0) { const d = Math.min(.1, dt); motion.step(d); dt -= d; }
    legendT += 1; if (legendT % 10 === 0) renderLegend();
  }, 40);
  let lastPaint = 0;
  // People move 25 times a second, so repainting on every screen refresh would only burn time that
  // clicks and transitions need. Someone being dragged follows the pointer at full speed.
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastPaint < (held ? 14 : 30)) return;
    lastPaint = now;
    if (active && cv.width) { draw(); syncOverlay(); }
    tickPortraits(now / 1000);
  }
  requestAnimationFrame(frame);
  onArtReady(() => { legendKey = ''; });

  // ---------- pointer: click to open, long press to pick someone up ----------
  function toLocal(cx, cy) {
    const r = cv.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
    return { x: (cx - r.left) / r.width * W, y: (cy - r.top) / r.height * H };
  }
  function actorAt(p, skip) {
    let hit = null;
    for (const e of actors) {
      if (e === skip) continue;
      const { height, half } = sizeOf(e);
      if (Math.abs(p.x - e.x) <= half + 1 && p.y >= e.y - height - 1 && p.y <= e.y + 3 && (!hit || e.y > hit.y)) hit = e;
    }
    return hit;
  }
  cv.addEventListener('pointermove', ev => {
    if (held) return;
    const p = toLocal(ev.clientX, ev.clientY); hover = p && actorAt(p) || null;
    const room = p && !hover && Object.values(ROOMS).find(r => r.open && inRoom(p, r));
    cv.style.cursor = hover ? 'grab' : room ? 'pointer' : 'default';
  });
  cv.addEventListener('pointerleave', () => { if (!held) hover = null; });
  cv.addEventListener('click', ev => {
    if (skipClick) { skipClick = false; return; }
    const p = toLocal(ev.clientX, ev.clientY); if (!p) return;
    const e = actorAt(p);
    if (e) { open(e.id); return; }
    // the rooms are doors into the real company systems
    const room = Object.values(ROOMS).find(r => r.open && inRoom(p, r));
    if (room) window.open('/company.html' + room.open, '_blank', 'noopener');
  });
  const clampLocal = ev => {
    const r = cv.getBoundingClientRect();
    return { x: Math.min(W - 4, Math.max(4, (ev.clientX - r.left) / r.width * W)), y: Math.min(H - 4, Math.max(4, (ev.clientY - r.top) / r.height * H)) };
  };
  function holdOver(ev) {
    const p = clampLocal(ev), { e } = held;
    // every sharp change of direction counts: shake someone hard enough and they get dizzy
    const dx = ev.clientX - held.lastX;
    if (Math.abs(dx) > 6) { const dir = Math.sign(dx); if (held.dir && dir !== held.dir) held.turns++; held.dir = dir; held.lastX = ev.clientX; }
    e.x = p.x; e.y = Math.min(H - 2, p.y + FOOT);
    const on = actorAt(p, e) || null;
    held.on = on;
    held.spot = on ? beside(e, on) : spotAt({ x: e.x, y: e.y });
    const hint = social.hint(e, on, held.spot?.area);
    if (hint && hint !== held.hint && performance.now() - held.at > 800) { held.hint = hint; say(e, hint, 'think', 99); }
  }
  function pickUp(ev) {
    const { e, pid } = press; clearTimeout(press.timer); press = null;
    try { cv.setPointerCapture(pid); } catch { /* the pointer already ended */ }
    e.held = true; held = { e, pid, at: performance.now(), lastX: ev.clientX, dir: 0, turns: 0, on: null, spot: null, hint: '' };
    cv.style.cursor = 'grabbing';
    social.pickedUp(e); emote(e, 'dust');
  }
  function drop() {
    const { e, on, spot, turns } = held, land = spot || e.spot, home = e.spot, stay = !busy(e);
    held = null; cv.style.cursor = 'default';
    e.held = false; e.bubble = null; e.x = land.x; e.y = land.y; e.trail.length = 0;
    if (stay) { e.path = []; e.spot = land; e.wanderT = 18 + Math.random() * 12; } else e.path = pathTo(e, land, home);
    emote(e, 'dust');
    social.dropped(e, { on, area: land.area, dizzy: turns >= 6 });
    // the browser sends a click after the pointer lifts; it must not open the employee
    skipClick = true; setTimeout(() => { skipClick = false; }, 60);
  }
  cv.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || held) return;
    const p = toLocal(ev.clientX, ev.clientY), e = p && actorAt(p);
    if (!e) return;
    const start = { clientX: ev.clientX };
    press = { e, pid: ev.pointerId, x: ev.clientX, y: ev.clientY, mouse: ev.pointerType === 'mouse', timer: setTimeout(() => { if (press) pickUp(start); }, HOLD_MS) };
  });
  window.addEventListener('pointermove', ev => {
    if (press && ev.pointerId === press.pid && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) {
      if (press.mouse) pickUp(ev); else { clearTimeout(press.timer); press = null; } // a finger moving before the hold ends is scrolling the page
    }
    if (held && ev.pointerId === held.pid) holdOver(ev);
  });
  const release = ev => {
    if (press && ev.pointerId === press.pid) { clearTimeout(press.timer); press = null; }
    if (held && ev.pointerId === held.pid) drop();
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  cv.addEventListener('touchmove', ev => { if (held) ev.preventDefault(); }, { passive: false });
  cv.addEventListener('contextmenu', ev => { if (held || press) ev.preventDefault(); });

  // ---------- what the rest of the page can ask for ----------
  return {
    el, sync, locate,
    colourOf: id => byId.get(id)?.colour || '#a69fb8',
    avatar: (saved, size = 40) => { const e = byId.get(saved.id); return e ? avatarOf(e, size) : document.createElement('span'); },
    defaultName: type => nextName(type, actors.map(a => a.name), actors.filter(a => a.type === type).length),
    // the people who belong to the work the boss is looking at get a ring and their routes drawn stronger
    focus: ids => { focus = new Set(ids || []); },
    setInbox: n => { inbox = n; },
    setActive: on => { active = on; if (on) resize(); },
    // the boss did something to this person: it visibly leaves the boss's desk and arrives
    signal(kind, id) {
      const e = byId.get(id); if (!e) return;
      if (kind === 'message') mail('boss', e, 'talk', () => { emote(e, 'note'); say(e, '收到老板的消息', 'think', 2.4); });
      else if (kind === 'approve') mail('boss', e, 'stamp', () => { emote(e, 'star'); say(e, '通过了，谢谢老板！', 'say', 2.4); });
      else if (kind === 'revise') mail('boss', e, 'fix', () => { emote(e, 'sweat'); say(e, '收到，这就改', 'say', 2.4); });
    },
  };
}
