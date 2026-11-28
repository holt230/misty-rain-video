import type { DanmakuComment } from './danmakuService';

type Effect = 'spotlight' | 'reaction' | 'prism';
type DisplayComment = DanmakuComment & { effect?: Effect };
const effectSpacing = 12;
const moment = /^(?:高能(?:预警)?|名场面|封神了?|泪目了?|太燃了|好甜啊?)[\p{P}\s✨🔥]*$/u;
const effectFor = (comment: DanmakuComment): Effect | undefined => {
  if (comment.text.length > 14 || comment.mode === 'bottom') return;
  if (comment.mode === 'top') return 'spotlight';
  if (moment.test(comment.text.trim())) return 'reaction';
  if (/^#[0-9a-f]{6}$/i.test(comment.color) && !/^#(?:ffffff|000000)$/i.test(comment.color)) return 'prism';
};

function renderEffect(text: string, effect: Effect) {
  const badge = document.createElement('span');
  badge.className = `danmaku-highlight danmaku-highlight--${effect}`;
  const mark = document.createElement('span');
  mark.className = 'danmaku-highlight-mark';
  const content = document.createElement('span');
  content.className = 'danmaku-highlight-text';
  content.textContent = text;
  badge.append(mark, content);
  return badge;
}

/** Cap arrivals before rendering so dense platform segments cannot flood a phone. */
export function displayComments(comments: DanmakuComment[], density: 'low' | 'normal', offset: number, effects = true) {
  const buckets = new Map<number, DanmakuComment[]>();
  const seen = new Set<string>();
  const limit = density === 'low' ? 1 : 2;
  for (const comment of [...comments].sort((a, b) => a.time - b.time)) {
    const time = comment.time + offset;
    if (!Number.isFinite(time) || time < 0 || comment.text.length > 80) continue;
    const bucket = Math.floor(time / 2);
    const items = buckets.get(bucket) || [];
    if (!buckets.has(bucket)) buckets.set(bucket, items);
    items.push(comment);
  }

  let lastEffect = -Infinity;
  const result: DisplayComment[] = [];
  const key = (item: DanmakuComment) => `${Math.floor((item.time + offset) / 10)}:${item.text}`;
  for (const items of buckets.values()) {
    // Reserve one existing slot when there's an eligible highlight. A busy segment
    // won't drown it out, and the total number of moving comments stays the same.
    const chosen: DisplayComment[] = [];
    if (effects) for (const item of items) {
      const time = item.time + offset;
      if (time < lastEffect + effectSpacing || seen.has(key(item))) continue;
      const effect = effectFor(item);
      if (!effect) continue;
      chosen.push({ ...item, time, effect });
      seen.add(key(item)); lastEffect = time;
      break;
    }
    for (const item of items) {
      if (chosen.length >= limit) break;
      if (seen.has(key(item))) continue;
      seen.add(key(item));
      chosen.push({ ...item, time: item.time + offset });
    }
    result.push(...chosen.sort((a, b) => a.time - b.time));
  }
  return result.map(({ text, time, mode, color, effect }) => ({
    text, time, mode,
    style: { color, fontSize: '17px', fontWeight: '500', textShadow: '1px 1px 2px #000, -1px -1px 1px #000' },
    ...(effect ? { render: () => renderEffect(text, effect) } : {})
  }));
}
