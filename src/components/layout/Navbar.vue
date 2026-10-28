<script setup lang="ts">
import {computed,ref,onMounted,onBeforeUnmount} from 'vue';
import {Search,Settings2} from '@lucide/vue';
import {siteSettings} from '../../services/siteSettings';
import BrandMark from '../common/BrandMark.vue';
import IconButton from '../common/IconButton.vue';
defineOptions({inheritAttrs:false});
const props=defineProps<{activePage?:'discover'|'library'|'history'|'account'|'catalog'|'detail'|'browse';immersive?:boolean;isSaving?:boolean;searchOpen?:boolean}>();
const emit=defineEmits<{(event:'open-search'):void;(event:'open-account'):void;(event:'navigate',page:'discover'|'library'|'history'):void}>();
const destinations=[{value:'discover',label:'发现'},{value:'library',label:'收藏'},{value:'history',label:'历史'}] as const;
const activeDestination=computed(()=>['catalog','detail','browse'].includes(props.activePage||'')?'discover':props.activePage||'discover');
const scrolled=ref(false),syncScroll=()=>{scrolled.value=window.scrollY>24;};
onMounted(()=>{window.addEventListener('scroll',syncScroll,{passive:true});syncScroll();});
onBeforeUnmount(()=>window.removeEventListener('scroll',syncScroll));
const scrollToTop=()=>window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
defineExpose({scrollToTop});
</script>
<template>
  <header v-bind="$attrs" class="liquid-navbar-wrapper" :class="{ 'is-immersive': immersive, 'is-scrolled': scrolled }">
    <div class="liquid-navbar">
      <button type="button" class="brand-unit" :aria-label="`${siteSettings.name}首页`" :disabled="isSaving" @click="emit('navigate', 'discover')"><BrandMark class="brand-image" /><span class="brand-title">{{ siteSettings.name }}</span></button>
      <nav class="desktop-navigation" aria-label="主要导航"><button v-for="destination in destinations" :key="destination.value" type="button" :aria-current="activeDestination === destination.value ? 'page' : undefined" :disabled="isSaving" @click="emit('navigate', destination.value)">{{ destination.label }}</button></nav>
      <div class="navbar-actions"><IconButton class="search-trigger" label="搜索" :aria-expanded="searchOpen" aria-haspopup="dialog" :disabled="isSaving" @click="emit('open-search')"><Search aria-hidden="true" /></IconButton><IconButton class="settings-trigger" label="设置" :active="activePage === 'account'" :aria-current="activePage === 'account' ? 'page' : undefined" :disabled="isSaving" @click="emit('open-account')"><Settings2 aria-hidden="true" /></IconButton></div>
    </div>
  </header>
</template>
<style scoped>
.liquid-navbar-wrapper { position: sticky; top: 0; z-index: 100; width: 100%; box-shadow: inset 0 -1px 0 var(--divider); color: var(--text-primary); background: var(--nav-background); transition: background .2s ease, border-color .2s ease; }
.liquid-navbar-wrapper.is-immersive:not(.is-scrolled) { --text-primary: #fff; --text-secondary: rgb(255 255 255 / .76); --liquid-accent: #fff; --accent-ink: #08090b; --glass-bg-hover: rgb(255 255 255 / .12); box-shadow: none; background: linear-gradient(180deg, rgb(0 0 0 / .65), rgb(0 0 0 / .25) 65%, transparent); }
.liquid-navbar { display: flex; align-items: center; gap: 36px; width: 100%; max-width: var(--content-max-width); min-height: var(--app-header-height); margin: 0 auto; padding: 0 var(--content-gutter); }
.brand-unit { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 44px; max-width: 260px; padding: 0; border: 0; color: var(--text-primary); background: transparent; text-align: left; }
.brand-image { width: 30px; height: 30px; flex: 0 0 30px; overflow: hidden; border-radius: 10px; }
.brand-title { overflow: hidden; font-size: 1.12rem; font-weight: 750; letter-spacing: -.025em; white-space: nowrap; text-overflow: ellipsis; }
.desktop-navigation { display: flex; align-items: center; gap: 26px; height: var(--app-header-height); }
.desktop-navigation button { position: relative; min-width: 44px; height: 100%; padding: 0; border: 0; color: var(--text-secondary); background: none; font-size: .88rem; font-weight: 500; }
.desktop-navigation button[aria-current] { color: var(--text-primary); font-weight: 700; }
.desktop-navigation button[aria-current]::after { content: ""; position: absolute; bottom: 14px; left: 50%; width: 16px; height: 2px; transform: translateX(-50%); background: currentColor; }
.navbar-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.search-trigger { flex-shrink: 0; }
@media (hover:hover) and (pointer:fine) { .desktop-navigation button:hover { color: var(--text-primary); } }
@media (max-width: 1023px) { .desktop-navigation, .settings-trigger { display: none; } .brand-unit { max-width: calc(100% - 64px); } }
@media (min-width: 641px) and (max-width: 1023px) { .liquid-navbar { padding-right: max(28px, var(--safe-area-right)); padding-left: max(28px, var(--safe-area-left)); } }
@media (max-width: 640px) {
  .liquid-navbar-wrapper { padding-top: var(--safe-area-top); }
  .liquid-navbar { min-height: 64px; padding-right: calc(var(--mobile-gutter) + var(--safe-area-right)); padding-left: calc(var(--mobile-gutter) + var(--safe-area-left)); }
  .brand-image { width: 28px; height: 28px; flex-basis: 28px; border-radius: 9px; }
  .brand-title { font-size: .95rem; }
}
@media (prefers-reduced-motion: reduce) { .liquid-navbar-wrapper { transition: none; }  }
</style>
