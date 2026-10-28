import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import test,{after} from 'node:test';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const dom=new JSDOM('<html><body><button id="action">浏览</button><input/></body></html>',{url:'https://test.local/',pretendToBeVisual:true});
for(const k of ['window','document','Element','HTMLElement','SVGElement','Node','Event'])globalThis[k]=dom.window[k];
Object.defineProperty(globalThis,'navigator',{configurable:true,value:window.navigator});
globalThis.localStorage=window.localStorage;document.hasFocus=()=>true;
const {createApp,ref,h,nextTick}=await import('vue');
const folder=fs.mkdtempSync('.local-runtime/clipboard-tests-');
const out=path.resolve(folder,'clipboard.mjs');
await build({stdin:{contents:"export {useClipboardShare} from './src/composables/useClipboardShare';export {clipboardDetection,setClipboardDetection} from './src/services/clipboardSettings';",resolveDir:process.cwd(),loader:'ts'},outfile:out,bundle:true,format:'esm',platform:'browser',external:['vue'],logLevel:'silent'});
const {useClipboardShare,clipboardDetection,setClipboardDetection}=await import(pathToFileURL(out));
after(()=>{dom.window.close();fs.rmSync(folder,{recursive:true,force:true});});
let visibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
const resume=()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'));visibility='visible';document.dispatchEvent(new Event('visibilitychange'));};
const flush=async()=>{await nextTick();await new Promise(resolve=>setImmediate(resolve));await nextTick();};
function mount({state='granted',unsupported=false,read=async()=>'',enabled=true}={}){
 clipboardDetection.value=true;let calls=0;
 const status=new window.EventTarget();status.state=state;
 Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>{if(unsupported)throw new TypeError('unsupported');return status;}}});
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>{calls++;return read();}}});
 const active=ref(enabled);let monitor;const root=document.createElement('div');document.body.append(root);
 const app=createApp({setup(){monitor=useClipboardShare(active);return()=>h('span');}});app.mount(root);
 return {active,monitor,status,calls:()=>calls,close:()=>{app.unmount();root.remove();}};
}
test('default-on setting persists only a boolean; granted reads detect only Quark links and never perform a network request',async t=>{
 assert.equal(clipboardDetection.value,true);let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw new Error('must stay local');});
 const v=mount({read:async()=> '文案 https://pan.quark.cn/s/fixture123 提取码：ab12'});
 try{await flush();assert.deepEqual(v.monitor.share.value,{url:'https://pan.quark.cn/s/fixture123',passcode:'ab12'});assert.equal(network,0);setClipboardDetection(false);await flush();assert.equal(v.monitor.share.value,null);assert.equal(localStorage.getItem('misty_rain_clipboard_detection'),'off');assert.ok(!JSON.stringify(localStorage).includes('fixture123'));}finally{v.close();}
});
test('dismissal deduplicates the same share and changing a passcode is a new actionable resource',async()=>{
 let text='https://pan.quark.cn/s/fixture123?pwd=abcd';const v=mount({read:async()=>text});
 try{await flush();v.monitor.dismiss();window.dispatchEvent(new Event('focus'));await flush();assert.equal(v.monitor.share.value,null);text='https://pan.quark.cn/s/fixture123?pwd=efgh';window.dispatchEvent(new Event('focus'));await flush();assert.equal(v.monitor.share.value.passcode,'efgh');}finally{v.close();}
});
test('permission denial offers manual paste; gesture-only browsers never read from unrelated actions',async()=>{
 const denied=mount({state:'denied',read:async()=>{throw new DOMException('denied','NotAllowedError');}});await flush();document.getElementById('action').dispatchEvent(new Event('pointerup',{bubbles:true}));await flush();assert.equal(denied.calls(),0);assert.equal(denied.monitor.notice.value,'manual');denied.close();
 const v=mount({unsupported:true,read:async()=> 'https://pan.quark.cn/s/fixture123'});
 try{await flush();assert.equal(v.calls(),0);document.querySelector('input').dispatchEvent(new Event('pointerup',{bubbles:true}));await flush();assert.equal(v.calls(),0);document.getElementById('action').dispatchEvent(new Event('pointerup',{bubbles:true}));await flush();assert.equal(v.calls(),0);assert.equal(v.monitor.notice.value,'ready');v.monitor.read();assert.equal(v.calls(),1,'read starts synchronously inside the explicit click handler');await flush();assert.ok(v.monitor.share.value);assert.equal(v.monitor.notice.value,'detected');}finally{v.close();}
});
test('rejected reads do not repeatedly prompt, and disabled/logout/unmounted reads cannot publish a stale notice',async()=>{
 let resolve;const v=mount({read:()=>new Promise(r=>resolve=r)});await flush();assert.equal(v.calls(),1);window.dispatchEvent(new Event('focus'));await flush();assert.equal(v.calls(),1);setClipboardDetection(false);resolve('https://pan.quark.cn/s/fixture123');await flush();assert.equal(v.monitor.share.value,null);v.close();
 const reject=mount({read:async()=>{throw new DOMException('cancel','NotAllowedError');}});await flush();window.dispatchEvent(new Event('focus'));document.getElementById('action').dispatchEvent(new Event('pointerup',{bubbles:true}));await flush();assert.equal(reject.calls(),1);reject.close();
 const stale=mount({read:()=>new Promise(r=>resolve=r)});await flush();stale.active.value=false;resolve('https://pan.quark.cn/s/fixture456');await flush();assert.equal(stale.monitor.share.value,null);stale.close();window.dispatchEvent(new Event('focus'));await flush();assert.equal(stale.calls(),1);
});
test('manual activation after re-enabling uses the current generation and unknown clipboard text is discarded',async()=>{
 let text='private non-link text';const v=mount({read:async()=>text});try{await flush();assert.equal(v.monitor.share.value,null);setClipboardDetection(false);await flush();text='https://pan.quark.cn/s/fixture789';setClipboardDetection(true);await flush();assert.ok(v.monitor.share.value);v.monitor.clear();assert.equal(v.monitor.share.value,null);}finally{v.close();}
});


test('cancelled iOS paste recovers on a new foreground session without repeated prompts on ordinary focus',async()=>{
 let attempt=0;const v=mount({unsupported:true,read:async()=>{if(++attempt===1)throw new DOMException('cancel','NotAllowedError');return 'https://pan.quark.cn/s/fixture123 提取码: ab12';}});
 try{
  await flush();assert.equal(v.monitor.notice.value,'ready');v.monitor.read();await flush();assert.equal(v.monitor.notice.value,'manual');
  window.dispatchEvent(new Event('focus'));await flush();assert.equal(v.calls(),1);
  resume();await flush();assert.equal(v.monitor.notice.value,'ready');assert.equal(v.calls(),1);
  v.monitor.read();await flush();assert.equal(v.calls(),2);assert.deepEqual(v.monitor.share.value,{url:'https://pan.quark.cn/s/fixture123',passcode:'ab12'});
 }finally{v.close();}
});

test('dismissal stays quiet in this foreground, BFCache return reoffers, and an explicit paste may reuse a dismissed resource',async()=>{
 const v=mount({unsupported:true,read:async()=> 'https://pan.quark.cn/s/fixture123'});
 try{
  await flush();v.monitor.dismiss();window.dispatchEvent(new Event('focus'));await flush();assert.equal(v.monitor.notice.value,null);
  window.dispatchEvent(new window.PageTransitionEvent('pageshow',{persisted:true}));await flush();assert.equal(v.monitor.notice.value,'ready');
  v.monitor.read();await flush();v.monitor.dismiss();resume();await flush();v.monitor.read();await flush();assert.equal(v.monitor.share.value.url,'https://pan.quark.cn/s/fixture123');
 }finally{v.close();}
});

test('late previous-session reads neither publish stale content nor release a new pending read',async()=>{
 const resolves=[];const v=mount({unsupported:true,read:()=>new Promise(r=>resolves.push(r))});
 try{
  await flush();v.monitor.read();assert.equal(v.monitor.notice.value,'reading');resume();await flush();v.monitor.read();assert.equal(v.calls(),2);
  resolves[0]('https://pan.quark.cn/s/old');await flush();assert.equal(v.monitor.share.value,null);assert.equal(v.monitor.notice.value,'reading');
  v.monitor.read();assert.equal(v.calls(),2);resolves[1]('https://pan.quark.cn/s/current');await flush();assert.equal(v.monitor.share.value.url,'https://pan.quark.cn/s/current');
 }finally{v.close();}
});

test('missing API, explicit empty content, dismissed pending read and editing paste have safe outcomes',async()=>{
 const v=mount({unsupported:true});try{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});await flush();resume();await flush();assert.equal(v.monitor.notice.value,'manual');
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=> 'private text'}});v.monitor.read();await flush();assert.equal(v.monitor.notice.value,'empty');assert.equal(v.monitor.share.value,null);
  let resolve;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>new Promise(r=>resolve=r)}});v.monitor.read();v.monitor.dismiss();resolve('https://pan.quark.cn/s/stale');await flush();assert.equal(v.monitor.notice.value,null);
  const e=new Event('paste',{bubbles:true});Object.defineProperty(e,'clipboardData',{value:{getData:()=> 'https://pan.quark.cn/s/edited'}});document.querySelector('input').dispatchEvent(e);await flush();assert.equal(v.monitor.share.value,null);
 }finally{v.close();}
});

test('known permission change and focus-false explicit activation remain usable while the setting and eligibility gate every read',async()=>{
 const v=mount({state:'denied',read:async()=> 'https://pan.quark.cn/s/fixture123'});
 try{
  await flush();v.status.state='granted';v.status.dispatchEvent(new Event('change'));await flush();assert.ok(v.monitor.share.value);
  v.monitor.dismiss();document.hasFocus=()=>false;v.monitor.read();await flush();assert.ok(v.monitor.share.value);
  setClipboardDetection(false);const before=v.calls();v.monitor.read();resume();await flush();assert.equal(v.calls(),before);assert.equal(v.monitor.notice.value,null);
 }finally{document.hasFocus=()=>true;v.close();}
});
