import { authFetch } from './authService';
import { apiUrl } from './appUrl';

export type DanmakuPlatform = 'qq' | 'qiyi' | 'youku';
export const platformLabels = { qq: '腾讯视频', qiyi: '爱奇艺', youku: '优酷' };
export interface DanmakuInput {
  mediaKey: string; title: string; category: string; episodeNumber: number; episodeTitle: string;
}
export interface DanmakuWork {
  id: string; title: string; year: string; category: string; categoryLabel: string; platforms: DanmakuPlatform[];
}
export interface DanmakuSource {
  platform: DanmakuPlatform; id: string; url: string; workId: string;
  title: string; year: string; episodeTitle: string; segmentSeconds: number;
}
export interface DanmakuComment { time: number; text: string; color: string; mode: 'rtl' | 'top' | 'bottom' }
export interface DanmakuSegment { comments: DanmakuComment[]; index: number; segmentSeconds: number; fetchedAt: number; stale: boolean }
export interface DanmakuMatch { selected: DanmakuSource | null; candidates: DanmakuWork[]; status: 'matched' | 'choose' | 'missing' }

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
  if (!response.ok || data.code !== 0) throw new Error(data.message || '弹幕暂不可用');
  return data.data as T;
}
export const DanmakuService = {
  match: (input: DanmakuInput, signal: AbortSignal, query = '') => request<DanmakuMatch>('/api/danmaku/match', signal, { ...input, query }),
  select: (input: DanmakuInput, selection: { workId?: string; platform?: DanmakuPlatform; url?: string }, signal: AbortSignal) =>
    request<DanmakuSource>('/api/danmaku/select', signal, { ...input, ...selection }),
  segment: (source: DanmakuSource, index: number, refresh: boolean, signal: AbortSignal) =>
    request<DanmakuSegment>(`/api/danmaku/segment?${new URLSearchParams({ platform: source.platform, id: source.id, index: String(index), refresh: refresh ? '1' : '0' })}`, signal)
};
