import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {parse,compileScript} from 'vue/compiler-sfc';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
for(const key of ['window','document','Element','HTMLElement','SVGElement','Node'])globalThis[key]=dom.window[key];
globalThis.getComputedStyle=window.getComputedStyle.bind(window);
let top=0,width=390;Object.defineProperty(window,'scrollY',{get:()=>top});Object.defineProperty(window,'innerWidth',{get:()=>width});window.matchMedia=()=>({matches:width<1024});
const {createApp,h,reactive,nextTick}=await import('vue');
const folder=fs.mkdtempSync('.local-runtime/tests/pull-refresh-'),file=path.resolve(folder,'pull.mjs');
await build({entryPoints:['src/components/common/PullToRefresh.vue'],outfile:file,bundle:true,format:'esm',external:['vue'],logLevel:'silent',plugins:[{name:'vue',setup(b){b.onLoad({filter:/\.vue$/},args=>{const {descriptor}=parse(fs.readFileSync(args.path,'utf8'));return {contents:compileScript(descriptor,{id:args.path,inlineTemplate:true}).content,loader:'ts',resolveDir:path.dirname(args.path)};});}}]});
const Pull=(await import(pathToFileURL(file))).default;
const flush=async()=>{await nextTick();await Promise.resolve();await nextTick();};
const touch=(target,type,x,y,count=1)=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:type==='touchend'||type==='touchcancel'?[]:Array.from({length:count},()=>({clientX:x,clientY:y}))});target.dispatchEvent(e);return e;};
function mount(refresh){document.body.innerHTML='<div id="mount"></div>';top=0;width=390;let errors=0;const state=reactive({enabled:true,pageKey:'library'});const app=createApp({render:()=>h('main',{class:'content-pages'},[h(Pull,{...state,refresh,onError:()=>errors++}),h('button',{id:'content'},'影片'),h('div',{id:'inner',style:'overflow-y:auto'},'内部列表'),h('input')])});app.mount('#mount');return {app,state,get errors(){return errors},target:document.querySelector('#content')};}
const pull=(el,dy=140,dx=0)=>{touch(el,'touchstart',150,150);const move=touch(el,'touchmove',150+dx,150+dy);touch(el,'touchend',150+dx,150+dy);return move;};
test('pull threshold triggers one refresh, preserves the spinner during repeated touches and suppresses a trailing click',async()=>{
 let calls=0,done;const v=mount(()=>{calls++;return new Promise(r=>done=r);});try{
  pull(v.target,60);await flush();assert.equal(calls,0);assert.equal(pull(v.target,30,100).defaultPrevented,false);
  assert.equal(pull(v.target).defaultPrevented,true);await flush();assert.equal(calls,1);assert.equal(document.querySelector('.pull-refresh').dataset.state,'refreshing');
  pull(v.target);await flush();assert.equal(calls,1);assert.match(document.querySelector('.pull-refresh').style.transform,/56px/);
  const click=new window.MouseEvent('click',{bubbles:true,cancelable:true,detail:1});v.target.dispatchEvent(click);assert.equal(click.defaultPrevented,true);
  done();await flush();assert.equal(document.querySelector('.pull-refresh').style.display,'none');
 }finally{v.app.unmount();}
});
test('scrolled documents, nested scrolling, forms, disabled pages and desktop do not intercept dragging',async()=>{
 let calls=0;const v=mount(async()=>calls++);try{
  top=40;assert.equal(pull(v.target).defaultPrevented,false);top=0;
  const inner=document.querySelector('#inner');Object.defineProperties(inner,{scrollHeight:{value:300},clientHeight:{value:100}});assert.equal(pull(inner).defaultPrevented,false);
  document.querySelector('input').focus();assert.equal(pull(v.target).defaultPrevented,false);document.activeElement.blur();
  v.state.enabled=false;await flush();assert.equal(pull(v.target).defaultPrevented,false);v.state.enabled=true;await flush();width=1440;assert.equal(pull(v.target).defaultPrevented,false);assert.equal(calls,0);
 }finally{v.app.unmount();}
});
test('route change and cancellation cannot commit a pull or report stale refresh failures',async()=>{
 let calls=0,reject;const v=mount(()=>{calls++;return new Promise((_,r)=>reject=r);});try{
  touch(v.target,'touchstart',150,150);touch(v.target,'touchmove',150,300);touch(v.target,'touchcancel',150,300);touch(v.target,'touchend',150,300);await flush();assert.equal(calls,0);
  pull(v.target);await flush();v.state.pageKey='history';await flush();reject(new Error('old'));await flush();assert.equal(v.errors,0);assert.equal(document.querySelector('.pull-refresh').style.display,'none');
  v.app.unmount();pull(document.body);await flush();assert.equal(calls,1);
 }finally{v.app.unmount();}
});
test('refresh failures dismiss feedback and allow another pull',async()=>{
 let calls=0;const v=mount(async()=>{calls++;throw new Error('network');});try{pull(v.target);await flush();assert.equal(v.errors,1);assert.equal(document.querySelector('.pull-refresh').style.display,'none');pull(v.target);await flush();assert.equal(calls,2);}finally{v.app.unmount();}
});
test.after(()=>{dom.window.close();fs.rmSync(folder,{recursive:true,force:true});});
