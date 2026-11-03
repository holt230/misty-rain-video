<script setup lang="ts">
import type Hls from 'hls.js';
import { activeSubtitleTrack, selectSubtitleTrack, subtitleTrackOptions, subtitlePreference, subtitlePreferenceKey, subtitleEvents, type SubtitleTrackOption } from '../../services/subtitleTracks';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { LockKeyhole, UnlockKeyhole, ListVideo, SlidersHorizontal, Expand, Shrink, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from '@lucide/vue';

const props = defineProps<{ video: HTMLVideoElement; expanded: boolean; desktop?: boolean; hls?: Hls | null; username?: string }>();
const emit = defineEmits<{ (e: 'fullscreen'): void; (e: 'episodes'): void; (e: 'settings'): void; (e: 'lock-change', value: boolean): void }>();
const visible = ref(true);
const paused = ref(true);
const muted = ref(false);
const volume = ref(1);
const time = ref(0);
const duration = ref(0);
const scrubbing = ref(false);
const buffered = ref(0);
const seekSliderStyle = computed(() => {
  if (!duration.value) return {};
  const played = Math.min(100, Math.max(0, (time.value / duration.value) * 100));
  const buff = Math.min(100, Math.max(0, (buffered.value / duration.value) * 100));
  const maxBuff = Math.max(played, buff);
  return {
    background: `linear-gradient(to right, #fff 0%, #fff ${played}%, rgba(255, 255, 255, 0.38) ${played}%, rgba(255, 255, 255, 0.38) ${maxBuff}%, rgba(255, 255, 255, 0.14) ${maxBuff}%, rgba(255, 255, 255, 0.14) 100%)`
  };
});
const notice = ref('');
const seekNotice = ref('');
const subtitles = ref<SubtitleTrackOption[]>([]);
const subtitle = ref('off');
const speed = ref(1);
const locked = ref(false);
const boosted = ref(false);
const rates = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const rateKey = () => 'misty_playback_speed:' + (props.username || 'guest');
function changeSpeed(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  if (!rates.includes(value)) return;
  speed.value = value;
  props.video.defaultPlaybackRate = value;
  props.video.playbackRate = value;
  try { localStorage.setItem(rateKey(), String(value)); } catch { /* Continue without saving. */ }
  reveal();
}
watch(locked, value => emit('lock-change', value));
let timer: ReturnType<typeof setTimeout> | undefined;
let seekNoticeTimer: ReturnType<typeof setTimeout> | undefined;
let release = () => {};
const clock = (value: number) => {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
function reveal() {
  visible.value = true;
  clearTimeout(timer);
  if (!props.video.paused && !scrubbing.value && !locked.value) timer = setTimeout(() => { visible.value = false; }, 3500);
}
async function togglePlay() {
  notice.value = '';
  try {
    if (props.video.paused) await props.video.play(); else props.video.pause();
  } catch { notice.value = '未能开始播放，请再试一次'; }
  reveal();
}
function preview(event: Event) {
  scrubbing.value = true;
  time.value = Number((event.target as HTMLInputElement).value);
  seekNotice.value = `${clock(time.value)} / ${clock(duration.value)}`;
  clearTimeout(seekNoticeTimer);
  reveal();
}
function seek() {
  if (!scrubbing.value) return;
  props.video.currentTime = Math.max(0, Math.min(duration.value, time.value));
  scrubbing.value = false;
  seekNotice.value = '';
  reveal();
}
function seekBy(seconds: number) {
  const video = props.video;
  if (locked.value || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const position = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const target = Math.max(0, Math.min(video.duration, position + seconds));
  try {
    video.currentTime = target;
    scrubbing.value = false;
    time.value = target;
    notice.value = '';
    seekNotice.value = target === position ? (target === 0 ? '已到片头' : '已到片尾') : `${seconds > 0 ? '快进' : '快退'} ${Math.round(Math.abs(target - position))} 秒`;
    clearTimeout(seekNoticeTimer);
    seekNoticeTimer = setTimeout(() => { seekNotice.value = ''; }, 1400);
  } catch { notice.value = '暂时无法跳转，请稍候重试'; }
  reveal();
}
function toggleMute() {
  const unmute = muted.value;
  props.video.muted = !unmute;
  if (unmute && props.video.volume === 0) props.video.volume = 1;
}
function changeVolume(event: Event) {
  props.video.volume = Number((event.target as HTMLInputElement).value);
  props.video.muted = props.video.volume === 0;
  reveal();
}
function selectSubtitle(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const option = subtitles.value.find(item => item.id === id);
  try { localStorage.setItem(subtitlePreferenceKey(props.username), subtitlePreference(option)); } catch { /* Keep the selected track. */ }
  selectSubtitleTrack(props.video, props.hls, id);
  reveal();
}

watch([() => props.video, () => props.hls] as const, ([video, hls]) => {
  release();
  scrubbing.value = false; notice.value = ''; seekNotice.value = '';
  const sync = () => {
    paused.value = video.paused; muted.value = video.muted || video.volume === 0; volume.value = video.volume;
    duration.value = Number.isFinite(video.duration) ? video.duration : 0;
    if (!scrubbing.value) time.value = video.currentTime || 0;
    const b = video.buffered;
    if (b && b.length > 0) {
      const cur = video.currentTime || 0;
      let end = 0;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= cur + 1 && b.end(i) >= cur) { end = b.end(i); break; }
      }
      buffered.value = end || b.end(b.length - 1);
    } else {
      buffered.value = 0;
    }
  };
  const syncTracks = () => {
    subtitles.value = subtitleTrackOptions(video, hls);
    subtitle.value = activeSubtitleTrack(video, hls);
  };
  const playback = () => { sync(); reveal(); };
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let initialRate = 1;
  let suppressTap = false;
  let origin = { x: 0, y: 0 };
  const endPress = () => {
    clearTimeout(pressTimer);
    if (boosted.value) { video.playbackRate = initialRate; boosted.value = false; suppressTap = true; }
  };
  const startPress = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') { video.focus({ preventScroll: true }); reveal(); return; }
    if (locked.value || video.paused || (event.button !== undefined && event.button !== 0)) return;
    origin = { x: event.clientX, y: event.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      initialRate = video.playbackRate || 1;
      video.playbackRate = Math.max(2, initialRate);
      boosted.value = true;
      reveal();
    }, 450);
  };
  const movePress = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') reveal();
    if (Math.abs(event.clientX - origin.x) + Math.abs(event.clientY - origin.y) > 12) endPress();
  };
  const tap = () => {
    if (locked.value) { reveal(); return; }
    if (suppressTap) { suppressTap = false; return; }
    if (visible.value && !video.paused) visible.value = false; else reveal();
  };
  const doubleTap = (event: Event) => {
    if (locked.value) return;
    event.preventDefault();
    const mouseEvt = event as MouseEvent;
    if (typeof mouseEvt.clientX === 'number') {
      const rect = video.getBoundingClientRect();
      if (rect.width > 0) {
        const xRatio = (mouseEvt.clientX - rect.left) / rect.width;
        if (xRatio < 0.35) {
          seekBy(-10);
          return;
        }
        if (xRatio > 0.65) {
          seekBy(10);
          return;
        }
      }
    }
    void togglePlay();
  };
  const contextMenu = (event: Event) => event.preventDefault();
  const keyboard = (event: KeyboardEvent) => {
    if (locked.value || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, select, textarea, button, a, [contenteditable="true"]')) return;
    if (event.key === ' ' || event.key === 'k') { event.preventDefault(); void togglePlay(); }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      seekBy(event.key === 'ArrowRight' ? 10 : -10);
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const current = video.muted ? 0 : video.volume;
      const step = event.key === 'ArrowUp' ? 0.1 : -0.1;
      const next = Math.max(0, Math.min(1, Math.round((current + step) * 10) / 10));
      video.volume = next;
      video.muted = next === 0;
      volume.value = next;
      muted.value = next === 0;
      seekNotice.value = `音量 ${Math.round(next * 100)}%`;
      clearTimeout(seekNoticeTimer);
      seekNoticeTimer = setTimeout(() => { seekNotice.value = ''; }, 1200);
      reveal();
    }
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      if (props.desktop && supportsNativeFullscreen) {
        void toggleNativeFullscreen();
      } else {
        emit('fullscreen');
      }
    }
    if (event.key === 'w' || event.key === 'W') {
      event.preventDefault();
      emit('fullscreen');
    }
    if (event.key === 'm' || event.key === 'M') toggleMute();
  };
  const stage = video.closest('.video-stage') || video;
  const hover = (event: Event) => { if ((event as PointerEvent).pointerType === 'mouse') reveal(); };
  try { const saved = Number(localStorage.getItem(rateKey())); speed.value = rates.includes(saved) ? saved : 1; } catch { speed.value = 1; }
  const restoreSpeed = () => {
    video.defaultPlaybackRate = speed.value;
    if (!boosted.value) video.playbackRate = speed.value;
  };
  restoreSpeed();
  video.addEventListener('loadedmetadata', restoreSpeed);
  video.addEventListener('pointerdown', startPress);
  video.addEventListener('pointermove', movePress);
  video.addEventListener('pointerup', endPress);
  video.addEventListener('pointercancel', endPress);
  video.addEventListener('pointerleave', endPress);
  video.addEventListener('dblclick', doubleTap);
  video.addEventListener('contextmenu', contextMenu);
  stage.addEventListener('keydown', keyboard as EventListener);
  stage.addEventListener('pointermove', hover);
  const events = ['timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked', 'progress'];
  events.forEach(event => video.addEventListener(event, sync));
  ['play', 'pause', 'ended'].forEach(event => video.addEventListener(event, playback));
  ['addtrack', 'removetrack', 'change'].forEach(event => video.textTracks.addEventListener(event, syncTracks));
  video.addEventListener('click', tap);
  const hlsEvents = hls ? subtitleEvents(hls) : [];
  hlsEvents.forEach(event => hls?.on(event, syncTracks));
  sync(); syncTracks(); reveal();
  release = () => {
    events.forEach(event => video.removeEventListener(event, sync));
    ['play', 'pause', 'ended'].forEach(event => video.removeEventListener(event, playback));
    ['addtrack', 'removetrack', 'change'].forEach(event => video.textTracks.removeEventListener(event, syncTracks));
    endPress();
    video.removeEventListener('click', tap);
    video.removeEventListener('pointerdown', startPress);
    video.removeEventListener('pointermove', movePress);
    video.removeEventListener('pointerup', endPress);
    video.removeEventListener('pointercancel', endPress);
    video.removeEventListener('pointerleave', endPress);
    video.removeEventListener('dblclick', doubleTap);
    video.removeEventListener('contextmenu', contextMenu);
    stage.removeEventListener('keydown', keyboard as EventListener);
    stage.removeEventListener('pointermove', hover);
    video.removeEventListener('loadedmetadata', restoreSpeed);
    hlsEvents.forEach(event => hls?.off(event, syncTracks));
    clearTimeout(timer);
    clearTimeout(seekNoticeTimer);
  };
}, { immediate: true });
const isNativeFullscreen = ref(typeof document !== 'undefined' && Boolean(document.fullscreenElement));
const supportsNativeFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);

const updateNativeFullscreenState = () => {
  isNativeFullscreen.value = typeof document !== 'undefined' && Boolean(document.fullscreenElement);
};

const toggleNativeFullscreen = async () => {
  if (typeof document === 'undefined') return;
  const target = props.video.closest('.video-stage') || props.video.closest('.player-window') || props.video;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (target && 'requestFullscreen' in target) {
      await (target as HTMLElement).requestFullscreen();
    }
  } catch {
    emit('fullscreen');
  }
};

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', updateNativeFullscreenState);
  }
});

watch(() => props.expanded, value => { if (!value) locked.value = false; reveal(); });
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', updateNativeFullscreenState);
  }
  release();
  emit('lock-change', false);
});
</script>

<template>
  <div class="mobile-controls" :class="{ concealed: !visible, locked }" @pointerdown="reveal" @focusin="reveal">
    <p v-if="notice" role="status">{{ notice }}</p>
    <div v-if="boosted" class="speed-notice" role="status">正在加速播放 · 松手恢复</div>
    <div v-if="seekNotice && !boosted" class="speed-notice" role="status">{{ seekNotice }}</div>
    <div class="control-tools">
      <span class="desktop-shortcuts">空格 播放/暂停 · ← → 快退进 · ↑ ↓ 音量 · F 全屏 · W 网页全屏 · M 静音</span>
      <button v-if="expanded && !desktop" type="button" :aria-label="locked ? '解锁播放控制' : '锁定播放控制'" @click="locked = !locked; reveal()"><UnlockKeyhole v-if="locked" /><LockKeyhole v-else /></button>
      <template v-if="!locked">
        <div class="seek-actions" role="group" aria-label="快进和快退">
          <button type="button" class="seek-step" aria-label="快退10秒" title="快退10秒" :disabled="!duration" @click="seekBy(-10)"><span class="seek-symbol"><RotateCcw /><span>10</span></span></button>
          <button type="button" class="seek-step" aria-label="快进10秒" title="快进10秒" :disabled="!duration" @click="seekBy(10)"><span class="seek-symbol"><RotateCw /><span>10</span></span></button>
        </div>
        <button type="button" aria-label="打开选集" @click="emit('episodes')"><ListVideo /><span>选集</span></button>
        <button type="button" aria-label="打开播放设置" @click="emit('settings')"><SlidersHorizontal /><span>设置</span></button>
      </template>
    </div>
    <div v-show="!locked" class="transport">
      <button type="button" :aria-label="paused ? '播放' : '暂停'" @click="togglePlay"><Play v-if="paused" /><Pause v-else /></button>
      <span class="time">{{ clock(time) }}</span>
      <input class="seek-slider" type="range" :style="seekSliderStyle" aria-label="播放进度" :aria-valuetext="`${clock(time)} / ${clock(duration)}`" min="0" :max="duration || 1" step="0.1" :value="time" :disabled="!duration" @input="preview" @change="seek" @pointercancel="scrubbing = false; time = video.currentTime; seekNotice = ''; reveal()" />
      <span class="time">{{ clock(duration) }}</span>
      <button type="button" :aria-label="muted ? '取消静音' : '静音'" @click="toggleMute"><VolumeX v-if="muted" /><Volume2 v-else /></button>
      <input class="volume-slider" type="range" aria-label="音量" min="0" max="1" step="0.05" :value="muted ? 0 : volume" @input="changeVolume" />
      <select v-if="subtitles.length" aria-label="影片字幕" :value="subtitle" @change="selectSubtitle"><option value="off">字幕关</option><option v-for="track in subtitles" :key="track.id" :value="track.id">{{ track.label }}</option></select>
      <select aria-label="播放倍速" :value="speed" @change="changeSpeed"><option v-for="rate in rates" :key="rate" :value="rate">{{ rate }}×</option></select>
      <button
        v-if="desktop && supportsNativeFullscreen"
        type="button"
        :aria-label="isNativeFullscreen ? '退出系统全屏 (F)' : '系统全屏 (F)'"
        :title="isNativeFullscreen ? '退出系统全屏 (F)' : '系统全屏 (F)'"
        @click="toggleNativeFullscreen"
      >
        <Shrink v-if="isNativeFullscreen" />
        <Expand v-else />
      </button>
      <button
        type="button"
        :aria-label="desktop ? (expanded ? '退出网页全屏 (W)' : '网页全屏 (W)') : (expanded ? '退出横屏' : '横屏播放')"
        :title="desktop ? (expanded ? '退出网页全屏 (W)' : '网页全屏 (W)') : (expanded ? '退出横屏' : '横屏播放')"
        @click="emit('fullscreen')"
      >
        <Minimize v-if="expanded" />
        <Maximize v-else />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mobile-controls { position: absolute; z-index: 3; inset: auto 0 0; padding: 24px max(8px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); color: #fff; background: linear-gradient(transparent, rgb(0 0 0 / .72)); transition: opacity .2s; }
.mobile-controls.concealed:not(:has(:focus-visible)) { opacity: 0; pointer-events: none; }
.transport { display: flex; align-items: center; gap: 4px; }
button { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; padding: 10px; border: 0; background: transparent; color: inherit; }
button svg { width: 21px; height: 21px; }
input { flex: 1; min-width: 24px; height: 44px; margin: 0 5px; accent-color: #fff; touch-action: none; }
.time { font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
select { max-width: 80px; min-height: 44px; border: 0; color: #fff; background: #17191f; font-size: 12px; }
p { margin: 0 12px; font-size: 12px; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .mobile-controls { transition: none; } }

.control-tools { display: flex; align-items: center; justify-content: end; gap: 6px; margin-bottom: 2px; }
.control-tools button { display: inline-flex; justify-content: center; align-items: center; gap: 5px; width: auto; min-width: 44px; flex-basis: auto; padding: 8px 12px; border-radius: 6px; background: rgb(0 0 0 / .25); font-size: 12px; }
.control-tools svg { width: 18px; height: 18px; }
.seek-actions { display: flex; align-items: center; gap: 8px; margin-right: auto; }
.control-tools .seek-step { width: 44px; height: 44px; min-width: 44px; padding: 10px; border-radius: 10px; }
.seek-symbol { position: relative; display: block; width: 24px; height: 24px; }
.seek-symbol svg { width: 24px; height: 24px; }
.seek-symbol > span { position: absolute; inset: 0; display: grid; place-items: center; padding-top: 2px; font-size: 9px; font-weight: 700; line-height: 1; }
.mobile-controls.locked { background: transparent; }
.speed-notice { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 8px; padding: 8px 14px; background: rgb(0 0 0 / .7); color: #fff; border-radius: 8px; font-size: 12px; white-space: nowrap; }
.transport { flex-wrap: wrap; }
.transport input { order: -1; flex: 1 0 calc(100% - 112px); }
.transport .time { order: -1; width: 42px; text-align: center; }
.transport select { margin-left: auto; border-radius: 5px; padding: 0 5px; max-width: 95px; }
.mobile-controls { padding-top: 12px; }
@media (min-width: 821px) { .transport { flex-wrap: nowrap; } .transport input { order: 0; flex: 1; } .transport .time { order: 0; } }
.volume-slider, .desktop-shortcuts { display: none; }
@media (min-width: 1024px) and (pointer: fine) {
  .mobile-controls { padding: 28px 16px 8px; }
  .transport { gap: 8px; flex-wrap: wrap; }
  .transport .seek-slider { order: -2; flex: 1 0 100%; width: 100%; height: 24px; margin: 0; }
  .transport .volume-slider { display: block; order: 0; flex: 0 1 72px; width: 72px; min-width: 40px; }
  .transport .time { width: auto; }
  .transport .time + .seek-slider + .time::before { content: '/'; padding-right: 8px; color: #c5c5ca; }
  .transport select { min-width: 60px; margin-left: 0; }
  .transport select:first-of-type { margin-left: auto; }
  .desktop-shortcuts { display: block; margin-right: auto; color: #dedee3; font-size: 11px; }
  .seek-actions { order: -1; margin-right: 4px; }
  button:hover { background: rgb(255 255 255 / .15); border-radius: 6px; }
}
</style>
