import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
const {code}=await transform(fs.readFileSync('src/services/playbackNavigation.ts','utf8'),{loader:'ts',format:'esm'});
const {savePlaybackPage,loadPlaybackPage,clearPlaybackPages,firstPlayableEpisode,nextPlayableEpisode}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const storage=()=>{const values=new Map();return{getItem:key=>values.get(key),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
test('watch URL uses an opaque per-tab key, restores context and updated progress only for the same user',()=>{
 const data=storage(),media={id:'one',title:'影片',category:'tv',quarkShareUrl:'https://pan.quark.cn/s/private',quarkPasscode:'private'};
 const id=savePlaybackPage('admin',media,null,data,'test-page');assert.equal(id,'test-page');assert.doesNotMatch(id,/private|quark/);assert.equal(loadPlaybackPage('user',id,data),null);assert.equal(loadPlaybackPage('admin',id,data).media.title,'影片');
 savePlaybackPage('admin',media,{position:123},data,id);assert.equal(loadPlaybackPage('admin',id,data).historyEntry.position,123);clearPlaybackPages(data);assert.equal(loadPlaybackPage('admin',id,data),null);
});
test('new series start at the first available episode; auto-next never skips a gap, crosses seasons or switches movie versions',()=>{
 const episodes=[{seasonNumber:2,episodeNumber:1},{seasonNumber:1,episodeNumber:3},{seasonNumber:1,episodeNumber:2},{seasonNumber:1,episodeNumber:1}];
 assert.equal(firstPlayableEpisode(episodes,'tv'),3);assert.equal(firstPlayableEpisode(episodes,'movie'),0);assert.equal(nextPlayableEpisode(episodes,3,'tv'),2);assert.equal(nextPlayableEpisode(episodes,1,'tv'),-1);assert.equal(nextPlayableEpisode(episodes,3,'movie'),-1);assert.equal(nextPlayableEpisode(episodes,3,'tv',true),-1);assert.equal(nextPlayableEpisode([{episodeNumber:1},{episodeNumber:3}],0,'tv'),-1);
});

test('visible extras remain selectable without taking over default playback or automatic next episode',()=>{
 const episodes=[{episodeNumber:1,ancillary:true},{episodeNumber:2,ancillary:true},{episodeNumber:2},{episodeNumber:1}];
 assert.equal(firstPlayableEpisode(episodes,'tv'),3);assert.equal(firstPlayableEpisode(episodes,'movie'),2);
 assert.equal(nextPlayableEpisode(episodes,3,'tv'),2);assert.equal(nextPlayableEpisode(episodes,0,'tv'),-1);
 assert.equal(firstPlayableEpisode([{episodeNumber:0,ancillary:true}],'movie'),0);
});
