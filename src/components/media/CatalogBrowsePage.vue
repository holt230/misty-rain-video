<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {Info} from '@lucide/vue';
import CatalogFilters from './CatalogFilters.vue';
import PosterTile from './PosterTile.vue';
import ScrollLoad from '../common/ScrollLoad.vue';
import LoadingSkeleton from '../common/LoadingSkeleton.vue';
import {browseCatalog,loadDiscovery,type DiscoveryItem} from '../../services/discoveryService';
import {browseRoute,type BrowseState} from '../../services/browseRoute';
import type {CategoryType} from '../../types/media';
const props=defineProps<{active:boolean;state:BrowseState;libraryCatalogIds:string[]}>();
const emit=defineEmits<{(e:'update:state',state:BrowseState):void;(e:'select',item:DiscoveryItem):void}>();
const items=ref<DiscoveryItem[]>([]),loading=ref(false),failure=ref(''),partial=ref(false),nextStart=ref<number|null>(null),calendarLimit=ref(30);
const key=computed(()=>browseRoute(props.state));
const dataKey=computed(()=>props.state.calendar?'calendar':key.value);
const queued=ref(false),resumeVersion=ref(0);
const inLibrary=computed(()=>new Set(props.libraryCatalogIds));
const calendarItems=computed(()=>items.value.filter(item=>item.weekday===props.state.weekday));
const visible=computed(()=>props.state.calendar?calendarItems.value.slice(0,calendarLimit.value):items.value);
const hasMore=computed(()=>props.state.calendar?calendarLimit.value<calendarItems.value.length:nextStart.value!==null);
const cache=new Map<string,{items:DiscoveryItem[];next:number|null;partial:boolean}>();
let controller:AbortController|undefined,generation=0,timer:ReturnType<typeof setTimeout>|undefined,polls=0;
const stop=()=>{generation++;controller?.abort();clearTimeout(timer);loading.value=false;queued.value=false;};
const read=async(more=false,poll=false)=>{
 if(!props.active||loading.value||more&&nextStart.value===null&&!props.state.calendar)return;
 if(props.state.calendar&&more){calendarLimit.value+=30;return;}
 const start=more?nextStart.value!:0,requestKey=dataKey.value,state=props.state;if(state.calendar&&!poll)polls=0;
 controller?.abort();const seq=++generation;controller=new AbortController();loading.value=true;failure.value='';
 try{
  if(state.calendar){
   const result=await loadDiscovery('anime',controller.signal);if(seq!==generation||!props.active)return;
   const section=result.find(item=>item.id==='calendar');items.value=section?.items||[];nextStart.value=null;partial.value=Boolean(section?.stale);
   if(section?.refreshing&&polls++<15){queued.value=true;timer=setTimeout(()=>{queued.value=false;void read(false,true);},2000);return;}
   if(section?.refreshing&&!items.value.length){failure.value='放送表暂未加载，请重试';return;}
  }else{
   const result=await browseCatalog(state.category,state.filters,state.sort,start,controller.signal);if(seq!==generation||!props.active)return;
   items.value=[...new Map([...(more?items.value:[]),...result.items].map(item=>[item.id,item])).values()];
   nextStart.value=result.nextStart!==null&&result.nextStart>start?result.nextStart:null;partial.value=result.partial;
  }
  cache.set(requestKey,{items:items.value,next:nextStart.value,partial:partial.value});if(cache.size>4)cache.delete(cache.keys().next().value!);
 }catch{if(seq===generation&&!controller.signal.aborted)failure.value='片库暂时无法加载，请重试';}
 finally{if(seq===generation)loading.value=false;}
};
watch(dataKey,()=>{
 stop();polls=0;calendarLimit.value=30;failure.value='';const saved=cache.get(dataKey.value);items.value=saved?.items||[];nextStart.value=saved?.next??null;partial.value=saved?.partial||false;
 if(props.active&&!saved){queued.value=true;timer=setTimeout(()=>{queued.value=false;void read();},180);}
},{immediate:true});
watch(()=>props.active,active=>{stop();if(active){resumeVersion.value++;if(!cache.has(dataKey.value))void read();}});
watch(()=>props.state.weekday,()=>{calendarLimit.value=30;});
onBeforeUnmount(stop);
const loadNext=()=>{void read(props.state.calendar ? !failure.value && hasMore.value : nextStart.value!==null);};
const update=(patch:Partial<BrowseState>)=>emit('update:state',{...props.state,...patch});
const category=(value:CategoryType)=>update({category:value,calendar:false});
defineExpose({refresh:()=>{stop();polls=0;return read();}});
</script>
<template><section class="catalog-browse" aria-label="片库"><h1 class="sr-only">片库</h1>
 <CatalogFilters :model-value="state.filters" :sort="state.sort" :category="state.category" :calendar="state.calendar" :weekday="state.weekday" @update:model-value="update({filters:$event})" @update:sort="update({sort:$event})" @update:category="category" @update:calendar="update({calendar:$event})" @update:weekday="update({weekday:$event})" />
 <p v-if="partial" class="browse-notice" role="status"><Info aria-hidden="true"/>部分结果暂未更新</p>
 <LoadingSkeleton v-if="(loading||queued)&&!visible.length" variant="cards" :count="9" label="正在加载片库" />
 <div v-else-if="visible.length" class="browse-grid"><PosterTile v-for="item in visible" :key="item.id" class="discovery-card" :item="item" :saved="inLibrary.has(item.id)" @select="emit('select',$event)"/></div>
 <div v-else-if="!loading&&!queued&&!failure" class="browse-empty">{{state.calendar?'当天暂无放送':'暂无匹配影片'}}</div>
 <ScrollLoad :active="active" :more="hasMore" :pending="(loading||queued)&&!!visible.length" :error="failure" skeleton="cards" :progress="`${key}:${nextStart}:${items.length}:${calendarLimit}:${resumeVersion}`" @load="loadNext" />
</section></template>
<style scoped>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.browse-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:28px 20px}.browse-empty{padding:64px 16px;text-align:center;color:var(--text-tertiary);font-size:.85rem}.browse-notice{display:flex;align-items:center;gap:8px;margin-bottom:16px;color:var(--text-tertiary);font-size:.78rem}.browse-notice svg{width:16px;height:16px}@media(max-width:640px){.browse-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:22px 10px}}</style>
