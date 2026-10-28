<script setup lang="ts">
import { BookmarkCheck, Star } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import type { DiscoveryItem } from '../../services/discoveryService';

defineProps<{ item: DiscoveryItem; saved?: boolean; eager?: boolean; showYear?: boolean }>();
const emit = defineEmits<{ (event: 'select', item: DiscoveryItem): void }>();
</script>

<template>
  <button class="poster-tile" type="button" :aria-label="`查看详情：${item.title}（${item.year || '年份未知'}）`" @click="emit('select', item)">
    <span class="poster-image">
      <MediaPoster :src="item.poster" alt="" :loading="eager ? 'eager' : 'lazy'" :fetchpriority="eager ? 'high' : 'auto'" decoding="async" />
      <span v-if="saved" class="poster-saved" title="已收藏"><BookmarkCheck aria-hidden="true" /></span>
      <span v-if="item.rating !== null" class="poster-rating"><Star aria-hidden="true" />{{ item.rating.toFixed(1) }}</span>
    </span>
    <strong class="discovery-title" :title="item.title">{{ item.title }}</strong>
    <span v-if="showYear && item.year" class="poster-year">{{ item.year }}</span>
  </button>
</template>

<style scoped>
.poster-tile { display:flex; min-width:0; flex-direction:column; gap:9px; padding:0; border:0; border-radius:var(--radius-md,14px); text-align:left; color:var(--text-primary); background:none; -webkit-touch-callout:none; }
.poster-image { position:relative; display:block; width:100%; aspect-ratio:2/3; overflow:hidden; border-radius:var(--poster-radius,7px); background:var(--surface-2); box-shadow:0 0 0 1px rgb(255 255 255 / .06); transition:transform .24s var(--spring-ease), box-shadow .24s ease; }
.poster-image :deep(img) { display:block; width:100%; height:100%; object-fit:cover; }
.poster-tile strong { display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.82rem; font-weight:550; line-height:1.45; }
.poster-year { margin-top:-6px; color:var(--text-tertiary); font-size:.7rem; }
.poster-rating,.poster-saved { position:absolute; z-index:1; display:inline-flex; align-items:center; justify-content:center; gap:4px; color:#fff; background:rgb(10 10 12 / .78); border:1px solid rgb(255 255 255 / .12); }
.poster-rating { bottom:8px; right:8px; padding:3px 6px; border-radius:6px; font-size:.64rem; font-weight:650; font-variant-numeric:tabular-nums; }
.poster-rating svg { width:10px; height:10px; fill:currentColor; }
.poster-saved { top:8px; right:8px; width:27px; height:27px; border-radius:50%; }
.poster-saved svg { width:14px; height:14px; }


.poster-tile:focus-visible { outline:none; }
.poster-tile:focus-visible .poster-image { box-shadow:0 0 0 3px var(--text-primary); }
@media (hover:hover) and (pointer:fine) {
  .poster-tile:hover .poster-image { transform:scale(1.025); box-shadow:0 0 0 2px var(--text-primary), 0 12px 28px rgb(0 0 0 / .2); }
}
@media (max-width:640px) { .poster-tile { gap:8px; } .poster-tile strong { font-size:.74rem; } .poster-image { border-radius:6px; } .poster-rating { bottom:6px; right:6px; padding:2px 5px; } }
@media (prefers-reduced-motion:reduce) { .poster-image { transition:none; } .poster-tile:hover .poster-image { transform:none; } }
</style>
