import type {CategoryType} from '../types/media';
import type {CatalogSort} from './catalogSort';
import {CATALOG_GENRES,CATALOG_COUNTRIES,catalogYears,type CatalogFilters} from '../../server/catalogFacets.js';
export interface BrowseState {category:CategoryType;filters:CatalogFilters;sort:CatalogSort;calendar:boolean;weekday:number}
export const defaultBrowseState=(category:CategoryType='tv',country=''):BrowseState=>({category,filters:{genre:'',country,year:''},sort:'popularity',calendar:false,weekday:new Date().getDay()||7});
export function parseBrowseRoute(hash:unknown):BrowseState|null{
 if(typeof hash!=='string'||!/^#\/browse(?:\?|$)/.test(hash))return null;
 const query=new URLSearchParams(hash.split('?')[1]||'');
 const category=query.get('category');const result=defaultBrowseState(['tv','movie','anime','variety'].includes(category||'')?category as CategoryType:'tv');
 for(const [key,values] of [['genre',CATALOG_GENRES],['country',CATALOG_COUNTRIES],['year',catalogYears()]] as const){const value=query.get(key)||'';result.filters[key]=values.includes(value)?value:'';}
 const sort=query.get('sort');result.sort=['popularity','time','rating'].includes(sort||'')?sort as CatalogSort:'popularity';
 result.calendar=result.category==='anime'&&query.get('view')==='calendar';const day=Number(query.get('day'));if(day>=1&&day<=7&&Number.isInteger(day))result.weekday=day;
 return result;
}
export function browseRoute(state:BrowseState){
 const query=new URLSearchParams({category:state.category,sort:state.sort});
 for(const key of ['genre','country','year'] as const)if(state.filters[key])query.set(key,state.filters[key]);
 if(state.calendar&&state.category==='anime'){query.set('view','calendar');query.set('day',String(state.weekday));}
 return `#/browse?${query}`;
}
