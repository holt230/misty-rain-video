import type { CategoryType } from '../types/media';
import type { QuarkShareDetails } from './quarkStreamService';
import { fileSourceColor, leastCompatibleColor, sourceColorRank } from '../../server/sourceColor.js';

const ancillary = /预告|花絮|片头|片尾|主题曲|幕后|宣传片|(?:^|[\s._-])(?:op|ed|mv)(?:[\s._-]|$)/i;

/** Index episode labels are targets; only file entries can establish completeness. */
export function resourceCompleteness(details: QuarkShareDetails, category: CategoryType, advertisedLatest = 0, releaseTitle = details.title) {
  const folders = new Map(details.entries.filter(entry => entry.isDirectory).map(entry => [entry.fid, entry.name]));
  const videos = details.entries.filter(entry => entry.isVideo && !ancillary.test(entry.name))
    .map(entry => ({ ...entry, colorFormat: fileSourceColor(entry, folders, releaseTitle) }));
  const preferColor = (a: typeof videos[number], b: typeof videos[number]) =>
    sourceColorRank(a.colorFormat) - sourceColorRank(b.colorFormat) || (b.size || 0) - (a.size || 0);
  if (category === 'movie') {
    const chosen = videos.sort(preferColor)[0];
    return { complete: Boolean(chosen), actualLatest: 0, available: chosen ? 1 : 0, target: 1, missing: chosen ? [] : [1], episodes: [],
      selectedFids: chosen?.fid ? [chosen.fid] : [], colorFormat: chosen?.colorFormat || 'unknown' as const };
  }
  const byPart = new Map<string, typeof videos[number]>();
  for (const entry of videos) {
    const number = entry.episodeNumber;
    if (!Number.isInteger(number) || number < 1 || number > 5000) continue;
    const key = `${number}:${category === 'variety' ? entry.episodePart || '' : ''}`;
    const previous = byPart.get(key);
    if (!previous || preferColor(entry, previous) < 0) byPart.set(key, entry);
  }
  const selected = [...byPart.values()].filter(entry => category !== 'variety' || !entry.episodePart || !byPart.has(`${entry.episodeNumber}:`))
    .sort((a, b) => a.episodeNumber - b.episodeNumber || '上中下'.indexOf(a.episodePart || '') - '上中下'.indexOf(b.episodePart || ''));
  const numbered = new Set(selected.map(entry => entry.episodeNumber));
  const actualLatest = Math.max(0, ...numbered);
  const target = Math.max(actualLatest, Math.min(5000, Math.max(0, advertisedLatest)));
  const missing = Array.from({ length: target }, (_, i) => i + 1).filter(number => !numbered.has(number));
  const knownTarget = Number.isInteger(advertisedLatest) && advertisedLatest > 0 && advertisedLatest <= 5000;
  const partialIssue = category === 'variety' && selected.some(entry => entry.episodePart && (!byPart.has(`${entry.episodeNumber}:上`) || !byPart.has(`${entry.episodeNumber}:下`)));
  return { complete: knownTarget && target > 0 && !missing.length && !partialIssue, partialIssue, actualLatest, available: numbered.size, target, missing, episodes: [...numbered],
    colorFormat: leastCompatibleColor(selected.map(entry => entry.colorFormat)),
    reason: knownTarget ? '' : '来源未提供可核对的更新集数，无法确认是否已找齐最新剧集。',
    selectedFids: selected.map(entry => entry.fid).filter(Boolean) };
}

export function episodeRangeLabel(episodes: number[], unit: '集' | '期' = '集') {
  const ranges: string[] = [];
  for (let index = 0; index < episodes.length; index++) {
    const start = episodes[index]; let end = start;
    while (episodes[index + 1] === end + 1) end = episodes[++index];
    ranges.push(start === end ? String(start) : `${start}～${end}`);
  }
  return ranges.length > 5 ? `第 ${ranges.slice(0, 5).join('、')} 等${unit}，最高第 ${episodes[episodes.length - 1]} ${unit}` : `第 ${ranges.join('、')} ${unit}`;
}
