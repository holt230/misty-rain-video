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
.category-segments {
  display: inline-grid;
  grid-template-columns: repeat(4, minmax(0, auto));
  gap: 4px;
  padding: 5px;
  border: 1px solid rgb(239 241 255 / 0.09);
  border-radius: 18px;
  background: rgb(237 240 255 / 0.035);
  box-shadow: inset 0 1px rgb(255 255 255 / 0.045);
}

.segment-item {
  display: flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 17px;
  border: 1px solid transparent;
  border-radius: 13px;
  color: var(--text-tertiary);
  background: transparent;
  font-size: 0.86rem;
  font-weight: 590;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: color 180ms ease, background 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}

.segment-item:hover { color: var(--text-primary); background: rgb(237 240 255 / 0.055); }
.segment-item.active {
  border-color: rgb(var(--accent-rgb) / 0.22);
  color: var(--liquid-accent);
  background: var(--liquid-accent-subtle);
  box-shadow: inset 0 1px rgb(255 255 255 / 0.08), 0 6px 18px rgb(0 0 0 / 0.16);
}

.segment-count {
  display: grid;
  min-width: 17px;
  height: 17px;
  place-items: center;
  padding: 0 4px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.055);
  font-size: 0.63rem;
  font-weight: 720;
}

.segment-item.active .segment-count { color: var(--accent-ink); background: var(--liquid-accent); }
.segment-item:focus-visible { outline: 2px solid var(--liquid-accent); outline-offset: 2px; }

@media (max-width: 640px) {
  .category-segments {
    width: 100%;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 5px;
    padding: 5px;
    overflow: hidden;
    border-color: rgb(239 241 255 / 0.08);
    border-radius: 17px;
    background: rgb(237 240 255 / 0.03);
  }

  .segment-item {
    min-width: 0;
    min-height: 44px;
    gap: 4px;
    padding: 0 5px;
    border-radius: 12px;
    font-size: 0.8rem;
    touch-action: manipulation;
  }
}

@media (max-width: 360px) {
  .segment-item { font-size: 0.76rem; }
  .segment-count { min-width: 15px; height: 15px; font-size: 0.58rem; }
}
</style>
