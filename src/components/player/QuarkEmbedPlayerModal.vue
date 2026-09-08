<script setup lang="ts">
import type Hls from 'hls.js';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Check, ChevronDown, CircleAlert, ListVideo, LoaderCircle, Maximize, Play, RefreshCw, SlidersHorizontal, X } from '@lucide/vue';
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
import { useDialog } from '../../composables/useDialog';
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
const settingsToggleRef = ref<HTMLButtonElement | null>(null);
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
let hlsNetworkRetryTimer: number | null = null;
let hlsNetworkRetryCount = 0;
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
  if (hlsNetworkRetryTimer !== null) {
    window.clearTimeout(hlsNetworkRetryTimer);
    hlsNetworkRetryTimer = null;
  }
  hlsNetworkRetryCount = 0;
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
    announce('播放认证已失效，可前往“我的”更新');
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
      hls.on(HlsRuntime.Events.FRAG_LOADED, () => {
        hlsNetworkRetryCount = 0;
      });
      hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
        if (!data.fatal || attachSequence !== sourceAttachSequence) return;
        if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR) {
          if (hlsNetworkRetryTimer !== null) return;
          if (hlsNetworkRetryCount < 3) {
            const retryDelays = [600, 1_500, 3_000];
            const retryDelay = retryDelays[hlsNetworkRetryCount++] ?? 3_000;
            hlsNetworkRetryTimer = window.setTimeout(() => {
              hlsNetworkRetryTimer = null;
              if (attachSequence === sourceAttachSequence && hlsRef.value === hls) hls.startLoad();
            }, retryDelay);
            return;
          }
          playbackStarting.value = false;
          errorMessage.value = '视频网络持续不稳定，请刷新当前剧集重试';
          phase.value = 'error';
          announce(errorMessage.value);
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

const collapseSettings = async () => {
  settingsExpanded.value = false;
  await nextTick();
  settingsToggleRef.value?.focus({ preventScroll: true });
};

const selectEpisode = async (index: number) => {
  await prepareEpisode(index);
  if (phase.value !== 'ready') return;
  videoRef.value?.parentElement?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start'
  });
};

const retry = () => {
  if (session.value && currentEpisode.value) prepareEpisode(currentEpisodeIndex.value);
  else loadSession();
};

type NativeFullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

const requestNativeVideoFullscreen = async () => {
  const video = videoRef.value as NativeFullscreenVideo | null;
  if (!video) return;
  if (phase.value !== 'ready' || video.readyState === 0) {
    toast.show('视频准备好后再点全屏', '!', 3000);
    return;
  }

  try {
    // iPhone 使用系统视频播放器；同步调用以保留点击手势授权。
    if (isIOSPlaybackDevice && video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    } else if (video.requestFullscreen) {
      await video.requestFullscreen();
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    } else {
      toast.show('请使用视频自带的全屏按钮，或在 Safari 中打开', '!', 4000);
    }
  } catch {
    toast.show('暂时无法进入全屏，请先播放，再点视频自带的全屏按钮', '!', 4000);
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

const dialogRef = ref<HTMLElement | null>(null);
useDialog(dialogRef, () => props.isOpen, () => {
  if (document.fullscreenElement || (videoRef.value as NativeFullscreenVideo | null)?.webkitDisplayingFullscreen) return;
  close();
});

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

watch(playbackAutomation, value => {
  localStorage.setItem(playbackAutomationStorageKey, JSON.stringify(value));
}, { deep: true });

onBeforeUnmount(() => {
  void persistProgress(true, false, true);
  phase.value = 'idle';
  stopVideo(true);
  resetSoundEffectGraph();
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
    ref="dialogRef"
    :class="{ active: isOpen }"
    role="dialog"
    aria-modal="true"
    :aria-label="media ? `播放《${media.title}》` : '视频播放器'"
    @click.self="close"
  >
    <section v-if="media" class="player-window">
      <header class="player-header">
        <div class="title-block">
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
              <strong>{{ phase === 'auth-required' ? '播放认证已失效' : '加载失败' }}</strong>
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

          <div v-if="phase === 'ready' && sources.length" class="player-toolbar" aria-label="播放操作">
            <button
              ref="settingsToggleRef"
              type="button"
              :aria-expanded="settingsExpanded"
              aria-controls="playback-settings"
              @click="settingsExpanded = !settingsExpanded"
            >
              <SlidersHorizontal aria-hidden="true" />
              <span><strong>播放设置</strong><small>{{ selectedSource?.label || '自动' }} · {{ selectedSoundEffect?.label || '原声' }}</small></span>
              <ChevronDown class="toolbar-chevron" aria-hidden="true" />
            </button>
            <button type="button" @click="scrollToEpisodes">
              <ListVideo aria-hidden="true" />
              <span><strong>选集</strong><small>{{ episodeStatus }}</small></span>
            </button>
            <button type="button" class="fullscreen-button" aria-label="全屏播放" @click="requestNativeVideoFullscreen"><Maximize aria-hidden="true" /><span>全屏</span></button>
          </div>

          <div
            v-if="phase === 'ready' && sources.length"
            v-show="settingsExpanded"
            id="playback-settings"
            class="playback-settings"
          >
            <div class="settings-panel-heading">
              <strong>播放设置</strong>
              <button class="icon-button" type="button" aria-label="收起播放设置" @click="collapseSettings"><X aria-hidden="true" /></button>
            </div>
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
                  <Check v-if="selectedSourceId === source.id" aria-hidden="true" />
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
              @click="selectEpisode(entry.index)"
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
.player-backdrop { position: fixed; inset: 0; z-index: 1400; display: grid; place-items: center; padding: 24px; background: rgb(0 0 0 / .58); opacity: 0; visibility: hidden; transition: opacity .2s, visibility .2s; }
.player-backdrop.active { opacity: 1; visibility: visible; }
.player-backdrop:not(.active) { display: none; }
.player-window { display: flex; flex-direction: column; width: min(1240px, 100%); height: min(850px, calc(100dvh - 48px)); min-height: 0; overflow: hidden; border: var(--glass-border); border-radius: 22px; color: var(--text-primary); background: var(--liquid-canvas); box-shadow: var(--glass-shadow-lg); }
.player-header { display: flex; flex-shrink: 0; min-height: 80px; align-items: center; justify-content: space-between; gap: 16px; padding: 15px 24px; border-bottom: 1px solid rgb(255 255 255 / .06); background: transparent; }
.title-block, .header-actions { display: flex; align-items: center; gap: 12px; }
.title-block, .title-copy { min-width: 0; }
.source-badge { flex: 0 0 auto; padding: 6px 10px; border: var(--glass-border); border-radius: 18px; color: var(--liquid-accent-strong); background: var(--glass-lens); box-shadow: var(--glass-highlight-inner); font-size: .7rem; font-weight: 650; }
.title-copy h2 { overflow: hidden; color: var(--text-primary); font-size: 1.1rem; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -.025em; }
.title-copy p { margin-top: 3px; overflow: hidden; color: var(--text-tertiary); font-size: .75rem; text-overflow: ellipsis; white-space: nowrap; }
.header-actions { flex-shrink: 0; gap: 8px; }
.text-action, .icon-button { min-height: 44px; border: 0; color: var(--text-secondary); background: var(--glass-bg); box-shadow: none; }
.text-action { padding: 0 18px; border-radius: 24px; font-size: .82rem; font-weight: 600; }
.icon-button { display: grid; width: 44px; flex-shrink: 0; place-items: center; border-radius: 50%; }
.icon-button svg { width: 19px; height: 19px; }
.text-action:hover, .icon-button:hover { background: var(--glass-bg-active); }
.player-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; min-height: 0; flex: 1; }
.player-layout.single-column { grid-template-columns: minmax(0, 1fr); }
.video-column { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; padding: 18px; }
/* Only the stage owns dark tokens. Playback pixels are never blurred or tinted. */
.video-stage { --text-primary: #f6f8ff; --text-secondary: #d0daea; --text-tertiary: #b7c4d9; --liquid-accent: #b6ceff; --liquid-accent-strong: #91b3f7; position: relative; display: grid; width: 100%; min-height: 220px; aspect-ratio: 16 / 9; flex: 0 0 auto; place-items: center; overflow: hidden; border: var(--glass-border); border-radius: 12px; color: var(--text-primary); background: #000; color-scheme: dark; }
.video-element { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; object-fit: contain; background: #000; }
.stage-state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 20px; overflow-y: auto; text-align: center; background: radial-gradient(ellipse at 50% 10%, #222831, #0c1016 75%); }
.loading-state { isolation: isolate; }
.stage-poster { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; object-fit: cover; opacity: .12; }
.loading-content { display: grid; justify-items: center; gap: 8px; }
.stage-state strong { font-size: .97rem; font-weight: 650; }
.stage-state p { max-width: 420px; color: var(--text-secondary); font-size: .8rem; line-height: 1.6; overflow-wrap: anywhere; }
.state-icon { width: 28px; height: 28px; color: #f0c3cc; }
.state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 5px; }
.primary-button, .secondary-button { min-height: 44px; padding: 0 17px; border: 1px solid rgb(255 255 255 / .16); border-radius: 24px; font-size: .8rem; font-weight: 600; box-shadow: none; }
.primary-button { color: #eff3fa; background: rgb(255 255 255 / .12); }
.secondary-button { color: #f1f5ff; background: rgb(255 255 255 / .045); }
.reload-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.reload-button svg { width: 16px; height: 16px; }
.play-prompt, .playback-starting { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; pointer-events: none; }
.play-prompt { background: rgb(0 0 0 / .2); }
.stage-play-button { display: grid; min-width: 140px; justify-items: center; gap: 7px; padding: 12px 16px; border: 0; border-radius: 26px; color: #fff; background: transparent; pointer-events: auto; }
.stage-play-icon { display: grid; width: 68px; height: 68px; place-items: center; border: 1px solid rgb(255 255 255 / .09); border-radius: 50%; color: #fff; background: linear-gradient(145deg, rgb(255 255 255 / .4), rgb(255 255 255 / .1)); box-shadow: inset 0 2px 2px rgb(255 255 255 / .6), 0 9px 28px rgb(0 0 0 / .2); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); transition: transform .2s, background .2s; }
.stage-play-icon svg { width: 27px; height: 27px; margin-left: 3px; fill: currentColor; }
.stage-play-button:active .stage-play-icon { transform: scale(.95); }
.stage-play-label { font-size: .86rem; font-weight: 650; text-shadow: 0 2px 6px #000; }
.stage-play-button small { color: #e1e9f8; font-size: .7rem; text-shadow: 0 2px 6px #000; }
.playback-starting-pill { display: inline-flex; align-items: center; gap: 8px; padding: 10px 15px; border: 1px solid rgb(255 255 255 / .09); border-radius: 24px; color: #f4f7ff; background: rgb(29 40 59 / .8); box-shadow: inset 0 1px rgb(255 255 255 / .4); font-size: .77rem; }
.playback-starting-pill svg { width: 17px; height: 17px; animation: spin 1s linear infinite; }
.loading-wave { display: flex; height: 30px; align-items: center; gap: 4px; margin-bottom: 2px; }
.loading-wave i { width: 3px; height: 20px; border-radius: 5px; background: #bad2ff; animation: loading-wave 1.2s ease-in-out infinite; }
.loading-wave i:nth-child(2) { animation-delay: .12s; }
.loading-wave i:nth-child(3) { animation-delay: .24s; }
.loading-wave i:nth-child(4) { animation-delay: .36s; }
.player-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 58px; flex-shrink: 0; gap: 9px; padding: 14px 0; }
.player-toolbar button { display: flex; min-width: 0; min-height: 60px; align-items: center; gap: 10px; padding: 9px 13px; border: 0; border-radius: 12px; color: var(--text-primary); background: var(--surface-1); text-align: left; }
.player-toolbar button[aria-expanded='true'] { color: var(--liquid-accent-strong); background: var(--glass-lens); border-color: rgb(var(--accent-rgb) / .25); }
.player-toolbar button > svg { width: 20px; height: 20px; flex-shrink: 0; color: var(--liquid-accent); }
.player-toolbar button > span { display: grid; min-width: 0; flex: 1; gap: 2px; }
.player-toolbar strong { font-size: .81rem; font-weight: 650; }
.player-toolbar small { overflow: hidden; color: var(--text-tertiary); font-size: .68rem; text-overflow: ellipsis; white-space: nowrap; }
.player-toolbar .toolbar-chevron { width: 15px; height: 15px; transition: transform .2s; }
.player-toolbar [aria-expanded='true'] .toolbar-chevron { transform: rotate(180deg); }
.player-toolbar .fullscreen-button { display: grid; justify-items: center; align-content: center; gap: 3px; padding: 7px 4px; }
.fullscreen-button span { flex: none; font-size: .65rem; }
.playback-settings { display: grid; flex-shrink: 0; gap: 22px; margin-bottom: 8px; padding: 20px; border: 0; border-radius: 16px; background: var(--surface-1); }
.settings-panel-heading, .setting-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.settings-panel-heading { margin-top: -6px; margin-bottom: -7px; }
.settings-panel-heading > strong { font-size: .97rem; font-weight: 700; }
.settings-panel-heading .icon-button { box-shadow: none; background: var(--glass-bg); }
.setting-group { min-width: 0; }
.setting-heading { margin-bottom: 10px; font-size: .82rem; font-weight: 650; }
.setting-heading small { min-width: 0; overflow: hidden; color: var(--text-tertiary); font-size: .67rem; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
.option-scroll { display: flex; gap: 7px; overflow-x: auto; padding: 3px 2px 7px; scrollbar-width: thin; }
.option-chip { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 5px; flex-shrink: 0; padding: 0 15px; border: var(--glass-border); border-radius: 24px; color: var(--text-secondary); background: var(--glass-bg); font-size: .77rem; }
.option-chip svg { width: 14px; height: 14px; }
.option-chip.active { color: var(--liquid-accent-strong); border-color: rgb(var(--accent-rgb) / .23); background: var(--glass-lens); box-shadow: none; font-weight: 650; }
.option-chip:disabled { opacity: 1; cursor: default; }
.automation-list { display: grid; border: var(--glass-border); border-radius: 20px; background: var(--glass-bg); }
.automation-row { display: flex; min-width: 0; min-height: 70px; align-items: center; gap: 12px; padding: 12px 14px; }
.automation-row + .automation-row { border-top: 1px solid rgb(60 84 122 / .1); }
.automation-copy { display: grid; min-width: 0; flex: 1; gap: 4px; }
.automation-copy strong { font-size: .8rem; font-weight: 600; }
.automation-copy small { color: var(--text-tertiary); font-size: .68rem; line-height: 1.5; }
/* The switch has a 44px touch target around its 30px visual track. */
.setting-switch { position: relative; width: 52px; height: 44px; flex-shrink: 0; border: 0; border-radius: 24px; background: transparent; }
.setting-switch::before { content: ''; position: absolute; inset: 7px 0; border: 1px solid rgb(80 105 145 / .14); border-radius: 18px; background: #3b4450; box-shadow: inset 0 1px 3px rgb(36 54 86 / .12); transition: background .2s; }
.setting-switch span { position: absolute; top: 10px; left: 3px; width: 24px; height: 24px; border: 1px solid rgb(255 255 255 / .18); border-radius: 50%; background: #d8dfe9; box-shadow: 0 2px 5px rgb(36 54 86 / .2); transition: transform .22s var(--spring-ease); }
.setting-switch[aria-checked='true']::before { background: var(--liquid-accent); }
.setting-switch[aria-checked='true'] span { transform: translateX(22px); }
.episode-panel { display: flex; min-width: 0; min-height: 0; flex-direction: column; margin: 0; overflow: hidden; border-left: 1px solid rgb(255 255 255 / .07); background: transparent; }
.episode-heading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 8px; padding: 20px 16px 15px; }
.episode-heading-title { display: grid; min-width: 0; gap: 5px; }
.episode-heading-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px; }
.episode-heading strong { font-size: 1rem; font-weight: 700; }
.episode-heading small, .episode-heading span { color: var(--text-tertiary); font-size: .66rem; }
.episode-heading > small { flex-shrink: 0; }
.episode-update-time { font-variant-numeric: tabular-nums; }
.episode-ranges { display: flex; flex-shrink: 0; gap: 6px; overflow-x: auto; padding: 0 12px 10px; }
.episode-ranges button { min-height: 44px; flex-shrink: 0; padding: 0 14px; border: var(--glass-border); border-radius: 24px; color: var(--text-secondary); background: var(--glass-bg); font-size: .76rem; }
.episode-ranges button.active { color: var(--liquid-accent-strong); background: var(--glass-lens); box-shadow: var(--glass-highlight-inner); font-weight: 650; }
.episode-list { display: grid; min-height: 0; align-content: start; gap: 8px; overflow-y: auto; overscroll-behavior: contain; padding: 3px 12px 16px; }
.episode-item { display: grid; min-width: 0; min-height: 66px; grid-template-columns: 40px minmax(0, 1fr); align-items: center; gap: 10px; padding: 9px; border: 1px solid transparent; border-radius: 19px; color: var(--text-secondary); background: transparent; text-align: left;  box-shadow: none; }
.episode-item.active { color: var(--text-primary); border-color: transparent; background: var(--glass-bg-active); box-shadow: none; }
.episode-item:hover { background: var(--glass-bg-hover); }
.episode-number { position: relative; display: grid; width: 40px; height: 40px; place-items: center; border-radius: 8px; background: var(--glass-bg); font-size: .84rem; font-weight: 550; font-variant-numeric: tabular-nums; }
.episode-item.active .episode-number { color: var(--liquid-accent-strong); border-color: rgb(var(--accent-rgb) / .2); background: var(--liquid-accent-subtle); box-shadow: none; }
.episode-latest { position: absolute; top: -6px; right: -5px; display: grid; min-width: 16px; height: 16px; place-items: center; padding: 0 3px; border: 1px solid rgb(255 255 255 / .09); border-radius: 9px; color: var(--accent-ink); background: var(--liquid-accent); font-size: .5rem; font-weight: 650; line-height: 1; }
.episode-current-dot { position: absolute; bottom: 4px; left: calc(50% - 2px); width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
.episode-copy { display: grid; min-width: 0; gap: 4px; }
.episode-copy strong { overflow: hidden; font-size: .79rem; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.episode-copy small { color: var(--text-tertiary); font-size: .65rem; }
.sr-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes loading-wave { 0%, 100% { opacity: .45; transform: scaleY(.45); } 50% { opacity: 1; transform: scaleY(1); } }
@media (max-width: 1000px) and (min-width: 821px) { .player-layout { grid-template-columns: minmax(0, 1fr) 255px; } .source-badge { display: none; } .player-toolbar .toolbar-chevron { display: none; } }
@media (max-width: 820px) {
  .player-backdrop { padding: 0; place-items: stretch; background: rgb(0 0 0 / .58); }
  .player-window { width: 100%; height: 100dvh; border: 0; border-radius: 0;  box-shadow: var(--glass-highlight-inner), 0 28px 90px rgb(0 0 0 / .4); }
  .player-header { min-height: calc(72px + var(--safe-area-top)); padding: calc(10px + var(--safe-area-top)) calc(18px + var(--safe-area-right)) 10px calc(18px + var(--safe-area-left)); }
  .source-badge { display: none; }
  .title-copy h2 { font-size: 1.06rem; }
  .title-copy p { font-size: .71rem; }
  .header-actions { gap: 6px; }
  .text-action { padding: 0 13px; }
  .player-layout { display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; }
  .video-column { flex: 0 0 auto; overflow: visible; padding: 14px calc(14px + var(--safe-area-right)) 0 calc(14px + var(--safe-area-left)); }
  .video-stage { min-height: 0; aspect-ratio: 16 / 9; border-radius: 10px; border: 0; }
  .video-stage:last-child { margin-bottom: 14px; }
  .stage-state { gap: 7px; padding: 12px;  background: radial-gradient(ellipse at 50% 10%, #222831, #0c1016 75%); }
  .stage-state strong { font-size: .88rem; }
  .stage-state p { font-size: .74rem; line-height: 1.45; }
  .stage-poster { display: none; }
  .stage-play-icon { width: 58px; height: 58px; }
  .stage-play-button small { font-size: .65rem; }
  .player-toolbar { gap: 7px; padding: 12px 0; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 49px; }
  .player-toolbar button { min-height: 62px; gap: 7px; padding: 9px 10px; border-radius: 12px; background: var(--surface-1); }
  .player-toolbar strong { font-size: .77rem; }
  .player-toolbar small { font-size: .62rem; }
  .player-toolbar .toolbar-chevron { display: none; }
  .player-toolbar .fullscreen-button { padding: 8px 3px; }
  .playback-settings { gap: 17px; padding: 17px; margin-bottom: 14px; border-radius: 16px; }
  .setting-heading { flex-wrap: wrap; gap: 4px 10px; }
  .episode-panel { flex: 0 0 auto; margin: 0 calc(14px + var(--safe-area-right)) calc(20px + var(--safe-area-bottom)) calc(14px + var(--safe-area-left)); border: 0; overflow: visible; scroll-margin-top: 10px; }
  .episode-heading { padding: 19px 16px 15px; }
  .episode-list { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 9px; overflow: visible; padding: 7px 14px 20px; }
  .episode-item { position: relative; min-height: 52px; grid-template-columns: 1fr; padding: 0; gap: 0; border: 1px solid transparent; border-radius: 10px; background: var(--surface-1); box-shadow: none; }
  .episode-number { width: 100%; height: 100%; min-height: 52px; border: 0; border-radius: inherit; background: transparent; font-size: .9rem; }
  .episode-item.active { border-color: rgb(255 255 255 / .35); box-shadow: none; }
  .episode-item.active .episode-number { background: var(--glass-bg-active); color: var(--text-primary);  box-shadow: none;  border-color: rgb(var(--accent-rgb) / .2); }
  .episode-latest { top: -5px; right: -4px;  color: var(--accent-ink); }
  .episode-copy { display: none; }
}
@media (max-width: 360px) { .episode-list { grid-template-columns: repeat(4, minmax(0, 1fr)); } .player-toolbar button { gap: 5px; padding: 8px; } .player-toolbar button > svg { width: 17px; height: 17px; } }
@media (max-height: 500px) and (orientation: landscape) {
  .player-backdrop { padding: 0;  background: rgb(0 0 0 / .58); }
  .player-window { width: 100%; height: 100dvh; border-radius: 0;  box-shadow: var(--glass-highlight-inner), 0 28px 90px rgb(0 0 0 / .4); }
  .player-header { min-height: 62px; padding-top: 8px; padding-bottom: 8px; }
  .player-layout { display: grid; grid-template-columns: minmax(0, 1fr) 250px; overflow: hidden; }
  .video-column { overflow-y: auto; padding: 12px; }
  .video-stage { min-height: 200px;  border: var(--glass-border); }
  .episode-panel { min-height: 0; margin: 12px 12px 12px 0; overflow: hidden; }
  .episode-list { grid-template-columns: repeat(3, minmax(0, 1fr)); overflow-y: auto; gap: 9px; padding: 7px 14px 14px; }
  .episode-item { min-height: 52px; grid-template-columns: 1fr; padding: 0;  background: transparent;  box-shadow: none; }
  .episode-number { width: 100%; height: 52px; border: 0; }
  .episode-copy { display: none; }
}
@media (prefers-reduced-motion: reduce) { .player-backdrop, .loading-wave i, .playback-starting-pill svg, .setting-switch span, .setting-switch::before { transition: none; animation: none; } }
</style>
