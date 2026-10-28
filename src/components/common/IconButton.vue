<script setup lang="ts">
import { ref } from 'vue';
withDefaults(defineProps<{
  label: string;
  active?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
}>(), { type: 'button' });
const button = ref<HTMLButtonElement | null>(null);
defineExpose({ focus: (options?: FocusOptions) => button.value?.focus(options) });
</script>

<template>
  <button ref="button" class="app-icon-button" :class="{ active }" :type="type" :aria-label="label" :title="label" :disabled="disabled"><slot /></button>
</template>

<style scoped>
.app-icon-button { display: inline-grid; flex: 0 0 44px; width: 44px; height: 44px; min-width: 44px; min-height: 44px; padding: 0; place-items: center; border: 0; border-radius: 5px; color: var(--text-secondary); background: transparent; transition: color .16s ease, background .16s ease, transform .16s var(--spring-ease); }
.app-icon-button :deep(svg) { width: 21px; height: 21px; stroke-width: 1.85; }
.app-icon-button.active { color: var(--accent-ink); background: var(--liquid-accent); }
.app-icon-button:disabled { cursor: default; opacity: .35; }
.app-icon-button:active:not(:disabled) { transform: scale(.94); }
.app-icon-button:focus-visible { outline: 2px solid var(--liquid-accent); outline-offset: 4px; }
@media (hover: hover) and (pointer: fine) { .app-icon-button:hover:not(:disabled):not(.active) { color: var(--text-primary); background: var(--glass-bg-hover); } }
@media (prefers-reduced-motion: reduce) { .app-icon-button { transition: none; } .app-icon-button:active:not(:disabled) { transform: none; } }
</style>
