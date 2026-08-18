<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { ChevronRight, Download, ListFilter, RefreshCw, Trash2, X } from '@lucide/vue';
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

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open) emit('cancel');
};

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && media"
      class="action-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-action-title"
      @click.self="emit('cancel')"
    >
      <section class="action-sheet">
        <div class="drag-handle" aria-hidden="true"></div>

        <header class="media-summary">
          <img :src="media.poster" :alt="media.title" class="summary-poster" />
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
.action-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(3, 6, 13, 0.76);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.action-sheet {
  width: min(440px, 100%);
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 24px;
  color: #fff;
  background: rgba(18, 23, 36, 0.88);
  backdrop-filter: blur(38px) saturate(185%);
  -webkit-backdrop-filter: blur(38px) saturate(185%);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.58), inset 0 1px 1px rgba(255, 255, 255, 0.18);
}

.drag-handle { display: none; }

.media-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.summary-poster {
  flex: 0 0 auto;
  width: 48px;
  height: 64px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.summary-copy { min-width: 0; flex: 1; }
.summary-copy span { color: var(--text-tertiary); font-size: 0.76rem; }
.summary-copy h2 {
  margin: 4px 0 0;
  overflow: hidden;
  color: #fff;
  font-size: 1.05rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-button {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
}
.close-button svg { width: 19px; fill: none; stroke: currentColor; stroke-width: 2; }

.action-list {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.035);
}

.action-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 68px;
  padding: 10px 13px;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: #fff;
  text-align: left;
  background: transparent;
  cursor: pointer;
  touch-action: manipulation;
}
.action-item:last-child { border-bottom: 0; }
.action-item:hover { background: rgba(255, 255, 255, 0.06); }

.action-icon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: var(--liquid-accent);
  background: var(--liquid-accent-subtle);
}
.action-icon svg,
.chevron { fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.action-icon svg { width: 21px; }
.chevron { flex: 0 0 auto; width: 18px; color: var(--text-tertiary); }

.action-copy { display: grid; flex: 1; min-width: 0; gap: 3px; }
.action-copy strong { font-size: 0.94rem; font-weight: 650; }
.action-copy small { color: var(--text-tertiary); font-size: 0.75rem; }
.action-item.danger .action-icon { color: #ff8c82; background: rgba(239, 68, 68, 0.12); }
.action-item.update .action-icon { color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.action-item.danger strong { color: #ff9a91; }

.cancel-button {
  width: 100%;
  min-height: 50px;
  margin-top: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  color: #fff;
  font-size: 0.94rem;
  font-weight: 650;
  background: rgba(255, 255, 255, 0.07);
  cursor: pointer;
  touch-action: manipulation;
}

@media (max-width: 640px) {
  .action-backdrop { align-items: flex-end; padding: 0; }
  .action-sheet {
    width: 100%;
    padding: 10px calc(14px + var(--safe-area-right)) calc(14px + var(--safe-area-bottom)) calc(14px + var(--safe-area-left));
    border-radius: 24px 24px 0 0;
    animation: sheet-in 0.24s ease-out;
  }
  .drag-handle {
    display: block;
    width: 40px;
    height: 5px;
    margin: 0 auto 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.24);
  }
  .media-summary { margin-bottom: 12px; }
  .close-button { display: none; }
  .action-item { min-height: 64px; }
  .cancel-button { min-height: 52px; }
}

@media (max-width: 640px) {
  .action-sheet { padding-top: 8px; }
  .drag-handle { margin-bottom: 10px; }
  .media-summary { margin-bottom: 10px; }
  .summary-poster { width: 44px; height: 60px; }
  .action-list { border-radius: 15px; }
  .action-item { min-height: 60px; padding: 8px 10px; }
  .action-icon { width: 36px; height: 36px; border-radius: 11px; }
  .cancel-button { min-height: 48px; margin-top: 10px; border-radius: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .action-sheet { animation: none !important; }
}

@keyframes sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>
