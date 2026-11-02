<script setup lang="ts">
import { Monitor, Moon, Sun } from '@lucide/vue';
import { themePreference, setTheme } from '../../services/theme';
</script>
<template>
  <div class="theme-switch" role="group" aria-label="主题颜色">
    <button type="button" aria-label="跟随系统" title="跟随系统" :aria-pressed="themePreference === 'system'" @click="setTheme('system')"><Monitor aria-hidden="true" />系统</button>
    <button type="button" :aria-pressed="themePreference === 'dark'" @click="setTheme('dark')"><Moon aria-hidden="true" />暗色</button>
    <button type="button" :aria-pressed="themePreference === 'light'" @click="setTheme('light')"><Sun aria-hidden="true" />浅色</button>
  </div>
</template>
<style scoped>
.theme-switch { display: flex; gap: 4px; padding: 6px; border: var(--glass-border); border-radius: var(--cinema-radius-control); background: var(--glass-bg); }
button { display: flex; flex: 1; min-width: 0; min-height: 40px; align-items: center; justify-content: center; gap: 5px; padding: 0 5px; border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary); font-size: .76rem; white-space: nowrap; }
button[aria-pressed='true'] { color: var(--text-primary); background: var(--surface-elevated); box-shadow: var(--glass-shadow-sm); }
svg { width: 16px; height: 16px; }
</style>
