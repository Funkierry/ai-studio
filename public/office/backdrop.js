// The building itself: floors, walls and furniture painted once, and the parts that change
// (sky, wall boards, screens, lights) painted every frame from what is really going on.
import { W, H, STATIONS } from './world.js';

const R = (c, colour, x, y, w, h) => { c.fillStyle = colour; c.fillRect(x, y, w, h); };
export const WINDOWS = [[136, 160], [184, 208], [232, 252], [300, 326], [346, 372]];
export const STATUS_COLOURS = { wait: '#5d5674', queued: '#8a84a0', running: '#7fb6e6', done: '#78cfa2', review: '#f2b544', gate: '#f2b544', failed: '#ee7b86', interrupted: '#ee7b86', blocked: '#ee7b86', paused: '#8a84a0' };

// ---------- painted once ----------
export function paintBackdrop(b) {
  // corridor: tiles and a runner along the lanes people walk
  R(b, '#4e475f', 0, 0, W, H);
  for (let x = 0; x < W; x += 16) R(b, (x / 16) % 2 ? '#575069' : '#514a63', x, 104, 16, 36);
  R(b, '#5d4b6b', 0, 113, W, 18); R(b, '#6d5a7d', 0, 113, W, 1); R(b, '#6d5a7d', 0, 130, W, 1);
  for (let x = 6; x < W; x += 12) R(b, '#66537a', x, 121, 4, 2);

  // work floor: planks
  R(b, '#8a6a4d', 116, 16, 164, 88);
  for (let y = 16, r = 0; y < 104; y += 6, r++) {
    R(b, '#7b5d42', 116, y + 5, 164, 1);
    for (let x = 116 + (r % 2) * 14; x < 280; x += 28) R(b, '#7b5d42', x, y, 1, 5);
    for (let x = 122 + (r * 37) % 23; x < 276; x += 46) R(b, '#94734f', x, y + 2, 7, 1);
  }
  // meeting carpet with a rug under the table
  R(b, '#4c5d86', 0, 16, 112, 88);
  for (let y = 20; y < 104; y += 8) for (let x = 4 + ((y / 8) % 2) * 4; x < 112; x += 8) R(b, '#55689a', x, y, 1, 1);
  R(b, '#3f4e74', 24, 40, 64, 50); R(b, '#5a6ea3', 26, 42, 60, 46); R(b, '#4c5d86', 28, 44, 56, 42);
  // boss carpet
  R(b, '#6f4455', 284, 16, 100, 88); R(b, '#83546a', 292, 30, 84, 64); R(b, '#6f4455', 294, 32, 80, 60);
  for (let x = 298; x < 372; x += 8) { R(b, '#7b4c60', x, 34, 2, 2); R(b, '#7b4c60', x, 88, 2, 2); }
  // lounge tiles
  for (let y = 140; y < H; y += 8) for (let x = 124; x < 260; x += 8) R(b, ((x + y) / 8) % 2 ? '#4a7673' : '#436d6a', x, y, 8, 8);
  // server floor: raised panels
  R(b, '#2b2f3d', 0, 142, 120, 82);
  for (let x = 0; x < 120; x += 12) R(b, '#343a4c', x, 142, 1, 82);
  for (let y = 142; y < H; y += 12) R(b, '#343a4c', 0, y, 120, 1);
  // archive floor
  R(b, '#6a5140', 264, 142, 120, 82);
  for (let y = 146; y < H; y += 6) R(b, '#5f4838', 264, y, 120, 1);
  R(b, '#7d4a4a', 292, 176, 60, 26); R(b, '#8f5a56', 294, 178, 56, 22);

  // top wall
  R(b, '#3b3452', 0, 0, W, 16); R(b, '#2d2741', 0, 0, W, 3); R(b, '#4b4366', 0, 3, W, 1); R(b, '#231e33', 0, 15, W, 1);
  b.fillStyle = 'rgba(0,0,0,.2)'; b.fillRect(0, 16, W, 2);
  for (const [x0, x1] of WINDOWS) { R(b, '#c9d6e8', x0, 4, x1 - x0, 10); R(b, '#2a2540', x0 + 1, 5, x1 - x0 - 2, 8); }
  // whiteboard, clock face, preview screen: frames only, their contents change
  R(b, '#9aa3b4', 24, 3, 64, 11); R(b, '#e3e8ef', 25, 4, 62, 9); R(b, '#7d8696', 30, 14, 52, 1);
  R(b, '#e9e4d6', 118, 4, 9, 9); R(b, '#2a2540', 119, 5, 7, 7); R(b, '#f1ecdd', 120, 6, 5, 5);
  R(b, '#1c1a26', 256, 3, 24, 11); R(b, '#0f1420', 257, 4, 22, 9); R(b, '#2a2738', 266, 14, 4, 2);

  // inner walls, with the doorways left open
  const wall = (x, y, w, h) => { R(b, '#3b3452', x, y, w, h); R(b, '#4b4366', x, y, w, 1); b.fillStyle = 'rgba(0,0,0,.18)'; b.fillRect(x, y + h, w, 2); };
  wall(112, 16, 4, 92); wall(280, 16, 4, 92);
  wall(0, 104, 44, 4); wall(68, 104, 44, 4);
  wall(284, 104, 8, 4); wall(314, 104, 70, 4);
  wall(0, 136, 50, 6); wall(72, 136, 52, 6); wall(120, 142, 4, 82);
  wall(260, 136, 52, 6); wall(334, 136, 50, 6); wall(260, 142, 4, 82);
  // door mats
  R(b, '#7a6a52', 46, 108, 20, 3); R(b, '#7a6a52', 293, 108, 20, 3); R(b, '#3d4256', 52, 133, 18, 3); R(b, '#7a6a52', 314, 133, 18, 3);

  // meeting room: table, chairs, easel
  for (const [x, y] of [[26, 54], [26, 74], [82, 54], [82, 74], [42, 86], [66, 86]]) { R(b, '#2f3a58', x - 3, y - 1, 7, 6); R(b, '#3d4a6e', x - 3, y - 1, 7, 2); }
  R(b, '#7e5d40', 36, 50, 40, 30); R(b, '#9b7451', 36, 48, 40, 30); R(b, '#ad8560', 36, 48, 40, 2); R(b, '#8a6647', 36, 76, 40, 2);
  R(b, '#efe9dc', 42, 54, 8, 6); R(b, '#efe9dc', 60, 64, 9, 6); R(b, '#3d4256', 52, 58, 6, 4); R(b, '#7fb6e6', 53, 59, 4, 2); R(b, '#d06a6a', 44, 56, 4, 1);
  R(b, '#6a4c38', 8, 78, 1, 20); R(b, '#6a4c38', 17, 78, 1, 20); R(b, '#6a4c38', 12, 76, 2, 4);
  R(b, '#f1ecdd', 7, 79, 12, 11); R(b, '#ee7b86', 9, 81, 4, 3); R(b, '#7fb6e6', 13, 84, 4, 4); R(b, '#f2b544', 9, 86, 3, 2);

  // boss office
  R(b, '#4a3027', 318, 52, 50, 4); R(b, '#5e3d31', 318, 38, 50, 14); R(b, '#734b3c', 318, 38, 50, 2);
  R(b, '#9aa0ad', 334, 34, 16, 9); R(b, '#2d3346', 335, 35, 14, 6); R(b, '#c9ced8', 332, 43, 20, 2);
  R(b, '#2a2433', 338, 58, 10, 8); R(b, '#3a3346', 338, 58, 10, 2);
  R(b, '#a3613f', 370, 30, 8, 7); R(b, '#5d9a5a', 368, 20, 12, 10); R(b, '#6fb06a', 371, 22, 5, 4);
  R(b, '#c79a3a', 296, 22, 10, 7); R(b, '#e7c25a', 297, 23, 8, 5); R(b, '#8fb8d8', 299, 24, 4, 3);
  R(b, '#3a2a22', 290, 60, 8, 34); for (let y = 62; y < 92; y += 8) { R(b, '#c46a5a', 291, y, 2, 6); R(b, '#5f8fd0', 293, y, 2, 6); R(b, '#d8b84e', 295, y, 2, 6); }

  // lounge: counter with the coffee machine, sofa, table, plant, cooler
  R(b, '#5b3e2b', 236, 142, 20, 8); R(b, '#a8794d', 236, 142, 20, 2);
  R(b, '#2d2a36', 240, 144, 9, 8); R(b, '#4a4658', 241, 145, 7, 3); R(b, '#ee7b86', 247, 149, 1, 1);
  R(b, '#83495a', 160, 154, 40, 5); R(b, '#9a5a6b', 160, 158, 40, 10); R(b, '#83495a', 158, 156, 3, 12); R(b, '#83495a', 199, 156, 3, 12);
  R(b, '#b06c7e', 164, 159, 14, 6); R(b, '#b06c7e', 182, 159, 14, 6);
  R(b, '#6a4c38', 184, 178, 36, 10); R(b, '#7a5a43', 184, 176, 36, 9); R(b, '#8a694f', 184, 176, 36, 1); R(b, '#efe9dc', 190, 178, 3, 3); R(b, '#efe9dc', 208, 179, 3, 3); R(b, '#d8b84e', 199, 180, 5, 2);
  R(b, '#a3613f', 126, 158, 7, 6); R(b, '#4f8a4e', 124, 148, 11, 11); R(b, '#6fb06a', 127, 146, 5, 6); R(b, '#5d9a5a', 131, 151, 5, 5);
  R(b, '#cfd8e0', 251, 158, 7, 12); R(b, '#9fb8c8', 251, 150, 7, 9); R(b, '#7fb6e6', 252, 148, 5, 4); R(b, '#b5e0ef', 253, 149, 2, 1);
  // the delivery wall above the lounge: frame only, the cards are live
  R(b, '#3b3452', 150, 131, 86, 14); R(b, '#4b4366', 150, 131, 86, 1); R(b, '#2a2540', 152, 133, 82, 10);
  b.fillStyle = 'rgba(0,0,0,.18)'; b.fillRect(150, 145, 86, 2);

  // server room: racks and the test bench
  for (const x of [8, 26, 78, 96]) {
    R(b, '#1d2230', x, 146, 14, 24); R(b, '#2a3142', x, 146, 14, 2); R(b, '#141824', x, 170, 14, 2);
    for (let y = 150; y < 168; y += 4) R(b, '#2f3648', x + 2, y, 10, 2);
  }
  R(b, '#3a4154', 82, 204, 28, 6); R(b, '#565f78', 82, 198, 28, 7); R(b, '#6a7490', 82, 198, 28, 1);
  R(b, '#1c1a26', 85, 193, 9, 7); R(b, '#22303c', 86, 194, 7, 5); R(b, '#1c1a26', 98, 196, 4, 5); R(b, '#1c1a26', 104, 197, 3, 4);
  for (let x = 44; x < 78; x += 4) R(b, '#3d4763', x, 148, 1, 20);

  // archive: shelves, ladder, reading table and lamp
  for (let i = 0; i < 13; i++) {
    R(b, '#4a3628', 268 + i * 8, 146, 8, 18);
    const cols = ['#c46a5a', '#5f8fd0', '#d8b84e', '#5aa37a', '#b99ae0'];
    for (let k = 0; k < 3; k++) R(b, cols[(i + k) % 5], 269 + i * 8 + k * 2, 148 + ((i + k) % 2), 2, 6 - ((i + k) % 2));
    for (let k = 0; k < 3; k++) R(b, cols[(i * 2 + k + 2) % 5], 269 + i * 8 + k * 2, 157, 2, 6);
    R(b, '#3a2a20', 268 + i * 8, 155, 8, 1);
  }
  R(b, '#8a6a4a', 372, 148, 1, 22); R(b, '#8a6a4a', 377, 148, 1, 22); for (let y = 151; y < 170; y += 4) R(b, '#8a6a4a', 372, y, 6, 1);
  R(b, '#6a4c38', 300, 192, 44, 4); R(b, '#7a5a43', 300, 182, 44, 11); R(b, '#8b6a51', 300, 182, 44, 2);
  R(b, '#efe9dc', 310, 185, 10, 6); R(b, '#efe9dc', 326, 186, 8, 5); R(b, '#3a2a20', 338, 180, 2, 6); R(b, '#e7c25a', 336, 178, 6, 3);
}

// ---------- the time of day outside, from the real clock ----------
export function daylight(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 7.5 && h < 17) return { phase: 'day', sky: ['#8ec5dc', '#b5e0ef'], ambient: null };
  if (h >= 6 && h < 7.5) return { phase: 'dawn', sky: ['#e8b48a', '#f3d2a6'], ambient: [238, 226, 226] };
  if (h >= 17 && h < 19) return { phase: 'dusk', sky: ['#e58e62', '#f0b878'], ambient: [236, 214, 206] };
  return { phase: 'night', sky: ['#1a2046', '#27305a'], ambient: [178, 176, 222] };
}

// ---------- painted every frame ----------
// scene: { t, light, projects:[{cells:[status]}], waiting, meeting, running:Set(post), busyStations:Set(post) }
export function paintLive(c, scene) {
  const { t, light } = scene, blink = n => Math.floor(t * n) % 2;
  // windows: sky, a drifting cloud by day, stars by night
  for (const [x0, x1] of WINDOWS) {
    const w = x1 - x0 - 2;
    R(c, light.sky[0], x0 + 1, 5, w, 8); R(c, light.sky[1], x0 + 1, 10, w, 3);
    if (light.phase === 'night') { R(c, '#e8e4ff', x0 + 4 + (x0 % 7), 6, 1, 1); R(c, '#e8e4ff', x1 - 6, 8 + (x0 % 2), 1, 1); if (x0 === 300) R(c, '#f4efd0', x0 + 14, 6, 3, 3); }
    else { const cx = x0 + 1 + ((t * 1.2 + x0) % (w + 8)) - 6; c.save(); c.beginPath(); c.rect(x0 + 1, 5, w, 8); c.clip(); R(c, 'rgba(255,255,255,.75)', cx, 7, 6, 2); R(c, 'rgba(255,255,255,.75)', cx + 1, 6, 3, 1); c.restore(); }
    R(c, '#c9d6e8', x0 + Math.floor((x1 - x0) / 2), 5, 1, 8);
  }
  // whiteboard: one sticky note per piece of open work, and a marker line that grows during a meeting
  R(c, '#e3e8ef', 25, 4, 62, 9);
  R(c, '#d06a6a', 28, 6, 12, 1); R(c, '#5f8fd0', 28, 8, 18, 1); R(c, '#5aa37a', 28, 10, 9, 1);
  scene.projects.slice(0, 8).forEach((p, i) => { R(c, p.colour, 50 + (i % 4) * 9, 5 + Math.floor(i / 4) * 4, 7, 3); R(c, 'rgba(0,0,0,.25)', 50 + (i % 4) * 9, 7, 7, 1); });
  if (scene.meeting) R(c, '#2a2540', 28, 12, 4 + Math.floor((t * 6) % 40), 1);
  // clock with the real time
  const now = new Date(), hand = (angle, len, colour) => { c.strokeStyle = colour; c.lineWidth = 1; c.beginPath(); c.moveTo(122.5, 8.5); c.lineTo(122.5 + Math.sin(angle) * len, 8.5 - Math.cos(angle) * len); c.stroke(); };
  R(c, '#f1ecdd', 120, 6, 5, 5);
  hand((now.getHours() % 12 + now.getMinutes() / 60) / 12 * Math.PI * 2, 1.6, '#2a2540'); hand(now.getMinutes() / 60 * Math.PI * 2, 2.4, '#d06a6a');
  // preview screen: a page being built while front-end or design work runs
  R(c, '#0f1420', 257, 4, 22, 9);
  if (scene.running.has('frontend') || scene.running.has('design')) {
    const k = Math.floor(t * 2) % 6;
    R(c, '#7fb6e6', 258, 5, 20, 2); if (k > 0) R(c, '#c3a6ea', 258, 8, 8, 4); if (k > 1) R(c, '#78cfa2', 267, 8, 11, 1); if (k > 2) R(c, '#5d6a86', 267, 10, 9, 1); if (k > 3) R(c, '#f2b544', 267, 12, 5, 1);
  } else { R(c, '#243044', 258, 5, 20, 2); R(c, '#1b2434', 258, 8, 8, 4); R(c, '#1b2434', 267, 8, 11, 1); R(c, '#1b2434', 267, 10, 9, 1); }
  // delivery wall: a row per open piece of work, a cell per share of it
  R(c, '#2a2540', 152, 133, 82, 10);
  scene.projects.slice(0, 3).forEach((p, row) => {
    R(c, p.colour, 154, 134 + row * 3, 2, 2);
    p.cells.slice(0, 12).forEach((s, i) => {
      const live = s === 'running' && blink(3);
      R(c, live ? '#b5dcff' : STATUS_COLOURS[s] || STATUS_COLOURS.wait, 158 + i * 6, 134 + row * 3, 5, 2);
    });
  });
  if (!scene.projects.length) for (let i = 0; i < 9; i++) R(c, '#3a3452', 158 + i * 8, 136, 6, 4);
  // server racks: lights run faster while back-end work or tests are running
  const hot = scene.running.has('backend') || scene.running.has('test') || scene.running.has('general');
  for (const x of [8, 26, 78, 96]) for (let y = 150; y < 168; y += 4) {
    const on = Math.floor(t * (hot ? 7 : 1.5) + x * .37 + y * .61) % 3;
    R(c, on ? '#78cfa2' : hot ? '#f2b544' : '#2f4a40', x + 10, y, 1, 1); if (hot && on === 1) R(c, '#7fb6e6', x + 3, y, 2, 1);
  }
  // test bench screen
  R(c, scene.running.has('test') ? (blink(4) ? '#78cfa2' : '#3f8f6a') : '#22303c', 86, 194, 7, 5);
  // the boss's in-tray: one sheet per thing waiting for you, and the lamp blinks
  for (let i = 0; i < Math.min(scene.waiting, 5); i++) { R(c, '#efe9dc', 356, 45 - i * 2, 9, 2); R(c, '#c9c2b2', 356, 46 - i * 2, 9, 1); }
  R(c, scene.waiting && blink(2) ? '#ffd76a' : scene.waiting ? '#f2b544' : '#4a4260', 322, 41, 4, 3);
  // coffee machine steam
  if (!scene.calm) for (let i = 0; i < 2; i++) { const k = (t * .6 + i * .5) % 1; c.globalAlpha = 1 - k; R(c, '#e8e4ef', 243 + i * 3 + Math.round(Math.sin(k * 6 + i)), 143 - Math.round(k * 6), 1, 1); c.globalAlpha = 1; }
  // a ring on the floor where someone is using their post's station
  for (const post of scene.busyStations) {
    const s = STATIONS[post]; if (!s) continue;
    c.strokeStyle = 'rgba(242,181,68,.55)'; c.lineWidth = 1; c.setLineDash([2, 2]); c.lineDashOffset = -t * 6;
    c.beginPath(); c.ellipse(s.x, s.y, 8, 3.5, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
  }
  // daylight falling in through the windows
  if (light.phase === 'day' || light.phase === 'dawn' || light.phase === 'dusk') {
    c.fillStyle = light.phase === 'day' ? 'rgba(255,244,214,.07)' : 'rgba(255,190,130,.09)';
    for (const [x0, x1] of WINDOWS) { c.beginPath(); c.moveTo(x0, 18); c.lineTo(x1, 18); c.lineTo(x1 + 12, 62); c.lineTo(x0 + 6, 62); c.fill(); }
  }
}

// ---------- evening and night: the room darkens and whatever is switched on glows ----------
let lightMap = null;
// lamps: [{x, y, r, warm}] in floor units
export function paintLighting(c, light, lamps, scale) {
  if (!light.ambient) return;
  lightMap ||= Object.assign(document.createElement('canvas'), { width: W, height: H });
  const m = lightMap.getContext('2d'), [r, g, b] = light.ambient;
  m.globalCompositeOperation = 'source-over'; m.fillStyle = `rgb(${r},${g},${b})`; m.fillRect(0, 0, W, H);
  m.globalCompositeOperation = 'lighter';
  for (const lamp of lamps) {
    const glow = m.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, lamp.r);
    glow.addColorStop(0, lamp.warm ? 'rgba(96,78,30,.9)' : 'rgba(60,66,60,.9)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    m.fillStyle = glow; m.fillRect(lamp.x - lamp.r, lamp.y - lamp.r, lamp.r * 2, lamp.r * 2);
  }
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'multiply'; c.imageSmoothingEnabled = true;
  c.drawImage(lightMap, 0, 0, W * scale, H * scale); c.restore();
}
