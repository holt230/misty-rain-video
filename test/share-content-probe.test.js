import test from 'node:test';
import assert from 'node:assert/strict';
import { QuarkGateway } from '../server/quarkGateway.js';
const folder=(fid)=>({fid,file_name:fid,file_type:0});
const file=(fid,name)=>({fid,file_name:name,file_type:1,size:1,duration:1});
const input={shareUrl:'https://pan.quark.cn/s/content'};
function fixture(t,tree,metadata={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=new URL(url);calls.push(u);assert.ok(init.signal);
  if(u.pathname.endsWith('/token'))return Response.json({code:0,data:{stoken:'fixture'}});
  assert.ok(u.pathname.endsWith('/sharepage/detail'),'must not transfer or request playback URLs');
  const items=tree.get(u.searchParams.get('pdir_fid'))||[],page=Number(u.searchParams.get('_page'));
  return Response.json({code:0,metadata:{_page:page,_size:100,_total:items.length,...metadata},data:{list:items.slice((page-1)*100,page*100)}});
 });
 const gateway=new QuarkGateway({credentialStore:{getCookie:()=> 'test-cookie'}});t.after(()=>clearInterval(gateway.cleanupTimer));return {gateway,calls};
}
test('a wrapper directory with an accessible unnumbered tiny video is sufficient; no size or duration heuristics',async t=>{
 const {gateway,calls}=fixture(t,new Map([['0',[folder('series')]],['series',[file('v','特别篇.mp4')]]]));
 assert.equal((await gateway.probeShare(input)).videoCount,1);assert.equal(calls.length,3);
});
for(const tree of [new Map([['0',[]]]),new Map([['0',[folder('docs')]],['docs',[file('readme','说明.txt'),file('url','观看地址.url')]]])])test('fully checked empty or non-video-only directories are rejected as no video',async t=>{
 const {gateway}=fixture(t,tree);await assert.rejects(gateway.probeShare(input),{code:'QUARK_VIDEO_NOT_FOUND'});
});
test('declared files with an empty listing are incomplete, never a confirmed empty share',async t=>{
 const {gateway}=fixture(t,new Map([['0',[]]]),{_total:26});await assert.rejects(gateway.probeShare(input),{code:'QUARK_SHARE_LIST_INCOMPLETE'});
});
test('probe stops after positive evidence instead of reading thousands of video entries',async t=>{
 const {gateway,calls}=fixture(t,new Map([['0',[file('v','01.mp4')]]]),{_total:5000});
 assert.equal((await gateway.probeShare(input)).videoCount,1);assert.equal(calls.length,2);
 // Full playback still refuses to publish an incomplete directory.
 await assert.rejects(gateway.createPlaybackSession(input),{code:'QUARK_SHARE_LIST_INCOMPLETE'});
});
test('exceeding the directory budget is uncertainty rather than an empty-source verdict',async t=>{
 const tree=new Map(Array.from({length:10},(_,i)=>[String(i),[folder(String(i+1))]]));const {gateway,calls}=fixture(t,tree);
 await assert.rejects(gateway.probeShare(input),{code:'QUARK_SHARE_PROBE_INCOMPLETE'});assert.equal(calls.length,9);
});
test('one total deadline aborts stalled content requests and limits per-request time',async t=>{
 const controller=new AbortController(),timeouts=[];
 t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return controller.signal});
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).includes('/token'))return Response.json({code:0,data:{stoken:'fixture'}});
  return new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('Timed out','AbortError')),{once:true});controller.abort();});
 });
 const gateway=new QuarkGateway({credentialStore:{getCookie:()=> 'test-cookie'}});t.after(()=>clearInterval(gateway.cleanupTimer));
 await assert.rejects(gateway.probeShare(input),{code:'QUARK_NETWORK_ERROR'});assert.ok(timeouts.includes(6000));assert.ok(timeouts.filter(ms=>ms!==6000).every(ms=>ms<=3000));
});
