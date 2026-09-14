import type { DanmakuComment } from './danmakuService';

/** Cap arrivals before rendering so dense platform segments cannot flood a phone. */
export function displayComments(comments: DanmakuComment[], density: 'low' | 'normal', offset: number) {
  const buckets = new Map<number, number>();
  const seen = new Set<string>();
  return [...comments].sort((a, b) => a.time - b.time).filter(comment => {
    const time = comment.time + offset;
    const bucket = Math.floor(time / 2);
    const count = buckets.get(bucket) || 0;
    const key = `${Math.floor(time / 10)}:${comment.text}`;
    if (time < 0 || comment.text.length > 80 || seen.has(key) || count >= (density === 'low' ? 1 : 2)) return false;
    seen.add(key); buckets.set(bucket, count + 1); return true;
  }).map(comment => ({
    text: comment.text, time: comment.time + offset, mode: comment.mode,
    style: { color: comment.color, fontSize: '17px', fontWeight: '500', textShadow: '1px 1px 2px #000, -1px -1px 1px #000' }
  }));
}
