<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowRight, Play, RefreshCw } from '@lucide/vue';
import type { CatalogBrowseState, CatalogChannel, CatalogFeed, CatalogItem, CatalogPlatform } from '../../types/catalog';
import type { MediaItem, PlaybackHistoryEntry } from '../../types/media';
import { catalogChannels } from '../../composables/useCatalog';
import { findCatalogMedia } from '../../services/catalogMatching';
import { useFeaturedCarousel } from '../../composables/useFeaturedCarousel';
import { cinemaBackdrop, cinemaWatchProgress, type CinemaBackdrops } from '../../services/cinemaPresentation';
import CatalogCard from './CatalogCard.vue';
import MediaPoster from '../common/MediaPoster.vue';
const props = defineProps<{
  feeds: Partial<Record<CatalogChannel, CatalogFeed>>; loading: CatalogChannel[];
  browse: Partial<Record<CatalogChannel, CatalogBrowseState>>;
  library: MediaItem[]; history: PlaybackHistoryEntry[]; backdrops?: CinemaBackdrops; active?: boolean; platform?: CatalogPlatform | 'all';
}>();
const emit = defineEmits<{
  (event: 'platform', platform: CatalogPlatform | 'all'): void;
  (event: 'select', item: CatalogItem): void; (event: 'play', item: MediaItem): void;
  (event: 'continue', entry: PlaybackHistoryEntry): void; (event: 'search'): void;
  (event: 'history'): void; (event: 'refresh'): void;
  (event: 'load-more', channel: CatalogChannel): void; (event: 'refresh-channel', channel: CatalogChannel): void;
}>();
const platforms: { id: CatalogPlatform | 'all'; label: string; compact: string }[] = [
  { id: 'all', label: '全部平台', compact: '全部' }, { id: 'qq', label: '腾讯视频', compact: '腾讯' }, { id: 'mango', label: '芒果TV', compact: '芒果' },
  { id: 'youku', label: '优酷', compact: '优酷' }, { id: 'iqiyi', label: '爱奇艺', compact: '爱奇艺' }
];
const selected = ref<CatalogChannel | 'all'>('all');
const channelNav = ref<HTMLElement | null>(null);
const carouselRoot = ref<HTMLElement | null>(null);
const tabs: { id: CatalogChannel | 'all'; label: string }[] = [
  { id: 'all', label: '精选' }, { id: 'tv', label: '电视剧' }, { id: 'movie', label: '电影' },
  { id: 'anime', label: '动漫' }, { id: 'variety', label: '综艺' }, { id: 'new', label: '新片' }
];
const sections = computed(() => catalogChannels.filter(channel => selected.value === 'all' || channel.id === selected.value));
const heroes = computed(() => props.feeds[selected.value === 'all' ? 'tv' : selected.value]?.items.slice(0, 5) || []);
const carousel = useFeaturedCarousel(() => heroes.value.map(item => item.id), () => props.active !== false, carouselRoot);
const { index: heroIndex, running: autoplayRunning } = carousel;
const hero = computed(() => heroes.value[heroIndex.value] || heroes.value[0]);
let swipedFeature = false;
const pressFeature = (event: PointerEvent) => { swipedFeature = false; carousel.press(event); };
const releaseFeature = (event: PointerEvent) => { swipedFeature = carousel.release(event); };
const openFeature = (event: MouseEvent, item: CatalogItem) => {
  if (!swipedFeature || event.detail === 0) emit('select', item);
};
const selectFeature = (event: MouseEvent, index: number) => {
  if (!swipedFeature || event.detail === 0) carousel.select(index);
};
const continuing = computed(() => props.history.filter(entry => !entry.completed && entry.position > 5).slice(0, 8));
const updates = computed(() => props.library.filter(item => (item.newEpisodeCount || 0) > 0).slice(0, 8));
const hasMedia = (item: CatalogItem) => Boolean(findCatalogMedia(item, props.library));
const channelDate = (channel: CatalogChannel) => {
  const value = props.feeds[channel]?.updatedAt;
  return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date(value)) : '';
};
watch(() => props.platform, () => {
  channelScroll.clear(); carousel.select(0);
}, { flush: 'post' });
const channelScroll = new Map<CatalogChannel | 'all', number>();
let navigation = 0;
async function selectChannel(channel: CatalogChannel | 'all') {
  if (selected.value === channel) return;
  const ticket = ++navigation;
  channelScroll.set(selected.value, window.scrollY);
  selected.value = channel; carousel.select(0);
  await nextTick();
  if (ticket === navigation) {
    window.scrollTo({ top: channelScroll.get(channel) || 0 });
    channelNav.value?.querySelector<HTMLElement>('button.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
function refreshChannel(channel: CatalogChannel) {
  channelScroll.set(channel, 0); emit('refresh-channel', channel); window.scrollTo({ top: 0 });
}
const channelItems = (channel: CatalogChannel) => selected.value === 'all' ? props.feeds[channel]?.items.slice(0, 6) || [] : props.browse[channel]?.items || props.feeds[channel]?.items || [];
onBeforeUnmount(() => { navigation++; });
</script>
<template>
  <main class="discovery-page">
    <nav ref="channelNav" class="channel-nav" aria-label="影视频道">
      <button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: selected === tab.id }" :aria-pressed="selected === tab.id" @click="selectChannel(tab.id)">{{ tab.label }}</button>
    </nav>
    <div ref="carouselRoot" class="feature-carousel" role="region" aria-roledescription="轮播图" aria-label="首页精选推荐" @pointerenter="carousel.enter" @pointerleave="carousel.leave" @focusin="carousel.focus" @focusout="carousel.blur" @pointerdown="pressFeature" @pointerup="releaseFeature" @pointercancel="carousel.release()">
      <section v-if="hero" class="feature-film" :class="{ 'from-poster': !hero.backdrop || hero.backdrop === hero.poster }" aria-label="焦点影片" :aria-live="autoplayRunning ? 'off' : 'polite'">
        <Transition name="hero-art"><MediaPoster :key="hero.id" :src="hero.backdrop || hero.poster" alt="" class="feature-art" fetchpriority="high" /></Transition>
        <div class="feature-shade" aria-hidden="true"></div>
        <Transition name="hero-copy" mode="out-in">
          <div :key="hero.id" class="feature-copy" :class="{ 'with-pagination': heroes.length > 1 }">
            <span class="feature-kicker">本期推荐</span>
            <h1 :class="{ long: hero.title.length > 9 }">{{ hero.title }}</h1>
            <p>{{ hero.subtitle || hero.status || '查看影片详情' }}</p>
          </div>
        </Transition>
        <button class="feature-open" type="button" :aria-label="'查看《' + hero.title + '》'" @click="openFeature($event, hero)"></button>
        <div v-if="heroes.length > 1" class="feature-pagination" role="group" aria-label="焦点影片切换">
          <button v-for="(item, index) in heroes" :key="item.id" type="button" :aria-label="'查看焦点影片：' + item.title" :aria-pressed="hero.id === item.id" :class="{ active: hero.id === item.id }" @click="selectFeature($event, index)"><span></span></button>
        </div>
      </section>
      <div v-else-if="loading.length" class="hero-skeleton skeleton-surface" role="status" aria-label="正在加载热门影视"></div>
    </div>
    <section v-if="continuing.length && selected === 'all'" class="content-section home-continue">
      <div class="section-heading"><h2>继续观看</h2><button type="button" class="text-link" @click="emit('history')">观看历史<ArrowRight /></button></div>
      <div class="continue-rail">
        <button v-for="entry in continuing" :key="entry.id" type="button" class="resume-card" @click="emit('continue', entry)">
          <MediaPoster :src="cinemaBackdrop(entry.media, backdrops) || entry.media.poster" alt="" loading="lazy" />
          <span><strong>{{ entry.media.title }}</strong><small>{{ entry.episodeNumber > 0 ? '第 ' + entry.episodeNumber + ' 集' : (entry.episodeTitle || '正片') }}<template v-if="cinemaWatchProgress(entry) !== undefined"> · 已看 {{ Math.round(cinemaWatchProgress(entry) || 0) }}%</template></small><i v-if="cinemaWatchProgress(entry) !== undefined" aria-hidden="true"><b :style="{ width: cinemaWatchProgress(entry) + '%' }"></b></i></span><span class="home-resume-play" aria-hidden="true"><Play fill="currentColor" /></span>
        </button>
      </div>
    </section>
    <nav class="platform-nav" :class="{ 'platform-featured': selected === 'all' && (!platform || platform === 'all') }" aria-label="播出平台"><button v-for="platform in platforms" :key="platform.id" type="button" :aria-label="platform.label" :aria-pressed="(props.platform || 'all') === platform.id" :class="{ active: (props.platform || 'all') === platform.id }" @click="emit('platform', platform.id)"><span class="platform-full">{{ platform.label }}</span><span class="platform-compact" aria-hidden="true">{{ platform.compact }}</span></button></nav>
    <div v-if="updates.length && selected === 'all'" class="home-update-rail" aria-label="发现新剧集">
      <button v-for="item in updates" :key="item.id" type="button" class="text-link" @click="emit('play', item)">
        <strong>{{ item.title }}</strong><span>找到 {{ item.newEpisodeCount }} 集</span><ArrowRight aria-hidden="true" />
      </button>
    </div>
    <section v-for="section in sections" :key="section.id" class="content-section">
      <div class="section-heading"><h2>{{ section.title }}</h2><span v-if="channelDate(section.id) && channelItems(section.id).length" class="source-caption">更新于 {{ channelDate(section.id) }}</span></div>
      <p v-if="selected !== 'all' && feeds[section.id]?.message && channelItems(section.id).length" class="feed-notice" role="status">部分片单暂未更新，已显示此前的内容。</p>
      <div v-if="channelItems(section.id).length" class="catalog-grid">
        <CatalogCard v-for="item in channelItems(section.id)" :key="item.id" :item="item" :in-library="hasMedia(item)" @select="emit('select', $event)" />
      </div>
      <div v-else-if="loading.includes(section.id)" class="catalog-grid" aria-label="正在加载影片"><div v-for="n in 6" :key="n" class="poster-skeleton skeleton-surface"></div></div>
      <div v-else class="catalog-empty"><p>暂时没有影片可显示。</p><button type="button" class="cinema-button secondary" :disabled="loading.length > 0" @click="emit('refresh')"><RefreshCw />重新加载</button><button type="button" class="text-link" @click="emit('search')">搜索影片<ArrowRight /></button></div>
      <button v-if="selected === 'all' && feeds[section.id]?.items.length" type="button" class="more-films" @click="selectChannel(section.id)">更多{{ section.title }}<ArrowRight /></button>
      <div v-if="selected !== 'all' && channelItems(section.id).length" class="catalog-page-footer">
        <div v-if="browse[section.id]?.needsRefresh" class="catalog-update-note" role="status"><span>目录已有新内容，当前列表已保留。</span><button type="button" class="text-link" :disabled="loading.includes(section.id)" @click="refreshChannel(section.id)"><RefreshCw />更新此频道</button></div>
        <template v-else>
          <p v-if="browse[section.id]?.error" class="catalog-page-note" role="status">{{ browse[section.id]?.error }}</p>
          <button v-if="browse[section.id]?.hasMore" type="button" class="more-films" :disabled="browse[section.id]?.loading || loading.includes(section.id) || feeds[section.id]?.refreshing" @click="emit('load-more', section.id)">{{ browse[section.id]?.loading ? '正在加载更多…' : feeds[section.id]?.refreshing || loading.includes(section.id) ? '正在更新目录…' : browse[section.id]?.error ? '重试加载' : '加载更多影片' }}<ArrowRight v-if="!browse[section.id]?.loading" /></button>
          <button v-else-if="browse[section.id]?.error" type="button" class="text-link" :disabled="loading.includes(section.id)" @click="refreshChannel(section.id)"><RefreshCw />重新加载频道</button>
          <p v-else class="catalog-page-note" role="status">{{ browse[section.id]?.endMessage || '已显示全部可用影片' }}</p>
        </template>
        <small>已展示 {{ channelItems(section.id).length }} 部影片</small>
      </div>
    </section>
    <p class="catalog-footnote">片单来自各播出平台 · 影片资料及短评由豆瓣补充</p>
  </main>
</template>
<style scoped>
.channel-nav { position: sticky; z-index: 25; top: var(--cinema-header-offset); }
.feature-carousel { margin-top: 9px; }
.feature-open { position: absolute; inset: 0; z-index: 1; border: 0; border-radius: inherit; background: transparent; }
.feature-open:focus-visible { outline-offset: -4px; }
.feature-copy { pointer-events: none; }
.feature-kicker { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; color: var(--cinema-progress); font-size: 11px; font-weight: 650; letter-spacing: .14em; }
.feature-kicker::before { content: ''; width: 14px; height: 1px; background: currentColor; }
.platform-nav { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0; margin-top: 15px; scrollbar-width: none; }
.platform-nav::-webkit-scrollbar { display: none; }
.platform-compact { display: none; }
.platform-nav button { flex: 0 0 auto; min-height: 44px; padding: 6px 13px; border: 0; border-radius: 22px; background: var(--cinema-field); color: var(--text-secondary); font-size: 12px; }
.platform-nav button.active { color: var(--liquid-accent); background: var(--liquid-accent-subtle); font-weight: 650; }
.platform-nav button:focus-visible { outline: 2px solid var(--liquid-accent); outline-offset: -2px; }
.home-continue { margin-top: 16px; }
.home-continue .section-heading { margin-bottom: 6px; }
.home-continue .continue-rail { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 4px; margin-inline: -2px; scrollbar-width: none; }
.home-continue .continue-rail::-webkit-scrollbar { display: none; }
.home-continue .resume-card { flex: 0 0 min(345px, 100%); min-width: 0; min-height: 70px; padding: 8px; gap: 10px; border-radius: var(--cinema-radius-control); }
.home-continue .resume-card :deep(img) { width: clamp(70px, 22vw, 92px); height: 52px; object-position: 50% 40%; }
.home-continue .resume-card > span { gap: 2px; }
.home-continue .resume-card small { color: var(--text-secondary); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.home-continue .resume-card i { height: 2px; margin-top: 4px; }
.home-continue .resume-card .home-resume-play { display: grid; place-items: center; flex: 0 0 36px; height: 36px; margin: 0 2px; border-radius: 50%; background: var(--liquid-accent); color: var(--accent-ink); }
.home-resume-play :deep(svg) { width: 15px; height: 15px; }
.home-update-rail { display: flex; gap: 12px; overflow-x: auto; margin-top: 4px; scrollbar-width: none; }
.home-update-rail button { flex: 0 0 auto; max-width: 100%; }
.home-update-rail strong { color: var(--text-primary); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.home-update-rail span { color: var(--liquid-accent); }
.home-update-rail + .content-section { margin-top: 13px; }
.catalog-page-footer { margin-top: 22px; text-align: center; }
.catalog-page-footer > .more-films { margin-top: 10px; }
.catalog-page-footer > small { display: block; margin-top: 12px; color: var(--text-tertiary); font-size: 11px; }
.catalog-page-note { color: var(--text-secondary); font-size: 12px; line-height: 1.8; padding: 8px 0; }
.catalog-update-note { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 7px; padding: 10px 14px; border-radius: var(--cinema-radius-control); background: var(--surface-1); color: var(--text-secondary); font-size: 12px; text-align: left; }
@media (max-width: 767px) {
  .channel-nav { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 0; }
  .channel-nav button { min-width: 0; min-height: 44px; padding-inline: 0; font-size: 13px; }
  .channel-nav button.active { font-size: 15px; }
  .platform-nav.platform-featured { display: none; }
  .platform-nav { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0; }
  .platform-nav button { min-width: 0; padding: 4px 0; background: transparent; white-space: nowrap; }
  .platform-full { display: none; }
  .platform-compact { display: inline; }
  .home-continue .resume-card { flex-basis: 100%; }
}
</style>
