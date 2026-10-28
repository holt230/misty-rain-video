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
      <section class="confirm-sheet">
        <div class="drag-handle" aria-hidden="true"></div>
        <div class="danger-icon" aria-hidden="true">
          <Trash2 />
        </div>
        <div class="confirm-copy">
          <h2 id="delete-title">移除《{{ media.title }}》的收藏？</h2>
          <p>
            影片目录将移入云盘回收站，可在回收站内恢复；对应观看记录会同步删除。
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
.confirm-sheet { width: min(430px, 100%); padding: 28px; border-radius:20px; }
.drag-handle { display: none; }
.danger-icon { display: grid; width: 52px; height: 52px; place-items: center; margin-bottom: 18px; border: 1px solid var(--divider); border-radius:12px; color: var(--danger); background: var(--danger-surface); }
.danger-icon svg { width: 24px; height: 24px; }
.confirm-copy h2 { margin-bottom: 10px; color: var(--text-primary); font-size:1.12rem; font-weight:650; line-height: 1.4; letter-spacing: -.02em; overflow-wrap: anywhere; }
.confirm-copy p { color: var(--text-secondary); font-size:.84rem; line-height: 1.65; }
.confirm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 24px; }
.confirm-actions button { min-height: 48px; border: 1px solid var(--divider); border-radius:12px; font-size: .9rem; font-weight: 600; transition: transform .15s, background .15s; }
.confirm-actions button:active { transform: scale(.98); }
.cancel-button { color: var(--text-primary); background: var(--glass-bg); }
.cancel-button:hover { background: var(--glass-bg-hover); }
.delete-button { color:#fff; background:#a93243; border-color: transparent; box-shadow: none; }
.delete-button:hover { background:#b73c4d; }
.button-spinner { display: inline-block; width: 14px; height: 14px; margin-right: 5px; border: 1px solid var(--divider); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .confirm-backdrop { align-items:flex-end; padding:max(8px,var(--safe-area-top)) max(8px,var(--safe-area-right)) max(8px,var(--safe-area-bottom)) max(8px,var(--safe-area-left)); }
  .confirm-sheet { padding-top: 12px; border-radius:20px; }
  .drag-handle { display: block; width: 36px; height: 5px; margin: 0 auto 20px; border-radius:999px; background:var(--divider); }
}
.confirm-backdrop { background:var(--dialog-backdrop,rgb(0 0 0 / .6)); }
.confirm-sheet { max-height:calc(100dvh - var(--safe-area-top) - var(--safe-area-bottom) - 32px); overflow-y:auto; overscroll-behavior:contain; border:1px solid var(--divider); background:var(--surface-elevated,var(--surface-1)); box-shadow:0 24px 80px #0005; animation:sheet-enter .18s ease; }
button { cursor:pointer; } button:disabled { opacity:.5; cursor:default; }
button:focus-visible { outline:2px solid var(--text-primary); outline-offset:-2px; }
.close-button { border:0; color:var(--text-secondary); background:transparent; }
@keyframes sheet-enter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
@media(max-width:640px) { .confirm-sheet { padding:16px 20px 20px; } }
@media(prefers-reduced-motion:reduce) { .confirm-sheet { animation:none; } button { transition:none; } .button-spinner { animation:none; } }
</style>
