import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PlaybackCacheRepository} from '../server/storage.js';
import {QuarkGateway} from '../server/quarkGateway.js';
const admin={username:'admin',folder:'admin',role:'admin'};
function fixture(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cached-play-'));const cache=new PlaybackCacheRepository(folder),other=new PlaybackCacheRepository(path.join(folder,'other'));
 cache.set('deadshare:old-episode',{savedFid:'owned-saved-file',fileName:'S01E02.mp4',folderFid:'owned-temp'});
 cache.set('subtitle:deadshare:caption',{savedFid:'owned-caption',fileName:'S01E02.chs.srt',folderFid:'owned-temp'});
 cache.set('different:other',{savedFid:'unrelated-file',fileName:'S01E03.mp4'});
 let transferred=0;
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(String(url).includes('/share/sharepage/token'))return Response.json({code:41001,message:'好友已取消了分享'});
  if(String(url).includes('/share/sharepage/save'))transferred++;
  throw new Error('unexpected network access');
 });
 const gateway=new QuarkGateway({credentialStore:{getCookie:()=> 'test-cookie',getTvAuth:()=>({refreshToken:'test-token'})},tvPlaybackClient:{getStreaming:async fid=>{assert.equal(fid,'owned-saved-file');return{video_list:[{resolution:'high',video_info:{url:'https://media.example.test/play.mp4'}}]}}}});
 t.after(()=>{clearInterval(gateway.cleanupTimer);fs.rmSync(folder,{recursive:true,force:true})});return{gateway,cache,other,get transferred(){return transferred}};
}
test('confirmed canceled share can replay only this user’s cached episodes and matching saved subtitles',async t=>{
 const f=fixture(t),session=await f.gateway.createPlaybackSession({shareUrl:'https://pan.quark.cn/s/deadshare',title:'测试剧'},admin,f.cache);
 assert.equal(session.cachedOnly,true);assert.equal(session.episodes.length,1);assert.equal(session.episodes[0].fid,'old-episode');assert.equal(session.episodes[0].episodeNumber,2);
 const play=await f.gateway.prepareEpisode(session.sessionId,'old-episode',admin,f.cache);assert.equal(play.transferred,false);assert.equal(play.subtitles.length,1);assert.equal(f.transferred,0);
 assert.doesNotMatch(JSON.stringify(session),/owned-saved-file|owned-temp|test-token/);
 await assert.rejects(f.gateway.prepareEpisode(session.sessionId,'old-episode',{username:'other',folder:'other',role:'user'},f.other),{statusCode:403});
 await assert.rejects(f.gateway.createPlaybackSession({shareUrl:'https://pan.quark.cn/s/deadshare'},admin,f.other),{code:'QUARK_SHARE_UNAVAILABLE'});
});
test('transient provider errors and invalid passcodes do not masquerade as a canceled-share cache mode',async t=>{
 const f=fixture(t);t.mock.method(globalThis,'fetch',async()=>Response.json({code:41002,message:'提取码错误'}));
 await assert.rejects(f.gateway.createPlaybackSession({shareUrl:'https://pan.quark.cn/s/deadshare'},admin,f.cache),error=>error.code!=='QUARK_SHARE_UNAVAILABLE');
});
