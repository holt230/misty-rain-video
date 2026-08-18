<script setup lang="ts">
import { ChevronDown, Ellipsis, Play, X } from '@lucide/vue';
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
        <img :src="media.poster" alt="" class="poster-image" loading="lazy" decoding="async" />
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
.media-card {
  position: relative;
  min-width: 0;
  padding: 5px 5px 10px;
  border: 1px solid rgb(239 241 255 / 0.075);
  border-radius: 18px;
  background: rgb(237 240 255 / 0.025);
  box-shadow: inset 0 1px rgb(255 255 255 / 0.035), 0 12px 28px rgb(0 0 0 / 0.16);
  user-select: none;
  transition: transform 220ms ease, border-color 220ms ease, background 220ms ease, box-shadow 220ms ease;
}

.media-card:hover {
  border-color: rgb(var(--accent-rgb) / 0.18);
  background: rgb(237 240 255 / 0.045);
  box-shadow: 0 18px 38px rgb(0 0 0 / 0.28), 0 0 28px rgb(var(--accent-rgb) / 0.06);
  transform: translateY(-3px);
}

.card-play-target {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 9px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
}

.poster-viewport {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border-radius: 14px;
  background: var(--surface-2);
}

.poster-image { width: 100%; height: 100%; object-fit: cover; transition: transform 360ms ease, filter 360ms ease; }
.media-card:hover .poster-image { filter: saturate(1.06) brightness(1.02); transform: scale(1.035); }
.poster-vignette { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgb(4 5 10 / .08), transparent 48%, rgb(4 5 10 / .86) 100%); }

.quality-tag,
.status-badge,
.category-trigger,
.card-action {
  border: 1px solid rgb(239 241 255 / 0.12);
  color: rgb(250 250 255 / 0.92);
  background: rgb(9 10 16 / 0.72);
  box-shadow: inset 0 1px rgb(255 255 255 / 0.055);
  backdrop-filter: blur(14px) saturate(145%);
  -webkit-backdrop-filter: blur(14px) saturate(145%);
}

.quality-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  max-width: calc(100% - 54px);
  overflow: hidden;
  padding: 3px 8px;
  border-radius: 9px;
  font-size: 0.64rem;
  font-weight: 680;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  position: absolute;
  bottom: 8px;
  left: 8px;
  z-index: 2;
  max-width: calc(100% - 16px);
  overflow: hidden;
  padding: 3px 8px;
  border-radius: 9px;
  color: var(--text-secondary);
  font-size: 0.65rem;
  font-weight: 580;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge.has-update {
  border-color: rgb(var(--accent-rgb) / 0.26);
  color: var(--liquid-accent);
  background: rgb(27 32 57 / 0.82);
  box-shadow: 0 0 18px rgb(var(--accent-rgb) / 0.10);
}

.card-caption { display: grid; min-width: 0; gap: 1px; padding: 0 5px; }
.media-title { overflow: hidden; color: var(--text-primary); font-size: 0.91rem; font-weight: 650; line-height: 1.3; letter-spacing: -0.015em; text-overflow: ellipsis; white-space: nowrap; }
.media-subtitle { color: var(--text-quaternary); font-size: 0.65rem; }

.hover-play { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; opacity: 0; background: rgb(4 5 10 / 0.30); transition: opacity 180ms ease; }
.media-card:hover .hover-play { opacity: 1; }
.play-disk { display: grid; width: 50px; height: 50px; place-items: center; border-radius: 50%; color: var(--accent-ink); background: var(--liquid-accent); box-shadow: 0 10px 28px rgb(0 0 0 / .42), 0 0 24px var(--liquid-accent-glow); }
.play-disk svg { width: 21px; height: 21px; }

.category-trigger {
  position: absolute;
  top: 13px;
  right: 13px;
  z-index: 5;
  display: inline-flex;
  min-height: 27px;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-radius: 9px;
  font-size: 0.66rem;
  cursor: pointer;
}
.category-trigger svg { width: 13px; height: 13px; }

.hover-actions { position: absolute; top: 47px; right: 13px; z-index: 5; display: flex; gap: 5px; opacity: 0; transition: opacity 180ms ease; }
.media-card:hover .hover-actions { opacity: 1; }
.card-action { display: grid; min-height: 32px; place-items: center; padding: 0 10px; border-radius: 10px; font-size: 0.67rem; cursor: pointer; }
.card-action.danger { width: 32px; padding: 0; color: #ff938c; }
.card-action svg { width: 13px; height: 13px; }
.more-trigger { display: none; }

.card-play-target:focus-visible { outline: 2px solid var(--liquid-accent); outline-offset: 3px; border-radius: 14px; }

@media (hover: none), (max-width: 640px) {
  .media-card {
    padding: 0 0 5px;
    border: 0;
    border-radius: 14px;
    background: transparent;
    box-shadow: none;
  }
  .media-card:hover { transform: none; }
  .media-card:hover .poster-image { filter: none; transform: none; }
  .poster-viewport {
    border: 1px solid rgb(239 241 255 / 0.075);
    border-radius: 13px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.24);
  }
  .hover-play,
  .category-trigger,
  .hover-actions { display: none; }

  .more-trigger {
    position: absolute;
    top: 5px;
    right: 5px;
    z-index: 5;
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: rgb(250 250 255 / 0.9);
    background: transparent;
    cursor: pointer;
    touch-action: manipulation;
  }
  .more-trigger::before { content: ''; position: absolute; inset: 6px; z-index: -1; border: 1px solid rgb(239 241 255 / 0.12); border-radius: 50%; background: rgb(9 10 16 / 0.68); box-shadow: inset 0 1px rgb(255 255 255 / .06), 0 5px 15px rgb(0 0 0 / .28); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
  .more-trigger svg { width: 16px; height: 16px; fill: currentColor; }

  .quality-tag { top: 7px; left: 7px; padding: 2px 6px; font-size: 0.59rem; }
  .status-badge { right: 7px; bottom: 7px; left: 7px; max-width: none; padding: 2px 6px; font-size: 0.59rem; }
  .card-play-target { gap: 8px; }
  .card-caption { padding: 0 2px; }
  .media-title { font-size: 0.86rem; }
  .media-subtitle { font-size: 0.61rem; }
}

@media (prefers-reduced-motion: reduce) {
  .media-card,
  .poster-image,
  .hover-play,
  .hover-actions { transition: none; }
}
</style>
