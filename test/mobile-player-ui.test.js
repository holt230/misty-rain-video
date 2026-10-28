import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
globalThis.localStorage = dom.window.localStorage;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
const { createApp, markRaw, h, ref, nextTick } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/mobile-player-');
const fullscreenOutput = path.resolve(folder, 'fullscreen.mjs');
await build({ entryPoints: ['src/composables/useVideoFullscreen.ts'], outfile: fullscreenOutput, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const { useVideoFullscreen } = await import(pathToFileURL(fullscreenOutput));
const event = name => new dom.window.Event(name);

function video() {
  const element = document.createElement('video');
  let paused = true;
  Object.defineProperty(element, 'paused', { get: () => paused });
  Object.defineProperty(element, 'duration', { value: 120 });
  element.play = async () => { paused = false; element.dispatchEvent(event('play')); };
  element.pause = () => { paused = true; element.dispatchEvent(event('pause')); };
  const tracks = [{ kind: 'subtitles', label: '中文', mode: 'showing' }, { kind: 'metadata', mode: 'hidden' }];
  const events = new dom.window.EventTarget();
  tracks.addEventListener = events.addEventListener.bind(events);
  tracks.removeEventListener = events.removeEventListener.bind(events);
  Object.defineProperty(element, 'textTracks', { value: tracks });
  return element;
}
function mountFullscreen(media) {
  document.body.innerHTML = '<div id="mount"></div>';
  let controls, current;
  const app = createApp({ setup() { current = ref(null); controls = useVideoFullscreen(current); current.value = markRaw(media); return () => h('div'); } });
  app.mount('#mount');
  return { app, controls, current };
}

test('iOS enters native video fullscreen synchronously and restores inline controls on exit', async () => {
  const media = video();
  Object.defineProperty(media, 'readyState', { value: 1 });
  let entered = 0;
  media.webkitEnterFullscreen = () => { entered++; media.webkitDisplayingFullscreen = true; media.dispatchEvent(event('webkitbeginfullscreen')); };
  media.webkitExitFullscreen = () => { media.webkitDisplayingFullscreen = false; media.dispatchEvent(event('webkitendfullscreen')); };
  const view = mountFullscreen(media);
  try {
    const pending = view.controls.toggle();
    assert.equal(entered, 1); assert.equal(view.controls.fullscreen.value, true); assert.equal(media.controls, true);
    await pending; await view.controls.toggle();
    assert.equal(view.controls.fullscreen.value, false); assert.equal(media.controls, false);
    await view.controls.toggle();
  } finally { view.app.unmount(); }
  assert.equal(media.controls, false);
  media.dispatchEvent(event('webkitendfullscreen'));
  assert.equal(view.controls.fullscreen.value, true, 'unmount removes fullscreen listeners');
});

test('standard fullscreen targets only the video and handles native Escape/exit', async () => {
  const media = video();
  Object.defineProperty(media, 'readyState', { value: 1 });
  media.requestFullscreen = async options => {
    assert.deepEqual(options, { navigationUI: 'hide' });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: media });
    document.dispatchEvent(event('fullscreenchange'));
  };
  document.exitFullscreen = async () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    document.dispatchEvent(event('fullscreenchange'));
  };
  const view = mountFullscreen(media);
  try {
    await view.controls.toggle(); assert.equal(document.fullscreenElement, media); assert.equal(media.controls, true);
    await view.controls.toggle(); assert.equal(view.controls.fullscreen.value, false); assert.equal(media.controls, false);
    await view.controls.toggle(); await document.exitFullscreen(); assert.equal(media.controls, false);
  } finally { view.app.unmount(); }
});

test('loading, unsupported and rejected fullscreen requests never simulate a rotated web player', async () => {
  const media = video();
  let ready = 0;
  Object.defineProperty(media, 'readyState', { get: () => ready });
  const view = mountFullscreen(media);
  try {
    await view.controls.toggle(); assert.match(view.controls.error.value, /尚未加载/); assert.equal(media.controls, false);
    ready = 1; await view.controls.toggle(); assert.match(view.controls.error.value, /不支持/); assert.equal(media.controls, false);
    media.requestFullscreen = async () => { throw new Error('denied'); };
    await view.controls.toggle(); assert.match(view.controls.error.value, /无法进入/); assert.equal(media.controls, false);
    assert.equal(view.controls.fullscreen.value, false);
  } finally { view.app.unmount(); }
});
test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });


function mountWeb(media,locked=ref(false)){
 document.body.innerHTML='<div id="mount"></div><section id="web-stage"></section>';
 const container=document.querySelector('#web-stage');container.append(media);let controls,current;
 const app=createApp({setup(){current=ref(markRaw(media));controls=useVideoFullscreen(current,ref(container),false,true,locked);return()=>h('span');}});app.mount('#mount');
 return {app,controls,current,container};
}
test('web fullscreen keeps the same media, cues and playback position, and Escape restores the existing scroll lock',async()=>{
 const media=video();Object.defineProperty(media,'readyState',{value:1});media.src='/movie.mp4';media.currentTime=42;let entered=0;media.webkitEnterFullscreen=()=>entered++;
 document.body.style.overflow='auto';document.documentElement.style.overflow='clip';const v=mountWeb(media);
 try{
  await v.controls.toggle();await nextTick();assert.equal(v.controls.webFullscreen.value,true);assert.equal(v.controls.nativeFullscreen.value,false);assert.equal(entered,0);assert.equal(media.controls,false);assert.equal(media.currentTime,42);assert.equal(media.parentElement,v.container);assert.equal(media.textTracks[0].mode,'showing');assert.equal(document.body.style.overflow,'hidden');
  document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await nextTick();assert.equal(v.controls.fullscreen.value,false);assert.equal(document.body.style.overflow,'auto');assert.equal(document.documentElement.style.overflow,'clip');assert.equal(media.currentTime,42);
  await v.controls.toggle();await nextTick();
 }finally{v.app.unmount();}
 assert.equal(document.body.style.overflow,'auto');document.body.style.overflow='';document.documentElement.style.overflow='';
});
test('explicit native presentation starts synchronously, returns to web mode, and rejection leaves web playback usable',async()=>{
 const media=video();Object.defineProperty(media,'readyState',{value:1});let entered=0;
 const cue={text:'native caption',position:90,align:'end',size:20,snapToLines:false,line:100,positionAlign:'line-right'};media.textTracks[0].cues=[cue];
 media.webkitEnterFullscreen=()=>{entered++;assert.equal(cue.position,'auto');assert.equal(cue.align,'center');assert.equal(cue.size,100);assert.equal(media.classList.contains('player-captions-active'),false);media.webkitDisplayingFullscreen=true;media.dispatchEvent(event('webkitbeginfullscreen'));};
 media.webkitExitFullscreen=()=>{media.webkitDisplayingFullscreen=false;media.dispatchEvent(event('webkitendfullscreen'));};
 const v=mountWeb(media);
 try{
  await v.controls.toggle();await nextTick();media.classList.add('player-captions-active');const pending=v.controls.enterNative();assert.equal(entered,1);await pending;assert.equal(v.controls.webFullscreen.value,true);assert.equal(v.controls.nativeFullscreen.value,true);
  media.webkitExitFullscreen();await nextTick();assert.equal(v.controls.fullscreen.value,true);assert.equal(v.controls.nativeFullscreen.value,false);assert.equal(media.controls,false);
  media.classList.add('player-captions-active');media.webkitEnterFullscreen=()=>{throw new Error('denied');};await v.controls.enterNative();assert.match(v.controls.error.value,/无法进入/);assert.equal(v.controls.webFullscreen.value,true);assert.equal(media.controls,false);assert.equal(media.classList.contains('player-captions-active'),true);
  await v.controls.exit();await nextTick();assert.equal(v.controls.fullscreen.value,false);
 }finally{v.app.unmount();}
});
test('replacing the video keeps web presentation and detaches native events from the previous element',async()=>{
 const media=video();Object.defineProperty(media,'readyState',{value:1});const v=mountWeb(media);
 try{await v.controls.toggle();await nextTick();const replacement=video();v.container.replaceChildren(replacement);v.current.value=markRaw(replacement);await nextTick();media.dispatchEvent(event('webkitbeginfullscreen'));assert.equal(v.controls.nativeFullscreen.value,false);assert.equal(v.controls.webFullscreen.value,true);assert.equal(v.controls.fullscreen.value,true);}finally{v.app.unmount();}
});


test('web viewport stays upright, auto enters landscape and preserves the locked frame',async()=>{
 const w=Object.getOwnPropertyDescriptor(window,'innerWidth'),hh=Object.getOwnPropertyDescriptor(window,'innerHeight'),vv=Object.getOwnPropertyDescriptor(window,'visualViewport');
 let width=390,height=844;Object.defineProperty(window,'innerWidth',{configurable:true,get:()=>width});Object.defineProperty(window,'innerHeight',{configurable:true,get:()=>height});
 const viewport=new window.EventTarget();Object.assign(viewport,{width:390,height:844,offsetLeft:0,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
 const media=video();Object.defineProperty(media,'readyState',{value:1});const locked=ref(false);const v=mountWeb(media,locked);
 const resized=async()=>{window.dispatchEvent(event('resize'));viewport.dispatchEvent(event('resize'));await new Promise(r=>window.requestAnimationFrame(()=>window.requestAnimationFrame(r)));await nextTick();};
 try{
  await v.controls.toggle();assert.equal(v.controls.webRotation.value,0);assert.equal(v.controls.webStyle.value['--web-width'],'390px');assert.equal(v.controls.webStyle.value['--web-height'],'844px');
  viewport.height=780;viewport.offsetTop=32;await resized();assert.equal(v.controls.webStyle.value['--web-center-y'],'422px');assert.equal(v.controls.webStyle.value['--web-height'],'780px');
  await v.controls.exit();
  width=844;height=390;Object.assign(viewport,{width,height,offsetTop:0});await resized();assert.equal(v.controls.webRotation.value,0);assert.equal(v.controls.webStyle.value['--web-width'],'844px');assert.equal(v.controls.webFullscreen.value,true);
  locked.value=true;width=390;height=844;Object.assign(viewport,{width,height});await resized();assert.equal(v.controls.webStyle.value['--web-width'],'844px');assert.equal(v.controls.webStyle.value['--web-height'],'390px');assert.ok(Number(v.controls.webStyle.value['--web-scale'])<1);
  locked.value=false;await nextTick();assert.equal(v.controls.webStyle.value['--web-width'],'390px');
  await v.controls.exit();await nextTick();viewport.height=200;await resized();assert.deepEqual(v.controls.webStyle.value,{});assert.equal(v.controls.webRotation.value,0);
 }finally{v.app.unmount();if(w)Object.defineProperty(window,'innerWidth',w);if(hh)Object.defineProperty(window,'innerHeight',hh);if(vv)Object.defineProperty(window,'visualViewport',vv);else delete window.visualViewport;}
});


test('screen lock cancels orientation changes including a same-size landscape flip',async()=>{
 const descriptors={width:Object.getOwnPropertyDescriptor(window,'innerWidth'),height:Object.getOwnPropertyDescriptor(window,'innerHeight'),orientation:Object.getOwnPropertyDescriptor(window.screen,'orientation'),viewport:Object.getOwnPropertyDescriptor(window,'visualViewport')};
 let width=844,height=390;Object.defineProperty(window,'innerWidth',{configurable:true,get:()=>width});Object.defineProperty(window,'innerHeight',{configurable:true,get:()=>height});
 const orientation=new window.EventTarget();orientation.angle=90;Object.defineProperty(window.screen,'orientation',{configurable:true,value:orientation});
 const viewport=new window.EventTarget();Object.assign(viewport,{width,height,offsetLeft:0,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
 const media=video();Object.defineProperty(media,'readyState',{value:1});const locked=ref(false),v=mountWeb(media,locked);
 const rotate=async(angle,w,h)=>{orientation.angle=angle;width=w;height=h;Object.assign(viewport,{width,height});orientation.dispatchEvent(event('change'));await new Promise(r=>window.requestAnimationFrame(()=>window.requestAnimationFrame(r)));await nextTick();};
 try{
  await v.controls.toggle();locked.value=true;await nextTick();
  await rotate(0,390,844);assert.equal(v.controls.webStyle.value['--web-rotation'],'90deg');assert.equal(v.controls.webStyle.value['--web-width'],'844px');assert.equal(v.controls.webStyle.value['--web-height'],'390px');assert.equal(v.controls.webStyle.value['--web-scale'],'1');
  await rotate(270,844,390);assert.equal(v.controls.webStyle.value['--web-rotation'],'180deg');assert.equal(v.controls.webStyle.value['--web-scale'],'1');assert.equal(media.currentTime,0);assert.equal(media.parentElement,v.container);
  await rotate(90,844,390);assert.equal(v.controls.webStyle.value['--web-rotation'],'0deg');
  locked.value=false;await nextTick();await rotate(0,390,844);assert.equal(v.controls.webStyle.value['--web-rotation'],'0deg');assert.equal(v.controls.webStyle.value['--web-width'],'390px');
  locked.value=true;await nextTick();await rotate(90,844,390);assert.equal(v.controls.webStyle.value['--web-rotation'],'270deg');assert.equal(v.controls.webStyle.value['--web-scale'],'1');
  await v.controls.exit();await nextTick();await rotate(270,844,390);assert.deepEqual(v.controls.webStyle.value,{});
 }finally{v.app.unmount();for(const [object,name,descriptor] of [[window,'innerWidth',descriptors.width],[window,'innerHeight',descriptors.height],[window.screen,'orientation',descriptors.orientation],[window,'visualViewport',descriptors.viewport]]){if(descriptor)Object.defineProperty(object,name,descriptor);else delete object[name];}}
});
