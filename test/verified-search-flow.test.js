import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { assertVerifiedImport } from '../server/verifiedImport.js';
const compile = async file => { const c=await build({entryPoints:[file],bundle:true,write:false,format:'esm',define:{'import.meta.env.BASE_URL':'"/"'},logLevel:'silent'});return import(`data:text/javascript;base64,${Buffer.from(c.outputFiles[0].text).toString('base64')}`); };
const {searchIntent}=await compile('src/services/searchIntent.ts');
const {verifySearchResults}=await compile('src/services/verifySearchResults.ts');
const {useQuarkTransfer}=await compile('src/composables/useQuarkTransfer.ts');
const resource={id:'source',url:'https://pan.quark.cn/s/test',title:'斗破苍穹年番',workTitle:'斗破苍穹年番',category:'anime',year:'2022',latestEpisode:219};
const file = n => ({fid:'e'+n,name:`第${n}集.mp4`,isVideo:true,episodeNumber:n,size:100});
const details = nums => ({title:'斗破苍穹年番',videoCount:nums.length,entries:nums.map(file)});
const options = extra => ({title:'斗破苍穹',category:'anime',signal:new AbortController().signal,progress(){},...extra});

test('明确集数语法只提取目标要求，不把年份、季数或正常片名裁剪掉',()=>{
 for(const query of ['斗破苍穹 第219集','斗破苍穹219集','斗破苍穹 EP219'])assert.deepEqual(searchIntent(query),{title:'斗破苍穹',episode:219});
 for(const title of ['请回答1988','斗破苍穹 第二季','第八个嫌疑人','Cube3','Episode1'])assert.deepEqual(searchIntent(title),{title,episode:undefined});
});
test('搜索指定219集只验证这一集，部分分享不能被标成全集但可保存指定集数',async()=>{
 const checked=await verifySearchResults([resource],options({episode:219,inspect:async()=>details([219])}));
 assert.equal(checked.resources.length,1);assert.deepEqual(checked.resources[0].verification.selectedFids,['e219']);assert.deepEqual(checked.resources[0].verification.requiredEpisodes,[219]);
 const full=await verifySearchResults([resource],options({inspect:async()=>details([219])}));assert.equal(full.resources.length,0);assert.match(full.message,/未找到.*缺少 218 集/);
});
test('失效分享、缺少目标集与错误片名不进入保存结果',async()=>{
 for(const inspect of [async()=>{throw Object.assign(new Error('取消分享'),{code:'QUARK_SHARE_UNAVAILABLE',status:422});},async()=>details([218]),async()=>({...details([219]),title:'其他作品'})]){
  const result=await verifySearchResults([resource],options({episode:219,inspect}));assert.equal(result.resources.length,0);assert.match(result.message,/未找到/);assert.equal(result.error,undefined);
 }
});
test('认证或网络失败不假报未找到，未核对的结果不允许保存',async()=>{
 const auth=await verifySearchResults([resource],options({inspect:async()=>{throw Object.assign(new Error('auth'),{status:401});}}));assert.equal(auth.needsAuth,true);assert.match(auth.error,/认证/);assert.deepEqual(auth.resources,[]);
 const network=await verifySearchResults([resource],options({inspect:async()=>{throw new Error('网络错误');}}));assert.match(network.error,/网络/);assert.deepEqual(network.resources,[]);
});
test('取消核对后迟到的目录不重新填充结果，搜索全过程不执行保存请求',async t=>{
 const calls=[];let release,shareSignal;
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(String(url));if(String(url).includes('resource-search'))return Response.json({code:0,data:{merged_by_type:{quark:[{url:resource.url,note:resource.title,work_title:resource.workTitle,category:'anime',year:'2022',latest_episode:219}]}}});shareSignal=init.signal;return new Promise(resolve=>{release=resolve;});});
 const view=useQuarkTransfer();const pending=view.openTransferModal({id:'search-test',title:'斗破苍穹 第219集',category:'anime'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(view.searchPhase.value,'verifying');assert.equal(view.isAnalyzing.value,true);assert.equal(view.quarkResources.value.length,0);
 view.closeTransferModal();assert.equal(shareSignal.aborted,true);release(Response.json({code:0,data:details([219])}));await pending;assert.equal(view.quarkResources.value.length,0);assert.ok(calls.every(url=>!url.includes('media-cards')));
});
test('核对后保存前缺集或分享名称变更均被拒绝，正确剧集可以保存',()=>{
 assert.throws(()=>assertVerifiedImport({expectedTitle:'斗破苍穹年番',shareTitle:'斗破苍穹年番',requiredEpisodes:[219]},[218]),{code:'QUARK_SOURCE_CHANGED'});
 assert.throws(()=>assertVerifiedImport({expectedTitle:'斗破苍穹年番',shareTitle:'其他作品',requiredEpisodes:[219]},[219]),{code:'QUARK_SOURCE_CHANGED'});
 assert.doesNotThrow(()=>assertVerifiedImport({expectedTitle:'斗破苍穹年番',shareTitle:'斗破苍穹年番',requiredEpisodes:[219]},[219]));
});
