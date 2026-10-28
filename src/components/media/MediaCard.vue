<script setup lang="ts">
import { computed } from 'vue';
import { Ellipsis, Play } from '@lucide/vue';
import { getLibraryUpdateFeedback } from '../../services/libraryUpdateFeedback';
import MediaPoster from '../common/MediaPoster.vue';
import type { MediaItem } from '../../types/media';

const props = defineProps<{ media: MediaItem }>();
const updateFeedback = computed(() => getLibraryUpdateFeedback(props.media));
const qualityLabel = computed(() => `${props.media.tag || ''} ${props.media.quarkQuality || ''}`
  .match(/(?:4K|8K|2160P|1080P|720P|HDR|杜比)/i)?.[0].toUpperCase() || '');
const statusLabel = computed(() => {
  const media = props.media;
  if ((media.newEpisodeCount || 0) > 0) return `新增 ${media.newEpisodeCount} ${media.category === 'movie' ? '个视频' : '集'}`;
  if (updateFeedback.value) return updateFeedback.value.label;
  if (media.category !== 'movie' && media.latestEpisodeNumber) return `更新至 ${media.latestEpisodeNumber} 集`;
  return media.status && !['已入库', '已收录', '已收藏'].includes(media.status) ? media.status : '';
});
const emit = defineEmits<{
  (e: 'click-card', media: MediaItem): void;
  (e: 'delete-card', media: MediaItem): void;
  (e: 're-search', media: MediaItem): void;
  (e: 'edit-category', media: MediaItem): void;
  (e: 'open-actions', media: MediaItem): void;
}>();
</script>

<template>
  <article class="media-card">
    <button type="button" class="card-play-target"
      :aria-label="`播放《${media.title}》${statusLabel ? `，${statusLabel}` : ''}`"
      @click="emit('click-card', media)">
      <span class="poster-viewport">
        <MediaPoster :src="media.poster" :catalog-id="media.catalogId" alt="" class="poster-image" />
        <span v-if="qualityLabel" class="quality-tag">{{ qualityLabel }}</span>
        <span class="hover-play" aria-hidden="true"><span class="play-disk"><Play fill="currentColor" /></span></span>
      </span>
      <span class="card-caption">
        <span class="media-title" :title="media.title">{{ media.title }}</span>
        <span v-if="statusLabel" class="media-subtitle" :title="updateFeedback?.detail || statusLabel" :class="{ 'has-update': (media.newEpisodeCount || 0) > 0 }">{{ statusLabel }}</span>
      </span>
    </button>
    <button type="button" class="more-trigger" :aria-label="`打开《${media.title}》的更多操作`" :title="`《${media.title}》的更多操作`" @click="emit('open-actions', media)"><Ellipsis aria-hidden="true" /></button>
  </article>
</template>

<style scoped>
.media-card { position:relative; min-width:0; }
.card-play-target { display:flex; width:100%; min-width:0; flex-direction:column; gap:9px; padding:0; border:0; border-radius:8px; color:var(--text-primary); background:transparent; text-align:left; cursor:pointer; }
.poster-viewport { position:relative; display:block; width:100%; aspect-ratio:2/3; overflow:hidden; border-radius:8px; background:var(--surface-2); outline:2px solid transparent; outline-offset:3px; transition:transform .18s ease,outline-color .18s ease; }
.poster-image { display:block; width:100%; height:100%; object-fit:cover; }
.quality-tag { position:absolute; top:10px; left:10px; max-width:calc(100% - 60px); overflow:hidden; padding:3px 6px; border-radius:4px; color:#fff; background:#111b; font-size:.62rem; font-weight:650; text-overflow:ellipsis; white-space:nowrap; }
.card-caption { display:grid; min-width:0; width:100%; gap:3px; padding:0 1px; }
.media-title { display:block; overflow:hidden; font-size:.85rem; font-weight:550; text-overflow:ellipsis; white-space:nowrap; line-height:1.4; }
.media-subtitle { overflow:hidden; color:var(--text-tertiary); font-size:.73rem; line-height:1.5; text-overflow:ellipsis; white-space:nowrap; }
.media-subtitle.has-update { color:var(--liquid-accent); }
.more-trigger { position:absolute; top:3px; right:3px; display:grid; width:44px; height:44px; place-items:center; padding:0; border:0; border-radius:50%; color:#fff; background:radial-gradient(circle,#0009 0,#0009 45%,transparent 47%); cursor:pointer; }
.more-trigger svg { width:19px; height:19px; filter:drop-shadow(0 1px 2px #0008); }
.hover-play { position:absolute; inset:0; display:grid; place-items:center; opacity:0; background:#0002; transition:opacity .18s ease; }
.play-disk { display:grid; width:48px; height:48px; place-items:center; border-radius:50%; color:#141414; background:#fffffff0; }
.play-disk svg { width:21px; height:21px; margin-left:2px; }
.card-play-target:focus-visible { outline:0; }
.card-play-target:focus-visible .poster-viewport { outline-color:var(--text-primary); }
.card-play-target:focus-visible .hover-play { opacity:1; }
.more-trigger:focus-visible { outline:2px solid #fff; outline-offset:-4px; }
@media (hover:hover) and (pointer:fine) { .card-play-target:hover .poster-viewport { transform:scale(1.025); outline-color:var(--text-primary); } .card-play-target:hover .hover-play { opacity:1; } }
@media(max-width:640px) { .card-play-target { gap:8px; } .media-title { font-size:.84rem; } }
@media(prefers-reduced-motion:reduce) { .poster-viewport,.hover-play { transition:none; } .card-play-target:hover .poster-viewport { transform:none; } }
</style>
