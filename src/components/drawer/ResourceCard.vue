<script setup lang="ts">
import { computed } from 'vue';
import { Copy } from '@lucide/vue';
import type { ResourceItem, DriveType } from '../../types/search';
import { copyText } from '../../services/clipboard';
import { useToast } from '../../composables/useToast';

const props = defineProps<{
  resource: ResourceItem;
}>();

const toast = useToast();

const logoMeta = computed(() => {
  const map: Record<DriveType, { name: string; cls: string }> = {
    quark: { name: '云盘', cls: 'logo-quark' },
    aliyun: { name: '阿里', cls: 'logo-aliyun' },
    baidu: { name: '百度', cls: 'logo-baidu' },
    xunlei: { name: '迅雷', cls: 'logo-xunlei' },
    '115': { name: '115', cls: 'logo-115' },
    uc: { name: 'UC', cls: 'logo-uc' },
    tianyi: { name: '天翼', cls: 'logo-tianyi' },
    mobile: { name: '移动', cls: 'logo-other' },
    other: { name: '网盘', cls: 'logo-other' }
  };
  return map[props.resource.driveType] || { name: '网盘', cls: 'logo-other' };
});

const copyLink = async () => {
  const text = props.resource.password
    ? `${props.resource.url} 提取码: ${props.resource.password}`
    : props.resource.url;

  if (await copyText(text)) {
    toast.show('链接与提取码已成功复制到剪贴板！', '✓');
  } else {
    toast.show('当前环境无法复制，请长按资源链接后手动复制', '!', 3200);
  }
};
</script>

<template>
  <div class="resource-card">
    <div class="resource-left">
      <div class="drive-logo-badge" :class="logoMeta.cls">{{ logoMeta.name }}</div>
      <div class="resource-info">
        <div class="resource-title" :title="resource.title">{{ resource.title }}</div>
        <div class="resource-tags-row">
          <span class="quality-tag" :class="{ 'quality-4k': resource.is4k }">{{ resource.quality }}</span>
          <span v-if="resource.password" class="pwd-chip">提取码: {{ resource.password }}</span>
          <span>{{ resource.datetime }}</span>
          <span>{{ resource.source }}</span>
        </div>
      </div>
    </div>

    <div class="resource-actions">
      <button class="action-btn action-btn-copy" title="复制链接与提取码" @click="copyLink">
        <Copy aria-hidden="true" />
        复制
      </button>
      <span class="action-btn action-btn-unavailable" title="当前系统只内嵌播放云端高清资源">
        仅展示
      </span>
    </div>
  </div>
</template>

<style scoped>
.resource-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md);
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  transition: var(--transition-base);
  position: relative;
  overflow: hidden;
}
.resource-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.18);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}

.resource-left {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.drive-logo-badge {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.logo-quark { background: linear-gradient(135deg, #ff7043, #d84315); }
.logo-aliyun { background: linear-gradient(135deg, #ff8a65, #ff5722); }
.logo-baidu { background: linear-gradient(135deg, #42a5f5, #1565c0); }
.logo-xunlei { background: linear-gradient(135deg, #29b6f6, #0288d1); }
.logo-115 { background: linear-gradient(135deg, #ffca28, #f57f17); color: #111; }
.logo-uc { background: linear-gradient(135deg, #ffa726, #e65100); }
.logo-tianyi { background: linear-gradient(135deg, #26c6da, #00838f); }
.logo-other { background: linear-gradient(135deg, #78909c, #37474f); }

.resource-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.resource-title {
  font-size: 0.92rem;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  width: 100%;
  max-width: 100%;
}

.resource-tags-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.72rem;
  color: var(--text-tertiary);
}

.quality-tag {
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.3);
  color: #a5b4fc;
  border-radius: 4px;
  padding: 1px 6px;
  font-weight: 600;
}
.quality-4k {
  background: rgba(245, 158, 11, 0.15);
  border-color: rgba(245, 158, 11, 0.35);
  color: #fbbf24;
}

.pwd-chip {
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.35);
  color: #34d399;
  border-radius: 4px;
  padding: 1px 6px;
  font-family: monospace;
  font-weight: 600;
}

.resource-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.action-btn {
  padding: 8px 14px;
  border-radius: var(--radius-pill);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition-base);
  display: flex;
  align-items: center;
  gap: 5px;
  text-decoration: none;
  user-select: none;
}
.action-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.action-btn-copy {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--text-primary);
}
.action-btn-copy:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.28);
}

.action-btn-unavailable {
  cursor: default;
  color: var(--text-tertiary);
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}
</style>

<style scoped>
.resource-card { border-color: rgba(255, 255, 255, 0.075); border-radius: 15px; background: rgba(255, 255, 255, 0.035); }
.resource-card:hover { border-color: rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.06); box-shadow: none; transform: none; }
.drive-logo-badge { box-shadow: none; }
.quality-tag.quality-4k { color: var(--liquid-accent); border-color: rgb(var(--accent-rgb) / 0.22); background: var(--liquid-accent-subtle); }
.action-btn-copy { border-color: rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.055); }
@media (max-width: 640px) {
  .resource-card { align-items: stretch; flex-direction: column; gap: 10px; padding: 12px; }
  .resource-left { align-items: flex-start; gap: 10px; }
  .drive-logo-badge { width: 38px; height: 38px; border-radius: 11px; }
  .resource-title { white-space: normal; line-height: 1.4; }
  .resource-tags-row { gap: 5px 8px; margin-top: 5px; }
  .resource-actions { width: 100%; }
  .resource-actions .action-btn { min-height: 44px; flex: 1; justify-content: center; border-radius: 11px; }
}
</style>
