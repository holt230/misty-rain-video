<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, useId } from 'vue';
import { ChevronDown } from '@lucide/vue';
interface Option { value:string|number; label:string }
const props=defineProps<{label:string;groupLabel:string;options:Option[];selected:string|number;pinSelected?:boolean}>();
const emit=defineEmits<{(e:'select',value:string|number):void}>();
const id=useId(), row=ref<HTMLElement|null>(null), optionsElement=ref<HTMLElement|null>(null);
const expanded=ref(false), overflowing=ref(false), visibleCount=ref(Infinity);
const choices=computed(()=>{
 const selected=props.options.find(option=>option.value===props.selected);
 if(!props.pinSelected||expanded.value||!selected||selected===props.options[0])return props.options;
 return [props.options[0]!,selected,...props.options.slice(1).filter(option=>option!==selected)];
});
let observer:ResizeObserver|undefined,frame=0;
const measure=()=>{
 frame=0;const container=row.value,options=optionsElement.value;
 if(!container||!options||!container.clientWidth)return;
 const gap=parseFloat(getComputedStyle(container).columnGap)||0;
 const label=container.querySelector('.facet-label') as HTMLElement;
 const fullWidth=container.clientWidth-label.offsetWidth-gap;
 const optionGap=parseFloat(getComputedStyle(options).columnGap)||0;
 const widths=Array.from(options.querySelectorAll('button')).map(button=>button.offsetWidth);
 const total=widths.reduce((sum,width)=>sum+width,0)+Math.max(0,widths.length-1)*optionGap;
 overflowing.value=total>fullWidth+1;
 const available=fullWidth-(overflowing.value?44+gap:0);
 let used=0,count=0;
 for(const width of widths){const next=used+width+(count?optionGap:0);if(next>available+1)break;used=next;count++;}
 visibleCount.value=Math.max(1,count);
};
const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
watch([choices,()=>props.selected],()=>{void nextTick(schedule);},{flush:'post'});
onMounted(()=>{if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(schedule);if(row.value)observer.observe(row.value);}window.addEventListener('resize',schedule);schedule();});
onBeforeUnmount(()=>{observer?.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);});
</script>
<template><div ref="row" class="facet-row" :class="{'is-expanded':expanded}">
 <span class="facet-label">{{label}}</span>
 <div :id="id" ref="optionsElement" class="facet-options" role="group" :aria-label="groupLabel">
  <button v-for="(option,index) in choices" :key="option.value" type="button" :class="{'is-clipped':!expanded&&index>=visibleCount}" :tabindex="!expanded&&index>=visibleCount?-1:0" :aria-hidden="!expanded&&index>=visibleCount||undefined" :aria-pressed="selected===option.value" @click="emit('select',option.value)">{{option.label}}</button>
 </div>
 <button v-if="overflowing" class="facet-toggle" type="button" :aria-controls="id" :aria-expanded="expanded" :aria-label="`${expanded?'收起':'展开全部'}${label}`" :title="`${expanded?'收起':'展开全部'}${label}`" @click="expanded=!expanded"><ChevronDown aria-hidden="true"/></button>
</div></template>
<style scoped>
.facet-row{display:flex;align-items:flex-start;gap:14px;min-width:0}.facet-label{flex:0 0 32px;line-height:44px;color:var(--text-tertiary);font-size:.75rem}.facet-options{display:flex;flex:1;gap:4px;min-width:0;overflow:hidden}.facet-options button{flex:0 0 auto;min-height:44px;padding:0 13px;border:0;border-radius:6px;background:none;color:var(--text-secondary);font-size:.78rem;white-space:nowrap}.facet-options button[aria-pressed=true]{color:var(--text-primary);background:var(--glass-bg-active);font-weight:650}.facet-options .is-clipped{visibility:hidden;pointer-events:none}.is-expanded .facet-options{flex-wrap:wrap;overflow:visible}.facet-toggle{display:grid;place-items:center;flex:0 0 44px;width:44px;height:44px;padding:0;border:0;border-radius:6px;background:var(--glass-bg);color:var(--text-secondary)}.facet-toggle svg{width:18px;height:18px;transition:transform .18s}.is-expanded .facet-toggle svg{transform:rotate(180deg)}.facet-toggle:focus-visible,.facet-options button:focus-visible{outline:2px solid var(--liquid-accent);outline-offset:-2px}@media(hover:hover) and (pointer:fine){.facet-toggle:hover,.facet-options button:hover{background:var(--glass-bg-active);color:var(--text-primary)}}@media(max-width:640px){.facet-row{gap:8px}.facet-options{gap:0}.facet-options button{padding:0 12px}}@media(prefers-reduced-motion:reduce){.facet-toggle svg{transition:none}}
</style>
