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
const props = defineProps<{ item: CatalogItem; inLibrary: boolean }>();
const emit = defineEmits<{ (event: 'close'): void; (event: 'play'): void; (event: 'sources'): void }>();
const root = ref<HTMLElement | null>(null);
const selectedPerson = ref<CatalogCredit | null>(null);
const expandedSummary = ref(false);
const expandedCast = ref(false);
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
const { data: details, loading, error, refresh } = useCatalogDetails<CatalogWorkDetails>(
  () => '/api/catalog/works/' + props.item.catalogId.replace(/^douban:/, '') + '?category=' + props.item.category,
  value => ({ ...value, directors: value.directors.map(catalogAvatar), actors: value.actors.map(catalogAvatar) })
);
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
watch(() => props.item.catalogId, () => { selectedPerson.value = null; expandedSummary.value = false; expandedCast.value = false; });
useDialog(root, () => true, () => { if (selectedPerson.value) void closePerson(); else emit('close'); });
</script>
<template>
  <section ref="root" class="catalog-detail screen-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-detail-title" @click.self="emit('close')">
    <div class="detail-window">
    <header class="screen-header"><button type="button" class="icon-control detail-back" aria-label="返回浏览" @click="emit('close')"><ArrowLeft /></button><span>影片详情</span><button type="button" class="icon-control detail-close" aria-label="关闭影片详情" @click="emit('close')"><X /></button></header>
    <div class="detail-stage">
      <MediaPoster :src="item.poster" alt="" class="detail-backdrop" />
      <div class="detail-stage-shade"></div>
      <div class="detail-overview"><MediaPoster :src="item.poster" :alt="item.title + '海报'" class="detail-poster" /><div><span class="eyebrow">{{ item.year || '发现好故事' }}</span><h1 id="catalog-detail-title">{{ item.title }}</h1><p>{{ item.status || '影片资料' }}</p><span v-if="item.rating" class="detail-score">{{ item.rating.toFixed(1) }}<small>豆瓣评分</small></span></div></div>
    </div>
    <div class="detail-body">
      <button type="button" class="cinema-button primary play-feature" @click="emit('play')"><Play fill="currentColor" />{{ inLibrary ? '立即播放 / 续播' : '找源并播放' }}</button>
      <p class="detail-play-note">{{ inLibrary ? '从你的个人片库播放，自动恢复观看进度' : '自动查找匹配资源，验证后加入个人片库并播放' }}</p>
      <dl v-if="facts.length" class="detail-facts"><div v-for="field in facts" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl>
      <p v-else class="detail-brief">{{ item.subtitle || '发现下一部喜欢的作品' }}</p>
      <button type="button" class="cinema-button secondary" @click="emit('sources')"><Search />自己选择片源</button>
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
      <p class="detail-provenance">资料与短评来源：豆瓣</p>
    </div>
    </div>
  </section>
</template>
<style scoped>
.detail-extras { grid-column: 1 / -1; width: 100%; max-width: 948px; min-width: 0; padding: 0 24px calc(32px + var(--safe-area-bottom)); margin-inline: auto; }
.detail-facts { display: grid; gap: 12px; margin: 24px 0; }
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
.credit-card { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; padding: 8px 4px; border: 0; border-radius: 14px; background: transparent; color: var(--text-primary); text-align: center; }
.credit-card:hover, .credit-card.selected { background: var(--glass-bg-hover); }
.credit-card:disabled { opacity: 1; cursor: default; }
.credit-card strong { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.credit-card small { font-size: 11px; color: var(--text-tertiary); line-height: 1.7; overflow-wrap: anywhere; }
.credits-toggle { display: flex; width: 100%; margin-top: 20px; color: var(--liquid-accent); }
.detail-provenance { font-size: 11px; line-height: 1.8; color: var(--text-tertiary); }
@media (min-width: 1024px) { .detail-extras { max-width: none; padding: 0 32px 32px; } }
@media (max-width: 767px) { .detail-extras { padding-left: 20px; padding-right: 20px; } .detail-information { padding: 20px; } .credit-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px 10px; } .credit-card :deep(.person-avatar) { width: 64px; height: 64px; } .detail-facts > div { grid-template-columns: 70px minmax(0, 1fr); } }
@media (max-width: 359px) { .credit-card :deep(.person-avatar) { width: 54px; height: 54px; } }
</style>
