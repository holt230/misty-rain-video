<script setup lang="ts">
import { computed, watch } from 'vue';
import type Hls from 'hls.js';
import { Check, RotateCw } from '@lucide/vue';
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import { useSubtitleSelection } from '../../composables/useSubtitleSelection';
import { subtitleChoiceLabel } from '../../services/subtitleTracks';
const props = defineProps<{ video: HTMLVideoElement; hls?: Hls | null; notice?: string; username?: string; nativeFullscreen?: boolean; loading?: boolean; readError?: string; contextKey?: string }>();
const emit = defineEmits<{ (event: 'retry-embedded'): void; (event: 'summary', value: string): void }>();
const { preference, choices, activeKey, summary, unavailable, error, choose, retry } = useSubtitleSelection(props);
const issue = computed(() => props.readError || error.value || props.notice);
const retrySubtitle = () => { if (props.readError) emit('retry-embedded'); else retry(); };
watch(summary, value => emit('summary', value), { immediate: true });
</script>
<template>
  <div class="subtitle-controls">
    <div class="subtitle-modes" role="group" aria-label="字幕模式">
      <button type="button" :aria-pressed="preference === 'auto'" @click="choose('auto')">自动</button>
      <button type="button" :aria-pressed="preference === 'off'" @click="choose('off')">关闭</button>
    </div>
    <p class="subtitle-hint" role="status">
      <template v-if="preference === 'off'">已关闭字幕</template>
      <template v-else-if="unavailable && choices.length">本集暂无{{ subtitleChoiceLabel(preference) }}，暂用{{ subtitleChoiceLabel(activeKey) }}</template>
      <template v-else-if="preference === 'auto'">{{ activeKey ? `优先中文 · 当前${subtitleChoiceLabel(activeKey)}` : '优先使用中文字幕' }}</template>
      <template v-else>后续剧集沿用{{ subtitleChoiceLabel(preference) }}</template>
    </p>
    <div v-if="choices.length" class="subtitle-languages" role="group" aria-label="字幕语言">
      <span class="subtitle-section-label">选择语言</span>
      <button v-for="choice in choices" :key="choice.key" type="button" :aria-pressed="preference === choice.key" @click="choose(choice.key)">
        <span>{{ choice.label }}</span><Check v-if="preference === choice.key" aria-hidden="true" />
      </button>
    </div>
    <LoadingSkeleton v-else-if="loading" variant="form" :count="2" label="正在读取字幕" />
    <p v-else-if="!issue" class="subtitle-empty" role="status">本集暂无可选字幕</p>
    <div v-if="issue && preference !== 'off'" class="subtitle-status" role="status">
      <span>{{ issue }}</span>
      <button v-if="readError || error" type="button" :disabled="loading" @click="retrySubtitle"><RotateCw aria-hidden="true" />{{ loading ? '重试中' : '重试' }}</button>
    </div>
  </div>
</template>
<style scoped>
.subtitle-controls { padding:12px; color:var(--text-primary); }
.subtitle-modes { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.subtitle-controls button { min-height:44px; padding:0 12px; border:1px solid transparent; border-radius:6px; background:transparent; color:var(--text-secondary); font:inherit; font-size:14px; cursor:pointer; }
.subtitle-modes button { background:var(--surface-2); }
.subtitle-controls button:hover { background:var(--glass-bg-hover,var(--surface-2)); }
.subtitle-controls button[aria-pressed=true] { background:var(--liquid-accent); color:var(--accent-ink); }
.subtitle-controls button:focus-visible { outline:2px solid var(--liquid-accent); outline-offset:2px; }
.subtitle-controls button:disabled { opacity:.5; cursor:default; }
.subtitle-hint,.subtitle-empty { margin:10px 4px 16px; color:var(--text-tertiary); font-size:12px; line-height:1.6; }
.subtitle-languages { display:grid; gap:4px; }
.subtitle-section-label { margin:4px 4px 6px; font-size:12px; color:var(--text-tertiary); }
.subtitle-languages button { display:flex; align-items:center; justify-content:space-between; text-align:left; }
.subtitle-languages svg { width:16px; height:16px; }
.subtitle-status { display:flex; align-items:center; gap:8px; margin:12px 4px 0; padding-top:12px; border-top:1px solid var(--divider); font-size:12px; line-height:1.6; color:var(--text-tertiary); }
.subtitle-status span { flex:1; min-width:0; }
.subtitle-status button { display:flex; align-items:center; justify-content:center; gap:4px; flex:none; padding:0 8px; }
.subtitle-status svg { width:14px; height:14px; }
</style>
