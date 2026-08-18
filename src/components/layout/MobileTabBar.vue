<script setup lang="ts">
import { LibraryBig, UserRound } from '@lucide/vue';

export type MobileTab = 'library' | 'account';

defineProps<{
  activeTab: MobileTab;
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
  .mobile-tabbar-layer {
    position: fixed;
    inset: 0;
    z-index: 1250;
    display: block;
    width: 100%;
    height: var(--app-viewport-height);
    pointer-events: none;
  }

  .mobile-tabbar {
    position: absolute;
    right: calc(14px + var(--safe-area-right));
    bottom: calc(7px + var(--safe-area-bottom));
    left: calc(14px + var(--safe-area-left));
    display: flex;
    width: min(272px, calc(100% - 28px));
    height: 66px;
    margin: 0 auto;
    pointer-events: auto;
  }

  .tabbar-group {
    position: relative;
    isolation: isolate;
    display: grid;
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    overflow: hidden;
    padding: 6px;
    border: 1px solid rgb(239 241 255 / 0.16);
    border-radius: 25px;
    background: rgb(17 19 28 / 0.62);
    box-shadow:
      inset 0 1px rgb(255 255 255 / 0.16),
      inset 0 -1px rgb(0 0 0 / 0.32),
      0 18px 42px rgb(0 0 0 / 0.5),
      0 0 26px rgb(var(--accent-rgb) / 0.10);
    backdrop-filter: blur(34px) saturate(155%);
    -webkit-backdrop-filter: blur(34px) saturate(155%);
    transform: translateZ(0);
  }

  .tabbar-group::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background:
      radial-gradient(90% 66% at 18% -18%, rgb(210 218 255 / 0.18), transparent 66%),
      linear-gradient(110deg, rgb(255 255 255 / .04), transparent 45%, rgb(161 177 255 / .07));
  }

  .tabbar-item {
    position: relative;
    display: grid;
    min-width: 0;
    min-height: 52px;
    place-content: center;
    justify-items: center;
    gap: 2px;
    border: 1px solid transparent;
    border-radius: 19px;
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
    touch-action: manipulation;
    transition: color 180ms ease, background 220ms ease, border-color 220ms ease, box-shadow 220ms ease;
  }

  .item-icon {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 9px;
  }

  .tabbar-item svg {
    width: 21px;
    height: 21px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
  }

  .tabbar-item > span:last-child {
    font-size: 0.68rem;
    font-weight: 680;
    line-height: 1.1;
    letter-spacing: 0.01em;
  }

  .tabbar-item.active {
    border-color: rgb(var(--accent-rgb) / 0.22);
    color: var(--liquid-accent);
    background:
      linear-gradient(145deg, rgb(153 170 255 / 0.22), rgb(61 69 120 / 0.44));
    box-shadow:
      inset 0 1px rgb(232 237 255 / 0.18),
      0 8px 22px rgb(0 0 0 / 0.24),
      0 0 22px rgb(var(--accent-rgb) / 0.12);
  }

  .tabbar-item:active { background-color: rgb(var(--accent-rgb) / 0.12); }
  .tabbar-item:focus-visible { outline: 2px solid var(--liquid-accent); outline-offset: 2px; }
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  @media (max-width: 640px) {
    .tabbar-group { background: rgb(17 19 28 / 0.96); }
  }
}

@media (max-width: 370px) {
  .mobile-tabbar { width: min(254px, calc(100% - 24px)); height: 62px; }
  .tabbar-group { padding: 5px; border-radius: 23px; }
  .tabbar-item { min-height: 50px; }
}

@media (prefers-reduced-motion: reduce) {
  .tabbar-item { transition: none; }
}
</style>
