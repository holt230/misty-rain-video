<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type Hls from 'hls.js';
import { ChevronDown } from '@lucide/vue';
import { activeSubtitleTrack, selectSubtitleTrack, subtitleTrackOptions, subtitlePreference, subtitlePreferenceKey, subtitleEvents, type SubtitleTrackOption } from '../../services/subtitleTracks';
const props = defineProps<{ video: HTMLVideoElement; hls?: Hls | null; compact?: boolean; notice?: string; username?: string }>();
const options = ref<SubtitleTrackOption[]>([]);
const selected = ref('off');
const error = ref('');
const preferenceKey = subtitlePreferenceKey(props.username);
let preference = 'off';
try { preference = localStorage.getItem(preferenceKey) || 'off'; } catch { /* Current session remains usable. */ }
let release = () => {};
let applying = false;
let generation = 0;
const sync = () => {
  if (applying) return;
  try { preference = localStorage.getItem(preferenceKey) || 'off'; } catch { /* Keep this session's preference. */ }
  options.value = subtitleTrackOptions(props.video, props.hls);
  const desired = preference === 'off' ? 'off' : options.value.find(option =>
    subtitlePreference(option) === preference)?.id;
  if (desired && desired !== activeSubtitleTrack(props.video, props.hls)) {
    applying = true;
    selectSubtitleTrack(props.video, props.hls, desired);
    applying = false;
  }
  selected.value = activeSubtitleTrack(props.video, props.hls);
};
const choose = (event: Event) => {
  const id = (event.target as HTMLSelectElement).value;
  const option = options.value.find(item => item.id === id);
  preference = subtitlePreference(option);
  try { localStorage.setItem(preferenceKey, preference); } catch { /* Keep the active selection. */ }
  error.value = '';
  applying = true;
  selectSubtitleTrack(props.video, props.hls, id);
  applying = false;
  selected.value = id;
};
const retry = () => {
  const element = Array.from(props.video.querySelectorAll('track')).find(item => item.track.mode === 'showing');
  if (!element) return;
  const url = new URL(element.src, location.href); url.searchParams.set('_retry', String(Date.now()));
  error.value = ''; element.src = url.toString();
};
watch([() => props.video, () => props.hls] as const, async ([video, hls]) => {
  release(); const seq = ++generation;
  await nextTick(); if (seq !== generation) return;
  const failed = () => { error.value = '字幕加载失败，可重试或选择其他字幕；影片仍可继续播放。'; };
  const loaded = () => { error.value = ''; sync(); };
  const tracks = Array.from(video.querySelectorAll('track'));
  const events = ['addtrack', 'removetrack', 'change'];
  events.forEach(event => video.textTracks.addEventListener(event, sync));
  video.addEventListener('loadedmetadata', sync);
  tracks.forEach(track => { track.addEventListener('load', loaded); track.addEventListener('error', failed); });
  const hlsEvents = hls ? subtitleEvents(hls) : [];
  hlsEvents.forEach(event => hls?.on(event, sync));
  sync();
  release = () => {
    events.forEach(event => video.textTracks.removeEventListener(event, sync));
    video.removeEventListener('loadedmetadata', sync);
    tracks.forEach(track => { track.removeEventListener('load', loaded); track.removeEventListener('error', failed); });
    hlsEvents.forEach(event => hls?.off(event, sync));
  };
}, { immediate: true });
onBeforeUnmount(() => { generation += 1; release(); });
</script>
<template>
  <div class="subtitle-controls" :class="{ compact }">
    <div class="subtitle-select">
      <select aria-label="选择影片字幕" :value="selected" @change="choose">
        <option value="off">字幕关闭</option>
        <option v-for="option in options" :key="option.id" :value="option.id">{{ option.label }}</option>
      </select>
      <ChevronDown aria-hidden="true" />
    </div>
    <template v-if="!compact">
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="error" role="alert">{{ error }} <button type="button" @click="retry">重试字幕</button></p>
      <p v-else-if="!options.length">尚未检测到字幕。支持同目录VTT、SRT、ASS和SSA文件；部分内嵌字幕需要浏览器或网盘转码支持。</p>
    </template>
  </div>
</template>
<style scoped>
.subtitle-controls { min-width: 0; }
.subtitle-select { position: relative; }
.subtitle-select > svg { position: absolute; top: 50%; right: 16px; width: 18px; height: 18px; transform: translateY(-50%); color: var(--text-secondary); pointer-events: none; }
select { display: block; appearance: none; -webkit-appearance: none; width: 100%; height: 48px; padding: 0 44px 0 16px; border: 1px solid var(--divider); border-radius: 14px; color: var(--text-primary); background: var(--surface-2); font-size: 16px; line-height: normal; }
p { margin-top: 8px; color: var(--text-tertiary); font-size: .73rem; line-height: 1.7; }
button { border: 0; padding: 4px; color: var(--liquid-accent); background: transparent; }
.compact .subtitle-select { max-width: 130px; }
.compact .subtitle-select > svg { right: 10px; width: 14px; height: 14px; }
.compact select { height: 36px; padding: 0 30px 0 10px; border: 1px solid rgb(255 255 255 / .25); color: #fff; background: rgb(0 0 0 / .55); font-size: .7rem; }
</style>
