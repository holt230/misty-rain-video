<script setup lang="ts">
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { History, Trash2, ListChecks, Check } from '@lucide/vue';
import ListSearch from '../common/ListSearch.vue';
import {useDialog} from '../../composables/useDialog';
import ScrollLoad from '../common/ScrollLoad.vue';
import MediaPoster from '../common/MediaPoster.vue';
import type { PlaybackHistoryEntry } from '../../types/media';
const props = defineProps<{ history: PlaybackHistoryEntry[]; historyError?: string; loadingHistory?: boolean; deletingHistoryId?: string; deleteSelected:(ids:string[])=>Promise<{deleted:string[];failed:string[]}> }>();
const emit = defineEmits<{ (e: 'play', entry: PlaybackHistoryEntry): void; (e: 'delete', id: string): void; (e: 'retry'): void; (e: 'discover'): void; (e:'selection-change',active:boolean):void }>();
const query=ref(''), search=ref<InstanceType<typeof ListSearch>|null>(null);
const visibleCount = ref(30);
const selecting=ref(false),selected=ref(new Set<string>()),confirmOpen=ref(false),deletingSelected=ref(false),confirmRef=ref<HTMLElement|null>(null),deleteError=ref('');
const cancelSelection=()=>{if(deletingSelected.value)return;selecting.value=false;selected.value=new Set();confirmOpen.value=false;deleteError.value='';};
const toggle=(entry:PlaybackHistoryEntry)=>{if(deletingSelected.value)return;if(!selecting.value){emit('play',entry);return;}const next=new Set(selected.value);next.has(entry.id)?next.delete(entry.id):next.add(entry.id);selected.value=next;};
const deleteSelection=async()=>{
 if(deletingSelected.value||!selected.value.size)return;deletingSelected.value=true;deleteError.value='';
 try{const result=await props.deleteSelected([...selected.value]);selected.value=new Set(result.failed);confirmOpen.value=false;if(!result.failed.length)selecting.value=false;}
 catch{deleteError.value='删除失败，请重试';}
 finally{deletingSelected.value=false;}
};
watch(selecting,value=>emit('selection-change',value));
watch(()=>props.history,items=>{const ids=new Set(items.map(item=>item.id));selected.value=new Set([...selected.value].filter(id=>ids.has(id)));});
onBeforeUnmount(()=>emit('selection-change',false));
useDialog(confirmRef,()=>confirmOpen.value,()=>{if(!deletingSelected.value)confirmOpen.value=false;});
const matches=computed(()=>props.history.filter(entry=>`${entry.media.title} ${entry.episodeTitle || ''}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
const entries = computed(() => matches.value.slice(0,visibleCount.value));
watch(query,()=>{visibleCount.value=30;selected.value=new Set();});
defineExpose({focusSearch:()=>search.value?.focus()});
const progress = (entry: PlaybackHistoryEntry) => entry.duration > 0 ? Math.max(0,Math.min(100,entry.position / entry.duration * 100)) : 0;
const meta = (entry: PlaybackHistoryEntry) => [entry.media.category === 'movie' ? '' : entry.episodeNumber ? `第 ${entry.episodeNumber} 集` : entry.episodeTitle, entry.completed ? '已看完' : `看到 ${Math.max(1,Math.floor(entry.position / 60))} 分钟`].filter(Boolean).join(' · ');
</script>
<template>
  <section class="history-page" :class="{selecting}" aria-label="观看记录">
    <div class="history-toolbar"><ListSearch ref="search" v-model="query" label="搜索观看记录" class="history-search" /><button type="button" class="select-history" :aria-label="selecting?'退出多选':'多选观看记录'" :aria-pressed="selecting" :disabled="!!deletingHistoryId || !matches.length && !selecting" @click="selecting?cancelSelection():selecting=true"><ListChecks aria-hidden="true"/></button></div>
    <div v-if="historyError" class="inline-feedback" role="alert"><p>{{ historyError }}</p><button type="button" :disabled="loadingHistory" @click="emit('retry')">重试</button></div>
    <LoadingSkeleton v-else-if="loadingHistory && !history.length" variant="cards" :count="6" label="正在读取观看记录" />
    <div v-if="entries.length" class="history-list">
      <article v-for="entry in entries" :key="entry.id" class="history-row">
        <button type="button" class="history-main" :role="selecting?'checkbox':undefined" :aria-checked="selecting?selected.has(entry.id):undefined" :aria-label="`${selecting?'选择':entry.completed ? '重新播放' : '继续观看'}《${entry.media.title}》，${meta(entry)}`" @click="toggle(entry)">
          <span class="history-poster" :class="{selected:selecting&&selected.has(entry.id)}"><span v-if="selecting" class="selection-check" :class="{checked:selected.has(entry.id)}"><Check v-if="selected.has(entry.id)" aria-hidden="true"/></span><MediaPoster :src="entry.media.poster" :catalog-id="entry.media.catalogId" alt="" /><span v-if="entry.duration > 0" class="history-progress" aria-hidden="true"><i :style="{ width: `${progress(entry)}%` }"></i></span></span>
          <span class="history-copy"><strong :title="entry.media.title">{{ entry.media.title }}</strong><small :title="meta(entry)">{{ meta(entry) }}</small></span>
        </button>
        <button v-if="!selecting" type="button" class="history-delete" :disabled="!!deletingHistoryId" :aria-label="`删除${entry.media.title}的播放记录`" :title="`删除《${entry.media.title}》的播放记录`" @click="emit('delete',entry.id)"><Trash2 aria-hidden="true" /></button>
      </article>
    </div>
    <ScrollLoad :more="matches.length > entries.length" :progress="`${query}:${visibleCount}:${matches.length}`" @load="visibleCount += 30" />
    <p v-if="query && !matches.length" class="history-empty">没有匹配的观看记录</p>
    <div v-if="!query && !history.length && !loadingHistory && !historyError" class="history-empty"><History aria-hidden="true" /><p>还没有观看记录</p><button type="button" @click="emit('discover')">浏览推荐</button></div>
    <Teleport to="body">
      <div v-if="selecting" class="history-batch-bar" role="group" aria-label="批量操作"><button type="button" :disabled="deletingSelected" @click="cancelSelection">取消</button><button type="button" class="batch-delete" :disabled="!selected.size || deletingSelected" @click="confirmOpen=true">删除<span v-if="selected.size">（{{selected.size}}）</span></button></div>
      <div v-if="confirmOpen" ref="confirmRef" class="history-confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-confirm-title" @click.self="!deletingSelected && (confirmOpen=false)"><section class="history-confirm"><h2 id="history-confirm-title">{{deletingSelected?'正在删除…':`删除选中的 ${selected.size} 条记录？`}}</h2><p v-if="deleteError" role="alert">{{deleteError}}</p><div><button type="button" :disabled="deletingSelected" @click="confirmOpen=false">取消</button><button type="button" class="batch-delete" :disabled="deletingSelected" @click="deleteSelection">{{deletingSelected?'删除中…':'删除'}}</button></div></section></div>
    </Teleport>
  </section>
</template>
<style scoped>
.history-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:24px}.history-search{flex:1;min-width:0}.select-history{display:grid;place-items:center;flex:0 0 44px;width:44px;height:44px;padding:0;border:0;border-radius:7px;background:none;color:var(--text-secondary)}.select-history svg{width:21px;height:21px}.select-history[aria-pressed=true]{background:var(--surface-2);color:var(--text-primary)}.history-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:28px 20px}.history-row{position:relative;min-width:0}.history-main{display:grid;width:100%;min-width:0;gap:8px;padding:0;border:0;border-radius:7px;color:var(--text-primary);background:none;text-align:left}.history-poster{position:relative;display:block;aspect-ratio:2/3;overflow:hidden;border-radius:7px;background:var(--surface-2);outline:2px solid transparent;outline-offset:3px;transition:transform .2s ease,outline-color .2s ease}.history-poster :deep(img){display:block;width:100%;height:100%;object-fit:cover}.history-copy{display:grid;min-width:0;gap:3px}.history-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.83rem;font-weight:550}.history-copy small{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:.7rem;color:var(--text-tertiary)}.history-progress{position:absolute;inset:auto 0 0;height:3px;background:#ffffff50}.history-progress i{display:block;height:100%;background:#fff}.history-delete{position:absolute;top:0;right:0;display:grid;width:44px;height:44px;place-items:center;border:0;border-radius:50%;background:radial-gradient(circle,#0009 0,#0009 45%,transparent 47%);color:#fff}.history-delete svg{width:16px;height:16px}.history-main:focus-visible{outline:0}.history-main:focus-visible .history-poster{outline-color:var(--text-primary)}.history-empty{display:grid;justify-items:center;gap:16px;padding:64px 16px;color:var(--text-tertiary);font-size:.86rem}.history-empty>svg{width:36px;height:36px}.history-empty button,.inline-feedback button{min-height:44px;padding:0 16px;border:0;border-radius:7px;color:var(--text-primary);background:var(--surface-2)}.inline-feedback{display:flex;align-items:center;gap:12px;margin-bottom:20px}@media(hover:hover) and (pointer:fine){.history-main:hover .history-poster{transform:scale(1.025);outline-color:var(--text-primary)}}@media(max-width:640px){.history-list{grid-template-columns:repeat(3,minmax(0,1fr));gap:22px 10px}.history-copy strong{font-size:.74rem}.history-copy small{font-size:.64rem}.history-toolbar{margin-bottom:20px}}@media(prefers-reduced-motion:reduce){.history-poster{transition:none}.history-main:hover .history-poster{transform:none}}
.history-delete{cursor:pointer;transition:opacity .15s,background .15s,color .15s}.history-delete:hover,.history-delete:active{background:var(--danger-action);color:#fff}.history-delete:active{background:var(--danger-action-active)}.history-delete:focus-visible{outline:2px solid var(--danger);outline-offset:2px}
@media(hover:hover) and (pointer:fine){.history-delete{opacity:0;pointer-events:none}.history-row:hover .history-delete,.history-row:focus-within .history-delete{opacity:1;pointer-events:auto}}
.selecting{padding-bottom:80px}.selection-check{position:absolute;z-index:2;top:8px;right:8px;width:24px;height:24px;border:1.5px solid #fff;border-radius:50%;background:#0007;display:grid;place-items:center}.selection-check.checked{color:var(--accent-ink);background:var(--liquid-accent);border-color:var(--liquid-accent)}.selection-check svg{width:16px;height:16px}.history-poster.selected{outline-color:var(--liquid-accent)}
.history-batch-bar{position:fixed;z-index:1300;bottom:0;left:0;right:0;display:flex;justify-content:center;gap:12px;padding:12px 16px calc(12px + var(--safe-area-bottom));background:var(--nav-background);border-top:1px solid var(--divider)}.history-batch-bar button,.history-confirm button{width:160px;min-height:44px;padding:0 16px;border:0;border-radius:7px;background:var(--surface-2);color:var(--text-primary);font:inherit;cursor:pointer}.history-batch-bar .batch-delete,.history-confirm .batch-delete{background:var(--danger-action);color:#fff}.history-confirm-backdrop{position:fixed;inset:0;z-index:1800;display:grid;place-items:center;padding:20px;background:var(--dialog-backdrop)}.history-confirm{width:min(360px,100%);padding:24px;border:1px solid var(--divider);border-radius:14px;background:var(--surface-elevated)}.history-confirm h2{font-size:17px;font-weight:600}.history-confirm>div{display:flex;gap:10px;margin-top:24px}.history-confirm button{flex:1;width:auto}.history-confirm p{color:var(--danger);font-size:13px;margin-top:12px}
.batch-delete:hover:not(:disabled){background:var(--danger-action-hover)}.batch-delete:active:not(:disabled){background:var(--danger-action-active)}</style>
