<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronDown, LoaderCircle, RefreshCw, Search, SlidersHorizontal, X } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import QuarkResourceDetails from './QuarkResourceDetails.vue';
import type { MediaItem, CategoryType } from '../../types/media';
import type { ResourceItem } from '../../types/search';
import { rankResourceCandidates, resourceEpisode } from '../../services/resourceMatching';
import { resourceHeading } from '../../services/resourceTitles';
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
  searchNotice?: string;
  searchPending?: boolean;
  searchKeyword?: string;
  isSaving?: boolean;
  savingResourceId?: string;
  saveError?: LibrarySaveFeedback | null;
  failedResourceId?: string;
  automaticStatus?: string;
  playAfterSave?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-auth-settings'): void;
  (e: 'cancel-automatic'): void;
  (e: 'transfer', res: ResourceItem): void;
  (e: 'retry-search'): void;
  (e: 'search', keyword: string, category: CategoryType): void;
  (e: 'save-to-cards', media: MediaItem, targetCategory: CategoryType, bestRes?: ResourceItem, selectedFids?: string[]): void;
}>();

const detailResource = ref<ResourceItem | null>(null);
const detailsRef = ref<InstanceType<typeof QuarkResourceDetails> | null>(null);
const targetCategory = ref<CategoryType>('tv');
const categoryExpanded = ref(false);
const categories: Array<{ value: CategoryType; label: string }> = [
  { value: 'tv', label: '电视剧' }, { value: 'movie', label: '电影' },
  { value: 'variety', label: '综艺' }, { value: 'anime', label: '动漫' }
];
const targetCategoryName = computed(() => categories.find(category => category.value === targetCategory.value)?.label || '电视剧');
const replacingSource = computed(() => Boolean(props.media?.quarkFid));
type ResultFilter = 'all' | 'episodes' | '4k' | 'complete';
const resultFilter = ref<ResultFilter>('all');
const searchQuery = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const resultsBody = ref<HTMLElement | null>(null);
const searchBusy = computed(() => Boolean(props.isAnalyzing || props.searchPending));
const searchingCurrentQuery = computed(() => searchBusy.value
  && searchQuery.value.trim() === (props.searchKeyword || props.media?.title || '').trim());
const visibleCount = ref(20);
const batchSize = 20;

const filterOptions: Array<{ value: ResultFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'episodes', label: '更新集数' },
  { value: '4k', label: '4K' },
  { value: 'complete', label: '完整' }
];

const cleanTitle = resourceHeading;
const matchedResources = computed(() => rankResourceCandidates(
  props.quarkResources.filter(resource => /^https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+(?:[/?#]|$)/i.test(resource.url)),
  props.searchKeyword || props.media?.title || '', targetCategory.value
));
const rankedQuarkResources = computed(() => matchedResources.value.filter(item => !item.match.conflict).map(item => item.resource));
const filteredResources = computed(() => {
  const resources = rankedQuarkResources.value.filter(resource => {
    const title = cleanTitle(resource.title);
    if (resultFilter.value === '4k') return resource.is4k || /4k/i.test(title);
    if (resultFilter.value === 'complete') return /全集|完结|全\s*\d+\s*集/i.test(title);
    return true;
  });
  if (resultFilter.value !== 'episodes') return resources;
  return [...resources].sort((left, right) => resourceEpisode(right.title) - resourceEpisode(left.title));
});
const visibleResources = computed(() => filteredResources.value.slice(0, visibleCount.value));
const hasMoreResources = computed(() => visibleResources.value.length < filteredResources.value.length);

watch([() => props.media?.id, () => props.currentCategory], () => {
  targetCategory.value = props.media?.category || props.currentCategory;
  categoryExpanded.value = false;
}, { immediate: true });

watch([() => props.isOpen, () => props.searchKeyword], ([isOpen, keyword]) => {
  if (isOpen) searchQuery.value = keyword || props.media?.title || '';
}, { immediate: true });

watch([() => props.isOpen, () => props.media?.id, () => props.searchKeyword], () => { detailResource.value = null; });

watch([() => props.searchKeyword, targetCategory], () => {
  resultFilter.value = 'all';
  if (resultsBody.value) resultsBody.value.scrollTop = 0;
});

watch([() => props.isOpen, () => props.media?.id, () => props.searchKeyword, resultFilter], () => {
  visibleCount.value = batchSize;
});

const loadMore = () => {
  if (props.isSaving) return;
  visibleCount.value = Math.min(filteredResources.value.length, visibleCount.value + batchSize);
};

const submitSearch = () => {
  const keyword = searchQuery.value.trim();
  if (!keyword || props.isSaving || searchingCurrentQuery.value) return;
  searchInput.value?.blur();
  emit('search', keyword, targetCategory.value);
};

const handleBodyScroll = (event: Event) => {
  const target = event.currentTarget as HTMLElement;
  if (hasMoreResources.value && target.scrollTop + target.clientHeight >= target.scrollHeight - 180) loadMore();
};

const requestClose = () => {
  if (!props.isSaving) emit('close');
};
const dismissLayer = () => {
  if (props.isSaving) return false;
  if (detailsRef.value?.dismissFolder()) return true;
  if (detailResource.value) { detailResource.value = null; return true; }
  if (categoryExpanded.value) { categoryExpanded.value = false; return true; }
  return false;
};
defineExpose({ dismissLayer });
const requestBack = () => { if (!props.isSaving && !dismissLayer()) emit('close'); };
const saveDetails = (selectedFids?: string[]) => {
  if (props.media && detailResource.value) emit('save-to-cards', props.media, targetCategory.value, detailResource.value, selectedFids);
};
const dialogRef = ref<HTMLElement | null>(null);
useDialog(dialogRef, () => props.isOpen, requestBack);
</script>

<template>
  <div
    class="liquid-dialog-backdrop"
    ref="dialogRef"
    :class="{ active: isOpen }"
    role="dialog"
    aria-modal="true"
    aria-labelledby="resource-dialog-title"
    @keydown.esc.stop="requestBack"
    @click.self="requestClose"
  >
    <div class="liquid-dialog glass-rim" v-if="media" :aria-busy="isSaving || searchBusy">
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

      <form v-if="!detailResource" class="result-search cinema-search-field" role="search" @submit.prevent="submitSearch">
        <Search class="result-search-icon" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="searchQuery"
          type="search"
          inputmode="search"
          enterkeyhint="search"
          autocomplete="off"
          aria-label="重新输入片名搜索资源"
          placeholder="修改片名重新搜索"
          :disabled="isSaving"
          @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.preventDefault()"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="clear-search-button"
          aria-label="清空搜索内容"
          :disabled="isSaving"
          @click="searchQuery = ''"
        >
          <X aria-hidden="true" />
        </button>
        <button
          type="submit"
          class="submit-search-button"
          :disabled="searchingCurrentQuery || isSaving || !searchQuery.trim()"
        >
          <LoaderCircle v-if="searchingCurrentQuery" class="search-spinner" aria-hidden="true" />
          {{ searchingCurrentQuery ? '搜索中…' : '搜索' }}
        </button>
      </form>

      <div v-if="!detailResource && searchBusy" class="search-status" role="status" aria-live="polite">
        <LoaderCircle class="search-spinner" aria-hidden="true" />
        <div><strong>{{ automaticStatus || `正在搜索《${searchKeyword || media.title}》` }}</strong><p>{{ automaticStatus ? '正在核对资源，请稍候。' : '搜索请求进行中，请稍候。' }}</p></div>
      </div>
      <div v-if="!detailResource && !searchBusy && !searchError && rankedQuarkResources.length" class="result-summary" aria-live="polite">
        <span>找到</span>
        <strong>{{ rankedQuarkResources.length }}</strong>
        <span>条搜索结果</span>
      </div>
      <p v-if="!detailResource && !searchBusy && searchNotice" class="result-summary" role="status">{{ searchNotice }}</p>

      <div v-if="!detailResource && !searchBusy && !searchError && rankedQuarkResources.length" class="result-filters" role="radiogroup" aria-label="资源筛选">
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
      <div ref="resultsBody" class="dialog-body" :class="{ 'showing-details': detailResource }" :aria-busy="searchBusy" @scroll.passive="handleBodyScroll">
        <QuarkResourceDetails v-if="detailResource" ref="detailsRef"
          :resource="detailResource" :is-saving="isSaving" :replacing-source="replacingSource"
          :save-error="failedResourceId === detailResource.id ? saveError : null" :play-after-save="playAfterSave"
          @back="detailResource = null" @open-auth-settings="emit('open-auth-settings')"
          @save="saveDetails"
        />
        <template v-else-if="searchBusy">
          <div class="resource-loading">
          <div class="resource-placeholders" aria-hidden="true">
          <SkeletonCard v-for="i in 3" :key="i" />
          </div>
          <div v-if="automaticStatus" class="resource-loading-actions">
            <button type="button" class="cinema-button secondary" :disabled="isSaving" @click="emit('cancel-automatic')">自己选择片源</button>
          </div>
          </div>
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
                <button type="button" class="btn-action btn-details" :disabled="isSaving" @click="detailResource = res">查看资源</button>
                <button
                  class="btn-action btn-transfer"
                  :class="{ 'is-saving': isSaving && savingResourceId === res.id }"
                  :disabled="isSaving"
                  @click="emit('save-to-cards', media, targetCategory, res)"
                >
                  {{ isSaving && savingResourceId === res.id ? (replacingSource ? '正在替换…' : '正在添加…') : failedResourceId === res.id && saveError ? '重试' : replacingSource ? (playAfterSave ? '替换并播放' : '全部替换') : playAfterSave ? '添加并播放' : '添加到片库' }}
                </button>
              </div>
            </div>

            <button v-if="hasMoreResources" type="button" class="load-more-button" :disabled="isSaving" @click="loadMore">
              加载更多 · 还有 {{ filteredResources.length - visibleResources.length }} 条
            </button>
          </div>

          <div v-else class="empty-notice" :role="searchError ? 'alert' : 'status'">
            <span>{{ searchError || (resultFilter === 'all' ? `未找到《${searchKeyword || media.title}》的相关资源。` : '当前筛选没有结果。') }}</span>
            <button v-if="searchError" type="button" class="retry-search-button" :disabled="isSaving" @click="emit('retry-search')">
              <RefreshCw aria-hidden="true" />
              重新搜索
            </button>
            <button v-else-if="resultFilter !== 'all'" type="button" class="retry-search-button" @click="resultFilter = 'all'">查看全部结果</button>
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
.dialog-poster { width: 54px; height: 74px; flex-shrink: 0; object-fit: cover; border: 1px solid var(--divider); border-radius: 14px; box-shadow: var(--glass-shadow-sm); }
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
.result-search { display: flex; align-items: center; gap: 8px; margin: 0 24px; min-height: 56px; padding: 6px; border: 1px solid var(--divider); border-radius: var(--cinema-radius-card); background: var(--surface-1); flex-shrink: 0; }
.result-search-icon { width: 19px; height: 19px; color: var(--text-tertiary); flex-shrink: 0; }
.result-search input { width: 100%; min-width: 0; flex: 1; min-height: 44px; padding: 6px; border: 0; color: var(--text-primary); background: transparent; font-size: 16px; outline: none; }
.result-search input::-webkit-search-cancel-button { -webkit-appearance: none; }
.clear-search-button { display: grid; width: 44px; height: 44px; place-items: center; flex-shrink: 0; border: 0; border-radius: 50%; color: var(--text-tertiary); background: transparent; }
.clear-search-button svg { width: 17px; height: 17px; }
.submit-search-button { min-height: 44px; padding: 0 19px; border: 0; border-radius: var(--cinema-radius-control); flex-shrink: 0; color: var(--accent-ink); background: var(--liquid-accent); font-size: .84rem; font-weight: 650; }
.result-summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; flex-shrink: 0; padding: 16px 26px 3px; color: var(--text-tertiary); font-size: .75rem; }
.search-status { display: flex; align-items: center; gap: 12px; margin: 16px 24px; padding: 16px; flex-shrink: 0; border-radius: var(--cinema-radius-card); background: var(--surface-1); color: var(--text-primary); }
.search-status strong { display: block; font-size: 14px; }
.search-status p { margin-top: 4px; font-size: 12px; color: var(--text-secondary); }
.search-spinner { width: 20px; height: 20px; flex-shrink: 0; animation: spin .9s linear infinite; }
.submit-search-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.submit-search-button .search-spinner { width: 16px; height: 16px; }
.result-summary strong { color: var(--text-primary); font-size: .92rem; }
.result-filters { display: flex; align-items: center; gap: 6px; padding: 6px 24px 12px; overflow-x: auto; flex-shrink: 0; }
.result-filters > svg { width: 18px; height: 18px; margin-right: 4px; color: var(--text-tertiary); flex-shrink: 0; }
.filter-chip { min-height: 44px; padding: 0 17px; border: 1px solid transparent; border-radius: 22px; color: var(--text-secondary); background: transparent; font-size: .8rem; flex-shrink: 0; }
.filter-chip.active { color: var(--liquid-accent); border-color: rgb(255 255 255 / .14); background: var(--surface-elevated); box-shadow: var(--glass-shadow-sm); font-weight: 650; }
.dialog-body { min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 0 24px 24px; }
.dialog-body.showing-details { display: flex; overflow: hidden; }
.resource-rows { display: grid; gap: 16px; }
.liquid-resource-row { display: flex; align-items: center; gap: 20px; padding: 24px; border: 1px solid var(--divider); background: var(--surface-1); }
.row-left { min-width: 0; flex: 1; }
.row-info { min-width: 0; }
.row-title { overflow-wrap: anywhere; color: var(--text-primary); font-size: .94rem; font-weight: 650; line-height: 1.5; }
.row-tags { display: flex; flex-wrap: wrap; gap: 5px 9px; margin-top: 8px; color: var(--text-tertiary); font-size: .73rem; overflow-wrap: anywhere; }
.tag-badge { padding: 1px 6px; border: 1px solid rgb(85 113 158 / .14); border-radius: 5px; color: var(--text-secondary); font-size: .67rem; }
.row-right { display: flex; gap: 8px; flex-shrink: 0; }
.btn-action { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border: 0; border-radius: 10px; color: var(--text-primary); background: var(--glass-bg-active); font-size: .81rem; font-weight: 600; }
.btn-details { color: var(--liquid-accent); background: transparent; border: 1px solid var(--liquid-accent-subtle); }
.btn-action:hover:not(:disabled) { background: var(--glass-bg-hover); }
.resource-save-error { margin-top: 12px; }
.empty-notice { padding: 40px 16px; color: var(--text-secondary); text-align: center; font-size: .9rem; }
.empty-notice > span { display: block; }
.retry-search-button, .load-more-button { display: inline-flex; min-height: 46px; align-items: center; justify-content: center; gap: 7px; margin-top: 16px; padding: 0 18px; border: var(--glass-border); border-radius: 24px; color: var(--liquid-accent); background: var(--surface-elevated); font-size: .84rem; }
.retry-search-button svg { width: 17px; height: 17px; }
.load-more-button { width: 100%; margin-top: 0; }
.loading-bar { display: flex; align-items: center; gap: 10px; padding: 24px 0; color: var(--text-secondary); font-size: .88rem; }
.resource-loading { display: grid; gap: 24px; padding: 24px 0 4px; }
.resource-loading .loading-bar { padding: 0; }
.resource-placeholders { display: grid; gap: 12px; }
.resource-placeholders :deep(.skeleton-resource-card) { margin: 0; border-radius: var(--cinema-radius-card); }
.resource-loading-actions { display: flex; flex-wrap: wrap; gap: 12px; }
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
  .cat-selector-row { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; }
  .cat-pill-group { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; width: 100%; margin-left: 0; margin-top: 4px; }
  .cat-select-pill { min-height: 38px; padding: 0 6px; font-size: .78rem; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background: var(--surface-1); }
  .result-search { margin: 0 16px; }
  .result-summary { padding: 14px 20px 2px; }
  .result-filters { padding: 4px 16px 10px; gap: 2px; }
  .filter-chip { padding: 0 15px; }
  .dialog-body { padding: 0 16px calc(20px + var(--safe-area-bottom)); }
  .liquid-resource-row { align-items: stretch; flex-direction: column; gap: 14px; padding: 20px 4px; border-radius: 0; background: transparent; }
  .row-right { width: 100%; }
  .row-right .btn-action { flex: 1; padding: 0 10px; }
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

.liquid-dialog-backdrop { padding: 0; background: var(--liquid-canvas) !important; }
.liquid-dialog { width: 100%; height: var(--app-viewport-height); max-height: none; border: 0; border-radius: 0; background: var(--liquid-canvas); box-shadow: none; }
.liquid-dialog.glass-rim::after { display: none; }
.dialog-header { padding-top: calc(18px + var(--safe-area-top)); }
.dialog-poster { border-radius: 12px; }
.btn-transfer { border-radius: var(--cinema-radius-control); color: var(--accent-ink); background: var(--liquid-accent); }
.liquid-resource-row { border-radius: var(--cinema-radius-card); box-shadow: none; }
@media (min-width: 900px) {
  .dialog-header, .result-summary, .result-filters, .dialog-body { width: 100%; }
}
@media (min-width: 1024px) {
  .liquid-dialog-backdrop { padding: 32px; background: rgb(0 0 0 / .65) !important; }
  .liquid-dialog { width: min(1100px, 100%); height: auto; min-height: min(460px, calc(100dvh - 64px)); max-height: min(860px, calc(100dvh - 64px)); border: 1px solid var(--divider); border-radius: var(--cinema-radius-hero); }
  .dialog-header { padding: 28px 32px 20px; }
  .result-search { margin-inline: 32px; }
  .result-search-icon { margin-left: 10px; }
  .result-summary, .result-filters, .dialog-body { padding-left: 32px; padding-right: 32px; }
  .dialog-body { padding-bottom: 32px; }
}
@media (max-width: 640px) { .liquid-dialog { width: 100%; height: var(--app-viewport-height); max-height: none; border-radius: 0; } .dialog-header { padding-top: calc(var(--mobile-header-top-space, 18px) + var(--safe-area-top)); } }
@media (max-width: 767px) {
  .search-status { margin-left: var(--page-left); margin-right: var(--page-right); }
  .dialog-header, .result-filters, .dialog-body { padding-left: var(--page-left); padding-right: var(--page-right); }
  .dialog-top-actions { right: var(--page-right); }
  .result-summary { padding-left: var(--page-left); padding-right: var(--page-right); }
  .result-search { margin-left: var(--page-left); margin-right: var(--page-right); }
  .result-search-icon { margin-left: 6px; }
  .liquid-resource-row { padding: 20px; background: var(--surface-1); }
}

</style>
