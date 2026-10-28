import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
const {code}=await transform(fs.readFileSync('src/services/playbackSourceCache.ts','utf8'),{loader:'ts',format:'esm'});
const {PlaybackSourceCache,playbackSourceKey,playbackWorkKey}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const storage=()=>{const map=new Map();return{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),map};};
const media={id:'quark:original',quarkFid:'original',title:'同一部剧 第二季',category:'tv',year:'2026',poster:'',tag:''};
const resource=id=>({id,title:'备选资源',url:'https://pan.quark.cn/s/'+id,driveType:'quark',quality:'1080P',source:'测试',datetime:'',is4k:false});
test('source numbers and owned original survive switching, a new store instance and returning to the collection',()=>{
 const disk=storage(),store=new PlaybackSourceCache(()=>disk,()=>1000);store.open('a',media);let pool=store.merge('a',media,[resource('two'),resource('three')]);assert.deepEqual(pool.sources.map(s=>s.number),[1,2,3]);
 const second=pool.sources[1].media;store.open('a',second);store.searched('a',second,'available');
 const reopened=new PlaybackSourceCache(()=>disk,()=>2000);pool=reopened.open('a',second);assert.equal(pool.selectedKey,'share:two');assert.deepEqual(pool.sources.map(s=>s.number),[1,2,3]);assert.equal(pool.sources[0].media.quarkFid,'original');assert.equal(reopened.preferred('a',media).quarkShareUrl,second.quarkShareUrl);assert.ok(pool.nextSearchAt>2000);
 reopened.open('a',pool.sources[0].media);assert.equal(reopened.preferred('a',media).quarkFid,'original');
});
test('expiry distinguishes usable, empty and uncertain results; pruning and account clearing are scoped',()=>{
 const disk=storage();let now=1000;const store=new PlaybackSourceCache(()=>disk,()=>now);store.open('a',media);store.open('b',media);const hour=3600000;
 assert.equal(store.searched('a',media,'available').nextSearchAt,now+24*hour);assert.equal(store.searched('a',media,'empty').nextSearchAt,now+hour);assert.equal(store.searched('a',media,'uncertain').nextSearchAt,now+300000);
 store.merge('a',media,[resource('two')]);store.open('a',store.merge('a',media,[]).sources[1].media);store.clear('a');assert.equal(store.preferred('a',media),media);assert.equal(store.open('b',media).sources[0].number,1);
 now+=8*24*hour;assert.equal(store.open('b',media).sources.length,1);assert.equal(store.open('b',media).nextSearchAt,0);
});
test('deduplication keeps an owned original, removals never renumber and a missing episode does not delete a source',()=>{
 const disk=storage();let now=1000;const store=new PlaybackSourceCache(()=>disk,()=>now),original={...media,quarkShareUrl:'https://pan.quark.cn/s/orig?pwd=abc'};store.open('a',original);let pool=store.merge('a',original,[resource('orig'),resource('two'),resource('three')]);assert.equal(pool.sources.length,3);assert.equal(pool.sources[0].media.quarkFid,'original');
 pool=store.missing('a',original,'share:two','1:12');assert.equal(pool.sources.length,3);assert.ok(pool.sources[1].missing['1:12']>now);pool=store.remove('a',original,'share:three');pool=store.merge('a',original,[resource('four')]);assert.deepEqual(pool.sources.map(s=>s.number),[1,2,4]);
 now+=3600001;assert.deepEqual(store.open('a',original).sources[1].missing,{});
});
test('cache is bounded and excludes playback tokens and one-time file selections',()=>{
 const disk=storage();let now=100;const store=new PlaybackSourceCache(()=>disk,()=>now++);
 for(let i=0;i<45;i++)store.open('a',{...media,title:'影片'+i,sessionId:'secret',url:'signed-video',startEpisodeFid:'one-time'});
 const saved=JSON.parse([...disk.map.values()][0]);assert.equal(Object.keys(saved.entries).length,40);assert.doesNotMatch(JSON.stringify(saved),/secret|signed-video|one-time/);
 const pool=store.merge('a',media,Array.from({length:20},(_,i)=>resource('s'+i)));assert.equal(pool.sources.length,8);
 assert.notEqual(playbackWorkKey(media),playbackWorkKey({...media,year:'2025'}));assert.equal(playbackWorkKey(media),playbackWorkKey({...media,id:'share:new'}));
});
test('storage failures and damaged JSON preserve a usable in-memory pool',()=>{
 const broken={getItem:()=>'{',setItem:()=>{throw new Error('full')},removeItem:()=>{throw new Error('denied')}};const store=new PlaybackSourceCache(()=>broken,()=>1000);store.open('a',media);store.merge('a',media,[resource('two')]);assert.equal(store.open('a',media).sources.length,2);store.clear('a');assert.equal(store.open('a',media).sources.length,1);
});

test('an explicitly inherited danmaku identity survives reopening a selected source',()=>{
 const disk=storage(),store=new PlaybackSourceCache(()=>disk,()=>1000);
 const selected={...media,id:'share:two',quarkFid:undefined,quarkShareUrl:'https://pan.quark.cn/s/two',danmakuKey:'quark:original'};
 store.open('a',selected);const reopened=new PlaybackSourceCache(()=>disk,()=>2000);
 assert.equal(reopened.preferred('a',media).danmakuKey,'quark:original');
});
