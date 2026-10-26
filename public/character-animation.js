// Shared presentation frames; never starts work or changes server state.
export const CHARACTER = Object.freeze({ width: 60, height: 66, head: [11, 3, 38, 38] });
const CLIPS = {
  idle: { row: 0, durations: [1.6, .8, .12, 1.5] },
  walk: { row: 1, durations: [.16, .16, .16, .16] },
  work: { row: 2, durations: [.18, .18, .18, .18] },
};
export function characterFrame(who, seconds, reducedMotion = false) {
  const mode = who?.path?.length ? 'walk'
    : who?.writing || who?.job?.phase === 'run' ? 'work' : 'idle';
  const clip = CLIPS[mode];
  if (reducedMotion) return clip.row * 4;
  const seed = [...(who?.name || '')].reduce((sum, char) => sum + char.codePointAt(0), 0) % 997 / 997;
  const total = clip.durations.reduce((sum, duration) => sum + duration, 0);
  let elapsed = ((seconds + seed) % total + total) % total;
  for (let column = 0; column < clip.durations.length; column++) {
    if (elapsed < clip.durations[column]) return clip.row * 4 + column;
    elapsed -= clip.durations[column];
  }
  return clip.row * 4;
}
let sheetPromise;
export function loadCharacterFrames() {
  if (sheetPromise) return sheetPromise;
  sheetPromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth !== 1448 || image.naturalHeight !== 1086) {
        reject(new Error('角色动作图尺寸不匹配')); return;
      }
      // Generated rows have different gutters. A shared crop per row aligns faces.
      const rows = [44, 382, 713];
      resolve(rows.flatMap(y => Array.from({ length: 4 }, (_, column) => {
        const canvas = document.createElement('canvas');
        canvas.width = CHARACTER.width * 4; canvas.height = CHARACTER.height * 4;
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(image, column * 362 + 35, y, 300, 328, 0, 0, canvas.width, canvas.height);
        return canvas;
      })));
    };
    image.onerror = () => reject(new Error('角色动作图加载失败'));
    image.src = new URL('./assets/deepseek-girl-animations.png', import.meta.url).href;
  });
  return sheetPromise;
}
