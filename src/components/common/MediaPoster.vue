<script setup lang="ts">
import { ref, watch } from 'vue';
import { apiUrl } from '../../services/appUrl';

const props = defineProps<{ src?: string; alt: string }>();
const failed = ref(false);
const fallback = apiUrl('/poster-placeholder.svg');
watch(() => props.src, () => { failed.value = false; });
</script>

<template>
  <img :src="failed || !src ? fallback : src" :alt="alt" @error="failed = true" />
</template>
