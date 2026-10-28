<script setup lang="ts">
import { Play } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import MediaRail from './MediaRail.vue';
import type { PlaybackHistoryEntry } from '../../types/media';

defineProps<{ entries: PlaybackHistoryEntry[] }>();
const emit = defineEmits<{ (e: 'play', entry: PlaybackHistoryEntry): void }>();
const progress = (entry: PlaybackHistoryEntry) => entry.duration > 0 ? Math.max(0, Math.min(100, entry.position / entry.duration * 100)) : 0;
const episodeLabel = (entry: PlaybackHistoryEntry) => entry.media.category !== 'movie' && entry.episodeNumber > 0
  ? `第 ${entry.episodeNumber} 集` : entry.media.category !== 'movie' ? entry.episodeTitle : '';
const timeLabel = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
</script>

<template>
  <MediaRail v-if="entries.length" title="继续观看" :item-count="entries.length" class="continue-section">
    <button v-for="entry in entries" :key="entry.id" type="button" class="continue-card"
      :aria-label="`${entry.completed ? '重新播放' : '继续观看'}《${entry.media.title}》${episodeLabel(entry) ? `，${episodeLabel(entry)}` : ''}，已观看 ${timeLabel(entry.position)}`"
      @click="emit('play', entry)">
      <span class="continue-art"><MediaPoster :src="entry.media.poster" :catalog-id="entry.media.catalogId" alt="" class="continue-poster" /><span class="continue-play" aria-hidden="true"><Play fill="currentColor" /></span><span v-if="entry.duration > 0" class="continue-progress" aria-hidden="true"><i :style="{ width: `${progress(entry)}%` }"></i></span></span>
      <span class="continue-copy">
        <strong :title="entry.media.title">{{ entry.media.title }}</strong>
        <small v-if="episodeLabel(entry)">{{ episodeLabel(entry) }}</small>
        <small class="continue-time">{{ timeLabel(entry.position) }}<template v-if="entry.duration > 0"> / {{ timeLabel(entry.duration) }}</template></small>
      </span>
    </button>
  </MediaRail>
</template>

<style scoped>
.continue-section { margin:0 0 44px; }
.continue-card { display:flex; flex-direction:column; gap:12px; min-width:0; padding:0; border:0; border-radius:8px; color:var(--text-primary); background:none; text-align:left; }
.continue-art { position:relative; display:block; width:100%; aspect-ratio:2/3; overflow:hidden; border-radius:8px; isolation:isolate; background:#16171a; outline:2px solid transparent; outline-offset:3px; transition:transform .22s var(--spring-ease),outline-color .2s ease; }
.continue-atmosphere { position:absolute; inset:-15%; width:130%; height:130%; object-fit:cover; filter:blur(22px); opacity:.45; z-index:-1; }
.continue-poster { display:block; height:100%; width:100%; aspect-ratio:2/3; object-fit:cover; }
.continue-copy { display:grid; grid-template-columns:minmax(0,1fr); width:100%; gap:4px 12px; }
.continue-copy strong { grid-column:1; overflow:hidden; font-size:.9rem; font-weight:600; text-overflow:ellipsis; white-space:nowrap; line-height:1.4; }
.continue-copy small { grid-column:1; overflow:hidden; color:var(--text-tertiary); font-size:.72rem; text-overflow:ellipsis; white-space:nowrap; }
.continue-copy .continue-time { grid-column:1; grid-row:auto; align-self:center; font-size:.67rem; font-variant-numeric:tabular-nums; }
.continue-progress { position:absolute; bottom:0; left:0; right:0; height:3px; overflow:hidden; background:#ffffff35; }
.continue-progress i { display:block; height:100%; background:#fff; }
.continue-play { position:absolute; bottom:12px; right:10px; display:grid; width:32px; height:32px; place-items:center; border-radius:50%; color:#111; background:#fff; box-shadow:0 2px 24px #0003; transition:transform .2s ease; }
.continue-play svg { width:15px; height:15px; margin-left:2px; }
.continue-card:focus-visible { outline:none; }
.continue-card:focus-visible .continue-art { outline-color:var(--text-primary); }
@media(hover:hover) and (pointer:fine) { .continue-card:hover .continue-art { transform:translateY(-3px); outline-color:var(--text-primary); } .continue-card:hover .continue-play { transform:scale(1.07); } }
@media(max-width:640px) { .continue-section { margin-bottom:30px; } .continue-copy strong { font-size:.82rem; } }
@media(prefers-reduced-motion:reduce) { .continue-art,.continue-play { transition:none; } .continue-card:hover .continue-art,.continue-card:hover .continue-play { transform:none; } }
</style>
