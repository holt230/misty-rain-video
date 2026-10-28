import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const dom = new JSDOM('<html><body></body></html>', { url: 'https://preview.test/', pretendToBeVisual: true });
for (const key of ['window','document','Element','HTMLElement','HTMLMediaElement','HTMLVideoElement','Node','Event','MouseEvent','CustomEvent']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis,'navigator',{ configurable:true, value:dom.window.navigator });
Object.defineProperty(navigator,'userAgent',{ configurable:true, value:'Android Chrome' });
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.localStorage = window.localStorage;
window.HTMLMediaElement.prototype.load = () => {};
window.HTMLMediaElement.prototype.pause = () => {};
const folder=fs.mkdtempSync('.local-runtime/tests/xgplayer-');
const outfile=path.resolve(folder,'adapter.mjs');
await build({ entryPoints:['src/services/xgplayerAdapter.ts'],outfile,bundle:true,format:'esm',platform:'browser',logLevel:'silent',define:{'process.env.NODE_ENV':'"test"'} });
const { createDirectPlayer }=await import(pathToFileURL(outfile));
const tick=async()=>{ await new Promise(resolve=>setImmediate(resolve)); };
function setup() {
 document.body.innerHTML='<div id="column"><div id="stage"><video playsinline><track kind="subtitles" label="中文"></video></div></div>';
 const root=document.querySelector('#stage'),video=root.querySelector('video');
 video.src='https://quark.example/signed.mp4';video.currentTime=42;
 let paused=true,playCalls=0;Object.defineProperty(video,'paused',{configurable:true,get:()=>paused});
 Object.defineProperty(video,'duration',{configurable:true,value:600});Object.defineProperty(video,'readyState',{configurable:true,value:4});
 video.play=async()=>{playCalls++;if(!paused)return;paused=false;video.dispatchEvent(new Event('play'));video.dispatchEvent(new Event('playing'));};
 video.pause=()=>{paused=true;video.dispatchEvent(new Event('pause'));};
 root.getBoundingClientRect=()=>({left:0,top:0,width:800,height:450});
 let full=0;const feedback=[];
 const adapter=createDirectPlayer(root,video,{fullscreen:()=>{full++;},feedback:msg=>feedback.push(msg)});
 return {root,video,adapter,feedback,get full(){return full;},get playCalls(){return playCalls;}};
}
test('xgplayer attaches to the existing native video without a second URL loader or CORS/relay mutation',async()=>{
 const view=setup();try{await tick();assert.equal(view.adapter.player.video,view.video);assert.equal(document.querySelectorAll('video').length,1);assert.equal(view.video.src,'https://quark.example/signed.mp4');assert.equal(view.video.currentTime,42);assert.equal(view.video.hasAttribute('crossorigin'),false);assert.equal(view.adapter.player.handleSource,false);assert.equal(view.adapter.player.config.cssFullscreen,false);assert.equal(view.adapter.player.config.fullscreen.rotateFullscreen,false);assert.ok(!view.adapter.player.plugins.hls);assert.ok(!view.adapter.player.plugins.testspeed);assert.equal(view.video.querySelectorAll('track').length,1);}finally{view.adapter.destroy();}
});
test('library play/pause and playback-rate controls operate the same media element',async()=>{
 const view=setup();try{await tick();const play=view.root.querySelector('[aria-label="播放或暂停"]');play.click();assert.equal(view.video.paused,false);play.click();assert.equal(view.video.paused,true);
 view.adapter.player.playbackRate=1.5;assert.equal(view.video.playbackRate,1.5);assert.equal(view.video.defaultPlaybackRate,1.5);
 }finally{view.adapter.destroy();}
});
test('fullscreen button and keyboard activation use the native fullscreen policy rather than CSS fallback',async()=>{
 const view=setup();try{await tick();const full=view.root.querySelector('[aria-label="全屏播放"]');full.click();assert.equal(view.full,1);full.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(view.full,2);view.adapter.setFullscreen(true);assert.equal(full.getAttribute('aria-label'),'退出全屏');assert.equal(full.getAttribute('data-state'),'full');view.adapter.setFullscreen(false);assert.equal(full.getAttribute('aria-label'),'全屏播放');assert.equal(view.root.classList.contains('xgplayer-cssfullscreen'),false);}finally{view.adapter.destroy();}
});
test('mobile edge double taps reuse the library hook and seek ten seconds',async()=>{
 const view=setup();try{await tick();await view.video.play();const mobile=view.adapter.player.plugins.mobile;
 mobile.onDbClick(new MouseEvent('dblclick',{clientX:760}));await tick();assert.equal(view.video.currentTime,52);
 mobile.onDbClick(new MouseEvent('dblclick',{clientX:20}));await tick();assert.equal(view.video.currentTime,42);
 assert.deepEqual(view.feedback,['快进 10 秒','后退 10 秒']);
 }finally{view.adapter.destroy();}
});
function tap(target) {
 const point={identifier:1,target,clientX:200,clientY:150,pageX:200,pageY:150,screenX:200,screenY:150};
 for(const type of ['touchstart','touchend']) {
  const event=new Event(type,{bubbles:true,cancelable:true});
  Object.defineProperty(event,'touches',{value:type==='touchstart'?[point]:[]});
  Object.defineProperty(event,'changedTouches',{value:[point]});
  target.dispatchEvent(event);
 }
}
test('mobile touch reveals auto-hidden controls and the revealed play button can pause',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 // The library mixes global timers and window.clearTimeout; keep one browser clock.
 t.mock.method(window,'setTimeout',globalThis.setTimeout);t.mock.method(window,'clearTimeout',globalThis.clearTimeout);
 const view=setup();try{
  await tick();await view.video.play();t.mock.timers.tick(3100);await tick();
  assert.ok(view.root.classList.contains('xgplayer-inactive'));
  const trigger=view.root.querySelector('xg-trigger');assert.ok(trigger);
  tap(trigger);t.mock.timers.tick(250);await tick();
  assert.equal(view.root.classList.contains('xgplayer-inactive'),false);
  assert.equal(view.video.paused,false,'revealing the toolbar must not pause playback');
  assert.equal(view.playCalls,1,'a tap must not be consumed as a redundant native play request');
  const play=view.root.querySelector('[aria-label="播放或暂停"]');
  play.dispatchEvent(new Event('touchend',{bubbles:true,cancelable:true}));await tick();
  assert.equal(view.video.paused,true);
  t.mock.timers.tick(5000);await tick();assert.equal(view.root.classList.contains('xgplayer-inactive'),false);
  play.dispatchEvent(new Event('touchend',{bubbles:true,cancelable:true}));await tick();
  t.mock.timers.tick(3100);await tick();assert.ok(view.root.classList.contains('xgplayer-inactive'));
  tap(trigger);t.mock.timers.tick(250);await tick();assert.equal(view.root.classList.contains('xgplayer-inactive'),false,'can reveal repeatedly');
  view.video.pause();view.video.dispatchEvent(new Event('emptied'));view.video.src='https://quark.example/episode2.mp4';await view.video.play();
  t.mock.timers.tick(3100);await tick();tap(trigger);t.mock.timers.tick(250);await tick();
  assert.equal(view.root.classList.contains('xgplayer-inactive'),false,'switching the native source keeps first-tap reveal working');
 }finally{view.adapter.destroy();}
});
test('destroy and recreate leave one control tree and no stale event handler',async()=>{
 const view=setup();await tick();const old=view.root.querySelector('[aria-label="播放或暂停"]');view.adapter.destroy();
 assert.equal(view.root.querySelectorAll('.xgplayer-controls').length,0);assert.ok(view.root.contains(view.video));
 let requested=0;const next=createDirectPlayer(view.root,view.video,{fullscreen:()=>requested++,feedback:()=>{}});
 try{await tick();assert.equal(view.root.querySelectorAll('.xgplayer-controls').length,1);assert.equal(view.root.querySelectorAll('video').length,1);assert.equal(old.isConnected,false);view.root.querySelector('[aria-label="全屏播放"]').click();assert.equal(requested,1);assert.equal(view.full,0);}finally{next.destroy();}
});
test('iPad desktop mode keeps touch gestures while a real Mac keeps keyboard controls',async()=>{
 const original={userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints};
 try {
  Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15'});
  Object.defineProperty(navigator,'platform',{configurable:true,value:'MacIntel'});
  for(const points of [5,0]) {
   Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:points});
   const view=setup();
   try { await tick(); assert.equal(Boolean(view.adapter.player.plugins.mobile),points>1); assert.equal(Boolean(view.adapter.player.plugins.keyboard),points===0); }
   finally { view.adapter.destroy(); }
  }
 } finally { for(const [key,value] of Object.entries(original))Object.defineProperty(navigator,key,{configurable:true,value}); }
});
test.after(()=>{dom.window.close();fs.rmSync(folder,{recursive:true,force:true});});


test('rotated seeking uses the visual vertical axis and the screen lock blocks click and seek gestures',async()=>{
 const v=setup();try{await tick();await v.video.play();v.adapter.setRotation(90);v.root.getBoundingClientRect=()=>({left:0,top:0,width:450,height:800});
 const progress=v.adapter.player.plugins.progress;progress.root.getBoundingClientRect=()=>({left:0,top:20,width:2,height:760});assert.equal(progress.computeTime({},210).percent,.25);
 v.adapter.player.plugins.mobile.onDbClick(new MouseEvent('dblclick',{clientX:100,clientY:760}));await tick();assert.equal(v.video.currentTime,52);
 v.adapter.setLocked(true);v.adapter.player.plugins.mobile.onDbClick(new MouseEvent('dblclick',{clientX:100,clientY:760}));v.adapter.player.plugins.mobile.onClick(new MouseEvent('click'));await tick();assert.equal(v.video.currentTime,52);assert.equal(v.video.paused,false);assert.equal(v.root.querySelector('.xgplayer-controls').inert,true);
 v.adapter.setLocked(false);assert.equal(v.root.querySelector('.xgplayer-controls').inert,false);v.adapter.setRotation(0);assert.equal(v.adapter.player.rotateDeg,0);
 }finally{v.adapter.destroy();}
});
