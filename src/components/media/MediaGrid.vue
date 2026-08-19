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
  display: grid;
  min-height: 310px;
  grid-template-columns: minmax(190px, 0.72fr) minmax(280px, 1fr);
  align-items: center;
  gap: clamp(28px, 6vw, 72px);
  overflow: hidden;
  padding: 46px clamp(34px, 7vw, 88px);
  border: 1px solid rgb(239 241 255 / 0.09);
  border-radius: 28px;
  background:
    radial-gradient(55% 120% at 10% 100%, rgb(var(--accent-rgb) / 0.13), transparent 72%),
    linear-gradient(145deg, rgb(237 240 255 / 0.04), rgb(237 240 255 / 0.016));
  box-shadow: inset 0 1px rgb(255 255 255 / 0.055), 0 24px 70px rgb(0 0 0 / 0.12);
}

.empty-visual {
  position: relative;
  width: 190px;
  height: 178px;
  justify-self: center;
  animation: empty-visual-float 6s ease-in-out infinite;
}

.empty-glow {
  position: absolute;
  inset: 28px 12px 0;
  border-radius: 50%;
  background: rgb(var(--accent-rgb) / 0.18);
  filter: blur(38px);
}

.empty-poster {
  position: absolute;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(239 241 255 / 0.13);
  border-radius: 17px;
  box-shadow: 0 18px 45px rgb(0 0 0 / 0.32);
}

.empty-poster-back {
  top: 26px;
  width: 78px;
  height: 118px;
  background: linear-gradient(155deg, rgb(73 82 125 / 0.88), rgb(19 22 34 / 0.9));
  opacity: 0.72;
}

.empty-poster-back::after {
  content: '';
  position: absolute;
  inset: 48% 12px 14px;
  border-radius: 8px;
  background: linear-gradient(180deg, rgb(255 255 255 / 0.1), transparent);
}

.empty-poster-left { left: 12px; transform: rotate(-10deg); }
.empty-poster-right { right: 12px; transform: rotate(10deg); }

.empty-poster-main {
  top: 8px;
  left: 50%;
  width: 94px;
  height: 142px;
  align-items: center;
  justify-content: space-between;
  padding: 26px 14px 16px;
  border-color: rgb(var(--accent-rgb) / 0.3);
  background:
    radial-gradient(circle at 50% 20%, rgb(var(--accent-rgb) / 0.34), transparent 42%),
    linear-gradient(165deg, #2a304c, #10121b 72%);
  transform: translateX(-50%);
  box-shadow: 0 22px 54px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(255 255 255 / 0.035) inset;
}

.empty-poster-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgb(var(--accent-rgb) / 0.28);
  border-radius: 14px;
  color: #d9deff;
  background: rgb(var(--accent-rgb) / 0.12);
  box-shadow: 0 8px 28px rgb(var(--accent-rgb) / 0.13);
}
.empty-poster-mark svg { width: 21px; height: 21px; }
.empty-poster-lines { width: 100%; display: grid; gap: 6px; }
.empty-poster-lines i { height: 4px; border-radius: 999px; background: rgb(237 240 255 / 0.18); }
.empty-poster-lines i:last-child { width: 62%; background: rgb(237 240 255 / 0.1); }

.empty-content {
  display: flex;
  max-width: 430px;
  flex-direction: column;
  align-items: flex-start;
}
.empty-kicker { margin-bottom: 10px; color: var(--liquid-accent); font-size: 0.68rem; font-weight: 720; letter-spacing: 0.08em; }
.empty-title { color: var(--text-primary); font-size: clamp(1.25rem, 2.7vw, 1.62rem); font-weight: 720; letter-spacing: -0.02em; line-height: 1.2; }
.empty-text { max-width: 390px; margin-top: 10px; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.65; }

.empty-action {
  display: inline-flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 22px;
  padding: 0 21px;
  border: 0;
  border-radius: 15px;
  color: var(--accent-ink);
  background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong));
  box-shadow: 0 10px 28px rgb(var(--accent-rgb) / 0.18), inset 0 1px rgb(255 255 255 / 0.28);
  font-size: 0.84rem;
  font-weight: 720;
  cursor: pointer;
  transition: background 180ms ease, box-shadow 180ms ease;
}
.empty-action svg { width: 17px; height: 17px; }
.empty-action:hover { background: linear-gradient(145deg, var(--liquid-accent-hover), var(--liquid-accent)); box-shadow: 0 13px 34px rgb(var(--accent-rgb) / 0.24); }
.empty-action:focus-visible { outline: 2px solid var(--liquid-accent-hover); outline-offset: 3px; }
.empty-hint { margin-top: 11px; color: var(--text-tertiary); font-size: 0.68rem; }

@keyframes empty-visual-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

@media (max-width: 640px) {
  .media-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 21px 11px;
  }

  .empty-state-card {
    min-height: 390px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
    padding: 24px 16px 54px;
    border: 0;
    border-radius: 0;
    background: radial-gradient(70% 45% at 50% 35%, rgb(var(--accent-rgb) / 0.11), transparent 78%);
    box-shadow: none;
  }

  .empty-visual { width: 170px; height: 160px; flex: 0 0 auto; }
  .empty-poster-back { top: 25px; width: 71px; height: 107px; }
  .empty-poster-main { width: 87px; height: 132px; }
  .empty-content { align-items: center; text-align: center; }
  .empty-kicker { margin-bottom: 8px; }
  .empty-title { font-size: 1.3rem; }
  .empty-text { max-width: 310px; margin-top: 9px; font-size: 0.81rem; }
  .empty-action { min-width: 210px; min-height: 48px; margin-top: 20px; }
  .empty-hint { margin-top: 10px; }
}

@media (max-width: 359px) {
  .media-grid { gap: 18px 9px; }
}

@media (prefers-reduced-motion: reduce) {
  .media-skeleton-poster,
  .media-skeleton-title,
  .media-skeleton-subtitle,
  .empty-visual { animation: none; }
}
</style>
