<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, ChevronDown, Library, LoaderCircle, Play, RefreshCw, Search, SlidersHorizontal, X } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import QuarkResourceDetails from './QuarkResourceDetails.vue';
import type { MediaItem, CategoryType } from '../../types/media';
import type { OfficialWorkProgress, ResourceItem, SearchCategory } from '../../types/search';
import { rankResourceCandidates, resourceEpisode } from '../../services/resourceMatching';
import { resourceHeading } from '../../services/resourceTitles';
import { searchIntent } from '../../services/searchIntent';
import SkeletonCard from '../common/SkeletonCard.vue';
import type { LibrarySaveFeedback } from '../../services/libraryFeedback';
import { archiveBytes, type ArchiveBatchJob, type ArchiveBatchPreview } from '../../services/archiveImport';
import { episodeRangeLabel } from '../../services/resourceCompleteness';
import { useDialog } from '../../composables/useDialog';
import { sourceColor, type SourceColor } from '../../../server/sourceColor.js';

const props = defineProps<{
  isOpen: boolean;
  inline?: boolean;
  savedPlayLabel?: string;
  isAnalyzing: boolean;
  media: MediaItem | null;
  currentCategory: CategoryType;
  quarkResources: ResourceItem[];
  searchError?: string;
  searchNotice?: string;
  searchPending?: boolean;
  searchKeyword?: string;
  searchCategory?: SearchCategory;
  isSaving?: boolean;
  savingResourceId?: string;
  savingMessage?: string;
  saveError?: LibrarySaveFeedback | null;
  failedResourceId?: string;
  automaticStatus?: string;
  playAfterSave?: boolean;
  searchPhase?: 'searching' | 'verifying' | 'done';
  verificationProgress?: string;
  searchNeedsAuth?: boolean;
  savedMedia?: MediaItem | null;
  savedSummary?: string;
  savedBatch?: ArchiveBatchJob;
  resumingBatch?: boolean;
  batchResumeError?: string;
  batchPreview?: { resourceId: string; plan: ArchiveBatchPreview } | null;
  officialProgress?: OfficialWorkProgress;
  officialCheckedAt?: string;
  officialNotice?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-auth-settings'): void;
  (e: 'cancel-automatic'): void;
  (e: 'transfer', res: ResourceItem): void;
  (e: 'retry-search'): void;
  (e: 'search', keyword: string, category: SearchCategory): void;
  (e: 'play-saved'): void;
  (e: 'view-library'): void;
  (e: 'stop-batch', id: string): void;
  (e: 'resume-batch', id: string): void;
  (e: 'save-to-cards', media: MediaItem, targetCategory: CategoryType, bestRes?: ResourceItem, selectedFids?: string[]): void;
}>();

const detailResource = ref<ResourceItem | null>(null);
const detailsRef = ref<InstanceType<typeof QuarkResourceDetails> | null>(null);
const targetCategory = ref<SearchCategory>('all');
const categoryExpanded = ref(false);
const categories: Array<{ value: SearchCategory; label: string }> = [
  { value: 'all', label: '全部类型' },
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
const canResumeBatch = computed(() => props.savedBatch?.status === 'paused' || props.savedBatch?.status === 'failed');
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
const colorLabels: Record<SourceColor, string> = {
  sdr: 'SDR 标注', hdr: 'HDR 标注', 'dolby-vision': '杜比视界标注', unknown: '色彩待核验'
};
const targetTitle = computed(() => searchIntent(props.searchKeyword || props.media?.title || '').title);
const soleResult = computed(() => rankedQuarkResources.value.length === 1);
const officialAvailability = computed(() => {
  const latest = props.officialProgress?.latestEpisode;
  if (!latest || searchBusy.value) return '';
  if (props.searchError) return '片源查询未完成，暂时无法确认最新一集是否可用。';
  const found = props.quarkResources.some(resource => resource.verification?.requiredEpisodes.includes(latest));
  if (!found && props.quarkResources.some(resource=>resource.archivePreparation?.episode===latest)) return '已找到第 ' + latest + ' 集资源，保存时会确认是否可播放。';
  return found ? `本次已找到官方最新第 ${latest} 集。` : `本次暂未找到官方最新第 ${latest} 集。`;
});
const saveCategory = (resource: ResourceItem): CategoryType => targetCategory.value === 'all' ? resource.category || props.media?.category || props.currentCategory : targetCategory.value;
const matchedResources = computed(() => rankResourceCandidates(
  props.quarkResources.filter(resource => /^https:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+(?:[/?#]|$)/i.test(resource.url)),
  targetTitle.value, targetCategory.value === 'all' ? undefined : targetCategory.value
));
const rankedQuarkResources = computed(() => matchedResources.value.filter(item => !item.match.conflict).map(item => item.resource));
const filteredResources = computed(() => {
  const resources = rankedQuarkResources.value.filter(resource => {
    const title = cleanTitle(resource.title);
    if (resultFilter.value === '4k') return resource.is4k || /4k/i.test(title);
    if (resultFilter.value === 'complete') return resource.verification?.complete === true;
    return true;
  });
  if (resultFilter.value !== 'episodes') return resources;
  return [...resources].sort((left, right) => (right.verification?.latestEpisode ?? right.latestEpisode ?? resourceEpisode(right.title)) - (left.verification?.latestEpisode ?? left.latestEpisode ?? resourceEpisode(left.title)));
});
const visibleResources = computed(() => filteredResources.value.slice(0, visibleCount.value));
const hasMoreResources = computed(() => visibleResources.value.length < filteredResources.value.length);
const usesArchiveAction = (resource: ResourceItem) => Boolean(resource.archivePreparation
  && (!resource.verification || (resource.archivePreparation.batchEligible && resource.verification.complete === false)));
const resourceAction = (resource: ResourceItem) => {
  if (props.isSaving && props.savingResourceId === resource.id) return resource.batchEligible || usesArchiveAction(resource)
    ? props.savingMessage || '正在核对…' : '正在保存到片库…';
  if (props.failedResourceId === resource.id && props.saveError) return props.saveError.needsSearch ? '重新搜索' : '重新核对';
  if (resource.batchEligible) {
    const preview = props.batchPreview?.resourceId === resource.id ? props.batchPreview.plan : null;
    return preview?.canStart ? '开始补齐' : preview ? '重新检查' : replacingSource.value && props.officialProgress ? '检查缺集' : '检查可存集数';
  }
  if (resource.archivePreparation && usesArchiveAction(resource)) {
    return `保存第 ${resource.archivePreparation.episode} 集`;
  }
  return replacingSource.value ? '保存并替换片源' : '保存到片库';
};

watch([() => props.media?.id, () => props.currentCategory, () => props.searchCategory], () => {
  targetCategory.value = props.searchCategory || props.media?.category || props.currentCategory;
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
const selectCategory = (category: SearchCategory) => {
  if (props.isSaving) return;
  categoryExpanded.value = false;
  if (category === targetCategory.value) return;
  targetCategory.value = category;
  emit('search', searchQuery.value.trim() || props.searchKeyword || props.media?.title || '', category);
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
  if (props.media && detailResource.value) emit('save-to-cards', props.media, saveCategory(detailResource.value), detailResource.value, selectedFids);
};
const dialogRef = ref<HTMLElement | null>(null);
useDialog(dialogRef, () => props.isOpen && !props.inline, requestBack);
</script>

<template>
  <div
    :class="inline ? 'find-results' : 'liquid-dialog-backdrop active'"
    ref="dialogRef"
    :role="inline ? 'region' : 'dialog'"
    :aria-modal="inline ? undefined : true"
    :aria-label="inline ? '查找结果' : undefined"
    :aria-labelledby="inline ? undefined : 'resource-dialog-title'"
    @keydown.esc.stop="!inline && requestBack()"
    @click.self="!inline && requestClose()"
  >
    <div :class="inline ? 'find-results-content' : 'liquid-dialog glass-rim'" v-if="media" :aria-busy="isSaving || searchBusy">
      <!-- 弹窗顶栏 -->
      <div v-if="!inline" class="dialog-header">
        <div class="media-meta-row">
<MediaPoster :src="media.poster" :alt="media.title" class="dialog-poster" />
          <div class="dialog-meta-info">
            <div class="meta-title-line">
              <h3 id="resource-dialog-title" class="dialog-title" :title="media.title">{{ media.title }}</h3>
            </div>

            <!-- 默认沿用当前分类，需要时再展开修改。 -->
            <div v-if="!savedMedia" class="cat-selector-row">
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
                  @click="selectCategory(category.value)"
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

      <form v-if="!inline && !detailResource && !savedMedia" class="result-search cinema-search-field" role="search" @submit.prevent="submitSearch">
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
          {{ searchingCurrentQuery ? searchPhase === 'verifying' ? '核对中…' : '搜索中…' : '搜索' }}
        </button>
      </form>

      <section v-if="!detailResource && !savedMedia && officialProgress && !searchBusy && !['movie', 'variety'].includes(searchCategory || '')" class="official-progress" aria-label="官方更新进度" aria-live="polite">
        <template v-if="officialProgress">
          <div class="official-progress-top"><strong>{{ officialProgress.completed ? `官方已完结 · 全 ${officialProgress.latestEpisode} 集` : `官方更新至第 ${officialProgress.latestEpisode} 集` }}</strong><a :href="officialProgress.sourceUrl" target="_blank" rel="noopener noreferrer">{{ officialProgress.platform }}</a></div>
          <p v-if="officialAvailability && !batchPreview" class="official-availability">{{ officialAvailability }}</p>
        </template>
      </section>

      <div v-if="!detailResource && searchBusy && !savedMedia" class="search-status" role="status" aria-live="polite">
        <LoaderCircle class="search-spinner" aria-hidden="true" />
        <strong>{{ searchPhase === 'verifying' ? verificationProgress || '正在检查剧集…' : automaticStatus || `正在搜索《${searchKeyword || media.title}》` }}</strong>
      </div>
      <div v-if="!detailResource && !savedMedia && !searchBusy && !searchError && rankedQuarkResources.length > 1" class="result-summary" aria-live="polite">
        <span>找到</span>
        <strong>{{ rankedQuarkResources.length }}</strong>
        <span>个结果</span>
      </div>
      <p v-if="!detailResource && !savedMedia && !searchBusy && searchNotice && rankedQuarkResources.length" class="result-summary" role="status">{{ searchNotice }}</p>

      <div v-if="!detailResource && !savedMedia && !searchBusy && !searchError && rankedQuarkResources.length > 1" class="result-filters" role="radiogroup" aria-label="资源筛选">
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
        <section v-if="savedMedia" class="save-receipt" role="status" :aria-label="savedBatch ? '补集任务' : '保存成功'">
          <span class="receipt-icon"><LoaderCircle v-if="savedBatch?.status === 'running'" class="search-spinner" aria-hidden="true" /><X v-else-if="savedBatch && savedBatch.status !== 'success'" aria-hidden="true" /><Check v-else aria-hidden="true" /></span>
          <h2>{{ savedBatch ? savedBatch.status === 'running' ? '正在补集' : savedBatch.status === 'success' ? '已补齐片库' : '补集已暂停' : batchPreview ? '剧集已齐' : '已保存到片库' }}</h2><strong>{{ savedMedia.title }}</strong><p>{{ savedSummary }}</p>
          <p v-if="savedBatch">已完成 {{ savedBatch.completedEpisodes.length }} / {{ savedBatch.total }} 集<span v-if="savedBatch.currentEpisode"> · 当前第 {{ savedBatch.currentEpisode }} 集</span></p>
          <p v-if="canResumeBatch && batchResumeError" class="receipt-error" role="alert">{{ batchResumeError }}</p>
          <div class="receipt-actions" :class="{ 'resume-actions': canResumeBatch }">
            <button v-if="savedBatch && canResumeBatch" type="button" class="btn-action btn-transfer" :disabled="resumingBatch" @click="emit('resume-batch', savedBatch.id)">
              <LoaderCircle v-if="resumingBatch" class="search-spinner" aria-hidden="true" />
              <RefreshCw v-else aria-hidden="true" />
              {{ resumingBatch ? '正在核对…' : '继续补齐' }}
            </button>
            <button v-if="savedMedia.quarkFid" type="button" class="btn-action" :class="canResumeBatch ? 'btn-details' : 'btn-transfer'" @click="emit('play-saved')"><Play aria-hidden="true" /> {{ savedPlayLabel || '立即播放' }}</button>
            <button type="button" class="btn-action btn-details" @click="emit('view-library')"><Library aria-hidden="true" />查看片库</button>
            <button v-if="savedBatch?.status === 'running'" type="button" class="btn-action btn-details" @click="emit('stop-batch', savedBatch.id)">停止补集</button>
          </div>
        </section>
        <QuarkResourceDetails v-else-if="detailResource" ref="detailsRef"
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
          <div v-if="visibleResources.length > 0" class="resource-rows" :class="{ 'verified-single': soleResult }">
            <div v-if="soleResult && visibleResources[0]?.verification" class="ready-heading" role="status"><Check aria-hidden="true" /><div><strong>{{ visibleResources[0].batchEligible ? '已找到剧集资源' : '已找到，可以保存到片库' }}</strong><p>{{ visibleResources[0].batchEligible ? '继续核对官方进度与片库缺集。' : '实际视频已核对，保存后即可从片库播放。' }}</p></div></div>
            <div
              v-for="res in visibleResources"
              :key="res.id"
              class="liquid-resource-row"
            >
              <div class="row-left">
                <div class="row-info">
                  <div class="row-title">
                    {{ res.workTitle || (res.verification ? targetTitle : cleanTitle(res.title)) }}
                  </div>
                  <div v-if="saveError && failedResourceId === res.id" class="inline-feedback resource-save-error" role="alert">
                    <strong>{{ saveError.title }}</strong>
                    <p>{{ saveError.message }}</p>
                    <button v-if="saveError.needsAuth" type="button" @click="emit('open-auth-settings')">前往认证设置</button>
                  </div>
                  <div class="row-tags">
                    <span v-if="res.archivePreparation && usesArchiveAction(res)" class="update-badge">{{ res.archivePreparation.summary || `第 ${res.archivePreparation.episode} 集 · 需解压核对` }}</span>
                    <span v-if="res.verification" class="update-badge">{{ res.verification.summary }}</span>
                    <span v-if="res.category" class="tag-meta">{{ categories.find(category => category.value === res.category)?.label }}</span>
                    <span v-if="res.year" class="tag-meta">{{ res.year }}</span>
                    <span class="tag-badge">{{ res.quality }}</span>
                    <span class="tag-meta">{{ colorLabels[res.colorFormat ?? sourceColor(res.title)] }}</span>
                    <span v-if="res.size" class="tag-meta">{{ res.size }}</span>
                  </div>
                  <details v-if="res.workTitle && res.workTitle !== cleanTitle(res.title)" class="version-details"><summary>版本详情</summary><p>{{ cleanTitle(res.title) }}</p></details>
                  <p v-if="res.archivePreparation && usesArchiveAction(res) && batchPreview?.resourceId !== res.id && failedResourceId !== res.id && !res.batchEligible" class="verification-notice">{{ res.archivePreparation.notice }}</p>
                  <p v-if="res.verification?.notice && !res.batchEligible && failedResourceId !== res.id" class="verification-notice">{{ res.verification.notice }}</p>
                  <div v-if="batchPreview?.resourceId === res.id" class="archive-batch-plan" role="status">
                    <strong v-if="batchPreview.plan.plannedEpisodes.length">{{ batchPreview.plan.canStart ? '计划补齐' : '本次找到' }}{{ episodeRangeLabel(batchPreview.plan.plannedEpisodes) }} · 共 {{ batchPreview.plan.plannedEpisodes.length }} 集</strong>
                    <strong v-else>片库已有 {{ batchPreview.plan.existingEpisodes.length }} 集</strong>
                    <span>{{ batchPreview.plan.officialPlatform || '播出平台' }}已更新至第 {{ batchPreview.plan.officialLatest }} 集。片库已有 {{ batchPreview.plan.existingEpisodes.length }} 集。</span>
                    <span v-if="batchPreview.plan.missingEpisodes.length">暂未找到{{ episodeRangeLabel(batchPreview.plan.missingEpisodes) }}，无法补齐。</span>
                    <span v-if="batchPreview.plan.canStart">建议预留约 {{ archiveBytes(batchPreview.plan.recommendedFreeBytes) }} 网盘空间，当前可用 {{ batchPreview.plan.freeBytes == null ? '未确认' : archiveBytes(batchPreview.plan.freeBytes) }}。</span>
                    <span v-if="batchPreview.plan.canStart && batchPreview.plan.totalArchiveBytes">补齐后可在片库观看，临时文件会进入回收站。</span>
                    <span v-if="batchPreview.plan.reason">{{ batchPreview.plan.reason }}</span>
                  </div>
                </div>
              </div>

              <div class="row-right">
                <button v-if="!res.verification && !res.archivePreparation" type="button" class="btn-action btn-details" :disabled="isSaving" @click="detailResource = res">查看资源</button>
                <button
                  class="btn-action btn-transfer"
                  :class="{ 'is-saving': isSaving && savingResourceId === res.id }"
                  :disabled="isSaving || (!res.verification && !res.archivePreparation)"
                  @click="failedResourceId === res.id && saveError?.needsSearch ? emit('retry-search') : emit('save-to-cards', media, saveCategory(res), res, res.verification?.selectedFids)"
                >
                  <LoaderCircle v-if="isSaving && savingResourceId === res.id" class="search-spinner" aria-hidden="true" />
                  {{ resourceAction(res) }}
                </button>
              </div>
            </div>

            <button v-if="hasMoreResources" type="button" class="load-more-button" :disabled="isSaving" @click="loadMore">
              加载更多 · 还有 {{ filteredResources.length - visibleResources.length }} 条
            </button>
          </div>

          <div v-else class="empty-notice" :role="searchError ? 'alert' : 'status'">
            <span>{{ searchError || (resultFilter === 'all' ? searchNotice || `未找到《${searchKeyword || media.title}》的可用资源。` : '当前筛选没有结果。') }}</span>
            <button v-if="searchNeedsAuth" type="button" class="retry-search-button" @click="emit('open-auth-settings')">前往认证设置</button>
            <button v-if="searchError || resultFilter === 'all'" type="button" class="retry-search-button" :disabled="isSaving" @click="emit('retry-search')">
              <RefreshCw aria-hidden="true" />
              重新搜索
            </button>
            <button v-else type="button" class="retry-search-button" @click="resultFilter = 'all'">查看全部结果</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.find-results { margin: 18px 0; }
.find-results .dialog-body { max-height: none; overflow: visible; padding: 12px 0; }
.find-results .official-progress, .find-results .search-status { margin: 10px 0; }
.version-details { margin-top: 8px; color: var(--text-secondary); font-size: .78rem; }
.version-details summary { width: fit-content; cursor: pointer; padding: 4px 0; }
.version-details p { overflow-wrap: anywhere; }
.liquid-dialog-backdrop { position: fixed; inset: 0; z-index: 1400; display: flex; align-items: center; justify-content: center; padding: 24px; opacity: 0; visibility: hidden; }
.liquid-dialog-backdrop.active { opacity: 1; visibility: visible; }
.liquid-dialog { display: flex; width: min(820px, 100%); max-height: calc(100dvh - 48px); min-height: 0; flex-direction: column; overflow: hidden; border: var(--glass-border); border-radius: 32px; color: var(--text-primary); background: var(--glass-sheet-material); backdrop-filter: var(--glass-blur-heavy); -webkit-backdrop-filter: var(--glass-blur-heavy); box-shadow: var(--glass-highlight-inner), var(--glass-shadow-lg); }
.dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 24px 24px 16px; flex-shrink: 0; }
.media-meta-row { display: flex; min-width: 0; align-items: center; gap: 14px; flex: 1; }
.dialog-poster { width: 54px; height: 74px; flex-shrink: 0; object-fit: cover; border-radius: 12px; }
.dialog-meta-info { display: grid; min-width: 0; flex: 1; gap: 7px; }
.dialog-title { overflow: hidden; color: var(--text-primary); font-size: 1.22rem; font-weight: 750; letter-spacing: -.03em; text-overflow: ellipsis; white-space: nowrap; }
.cat-selector-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.category-picker-trigger { display: inline-flex; min-height: 44px; align-items: center; gap: 6px; padding: 0 10px; margin-left: -10px; border: 0; border-radius: 16px; color: var(--text-secondary); background: transparent; font-size: .78rem; }
.category-picker-trigger:hover { background: var(--liquid-accent-subtle); }
.category-picker-trigger svg { width: 15px; height: 15px; transition: transform .2s; }
.category-picker-trigger[aria-expanded='true'] svg { transform: rotate(180deg); }
.cat-pill-group { display: flex; flex-wrap: wrap; gap: 4px; }
.cat-select-pill { min-height: 44px; padding: 0 12px; border: 0; border-radius: 22px; color: var(--text-secondary); background: transparent; font-size: .77rem; white-space: nowrap; }
.cat-select-pill.active { color: var(--liquid-accent); background: var(--liquid-accent-subtle); font-weight: 700; }
.dialog-top-actions { flex-shrink: 0; }
.btn-close-dialog { display: grid; width: 44px; height: 44px; place-items: center; border: 0; border-radius: 50%; color: var(--text-secondary); background: var(--surface-2); }
.btn-close-dialog svg { width: 20px; height: 20px; }
.result-search { display: flex; align-items: center; gap: 8px; margin: 0 24px; min-height: 56px; padding: 6px; border: 0; border-radius: var(--cinema-radius-control); background: var(--surface-2); flex-shrink: 0; }
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
.official-progress { margin: 16px 24px 0; padding: 14px 16px; border: 0; border-radius: 16px; background: var(--surface-1); flex-shrink: 0; }
.official-progress-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.official-progress strong { font-size: .86rem; }.official-progress a { color: var(--text-secondary); font-size: .75rem; text-decoration: none; }
.official-progress p { color: var(--text-tertiary); font-size: .75rem; line-height: 1.6; }.official-progress-top + p { margin-top: 5px; }
.official-progress .official-availability { margin-top: 6px; color: var(--text-secondary); }
.result-filters { display: flex; align-items: center; gap: 6px; padding: 6px 24px 12px; overflow-x: auto; flex-shrink: 0; }
.result-filters > svg { width: 18px; height: 18px; margin-right: 4px; color: var(--text-tertiary); flex-shrink: 0; }
.filter-chip { min-height: 44px; padding: 0 17px; border: 0; border-radius: 22px; color: var(--text-secondary); background: transparent; font-size: .8rem; flex-shrink: 0; }
.filter-chip.active { color: var(--liquid-accent); background: var(--liquid-accent-subtle); font-weight: 650; }
.dialog-body { min-height: 0; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 0 24px 24px; }
.dialog-body.showing-details { display: flex; overflow: hidden; }
.resource-rows { display: grid; gap: 16px; }
.verified-single { padding-top: 24px; }
.ready-heading { display: flex; align-items: flex-start; gap: 12px; color: var(--text-primary); padding: 4px 0 8px; }
.ready-heading > svg { width: 24px; color: var(--success); flex-shrink: 0; }
.ready-heading strong { font-size: 16px; }.ready-heading p { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.save-receipt { display: grid; gap: 16px; justify-items: center; padding: 40px 16px; text-align: center; }
.receipt-icon { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; background: var(--success-subtle); color: var(--success); }
.save-receipt h2 { font-size: 22px; }.save-receipt p { color: var(--text-secondary); font-size: 14px; }
.save-receipt .receipt-error { color: var(--danger); }
.receipt-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 12px; }
.receipt-actions button { gap: 8px; min-height: 48px; }.receipt-actions svg { width: 18px; }
.liquid-resource-row { display: flex; align-items: center; gap: 20px; padding: 24px; border: 0; background: var(--surface-1); }
.row-left { min-width: 0; flex: 1; }
.row-info { min-width: 0; }
.row-title { overflow-wrap: anywhere; color: var(--text-primary); font-size: .94rem; font-weight: 650; line-height: 1.5; }
.row-tags { display: flex; flex-wrap: wrap; gap: 5px 9px; margin-top: 8px; color: var(--text-tertiary); font-size: .73rem; overflow-wrap: anywhere; }
.verification-notice { margin-top: 12px; color: var(--text-secondary); font-size: .78rem; line-height: 1.6; }
.archive-batch-plan { display: grid; gap: 6px; margin-top: 12px; padding: 12px 14px; border-radius: 12px; background: var(--surface-2); color: var(--text-secondary); font-size: .75rem; line-height: 1.55; }
.archive-batch-plan strong { color: var(--text-primary); font-weight: 600; }
.tag-badge { padding: 1px 6px; background: var(--surface-2); border-radius: 5px; color: var(--text-secondary); font-size: .67rem; }
.update-badge { color: var(--liquid-accent); font-size: .78rem; font-weight: 650; }
.row-right { display: flex; gap: 8px; flex-shrink: 0; }
.btn-action { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border: 0; border-radius: 10px; color: var(--text-primary); background: var(--glass-bg-active); font-size: .81rem; font-weight: 600; }
.btn-details { color: var(--liquid-accent); background: transparent; }
.btn-details:hover:not(:disabled) { background: var(--glass-bg-hover); }
.resource-save-error { margin-top: 12px; }
.empty-notice { padding: 40px 16px; color: var(--text-secondary); text-align: center; font-size: .9rem; }
.empty-notice > span { display: block; }
.retry-search-button, .load-more-button { display: inline-flex; min-height: 46px; align-items: center; justify-content: center; gap: 7px; margin-top: 16px; padding: 0 18px; border: 0; border-radius: var(--cinema-radius-control); color: var(--liquid-accent); background: transparent; font-size: .84rem; }
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
  .dialog-title { font-size: 1.08rem; line-height: 1.8; }
  .dialog-meta-info { gap: 9px; }
  .cat-selector-row { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; width: 100%; }
  .cat-pill-group { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; width: 100%; margin-left: 0; margin-top: 4px; }
  .cat-select-pill { min-height: 38px; padding: 0 6px; font-size: .78rem; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background: var(--surface-1); }
  .result-search { margin: 0 16px; }
  .result-summary { padding: 14px 20px 2px; }
  .result-filters { padding: 4px 16px 10px; gap: 2px; }
  .filter-chip { padding: 0 15px; }
  .dialog-body { padding: 0 16px calc(20px + var(--safe-area-bottom)); }
  .resume-actions { display: grid; width: min(100%, 320px); grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
  .resume-actions .btn-transfer { grid-column: 1 / -1; }
  .resume-actions button { padding-inline: 6px; }
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
.btn-transfer:hover:not(:disabled) { filter: brightness(1.08); }
.liquid-resource-row { border-radius: var(--cinema-radius-card); box-shadow: none; }
@media (min-width: 900px) {
  .dialog-header, .result-summary, .result-filters, .dialog-body { width: 100%; }
}
@media (min-width: 1024px) {
  .liquid-dialog-backdrop { padding: 32px; background: rgb(0 0 0 / .65) !important; }
  .liquid-dialog { width: min(1100px, 100%); height: auto; min-height: min(460px, calc(100dvh - 64px)); max-height: min(860px, calc(100dvh - 64px)); border: 1px solid var(--divider); border-radius: var(--cinema-radius-hero); }
  .dialog-header { padding: 28px 32px 20px; }
  .result-search, .official-progress { margin-inline: 32px; }
  .result-search-icon { margin-left: 10px; }
  .result-summary, .result-filters, .dialog-body { padding-left: 32px; padding-right: 32px; }
  .dialog-body { padding-bottom: 32px; }
}
@media (max-width: 640px) { .liquid-dialog { width: 100%; height: var(--app-viewport-height); max-height: none; border-radius: 0; } .dialog-header { padding-top: calc(var(--mobile-header-top-space, 18px) + var(--safe-area-top)); } }
@media (max-width: 767px) {
  .search-status { margin-left: var(--page-left); margin-right: var(--page-right); }
  .dialog-header, .result-filters, .dialog-body { padding-left: var(--page-left); padding-right: var(--page-right); }
  .result-summary { padding-left: var(--page-left); padding-right: var(--page-right); }
  .result-search, .official-progress { margin-left: var(--page-left); margin-right: var(--page-right); }
  .result-search-icon { margin-left: 6px; }
  .liquid-resource-row { padding: 20px; background: var(--surface-1); }
}

</style>
