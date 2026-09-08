<script setup lang="ts">
import { ref } from 'vue';
import { useDialog } from '../../composables/useDialog';
import { Check, X } from '@lucide/vue';
import type { CategoryType, MediaItem } from '../../types/media';

const props = defineProps<{
  open: boolean;
  media: MediaItem | null;
  saving?: boolean;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'select', category: CategoryType): void;
}>();

const categories: Array<{ value: CategoryType; label: string; hint: string }> = [
  { value: 'tv', label: '电视剧', hint: '连续剧与短剧' },
  { value: 'movie', label: '电影', hint: '院线与网络电影' },
  { value: 'variety', label: '综艺', hint: '节目与真人秀' },
  { value: 'anime', label: '动漫', hint: '动画与国漫' }
];

const dialogRef = ref<HTMLElement | null>(null);
useDialog(dialogRef, () => props.open, () => { if (!props.saving) emit('cancel'); });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && media"
      class="picker-backdrop"
      ref="dialogRef"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-picker-title"
      @click.self="!saving && emit('cancel')"
    >
      <section class="picker-sheet">
        <div class="drag-handle" aria-hidden="true"></div>
        <div class="sheet-heading">
          <div>
            <span>调整分类</span>
            <h2 id="category-picker-title">《{{ media.title }}》</h2>
          </div>
          <button type="button" class="close-button" aria-label="关闭分类选择" :disabled="saving" @click="emit('cancel')">
            <X aria-hidden="true" />
          </button>
        </div>

        <div class="category-options" role="radiogroup" aria-label="影片分类">
          <button
            v-for="category in categories"
            :key="category.value"
            type="button"
            class="category-option"
            :class="{ active: media.category === category.value }"
            :disabled="saving"
            role="radio"
            :aria-checked="media.category === category.value"
            @click="emit('select', category.value)"
          >
            <span class="option-icon" aria-hidden="true">
              <Check />
            </span>
            <span class="option-copy">
              <strong>{{ category.label }}</strong>
              <small>{{ category.hint }}</small>
            </span>
            <span v-if="media.category === category.value" class="current-badge">当前</span>
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.picker-backdrop { position: fixed; inset: 0; z-index: 1750; display: flex; align-items: center; justify-content: center; padding: 20px; }
.picker-sheet { width: min(440px, 100%); padding: 24px; border-radius: 30px; }
.drag-handle { display: none; }
.sheet-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
.sheet-heading > div { min-width: 0; }
.sheet-heading span { color: var(--text-tertiary); font-size: .74rem; }
.sheet-heading h2 { margin-top: 4px; color: var(--text-primary); font-size: 1.13rem; font-weight: 700; overflow-wrap: anywhere; line-height: 1.45; }
.close-button { display: grid; width: 44px; height: 44px; place-items: center; flex-shrink: 0; border-radius: 50%; }
.close-button svg { width: 19px; height: 19px; }
.category-options { display: grid; gap: 10px; }
.category-option { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 72px; padding: 12px 15px; border: 1px solid; border-radius: 22px; color: var(--text-primary); text-align: left; }
.option-icon { display: grid; width: 38px; height: 38px; place-items: center; flex-shrink: 0; border: 1px solid #fff; border-radius: 50%; color: transparent; background: rgb(124 148 188 / .08); }
.active .option-icon { color: var(--liquid-accent); background: #e4edff; }
.option-icon svg { width: 20px; height: 20px; }
.option-copy { display: grid; gap: 3px; flex: 1; min-width: 0; }
.option-copy strong { font-size: .94rem; font-weight: 650; }
.option-copy small { color: var(--text-tertiary); font-size: .75rem; }
.current-badge { color: var(--liquid-accent); font-size: .73rem; }
@media (max-width: 640px) { .picker-backdrop { align-items: flex-end; padding: 0; } .picker-sheet { padding-top: 10px; } .drag-handle { display: block; width: 36px; height: 5px; margin: 0 auto 22px; border-radius: 10px; } }
</style>
