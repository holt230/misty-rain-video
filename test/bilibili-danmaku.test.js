import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBilibiliUrl,resolveBilibili,parseBilibiliSegment} from '../server/danmaku/bilibili.js';
import {DanmakuProviders,validateSource,platforms,segmentSeconds} from '../server/danmaku/providers.js';
import {DanmakuCatalog} from '../server/danmaku/catalog.js';
import {DanmakuService} from '../server/danmaku/service.js';
import fs from 'node:fs';
const response=data=>({json:()=>data});
const uint=value=>{let n=BigInt(value),out=[];do{let byte=Number(n&127n);n>>=7n;out.push(byte|(n?128:0));}while(n);return Buffer.from(out);};
const field=(tag,value)=>Buffer.concat([uint(tag),uint(value)]);
const data=(tag,value)=>Buffer.concat([uint(tag),uint(value.length),Buffer.from(value)]);
const row=(progress,text,mode=1,color=0xffffff)=>data(10,Buffer.concat([field(8,9223372036854775807n),field(16,progress),field(24,mode),field(40,color),data(58,Buffer.from(text))]));
test('Bili links accept exact BV/av pages and episode identities, without permitting arbitrary hosts or ambiguous pages',()=>{
 const link=parseBilibiliUrl('https://www.bilibili.com/video/BV17x411w7KC/?p=2&share=ignored');assert.equal(link.page,2);assert.equal(link.url,'https://www.bilibili.com/video/BV17x411w7KC/?p=2');assert.equal(parseBilibiliUrl('https://m.bilibili.com/video/av170001').id,'av170001');assert.equal(parseBilibiliUrl('https://www.bilibili.com/bangumi/play/ep317925').kind,'ep');
 for(const value of ['https://www.bilibili.com.evil/video/BV17x411w7KC','https://user@www.bilibili.com/video/BV17x411w7KC','https://www.bilibili.com:444/video/av170001','https://www.bilibili.com/video/BV17x411w7KC?p=1&p=2','https://www.bilibili.com/video/BV17x411w7KC?p=-1','file:///etc/passwd'])assert.equal(parseBilibiliUrl(value),null);
 assert.equal(platforms.bilibili,'哔哩哔哩');assert.equal(segmentSeconds.bilibili,360);assert.throws(()=>validateSource({platform:'bilibili',id:'../private'}));
});
test('BV part lookup uses the requested page, never the first available part',async()=>{
 const calls=[];const provider=new DanmakuProviders(async url=>{calls.push(url);return response({code:0,data:[{page:1,cid:11},{page:3,cid:33}]});});
 assert.equal((await provider.resolveUrl('https://www.bilibili.com/video/BV17x411w7KC?p=3')).id,'33');assert.ok(calls[0].includes('/x/player/pagelist?bvid='));await assert.rejects(provider.resolveUrl('https://www.bilibili.com/video/BV17x411w7KC?p=2'),/对应分/);
});
test('PGC resolves exact episodes and season ordinals while excluding previews and missing episodes',async()=>{
 const request=async()=>response({code:0,result:{episodes:[{id:9,title:'PV',cid:90},{id:11,title:'1',cid:110},{id:13,title:'3',cid:130}],section:[{episodes:[{id:22,title:'花絮',cid:220}]}]}});
 assert.equal((await resolveBilibili(parseBilibiliUrl('https://www.bilibili.com/bangumi/play/ep13'),request)).id,'130');assert.equal((await resolveBilibili(parseBilibiliUrl('https://www.bilibili.com/bangumi/play/ss1'),request,3)).id,'130');await assert.rejects(resolveBilibili(parseBilibiliUrl('https://www.bilibili.com/bangumi/play/ss1'),request,2),/具体剧集/);
});
test('short links allow only a single validated Bili destination',async()=>{
 const link=parseBilibiliUrl('https://b23.tv/abc123');assert.equal((await resolveBilibili(link,async(url,options)=>options?.allowRedirect?{location:'https://www.bilibili.com/video/BV17x411w7KC'}:response({code:0,data:[{page:1,cid:55}]}))).id,'55');
 for(const destination of ['https://127.0.0.1/private','https://evil.example/video/av1','https://b23.tv/again']){let calls=0;await assert.rejects(resolveBilibili(link,async()=>{calls++;return {location:destination};}));assert.equal(calls,1);}
});
test('bounded protobuf parsing preserves plain text and timing and omits script modes, duplicates and out-of-window rows',()=>{
 const bytes=Buffer.concat([row(1000,'测试'),row(1000,'测试'),row(2000,'<img src=x>',5,0xff0000),row(3000,'底部',4),row(4000,'script',8),row(360000,'next')]);
 assert.deepEqual(parseBilibiliSegment(bytes,0,360),[{time:1,text:'测试',color:'#ffffff',mode:'rtl'},{time:2,text:'<img src=x>',color:'#ff0000',mode:'top'},{time:3,text:'底部',color:'#ffffff',mode:'bottom'}]);assert.deepEqual(parseBilibiliSegment(Buffer.alloc(0),0,360),[]);assert.throws(()=>parseBilibiliSegment(Buffer.from('{"code":-403}'),0,360));assert.throws(()=>parseBilibiliSegment(Buffer.from([10,120,1]),0,360));assert.throws(()=>parseBilibiliSegment(Buffer.alloc(4*1024*1024+1),0,360));
});
test('provider requests 1-based six-minute segments and the shared service caches them',async t=>{
 let calls=0;const provider=new DanmakuProviders(async url=>{calls++;assert.match(url,/oid=55/);assert.match(url,/segment_index=2/);return {bytes:row(361000,'第二段')};});
 const dir=fs.mkdtempSync('.local-runtime/tests/bili-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const service=new DanmakuService(dir,{providers:provider});
 const first=await service.segment({platform:'bilibili',id:'55'},1);assert.equal(first.comments[0].time,361);assert.equal(first.segmentSeconds,360);await service.segment({platform:'bilibili',id:'55'},1);assert.equal(calls,1);
});


test('a catalogue Bili episode flows through automatic work matching and keeps the requested episode',async t=>{
 const request=async url=>{
  if(url.includes('360kan.com/index'))return response({code:0,data:{longData:{rows:[{titleTxt:'测试动画',year:'2026',cat_id:'4',en_id:'ABCDEf',playlinks:{bilibili:'https://www.bilibili.com/bangumi/play/ep123'}}]}}});
  if(url.includes('360kan.com/v1/detail'))return response({data:{id:'999',title:'测试动画',pubdate:'2026',allepidetail:{bilibili:[{playlink_num:'2',name:'第2集',url:'https://www.bilibili.com/bangumi/play/ep123'}]}}});
  assert.ok(url.includes('ep_id=123'));return response({code:0,result:{episodes:[{id:123,title:'2',cid:456}]}});
 };
 const dir=fs.mkdtempSync('.local-runtime/tests/bili-catalog-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const service=new DanmakuService(dir,{providers:new DanmakuProviders(request),catalog:new DanmakuCatalog(request)});
 const result=await service.match('fixture',{mediaKey:'bili-fixture',title:'测试动画',category:'anime',episodeNumber:2,episodeTitle:'第2集'});assert.equal(result.selected.platform,'bilibili');assert.equal(result.selected.id,'456');assert.equal(result.selected.segmentSeconds,360);
});
