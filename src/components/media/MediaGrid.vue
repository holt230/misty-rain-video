<script setup lang="ts">
import { Film, Search } from '@lucide/vue';
import type { MediaItem, CategoryType } from '../../types/media';
import MediaCard from './MediaCard.vue';

defineProps<{
  mediaList: MediaItem[];
  currentCategoryName: string;
  currentCategory: CategoryType;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select-media', media: MediaItem): void;
  (e: 'delete-card', media: MediaItem): void;
  (e: 're-search', media: MediaItem): void;
  (e: 'edit-category', media: MediaItem): void;
  (e: 'open-actions', media: MediaItem): void;
  (e: 'start-search'): void;
}>();
</script>

<template>
  <div v-if="loading" class="media-grid media-grid-loading" aria-busy="true" aria-label="正在读取片库">
    <div v-for="index in 6" :key="index" class="media-skeleton" aria-hidden="true">
      <span class="media-skeleton-poster"></span>
      <span class="media-skeleton-title"></span>
      <span class="media-skeleton-subtitle"></span>
    </div>
  </div>

  <div v-else-if="mediaList.length > 0" class="media-grid">
    <MediaCard
      v-for="media in mediaList"
      :key="media.id"
      :media="media"
      @click-card="emit('select-media', media)"
      @delete-card="emit('delete-card', media)"
      @re-search="emit('re-search', media)"
      @edit-category="emit('edit-category', media)"
      @open-actions="emit('open-actions', media)"
    />
  </div>

  <div v-else class="empty-state-card">
    <div class="empty-icon"><Film aria-hidden="true" /></div>
    <span class="empty-kicker">{{ currentCategoryName }}</span>
    <h3 class="empty-title">这里还没有影片</h3>
    <p class="empty-text">搜索片名或粘贴链接，加入私人片库。</p>
    <button type="button" class="empty-action" @click="emit('start-search')">
      <Search aria-hidden="true" />
      搜索片源
    </button>
  </div>
</template>

<style scoped>
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
  gap: 24px 16px;
}

.media-skeleton { display: grid; gap: 9px; min-width: 0; }
.media-skeleton-poster,
.media-skeleton-title,
.media-skeleton-subtitle {
  display: block;
  overflow: hidden;
  border-radius: 12px;
  background: linear-gradient(100deg, rgb(237 240 255 / 0.025) 25%, rgb(237 240 255 / 0.09) 50%, rgb(237 240 255 / 0.025) 75%);
  background-size: 220% 100%;
  animation: media-skeleton-shimmer 1.45s ease-in-out infinite;
}
.media-skeleton-poster { width: 100%; aspect-ratio: 2 / 3; border: 1px solid rgb(239 241 255 / 0.055); }
.media-skeleton-title { width: 68%; height: 13px; border-radius: 6px; }
.media-skeleton-subtitle { width: 38%; height: 9px; border-radius: 5px; animation-delay: 0.08s; }
@keyframes media-skeleton-shimmer { from { background-position: 100% 0; } to { background-position: -120% 0; } }

.empty-state-card {
  position: relative;
  isolation: isolate;
  display: flex;
  min-height: 330px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: hidden;
  padding: 48px 24px;
  border: 1px solid rgb(239 241 255 / 0.09);
  border-radius: 22px;
  background:
    radial-gradient(65% 90% at 50% 115%, rgb(var(--accent-rgb) / 0.12), transparent 70%),
    rgb(237 240 255 / 0.025);
  box-shadow: inset 0 1px rgb(255 255 255 / 0.045);
  text-align: center;
}

.empty-state-card::after {
  content: '';
  position: absolute;
  width: 190px;
  height: 190px;
  border: 1px solid rgb(var(--accent-rgb) / 0.12);
  border-radius: 50%;
  z-index: -1;
  box-shadow: 0 0 70px rgb(var(--accent-rgb) / 0.07), inset 0 0 45px rgb(var(--accent-rgb) / 0.04);
}

.empty-icon {
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  margin-bottom: 5px;
  border: 1px solid rgb(var(--accent-rgb) / 0.19);
  border-radius: 18px;
  color: var(--liquid-accent);
  background: var(--liquid-accent-subtle);
  box-shadow: 0 0 28px rgb(var(--accent-rgb) / 0.08);
}
.empty-icon svg { width: 26px; height: 26px; }
.empty-kicker { color: var(--liquid-accent); font-size: 0.67rem; font-weight: 720; letter-spacing: 0.1em; }
.empty-title { color: var(--text-primary); font-size: 1.12rem; font-weight: 720; }
.empty-text { max-width: 330px; color: var(--text-tertiary); font-size: 0.82rem; line-height: 1.6; }

.empty-action {
  display: inline-flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 10px;
  padding: 0 20px;
  border: 0;
  border-radius: 14px;
  color: var(--accent-ink);
  background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong));
  box-shadow: 0 9px 24px var(--liquid-accent-glow);
  font-size: 0.84rem;
  font-weight: 720;
  cursor: pointer;
}
.empty-action svg { width: 17px; height: 17px; }

@media (max-width: 640px) {
  .media-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 21px 11px;
  }

  .empty-state-card {
    min-height: 260px;
    padding: 32px 22px;
    border-radius: 20px;
  }
}

@media (max-width: 359px) {
  .media-grid { gap: 18px 9px; }
}

@media (prefers-reduced-motion: reduce) {
  .media-skeleton-poster,
  .media-skeleton-title,
  .media-skeleton-subtitle { animation: none; }
}
</style>
