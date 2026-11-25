<script setup lang="ts">
import { computed } from 'vue';
import { episodeRangeLabel } from '../../services/resourceCompleteness';
import { Ellipsis, Play } from '@lucide/vue';
import CinemaStill from '../common/CinemaStill.vue';
import { cinemaWatchProgress } from '../../services/cinemaPresentation';
import type { MediaItem, PlaybackHistoryEntry } from '../../types/media';

const props = defineProps<{ media: MediaItem; backdrop?: string; resume?: PlaybackHistoryEntry }>();
const availability = computed(() => {
  const { category, localEpisodeNumbers, localEpisodeCount } = props.media;
  if (category === 'movie' || category === 'variety') return categoryLabels[category];
  if (localEpisodeNumbers?.length) return '可看' + episodeRangeLabel(localEpisodeNumbers);
  if (localEpisodeCount && localEpisodeCount > 0) return `已保存 ${localEpisodeCount} 个视频`;
  return '查看选集';
});
const qualityLabel = computed(() => {
  const value = `${props.media.tag || ''} ${props.media.quarkQuality || ''}`;
  return value.match(/(?:4K|8K|2160P|1080P|720P|HDR|杜比)/i)?.[0].toUpperCase() || '';
});

const availabilityBadge = computed(() => {
  const { category, localEpisodeCount, localEpisodeNumbers } = props.media;
  if (category === 'movie') return (localEpisodeCount || localEpisodeNumbers?.length || 0) > 0 ? '正片' : '';
  const count = localEpisodeNumbers?.length || localEpisodeCount || 0;
  return count > 0 ? '可看 ' + count + (category === 'variety' ? ' 期' : ' 集') : '';
});
const resumeLabel = computed(() => {
  const number = props.resume?.episodeNumber || 0;
  if (!number || props.media.category === 'movie') return '继续观看';
  return '续看第 ' + number + (props.media.category === 'variety' ? ' 期' : ' 集');
});
const emit = defineEmits<{
  (e: 'click-card', media: MediaItem): void;
  (e: 'open-actions', media: MediaItem): void;
}>();

const categoryLabels: Record<MediaItem['category'], string> = {
  tv: '电视剧',
  movie: '电影',
  variety: '综艺',
  anime: '动漫'
};
</script>

<template>
  <article class="media-card">
    <button
      type="button"
      class="card-play-target"
      :aria-label="`播放《${media.title}》，${availability}${resume ? '，' + resumeLabel : ''}`"
      @click="emit('click-card', media)"
    >
      <CinemaStill :poster="media.poster" :backdrop="backdrop" :label="availabilityBadge" :progress="cinemaWatchProgress(resume)">
        <span v-if="qualityLabel" class="quality-tag">{{ qualityLabel }}</span>
      </CinemaStill>
      <span class="card-caption">
        <span class="media-title" :title="media.title">{{ media.title }}</span>
        <span v-if="resume" class="resume-label"><Play fill="currentColor" aria-hidden="true" />{{ resumeLabel }}</span>
        <span v-else class="media-subtitle" :title="availability">{{ availabilityBadge ? '播放' : availability }}</span>
      </span>
    </button>
    <button type="button" class="more-trigger" :aria-label="`打开《${media.title}》的更多操作`" @click="emit('open-actions', media)">
      <Ellipsis aria-hidden="true" />
    </button>
  </article>
</template>

<style scoped>
.media-card { position: relative; min-width: 0; }
.card-play-target { display: grid; align-content: start; gap: 6px; width: 100%; height: 100%; min-width: 0; border: 0; border-radius: var(--cinema-radius-poster); color: var(--text-primary); background: transparent; text-align: left; }
.quality-tag { position: absolute; top: 6px; left: 7px; z-index: 1; max-width: calc(100% - 14px); overflow: hidden; padding: 2px 5px; border-radius: 4px; color: #fff; background: rgb(0 0 0 / .65); font-size: .65rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.card-caption { display: grid; align-content: start; gap: 4px; min-height: 44px; min-width: 0; width: 100%; padding-right: 44px; }
.media-title { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; font-size: .88rem; line-height: 1.35; font-weight: 650; }
.media-subtitle, .resume-label { color: var(--text-secondary); font-size: .72rem; line-height: 1.35; overflow-wrap: anywhere; }
.resume-label { display: flex; align-items: center; gap: 4px; color: var(--liquid-accent); font-weight: 600; }
.resume-label svg { width: 12px; height: 12px; flex-shrink: 0; }
.more-trigger { position: absolute; bottom: 0; right: 0; display: grid; width: 44px; height: 44px; place-items: center; border: 0; border-radius: 50%; color: var(--text-tertiary); background: transparent; }
.more-trigger svg { width: 18px; height: 18px; }
@media (hover: hover) and (pointer: fine) {
  .card-play-target:hover .media-title { color: var(--liquid-accent); }
  .more-trigger:hover { color: var(--text-primary); background: var(--glass-bg-hover); }
}
</style>
