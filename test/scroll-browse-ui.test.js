import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Document', 'ShadowRoot', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Event', 'KeyboardEvent', 'CompositionEvent', 'MouseEvent']) globalThis[key] = dom.window[key];
globalThis.localStorage = window.localStorage;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
const { createApp, h, nextTick, reactive, ref } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/navigation-');
async function compile(entry) {
  const outdir = path.resolve(folder, path.basename(entry, '.vue'));
  await build({ entryPoints: [entry], outdir, entryNames: 'index', outExtension: { '.js': '.mjs' }, splitting: true,
    bundle: true, format: 'esm', platform: 'browser', external: ['vue'], logLevel: 'silent',
    define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'vue', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'));
      return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
    }); } }] });
  return (await import(pathToFileURL(path.join(outdir, 'index.mjs')))).default;
}

const ScrollLoad=await compile('src/components/common/ScrollLoad.vue');
const Poster=await compile('src/components/common/MediaPoster.vue');
const History=await compile('src/components/media/HistoryPage.vue');
const flush=async()=>{await nextTick();await new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve)));await nextTick();};
function mount(component,state){document.body.innerHTML='<div id="mount"></div>';const app=createApp({render:()=>h(component,state)});app.mount('#mount');return app;}
const box=(top=20)=>({top,bottom:top+2,width:200,height:2});
test('scroll pagination requests one page per cursor, fills short viewports, and stops for busy/error/inactive/end states',async()=>{
 const original=globalThis.IntersectionObserver;let notify,disconnected=false;
 globalThis.IntersectionObserver=class{constructor(callback){notify=callback;}observe(){}disconnect(){disconnected=true;}};
 const state=reactive({more:true,pending:false,active:true,error:'',progress:0,onLoad:()=>calls++});let calls=0;
 const app=mount(ScrollLoad,state);const node=document.querySelector('.scroll-load');let top=1500;
 node.getClientRects=()=>[box(top)];node.getBoundingClientRect=()=>box(top);
 try{
  await flush();assert.equal(calls,0);top=20;notify([{isIntersecting:true}]);await flush();assert.equal(calls,1);
  notify([{isIntersecting:true}]);window.dispatchEvent(new Event('resize'));await flush();assert.equal(calls,1);
  state.pending=true;state.progress=24;await flush();assert.equal(calls,1);state.pending=false;await flush();assert.equal(calls,2);
  state.progress=48;state.error='加载失败';await flush();assert.equal(calls,2);document.querySelector('button').click();assert.equal(calls,3);
  state.error='';await flush();assert.equal(calls,3,'retry owns this cursor until it advances');
  state.active=false;state.progress=72;await flush();assert.equal(calls,3);state.active=true;await flush();assert.equal(calls,4);
  state.more=false;state.progress=96;await flush();assert.equal(calls,4);
 }finally{app.unmount();globalThis.IntersectionObserver=original;}
 await flush();assert.equal(disconnected,true);
});
test('pagination waits for the end of a nested scrolling panel and ignores hidden page sentinels',async()=>{
 let calls=0;const state=reactive({more:true,progress:'first',onLoad:()=>calls++});const app=mount(ScrollLoad,state);
 const node=document.querySelector('.scroll-load'),panel=document.createElement('div');panel.style.overflowY='auto';panel.getBoundingClientRect=()=>({top:0,bottom:200,width:300,height:200});node.parentNode.insertBefore(panel,node);panel.append(node);
 let top=700,hidden=false;node.getClientRects=()=>hidden?[]:[box(top)];node.getBoundingClientRect=()=>box(top);
 try{await flush();assert.equal(calls,0);top=180;window.dispatchEvent(new Event('resize'));await flush();assert.equal(calls,1);hidden=true;state.progress='next';await flush();assert.equal(calls,1);}finally{app.unmount();}
});
test('matching Douban identity wins over a saved thumbnail and failures fall back without changing the film',async()=>{
 const state=reactive({src:'/small.jpg',catalogId:'douban-123',alt:'海报'});const app=mount(Poster,state);
 try{const img=document.querySelector('img');assert.equal(img.getAttribute('src'),'/api/discovery/posters/douban-123?v=2');img.dispatchEvent(new Event('error'));await nextTick();assert.equal(img.getAttribute('src'),'/small.jpg');img.dispatchEvent(new Event('error'));await nextTick();assert.equal(img.getAttribute('src'),'/poster-placeholder.svg');img.dispatchEvent(new Event('error'));await nextTick();assert.equal(img.classList.contains('poster-loading'),false);state.catalogId='douban-456';await nextTick();assert.equal(img.getAttribute('src'),'/api/discovery/posters/douban-456?v=2');}finally{app.unmount();}
});
test('history search scans records beyond the rendered page and clearing restores the first batch',async()=>{
 const entries=Array.from({length:65},(_,i)=>({id:String(i),media:{id:String(i),title:`影片${i}`,category:'movie',poster:'',tag:''},episodeTitle:i===64?'特别文件':'',position:30,duration:100}));
 const app=mount(History,{history:entries});try{assert.equal(document.querySelectorAll('.history-row').length,30);const input=document.querySelector('input');input.value='特别文件';input.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();assert.equal(document.querySelectorAll('.history-row').length,1);assert.match(document.querySelector('.history-copy').textContent,/影片64/);document.querySelector('[aria-label="清空搜索"]').click();await nextTick();assert.equal(document.querySelectorAll('.history-row').length,30);assert.equal(document.querySelector('h1'),null);}finally{app.unmount();}
});

test('horizontal pagination waits for its own right edge even when the row is vertically visible',async()=>{
 let calls=0;const state=reactive({horizontal:true,more:true,progress:'first',onLoad:()=>calls++});const app=mount(ScrollLoad,state);
 const node=document.querySelector('.scroll-load'),panel=document.createElement('div');panel.style.overflowX='auto';panel.getBoundingClientRect=()=>({top:0,bottom:200,left:0,right:300,width:300,height:200});node.parentNode.insertBefore(panel,node);panel.append(node);
 let left=900;node.getClientRects=()=>[{width:2,height:100}];node.getBoundingClientRect=()=>({top:20,bottom:120,left,right:left+2,width:2,height:100});
 try{await flush();assert.equal(calls,0);left=390;window.dispatchEvent(new Event('scroll'));await flush();assert.equal(calls,1);window.dispatchEvent(new Event('scroll'));await flush();assert.equal(calls,1);left=800;state.progress='next';await flush();assert.equal(calls,1);}finally{app.unmount();}
});
