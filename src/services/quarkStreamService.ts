import { authFetch } from './authService';

export interface QuarkEpisode {
  fid: string;
  fileName: string;
  episodeNumber: number;
  episodeTitle: string;
  updatedAt: string;
  size: number;
  sizeFormatted: string;
  duration: number;
  durationFormatted: string;
  formatType: string;
  width: number;
  height: number;
  fps: number;
  maxResolution: string;
}

export interface PlaybackSource {
  id: string;
  label: string;
  resolution: string;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  mimeType: string;
  isHls: boolean;
  url: string;
}

export interface PlaybackAudioTrack {
  id: string;
  label: string;
  language: string;
  codec: string;
  channels: string;
}

export interface PlaybackSubtitle {
  id: string;
  label: string;
  language: string;
  url: string;
}

export interface QuarkPlaybackSession {
  sessionId: string;
  title: string;
  episodes: QuarkEpisode[];
}

export interface PreparedPlayback {
  episode: QuarkEpisode;
  sources: PlaybackSource[];
  audioTracks: PlaybackAudioTrack[];
  subtitles: PlaybackSubtitle[];
  transferred: boolean;
  expiresAt: string;
}

export interface QuarkConfig {
  isConfigured: boolean;
  libraryConfigured?: boolean;
  cookiePlaybackConfigured?: boolean;
  advancedPlaybackConfigured?: boolean;
  isAuthenticated: boolean;
  nickname?: string;
}

interface ApiEnvelope<T> {
  code: number | string;
  message?: string;
  data?: T;
}

export class QuarkServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = 'QUARK_SERVICE_ERROR', status = 500) {
    super(message);
    this.name = 'QuarkServiceError';
    this.code = code;
    this.status = status;
  }
}

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await authFetch(apiUrl(url), init);
  } catch (error) {
    throw new QuarkServiceError(error instanceof Error ? error.message : '无法连接播放服务', 'NETWORK_ERROR', 0);
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = await response.json();
  } catch {
    throw new QuarkServiceError('播放服务返回了无效响应', 'INVALID_RESPONSE', response.status);
  }
  if (!response.ok || envelope.code !== 0 || !envelope.data) {
    throw new QuarkServiceError(
      envelope.message || '播放服务请求失败',
      String(envelope.code || 'QUARK_SERVICE_ERROR'),
      response.status
    );
  }
  return envelope.data;
};

export class QuarkStreamService {
  static async getConfig(): Promise<QuarkConfig> {
    try {
      return await request<QuarkConfig>('/api/quark/config');
    } catch {
      return { isConfigured: false, isAuthenticated: false };
    }
  }

  static async saveConfig(cookie: string): Promise<{ success: boolean; message: string; status?: QuarkConfig }> {
    try {
      const status = await request<QuarkConfig>('/api/quark/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie })
      });
      return { success: true, message: 'Cookie 已验证并安全保存', status };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '保存失败'
      };
    }
  }

  static createPlaybackSession(input: { quarkFid?: string; shareUrl?: string; title?: string; passcode?: string }): Promise<QuarkPlaybackSession> {
    return request<QuarkPlaybackSession>('/api/player/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
  }

  static prepareEpisode(sessionId: string, episodeFid: string): Promise<PreparedPlayback> {
    return request<PreparedPlayback>(
      `/api/player/sessions/${encodeURIComponent(sessionId)}/episodes/${encodeURIComponent(episodeFid)}/prepare`,
      { method: 'POST' }
    ).then(playback => ({
      ...playback,
      sources: playback.sources.map(source => ({ ...source, url: withAppBase(source.url) })),
      subtitles: playback.subtitles.map(subtitle => ({ ...subtitle, url: withAppBase(subtitle.url) }))
    }));
  }
}
import { apiUrl, withAppBase } from './appUrl';
