<script setup lang="ts">
import type { CategoryType } from '../../types/media';

defineProps<{
  modelValue: CategoryType;
  counts: Record<CategoryType, number>;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: CategoryType): void;
}>();

const categories: { id: CategoryType; label: string }[] = [
  { id: 'tv', label: '电视剧' },
  { id: 'movie', label: '电影' },
  { id: 'variety', label: '综艺' },
  { id: 'anime', label: '动漫' }
];
</script>

<template>
  <nav class="category-segments glass-rim" aria-label="影片分类" :style="{ '--selected-index': categories.findIndex(cat => cat.id === modelValue) }">
    <span class="segment-lens" aria-hidden="true"></span>
    <button
      v-for="cat in categories"
      :key="cat.id"
      type="button"
      class="segment-item"
      :class="{ active: modelValue === cat.id }"
      :aria-current="modelValue === cat.id ? 'page' : undefined"
      @click="emit('update:modelValue', cat.id)"
    >
      <span class="segment-label">{{ cat.label }}</span>
      <span v-if="counts[cat.id] > 0" class="segment-count">{{ counts[cat.id] }}</span>
    </button>
  </nav>
</template>

<style scoped>
.category-segments { position: relative; display: inline-grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 5px; border: var(--glass-border); border-radius: 28px; background: var(--glass-material); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); box-shadow: var(--glass-highlight-inner); }
.segment-lens { position: absolute; top: 5px; bottom: 5px; left: 5px; width: calc((100% - 10px) / 4); border: var(--glass-border-strong); border-radius: 23px; background: var(--glass-lens); box-shadow: var(--glass-highlight-inner); transform: translateX(calc(var(--selected-index) * 100%)); transition: transform .38s var(--spring-bounce); pointer-events: none; }
.segment-item { position: relative; display: flex; min-width: 0; min-height: 44px; align-items: center; justify-content: center; gap: 6px; padding: 0 18px; border: 1px solid transparent; border-radius: 23px; color: var(--text-secondary); background: transparent; font-size: .85rem; font-weight: 550; white-space: nowrap; transition: color .2s; }
.segment-item.active { color: var(--liquid-accent-strong); font-weight: 700; }
.segment-count { min-width: 17px; color: var(--text-tertiary); font-size: .66rem; font-variant-numeric: tabular-nums; }
.segment-item.active .segment-count { color: var(--liquid-accent); }
@media (max-width: 640px) { .category-segments { width: 100%; } .segment-item { padding: 0 4px; gap: 4px; font-size: .82rem; } }
@media (max-width: 360px) { .segment-count { display: none; } }
</style>
