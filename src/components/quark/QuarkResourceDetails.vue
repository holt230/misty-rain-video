<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowLeft, ChevronRight, File, Folder, RefreshCw, Video } from '@lucide/vue';
import type { ResourceItem } from '../../types/search';
import type { LibrarySaveFeedback } from '../../services/libraryFeedback';
import { QuarkStreamService, type QuarkShareDetails, type QuarkShareEntry } from '../../services/quarkStreamService';
import { compactShareSelection, toggleShareEntry } from '../../services/shareSelection';

const props = defineProps<{
  resource: ResourceItem;
  isSaving?: boolean;
  replacingSource?: boolean;
  playAfterSave?: boolean;
  saveError?: LibrarySaveFeedback | null;
}>();
const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'save', selectedFids?: string[]): void;
  (e: 'open-auth-settings'): void;
}>();

const details = ref<QuarkShareDetails | null>(null);
const isLoading = ref(false);
const loadError = ref('');
const currentFolder = ref('0');
const dismissFolder = () => {
  if (props.isSaving || currentFolder.value === '0') return false;
  currentFolder.value = entries.value.find(entry => entry.fid === currentFolder.value)?.parentFid || '0';
  return true;
};
defineExpose({ dismissFolder });
const selected = ref(new Set<string>());
let sequence = 0;
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const entries = computed(() => details.value?.entries || []);
const visibleEntries = computed(() => entries.value.filter(entry => entry.parentFid === currentFolder.value)
  .sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory) || collator.compare(left.name, right.name)));
const breadcrumbs = computed(() => {
  const folder = entries.value.find(entry => entry.fid === currentFolder.value);
  if (!folder) return [];
  return [...folder.ancestorFids, folder.fid].map(fid => entries.value.find(entry => entry.fid === fid)!);
});
const selectedFids = computed(() => compactShareSelection(entries.value, selected.value));
const selectedVideoCount = computed(() => entries.value.filter(entry => entry.isVideo && selected.value.has(entry.fid)).length);
const partial = (entry: QuarkShareEntry) => entry.isDirectory && !selected.value.has(entry.fid)
  && entries.value.some(item => item.ancestorFids.includes(entry.fid) && selected.value.has(item.fid));
const toggle = (entry: QuarkShareEntry) => {
  selected.value = toggleShareEntry(entries.value, selected.value, entry);
};
const selectCurrentFolder = () => {
  let next = new Set(selected.value);
  for (const entry of visibleEntries.value) {
    if (!next.has(entry.fid)) next = toggleShareEntry(entries.value, next, entry);
  }
  selected.value = next;
};

const load = async () => {
  const requestSequence = ++sequence;
  isLoading.value = true;
  loadError.value = '';
  details.value = null;
  currentFolder.value = '0';
  selected.value = new Set();
  try {
    const result = await QuarkStreamService.getShareDetails(props.resource.url, props.resource.password);
    if (requestSequence === sequence) details.value = result;
  } catch (error) {
    if (requestSequence === sequence) loadError.value = error instanceof Error ? error.message : '读取资源详情失败';
  } finally {
    if (requestSequence === sequence) isLoading.value = false;
  }
};
watch(() => props.resource, load, { immediate: true });
</script>

<template>
  <section class="resource-details" aria-label="资源详情" :aria-busy="isLoading || isSaving">
    <div class="detail-content">
      <button type="button" class="back-button" :disabled="isSaving" @click="emit('back')">
        <ArrowLeft aria-hidden="true" />返回搜索结果
      </button>
      <h4>{{ details?.title || resource.title }}</h4>
      <p v-if="details" class="detail-summary">{{ details.videoCount }} 个视频 · {{ details.episodeCount }} 集可识别剧集 · {{ entries.length }} 个文件及文件夹</p>
      <div v-if="isLoading" class="detail-notice" role="status">正在读取文件列表与集数…</div>
      <div v-else-if="loadError" class="detail-notice" role="alert">
        <p>{{ loadError }}</p>
        <button type="button" :disabled="isSaving" @click="load"><RefreshCw aria-hidden="true" />重试读取</button>
      </div>
      <template v-else-if="details">
        <nav class="breadcrumbs" aria-label="资源目录">
          <button type="button" :disabled="isSaving" @click="currentFolder = '0'">分享根目录</button>
          <template v-for="folder in breadcrumbs" :key="folder.fid">
            <ChevronRight aria-hidden="true" />
            <button type="button" :disabled="isSaving" @click="currentFolder = folder.fid">{{ folder.name }}</button>
          </template>
        </nav>
        <div class="selection-tools">
          <span>选择视频或目录，仅保存其中正片</span>
          <button type="button" :disabled="isSaving || !visibleEntries.length" @click="selectCurrentFolder">全选当前目录</button>
          <button type="button" :disabled="isSaving || !selected.size" @click="selected = new Set()">清空选择</button>
        </div>
        <ul class="file-list" aria-label="资源文件列表">
          <li v-for="entry in visibleEntries" :key="entry.fid" class="file-row">
            <input type="checkbox" :checked="selected.has(entry.fid)" :indeterminate="partial(entry)"
              :aria-label="`选择${entry.isDirectory ? '文件夹' : '文件'} ${entry.name}`"
              :disabled="isSaving || (!entry.isDirectory && !entry.isVideo && !entry.isSubtitle)" @change="toggle(entry)" />
            <component :is="entry.isDirectory ? Folder : entry.isVideo ? Video : File" class="file-icon" aria-hidden="true" />
            <div class="file-info">
              <button v-if="entry.isDirectory" type="button" class="folder-name" :disabled="isSaving" @click="currentFolder = entry.fid">
                {{ entry.name }}<ChevronRight aria-hidden="true" />
              </button>
              <button v-else type="button" class="file-name" :disabled="isSaving" @click="toggle(entry)">{{ entry.name }}</button>
              <p v-if="entry.isDirectory">{{ entry.videoCount }} 个视频 · 正片和字幕将保存到影片目录，其他附件跳过</p>
              <p v-else><span v-if="entry.episodeNumber">{{ entry.episodeTitle }} · </span>{{ entry.sizeFormatted }}<span v-if="entry.isSubtitle"> · 字幕文件</span><span v-else-if="!entry.isVideo"> · 非视频文件</span></p>
            </div>
          </li>
        </ul>
        <p v-if="!visibleEntries.length" class="detail-notice">此目录为空</p>
      </template>
      <div v-if="saveError" class="inline-feedback resource-save-error" role="alert">
        <strong>{{ saveError.title }}</strong><p>{{ saveError.message }}</p>
        <button v-if="saveError.needsAuth" type="button" @click="emit('open-auth-settings')">前往认证设置</button>
      </div>
    </div>
    <footer class="detail-footer">
      <p>已选 {{ selectedFids.length }} 项<span v-if="selected.size"> · 包含 {{ selectedVideoCount }} 个视频</span></p>
      <p class="subtitle-save-hint">保存视频时会同时保留匹配的字幕文件。</p>
      <div class="detail-save-actions">
        <button type="button" class="save-all" :disabled="isSaving || isLoading || !!loadError" @click="emit('save')">{{ replacingSource ? '用全部正片替换' : playAfterSave ? '添加全部并播放' : '保存全部正片' }}</button>
        <button type="button" class="save-selected" :disabled="isSaving || isLoading || !selectedVideoCount" @click="emit('save', selectedFids)">
          {{ isSaving ? '正在保存…' : replacingSource ? '用所选正片替换' : '保存所选正片' }}
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.resource-details { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; gap: 12px; }
.detail-content { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 12px; overflow-y: auto; overscroll-behavior: contain; padding: 3px; }
.detail-content > * { flex-shrink: 0; }
button { min-height: 44px; border: 0; border-radius: 10px; color: var(--text-secondary); background: transparent; font-size: .82rem; }
button:disabled, input:disabled { opacity: .45; cursor: default; }
.back-button { display: inline-flex; align-self: flex-start; align-items: center; gap: 7px; padding: 0 8px; color: var(--liquid-accent); }
.back-button svg, .breadcrumbs svg, .detail-notice svg { width: 17px; height: 17px; flex-shrink: 0; }
h4 { margin: 0; font-size: 1rem; line-height: 1.6; overflow-wrap: anywhere; }
.detail-summary, .detail-notice, .file-info p, .detail-footer p { color: var(--text-tertiary); font-size: .76rem; line-height: 1.7; margin: 0; }
.breadcrumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--divider); }
.breadcrumbs button { padding: 0 8px; max-width: 100%; overflow-wrap: anywhere; }
.selection-tools { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: .74rem; color: var(--text-tertiary); }
.selection-tools span { flex: 1; min-width: 120px; }
.selection-tools button { padding: 0 8px; color: var(--liquid-accent); }
.file-list { list-style: none; padding: 0; margin: 0; }
.file-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--divider); }
.file-row input { width: 20px; height: 20px; margin: 12px 0; flex-shrink: 0; accent-color: var(--liquid-accent); }
.file-icon { width: 22px; height: 22px; color: var(--liquid-accent); flex-shrink: 0; }
.file-info { min-width: 0; flex: 1; }
.file-name, .folder-name { display: flex; align-items: center; gap: 8px; width: 100%; padding: 0; text-align: left; color: var(--text-primary); font-size: .86rem; line-height: 1.6; overflow-wrap: anywhere; cursor: pointer; }
.folder-name svg { width: 18px; height: 18px; margin-left: auto; flex-shrink: 0; }
.detail-notice { padding: 24px 0; }
.detail-notice button { display: inline-flex; align-items: center; gap: 6px; color: var(--liquid-accent); }
.detail-footer { display: grid; flex-shrink: 0; gap: 10px; padding-top: 14px; border-top: var(--glass-border); }
.detail-save-actions { display: flex; gap: 10px; }
.detail-save-actions button { min-height: 46px; padding: 0 16px; }
.save-all { background: var(--glass-bg-active); }
.save-selected { flex: 1; color: var(--accent-ink); background: var(--liquid-accent); font-weight: 650; }
@media (max-width: 640px) {
  .file-row { gap: 9px; }
}
</style>
