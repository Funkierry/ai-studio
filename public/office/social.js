// Presentation only: what the little people do together and say to each other between jobs.
// Nothing here starts a model call, changes a task or costs money.
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
const PEEKS = [['写到哪了？我看看', '别看，还没写完！'], ['这段写得不错', '那当然。'], ['需要帮忙吗？', '先不用，快好了。']];
const HIGH_FIVES = [['击个掌！', '耶！'], ['辛苦啦！', '你也是！'], ['合作愉快！', '下次还一起！']];
const ROOMS = {
  meeting: { hint: '放到会议室', lines: ['开会吗？人呢？', '一个人的会议，全票通过。'], emote: 'note' },
  work: { hint: '放到工位区', lines: ['回工位摸鱼……不是，干活。', '键盘还是热的。'], emote: 'note' },
  boss: { hint: '去老板办公室', lines: ['老板好！有什么吩咐？', '我就看看，不碰老板的电脑。'], emote: 'heart' },
  server: { hint: '去机房', lines: ['这里好冷，风扇好吵。', '我来听听服务器的心跳。'], emote: 'note' },
  archive: { hint: '去档案室', lines: ['这些资料够我读一阵子。', '翻翻以前的交付。'], emote: 'note' },
  hall: { hint: '放在走廊', lines: ['我站这儿不挡路吧？', '走廊风景不错。'], emote: 'note' },
};

export function createOfficeSocial({ employees, free, walk, halt, beside, coffeeSpot, leave, say, emote, errands, random = Math.random }) {
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
  // looking over a working colleague's shoulder
  const peek = (a, worker) => {
    const [first, second] = pick(PEEKS);
    play([a], [
      ['go', a, () => beside(a, worker)], ['do', () => { a.links = [worker]; }],
      ['say', a, first], ['say', worker, second], ['emote', a, 'note'],
      ['do', () => { a.links = null; leave(a); }],
    ]);
  };
  // things people do on their own between jobs, each at its own place in the building
  const solo = a => {
    const errand = pick(errands || []);
    if (!errand) return;
    play([a], [['go', a, errand.spot], ['say', a, pick(errand.lines), 'think'], ['emote', a, errand.emote], ['wait', 2.2], ['do', () => leave(a)]]);
  };
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
    const roll = random();
    if (writers.length && roll < .35) { coffee(a, pick(writers)); return; }
    if (writers.length && roll >= .5 && roll < .7) { peek(a, pick(writers)); return; }
    const others = open.filter(e => e !== a);
    if (others.length && roll < .88) chat(a, pick(others));
    else solo(a);
  }

  return {
    step(dt) {
      for (const scene of [...scenes]) {
        if (scene.cast.some(e => e.held || !free(e))) { end(scene); continue; }
        advance(scene, dt);
      }
      nextIdle -= dt;
      if (nextIdle <= 0) { nextIdle = 9 + random() * 10; idleScene(); }
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
