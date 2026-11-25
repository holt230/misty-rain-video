<script setup lang="ts">
import { ref } from 'vue';
import { Clock3, Search } from '@lucide/vue';
import BrandMark from '../common/BrandMark.vue';
import type { MobileTab } from './MobileTabBar.vue';
defineProps<{ activePage: MobileTab; disabled?: boolean }>();
const emit = defineEmits<{ (event: 'home'): void; (event: 'search'): void; (event: 'submit', keyword: string): void; (event: 'history'): void }>();
const query = ref('');
const titles = { home: '首页', search: '找片', library: '片库', account: '我的' };
</script>
<template>
  <header class="cinema-header" :data-page="activePage">
    <button type="button" class="cinema-brand" aria-label="烟雨影视首页" @click="emit('home')"><BrandMark /><span>烟雨影视</span></button>
    <span class="desktop-page-title">{{ titles[activePage] }}</span>
    <button v-if="activePage !== 'search'" type="button" class="header-search" aria-label="搜索影片" :disabled="disabled" @click="emit('search')"><Search aria-hidden="true" /><span>搜索片名</span></button>
    <form v-if="activePage !== 'search'" class="desktop-search cinema-search-field" role="search" aria-label="全站找片" @submit.prevent="query.trim() && !disabled && emit('submit', query.trim())">
      <Search aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索影片" placeholder="搜索片名或粘贴分享链接" :disabled="disabled" @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.preventDefault()" />
      <button type="submit" :disabled="disabled || !query.trim()">搜索</button>
    </form>
    <button type="button" class="header-history" :class="{ 'history-alone': activePage === 'search' }" aria-label="观看历史" @click="emit('history')"><Clock3 /><span>观看历史</span></button>
  </header>
</template>
<style scoped>
.cinema-header > .history-alone { margin-left: auto; }
</style>
