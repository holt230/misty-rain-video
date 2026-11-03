import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { authFetch } from '../services/authService';
import { apiUrl, withAppBase } from '../services/appUrl';
import type { CatalogBrowseState, CatalogChannel, CatalogFeed } from '../types/catalog';

export const catalogChannels: { id: CatalogChannel; title: string; subtitle: string }[] = [
  { id: 'tv', title: '最近热门剧集', subtitle: '发现正在被讨论的好故事' },
  { id: 'movie', title: '热门电影', subtitle: '给自己留一部电影的时间' },
  { id: 'anime', title: '动漫放映室', subtitle: '去另一个世界，遇见新的故事' },
  { id: 'variety', title: '综艺时光', subtitle: '轻松一下，快乐不散场' },
  { id: 'new', title: '新片速递', subtitle: '换一种心情，发现新片' }
];

export function useCatalog(enabled: Ref<boolean>) {
  const feeds = ref<Partial<Record<CatalogChannel, CatalogFeed>>>({});
  const browse = ref<Partial<Record<CatalogChannel, CatalogBrowseState>>>({});
  const loading = ref<CatalogChannel[]>([]);
  let generation = 0;
  const epochs = new Map<CatalogChannel, number>();
  const controllers = new Map<string, AbortController>();
  const followups = new Map<CatalogChannel, ReturnType<typeof setTimeout>>();
  const cancel = () => {
    controllers.forEach(controller => controller.abort()); controllers.clear();
    followups.forEach(timer => clearTimeout(timer)); followups.clear();
  };
  const current = (channel: CatalogChannel, run: number, epoch: number) => enabled.value && run === generation && epoch === epochs.get(channel);
  const firstState = (feed: CatalogFeed): CatalogBrowseState => ({
    items: [...feed.items], page: 1, revision: feed.revision || '', hasMore: feed.hasMore ?? feed.items.length >= 24,
    loading: false, error: '', needsRefresh: false, endMessage: ''
  });
  const fetchFeed = async (channel: CatalogChannel, page: number, revision: string, controller: AbortController): Promise<CatalogFeed> => {
    const params = new URLSearchParams({ channel, page: String(page) });
    if (revision) params.set('revision', revision);
    const response = await authFetch(apiUrl('/api/catalog?' + params), { signal: controller.signal });
    const body = await response.json();
    if (response.status === 409 || body.code === 'CATALOG_CHANGED') throw Object.assign(new Error('目录已有更新，刷新后可继续浏览'), { code: 'CATALOG_CHANGED' });
    if (!response.ok || body.code !== 0 || !Array.isArray(body.data?.items) || body.data.loadError
      || (body.data.page !== undefined && body.data.page !== page) || (body.data.channel && body.data.channel !== channel)) throw new Error('目录加载失败');
    return { ...body.data, items: body.data.items.map((item: CatalogFeed['items'][number]) => ({ ...item, poster: withAppBase(item.poster) })) };
  };
  const readChannel = async (channel: CatalogChannel, run: number, epoch: number, attempt = 0, reset = false) => {
    if (!current(channel, run, epoch)) return;
    const controller = new AbortController(), key = channel + ':first';
    controllers.set(key, controller);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const feed = await fetchFeed(channel, 1, '', controller);
      if (!current(channel, run, epoch)) return;
      feeds.value[channel] = feed;
      const state = browse.value[channel];
      if (reset || !state || state.page === 1) browse.value[channel] = firstState(feed);
      else if (state.revision !== feed.revision) state.needsRefresh = true;
      if (feed.refreshing && attempt < 5) {
        followups.set(channel, setTimeout(() => {
          followups.delete(channel); void readChannel(channel, run, epoch, attempt + 1, reset);
        }, 4_000));
      } else if (feed.refreshing) {
        feeds.value[channel]!.refreshing = false;
        feeds.value[channel]!.message = '已显示缓存内容，目录仍在更新，可稍后重新加载';
      }
    } catch {
      if (current(channel, run, epoch)) {
        feeds.value[channel] = { ...feeds.value[channel], channel, items: feeds.value[channel]?.items || [], updatedAt: feeds.value[channel]?.updatedAt || '',
          stale: true, refreshing: false, message: '此频道暂时无法更新，可稍后重试或使用找片' };
        if (browse.value[channel]) browse.value[channel]!.error = '目录暂时无法更新，已保留当前列表';
      }
    } finally {
      clearTimeout(timeout);
      if (controllers.get(key) === controller) controllers.delete(key);
      if (current(channel, run, epoch)) loading.value = loading.value.filter(id => id !== channel);
    }
  };
  const refreshChannel = async (channel: CatalogChannel) => {
    if (!enabled.value) return;
    const epoch = (epochs.get(channel) || 0) + 1; epochs.set(channel, epoch);
    for (const [key, controller] of controllers) if (key.startsWith(channel + ':')) { controller.abort(); controllers.delete(key); }
    clearTimeout(followups.get(channel)); followups.delete(channel);
    if (browse.value[channel]) browse.value[channel]!.loading = false;
    if (!loading.value.includes(channel)) loading.value.push(channel);
    await readChannel(channel, generation, epoch, 0, true);
  };
  const loadMore = async (channel: CatalogChannel) => {
    const state = browse.value[channel];
    if (!enabled.value || !state || state.loading || !state.hasMore || state.needsRefresh || feeds.value[channel]?.refreshing || loading.value.includes(channel)) return;
    const run = generation, epoch = epochs.get(channel) || 0, page = state.page + 1;
    const key = channel + ':more', controller = new AbortController();
    controllers.set(key, controller); state.loading = true; state.error = '';
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const feed = await fetchFeed(channel, page, state.revision, controller);
      if (!current(channel, run, epoch)) return;
      if (state.revision && feed.revision !== state.revision) throw Object.assign(new Error('目录已有更新，刷新后可继续浏览'), { code: 'CATALOG_CHANGED' });
      const seen = new Set(state.items.map(item => item.id));
      const additions = feed.items.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
      state.items.push(...additions); state.page = page;
      state.hasMore = Boolean(feed.hasMore) && additions.length > 0;
      if (!state.hasMore) state.endMessage = additions.length || !feed.items.length ? '已显示全部可用影片' : '暂时没有更多不重复的影片';
    } catch (failure) {
      if (!current(channel, run, epoch)) return;
      const changed = (failure as { code?: string }).code === 'CATALOG_CHANGED';
      state.needsRefresh = changed;
      state.error = changed ? '目录已有更新，刷新后可继续浏览' : '这一页暂时加载失败，请重试';
    } finally {
      clearTimeout(timeout); if (controllers.get(key) === controller) controllers.delete(key);
      if (current(channel, run, epoch)) state.loading = false;
    }
  };
  const refresh = async () => {
    generation++; cancel();
    if (!enabled.value) return;
    loading.value = catalogChannels.map(channel => channel.id);
    await Promise.all(catalogChannels.map(channel => refreshChannel(channel.id)));
  };
  watch(enabled, value => {
    if (value) void refresh();
    else { generation++; cancel(); loading.value = []; feeds.value = {}; browse.value = {}; }
  }, { immediate: true });
  onBeforeUnmount(() => { generation++; cancel(); });
  const items = computed(() => catalogChannels.flatMap(channel => browse.value[channel.id]?.items || feeds.value[channel.id]?.items || []));
  return { feeds, browse, items, loading, refresh, refreshChannel, loadMore };
}
