<script setup lang="ts">
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import ScrollLoad from '../common/ScrollLoad.vue';
import { computed, ref, watch } from 'vue';
import { ArrowLeft, ArrowRight, ChevronRight, RefreshCw, Search, X } from '@lucide/vue';
import ResourceThumbnail from './ResourceThumbnail.vue';
import type { QuarkShareDetails } from '../../services/quarkStreamService';
import QuarkResourceDetails from './QuarkResourceDetails.vue';
import type { MediaItem, CategoryType } from '../../types/media';
import type { ResourceItem } from '../../types/search';
import {parseLibraryInput,type LibrarySaveFeedback} from '../../services/libraryFeedback';
import { useDialog } from '../../composables/useDialog';
import { resourceTitleRelevance } from '../../../server/searchTitle.js';

const props = defineProps<{
  isOpen: boolean;
  isAnalyzing: boolean;
  initialResource?: ResourceItem | null;
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
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'preview-title',title:string):void;
  (e: 'resource-unavailable', url: string): void;
  (e: 'open-auth-settings'): void;
  (e: 'transfer', res: ResourceItem): void;
  (e: 'play-resource', media: MediaItem, resource: ResourceItem, category: CategoryType, episodeFid?: string): void;
  (e: 'retry-search'): void;
  (e: 'search', keyword: string): void;
  (e: 'manage-share', share:{url:string;passcode:string}):void;
  (e: 'save-to-cards', media: MediaItem, targetCategory: CategoryType, bestRes?: ResourceItem, selectedFids?: string[]): void;
}>();

const detailResource = ref<ResourceItem | null>(null);
const targetCategory = ref<CategoryType>('tv');
const categories: Array<{ value: CategoryType; label: string }> = [
  { value: 'tv', label: '电视剧' }, { value: 'movie', label: '电影' },
  { value: 'variety', label: '综艺' }, { value: 'anime', label: '动漫' }
];
const replacingSource = computed(() => Boolean(props.media?.quarkFid));
type ResultFilter = 'recommended' | 'latest' | '4k' | 'complete';
const resultFilter = ref<ResultFilter>('recommended');
const searchQuery = ref('');
const searchInput=ref<HTMLInputElement|null>(null);
const parsedSearch=computed(()=>parseLibraryInput(searchQuery.value));
const composing=ref(false);
const searchOnly=computed(()=>!detailResource.value&&!props.searchKeyword&&!props.isAnalyzing);
const clearSearch=()=>{searchQuery.value='';searchInput.value?.focus();};
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
 * 聚合结果没有稳定的文件 MIME 信息，不能仅凭清晰度给资源排序。剔除
 * 非视频、解说混剪以及与保存分类明确不符的内容，避免误选为正片来源。
 */
const isExcludedResource = (resource: ResourceItem) => {
  const title = cleanTitle(resource.title);
  return /有声(?:小说|书)?|播讲|演播|朗读|听书|音频|原声带|广播剧|相声|评书|电子书|小说|漫画|kindle/i.test(title)
    || /(?:^|[.\s_\-\[\]()（）])(?:mp3|flac|aac|m4a|wav|ape|ogg|epub|mobi|azw3|pdf|txt|docx?)(?:$|[.\s_\-\]\]()（）])/i.test(title)
    || /沙雕版|解说(?:版|视频)|混剪(?:版|视频)/i.test(title)
    || (targetCategory.value === 'anime' && /(?:^|[\s.·|【\[])(?:微)?短剧(?:$|[\s.·|:：】\]])/u.test(title));
};

const resourceScore = (resource: ResourceItem) => {
  const title = cleanTitle(resource.title);
  const keyword = props.searchKeyword?.trim() || props.media?.title.trim() || '';
  let score = (resource.relevance ?? resourceTitleRelevance(keyword, title)) * 10;
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
  const sorted = resources.filter(resource => !isExcludedResource(resource)).sort((left, right) => {
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
const previews = ref(new Map<string, QuarkShareDetails>());
const resourceKey = (resource: ResourceItem) => `${resource.url}\0${resource.password || ''}`;
const preview = (resource: ResourceItem) => previews.value.get(resourceKey(resource));
const previewImage = (resource: ResourceItem) => preview(resource)?.entries.find(item => item.isVideo && item.thumbnail)?.thumbnail;
const dateText = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}) : '';
const resourceMeta = (resource: ResourceItem) => {
  const data = preview(resource);
  return [data ? data.videoCount ? `${data.videoCount} 个视频` : '无可播放视频' : '',
    data?.sizeFormatted || resource.size, dateText(resource.datetime)].filter(Boolean).join(' · ');
};
const cacheDetails = (data: QuarkShareDetails) => { if (detailResource.value) previews.value.set(resourceKey(detailResource.value),data); if(props.initialResource && data.title && detailResource.value){if(detailResource.value.title!==data.title)detailResource.value={...detailResource.value,title:data.title};emit('preview-title',data.title);} };
const playFile = (fid: string) => { if (props.media && detailResource.value && !replacingSource.value) emit('play-resource',props.media,detailResource.value,targetCategory.value,fid); };

watch([() => props.media?.id, () => props.currentCategory], () => {
  targetCategory.value = props.media?.category || props.currentCategory;
}, { immediate: true });

watch([() => props.isOpen, () => props.searchKeyword], ([isOpen, keyword]) => {
  composing.value=false;
  if (isOpen) searchQuery.value = props.initialResource ? '' : keyword || props.media?.title || '';
}, { immediate: true });

watch([() => props.isOpen, () => props.media?.id, () => props.searchKeyword,()=>props.initialResource], () => { detailResource.value = props.initialResource || null; },{immediate:true});

watch([() => props.isOpen, () => props.media?.id, resultFilter], () => {
  visibleCount.value = batchSize;
});

const loadMore = () => {
  if (props.isSaving) return;
  visibleCount.value = Math.min(filteredResources.value.length, visibleCount.value + batchSize);
};

const submitSearch = () => {
  const keyword = searchQuery.value.trim();
  if (!keyword || props.isAnalyzing || props.isSaving || composing.value || parsedSearch.value.kind==='invalid') return;
  if(parsedSearch.value.kind==='share'){emit('manage-share',{url:parsedSearch.value.url,passcode:parsedSearch.value.passcode});return;}
  emit('search', keyword);
};


const requestClose = () => {
  if (!props.isSaving) emit('close');
};
const saveDetails = (selectedFids?: string[]) => {
  if (props.media && detailResource.value) emit('save-to-cards', props.media, targetCategory.value, detailResource.value, selectedFids);
};
const dialogRef = ref<HTMLElement | null>(null);
useDialog(dialogRef, () => props.isOpen, requestClose);
</script>

<template>
  <div ref="dialogRef" class="resource-backdrop" :class="{ active: isOpen, 'search-only':searchOnly }" role="dialog" aria-modal="true" aria-labelledby="resource-dialog-title" @click.self="requestClose">
    <section v-if="media" class="resource-dialog" :class="{'search-only':searchOnly}" :aria-busy="isSaving">
      <header class="resource-header">
        <template v-if="detailResource"><button type="button" class="icon-button" aria-label="返回资源列表" :disabled="isSaving" @click="detailResource = null"><ArrowLeft /></button><h2 id="resource-dialog-title" :title="cleanTitle(detailResource.title)">{{ cleanTitle(detailResource.title) }}</h2><select v-model="targetCategory" class="category-picker" aria-label="收藏分类" :disabled="isSaving"><option v-for="category in categories" :key="category.value" :value="category.value">{{ category.label }}</option></select></template>
        <h2 v-else id="resource-dialog-title">搜索</h2>
        <button type="button" class="icon-button close-dialog" aria-label="关闭资源选择" :disabled="isSaving" @click="requestClose"><X /></button>
      </header>
      <div v-if="!detailResource" class="resource-searchbar"><form class="result-search" role="search" @submit.prevent="submitSearch"><Search aria-hidden="true" /><input ref="searchInput" v-model="searchQuery" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" aria-label="片名或分享链接" placeholder="片名或分享链接" @compositionstart="composing=true" @compositionend="composing=false" @keydown.enter="($event.isComposing || $event.keyCode===229) && $event.preventDefault()" :disabled="isAnalyzing || isSaving" /><button v-if="searchQuery" type="button" class="icon-button clear-search" aria-label="清空搜索内容" :disabled="isAnalyzing || isSaving" @click="clearSearch"><X /></button><button type="submit" class="search-submit" :aria-label="parsedSearch.kind==='share'?'管理分享资源':'搜索资源'" :title="parsedSearch.kind==='share'?'管理分享资源':'搜索资源'" :disabled="isAnalyzing || isSaving || !searchQuery.trim() || parsedSearch.kind==='invalid'"><ArrowRight aria-hidden="true"/></button></form><p v-if="parsedSearch.kind==='invalid'" class="input-error" role="alert">{{parsedSearch.message}}</p></div>
      <div v-if="!detailResource && (searchKeyword || isAnalyzing)" class="resource-toolbar"><span>{{ rankedQuarkResources.length }} 个资源</span><span v-if="searchPending || isAnalyzing" class="search-status" role="status"><i></i>搜索中</span><select v-model="resultFilter" aria-label="资源筛选" :disabled="isSaving"><option v-for="option in filterOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></div>
      <div class="dialog-body" :class="{ 'showing-details': detailResource }" >
        <QuarkResourceDetails v-if="detailResource" :resource="detailResource" :initial-details="preview(detailResource)" :is-saving="isSaving" :replacing-source="replacingSource" :save-error="failedResourceId === detailResource.id ? saveError : null" @loaded="cacheDetails" @back="detailResource = null" @unavailable="emit('resource-unavailable',$event.url); detailResource = null" @open-auth-settings="emit('open-auth-settings')" @save="saveDetails" @play="playFile" />
        <LoadingSkeleton v-else-if="(isAnalyzing || searchPending) && !visibleResources.length" variant="rows" :count="5" label="正在搜索资源" />
        <template v-else>
          <ul v-if="visibleResources.length" class="resource-list" aria-label="网盘资源列表"><li v-for="res in visibleResources" :key="res.id"><button type="button" class="resource-item" :disabled="isSaving" :aria-label="`打开资源 ${cleanTitle(res.title)}`" @click="detailResource = res"><ResourceThumbnail :src="previewImage(res)" directory /><span class="source-copy"><strong>{{ cleanTitle(res.title) }}</strong><small v-if="resourceMeta(res)">{{ resourceMeta(res) }}</small><small v-if="res.linkStatus === 'restricted'">需要提取码</small></span><ChevronRight class="source-arrow" aria-hidden="true" /></button></li></ul>
          <div v-else-if="searchKeyword || searchError" class="empty-notice" :role="searchError ? 'alert' : 'status'"><p>{{ searchError || (searchPending ? '正在查找可用资源…' : resultFilter === 'recommended' ? '暂无可用资源' : '没有符合筛选条件的资源') }}</p><button v-if="searchError" type="button" :disabled="isSaving" @click="emit('retry-search')"><RefreshCw />重试</button><button v-else-if="resultFilter !== 'recommended'" type="button" @click="resultFilter = 'recommended'">显示全部</button></div>
          <ScrollLoad :active="isOpen" :pending="isSaving" :more="hasMoreResources" :progress="`${resultFilter}:${visibleCount}:${filteredResources.length}`" @load="loadMore" />
        </template>
      </div>
    </section>
  </div>
</template>
<style scoped>
.resource-backdrop { position: fixed; inset: 0; z-index: 1400; display: none; align-items: center; justify-content: center; padding: 24px; background:var(--dialog-backdrop,rgb(0 0 0 / .6)); }
.resource-backdrop.active { display: flex; }
.resource-dialog { display: flex; width:min(960px,100%); height: min(760px,calc(100dvh - 48px)); min-height: 0; flex-direction: column; overflow: hidden; border: 1px solid var(--divider); border-radius: 20px; color: var(--text-primary); background:var(--surface-1); box-shadow:0 24px 80px #0005; }
.input-error{margin-top:8px;color:var(--danger);font-size:13px}
.resource-searchbar{padding:12px 20px 4px;flex-shrink:0}.clear-search{visibility:hidden;pointer-events:none}.result-search:focus-within .clear-search{visibility:visible;pointer-events:auto}
.resource-header { display: flex; align-items: center; gap: 10px; padding:16px 20px; border-bottom:1px solid var(--divider); flex-shrink: 0; }
.resource-header h2 { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .95rem; font-weight: 600; }
.icon-button { display: grid; width:44px; height:44px; flex:0 0 44px; place-items: center; padding: 0; border: 0; border-radius: 8px; color: var(--text-secondary); background: transparent; }
.icon-button svg { width: 20px; height: 20px; }
.close-dialog:hover { background: var(--surface-2); }
.result-search { display: flex; min-width: 0; flex: 1; align-items: center; gap: 5px; padding: 2px 4px 2px 12px; min-height: 46px; border: 1px solid var(--divider); border-radius:12px; background:var(--surface-2); }
.result-search > svg { width: 18px; height: 18px; flex-shrink: 0; color: var(--text-tertiary); }
.result-search input { width: 100%; flex: 1; min-width: 0; height:44px; padding: 0 4px; border: 0; color: var(--text-primary); background: transparent; font-size: 16px; outline: none; }
.result-search input::-webkit-search-cancel-button { -webkit-appearance: none; }

.search-submit svg{width:20px;height:20px}.search-submit { display:grid;place-items:center; min-width:44px; min-height:44px; flex-shrink:0; padding: 0 12px; border: 0; border-radius: 7px; color: var(--liquid-accent); background: transparent; font-size: .84rem; font-weight: 600; }
.resource-toolbar { display: flex; align-items: center; gap: 12px; padding:8px 24px; color: var(--text-tertiary); font-size: .76rem; }
.resource-toolbar select { margin-left: auto; }
.resource-toolbar select,.category-picker { min-height:44px; max-width: 110px; padding: 0 4px; border: 0; color: var(--text-secondary); background: transparent; font-size: .82rem; }
.search-status { display: flex; align-items: center; gap: 6px; font-size: .72rem; }
.search-status i { width: 5px; height: 5px; border-radius: 50%; background: var(--liquid-accent); }
.dialog-body { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding:8px 20px 20px; }
.dialog-body.showing-details { display: flex; overflow: hidden; }
.resource-list { display:grid; gap:4px; list-style:none; padding:0; margin:0; }
.resource-item { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 88px; padding: 12px 8px; border: 0; border:1px solid transparent; border-radius:12px; color: var(--text-primary); background: transparent; text-align: left; }
.resource-item:hover { background:var(--surface-2); border-color:var(--divider); }
.source-copy { display: grid; min-width: 0; flex: 1; gap: 5px; }
.source-copy strong { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font-size: .88rem; line-height: 1.5; font-weight: 550; }
.source-copy small { color: var(--text-tertiary); font-size: .72rem; }
.source-arrow { width: 17px; height: 17px; color: var(--text-tertiary); flex-shrink: 0; }
.resource-skeleton { height: 72px; margin: 12px 0; border-radius:12px; background:var(--surface-2); }
.empty-notice { display: grid; justify-items: center; gap: 14px; padding: 48px 12px; color: var(--text-tertiary); font-size: .85rem; }
.empty-notice button,.load-more { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 0; color: var(--liquid-accent); background: transparent; }
.empty-notice svg { width: 16px; height: 16px; }
.load-more { width: 100%; margin-top: 12px; }
button:focus-visible,select:focus-visible { outline:2px solid var(--text-primary); outline-offset:-2px; }
.resource-dialog { animation:resource-enter .18s ease; }
@keyframes resource-enter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
@media(max-width:640px) {
  .resource-backdrop { align-items:flex-end; padding:calc(var(--safe-area-top) + 8px) max(8px,var(--safe-area-right)) max(8px,var(--safe-area-bottom)) max(8px,var(--safe-area-left)); }
  .resource-dialog { width:100%; height:min(840px,calc(100dvh - var(--safe-area-top) - var(--safe-area-bottom) - 16px)); border-radius:20px; }
  .resource-header { gap:4px; padding:8px 12px; }
  .resource-searchbar{padding:10px 12px 4px}
  .resource-toolbar { gap:8px; padding:6px 14px; }
  .dialog-body { padding:4px 12px 14px; }
  .resource-item { min-height:84px; gap:12px; padding:10px 4px; }
  .resource-header h2 { font-size:14px; }
  .category-picker { max-width:76px; font-size:16px; }
  .result-search { padding-left:8px; gap:0; }
  .result-search>svg { display:none; }
  .search-submit svg{width:20px;height:20px}.search-submit { display:grid;place-items:center; padding:0 8px; }
  .resource-toolbar select { font-size:16px; }
}
@media(prefers-reduced-motion:reduce) { .resource-dialog { animation:none; } }
.resource-backdrop.search-only{align-items:flex-start;padding-top:calc(var(--safe-area-top) + clamp(72px,12vh,128px))}.resource-dialog.search-only{width:min(600px,100%);height:auto}.search-only .dialog-body{display:none}.search-only .resource-searchbar{padding-bottom:20px}</style>
