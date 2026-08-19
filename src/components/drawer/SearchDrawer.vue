<script setup lang="ts">
import { FolderSearch2, LoaderCircle, X } from '@lucide/vue';
import type { MediaItem } from '../../types/media';
import type { ResourceItem, DriveType, DriveCountMap } from '../../types/search';
import ResourceCard from './ResourceCard.vue';
import SkeletonCard from '../common/SkeletonCard.vue';

defineProps<{
  isOpen: boolean;
  isSearching: boolean;
  media: MediaItem | null;
  resources: ResourceItem[];
  driveCounts: DriveCountMap;
  selectedDrive: DriveType | 'all';
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:selectedDrive', drive: DriveType | 'all'): void;
}>();

const driveTabs: Array<{ key: DriveType | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'quark', label: '云端网盘' },
  { key: 'aliyun', label: '阿里云盘' },
  { key: 'baidu', label: '百度网盘' },
  { key: 'xunlei', label: '迅雷云盘' },
  { key: '115', label: '115网盘' },
  { key: 'uc', label: 'UC网盘' },
  { key: 'tianyi', label: '天翼云盘' }
];

const defaultSearchCover = `${import.meta.env.BASE_URL}app-icon-192.png`;

const setDrive = (key: DriveType | 'all') => {
  emit('update:selectedDrive', key);
};
</script>

<template>
  <div
    class="drawer-backdrop"
    :class="{ active: isOpen }"
    @click.self="emit('close')"
  >
    <div class="liquid-drawer-modal" v-if="media">
      <!-- 弹窗头部：目标影视元信息 -->
      <div class="drawer-header">
        <div class="target-media-summary">
          <img
            :src="defaultSearchCover"
            alt="烟雨影视默认封面"
            class="target-cover-thumb"
          />
          <div class="target-details">
            <div class="target-title-row">
              <h2 class="target-title">{{ media.title }}</h2>
              <span class="target-type-chip">{{ media.tag }}</span>
            </div>
            <p class="target-desc-line">{{ media.desc }}</p>
          </div>
        </div>
        <button class="drawer-close-btn" title="关闭" @click="emit('close')">
          <X aria-hidden="true" />
        </button>
      </div>

      <!-- 网盘分类过滤栏 -->
      <div class="drive-filter-bar">
        <div class="drive-chips-group">
          <button
            v-for="tab in driveTabs"
            :key="tab.key"
            class="drive-chip"
            :class="{ active: selectedDrive === tab.key }"
            @click="setDrive(tab.key)"
          >
            <span>{{ tab.label }}</span>
            <span class="badge-num">{{ driveCounts[tab.key] ?? 0 }}</span>
          </button>
        </div>
      </div>

      <!-- 弹窗列表主体 -->
      <div class="drawer-body">
        <!-- 骨架屏加载态 -->
        <template v-if="isSearching">
          <div class="searching-hint">
            <LoaderCircle class="spin-anim" aria-hidden="true" />
            正在检索各网盘资源，请稍候...
          </div>
          <SkeletonCard v-for="i in 4" :key="i" />
        </template>

        <!-- 资源列表 -->
        <template v-else-if="resources.length > 0">
          <ResourceCard
            v-for="res in resources"
            :key="res.id"
            :resource="res"
          />
        </template>

        <!-- 空状态 -->
        <div v-else class="empty-state-view">
          <div class="empty-icon" aria-hidden="true">
            <FolderSearch2 />
          </div>
          <div class="empty-title">当前网盘分类暂无匹配资源</div>
          <div class="empty-desc">建议切换到“全部”网盘标签查看，或尝试在原站检索更多分流。</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  z-index: 999;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.35s var(--spring-ease), visibility 0.35s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.drawer-backdrop.active {
  opacity: 1;
  visibility: visible;
}

.liquid-drawer-modal {
  width: 100%;
  max-width: 780px;
  max-height: 88vh;
  background: rgba(18, 24, 38, 0.85);
  backdrop-filter: var(--liquid-glass-blur);
  -webkit-backdrop-filter: var(--liquid-glass-blur);
  border: 1px solid var(--liquid-glass-border-highlight);
  border-radius: var(--radius-xl);
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 35px rgba(99, 102, 241, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: scale(0.92) translateY(20px);
  transition: transform 0.4s var(--spring-bounce), opacity 0.35s ease;
  opacity: 0;
}

.drawer-backdrop.active .liquid-drawer-modal {
  transform: scale(1) translateY(0);
  opacity: 1;
}

@media (max-width: 640px) {
  .drawer-backdrop {
    padding: 0;
    align-items: flex-end;
  }
  .liquid-drawer-modal {
    max-width: 100%;
    max-height: 90vh;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    transform: translateY(100%);
  }
  .drawer-backdrop.active .liquid-drawer-modal {
    transform: translateY(0);
  }
}

.drawer-header {
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  position: relative;
}

.target-media-summary {
  display: flex;
  gap: 16px;
  align-items: center;
  flex: 1;
}

.target-cover-thumb {
  width: 58px;
  height: 58px;
  border-radius: 16px;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}

.target-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.target-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.target-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: #fff;
}

.target-type-chip {
  font-size: 0.72rem;
  padding: 2px 8px;
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(99, 102, 241, 0.4);
  color: #a5b4fc;
  border-radius: var(--radius-pill);
  font-weight: 600;
}

.target-desc-line {
  font-size: 0.82rem;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.drawer-close-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: var(--transition-base);
}
.drawer-close-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  transform: rotate(90deg);
}
.drawer-close-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

.drive-filter-bar {
  padding: 12px 24px;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  overflow-x: auto;
  scrollbar-width: none;
}
.drive-filter-bar::-webkit-scrollbar { display: none; }

.drive-chips-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drive-chip {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-pill);
  padding: 5px 12px;
  font-size: 0.78rem;
  color: var(--text-secondary);
  cursor: pointer;
  transition: var(--transition-base);
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 5px;
}
.drive-chip:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.drive-chip.active {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.35);
  color: #fff;
  font-weight: 600;
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.3);
}
.drive-chip .badge-num {
  font-size: 0.7rem;
  padding: 1px 5px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.15);
}

.drawer-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.searching-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--accent-cyan);
  margin-bottom: 6px;
}

.spin-anim {
  width: 17px;
  height: 17px;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  100% { transform: rotate(360deg); }
}

.empty-state-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  text-align: center;
  gap: 12px;
}
.empty-icon {
  font-size: 3rem;
  opacity: 0.6;
}
.empty-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}
.empty-desc {
  font-size: 0.85rem;
  color: var(--text-tertiary);
  max-width: 360px;
}
</style>

<style scoped>
.liquid-drawer-modal { border-radius: 24px; }
.drawer-header,
.drive-filter-bar { border-color: rgba(255, 255, 255, 0.075); background: rgba(255, 255, 255, 0.018); }
.target-cover-thumb { border-color: rgba(255, 255, 255, 0.08); box-shadow: 0 7px 18px rgba(0, 0, 0, 0.3); }
.target-type-chip { color: var(--liquid-accent); border-color: rgb(var(--accent-rgb) / 0.24); background: var(--liquid-accent-subtle); }
.drawer-close-btn:hover { transform: none; }
.drive-chip { min-height: 36px; border-color: rgba(255, 255, 255, 0.075); background: rgba(255, 255, 255, 0.035); }
.drive-chip.active { color: var(--liquid-accent); border-color: rgb(var(--accent-rgb) / 0.24); background: var(--liquid-accent-subtle); box-shadow: none; }
.empty-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 18px;
  color: var(--liquid-accent);
  background: var(--liquid-accent-subtle);
  opacity: 1;
}
.empty-icon svg { width: 27px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

@media (prefers-reduced-motion: reduce) {
  .drawer-backdrop,
  .liquid-drawer-modal,
  .spin-anim { transition: none; animation: none; }
}

@media (max-width: 640px) {
  .liquid-drawer-modal { max-height: 94dvh; border-radius: 20px 20px 0 0; }
  .drawer-header { padding: 14px var(--mobile-gutter) 12px; }
  .target-media-summary { gap: 12px; }
  .target-cover-thumb { width: 52px; height: 52px; border-radius: 15px; }
  .target-title { font-size: 1.08rem; }
  .drive-filter-bar { padding: 8px var(--mobile-gutter); }
  .drive-chip { min-height: 44px; padding: 5px 12px; }
  .drawer-body { padding: 12px var(--mobile-gutter) calc(16px + var(--safe-area-bottom)); gap: 10px; }
  .drawer-close-btn { width: 44px; height: 44px; }
}
</style>
