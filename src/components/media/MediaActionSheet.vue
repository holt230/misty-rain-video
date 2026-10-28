<script setup lang="ts">
import { computed, ref } from 'vue';
import { getLibraryUpdateFeedback } from '../../services/libraryUpdateFeedback';
import { useDialog } from '../../composables/useDialog';
import { ChevronRight, Download, ListFilter, Pencil, RefreshCw, Trash2, X } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import type { MediaItem } from '../../types/media';

const props = defineProps<{
  open: boolean;
  media: MediaItem | null;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'edit-category'): void;
  (e: 'edit-title'): void;
  (e: 're-search'): void;
  (e: 'update-library'): void;
  (e: 'delete'): void;
}>();

const updateFeedback = computed(() => props.media ? getLibraryUpdateFeedback(props.media) : null);

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
      <section class="action-sheet">
        <div class="drag-handle" aria-hidden="true"></div>

        <header class="media-summary">
<MediaPoster :src="media.poster" :alt="media.title" class="summary-poster" />
          <div class="summary-copy">
            <h2 id="media-action-title">{{ media.title }}</h2>
          </div>
          <button type="button" class="close-button" aria-label="关闭影片操作" @click="emit('cancel')">
            <X aria-hidden="true" />
          </button>
        </header>

        <div v-if="updateFeedback" class="update-feedback" role="status">
          <strong>{{ updateFeedback.label }}</strong>
        </div>

        <div class="action-list">
          <button v-if="media.quarkFid" type="button" class="action-item" @click="emit('edit-title')">
            <span class="action-icon" aria-hidden="true"><Pencil /></span>
            <span class="action-copy"><strong>修改名称</strong></span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>
          <button v-if="(media.newEpisodeCount || 0) > 0" type="button" class="action-item update" @click="emit('update-library')">
            <span class="action-icon" aria-hidden="true">
              <Download />
            </span>
            <span class="action-copy">
              <strong>更新 {{ media.newEpisodeCount }} 集</strong>
            </span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>

          <button type="button" class="action-item" @click="emit('edit-category')">
            <span class="action-icon" aria-hidden="true">
              <ListFilter />
            </span>
            <span class="action-copy">
              <strong>修改分类</strong>
            </span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>

          <button type="button" class="action-item" @click="emit('re-search')">
            <span class="action-icon" aria-hidden="true">
              <RefreshCw />
            </span>
            <span class="action-copy">
              <strong>更换资源</strong>
            </span>
            <ChevronRight class="chevron" aria-hidden="true" />
          </button>

          <button type="button" class="action-item danger" @click="emit('delete')">
            <span class="action-icon" aria-hidden="true">
              <Trash2 />
            </span>
            <span class="action-copy">
              <strong>移除收藏</strong>
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
.action-sheet { width: min(440px, 100%); padding: 24px; border-radius:20px; }
.drag-handle { display: none; }
.media-summary { display: flex; align-items: center; gap: 13px; margin-bottom: 20px; }
.summary-poster { width:48px; height:72px; flex-shrink: 0; object-fit: cover; border: 1px solid var(--divider); border-radius: 12px; box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, .15), var(--glass-shadow-sm); }
.summary-copy { min-width: 0; flex: 1; }
.summary-copy h2 { margin-top: 3px; color: var(--text-primary); font-size:1.05rem; font-weight:650; overflow-wrap: anywhere; line-height: 1.4; letter-spacing: -.02em; }
.close-button { display: grid; width: 44px; height: 44px; flex-shrink: 0; place-items: center; border-radius: 50%; }
.close-button svg { width: 19px; height: 19px; }
.update-feedback { margin: 0 0 16px; padding: 12px 14px; border-radius:12px; background: var(--glass-bg); }
.update-feedback strong { color: var(--text-primary); font-size: .84rem; font-weight: 600; }
.action-list { border: 0; border-radius:12px; overflow: hidden; }
.action-item { display: flex; width: 100%; min-height:52px; align-items: center; gap: 13px; padding:8px; border: 0; border-bottom:1px solid var(--divider); color: var(--text-primary); background: transparent; text-align: left; transition: background .15s; }
.action-item:last-child { border-bottom: 0; }
.action-item:active { background: var(--glass-bg-active); }
.action-icon { display: grid; width: 32px; height: 32px; place-items: center; flex-shrink: 0; color: var(--text-secondary); }
.action-icon svg { width: 20px; height: 20px; }
.action-copy { display: grid; gap: 2px; min-width: 0; flex: 1; }
.action-copy strong { font-size:.88rem; font-weight:550; }
.chevron { width: 17px; height: 17px; flex-shrink: 0; color: var(--text-tertiary); }
.danger .action-icon { color: var(--danger); }
.danger strong { color: var(--danger); }
.cancel-button { background:var(--surface-2); width: 100%; min-height: 52px; margin-top: 14px; border: 1px solid var(--divider); border-radius:12px; color: var(--text-primary); font-size: .94rem; font-weight: 600; transition: background .15s, transform .15s; }
.cancel-button:active { background: var(--glass-bg-hover); transform: scale(.99); }
@media (max-width: 640px) {
  .action-backdrop { align-items:flex-end; padding:max(8px,var(--safe-area-top)) max(8px,var(--safe-area-right)) max(8px,var(--safe-area-bottom)) max(8px,var(--safe-area-left)); }
  .action-sheet { padding-top: 12px; border-radius:20px; }
  .drag-handle { display: block; width: 36px; height: 5px; margin: 0 auto 18px; border-radius:999px; background:var(--divider); }
  .action-item { min-height:52px; }
}
.action-backdrop { background:var(--dialog-backdrop,rgb(0 0 0 / .6)); }
.action-sheet { max-height:calc(100dvh - var(--safe-area-top) - var(--safe-area-bottom) - 32px); overflow-y:auto; overscroll-behavior:contain; border:1px solid var(--divider); background:var(--surface-elevated,var(--surface-1)); box-shadow:0 24px 80px #0005; animation:sheet-enter .18s ease; }
button { cursor:pointer; } button:disabled { opacity:.5; cursor:default; }
button:focus-visible { outline:2px solid var(--text-primary); outline-offset:-2px; }
.close-button { border:0; color:var(--text-secondary); background:transparent; }
@keyframes sheet-enter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
@media(max-width:640px) { .action-sheet { padding:16px 20px 20px; } }
@media(prefers-reduced-motion:reduce) { .action-sheet { animation:none; } button { transition:none; } }
</style>
