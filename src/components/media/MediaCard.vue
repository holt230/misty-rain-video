<script setup lang="ts">
import { ChevronDown, Ellipsis, Play, X } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import type { MediaItem } from '../../types/media';

defineProps<{ media: MediaItem }>();

const emit = defineEmits<{
  (e: 'click-card', media: MediaItem): void;
  (e: 'delete-card', media: MediaItem): void;
  (e: 're-search', media: MediaItem): void;
  (e: 'edit-category', media: MediaItem): void;
  (e: 'open-actions', media: MediaItem): void;
}>();

const categoryLabels: Record<MediaItem['category'], string> = {
  tv: '电视剧',
  movie: '电影',
  variety: '综艺',
  anime: '动漫'
};
</script>

<template>
  <article class="media-card">
    <button
      type="button"
      class="card-play-target"
      :aria-label="`播放《${media.title}》${media.latestEpisodeNumber ? `，更新至第 ${media.latestEpisodeNumber} 集` : ''}`"
      @click="emit('click-card', media)"
    >
      <span class="poster-viewport">
<MediaPoster :src="media.poster" alt="" class="poster-image" loading="lazy" decoding="async" />
        <span class="poster-vignette" aria-hidden="true"></span>
        <span class="quality-tag">{{ media.tag || media.quarkQuality || '高清' }}</span>

        <span class="hover-play" aria-hidden="true">
          <span class="play-disk"><Play fill="currentColor" /></span>
        </span>

        <span
          v-if="media.status || media.latestEpisodeNumber || media.newEpisodeCount || media.updateMessage"
          class="status-badge"
          :class="{ 'has-update': (media.newEpisodeCount || 0) > 0 }"
        >
          <template v-if="(media.newEpisodeCount || 0) > 0">新 {{ media.newEpisodeCount }} 集</template>
          <template v-else-if="media.latestEpisodeNumber">更新至 {{ media.latestEpisodeNumber }} 集</template>
          <template v-else-if="media.updateMessage">片源待更换</template>
          <template v-else>{{ media.status }}</template>
        </span>
      </span>

      <span class="card-caption">
        <span class="media-title" :title="media.title">{{ media.title }}</span>
        <span class="media-subtitle">{{ categoryLabels[media.category] }}</span>
      </span>
    </button>

    <button
      type="button"
      class="more-trigger"
      :aria-label="`打开《${media.title}》的更多操作`"
      @click="emit('open-actions', media)"
    >
      <Ellipsis aria-hidden="true" />
    </button>

    <button
      type="button"
      class="category-trigger"
      :aria-label="`修改《${media.title}》的分类`"
      title="修改分类"
      @click="emit('edit-category', media)"
    >
      <span>{{ categoryLabels[media.category] }}</span>
      <ChevronDown aria-hidden="true" />
    </button>

    <div class="hover-actions">
      <button type="button" class="card-action" title="更换资源" @click="emit('re-search', media)">换源</button>
      <button
        type="button"
        class="card-action danger"
        title="删除影片"
        :aria-label="`删除《${media.title}》`"
        @click="emit('delete-card', media)"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  </article>
</template>

<style scoped>
.media-card { position: relative; min-width: 0; }
.card-play-target { display: flex; width: 100%; min-width: 0; flex-direction: column; gap: 11px; padding: 0; border: 0; color: var(--text-primary); background: transparent; text-align: left; border-radius: 23px; }
.poster-viewport { position: relative; display: block; width: 100%; aspect-ratio: 2 / 3; overflow: hidden; border: 1px solid rgb(255 255 255 / .09); border-radius: 22px; background: var(--surface-2); box-shadow: 0 8px 22px rgb(0 0 0 / .23); }
.poster-image { width: 100%; height: 100%; object-fit: cover; transition: transform .3s; }
.poster-vignette { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgb(12 27 51 / .14), transparent 40%, rgb(12 27 51 / .57)); }
.quality-tag { position: absolute; top: 10px; left: 10px; max-width: calc(100% - 64px); overflow: hidden; padding: 4px 8px; border: 1px solid rgb(255 255 255 / .15); border-radius: 10px; color: #fff; background: rgb(23 41 65 / .65); font-size: .62rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.status-badge { position: absolute; right: 10px; bottom: 12px; left: 12px; overflow: hidden; color: #fff; text-shadow: 0 1px 5px rgb(0 0 0 / .55); font-size: .73rem; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.status-badge.has-update { right: auto; padding: 4px 8px; border: 1px solid rgb(255 255 255 / .09); border-radius: 10px; color: #fff; background: #2c60cf; text-shadow: none; }
.card-caption { display: grid; min-width: 0; width: 100%; gap: 3px; padding: 0 3px; }
.media-title { display: block; overflow: hidden; color: var(--text-primary); font-size: .95rem; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -.025em; }
.media-subtitle { color: var(--text-tertiary); font-size: .73rem; }
.more-trigger { position: absolute; top: 6px; right: 6px; display: grid; width: 44px; height: 44px; place-items: center; padding: 0; border: 0; border-radius: 50%; color: #fff; background: transparent; }
.more-trigger::before { content: ''; position: absolute; inset: 6px; z-index: 0; border: 1px solid rgb(255 255 255 / .15); border-radius: 50%; background: rgb(27 43 69 / .58); }
.more-trigger svg { position: relative; width: 19px; height: 19px; }
.category-trigger, .hover-actions { display: none; }
.hover-play { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; transition: opacity .2s; }
.play-disk { display: grid; width: 54px; height: 54px; place-items: center; border: 1px solid rgb(255 255 255 / .09); border-radius: 50%; color: #fff; background: var(--glass-bg); backdrop-filter: blur(10px); }
.play-disk svg { width: 22px; height: 22px; margin-left: 2px; }
@media (hover: hover) { .card-play-target:hover .poster-image { transform: scale(1.035); } .card-play-target:hover .hover-play { opacity: 1; } }
.card-play-target:focus-visible .hover-play { opacity: 1; }
@media (max-width: 640px) { .media-title { font-size: .87rem; } .poster-viewport { border-radius: 20px; } .card-play-target { gap: 9px; } }
</style>
