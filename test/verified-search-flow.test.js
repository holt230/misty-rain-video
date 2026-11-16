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
 const full=await verifySearchResults([resource],options({inspect:async()=>details([219])}));assert.equal(full.resources.length,1);assert.equal(full.resources[0].verification.complete,false);assert.match(full.resources[0].verification.notice,/分段资源/);assert.deepEqual(full.resources[0].verification.requiredEpisodes,[219]);
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
 mockFetch(t,async(url,init)=>{calls.push(String(url));if(String(url).includes('resource-search'))return Response.json({code:0,data:{merged_by_type:{quark:[{url:resource.url,note:resource.title,work_title:resource.workTitle,category:'anime',year:'2022',latest_episode:219}]}}});shareSignal=init.signal;return new Promise(resolve=>{release=resolve;});});
 const view=useQuarkTransfer();const pending=view.openTransferModal({id:'search-test',title:'斗破苍穹 第219集',category:'anime'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(view.searchPhase.value,'verifying');assert.equal(view.isAnalyzing.value,true);assert.equal(view.quarkResources.value.length,0);
 view.closeTransferModal();assert.equal(shareSignal.aborted,true);release(Response.json({code:0,data:details([219])}));await pending;assert.equal(view.quarkResources.value.length,0);assert.ok(calls.every(url=>!url.includes('media-cards')));
});
test('核对后保存前缺集或分享名称变更均被拒绝，正确剧集可以保存',()=>{
 assert.throws(()=>assertVerifiedImport({expectedTitle:'斗破苍穹年番',shareTitle:'斗破苍穹年番',requiredEpisodes:[219]},[218]),{code:'QUARK_SOURCE_CHANGED'});
 assert.throws(()=>assertVerifiedImport({expectedTitle:'斗破苍穹年番',shareTitle:'其他作品',requiredEpisodes:[219]},[219]),{code:'QUARK_SOURCE_CHANGED'});
 assert.doesNotThrow(()=>assertVerifiedImport({expectedTitle:'斗破苍穹年番',shareTitle:'斗破苍穹年番',requiredEpisodes:[219]},[219]));
});

test('真实目录只有212至214和219时普通搜索展示真实范围，指定219仍能保存，220明确未找到',async()=>{
 const data={...details([212,213,214,219]),title:'D 斗破苍穹'};
 const basic=await verifySearchResults([resource],options({inspect:async()=>data}));
 assert.equal(basic.resources.length,1);const verified=basic.resources[0].verification;
 assert.match(verified.summary,/212～214、219/);assert.match(verified.notice,/分段资源/);assert.doesNotMatch(verified.notice,/缺少|215/);
 assert.deepEqual(verified.requiredEpisodes,[212,213,214,219]);assert.deepEqual(verified.selectedFids,['e212','e213','e214','e219']);
 const selected=await verifySearchResults([resource],options({episode:219,inspect:async()=>data}));assert.deepEqual(selected.resources[0].verification.selectedFids,['e219']);
 const absent=await verifySearchResults([resource],options({episode:220,inspect:async()=>data}));assert.equal(absent.resources.length,0);assert.match(absent.message,/未找到.*220/);
});

test('无视频的真实返回不能误报为片名不符，混淆名称不能凭来源标题冒充已确认',async()=>{
 const noVideo={title:'D .陡.坡.沧.琼.念.反（2022）',videoCount:0,entries:[{fid:'not-video',name:'E219.mp3',isVideo:false,episodeNumber:0}]};
 const result=await verifySearchResults([resource],options({inspect:async()=>noVideo}));assert.equal(result.resources.length,0);assert.match(result.message,/没有识别到正片视频/);assert.doesNotMatch(result.message,/片名或版本不符/);
 const ambiguous=await verifySearchResults([resource],options({inspect:async()=>({...details([219]),title:'DOUP'})}));assert.equal(ambiguous.resources.length,0);
});

test('未指定季数可以核对单一第五季；明确第一季或混合季数不得混存',async()=>{
 const fifth={title:'斗破苍穹 第五季',videoCount:1,entries:[{...file(219),name:'斗破苍穹.S05E219.mkv'}]};
 const generic=await verifySearchResults([resource],options({episode:219,inspect:async()=>fifth}));assert.equal(generic.resources.length,1);
 const explicit=await verifySearchResults([resource],options({title:'斗破苍穹 第一季',episode:219,inspect:async()=>fifth}));assert.equal(explicit.resources.length,0);
 const mixed=await verifySearchResults([resource],options({inspect:async()=>({...fifth,entries:[...fifth.entries,{...file(1),name:'S01E01.mp4'}]})}));assert.equal(mixed.resources.length,0);
});

test('重新输入另一片名清除旧年份、作品关联和待替换片库标识',async t=>{
 mockFetch(t,async(url)=>String(url).includes('resource-search')?Response.json({code:0,data:{total:0,merged_by_type:{quark:[]}}}):assert.fail('没有结果无需核对'));
 const view=useQuarkTransfer();await view.openTransferModal({id:'old',title:'旧剧',category:'tv',year:'2020',catalogId:'douban:old',quarkFid:'old-fid',poster:'old-cover'});
 await view.refreshResources('新动漫 第219集','anime');
 assert.equal(view.currentMedia.value.title,'新动漫');assert.equal(view.currentMedia.value.category,'anime');
 for(const key of ['year','catalogId','quarkFid'])assert.equal(view.currentMedia.value[key],undefined);
 assert.equal(view.currentMedia.value.poster,'');view.closeTransferModal();
});

test('官方已更新到更高集数时不把旧目录当作当前全集，动漫仍显示实际分段',async()=>{
 const result=await verifySearchResults([resource],options({officialLatest:220,inspect:async()=>details([219])}));
 assert.equal(result.resources[0].verification.latestEpisode,219);assert.equal(result.resources[0].verification.complete,false);
 assert.deepEqual(result.resources[0].verification.requiredEpisodes,[219]);
});

const mockFetch=(t,handler)=>t.mock.method(globalThis,'fetch',(url,init)=>String(url).includes('/official-progress')?Promise.resolve(Response.json({code:0,data:{status:'unknown',works:[],checkedAt:'',message:'官方进度暂未确认'}})):handler(url,init));
