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
    <div class="empty-visual" aria-hidden="true">
      <span class="empty-glow"></span>
      <span class="empty-poster empty-poster-back empty-poster-left"></span>
      <span class="empty-poster empty-poster-back empty-poster-right"></span>
      <span class="empty-poster empty-poster-main">
        <span class="empty-poster-mark"><Film /></span>
        <span class="empty-poster-lines"><i></i><i></i></span>
      </span>
    </div>

    <div class="empty-content">
      <span class="empty-kicker">{{ currentCategoryName }}片库</span>
      <h3 class="empty-title">从喜欢的第一部开始</h3>
      <p class="empty-text">搜索片名或粘贴分享链接，系统会自动整理剧集与海报。</p>
      <button type="button" class="empty-action" @click="emit('start-search')">
        <Search aria-hidden="true" />
        添加第一部影片
      </button>
      <span class="empty-hint">内容仅保存在你的私人片库</span>
    </div>
  </div>
</template>

<style scoped>
.media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 28px 20px; }
.media-skeleton { display: grid; gap: 10px; min-width: 0; }
.media-skeleton-poster, .media-skeleton-title, .media-skeleton-subtitle { display: block; background: linear-gradient(100deg, rgb(255 255 255 / .035), rgb(255 255 255 / .085), rgb(255 255 255 / .035)); background-size: 200% 100%; animation: shimmer 1.6s ease-in-out infinite; border-radius: 20px; }
.media-skeleton-poster { width: 100%; aspect-ratio: 2 / 3; border: 1px solid rgb(255 255 255 / .09); }
.media-skeleton-title { width: 65%; height: 14px; }
.media-skeleton-subtitle { width: 30%; height: 10px; }
.empty-state-card { display: flex; min-height: 350px; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 34px 20px; text-align: center; }
.empty-visual { position: relative; width: 180px; height: 150px; }
.empty-glow { position: absolute; inset: -20px; border-radius: 50%; background: radial-gradient(ellipse, rgb(160 185 219 / .08), transparent 70%); }
.empty-poster { position: absolute; width: 72px; height: 110px; border: 1px solid rgb(255 255 255 / .09); border-radius: 18px; background: var(--glass-material); box-shadow: var(--glass-highlight-inner), var(--glass-shadow-sm); }
.empty-poster-left { top: 25px; left: 16px; transform: rotate(-16deg); }
.empty-poster-right { top: 25px; right: 16px; transform: rotate(16deg); }
.empty-poster-main { display: flex; top: 5px; left: 50%; width: 86px; height: 130px; align-items: center; justify-content: center; transform: translateX(-50%); background: var(--glass-lens); }
.empty-poster-mark { color: var(--liquid-accent); }
.empty-poster-mark svg { width: 32px; height: 32px; stroke-width: 1.4; }
.empty-poster-lines { display: none; }
.empty-kicker { display: block; margin-bottom: 6px; color: var(--liquid-accent); font-size: .74rem; font-weight: 600; }
.empty-title { color: var(--text-primary); font-size: 1.45rem; font-weight: 740; letter-spacing: -.04em; }
.empty-text { max-width: 330px; margin: 10px auto 0; color: var(--text-secondary); font-size: .84rem; line-height: 1.7; }
.empty-action { display: inline-flex; min-height: 50px; align-items: center; justify-content: center; gap: 8px; margin-top: 24px; padding: 0 24px; border: 1px solid rgb(255 255 255 / .09); border-radius: 26px; color: var(--liquid-accent); background: var(--glass-bg); box-shadow: var(--glass-highlight-inner), var(--glass-shadow-md); font-size: .9rem; font-weight: 650; }
.empty-action svg { width: 18px; height: 18px; }
.empty-hint { display: block; margin-top: 13px; color: var(--text-tertiary); font-size: .71rem; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (max-width: 640px) { .media-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 23px 16px; } .empty-state-card { padding: 24px 0; gap: 12px; } .empty-title { font-size: 1.3rem; } }
</style>
