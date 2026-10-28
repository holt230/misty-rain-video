<script setup lang="ts">
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ChevronRight, FolderOpen, Play, RefreshCw } from '@lucide/vue';
import ScrollLoad from '../common/ScrollLoad.vue';
import ResourceThumbnail from './ResourceThumbnail.vue';
import { discardFailedSource } from '../../../server/shareFailurePolicy.js';
import type { ResourceItem } from '../../types/search';
import type { LibrarySaveFeedback } from '../../services/libraryFeedback';
import { QuarkStreamService, type QuarkShareDetails, type QuarkShareEntry } from '../../services/quarkStreamService';
import { compactShareSelection, toggleShareEntry } from '../../services/shareSelection';
const props = defineProps<{ resource: ResourceItem; initialDetails?: QuarkShareDetails; isSaving?: boolean; replacingSource?: boolean; saveError?: LibrarySaveFeedback | null }>();
const emit = defineEmits<{ (e: 'back'): void; (e: 'loaded', details: QuarkShareDetails): void; (e: 'unavailable', resource: ResourceItem): void; (e: 'save', selectedFids?: string[]): void; (e: 'play', fid: string): void; (e: 'open-auth-settings'): void }>();
const details = ref<QuarkShareDetails | null>(null), isLoading = ref(false), loadError = ref('');
const currentFolder = ref('0'), selected = ref(new Set<string>()), sort = ref('name');
const renderLimit=ref(60);
watch([currentFolder,sort,()=>props.resource.url],()=>{renderLimit.value=60;});
let sequence = 0;
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const entries = computed(() => details.value?.entries || []);
const visibleEntries = computed(() => entries.value.filter(entry => entry.parentFid === currentFolder.value).sort((a,b) =>
  Number(b.isDirectory) - Number(a.isDirectory) || (sort.value === 'size' ? b.size - a.size : sort.value === 'date' ? (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0) : collator.compare(a.name,b.name))));
const breadcrumbs = computed(() => { const folder = entries.value.find(entry => entry.fid === currentFolder.value); return folder ? [...folder.ancestorFids,folder.fid].map(fid => entries.value.find(entry => entry.fid === fid)).filter((item): item is QuarkShareEntry => Boolean(item)) : []; });
const selectedFids = computed(() => compactShareSelection(entries.value, selected.value));
const selectedVideoCount = computed(() => entries.value.filter(entry => entry.isVideo && selected.value.has(entry.fid)).length);
const selectable = (entry: QuarkShareEntry) => entry.isVideo || entry.isSubtitle || entry.isDirectory && entry.videoCount > 0;
const partial = (entry: QuarkShareEntry) => entry.isDirectory && !selected.value.has(entry.fid) && entries.value.some(item => item.ancestorFids.includes(entry.fid) && selected.value.has(item.fid));
const toggle = (entry: QuarkShareEntry) => { if (!props.isSaving && selectable(entry)) selected.value = toggleShareEntry(entries.value,selected.value,entry); };
const allSelected = computed(() => visibleEntries.value.some(selectable) && visibleEntries.value.filter(selectable).every(item => selected.value.has(item.fid)));
const toggleAll = () => {
  const clear = allSelected.value; let next = new Set(selected.value);
  for (const entry of visibleEntries.value.filter(selectable)) if (next.has(entry.fid) === clear) next = toggleShareEntry(entries.value,next,entry);
  selected.value = next;
};
const enter = (entry: QuarkShareEntry) => { if (props.isSaving) return; if (entry.isDirectory) currentFolder.value = entry.fid; else if (entry.isVideo && !props.replacingSource) emit('play',entry.fid); };
const dateText = (value?: string, time = false) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } as const : {})}) : '—';
const install = (result: QuarkShareDetails) => {
  if (!result.videoCount) { emit('unavailable', props.resource); return; }
  details.value = result;
  // Skip a chain of packaging folders, while keeping its breadcrumb available.
  const visited = new Set<string>();
  while (!visited.has(currentFolder.value)) {
    visited.add(currentFolder.value);
    const children = result.entries.filter(item => item.parentFid === currentFolder.value);
    if (children.length !== 1 || !children[0]!.isDirectory) break;
    currentFolder.value = children[0]!.fid;
  }
  emit('loaded',result);
};
const load = async (force = false) => {
  const request = ++sequence; isLoading.value = true; loadError.value = ''; details.value = null; currentFolder.value = '0'; selected.value = new Set();
  try { const result = !force && props.initialDetails || await QuarkStreamService.getShareDetails(props.resource.url,props.resource.password); if (request === sequence) install(result); }
  catch (error) { if (request === sequence) { loadError.value = error instanceof Error ? error.message : '文件读取失败'; if (discardFailedSource(error)) emit('unavailable',props.resource); } }
  finally { if (request === sequence) isLoading.value = false; }
};
watch(() => props.resource, () => load(), { immediate: true });
onBeforeUnmount(() => { sequence++; });
</script>
<template>
  <section class="resource-details" aria-label="资源详情" :aria-busy="isLoading || isSaving">
    <nav class="breadcrumbs" aria-label="资源目录"><button type="button" :disabled="isSaving" @click="currentFolder = '0'">全部文件</button><template v-for="folder in breadcrumbs" :key="folder.fid"><ChevronRight aria-hidden="true" /><button type="button" :disabled="isSaving" :title="folder.name" @click="currentFolder = folder.fid">{{ folder.name }}</button></template></nav>
    <div v-if="details" class="file-toolbar"><label><input type="checkbox" aria-label="全选当前目录" :checked="allSelected" :disabled="isSaving || !visibleEntries.some(selectable)" @change="toggleAll" />全选</label><span>{{ visibleEntries.length }} 项</span><select v-model="sort" aria-label="文件排序"><option value="name">名称</option><option value="size">大小</option><option value="date">修改时间</option></select><button type="button" class="icon-button" aria-label="刷新文件列表" :disabled="isSaving" @click="load(true)"><RefreshCw /></button></div>
    <div class="detail-content">
      <LoadingSkeleton v-if="isLoading" variant="rows" :count="6" label="正在读取文件" />
      <div v-else-if="loadError" class="detail-state" role="alert"><p>{{ loadError }}</p><button type="button" :disabled="isSaving" @click="load(true)">重试</button></div>
      <template v-else-if="details">
        <div v-if="visibleEntries.length" class="file-columns" aria-hidden="true"><span>文件名</span><span>大小</span><span>修改时间</span></div>
        <ul class="file-list" aria-label="资源文件列表">
          <li v-for="entry in visibleEntries.slice(0,renderLimit)" :key="entry.fid" class="file-row" @click="enter(entry)" :class="{ selected: selected.has(entry.fid) }">
            <label class="file-selection" @click.stop><input type="checkbox" :checked="Boolean(selectable(entry) && selected.has(entry.fid))" :indeterminate="partial(entry)" :aria-label="`选择${entry.isDirectory ? '文件夹' : '文件'} ${entry.name}`" :disabled="isSaving || !selectable(entry)" @click.stop @change="toggle(entry)" /></label>
            <button type="button" class="file-open" :aria-label="`${entry.isDirectory ? '打开文件夹' : entry.isVideo ? '播放' : '文件'} ${entry.name}`" :disabled="isSaving || (!entry.isDirectory && (!entry.isVideo || replacingSource))" @click.stop="enter(entry)">
              <ResourceThumbnail :src="entry.thumbnail" :directory="entry.isDirectory" :video="entry.isVideo" />
              <span class="file-copy"><strong :title="entry.name">{{ entry.name }}</strong><small>{{ entry.sizeFormatted || (entry.isDirectory ? '文件夹' : '—') }}<template v-if="entry.updatedAt"> · {{ dateText(entry.updatedAt) }}</template></small></span>
            </button>
            <span class="file-size">{{ entry.sizeFormatted || '—' }}</span><time class="file-date">{{ dateText(entry.updatedAt,true) }}</time>
            <ChevronRight v-if="entry.isDirectory" class="row-kind" aria-hidden="true" /><Play v-else-if="entry.isVideo && !replacingSource" class="row-kind" aria-hidden="true" />
          </li>
        </ul>
        <ScrollLoad :pending="isSaving || isLoading" :more="renderLimit < visibleEntries.length" :progress="`${resource.url}:${currentFolder}:${sort}:${renderLimit}:${visibleEntries.length}`" @load="renderLimit += 60" />
        <div v-if="!visibleEntries.length" class="detail-state" role="status"><FolderOpen /><p>{{ details.videoCount ? '此文件夹为空' : '没有可播放的视频' }}</p><button type="button" @click="emit('back')">其他资源</button></div>
      </template>
      <div v-if="saveError" class="inline-feedback" role="alert"><strong>{{ saveError.title }}</strong><p>{{ saveError.message }}</p><button v-if="saveError.needsAuth" type="button" @click="emit('open-auth-settings')">前往设置</button></div>
    </div>
    <footer v-if="details && !loadError" class="detail-footer"><span>已选 {{ selectedFids.length }} 项</span><button v-if="selected.size" type="button" class="clear-selection" :disabled="isSaving" @click="selected = new Set()">清空</button><div class="detail-save-actions"><button type="button" class="save-all" :disabled="isSaving || !details.videoCount" @click="emit('save')">{{ replacingSource ? '全部替换' : '收藏全部' }}</button><button type="button" class="save-selected" :disabled="isSaving || !selectedVideoCount" @click="emit('save',selectedFids)">{{ isSaving ? '保存中…' : replacingSource ? '替换所选' : '收藏所选' }}</button></div></footer>
  </section>
</template>
<style scoped>
.resource-details { display: flex; flex: 1; min-height: 0; min-width: 0; flex-direction: column; }
button,select { min-height:44px; border: 0; color: var(--text-secondary); background: transparent; font: inherit; font-size: .8rem; }
button:disabled,input:disabled { opacity: .45; cursor: default; }
.file-open:disabled { opacity: 1; }
.breadcrumbs { display: flex; align-items: center; flex-shrink: 0; gap: 3px; overflow-x: auto; padding: 0 2px 8px; white-space: nowrap; }
.breadcrumbs button { max-width: 220px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; padding: 0 5px; }
.breadcrumbs button:last-child { color: var(--text-primary); }
.breadcrumbs svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-tertiary); }
.file-toolbar { display: flex; align-items: center; gap:8px; min-height:52px; padding:0 4px; border-bottom: 1px solid var(--divider); font-size: .75rem; color: var(--text-tertiary); }
.file-toolbar label { display: flex; align-items: center; gap:8px; min-height:44px; padding:0 4px; color:var(--text-secondary); cursor:pointer; }
input { width: 19px; height: 19px; flex-shrink: 0; accent-color: var(--liquid-accent); }
.file-toolbar select { margin-left: auto; max-width: 120px; }
.icon-button { display: grid; width:44px; flex:0 0 44px; border-radius:10px; place-items: center; }
.icon-button svg { width: 16px; height: 16px; }
.detail-content { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-top: 4px; }
.file-columns { display: grid; grid-template-columns: 1fr 95px 130px; gap: 12px; padding:10px 38px 10px 56px; color: var(--text-tertiary); font-size: .72rem; }
.file-list { list-style: none; padding: 0; margin: 0; }
.file-row { display: flex; align-items: center; gap:10px; min-height:76px; padding:8px 4px; border:1px solid transparent; border-radius:12px; }
.file-selection { display: grid; width:44px; min-height:48px; cursor:pointer; place-items: center; flex-shrink: 0; }
.file-row.selected { background:var(--surface-2); border-color:var(--divider); }
.file-open { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; padding: 0; color: var(--text-primary); text-align: left; }
.file-copy { min-width:0; flex:1; }
.file-copy strong { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: .84rem; font-weight: 500; overflow-wrap: anywhere; }
.file-copy small { display: none; color: var(--text-tertiary); font-size: .7rem; margin-top: 4px; }
.file-size { flex: 0 0 95px; font-size: .75rem; color: var(--text-tertiary); }
.file-date { flex: 0 0 130px; font-size: .75rem; color: var(--text-tertiary); }
.row-kind { width: 17px; height: 17px; flex-shrink: 0; color: var(--text-tertiary); }
.detail-state { display: grid; justify-items: center; gap: 12px; padding: 48px 16px; color: var(--text-tertiary); text-align: center; font-size: .85rem; }
.detail-state > svg { width: 28px; height: 28px; }
.detail-state button { color: var(--liquid-accent); }
.spinning { animation: spin 1s linear infinite; }
.detail-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; flex-shrink: 0; padding:12px 0 0; border-top: 1px solid var(--divider); color: var(--text-tertiary); font-size: .77rem; }
.clear-selection { color: var(--liquid-accent); }
.detail-save-actions { display: flex; gap: 8px; margin-left: auto; }
.detail-save-actions button { min-height: 44px; padding: 0 18px; border-radius:10px; }
.save-all { background: var(--surface-2); }
.save-selected { color: var(--accent-ink); background: var(--liquid-accent); font-weight: 600; }
@keyframes spin { to { transform: rotate(360deg); } }
button:focus-visible,select:focus-visible,input:focus-visible { outline:2px solid var(--text-primary); outline-offset:-2px; }
.inline-feedback { margin:12px 0; padding:14px; border:1px solid var(--divider); border-radius:12px; color:var(--text-secondary); background:var(--surface-2); }
.inline-feedback strong { color:var(--text-primary); font-size:14px; }
.inline-feedback p { margin-top:6px; font-size:13px; line-height:1.6; }
@media(hover:hover) and (pointer:fine) { .file-row:hover { background:var(--surface-2); } }
@media(max-width:640px) {
  .file-size,.file-date,.file-columns { display:none; }
  .file-copy small { display:block; }
  .file-row { gap:4px; }
  .file-open { gap:8px; }
  .file-open :deep(.resource-thumbnail) { width:44px; height:44px; flex-basis:44px; }
  .file-toolbar { gap:4px; }
  .file-toolbar select { width:76px; font-size:16px; }
  .file-toolbar>span { font-size:11px; white-space:nowrap; }
  .detail-save-actions { width:100%; }
  .detail-save-actions button { flex:1; padding:0 12px; }
  .detail-footer { gap:4px 12px; }
}
@media(prefers-reduced-motion:reduce) { .spinning { animation:none; } }
</style>
