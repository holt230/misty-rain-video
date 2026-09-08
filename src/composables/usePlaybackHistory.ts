import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import type { PlaybackHistoryEntry } from '../types/media';
import { PlaybackHistoryService } from '../services/playbackHistoryService';
import { useToast } from './useToast';

export const usePlaybackHistory = (enabled: Ref<boolean>) => {
  const history = ref<PlaybackHistoryEntry[]>([]);
  const loadingHistory = ref(false);
  const historyError = ref('');
  const deletingHistoryId = ref('');
  const toast = useToast();
  let mounted = false;

  const refreshHistory = async (silent = false) => {
    if (!enabled.value) return;
    if (!silent) loadingHistory.value = true;
    try {
      history.value = await PlaybackHistoryService.list();
      historyError.value = '';
    } catch (error) {
      historyError.value = '观看记录加载失败，请检查网络后重试。';
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
    if (deletingHistoryId.value) return;
    deletingHistoryId.value = id;
    try {
      history.value = await PlaybackHistoryService.remove(id);
      toast.show('观看记录已删除', '✓');
    } catch {
      toast.show('观看记录删除失败，请稍后重试', '!');
    } finally {
      deletingHistoryId.value = '';
    }
  };

  const sync = () => {
    if (!enabled.value) {
      history.value = [];
      historyError.value = '';
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

  return { history, continueWatching, historyError, deletingHistoryId, loadingHistory, refreshHistory, updateLocalHistory, removeHistory };
};
