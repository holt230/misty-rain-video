<script setup lang="ts">
import MediaPoster from './MediaPoster.vue';

defineProps<{ poster?: string; backdrop?: string; label?: string; progress?: number }>();
</script>

<template>
  <span class="cinema-still" :class="{ 'from-poster': !backdrop || backdrop === poster }">
    <MediaPoster :src="backdrop || poster" alt="" loading="lazy" decoding="async" />
    <span v-if="label" class="cinema-still-label" :title="label">{{ label }}</span>
    <span v-if="progress !== undefined && progress > 0" class="cinema-still-progress" aria-hidden="true">
      <i :style="{ width: progress + '%' }"></i>
    </span>
    <slot />
  </span>
</template>

<style scoped>
.cinema-still { position: relative; display: block; flex-shrink: 0; isolation: isolate; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; border-radius: var(--cinema-radius-poster); background: var(--surface-2); }
.cinema-still > img { display: block; width: 100%; height: 100%; object-fit: cover; }
.cinema-still.from-poster > img { object-position: 50% 32%; }
.cinema-still-label { position: absolute; inset: 40% 0 0; display: flex; align-items: end; justify-content: end; padding: 6px 8px; overflow: hidden; background: linear-gradient(transparent, rgb(5 5 4 / .78)); color: #fff7e9; font-size: .69rem; font-weight: 650; line-height: 1.25; text-align: right; overflow-wrap: anywhere; }
.cinema-still-progress { position: absolute; inset: auto 0 0; height: 3px; background: rgb(12 12 10 / .52); }
.cinema-still-progress i { display: block; height: 100%; background: var(--cinema-progress); }
</style>
