import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { CategoryType, MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';
import { SilentSearchEngine } from '../services/silentSearchEngine';

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
  let searchSequence = 0;

  const searchResources = async (keyword: string, category = currentMedia.value?.category) => {
    const clean = keyword.trim();
    if (!currentMedia.value || !clean) return;
    const sequence = ++searchSequence;
    engine.cancelPending();
    if (currentMedia.value.id?.startsWith('search-') && !currentMedia.value.quarkFid && !currentMedia.value.catalogId) {
      currentMedia.value = { ...currentMedia.value, title: clean, category: category || currentMedia.value.category };
    }
    searchKeyword.value = clean;
    isOpen.value = true;
    isAnalyzing.value = true;
    searchPending.value = true;
    searchError.value = ''; searchNotice.value = ''; quarkResources.value = [];
    try {
      const result = await engine.search(clean);
      if (sequence !== searchSequence || !isOpen.value) return;
      if (result.success) {
        quarkResources.value = result.quarkItems;
        searchNotice.value = result.message || '';
      } else searchError.value = result.message || '搜索失败，请重试';
    } catch { if (sequence === searchSequence && isOpen.value) searchError.value = '搜索失败，请重试'; }
    finally { if (sequence === searchSequence) { isAnalyzing.value = false; searchPending.value = false; } }
  };

  const openTransferModal = async (media: MediaItem) => { currentMedia.value = media; await searchResources(media.title); };
  const closeTransferModal = () => {
    searchSequence++; engine.cancelPending();
    isOpen.value = false; isAnalyzing.value = false; searchPending.value = false;
    searchError.value = ''; searchNotice.value = ''; searchKeyword.value = ''; quarkResources.value = [];
  };
  const retrySearch = () => { if (currentMedia.value && !searchPending.value) void searchResources(searchKeyword.value || currentMedia.value.title); };
  const refreshResources = (keyword: string, category?: CategoryType) => searchResources(keyword, category);
  if (getCurrentScope()) onScopeDispose(closeTransferModal);
  return { isOpen, isAnalyzing, currentMedia, quarkResources, searchError, searchNotice, searchPending, searchKeyword,
    openTransferModal, refreshResources, closeTransferModal, retrySearch };
}
