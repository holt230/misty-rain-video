<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import ScrollLoad from '../common/ScrollLoad.vue';
import { Compass, Film, Search } from '@lucide/vue';
import type { MediaItem, CategoryType } from '../../types/media';
import MediaCard from './MediaCard.vue';

const props = defineProps<{
  mediaList: MediaItem[];
  currentCategoryName: string;
  currentCategory: CategoryType;
  loading?: boolean;
  searchQuery?: string;
}>();

const limit=ref(30);
const visibleMedia=computed(()=>props.mediaList.slice(0,limit.value));
watch(()=>[props.currentCategory,props.searchQuery],()=>{limit.value=30;});
const emit = defineEmits<{
  (e: 'select-media', media: MediaItem): void;
  (e: 'delete-card', media: MediaItem): void;
  (e: 're-search', media: MediaItem): void;
  (e: 'edit-category', media: MediaItem): void;
  (e: 'open-actions', media: MediaItem): void;
  (e: 'start-search'): void;
  (e: 'browse', category: CategoryType): void;
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
      v-for="media in visibleMedia"
      :key="media.id"
      :media="media"
      @click-card="emit('select-media', media)"
      @delete-card="emit('delete-card', media)"
      @re-search="emit('re-search', media)"
      @edit-category="emit('edit-category', media)"
      @open-actions="emit('open-actions', media)"
    />
    <ScrollLoad :more="limit < mediaList.length" :progress="`${currentCategory}:${searchQuery}:${limit}:${mediaList.length}`" @load="limit += 30" />
  </div>

  <div v-else class="empty-state-card">
    <Film class="empty-icon" aria-hidden="true" />
    <h3 class="empty-title">{{ searchQuery ? '没有匹配的收藏' : `还没有${currentCategoryName}收藏` }}</h3>
    <div class="empty-actions">
      <button type="button" class="empty-action" @click="emit('browse',currentCategory)"><Compass aria-hidden="true" />浏览{{ currentCategoryName }}</button>
      <button type="button" class="empty-search" @click="emit('start-search')"><Search aria-hidden="true" />搜索片名</button>
    </div>
  </div>
</template>

<style scoped>
.media-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:32px 22px; }
.media-skeleton { display:grid; gap:10px; min-width:0; }
.media-skeleton-poster,.media-skeleton-title,.media-skeleton-subtitle { display:block; background:var(--surface-2); animation:breathe 1.6s ease-in-out infinite; }
.media-skeleton-poster { width:100%; aspect-ratio:2/3; border-radius:8px; }
.media-skeleton-title { width:65%; height:13px; border-radius:4px; }
.media-skeleton-subtitle { width:30%; height:10px; border-radius:4px; }
.empty-state-card { display:grid; min-height:320px; align-content:center; justify-items:center; gap:20px; padding:40px 16px; text-align:center; }
.empty-icon { width:40px; height:40px; color:var(--text-tertiary); stroke-width:1.4; }
.empty-title { color:var(--text-secondary); font-size:1.08rem; font-weight:550; }
.empty-actions { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; }
.empty-action,.empty-search { display:inline-flex; min-height:44px; align-items:center; justify-content:center; gap:8px; padding:0 16px; border:0; border-radius:7px; font-size:.84rem; cursor:pointer; }
.empty-action { color:var(--accent-ink); background:var(--liquid-accent); }
.empty-search { color:var(--text-secondary); background:var(--surface-2); }
.empty-actions svg { width:17px; height:17px; }
@keyframes breathe { 50% { opacity:.5; } }
@media(max-width:640px) { .media-grid { grid-template-columns:repeat(3,minmax(0,1fr)); gap:22px 10px; } }
@media(prefers-reduced-motion:reduce) { .media-skeleton-poster,.media-skeleton-title,.media-skeleton-subtitle { animation:none; } }
</style>
