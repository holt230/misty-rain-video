<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { ChevronLeft, ChevronRight } from '@lucide/vue';

const props = defineProps<{ title: string; itemCount?: number; moreLabel?: string }>();
const emit = defineEmits<{ (event: 'more'): void }>();
const id = useId();
const viewport = ref<HTMLElement | null>(null);
const canPrevious = ref(false), canNext = ref(false);
let observer: ResizeObserver | undefined;
let frame = 0;
const measure = () => {
  frame = 0;
  const node = viewport.value;
  canPrevious.value = Boolean(node && node.scrollLeft > 2);
  canNext.value = Boolean(node && node.clientWidth > 0 && node.scrollLeft + node.clientWidth < node.scrollWidth - 2);
};
const scheduleMeasure = () => { if (!frame) frame = requestAnimationFrame(measure); };
const move = (direction: number) => {
  const node = viewport.value;
  if (!node) return;
  node.scrollBy({ left: direction * node.clientWidth * .85, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
};
const keyboard = (event: KeyboardEvent) => {
  if (event.target !== viewport.value || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
  event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
};
watch(() => props.itemCount, () => { void nextTick(scheduleMeasure); });
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(scheduleMeasure); if (viewport.value) observer.observe(viewport.value); }
  window.addEventListener('resize', scheduleMeasure, { passive: true }); scheduleMeasure();
});
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', scheduleMeasure); });
</script>

<template>
  <section class="media-rail" :aria-labelledby="`${id}-title`">
    <header class="rail-heading">
      <button v-if="moreLabel" class="rail-title-button" type="button" :aria-label="moreLabel" @click="emit('more')"><h2 :id="`${id}-title`">{{ title }}</h2><ChevronRight aria-hidden="true" /></button>
      <h2 v-else :id="`${id}-title`">{{ title }}</h2>
      <slot name="status" />
      <div class="rail-controls" :aria-label="`${title}浏览`" role="group">
        <button type="button" :aria-label="`向前浏览${title}`" :aria-controls="id" :disabled="!canPrevious" @click="move(-1)"><ChevronLeft aria-hidden="true" /></button>
        <button type="button" :aria-label="`向后浏览${title}`" :aria-controls="id" :disabled="!canNext" @click="move(1)"><ChevronRight aria-hidden="true" /></button>
      </div>
    </header>
    <div :id="id" ref="viewport" class="rail-track" tabindex="0" :aria-label="title" @scroll.passive="scheduleMeasure" @keydown="keyboard"><slot /><button v-if="moreLabel" type="button" class="rail-more-tile" :aria-label="moreLabel" @click="emit('more')"><span class="rail-more-cover"><ChevronRight aria-hidden="true"/><strong>{{moreLabel.replace(/^查看更多/,'全部')}}</strong></span></button></div>
  </section>
</template>

<style scoped>
.media-rail { min-width:0; --rail-item-width:clamp(160px,14.4vw,224px); }
.rail-heading { display:flex; min-height:44px; align-items:center; gap:12px; margin-bottom:10px; }
.rail-heading h2 { margin:0; font-size:1.25rem; font-weight:650; letter-spacing:-.025em; }
.rail-title-button { display:flex; min-height:44px; align-items:center; gap:7px; padding:0; border:0; color:var(--text-primary); background:none; }
.rail-title-button > svg { width:17px; height:17px; color:var(--text-tertiary); transition:transform .18s ease; }
.rail-title-button:hover > svg { transform:translateX(3px); }
.rail-controls { display:flex; gap:4px; margin-left:auto; }
.rail-controls button { display:grid; width:44px; height:44px; place-items:center; border:0; border-radius:50%; color:var(--text-primary); background:none; transition:background .16s ease,opacity .16s ease; }
.rail-controls button:hover:not(:disabled) { background:var(--glass-bg-active); }
.rail-controls button:disabled { cursor:default; opacity:.22; }
.rail-controls svg { width:20px; height:20px; }
.rail-track { display:flex; gap:20px; overflow-x:auto; overscroll-behavior-x:contain; scroll-snap-type:x proximity; scrollbar-width:none; padding:7px 3px 12px; margin:-7px -3px -12px; }
.rail-track::-webkit-scrollbar { display:none; }
.rail-track > :slotted(*) { flex:0 0 var(--rail-item-width); min-width:0; scroll-snap-align:start; }
.rail-track:focus-visible { outline:2px solid var(--liquid-accent); outline-offset:5px; border-radius:12px; }
@media (max-width:640px) { .media-rail { --rail-item-width:calc((100vw - 2 * var(--content-gutter,16px) - 24px)/3); } .rail-track { gap:12px; } .rail-heading { margin-bottom:6px; } .rail-heading h2 { font-size:1.08rem; } }
@media (hover:none) and (pointer:coarse) { .rail-controls { display:none; } }
@media (prefers-reduced-motion:reduce) { .rail-controls button,.rail-title-button > svg { transition:none; } .rail-title-button:hover > svg { transform:none; } }
.rail-more-tile{flex:0 0 var(--rail-item-width);align-self:flex-start;width:var(--rail-item-width);padding:0;border:0;scroll-snap-align:start;color:var(--text-primary);background:none;cursor:pointer}.rail-more-cover{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;width:100%;aspect-ratio:2/3;border:1px solid var(--divider);border-radius:8px;background:var(--surface-2)}.rail-more-cover svg{width:28px;height:28px;stroke-width:1.5}.rail-more-cover strong{font-size:.85rem;font-weight:550}.rail-more-tile:hover .rail-more-cover{background:var(--glass-bg-active)}</style>
