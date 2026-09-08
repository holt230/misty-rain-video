<script setup lang="ts">
import { LibraryBig, UserRound } from '@lucide/vue';

export type MobileTab = 'library' | 'account';

defineProps<{
  activeTab: MobileTab;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'navigate', tab: MobileTab): void;
}>();
</script>

<template>
  <div class="mobile-tabbar-layer">
    <nav class="mobile-tabbar" aria-label="主要导航">
      <div class="tabbar-group">
        <button
          type="button"
          class="tabbar-item"
          :disabled="disabled"
          :class="{ active: activeTab === 'library' }"
          :aria-current="activeTab === 'library' ? 'page' : undefined"
          @click="emit('navigate', 'library')"
        >
          <span class="item-icon"><LibraryBig aria-hidden="true" /></span>
          <span>片库</span>
        </button>

        <button
          type="button"
          class="tabbar-item"
          :disabled="disabled"
          :class="{ active: activeTab === 'account' }"
          :aria-current="activeTab === 'account' ? 'page' : undefined"
          @click="emit('navigate', 'account')"
        >
          <span class="item-icon"><UserRound aria-hidden="true" /></span>
          <span>我的</span>
        </button>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.mobile-tabbar-layer { display: none; }
@media (max-width: 640px) {
  .mobile-tabbar-layer { position: fixed; inset: 0; z-index: 1250; display: block; pointer-events: none; }
  .mobile-tabbar { position: absolute; bottom: calc(12px + var(--safe-area-bottom)); left: 50%; width: 244px; height: 66px; transform: translateX(-50%); pointer-events: auto; }
  .tabbar-group { position: relative; display: grid; width: 100%; height: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; padding: 5px; border: 1px solid rgb(255 255 255 / .96); border-radius: 36px; background: rgb(245 249 255 / .64); backdrop-filter: var(--glass-blur-heavy); -webkit-backdrop-filter: var(--glass-blur-heavy); box-shadow: inset 0 2px 1px #fff, inset 0 -1px 1px rgb(148 168 206 / .32), 0 8px 30px rgb(61 87 136 / .19); }
  .tabbar-item { display: grid; align-content: center; justify-items: center; gap: 2px; min-width: 0; border: 1px solid transparent; border-radius: 29px; color: var(--text-secondary); background: transparent; transition: background .2s, color .2s, box-shadow .2s; }
  .tabbar-item.active { color: var(--liquid-accent); border-color: rgb(255 255 255 / .95); background: linear-gradient(155deg, rgb(255 255 255 / .97), rgb(213 227 255 / .57)); box-shadow: inset 0 1px #fff, 0 3px 8px rgb(56 85 140 / .12); }
  .item-icon { display: grid; place-items: center; width: 25px; height: 25px; }
  .item-icon svg { width: 23px; height: 23px; fill: none; stroke-width: 1.9; }
  .tabbar-item > span:last-child { font-size: .66rem; font-weight: 650; }
}
</style>
