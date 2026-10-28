<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowLeft, Search, ChevronDown } from '@lucide/vue';
import ScrollLoad from '../common/ScrollLoad.vue';
import PosterTile from './PosterTile.vue';
import { searchCatalog, type DiscoveryItem } from '../../services/discoveryService';
import { catalogSortOptions, catalogSortDescription, sortCatalogItems, type CatalogSort } from '../../services/catalogSort';
const sort = ref<CatalogSort>('recommended');
const props = defineProps<{ query: string; active: boolean; libraryCatalogIds: string[] }>();
const emit = defineEmits<{ (e: 'select', item: DiscoveryItem): void; (e: 'search-resources', query: string): void; (e: 'back'): void }>();
const items = ref<DiscoveryItem[]>([]), loading = ref(false), error = ref(''), partial = ref(false);
const limit=ref(30);
const visibleItems = computed(() => sortCatalogItems(items.value, sort.value).slice(0,limit.value));
watch([()=>props.query,sort],()=>{limit.value=30;});
let controller: AbortController | undefined, sequence = 0, loadedQuery = '';
const search = async () => {
  controller?.abort(); const seq = ++sequence;
  if (!props.query) return;
  controller = new AbortController(); loading.value = true; error.value = ''; partial.value = false; items.value = [];
  try {
    const result = await searchCatalog(props.query, controller.signal);
    if (seq !== sequence) return;
    items.value = result.items; partial.value = result.partial; loadedQuery = result.partial ? '' : props.query;
  } catch { if (seq === sequence) error.value = '影片信息暂时无法加载'; }
  finally { if (seq === sequence) loading.value = false; }
};
watch([() => props.query, () => props.active], ([query, active]) => {
  if (active && query && query !== loadedQuery) void search();
  if (!active && loading.value) { controller?.abort(); sequence++; loading.value = false; }
}, { immediate: true });
onBeforeUnmount(() => { controller?.abort(); sequence++; });
defineExpose({refresh:search});
</script>
<template>
  <section class="catalog-search" aria-label="影片搜索结果">
    <header class="catalog-heading"><button type="button" class="back" aria-label="返回上一页" title="返回上一页" @click="emit('back')"><ArrowLeft aria-hidden="true" /></button><h1 :title="query">{{ query }}</h1><span v-if="!loading && items.length">{{ items.length }} 部影片</span><label v-if="items.length" class="catalog-sort"><select v-model="sort" aria-label="影片排序" :title="catalogSortDescription[sort]"><option v-for="option in catalogSortOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select><ChevronDown aria-hidden="true" /></label></header>
    <p v-if="!loading && partial" class="catalog-notice" role="status">豆瓣暂时返回了部分结果<button type="button" @click="search">重试</button></p>
    <div v-if="loading" class="catalog-grid" role="status" aria-label="正在搜索影片"><div v-for="n in 6" :key="n" class="skeleton"></div></div>
    <div v-else-if="items.length" class="catalog-grid">
      <PosterTile v-for="item in visibleItems" :key="item.id" :item="item" :saved="libraryCatalogIds.includes(item.id)" show-year class="catalog-card" @select="emit('select', $event)" />
      <ScrollLoad :active="active" :more="limit < items.length" :progress="`${query}:${sort}:${limit}`" @load="limit += 30" />
    </div>
    <div v-else-if="!loading" class="catalog-empty" :role="error ? 'alert' : 'status'"><Search aria-hidden="true" /><p>{{ error || '没有找到匹配的影片' }}</p><button v-if="error" type="button" @click="search">重新加载</button></div>
    <footer v-if="!loading" class="catalog-fallback"><button type="button" @click="emit('search-resources', query)"><Search aria-hidden="true" />直接搜索资源</button><small v-if="items.length">资料来自豆瓣</small></footer>
  </section>
</template>
<style scoped>
.catalog-heading { display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:24px; }
.catalog-heading h1 { min-width:0; max-width:min(600px,calc(100% - 60px)); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:clamp(1.6rem,3vw,2.4rem); font-weight:700; letter-spacing:-.03em; }
.catalog-heading > span { color:var(--text-tertiary); font-size:.76rem; }
.back { display:grid; width:44px; height:44px; flex-shrink:0; place-items:center; padding:0; border:0; border-radius:50%; color:var(--text-secondary); background:var(--surface-2); cursor:pointer; }
.back svg { width:20px; height:20px; }
.catalog-sort { position:relative;display:block;margin-left:auto; }
.catalog-sort>svg{position:absolute;right:12px;top:50%;width:16px;height:16px;transform:translateY(-50%);pointer-events:none;color:var(--text-secondary)}
.catalog-sort select { min-height:44px; max-width:100%; appearance:none;-webkit-appearance:none;min-width:124px;padding:0 36px 0 14px; border:1px solid var(--divider); border-radius:7px; color:var(--text-secondary); background:var(--surface-2); font:inherit; font-size:.8rem; }
.catalog-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:32px 22px; }
.skeleton { width:100%; aspect-ratio:2/3; border-radius:8px; background:var(--surface-2); animation:breathe 1.6s ease-in-out infinite; }
.catalog-notice { display:flex; align-items:center; flex-wrap:wrap; gap:8px; color:var(--text-tertiary); font-size:.8rem; margin:0 0 20px; }
.catalog-notice button { min-height:44px; padding:0 12px; border:0; background:transparent; color:var(--liquid-accent); cursor:pointer; }
.catalog-empty { display:grid; justify-items:center; gap:16px; padding:64px 16px 24px; color:var(--text-tertiary); font-size:.88rem; }
.catalog-empty > svg { width:32px; height:32px; stroke-width:1.5; }
.catalog-empty button,.catalog-fallback button { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:44px; padding:0 16px; border:0; border-radius:7px; color:var(--text-primary); background:var(--surface-2); cursor:pointer; }
.catalog-fallback { display:flex; align-items:center; flex-wrap:wrap; gap:12px; padding:28px 0; font-size:.82rem; }
.catalog-fallback svg { width:17px; height:17px; }
.catalog-fallback small { margin-left:auto; color:var(--text-tertiary); font-size:.68rem; }
@keyframes breathe { 50% { opacity:.5; } }
@media(max-width:640px) { .catalog-grid { grid-template-columns:repeat(3,minmax(0,1fr)); gap:22px 10px; } .catalog-heading { gap:8px; margin-bottom:20px; } .catalog-heading > span { margin-left:52px; } .catalog-sort select { font-size:.8rem; } }
@media(prefers-reduced-motion:reduce) { .skeleton { animation:none; } }
</style>
