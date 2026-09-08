<script setup lang="ts">
import { ref } from 'vue';
import { useDialog } from '../../composables/useDialog';
import { ChevronRight, Download, ListFilter, RefreshCw, Trash2, X } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import type { MediaItem } from '../../types/media';

const props = defineProps<{
  open: boolean;
  media: MediaItem | null;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'edit-category'): void;
  (e: 're-search'): void;
  (e: 'update-library'): void;
  (e: 'delete'): void;
}>();

const dialogRef = ref<HTMLElement | null>(null);
useDialog(dialogRef, () => props.open, () => emit('cancel'));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && media"
      class="action-backdrop"
      ref="dialogRef"
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-action-title"
      @click.self="emit('cancel')"
    >
      <section class="action-sheet glass-rim">
        <div class="drag-handle" aria-hidden="true"></div>

        <header class="media-summary">
<MediaPoster :src="media.poster" :alt="media.title" class="summary-poster" />
          <div class="summary-copy">
            <span>影片操作</span>
            <h2 id="media-action-title">{{ media.title }}</h2>
          </div>
          <button type="button" class="close-button" aria-label="关闭影片操作" @click="emit('cancel')">
            <X aria-hidden="true" />
          </button>
        </header>

        <div class="action-list">
          <button v-if="(media.newEpisodeCount || 0) > 0" type="button" class="action-item update" @click="emit('update-library')">
            <span class="action-icon" aria-hidden="true">
              <Download />
            </span>
            <span class="action-copy">
              <strong>更新 {{ media.newEpisodeCount }} 集</strong>
              <small>{{ media.latestEpisodeNumber ? `片源已更新至第 ${media.latestEpisodeNumber} 集` : '片源发现新的正片内容' }}</small>
            </span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>

          <button type="button" class="action-item" @click="emit('edit-category')">
            <span class="action-icon" aria-hidden="true">
              <ListFilter />
            </span>
            <span class="action-copy">
              <strong>修改分类</strong>
              <small>调整影片所在的分类</small>
            </span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>

          <button type="button" class="action-item" @click="emit('re-search')">
            <span class="action-icon" aria-hidden="true">
              <RefreshCw />
            </span>
            <span class="action-copy">
              <strong>更换资源</strong>
              <small>{{ media.updateMessage || '重新检索并选择片源' }}</small>
            </span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>

          <button type="button" class="action-item danger" @click="emit('delete')">
            <span class="action-icon" aria-hidden="true">
              <Trash2 />
            </span>
            <span class="action-copy">
              <strong>移出片库</strong>
              <small>删除前会再次向你确认</small>
            </span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>
        </div>

        <button type="button" class="cancel-button" @click="emit('cancel')">取消</button>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.action-backdrop { position: fixed; inset: 0; z-index: 1700; display: flex; align-items: center; justify-content: center; padding: 20px; }
.action-sheet { width: min(440px, 100%); padding: 24px; border-radius: 30px; }
.drag-handle { display: none; }
.media-summary { display: flex; align-items: center; gap: 13px; margin-bottom: 22px; }
.summary-poster { width: 48px; height: 66px; flex-shrink: 0; object-fit: cover; border: 1px solid rgb(255 255 255 / .09); border-radius: 12px; box-shadow: var(--glass-shadow-sm); }
.summary-copy { min-width: 0; flex: 1; }
.summary-copy span { color: var(--text-tertiary); font-size: .74rem; }
.summary-copy h2 { margin-top: 4px; color: var(--text-primary); font-size: 1.12rem; font-weight: 700; overflow-wrap: anywhere; line-height: 1.45; }
.close-button { display: grid; width: 44px; height: 44px; flex-shrink: 0; place-items: center; border-radius: 50%; }
.close-button svg { width: 19px; height: 19px; }
.action-list { border: 0; border-radius: 14px; overflow: hidden; }
.action-item { display: flex; width: 100%; min-height: 76px; align-items: center; gap: 13px; padding: 12px 15px; border: 0; border-bottom: 1px solid rgb(90 116 159 / .10); color: var(--text-primary); background: transparent; text-align: left; }
.action-item:last-child { border-bottom: 0; }
.action-icon { display: grid; width: 30px; height: 40px; place-items: center; flex-shrink: 0; color: var(--text-secondary); }
.action-icon svg { width: 21px; height: 21px; }
.action-copy { display: grid; gap: 3px; min-width: 0; flex: 1; }
.action-copy strong { font-size: .92rem; font-weight: 650; }
.action-copy small { color: var(--text-tertiary); font-size: .74rem; line-height: 1.5; overflow-wrap: anywhere; }
.chevron { width: 17px; height: 17px; flex-shrink: 0; color: var(--text-tertiary); }
.danger .action-icon { color: var(--danger); background: var(--danger-surface); }
.danger strong { color: var(--danger); }
.cancel-button { width: 100%; min-height: 50px; margin-top: 16px; border: 1px solid; border-radius: 26px; color: var(--text-secondary); font-size: .92rem; font-weight: 600; }
@media (max-width: 640px) { .action-backdrop { align-items: flex-end; padding: 0; } .action-sheet { padding-top: 10px; } .drag-handle { display: block; width: 36px; height: 5px; margin: 0 auto 22px; border-radius: 10px; } .action-item { min-height: 74px; } }
</style>
