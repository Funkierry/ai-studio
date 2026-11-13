// The floor plan: rooms, desks, places to stand, and the way from one to another.
// Pure numbers, so the drawing code, the movement code and the tests all agree.
export const W = 384, H = 224;
// everyone crosses the building along the corridor; each person keeps their own lane in it
export const CORRIDOR = 122;

export const ROOMS = {
  meeting: { x: 0, y: 16, w: 112, h: 88, label: '会议室', lx: 3, ly: 17 },
  work: { x: 116, y: 16, w: 164, h: 88, label: '工位区', lx: 252, ly: 17 },
  boss: { x: 284, y: 16, w: 100, h: 88, label: '老板办公室', lx: 287, ly: 17, open: '#records' },
  server: { x: 0, y: 142, w: 120, h: 82, label: '机房 · 代码库', lx: 3, ly: 212, open: '#git' },
  lounge: { x: 124, y: 140, w: 136, h: 84, label: '茶水间', lx: 127, ly: 212 },
  archive: { x: 264, y: 142, w: 120, h: 82, label: '档案室 · 文档库', lx: 267, ly: 212, open: '#docs' },
};
export const BOSS_SEAT = { x: 343, y: 62 };

const lanes = {
  meeting: p => ({ exit: [{ x: p.x, y: 98 }, { x: 56, y: 98 }], cx: 56 }),
  boss: p => ({ exit: [{ x: p.x, y: 98 }, { x: 303, y: 98 }], cx: 303 }),
  hall: p => ({ exit: [], cx: p.x }),
  work: p => {
    const cx = [164, 212, 260].reduce((best, col) => Math.abs(col - p.x) < Math.abs(best - p.x) ? col : best);
    return { exit: [{ x: cx, y: p.y }], cx };
  },
  server: p => ({ exit: [{ x: 61, y: p.y }], cx: 61 }),
  lounge: p => {
    const cx = p.x < 196 ? 138 : 248;
    return { exit: Math.abs(p.x - cx) < 18 ? [] : [{ x: p.x, y: 196 }, { x: cx, y: 196 }], cx };
  },
  archive: p => ({ exit: [{ x: p.x, y: 172 }, { x: 323, y: 172 }], cx: 323 }),
};
// Where feet may stand.
export const AREAS = [
  { key: 'meeting', x0: 6, y0: 34, x1: 106, y1: 98 },
  { key: 'work', x0: 122, y0: 34, x1: 274, y1: 100 },
  { key: 'boss', x0: 290, y0: 34, x1: 378, y1: 98 },
  { key: 'hall', x0: 4, y0: 110, x1: 380, y1: 132 },
  { key: 'server', x0: 6, y0: 174, x1: 114, y1: 218 },
  { key: 'lounge', x0: 136, y0: 150, x1: 254, y1: 218 },
  { key: 'archive', x0: 270, y0: 168, x1: 378, y1: 218 },
];

// Six desks in two rows, and one in the server room for whoever works on this machine's code.
const DESK_ROWS = [36, 70], DESK_COLS = [126, 174, 222];
export const DESKS = DESK_ROWS.flatMap(y => DESK_COLS.map(x => ({
  x, y, owner: null, seat: { x: x + 14, y: y + 7, exit: [{ x: x + 38, y: y + 7 }], cx: x + 38, area: 'work' },
})));
export const SERVER_DESK = { x: 16, y: 179, owner: null, server: true, seat: { x: 30, y: 186, exit: [{ x: 61, y: 186 }], cx: 61, area: 'server' } };

// Things nobody can stand inside: tables, desks, the sofa, the test bench, the easel.
const FURNITURE = [
  [34, 46, 78, 82], [316, 36, 370, 68], [14, 177, 46, 196], [156, 152, 204, 170], [182, 174, 222, 190], [298, 180, 346, 197],
  [80, 196, 112, 212], [5, 76, 19, 99],
  ...DESKS.map(d => [d.x - 2, d.y, d.x + 30, d.y + 17]),
];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const gap = (p, a) => Math.hypot(p.x - clamp(p.x, a.x0, a.x1), p.y - clamp(p.y, a.y0, a.y1));

// The nearest place someone can really stand, with the way out of that room.
export function spotAt(point) {
  const area = AREAS.reduce((best, a) => gap(point, a) < gap(point, best) ? a : best);
  const p = { x: clamp(point.x, area.x0, area.x1), y: clamp(point.y, area.y0, area.y1) };
  const block = FURNITURE.find(([x0, y0, x1, y1]) => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1);
  if (block) {
    const [x0, y0, x1, y1] = block;
    const exits = [[x0 - 1, p.y], [x1 + 1, p.y], [p.x, y0 - 1], [p.x, y1 + 1]]
      .filter(([x, y]) => x >= area.x0 && x <= area.x1 && y >= area.y0 && y <= area.y1)
      .sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.y) - Math.hypot(b[0] - p.x, b[1] - p.y));
    if (exits[0]) [p.x, p.y] = exits[0];
  }
  return { ...p, ...lanes[area.key](p), area: area.key };
}
const at = (x, y) => spotAt({ x, y });

// Around the meeting table, one place per person in a discussion.
export const MEET_SPOTS = [[28, 58], [84, 58], [28, 78], [84, 78], [44, 91], [68, 91]].map(([x, y]) => at(x, y));
// In line at the boss's door, waiting for a delivery to be looked at.
export const QUEUE = [303, 285, 267, 249, 231].map(x => ({ x, y: 117, exit: [], cx: x, area: 'hall' }));
// Where people rest between jobs.
export const LOUNGE = [[140, 170], [148, 210], [184, 202], [220, 214], [250, 178], [226, 164], [250, 208]].map(([x, y]) => at(x, y));
// People who joined after the desks ran out work at the long table in the archive.
export const SPARE_SEATS = [[306, 202], [322, 202], [338, 202], [352, 190], [292, 190]].map(([x, y]) => at(x, y));

// Every post has a place of its own that its people walk to while they work.
// `doing` is what the visit looks like, never a claim about what the model is running.
export const STATIONS = {
  pm: { ...at(56, 36), name: '白板', doing: ['对一下计划板', '把需求拆成几条', '看看谁还卡着'], emote: 'note' },
  frontend: { ...at(266, 36), name: '预览屏', doing: ['看一眼页面效果', '对一下间距', '在大屏上点一遍'], emote: 'bulb' },
  backend: { ...at(66, 176), name: '机柜', doing: ['看看服务日志', '检查一下接口', '机柜灯都是绿的'], emote: 'gear' },
  test: { ...at(96, 192), name: '测试台', doing: ['再跑一遍用例', '复现一下这个问题', '记下一条结果'], emote: 'check' },
  design: { ...at(26, 90), name: '画板', doing: ['画个草图', '换个配色试试', '退后两步看整体'], emote: 'bulb' },
  research: { ...at(300, 170), name: '资料架', doing: ['查一份旧资料', '核对一下出处', '把这几页标出来'], emote: 'note' },
  writing: { ...at(322, 202), name: '阅览桌', doing: ['把这段读出声', '删掉一句废话', '换个标题试试'], emote: 'note' },
  general: { ...at(244, 164), name: '茶水台', doing: ['接杯水接着干', '活动一下肩膀'], emote: 'steam' },
};

// The walk from one spot to another. Inside a room it is a straight line; between rooms it goes
// out to the corridor, along the walker's own lane, and in again.
export function route(a, b, lane = CORRIDOR) {
  const to = { x: b.x, y: b.y };
  if (a.area && a.area === b.area && a.area !== 'hall') {
    if (a.area !== 'work') return [to];
    // between desks on the same aisle: step out into the aisle and back in, never through a desk
    if (a.cx === b.cx) return [...a.exit, ...[...b.exit].reverse(), to];
  }
  return [...a.exit, { x: a.cx, y: lane }, { x: b.cx, y: lane }, ...[...b.exit].reverse(), to];
}
// Lanes are 3 units apart, so two people walking the same way are seen side by side, not as one.
export const laneOf = index => CORRIDOR + ((index % 5) - 2) * 3;
export const inRoom = (p, r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
export const pathLength = (from, path) => path.reduce((sum, p, i) => sum + Math.hypot(p.x - (path[i - 1] || from).x, p.y - (path[i - 1] || from).y), 0);
