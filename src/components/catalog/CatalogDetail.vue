<script setup lang="ts">
import { ref } from 'vue';
import { ArrowLeft, ExternalLink, Play, Search } from '@lucide/vue';
import type { CatalogItem } from '../../types/catalog';
import { useDialog } from '../../composables/useDialog';
import MediaPoster from '../common/MediaPoster.vue';
defineProps<{ item: CatalogItem; inLibrary: boolean }>();
const emit = defineEmits<{ (event: 'close'): void; (event: 'play'): void; (event: 'sources'): void }>();
const root = ref<HTMLElement | null>(null);
useDialog(root, () => true, () => emit('close'));
</script>
<template>
  <section ref="root" class="catalog-detail screen-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-detail-title">
    <header class="screen-header"><button type="button" class="icon-control" aria-label="返回浏览" @click="emit('close')"><ArrowLeft /></button><span>影片详情</span></header>
    <div class="detail-stage">
      <MediaPoster :src="item.poster" alt="" class="detail-backdrop" />
      <div class="detail-stage-shade"></div>
      <div class="detail-overview"><MediaPoster :src="item.poster" :alt="item.title + '海报'" class="detail-poster" /><div><span class="eyebrow">{{ item.year || '发现好故事' }}</span><h1 id="catalog-detail-title">{{ item.title }}</h1><p>{{ item.status || '影片资料' }}</p><span v-if="item.rating" class="detail-score">{{ item.rating.toFixed(1) }}<small>豆瓣评分</small></span></div></div>
    </div>
    <div class="detail-body">
      <button type="button" class="cinema-button primary play-feature" @click="emit('play')"><Play fill="currentColor" />{{ inLibrary ? '立即播放 / 续播' : '找源并播放' }}</button>
      <p class="detail-play-note">{{ inLibrary ? '从你的个人片库播放，自动恢复观看进度' : '自动查找匹配资源，验证后加入个人片库并播放' }}</p>
      <section class="detail-information"><h2>影片信息</h2><p>{{ item.subtitle || '此来源暂未提供更多影片资料。' }}</p><p v-if="item.status">来源收录状态：{{ item.status }}。可播放集数以实际片源为准。</p></section>
      <button type="button" class="cinema-button secondary" @click="emit('sources')"><Search />自己选择片源</button>
      <a :href="item.sourceUrl" target="_blank" rel="noopener noreferrer" class="detail-source">查看豆瓣资料<ExternalLink /></a>
    </div>
  </section>
</template>
