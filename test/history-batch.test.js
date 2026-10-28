import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/'});for(const key of ['window','document','Element','HTMLElement','SVGElement','Node'])globalThis[key]=dom.window[key];
const {createApp,h,ref,nextTick}=await import('vue');const folder=fs.mkdtempSync('.local-runtime/tests/history-batch-'),outfile=path.resolve(folder,'history.mjs');
await build({entryPoints:['src/composables/usePlaybackHistory.ts'],outfile,bundle:true,format:'esm',external:['vue'],define:{'import.meta.env.BASE_URL':'"/"'},logLevel:'silent'});const {usePlaybackHistory}=await import(pathToFileURL(outfile));
const entries=['a','b','c'].map(id=>({id,media:{id,title:id,category:'tv',poster:''},updatedAt:'2026-10-24',position:10,duration:100}));
const flush=async()=>{await new Promise(r=>setImmediate(r));await nextTick();};
test('batch deletion removes only successful selected IDs and never restores a stale list response',async t=>{
 let lateRead,reads=0;const deletes=[];t.mock.method(globalThis,'fetch',async(url,options)=>{if(options?.method==='DELETE'){const id=String(url).split('/').at(-1);deletes.push(id);return Response.json(id==='b'?{code:1,message:'failed'}:{code:0,data:[]},{status:id==='b'?503:200});}reads++;if(reads>1)return new Promise(r=>lateRead=r);return Response.json({code:0,data:entries});});
 document.body.innerHTML='<div id="mount"></div>';let api;const app=createApp({setup(){api=usePlaybackHistory(ref(true));return()=>h('div');}});app.mount('#mount');
 try{await flush();const stale=api.refreshHistory(true);const result=await api.removeHistoryBatch(['a','b','a','not-present']);assert.deepEqual(result.deleted,['a']);assert.deepEqual(result.failed,['b']);assert.deepEqual(deletes.sort(),['a','b']);assert.deepEqual(api.history.value.map(x=>x.id),['b','c']);lateRead(Response.json({code:0,data:entries}));await stale;assert.deepEqual(api.history.value.map(x=>x.id),['b','c']);assert.equal(api.deletingHistoryId.value,'');}finally{app.unmount();}
});
test.after(()=>{dom.window.close();fs.rmSync(folder,{recursive:true,force:true});});
