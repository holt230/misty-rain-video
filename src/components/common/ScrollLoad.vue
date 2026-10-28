<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
const props = withDefaults(defineProps<{ more: boolean; pending?: boolean; error?: string; active?: boolean; progress: string | number; skeleton?:'rows'|'cards'|'text'; horizontal?:boolean }>(), { active:true, skeleton:'rows' });
const emit = defineEmits<{ (e:'load'):void }>();
const sentinel = ref<HTMLElement|null>(null);
let observer:IntersectionObserver|undefined, frame=0, lastProgress:string|number|undefined;
let mounted=false;
const check=()=>{
  frame=0;
  if(!mounted || !props.active || !props.more || props.pending || props.error || document.visibilityState==='hidden') return;
  const el=sentinel.value;
  if(!el || !el.getClientRects().length) return;
  const rect=el.getBoundingClientRect();
  if(rect.bottom<0 || rect.top>window.innerHeight+240 || rect.width===0) return;
  if(props.horizontal && (rect.right<0 || rect.left>window.innerWidth+240)) return;
  // Nested episode/resource/photo scrollers must reach their own end as well.
  for(let parent=el.parentElement;parent && parent!==document.body;parent=parent.parentElement){
    const style=window.getComputedStyle(parent);
    if(/auto|scroll|hidden|clip/.test(style.overflowY)){
      const boundary=parent.getBoundingClientRect();
      if(rect.top>boundary.bottom+240 || rect.bottom<boundary.top) return;
    }
    if(props.horizontal && /auto|scroll|hidden|clip/.test(style.overflowX)){
      const boundary=parent.getBoundingClientRect();
      if(rect.left>boundary.right+120 || rect.right<boundary.left) return;
    }
  }
  // One request per cursor/result generation, including a page that returns no new items.
  if(lastProgress===props.progress) return;
  lastProgress=props.progress; emit('load');
};
const schedule=()=>{if(mounted && !frame)frame=requestAnimationFrame(check);};
const retry=()=>{if(props.pending)return;lastProgress=props.progress;emit('load');};
watch(()=>[props.progress,props.pending,props.more,props.active,props.error],()=>{void nextTick(schedule);},{flush:'post'});
onMounted(()=>{
  mounted=true;
  if(typeof IntersectionObserver!=='undefined'){
    observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))schedule();},{rootMargin:'240px'});
    if(sentinel.value)observer.observe(sentinel.value);
  }
  if(props.horizontal || typeof IntersectionObserver==='undefined')window.addEventListener('scroll',schedule,true);
  window.addEventListener('resize',schedule);document.addEventListener('visibilitychange',schedule);schedule();
});
onBeforeUnmount(()=>{mounted=false;observer?.disconnect();cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);document.removeEventListener('visibilitychange',schedule);});
</script>
<template><div ref="sentinel" class="scroll-load" :class="{'is-horizontal':horizontal,'has-feedback':pending||error}" :aria-busy="pending || undefined"><LoadingSkeleton v-if="pending" :variant="skeleton" :count="horizontal?1:3" label="正在加载更多内容" /><template v-if="error"><span role="alert">{{ error }}</span><button type="button" @click="retry">重试</button></template></div></template>
<style scoped>.scroll-load{display:flex;min-height:2px;align-items:center;justify-content:center;gap:12px;grid-column:1 / -1;color:var(--text-tertiary);font-size:.78rem}.scroll-load:has(span){min-height:48px;margin-top:12px}.scroll-load button{min-height:44px;padding:0 14px;border:0;border-radius:7px;background:var(--surface-2);color:var(--text-primary)}</style>
<style scoped>.scroll-load.is-horizontal{flex:0 0 2px;min-width:2px;align-self:stretch;margin:0}.scroll-load.is-horizontal.has-feedback{flex-basis:var(--rail-item-width);flex-direction:column;align-self:flex-start;min-height:100px}.is-horizontal :deep(.skeleton-cards){display:block;padding:0}.is-horizontal :deep(.skeleton-cover){aspect-ratio:var(--scroll-load-aspect-ratio,1.6)}.is-horizontal :deep(.skeleton-description){display:none}</style>
