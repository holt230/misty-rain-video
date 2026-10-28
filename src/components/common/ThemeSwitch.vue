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
.theme-switch { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
button { display:flex; align-items:center; justify-content:center; gap:7px; min-width:0; min-height:46px; padding:10px 8px; border:1px solid var(--divider); border-radius:4px; color:var(--text-secondary); background:none; font-size:.83rem; font-weight:550; white-space:nowrap; transition:background .16s,color .16s,border-color .16s; }
button[aria-pressed='true'] { color:var(--accent-ink); background:var(--liquid-accent); border-color:var(--liquid-accent); }
svg { width:17px; height:17px; }
@media(prefers-reduced-motion:reduce) { button { transition:none; } }
</style>
