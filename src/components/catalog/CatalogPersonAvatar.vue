<script setup lang="ts">
import { ref, watch } from 'vue';
const props = defineProps<{ src: string; name: string }>();
const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });
</script>
<template>
  <span class="person-avatar">
    <img v-if="src && !failed" :src="src" alt="" loading="lazy" decoding="async" @error="failed = true" />
    <span v-else aria-hidden="true">{{ name.slice(0, 1) }}</span>
  </span>
</template>
<style scoped>
.person-avatar { display: grid; place-items: center; flex-shrink: 0; width: 80px; height: 80px; overflow: hidden; border: 1px solid var(--divider); border-radius: 50%; color: var(--liquid-accent); background: var(--surface-2); font-size: 26px; }
img { width: 100%; height: 100%; object-fit: cover; }
</style>
