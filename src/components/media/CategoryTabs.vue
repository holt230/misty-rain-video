<script setup lang="ts">
import type { CategoryType } from '../../types/media';

defineProps<{
  modelValue: CategoryType;
  counts: Record<CategoryType, number>;
  searching?:boolean;
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
      :class="{ active: !searching && modelValue === cat.id }"
      :aria-current="!searching && modelValue === cat.id ? 'page' : undefined"
      @click="emit('update:modelValue', cat.id)"
    >
      <span class="segment-label">{{ cat.label }}</span>
      <span v-if="counts[cat.id] > 0" class="segment-count">{{ counts[cat.id] }}</span>
    </button>
  </nav>
</template>

<style scoped>
.category-segments{display:flex;gap:6px;min-width:0;overflow-x:auto;scrollbar-width:none}.segment-item{display:flex;align-items:center;justify-content:center;gap:6px;flex:0 0 auto;min-height:44px;padding:0 18px;border:0;border-radius:6px;background:none;color:var(--text-secondary);font-size:.85rem;font-weight:550;white-space:nowrap}.segment-item.active{color:var(--text-primary);background:var(--glass-bg-active);font-weight:650}.segment-count{color:var(--text-tertiary);font-size:.68rem;font-variant-numeric:tabular-nums}@media(max-width:640px){.category-segments{gap:0}.segment-item{padding:0 13px;font-size:.78rem}.segment-count{font-size:.6rem}}@media(max-width:360px){.segment-item{padding:0 10px}}
</style>
