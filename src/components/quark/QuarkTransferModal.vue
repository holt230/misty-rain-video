<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, ChevronDown, RefreshCw, Search, SlidersHorizontal, X } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import type { MediaItem, CategoryType } from '../../types/media';
import type { ResourceItem } from '../../types/search';
import SkeletonCard from '../common/SkeletonCard.vue';
import type { LibrarySaveFeedback } from '../../services/libraryFeedback';
import { useDialog } from '../../composables/useDialog';

const props = defineProps<{
  isOpen: boolean;
  isAnalyzing: boolean;
  media: MediaItem | null;
  currentCategory: CategoryType;
  quarkResources: ResourceItem[];
  searchError?: string;
  searchKeyword?: string;
  isSaving?: boolean;
  savingResourceId?: string;
  saveError?: LibrarySaveFeedback | null;
  failedResourceId?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-auth-settings'): void;
  (e: 'transfer', res: ResourceItem): void;
  (e: 'retry-search'): void;
  (e: 'search', keyword: string): void;
  (e: 'save-to-cards', media: MediaItem, targetCategory: CategoryType, bestRes?: ResourceItem): void;
}>();

const targetCategory = ref<CategoryType>('tv');
const categoryExpanded = ref(false);
const categories: Array<{ value: CategoryType; label: string }> = [
  { value: 'tv', label: '电视剧' }, { value: 'movie', label: '电影' },
  { value: 'variety', label: '综艺' }, { value: 'anime', label: '动漫' }
];
const targetCategoryName = computed(() => categories.find(category => category.value === targetCategory.value)?.label || '电视剧');
const replacingSource = computed(() => Boolean(props.media?.quarkFid));
type ResultFilter = 'recommended' | 'latest' | '4k' | 'complete';
const resultFilter = ref<ResultFilter>('recommended');
const searchQuery = ref('');
const visibleCount = ref(20);
const batchSize = 20;

const filterOptions: Array<{ value: ResultFilter; label: string }> = [
  { value: 'recommended', label: '推荐' },
  { value: 'latest', label: '最新' },
  { value: '4k', label: '4K' },
  { value: 'complete', label: '完整' }
];

const cleanTitle = (title: string) => title
  .replace(/^[\s🗄📁💾💿🔍📜⬇️·|#]+/u, '')
  .replace(/\s+/g, ' ')
  .trim();

const titleKey = (title: string) => cleanTitle(title)
  .toLocaleLowerCase('zh-CN')
  .replace(/[\s\p{P}\p{S}]+/gu, '');

const canonicalShareUrl = (url: string) => {
  const match = url.match(/^https:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/i);
  return match ? `https://pan.quark.cn/s/${match[1]}` : '';
};

const episodeNumber = (title: string) => {
  const numbers = [...title.matchAll(/(?:更(?:新)?至?|第|e(?:p)?)[\s_-]*0*(\d{1,4})/ig)]
    .map(match => Number(match[1]))
    .filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) : 0;
};

/**
 * 聚合结果没有稳定的文件 MIME 信息，不能仅凭清晰度给资源排序。先剔除
 * 明确不是视频的条目，避免有声书、电子书被误选为剧集来源。
 */
const isNonVideoResource = (resource: ResourceItem) => {
  const title = cleanTitle(resource.title);
  return /有声(?:小说|书)?|播讲|演播|朗读|听书|音频|原声带|广播剧|相声|评书|电子书|小说|漫画|kindle/i.test(title)
    || /(?:^|[.\s_\-\[\]()（）])(?:mp3|flac|aac|m4a|wav|ape|ogg|epub|mobi|azw3|pdf|txt|docx?)(?:$|[.\s_\-\]\]()（）])/i.test(title);
};

const resourceScore = (resource: ResourceItem) => {
  const title = cleanTitle(resource.title);
  const keyword = props.searchKeyword?.trim() || props.media?.title.trim() || '';
  const normalizedTitle = titleKey(title);
  const normalizedKeyword = titleKey(keyword);
  let score = 0;
  if (normalizedTitle === normalizedKeyword) score += 120;
  else if (normalizedTitle.startsWith(normalizedKeyword)) score += 90;
  else if (normalizedTitle.includes(normalizedKeyword)) score += 65;
  else score -= 80;
  if (resource.is4k || /4k/i.test(title)) score += 30;
  if (/hdr|dv|杜比视界/i.test(title)) score += 10;
  if (/60\s*(?:fps|帧)/i.test(title)) score += 8;
  if (/dts|杜比|5\.1/i.test(title)) score += 5;
  if (/全集|完结|全\s*\d+\s*集/i.test(title)) score += 14;
  if (/flac|mp3|片尾曲|原声带|音乐/i.test(title)) score -= 160;
  const timestamp = Date.parse(resource.datetime);
  if (Number.isFinite(timestamp)) {
    const year = new Date(timestamp).getFullYear();
    if (year <= 2001) score -= 90;
    else if (year >= new Date().getFullYear() - 1) score += 24;
  }
  score += Math.min(episodeNumber(title), 100) / 2;
  return score;
};

const rankAndDedupe = (resources: ResourceItem[]) => {
  const sorted = resources.filter(resource => !isNonVideoResource(resource)).sort((left, right) => {
    const scoreDelta = resourceScore(right) - resourceScore(left);
    if (scoreDelta) return scoreDelta;
    return Date.parse(right.datetime) - Date.parse(left.datetime);
  });
  const seen = new Set<string>();
  return sorted.filter(resource => {
    const key = canonicalShareUrl(resource.url);
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const rankedQuarkResources = computed(() => rankAndDedupe(
  props.quarkResources.filter(resource => /pan\.quark\.cn\/s\/[a-zA-Z0-9]+/i.test(resource.url))
));
const filteredResources = computed(() => {
  const resources = rankedQuarkResources.value.filter(resource => {
    const title = cleanTitle(resource.title);
    if (resultFilter.value === '4k') return resource.is4k || /4k/i.test(title);
    if (resultFilter.value === 'complete') return /全集|完结|全\s*\d+\s*集/i.test(title);
    return true;
  });
  if (resultFilter.value !== 'latest') return resources;
  return [...resources].sort((left, right) => Date.parse(right.datetime) - Date.parse(left.datetime));
});
const visibleResources = computed(() => filteredResources.value.slice(0, visibleCount.value));
const hasMoreResources = computed(() => visibleResources.value.length < filteredResources.value.length);
const bestQuarkResource = computed(() => rankedQuarkResources.value[0]);

watch([() => props.media?.id, () => props.currentCategory], () => {
  targetCategory.value = props.media?.category || props.currentCategory;
  categoryExpanded.value = false;
}, { immediate: true });

watch([() => props.isOpen, () => props.searchKeyword], ([isOpen, keyword]) => {
  if (isOpen) searchQuery.value = keyword || props.media?.title || '';
}, { immediate: true });

watch([() => props.isOpen, () => props.media?.id, resultFilter], () => {
  visibleCount.value = batchSize;
});

const loadMore = () => {
  if (props.isSaving) return;
  visibleCount.value = Math.min(filteredResources.value.length, visibleCount.value + batchSize);
};

const submitSearch = () => {
  const keyword = searchQuery.value.trim();
  if (!keyword || props.isAnalyzing || props.isSaving) return;
  emit('search', keyword);
};

const handleBodyScroll = (event: Event) => {
  const target = event.currentTarget as HTMLElement;
  if (hasMoreResources.value && target.scrollTop + target.clientHeight >= target.scrollHeight - 180) loadMore();
};

const requestClose = () => {
  if (!props.isSaving) emit('close');
};
const dialogRef = ref<HTMLElement | null>(null);
useDialog(dialogRef, () => props.isOpen, requestClose);
</script>

<template>
  <div
    class="liquid-dialog-backdrop"
    ref="dialogRef"
    :class="{ active: isOpen }"
    role="dialog"
    aria-modal="true"
    aria-labelledby="resource-dialog-title"
    @keydown.esc.stop="requestClose"
    @click.self="requestClose"
  >
    <div class="liquid-dialog glass-rim" v-if="media" :aria-busy="isSaving || isAnalyzing">
      <!-- 弹窗顶栏 -->
      <div class="dialog-header">
        <div class="media-meta-row">
<MediaPoster :src="media.poster" :alt="media.title" class="dialog-poster" />
          <div class="dialog-meta-info">
            <div class="meta-title-line">
              <h3 id="resource-dialog-title" class="dialog-title" :title="media.title">{{ media.title }}</h3>
            </div>

            <!-- 默认沿用当前分类，需要时再展开修改。 -->
            <div class="cat-selector-row">
              <button type="button" class="category-picker-trigger" :disabled="isSaving" :aria-expanded="categoryExpanded" aria-controls="resource-category-options" @click="categoryExpanded = !categoryExpanded">
                分类 · {{ targetCategoryName }}<ChevronDown aria-hidden="true" />
              </button>
              <div v-if="categoryExpanded" id="resource-category-options" class="cat-pill-group" role="group" aria-label="选择保存分类">
                <button
                  v-for="category in categories"
                  :key="category.value"
                  type="button"
                  class="cat-select-pill"
                  :class="{ active: targetCategory === category.value }"
                  :aria-pressed="targetCategory === category.value"
                  :disabled="isSaving"
                  @click="targetCategory = category.value; categoryExpanded = false"
                >
                  {{ category.label }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="dialog-top-actions">
          <button class="btn-close-dialog" type="button" aria-label="关闭资源选择" :disabled="isSaving" @click="requestClose">
            <X aria-hidden="true" />
          </button>
        </div>
      </div>

      <form class="result-search" role="search" @submit.prevent="submitSearch">
        <Search class="result-search-icon" aria-hidden="true" />
        <input
          v-model="searchQuery"
          type="search"
          inputmode="search"
          enterkeyhint="search"
          autocomplete="off"
          aria-label="重新输入片名搜索资源"
          placeholder="修改片名重新搜索"
          :disabled="isAnalyzing || isSaving"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="clear-search-button"
          aria-label="清空搜索内容"
          :disabled="isAnalyzing || isSaving"
          @click="searchQuery = ''"
        >
          <X aria-hidden="true" />
        </button>
        <button
          type="submit"
          class="submit-search-button"
          :disabled="isAnalyzing || isSaving || !searchQuery.trim()"
        >
          {{ isAnalyzing ? '检索中' : '搜索' }}
        </button>
      </form>

      <div v-if="!isAnalyzing && !searchError" class="result-summary" aria-live="polite">
        <span>找到</span>
        <strong>{{ rankedQuarkResources.length }}</strong>
        <span>条候选资源 · 添加时验证链接</span>
      </div>

      <div v-if="!isAnalyzing" class="result-filters" role="radiogroup" aria-label="资源筛选">
        <SlidersHorizontal aria-hidden="true" />
        <button
          v-for="option in filterOptions"
          :key="option.value"
          type="button"
          class="filter-chip"
          :class="{ active: resultFilter === option.value }"
          role="radio"
          :aria-checked="resultFilter === option.value"
          :disabled="isSaving"
          @click="resultFilter = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <!-- 列表内容 -->
      <div class="dialog-body" @scroll.passive="handleBodyScroll">
        <template v-if="isAnalyzing">
          <div class="loading-bar">
            <div class="mini-spinner"></div>
            <span>正在检索《{{ searchKeyword || media.title }}》网盘资源...</span>
          </div>
          <SkeletonCard v-for="i in 3" :key="i" />
        </template>

        <template v-else>
          <div v-if="visibleResources.length > 0" class="resource-rows">
            <div
              v-for="res in visibleResources"
              :key="res.id"
              class="liquid-resource-row"
            >
              <div class="row-left">
                <div class="row-info">
                  <div class="row-title" :title="cleanTitle(res.title)">
                    <span v-if="res.id === bestQuarkResource?.id" class="recommended-badge">
                      <Check aria-hidden="true" />推荐
                    </span>
                    {{ cleanTitle(res.title) }}
                  </div>
                  <div v-if="saveError && failedResourceId === res.id" class="inline-feedback resource-save-error" role="alert">
                    <strong>{{ saveError.title }}</strong>
                    <p>{{ saveError.message }}</p>
                    <button v-if="saveError.needsAuth" type="button" @click="emit('open-auth-settings')">前往认证设置</button>
                  </div>
                  <div class="row-tags">
                    <span class="tag-badge">{{ res.quality }}</span>
                    <span v-if="res.size" class="tag-meta">{{ res.size }}</span>
                    <span v-if="res.password" class="tag-meta">提取码已自动识别</span>
                    <span class="tag-meta">{{ res.datetime }}</span>
                  </div>
                </div>
              </div>

              <div class="row-right">
                <button
                  class="btn-action btn-transfer"
                  :class="{ 'is-saving': isSaving && savingResourceId === res.id }"
                  :disabled="isSaving"
                  @click="emit('save-to-cards', media, targetCategory, res)"
                >
                  {{ isSaving && savingResourceId === res.id ? (replacingSource ? '正在替换…' : '正在添加…') : failedResourceId === res.id && saveError ? '重试' : replacingSource ? '替换片源' : '加入片库' }}
                </button>
              </div>
            </div>

            <button v-if="hasMoreResources" type="button" class="load-more-button" :disabled="isSaving" @click="loadMore">
              加载更多 · 还有 {{ filteredResources.length - visibleResources.length }} 条
            </button>
          </div>

          <div v-else class="empty-notice" role="status">
            <span>{{ searchError || (resultFilter === 'recommended' ? '暂时没有可用资源，可以修改上方片名重新搜索。' : '当前筛选下没有结果，试试“推荐”。') }}</span>
            <button v-if="searchError" type="button" class="retry-search-button" :disabled="isSaving" @click="emit('retry-search')">
              <RefreshCw aria-hidden="true" />
              重新检索
            </button>
            <button v-else-if="resultFilter !== 'recommended'" type="button" class="retry-search-button" @click="resultFilter = 'recommended'">查看全部候选资源</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.liquid-dialog-backdrop { position: fixed; inset: 0; z-index: 1400; display: flex; align-items: center; justify-content: center; padding: 24px; opacity: 0; visibility: hidden; }
.liquid-dialog-backdrop.active { opacity: 1; visibility: visible; }
.liquid-dialog { display: flex; width: min(820px, 100%); max-height: calc(100dvh - 48px); min-height: 0; flex-direction: column; overflow: hidden; border: var(--glass-border); border-radius: 32px; color: var(--text-primary); background: var(--glass-sheet-material); backdrop-filter: var(--glass-blur-heavy); -webkit-backdrop-filter: var(--glass-blur-heavy); box-shadow: var(--glass-highlight-inner), var(--glass-shadow-lg); }
.dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 24px 24px 16px; flex-shrink: 0; }
.media-meta-row { display: flex; min-width: 0; align-items: center; gap: 14px; flex: 1; }
.dialog-poster { width: 54px; height: 74px; flex-shrink: 0; object-fit: cover; border: 1px solid rgb(255 255 255 / .09); border-radius: 14px; box-shadow: var(--glass-shadow-sm); }
.dialog-meta-info { display: grid; min-width: 0; flex: 1; gap: 7px; }
.dialog-title { overflow: hidden; color: var(--text-primary); font-size: 1.22rem; font-weight: 750; letter-spacing: -.03em; text-overflow: ellipsis; white-space: nowrap; }
.cat-selector-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.category-picker-trigger { display: inline-flex; min-height: 44px; align-items: center; gap: 6px; padding: 0 10px; margin-left: -10px; border: 0; border-radius: 16px; color: var(--text-secondary); background: transparent; font-size: .78rem; }
.category-picker-trigger:hover { background: var(--liquid-accent-subtle); }
.category-picker-trigger svg { width: 15px; height: 15px; transition: transform .2s; }
.category-picker-trigger[aria-expanded='true'] svg { transform: rotate(180deg); }
.cat-pill-group { display: flex; flex-wrap: wrap; gap: 4px; }
.cat-select-pill { min-height: 44px; padding: 0 12px; border: 1px solid transparent; border-radius: 22px; color: var(--text-secondary); background: transparent; font-size: .77rem; white-space: nowrap; }
.cat-select-pill.active { border-color: rgb(255 255 255 / .14); color: var(--liquid-accent); background: var(--surface-elevated); box-shadow: var(--glass-shadow-sm); font-weight: 700; }
.dialog-top-actions { flex-shrink: 0; }
.btn-close-dialog { display: grid; width: 44px; height: 44px; place-items: center; border: var(--glass-border); border-radius: 50%; color: var(--text-secondary); background: var(--glass-lens); box-shadow: var(--glass-highlight-inner), var(--glass-shadow-sm); }
.btn-close-dialog svg { width: 20px; height: 20px; }
.result-search { display: flex; align-items: center; gap: 6px; margin: 0 24px; min-height: 52px; padding: 3px 4px 3px 15px; border: 1px solid rgb(255 255 255 / .09); border-radius: 12px; background: var(--glass-bg); flex-shrink: 0; }
.result-search-icon { width: 19px; height: 19px; color: var(--text-tertiary); flex-shrink: 0; }
.result-search input { width: 100%; min-width: 0; flex: 1; min-height: 44px; padding: 6px; border: 0; color: var(--text-primary); background: transparent; font-size: 16px; outline: none; }
.result-search:focus-within { box-shadow: 0 0 0 3px var(--liquid-accent-subtle); }
.result-search input::-webkit-search-cancel-button { -webkit-appearance: none; }
.clear-search-button { display: grid; width: 44px; height: 44px; place-items: center; flex-shrink: 0; border: 0; border-radius: 50%; color: var(--text-tertiary); background: transparent; }
.clear-search-button svg { width: 17px; height: 17px; }
.submit-search-button { min-height: 44px; padding: 0 19px; border: 0; border-radius: 9px; flex-shrink: 0; color: var(--accent-ink); background: var(--liquid-accent); font-size: .84rem; font-weight: 650; }
.result-summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; flex-shrink: 0; padding: 16px 26px 3px; color: var(--text-tertiary); font-size: .75rem; }
.result-summary strong { color: var(--text-primary); font-size: .92rem; }
.result-filters { display: flex; align-items: center; gap: 6px; padding: 6px 24px 12px; overflow-x: auto; flex-shrink: 0; }
.result-filters > svg { width: 18px; height: 18px; margin-right: 4px; color: var(--text-tertiary); flex-shrink: 0; }
.filter-chip { min-height: 44px; padding: 0 17px; border: 1px solid transparent; border-radius: 22px; color: var(--text-secondary); background: transparent; font-size: .8rem; flex-shrink: 0; }
.filter-chip.active { color: var(--liquid-accent); border-color: rgb(255 255 255 / .14); background: var(--surface-elevated); box-shadow: var(--glass-shadow-sm); font-weight: 650; }
.dialog-body { min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 0 24px 24px; }
.resource-rows { display: grid; gap: 0; }
.liquid-resource-row { display: flex; align-items: center; gap: 20px; padding: 20px 0; border-bottom: 1px solid rgb(255 255 255 / .08); background: transparent; }
.row-left { min-width: 0; flex: 1; }
.row-info { min-width: 0; }
.row-title { overflow-wrap: anywhere; color: var(--text-primary); font-size: .94rem; font-weight: 650; line-height: 1.5; }
.recommended-badge { display: inline-flex; align-items: center; gap: 3px; margin-right: 6px; padding: 2px 6px; border-radius: 6px; color: var(--liquid-accent); background: var(--liquid-accent-subtle); font-size: .66rem; vertical-align: 1px; }
.recommended-badge svg { width: 12px; height: 12px; }
.row-tags { display: flex; flex-wrap: wrap; gap: 5px 9px; margin-top: 8px; color: var(--text-tertiary); font-size: .73rem; overflow-wrap: anywhere; }
.tag-badge { padding: 1px 6px; border: 1px solid rgb(85 113 158 / .14); border-radius: 5px; color: var(--text-secondary); font-size: .67rem; }
.row-right { display: flex; flex-shrink: 0; }
.btn-action { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border: 0; border-radius: 10px; color: var(--text-primary); background: var(--glass-bg-active); font-size: .81rem; font-weight: 600; }
.btn-action:hover:not(:disabled) { background: var(--glass-bg-hover); }
.resource-save-error { margin-top: 12px; }
.empty-notice { padding: 40px 16px; color: var(--text-secondary); text-align: center; font-size: .9rem; }
.empty-notice > span { display: block; }
.retry-search-button, .load-more-button { display: inline-flex; min-height: 46px; align-items: center; justify-content: center; gap: 7px; margin-top: 16px; padding: 0 18px; border: var(--glass-border); border-radius: 24px; color: var(--liquid-accent); background: var(--surface-elevated); font-size: .84rem; }
.retry-search-button svg { width: 17px; height: 17px; }
.load-more-button { width: 100%; margin-top: 0; }
.loading-bar { display: flex; align-items: center; gap: 10px; padding: 24px 0; color: var(--text-secondary); font-size: .88rem; }
.mini-spinner { width: 18px; height: 18px; flex-shrink: 0; border: 2px solid var(--surface-3); border-top-color: var(--liquid-accent); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .liquid-dialog-backdrop { align-items: flex-end; padding: calc(var(--safe-area-top) + 10px) 0 0; }
  .liquid-dialog { width: 100%; height: calc(100dvh - var(--safe-area-top) - 10px); max-height: 100%; border-radius: 30px 30px 0 0; }
  .dialog-header { position: relative; padding: 23px 20px 12px; }
  .media-meta-row { align-items: flex-start; gap: 11px; }
  .dialog-poster { width: 32px; height: 44px; }
  .dialog-title { max-width: calc(100% - 40px); font-size: 1.08rem; line-height: 1.8; }
  .dialog-meta-info { gap: 9px; }
  .dialog-top-actions { position: absolute; top: 17px; right: 15px; }
  .cat-selector-row { display: block; }
  .cat-pill-group { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-left: -43px; }
  .cat-select-pill { padding: 0 5px; }
  .result-search { margin: 0 16px; }
  .result-summary { padding: 14px 20px 2px; }
  .result-filters { padding: 4px 16px 10px; gap: 2px; }
  .filter-chip { padding: 0 15px; }
  .dialog-body { padding: 0 16px calc(20px + var(--safe-area-bottom)); }
  .liquid-resource-row { align-items: stretch; flex-direction: column; gap: 14px; padding: 20px 4px; border-radius: 0; background: transparent; }
  .row-right, .btn-action { width: 100%; }
  .row-title { font-size: .91rem; }
}
@media (max-height: 500px) and (orientation: landscape) {
  .liquid-dialog { max-height: calc(100dvh - 20px); }
  .dialog-header { padding-top: 10px; padding-bottom: 5px; }
  .dialog-poster { display: none; }
  .dialog-meta-info { display: flex; align-items: center; gap: 20px; }
  .result-summary { padding-top: 4px; }
  .result-filters { padding-bottom: 4px; }
}
</style>
