<script setup lang="ts">
import { shallowRef, computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RefreshCw } from '@lucide/vue';
import LoginScreen from './components/auth/LoginScreen.vue';
import AccountPage from './components/auth/AccountPage.vue';
import { QuarkStreamService, type QuarkPlaybackSession, type QuarkEpisode } from './services/quarkStreamService';
import { replacementEpisodeIndex } from './services/playbackNavigation';
import PageLoadState from './components/common/PageLoadState.vue';
import {h,defineComponent} from 'vue';
import {useClipboardShare,type ClipboardShare} from './composables/useClipboardShare';
import {dialogOpenCount} from './composables/useDialog';
import ClipboardNotice from './components/common/ClipboardNotice.vue';
import LoadingSkeleton from './components/common/LoadingSkeleton.vue';
import PullToRefresh from './components/common/PullToRefresh.vue';
import BackToTop from './components/common/BackToTop.vue';
import {defaultBrowseState,parseBrowseRoute,browseRoute as catalogBrowseRoute,type BrowseState} from './services/browseRoute';
import ListSearch from './components/common/ListSearch.vue';
import Navbar from './components/layout/Navbar.vue';
import MobileTabBar, { type MobileTab as MobileDockTab } from './components/layout/MobileTabBar.vue';
import CategoryTabs from './components/media/CategoryTabs.vue';
import MediaGrid from './components/media/MediaGrid.vue';
import DiscoveryPage from './components/media/DiscoveryPage.vue';
import CatalogSearchPage from './components/media/CatalogSearchPage.vue';
import { subjectIdFromHash } from './services/catalogDetails';
import { savePlaybackPage, loadPlaybackPage, clearPlaybackPages } from './services/playbackNavigation';
import { discoveryMedia, resourcePlaybackMedia, type DiscoveryItem } from './services/discoveryService';
import DeleteMediaConfirm from './components/media/DeleteMediaConfirm.vue';
import CategoryPickerSheet from './components/media/CategoryPickerSheet.vue';
import MediaActionSheet from './components/media/MediaActionSheet.vue';
import MediaTitleEditor from './components/media/MediaTitleEditor.vue';
import Toast from './components/common/Toast.vue';
import { useMediaList } from './composables/useMediaList';
import { useQuarkTransfer } from './composables/useQuarkTransfer';
import { useAuth } from './composables/useAuth';
import { useToast } from './composables/useToast';
import { usePlaybackHistory } from './composables/usePlaybackHistory';
import { MediaStore } from './services/mediaStore';
import { sameMediaIdentity } from './services/historyIdentity';
import {playbackSourceCache} from './services/playbackSourceCache';
import { getLibrarySaveFeedback, type LibrarySaveFeedback } from './services/libraryFeedback';
import type { MediaItem, CategoryType, PlaybackHistoryEntry } from './types/media';
import type { ResourceItem } from './types/search';

// HLS 播放器和资源检索面板只会在用户主动打开时使用；按需加载可显著
// 缩小移动端首屏 JS，避免登录后先下载整个播放器运行时。
const loadingView=(variant:'cards'|'rows'|'detail'|'player',overlay=false)=>defineComponent({props:{error:Object},setup:props=>()=>h(PageLoadState,{variant,overlay,error:props.error as Error|undefined})});
const CatalogBrowsePage=defineAsyncComponent({loader:()=>import('./components/media/CatalogBrowsePage.vue'),loadingComponent:loadingView('cards'),errorComponent:PageLoadState,delay:0});
const HistoryPage = defineAsyncComponent({
  loader: () => import('./components/media/HistoryPage.vue'),
  loadingComponent: loadingView('cards'), errorComponent: PageLoadState, delay: 0
});
const FilmDetailPage = defineAsyncComponent({
  loader: () => import('./components/media/FilmDetailPage.vue'),
  loadingComponent: loadingView('detail'), errorComponent: PageLoadState, delay: 0
});
const QuarkTransferModal = defineAsyncComponent({
  loader: () => import('./components/quark/QuarkTransferModal.vue'),
  loadingComponent:loadingView('rows',true),errorComponent:loadingView('rows',true),
  delay: 0,
  suspensible: false
});
const PlayerPage = defineAsyncComponent({
  loader: () => import('./components/player/PlayerPage.vue'),
  loadingComponent:loadingView('player'),errorComponent:loadingView('player'),
  delay: 0,
  suspensible: false
});

const { user, authenticated, checking, loggingIn, errorMessage, login, logout } = useAuth();
const toast = useToast();
const { history, historyError, loadingHistory, deletingHistoryId, refreshHistory, updateLocalHistory, removeHistory, removeHistoryBatch, removeLocalMediaHistory } = usePlaybackHistory(authenticated);
const isEmbedPlayerOpen = ref(false);
const restoringPlayer = ref(false);
const loggingOut=ref(false);
const discoveryImmersive = ref(true);
const libraryQuery=ref('');
const librarySearch=ref<InstanceType<typeof ListSearch>|null>(null);
const historySelecting=ref(false);
const historyPageRef=ref<{focusSearch:()=>void}|null>(null);
type RefreshablePage={refresh:()=>Promise<unknown>};
const discoveryPageRef=ref<RefreshablePage|null>(null),browsePageRef=ref<RefreshablePage|null>(null),catalogPageRef=ref<RefreshablePage|null>(null);
const isRefreshingLibrary=ref(false);

const {
  currentCategory,
  mediaList,
  enrichedMediaList,
  allMediaList,
  isLoading,
  loadError,
  categoryCounts,
  categoryNames,
  saveMedia,
  removeMedia,
  updateMediaCategory,
  updateMediaTitle,
  refreshList,
  setLibraryUpdates
} = useMediaList(authenticated, isEmbedPlayerOpen);

const {
  isOpen: isTransferOpen,
  isAnalyzing,
  currentMedia: selectedMedia,
  quarkResources,
  searchError,
  searchNotice,
  searchPending,
  searchKeyword,
  openTransferModal,
  openResourceSearch,
  openShare,
  closeTransferModal,
  retrySearch,
  refreshResources,
  rejectResource
} = useQuarkTransfer();

const navbarRef = ref<InstanceType<typeof Navbar> | null>(null);
const embedPlayingMedia = ref<MediaItem | null>(null);
const accountPageRef = ref<InstanceType<typeof AccountPage> | null>(null);
const deletingMedia = ref<MediaItem | null>(null);
const isDeletingMedia = ref(false);
const categoryMedia = ref<MediaItem | null>(null);
const isSavingCategory = ref(false);
const isSavingTransfer = ref(false);
const savingResourceId = ref('');
const saveError = ref<LibrarySaveFeedback | null>(null);
const failedResourceId = ref('');
const actionMedia = ref<MediaItem | null>(null);
const titleMedia = ref<MediaItem | null>(null);
const isSavingTitle = ref(false);
const titleError = ref('');
const searchedLibrary=computed(()=>libraryQuery.value.trim() ? enrichedMediaList.value.filter(item=>`${item.title} ${item.latestEpisodeTitle || ''}`.toLocaleLowerCase().includes(libraryQuery.value.trim().toLocaleLowerCase())) : mediaList.value);
const displayHistory = computed(() => history.value.map(entry => {
  const media = allMediaList.value.find(item => sameMediaIdentity(item, entry.media));
  return media ? { ...entry, media: { ...entry.media, ...media } } : entry;
}));
type MobileTab = MobileDockTab | 'search' | 'catalog' | 'detail' | 'browse';
const browseState=ref<BrowseState>(defaultBrowseState());
const browseVisited=ref(false);
const detailId = ref('');
const detailSeed = shallowRef<DiscoveryItem | null>(null);
const detailOrigin = ref<'discover' | 'catalog' | 'browse'>('discover');
const detailHasParent = ref(false);
const detailCollection = computed(() => allMediaList.value.find(item => item.catalogId === detailId.value));
const catalogQuery = ref('');
const playbackPageKey = ref('');
const preparedPageSession = shallowRef<{ key: string; session: QuarkPlaybackSession } | null>(null);
const mobileTab = ref<MobileTab>('discover');
const lastContentTab = ref<'discover' | 'library' | 'history' | 'catalog' | 'browse'>('discover');
const searchOrigin = ref<Exclude<MobileTab, 'search'>>('discover');
const searchOriginScrollY = ref(0);
const currentPage = computed(() => mobileTab.value === 'search' ? searchOrigin.value : mobileTab.value);
const selectedHistoryEntry = ref<PlaybackHistoryEntry | null>(null);
const isCheckingUpdates = ref(false);
const isApplyingUpdates = ref(false);
let autoCheckedUsername = '';
type AppHistoryLayer = 'browse' | 'detail' | 'catalog' | 'history' | 'discover' | 'library' | 'search' | 'account' | 'player' | 'transfer' | 'delete' | 'category' | 'actions' | 'title';
let handlingPopState = false;

const historyEnabled = () => typeof window !== 'undefined';
const currentHistoryLayer = () => window.history.state?.mistyRainLayer as AppHistoryLayer | undefined;

const setAppHistoryLayer = (layer: AppHistoryLayer, replace = false) => {
  if (!historyEnabled() || handlingPopState) return;
  const state = { mistyRainLayer: layer, query: catalogQuery.value, category: currentCategory.value,browseRoute:catalogBrowseRoute(browseState.value),
    playbackKey: layer === 'player' ? playbackPageKey.value : '', detailOrigin: detailOrigin.value, detailHasParent: detailHasParent.value,
    scrollY: layer === 'search' ? searchOriginScrollY.value : 0,
    ...(layer === 'search' ? { searchOrigin: searchOrigin.value } : {}) };
  const hash = layer === 'player' ? `#/watch/${playbackPageKey.value}`
    : layer === 'detail' ? `#/subject/${detailId.value}`
    : layer === 'catalog' ? `#/search?q=${encodeURIComponent(catalogQuery.value)}`
    : layer === 'browse' ? catalogBrowseRoute(browseState.value)
    : ['discover', 'library', 'history', 'account'].includes(layer) ? `#/${layer}` : window.location.hash;
  if (replace || (currentHistoryLayer() === layer && layer !== 'player' && layer !== 'detail')) window.history.replaceState(state, '', hash);
  else {
    window.history.replaceState({ ...window.history.state, scrollY: window.scrollY }, '');
    window.history.pushState(state, '', hash);
  }
};

// Category tabs reuse the library route. Keep its existing history entry in sync
// so returning from playback or a sheet restores the category the user left.
watch(currentCategory, category => {
  if (!historyEnabled() || handlingPopState || isEmbedPlayerOpen.value || currentHistoryLayer() !== 'library') return;
  window.history.replaceState({ ...window.history.state, category }, '');
}, { flush: 'sync' });

const restorePage = async (state = window.history.state) => {
  const owner = user.value?.username; if (!owner) return;
  const watchKey = window.location.hash.match(/^#\/watch\/([a-zA-Z0-9-]+)$/)?.[1];
  if (watchKey) {
    const saved = loadPlaybackPage(owner, watchKey);
    if (saved) {
      if(isEmbedPlayerOpen.value&&playbackPageKey.value===watchKey){
        if(state?.mistyRainLayer==='transfer')void openTransferModal(embedPlayingMedia.value!);
        return;
      }
      playbackPageKey.value = watchKey; embedPlayingMedia.value = saved.media;
      selectedHistoryEntry.value = history.value.find(entry => sameMediaIdentity(entry.media, saved.media)) || saved.historyEntry;
      isEmbedPlayerOpen.value = true;
      window.history.replaceState({ ...state, mistyRainLayer: 'player', playbackKey: watchKey }, '');
      window.scrollTo({ top: 0, behavior: 'instant' }); return;
    }
  }
  isEmbedPlayerOpen.value = false;
  const layer = state?.mistyRainLayer;
  const restoringSearch = layer === 'search';
  const storedSearchOrigin = ['discover', 'library', 'history', 'catalog', 'detail', 'account','browse'].includes(state?.searchOrigin)
    ? state.searchOrigin as Exclude<MobileTab, 'search'> : undefined;
  const contentLayer = restoringSearch ? storedSearchOrigin : layer;
  const search = window.location.hash.match(/^#\/search\?(.*)$/);
  const browse=parseBrowseRoute(window.location.hash);
  const storedBrowse=browse||parseBrowseRoute(state?.browseRoute);if(storedBrowse)browseState.value=storedBrowse;
  const subjectId = subjectIdFromHash(window.location.hash);
  if (subjectId) {
    detailId.value = subjectId; mobileTab.value = 'detail';
    detailOrigin.value = state?.detailOrigin === 'browse' ? 'browse' : state?.detailOrigin === 'catalog' ? 'catalog' : 'discover';
    detailHasParent.value = state?.detailHasParent === true;
    lastContentTab.value = detailOrigin.value;
    if (layer !== 'detail' && !restoringSearch) window.history.replaceState({ ...state, mistyRainLayer: 'detail' }, '');
  }
  else if(browse){
    mobileTab.value='browse';browseVisited.value=true;
    if(layer!=='browse'&&!restoringSearch)window.history.replaceState({...state,mistyRainLayer:'browse'},'');
  }
  else if (search) { catalogQuery.value = (new URLSearchParams(search[1]).get('q') || '').slice(0,100); mobileTab.value = 'catalog'; }
  else if (['discover','library','history','account','catalog','browse'].includes(contentLayer)) mobileTab.value = contentLayer;
  else mobileTab.value = window.location.hash === '#/library' ? 'library' : window.location.hash === '#/account' ? 'account' : window.location.hash === '#/history' ? 'history' : 'discover';
  if (state?.query) catalogQuery.value = state.query;
  if (['tv','movie','anime','variety'].includes(state?.category)) currentCategory.value = state.category;
  if (['discover','library','history','catalog','browse'].includes(mobileTab.value)) lastContentTab.value = mobileTab.value as 'discover' | 'library' | 'history' | 'catalog' | 'browse';
  if (restoringSearch) {
    // Search overlays the resolved route, including detail/account. Restoring its
    // hash must not consume the search history entry or remount the underlying page.
    searchOrigin.value = mobileTab.value as Exclude<MobileTab, 'search'>;
    searchOriginScrollY.value = Number.isFinite(state?.scrollY) ? Math.max(0, state.scrollY) : 0;
    mobileTab.value = 'search';
  }
  await nextTick();
  if (watchKey) { toast.show('播放页已失效，请重新选择影片', '!'); setAppHistoryLayer('discover', true); }
  else if (!layer) setAppHistoryLayer(mobileTab.value as AppHistoryLayer, true);
  window.scrollTo({ top: state?.scrollY || 0, behavior: 'instant' });
};

const openPlayerPage = (replace = false, prepared?: QuarkPlaybackSession) => {
  if (!embedPlayingMedia.value || !user.value) return;
  playbackSourceCache.open(user.value.username,embedPlayingMedia.value);
  playbackPageKey.value = savePlaybackPage(user.value.username, embedPlayingMedia.value, selectedHistoryEntry.value);
  preparedPageSession.value = prepared ? { key: playbackPageKey.value, session: prepared } : null;
  isEmbedPlayerOpen.value = true;
  setAppHistoryLayer('player', replace);
  window.scrollTo({ top: 0, behavior: 'instant' });
};

const requestLayerClose = (layer: AppHistoryLayer, closeDirectly: () => void) => {
  if (historyEnabled() && !handlingPopState && currentHistoryLayer() === layer) {
    window.history.back();
    return;
  }
  closeDirectly();
};

const handlePopState = async (event: PopStateEvent) => {
  if (isSavingTransfer.value || isDeletingMedia.value || isSavingCategory.value || isSavingTitle.value) {
    setAppHistoryLayer(isSavingTitle.value ? 'title' : isTransferOpen.value ? 'transfer' : isDeletingMedia.value ? 'delete' : 'category'); return;
  }
  handlingPopState = true;
  closeTransferModal(); deletingMedia.value = null; categoryMedia.value = null; titleMedia.value = null; actionMedia.value = null;
  await restorePage(event.state);
  handlingPopState = false;
};

onMounted(() => {
  window.addEventListener('popstate', handlePopState);
});

onBeforeUnmount(() => window.removeEventListener('popstate', handlePopState));

const availableUpdateMedia = computed(() => enrichedMediaList.value.filter(media => (media.newEpisodeCount || 0) > 0));
const currentCategoryUpdateCount = computed(() => mediaList.value.filter(media => (media.newEpisodeCount || 0) > 0).length);

watch(user, async (current,previous) => {
  if(previous?.username&&previous.username!==current?.username)playbackSourceCache.clear(previous.username);
  isEmbedPlayerOpen.value = false;
  embedPlayingMedia.value = null;
  isTransferOpen.value = false;
  mobileTab.value = 'discover';
  lastContentTab.value = 'discover';
  searchOrigin.value = 'discover'; searchOriginScrollY.value = 0;browseVisited.value=false;browseState.value=defaultBrowseState();
  detailId.value = ''; detailSeed.value = null; detailHasParent.value = false;
  deletingMedia.value = null;
  categoryMedia.value = null;
  actionMedia.value = null;
  titleMedia.value = null;
  selectedHistoryEntry.value = null;
  isSavingTransfer.value = false;
  savingResourceId.value = '';
  saveError.value = null;
  failedResourceId.value = '';
  autoCheckedUsername = '';
  const owner = user.value?.username;
  restoringPlayer.value = Boolean(owner && window.location.hash.startsWith('#/watch/'));
  if (restoringPlayer.value) await refreshHistory(true);
  if (owner !== user.value?.username) return;
  if (user.value) await restorePage();
  restoringPlayer.value = false;
});

const checkLibraryUpdates = async (force = false, notify = false) => {
  if (isCheckingUpdates.value || isApplyingUpdates.value) return;
  isCheckingUpdates.value = true;
  try {
    const summary = await MediaStore.checkLibraryUpdates(force);
    setLibraryUpdates(summary.items);
    if (notify) {
      const count = summary.items.filter(item => item.newEpisodeCount > 0).length;
      const unavailableCount = summary.items.filter(item => item.updateCheckAvailable === false).length;
      const message = count
        ? `发现 ${count} 部影片有新内容${unavailableCount ? `，另有 ${unavailableCount} 部未能检查更新` : ''}`
        : unavailableCount
          ? `${unavailableCount} 部未能检查更新，请稍后重试`
          : '收藏已是最新';
      toast.show(message, count ? '↻' : unavailableCount ? '!' : '✓', 3200);
    }
  } catch (error) {
    if (notify) toast.show(error instanceof Error ? error.message : '检查更新失败', '!', 3200);
  } finally {
    isCheckingUpdates.value = false;
  }
};

const refreshLibrary = async () => {
  if(isRefreshingLibrary.value || isApplyingUpdates.value || isCheckingUpdates.value)return;
  isRefreshingLibrary.value=true;
  try { await refreshList(true); if(allMediaList.value.length)await checkLibraryUpdates(true,true); }
  finally { isRefreshingLibrary.value=false; }
};
const pullRefreshEnabled=computed(()=>authenticated.value && !restoringPlayer.value && !isEmbedPlayerOpen.value && !isTransferOpen.value && mobileTab.value!=='search' && dialogOpenCount.value===0 && !historySelecting.value && !isRefreshingLibrary.value && !isApplyingUpdates.value && !isCheckingUpdates.value && (
  currentPage.value==='library' && !isLoading.value || currentPage.value==='history' && !loadingHistory.value ||
  currentPage.value==='discover' && !!discoveryPageRef.value || currentPage.value==='browse' && !!browsePageRef.value || currentPage.value==='catalog' && !!catalogPageRef.value));
const refreshCurrentPage=async()=>{
  switch(currentPage.value){
    case 'library': await refreshLibrary();break;
    case 'history': await refreshHistory(true);break;
    case 'discover': await Promise.all([discoveryPageRef.value?.refresh(),refreshHistory(true)]);break;
    case 'browse': await browsePageRef.value?.refresh();break;
    case 'catalog': await catalogPageRef.value?.refresh();break;
  }
};

const applyLibraryUpdates = async (mediaItems: MediaItem[]) => {
  const quarkFids = mediaItems.map(item => item.quarkFid || '').filter(Boolean);
  if (!quarkFids.length || isApplyingUpdates.value || isCheckingUpdates.value) return;
  isApplyingUpdates.value = true;
  try {
    const summary = await MediaStore.applyLibraryUpdates(quarkFids);
    setLibraryUpdates(summary.items);
    await refreshList(true);
    const message = summary.transferredCount
      ? `已补充 ${summary.transferredCount} 个新正片文件${summary.failedCount ? `，${summary.failedCount} 部未完成` : ''}`
      : summary.failedCount
        ? `${summary.failedCount} 部未完成剧集补充，请稍后重试或查看具体原因`
        : '当前来源暂无待补剧集';
    toast.show(message, summary.failedCount ? '!' : '✓', 3600);
  } catch (error) {
    toast.show(error instanceof Error ? error.message : '片库更新失败', '!', 3600);
  } finally {
    isApplyingUpdates.value = false;
  }
};

watch(
  [authenticated, () => user.value?.username || '', () => allMediaList.value.length],
  ([isAuthenticated, username, itemCount]) => {
    if (!isAuthenticated || !username || !itemCount || autoCheckedUsername === username) return;
    autoCheckedUsername = username;
    void checkLibraryUpdates(false, false);
  }
);

/** 打开独立播放页。 */
const handleSelectMedia = (media: MediaItem) => {
  if (isSavingTransfer.value) { toast.show('正在添加影片，请稍候', '↻'); return; }
  const playable=playbackSourceCache.preferred(user.value?.username||'',media);
  embedPlayingMedia.value = playable;
  selectedHistoryEntry.value = history.value.find(entry => sameMediaIdentity(entry.media, playable)) || null;
  openPlayerPage();
};

const continuePlayback = (entry: PlaybackHistoryEntry) => {
  selectedHistoryEntry.value = entry;
  embedPlayingMedia.value = entry.media;
  openPlayerPage();
};

const closeEmbedPlayer = () => {
  requestLayerClose('player', () => { isEmbedPlayerOpen.value = false; navigateContent(lastContentTab.value); });
};

const closeTransferPanel = () => {
  if (isSavingTransfer.value) return;
  requestLayerClose('transfer', closeTransferModal);
};

watch(isTransferOpen, () => { saveError.value = null; failedResourceId.value = ''; });

// 换源
const handleReSearch = (media: MediaItem) => {
  if (isSavingTransfer.value) return;
  const replaceHistory = currentHistoryLayer() === 'actions';
  openTransferModal(media);
  setAppHistoryLayer('transfer', replaceHistory);
};

// 无目录匹配或主动换源时，才进入真实网盘检索。
const searchResources = (kw: string) => {
  const replaceHistory = currentHistoryLayer() === 'search';
  mobileTab.value = lastContentTab.value;
  openTransferModal({ id: 'search-' + Date.now(), title: kw, category: currentCategory.value,
    tag: '', poster: '', quarkShareUrl: '' });
  setAppHistoryLayer('transfer', replaceHistory);
};



// 保存片单
const handleSaveCard = async (media: MediaItem, targetCat?: CategoryType, bestRes?: ResourceItem, selectedFids?: string[]) => {
  if (isSavingTransfer.value) return false;
  const cat = targetCat || media.category || currentCategory.value;
  const cardToSave: MediaItem = {
    ...media,
    category: cat,
    quarkSelectionFids: selectedFids,
    tag: bestRes?.quality || media.tag || '',
    quarkQuality: bestRes?.quality || media.quarkQuality || '',
    quarkShareUrl: bestRes?.url || media.quarkShareUrl,
    quarkPasscode: bestRes?.password || media.quarkPasscode
  };
  isSavingTransfer.value = true;
  savingResourceId.value = bestRes?.id || 'direct';
  saveError.value = null;
  failedResourceId.value = '';
  try {
    await saveMedia(cardToSave);
    currentCategory.value = cat;
    mobileTab.value = 'library';
    lastContentTab.value = 'library';
    const replaceLayer = isTransferOpen.value || currentHistoryLayer() === 'search';
    closeTransferModal();
    setAppHistoryLayer('library', replaceLayer);
    return true;
  } catch (error) {
    if (bestRes && error && typeof error === 'object' && 'code' in error && error.code === 'QUARK_SHARE_UNAVAILABLE') rejectResource(bestRes.url);
    saveError.value = getLibrarySaveFeedback(error);
    failedResourceId.value = bestRes?.id || 'direct';
    return false;
  } finally {
    isSavingTransfer.value = false;
    savingResourceId.value = '';
  }
};

// 移除片单
const handleDeleteCard = (media: MediaItem) => {
  deletingMedia.value = media;
  setAppHistoryLayer('delete');
};

const openMediaActions = (media: MediaItem) => {
  if (isSavingTransfer.value) { toast.show('正在添加影片，请稍候', '↻'); return; }
  actionMedia.value = media;
  setAppHistoryLayer('actions');
};

const openCategoryPicker = (media: MediaItem) => {
  categoryMedia.value = media;
  setAppHistoryLayer('category');
};

const closeDeleteDialog = () => {
  if (!isDeletingMedia.value) requestLayerClose('delete', () => { deletingMedia.value = null; });
};

const closeCategoryPicker = () => {
  if (!isSavingCategory.value) requestLayerClose('category', () => { categoryMedia.value = null; });
};

const closeMediaActions = () => {
  requestLayerClose('actions', () => { actionMedia.value = null; });
};

const editActionMediaCategory = () => {
  const media = actionMedia.value;
  actionMedia.value = null;
  if (media) {
    categoryMedia.value = media;
    setAppHistoryLayer('category', true);
  }
};

const editActionMediaTitle = () => {
  titleMedia.value = actionMedia.value;
  actionMedia.value = null;
  titleError.value = '';
  setAppHistoryLayer('title', true);
};
const closeTitleEditor = () => {
  if (!isSavingTitle.value) requestLayerClose('title', () => { titleMedia.value = null; });
};
const saveMediaTitle = async (title: string) => {
  if (!titleMedia.value || isSavingTitle.value) return;
  if (title === titleMedia.value.title) { closeTitleEditor(); return; }
  isSavingTitle.value = true;
  titleError.value = '';
  try {
    await updateMediaTitle(titleMedia.value, title);
    requestLayerClose('title', () => { titleMedia.value = null; });
    void refreshHistory(true);
  } catch (error) {
    titleError.value = error instanceof Error ? error.message : '名称修改失败';
  } finally { isSavingTitle.value = false; }
};

const reSearchActionMedia = () => {
  const media = actionMedia.value;
  actionMedia.value = null;
  if (media) handleReSearch(media);
};

const deleteActionMedia = () => {
  const media = actionMedia.value;
  actionMedia.value = null;
  if (media) {
    deletingMedia.value = media;
    setAppHistoryLayer('delete', true);
  }
};

const updateActionMedia = () => {
  const media = actionMedia.value;
  closeMediaActions();
  if (media) void applyLibraryUpdates([media]);
};

const receivePlaybackHistory = (entry: PlaybackHistoryEntry, username?: string) => {
  if (!authenticated.value || username !== user.value?.username) return;
  updateLocalHistory(entry);
  if (isEmbedPlayerOpen.value && playbackPageKey.value && embedPlayingMedia.value
    && sameMediaIdentity(entry.media, embedPlayingMedia.value)
    && entry.media.quarkShareUrl === embedPlayingMedia.value.quarkShareUrl) {
    preparedPageSession.value = null;
    if (embedPlayingMedia.value.startEpisodeFid) embedPlayingMedia.value = { ...embedPlayingMedia.value, startEpisodeFid: undefined };
    savePlaybackPage(username!, embedPlayingMedia.value, entry, sessionStorage, playbackPageKey.value);
  }
};

const confirmDeleteMedia = async () => {
  if (!deletingMedia.value || isDeletingMedia.value) return;
  isDeletingMedia.value = true;
  try {
    const media = deletingMedia.value;
    await removeMedia(media);
    removeLocalMediaHistory(media);
    requestLayerClose('delete', () => { deletingMedia.value = null; });
  } catch {
    // 保留确认窗供重试，错误由片库操作提示。
  } finally {
    isDeletingMedia.value = false;
  }
};

const selectMediaCategory = async (category: CategoryType) => {
  if (!categoryMedia.value || isSavingCategory.value) return;
  if (categoryMedia.value.category === category) {
    requestLayerClose('category', () => { categoryMedia.value = null; });
    return;
  }
  isSavingCategory.value = true;
  try {
    await updateMediaCategory(categoryMedia.value, category);
    requestLayerClose('category', () => { categoryMedia.value = null; });
  } catch {
    // 保存失败时保留原分类和选择面板。
  } finally {
    isSavingCategory.value = false;
  }
};

const handlePlaybackAuthUpdated = () => undefined;

const openPlaybackAuth = async () => {
  const replaceHistory = currentHistoryLayer() === 'player' || currentHistoryLayer() === 'transfer';
  isEmbedPlayerOpen.value = false;
  closeTransferModal();
  mobileTab.value = 'account';
  setAppHistoryLayer('account', replaceHistory);
  await nextTick();
  accountPageRef.value?.focusAuth();
  if (user.value?.role !== 'admin') toast.show('播放服务需要管理员重新认证', '!', 3000);
};

const handleLogout = async () => {
  if(loggingOut.value)return;
  loggingOut.value=true;clipboard.clear();
  if(user.value)playbackSourceCache.clear(user.value.username);
  clearPlaybackPages();window.history.replaceState(null,'','#/discover');
  try{await logout();}finally{loggingOut.value=false;}
};

const clipboardEligible=computed(()=>authenticated.value && !loggingOut.value && !isEmbedPlayerOpen.value && !isSavingTransfer.value && !isTransferOpen.value && dialogOpenCount.value===0);
const clipboard=useClipboardShare(clipboardEligible);
watch(authenticated,value=>{if(!value)clipboard.clear();});
const directShare=shallowRef<{mediaId:string;resource:ResourceItem}|null>(null);
const manageShare=(share:ClipboardShare)=>{
  if(!authenticated.value || isSavingTransfer.value)return;
  const id=share.url.split('/').pop()!;
  const resource:ResourceItem={id:`share-${id}`,title:'分享资源',url:share.url,password:share.passcode,driveType:'quark',datetime:'',source:'分享链接',quality:'',is4k:false};
  const media:MediaItem={id:`share-link-${id}`,title:'待识别片名',category:currentCategory.value,poster:'',tag:'',quarkShareUrl:share.url,quarkPasscode:share.passcode};
  clipboard.dismiss(share);directShare.value={mediaId:media.id,resource};
  const replace=currentHistoryLayer()==='search'||currentHistoryLayer()==='transfer';
  if(mobileTab.value==='search')mobileTab.value=searchOrigin.value;
  openShare(media,resource);setAppHistoryLayer('transfer',replace);
};
const manageClipboard=()=>{if(clipboard.share.value)manageShare(clipboard.share.value);};

const focusMobileSearch = () => {
  if(isSavingTransfer.value)return;
  openResourceSearch({id:'global-resource-search',title:'',category:currentPage.value==='browse'?browseState.value.category:currentCategory.value,poster:'',tag:''});
  setAppHistoryLayer('transfer');
};
const pasteClipboardLink = () => {clipboard.dismiss();focusMobileSearch();};

const navigateContent = (tab: 'discover' | 'library' | 'history' | 'catalog' | 'browse') => {
  if (isSavingTransfer.value) return;
  mobileTab.value = tab;
  lastContentTab.value = tab;
  setAppHistoryLayer(tab);
  nextTick(() => navbarRef.value?.scrollToTop());
};
const showDiscovery = () => navigateContent('discover');
const openBrowse=(preset:{category:CategoryType;country?:string})=>{browseState.value=defaultBrowseState(preset.category,preset.country||'');browseVisited.value=true;navigateContent('browse');};
const updateBrowse=(next:BrowseState)=>{browseState.value=next;if(currentHistoryLayer()==='browse')setAppHistoryLayer('browse',true);};
watch(currentPage,page=>{if(page==='browse')browseVisited.value=true;});
const showMobileAccount = () => {
  if (isSavingTransfer.value) return;
  if (currentPage.value !== 'account') lastContentTab.value = currentPage.value === 'detail' ? detailOrigin.value : currentPage.value;
  mobileTab.value = 'account';
  setAppHistoryLayer('account', currentHistoryLayer() === 'search');
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
};
const navigateMobileTab = (tab: MobileDockTab) => tab === 'account' ? showMobileAccount() : navigateContent(tab);
const openDiscoveryItem = (item: DiscoveryItem) => {
  if (isSavingTransfer.value) return;
  detailOrigin.value = currentPage.value === 'browse' ? 'browse' : currentPage.value === 'catalog' ? 'catalog' : 'discover';
  detailId.value = item.id; detailSeed.value = item; detailHasParent.value = true;
  mobileTab.value = 'detail'; setAppHistoryLayer('detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
};
const closeFilmDetail = () => {
  if (detailHasParent.value) requestLayerClose('detail', () => navigateContent(detailOrigin.value));
  else navigateContent(detailOrigin.value);
};
const searchFilmResources = (item: DiscoveryItem) => {
  if (isSavingTransfer.value) return;
  openTransferModal(discoveryMedia(item));
  setAppHistoryLayer('transfer');
};
const playingCollection = computed(() => allMediaList.value.find(item => embedPlayingMedia.value && sameMediaIdentity(item,embedPlayingMedia.value)));
const collectPlayingMedia = async (media: MediaItem) => {
  const existing = allMediaList.value.find(item => sameMediaIdentity(item,media));
  if (media.quarkFid || existing && existing.quarkSelectionFids === undefined) return;
  if (existing?.quarkShareUrl && existing.quarkShareUrl !== media.quarkShareUrl) throw new Error('已收藏其他片源，可在收藏中管理');
  await saveMedia({ ...media, quarkFid: undefined, startEpisodeFid: undefined, quarkSelectionFids: undefined });
};
const switchPlayingSource = async (choice: MediaItem, episode: QuarkEpisode, position: number, signal: AbortSignal) => {
  const media = embedPlayingMedia.value, key = playbackPageKey.value;
  if (!media) return;
  const next:MediaItem = {...choice,title:media.title,year:media.year,category:media.category,poster:media.poster||choice.poster,catalogId:media.catalogId||choice.catalogId,
    danmakuKey:media.danmakuKey || (media.catalogId?`catalog:${media.catalogId}`:media.id),startEpisodeFid:undefined};
  const result = await QuarkStreamService.createPlaybackSession({quarkFid:next.quarkFid,shareUrl:next.quarkShareUrl,passcode:next.quarkPasscode,title:next.title},signal);
  if (signal.aborted || key !== playbackPageKey.value || !isEmbedPlayerOpen.value) return;
  const index = replacementEpisodeIndex(result.episodes,episode,media.category);
  if (index < 0) throw Object.assign(new Error('这个片源没有当前集，请选择其他片源'), { code: 'SOURCE_EPISODE_MISSING' });
  const target = result.episodes[index]!;
  embedPlayingMedia.value = next;
  selectedHistoryEntry.value = { id:'source-switch',media:next,episodeFid:target.fid,episodeNumber:target.episodeNumber,episodeTitle:target.episodeTitle,position,duration:target.duration || 0,completed:false,updatedAt:new Date().toISOString() };
  openPlayerPage(true,result);
};
const playResource = (media: MediaItem, resource: ResourceItem, category: CategoryType, episodeFid?: string) => {
  if (isSavingTransfer.value) return;
  try {
    const playable = resourcePlaybackMedia(media, resource, category);
    playable.startEpisodeFid = episodeFid;
    closeTransferModal();
    embedPlayingMedia.value = playable;
    selectedHistoryEntry.value = history.value.find(entry => sameMediaIdentity(entry.media, playable)) || null;
    openPlayerPage(true);
  } catch (error) { toast.show(error instanceof Error ? error.message : '无法打开资源', '!'); }
};
</script>

<template>
  <!-- 静态石墨背景，播放时由播放器管理画面周围的材质。 -->
  <div v-show="!isEmbedPlayerOpen" class="liquid-spatial-canvas" aria-hidden="true"></div>

  <LoginScreen
    v-if="checking || !authenticated"
    :checking="checking"
    :submitting="loggingIn"
    :error-message="errorMessage"
    @login="login"
  />

  <template v-else-if="user">
    <main v-if="restoringPlayer" class="restoring-player"><LoadingSkeleton variant="player" label="正在恢复播放" /></main>
    <div v-show="!isEmbedPlayerOpen && !restoringPlayer" class="content-pages">
    <BackToTop :enabled="!isEmbedPlayerOpen && !isTransferOpen && !historySelecting && dialogOpenCount===0" />
    <PullToRefresh :enabled="pullRefreshEnabled" :page-key="`${currentPage}:${currentCategory}`" :refresh="refreshCurrentPage" @error="toast.show('刷新失败，请稍后重试','!')" />
    <!-- 片库页面 -->
    <Navbar
      ref="navbarRef"
      :active-page="currentPage"
      :search-open="isTransferOpen"
      :immersive="currentPage === 'discover' && discoveryImmersive"
      @navigate="navigateContent"
      class="app-navbar"
      :is-saving="isSavingTransfer"
      @open-search="focusMobileSearch"
      @open-account="showMobileAccount"
    />

    <main v-show="currentPage === 'discover'" class="page-container discovery-container">
      <DiscoveryPage ref="discoveryPageRef" @browse="openBrowse" @immersive-change="discoveryImmersive = $event" :active="currentPage === 'discover' && !isEmbedPlayerOpen && !isTransferOpen" :library-catalog-ids="allMediaList.map(item => item.catalogId || '').filter(Boolean)" :history="displayHistory" @continue="continuePlayback" @select="openDiscoveryItem" @search="focusMobileSearch" />
    </main>
    <main v-if="browseVisited" v-show="currentPage === 'browse'" class="page-container"><CatalogBrowsePage ref="browsePageRef" :active="currentPage === 'browse' && !isEmbedPlayerOpen && !isTransferOpen" :state="browseState" :library-catalog-ids="allMediaList.map(item=>item.catalogId||'').filter(Boolean)" @update:state="updateBrowse" @select="openDiscoveryItem" /></main>
    <main v-show="currentPage === 'catalog'" class="page-container">
      <CatalogSearchPage ref="catalogPageRef" :active="currentPage === 'catalog' && !isEmbedPlayerOpen && !isTransferOpen" :query="catalogQuery" :library-catalog-ids="allMediaList.map(item => item.catalogId || '').filter(Boolean)" @select="openDiscoveryItem" @search-resources="searchResources" @back="showDiscovery" />
    </main>
    <main v-if="currentPage === 'detail'" class="page-container detail-container">
      <FilmDetailPage :id="detailId" :seed="detailSeed" :collected="!!detailCollection" @back="closeFilmDetail" @search="searchFilmResources" @play-collection="detailCollection && handleSelectMedia(detailCollection)" />
    </main>
    <!-- 核心主区域 -->
    <main v-if="currentPage === 'library'" class="page-container">
    <header class="library-intro">
      <ListSearch ref="librarySearch" v-model="libraryQuery" label="搜索收藏文件" class="library-search" />
      <div class="library-actions">
        <button
          type="button"
          class="check-updates-button"
          :class="{ checking: isCheckingUpdates || isRefreshingLibrary }"
          :disabled="isCheckingUpdates || isApplyingUpdates || isRefreshingLibrary"
          aria-label="检查收藏更新"
          title="检查收藏更新"
          @click="refreshLibrary"
        >
          <RefreshCw aria-hidden="true" />
          <span v-if="currentCategoryUpdateCount" class="update-count-dot">{{ currentCategoryUpdateCount }}</span>
        </button>
      </div>
    </header>

    <div class="category-toolbar">
      <CategoryTabs v-model="currentCategory" :counts="categoryCounts" :searching="!!libraryQuery.trim()" @update:model-value="libraryQuery = ''" />
    </div>

    <button
      v-if="availableUpdateMedia.length"
      type="button"
      class="apply-updates-button"
      :disabled="isApplyingUpdates || isCheckingUpdates"
      @click="applyLibraryUpdates(availableUpdateMedia)"
    >
      {{ isApplyingUpdates ? '正在补充新剧集…' : `${availableUpdateMedia.length} 部影片发现新剧集，可立即补集` }}
    </button>

    <!-- 影视卡片网格 -->
    <div v-if="loadError" class="inline-feedback library-load-error" role="alert">
      <strong>暂时无法读取收藏</strong>
      <p>{{ loadError }}{{ allMediaList.length ? ' 当前保留上次加载的内容。' : '' }}</p>
      <button type="button" :disabled="isLoading" @click="refreshList()">{{ isLoading ? '正在重试…' : '重新加载收藏' }}</button>
    </div>
    <MediaGrid
      v-if="!loadError || allMediaList.length > 0 || isLoading"
      :media-list="searchedLibrary"
      :current-category="currentCategory"
      :current-category-name="categoryNames[currentCategory]"
      :search-query="libraryQuery"
      :loading="isLoading"
      @select-media="handleSelectMedia"
      @delete-card="handleDeleteCard"
      @re-search="handleReSearch"
      @edit-category="openCategoryPicker"
      @open-actions="openMediaActions"
      @start-search="focusMobileSearch"
      @browse="openBrowse({category:$event})"
    />
    </main>

    <main v-if="currentPage === 'history'" class="page-container"><HistoryPage :delete-selected="removeHistoryBatch" @selection-change="historySelecting=$event" ref="historyPageRef" :history="displayHistory" :history-error="historyError" :loading-history="loadingHistory" :deleting-history-id="deletingHistoryId" @retry="refreshHistory()" @play="continuePlayback" @delete="removeHistory" @discover="showDiscovery" /></main>
    <AccountPage v-if="currentPage === 'account'" ref="accountPageRef" :user="user" :logging-out="loggingOut" @auth-updated="handlePlaybackAuthUpdated" @back="navigateContent(lastContentTab)" @logout="handleLogout" />

    <MobileTabBar
      v-if="!historySelecting && currentPage !== 'detail' && !isEmbedPlayerOpen && !isTransferOpen && !deletingMedia && !categoryMedia && !actionMedia && !titleMedia"
      :active-tab="currentPage === 'catalog' || currentPage === 'browse' ? 'discover' : currentPage"
      :disabled="isSavingTransfer"
      @navigate="navigateMobileTab"
    />

    </div>

  <!-- 独立播放页 -->
    <PlayerPage
      v-if="isEmbedPlayerOpen"
      :key="playbackPageKey"
      :is-open="isEmbedPlayerOpen"
      :media="embedPlayingMedia"
      :username="user.username"
      :resource-overlay-open="isTransferOpen"
      :history-entry="selectedHistoryEntry"
      :initial-session="preparedPageSession?.key === playbackPageKey ? preparedPageSession.session : undefined"
      :collection="playingCollection" :collect="collectPlayingMedia" :switch-source="switchPlayingSource"
      @close="closeEmbedPlayer"
      @re-search="handleReSearch"
      @open-auth-settings="openPlaybackAuth"
      @history-updated="receivePlaybackHistory"
    />

  <!-- 网盘资源检索与换源面板 -->
    <QuarkTransferModal
    v-if="isTransferOpen"
    :is-open="isTransferOpen"
    :is-analyzing="isAnalyzing"
    :initial-resource="directShare?.mediaId === selectedMedia?.id ? directShare?.resource : null"
    @preview-title="selectedMedia && (selectedMedia.title = $event)"
    :media="selectedMedia"
    :current-category="currentCategory"
    :quark-resources="quarkResources"
    :search-error="searchError"
    :search-notice="searchNotice"
    :search-pending="searchPending"
    :search-keyword="searchKeyword"
    :is-saving="isSavingTransfer"
    :saving-resource-id="savingResourceId"
    :save-error="saveError"
    :failed-resource-id="failedResourceId"
    @open-auth-settings="openPlaybackAuth"
    @close="closeTransferPanel"
    @retry-search="retrySearch"
    @search="refreshResources"
    @manage-share="manageShare"
    @resource-unavailable="rejectResource"
    @save-to-cards="handleSaveCard"
    @play-resource="playResource"
    />

    <DeleteMediaConfirm
    :open="!!deletingMedia"
    :media="deletingMedia"
    :deleting="isDeletingMedia"
    @cancel="closeDeleteDialog"
    @confirm="confirmDeleteMedia"
    />

    <CategoryPickerSheet
    :open="!!categoryMedia"
    :media="categoryMedia"
    :saving="isSavingCategory"
    @cancel="closeCategoryPicker"
    @select="selectMediaCategory"
    />

    <MediaActionSheet
      :open="!!actionMedia"
      :media="actionMedia"
      @cancel="closeMediaActions"
      @edit-category="editActionMediaCategory"
      @edit-title="editActionMediaTitle"
      @re-search="reSearchActionMedia"
      @update-library="updateActionMedia"
      @delete="deleteActionMedia"
    />

    <MediaTitleEditor :open="!!titleMedia" :media="titleMedia" :saving="isSavingTitle" :error="titleError" @cancel="closeTitleEditor" @save="saveMediaTitle" />

  </template>

  <ClipboardNotice :mode="clipboardEligible ? clipboard.notice.value : null" @read="clipboard.read()" @manual="pasteClipboardLink" @manage="manageClipboard" @dismiss="clipboard.dismiss()" />
  <!-- 轻量通知浮层 -->
  <Toast />
</template>

<style scoped>
.restoring-player { display: grid; min-height: 100dvh; place-items: center; color: var(--text-secondary); }
.page-container { position: relative; z-index: 1; width: 100%; max-width: var(--content-max-width,1640px); margin: 0 auto; padding: 24px var(--content-gutter, 32px) 90px; animation:page-arrive .22s ease both; }
.discovery-container { padding-top:8px; }
.detail-container { padding-top:16px; }
.library-intro { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.library-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; min-width: 0; }
.library-title h1 { font-size: clamp(1.7rem,3vw,2.6rem); font-weight: 700; letter-spacing: -.03em; line-height: 1.3; }
.library-title p { color: var(--text-tertiary); font-size: .78rem; font-weight: 500; }
.library-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.category-toolbar { display:flex; margin-bottom:24px; }
.library-search { flex:1; }
.check-updates-button { position: relative; display: grid; width: 44px; height: 44px; place-items: center; border: 0; border-radius: 50%; color: var(--text-tertiary); background: transparent; transition: transform .15s var(--spring-ease), background .2s, color .2s; }
.check-updates-button:hover { color: var(--text-primary); background: var(--glass-bg); }
.check-updates-button:active { transform: scale(.92); }
.check-updates-button svg { width: 18px; height: 18px; }
.apply-updates-button { display: block; width: 100%; min-height: 48px; margin-bottom: 20px; padding: 12px 16px; border: var(--glass-border); border-radius: 14px; color: var(--text-primary); background: var(--glass-bg); text-align: left; font-size: .84rem; font-weight: 500; transition: background .2s, transform .15s; }
.apply-updates-button:hover { background: var(--glass-bg-hover); }
.apply-updates-button:active { transform: scale(.99); }
.update-count-dot { position: absolute; top: 2px; right: 2px; display: grid; min-width: 17px; height: 17px; padding: 0 4px; place-items: center; border-radius: 9999px; color: var(--accent-ink); background: var(--liquid-accent); font-size: .6rem; font-weight: 650; }
.check-updates-button.checking svg { animation: update-spin .9s linear infinite; }
@keyframes update-spin { to { transform: rotate(360deg); } }
@media (min-width: 1024px) {
  .app-navbar { width:100%; }
  .page-container { padding:24px var(--content-gutter,40px) 72px; }
  .discovery-container { padding-top:8px; }
}
@media (max-width:1023px) { .library-actions { display:none; } }
@media (max-width: 640px) {
  .page-container { padding: 14px calc(var(--mobile-gutter) + var(--safe-area-right)) var(--mobile-content-bottom) calc(var(--mobile-gutter) + var(--safe-area-left)); }
  .discovery-container { padding-top:4px; }
  .detail-container { padding-top:12px; padding-bottom: 0; }
  .library-intro { margin-bottom: 14px; }
  .library-title { display: grid; gap: 2px; }
  .library-title h1 { font-size: 1.65rem; font-weight: 700; }
  .library-title p { font-size: .72rem; }
  .library-actions { gap: 6px; }
  .category-toolbar { margin-bottom: 20px; }
}
@media (min-width:641px) and (max-width:1023px) {
  .page-container { padding:28px 28px var(--mobile-content-bottom); }
  .discovery-container { padding-top:8px; }
  .detail-container { padding-top:20px; }
}
.discovery-container { max-width:none; margin-top:calc(-1 * var(--app-header-height)); padding:0 0 var(--mobile-content-bottom); animation:none; }
@keyframes page-arrive { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion:reduce) { .page-container { animation:none; } }
</style>
