import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogFacets } from '../server/catalogFacets.js';
import { CatalogBrowse, browseOptions } from '../server/catalogBrowse.js';
import { CatalogSearch, normalizeCatalogSearch } from '../server/catalogSearch.js';
import { normalizeDoubanFeed } from '../server/discoverySources.js';
const filters = { genre:'科幻',country:'美国',year:'2024' };
const item = { id:'35575567',title:'沙丘2',type:'movie',year:'2024',card_subtitle:'2024 / 美国 加拿大 / 剧情 动作 科幻 冒险 / 导演 / 演员',rating:{value:8.1,count:123},pic:{normal:'https://img3.doubanio.com/view/photo/public/test.jpg'} };
const setup = fetcher => {
 const registered=[];const search=new CatalogSearch({discovery:{registerCatalogItems:items=>registered.push(...items)},fetcher});
 return {service:new CatalogBrowse({catalogSearch:search}),registered};
};
test('facets parse both year-prefixed charts and yearless search snippets; aliases normalize regions without guessing from titles',()=>{
 assert.deepEqual(catalogFacets(item),{countries:['美国','加拿大'],genres:['剧情','动作','科幻','冒险']});
 assert.deepEqual(catalogFacets({card_subtitle:'中国大陆 / 剧情 古装 / 导演 / 演员'}),{countries:['中国大陆'],genres:['剧情','古装']});
 assert.deepEqual(catalogFacets({countries:['香港','台湾'],genres:['喜剧','喜剧']}),{countries:['中国香港','中国台湾'],genres:['喜剧']});
 assert.deepEqual(catalogFacets({title:'美国爱情故事',description:'American Love Story'}),{countries:[],genres:[]});
 assert.deepEqual(catalogFacets({description:'导演 / 某演员'}),{countries:[],genres:[]});
});
test('search and discovery metadata use the same country/genre fields',()=>{
 const search=normalizeCatalogSearch({smart_box:[{target_type:'movie',target:item}]})[0];
 const feed=normalizeDoubanFeed({subject_collection_items:[item]},{category:'movie'})[0];
 assert.deepEqual(search.genres,feed.genres);assert.deepEqual(search.countries,['美国','加拿大']);
});
test('browse sends all filters as actual tags, uses correct sort, registers posters and deduplicates requests',async()=>{
 let calls=0;const {service,registered}=setup(async(url,options)=>{
  calls++;const query=new URL(url);assert.equal(query.pathname,'/rexxar/api/v2/movie/recommend');
  assert.deepEqual(query.searchParams.get('tags').split(','),['科幻','美国','2024']);assert.equal(query.searchParams.get('sort'),'S');
  assert.equal(query.searchParams.get('count'),'24');assert.ok(options.signal);assert.equal(options.redirect,'error');
  return Response.json({items:[{type:'ad'},item,item],total:40});
 });
 const input={...filters,category:'movie',sort:'rating'};
 const [a,b]=await Promise.all([service.get(input),service.get(input)]);assert.deepEqual(a,b);assert.equal(calls,1);
 assert.equal(a.items.length,1);assert.equal(a.items[0].category,'movie');assert.equal(a.nextStart,24);assert.equal(a.partial,false);
 assert.match(a.items[0].poster,/discovery\/posters\/douban-35575567/);assert.equal(a.items[0].imageUrl,undefined);assert.ok(registered.length);
 await service.get(input);assert.equal(calls,1);
});
test('format-specific TV tags and page offsets are preserved; one failing provider is partial rather than silently empty',async()=>{
 const calls=[];const {service}=setup(async url=>{
  const parsed=new URL(url);calls.push(parsed);
  return parsed.pathname.includes('/movie/')?new Response('denied',{status:403}):Response.json({items:[{...item,type:'tv'}],total:28});
 });
 for(const [category,tag] of [['tv','电视剧'],['variety','综艺'],['anime','动画']]){
  const page=await service.get({category,country:'美国',start:24});assert.equal(page.nextStart,null);
  assert.ok(calls.at(-1).searchParams.get('tags').split(',').includes(tag));assert.equal(calls.at(-1).searchParams.get('start'),'24');
 }
 const combined=await service.get({category:'all',genre:'科幻'});assert.equal(combined.partial,true);assert.ok(combined.items.length);
});
test('invalid filters never reach the provider; genuine empty pages differ from failures; malformed responses fail closed',async()=>{
 let calls=0;const {service}=setup(async()=>{calls++;return Response.json({items:[],total:0})});
 for(const input of [{country:'http://localhost'},{genre:'unknown'},{year:'yesterday'},{start:-1},{start:1},{start:504},{sort:'__proto__'},{category:'book'}]) await assert.rejects(service.get(input),{statusCode:400});
 assert.equal(calls,0);assert.deepEqual(await service.get({category:'movie',...filters}),{items:[],partial:false,nextStart:null});
 for(const response of [{msg:'need_login'},{items:[],total:-1},{items:[],total:0,banned:'login'}]){
  const {service:bad}=setup(async()=>Response.json(response));await assert.rejects(bad.get(filters),{statusCode:503});assert.equal(bad.cache.size,0);
 }
 assert.equal(browseOptions({start:'24'}).start,24);
});
test('browse cache bounds, expiry, final page and shared concurrency limit remain bounded',async()=>{
 let now=0,calls=0;
 const {service}=setup(async()=>{calls++;return Response.json({items:[item],total:500})});service.now=()=>now;
 await service.get({category:'movie'});now=600001;await service.get({category:'movie'});assert.equal(calls,2);
 assert.equal((await service.get({category:'movie',start:480})).nextStart,null);
 const resolvers=[];const {service:busy}=setup(()=>new Promise(resolve=>resolvers.push(resolve)));
 const pending=['美国','日本','韩国','英国'].map(country=>busy.get({category:'movie',country}));
 await assert.rejects(busy.get({category:'movie',country:'法国'}),{statusCode:503});
 assert.equal(busy.pending.size,4);resolvers.forEach(resolve=>resolve(Response.json({items:[],total:0})));await Promise.all(pending);assert.equal(busy.pending.size,0);
});
