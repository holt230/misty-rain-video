import type { CategoryType } from '../types/media';
import { episodeRangeLabel } from './resourceCompleteness';

/** Library file count is not the work's official total, especially for sparse copies. */
export function playbackCoverage(episodes: Array<{ episodeNumber: number; fileName?: string }>, category?: CategoryType, officialLatest = 0) {
  const numbers = [...new Set(episodes.map(item => item.episodeNumber).filter(n => Number.isInteger(n) && n > 0 && n <= 5000))].sort((a, b) => a - b);
  const seasons = new Set(episodes.map(item => item.fileName?.match(/第\s*(\d+)\s*季|s0*(\d+)e/i)).filter(Boolean).map(match => Number(match![1] || match![2])));
  const multipleSeasons = seasons.size > 1;
  const episodic = category === 'tv' || category === 'anime';
  const summary = !episodes.length ? '' : episodic && numbers.length && !multipleSeasons
    ? `可看${episodeRangeLabel(numbers)}` : `片库已有 ${episodes.length} 个视频`;
  const target = Math.max(numbers[numbers.length - 1] || 0, Math.min(5000, Math.max(0, officialLatest)));
  const saved = new Set(numbers);
  const missing = category === 'tv' && !multipleSeasons ? Array.from({ length: target }, (_, index) => index + 1).filter(n => !saved.has(n)) : [];
  return { count: episodic && numbers.length && !multipleSeasons ? numbers.length : episodes.length, summary, missing,
    missingLabel: missing.length ? `${episodeRangeLabel(missing)}尚未存入片库` : '' };
}
