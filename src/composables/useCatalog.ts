import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { authFetch } from '../services/authService';
import { apiUrl, withAppBase } from '../services/appUrl';
import type { CatalogChannel, CatalogFeed } from '../types/catalog';

export const catalogChannels: { id: CatalogChannel; title: string; subtitle: string }[] = [
  { id: 'tv', title: '最近热门剧集', subtitle: '发现正在被讨论的好故事' },
  { id: 'movie', title: '热门电影', subtitle: '给自己留一部电影的时间' },
  { id: 'anime', title: '动漫放映室', subtitle: '去另一个世界，遇见新的故事' },
  { id: 'variety', title: '综艺时光', subtitle: '轻松一下，快乐不散场' },
  { id: 'new', title: '新片速递', subtitle: '换一种心情，发现新片' }
];
export function useCatalog(enabled: Ref<boolean>) {
  const feeds = ref<Partial<Record<CatalogChannel, CatalogFeed>>>({});
  const loading = ref<CatalogChannel[]>([]);
  let generation = 0;
  const controllers = new Set<AbortController>();
  const followups = new Map<CatalogChannel, ReturnType<typeof setTimeout>>();
  const cancel = () => {
    controllers.forEach(controller => controller.abort());
    controllers.clear();
    followups.forEach(timer => clearTimeout(timer));
    followups.clear();
  };
  const readChannel = async (channel: CatalogChannel, current: number, attempt = 0) => {
    if (current !== generation || !enabled.value) return;
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await authFetch(apiUrl('/api/catalog?channel=' + channel), { signal: controller.signal });
      const body = await response.json();
      if (!response.ok || body.code !== 0 || !Array.isArray(body.data?.items)) throw new Error('目录加载失败');
      if (current !== generation) return;
      feeds.value[channel] = {
        ...body.data, items: body.data.items.map((item: CatalogFeed['items'][number]) => ({ ...item, poster: withAppBase(item.poster) }))
      };
      if (body.data.refreshing && attempt < 5) {
        followups.set(channel, setTimeout(() => {
          followups.delete(channel);
          void readChannel(channel, current, attempt + 1);
        }, 4_000));
      } else if (body.data.refreshing) {
        feeds.value[channel]!.refreshing = false;
        feeds.value[channel]!.message = '已显示缓存内容，目录仍在更新，可稍后重新加载';
      }
    } catch {
      if (current === generation) feeds.value[channel] = {
        channel, items: feeds.value[channel]?.items || [], updatedAt: feeds.value[channel]?.updatedAt || '',
        stale: true, refreshing: false, message: '此频道暂时无法更新，可稍后重试或使用找片'
      };
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
      if (current === generation) loading.value = loading.value.filter(id => id !== channel);
    }
  };
  const refresh = async () => {
    const current = ++generation;
    cancel();
    if (!enabled.value) return;
    loading.value = catalogChannels.map(channel => channel.id);
    await Promise.all(catalogChannels.map(channel => readChannel(channel.id, current)));
  };
  watch(enabled, value => {
    if (value) void refresh();
    else { generation++; cancel(); loading.value = []; }
  }, { immediate: true });
  onBeforeUnmount(() => { generation++; cancel(); });
  return { feeds, loading, refresh };
}
