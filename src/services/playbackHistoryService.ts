import type { PlaybackHistoryEntry, PlaybackHistoryUpdate } from '../types/media';
import { apiUrl } from './appUrl';
import { authFetch } from './authService';

interface ApiEnvelope<T> {
  code: number | string;
  message?: string;
  data?: T;
}

const read = async <T>(response: Response): Promise<T> => {
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || envelope.code !== 0 || envelope.data === undefined) {
    throw new Error(envelope.message || '播放历史服务请求失败');
  }
  return envelope.data;
};

export class PlaybackHistoryService {
  static async list(): Promise<PlaybackHistoryEntry[]> {
    const response = await authFetch(apiUrl('/api/playback-history'), { cache: 'no-store' });
    return read<PlaybackHistoryEntry[]>(response);
  }

  static async save(value: PlaybackHistoryUpdate, keepalive = false): Promise<PlaybackHistoryEntry> {
    const response = await authFetch(apiUrl('/api/playback-history'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      keepalive
    });
    return read<PlaybackHistoryEntry>(response);
  }

  static async remove(id: string): Promise<PlaybackHistoryEntry[]> {
    const response = await authFetch(apiUrl(`/api/playback-history/${encodeURIComponent(id)}`), { method: 'DELETE' });
    return read<PlaybackHistoryEntry[]>(response);
  }
}
