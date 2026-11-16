import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { MediaItem } from '../types/media';
import type { ResourceItem, SearchCategory } from '../types/search';
import { SilentSearchEngine } from '../services/silentSearchEngine';
import { QuarkStreamService } from '../services/quarkStreamService';
import { verifySearchResults } from '../services/verifySearchResults';
import { searchIntent } from '../services/searchIntent';

export function useQuarkTransfer() {
  const engine = new SilentSearchEngine();
  const isOpen = ref(false);
  const isAnalyzing = ref(false);
  const currentMedia = ref<MediaItem | null>(null);
  const quarkResources = ref<ResourceItem[]>([]);
  const searchError = ref('');
  const searchNotice = ref('');
  const searchPending = ref(false);
  const searchKeyword = ref('');
  const searchCategory = ref<SearchCategory>('all');
  const searchPhase = ref<'searching' | 'verifying' | 'done'>('done');
  const verificationProgress = ref('');
  const searchNeedsAuth = ref(false);
  let verificationController: AbortController | undefined;
  let searchSequence = 0;

  const searchResources = async (keyword: string, category: SearchCategory = searchCategory.value) => {
    const clean = keyword.trim();
    if (!currentMedia.value || !clean) return;
    const sequence = ++searchSequence;
    engine.cancelPending();
    verificationController?.abort();
    const verification = new AbortController(); verificationController = verification;
    const intent = searchIntent(clean);
    if (currentMedia.value.id?.startsWith('search-') && !currentMedia.value.quarkFid && !currentMedia.value.catalogId) {
      currentMedia.value = { ...currentMedia.value, title: intent.title, category: category === 'all' ? currentMedia.value.category : category };
    }
    searchKeyword.value = clean;
    searchCategory.value = category;
    isOpen.value = true;
    isAnalyzing.value = true;
    searchPhase.value = 'searching'; verificationProgress.value = ''; searchNeedsAuth.value = false;
    searchPending.value = true;
    searchError.value = ''; searchNotice.value = ''; quarkResources.value = [];
    try {
      const result = await engine.search(intent.title, category);
      if (sequence !== searchSequence || !isOpen.value) return;
      if (result.success) {
        if (!result.quarkItems.length) { searchNotice.value = `未找到《${intent.title}》${intent.episode ? `第 ${intent.episode} 集` : ''}的可用资源。`; return; }
        searchPhase.value = 'verifying';
        const checked = await verifySearchResults(result.quarkItems, { title: intent.title, category, year: currentMedia.value?.year, episode: intent.episode,
          signal: verification.signal,
          inspect: (resource, signal) => QuarkStreamService.getShareDetails(resource.url, resource.password || '', signal),
          progress: message => { if (sequence === searchSequence) verificationProgress.value = message; }
        });
        if (sequence !== searchSequence || !isOpen.value) return;
        quarkResources.value = checked.resources; searchNotice.value = checked.message;
        searchError.value = checked.error || ''; searchNeedsAuth.value = Boolean(checked.needsAuth);
      } else searchError.value = result.message || '搜索失败，请重试';
    } catch { if (sequence === searchSequence && isOpen.value) searchError.value = '搜索失败，请重试'; }
    finally { if (sequence === searchSequence) { isAnalyzing.value = false; searchPending.value = false; searchPhase.value = 'done'; } }
  };

  const openTransferModal = async (media: MediaItem, category: SearchCategory = media.category) => { currentMedia.value = media; await searchResources(media.title, category); };
  const closeTransferModal = () => {
    searchSequence++; engine.cancelPending();
    verificationController?.abort(); verificationController = undefined;
    isOpen.value = false; isAnalyzing.value = false; searchPending.value = false;
    searchError.value = ''; searchNotice.value = ''; searchKeyword.value = ''; quarkResources.value = [];
    searchPhase.value = 'done'; verificationProgress.value = ''; searchNeedsAuth.value = false;
  };
  const retrySearch = () => { if (currentMedia.value && !searchPending.value) void searchResources(searchKeyword.value || currentMedia.value.title); };
  const refreshResources = (keyword: string, category?: SearchCategory) => searchResources(keyword, category);
  if (getCurrentScope()) onScopeDispose(closeTransferModal);
  return { isOpen, isAnalyzing, currentMedia, quarkResources, searchError, searchNotice, searchPending, searchKeyword, searchCategory, searchPhase, verificationProgress, searchNeedsAuth,
    openTransferModal, refreshResources, closeTransferModal, retrySearch };
}
