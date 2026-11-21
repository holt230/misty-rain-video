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

export interface QuarkShareEntry {
  episodePart?: string;
  identityTag?: string;
  sidecarTag?: string;
  duration?: number;
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
  isArchive?: boolean;
  archiveFormat?: string;
}

export interface QuarkShareDetails {
  title: string;
  videoCount: number;
  archiveCount?: number;
  episodeCount: number;
  entries: QuarkShareEntry[];
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
  audioTracks?: PlaybackAudioTrack[];
  audioCompatibility?: boolean;
  singleStereo?: boolean;
  colorCompatibilityRisk?: boolean;
  mimeType: string;
  isHls: boolean;
  delivery?: 'direct' | 'proxy';
  url: string;
  proxyUrl?: string;
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
}

export interface PreparedPlayback {
  episode: QuarkEpisode;
  sources: PlaybackSource[];
  audioTracks: PlaybackAudioTrack[];
  subtitles: PlaybackSubtitle[];
  subtitleNotice?: string;
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
  static async singleStereoSource(source: PlaybackSource, signal: AbortSignal, compatibleEpisode?: {
    sessionId: string;
    episodeFid: string;
    nativeHls: boolean;
  }): Promise<PlaybackSource> {
    if (source.singleStereo || source.isHls || source.mimeType !== 'video/mp4') return source;
    const probe = async (candidate: PlaybackSource, probeSignal: AbortSignal) => {
      const endpoint = candidate.url.split('?')[0]!;
      try {
        const response = await authFetch(endpoint + '/stereo', { method: 'POST', signal: probeSignal });
        if (response.ok && (await response.json()).data?.available === true) return endpoint + '?audio=stereo';
      } catch { /* Keep looking for an independently verified source. */ }
      return undefined;
    };
    let url = await probe(source, AbortSignal.any([signal, AbortSignal.timeout(source.audioCompatibility ? 3000 : 2300)]));
    let confirmed = source;
    try {
      if (!url && compatibleEpisode && source.delivery === 'direct' && !source.audioCompatibility && !signal.aborted) {
        const { sessionId, episodeFid, nativeHls } = compatibleEpisode;
        const playback = await QuarkStreamService.prepareEpisode(sessionId, episodeFid, { nativeHls, audioCompatibility: true }, signal);
        const candidate = playback.sources.find(item => item.audioCompatibility && item.resolution === source.resolution
          && item.mimeType === 'video/mp4' && !item.isHls && !item.colorCompatibilityRisk);
        if (candidate && !signal.aborted) {
          url = await probe(candidate, signal);
          if (url) confirmed = candidate;
        }
      }
      if (!url || signal.aborted) return source;
      return { ...confirmed, id: source.id, audioCompatibility: source.audioCompatibility, url, singleStereo: true, delivery: 'proxy',
        audioTracks: [{ id: 'stereo', label: '立体声', channels: '2', codec: 'aac', language: '' }] };
    } catch {
      return source;
    }
  }

  static getShareDetails(shareUrl: string, passcode = '', signal?: AbortSignal): Promise<QuarkShareDetails> {
    return request('/api/quark/share-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ shareUrl, passcode })
    });
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

  static createPlaybackSession(input: { quarkFid?: string; shareUrl?: string; title?: string; passcode?: string }): Promise<QuarkPlaybackSession> {
    return request<QuarkPlaybackSession>('/api/player/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
  }

  static prepareEpisode(sessionId: string, episodeFid: string, capabilities: { nativeHls: boolean; audioCompatibility?: boolean } = { nativeHls: false }, signal?: AbortSignal): Promise<PreparedPlayback> {
    const action = capabilities.audioCompatibility ? 'compatible-audio' : 'prepare';
    return request<PreparedPlayback>(
      `/api/player/sessions/${encodeURIComponent(sessionId)}/episodes/${encodeURIComponent(episodeFid)}/${action}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nativeHls: capabilities.nativeHls }), signal }
    ).then(playback => ({
      ...playback,
      sources: playback.sources.map(source => ({
        ...source,
        url: withAppBase(source.url),
        ...(source.proxyUrl ? { proxyUrl: withAppBase(source.proxyUrl) } : {})
      })),
      subtitles: playback.subtitles.map(subtitle => ({ ...subtitle, url: withAppBase(subtitle.url) }))
    }));
  }
}
import { apiUrl, withAppBase } from './appUrl';
