<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
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

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open && !props.deleting) emit('cancel');
};

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && media"
      class="confirm-backdrop"
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
          <h2 id="delete-title">删除《{{ media.title }}》？</h2>
          <p>
            影片目录将移入云盘回收站，可在回收站内恢复。
            <template v-if="(media.duplicateCount || 1) > 1">
              检测到 {{ media.duplicateCount }} 个同名目录，本次会一并移除，避免重复卡片再次出现。
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
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1800;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(3, 6, 13, 0.76);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.confirm-sheet {
  width: min(420px, 100%);
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 24px;
  background: rgba(19, 24, 38, 0.96);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.56), inset 0 1px rgba(255, 255, 255, 0.12);
}

.drag-handle { display: none; }

.danger-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  border-radius: 16px;
  color: #ff8c82;
  background: rgba(239, 68, 68, 0.14);
}

.danger-icon svg {
  width: 25px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.confirm-copy h2 {
  margin: 0 0 10px;
  color: #fff;
  font-size: 1.18rem;
  line-height: 1.35;
}

.confirm-copy p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.65;
}

.confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 24px;
}

.confirm-actions button {
  min-height: 48px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 0.94rem;
  font-weight: 650;
  cursor: pointer;
}

.confirm-actions button:disabled { opacity: 0.62; cursor: wait; }
.cancel-button { background: rgba(255, 255, 255, 0.07); }
.delete-button { background: #d9473f; border-color: #ef6b63 !important; }

.button-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 7px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  border-radius: 50%;
  vertical-align: -2px;
  animation: spin 0.7s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .confirm-backdrop {
    align-items: flex-end;
    padding: 0;
  }

  .confirm-sheet {
    width: 100%;
    padding: 10px 18px calc(18px + env(safe-area-inset-bottom));
    border-radius: 24px 24px 0 0;
    animation: sheet-in 0.25s ease-out;
  }

  .drag-handle {
    display: block;
    width: 42px;
    height: 5px;
    margin: 0 auto 18px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.25);
  }

  .danger-icon { margin-bottom: 12px; }
  .confirm-actions { margin-top: 20px; }
  .confirm-actions button { min-height: 52px; }
}

@keyframes sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>

<style scoped>
@media (max-width: 640px) {
  .confirm-sheet { padding-top: 8px; }
  .drag-handle { margin-bottom: 14px; }
  .danger-icon { width: 44px; height: 44px; border-radius: 14px; }
  .confirm-copy h2 { margin-bottom: 7px; font-size: 1.08rem; }
  .confirm-copy p { font-size: 0.84rem; line-height: 1.55; }
  .confirm-actions { gap: 8px; margin-top: 18px; }
  .confirm-actions button { min-height: 48px; border-radius: 13px; }
}
</style>
