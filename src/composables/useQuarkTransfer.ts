import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { CategoryType, MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';
import { SilentSearchEngine } from '../services/silentSearchEngine';
import { useToast } from './useToast';
import { matchResource, refinedResourceQuery } from '../services/resourceMatching';

export function useQuarkTransfer() {
  const toast = useToast();
  const engine = new SilentSearchEngine();

  const isOpen = ref(false);
  const isAnalyzing = ref(false);
  const currentMedia = ref<MediaItem | null>(null);
  const quarkResources = ref<ResourceItem[]>([]);
  const searchError = ref('');
  const searchNotice = ref('');
  const searchPending = ref(false);
  const searchKeyword = ref('');
  let searchSequence = 0;

  interface SearchProgress { tasks: Set<string>; supplemented: boolean; notice: string; error: string }
  const isCurrent = (sequence: number) => sequence === searchSequence && isOpen.value;
  const append = (items: ResourceItem[]) => {
    const combined = new Map(quarkResources.value.map(item => [item.url, item]));
    for (const item of items) combined.set(item.url, item);
    quarkResources.value = [...combined.values()];
  };
  const showProgress = (progress: SearchProgress) => {
    searchPending.value = progress.tasks.size > 0;
    searchError.value = !quarkResources.value.length && !searchPending.value ? progress.error : '';
    searchNotice.value = searchPending.value
      ? quarkResources.value.length ? '已显示当前候选，正在补充其他来源…' : '正在继续搜索，找到结果后会自动显示…'
      : progress.supplemented ? '已通过备用来源补充候选；添加时会验证链接' : progress.notice;
  };
  const supplementSearch = async (keyword: string, sequence: number, progress: SearchProgress, force: boolean) => {
    try {
      const result = await engine.supplement(keyword, { force });
      if (!isCurrent(sequence)) return;
      if (result.success) {
        const before = quarkResources.value.length;
        append(result.quarkItems);
        progress.supplemented = quarkResources.value.length > before;
      }
    } finally {
      if (isCurrent(sequence)) {
        progress.tasks.delete('public');
        showProgress(progress);
      }
    }
  };
  const followSearch = async (keyword: string, sequence: number, progress: SearchProgress, query?: string, task = 'server') => {
    const deadline = Date.now() + 35_000;
    for (let attempt = 0; attempt < 35 && Date.now() < deadline; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      if (!isCurrent(sequence)) return;
      try {
        const result = await engine.readCached(keyword, { query });
        if (!isCurrent(sequence)) return;
        if (!result) break;
        append(result.quarkItems);
        progress.notice = result.message || '';
        if (!result.refreshing) progress.tasks.delete(task);
        showProgress(progress);
        if (!result.refreshing) return;
      } catch { break; }
    }
    if (isCurrent(sequence)) {
      progress.tasks.delete(task);
      progress.notice = quarkResources.value.length
        ? '已展示当前候选；其余来源暂未返回，可稍后重新搜索'
        : '本轮未取得可用候选，来源可能超时；可稍后重新搜索';
      showProgress(progress);
    }
  };

  const refineSearch = async (keyword: string, category: CategoryType, sequence: number, progress: SearchProgress) => {
    const query = refinedResourceQuery(keyword, category);
    try {
      const result = await engine.search(keyword, { query });
      if (!isCurrent(sequence)) return;
      if (result.success) {
        append(result.quarkItems);
        if (result.refreshing) await followSearch(keyword, sequence, progress, query, 'refine');
      }
    } finally {
      if (isCurrent(sequence)) { progress.tasks.delete('refine'); showProgress(progress); }
    }
  };

  /**
   * 在当前资源面板内执行检索。关键词与媒体标题分离，允许用户使用别名
   * 重搜，同时仍把最终资源保存到原来的媒体卡片。
   */
  const searchResources = async (keyword: string, force = false, category = currentMedia.value?.category) => {
    const normalizedKeyword = keyword.trim();
    if (!currentMedia.value || !normalizedKeyword) return;
    const sequence = ++searchSequence;
    engine.cancelPending();
    const cached = engine.cachedResult(normalizedKeyword);
    if (currentMedia.value.id?.startsWith('search-') && !currentMedia.value.quarkFid && !currentMedia.value.catalogId) {
      currentMedia.value = { ...currentMedia.value, title: normalizedKeyword, category: category || currentMedia.value.category };
    }
    searchKeyword.value = normalizedKeyword;
    isOpen.value = true;
    isAnalyzing.value = !cached;
    searchError.value = '';
    searchNotice.value = cached ? '已显示最近的搜索结果，正在更新…' : '';
    searchPending.value = true;
    quarkResources.value = cached?.quarkItems || [];

    try {
      const res = await engine.search(normalizedKeyword, { force });
      if (sequence !== searchSequence || !isOpen.value) return;
      const progress: SearchProgress = {
        tasks: new Set(),
        supplemented: false,
        notice: res.message || '',
        error: res.success ? '' : res.message || '资源检索服务暂时不可用，请稍后重试'
      };
      if (res.success) quarkResources.value = res.quarkItems.length ? res.quarkItems : res.items.filter(i => i.driveType === 'quark');
      else if (res.allowPublicFallback === false) quarkResources.value = [];
      if (res.refreshing) progress.tasks.add('server');
      if (res.allowPublicFallback !== false && (!res.success || !res.total || Boolean(res.partial || res.stale))) progress.tasks.add('public');
      const hasMainCandidate = quarkResources.value.some(item => {
        const match = matchResource(normalizedKeyword, item.title, category);
        return match.matches && !match.otherVersion;
      });
      if (category && res.allowPublicFallback !== false && !hasMainCandidate && refinedResourceQuery(normalizedKeyword, category)) progress.tasks.add('refine');
      showProgress(progress);
      if (progress.tasks.has('server')) void followSearch(normalizedKeyword, sequence, progress);
      if (progress.tasks.has('public')) void supplementSearch(normalizedKeyword, sequence, progress, force);
      if (progress.tasks.has('refine') && category) void refineSearch(normalizedKeyword, category, sequence, progress);
      if (!res.success && !progress.tasks.size) toast.show(progress.error, '!', 3800);
    } catch (error) {
      if (sequence !== searchSequence || !isOpen.value) return;
      searchError.value = error instanceof Error ? error.message : '资源检索失败，请稍后重试';
      searchPending.value = false;
      toast.show(searchError.value, '!', 3800);
    } finally {
      if (sequence === searchSequence) isAnalyzing.value = false;
    }
  };

  /**
   * 打开网盘分析与转存面板
   */
  const openTransferModal = async (media: MediaItem) => {
    currentMedia.value = media;
    await searchResources(media.title);
  };

  const closeTransferModal = () => {
    searchSequence += 1;
    engine.cancelPending();
    isOpen.value = false;
    isAnalyzing.value = false;
    searchError.value = '';
    searchNotice.value = '';
    searchPending.value = false;
    searchKeyword.value = '';
  };

  const retrySearch = () => {
    if (currentMedia.value && !isAnalyzing.value) {
      void searchResources(searchKeyword.value || currentMedia.value.title, true);
    }
  };

  const refreshResources = (keyword: string, category?: CategoryType) => searchResources(keyword, true, category);
  if (getCurrentScope()) onScopeDispose(closeTransferModal);

  return {
    isOpen,
    isAnalyzing,
    currentMedia,
    quarkResources,
    searchError,
    searchNotice,
    searchPending,
    searchKeyword,
    openTransferModal,
    refreshResources,
    closeTransferModal,
    retrySearch
  };
}
