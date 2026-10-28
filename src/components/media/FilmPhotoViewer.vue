<script setup lang="ts">
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import { computed, ref, watch } from 'vue';
import { X, ChevronLeft, ChevronRight } from '@lucide/vue';
import { useDialog } from '../../composables/useDialog';
import type { CatalogPhoto } from '../../services/catalogDetails';
const props = defineProps<{ photos: CatalogPhoto[]; index: number; total: number; loading: boolean; hasMore: boolean; error: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'select', index: number): void; (e: 'more'): void }>();
const dialog = ref<HTMLElement | null>(null), failed = ref(false), usePreview = ref(false), imageLoaded=ref(false);
const current = computed(() => props.photos[props.index]);
watch(() => current.value?.id, () => { failed.value = false; usePreview.value = false;imageLoaded.value=false; });
function imageFailed() {
  if (!usePreview.value && current.value?.fullImage && current.value.fullImage !== current.value.image) usePreview.value = true;
  else failed.value = true;
}
useDialog(dialog, () => props.index >= 0, () => emit('close'));
function next() { if (props.index + 1 < props.photos.length) emit('select', props.index + 1); else if (props.hasMore && !props.loading) emit('more'); }
let touchX = 0, touchY = 0;
function swipe(event: TouchEvent) {
  const point = event.changedTouches[0]; if (!point) return;
  const dx = point.clientX - touchX, dy = point.clientY - touchY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) next(); else if (props.index > 0) emit('select', props.index - 1); }
}
</script>
<template>
  <Teleport to="body">
    <div v-if="index >= 0 && current" ref="dialog" class="photo-viewer" role="dialog" aria-modal="true" aria-label="剧照大图" @keydown.left.prevent="index > 0 && emit('select', index - 1)" @keydown.right.prevent="next">
      <header><span>{{ index + 1 }} / {{ total || photos.length }}</span><button type="button" aria-label="关闭剧照" @click="emit('close')"><X aria-hidden="true" /></button></header>
      <div class="photo-stage" @touchstart.passive="touchX = $event.touches[0]?.clientX || 0; touchY = $event.touches[0]?.clientY || 0" @touchend.passive="swipe">
        <LoadingSkeleton v-if="!imageLoaded && !failed" class="photo-skeleton" variant="player" label="正在读取剧照图片" />
        <img v-if="!imageLoaded && !failed && current.image" class="photo-preview" :src="current.image" alt="" aria-hidden="true" />
        <img v-if="!failed" class="photo-full" :class="{ready:imageLoaded}" @load="imageLoaded=true" :key="current.id" :src="usePreview ? current.image : current.fullImage || current.image" :alt="current.description || `剧照 ${index + 1}`" @error="imageFailed" />
        <button v-else class="image-retry" type="button" @click="failed = false">图片加载失败，重试</button>
      </div>
      <footer><button type="button" aria-label="上一张" :disabled="index === 0" @click="emit('select', index - 1)"><ChevronLeft aria-hidden="true" /></button><div><p v-if="current.description">{{ current.description }}</p><p v-if="error" role="alert">{{ error }}</p><LoadingSkeleton v-else-if="loading" variant="inline" :count="1" label="正在加载剧照" /></div><button type="button" :aria-label="error ? '重试下一张' : '下一张'" :disabled="loading || index + 1 >= photos.length && !hasMore" @click="next"><ChevronRight aria-hidden="true" /></button></footer>
    </div>
  </Teleport>
</template>
<style scoped>
.photo-viewer { --surface-2:#16191e;--surface-3:#242a32;--skeleton-highlight:#ffffff0a;position:fixed; inset:0; z-index:1800; display:grid; grid-template-rows:auto minmax(0,1fr) auto; background:#080808; color:#f5f5f7; padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
header, footer { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 20px; flex-shrink:0; }
header { border-bottom:1px solid #ffffff0d; }
header span { font-variant-numeric:tabular-nums; color:#bdbdbf; font-size:.85rem; }
button { display:grid; width:44px; min-height:44px; place-items:center; border:0; border-radius:50%; background:#ffffff10; border:1px solid #ffffff16; color:inherit; cursor:pointer; }
.photo-skeleton{position:absolute;inset:10% 10%;width:80%;display:block}.photo-skeleton :deep(.skeleton-description){display:none}.photo-skeleton :deep(.skeleton-screen){height:100%;aspect-ratio:auto}
button:disabled { opacity:.3; } svg { width:22px; height:22px; }
.photo-stage { position:relative;min-height:0; display:grid; place-items:center; touch-action:pan-y pinch-zoom; overflow:auto; padding:8px 20px; }
.photo-stage img { max-width:100%; max-height:100%; min-height:0; object-fit:contain; }
.photo-stage .photo-preview{position:absolute;inset:10%;width:80%;height:80%;max-width:none;max-height:none;object-fit:contain;filter:blur(14px);opacity:.32;pointer-events:none}.photo-full{position:relative;z-index:1;opacity:0;transition:opacity .28s ease}.photo-full.ready{opacity:1}.photo-skeleton{opacity:.55;border-radius:16px;overflow:hidden}
.image-retry { width:auto; border-radius:8px; padding:12px 24px; }
footer div { flex:1; min-width:0; text-align:center; color:#bdbdbf; font-size:.8rem; line-height:1.6; }
footer p { max-height:80px; overflow:auto; }
button:focus-visible { outline:2px solid #fff; outline-offset:3px; }
button:hover:not(:disabled) { background:#ffffff20; }
@media(max-width:640px) { header,footer { gap:10px; padding:10px 12px; } .photo-stage { padding:4px 0; } footer div { font-size:.75rem; } }
@media(prefers-reduced-motion:reduce){.photo-full{transition:none}}</style>
