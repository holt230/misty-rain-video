<script setup lang="ts">
import { ClipboardList, X } from '@lucide/vue';
import LoadingSkeleton from './LoadingSkeleton.vue';
import type { ClipboardNoticeMode } from '../../composables/useClipboardShare';
defineProps<{ mode: ClipboardNoticeMode | null }>();
const emit = defineEmits<{ (e:'manage'):void; (e:'read'):void; (e:'manual'):void; (e:'dismiss'):void }>();
const labels = { detected:'检测到分享链接', ready:'剪贴板识别', reading:'等待粘贴授权', manual:'请粘贴分享链接', empty:'未发现分享链接' };
</script>
<template><Transition name="clipboard-notice"><aside v-if="mode" class="clipboard-notice" role="status" aria-live="polite" :aria-busy="mode==='reading'">
  <ClipboardList aria-hidden="true"/><span>{{ labels[mode] }}</span>
  <button v-if="mode==='detected'" type="button" class="manage" @click="emit('manage')">管理</button>
  <button v-else-if="mode==='ready'" type="button" class="manage" aria-label="粘贴并识别分享链接" @click="emit('read')">粘贴</button>
  <LoadingSkeleton v-else-if="mode==='reading'" variant="inline" :count="1" label="正在读取剪贴板"/>
  <button v-else type="button" class="manage" @click="emit('manual')">去粘贴</button>
  <button type="button" class="dismiss" aria-label="关闭剪贴板提示" @click="emit('dismiss')"><X aria-hidden="true"/></button>
</aside></Transition></template>
<style scoped>.clipboard-notice{position:fixed;z-index:1300;bottom:24px;right:24px;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);padding:4px 6px 4px 16px;border:1px solid var(--divider);border-radius:10px;background:var(--surface-elevated);color:var(--text-primary);box-shadow:0 6px 28px #0003;font-size:.82rem}.clipboard-notice>svg{width:18px;height:18px;flex-shrink:0}.clipboard-notice>span{min-width:0}.clipboard-notice button{flex-shrink:0;min-width:44px;height:44px;border:0;border-radius:6px;background:none;color:inherit}.clipboard-notice :deep(.skeleton-inline){flex:0 0 44px}.manage{font-weight:650;padding:0 12px}.dismiss{display:grid;place-items:center;color:var(--text-tertiary)!important}.dismiss svg{width:17px;height:17px}.clipboard-notice-enter-active,.clipboard-notice-leave-active{transition:opacity .18s,transform .18s}.clipboard-notice-enter-from,.clipboard-notice-leave-to{opacity:0;transform:translateY(8px)}@media(max-width:1023px){.clipboard-notice{left:16px;right:16px;bottom:calc(76px + var(--safe-area-bottom));justify-content:center}.clipboard-notice>span{margin-right:auto}}@media(prefers-reduced-motion:reduce){.clipboard-notice-enter-active,.clipboard-notice-leave-active{transition:none}}</style>
