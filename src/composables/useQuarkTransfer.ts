import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { MediaItem } from '../types/media';
import type { ResourceItem, SearchCategory } from '../types/search';
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
  const searchCategory = ref<SearchCategory>('all');
  let searchSequence = 0;

  const searchResources = async (keyword: string, category: SearchCategory = searchCategory.value) => {
    const clean = keyword.trim();
    if (!currentMedia.value || !clean) return;
    const sequence = ++searchSequence;
    engine.cancelPending();
    if (currentMedia.value.id?.startsWith('search-') && !currentMedia.value.quarkFid && !currentMedia.value.catalogId) {
      currentMedia.value = { ...currentMedia.value, title: clean, category: category === 'all' ? currentMedia.value.category : category };
    }
    searchKeyword.value = clean;
    searchCategory.value = category;
    isOpen.value = true;
    isAnalyzing.value = true;
    searchPending.value = true;
    searchError.value = ''; searchNotice.value = ''; quarkResources.value = [];
    try {
      const result = await engine.search(clean, category);
      if (sequence !== searchSequence || !isOpen.value) return;
      if (result.success) {
        quarkResources.value = result.quarkItems;
        searchNotice.value = result.message || '';
      } else searchError.value = result.message || '搜索失败，请重试';
    } catch { if (sequence === searchSequence && isOpen.value) searchError.value = '搜索失败，请重试'; }
    finally { if (sequence === searchSequence) { isAnalyzing.value = false; searchPending.value = false; } }
  };

  const openTransferModal = async (media: MediaItem, category: SearchCategory = media.category) => { currentMedia.value = media; await searchResources(media.title, category); };
  const closeTransferModal = () => {
    searchSequence++; engine.cancelPending();
    isOpen.value = false; isAnalyzing.value = false; searchPending.value = false;
    searchError.value = ''; searchNotice.value = ''; searchKeyword.value = ''; quarkResources.value = [];
  };
  const retrySearch = () => { if (currentMedia.value && !searchPending.value) void searchResources(searchKeyword.value || currentMedia.value.title); };
  const refreshResources = (keyword: string, category?: SearchCategory) => searchResources(keyword, category);
  if (getCurrentScope()) onScopeDispose(closeTransferModal);
  return { isOpen, isAnalyzing, currentMedia, quarkResources, searchError, searchNotice, searchPending, searchKeyword, searchCategory,
    openTransferModal, refreshResources, closeTransferModal, retrySearch };
}
