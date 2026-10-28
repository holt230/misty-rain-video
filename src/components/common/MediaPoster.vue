<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { apiUrl } from '../../services/appUrl';

const props = defineProps<{ src?: string; alt: string; catalogId?: string }>();
const candidateIndex = ref(0);
const loaded=ref(false);
const fallback = apiUrl('/poster-placeholder.svg');
const catalogIdentity = computed(() => props.catalogId && /^(?:douban|bangumi)-\d+$/.test(props.catalogId) ? props.catalogId : props.src?.match(/\/api\/discovery\/posters\/((?:douban|bangumi)-\d+)(?:[?#]|$)/)?.[1]);
const candidates = computed(() => [...new Set([
  catalogIdentity.value ? apiUrl(`/api/discovery/posters/${catalogIdentity.value}?v=2`) : '',
  props.src && !props.src.includes('photo-1578836537282-3171d77f8632') ? props.src : '', fallback
].filter(Boolean))]);
const imageUrl = computed(() => candidates.value[Math.min(candidateIndex.value,candidates.value.length-1)]);
const imageFailed=()=>{if(candidateIndex.value<candidates.value.length-1)candidateIndex.value++;else loaded.value=true;};
watch(imageUrl,()=>{loaded.value=false;});
watch(candidates, () => { candidateIndex.value=0; });
</script>

<template>
  <img :class="{'poster-loading':!loaded}" @load="loaded=true" :src="imageUrl" :alt="alt" loading="lazy" decoding="async" @error="imageFailed" />
</template>

<style scoped>.poster-loading{background:linear-gradient(100deg,var(--surface-2) 20%,var(--surface-3) 45%,var(--surface-2) 70%);background-size:240% 100%;animation:poster-loading 1.6s ease-in-out infinite}@keyframes poster-loading{to{background-position:240% 0}}@media(prefers-reduced-motion:reduce){.poster-loading{animation:none}}</style>
