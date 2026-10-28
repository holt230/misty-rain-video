import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { sameMediaIdentity } from '../services/historyIdentity';
import type { MediaItem, PlaybackHistoryEntry } from '../types/media';
import { PlaybackHistoryService } from '../services/playbackHistoryService';
import { useToast } from './useToast';

export const usePlaybackHistory = (enabled: Ref<boolean>) => {
  const history = ref<PlaybackHistoryEntry[]>([]);
  const loadingHistory = ref(false);
  const historyError = ref('');
  const deletingHistoryId = ref('');
  const toast = useToast();
  let mounted = false;
  let lifecycle=0;
  let historyRevision = 0;
  let refreshTask: Promise<void> | null = null;
  let removedMedia: Array<Pick<MediaItem, 'id' | 'quarkFid' | 'catalogId'>> = [];

  const refreshHistory = (silent = false): Promise<void> => {
    if (!enabled.value) return Promise.resolve();
    if (refreshTask) return refreshTask;
    const revision = ++historyRevision;
    if (!silent) loadingHistory.value = true;
    const task: Promise<void> = Promise.resolve().then(async () => {
    try {
      const entries = await PlaybackHistoryService.list();
      if (revision !== historyRevision || !enabled.value) return;
      history.value = entries.filter(entry => !removedMedia.some(media => sameMediaIdentity(entry.media, media)));
      historyError.value = '';
    } catch (error) {
      if (revision !== historyRevision) return;
      historyError.value = '观看记录加载失败，请检查网络后重试。';
      console.warn('[playback-history] 读取失败:', error);
    } finally {
      if (refreshTask === task) { refreshTask = null; loadingHistory.value = false; }
    }
    }); refreshTask = task; return task;
  };

  const continueWatching = computed(() => history.value
    .filter(entry => !entry.completed && entry.position >= 5 && entry.duration > 0)
    .slice(0, 8));

  const updateLocalHistory = (entry: PlaybackHistoryEntry) => {
    if (!enabled.value || removedMedia.some(media => sameMediaIdentity(entry.media, media))) return;
    historyRevision++;
    history.value = [entry, ...history.value.filter(item => item.id !== entry.id)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  };

  const removeLocalMediaHistory = (media: MediaItem) => {
    historyRevision += 1;
    removedMedia.push({ id: media.id, quarkFid: media.quarkFid, catalogId: media.catalogId });
    history.value = history.value.filter(entry => !sameMediaIdentity(entry.media, media));
    loadingHistory.value = false;
  };

  const removeHistory = async (id: string) => {
    if (deletingHistoryId.value) return;
    deletingHistoryId.value = id;
    try {
      await PlaybackHistoryService.remove(id);
      historyRevision++; history.value = history.value.filter(entry => entry.id !== id);
      toast.show('观看记录已删除', '✓');
    } catch {
      toast.show('观看记录删除失败，请稍后重试', '!');
    } finally {
      deletingHistoryId.value = '';
    }
  };

  const removeHistoryBatch = async (ids:string[]) => {
    const targets=[...new Set(ids)].filter(id=>history.value.some(entry=>entry.id===id));
    if(!enabled.value||deletingHistoryId.value||!targets.length)return {deleted:[],failed:targets};
    const scope=lifecycle,deleted:string[]=[],failed:string[]=[];
    deletingHistoryId.value='batch';historyRevision++;
    let cursor=0;
    const worker=async()=>{while(cursor<targets.length&&scope===lifecycle&&enabled.value){const id=targets[cursor++]!;
      try{await PlaybackHistoryService.remove(id);deleted.push(id);if(scope===lifecycle){historyRevision++;history.value=history.value.filter(entry=>entry.id!==id);}}
      catch{failed.push(id);}
    }};
    try{await Promise.all(Array.from({length:Math.min(3,targets.length)},worker));
      if(scope===lifecycle)toast.show(failed.length?`已删除 ${deleted.length} 条，${failed.length} 条未完成`:`已删除 ${deleted.length} 条记录`,failed.length?'!':'✓');
      return {deleted,failed};
    }finally{if(scope===lifecycle)deletingHistoryId.value='';}
  };

  const sync = () => {
    lifecycle++;deletingHistoryId.value='';
    if (!enabled.value) {
      historyRevision += 1; refreshTask = null;
      removedMedia = [];
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
    mounted = false;lifecycle++;
    window.removeEventListener('focus', onFocus);
  });

  return { history, continueWatching, historyError, deletingHistoryId, loadingHistory, refreshHistory, updateLocalHistory, removeHistory, removeHistoryBatch, removeLocalMediaHistory };
};
