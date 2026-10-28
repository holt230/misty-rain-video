<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { File, Folder, Video } from '@lucide/vue';
const props = defineProps<{ src?: string; directory?: boolean; video?: boolean }>();
const element = ref<HTMLElement | null>(null);
const visible = ref(false), failed = ref(false), loaded = ref(false);
let observer: IntersectionObserver | null = null;
const disconnect = () => { observer?.disconnect(); observer = null; };
const observe = () => {
  disconnect(); visible.value = false; failed.value = false; loaded.value = false;
  if (!props.src || !element.value) return;
  // Native lazy images can prefetch thousands of pixels beyond the viewport.
  // Each thumbnail is an authenticated upstream request, so wait for visibility.
  if (typeof window.IntersectionObserver !== 'function') { visible.value = true; return; }
  const current = new window.IntersectionObserver(entries => {
    if (observer !== current || !entries.some(entry => entry.isIntersecting)) return;
    visible.value = true; disconnect();
  }, { rootMargin: '0px', threshold: 0.01 });
  observer = current; current.observe(element.value);
};
onMounted(observe);
watch(() => props.src, observe, { flush: 'post' });
onBeforeUnmount(disconnect);
</script>
<template><span ref="element" class="resource-thumbnail" :class="{'thumbnail-loading':visible && src && !loaded && !failed}"><img v-if="visible && src && !failed" :key="src" :src="src" :class="{ loaded }" alt="" loading="lazy" decoding="async" @load="loaded = true" @error="failed = true; loaded = false" /><component v-if="!loaded" :is="directory ? Folder : video ? Video : File" aria-hidden="true" /></span></template>
<style scoped>
.resource-thumbnail { display: grid; width: 52px; height: 52px; flex: 0 0 52px; overflow: hidden; place-items: center; border-radius:10px; color:var(--text-tertiary); background:var(--surface-2); border:1px solid var(--divider); }
.resource-thumbnail img { grid-area: 1 / 1; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 160ms ease; }
.resource-thumbnail img.loaded { opacity: 1; }
.resource-thumbnail svg { grid-area: 1 / 1; width: 27px; height: 27px; stroke-width: 1.5; }
.thumbnail-loading{background:linear-gradient(100deg,var(--surface-2),var(--surface-3),var(--surface-2));background-size:250% 100%;animation:thumbnail-loading 1.5s ease infinite}@keyframes thumbnail-loading{to{background-position:250% 0}}
@media (prefers-reduced-motion: reduce) { .resource-thumbnail img { transition: none; } .thumbnail-loading{animation:none} }
</style>
