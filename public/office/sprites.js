// How people are drawn: a 12×18 pixel sprite and a 32×32 portrait from the same look,
// or the generated DeepSeek art when there is some for that kind of employee.
import { TYPES, shade } from './roster.js';

const R = (c, colour, x, y, w, h) => { c.fillStyle = colour; c.fillRect(x, y, w, h); };
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- drawn sprite: feet at (0,0), hair top at y=-18 ----------
function drawSprite(g, e) {
  const L=e.look,O=e.outfit,x=-6,y=-18;
  const walking=e.path.length>0||e.held,f=walking?Math.floor(e.anim*7)%2:0;
  const typing=e.writing&&!e.writing.talk&&!walking,a=typing?Math.floor(e.anim*6)%2:0;
  const sway=Math.floor(e.anim*2.5)%2,has=k=>L.acc.includes(k);
  const hairR=(hx,hy,w,h,c)=>R(g,c||(L.hair2&&hx+w/2>6?L.hair2:L.hair),x+hx,y+hy,w,h);
  // behind the body: long hair, twin tails, wings, tails
  if(L.style==='long'){if(L.length==='xlong') hairR(1,3,10,14,L.hairShade);else hairR(2,3,8,10,L.hairShade);}
  if(L.style==='twintail'){hairR(0,3,2,8);hairR(10,3,2,8);R(g,L.hairShade,x+1,y+9,1,2);R(g,L.hairShade,x+10,y+9,1,2);}
  if(has('wings')){R(g,'#eef0fa',x,y+8,2,3);R(g,'#eef0fa',x+10,y+8,2,3);R(g,'#cfd3e6',x,y+10,1,1);R(g,'#cfd3e6',x+11,y+10,1,1);}
  if(has('whaleTail')){
    R(g,L.tail,x+8,y+13,3,2);R(g,L.tailBelly,x+8,y+14,3,1);
    R(g,L.tail,x+10+sway,y+10,2,3);R(g,L.tail,x+12+sway,y+9,1,2);R(g,L.tail,x+9+sway,y+9,1,1);R(g,L.tailBelly,x+10+sway,y+12,2,1);
  }
  if(has('dragonTail')){R(g,'#f4f4fa',x+9,y+14,2,1);R(g,'#f4f4fa',x+10+sway,y+12,2,2);R(g,'#d6ae46',x+11+sway,y+12,1,1);}
  // legs, dress, arms
  R(g,O.legs,x+4,y+15,2,f?2:3);R(g,O.legs,x+6,y+15,2,f?3:2);
  R(g,O.shoes||'#3a2a2a',x+4,y+17-(f?1:0),2,1);R(g,O.shoes||'#3a2a2a',x+6,y+17-(f?0:1),2,1);
  if(O.stripes) R(g,O.stripes,x+4,y+15,4,1);
  R(g,O.dress,x+3,y+9,6,3);R(g,O.dress,x+2,y+12,8,3);R(g,O.trim,x+2,y+14,8,1);
  if(O.apron){R(g,'#ffffff',x+4,y+10,4,4);R(g,'#ffffff',x+5,y+9,2,1);}
  if(O.maid){R(g,'#ffffff',x+4,y+11,4,3);R(g,'#ffffff',x+5,y+10,2,1);R(g,O.bow,x+5,y+12,2,1);R(g,O.bow,x+5,y+9,2,1);}
  if(O.gown){
    R(g,'#2a1c1c',x+2,y+12,2,2);R(g,'#2a1c1c',x+8,y+12,2,2);R(g,O.trim,x+4,y+13,1,1);R(g,O.trim,x+7,y+13,1,1);
    R(g,'#2a1c1c',x+5,y+9,2,1);R(g,O.trim,x+5,y+10,2,1);
  }
  if(O.sash) R(g,O.trim,x+3,y+11,6,1);
  if(O.collar) R(g,O.collar,x+4,y+9,4,1);
  if(O.gold){R(g,O.trim,x+3,y+9,6,1);R(g,O.trim,x+5,y+10,2,4);}
  if(O.hood) R(g,O.trim,x+5,y+10,2,1);
  R(g,O.dress,x+1,y+10+(typing?a:0),1,2);R(g,L.skin,x+1,y+12+(typing?a:0),1,1);
  R(g,O.dress,x+10,y+10+(typing?1-a:0),1,2);R(g,L.skin,x+10,y+12+(typing?1-a:0),1,1);
  if(e.carry){R(g,'#efe9dc',x+9,y+10,4,5);R(g,'#c3a6ea',x+9,y+10,4,1);}
  // very long hair also falls in front of the shoulders
  if(L.length==='xlong'){R(g,L.hair,x+2,y+8,1,6);R(g,L.hair,x+9,y+8,1,6);R(g,L.hairShade,x+2,y+13,1,1);R(g,L.hairShade,x+9,y+13,1,1);}
  // head
  R(g,L.skin,x+3,y+3,6,6);R(g,L.skin,x+5,y+8,2,1);
  hairR(3,1,6,2);hairR(2,2,8,1);hairR(3,3,6,1);R(g,L.hairLight,x+4,y+1,2,1);
  hairR(2,3,1,L.style==='short'?3:4);hairR(9,3,1,L.style==='short'?3:4);
  hairR(3,4,1,1);hairR(5,4,2,1);hairR(8,4,1,1);
  if(L.style==='buns'){hairR(2,0,2,2);hairR(8,0,2,2);}
  if(has('glasses')){R(g,'#22222a',x+3,y+5,6,1);R(g,L.eyes,x+4,y+6,1,1);R(g,L.eyes,x+7,y+6,1,1);}
  else{R(g,L.eyes,x+4,y+5,1,2);R(g,L.eyes,x+7,y+5,1,2);}
  R(g,'#f3a3a3',x+3,y+7,1,1);R(g,'#f3a3a3',x+8,y+7,1,1);
  // accessories
  if(has('horns')){R(g,'#e9d9a2',x+3,y,1,1);R(g,'#e9d9a2',x+8,y,1,1);R(g,'#e9d9a2',x+2,y-1,1,1);R(g,'#e9d9a2',x+9,y-1,1,1);}
  if(has('smallHorns')){R(g,'#cfd3e6',x+3,y,1,1);R(g,'#cfd3e6',x+8,y,1,1);}
  if(has('orangeFlower')){R(g,'#ff7a1a',x+8,y,3,3);R(g,'#ffd24a',x+9,y+1,1,1);}
  if(has('blackRibbon')){R(g,'#2a1c1c',x+10,y+2,1,2);R(g,'#d6ae46',x+10,y+4,1,1);}
  if(has('maidCap')){R(g,'#ffffff',x+3,y+1,6,1);R(g,'#ffffff',x+4,y,1,1);R(g,'#ffffff',x+7,y,1,1);}
  if(has('ahoge')){R(g,L.hair,x+6,y-1,1,1);R(g,L.hair,x+7,y-2,1,1);}
  if(has('elfFins')){
    // pale pointed fin ears angled up and out
    R(g,L.fin,x,y+4,2,2);R(g,L.fin,x-1,y+3,1,1);R(g,L.fin,x-2,y+2,1,1);R(g,L.finEdge,x,y+5,2,1);
    R(g,L.fin,x+10,y+4,2,2);R(g,L.fin,x+12,y+3,1,1);R(g,L.fin,x+13,y+2,1,1);R(g,L.finEdge,x+10,y+5,2,1);
  }
  if(has('star')){R(g,'#ffd76a',x+9,y,1,3);R(g,'#ffd76a',x+8,y+1,3,1);}
  if(has('whaleClip')){R(g,'#62a7f9',x+8,y+3,2,1);R(g,'#62a7f9',x+9,y+2,1,1);}
}

// ---------- bust portrait for lists and cards ----------
function drawPortrait(cv,L,O){
  const c=cv.getContext('2d');c.clearRect(0,0,32,32);c.imageSmoothingEnabled=false;
  const has=k=>L.acc.includes(k);
  const r=(x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(x,y,w,h);};
  const hr=(x,y,w,h,col)=>r(x,y,w,h,col||(L.hair2&&x+w/2>16?L.hair2:L.hair));
  if(has('wings')){r(0,20,7,8,'#eef0fa');r(25,20,7,8,'#eef0fa');r(1,26,5,2,'#cfd3e6');r(26,26,5,2,'#cfd3e6');}
  if(L.style==='long'){if(L.length==='xlong') hr(3,9,26,23,L.hairShade);else hr(6,9,20,20,L.hairShade);}
  if(L.style==='twintail'){hr(1,9,5,18);hr(26,9,5,18);r(3,22,2,4,L.hairShade);r(27,22,2,4,L.hairShade);}
  if(has('whaleTail')){r(25,25,5,4,L.tail);r(27,21,5,4,L.tail);r(30,19,2,3,L.tail);r(27,24,4,1,L.tailBelly);}
  // shoulders and outfit
  r(7,25,18,7,O.dress);
  if(O.apron){r(11,26,10,6,'#ffffff');r(10,26,1,6,'#e6e6ee');r(21,26,1,6,'#e6e6ee');}
  if(O.maid){
    r(12,25,8,7,'#ffffff');r(13,25,6,2,O.bow);r(15,27,2,1,O.bow);r(15,29,2,1,O.bow);r(15,31,2,1,O.bow);
    r(9,27,2,5,'#ffffff');r(21,27,2,5,'#ffffff');
  }
  if(O.gown){
    r(7,27,4,5,'#2a1c1c');r(21,27,4,5,'#2a1c1c');r(8,29,2,2,O.trim);r(22,29,2,2,O.trim);
    r(13,25,6,2,'#2a1c1c');r(15,27,2,2,O.trim);r(12,30,2,1,O.trim);r(18,30,2,1,O.trim);
  }
  if(O.collar){r(11,25,10,2,O.collar);r(15,27,2,2,O.collar);}
  if(O.sash) r(7,29,18,2,O.trim);
  if(O.gold){r(11,25,10,1,O.trim);r(15,26,2,6,O.trim);}
  if(O.hood){r(8,24,16,2,O.dress);r(13,27,1,4,O.trim);r(18,27,1,4,O.trim);}
  r(14,22,4,3,L.skin);
  // face
  r(10,9,12,13,L.skin);r(9,10,14,10,L.skin);
  // hair
  hr(8,5,16,6);hr(7,7,18,4);hr(9,4,14,1);r(11,6,5,1,L.hairLight);
  hr(9,10,14,1);hr(9,11,3,2);hr(14,11,3,1);hr(19,11,4,2);
  hr(7,10,2,L.style==='short'?7:11);hr(23,10,2,L.style==='short'?7:11);
  if(L.length==='xlong'){hr(6,19,3,13);hr(23,19,3,13);r(6,30,3,2,L.hairShade);r(23,30,3,2,L.hairShade);}
  if(L.style==='buns'){hr(5,2,6,6);hr(21,2,6,6);r(7,3,2,1,L.hairLight);}
  // eyes
  const eyeDark=shade(L.eyes,.6);
  r(10,13,4,1,'#2a1f2a');r(18,13,4,1,'#2a1f2a');
  r(11,14,3,4,L.eyes);r(18,14,3,4,L.eyes);r(12,15,2,3,eyeDark);r(19,15,2,3,eyeDark);
  r(11,14,1,1,'#ffffff');r(18,14,1,1,'#ffffff');
  if(has('glasses')){c.strokeStyle='#22222a';c.lineWidth=1;c.strokeRect(9.5,12.5,6,6);c.strokeRect(16.5,12.5,6,6);r(15,15,2,1,'#22222a');}
  r(9,18,2,1,'#f5a5a5');r(21,18,2,1,'#f5a5a5');r(15,19,2,1,'#c0605a');
  // accessories
  if(has('horns')){r(9,1,2,5,'#e9d9a2');r(21,1,2,5,'#e9d9a2');r(8,0,2,2,'#f6ecc8');r(22,0,2,2,'#f6ecc8');}
  if(has('smallHorns')){r(10,2,2,3,'#cfd3e6');r(20,2,2,3,'#cfd3e6');}
  if(has('orangeFlower')){r(22,2,4,8,'#ff7a1a');r(20,4,8,4,'#ff7a1a');r(21,3,6,6,'#ff9440');r(23,5,2,2,'#ffd24a');}
  if(has('blackRibbon')){r(26,8,3,2,'#2a1c1c');r(27,10,2,4,'#2a1c1c');r(27,14,2,2,'#d6ae46');r(28,16,1,2,'#d6ae46');}
  if(has('star')){r(23,2,1,7,'#ffd76a');r(20,5,7,1,'#ffd76a');r(22,4,3,3,'#ffd76a');}
  if(has('whaleClip')){r(20,8,5,2,'#62a7f9');r(24,6,2,2,'#62a7f9');r(21,8,1,1,'#081350');r(20,10,4,1,'#ffffff');}
  if(has('maidCap')){r(9,4,14,2,'#ffffff');for(const sx of [9,12,15,18,21]) r(sx,3,2,1,'#ffffff');r(9,6,14,1,'#dde3ef');}
  if(has('ahoge')){r(16,1,1,4,L.hair);r(17,0,2,1,L.hair);}
  if(has('elfFins')){
    // pale pointed fin ears rising from the sides of the head, a darker edge underneath
    r(6,12,3,3,L.fin);r(4,10,3,3,L.fin);r(2,8,3,3,L.fin);r(1,6,2,2,L.fin);r(0,5,1,1,L.fin);
    r(6,15,3,1,L.finEdge);r(4,13,2,1,L.finEdge);r(2,11,2,1,L.finEdge);r(1,8,1,1,L.finEdge);
    r(23,12,3,3,L.fin);r(25,10,3,3,L.fin);r(27,8,3,3,L.fin);r(29,6,2,2,L.fin);r(31,5,1,1,L.fin);
    r(23,15,3,1,L.finEdge);r(26,13,2,1,L.finEdge);r(28,11,2,1,L.finEdge);r(30,8,1,1,L.finEdge);
  }
}
function portraitEl(look, outfit, size) {
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32; cv.className = 'portrait';
  cv.style.width = cv.style.height = size + 'px'; drawPortrait(cv, look, outfit); return cv;
}

// ---------- generated art (DeepSeek): animated frames shared by the office and portraits ----------
const ART_SCALE = 4;
const ART = { deepseek: { w: 60, h: 66, head: [11, 3, 38, 38], height: 30 } };
let animation = null;
const ready = new Set();
export const onArtReady = fn => ready.add(fn);
import('../character-animation.js').then(async module => {
  const frames = await module.loadCharacterFrames();
  animation = module;
  for (const a of Object.values(ART)) { a.frames = frames; a.ready = true; }
  ready.forEach(fn => fn());
}).catch(() => {
  // the earlier still picture stands in if the animation sheet cannot load
  const a = ART.deepseek, source = new Image();
  source.onload = () => {
    a.img = document.createElement('canvas'); a.img.width = a.w * ART_SCALE; a.img.height = a.h * ART_SCALE;
    const c = a.img.getContext('2d'); c.imageSmoothingEnabled = false;
    const h = a.img.height, w = h * 578 / 812;
    c.drawImage(source, 338, 268, 578, 812, (a.img.width - w) / 2, 0, w, h);
    a.ready = true; ready.forEach(fn => fn());
  };
  source.src = '/assets/deepseek-girl.png';
});
const artOf = e => ART[e.type]?.ready ? ART[e.type] : null;
const artEls = new Set();
function paintArt(cv, t) {
  const { a, who, headOnly, resolution } = cv._art, c = cv.getContext('2d');
  c.setTransform(resolution, 0, 0, resolution, 0, 0);
  c.clearRect(0, 0, cv.width / resolution, cv.height / resolution);
  c.imageSmoothingEnabled = false;
  const frame = a.frames?.[animation.characterFrame(who, t, reducedMotion.matches)] || a.img;
  c.drawImage(frame, headOnly ? -a.head[0] : 0, headOnly ? -a.head[1] : 0, a.w, a.h);
}
function artEl(a, scale, who, headOnly) {
  const cv = document.createElement('canvas'), [, , hw, hh] = a.head;
  const w = headOnly ? hw : a.w, h = headOnly ? hh : a.h;
  const resolution = Math.max(ART_SCALE, Math.ceil(scale * (devicePixelRatio || 1)));
  cv.width = w * resolution; cv.height = h * resolution; cv.className = 'portrait art';
  cv.style.width = w * scale + 'px'; cv.style.height = h * scale + 'px';
  cv._art = { a, who, headOnly, resolution }; artEls.add(cv); paintArt(cv, performance.now() / 1000);
  return cv;
}
// portraits made from the animated art keep moving; ones no longer on the page are forgotten
export function tickPortraits(seconds) {
  for (const cv of artEls) { if (cv.isConnected) paintArt(cv, seconds); else if (cv._seen) artEls.delete(cv); cv._seen ||= cv.isConnected; }
}

// ---------- what the rest of the office uses ----------
const SPRITE_SCALE = 1.5;
// how tall and how wide someone is on the floor, for name tags, clicks and rings
export const sizeOf = e => artOf(e) ? { height: ART[e.type].height, half: 13 } : { height: 18 * SPRITE_SCALE, half: 9 };
// Draws one person with their feet at (0,0) of the given context.
export function drawFigure(c, e) {
  const a = artOf(e);
  if (!a) {
    c.save(); c.scale(SPRITE_SCALE, SPRITE_SCALE); drawSprite(c, e); c.restore();
    if (e.cup) { R(c, '#efe9dc', 7.5, -12, 3, 4.5); R(c, '#7a4a2c', 7.5, -12, 3, 1.5); }
    return;
  }
  if (!e.art) {
    e.art = document.createElement('canvas'); e.art.width = a.w * ART_SCALE; e.art.height = a.h * ART_SCALE;
    e.art._art = { a, who: e, headOnly: false, resolution: ART_SCALE };
  }
  paintArt(e.art, e.anim);
  const h = a.height, w = a.w / a.h * h;
  c.imageSmoothingEnabled = false;
  c.drawImage(e.art, -w / 2, -h, w, h);
  if (e.carry) { R(c, '#efe9dc', w / 2 - 4, -h * .35, 4, 5); R(c, '#c3a6ea', w / 2 - 4, -h * .35, 4, 1); }
  if (e.cup) { R(c, '#efe9dc', w / 2 - 4, -h * .38, 3, 4); R(c, '#7a4a2c', w / 2 - 4, -h * .38, 3, 1); }
}
// A picture of an employee for lists and cards: the head of the art when there is some, else the drawn portrait.
// `who` may be an actor in the office or just { type, variant, name }.
export function avatarOf(who, size = 40) {
  const kind = TYPES[who.type] || TYPES.claude, a = ART[who.type];
  if (a) {
    if (a.ready) return artEl(a, size / a.head[2], who, true);
    // the art is still loading: hand back a canvas of the right size and fill it when it arrives
    const holder = document.createElement('canvas'); holder.className = 'portrait art'; holder.style.width = holder.style.height = size + 'px';
    onArtReady(() => { if (holder.isConnected) holder.replaceWith(artEl(a, size / a.head[2], who, true)); });
    return holder;
  }
  return portraitEl(kind.look, kind.outfits[(who.variant || 0) % kind.outfits.length], size);
}
