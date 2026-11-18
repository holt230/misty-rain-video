<script setup lang="ts">
import { ArrowUpRight } from '@lucide/vue';
import type { CatalogItem } from '../../types/catalog';
import MediaPoster from '../common/MediaPoster.vue';
defineProps<{ item: CatalogItem; inLibrary?: boolean }>();
defineEmits<{ (event: 'select', item: CatalogItem): void }>();
</script>
<template>
  <button type="button" class="catalog-card" @click="$emit('select', item)" :aria-label="'查看《' + item.title + '》'">
    <span class="catalog-poster">
      <MediaPoster :src="item.poster" alt="" loading="lazy" decoding="async" />
      <span v-if="inLibrary" class="saved-label">已入库</span>
      <span v-if="item.rating" class="catalog-rating">{{ item.rating.toFixed(1) }}<small>{{ item.ratingSource || '豆瓣' }}</small></span>
      <span v-if="item.platforms?.length" class="catalog-platforms">{{ item.platforms.slice(0, 2).map(platform => platform.name).join(' · ') }}{{ item.platforms.length > 2 ? ' 等' : '' }}</span>
      <span class="catalog-hover" aria-hidden="true"><ArrowUpRight />查看详情</span>
    </span>
    <strong>{{ item.title }}</strong>
    <small>{{ item.status || item.subtitle || '查看影片详情' }}</small>
  </button>
</template>
<style scoped>
.catalog-platforms { position: absolute; bottom: 9px; left: 8px; max-width: calc(100% - 16px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 5px 8px; border: 1px solid rgb(255 255 255 / .12); border-radius: 8px; background: rgb(15 17 20 / .8); color: #fff; font-size: 9px; backdrop-filter: blur(12px); }
</style>
