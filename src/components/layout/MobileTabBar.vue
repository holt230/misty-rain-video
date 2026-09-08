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
      <div class="tabbar-group glass-rim" :style="{ '--selected-index': activeTab === 'library' ? 0 : 1 }">
        <span class="tabbar-lens" aria-hidden="true"></span>
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
  .mobile-tabbar { position: absolute; bottom: calc(10px + var(--safe-area-bottom)); left: 50%; width: 204px; height: 56px; transform: translateX(-50%); pointer-events: auto; }
  .tabbar-group { position: relative; display: grid; width: 100%; height: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 5px; border: var(--glass-border); border-radius: 36px; background: var(--glass-floating-material); backdrop-filter: var(--glass-blur-heavy); -webkit-backdrop-filter: var(--glass-blur-heavy); box-shadow: var(--glass-highlight-inner), 0 8px 28px rgb(0 0 0 / .35); }
  .tabbar-lens { position: absolute; top: 5px; bottom: 5px; left: 5px; width: calc((100% - 10px) / 2); border-radius: 27px; background: rgb(255 255 255 / .09); transform: translateX(calc(var(--selected-index) * 100%)); transition: transform .25s var(--spring-ease); pointer-events: none; }
  .tabbar-item { position: relative; display: flex; align-items: center; justify-content: center; gap: 7px; min-width: 0; border: 1px solid transparent; border-radius: 29px; color: var(--text-secondary); background: transparent; transition: color .2s; }
  .tabbar-item.active { color: var(--liquid-accent-strong); }
  .item-icon { display: grid; place-items: center; width: 22px; height: 22px; }
  .item-icon svg { width: 21px; height: 21px; fill: none; stroke-width: 1.9; }
  .tabbar-item > span:last-child { font-size: .75rem; font-weight: 550; }
}
</style>
