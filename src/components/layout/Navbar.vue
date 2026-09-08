<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue';
import { Search, X } from '@lucide/vue';
import type { MediaItem, CategoryType } from '../../types/media';
import type { AppUser } from '../../services/authService';
import BrandMark from '../common/BrandMark.vue';
import UserAvatar from '../common/UserAvatar.vue';
import { parseLibraryInput, type LibrarySaveFeedback } from '../../services/libraryFeedback';

const props = defineProps<{
  currentCategory: CategoryType;
  currentCategoryName: string;
  user: AppUser;
  addMedia: (media: MediaItem) => Promise<boolean>;
  isSaving?: boolean;
  saveError?: LibrarySaveFeedback | null;
}>();

const emit = defineEmits<{
  (e: 'search-media', keyword: string): void;
  (e: 'clear-save-error'): void;
  (e: 'open-auth-settings'): void;
  (e: 'open-account'): void;
  (e: 'search-blur'): void;
}>();

const searchQuery = ref('');
const isSearchPanelOpen = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);
const searchUnit = ref<HTMLElement | null>(null);
const submitting = ref(false);
const busy = computed(() => submitting.value || props.isSaving);
const parsedInput = computed(() => parseLibraryInput(searchQuery.value));

// 智能识别支持的分享链接
const isQuarkShareUrl = computed(() => parsedInput.value.kind === 'share');

watch(searchQuery, () => {
  emit('clear-save-error');
});

const handleInput = () => {
  if (searchQuery.value.trim()) {
    isSearchPanelOpen.value = true;
  } else {
    isSearchPanelOpen.value = false;
  }
};

const handleTriggerSearch = () => {
  if (busy.value) return;
  if (parsedInput.value.kind === 'share') { void handleSaveToCard(); return; }
  if (parsedInput.value.kind === 'invalid') { isSearchPanelOpen.value = true; return; }
  const q = searchQuery.value.trim();
  if (!q) return;
  emit('search-media', q);
  searchQuery.value = '';
  isSearchPanelOpen.value = false;
  searchInput.value?.blur();
};

const handleSearchBlur = () => {
  if (!searchQuery.value && !busy.value) emit('search-blur');
};

const clearSearch = () => {
  if (busy.value) return;
  searchQuery.value = '';
  isSearchPanelOpen.value = false;
  searchInput.value?.focus();
};

const dismissSearch = (event: PointerEvent) => {
  if (!busy.value && event.target instanceof Node && !searchUnit.value?.contains(event.target)) isSearchPanelOpen.value = false;
};
onMounted(() => document.addEventListener('pointerdown', dismissSearch));
onBeforeUnmount(() => document.removeEventListener('pointerdown', dismissSearch));

// 直接转存分享链接；真实目录名由服务端读取分享标题后确定。
const handleSaveToCard = async () => {
  if (busy.value || parsedInput.value.kind !== 'share') return;

  const newCard: MediaItem = {
    id: 'custom-' + Date.now(),
    title: '待识别片名',
    category: props.currentCategory,
    tag: '自定义网盘',
    status: '已收录',
    desc: '用户自定义网盘分享资源',
    poster: 'https://images.unsplash.com/photo-1578836537282-3171d77f8632?w=600&q=80',
    quarkQuality: '4K 原画',
    quarkShareUrl: parsedInput.value.url,
    quarkPasscode: parsedInput.value.passcode
  };

  submitting.value = true;
  searchInput.value?.blur();
  try {
    if (await props.addMedia(newCard)) {
      isSearchPanelOpen.value = false;
      searchQuery.value = '';
      emit('search-blur');
    }
  } finally {
    submitting.value = false;
  }
};

const scrollToTop = () => {
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

const focusSearch = async () => {
  await nextTick();
  searchInput.value?.focus({ preventScroll: false });
  searchInput.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

defineExpose({ focusSearch, scrollToTop });
</script>

<template>
  <header class="liquid-navbar-wrapper">
    <div class="liquid-navbar glass-rim">
      <!-- 品牌 Logo 区域 -->
      <button type="button" class="brand-unit" aria-label="回到页面顶部" @click="scrollToTop">
        <div class="mobile-title-group">
          <span class="mobile-brand-mark" aria-hidden="true">
            <BrandMark />
          </span>
          <span class="mobile-brand-copy">
            <strong>烟雨影视</strong>
            <small>{{ currentCategoryName }} · 私人片库</small>
          </span>
        </div>
        <div class="brand-logo-badge">
          <BrandMark class="brand-image" />
        </div>
        <div class="brand-text-group">
          <span class="brand-title">烟雨影视</span>
          <span class="brand-sub">MISTY RAIN</span>
        </div>
      </button>

      <!-- 搜索栏 -->
      <form ref="searchUnit" class="search-unit" role="search" @submit.prevent="handleTriggerSearch">
        <div class="search-lens-icon">
          <Search :size="15" :stroke-width="2.2" aria-hidden="true" />
        </div>
        <input
          ref="searchInput"
          v-model="searchQuery"
          type="text"
          inputmode="search"
          enterkeyhint="search"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          aria-label="搜索片名或粘贴夸克分享链接"
          :aria-expanded="isSearchPanelOpen"
          :aria-invalid="parsedInput.kind === 'invalid' || !!saveError"
          :aria-describedby="parsedInput.kind === 'invalid' || saveError ? 'library-input-feedback' : undefined"
          :disabled="busy"
          class="liquid-search-input"
          placeholder="搜索片名或粘贴分享链接"
          @input="handleInput"
          @focus="handleInput"
          @blur="handleSearchBlur"
          @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.preventDefault()"
          @keydown.esc="isSearchPanelOpen = false; searchInput?.blur(); emit('search-blur')"
        />
        <button v-if="searchQuery" type="button" class="clear-library-search" aria-label="清空片名或链接" :disabled="busy" @click="clearSearch"><X aria-hidden="true" /></button>

        <!-- 搜索液态气泡下拉 -->
        <div v-if="isSearchPanelOpen && searchQuery.trim()" class="liquid-dropdown">
          <template v-if="isQuarkShareUrl">
            <div class="dropdown-meta">
              <span class="meta-label-badge">网盘链接</span>
              <span class="meta-val truncate-url">{{ searchQuery }}</span>
            </div>
            <p v-if="parsedInput.kind === 'share' && parsedInput.passcode" class="share-progress">已自动识别提取码</p>
            <div v-if="saveError" id="library-input-feedback" class="inline-feedback" role="alert">
              <strong>{{ saveError.title }}</strong><p>{{ saveError.message }}</p>
              <button v-if="saveError.needsAuth" type="button" @click="emit('open-auth-settings')">前往认证设置</button>
            </div>
            <p v-if="busy" class="share-progress" role="status">正在验证链接并转存，请稍候…</p>
            <div class="dropdown-button-group">
              <button type="submit" class="liquid-btn btn-accent" :disabled="busy">
                {{ busy ? '正在添加…' : saveError ? '重新验证并添加' : `添加到${currentCategoryName}` }}
              </button>
            </div>
          </template>

          <div v-else-if="parsedInput.kind === 'invalid'" id="library-input-feedback" class="inline-feedback" role="alert">
            <strong>暂时无法识别这条链接</strong><p>{{ parsedInput.message }}</p>
          </div>
          <template v-else>
            <div class="dropdown-meta">
              <span class="meta-label">片名检索</span>
              <span class="meta-val">《{{ searchQuery }}》</span>
            </div>
            <div class="dropdown-button-group">
              <button type="submit" class="liquid-btn btn-accent" :disabled="busy">
                检索网盘资源
              </button>
            </div>
          </template>
        </div>
      </form>

      <!-- 右侧账户入口 -->
      <div class="trailing-unit">
        <button
          class="account-capsule-btn"
          :title="`当前账号：${user.username}`"
          aria-label="打开账户菜单"
          :disabled="busy"
          @click="emit('open-account')"
        >
          <UserAvatar class="account-avatar" :username="user.username" />
          <span class="account-name">{{ user.username }}</span>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.liquid-navbar-wrapper { position: sticky; top: 18px; z-index: 100; max-width: 1160px; margin: 0 auto; padding: 0 24px; }
.liquid-navbar { display: flex; align-items: center; gap: 28px; padding: 12px 16px 12px 20px; border: var(--glass-border); border-radius: 32px; background: var(--glass-floating-material); box-shadow: var(--glass-highlight-inner), var(--glass-shadow-md); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); }
.brand-unit { display: flex; align-items: center; gap: 10px; flex-shrink: 0; padding: 0; border: 0; color: var(--text-primary); background: transparent; text-align: left; }
.brand-logo-badge { width: 42px; height: 42px; overflow: hidden; border-radius: 15px; box-shadow: 0 3px 8px rgb(42 73 133 / .12); }
.brand-image { width: 100%; height: 100%; }
.brand-text-group { display: grid; gap: 1px; }
.brand-title { font-size: 1.1rem; font-weight: 750; letter-spacing: -.04em; }
.brand-sub { font-size: .58rem; letter-spacing: .16em; color: var(--text-tertiary); }
.mobile-title-group { display: none; }
.search-unit { position: relative; flex: 1; min-width: 0; }
.liquid-search-input { display: block; width: 100%; min-height: 48px; padding: 10px 48px 10px 43px; border: 1px solid rgb(255 255 255 / .09); border-radius: 24px; outline: none; color: var(--text-primary); background: rgb(105 130 180 / .06); box-shadow: inset 0 1px 3px rgb(55 79 122 / .05); font-size: 16px; transition: background .2s, box-shadow .2s; }
.liquid-search-input:focus { background: var(--glass-bg); box-shadow: 0 0 0 3px var(--liquid-accent-subtle); }
.liquid-search-input::placeholder { color: var(--text-tertiary); }
.search-lens-icon { position: absolute; top: 24px; left: 16px; display: flex; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
.clear-library-search { position: absolute; right: 3px; top: 2px; display: grid; width: 44px; height: 44px; place-items: center; border: 0; border-radius: 50%; color: var(--text-tertiary); background: transparent; }
.clear-library-search svg { width: 18px; height: 18px; }
.liquid-dropdown { position: absolute; top: calc(100% + 10px); left: 0; right: 0; z-index: 200; display: grid; gap: 14px; max-height: min(480px, 64dvh); overflow-y: auto; overscroll-behavior: contain; padding: 18px; border: var(--glass-border); border-radius: 24px; color: var(--text-primary); background: var(--glass-sheet-material); backdrop-filter: var(--glass-blur-heavy); -webkit-backdrop-filter: var(--glass-blur-heavy); box-shadow: var(--glass-highlight-inner), var(--glass-shadow-lg); }
.dropdown-meta { display: flex; min-width: 0; align-items: center; gap: 8px; font-size: .85rem; }
.meta-label, .meta-label-badge { flex: 0 0 auto; color: var(--liquid-accent); font-size: .73rem; font-weight: 650; }
.meta-label-badge { padding: 4px 8px; border-radius: 8px; background: var(--liquid-accent-subtle); }
.meta-val { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.share-progress { color: var(--liquid-accent); font-size: .85rem; }
.liquid-btn { width: 100%; min-height: 46px; padding: 10px 16px; border: 0; border-radius: 16px; color: var(--accent-ink); background: var(--liquid-accent); box-shadow: none; font-size: .86rem; font-weight: 650; }
.liquid-btn:hover:not(:disabled) { background: var(--liquid-accent-hover); }
.trailing-unit { display: flex; flex-shrink: 0; }
.account-capsule-btn { display: flex; align-items: center; gap: 9px; min-height: 46px; padding: 4px 14px 4px 4px; border: var(--glass-border); border-radius: 25px; color: var(--text-secondary); background: var(--glass-bg); box-shadow: var(--glass-highlight-inner); }
.account-avatar { width: 36px; height: 36px; border-radius: 50%; color: var(--liquid-accent); background: var(--surface-2); }
.account-name { max-width: 85px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8rem; font-weight: 600; }
@media (max-width: 640px) {
  .liquid-navbar-wrapper { top: 0; padding: calc(var(--safe-area-top) + 16px) calc(20px + var(--safe-area-right)) 10px calc(20px + var(--safe-area-left)); background: linear-gradient(180deg, rgb(16 19 23 / .95), rgb(16 19 23 / .78) 75%, transparent); }
  .liquid-navbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px 12px; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none; }
  .liquid-navbar::after { display: none; }
  .brand-logo-badge, .brand-text-group { display: none; }
  .mobile-title-group { display: flex; min-width: 0; align-items: center; gap: 11px; }
  .mobile-brand-mark { display: block; width: 40px; height: 40px; flex-shrink: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / .09); border-radius: 15px; box-shadow: 0 4px 10px rgb(71 100 161 / .13); }
  .mobile-brand-copy { display: grid; min-width: 0; gap: 1px; }
  .mobile-brand-copy strong { color: var(--text-primary); font-size: 1.17rem; font-weight: 750; letter-spacing: -.04em; }
  .mobile-brand-copy small { color: var(--text-tertiary); font-size: .67rem; }
  .search-unit { grid-column: 1 / -1; grid-row: 2; }
  .liquid-search-input { background: var(--glass-floating-material); box-shadow: var(--glass-highlight-inner), 0 7px 18px rgb(52 82 126 / .12); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); }
  .trailing-unit { grid-column: 2; grid-row: 1; }
  .account-capsule-btn { min-width: 46px; padding: 4px; }
  .account-name { display: none; }
  .liquid-dropdown { max-height: min(470px, 58dvh); }
}
</style>
