<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Clock3, Link, Search, X } from '@lucide/vue';
import type { CatalogItem } from '../../types/catalog';
import type { MediaItem } from '../../types/media';
import type { SearchCategory } from '../../types/search';
import { parseLibraryInput, type LibrarySaveFeedback } from '../../services/libraryFeedback';
import CatalogCard from './CatalogCard.vue';
import CinemaStill from '../common/CinemaStill.vue';
import { cinemaBackdrop, type CinemaBackdrops } from '../../services/cinemaPresentation';
import { searchIntent } from '../../services/searchIntent';
import { resourceTitleKey } from '../../services/resourceTitles';
const props = defineProps<{ library: MediaItem[]; catalog: CatalogItem[]; backdrops?: CinemaBackdrops; username: string; busy: boolean; playLabel?: (fid?: string) => string; showResults?: boolean; searching?: boolean; error?: LibrarySaveFeedback | null }>();
const emit = defineEmits<{
  (event: 'search', keyword: string, category: SearchCategory): void;
  (event: 'select', item: CatalogItem): void;
  (event: 'play', item: MediaItem, episode?: number): void;
  (event: 'save', item: MediaItem): void;
  (event: 'auth'): void;
  (event: 'clear-error'): void;
  (event: 'criteria-change'): void;
}>();
const query = ref('');
const category = ref<SearchCategory>('all');
const categories: { id: SearchCategory; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'tv', label: '电视剧' }, { id: 'movie', label: '电影' },
  { id: 'anime', label: '动漫' }, { id: 'variety', label: '综艺' }
];
const recent = ref<string[]>([]);
const input = ref<HTMLInputElement | null>(null);
const ownedResults = ref<HTMLElement | null>(null);
const ownedSearchSubmitted = ref(false);
const storageKey = computed(() => 'misty_search_history:' + props.username);
watch(storageKey, () => {
  try { const saved = JSON.parse(localStorage.getItem(storageKey.value) || '[]'); recent.value = Array.isArray(saved) ? saved.filter(value => typeof value === 'string').slice(0, 10) : []; }
  catch { recent.value = []; }
}, { immediate: true });
watch([query, category], () => { ownedSearchSubmitted.value = false; emit('clear-error'); emit('criteria-change'); }, { flush: 'sync' });
const parsed = computed(() => parseLibraryInput(query.value));
const shareNeedsCategory = computed(() => parsed.value.kind === 'share' && category.value === 'all');
const intent = computed(() => searchIntent(query.value));
const libraryMatches = computed(() => resourceTitleKey(intent.value.title) && parsed.value.kind === 'search' ? props.library.filter(item => item.quarkFid
  && (category.value === 'all' || item.category === category.value)
  && resourceTitleKey(item.title).includes(resourceTitleKey(intent.value.title))).slice(0, 6) : []);
const catalogMatches = computed(() => {
  const seen = new Set();
  return props.catalog.filter(item => {
    if (seen.has(item.id) || (category.value !== 'all' && item.category !== category.value)) return false;
    seen.add(item.id);
    return !intent.value.title.trim() || item.title.toLowerCase().includes(intent.value.title.trim().toLowerCase());
  }).slice(0, query.value.trim() ? 12 : 6);
});
function remember() {
  recent.value = [query.value.trim(), ...recent.value.filter(item => item !== query.value.trim())].slice(0, 10);
  try { localStorage.setItem(storageKey.value, JSON.stringify(recent.value)); } catch { /* Search works without persistence. */ }
}
function clearHistory() { recent.value = []; try { localStorage.removeItem(storageKey.value); } catch { /* No persistent history available. */ } }
function removeHistory(term: string) {
  recent.value = recent.value.filter(item => item !== term);
  try { localStorage.setItem(storageKey.value, JSON.stringify(recent.value)); } catch { /* Search works without persistence. */ }
}
function searchExternal() {
  if (props.busy || parsed.value.kind !== 'search' || !query.value.trim()) return;
  remember(); emit('search', query.value.trim(), category.value);
}
function submit() {
  if (props.busy || !query.value.trim() || parsed.value.kind === 'invalid' || shareNeedsCategory.value) return;
  input.value?.blur();
  if (parsed.value.kind === 'share') {
    if (category.value === 'all') return;
    emit('save', { id: 'import-' + Date.now(), title: '待识别片名', category: category.value, poster: '', tag: '', quarkShareUrl: parsed.value.url, quarkPasscode: parsed.value.passcode });
  } else if (libraryMatches.value.length) {
    remember(); ownedSearchSubmitted.value = true;
    ownedResults.value?.scrollIntoView({ block: 'start', behavior: 'auto' });
  } else searchExternal();
}
defineExpose({ focus: () => input.value?.focus(), search: (keyword: string) => { query.value = keyword; submit(); } });
</script>
<template>
  <main class="search-page">
    <header class="search-intro"><h1 class="cinema-page-title">找片</h1></header>
    <form class="discovery-search cinema-search-field" role="search" @submit.prevent="submit">
      <Search aria-hidden="true" /><input ref="input" v-model="query" type="search" placeholder="搜索片名或粘贴链接" aria-label="搜索片名或分享链接" enterkeyhint="search" :disabled="busy" @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.preventDefault()" />
      <button v-if="query" type="button" class="icon-control" aria-label="清空搜索" :disabled="busy" @click="query = ''; input?.focus()"><X /></button>
      <button type="submit" :disabled="busy || searching || !query.trim() || shareNeedsCategory || parsed.kind === 'invalid'" class="search-submit">{{ busy ? '请稍候' : searching ? '搜索中…' : parsed.kind === 'share' ? '添加' : '搜索' }}</button>
    </form>
    <div class="search-category-filter" role="group" aria-label="搜索与保存分类"><button v-for="item in categories" :key="item.id" type="button" :data-category="item.id" :aria-pressed="category === item.id" :class="{ active: category === item.id }" :disabled="busy" @click="category = item.id">{{ item.label }}</button></div>
    <div id="discovery-results" v-show="showResults"></div>
    <p v-if="parsed.kind === 'share'" class="feed-notice"><Link />{{ shareNeedsCategory ? '已识别分享链接，请先选择影视分类后添加。' : '已识别分享链接，添加时读取真实片名并验证资源。' }}</p>
    <p v-if="parsed.kind === 'invalid'" role="alert" class="feed-notice">链接格式不正确，请输入完整的夸克分享链接。</p>
    <div v-if="error" class="inline-feedback" role="alert"><strong>{{ error.title }}</strong><p>{{ error.message }}</p><button v-if="error.needsAuth" type="button" @click="emit('auth')">前往认证设置</button></div>
    <section v-if="recent.length && !query.trim()" class="content-section search-recent">
      <div class="section-heading"><h2><Clock3 />最近搜索</h2><button type="button" class="text-link" aria-label="清空搜索历史" @click="clearHistory">清空</button></div>
      <div class="recent-searches">
        <span v-for="term in recent" :key="term" class="recent-chip">
          <button type="button" class="recent-text" @click="query = term; submit()">{{ term }}</button>
          <button type="button" class="recent-remove" :aria-label="'删除搜索记录：' + term" @click.stop="removeHistory(term)"><X aria-hidden="true" /></button>
        </span>
      </div>
    </section>
    <section v-if="!showResults && libraryMatches.length" ref="ownedResults" class="content-section owned-search-results" aria-label="片库搜索结果"><div class="section-heading"><div><h2>你的片库中有</h2><p role="status">{{ ownedSearchSubmitted ? `找到 ${libraryMatches.length} 部已保存影片，点击即可播放` : '直接播放，无需再次添加' }}</p></div></div><div class="continue-rail"><button v-for="item in libraryMatches" :key="item.id" type="button" class="resume-card" :disabled="busy" @click="emit('play', item, intent.episode)"><CinemaStill :poster="item.poster" :backdrop="cinemaBackdrop(item, backdrops)" /><span><strong>{{ item.title }}</strong><small>{{ intent.episode ? `播放第 ${intent.episode} 集` : (playLabel?.(item.quarkFid) || '立即播放') }}</small></span></button></div><button type="button" class="cinema-button secondary" :disabled="busy" @click="searchExternal">查找其他版本</button></section>
    <section v-if="!showResults && catalogMatches.length && parsed.kind !== 'share'" class="content-section search-catalog"><div class="section-heading"><div><h2>{{ query.trim() ? '相关影片' : '热门推荐' }}</h2></div></div><div class="catalog-grid"><CatalogCard v-for="item in catalogMatches" :key="item.id" :item="item" @select="emit('select', $event)" /></div></section>
  </main>
</template>
<style scoped>
.search-intro { margin: 0 0 14px; }
.discovery-search > svg { width: 18px; height: 18px; }
.discovery-search input { min-height: 44px; }
.discovery-search .icon-control { padding: 9px; margin-right: -4px; }
.search-submit { align-self: center; min-width: 53px; padding: 0 10px; }
.search-submit:disabled { color: var(--text-tertiary); background: transparent; opacity: 1; }
.search-category-filter { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin-top: 6px; border-bottom: 1px solid var(--divider); }
.search-category-filter button { position: relative; min-width: 0; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--text-secondary); font-size: 13px; white-space: nowrap; }
.search-category-filter button.active { color: var(--text-primary); font-size: 15px; font-weight: 750; }
.search-category-filter button.active::after { content: ''; position: absolute; bottom: 3px; left: 50%; translate: -50% 0; width: 15px; height: 2px; border-radius: 2px; background: var(--liquid-accent); }
.search-category-filter button:focus-visible { outline-offset: -3px; }
.search-page > .content-section { margin-top: 20px; }
.search-page .section-heading { margin-bottom: 10px; }
.search-recent .section-heading { margin-bottom: 0; }
.search-recent .section-heading h2 { gap: 6px; font-size: 14px; color: var(--text-secondary); }
.search-recent h2 svg { width: 15px; height: 15px; }
.search-recent .text-link { min-width: 44px; justify-content: end; }
.search-recent .recent-searches { flex-wrap: nowrap; gap: 7px; overflow-x: auto; scrollbar-width: none; }
.search-recent .recent-chip { flex: 0 0 auto; max-width: 85%; background: transparent; }
.search-recent .recent-text { display: block; min-width: 0; max-width: 20ch; padding: 0 0 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-recent .recent-remove { width: 44px; padding: 0; }
.search-recent .recent-searches button:focus-visible { outline-offset: -2px; }
.owned-search-results { scroll-margin-top: 76px; }
.owned-search-results .continue-rail { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 10px; }
.owned-search-results .resume-card { width: 100%; min-width: 0; gap: 11px; padding: 8px; border-radius: var(--cinema-radius-control); }
.owned-search-results .resume-card .cinema-still { width: clamp(76px, 23vw, 104px); }
.owned-search-results .resume-card > span:not(.cinema-still) { flex: 1; }
.owned-search-results > .cinema-button { margin-top: 12px; }
@media (min-width: 768px) {
  .search-category-filter { max-width: 460px; }
  .search-page > .content-section { margin-top: 24px; }
}
</style>
