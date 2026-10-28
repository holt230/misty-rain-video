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
.picker-sheet { width: min(440px, 100%); padding: 24px; border-radius:20px; }
.drag-handle { display: none; }
.sheet-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.sheet-heading > div { min-width: 0; }
.sheet-heading span { color: var(--text-tertiary); font-size: .74rem; font-weight: 500; }
.sheet-heading h2 { margin-top: 3px; color: var(--text-primary); font-size: 1.15rem; font-weight:650; overflow-wrap: anywhere; line-height: 1.4; letter-spacing: -.02em; }
.close-button { display: grid; width: 44px; height: 44px; place-items: center; flex-shrink: 0; border-radius: 50%; }
.close-button svg { width: 19px; height: 19px; }
.category-options { display: grid; gap: 10px; }
.category-option { background:transparent; display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; padding: 12px 16px; border: 1px solid var(--divider); border-radius:12px; color: var(--text-primary); text-align: left; transition: transform .15s, background .15s; }
.category-option:active { transform: scale(.98); }
.option-icon { display: grid; width: 34px; height: 34px; place-items: center; flex-shrink: 0; border: 1px solid var(--divider); border-radius: 50%; color: transparent; background:var(--surface-2); }
.active .option-icon { color:var(--accent-ink); background:var(--liquid-accent); }
.category-option.active { background:var(--surface-2); border-color:var(--text-tertiary); }
.option-icon svg { width: 18px; height: 18px; }
.option-copy { display: grid; gap: 2px; flex: 1; min-width: 0; }
.option-copy strong { font-size: .94rem; font-weight: 650; }
.option-copy small { color: var(--text-tertiary); font-size: .74rem; }
.current-badge { padding: 2px 8px; border-radius:999px; background:var(--divider); background:transparent; color:var(--text-secondary); font-size: .72rem; font-weight: 600; }
@media (max-width: 640px) {
  .picker-backdrop { align-items:flex-end; padding:max(8px,var(--safe-area-top)) max(8px,var(--safe-area-right)) max(8px,var(--safe-area-bottom)) max(8px,var(--safe-area-left)); }
  .picker-sheet { padding-top: 12px; border-radius:20px; }
  .drag-handle { display: block; width: 36px; height: 5px; margin: 0 auto 18px; border-radius:999px; background:var(--divider); }
}
.picker-backdrop { background:var(--dialog-backdrop,rgb(0 0 0 / .6)); }
.picker-sheet { max-height:calc(100dvh - var(--safe-area-top) - var(--safe-area-bottom) - 32px); overflow-y:auto; overscroll-behavior:contain; border:1px solid var(--divider); background:var(--surface-elevated,var(--surface-1)); box-shadow:0 24px 80px #0005; animation:sheet-enter .18s ease; }
button { cursor:pointer; } button:disabled { opacity:.5; cursor:default; }
button:focus-visible { outline:2px solid var(--text-primary); outline-offset:-2px; }
.close-button { border:0; color:var(--text-secondary); background:transparent; }
@keyframes sheet-enter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
@media(max-width:640px) { .picker-sheet { padding:16px 20px 20px; } }
@media(prefers-reduced-motion:reduce) { .picker-sheet { animation:none; } button { transition:none; } }
</style>
