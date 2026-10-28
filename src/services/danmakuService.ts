import { authFetch } from './authService';
import { apiUrl } from './appUrl';

export type DanmakuPlatform = 'qq' | 'qiyi' | 'youku' | 'bilibili';
export const platformLabels = { qq: '腾讯视频', qiyi: '爱奇艺', youku: '优酷',bilibili:'哔哩哔哩' };
export interface DanmakuInput {
  mediaKey: string; associationKey?: string; title: string; category: string; episodeNumber: number; episodeTitle: string; episodePart?: string; year?: string; seasonNumber?: number; categoryConfirmed?: boolean;
}
export interface DanmakuWork {
  id: string; title: string; year: string; category: string; categoryLabel: string; platforms: DanmakuPlatform[];
}
export interface DanmakuSource {
  platform: DanmakuPlatform; id: string; url: string; workId: string;
  title: string; year: string; episodeTitle: string; segmentSeconds: number; episodeNumber?: number; corrected?: boolean; seriesLinked?: boolean;
}
export interface DanmakuEpisode { key: string; number: number; title: string; platforms: DanmakuPlatform[]; }
export interface DanmakuOptions { workId: string; title: string; year?: string; category: string; categoryLabel?: string; episodes: DanmakuEpisode[]; partial?: boolean; }
export interface DanmakuSelection { workId?: string; platform?: DanmakuPlatform; url?: string; targetEpisode?: number; targetEpisodeTitle?: string; scope?: 'season' | 'episode'; }
export interface DanmakuComment { time: number; text: string; color: string; mode: 'rtl' | 'top' | 'bottom' }
export interface DanmakuSegment { comments: DanmakuComment[]; index: number; segmentSeconds: number; fetchedAt: number; stale: boolean }
export interface DanmakuBinding { workId: string; title: string; year: string; platform?: DanmakuPlatform; offset: number }
export interface DanmakuMatch { selected: DanmakuSource | null; candidates: DanmakuWork[]; status: 'matched' | 'choose' | 'missing' | 'unavailable'; binding?: DanmakuBinding; message?: string }
export class DanmakuRequestError extends Error {
  constructor(message: string, public readonly code: string) { super(message); }
}

async function request<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await authFetch(apiUrl(url), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(error instanceof Error && error.name === 'TimeoutError'
      ? '弹幕请求超时，请稍后刷新' : '暂时无法连接弹幕服务，请检查网络后重试');
  }
  const data = await response.json().catch(() => { throw new Error('弹幕服务响应异常，请稍后刷新'); });
  if (!response.ok || data.code !== 0) throw new DanmakuRequestError(data.message || '弹幕暂不可用', String(data.code || ''));
  return data.data as T;
}
export const DanmakuService = {
  match: (input: DanmakuInput, signal: AbortSignal, query = '') => request<DanmakuMatch>('/api/danmaku/match', signal, { ...input, query }),
  select: (input: DanmakuInput, selection: DanmakuSelection, signal: AbortSignal) =>
    request<DanmakuSource>('/api/danmaku/select', signal, { ...input, ...selection }),
  options: (input: DanmakuInput, workId: string, signal: AbortSignal) => request<DanmakuOptions>('/api/danmaku/options', signal, { ...input, workId }),
  segment: (source: DanmakuSource, index: number, refresh: boolean, signal: AbortSignal) =>
    request<DanmakuSegment>(`/api/danmaku/segment?${new URLSearchParams({ platform: source.platform, id: source.id, index: String(index), refresh: refresh ? '1' : '0' })}`, signal)
};
