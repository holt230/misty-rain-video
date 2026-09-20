<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type Danmaku from 'danmaku';
import { SlidersHorizontal } from '@lucide/vue';
import { DanmakuService, DanmakuRequestError, platformLabels, type DanmakuInput, type DanmakuPlatform, type DanmakuSource, type DanmakuWork, type DanmakuSegment } from '../../services/danmakuService';
import { displayComments } from '../../services/danmakuDisplay';
import { nativeDanmakuTrack } from '../../services/nativeDanmakuTrack';

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
const advanced = ref(false);
const recovery = ref<'choose' | 'retry' | ''>('');
const recoveryHint = ref('');
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
const nativeAvailable = ref(true);
let retryAction: (() => Promise<void>) | null = null;
const target = computed(() => props.video.parentElement);
const canLoad = computed(() => enabled.value && !hiddenPage.value);
const active = computed(() => canLoad.value && !nativeFullscreen.value);
const refreshedLabel = computed(() => fetchedAt.value ? new Date(fetchedAt.value).toLocaleString('zh-CN', { hour12: false }) : '');
const status = computed(() => {
  if (!enabled.value) return '';
  if (nativeFullscreen.value) return nativeAvailable.value ? '系统全屏尝试使用字幕式弹幕' : '此浏览器不支持全屏弹幕，请退出全屏观看';
  if (matching.value) return '正在找弹幕…';
  if (loading.value && recovery.value === 'retry') return '正在重试…';
  if (loading.value && !fetchedAt.value) return '正在加载…';
  if (recovery.value && recoveryHint.value) return recoveryHint.value;
  if (recovery.value === 'choose') return '确认一下片名，就能继续查找';
  if (recovery.value === 'retry') return '弹幕暂时没加载出来';
  if (message.value === '当前时间段暂无弹幕') return '这里暂时没有弹幕';
  return '';
});
function openChooser() {
  choosing.value = true; expanded.value = false; advanced.value = false;
  query.value = props.input.title;
  if (!candidates.value.length && !matching.value) void match(query.value);
}
function toggleSettings() {
  expanded.value = !expanded.value; choosing.value = false; advanced.value = false;
}
function matchFailure(error: unknown) {
  message.value = error instanceof Error ? error.message : '弹幕暂时没加载出来';
  const code = error instanceof DanmakuRequestError ? error.code : '';
  recovery.value = code === 'DANMAKU_EPISODE_NOT_FOUND' ? 'choose' : 'retry';
  recoveryHint.value = code === 'DANMAKU_EPISODE_NOT_FOUND' ? '本集暂未收录弹幕'
    : code === 'DANMAKU_SOURCE_UNAVAILABLE' ? '弹幕来源连接失败，请重试'
    : code === 'DANMAKU_CATALOG_UNAVAILABLE' ? '弹幕目录暂不可用，请重试' : '';
}

function clearNativeTrack() {
  if (boundVideo) nativeDanmakuTrack(boundVideo).clear();
}
function disposeNativeTrack() {
  if (boundVideo) nativeDanmakuTrack(boundVideo).suspend();
}
function syncNativeTrack() {
  if (!boundVideo) return;
  nativeAvailable.value = nativeDanmakuTrack(boundVideo).sync(enabled.value && nativeFullscreen.value,
    displayComments([...segments.values()].flatMap(item => item.comments), density.value, offset.value));
}

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
  } catch { message.value = '弹幕显示暂不可用，请刷新页面'; recovery.value = 'retry'; }
}
function reset() {
  generation++; controller.abort(); controller = new AbortController();
  pending.clear(); failedUntil.clear(); segments.clear(); destroyEngine();
  loading.value = false; matching.value = false; recovery.value = ''; recoveryHint.value = ''; retryAction = null;
  message.value = ''; fetchedAt.value = 0; stale.value = false;
  clearNativeTrack();
}
async function setSource(value: DanmakuSource) {
  reset(); source.value = value; choosing.value = false; expanded.value = false; advanced.value = false;
  offset.value = Number(localStorage.getItem(`misty_rain_danmaku_offset:${props.input.mediaKey}:${value.workId || value.id}`)) || 0;
  offset.value = Math.max(-300, Math.min(300, offset.value));
  await loadCurrent();
}
async function match(queryText = '') {
  reset(); source.value = null; candidates.value = []; matching.value = true;
  const inputQuery = queryText.trim();
  retryAction = () => match(inputQuery);
  const seq = generation;
  try {
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
      recovery.value = 'choose';
      message.value = result.candidates.length ? '选一下正在看的作品，我们会记住' : '没有找到，试试更短的片名';
    }
  } catch (error) {
    if (seq === generation) matchFailure(error);
  } finally { if (seq === generation) matching.value = false; }
}
async function choose(workId: string, platform?: DanmakuPlatform) {
  reset(); source.value = null; matching.value = true;
  retryAction = () => choose(workId, platform);
  const seq = generation;
  try {
    const selected = await DanmakuService.select(props.input, { workId, platform }, controller.signal);
    if (seq === generation) await setSource(selected);
  } catch (error) { if (seq === generation) matchFailure(error); }
  finally { if (seq === generation) matching.value = false; }
}
const currentIndex = () => source.value ? Math.floor(Math.max(0, props.video.currentTime - offset.value) / source.value.segmentSeconds) : 0;
async function loadSegment(index: number, force = false) {
  const selected = source.value;
  if (!selected || !canLoad.value || pending.has(index)) return;
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
    if (index === currentIndex()) {
      recovery.value = data.stale ? 'retry' : ''; recoveryHint.value = data.stale ? '弹幕更新失败，正在显示缓存' : '';
      fetchedAt.value = data.fetchedAt; stale.value = data.stale; message.value = data.comments.length ? '' : '当前时间段暂无弹幕';
    }
    await render(); syncNativeTrack();
  } catch (error) {
    if (seq === generation) {
      failedUntil.set(index, Date.now() + 30_000);
      if (index === currentIndex()) { recovery.value = 'retry'; recoveryHint.value = ''; message.value = error instanceof Error ? error.message : '弹幕暂不可用，视频可继续播放'; }
    }
  } finally { if (seq === generation) { pending.delete(index); loading.value = pending.size > 0; } }
}
async function loadCurrent(force = false) {
  if (!canLoad.value || !source.value || matching.value) return;
  const index = currentIndex();
  const cached = segments.get(index);
  if (cached) {
    fetchedAt.value = cached.fetchedAt; stale.value = cached.stale; recovery.value = cached.stale ? 'retry' : '';
    recoveryHint.value = cached.stale ? '弹幕更新失败，正在显示缓存' : '';
    message.value = cached.stale ? '弹幕暂不可用，正在显示缓存' : cached.comments.length ? '' : '当前时间段暂无弹幕';
  }
  await loadSegment(index, force);
  if (canLoad.value && source.value && !force && !props.video.paused) {
    const nextStart = (index + 1) * source.value.segmentSeconds + offset.value;
    if (!Number.isFinite(props.video.duration) || nextStart < props.video.duration) void loadSegment(index + 1);
  }
}
function refresh() {
  if (loading.value || matching.value) return;
  if (source.value) void loadCurrent(true);
  else if (retryAction) void retryAction();
  else void match();
}
function visibility() { hiddenPage.value = document.hidden; }
function fullscreen() {
  nativeFullscreen.value = Boolean(document.fullscreenElement === props.video || (props.video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }).webkitDisplayingFullscreen);
  syncNativeTrack();
}
function beginFullscreen() { nativeFullscreen.value = true; syncNativeTrack(); }
function endFullscreen() { nativeFullscreen.value = false; syncNativeTrack(); }
function seek() { engine?.clear(); void loadCurrent(); }
function rateChange() { void render(); }
function bindVideo(video: HTMLVideoElement | null) {
  if (boundVideo) {
    boundVideo.removeEventListener('seeked', seek); boundVideo.removeEventListener('ratechange', rateChange);
    boundVideo.removeEventListener('webkitbeginfullscreen', beginFullscreen); boundVideo.removeEventListener('webkitendfullscreen', endFullscreen);
  }
  disposeNativeTrack();
  boundVideo = video;
  if (video) {
    video.addEventListener('seeked', seek); video.addEventListener('ratechange', rateChange);
    video.addEventListener('webkitbeginfullscreen', beginFullscreen); video.addEventListener('webkitendfullscreen', endFullscreen);
  }
}
watch(enabled, value => {
  localStorage.setItem('misty_rain_danmaku_enabled', String(value));
  syncNativeTrack();
  if (value) void match(); else { reset(); source.value = null; expanded.value = false; choosing.value = false; advanced.value = false; }
});
watch(active, async value => {
  if (!value) engine?.hide();
  else { await nextTick(); await render(); void loadCurrent(); }
});
watch([density, opacity], () => {
  localStorage.setItem('misty_rain_danmaku_density', density.value);
  localStorage.setItem('misty_rain_danmaku_opacity', String(opacity.value));
  void render(); syncNativeTrack();
});
watch(offset, () => {
  if (source.value) localStorage.setItem(`misty_rain_danmaku_offset:${props.input.mediaKey}:${source.value.workId || source.value.id}`, String(offset.value));
  void render(); syncNativeTrack(); void loadCurrent();
});
watch(() => `${props.input.mediaKey}:${props.input.episodeNumber}:${props.input.episodeTitle}`, () => {
  query.value = ''; expanded.value = false; choosing.value = false; advanced.value = false; if (enabled.value) void match(); else { reset(); source.value = null; }
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
      <button v-if="enabled && recovery && !matching && !loading && !nativeFullscreen" type="button" class="danmaku-recovery" @click="recovery === 'choose' ? openChooser() : refresh()">{{ recovery === 'choose' ? '选一下片名' : '重试' }}</button>
      <button v-if="enabled" type="button" class="danmaku-settings-toggle" aria-label="弹幕设置" :aria-expanded="expanded" @click="toggleSettings"><SlidersHorizontal aria-hidden="true" /></button>
    </div>
    <div v-if="enabled && choosing" class="danmaku-settings">
      <div class="danmaku-panel-heading"><strong>选一下正在看的作品</strong><button type="button" @click="choosing = false">收起</button></div>
      <p class="danmaku-help">选对一次就会记住，平台由系统选择。</p>
      <form class="danmaku-search" @submit.prevent="match(query)">
        <label for="danmaku-query">片名</label>
        <div><input id="danmaku-query" v-model="query" maxlength="1000" placeholder="输入正在看的片名" /><button type="submit" :disabled="matching || !query.trim()">{{ matching ? '查找中' : '查找' }}</button></div>
      </form>
      <p v-if="!matching && !candidates.length" class="danmaku-help">{{ message }}</p>
      <p v-if="recovery && candidates.length" class="danmaku-help">{{ message }}</p>
      <ul v-if="candidates.length" class="danmaku-candidates" aria-label="弹幕作品候选">
        <li v-for="work in candidates" :key="work.id">
          <button class="danmaku-work" type="button" :disabled="matching" @click="choose(work.id)"><strong>{{ work.title }}</strong><small>{{ work.year }} · {{ work.categoryLabel }}</small><span aria-hidden="true">选择</span></button>
        </li>
      </ul>
    </div>
    <div v-if="enabled && expanded" class="danmaku-settings">
      <div class="danmaku-panel-heading"><strong>弹幕设置</strong><button type="button" @click="expanded = false">完成</button></div>
      <div class="danmaku-preferences">
        <label>弹幕数量<select v-model="density" aria-label="弹幕数量"><option value="low">少一点</option><option value="normal">适中</option></select></label>
        <label>清晰程度<input v-model.number="opacity" aria-label="弹幕清晰程度" type="range" min="0.3" max="1" step="0.05" /></label>
      </div>
      <button type="button" :disabled="matching" @click="openChooser">弹幕和影片对不上</button>
      <button type="button" class="danmaku-more" :aria-expanded="advanced" @click="advanced = !advanced">{{ advanced ? '收起更多选项' : '更多选项' }}</button>
      <div v-if="advanced" class="danmaku-advanced">
        <div v-if="source" class="danmaku-source"><strong>{{ source.title }} · {{ platformLabels[source.platform] }}</strong><small>{{ source.episodeTitle }}</small><small v-if="refreshedLabel">获取于 {{ refreshedLabel }}{{ stale ? ' · 暂用缓存' : '' }}</small></div>
        <p v-if="message" class="danmaku-help">{{ message }}</p>
        <div class="danmaku-actions">
          <button type="button" :disabled="loading || matching" @click="refresh">刷新弹幕</button>
          <template v-if="source?.workId"><button v-for="platform in (['qq', 'qiyi', 'youku'] as DanmakuPlatform[])" :key="platform" type="button" :disabled="matching || source.platform === platform" @click="choose(source.workId, platform)">{{ platformLabels[platform] }}</button></template>
        </div>
        <form class="danmaku-search" @submit.prevent="match(query)">
          <label for="danmaku-link">手动关联本集平台链接</label>
          <div><input id="danmaku-link" v-model="query" maxlength="1000" placeholder="腾讯 / 爱奇艺 / 优酷剧集链接" /><button type="submit" :disabled="matching || !query.trim()">关联</button></div>
        </form>
        <div class="danmaku-offset"><span>时间校准：{{ offset > 0 ? '+' : '' }}{{ offset }} 秒</span><div><button type="button" :disabled="offset <= -300" @click="offset = Math.max(-300, offset - 1)">提前 1 秒</button><button type="button" @click="offset = 0">重置</button><button type="button" :disabled="offset >= 300" @click="offset = Math.min(300, offset + 1)">延后 1 秒</button></div></div>
        <p class="danmaku-help">系统全屏尝试以短句字幕显示弹幕，优先保留影片字幕；实际支持取决于浏览器。获取时间不代表平台数据的实时更新时间。</p>
      </div>
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
.danmaku-row .danmaku-settings-toggle { display: grid; place-items: center; width: 44px; flex: 0 0 44px; padding: 10px; background: transparent; color: var(--text-secondary); }
.danmaku-settings-toggle svg { width: 18px; height: 18px; }
.danmaku-recovery { flex-shrink: 0; }
.danmaku-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: .8rem; }
.danmaku-candidates .danmaku-work { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; width: 100%; padding: 12px; text-align: left; }
.danmaku-work small { grid-column: 1; }
.danmaku-work span { grid-column: 2; grid-row: 1 / 3; align-self: center; color: var(--text-secondary); }
.danmaku-more { justify-self: start; color: var(--text-secondary); }
.danmaku-advanced { display: grid; gap: 14px; }
.danmaku-row p { overflow-wrap: anywhere; }

@media (max-height: 500px) and (orientation: landscape) {
  .danmaku-overlay { inset: calc(10px + var(--safe-area-top)) calc(8px + var(--safe-area-right)) auto calc(8px + var(--safe-area-left)); }
}

</style>
