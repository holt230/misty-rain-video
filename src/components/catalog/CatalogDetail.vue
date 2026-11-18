<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowLeft, ChevronDown, ChevronUp, Play, RefreshCw, Search, X } from '@lucide/vue';
import type { CatalogCredit, CatalogItem, CatalogWorkDetails } from '../../types/catalog';
import { useDialog } from '../../composables/useDialog';
import { catalogAvatar, useCatalogDetails } from '../../composables/useCatalogDetails';
import MediaPoster from '../common/MediaPoster.vue';
import CatalogPersonAvatar from './CatalogPersonAvatar.vue';
import CatalogPersonDetail from './CatalogPersonDetail.vue';
import CatalogComments from './CatalogComments.vue';
const props = defineProps<{ item: CatalogItem; inLibrary: boolean; playLabel?: string; ownedEpisodes?: number[]; unversionedLibrary?: boolean }>();
const emit = defineEmits<{ (event: 'close'): void; (event: 'play'): void; (event: 'sources'): void; (event: 'episode', episode: number): void; (event: 'resolved', item: CatalogItem): void }>();
const root = ref<HTMLElement | null>(null);
const selectedPerson = ref<CatalogCredit | null>(null);
const expandedSummary = ref(false);
const expandedCast = ref(false);
const episodesOpen = ref(false);
const hasEpisodes = computed(() => Boolean((props.inLibrary || props.unversionedLibrary) && props.ownedEpisodes?.length
  && (props.item.category === 'tv' || props.item.category === 'anime')));
const summaryText = ref<HTMLElement | null>(null);
const summaryOverflow = ref(false);
let summaryObserver: ResizeObserver | undefined;
const measureSummary = () => {
  if (summaryText.value && !expandedSummary.value) summaryOverflow.value = summaryText.value.scrollHeight > summaryText.value.clientHeight + 1;
};
watch(summaryText, node => {
  summaryObserver?.disconnect();
  if (!node) summaryOverflow.value = false;
  if (node && typeof ResizeObserver !== 'undefined') { summaryObserver = new ResizeObserver(measureSummary); summaryObserver.observe(node); }
  measureSummary();
}, { flush: 'post' });
onBeforeUnmount(() => summaryObserver?.disconnect());
let personTrigger: HTMLElement | null = null;
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
const onTouchStart = (e: TouchEvent) => {
  if (e.touches.length !== 1) return;
  const touch = e.touches[0];
  if (touch.clientX < 45) {
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = Date.now();
  } else {
    touchStartX = 0;
  }
};
const onTouchEnd = (e: TouchEvent) => {
  if (!touchStartX || e.changedTouches.length !== 1) return;
  const touch = e.changedTouches[0];
  const deltaX = touch.clientX - touchStartX;
  const deltaY = Math.abs(touch.clientY - touchStartY);
  const elapsed = Date.now() - touchStartTime;
  touchStartX = 0;
  if (deltaX > 60 && deltaY < 50 && elapsed < 500) {
    if (selectedPerson.value) void closePerson();
    else emit('close');
  }
};
const { data: details, loading, error, refresh } = useCatalogDetails<CatalogWorkDetails>(
  () => '/api/catalog/works/' + encodeURIComponent(props.item.catalogId.replace(/^douban:/, '')) + '?category=' + props.item.category,
  value => ({ ...value, directors: value.directors.map(catalogAvatar), actors: value.actors.map(catalogAvatar) })
);
watch(details, value => {
  if (value?.catalogId === props.item.catalogId) emit('resolved', { ...props.item, year: value.year || props.item.year,
    rating: value.rating || props.item.rating, ratingSource: value.ratingSource || props.item.ratingSource,
    catalogAliases: [...new Set([...(props.item.catalogAliases || []), ...(value.catalogAliases || [])])] });
});
watch([expandedSummary, () => details.value?.summary], async () => { await nextTick(); measureSummary(); });
const people = computed(() => {
  const merged = new Map<string, CatalogCredit>();
  for (const person of [...(details.value?.directors || []), ...(details.value?.actors || [])]) {
    const key = person.id || person.name;
    const previous = merged.get(key);
    merged.set(key, previous ? { ...previous, role: [...new Set([previous.role, person.role])].join(' / ') } : person);
  }
  return [...merged.values()];
});
const visiblePeople = computed(() => expandedCast.value ? people.value : people.value.slice(0, 8));
const facts = computed(() => {
  const data = details.value;
  if (!data) return [];
  return [
    { label: '类型', value: data.genres.join(' / ') }, { label: '地区', value: data.countries.join(' / ') },
    { label: '语言', value: data.languages.join(' / ') }, { label: '首播 / 上映', value: data.releaseDates.join(' / ') },
    { label: '时长', value: data.durations.join(' / ') }, { label: '总集数', value: data.episodeCount ? data.episodeCount + ' 集' : '' },
    { label: '导演', value: data.directors.map(person => person.name).join(' / ') }
  ].filter(field => field.value);
});
const closePerson = async () => { selectedPerson.value = null; await nextTick(); personTrigger?.focus({ preventScroll: true }); };
const selectPerson = (person: CatalogCredit, event: MouseEvent) => {
  if (!person.id) return;
  personTrigger = event.currentTarget as HTMLElement;
  selectedPerson.value = person;
};
watch(() => props.item.catalogId, () => { selectedPerson.value = null; expandedSummary.value = false; expandedCast.value = false; episodesOpen.value = false; });
useDialog(root, () => true, () => { if (selectedPerson.value) void closePerson(); else emit('close'); });
</script>
<template>
  <section ref="root" class="catalog-detail screen-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-detail-title" @click.self="emit('close')" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
    <div class="detail-window">
    <header class="screen-header"><button type="button" class="icon-control detail-back" aria-label="返回浏览" @click="emit('close')"><ArrowLeft /></button><span>影片详情</span><button type="button" class="icon-control detail-close" aria-label="关闭影片详情" @click="emit('close')"><X /></button></header>
    <div class="detail-stage">
      <MediaPoster :src="item.backdrop || item.poster" alt="" class="detail-backdrop" />
      <div class="detail-stage-shade"></div>
      <div class="detail-overview">
        <MediaPoster :src="item.poster" alt="" class="detail-poster" />
        <div class="detail-title-copy">
          <h1 id="catalog-detail-title">{{ item.title }}</h1>
          <p v-if="item.year || details?.genres.length || item.rating" class="detail-meta">
            <span v-if="item.year">{{ item.year }}</span>
            <span v-if="details?.genres.length">{{ details.genres.slice(0, 2).join(' / ') }}</span>
            <span v-if="item.rating">{{ item.ratingSource || '豆瓣' }} {{ item.rating.toFixed(1) }}</span>
          </p>
          <p v-if="hasEpisodes" class="detail-availability">{{ unversionedLibrary && !inLibrary ? '同名影片 · ' : '' }}{{ ownedEpisodes?.length }} 集可看</p>
        </div>
      </div>
    </div>
    <div class="detail-body">
      <div class="detail-actions">
        <button type="button" class="cinema-button primary play-feature" @click="emit('play')"><Play fill="currentColor" />{{ inLibrary ? playLabel || '立即播放' : unversionedLibrary ? '播放同名影片' : '查找并加入片库' }}</button>
        <button v-if="hasEpisodes" type="button" class="cinema-button detail-episode-toggle" :aria-expanded="episodesOpen" aria-controls="detail-episode-list" @click="episodesOpen = !episodesOpen">选集<ChevronDown aria-hidden="true" /></button>
      </div>
      <p v-if="unversionedLibrary && !inLibrary" class="detail-play-note">同名影片未标注年份，可能是另一个版本。</p>
      <div v-if="hasEpisodes" v-show="episodesOpen" id="detail-episode-list" class="detail-episodes" role="group" :aria-label="inLibrary ? '选集' : '同名影片选集'">
        <button v-for="episode in ownedEpisodes" :key="episode" type="button" :aria-label="`播放第 ${episode} 集`" @click="emit('episode', episode)">{{ episode }}</button>
      </div>
      <button type="button" class="text-link detail-versions" @click="emit('sources')"><Search aria-hidden="true" />查看其他版本</button>
    </div>
    <div class="detail-extras" :aria-busy="loading">
      <p v-if="loading && !details" class="metadata-loading" role="status">正在加载剧情与演职人员…</p>
      <div v-if="error || details?.message" class="metadata-feedback" role="status"><p>{{ error || details?.message }}</p><button type="button" class="text-link" :disabled="loading" @click="refresh"><RefreshCw />重新加载资料</button></div>
      <section class="detail-information detail-synopsis" aria-labelledby="detail-synopsis-title">
        <h2 id="detail-synopsis-title">剧情简介</h2>
        <p v-if="details?.summary" ref="summaryText" :class="{ 'summary-clamped': !expandedSummary }">{{ details.summary }}</p>
        <p v-else-if="!loading">资料源暂未提供剧情简介。</p>
        <div v-else class="summary-placeholder" aria-hidden="true"><i></i><i></i><i></i></div>
        <button v-if="summaryOverflow || expandedSummary" type="button" class="text-link summary-toggle" :aria-expanded="expandedSummary" @click="expandedSummary = !expandedSummary">{{ expandedSummary ? '收起简介' : '展开简介' }}<ChevronUp v-if="expandedSummary" /><ChevronDown v-else /></button>
      </section>
      <details v-if="facts.length" class="detail-metadata">
        <summary>影片资料</summary>
        <dl class="detail-facts"><div v-for="field in facts" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl>
      </details>
      <section v-if="people.length" class="detail-information detail-credits" aria-labelledby="detail-credits-title">
        <div class="credits-heading"><h2 id="detail-credits-title">演职人员</h2><span>{{ people.length }} 位</span></div>
        <div class="credit-grid">
          <button v-for="person in visiblePeople" :key="person.id || person.name" type="button" class="credit-card" :class="{ selected: selectedPerson?.id && selectedPerson.id === person.id }" :disabled="!person.id" :aria-label="person.id ? '查看' + person.name + '的人物介绍' : person.name" :aria-expanded="person.id ? selectedPerson?.id === person.id : undefined" @click="selectPerson(person, $event)">
            <CatalogPersonAvatar :src="person.avatar" :name="person.name" /><strong>{{ person.name }}</strong><small>{{ person.role }}</small>
          </button>
        </div>
        <button v-if="people.length > 8" type="button" class="text-link credits-toggle" :aria-expanded="expandedCast" @click="expandedCast = !expandedCast">{{ expandedCast ? '收起演职人员' : '查看全部 ' + people.length + ' 位' }}<ChevronUp v-if="expandedCast" /><ChevronDown v-else /></button>
        <CatalogPersonDetail v-if="selectedPerson" :key="selectedPerson.id" :person="selectedPerson" @close="closePerson" />
      </section>
      <p v-else-if="!loading" class="detail-brief">资料源暂未提供演职人员资料。</p>
      <CatalogComments :item="item" />
      <p v-if="item.status" class="detail-provenance">来源收录状态：{{ item.status }}，可播放集数以实际片源为准。</p>
      <p class="detail-provenance">影片资料：{{ details?.sourceName || item.sourceName }} · 短评：豆瓣</p>
    </div>
    </div>
  </section>
</template>
<style scoped>
.detail-title-copy { min-width: 0; }
.detail-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.detail-overview .detail-availability { margin-top: 8px; color: var(--text-primary); }
.detail-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.detail-actions .play-feature { width: auto; margin: 0; min-height: 44px; padding: 8px 18px; border-radius: 12px; }
.detail-episode-toggle { min-height: 44px; gap: 5px; padding: 8px 10px; color: var(--text-secondary); background: transparent; }
.detail-episode-toggle[aria-expanded='true'] { color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.detail-episode-toggle[aria-expanded='true'] :deep(svg) { transform: rotate(180deg); }
.detail-actions :deep(svg), .detail-versions :deep(svg) { flex-shrink: 0; }
.detail-play-note { margin: 8px 0 0; text-align: left; color: var(--text-secondary); }
.detail-versions { min-height: 44px; margin-top: 4px; }
.detail-episodes { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 8px; margin-top: 12px; max-height: 252px; overflow: auto; scrollbar-width: thin; }
.detail-metadata { border-bottom: 1px solid var(--divider); }
.detail-metadata summary { padding: 12px 0; cursor: pointer; }
.detail-episodes button { appearance: none; min-height: 44px; padding: 0 4px; border: 0; border-radius: 10px; background: var(--surface-2); color: var(--text-primary); font-size: 14px; font-weight: 550; font-variant-numeric: tabular-nums; }
.detail-episodes button:focus-visible { outline-offset: -2px; }
@media (hover: hover) { .detail-episodes button:hover { background: var(--surface-3); } }
.detail-episodes button:active { color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.detail-extras { grid-column: 1 / -1; width: 100%; max-width: 948px; min-width: 0; padding: 0 24px calc(32px + var(--safe-area-bottom)); margin-inline: auto; }
.detail-facts { display: grid; gap: 12px; margin: 24px 0; }
@media (max-width: 767px) {
  .detail-stage { padding: 24px 20px 16px; }
  .detail-overview { align-items: center; gap: 14px; }
  .detail-poster { width: 92px; box-shadow: none; }
  .detail-overview h1 { margin: 0 0 8px; letter-spacing: 0; }
  .detail-body { padding-bottom: 0; }
  .detail-extras .detail-synopsis { padding: 16px 0 12px; margin: 0; border: 0; border-radius: 0; background: transparent; }
}
.detail-facts > div { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 12px; }
.detail-facts dt { color: var(--text-tertiary); font-size: 12px; line-height: 1.8; }
.detail-facts dd { font-size: 13px; line-height: 1.8; color: var(--text-primary); overflow-wrap: anywhere; }
.detail-brief { color: var(--text-tertiary); font-size: 13px; line-height: 1.9; margin-bottom: 24px; }
.metadata-loading, .metadata-feedback { color: var(--text-tertiary); font-size: 13px; line-height: 1.8; }
.metadata-feedback { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 16px 20px; border: 1px solid var(--divider); border-radius: var(--cinema-radius-card); background: var(--surface-1); }
.detail-synopsis { margin-top: 0; }
.detail-synopsis p { white-space: pre-line; overflow-wrap: anywhere; }
.summary-clamped { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; overflow: hidden; }
.summary-toggle { color: var(--liquid-accent); }
.summary-placeholder { display: grid; gap: 12px; padding: 4px 0; }
.summary-placeholder i { height: 12px; background: var(--surface-2); border-radius: 6px; }
.summary-placeholder i:last-child { width: 65%; }
.credits-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.credits-heading h2 { margin: 0; }
.credits-heading > span { color: var(--text-tertiary); font-size: 12px; }
.credit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 24px 16px; }
.credit-card { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; padding: 8px 4px; border: 0; border-radius: 14px; background: transparent; color: var(--text-primary); text-align: center; animation: fadeInCard .22s ease-out; transition: background .2s, transform .15s; }
.credit-card:hover, .credit-card.selected { background: var(--glass-bg-hover); }
.credit-card:active:not(:disabled) { transform: scale(.96); }
.credit-card:disabled { opacity: 1; cursor: default; }
.credit-card strong { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.credit-card small { font-size: 11px; color: var(--text-tertiary); line-height: 1.7; overflow-wrap: anywhere; }
.credits-toggle { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 42px; margin-top: 20px; border-radius: 12px; background: var(--surface-1); color: var(--liquid-accent); font-size: 13px; font-weight: 550; transition: background .2s, transform .15s; }
.credits-toggle:hover { background: var(--liquid-accent-subtle); }
.credits-toggle:active { transform: scale(.98); }
@keyframes fadeInCard { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.detail-provenance { font-size: 11px; line-height: 1.8; color: var(--text-tertiary); }
@media (min-width: 1024px) { .detail-extras { max-width: none; padding: 0 32px 32px; } }
@media (max-width: 767px) { .detail-extras { padding-left: 20px; padding-right: 20px; } .detail-information { padding: 20px; } .credit-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px 10px; } .credit-card :deep(.person-avatar) { width: 64px; height: 64px; } .detail-facts > div { grid-template-columns: 70px minmax(0, 1fr); } }
@media (max-width: 359px) { .credit-card :deep(.person-avatar) { width: 54px; height: 54px; } }
</style>
