import type { PlaybackAudioTrack, PlaybackSource } from './quarkStreamService';

type NativeAudioTrack = { id: string; label: string; language: string; enabled: boolean };
type NativeAudioTrackList = ArrayLike<NativeAudioTrack> & EventTarget;

export const getNativeAudioTracks = (video: HTMLVideoElement) =>
  (video as HTMLVideoElement & { audioTracks?: NativeAudioTrackList }).audioTracks;

export const audioTrackChannelLabel = (channels: string) => {
  if (/^(?:2|stereo)$/i.test(channels)) return '立体声';
  if (/^(?:6$|5\.1(?:$|\())/.test(channels)) return '5.1 声道';
  return '';
};

const audioLanguage = (value = '') => value.trim().toLowerCase().replace(/^und$/, '');

export const describeNativeAudioTracks = (tracks: ArrayLike<NativeAudioTrack>, metadata: PlaybackAudioTrack[]) =>
  Array.from(tracks, (track, index) => {
    // The upstream per-file track order applies only when the browser exposes the same set.
    const reported = metadata.length === tracks.length ? metadata[index] : undefined;
    const nativeLanguage = audioLanguage(track.language);
    const reportedLanguage = audioLanguage(reported?.language);
    const details = nativeLanguage && reportedLanguage && nativeLanguage !== reportedLanguage ? undefined : reported;
    return {
      id: track.id || String(index),
      label: track.label || details?.label || `音轨 ${index + 1}`,
      language: nativeLanguage || reportedLanguage,
      codec: details?.codec || '',
      channels: details?.channels || ''
    };
  });

export const findStereoAudioTrack = (tracks: PlaybackAudioTrack[], current: number) => {
  if (audioTrackChannelLabel(tracks[current]?.channels || '') === '立体声') return current;
  const activeLanguage = audioLanguage(tracks[current]?.language);
  return tracks.findIndex(track => audioTrackChannelLabel(track.channels) === '立体声'
    && (!activeLanguage || audioLanguage(track.language) === activeLanguage));
};

export const enableOnlyAudioTrack = (tracks: ArrayLike<NativeAudioTrack>, index: number) => {
  const target = tracks[index];
  if (!target) return false;
  if (!target.enabled) target.enabled = true;
  if (!target.enabled) return false;
  for (const track of Array.from(tracks)) {
    if (track !== target && track.enabled) track.enabled = false;
  }
  return Array.from(tracks).every(track => track.enabled === (track === target));
};

export const configureVideoRequest = (video: HTMLVideoElement, source: PlaybackSource) => {
  // 原生媒体（含 Safari HLS）不要求 CORS；hls.js 读取分片仍需 CORS。
  const nativeMedia = !source.isHls || Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
  if (source.delivery === 'direct' && nativeMedia) video.removeAttribute('crossorigin');
  else video.crossOrigin = 'anonymous';
};

export const playbackSourceLabel = (source: PlaybackSource) => {
  const label = source.resolution === 'dolby_vision' ? `${source.label} 杜比视界` : source.label;
  if (source.singleStereo) return `${label} · 立体声`;
  if (source.audioCompatibility) return `${label} · 兼容音频`;
  if (!source.delivery) return label;
  return `${label} · ${source.delivery === 'direct' ? '直连' : '中转'}`;
};

export const selectInitialPlaybackSource = (
  available: PlaybackSource[],
  { preferred = '', preferredDelivery = '', mobile = false, respectPreference = true, preferNativeHls = false } = {}
) => {
  const nativeHls = preferNativeHls ? available.filter(source => source.delivery === 'direct' && source.isHls) : [];
  // 原生 HLS 设备优先转码流，不能被历史上的杜比 MKV 选择锁定。
  const preferredPool = nativeHls.length && preferredDelivery !== 'proxy' ? nativeHls : available;
  // 新版明确手选的画质和传输方式优先；旧版只保存分辨率，不能因此一直中转。
  if (respectPreference && preferredDelivery) {
    const explicit = preferredPool.find(source => source.resolution === preferred && source.delivery === preferredDelivery);
    if (explicit) return explicit;
  }
  const direct = nativeHls.length ? nativeHls : available.filter(source => source.delivery === 'direct' && source.resolution !== 'original');
  const pool = direct.length ? direct : available;
  const efficient = pool.filter(source => source.width || source.height
    ? source.width <= 1920 && source.height <= 1080
    : !['2k', '4k', 'dolby_vision', 'source', 'original'].includes(source.resolution));
  const candidates = mobile && efficient.length ? efficient : pool;
  return (respectPreference ? candidates.find(source => source.resolution === preferred) : undefined)
    || candidates.find(source => source.height === 1080 || source.resolution === 'super')
    || (mobile ? candidates.find(source => source.resolution === 'high') : undefined)
    || candidates[0];
};
