<script setup lang="ts">
import { Play } from '@lucide/vue';
import type { PlaybackHistoryEntry } from '../../types/media';

defineProps<{ entries: PlaybackHistoryEntry[] }>();

const emit = defineEmits<{
  (e: 'play', entry: PlaybackHistoryEntry): void;
}>();

const progress = (entry: PlaybackHistoryEntry) => entry.duration > 0
  ? Math.max(2, Math.min(100, entry.position / entry.duration * 100))
  : 0;

const episodeLabel = (entry: PlaybackHistoryEntry) => entry.episodeNumber > 0
  ? `第 ${entry.episodeNumber} 集`
  : entry.episodeTitle || '继续播放';
</script>

<template>
  <section v-if="entries.length" class="continue-section" aria-labelledby="continue-title">
    <div class="continue-heading">
      <h2 id="continue-title">继续观看</h2>
      <span>跨设备同步</span>
    </div>
    <div class="continue-scroll">
      <button
        v-for="entry in entries"
        :key="entry.id"
        type="button"
        class="continue-card"
        @click="emit('play', entry)"
      >
        <img :src="entry.media.poster" :alt="`${entry.media.title}封面`" />
        <span class="continue-shade" aria-hidden="true"></span>
        <span class="continue-copy">
          <strong>{{ entry.media.title }}</strong>
          <small>{{ episodeLabel(entry) }}</small>
        </span>
        <span class="continue-play" aria-hidden="true">
          <Play fill="currentColor" />
        </span>
        <span class="continue-progress" aria-hidden="true">
          <i :style="{ width: `${progress(entry)}%` }"></i>
        </span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.continue-section { margin-bottom: 26px; }
.continue-heading { display: flex; align-items: baseline; gap: 9px; margin-bottom: 11px; }
.continue-heading h2 { font-size: 1.18rem; font-weight: 720; letter-spacing: -0.035em; }
.continue-heading span { color: var(--text-tertiary); font-size: 0.72rem; }
.continue-scroll { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(210px, 25%); gap: 12px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x proximity; scrollbar-width: none; }
.continue-scroll::-webkit-scrollbar { display: none; }
.continue-card { position: relative; aspect-ratio: 16 / 9; overflow: hidden; border: 0; border-radius: 14px; color: #fff; background: var(--surface-2); box-shadow: 0 10px 26px rgba(0,0,0,.24); cursor: pointer; scroll-snap-align: start; text-align: left; }
.continue-card img { width: 100%; height: 100%; object-fit: cover; }
.continue-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.03) 28%, rgba(0,0,0,.85) 100%); }
.continue-copy { position: absolute; right: 42px; bottom: 13px; left: 12px; display: grid; }
.continue-copy strong { overflow: hidden; font-size: .88rem; text-overflow: ellipsis; white-space: nowrap; }
.continue-copy small { margin-top: 1px; color: rgba(255,255,255,.64); font-size: .68rem; }
.continue-play { position: absolute; right: 11px; bottom: 15px; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,.92); color: #111216; }
.continue-play svg { width: 17px; fill: currentColor; }
.continue-progress { position: absolute; right: 8px; bottom: 6px; left: 8px; height: 3px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.2); }
.continue-progress i { display: block; height: 100%; border-radius: inherit; background: var(--liquid-accent); }

@media (max-width: 640px) {
  .continue-section { margin-bottom: 24px; }
  .continue-heading { margin-bottom: 9px; }
  .continue-heading h2 { font-size: 1.08rem; }
  .continue-scroll { grid-auto-columns: 73%; gap: 11px; margin-right: calc(-1 * (var(--mobile-gutter) + var(--safe-area-right))); padding-right: calc(var(--mobile-gutter) + var(--safe-area-right)); }
  .continue-card { border-radius: 13px; }
}
</style>
