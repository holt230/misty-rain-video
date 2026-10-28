<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
withDefaults(defineProps<{error?:Error;variant?:'cards'|'rows'|'detail'|'player';overlay?:boolean}>(),{variant:'cards'});
const reload = () => window.location.reload();
</script>

<template>
  <div class="page-load-state" :class="{'is-overlay':overlay}" :role="error ? 'alert' : 'status'">
<LoadingSkeleton v-if="!error" :variant="variant" :count="6" label="正在加载页面" />
    <p v-else>页面暂时无法加载，请检查网络后重试</p>
    <button v-if="error" type="button" @click="reload">重新加载</button>
  </div>
</template>

<style scoped>
.page-load-state { display:flex; min-height:240px; align-items:center; justify-content:center; flex-direction:column; gap:18px; padding:48px 24px; color:var(--text-secondary); font-size:.9rem; text-align:center; }
.page-load-spinner { width:28px; height:28px; border:2px solid var(--divider); border-top-color:var(--text-primary); border-radius:50%; animation:page-load-spin .8s linear infinite; }
.is-overlay{position:fixed;inset:0;z-index:1400;background:var(--dialog-backdrop)}.is-overlay>.loading-skeleton{max-width:640px;padding:24px;border-radius:20px;background:var(--surface-elevated)}
button { min-height:44px; padding:10px 22px; border:1px solid var(--divider); border-radius:4px; color:var(--text-primary); background:none; font-size:.85rem; }
@keyframes page-load-spin { to { transform:rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .page-load-spinner { animation:none; } }
</style>
