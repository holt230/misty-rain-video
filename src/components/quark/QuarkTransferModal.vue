<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, RefreshCw, Search, SlidersHorizontal, X } from '@lucide/vue';
import type { MediaItem, CategoryType } from '../../types/media';
import type { ResourceItem } from '../../types/search';
import SkeletonCard from '../common/SkeletonCard.vue';

const props = defineProps<{
  isOpen: boolean;
  isAnalyzing: boolean;
  media: MediaItem | null;
  currentCategory: CategoryType;
  quarkResources: ResourceItem[];
  allResources: ResourceItem[];
  searchError?: string;
  searchKeyword?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'transfer', res: ResourceItem): void;
  (e: 'copy', res: ResourceItem): void;
  (e: 'retry-search'): void;
  (e: 'search', keyword: string): void;
  (e: 'save-to-cards', media: MediaItem, targetCategory: CategoryType, bestRes?: ResourceItem): void;
}>();

const activeTab = ref<'quark' | 'other'>('quark');
const targetCategory = ref<CategoryType>('tv');
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

const dedupeTitleKey = (title: string) => titleKey(title)
  .replace(/(?:更新至|更至|更新|第|ep|e)0*\d{1,4}集?/gi, '')
  .replace(/s0*\d{1,2}e?0*\d{1,4}/gi, match => match.replace(/e0*\d+$/i, ''));

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
  let score = 0;
  if (title === keyword) score += 45;
  else if (title.startsWith(keyword)) score += 75;
  else if (title.includes(keyword)) score += 50;
  if (resource.is4k || /4k/i.test(title)) score += 30;
  if (/hdr|dv|杜比视界/i.test(title)) score += 10;
  if (/60\s*(?:fps|帧)/i.test(title)) score += 8;
  if (/dts|杜比|5\.1/i.test(title)) score += 5;
  if (/全集|完结|全\s*\d+\s*集/i.test(title)) score += 14;
  if (/flac|mp3|片尾曲|原声带|音乐/i.test(title)) score -= 160;
  if (title.length <= keyword.length + 2 && !resource.is4k) score -= 28;
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
    const key = dedupeTitleKey(resource.title) || resource.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const rankedQuarkResources = computed(() => rankAndDedupe(
  props.quarkResources.filter(resource => /pan\.quark\.cn\/s\/[a-zA-Z0-9]+/i.test(resource.url))
));
const rankedOtherResources = computed(() => rankAndDedupe(
  props.allResources.filter(resource => resource.driveType !== 'quark')
));
const activeResources = computed(() => activeTab.value === 'quark'
  ? rankedQuarkResources.value
  : rankedOtherResources.value);
const filteredResources = computed(() => {
  const resources = activeResources.value.filter(resource => {
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

watch(() => props.currentCategory, (newVal) => {
  targetCategory.value = newVal;
}, { immediate: true });

watch([() => props.isOpen, () => props.searchKeyword], ([isOpen, keyword]) => {
  if (isOpen) searchQuery.value = keyword || props.media?.title || '';
}, { immediate: true });

watch([() => props.isOpen, () => props.media?.id, activeTab, resultFilter], () => {
  visibleCount.value = batchSize;
});

const loadMore = () => {
  visibleCount.value = Math.min(filteredResources.value.length, visibleCount.value + batchSize);
};

const submitSearch = () => {
  const keyword = searchQuery.value.trim();
  if (!keyword || props.isAnalyzing) return;
  emit('search', keyword);
};

const handleBodyScroll = (event: Event) => {
  const target = event.currentTarget as HTMLElement;
  if (hasMoreResources.value && target.scrollTop + target.clientHeight >= target.scrollHeight - 180) loadMore();
};
</script>

<template>
  <div
    class="liquid-dialog-backdrop"
    :class="{ active: isOpen }"
    @click.self="emit('close')"
  >
    <div class="liquid-dialog" v-if="media">
      <!-- 弹窗顶栏 -->
      <div class="dialog-header">
        <div class="media-meta-row">
          <img :src="media.poster" :alt="media.title" class="dialog-poster" />
          <div class="dialog-meta-info">
            <div class="meta-title-line">
              <h3 class="dialog-title" :title="media.title">{{ media.title }}</h3>
            </div>

            <!-- 分类选择 -->
            <div class="cat-selector-row">
              <span class="cat-label">归档分类</span>
              <div class="cat-pill-group">
                <button
                  class="cat-select-pill"
                  :class="{ active: targetCategory === 'tv' }"
                  @click="targetCategory = 'tv'"
                >
                  电视剧
                </button>
                <button
                  class="cat-select-pill"
                  :class="{ active: targetCategory === 'movie' }"
                  @click="targetCategory = 'movie'"
                >
                  电影
                </button>
                <button
                  class="cat-select-pill"
                  :class="{ active: targetCategory === 'variety' }"
                  @click="targetCategory = 'variety'"
                >
                  综艺
                </button>
                <button
                  class="cat-select-pill"
                  :class="{ active: targetCategory === 'anime' }"
                  @click="targetCategory = 'anime'"
                >
                  动漫
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="dialog-top-actions">
          <button class="btn-close-dialog" type="button" aria-label="关闭资源选择" @click="emit('close')">
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
          :disabled="isAnalyzing"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="clear-search-button"
          aria-label="清空搜索内容"
          :disabled="isAnalyzing"
          @click="searchQuery = ''"
        >
          <X aria-hidden="true" />
        </button>
        <button
          type="submit"
          class="submit-search-button"
          :disabled="isAnalyzing || !searchQuery.trim()"
        >
          {{ isAnalyzing ? '检索中' : '搜索' }}
        </button>
      </form>

      <!-- 选项卡 -->
      <div class="dialog-tabs">
        <button
          class="dialog-tab"
          :class="{ active: activeTab === 'quark' }"
          @click="activeTab = 'quark'"
        >
          <span>云端网盘</span>
          <span class="tab-badge">{{ rankedQuarkResources.length }}</span>
        </button>

        <button
          class="dialog-tab"
          :class="{ active: activeTab === 'other' }"
          @click="activeTab = 'other'"
        >
          <span>其他网盘</span>
          <span class="tab-badge">{{ rankedOtherResources.length }}</span>
        </button>
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
              v-for="(res, index) in visibleResources"
              :key="res.id"
              v-memo="[res.id, index === 0, activeTab]"
              class="liquid-resource-row"
            >
              <div class="row-left">
                <div v-if="activeTab === 'other'" class="drive-badge">{{ res.driveType.toUpperCase() }}</div>
                <div class="row-info">
                  <div class="row-title" :title="cleanTitle(res.title)">
                    <span v-if="activeTab === 'quark' && res.id === bestQuarkResource?.id" class="recommended-badge">
                      <Check aria-hidden="true" />推荐
                    </span>
                    {{ cleanTitle(res.title) }}
                  </div>
                  <div class="row-tags">
                    <span class="tag-badge">{{ res.quality }}</span>
                    <span v-if="res.size" class="tag-meta">{{ res.size }}</span>
                    <span v-if="res.password" class="tag-meta">提取码 {{ res.password }}</span>
                    <span class="tag-meta">{{ res.datetime }}</span>
                  </div>
                </div>
              </div>

              <div class="row-right">
                <button
                  v-if="activeTab === 'quark'"
                  class="btn-action btn-transfer"
                  @click="emit('save-to-cards', media, targetCategory, res)"
                >
                  选用并加入
                </button>
                <button v-else class="btn-action btn-copy" @click="emit('copy', res)">
                  复制链接
                </button>
              </div>
            </div>

            <button v-if="hasMoreResources" type="button" class="load-more-button" @click="loadMore">
              加载更多 · 还有 {{ filteredResources.length - visibleResources.length }} 条
            </button>
          </div>

          <div v-else class="empty-notice">
            <span>{{ searchError || (resultFilter === 'recommended' ? '暂时没有可用资源，可以修改上方片名重新搜索。' : '当前筛选下没有结果，试试“推荐”。') }}</span>
            <button v-if="searchError" type="button" class="retry-search-button" @click="emit('retry-search')">
              <RefreshCw aria-hidden="true" />
              重新检索
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.liquid-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  z-index: 1100;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s ease, visibility 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.liquid-dialog-backdrop.active {
  opacity: 1;
  visibility: visible;
}

.liquid-dialog {
  width: 100%;
  max-width: 820px;
  max-height: 86vh;
  background: rgba(22, 28, 44, 0.78);
  backdrop-filter: blur(48px) saturate(200%);
  -webkit-backdrop-filter: blur(48px) saturate(200%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow:
    inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.35),
    0 28px 70px rgba(0, 0, 0, 0.8);
  border-radius: var(--radius-2xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: scale(0.95);
  transition: transform 0.35s var(--spring-bounce);
}
.liquid-dialog-backdrop.active .liquid-dialog {
  transform: scale(1);
}

.dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: rgba(0, 0, 0, 0.25);
}

.media-meta-row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1;
}

.dialog-poster {
  width: 48px;
  height: 64px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
}

.dialog-meta-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.dialog-title {
  font-size: 1.15rem;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cat-selector-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cat-label {
  font-size: 0.76rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.cat-pill-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cat-select-pill {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--radius-pill);
  padding: 2px 9px;
  font-size: 0.72rem;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}
.cat-select-pill.active {
  background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong));
  border-color: rgba(255, 255, 255, 0.3);
  box-shadow: 0 2px 8px var(--liquid-accent-glow);
  color: var(--accent-ink);
  font-weight: 600;
}

.dialog-top-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.btn-save-to-list {
  background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong));
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.35),
    0 4px 14px var(--liquid-accent-glow);
  color: var(--accent-ink);
  border-radius: var(--radius-pill);
  padding: 7px 16px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--spring-ease);
}
.btn-save-to-list:hover {
  transform: scale(1.04);
}

.btn-close-dialog {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: var(--spring-ease);
}
.btn-close-dialog:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  transform: rotate(90deg);
}
.btn-close-dialog svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

.dialog-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: rgba(0, 0, 0, 0.18);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.result-search {
  display: grid;
  min-height: 52px;
  grid-template-columns: 20px minmax(0, 1fr) 36px auto;
  align-items: center;
  gap: 7px;
  margin: 10px 20px 2px;
  padding: 4px 5px 4px 13px;
  border: 1px solid rgb(239 241 255 / 0.09);
  border-radius: 15px;
  background: rgb(237 240 255 / 0.035);
}

.result-search-icon { width: 18px; height: 18px; color: var(--text-tertiary); }
.result-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--text-primary);
  background: transparent;
  font: inherit;
  font-size: 16px;
}
.result-search input::-webkit-search-cancel-button { display: none; }
.result-search input::placeholder { color: var(--text-quaternary); }
.result-search:focus-within { border-color: rgb(var(--accent-rgb) / 0.32); box-shadow: 0 0 0 3px rgb(var(--accent-rgb) / 0.08); }
.clear-search-button,
.submit-search-button { border: 0; cursor: pointer; touch-action: manipulation; }
.clear-search-button { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 50%; color: var(--text-tertiary); background: transparent; }
.clear-search-button svg { width: 17px; height: 17px; }
.submit-search-button { min-height: 42px; padding: 0 15px; border-radius: 11px; color: var(--accent-ink); background: var(--liquid-accent); font-size: .78rem; font-weight: 700; }
.clear-search-button:disabled,
.submit-search-button:disabled { opacity: .45; cursor: default; }

.dialog-tab {
  background: transparent;
  border: none;
  border-radius: var(--radius-pill);
  padding: 5px 14px;
  color: var(--text-tertiary);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}
.dialog-tab.active {
  background: rgba(255, 255, 255, 0.14);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.25);
  color: #fff;
}
.tab-badge {
  background: rgba(255, 255, 255, 0.12);
  font-size: 0.7rem;
  padding: 1px 5px;
  border-radius: var(--radius-pill);
}

.result-filters {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 20px;
  overflow-x: auto;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  scrollbar-width: none;
}

.result-filters::-webkit-scrollbar { display: none; }
.result-filters > svg { width: 17px; flex: 0 0 auto; color: var(--text-tertiary); }
.filter-chip {
  min-height: 34px;
  padding: 0 13px;
  flex: 0 0 auto;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--text-tertiary);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
}
.filter-chip.active {
  color: var(--liquid-accent);
  border-color: rgb(var(--accent-rgb) / 0.24);
  background: var(--liquid-accent-subtle);
}

.dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.loading-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.84rem;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.mini-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--liquid-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.resource-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.liquid-resource-row {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  transition: all 0.25s ease;
}
.liquid-resource-row:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
}

.row-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.drive-badge {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text-tertiary);
  background: rgba(255, 255, 255, 0.1);
  padding: 3px 6px;
  border-radius: var(--radius-xs);
  flex-shrink: 0;
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.row-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recommended-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-right: 5px;
  padding: 2px 6px;
  border-radius: 999px;
  color: var(--liquid-accent);
  background: var(--liquid-accent-subtle);
  font-size: 0.67rem;
  font-weight: 700;
  vertical-align: 1px;
}
.recommended-badge svg { width: 12px; height: 12px; }

.row-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.74rem;
  color: var(--text-tertiary);
}

.tag-badge {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  border-radius: var(--radius-xs);
  padding: 1px 5px;
}

.tag-meta {
  color: var(--text-tertiary);
}

.row-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.btn-action {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}

.btn-copy {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--text-secondary);
}
.btn-copy:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}

.btn-transfer {
  background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong));
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow: 0 4px 12px var(--liquid-accent-glow);
  color: var(--accent-ink);
}
.btn-transfer:hover {
  transform: scale(1.04);
}

.empty-notice {
  padding: 40px 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

.load-more-button {
  width: 100%;
  min-height: 46px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.035);
  cursor: pointer;
}

@keyframes spin {
  100% { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .liquid-dialog-backdrop {
    align-items: flex-end;
    padding: 0;
    overscroll-behavior: contain;
  }

  .liquid-dialog {
    width: 100%;
    height: 100dvh;
    max-width: none;
    max-height: none;
    border: 0;
    border-radius: 0;
    transform: translateY(24px);
  }

  .liquid-dialog-backdrop.active .liquid-dialog {
    transform: translateY(0);
  }

  .dialog-header {
    position: relative;
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
    padding: calc(10px + env(safe-area-inset-top)) 64px 12px 12px;
  }

  .dialog-poster {
    width: 42px;
    height: 56px;
  }

  .dialog-title {
    font-size: 1rem;
  }

  .cat-selector-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .cat-pill-group {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 5px;
  }

  .cat-select-pill {
    min-height: 40px;
    padding: 0 4px;
    touch-action: manipulation;
  }

  .dialog-top-actions {
    position: absolute;
    top: calc(9px + env(safe-area-inset-top));
    right: 12px;
    width: auto;
  }

  .btn-close-dialog {
    width: 44px;
    height: 44px;
    flex: 0 0 44px;
  }

  .dialog-tabs {
    padding: 8px 12px;
  }

  .result-search {
    min-height: 54px;
    grid-template-columns: 20px minmax(0, 1fr) 38px auto;
    margin: 9px calc(var(--mobile-gutter) + var(--safe-area-right)) 3px calc(var(--mobile-gutter) + var(--safe-area-left));
  }

  .clear-search-button { width: 38px; height: 44px; }
  .submit-search-button { min-height: 44px; padding: 0 14px; }

  .result-filters {
    gap: 6px;
    padding: 7px 12px;
  }

  .filter-chip { min-height: 40px; padding: 0 14px; touch-action: manipulation; }

  .dialog-tab {
    min-height: 44px;
    flex: 1;
    justify-content: center;
    padding: 0 10px;
    touch-action: manipulation;
  }

  .dialog-body {
    padding: 12px 10px calc(16px + env(safe-area-inset-bottom));
    overscroll-behavior: contain;
  }

  .liquid-resource-row {
    align-items: stretch;
    flex-direction: column;
    gap: 12px;
    padding: 13px;
  }

  .row-title {
    display: -webkit-box;
    overflow: hidden;
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .recommended-badge { display: inline-flex; }

  .row-right {
    width: 100%;
  }

  .btn-action {
    min-height: 44px;
    flex: 1;
    justify-content: center;
    touch-action: manipulation;
  }

  .load-more-button { min-height: 48px; touch-action: manipulation; }
}
</style>

<style scoped>
.liquid-dialog { border-radius: 24px; }
.dialog-header,
.dialog-tabs { border-color: rgba(255, 255, 255, 0.075); background: rgba(255, 255, 255, 0.018); }
.dialog-poster { border-color: rgba(255, 255, 255, 0.08); box-shadow: none; }
.cat-select-pill,
.dialog-tab { min-height: 36px; border-color: transparent; background: transparent; }
.cat-select-pill.active,
.dialog-tab.active { color: var(--liquid-accent); border-color: rgba(46, 230, 166, 0.24); background: rgba(46, 230, 166, 0.1); box-shadow: none; }
.btn-save-to-list,
.btn-transfer { background: var(--liquid-accent); box-shadow: 0 8px 20px rgba(46, 230, 166, 0.14); }
.btn-save-to-list:hover,
.btn-transfer:hover { transform: none; filter: brightness(1.08); }
.btn-close-dialog:hover { transform: none; }
.mini-spinner { border-top-color: var(--liquid-accent); }
.liquid-resource-row { border-radius: 15px; }
@media (prefers-reduced-motion: reduce) {
  .liquid-dialog-backdrop,
  .liquid-dialog,
  .mini-spinner { transition: none; animation: none; }
}
@media (max-width: 640px) {
  .liquid-dialog { background: var(--liquid-canvas) !important; }
  .dialog-header { gap: 10px; padding: calc(8px + var(--safe-area-top)) calc(56px + var(--safe-area-right)) 10px calc(var(--mobile-gutter) + var(--safe-area-left)); }
  .dialog-top-actions { top: calc(7px + var(--safe-area-top)); right: calc(var(--mobile-gutter) + var(--safe-area-right)); }
  .media-meta-row { gap: 10px; }
  .dialog-poster { width: 38px; height: 52px; }
  .cat-selector-row { gap: 4px; }
  .cat-select-pill { min-height: 44px; border-radius: 12px; }
  .dialog-tabs { gap: 5px; padding: 6px var(--mobile-gutter); }
  .dialog-tab { min-height: 44px; border-radius: 12px; }
  .result-filters { padding-right: calc(var(--mobile-gutter) + var(--safe-area-right)); padding-left: calc(var(--mobile-gutter) + var(--safe-area-left)); }
  .dialog-body { padding: 10px var(--mobile-gutter) calc(16px + var(--safe-area-bottom)); }
  .liquid-resource-row { gap: 10px; padding: 12px; }
}
</style>

<style scoped>
.liquid-dialog-backdrop { background: rgb(3 4 8 / 0.84); }
.liquid-dialog {
  border-color: rgb(239 241 255 / 0.10);
  background: rgb(16 18 27 / 0.98);
  box-shadow: 0 28px 74px rgb(0 0 0 / .58), 0 0 44px rgb(var(--accent-rgb) / .05);
}
.dialog-header,
.dialog-tabs,
.result-filters { border-color: rgb(239 241 255 / 0.07); background: rgb(237 240 255 / 0.018); }
.dialog-poster { border-color: rgb(239 241 255 / 0.10); }
.cat-label { color: var(--text-tertiary); }
.cat-select-pill,
.dialog-tab,
.filter-chip { color: var(--text-tertiary); background: rgb(237 240 255 / 0.035); }
.cat-select-pill.active,
.dialog-tab.active,
.filter-chip.active {
  border-color: rgb(var(--accent-rgb) / 0.25);
  color: var(--liquid-accent);
  background: var(--liquid-accent-subtle);
}
.btn-transfer { color: var(--accent-ink); background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong)); box-shadow: 0 8px 22px var(--liquid-accent-glow); }
.mini-spinner { border-top-color: var(--liquid-accent); }
.liquid-resource-row {
  border-color: rgb(239 241 255 / 0.08);
  background: rgb(237 240 255 / 0.03);
  box-shadow: inset 0 1px rgb(255 255 255 / 0.035);
}
.liquid-resource-row:hover { border-color: rgb(var(--accent-rgb) / 0.16); background: var(--liquid-accent-muted); }
.recommended-badge { color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.tag-badge { color: var(--text-secondary); background: rgb(237 240 255 / 0.055); }
.load-more-button { border-color: rgb(239 241 255 / 0.08); background: rgb(237 240 255 / 0.035); }
.retry-search-button { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; gap: 7px; margin-top: 14px; padding: 0 14px; border: 1px solid rgb(var(--accent-rgb) / 0.20); border-radius: 12px; color: var(--liquid-accent); background: var(--liquid-accent-muted); font-size: .8rem; font-weight: 650; cursor: pointer; }
.retry-search-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; }

@media (max-width: 640px) {
  .liquid-dialog { background: var(--liquid-canvas) !important; }
  .dialog-header { background: linear-gradient(180deg, rgb(24 28 43 / .94), rgb(10 11 16 / .98)); }
  .dialog-tabs { background: rgb(237 240 255 / 0.018); }
  .dialog-body { background: radial-gradient(90% 38% at 50% 0%, rgb(var(--accent-rgb) / .05), transparent 74%); }
  .liquid-resource-row { border-radius: 16px; }
}
</style>
