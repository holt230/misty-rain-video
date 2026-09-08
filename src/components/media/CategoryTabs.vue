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
  <nav class="category-segments" aria-label="影片分类">
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
.category-segments { position: relative; display: inline-grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 0; border: 0; background: transparent; }
.segment-item { position: relative; display: flex; min-width: 0; min-height: 44px; align-items: center; justify-content: center; gap: 6px; padding: 0 20px; border: 0; border-radius: 9px; color: var(--text-tertiary); background: transparent; font-size: .88rem; font-weight: 550; white-space: nowrap; transition: color .2s, background .2s; }
.segment-item:hover { color: var(--text-primary); }
.segment-item.active { color: var(--text-primary); background: rgb(255 255 255 / .09); font-weight: 650; }
.segment-count { color: inherit; font-size: .65rem; font-variant-numeric: tabular-nums; opacity: .8; }
.segment-item.active .segment-count { color: var(--liquid-accent); }
@media (max-width: 640px) { .category-segments { width: 100%; } .segment-item { padding: 0 4px; gap: 4px; font-size: .82rem; } }
@media (max-width: 360px) { .segment-count { display: none; } }
</style>
