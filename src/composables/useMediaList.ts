import { ref, computed, onMounted, onUnmounted, watch, type Ref } from 'vue';
import type { MediaItem, CategoryType, LibraryUpdateStatus } from '../types/media';
import { MediaStore } from '../services/mediaStore';
import { useToast } from './useToast';
import { getLibrarySaveFeedback } from '../services/libraryFeedback';
import { sameMediaIdentity } from '../services/historyIdentity';

export function useMediaList(enabled?: Ref<boolean>, paused?: Ref<boolean>) {
  const toast = useToast();
  const currentCategory = ref<CategoryType>('tv');
  const allMediaList = ref<MediaItem[]>([]);
  const libraryUpdates = ref<Record<string, LibraryUpdateStatus>>({});
  const isLoading = ref(false);
  const loadError = ref('');
  const pollingIntervalMs = 90_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let mounted = false;
  const isEnabled = () => enabled?.value ?? true;
  const isPaused = () => paused?.value ?? false;
  const isDocumentVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

  const categoryNames: Record<CategoryType, string> = {
    tv: '电视剧',
    movie: '电影',
    variety: '综艺',
    anime: '动漫'
  };

  let revision = 0;
  let refreshTask: Promise<void> | null = null;
  let refreshController: AbortController | null = null;
  const canRefresh = () => mounted && isEnabled() && !isPaused() && isDocumentVisible();
  const cancelRefresh = () => {
    revision++;
    refreshController?.abort();
    refreshController = null;
    refreshTask = null;
    isLoading.value = false;
  };
  /** Coalesce focus/poll reads and never let a pre-mutation snapshot replace new data. */
  const refreshList = (silent = false): Promise<void> => {
    if (!canRefresh()) return Promise.resolve();
    if (refreshTask) return refreshTask;
    const current = revision;
    const controller = refreshController = new AbortController();
    if (!silent) isLoading.value = true;
    const task: Promise<void> = Promise.resolve().then(async () => {
      try {
        if (controller.signal.aborted) return;
        const data = await MediaStore.getAllMedia(controller.signal);
        if (current !== revision || !canRefresh() || controller.signal.aborted) return;
        allMediaList.value = data; loadError.value = '';
      } catch (err) {
        if (current === revision && canRefresh() && !controller.signal.aborted) loadError.value = '收藏读取失败，请稍后重试';
      } finally {
        if (refreshTask === task) { refreshTask = null; refreshController = null; isLoading.value = false; }
      }
    });
    refreshTask = task;
    return task;
  };

  // 当前分类下的影视列表
  const mediaList = computed(() => {
    return allMediaList.value
      .filter(item => item.category === currentCategory.value)
      .map(item => {
        const update = item.quarkFid ? libraryUpdates.value[item.quarkFid] : null;
        return update ? { ...item, ...update, updateMessage: update.message || '' } : item;
      });
  });

  const enrichedMediaList = computed(() => allMediaList.value.map(item => {
    const update = item.quarkFid ? libraryUpdates.value[item.quarkFid] : null;
    return update ? { ...item, ...update, updateMessage: update.message || '' } : item;
  }));

  // 各分类数量统计
  const categoryCounts = computed(() => {
    const counts: Record<CategoryType, number> = {
      tv: 0,
      movie: 0,
      variety: 0,
      anime: 0
    };
    allMediaList.value.forEach(item => {
      if (counts[item.category] !== undefined) {
        counts[item.category]++;
      }
    });
    return counts;
  });

  /** 保存影视到当前账户的片库。 */
  const saveMedia = async (item: MediaItem) => {
    try {
      const result = await MediaStore.saveMedia(item);
      revision++; allMediaList.value = result.items;
      loadError.value = '';
      toast.show(item.quarkFid ? '片源已更新' : '已加入收藏', '✓', 2200);
    } catch (error) {
      toast.show(getLibrarySaveFeedback(error).title, '!', 3500);
      throw error;
    }
  };

  /** 从当前账户的片库移除影视。 */
  const removeMedia = async (media: MediaItem) => {
    try {
      await MediaStore.removeMedia(media);
      revision++; allMediaList.value = allMediaList.value.filter(item => !sameMediaIdentity(item,media));
      toast.show(`《${media.title}》已移入回收站`, '✓', 2500);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : '删除失败', '!', 3200);
      throw error;
    }
  };

  const updateMediaCategory = async (media: MediaItem, category: CategoryType) => {
    try {
      await MediaStore.updateCategory(media.title, category);
      revision++;
      allMediaList.value = allMediaList.value.map(item => item.title === media.title
        ? { ...item, category }
        : item);
      toast.show(`《${media.title}》已归类到${categoryNames[category]}`, '✓', 2200);
      currentCategory.value = category;
    } catch (error) {
      toast.show(error instanceof Error ? error.message : '分类更新失败', '!', 3000);
      throw error;
    }
  };

  const setLibraryUpdates = (items: LibraryUpdateStatus[]) => {
    libraryUpdates.value = Object.fromEntries(items.map(item => [item.quarkFid, item]));
  };

  const updateMediaTitle = async (media: MediaItem, title: string) => {
    const updated = await MediaStore.updateTitle(media, title);
    revision++;
    allMediaList.value = allMediaList.value.map(item => sameMediaIdentity(item, media) ? updated : item);
    toast.show('名称已修改', '✓');
    return updated;
  };

  // 窗口激活时静默同步；后台不保留 15 秒高频轮询，避免移动端
  // 无意义的网络与渲染唤醒。进入前台仍会立即拉取最新片库。
  const onFocus = () => {
    if (isEnabled() && !isPaused() && isDocumentVisible()) void refreshList(true);
  };

  const stopPolling = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const startPolling = () => {
    stopPolling();
    if (!isEnabled() || isPaused() || !isDocumentVisible()) return;
    timer = setInterval(() => {
      if (isEnabled() && !isPaused() && isDocumentVisible()) void refreshList(true);
    }, pollingIntervalMs);
  };

  const syncEnabledState = () => {
    stopPolling();
    if (!isEnabled()) {
      cancelRefresh();
      allMediaList.value = [];
      loadError.value = '';
      libraryUpdates.value = {};
      return;
    }
    if (isPaused() || !isDocumentVisible()) { cancelRefresh(); return; }
    void refreshList();
    startPolling();
  };

  const onVisibilityChange = () => {
    if (!isDocumentVisible()) {
      stopPolling();
      cancelRefresh();
      return;
    }
    if (isEnabled() && !isPaused()) {
      void refreshList(true);
      startPolling();
    }
  };

  onMounted(() => {
    mounted = true;
    syncEnabledState();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  });

  if (enabled) watch(enabled, () => mounted && syncEnabledState());
  if (paused) watch(paused, () => mounted && syncEnabledState());

  onUnmounted(() => {
    mounted = false;
    cancelRefresh();
    stopPolling();
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  return {
    currentCategory,
    mediaList,
    enrichedMediaList,
    allMediaList,
    categoryCounts,
    categoryNames,
    isLoading,
    loadError,
    refreshList,
    setLibraryUpdates,
    saveMedia,
    removeMedia,
    updateMediaCategory,
    updateMediaTitle
  };
}
