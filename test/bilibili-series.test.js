import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BilibiliCatalog, parseBilibiliSeason } from '../server/danmaku/bilibiliCatalog.js';
import { DanmakuCatalog, validateWorkId } from '../server/danmaku/catalog.js';
import { DanmakuService } from '../server/danmaku/service.js';
import { DanmakuProviders } from '../server/danmaku/providers.js';
const metadata=JSON.parse(fs.readFileSync('test/fixtures/bilibili-series.json','utf8'));
const response=data=>({json:()=>data});
const input={mediaKey:'fanren-fixture',title:'凡人修仙传',category:'anime',year:'2020',seasonNumber:1,episodeNumber:196,episodeTitle:'第 1 季 · 第 196 集'};
const next={...input,episodeNumber:197,episodeTitle:'第 1 季 · 第 197 集'};
function setup(t){
 const directory=fs.mkdtempSync('.local-runtime/tests/bili-series-');t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const calls=[];
 const request=async url=>{calls.push(url);if(url.includes('/pgc/view/web/season?'))return response({code:0,result:metadata});if(url.includes('/x/web-interface/search/'))throw Error('412');if(url.includes('/x/player/pagelist'))return response({code:0,data:[{page:1,cid:55}]});if(url.includes('360kan.com/index'))return response({code:0,data:{longData:{rows:[{cat_id:'2',en_id:'TV2025',titleTxt:'凡人修仙传',year:'2025',playlinks:{youku:'https://v.youku.com/v_show/id_Xabcde.html'}}]}}});throw Error('unexpected request '+url);};
 const create=()=>new DanmakuService(directory,{catalog:new DanmakuCatalog(request,path.join(directory,'danmaku')),providers:new DanmakuProviders(request)});
 return{directory,calls,request,create,service:create()};
}
function oldMapping(service){const file=service.mappingPath('alice',input.mediaKey);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({episodes:{
 '195:第 1 季 · 第 195 集':{platform:'bilibili',id:'42628875313',url:'https://www.bilibili.com/bangumi/play/ep3854819',title:'凡人修仙传',workId:'',segmentSeconds:360},
 '196:第 1 季 · 第 196 集':{platform:'bilibili',id:'42798419951',url:'https://www.bilibili.com/bangumi/play/ep3854820',title:'凡人修仙传',workId:'',segmentSeconds:360}
 }}));return file;}

test('real Bili metadata distinguishes 197 main episode from numeric 197/198 trailers',()=>{
 const work=parseBilibiliSeason(metadata);assert.equal(work.id,'bili:4:28747');assert.equal(work.year,'2020');assert.equal(work.category,'4');assert.deepEqual(work.episodes.map(e=>e.number),[1,2,194,195,196,197]);assert.equal(work.episodes.at(-1).cid,'42992339433');assert.ok(!work.episodes.some(e=>e.episodeId==='4292441'||e.number===198));
 const collision=structuredClone(metadata);collision.episodes.push({...collision.episodes.find(e=>e.id===3854821),id:999,cid:888});assert.ok(!parseBilibiliSeason(collision).episodes.some(e=>e.number===197));
});

test('one confirmed PGC link persists the work and resolves next episode after restart without searching',async t=>{
 const v=setup(t);const selected=await v.service.select('alice',{...input,url:'https://www.bilibili.com/bangumi/play/ep3854820?share=1'});assert.equal(selected.workId,'bili:4:28747');assert.equal(selected.seriesLinked,true);
 const result=await v.create().match('alice',next);assert.equal(result.selected.id,'42992339433');assert.equal(result.selected.url,'https://www.bilibili.com/bangumi/play/ep3854821');assert.ok(v.calls.every(url=>url.includes('/pgc/view/web/season?')));
 const options=await v.service.options({...next,workId:selected.workId});assert.deepEqual(options.episodes.at(-1),{key:'197',number:197,title:'第 197 集',platforms:['bilibili']});
});

test('existing single-episode 195/196 mappings upgrade before matching 197 and retain the old overrides',async t=>{
 const v=setup(t);const file=oldMapping(v.service);const result=await v.service.match('alice',next);assert.equal(result.selected.id,'42992339433');const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.series['1'].workId,'bili:4:28747');assert.equal(saved.series['1'].offset,0);assert.equal(saved.episodes['195:第 1 季 · 第 195 集'].id,'42628875313');assert.equal(saved.episodes['196:第 1 季 · 第 196 集'].seriesLinked,true);assert.equal(v.calls.filter(url=>url.includes('/pgc/view')).length,1);assert.equal(fs.existsSync(v.service.mappingPath('bob',input.mediaKey)),false);
});

test('learned Bili work remains searchable after restart alongside same-name live action TV',async t=>{
 const v=setup(t);oldMapping(v.service);await v.service.match('alice',next);const result=await v.create().match('alice',{...next,query:'凡人修仙传'});assert.equal(result.selected,null);assert.deepEqual(result.candidates.map(w=>[w.title,w.category,w.platforms[0]]),[['凡人修仙传','4','bilibili'],['凡人修仙传','2','youku']]);assert.ok(!v.calls.some(url=>url.includes('/x/web-interface/search/')),'known titles do not depend on rejected remote searches');
});

test('explicit numbering offset follows only its local season, never the whole media record',async t=>{
 const v=setup(t);await v.service.select('alice',{...input,seasonNumber:2,episodeNumber:1,episodeTitle:'第 2 季 · 第 1 集',url:'https://www.bilibili.com/bangumi/play/ep3854820'});
 const selected=(await v.service.match('alice',{...input,seasonNumber:2,episodeNumber:2,episodeTitle:'第 2 季 · 第 2 集'})).selected;assert.equal(selected.id,'42992339433');
 const other=(await v.service.match('alice',{...input,episodeNumber:1,episodeTitle:'第 1 季 · 第 1 集'})).selected;assert.notEqual(other.id,selected.id);assert.equal(other.episodeNumber,1);
});

test('missing future episode keeps confirmed work and mapping, without falling back to the live-action title',async t=>{
 const v=setup(t);await v.service.select('alice',{...input,url:'https://www.bilibili.com/bangumi/play/ep3854820'});const file=v.service.mappingPath('alice',input.mediaKey),before=fs.readFileSync(file,'utf8');v.calls.length=0;
 const missing=await v.service.match('alice',{...next,episodeNumber:198,episodeTitle:'第 1 季 · 第 198 集'});assert.equal(missing.status,'missing');assert.equal(missing.binding.workId,'bili:4:28747');assert.equal(missing.selected,null);assert.equal(fs.readFileSync(file,'utf8'),before);assert.ok(!v.calls.some(url=>url.includes('360kan')||url.includes('youku')));
});

test('standalone BV and explicitly pasted trailers stay per-episode rather than pretending to be a series',async t=>{
 const v=setup(t);const bv=await v.service.select('alice',{...input,url:'https://www.bilibili.com/video/BV17x411w7KC/'});assert.equal(bv.workId,'');assert.deepEqual(JSON.parse(fs.readFileSync(v.service.mappingPath('alice',input.mediaKey))).series,{});
 const trailer=await v.service.select('alice',{...input,url:'https://www.bilibili.com/bangumi/play/ep4292441'});assert.equal(trailer.id,'42801958348');assert.equal(trailer.workId,'');assert.ok(!trailer.seriesLinked);
});

test('blocked Bili discovery backs off and keeps confirmed public metadata available, with bounded identifiers',async t=>{
 const v=setup(t),catalog=new BilibiliCatalog(v.request);assert.deepEqual(await catalog.search('未收录作品'),[]);assert.deepEqual(await catalog.search('其他未收录作品'),[]);assert.equal(v.calls.filter(url=>url.includes('/x/web-interface/search/')).length,1);
 await catalog.season('28747');assert.equal((await catalog.search('凡人修仙传'))[0].id,'bili:4:28747');for(const id of ['bili:4:../../private','bili:4:0','bili:9:28747'])assert.throws(()=>validateWorkId(id));
});
