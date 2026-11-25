<script setup lang="ts">
import { Home, LibraryBig, Search, UserRound } from '@lucide/vue';
import BrandMark from '../common/BrandMark.vue';
import UserAvatar from '../common/UserAvatar.vue';
import type { AppUser } from '../../services/authService';
import type { MobileTab } from './MobileTabBar.vue';
defineProps<{ activePage: MobileTab; user: AppUser; disabled?: boolean }>();
defineEmits<{ (event: 'navigate', tab: MobileTab): void }>();
const tabs = [{ id: 'home' as const, label: '首页', icon: Home }, { id: 'search' as const, label: '找片', icon: Search }, { id: 'library' as const, label: '片库', icon: LibraryBig }, { id: 'account' as const, label: '我的', icon: UserRound }];
</script>
<template>
  <aside class="cinema-sidebar">
    <button class="cinema-brand" type="button" @click="$emit('navigate', 'home')"><BrandMark /><span>烟雨影视</span></button>
    <nav aria-label="主要导航">
      <button v-for="tab in tabs" :key="tab.id" type="button" :disabled="disabled" :class="{ active: activePage === tab.id }" :aria-current="activePage === tab.id ? 'page' : undefined" @click="$emit('navigate', tab.id)"><component :is="tab.icon" />{{ tab.label }}</button>
    </nav>
    <div class="sidebar-foot"><button type="button" class="sidebar-profile" aria-label="打开我的" @click="$emit('navigate', 'account')"><UserAvatar :username="user.username" /><span>{{ user.username }}</span></button></div>
  </aside>
</template>
