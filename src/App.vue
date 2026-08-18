<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RefreshCw } from '@lucide/vue';
import LoginScreen from './components/auth/LoginScreen.vue';
import AccountPage from './components/auth/AccountPage.vue';
import Navbar from './components/layout/Navbar.vue';
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
const { history, updateLocalHistory, removeHistory } = usePlaybackHistory(authenticated);
const isEmbedPlayerOpen = ref(false);

const {
  currentCategory,
  mediaList,
  enrichedMediaList,
  allMediaList,
  isLoading,
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
  allResources,
  searchError,
  searchKeyword,
  openTransferModal,
  closeTransferModal,
  retrySearch,
  searchResources,
  transferToQuark,
  copyResource
} = useQuarkTransfer();

const navbarRef = ref<InstanceType<typeof Navbar> | null>(null);
const embedPlayingMedia = ref<MediaItem | null>(null);
const accountPageRef = ref<InstanceType<typeof AccountPage> | null>(null);
const deletingMedia = ref<MediaItem | null>(null);
const isDeletingMedia = ref(false);
const categoryMedia = ref<MediaItem | null>(null);
const isSavingCategory = ref(false);
const actionMedia = ref<MediaItem | null>(null);
type MobileTab = MobileDockTab | 'search';
const mobileTab = ref<MobileTab>('library');
const selectedHistoryEntry = ref<PlaybackHistoryEntry | null>(null);
const isCheckingUpdates = ref(false);
const isApplyingUpdates = ref(false);
let autoCheckedUsername = '';
type MobileHistoryLayer = 'library' | 'search' | 'account' | 'player' | 'transfer' | 'delete' | 'category' | 'actions';
let handlingPopState = false;

const mobileHistoryEnabled = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
const currentHistoryLayer = () => window.history.state?.mistyRainLayer as MobileHistoryLayer | undefined;

const setMobileHistoryLayer = (layer: MobileHistoryLayer, replace = false) => {
  if (!mobileHistoryEnabled() || handlingPopState) return;
  const state = { ...(window.history.state || {}), mistyRainLayer: layer };
  if (replace) window.history.replaceState(state, '', window.location.href);
  else if (currentHistoryLayer() !== layer) window.history.pushState(state, '', window.location.href);
};

const requestLayerClose = (layer: MobileHistoryLayer, closeDirectly: () => void) => {
  if (mobileHistoryEnabled() && !handlingPopState && currentHistoryLayer() === layer) {
    window.history.back();
    return;
  }
  closeDirectly();
};

const closeCurrentMobileLayer = () => {
  if (isEmbedPlayerOpen.value) isEmbedPlayerOpen.value = false;
  else if (isTransferOpen.value) closeTransferModal();
  else if (deletingMedia.value) deletingMedia.value = null;
  else if (categoryMedia.value) categoryMedia.value = null;
  else if (actionMedia.value) actionMedia.value = null;
  else if (mobileTab.value !== 'library') mobileTab.value = 'library';
};

const handleMobilePopState = () => {
  handlingPopState = true;
  closeCurrentMobileLayer();
  nextTick(() => { handlingPopState = false; });
};

onMounted(() => {
  if (mobileHistoryEnabled()) setMobileHistoryLayer('library', true);
  window.addEventListener('popstate', handleMobilePopState);
});

onBeforeUnmount(() => window.removeEventListener('popstate', handleMobilePopState));

const availableUpdateMedia = computed(() => enrichedMediaList.value.filter(media => (media.newEpisodeCount || 0) > 0));
const currentCategoryUpdateCount = computed(() => mediaList.value.filter(media => (media.newEpisodeCount || 0) > 0).length);

watch(user, () => {
  isEmbedPlayerOpen.value = false;
  embedPlayingMedia.value = null;
  isTransferOpen.value = false;
  mobileTab.value = 'library';
  deletingMedia.value = null;
  categoryMedia.value = null;
  actionMedia.value = null;
  selectedHistoryEntry.value = null;
  autoCheckedUsername = '';
  setMobileHistoryLayer('library', true);
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
        ? `发现 ${count} 部影片有新内容${unavailableCount ? `，另有 ${unavailableCount} 部需更换片源` : ''}`
        : unavailableCount
          ? `${unavailableCount} 部片源无法继续更新，请从更多操作中更换资源`
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
        ? `${summary.failedCount} 部片源暂时无法更新，请从更多操作中更换资源`
        : '所选影片已是最新';
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
const handleSelectMedia = (media: MediaItem) => {
  embedPlayingMedia.value = media;
  selectedHistoryEntry.value = history.value.find(entry =>
    (media.quarkFid && entry.media.quarkFid === media.quarkFid) || entry.media.id === media.id
  ) || null;
  isEmbedPlayerOpen.value = true;
  setMobileHistoryLayer('player');
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
  requestLayerClose('transfer', closeTransferModal);
};

// 换源
const handleReSearch = (media: MediaItem) => {
  const replaceHistory = currentHistoryLayer() === 'player' || currentHistoryLayer() === 'actions';
  isEmbedPlayerOpen.value = false;
  openTransferModal(media);
  setMobileHistoryLayer('transfer', replaceHistory);
};

// 搜索影视
const handleSearchMedia = (kw: string) => {
  const replaceHistory = currentHistoryLayer() === 'search';
  mobileTab.value = 'library';
  const existing = mediaList.value.find(m => m.title.includes(kw));
  if (existing) {
    openTransferModal(existing);
  } else {
    const tempMedia: MediaItem = {
      id: 'search-' + Date.now(),
      title: kw,
      category: currentCategory.value,
      tag: '4K',
      status: '已收录',
      desc: '网盘影视资源',
      poster: 'https://images.unsplash.com/photo-1578836537282-3171d77f8632?w=600&q=80',
      quarkQuality: '待选择真实资源',
      quarkShareUrl: ''
    };
    openTransferModal(tempMedia);
  }
  setMobileHistoryLayer('transfer', replaceHistory);
};

// 保存片单
const handleSaveCard = async (media: MediaItem, targetCat?: CategoryType, bestRes?: ResourceItem) => {
  const cat = targetCat || media.category || currentCategory.value;
  const cardToSave: MediaItem = {
    ...media,
    category: cat,
    tag: bestRes?.quality || media.tag || '4K',
    quarkQuality: bestRes?.quality || media.quarkQuality || '4K 原画',
    quarkShareUrl: bestRes?.url || media.quarkShareUrl,
    quarkPasscode: bestRes?.password || media.quarkPasscode
  };
  try {
    await saveMedia(cardToSave);
    mobileTab.value = 'library';
    requestLayerClose('transfer', closeTransferModal);
  } catch {
    // 错误已由 useMediaList 在当前系统内提示，保留面板供用户换源重试。
  }
};

// 移除片单
const handleDeleteCard = (media: MediaItem) => {
  deletingMedia.value = media;
  setMobileHistoryLayer('delete');
};

const openMediaActions = (media: MediaItem) => {
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

const confirmDeleteMedia = async () => {
  if (!deletingMedia.value || isDeletingMedia.value) return;
  isDeletingMedia.value = true;
  try {
    await removeMedia(deletingMedia.value);
    requestLayerClose('delete', () => { deletingMedia.value = null; });
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
  } finally {
    isSavingCategory.value = false;
  }
};

const handlePlaybackAuthUpdated = () => undefined;

const openPlaybackAuth = async () => {
  const replaceHistory = currentHistoryLayer() === 'player';
  isEmbedPlayerOpen.value = false;
  mobileTab.value = 'account';
  setMobileHistoryLayer('account', replaceHistory);
  await nextTick();
  accountPageRef.value?.focusAuth();
  if (user.value?.role !== 'admin') toast.show('播放服务需要管理员重新认证', '!', 3000);
};

const handleLogout = async () => {
  await logout();
};

const focusMobileSearch = () => {
  mobileTab.value = 'search';
  setMobileHistoryLayer('search');
  nextTick(() => navbarRef.value?.focusSearch());
};

const finishMobileSearch = () => {
  if (mobileTab.value === 'search') {
    requestLayerClose('search', () => { mobileTab.value = 'library'; });
  }
};

const showMobileLibrary = () => {
  if (mobileTab.value === 'account') {
    requestLayerClose('account', () => { mobileTab.value = 'library'; });
  } else if (mobileTab.value === 'search') {
    requestLayerClose('search', () => { mobileTab.value = 'library'; });
  } else {
    mobileTab.value = 'library';
  }
  nextTick(() => navbarRef.value?.scrollToTop());
};

const showMobileAccount = () => {
  const replaceHistory = currentHistoryLayer() === 'search';
  mobileTab.value = 'account';
  setMobileHistoryLayer('account', replaceHistory);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const navigateMobileTab = (tab: MobileDockTab) => {
  if (tab === 'account') {
    showMobileAccount();
    return;
  }
  showMobileLibrary();
};
</script>

<template>
  <!-- Apple 空间液态流体漫射背景 -->
  <div v-show="!isEmbedPlayerOpen" class="liquid-spatial-canvas">
    <div class="liquid-light-blob blob-1"></div>
    <div class="liquid-light-blob blob-2"></div>
    <div class="liquid-light-blob blob-3"></div>
  </div>

  <LoginScreen
    v-if="checking || !authenticated"
    :checking="checking"
    :submitting="loggingIn"
    :error-message="errorMessage"
    @login="login"
  />

  <template v-else-if="user">
    <!-- 片库页面 -->
    <Navbar
      v-if="mobileTab !== 'account'"
      ref="navbarRef"
      :current-category="currentCategory"
      :current-category-name="categoryNames[currentCategory]"
      :user="user"
      @search-media="handleSearchMedia"
      @search-blur="finishMobileSearch"
      @save-card="handleSaveCard"
      @open-account="showMobileAccount"
    />

    <!-- 核心主区域 -->
    <main v-if="mobileTab !== 'account'" class="page-container">
    <!-- 分类标签控制栏 -->
    <div class="category-toolbar">
      <CategoryTabs
        v-model="currentCategory"
        :counts="categoryCounts"
      />
    </div>

    <!-- 列表标题与数量统计 -->
    <div v-if="mediaList.length > 0" class="section-heading">
      <div class="section-heading-copy">
        <span class="section-kicker">PRIVATE LIBRARY</span>
        <div class="heading-main-line">
          <h2 class="category-heading-title">{{ categoryNames[currentCategory] }}</h2>
          <span class="count-hint">{{ mediaList.length }} 部</span>
        </div>
      </div>
      <div class="library-update-actions">
        <button
          v-if="availableUpdateMedia.length"
          type="button"
          class="apply-updates-button"
          :disabled="isApplyingUpdates || isCheckingUpdates"
          @click="applyLibraryUpdates(availableUpdateMedia)"
        >
          {{ isApplyingUpdates ? '更新中' : `更新 ${availableUpdateMedia.length} 部` }}
        </button>
        <button
          type="button"
          class="check-updates-button"
          :class="{ checking: isCheckingUpdates }"
          :disabled="isCheckingUpdates || isApplyingUpdates"
          aria-label="检查片库更新"
          @click="checkLibraryUpdates(true, true)"
        >
          <RefreshCw aria-hidden="true" />
          <span v-if="currentCategoryUpdateCount" class="update-count-dot">{{ currentCategoryUpdateCount }}</span>
        </button>
      </div>
    </div>

    <!-- 影视卡片网格 -->
    <MediaGrid
      :media-list="mediaList"
      :loading="isLoading"
      :current-category="currentCategory"
      :current-category-name="categoryNames[currentCategory]"
      @select-media="handleSelectMedia"
      @delete-card="handleDeleteCard"
      @re-search="handleReSearch"
      @edit-category="openCategoryPicker"
      @open-actions="openMediaActions"
      @start-search="focusMobileSearch"
    />
    </main>

    <AccountPage
      v-else
      ref="accountPageRef"
      :user="user"
      :history="history"
      @auth-updated="handlePlaybackAuthUpdated"
      @play-history="continuePlayback"
      @delete-history="removeHistory"
      @back="showMobileLibrary"
      @logout="handleLogout"
    />

    <MobileTabBar
      v-if="!isEmbedPlayerOpen && !isTransferOpen && !deletingMedia && !categoryMedia && !actionMedia"
      :active-tab="mobileTab === 'account' ? 'account' : 'library'"
      @navigate="navigateMobileTab"
    />

  <!-- 影院内嵌 4K 原生播放窗 -->
    <QuarkEmbedPlayerModal
      v-if="isEmbedPlayerOpen"
      :is-open="isEmbedPlayerOpen"
      :media="embedPlayingMedia"
      :history-entry="selectedHistoryEntry"
      @close="closeEmbedPlayer"
      @re-search="handleReSearch"
      @open-auth-settings="openPlaybackAuth"
      @history-updated="updateLocalHistory"
    />

  <!-- 网盘资源检索与换源面板 -->
    <QuarkTransferModal
    v-if="isTransferOpen"
    :is-open="isTransferOpen"
    :is-analyzing="isAnalyzing"
    :media="selectedMedia"
    :current-category="currentCategory"
    :quark-resources="quarkResources"
    :all-resources="allResources"
    :search-error="searchError"
    :search-keyword="searchKeyword"
    @close="closeTransferPanel"
    @transfer="transferToQuark"
    @copy="copyResource"
    @retry-search="retrySearch"
    @search="searchResources"
    @save-to-cards="handleSaveCard"
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
      @re-search="reSearchActionMedia"
      @update-library="updateActionMedia"
      @delete="deleteActionMedia"
    />

  </template>

  <!-- 轻量通知浮层 -->
  <Toast />
</template>

<style scoped>
.page-container {
  max-width: 1240px;
  position: relative;
  z-index: 1;
  margin: 0 auto;
  padding-right: 16px;
  padding-left: 16px;
  padding-top: 30px;
  padding-bottom: 112px;
}

.category-toolbar { display: flex; align-items: center; justify-content: flex-start; margin-bottom: 22px; }
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 76px;
  margin-bottom: 18px;
  padding: 12px 14px;
  border: 1px solid rgb(239 241 255 / 0.08);
  border-radius: 18px;
  background:
    radial-gradient(70% 160% at 100% 100%, rgb(var(--accent-rgb) / 0.10), transparent 66%),
    rgb(237 240 255 / 0.025);
  box-shadow: inset 0 1px rgb(255 255 255 / 0.045);
}

.section-heading-copy { display: grid; min-width: 0; gap: 3px; }
.section-kicker { color: var(--liquid-accent); font-size: 0.61rem; font-weight: 760; letter-spacing: 0.12em; }
.heading-main-line { display: flex; min-width: 0; align-items: baseline; gap: 8px; }
.category-heading-title { color: var(--text-primary); font-size: 1.32rem; font-weight: 730; letter-spacing: -0.035em; }
.count-hint { color: var(--text-tertiary); font-size: 0.73rem; font-weight: 560; }
.library-update-actions { display: flex; align-items: center; gap: 7px; margin-left: auto; }

.check-updates-button,
.apply-updates-button {
  min-height: 44px;
  border: 1px solid rgb(239 241 255 / 0.09);
  cursor: pointer;
  touch-action: manipulation;
  color: var(--text-secondary);
  background: rgb(237 240 255 / 0.045);
  box-shadow: inset 0 1px rgb(255 255 255 / 0.045);
}

.apply-updates-button {
  padding: 0 14px;
  border-radius: 12px;
  color: var(--liquid-accent);
  background: var(--liquid-accent-subtle);
  font-size: 0.78rem;
  font-weight: 650;
}

.check-updates-button { position: relative; display: grid; width: 44px; place-items: center; border-radius: 50%; }
.check-updates-button svg { width: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.check-updates-button.checking svg { animation: update-spin .9s linear infinite; }
.check-updates-button:disabled,
.apply-updates-button:disabled { opacity: .5; cursor: default; }
@keyframes update-spin { to { transform: rotate(360deg); } }

.check-updates-button:hover,
.apply-updates-button:hover { border-color: rgb(var(--accent-rgb) / 0.24); background: rgb(var(--accent-rgb) / 0.15); }
.update-count-dot { color: var(--accent-ink); background: var(--liquid-accent); }

@media (max-width: 640px) {
  .page-container {
    padding: 14px calc(var(--mobile-gutter) + var(--safe-area-right)) var(--mobile-content-bottom) calc(var(--mobile-gutter) + var(--safe-area-left));
  }

  .category-toolbar { margin-bottom: 14px; }
  .section-heading {
    min-height: 50px;
    margin-bottom: 12px;
    padding: 3px 2px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .section-kicker { display: none; }
  .section-heading-copy { display: flex; align-items: baseline; }
  .category-heading-title { font-size: 1.18rem; }
  .count-hint { font-size: 0.68rem; }
  .library-update-actions { gap: 5px; }
  .apply-updates-button { min-height: 40px; padding: 0 11px; border-radius: 12px; font-size: 0.72rem; }
  .check-updates-button { width: 44px; min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .check-updates-button.checking svg { animation: none; }
}
</style>
