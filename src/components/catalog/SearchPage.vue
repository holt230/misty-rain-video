<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowUpRight, Clock3, Link, Search, Trash2, X } from '@lucide/vue';
import type { CatalogItem } from '../../types/catalog';
import type { CategoryType, MediaItem } from '../../types/media';
import { parseLibraryInput, type LibrarySaveFeedback } from '../../services/libraryFeedback';
import CatalogCard from './CatalogCard.vue';
import MediaPoster from '../common/MediaPoster.vue';
const props = defineProps<{ library: MediaItem[]; catalog: CatalogItem[]; username: string; busy: boolean; error?: LibrarySaveFeedback | null }>();
const emit = defineEmits<{
  (event: 'search', keyword: string, category: CategoryType): void;
  (event: 'select', item: CatalogItem): void;
  (event: 'play', item: MediaItem): void;
  (event: 'save', item: MediaItem): void;
  (event: 'auth'): void;
  (event: 'clear-error'): void;
}>();
const query = ref('');
const category = ref<CategoryType>('tv');
const recent = ref<string[]>([]);
const input = ref<HTMLInputElement | null>(null);
const storageKey = computed(() => 'misty_search_history:' + props.username);
watch(storageKey, () => {
  try { const saved = JSON.parse(localStorage.getItem(storageKey.value) || '[]'); recent.value = Array.isArray(saved) ? saved.filter(value => typeof value === 'string').slice(0, 10) : []; }
  catch { recent.value = []; }
}, { immediate: true });
watch(query, () => emit('clear-error'));
const parsed = computed(() => parseLibraryInput(query.value));
const libraryMatches = computed(() => query.value.trim() && parsed.value.kind !== 'share' ? props.library.filter(item => item.title.toLowerCase().includes(query.value.trim().toLowerCase())).slice(0, 6) : []);
const catalogMatches = computed(() => {
  const seen = new Set();
  return props.catalog.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return !query.value.trim() || item.title.toLowerCase().includes(query.value.trim().toLowerCase());
  }).slice(0, query.value.trim() ? 12 : 6);
});
function remember() {
  recent.value = [query.value.trim(), ...recent.value.filter(item => item !== query.value.trim())].slice(0, 10);
  try { localStorage.setItem(storageKey.value, JSON.stringify(recent.value)); } catch { /* Search works without persistence. */ }
}
function clearHistory() { recent.value = []; try { localStorage.removeItem(storageKey.value); } catch { /* No persistent history available. */ } }
function submit() {
  if (props.busy || !query.value.trim() || parsed.value.kind === 'invalid') return;
  if (parsed.value.kind === 'share') {
    emit('save', { id: 'import-' + Date.now(), title: '待识别片名', category: category.value, poster: '', tag: '', quarkShareUrl: parsed.value.url, quarkPasscode: parsed.value.passcode });
  } else { remember(); emit('search', query.value.trim(), category.value); }
}
defineExpose({ focus: () => input.value?.focus() });
</script>
<template>
  <main class="search-page">
    <div class="search-intro"><span class="eyebrow">每一个好故事，都值得被找到</span><h1>想看什么？</h1></div>
    <form class="discovery-search" role="search" @submit.prevent="submit">
      <Search /><input ref="input" v-model="query" type="search" placeholder="搜索片名，或粘贴分享链接" aria-label="搜索片名或分享链接" enterkeyhint="search" :disabled="busy" @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.preventDefault()" />
      <button v-if="query" type="button" class="icon-control" aria-label="清空搜索" :disabled="busy" @click="query = ''; input?.focus()"><X /></button>
      <button type="submit" :disabled="busy || !query.trim()" class="search-submit">{{ busy ? '添加中' : parsed.kind === 'share' ? '添加' : '搜索' }}</button>
    </form>
    <label class="search-category">保存分类<select v-model="category" :disabled="busy" aria-label="影片保存分类"><option value="tv">电视剧</option><option value="movie">电影</option><option value="anime">动漫</option><option value="variety">综艺</option></select></label>
    <p v-if="parsed.kind === 'share'" class="feed-notice"><Link />已识别分享链接，添加时读取真实片名并验证资源。</p>
    <p v-if="parsed.kind === 'invalid'" role="alert" class="feed-notice">链接格式不正确，请输入完整的夸克分享链接。</p>
    <div v-if="error" class="inline-feedback" role="alert"><strong>{{ error.title }}</strong><p>{{ error.message }}</p><button v-if="error.needsAuth" type="button" @click="emit('auth')">前往认证设置</button></div>
    <section v-if="recent.length && !query.trim()" class="content-section"><div class="section-heading"><h2><Clock3 />最近搜索</h2><button type="button" class="icon-control" aria-label="清空搜索历史" @click="clearHistory"><Trash2 /></button></div><div class="recent-searches"><button v-for="term in recent" :key="term" type="button" @click="query = term; submit()">{{ term }}<ArrowUpRight /></button></div></section>
    <section v-if="libraryMatches.length" class="content-section"><div class="section-heading"><div><h2>你的片库中有</h2><p>直接播放，无需再次添加</p></div></div><div class="continue-rail"><button v-for="item in libraryMatches" :key="item.id" type="button" class="resume-card" @click="emit('play', item)"><MediaPoster :src="item.poster" alt="" /><span><strong>{{ item.title }}</strong><small>已入库 · 播放 / 续播</small></span></button></div></section>
    <section v-if="catalogMatches.length && parsed.kind !== 'share'" class="content-section"><div class="section-heading"><div><h2>{{ query.trim() ? '相关影片' : '现在大家在看' }}</h2><p>从热门作品开始探索</p></div></div><div class="catalog-grid"><CatalogCard v-for="item in catalogMatches" :key="item.id" :item="item" @select="emit('select', $event)" /></div></section>
    <p v-if="query.trim() && !catalogMatches.length && !libraryMatches.length && parsed.kind !== 'share'" class="search-hint">目录中暂未收录，点击“搜索”继续查找外部资源。</p>
  </main>
</template>
