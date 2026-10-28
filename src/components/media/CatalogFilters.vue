<script setup lang="ts">
import { CATALOG_GENRES, CATALOG_COUNTRIES, catalogYears, type CatalogFilters } from '../../../server/catalogFacets.js';
import type {CategoryType} from '../../types/media';
import type { CatalogSort } from '../../services/catalogSort';
import CatalogFacetRow from './CatalogFacetRow.vue';
defineProps<{modelValue:CatalogFilters;sort:CatalogSort;active?:boolean;category?:CategoryType;calendar?:boolean;weekday?:number}>();
const emit=defineEmits<{(e:'update:modelValue',value:CatalogFilters):void;(e:'update:sort',value:CatalogSort):void;(e:'update:category',value:CategoryType):void;(e:'update:calendar',value:boolean):void;(e:'update:weekday',value:number):void}>();
const categories=[{value:'tv',label:'电视剧'},{value:'movie',label:'电影'},{value:'anime',label:'动漫'},{value:'variety',label:'综艺'}];
const rows:Array<{key:keyof CatalogFilters;label:string;values:string[]}>= [{key:'genre',label:'类型',values:CATALOG_GENRES},{key:'country',label:'地区',values:CATALOG_COUNTRIES},{key:'year',label:'年份',values:catalogYears()}];
const options=(values:string[])=>[{value:'',label:'全部'},...values.map(value=>({value,label:value}))];
const sorts=[{value:'popularity',label:'热门'},{value:'time',label:'最新'},{value:'rating',label:'评分'}];
const charts=[{value:'hot',label:'热门'},{value:'calendar',label:'放送表'}];
const weekdays=['一','二','三','四','五','六','日'].map((day,index)=>({value:index+1,label:`周${day}`}));
</script>
<template><section class="catalog-filters" aria-label="影片筛选">
 <CatalogFacetRow v-if="category" label="分类" group-label="片库分类" :options="categories" :selected="category" @select="emit('update:category',$event as CategoryType)"/>
 <CatalogFacetRow v-if="category==='anime'" label="榜单" group-label="动漫榜单" :options="charts" :selected="calendar?'calendar':'hot'" @select="emit('update:calendar',$event==='calendar')"/>
 <CatalogFacetRow v-if="calendar" label="日期" group-label="放送日期" :options="weekdays" :selected="weekday||1" @select="emit('update:weekday',Number($event))"/>
 <CatalogFacetRow v-for="row in calendar?[]:rows" :key="row.key" :label="row.label" :group-label="`${row.label}筛选`" :options="options(row.values)" :selected="modelValue[row.key]" pin-selected @select="emit('update:modelValue',{...modelValue,[row.key]:String($event)})"/>
 <CatalogFacetRow v-if="!calendar" label="排序" group-label="发现排序" :options="sorts" :selected="sort" @select="emit('update:sort',$event as CatalogSort)"/>
</section></template>
<style scoped>.catalog-filters{display:grid;gap:2px;padding:0 0 20px;margin-bottom:20px;border-bottom:1px solid var(--divider)}@media(max-width:640px){.catalog-filters{margin-bottom:18px;padding-bottom:14px}}</style>
