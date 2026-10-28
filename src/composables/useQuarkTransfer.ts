import { ref } from 'vue';
import type { MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';
import { SilentSearchEngine } from '../services/silentSearchEngine';
import { useToast } from './useToast';

const engine = new SilentSearchEngine();

export function useQuarkTransfer() {
  const toast = useToast();

  const isOpen = ref(false);
  const isAnalyzing = ref(false);
  const currentMedia = ref<MediaItem | null>(null);
  const quarkResources = ref<ResourceItem[]>([]);
  const searchError = ref('');
  const searchNotice = ref('');
  const searchPending = ref(false);
  const searchKeyword = ref('');
  let searchSequence = 0;

  interface SearchProgress { server: boolean; public: boolean; supplemented: boolean; notice: string; error: string }
  const isCurrent = (sequence: number) => sequence === searchSequence && isOpen.value;
  const candidates = new Map<string, ResourceItem>();
  const rejected = new Set<string>();
  let candidateRevision = 0;
  let validationRunning = false;
  let activeProgress: SearchProgress | null = null;
  let forceValidation = false;
  let invalidCount = 0;
  const showProgress = (progress: SearchProgress) => {
    searchPending.value = progress.server || progress.public || validationRunning;
    searchError.value = !quarkResources.value.length && !searchPending.value ? progress.error : '';
    searchNotice.value = validationRunning ? '正在检查资源内容…'
      : invalidCount ? `已排除 ${invalidCount} 条不可用资源`
        : searchPending.value ? quarkResources.value.length ? '已显示当前候选，正在补充其他来源…' : '正在继续搜索，找到结果后会自动显示…'
          : progress.supplemented ? '已通过备用来源补充候选' : progress.notice;
  };
  const validateCandidates = async (sequence: number) => {
    if (validationRunning || !isCurrent(sequence)) return;
    validationRunning = true;
    if (activeProgress) showProgress(activeProgress);
    const deadline = Date.now() + 30_000;
    try {
      while (isCurrent(sequence) && Date.now() < deadline) {
        const batch = [...candidates.values()];
        const revision = candidateRevision;
        const force = forceValidation; forceValidation = false;
        const result = await engine.validateResources(batch, force);
        if (!isCurrent(sequence)) return;
        const statuses = new Map(result.entries.map(entry => [entry.url, entry]));
        const visible: ResourceItem[] = [];
        for (const item of candidates.values()) {
          const entry = statuses.get(item.url);
          if (!entry || entry.password !== (item.password || '')) continue;
          if (entry.status === 'unavailable' || entry.status === 'deferred') { rejected.add(item.url); candidates.delete(item.url); continue; }
          if (entry.status !== 'pending') visible.push({ ...item, linkStatus: entry.status });
        }
        invalidCount = rejected.size;
        quarkResources.value = visible;
        if (activeProgress) showProgress(activeProgress);
        if (!result.pending && revision === candidateRevision) break;
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
    } catch (error) {
      if (isCurrent(sequence)) {
        searchSequence++; validationRunning = false; searchPending.value = false; activeProgress = null;
        quarkResources.value = [];
        searchError.value = error instanceof Error ? error.message : '链接校验失败';
      }
    } finally {
      if (isCurrent(sequence)) { validationRunning = false; if (activeProgress) showProgress(activeProgress); }
    }
  };
  const append = (items: ResourceItem[]) => {
    for (const item of items) {
      if (rejected.has(item.url) || (!candidates.has(item.url) && candidates.size >= 100)) continue;
      const previous = candidates.get(item.url);
      candidates.set(item.url, { ...item, password: item.password || previous?.password });
    }
    candidateRevision++;
    void validateCandidates(searchSequence);
  };
  const rejectResource = (url: string) => {
    rejected.add(url); candidates.delete(url); candidateRevision++;
    quarkResources.value = quarkResources.value.filter(item => item.url !== url);
    invalidCount = rejected.size;
    if (activeProgress) showProgress(activeProgress);
    toast.show('已移除不可用片源', '!', 2800);
  };
  const supplementSearch = async (keyword: string, sequence: number, progress: SearchProgress, force: boolean) => {
    try {
      const result = await engine.supplement(keyword, { force });
      if (!isCurrent(sequence)) return;
      if (result.success) {
        const before = candidates.size;
        append(result.quarkItems);
        progress.supplemented = candidates.size > before;
      }
    } finally {
      if (isCurrent(sequence)) {
        progress.public = false;
        showProgress(progress);
      }
    }
  };
  const followSearch = async (keyword: string, sequence: number, progress: SearchProgress) => {
    const deadline = Date.now() + 35_000;
    for (let attempt = 0; attempt < 35 && Date.now() < deadline; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      if (!isCurrent(sequence)) return;
      try {
        const result = await engine.readCached(keyword);
        if (!isCurrent(sequence)) return;
        if (!result) break;
        append(result.quarkItems);
        progress.notice = result.message || '';
        progress.server = Boolean(result.refreshing);
        showProgress(progress);
        if (!result.refreshing) return;
      } catch { break; }
    }
    if (isCurrent(sequence)) {
      progress.server = false;
      progress.notice = quarkResources.value.length
        ? '已展示当前候选；其余来源暂未返回，可稍后重新搜索'
        : '本轮未取得可用候选，来源可能超时；可稍后重新搜索';
      showProgress(progress);
    }
  };

  /**
   * 在当前资源面板内执行检索。关键词与媒体标题分离，允许用户使用别名
   * 重搜，同时仍把最终资源保存到原来的媒体卡片。
   */
  const searchResources = async (keyword: string, force = false) => {
    const normalizedKeyword = keyword.trim();
    if (!currentMedia.value || !normalizedKeyword) return;
    if (!currentMedia.value.quarkFid && currentMedia.value.title !== normalizedKeyword) {
      currentMedia.value = { ...currentMedia.value, title: normalizedKeyword, poster: '', catalogId: undefined, year: undefined, desc: '' };
    }
    const sequence = ++searchSequence;
    searchKeyword.value = normalizedKeyword;
    isOpen.value = true;
    isAnalyzing.value = true;
    searchError.value = '';
    searchNotice.value = '';
    searchPending.value = false;
    quarkResources.value = [];
    candidates.clear(); rejected.clear(); candidateRevision++;
    validationRunning = false; activeProgress = null; invalidCount = 0; forceValidation = force;

    try {
      const res = await engine.search(normalizedKeyword, { force });
      if (sequence !== searchSequence || !isOpen.value) return;
      const progress: SearchProgress = {
        server: Boolean(res.refreshing),
        public: res.allowPublicFallback !== false && (!res.success || !res.total || Boolean(res.partial || res.stale)),
        supplemented: false,
        notice: res.message || '',
        error: res.success ? '' : res.message || '资源检索服务暂时不可用，请稍后重试'
      };
      activeProgress = progress;
      if (res.success) append(res.quarkItems.length ? res.quarkItems : res.items.filter(i => i.driveType === 'quark'));
      showProgress(progress);
      if (progress.server) void followSearch(normalizedKeyword, sequence, progress);
      if (progress.public) void supplementSearch(normalizedKeyword, sequence, progress, force);
      if (!res.success && !progress.public) toast.show(progress.error, '!', 3800);
    } catch (error) {
      if (sequence !== searchSequence || !isOpen.value) return;
      searchError.value = error instanceof Error ? error.message : '资源检索失败，请稍后重试';
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
    isOpen.value = false;
    isAnalyzing.value = false;
    searchError.value = '';
    searchNotice.value = '';
    searchPending.value = false;
    searchKeyword.value = '';
  };

  const openResourceSearch = (media:MediaItem) => {
    closeTransferModal();candidates.clear();rejected.clear();activeProgress=null;validationRunning=false;
    currentMedia.value=media;quarkResources.value=[];isOpen.value=true;
  };

  const openShare = (media:MediaItem,resource:ResourceItem) => {
    closeTransferModal();candidates.clear();rejected.clear();activeProgress=null;validationRunning=false;
    currentMedia.value=media;quarkResources.value=[resource];searchKeyword.value='';isOpen.value=true;
  };

  const retrySearch = () => {
    if (currentMedia.value && !isAnalyzing.value) {
      void searchResources(searchKeyword.value || currentMedia.value.title, true);
    }
  };

  const refreshResources = (keyword: string) => searchResources(keyword, true);

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
    openResourceSearch,
    openShare,
    refreshResources,
    closeTransferModal,
    retrySearch,
    rejectResource
  };
}
