<script setup lang="ts">
import type { CatalogItem } from '../../types/catalog';
import CinemaStill from '../common/CinemaStill.vue';
defineProps<{ item: CatalogItem; inLibrary?: boolean }>();
defineEmits<{ (event: 'select', item: CatalogItem): void }>();
</script>
<template>
  <button type="button" class="catalog-card" @click="$emit('select', item)" :aria-label="'查看《' + item.title + '》'">
    <CinemaStill :poster="item.poster" :backdrop="item.backdrop" :label="item.status">
      <span v-if="inLibrary" class="saved-label">已入库</span>
    </CinemaStill>
    <strong :title="item.title">{{ item.title }}</strong>
    <span v-if="item.subtitle || item.platforms?.length || item.rating || item.year" class="catalog-caption">
      <small>{{ item.subtitle || item.platforms?.map(platform => platform.name).join(' · ') || item.year }}</small>
      <small v-if="item.rating" class="catalog-score" :aria-label="(item.ratingSource || '豆瓣') + '评分 ' + item.rating.toFixed(1)">{{ item.rating.toFixed(1) }} 分</small>
    </span>
  </button>
</template>
<style scoped>
.catalog-caption { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; width: 100%; color: var(--text-secondary); font-size: .75rem; }
.catalog-caption small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: inherit; }
.catalog-caption .catalog-score { color: var(--liquid-accent); flex-shrink: 0; }
</style>
