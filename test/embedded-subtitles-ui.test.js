import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/'});
for(const key of ['window','document','Element','HTMLElement','SVGElement','Node','Event'])globalThis[key]=dom.window[key];
globalThis.VTTCue=class {constructor(start,end,text){this.startTime=start;this.endTime=end;this.text=text;this.positionAlign='auto';}};
const {createApp,h,ref,nextTick,markRaw}=await import('vue');
const trackModels=new WeakMap();
Object.defineProperty(dom.window.HTMLTrackElement.prototype,'track',{get(){
 if(!trackModels.has(this)){const element=this,changes=[];let mode='disabled';const track={get kind(){return element.kind},get label(){return element.label},get language(){return element.srclang},get mode(){return mode},set mode(value){changes.push(value);mode=value},changes,cues:[],addCue(c){this.cues.push(c)},removeCue(c){this.cues.splice(this.cues.indexOf(c),1)}};trackModels.set(this,track)}
 return trackModels.get(this);
}});

const folder=fs.mkdtempSync('.local-runtime/tests/captions-'),output=path.resolve(folder,'hook.mjs');
await build({entryPoints:['src/composables/useEmbeddedSubtitles.ts'],outfile:output,bundle:true,format:'esm',external:['vue'],define:{'import.meta.env.BASE_URL':'"/misty-rain/"'},logLevel:'silent'});
const {useEmbeddedSubtitles}=await import(pathToFileURL(output));
const flush=async()=>{for(let i=0;i<6;i++){await new Promise(r=>setImmediate(r));await nextTick()}};
const result=time=>Response.json({code:0,data:{from:time,to:time+90,tracks:[{id:'zh',label:'中文',language:'zh',cues:[{start:time+1,end:time+4,text:'你好 <b>不是 HTML</b>'}]}]}});
function mount(){
 document.body.innerHTML='<div id="mount"></div>';const video=document.createElement('video');const tracks=[];
 const originalAppend=video.appendChild.bind(video);
 video.appendChild=element=>{const track=element.track;tracks.push(track);originalAppend(element);queueMicrotask(()=>element.dispatchEvent(new Event('load')));return element};
 let endpoint,hook;const app=createApp({setup(){endpoint=ref('/api/player/sessions/fixture/embedded-subtitles/source');hook=useEmbeddedSubtitles(ref(markRaw(video)),()=>endpoint.value);return()=>h('div')}});app.mount('#mount');return{app,video,tracks,get endpoint(){return endpoint},get hook(){return hook}};
}
test('late embedded text becomes a centered real TextTrack, seeks load a new window and old cues stay bounded',async t=>{
 const requests=[];t.mock.method(globalThis,'fetch',async input=>{const time=Number(new URL(String(input),'http://localhost').searchParams.get('time'));requests.push(time);return result(time)});
 const view=mount();try{
 await flush();assert.equal(view.tracks.length,1);const cue=view.tracks[0].cues[0];
 assert.deepEqual([cue.position,cue.align,cue.line,cue.size,cue.positionAlign],['auto','center','auto',100,'auto']);assert.match(cue.text,/&lt;b&gt;/);
 view.video.currentTime=50;view.video.dispatchEvent(new Event('timeupdate'));await flush();assert.deepEqual(requests,[0]);
 view.tracks[0].mode='showing';view.tracks[0].changes.length=0;
 view.video.currentTime=400;view.video.dispatchEvent(new Event('seeked'));await flush();assert.deepEqual(requests,[0,360]);
 assert.equal(view.tracks[0].cues.length,1);assert.equal(view.tracks[0].cues[0].startTime,361);assert.deepEqual(view.tracks[0].changes,[],'loading a new window never changes native selection');
 }finally{view.app.unmount()}
 assert.equal(view.tracks[0].mode,'disabled');assert.equal(document.querySelector('track'),null);
});
test('seek while an old window is pending follows the current playhead, not the old request',async t=>{
 let resolve;const requests=[];t.mock.method(globalThis,'fetch',input=>{const time=Number(new URL(String(input),'http://localhost').searchParams.get('time'));requests.push(time);return time===0?new Promise(r=>resolve=r):Promise.resolve(result(time))});
 const view=mount();try{await flush();view.video.currentTime=230;view.video.dispatchEvent(new Event('seeked'));resolve(result(0));await flush();assert.deepEqual(requests,[0,180]);assert.ok(view.tracks[0].cues.some(c=>c.startTime===181));}finally{view.app.unmount()}
});
test('prefetching, backward seeks and revisiting evicted windows keep cues current without reopening disabled captions',async t=>{
 const requests=[];t.mock.method(globalThis,'fetch',async input=>{const time=Number(new URL(String(input),'http://localhost').searchParams.get('time'));requests.push(time);return result(time)});
 const view=mount();try{
  await flush();const track=view.tracks[0];track.mode='disabled';track.changes.length=0;
  view.video.currentTime=78;view.video.dispatchEvent(new Event('timeupdate'));await flush();
  assert.deepEqual(requests,[0,90]);
  view.video.currentTime=95;view.video.dispatchEvent(new Event('timeupdate'));await flush();
  assert.deepEqual(requests,[0,90],'entering a prefetched window does not reread it');
  view.video.currentTime=410;view.video.dispatchEvent(new Event('seeked'));await flush();
  assert.deepEqual(track.cues.map(cue=>cue.startTime),[361]);
  view.video.currentTime=3;view.video.dispatchEvent(new Event('seeked'));await flush();
  assert.deepEqual(requests,[0,90,360,0]);assert.deepEqual(track.cues.map(cue=>cue.startTime),[1]);
  assert.equal(track.mode,'disabled');assert.deepEqual(track.changes,[]);
 }finally{view.app.unmount()}
});
test('switching episodes ignores late responses and clears retired tracks',async t=>{
 let resolve;t.mock.method(globalThis,'fetch',()=>new Promise(r=>resolve=r));const view=mount();await flush();view.endpoint.value='';await flush();resolve(result(0));await flush();assert.equal(view.tracks.length,0);view.app.unmount();
});
test('a temporary failure offers retry, avoids repeated requests on every timeupdate and resumes after retry',async t=>{
 let fail=true,calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;if(fail)throw new Error('network');return result(0)});const view=mount();
 try{await flush();assert.match(view.hook.error.value,/重试/);view.video.dispatchEvent(new Event('timeupdate'));await flush();assert.equal(calls,1);fail=false;view.hook.retry();await flush();assert.equal(view.hook.error.value,'');assert.equal(view.tracks.length,1);}finally{view.app.unmount()}
});
test('temporary HTTP failures recover automatically without a user changing the subtitle switch',async t=>{
 let now=0,scheduled,calls=0;const original=globalThis.setTimeout;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{if([1000,3000,8000].includes(delay)){scheduled=()=>{now+=delay;callback()};return 0}return original(callback,delay,...args)});
 t.mock.method(globalThis,'fetch',async()=>++calls===1?new Response('',{status:502}):result(0));
 const view=mount();try{await flush();assert.equal(calls,1);assert.equal(typeof scheduled,'function');scheduled();await flush();assert.equal(calls,2);assert.equal(view.hook.error.value,'');assert.equal(view.tracks.length,1);}finally{view.app.unmount()}
});
test.after(()=>{dom.window.close();fs.rmSync(folder,{recursive:true,force:true})});
