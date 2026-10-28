<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref} from 'vue';
import {ArrowUp} from '@lucide/vue';
defineProps<{enabled:boolean}>();
const visible=ref(false);
const update=()=>{visible.value=window.scrollY>Math.max(400,window.innerHeight*.7);};
const top=()=>window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
onMounted(()=>{window.addEventListener('scroll',update,{passive:true});update();});
onBeforeUnmount(()=>window.removeEventListener('scroll',update));
</script>
<template><Transition name="to-top"><button v-if="enabled&&visible" class="back-to-top" type="button" aria-label="回到顶部" title="回到顶部" @click="top"><ArrowUp aria-hidden="true"/></button></Transition></template>
<style scoped>
.back-to-top{position:fixed;z-index:1100;right:max(20px,var(--safe-area-right));bottom:24px;display:grid;place-items:center;width:44px;height:44px;padding:0;border:1px solid var(--divider);border-radius:50%;background:var(--surface-elevated);color:var(--text-primary);box-shadow:0 4px 16px #0002;cursor:pointer}.back-to-top svg{width:20px;height:20px}.back-to-top:hover{background:var(--surface-2)}.to-top-enter-active,.to-top-leave-active{transition:opacity .18s,transform .18s}.to-top-enter-from,.to-top-leave-to{opacity:0;transform:translateY(6px)}@media(max-width:1023px){.back-to-top{bottom:calc(86px + var(--safe-area-bottom));right:16px}}@media(prefers-reduced-motion:reduce){.to-top-enter-active,.to-top-leave-active{transition:none}}
</style>
