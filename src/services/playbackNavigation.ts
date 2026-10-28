import type { MediaItem, PlaybackHistoryEntry } from '../types/media';
const key = 'misty_rain_playback_pages';
export interface PlaybackPageContext { owner: string; media: MediaItem; historyEntry: PlaybackHistoryEntry | null; updatedAt: number }
const read = (storage: Storage): Record<string, PlaybackPageContext> => {
  try { const value = JSON.parse(storage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
};
export function savePlaybackPage(owner: string, media: MediaItem, historyEntry: PlaybackHistoryEntry | null, storage = sessionStorage, id: string = crypto.randomUUID()) {
  const entries = read(storage); entries[id] = { owner, media, historyEntry, updatedAt: Date.now() };
  const recent = Object.entries(entries).sort((a,b) => b[1].updatedAt - a[1].updatedAt).slice(0,20);
  try { storage.setItem(key, JSON.stringify(Object.fromEntries(recent))); } catch { /* Current page remains playable without persistence. */ }
  return id;
}
export function loadPlaybackPage(owner: string, id: string, storage = sessionStorage): PlaybackPageContext | null {
  const entry = read(storage)[id];
  return entry?.owner === owner && entry.media?.id && entry.media.title && ['movie','tv','anime','variety'].includes(entry.media.category) ? entry : null;
}
export function clearPlaybackPages(storage = sessionStorage) { try { storage.removeItem(key); } catch { /* Private browsing. */ } }

export function firstPlayableEpisode(episodes: Array<{ episodeNumber: number; seasonNumber?: number; ancillary?: boolean }>, category?: string) {
  const files = episodes.map((episode, index) => ({ ...episode, index }));
  const main = files.filter(item => !item.ancillary);
  const candidates = main.length ? main : files;
  if (category === 'movie') return candidates[0]?.index || 0;
  const numbered = candidates.filter(item => item.episodeNumber > 0)
    .sort((a,b) => (a.seasonNumber || 1) - (b.seasonNumber || 1) || a.episodeNumber - b.episodeNumber);
  return numbered[0]?.index ?? candidates[0]?.index ?? 0;
}

export function nextPlayableEpisode(episodes: Array<{ episodeNumber: number; seasonNumber?: number; ancillary?: boolean }>, index: number, category?: string, cachedOnly = false) {
  const current = episodes[index];
  if (!current || current.ancillary || category === 'movie' || cachedOnly || current.episodeNumber <= 0) return -1;
  const season = current.seasonNumber || 1;
  // Do not jump missing episodes or match the same episode number in another season.
  return episodes.findIndex(item => !item.ancillary && (item.seasonNumber || 1) === season && item.episodeNumber === current.episodeNumber + 1);
}

/** A source switch keeps the same season/episode; it must not jump over a missing episode. */
export function replacementEpisodeIndex(episodes: Array<{episodeNumber: number; seasonNumber?: number; fileName: string; ancillary?: boolean}>, current: {episodeNumber: number; seasonNumber?: number; fileName: string; ancillary?: boolean}, category: string) {
  if (category === 'movie') return episodes.length ? firstPlayableEpisode(episodes, category) : -1;
  if (current.ancillary) return episodes.findIndex(item => item.fileName === current.fileName);
  if (current.episodeNumber > 0) return episodes.findIndex(item => !item.ancillary && item.episodeNumber === current.episodeNumber && (item.seasonNumber || 1) === (current.seasonNumber || 1));
  return episodes.findIndex(item => item.fileName === current.fileName);
}
