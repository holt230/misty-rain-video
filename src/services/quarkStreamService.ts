import { authFetch } from './authService';

export interface QuarkEpisode {
  episodePart?: string;
  thumbnail?: string;
  fid: string;
  fileName: string;
  episodeNumber: number;
  seasonNumber?: number;
  ancillary?: boolean;
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

export interface QuarkShareEntry {
  fid: string;
  parentFid: string;
  ancestorFids: string[];
  name: string;
  isDirectory: boolean;
  isVideo: boolean;
  size: number;
  sizeFormatted: string;
  episodeNumber: number;
  episodeTitle: string;
  videoCount: number;
  isSubtitle?: boolean;
  thumbnail?: string;
  updatedAt?: string;
}

export interface QuarkShareDetails {
  title: string;
  videoCount: number;
  episodeCount: number;
  entries: QuarkShareEntry[];
  totalSize?: number;
  sizeFormatted?: string;
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
  delivery?: 'direct' | 'proxy';
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
  origin?: 'source' | 'sidecar';
  id: string;
  label: string;
  language: string;
  url: string;
}

export interface QuarkPlaybackSession {
  sessionId: string;
  title: string;
  episodes: QuarkEpisode[];
  cachedOnly?: boolean;
}

export interface PreparedPlayback {
  episode: QuarkEpisode;
  sources: PlaybackSource[];
  audioTracks: PlaybackAudioTrack[];
  subtitles: PlaybackSubtitle[];
  subtitleNotice?: string;
  embeddedSubtitleUrl?: string;
  transferred: boolean;
  expiresAt: string;
}

export interface QuarkConfig {
  isConfigured: boolean;
  libraryConfigured?: boolean;
  cookiePlaybackConfigured?: boolean;
  advancedPlaybackConfigured?: boolean;
  tvTokenExchangeOrigin?: string;
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
  static getShareDetails(shareUrl: string, passcode = ''): Promise<QuarkShareDetails> {
    return request<QuarkShareDetails>('/api/quark/share-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareUrl, passcode })
    }).then(details => ({ ...details, entries: details.entries.map(entry => ({ ...entry, thumbnail: entry.thumbnail ? withAppBase(entry.thumbnail) : '' })) }));
  }

  static createTvAuthSession(): Promise<{ sessionId: string; qrCode: string; expiresAt: string }> {
    return request('/api/player/tv-auth/sessions', { method: 'POST' });
  }

  static pollTvAuthSession(sessionId: string): Promise<{ state: 'pending' | 'expired' | 'confirmed' }> {
    return request(`/api/player/tv-auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'POST' });
  }

  static async getConfig(): Promise<QuarkConfig> {
    return request<QuarkConfig>('/api/quark/config');
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

  static createPlaybackSession(input: { quarkFid?: string; shareUrl?: string; title?: string; passcode?: string; episodeFid?: string }, signal?: AbortSignal): Promise<QuarkPlaybackSession> {
    return request<QuarkPlaybackSession>('/api/player/sessions', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }).then(session => ({ ...session, episodes:session.episodes.map(episode => ({ ...episode, thumbnail:episode.thumbnail ? withAppBase(episode.thumbnail) : '' })) }));
  }

  static prepareEpisode(sessionId: string, episodeFid: string, capabilities: { nativeHls: boolean } = { nativeHls: false }): Promise<PreparedPlayback> {
    return request<PreparedPlayback>(
      `/api/player/sessions/${encodeURIComponent(sessionId)}/episodes/${encodeURIComponent(episodeFid)}/prepare`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(capabilities) }
    ).then(playback => ({
      ...playback,
      episode: { ...playback.episode, thumbnail:playback.episode.thumbnail ? withAppBase(playback.episode.thumbnail) : '' },
      sources: playback.sources.map(source => ({
        ...source,
        url: withAppBase(source.url)
      })),
      subtitles: playback.subtitles.map(subtitle => ({ ...subtitle, url: withAppBase(subtitle.url) }))
    }));
  }
}
import { apiUrl, withAppBase } from './appUrl';
