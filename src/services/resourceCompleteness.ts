import type { CategoryType } from '../types/media';
import type { QuarkShareDetails } from './quarkStreamService';

const ancillary = /预告|花絮|片头|片尾|主题曲|幕后|宣传片|(?:^|[\s._-])(?:op|ed|mv)(?:[\s._-]|$)/i;

/** Index episode labels are targets; only file entries can establish completeness. */
export function resourceCompleteness(details: QuarkShareDetails, category: CategoryType, advertisedLatest = 0) {
  const videos = details.entries.filter(entry => entry.isVideo && !ancillary.test(entry.name));
  if (category === 'movie') {
    const largest = [...videos].sort((a, b) => (b.size || 0) - (a.size || 0))[0];
    return { complete: Boolean(largest), actualLatest: 0, available: largest ? 1 : 0, target: 1, missing: largest ? [] : [1], episodes: [], selectedFids: largest?.fid ? [largest.fid] : [] };
  }
  const numbered = new Map<number, typeof videos[number]>();
  for (const entry of videos) {
    const number = entry.episodeNumber;
    if (!Number.isInteger(number) || number < 1 || number > 5000) continue;
    const previous = numbered.get(number);
    if (!previous || (entry.size || 0) > (previous.size || 0)) numbered.set(number, entry);
  }
  const actualLatest = Math.max(0, ...numbered.keys());
  const target = Math.max(actualLatest, Math.min(5000, Math.max(0, advertisedLatest)));
  const missing = Array.from({ length: target }, (_, i) => i + 1).filter(number => !numbered.has(number));
  const knownTarget = Number.isInteger(advertisedLatest) && advertisedLatest > 0 && advertisedLatest <= 5000;
  return { complete: knownTarget && target > 0 && !missing.length, actualLatest, available: numbered.size, target, missing, episodes: [...numbered.keys()].sort((a, b) => a - b),
    reason: knownTarget ? '' : '来源未提供可核对的更新集数，无法确认是否已找齐最新剧集。',
    selectedFids: [...numbered.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => entry.fid).filter(Boolean) };
}

export function episodeRangeLabel(episodes: number[]) {
  const ranges: string[] = [];
  for (let index = 0; index < episodes.length; index++) {
    const start = episodes[index]; let end = start;
    while (episodes[index + 1] === end + 1) end = episodes[++index];
    ranges.push(start === end ? String(start) : `${start}～${end}`);
  }
  return ranges.length > 5 ? `第 ${ranges.slice(0, 5).join('、')} 等集，最高第 ${episodes[episodes.length - 1]} 集` : `第 ${ranges.join('、')} 集`;
}
