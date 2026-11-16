import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from 'vue/compiler-sfc';
import { build } from 'esbuild';
import { ResourceSearchService } from '../server/resourceSearch.js';

// Replay the observed production response through the real backend, client,
// and result-list component. Only visual child components are stubbed.
const rows = [
  { note: '2025最新动画.仙逆剧场版.神临之战.4k.国语中字', url: 'https://pan.quark.cn/s/movie1', source: 'plugin:quarktv' },
  { note: '仙逆.年番2‎.2025.1080p.2160p【含2023第一季以及2024年番1】【更新第89集】', url: 'https://pan.quark.cn/s/series1', source: 'plugin:quarktv' },
  { note: '🎞️ 仙逆', url: 'https://pan.qoark.cn/s/xn', source: 'plugin:quarksoo' },
  { note: '《仙逆剧场版 神临之战》夸克网盘下载链接', url: 'https://pan.quark.cn/s/movie2', source: 'plugin:quark4k' }
];
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'Document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'CustomEvent']) globalThis[key] = dom.window[key];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const { createApp, nextTick, reactive, h } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const directory = fs.mkdtempSync('.local-runtime/tests/search-pipeline-');
after(() => { fs.rmSync(directory, { recursive: true, force: true }); dom.window.close(); });
const filename = 'src/components/quark/QuarkTransferModal.vue';
const compiled = compileScript(parse(fs.readFileSync(filename, 'utf8')).descriptor, { id: 'search-pipeline', inlineTemplate: true });
const output = path.resolve(directory, 'modal.mjs');
await build({ stdin: { contents: compiled.content, loader: 'ts', resolveDir: path.resolve('src/components/quark'), sourcefile: filename },
  bundle: true, outfile: output, format: 'esm', platform: 'browser', external: ['vue'],
  define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  plugins: [{ name: 'visual-children', setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, () => ({ contents: 'export default { render() { return null; } };', loader: 'js' }));
  } }]
});
const Modal = (await import(pathToFileURL(output))).default;
const clientCode = await build({ entryPoints: ['src/services/silentSearchEngine.ts'], bundle: true, write: false,
  format: 'esm', platform: 'node', define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent' });
const { SilentSearchEngine } = await import(`data:text/javascript;base64,${Buffer.from(clientCode.outputFiles[0].text).toString('base64')}`);

function mount(props, handlers={}) {
  document.body.innerHTML='<div id="app"></div>';
  const state=reactive({isOpen:true,isAnalyzing:false,searchPending:false,currentCategory:'anime',searchKeyword:'斗破苍穹',media:{id:'search-qa',title:'斗破苍穹',category:'anime',poster:''},quarkResources:[],...props});
  const app=createApp({render:()=>h(Modal,{...state,...handlers})});app.mount('#app');
  return {app,state};
}
const resource=(title,i)=>({id:String(i),title,url:'https://pan.quark.cn/s/test'+i,datetime:'2026-11-14',quality:'高清',is4k:/4K/.test(title)});

test('服务端、客户端到界面保留本次匹配结果，没有候选标签或补查版本入口',async t=>{
 const gateway=new ResourceSearchService({urls:['https://fixture.invalid/search'],fetchImpl:async()=>Response.json({code:0,data:{merged_by_type:{quark:rows}}})});
 const actual=await gateway.search('仙逆');assert.equal(actual.total,3);
 t.mock.method(globalThis,'fetch',async()=>Response.json({code:0,data:actual}));
 const client=await new SilentSearchEngine().search('仙逆');
 const view=mount({searchKeyword:'仙逆',media:{id:'search-xn',title:'仙逆',category:'anime',poster:''},quarkResources:client.items});
 try{await nextTick();assert.equal(document.querySelectorAll('.liquid-resource-row').length,3);assert.equal(document.querySelector('.result-summary strong').textContent,'3');assert.doesNotMatch(document.body.textContent,/候选|备用来源|正在补充/);assert.equal(document.querySelector('.recommended-badge'),null);assert.equal(document.querySelector('.result-versions'),null);}finally{view.app.unmount();}
});

test('请求进行中持续显示旋转图标、搜索中和骨架，不把旧结果当成已完成',async()=>{
 const view=mount({isAnalyzing:false,searchPending:true,quarkResources:[resource('斗破苍穹 更新176集',0)]});
 try{await nextTick();assert.ok(document.querySelector('.search-status .search-spinner'));assert.match(document.querySelector('.search-status').textContent,/正在搜索《斗破苍穹》/);assert.match(document.querySelector('.submit-search-button').textContent,/搜索中/);assert.equal(document.querySelectorAll('.liquid-resource-row').length,0);assert.equal(document.querySelector('.result-summary'),null);assert.equal(document.querySelector('.empty-notice'),null);
 view.state.searchPending=false;view.state.quarkResources=[resource('斗破苍穹 更新219集',1)];await nextTick();assert.equal(document.querySelector('.search-status'),null);assert.equal(document.querySelector('.resource-loading'),null);assert.match(document.querySelector('.row-title').textContent,/219/);}finally{view.app.unmount();}
});

test('真实空结果显示未找到，失败显示错误与重新搜索，二者不混用',async()=>{
 let retries=0;const view=mount({}, {onRetrySearch:()=>retries++});
 try{await nextTick();assert.match(document.querySelector('.empty-notice').textContent,/未找到《斗破苍穹》/);assert.equal(document.querySelector('.search-status'),null);assert.equal(document.querySelector('.result-summary'),null);
 view.state.searchError='搜索超时，请重试';await nextTick();assert.equal(document.querySelector('.empty-notice').getAttribute('role'),'alert');assert.doesNotMatch(document.querySelector('.empty-notice').textContent,/未找到/);document.querySelector('.retry-search-button').click();assert.equal(retries,1);
 view.state.isAnalyzing=true;view.state.searchPending=true;view.state.searchError='';await nextTick();assert.ok(document.querySelector('.search-status'));assert.equal(document.querySelector('.empty-notice'),null);}finally{view.app.unmount();}
});

test('搜索中可编辑新片名，同词重复点击和保存时提交被阻止',async()=>{
 const searched=[];const view=mount({isAnalyzing:true,searchPending:true},{onSearch:(...args)=>searched.push(args)});
 try{await nextTick();const input=document.querySelector('.result-search input'),button=document.querySelector('.submit-search-button');assert.equal(input.disabled,false);assert.equal(button.disabled,true);input.value='新的片名';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await nextTick();assert.equal(button.disabled,false);button.click();assert.deepEqual(searched,[['新的片名','anime']]);view.state.isSaving=true;await nextTick();assert.equal(input.disabled,true);assert.equal(button.disabled,true);}finally{view.app.unmount();}
});

test('219集实际返回时排在176集之前，不用收录日期或4K冒充最新集数',async()=>{
 const old={...resource('斗破苍穹 年番 更新176集 4K',0),datetime:'2026-11-14'};
 const latest={...resource('斗破苍穹 更新219集 1080P',1),datetime:'2025-01-01'};
 const view=mount({quarkResources:[old,latest]});
 try{await nextTick();assert.match(document.querySelector('.row-title').textContent,/219/);[...document.querySelectorAll('[role="radio"]')].find(x=>x.textContent==='更新集数').click();await nextTick();assert.match(document.querySelector('.row-title').textContent,/219/);assert.doesNotMatch(document.body.textContent,/候选|正篇优先/);}finally{view.app.unmount();}
});

test('不存在219集时如实展示176，不生成或改写集数，切词重置筛选和滚动',async()=>{
 const view=mount({quarkResources:[resource('斗破苍穹 更新176集 4K',0),resource('斗破苍穹 更新176集 1080P',2)]});
 try{await nextTick();assert.doesNotMatch(document.body.textContent,/219/);[...document.querySelectorAll('[role="radio"]')].find(x=>x.textContent==='4K').click();await nextTick();document.querySelector('.dialog-body').scrollTop=500;view.state.searchKeyword='新搜索';view.state.quarkResources=[resource('新搜索 更新219集 1080P',1)];await nextTick();assert.equal(document.querySelector('.result-filters'),null);assert.equal(document.querySelector('.dialog-body').scrollTop,0);assert.equal(document.querySelectorAll('.liquid-resource-row').length,1);}finally{view.app.unmount();}
});

test('当前真实结果仍过滤明确无关类型和二创，特别篇属于同名结果可查看',async()=>{
 const titles=['斗破苍穹 年番 更新219集','斗破苍穹3：除恶 (2024)[4K][剧情 动作 奇幻]','斗破苍穹 特别篇1 4K','斗破苍穹 壁纸','斗破苍穹 有声小说','斗破苍穹 沙雕版'];
 const view=mount({quarkResources:titles.map(resource)});
 try{await nextTick();assert.equal(document.querySelectorAll('.liquid-resource-row').length,2);assert.doesNotMatch(document.querySelector('.resource-rows').textContent,/除恶|壁纸|有声|沙雕/);assert.match(document.querySelector('.resource-rows').textContent,/特别篇/);}finally{view.app.unmount();}
});

test('全部类型使用来源明确分类保存，219集信息独立展示且严格匹配作品',async()=>{
 const saved=[];const item={...resource('斗破苍穹年番',0),workTitle:'斗破苍穹年番',category:'anime',year:'2022',updateText:'更新至第219集',latestEpisode:219,verification:{summary:'已核对第219集的视频文件',episodeCount:1,latestEpisode:219,requestedEpisode:219,selectedFids:['e219'],requiredEpisodes:[219],shareTitle:'斗破苍穹年番'}};
 const view=mount({searchCategory:'all',searchKeyword:'斗破苍穹 第219集',quarkResources:[item]}, {onSaveToCards:(...args)=>saved.push(args)});
 try{await nextTick();assert.match(document.querySelector('.update-badge').textContent,/219/);assert.match(document.querySelector('.category-picker-trigger').textContent,/全部类型/);document.querySelector('.btn-transfer').click();assert.equal(saved[0][1],'anime');}finally{view.app.unmount();}
});

test('单个已核对结果直接衔接保存，保存期间禁用重复提交，失败能重试，成功提供播放和片库入口',async()=>{
 const item={...resource('斗破苍穹年番',0),category:'anime',verification:{summary:'已核对第219集的视频文件',episodeCount:1,latestEpisode:219,selectedFids:['e219'],requiredEpisodes:[219],shareTitle:'斗破苍穹年番'}};
 const actions=[];const view=mount({quarkResources:[item]}, {onSaveToCards:()=>actions.push('save'),onPlaySaved:()=>actions.push('play'),onViewLibrary:()=>actions.push('library')});
 try{await nextTick();assert.match(document.querySelector('.ready-heading').textContent,/可以保存/);assert.equal(document.querySelector('.result-filters'),null);assert.equal(document.querySelector('.btn-transfer').textContent.trim(),'保存到片库');document.querySelector('.btn-transfer').click();assert.deepEqual(actions,['save']);
 view.state.isSaving=true;view.state.savingResourceId='0';await nextTick();assert.equal(document.querySelector('.btn-transfer').disabled,true);assert.match(document.querySelector('.btn-transfer').textContent,/正在保存/);document.querySelector('.btn-transfer').click();assert.deepEqual(actions,['save']);
 view.state.isSaving=false;view.state.saveError={title:'保存失败',message:'网络错误'};view.state.failedResourceId='0';await nextTick();assert.match(document.querySelector('.resource-save-error').textContent,/网络错误/);assert.equal(document.querySelector('.save-receipt'),null);
 view.state.saveError=null;view.state.savedMedia={title:'斗破苍穹年番',quarkFid:'saved',category:'anime'};view.state.savedSummary=item.verification.summary;await nextTick();assert.match(document.querySelector('.save-receipt').textContent,/已保存到片库/);assert.equal(document.querySelector('.resource-rows'),null);const buttons=document.querySelectorAll('.receipt-actions button');buttons[0].click();buttons[1].click();assert.deepEqual(actions,['save','play','library']);}finally{view.app.unmount();}
});

test('核对阶段持续加载，失效或缺少目标集数直接显示未找到且无保存按钮',async()=>{
 const view=mount({isAnalyzing:true,searchPhase:'verifying',verificationProgress:'正在核对第219集…'});
 try{await nextTick();assert.match(document.querySelector('.search-status').textContent,/核对第219集/);assert.equal(document.querySelector('.btn-transfer'),null);view.state.isAnalyzing=false;view.state.searchNotice='未找到《斗破苍穹》第219集的可用视频。分享中没有第219集。';await nextTick();assert.match(document.querySelector('.empty-notice').textContent,/未找到/);assert.equal(document.querySelector('.btn-transfer'),null);}finally{view.app.unmount();}
});

test('官方进度和实际片源分开显示，不把只找到219集说成已跟上220集',async()=>{
 const item={...resource('斗破苍穹年番',0),category:'anime',verification:{summary:'第219集',latestEpisode:219,episodeCount:1,requiredEpisodes:[219],complete:false}};
 const view=mount({quarkResources:[item],officialProgress:{title:'斗破苍穹年番',platform:'腾讯视频',latestEpisode:220,completed:false,sourceUrl:'https://v.qq.com/x/cover/test/latest.html'}});
 try{await nextTick();assert.match(document.querySelector('.official-progress').textContent,/官方更新至第 220 集/);assert.match(document.querySelector('.official-availability').textContent,/暂未找到.*220/);
 view.state.officialProgress.latestEpisode=219;await nextTick();assert.match(document.querySelector('.official-availability').textContent,/已找到.*219/);
 }finally{view.app.unmount();}
});

test('线上部分来源失败且无可用分享时保留官方进度，提供重试但不允许虚假入库',async()=>{
 let retried=0;
 const view=mount({searchError:'片源查询未完成：部分来源无法访问。',officialProgress:{title:'斗破苍穹年番',platform:'腾讯视频',latestEpisode:219,completed:true,sourceUrl:'https://v.qq.com/x/cover/test/latest.html'}},{onRetrySearch:()=>retried++});
 try{await nextTick();assert.match(document.querySelector('.official-availability').textContent,/无法确认/);assert.equal(document.querySelector('.btn-transfer'),null);document.querySelector('.retry-search-button').click();assert.equal(retried,1);}finally{view.app.unmount();}
});
