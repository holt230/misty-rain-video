<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { BookmarkCheck, ChevronLeft, ChevronRight, Star } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import { useAutoCarousel } from '../../composables/useAutoCarousel';
import type { DiscoveryItem } from '../../services/discoveryService';

const props = defineProps<{ items: DiscoveryItem[]; active: boolean; savedIds: string[] }>();
const emit = defineEmits<{ (event: 'select', item: DiscoveryItem): void }>();
const viewport = ref<HTMLElement | null>(null);
const randomIndex = () => Math.floor(Math.random() * props.items.length) || 0;
const index = ref(randomIndex());
const progressStrip = ref<HTMLElement | null>(null);
let progressObserver: ResizeObserver | undefined;
const categories = { tv: '电视剧', movie: '电影', anime: '动漫', variety: '综艺' };
const wrap = (value: number) => props.items.length ? (value + props.items.length) % props.items.length : 0;
const carousel = useAutoCarousel({ element: viewport, count: () => props.items.length, active: () => props.active, onAdvance: () => { index.value = wrap(index.value + 1); }, intervalMs: 3000, pauseOnHover: false });
const { running, canRotate, cycleId, intervalMs } = carousel;
const select = (value: number) => { index.value = wrap(value); carousel.restart(); };
const selected = computed(() => props.items[index.value]);
const outgoingIndex = ref(-1);
watch(index, (_value, previous) => { outgoingIndex.value = previous; }, { flush: 'sync' });
// Mount artwork only for the visible slide and its neighbours, even in a larger rotation.
const hasArtwork = (value: number) => value === index.value || value === outgoingIndex.value || value === wrap(index.value - 1) || value === wrap(index.value + 1);
watch(() => props.items.map(item => item.id), (ids, previous) => {
  // Polling can refresh metadata without changing the featured sequence.
  // Keep the running cycle instead of postponing rotation on every response.
  if (previous && ids.length === previous.length && ids.every((id, itemIndex) => id === previous[itemIndex])) return;
  const retained = ids.indexOf(previous?.[index.value] || '');
  index.value = retained >= 0 ? retained : randomIndex();
  carousel.restart();
});
// Only the strip scrolls; following the current slide must not move the page.
const followProgress = (animate = true) => {
  const strip=progressStrip.value, current=strip?.querySelector<HTMLElement>('[aria-current="true"]');
  if(!strip || !current)return;
  const left=Math.max(0,Math.min(strip.scrollWidth-strip.clientWidth,current.offsetLeft-(strip.clientWidth-current.offsetWidth)/2));
  strip.scrollTo({left,behavior:animate&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'});
};
watch([index,()=>props.items.length,()=>props.active],()=>{void nextTick(()=>followProgress());},{flush:'post'});
watch(progressStrip,strip=>{
  progressObserver?.disconnect();
  if(!strip)return;
  followProgress(false);
  progressObserver=new ResizeObserver(()=>followProgress(false));progressObserver.observe(strip);
},{flush:'post'});
onBeforeUnmount(()=>progressObserver?.disconnect());
watch(()=>props.active,(active,previous)=>{if(active&&!previous&&props.items.length){index.value=randomIndex();carousel.restart();}});
let gesture: { id: number; x: number; y: number } | undefined;
let suppressClick = false;
const pointerDown = (event: PointerEvent) => {
  carousel.onPointerDown(event); suppressClick = false;
  if (event.pointerType !== 'mouse' && !(event.target as HTMLElement).closest('.featured-controls')) gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
};
const pointerUp = (event: PointerEvent) => {
  if (gesture?.id === event.pointerId) {
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) { select(index.value + (dx < 0 ? 1 : -1)); suppressClick = true; }
    gesture = undefined;
  }
  carousel.onPointerUp(event);
};
const cancelGesture = (event: PointerEvent) => { gesture = undefined; carousel.onPointerCancel(event); };
const open = (item: DiscoveryItem, event: MouseEvent) => {
  // A swipe must not open a title; keyboard activation never belongs to that gesture.
  if (!suppressClick || event.detail === 0) emit('select', item);
  suppressClick = false;
};
</script>

<template>
  <section v-if="items.length" ref="viewport" class="featured-spotlight" aria-label="精选影片" aria-roledescription="轮播"
    @pointerenter="carousel.onPointerEnter" @pointerleave="carousel.onPointerLeave" @focusin="carousel.onFocusIn"
    @pointerdown="pointerDown" @pointerup="pointerUp" @pointercancel="cancelGesture">
    <div v-if="canRotate" class="featured-controls">
      <div ref="progressStrip" class="featured-dots" aria-label="选择精选影片"><button v-for="(item, itemIndex) in items" :key="item.id" type="button" :aria-label="`精选：${item.title}`" :aria-current="itemIndex === index ? 'true' : undefined" @click="select(itemIndex)"><span class="segment-track"><i v-if="itemIndex === index" :key="cycleId" :class="{ running }" :style="{ animationDuration: `${intervalMs}ms` }"></i></span></button></div>
      <span class="featured-count" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}<span> / {{ String(items.length).padStart(2, '0') }}</span></span>
      <div class="featured-arrows"><button type="button" aria-label="上一部精选" @click="select(index - 1)"><ChevronLeft aria-hidden="true" /></button><button type="button" aria-label="下一部精选" @click="select(index + 1)"><ChevronRight aria-hidden="true" /></button></div>
    </div>
    <div class="featured-stage" :aria-live="running ? 'off' : 'polite'" aria-atomic="false">
      <article v-for="(item, itemIndex) in items" :key="item.id" class="featured-slide" :class="{ 'is-current': itemIndex === index }" :aria-hidden="itemIndex !== index" :inert="itemIndex !== index || undefined" :aria-label="`${itemIndex + 1} / ${items.length}`" aria-roledescription="幻灯片">
        <MediaPoster v-if="hasArtwork(itemIndex)" class="featured-ambient" :src="item.poster" alt="" loading="eager" :fetchpriority="itemIndex === index ? 'high' : 'low'" decoding="async" />
        <span class="featured-shade" aria-hidden="true"></span>
        <button type="button" class="featured-open" :aria-label="`查看详情：${item.title}（${item.year || '年份未知'}）`" :tabindex="itemIndex === index ? 0 : -1" @click="open(item, $event)">
          <span class="featured-copy"><span class="featured-category">{{ categories[item.category] }}</span><strong :title="item.title">{{ item.title }}</strong><span class="featured-meta"><span v-if="item.year">{{ item.year }}</span><span v-if="item.rating !== null"><Star aria-hidden="true" />{{ item.rating.toFixed(1) }}</span><BookmarkCheck v-if="savedIds.includes(item.id)" aria-label="已收藏" /></span></span>
          <span class="featured-poster"><MediaPoster v-if="hasArtwork(itemIndex)" :src="item.poster" alt="" loading="eager" :fetchpriority="itemIndex === index ? 'high' : 'low'" decoding="async" /></span>
        </button>
      </article>
    </div>
    <span class="sr-only" aria-live="off">{{ selected?.title }}</span>
  </section>
</template>

<style scoped>
.featured-spotlight { --surface-2:#202226;--surface-3:#303238;position:relative; width:100%; height:clamp(560px,44vw,720px); margin-bottom:18px; overflow:hidden; isolation:isolate; color:#fff; background:#08090b; touch-action:pan-y; }
.featured-stage { position:absolute; inset:0; }
.featured-slide { position:absolute; inset:0; overflow:hidden; opacity:0; pointer-events:none; transition:opacity .65s cubic-bezier(.22,.61,.36,1); }
.featured-slide.is-current { opacity:1; pointer-events:auto; z-index:1; }
.featured-ambient { position:absolute; inset:-3%; width:106%; height:106%; object-fit:cover; object-position:center 35%; opacity:.86; filter:blur(6px) saturate(1.1); transform:scale(1.06); transition:transform 7.6s linear; pointer-events:none; }
.is-current .featured-ambient { transform:scale(1); }
.featured-shade { position:absolute; inset:0; background:linear-gradient(90deg,#08090bd9 5%,#08090b55 55%,#08090b12),linear-gradient(0deg,var(--bg-base,#08090b),#08090b30 27%,transparent 55%,#08090b90); pointer-events:none; }
.featured-open { position:relative; display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); align-items:center; gap:8%; width:100%; max-width:1540px; height:100%; margin:0 auto; padding:112px max(var(--content-gutter,48px),6%) 92px; border:0; color:inherit; background:none; text-align:left; }
.featured-copy { display:flex; min-width:0; flex-direction:column; align-items:flex-start; gap:20px; z-index:1; transition:transform .65s cubic-bezier(.22,.61,.36,1),opacity .5s ease; transform:translateY(12px); opacity:0; }
.is-current .featured-copy { transform:none; opacity:1; }
.featured-category { color:#ffffffa8; font-size:.75rem; font-weight:600; letter-spacing:.16em; }
.featured-copy > strong { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; font-size:clamp(38px,4.8vw,72px); font-weight:750; line-height:1.12; letter-spacing:-.04em; overflow-wrap:anywhere; text-wrap:balance; }
.featured-meta { display:flex; align-items:center; gap:18px; color:#ffffffc7; font-size:.82rem; font-variant-numeric:tabular-nums; }
.featured-meta > span { display:inline-flex; align-items:center; gap:6px; }
.featured-meta svg { width:14px; height:14px; }
.featured-meta > svg { width:17px; height:17px; }


.featured-poster { display:flex; justify-content:center; min-width:0; height:100%; max-height:430px; filter:drop-shadow(0 20px 36px #0007); transform:translateY(6px) scale(.98); transition:transform .8s cubic-bezier(.22,.61,.36,1); }
.is-current .featured-poster { transform:none; }
.featured-poster :deep(img) { display:block; width:auto; max-width:100%; height:100%; aspect-ratio:2/3; object-fit:contain; border-radius:7px; box-shadow:0 0 0 1px #ffffff20; }
.featured-open:focus-visible { outline:2px solid #fff; outline-offset:-6px; }
.featured-controls { position:absolute; z-index:3; bottom:30px; left:max(var(--content-gutter,48px),calc((100% - 1360px)/2)); right:max(var(--content-gutter,48px),calc((100% - 1360px)/2)); display:flex; align-items:center; gap:12px; }
.featured-controls button { display:grid; width:44px; height:44px; place-items:center; padding:0; border:0; color:#fff; background:none; }
.featured-controls button:focus-visible { outline:2px solid #fff; outline-offset:1px; border-radius:5px; }
.featured-controls button > svg { width:19px; height:19px; }

.featured-dots { position:relative; display:flex; flex:0 1 auto; width:max-content; max-width:176px; min-width:0; gap:4px; overflow-x:auto; scrollbar-width:none; overscroll-behavior-x:contain; touch-action:pan-x; }
.featured-dots::-webkit-scrollbar { display:none; }
.featured-dots button { width:32px; min-width:32px; flex:0 0 32px; }
.segment-track { position:relative; display:block; width:100%; height:3px; overflow:hidden; border-radius:3px; background:#ffffff36; }
.segment-track i { display:block; width:100%; height:100%; background:#fff; transform-origin:left; }
.segment-track i.running { animation:feature-progress linear both; }
.featured-count { margin-left:10px; font-size:.7rem; font-variant-numeric:tabular-nums; }
.featured-count > span { color:#ffffff66; }
.featured-arrows { display:flex; gap:6px; margin-left:auto; }
.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
@keyframes feature-progress { from { transform:scaleX(0); } to { transform:scaleX(1); } }
@media (hover:hover) and (pointer:fine) { .featured-controls button:hover { color:#fff; background:#ffffff17; border-radius:5px; } }
@media (max-width:1023px) { .featured-spotlight { height:548px; } .featured-open { padding:108px 6% 100px; gap:6%; } .featured-copy > strong { font-size:clamp(35px,5vw,56px); } .featured-poster { max-height:340px; } }
@media (max-width:640px) {
  .featured-spotlight { height:clamp(520px,72svh,620px); margin-bottom:10px; }
  .featured-open { display:flex; flex-direction:column-reverse; justify-content:flex-start; gap:0; padding:calc(var(--app-header-height) + 24px) 24px 74px; }
  .featured-poster { flex:1; min-height:0; width:100%; max-height:none; filter:drop-shadow(0 15px 28px #0009); }
  .featured-poster :deep(img) { max-width:72%; border-radius:6px; }
  .featured-copy { flex:0 0 auto; align-items:center; width:100%; gap:10px; margin-top:20px; text-align:center; }
  .featured-category { display:none; }
  .featured-copy > strong { -webkit-line-clamp:2; font-size:clamp(23px,6.4vw,30px); line-height:1.18; }
  .featured-meta { gap:14px; font-size:.73rem; }


  .featured-controls { bottom:14px; left:var(--mobile-gutter,20px); right:var(--mobile-gutter,20px); justify-content:center; gap:12px; }
  .featured-dots { max-width:140px; }
  .featured-dots button { width:24px; min-width:24px; flex-basis:24px; }
  .featured-arrows,.featured-count { display:none; }

  .featured-ambient { object-position:center 28%; filter:blur(5px) saturate(1.12); }
  .featured-shade { background:linear-gradient(0deg,var(--bg-base,#08090b),#08090bb3 15%,#08090b12 57%,#08090b80),linear-gradient(90deg,#08090b40,transparent 25%,transparent 75%,#08090b40); }
}
@media (prefers-reduced-motion:reduce) { .featured-slide,.featured-copy,.featured-poster,.featured-ambient {transition:none;transform:none;} .segment-track i.running {animation:none;} }
</style>
