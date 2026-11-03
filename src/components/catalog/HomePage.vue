<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRight, ChevronLeft, ChevronRight, Play, RefreshCw } from '@lucide/vue';
import type { CatalogChannel, CatalogFeed, CatalogItem } from '../../types/catalog';
import type { MediaItem, PlaybackHistoryEntry } from '../../types/media';
import { catalogChannels } from '../../composables/useCatalog';
import { findCatalogMedia } from '../../services/catalogMatching';
import { useFeaturedCarousel } from '../../composables/useFeaturedCarousel';
import CatalogCard from './CatalogCard.vue';
import MediaPoster from '../common/MediaPoster.vue';
const props = defineProps<{
  feeds: Partial<Record<CatalogChannel, CatalogFeed>>; loading: CatalogChannel[];
  library: MediaItem[]; history: PlaybackHistoryEntry[]; active?: boolean;
}>();
const emit = defineEmits<{
  (event: 'select', item: CatalogItem): void; (event: 'play', item: MediaItem): void;
  (event: 'continue', entry: PlaybackHistoryEntry): void; (event: 'search'): void;
  (event: 'history'): void; (event: 'refresh'): void;
}>();
const selected = ref<CatalogChannel | 'all'>('all');
const carouselRoot = ref<HTMLElement | null>(null);
const tabs: { id: CatalogChannel | 'all'; label: string }[] = [
  { id: 'all', label: '精选' }, { id: 'tv', label: '电视剧' }, { id: 'movie', label: '电影' },
  { id: 'anime', label: '动漫' }, { id: 'variety', label: '综艺' }
];
const sections = computed(() => catalogChannels.filter(channel => selected.value === 'all' || channel.id === selected.value));
const heroes = computed(() => props.feeds[selected.value === 'all' ? 'tv' : selected.value]?.items.slice(0, 5) || []);
const carousel = useFeaturedCarousel(() => heroes.value.map(item => item.id), () => props.active !== false, carouselRoot);
const { index: heroIndex, running: autoplayRunning } = carousel;
const hero = computed(() => heroes.value[heroIndex.value] || heroes.value[0]);
const continuing = computed(() => props.history.filter(entry => !entry.completed && entry.position > 5).slice(0, 8));
const updates = computed(() => props.library.filter(item => (item.newEpisodeCount || 0) > 0).slice(0, 8));
const hasMedia = (item: CatalogItem) => Boolean(findCatalogMedia(item, props.library));
const channelDate = (channel: CatalogChannel) => {
  const value = props.feeds[channel]?.updatedAt;
  return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date(value)) : '';
};
function more(channel: CatalogChannel) { selected.value = channel; carousel.select(0); window.scrollTo({ top: 0, behavior: 'smooth' }); }
</script>
<template>
  <main class="discovery-page">
    <nav class="channel-nav" aria-label="影视频道">
      <button v-for="tab in tabs" :key="tab.id" type="button" :class="{ active: selected === tab.id }" :aria-pressed="selected === tab.id" @click="selected = tab.id; carousel.select(0)">{{ tab.label }}</button>
    </nav>
    <div ref="carouselRoot" class="feature-carousel" role="region" aria-roledescription="轮播图" aria-label="首页精选推荐" @pointerenter="carousel.enter" @pointerleave="carousel.leave" @focusin="carousel.focus" @focusout="carousel.blur" @pointerdown="carousel.press" @pointerup="carousel.release" @pointercancel="carousel.release">
    <section v-if="hero" class="feature-film" aria-label="焦点影片" :aria-live="autoplayRunning ? 'off' : 'polite'">
      <Transition name="hero-art"><MediaPoster :key="hero.id" :src="hero.poster" alt="" class="feature-art" fetchpriority="high" /></Transition>
      <div class="feature-shade"></div>
      <Transition name="hero-copy" mode="out-in"><div :key="hero.id" class="feature-copy">
        <span class="eyebrow">今晚 · 看点好故事</span>
        <h1>{{ hero.title }}</h1>
        <p>{{ hero.subtitle || hero.status || '在这里，发现下一部喜欢的作品' }}</p>
        <div class="feature-actions">
          <button class="cinema-button primary" type="button" @click="emit('select', hero)"><Play fill="currentColor" />查看影片</button>
          <span v-if="hero.rating" class="feature-rating">{{ hero.rating.toFixed(1) }}<small>豆瓣评分</small></span>
        </div>
      </div></Transition>
      <div v-if="heroes.length > 1" class="feature-controls">
      <div class="feature-pagination" aria-label="焦点影片切换">
        <button v-for="(item, index) in heroes" :key="item.id" type="button" :aria-label="'查看焦点影片：' + item.title" :aria-pressed="hero.id === item.id" :class="{ active: hero.id === item.id }" @click="carousel.select(index)"><span></span></button>
      </div>
      <span class="feature-counter">{{ String(heroIndex + 1).padStart(2, '0') }} / {{ String(heroes.length).padStart(2, '0') }}</span>
      <div class="feature-arrows">
        <button type="button" aria-label="上一部焦点影片" @click="carousel.step(-1)"><ChevronLeft /></button>
        <button type="button" aria-label="下一部焦点影片" @click="carousel.step(1)"><ChevronRight /></button>
      </div>
      </div>
    </section>
    <div v-else-if="loading.length" class="hero-skeleton skeleton-surface" role="status" aria-label="正在加载热门影视"></div>
    <nav v-if="heroes.length > 1" class="feature-choices" aria-label="精选片单">
      <button v-for="(item, index) in heroes" :key="item.id" type="button" :class="{ active: hero?.id === item.id }" :aria-pressed="hero?.id === item.id" @click="carousel.select(index)">
        <span class="feature-choice-number">{{ String(index + 1).padStart(2, '0') }}</span><span><strong>{{ item.title }}</strong><small>{{ item.rating ? item.rating.toFixed(1) + ' 分 · ' : '' }}{{ item.status || item.year || '查看影片' }}</small></span>
      </button>
    </nav>
    </div>
    <section v-if="continuing.length && selected === 'all'" class="content-section">
      <div class="section-heading"><div><h2>接着上次看</h2><p>好故事，继续发生</p></div><button type="button" class="text-link" @click="emit('history')">全部记录<ArrowRight /></button></div>
      <div class="continue-rail">
        <button v-for="entry in continuing" :key="entry.id" type="button" class="resume-card" @click="emit('continue', entry)">
          <MediaPoster :src="entry.media.poster" alt="" loading="lazy" />
          <span><strong>{{ entry.media.title }}</strong><small>{{ entry.episodeTitle || '继续观看' }} · {{ Math.floor(entry.position / 60) }}分钟</small><i><b :style="{ width: Math.min(100, entry.position / (entry.duration || 1) * 100) + '%' }"></b></i></span><Play />
        </button>
      </div>
    </section>
    <section v-if="updates.length && selected === 'all'" class="content-section">
      <div class="section-heading"><div><h2>追的剧更新了</h2><p>你的片库有新内容</p></div></div>
      <div class="continue-rail"><button v-for="item in updates" :key="item.id" type="button" class="resume-card" @click="emit('play', item)"><MediaPoster :src="item.poster" alt="" loading="lazy" /><span><strong>{{ item.title }}</strong><small>发现 {{ item.newEpisodeCount }} 集新内容 · 可在更多中补集</small></span><Play /></button></div>
    </section>
    <section v-for="section in sections" :key="section.id" class="content-section">
      <div class="section-heading"><div><h2>{{ section.title }}</h2><p>{{ section.subtitle }}</p></div><span v-if="feeds[section.id]?.items.length" class="source-caption">豆瓣 · {{ channelDate(section.id) }}</span></div>
      <p v-if="feeds[section.id]?.message" class="feed-notice" role="status">{{ feeds[section.id]?.message }}</p>
      <div v-if="feeds[section.id]?.items.length" class="catalog-grid">
        <CatalogCard v-for="item in feeds[section.id]?.items.slice(0, selected === 'all' ? 6 : 24)" :key="item.id" :item="item" :in-library="hasMedia(item)" @select="emit('select', $event)" />
      </div>
      <div v-else-if="loading.includes(section.id)" class="catalog-grid" aria-label="正在加载影片"><div v-for="n in 6" :key="n" class="poster-skeleton skeleton-surface"></div></div>
      <div v-else class="catalog-empty"><p>暂时没有获取到这个频道的内容</p><button type="button" class="cinema-button secondary" :disabled="loading.length > 0" @click="emit('refresh')"><RefreshCw />重新加载</button><button type="button" class="text-link" @click="emit('search')">搜索想看的影片<ArrowRight /></button></div>
      <button v-if="selected === 'all' && feeds[section.id]?.items.length" type="button" class="more-films" @click="more(section.id)">更多{{ section.title }}<ArrowRight /></button>
    </section>
    <p class="catalog-footnote">影视资料来自豆瓣 · 片源将在播放前查找与验证</p>
  </main>
</template>
