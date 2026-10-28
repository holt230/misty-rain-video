<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RefreshCw } from '@lucide/vue';

const props=defineProps<{enabled:boolean;pageKey:string;refresh:()=>Promise<unknown>}>();
const emit=defineEmits<{(event:'error'):void}>();
const distance=ref(0),refreshing=ref(false);
const threshold=56;
const label=computed(()=>refreshing.value?'正在刷新':distance.value>=threshold?'松开刷新':'下拉刷新');
let gesture:{x:number;y:number;captured:boolean}|undefined;
let generation=0,suppressClickUntil=0;
const resetGesture=()=>{gesture=undefined;distance.value=0;};
const atTop=()=>Math.max(window.scrollY,document.documentElement.scrollTop,document.body.scrollTop)<=1;
const eligible=(target:EventTarget|null)=>{
  if(!(target instanceof HTMLElement) || !target.closest('.content-pages'))return false;
  if(target.closest('input,textarea,select,video,[contenteditable="true"],[role="dialog"],[role="slider"]'))return false;
  if(document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))return false;
  // Inner scrollers own their gestures, even at their own leading edge.
  for(let node:HTMLElement|null=target;node&&node!==document.body;node=node.parentElement){
    const style=getComputedStyle(node);
    if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+1 || /auto|scroll/.test(style.overflowX)&&node.scrollWidth>node.clientWidth+1)return false;
  }
  return true;
};
const start=(event:TouchEvent)=>{
  if(refreshing.value)return;
  resetGesture();
  if(!props.enabled||refreshing.value||event.touches.length!==1||!atTop()||!window.matchMedia('(max-width:1023px)').matches||(window.visualViewport?.scale||1)>1.01||!eligible(event.target))return;
  const touch=event.touches[0]!;
  if(touch.clientX<20||touch.clientX>window.innerWidth-20)return;
  gesture={x:touch.clientX,y:touch.clientY,captured:false};
};
const move=(event:TouchEvent)=>{
  if(!gesture)return;
  if(!props.enabled||refreshing.value||event.touches.length!==1||!atTop()){resetGesture();return;}
  const touch=event.touches[0]!,dx=Math.abs(touch.clientX-gesture.x),dy=touch.clientY-gesture.y;
  if(!gesture.captured){
    if(dy< -8 || dx>10&&dx>dy){resetGesture();return;}
    if(dy<10||dy<dx*1.25)return;
    if(!event.cancelable){resetGesture();return;}
    gesture.captured=true;
  }
  event.preventDefault();
  distance.value=Math.min(80,Math.max(0,(dy-8)*.5));
};
const finish=async()=>{
  if(refreshing.value)return;
  const captured=gesture?.captured,ready=!!captured&&distance.value>=threshold&&props.enabled;
  if(captured)suppressClickUntil=Date.now()+400;
  gesture=undefined;
  if(!ready){distance.value=0;return;}
  const current=++generation;refreshing.value=true;distance.value=threshold;
  try { await props.refresh(); }
  catch { if(current===generation)emit('error'); }
  finally { if(current===generation){refreshing.value=false;distance.value=0;} }
};
const cancel=()=>{if(refreshing.value)return;if(gesture?.captured)suppressClickUntil=Date.now()+400;resetGesture();};
const click=(event:MouseEvent)=>{
  if(event.detail>0&&Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}
};
watch(()=>props.enabled,enabled=>{if(!enabled&&!refreshing.value)resetGesture();});
watch(()=>props.pageKey,()=>{generation++;refreshing.value=false;resetGesture();});
onMounted(()=>{
  document.addEventListener('touchstart',start,{passive:true});
  document.addEventListener('touchmove',move,{passive:false});
  document.addEventListener('touchend',finish);
  document.addEventListener('touchcancel',cancel);
  document.addEventListener('click',click,true);
});
onBeforeUnmount(()=>{
  generation++;document.removeEventListener('touchstart',start);document.removeEventListener('touchmove',move);
  document.removeEventListener('touchend',finish);document.removeEventListener('touchcancel',cancel);document.removeEventListener('click',click,true);
});
</script>
<template>
  <div v-show="distance>0||refreshing" class="pull-refresh" :class="{refreshing}" :data-state="refreshing?'refreshing':distance>=threshold?'ready':'pulling'" :style="{transform:`translate(-50%,${distance}px)`}" role="status" :aria-label="label">
    <RefreshCw :style="refreshing?undefined:{transform:`rotate(${distance/threshold*280}deg)`}" aria-hidden="true" />
  </div>
</template>
<style scoped>
.pull-refresh{position:fixed;z-index:1200;top:calc(var(--app-header-height) - 36px);left:50%;display:grid;place-items:center;width:36px;height:36px;border:1px solid var(--divider);border-radius:50%;color:var(--text-primary);background:var(--surface-elevated);box-shadow:0 3px 12px #0002;pointer-events:none}
.pull-refresh svg{width:18px;height:18px}.refreshing svg{animation:pull-spin .8s linear infinite}
@keyframes pull-spin{to{transform:rotate(360deg)}}
@media(min-width:1024px){.pull-refresh{display:none!important}}
@media(prefers-reduced-motion:reduce){.refreshing svg{animation-duration:1.6s}}
</style>
