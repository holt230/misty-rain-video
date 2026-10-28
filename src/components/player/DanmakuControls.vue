<script setup lang="ts">
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type Danmaku from 'danmaku';
import { ArrowRight, Search, ChevronRight, Check, RotateCw } from '@lucide/vue';
import { useDanmakuMatch } from '../../composables/useDanmakuMatch';
import { DanmakuService, platformLabels, type DanmakuInput, type DanmakuPlatform, type DanmakuSegment, type DanmakuEpisode } from '../../services/danmakuService';
import { displayComments } from '../../services/danmakuDisplay';
import { pictureBounds, playerViewportSize } from '../../services/captionLayout';

const props = defineProps<{ video: HTMLVideoElement; input: DanmakuInput; open?: boolean; fit?:'contain'|'cover' }>();
const enabled = ref(localStorage.getItem('misty_rain_danmaku_enabled') === 'true');
const opacity = ref(Math.max(.3, Math.min(1, Number(localStorage.getItem('misty_rain_danmaku_opacity')) || .75)));
const density = ref<'low' | 'normal'>(localStorage.getItem('misty_rain_danmaku_density') === 'normal' ? 'normal' : 'low');
const area=ref<'top'|'half'|'full'>(localStorage.getItem('misty_rain_danmaku_area')==='top'?'top':localStorage.getItem('misty_rain_danmaku_area')==='full'?'full':'half');
const font=ref<'small'|'medium'|'large'>(localStorage.getItem('misty_rain_danmaku_font')==='small'?'small':localStorage.getItem('misty_rain_danmaku_font')==='large'?'large':'medium');
const mode=computed<'off'|'low'|'normal'>(()=>enabled.value?density.value:'off');
const cycleMode=()=>{if(!enabled.value){density.value='normal';enabled.value=true;}else if(density.value==='normal')density.value='low';else enabled.value=false;};
const resetPreferences=()=>{area.value='half';font.value='medium';opacity.value=.75;};

const offset = ref(0);
const matcher = useDanmakuMatch(() => props.input, enabled);
const { source, binding, retryable, candidates, options, page, phase, busy, issue, query, pendingWork } = matcher;
const message = ref(''), loading = ref(false), recovery = ref(false), fetchedAt = ref(0), stale = ref(false);
const appearance = ref(false), timing = ref(false), episodePlatform = ref<DanmakuPlatform | ''>(''), episodeLimit = ref(120);
const availablePlatforms = computed(() => [...new Set(options.value?.episodes.flatMap(episode => episode.platforms) || [])]);
const listedEpisodes = computed(() => (options.value?.episodes || []).filter(episode => !episodePlatform.value || episode.platforms.includes(episodePlatform.value)));
const summary = computed(() => !enabled.value ? '关闭' : busy.value && !source.value ? '匹配中' : source.value ? platformLabels[source.value.platform] : '待匹配');
const draftEpisode = ref<DanmakuEpisode | null>(null);
const rememberSeason = ref(true);
const selectEpisode = (episode: DanmakuEpisode) => { draftEpisode.value = episode; };
const episodeActive = (episode: DanmakuEpisode) => draftEpisode.value?.key === episode.key;
const confirmEpisode = () => {
  const episode=draftEpisode.value;
  if(!episode || !options.value || busy.value)return;
  void matcher.select({workId:options.value.workId,platform:episodePlatform.value || undefined,targetEpisode:episode.number,targetEpisodeTitle:episode.title,
    scope:rememberSeason.value && options.value.category!=='3'?'season':'episode'});
};
const chooseMode = (value: 'normal'|'low'|'off') => { if(value !== 'off') density.value = value; enabled.value = value !== 'off'; };
defineExpose({mode,cycleMode,page,summary,back:matcher.back});
const overlay = ref<HTMLElement | null>(null);
const episodeGrid = ref<HTMLElement | null>(null);
const overlayGeometry = ref<Record<string,string>>({});
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
const canLoad = computed(() => enabled.value && !hiddenPage.value);
const active = computed(() => canLoad.value && !nativeFullscreen.value);
const status = computed(() => {
  if (enabled.value && nativeFullscreen.value) return '系统全屏不显示弹幕，请使用网页全屏';
  if (busy.value) return phase.value === 'auto' ? '正在匹配当前影片…' : phase.value === 'select' ? '正在切换弹幕…' : '';
  if (issue.value) return issue.value;
  if (!enabled.value) return '弹幕已关闭';
  if (loading.value && !fetchedAt.value) return '正在加载弹幕…';
  return message.value;
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
      comments: displayComments([...segments.values()].flatMap(item => item.comments), density.value, offset.value, {small:14,medium:17,large:22}[font.value]) });
  } catch { message.value = '弹幕显示暂不可用，请刷新页面'; recovery.value = true; }
}
function reset() {
  generation++; controller.abort(); controller = new AbortController();
  pending.clear(); failedUntil.clear(); segments.clear(); destroyEngine();
  loading.value = false; recovery.value = false;
  message.value = ''; fetchedAt.value = 0; stale.value = false;
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
      recovery.value = data.stale;
      fetchedAt.value = data.fetchedAt; stale.value = data.stale; message.value = data.stale ? '正在显示已缓存的弹幕' : data.comments.length ? '' : '当前时间段暂无弹幕';
    }
    await render();
  } catch (error) {
    if (seq === generation) {
      failedUntil.set(index, Date.now() + 30_000);
      if (index === currentIndex()) { recovery.value = true; message.value = error instanceof Error ? error.message : '弹幕暂不可用，视频可继续播放'; }
    }
  } finally { if (seq === generation) { pending.delete(index); loading.value = pending.size > 0; } }
}
async function loadCurrent(force = false) {
  if (!canLoad.value || !source.value) return;
  const seq = generation;
  const index = currentIndex();
  const cached = segments.get(index);
  if (cached) {
    fetchedAt.value = cached.fetchedAt; stale.value = cached.stale; recovery.value = cached.stale;
    message.value = cached.stale ? '弹幕暂不可用，正在显示缓存' : cached.comments.length ? '' : '当前时间段暂无弹幕';
  }
  await loadSegment(index, force);
  if (seq !== generation) return;
  if (canLoad.value && source.value && !force && !props.video.paused) {
    const nextStart = (index + 1) * source.value.segmentSeconds + offset.value;
    if (!Number.isFinite(props.video.duration) || nextStart < props.video.duration) void loadSegment(index + 1);
  }
}
function refresh() {
  if (loading.value) return;
  if (source.value) void loadCurrent(true);
  else matcher.retry();
}
function visibility() { hiddenPage.value = document.hidden; }
function fullscreen() {
  nativeFullscreen.value = Boolean(document.fullscreenElement === props.video || (props.video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }).webkitDisplayingFullscreen);
}
function beginFullscreen() { nativeFullscreen.value = true; }
function endFullscreen() { nativeFullscreen.value = false; }
function seek() { engine?.clear(); void loadCurrent(); }
function rateChange() { void render(); }
function measureOverlay() {
  const video=props.video,stage=playerViewportSize(video);
  if(!stage?.width || !stage.height || !video.videoWidth || !video.videoHeight){overlayGeometry.value={};return;}
  const picture=pictureBounds(stage.width,stage.height,video.videoWidth,video.videoHeight,props.fit||'contain');
  overlayGeometry.value={left:`${picture.left+8}px`,top:`${picture.top+10}px`,width:`${Math.max(0,picture.width-16)}px`,height:`${Math.max(0,picture.height*({top:.25,half:.5,full:1}[area.value])-20)}px`};
  void nextTick(()=>engine?.resize());
}
function bindVideo(video: HTMLVideoElement | null) {
  if (boundVideo) {
    boundVideo.removeEventListener('seeked', seek); boundVideo.removeEventListener('ratechange', rateChange);
    boundVideo.removeEventListener('webkitbeginfullscreen', beginFullscreen); boundVideo.removeEventListener('webkitendfullscreen', endFullscreen);
    boundVideo.removeEventListener('loadedmetadata',measureOverlay);
    boundVideo.removeEventListener('resize',measureOverlay);
  }
  boundVideo = video;
  if (video) {
    video.addEventListener('seeked', seek); video.addEventListener('ratechange', rateChange);
    video.addEventListener('webkitbeginfullscreen', beginFullscreen); video.addEventListener('webkitendfullscreen', endFullscreen);
    video.addEventListener('loadedmetadata',measureOverlay);
    video.addEventListener('resize',measureOverlay);
  }
}
watch(source, value => {
  reset();
  if (!value) return;
  offset.value = Math.max(-300, Math.min(300, Number(localStorage.getItem(`misty_rain_danmaku_offset:${props.input.associationKey || props.input.mediaKey}:${value.workId || value.id}`)) || 0));
  void loadCurrent();
}, { flush:'sync' });
watch(enabled, value => {
  localStorage.setItem('misty_rain_danmaku_enabled', String(value));
  if (value) { void loadCurrent(); }
  else { generation++; controller.abort(); controller = new AbortController(); pending.clear(); loading.value = false; destroyEngine(); }
});
watch(() => props.open, open => { if (!open) { matcher.back(); appearance.value = false; timing.value = false; } });
watch([options,page], () => {
  if(page.value!=='episodes' || !options.value){draftEpisode.value=null;return;}
  rememberSeason.value=options.value.category!=='3' && !props.input.episodePart;
  const sameWork=Boolean(source.value && source.value.workId===options.value.workId);
  episodePlatform.value=sameWork?source.value!.platform:binding.value?.workId===options.value.workId?binding.value.platform || '':'';
  const number=sameWork?source.value!.episodeNumber ?? props.input.episodeNumber:props.input.episodeNumber+(binding.value?.workId===options.value.workId?binding.value.offset:0);
  draftEpisode.value=listedEpisodes.value.find(episode=>options.value!.category==='3'?episode.title===props.input.episodeTitle:episode.number===number) || null;
});
watch(episodePlatform,()=>{if(draftEpisode.value && !listedEpisodes.value.some(episode=>episode.key===draftEpisode.value!.key))draftEpisode.value=null;});
watch([options,page,episodePlatform], async () => {
  if(page.value!=='episodes')return;
  const index=listedEpisodes.value.findIndex(episodeActive);
  episodeLimit.value=Math.max(120,Math.ceil((index+1)/120)*120);
  await nextTick();episodeGrid.value?.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({block:'nearest'});
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
  if (source.value) localStorage.setItem(`misty_rain_danmaku_offset:${props.input.associationKey || props.input.mediaKey}:${source.value.workId || source.value.id}`, String(offset.value));
  void render(); void loadCurrent();
});
watch(() => props.video, async video => { bindVideo(video); fullscreen(); observer?.disconnect();if(video.parentElement)observer?.observe(video.parentElement);await nextTick();measureOverlay();void render(); });
watch(()=>props.fit,measureOverlay);
watch(area,value=>{localStorage.setItem('misty_rain_danmaku_area',value);measureOverlay();});
watch(font,value=>{localStorage.setItem('misty_rain_danmaku_font',value);void render();});
onMounted(() => {
  bindVideo(props.video); fullscreen();
  observer = new ResizeObserver(measureOverlay);
  if (target.value) observer.observe(target.value);
  measureOverlay();
  interval = window.setInterval(() => { if (!props.video.paused) void loadCurrent(); }, 1000);
  document.addEventListener('visibilitychange', visibility); document.addEventListener('fullscreenchange', fullscreen);
});
onBeforeUnmount(() => {
  reset(); bindVideo(null); observer?.disconnect(); if (interval !== null) window.clearInterval(interval);
  document.removeEventListener('visibilitychange', visibility); document.removeEventListener('fullscreenchange', fullscreen);
});
</script>
<template>
  <Teleport v-if="target" :to="target"><div ref="overlay" class="danmaku-overlay" :style="{ ...overlayGeometry, opacity, visibility: active ? 'visible' : 'hidden' }" aria-hidden="true" /></Teleport>
  <div class="danmaku-controls">
    <template v-if="page === 'settings'">
      <div class="danmaku-segments mode-options" role="group" aria-label="弹幕数量">
        <button v-for="item in [{value:'normal',label:'海量'},{value:'low',label:'少量'},{value:'off',label:'关闭'}]" :key="item.value" type="button" :aria-pressed="mode === item.value" @click="chooseMode(item.value as 'normal'|'low'|'off')">{{ item.label }}</button>
      </div>
      <LoadingSkeleton v-if="phase === 'auto' && !source" variant="text" :count="2" label="正在匹配弹幕" />
      <div v-else-if="source || binding" class="danmaku-source">
        <div><strong>{{ source?.title || binding?.title || input.title }}</strong><small v-if="source">{{ source.episodeTitle }} · {{ platformLabels[source.platform] }}</small><small v-if="source?.seriesLinked || binding">已记住本季对应关系</small><small v-else>仅关联本集</small></div>
        <button type="button" aria-label="更换弹幕作品" @click="matcher.openSearch">更换<ChevronRight aria-hidden="true" /></button>
      </div>
      <div class="danmaku-status" role="status"><span>{{ status }}</span><button v-if="issue && retryable" type="button" :disabled="busy" @click="matcher.retry">重试</button><button v-else-if="recovery && enabled" type="button" :disabled="loading" @click="refresh">重试</button></div>
      <div v-if="!source && !binding" class="danmaku-empty-actions"><button type="button" class="search-entry" @click="matcher.openSearch"><Search aria-hidden="true" />{{ candidates.length ? '搜索其他作品' : '搜索片名或粘贴链接' }}</button></div>
      <ul v-if="!source && candidates.length" class="danmaku-candidates" aria-label="弹幕作品候选">
        <li v-for="work in candidates" :key="work.id"><button type="button" class="danmaku-work" :disabled="busy" @click="matcher.openEpisodes(work.id)"><span><strong>{{ work.title }}</strong><small>{{ [work.year,work.categoryLabel].filter(Boolean).join(' · ') }}</small></span><ChevronRight aria-hidden="true" /></button></li>
      </ul>
      <button v-if="source?.workId || binding?.workId || pendingWork" class="danmaku-navigation" type="button" :disabled="busy" @click="matcher.openEpisodes()"><span>集数与来源</span><span>{{ source?.episodeTitle || '选择对应集数' }}<ChevronRight aria-hidden="true" /></span></button>
      <button v-if="source" class="danmaku-navigation" type="button" :disabled="loading || busy || !enabled" @click="refresh"><span>刷新弹幕</span><RotateCw :class="{spin:loading}" aria-hidden="true" /></button>
      <button class="danmaku-navigation" type="button" :aria-expanded="appearance" @click="appearance=!appearance"><span>显示样式</span><span>{{ {top:'顶部',half:'半屏',full:'全屏'}[area] }} · {{ {small:'小',medium:'中',large:'大'}[font] }}字号<ChevronRight :class="{expanded:appearance}" aria-hidden="true" /></span></button>
      <div v-if="appearance" class="danmaku-preferences">
        <div class="option-group"><span>显示区域</span><div class="danmaku-segments" role="group" aria-label="弹幕显示区域"><button v-for="item in [{value:'top',label:'顶部'},{value:'half',label:'半屏'},{value:'full',label:'全屏'}]" :key="item.value" type="button" :aria-pressed="area===item.value" @click="area=item.value as 'top'|'half'|'full'">{{item.label}}</button></div></div>
        <div class="option-group"><span>字号</span><div class="danmaku-segments" role="group" aria-label="弹幕字号"><button v-for="item in [{value:'small',label:'小'},{value:'medium',label:'中'},{value:'large',label:'大'}]" :key="item.value" type="button" :aria-pressed="font===item.value" @click="font=item.value as 'small'|'medium'|'large'">{{item.label}}</button></div></div>
        <label class="danmaku-opacity"><span>不透明度</span><input v-model.number="opacity" aria-label="弹幕不透明度" type="range" min="0.3" max="1" step="0.05" /><output>{{Math.round(opacity*100)}}%</output></label>
        <button type="button" class="text-action" @click="resetPreferences">恢复默认样式</button>
      </div>
      <button v-if="source" class="danmaku-navigation" type="button" :aria-expanded="timing" @click="timing=!timing"><span>时间校准</span><span>{{ offset > 0 ? '+' : '' }}{{ offset }} 秒<ChevronRight :class="{expanded:timing}" aria-hidden="true" /></span></button>
      <div v-if="timing" class="danmaku-segments timing-options"><button type="button" :disabled="offset<=-300" @click="offset=Math.max(-300,offset-1)">提前 1 秒</button><button type="button" @click="offset=0">重置</button><button type="button" :disabled="offset>=300" @click="offset=Math.min(300,offset+1)">延后 1 秒</button></div>
    </template>
    <template v-else-if="page === 'search'">
      <form class="danmaku-search" @submit.prevent="matcher.search(query, rememberSeason ? 'season' : 'episode')"><Search aria-hidden="true" /><input v-model="query" aria-label="弹幕片名或链接" maxlength="1000" placeholder="片名或本集播放链接" /><button type="submit" aria-label="查找弹幕" :disabled="busy || !query.trim()"><ArrowRight aria-hidden="true" /></button></form>
      <p class="danmaku-help">{{ source ? '选好后替换当前弹幕' : `为「${input.title}」匹配弹幕` }}</p>
      <LoadingSkeleton v-if="busy" variant="text" :count="3" label="正在查找弹幕" />
      <div v-else-if="issue" class="danmaku-status" role="status"><span>{{ issue }}</span><button v-if="retryable" type="button" @click="matcher.retry">重试</button></div>
      <ul v-if="!busy && candidates.length" class="danmaku-candidates" aria-label="弹幕作品候选"><li v-for="work in candidates" :key="work.id"><button class="danmaku-work" type="button" @click="matcher.openEpisodes(work.id)"><span><strong>{{work.title}}</strong><small>{{ [work.year,work.categoryLabel,...work.platforms.map(platform=>platformLabels[platform])].filter(Boolean).join(' · ') }}</small></span><Check v-if="source?.workId===work.id" aria-hidden="true" /><ChevronRight v-else aria-hidden="true" /></button></li></ul>
      <button v-if="issue && pendingWork" type="button" class="danmaku-navigation" @click="matcher.openEpisodes(pendingWork)"><span>选择对应集数</span><ChevronRight aria-hidden="true" /></button>
      <p class="danmaku-help">支持 B 站、腾讯、爱奇艺、优酷链接；独立视频仅关联本集</p>
    </template>
    <template v-else>
      <div class="association-work"><strong>{{ options?.title || '确认弹幕对应关系' }}</strong><small>{{ [options?.year, options?.categoryLabel].filter(Boolean).join(' · ') }}</small></div>
      <div v-if="options?.partial && !busy" class="danmaku-status" role="status"><span>部分集数暂未读取成功</span><button type="button" @click="matcher.openEpisodes()">重试</button></div>
      <div v-if="availablePlatforms.length" class="source-options" role="group" aria-label="弹幕来源"><button type="button" :aria-pressed="episodePlatform===''" @click="episodePlatform=''">自动</button><button v-for="platform in availablePlatforms" :key="platform" type="button" :aria-pressed="episodePlatform===platform" @click="episodePlatform=platform">{{platformLabels[platform]}}</button></div>
      <LoadingSkeleton v-if="busy" variant="form" :count="3" label="正在读取弹幕集数" />
      <div v-else-if="issue" class="danmaku-status" role="status"><span>{{issue}}</span><button v-if="retryable" type="button" @click="matcher.retry">重试</button></div>
      <div v-if="!busy && listedEpisodes.length" ref="episodeGrid" class="danmaku-episodes" :class="{'period-list':options?.category==='3'}" role="group" aria-label="对应弹幕集数"><button v-for="episode in listedEpisodes.slice(0,episodeLimit)" :key="episode.key" type="button" :aria-label="episode.title" :title="episode.title" :aria-pressed="episodeActive(episode) && (!episodePlatform || source?.platform===episodePlatform)" @click="selectEpisode(episode)">{{options?.category==='3'?episode.title:episode.number}}</button></div>
      <button v-if="listedEpisodes.length>episodeLimit" type="button" class="text-action" @click="episodeLimit+=120">显示更多集数</button>
      <p v-if="!busy && !listedEpisodes.length" class="danmaku-help">暂无可选集数，可粘贴本集链接关联</p>
      <div v-if="listedEpisodes.length" class="association-confirmation">
        <div class="association-mapping"><span>当前视频<strong>{{ input.episodeTitle || `第 ${input.episodeNumber} 集` }}</strong></span><ArrowRight aria-hidden="true" /><span>对应弹幕<strong>{{ draftEpisode?.title || '请选择集数' }}</strong></span></div>
        <label v-if="!input.episodePart && ['2','4'].includes(options?.category || '')" class="association-scope"><input v-model="rememberSeason" type="checkbox" />本季沿用此对应关系</label>
        <small v-if="rememberSeason && draftEpisode && draftEpisode.number!==input.episodeNumber" class="danmaku-help">本季弹幕集数{{ draftEpisode.number>input.episodeNumber?'加':'减' }} {{ Math.abs(draftEpisode.number-input.episodeNumber) }}</small>
        <button type="button" class="confirm-association" :disabled="busy || !draftEpisode" @click="confirmEpisode">{{ phase==='select'?'正在关联…':'确认关联' }}</button>
      </div>
    </template>
  </div>
</template>
<style scoped>
.association-work { display:grid; gap:4px; padding:6px 4px 12px; }
.association-work strong { font-size:14px; }
.association-work small { font-size:12px; color:var(--text-tertiary); }
.association-confirmation { position:sticky; bottom:-12px; padding:12px 0 0; margin-top:12px; background:var(--surface-1); border-top:1px solid var(--divider); }
.association-mapping { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 4px 10px; }
.association-mapping span { display:grid; gap:4px; min-width:0; font-size:12px; color:var(--text-tertiary); }
.association-mapping strong { font-size:13px; font-weight:500; color:var(--text-primary); overflow-wrap:anywhere; }
.association-scope { display:flex; align-items:center; gap:8px; min-height:40px; font-size:12px; color:var(--text-secondary); }
.association-scope input { width:16px; height:16px; accent-color:var(--liquid-accent); }
.danmaku-controls .confirm-association { width:100%; margin-top:6px; background:var(--liquid-accent); color:var(--accent-ink); }
.danmaku-controls .confirm-association:hover { filter:brightness(.9); }
.danmaku-overlay { position:absolute; z-index:1; inset:10px 8px auto; height:42%; overflow:hidden; pointer-events:none; contain:layout paint; }
.danmaku-controls { min-width:0; padding:12px; color:var(--text-primary); }
.danmaku-controls button { min-height:44px; padding:0 10px; border:0; border-radius:6px; background:transparent; color:var(--text-secondary); font:inherit; font-size:13px; cursor:pointer; }
.danmaku-controls button:hover { background:var(--surface-2); }
.danmaku-controls button:disabled { opacity:.45; cursor:default; }
.danmaku-controls button:focus-visible,.danmaku-controls input:focus-visible { outline:2px solid var(--liquid-accent); outline-offset:2px; }
.danmaku-controls button[aria-pressed=true] { background:var(--liquid-accent); color:var(--accent-ink); }
.danmaku-controls svg { width:17px; height:17px; flex:none; }
.danmaku-segments { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
.mode-options button { background:var(--surface-2); }
.danmaku-source { display:flex; align-items:center; gap:8px; padding:16px 4px 8px; }
.danmaku-source>div,.danmaku-work>span { min-width:0; flex:1; display:grid; gap:5px; }
.danmaku-source strong,.danmaku-work strong { font-size:14px; font-weight:600; line-height:1.5; overflow-wrap:anywhere; color:var(--text-primary); }
.danmaku-source small,.danmaku-work small,.danmaku-help { font-size:12px; color:var(--text-tertiary); line-height:1.6; }
.danmaku-source button,.danmaku-navigation>span:last-child { display:flex; align-items:center; gap:4px; }
.danmaku-source button { flex:none; padding:0 2px 0 8px; }
.danmaku-status { display:flex; align-items:center; gap:8px; font-size:12px; line-height:1.6; color:var(--text-tertiary); }
.danmaku-status:has(span:not(:empty)) { padding:8px 4px; }
.danmaku-status span { flex:1; overflow-wrap:anywhere; }
.danmaku-help { margin:8px 4px 12px; }
.danmaku-navigation { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; min-height:50px!important; padding:0 4px!important; text-align:left; border-bottom:1px solid var(--divider)!important; border-radius:0!important; }
.danmaku-navigation>span:last-child { min-width:0; justify-content:flex-end; text-align:right; color:var(--text-tertiary); font-size:12px; }
.danmaku-navigation svg.expanded { transform:rotate(90deg); }
.danmaku-empty-actions .search-entry { display:flex; align-items:center; gap:8px; width:100%; margin:8px 0; background:var(--surface-2); }
.danmaku-candidates { list-style:none; margin:8px 0; padding:0; display:grid; gap:4px; }
.danmaku-work { display:flex; align-items:center; gap:12px; width:100%; padding:10px!important; text-align:left; }
.danmaku-search { display:flex; align-items:center; gap:8px; padding:0 4px 0 12px; border:1px solid var(--divider); border-radius:8px; background:var(--surface-2); }
.danmaku-search input { width:100%; min-width:0; height:44px; border:0; background:transparent; color:var(--text-primary); font:inherit; font-size:16px; outline:none!important; }
.danmaku-search:focus-within { border-color:var(--text-tertiary); }
.danmaku-search button { display:grid; place-items:center; width:44px; flex:none; padding:0; }
.danmaku-preferences { display:grid; gap:14px; padding:12px 4px; }
.option-group { display:grid; gap:8px; font-size:12px; color:var(--text-secondary); }
.danmaku-opacity { display:grid; grid-template-columns:1fr auto; align-items:center; gap:6px; font-size:12px; }
.danmaku-opacity span { grid-column:1/-1; }
.danmaku-opacity input { min-width:0; width:100%; min-height:36px; accent-color:var(--liquid-accent); }
.danmaku-opacity output { font-variant-numeric:tabular-nums; color:var(--text-tertiary); }
.text-action { justify-self:start; color:var(--text-tertiary)!important; }
.timing-options { margin:12px 0; }
.source-options { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:12px; }
.danmaku-episodes { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px; }
.danmaku-episodes button { border:1px solid var(--divider); padding:4px; }
.period-list { grid-template-columns:1fr; }
.period-list button { text-align:left; padding:8px 10px; }
.spin { animation:danmaku-spin 1s linear infinite; }@keyframes danmaku-spin{to{transform:rotate(360deg)}}
</style>
