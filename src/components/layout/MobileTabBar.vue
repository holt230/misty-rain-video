<script setup lang="ts">
import { Compass, Bookmark, History, Settings2 } from '@lucide/vue';
import IconButton from '../common/IconButton.vue';

export type MobileTab = 'discover' | 'library' | 'history' | 'account';
defineProps<{ activeTab: MobileTab; disabled?: boolean }>();
const emit = defineEmits<{ (event: 'navigate', tab: MobileTab): void }>();
</script>

<template>
  <div class="mobile-tabbar-layer">
    <nav class="mobile-tabbar" aria-label="主要导航">
      <IconButton class="tabbar-item" label="发现" :active="activeTab === 'discover'" :aria-current="activeTab === 'discover' ? 'page' : undefined" :disabled="disabled" @click="emit('navigate', 'discover')"><Compass aria-hidden="true" /></IconButton>
      <IconButton class="tabbar-item" label="收藏" :active="activeTab === 'library'" :aria-current="activeTab === 'library' ? 'page' : undefined" :disabled="disabled" @click="emit('navigate', 'library')"><Bookmark aria-hidden="true" /></IconButton>
      <IconButton class="tabbar-item" label="历史" :active="activeTab === 'history'" :aria-current="activeTab === 'history' ? 'page' : undefined" :disabled="disabled" @click="emit('navigate', 'history')"><History aria-hidden="true" /></IconButton>
      <IconButton class="tabbar-item" label="设置" :active="activeTab === 'account'" :aria-current="activeTab === 'account' ? 'page' : undefined" :disabled="disabled" @click="emit('navigate', 'account')"><Settings2 aria-hidden="true" /></IconButton>
    </nav>
  </div>
</template>

<style scoped>
.mobile-tabbar-layer { display: none; }
@media (max-width: 1023px) {
  .mobile-tabbar-layer { position: fixed; inset: auto 0 0; z-index: 1250; display: block; pointer-events: none; }
  .mobile-tabbar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: center; justify-items: center; width: 100%; min-height: calc(60px + var(--safe-area-bottom)); padding: 8px max(12px, var(--safe-area-right)) calc(8px + var(--safe-area-bottom)) max(12px, var(--safe-area-left)); border-top: 1px solid var(--divider); background: var(--nav-background); pointer-events: auto; }
  .tabbar-item { position: relative; border-radius: 4px; color: var(--text-tertiary); }
  .tabbar-item.active { color: var(--text-primary); background: transparent; }
  .tabbar-item.active::after { content: ''; position: absolute; bottom: 0; left: 15px; width: 14px; height: 2px; background: currentColor; }
}
</style>
