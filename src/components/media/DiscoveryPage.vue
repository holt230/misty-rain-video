<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {RefreshCw,Search,SlidersHorizontal,ChevronRight} from '@lucide/vue';
import FeaturedSpotlight from './FeaturedSpotlight.vue';
import ContinueWatching from './ContinueWatching.vue';
import MediaRail from './MediaRail.vue';
import PosterTile from './PosterTile.vue';
import type {PlaybackHistoryEntry,CategoryType} from '../../types/media';
import {loadDiscovery,browseCatalog,type DiscoveryItem,type DiscoverySection} from '../../services/discoveryService';
const props=defineProps<{active:boolean;libraryCatalogIds:string[];history?:PlaybackHistoryEntry[]}>();
const emit=defineEmits<{(e:'select',item:DiscoveryItem):void;(e:'search'):void;(e:'continue',entry:PlaybackHistoryEntry):void;(e:'immersive-change',value:boolean):void;(e:'browse',preset:{category:CategoryType;country?:string}):void}>();
const sections=ref<DiscoverySection[]>([]),loading=ref(false),failure=ref('');
const usItems=ref<DiscoveryItem[]>([]),usLoading=ref(false),usError=ref('');
let controller:AbortController|undefined,usController:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined,generation=0,usGeneration=0,polls=0,usUpdated=0;
const stop=()=>{generation++;controller?.abort();clearTimeout(timer);loading.value=false;};
const read=async(poll=false)=>{
 if(!props.active)return;if(!poll){stop();polls=0;}const seq=++generation;controller=new AbortController();loading.value=true;failure.value='';
 try{const result=await loadDiscovery('all',controller.signal);if(seq!==generation||!props.active)return;sections.value=result;
  if(result.some(section=>section.refreshing)&&polls++<15)timer=setTimeout(()=>{void read(true);},2000);
 }catch{if(seq===generation){failure.value='推荐暂时无法加载';sections.value=sections.value.map(section=>({...section,refreshing:false}));}}finally{if(seq===generation)loading.value=false;}
};
const readUS=async()=>{
 if(!props.active||usLoading.value)return;const seq=++usGeneration;usController=new AbortController();usLoading.value=true;usError.value='';
 try{const result=await browseCatalog('tv',{genre:'',country:'美国',year:''},'popularity',0,usController.signal);if(seq!==usGeneration||!props.active)return;usItems.value=result.items;usUpdated=Date.now();}
 catch{if(seq===usGeneration)usError.value='美剧暂时无法加载';}finally{if(seq===usGeneration)usLoading.value=false;}
};
watch(()=>props.active,active=>{stop();usGeneration++;usController?.abort();usLoading.value=false;if(active){void read();if(!usItems.value.length||Date.now()-usUpdated>300_000)void readUS();}},{immediate:true});
onBeforeUnmount(()=>{stop();usGeneration++;usController?.abort();});
const pending=computed(()=>loading.value||sections.value.some(section=>section.refreshing));
// Interleave the existing shelves; a large TV list must not crowd out other categories.
const featured=computed(()=>{
 const queues=sections.value.filter(section=>section.id!=='calendar').map(section=>section.items.filter(item=>item.poster));
 const chosen=new Map<string,DiscoveryItem>();
 for(let row=0;row<Math.max(0,...queues.map(queue=>queue.length))&&chosen.size<10;row++){
  for(const queue of queues){const item=queue[row];if(item&&!chosen.has(item.id))chosen.set(item.id,item);if(chosen.size===10)break;}
 }
 return [...chosen.values()];
});
const immersive=computed(()=>featured.value.length>0||pending.value);
watch(immersive,value=>emit('immersive-change',value),{immediate:true});
const names={tv:'电视剧',movie:'电影',anime:'动漫',variety:'综艺'};
const shelves=computed(()=>{
 const rows=sections.value.filter(section=>section.id!=='calendar').map(section=>({id:section.id,category:section.category,title:section.id==='tv'?'近期热剧':section.title,items:section.items.slice(0,10),loading:section.refreshing,error:section.failed?'暂时无法加载':'',country:''}));
 const us={id:'us-tv',category:'tv' as CategoryType,title:'热门美剧',items:usItems.value.slice(0,10),loading:usLoading.value,error:usError.value,country:'美国'};
 rows.splice(Math.max(0,rows.findIndex(row=>row.id==='tv')+1),0,us);return rows;
});
const continuing=computed(()=>(props.history||[]).filter(entry=>!entry.completed&&entry.position>0).slice(0,8));
defineExpose({refresh:()=>Promise.all([read(),readUS()])});
</script>
<template><div class="discovery-page" :class="{'has-feature':immersive}"><h1 class="sr-only">发现</h1>
 <FeaturedSpotlight v-if="featured.length" :items="featured" :active="active" :saved-ids="libraryCatalogIds" @select="emit('select',$event)"/>
 <div v-else-if="pending" class="featured-skeleton" role="status" aria-label="正在加载推荐"></div>
 <div v-if="failure" class="discovery-feedback" role="alert"><span>{{failure}}</span><button type="button" aria-label="重试推荐" @click="read()"><RefreshCw/></button><button type="button" aria-label="搜索片名" @click="emit('search')"><Search/></button></div>
 <ContinueWatching v-if="continuing.length" :entries="continuing" @play="emit('continue',$event)"/>
 <section v-for="section in shelves" :key="section.id" class="discovery-section">
  <MediaRail :aria-busy="section.loading || undefined" :title="section.title" :item-count="section.items.length" :more-label="`查看更多${section.id==='us-tv'?'美剧':names[section.category]}`" @more="emit('browse',{category:section.category,country:section.country})">
   <PosterTile v-for="item in section.items" :key="item.id" class="discovery-card" :item="item" :saved="libraryCatalogIds.includes(item.id)" @select="emit('select',$event)"/>
   <template v-if="!section.items.length&&section.loading"><span v-for="n in 6" :key="`loading-${n}`" class="rail-skeleton" aria-hidden="true"></span></template>
  </MediaRail>
  <div v-if="section.error&&!section.items.length&&!section.loading" class="discovery-feedback" role="alert"><span>{{section.error}}</span><button type="button" :aria-label="`重试${section.title}`" @click="section.id==='us-tv'?readUS():read()"><RefreshCw/></button></div>
 </section>
 <footer class="discovery-footer"><button type="button" aria-label="进入片库筛选" @click="emit('browse',{category:'tv'})"><SlidersHorizontal aria-hidden="true"/><span>浏览片库</span><ChevronRight aria-hidden="true"/></button></footer>
</div></template>
<style scoped>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.discovery-page{--browse-gutter:var(--content-gutter,48px);position:relative;padding:calc(var(--app-header-height) + 24px) var(--browse-gutter) 0}.has-feature{padding-top:0}.has-feature :deep(.featured-spotlight),.featured-skeleton{width:calc(100% + 2 * var(--browse-gutter));margin-left:calc(-1 * var(--browse-gutter))}.discovery-section{margin-bottom:44px;min-width:0}.featured-skeleton{height:clamp(560px,44vw,720px);margin-bottom:24px;background:#17191d;animation:home-loading 1.5s ease-in-out infinite}.rail-skeleton{display:block;aspect-ratio:2/3;border-radius:7px;background:var(--surface-2);animation:home-loading 1.5s ease-in-out infinite}.discovery-feedback{display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--text-secondary);font-size:.8rem}.discovery-feedback button{display:grid;width:44px;height:44px;place-items:center;border:0;border-radius:6px;color:var(--text-primary);background:var(--surface-2)}.discovery-feedback svg{width:18px;height:18px}@keyframes home-loading{50%{opacity:.45}}@media(max-width:640px){.discovery-section{margin-bottom:30px}.featured-skeleton{height:clamp(520px,72svh,620px)}}@media(prefers-reduced-motion:reduce){.featured-skeleton,.rail-skeleton{animation:none}}.discovery-footer{display:flex;justify-content:center;margin:12px 0 32px;padding-top:20px;border-top:1px solid var(--divider)}.discovery-footer button{display:flex;align-items:center;justify-content:center;gap:10px;width:min(100%,360px);min-height:52px;padding:0 20px;border:0;border-radius:8px;color:var(--text-primary);background:var(--surface-2);font:inherit;font-size:.9rem;cursor:pointer}.discovery-footer svg{width:18px;height:18px}.discovery-footer button:hover{background:var(--glass-bg-active)}</style>
