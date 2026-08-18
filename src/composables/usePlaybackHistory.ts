import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import type { PlaybackHistoryEntry } from '../types/media';
import { PlaybackHistoryService } from '../services/playbackHistoryService';

export const usePlaybackHistory = (enabled: Ref<boolean>) => {
  const history = ref<PlaybackHistoryEntry[]>([]);
  const loadingHistory = ref(false);
  let mounted = false;

  const refreshHistory = async (silent = false) => {
    if (!enabled.value) return;
    if (!silent) loadingHistory.value = true;
    try {
      history.value = await PlaybackHistoryService.list();
    } catch (error) {
      console.warn('[playback-history] 读取失败:', error);
    } finally {
      if (!silent) loadingHistory.value = false;
    }
  };

  const continueWatching = computed(() => history.value
    .filter(entry => !entry.completed && entry.position >= 5 && entry.duration > 0)
    .slice(0, 8));

  const updateLocalHistory = (entry: PlaybackHistoryEntry) => {
    history.value = [entry, ...history.value.filter(item => item.id !== entry.id)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  };

  const removeHistory = async (id: string) => {
    history.value = await PlaybackHistoryService.remove(id);
  };

  const sync = () => {
    if (!enabled.value) {
      history.value = [];
      return;
    }
    refreshHistory();
  };

  const onFocus = () => enabled.value && refreshHistory(true);

  onMounted(() => {
    mounted = true;
    sync();
    window.addEventListener('focus', onFocus);
  });

  watch(enabled, () => mounted && sync());

  onUnmounted(() => {
    mounted = false;
    window.removeEventListener('focus', onFocus);
  });

  return { history, continueWatching, loadingHistory, refreshHistory, updateLocalHistory, removeHistory };
};
