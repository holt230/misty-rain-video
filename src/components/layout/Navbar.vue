<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { Search } from '@lucide/vue';
import type { MediaItem, CategoryType } from '../../types/media';
import type { AppUser } from '../../services/authService';
import BrandMark from '../common/BrandMark.vue';
import UserAvatar from '../common/UserAvatar.vue';

const props = defineProps<{
  currentCategory: CategoryType;
  currentCategoryName: string;
  user: AppUser;
}>();

const emit = defineEmits<{
  (e: 'search-media', keyword: string): void;
  (e: 'save-card', media: MediaItem): void;
  (e: 'open-account'): void;
  (e: 'search-blur'): void;
}>();

const searchQuery = ref('');
const isSearchPanelOpen = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);

// 智能识别支持的分享链接
const isQuarkShareUrl = computed(() => {
  return /pan\.quark\.cn\/s\/[a-zA-Z0-9]+/i.test(searchQuery.value.trim());
});

const handleInput = () => {
  if (searchQuery.value.trim()) {
    isSearchPanelOpen.value = true;
  } else {
    isSearchPanelOpen.value = false;
  }
};

const handleTriggerSearch = () => {
  const q = searchQuery.value.trim();
  if (!q) return;
  emit('search-media', q);
  searchQuery.value = '';
  isSearchPanelOpen.value = false;
  searchInput.value?.blur();
};

const handleSearchBlur = () => {
  emit('search-blur');
};

// 直接转存分享链接；真实目录名由服务端读取分享标题后确定。
const handleSaveToCard = () => {
  const raw = searchQuery.value.trim();
  if (!raw) return;

  const isUrl = isQuarkShareUrl.value;
  if (!isUrl) return;
  const shareUrl = raw;

  const newCard: MediaItem = {
    id: 'custom-' + Date.now(),
    title: '待识别片名',
    category: props.currentCategory,
    tag: isUrl ? '自定义网盘' : '4K',
    status: '已收录',
    desc: isUrl ? '用户自定义网盘分享资源' : '网盘影视资源',
    poster: 'https://images.unsplash.com/photo-1578836537282-3171d77f8632?w=600&q=80',
    quarkQuality: '4K 原画',
    quarkShareUrl: shareUrl
  };

  emit('save-card', newCard);
  isSearchPanelOpen.value = false;
  searchQuery.value = '';
  searchInput.value?.blur();
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
    <div class="liquid-navbar">
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
      <div class="search-unit">
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
          class="liquid-search-input"
          placeholder="搜索片名或粘贴分享链接"
          @input="handleInput"
          @blur="handleSearchBlur"
          @keydown.enter="handleTriggerSearch"
        />

        <!-- 搜索液态气泡下拉 -->
        <div v-if="isSearchPanelOpen && searchQuery.trim()" class="liquid-dropdown">
          <template v-if="isQuarkShareUrl">
            <div class="dropdown-meta">
              <span class="meta-label-badge">网盘链接</span>
              <span class="meta-val truncate-url">{{ searchQuery }}</span>
            </div>
            <div class="dropdown-button-group">
              <button class="liquid-btn btn-accent" @click="handleSaveToCard">
                按分享名称转存到【{{ currentCategoryName }}】
              </button>
            </div>
          </template>

          <template v-else>
            <div class="dropdown-meta">
              <span class="meta-label">片名检索</span>
              <span class="meta-val">《{{ searchQuery }}》</span>
            </div>
            <div class="dropdown-button-group">
              <button class="liquid-btn btn-accent" @click="handleTriggerSearch">
                检索网盘资源
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- 右侧账户入口 -->
      <div class="trailing-unit">
        <button
          class="account-capsule-btn"
          :title="`当前账号：${user.username}`"
          aria-label="打开账户菜单"
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
.liquid-navbar-wrapper {
  position: sticky;
  top: 16px;
  z-index: 100;
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 16px;
}

.mobile-title-group { display: none; }

.liquid-navbar {
  background: rgba(22, 28, 44, 0.65);
  backdrop-filter: blur(32px) saturate(190%);
  -webkit-backdrop-filter: blur(32px) saturate(190%);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow:
    inset 0 1px 1px 0 rgba(255, 255, 255, 0.32),
    inset 0 -1px 0 0 rgba(255, 255, 255, 0.05),
    0 16px 36px -6px rgba(0, 0, 0, 0.55);
  border-radius: var(--radius-pill);
  padding: 8px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.brand-unit {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.brand-logo-badge {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.4),
    0 4px 12px rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.3s var(--spring-bounce);
  overflow: hidden;
}
.brand-unit:hover .brand-logo-badge {
  transform: scale(1.08) rotate(2deg);
}

.brand-image { width: 100%; height: 100%; border-radius: inherit; }

.brand-text-group {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.brand-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: #fff;
}

.brand-sub {
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 1.2px;
  color: var(--text-tertiary);
  opacity: 0.8;
}

.search-unit {
  flex: 1;
  max-width: 480px;
  position: relative;
}

.liquid-search-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
  border-radius: var(--radius-pill);
  padding: 8px 16px 8px 36px;
  color: #fff;
  font-size: 0.88rem;
  outline: none;
  transition: var(--spring-ease);
}
.liquid-search-input:focus {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.35);
  box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.2), inset 0 1px 2px rgba(0, 0, 0, 0.2);
}
.liquid-search-input::placeholder {
  color: var(--text-tertiary);
}

.search-lens-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  pointer-events: none;
}

.liquid-dropdown {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  right: 0;
  background: rgba(24, 30, 46, 0.92);
  backdrop-filter: blur(36px) saturate(200%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow:
    inset 0 1px 1px 0 rgba(255, 255, 255, 0.3),
    0 24px 50px rgba(0,0,0,0.65);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 200;
}

.dropdown-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
}
.meta-label { color: var(--text-tertiary); }
.meta-label-badge {
  background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong));
  color: #fff;
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  font-weight: 600;
}
.meta-val { color: #fff; font-weight: 600; }
.truncate-url {
  max-width: 320px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-button-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.liquid-btn {
  padding: 7px 16px;
  border-radius: var(--radius-pill);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: var(--spring-ease);
  border: none;
}

.btn-accent {
  background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong));
  color: #fff;
  box-shadow: 0 4px 14px rgba(255, 87, 34, 0.35);
}
.btn-accent:hover { transform: scale(1.03); }

.btn-glass {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--text-secondary);
}
.btn-glass:hover { background: rgba(255, 255, 255, 0.18); color: #fff; }

.trailing-unit {
  display: flex;
  align-items: center;
}

.account-capsule-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 6px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.25);
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s var(--spring-bounce);
}
.account-capsule-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  transform: scale(1.04);
}
.account-avatar { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; color: #ffae89; background: rgba(255,107,53,.14); font-size: .72rem; font-weight: 800; }
.account-name { max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 640px) {
  .liquid-navbar-wrapper {
    position: sticky;
    top: 0;
    max-width: none;
    padding-top: calc(var(--safe-area-top) + 5px);
    padding-right: calc(12px + var(--safe-area-right));
    padding-bottom: 13px;
    padding-left: calc(12px + var(--safe-area-left));
  }

  .liquid-navbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 9px 10px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .brand-unit {
    min-width: 0;
    gap: 0;
  }

  .mobile-title-group {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.04;
  }

  .mobile-title-group span {
    margin-left: 2px;
    color: rgba(243, 247, 255, 0.64);
    font-size: 0.71rem;
    font-weight: 650;
    letter-spacing: 0.05em;
  }

  .mobile-title-group strong {
    margin-top: 3px;
    color: #fff;
    font-size: 1.92rem;
    font-weight: 680;
    letter-spacing: -0.035em;
  }

  .brand-logo-badge,
  .brand-text-group { display: none; }

  .search-unit {
    width: 100%;
    max-width: none;
    grid-column: 1 / -1;
    grid-row: 2;
    isolation: isolate;
  }

  .search-unit::before,
  .search-unit::after {
    content: '';
    position: absolute;
    pointer-events: none;
    border-radius: 24px;
  }

  .search-unit::before {
    inset: 0;
    z-index: -1;
    border: 1px solid rgba(232, 240, 255, 0.6);
    background:
      linear-gradient(145deg, rgba(224, 235, 255, 0.24), rgba(95, 111, 144, 0.14) 46%, rgba(28, 37, 57, 0.32)),
      rgba(46, 57, 82, 0.26);
    box-shadow:
      inset 0 2px 2px rgba(255, 255, 255, 0.55),
      inset 1px 0 rgba(172, 215, 255, 0.36),
      inset -1px -1px rgba(255, 191, 164, 0.25),
      0 0 0 1px rgba(101, 127, 173, 0.28),
      0 14px 34px rgba(0, 0, 0, 0.46);
    backdrop-filter: blur(32px) saturate(185%);
    -webkit-backdrop-filter: blur(32px) saturate(185%);
  }

  .search-unit::after {
    inset: 1px;
    z-index: -1;
    opacity: 0.72;
    background:
      radial-gradient(90px 18px at 86% 2%, rgba(255, 211, 191, 0.32), transparent 72%),
      radial-gradient(92px 22px at 12% 100%, rgba(138, 196, 255, 0.27), transparent 76%);
  }

  .liquid-search-input {
    min-height: 54px;
    padding: 8px 40px 8px 39px;
    border-color: transparent;
    border-radius: 24px;
    background: transparent;
    box-shadow: none;
    font-size: 16px;
  }

  .liquid-search-input:focus {
    border-color: transparent;
    background: rgba(255, 255, 255, 0.055);
    box-shadow: inset 0 0 0 2px rgba(170, 205, 255, 0.18);
  }

  .search-lens-icon {
    left: 14px;
  }

  .liquid-dropdown {
    top: calc(100% + 8px);
    padding: 14px;
  }

  .dropdown-meta {
    align-items: flex-start;
  }

  .truncate-url {
    max-width: calc(100vw - 116px);
  }

  .liquid-btn {
    width: 100%;
    min-height: 44px;
  }

  .trailing-unit {
    grid-column: 2;
    grid-row: 1;
  }

  .account-capsule-btn {
    min-width: 48px;
    min-height: 48px;
    padding: 4px;
    border-color: rgba(234, 242, 255, 0.52);
    background:
      radial-gradient(circle at 30% 18%, rgba(255, 255, 255, 0.32), transparent 34%),
      linear-gradient(145deg, rgba(137, 159, 201, 0.28), rgba(32, 41, 62, 0.6));
    box-shadow:
      inset 0 2px 2px rgba(255, 255, 255, 0.56),
      inset -2px -2px 5px rgba(255, 200, 172, 0.22),
      0 0 0 1px rgba(101, 129, 181, 0.28),
      0 10px 25px rgba(0, 0, 0, 0.54);
    backdrop-filter: blur(26px) saturate(190%);
    -webkit-backdrop-filter: blur(26px) saturate(190%);
    touch-action: manipulation;
  }

  .account-avatar { width: 38px; height: 38px; color: #ffab8d; background: rgba(16, 23, 39, 0.44); box-shadow: inset 0 1px rgba(255, 255, 255, 0.16); font-size: 0.82rem; }
  .account-name { display: none; }
}
</style>

<style scoped>
/* Midnight glass refinements for the compact mobile header. */
.liquid-navbar-wrapper {
  top: 14px;
}

.liquid-navbar {
  border-color: rgb(238 241 255 / 0.10);
  background: rgb(17 19 28 / 0.84);
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.34), inset 0 1px rgb(255 255 255 / 0.055);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
}

.brand-logo-badge {
  background: rgb(9 11 18 / 0.92);
  box-shadow: 0 7px 20px var(--liquid-accent-glow);
}

.brand-image { filter: none; }
.brand-sub { color: var(--text-quaternary); }

.liquid-search-input {
  border-color: rgb(239 241 255 / 0.09);
  color: var(--text-primary);
  background: rgb(237 240 255 / 0.045);
}

.liquid-search-input:focus {
  border-color: rgb(var(--accent-rgb) / 0.44);
  background: rgb(237 240 255 / 0.065);
  box-shadow: 0 0 0 3px rgb(var(--accent-rgb) / 0.10);
}

.search-lens-icon { color: var(--text-tertiary); }
.liquid-dropdown { border-color: rgb(239 241 255 / 0.11); background: rgb(16 18 27 / 0.98); }
.meta-label-badge,
.btn-accent { color: var(--accent-ink); background: linear-gradient(145deg, var(--liquid-accent), var(--liquid-accent-strong)); }
.btn-accent:hover { background: var(--liquid-accent-hover); }

.account-capsule-btn {
  border-color: rgb(239 241 255 / 0.09);
  background: rgb(237 240 255 / 0.045);
}

.account-capsule-btn:hover { background: rgb(237 240 255 / 0.08); }
.account-avatar { color: var(--accent-ink); background: var(--liquid-accent); }

@media (max-width: 640px) {
  .liquid-navbar-wrapper {
    top: 0;
    padding-top: calc(var(--safe-area-top) + 12px);
    padding-right: calc(var(--mobile-gutter) + var(--safe-area-right));
    padding-bottom: 0;
    padding-left: calc(var(--mobile-gutter) + var(--safe-area-left));
  }

  .liquid-navbar {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px 10px;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .brand-unit { min-height: 46px; }
  .mobile-title-group {
    display: flex;
    min-width: 0;
    min-height: 46px;
    flex-direction: row;
    align-items: center;
    gap: 10px;
  }

  .mobile-brand-mark {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    flex: 0 0 auto;
    border: 1px solid rgb(var(--accent-rgb) / 0.20);
    border-radius: 12px;
    overflow: hidden;
    background: rgb(9 11 18 / 0.92);
    box-shadow: inset 0 1px rgb(255 255 255 / 0.10), 0 0 22px var(--liquid-accent-muted);
    margin-left: 0;
    letter-spacing: 0;
  }

  .mobile-brand-mark :deep(.brand-mark-image) { border-radius: inherit; }

  .mobile-brand-copy { display: grid; min-width: 0; gap: 2px; margin-left: 0; letter-spacing: 0; }
  .mobile-title-group strong {
    margin: 0;
    overflow: hidden;
    color: var(--text-primary);
    font-size: 1.24rem;
    font-weight: 740;
    line-height: 1.08;
    letter-spacing: -0.035em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mobile-title-group small {
    overflow: hidden;
    color: var(--text-tertiary);
    font-size: 0.64rem;
    font-weight: 580;
    letter-spacing: 0.015em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-unit::before {
    border: 1px solid rgb(239 241 255 / 0.085);
    border-radius: 17px;
    background: rgb(237 240 255 / 0.04);
    box-shadow: inset 0 1px rgb(255 255 255 / 0.045), 0 12px 28px rgb(0 0 0 / 0.18);
    backdrop-filter: blur(18px) saturate(145%);
    -webkit-backdrop-filter: blur(18px) saturate(145%);
  }

  .search-unit::after { display: none; }
  .liquid-search-input { min-height: 48px; padding: 8px 14px 8px 41px; border-radius: 17px; }
  .liquid-search-input:focus { background: rgb(var(--accent-rgb) / 0.035); box-shadow: inset 0 0 0 1px rgb(var(--accent-rgb) / 0.26); }

  .account-capsule-btn {
    min-width: 44px;
    min-height: 44px;
    padding: 2px;
    overflow: hidden;
    border: 1px solid rgb(var(--accent-rgb) / 0.17);
    background: var(--liquid-accent-subtle);
    box-shadow: inset 0 1px rgb(255 255 255 / 0.10), 0 9px 24px rgb(0 0 0 / 0.24);
    backdrop-filter: blur(18px) saturate(145%);
    -webkit-backdrop-filter: blur(18px) saturate(145%);
  }
  .account-avatar { width: 36px; height: 36px; color: var(--accent-ink); background: var(--liquid-accent); }

  .liquid-dropdown { top: calc(100% + 7px); border-radius: 17px; }
}
</style>
