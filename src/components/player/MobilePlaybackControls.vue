<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from '@lucide/vue';

const props = defineProps<{ video: HTMLVideoElement; expanded: boolean }>();
const emit = defineEmits<{ (e: 'fullscreen'): void }>();
const visible = ref(true);
const paused = ref(true);
const muted = ref(false);
const time = ref(0);
const duration = ref(0);
const scrubbing = ref(false);
const notice = ref('');
const subtitles = ref<{ index: number; label: string }[]>([]);
const subtitle = ref('-1');
let timer: ReturnType<typeof setTimeout> | undefined;
let release = () => {};
const clock = (value: number) => {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
function reveal() {
  visible.value = true;
  clearTimeout(timer);
  if (!props.video.paused && !scrubbing.value) timer = setTimeout(() => { visible.value = false; }, 3500);
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
  const index = Number((event.target as HTMLSelectElement).value);
  Array.from(props.video.textTracks).forEach((track, i) => {
    if (track.kind === 'subtitles' || track.kind === 'captions') track.mode = i === index ? 'showing' : 'disabled';
  });
  reveal();
}
watch(() => props.video, video => {
  release();
  scrubbing.value = false; notice.value = '';
  const sync = () => {
    paused.value = video.paused; muted.value = video.muted || video.volume === 0;
    duration.value = Number.isFinite(video.duration) ? video.duration : 0;
    if (!scrubbing.value) time.value = video.currentTime || 0;
  };
  const syncTracks = () => {
    subtitles.value = Array.from(video.textTracks).flatMap((track, index) =>
      track.kind === 'subtitles' || track.kind === 'captions' ? [{ index, label: track.label || track.language || `字幕 ${index + 1}` }] : []);
    subtitle.value = String(Array.from(video.textTracks).findIndex(track =>
      (track.kind === 'subtitles' || track.kind === 'captions') && track.mode === 'showing'));
  };
  const playback = () => { sync(); reveal(); };
  const tap = () => { if (visible.value && !video.paused) visible.value = false; else reveal(); };
  const events = ['timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked'];
  events.forEach(event => video.addEventListener(event, sync));
  ['play', 'pause', 'ended'].forEach(event => video.addEventListener(event, playback));
  ['addtrack', 'removetrack', 'change'].forEach(event => video.textTracks.addEventListener(event, syncTracks));
  video.addEventListener('click', tap);
  sync(); syncTracks(); reveal();
  release = () => {
    events.forEach(event => video.removeEventListener(event, sync));
    ['play', 'pause', 'ended'].forEach(event => video.removeEventListener(event, playback));
    ['addtrack', 'removetrack', 'change'].forEach(event => video.textTracks.removeEventListener(event, syncTracks));
    video.removeEventListener('click', tap);
    clearTimeout(timer);
  };
}, { immediate: true });
watch(() => props.expanded, reveal);
onBeforeUnmount(() => release());
</script>

<template>
  <div class="mobile-controls" :class="{ concealed: !visible }" @pointerdown="reveal" @focusin="reveal">
    <p v-if="notice" role="status">{{ notice }}</p>
    <div class="transport">
      <button type="button" :aria-label="paused ? '播放' : '暂停'" @click="togglePlay"><Play v-if="paused" /><Pause v-else /></button>
      <span class="time">{{ clock(time) }}</span>
      <input type="range" aria-label="播放进度" :aria-valuetext="`${clock(time)} / ${clock(duration)}`" min="0" :max="duration || 1" step="0.1" :value="time" :disabled="!duration" @input="preview" @change="seek" @pointercancel="scrubbing = false; time = video.currentTime; reveal()" />
      <span class="time">{{ clock(duration) }}</span>
      <button type="button" :aria-label="muted ? '取消静音' : '静音'" @click="toggleMute"><VolumeX v-if="muted" /><Volume2 v-else /></button>
      <select v-if="subtitles.length" aria-label="影片字幕" :value="subtitle" @change="selectSubtitle"><option value="-1">字幕关</option><option v-for="track in subtitles" :key="track.index" :value="track.index">{{ track.label }}</option></select>
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
</style>
