<script setup lang="ts">
import { ref } from 'vue';
import { Clock3, Search } from '@lucide/vue';
import BrandMark from '../common/BrandMark.vue';
import type { MobileTab } from './MobileTabBar.vue';
defineProps<{ activePage: MobileTab; disabled?: boolean }>();
const emit = defineEmits<{ (event: 'home'): void; (event: 'search'): void; (event: 'submit', keyword: string): void; (event: 'history'): void }>();
const query = ref('');
const titles = { home: '发现好故事', search: '找一部喜欢的影片', library: '我的片库', account: '个人中心' };
</script>
<template>
  <header class="cinema-header">
    <button type="button" class="cinema-brand" @click="emit('home')"><BrandMark /><span>烟雨影视</span></button>
    <span class="desktop-page-title">{{ titles[activePage] }}</span>
    <button type="button" class="header-search" :disabled="disabled" @click="emit('search')"><Search /><span>找一部喜欢的影片</span></button>
    <form class="desktop-search cinema-search-field" role="search" aria-label="全站找片" @submit.prevent="query.trim() && !disabled && emit('submit', query.trim())">
      <Search aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索影片" placeholder="搜索片名或粘贴分享链接" :disabled="disabled" @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.preventDefault()" />
      <button type="submit" :disabled="disabled || !query.trim()">搜索</button>
    </form>
    <button type="button" class="header-history" aria-label="观看历史" @click="emit('history')"><Clock3 /><span>观看历史</span></button>
  </header>
</template>
