<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
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

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open && !props.saving) emit('cancel');
};

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && media"
      class="picker-backdrop"
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
.picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1750;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(3, 6, 13, 0.74);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.picker-sheet {
  width: min(440px, 100%);
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 24px;
  color: #fff;
  background: rgba(19, 24, 38, 0.97);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.56), inset 0 1px rgba(255, 255, 255, 0.12);
}

.drag-handle { display: none; }

.sheet-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.sheet-heading span { color: var(--text-tertiary); font-size: 0.78rem; }
.sheet-heading h2 { margin: 3px 0 0; font-size: 1.14rem; line-height: 1.35; }

.close-button {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.76);
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
}

.close-button svg { width: 19px; fill: none; stroke: currentColor; stroke-width: 2; }

.category-options { display: grid; gap: 10px; }

.category-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 62px;
  padding: 10px 13px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  color: #fff;
  text-align: left;
  background: rgba(255, 255, 255, 0.045);
  cursor: pointer;
  touch-action: manipulation;
}

.category-option.active {
  border-color: rgb(var(--accent-rgb) / 0.28);
  background: var(--liquid-accent-subtle);
}

.option-icon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  color: transparent;
  background: rgba(255, 255, 255, 0.07);
}

.active .option-icon { color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.option-icon svg { width: 20px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.option-copy { display: grid; gap: 3px; min-width: 0; flex: 1; }
.option-copy strong { font-size: 0.96rem; }
.option-copy small { color: var(--text-tertiary); font-size: 0.76rem; }
.current-badge { padding: 4px 8px; border-radius: 999px; color: var(--liquid-accent); font-size: 0.7rem; background: var(--liquid-accent-subtle); }

@media (max-width: 640px) {
  .picker-backdrop { align-items: flex-end; padding: 0; }
  .picker-sheet {
    width: 100%;
    padding: 10px 16px calc(18px + env(safe-area-inset-bottom));
    border-radius: 24px 24px 0 0;
    animation: sheet-in 0.25s ease-out;
  }
  .drag-handle {
    display: block;
    width: 42px;
    height: 5px;
    margin: 0 auto 16px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.25);
  }
  .category-option { min-height: 64px; }
}

@keyframes sheet-in { from { transform: translateY(100%); } to { transform: translateY(0); } }
</style>

<style scoped>
@media (max-width: 640px) {
  .picker-sheet { padding-top: 8px; }
  .drag-handle { margin-bottom: 12px; }
  .sheet-heading { margin-bottom: 12px; }
  .category-options { gap: 8px; }
  .category-option { min-height: 58px; padding: 8px 11px; border-radius: 14px; }
  .option-icon { width: 34px; height: 34px; border-radius: 10px; }
}
</style>
