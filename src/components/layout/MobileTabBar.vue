<script setup lang="ts">
import { Compass, Home, LibraryBig, UserRound } from '@lucide/vue';
export type MobileTab = 'home' | 'search' | 'library' | 'account';
defineProps<{ activeTab: MobileTab; disabled?: boolean }>();
defineEmits<{ (event: 'navigate', tab: MobileTab): void }>();
const tabs = [{ id: 'home' as const, label: '首页', icon: Home }, { id: 'search' as const, label: '找片', icon: Compass }, { id: 'library' as const, label: '片库', icon: LibraryBig }, { id: 'account' as const, label: '我的', icon: UserRound }];
</script>
<template><nav class="cinema-tabbar" aria-label="主要导航"><button v-for="tab in tabs" :key="tab.id" type="button" :disabled="disabled" :aria-current="activeTab === tab.id ? 'page' : undefined" :class="{ active: activeTab === tab.id }" @click="$emit('navigate', tab.id)"><component :is="tab.icon" /><span>{{ tab.label }}</span></button></nav></template>
