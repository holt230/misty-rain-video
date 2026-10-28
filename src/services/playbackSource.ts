import type { PlaybackSource } from './quarkStreamService';

export const configureVideoRequest = (video: HTMLVideoElement, source: PlaybackSource) => {
  // 原生媒体（含 Safari HLS）不要求 CORS；hls.js 读取分片仍需 CORS。
  const nativeMedia = !source.isHls || Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
  if (source.delivery === 'direct' && nativeMedia) video.removeAttribute('crossorigin');
  else video.crossOrigin = 'anonymous';
};

export const playbackSourceLabel = (source: PlaybackSource) => {
  const label = source.resolution === 'dolby_vision' ? `${source.label} 杜比视界` : source.label;
  if (!source.delivery) return label;
  return `${label} · ${source.delivery === 'direct' ? '直连' : '中转'}`;
};

export const selectInitialPlaybackSource = (
  available: PlaybackSource[],
  { preferred = '', preferredDelivery = '', mobile = false, respectPreference = true, preferNativeHls = false } = {}
) => {
  const direct = available.filter(source => source.delivery === 'direct');
  const nativeHls = preferNativeHls ? direct.filter(source => source.isHls) : [];
  const progressive = direct.filter(source => !source.isHls && source.resolution !== 'original');
  const transcoded = direct.filter(source => source.resolution !== 'original');
  const pool = nativeHls.length ? nativeHls : progressive.length ? progressive : transcoded.length ? transcoded : direct;
  // Previously saved relay choices cannot opt playback back into server traffic.
  if (preferredDelivery === 'proxy') preferred = '';
  const efficient = pool.filter(source => source.width || source.height
    ? source.width <= 1920 && source.height <= 1080
    : !['2k', '4k', 'dolby_vision', 'source', 'original'].includes(source.resolution));
  const candidates = mobile && efficient.length ? efficient : pool;
  return (respectPreference ? candidates.find(source => source.resolution === preferred) : undefined)
    || candidates.find(source => source.height === 1080 || source.resolution === 'super')
    || (mobile ? candidates.find(source => source.resolution === 'high') : undefined)
    || candidates[0];
};
