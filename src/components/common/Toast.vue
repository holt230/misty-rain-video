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
  <div class="toast-container" role="status" aria-live="polite" aria-relevant="additions text">
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
.toast-container { position:fixed; bottom:calc(24px + var(--safe-area-bottom)); left:50%; z-index:10000; display:grid; justify-items:center; gap:8px; width:min(calc(100vw - 32px),480px); transform:translateX(-50%); pointer-events:none; }
.liquid-toast { display:flex; align-items:center; gap:12px; max-width:100%; min-height:48px; padding:12px 18px; border:1px solid var(--divider); border-radius:6px; color:var(--text-primary); background:var(--surface-elevated); box-shadow:0 8px 24px rgb(0 0 0 / .2); font-size:.86rem; font-weight:500; line-height:1.5; }
.toast-msg { min-width:0; overflow-wrap:anywhere; }.toast-icon { display:grid; width:21px; height:21px; flex-shrink:0; place-items:center; color:var(--text-primary); }.toast-icon svg { width:20px; height:20px; }.toast-icon.spinning svg { animation:spin .9s linear infinite; }
.toast-anim-enter-active,.toast-anim-leave-active { transition:opacity .18s,transform .18s; }.toast-anim-enter-from,.toast-anim-leave-to { opacity:0; transform:translateY(6px); } @keyframes spin { to { transform:rotate(360deg); } }
@media(max-width:1023px) { .toast-container { bottom:calc(var(--mobile-content-bottom) + 8px); } }
@media(prefers-reduced-motion:reduce) { .toast-anim-enter-active,.toast-anim-leave-active { transition:none; }.toast-anim-enter-from,.toast-anim-leave-to { transform:none; }.toast-icon.spinning svg { animation:none; } }
</style>
