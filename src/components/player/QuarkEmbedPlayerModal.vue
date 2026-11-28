<script setup lang="ts">
import type Hls from 'hls.js';
import DanmakuControls from './DanmakuControls.vue';
import MobilePlaybackControls from './MobilePlaybackControls.vue';
import { playbackHealth } from '../../services/playbackHealth';
import { audioTrackChannelLabel, configureVideoRequest, describeNativeAudioTracks, enableOnlyAudioTrack,
  findStereoAudioTrack, getNativeAudioTracks, playbackSourceLabel, selectInitialPlaybackSource } from '../../services/playbackSource';
import SubtitleControls from './SubtitleControls.vue';
import { PlayerPreferencesService } from '../../services/playerPreferencesService';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { ArrowLeft, Check, ChevronDown, CircleAlert, ListVideo, LoaderCircle, Play, RefreshCw, SlidersHorizontal, X } from '@lucide/vue';
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
import { useMobileLandscape } from '../../composables/useMobileLandscape';
import { usePlayerFullscreen, type NativeFullscreenVideo } from '../../composables/usePlayerFullscreen';
import { usePlaybackChrome } from '../../composables/usePlaybackChrome';
import { PlaybackHistoryService } from '../../services/playbackHistoryService';
import { playbackCoverage } from '../../services/playbackCoverage';
import { chooseOfficialProgress, confirmedEpisodeTitles, readOfficialProgress } from '../../services/officialProgress';
import { seasonQuery } from '../../../server/searchTitles.js';
import type { OfficialWorkProgress } from '../../types/search';
import { libraryPlaybackSelection } from '../../services/libraryPlaybackSelection';

const props = defineProps<{
  isOpen: boolean;
  username?: string;
  media: MediaItem | null;
  historyEntry?: PlaybackHistoryEntry | null;
  requestedEpisode?: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 're-search', media: MediaItem): void;
  (e: 'open-auth-settings'): void;
  (e: 'history-updated', entry: PlaybackHistoryEntry, username?: string): void;
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
const playerWindowRef = ref<HTMLElement | null>(null);
const danmakuControls = ref<InstanceType<typeof DanmakuControls> | null>(null);
const hlsRef = shallowRef<Hls | null>(null);
const phase = ref<PlayerPhase>('idle');
const session = ref<QuarkPlaybackSession | null>(null);
const officialWork = ref<OfficialWorkProgress>();
const episodeTitles = ref<Record<number, string>>({});
let coverageController: AbortController | undefined;
watch([() => props.isOpen, () => props.media?.quarkFid, () => props.media?.title, () => props.media?.year, () => props.media?.category], async ([open]) => {
  coverageController?.abort(); officialWork.value = undefined; episodeTitles.value = {};
  const media = props.media;
  if (!open || !media || media.category !== 'tv') return;
  const controller = new AbortController(); coverageController = controller;
  const data = await readOfficialProgress(media.title, media.category, controller.signal, true);
  if (controller.signal.aborted) return;
  officialWork.value = chooseOfficialProgress(data, media.title, media.category, [], media.year);
  episodeTitles.value = confirmedEpisodeTitles(data, officialWork.value, media.title);
}, { immediate: true });
onBeforeUnmount(() => coverageController?.abort());
const playback = ref<PreparedPlayback | null>(null);
const currentEpisodeIndex = ref(0);
const episodeGroupIndex = ref(0);
const settingsExpanded = ref(false);
const settingsPanelRef = ref<HTMLElement | null>(null);
const episodeSheetOpen = ref(false);
const controlsLocked = ref(false);
const episodesDescending = ref(false);
const settingsToggleRef = ref<HTMLButtonElement | null>(null);
const episodePanelRef = ref<HTMLElement | null>(null);
const selectedSourceId = ref('');
const stereoStream = shallowRef<PlaybackSource | null>(null);
let stereoProbe: AbortController | undefined;
let stereoShouldPlay = false;
let originalAudioEpisode = '';
const stereoCheckTimeoutMs = 5400;
let nextPlayback: {
  sessionId: string;
  fid: string;
  expires: number;
  prepared: Promise<PreparedPlayback>;
  stereo?: { sourceId: string; pending: Promise<PlaybackSource> };
} | undefined;
const errorMessage = ref('');
const statusMessage = ref('');
const playbackStarting = ref(false);
const videoAspectRatio = ref(16 / 9);
const pictureFit = ref<'contain' | 'cover'>('contain');
const brightness = ref(1);
const prolongedBuffering = ref(false);
const interruptionPosition = ref(0);
let playbackWatchdog: number | null = null;
let fullscreenNoticeRevealed = false;
const manualPlayRequired = ref(false);
const playbackHasStarted = ref(false);
const detectedAudioTracks = ref<PlaybackAudioTrack[]>([]);
const selectedAudioIndex = ref(-1);
const checkingCompatibleAudio = ref(false);
const compatibleAudioError = ref('');
const playbackAutomationStorageKey = `misty_rain_playback_automation:${encodeURIComponent(props.username || 'guest')}`;
const savingPreferences = ref(false);
const preferencesError = ref('');
const preferencesSaved = ref(false);
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
      introSeconds: Number.isFinite(saved.introSeconds) ? Math.max(0, Math.min(600, Math.trunc(Number(saved.introSeconds)))) : 90,
      outroSeconds: Number.isFinite(saved.outroSeconds) ? Math.max(0, Math.min(600, Math.trunc(Number(saved.outroSeconds)))) : 90
    };
  } catch {
    return { ...defaultPlaybackAutomation };
  }
};
const playbackAutomation = ref<PlaybackAutomationSettings>(loadPlaybackAutomation());
const isIOSPlaybackDevice = typeof navigator !== 'undefined'
  && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const nativeHlsSupported = typeof document !== 'undefined'
  && Boolean(document.createElement('video').canPlayType('application/vnd.apple.mpegurl'));
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
let hlsMediaRecoveryCount = 0;
let nativeAudioObserver: AbortController | undefined;
let nativeAudioManuallySelected = false;
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
  && (window.matchMedia('(max-width: 820px), (max-height: 600px) and (pointer: coarse)').matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
const { fullscreen, notice: fullscreenNotice, toggleFullscreen, exitFullscreen } =
  usePlayerFullscreen(() => playerWindowRef.value, () => videoRef.value, () => props.isOpen);
const { immersive, immersiveStyle, landscape, toggleWebFullscreen, resetLandscape } = useMobileLandscape(isMobilePlaybackDevice, () => props.isOpen, () => fullscreen.value);
watch(() => props.isOpen, open => { if (!open) brightness.value = 1; });
let fullscreenRequestPending = false;
const toggleImmersivePlayback = async () => {
  if (fullscreenRequestPending) return;
  if (fullscreen.value) { await exitFullscreen(); return; }
  if (isMobilePlaybackDevice || immersive.value || !document.fullscreenEnabled || !playerWindowRef.value?.requestFullscreen) {
    toggleWebFullscreen();
    return;
  }
  fullscreenRequestPending = true;
  try { await toggleFullscreen(); } finally { fullscreenRequestPending = false; }
  if (!fullscreen.value && props.isOpen && !immersive.value) {
    fullscreenNotice.value = '';
    toggleWebFullscreen();
  }
};
usePlaybackChrome(() => props.isOpen && immersive.value);

const soundEffectOptions: SoundEffectOption[] = [
  { value: 'original', label: '原声', hint: '不做处理' },
  { value: 'dialogue', label: '对白增强', hint: '突出人声' },
  { value: 'cinema', label: '影院', hint: '增强低频与细节' },
  { value: 'night', label: '夜间', hint: '平衡音量起伏' }
];

const episodes = computed(() => session.value?.episodes || []);
const currentEpisode = computed(() => episodes.value[currentEpisodeIndex.value] || null);
const episodeGroupSize = 50;
const orderedEpisodeEntries = computed(() => episodes.value.map((episode, index) => ({ episode, index }))
  .sort((a, b) => (episodesDescending.value ? -1 : 1) * ((a.episode.episodeNumber - b.episode.episodeNumber) || a.episode.episodeTitle.localeCompare(b.episode.episodeTitle, 'zh-CN', { numeric: true }))));
const groupForEpisode = (index: number) => Math.max(0, Math.floor(orderedEpisodeEntries.value.findIndex(entry => entry.index === index) / episodeGroupSize));
watch(episodesDescending, () => { episodeGroupIndex.value = groupForEpisode(currentEpisodeIndex.value); });
const episodeGroups = computed(() => {
  const groups: Array<{ start: number; end: number; label: string }> = [];
  for (let start = 0; start < episodes.value.length; start += episodeGroupSize) {
    const end = Math.min(episodes.value.length, start + episodeGroupSize);
    const first = orderedEpisodeEntries.value[start]?.episode;
    const last = orderedEpisodeEntries.value[end - 1]?.episode;
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
  return orderedEpisodeEntries.value.slice(group.start, group.end).map(entry => ({
    ...entry, isLatest: entry.index === latestEpisodeIndex.value
  }));
});
const episodeBadgeLabel = (episode: { episodeNumber?: number; episodeTitle?: string; fileName?: string }, index: number) => {
  if (episode.episodeNumber && episode.episodeNumber > 0) return String(episode.episodeNumber);
  const title = (episode.episodeTitle || episode.fileName || '').trim();
  const specialMatch = title.match(/(?:特别篇|番外篇?|预告片?|剧场版|彩蛋|花絮|前传|后传|上[集篇册]?|中[集篇册]?|下[集篇册]?|SP\d*|OVA\d*)/i);
  if (specialMatch) return specialMatch[0].slice(0, 3);
  const numMatch = title.match(/\d{1,4}/);
  if (numMatch) return numMatch[0];
  if (episodes.value.length === 1) return '正片';
  return String(index + 1);
};
const sources = computed(() => playback.value?.sources || []);
const selectedSource = computed(() => stereoStream.value?.id === selectedSourceId.value ? stereoStream.value
  : sources.value.find(source => source.id === selectedSourceId.value) || sources.value[0]);
const sourceAllowsSoundEffects = computed(() => soundEffectAvailable.value && selectedSource.value?.delivery !== 'direct');
const compatibleSource = computed(() => selectInitialPlaybackSource(
  sources.value.flatMap(source => {
    if (source.delivery === 'proxy' && source.resolution !== 'original') return [source];
    if (source.isHls && source.proxyUrl) return [{ ...source, delivery: 'proxy' as const, url: source.proxyUrl }];
    return [];
  }),
  { mobile: true, respectPreference: false }
));
const audioTracks = computed(() => detectedAudioTracks.value.length
  ? detectedAudioTracks.value
  : (selectedSource.value?.audioTracks || playback.value?.audioTracks || []));
const audioSwitchable = computed(() => detectedAudioTracks.value.length > 1);
const canTryCompatibleAudio = computed(() => selectedSource.value?.delivery === 'direct' && !audioSwitchable.value
  && (isIOSPlaybackDevice || Boolean(videoRef.value && getNativeAudioTracks(videoRef.value))));
const audioChannelLabel = computed(() => selectedSource.value?.singleStereo ? '立体声'
  : audioTrackChannelLabel(detectedAudioTracks.value[selectedAudioIndex.value]?.channels || ''));
const selectedSoundEffect = computed(() => soundEffectOptions.find(option => option.value === soundEffectMode.value));
const libraryCoverage = computed(() => playbackCoverage(episodes.value, props.media?.category, officialWork.value?.latestEpisode));
const episodeStatus = computed(() => {
  const episode = currentEpisode.value;
  if (!episode) return episodes.value.length ? `片库 ${libraryCoverage.value.count} 集` : '';
  const season = episode.seasonNumber || 0;
  const matchesSeason = !season || season === (seasonQuery(props.media?.title || '')?.number || 1);
  const title = matchesSeason ? episodeTitles.value[episode.episodeNumber] : '';
  return title ? `${episode.episodeTitle} · ${title}` : episode.episodeTitle;
});
const loadingTitle = computed(() => phase.value === 'resolving'
  ? '正在载入片库'
  : `正在准备${currentEpisode.value?.episodeTitle || '当前剧集'}`);
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
  const parts = [playbackSourceLabel(source)];
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
  nativeAudioObserver?.abort();
  nativeAudioObserver = undefined;
  nativeAudioManuallySelected = false;
  if (hlsNetworkRetryTimer !== null) {
    window.clearTimeout(hlsNetworkRetryTimer);
    hlsNetworkRetryTimer = null;
  }
  hlsNetworkRetryCount = 0;
  hlsMediaRecoveryCount = 0;
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
  prolongedBuffering.value = false;
  fullscreenNoticeRevealed = false;
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
  stereoProbe?.abort();
  stereoStream.value = null;
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

const observeNativeAudioTracks = (video: HTMLVideoElement, source: PlaybackSource) => {
  const tracks = getNativeAudioTracks(video);
  if (!tracks) return;
  const controller = new AbortController();
  nativeAudioObserver = controller;
  const options = { signal: controller.signal };
  const sync = (selectDefault: boolean) => {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const detected = describeNativeAudioTracks(tracks, source.audioTracks || []);
    const current = Array.from(tracks).findIndex(track => track.enabled);
    if (selectDefault && (isIOSPlaybackDevice || source.audioCompatibility) && !nativeAudioManuallySelected && detected.length > 1) {
      const stereo = findStereoAudioTrack(detected, current);
      if (stereo >= 0) enableOnlyAudioTrack(tracks, stereo);
    }
    detectedAudioTracks.value = detected;
    selectedAudioIndex.value = Array.from(tracks).findIndex(track => track.enabled);
  };
  video.addEventListener('loadedmetadata', () => sync(true), options);
  tracks.addEventListener('addtrack', () => sync(true), options);
  tracks.addEventListener('removetrack', () => sync(false), options);
  tracks.addEventListener('change', () => sync(false), options);
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
  if (!video || !sourceAllowsSoundEffects.value) return false;
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
  if (!sourceAllowsSoundEffects.value) return;
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
  void revealPlaybackNotice();
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
  lastPlaybackProgressAt = Date.now();
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

const checkPlaybackStereo = (source: PlaybackSource, signal: AbortSignal, sessionId?: string, episodeFid?: string) =>
  QuarkStreamService.singleStereoSource(source, signal, isIOSPlaybackDevice && sessionId && episodeFid
    ? { sessionId, episodeFid, nativeHls: nativeHlsSupported }
    : undefined);

const attachSource = async (
  source: PlaybackSource,
  resumeAt = 0,
  shouldPlay = false,
  applyIntroSkip = false,
  checkStereo = true,
  warmedStereo?: Promise<PlaybackSource>
) => {
  const attachSequence = ++sourceAttachSequence;
  stereoProbe?.abort();
  if (checkStereo && originalAudioEpisode !== currentEpisode.value?.fid && !source.singleStereo && !source.isHls && source.mimeType === 'video/mp4'
    && (isIOSPlaybackDevice || source.audioCompatibility)) {
    stereoProbe = new AbortController();
    const controller = stereoProbe;
    if (shouldPlay && !playbackHasStarted.value) playbackStarting.value = true;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(stereoCheckTimeoutMs)]);
    const warmed = await warmedStereo;
    if (attachSequence !== sourceAttachSequence || !props.isOpen) return;
    // A failed preflight must not lock the next episode to its original audio.
    source = warmed?.singleStereo ? warmed : await checkPlaybackStereo(source, signal, session.value?.sessionId, currentEpisode.value?.fid);
    if (attachSequence !== sourceAttachSequence || !props.isOpen) return;
  }
  stereoStream.value = source.singleStereo ? source : null;
  stereoShouldPlay = shouldPlay;
  if (source.delivery === 'direct') {
    // 跨域媒体接入 Web Audio 会输出静音。已有音频节点无法从媒体元素解绑，
    // 从中转音效切换直连时必须更换元素，而不只是 disconnect。
    soundEffectMode.value = 'original';
    if (audioContext || mediaAudioSource) {
      videoRef.value?.pause();
      destroyPlaybackEngine();
      resetSoundEffectGraph(true);
    }
  }
  await nextTick();
  const video = videoRef.value;
  if (!video || attachSequence !== sourceAttachSequence || !props.isOpen) return;
  playAttemptSequence += 1;
  destroyPlaybackEngine();
  video.pause();
  video.removeAttribute('src');
  configureVideoRequest(video, source);
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
    if (source.delivery === 'direct') throw new Error('当前浏览器无法原生播放此视频，请使用兼容画质');
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
        if (!data.fatal || attachSequence !== sourceAttachSequence || phase.value !== 'ready') return;
        if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR) {
          if (hlsNetworkRetryTimer !== null) return;
          if (hlsNetworkRetryCount < 3) {
            const retryDelays = [600, 1_500, 3_000];
            const retryDelay = retryDelays[hlsNetworkRetryCount++] ?? 3_000;
            hlsNetworkRetryTimer = window.setTimeout(() => {
              hlsNetworkRetryTimer = null;
              if (attachSequence === sourceAttachSequence && hlsRef.value === hls && phase.value === 'ready') hls.startLoad();
            }, retryDelay);
            return;
          }
          interruptPlayback('网络连接中断，请检查网络后重新连接，继续从当前进度播放');
          return;
        }
        if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR) {
          if (hlsMediaRecoveryCount++ === 0) hls.recoverMediaError();
          else interruptPlayback('视频解码中断，请重新连接后继续播放');
          return;
        }
        interruptPlayback('视频流中断，请重新连接当前剧集');
      });
      hls.attachMedia(video);
      return;
    }
  }

  observeNativeAudioTracks(video, source);
  video.src = source.url;
  video.load();
  seekAndMaybePlay(resumeAt, shouldPlay, attachSequence, applyIntroSkip);
};

const chooseInitialSource = (available: PlaybackSource[]) => {
  return selectInitialPlaybackSource(available, {
    preferred: localStorage.getItem('misty_rain_player_quality') || '',
    preferredDelivery: localStorage.getItem('misty_rain_player_delivery') || '',
    mobile: isMobilePlaybackDevice,
    preferNativeHls: nativeHlsSupported,
    respectPreference: !isMobilePlaybackDevice || mobileQualityManuallySelected
  });
};

const warmNextPlayback = () => {
  const active = session.value;
  const next = active?.episodes[nextEpisodeIndex()];
  if (!active || !next || !props.media?.quarkFid || !isIOSPlaybackDevice || selectedSource.value?.mimeType !== 'video/mp4') return;
  if (nextPlayback?.sessionId === active.sessionId && nextPlayback.fid === next.fid && nextPlayback.expires > Date.now()) return;
  // Drive sessions reference already-saved files. Share sessions can transfer files during preparation.
  const prepared = QuarkStreamService.prepareEpisode(active.sessionId, next.fid, { nativeHls: nativeHlsSupported });
  const warm: NonNullable<typeof nextPlayback> = { sessionId: active.sessionId, fid: next.fid, expires: Date.now() + 120_000, prepared };
  nextPlayback = warm;
  void prepared.then(result => {
    if (nextPlayback !== warm || !props.isOpen || !playbackAutomation.value.autoNext) return;
    const chosen = chooseInitialSource(result.sources);
    if (chosen) warm.stereo = { sourceId: chosen.id, pending: checkPlaybackStereo(chosen,
      AbortSignal.timeout(stereoCheckTimeoutMs), active.sessionId, next.fid) };
  }).catch(() => { /* Normal playback retries a failed preparation when the episode is opened. */ });
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
    playbackSessionId: session.value?.sessionId,
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
      emit('history-updated', entry, props.username);
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
  if (video && !video.paused && phase.value === 'ready' && automation.autoNext && video.currentTime > 0) {
    const skip = automation.skipIntroOutro && video.duration > automation.introSeconds + automation.outroSeconds + 60;
    const untilNext = video.duration - video.currentTime - (skip ? automation.outroSeconds : 0);
    if (untilNext > 0 && untilNext <= 15) warmNextPlayback();
  }
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
  clearBufferingIndicator();
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
  if (phase.value !== 'ready') { video?.pause(); return; }
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
  // canplay only describes buffered data, not an advancing playback clock.
  if (videoRef.value && !videoRef.value.paused && !videoRef.value.seeking) monitorPlayback();
};

const handleMetadata = () => {
  const video = videoRef.value;
  if (video?.videoWidth && video.videoHeight) videoAspectRatio.value = video.videoWidth / video.videoHeight;
};

const handleSeeking = () => {
  lastPlaybackProgressAt = Date.now();
  lastPlaybackPosition = videoRef.value?.currentTime || 0;
  clearBufferingIndicator();
};

const revealPlaybackNotice = async () => {
  const video = videoRef.value as NativeFullscreenVideo | null;
  try {
    if (video?.webkitDisplayingFullscreen) video.webkitExitFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // The user can still exit with the native fullscreen control.
  }
};

const interruptPlayback = (message: string) => {
  const video = videoRef.value;
  interruptionPosition.value = video && Number.isFinite(video.currentTime) && video.currentTime > 0
    ? video.currentTime : Math.max(interruptionPosition.value, lastPlaybackPosition);
  phase.value = 'error';
  playAttemptSequence += 1;
  errorMessage.value = message;
  playbackStarting.value = false;
  manualPlayRequired.value = false;
  clearBufferingIndicator(false);
  video?.pause();
  hlsRef.value?.stopLoad();
  void persistProgress(true);
  void revealPlaybackNotice();
  announce(message);
};

const monitorPlayback = () => {
  const video = videoRef.value;
  const active = Boolean(props.isOpen && phase.value === 'ready' && video && !video.ended
    && document.visibilityState === 'visible' && !manualPlayRequired.value
    && (!video.paused || playbackStarting.value));
  if (!active || !video) {
    lastPlaybackProgressAt = Date.now();
    return;
  }
  const now = Date.now();
  if (Math.abs(video.currentTime - lastPlaybackPosition) > .05) {
    lastPlaybackPosition = video.currentTime;
    lastPlaybackProgressAt = now;
    interruptionPosition.value = video.currentTime;
    clearBufferingIndicator();
    return;
  }
  if (!lastPlaybackProgressAt) lastPlaybackProgressAt = now;
  const health = playbackHealth({ active, elapsedMs: now - lastPlaybackProgressAt });
  if (health === 'interrupted') {
    interruptPlayback(navigator.onLine
      ? '播放已中断，请重新连接，继续从当前进度播放'
      : '网络已断开，请恢复网络后重新连接');
    return;
  }
  if (health === 'buffering' || health === 'stalled') playbackStarting.value = true;
  prolongedBuffering.value = health === 'stalled';
  if (prolongedBuffering.value && !fullscreenNoticeRevealed) {
    fullscreenNoticeRevealed = true;
    void revealPlaybackNotice();
  }
};

const handleVideoError = () => {
  if (phase.value !== 'ready') return;
  if (stereoStream.value && videoRef.value?.error) {
    const original = sources.value.find(source => source.id === stereoStream.value?.id);
    stereoStream.value = null;
    if (original) {
      const resumeAt = videoRef.value.currentTime || lastPlaybackPosition;
      const shouldPlay = !videoRef.value.paused || (stereoShouldPlay && !playbackHasStarted.value);
      void attachSource(original, resumeAt, shouldPlay, false, false);
      return;
    }
  }
  if (selectedSource.value?.resolution === 'original' && videoRef.value?.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    interruptPlayback('当前设备不支持此原画格式，请在播放设置中选择其他画质');
    return;
  }
  interruptPlayback(videoRef.value?.error?.code === MediaError.MEDIA_ERR_NETWORK
    ? '视频连接中断，请检查网络后重新连接'
    : '当前视频无法继续播放，请重新连接后重试');
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
  interruptionPosition.value = resumeAt;
  if (currentEpisodeIndex.value !== index || !playback.value) {
    videoAspectRatio.value = 16 / 9;
    pictureFit.value = 'contain';
  }
  const sequence = ++requestSequence;
  introSkipped = false;
  episodeCompletionHandled = false;
  currentEpisodeIndex.value = index;
  episodeGroupIndex.value = groupForEpisode(index);
  phase.value = 'preparing';
  playback.value = null;
  selectedSourceId.value = '';
  compatibleAudioError.value = '';
  errorMessage.value = '';
  stopVideo();
  announce(`正在准备${episode.episodeTitle}`);

  try {
    const load = () => QuarkStreamService.prepareEpisode(activeSession.sessionId, episode.fid, { nativeHls: nativeHlsSupported });
    const warm = nextPlayback;
    nextPlayback = undefined;
    const result = warm?.sessionId === activeSession.sessionId && warm.fid === episode.fid && warm.expires > Date.now()
      ? await warm.prepared.catch(load) : await load();
    if (sequence !== requestSequence || !props.isOpen) return;
    playback.value = result;
    const initialSource = chooseInitialSource(result.sources);
    if (!initialSource) throw new Error('当前剧集没有可播放画质');
    selectedSourceId.value = initialSource.id;
    phase.value = 'ready';
    announce(`${episode.episodeTitle}已就绪，可用画质 ${result.sources.map(item => item.label).join('、')}`);
    if (result.transferred) toast.show(`已按需转存《${episode.fileName}》到烟雨影视目录`, '✓', 3200);
    const warmedStereo = warm?.stereo?.sourceId === initialSource.id ? warm.stereo.pending : undefined;
    await attachSource(initialSource, resumeAt, true, true, true, warmedStereo);
    if (resumeAt > 3) announce(`已续播${episode.episodeTitle} ${Math.floor(resumeAt / 60)} 分钟处`);
  } catch (error) {
    if (sequence === requestSequence) handleServiceError(error);
  }
};

const savePreferences = async () => {
  savingPreferences.value = true;
  preferencesError.value = '';
  preferencesSaved.value = false;
  try { await PlayerPreferencesService.save({ ...playbackAutomation.value }); preferencesSaved.value = true; }
  catch (error) { preferencesError.value = error instanceof Error ? error.message : '播放偏好保存失败'; }
  finally { savingPreferences.value = false; }
};
const updateSkipDuration = (field: 'introSeconds' | 'outroSeconds', event: Event) => {
  const seconds = (event.target as HTMLInputElement).valueAsNumber;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 600) {
    preferencesError.value = '请输入0～600之间的整数秒数'; return;
  }
  playbackAutomation.value[field] = seconds;
  introSkipped = (videoRef.value?.currentTime || 0) >= playbackAutomation.value.introSeconds;
  void savePreferences();
};

const toggleSkipIntroOutro = () => {
  playbackAutomation.value.skipIntroOutro = !playbackAutomation.value.skipIntroOutro;
  void savePreferences();
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
    ? `已开启跳过片头片尾，片头 ${playbackAutomation.value.introSeconds} 秒、片尾 ${playbackAutomation.value.outroSeconds} 秒`
    : '已关闭跳过片头片尾');
};

const toggleAutoNext = () => {
  playbackAutomation.value.autoNext = !playbackAutomation.value.autoNext;
  void savePreferences();
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
  originalAudioEpisode = '';
  nextPlayback = undefined;
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
    const preferences = await PlayerPreferencesService.get().catch(() => {
      preferencesError.value = '播放偏好读取失败，当前使用本机已保存的设置';
      return playbackAutomation.value;
    });
    if (sequence !== requestSequence) return;
    playbackAutomation.value = preferences;
    const result = await QuarkStreamService.createPlaybackSession({
      quarkFid: media.quarkFid,
      shareUrl,
      title: media.title,
      passcode: media.quarkPasscode
    });
    if (sequence !== requestSequence || !props.isOpen) return;
    session.value = result;
    announce(`已读取 ${result.episodes.length} 个视频文件`);
    const selected = libraryPlaybackSelection(result.episodes, props.historyEntry, props.requestedEpisode, orderedEpisodeEntries.value[0]?.index || 0);
    await prepareEpisode(selected.index, selected.position);
  } catch (error) {
    if (sequence === requestSequence) handleServiceError(error);
  }
};

const changeQuality = async (source: PlaybackSource) => {
  const video = videoRef.value;
  const resumeAt = video?.currentTime || 0;
  const shouldPlay = Boolean(video && !video.paused);
  selectedSourceId.value = source.id;
  compatibleAudioError.value = '';
  if (!source.audioCompatibility) {
    mobileQualityManuallySelected = true;
    localStorage.setItem('misty_rain_player_quality', source.resolution);
    if (source.delivery) localStorage.setItem('misty_rain_player_delivery', source.delivery);
    else localStorage.removeItem('misty_rain_player_delivery');
  }
  announce(`已切换到${playbackSourceLabel(source)}`);
  await attachSource(source, resumeAt, shouldPlay);
};

const tryCompatibleAudio = async () => {
  const activeSession = session.value;
  const episode = currentEpisode.value;
  const activePlayback = playback.value;
  const original = selectedSource.value;
  if (checkingCompatibleAudio.value || !canTryCompatibleAudio.value || !activeSession || !episode || !activePlayback || !original) return;
  checkingCompatibleAudio.value = true;
  originalAudioEpisode = '';
  compatibleAudioError.value = '';
  const isCurrent = () => props.isOpen && phase.value === 'ready' && playback.value === activePlayback && selectedSourceId.value === original.id;
  try {
    let alternatives = activePlayback.sources.filter(source => source.audioCompatibility);
    if (!alternatives.length) {
      const result = await QuarkStreamService.prepareEpisode(activeSession.sessionId, episode.fid, {
        nativeHls: nativeHlsSupported,
        audioCompatibility: true
      });
      alternatives = result.sources.filter(source => source.audioCompatibility);
    }
    if (!isCurrent()) return;
    const source = alternatives.find(item => item.resolution === original.resolution)
      || selectInitialPlaybackSource(alternatives, { mobile: isMobilePlaybackDevice, respectPreference: false });
    if (!source) {
      compatibleAudioError.value = '当前剧集暂未找到兼容的立体声音轨';
      return;
    }
    if (!activePlayback.sources.some(item => item.id === source.id)) activePlayback.sources.push(...alternatives);
    await changeQuality(source);
  } catch (error) {
    if (isCurrent()) compatibleAudioError.value = error instanceof QuarkServiceError && error.code === 'QUARK_STEREO_UNAVAILABLE'
      ? error.message : '暂时无法读取兼容音频，请稍后重试';
  } finally {
    checkingCompatibleAudio.value = false;
  }
};

const useOriginalAudio = () => {
  const original = sources.value.find(source => source.id === stereoStream.value?.id);
  const video = videoRef.value;
  if (!original || !video || !currentEpisode.value) return;
  originalAudioEpisode = currentEpisode.value.fid;
  void attachSource(original, video.currentTime, !video.paused, false, false);
};

const useCompatibleSource = async () => {
  const source = compatibleSource.value;
  if (!source) return;
  if (playback.value) playback.value.sources = playback.value.sources.map(item => item.id === source.id ? source : item);
  selectedSourceId.value = source.id;
  errorMessage.value = '';
  phase.value = 'ready';
  await attachSource(source, interruptionPosition.value, true);
};

const selectAudioTrack = (index: number) => {
  const hls = hlsRef.value;
  if (hls && index >= 0 && index < hls.audioTracks.length) {
    hls.audioTrack = index;
    selectedAudioIndex.value = index;
    announce(`已切换到${audioTracks.value[index]?.label || `音轨 ${index + 1}`}`);
    return;
  }

  const nativeTracks = videoRef.value && getNativeAudioTracks(videoRef.value);
  if (nativeTracks && enableOnlyAudioTrack(nativeTracks, index)) {
    nativeAudioManuallySelected = true;
    selectedAudioIndex.value = index;
    announce(`已切换到${audioTrackChannelLabel(audioTracks.value[index]?.channels || '') || audioTracks.value[index]?.label || '所选音轨'}`);
  }
};

const selectEpisodeGroup = (index: number) => {
  episodeGroupIndex.value = index;
  nextTick(() => episodePanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
};



const collapseSettings = async () => {
  settingsExpanded.value = false;
  await nextTick();
  settingsToggleRef.value?.focus({ preventScroll: true });
};

const selectEpisode = async (index: number) => {
  episodeSheetOpen.value = false;
  await prepareEpisode(index);
  if (phase.value !== 'ready') return;
  videoRef.value?.parentElement?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start'
  });
};

const retry = () => {
  if (session.value && currentEpisode.value) {
    const video = videoRef.value;
    const resumeAt = video && Number.isFinite(video.currentTime) && video.currentTime > 0
      ? video.currentTime : interruptionPosition.value;
    void prepareEpisode(currentEpisodeIndex.value, resumeAt);
  }
  else loadSession();
};

const close = () => {
  void exitFullscreen();
  resetLandscape();
  void persistProgress(true, false, true);
  phase.value = 'idle';
  requestSequence += 1;
  stopVideo(true);
  resetSoundEffectGraph(true);
  emit('close');
};

const openEpisodeSheet = () => {
  episodeGroupIndex.value = groupForEpisode(currentEpisodeIndex.value);
  if (!immersive.value) {
    void nextTick(() => {
      const el = episodePanelRef.value;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const active = el.querySelector<HTMLElement>('.episode-item.active');
        active?.focus({ preventScroll: true });
      }
    });
    return;
  }
  episodeSheetOpen.value = true;
};
const dismissLayer = () => {
  if (settingsExpanded.value) { settingsExpanded.value = false; return true; }
  if (episodeSheetOpen.value) { episodeSheetOpen.value = false; return true; }
  if (fullscreen.value) { void exitFullscreen(); return true; }
  if (immersive.value) { toggleWebFullscreen(); return true; }
  return false;
};
const back = () => { if (!dismissLayer()) close(); };
useDialog(settingsPanelRef, () => settingsExpanded.value && phase.value === 'ready', () => { settingsExpanded.value = false; });
useDialog(episodePanelRef, () => episodeSheetOpen.value, () => { episodeSheetOpen.value = false; });
const dialogRef = ref<HTMLElement | null>(null);
useDialog(dialogRef, () => props.isOpen, () => {
  if (dismissLayer()) return;
  if (document.fullscreenElement || (videoRef.value as NativeFullscreenVideo | null)?.webkitDisplayingFullscreen) return;
  close();
});

watch(
  [() => props.isOpen, () => props.media?.id, () => props.requestedEpisode],
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
  try { localStorage.setItem(playbackAutomationStorageKey, JSON.stringify(value)); } catch { /* Server preferences remain available. */ }
}, { deep: true });

onBeforeUnmount(() => {
  nextPlayback = undefined;
  if (playbackWatchdog !== null) window.clearInterval(playbackWatchdog);
  void persistProgress(true, false, true);
  phase.value = 'idle';
  stopVideo(true);
  resetSoundEffectGraph();
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('pageshow', handlePageShow);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

onMounted(() => {
  playbackWatchdog = window.setInterval(monitorPlayback, 1_000);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

defineExpose({ retry, dismissLayer });
</script>

<template>
  <div
    class="player-backdrop"
    ref="dialogRef"
    :class="{ active: isOpen, 'landscape-inline': immersive, 'mobile-player': isMobilePlaybackDevice }"
    :style="immersiveStyle"
    role="dialog"
    aria-modal="true"
    :aria-label="media ? `播放《${media.title}》` : '视频播放器'"
    @click.self="close"
  >
    <section v-if="media" ref="playerWindowRef" class="player-window" :class="{ 'immersive-window': immersive }">
      <header v-show="!controlsLocked" class="player-header">
        <div class="title-block">
          <button class="icon-button player-back-button" type="button" aria-label="返回上一页" @click="back"><ArrowLeft /></button>
          <div class="title-copy">
            <h2>{{ media.title }}</h2>
            <p v-if="episodeStatus" :title="episodeStatus">{{ episodeStatus }}</p>
          </div>
        </div>

        <div class="header-actions">
          <button class="text-action" type="button" @click="emit('re-search', media)">
            其他版本
          </button>

        </div>
      </header>

      <div v-if="settingsExpanded || episodeSheetOpen" class="player-sheet-shade" @click="settingsExpanded = false; episodeSheetOpen = false"></div>
      <div class="player-layout" :class="{ 'single-column': !episodes.length }" :style="{ '--video-ratio': videoAspectRatio }">
        <main class="video-column">
          <div class="video-stage">
            <video
              :key="videoInstanceKey"
              ref="videoRef"
              class="video-element"
              :style="{ objectFit: pictureFit }"
              :controls="false"
              tabindex="0"
              aria-label="视频画面，可使用空格暂停，方向键调整进度"
              controlslist="nodownload noremoteplayback"
              playsinline
              :preload="isIOSPlaybackDevice ? 'auto' : 'metadata'"
              :poster="isMobilePlaybackDevice ? undefined : media.poster"
              @play="resumeSoundEffect"
              @volumechange="handleVolumeChange"
              @playing="handlePlaying"
              @waiting="handleWaiting"
              @stalled="handleWaiting"
              @loadedmetadata="handleMetadata"
              @resize="handleMetadata"
              @seeking="handleSeeking"
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
                :srclang="subtitle.language || 'und'"
                :data-subtitle-origin="subtitle.origin || 'source'"
                :src="subtitle.url"
              />
            </video>
            <div
              v-if="brightness < 1"
              class="video-brightness-veil"
              :style="{ opacity: Math.min(0.85, Math.max(0, 1 - brightness)) }"
              aria-hidden="true"
            />

            <MobilePlaybackControls
              v-if="videoRef && phase === 'ready' && !manualPlayRequired"
              :video="videoRef" :loading="playbackStarting" :hls="hlsRef" :username="username" :expanded="immersive" :desktop="!isMobilePlaybackDevice" :danmaku-enabled="danmakuControls?.enabled" :has-episodes="episodes.length > 1"
              :title="media.title" :episode-title="currentEpisode ? episodeStatus : undefined" :picture-fit="pictureFit" :landscape="landscape" :brightness="brightness"
              @fullscreen="toggleImmersivePlayback" @danmaku="danmakuControls?.toggle()" @back="back" @picture-fit="pictureFit = pictureFit === 'contain' ? 'cover' : 'contain'"
              @episodes="openEpisodeSheet" @settings="settingsExpanded = true" @lock-change="controlsLocked = $event"
              @brightness="brightness = $event"
            />
            <p v-if="fullscreenNotice" class="fullscreen-notice" role="status">{{ fullscreenNotice }}</p>
            <button v-if="immersive && (phase !== 'ready' || manualPlayRequired)" class="stage-back-button icon-button" type="button" aria-label="返回播放页面" @click="back"><ArrowLeft /></button>

            <div v-if="phase === 'resolving' || phase === 'preparing'" class="stage-state loading-state" role="status" aria-live="polite">
              <img v-if="media.poster && !isMobilePlaybackDevice" class="stage-poster" :src="media.poster" alt="" aria-hidden="true" />
              <div class="loading-content">
                <span class="loading-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
                <strong>{{ loadingTitle }}</strong>
              </div>
            </div>

            <div v-else-if="phase === 'error' || phase === 'auth-required'" class="stage-state error-state" role="alert">
              <CircleAlert class="state-icon" aria-hidden="true" />
              <strong>{{ phase === 'auth-required' ? '播放认证已失效' : interruptionPosition > 0 ? '播放中断' : '暂时无法播放' }}</strong>
              <p>{{ errorMessage }}</p>
              <div class="state-actions">
                <button v-if="phase === 'auth-required'" type="button" class="primary-button" @click="emit('open-auth-settings')">
                  前往设置
                </button>
                <button type="button" class="secondary-button reload-button" @click="retry">
                  <RefreshCw aria-hidden="true" />
                  {{ interruptionPosition > 0 ? '重新连接并续播' : '重新连接' }}
                </button>
                <button
                  v-if="phase === 'error' && selectedSource?.delivery === 'direct' && compatibleSource"
                  type="button" class="secondary-button" @click="useCompatibleSource"
                >
                  换个画质试试
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
                {{ prolongedBuffering ? '网络较慢，正在等待视频…' : playbackHasStarted ? '正在缓冲…' : '正在连接视频…' }}
              </span>
              <button v-if="prolongedBuffering" type="button" class="buffer-retry" @click="retry">重新连接</button>
            </div>
          </div>

          <div v-if="phase === 'ready'" class="playback-actions">
            <DanmakuControls
              v-if="videoRef && currentEpisode && media"
              ref="danmakuControls"
              :video="videoRef"
              :input="{ mediaKey: media.id, title: media.title, category: media.category, episodeNumber: currentEpisode.episodeNumber, episodeTitle: currentEpisode.episodeTitle }"
            />
            <div v-if="sources.length" class="player-toolbar" aria-label="播放操作">
              <button
                ref="settingsToggleRef"
                type="button"
                :aria-expanded="settingsExpanded"
                aria-controls="playback-settings"
                @click="settingsExpanded = !settingsExpanded"
              >
                <SlidersHorizontal aria-hidden="true" />
                <span><strong>播放设置</strong><small>{{ selectedSource?.label || '自动' }} · {{ audioChannelLabel || selectedSoundEffect?.label || '原声' }}</small></span>
                <ChevronDown class="toolbar-chevron" aria-hidden="true" />
              </button>
              <button v-if="episodes.length > 1" type="button" @click="openEpisodeSheet">
                <ListVideo aria-hidden="true" />
                <span><strong>选集</strong></span>
              </button>
            </div>
          </div>

          <div
            v-if="phase === 'ready' && sources.length"
            v-show="settingsExpanded"
            ref="settingsPanelRef"
            role="dialog"
            aria-modal="true"
            aria-label="播放设置"
            id="playback-settings"
            class="playback-settings"
          >
            <div class="settings-panel-heading">
              <strong>播放设置</strong>
              <button class="icon-button" type="button" aria-label="收起播放设置" @click="collapseSettings"><X aria-hidden="true" /></button>
            </div>
            <div class="settings-panel-body">
            <div class="setting-group">
              <div class="setting-heading"><span>画面比例</span><small>默认完整显示，不拉伸</small></div>
              <div class="option-scroll" role="group" aria-label="画面显示方式">
                <button type="button" class="option-chip" :class="{ active: pictureFit === 'contain' }" :aria-pressed="pictureFit === 'contain'" @click="pictureFit = 'contain'">适应画面</button>
                <button type="button" class="option-chip" :class="{ active: pictureFit === 'cover' }" :aria-pressed="pictureFit === 'cover'" @click="pictureFit = 'cover'">铺满（裁切边缘）</button>
              </div>
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
                  {{ playbackSourceLabel(selectedSource?.id === source.id ? selectedSource : source) }}
                </button>
              </div>
              <p v-if="selectedSource?.delivery === 'proxy'" class="delivery-hint">当前画质经服务器加载，带宽较低时可降低画质。若有“原画直连”，可尝试切换；部分设备不支持原画格式。</p>
              <p v-else-if="selectedSource?.resolution === 'original'" class="delivery-hint">原画直接从网盘加载，播放效果取决于设备对原始视频与音频格式的支持。</p>
              <div v-if="selectedSource?.colorCompatibilityRisk" class="compatibility-actions">
                <p>这份视频转码后可能偏绿或偏紫。遇到偏色时，可换一个版本。</p>
                <button type="button" class="text-action" @click="emit('re-search', media)">查找其他版本</button>
              </div>
            </div>

            <div v-if="audioTracks.length || canTryCompatibleAudio" class="setting-group">
              <div class="setting-heading">
                <span>音频</span>
                <small>{{ audioSwitchable ? '可切换音轨' : audioTracks.length > 1 ? '当前浏览器暂不支持切换' : audioTracks.length ? '当前音轨' : '未识别到音轨信息' }}</small>
              </div>
              <div v-if="audioTracks.length" class="option-scroll" role="group" aria-label="音轨">
                <button
                  v-for="(track, index) in audioTracks"
                  :key="track.id"
                  type="button"
                  class="option-chip"
                  :class="{ active: selectedAudioIndex === index }"
                  :aria-pressed="selectedAudioIndex === index"
                  :disabled="!audioSwitchable"
                  @click="selectAudioTrack(index)"
                >
                  {{ selectedSource?.singleStereo ? '立体声' : track.label }}{{ !selectedSource?.singleStereo && audioTrackChannelLabel(track.channels) ? ` · ${audioTrackChannelLabel(track.channels)}` : '' }}
                </button>
              </div>
              <div v-if="canTryCompatibleAudio" class="compatibility-actions">
                <button type="button" class="text-action" :disabled="checkingCompatibleAudio" @click="tryCompatibleAudio">
                  {{ checkingCompatibleAudio ? '正在检查音轨…' : '试用兼容音频' }}
                </button>
                <p v-if="compatibleAudioError" role="status">{{ compatibleAudioError }}</p>
              </div>
              <div v-else-if="selectedSource?.singleStereo" class="compatibility-actions">
                <button type="button" class="text-action" @click="useOriginalAudio">使用原音轨</button>
              </div>
            </div>

            <div v-if="sourceAllowsSoundEffects" class="setting-group">
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

            <div v-if="videoRef" class="setting-group subtitle-setting-group">
              <div class="setting-heading"><span>字幕</span><small>内嵌轨道 / 资源自带字幕</small></div>
              <SubtitleControls :video="videoRef" :hls="hlsRef" :username="username" :notice="playback?.subtitleNotice" />
            </div>

            <div class="setting-group automation-setting-group">
              <div class="setting-heading">
                <span>播放偏好</span>
                <small>{{ playbackAutomationSummary }}</small>
              </div>
              <div class="automation-list">
                <div class="automation-card">
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
                    :disabled="savingPreferences"
                    @click="toggleSkipIntroOutro"
                  >
                    <span aria-hidden="true"></span>
                  </button>
                </div>

                <div class="skip-durations">
                  <label>片头时长（秒）<input type="number" min="0" max="600" step="1" :value="playbackAutomation.introSeconds" :disabled="savingPreferences" @change="updateSkipDuration('introSeconds', $event)" /></label>
                  <label>片尾时长（秒）<input type="number" min="0" max="600" step="1" :value="playbackAutomation.outroSeconds" :disabled="savingPreferences" @change="updateSkipDuration('outroSeconds', $event)" /></label>
                  <p>0表示不跳过该部分。设置随当前账户保存。</p>
                  <p v-if="preferencesError" role="alert" class="preferences-error">{{ preferencesError }}</p>
                  <p v-else-if="savingPreferences || preferencesSaved" role="status">{{ savingPreferences ? '正在保存…' : '播放偏好已保存' }}</p>
                </div>
                </div>
                <div class="automation-card">
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
                    :disabled="savingPreferences"
                    @click="toggleAutoNext"
                  >
                    <span aria-hidden="true"></span>
                  </button>
                </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        </main>

        <aside v-if="episodes.length" ref="episodePanelRef" class="episode-panel" :class="{ 'sheet-open': episodeSheetOpen }" :role="episodeSheetOpen ? 'dialog' : undefined" :aria-modal="episodeSheetOpen || undefined" aria-label="选集">
          <div class="episode-coverage" role="status" aria-live="polite">
            <strong>{{ libraryCoverage.summary }}</strong>
            <span v-if="officialWork && libraryCoverage.missing.length">已更新至第 {{ officialWork.latestEpisode }} 集 · {{ officialWork.platform }}</span>
            <span v-if="libraryCoverage.missingLabel">{{ libraryCoverage.missingLabel }}</span>
            <button v-if="media?.category === 'tv' && libraryCoverage.missingLabel" type="button" class="episode-coverage-action" @click="emit('re-search', media)">补齐缺少的剧集</button>
          </div>
          <div class="episode-heading">
            <div class="episode-heading-title">
              <div class="episode-heading-main">
                <strong>剧集</strong>
              </div>
              <small v-if="latestEpisodeUpdateLabel" class="episode-update-time">{{ latestEpisodeUpdateLabel }}</small>
            </div>
            <div class="episode-heading-actions"><button type="button" class="text-action" @click="episodesDescending = !episodesDescending">{{ episodesDescending ? '倒序' : '正序' }}</button><button v-if="episodeSheetOpen" type="button" class="icon-button" aria-label="关闭选集" @click="episodeSheetOpen = false"><X /></button></div>
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
                <span>{{ episodeBadgeLabel(entry.episode, entry.index) }}</span>
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
.skip-durations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 0 16px 18px; }
.skip-durations label { display: grid; min-width: 0; gap: 8px; color: var(--text-secondary); font-size: .75rem; }
.skip-durations input { width: 100%; min-width: 0; height: 48px; padding: 10px 12px; border: 1px solid var(--divider); border-radius: 12px; color: var(--text-primary); background: var(--surface-1); font-size: 16px; }
.skip-durations p { grid-column: 1 / -1; color: var(--text-tertiary); font-size: .72rem; line-height: 1.7; }
.skip-durations .preferences-error { color: var(--danger); }

.delivery-hint { margin-top: 9px; color: var(--text-tertiary); font-size: .73rem; line-height: 1.6; }
.compatibility-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-top: 8px; color: var(--text-secondary); font-size: .76rem; line-height: 1.6; }
.compatibility-actions .text-action { padding-inline: 10px; color: var(--liquid-accent); background: transparent; }
.player-backdrop { position: fixed; top: var(--player-top, 0px); left: var(--player-left, 0px); width: var(--player-width, 100%); height: var(--player-height, 100dvh); z-index: 1400; display: grid; place-items: center; padding: 0; background: var(--liquid-canvas); opacity: 0; visibility: hidden; transition: opacity .2s, visibility .2s; }
.player-backdrop.active { opacity: 1; visibility: visible; }
.player-backdrop:not(.active) { display: none; }
.player-window { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden; border: 0; color: var(--text-primary); background: var(--liquid-canvas); }
.player-window:fullscreen { width: 100vw; height: 100dvh; max-width: none; margin: 0; background: #000; }
.player-header { display: flex; flex-shrink: 0; min-height: 80px; align-items: center; justify-content: space-between; gap: 16px; padding: 15px 24px; border-bottom: 1px solid var(--divider); background: transparent; }
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
/* Only the stage owns dark tokens. Any brightness adjustment applies to video only. */
.video-stage { --text-primary: #f6f8ff; --text-secondary: #d0daea; --text-tertiary: #b7c4d9; --liquid-accent: #b6ceff; --liquid-accent-strong: #91b3f7; position: relative; display: grid; width: 100%; min-height: 0; aspect-ratio: var(--video-ratio, 16 / 9); flex: 0 0 auto; place-items: center; overflow: hidden; border: var(--glass-border); border-radius: 12px; color: var(--text-primary); background: #000; color-scheme: dark; }
.fullscreen-notice { position: absolute; z-index: 10; top: calc(60px + var(--player-inset-top, 0px)); left: max(16px, var(--player-inset-left, 0px)); right: max(16px, var(--player-inset-right, 0px)); margin: 0 auto; width: fit-content; max-width: calc(100% - 32px); padding: 10px 16px; border-radius: 10px; color: #fff; background: rgb(0 0 0 / .85); font-size: 12px; text-align: center; }
.stage-back-button { position: absolute; z-index: 11; top: calc(8px + var(--player-inset-top, 0px)); left: calc(16px + var(--player-inset-left, 0px)); color: #fff; background: rgb(0 0 0 / .35); }
.video-stage, .video-stage :deep(*) { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.video-element { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; object-fit: contain; background: #000; }
.video-element { touch-action: none; }
.video-brightness-veil { position: absolute; inset: 0; z-index: 1; background: #000; pointer-events: none; }
.stage-state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 20px; overflow-y: auto; text-align: center; background: radial-gradient(ellipse at 50% 10%, #222831, #0c1016 75%); }
.loading-state { isolation: isolate; }
.stage-poster { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; object-fit: cover; opacity: .12; }
.loading-content { display: grid; justify-items: center; gap: 8px; }
.stage-state strong { font-size: .97rem; font-weight: 650; }
.stage-state p { max-width: 420px; color: var(--text-secondary); font-size: .8rem; line-height: 1.6; overflow-wrap: anywhere; }
.state-icon { width: 28px; height: 28px; color: #f0c3cc; }
.state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 5px; }
.primary-button, .secondary-button { min-height: 44px; padding: 0 17px; border: 1px solid var(--divider); border-radius: 24px; font-size: .8rem; font-weight: 600; box-shadow: none; }
.primary-button { color: #eff3fa; background: rgb(255 255 255 / .12); }
.secondary-button { color: #f1f5ff; background: rgb(255 255 255 / .045); }
.reload-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.reload-button svg { width: 16px; height: 16px; }
.play-prompt, .playback-starting { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; pointer-events: none; }
.play-prompt { background: rgb(0 0 0 / .2); }
.stage-play-button { display: grid; min-width: 140px; justify-items: center; gap: 7px; padding: 12px 16px; border: 0; border-radius: 26px; color: #fff; background: transparent; pointer-events: auto; }
.stage-play-icon { display: grid; width: 68px; height: 68px; place-items: center; border: 1px solid var(--divider); border-radius: 50%; color: #fff; background: linear-gradient(145deg, rgb(255 255 255 / .4), rgb(255 255 255 / .1)); box-shadow: inset 0 2px 2px rgb(255 255 255 / .6), 0 9px 28px rgb(0 0 0 / .2); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); transition: transform .2s, background .2s; }
.stage-play-icon svg { width: 27px; height: 27px; margin-left: 3px; fill: currentColor; }
.stage-play-button:active .stage-play-icon { transform: scale(.95); }
.stage-play-label { font-size: .86rem; font-weight: 650; text-shadow: 0 2px 6px #000; }
.stage-play-button small { color: #e1e9f8; font-size: .7rem; text-shadow: 0 2px 6px #000; }
.buffer-retry { position: absolute; top: calc(50% + 30px); min-height: 44px; padding: 0 18px; border: var(--glass-border); border-radius: 22px; color: #fff; background: #252529; pointer-events: auto; }
.playback-starting-pill { display: inline-flex; align-items: center; gap: 8px; padding: 10px 15px; border: 1px solid var(--divider); border-radius: 24px; color: #f4f7ff; background: rgb(29 40 59 / .8); box-shadow: inset 0 1px rgb(255 255 255 / .4); font-size: .77rem; }
.playback-starting-pill svg { width: 17px; height: 17px; animation: spin 1s linear infinite; }
.loading-wave { display: flex; height: 30px; align-items: center; gap: 4px; margin-bottom: 2px; }
.loading-wave i { width: 3px; height: 20px; border-radius: 5px; background: #bad2ff; animation: loading-wave 1.2s ease-in-out infinite; }
.loading-wave i:nth-child(2) { animation-delay: .12s; }
.loading-wave i:nth-child(3) { animation-delay: .24s; }
.loading-wave i:nth-child(4) { animation-delay: .36s; }
.playback-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 0 4px; }
.playback-actions :deep(.danmaku-controls) { flex: 1 1 auto; min-width: 0; }
.playback-actions :deep(.danmaku-controls:has(.danmaku-settings)) { flex-basis: 100%; }
.playback-actions :deep(.danmaku-row) { padding-top: 0; }
.playback-actions :deep(.danmaku-toggle) { min-height: 48px; padding: 0 14px; border: 1px solid var(--divider); border-radius: 12px; }
.player-toolbar { display: flex; align-items: center; flex-shrink: 0; gap: 8px; padding: 0; }
.player-toolbar button { display: flex; min-width: 0; min-height: 48px; align-items: center; gap: 10px; padding: 6px 14px; border: 1px solid var(--divider); border-radius: 12px; color: var(--text-primary); background: var(--surface-1); text-align: left; white-space: nowrap; }
.player-toolbar button[aria-expanded='true'] { color: var(--liquid-accent-strong); background: var(--liquid-accent-subtle); border-color: rgb(var(--accent-rgb) / .3); }
.player-toolbar button > svg { width: 20px; height: 20px; flex-shrink: 0; color: var(--liquid-accent); }
.player-toolbar button > span { display: grid; min-width: 0; flex: 1; gap: 2px; }
.player-toolbar strong { font-size: .81rem; font-weight: 650; }
.player-toolbar small { overflow: hidden; color: var(--text-tertiary); font-size: .68rem; text-overflow: ellipsis; white-space: nowrap; }
.player-toolbar .toolbar-chevron { width: 15px; height: 15px; transition: transform .2s; }
.player-toolbar [aria-expanded='true'] .toolbar-chevron { transform: rotate(180deg); }
.playback-settings { display: flex; flex-direction: column; flex-shrink: 0; margin-bottom: 8px; padding: 0; border: 0; border-radius: 24px; background: var(--surface-1); }
.settings-panel-body { display: grid; align-content: start; gap: 24px; min-height: 0; padding: 24px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.settings-panel-heading, .setting-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.settings-panel-heading { flex-shrink: 0; padding: 16px 24px 12px; border-bottom: 1px solid var(--divider); }
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
.automation-list { display: grid; gap: 12px; }
.automation-card { min-width: 0; border: 1px solid var(--divider); border-radius: 18px; background: var(--surface-2); }
.automation-row { display: flex; min-width: 0; min-height: 76px; align-items: center; gap: 16px; padding: 16px; }
.automation-row + .automation-row { border-top: 1px solid rgb(60 84 122 / .1); }
.automation-copy { display: grid; min-width: 0; flex: 1; gap: 4px; }
.automation-copy strong { font-size: .8rem; font-weight: 600; }
.automation-copy small { color: var(--text-tertiary); font-size: .68rem; line-height: 1.5; }
/* The switch has a 44px touch target around its 30px visual track. */
.setting-switch { position: relative; width: 52px; height: 44px; flex-shrink: 0; border: 0; border-radius: 24px; background: transparent; }
.setting-switch::before { content: ''; position: absolute; inset: 7px 0; border: 1px solid rgb(80 105 145 / .14); border-radius: 18px; background: var(--switch-track); box-shadow: inset 0 1px 3px rgb(36 54 86 / .12); transition: background .2s; }
.setting-switch span { position: absolute; top: 10px; left: 3px; width: 24px; height: 24px; border: 1px solid var(--divider); border-radius: 50%; background: var(--switch-knob); box-shadow: 0 2px 5px rgb(36 54 86 / .2); transition: transform .22s var(--spring-ease); }
.setting-switch[aria-checked='true']::before { background: var(--liquid-accent); }
.setting-switch[aria-checked='true'] span { transform: translateX(22px); }
.episode-panel { display: flex; min-width: 0; min-height: 0; flex-direction: column; margin: 0; overflow: hidden; border-left: 1px solid var(--divider); background: transparent; }
.episode-heading { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 8px; padding: 20px 16px 15px; }
.episode-heading-title { display: grid; min-width: 0; gap: 5px; }
.episode-heading-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px; }
.episode-heading strong { font-size: 1rem; font-weight: 700; }
.episode-heading small, .episode-heading span { color: var(--text-tertiary); font-size: .66rem; }
.episode-heading > small { flex-shrink: 0; }
.episode-update-time { font-variant-numeric: tabular-nums; }
.episode-coverage { display: grid; flex-shrink: 0; gap: 6px; margin: 16px 12px 0; padding: 14px 16px; border: 1px solid var(--divider); border-radius: 14px; background: var(--surface-1); font-size: 12px; line-height: 1.6; }
.episode-coverage strong { color: var(--text-primary); font-weight: 600; }.episode-coverage span { color: var(--text-secondary); }
.episode-coverage-action { justify-self: start; min-height: 36px; padding: 0 14px; border: 1px solid var(--divider); border-radius: 18px; color: var(--text-primary); background: var(--glass-bg); font-size: .75rem; }
.episode-ranges { display: flex; flex-shrink: 0; gap: 6px; overflow-x: auto; padding: 0 12px 10px; }
.episode-ranges button { min-height: 44px; flex-shrink: 0; padding: 0 14px; border: var(--glass-border); border-radius: 24px; color: var(--text-secondary); background: var(--glass-bg); font-size: .76rem; }
.episode-ranges button.active { color: var(--liquid-accent-strong); background: var(--glass-lens); box-shadow: var(--glass-highlight-inner); font-weight: 650; }
.episode-list { display: grid; min-height: 0; align-content: start; gap: 8px; overflow-y: auto; overscroll-behavior: contain; padding: 3px 12px 16px; }
.episode-item { display: grid; min-width: 0; min-height: 66px; grid-template-columns: 40px minmax(0, 1fr); align-items: center; gap: 10px; padding: 9px; border: 1px solid transparent; border-radius: 19px; color: var(--text-secondary); background: transparent; text-align: left;  box-shadow: none; }
.episode-item.active { color: var(--text-primary); border-color: transparent; background: var(--glass-bg-active); box-shadow: none; }
.episode-item:hover { background: var(--glass-bg-hover); }
.episode-number { position: relative; display: grid; width: 40px; height: 40px; place-items: center; border-radius: 8px; background: var(--glass-bg); font-size: .84rem; font-weight: 550; font-variant-numeric: tabular-nums; }
.episode-item.active .episode-number { color: var(--liquid-accent-strong); border-color: rgb(var(--accent-rgb) / .2); background: var(--liquid-accent-subtle); box-shadow: none; }
.episode-latest { position: absolute; top: -6px; right: -5px; display: grid; min-width: 16px; height: 16px; place-items: center; padding: 0 3px; border: 1px solid var(--divider); border-radius: 9px; color: var(--accent-ink); background: var(--liquid-accent); font-size: .5rem; font-weight: 650; line-height: 1; }
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
  .player-header { min-height: calc(72px + var(--safe-area-top)); padding: calc(10px + var(--safe-area-top)) calc(18px + var(--safe-area-right)) 10px calc(18px + var(--safe-area-left)); }
  .source-badge { display: none; }
  .title-copy h2 { font-size: 1.06rem; }
  .title-copy p { font-size: .71rem; }
  .header-actions { gap: 6px; }
  .text-action { padding: 0 13px; }
  .player-layout { display: flex; flex-direction: column; overflow-y: auto; overscroll-behavior: contain; }
  .video-column { flex: 0 0 auto; overflow: visible; padding: 14px calc(14px + var(--safe-area-right)) 0 calc(14px + var(--safe-area-left)); }
  .video-stage { min-height: 0; aspect-ratio: var(--video-ratio, 16 / 9); border-radius: 10px; border: 0; }
  .video-stage:last-child { margin-bottom: 14px; }
  .stage-state { gap: 7px; padding: 12px;  background: radial-gradient(ellipse at 50% 10%, #222831, #0c1016 75%); }
  .stage-state strong { font-size: .88rem; }
  .stage-state p { font-size: .74rem; line-height: 1.45; }
  .stage-poster { display: none; }
  .stage-play-icon { width: 58px; height: 58px; }
  .stage-play-button small { font-size: .65rem; }
  .player-toolbar { gap: 8px; padding: 10px 0 6px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .player-toolbar button { min-height: 48px; gap: 8px; padding: 8px 12px; border-radius: 12px; background: var(--surface-1); transition: background .2s, transform .15s; }
  .player-toolbar button:active { transform: scale(.98); }
  .player-toolbar button > svg { width: 18px; height: 18px; }
  .player-toolbar strong { font-size: .78rem; }
  .player-toolbar small { font-size: .65rem; }
  .player-toolbar .toolbar-chevron { display: none; }
  .playback-settings { margin-bottom: 14px; border-radius: 24px; }
  .settings-panel-heading { padding: 14px 20px 12px; }
  .settings-panel-body { padding: 20px; }
  .setting-heading { flex-wrap: wrap; gap: 4px 10px; }
  .episode-panel { flex: 0 0 auto; margin: 0 calc(14px + var(--safe-area-right)) calc(20px + var(--safe-area-bottom)) calc(14px + var(--safe-area-left)); border: 0; overflow: visible; scroll-margin-top: 10px; }
  .episode-heading { padding: 19px 16px 15px; }
  .episode-list { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 9px; overflow: visible; padding: 7px 14px 20px; }
  .episode-item { position: relative; min-height: 52px; grid-template-columns: 1fr; padding: 0; gap: 0; border: 1px solid var(--divider); border-radius: 10px; background: var(--surface-1); box-shadow: none; }
  .episode-number { width: 100%; height: 100%; min-height: 52px; padding: 0 4px; border: 0; border-radius: inherit; background: transparent; font-size: .84rem; }
  .episode-number > span { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .episode-item.active { border-color: rgb(var(--accent-rgb) / .45); box-shadow: none; }
  .episode-item.active .episode-number { background: var(--liquid-accent-subtle); color: var(--liquid-accent-strong); box-shadow: none; }
  .episode-latest { top: -5px; right: -4px;  color: var(--accent-ink); }
  .episode-copy { display: none; }
}
@media (max-width: 360px) { .episode-list { grid-template-columns: repeat(4, minmax(0, 1fr)); } .player-toolbar button { gap: 5px; padding: 8px; } .player-toolbar button > svg { width: 17px; height: 17px; } }
.player-backdrop.landscape-inline { height: var(--player-height, 100dvh); padding: 0; background: #000; }
.landscape-inline .player-window { position: absolute; inset: 0; width: 100%; height: 100%; max-width: none; margin: 0; border: 0; border-radius: 0; background: #000; box-shadow: none; }
.landscape-inline .player-header { display: none; }
.landscape-inline .player-layout, .landscape-inline .video-column { display: block; width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.landscape-inline .video-column { padding: 0; background: #000; }
.landscape-inline .video-stage { width: 100%; height: 100%; min-height: 0; aspect-ratio: auto; border: 0; border-radius: 0; }
.landscape-inline .playback-actions,
.landscape-inline .playback-settings,
.landscape-inline .episode-panel { display: none; }

@media (prefers-reduced-motion: reduce) { .player-backdrop, .loading-wave i, .playback-starting-pill svg, .setting-switch span, .setting-switch::before { transition: none; animation: none; } }

/* A full playback page with independent sheets; changing sheets never remounts video. */
.player-header { min-height: calc(68px + var(--safe-area-top)); padding-top: calc(10px + var(--safe-area-top)); }
.player-back-button { background: transparent; }
.episode-heading-actions { display: flex; align-items: center; gap: 4px; }
.episode-heading-actions .text-action { padding: 0 10px; font-size: 12px; }
.episode-item.active .episode-number { color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.player-sheet-shade { position: absolute; inset: 0; z-index: 15; background: rgb(0 0 0 / .5); }
.playback-settings { position: absolute; z-index: 16; right: 24px; bottom: 24px; width: min(560px, calc(100% - 48px)); max-height: 80%; overflow: hidden; margin: 0; background: var(--surface-1); border: 1px solid var(--divider); }
.episode-panel.sheet-open { position: absolute; z-index: 16; right: 24px; bottom: 24px; width: min(420px, calc(100% - 48px)); height: min(75%, 700px); overflow: hidden; margin: 0; border-radius: 16px; border: 1px solid var(--divider); background: var(--surface-1); }
.episode-panel.sheet-open .episode-list { overflow-y: auto; }
@media (min-width: 821px) { .player-layout { grid-template-columns: minmax(0, 1fr) 320px; } .video-stage { max-height: calc(var(--player-height, 100dvh) - 188px); } }
@media (min-width: 821px) and (max-width: 1199px) { .player-layout { grid-template-columns: minmax(0, 1fr) 260px; } }
@media (min-width: 1024px) {
  .player-window { max-width: 1920px; margin-inline: auto; }
  .video-column { padding: 20px 24px; }
  .video-stage { max-height: calc(var(--player-height, 100dvh) - 196px); }
  .episode-panel { background: var(--surface-1); }
  .episode-item { border-radius: 10px; }
  .episode-heading { padding: 24px 16px 16px; }
}
@media (max-width: 820px) {
  .player-window { --playback-left: max(16px, var(--safe-area-left)); --playback-right: max(16px, var(--safe-area-right)); }
  .player-header { min-height: calc(56px + var(--safe-area-top)); gap: 8px; padding: calc(var(--mobile-header-top-space, 12px) + var(--safe-area-top)) var(--playback-right) 10px var(--playback-left); }
  .title-block { gap: 8px; }
  .title-copy p { font-size: .75rem; color: var(--text-secondary); }
  .player-back-button { margin-inline-start: -8px; }
  .player-layout { display: block; scroll-padding-top: min(calc(100vw / var(--video-ratio)), calc(var(--player-height, 100dvh) * .55)); }
  .video-column { display: contents; }
  .video-stage { position: sticky; z-index: 5; top: 0; border-radius: 0; width: 100%; aspect-ratio: var(--video-ratio, 16 / 9); min-height: 0; max-height: calc(var(--player-height, 100dvh) * .55); }
  .playback-actions { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; padding: 10px var(--playback-right) 12px var(--playback-left); }
  .playback-actions:empty { display: none; }
  .playback-actions :deep(.danmaku-controls) { flex: 0 0 auto; }
  .playback-actions :deep(.danmaku-row) { padding-top: 0; gap: 6px; }
  .playback-actions :deep(.danmaku-toggle) { min-height: 48px; padding: 0 12px; border: 1px solid var(--divider); border-radius: 12px; background: var(--surface-1); }
  .playback-actions :deep(.danmaku-toggle[aria-checked='true']) { border-color: rgb(var(--accent-rgb) / .3); background: var(--liquid-accent-subtle); color: var(--liquid-accent-strong); }
  .playback-actions :deep(.danmaku-controls:has(.danmaku-toggle[aria-checked='true'])) { flex-basis: 100%; }
  .player-toolbar { flex: 1 1 0; min-width: 0; display: flex; align-items: stretch; gap: 8px; padding: 0; }
  .player-toolbar button { min-height: 48px; padding: 6px 12px; border: 1px solid var(--divider); border-radius: 12px; background: var(--surface-1); white-space: nowrap; }
  .player-toolbar button:first-child { flex: 1 1 auto; }
  .player-toolbar button:not(:first-child) { flex: 0 0 auto; }
  .episode-panel { margin: 0 var(--playback-right) calc(24px + var(--safe-area-bottom)) var(--playback-left); }
  .episode-panel:not(.sheet-open) .episode-coverage { margin: 0; padding: 12px 0 6px; border: 0; border-top: 1px solid var(--divider); border-radius: 0; background: transparent; }
  .episode-panel:not(.sheet-open) .episode-coverage strong { color: var(--text-secondary); font-weight: 550; }
  .episode-panel:not(.sheet-open) .episode-heading { padding: 8px 0 10px; }
  .episode-panel:not(.sheet-open) .episode-ranges { padding-inline: 0; }
  .episode-panel:not(.sheet-open) .episode-list { gap: 8px; padding: 4px 0 16px; }
  .playback-settings { inset: auto max(12px, var(--safe-area-right)) max(12px, var(--safe-area-bottom)) max(12px, var(--safe-area-left)); width: auto; max-height: calc(84% - var(--safe-area-bottom)); border-radius: 24px; }
  .episode-panel.sheet-open { inset: auto max(12px, var(--safe-area-right)) max(12px, var(--safe-area-bottom)) max(12px, var(--safe-area-left)); width: auto; height: 65%; border-radius: 24px; padding-bottom: 12px; }
  .episode-panel.sheet-open .episode-list { flex: 1; min-height: 0; overflow-y: auto; }
}
.landscape-inline .video-stage { position: relative; max-height: none; min-height: 0; height: 100%; }
.landscape-inline .playback-settings { display: flex; inset: 0 0 0 auto; width: min(360px, 78vw); max-height: 100%; border-radius: 0; }
.landscape-inline .settings-panel-heading { padding: max(12px, var(--player-inset-top, 0px)) calc(16px + var(--player-inset-right, 0px)) 12px 16px; }
.landscape-inline .settings-panel-body { padding: 16px calc(16px + var(--player-inset-right, 0px)) calc(16px + var(--player-inset-bottom, 0px)) 16px; }
.landscape-inline .episode-panel.sheet-open { display: flex; inset: 0 0 0 auto; width: min(360px, 78vw); height: 100%; border-radius: 0; }
.landscape-inline .episode-panel.sheet-open .episode-heading { padding-top: max(12px, var(--player-inset-top, 0px)); padding-right: calc(16px + var(--player-inset-right, 0px)); }
.landscape-inline .episode-panel.sheet-open .episode-list { grid-template-columns: minmax(0, 1fr); gap: 6px; padding-right: calc(12px + var(--player-inset-right, 0px)); padding-bottom: calc(16px + var(--player-inset-bottom, 0px)); }
.landscape-inline .episode-panel.sheet-open .episode-item { min-height: 58px; grid-template-columns: 40px minmax(0, 1fr); gap: 10px; padding: 9px; border-color: transparent; background: transparent; }
.landscape-inline .episode-panel.sheet-open .episode-item.active { border-color: rgb(var(--accent-rgb) / .35); background: var(--glass-bg-active); }
.landscape-inline .episode-panel.sheet-open .episode-number { width: 40px; height: 40px; min-height: 40px; border-radius: 8px; background: var(--glass-bg); }
.landscape-inline .episode-panel.sheet-open .episode-copy { display: grid; }
</style>
