<script setup lang="ts">
import {ref} from 'vue';
import {Search,X} from '@lucide/vue';
defineProps<{modelValue:string;label:string}>();
const emit=defineEmits<{(e:'update:modelValue',value:string):void}>();
const input=ref<HTMLInputElement|null>(null);
defineExpose({focus:()=>{input.value?.scrollIntoView({block:'center',behavior:'instant'});input.value?.focus({preventScroll:true});}});
</script>
<template><div class="list-search" role="search"><Search aria-hidden="true"/><input ref="input" type="search" :value="modelValue" :aria-label="label" :placeholder="label" @input="emit('update:modelValue',($event.target as HTMLInputElement).value)"/><button v-if="modelValue" type="button" aria-label="清空搜索" @click="emit('update:modelValue','');input?.focus()"><X aria-hidden="true"/></button></div></template>
<style scoped>.list-search{display:flex;align-items:center;gap:10px;min-height:44px;min-width:0;max-width:480px;border:1px solid var(--divider);border-radius:7px;padding-left:13px;background:var(--surface-1)}.list-search>svg{width:18px;height:18px;flex-shrink:0;color:var(--text-tertiary)}input{width:100%;min-width:0;min-height:44px;padding:0 10px 0 0;border:0;background:none;color:var(--text-primary);font-size:16px;outline:none}input::-webkit-search-cancel-button{display:none}input:focus-visible{outline:none;box-shadow:none}button{display:grid;place-items:center;flex:0 0 44px;height:44px;border:0;background:none;color:var(--text-secondary)}button svg{width:18px;height:18px}</style>
