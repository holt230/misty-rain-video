<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Plus, RefreshCw } from '@lucide/vue';
import LoginScreen from './components/auth/LoginScreen.vue';
import AccountPage from './components/auth/AccountPage.vue';
import TopNavigation from './components/layout/TopNavigation.vue';
import HomePage from './components/catalog/HomePage.vue';
import SearchPage from './components/catalog/SearchPage.vue';
import CatalogDetail from './components/catalog/CatalogDetail.vue';
import { useCatalog } from './composables/useCatalog';
import { findCatalogMedia } from './services/catalogMatching';
import { prepareCatalogPlayback } from './services/catalogPlayback';
import { QuarkStreamService } from './services/quarkStreamService';
import type { CatalogItem } from './types/catalog';
import DesktopSidebar from './components/layout/DesktopSidebar.vue';
import MobileTabBar, { type MobileTab as MobileDockTab } from './components/layout/MobileTabBar.vue';
import CategoryTabs from './components/media/CategoryTabs.vue';
import MediaGrid from './components/media/MediaGrid.vue';
import DeleteMediaConfirm from './components/media/DeleteMediaConfirm.vue';
import CategoryPickerSheet from './components/media/CategoryPickerSheet.vue';
import MediaActionSheet from './components/media/MediaActionSheet.vue';
import Toast from './components/common/Toast.vue';
import { useMediaList } from './composables/useMediaList';
import { useQuarkTransfer } from './composables/useQuarkTransfer';
import { useAuth } from './composables/useAuth';
import { useToast } from './composables/useToast';
import { usePlaybackHistory } from './composables/usePlaybackHistory';
import { MediaStore } from './services/mediaStore';
import { getLibrarySaveFeedback, type LibrarySaveFeedback } from './services/libraryFeedback';
import type { MediaItem, CategoryType, PlaybackHistoryEntry } from './types/media';
import type { ResourceItem } from './types/search';

// HLS 播放器和资源检索面板只会在用户主动打开时使用；按需加载可显著
// 缩小移动端首屏 JS，避免登录后先下载整个播放器运行时。
const QuarkTransferModal = defineAsyncComponent({
  loader: () => import('./components/quark/QuarkTransferModal.vue'),
  delay: 0,
  suspensible: false
});
const QuarkEmbedPlayerModal = defineAsyncComponent({
  loader: () => import('./components/player/QuarkEmbedPlayerModal.vue'),
  delay: 0,
  suspensible: false
});

const { user, authenticated, checking, loggingIn, errorMessage, login, logout } = useAuth();
const toast = useToast();
const { history, historyError, loadingHistory, deletingHistoryId, refreshHistory, updateLocalHistory, removeHistory, removeLocalMediaHistory } = usePlaybackHistory(authenticated);
const isEmbedPlayerOpen = ref(false);
const playerPageRef = ref<InstanceType<typeof QuarkEmbedPlayerModal> | null>(null);
const transferPageRef = ref<InstanceType<typeof QuarkTransferModal> | null>(null);

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
  closeTransferModal,
  retrySearch,
  refreshResources
} = useQuarkTransfer();

const searchPageRef = ref<InstanceType<typeof SearchPage> | null>(null);
const { feeds: catalogFeeds, browse: catalogBrowse, items: catalogItems, loading: catalogLoading, refresh: refreshCatalog, refreshChannel: refreshCatalogChannel, loadMore: loadMoreCatalog } = useCatalog(authenticated);
const catalogDetail = ref<CatalogItem | null>(null);
const pendingCatalog = ref<CatalogItem | null>(null);
const playAfterTransfer = ref(false);
const automaticStatus = ref('');
const automaticNotice = ref('');
let automaticSequence = 0;
const automaticRequested = ref(false);
const libraryFilter = ref<'all' | 'watching' | 'updated'>('all');
const librarySort = ref<'default' | 'title' | 'recent'>('default');
const visibleLibrary = computed(() => {
  let items = [...mediaList.value];
  if (libraryFilter.value === 'watching') items = items.filter(item => history.value.some(entry => !entry.completed && entry.media.quarkFid === item.quarkFid));
  if (libraryFilter.value === 'updated') items = items.filter(item => (item.newEpisodeCount || 0) > 0);
  if (librarySort.value === 'title') items.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  if (librarySort.value === 'recent') {
    const lastSeen = (item: MediaItem) => history.value.find(entry => entry.media.quarkFid === item.quarkFid)?.updatedAt || '';
    items.sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)));
  }
  return items;
});
const pageScroll = new Map<MobileDockTab, number>();
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
const mobileTab = ref<MobileDockTab>('home');
const selectedHistoryEntry = ref<PlaybackHistoryEntry | null>(null);
const isCheckingUpdates = ref(false);
const isApplyingUpdates = ref(false);
let autoCheckedUsername = '';
type MobileHistoryLayer = MobileDockTab | 'account-detail' | 'detail' | 'player' | 'transfer' | 'delete' | 'category' | 'actions';
let handlingPopState = false;
const currentHistoryLayer = () => window.history.state?.mistyRainLayer as MobileHistoryLayer | undefined;
const setMobileHistoryLayer = (layer: MobileHistoryLayer, replace = false) => {
  if (handlingPopState) return;
  const state = { ...(window.history.state || {}), mistyRainLayer: layer, mistyRainPage: mobileTab.value };
  if (replace) window.history.replaceState(state, '', window.location.href);
  else if (currentHistoryLayer() !== layer) window.history.pushState(state, '', window.location.href);
};
const cancelAutomatic = () => { automaticSequence++; automaticRequested.value = false; automaticStatus.value = ''; automaticNotice.value = ''; };
const requestLayerClose = (layer: MobileHistoryLayer, closeDirectly: () => void) => {
  if (!handlingPopState && currentHistoryLayer() === layer) window.history.back();
  else closeDirectly();
};
const handleMobilePopState = () => {
  if (isTransferOpen.value && transferPageRef.value?.dismissLayer()) {
    setMobileHistoryLayer('transfer');
    return;
  }
  if (isEmbedPlayerOpen.value && playerPageRef.value?.dismissLayer()) {
    setMobileHistoryLayer('player');
    return;
  }
  if (isSavingTransfer.value || isDeletingMedia.value || isSavingCategory.value) {
    setMobileHistoryLayer(isSavingTransfer.value ? 'transfer' : isDeletingMedia.value ? 'delete' : 'category');
    return;
  }
  handlingPopState = true;
  const layer = currentHistoryLayer() || 'home';
  const page = window.history.state?.mistyRainPage;
  const previousPage = mobileTab.value;
  mobileTab.value = ['home', 'library', 'search', 'account'].includes(page) ? page : 'home';
  isEmbedPlayerOpen.value = layer === 'player' && !!embedPlayingMedia.value;
  if (layer !== 'transfer') { cancelAutomatic(); pendingCatalog.value = null; playAfterTransfer.value = false; closeTransferModal(); }
  if (!['detail', 'player', 'transfer'].includes(layer)) catalogDetail.value = null;
  if (layer !== 'delete') deletingMedia.value = null;
  if (layer !== 'category') categoryMedia.value = null;
  if (layer !== 'actions') actionMedia.value = null;
  nextTick(() => {
    if (mobileTab.value === 'account') accountPageRef.value?.restoreSection(layer === 'account-detail' ? window.history.state?.mistyRainAccountSection : 'overview');
    handlingPopState = false;
    if (previousPage !== mobileTab.value) window.scrollTo({ top: pageScroll.get(mobileTab.value) || 0 });
  });
};
onMounted(() => {
  window.history.scrollRestoration = 'manual';
  setMobileHistoryLayer('home', true);
  window.addEventListener('popstate', handleMobilePopState);
});
onBeforeUnmount(() => window.removeEventListener('popstate', handleMobilePopState));

const availableUpdateMedia = computed(() => enrichedMediaList.value.filter(media => (media.newEpisodeCount || 0) > 0));
const currentCategoryUpdateCount = computed(() => mediaList.value.filter(media => (media.newEpisodeCount || 0) > 0).length);

watch(user, () => {
  isEmbedPlayerOpen.value = false;
  embedPlayingMedia.value = null;
  isTransferOpen.value = false;
  mobileTab.value = 'home';
  catalogDetail.value = null;
  pendingCatalog.value = null;
  pageScroll.clear();
  playAfterTransfer.value = false;
  cancelAutomatic();
  deletingMedia.value = null;
  categoryMedia.value = null;
  actionMedia.value = null;
  selectedHistoryEntry.value = null;
  isSavingTransfer.value = false;
  savingResourceId.value = '';
  saveError.value = null;
  failedResourceId.value = '';
  autoCheckedUsername = '';
  setMobileHistoryLayer('home', true);
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
          ? `${unavailableCount} 部未能检查更新，可在影片“更多操作”中查看原因`
          : '片库内容已是最新';
      toast.show(message, count ? '↻' : unavailableCount ? '!' : '✓', 3200);
    }
  } catch (error) {
    if (notify) toast.show(error instanceof Error ? error.message : '检查更新失败', '!', 3200);
  } finally {
    isCheckingUpdates.value = false;
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

/**
 * 调起影院播放窗
 */
const handleSelectMedia = (media: MediaItem, replace = false) => {
  if (isSavingTransfer.value) { toast.show('正在添加影片，请稍候', '↻'); return; }
  embedPlayingMedia.value = media;
  selectedHistoryEntry.value = history.value.find(entry =>
    (media.quarkFid && entry.media.quarkFid === media.quarkFid) || entry.media.id === media.id
  ) || null;
  isEmbedPlayerOpen.value = true;
  setMobileHistoryLayer('player', replace);
};

const continuePlayback = (entry: PlaybackHistoryEntry) => {
  selectedHistoryEntry.value = entry;
  embedPlayingMedia.value = entry.media;
  isEmbedPlayerOpen.value = true;
  setMobileHistoryLayer('player');
};

const closeEmbedPlayer = () => {
  requestLayerClose('player', () => { isEmbedPlayerOpen.value = false; });
};

const closeTransferPanel = () => {
  if (isSavingTransfer.value) return;
  cancelAutomatic();
  pendingCatalog.value = null;
  playAfterTransfer.value = false;
  requestLayerClose('transfer', closeTransferModal);
};

watch(isTransferOpen, () => { saveError.value = null; failedResourceId.value = ''; });

// 换源
const handleReSearch = (media: MediaItem) => {
  if (isSavingTransfer.value) return;
  cancelAutomatic();
  pendingCatalog.value = null;
  playAfterTransfer.value = isEmbedPlayerOpen.value;
  const replaceHistory = currentHistoryLayer() === 'player' || currentHistoryLayer() === 'actions';
  isEmbedPlayerOpen.value = false;
  openTransferModal(media);
  setMobileHistoryLayer('transfer', replaceHistory);
};

let catalogOrigin: { page: MobileDockTab; top: number } | null = null;
const openCatalogDetail = (item: CatalogItem) => {
  if (!catalogDetail.value) catalogOrigin = { page: mobileTab.value, top: window.scrollY };
  catalogDetail.value = item;
  setMobileHistoryLayer('detail');
};
watch(catalogDetail, async (value, previous) => {
  if (value || !previous || !catalogOrigin) return;
  const origin = catalogOrigin; catalogOrigin = null;
  await nextTick();
  if (authenticated.value && mobileTab.value === origin.page) window.scrollTo({ top: origin.top });
});
const closeCatalogDetail = () => requestLayerClose('detail', () => { catalogDetail.value = null; });
const startCatalogPlayback = (automatic = true) => {
  const item = catalogDetail.value;
  if (!item) return;
  const existing = findCatalogMedia(item, allMediaList.value);
  if (existing && automatic) { handleSelectMedia(existing); return; }
  cancelAutomatic();
  pendingCatalog.value = item;
  playAfterTransfer.value = true;
  automaticRequested.value = automatic;
  automaticStatus.value = automatic ? '正在为你查找匹配片源…' : '';
  void openTransferModal(existing && !automatic ? { ...existing, catalogId: item.catalogId, year: item.year } : item);
  setMobileHistoryLayer('transfer');
};
const handleSearchMedia = (keyword: string, category: CategoryType = currentCategory.value) => {
  cancelAutomatic();
  pendingCatalog.value = null;
  playAfterTransfer.value = false;
  void openTransferModal({ id: 'search-' + Date.now(), title: keyword, category, tag: '', poster: '', quarkShareUrl: '' });
  setMobileHistoryLayer('transfer');
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
  const account = user.value?.username;
  const playAfterSave = playAfterTransfer.value;
  try {
    const savedItems = await saveMedia(cardToSave);
    if (account !== user.value?.username) { void refreshList(); return false; }
    currentCategory.value = cat;
    const saved = (media.catalogId ? savedItems.find(item => item.catalogId === media.catalogId && item.quarkFid) : undefined)
      || savedItems.find(item => item.quarkShareUrl === cardToSave.quarkShareUrl && item.quarkFid);
    cancelAutomatic();
    pendingCatalog.value = null;
    playAfterTransfer.value = false;
    closeTransferModal();
    if (playAfterSave && saved) {
      isSavingTransfer.value = false;
      handleSelectMedia(saved, true);
    } else {
      mobileTab.value = 'library';
      setMobileHistoryLayer('library', true);
    }
    return true;
  } catch (error) {
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
  setMobileHistoryLayer('delete');
};

const openMediaActions = (media: MediaItem) => {
  if (isSavingTransfer.value) { toast.show('正在添加影片，请稍候', '↻'); return; }
  actionMedia.value = media;
  setMobileHistoryLayer('actions');
};

const openCategoryPicker = (media: MediaItem) => {
  categoryMedia.value = media;
  setMobileHistoryLayer('category');
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
    setMobileHistoryLayer('category', true);
  }
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
    setMobileHistoryLayer('delete', true);
  }
};

const updateActionMedia = () => {
  const media = actionMedia.value;
  closeMediaActions();
  if (media) void applyLibraryUpdates([media]);
};

const receivePlaybackHistory = (entry: PlaybackHistoryEntry, username?: string) => {
  if (authenticated.value && username === user.value?.username) {
    updateLocalHistory(entry);
    if (entry.media.quarkFid === embedPlayingMedia.value?.quarkFid) selectedHistoryEntry.value = entry;
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

const handlePlaybackAuthUpdated = () => { void refreshList(true); };

const openPlaybackAuth = async () => {
  cancelAutomatic();
  catalogDetail.value = null;
  pendingCatalog.value = null;
  playAfterTransfer.value = false;
  const replaceHistory = currentHistoryLayer() === 'player' || currentHistoryLayer() === 'transfer';
  isEmbedPlayerOpen.value = false;
  closeTransferModal();
  mobileTab.value = 'account';
  setMobileHistoryLayer('account', replaceHistory);
  await nextTick();
  accountPageRef.value?.focusAuth();
  if (user.value?.role !== 'admin') toast.show('播放服务需要管理员重新认证', '!', 3000);
};

const handleLogout = async () => {
  await logout();
};

const navigateMobileTab = async (tab: MobileDockTab) => {
  if (isSavingTransfer.value) return;
  pageScroll.set(mobileTab.value, window.scrollY);
  mobileTab.value = tab;
  setMobileHistoryLayer(tab, true);
  await nextTick();
  window.scrollTo({ top: pageScroll.get(tab) || 0 });
};
const focusMobileSearch = async () => { await navigateMobileTab('search'); searchPageRef.value?.focus(); };
const submitHeaderSearch = async (keyword: string) => {
  if (isSavingTransfer.value) return;
  await navigateMobileTab('search');
  searchPageRef.value?.search(keyword);
};
const showHistory = async () => {
  await navigateMobileTab('account');
  accountPageRef.value?.showHistory();
};
const handleAccountSection = (section: string) => {
  if (handlingPopState) return;
  if (section === 'overview') {
    if (currentHistoryLayer() === 'account-detail') window.history.back();
  } else {
    setMobileHistoryLayer('account-detail');
    window.history.replaceState({ ...window.history.state, mistyRainAccountSection: section }, '', window.location.href);
  }
};

watch([isAnalyzing, searchPending, quarkResources], async () => {
  if (!automaticRequested.value || isAnalyzing.value || !isTransferOpen.value) return;
  const item = pendingCatalog.value;
  if (!item) return;
  const sequence = automaticSequence;
  automaticRequested.value = false;
  const result = await prepareCatalogPlayback(item, {
    resources: () => quarkResources.value,
    searching: () => searchPending.value,
    cancelled: () => sequence !== automaticSequence || !isTransferOpen.value,
    inspect: resource => QuarkStreamService.getShareDetails(resource.url, resource.password || ''),
    save: resource => handleSaveCard(item, item.category, resource),
    progress: message => { if (sequence === automaticSequence) automaticStatus.value = message; }
  });
  if (sequence !== automaticSequence) return;
  automaticStatus.value = '';
  if (result.status === 'manual') automaticNotice.value = result.message || '';
  if (result.status === 'failed') automaticNotice.value = '自动添加未完成，请查看失败原因后重试，或选择其他片源。';
});
const searchTransferResources = (keyword: string) => { cancelAutomatic(); return refreshResources(keyword); };
const retryTransferSearch = () => { cancelAutomatic(); retrySearch(); };
</script>

<template>
  <div class="liquid-spatial-canvas" aria-hidden="true"></div>
  <LoginScreen v-if="checking || !authenticated" :checking="checking" :submitting="loggingIn" :error-message="errorMessage" @login="login" />
  <template v-else-if="user">
    <div :inert="!!catalogDetail || isEmbedPlayerOpen || isTransferOpen || !!deletingMedia || !!categoryMedia || !!actionMedia">
      <DesktopSidebar :active-page="mobileTab" :user="user" :disabled="isSavingTransfer" @navigate="navigateMobileTab" />
      <TopNavigation :active-page="mobileTab" :disabled="isSavingTransfer" @home="navigateMobileTab('home')" @search="focusMobileSearch" @submit="submitHeaderSearch" @history="showHistory" />
      <HomePage v-show="mobileTab === 'home'" :active="mobileTab === 'home' && !catalogDetail && !isEmbedPlayerOpen && !isTransferOpen && !deletingMedia && !categoryMedia && !actionMedia" :feeds="catalogFeeds" :browse="catalogBrowse" :loading="catalogLoading" :library="enrichedMediaList" :history="history" @select="openCatalogDetail" @play="handleSelectMedia" @continue="continuePlayback" @search="focusMobileSearch" @history="showHistory" @refresh="refreshCatalog" @refresh-channel="refreshCatalogChannel" @load-more="loadMoreCatalog" />
      <SearchPage v-show="mobileTab === 'search'" ref="searchPageRef" :username="user.username" :library="allMediaList" :catalog="catalogItems" :busy="isSavingTransfer" :error="failedResourceId === 'direct' ? saveError : null" @search="handleSearchMedia" @select="openCatalogDetail" @play="handleSelectMedia" @save="handleSaveCard" @auth="openPlaybackAuth" @clear-error="saveError = null" />
      <main v-show="mobileTab === 'library'" class="page-container library-page">
        <header class="library-intro"><div class="library-title"><h1>我的片库</h1><p>{{ allMediaList.length }} 部影片，随时开场</p></div><div class="library-actions"><button type="button" class="check-updates-button" :class="{ checking: isCheckingUpdates }" :disabled="isCheckingUpdates || isApplyingUpdates" aria-label="检查片库更新" @click="checkLibraryUpdates(true, true)"><RefreshCw /><span v-if="currentCategoryUpdateCount" class="update-count-dot">{{ currentCategoryUpdateCount }}</span></button><button type="button" class="add-library-button" @click="focusMobileSearch"><Plus />添加</button></div></header>
        <div class="category-toolbar"><CategoryTabs v-model="currentCategory" :counts="categoryCounts" /></div>
        <div class="library-filter-row"><div role="group" aria-label="片库状态"><button type="button" :class="{ active: libraryFilter === 'all' }" :aria-pressed="libraryFilter === 'all'" @click="libraryFilter = 'all'">全部</button><button type="button" :class="{ active: libraryFilter === 'watching' }" :aria-pressed="libraryFilter === 'watching'" @click="libraryFilter = 'watching'">在看</button><button type="button" :class="{ active: libraryFilter === 'updated' }" :aria-pressed="libraryFilter === 'updated'" @click="libraryFilter = 'updated'">有更新</button></div><select v-model="librarySort" aria-label="片库排序"><option value="default">默认排序</option><option value="recent">最近观看</option><option value="title">片名排序</option></select></div>
        <button v-if="availableUpdateMedia.length" type="button" class="apply-updates-button" :disabled="isApplyingUpdates || isCheckingUpdates" @click="applyLibraryUpdates(availableUpdateMedia)">{{ isApplyingUpdates ? '正在补充新剧集…' : availableUpdateMedia.length + ' 部影片发现新剧集，立即补集' }}</button>
        <div v-if="loadError" class="inline-feedback library-load-error" role="alert"><strong>暂时无法读取片库</strong><p>{{ loadError }}</p><button type="button" :disabled="isLoading" @click="refreshList()">重新加载</button></div>
        <div v-if="!isLoading && mediaList.length && !visibleLibrary.length" class="catalog-empty"><p>当前分类下没有符合条件的影片。</p><button type="button" class="cinema-button secondary" @click="libraryFilter = 'all'">查看全部影片</button></div>
        <MediaGrid v-else-if="!loadError || allMediaList.length || isLoading" :media-list="visibleLibrary" :loading="isLoading" :current-category="currentCategory" :current-category-name="categoryNames[currentCategory]" @select-media="handleSelectMedia" @delete-card="handleDeleteCard" @re-search="handleReSearch" @edit-category="openCategoryPicker" @open-actions="openMediaActions" @start-search="focusMobileSearch" />
      </main>
      <AccountPage v-if="mobileTab === 'account'" ref="accountPageRef" @section-change="handleAccountSection" :user="user" :history="history" :history-error="historyError" :loading-history="loadingHistory" :deleting-history-id="deletingHistoryId" @retry-history="refreshHistory()" @auth-updated="handlePlaybackAuthUpdated" @back="navigateMobileTab('home')" @play-history="continuePlayback" @delete-history="removeHistory" @logout="handleLogout" />
      <MobileTabBar :active-tab="mobileTab" :disabled="isSavingTransfer" @navigate="navigateMobileTab" />
    </div>
    <CatalogDetail v-if="catalogDetail && !isEmbedPlayerOpen && !isTransferOpen" :item="catalogDetail" :in-library="!!findCatalogMedia(catalogDetail, allMediaList)" @close="closeCatalogDetail" @play="startCatalogPlayback()" @sources="startCatalogPlayback(false)" />
    <QuarkEmbedPlayerModal ref="playerPageRef" v-if="isEmbedPlayerOpen" :is-open="isEmbedPlayerOpen" :media="embedPlayingMedia" :username="user.username" :history-entry="selectedHistoryEntry" @close="closeEmbedPlayer" @re-search="handleReSearch" @open-auth-settings="openPlaybackAuth" @history-updated="receivePlaybackHistory" />
    <QuarkTransferModal ref="transferPageRef" v-if="isTransferOpen" :is-open="isTransferOpen" :is-analyzing="isAnalyzing || !!automaticStatus" :automatic-status="automaticStatus" @cancel-automatic="cancelAutomatic" :play-after-save="playAfterTransfer" :media="selectedMedia" :current-category="currentCategory" :quark-resources="quarkResources" :search-error="searchError" :search-notice="automaticNotice || searchNotice" :search-pending="searchPending" :search-keyword="searchKeyword" :is-saving="isSavingTransfer" :saving-resource-id="savingResourceId" :save-error="saveError" :failed-resource-id="failedResourceId" @open-auth-settings="openPlaybackAuth" @close="closeTransferPanel" @retry-search="retryTransferSearch" @search="searchTransferResources" @save-to-cards="handleSaveCard" />
    <DeleteMediaConfirm :open="!!deletingMedia" :media="deletingMedia" :deleting="isDeletingMedia" @cancel="closeDeleteDialog" @confirm="confirmDeleteMedia" />
    <CategoryPickerSheet :open="!!categoryMedia" :media="categoryMedia" :saving="isSavingCategory" @cancel="closeCategoryPicker" @select="selectMediaCategory" />
    <MediaActionSheet :open="!!actionMedia" :media="actionMedia" @cancel="closeMediaActions" @edit-category="editActionMediaCategory" @re-search="reSearchActionMedia" @update-library="updateActionMedia" @delete="deleteActionMedia" />
  </template>
  <Toast />
</template>

<style scoped>
.page-container { position: relative; z-index: 1; }
.library-intro { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.library-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; min-width: 0; }
.library-title h1 { font-size: 2rem; font-weight: 650; letter-spacing: -.035em; line-height: 1.3; }
.library-title p { color: var(--text-tertiary); font-size: .75rem; }
.library-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.add-library-button { display: flex; min-height: 44px; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border: 0; border-radius: 22px; color: var(--text-primary); background: var(--glass-bg-active); font-size: .8rem; font-weight: 550; transition: background .2s; }
.add-library-button:hover { background: rgb(255 255 255 / .16); }
.add-library-button svg { width: 17px; height: 17px; stroke-width: 2; }
.category-toolbar { display: flex; margin-bottom: 28px; border-bottom: 1px solid rgb(255 255 255 / .07); }
.check-updates-button { position: relative; display: grid; width: 44px; height: 44px; place-items: center; border: 0; border-radius: 50%; color: var(--text-tertiary); background: transparent; transition: background .2s, color .2s; }
.check-updates-button:hover { color: var(--text-primary); background: var(--glass-bg); }
.check-updates-button svg { width: 18px; height: 18px; }
.apply-updates-button { display: block; width: 100%; min-height: 44px; margin-bottom: 20px; padding: 10px 16px; border: var(--glass-border); border-radius: 12px; color: var(--text-primary); background: var(--glass-bg); text-align: left; font-size: .8rem; }
.apply-updates-button:hover { background: var(--glass-bg-hover); }
.update-count-dot { position: absolute; top: 0; right: 0; display: grid; min-width: 17px; height: 17px; padding: 0 3px; place-items: center; border-radius: 20px; color: var(--accent-ink); background: var(--liquid-accent); font-size: .58rem; }
.check-updates-button.checking svg { animation: update-spin .9s linear infinite; }
@keyframes update-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .library-intro { margin-bottom: 16px; }
  .library-title { display: grid; gap: 2px; }
  .library-title h1 { font-size: 1.65rem; }
  .library-title p { font-size: .69rem; }
  .library-actions { gap: 4px; }
  .add-library-button { padding: 0 12px; }
  .category-toolbar { margin-bottom: 22px; }
}
</style>
