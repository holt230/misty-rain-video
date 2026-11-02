<script setup lang="ts">
import type Hls from 'hls.js';
import { activeSubtitleTrack, selectSubtitleTrack, subtitleTrackOptions, subtitlePreference, subtitlePreferenceKey, subtitleEvents, type SubtitleTrackOption } from '../../services/subtitleTracks';
import { onBeforeUnmount, ref, watch } from 'vue';
import { LockKeyhole, UnlockKeyhole, ListVideo, SlidersHorizontal, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from '@lucide/vue';

const props = defineProps<{ video: HTMLVideoElement; expanded: boolean; hls?: Hls | null; username?: string }>();
const emit = defineEmits<{ (e: 'fullscreen'): void; (e: 'episodes'): void; (e: 'settings'): void; (e: 'lock-change', value: boolean): void }>();
const visible = ref(true);
const paused = ref(true);
const muted = ref(false);
const time = ref(0);
const duration = ref(0);
const scrubbing = ref(false);
const notice = ref('');
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
  reveal();
}
function seek() {
  if (!scrubbing.value) return;
  props.video.currentTime = Math.max(0, Math.min(duration.value, time.value));
  scrubbing.value = false;
  reveal();
}
function toggleMute() {
  const unmute = muted.value;
  props.video.muted = !unmute;
  if (unmute && props.video.volume === 0) props.video.volume = 1;
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
  scrubbing.value = false; notice.value = '';
  const sync = () => {
    paused.value = video.paused; muted.value = video.muted || video.volume === 0;
    duration.value = Number.isFinite(video.duration) ? video.duration : 0;
    if (!scrubbing.value) time.value = video.currentTime || 0;
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
    if (Math.abs(event.clientX - origin.x) + Math.abs(event.clientY - origin.y) > 12) endPress();
  };
  const tap = () => {
    if (locked.value) { reveal(); return; }
    if (suppressTap) { suppressTap = false; return; }
    if (visible.value && !video.paused) visible.value = false; else reveal();
  };
  const doubleTap = (event: Event) => { if (!locked.value) { event.preventDefault(); void togglePlay(); } };
  const contextMenu = (event: Event) => event.preventDefault();
  const keyboard = (event: KeyboardEvent) => {
    if (locked.value) return;
    if (event.key === ' ' || event.key === 'k') { event.preventDefault(); void togglePlay(); }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      video.currentTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : video.currentTime, video.currentTime + (event.key === 'ArrowRight' ? 10 : -10)));
      reveal();
    }
    if (event.key === 'f') emit('fullscreen');
    if (event.key === 'm') toggleMute();
  };
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
  video.addEventListener('keydown', keyboard);
  const events = ['timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked'];
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
    video.removeEventListener('keydown', keyboard);
    video.removeEventListener('loadedmetadata', restoreSpeed);
    hlsEvents.forEach(event => hls?.off(event, syncTracks));
    clearTimeout(timer);
  };
}, { immediate: true });
watch(() => props.expanded, value => { if (!value) locked.value = false; reveal(); });
onBeforeUnmount(() => { release(); emit('lock-change', false); });
</script>

<template>
  <div class="mobile-controls" :class="{ concealed: !visible, locked }" @pointerdown="reveal" @focusin="reveal">
    <p v-if="notice" role="status">{{ notice }}</p>
    <div v-if="boosted" class="speed-notice" role="status">正在加速播放 · 松手恢复</div>
    <div class="control-tools">
      <button v-if="expanded" type="button" :aria-label="locked ? '解锁播放控制' : '锁定播放控制'" @click="locked = !locked; reveal()"><UnlockKeyhole v-if="locked" /><LockKeyhole v-else /></button>
      <template v-if="!locked">
        <button type="button" aria-label="打开选集" @click="emit('episodes')"><ListVideo /><span>选集</span></button>
        <button type="button" aria-label="打开播放设置" @click="emit('settings')"><SlidersHorizontal /><span>设置</span></button>
      </template>
    </div>
    <div v-show="!locked" class="transport">
      <button type="button" :aria-label="paused ? '播放' : '暂停'" @click="togglePlay"><Play v-if="paused" /><Pause v-else /></button>
      <span class="time">{{ clock(time) }}</span>
      <input type="range" aria-label="播放进度" :aria-valuetext="`${clock(time)} / ${clock(duration)}`" min="0" :max="duration || 1" step="0.1" :value="time" :disabled="!duration" @input="preview" @change="seek" @pointercancel="scrubbing = false; time = video.currentTime; reveal()" />
      <span class="time">{{ clock(duration) }}</span>
      <button type="button" :aria-label="muted ? '取消静音' : '静音'" @click="toggleMute"><VolumeX v-if="muted" /><Volume2 v-else /></button>
      <select v-if="subtitles.length" aria-label="影片字幕" :value="subtitle" @change="selectSubtitle"><option value="off">字幕关</option><option v-for="track in subtitles" :key="track.id" :value="track.id">{{ track.label }}</option></select>
      <select aria-label="播放倍速" :value="speed" @change="changeSpeed"><option v-for="rate in rates" :key="rate" :value="rate">{{ rate }}×</option></select>
      <button type="button" :aria-label="expanded ? '退出横屏' : '横屏播放'" @click="emit('fullscreen')"><Minimize v-if="expanded" /><Maximize v-else /></button>
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
.mobile-controls.locked { background: transparent; }
.speed-notice { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 8px; padding: 8px 14px; background: rgb(0 0 0 / .7); color: #fff; border-radius: 8px; font-size: 12px; white-space: nowrap; }
.transport { flex-wrap: wrap; }
.transport input { order: -1; flex: 1 0 calc(100% - 112px); }
.transport .time { order: -1; width: 42px; text-align: center; }
.transport select { margin-left: auto; border-radius: 5px; padding: 0 5px; max-width: 95px; }
.mobile-controls { padding-top: 12px; }
@media (min-width: 821px) { .transport { flex-wrap: nowrap; } .transport input { order: 0; flex: 1; } .transport .time { order: 0; } }
</style>
