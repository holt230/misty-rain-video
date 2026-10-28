import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DanmakuService } from '../server/danmaku/service.js';
import { automaticWork, missingEpisode, DanmakuCatalog } from '../server/danmaku/catalog.js';
import { Readable } from 'node:stream';
import { handleApiRequest } from '../server/api.js';

const work={id:'2:StableWork',title:'测试剧',year:'2024',category:'2',categoryLabel:'电视剧',platforms:['qq']};
const input={mediaKey:'original-folder',title:work.title,year:work.year,category:'tv',seasonNumber:1,episodeNumber:5,episodeTitle:'第5集'};
const videoId=number=>`v${String(number).padStart(10,'0')}`;
function setup(t){
  fs.mkdirSync('.local-runtime/tests',{recursive:true});
  const directory=fs.mkdtempSync('.local-runtime/tests/association-');t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const calls=[];let mode='ready';
  const catalog={search:async()=>{calls.push('search');return [work];},episode:async(id,platform,number)=>{
    calls.push({id,platform,number});if(mode==='offline')throw Error('upstream unavailable');if(mode==='missing')throw missingEpisode();
    return {...work,episode:{number,platform,title:`第${number}集`,url:`https://v.qq.com/x/${videoId(number)}.html`}};
  }};
  const create=()=>new DanmakuService(directory,{catalog});
  return {directory,calls,create,service:create(),set mode(value){mode=value;}};
}

test('one TV confirmation follows its numbering offset across episodes, source changes and restart',async t=>{
  const v=setup(t);
  await v.service.select('alice',{...input,workId:work.id,targetEpisode:1,targetEpisodeTitle:'第1集',scope:'season'});
  const next={...input,mediaKey:'another-share',associationKey:input.mediaKey,episodeNumber:6,episodeTitle:'S01E06.1080P.mkv'};
  const result=await v.create().match('alice',next);assert.equal(result.selected.id,videoId(2));assert.equal(result.binding.offset,-4);
  const calls=v.calls.length;
  assert.equal((await v.create().match('alice',{...next,episodeTitle:'第六集 新片源'})).selected.id,videoId(2));assert.equal(v.calls.length,calls,'saved episode identity is independent of filename');
  const otherSeason=await v.service.match('alice',{...next,seasonNumber:2});assert.equal(otherSeason.status,'choose');assert.equal(otherSeason.selected,null);
  assert.equal(v.calls.filter(row=>row==='search').length,1,'only a different unconfirmed season searches');
});

test('single-episode corrections do not change the series mapping or the following episode',async t=>{
  const v=setup(t);await v.service.select('alice',{...input,workId:work.id});
  await v.service.select('alice',{...input,workId:work.id,targetEpisode:9,targetEpisodeTitle:'第9集',scope:'episode'});
  assert.equal((await v.create().match('alice',{...input,episodeTitle:'renamed file'})).selected.id,videoId(9));
  assert.equal((await v.service.match('alice',{...input,episodeNumber:6})).selected.id,videoId(6));
});

test('absence, outages and segment pruning retain confirmation without searching another work',async t=>{
  const v=setup(t);await v.service.select('alice',{...input,workId:work.id});
  const file=v.service.mappingPath('alice',input.mediaKey),before=fs.readFileSync(file,'utf8');v.calls.length=0;
  v.mode='missing';const absent=await v.service.match('alice',{...input,episodeNumber:6});assert.equal(absent.status,'missing');assert.equal(absent.binding.workId,work.id);
  v.mode='offline';const unavailable=await v.service.match('alice',{...input,episodeNumber:6});assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.binding.platform,'qq');
  const segments=path.join(v.directory,'danmaku','segments');fs.mkdirSync(segments,{recursive:true});const old=path.join(segments,'old.json');fs.writeFileSync(old,'{}');fs.utimesSync(old,new Date(0),new Date(0));v.service.prune();
  assert.equal(fs.existsSync(old),false);assert.equal(fs.readFileSync(file,'utf8'),before);assert.ok(!v.calls.includes('search'));
});

test('legacy choices migrate once and remain isolated by account and local season',async t=>{
  const v=setup(t),file=v.service.mappingPath('alice',input.mediaKey);fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify({workId:work.id,platform:'qq',episodes:{}}));
  assert.equal((await v.service.match('alice',input)).selected.id,videoId(5));
  const migrated=JSON.parse(fs.readFileSync(file));assert.equal(migrated.version,2);assert.equal(migrated.series['1'].workId,work.id);assert.equal(migrated.workId,undefined);
  v.calls.length=0;await v.service.match('bob',input);assert.ok(v.calls.includes('search'),'other accounts do not inherit a confirmation');
  assert.notEqual(v.service.mappingPath('alice',input.mediaKey),v.service.mappingPath('bob',input.mediaKey));
});

test('wrong-season and unclassified matches require confirmation even with identical titles',()=>{
  assert.equal(automaticWork({...input,seasonNumber:2},[work]),null);
  assert.equal(automaticWork({...input,categoryConfirmed:false},[work]),null);
  assert.equal(automaticWork({...input,title:'测试剧 第二季',seasonNumber:2},[{...work,title:'测试剧 第二季'}]).id,work.id);
});

test('conflicting source IDs for one episode number are not silently selected',async()=>{
  const catalog=new DanmakuCatalog();catalog.details=async()=>({...work,episodes:[1,2].map(n=>({platform:'qq',number:5,title:'第5集',url:`https://v.qq.com/x/${videoId(n)}.html`}))});
  await assert.rejects(catalog.episode(work.id,'qq',5),{code:'DANMAKU_EPISODE_NOT_FOUND'});
});

test('split files need their own confirmation and never reuse the other part',async t=>{
  const v=setup(t);await v.service.select('alice',{...input,workId:work.id});
  const part={...input,episodePart:'上'};assert.equal((await v.service.match('alice',part)).status,'choose');
  const confirmed=await v.service.select('alice',{...part,workId:work.id,scope:'season'});assert.equal(confirmed.seriesLinked,false);
  assert.equal((await v.service.match('alice',part)).selected.id,videoId(5));assert.equal((await v.service.match('alice',{...part,episodePart:'下'})).selected,null);
});

test('playback history retains the explicit association identity when a resource changes',async()=>{
  let saved;
  const userData={mediaRepository:{all:()=>[]},playbackHistory:{save:entry=>(saved={...entry,id:'history'}),all:()=>[saved]}};
  const context={authService:{authenticate:()=>({username:'alice',folder:'alice'}),assertSameOrigin:()=>{}},userContext:()=>userData,posterService:{enrich:async media=>media}};
  const media={id:'share:second',title:'测试剧',category:'tv',year:'2024',danmakuKey:'original-folder'};
  const response=()=>({headersSent:false,setHeader(){},end(body){this.body=JSON.parse(body);this.headersSent=true;}});
  const request=Object.assign(Readable.from([Buffer.from(JSON.stringify({media,episodeFid:'e1',episodeNumber:1,position:42,duration:100}))]),{method:'PUT',url:'/api/playback-history',headers:{host:'localhost'},socket:{remoteAddress:'127.0.0.1'}});
  const written=response();await handleApiRequest(request,written,context);assert.equal(written.body.code,0);assert.equal(saved.media.danmakuKey,'original-folder');assert.equal(saved.media.year,'2024');
  const read=response();await handleApiRequest({method:'GET',url:'/api/playback-history',headers:{host:'localhost'},socket:{remoteAddress:'127.0.0.1'}},read,context);
  assert.equal(read.body.data[0].media.danmakuKey,'original-folder');
});
