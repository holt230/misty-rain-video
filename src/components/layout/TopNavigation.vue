<script setup lang="ts">
import { Clock3, Search } from '@lucide/vue';
import BrandMark from '../common/BrandMark.vue';
defineEmits<{ (event: 'home'): void; (event: 'search'): void; (event: 'history'): void }>();
</script>
<template><header class="cinema-header"><button type="button" class="cinema-brand" @click="$emit('home')"><BrandMark /><span>烟雨影视</span></button><button type="button" class="header-search" @click="$emit('search')"><Search /><span>找一部喜欢的影片</span></button><button type="button" class="icon-control" aria-label="观看历史" @click="$emit('history')"><Clock3 /></button></header></template>
