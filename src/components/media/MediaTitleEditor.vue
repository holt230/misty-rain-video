<script setup lang="ts">
import { ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { useDialog } from '../../composables/useDialog';
import type { MediaItem } from '../../types/media';

const props = defineProps<{ open: boolean; media: MediaItem | null; saving: boolean; error: string }>();
const emit = defineEmits<{ (e: 'cancel'): void; (e: 'save', title: string): void }>();
const title = ref('');
const dialogRef = ref<HTMLElement | null>(null);
watch(() => props.open, open => { if (open) title.value = props.media?.title || ''; });
useDialog(dialogRef, () => props.open, () => { if (!props.saving) emit('cancel'); });
</script>

<template>
  <Teleport to="body">
    <div v-if="open && media" ref="dialogRef" class="title-backdrop" role="dialog" aria-modal="true" aria-labelledby="title-editor-heading" @click.self="!saving && emit('cancel')">
      <form class="title-sheet" @submit.prevent="!saving && title.trim() && emit('save', title.trim())">
        <header><h2 id="title-editor-heading">修改名称</h2><button type="button" aria-label="关闭名称编辑" :disabled="saving" @click="emit('cancel')"><X aria-hidden="true" /></button></header>
        <label class="sr-only" for="media-title-input">影片名称</label>
        <input id="media-title-input" v-model="title" type="text" maxlength="120" autocomplete="off" :disabled="saving" :aria-invalid="!!error" :aria-describedby="error ? 'media-title-error' : undefined" placeholder="输入影片名称" />
        <p v-if="error" id="media-title-error" role="alert">{{ error }}</p>
        <footer><button type="button" :disabled="saving" @click="emit('cancel')">取消</button><button class="save-title" type="submit" :disabled="saving || !title.trim()">{{ saving ? '保存中…' : '保存' }}</button></footer>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.title-backdrop { position: fixed; inset: 0; z-index: 1750; display: flex; align-items: center; justify-content: center; padding: 20px; background:var(--dialog-backdrop,rgb(0 0 0 / .6)); }
.title-sheet { width: min(420px, 100%); max-height: calc(100dvh - 24px); overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 24px; border: 1px solid var(--divider); border-radius: 20px; background:var(--surface-elevated,var(--surface-1)); box-shadow:0 24px 80px #0005; animation:title-enter .18s ease; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; gap: 16px; }
h2 { margin: 0; font-size: 1.08rem; font-weight: 700; letter-spacing: -.02em; }
header button { display: grid; width: 44px; height: 44px; place-items: center; padding: 0; border: 0; border-radius: 50%; color: var(--text-secondary); background: transparent; }
header svg { width: 20px; height: 20px; }
input { width: 100%; height: 48px; padding: 0 14px; border: 1px solid var(--divider); border-radius: 12px; color: var(--text-primary); background: var(--surface-2); font-size: 16px; transition: border-color .15s; }
input:focus { outline: 2px solid var(--liquid-accent); outline-offset: 1px; }
p { margin-top: 10px; color: var(--danger); font-size: .8rem; }
footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
footer button { min-width: 80px; min-height: 44px; padding: 0 18px; border: 1px solid var(--divider); border-radius: 12px; color: var(--text-secondary); background: transparent; font-size: .88rem; font-weight: 600; transition: transform .15s, background .15s; }
footer button:active { transform: scale(.98); }
footer .save-title { color: var(--accent-ink); background: var(--liquid-accent); border-color: transparent; }
button:disabled { opacity: .5; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 640px) {
  .title-backdrop { align-items:flex-end; padding:max(8px,var(--safe-area-top)) max(8px,var(--safe-area-right)) max(8px,var(--safe-area-bottom)) max(8px,var(--safe-area-left)); }
  .title-sheet { padding:20px; border-radius:20px; }
}
@keyframes title-enter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
@media(prefers-reduced-motion:reduce) { .title-sheet { animation:none; } input,footer button { transition:none; } }
</style>
