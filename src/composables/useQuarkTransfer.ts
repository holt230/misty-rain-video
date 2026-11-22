import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { MediaItem } from '../types/media';
import type { OfficialWorkProgress, ResourceItem, SearchCategory } from '../types/search';
import { SilentSearchEngine } from '../services/silentSearchEngine';
import { QuarkStreamService } from '../services/quarkStreamService';
import { verifySearchResults } from '../services/verifySearchResults';
import { searchIntent } from '../services/searchIntent';
import { isExactWorkTitle } from '../../server/searchTitles.js';
import { chooseOfficialProgress, readOfficialProgress } from '../services/officialProgress';

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
  const officialProgress = ref<OfficialWorkProgress>();
  const officialCheckedAt = ref('');
  const officialNotice = ref('');
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
    const sameWork = (isExactWorkTitle(currentMedia.value.title, intent.title) || isExactWorkTitle(intent.title, currentMedia.value.title))
      && (category === 'all' || category === currentMedia.value.category);
    if (!sameWork) {
      currentMedia.value = { id: `search-${sequence}`, title: intent.title, category: category === 'all' ? currentMedia.value.category : category, tag: '', poster: '' };
    }
    if (currentMedia.value.id?.startsWith('search-') && !currentMedia.value.quarkFid && !currentMedia.value.catalogId) {
      currentMedia.value = { ...currentMedia.value, title: intent.title, category: category === 'all' ? currentMedia.value.category : category };
    }
    searchKeyword.value = clean;
    searchCategory.value = category;
    isOpen.value = true;
    isAnalyzing.value = true;
    searchPhase.value = 'searching'; verificationProgress.value = ''; searchNeedsAuth.value = false;
    officialProgress.value = undefined; officialCheckedAt.value = ''; officialNotice.value = '';
    searchPending.value = true;
    searchError.value = ''; searchNotice.value = ''; quarkResources.value = [];
    try {
      const [result, official] = await Promise.all([engine.search(intent.title, category), readOfficialProgress(intent.title, category, verification.signal)]);
      if (sequence !== searchSequence || !isOpen.value) return;
      officialProgress.value = chooseOfficialProgress(official, intent.title, category, result.quarkItems, currentMedia.value?.year);
      officialCheckedAt.value = official.checkedAt;
      officialNotice.value = officialProgress.value ? '' : official.message || '官方有多个作品版本，暂未确认对应的更新进度。';
      if (result.success) {
        if (!result.quarkItems.length) { searchNotice.value = `当前片源里没找到《${intent.title}》${intent.episode ? `第 ${intent.episode} 集` : ''}。`; return; }
        searchPhase.value = 'verifying';
        const checked = await verifySearchResults(result.quarkItems, { title: intent.title, category, year: currentMedia.value?.year, episode: intent.episode,
          officialLatest: officialProgress.value?.latestEpisode,
          signal: verification.signal,
          inspect: (resource, signal) => QuarkStreamService.getShareDetails(resource.url, resource.password || '', signal),
          progress: message => { if (sequence === searchSequence) verificationProgress.value = message; }
        });
        if (sequence !== searchSequence || !isOpen.value) return;
        quarkResources.value = checked.resources;
        searchNotice.value = checked.message || (checked.resources.length && result.partial ? '已显示核对通过的资源，部分来源暂时无法访问。' : '');
        searchError.value = checked.error || ''; searchNeedsAuth.value = Boolean(checked.needsAuth);
        if (!checked.resources.length && result.partial && !checked.error) {
          searchNotice.value = '';
          searchError.value = '片源查询未完成：部分来源暂时无法访问，请稍后重试。';
        }
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
    officialProgress.value = undefined; officialCheckedAt.value = ''; officialNotice.value = '';
  };
  const retrySearch = () => { if (currentMedia.value && !searchPending.value) void searchResources(searchKeyword.value || currentMedia.value.title); };
  const refreshResources = (keyword: string, category?: SearchCategory) => searchResources(keyword, category);
  if (getCurrentScope()) onScopeDispose(closeTransferModal);
  return { isOpen, isAnalyzing, currentMedia, quarkResources, searchError, searchNotice, searchPending, searchKeyword, searchCategory, searchPhase, verificationProgress, searchNeedsAuth, officialProgress, officialCheckedAt, officialNotice,
    openTransferModal, refreshResources, closeTransferModal, retrySearch };
}
