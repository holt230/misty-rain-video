import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const define={'import.meta.env.BASE_URL':'"/misty-rain/"','process.env.NODE_ENV':'"test"'};
const compile=async file=>{const result=await build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'browser',define,logLevel:'silent'});return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);};
const {SilentSearchEngine}=await compile('src/services/silentSearchEngine.ts');
const {useQuarkTransfer}=await compile('src/composables/useQuarkTransfer.ts');
const row=(title,id='series')=>({note:title,url:'https://pan.quark.cn/s/'+id,datetime:'2026-11-14'});
const response=(rows=[],extra={})=>Response.json({code:0,data:{total:rows.length,merged_by_type:{quark:rows},...extra}});

test('每次提交只请求本站原关键词，连续搜索不补词或复用旧结果',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),init});return response([row(calls.length===1?'斗破苍穹 更新176集':'斗破苍穹 更新219集')]);});
 const engine=new SilentSearchEngine();assert.match((await engine.search('斗破苍穹')).items[0].title,/176/);assert.match((await engine.search('斗破苍穹')).items[0].title,/219/);
 assert.equal(calls.length,2);for(const call of calls){assert.equal(new URL(call.url,'http://localhost').searchParams.get('kw'),'斗破苍穹');assert.ok(call.url.startsWith('/misty-rain/api/resource-search?'));assert.equal(call.init.cache,'no-store');}
});

test('失败、空结果和认证失效只显示本次状态，不补查公共源或拿旧结果',async t=>{
 let mode='ok';const calls=[];t.mock.method(globalThis,'fetch',async url=>{calls.push(String(url));return mode==='ok'?response([row('斗破苍穹 更新219集')]):mode==='empty'?response():Response.json({code:mode==='auth'?'APP_AUTH_REQUIRED':'DOWN',message:mode==='auth'?'请先登录':'搜索失败，请重试'},{status:mode==='auth'?401:503});});
 const view=useQuarkTransfer();await view.openTransferModal({id:'search-once',title:'斗破苍穹',category:'anime'});
 mode='empty';await view.refreshResources('斗破苍穹');assert.equal(view.quarkResources.value.length,0);assert.equal(view.searchError.value,'');
 mode='fail';await view.refreshResources('斗破苍穹');assert.equal(view.quarkResources.value.length,0);assert.match(view.searchError.value,/失败/);
 mode='auth';await view.refreshResources('斗破苍穹');assert.equal(view.searchError.value,'请先登录');assert.equal(calls.length,4);assert.ok(calls.every(x=>x.startsWith('/')));view.closeTransferModal();
});

test('请求未结束时加载状态持续，发起新搜索立即清空旧结果',async t=>{
 let finish;t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{finish=resolve;}));const view=useQuarkTransfer();
 const pending=view.openTransferModal({id:'search-loading',title:'斗破苍穹',category:'anime'});
 assert.equal(view.isAnalyzing.value,true);assert.equal(view.searchPending.value,true);assert.equal(view.quarkResources.value.length,0);
 finish(response([row('斗破苍穹 更新219集')]));await pending;assert.equal(view.isAnalyzing.value,false);assert.equal(view.searchPending.value,false);view.closeTransferModal();
});

test('切词中止旧请求，旧响应晚到不会替换新结果或关闭新加载状态',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',(url,init)=>new Promise(resolve=>calls.push({url:String(url),signal:init.signal,resolve})));
 const view=useQuarkTransfer();const old=view.openTransferModal({id:'search-race',title:'旧搜索',category:'tv'});const current=view.refreshResources('新搜索');
 assert.equal(calls[0].signal.aborted,true);assert.equal(view.currentMedia.value.title,'新搜索');
 calls[0].resolve(response([row('旧搜索 4K')]));await old;assert.equal(view.searchPending.value,true);assert.equal(view.quarkResources.value.length,0);
 calls[1].resolve(response([row('新搜索 1080P')]));await current;assert.equal(view.quarkResources.value[0].title,'新搜索 1080P');assert.equal(view.searchPending.value,false);view.closeTransferModal();
});

test('同词在途点击只发一条请求，结束后重搜再发一条',async t=>{
 let finish,calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
 const engine=new SilentSearchEngine();const a=engine.search('斗破苍穹'),b=engine.search('斗破苍穹');assert.equal(calls,1);finish(response());await Promise.all([a,b]);
 const c=engine.search('斗破苍穹');assert.equal(calls,2);finish(response());await c;
});

test('关闭页面停止请求与加载，之后没有后台轮询或兜底请求',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1_000_000});let calls=0,signal;
 t.mock.method(globalThis,'fetch',(_url,init)=>{calls++;signal=init.signal;return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));});
 const view=useQuarkTransfer();const pending=view.openTransferModal({id:'search-close',title:'斗破苍穹',category:'anime'});view.closeTransferModal();await pending;
 assert.equal(signal.aborted,true);assert.equal(view.searchPending.value,false);t.mock.timers.tick(60_000);assert.equal(calls,1);
});

test('超时明确结束加载并报告失败，不伪装成未找到',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:2_000_000});t.mock.method(globalThis,'fetch',(_url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true})));
 const view=useQuarkTransfer();const pending=view.openTransferModal({id:'search-timeout',title:'斗破苍穹',category:'anime'});t.mock.timers.tick(35_000);await pending;
 assert.equal(view.isAnalyzing.value,false);assert.equal(view.searchPending.value,false);assert.match(view.searchError.value,/超时/);view.closeTransferModal();
});

test('219集实际返回就保留，年番、特别篇及片名边界过滤不会截掉高集数',async t=>{
 const notes=['斗破苍穹 年番 更新219集 1080P','斗破苍穹 第001-219集 4K','斗破苍穹 S05E219 1080P','斗破苍穹 三年之约 4K','斗破苍穹 壁纸','斗破苍穹 有声小说','别的动画 简介：斗破苍穹'];
 t.mock.method(globalThis,'fetch',async()=>response(notes.map((title,i)=>row(title,String(i)))));
 const result=await new SilentSearchEngine().search('斗破苍穹');assert.deepEqual(result.items.map(x=>x.title),notes.slice(0,4));
});

test('正片简介中出现小说不误删，零宽字符与年番后缀可匹配',async t=>{
 t.mock.method(globalThis,'fetch',async()=>response([row('仙\u200b逆年番3 更新至219集 ·📜介绍：改编自小说。'),row('剑仙逆世 第219集','wrong')]));
 const result=await new SilentSearchEngine().search('仙逆');assert.deepEqual(result.items.map(x=>x.title),['仙逆年番3 更新至219集']);
});

test('服务端返回旧快照或未完成标记时拒绝展示，不转成最终结果',async t=>{
 let flag='stale';t.mock.method(globalThis,'fetch',async()=>response([row('斗破苍穹 更新176集')],{[flag]:true}));
 for(flag of ['stale','refreshing','fromCache','from_cache'])assert.equal((await new SilentSearchEngine().search('斗破苍穹')).success,false);
});

test('部分来源失败且过滤后无匹配项时报告失败，成功的零结果正常返回',async t=>{
 let partial=true;t.mock.method(globalThis,'fetch',async()=>response(partial?[row('无关作品')]:[],{partial}));
 const failed=await new SilentSearchEngine().search('斗破苍穹');assert.equal(failed.success,false);assert.match(failed.message,/失败/);
 partial=false;const empty=await new SilentSearchEngine().search('斗破苍穹');assert.equal(empty.success,true);assert.equal(empty.total,0);
});
