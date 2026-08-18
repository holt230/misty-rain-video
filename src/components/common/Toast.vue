<script setup lang="ts">
import { CheckCircle2, CircleAlert, Info, LoaderCircle } from '@lucide/vue';
import { useToast } from '../../composables/useToast';

const { toasts } = useToast();
const iconComponent = (icon: string) => {
  if (icon === '✓') return CheckCircle2;
  if (icon === '!') return CircleAlert;
  if (icon === '↻') return LoaderCircle;
  return Info;
};
</script>

<template>
  <div class="toast-container">
    <transition-group name="toast-anim">
      <div
        v-for="item in toasts"
        :key="item.id"
        class="liquid-toast"
      >
        <span class="toast-icon" :class="{ spinning: item.icon === '↻' }" aria-hidden="true">
          <component :is="iconComponent(item.icon)" />
        </span>
        <span class="toast-msg">{{ item.message }}</span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.liquid-toast {
  background: rgba(20, 26, 40, 0.92);
  backdrop-filter: var(--liquid-glass-blur);
  -webkit-backdrop-filter: var(--liquid-glass-blur);
  border: 1px solid var(--liquid-glass-border-highlight);
  border-radius: var(--radius-pill);
  padding: 10px 22px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.25);
  color: #fff;
  font-size: 0.88rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: auto;
}

.toast-anim-enter-active,
.toast-anim-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-anim-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.9);
}

.toast-anim-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}
</style>

<style scoped>
.toast-container { bottom: calc(22px + var(--safe-area-bottom)); width: min(92vw, 440px); align-items: center; }
.liquid-toast {
  max-width: 100%;
  border-color: rgba(255, 255, 255, 0.09);
  border-radius: 14px;
  background: rgba(27, 28, 34, 0.96);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(18px) saturate(130%);
  -webkit-backdrop-filter: blur(18px) saturate(130%);
}
.toast-icon { display: grid; place-items: center; width: 22px; height: 22px; color: var(--liquid-accent); }
.toast-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.toast-icon.spinning svg { animation: toast-spin .9s linear infinite; }
@keyframes toast-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .toast-container { bottom: var(--mobile-content-bottom); }
  .liquid-toast { padding: 11px 15px; font-size: 0.84rem; }
}
@media (prefers-reduced-motion: reduce) { .toast-icon.spinning svg { animation-duration: 1.8s; } }
</style>
