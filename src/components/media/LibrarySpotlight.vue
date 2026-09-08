<script setup lang="ts">
import { Play } from '@lucide/vue';
import type { MediaItem } from '../../types/media';
import MediaPoster from '../common/MediaPoster.vue';

defineProps<{ media: MediaItem; categoryName: string }>();
const emit = defineEmits<{ (event: 'play', media: MediaItem): void }>();
</script>

<template>
  <section class="library-spotlight" aria-labelledby="spotlight-title">
    <div class="spotlight-art" aria-hidden="true">
      <MediaPoster :src="media.poster" alt="" decoding="async" />
    </div>
    <div class="spotlight-copy">
      <span class="spotlight-eyebrow">来自你的片库</span>
      <h2 id="spotlight-title">{{ media.title }}</h2>
      <p>{{ categoryName }}<span aria-hidden="true">·</span>{{ media.quarkQuality || media.tag || '高清' }}</p>
      <button type="button" :aria-label="`开始播放《${media.title}》`" @click="emit('play', media)">
        <Play aria-hidden="true" fill="currentColor" />播放
      </button>
    </div>
  </section>
</template>

<style scoped>
.library-spotlight { position: relative; isolation: isolate; display: flex; align-items: center; min-height: 330px; overflow: hidden; margin-bottom: 36px; border-radius: 16px; background: #18181b; }
.spotlight-art { position: absolute; inset: 0 0 0 34%; z-index: -1; }
.spotlight-art img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center 30%; }
.spotlight-art::after { position: absolute; inset: 0; content: ''; background: linear-gradient(90deg, #18181b 0%, rgb(24 24 27 / .85) 15%, rgb(24 24 27 / .05) 75%), linear-gradient(0deg, rgb(0 0 0 / .18), transparent 65%); }
.spotlight-copy { width: 65%; padding: 40px; }
.spotlight-eyebrow { color: #b8b8bf; font-size: .72rem; letter-spacing: .14em; }
.spotlight-copy h2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 14px 0 12px; color: #fff; font-size: clamp(1.9rem, 4vw, 3rem); font-weight: 650; line-height: 1.22; letter-spacing: -.025em; overflow-wrap: anywhere; text-shadow: 0 2px 18px rgb(0 0 0 / .3); }
.spotlight-copy p { display: flex; flex-wrap: wrap; gap: 9px; color: #ceced3; font-size: .76rem; }
.spotlight-copy button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 116px; min-height: 46px; margin-top: 28px; padding: 0 24px; border: 0; border-radius: 10px; color: #171719; background: #f5f5f7; font-size: .86rem; font-weight: 650; transition: background .2s; }
.spotlight-copy button:hover { background: #dcdce1; }
.spotlight-copy button svg { width: 16px; height: 16px; }
@media (max-width: 640px) {
  .library-spotlight { min-height: 238px; margin-bottom: 26px; border-radius: 12px; }
  .spotlight-art { left: 25%; }
  .spotlight-copy { width: 80%; padding: 24px; }
  .spotlight-copy h2 { margin-top: 12px; font-size: 1.9rem; }
  .spotlight-copy p { font-size: .68rem; }
  .spotlight-copy button { min-width: 100px; margin-top: 22px; padding: 0 20px; }
  .spotlight-eyebrow { font-size: .65rem; }
}
</style>
