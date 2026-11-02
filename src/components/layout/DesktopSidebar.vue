<script setup lang="ts">
import { Compass, Home, LibraryBig, UserRound } from '@lucide/vue';
import BrandMark from '../common/BrandMark.vue';
import ThemeSwitch from '../common/ThemeSwitch.vue';
import UserAvatar from '../common/UserAvatar.vue';
import type { AppUser } from '../../services/authService';
import type { MobileTab } from './MobileTabBar.vue';
defineProps<{ activePage: MobileTab; user: AppUser; disabled?: boolean }>();
defineEmits<{ (event: 'navigate', tab: MobileTab): void }>();
const tabs = [{ id: 'home' as const, label: '精选首页', icon: Home }, { id: 'search' as const, label: '发现好片', icon: Compass }, { id: 'library' as const, label: '我的片库', icon: LibraryBig }, { id: 'account' as const, label: '个人中心', icon: UserRound }];
</script>
<template><aside class="cinema-sidebar"><button class="cinema-brand" type="button" @click="$emit('navigate', 'home')"><BrandMark /><span>烟雨影视<small>MISTY RAIN</small></span></button><p>让好故事，陪伴每一天</p><nav aria-label="主要导航"><button v-for="tab in tabs" :key="tab.id" type="button" :disabled="disabled" :class="{ active: activePage === tab.id }" :aria-current="activePage === tab.id ? 'page' : undefined" @click="$emit('navigate', tab.id)"><component :is="tab.icon" />{{ tab.label }}</button></nav><div class="sidebar-foot"><ThemeSwitch /><button type="button" class="sidebar-profile" @click="$emit('navigate', 'account')"><UserAvatar :username="user.username" /><span>{{ user.username }}<small>我的观影时光</small></span></button></div></aside></template>
