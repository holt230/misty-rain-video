<script setup lang="ts">
import type Hls from 'hls.js';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { CircleAlert, ListVideo, LoaderCircle, Play, RefreshCw, SlidersHorizontal, X } from '@lucide/vue';
import type { MediaItem, PlaybackHistoryEntry, PlaybackHistoryUpdate } from '../../types/media';
import {
  QuarkServiceError,
  QuarkStreamService,
  type PlaybackAudioTrack,
  type PlaybackSource,
  type PreparedPlayback,
  type QuarkPlaybackSession
} from '../../services/quarkStreamService';
import { useToast } from '../../composables/useToast';
import { PlaybackHistoryService } from '../../services/playbackHistoryService';

const props = defineProps<{
  isOpen: boolean;
  media: MediaItem | null;
  historyEntry?: PlaybackHistoryEntry | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 're-search', media: MediaItem): void;
  (e: 'open-auth-settings'): void;
  (e: 'history-updated', entry: PlaybackHistoryEntry): void;
}>();

type PlayerPhase = 'idle' | 'resolving' | 'preparing' | 'ready' | 'error' | 'auth-required';
type SoundEffectMode = 'original' | 'dialogue' | 'cinema' | 'night';

interface PlaybackAutomationSettings {
  skipIntroOutro: boolean;
  autoNext: boolean;
  introSeconds: number;
  outroSeconds: number;
}

interface SoundEffectOption {
  value: SoundEffectMode;
  label: string;
  hint: string;
}

const toast = useToast();
const videoRef = ref<HTMLVideoElement | null>(null);
const hlsRef = shallowRef<Hls | null>(null);
const phase = ref<PlayerPhase>('idle');
const session = ref<QuarkPlaybackSession | null>(null);
const playback = ref<PreparedPlayback | null>(null);
const currentEpisodeIndex = ref(0);
const episodeGroupIndex = ref(0);
const settingsExpanded = ref(false);
const episodePanelRef = ref<HTMLElement | null>(null);
const selectedSourceId = ref('');
const errorMessage = ref('');
const statusMessage = ref('');
const playbackStarting = ref(false);
const manualPlayRequired = ref(false);
const playbackHasStarted = ref(false);
const detectedAudioTracks = ref<PlaybackAudioTrack[]>([]);
const selectedAudioIndex = ref(-1);
const playbackAutomationStorageKey = 'misty_rain_playback_automation';
const defaultPlaybackAutomation: PlaybackAutomationSettings = {
  skipIntroOutro: false,
  autoNext: true,
  introSeconds: 90,
  outroSeconds: 90
};
const loadPlaybackAutomation = (): PlaybackAutomationSettings => {
  try {
    const saved = JSON.parse(localStorage.getItem(playbackAutomationStorageKey) || '{}') as Partial<PlaybackAutomationSettings>;
    return {
      skipIntroOutro: saved.skipIntroOutro === true,
      autoNext: saved.autoNext !== false,
      introSeconds: Number.isFinite(saved.introSeconds) ? Math.max(15, Math.min(300, Number(saved.introSeconds))) : 90,
      outroSeconds: Number.isFinite(saved.outroSeconds) ? Math.max(15, Math.min(300, Number(saved.outroSeconds))) : 90
    };
  } catch {
    return { ...defaultPlaybackAutomation };
  }
};
const playbackAutomation = ref<PlaybackAutomationSettings>(loadPlaybackAutomation());
const isIOSPlaybackDevice = typeof navigator !== 'undefined'
  && /iPhone|iPad|iPod/i.test(navigator.userAgent);
const storedSoundEffect = localStorage.getItem('misty_rain_sound_effect');
const soundEffectMode = ref<SoundEffectMode>(
  !isIOSPlaybackDevice && ['original', 'dialogue', 'cinema', 'night'].includes(storedSoundEffect || '')
    ? storedSoundEffect as SoundEffectMode
    : 'original'
);
// iOS WebClip 的 HTMLMediaElement 经过 Web Audio 后不再与原生视频时钟硬同步。
// 手机端优先保证音画和画面内字幕同步，音效仍保留在其他平台。
const soundEffectAvailable = ref(!isIOSPlaybackDevice && typeof window !== 'undefined'
  && Boolean(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext));
let requestSequence = 0;
let previousBodyOverflow = '';
let audioContext: AudioContext | null = null;
let mediaAudioSource: MediaElementAudioSourceNode | null = null;
let dryGain: GainNode | null = null;
let wetGain: GainNode | null = null;
let lowShelf: BiquadFilterNode | null = null;
let presenceFilter: BiquadFilterNode | null = null;
let highShelf: BiquadFilterNode | null = null;
let dynamicsCompressor: DynamicsCompressorNode | null = null;
let lastProgressSavedAt = 0;
let lastSavedPosition = -1;
let savingProgress: Promise<PlaybackHistoryEntry | null> | null = null;
let sourceAttachSequence = 0;
let playAttemptSequence = 0;
let autoNextTimer: number | null = null;
let bufferingTimer: number | null = null;
let lastPlaybackPosition = 0;
let lastPlaybackProgressAt = 0;
let lastAudibleVolume = Math.max(0.1, Math.min(1, Number(localStorage.getItem('misty_rain_player_volume')) || 1));
let audioOutputNeedsReset = true;
let pageWasHidden = false;
let backgroundResumeAt = 0;
let mobileQualityManuallySelected = false;
let introSkipped = false;
let episodeCompletionHandled = false;
const videoInstanceKey = ref(0);
const isMobilePlaybackDevice = typeof window !== 'undefined'
  && (window.matchMedia('(max-width: 820px)').matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));

const soundEffectOptions: SoundEffectOption[] = [
  { value: 'original', label: '原声', hint: '不做处理' },
  { value: 'dialogue', label: '对白增强', hint: '突出人声' },
  { value: 'cinema', label: '影院', hint: '增强低频与细节' },
  { value: 'night', label: '夜间', hint: '平衡音量起伏' }
];

const episodes = computed(() => session.value?.episodes || []);
const currentEpisode = computed(() => episodes.value[currentEpisodeIndex.value] || null);
const episodeGroupSize = 50;
const episodeGroups = computed(() => {
  const groups: Array<{ start: number; end: number; label: string }> = [];
  for (let start = 0; start < episodes.value.length; start += episodeGroupSize) {
    const end = Math.min(episodes.value.length, start + episodeGroupSize);
    const first = episodes.value[start];
    const last = episodes.value[end - 1];
    const firstNumber = first?.episodeNumber || start + 1;
    const lastNumber = last?.episodeNumber || end;
    groups.push({
      start,
      end,
      label: `${Math.min(firstNumber, lastNumber)}-${Math.max(firstNumber, lastNumber)}`
    });
  }
  return groups;
});
const latestEpisodeIndex = computed(() => {
  if (!episodes.value.length) return -1;
  let latestIndex = 0;
  let latestNumber = Number(episodes.value[0]?.episodeNumber) || 0;
  episodes.value.forEach((episode, index) => {
    const episodeNumber = Number(episode.episodeNumber) || 0;
    if (episodeNumber > latestNumber) {
      latestNumber = episodeNumber;
      latestIndex = index;
    }
  });
  return latestIndex;
});
const latestEpisodeUpdateLabel = computed(() => {
  const latestEpisode = episodes.value[latestEpisodeIndex.value];
  const timestamp = Date.parse(latestEpisode?.updatedAt || '');
  if (!Number.isFinite(timestamp)) return '';
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp));
  return `最近更新 ${formatted}`;
});
const visibleEpisodeEntries = computed(() => {
  const group = episodeGroups.value[episodeGroupIndex.value] || episodeGroups.value[0];
  if (!group) return [];
  return episodes.value.slice(group.start, group.end).map((episode, offset) => ({
    episode,
    index: group.start + offset,
    isLatest: group.start + offset === latestEpisodeIndex.value
  }));
});
const sources = computed(() => playback.value?.sources || []);
const selectedSource = computed(() => sources.value.find(source => source.id === selectedSourceId.value) || sources.value[0]);
const audioTracks = computed(() => detectedAudioTracks.value.length
  ? detectedAudioTracks.value
  : (playback.value?.audioTracks || []));
const audioSwitchable = computed(() => detectedAudioTracks.value.length > 1 || getNativeAudioTrackCount() > 1);
const selectedSoundEffect = computed(() => soundEffectOptions.find(option => option.value === soundEffectMode.value));
const episodeStatus = computed(() => {
  const episode = currentEpisode.value;
  if (!episode) return episodes.value.length ? `共 ${episodes.value.length} 集` : '';
  const currentLabel = episode.episodeNumber > 0 ? `第 ${episode.episodeNumber} 集` : episode.episodeTitle;
  return `${currentLabel} / 共 ${episodes.value.length} 集`;
});
const loadingTitle = computed(() => phase.value === 'resolving'
  ? '正在载入片库'
  : `正在准备${currentEpisode.value?.episodeTitle || '当前剧集'}`);
const loadingHint = computed(() => phase.value === 'resolving'
  ? '正在整理剧集与可用画质'
  : '正在获取最佳画质，请稍候');
const playActionLabel = computed(() => {
  const episode = currentEpisode.value;
  if (!episode) return '开始播放';
  return episode.episodeNumber > 0
    ? `播放第 ${episode.episodeNumber} 集`
    : `播放${episode.episodeTitle}`;
});
const playbackAutomationSummary = computed(() => {
  const enabled = [playbackAutomation.value.skipIntroOutro, playbackAutomation.value.autoNext]
    .filter(Boolean).length;
  return enabled ? `已开启 ${enabled} 项` : '均已关闭';
});

const sourceDetail = (source: PlaybackSource) => {
  const parts = [source.label];
  if (source.width && source.height) parts.push(`${source.width}×${source.height}`);
  if (source.fps) parts.push(`${Math.round(source.fps)} FPS`);
  if (source.codec) parts.push(source.codec.toUpperCase());
  return parts.join(' · ');
};

const resetSoundEffectGraph = (replaceVideo = false) => {
  for (const node of [mediaAudioSource, dryGain, wetGain, lowShelf, presenceFilter, highShelf, dynamicsCompressor]) {
    try {
      node?.disconnect();
    } catch {
      // Safari 在页面休眠后可能已经断开节点。
    }
  }
  audioContext?.close().catch(() => {});
  audioContext = null;
  mediaAudioSource = null;
  dryGain = null;
  wetGain = null;
  lowShelf = null;
  presenceFilter = null;
  highShelf = null;
  dynamicsCompressor = null;
  if (replaceVideo) videoInstanceKey.value += 1;
};

const destroyPlaybackEngine = () => {
  hlsRef.value?.destroy();
  hlsRef.value = null;
  detectedAudioTracks.value = [];
  selectedAudioIndex.value = -1;
};

const clearBufferingIndicator = (clearStartingState = true) => {
  if (bufferingTimer !== null) {
    window.clearTimeout(bufferingTimer);
    bufferingTimer = null;
  }
  if (clearStartingState && playbackHasStarted.value) playbackStarting.value = false;
};

const releaseSystemMediaSession = () => {
  if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
  try {
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.metadata = null;
  } catch {
    // iOS 终止 WebClip 时可能已先回收系统媒体会话。
  }
};

const stopVideo = (resetAudioOutput = false) => {
  if (resetAudioOutput) audioOutputNeedsReset = true;
  if (autoNextTimer !== null) {
    window.clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
  clearBufferingIndicator(false);
  lastPlaybackPosition = 0;
  lastPlaybackProgressAt = 0;
  sourceAttachSequence += 1;
  playAttemptSequence += 1;
  playbackStarting.value = false;
  manualPlayRequired.value = false;
  playbackHasStarted.value = false;
  destroyPlaybackEngine();
  releaseSystemMediaSession();
  if (!videoRef.value) return;
  videoRef.value.pause();
  videoRef.value.removeAttribute('src');
  videoRef.value.load();
};

const getNativeAudioTrackCount = () => {
  const tracks = (videoRef.value as (HTMLVideoElement & { audioTracks?: { length: number } }) | null)?.audioTracks;
  return tracks?.length || 0;
};

const announce = (message: string) => {
  statusMessage.value = message;
};

const setAudioParam = (parameter: AudioParam | undefined, value: number, timeConstant = 0.018) => {
  if (!parameter || !audioContext) return;
  parameter.cancelScheduledValues(audioContext.currentTime);
  parameter.setTargetAtTime(value, audioContext.currentTime, timeConstant);
};

const configureSoundEffect = (mode: SoundEffectMode) => {
  if (!audioContext || !dryGain || !wetGain || !lowShelf || !presenceFilter || !highShelf || !dynamicsCompressor) return;

  const settings: Record<Exclude<SoundEffectMode, 'original'>, {
    low: number;
    presence: number;
    high: number;
    threshold: number;
    knee: number;
    ratio: number;
    attack: number;
    release: number;
    output: number;
  }> = {
    dialogue: { low: -2, presence: 5, high: 1, threshold: -30, knee: 16, ratio: 3.5, attack: 0.008, release: 0.22, output: 1.05 },
    cinema: { low: 3.5, presence: 1.5, high: 2.2, threshold: -24, knee: 20, ratio: 2.2, attack: 0.012, release: 0.3, output: 0.94 },
    night: { low: -3.5, presence: 3.2, high: -1.5, threshold: -38, knee: 12, ratio: 9, attack: 0.004, release: 0.42, output: 1.08 }
  };

  if (mode === 'original') {
    setAudioParam(dryGain.gain, 1);
    setAudioParam(wetGain.gain, 0);
    return;
  }

  const effect = settings[mode];
  setAudioParam(lowShelf.gain, effect.low);
  setAudioParam(presenceFilter.gain, effect.presence);
  setAudioParam(highShelf.gain, effect.high);
  setAudioParam(dynamicsCompressor.threshold, effect.threshold);
  setAudioParam(dynamicsCompressor.knee, effect.knee);
  setAudioParam(dynamicsCompressor.ratio, effect.ratio);
  setAudioParam(dynamicsCompressor.attack, effect.attack);
  setAudioParam(dynamicsCompressor.release, effect.release);
  setAudioParam(dryGain.gain, 0);
  setAudioParam(wetGain.gain, effect.output);
};

const ensureSoundEffectGraph = async () => {
  const video = videoRef.value;
  if (!video || !soundEffectAvailable.value) return false;
  try {
    if (!audioContext) {
      const AudioContextConstructor = window.AudioContext
        || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return false;
      audioContext = new AudioContextConstructor({ latencyHint: 'interactive' });
      mediaAudioSource = audioContext.createMediaElementSource(video);
      dryGain = audioContext.createGain();
      wetGain = audioContext.createGain();
      lowShelf = audioContext.createBiquadFilter();
      presenceFilter = audioContext.createBiquadFilter();
      highShelf = audioContext.createBiquadFilter();
      dynamicsCompressor = audioContext.createDynamicsCompressor();

      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 140;
      presenceFilter.type = 'peaking';
      presenceFilter.frequency.value = 2800;
      presenceFilter.Q.value = 0.85;
      highShelf.type = 'highshelf';
      highShelf.frequency.value = 6500;
      dryGain.gain.value = 1;
      wetGain.gain.value = 0;

      mediaAudioSource.connect(dryGain).connect(audioContext.destination);
      mediaAudioSource
        .connect(lowShelf)
        .connect(presenceFilter)
        .connect(highShelf)
        .connect(dynamicsCompressor)
        .connect(wetGain)
        .connect(audioContext.destination);
    }
    // iOS WebClip 从后台恢复时可能返回 Safari 私有的 interrupted 状态。
    // 只判断 suspended 会让原声通道继续连在无输出的 AudioContext 上。
    if (audioContext.state !== 'running') await audioContext.resume();
    configureSoundEffect(soundEffectMode.value);
    return true;
  } catch {
    soundEffectAvailable.value = false;
    soundEffectMode.value = 'original';
    localStorage.setItem('misty_rain_sound_effect', 'original');
    return false;
  }
};

const selectSoundEffect = async (mode: SoundEffectMode) => {
  if (mode === soundEffectMode.value) return;
  soundEffectMode.value = mode;
  localStorage.setItem('misty_rain_sound_effect', mode);
  if (mode === 'original' && audioContext) {
    const video = videoRef.value;
    const resumeAt = video?.currentTime || 0;
    const shouldPlay = Boolean(video && !video.paused);
    const source = selectedSource.value;
    resetSoundEffectGraph(true);
    await nextTick();
    if (source) await attachSource(source, resumeAt, shouldPlay);
  } else if (!(await ensureSoundEffectGraph())) {
    toast.show('当前浏览器无法启用音效处理，已恢复原声', '!', 3000);
    return;
  }
  announce(`已切换到${soundEffectOptions.find(option => option.value === mode)?.label || '原声'}音效`);
};

const restoreVideoAudioOutput = () => {
  const video = videoRef.value;
  if (!video || !audioOutputNeedsReset) return;
  video.defaultMuted = false;
  video.muted = false;
  video.volume = lastAudibleVolume;
  audioOutputNeedsReset = false;
};

const resumeSoundEffect = () => {
  restoreVideoAudioOutput();
  // 即使已切回“原声”，旧媒体节点仍经过 AudioContext，也必须恢复它。
  if (audioContext || soundEffectMode.value !== 'original') void ensureSoundEffectGraph();
};

const handleVolumeChange = () => {
  const video = videoRef.value;
  if (!video || video.muted || video.volume <= 0) return;
  lastAudibleVolume = video.volume;
  localStorage.setItem('misty_rain_player_volume', String(video.volume));
};

const handleServiceError = (error: unknown) => {
  stopVideo();
  const serviceError = error instanceof QuarkServiceError ? error : null;
  errorMessage.value = error instanceof Error ? error.message : '播放器加载失败';
  if (serviceError?.code === 'QUARK_AUTH_REQUIRED' || serviceError?.status === 401) {
    phase.value = 'auth-required';
    announce('播放 Cookie 已失效，可手动前往“我的”更新');
  } else {
    phase.value = 'error';
    announce(errorMessage.value);
  }
};

const attemptPlayback = async (attachSequence = sourceAttachSequence, userInitiated = false) => {
  const video = videoRef.value;
  if (!video || attachSequence !== sourceAttachSequence) return;
  restoreVideoAudioOutput();
  const attemptSequence = ++playAttemptSequence;
  playbackStarting.value = true;
  manualPlayRequired.value = false;
  try {
    await video.play();
  } catch (error) {
    if (attemptSequence !== playAttemptSequence || attachSequence !== sourceAttachSequence) return;
    playbackStarting.value = false;
    manualPlayRequired.value = true;
    const blockedByBrowser = error instanceof DOMException && error.name === 'NotAllowedError';
    announce(blockedByBrowser
      ? `浏览器已阻止自动播放，轻触按钮播放${currentEpisode.value?.episodeTitle || '当前剧集'}`
      : userInitiated
        ? '暂时无法开始播放，请重试'
        : `轻触按钮播放${currentEpisode.value?.episodeTitle || '当前剧集'}`);
  }
};

const seekAndMaybePlay = (
  time: number,
  shouldPlay: boolean,
  attachSequence: number,
  applyIntroSkip = false
) => {
  const video = videoRef.value;
  if (!video) return;
  const apply = () => {
    if (attachSequence !== sourceAttachSequence) return;
    let targetTime = Number.isFinite(time) ? Math.max(0, time) : 0;
    const automation = playbackAutomation.value;
    const canSkipIntro = applyIntroSkip
      && automation.skipIntroOutro
      && Number.isFinite(video.duration)
      && video.duration > automation.introSeconds + automation.outroSeconds + 60;
    if (canSkipIntro) targetTime = Math.max(targetTime, automation.introSeconds);
    introSkipped = canSkipIntro || targetTime >= automation.introSeconds;
    if (targetTime > 0 && video.duration > targetTime) video.currentTime = targetTime;
    if (shouldPlay) void attemptPlayback(attachSequence);
    else {
      playbackStarting.value = false;
      manualPlayRequired.value = true;
    }
  };
  if (video.readyState >= 1) apply();
  else video.addEventListener('loadedmetadata', apply, { once: true });
};

const attachSource = async (
  source: PlaybackSource,
  resumeAt = 0,
  shouldPlay = false,
  applyIntroSkip = false
) => {
  await nextTick();
  const video = videoRef.value;
  if (!video) return;
  const attachSequence = ++sourceAttachSequence;
  playAttemptSequence += 1;
  destroyPlaybackEngine();
  video.pause();
  video.removeAttribute('src');
  video.load();
  playbackStarting.value = shouldPlay;
  manualPlayRequired.value = false;
  playbackHasStarted.value = false;
  clearBufferingIndicator(false);
  lastPlaybackPosition = resumeAt;
  lastPlaybackProgressAt = Date.now();

  // Safari/iOS 可直接交给原生视频管线；仅在原生不支持 HLS 的浏览器
  // 懒加载 hls.js，避免 WebClip 不必要地下载并初始化解码器。
  if (source.isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
    const { default: HlsRuntime } = await import('hls.js');
    if (attachSequence !== sourceAttachSequence || video !== videoRef.value) return;
    if (HlsRuntime.isSupported()) {
      const hls = new HlsRuntime({
        enableWorker: true,
        lowLatencyMode: false,
        capLevelToPlayerSize: true,
        backBufferLength: 30,
        maxBufferLength: 20,
        maxMaxBufferLength: 40
      });
      hlsRef.value = hls;
      hls.on(HlsRuntime.Events.MEDIA_ATTACHED, () => hls.loadSource(source.url));
      hls.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
        if (attachSequence !== sourceAttachSequence) return;
        detectedAudioTracks.value = hls.audioTracks.map((track, index) => ({
          id: String(index),
          label: track.name || track.lang || `音轨 ${index + 1}`,
          language: track.lang || '',
          codec: '',
          channels: ''
        }));
        if (detectedAudioTracks.value.length) selectedAudioIndex.value = Math.max(0, hls.audioTrack);
        seekAndMaybePlay(resumeAt, shouldPlay, attachSequence, applyIntroSkip);
      });
      hls.on(HlsRuntime.Events.AUDIO_TRACKS_UPDATED, () => {
        detectedAudioTracks.value = hls.audioTracks.map((track, index) => ({
          id: String(index),
          label: track.name || track.lang || `音轨 ${index + 1}`,
          language: track.lang || '',
          codec: '',
          channels: ''
        }));
      });
      hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
        if (!data.fatal || attachSequence !== sourceAttachSequence) return;
        if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          return;
        }
        if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        errorMessage.value = '视频流中断，请重新加载当前剧集';
        phase.value = 'error';
        announce(errorMessage.value);
      });
      hls.attachMedia(video);
      return;
    }
  }

  video.src = source.url;
  video.load();
  seekAndMaybePlay(resumeAt, shouldPlay, attachSequence, applyIntroSkip);
};

const chooseInitialSource = (available: PlaybackSource[]) => {
  const preferred = localStorage.getItem('misty_rain_player_quality');
  const mobileEfficientSources = available.filter(source => {
    const width = Number(source.width) || 0;
    const height = Number(source.height) || 0;
    return width || height
      ? width <= 1920 && height <= 1080
      : !['2k', '4k', 'source', 'original'].includes(source.resolution);
  });
  const candidates = isMobilePlaybackDevice && mobileEfficientSources.length ? mobileEfficientSources : available;
  const preferredSource = (!isMobilePlaybackDevice || mobileQualityManuallySelected)
    ? candidates.find(source => source.resolution === preferred)
    : null;
  return preferredSource
    || (isMobilePlaybackDevice
      ? candidates.find(source => source.resolution === 'super' || Number(source.height) === 1080)
      : null)
    || candidates.find(source => source.height === 1080 || source.resolution === 'super')
    || (isMobilePlaybackDevice ? candidates.find(source => source.resolution === 'high') : null)
    || candidates[0]
    || available[0];
};

const progressPayload = (completed = false): PlaybackHistoryUpdate | null => {
  const media = props.media;
  const episode = currentEpisode.value;
  const video = videoRef.value;
  if (!media || !episode || !video) return null;
  const duration = Number.isFinite(video.duration) ? video.duration : episode.duration || 0;
  const isCompleted = completed || video.ended || episodeCompletionHandled;
  const position = isCompleted ? duration : (Number.isFinite(video.currentTime) ? video.currentTime : 0);
  if (!duration || (!isCompleted && position < 3)) return null;
  return {
    media,
    episodeFid: episode.fid,
    episodeNumber: episode.episodeNumber,
    episodeTitle: episode.episodeTitle || episode.fileName,
    position,
    duration,
    completed: isCompleted
  };
};

const persistProgress = async (force = false, completed = false, keepalive = false) => {
  const payload = progressPayload(completed);
  if (!payload) return null;
  const now = Date.now();
  if (!force && (now - lastProgressSavedAt < 10000 || Math.abs(payload.position - lastSavedPosition) < 8)) return null;
  if (savingProgress && !force) return savingProgress;
  lastProgressSavedAt = now;
  lastSavedPosition = payload.position;
  const previousSave = savingProgress;
  let request: Promise<PlaybackHistoryEntry | null>;
  const save = () => PlaybackHistoryService.save(payload, keepalive)
    .then(entry => {
      emit('history-updated', entry);
      return entry;
    })
    .catch(error => {
      console.warn('[playback-history] 保存失败:', error);
      return null;
    });
  request = (previousSave ? previousSave.then(save) : save())
    .finally(() => {
      if (savingProgress === request) savingProgress = null;
    });
  savingProgress = request;
  return request;
};

const completeCurrentEpisode = (skippedOutro = false) => {
  if (episodeCompletionHandled) return;
  episodeCompletionHandled = true;
  playbackStarting.value = false;
  void persistProgress(true, true);

  const nextIndex = nextEpisodeIndex();
  const nextEpisode = episodes.value[nextIndex];
  if (playbackAutomation.value.autoNext && nextIndex >= 0 && nextEpisode) {
    announce(`${skippedOutro ? '已跳过片尾，' : ''}即将播放${nextEpisode.episodeTitle}`);
    autoNextTimer = window.setTimeout(() => {
      autoNextTimer = null;
      if (props.isOpen) void prepareEpisode(nextIndex);
    }, 900);
    return;
  }

  if (skippedOutro) {
    const video = videoRef.value;
    if (video && Number.isFinite(video.duration)) {
      video.pause();
      video.currentTime = Math.max(0, video.duration - 0.05);
    }
    announce('已跳过片尾，本集播放完毕');
  }
};

const handleTimeUpdate = () => {
  void persistProgress();
  const video = videoRef.value;
  if (video && Number.isFinite(video.currentTime)) {
    if (video.currentTime > lastPlaybackPosition + 0.02) {
      lastPlaybackPosition = video.currentTime;
      lastPlaybackProgressAt = Date.now();
      clearBufferingIndicator();
    } else if (video.currentTime < lastPlaybackPosition - 0.25) {
      lastPlaybackPosition = video.currentTime;
      lastPlaybackProgressAt = Date.now();
    }
  }
  const automation = playbackAutomation.value;
  if (!automation.skipIntroOutro
    || phase.value !== 'ready'
    || !playbackHasStarted.value
    || !video
    || video.paused
    || !Number.isFinite(video.duration)
    || video.duration < automation.introSeconds + automation.outroSeconds + 60) return;

  if (!introSkipped && video.currentTime >= 0 && video.currentTime < automation.introSeconds) {
    introSkipped = true;
    video.currentTime = automation.introSeconds;
    announce(`已跳过 ${automation.introSeconds} 秒片头`);
    return;
  }

  const remaining = video.duration - video.currentTime;
  if (!episodeCompletionHandled
    && video.currentTime > automation.introSeconds + 10
    && remaining > 0
    && remaining <= automation.outroSeconds) {
    completeCurrentEpisode(true);
  }
};

const handlePause = () => {
  const video = videoRef.value;
  playbackStarting.value = false;
  if (phase.value !== 'ready' || video?.ended) return;
  void persistProgress(true);
};

const nextEpisodeIndex = () => {
  const episode = currentEpisode.value;
  if (!episode) return -1;
  if (episode.episodeNumber > 0) {
    const numberedIndex = episodes.value.findIndex(item => item.episodeNumber === episode.episodeNumber + 1);
    if (numberedIndex >= 0) return numberedIndex;
  }
  return currentEpisodeIndex.value > 0 ? currentEpisodeIndex.value - 1 : -1;
};

const handleEnded = () => {
  completeCurrentEpisode(false);
};

const handlePlaying = () => {
  const video = videoRef.value;
  if (episodeCompletionHandled && video && video.currentTime < 1) {
    episodeCompletionHandled = false;
    introSkipped = false;
  }
  clearBufferingIndicator(false);
  playbackStarting.value = false;
  manualPlayRequired.value = false;
  playbackHasStarted.value = true;
  lastPlaybackPosition = video?.currentTime || 0;
  lastPlaybackProgressAt = Date.now();
  announce(`正在播放${currentEpisode.value?.episodeTitle || '当前剧集'}`);
};

const handleVisibilityChange = () => {
  if (!props.isOpen) return;
  const video = videoRef.value;
  if (document.visibilityState === 'hidden') {
    if (video && !video.paused) {
      backgroundResumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      video.pause();
      manualPlayRequired.value = true;
      void persistProgress(true, false, true);
    }
    hlsRef.value?.stopLoad();
    audioContext?.suspend().catch(() => {});
    return;
  }
  if (!pageWasHidden) {
    hlsRef.value?.startLoad(-1);
    audioOutputNeedsReset = true;
    if (phase.value === 'ready') manualPlayRequired.value = true;
  }
};

const handlePageHide = () => {
  if (!props.isOpen) return;
  const video = videoRef.value;
  backgroundResumeAt = video && Number.isFinite(video.currentTime) ? video.currentTime : backgroundResumeAt;
  void persistProgress(true, false, true);
  pageWasHidden = true;
  stopVideo(true);
  resetSoundEffectGraph(true);
};

const handlePageShow = async () => {
  if (!pageWasHidden) return;
  pageWasHidden = false;
  if (!props.isOpen || phase.value !== 'ready' || !selectedSource.value) return;
  await nextTick();
  await attachSource(selectedSource.value, backgroundResumeAt, false);
  manualPlayRequired.value = true;
  announce('已恢复当前剧集，轻触播放继续');
};

const handleWaiting = () => {
  const video = videoRef.value;
  if (!playbackHasStarted.value || !video || video.paused || video.ended) return;
  clearBufferingIndicator(false);
  const observedAt = Date.now();
  bufferingTimer = window.setTimeout(() => {
    bufferingTimer = null;
    const activeVideo = videoRef.value;
    if (!activeVideo
      || activeVideo.paused
      || activeVideo.ended
      || activeVideo.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      || lastPlaybackProgressAt > observedAt) return;
    playbackStarting.value = true;
  }, 650);
};

const handlePlaybackAvailable = () => {
  lastPlaybackProgressAt = Date.now();
  clearBufferingIndicator();
};

const handleVideoError = () => {
  if (phase.value !== 'ready') return;
  playbackStarting.value = false;
  manualPlayRequired.value = false;
  errorMessage.value = '当前视频无法解码或播放地址已失效';
  phase.value = 'error';
  announce(errorMessage.value);
};

const startPlaybackFromPrompt = () => {
  void attemptPlayback(sourceAttachSequence, true);
};

const prepareEpisode = async (index: number, resumeAt = 0) => {
  const activeSession = session.value;
  const episode = activeSession?.episodes[index];
  if (!activeSession || !episode) return;
  if (currentEpisode.value && currentEpisodeIndex.value !== index && !episodeCompletionHandled) {
    await persistProgress(true);
  }
  const sequence = ++requestSequence;
  introSkipped = false;
  episodeCompletionHandled = false;
  currentEpisodeIndex.value = index;
  episodeGroupIndex.value = Math.floor(index / episodeGroupSize);
  phase.value = 'preparing';
  playback.value = null;
  selectedSourceId.value = '';
  errorMessage.value = '';
  stopVideo();
  announce(`正在准备${episode.episodeTitle}`);

  try {
    const result = await QuarkStreamService.prepareEpisode(activeSession.sessionId, episode.fid);
    if (sequence !== requestSequence || !props.isOpen) return;
    playback.value = result;
    const initialSource = chooseInitialSource(result.sources);
    if (!initialSource) throw new Error('当前剧集没有可播放画质');
    selectedSourceId.value = initialSource.id;
    phase.value = 'ready';
    announce(`${episode.episodeTitle}已就绪，可用画质 ${result.sources.map(item => item.label).join('、')}`);
    if (result.transferred) toast.show(`已按需转存《${episode.fileName}》到烟雨影视目录`, '✓', 3200);
    await attachSource(initialSource, resumeAt, true, true);
    if (resumeAt > 3) announce(`已续播${episode.episodeTitle} ${Math.floor(resumeAt / 60)} 分钟处`);
  } catch (error) {
    if (sequence === requestSequence) handleServiceError(error);
  }
};

const toggleSkipIntroOutro = () => {
  playbackAutomation.value.skipIntroOutro = !playbackAutomation.value.skipIntroOutro;
  const video = videoRef.value;
  const automation = playbackAutomation.value;
  introSkipped = (video?.currentTime || 0) >= automation.introSeconds;
  if (automation.skipIntroOutro
    && video
    && !introSkipped
    && Number.isFinite(video.duration)
    && video.duration > automation.introSeconds + automation.outroSeconds + 60) {
    video.currentTime = automation.introSeconds;
    introSkipped = true;
  }
  announce(playbackAutomation.value.skipIntroOutro
    ? `已开启跳过片头片尾，片头与片尾各 ${playbackAutomation.value.introSeconds} 秒`
    : '已关闭跳过片头片尾');
};

const toggleAutoNext = () => {
  playbackAutomation.value.autoNext = !playbackAutomation.value.autoNext;
  if (!playbackAutomation.value.autoNext && autoNextTimer !== null) {
    window.clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
  announce(playbackAutomation.value.autoNext ? '已开启连续播放' : '已关闭连续播放');
};

const loadSession = async () => {
  const media = props.media;
  if (!props.isOpen || !media) return;
  const sequence = ++requestSequence;
  phase.value = 'resolving';
  stopVideo();
  session.value = null;
  playback.value = null;
  currentEpisodeIndex.value = 0;
  episodeGroupIndex.value = 0;
  settingsExpanded.value = false;
  mobileQualityManuallySelected = false;
  errorMessage.value = '';
  announce(`正在读取《${media.title}》的云端目录`);

  const shareUrl = media.quarkShareUrl || '';
  if (!media.quarkFid && !/pan\.quark\.cn\/s\/[a-zA-Z0-9]+/i.test(shareUrl)) {
    handleServiceError(new QuarkServiceError('该卡片还没有有效的播放资源，请先换源', 'INVALID_QUARK_SHARE', 400));
    return;
  }

  try {
    const result = await QuarkStreamService.createPlaybackSession({
      quarkFid: media.quarkFid,
      shareUrl,
      title: media.title,
      passcode: media.quarkPasscode
    });
    if (sequence !== requestSequence || !props.isOpen) return;
    session.value = result;
    announce(`已读取 ${result.episodes.length} 个视频文件`);
    const history = props.historyEntry;
    const matchedHistoryIndex = history
      ? result.episodes.findIndex(episode => episode.fid === history.episodeFid)
      : -1;
    const resumeIndex = Math.max(0, matchedHistoryIndex);
    const resumeAt = history && matchedHistoryIndex >= 0 && !history.completed ? history.position : 0;
    await prepareEpisode(resumeIndex, resumeAt);
  } catch (error) {
    if (sequence === requestSequence) handleServiceError(error);
  }
};

const changeQuality = async (source: PlaybackSource) => {
  const video = videoRef.value;
  const resumeAt = video?.currentTime || 0;
  const shouldPlay = Boolean(video && !video.paused);
  selectedSourceId.value = source.id;
  mobileQualityManuallySelected = true;
  localStorage.setItem('misty_rain_player_quality', source.resolution);
  announce(`已切换到${source.label}`);
  await attachSource(source, resumeAt, shouldPlay);
};

const selectAudioTrack = (index: number) => {
  const hls = hlsRef.value;
  if (hls && index >= 0 && index < hls.audioTracks.length) {
    hls.audioTrack = index;
    selectedAudioIndex.value = index;
    announce(`已切换到${audioTracks.value[index]?.label || `音轨 ${index + 1}`}`);
    return;
  }

  const nativeTracks = (videoRef.value as (HTMLVideoElement & {
    audioTracks?: ArrayLike<{ enabled: boolean }>;
  }) | null)?.audioTracks;
  if (nativeTracks && index < nativeTracks.length) {
    for (let trackIndex = 0; trackIndex < nativeTracks.length; trackIndex += 1) {
      nativeTracks[trackIndex].enabled = trackIndex === index;
    }
    selectedAudioIndex.value = index;
  }
};

const selectEpisodeGroup = (index: number) => {
  episodeGroupIndex.value = index;
  nextTick(() => episodePanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
};

const scrollToEpisodes = async () => {
  episodeGroupIndex.value = Math.floor(currentEpisodeIndex.value / episodeGroupSize);
  settingsExpanded.value = false;
  await nextTick();
  episodePanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const retry = () => {
  if (session.value && currentEpisode.value) prepareEpisode(currentEpisodeIndex.value);
  else loadSession();
};

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
};

const handleNativeVideoFullscreen = () => {
  const orientation = screen.orientation as LockableOrientation | undefined;
  orientation?.lock?.('landscape').catch(() => {});
};

type IOSFullscreenVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
};

const requestNativeVideoFullscreen = async () => {
  const video = videoRef.value as IOSFullscreenVideoElement | null;
  if (!video) return;
  try {
    if (typeof video.webkitEnterFullscreen === 'function' && video.webkitSupportsFullscreen !== false) {
      video.webkitEnterFullscreen();
      return;
    }
    if (video.requestFullscreen) await video.requestFullscreen();
    handleNativeVideoFullscreen();
  } catch {
    announce('当前系统未允许进入全屏，请再轻触一次');
  }
};

const close = () => {
  void persistProgress(true, false, true);
  phase.value = 'idle';
  requestSequence += 1;
  stopVideo(true);
  resetSoundEffectGraph(true);
  emit('close');
};

const handleKeydown = (event: KeyboardEvent) => {
  if (!props.isOpen) return;
  if (event.key === 'Escape') close();
};

watch(
  [() => props.isOpen, () => props.media?.id],
  ([isOpen]) => {
    if (isOpen) loadSession();
    else {
      phase.value = 'idle';
      requestSequence += 1;
      stopVideo();
    }
  },
  { immediate: true }
);

watch(() => props.isOpen, isOpen => {
  if (isOpen) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeydown);
  } else {
    document.body.style.overflow = previousBodyOverflow;
    window.removeEventListener('keydown', handleKeydown);
  }
});

watch(playbackAutomation, value => {
  localStorage.setItem(playbackAutomationStorageKey, JSON.stringify(value));
}, { deep: true });

onBeforeUnmount(() => {
  void persistProgress(true, false, true);
  phase.value = 'idle';
  stopVideo(true);
  resetSoundEffectGraph();
  document.body.style.overflow = previousBodyOverflow;
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('pageshow', handlePageShow);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

onMounted(() => {
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

defineExpose({ retry });
</script>

<template>
  <div
    class="player-backdrop"
    :class="{ active: isOpen }"
    role="dialog"
    aria-modal="true"
    :aria-label="media ? `播放《${media.title}》` : '视频播放器'"
    @click.self="close"
  >
    <section v-if="media" class="player-window">
      <header class="player-header">
        <div class="title-block">
          <span class="source-badge">云端高清</span>
          <div class="title-copy">
            <h2>{{ media.title }}</h2>
            <p v-if="episodeStatus">{{ episodeStatus }}</p>
          </div>
        </div>

        <div class="header-actions">
          <button class="text-action" type="button" @click="emit('re-search', media)">
            换源
          </button>
          <button class="icon-button" type="button" aria-label="关闭播放器" @click="close">
            <X aria-hidden="true" />
          </button>
        </div>
      </header>

      <div class="player-layout" :class="{ 'single-column': !episodes.length }">
        <main class="video-column">
          <div class="video-stage">
            <video
              :key="videoInstanceKey"
              ref="videoRef"
              class="video-element"
              controls
              controlslist="nodownload noremoteplayback"
              playsinline
              :preload="isIOSPlaybackDevice ? 'auto' : 'metadata'"
              crossorigin="anonymous"
              :poster="isMobilePlaybackDevice ? undefined : media.poster"
              @play="resumeSoundEffect"
              @volumechange="handleVolumeChange"
              @playing="handlePlaying"
              @waiting="handleWaiting"
              @stalled="handleWaiting"
              @canplay="handlePlaybackAvailable"
              @seeked="handlePlaybackAvailable"
              @timeupdate="handleTimeUpdate"
              @pause="handlePause"
              @ended="handleEnded"
              @webkitbeginfullscreen="handleNativeVideoFullscreen"
              @error="handleVideoError"
            >
              <track
                v-for="subtitle in playback?.subtitles || []"
                :key="subtitle.id"
                kind="subtitles"
                :label="subtitle.label"
                :srclang="subtitle.language || 'zh'"
                :src="subtitle.url"
              />
            </video>

            <button
              v-if="isIOSPlaybackDevice && phase === 'ready'"
              type="button"
              class="ios-native-fullscreen-hitbox"
              aria-label="横屏全屏播放"
              @click="requestNativeVideoFullscreen"
            ></button>

            <div v-if="phase === 'resolving' || phase === 'preparing'" class="stage-state loading-state" role="status" aria-live="polite">
              <img v-if="media.poster && !isMobilePlaybackDevice" class="stage-poster" :src="media.poster" alt="" aria-hidden="true" />
              <div class="loading-content">
                <span class="loading-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
                <strong>{{ loadingTitle }}</strong>
                <p>{{ loadingHint }}</p>
              </div>
            </div>

            <div v-else-if="phase === 'error' || phase === 'auth-required'" class="stage-state error-state" role="alert">
              <CircleAlert class="state-icon" aria-hidden="true" />
              <strong>{{ phase === 'auth-required' ? '播放 Cookie 已失效' : '加载失败' }}</strong>
              <p>{{ errorMessage }}</p>
              <div class="state-actions">
                <button v-if="phase === 'auth-required'" type="button" class="primary-button" @click="emit('open-auth-settings')">
                  前往设置
                </button>
                <button type="button" class="secondary-button reload-button" @click="retry">
                  <RefreshCw aria-hidden="true" />
                  刷新重试
                </button>
              </div>
            </div>

            <div
              v-else-if="phase === 'ready' && manualPlayRequired"
              class="play-prompt"
            >
              <button
                type="button"
                class="stage-play-button"
                :aria-label="playActionLabel"
                @click="startPlaybackFromPrompt"
              >
                <span class="stage-play-icon" aria-hidden="true">
                  <Play />
                </span>
                <span class="stage-play-label">{{ playActionLabel }}</span>
                <small>轻触开始播放</small>
              </button>
            </div>

            <div
              v-else-if="phase === 'ready' && playbackStarting"
              class="playback-starting"
              role="status"
              aria-live="polite"
            >
              <span class="playback-starting-pill">
                <LoaderCircle aria-hidden="true" />
                {{ playbackHasStarted ? '正在缓冲' : '即将播放' }}
              </span>
            </div>
          </div>

          <div v-if="phase === 'ready' && sources.length" class="mobile-player-actions">
            <button
              type="button"
              :aria-expanded="settingsExpanded"
              aria-controls="playback-settings"
              @click="settingsExpanded = !settingsExpanded"
            >
              <SlidersHorizontal aria-hidden="true" />
              <span><strong>播放设置</strong><small>{{ selectedSource?.label || '自动' }} · {{ selectedSoundEffect?.label || '原声' }}</small></span>
            </button>
            <button type="button" @click="scrollToEpisodes">
              <ListVideo aria-hidden="true" />
              <span><strong>选集</strong><small>{{ episodeStatus }}</small></span>
            </button>
          </div>

          <div
            v-if="phase === 'ready' && sources.length"
            id="playback-settings"
            class="playback-settings"
            :class="{ 'mobile-expanded': settingsExpanded }"
          >
            <div class="setting-group">
              <div class="setting-heading">
                <span>画质</span>
                <small>{{ selectedSource ? sourceDetail(selectedSource) : '' }}</small>
              </div>
              <div class="option-scroll" role="radiogroup" aria-label="画质选择">
                <button
                  v-for="source in sources"
                  :key="source.id"
                  type="button"
                  class="option-chip"
                  :class="{ active: selectedSourceId === source.id }"
                  role="radio"
                  :aria-checked="selectedSourceId === source.id"
                  @click="changeQuality(source)"
                >
                  {{ source.label }}
                </button>
              </div>
            </div>

            <div v-if="audioTracks.length" class="setting-group">
              <div class="setting-heading">
                <span>音频</span>
                <small>{{ audioSwitchable ? '可切换音轨' : '当前流音频信息' }}</small>
              </div>
              <div class="option-scroll">
                <button
                  v-for="(track, index) in audioTracks"
                  :key="track.id"
                  type="button"
                  class="option-chip"
                  :class="{ active: selectedAudioIndex === index }"
                  :disabled="!audioSwitchable"
                  @click="selectAudioTrack(index)"
                >
                  {{ track.label }}{{ track.codec ? ` · ${track.codec}` : '' }}
                </button>
              </div>
            </div>

            <div v-if="soundEffectAvailable" class="setting-group">
              <div class="setting-heading">
                <span>音效</span>
                <small>{{ selectedSoundEffect?.hint || '设备端实时处理' }}</small>
              </div>
              <div class="option-scroll" role="radiogroup" aria-label="音效选择">
                <button
                  v-for="effect in soundEffectOptions"
                  :key="effect.value"
                  type="button"
                  class="option-chip"
                  :class="{ active: soundEffectMode === effect.value }"
                  role="radio"
                  :aria-checked="soundEffectMode === effect.value"
                  @click="selectSoundEffect(effect.value)"
                >
                  {{ effect.label }}
                </button>
              </div>
            </div>

            <div class="setting-group automation-setting-group">
              <div class="setting-heading">
                <span>播放偏好</span>
                <small>{{ playbackAutomationSummary }}</small>
              </div>
              <div class="automation-list">
                <div class="automation-row">
                  <span class="automation-copy">
                    <strong>跳过片头片尾</strong>
                    <small>片头 {{ playbackAutomation.introSeconds }} 秒 · 片尾 {{ playbackAutomation.outroSeconds }} 秒</small>
                  </span>
                  <button
                    type="button"
                    class="setting-switch"
                    role="switch"
                    :aria-checked="playbackAutomation.skipIntroOutro"
                    aria-label="跳过片头片尾"
                    @click="toggleSkipIntroOutro"
                  >
                    <span aria-hidden="true"></span>
                  </button>
                </div>

                <div class="automation-row">
                  <span class="automation-copy">
                    <strong>连续播放</strong>
                    <small>播放结束后自动进入下一集</small>
                  </span>
                  <button
                    type="button"
                    class="setting-switch"
                    role="switch"
                    :aria-checked="playbackAutomation.autoNext"
                    aria-label="连续播放下一集"
                    @click="toggleAutoNext"
                  >
                    <span aria-hidden="true"></span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside v-if="episodes.length" ref="episodePanelRef" class="episode-panel">
          <div class="episode-heading">
            <div class="episode-heading-title">
              <div class="episode-heading-main">
                <strong>剧集</strong>
                <span>{{ episodeStatus }}</span>
              </div>
              <small v-if="latestEpisodeUpdateLabel" class="episode-update-time">{{ latestEpisodeUpdateLabel }}</small>
            </div>
            <small>最新在前</small>
          </div>

          <div v-if="episodeGroups.length > 1" class="episode-ranges" role="tablist" aria-label="剧集范围">
            <button
              v-for="(group, groupIndex) in episodeGroups"
              :key="group.start"
              type="button"
              :class="{ active: episodeGroupIndex === groupIndex }"
              role="tab"
              :aria-selected="episodeGroupIndex === groupIndex"
              @click="selectEpisodeGroup(groupIndex)"
            >
              {{ group.label }}
            </button>
          </div>

          <div class="episode-list" role="listbox" aria-label="剧集列表">
            <button
              v-for="entry in visibleEpisodeEntries"
              :key="entry.episode.fid"
              v-memo="[entry.episode.fid, currentEpisodeIndex === entry.index]"
              type="button"
              class="episode-item"
              :class="{ active: currentEpisodeIndex === entry.index, latest: entry.isLatest }"
              role="option"
              :aria-selected="currentEpisodeIndex === entry.index"
              :aria-label="`${entry.episode.episodeTitle}，${[entry.episode.durationFormatted, entry.episode.sizeFormatted].filter(Boolean).join('，')}`"
              :title="entry.episode.fileName"
              @click="prepareEpisode(entry.index)"
            >
              <span class="episode-number">
                <span>{{ entry.episode.episodeNumber > 0 ? entry.episode.episodeNumber : '•' }}</span>
                <small v-if="entry.isLatest" class="episode-latest">新</small>
                <i v-if="currentEpisodeIndex === entry.index" class="episode-current-dot" aria-hidden="true"></i>
              </span>
              <span class="episode-copy">
                <strong>{{ entry.episode.episodeTitle }}</strong>
                <small>{{ [entry.episode.durationFormatted, entry.episode.sizeFormatted].filter(Boolean).join(' · ') }}</small>
              </span>
            </button>
          </div>
        </aside>
      </div>

      <p class="sr-status" aria-live="polite">{{ statusMessage }}</p>
    </section>
  </div>
</template>

<style scoped>
.player-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(0, 0, 0, 0.86);
  backdrop-filter: blur(22px);
  opacity: 0;
  visibility: hidden;
  transition: opacity 200ms ease, visibility 200ms ease;
}

.player-backdrop.active {
  opacity: 1;
  visibility: visible;
}

.player-backdrop:not(.active) {
  display: none;
}

.player-window {
  width: min(1180px, 100%);
  height: min(780px, calc(100dvh - 36px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #f8fafc;
  background: rgba(8, 10, 17, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 24px;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.72);
}

.player-header {
  min-height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  background: rgba(17, 20, 31, 0.92);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.title-block,
.header-actions,
.setting-heading,
.episode-heading > div {
  display: flex;
  align-items: center;
}

.title-block {
  gap: 12px;
  min-width: 0;
}

.source-badge {
  flex: 0 0 auto;
  padding: 4px 9px;
  color: #fed7aa;
  font-size: 0.72rem;
  font-weight: 700;
  border: 1px solid rgba(251, 146, 60, 0.36);
  border-radius: 999px;
  background: rgba(194, 65, 12, 0.2);
}

.source-badge.svip {
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.42);
  background: rgba(180, 83, 9, 0.22);
}

.title-copy {
  min-width: 0;
}

.title-copy h2 {
  overflow: hidden;
  color: #fff;
  font-size: 1rem;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-copy p {
  max-width: 560px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  flex: 0 0 auto;
  gap: 8px;
}

.text-action,
.icon-button,
.primary-button,
.secondary-button,
.option-chip,
.episode-item {
  cursor: pointer;
  touch-action: manipulation;
}

.text-action,
.icon-button {
  min-height: 44px;
  color: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
}

.text-action {
  padding: 0 15px;
  border-radius: 999px;
}

.icon-button {
  width: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
}

.icon-button svg,
.state-icon {
  width: 20px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 2;
}

.text-action:hover,
.icon-button:hover,
.text-action:focus-visible,
.icon-button:focus-visible {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.12);
}

.player-layout {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  flex: 1;
}

.player-layout.single-column {
  grid-template-columns: minmax(0, 1fr);
}

.video-column {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #000;
}

.video-stage {
  position: relative;
  min-height: 0;
  display: grid;
  place-items: center;
  flex: 1;
  overflow: hidden;
  background: #000;
}

.video-element {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.ios-native-fullscreen-hitbox {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 4;
  width: 58px;
  height: 50px;
  padding: 0;
  border: 0;
  border-radius: 0 0 18px;
  background: transparent;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.ios-native-fullscreen-hitbox:focus-visible {
  outline: 2px solid var(--liquid-accent);
  outline-offset: -3px;
}

.stage-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  background: radial-gradient(circle at center, rgba(34, 39, 57, 0.92), rgba(0, 0, 0, 0.95));
}

.loading-state {
  isolation: isolate;
  overflow: hidden;
  background: #030304;
}

.loading-state::before,
.loading-state::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.loading-state::before {
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(circle at 50% 42%, rgba(20, 23, 31, 0.42), rgba(0, 0, 0, 0.86) 66%),
    linear-gradient(180deg, rgba(0, 0, 0, 0.22), rgba(0, 0, 0, 0.82));
}

.loading-state::after {
  z-index: 0;
  top: 0;
  bottom: 0;
  width: 30%;
  opacity: 0.42;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.055), transparent);
  transform: skewX(-12deg) translateX(-180%);
  animation: stage-scan 2.8s ease-in-out infinite;
}

.stage-poster {
  position: absolute;
  inset: -9%;
  z-index: -2;
  width: 118%;
  height: 118%;
  object-fit: cover;
  opacity: 0.28;
  filter: blur(18px) saturate(0.72);
  transform: scale(1.04);
}

.loading-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.stage-state strong {
  font-size: 1rem;
}

.stage-state p {
  max-width: 420px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.82rem;
}

.play-prompt,
.playback-starting {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.play-prompt {
  background: radial-gradient(circle at center, rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.42));
}

.stage-play-button {
  min-width: 148px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 14px 18px;
  color: #fff;
  border: 0;
  border-radius: 24px;
  background: transparent;
  pointer-events: auto;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.stage-play-icon {
  width: 70px;
  height: 70px;
  display: grid;
  place-items: center;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.36);
  border-radius: 50%;
  background: rgba(20, 20, 24, 0.54);
  box-shadow:
    0 14px 38px rgba(0, 0, 0, 0.36),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(18px) saturate(1.35);
  -webkit-backdrop-filter: blur(18px) saturate(1.35);
  transition: border-color 180ms ease, background 180ms ease, transform 180ms ease;
}

.stage-play-icon svg {
  width: 29px;
  height: 29px;
  margin-left: 3px;
  fill: currentColor;
  stroke-width: 1.7;
}

.stage-play-label {
  font-size: 0.92rem;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.72);
}

.stage-play-button small {
  color: rgba(255, 255, 255, 0.64);
  font-size: 0.7rem;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.76);
}

.stage-play-button:hover .stage-play-icon,
.stage-play-button:focus-visible .stage-play-icon {
  border-color: rgba(255, 255, 255, 0.58);
  background: rgb(var(--accent-rgb) / 0.86);
}

.stage-play-button:active .stage-play-icon {
  transform: scale(0.96);
}

.stage-play-button:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.88);
  outline-offset: 3px;
}

.playback-starting-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 13px;
  color: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 999px;
  background: rgba(15, 16, 20, 0.58);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(16px) saturate(1.25);
  -webkit-backdrop-filter: blur(16px) saturate(1.25);
  font-size: 0.76rem;
  font-weight: 550;
}

.playback-starting-pill svg {
  width: 16px;
  height: 16px;
  animation: spin 0.9s linear infinite;
}

.loading-wave {
  display: flex;
  width: 48px;
  height: 34px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-bottom: 3px;
}

.loading-wave i {
  width: 3px;
  height: 22px;
  border-radius: 999px;
  background: linear-gradient(180deg, #d9deff, var(--liquid-accent));
  box-shadow: 0 0 14px var(--liquid-accent-glow);
  animation: loading-wave 1.05s ease-in-out infinite;
}

.loading-wave i:nth-child(2) { animation-delay: 0.12s; }
.loading-wave i:nth-child(3) { animation-delay: 0.24s; }
.loading-wave i:nth-child(4) { animation-delay: 0.36s; }

.error-state .state-icon {
  width: 38px;
  color: #fda4af;
}

.state-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.primary-button,
.secondary-button {
  min-height: 44px;
  padding: 0 18px;
  color: #fff;
  border-radius: 999px;
}

.primary-button {
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: #e11d48;
}

.secondary-button {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.08);
}

.reload-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
.reload-button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; }

.mobile-player-actions { display: none; }

.playback-settings {
  display: grid;
  gap: 12px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(13, 16, 25, 0.98);
}

.setting-group {
  min-width: 0;
}

.setting-heading {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 7px;
  color: rgba(255, 255, 255, 0.88);
  font-size: 0.8rem;
}

.setting-heading small,
.episode-heading small,
.episode-heading span,
.episode-copy small {
  color: rgba(255, 255, 255, 0.44);
  font-size: 0.7rem;
}

.option-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.option-scroll::-webkit-scrollbar {
  display: none;
}

.option-chip {
  min-height: 40px;
  flex: 0 0 auto;
  padding: 0 14px;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.78rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
}

.option-chip.active {
  color: #fff;
  border-color: rgba(244, 63, 94, 0.62);
  background: rgba(190, 18, 60, 0.34);
}

.option-chip:disabled {
  cursor: default;
  opacity: 0.62;
}

.option-chip:focus-visible,
.episode-item:focus-visible,
.primary-button:focus-visible,
.secondary-button:focus-visible {
  outline: 2px solid #fb7185;
  outline-offset: 2px;
}

.episode-panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  background: #0c0f18;
}

.episode-heading {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.episode-heading > div {
  gap: 8px;
}

.episode-heading-title {
  min-width: 0;
  flex-direction: column;
  align-items: flex-start !important;
  gap: 3px !important;
}

.episode-heading-main { display: flex; align-items: center; gap: 8px; }
.episode-update-time { font-variant-numeric: tabular-nums; white-space: nowrap; }

.episode-heading strong {
  font-size: 0.9rem;
}

.episode-ranges {
  display: flex;
  gap: 7px;
  padding: 9px 10px 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.episode-ranges::-webkit-scrollbar { display: none; }
.episode-ranges button {
  min-height: 34px;
  padding: 0 12px;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  color: var(--text-tertiary);
  background: rgba(255, 255, 255, 0.035);
  cursor: pointer;
}
.episode-ranges button.active {
  color: #fff;
  border-color: rgb(var(--accent-rgb) / 0.24);
  background: var(--liquid-accent-subtle);
}

.episode-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.episode-item {
  min-height: 58px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 8px;
  color: rgba(255, 255, 255, 0.76);
  text-align: left;
  border: 1px solid transparent;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
}

.episode-item:hover,
.episode-item:focus-visible {
  background: rgba(255, 255, 255, 0.08);
}

.episode-item.active {
  color: #fff;
  border-color: rgba(244, 63, 94, 0.38);
  background: rgba(159, 18, 57, 0.22);
}

.episode-number {
  position: relative;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.76rem;
  font-weight: 700;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
}

.episode-latest {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0 3px;
  color: var(--accent-ink);
  font-size: 0.55rem;
  font-style: normal;
  font-weight: 800;
  line-height: 1;
  border-radius: 999px;
  background: var(--liquid-accent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .35);
}

.episode-current-dot {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 7px currentColor;
}

.episode-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.episode-copy strong {
  overflow: hidden;
  font-size: 0.78rem;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sr-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes loading-wave {
  0%, 100% { opacity: 0.38; transform: scaleY(0.34); }
  50% { opacity: 1; transform: scaleY(1); }
}

@keyframes stage-scan {
  0%, 18% { transform: skewX(-12deg) translateX(-180%); }
  72%, 100% { transform: skewX(-12deg) translateX(440%); }
}

@media (max-width: 820px) {
  .player-backdrop {
    padding: 0;
    place-items: stretch;
  }

  .player-window {
    width: 100%;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }

  .player-header {
    min-height: calc(60px + env(safe-area-inset-top));
    padding-top: calc(8px + env(safe-area-inset-top));
  }

  .player-layout {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .video-column {
    flex: 0 0 auto;
  }

  .video-stage {
    width: 100%;
    min-height: min(56.25vw, 42dvh);
    aspect-ratio: 16 / 9;
    flex: none;
  }

  .playback-settings {
    padding-bottom: 12px;
  }

  .option-chip {
    min-height: 44px;
  }

  .episode-panel {
    min-height: 280px;
    flex: 1 0 280px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    border-left: 0;
  }

  .episode-heading {
    position: sticky;
    top: 0;
    z-index: 1;
    background: rgba(12, 15, 24, 0.96);
  }

  .episode-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
  }

  .text-action {
    display: none;
  }

  .title-copy p {
    max-width: 54vw;
  }
}

@media (max-width: 430px) {
  .source-badge {
    display: none;
  }

  .episode-list {
    grid-template-columns: 1fr;
  }

  .setting-heading small,
  .episode-heading > small {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-backdrop,
  .loading-wave i,
  .loading-state::after,
  .playback-starting-pill svg {
    transition: none;
    animation: none;
  }
}
</style>

<style scoped>
.player-backdrop { background: rgba(0, 0, 0, 0.9); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.player-window {
  border-color: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  background: #090a0d;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.66);
}
.player-header { border-color: rgba(255, 255, 255, 0.075); background: #121318; }
.source-badge { color: var(--liquid-accent); border-color: rgba(46, 230, 166, 0.24); background: rgba(46, 230, 166, 0.09); }
.text-action,
.icon-button { border-color: rgba(255, 255, 255, 0.075); background: rgba(255, 255, 255, 0.045); }
.text-action:hover,
.icon-button:hover,
.text-action:focus-visible,
.icon-button:focus-visible { border-color: rgba(255, 255, 255, 0.13); background: rgba(255, 255, 255, 0.075); }
.stage-state { background: radial-gradient(circle at center, #15171d 0%, #050506 76%); }
.loading-state { background: #030304; }
.error-state .state-icon { color: var(--danger); }
.primary-button { border-color: transparent; background: var(--liquid-accent); }
.playback-settings { border-color: rgba(255, 255, 255, 0.075); background: #111217; }
.option-chip { border-color: rgba(255, 255, 255, 0.075); border-radius: 12px; background: rgba(255, 255, 255, 0.045); }
.option-chip.active { border-color: rgba(46, 230, 166, 0.24); background: rgba(46, 230, 166, 0.1); }
.option-chip:focus-visible,
.episode-item:focus-visible,
.primary-button:focus-visible,
.secondary-button:focus-visible { outline-color: var(--liquid-accent); }
.episode-panel { border-color: rgba(255, 255, 255, 0.075); background: #0e0f13; }
.episode-heading { border-color: rgba(255, 255, 255, 0.075); }
.episode-item { border-radius: 12px; background: rgba(255, 255, 255, 0.03); }
.episode-item.active { border-color: rgba(46, 230, 166, 0.22); background: rgba(46, 230, 166, 0.1); }
.episode-number { color: var(--text-secondary); background: rgba(255, 255, 255, 0.055); }

@media (max-width: 820px) {
  .player-backdrop { background: #050506; backdrop-filter: none; -webkit-backdrop-filter: none; }
  .player-window { background: #08090b; }
  .player-header {
    min-height: calc(56px + var(--safe-area-top));
    padding: calc(7px + var(--safe-area-top)) var(--mobile-gutter) 7px;
    border: 0;
    background: #08090b;
  }
  .title-block { gap: 8px; }
  .title-copy h2 { font-size: 1rem; font-weight: 650; }
  .title-copy p { margin-top: 1px; font-size: .69rem; }
  .icon-button { width: 42px; min-height: 42px; border: 0; background: rgba(255,255,255,.07); }
  .video-stage { min-height: 0; max-height: 38dvh; background: #000; }
  .stage-state { gap: 8px; background: #030304; }
  .stage-poster { display: none; }
  .loading-state::after { display: none; }
  .loading-wave { margin-bottom: 1px; }
  .stage-state p { max-width: 300px; font-size: .76rem; }
  .stage-play-button { min-width: 132px; gap: 6px; padding: 10px 14px; }
  .stage-play-icon { width: 60px; height: 60px; }
  .stage-play-icon svg { width: 25px; height: 25px; }
  .stage-play-label { font-size: .82rem; }
  .stage-play-button small { font-size: .66rem; }
  .mobile-player-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 10px var(--mobile-gutter);
    background: #08090b;
  }
  .mobile-player-actions button {
    min-width: 0;
    min-height: 56px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border: 1px solid rgba(255,255,255,.065);
    border-radius: 13px;
    color: #fff;
    background: rgba(255,255,255,.035);
    text-align: left;
    touch-action: manipulation;
  }
  .mobile-player-actions button > svg { width: 20px; flex: 0 0 auto; color: var(--liquid-accent); }
  .mobile-player-actions button > span { min-width: 0; display: grid; gap: 2px; }
  .mobile-player-actions strong { font-size: .78rem; }
  .mobile-player-actions small { overflow: hidden; color: var(--text-tertiary); font-size: .63rem; text-overflow: ellipsis; white-space: nowrap; }
  .playback-settings {
    display: none;
    gap: 0;
    padding: 4px var(--mobile-gutter) 0;
    border: 0;
    background: #08090b;
  }
  .playback-settings.mobile-expanded { display: grid; }
  .setting-group { padding: 13px 0; border-bottom: 1px solid rgba(255,255,255,.065); }
  .setting-heading { margin-bottom: 9px; font-size: .76rem; }
  .setting-heading small { font-size: .66rem; }
  .option-scroll { gap: 7px; margin-right: calc(-1 * var(--mobile-gutter)); padding-right: var(--mobile-gutter); }
  .option-chip {
    min-height: 38px;
    padding: 0 13px;
    border: 0;
    border-radius: 10px;
    background: rgba(255,255,255,.055);
    font-size: .75rem;
  }
  .option-chip.active { color: var(--liquid-accent); background: rgba(46,230,166,.11); }
  .episode-panel { min-height: 244px; flex-basis: 244px; border: 0; background: #08090b; scroll-margin-top: calc(56px + var(--safe-area-top)); }
  .player-layout.single-column .video-column { flex: 1 1 auto; }
  .player-layout.single-column .video-stage { height: 100%; max-height: none; aspect-ratio: auto; }
  .episode-heading {
    position: static;
    min-height: 58px;
    padding: 14px var(--mobile-gutter) 9px;
    border: 0;
    background: #08090b;
  }
  .episode-heading strong { font-size: .96rem; }
  .episode-ranges {
    gap: 6px;
    padding: 5px var(--mobile-gutter) 3px;
  }
  .episode-ranges button { min-height: 42px; padding: 0 14px; border: 0; border-radius: 11px; touch-action: manipulation; }
  .episode-list {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 7px;
    padding: 6px var(--mobile-gutter) calc(18px + var(--safe-area-bottom));
  }
  .episode-item {
    position: relative;
    min-height: 52px;
    grid-template-columns: 1fr;
    gap: 0;
    padding: 0;
    overflow: visible;
    border: 1px solid rgba(151,255,211,.06);
    border-radius: 13px;
    background: linear-gradient(145deg, rgba(151,255,211,.055), rgba(151,255,211,.018));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.025);
  }
  .episode-item.active {
    color: #032117;
    border-color: rgba(129,255,207,.7);
    background: linear-gradient(145deg, #78f6c5, var(--liquid-accent-strong));
    box-shadow: 0 7px 18px rgba(16,174,119,.2), inset 0 1px 0 rgba(255,255,255,.48);
  }
  .episode-number {
    width: 100%;
    height: 100%;
    border-radius: 0;
    color: inherit;
    background: transparent;
    font-size: .86rem;
    font-variant-numeric: tabular-nums;
  }
  .episode-item.latest:not(.active) { border-color: rgba(46,230,166,.18); }
  .episode-latest { top: -5px; right: -4px; min-width: 15px; height: 15px; font-size: .5rem; }
  .episode-item.active .episode-latest { color: var(--liquid-accent); background: #032117; }
  .episode-current-dot { right: 7px; bottom: 6px; width: 4px; height: 4px; }
  .episode-copy { display: none; }
}

@media (max-width: 430px) {
  .episode-list { grid-template-columns: repeat(5, minmax(0, 1fr)); }
}
</style>

<style scoped>
.player-backdrop { background: rgb(3 4 8 / 0.94); }
.player-window { border-color: rgb(239 241 255 / 0.08); background: #0a0b10; }
.player-header { border-color: rgb(239 241 255 / 0.07); background: #11131b; }
.source-badge { color: var(--liquid-accent); border-color: rgb(var(--accent-rgb) / 0.22); background: var(--liquid-accent-subtle); }
.text-action,
.icon-button { border-color: rgb(239 241 255 / 0.08); background: rgb(237 240 255 / 0.04); }
.text-action:hover,
.icon-button:hover { border-color: rgb(var(--accent-rgb) / 0.18); background: var(--liquid-accent-muted); }
.loading-wave i { background: linear-gradient(180deg, #d9deff, var(--liquid-accent)); box-shadow: 0 0 14px var(--liquid-accent-glow); }
.playback-starting-pill { border-color: rgb(var(--accent-rgb) / 0.16); color: var(--text-secondary); background: rgb(17 19 28 / 0.78); }
.stage-play-icon,
.primary-button { color: var(--accent-ink); background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong)); }
.playback-settings { border-color: rgb(239 241 255 / 0.07); background: #11131b; }
.option-chip { border-color: rgb(239 241 255 / 0.075); background: rgb(237 240 255 / 0.04); }
.option-chip.active { border-color: rgb(var(--accent-rgb) / 0.25); color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.automation-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid rgb(239 241 255 / 0.07);
  border-radius: 14px;
  background: rgb(237 240 255 / 0.025);
}
.automation-row {
  min-width: 0;
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 11px;
}
.automation-row + .automation-row { border-left: 1px solid rgb(239 241 255 / 0.07); }
.automation-copy { min-width: 0; display: grid; flex: 1; gap: 2px; }
.automation-copy strong { color: var(--text-primary); font-size: .78rem; font-weight: 620; }
.automation-copy small { color: var(--text-tertiary); font-size: .66rem; line-height: 1.35; }
.setting-switch {
  position: relative;
  width: 46px;
  height: 28px;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgb(205 210 229 / 0.18);
  cursor: pointer;
  touch-action: manipulation;
  transition: background 180ms ease, box-shadow 180ms ease;
}
.setting-switch span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #f8f8ff;
  box-shadow: 0 2px 7px rgba(0, 0, 0, .34);
  transition: transform 190ms ease;
}
.setting-switch[aria-checked='true'] { background: var(--liquid-accent-strong); box-shadow: 0 0 0 1px rgb(var(--accent-rgb) / .14); }
.setting-switch[aria-checked='true'] span { transform: translateX(18px); }
.setting-switch:focus-visible { outline: 2px solid var(--liquid-accent); outline-offset: 2px; }
.episode-panel { border-color: rgb(239 241 255 / 0.07); background: #0d0f16; }
.episode-heading { border-color: rgb(239 241 255 / 0.07); }
.episode-ranges button,
.episode-item { border-color: rgb(239 241 255 / 0.07); background: rgb(237 240 255 / 0.03); }
.episode-ranges button.active,
.episode-item.active { border-color: rgb(var(--accent-rgb) / 0.22); color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.episode-number { background: rgb(237 240 255 / 0.045); }

@media (max-width: 820px) {
  .player-backdrop,
  .player-window,
  .player-header,
  .mobile-player-actions,
  .playback-settings,
  .episode-panel,
  .episode-heading { background: #0a0b10; }
  .player-header { background: linear-gradient(180deg, #151824, #0a0b10); }
  .icon-button { background: rgb(237 240 255 / 0.055); }
  .mobile-player-actions button { border-color: rgb(239 241 255 / 0.08); background: rgb(237 240 255 / 0.035); }
  .mobile-player-actions button > svg { color: var(--liquid-accent); }
  .setting-group { border-color: rgb(239 241 255 / 0.07); }
  .automation-setting-group { padding-bottom: 16px; border-bottom: 0; }
  .automation-list { grid-template-columns: 1fr; border-radius: 15px; }
  .automation-row { min-height: 62px; padding: 10px 12px; }
  .automation-row + .automation-row { border-top: 1px solid rgb(239 241 255 / 0.07); border-left: 0; }
  .automation-copy strong { font-size: .8rem; }
  .automation-copy small { font-size: .67rem; }
  .option-chip { background: rgb(237 240 255 / 0.045); }
  .option-chip.active { color: var(--liquid-accent); background: rgb(var(--accent-rgb) / 0.12); }
  .episode-item {
    border-color: rgb(239 241 255 / .06);
    background: linear-gradient(145deg, rgb(237 240 255 / .055), rgb(237 240 255 / .018));
  }
  .episode-item.active {
    color: var(--accent-ink);
    border-color: rgb(var(--accent-rgb) / .72);
    background: linear-gradient(145deg, #c0caff, var(--liquid-accent-strong));
  }
  .episode-number { background: transparent; }
}

@media (prefers-reduced-motion: reduce) {
  .setting-switch,
  .setting-switch span { transition: none; }
}
</style>
