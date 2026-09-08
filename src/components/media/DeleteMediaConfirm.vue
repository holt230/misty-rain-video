<script setup lang="ts">
import { ref } from 'vue';
import { useDialog } from '../../composables/useDialog';
import { Trash2 } from '@lucide/vue';
import type { MediaItem } from '../../types/media';

const props = defineProps<{
  open: boolean;
  media: MediaItem | null;
  deleting?: boolean;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'confirm'): void;
}>();

const dialogRef = ref<HTMLElement | null>(null);
useDialog(dialogRef, () => props.open, () => { if (!props.deleting) emit('cancel'); });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && media"
      class="confirm-backdrop"
      ref="dialogRef"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
      @click.self="!deleting && emit('cancel')"
    >
      <section class="confirm-sheet glass-rim">
        <div class="drag-handle" aria-hidden="true"></div>
        <div class="danger-icon" aria-hidden="true">
          <Trash2 />
        </div>
        <div class="confirm-copy">
          <h2 id="delete-title">删除《{{ media.title }}》？</h2>
          <p>
            影片目录将移入云盘回收站，可在回收站内恢复。
            <template v-if="(media.duplicateCount || 1) > 1">
              检测到 {{ media.duplicateCount }} 个同名目录，本次只移除当前目录；其余同名内容仍会保留。
            </template>
          </p>
        </div>
        <div class="confirm-actions">
          <button type="button" class="cancel-button" :disabled="deleting" @click="emit('cancel')">
            取消
          </button>
          <button type="button" class="delete-button" :disabled="deleting" @click="emit('confirm')">
            <span v-if="deleting" class="button-spinner" aria-hidden="true"></span>
            {{ deleting ? '正在删除…' : '移入回收站' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-backdrop { position: fixed; inset: 0; z-index: 1800; display: flex; align-items: center; justify-content: center; padding: 20px; }
.confirm-sheet { width: min(430px, 100%); padding: 28px; border-radius: 30px; }
.drag-handle { display: none; }
.danger-icon { display: grid; width: 52px; height: 52px; place-items: center; margin-bottom: 20px; border: 1px solid rgb(255 255 255 / .09); border-radius: 18px; color: var(--danger); background: var(--danger-surface); }
.danger-icon svg { width: 24px; height: 24px; }
.confirm-copy h2 { margin-bottom: 12px; color: var(--text-primary); font-size: 1.25rem; font-weight: 720; line-height: 1.45; overflow-wrap: anywhere; }
.confirm-copy p { color: var(--text-secondary); font-size: .87rem; line-height: 1.7; }
.confirm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 26px; }
.confirm-actions button { min-height: 50px; border: 1px solid rgb(255 255 255 / .09); border-radius: 26px; font-size: .87rem; font-weight: 650; }
.cancel-button { color: var(--text-secondary); }
.delete-button { color: #fff; background: #bb3c4d; box-shadow: none; }
.button-spinner { display: inline-block; width: 14px; height: 14px; margin-right: 5px; border: 1px solid rgb(255 255 255 / .09); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) { .confirm-backdrop { align-items: flex-end; padding: 0; } .confirm-sheet { padding-top: 10px; } .drag-handle { display: block; width: 36px; height: 5px; margin: 0 auto 24px; border-radius: 10px; } }
</style>
