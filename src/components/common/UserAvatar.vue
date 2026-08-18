<script setup lang="ts">
import { computed, useId } from 'vue';

const props = defineProps<{ username: string }>();
const uid = useId().replace(/:/g, '');
const gradientId = `avatar-gradient-${uid}`;
const glowId = `avatar-glow-${uid}`;

const palettes = [
  ['#ff9a72', '#e84f62', '#6027a8'],
  ['#65d6ff', '#5269e8', '#7b38bf'],
  ['#5be0b7', '#167f9e', '#3432a6'],
  ['#ffc45c', '#f36b4b', '#9e327c'],
  ['#a6ef67', '#29a57a', '#2253a7']
];

const hash = computed(() => [...props.username].reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 2166136261));
const palette = computed(() => palettes[hash.value % palettes.length]);
const rotation = computed(() => `${(hash.value % 36) - 18}deg`);
</script>

<template>
  <span class="generated-avatar" :style="{ '--avatar-rotation': rotation }" role="img" :aria-label="`${username} 的头像`">
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient :id="gradientId" x1="8" y1="5" x2="57" y2="60" gradientUnits="userSpaceOnUse">
          <stop :stop-color="palette[0]" />
          <stop offset="0.54" :stop-color="palette[1]" />
          <stop offset="1" :stop-color="palette[2]" />
        </linearGradient>
        <radialGradient :id="glowId" cx="0" cy="0" r="1" gradientTransform="translate(20 14) rotate(48) scale(49)">
          <stop stop-color="#fff" stop-opacity=".72" />
          <stop offset=".42" stop-color="#fff" stop-opacity=".12" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="32" :fill="`url(#${gradientId})`" />
      <rect width="64" height="64" rx="32" :fill="`url(#${glowId})`" />
      <g class="avatar-orbit">
        <path d="M-4 39C10 25 22 23 36 31c11 6 19 5 32-2v35H-4Z" fill="#090b16" fill-opacity=".33" />
        <path d="M-2 47c14-11 29-12 44-3 9 5 17 5 25 0" fill="none" stroke="#fff" stroke-opacity=".42" stroke-width="2.4" stroke-linecap="round" />
        <circle cx="43" cy="21" r="8" fill="#fff" fill-opacity=".86" />
        <circle cx="46.5" cy="18.5" r="8" :fill="palette[1]" fill-opacity=".94" />
      </g>
      <circle cx="20" cy="18" r="1.4" fill="#fff" fill-opacity=".75" />
      <circle cx="52" cy="39" r="1" fill="#fff" fill-opacity=".55" />
    </svg>
  </span>
</template>

<style scoped>
.generated-avatar {
  position: relative;
  isolation: isolate;
  display: inline-grid;
  flex: 0 0 auto;
  overflow: hidden;
  place-items: center;
  border-radius: 50%;
  background: #181a22;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.18), 0 8px 20px rgba(0,0,0,.24);
}
.generated-avatar::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 1px rgba(255,255,255,.32); pointer-events: none; }
svg { width: 100%; height: 100%; display: block; }
.avatar-orbit { transform-origin: 32px 32px; transform: rotate(var(--avatar-rotation)); }
</style>
