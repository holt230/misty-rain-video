import type { MediaItem, PlaybackHistoryEntry } from '../types/media';

export type CinemaBackdrops = ReadonlyMap<string, string>;

export function cinemaBackdrop(media: MediaItem, backdrops?: CinemaBackdrops) {
  return media.catalogId ? backdrops?.get(media.catalogId) : undefined;
}

export function cinemaWatchProgress(entry?: PlaybackHistoryEntry) {
  if (!entry || !Number.isFinite(entry.duration) || entry.duration <= 0 || !Number.isFinite(entry.position)) return undefined;
  return Math.min(100, Math.max(0, entry.position / entry.duration * 100));
}
