import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const compiled=await build({entryPoints:['src/services/playbackCoverage.ts'],bundle:true,write:false,format:'esm',logLevel:'silent'});
const {playbackCoverage}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const episodes=numbers=>numbers.map(n=>({episodeNumber:n,fileName:`第01季 第${n}集.mkv` }));

test('线上尚公主35至40集应显示片库已存6集和缺1至34集，不把6当全剧集数',()=>{
 const data=playbackCoverage(episodes([35,36,37,38,39,40]),'tv',40);
 assert.equal(data.count,6);assert.equal(data.summary,'可看第 35～40 集');
 assert.deepEqual(data.missing,Array.from({length:34},(_,i)=>i+1));assert.match(data.missingLabel,/1～34/);
});
test('官方更新高于当前片库时包含前中后缺集，重复画质不能增加剧集数',()=>{
 const data=playbackCoverage(episodes([1,2,2,4]),'tv',6);
 assert.equal(data.count,3);assert.deepEqual(data.missing,[3,5,6]);
 assert.match(data.summary,/1～2、4/);
});
test('动漫分段不要求第一集开始，多季及未编号文件不混算电视剧缺集',()=>{
 assert.deepEqual(playbackCoverage(episodes([212,213,219]),'anime',219).missing,[]);
 const multiple=playbackCoverage([{episodeNumber:1,fileName:'S01E01.mp4'},{episodeNumber:10,fileName:'S02E10.mp4'}],'tv',10);
 assert.deepEqual(multiple.missing,[]);assert.match(multiple.summary,/2 个视频/);
 assert.equal(playbackCoverage([],'tv').summary,'');
});
