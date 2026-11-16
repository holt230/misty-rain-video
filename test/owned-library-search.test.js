import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/'});
for(const key of ['window','document','Element','HTMLElement','SVGElement','Node','localStorage'])globalThis[key]=dom.window[key];
dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
const {createApp,h,nextTick}=await import('vue');
await fs.mkdir('.local-runtime/tests',{recursive:true});
const dir=await fs.mkdtemp('.local-runtime/tests/owned-search-');
const output=path.resolve(dir,'search.mjs');
await build({entryPoints:['src/components/catalog/SearchPage.vue'],outfile:output,bundle:true,format:'esm',define:{'import.meta.env.BASE_URL':'"/"'},external:['vue'],plugins:[{name:'vue',setup(b){b.onLoad({filter:/\.vue$/},async args=>({contents:compileScript(parse(await fs.readFile(args.path,'utf8')).descriptor,{id:args.path,inlineTemplate:true}).content,loader:'ts',resolveDir:path.dirname(args.path)}));}}],logLevel:'silent'});
const Search=(await import(pathToFileURL(output))).default;
const compiled=await build({entryPoints:['src/services/libraryPlaybackSelection.ts'],bundle:true,write:false,format:'esm',logLevel:'silent'});
const {libraryPlaybackSelection}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const media={id:'quark:new',title:'D 斗破苍穹',category:'anime',quarkFid:'new',poster:'',tag:''};
const input=async value=>{const field=document.querySelector('input[type=search]');field.value=value;field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await nextTick();};
const submit=()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
function mount(){document.body.innerHTML='<div id="app"></div>';const actions={search:[],play:[],save:[]};const app=createApp({render:()=>h(Search,{library:[media],catalog:[],username:'review',busy:false,onSearch:(...args)=>actions.search.push(args),onPlay:(...args)=>actions.play.push(args),onSave:(...args)=>actions.save.push(args)})});app.mount('#app');return {app,actions};}

test('已保存的斗破苍穹第219集按片名找到，搜索不再用外部找源盖住已有结果',async()=>{
 const view=mount();try{await input('斗破苍穹 第219集');submit();await nextTick();
 assert.deepEqual(view.actions.search,[]);assert.match(document.querySelector('.owned-search-results').textContent,/找到 1 部/);
 const card=document.querySelector('.resume-card');assert.match(card.textContent,/第 219 集/);card.click();assert.equal(view.actions.play[0][0].quarkFid,'new');assert.equal(view.actions.play[0][1],219);
 document.querySelector('.owned-search-results > button').click();assert.deepEqual(view.actions.search,[['斗破苍穹 第219集','all']]);
 }finally{view.app.unmount();}
});
test('分类不同不误用已有片库，真实无匹配时才进入外部查询',async()=>{
 const view=mount();try{await input('斗破苍穹');const select=document.querySelector('select');select.value='tv';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await nextTick();
 assert.equal(document.querySelector('.owned-search-results'),null);submit();assert.deepEqual(view.actions.search,[['斗破苍穹','tv']]);
 }finally{view.app.unmount();}
});
test('直接分享添加需明确分类，不把全部类型下的动漫静默存进电视剧',async()=>{
 const view=mount();try{await input('https://pan.quark.cn/s/realshare');assert.equal(document.querySelector('.search-submit').disabled,true);submit();assert.deepEqual(view.actions.save,[]);
 const select=document.querySelector('select');select.value='anime';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await nextTick();submit();assert.equal(view.actions.save[0][0].category,'anime');assert.equal(view.actions.save[0][0].quarkShareUrl,'https://pan.quark.cn/s/realshare');
 }finally{view.app.unmount();}
});
test('指定219集不能被上一集或第一集替代，缺集和跨季歧义有明确错误',()=>{
 const episodes=[212,213,214,219].map(n=>({fid:'e'+n,episodeNumber:n}));
 assert.deepEqual(libraryPlaybackSelection(episodes,{episodeFid:'e212',position:100,completed:false},219),{index:3,position:0});
 assert.deepEqual(libraryPlaybackSelection(episodes,{episodeFid:'e219',position:100,completed:false},219),{index:3,position:100});
 assert.throws(()=>libraryPlaybackSelection(episodes,null,220),{code:'LIBRARY_EPISODE_NOT_FOUND'});
 assert.throws(()=>libraryPlaybackSelection([{fid:'s1e1',episodeNumber:1},{fid:'s2e1',episodeNumber:1}],null,1),{code:'LIBRARY_EPISODE_AMBIGUOUS'});
 assert.deepEqual(libraryPlaybackSelection(episodes,null,undefined,2),{index:2,position:0});
});
test.after(async()=>{dom.window.close();await fs.rm(dir,{recursive:true,force:true});});
