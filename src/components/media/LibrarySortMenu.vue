<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Check, ChevronDown } from '@lucide/vue';

const sortLabels = {
  default: '默认排序',
  recent: '最近观看',
  title: '片名排序'
} as const;
type LibrarySort = keyof typeof sortLabels;

const sort = defineModel<LibrarySort>({ required: true });
const disclosure = ref<HTMLDetailsElement | null>(null);
const trigger = ref<HTMLElement | null>(null);

const close = (restoreFocus = false) => {
  if (!disclosure.value?.open) return;
  disclosure.value.open = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
};

const selectSort = (value: LibrarySort) => {
  sort.value = value;
  close(true);
};

const closeFromOutside = (event: Event, target: EventTarget | null = event.target) => {
  if (target instanceof Node && !disclosure.value?.contains(target)) close();
};

const onEscape = (event: KeyboardEvent) => {
  if (!disclosure.value?.open) return;
  event.stopPropagation();
  event.preventDefault();
  close(true);
};

onMounted(() => document.addEventListener('pointerdown', closeFromOutside, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeFromOutside, true));
</script>

<template>
  <details ref="disclosure" class="sort-disclosure" @keydown.esc="onEscape" @focusout="closeFromOutside($event, $event.relatedTarget)">
    <summary ref="trigger" :aria-label="'片库排序，' + sortLabels[sort]">
      {{ sortLabels[sort] }}
      <ChevronDown aria-hidden="true" />
    </summary>
    <div class="sort-options" role="group" aria-label="排序方式">
      <button v-for="(label, value) in sortLabels" :key="value" type="button" :aria-pressed="sort === value" @click="selectSort(value)">
        {{ label }}
        <Check v-if="sort === value" aria-hidden="true" />
      </button>
    </div>
  </details>
</template>

<style scoped>
.sort-disclosure { position: relative; flex-shrink: 0; font-size: 13px; }
.sort-disclosure[open] { z-index: 5; }
summary { display: flex; min-height: 44px; align-items: center; gap: 6px; padding: 0 8px; border-radius: 10px; color: var(--text-secondary); list-style: none; white-space: nowrap; cursor: pointer; }
summary::-webkit-details-marker { display: none; }
summary:focus-visible { outline: 2px solid var(--liquid-accent); outline-offset: 2px; }
summary svg { width: 14px; height: 14px; }
[open] > summary { color: var(--text-primary); }
[open] > summary svg { transform: rotate(180deg); }
.sort-options { position: absolute; top: calc(100% + 4px); right: 0; width: 152px; padding: 4px; border-radius: 14px; background: var(--surface-elevated); box-shadow: 0 8px 26px rgb(0 0 0 / .2); }
.sort-options button { display: flex; width: 100%; min-height: 44px; align-items: center; justify-content: space-between; padding: 0 12px; border: 0; border-radius: 10px; color: var(--text-primary); background: transparent; font-size: inherit; }
.sort-options button[aria-pressed='true'] { color: var(--liquid-accent); }
.sort-options button:focus-visible { outline-offset: -2px; }
.sort-options button svg { width: 16px; height: 16px; }
@media (hover: hover) {
  summary:hover, .sort-options button:hover { background: var(--surface-3); }
}
</style>
