// Presentation only: where the little people stand and what they say to each other.
// Nothing here starts a model call, changes a task or costs money.
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
// Where feet may stand. The numbers follow the rooms drawn in index.html.
export const AREAS = [
  { key: 'meeting', x0: 6, y0: 34, x1: 106, y1: 98 },
  { key: 'work', x0: 122, y0: 34, x1: 274, y1: 100 },
  { key: 'boss', x0: 290, y0: 34, x1: 378, y1: 98 },
  { key: 'hall', x0: 4, y0: 110, x1: 380, y1: 132 },
  { key: 'server', x0: 6, y0: 174, x1: 114, y1: 218 },
  { key: 'lounge', x0: 136, y0: 150, x1: 254, y1: 218 },
  { key: 'archive', x0: 270, y0: 168, x1: 378, y1: 218 },
];
const FURNITURE = [
  [34, 46, 78, 82], [316, 36, 370, 68], [14, 177, 46, 196], [156, 152, 204, 170], [182, 174, 222, 190], [298, 180, 346, 197],
  ...[26, 62].flatMap(y => [126, 174, 222].map(x => [x - 2, y, x + 30, y + 17])),
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
// Places around the meeting table, one for each person in a discussion.
export const MEET_SPOTS = [[28, 58], [84, 58], [28, 78], [84, 78], [44, 91], [68, 91]]
  .map(([x, y]) => ({ x, y, ...lanes.meeting({ x, y }), area: 'meeting' }));

const CHATS = [
  ['今天的需求改了几版了？', '别问，问就是最后一版。'],
  ['你那份文档写完了吗？', '写完了，就等老板看。'],
  ['这个报错你见过吗？', '见过，上次就是我写的。'],
  ['昨晚的测试过了吗？', '全绿，我都不敢信。'],
  ['你的上下文还够吗？', '够……刚才说到哪了？'],
  ['要不要摸会儿鱼？', '嘘，老板的座位看得见这里。'],
  ['老板今天心情怎么样？', '看验收按钮点得快不快。'],
  ['午饭吃什么？', '先把这版交了再说。'],
];
const TYPE_LINES = {
  claude: ['这段我再想想怎么写更清楚。', '我写了个小结，只有三千字。', '先把需求看清楚再动笔。'],
  gpt: ['这事交给我。', '今天就能出稿，放心。', '我很有把握，真的。'],
  deepseek: ['白饭什么时候到？', '深度思考中……其实在发呆。', '摸一小会儿，就一小会儿。'],
};
const PICKUP = ['哇！', '放我下来～', '飞起来了！', '别晃别晃！', '老板要带我去哪？'];
const HIGH_FIVES = [['击个掌！', '耶！'], ['辛苦啦！', '你也是！'], ['合作愉快！', '下次还一起！']];
const ROOMS = {
  meeting: { hint: '放到会议室', lines: ['开会吗？人呢？', '一个人的会议，全票通过。'], emote: 'note' },
  work: { hint: '放到工位区', lines: ['回工位摸鱼……不是，干活。', '键盘还是热的。'], emote: 'note' },
  boss: { hint: '去老板办公室', lines: ['老板好！有什么吩咐？', '我就看看，不碰老板的电脑。'], emote: 'heart' },
  server: { hint: '去机房', lines: ['这里好冷，风扇好吵。', '我来听听服务器的心跳。'], emote: 'note' },
  archive: { hint: '去档案室', lines: ['这些资料够我读一阵子。', '翻翻以前的交付。'], emote: 'note' },
  hall: { hint: '放在走廊', lines: ['我站这儿不挡路吧？', '走廊风景不错。'], emote: 'note' },
};

export function createOfficeSocial({ employees, free, walk, halt, beside, coffeeSpot, leave, say, emote, random = Math.random }) {
  const scenes = new Set();
  let nextIdle = 8 + random() * 8;
  const pick = list => list[Math.floor(random() * list.length) % list.length];
  const inScene = e => [...scenes].some(s => s.cast.includes(e));
  const ready = e => free(e) && !e.held && !inScene(e);
  const available = e => ready(e) && !e.path.length;
  const line = e => random() < .45 && TYPE_LINES[e.type] ? pick(TYPE_LINES[e.type]) : null;

  function end(scene) {
    scenes.delete(scene);
    for (const e of scene.cast) {
      e.social = false; e.links = null; e.cup = false;
      if (free(e)) e.carry = false;
      e.wanderT = 6 + random() * 8;
    }
  }
  // cast: everyone the scene needs to stay free. A colleague at their desk can be spoken to without joining it.
  function play(cast, steps) {
    if (cast.some(e => !free(e) || e.held || inScene(e))) return null;
    const scene = { cast, steps, i: 0, pause: 0, walking: null, walked: 0 };
    for (const e of cast) e.social = true;
    scenes.add(scene);
    return scene;
  }
  function advance(scene, dt) {
    scene.pause -= dt;
    if (scene.pause > 0) return;
    if (scene.walking) {
      scene.walked += dt;
      if (scene.walked > 25) { end(scene); return; }
      if (scene.walking.path.length) return;
      scene.walking = null; scene.walked = 0;
    }
    while (scene.i < scene.steps.length) {
      const [kind, e, value, extra] = scene.steps[scene.i++];
      if (kind === 'go') { walk(e, value()); scene.walking = e; return; }
      if (kind === 'say') { say(e, value, extra); scene.pause = 2.5; return; }
      if (kind === 'wait') { scene.pause = e; return; }
      if (kind === 'emote') emote(e, value);
      if (kind === 'do') e();
    }
    end(scene);
  }
  const chat = (a, b) => {
    const [first, second] = pick(CHATS);
    play([a, b], [
      ['go', a, () => beside(a, b)],
      ['do', () => { a.links = [b]; }],
      ['say', a, line(a) || first], ['say', b, line(b) || second],
      ...(random() < .4 ? [['emote', a, 'heart'], ['emote', b, 'heart']] : [['emote', b, 'note']]),
    ]);
  };
  const coffee = (a, worker) => play([a], [
    ['go', a, coffeeSpot], ['say', a, '接杯咖啡', 'think'], ['emote', a, 'steam'], ['do', () => { a.cup = true; }],
    ['go', a, () => beside(a, worker)],
    ['do', () => { a.links = [worker]; }],
    ['say', a, `${worker.name}，喝口咖啡`],
    ['do', () => { a.cup = false; if (worker.desk) worker.desk.cupT = 60; }], ['emote', worker, 'heart'],
    ['say', worker, '谢谢！'],
    ['do', () => { a.links = null; leave(a); }],
  ]);
  const cheer = (a, b) => play([a], [
    ['do', () => { a.links = [b]; }],
    ['say', a, `${b.name}加油！`], ['emote', b, 'heart'], ['wait', .6],
  ]);
  const highFive = (a, b) => {
    const [first, second] = pick(HIGH_FIVES);
    play([a, b], [
      ['do', () => { a.links = [b]; }],
      ['emote', a, 'hand'], ['emote', b, 'hand'],
      ['say', a, first], ['say', b, second],
    ]);
  };

  function idleScene() {
    const open = employees().filter(available), writers = employees().filter(e => e.writing && !e.writing.talk);
    if (!open.length) return;
    const a = pick(open);
    if (writers.length && random() < .4) { coffee(a, pick(writers)); return; }
    const others = open.filter(e => e !== a);
    if (others.length) chat(a, pick(others));
  }

  return {
    step(dt) {
      for (const scene of [...scenes]) {
        if (scene.cast.some(e => e.held || !free(e))) { end(scene); continue; }
        advance(scene, dt);
      }
      nextIdle -= dt;
      if (nextIdle <= 0) { nextIdle = 14 + random() * 14; idleScene(); }
    },
    pickedUp(e) { say(e, pick(PICKUP)); },
    hint(e, on, area) {
      if (!free(e)) return '放下后会回去接着忙';
      if (on) return ready(on) ? `和${on.name}击掌` : `给${on.name}打气`;
      return area === 'lounge' ? '去喝杯咖啡' : ROOMS[area]?.hint || '放在这里';
    },
    dropped(e, { on, area, dizzy }) {
      if (dizzy) emote(e, 'star');
      if (!free(e)) { say(e, dizzy ? '好晕……我先回去忙了' : '手上还有活，先回去了'); return; }
      if (dizzy) { say(e, '头好晕……'); return; }
      if (on) {
        if (!ready(on)) { cheer(e, on); return; }
        halt(on); // a colleague passing by stops for it
        highFive(e, on);
        return;
      }
      if (area === 'lounge') {
        play([e], [['go', e, coffeeSpot], ['say', e, '来杯咖啡', 'think'], ['emote', e, 'steam'], ['do', () => { e.cup = true; }], ['wait', 2.5]]);
        return;
      }
      const room = ROOMS[area];
      if (room) { emote(e, room.emote); say(e, pick(room.lines)); }
    },
    // the person who finished walks over and hands the work to the next one
    handoff(from, to) {
      if (!ready(from)) return;
      play([from], [
        ['do', () => { from.carry = true; }], ['go', from, () => beside(from, to)],
        ['do', () => { from.links = [to]; }],
        ['say', from, '这份交给你了'],
        ['do', () => { from.carry = false; }], ['emote', to, 'check'],
        ['say', to, '收到'],
        ['do', () => { from.links = null; leave(from); }],
      ]);
    },
    // a colleague comes over when something failed
    comfort(e) {
      const friend = employees().find(o => o !== e && ready(o));
      if (!friend) return;
      play([friend], [
        ['go', friend, () => beside(friend, e)],
        ['do', () => { friend.links = [e]; }],
        ['say', friend, '别急，先看看哪里出错了'], ['emote', e, 'heart'], ['wait', 1],
        ['do', () => { friend.links = null; leave(friend); }],
      ]);
    },
    // the boss accepted the work: everyone who worked on it celebrates
    celebrate(team) {
      for (const e of team) emote(e, 'star');
      if (team[0]) say(team[0], '验收通过！');
      const open = team.filter(ready);
      if (open.length >= 2) {
        const [a, b] = open;
        play([a, b], [['go', a, () => beside(a, b)], ['do', () => { a.links = [b]; }], ['emote', a, 'hand'], ['emote', b, 'hand'], ['say', b, '耶！']]);
      }
    },
  };
}
