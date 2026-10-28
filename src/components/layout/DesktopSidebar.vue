<script setup lang="ts">
import { siteSettings } from '../../services/siteSettings';
import { Compass, Bookmark, Settings2, History } from '@lucide/vue';
import BrandMark from '../common/BrandMark.vue';
import IconButton from '../common/IconButton.vue';
import type { AppUser } from '../../services/authService';
import type { CategoryType } from '../../types/media';

defineProps<{ activePage: 'discover' | 'library' | 'history' | 'account'; category: CategoryType; counts: Record<CategoryType, number>; user: AppUser; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'library', category?: CategoryType): void; (e: 'account'): void; (e: 'discover'): void; (e: 'history'): void }>();
</script>

<template>
  <aside class="desktop-sidebar" aria-label="桌面导航">
    <button class="sidebar-brand" type="button" :aria-label="`${siteSettings.name}首页`" :title="siteSettings.name" :disabled="disabled" @click="emit('discover')"><BrandMark /></button>
    <nav aria-label="主要导航">
      <IconButton class="sidebar-discover" label="发现" :active="activePage === 'discover'" :aria-current="activePage === 'discover' ? 'page' : undefined" :disabled="disabled" @click="emit('discover')"><Compass aria-hidden="true" /></IconButton>
      <IconButton class="sidebar-library" label="收藏" :active="activePage === 'library'" :aria-current="activePage === 'library' ? 'page' : undefined" :disabled="disabled" @click="emit('library')"><Bookmark aria-hidden="true" /></IconButton>
      <IconButton class="sidebar-history" label="历史" :active="activePage === 'history'" :aria-current="activePage === 'history' ? 'page' : undefined" :disabled="disabled" @click="emit('history')"><History aria-hidden="true" /></IconButton>
    </nav>
    <IconButton class="sidebar-settings" label="设置" :active="activePage === 'account'" :aria-current="activePage === 'account' ? 'page' : undefined" :disabled="disabled" @click="emit('account')"><Settings2 aria-hidden="true" /></IconButton>
  </aside>
</template>

<style scoped>
.desktop-sidebar { display: none; }
@media (min-width: 1024px) {
  .desktop-sidebar { position: fixed; inset: 0 auto 0 0; z-index: 200; display: flex; align-items: center; flex-direction: column; width: var(--app-rail-width); padding: 10px 0 22px; border-right: 1px solid var(--divider); background: var(--rail-background); }
  .sidebar-brand { display: grid; flex: 0 0 44px; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 14px; background: transparent; }
  .sidebar-brand > :first-child { width: 34px; height: 34px; border-radius: 11px; }
  nav { display: grid; justify-items: center; gap: 12px; margin-top: 36px; }
  .sidebar-settings { margin-top: auto; }
}
</style>
