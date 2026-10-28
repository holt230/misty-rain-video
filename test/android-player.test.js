import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from 'vue/compiler-sfc';
import { build } from 'esbuild';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android Chrome' });
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
const { createApp, nextTick, reactive, markRaw, h, ref } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/android-player-');
const vuePlugin = { name: 'test-vue', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, args => {
  const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'));
  return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
}); } };
async function bundle(file) {
  const outfile = path.resolve(folder, path.basename(file).replace(/\.(ts|vue)$/, '.mjs'));
  await build({ entryPoints: [file], outfile, bundle: true, format: 'esm', external: ['vue'], plugins: [vuePlugin], logLevel: 'silent' });
  return import(pathToFileURL(outfile));
}
const { default: Captions } = await bundle('src/components/player/PlayerCaptions.vue');
const { captionLayout } = await bundle('src/services/captionLayout.ts');
const { useVideoFullscreen } = await bundle('src/composables/useVideoFullscreen.ts');
const { useAndroidMediaSession } = await bundle('src/composables/useAndroidMediaSession.ts');
const install = await bundle('src/services/androidInstall.ts');
const event = name => new dom.window.Event(name);
const tick = async () => { await nextTick(); await Promise.resolve(); await nextTick(); };
const set = (obj, key, value) => Object.defineProperty(obj, key, { configurable: true, value });
function video() {
  const media = document.createElement('video');
  let paused = true;
  Object.defineProperty(media, 'paused', { get: () => paused });
  set(media, 'duration', 120); set(media, 'readyState', 1); set(media, 'videoWidth', 1920); set(media, 'videoHeight', 1080);
  media.play = async () => { paused = false; media.dispatchEvent(event('play')); };
  media.pause = () => { paused = true; media.dispatchEvent(event('pause')); };
  const tracks = [];
  const emitter = new dom.window.EventTarget();
  for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) tracks[name] = emitter[name].bind(emitter);
  set(media, 'textTracks', tracks);
  media.getBoundingClientRect = () => ({ width: 360, height: 640, left: 0, top: 0 });
  return media;
}
function mount(component, initial) {
  document.body.innerHTML = '<div id="stage"></div><div id="mount"></div>';
  if (initial.video) document.querySelector('#stage').appendChild(initial.video);
  const props = reactive(initial);
  const app = createApp({ render: () => h(component, props) }); app.mount('#mount');
  return { app, props };
}
function hook(setup) {
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ setup() { setup(); return () => h('div'); } }); app.mount('#mount'); return app;
}
function track(text, mode = 'showing', kind = 'subtitles') {
  const item = new dom.window.EventTarget();
  Object.assign(item, { mode, kind, activeCues: [{ startTime: 0, endTime: 120, text, getCueAsHTML: () => { const fragment = document.createDocumentFragment(); fragment.appendChild(document.createTextNode(text)); return fragment; } }] });
  return item;
}
test('caption geometry follows the picture in portrait, landscape and cropped playback', () => {
  const portrait = captionLayout(360, 640, 1920, 1080, 'contain');
  assert.ok(parseFloat(portrait.bottom) > 220); assert.equal(portrait.width, '331.2px');
  assert.equal(captionLayout(800, 450, 1920, 1080, 'contain', 110).bottom, '118px');
  assert.equal(captionLayout(360, 640, 1920, 1080, 'cover').bottom, '25.6px');
});
test('Android captions mirror active text without changing modes, ignore metadata, turn off and hand back to PiP', async () => {
  const media = video(); const caption = track('<script>literal caption</script>'); const metadata = track('hidden metadata', 'showing', 'metadata');
  media.textTracks.push(caption, metadata);
  const view = mount(Captions, { video: markRaw(media), fit: 'contain', controlsInset: 0, nativeFullscreen: false });
  try {
    await tick();
    assert.equal(document.querySelector('.player-captions').textContent, '<script>literal caption</script>');
    assert.equal(document.querySelector('.player-captions script'), null);
    assert.equal(caption.mode, 'showing'); assert.equal(metadata.mode, 'showing');
    assert.ok(media.classList.contains('player-captions-active'));
    caption.mode = 'disabled'; media.textTracks.dispatchEvent(event('change')); await tick();
    assert.equal(document.querySelector('.player-captions'), null);
    caption.mode = 'showing'; caption.dispatchEvent(event('cuechange')); await tick();
    set(document, 'pictureInPictureElement', media); media.dispatchEvent(event('enterpictureinpicture')); await tick();
    assert.equal(document.querySelector('.player-captions'), null); assert.ok(!media.classList.contains('player-captions-active'));
    set(document, 'pictureInPictureElement', null); media.dispatchEvent(event('leavepictureinpicture')); await tick();
    assert.ok(document.querySelector('.player-captions'));
    const replacement = video(); replacement.textTracks.push(track('new episode'));
    view.props.video = markRaw(replacement); await tick();
    caption.dispatchEvent(event('cuechange')); await tick();
    assert.equal(document.querySelector('.player-captions').textContent, 'new episode');
    assert.ok(!media.classList.contains('player-captions-active'));
    view.props.nativeFullscreen = true; await tick(); assert.equal(document.querySelector('.player-captions'), null);
  } finally { view.app.unmount(); set(document, 'pictureInPictureElement', null); }
});

test('paused caption boundaries discard the ended cue while preserving legitimately overlapping text', async () => {
  const media = video(); media.currentTime = 100;
  const captions = track('');
  captions.activeCues = [
    { startTime: 90, endTime: 100, text: '已经结束' },
    { startTime: 100, endTime: 110, text: '当前字幕' },
    { startTime: 95, endTime: 105, text: '同步双语字幕' },
    { startTime: 101, endTime: 110, text: '尚未开始' }
  ];
  media.textTracks.push(captions);
  const view = mount(Captions, { video: markRaw(media), fit: 'contain', controlsInset: 0, nativeFullscreen: false });
  try {
    await tick();
    assert.deepEqual([...document.querySelectorAll('.player-captions span')].map(line => line.textContent), ['当前字幕', '同步双语字幕']);
    media.currentTime = 110; media.dispatchEvent(event('seeked')); await tick();
    assert.equal(document.querySelector('.player-captions'), null, 'a stale activeCues list cannot leave ended captions on screen');
    assert.equal(captions.mode, 'showing');
  } finally { view.app.unmount(); }
});

test('native events release web cue suppression immediately and duplicate tracks never double render', async () => {
  const media = video(); media.textTracks.push(track('selected'), track('duplicate'));
  const view = mount(Captions, { video: markRaw(media), fit: 'contain', controlsInset: 0, nativeFullscreen: false });
  try {
    await tick(); assert.equal(document.querySelector('.player-captions').textContent, 'selected');
    media.dispatchEvent(event('webkitbeginfullscreen'));
    assert.equal(media.classList.contains('player-captions-active'), false, 'native handoff cannot wait for a Vue prop update');
    media.dispatchEvent(event('timeupdate')); await tick(); assert.equal(document.querySelector('.player-captions'), null);
    media.dispatchEvent(event('webkitendfullscreen')); await tick(); assert.equal(document.querySelector('.player-captions').textContent, 'selected');
    set(media, 'webkitPresentationMode', 'picture-in-picture'); media.dispatchEvent(event('webkitpresentationmodechanged')); await tick();
    assert.equal(document.querySelector('.player-captions'), null); assert.equal(media.classList.contains('player-captions-active'), false);
    set(media, 'webkitPresentationMode', 'inline'); media.dispatchEvent(event('webkitpresentationmodechanged')); await tick(); assert.ok(document.querySelector('.player-captions'));
  } finally { view.app.unmount(); }
});

test('container fullscreen preserves custom controls and never forces device orientation', async () => {
  const media = video(); const container = document.createElement('div'); let controls; let locks = 0; let unlocks = 0; let reject = false;
  set(window.screen, 'orientation', { lock: async () => { locks++; if (reject) throw new Error('unsupported'); }, unlock: () => unlocks++ });
  container.requestFullscreen = async () => { set(document, 'fullscreenElement', container); document.dispatchEvent(event('fullscreenchange')); };
  document.exitFullscreen = async () => { set(document, 'fullscreenElement', null); document.dispatchEvent(event('fullscreenchange')); };
  const app = hook(() => { controls = useVideoFullscreen(ref(media), ref(container)); });
  try {
    await controls.toggle(); await tick(); assert.equal(controls.fullscreen.value, true); assert.equal(controls.nativeFullscreen.value, false); assert.equal(media.controls, false); assert.equal(locks, 0);
    await controls.exit(); assert.equal(unlocks, 0); assert.equal(controls.fullscreen.value, false);
    reject = true; await controls.toggle(); await tick(); assert.equal(controls.error.value, ''); assert.equal(controls.fullscreen.value, true);
  } finally { app.unmount(); await tick(); }
  assert.equal(document.fullscreenElement, null);
});
test('fullscreen exit works when the orientation API is absent', async () => {
 const media=video(),container=document.createElement('div');let controls;
 set(window.screen,'orientation',undefined);
 container.requestFullscreen=async()=>{set(document,'fullscreenElement',container);document.dispatchEvent(event('fullscreenchange'));};
 document.exitFullscreen=async()=>{set(document,'fullscreenElement',null);document.dispatchEvent(event('fullscreenchange'));};
 const app=hook(()=>{controls=useVideoFullscreen(ref(media),ref(container));});
 try{await controls.toggle();assert.equal(controls.fullscreen.value,true);await controls.exit();assert.equal(controls.fullscreen.value,false);assert.equal(controls.error.value,'');}finally{app.unmount();}
});
test('unmount requests fullscreen exit without changing orientation while browser exit is pending', async () => {
 const media=video(),container=document.createElement('div');let controls,finishExit,locks=0;
 set(window.screen,'orientation',{lock:async()=>{locks++;},unlock:()=>{locks++;}});
 container.requestFullscreen=async()=>{set(document,'fullscreenElement',container);document.dispatchEvent(event('fullscreenchange'));};
 document.exitFullscreen=()=>new Promise(done=>{finishExit=()=>{set(document,'fullscreenElement',null);done();};});
 const app=hook(()=>{controls=useVideoFullscreen(ref(media),ref(container));});
 await controls.toggle();app.unmount();await tick();assert.equal(typeof finishExit,'function');assert.equal(locks,0);finishExit();await tick();assert.equal(document.fullscreenElement,null);
});

test('media session controls and wake lock are tied to enabled player, visibility and video lifetime', async () => {
  const actions = new Map(); const positions = []; let requests = 0; let releases = 0; let next = 0; let enabled; let current;
  set(navigator, 'mediaSession', { setActionHandler: (name, fn) => actions.set(name, fn), setPositionState: position => positions.push(position) });
  globalThis.MediaMetadata = class { constructor(values) { Object.assign(this, values); } };
  set(navigator, 'wakeLock', { request: async () => { requests++; const lock = new dom.window.EventTarget(); lock.release = async () => { releases++; lock.dispatchEvent(event('release')); }; return lock; } });
  set(document, 'visibilityState', 'visible');
  const media = video(); media.currentTime = 30;
  const app = hook(() => {
    current = ref(media); enabled = ref(true);
    useAndroidMediaSession(current, { enabled: () => enabled.value, title: () => 'Test movie', episode: () => '第 2 集', nextAvailable: () => true, next: () => next++, play: () => void current.value.play() });
  });
  try {
    await tick(); assert.equal(navigator.mediaSession.metadata.title, 'Test movie'); assert.equal(requests, 0);
    actions.get('play')(); await tick(); assert.equal(requests, 1); assert.equal(navigator.mediaSession.playbackState, 'playing');
    actions.get('seekforward')({ seekOffset: 15 }); assert.equal(media.currentTime, 45);
    actions.get('seekto')({ seekTime: 999 }); assert.equal(media.currentTime, 120);
    actions.get('nexttrack')(); assert.equal(next, 1);
    set(document, 'visibilityState', 'hidden'); document.dispatchEvent(event('visibilitychange')); await tick(); assert.equal(releases, 1);
    set(document, 'visibilityState', 'visible'); document.dispatchEvent(event('visibilitychange')); await tick(); assert.equal(requests, 2);
    actions.get('pause')(); await tick(); assert.equal(releases, 2); assert.equal(navigator.mediaSession.playbackState, 'paused');
    current.value = video(); await tick(); media.dispatchEvent(event('play')); await tick(); assert.equal(requests, 2);
    enabled.value = false; await tick(); assert.equal(actions.get('play'), null); assert.equal(navigator.mediaSession.metadata, null); assert.equal(positions.at(-1), undefined);
  } finally { app.unmount(); }
});
test('pending wake lock is released after unmount and unavailable next episode has no system action', async () => {
  const actions = new Map(); let resolve; let releases = 0;
  set(navigator, 'mediaSession', { setActionHandler: (name, fn) => actions.set(name, fn), setPositionState() {} });
  set(navigator, 'wakeLock', { request: () => new Promise(done => { resolve = done; }) });
  const media = video(); await media.play();
  const app = hook(() => useAndroidMediaSession(ref(media), { enabled: () => true, title: () => '', episode: () => '', nextAvailable: () => false, next() {}, play() {} }));
  await tick(); assert.equal(actions.get('nexttrack'), null); app.unmount();
  resolve({ release: async () => releases++ }); await tick(); assert.equal(releases, 1); assert.equal(actions.get('play'), null);
});
test('Android installation uses browser prompt once, falls back to guidance and recognizes installation', async () => {
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  install.initializeAndroidInstall();
  assert.equal(await install.installAndroidApp(), 'unavailable');
  let prompted = 0;
  const offer = event('beforeinstallprompt'); Object.assign(offer, { prompt: async () => prompted++, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  window.dispatchEvent(offer);
  assert.equal(await install.installAndroidApp(), 'accepted'); assert.equal(prompted, 1);
  assert.equal(await install.installAndroidApp(), 'unavailable');
  window.dispatchEvent(event('appinstalled')); assert.equal(install.androidInstalled.value, true);
});
test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });

test('desktop container fullscreen does not request an Android orientation lock',async()=>{
 const media=video(),container=document.createElement('div');let controls,locks=0;
 set(window.screen,'orientation',{lock:async()=>{locks++},unlock:()=>{}});
 container.requestFullscreen=async()=>{set(document,'fullscreenElement',container);document.dispatchEvent(event('fullscreenchange'))};
 document.exitFullscreen=async()=>{set(document,'fullscreenElement',null);document.dispatchEvent(event('fullscreenchange'))};
 const app=hook(()=>{controls=useVideoFullscreen(ref(media),ref(container),false)});
 try{await controls.toggle();assert.equal(controls.fullscreen.value,true);assert.equal(locks,0);await controls.exit();}finally{app.unmount()}
});
