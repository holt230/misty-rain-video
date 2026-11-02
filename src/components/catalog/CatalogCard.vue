<script setup lang="ts">
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
      <span v-if="item.rating" class="catalog-rating">{{ item.rating.toFixed(1) }}<small>豆瓣</small></span>
    </span>
    <strong>{{ item.title }}</strong>
    <small>{{ item.status || item.subtitle || '查看影片详情' }}</small>
  </button>
</template>
