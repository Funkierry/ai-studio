// Who can work here and how to tell them apart: looks per kind of AI, posts, and one colour per person.
// Looks follow the AI-girl characters popular on the Chinese internet (fan creations, not official mascots):
// DeepSeek娘 the blue-haired whale maid, Claude娘 with long orange hair and a white gown, GPT娘 the silver-haired dragon lady.
// 鲸鱼娘 is a character by ZipZipPipe & 上善无形 (github.com/Neko3000/deepseek-whalechan); non-commercial fan use only.
export const TYPES = {
  claude: { model: 'Claude', names: ['克劳德', '克莱尔', '柯蓝', '小葵'], hue: '#ff9f5a',
    look: { hair: '#ff7a1a', hairShade: '#c94e14', hairLight: '#ffa65a', eyes: '#ff6f15', skin: '#fff0e4', style: 'long', length: 'xlong', acc: ['orangeFlower', 'blackRibbon'] },
    outfits: [{ dress: '#fbf6ee', trim: '#ff7a1a', gown: true, legs: '#fbf6ee', shoes: '#e8ddd0' },
      { dress: '#ff7a1a', trim: '#fbf6ee', collar: '#fbf6ee', legs: '#fbf6ee', shoes: '#2a1c1c' },
      { dress: '#2a1c1c', trim: '#ff7a1a', apron: true, legs: '#2a1c1c', shoes: '#2a1c1c' }] },
  gpt: { model: 'GPT', names: ['阿 G', '小 G', '吉皮', '白龙'], hue: '#d9d2f5',
    look: { hair: '#eceef6', hairShade: '#b9bccf', hairLight: '#ffffff', eyes: '#9a62d8', skin: '#f8e0cc', style: 'long', acc: ['horns', 'wings', 'dragonTail'] },
    outfits: [{ dress: '#ffffff', trim: '#d6ae46', gold: true, legs: '#ffffff' }, { dress: '#2a2836', trim: '#d6ae46', collar: '#ffffff', legs: '#2a2836' }, { dress: '#e9e4ff', trim: '#9a62d8', legs: '#ffffff' }] },
  deepseek: { model: 'DeepSeek', names: ['阿深', '深深', '鲸鲸', '小蓝'], hue: '#6ea8ff',
    look: { hair: '#4d62b0', hairShade: '#314384', hairLight: '#7089d8', eyes: '#3f78e0', skin: '#fbf1ea', style: 'long',
      fin: '#e6edf7', finEdge: '#9fb0d6', tail: '#1d2d60', tailBelly: '#8a97bd', acc: ['elfFins', 'ahoge', 'maidCap', 'whaleTail', 'glasses', 'whaleClip'] },
    outfits: [{ dress: '#1d2d60', trim: '#ffffff', maid: true, bow: '#749ce0', legs: '#f4f4f8', stripes: '#749ce0', shoes: '#081350' },
      { dress: '#1d2d60', trim: '#749ce0', collar: '#ffffff', legs: '#f4f4f8', shoes: '#302e37' },
      { dress: '#9fc4ef', trim: '#ffffff', collar: '#ffffff', legs: '#f4f4f8', shoes: '#ffffff' }] },
  gemini: { model: 'Gemini', names: ['双子', '小双', '星河'], hue: '#a98cf0',
    look: { hair: '#5b8def', hair2: '#a273e6', hairShade: '#3d64c0', hairLight: '#b4cdff', eyes: '#7a5af0', skin: '#f6dccb', style: 'buns', acc: ['star'] },
    outfits: [{ dress: '#2b2f5a', trim: '#ffd76a', collar: '#ffd76a', legs: '#2b2f5a' }, { dress: '#ffffff', trim: '#7a5af0', sash: true, legs: '#2b2f5a' }] },
  codex: { model: 'Codex', names: ['小码', '码码'], hue: '#5fd39a', needs: 'server',
    look: { hair: '#2e2e3a', hairShade: '#1c1c26', hairLight: '#5a5a70', eyes: '#36c97a', skin: '#f4d6bf', style: 'short', acc: ['glasses', 'smallHorns'] },
    outfits: [{ dress: '#3a3f4b', trim: '#36c97a', hood: true, legs: '#2b2838' }] },
};
const SPARE = ['#c47a5a', '#5a9a8a', '#9a7ac0', '#c0a050'];
export const shade = (hex, f) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)))).map(v => v.toString(16).padStart(2, '0')).join('');
// kinds added in models.json get a simple look in a colour of their own
export function addCustomTypes(custom = []) {
  custom.forEach((t, i) => {
    if (TYPES[t.type]) return;
    const c = SPARE[i % SPARE.length];
    TYPES[t.type] = { model: t.label, names: t.names?.length ? t.names : [t.label], hue: shade(c, 1.25),
      look: { hair: c, hairShade: shade(c, .75), hairLight: shade(c, 1.3), eyes: shade(c, .6), skin: '#f6d9c4', style: 'long', acc: [] },
      outfits: [{ dress: shade(c, .55), trim: '#ffffff', collar: '#ffffff', legs: '#2b2838' }] };
  });
}
export const typeOf = type => TYPES[type] || TYPES.claude;
export function nextName(type, taken, sameKind = 0) {
  const t = TYPES[type];
  if (!t) return '';
  const used = new Set(taken);
  return t.names.find(n => !used.has(n)) || `${t.names[0]} ${sameKind + 1}号`;
}

// Posts: the label people read, one character for the badge, and what the desk screen shows while they work.
export const POSTS = {
  pm: { label: '产品经理', glyph: '产', screen: 'list' },
  frontend: { label: '前端开发', glyph: '前', screen: 'blocks' },
  backend: { label: '后端开发', glyph: '后', screen: 'code' },
  test: { label: '测试', glyph: '测', screen: 'checks' },
  design: { label: '设计', glyph: '设', screen: 'blocks' },
  research: { label: '调研分析', glyph: '研', screen: 'chart' },
  writing: { label: '文案写作', glyph: '文', screen: 'list' },
  general: { label: '通用', glyph: '通', screen: 'code' },
};
// employees hired in the first versions used other names for two posts
export const postKey = k => ({ qa: 'test', writer: 'writing', code: 'backend' }[k] || (POSTS[k] ? k : 'general'));

// One colour per person: their route, their desk flag, their name tag and their cards in the task view all use it.
// The first of each kind takes that kind's own hue; later ones take the next free colour, so three DeepSeek
// colleagues who look alike are still told apart at a glance.
const PALETTE = ['#ff9f5a', '#6ea8ff', '#5fd39a', '#f08fb8', '#e8d06a', '#a98cf0', '#59d0d0', '#d9d2f5', '#ee7b86', '#b8d86a'];
export function assignColors(employees) {
  const colors = new Map(), used = new Set();
  for (const e of employees) {
    const hue = typeOf(e.profile?.type || e.type || e.id).hue;
    const color = !used.has(hue) ? hue : PALETTE.find(c => !used.has(c)) || PALETTE[colors.size % PALETTE.length];
    colors.set(e.id, color); used.add(color);
  }
  return colors;
}
