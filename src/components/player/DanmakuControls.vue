<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type Danmaku from 'danmaku';
import { DanmakuService, platformLabels, type DanmakuInput, type DanmakuPlatform, type DanmakuSource, type DanmakuWork, type DanmakuSegment } from '../../services/danmakuService';
import { displayComments } from '../../services/danmakuDisplay';

const props = defineProps<{ video: HTMLVideoElement; input: DanmakuInput }>();
const enabled = ref(localStorage.getItem('misty_rain_danmaku_enabled') === 'true');
const expanded = ref(false);
const opacity = ref(Math.max(.3, Math.min(1, Number(localStorage.getItem('misty_rain_danmaku_opacity')) || .75)));
const density = ref<'low' | 'normal'>(localStorage.getItem('misty_rain_danmaku_density') === 'normal' ? 'normal' : 'low');
const offset = ref(0);
const source = ref<DanmakuSource | null>(null);
const candidates = ref<DanmakuWork[]>([]);
const message = ref('');
const matching = ref(false);
const loading = ref(false);
const query = ref('');
const choosing = ref(false);
const fetchedAt = ref(0);
const stale = ref(false);
const overlay = ref<HTMLElement | null>(null);
const nativeFullscreen = ref(false);
const hiddenPage = ref(document.hidden);
const segments = new Map<number, DanmakuSegment>();
const pending = new Set<number>();
const failedUntil = new Map<number, number>();
let controller = new AbortController();
let generation = 0, renderGeneration = 0;
let engine: Danmaku | null = null;
let observer: ResizeObserver | null = null;
let interval: number | null = null;
let boundVideo: HTMLVideoElement | null = null;
const target = computed(() => props.video.parentElement);
const active = computed(() => enabled.value && !nativeFullscreen.value && !hiddenPage.value);
const refreshedLabel = computed(() => fetchedAt.value ? new Date(fetchedAt.value).toLocaleString('zh-CN', { hour12: false }) : '');
const status = computed(() => {
  if (!enabled.value) return '开启后自动匹配';
  if (nativeFullscreen.value) return '系统全屏不显示网页弹幕';
  if (matching.value) return '正在匹配弹幕…';
  if (message.value) return message.value;
  if (loading.value && !fetchedAt.value) return '正在加载弹幕…';
  if (source.value) return `${platformLabels[source.value.platform]} · ${source.value.episodeTitle}${stale.value ? ' · 使用缓存' : ''}`;
  return '未找到对应弹幕';
});
function destroyEngine() { renderGeneration++; engine?.destroy(); engine = null; }
async function render() {
  const seq = ++renderGeneration;
  if (!active.value || !source.value || !overlay.value) { engine?.hide(); return; }
  try {
    const { default: Renderer } = await import('danmaku');
    if (seq !== renderGeneration || !active.value || !overlay.value) return;
    engine?.destroy();
    engine = new Renderer({ container: overlay.value, media: props.video, engine: 'dom', speed: 100,
      comments: displayComments([...segments.values()].flatMap(item => item.comments), density.value, offset.value) });
  } catch { message.value = '弹幕显示暂不可用，请刷新页面'; }
}
function reset() {
  generation++; controller.abort(); controller = new AbortController();
  pending.clear(); failedUntil.clear(); segments.clear(); destroyEngine();
  loading.value = false; matching.value = false; message.value = ''; fetchedAt.value = 0; stale.value = false;
}
async function setSource(value: DanmakuSource) {
  reset(); source.value = value; choosing.value = false;
  offset.value = Number(localStorage.getItem(`misty_rain_danmaku_offset:${props.input.mediaKey}:${value.workId || value.id}`)) || 0;
  offset.value = Math.max(-300, Math.min(300, offset.value));
  await loadCurrent();
}
async function match(manual = false) {
  reset(); source.value = null; candidates.value = []; matching.value = true;
  const seq = generation;
  try {
    const inputQuery = manual ? query.value.trim() : '';
    if (/^https?:\/\//i.test(inputQuery)) {
      const selected = await DanmakuService.select(props.input, { url: inputQuery }, controller.signal);
      if (seq === generation) await setSource(selected);
      return;
    }
    const result = await DanmakuService.match(props.input, controller.signal, inputQuery);
    if (seq !== generation) return;
    candidates.value = result.candidates;
    if (result.selected) await setSource(result.selected);
    else {
      choosing.value = true;
      message.value = result.candidates.length ? '请选择对应作品与平台' : '未找到对应弹幕，可搜索或粘贴本集平台链接';
    }
  } catch (error) {
    if (seq === generation) { message.value = error instanceof Error ? error.message : '弹幕匹配失败'; choosing.value = true; }
  } finally { if (seq === generation) matching.value = false; }
}
async function choose(workId: string, platform: DanmakuPlatform) {
  reset(); source.value = null; matching.value = true;
  const seq = generation;
  try {
    const selected = await DanmakuService.select(props.input, { workId, platform }, controller.signal);
    if (seq === generation) await setSource(selected);
  } catch (error) { if (seq === generation) message.value = error instanceof Error ? error.message : '暂时无法关联'; }
  finally { if (seq === generation) matching.value = false; }
}
const currentIndex = () => source.value ? Math.floor(Math.max(0, props.video.currentTime - offset.value) / source.value.segmentSeconds) : 0;
async function loadSegment(index: number, force = false) {
  const selected = source.value;
  if (!selected || !active.value || pending.has(index)) return;
  const cached = segments.get(index);
  if (!force && (cached && Date.now() - cached.fetchedAt < 600_000 || (failedUntil.get(index) || 0) > Date.now())) return;
  const seq = generation;
  pending.add(index); loading.value = true;
  try {
    const data = await DanmakuService.segment(selected, index, force, controller.signal);
    if (seq !== generation) return;
    segments.set(index, data);
    // Keep a small moving window; seeking back can load the shared server cache.
    for (const key of segments.keys()) if (Math.abs(key - currentIndex()) > 2) segments.delete(key);
    if (data.stale) failedUntil.set(index, Date.now() + 30_000);
    if (index === currentIndex()) { fetchedAt.value = data.fetchedAt; stale.value = data.stale; message.value = data.comments.length ? '' : '当前时间段暂无弹幕'; }
    await render();
  } catch (error) {
    if (seq === generation) {
      failedUntil.set(index, Date.now() + 30_000);
      if (index === currentIndex()) message.value = error instanceof Error ? error.message : '弹幕暂不可用，视频可继续播放';
    }
  } finally { if (seq === generation) { pending.delete(index); loading.value = pending.size > 0; } }
}
async function loadCurrent(force = false) {
  if (!active.value || !source.value || matching.value) return;
  const index = currentIndex();
  const cached = segments.get(index);
  if (cached) {
    fetchedAt.value = cached.fetchedAt; stale.value = cached.stale;
    message.value = cached.stale ? '弹幕暂不可用，正在显示缓存' : cached.comments.length ? '' : '当前时间段暂无弹幕';
  }
  await loadSegment(index, force);
  if (active.value && source.value && !force && !props.video.paused) {
    const nextStart = (index + 1) * source.value.segmentSeconds + offset.value;
    if (!Number.isFinite(props.video.duration) || nextStart < props.video.duration) void loadSegment(index + 1);
  }
}
function refresh() { message.value = ''; if (source.value) void loadCurrent(true); else void match(); }
function visibility() { hiddenPage.value = document.hidden; }
function fullscreen() {
  nativeFullscreen.value = Boolean(document.fullscreenElement === props.video || (props.video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }).webkitDisplayingFullscreen);
}
function beginFullscreen() { nativeFullscreen.value = true; }
function endFullscreen() { nativeFullscreen.value = false; }
function seek() { engine?.clear(); void loadCurrent(); }
function rateChange() { void render(); }
function bindVideo(video: HTMLVideoElement | null) {
  if (boundVideo) {
    boundVideo.removeEventListener('seeked', seek); boundVideo.removeEventListener('ratechange', rateChange);
    boundVideo.removeEventListener('webkitbeginfullscreen', beginFullscreen); boundVideo.removeEventListener('webkitendfullscreen', endFullscreen);
  }
  boundVideo = video;
  if (video) {
    video.addEventListener('seeked', seek); video.addEventListener('ratechange', rateChange);
    video.addEventListener('webkitbeginfullscreen', beginFullscreen); video.addEventListener('webkitendfullscreen', endFullscreen);
  }
}
watch(enabled, value => {
  localStorage.setItem('misty_rain_danmaku_enabled', String(value));
  if (value) void match(); else { reset(); source.value = null; }
});
watch(active, async value => {
  if (!value) engine?.hide();
  else { await nextTick(); await render(); void loadCurrent(); }
});
watch([density, opacity], () => {
  localStorage.setItem('misty_rain_danmaku_density', density.value);
  localStorage.setItem('misty_rain_danmaku_opacity', String(opacity.value));
  void render();
});
watch(offset, () => {
  if (source.value) localStorage.setItem(`misty_rain_danmaku_offset:${props.input.mediaKey}:${source.value.workId || source.value.id}`, String(offset.value));
  void render(); void loadCurrent();
});
watch(() => `${props.input.mediaKey}:${props.input.episodeNumber}:${props.input.episodeTitle}`, () => {
  query.value = ''; if (enabled.value) void match(); else { reset(); source.value = null; }
});
watch(() => props.video, async video => { bindVideo(video); fullscreen(); await nextTick(); void render(); });
onMounted(() => {
  bindVideo(props.video); fullscreen();
  observer = new ResizeObserver(() => engine?.resize());
  if (overlay.value) observer.observe(overlay.value);
  interval = window.setInterval(() => { if (!props.video.paused) void loadCurrent(); }, 1000);
  document.addEventListener('visibilitychange', visibility); document.addEventListener('fullscreenchange', fullscreen);
  if (enabled.value) void match();
});
onBeforeUnmount(() => {
  reset(); bindVideo(null); observer?.disconnect(); if (interval !== null) window.clearInterval(interval);
  document.removeEventListener('visibilitychange', visibility); document.removeEventListener('fullscreenchange', fullscreen);
});
</script>

<template>
  <Teleport v-if="target" :to="target">
    <div ref="overlay" class="danmaku-overlay" :style="{ opacity, visibility: active ? 'visible' : 'hidden' }" aria-hidden="true" />
  </Teleport>
  <div class="danmaku-controls">
    <div class="danmaku-row">
      <button class="danmaku-toggle" type="button" role="switch" aria-label="弹幕" :aria-checked="enabled" @click="enabled = !enabled"><span aria-hidden="true">弹</span>弹幕{{ enabled ? '开' : '关' }}</button>
      <p role="status">{{ status }}</p>
      <button v-if="enabled" type="button" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起' : choosing ? '选择弹幕' : '弹幕设置' }}</button>
    </div>
    <div v-if="enabled && expanded" class="danmaku-settings">
      <div v-if="source" class="danmaku-source">
        <strong>{{ source.title }} {{ source.year }} · {{ platformLabels[source.platform] }}</strong>
        <small>{{ source.episodeTitle }}</small>
        <small v-if="refreshedLabel">获取于 {{ refreshedLabel }}{{ stale ? ' · 暂用缓存' : '' }}</small>
      </div>
      <div class="danmaku-actions">
        <button type="button" :disabled="loading || matching" @click="refresh">刷新弹幕</button>
        <button type="button" :disabled="matching" @click="choosing = !choosing">{{ choosing ? '收起来源选择' : '更换来源' }}</button>
      </div>
      <form v-if="choosing" class="danmaku-search" @submit.prevent="match(true)">
        <label for="danmaku-query">搜索片名或粘贴本集平台链接</label>
        <div><input id="danmaku-query" v-model="query" maxlength="1000" placeholder="片名，或腾讯 / 爱奇艺 / 优酷剧集链接" /><button type="submit" :disabled="matching || !query.trim()">{{ matching ? '查找中' : '查找' }}</button></div>
      </form>
      <ul v-if="choosing && candidates.length" class="danmaku-candidates" aria-label="弹幕作品候选">
        <li v-for="work in candidates" :key="work.id">
          <strong>{{ work.title }}</strong><small>{{ work.year }} · {{ work.categoryLabel }}</small>
          <div><button v-for="platform in work.platforms" :key="platform" type="button" :disabled="matching" @click="choose(work.id, platform)">使用{{ platformLabels[platform] }}弹幕</button></div>
        </li>
      </ul>
      <div class="danmaku-preferences">
        <label>密度<select v-model="density" aria-label="弹幕密度"><option value="low">少量</option><option value="normal">适中</option></select></label>
        <label>透明度 {{ Math.round(opacity * 100) }}%<input v-model.number="opacity" aria-label="弹幕透明度" type="range" min="0.3" max="1" step="0.05" /></label>
        <div class="danmaku-offset"><span>时间校准：{{ offset > 0 ? '+' : '' }}{{ offset }} 秒</span><div><button type="button" :disabled="offset <= -300" @click="offset = Math.max(-300, offset - 1)">提前 1 秒</button><button type="button" @click="offset = 0">重置</button><button type="button" :disabled="offset >= 300" @click="offset = Math.min(300, offset + 1)">延后 1 秒</button></div></div>
      </div>
      <p class="danmaku-help">弹幕显示在画面上部。iPhone 系统全屏不显示网页弹幕；获取时间不代表平台数据的实时更新时间。</p>
    </div>
  </div>
</template>

<style scoped>
.danmaku-overlay { position: absolute; z-index: 1; inset: 10px 8px auto; height: 42%; overflow: hidden; pointer-events: none; contain: layout paint; }
.danmaku-controls { flex: 0 0 auto; min-width: 0; color: var(--text-primary); }
.danmaku-row { display: flex; align-items: center; gap: 10px; padding-top: 8px; }
.danmaku-row p { flex: 1; min-width: 0; margin: 0; color: var(--text-secondary); font-size: .72rem; line-height: 1.5; }
.danmaku-controls button { min-height: 44px; padding: 7px 12px; border: 0; border-radius: 10px; background: var(--surface-1); color: var(--text-primary); font-size: .74rem; }
.danmaku-controls button:disabled { opacity: .5; }
.danmaku-controls button:focus-visible, .danmaku-controls input:focus-visible, .danmaku-controls select:focus-visible { outline: 2px solid var(--liquid-accent); outline-offset: 2px; }
.danmaku-toggle { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.danmaku-toggle span { border: 1px solid currentColor; border-radius: 4px; padding: 0 3px; }
.danmaku-toggle[aria-checked='true'] { color: var(--liquid-accent-strong); background: var(--glass-lens); }
.danmaku-settings { margin-top: 8px; padding: 14px; border-radius: 12px; background: var(--surface-1); display: grid; gap: 14px; }
.danmaku-source { display: grid; gap: 4px; }
.danmaku-source strong, .danmaku-candidates strong { font-size: .8rem; }
.danmaku-source small, .danmaku-candidates small, .danmaku-help { color: var(--text-secondary); font-size: .7rem; line-height: 1.6; }
.danmaku-actions, .danmaku-search > div, .danmaku-offset > div, .danmaku-candidates li > div { display: flex; gap: 8px; flex-wrap: wrap; }
.danmaku-settings button { background: var(--glass-bg); }
.danmaku-search { display: grid; gap: 6px; }
.danmaku-search label, .danmaku-preferences { font-size: .75rem; }
.danmaku-search input { flex: 1; min-width: 140px; }
.danmaku-controls input:not([type='range']), .danmaku-controls select { min-height: 44px; border: var(--glass-border); border-radius: 8px; padding: 8px; background: var(--surface-1); color: var(--text-primary); font-size: 16px; }
.danmaku-preferences { display: grid; gap: 12px; }
.danmaku-preferences label { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.danmaku-preferences input[type='range'] { min-height: 44px; width: 55%; accent-color: var(--liquid-accent); }
.danmaku-offset { display: grid; gap: 6px; }
.danmaku-candidates { display: grid; gap: 12px; list-style: none; margin: 0; padding: 0; max-height: 280px; overflow-y: auto; }
.danmaku-candidates li { display: grid; gap: 6px; }
.danmaku-help { margin: 0; }
</style>
